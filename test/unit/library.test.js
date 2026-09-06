// The starter library import operation (docs/design-starter-library.md),
// terrain kind only -- phase 4 (§13 item 4). Every numbered test below is
// the design's own §11 test of the same number, adapted to a terrain
// vehicle wherever the design's own example used a monster/pickup/sfx
// entry this phase does not build; each adaptation says so in its own
// comment.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BLANK_TILE } from '../../shared/chr.js';
import { resolveMapper } from '../../shared/cartridge.js';
import {
  createProject,
  createScreen,
  validateProject,
  reservedPaletteSlots,
  bgRefCount,
  unusedPaletteSlots,
  unusedMetatileSlots,
  permittedIndices,
  freePermittedIndices,
  planLibraryImport,
  applyPlannedProject,
  attributedErrors
} from '../../shared/project.js';
import { Store } from '../../renderer/store.js';
import { TERRAIN_ENTRIES } from '../../shared/library/terrain/index.js';

const [grassPlains, dirtPath, shallowWater, stoneFloor, woodPlanks] = TERRAIN_ENTRIES;

// A minimal placed actor whose event carries one always-true page -- the
// exact shape test/unit/script.test.js's own Give-past-the-end test uses,
// reused here for the missingGiveTake/missingSfx family of checks.
function placeEventEntity(project, commands) {
  project.sprites.actors = [{ name: 'Sign', behavior: 'npc' }];
  project.maps[0].screens[0].entities.push({
    actorId: 0,
    x: 0,
    y: 0,
    props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } }
  });
}

// --- §5.1/§5.3: reservation and reference counting --------------------------

test('1: sprite palette 0 is excluded from unusedPaletteSlots even with zero metasprite references', () => {
  const project = createProject('Test', 'action');
  const mapper = resolveMapper(project.cartridge.mapper);
  assert.equal(project.sprites.metasprites.length, 0);
  assert.equal(unusedPaletteSlots(project, 'sprite', mapper).has(0), false);
});

test('2: background palette 1 is reserved for RPG only, with zero metatile references either way', () => {
  const rpg = createProject('Test', 'rpg');
  assert.equal(unusedPaletteSlots(rpg, 'bg', resolveMapper(rpg.cartridge.mapper)).has(1), false);

  const action = createProject('Test', 'action');
  assert.equal(unusedPaletteSlots(action, 'bg', resolveMapper(action.cartridge.mapper)).has(1), true);
});

test('3: bgRefCount counts a monster block-art battlePalette through hasBattleBlockArt, not battleTile !== null', () => {
  const withBlock = createProject('Test', 'rpg');
  withBlock.sprites.actors.push({ battle: { battleTile: 5, battlePalette: 2 } });
  assert.equal(bgRefCount(withBlock).get(2), 1);
  assert.equal(unusedPaletteSlots(withBlock, 'bg', resolveMapper(withBlock.cartridge.mapper)).has(2), false);

  // battleTile: 255 (explicit) means "no block art" -- hasBattleBlockArt must
  // read it exactly like null/undefined, so battlePalette is never counted.
  const explicit255 = createProject('Test', 'rpg');
  explicit255.sprites.actors.push({ battle: { battleTile: 255, battlePalette: 2 } });
  assert.equal(bgRefCount(explicit255).get(2) ?? 0, 0);
  assert.equal(unusedPaletteSlots(explicit255, 'bg', resolveMapper(explicit255.cartridge.mapper)).has(2), true);
});

test('4: backdrop canonicalization -- an entry\'s own placeholder p0 is replaced by the destination backdrop', async () => {
  const project = createProject('Test', 'action');
  const backdrop = 0x00; // deliberately different from every terrain entry's own placeholder (0x0f)
  for (const p of project.palettes.bg) p[0] = backdrop;
  for (const p of project.palettes.sprite) p[0] = backdrop;

  const plan = planLibraryImport(project, grassPlains, { paletteSlot: 1 });
  assert.ok(plan.ok, plan.reason);
  assert.equal(plan.project.palettes.bg[1][0], backdrop);
  assert.notEqual(plan.project.palettes.bg[1][0], grassPlains.palette[0]);

  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { saveProject, loadProject } = await import('../../main/project-io.js');
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-library-'));
  try {
    await saveProject(dir, plan.project);
    const reloaded = await loadProject(dir);
    assert.deepEqual(reloaded.palettes.bg[1], plan.project.palettes.bg[1]);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test('5: exact-match candidate selection ignores palette slot 0 entirely', () => {
  const project = createProject('Test', 'action');
  // Both unused (unreferenced, unreserved); only slot 2 exact-matches the
  // entry's own non-backdrop colours, and its own stored slot-0 value
  // deliberately differs from the entry's placeholder.
  project.palettes.bg[1] = [0x00, 0x01, 0x02, 0x03];
  project.palettes.bg[2] = [0x00, 0x1a, 0x2a, 0x30];
  const plan = planLibraryImport(project, grassPlains);
  assert.ok(plan.ok, plan.reason);
  assert.equal(plan.report.palette.slot, 2);
});

// --- §6: dedup -----------------------------------------------------------

test('6 (adapted -- design\'s own example imports a monster twice; this phase has no monster kind, so the identical dedup mechanism is exercised against a terrain entry instead): re-importing the same terrain entry reuses the first import\'s tiles', () => {
  const project = createProject('Test', 'action');
  const first = planLibraryImport(project, grassPlains);
  assert.ok(first.ok, first.reason);
  applyPlannedProject(project, first.project);

  const nonBlankBefore = project.tilesets[0].background.tiles.filter((t) => t !== BLANK_TILE).length;
  const second = planLibraryImport(project, grassPlains);
  assert.ok(second.ok, second.reason);
  assert.equal(second.report.tiles.fresh, 0);
  assert.equal(second.report.tiles.matched, grassPlains.tiles.length);
  const nonBlankAfter = second.project.tilesets[0].background.tiles.filter((t) => t !== BLANK_TILE).length;
  assert.equal(nonBlankAfter, nonBlankBefore);
});

test('7: freePermittedIndices excludes a referenced-but-content-blank tile, on both tables', () => {
  const project = createProject('Test', 'action');
  const mapper = resolveMapper(project.cartridge.mapper);
  // Claim metatile 1 (non-pristine and referenced by a screen), pointing at
  // background tile 5 -- still literally BLANK_TILE content.
  project.metatiles[1] = { id: 1, name: 'Claimed Blank', tiles: [5, 5, 5, 5], palette: 0, collision: 'open' };
  project.maps[0].screens[0].metatiles[0] = 1;
  const bgTable = project.tilesets[0].background.tiles;
  assert.equal(bgTable[5], BLANK_TILE);
  assert.equal(bgTable[6], BLANK_TILE);
  const freeBg = freePermittedIndices(bgTable, project, 'background', mapper, 0);
  assert.equal(freeBg.includes(5), false);
  assert.ok(freeBg.includes(6));

  // The sprite-table sibling: a metasprite (not a metatile) is what
  // references a sprite tile, and PLAYER_TILES' own reservation is why
  // this uses indices well above it (50/51), not 0/1.
  project.sprites.metasprites.push({
    id: 0,
    name: 'M',
    tiles: [{ x: 0, y: 0, tile: 50, palette: 0, hflip: false, vflip: false }]
  });
  const spriteTable = project.tilesets[0].sprites.tiles;
  assert.equal(spriteTable[50], BLANK_TILE);
  assert.equal(spriteTable[51], BLANK_TILE);
  const freeSprite = freePermittedIndices(spriteTable, project, 'sprites', mapper, 0);
  assert.equal(freeSprite.includes(50), false);
  assert.ok(freeSprite.includes(51));
});

test('8: a metatile referenced only via boundTiles is claimed, and its palette is not unused', () => {
  const project = createProject('Test', 'action');
  const mapper = resolveMapper(project.cartridge.mapper);
  project.metatiles[10] = { id: 10, name: 'Switched Alt', tiles: [0, 0, 0, 0], palette: 2, collision: 'open' };
  project.maps[0].screens[0].boundTiles.push({ switchId: 0, row: 0, col: 0, metatileId: 10 });

  assert.equal(unusedMetatileSlots(project)[10], false);
  assert.equal(unusedPaletteSlots(project, 'bg', mapper).has(2), false);
});

test('9: a renamed-but-otherwise-pristine metatile is not claimable (sample/\'s own "Void" case, reproduced synthetically)', () => {
  const project = createProject('Test', 'action');
  project.metatiles[5].name = 'Lava Trigger';
  assert.equal(unusedMetatileSlots(project)[5], false);
});

// --- §7.6/§7.5: refusal ordering and post-import validity -----------------

test('14: a clean import into a clean project succeeds', () => {
  const project = createProject('Test', 'action');
  const plan = planLibraryImport(project, grassPlains);
  assert.equal(plan.ok, true);
});

test('15: a pre-existing warning never refuses an import', () => {
  const project = createProject('Test', 'action');
  project.maps[0].screens.push(createScreen());
  project.maps[0].screens[0].name = 'Same';
  project.maps[0].screens[1].name = 'Same';
  const warnings = validateProject(project).filter((p) => p.severity === 'warning');
  assert.ok(warnings.length > 0);

  const plan = planLibraryImport(project, grassPlains);
  assert.equal(plan.ok, true);
});

test('16: an unrelated pre-existing error does not block an unrelated import, and is left unchanged', () => {
  const project = createProject('Test', 'action');
  placeEventEntity(project, [{ op: 'give', item: 99 }]);
  const before = validateProject(project).filter((p) => p.severity === 'error');
  assert.ok(before.some((p) => /do not name a real item/.test(p.message)));

  const plan = planLibraryImport(project, grassPlains);
  assert.ok(plan.ok, plan.reason);
  const after = validateProject(plan.project).filter((p) => p.severity === 'error');
  assert.deepEqual(after, before);
});

// 16b/16c/16d test attributedErrors' own matching mechanism against the
// exact real checks the design names (missingSfx/overlongSfx, both
// `where: 'Map Forge'`) -- the design's own examples import an `sfx`
// entry to produce the "after" state, but the sfx kind is out of this
// phase's scope (brief §"out of scope"). attributedErrors is a pure
// function of two already-built projects, generic over what changed
// between them, so these hand-build the "after" project directly (exactly
// what a real sfx import would have produced) rather than skipping the
// coverage.
test('16b: a single change satisfying one diagnostic while introducing a different one at the same (severity, where) is still caught', () => {
  const project = createProject('Test', 'action');
  placeEventEntity(project, [{ op: 'sfx', sfx: 1 }]);
  const before = validateProject(project);
  assert.ok(before.some((p) => p.severity === 'error' && /do not name a real effect/.test(p.message)));

  const overlong = structuredClone(project);
  overlong.sfx = [
    { name: 'A', volume: 15, steps: [{ note: 0, duration: 1 }] },
    { name: 'Long', volume: 15, steps: [{ note: 0, duration: 200 }, { note: 1, duration: 200 }] }
  ];
  const regressions = attributedErrors(project, overlong);
  assert.equal(regressions.length, 1);
  assert.match(regressions[0].message, /takes longer than 255 frames/);
  assert.doesNotMatch(regressions[0].message, /do not name a real effect/);

  const fixed = structuredClone(project);
  fixed.sfx = [
    { name: 'A', volume: 15, steps: [{ note: 0, duration: 1 }] },
    { name: 'Short', volume: 15, steps: [{ note: 0, duration: 10 }] }
  ];
  assert.equal(attributedErrors(project, fixed).length, 0);
});

test('16c: a same-template count increase is flagged even though a same-key satisfied diagnostic also vanishes', () => {
  const project = createProject('Test', 'action');
  project.sfx = [
    { name: 'Long1', volume: 15, steps: [{ note: 0, duration: 200 }, { note: 1, duration: 200 }] },
    { name: 'Long2', volume: 15, steps: [{ note: 0, duration: 200 }, { note: 1, duration: 200 }] }
  ];
  placeEventEntity(project, [
    { op: 'sfx', sfx: 0 },
    { op: 'sfx', sfx: 1 },
    { op: 'sfx', sfx: 2 } // does not exist yet
  ]);
  const before = validateProject(project);
  assert.ok(before.some((p) => /2 Play a sound effect commands name an effect that takes longer/.test(p.message)));
  assert.ok(before.some((p) => /1 Play a sound effect command do not name a real effect/.test(p.message)));

  const after = structuredClone(project);
  after.sfx.push({ name: 'Long3', volume: 15, steps: [{ note: 0, duration: 200 }, { note: 1, duration: 200 }] });
  const regressions = attributedErrors(project, after);
  assert.equal(regressions.length, 1);
  assert.match(regressions[0].message, /3 Play a sound effect commands name an effect that takes longer/);
});

test('16d: a genuine decrease in the same aggregate check still succeeds', () => {
  const project = createProject('Test', 'action');
  placeEventEntity(project, [
    { op: 'sfx', sfx: 0 },
    { op: 'sfx', sfx: 1 },
    { op: 'sfx', sfx: 2 }
  ]);
  const before = validateProject(project);
  assert.ok(before.some((p) => /3 Play a sound effect commands do not name a real effect/.test(p.message)));

  const after = structuredClone(project);
  after.sfx = [{ name: 'Short', volume: 15, steps: [{ note: 0, duration: 10 }] }]; // satisfies id 0 only
  assert.equal(attributedErrors(project, after).length, 0);
});

// 17's own design example imports a damaging monster to trigger §5.7's new
// blank-sprite-tile-in-reserved-range error -- structurally unreachable
// through a terrain import this phase, and this was re-checked directly
// against every validateProject check that reads project.metatiles,
// tileset.background.tiles or project.palettes.bg (the only three things
// planTerrainImport ever writes), not merely asserted:
//   - the font-collision check (:5800-5814) fires on background tile
//     content >= FONT_BASE only when `projectUsesText(project) &&
//     !fontBankSplit(project, mapper)` -- the IDENTICAL condition
//     permittedIndices already excludes that range under, so this
//     importer never writes there in the first place, and a terrain
//     import cannot change projectUsesText's own answer (it adds no
//     dialogue, event or title).
//   - the "maps reference > LIMITS.metatiles metatiles" check (:5789-5791)
//     can never fire for ANY project: project.metatiles is a fixed
//     64-slot array, so a screen's own metatile id is always in [0,64)
//     by construction, import or not.
//   - the switch-bound-substitute palette check (:5763-5776) only
//     compares two metatiles a screen ALREADY references (one painted,
//     one a bound alternate) -- and unusedMetatileSlots (this importer's
//     only claim mechanism) only ever claims a slot precisely BECAUSE
//     nothing references it yet, so a freshly claimed slot can never be
//     one either side of this check is currently looking at.
// So THIS PHASE has no real end-to-end trigger; a kind whose own writes
// touch actor/sprite content (monster/pickup, phase 5) is what the
// design's own example already needs, and phase 5 should add the real
// end-to-end version once that kind exists. What IS verified here: the
// WIRING itself -- planTerrainImport's own `attributedErrors(originalProject,
// clone)` call and its `regressions.length > 0` refusal branch -- is real,
// present and correctly ordered, confirmed by direct code reading (the
// exact lines cited above); this test proves the MATCHING MECHANISM
// (attributedErrors) it calls into is correct, but does not and cannot
// exercise planLibraryImport end-to-end for this refusal path.
test('17 (mechanism only -- see comment above; no terrain-only end-to-end trigger exists this phase): attributedErrors refuses a genuinely new error where none existed before', () => {
  const project = createProject('Test', 'action');
  const before = validateProject(project).filter((p) => p.severity === 'error');
  assert.equal(before.length, 0);

  const after = structuredClone(project);
  placeEventEntity(after, [{ op: 'give', item: 99 }]);
  const regressions = attributedErrors(project, after);
  assert.equal(regressions.length, 1);
  assert.match(regressions[0].message, /do not name a real item/);
});

test('§6 (extra, cited by the brief\'s own item 7): an out-of-range entry-local tile index refuses the whole import', () => {
  const project = createProject('Test', 'action');
  const corrupted = {
    kind: 'terrain',
    name: 'Corrupted',
    license: { type: 'CC0-1.0', author: 'NES Game Forge' },
    palette: [0x0f, 0x11, 0x22, 0x33],
    tiles: [BLANK_TILE],
    metatiles: [{ name: 'Bad', tiles: [0, 5, 0, 0], collision: 'open' }] // index 5 does not exist
  };
  const before = structuredClone(project);
  const plan = planLibraryImport(project, corrupted);
  assert.equal(plan.ok, false);
  assert.deepEqual(project, before);
});

// --- §7.2: options.paletteSlot -------------------------------------------

test('18: options.paletteSlot validation refuses before any resolution, project untouched', () => {
  const project = createProject('Test', 'action');
  for (const bad of [4, -1, 1.5, '2']) {
    const before = structuredClone(project);
    const plan = planLibraryImport(project, grassPlains, { paletteSlot: bad });
    assert.equal(plan.ok, false, `expected paletteSlot ${JSON.stringify(bad)} to refuse`);
    assert.deepEqual(project, before);
  }
});

test('19: the omitted options.paletteSlot headless default is deterministic', () => {
  const project = createProject('Test', 'action');
  const first = planLibraryImport(project, grassPlains);
  const second = planLibraryImport(project, grassPlains);
  assert.ok(first.ok && second.ok);
  assert.equal(first.report.palette.slot, second.report.palette.slot);
});

test('20: a reserved palette slot is a valid, adoptable choice, never refused', () => {
  const project = createProject('Test', 'rpg'); // bg slot 1 is reserved (RPG battle scenery)
  project.palettes.bg[1] = [0x0f, 0x01, 0x02, 0x03]; // does not match grassPlains' own colours
  const plan = planLibraryImport(project, grassPlains, { paletteSlot: 1 });
  assert.ok(plan.ok, plan.reason);
  assert.deepEqual(plan.project.palettes.bg[1], [0x0f, 0x01, 0x02, 0x03]);
  assert.equal(plan.report.palette.slot, 1);
  for (const claimed of plan.report.metatiles) {
    assert.equal(plan.project.metatiles[claimed.id].palette, 1);
  }
});

// --- §7.3: the background/sprite discriminator -----------------------------

test('22: the tile-table/palette-key discriminator never crosses vocabularies, exercised both ways', () => {
  const project = createProject('Test', 'action');
  const mapper = resolveMapper(project.cartridge.mapper);

  // sprite side: exported functions used directly (this phase never imports
  // into the sprite table, so there is no plan-level exercise of it). The
  // PLAN-level bridge (paletteCandidates' own 'sprites' -> 'sprite' mapping)
  // stays untested for the sprite side until monster/pickup (phase 5) gives
  // planLibraryImport an actual sprite-table/sprite-palette destination to
  // resolve against -- this asymmetry with the bg assertions below is
  // structural to this phase, not an oversight.
  assert.equal(unusedPaletteSlots(project, 'sprite', mapper).has(0), false);
  assert.equal(reservedPaletteSlots(project, mapper).sprite.has(0), true);
  assert.equal(reservedPaletteSlots(project, mapper).background, undefined);
  assert.equal(reservedPaletteSlots(project, mapper).sprites, undefined);

  // bg side: exercised for real through a terrain import.
  const plan = planLibraryImport(project, grassPlains);
  assert.ok(plan.ok, plan.reason);
  assert.equal(typeof plan.report.palette.slot, 'number');
  assert.equal(plan.report.palette.table, 'bg');
});

// --- §7.1: plan/apply and store integration --------------------------------

test('23: a refused plan never reaches store.commit -- no undo entry, no dirty mark', () => {
  const store = new Store();
  store.open('/tmp/forge-library-test', createProject('Test', 'action'));
  const undoLengthBefore = store.undoStack.length;
  const dirtyBefore = store.dirty;

  const plan = planLibraryImport(store.project, grassPlains, { paletteSlot: 99 }); // out of range, refuses
  assert.equal(plan.ok, false);
  if (plan.ok) store.commit('Import from library', (p) => applyPlannedProject(p, plan.project));

  assert.equal(store.undoStack.length, undoLengthBefore);
  assert.equal(store.dirty, dirtyBefore);
});

test('§7.6 step 2 (extra): zero free metatile slots refuses naming the shortfall, project untouched', () => {
  const project = createProject('Test', 'action');
  for (const mt of project.metatiles) mt.name = `${mt.name} (used)`; // breaks isPristine for all 64
  const before = structuredClone(project);
  const plan = planLibraryImport(project, grassPlains);
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /free metatile slot/);
  assert.deepEqual(project, before);
});

test('§7.6 step 3 (extra): too few free background tiles refuses naming the shortfall, project untouched', () => {
  const project = createProject('Test', 'action');
  const table = project.tilesets[0].background.tiles;
  const filler = '1'.repeat(64); // non-blank, and distinct from every grassPlains tile string
  for (let i = 0; i < 254; i++) table[i] = filler; // leaves only indices 254/255 free
  const before = structuredClone(project);
  const plan = planLibraryImport(project, grassPlains);
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /free background tile/);
  assert.deepEqual(project, before);
});

test('24: applyPlannedProject deep-equals the plan, with no independent second allocator run', () => {
  const project = createProject('Test', 'action');
  const plan = planLibraryImport(project, grassPlains);
  assert.ok(plan.ok, plan.reason);
  const target = structuredClone(project);
  applyPlannedProject(target, plan.project);
  assert.deepEqual(target, plan.project);
});

// --- Whole-inventory sanity (not §11-numbered, but cheap and load-bearing) --

test('every terrain entry is well-formed and importable into a fresh action project', () => {
  for (const entry of [grassPlains, dirtPath, shallowWater, stoneFloor, woodPlanks]) {
    assert.equal(entry.kind, 'terrain');
    assert.equal(entry.license.type, 'CC0-1.0');
    assert.equal(entry.metatiles.length, 2);
    assert.equal(entry.tiles.length, 5);
    // Regression guard for the HIGH finding: an accidentally-duplicated
    // tile string forces two entry-local indices to share one destination,
    // silently deviating from §8.1's own "5 unique tiles" inventory --
    // applies identically to a future entry's spriteTiles pool (phase 5+).
    assert.equal(new Set(entry.tiles).size, entry.tiles.length, `${entry.name}: duplicate tile content`);
    const project = createProject('Test', 'action');
    const plan = planLibraryImport(project, entry);
    assert.ok(plan.ok, `${entry.name}: ${plan.reason}`);
  }
});

test('permittedIndices excludes the font range on background when text is used and the board has no scanline split', () => {
  const project = createProject('Test', 'rpg'); // gameType 'rpg' -> projectUsesText is always true
  const mapper = resolveMapper(project.cartridge.mapper); // default RPG mapper is not MMC3
  const indices = permittedIndices(project, 'background', mapper);
  assert.ok(indices.every((i) => i < 0xa0));
});
