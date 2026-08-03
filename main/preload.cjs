// Runs sandboxed: only `electron` is requirable here. Everything the renderer can
// reach is enumerated below, so the UI never touches the filesystem directly.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('forge', {
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch)
  },
  project: {
    create: (options) => invoke('project:create', options),
    open: (dir) => invoke('project:open', dir),
    save: (dir, data) => invoke('project:save', dir, data),
    recent: () => invoke('project:recent'),
    // Main asks nothing at close time: it acts on the last state pushed here.
    reportDirty: (dirty, name) => invoke('project:dirty', { dirty, name }),
    pickNew: () => invoke('dialog:newProject'),
    pickOpen: () => invoke('dialog:openProject')
  },
  build: {
    run: (dir, data) => invoke('build:run', dir, data),
    readRom: (romPath) => invoke('build:readRom', romPath),
    readSymbols: (symbolPath) => invoke('build:readSymbols', symbolPath),
    openInMesen: (romPath) => invoke('mesen:launch', romPath),
    revealRom: (romPath) => invoke('build:reveal', romPath)
  },
  files: {
    readBinary: (filters) => invoke('files:readBinary', filters),
    writeBinary: (name, bytes) => invoke('files:writeBinary', name, bytes)
  },
  on: (channel, listener) => {
    const allowed = ['menu:action', 'build:log'];
    if (!allowed.includes(channel)) return () => {};
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  }
});
