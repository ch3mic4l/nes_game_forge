// ROADMAP item 8 (modular parts), Phase 1: the schema only -- no generator, no
// build-time stamping, no UI wiring beyond the Tile Forge's two new views
// (design-modular-parts.md §7). See CLAUDE.md's own "Nothing but text.asm..."
// section neighbours for the codebase's general conventions; this file mirrors
// the sibling renumber-deletion tests in project.test.js, kept separate here
// because project.test.js is already large.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import {
  createProject,
  normalizeProject,
  renumberPlayerPartDeletion,
  quadrantIndex,
  storageIndex,
  DIRECTION_ORDER,
  QUADRANT_ORDER,
  PART_FRAME_SLOTS,
  PLAYER_FRAMES,
  PLAYER_TILES,
  LIMITS
} from '../../shared/project.js';
import { BLANK_TILE, TILE_PIXELS } from '../../shared/chr.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const hasSample = fs.existsSync(path.join(SAMPLE, 'project.json'));
const needsSample = !hasSample && 'run `npm run sample` first';

// A real, valid tile string -- a checkerboard of slots 0/1, easy to eyeball
// and definitely not BLANK_TILE.
const REAL_TILE = '01'.repeat(TILE_PIXELS / 2);

// --- exact constants (pinned literally, not derived from the thing under test)

test('the wire-format constants are exactly what design-modular-parts.md §3 specifies', () => {
  assert.equal(LIMITS.playerParts, 256);
  assert.equal(PLAYER_FRAMES, 8);
  assert.equal(PLAYER_TILES, 32);
  assert.deepEqual(DIRECTION_ORDER, ['down', 'up', 'left', 'right']);
  assert.deepEqual(QUADRANT_ORDER, ['TL', 'TR', 'BL', 'BR']);
  assert.deepEqual(PART_FRAME_SLOTS, ['0', '1', 'both']);
});

// --- normalizePlayerPart (via normalizeProject) -----------------------------

test('normalizePlayerPart: a valid-length tile string survives verbatim, an invalid one falls back to BLANK_TILE', () => {
  const raw = { project: { name: 'T' }, sprites: { playerParts: [{ tile: REAL_TILE }, { tile: 'short' }, {}] } };
  const project = normalizeProject(raw);
  assert.equal(project.sprites.playerParts[0].tile, REAL_TILE, 'a valid 64-char string is kept verbatim');
  assert.equal(project.sprites.playerParts[1].tile, BLANK_TILE, 'a wrong-length string falls back to BLANK_TILE');
  assert.equal(project.sprites.playerParts[2].tile, BLANK_TILE, 'a missing tile falls back to BLANK_TILE');
});

test('normalizePlayerPart: category is trimmed and whitespace-collapsed the same way authorName normalizes every other free-text field', () => {
  const raw = { project: { name: 'T' }, sprites: { playerParts: [{ category: '  Torso   art  ' }] } };
  const project = normalizeProject(raw);
  assert.equal(project.sprites.playerParts[0].category, 'Torso art');
});

test('normalizePlayerPart: direction/frameSlot/quadrant each fall back to their documented default when invalid or missing', () => {
  const raw = {
    project: { name: 'T' },
    sprites: {
      playerParts: [
        { direction: 'sideways', frameSlot: 'nope', quadrant: 'middle' },
        {} // every field missing
      ]
    }
  };
  const project = normalizeProject(raw);
  for (const part of project.sprites.playerParts) {
    assert.equal(part.direction, 'down');
    assert.equal(part.frameSlot, 'both');
    assert.equal(part.quadrant, 'TL');
  }
});

test('normalizePlayerPart: a valid direction/frameSlot/quadrant is preserved, not just the fallback path', () => {
  const raw = {
    project: { name: 'T' },
    sprites: { playerParts: [{ direction: 'left', frameSlot: '1', quadrant: 'BR' }] }
  };
  const project = normalizeProject(raw);
  const part = project.sprites.playerParts[0];
  assert.equal(part.direction, 'left');
  assert.equal(part.frameSlot, '1');
  assert.equal(part.quadrant, 'BR');
});

test('normalizePlayerPart: name falls back to "Part {id}" the same way every other named record in this file does', () => {
  const raw = { project: { name: 'T' }, sprites: { playerParts: [{}, { name: 'Left boot' }] } };
  const project = normalizeProject(raw);
  assert.equal(project.sprites.playerParts[0].name, 'Part 0');
  assert.equal(project.sprites.playerParts[1].name, 'Left boot');
});

test('normalizePlayerPart: the parts list is sliced at LIMITS.playerParts, matching normalizeCommonEvents\' own precedent', () => {
  const raw = {
    project: { name: 'T' },
    sprites: { playerParts: Array.from({ length: LIMITS.playerParts + 5 }, (_, i) => ({ name: `Part ${i}` })) }
  };
  const project = normalizeProject(raw);
  assert.equal(project.sprites.playerParts.length, 256, 'the literal cap, not a value derived from LIMITS.playerParts itself');
  assert.equal(project.sprites.playerParts.length, LIMITS.playerParts);
  assert.equal(project.sprites.playerParts[0].name, 'Part 0');
  assert.equal(project.sprites.playerParts[LIMITS.playerParts - 1].name, `Part ${LIMITS.playerParts - 1}`);
});

test('normalizePlayerPart: normalized ids are positional, overwriting whatever raw id each entry carried', () => {
  const raw = {
    project: { name: 'T' },
    sprites: { playerParts: [{ id: 9, name: 'A' }, { id: 9, name: 'B' }, { id: 9, name: 'C' }] }
  };
  const project = normalizeProject(raw);
  assert.deepEqual(
    project.sprites.playerParts.map((p) => p.id),
    [0, 1, 2],
    'id is assigned by array position at normalization time, never trusted from raw input'
  );
  assert.deepEqual(project.sprites.playerParts.map((p) => p.name), ['A', 'B', 'C']);
});

test('normalizePlayerPart: an empty-string name falls back to "Part {id}", matching the other named records', () => {
  const raw = { project: { name: 'T' }, sprites: { playerParts: [{ name: '' }] } };
  const project = normalizeProject(raw);
  assert.equal(project.sprites.playerParts[0].name, 'Part 0');
});

// --- normalizePlayerTiles (via normalizeProject) ----------------------------

test('normalizePlayerTiles: always exactly PLAYER_TILES entries, from an array shorter or longer than that', () => {
  const short = normalizeProject({
    project: { name: 'T' },
    sprites: { playerTiles: [REAL_TILE] }
  });
  assert.equal(short.sprites.playerTiles.length, PLAYER_TILES);
  assert.equal(short.sprites.playerTiles[0], REAL_TILE);
  assert.equal(short.sprites.playerTiles[1], null, 'a slot the input never reached is null, not BLANK_TILE');

  const long = normalizeProject({
    project: { name: 'T' },
    sprites: { playerTiles: Array(PLAYER_TILES + 10).fill(REAL_TILE) }
  });
  assert.equal(long.sprites.playerTiles.length, PLAYER_TILES);
});

test('normalizePlayerTiles: a wrong-length string, a number, and undefined each degrade to null, never BLANK_TILE', () => {
  const raw = {
    project: { name: 'T' },
    sprites: { playerTiles: ['short', 42, undefined, REAL_TILE] }
  };
  const project = normalizeProject(raw);
  assert.equal(project.sprites.playerTiles[0], null);
  assert.equal(project.sprites.playerTiles[1], null);
  assert.equal(project.sprites.playerTiles[2], null);
  assert.equal(project.sprites.playerTiles[3], REAL_TILE);
});

test('normalizePlayerTiles: a non-string of length 64 (an array, or an object with length: 64) degrades to null, not treated as a 64-character tile', () => {
  const arrayOfLength64 = Array.from({ length: TILE_PIXELS }, () => '0');
  const objectWithLength64 = { length: TILE_PIXELS };
  const raw = {
    project: { name: 'T' },
    sprites: { playerTiles: [arrayOfLength64, objectWithLength64] }
  };
  const project = normalizeProject(raw);
  assert.equal(project.sprites.playerTiles[0], null, 'an array is not a string, regardless of its own length');
  assert.equal(project.sprites.playerTiles[1], null, 'an object with a length property is not a string either');
});

test('normalizePlayerTiles: a literal null entry survives as null, and a literal BLANK_TILE entry survives as BLANK_TILE, not coerced to each other', () => {
  const raw = {
    project: { name: 'T' },
    sprites: { playerTiles: [null, BLANK_TILE] }
  };
  const project = normalizeProject(raw);
  assert.equal(project.sprites.playerTiles[0], null);
  assert.equal(project.sprites.playerTiles[1], BLANK_TILE);
});

test('normalizePlayerTiles migration, branch A: tileset 0 entirely blank and no playerTiles field migrates to all null', () => {
  const raw = { project: { name: 'T' } }; // no tilesets field at all -> a fresh, blank tileset 0
  const project = normalizeProject(raw);
  assert.equal(project.sprites.playerTiles.length, PLAYER_TILES);
  assert.ok(project.sprites.playerTiles.every((tile) => tile === null), 'an untouched project keeps showing the placeholder on every slot');
});

test('normalizePlayerTiles migration, branch B: real content among tileset 0\'s first 32 sprite tiles migrates every slot as its literal string, including a planted BLANK_TILE surviving as the literal string, not null', () => {
  const tiles = Array(LIMITS.tilesPerTable).fill(BLANK_TILE);
  tiles[0] = REAL_TILE; // real, deliberate content
  tiles[5] = BLANK_TILE; // planted blank sitting *among* real content -- the fixture §7 calls out by name
  const raw = {
    project: { name: 'T' },
    tilesets: [{ id: 0, name: 'Main', background: { tiles: Array(LIMITS.tilesPerTable).fill(BLANK_TILE) }, sprites: { tiles } }]
  };
  const project = normalizeProject(raw);
  assert.equal(project.sprites.playerTiles[0], REAL_TILE);
  assert.equal(
    project.sprites.playerTiles[5],
    BLANK_TILE,
    'a blank tile sitting among real content is already treated as deliberate content today, and must not be coerced to null'
  );
  for (let i = 0; i < PLAYER_TILES; i++) {
    assert.notEqual(project.sprites.playerTiles[i], null, `slot ${i} must migrate as its literal string, not null`);
  }
});

test('normalizePlayerTiles migration, branch B with the first real tile away from index 0: real content at 17 and 31, a planted blank at 5, every slot migrates as its literal string -- a tile-0-only heuristic must fail this', () => {
  const tiles = Array(LIMITS.tilesPerTable).fill(BLANK_TILE);
  tiles[17] = REAL_TILE; // real content, but not at index 0
  tiles[31] = REAL_TILE; // a second real tile, at the very last player slot
  tiles[5] = BLANK_TILE; // planted blank sitting among real content, away from either real tile
  const raw = {
    project: { name: 'T' },
    tilesets: [{ id: 0, name: 'Main', background: { tiles: Array(LIMITS.tilesPerTable).fill(BLANK_TILE) }, sprites: { tiles } }]
  };
  const project = normalizeProject(raw);
  assert.equal(project.sprites.playerTiles[17], REAL_TILE);
  assert.equal(project.sprites.playerTiles[31], REAL_TILE);
  assert.equal(
    project.sprites.playerTiles[5],
    BLANK_TILE,
    'the planted blank must survive as the literal string even though the real content it sits among is nowhere near index 0'
  );
  for (let i = 0; i < PLAYER_TILES; i++) {
    assert.notEqual(project.sprites.playerTiles[i], null, `slot ${i} must migrate as its literal string, not null`);
  }
});

test('normalizePlayerTiles migration reads only tileset 0: a second tileset with real content at 0-31 does not change the result', () => {
  const tileset0 = Array(LIMITS.tilesPerTable).fill(BLANK_TILE); // entirely blank
  const tileset1 = Array(LIMITS.tilesPerTable).fill(BLANK_TILE);
  tileset1[0] = REAL_TILE; // real content, but on the *second* tileset
  const raw = {
    project: { name: 'T' },
    tilesets: [
      { id: 0, name: 'Main', background: { tiles: Array(LIMITS.tilesPerTable).fill(BLANK_TILE) }, sprites: { tiles: tileset0 } },
      { id: 1, name: 'Second', background: { tiles: Array(LIMITS.tilesPerTable).fill(BLANK_TILE) }, sprites: { tiles: tileset1 } }
    ]
  };
  const project = normalizeProject(raw);
  assert.ok(
    project.sprites.playerTiles.every((tile) => tile === null),
    'tileset 0 alone is entirely blank, so migration must reproduce "untouched" regardless of tileset 1'
  );
});

test('once playerTiles is present in the input, the migration does not run even when tileset 0 holds real content', () => {
  const tiles = Array(LIMITS.tilesPerTable).fill(BLANK_TILE);
  tiles[0] = REAL_TILE;
  const raw = {
    project: { name: 'T' },
    tilesets: [{ id: 0, name: 'Main', background: { tiles: Array(LIMITS.tilesPerTable).fill(BLANK_TILE) }, sprites: { tiles } }],
    sprites: { playerTiles: Array(PLAYER_TILES).fill(null) }
  };
  const project = normalizeProject(raw);
  assert.ok(
    project.sprites.playerTiles.every((tile) => tile === null),
    'an explicit all-null playerTiles array is authoritative and must not be overwritten by the migration'
  );
});

// --- storageIndex / quadrantIndex (design-modular-parts.md §1.5) -----------

test('storageIndex resolves a frame\'s 2x2 view to [base, base+1, base+2, base+3] for every frame and quadrant, unlike the sheet\'s own 16-column regionTiles() answer for the same nominal region', () => {
  for (let frame = 0; frame < PLAYER_FRAMES; frame++) {
    const base = frame * 4;
    const expectedByQuadrant = { TL: base, TR: base + 1, BL: base + 2, BR: base + 3 };
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const quadrant = QUADRANT_ORDER[quadrantIndex(row, col)];
        assert.equal(storageIndex(frame, row, col), expectedByQuadrant[quadrant], `frame ${frame} (${row},${col})`);
      }
    }
  }

  // Negative case: this is the direct regression test for §1.5's own defect.
  // regionTiles() (renderer/forges/tile/tile.js) computes, for a 2x2 region at
  // sheet index 0, (row + ry) * SHEET_COLS + col + rx over the sheet's fixed
  // 16-column grid -- [0, 1, 16, 17] -- which is NOT what storageIndex(0, ...)
  // returns for the identical nominal "2x2 region at tile 0."
  const SHEET_COLS = 16;
  const sheetRegionTiles = [];
  for (let ry = 0; ry < 2; ry++) {
    for (let rx = 0; rx < 2; rx++) sheetRegionTiles.push((0 + ry) * SHEET_COLS + 0 + rx);
  }
  assert.deepEqual(sheetRegionTiles, [0, 1, 16, 17]);

  const storageRegion = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) storageRegion.push(storageIndex(0, row, col));
  }
  assert.deepEqual(storageRegion, [0, 1, 2, 3]);
  assert.notDeepEqual(storageRegion, sheetRegionTiles, 'storageIndex must not agree with the sheet\'s mismatched 16-column mapping');
});

// --- renumberPlayerPartDeletion ---------------------------------------------

// Round-2 hardening: the front and back indices are each their own edge
// case (index 0 has no predecessor to shift; the last index has no
// successor), so the middle-only fixture the first draft of this test used
// could not have caught a bug specific to either end.
const PLAYER_PART_DELETION_FIXTURES = [
  { id: 0, name: 'A', category: 'head', direction: 'down', frameSlot: '0', quadrant: 'TL', tile: REAL_TILE },
  { id: 1, name: 'B', category: 'torso', direction: 'up', frameSlot: '1', quadrant: 'TR', tile: BLANK_TILE },
  { id: 2, name: 'C', category: 'legs', direction: 'left', frameSlot: 'both', quadrant: 'BL', tile: '2'.repeat(TILE_PIXELS) }
];

for (const [label, index] of [['the first', 0], ['the middle', 1], ['the last', 2]]) {
  test(`renumberPlayerPartDeletion: deleting ${label} of three parts renumbers survivors by position with every field intact, and nothing else in the project moves`, () => {
    const project = createProject('T');
    project.sprites.playerParts = PLAYER_PART_DELETION_FIXTURES.map((part) => ({ ...part }));
    const before = structuredClone(project);
    const expectedSurvivors = PLAYER_PART_DELETION_FIXTURES.filter((_, i) => i !== index).map((part, position) => ({
      ...part,
      id: position
    }));

    renumberPlayerPartDeletion(project, index);

    assert.deepEqual(
      project.sprites.playerParts,
      expectedSurvivors,
      'every field of a surviving record must be intact, not just id/name -- only the id shifts down'
    );

    delete before.sprites.playerParts;
    const after = structuredClone(project);
    delete after.sprites.playerParts;
    assert.deepEqual(after, before, 'nothing outside project.sprites.playerParts may move -- a part is never referenced elsewhere');
  });
}

// --- createProject() round-trips through normalizeProject unchanged --------

test('createProject() round-trips through normalizeProject with playerParts/playerTiles unchanged', () => {
  const project = createProject('Fresh');
  assert.deepEqual(project.sprites.playerParts, []);
  assert.deepEqual(project.sprites.playerTiles, Array(PLAYER_TILES).fill(null));
  const roundTripped = normalizeProject(project);
  assert.deepEqual(roundTripped.sprites.playerParts, []);
  assert.deepEqual(roundTripped.sprites.playerTiles, Array(PLAYER_TILES).fill(null));
});

// --- saveProject/loadProject round-trip -------------------------------------

test('saveProject/loadProject round-trips playerParts and playerTiles, null entries included', async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-playerparts-io-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const project = createProject('Roundtrip');
  project.sprites.playerParts = [
    { id: 0, name: 'Head', category: 'head gear', direction: 'up', frameSlot: '1', quadrant: 'BR', tile: REAL_TILE }
  ];
  project.sprites.playerTiles[0] = REAL_TILE;
  // index 1 stays null -- must survive as literal null through a JSON round trip.

  await saveProject(dir, project);
  const loaded = await loadProject(dir);

  assert.equal(loaded.sprites.playerParts.length, 1);
  assert.equal(loaded.sprites.playerParts[0].name, 'Head');
  assert.equal(loaded.sprites.playerParts[0].category, 'head gear');
  assert.equal(loaded.sprites.playerParts[0].direction, 'up');
  assert.equal(loaded.sprites.playerParts[0].frameSlot, '1');
  assert.equal(loaded.sprites.playerParts[0].quadrant, 'BR');
  assert.equal(loaded.sprites.playerParts[0].tile, REAL_TILE);
  assert.equal(loaded.sprites.playerTiles[0], REAL_TILE);
  assert.equal(loaded.sprites.playerTiles[1], null, 'a null slot must survive the JSON round trip as null');
});

test('main/build/generate.js has no leftover const PLAYER_FRAMES/PLAYER_TILES of its own, and imports both from shared/project.js', () => {
  const text = fs.readFileSync(path.join(ROOT, 'main/build/generate.js'), 'utf8');
  assert.doesNotMatch(
    text,
    /\bconst PLAYER_FRAMES\b/,
    'a duplicate local definition would silently drift from shared/project.js’s own copy -- ' +
      'the ROM byte-identity test alone cannot see a duplicate definition left behind, only a value change'
  );
  assert.doesNotMatch(text, /\bconst PLAYER_TILES\b/);
  const importMatch = text.match(/import \{([\s\S]*?)\} from '\.\.\/\.\.\/shared\/project\.js';/);
  assert.ok(importMatch, 'expected exactly one import from shared/project.js to find the names in');
  const importedNames = importMatch[1];
  assert.match(importedNames, /\bPLAYER_FRAMES\b/, 'generate.js must import PLAYER_FRAMES from shared/project.js');
  assert.match(importedNames, /\bPLAYER_TILES\b/, 'generate.js must import PLAYER_TILES from shared/project.js');
});

// --- task 1: PLAYER_FRAMES/PLAYER_TILES moved to shared/, no behaviour change

test('sample/ builds a byte-identical ROM after PLAYER_FRAMES/PLAYER_TILES moved into shared/project.js', { skip: needsSample }, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-playertiles-move-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const rom = await fs.promises.readFile(built.romPath);
  assert.equal(rom.length, 40976, 'ROM size drifted from the pinned pre-move build of sample/');
  const hash = crypto.createHash('sha256').update(rom).digest('hex');
  assert.equal(
    hash,
    '0e638aaaecf871b0479e09513e12b47ef7d24fe433c3142fb3369cfcb53a5253',
    'moving PLAYER_FRAMES/PLAYER_TILES into shared/project.js is a single-writer move, not a behaviour ' +
      'change -- sample/ must assemble byte-for-byte identically to the pinned pre-move build (captured ' +
      'from this exact working tree, immediately before this move, by building createProject-free sample/)'
  );
});
