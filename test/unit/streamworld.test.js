// Large streamed worlds (ROADMAP item 15), phase 2 slice 2b, Part H.
//
// This file covers what streamed.test.js's own "the build refusal" section points here: each of
// Part D's refusals (shared/project.js's validateStreamedMaps), positive AND negative,
// built through the real public path -- not merely a validateProject message match, since a
// refusal that only fired in validateProject but not generateAssets/buildProject would ship a
// broken ROM to a user who bypassed the editor's own warning panel. Seven items refuse the build
// (D.1, D.2, D.4-D.8 in this file's own section order); D.3 (a scripted Move reachable on a
// streamed screen) lifted back to a warning in phase 2 slice 3 (move_tick's own bound/probe),
// so its own section below checks a warning plus a clean build instead of a refusal.
//
// It also covers the brief's own public-path render proof: the generator's default project,
// built through buildProject with no test-only option, booted headlessly for real (not
// test/lib/callroutine.js's routine-isolation stub streamworldresident.test.js uses), landing on
// the streamed start screen and drawing it via the real resolver/boot dispatch.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { saveProject, loadProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { validateProject, isMonsterActor, createProject, createMap, createScreen, createTileset } from '../../shared/project.js';
import { planStreamedRegions } from '../../main/build/generate.js';
import { emitStreamedLayout } from '../../main/build/streamed.js';
import { STREAM_MAP_COLUMNS, STREAM_MAP_COLUMN_BYTES } from '../../shared/streamlayout.js';
import { resolveMapper, prgLayout } from '../../shared/cartridge.js';
import { encodeTile, tileFromString, tileToString } from '../../shared/chr.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { decodeStreamedLayout } from '../lib/streamdecoder.js';
import { callRoutine } from '../lib/callroutine.js';
import NES from '../../renderer/emulator/core/nes.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

async function buildsClean(project) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworld-refusal-'));
  try {
    await saveProject(dir, project);
    await buildProject({ dir, project, log: () => {} });
    return true;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function streamedErrors(project) {
  return validateProject(project).filter((x) => x.severity === 'error');
}

// ---------------------------------------------------------------- D.1: board/mirroring

test(
  'D.1 positive: UNROM 512 + four-screen mirroring (the one capable board) builds clean',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({});
    assert.deepEqual(streamedErrors(project), []);
    assert.ok(await buildsClean(project));
  }
);

test('D.1 negative: any other board/mirroring refuses with the Forge-naming message, not a raw assembler error', () => {
  const project = createStreamedProject({ mapper: 1, mirroring: 'vertical', gridH: 1 });
  const errors = streamedErrors(project);
  assert.ok(errors.length > 0);
  assert.ok(errors.some((e) => /only reaches the two-nametable ring|streamCapableFourScreen|four-screen/i.test(e.message)));
});

// ---------------------------------------------------------------- D.2: bound tiles

test(
  'D.2 positive: a streamed project with no bound tiles builds clean',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({});
    assert.deepEqual(streamedErrors(project), []);
    assert.ok(await buildsClean(project));
  }
);

test('D.2 negative: a bound tile on a streamed screen is refused', () => {
  const project = createStreamedProject({});
  const streamedMap = project.maps.find((m) => m.streamed === true);
  const screen = streamedMap.screens[0];
  screen.boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: screen.metatiles[0] }];
  const errors = streamedErrors(project);
  assert.ok(errors.some((e) => /switch-bound tiles/.test(e.message)), JSON.stringify(errors));
});

// ---------------------------------------------------------------- D.3: Move

function withEvent(project, commands) {
  const streamedMap = project.maps.find((m) => m.streamed === true);
  const screen = streamedMap.screens[0];
  screen.entities = screen.entities ?? [];
  screen.entities.push({
    actorId: 0,
    x: 32,
    y: 32,
    props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } }
  });
  return project;
}

test(
  'D.3 positive: an event on a streamed screen with no Move builds clean',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = withEvent(createStreamedProject({}), [{ op: 'wait', frames: 10 }]);
    assert.deepEqual(streamedErrors(project), []);
    assert.ok(await buildsClean(project));
  }
);

test(
  // Phase 2 slice 3 (docs/design-streamed-worlds.md §7, ruling 7): move_tick now bounds and
  // probes this exact case at runtime (the player-mover's own 0-255/0-239 ownership rectangle,
  // sw_move_probe_solid reading the neighbour screen's terrain at the seam), so item 3 lifted
  // from an error back to the phase-1 warning -- it still warns, since the Move still cannot
  // cross to a new screen (ownership never changes mid-page), but it no longer refuses the build.
  'D.3: a scripted Move reachable on a streamed screen warns but no longer refuses the build',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = withEvent(createStreamedProject({}), [{ op: 'move', who: 'player', dir: 'up', dist: 16 }]);
    assert.deepEqual(streamedErrors(project), []);
    const warnings = validateProject(project).filter((x) => x.severity === 'warning' && /moves the player/.test(x.message));
    assert.equal(warnings.length, 1, JSON.stringify(validateProject(project)));
    assert.ok(await buildsClean(project));
  }
);

// ---------------------------------------------------------------- D.4: Say

test(
  'D.4 positive: an event on a streamed screen with no Say builds clean',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = withEvent(createStreamedProject({}), [{ op: 'wait', frames: 10 }]);
    assert.deepEqual(streamedErrors(project), []);
    assert.ok(await buildsClean(project));
  }
);

test('D.4 negative: Say/dialogue reachable on a streamed screen is refused', () => {
  const project = withEvent(createStreamedProject({}), [{ op: 'say', text: 'Hello.' }]);
  const errors = streamedErrors(project);
  assert.ok(errors.some((e) => /shows text/.test(e.message)), JSON.stringify(errors));
});

// Fix round 1, finding 4: Choice dispatches straight to box_choose/box_begin (engine/script.asm's
// script_op_choice, engine/text.asm) without ever going through Say, so an event with a Choice
// and no Say anywhere reached the same unsupported overlay this refusal exists to block. SAY_OPS
// (shared/project.js) used to be `new Set(['say'])`; a Choice-only event slipped past it and a
// public build was accepted with `game_state` reaching the text UI at runtime.
test('D.4 negative, fix round 1 finding 4: a Choice with no Say anywhere reachable on a streamed screen is refused', () => {
  const project = withEvent(createStreamedProject({}), [
    { op: 'choice', options: [{ text: 'Yes', commands: [] }, { text: 'No', commands: [] }] }
  ]);
  const errors = streamedErrors(project);
  assert.ok(
    errors.some((e) => /shows text/.test(e.message)),
    `a Choice-only event (no Say) must still be refused: ${JSON.stringify(errors)}`
  );
});


// ---------------------------------------------------------------- D.5: hero/Join naming

test(
  'D.5 positive: naming off (createStreamedProject default) builds clean',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({});
    assert.deepEqual(streamedErrors(project), []);
    assert.ok(await buildsClean(project));
  }
);

test('D.5 negative: hero naming anywhere in a project with a streamed map is refused', () => {
  const project = createStreamedProject({ gameType: 'rpg', naming: true });
  const errors = streamedErrors(project);
  assert.ok(errors.some((e) => /in-game naming/.test(e.message)), JSON.stringify(errors));
});

// Case 10/18: every "*negative: ... is refused" test above and below only calls validateProject
// (via streamedErrors) directly -- proving the MESSAGE is right, never that a caller reaching the
// real build pipeline instead (main/build/generate.js's generateAssets, via buildProject) is
// actually stopped by it rather than silently shipping a ROM that reaches name_begin/box_begin at
// boot with no naming support compiled in. This is the one place that seam is checked for real.
test(
  'D.5 negative, through the real build pipeline: buildProject (not just validateProject) refuses a streamed project with hero naming, rather than shipping a ROM',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({ gameType: 'rpg', naming: true });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworld-buildrefusal-'));
    try {
      await saveProject(dir, project);
      await assert.rejects(
        buildProject({ dir, project, log: () => {} }),
        /in-game naming/,
        'buildProject must reject a D.5-negative-shaped project, not silently assemble it'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

// ---------------------------------------------------------------- D.6: fight-shaped battle entry

test(
  'D.6 positive: an RPG streamed project with no encounter rate, no monster contact, no scripted Fight builds clean',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({ gameType: 'rpg' });
    assert.deepEqual(streamedErrors(project), []);
    assert.ok(await buildsClean(project));
  }
);

test('D.6 negative (a): a nonzero encounter rate on a streamed map is refused', () => {
  const project = createStreamedProject({ gameType: 'rpg' });
  const streamedMap = project.maps.find((m) => m.streamed === true);
  streamedMap.encounters = { rate: 10, actorIds: [] };
  const errors = streamedErrors(project);
  assert.ok(errors.some((e) => /wandering monsters/.test(e.message)), JSON.stringify(errors));
});

test('D.6 negative (b): authored monster contact (an entity whose actor deals damage) on a streamed screen is refused', () => {
  const project = createStreamedProject({ gameType: 'rpg' });
  project.sprites.actors[0] = { name: 'Slime', damage: 1, battle: { atk: 5 } };
  assert.ok(isMonsterActor(project.sprites.actors[0]));
  const streamedMap = project.maps.find((m) => m.streamed === true);
  const screen = streamedMap.screens[0];
  screen.entities = [{ actorId: 0, x: 32, y: 32, props: {} }];
  const errors = streamedErrors(project);
  assert.ok(errors.some((e) => /deals contact damage/.test(e.message)), JSON.stringify(errors));
});

test('D.6 negative (c): a scripted Fight command reachable on a streamed screen is refused', () => {
  const project = withEvent(createStreamedProject({ gameType: 'rpg' }), [{ op: 'battle', monsters: [0] }]);
  const errors = streamedErrors(project);
  assert.ok(errors.some((e) => /starts a battle/.test(e.message)), JSON.stringify(errors));
});

test('D.6: BE_INIT is one of several BE_* entry points into call_battle, not the only one -- fight-shaped and non-fight-shaped entries coexist', () => {
  const constants = fs.readFileSync('engine/constants.asm', 'utf8');
  const beEntries = [...constants.matchAll(/^(BE_[A-Z_]+)\s*=/gm)].map((m) => m[1]);
  assert.ok(beEntries.includes('BE_INIT'), 'BE_INIT must exist');
  // CLAUDE.md's own reference-battle-system.md pointer: nine entry points. Not hardcoding the
  // count here (that lives in the doc), just confirming it is a real family, not a single value.
  assert.ok(beEntries.length > 1, `expected several BE_* entry points, found only ${JSON.stringify(beEntries)}`);

  // Every `lda #BE_*` load anywhere in the engine, across every file -- the exhaustive set of
  // entry points some caller actually arms, which is what Part D item 6 has to reason about
  // (fight-shaped vs. not) rather than a hand-picked subset.
  const armed = new Set();
  for (const file of fs.readdirSync('engine').filter((f) => f.endsWith('.asm'))) {
    const text = fs.readFileSync(path.join('engine', file), 'utf8');
    for (const m of text.matchAll(/lda\s+#(BE_[A-Z_]+)/g)) armed.add(m[1]);
  }
  assert.ok(armed.has('BE_INIT'), `BE_INIT must be armed by some caller: ${JSON.stringify([...armed])}`);
  // At least one entry point besides BE_INIT is armed too -- the non-fight-shaped entries
  // (BE_RESTORE/BE_NAME_* etc.) the non-fight-return test below drives one of for real.
  assert.ok(armed.size > 1, `expected more than one armed BE_* entry point: ${JSON.stringify([...armed])}`);
});

// ---------------------------------------------------------------- D.7: live Save

test(
  'D.7 positive: no Save command in a streamed project builds clean',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({ gameType: 'rpg' });
    assert.deepEqual(streamedErrors(project), []);
    assert.ok(await buildsClean(project));
  }
);

test('D.7 negative: a live Save command ANYWHERE in a project with a streamed map is refused, even authored on an ordinary map', () => {
  const project = createStreamedProject({ gameType: 'rpg', mixed: true });
  // The mixed shape's first, ordinary "before" map -- proving item 7 is a project-wide refusal,
  // not scoped to the streamed screen the way items 2-4/6 are (streamed.test.js's D.6/D.3/D.4
  // negatives already cover the on-screen case).
  const before = project.maps[0].screens[0];
  before.entities = before.entities ?? [];
  before.entities.push({
    actorId: 0,
    x: 32,
    y: 32,
    props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } }
  });
  const errors = streamedErrors(project);
  assert.ok(errors.some((e) => /live Save command/.test(e.message)), JSON.stringify(errors));
});

// ---------------------------------------------------------------- D.8: camera

test(
  'D.8 positive: camera on (createStreamedProject default) builds clean',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({});
    assert.deepEqual(streamedErrors(project), []);
    assert.ok(await buildsClean(project));
  }
);

test('D.8 negative: camera off on a project with a streamed map is refused', () => {
  const project = createStreamedProject({ camera: false });
  const errors = streamedErrors(project);
  assert.ok(errors.some((e) => /camera off/.test(e.message)), JSON.stringify(errors));
});

// ==================================================================================
// Public-path boot/render proof: the generator's default project, built through
// buildProject with no test-only option, booted for real (nes.frame(), not
// test/lib/callroutine.js's routine-isolation stub streamworldresident.test.js
// uses), landing on the streamed start screen via the real boot->resolver->render
// dispatch. streamworldresident.test.js's own hand-set-RAM tests are KEPT, not
// replaced -- they exercise sw_read_run/sw_peek_byte/sw_read_transaction/
// sw_render_window each in total isolation, which this file's real-boot test
// cannot do (a real boot never calls those directly; sw_resolve_screen's own
// sw_enter_screen->sw_goto chain does). What IS new here: proof the real loader
// (sw_resolve_screen, engine/streamworld.asm:1514-1599) sets the locator RAM from
// the emitted per-map data itself, on a real cold boot, rather than a test hand-
// setting it first.

// engine/constants.asm -- simple, non-chained equates, hardcoded per CLAUDE.md's
// own "a test that reads the file it is checking proves nothing" rule.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const FLAT_SCREEN = 0x16;
const GAME_STATE = 0x25;
const FRAME_CNT = 0x1b; // engine/constants.asm:34 -- incremented only by NMI
const MAP_IS_STREAMED = 0xfe;
const SW_COL_REGION = 0x05a3; // engine/constants.asm:970 -- sw_col div STREAM_SCREENS_PER_REGION
const SW_COL_BYTE_LO = 0x05a4; // engine/constants.asm:975
const SW_COL_BYTE_HI = 0x05a5; // engine/constants.asm:975
const SW_ROW_BANK_BASE = 0x05a6; // engine/constants.asm:977
const SW_BASE_BANK = 0x05a7;
const SW_REGIONS_PER_ROW = 0x05a8;
const SW_GRID_W = 0x05a9;
const SW_GRID_H = 0x05aa;
const SW_FILL_METATILE_ID = 0x05fd;
// cam_x_lo/cam_y_lo/cam_nt are chained relative equates (cam_x_lo = bt_walk_step+1,
// itself chained back through bt_miss_left/bt_hurt_slot/bt_fx_timer/... to the
// zero-page base) -- nesasm's own .fns symbol file lists code labels only, never
// zero-page equates (checked directly: no `= $` line in a real build's game.fns
// resolves to a two-hex-digit zero-page value), so unlike the plain literal
// equates above these cannot be read back from a build. Resolved instead by
// walking the whole equate chain in engine/constants.asm programmatically
// (scratchpad/resolve-equates.mjs) and cross-checked against player_x/player_y/
// flat_screen/game_state above, which the same resolution independently
// reproduced exactly -- then hardcoded here as literals, per the same
// "a test that reads the file it is checking proves nothing" rule the plain
// equates already follow.
const CAM_X_LO = 0xaf;
const CAM_Y_LO = 0xb0;
const CAM_NT = 0xb1;
const BDPTR_LO = 0x1c; // engine/constants.asm:35 -- esptr_lo, aliased as bdptr_lo
const BDPTR_HI = 0x1d; // engine/constants.asm:43 -- esptr_hi, aliased as bdptr_hi
const ST_GAMEPLAY = 0;
const UP = 4;
const DOWN = 5;
const LEFT = 6;
const RIGHT = 7;

// Independent of markMetatiles/expectedTileId in streamworldresident.test.js --
// this file builds its own project instance and must not trust that file's
// helpers describe it correctly. The terrain oracle itself (which metatile id
// sits at a given screen/local position) is NOT re-derived here the way
// streamworldresident.test.js restates it -- it comes from decoding the real
// emitStreamedLayout bytes via test/lib/streamdecoder.js instead (see the test
// body below), so a broken generator formula cannot silently agree with a
// matching re-derivation of the same formula in this file.
function markMetatiles(project) {
  for (let id = 0; id < 4; id++) {
    project.metatiles[id].tiles = [id * 4, id * 4 + 1, id * 4 + 2, id * 4 + 3];
    project.metatiles[id].palette = id;
  }
}
function expectedTileId(metatileId, tileCol, tileRow) {
  const quadrant = (tileRow % 2) * 2 + (tileCol % 2);
  return metatileId * 4 + quadrant;
}

// tile t's own 64 pixels: (t*7 + i) % 4 -- a distinct, position-dependent fill so
// two different tile ids never encode to the same 16 CHR bytes (a uniform
// per-tile fill would alias at only 4 possible whole-tile patterns for 16 tiles).
function markTilesetTiles(project, count = 16) {
  for (let t = 0; t < count; t++) {
    const pixels = new Uint8Array(64);
    for (let i = 0; i < 64; i++) pixels[i] = (t * 7 + i) % 4;
    project.tilesets[0].background.tiles[t] = tileToString(pixels);
  }
}

// The rendered window (all four physical nametables + attribute tables) against an
// INDEPENDENT expected image derived from `decoded` (test/lib/streamdecoder.js's own decode of
// the exact emitStreamedLayout bytes generate.js itself emits) -- never a self-comparison against
// an earlier snapshot of the same running ROM, which review finding 6 (phase 2 slice 2b fix round
// 1) found could be "equally incomplete" on both sides. Shared by the cold-boot render test and
// decision 7's non-fight-return test below, so a broken render cannot pass one and fail the other
// only because they duplicated the check slightly differently.
const NT_SCREEN = [
  { col: 0, row: 0 },
  { col: 1, row: 0 },
  { col: 0, row: 1 },
  { col: 1, row: 1 }
];
function assertWindowMatchesDecoded(nes, mem, decoded) {
  const ATTR_SHADOW = 0x0600;
  for (let nt = 0; nt < 4; nt++) {
    const { col: screenCol, row: screenRow } = NT_SCREEN[nt];
    const table = nes.ppu.nameTable[nes.ppu.ntable1[nt]];
    const terrain = decoded.screen(0, screenCol, screenRow).terrain;
    const terrainAt = (localCol, localRow) => terrain[localRow * 16 + localCol];
    for (let row = 0; row < 30; row++) {
      for (let col = 0; col < 32; col++) {
        const localCol = col >> 1;
        const localRow = row >> 1;
        const metatileId = terrainAt(localCol, localRow);
        const expected = expectedTileId(metatileId, col, row);
        const actual = table.tile[row * 32 + col];
        assert.equal(
          actual,
          expected,
          `nt ${nt} (row ${row}, col ${col}): expected quadrant tile ${expected} (screen ${screenCol},${screenRow}), got ${actual}`
        );
      }
    }
    for (let arow = 0; arow < 8; arow++) {
      for (let acol = 0; acol < 8; acol++) {
        const tl = terrainAt(acol * 2, arow * 2);
        const tr = terrainAt(acol * 2 + 1, arow * 2);
        const bl = arow === 7 ? 0 : terrainAt(acol * 2, arow * 2 + 1);
        const br = arow === 7 ? 0 : terrainAt(acol * 2 + 1, arow * 2 + 1);
        const expectedByte = tl | (tr << 2) | (bl << 4) | (br << 6);
        const actualByte = mem[ATTR_SHADOW + nt * 64 + arow * 8 + acol];
        assert.equal(actualByte, expectedByte, `nt ${nt} attribute cell (${arow},${acol})`);
      }
    }
  }
}

async function buildAndBoot(project, decoded) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworld-boot-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const bytes = new Uint8Array(fs.readFileSync(built.romPath));
    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(bytes);
    // Cold boot completes (through its own internal vblank polls) within very
    // few real frames -- no title, no naming (createStreamedProject's default),
    // so nothing here waits on player input. game_state/map_is_streamed/the
    // locator RAM are all set within the first handful of nes.frame() calls,
    // but sw_render_window's own four-nametable-plus-attribute redraw is CPU-
    // heavy enough that it spans several simulated NES frames' worth of cycle
    // budget (measured directly, scratchpad probe) -- poll instead of a hand-
    // tuned frame count that could drift with machine speed or a future
    // engine change to the routine's own cost. nt/arow/acol order is nt 0..3,
    // each nt's tiles then its attributes, arow/acol raster order within
    // attributes -- so nt 3 (the last nt), attribute cell (arow 2, acol 7) is
    // the LAST cell this project's own varied terrain (rows 0-4 only, the
    // rest is the fill metatile) guarantees a distinctive non-zero value;
    // only 5 more (all-fill, all-zero) attribute rows remain after it. Poll
    // for the EXACT expected byte, not merely "non-zero" -- cpu.js fills RAM
    // with 0xFF at reset (not 0), so a naive "!= 0" check is true before boot
    // even starts, and a naive "== 0" check would never fire at all; only an
    // exact-value match distinguishes power-on 0xFF, boot's own RAM-clear
    // (0x00), and this cell's real, distinctively non-zero rendered content.
    const ATTR_SHADOW = 0x0600;
    const mem = nes.cpu.mem;
    const nt3Arow2Acol7 = () => mem[ATTR_SHADOW + 3 * 64 + 2 * 8 + 7];
    // screen (1,1) is nt 3's own screen (NT_SCREEN below) -- read from the same
    // decoded terrain the assertions themselves check against, not a separate
    // re-derivation of it.
    const nt3Terrain = decoded.screen(0, 1, 1).terrain;
    const nt3At = (localCol, localRow) => nt3Terrain[localRow * 16 + localCol];
    const expectedNt3Arow2Acol7 = nt3At(14, 4) | (nt3At(15, 4) << 2) | (nt3At(14, 5) << 4) | (nt3At(15, 5) << 6);
    let frames = 0;
    while (nt3Arow2Acol7() !== expectedNt3Arow2Acol7 && frames < 200) {
      nes.frame();
      frames++;
    }
    assert.ok(frames < 200, 'boot must reach a fully-rendered window well within 200 frames');
    // A few more, cheap (all-fill) attribute cells remain after the polled
    // one -- negligible cost, but still worth a small pad past the poll.
    for (let i = 0; i < 5; i++) nes.frame();
    return { project, nes, mem };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test(
  "the generator's default streamed project, built through the real public path (buildProject, no test-only option) and booted for real, lands on its start screen via the real resolver/render dispatch",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({});
    markMetatiles(project);
    markTilesetTiles(project);
    const mapper = resolveMapper(project.cartridge.mapper);
    const plan = planStreamedRegions(project, mapper);
    assert.ok(plan.baseBanks, "this project's streamed map must fit on UNROM 512");
    // The brief's own oracle for "what terrain did the build actually emit": decode the SAME
    // emitStreamedLayout call generate.js itself makes (baseBanks from the same plan), via
    // test/lib/streamdecoder.js -- never a second copy of the read routine, and no re-derivation
    // of streamedproject.js's own terrain formula the way streamworldresident.test.js's isolated
    // tests restate it (this test instead reads back what the real pipeline really wrote).
    const layout = emitStreamedLayout(project, { baseBanks: plan.baseBanks });
    const decoded = decodeStreamedLayout(layout);

    const { nes, mem } = await buildAndBoot(project, decoded);

    // Landed in real gameplay, not stuck in some other state.
    assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'cold boot must land in ST_GAMEPLAY');
    assert.equal(mem[MAP_IS_STREAMED], 1, 'the start screen is the streamed map -- map_is_streamed must be set');
    assert.equal(mem[FLAT_SCREEN], 0, "createStreamedProject's start screen is global id 0 (map 0, screen (0,0))");

    // The real loader (sw_resolve_screen) must have set the per-map locator RAM
    // from the EMITTED data (planStreamedRegions -- the exact function
    // generate.js itself calls for the real build), not from a test hand-setting
    // it the way streamworldresident.test.js's own routine-isolation tests do.
    assert.equal(mem[SW_BASE_BANK], plan.baseBanks[0], 'sw_base_bank must be loaded from the emitted per-map data');
    assert.equal(mem[SW_REGIONS_PER_ROW], Math.ceil(project.maps[0].gridW / 24), 'sw_regions_per_row');
    assert.equal(mem[SW_GRID_W], project.maps[0].gridW, 'sw_grid_w');
    assert.equal(mem[SW_GRID_H], project.maps[0].gridH, 'sw_grid_h');
    assert.equal(mem[SW_FILL_METATILE_ID], project.maps[0].fillMetatileId ?? 0, 'sw_fill_metatile_id');

    // The landing frame's scroll (Part A): screen (0,0) is even/even, so cam_nt
    // (bit0 = screenCol&1, bit1 = screenRow&1) must be 0, and the window is
    // aligned to the screen's own top-left corner, so both scroll bytes are 0.
    // Checked via the RAM the resolver writes and boot then copies verbatim to
    // $2000/$2005/$2005 (the brief's own "or the RAM it reads" alternative).
    assert.equal(mem[CAM_NT], 0, 'cam_nt at screen (0,0)');
    assert.equal(mem[CAM_X_LO], 0, 'cam_x_lo at a screen-aligned landing');
    assert.equal(mem[CAM_Y_LO], 0, 'cam_y_lo at a screen-aligned landing');

    // The rendered window: all four physical nametables + attribute tables, the
    // same 2x2-screen-window math streamworldresident.test.js's isolated
    // sw_render_window test already proved correct in isolation -- this proves
    // the real boot path actually reaches it with the right window origin.
    // (attr_shadow, 0x0600: sw_render_window stages attribute data there, not
    // directly to the PPU's own $23C0 region -- NMI's vram_buf drain uploads it
    // there gradually over subsequent frames, CLAUDE.md's own budget-per-frame
    // rule -- so reading the PPU attribute bytes back would depend on drain
    // timing this test has no business coupling to.)
    assertWindowMatchesDecoded(nes, mem, decoded);

    // The CHR bytes the landing uploaded: chr_ram_init streams the project's own
    // tileset into CHR-RAM at boot, before any rendering -- read the real
    // pattern-table VRAM back for the tile ids this screen's metatiles actually
    // reference (0-15, markTilesetTiles' own distinct-per-tile fill) and compare
    // against shared/chr.js's own encoder, an independent reimplementation of
    // the identical 2bpp planar format the project data and the PPU both use.
    for (let t = 0; t < 16; t++) {
      const pixels = tileFromString(project.tilesets[0].background.tiles[t]);
      const expectedBytes = encodeTile(pixels);
      const actualBytes = Array.from({ length: 16 }, (_, i) => nes.ppu.vramMem[t * 16 + i]);
      assert.deepEqual(actualBytes, Array.from(expectedBytes), `pattern-table bytes for tile ${t}`);
    }

    // The palette bytes the landing uploaded: load_palette writes palette_data
    // (16 BG bytes then 16 sprite bytes, main/build/generate.js) straight to
    // $3F00 -- read the real PPU palette RAM back and compare against the
    // project's own authored colours, flattened in the same order.
    const expectedBg = project.palettes.bg.flat();
    const actualBg = Array.from({ length: 16 }, (_, i) => nes.ppu.vramMem[0x3f00 + i]);
    assert.deepEqual(actualBg, expectedBg, "background palette RAM must hold the project's own authored colours");

    // Part C's own placeholder was an "interim wall" that refused every crossing outright; phase 2
    // slice 4b replaced it with the real thing (fix round 1, rulings A/D), so screen (0,0)'s right
    // edge -- bordering screen (1,0), a REAL neighbour in this project's 3x2 grid -- must now cross
    // into it, updating flat_screen to the new screen's own global id at the ownership commit
    // (finding 4) rather than holding the player at the edge. Enough frames to reach and cross the
    // edge at SW_SPEED_SUB_X's own cadence from startX=120.
    const flatScreenBefore = mem[FLAT_SCREEN];
    for (let i = 0; i < 150; i++) {
      nes.buttonDown(1, RIGHT);
      nes.frame();
    }
    nes.buttonUp(1, RIGHT);
    assert.equal(mem[FLAT_SCREEN], flatScreenBefore + 1, "crossing right onto a real neighbour must update flat_screen to the new screen's own global id");
    assert.equal(mem[MAP_IS_STREAMED], 1, 'still on the streamed map after the crossing');
    assert.ok(mem[PLAYER_X] < 256, 'player_x must be wrapped, not left unbounded, after the crossing');
  }
);

test(
  "the fill metatile from a spawned CLI build (main/build/cli.js) of a generator-written directory carries the project's own non-zero fillMetatileId",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworld-fillcli-'));
    try {
      // Spawned, not saveProject called in-process (streamworldresident.test.js's
      // own reasoning: this is the ONLY way to prove the real on-disk format and
      // the real CLI agree, not a hand-rolled in-process shortcut).
      const gen = spawnSync(process.execPath, [path.join(process.cwd(), 'test', 'lib', 'streamedproject.js'), dir], { encoding: 'utf8' });
      assert.equal(gen.status, 0, `generator CLI must exit 0: ${gen.stderr}`);

      const projectJson = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
      const mapFile = path.join(dir, 'maps', '0.json');
      const mapJson = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
      // Part E fixed normalizeMap's own pre-existing gap (it used to drop
      // fillMetatileId); set a non-zero value directly in the on-disk map file
      // so this test does not depend on the generator's own default (0) ever
      // changing, and re-save it in the exact on-disk shape loadProject expects.
      mapJson.fillMetatileId = 2;
      fs.writeFileSync(mapFile, JSON.stringify(mapJson));

      const result = spawnSync(process.execPath, [path.join(process.cwd(), 'main', 'build', 'cli.js'), dir], { encoding: 'utf8' });
      assert.equal(result.status, 0, `CLI build must succeed: ${result.stdout}\n${result.stderr}`);

      const loaded = await loadProject(dir);
      const streamedMap = loaded.maps.find((m) => m.streamed === true);
      assert.equal(streamedMap.fillMetatileId, 2, 'loadProject must read the hand-edited fillMetatileId back');

      const bytes = new Uint8Array(fs.readFileSync(path.join(dir, 'build', 'game.nes')));
      const symbols = fs.readFileSync(path.join(dir, 'build', 'game.fns'), 'utf8');
      const addrOf = (label) => {
        const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
        assert.ok(m, `${label} should be a named symbol in game.fns`);
        return parseInt(m[1], 16);
      };
      const mapper = resolveMapper(loaded.cartridge.mapper);
      const plan = planStreamedRegions(loaded, mapper);
      assert.ok(plan.baseBanks, "this project's streamed map must fit");
      const layout = emitStreamedLayout(loaded, { baseBanks: plan.baseBanks });
      const layoutInfo = prgLayout(mapper);
      const streamedMapEntry = layout.maps.find((m) => m.streamed);
      const region = streamedMapEntry.regions[0];
      const org = layoutInfo.regions.find((x) => x.nesasmBank === region.region).org;
      const prgBank = layoutInfo.regions.find((x) => x.nesasmBank === region.region).prgBank;
      const fileOffset = 16 + prgBank * 16384 + (org - 0x8000);
      const regionBytes = bytes.slice(fileOffset, fileOffset + region.bytes.length);
      assert.ok(Array.from(regionBytes).some((b) => b === 2), "sanity: the CLI-built ROM's terrain still carries a metatile id 2 somewhere (not itself proof of the fill byte)");
      assert.equal(addrOf(`stream_region_${region.region}`), org, "stream_region label must sit at generate.js's own computed origin");

      // The terrain-byte scan above only ever coincidentally matched fill metatile id 2
      // against the same value appearing in the streamedProject fixture's own varied
      // terrain pattern -- it never actually read the fill metadata. stream_columns
      // (assets/streamed.inc, included right after kernel_lo.inc with no .bank/.org of
      // its own -- engine/main.asm) is the real, single place the fill id is emitted,
      // and it lives in the fixed kernel-lo bank, so it is mapped at boot with no
      // file-offset/bank math needed, unlike the switchable stream_region_N terrain.
      const nes = new NES({ onFrame: () => {}, emulateSound: false });
      nes.loadROM(bytes);
      const streamColumnsAddr = addrOf('stream_columns');
      const fillAddr = streamColumnsAddr + streamedMapEntry.streamedMapIndex * STREAM_MAP_COLUMN_BYTES + STREAM_MAP_COLUMNS.fill;
      assert.equal(nes.cpu.mem[fillAddr], 2, "stream_columns's own fill byte for this map must carry the hand-edited fillMetatileId, not the generator's default 0");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  'landing on a streamed map\'s own grid corner renders its off-grid neighbour nametables as the fill metatile, not leftover/garbage tile data',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    // sw_resolve_screen (engine/streamworld.asm ~1623) sets the window's own origin
    // (win_col_screen/win_row_screen) directly to the LANDED screen's own coordinates,
    // with no clamping at landing time. Phase 2 slice 4b made sw_clamp_col/sw_clamp_row
    // (dead code when this test was first written) live: sw_frame_camera_window now runs
    // unconditionally every frame once map_is_streamed, sliding the window toward its own
    // player-centred, clamped-to-the-grid desired origin -- and for a landing at the
    // grid's own bottom-right corner, that clamped desired origin is NOT the raw landing
    // value (a 2-screen-wide window on a 3-screen-wide grid clamps its max origin to
    // screen 1, not screen 2), so the corner's own window begins sliding away from the
    // landing value within a handful of frames of the initial render completing --
    // confirmed directly (scratchpad probe): unchanged through the render-settle poll
    // below, then moving by the 4th frame after it. This test's own invariant (no
    // leftover/garbage tile data for an off-grid neighbour) is real only in the window
    // BEFORE the arm has moved anything, so it asserts immediately at the render-settle
    // poll's own exit frame, with no extra frames afterward, and pins that precondition
    // explicitly (below) rather than relying on an unchecked frame count. gridH: 3 (not
    // the fixture's own default 2) keeps BOTH win_col_screen and win_row_screen even at
    // that corner: sw_render_window's four physical nametables are a torus whose
    // nt-to-screen-offset mapping flips with win_col_screen/win_row_screen's own parity
    // (sw_rw_ntx/nty are fixed per nt index; wbase_col/row's (screen&1)*16-or-15 term is
    // what actually picks which physical nt currently holds "this screen" vs "the next
    // one"), and every other test in this file already lands on (0,0) -- even on both
    // axes, where the clamp's lower bound already coincides with the landing value, so
    // the arm has nowhere to slide -- so this is the first test to depend on that parity
    // at all.
    const project = createStreamedProject({ gridH: 3 });
    markMetatiles(project);
    markTilesetTiles(project);
    const streamedMap = project.maps.find((m) => m.streamed === true);
    const FILL_ID = 1; // non-zero, so its rendered tiles/attribute bits are distinguishable from cleared RAM
    streamedMap.fillMetatileId = FILL_ID;
    const mapIndex = project.maps.indexOf(streamedMap);
    project.project.startMap = mapIndex;
    const cornerCol = streamedMap.gridW - 1;
    const cornerRow = streamedMap.gridH - 1;
    assert.equal(cornerCol % 2, 0, 'sanity: this test only means what it says at even screen parity');
    assert.equal(cornerRow % 2, 0, 'sanity: this test only means what it says at even screen parity');
    project.project.startScreen = cornerRow * streamedMap.gridW + cornerCol;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworld-corner-'));
    try {
      await saveProject(dir, project);
      const built = await buildProject({ dir, project, log: () => {} });
      const mapper = resolveMapper(project.cartridge.mapper);
      const plan = planStreamedRegions(project, mapper);
      assert.ok(plan.baseBanks, "this project's streamed map must fit");
      const layout = emitStreamedLayout(project, { baseBanks: plan.baseBanks });
      const decoded = decodeStreamedLayout(layout);

      const bytes = new Uint8Array(fs.readFileSync(built.romPath));
      const nes = new NES({ onFrame: () => {}, emulateSound: false });
      nes.loadROM(bytes);
      const mem = nes.cpu.mem;
      const ATTR_SHADOW = 0x0600;
      // nt 3 is the diagonal neighbour -- entirely off-grid here -- so its own
      // attribute bytes, once rendered, are a fixed known constant: FILL_ID packed
      // into all four quadrants. Poll for the LAST cell in this window's own render
      // order (nt 0..3, each nt's tiles then its attributes, raster order within
      // attributes -- so nt 3's own last attribute cell, (arow 6, acol 7), the last
      // cell this loop below itself checks, is the last byte written), not merely
      // nt 3's first cell: this scenario has no varied terrain anywhere in nt 1-3 to
      // give an earlier cell a distinctive non-fill value, so polling only the first
      // cell can report "rendered" while later cells in the same nt are still the
      // power-on-0xFF/cleared-0x00 buildAndBoot's own comment describes, not yet
      // written.
      const expectedFillAttrByte = FILL_ID | (FILL_ID << 2) | (FILL_ID << 4) | (FILL_ID << 6);
      const nt3AttrLast = () => mem[ATTR_SHADOW + 3 * 64 + 6 * 8 + 7];
      let frames = 0;
      while (nt3AttrLast() !== expectedFillAttrByte && frames < 200) {
        nes.frame();
        frames++;
      }
      assert.ok(frames < 200, 'boot must reach a fully-rendered window well within 200 frames');
      // Phase 2 slice 4b's own continuous camera-feed arm (sw_frame_camera_window,
      // called unconditionally every frame once map_is_streamed) starts sliding this
      // corner's window away from the raw landing origin within a handful of frames --
      // asserting anything past this exact frame would be checking the arm's own
      // correct, in-progress convergence, not landing's leftover-garbage invariant.
      // Pin the precondition explicitly instead of trusting an unchecked frame count.
      const WIN_COL_SCREEN = 0x5b1, WIN_COL_LOCAL = 0x5b2, WIN_ROW_SCREEN = 0x5b3, WIN_ROW_LOCAL = 0x5b4;
      assert.deepEqual(
        [mem[WIN_COL_SCREEN], mem[WIN_COL_LOCAL], mem[WIN_ROW_SCREEN], mem[WIN_ROW_LOCAL]],
        [cornerCol, 0, cornerRow, 0],
        'the window origin must still be the raw landing corner at this exact frame -- if not, the arm has already begun sliding it and the assertions below no longer mean what they say'
      );

      for (let nt = 1; nt <= 3; nt++) {
        const table = nes.ppu.nameTable[nes.ppu.ntable1[nt]];
        for (let row = 0; row < 30; row++) {
          for (let col = 0; col < 32; col++) {
            const expected = expectedTileId(FILL_ID, col, row);
            assert.equal(table.tile[row * 32 + col], expected, `nt ${nt} (row ${row}, col ${col}) off-grid must render the fill metatile`);
          }
        }
        for (let arow = 0; arow < 7; arow++) {
          for (let acol = 0; acol < 8; acol++) {
            assert.equal(mem[ATTR_SHADOW + nt * 64 + arow * 8 + acol], expectedFillAttrByte, `nt ${nt} attribute cell (${arow},${acol}) off-grid must render the fill metatile`);
          }
        }
      }
      // nt0 is the landed corner screen itself -- real, authored terrain, checked
      // against the same decoded oracle assertWindowMatchesDecoded uses elsewhere.
      const nt0Table = nes.ppu.nameTable[nes.ppu.ntable1[0]];
      const terrain = decoded.screen(0, cornerCol, cornerRow).terrain;
      for (let row = 0; row < 30; row++) {
        for (let col = 0; col < 32; col++) {
          const metatileId = terrain[(row >> 1) * 16 + (col >> 1)];
          assert.equal(nt0Table.tile[row * 32 + col], expectedTileId(metatileId, col, row), `nt 0 (row ${row}, col ${col}) must match the landed screen's own authored terrain`);
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

// -------------------------------------------------- non-fight return (decision 7)

// mapper_shadow ($35, engine/constants.asm:67) is the whole mapper latch's own zero-page
// shadow -- PRG bank bits, the CHR page and the mirroring bit all live in this one byte on
// UNROM 512, write_mapper_reg's only writer -- so comparing it before/after IS comparing the
// whole latch (PRG, CHR and mirroring together), not just the PRG piece.
const MAPPER_SHADOW = 0x35;
// The persistently-maintained per-screen locator RAM sw_locate_current rebuilds mtptr/the PRG
// bank from (engine/constants.asm:967-978) -- sw_col..sw_base_bank, contiguous.
const SW_COL = 0x05a0;
const SW_LOCATOR_LEN = 8; // sw_col, sw_row, sw_col_rem, sw_col_region, sw_col_byte_lo/hi, sw_row_bank_base, sw_base_bank
const BE_RESTORE = 3; // engine/constants.asm:1215 -- a non-fight call_battle entry, distinct from BE_INIT
const MTPTR_LO = 0x02; // engine/constants.asm:8 -- current screen's own terrain pointer
const MTPTR_HI = 0x03; // engine/constants.asm:9

test(
  "decision 7's non-fight return: a non-naming streamed RPG boots through BE_INIT -> call_battle -> set_screen_ptr (init_session's own tail call, engine/combat.asm), and calling call_battle again directly with a second non-fight entry (BE_RESTORE) leaves the rendered window, map_is_streamed, the locator RAM and the whole mapper latch (both this engine's own shadow byte and jsnes's independent, effective CHR page) exactly as they were -- proving set_screen_ptr's streamed branch (sw_locate_current) restores what the field expects rather than running its ordinary path (sabotage case 17) or leaving the battle bank switched in",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    // D.6's own positive shape (gameType 'rpg', createStreamedProject's naming default is off) --
    // the accepted positive control for a streamed RPG per decision 7: exempt from the fight
    // predicate, but not naming-refused, so this project builds and boots to real ST_GAMEPLAY.
    const project = createStreamedProject({ gameType: 'rpg' });
    markMetatiles(project);
    // Fix round 1, finding 6: give the streamed map itself a NONZERO CHR page. An RPG project
    // already carries a second tileset ("Battle") by createProject's own default, so pointing the
    // streamed map at tileset 1 would need no new tileset -- but doing that makes the streamed
    // map's own field PRG bank COINCIDE with BATTLE_BANK for this exact fixture (both land on
    // bank 1, measured directly: main/build/generate.js's codeRegions/battle-bank placement is
    // independent of streamed region placement, but happens to agree here) -- which would make
    // fix round 2, finding 1's own new PRG-bank assertion below blind to its own named mutation
    // (restoring mapper_shadow but leaving the HARDWARE on BATTLE_BANK): before.prgBank and
    // after.prgBank would both read BATTLE_BANK's own value even though the "restore" never ran.
    // A third tileset (never touched by the battle system) gives the streamed map its own CHR
    // page AND its own field bank, verified distinct from BATTLE_BANK for this project shape.
    project.tilesets.push(createTileset(2, 'Extra'));
    const streamedMap = project.maps.find((m) => m.streamed === true);
    streamedMap.tilesetId = 2;
    const EXPECTED_CHR_PAGE = 2;

    const mapper = resolveMapper(project.cartridge.mapper);
    const plan = planStreamedRegions(project, mapper);
    assert.ok(plan.baseBanks, "this project's streamed map must fit");
    const layout = emitStreamedLayout(project, { baseBanks: plan.baseBanks });
    const decoded = decodeStreamedLayout(layout);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworld-nonfight-'));
    try {
      await saveProject(dir, project);
      const built = await buildProject({ dir, project, log: () => {} });
      const symbols = fs.readFileSync(built.symbolPath, 'utf8');
      const addrOf = (label) => {
        const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
        assert.ok(m, `${label} should be a named symbol in game.fns`);
        return parseInt(m[1], 16);
      };
      const callBattle = addrOf('call_battle');
      const swLocateCurrent = addrOf('sw_locate_current');

      const bytes = new Uint8Array(fs.readFileSync(built.romPath));
      const nes = new NES({ onFrame: () => {}, emulateSound: false });
      nes.loadROM(bytes);
      const mem = nes.cpu.mem;

      // Cold boot: init_session's own tail call (`lda #BE_INIT / jmp call_battle`,
      // engine/combat.asm:161) already runs call_battle -> set_screen_ptr once, before the
      // streamed start screen is ever drawn -- landing correctly in ST_GAMEPLAY, on the
      // streamed map, is itself proof BE_INIT's own pass through this path did not corrupt
      // anything (streamworld.test.js's render/boot test above already covers that render in
      // full detail); this test's own job starts from there.
      let frames = 0;
      while ((mem[GAME_STATE] !== ST_GAMEPLAY || mem[MAP_IS_STREAMED] !== 1) && frames < 200) {
        nes.frame();
        frames++;
      }
      assert.ok(frames < 200, 'boot must reach ST_GAMEPLAY on the streamed start screen well within 200 frames');

      // Fix round 1, finding 6: wait for a real completed landing/mainline boundary, not a fixed
      // frame count. redraw_screen (engine/screens.asm) disables NMI ($2000 write) for its whole
      // body, including the entire streamed render -- frame_cnt (incremented only by NMI,
      // engine/boot.asm) is therefore genuinely frozen for as long as the render is still running,
      // and only resumes once the streamed branch's own PPUCTRL_ON write re-enables NMI at the
      // very end (engine/screens.asm's redraw_screen_dispatch). Polling for it to advance again is
      // a real engine invariant, not a padded guess -- the review's own trace found the old fixed
      // 20-frame version still mid-render (PC inside sw_rw_read_metatile).
      const frameCntAtLanding = mem[FRAME_CNT];
      let settleFrames = 0;
      while (mem[FRAME_CNT] === frameCntAtLanding && settleFrames < 300) {
        nes.frame();
        settleFrames++;
      }
      assert.ok(
        settleFrames < 300,
        'frame_cnt must resume advancing (NMI re-enabled) once the streamed landing genuinely completes, within 300 frames'
      );

      // Fix round 1, finding 6: the completed window checked against an INDEPENDENT expected
      // image (assertWindowMatchesDecoded, shared with the cold-boot render test above) -- not
      // merely a before/after self-comparison, which could be equally incomplete on both sides.
      assertWindowMatchesDecoded(nes, mem, decoded);

      // Fix round 1, finding 6: the effective, emulator-reported CHR page (nes.mmap.chrPage,
      // Mapper30's own live state -- renderer/emulator/core/mappers/mapper30.js) alongside the
      // software shadow byte (mapper_shadow), proving the real hardware-visible latch actually
      // starts nonzero, not only this engine's own bookkeeping of it.
      assert.equal(nes.mmap.chrPage, EXPECTED_CHR_PAGE, "sanity: the streamed map's own nonzero tileset must have actually selected a nonzero CHR page");
      assert.equal((mem[MAPPER_SHADOW] >> 5) & 0x03, EXPECTED_CHR_PAGE, "sanity: mapper_shadow's own CHR-page bits (5-6) must agree with the effective CHR page");

      const snapshotLocator = () => Array.from({ length: SW_LOCATOR_LEN }, (_, i) => mem[SW_COL + i]);

      // Fix round 2, finding 1: settled idle gameplay makes zero mapper writes (re-confirmed this
      // round with a debug probe against this exact fixture) -- the prior comment claiming a
      // per-frame rendering probe transiently switched the PRG bank during idle play was wrong.
      // sw_locate_current is still called explicitly here for the same reason decision 7's own
      // completed-landing wait exists: it pins the locator snapshot to the one deterministic value
      // that routine produces from today's locator RAM, rather than trusting an arbitrary
      // single-frame sample.
      callRoutine(nes, swLocateCurrent);

      const before = {
        mapIsStreamed: mem[MAP_IS_STREAMED],
        locator: snapshotLocator(),
        mapperShadow: mem[MAPPER_SHADOW],
        chrPage: nes.mmap.chrPage,
        // Fix round 2, finding 1: nes.mmap.prgBank is Mapper30's own effective, hardware-facing
        // PRG bank register (renderer/emulator/core/mappers/mapper30.js) -- independent of
        // mapper_shadow, this engine's own software bookkeeping of the same latch.
        prgBank: nes.mmap.prgBank,
        // Fix round 2, finding 1: nes.ppu.ntable1 is jsnes's own effective nametable-select table
        // (renderer/emulator/core/ppu/index.js) -- [0,1,2,3] identity is what FOUR-SCREEN mirroring
        // resolves to. On this board/header, UNROM 512's register bit 7 does NOT select mirroring
        // (mapperControlsMirroring is only true when the header itself asked for mapper-controlled
        // mirroring, which a four-screen header never does -- mapper30.js:237,261) -- so this proves
        // the four-screen mapping stays intact across the round trip, but does not and cannot
        // exercise a mirroring-latch bit this board never uses.
        ntable1: nes.ppu.ntable1.slice(),
        mtptr: [mem[MTPTR_LO], mem[MTPTR_HI]]
      };

      // A second, DIFFERENT non-fight entry point than the one boot already exercised --
      // BE_RESTORE (continue_game's own call, engine/save.asm:558), which needs only the
      // party's own pc_level already populated (BE_INIT's own job, already done by boot above)
      // to recompute spells/hp_max/mp_max safely. Driven directly (test/lib/callroutine.js),
      // not through the whole Continue/load-a-save flow -- decision 7 is about set_screen_ptr's
      // own streamed branch, not save/load, and D.7 refuses live Save on a streamed project
      // anyway (Continue itself is a different mechanism, out of this test's scope).
      nes.cpu.REG_ACC = BE_RESTORE;
      callRoutine(nes, callBattle);

      const after = {
        mapIsStreamed: mem[MAP_IS_STREAMED],
        locator: snapshotLocator(),
        mapperShadow: mem[MAPPER_SHADOW],
        chrPage: nes.mmap.chrPage,
        prgBank: nes.mmap.prgBank,
        ntable1: nes.ppu.ntable1.slice(),
        mtptr: [mem[MTPTR_LO], mem[MTPTR_HI]]
      };

      assert.equal(after.mapIsStreamed, before.mapIsStreamed, 'map_is_streamed must be unchanged by a non-fight call_battle round trip');
      assert.deepEqual(after.locator, before.locator, 'the locator RAM (sw_col..sw_base_bank) must be unchanged');
      assert.equal(
        after.mapperShadow,
        before.mapperShadow,
        'the whole mapper latch (PRG bank, CHR page and mirroring bit, all one byte on UNROM 512) must be restored, not left on the battle bank'
      );
      // Fix round 1, finding 6: the named mutation (switch_prg_bank's `and #$E0` -> `and #$00`,
      // engine/banks.asm) discards the CHR/mirroring bits on every PRG switch -- sw_locate_current's
      // own restoring switch_prg_bank call would then leave chrPage at 0 regardless of what it was
      // before. mapper_shadow alone (compared above) is this engine's own bookkeeping; nes.mmap.
      // chrPage is jsnes's INDEPENDENT, hardware-facing state -- both must agree, or a shadow byte
      // that "looks right" while the real latch is wrong would pass silently.
      assert.equal(
        after.chrPage,
        before.chrPage,
        "the effective, emulator-reported CHR page must be restored too, not just this engine's own mapper_shadow byte"
      );
      assert.equal(after.chrPage, EXPECTED_CHR_PAGE, 'the effective CHR page must still be the nonzero one the streamed map actually uses (pre-fix mutation: 0)');
      // Fix round 2, finding 1: the named second mutation (set_screen_ptr's streamed return calls
      // sw_locate_current, saves the restored shadow, switches the HARDWARE back to BATTLE_BANK,
      // then restores only mapper_shadow) leaves mapper_shadow and jsnes's chrPage both correct
      // (BATTLE_BANK's own CHR/mirroring bits happen to be the field's own, since only the PRG bits
      // differ) while the real, effective PRG bank stays wrong -- neither of the checks above can
      // catch that; only the emulator's own independent, hardware-facing bank register can.
      assert.equal(
        after.prgBank,
        before.prgBank,
        'the effective PRG bank (nes.mmap.prgBank, independent of mapper_shadow) must be restored to the field bank, not left on the battle bank'
      );
      // Fix round 2, finding 1: proves the four-screen nametable mapping this board actually uses
      // is unperturbed by the round trip. Documented above: this board's header does not hand
      // mirroring control to the mapper, so bit 7 of the register BE_RESTORE's own switch_prg_bank
      // call writes never reaches setMirroring at all -- this cannot and does not claim to exercise
      // that bit.
      assert.deepEqual(after.ntable1, before.ntable1, 'the effective four-screen nametable mapping must be unchanged by a non-fight call_battle round trip');
      assert.deepEqual(before.ntable1, [0, 1, 2, 3], 'sanity: four-screen mirroring must actually be the four independent physical nametables, not a coincidentally-identical mirrored pair');
      // mtptr_lo/hi (the current screen's own terrain pointer, engine/constants.asm:8-9) is the
      // OTHER half of what set_screen_ptr's streamed branch restores -- the ordinary path's own
      // sabotage (running screen_bank/screen_mt_lo/hi,y off an ordinary table this all-streamed
      // project never populates) can leave mapper_shadow coincidentally unchanged while still
      // pointing mtptr at garbage, so this is checked as its own, independently load-bearing
      // assertion, not folded into the mapper-latch one above.
      assert.deepEqual(after.mtptr, before.mtptr, 'mtptr_lo/hi (the current screen pointer) must be unchanged by a non-fight call_battle round trip');
      // Fix round 1, finding 6: re-check the FULL rendered window against the same independent
      // expected image again -- not merely equality against the "before" snapshot, which the
      // review found could itself have been mid-render.
      assertWindowMatchesDecoded(nes, mem, decoded);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

// ------------------------------------------------------------ tile_switch_changed / streamed current screen

test(
  "tile_switch_changed's own second (ROM-side, flip-queueing) walk must not index screen_bound_lo/hi by the GLOBAL flat_screen id while the player stands on a streamed screen: rebuild_bound_cache_dispatch (engine/screens.asm) already anticipates a Set/Clear reaching here from an ordinary map's own event while flat_screen names a streamed screen (its own comment says so), but a second, independent consumer of the same fact needs its own guard, not a shared one it never actually reaches",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    // mixed:true carries an ordinary Before map (4 screens, global ids 0-3) around the streamed
    // one (6 screens, global ids 4-9, the createStreamedProject default 3x2 grid) and an ordinary
    // After map (4 screens, global ids 10-13) -- so the ordinary-only screen_bound_lo/hi table has
    // exactly 8 rows (Before's 4 + After's 4), indices 0-7. A bound tile authored on Before's own
    // screen 0 is what turns BOUND_TILE_ENABLED on at all (projectUsesBoundTiles).
    const project = createStreamedProject({ gameType: 'action', mixed: true });
    const beforeMap = project.maps.find((m) => m.name === 'Before');
    beforeMap.screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: 1 }];

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworld-tsc-'));
    try {
      await saveProject(dir, project);
      const built = await buildProject({ dir, project, log: () => {} });
      const symbols = fs.readFileSync(built.symbolPath, 'utf8');
      const addrOf = (label) => {
        const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
        assert.ok(m, `${label} should be a named symbol in game.fns`);
        return parseInt(m[1], 16);
      };
      const tileSwitchChanged = addrOf('tile_switch_changed');

      const bytes = new Uint8Array(fs.readFileSync(built.romPath));
      const nes = new NES({ onFrame: () => {}, emulateSound: false });
      nes.loadROM(bytes);
      const mem = nes.cpu.mem;

      let frames = 0;
      while (mem[GAME_STATE] !== ST_GAMEPLAY && frames < 200) {
        nes.frame();
        frames++;
      }
      assert.ok(frames < 200, 'boot must reach ST_GAMEPLAY on the ordinary Before map well within 200 frames');
      assert.equal(mem[MAP_IS_STREAMED], 0, 'the start map is the ordinary Before map, not the streamed one');

      // Simulate "the player is standing on the streamed map's own last screen" (global id 9 --
      // past the ordinary table's 8 valid rows, so the pre-fix bug's `ldy <flat_screen` reads
      // genuinely out of the ROM table, not merely the wrong-but-in-range row) directly via RAM,
      // the same technique the non-fight-return test above uses to pin a deterministic starting
      // state rather than trusting wherever idle gameplay happens to have left things.
      mem[MAP_IS_STREAMED] = 1;
      mem[FLAT_SCREEN] = 9;

      // A sentinel bdptr_lo/hi, distinct from any real ROM pointer this build could produce --
      // the fix's own early return (map_is_streamed set -> tsc_done) must never touch these at
      // all; the pre-fix bug always does (`sta <bdptr_lo` / `sta <bdptr_hi` run unconditionally).
      mem[BDPTR_LO] = 0xab;
      mem[BDPTR_HI] = 0xcd;

      nes.cpu.REG_ACC = 0; // the switch number authored on Before's own bound tile
      callRoutine(nes, tileSwitchChanged);

      assert.equal(mem[BDPTR_LO], 0xab, 'bdptr_lo must be untouched: tile_switch_changed must not read screen_bound_lo,<flat_screen> while map_is_streamed is set');
      assert.equal(mem[BDPTR_HI], 0xcd, 'bdptr_hi must be untouched: tile_switch_changed must not read screen_bound_hi,<flat_screen> while map_is_streamed is set');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

// ==================================================================================
// Phase 2 slice 2b, fix round 1: regression tests for the review's MAJOR findings.

// Builds a project with `count` streamed 1x1 maps, each with its own distinct
// fillMetatileId (0..count-1) so a resolver reading the wrong map's locator row
// reads a distinctly wrong value rather than one that could coincidentally match.
function manyStreamedMapsProject(count) {
  const project = createProject('Streamed Many-Maps Test', 'action');
  project.cartridge.mapper = 30; // UNROM 512
  project.cartridge.mirroring = 'fourscreen';
  project.cartridge.camera = true;
  project.maps = [];
  for (let i = 0; i < count; i++) {
    const map = createMap(i, `Map ${i}`);
    map.gridW = 1;
    map.gridH = 1;
    map.streamed = true;
    map.fillMetatileId = i;
    map.tilesetId = 0;
    map.screens = [createScreen()];
    project.maps.push(map);
  }
  return project;
}

// Fix round 2, finding 3 (R3): map_is_streamed is set at sw_resolve_owner_streamed's own FIRST
// instruction (engine/streamworld.asm:1548), before the locator fields, the division or
// sw_enter_screen ever run -- so polling for it alone (the pre-fix1 F1 tests' own oracle) proves
// nothing about whether entry actually completed. Reuse decision 7's own completed-landing marker
// instead: frame_cnt (incremented only by NMI) is frozen for the whole streamed render (redraw's
// forced-blank window) and only resumes once the landing genuinely finishes.
function waitForCompletedStreamedLanding(nes, mem) {
  // map_is_streamed only proves sw_resolve_owner_streamed was ENTERED (it is that routine's own
  // first instruction, :1548, before the locator reads, the division loop or sw_enter_screen);
  // a hang inside sw_resolve_divloop itself (which a garbage divisor from the carry-loss bug this
  // file regresses against COULD cause: gridW=0 makes its bcc never taken) would leave frame_cnt
  // frozen forever with map_is_streamed already 1 -- this first wait alone would not observe it.
  // The frame_cnt wait below is what actually proves the landing, divloop included, finished.
  let frames = 0;
  while (mem[MAP_IS_STREAMED] !== 1 && frames < 200) {
    nes.frame();
    frames++;
  }
  assert.ok(frames < 200, 'sw_resolve_owner_streamed must be entered (map_is_streamed set) within 200 frames');
  const frameCntAtLanding = mem[FRAME_CNT];
  let settleFrames = 0;
  while (mem[FRAME_CNT] === frameCntAtLanding && settleFrames < 300) {
    nes.frame();
    settleFrames++;
  }
  assert.ok(settleFrames < 300, 'frame_cnt must resume advancing (NMI re-enabled) once the streamed landing genuinely completes, within 300 frames');
}

test(
  'F1: a streamed map at index 43+ resolves its own locator row instead of wrapping an 8-bit offset back into an earlier row',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    // The review's own exact repro: 44 streamed 1x1 maps, startMap the 44th
    // (streamedMapIndex 43 -- the pre-fix `streamedMapIndex * 6` 8-bit multiply
    // wraps 258 to 2 exactly here). project.project.startMap is map-space (an
    // index into project.maps), not the map's own id.
    const project = manyStreamedMapsProject(44);
    project.project.startMap = 43;
    project.project.startScreen = 0;
    // Fix round 2, finding 3: gives map 43's own off-grid fill a real, checkable rendered
    // identity (distinct CHR tile ids never used elsewhere in this project) instead of the
    // default all-zero metatile, which a cleared-but-never-rendered nametable byte would also
    // read as -- indistinguishable from "the render never ran."
    project.metatiles[43].tiles = [40, 41, 42, 43];
    project.project.startMap = 43;
    project.project.startScreen = 0;
    assert.deepEqual(validateProject(project).filter((x) => x.severity === 'error'), []);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworld-f1-'));
    try {
      await saveProject(dir, project);
      const built = await buildProject({ dir, project, log: () => {} });
      const symbols = fs.readFileSync(built.symbolPath, 'utf8');
      const addrOf = (label) => {
        const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
        assert.ok(m, `${label} should be a named symbol in game.fns`);
        return parseInt(m[1], 16);
      };
      const swResolveScreen = addrOf('sw_resolve_screen');
      const bytes = new Uint8Array(fs.readFileSync(built.romPath));
      const nes = new NES({ onFrame: () => {}, emulateSound: false });
      nes.loadROM(bytes);
      const mem = nes.cpu.mem;

      // Fix round 2, finding 3: GAME_STATE alone is not a valid completion oracle here (see
      // waitForCompletedStreamedLanding's own comment); the mutation this test must catch (final
      // `jmp sw_enter_screen` -> `rts`) leaves map_is_streamed set but skips the locator reads,
      // the division and sw_enter_screen entirely, so the completed-landing wait (not merely
      // map_is_streamed) is the real oracle.
      waitForCompletedStreamedLanding(nes, mem);
      assert.equal(mem[FLAT_SCREEN], 43, "flat_screen must be the 44th map's own global screen id");
      assert.equal(mem[SW_GRID_W], 1, "sw_grid_w must be map 43's own gridW (1), not wrapped garbage (pre-fix: 0)");
      assert.equal(mem[SW_GRID_H], 1, "sw_grid_h must be map 43's own gridH (1)");
      assert.equal(mem[SW_FILL_METATILE_ID], 43, "sw_fill_metatile_id must be map 43's own value, not an earlier map's wrapped-in byte");

      // A rendered window byte: the off-grid neighbour nametable (this is a 1x1 grid, so every
      // OTHER logical nametable is entirely off-grid) must show the fill metatile's own,
      // deliberately distinct tile id -- proof sw_render_window's own render genuinely ran.
      const offGridTable = nes.ppu.nameTable[nes.ppu.ntable1[1]];
      assert.equal(offGridTable.tile[0], 40, "the off-grid window must render map 43's own fill metatile (quadrant 0 tile), not a never-rendered default");

      // Every locator field sw_enter_screen (called only via sw_resolve_owner_streamed's own tail
      // jmp) sets is 0 for THIS map's own only screen (row 0, col_rem 0 of its single region) --
      // which is coincidentally identical to boot_clear's own zeroed default, so a passing landing
      // above proves nothing about whether sw_enter_screen genuinely ran (confirmed empirically:
      // the `jmp sw_enter_screen` -> `rts` mutation still boots, renders and settles correctly for
      // this 1x1 map, because sw_render_window's own internal restore-to-current step recomputes
      // the same bank from these same already-zero fields regardless -- /tmp/debug-r3-mutation.mjs
      // during this fix round). Poisoning them with a value neither the true 0 nor the RAM's own
      // 0xff power-on default, then having sw_resolve_screen resolve map 43 all over again, is the
      // only way to prove the write actually happens rather than merely coincide with a default.
      const POISON = 0x77;
      mem[SW_COL_REGION] = POISON;
      mem[SW_ROW_BANK_BASE] = POISON;
      mem[SW_COL_BYTE_LO] = POISON;
      mem[SW_COL_BYTE_HI] = POISON;
      mem[MTPTR_LO] = POISON;
      mem[MTPTR_HI] = POISON;
      nes.cpu.REG_ACC = 43;
      callRoutine(nes, swResolveScreen); // must be the LAST action on this nes instance (callroutine.js)
      assert.equal(mem[SW_COL_REGION], 0, "sw_col_region must be freshly rewritten to map 43's own region (a 1x1 map has exactly one), not left poisoned");
      // sw_row_bank_base (engine/streamworld.asm:90-100, sw_goto's row accumulator) is
      // regionsPerRow*screenRow, NOT the map's own base bank -- sw_locate_current adds
      // sw_base_bank in separately (:129-133). A 1x1 map's only screen is row 0, so the true value
      // is 0; a poisoned byte surviving here proves sw_goto never re-ran.
      assert.equal(mem[SW_ROW_BANK_BASE], 0, "sw_row_bank_base must be freshly rewritten to 0 for map 43's only (row 0) screen, not left poisoned");
      // sw_col_byte_lo/hi = col_rem * STREAM_RECORD_BYTES (engine/streamworld.asm:71-87); map 43's
      // only screen is col_rem 0 within its own region, so the true value is 0 too.
      assert.equal(mem[SW_COL_BYTE_LO] | (mem[SW_COL_BYTE_HI] << 8), 0, "sw_col_byte_lo/hi must be freshly rewritten to 0 for map 43's own col_rem-0 screen, not left poisoned");
      // The current pointer/bank, exactly as sw_goto (called only via sw_enter_screen) leaves
      // them: mtptr_lo/hi (the terrain pointer) and the effective, hardware-facing PRG bank
      // (independent of any RAM shadow).
      assert.notEqual(mem[MTPTR_LO] | (mem[MTPTR_HI] << 8), POISON | (POISON << 8), 'mtptr must be freshly rewritten, not left poisoned');
      assert.equal(mem[MTPTR_LO], 0, 'mtptr_lo must be freshly rewritten to 0 (col_byte_lo)');
      assert.equal(mem[MTPTR_HI], 128, 'mtptr_hi must be freshly rewritten to $80 (row_bank_base(0)+col_region(0)+base_bank(44), even -> $8000 half)');
      // sw_goto's own combination (engine/streamworld.asm:100-121, mirrored by sw_locate_current
      // at :128-134): absolute region index = row_bank_base + col_region + base_bank, then
      // floor(/2) since one 16KB PRG bank holds two 8KB regions.
      const expectedPrgBank = Math.floor((mem[SW_ROW_BANK_BASE] + mem[SW_COL_REGION] + mem[SW_BASE_BANK]) / 2);
      assert.equal(nes.mmap.prgBank, expectedPrgBank, "the effective PRG bank must be freshly switched to map 43's own resolved region");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

// Fix round 2, finding 3: two streamed maps that genuinely differ in ALL SIX emitted locator
// columns (shared/streamlayout.js's STREAM_MAP_COLUMNS: tileset, fill, baseBank, regionsPerRow,
// gridW, gridH) -- not merely fillMetatileId, which the prior version of this test used alone.
// Map 1's own gridW (25) crosses STREAM_SCREENS_PER_REGION's own 24-screen-per-region ceiling
// (shared/streamlayout.js), giving it a genuinely different regionsPerRow (2) than map 0's (1),
// which in turn gives it a different baseBank than a same-sized map 0 would.
function twoDistinctStreamedMapsProject() {
  const project = createProject('Streamed Distinct-Maps Test', 'action');
  project.cartridge.mapper = 30; // UNROM 512
  project.cartridge.mirroring = 'fourscreen';
  project.cartridge.camera = true;
  project.tilesets.push(createTileset(1, 'Second'));
  const map0 = createMap(0, 'Map 0');
  map0.gridW = 1;
  map0.gridH = 1;
  map0.streamed = true;
  map0.fillMetatileId = 7;
  map0.tilesetId = 0;
  map0.screens = [createScreen()];
  const map1 = createMap(1, 'Map 1');
  map1.gridW = 25;
  map1.gridH = 2;
  map1.streamed = true;
  map1.fillMetatileId = 21;
  map1.tilesetId = 1;
  map1.screens = Array.from({ length: map1.gridW * map1.gridH }, () => createScreen());
  project.maps = [map0, map1];
  project.project.startMap = 1;
  project.project.startScreen = 0;
  return project;
}

test(
  'F1: two streamed maps that differ in tileset, dimensions, regions-per-row and bank allocation all select the SECOND map\'s own row in every one of its six emitted locator columns, not merely fillMetatileId',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = twoDistinctStreamedMapsProject();
    const map0 = project.maps[0];
    const map1 = project.maps[1];
    assert.deepEqual(validateProject(project).filter((x) => x.severity === 'error'), []);
    // Sanity: the two maps' own emitted columns must actually differ in all six fields, or this
    // test would not mean what it claims to.
    assert.notEqual(map0.tilesetId, map1.tilesetId, 'sanity: distinct tilesets');
    assert.notEqual(map0.fillMetatileId, map1.fillMetatileId, 'sanity: distinct fill');
    assert.notEqual(map0.gridW, map1.gridW, 'sanity: distinct gridW');
    assert.notEqual(map0.gridH, map1.gridH, 'sanity: distinct gridH');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworld-f1b-'));
    try {
      await saveProject(dir, project);
      const built = await buildProject({ dir, project, log: () => {} });
      const symbols = fs.readFileSync(built.symbolPath, 'utf8');
      const addrOf = (label) => {
        const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
        assert.ok(m, `${label} should be a named symbol in game.fns`);
        return parseInt(m[1], 16);
      };
      const swResolveScreen = addrOf('sw_resolve_screen');
      const bytes = new Uint8Array(fs.readFileSync(built.romPath));
      const nes = new NES({ onFrame: () => {}, emulateSound: false });
      nes.loadROM(bytes);
      const mem = nes.cpu.mem;
      waitForCompletedStreamedLanding(nes, mem);
      assert.equal(mem[FLAT_SCREEN], 1, 'the start screen is map 1 (global id 1, right after map 0\'s single screen)');
      // All six emitted locator columns (shared/streamlayout.js's STREAM_MAP_COLUMNS), read back
      // from map 1's own landing. Mutation this must catch: an accessor that loads the second
      // map's own fill correctly but the first map's other five fields -- fillMetatileId alone
      // (the prior version of this test) cannot distinguish that from a genuinely correct read.
      assert.equal(nes.mmap.chrPage, map1.tilesetId, "tileset: map 1's own CHR page must be selected, not map 0's");
      assert.equal(mem[SW_FILL_METATILE_ID], map1.fillMetatileId, "fill: map 1's own fill metatile");
      assert.equal(mem[SW_GRID_W], map1.gridW, "gridW: map 1's own width (25), not map 0's (1)");
      assert.equal(mem[SW_GRID_H], map1.gridH, "gridH: map 1's own height (2), not map 0's (1)");
      const expectedRegionsPerRow = Math.ceil(map1.gridW / 24); // STREAM_SCREENS_PER_REGION
      assert.equal(mem[SW_REGIONS_PER_ROW], expectedRegionsPerRow, "regionsPerRow: map 1's own value (2), not map 0's (1)");
      const map1BaseBank = mem[SW_BASE_BANK];

      // baseBank's absolute value is the build's own region ALLOCATOR's business (generate.js's
      // planStreamedRegions can skip fixed-purpose banks; it is not simply 0-based sequential
      // count -- confirmed empirically: a naive "map 0's own region count" prediction (1) did not
      // match the real emitted value), so this asserts map 1's own row against map 0's own
      // EMPIRICALLY OBSERVED baseBank from the same build/project, landing on map 0 instead --
      // not a hand-derived absolute number -- while still proving map 1 owns a DIFFERENT,
      // correctly-offset bank rather than silently reading map 0's row.
      const map0Project = structuredClone(project);
      map0Project.project.startMap = 0;
      map0Project.project.startScreen = 0;
      const dir0 = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworld-f1b0-'));
      try {
        await saveProject(dir0, map0Project);
        const built0 = await buildProject({ dir: dir0, project: map0Project, log: () => {} });
        const bytes0 = new Uint8Array(fs.readFileSync(built0.romPath));
        const nes0 = new NES({ onFrame: () => {}, emulateSound: false });
        nes0.loadROM(bytes0);
        const mem0 = nes0.cpu.mem;
        waitForCompletedStreamedLanding(nes0, mem0);
        assert.equal(mem0[FLAT_SCREEN], 0, 'map 0 landing: the start screen is global id 0');
        const map0BaseBank = mem0[SW_BASE_BANK];
        const map0RegionCount = Math.ceil(map0.gridW / 24) * map0.gridH; // a pure per-map formula, not an allocator guess
        assert.notEqual(map1BaseBank, map0BaseBank, "baseBank: map 1's own base bank must differ from map 0's own");
        assert.equal(
          map1BaseBank,
          map0BaseBank + map0RegionCount,
          "baseBank: map 1's own base bank must be allocated immediately after map 0's own region(s), not an unrelated value"
        );
      } finally {
        fs.rmSync(dir0, { recursive: true, force: true });
      }

      // Mutation that must fail: `jmp sw_enter_screen` -> `rts` at the end of
      // sw_resolve_owner_streamed. Map 1's own landing screen is offset 0 within its own map --
      // always local (row 0, col_rem 0) by construction, so sw_col_region/sw_row_bank_base/
      // sw_col_byte_lo/hi's TRUE values are 0 regardless of which map -- coincidentally identical
      // to boot_clear's own zeroed default, so the checks above alone cannot tell "sw_enter_screen
      // ran" from "it never did." Poisoning first, then having sw_resolve_screen resolve global id
      // 1 all over again, is the only way to prove the write actually happens (same technique as
      // the 44-map test above; confirmed empirically that this exact project, unpoisoned, still
      // passes every check above under this mutation).
      const POISON = 0x77;
      mem[SW_COL_REGION] = POISON;
      mem[SW_ROW_BANK_BASE] = POISON;
      mem[SW_COL_BYTE_LO] = POISON;
      mem[SW_COL_BYTE_HI] = POISON;
      mem[MTPTR_LO] = POISON;
      mem[MTPTR_HI] = POISON;
      nes.cpu.REG_ACC = 1;
      callRoutine(nes, swResolveScreen); // must be the LAST action on this nes instance (callroutine.js)
      assert.equal(mem[SW_COL_REGION], 0, 'sw_col_region must be freshly rewritten to 0 for map 1\'s own offset-0 screen, not left poisoned');
      assert.equal(mem[SW_ROW_BANK_BASE], 0, 'sw_row_bank_base must be freshly rewritten to 0 for map 1\'s own offset-0 screen, not left poisoned');
      assert.equal(mem[SW_COL_BYTE_LO] | (mem[SW_COL_BYTE_HI] << 8), 0, 'sw_col_byte_lo/hi must be freshly rewritten to 0 for map 1\'s own offset-0 screen, not left poisoned');
      assert.notEqual(mem[MTPTR_LO] | (mem[MTPTR_HI] << 8), POISON | (POISON << 8), 'mtptr must be freshly rewritten, not left poisoned');
      const expectedMtptrHi = (map1BaseBank % 2 === 0 ? 0x80 : 0xa0); // row_bank_base(0)+col_region(0)+baseBank, even/odd selects the $8000/$A000 half
      assert.equal(mem[MTPTR_LO], 0, "mtptr_lo must be freshly rewritten to 0 (map 1's own col_byte_lo)");
      assert.equal(mem[MTPTR_HI], expectedMtptrHi, "mtptr_hi must be freshly rewritten to map 1's own resolved org half");
      assert.equal(nes.mmap.prgBank, Math.floor(map1BaseBank / 2), "the effective PRG bank must be freshly switched to map 1's own resolved region");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

// -------------------------------------------------- F9: sw_resolve_screen's entry contract

const NO_SCREEN = 0xff; // engine/constants.asm:1576
const ORD_SCREEN = 0xff; // engine/constants.asm:602 -- zero-page $FF, unrelated to the NO_SCREEN
                          // VALUE above despite sharing the same literal byte
const ST_ACTIVE = 0x05b5; // engine/constants.asm:999 -- 0 idle, 1 column strip, 2 row strip

async function buildAndBootTwoMapStreamed() {
  const project = manyStreamedMapsProject(2);
  project.maps[0].fillMetatileId = 7;
  project.maps[1].fillMetatileId = 21;
  project.project.startMap = 0;
  project.project.startScreen = 0;
  assert.deepEqual(validateProject(project).filter((x) => x.severity === 'error'), []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworld-f9-'));
  const built = await buildProject({ dir, project, log: () => {} });
  const symbols = fs.readFileSync(built.symbolPath, 'utf8');
  const addrOf = (label) => {
    const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
    assert.ok(m, `${label} should be a named symbol in game.fns`);
    return parseInt(m[1], 16);
  };
  const bytes = new Uint8Array(fs.readFileSync(built.romPath));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(bytes);
  const mem = nes.cpu.mem;
  let frames = 0;
  while (mem[MAP_IS_STREAMED] !== 1 && frames < 200) {
    nes.frame();
    frames++;
  }
  assert.ok(frames < 200, 'boot must land on the streamed start map well within 200 frames');
  return { dir, nes, mem, addrOf };
}

test(
  'F9: sw_resolve_screen rejects NO_SCREEN first, leaving the previously-resolved identity (flat_screen/map_is_streamed/ord_screen) exactly as it was, not overwritten with a screen-0-shaped guess',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const { dir, nes, mem, addrOf } = await buildAndBootTwoMapStreamed();
    try {
      const swResolveScreen = addrOf('sw_resolve_screen');
      const before = {
        flatScreen: mem[FLAT_SCREEN],
        mapIsStreamed: mem[MAP_IS_STREAMED],
        ordScreen: mem[ORD_SCREEN],
        swFillMetatileId: mem[SW_FILL_METATILE_ID]
      };
      assert.equal(before.mapIsStreamed, 1, 'precondition: landed on a streamed screen');

      nes.cpu.REG_ACC = NO_SCREEN;
      callRoutine(nes, swResolveScreen);

      // Pre-fix: sw_resolve_screen's fallback resolves any invalid id as ordinary row 0 instead
      // of parking -- map_is_streamed would flip to 0 and ord_screen to 0, a screen-0-shaped
      // guess a caller might go on to render.
      assert.equal(mem[FLAT_SCREEN], before.flatScreen, 'flat_screen must be untouched by a parked (NO_SCREEN) call');
      assert.equal(mem[MAP_IS_STREAMED], before.mapIsStreamed, 'map_is_streamed must be untouched by a parked (NO_SCREEN) call (pre-fix: falls through to the ordinary fallback, 0)');
      assert.equal(mem[ORD_SCREEN], before.ordScreen, 'ord_screen must be untouched by a parked (NO_SCREEN) call (pre-fix: resolved to row 0)');
      assert.equal(mem[SW_FILL_METATILE_ID], before.swFillMetatileId, "the streamed locator RAM (sw_fill_metatile_id and its neighbours) must be untouched, not re-derived from map 0's row");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  'F9: a real (non-parked) landing clears a stale st_active flag rather than carrying it across',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const { dir, nes, mem, addrOf } = await buildAndBootTwoMapStreamed();
    try {
      const swResolveScreen = addrOf('sw_resolve_screen');

      // Seed a stale in-flight strip flag -- nothing in today's shipped engine arms st_active
      // (Part C's wall means no caller strips yet), so this stands in for slice 4b's future
      // movement driver leaving it set across a landing, per the plan's own assignment of that
      // cancellation to this slice.
      mem[ST_ACTIVE] = 2; // row strip, arbitrary nonzero
      nes.cpu.REG_ACC = 1; // land on map 1's own screen (global id 1), a real (non-parked) target
      callRoutine(nes, swResolveScreen);

      assert.equal(mem[MAP_IS_STREAMED], 1, 'sanity: the real landing resolved onto the streamed map');
      assert.equal(mem[SW_FILL_METATILE_ID], 21, "sanity: map 1's own row was selected");
      assert.equal(mem[ST_ACTIVE], 0, 'st_active must be cleared on any real (non-parked) landing, not carried over from a stale strip-arm (pre-fix: left at 2)');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);
