import { ipcMain, dialog, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createProjectAt, loadProject, saveProject, isProjectDir } from './project-io.js';
import { getSettings, setSettings, rememberProject } from './settings.js';

const ok = (value) => ({ ok: true, value });
const fail = (error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) });

// The project only ever lives in the renderer, but the window's `close` handler
// has to decide whether to stop the close *synchronously* — it cannot ask and
// wait. So the renderer pushes the answer here whenever it changes, and main
// keeps the last one.
let unsaved = { dirty: false, name: '' };
const saveWaiters = new Set();

/** Whether the renderer has changes it has not written to disk. */
export const unsavedChanges = () => unsaved;

/**
 * Resolves true once the renderer reports the project saved, false if it never
 * does. A save that fails leaves the project dirty and toasts in the renderer,
 * so the timeout is what stops a failed save from closing the window anyway.
 */
export function waitForSave(timeoutMs = 15000) {
  if (!unsaved.dirty) return Promise.resolve(true);
  return new Promise((resolve) => {
    const waiter = (saved) => {
      clearTimeout(timer);
      saveWaiters.delete(waiter);
      resolve(saved);
    };
    const timer = setTimeout(() => waiter(false), timeoutMs);
    saveWaiters.add(waiter);
  });
}

export function registerIpc({ getWindow }) {
  const window = () => getWindow();

  ipcMain.handle('project:dirty', (_event, state) => {
    unsaved = { dirty: Boolean(state?.dirty), name: state?.name ?? '' };
    if (!unsaved.dirty) {
      for (const waiter of [...saveWaiters]) waiter(true);
    }
    return ok(unsaved);
  });

  ipcMain.handle('settings:get', async () => ok(await getSettings()));
  ipcMain.handle('settings:set', async (_event, patch) => ok(await setSettings(patch)));
  ipcMain.handle('project:recent', async () => {
    const { recentProjects } = await getSettings();
    const alive = [];
    for (const dir of recentProjects) {
      if (await isProjectDir(dir)) alive.push({ dir, name: path.basename(dir) });
    }
    return ok(alive);
  });

  ipcMain.handle('dialog:newProject', async () => {
    const result = await dialog.showSaveDialog(window(), {
      title: 'Create NES Game Forge project',
      buttonLabel: 'Create project',
      defaultPath: 'MyGame.forge',
      properties: ['createDirectory']
    });
    return result.canceled ? ok(null) : ok(result.filePath);
  });

  ipcMain.handle('dialog:openProject', async () => {
    const result = await dialog.showOpenDialog(window(), {
      title: 'Open NES Game Forge project',
      buttonLabel: 'Open project',
      properties: ['openDirectory']
    });
    return result.canceled || !result.filePaths.length ? ok(null) : ok(result.filePaths[0]);
  });

  ipcMain.handle('project:create', async (_event, { dir, name, gameType }) => {
    try {
      const project = await createProjectAt(dir, name || path.basename(dir).replace(/\.forge$/i, ''), gameType);
      await rememberProject(dir);
      return ok({ dir, project });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('project:open', async (_event, dir) => {
    try {
      const project = await loadProject(dir);
      await rememberProject(dir);
      return ok({ dir, project });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('project:save', async (_event, dir, data) => {
    try {
      await saveProject(dir, data);
      await rememberProject(dir);
      return ok({ dir });
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('build:run', async (_event, dir, data) => {
    try {
      const { buildProject } = await import('./build/pipeline.js');
      const log = (line) => {
        const win = window();
        if (win && !win.isDestroyed()) win.webContents.send('build:log', line);
      };
      return ok(await buildProject({ dir, project: data, log, settings: await getSettings() }));
    } catch (error) {
      // Unlike every other channel, a failed build carries structure worth
      // keeping: nesasm reports `file:line: message`, and the Code Forge opens
      // exactly that. fail() would flatten it all into one string.
      return { ...fail(error), errors: error.errors ?? null, problems: error.problems ?? null };
    }
  });

  // --- Code Forge ----------------------------------------------------------
  // The stock engine sources are served over forge:// (they live under the app
  // root); these three channels cover what that scheme cannot reach — the file
  // list, and the generated output inside the *project* folder.

  ipcMain.handle('code:engineFiles', async () => {
    try {
      const { engineFileNames, ENGINE_DIR } = await import('./build/generate.js');
      const files = [];
      for (const name of engineFileNames()) {
        const stat = await fs.stat(path.join(ENGINE_DIR, name)).catch(() => null);
        files.push({ name, size: stat?.size ?? 0 });
      }
      return ok(files);
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('code:generatedFiles', async (_event, dir) => {
    try {
      const buildDir = path.join(dir, 'build');
      const assets = (await fs.readdir(path.join(buildDir, 'assets')).catch(() => []))
        .filter((name) => name.endsWith('.inc'))
        .sort()
        .map((name) => `assets/${name}`);
      const symbols = await fs
        .access(path.join(buildDir, 'game.fns'))
        .then(() => ['game.fns'])
        .catch(() => []);
      return ok([...assets, ...symbols]);
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('code:readGenerated', async (_event, dir, relative) => {
    try {
      const buildDir = path.join(dir, 'build');
      const file = path.resolve(buildDir, relative);
      // The renderer supplies this path, so it is checked rather than trusted:
      // inside the project's build folder, and a text file the viewer can show.
      if (file !== buildDir && !file.startsWith(buildDir + path.sep)) {
        throw new Error('That file is outside the project build folder.');
      }
      if (!/\.(inc|asm|fns)$/.test(file)) throw new Error('That file is not a text file.');
      return ok(await fs.readFile(file, 'utf8'));
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('build:readRom', async (_event, romPath) => {
    try {
      const bytes = await fs.readFile(romPath);
      return ok(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('build:readSymbols', async (_event, symbolPath) => {
    try {
      const { parseSymbolFile } = await import('./build/symbols.js');
      return ok(parseSymbolFile(await fs.readFile(symbolPath, 'utf8')));
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('build:reveal', async (_event, romPath) => {
    shell.showItemInFolder(romPath);
    return ok(true);
  });

  ipcMain.handle('mesen:launch', async (_event, romPath) => {
    const settings = await getSettings();
    const candidates = [
      settings.mesenPath,
      path.join(process.env.HOME ?? '', 'Downloads/Mesen2/bin/linux-x64/Release/Mesen'),
      'mesen',
      'Mesen'
    ].filter(Boolean);

    for (const candidate of candidates) {
      const runnable = candidate.includes(path.sep)
        ? await fs
            .access(candidate)
            .then(() => true)
            .catch(() => false)
        : true;
      if (!runnable) continue;
      try {
        const child = spawn(candidate, [romPath], { detached: true, stdio: 'ignore' });
        child.unref();
        if (candidate !== settings.mesenPath) await setSettings({ mesenPath: candidate });
        return ok(candidate);
      } catch {
        // try the next candidate
      }
    }
    return fail(
      'Could not find Mesen. Set its path in Settings (looked for ~/Downloads/Mesen2/bin/linux-x64/Release/Mesen).'
    );
  });

  ipcMain.handle('files:readBinary', async (_event, filters) => {
    const result = await dialog.showOpenDialog(window(), { properties: ['openFile'], filters });
    if (result.canceled || !result.filePaths.length) return ok(null);
    const file = result.filePaths[0];
    const bytes = await fs.readFile(file);
    return ok({
      name: path.basename(file),
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    });
  });

  ipcMain.handle('files:writeBinary', async (_event, name, bytes) => {
    const result = await dialog.showSaveDialog(window(), { defaultPath: name });
    if (result.canceled || !result.filePath) return ok(null);
    await fs.writeFile(result.filePath, Buffer.from(bytes));
    return ok(result.filePath);
  });
}
