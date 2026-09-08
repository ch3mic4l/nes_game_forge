import { ipcMain, dialog, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createProjectAt, loadProject, saveProject, isProjectDir, assertEmptyProjectDestination } from './project-io.js';
import { getSettings, setSettings, rememberProject } from './settings.js';
import { createBuildGate } from './build/buildgate.js';
import { resolveBuildFile } from './buildpaths.js';

const ok = (value) => ({ ok: true, value });
const fail = (error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) });

// One gate for the process's lifetime, not per registerIpc() call (there is
// only ever one window, but this is what makes that not load-bearing: a
// second in-flight build for the same directory is refused no matter which
// window or how many times registerIpc() itself has run).
const buildGate = createBuildGate();

// The project only ever lives in the renderer, but the window's `close` handler
// has to decide whether to stop the close *synchronously* — it cannot ask and
// wait. So the renderer pushes the answer here whenever it changes, and main
// keeps the last one.
let unsaved = { dirty: false, name: '' };
const saveWaiters = new Set();

// The directory the renderer's own project last named to project:open,
// project:create, project:save, project:saveAs or build:run -- each already
// receives it as an argument, so this just remembers the latest one. It is
// what build:readRom/build:readSymbols/build:reveal/mesen:launch resolve an
// otherwise-untrusted renderer-supplied path against (main/buildpaths.js),
// the same way code:readGenerated already checks its own path against the
// dir it is explicitly handed -- these four channels never receive a project
// dir of their own, only a file path, so there was nothing to check *against*
// before this existed.
let activeProjectDir = null;

// Bumped only by project:open/project:create/project:saveAs succeeding --
// the three channels item 7 names as the only ones allowed to actually
// SWITCH the active project. project:save and build:run capture this value
// the moment they are invoked and compare it again once their own async
// work finishes; if it moved in between, a fresher switch happened while
// this call was still in flight, and this call must not clobber it. See
// claimActiveProjectDir's own comment for why this is an epoch check rather
// than the brief's own literal "null or already equal" wording.
let projectEpoch = 0;

/** Whether the renderer has changes it has not written to disk. */
export const unsavedChanges = () => unsaved;

// The seam for dialog:newProject (docs/design-starter-projects.md §8.2): the
// real save dialog is native and cannot be driven, so main/smoke.js arms a
// path here before clicking "New project" for real, and dialog:newProject
// answers with it -- one-shot, consumed and cleared the moment it is read,
// so an unrelated later New-Project click (if a scenario ever makes one)
// still hits the real dialog guard below rather than silently reusing a
// stale scratch path.
let smokeNewProjectPath = null;

export function setSmokeNewProjectPath(path) {
  if (!process.env.FORGE_SMOKE) throw new Error('setSmokeNewProjectPath is only for FORGE_SMOKE runs');
  smokeNewProjectPath = path;
}

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

// The app is served over forge://app/... (main/main.js's own
// `protocol.registerSchemesAsPrivileged` + `loadURL('forge://app/renderer/
// index.html')`) rather than file://, so this is the one origin any
// legitimate sender frame can ever have. Every ipcMain.handle registration
// below is wrapped through guardedHandle rather than called directly, so a
// channel that would otherwise trust whatever arguments arrive (several of
// these hand back or act on an arbitrary file path) cannot be reached from
// any frame this app did not itself load -- a devtools-opened external page,
// or a future <webview>/child frame, say. event.senderFrame is the frame
// that actually sent the message, not merely the top-level window (which
// could still be this app's own while an iframe inside it is not) --
// checked here for every channel, not only the file-path-shaped ones,
// because a settings or dirty-report channel from an unexpected sender is
// exactly as unwanted as a path-shaped one, and a single shared guard is
// what keeps that from depending on remembering to add it per handler.
const ALLOWED_ORIGIN = 'forge://app/';

export function registerIpc({ getWindow }) {
  const window = () => getWindow();

  function guardedHandle(channel, handler) {
    ipcMain.handle(channel, (event, ...args) => {
      if (!event.senderFrame?.url?.startsWith(ALLOWED_ORIGIN)) {
        return fail('Refused: unexpected sender.');
      }
      return handler(event, ...args);
    });
  }

  guardedHandle('project:dirty', (_event, state) => {
    unsaved = { dirty: Boolean(state?.dirty), name: state?.name ?? '' };
    if (!unsaved.dirty) {
      for (const waiter of [...saveWaiters]) waiter(true);
    }
    return ok(unsaved);
  });

  guardedHandle('settings:get', async () => ok(await getSettings()));
  guardedHandle('settings:set', async (_event, patch) => ok(await setSettings(patch)));
  guardedHandle('project:recent', async () => {
    const { recentProjects } = await getSettings();
    const alive = [];
    for (const dir of recentProjects) {
      if (await isProjectDir(dir)) alive.push({ dir, name: path.basename(dir) });
    }
    return ok(alive);
  });

  guardedHandle('dialog:newProject', async () => {
    if (process.env.FORGE_SMOKE && smokeNewProjectPath) {
      const path = smokeNewProjectPath;
      smokeNewProjectPath = null;
      return ok(path);
    }
    const result = await dialog.showSaveDialog(window(), {
      title: 'Create NES Game Forge project',
      buttonLabel: 'Create project',
      defaultPath: 'MyGame.forge',
      properties: ['createDirectory']
    });
    return result.canceled ? ok(null) : ok(result.filePath);
  });

  // Save As (ROADMAP item 15) shares the identical native-dialog seam as
  // dialog:newProject above -- smokeNewProjectPath is one-shot and consumed
  // the moment either channel reads it, so a smoke run arms whichever of the
  // two it is about to trigger.
  guardedHandle('dialog:saveProjectAs', async () => {
    if (process.env.FORGE_SMOKE && smokeNewProjectPath) {
      const path = smokeNewProjectPath;
      smokeNewProjectPath = null;
      return ok(path);
    }
    const result = await dialog.showSaveDialog(window(), {
      title: 'Save NES Game Forge project as',
      buttonLabel: 'Save project',
      defaultPath: 'MyGame.forge',
      properties: ['createDirectory']
    });
    return result.canceled ? ok(null) : ok(result.filePath);
  });

  guardedHandle('dialog:openProject', async () => {
    const result = await dialog.showOpenDialog(window(), {
      title: 'Open NES Game Forge project',
      buttonLabel: 'Open project',
      properties: ['openDirectory']
    });
    return result.canceled || !result.filePaths.length ? ok(null) : ok(result.filePaths[0]);
  });

  guardedHandle('project:create', async (_event, { dir, name, starterId }) => {
    try {
      const project = await createProjectAt(dir, name || path.basename(dir).replace(/\.forge$/i, ''), starterId);
      await rememberProject(dir);
      activeProjectDir = dir;
      projectEpoch++;
      return ok({ dir, project });
    } catch (error) {
      return fail(error);
    }
  });

  guardedHandle('project:open', async (_event, dir) => {
    try {
      const project = await loadProject(dir);
      await rememberProject(dir);
      activeProjectDir = dir;
      projectEpoch++;
      return ok({ dir, project });
    } catch (error) {
      return fail(error);
    }
  });

  // project:save and build:run never SWITCH the active project themselves --
  // only project:open, project:create and project:saveAs (above/below) do
  // that, each bumping projectEpoch when they do. These two instead capture
  // the epoch at the moment they are invoked and only claim activeProjectDir
  // for their own `dir` if that epoch is UNCHANGED once their own async work
  // finishes -- if it moved, a fresher project:open/create/saveAs happened
  // while this call was still in flight, and this call is the stale one:
  // exactly the item 7 bug (a late project:save completion for A after B
  // was opened silently moving activeProjectDir back to A, so B's own
  // subsequent build:readRom/etc. calls were refused as "outside the
  // project's build folder" -- A's build folder, not B's).
  //
  // This is deliberately an epoch check, not the brief's own literal "set it
  // only when null or already equal to dir" wording: that literal rule also
  // refuses a build:run for a project B that was opened earlier, stepped
  // away from (a different project opened via project:open in between, with
  // no race involved at all), and is now being built again on its own --
  // main/smoke.js's own "play from here" step does exactly this (builds
  // Sample.forge again after an RPG-project excursion that opened
  // SampleRpg.forge via project:open in between, sequentially, with no
  // overlap), and reproducibly fails under the literal rule (confirmed by
  // instrumenting this handler: build:run(Sample.forge) arrived with
  // activeProjectDir already moved to SampleRpg.forge, correctly and with no
  // race in sight, and the literal rule leaves it stuck there, so every
  // later build:readRom call for Sample.forge is wrongly refused). The
  // epoch check draws the intended line instead: only a call whose own
  // epoch went stale WHILE it was still running is refused, which is the
  // actual race the bug report describes -- a build:run or project:save
  // dispatched after the fact, for whatever project is genuinely active
  // now, is not that.
  guardedHandle('project:save', async (_event, dir, data) => {
    const epochAtStart = projectEpoch;
    try {
      await saveProject(dir, data);
      await rememberProject(dir);
      if (projectEpoch === epochAtStart) activeProjectDir = dir;
      return ok({ dir });
    } catch (error) {
      return fail(error);
    }
  });

  // Save As (ROADMAP item 15): refuses a non-empty destination the same way
  // project:create does, through the one exported rule both share
  // (assertEmptyProjectDestination, main/project-io.js) -- checked before
  // saveProject ever writes a byte, so a refusal here always leaves the new
  // destination untouched and never comes near the original project's files.
  // Unlike project:save, this SWITCHES -- the project's own location really
  // did just move to `dir` -- but only if it is not itself the stale one:
  // the identical epoch rule project:save uses above, not the unconditional
  // claim this used to be. A Save As for A that completes AFTER Open B ran
  // (activeProjectDir already B's, projectEpoch already bumped past what
  // this call started with) must not drag activeProjectDir back to A just
  // because saveProject/rememberProject finally resolved -- it returns
  // `stale: true` instead of switching, so the renderer's own session check
  // (Store#relocateIfSession, item 2) is what actually decides whether the
  // user sees this as "moved" or "a copy was written to <dir>," and main's
  // own bookkeeping does not fight it by switching anyway underneath.
  guardedHandle('project:saveAs', async (_event, { dir, data }) => {
    const epochAtStart = projectEpoch;
    try {
      await assertEmptyProjectDestination(dir);
      await saveProject(dir, data);
      await rememberProject(dir);
      if (projectEpoch !== epochAtStart) return ok({ dir, stale: true });
      activeProjectDir = dir;
      projectEpoch++;
      return ok({ dir });
    } catch (error) {
      return fail(error);
    }
  });

  guardedHandle('build:run', async (_event, dir, data) => {
    const epochAtStart = projectEpoch;
    return buildGate.runGated(dir, async () => {
      try {
        const { buildProject } = await import('./build/pipeline.js');
        const log = (line) => {
          const win = window();
          if (win && !win.isDestroyed()) win.webContents.send('build:log', line);
        };
        const result = await buildProject({ dir, project: data, log, settings: await getSettings() });
        // Only after buildProject genuinely succeeds (item 5a) -- and even
        // then, only claimed via the epoch check above (item 7), not
        // switched unconditionally: a build that ultimately fails, or one
        // whose epoch went stale while it was running, must not redirect
        // build:readRom/readSymbols/reveal/mesen:launch at a folder the
        // renderer has since moved away from.
        if (projectEpoch === epochAtStart) activeProjectDir = dir;
        return ok(result);
      } catch (error) {
        // Unlike every other channel, a failed build carries structure worth
        // keeping: nesasm reports `file:line: message`, and the Code Forge opens
        // exactly that. fail() would flatten it all into one string.
        return { ...fail(error), errors: error.errors ?? null, problems: error.problems ?? null };
      }
    });
  });

  // --- Code Forge ----------------------------------------------------------
  // The stock engine sources are served over forge:// (they live under the app
  // root); these three channels cover what that scheme cannot reach — the file
  // list, and the generated output inside the *project* folder.

  guardedHandle('code:engineFiles', async () => {
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

  guardedHandle('code:generatedFiles', async (_event, dir) => {
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

  guardedHandle('code:readGenerated', async (_event, dir, relative) => {
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

  // Four channels below hand back or act on a file the renderer names by
  // path -- unlike code:readGenerated just above (which is handed the
  // project dir explicitly and checks against it directly), these only ever
  // received the bare path, so nothing here checked it against anything.
  // resolveBuildFile (main/buildpaths.js) is the same "inside the project's
  // own build folder, with an allowed extension" check code:readGenerated
  // already makes, resolved against activeProjectDir -- the most recent
  // project:open/project:create/project:save/project:saveAs/build:run.
  //
  // build:readRom's own allowlist is .nes and .chr, not .nes alone: the real
  // production callers (renderer/forges/build/build.js) only ever read a
  // .nes, but main/smoke.js also reads a built tileset's own generated .chr
  // straight out of build/assets/ through this same channel to verify player
  // sprite generation against real, assembled CHR (not just playerTiles) --
  // an existing, passing smoke step this brief's own ".nes" allowlist would
  // otherwise break. Both stay inside the identical build/ folder either way.
  guardedHandle('build:readRom', async (_event, romPath) => {
    try {
      if (!activeProjectDir) throw new Error('No project is open.');
      const resolved = resolveBuildFile(activeProjectDir, romPath, ['.nes', '.chr']);
      const bytes = await fs.readFile(resolved);
      return ok(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    } catch (error) {
      return fail(error);
    }
  });

  guardedHandle('build:readSymbols', async (_event, symbolPath) => {
    try {
      if (!activeProjectDir) throw new Error('No project is open.');
      const resolved = resolveBuildFile(activeProjectDir, symbolPath, ['.fns']);
      const { parseSymbolFile } = await import('./build/symbols.js');
      return ok(parseSymbolFile(await fs.readFile(resolved, 'utf8')));
    } catch (error) {
      return fail(error);
    }
  });

  guardedHandle('build:reveal', async (_event, romPath) => {
    try {
      if (!activeProjectDir) throw new Error('No project is open.');
      const resolved = resolveBuildFile(activeProjectDir, romPath, ['.nes']);
      shell.showItemInFolder(resolved);
      return ok(true);
    } catch (error) {
      return fail(error);
    }
  });

  guardedHandle('mesen:launch', async (_event, romPath) => {
    let resolvedRomPath;
    try {
      if (!activeProjectDir) throw new Error('No project is open.');
      resolvedRomPath = resolveBuildFile(activeProjectDir, romPath, ['.nes']);
    } catch (error) {
      return fail(error);
    }
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
        const child = spawn(candidate, [resolvedRomPath], { detached: true, stdio: 'ignore' });
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

  guardedHandle('files:readBinary', async (_event, filters) => {
    try {
      const result = await dialog.showOpenDialog(window(), { properties: ['openFile'], filters });
      if (result.canceled || !result.filePaths.length) return ok(null);
      const file = result.filePaths[0];
      const bytes = await fs.readFile(file);
      return ok({
        name: path.basename(file),
        data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      });
    } catch (error) {
      return fail(error);
    }
  });

  guardedHandle('files:writeBinary', async (_event, name, bytes) => {
    try {
      const result = await dialog.showSaveDialog(window(), { defaultPath: name });
      if (result.canceled || !result.filePath) return ok(null);
      await fs.writeFile(result.filePath, Buffer.from(bytes));
      return ok(result.filePath);
    } catch (error) {
      return fail(error);
    }
  });
}
