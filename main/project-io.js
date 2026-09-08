// Reads and writes the on-disk project folder.
//
// The in-memory project is one object; on disk it is split into several JSON
// files so changes stay reviewable in git. Tiles are written one 64-character
// string per line for the same reason.

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeProject } from '../shared/project.js';
import { STARTERS } from '../shared/starters/index.js';
import { canonicalizePath } from './paths.js';
import { createSaveQueue, awaitAllSettled } from './savequeue.js';

export const PROJECT_MARKER = 'project.json';

// A parse error or any other I/O error on an asset file used to read back as
// the fallback exactly like a missing file -- ENOENT and "the JSON is
// corrupt" collapsed into the same "blank data" outcome, silently. Only
// ENOENT/ENOTDIR (an older project folder that simply never had this file)
// still yields the fallback; anything else rethrows a new Error naming the
// file and the underlying message, so loadProject rejects and the renderer's
// existing toast shows a real reason instead of quietly replacing content.
const readJson = async (file, fallback = null) => {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return fallback;
    throw new Error(`Could not read ${file}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not parse ${file}: ${error.message}`);
  }
};

// Every write lands via a sibling temp file and an atomic rename over the
// real target, so a mid-write failure (ENOSPC, a killed process) never
// leaves a half-written target -- the target either has its old bytes or
// its new ones, never a partial mix of both. The temp name still contains
// the real basename, which is what lets a targeted write failure in a test
// be matched by path rather than by call order. randomUUID(), not
// Math.random(): a save writes many files, and a test elsewhere mocks the
// *global* Math.random with a small, finite, purpose-built queue for its own
// unrelated reason (a saveCompatToken draw) -- sharing that well would drain
// it and start returning undefined a few files into the very same save.
//
// A write or rename that throws still cleans up its own tmp file, best
// effort: without this, a failed save (ENOSPC, a forced test failure) left
// a `.name.tmp-<uuid>` file sitting in the directory forever, since nothing
// else ever names or removes it. The cleanup's own failure (the tmp file
// was never created at all, because `writeFile` itself is what threw) is
// swallowed -- there is nothing more useful to do with it than the original
// error, which is what actually propagates.
async function atomicWriteFile(file, contents) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${randomUUID()}`);
  try {
    await fs.writeFile(tmp, contents, 'utf8');
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

const writeJson = (file, value) => atomicWriteFile(file, `${JSON.stringify(value, null, 2)}\n`);

// Tile tables are the one place where JSON.stringify's formatting hurts: an array
// of 256 strings at indent 2 is fine, but nesting it inside the tileset object
// makes diffs noisy. Writing them as their own compact file keeps them readable.
const writeTileTable = (file, table) =>
  atomicWriteFile(file, `[\n${table.tiles.map((t) => `  "${t}"`).join(',\n')}\n]\n`);

export async function isProjectDir(dir) {
  try {
    await fs.access(path.join(dir, PROJECT_MARKER));
    return true;
  } catch {
    return false;
  }
}

// One queue slot per canonicalized directory, so two saveProject() calls
// for the same folder run strictly one after the other rather than
// interleaving their writes -- createSaveQueue (main/savequeue.js) is the
// generic mechanism; canonicalizeProjectDir below is this call site's own
// key, and saveProject is this call site's own task.
const saveQueue = createSaveQueue();

// canonicalizePath (main/paths.js), not a bare realpathSync-with-fallback:
// the first save to a not-yet-existing directory used to key on
// path.resolve(dir) (realpath throws -- nothing exists yet), but a SECOND,
// concurrent save arriving after the first has created that directory would
// key on realpathSync(dir) instead -- a *different* string whenever an
// ancestor of `dir` is a symlink, since realpath resolves it and the plain
// fallback never did. Two different keys for the same real directory means
// the two saves run concurrently instead of serialized, which is the entire
// point of this queue. canonicalizePath resolves the same way regardless of
// whether `dir` itself exists yet, so both calls land on one key either way.
const canonicalizeProjectDir = canonicalizePath;

export function saveProject(dir, data) {
  return saveQueue.run(canonicalizeProjectDir(dir), () => saveProjectNow(dir, data));
}

async function saveProjectNow(dir, data) {
  const project = normalizeProject(data);
  await fs.mkdir(path.join(dir, 'maps'), { recursive: true });
  await fs.mkdir(path.join(dir, 'songs'), { recursive: true });
  await fs.mkdir(path.join(dir, 'tiles'), { recursive: true });

  // Switch and variable names, the progression numbers, and the common event
  // id counter are small and rarely edited, so they ride in the head file
  // rather than earning one of their own. commonEventSeq has to survive this
  // round trip specifically: it is what keeps a deleted common event's id
  // from being handed to the next one added, and a counter reset on every
  // save would silently start reusing ids the moment the project reopened.
  await writeJson(path.join(dir, PROJECT_MARKER), {
    format: project.format,
    project: project.project,
    cartridge: project.cartridge,
    switches: project.switches,
    variables: project.variables,
    commonEventSeq: project.commonEventSeq,
    rpg: project.rpg
  });

  // One folder per tileset, named by index so renaming a tileset never orphans
  // its tile data — the same reason maps and songs are index-named. The display
  // name lives in tilesets.json. Every new tileset folder is written *before*
  // any stale one is removed (below, after every other write in this function
  // has succeeded) — a write failure partway through must never have already
  // deleted the previous save's folders.
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
  // Always written, including when empty: presence vs. absence of this file
  // (not its content) is the migration discriminator normalizeProject reads
  // — an empty array means "already migrated, has no items today," which
  // must stay distinguishable from a project that has never seen items.json
  // at all. A conditional write here would collapse that distinction the
  // first time an author deleted their last item. sfx.json is the identical
  // shape one field over -- always written, empty array included, so an
  // authored effect is never simply missing from the save this file was
  // never given a write line for.
  await writeJson(path.join(dir, 'items.json'), project.items);
  await writeJson(path.join(dir, 'sfx.json'), project.sfx);
  await writeJson(path.join(dir, 'input.json'), project.input);
  await writeJson(path.join(dir, 'party.json'), project.party);
  await writeJson(path.join(dir, 'spells.json'), project.spells);
  await writeJson(path.join(dir, 'commonEvents.json'), project.commonEvents);

  // Maps and songs are one file each, named by index so renames never orphan
  // data. Every new file is written before any stale one is removed, for the
  // same reason as the tileset folders above. awaitAllSettled, not
  // Promise.all: a project with several maps/songs fans out several writes
  // at once, and Promise.all would let this function reject the instant the
  // first one fails while its siblings are still mid-write -- see
  // awaitAllSettled's own comment for why that specific gap corrupts a
  // later, successful save to the same directory.
  await awaitAllSettled(
    project.maps.map((map, index) => writeJson(path.join(dir, 'maps', `${index}.json`), map))
  );
  await awaitAllSettled(
    project.songs.map((song, index) => writeJson(path.join(dir, 'songs', `${index}.json`), song))
  );

  await writeCode(dir, project.code);

  // ---- Prune stale entries. Only reached once every write above has
  // succeeded -- an error anywhere above throws out of this function before
  // any of the following ever runs, so a failed save can shrink nothing that
  // the previous, successful save left on disk. Never a whole-folder rm: each
  // loop removes only entries whose own index/name is no longer in the new
  // set, identified by inspecting what is actually there rather than assumed.
  // This is every prune in the save, code groups included (pruneStaleCode
  // below) -- both used to run inline inside saveCode/writeCode, immediately
  // after each code GROUP's own writes rather than after the WHOLE save's,
  // which meant a failure writing the second group had already pruned the
  // first group's stale files despite the overall save never succeeding.
  const pruneStaleNumbered = async (folder, extension, keepCount) => {
    for (const entry of await fs.readdir(folder).catch(() => [])) {
      if (extension && !entry.endsWith(extension)) continue;
      const stem = extension ? entry.slice(0, -extension.length) : entry;
      // Anything whose name isn't a bare non-negative integer isn't one of
      // ours (tilesets.json, sharing the tiles/ folder, is the reason this
      // check exists at all) and is left alone rather than swept up.
      if (!/^\d+$/.test(stem)) continue;
      if (Number(stem) >= keepCount) {
        await fs.rm(path.join(folder, entry), { recursive: true, force: true });
      }
    }
  };
  await pruneStaleNumbered(path.join(dir, 'tiles'), '', project.tilesets.length);
  await pruneStaleNumbered(path.join(dir, 'maps'), '.json', project.maps.length);
  await pruneStaleNumbered(path.join(dir, 'songs'), '.json', project.songs.length);
  await pruneStaleCode(dir, project.code);

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

// Write-only: writeCode() never prunes anything itself. Pruning a code
// group's stale .asm files right after writing that group's own new ones
// (the shape this used to be, one group finishing completely before the
// next one's writes even started) is exactly the bug this split fixes --
// a failure writing the SECOND group left the FIRST group's prune already
// done, despite the save as a whole never succeeding. pruneStaleCode below
// is the other half, called only once every write in the entire save
// (both code groups, tiles, maps, songs) has succeeded.
async function writeCode(dir, code) {
  for (const [key, folder] of CODE_GROUPS) {
    const target = path.join(dir, 'code', folder);
    const files = code[key];
    // Only projects that use the Code Forge grow a code/ folder.
    if (!files.length && !(await fs.access(target).then(() => true, () => false))) continue;
    await fs.mkdir(target, { recursive: true });
    for (const file of files) await atomicWriteFile(path.join(target, file.name), file.text);
  }
}

async function pruneStaleCode(dir, code) {
  for (const [key, folder] of CODE_GROUPS) {
    const target = path.join(dir, 'code', folder);
    const keep = new Set(code[key].map((file) => file.name));
    for (const entry of await fs.readdir(target).catch(() => [])) {
      if (entry.endsWith('.asm') && !keep.has(entry)) await fs.rm(path.join(target, entry), { force: true });
    }
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
    commonEventSeq: head.commonEventSeq,
    rpg: head.rpg,
    tilesets,
    palettes: await readJson(path.join(dir, 'palettes.json')),
    metatiles: await readJson(path.join(dir, 'metatiles.json')),
    sprites: await readJson(path.join(dir, 'sprites.json')),
    // `readJson`'s fallback is `null`, not `[]`, on purpose here: a project
    // saved before items.json existed must read back as "no items array at
    // all" so normalizeProject's migration runs, not as "already migrated,
    // zero items."
    items: await readJson(path.join(dir, 'items.json')),
    // Same shape as items.json above: a missing sfx.json (a project saved
    // before this file existed) must read back as "no array at all" so
    // normalizeProject's own `Array.isArray(raw.sfx) ? raw.sfx : []`
    // fallback runs, which it does identically either way -- there is no
    // migration to trigger here, only the ordinary empty default.
    sfx: await readJson(path.join(dir, 'sfx.json')),
    input: await readJson(path.join(dir, 'input.json')),
    party: await readJson(path.join(dir, 'party.json')),
    spells: await readJson(path.join(dir, 'spells.json')),
    commonEvents: await readJson(path.join(dir, 'commonEvents.json')),
    maps,
    songs,
    code: await loadCode(dir)
  });
}

/**
 * Refuse any destination that already holds something -- a project (over-
 * writing one silently is the item 6 defect this closes) or unrelated files
 * (the pre-existing refusal). The one rule both createProjectAt and
 * project:saveAs (main/ipc.js) refuse a non-empty target with.
 */
export async function assertEmptyProjectDestination(dir) {
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir);
  if (!entries.length) return;
  if (await isProjectDir(dir)) {
    throw new Error('That folder already contains a project. Choose an empty folder.');
  }
  throw new Error('That folder already contains other files. Choose an empty folder.');
}

export async function createProjectAt(dir, name, starterId = 'blank-action') {
  // Resolved before anything touches the filesystem: an unknown id must
  // leave the directory untouched entirely -- not even created -- rather
  // than mkdir-ing an empty folder for a project that was never going to be
  // written (docs/design-starter-projects.md §6.1, tightened from the
  // design's own snippet, which mkdirs first).
  const starter = STARTERS.find((entry) => entry.id === starterId);
  if (!starter) throw new Error(`Unknown starter "${starterId}".`);
  await assertEmptyProjectDestination(dir);
  return saveProject(dir, starter.build(name));
}
