// App-level settings (tool paths, recent projects). Stored outside any project.

import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULTS = {
  nesasmPath: 'nesasm',
  mesenPath: '',
  recentProjects: [],
  playBindings: {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    a: 'KeyX',
    b: 'KeyZ',
    select: 'ShiftRight',
    start: 'Enter'
  }
};

let cache = null;
const file = () => path.join(app.getPath('userData'), 'settings.json');

export async function getSettings() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(await fs.readFile(file(), 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export async function setSettings(patch) {
  const current = await getSettings();
  cache = { ...current, ...patch };
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(file(), `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  return cache;
}

export async function rememberProject(dir) {
  const settings = await getSettings();
  const recent = [dir, ...settings.recentProjects.filter((entry) => entry !== dir)].slice(0, 10);
  return setSettings({ recentProjects: recent });
}
