// The starter library import operation (docs/design-starter-library.md),
// through phase 6 (§13 items 4-6): terrain, monster/pickup, and sfx/song.
// Every numbered test below is the design's own §11 test of the same
// number, adapted to whichever kind that phase actually built wherever the
// design's own example used a kind not yet available at the time; each
// adaptation says so in its own comment.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BLANK_TILE } from '../../shared/chr.js';
import { resolveMapper } from '../../shared/cartridge.js';
import { NO_SONG } from '../../shared/audio.js';
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
  attributedErrors,
  battleSpriteBudget,
  LIMITS
} from '../../shared/project.js';
import { Store } from '../../renderer/store.js';
import { TERRAIN_ENTRIES } from '../../shared/library/terrain/index.js';
import { checkCapacity } from '../../main/build/generate.js';
import { encodeString } from '../../main/build/textcompile.js';

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

// --- Phase 5 (monster/pickup) synthetic entry helpers ----------------------
// Every entry below is a small, inline literal, not real library content
// (phase 5's own scope decision -- shared/library/monster|pickup are a later
// phase). A distinct 64-char tile string per label, never BLANK_TILE.
const spriteTile = (label) => `${label}`.padEnd(64, '.');

const MONSTER_PALETTE = [0x0f, 0x11, 0x22, 0x33];
const MONSTER_BATTLE = {
  atk: 5, def: 2, acc: 180, eva: 4, speed: 4, mp: 0, xp: 4, gold: 2,
  weak: 'none', strong: 'none', dropPct: 10, heal: 0
};

// One pose (idle only), 4 tiles, the sugared `palette`/`metasprite` singular
// form -- exercises the §2.4 sugar defaulting every tile's paletteIndex to 0.
function onePoseMonster(overrides = {}) {
  return {
    kind: 'monster',
    name: 'Slime',
    license: { type: 'CC0-1.0', author: 'NES Game Forge' },
    palette: MONSTER_PALETTE,
    spriteTiles: [spriteTile('m0'), spriteTile('m1'), spriteTile('m2'), spriteTile('m3')],
    metasprite: {
      tiles: [
        { x: 0, y: 0, tile: 0, hflip: false, vflip: false },
        { x: 8, y: 0, tile: 1, hflip: false, vflip: false },
        { x: 0, y: 8, tile: 2, hflip: false, vflip: false },
        { x: 8, y: 8, tile: 3, hflip: false, vflip: false }
      ]
    },
    hp: 5,
    speed: 2,
    damage: 1,
    battle: MONSTER_BATTLE,
    ...overrides
  };
}

function onePosePickup(overrides = {}) {
  return {
    ...onePoseMonster(overrides),
    kind: 'pickup',
    name: 'Coin',
    // Deliberately nonzero: the core must force this to 0 regardless.
    damage: 5
  };
}

// --- Phase 6 (sfx/song) synthetic entry helpers -----------------------------
function sfxEntryLiteral(overrides = {}) {
  return {
    kind: 'sfx',
    name: 'Hit',
    license: { type: 'CC0-1.0', author: 'NES Game Forge' },
    sfx: { name: 'Hit', volume: 15, steps: [{ note: 5, duration: 4 }] },
    ...overrides
  };
}

function songEntryLiteral(overrides = {}) {
  return {
    kind: 'song',
    name: 'Theme',
    license: { type: 'CC0-1.0', author: 'NES Game Forge' },
    song: {
      tempo: { framesPerRow: 6 },
      instruments: [{ duty: 2, volEnv: [15], sustain: 0 }],
      patterns: [{ rows: 4, channels: {} }],
      order: [0],
      loop: 0
    },
    ...overrides
  };
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

// 16b/16c/16d above prove attributedErrors itself is correct, but they
// hand-build the "after" project directly (their own comment says why: the
// sfx kind didn't exist yet when they were written). That leaves a real gap
// a sabotage probe found: nothing proved planSfxImport/planSongImport
// actually WIRE attributedErrors in, through the real planLibraryImport
// path, rather than e.g. `const regressions = [];` -- gutting the check
// entirely still passed every test in this file. This is the identical
// "mechanism only, then real end-to-end version" progression test 17 went
// through once planActorImport existed; see '17 (real end-to-end version)'
// below for the precedent this mirrors.
test('16b (real end-to-end version): a damaging sfx import that itself creates a new validateProject error refuses', () => {
  const project = createProject('Test', 'action');
  project.sfx = [{ name: 'A', volume: 15, steps: [{ note: 0, duration: 1 }] }]; // id 0 -- real, satisfied
  placeEventEntity(project, [{ op: 'sfx', sfx: 1 }]); // dangles: nothing at id 1 yet
  const before = validateProject(project);
  assert.ok(before.some((p) => p.severity === 'error' && /do not name a real effect/.test(p.message)));

  // §7.4's append rule lands this import at project.sfx.length === 1 -- the
  // exact id the dangling command names -- so the reference resolves, but
  // the effect itself is over the 255-frame ceiling (mirrors 16b's own
  // hand-built "Long" entry, two 200-duration steps).
  const overlongEntry = sfxEntryLiteral({
    sfx: { name: 'Long', volume: 15, steps: [{ note: 0, duration: 200 }, { note: 1, duration: 200 }] }
  });
  const refused = planLibraryImport(project, overlongEntry);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /takes longer than 255 frames/);
  assert.doesNotMatch(refused.reason, /do not name a real effect/);

  // Companion: a short, in-bounds effect at the identical id satisfies the
  // dangling reference and introduces nothing new -- the plan succeeds.
  const shortEntry = sfxEntryLiteral({
    sfx: { name: 'Short', volume: 15, steps: [{ note: 0, duration: 10 }] }
  });
  const accepted = planLibraryImport(project, shortEntry);
  assert.ok(accepted.ok, accepted.reason);
  assert.equal(accepted.report.id, 1);
  assert.equal(
    validateProject(accepted.project).some((p) => p.severity === 'error' && /Play a sound effect/.test(p.message)),
    false
  );
});

// A real song-analogous check does exist, one command over: a `sting`
// (not `music` -- an out-of-range `music` command's song operand just
// clamps at compile time, no dangling-reference check) names a song
// directly, and missingStings/overlongStings (shared/project.js, right
// above missingSfx/overlongSfx) is the identical Give/Take-family shape for
// it: songByte(project.songs, command.song) === NO_SONG is missing,
// songFrameLength(...) > 255 is overlong. The same real end-to-end
// construction as above, one command and one array over.
test('song (real end-to-end version): a damaging song import that itself creates a new validateProject error refuses', () => {
  const project = createProject('Test', 'action');
  project.songs = [
    { name: 'A', tempo: { framesPerRow: 6 }, instruments: [{ id: 0, name: 'I', duty: 2, volEnv: [15], sustain: 0 }],
      patterns: [{ id: 0, rows: 1, channels: {} }], order: [0], loop: 0 }
  ]; // id 0 -- real, satisfied (1 row * 6 frames/row = 6 frames)
  placeEventEntity(project, [{ op: 'sting', song: 1 }]); // dangles: nothing at id 1 yet
  const before = validateProject(project);
  assert.ok(before.some((p) => p.severity === 'error' && /do not name a real song/.test(p.message)));

  // §7.4's append rule lands this import at project.songs.length === 1 --
  // the exact id the dangling sting names -- so the reference resolves, but
  // the song itself is over the 255-frame ceiling (64 rows * 6 frames/row).
  const overlongEntry = songEntryLiteral({
    song: {
      tempo: { framesPerRow: 6 },
      instruments: [{ duty: 2, volEnv: [15], sustain: 0 }],
      patterns: [{ rows: 64, channels: {} }],
      order: [0],
      loop: 0
    }
  });
  const refused = planLibraryImport(project, overlongEntry);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /takes longer than 255 frames/);
  assert.doesNotMatch(refused.reason, /do not name a real song/);

  // Companion: a short, in-bounds song at the identical id satisfies the
  // dangling reference and introduces nothing new -- the plan succeeds.
  const shortEntry = songEntryLiteral({
    song: {
      tempo: { framesPerRow: 6 },
      instruments: [{ duty: 2, volEnv: [15], sustain: 0 }],
      patterns: [{ rows: 1, channels: {} }],
      order: [0],
      loop: 0
    }
  });
  const accepted = planLibraryImport(project, shortEntry);
  assert.ok(accepted.ok, accepted.reason);
  assert.equal(accepted.report.id, 1);
  assert.equal(
    validateProject(accepted.project).some((p) => p.severity === 'error' && /Sound sting command/.test(p.message)),
    false
  );
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

// --- Phase 5 (§13 item 5): monster/pickup cores ----------------------------

test('17 (real end-to-end version): a damaging monster import that itself creates a new §5.7 error refuses', () => {
  const project = createProject('Test', 'action');
  // A metasprite already references blank $FE, but the HUD-hearts range is
  // not active yet (no damage source anywhere in the project), so this is
  // not an error before the import.
  project.sprites.metasprites.push({
    id: 0,
    name: 'PreExisting',
    tiles: [{ x: 0, y: 0, tile: 0xfe, palette: 0, hflip: false, vflip: false }]
  });
  const before = validateProject(project).filter((p) => p.severity === 'error');
  assert.equal(before.length, 0);

  // onePoseMonster's own damage: 1 is exactly what flips projectUsesHeartArt
  // on, activating the reservation this pre-existing reference now violates.
  const plan = planLibraryImport(project, onePoseMonster());
  assert.equal(plan.ok, false);
  const occurrences = plan.reason.match(/references a blank tile inside the range reserved for the HUD hearts/g);
  assert.equal(occurrences?.length, 1);
});

test('18b: options.paletteSlots validation for a two-palette entry', () => {
  const project = createProject('Test', 'action');
  const twoPaletteEntry = {
    kind: 'monster',
    name: 'Dual',
    license: { type: 'CC0-1.0', author: 'NES Game Forge' },
    palettes: [[0x0f, 0x05, 0x06, 0x07], [0x00, 0x08, 0x09, 0x0a]],
    spriteTiles: [spriteTile('a'), spriteTile('b')],
    poses: {
      idle: {
        tiles: [
          { x: 0, y: 0, tile: 0, paletteIndex: 0, hflip: false, vflip: false },
          { x: 8, y: 0, tile: 1, paletteIndex: 1, hflip: false, vflip: false }
        ]
      }
    },
    hp: 5, speed: 2, damage: 1, battle: MONSTER_BATTLE
  };

  // Length mismatch.
  let before = structuredClone(project);
  let plan = planLibraryImport(project, twoPaletteEntry, { paletteSlots: [1] });
  assert.equal(plan.ok, false);
  assert.deepEqual(project, before);

  // Two elements naming the same slot.
  before = structuredClone(project);
  plan = planLibraryImport(project, twoPaletteEntry, { paletteSlots: [1, 1] });
  assert.equal(plan.ok, false);
  assert.deepEqual(project, before);
});

test('18c: a valid, distinct options.paletteSlots array succeeds end to end', () => {
  const project = createProject('Test', 'action');
  // Occupy sprite palette 2 (referenced, so an exact match there adopts
  // rather than writes) while leaving its colours at the default.
  project.sprites.metasprites.push({
    id: 0,
    name: 'Occupant',
    tiles: [{ x: 0, y: 0, tile: 10, palette: 2, hflip: false, vflip: false }]
  });
  const beforeSlot2 = [...project.palettes.sprite[2]];
  const beforeSlot3 = [...project.palettes.sprite[3]];

  const entry = {
    kind: 'pickup',
    name: 'Key',
    license: { type: 'CC0-1.0', author: 'NES Game Forge' },
    // palettes[0] narratively "exact matches" slot 2's own default colours
    // (this is not what selects the slot -- options.paletteSlots names it
    // explicitly -- only what makes "adopt, no write" the correct outcome).
    palettes: [[0x00, 0x19, 0x29, 0x30], [0x00, 0x05, 0x06, 0x07]],
    spriteTiles: [spriteTile('k0'), spriteTile('k1')],
    poses: {
      idle: {
        tiles: [
          { x: 0, y: 0, tile: 0, paletteIndex: 0, hflip: false, vflip: false },
          { x: 8, y: 0, tile: 1, paletteIndex: 1, hflip: false, vflip: false }
        ]
      }
    },
    hp: 5, speed: 2, damage: 1, battle: MONSTER_BATTLE
  };

  const plan = planLibraryImport(project, entry, { paletteSlots: [2, 3] });
  assert.ok(plan.ok, plan.reason);
  assert.equal(plan.report.palettes[0].slot, 2);
  assert.equal(plan.report.palettes[0].written, false);
  assert.equal(plan.report.palettes[1].slot, 3);
  assert.equal(plan.report.palettes[1].written, true);
  assert.deepEqual(plan.project.palettes.sprite[2], beforeSlot2);
  assert.notDeepEqual(plan.project.palettes.sprite[3], beforeSlot3);

  const metasprite = plan.project.sprites.metasprites[1]; // 0 is Occupant
  assert.equal(metasprite.tiles[0].palette, 2);
  assert.equal(metasprite.tiles[1].palette, 3);
});

test('25: importing a pickup entry leaves project.items byte-identical, and the report names "Collected from"', () => {
  const project = createProject('Test', 'action');
  const beforeItems = structuredClone(project.items);
  const plan = planLibraryImport(project, onePosePickup());
  assert.ok(plan.ok, plan.reason);
  assert.deepEqual(plan.project.items, beforeItems);
  assert.ok(plan.report.lines.some((line) => /Collected from/.test(line)));
});

test('25b (extra): a pickup entry forces behavior: pickup and damage: 0 regardless of what the entry declares', () => {
  const project = createProject('Test', 'action');
  const plan = planLibraryImport(project, onePosePickup());
  assert.ok(plan.ok, plan.reason);
  const actor = plan.project.sprites.actors[plan.report.actor.id];
  assert.equal(actor.behavior, 'pickup');
  assert.equal(actor.damage, 0);
});

test('26: synthesized .palette/anims.* are the real resolved values, never hardcoded', () => {
  const project = createProject('Test', 'action');
  // Three pre-existing metasprites/animations so the synthesized ones land
  // at id 3, and sprite palette 1 is referenced (not "unused") so the
  // headless default's own priority chain lands on slot 2, not 1.
  project.sprites.metasprites.push(
    { id: 0, name: 'E0', tiles: [{ x: 0, y: 0, tile: 20, palette: 1, hflip: false, vflip: false }] },
    { id: 1, name: 'E1', tiles: [] },
    { id: 2, name: 'E2', tiles: [] }
  );
  project.sprites.animations.push(
    { id: 0, name: 'A0', loop: true, frames: [{ metaspriteId: 0, duration: 8 }] },
    { id: 1, name: 'A1', loop: true, frames: [{ metaspriteId: 1, duration: 8 }] },
    { id: 2, name: 'A2', loop: true, frames: [{ metaspriteId: 2, duration: 8 }] }
  );

  const entry = onePoseMonster({ palette: [0x00, 0x05, 0x06, 0x07] }); // matches nothing exactly
  const plan = planLibraryImport(project, entry);
  assert.ok(plan.ok, plan.reason);
  assert.equal(plan.report.palettes[0].slot, 2);

  const metasprite = plan.project.sprites.metasprites[3];
  assert.equal(metasprite.id, 3);
  for (const tile of metasprite.tiles) assert.equal(tile.palette, 2);

  const actor = plan.project.sprites.actors[plan.report.actor.id];
  for (const slot of ['idle', 'walkDown', 'walkUp', 'walkSide']) assert.equal(actor.anims[slot], 3);
});

test('26b: a four-pose entry pushes four metasprites/animations, each anims slot pointing at its own pose', () => {
  const project = createProject('Test', 'action');
  const labels = { idle: 'i', walkDown: 'd', walkUp: 'u', walkSide: 's' };
  const spriteTiles = [];
  const poses = {};
  for (const slot of ['idle', 'walkDown', 'walkUp', 'walkSide']) {
    const base = spriteTiles.length;
    for (let k = 0; k < 4; k++) spriteTiles.push(spriteTile(`${labels[slot]}${k}`));
    poses[slot] = {
      tiles: [
        { x: 0, y: 0, tile: base, paletteIndex: 0, hflip: false, vflip: false },
        { x: 8, y: 0, tile: base + 1, paletteIndex: 0, hflip: false, vflip: false },
        { x: 0, y: 8, tile: base + 2, paletteIndex: 0, hflip: false, vflip: false },
        { x: 8, y: 8, tile: base + 3, paletteIndex: 0, hflip: false, vflip: false }
      ]
    };
  }
  const entry = {
    kind: 'monster', name: 'Walker', license: { type: 'CC0-1.0', author: 'NES Game Forge' },
    palette: MONSTER_PALETTE, spriteTiles, poses, hp: 5, speed: 2, damage: 1, battle: MONSTER_BATTLE
  };

  const plan = planLibraryImport(project, entry);
  assert.ok(plan.ok, plan.reason);
  assert.equal(plan.report.poses.length, 4);
  assert.equal(new Set(plan.report.poses.map((p) => p.metaspriteId)).size, 4);
  assert.equal(new Set(plan.report.poses.map((p) => p.animationId)).size, 4);

  const actor = plan.project.sprites.actors[plan.report.actor.id];
  const spriteTable = plan.project.tilesets[0].sprites.tiles;
  for (const slot of ['idle', 'walkDown', 'walkUp', 'walkSide']) {
    const animation = plan.project.sprites.animations[actor.anims[slot]];
    const metasprite = plan.project.sprites.metasprites[animation.frames[0].metaspriteId];
    const content = spriteTable[metasprite.tiles[0].tile];
    assert.equal(content, spriteTile(`${labels[slot]}0`));
  }
});

test('26c: a partially-declared entry (idle + walkDown) falls back to idle per slot', () => {
  const project = createProject('Test', 'action');
  const entry = {
    kind: 'monster', name: 'Partial', license: { type: 'CC0-1.0', author: 'NES Game Forge' },
    palette: MONSTER_PALETTE,
    spriteTiles: [spriteTile('i0'), spriteTile('i1'), spriteTile('d0'), spriteTile('d1')],
    poses: {
      idle: {
        tiles: [
          { x: 0, y: 0, tile: 0, paletteIndex: 0, hflip: false, vflip: false },
          { x: 8, y: 0, tile: 1, paletteIndex: 0, hflip: false, vflip: false }
        ]
      },
      walkDown: {
        tiles: [
          { x: 0, y: 0, tile: 2, paletteIndex: 0, hflip: false, vflip: false },
          { x: 8, y: 0, tile: 3, paletteIndex: 0, hflip: false, vflip: false }
        ]
      }
    },
    hp: 5, speed: 2, damage: 1, battle: MONSTER_BATTLE
  };

  const plan = planLibraryImport(project, entry);
  assert.ok(plan.ok, plan.reason);
  const actor = plan.project.sprites.actors[plan.report.actor.id];
  assert.equal(actor.anims.walkUp, actor.anims.idle);
  assert.equal(actor.anims.walkSide, actor.anims.idle);
  assert.notEqual(actor.anims.walkDown, actor.anims.idle);
});

test('26d: a two-palette entry resolves each palette in order, and paletteMap routes tiles by paletteIndex', () => {
  const project = createProject('Test', 'action');
  // Sprite palette 1 referenced (adopt outcome for an exact match); 2 stays
  // genuinely unused (fresh-written outcome).
  project.sprites.metasprites.push({
    id: 0,
    name: 'Occupant',
    tiles: [{ x: 0, y: 0, tile: 10, palette: 1, hflip: false, vflip: false }]
  });
  const entry = {
    kind: 'monster', name: 'Dual', license: { type: 'CC0-1.0', author: 'NES Game Forge' },
    palettes: [
      [0x0f, 0x11, 0x21, 0x30], // exact-matches sprite palette 1's default colours
      [0x00, 0x05, 0x06, 0x07] // matches nothing; genuinely unused slot 2 is next
    ],
    spriteTiles: [spriteTile('a'), spriteTile('b')],
    poses: {
      idle: {
        tiles: [
          { x: 0, y: 0, tile: 0, paletteIndex: 0, hflip: false, vflip: false },
          { x: 8, y: 0, tile: 1, paletteIndex: 1, hflip: false, vflip: false }
        ]
      }
    },
    hp: 5, speed: 2, damage: 1, battle: MONSTER_BATTLE
  };

  const plan = planLibraryImport(project, entry);
  assert.ok(plan.ok, plan.reason);
  assert.equal(plan.report.palettes[0].slot, 1);
  assert.equal(plan.report.palettes[0].written, false);
  assert.equal(plan.report.palettes[1].slot, 2);
  assert.equal(plan.report.palettes[1].written, true);

  const metasprite = plan.project.sprites.metasprites[1]; // 0 is Occupant
  assert.equal(metasprite.tiles[0].palette, 1);
  assert.equal(metasprite.tiles[1].palette, 2);
});

test('26e: an out-of-range paletteIndex refuses the whole import, never a silent passthrough', () => {
  const project = createProject('Test', 'action');
  const entry = onePoseMonster();
  entry.metasprite.tiles[0] = { ...entry.metasprite.tiles[0], paletteIndex: 1 }; // only 1 declared palette
  const before = structuredClone(project);
  const plan = planLibraryImport(project, entry);
  assert.equal(plan.ok, false);
  assert.deepEqual(project, before);
});

test('26f: two entry-local palettes that would both resolve to "first unused" independently land on different slots', () => {
  const project = createProject('Test', 'action'); // sprite slots 1, 2, 3 all genuinely unused
  const entry = {
    kind: 'monster', name: 'DualFresh', license: { type: 'CC0-1.0', author: 'NES Game Forge' },
    palettes: [[0x00, 0x05, 0x06, 0x07], [0x00, 0x08, 0x09, 0x0a]], // neither matches any existing colours
    spriteTiles: [spriteTile('c'), spriteTile('d')],
    poses: {
      idle: {
        tiles: [
          { x: 0, y: 0, tile: 0, paletteIndex: 0, hflip: false, vflip: false },
          { x: 8, y: 0, tile: 1, paletteIndex: 1, hflip: false, vflip: false }
        ]
      }
    },
    hp: 5, speed: 2, damage: 1, battle: MONSTER_BATTLE
  };

  const plan = planLibraryImport(project, entry);
  assert.ok(plan.ok, plan.reason);
  assert.notEqual(plan.report.palettes[0].slot, plan.report.palettes[1].slot);
  assert.equal(plan.report.palettes[0].written, true);
  assert.equal(plan.report.palettes[1].written, true);
});

test('26g (extra): entry.palettes.length is bound-checked against LIMITS.palettes (4), inclusive', () => {
  const project = createProject('Test', 'action');
  const fivePalette = {
    kind: 'monster', name: 'FivePalette', license: { type: 'CC0-1.0', author: 'NES Game Forge' },
    palettes: [[0, 1, 2, 3], [0, 4, 5, 6], [0, 7, 8, 9], [0, 10, 11, 12], [0, 13, 14, 15]],
    spriteTiles: [spriteTile('a')],
    poses: { idle: { tiles: [{ x: 0, y: 0, tile: 0, paletteIndex: 4, hflip: false, vflip: false }] } },
    hp: 5, speed: 2, damage: 1, battle: MONSTER_BATTLE
  };
  const before = structuredClone(project);
  const refused = planLibraryImport(project, fivePalette);
  assert.equal(refused.ok, false);
  assert.deepEqual(project, before);

  // Boundary control: exactly 4 declared palettes (the inclusive upper
  // bound) still succeeds -- the fix must not accidentally refuse this.
  const fourPalette = {
    kind: 'monster', name: 'FourPalette', license: { type: 'CC0-1.0', author: 'NES Game Forge' },
    palettes: [[0, 1, 2, 3], [0, 4, 5, 6], [0, 7, 8, 9], [0, 10, 11, 12]],
    spriteTiles: [spriteTile('a')],
    poses: { idle: { tiles: [{ x: 0, y: 0, tile: 0, paletteIndex: 3, hflip: false, vflip: false }] } },
    hp: 5, speed: 2, damage: 1, battle: MONSTER_BATTLE
  };
  const accepted = planLibraryImport(project, fourPalette);
  assert.ok(accepted.ok, accepted.reason);
  assert.equal(accepted.report.palettes.length, 4);
});

test('26h (extra): a missing required "idle" pose refuses, project untouched', () => {
  const project = createProject('Test', 'action');
  const noIdle = {
    kind: 'monster', name: 'NoIdle', license: { type: 'CC0-1.0', author: 'NES Game Forge' },
    palette: MONSTER_PALETTE,
    spriteTiles: [spriteTile('a')],
    poses: { walkDown: { tiles: [{ x: 0, y: 0, tile: 0, paletteIndex: 0, hflip: false, vflip: false }] } },
    hp: 5, speed: 2, damage: 1, battle: MONSTER_BATTLE
  };
  const before = structuredClone(project);
  const refused = planLibraryImport(project, noIdle);
  assert.equal(refused.ok, false);
  assert.deepEqual(project, before);

  // Companion control: idle present (alone) still succeeds -- the fix must
  // not accidentally refuse the ordinary one-pose case.
  const accepted = planLibraryImport(project, onePoseMonster());
  assert.ok(accepted.ok, accepted.reason);
});

test('26i (extra): re-importing the same entry twice de-collides the pushed metasprite/animation names', () => {
  const project = createProject('Test', 'action');
  const entry = onePoseMonster({ name: 'Repeat' });
  const first = planLibraryImport(project, entry);
  assert.ok(first.ok, first.reason);
  const second = planLibraryImport(first.project, entry);
  assert.ok(second.ok, second.reason);

  const actor1 = second.project.sprites.actors[first.report.actor.id];
  const actor2 = second.project.sprites.actors[second.report.actor.id];
  assert.notEqual(actor1.name, actor2.name); // "Repeat" / "Repeat copy", already correct before this round

  const metasprite1 = second.project.sprites.metasprites[first.report.poses[0].metaspriteId];
  const metasprite2 = second.project.sprites.metasprites[second.report.poses[0].metaspriteId];
  assert.notEqual(metasprite1.name, metasprite2.name);

  const animation1 = second.project.sprites.animations[first.report.poses[0].animationId];
  const animation2 = second.project.sprites.animations[second.report.poses[0].animationId];
  assert.notEqual(animation1.name, animation2.name);
});

test('26j (extra): a non-array options.paletteSlots refuses rather than throwing', () => {
  const project = createProject('Test', 'action');
  const before = structuredClone(project);
  const arrayLike = { 0: 2, length: 1 }; // array-like, not a real array
  let plan;
  assert.doesNotThrow(() => {
    plan = planLibraryImport(project, onePoseMonster(), { paletteSlots: arrayLike });
  });
  assert.equal(plan.ok, false);
  assert.deepEqual(project, before);
});

test('26k (extra): an out-of-range tile index in a pose refuses the whole import, never a silent passthrough', () => {
  const project = createProject('Test', 'action');
  const entry = onePoseMonster();
  entry.metasprite.tiles[0] = { ...entry.metasprite.tiles[0], tile: entry.spriteTiles.length }; // one past the end
  const before = structuredClone(project);
  const plan = planLibraryImport(project, entry);
  assert.equal(plan.ok, false);
  assert.deepEqual(project, before);
});

test('27: an imported monster is counted in the OAM budget through the exported battleSpriteBudget', () => {
  const project = createProject('Test', 'rpg');
  const mapper = resolveMapper(project.cartridge.mapper);
  const plan = planLibraryImport(project, onePoseMonster());
  assert.ok(plan.ok, plan.reason);

  const before = battleSpriteBudget(plan.project, mapper);
  const placed = structuredClone(plan.project);
  placed.maps[0].screens[0].entities.push({ actorId: plan.report.actor.id, x: 0, y: 0, props: {} });
  const after = battleSpriteBudget(placed, mapper);

  const metasprite = placed.sprites.metasprites[plan.report.poses[0].metaspriteId];
  assert.equal(after.used - before.used, metasprite.tiles.length);
});

// --- Phase 6 (§13 item 6): sfx/song cores -----------------------------------

test('sfx: a clean import into a fresh project succeeds', () => {
  const project = createProject('Test', 'action');
  const plan = planLibraryImport(project, sfxEntryLiteral());
  assert.ok(plan.ok, plan.reason);
  assert.equal(plan.project.sfx.length, 1);
  assert.equal(plan.project.sfx[0].name, 'Hit');
  assert.equal(plan.project.sfx[0].volume, 15);
  assert.deepEqual(plan.project.sfx[0].steps, [{ note: 5, duration: 4 }]);
  assert.equal(plan.report.kind, 'sfx');
  assert.equal(plan.report.id, 0);
  assert.ok(plan.report.lines.includes('Capacity is checked at build.'));
});

test('song: a clean import into a fresh project succeeds', () => {
  const project = createProject('Test', 'action');
  const plan = planLibraryImport(project, songEntryLiteral());
  assert.ok(plan.ok, plan.reason);
  assert.equal(plan.project.songs.length, 1);
  assert.equal(plan.project.songs[0].name, 'Theme');
  assert.equal(plan.project.songs[0].tempo.framesPerRow, 6);
  assert.equal(plan.project.songs[0].order.length, 1);
  assert.equal(plan.report.kind, 'song');
  assert.equal(plan.report.id, 0);
  assert.ok(plan.report.lines.includes('Capacity is checked at build.'));
});

test('sfx: re-importing the same entry twice de-collides the pushed record\'s name (26i shape)', () => {
  const project = createProject('Test', 'action');
  const entry = sfxEntryLiteral({
    name: 'Repeat',
    sfx: { name: 'Repeat', volume: 15, steps: [{ note: 1, duration: 2 }] }
  });
  const first = planLibraryImport(project, entry);
  assert.ok(first.ok, first.reason);
  const second = planLibraryImport(first.project, entry);
  assert.ok(second.ok, second.reason);
  assert.equal(second.project.sfx[first.report.id].name, 'Repeat');
  assert.equal(second.project.sfx[second.report.id].name, 'Repeat copy');
});

test('song: re-importing the same entry twice de-collides the pushed record\'s name (26i shape)', () => {
  const project = createProject('Test', 'action');
  const entry = songEntryLiteral({
    name: 'Repeat',
    song: {
      tempo: { framesPerRow: 6 },
      instruments: [{ duty: 2, volEnv: [15], sustain: 0 }],
      patterns: [{ rows: 4, channels: {} }],
      order: [0],
      loop: 0,
      name: 'Repeat'
    }
  });
  const first = planLibraryImport(project, entry);
  assert.ok(first.ok, first.reason);
  const second = planLibraryImport(first.project, entry);
  assert.ok(second.ok, second.reason);
  assert.equal(second.project.songs[first.report.id].name, 'Repeat');
  assert.equal(second.project.songs[second.report.id].name, 'Repeat copy');
});

test('sfx: capacity refusal at LIMITS.sfx, project untouched', () => {
  const project = createProject('Test', 'action');
  for (let i = 0; i < LIMITS.sfx; i++) {
    project.sfx.push({ name: `Filler${i}`, volume: 15, steps: [{ note: 0, duration: 1 }] });
  }
  const before = structuredClone(project);
  const plan = planLibraryImport(project, sfxEntryLiteral());
  assert.equal(plan.ok, false);
  assert.match(plan.reason, new RegExp(`${LIMITS.sfx} sound effects, the maximum`));
  assert.deepEqual(project, before);
});

test('song: capacity refusal at NO_SONG, project untouched', () => {
  const project = createProject('Test', 'action');
  for (let i = 0; i < NO_SONG; i++) {
    project.songs.push({
      name: `Filler${i}`,
      tempo: { framesPerRow: 6 },
      instruments: [{ id: 0, name: 'I', duty: 2, volEnv: [15], sustain: 0 }],
      patterns: [{ id: 0, rows: 1, channels: {} }],
      order: [0],
      loop: 0
    });
  }
  const before = structuredClone(project);
  const plan = planLibraryImport(project, songEntryLiteral());
  assert.equal(plan.ok, false);
  assert.match(plan.reason, new RegExp(`${NO_SONG} songs, the maximum`));
  assert.deepEqual(project, before);
});

// 31: a successful sfx import can leave the project one build away from a
// music/text-bank overflow, documented rather than prevented (§7.8). Built
// for real, not by hand-guessing the byte formulas: a single Say command's
// text is engineered to compile to an exact byte count via wrapText's own
// word-wrap rule -- a word of exactly BOX_COLS (28) characters always fills
// its line alone (no room for a further word), so N such words cost exactly
// 29 bytes apiece (28 characters + one separator, page math included), and
// one shorter trailing word tops up any remainder; `encodeString` itself
// verifies the construction rather than trusting the arithmetic blindly.
test('31: a successful sfx import can leave the project one byte-for-byte build away from a music/text-bank overflow', () => {
  const FILLER_WORD = 'A'.repeat(28); // exactly BOX_COLS characters
  function textOfByteLength(targetBytes) {
    let full = Math.floor(targetBytes / 29);
    let remaining = targetBytes - full * 29;
    // A trailing empty "word" is swallowed by wrapText's own word-split
    // (spaces around an empty token collapse away), so a remainder of
    // exactly 1 can't be represented as a lone extra word once a filler
    // word already precedes it -- borrow one filler word back (29 bytes)
    // and re-spend it as two trailing words (28 + 2 = 30) instead.
    if (remaining === 1 && full > 0) {
      full -= 1;
      remaining = 30;
    }
    const words = [];
    for (let i = 0; i < full; i++) words.push(FILLER_WORD);
    if (remaining > 0) {
      if (remaining <= 28) words.push('B'.repeat(remaining - 1));
      else {
        words.push('B'.repeat(27));
        words.push('C'.repeat(1));
      }
    }
    return words.join(' ');
  }

  // Self-check the construction before relying on it for the real project.
  for (const t of [1, 2, 28, 29, 30, 57, 100, 8000, 8127]) {
    assert.equal(encodeString(textOfByteLength(t)).bytes.length, t, `textOfByteLength(${t})`);
  }

  const BANK_SIZE = 8192; // main/build/generate.js's own BANK_SIZE constant
  const CEILING = BANK_SIZE - 64; // main/build/generate.js's own ceiling for this check

  // Calibrate the fixed part of the total (music + sfx + the one event's own
  // non-string overhead) by measuring it directly, at a small known string
  // byte count -- strings.length and events.length stay fixed at 1 across
  // every project built below, so only the string's own content length ever
  // changes what textBytes reports.
  const probeBytes = 2;
  const probe = createProject('Test', 'action');
  placeEventEntity(probe, [{ op: 'say', text: textOfByteLength(probeBytes) }]);
  const probeCapacity = checkCapacity(probe);
  const fixed = probeCapacity.musicBytes + probeCapacity.sfxBytes + (probeCapacity.textBytes - probeBytes);

  const targetTotal = CEILING - 1; // exactly one byte under the ceiling
  const neededStringBytes = targetTotal - fixed;
  assert.ok(neededStringBytes > 0, 'sanity: needs a positive-length dialogue string');

  const project = createProject('Test', 'action');
  placeEventEntity(project, [{ op: 'say', text: textOfByteLength(neededStringBytes) }]);

  const before = checkCapacity(project);
  assert.equal(before.musicBytes + before.sfxBytes + before.textBytes, targetTotal);
  assert.equal(
    before.problems.some((p) => /music and text bank/.test(p.message)),
    false,
    'must not already be over the ceiling before the import'
  );

  const plan = planLibraryImport(project, sfxEntryLiteral({ sfx: { name: 'OneStep', volume: 15, steps: [{ note: 5, duration: 4 }] } }));
  assert.ok(plan.ok, plan.reason); // §7.5's own mechanism has nothing to say about generator capacity

  const after = checkCapacity(plan.project);
  const overflow = after.problems.find((p) => /music and text bank/.test(p.message));
  assert.ok(overflow, 'checkCapacity must report the bank overflow by name after the import');
  assert.equal(overflow.severity, 'error');
});

// 32: the identical shape for kernel-lo, via an actor import -- the id-space/
// table-byte axis rather than the music/text-bank one (§7.8). Found by
// search rather than by formula: filler actors (no metasprites/animations of
// their own -- metaspriteKernelBytes' own per-actor term is a flat 8 bytes
// regardless of their content) are pushed one at a time until checkCapacity
// first reports the kernel-lo shortfall, then backed off by one so the
// project fits again -- "one actor away from the ceiling," exactly as the
// design names it.
test('32: a successful monster import can leave the project one build away from a kernel-lo overflow', () => {
  const hasLookupError = (p) => checkCapacity(p).problems.some((x) => /lookup tables need/.test(x.message));
  const fillerActor = (id) => ({
    id,
    name: `Filler${id}`,
    behavior: 'npc',
    speed: 1,
    hp: 1,
    damage: 0,
    anims: { idle: null, walkDown: null, walkUp: null, walkSide: null },
    battle: {
      atk: 4, def: 2, acc: 180, eva: 4, speed: 4, mp: 0, xp: 4, gold: 2,
      weak: 'none', strong: 'none', drop: null, dropPct: 10, heal: 0,
      spellId: null, battleTile: null, battleW: 4, battleH: 4, battlePalette: 2, level: null
    }
  });

  const project = createProject('Test', 'action');
  assert.equal(hasLookupError(project), false, 'a fresh project must not already be over the kernel-lo ceiling');
  let guard = 0;
  while (!hasLookupError(project) && guard < LIMITS.actors) {
    project.sprites.actors.push(fillerActor(project.sprites.actors.length));
    guard++;
  }
  assert.ok(hasLookupError(project), 'filler actors never tipped the project over -- test assumption is wrong');
  project.sprites.actors.pop(); // back off by one: fits again, one actor away from the ceiling
  assert.equal(hasLookupError(project), false, 'one actor back from the tip-over point must fit');

  const plan = planLibraryImport(project, onePoseMonster());
  assert.ok(plan.ok, plan.reason); // §7.5's own mechanism has nothing to say about generator capacity

  const overflow = checkCapacity(plan.project).problems.find((p) => /lookup tables need/.test(p.message));
  assert.ok(overflow, 'checkCapacity must report the kernel-lo overflow by name after the import');
  assert.equal(overflow.severity, 'error');
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
