// Reads and writes the on-disk project folder.
//
// The in-memory project is one object; on disk it is split into several JSON
// files so changes stay reviewable in git. Tiles are written one 64-character
// string per line for the same reason.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createProject, normalizeProject } from '../shared/project.js';

export const PROJECT_MARKER = 'project.json';

const readJson = async (file, fallback = null) => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
};

const writeJson = (file, value) => fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

// Tile tables are the one place where JSON.stringify's formatting hurts: an array
// of 256 strings at indent 2 is fine, but nesting it inside the tileset object
// makes diffs noisy. Writing them as their own compact file keeps them readable.
const writeTileTable = (file, table) =>
  fs.writeFile(file, `[\n${table.tiles.map((t) => `  "${t}"`).join(',\n')}\n]\n`, 'utf8');

export async function isProjectDir(dir) {
  try {
    await fs.access(path.join(dir, PROJECT_MARKER));
    return true;
  } catch {
    return false;
  }
}

export async function saveProject(dir, data) {
  const project = normalizeProject(data);
  await fs.mkdir(path.join(dir, 'maps'), { recursive: true });
  await fs.mkdir(path.join(dir, 'songs'), { recursive: true });
  await fs.mkdir(path.join(dir, 'tiles'), { recursive: true });

  // Switch and variable names and the progression numbers are small and rarely
  // edited, so they ride in the head file rather than earning one of their own.
  await writeJson(path.join(dir, PROJECT_MARKER), {
    format: project.format,
    project: project.project,
    cartridge: project.cartridge,
    switches: project.switches,
    variables: project.variables,
    rpg: project.rpg
  });

  // One folder per tileset, named by index so renaming a tileset never orphans
  // its tile data — the same reason maps and songs are index-named. The display
  // name lives in tilesets.json.
  const existingTiles = await fs.readdir(path.join(dir, 'tiles')).catch(() => []);
  for (const entry of existingTiles) {
    await fs.rm(path.join(dir, 'tiles', entry), { recursive: true, force: true });
  }
  await writeJson(
    path.join(dir, 'tiles', 'tilesets.json'),
    project.tilesets.map(({ id, name }) => ({ id, name }))
  );
  for (const [index, tileset] of project.tilesets.entries()) {
    const folder = path.join(dir, 'tiles', String(index));
    await fs.mkdir(folder, { recursive: true });
    await writeTileTable(path.join(folder, 'background.json'), tileset.background);
    await writeTileTable(path.join(folder, 'sprites.json'), tileset.sprites);
  }
  await writeJson(path.join(dir, 'palettes.json'), project.palettes);
  await writeJson(path.join(dir, 'metatiles.json'), project.metatiles);
  await writeJson(path.join(dir, 'sprites.json'), project.sprites);
  await writeJson(path.join(dir, 'input.json'), project.input);
  await writeJson(path.join(dir, 'party.json'), project.party);
  await writeJson(path.join(dir, 'spells.json'), project.spells);

  // Maps and songs are one file each, named by index so renames never orphan data.
  const existingMaps = await fs.readdir(path.join(dir, 'maps')).catch(() => []);
  for (const file of existingMaps) {
    if (file.endsWith('.json')) await fs.rm(path.join(dir, 'maps', file), { force: true });
  }
  await Promise.all(
    project.maps.map((map, index) => writeJson(path.join(dir, 'maps', `${index}.json`), map))
  );

  const existingSongs = await fs.readdir(path.join(dir, 'songs')).catch(() => []);
  for (const file of existingSongs) {
    if (file.endsWith('.json')) await fs.rm(path.join(dir, 'songs', file), { force: true });
  }
  await Promise.all(
    project.songs.map((song, index) => writeJson(path.join(dir, 'songs', `${index}.json`), song))
  );

  await saveCode(dir, project.code);

  return project;
}

// Code Forge sources are written as raw .asm, not wrapped in JSON, so they stay
// diffable and can be opened by any editor. Overrides and user files are kept in
// separate folders so which one a file is never depends on the engine's current
// file list — a user file that happens to share a name with a *future* engine
// file is still a user file.
const CODE_GROUPS = [
  ['overrides', 'engine'],
  ['files', 'user']
];

async function saveCode(dir, code) {
  for (const [key, folder] of CODE_GROUPS) {
    const target = path.join(dir, 'code', folder);
    const files = code[key];
    // Only projects that use the Code Forge grow a code/ folder.
    if (!files.length && !(await fs.access(target).then(() => true, () => false))) continue;
    await fs.mkdir(target, { recursive: true });
    for (const entry of await fs.readdir(target).catch(() => [])) {
      if (entry.endsWith('.asm')) await fs.rm(path.join(target, entry), { force: true });
    }
    for (const file of files) await fs.writeFile(path.join(target, file.name), file.text, 'utf8');
  }
}

async function loadCode(dir) {
  const code = {};
  for (const [key, folder] of CODE_GROUPS) {
    const target = path.join(dir, 'code', folder);
    const names = (await fs.readdir(target).catch(() => [])).filter((f) => f.endsWith('.asm'));
    const files = [];
    for (const name of names.sort()) {
      const text = await fs.readFile(path.join(target, name), 'utf8').catch(() => null);
      if (text !== null) files.push({ name, text });
    }
    code[key] = files;
  }
  return code;
}

/**
 * Read the tileset list. Projects written before mapper support stored a single
 * pair at `tiles/background.json` + `tiles/sprites.json`; that layout is still
 * read so an existing project folder opens without a conversion step.
 */
async function loadTilesets(dir) {
  const tilesDir = path.join(dir, 'tiles');
  const index = await readJson(path.join(tilesDir, 'tilesets.json'));

  if (!Array.isArray(index)) {
    const background = await readJson(path.join(tilesDir, 'background.json'), []);
    const sprites = await readJson(path.join(tilesDir, 'sprites.json'), []);
    return [{ id: 0, name: 'Main', background: { tiles: background }, sprites: { tiles: sprites } }];
  }

  const tilesets = [];
  for (const [position, entry] of index.entries()) {
    const folder = path.join(tilesDir, String(position));
    tilesets.push({
      id: position,
      name: entry?.name,
      background: { tiles: await readJson(path.join(folder, 'background.json'), []) },
      sprites: { tiles: await readJson(path.join(folder, 'sprites.json'), []) }
    });
  }
  return tilesets;
}

export async function loadProject(dir) {
  const head = await readJson(path.join(dir, PROJECT_MARKER));
  if (!head) throw new Error(`No ${PROJECT_MARKER} found in ${dir}`);

  const tilesets = await loadTilesets(dir);

  const mapFiles = (await fs.readdir(path.join(dir, 'maps')).catch(() => []))
    .filter((file) => file.endsWith('.json'))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const maps = [];
  for (const file of mapFiles) {
    const map = await readJson(path.join(dir, 'maps', file));
    if (map) maps.push(map);
  }

  const songFiles = (await fs.readdir(path.join(dir, 'songs')).catch(() => []))
    .filter((file) => file.endsWith('.json'))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const songs = [];
  for (const file of songFiles) {
    const song = await readJson(path.join(dir, 'songs', file));
    if (song) songs.push(song);
  }

  // Files added after a project was first written simply read as null and
  // normalizeProject fills them in, which is how older folders keep opening.
  return normalizeProject({
    format: head.format,
    project: head.project,
    cartridge: head.cartridge,
    switches: head.switches,
    variables: head.variables,
    rpg: head.rpg,
    tilesets,
    palettes: await readJson(path.join(dir, 'palettes.json')),
    metatiles: await readJson(path.join(dir, 'metatiles.json')),
    sprites: await readJson(path.join(dir, 'sprites.json')),
    input: await readJson(path.join(dir, 'input.json')),
    party: await readJson(path.join(dir, 'party.json')),
    spells: await readJson(path.join(dir, 'spells.json')),
    maps,
    songs,
    code: await loadCode(dir)
  });
}

export async function createProjectAt(dir, name, gameType = 'action') {
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir);
  if (entries.length && !(await isProjectDir(dir))) {
    throw new Error('That folder already contains other files. Choose an empty folder.');
  }
  return saveProject(dir, createProject(name, gameType));
}
