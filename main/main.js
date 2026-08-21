import { app, BrowserWindow, protocol, Menu, shell, dialog } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerIpc, unsavedChanges, waitForSave } from './ipc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// Smoke opens and creates throwaway temp projects, and both project:open and
// project:create call rememberProject() (main/settings.js), which writes into
// the same settings.json the real app reads its recent-projects list from.
// main/smoke.js already cleans up the temp project directories it creates,
// but that leaves settings.json holding dangling paths forever -- and since
// the list is capped at ten, enough smoke runs would eventually evict a
// real recent project rather than one of its own. Isolating userData here,
// before app.whenReady(), keeps every settings write inside a directory
// nothing but smoke itself ever reads, so the real settings.json is never
// opened at all. Must happen this early: Electron refuses app.setPath() once
// the app is ready.
//
// mkdtempSync, not a fixed path: app.setPath() throws if the directory does
// not already exist (Electron's own contract), so a fixed path only ever
// worked here because something had already created it once -- a fresh
// checkout or CI machine would throw on the very first smoke run. A fixed
// path shared by every invocation also means every run reuses the same
// Chromium profile: stale settings, lock files a still-running or crashed
// previous instance left behind, and a real race if two runs ever overlap.
// mkdtempSync is synchronous and safe this early (no event loop / IPC to
// await yet), and guarantees the directory both exists and is this run's
// alone.
if (process.env.FORGE_SMOKE) {
  app.setPath('userData', mkdtempSync(path.join(os.tmpdir(), 'nes-game-forge-smoke-userdata-')));
}

// ES modules cannot be fetched over file:// (opaque origin, CORS-blocked), so the
// app is served from a privileged custom scheme instead.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'forge',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm'
};

async function handleForgeRequest(request) {
  const url = new URL(request.url);
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const target = path.join(ROOT, relative);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    return new Response('Forbidden', { status: 403 });
  }
  try {
    const body = await fs.readFile(target);
    return new Response(body, {
      headers: { 'content-type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream' }
    });
  } catch (error) {
    return new Response(`Not found: ${relative}`, { status: 404 });
  }
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#0f1116',
    title: 'NES Game Forge',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Unsaved changes stop the close *once*, to ask. Every path out of the
  // question either closes for real or leaves the window alone — a close that is
  // refused without saying why is how the X stops working.
  let asking = false;
  let confirmed = false;
  const win = mainWindow;
  win.on('close', (event) => {
    if (confirmed || !unsavedChanges().dirty) return;
    event.preventDefault();
    if (asking) return; // clicking the X again while the dialog is up
    asking = true;
    confirmClose(win)
      .then((close) => {
        confirmed = close;
        if (close) win.close();
      })
      .finally(() => {
        asking = false;
      });
  });

  mainWindow.loadURL('forge://app/renderer/index.html');
  return mainWindow;
}

// The two ways the window can throw away what the renderer is holding.
const DISCARD = {
  close: { gerund: 'closing', buttons: ['Save and close', 'Close without saving', 'Cancel'] },
  reload: { gerund: 'reloading', buttons: ['Save and reload', 'Reload without saving', 'Cancel'] }
};

/** Resolves true when it is safe to go ahead and lose the renderer's state. */
async function confirmDiscard(window, kind) {
  const { name } = unsavedChanges();
  const { gerund, buttons } = DISCARD[kind];
  const { response } = await dialog.showMessageBox(window, {
    type: 'warning',
    buttons,
    defaultId: 0,
    cancelId: 2,
    title: 'Unsaved changes',
    message: `Save ${name || 'this project'} before ${gerund}?`,
    detail: 'The project has changes that have not been written to disk.'
  });
  if (response === 2) return false;
  if (response === 1) return true;

  // The renderer owns the project, so saving means asking it to and waiting for
  // it to report itself clean. A save that fails says so in the renderer and
  // leaves the project dirty, which is what keeps the window open.
  window.webContents.send('menu:action', 'project:save');
  return waitForSave();
}

const confirmClose = (window) => confirmDiscard(window, 'close');

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Project…', accelerator: 'CmdOrCtrl+N', click: () => send('menu:action', 'project:new') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => send('menu:action', 'project:open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('menu:action', 'project:save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu:action', 'project:saveAs') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('menu:action', 'edit:undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => send('menu:action', 'edit:redo') }
      ]
    },
    {
      label: 'Build',
      submenu: [
        { label: 'Build ROM', accelerator: 'F5', click: () => send('menu:action', 'build:run') },
        { label: 'Build and Play', accelerator: 'F6', click: () => send('menu:action', 'build:play') },
        { label: 'Open in Mesen', click: () => send('menu:action', 'build:mesen') }
      ]
    },
    {
      label: 'View',
      submenu: [
        // Not `role: 'reload'`: a reload throws the project away just as surely
        // as closing does, so it asks the same question first.
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: async () => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            if (unsavedChanges().dirty && !(await confirmDiscard(mainWindow, 'reload'))) return;
            mainWindow.webContents.reload();
          }
        },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  protocol.handle('forge', handleForgeRequest);
  registerIpc({ getWindow: () => mainWindow });
  buildMenu();
  createWindow();

  if (process.env.FORGE_SMOKE) {
    // Caught, because an uncaught one here is not a failed test — it is a window
    // sitting open forever with nothing driving it. A syntax error in smoke.js
    // rejects this import, and without this the run hangs until whatever is
    // waiting on it gives up, with the actual error buried in a warning.
    try {
      const { runSmoke } = await import('./smoke.js');
      app.exit(await runSmoke(mainWindow));
    } catch (error) {
      console.error('Smoke test could not run:', error);
      app.exit(1);
    }
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
