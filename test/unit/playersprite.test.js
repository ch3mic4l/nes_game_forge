// ROADMAP item 8 (modular parts), Phase 2: the generator core
// (planPlayerSprite/generatePlayerSpriteCore), the build-time per-slot stamp,
// and both import-path fixes (design-modular-parts.md §4, §7 phase 2). See
// test/unit/playerparts.test.js (Phase 1) for the schema/migration tests this
// file deliberately leaves alone. Mirrors that file's own imports/fixture
// shape, kept separate because it exercises a different phase.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProject,
  createTileset,
  planPlayerSprite,
  generatePlayerSpriteCore,
  playerSpriteCollisions,
  describePlayerSpritePlan,
  freeTileSlots,
  chrImportOverlap,
  DIRECTION_ORDER,
  QUADRANT_ORDER,
  PLAYER_TILES,
  LIMITS,
  storageIndex
} from '../../shared/project.js';
import { BLANK_TILE, TILE_PIXELS, TILE_BYTES, encodeTiles } from '../../shared/chr.js';
import { CHR_BANK_BYTES } from '../../shared/cartridge.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const hasSample = fs.existsSync(path.join(SAMPLE, 'project.json'));
const needsSample = !hasSample && 'run `npm run sample` first';

// --- shared fixtures ---------------------------------------------------------

/**
 * A distinct, valid (digits 0-3) 64-char tile string per small integer id --
 * `id`'s base-4 representation padded to TILE_PIXELS digits. Cheap to
 * generate, guaranteed unique for any ids this file actually uses, and never
 * collides with BLANK_TILE (all zeros) unless id is literally 0, which no
 * test relies on distinguishing from blank.
 */
function tileForId(id) {
  return id.toString(4).padStart(TILE_PIXELS, '0');
}

/** A minimal, unqualified part for one (direction, frameSlot, quadrant) slot. */
function part(id, direction, frameSlot, quadrant, tile = tileForId(id)) {
  return { id, name: `Part ${id}`, category: '', direction, frameSlot, quadrant, tile };
}

/**
 * A full, 32-part library -- one part per (direction, frameIndex, quadrant)
 * combination, in exactly storageIndex's own traversal order, so partId `i`
 * is also the storage index it will land at once generated. Covers all 8
 * frames, used by the lifecycle-gap and capacity-neutrality tests, which
 * both want a fully-composed (no `null` slots) player.
 */
function buildFullPlayerParts() {
  const parts = [];
  const picks = [];
  let id = 0;
  for (const direction of DIRECTION_ORDER) {
    for (let frameIndex = 0; frameIndex < 2; frameIndex++) {
      for (const quadrant of QUADRANT_ORDER) {
        const partId = id++;
        parts.push(part(partId, direction, String(frameIndex), quadrant));
        picks.push({ direction, frameIndex, quadrant, partId });
      }
    }
  }
  return { parts, picks };
}

/** The 16 CHR bytes for sprite-table tile `index` inside a whole `tilesN.chr` buffer. */
function spriteTileBytes(chrBuffer, index) {
  const base = CHR_BANK_BYTES / 2 + index * TILE_BYTES;
  return chrBuffer.subarray(base, base + TILE_BYTES);
}

/** saveProject + buildProject into a fresh mkdtemp dir, per this file's own ground rules. */
async function buildInDir(t, mutate, log = () => {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-playersprite-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  mutate(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log });
  return { dir, project, built };
}

// --- 1. Composition correctness ---------------------------------------------

test('planPlayerSprite/generatePlayerSpriteCore: a representative spread of picks (every direction, both frame indices, all four quadrants) lands the right part.tile at the right storage index and leaves every other slot untouched', () => {
  const project = createProject('T');
  const frames = [
    ['down', 0],
    ['up', 1],
    ['left', 0],
    ['right', 1]
  ];
  const parts = [];
  const picks = [];
  let id = 0;
  for (const [direction, frameIndex] of frames) {
    for (const quadrant of QUADRANT_ORDER) {
      const partId = id++;
      parts.push(part(partId, direction, String(frameIndex), quadrant));
      picks.push({ direction, frameIndex, quadrant, partId });
    }
  }
  project.sprites.playerParts = parts;

  const before = [...project.sprites.playerTiles];
  const result = generatePlayerSpriteCore(project, picks);

  assert.equal(result.skipped.length, 0, 'every frame here is fully picked and must pass');
  assert.equal(result.written.length, 4);
  for (const [direction, frameIndex] of frames) {
    assert.ok(result.written.some((w) => w.direction === direction && w.frameIndex === frameIndex));
  }

  for (const pick of picks) {
    const quadrantIdx = QUADRANT_ORDER.indexOf(pick.quadrant);
    const frame = DIRECTION_ORDER.indexOf(pick.direction) * 2 + pick.frameIndex;
    const index = storageIndex(frame, Math.floor(quadrantIdx / 2), quadrantIdx % 2);
    assert.equal(project.sprites.playerTiles[index], tileForId(pick.partId), `storage index ${index}`);
  }

  const writtenIndices = new Set(result.indices);
  for (let i = 0; i < PLAYER_TILES; i++) {
    if (!writtenIndices.has(i)) assert.equal(project.sprites.playerTiles[i], before[i], `slot ${i} must be untouched`);
  }
});

// --- 2. BLANK_TILE survives as the literal string ---------------------------

test('generatePlayerSpriteCore: a picked part whose tile is BLANK_TILE lands in playerTiles as the literal string, not null', () => {
  const project = createProject('T');
  const direction = 'down';
  const frameIndex = 0;
  project.sprites.playerParts = [
    part(0, direction, String(frameIndex), 'TL'),
    part(1, direction, String(frameIndex), 'TR'),
    part(2, direction, String(frameIndex), 'BL'),
    part(3, direction, String(frameIndex), 'BR', BLANK_TILE)
  ];
  const picks = QUADRANT_ORDER.map((quadrant, i) => ({ direction, frameIndex, quadrant, partId: i }));

  const result = generatePlayerSpriteCore(project, picks);
  assert.equal(result.skipped.length, 0);

  const brQuadrantIdx = QUADRANT_ORDER.indexOf('BR');
  const frame = DIRECTION_ORDER.indexOf(direction) * 2 + frameIndex;
  const brIndex = storageIndex(frame, Math.floor(brQuadrantIdx / 2), brQuadrantIdx % 2);
  assert.equal(project.sprites.playerTiles[brIndex], BLANK_TILE);
  assert.notEqual(project.sprites.playerTiles[brIndex], null, 'a deliberately blank quadrant is generated content, not "ungenerated"');
});

// --- 3. Partial-frame atomicity ----------------------------------------------

test('generatePlayerSpriteCore/planPlayerSprite: partial-frame atomicity -- 1, 2 or 3 quadrants picked leaves all 4 slots untouched and is reported skipped with the missing quadrants; a pick naming the wrong direction, the wrong frameSlot, or a nonexistent partId is also skipped whole', () => {
  const direction = 'down';
  const frameIndex = 0;
  const frame = DIRECTION_ORDER.indexOf(direction) * 2 + frameIndex;
  const slotIndex = (quadrant) => {
    const q = QUADRANT_ORDER.indexOf(quadrant);
    return storageIndex(frame, Math.floor(q / 2), q % 2);
  };

  // --- 1/2/3-of-4 quadrants: whole frame refused, all 4 slots untouched.
  for (const picked of [['TL'], ['TL', 'TR'], ['TL', 'TR', 'BL']]) {
    const project = createProject('T');
    project.sprites.playerParts = QUADRANT_ORDER.map((quadrant, i) => part(i, direction, String(frameIndex), quadrant));
    // Seed with distinguishable content so "untouched" is a real assertion,
    // not merely "still null."
    for (const quadrant of QUADRANT_ORDER) project.sprites.playerTiles[slotIndex(quadrant)] = tileForId(900 + QUADRANT_ORDER.indexOf(quadrant));
    const sentinel = [...project.sprites.playerTiles];

    const picks = picked.map((quadrant) => ({ direction, frameIndex, quadrant, partId: QUADRANT_ORDER.indexOf(quadrant) }));
    const result = generatePlayerSpriteCore(project, picks);

    assert.equal(result.written.length, 0, `${picked.length} of 4 quadrants must not pass`);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].direction, direction);
    assert.equal(result.skipped[0].frameIndex, frameIndex);
    const missing = QUADRANT_ORDER.filter((q) => !picked.includes(q));
    assert.deepEqual([...result.skipped[0].quadrants].sort(), [...missing].sort(), 'skipped must name the missing quadrants');
    assert.deepEqual(project.sprites.playerTiles, sentinel, `${picked.length}-of-4 must leave all 4 slots exactly as they were`);
  }

  // --- All 4 quadrants "picked," but one names a part that cannot qualify.
  const badCases = {
    'wrong direction': part(0, 'up', String(frameIndex), 'TL'), // part is for 'up', frame is 'down'
    'wrong frameSlot': part(0, direction, '1', 'TL'), // part only qualifies for frame 1
    'nonexistent partId': null // no part 0 at all
  };
  for (const [label, badPart] of Object.entries(badCases)) {
    const project = createProject('T');
    project.sprites.playerParts = [
      badPart ?? { id: 999, name: 'unused' }, // placeholder so index 0 exists but partId 0 is still bad when badPart is null
      part(1, direction, String(frameIndex), 'TR'),
      part(2, direction, String(frameIndex), 'BL'),
      part(3, direction, String(frameIndex), 'BR')
    ];
    const picks = [
      { direction, frameIndex, quadrant: 'TL', partId: badPart ? 0 : 999 }, // 999: genuinely nonexistent
      { direction, frameIndex, quadrant: 'TR', partId: 1 },
      { direction, frameIndex, quadrant: 'BL', partId: 2 },
      { direction, frameIndex, quadrant: 'BR', partId: 3 }
    ];
    const result = generatePlayerSpriteCore(project, picks);
    assert.equal(result.written.length, 0, label);
    assert.equal(result.skipped.length, 1, label);
    assert.deepEqual(result.skipped[0].quadrants, ['TL'], label);
    assert.ok(
      QUADRANT_ORDER.every((quadrant) => project.sprites.playerTiles[slotIndex(quadrant)] === null),
      `${label}: a fully-picked-but-disqualified frame must still write nothing`
    );
  }
});

// --- 4. Independence between frames in one call ------------------------------

test('generatePlayerSpriteCore: a passing frame and a failing frame in the same call do not affect each other -- the failing frame comes first, so an implementation that stops after the first failure cannot pass this by accident', () => {
  const project = createProject('T');
  project.sprites.playerParts = [
    part(0, 'down', 'both', 'TL'),
    part(1, 'down', 'both', 'TR'),
    part(2, 'down', 'both', 'BL'),
    part(3, 'down', 'both', 'BR'),
    part(4, 'up', 'both', 'TL') // only quadrant offered for 'up' -- that frame will fail
  ];
  // Round 2 hardening: 'up' (the failing frame) is listed BEFORE 'down' (the
  // passing frame) -- the review's own residual sabotage list named an
  // implementation that stops evaluating after the first failed frame,
  // which this ordering catches and the original down-then-up ordering did
  // not.
  const picks = [
    { direction: 'up', frameIndex: 0, quadrant: 'TL', partId: 4 },
    { direction: 'down', frameIndex: 0, quadrant: 'TL', partId: 0 },
    { direction: 'down', frameIndex: 0, quadrant: 'TR', partId: 1 },
    { direction: 'down', frameIndex: 0, quadrant: 'BL', partId: 2 },
    { direction: 'down', frameIndex: 0, quadrant: 'BR', partId: 3 }
  ];

  const result = generatePlayerSpriteCore(project, picks);
  assert.deepEqual(result.written, [{ direction: 'down', frameIndex: 0 }]);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].direction, 'up');

  const downFrame = DIRECTION_ORDER.indexOf('down') * 2;
  for (let q = 0; q < 4; q++) {
    assert.equal(project.sprites.playerTiles[storageIndex(downFrame, Math.floor(q / 2), q % 2)], tileForId(q));
  }
  const upFrame = DIRECTION_ORDER.indexOf('up') * 2;
  for (let q = 0; q < 4; q++) {
    assert.equal(project.sprites.playerTiles[storageIndex(upFrame, Math.floor(q / 2), q % 2)], null, 'the failing frame must remain untouched');
  }
});

// --- 5. Touches nothing but playerTiles --------------------------------------

test('generatePlayerSpriteCore touches nothing but project.sprites.playerTiles', () => {
  const project = createProject('T');
  project.sprites.playerParts = QUADRANT_ORDER.map((quadrant, i) => part(i, 'down', 'both', quadrant));
  const picks = QUADRANT_ORDER.map((quadrant, i) => ({ direction: 'down', frameIndex: 0, quadrant, partId: i }));

  const before = structuredClone(project);
  generatePlayerSpriteCore(project, picks);
  const after = structuredClone(project);
  // Round 2 hardening: length is asserted BEFORE the field is deleted for the
  // rest-of-project comparison below -- deleting it first (as the original
  // draft did) would let an implementation that appends extra entries pass
  // unnoticed, since a deleted field can never disagree with another deleted
  // field.
  assert.equal(after.sprites.playerTiles.length, 32, 'playerTiles must stay exactly 32 entries, never grow');
  delete before.sprites.playerTiles;
  delete after.sprites.playerTiles;
  assert.deepEqual(after, before, 'nothing outside playerTiles may change');
});

// --- 6. Build-time placeholder fallback, per slot, across tilesets ----------

test(
  'build-time stamping: a null slot resolves to the placeholder, a real slot to its own tile, a BLANK_TILE slot to genuine transparency -- identically on every tileset',
  { skip: needsSample },
  async (t) => {
    const mutateBase = (project) => {
      project.cartridge.mapper = 3; // CNROM: room for more than one tileset
      project.tilesets.push(createTileset(1, 'Second'));
    };

    // Reference build: playerTiles left entirely null (no picks at all) --
    // whatever CHR bytes come out here ARE "the placeholder," for this test's
    // purposes, on both tilesets alike.
    const reference = await buildInDir(t, mutateBase);
    const refChr0 = await fs.promises.readFile(path.join(reference.dir, 'build/assets/tiles0.chr'));
    const refChr1 = await fs.promises.readFile(path.join(reference.dir, 'build/assets/tiles1.chr'));

    const realIndex = 3;
    const blankIndex = 7;
    const realTile = tileForId(555);
    const fixture = await buildInDir(t, (project) => {
      mutateBase(project);
      project.sprites.playerTiles[realIndex] = realTile;
      project.sprites.playerTiles[blankIndex] = BLANK_TILE;
    });
    const chr0 = await fs.promises.readFile(path.join(fixture.dir, 'build/assets/tiles0.chr'));
    const chr1 = await fs.promises.readFile(path.join(fixture.dir, 'build/assets/tiles1.chr'));

    for (const [chr, refChr, label] of [
      [chr0, refChr0, 'tileset 0'],
      [chr1, refChr1, 'tileset 1']
    ]) {
      for (let i = 0; i < PLAYER_TILES; i++) {
        const actual = [...spriteTileBytes(chr, i)];
        if (i === realIndex) {
          assert.deepEqual(actual, [...encodeTiles([realTile])], `${label} slot ${i} must hold the real tile`);
        } else if (i === blankIndex) {
          assert.deepEqual(actual, new Array(TILE_BYTES).fill(0), `${label} slot ${i} must be genuinely transparent`);
        } else {
          assert.deepEqual(actual, [...spriteTileBytes(refChr, i)], `${label} slot ${i} must match the placeholder reference build`);
        }
      }
    }
  }
);

// --- 7. Lifecycle-gap regression ---------------------------------------------

test(
  'lifecycle-gap regression: generate a full player, build, add a new tileset, build again -- the new tileset\'s indices 0-31 hold the identical composed content, with no special-case code involved',
  { skip: needsSample },
  async (t) => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-playersprite-lifecycle-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

    const project = await loadProject(SAMPLE);
    project.cartridge.mapper = 3; // CNROM: room to add a tileset later
    const { parts, picks } = buildFullPlayerParts();
    project.sprites.playerParts = parts;
    const plan = generatePlayerSpriteCore(project, picks);
    assert.equal(plan.skipped.length, 0, 'the full 32-part library must compose every frame');

    await saveProject(dir, project);
    await buildProject({ dir, project, log: () => {} });
    const chr0First = await fs.promises.readFile(path.join(dir, 'build/assets/tiles0.chr'));

    project.tilesets.push(createTileset(1, 'Added later'));
    await saveProject(dir, project);
    await buildProject({ dir, project, log: () => {} });
    const chr0Second = await fs.promises.readFile(path.join(dir, 'build/assets/tiles0.chr'));
    const chr1Second = await fs.promises.readFile(path.join(dir, 'build/assets/tiles1.chr'));

    for (let i = 0; i < PLAYER_TILES; i++) {
      assert.deepEqual(
        [...spriteTileBytes(chr0Second, i)],
        [...spriteTileBytes(chr0First, i)],
        `tileset 0 slot ${i} must be unaffected by adding a later tileset`
      );
      assert.deepEqual(
        [...spriteTileBytes(chr1Second, i)],
        [...spriteTileBytes(chr0Second, i)],
        `the brand-new tileset's slot ${i} must hold the identical composed content, with no special-case code`
      );
    }
  }
);

// --- 8. Divergence warning ----------------------------------------------------

test(
  'build-time stamping: the divergence warning fires exactly once per divergent tileset naming its index and the right count, and does not fire for a blank target or a tileset that already matches',
  { skip: needsSample },
  async (t) => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-playersprite-divergence-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

    const project = await loadProject(SAMPLE);
    project.cartridge.mapper = 3; // CNROM
    project.tilesets.push(createTileset(1, 'Divergent'), createTileset(2, 'Matching'));

    project.sprites.playerTiles[10] = tileForId(777);
    project.sprites.playerTiles[20] = tileForId(888);
    // tileset 0: left entirely blank (its default) -- every target slot here
    // starts blank, so no mismatch is ever counted.
    // tileset 1: index 10 pre-set to something ELSE (real mismatch); index 20
    // pre-set to exactly what the stamp will write (must not count).
    project.tilesets[1].sprites.tiles[10] = tileForId(778);
    project.tilesets[1].sprites.tiles[20] = tileForId(888);
    // tileset 2: both pre-set to exactly what the stamp will write -- no
    // mismatch anywhere in this tileset.
    project.tilesets[2].sprites.tiles[10] = tileForId(777);
    project.tilesets[2].sprites.tiles[20] = tileForId(888);

    await saveProject(dir, project);
    const logs = [];
    await buildProject({ dir, project, log: (message) => logs.push(message) });

    const warnings = logs.filter((line) => line.startsWith('warning:') && line.includes("player's reserved range"));
    assert.equal(warnings.length, 1, `expected exactly one divergence warning, got: ${JSON.stringify(warnings)}`);
    assert.match(warnings[0], /tileset 1 \("Divergent"\)/, 'must name the divergent tileset by index and name');
    assert.ok(warnings[0].includes('has 1 tile(s) in'), 'must name the right count -- 1, not 2, since index 20 already matched');
  }
);

// --- Round 2, finding 3: build never writes the stamp back into project data ---

test(
  'build never writes the per-slot player stamp back into project.tilesets[*].sprites.tiles -- only the build-time-local copy is touched',
  { skip: needsSample },
  async (t) => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-playersprite-nowriteback-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

    const project = await loadProject(SAMPLE);
    project.cartridge.mapper = 3; // CNROM: room for a second tileset
    project.tilesets.push(createTileset(1, 'Second'));
    // A representative spread: some null (placeholder), a real tile, and a
    // literal BLANK_TILE -- the same three cases test 6 already proves the
    // build-time CHR output for, checked here against project data instead.
    project.sprites.playerTiles[3] = tileForId(42);
    project.sprites.playerTiles[9] = BLANK_TILE;

    const before = structuredClone(project);
    await saveProject(dir, project);
    await buildProject({ dir, project, log: () => {} });
    const after = structuredClone(project);

    assert.deepEqual(after, before, 'buildProject must never write the stamped content back into project data');
  }
);

// --- 9. NPC-collision preflight ------------------------------------------------

test('playerSpriteCollisions: fires for a metasprite referencing an index the pending plan will write, and not for one referencing only a skipped frame\'s indices', () => {
  const project = createProject('T');
  // left/frameIndex 1 -> frame 5 -> storage base 20 (indices 20-23). A
  // non-zero frame is deliberate (round 2 hardening): a collision check
  // hard-coded to indices 0-3 would pass an all-zero-frame fixture by
  // accident.
  project.sprites.metasprites = [
    { id: 0, name: 'Colliding', tiles: [{ x: 0, y: 0, tile: 20, palette: 0, hflip: false, vflip: false }] },
    { id: 1, name: 'Safe', tiles: [{ x: 0, y: 0, tile: 16, palette: 0, hflip: false, vflip: false }] }
  ];
  project.sprites.playerParts = QUADRANT_ORDER.map((quadrant, i) => part(i, 'left', '1', quadrant));
  // Only frame (left, 1) -- indices 20-23 -- is picked; frame (left, 0) --
  // indices 16-19, including metasprite "Safe"'s own index 16 -- is left
  // entirely unpicked and will be skipped.
  const picks = QUADRANT_ORDER.map((quadrant, i) => ({ direction: 'left', frameIndex: 1, quadrant, partId: i }));

  const plan = planPlayerSprite(project, picks);
  assert.deepEqual(plan.indices, [20, 21, 22, 23]);

  const collisions = playerSpriteCollisions(project, plan.indices);
  assert.equal(collisions.length, 1, 'only the metasprite referencing a to-be-written index should be reported');
  assert.equal(collisions[0].index, 0);
  assert.equal(collisions[0].name, 'Colliding');
  assert.deepEqual(collisions[0].tiles, [20]);
});

// --- 10. freeTileSlots ---------------------------------------------------------

// Inclusive integer range, used below to assert freeTileSlots' exact return
// value rather than a handful of `includes` spot-checks (round 3 review:
// `includes` alone tolerates a duplicated entry that would inflate the
// count without failing any prior assertion here).
function rangeArray(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

test('freeTileSlots: sprites excludes 0..31 even when blank; background does not; a non-blank tile is never free either way -- exact arrays', () => {
  const table = Array(LIMITS.tilesPerTable).fill(BLANK_TILE);
  table[0] = tileForId(1); // non-blank, inside the reserved range
  table[40] = tileForId(2); // non-blank, outside the reserved range

  const sprites = freeTileSlots(table, 'sprites');
  assert.deepEqual(sprites, rangeArray(32, LIMITS.tilesPerTable - 1).filter((i) => i !== 40));

  const background = freeTileSlots(table, 'background');
  assert.deepEqual(background, rangeArray(0, LIMITS.tilesPerTable - 1).filter((i) => i !== 0 && i !== 40));
});

// --- 11. chrImportOverlap -------------------------------------------------------

test('chrImportOverlap: 0 once start is past the reserved range, the full count when fully inside, the partial count when straddling 31/32, and 0 when count is 0', () => {
  assert.equal(chrImportOverlap(PLAYER_TILES, 5), 0, 'start >= PLAYER_TILES');
  assert.equal(chrImportOverlap(40, 5), 0);
  assert.equal(chrImportOverlap(0, 10), 10, 'fully inside');
  assert.equal(chrImportOverlap(0, PLAYER_TILES), PLAYER_TILES);
  assert.equal(chrImportOverlap(30, 5), 2, 'straddles 31/32: only 30 and 31 fall inside');
  assert.equal(chrImportOverlap(10, 0), 0, 'count 0');
});

// --- 12. Same-tree capacity neutrality ------------------------------------------

test(
  'same-tree capacity neutrality: playerTiles all null vs. a full 32-slot generation produce identical build/assets/ files except the .chr payloads themselves, with equal ROM sizes',
  { skip: needsSample },
  async (t) => {
    const dirNull = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-playersprite-neutral-null-'));
    const dirFull = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-playersprite-neutral-full-'));
    t.after(() => fs.promises.rm(dirNull, { recursive: true, force: true }));
    t.after(() => fs.promises.rm(dirFull, { recursive: true, force: true }));

    const nullProject = await loadProject(SAMPLE);
    await saveProject(dirNull, nullProject);
    const nullBuilt = await buildProject({ dir: dirNull, project: nullProject, log: () => {} });

    const fullProject = await loadProject(SAMPLE);
    const { parts, picks } = buildFullPlayerParts();
    fullProject.sprites.playerParts = parts;
    generatePlayerSpriteCore(fullProject, picks);
    await saveProject(dirFull, fullProject);
    const fullBuilt = await buildProject({ dir: dirFull, project: fullProject, log: () => {} });

    const nullFiles = (await fs.promises.readdir(path.join(dirNull, 'build/assets'))).sort();
    const fullFiles = (await fs.promises.readdir(path.join(dirFull, 'build/assets'))).sort();
    assert.deepEqual(fullFiles, nullFiles, 'no new or missing file may appear in build/assets/ either way');

    for (const name of nullFiles) {
      const isChrPayload = /^tiles\d+\.chr$/.test(name);
      const nullBuf = await fs.promises.readFile(path.join(dirNull, 'build/assets', name));
      const fullBuf = await fs.promises.readFile(path.join(dirFull, 'build/assets', name));
      if (isChrPayload) {
        assert.equal(fullBuf.length, nullBuf.length, `${name} must be the same size either way`);
      } else {
        assert.deepEqual([...fullBuf], [...nullBuf], `${name} must be byte-identical either way`);
      }
    }

    assert.equal(fullBuilt.size, nullBuilt.size, 'ROM sizes must be equal either way');
  }
);

// --- Round 2, finding 1: planPlayerSprite must validate every pick field ---

test('planPlayerSprite/generatePlayerSpriteCore: an invalid direction, quadrant, or frameIndex poisons its whole attempted frame -- no aliasing a real frame, no growing playerTiles past 32, and the frame is reported in skipped', () => {
  // Regression for the exact reported defect: four valid 'right' parts at
  // frameIndex: 2 used to compute storage indices 32-35 (past PLAYER_TILES)
  // and silently extend playerTiles to length 36.
  const overflowProject = createProject('T');
  overflowProject.sprites.playerParts = QUADRANT_ORDER.map((quadrant, i) => part(i, 'right', 'both', quadrant));
  const overflowPicks = QUADRANT_ORDER.map((quadrant, i) => ({ direction: 'right', frameIndex: 2, quadrant, partId: i }));
  const overflowResult = generatePlayerSpriteCore(overflowProject, overflowPicks);
  assert.equal(overflowProject.sprites.playerTiles.length, 32, 'playerTiles must never grow past 32');
  assert.equal(overflowResult.written.length, 0);
  assert.equal(overflowResult.indices.length, 0);
  assert.equal(overflowResult.skipped.length, 1);
  assert.match(overflowResult.skipped[0].reason, /frameIndex/);
  assert.ok(overflowProject.sprites.playerTiles.every((tile) => tile === null));

  // Regression for the other reported defect: 'down' at frameIndex: 2 used
  // to alias the real 'up'/0 frame's own storage indices
  // (DIRECTION_ORDER.indexOf('down') * 2 + 2 === DIRECTION_ORDER.indexOf('up') * 2 + 0).
  const aliasProject = createProject('T');
  aliasProject.sprites.playerParts = [
    ...QUADRANT_ORDER.map((quadrant, i) => part(i, 'down', 'both', quadrant)),
    ...QUADRANT_ORDER.map((quadrant, i) => part(4 + i, 'up', 'both', quadrant))
  ];
  const upFrame = DIRECTION_ORDER.indexOf('up') * 2;
  const upIndices = [0, 1, 2, 3].map((q) => storageIndex(upFrame, Math.floor(q / 2), q % 2));
  for (const index of upIndices) aliasProject.sprites.playerTiles[index] = tileForId(900 + index);
  const sentinel = [...aliasProject.sprites.playerTiles];
  const aliasPicks = QUADRANT_ORDER.map((quadrant, i) => ({ direction: 'down', frameIndex: 2, quadrant, partId: i }));
  const aliasResult = generatePlayerSpriteCore(aliasProject, aliasPicks);
  assert.equal(aliasResult.written.length, 0);
  assert.deepEqual(aliasProject.sprites.playerTiles, sentinel, "a bad frameIndex must never alias a real frame's storage indices");

  // The four bad-field cases the brief names, each in isolation: leaves
  // playerTiles length 32 and every slot untouched, and appears in skipped.
  //
  // Round 2 review finding: the first draft of this loop tagged every part
  // 'down'/'0' regardless of which field a case was poisoning, so a
  // mismatched pick (direction: 'sideways', say) was ALSO rejected by the
  // ordinary qualification check (part.direction === direction) even with
  // the field validation deleted outright -- confirmed by actually deleting
  // DIRECTION_ORDER.includes from groupPlayerSpritePicks and watching every
  // assertion here stay green. Each case below instead tags its parts with
  // the SAME bogus value the picks use (or a frameSlot of 'both', which
  // qualifies for any frameIndex) so that if its own validation line were
  // missing, the ordinary qualification check would have nothing left to
  // object to -- the frame would wrongly resolve (aliasing a real frame, or
  // indexing past PLAYER_TILES) rather than merely failing for a different,
  // masking reason. The `reason` string is asserted explicitly in every
  // case for the same reason: it is the one thing that still differs even
  // where a wrong resolution isn't observable at all (see the quadrant case
  // below).
  const badCases = [
    {
      label: 'frameIndex: 2',
      reason: 'invalid frameIndex',
      part: (quadrant, i) => part(i, 'down', 'both', quadrant),
      pick: (quadrant, i) => ({ direction: 'down', frameIndex: 2, quadrant, partId: i })
    },
    {
      label: "frameIndex: '0'",
      reason: 'invalid frameIndex',
      part: (quadrant, i) => part(i, 'down', 'both', quadrant),
      pick: (quadrant, i) => ({ direction: 'down', frameIndex: '0', quadrant, partId: i })
    },
    {
      label: "direction: 'sideways'",
      reason: 'invalid direction',
      part: (quadrant, i) => part(i, 'sideways', 'both', quadrant),
      pick: (quadrant, i) => ({ direction: 'sideways', frameIndex: 0, quadrant, partId: i })
    },
    {
      // A part's own `quadrant` tag is never read by resolvePlayerSpriteFrame
      // (only the pick's quadrant is, as the quadrants Map's key), so unlike
      // the other three, no tagging can make an out-of-QUADRANT_ORDER string
      // alias a real quadrant slot -- `written`/`indices` come out identical
      // whether or not this validation exists. The `reason` string is the
      // only real proof for this one: with the check, the frame is skipped
      // for "invalid quadrant"; without it, every real quadrant (TL/TR/BL/BR)
      // simply never finds a pick under 'TM' and the frame is skipped anyway,
      // but for the generic "quadrants have no resolved part" reason instead.
      label: "quadrant: 'TM'",
      reason: 'invalid quadrant',
      part: (quadrant, i) => part(i, 'down', '0', quadrant),
      pick: (quadrant, i) => ({ direction: 'down', frameIndex: 0, quadrant: 'TM', partId: i })
    }
  ];
  for (const { label, reason, part: buildPart, pick } of badCases) {
    const project = createProject('T');
    project.sprites.playerParts = QUADRANT_ORDER.map((quadrant, i) => buildPart(quadrant, i));
    const picks = QUADRANT_ORDER.map((quadrant, i) => pick(quadrant, i));
    const result = generatePlayerSpriteCore(project, picks);
    assert.equal(project.sprites.playerTiles.length, 32, label);
    assert.ok(project.sprites.playerTiles.every((tile) => tile === null), `${label}: every real slot must be untouched`);
    assert.equal(result.written.length, 0, label);
    assert.equal(result.skipped.length, 1, label);
    assert.equal(result.skipped[0].reason, reason, `${label}: the skip reason must name the invalid field`);
  }
});

// --- Round 3, finding 2: the typeof-discriminated group key --------------

test('planPlayerSprite/generatePlayerSpriteCore: a valid down/frameIndex:0 (number) frame and a bogus down/frameIndex:\'0\' (string) frame in the SAME call never merge into one group', () => {
  // Both frames' parts are tagged to plausibly qualify for 'down' (frameSlot
  // 'both') -- the round 2 lesson applied again: if the two groups were
  // wrongly merged by a plain `${direction}|${frameIndex}` key (where `0`
  // and `'0'` stringify the same), all 8 picks would land in one quadrants
  // Map, TL/TR/BL/BR would each see two conflicting partIds, and the
  // numeric-0 frame would itself be wrongly skipped as a conflict -- a
  // parts library tagged to mismatch would hide that the same way round 2's
  // masked cases did.
  const buildParts = () => [
    part(0, 'down', 'both', 'TL'),
    part(1, 'down', 'both', 'TR'),
    part(2, 'down', 'both', 'BL'),
    part(3, 'down', 'both', 'BR'),
    part(4, 'down', 'both', 'TL'),
    part(5, 'down', 'both', 'TR'),
    part(6, 'down', 'both', 'BL'),
    part(7, 'down', 'both', 'BR')
  ];
  const picks = [
    { direction: 'down', frameIndex: 0, quadrant: 'TL', partId: 0 },
    { direction: 'down', frameIndex: 0, quadrant: 'TR', partId: 1 },
    { direction: 'down', frameIndex: 0, quadrant: 'BL', partId: 2 },
    { direction: 'down', frameIndex: 0, quadrant: 'BR', partId: 3 },
    { direction: 'down', frameIndex: '0', quadrant: 'TL', partId: 4 },
    { direction: 'down', frameIndex: '0', quadrant: 'TR', partId: 5 },
    { direction: 'down', frameIndex: '0', quadrant: 'BL', partId: 6 },
    { direction: 'down', frameIndex: '0', quadrant: 'BR', partId: 7 }
  ];
  const expectedIndices = [0, 1, 2, 3]; // down/frameIndex:0 (number) -> frame 0 -> storage base 0

  const planProject = createProject('T');
  planProject.sprites.playerParts = buildParts();
  const planClone = structuredClone(planProject);
  const plan = planPlayerSprite(planProject, picks);
  assert.deepEqual(planProject, planClone, 'planPlayerSprite must not mutate its project argument');

  assert.deepEqual(plan.written, [{ direction: 'down', frameIndex: 0 }], 'only the numeric-0 frame may pass');
  assert.deepEqual(plan.indices, expectedIndices);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].direction, 'down');
  assert.equal(plan.skipped[0].frameIndex, '0', "the skipped entry must report the caller's own raw (string) frameIndex");
  assert.equal(plan.skipped[0].reason, 'invalid frameIndex');

  const genProject = createProject('T');
  genProject.sprites.playerParts = buildParts();
  const genResult = generatePlayerSpriteCore(genProject, picks);
  assert.deepEqual(genResult.written, plan.written);
  assert.deepEqual(genResult.skipped, plan.skipped);
  assert.deepEqual(genResult.indices, plan.indices);
  for (const index of expectedIndices) assert.equal(genProject.sprites.playerTiles[index], tileForId(index));
});

// --- Round 2, finding 5: unpinned contracts ---------------------------------

test('planPlayerSprite is pure: a project deep-clone is unchanged before/after a call whose picks would write real content if this were the mutating core', () => {
  const project = createProject('T');
  project.sprites.playerParts = QUADRANT_ORDER.map((quadrant, i) => part(i, 'down', 'both', quadrant));
  const picks = QUADRANT_ORDER.map((quadrant, i) => ({ direction: 'down', frameIndex: 0, quadrant, partId: i }));
  const before = structuredClone(project);
  const result = planPlayerSprite(project, picks);
  assert.equal(result.written.length, 1, 'the picks must be a real, passing frame -- otherwise purity is untested');
  assert.deepEqual(project, before, 'planPlayerSprite must never mutate its project argument');
});

test('planPlayerSprite: two picks for the same quadrant naming two DIFFERENT qualifying parts is a conflict (frame skipped, nothing written); naming the SAME part is not a conflict (frame passes)', () => {
  const conflictProject = createProject('T');
  conflictProject.sprites.playerParts = [
    part(0, 'down', 'both', 'TL'),
    part(1, 'down', 'both', 'TR'),
    part(2, 'down', 'both', 'BL'),
    part(3, 'down', 'both', 'BR'),
    part(4, 'down', 'both', 'TL') // a second, equally-qualifying part for the same quadrant
  ];
  const conflictPicks = [
    { direction: 'down', frameIndex: 0, quadrant: 'TL', partId: 0 },
    { direction: 'down', frameIndex: 0, quadrant: 'TL', partId: 4 },
    { direction: 'down', frameIndex: 0, quadrant: 'TR', partId: 1 },
    { direction: 'down', frameIndex: 0, quadrant: 'BL', partId: 2 },
    { direction: 'down', frameIndex: 0, quadrant: 'BR', partId: 3 }
  ];
  const conflictResult = planPlayerSprite(conflictProject, conflictPicks);
  assert.equal(conflictResult.written.length, 0, 'two different qualifying parts for one quadrant is a conflict, not a choice');
  assert.equal(conflictResult.skipped.length, 1);
  assert.ok(conflictResult.skipped[0].quadrants.includes('TL'));
  assert.deepEqual(conflictResult.indices, [], 'a conflicting frame contributes no indices at all');

  const dupProject = createProject('T');
  dupProject.sprites.playerParts = [
    part(0, 'down', 'both', 'TL'),
    part(1, 'down', 'both', 'TR'),
    part(2, 'down', 'both', 'BL'),
    part(3, 'down', 'both', 'BR')
  ];
  const dupPicks = [
    { direction: 'down', frameIndex: 0, quadrant: 'TL', partId: 0 },
    { direction: 'down', frameIndex: 0, quadrant: 'TL', partId: 0 }, // duplicate pick, same part
    { direction: 'down', frameIndex: 0, quadrant: 'TR', partId: 1 },
    { direction: 'down', frameIndex: 0, quadrant: 'BL', partId: 2 },
    { direction: 'down', frameIndex: 0, quadrant: 'BR', partId: 3 }
  ];
  const dupResult = planPlayerSprite(dupProject, dupPicks);
  assert.equal(dupResult.written.length, 1, 'a duplicate pick of the same part is not a conflict');
  assert.equal(dupResult.skipped.length, 0);
  // down/frameIndex 0 -> frame 0 -> storage base 0 (indices 0-3).
  assert.deepEqual(dupResult.indices, [0, 1, 2, 3], "a duplicate pick of the same part still writes the frame's own four indices");
});

test(
  'usedPlaceholder and its note: all-null reports true and names "32 of the 32"; a 4-real partial fill reports true and names "28 of the 32"; a full 32-slot generation reports false and no placeholder note at all',
  { skip: needsSample },
  async (t) => {
    async function buildVariant(mutate) {
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-playersprite-placeholder-'));
      t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
      const project = await loadProject(SAMPLE);
      mutate(project);
      await saveProject(dir, project);
      const logs = [];
      const built = await buildProject({ dir, project, log: (message) => logs.push(message) });
      return { built, logs };
    }

    // Round 3 review: an unanchored substring check ("32 of the 32") also
    // passes on a line reading "132 of the 32", so this filters to the note
    // line specifically and asserts it EQUALS the exact string the generator
    // emits, built from PLAYER_TILES rather than the literal 32 -- and
    // asserts there is exactly one such line, not merely "at least one".
    const placeholderNoteLines = (logs) => logs.filter((line) => line.startsWith('note:') && line.includes('player sprite slots used the placeholder'));
    const expectedPlaceholderNote = (count) => `note: ${count} of the ${PLAYER_TILES} player sprite slots used the placeholder.`;

    const allNull = await buildVariant(() => {});
    assert.equal(allNull.built.stats.usedPlaceholder, true);
    const allNullNotes = placeholderNoteLines(allNull.logs);
    assert.equal(allNullNotes.length, 1, JSON.stringify(allNull.logs));
    assert.equal(allNullNotes[0], expectedPlaceholderNote(32));

    const partial = await buildVariant((project) => {
      project.sprites.playerTiles[0] = tileForId(1);
      project.sprites.playerTiles[1] = tileForId(2);
      project.sprites.playerTiles[2] = tileForId(3);
      project.sprites.playerTiles[3] = tileForId(4);
    });
    assert.equal(partial.built.stats.usedPlaceholder, true);
    const partialNotes = placeholderNoteLines(partial.logs);
    assert.equal(partialNotes.length, 1, JSON.stringify(partial.logs));
    assert.equal(partialNotes[0], expectedPlaceholderNote(28));

    const none = await buildVariant((project) => {
      const { parts, picks } = buildFullPlayerParts();
      project.sprites.playerParts = parts;
      generatePlayerSpriteCore(project, picks);
    });
    assert.equal(none.built.stats.usedPlaceholder, false);
    assert.equal(placeholderNoteLines(none.logs).length, 0, JSON.stringify(none.logs));
  }
);

test('freeTileSlots on an all-blank table: sprites equals exactly [32 .. LIMITS.tilesPerTable-1], background equals exactly [0 .. LIMITS.tilesPerTable-1]', () => {
  const table = Array(LIMITS.tilesPerTable).fill(BLANK_TILE);
  const sprites = freeTileSlots(table, 'sprites');
  assert.deepEqual(sprites, rangeArray(PLAYER_TILES, LIMITS.tilesPerTable - 1));

  const background = freeTileSlots(table, 'background');
  assert.deepEqual(background, rangeArray(0, LIMITS.tilesPerTable - 1));
});

// --- 13. The pinned sample/ hash test --------------------------------------
// Not a new test -- test/unit/playerparts.test.js's own
// "sample/ builds a byte-identical ROM after PLAYER_FRAMES/PLAYER_TILES moved
// into shared/project.js" already asserts this and runs unmodified as part of
// this same `node --test` invocation.

// --- 14. describePlayerSpritePlan (Phase 3, design-modular-parts.md §6.3) --
// Pure text formatting only -- the modal renders exactly these strings, so
// every branch is exercised directly against hand-built plan/collisions
// arguments rather than through a real pick list, matching this function's
// own doc comment ("collisions is computed by the caller, not here").

test('describePlayerSpritePlan: both frames of one direction -- "Facing X, both frames"', () => {
  const project = createProject('T');
  const plan = { written: [{ direction: 'down', frameIndex: 0 }, { direction: 'down', frameIndex: 1 }], skipped: [], indices: [0, 1, 2, 3, 4, 5, 6, 7] };
  const described = describePlayerSpritePlan(project, plan, []);
  assert.equal(described.changes, 'Facing down, both frames — nothing else is touched.');
});

test('describePlayerSpritePlan: one frame each of two different directions, in DIRECTION_ORDER order regardless of written\'s own order', () => {
  const project = createProject('T');
  // Deliberately out of DIRECTION_ORDER order (left before down) -- the
  // output must still read "down" before "left".
  const plan = { written: [{ direction: 'left', frameIndex: 1 }, { direction: 'down', frameIndex: 0 }], skipped: [], indices: [0, 1, 2, 3, 20, 21, 22, 23] };
  const described = describePlayerSpritePlan(project, plan, []);
  assert.equal(described.changes, 'Facing down (frame 1), facing left (frame 2) — nothing else is touched.');
});

test('describePlayerSpritePlan: a written frame naming only frameIndex 1 (never 0) reports "(frame 2)", not "(frame 1)"', () => {
  const project = createProject('T');
  const plan = { written: [{ direction: 'up', frameIndex: 1 }], skipped: [], indices: [4, 5, 6, 7] };
  const described = describePlayerSpritePlan(project, plan, []);
  assert.equal(described.changes, 'Facing up (frame 2) — nothing else is touched.');
});

test('describePlayerSpritePlan: nothing written -- "Nothing will be generated." and the "nothing generated" toast', () => {
  const project = createProject('T');
  const plan = { written: [], skipped: [{ direction: 'down', frameIndex: 0, reason: 'x', quadrants: ['TL'] }], indices: [] };
  const described = describePlayerSpritePlan(project, plan, []);
  assert.equal(described.changes, 'Nothing will be generated.');
  assert.equal(described.toast, 'Nothing was generated — no frame had all 4 quadrants picked.');
});

test('describePlayerSpritePlan: placeholder note -- generating both frames of one direction on an all-null project leaves the other 3 directions still placeholder', () => {
  const project = createProject('T');
  assert.ok(project.sprites.playerTiles.every((tile) => tile === null), 'a fresh project must start with every playerTiles slot null');
  // frame 0 = down/0 (indices 0-3), frame 1 = down/1 (indices 4-7) -- both of
  // "down"'s two frames, so "down" alone should no longer count as
  // placeholder while up/left/right (never touched) still do.
  const plan = { written: [{ direction: 'down', frameIndex: 0 }, { direction: 'down', frameIndex: 1 }], skipped: [], indices: [0, 1, 2, 3, 4, 5, 6, 7] };
  const described = describePlayerSpritePlan(project, plan, []);
  assert.equal(described.placeholder, '3 of 4 directions still use the placeholder look.');
});

test('describePlayerSpritePlan: placeholder note is absent once every slot the plan leaves behind is non-null', () => {
  const project = createProject('T');
  // Every direction already has real (non-null) content in every slot this
  // plan does NOT write, so nothing is still placeholder after it applies.
  project.sprites.playerTiles = project.sprites.playerTiles.map((_, i) => tileForId(i + 1));
  const plan = { written: [{ direction: 'down', frameIndex: 0 }], skipped: [], indices: [0, 1, 2, 3] };
  const described = describePlayerSpritePlan(project, plan, []);
  assert.equal(described.placeholder, null);
});

test('describePlayerSpritePlan: placeholder note is also absent for a fully-generated 8-frame plan even though playerTiles started all null -- indices, not the pre-plan array, decide', () => {
  const project = createProject('T');
  const { parts, picks } = buildFullPlayerParts();
  project.sprites.playerParts = parts;
  const plan = planPlayerSprite(project, picks);
  assert.equal(plan.written.length, 8);
  const described = describePlayerSpritePlan(project, plan, []);
  assert.equal(described.placeholder, null);
});

test('describePlayerSpritePlan: collisions text is absent for zero, singular for one, plural with every name for two or more', () => {
  const project = createProject('T');
  const plan = { written: [{ direction: 'down', frameIndex: 0 }], skipped: [], indices: [0, 1, 2, 3] };

  const none = describePlayerSpritePlan(project, plan, []);
  assert.equal(none.collisions, null);

  const one = describePlayerSpritePlan(project, plan, [{ index: 0, name: 'Slime', tiles: [1] }]);
  assert.equal(one.collisions, '1 metasprite (Slime) references a tile index inside this range and will look different after this.');

  const two = describePlayerSpritePlan(project, plan, [
    { index: 0, name: 'Slime', tiles: [1] },
    { index: 2, name: 'Chest', tiles: [2, 3] }
  ]);
  assert.equal(
    two.collisions,
    '2 metasprites (Slime, Chest) reference tile indices inside this range and will look different after this.'
  );
});

test('describePlayerSpritePlan: the success toast names how many frames were written, singular/plural, and appends the skipped count when non-empty', () => {
  const project = createProject('T');

  const one = describePlayerSpritePlan(project, { written: [{ direction: 'down', frameIndex: 0 }], skipped: [], indices: [0, 1, 2, 3] }, []);
  assert.equal(one.toast, 'Generated 1 player sprite frame.');

  const two = describePlayerSpritePlan(
    project,
    { written: [{ direction: 'down', frameIndex: 0 }, { direction: 'up', frameIndex: 1 }], skipped: [], indices: [0, 1, 2, 3, 4, 5, 6, 7] },
    []
  );
  assert.equal(two.toast, 'Generated 2 player sprite frames.');

  const withSkipped = describePlayerSpritePlan(
    project,
    {
      written: [{ direction: 'down', frameIndex: 0 }],
      skipped: [{ direction: 'up', frameIndex: 0, reason: 'x', quadrants: ['TL'] }],
      indices: [0, 1, 2, 3]
    },
    []
  );
  assert.equal(withSkipped.toast, 'Generated 1 player sprite frame. 1 frame skipped (incomplete).');

  const withSkippedPlural = describePlayerSpritePlan(
    project,
    {
      written: [{ direction: 'down', frameIndex: 0 }],
      skipped: [
        { direction: 'up', frameIndex: 0, reason: 'x', quadrants: ['TL'] },
        { direction: 'left', frameIndex: 1, reason: 'x', quadrants: ['BR'] }
      ],
      indices: [0, 1, 2, 3]
    },
    []
  );
  assert.equal(withSkippedPlural.toast, 'Generated 1 player sprite frame. 2 frames skipped (incomplete).');
});

test('describePlayerSpritePlan does not mutate project or plan', () => {
  const project = createProject('T');
  const plan = { written: [{ direction: 'down', frameIndex: 0 }], skipped: [], indices: [0, 1, 2, 3] };
  const collisions = [{ index: 0, name: 'Slime', tiles: [1] }];
  const before = JSON.stringify({ project, plan, collisions });
  describePlayerSpritePlan(project, plan, collisions);
  assert.equal(JSON.stringify({ project, plan, collisions }), before);
});
