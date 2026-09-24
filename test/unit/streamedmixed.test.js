// Large streamed worlds (ROADMAP item 15), phase 2 slice 2b, Part H:
// test/unit/streamedmixed.test.js -- plan lines ~545-563, an
// ordinary(multi-screen) -> streamed -> ordinary(multi-screen) project.
//
// Unlike streamworld.test.js (which proves the resolver's landing on a single
// streamed map, in isolation), this file's job is the SEAM: does the
// resolver, and every consumer that re-keyed to ord_screen this slice
// (set_screen_ptr, apply_map_music, cross_left/right/up/down), keep behaving
// correctly for an ORDINARY map that comes AFTER a streamed one in map order
// -- the exact shape the real, shipped bug this slice found and fixed
// (cross_* leaving flat_screen a compacted index instead of the true global
// id after an in-map walk -- see handoff-next/progress-phase2-s2b.md's own
// "Real bug found and fixed" section) only shows up in.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { flattenScreens, ordinaryScreenView } from '../../main/build/generate.js';
import { createSong } from '../../shared/audio.js';
import { createProject, createMap, createScreen, createTileset, validateProject } from '../../shared/project.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { scanEquates, resolveEquates } from '../lib/equates.js';
import { callRoutine } from '../lib/callroutine.js';
import NES from '../../renderer/emulator/core/nes.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// Zero-page/RAM addresses resolved directly off engine/constants.asm's own equate chain, via the
// identical scanner test/unit/rammap.test.js and zeropage.test.js already trust (test/lib/
// equates.js) -- not hand-transcribed literals, so a future zero-page diet that moves one of
// these bytes fails this file the same way it fails those, instead of silently reading the wrong
// address.
function ramAddrs() {
  const text = fs.readFileSync(new URL('../../engine/constants.asm', import.meta.url), 'utf8');
  const pending = new Map();
  scanEquates(text, pending);
  const symbols = new Map();
  resolveEquates(pending, symbols);
  return symbols;
}
const RAM = ramAddrs();
const PLAYER_X = RAM.get('player_x');
const PLAYER_Y = RAM.get('player_y');
const FLAT_SCREEN = RAM.get('flat_screen');
const ORD_SCREEN = RAM.get('ord_screen');
const MAP_IS_STREAMED = RAM.get('map_is_streamed');
const CUR_MAP = RAM.get('cur_map');
const CUR_SONG = RAM.get('cur_song');
const CAM_NT = RAM.get('cam_nt');
const BIND_COUNT = RAM.get('bind_count');
const SW_FILL_METATILE_ID = RAM.get('sw_fill_metatile_id');
const ENC_STEP = RAM.get('enc_step');
const NO_SCREEN = 0xff; // engine/constants.asm:1576
const PROBE_X = 0x08; // engine/constants.asm's own literal equate
const PROBE_Y = 0x09;
const COL_OPEN = 0;
const COL_SOLID = 1;
const GAME_STATE = RAM.get('game_state');
const ENT_ACTIVE = RAM.get('ent_active');
const ENT_ACTOR = RAM.get('ent_actor');
const MAX_ENTITIES = 8; // engine/constants.asm's own literal, mirrored in the array sizes above
const ST_GAMEPLAY = 0;
const ST_BATTLE = 5; // engine/constants.asm's own ST_BATTLE
const UP = 4;
const DOWN = 5;
const LEFT = 6;
const RIGHT = 7;

// project.sprites.actors starts EMPTY (no default actor 0) and both the engine and the generator
// index an actor by its ARRAY POSITION, never by an `id` field (nothing reads one) -- so these
// must be the 0-based positions the four push()es below land at, not an invented 1-based id.
// Getting this wrong doesn't fail loudly: actorId 0..N-1 all read *some* actor's hp, just the
// wrong one, and only an actorId >= actorCount is dropped -- generate.js's own dead-actor guard
// (`entity.actorId < actorCount`, main/build/generate.js) silently drops the placement rather than
// emitting a bad reference, which is what a too-high id here hits.
const NPC_BEFORE_WARP = 0; // Before map screen(0,0): fires at spawn, warps into the streamed map
const NPC_STREAM_SPAWN = 1; // streamed map, a high-offset screen: proves entity data past byte 255 loads
const NPC_STREAM_WARP = 2; // same streamed screen: fires on arrival, warps into the After map
const NPC_AFTER = 3; // After map screen(0,0): proves an ordinary map's own entities are unaffected

function findEntitySlot(mem, actorId) {
  for (let i = 0; i < MAX_ENTITIES; i++) {
    if (mem[ENT_ACTIVE + i] && mem[ENT_ACTOR + i] === actorId) return i;
  }
  return -1;
}

/**
 * Before(2x2, ordinary) -> Streamed(3x2 default grid) -> After(2x2, ordinary), each map with its
 * own tileset/song/encounter rate (map-level fields, shared/project.js's createMap) so a wrong
 * ord_screen/cur_map after the streamed visit would read the WRONG map's row, not merely a
 * missing one. The streamed map's screen index 4 (col 1, row 1 of the 3x2 grid) is deliberately
 * not screen 0: its terrain alone starts at byte offset 4*STREAM_RECORD_BYTES (>= 960) into its
 * region, and its entity records sit further still -- both already past the 8-bit offset ceiling
 * the round-2 wrong-implementation table's row 2 names ("single-page spawn cases hide high-offset
 * failures"), so landing there and reading its entities back exercises exactly that, in the real
 * public build.
 */
function buildMixedProject() {
  const project = createStreamedProject({ gameType: 'rpg', mixed: true });
  const [before, streamed, after] = project.maps;

  before.tilesetId = 0;
  before.songId = 0;
  before.encounters = { rate: 0, actorIds: [] };
  streamed.songId = 2;
  after.tilesetId = 1;
  after.songId = 1;
  after.encounters = { rate: 128, actorIds: [] };

  project.songs = [createSong('Before Song'), createSong('After Song'), createSong('Streamed Song')];
  // Pushed in NPC_*'s own 0-based order, onto the initially-empty actors array, so each lands at
  // exactly the array position its constant above names.
  project.sprites.actors.push(
    { name: 'Warper1', behavior: 'npc', hp: 1, damage: 0 },
    { name: 'HighOffset', behavior: 'npc', hp: 1, damage: 0 },
    { name: 'Warper2', behavior: 'npc', hp: 1, damage: 0 },
    { name: 'Greeter', behavior: 'npc', hp: 1, damage: 0 }
  );

  // Phase 2 slice 4a carry-over (slice 3 review MINOR): pinned as literals, not derived from
  // flattenScreens -- deriving the EXPECTED wire values from the same function generateAssets
  // itself calls to produce the ACTUAL ones would let a bug in flattenScreens cancel out against
  // itself here instead of being caught (sabotage case (j) restores the flattenScreens-derived
  // form and shows what stops catching a wrong implementation). The shape is
  // createStreamedProject's own fixed layout (test/lib/streamedproject.js): Before is a 2x2
  // ordinary map (4 screens, global ids 0-3) placed first, so the streamed map (the default 3x2
  // grid) starts at global id 4, and the After map (also 2x2) starts right after it at 4+6=10.
  const streamedBase = 4;
  const afterBase = 10;
  const STREAM_TARGET_INDEX = 4; // col=1, row=1 of the 3x2 default grid: 1 + 1*3
  const STREAM_TARGET_GLOBAL = streamedBase + STREAM_TARGET_INDEX;
  const AFTER_TL = afterBase + 0; // (0,0)
  const AFTER_TR = afterBase + 1; // (1,0)
  const AFTER_BL = afterBase + 2; // (0,1)
  const AFTER_BR = afterBase + 3; // (1,1)

  // Before screen(0,0): fires the instant the player is on the map (spawn == the entity's own
  // position, the same "arrives already armed" shape camera.test.js's own warp-chain test uses),
  // warping straight into the streamed map's high-offset screen.
  before.screens[0].entities.push({
    actorId: NPC_BEFORE_WARP,
    x: project.project.startX,
    y: project.project.startY,
    props: {
      trigger: 'enter',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'warp', screen: STREAM_TARGET_GLOBAL, x: 100, y: 100 }] }] }
    }
  });

  // The streamed screen's own two entities: a static one proving high-offset entity data loads
  // (never armed/warped, just checked for), and one sitting exactly where warp1 lands, itself
  // warping on into the After map. D.3/D.4 refuse Move/Say on a streamed screen, not Warp.
  streamed.screens[STREAM_TARGET_INDEX].entities.push(
    { actorId: NPC_STREAM_SPAWN, x: 50, y: 50, props: {} },
    {
      actorId: NPC_STREAM_WARP,
      x: 100,
      y: 100,
      props: {
        trigger: 'enter',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'warp', screen: AFTER_TL, x: project.project.startX, y: project.project.startY }] }] }
      }
    }
  );

  after.screens[0].entities.push({ actorId: NPC_AFTER, x: 40, y: 40, props: {} });

  return { project, AFTER_TL, AFTER_TR, AFTER_BL, AFTER_BR, STREAM_TARGET_GLOBAL };
}

async function buildAndBoot(project) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamedmixed-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const bytes = new Uint8Array(fs.readFileSync(built.romPath));
    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(bytes);
    return { nes, mem: nes.cpu.mem };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs frames until `flat_screen` changes from its value at call time, or `maxFrames` elapse --
 * the same exact-value-not-non-zero technique streamworld.test.js's own buildAndBoot uses, because
 * jsnes RAM inits to 0xFF (cpu.js), not 0, so "poll until non-zero" is true before boot even runs. */
function holdUntilCross(nes, mem, button, maxFrames = 200) {
  const before = mem[FLAT_SCREEN];
  nes.buttonDown(1, button);
  let frames = 0;
  while (mem[FLAT_SCREEN] === before && frames < maxFrames) {
    nes.frame();
    frames++;
  }
  nes.buttonUp(1, button);
  assert.ok(frames < maxFrames, `a crossing must complete within ${maxFrames} frames (button ${button})`);
  // CAM_SLIDE_FRAMES-scale settle so the next held direction does not land mid-slide.
  for (let i = 0; i < 20; i++) nes.frame();
}

/** Runs frames (no input) until flat_screen changes -- an 'enter'-triggered Warp landing on a
 * streamed screen only fires once that screen's own sw_render_window forced-blank draw finishes,
 * which (like streamworld.test.js's own render/boot test found) spans well more than a handful of
 * simulated frames, so a fixed frame count is the wrong tool here; poll for the real transition
 * instead, the same reasoning as holdUntilCross above.
 *
 * take_door (engine/boot.asm) writes flat_screen as its very first act, then falls straight
 * through into redraw_screen in the SAME 6502 subroutine chain -- no return to main_loop in
 * between. jsnes's own nes.frame() only advances a bounded cycle budget per call and does not
 * respect subroutine boundaries, so a single redraw_screen call whose own draw (sw_render_window,
 * on a streamed landing) outruns one frame's cycle budget gets sliced across many nes.frame()
 * calls. That means flat_screen is already the NEW value on the very first frame() call after
 * take_door runs, well before spawn_entities/arm_event (which redraw_screen calls only once its
 * own draw finishes) have actually executed -- so the settle after detecting the change must be
 * long enough to cover that whole draw on a streamed landing, not the couple of frames an ordinary
 * landing's plain draw_screen needs. */
function runUntilFlatScreenChanges(nes, mem, maxFrames = 200) {
  const before = mem[FLAT_SCREEN];
  let frames = 0;
  while (mem[FLAT_SCREEN] === before && frames < maxFrames) {
    nes.frame();
    frames++;
  }
  assert.ok(frames < maxFrames, `flat_screen must change (a landing must complete) within ${maxFrames} frames`);
  for (let i = 0; i < 5; i++) nes.frame();
}

/** Runs frames one at a time (no input) until the given actor has a live entity slot, or
 * `maxFrames` elapse. On a streamed landing, spawn_entities/arm_event run only once
 * sw_render_window's own slow draw finishes (see runUntilFlatScreenChanges above) -- and since an
 * 'enter'-triggered event armed during that same spawn can chain straight into a further Warp on
 * the very next main_loop tick, there is no fixed settle count that is guaranteed to land after
 * the spawn but before a chained warp fires. Polling for the entity itself, frame by frame, is the
 * only way to catch that exact window: the spawn always precedes the chained warp's own
 * flat_screen change, never the reverse (spawn_entities/arm_event finish and redraw_screen
 * returns; the chained command only executes on a later main_loop tick). */
function runUntilEntityPresent(nes, mem, actorId, maxFrames = 200) {
  let frames = 0;
  while (findEntitySlot(mem, actorId) === -1 && frames < maxFrames) {
    nes.frame();
    frames++;
  }
  assert.ok(frames < maxFrames, `actor ${actorId} must spawn within ${maxFrames} frames`);
}

test(
  'the resolver lands correctly on all three maps: boot (ordinary), a Warp into a high-offset streamed screen, and a second Warp out into the last ordinary map',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const { project, AFTER_TL, STREAM_TARGET_GLOBAL } = buildMixedProject();
    const { nes, mem } = await buildAndBoot(project);

    // Boot: lands on Before map(0)/screen(0,0), global id 0, ordinary. Caught a few frames in,
    // deliberately before Warp 1's own 'enter' trigger has had time to fire (it needs the
    // Before screen's own settle_owed cycle first).
    for (let i = 0; i < 8; i++) nes.frame();
    assert.equal(mem[GAME_STATE], ST_GAMEPLAY);
    assert.equal(mem[FLAT_SCREEN], 0, 'boot must land on the Before map\'s own screen 0 (global id 0)');
    assert.equal(mem[ORD_SCREEN], 0, 'ord_screen must be the Before map\'s own compacted index (0)');
    assert.equal(mem[MAP_IS_STREAMED], 0);
    assert.equal(mem[CUR_MAP], 0, 'cur_map must be the Before map\'s own id (apply_map_music_direct ran at boot)');
    assert.equal(mem[CUR_SONG], 0, 'cur_song must be the Before map\'s own songId');

    // Warp 1 (an 'enter' trigger armed the instant the player is on the map, camera.test.js's
    // own warp-chain technique): lands on the streamed map's high-offset screen. take_door
    // writes flat_screen/player_x/y as its very first act (see runUntilFlatScreenChanges), so
    // these are already correct the instant the poll detects the change -- well before
    // sw_render_window's own slow draw, and the spawn it gates, complete.
    runUntilFlatScreenChanges(nes, mem);
    assert.equal(mem[FLAT_SCREEN], STREAM_TARGET_GLOBAL, 'the first Warp must land on the streamed map\'s high-offset screen (global id)');
    assert.equal(mem[MAP_IS_STREAMED], 1, 'map_is_streamed must be set for a streamed landing');
    assert.equal(mem[PLAYER_X], 100, 'the warp\'s authored destination x');
    assert.equal(mem[PLAYER_Y], 100, 'the warp\'s authored destination y');
    assert.equal(mem[CUR_MAP], 1, 'cur_map must become the Streamed map\'s own id (apply_map_music_direct ran on the streamed landing too)');
    // Case 12 (phase 2 plan's sabotage list): sw_resolve_owner_streamed must call
    // apply_map_music_direct (the compare-against-cur_map-then-set_music tail), not merely write
    // cur_map directly -- otherwise cur_map reads correctly (asserted above) while cur_song is
    // left stale, playing the PREVIOUS map's music on the very frame that changed both.
    assert.equal(mem[CUR_SONG], 2, 'cur_song must become the Streamed map\'s own songId, not stay stuck on the Before map\'s song');
    // Case 20 (phase 2 plan's sabotage list): sw_resolve_divdone must compute cam_nt from the
    // landing screen's own (col&1)|((row&1)<<1) parity, not hardcode it to 0 -- STREAM_TARGET_INDEX
    // is screen index 4 of the 3x2 grid (col=1, row=1), both odd, so a hardcoded-0 sabotage of the
    // parity computation reads identically to a correct one at screen (0,0) (the only landing every
    // OTHER test in this file and streamworld.test.js's own cam_nt check ever exercises) but is
    // wrong here: (1&1) | ((1&1)<<1) = 3.
    assert.equal(mem[CAM_NT], 3, 'cam_nt must reflect the landing screen\'s own column/row parity (col1,row1 -> 3), not a hardcoded 0');

    // The high-offset entity (screen index 4 of the 3x2 grid: terrain alone starts at byte
    // offset >= 960 into the region) must have spawned -- proves the streamed branch's entity
    // read survived an offset well past 255, not merely screen 0's own low-offset record. Polled
    // for directly (runUntilEntityPresent), not assumed after a fixed settle: NPC_STREAM_WARP's
    // own 'enter' trigger chains straight into Warp 2 on the very next main_loop tick once this
    // same spawn_entities call arms it, so a settle long enough to guarantee the spawn completed
    // could just as easily already be on the far side of that second warp too.
    runUntilEntityPresent(nes, mem, NPC_STREAM_SPAWN);
    assert.equal(mem[FLAT_SCREEN], STREAM_TARGET_GLOBAL, 'must still be on the streamed screen when its own entity is found (spawn precedes the chained warp)');

    // Warp 2 (armed the instant Warp 1 lands, at the same (100,100) the first warp targeted):
    // lands on the After map's own screen(0,0), the true GLOBAL id, not the ordinary-compacted
    // index the round-1 shipped defect would have written instead.
    runUntilFlatScreenChanges(nes, mem);
    assert.equal(mem[FLAT_SCREEN], AFTER_TL, 'the second Warp must land on the After map\'s screen(0,0) -- the true global id');
    assert.equal(mem[MAP_IS_STREAMED], 0, 'the After map is ordinary');
    assert.equal(mem[CUR_MAP], 2, 'cur_map must become the After map\'s own id');
    assert.equal(mem[CUR_SONG], 1, 'cur_song must become the After map\'s own songId, not stay stuck on the Streamed map\'s song');
    // F2 (phase 2 slice 2b fix round 1): an ordinary landing reached AFTER a streamed one must not
    // inherit the streamed screen's own nonzero cam_nt/cam_x_lo/cam_y_lo -- AFTER_TL is screen
    // (0,0) (even/even parity), so cam_nt must be 0 here, not the streamed screen's stale 3 (the
    // pre-fix bug: this landing's own redraw_screen_ordinary body never resets it, and
    // enable_rendering's own $2005 write is (0,0) but never touches cam_nt itself). A few frames'
    // wait, same technique the review's own repro uses, so any one-frame NMI race is not mistaken
    // for the bug.
    for (let i = 0; i < 5; i++) nes.frame();
    assert.equal(mem[CAM_NT], 0, 'cam_nt must be reset to 0 on the ordinary landing after a streamed one, not inherit the streamed screen\'s stale value (pre-fix: 3)');
    // Polled for the same reason as the streamed entity above: flat_screen changes at the very
    // start of take_door's own subroutine chain, before redraw_screen's own spawn_entities call
    // completes, even for an ordinary landing's much shorter draw.
    runUntilEntityPresent(nes, mem, NPC_AFTER);
  }
);

test(
  'an in-map ordinary walk on the last (After) map keeps flat_screen the true global id and ord_screen the compacted index, through all four cross_* directions, in a full loop back to the start',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const { project, AFTER_TL, AFTER_TR, AFTER_BL, AFTER_BR } = buildMixedProject();
    const { ordinaryFlat } = ordinaryScreenView(project);
    const after = project.maps[2];
    const compactOf = (globalIndexWithinAfter) => ordinaryFlat.findIndex((e) => e.screen === after.screens[globalIndexWithinAfter]);
    const ORD_TL = compactOf(0);
    const ORD_TR = compactOf(1);
    const ORD_BL = compactOf(2);
    const ORD_BR = compactOf(3);
    assert.ok([ORD_TL, ORD_TR, ORD_BL, ORD_BR].every((v) => v >= 0), 'sanity: every After-map screen must have a real compacted index');

    const { nes, mem } = await buildAndBoot(project);
    // jsnes RAM inits to 0xFF, not 0 (cpu.js), so flat_screen reads a real value (255) before boot
    // has even run -- settle past that boot transition first (matching test 1's own fixed 8-frame
    // wait) or the first runUntilFlatScreenChanges call below would consume it instead of Warp 1,
    // leaving Warp 2 never waited for at all.
    for (let i = 0; i < 8; i++) nes.frame();
    // boot -> Warp 1 (into the streamed map) -> Warp 2 (out to the After map), each landing
    // polled for rather than assumed within a fixed frame budget -- see runUntilFlatScreenChanges.
    runUntilFlatScreenChanges(nes, mem);
    runUntilFlatScreenChanges(nes, mem);
    assert.equal(mem[FLAT_SCREEN], AFTER_TL);
    assert.equal(mem[ORD_SCREEN], ORD_TL);
    assert.equal(mem[MAP_IS_STREAMED], 0);
    assert.equal(mem[CUR_MAP], 2);

    // Right: (0,0) -> (1,0).
    holdUntilCross(nes, mem, RIGHT);
    assert.equal(mem[FLAT_SCREEN], AFTER_TR, 'after crossing right, flat_screen must be the true global id, never the raw compacted index');
    assert.equal(mem[ORD_SCREEN], ORD_TR);
    assert.equal(mem[PLAYER_X], 0);

    // Down: (1,0) -> (1,1).
    holdUntilCross(nes, mem, DOWN);
    assert.equal(mem[FLAT_SCREEN], AFTER_BR);
    assert.equal(mem[ORD_SCREEN], ORD_BR);
    assert.equal(mem[PLAYER_Y], 0);

    // Left: (1,1) -> (0,1).
    holdUntilCross(nes, mem, LEFT);
    assert.equal(mem[FLAT_SCREEN], AFTER_BL);
    assert.equal(mem[ORD_SCREEN], ORD_BL);

    // Up: (0,1) -> (0,0), a full loop back to where the walk started.
    holdUntilCross(nes, mem, UP);
    assert.equal(mem[FLAT_SCREEN], AFTER_TL, 'a full loop through all four directions must land back on the exact global id it started from');
    assert.equal(mem[ORD_SCREEN], ORD_TL);

    // cur_map, tileset selection and the After map's own entity must all still read correctly at
    // the end of the loop -- "exactly as if no streamed screen had ever been visited" (plan item
    // c): a stale ord_screen/flat_screen from the streamed visit would have made at least one of
    // the four crossings above land on the wrong screen already, but re-check the map-level state
    // too, since a wrong cur_map would silently point apply_map_music/check_encounter at the
    // Streamed map's own row instead.
    assert.equal(mem[CUR_MAP], 2, 'cur_map must still be the After map\'s own id after the whole walk');
    assert.equal(mem[GAME_STATE], ST_GAMEPLAY);
    assert.notEqual(findEntitySlot(mem, NPC_AFTER), -1, 'the After map screen(0,0)\'s own entity must still be there on returning to it');
  }
);

test(
  'legal-high-id boundary: a global id near the top of the legal id space, and the NO_SCREEN=255 sentinel, resolve or park correctly, never mis-dispatch',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    // One streamed screen (global id 0) + one big ordinary map pushes NUM_SCREENS as close to the
    // NO_SCREEN=255 sentinel as this project's own kernel-lo budget allows on UNROM 512 (each
    // ordinary screen costs its own lookup-table row -- checkCapacity refuses a grid sized to
    // reach literal id 254 outright, measured by building one and reading its own refusal
    // message). Phase 2 slice 4a's own new NMI/projection code narrowed the old 100-screen margin
    // to 80 (re-measured empirically: 85 screens still builds, 90 does not, "need 1211 bytes but
    // only 1195 are free"); the round 1 review fix's own real per-tile clipping for entities
    // (STREAMWORLD_PROJECT_KERNEL_ALLOWANCE, main/build/generate.js) narrowed it again, from 80 to
    // 79 (re-measured empirically: 79 screens still builds, "need 1081 bytes but only 1070 are
    // free" at 80). Phase 2 slice 4b's own driver/wall/event-freeze kernel growth (the allowances
    // docs/reference-kernel-budget.md's own Part F/4b group names) narrowed it again, from 79 to
    // 71 (re-measured empirically: 71 screens still builds, 72 does not, "need 977 bytes but only
    // 972 are free").
    // Distinct from slice 4b's own high-world-*coordinate* projection tests, this is purely the
    // resolver's own global-id dispatch at the numeric edge of what NO_SCREEN could be mistaken
    // for.
    const project = createStreamedProject({ gridW: 1, gridH: 1 });
    // Append a second, large ordinary map after the 1x1 streamed one.
    const ordinary = createMap(1, 'Big');
    const BIG_W = 71;
    const BIG_H = 1; // 79*1 = 79 screens -> global ids 1..79
    ordinary.gridW = BIG_W;
    ordinary.gridH = BIG_H;
    ordinary.screens = Array.from({ length: BIG_W * BIG_H }, () => createScreen());
    project.maps = [project.maps[0], ordinary];
    project.project.startMap = 1;
    project.project.startScreen = ordinary.screens.length - 1; // the LAST screen

    const { mapBase } = flattenScreens(project);
    const lastGlobal = mapBase[1] + ordinary.screens.length - 1;
    assert.ok(lastGlobal < 255, `sanity: NUM_SCREENS must stay a legal id space (last real id ${lastGlobal} < 255/NO_SCREEN)`);

    const { nes, mem } = await buildAndBoot(project);
    for (let i = 0; i < 30; i++) nes.frame();
    assert.equal(mem[FLAT_SCREEN], lastGlobal, 'the resolver must land correctly on the last legal ordinary global id, not mis-dispatch near the NO_SCREEN edge');
    assert.equal(mem[MAP_IS_STREAMED], 0);
    assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'boot must not hang or crash landing at the top of the legal id space');

    // A push against every edge of this last screen (no neighbour exists past it in at least one
    // direction, since it is gridW*gridH-1) must never mis-dispatch to a bogus screen: flat_screen
    // stays put, exactly the NO_SCREEN "solid edge" behaviour the plan requires (screen_left/
    // right/up/down carry NO_SCREEN=255 for an out-of-grid neighbour, cross_* rejects it before
    // ever calling cross_set_screen).
    for (const button of [UP, DOWN, LEFT, RIGHT]) {
      const before = mem[FLAT_SCREEN];
      nes.buttonDown(1, button);
      for (let i = 0; i < 40; i++) nes.frame();
      nes.buttonUp(1, button);
      for (let i = 0; i < 5; i++) nes.frame();
      // Either the crossing is legal (screen changes to a real neighbour) or it is refused
      // (flat_screen unchanged) -- either way flat_screen must never become 255 (NO_SCREEN
      // itself is never a landing).
      assert.notEqual(mem[FLAT_SCREEN], 255, `flat_screen must never become the NO_SCREEN sentinel itself (button ${button}, before ${before})`);
    }
  }
);

// ==================================================================================
// Phase 2 slice 2b, fix round 1, F7 (boundary half): the original "legal-high-id
// boundary" test above only reached global id 100 (NUM_SCREENS 101) -- "a resolver
// that rejects IDs >=128 would pass" it, and even a fully gutted sw_resolve_screen
// left it passing (the ordinary single-tail-map start happens to have ord_screen 0
// regardless). 254 streamed screens + one tail map reaches the TRUE top of the legal
// id space (254, one below NO_SCREEN=255) without hitting the unrelated all-ordinary
// kernel-lo ceiling the original test's own comment cites -- streamed screens cost
// nothing in that table. Both owner types are exercised at 254, not just one.

// Fix round 2, finding 2 (R2b): the review found that BOTH a resolver rejecting ids >= 128 AND a
// fully gutted sw_resolve_screen still passed the ordinary-tail variant of this test, because its
// tail map was the ONLY ordinary map in the whole project -- ordinaryPrefix is 0 by construction,
// so ord_screen's boot-default value (also 0) coincidentally matches. ORDINARY_PREFIX below adds a
// real ordinary map BEFORE the streamed run, so the tail's own compacted ord_screen must be a
// NONZERO value (ORDINARY_PREFIX) to pass -- a gutted or mis-dispatching resolver leaves ord_screen
// at its boot default (0) instead, a real mismatch this time.
const ORDINARY_PREFIX = 3; // global ids 0..2

function buildBoundaryProject(tailStreamed) {
  const project = createProject('Boundary', 'action');
  project.cartridge.mapper = 30; // UNROM 512
  project.cartridge.mirroring = 'fourscreen';
  project.cartridge.camera = true;
  const prefixMap = createMap(0, 'Prefix');
  prefixMap.gridW = ORDINARY_PREFIX;
  prefixMap.gridH = 1;
  prefixMap.screens = Array.from({ length: ORDINARY_PREFIX }, () => createScreen());
  const STREAM_COUNT = 254 - ORDINARY_PREFIX; // global ids 3..253
  const streamedMap = createMap(1, 'Streamed');
  streamedMap.gridW = STREAM_COUNT;
  streamedMap.gridH = 1;
  streamedMap.streamed = true;
  streamedMap.fillMetatileId = 9;
  streamedMap.tilesetId = 0;
  streamedMap.screens = Array.from({ length: STREAM_COUNT }, () => createScreen());
  const tailMap = createMap(2, tailStreamed ? 'TailStreamed' : 'TailOrdinary');
  tailMap.gridW = 1;
  tailMap.gridH = 1;
  tailMap.streamed = tailStreamed;
  if (tailStreamed) {
    tailMap.fillMetatileId = 5; // distinct from the run's own 9
    tailMap.tilesetId = 0;
  } else {
    // Distinct destination data (review's own wording): the ordinary tail's own tileset (a second
    // tileset, so its CHR page is verifiably not the prefix map's) and its own entity -- a resolver
    // that dispatches to the wrong ordinary row, or a gutted one reading whatever ord_screen
    // already holds, is caught by real content here, not merely a matching number.
    project.tilesets.push(createTileset(1, 'Tail'));
    tailMap.tilesetId = 1;
    tailMap.screens[0].entities.push({ actorId: 0, x: 40, y: 40, props: {} });
  }
  project.sprites.actors.push({ name: 'TailNPC', behavior: 'npc', hp: 1, damage: 0 });
  project.maps = [prefixMap, streamedMap, tailMap];
  project.project.startMap = 2;
  project.project.startScreen = 0; // the tail map's only screen -- global id 254
  return { project, ordinaryPrefixCount: ORDINARY_PREFIX };
}

for (const tailStreamed of [false, true]) {
  test(
    `F7 boundary: the resolver lands correctly on global id 254 (one below NO_SCREEN=255) when the owner there is ${tailStreamed ? 'a streamed map' : 'an ordinary map'}`,
    { skip: !hasNesasm && 'nesasm not found on PATH' },
    async () => {
      const { project, ordinaryPrefixCount } = buildBoundaryProject(tailStreamed);
      assert.deepEqual(validateProject(project).filter((x) => x.severity === 'error'), []);
      const { nes, mem } = await buildAndBoot(project);
      // GAME_STATE/MAP_IS_STREAMED alone settle very early (boot_clear's own RAM-clear), so this
      // waits on the one flag that can only be correct once the real resolver has actually run:
      // FLAT_SCREEN reaching the exact expected global id, never a coincidental early match.
      let frames = 0;
      while (mem[FLAT_SCREEN] !== 254 && frames < 200) {
        nes.frame();
        frames++;
      }
      assert.ok(frames < 200, 'the resolver must land on the true top legal id (254) well within 200 frames, not hang or mis-dispatch near NO_SCREEN');
      // A generous settle past a streamed tail's own multi-frame render (streamworld.test.js's own
      // established margin), harmless (a no-op wait) for the ordinary tail.
      for (let i = 0; i < 60; i++) nes.frame();
      assert.equal(mem[FLAT_SCREEN], 254, 'flat_screen must still be the true top legal id after the settle');
      assert.equal(mem[MAP_IS_STREAMED], tailStreamed ? 1 : 0, `the tail owner is ${tailStreamed ? 'streamed' : 'ordinary'}`);
      if (tailStreamed) {
        assert.equal(mem[SW_FILL_METATILE_ID], 5, "the streamed tail's own locator row must be loaded, not an earlier (wrapped or mis-dispatched) map's");
      } else {
        // Fix round 2, finding 2: a NONZERO expected ord_screen (the ordinary prefix map's own
        // screen count) -- both the resolver-rejects-ids->=128 mutation and a fully gutted
        // sw_resolve_screen leave ord_screen at its boot default (0) instead, which used to
        // coincidentally match this test's own all-streamed-prefix shape.
        assert.equal(mem[ORD_SCREEN], ordinaryPrefixCount, "the ordinary tail map's own single screen must be the compacted row AFTER the ordinary prefix map's screens, not row 0");
        // Distinct destination data: the tail's own tileset (never the prefix map's default 0)
        // and its own spawned entity, so a resolver reaching the wrong ordinary row is caught even
        // if that wrong row happened to share the same numeric ord_screen value.
        assert.equal(nes.mmap.chrPage, 1, "the ordinary tail's own distinct tileset must be selected, not the prefix map's");
        assert.notEqual(findEntitySlot(mem, 0), -1, "the ordinary tail's own entity must have spawned");
      }
      assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'boot must not hang or crash landing at the true top of the legal id space');
    }
  );
}

test(
  'F7 boundary: sw_resolve_screen rejects NO_SCREEN (255) at the real NUM_SCREENS=255 edge, not merely a small project\'s arbitrary sentinel',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const { project } = buildBoundaryProject(false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamedmixed-f7-noscreen-'));
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
      let frames = 0;
      while (mem[FLAT_SCREEN] !== 254 && frames < 200) {
        nes.frame();
        frames++;
      }
      assert.ok(frames < 200, 'boot must land on the ordinary tail (global 254) well within 200 frames');

      const before = { flatScreen: mem[FLAT_SCREEN], mapIsStreamed: mem[MAP_IS_STREAMED], ordScreen: mem[ORD_SCREEN] };
      nes.cpu.REG_ACC = NO_SCREEN;
      callRoutine(nes, swResolveScreen);
      assert.equal(mem[FLAT_SCREEN], before.flatScreen, 'flat_screen must be untouched by a parked (NO_SCREEN) call at the real 255-screen edge');
      assert.equal(mem[MAP_IS_STREAMED], before.mapIsStreamed, 'map_is_streamed must be untouched by a parked (NO_SCREEN) call at the real 255-screen edge');
      assert.equal(mem[ORD_SCREEN], before.ordScreen, 'ord_screen must be untouched by a parked (NO_SCREEN) call at the real 255-screen edge');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

// ==================================================================================
// Phase 2 slice 2b, fix round 1, F3: a streamed landing must not inherit the active
// bound-tile cache from the previous ordinary screen.

const SOLID_METATILE = 7;

/** Before(2x2, ordinary, cell(0,0) bound to switch 0 -> a SOLID metatile) -> Streamed(3x2
 * default grid, plain open terrain). An 'enter' event on Before sets switch 0 (arming the
 * binding) and then warps straight into the streamed map's own screen (0,0) -- the review's own
 * exact repro shape, for a given gameType. */
function buildBoundLandingProject(gameType) {
  const project = createStreamedProject({ gameType, mixed: true });
  const [before] = project.maps;
  project.metatiles[SOLID_METATILE] = { ...project.metatiles[SOLID_METATILE], collision: 'solid' };
  before.screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: SOLID_METATILE }];
  project.sprites.actors.push({ name: 'Warper', behavior: 'npc', hp: 1, damage: 0 });
  const { mapBase } = flattenScreens(project);
  const streamedGlobal = mapBase[1]; // the streamed map's own screen (0,0)
  before.screens[0].entities.push({
    actorId: 0,
    x: project.project.startX,
    y: project.project.startY,
    props: {
      trigger: 'enter',
      event: {
        pages: [
          { cond: { type: 'none', arg: 0 }, commands: [{ op: 'setSwitch', switch: 0 }, { op: 'warp', screen: streamedGlobal, x: 16, y: 16 }] }
        ]
      }
    }
  });
  return { project, streamedGlobal };
}

for (const gameType of ['action', 'rpg']) {
  test(
    `F3 (${gameType}): a streamed landing rebuilds the active bound-tile cache instead of inheriting the previous ordinary screen's`,
    { skip: !hasNesasm && 'nesasm not found on PATH' },
    async () => {
      const { project, streamedGlobal } = buildBoundLandingProject(gameType);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `forge-streamedmixed-f3-${gameType}-`));
      try {
        await saveProject(dir, project);
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

        // Boot on the Before map, wait for the 'enter' event to set the switch (arming the
        // solid substitute at cell (0,0)) and warp onto the streamed map.
        let frames = 0;
        while (mem[FLAT_SCREEN] !== streamedGlobal && frames < 200) {
          nes.frame();
          frames++;
        }
        assert.ok(frames < 200, "the enter event's setSwitch+warp must land on the streamed screen well within 200 frames");
        assert.equal(mem[MAP_IS_STREAMED], 1, 'the landing screen is the streamed map');

        // sw_render_window's full four-nametable redraw spans well more than a handful of
        // simulated frames (jsnes advances a fixed cycle budget per nes.frame() call, not one
        // subroutine per call), so poll for the real completion signal -- bind_count leaving its
        // inherited value -- instead of assuming a short fixed settle.
        // The pre-fix bug: bind_count stays 1 (inherited from Before's own active binding),
        // so a real probe_type(0,0) on the streamed screen reads SOLID instead of the streamed
        // terrain's own open collision.
        let settleFrames = 0;
        while (mem[BIND_COUNT] === 1 && settleFrames < 300) {
          nes.frame();
          settleFrames++;
        }
        assert.ok(settleFrames < 300, 'the streamed landing must rebuild bind_count within 300 frames of landing');
        assert.equal(mem[BIND_COUNT], 0, "bind_count must be cleared on a streamed landing, not inherit the previous ordinary screen's active binding (pre-fix: 1)");
        mem[PROBE_X] = 0;
        mem[PROBE_Y] = 0;
        callRoutine(nes, addrOf('probe_type'));
        assert.equal(nes.cpu.REG_ACC, COL_OPEN, `probe_type(0,0) on the streamed screen must read the streamed terrain's own open collision, not the inherited solid override (pre-fix: ${COL_SOLID})`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  );
}

// ==================================================================================
// Phase 2 slice 2b, fix round 1, F7 (encounter/CHR/binding half): the review's own
// words -- "Add actual distinct-art, active-binding and encounter outcomes and
// compare them with the equivalent never-streamed map, including after each relevant
// crossing/landing." buildMixedProject's own After map already carries a real,
// distinct tileset (1, vs Before's 0) and an encounter rate (128) that a moving
// player would need well over a hundred steps to ever reach -- neither property was
// ever actually exercised by an assertion anywhere in this file. This builds a
// SEPARATE fixture (rather than mutating buildMixedProject's own returned project),
// since the two tests above already share that exact fixture and rely on its After
// map's encounters/boundTiles staying empty.

const F7_MONSTER_ACTOR = 4; // pushed after buildMixedProject's own 4 NPCs (indices 0-3)

function buildMixedProjectForF7() {
  const built = buildMixedProject();
  const { project } = built;
  const after = project.maps[2];
  project.metatiles[SOLID_METATILE] = { ...project.metatiles[SOLID_METATILE], collision: 'solid' };
  // damage > 0 is what shared/project.js's isMonsterActor uses to mark an actor hostile
  // (an rpg-mode-only meaning -- see normalizeActor's own comment) -- 0 (every other NPC
  // in this file) would silently leave start_encounter's formation empty instead of real.
  project.sprites.actors.push({ name: 'Boundary Slime', damage: 1, hp: 4, battle: { atk: 1, def: 0, speed: 1 } });
  after.encounters = { rate: 1, actorIds: [F7_MONSTER_ACTOR, F7_MONSTER_ACTOR, F7_MONSTER_ACTOR, F7_MONSTER_ACTOR] };
  // The same switch-bound solid substitute F3 uses, armed by an 'enter' trigger the
  // instant the After map is entered (a switch defaults clear/inactive) -- reusing
  // NPC_AFTER as the trigger's owner actor, the same "the trigger entity's own actorId
  // is incidental" convention buildBoundLandingProject (F3) already established.
  after.screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: SOLID_METATILE }];
  after.screens[0].entities.push({
    actorId: NPC_AFTER,
    x: project.project.startX,
    y: project.project.startY,
    props: { trigger: 'enter', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setSwitch', switch: 0 }] }] } }
  });
  return built;
}

test(
  "F7 (encounter/CHR/binding): the After map -- reached only through a streamed map -- keeps its OWN distinct CHR page, its own active switch-bound solid substitute, and its own real wandering encounter, none of them the streamed map's or an inherited default",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const { project, AFTER_TL } = buildMixedProjectForF7();
    const after = project.maps[2];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamedmixed-f7-'));
    try {
      await saveProject(dir, project);
      const built = await buildProject({ dir, project, log: () => {} });
      const symbols = fs.readFileSync(built.symbolPath, 'utf8');
      const addrOf = (label) => {
        const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
        assert.ok(m, `${label} should be a named symbol in game.fns`);
        return parseInt(m[1], 16);
      };
      const probeType = addrOf('probe_type');
      const bytes = new Uint8Array(fs.readFileSync(built.romPath));

      // callRoutine (test/lib/callroutine.js) leaves REG_PC parked inside its own
      // scratch stub at $0700 and never restores it (every other user of it, F3
      // included, ends the test right there) -- resuming ordinary nes.frame()-driven
      // play afterward runs off the end of that stub into whatever RAM follows,
      // which crashed here with a real "invalid opcode" (traced directly: a scratch
      // script placing the callRoutine probe before the encounter hold hit exactly
      // that). So the CHR/encounter half and the binding-probe half each get their
      // OWN NES instance booted from the same built ROM bytes, replaying the
      // identical landing -- the probe instance is never asked to run another frame
      // afterward.
      async function landOnAfter() {
        const nes = new NES({ onFrame: () => {}, emulateSound: false });
        nes.loadROM(bytes);
        const mem = nes.cpu.mem;
        // chr_ram_init's own multi-tileset upload loop (engine/banks.asm) transiently
        // leaves the CHR-RAM page on the OTHER tileset while it uploads it, only
        // settling back to page 0 shortly before Warp 1 fires -- traced directly (a
        // scratch script against this exact fixture): page 1 at frames 5-8, page 0
        // from frame 9, Warp 1's own landing not until frame 12. 10 frames lands
        // inside that settled-but-not-yet-warped window.
        for (let i = 0; i < 10; i++) nes.frame();
        assert.equal(mem[GAME_STATE], ST_GAMEPLAY);
        assert.equal(mem[FLAT_SCREEN], 0, 'sanity: still on the Before map, before Warp 1 fires');
        assert.equal(nes.mmap.chrPage, project.maps[0].tilesetId, "the Before map's own CHR page must be selected at boot");

        // Warp 1 (into the streamed map), then Warp 2 (out to the After map) -- both
        // polled for the real transition, never a fixed settle (see runUntilFlatScreenChanges).
        runUntilFlatScreenChanges(nes, mem);
        runUntilFlatScreenChanges(nes, mem);
        assert.equal(mem[FLAT_SCREEN], AFTER_TL, 'the second Warp must land on the After map');
        assert.equal(mem[MAP_IS_STREAMED], 0);

        // Distinct art: the After map's own CHR page (tilesetId 1), not the streamed
        // map's page still latched, and not the Before map's page either.
        assert.equal(nes.mmap.chrPage, after.tilesetId, "the After map's own distinct CHR page must be selected, not the streamed map's (or the Before map's)");
        assert.notEqual(after.tilesetId, project.maps[0].tilesetId, 'sanity: the After and Before maps must actually use distinct tilesets for this check to mean anything');
        // Settle for the 'enter' trigger's own setSwitch to run.
        for (let i = 0; i < 30; i++) nes.frame();
        return { nes, mem };
      }

      // Real encounter outcome: rate 1 means the very first moving frame on the After
      // map fires it (check_encounter, engine/rpg.asm) -- proven by actually reaching
      // ST_BATTLE, not merely by reading map_enc_rate back out of the ROM.
      {
        const { nes, mem } = await landOnAfter();
        nes.buttonDown(1, RIGHT);
        let frames = 0;
        while (mem[GAME_STATE] !== ST_BATTLE && frames < 60) {
          nes.frame();
          frames++;
        }
        nes.buttonUp(1, RIGHT);
        assert.ok(frames < 60, "the After map's own rate:1 wandering encounter must fire within 60 frames of the player moving, not stay silent like the streamed map (which refuses any rate) or the Before map (rate 0)");
        assert.equal(mem[GAME_STATE], ST_BATTLE);
      }

      // Active binding: the 'enter' trigger's setSwitch has had time to run (landOnAfter's
      // own settle); the After map's own switch-bound solid substitute at (0,0) must now
      // read solid, the exact shape F3 proves for a streamed screen, exercised here for
      // the map AFTER one. Last use of this instance -- see the callRoutine note above.
      {
        const { nes, mem } = await landOnAfter();
        mem[PROBE_X] = 0;
        mem[PROBE_Y] = 0;
        callRoutine(nes, probeType);
        assert.equal(nes.cpu.REG_ACC, COL_SOLID, "the After map's own switch-bound solid substitute at (0,0) must be active once its 'enter' trigger has set the switch");
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

// ==================================================================================
// Phase 2 slice 2b, fix round 2, R2(a): fix round 1's own F7 coverage stopped at the
// initial After landing. The review's real mutation -- after cross_set_screen updates
// ord_screen, force CHR page 0 (lda #0 / jsr switch_chr_bank) -- left ALL NINE of this
// file's tests passing, because none of them re-checked anything on the After map
// after crossing away from and back to a screen. This compares the After map's own
// behavior after EACH of the four crossings against an equivalent NEVER-STREAMED
// project's After map (same map, reached directly instead of through a streamed hop).

/** Clones `mixedBuilt.project` (from buildMixedProject or buildMixedProjectForF7),
 * discards the streamed map entirely, and repoints the Before map's own 'enter' warp
 * straight at the After map's screen(0,0) -- the same x/y the streamed path's own
 * second warp already used. Returns the new project and After's new global base id. */
function buildNeverStreamedEquivalent(mixedBuilt) {
  const project = structuredClone(mixedBuilt.project);
  const [before, , after] = project.maps;
  const afterBase = before.screens.length;
  before.screens[0].entities[0].props.event.pages[0].commands[0] = {
    op: 'warp', screen: afterBase, x: project.project.startX, y: project.project.startY
  };
  project.maps = [before, after];
  return { project, afterBase };
}

/** buildMixedProject's own After map (tileset 1, rate:128 but an EMPTY actorIds list --
 * never a real fight, so repeated crossings never risk landing in ST_BATTLE mid-walk),
 * with F3's own bound-tile shape added: a switch-bound solid substitute at (0,0), armed
 * by an 'enter' trigger the instant the After map is entered. */
function buildWalkComparisonMixed() {
  const built = buildMixedProject();
  const { project } = built;
  const after = project.maps[2];
  project.metatiles[SOLID_METATILE] = { ...project.metatiles[SOLID_METATILE], collision: 'solid' };
  after.screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: SOLID_METATILE }];
  after.screens[0].entities.push({
    actorId: NPC_AFTER,
    x: project.project.startX,
    y: project.project.startY,
    props: { trigger: 'enter', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setSwitch', switch: 0 }] }] } }
  });
  return built;
}

test(
  "R2(a): the After map's effective CHR page, bind_count and cur_song stay identical to an equivalent never-streamed project's After map after EACH of the four crossings, not merely on the initial landing",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const mixedBuilt = buildWalkComparisonMixed();
    const { project: baselineProject } = buildNeverStreamedEquivalent(mixedBuilt);

    async function land(project, viaStreamed, tmpPrefix) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `forge-streamedmixed-${tmpPrefix}-`));
      try {
        await saveProject(dir, project);
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
        for (let i = 0; i < 8; i++) nes.frame();
        runUntilFlatScreenChanges(nes, mem); // Before -> (Streamed ->) After
        if (viaStreamed) runUntilFlatScreenChanges(nes, mem); // Streamed -> After
        assert.equal(mem[MAP_IS_STREAMED], 0, 'must land on the (ordinary) After map');
        for (let i = 0; i < 30; i++) nes.frame(); // settle the 'enter' setSwitch
        return { nes, mem, probeType: addrOf('probe_type') };
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    const mixed = await land(mixedBuilt.project, true, 'r2walk-mixed');
    const baseline = await land(baselineProject, false, 'r2walk-base');

    // chrPage/bind_count/cur_song are plain property/memory reads -- never callRoutine, which
    // (per the F7 test's own note above) leaves REG_PC parked in a scratch stub and disables NMI
    // generation outright, so resuming ordinary nes.frame()-driven play afterward is unsafe. That
    // is also why the bound-tile PROBE comparison below is deferred to the very last action on
    // each instance instead of being interleaved with the crossings.
    function snapshotSafe(run) {
      return { chrPage: run.nes.mmap.chrPage, bindCount: run.mem[BIND_COUNT], curSong: run.mem[CUR_SONG] };
    }

    assert.deepEqual(snapshotSafe(mixed), snapshotSafe(baseline), 'the initial After landing must already match the never-streamed control');

    for (const button of [RIGHT, DOWN, LEFT, UP]) {
      holdUntilCross(mixed.nes, mixed.mem, button);
      holdUntilCross(baseline.nes, baseline.mem, button);
      assert.deepEqual(
        snapshotSafe(mixed),
        snapshotSafe(baseline),
        `after crossing ${button}, the After map (reached through a streamed map) must match the never-streamed control's effective CHR page, bind_count and cur_song`
      );
    }

    // The full loop returns both instances to screen(0,0), where the bound tile lives -- the one
    // safe place to spend each instance's own final, non-resumable callRoutine probe.
    mixed.mem[PROBE_X] = 0;
    mixed.mem[PROBE_Y] = 0;
    callRoutine(mixed.nes, mixed.probeType);
    const mixedProbe = mixed.nes.cpu.REG_ACC;

    baseline.mem[PROBE_X] = 0;
    baseline.mem[PROBE_Y] = 0;
    callRoutine(baseline.nes, baseline.probeType);
    const baselineProbe = baseline.nes.cpu.REG_ACC;

    assert.equal(mixedProbe, baselineProbe, "after the full loop, the After map's own bound-tile probe at (0,0) must read identically whether reached through a streamed map or not");
    assert.equal(mixedProbe, COL_SOLID, 'sanity: the bound tile must actually be active by now in both');
  }
);

test(
  "R2(a): the After map's own real wandering encounter (rate:1) fires on the exact same moving frame whether reached through a streamed map or an equivalent never-streamed project",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    // cur_map is deliberately NOT compared here or in the walk-comparison test above: removing
    // the streamed map shifts the After map's own array position (mapIndex 2 -> 1), so cur_map
    // (which the engine derives from that position) legitimately differs between the two shapes --
    // that is not a defect. cur_song is the map-level, position-independent field that actually
    // proves the same map's own identity was resolved in both cases.
    const mixedBuilt = buildMixedProjectForF7();
    const { project: baselineProject } = buildNeverStreamedEquivalent(mixedBuilt);

    async function landAndCountToBattle(project, viaStreamed, tmpPrefix) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `forge-streamedmixed-${tmpPrefix}-`));
      try {
        await saveProject(dir, project);
        const built = await buildProject({ dir, project, log: () => {} });
        const bytes = new Uint8Array(fs.readFileSync(built.romPath));
        const nes = new NES({ onFrame: () => {}, emulateSound: false });
        nes.loadROM(bytes);
        const mem = nes.cpu.mem;
        for (let i = 0; i < 10; i++) nes.frame();
        runUntilFlatScreenChanges(nes, mem);
        if (viaStreamed) runUntilFlatScreenChanges(nes, mem);
        assert.equal(mem[MAP_IS_STREAMED], 0);
        for (let i = 0; i < 30; i++) nes.frame(); // settle the 'enter' setSwitch
        nes.buttonDown(1, RIGHT);
        let frames = 0;
        while (mem[GAME_STATE] !== ST_BATTLE && frames < 60) {
          nes.frame();
          frames++;
        }
        nes.buttonUp(1, RIGHT);
        assert.ok(frames < 60, "the After map's own rate:1 wandering encounter must fire within 60 frames");
        return frames;
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    const mixedFrames = await landAndCountToBattle(mixedBuilt.project, true, 'r2enc-mixed');
    const baselineFrames = await landAndCountToBattle(baselineProject, false, 'r2enc-base');
    // check_encounter (engine/rpg.asm) fires off enc_step, a plain incrementing step counter
    // compared against the map's own rate -- not real RNG -- so at rate:1 it fires deterministically
    // on the first moving frame in both shapes; a wrong ord_screen/screen_map row reached only
    // through the streamed detour would perturb this (e.g. reading the wrong map's own rate/step
    // state), which a same-frame-count comparison catches directly.
    assert.equal(mixedFrames, baselineFrames, 'the encounter must fire on the exact same moving frame in both shapes');
  }
);

// ==================================================================================
// Phase 2 slice 3 fix round 1, Part E, item 11: every encounter/bound-tile check
// above lands on the After map's own TL screen -- whose compacted ord_screen HAPPENS
// to be 4 (Before's own 4 screens take ord 0-3, so After's own screens array order
// TL/TR/BL/BR lands at ord 4/5/6/7). A sabotaged check_encounter that silently gates
// or hardcodes on that one specific numeral (`ord_screen != 4` returns early) passes
// every test above and still looks like a real wandering encounter. This proves
// encounter firing AND the bound-tile cache independently after EACH of the four
// crossings (ord_screen 4, 5, 7, 6 in visiting order), each on its own isolated
// instance/snapshot, with cur_map/ord_screen asserted per crossing first.

function buildMixedProjectForItem11() {
  const built = buildMixedProjectForF7();
  const { project } = built;
  const after = project.maps[2];
  // A rate the walk-to-target crossings never reach on their own (each crossing
  // completes well inside holdUntilCross's own 200-frame ceiling, and at most three
  // crossings are ever walked here) -- the encounter check below primes enc_step
  // directly rather than relying on rate:1 to land exactly on the target screen's own
  // first step, which a several-crossings-deep walk cannot promise.
  after.encounters = { ...after.encounters, rate: 200 };
  // The same switch-bound solid substitute already armed at TL (screen 0, via
  // buildMixedProjectForF7's own 'enter' setSwitch) extended to the other three
  // screens -- switchId 0 is a single global bit, already set by the time any of
  // these screens is reached, so this tests whether EACH screen's own bound-tile
  // cache is independently rebuilt from that shared state, not whether the switch
  // itself works (F3 already proves that).
  // row 7/col 7 (pixel 112-127,112-127), not (0,0): TR/BR/BL are all reached by crossing
  // right and/or down, which land the player with x=0 and/or y=0 -- sitting the body's own
  // collision box exactly inside metatile (0,0)'s column/row, where a fresh solid substitute
  // there blocks every direction of travel outright (found by running this test: BR's own
  // encounter check never fired because RIGHT never moved the player at all). Screen-center
  // is clear of every crossing's own landing coordinates on all three screens.
  after.screens[1].boundTiles = [{ switchId: 0, row: 7, col: 7, metatileId: SOLID_METATILE }]; // TR
  after.screens[2].boundTiles = [{ switchId: 0, row: 7, col: 7, metatileId: SOLID_METATILE }]; // BL
  after.screens[3].boundTiles = [{ switchId: 0, row: 7, col: 7, metatileId: SOLID_METATILE }]; // BR
  return built;
}

test(
  'phase 2 slice 3 fix 1, Part E item 11: the After map fires its own wandering encounter and reads its own active bound-tile cache after EACH crossing (ord_screen 4, 5, 7 and 6), not only on the initial ord_screen-4 landing',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const { project, AFTER_TL, AFTER_TR, AFTER_BL, AFTER_BR } = buildMixedProjectForItem11();
    // Fix round 2 (review-2 finding 3, bullet 5): these are the AUTHORED ordinals -- Before's own
    // 4 screens take ord 0-3 (buildMixedProjectForF7), and After's own screens array order
    // TL/TR/BL/BR (buildMixedProjectForItem11) lands at ord 4/5/6/7 -- pinned as literals so the
    // runtime RAM assertions below are independent of ordinaryScreenView, the very function this
    // test exists to exercise.
    const ORD_TL = 4;
    const ORD_TR = 5;
    const ORD_BL = 6;
    const ORD_BR = 7;
    const { ordinaryFlat } = ordinaryScreenView(project);
    const after = project.maps[2];
    const compactOf = (idx) => ordinaryFlat.findIndex((e) => e.screen === after.screens[idx]);
    assert.equal(compactOf(0), ORD_TL, "sanity: ordinaryScreenView's own compaction must agree with the authored ordinal for TL");
    assert.equal(compactOf(1), ORD_TR, "sanity: ordinaryScreenView's own compaction must agree with the authored ordinal for TR");
    assert.equal(compactOf(2), ORD_BL, "sanity: ordinaryScreenView's own compaction must agree with the authored ordinal for BL");
    assert.equal(compactOf(3), ORD_BR, "sanity: ordinaryScreenView's own compaction must agree with the authored ordinal for BR");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamedmixed-item11-'));
    let bytes;
    let symbols;
    try {
      await saveProject(dir, project);
      const built = await buildProject({ dir, project, log: () => {} });
      bytes = new Uint8Array(fs.readFileSync(built.romPath));
      symbols = fs.readFileSync(built.symbolPath, 'utf8');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const addrOf = (label) => {
      const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
      assert.ok(m, `${label} should be a named symbol in game.fns`);
      return parseInt(m[1], 16);
    };
    const probeType = addrOf('probe_type');

    /** Boots a fresh instance and walks it through the shared setup (Before -> Streamed ->
     * After TL) plus `crossings`, landing on the target screen. */
    function landAt(crossings) {
      const nes = new NES({ onFrame: () => {}, emulateSound: false });
      nes.loadROM(bytes);
      const mem = nes.cpu.mem;
      for (let i = 0; i < 8; i++) nes.frame();
      runUntilFlatScreenChanges(nes, mem); // Before -> Streamed
      runUntilFlatScreenChanges(nes, mem); // Streamed -> After (TL)
      for (const button of crossings) holdUntilCross(nes, mem, button);
      return { nes, mem };
    }

    // TL's own bound tile is buildMixedProjectForF7's existing one at (0,0) (its landing
    // position is (100,100), no conflict); TR/BL/BR's own are at row 7/col 7 -- see
    // buildMixedProjectForItem11's own comment for why (0,0) traps the player there instead).
    // moveDir is the direction pressed for the encounter check: it must move the player AWAY
    // from whichever edge that screen's own crossing(s) landed it on, not toward another
    // crossing -- BL is reached by a LEFT crossing, which lands at the FAR (right) edge of the
    // new screen, so RIGHT there would immediately re-cross into BR instead of just moving.
    const targets = [
      { label: 'TL (0 crossings)', crossings: [], flat: AFTER_TL, ord: ORD_TL, probeX: 0, probeY: 0, moveDir: RIGHT },
      { label: 'TR (1 crossing: right)', crossings: [RIGHT], flat: AFTER_TR, ord: ORD_TR, probeX: 120, probeY: 120, moveDir: RIGHT },
      { label: 'BR (2 crossings: right, down)', crossings: [RIGHT, DOWN], flat: AFTER_BR, ord: ORD_BR, probeX: 120, probeY: 120, moveDir: RIGHT },
      { label: 'BL (3 crossings: right, down, left)', crossings: [RIGHT, DOWN, LEFT], flat: AFTER_BL, ord: ORD_BL, probeX: 120, probeY: 120, moveDir: LEFT }
    ];

    for (const { label, crossings, flat, ord, probeX, probeY, moveDir } of targets) {
      // Encounter half: its own instance, since entering ST_BATTLE is not a state this
      // file otherwise resumes ordinary field play from.
      {
        const { nes, mem } = landAt(crossings);
        assert.equal(mem[FLAT_SCREEN], flat, `${label}: flat_screen must be the true global id`);
        assert.equal(mem[ORD_SCREEN], ord, `${label}: ord_screen must be this screen's own independently expected compacted index`);
        assert.equal(mem[CUR_MAP], 2, `${label}: cur_map must be the After map's own id`);
        assert.equal(mem[MAP_IS_STREAMED], 0, `${label}: the After map is ordinary`);

        // Primed one step short of firing, so the very next moving frame fires it
        // deterministically -- a "gated on ord_screen != 4" (or any other
        // screen-specific early return) sabotage leaves game_state stuck at
        // ST_GAMEPLAY here on every target except TL.
        mem[ENC_STEP] = 199;
        nes.buttonDown(1, moveDir);
        let frames = 0;
        while (mem[GAME_STATE] !== ST_BATTLE && frames < 20) {
          nes.frame();
          frames++;
        }
        nes.buttonUp(1, moveDir);
        assert.equal(mem[GAME_STATE], ST_BATTLE, `${label}: the primed wandering encounter must fire on this screen (ord_screen ${ord}), not only at ord_screen 4`);
      }

      // Bound-tile half: a separate, fresh instance -- callRoutine parks REG_PC and
      // disables NMI, so this is always the last action taken on it.
      {
        const { nes, mem } = landAt(crossings);
        assert.equal(mem[FLAT_SCREEN], flat, `${label}: flat_screen must be the true global id (bound-tile instance)`);
        assert.equal(mem[ORD_SCREEN], ord, `${label}: ord_screen must match (bound-tile instance)`);
        for (let i = 0; i < 30; i++) nes.frame(); // settle the shared switch's own cache rebuild
        mem[PROBE_X] = probeX;
        mem[PROBE_Y] = probeY;
        callRoutine(nes, probeType);
        assert.equal(nes.cpu.REG_ACC, COL_SOLID, `${label}: this screen's own bound-tile cache at (${probeX},${probeY}) must read solid, independently of the others`);
      }
    }
  }
);
