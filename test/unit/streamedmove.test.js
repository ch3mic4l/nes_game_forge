// Large streamed worlds (ROADMAP item 15), phase 2 slice 3: scripted Move's own bound/probe/
// accumulator arms in move_tick/move_speed_player (engine/entities.asm), the mv_ent identity
// capture (script_op_move, engine/script.asm; ruling 7), and the runtime-behaviour half of D.3's
// error-to-warning lift (the warning/build-refusal text itself is covered in streamed.test.js and
// streamworld.test.js -- this file is about whether the engine actually does what those tests now
// only assert it is allowed to attempt).
//
// Fix round 1 (handoff-next/streamed-worlds-phase2-s3-review1.md) found this file's round-1
// version let two named-forbidden implementations (flat PLAYER_SPEED on a streamed player Move;
// a direct sw_peek_byte in place of the fill-aware sw_terrain_or_fill) pass all ten tests. This
// rewrite computes exact per-frame expectations from the documented algorithm (SW_SPEED_SUB_X/Y,
// engine/streamworld.asm) rather than only checking a final position, and gives every probe test
// current-vs-neighbour terrain that actually differs, so a wrong implementation that reads the
// wrong screen -- or no screen at all -- produces a value this file can tell apart from correct.
//
// Addresses/constants below are transcribed by hand from the named engine file, per CLAUDE.md's
// own rule that a test reading the file it is checking proves nothing; each is commented with its
// source.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import NES from '../../renderer/emulator/core/nes.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// from engine/constants.asm
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const GAME_STATE = 0x25;
const MAP_IS_STREAMED = 0xfe;
const MV_LEFT = 0x96;
const MV_ENT = 0x5ff;
const TALK_ENT = 0x3a;
const ENT_X = 0x310; // entity table base, +1 per slot (rammap.test.js)
const ENT_Y = 0x318;
const ENT_FRAME = 0x328;
const MTPTR_LO = 0x02;
const MTPTR_HI = 0x03;
const FLAT_SCREEN = 0x16;
const MAPPER_SHADOW = 0x35;
const ORD_SCREEN = 0xff;
const MAX_X = 240;
const MAX_Y = 224;
// BODY_L=2/BODY_R=13/BODY_T=8/BODY_B=15 (engine/constants.asm) are the leading-edge insets the
// probe reproductions below are built around, in prose rather than as JS constants -- each test
// names the exact pixel math inline (e.g. "239+BODY_B(15)=254") since every case uses a different
// one of the four.

// from engine/streamworld.asm
const SW_WALK_ACC_X = 0x3d8;
const SW_WALK_ACC_Y = 0x3d9;
const SW_SPEED_SUB_X = 128;
const SW_SPEED_SUB_Y = 112;

// from test/lib/streamedproject.js: buildStreamedMap's own grid, screens in row-major
// (row*gridW+col) order -- screen 0 is (col0,row0), the last screen (gridW*gridH-1) is the
// grid's own far corner.
const GRID_W = 3;
const GRID_H = 2;
const LAST_SCREEN = GRID_W * GRID_H - 1;

const ST_GAMEPLAY = 0;

const SCREEN_COLS = 16; // shared/project.js LIMITS.screenCols

/**
 * One frame of sw_walk_step_x/sw_walk_step_y (engine/streamworld.asm), reimplemented from its
 * documented shape: acc += sub (8-bit wrap), step is 2 on carry-out, 1 otherwise.
 */
function walkStep(acc, sub) {
  const sum = acc + sub;
  return { step: sum >= 256 ? 2 : 1, acc: sum & 0xff };
}

/** N frames of the accumulator, starting from acc=0 (boot clears $0300+ -- ruling in fix round 1). */
function simulateWalk(sub, frames) {
  const trace = [];
  let acc = 0;
  for (let i = 0; i < frames; i++) {
    const { step, acc: next } = walkStep(acc, sub);
    trace.push({ step, acc: next });
    acc = next;
  }
  return trace;
}

/**
 * Fix round 2, Part B: the index (0-based) of the first step===2 tick in sub's own trace from
 * residue 0, and the cumulative distance already covered by the steps before it -- both the
 * bounds discriminator below and the tightened off-grid fill assertions in Part C derive their
 * exact overshoot start position from this, rather than a hand-picked magic number.
 */
function firstDoubleStep(sub) {
  const trace = simulateWalk(sub, 20);
  let cumulative = 0;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i].step === 2) return { index: i, cumulativeBefore: cumulative, trace };
    cumulative += trace[i].step;
  }
  throw new Error('expected a step=2 tick within the simulated window');
}

/**
 * Simulates sub's own accumulator walking from `start` toward `ceiling` (right/down,
 * towardZero=false) or toward 0 (left/up, towardZero=true), refusing outright -- not clamping --
 * the first tick whose RAW step would pass the bound, matching the production wall's own shape
 * (an 8-bit carry/a cmp #240/a borrow, never a clamp). Returns the position once refused, how many
 * ticks it took (including the refused one), and the accumulator value the refused tick itself
 * left behind (kept, never refunded).
 */
function walkToWall(sub, start, { towardZero, ceiling, maxTicks = 20 } = {}) {
  const trace = simulateWalk(sub, maxTicks);
  let pos = start;
  for (let i = 0; i < trace.length; i++) {
    const candidate = towardZero ? pos - trace[i].step : pos + trace[i].step;
    const refused = towardZero ? candidate < 0 : candidate > ceiling;
    if (refused) return { pos, ticks: i + 1, acc: trace[i].acc };
    pos = candidate;
  }
  throw new Error('did not reach the wall within maxTicks');
}

async function buildAndBoot(project, { requireStreamed = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamedmove-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const bytes = new Uint8Array(fs.readFileSync(built.romPath));
    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(bytes);
    const mem = nes.cpu.mem;
    let frames = 0;
    while ((mem[GAME_STATE] !== ST_GAMEPLAY || (requireStreamed && mem[MAP_IS_STREAMED] !== 1)) && frames < 200) {
      nes.frame();
      frames++;
    }
    assert.ok(frames < 200, 'cold boot must reach ST_GAMEPLAY well within 200 frames');
    return { nes, mem };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Runs until the 'enter'-triggered Move has actually started (mv_left nonzero -- the cold-boot
 * landing frame is not itself the frame the screen's own 'enter' event dispatches on), then until
 * it ends (mv_left back to 0) or gives up. Returns false if the Move never started at all, so a
 * caller that meant to test running Move logic does not silently pass on one that never ran.
 */
function settleMove(nes, frames = 400) {
  const mem = nes.cpu.mem;
  let i = 0;
  for (; i < frames && mem[MV_LEFT] === 0; i++) nes.frame();
  if (mem[MV_LEFT] === 0) return false;
  for (; i < frames && mem[MV_LEFT] !== 0; i++) nes.frame();
  return mem[MV_LEFT] === 0;
}

/** Advances until mv_left first reads nonzero. Returns the frame count taken, or -1 on timeout. */
function awaitMoveStart(nes, mem, frames = 60) {
  let i = 0;
  for (; i < frames && mem[MV_LEFT] === 0; i++) nes.frame();
  return mem[MV_LEFT] !== 0 ? i : -1;
}

function baseMoveProject({ dir, dist, startX, startY, moveScreen = 0 } = {}) {
  const project = createStreamedProject({
    moveCommands: [{ op: 'move', who: 'player', dir, dist }],
    moveScreen
  });
  if (moveScreen !== 0) project.project.startScreen = moveScreen;
  project.maps[0].screens[moveScreen].props = project.maps[0].screens[moveScreen].props ?? {};
  const entity = project.maps[0].screens[moveScreen].entities.find((e) => e.props?.event);
  entity.props.trigger = 'enter';
  if (Number.isFinite(startX)) project.project.startX = startX;
  if (Number.isFinite(startY)) project.project.startY = startY;
  return project;
}

function solidProject({ dir, dist, startX, startY, fillSolid = false } = {}) {
  const project = baseMoveProject({ dir, dist, startX, startY });
  if (fillSolid) project.metatiles[project.maps[0].fillMetatileId ?? 0].collision = 'solid';
  return project;
}

/** Marks metatile id `id` solid, and stamps it across the given screen's offsets. */
function paintSolid(project, screenIndex, id, offsets) {
  project.metatiles[id].collision = 'solid';
  const screen = project.maps[0].screens[screenIndex];
  for (const offset of offsets) screen.metatiles[offset] = id;
}

function columnOffsets(col) {
  const offsets = [];
  for (let row = 0; row < 15; row++) offsets.push(row * SCREEN_COLS + col);
  return offsets;
}

function rowOffsets(row) {
  const offsets = [];
  for (let col = 0; col < SCREEN_COLS; col++) offsets.push(row * SCREEN_COLS + col);
  return offsets;
}

const boots = { skip: !hasNesasm && 'nesasm not found on PATH' };

// ==========================================================================
// Part D items 1-4: the ownership-rectangle bound, at the exact fringe, with
// a per-frame monitor (never leaves 0-255/0-239, never jumps by more than the
// 2px a single tick can ever cover -- a silent 8-bit wrap would fail this the
// same way an out-of-range value would).
// ==========================================================================

test('the streamed rectangle bound holds at the exact 254/255, 238/239 and 0/0 fringes', boots, async () => {
  const scenarios = [
    { label: 'RIGHT from 254', dir: 'right', axis: 'x', start: { startX: 254, startY: 112 } },
    { label: 'RIGHT from 255', dir: 'right', axis: 'x', start: { startX: 255, startY: 112 } },
    { label: 'DOWN from 238', dir: 'down', axis: 'y', start: { startX: 120, startY: 238 } },
    { label: 'DOWN from 239', dir: 'down', axis: 'y', start: { startX: 120, startY: 239 } },
    { label: 'LEFT from 0', dir: 'left', axis: 'x', start: { startX: 0, startY: 112 } },
    { label: 'UP from 0', dir: 'up', axis: 'y', start: { startX: 120, startY: 0 } }
  ];
  for (const { label, dir, axis, start } of scenarios) {
    const project = solidProject({ dir, dist: 10, ...start });
    const { nes, mem } = await buildAndBoot(project);
    const reg = axis === 'x' ? PLAYER_X : PLAYER_Y;
    const maxVal = axis === 'x' ? 255 : 239;
    const started = awaitMoveStart(nes, mem);
    assert.ok(started >= 0, `${label}: the Move must start`);
    let prev = mem[reg];
    assert.ok(prev >= 0 && prev <= maxVal, `${label}: start position ${prev} in range`);
    let frames = 0;
    while (mem[MV_LEFT] !== 0 && frames < 60) {
      nes.frame();
      frames++;
      const cur = mem[reg];
      assert.ok(cur >= 0 && cur <= maxVal, `${label}: position ${cur} left 0-${maxVal}`);
      assert.ok(Math.abs(cur - prev) <= 2, `${label}: jumped from ${prev} to ${cur} (>2px, a silent wrap)`);
      prev = cur;
    }
    assert.equal(mem[MV_LEFT], 0, `${label}: the Move must finish within the frame budget`);
  }
});

// ==========================================================================
// Part D items 5/6: crossing probes. Current-screen terrain stays the
// default varied pattern (open); the neighbour's own solid tile is a fresh
// id created just for this test, so the two are never accidentally the same
// value -- a wrong implementation reading the CURRENT screen at the probe
// offset sees open and does not block, exactly the escape this exercises.
// ==========================================================================

test('finding 1, repro 1: a RIGHT Move at y=239 is blocked by the BOTTOM neighbour, not the current screen', boots, async () => {
  // old_y=239, probe_y = 239+BODY_B(15) = 254 >= 240 -> normalizes to LOCAL pixel y=254-240=14 on
  // the row-below neighbour (screen 3, col0/row1) -- 14 is still within that neighbour's own top
  // metatile ROW 0 (14>>4=0), regardless of x -- painting that neighbour's entire row 0 solid
  // blocks the very first tick, before old_x has even had a chance to move.
  const project = baseMoveProject({ dir: 'right', dist: 20, startX: 40, startY: 239 });
  paintSolid(project, 3, 10, rowOffsets(0));
  const { nes, mem } = await buildAndBoot(project);
  const mapperBefore = mem[MAPPER_SHADOW];
  const mtptrLoBefore = mem[MTPTR_LO];
  const mtptrHiBefore = mem[MTPTR_HI];
  const flatBefore = mem[FLAT_SCREEN];
  const ordBefore = mem[ORD_SCREEN];
  assert.ok(settleMove(nes));
  assert.equal(mem[PLAYER_X], 40, 'blocked on the very first tick -- the perpendicular probe crossed before x ever moved');
  assert.equal(mem[MAP_IS_STREAMED], 1, 'still on the streamed map');
  assert.equal(mem[MAPPER_SHADOW], mapperBefore, 'sw_locate_current must restore the caller\'s own PRG bank after the neighbour peek');
  assert.equal(mem[MTPTR_LO], mtptrLoBefore, 'mtptr_lo restored to the current screen after a refused probe');
  assert.equal(mem[MTPTR_HI], mtptrHiBefore, 'mtptr_hi restored to the current screen after a refused probe');
  assert.equal(mem[FLAT_SCREEN], flatBefore, 'a refused probe must not change which screen owns the player');
  assert.equal(mem[ORD_SCREEN], ordBefore, 'a refused probe must not change ord_screen');
});

test('finding 1, repro 2: a DOWN Move at x=255 is blocked by the RIGHT neighbour, not the current screen', boots, async () => {
  // old_x=255, probe_x = 255+BODY_L(2) = 257 -> 8-bit carry -> normalizes to the column-right
  // neighbour (screen 1, col1/row0) at local x=1 (the wrapped low byte), regardless of y --
  // painting that neighbour's entire column 0 (256's own local-x wraps to column 0) solid blocks
  // the first tick, before old_y has moved.
  const project = baseMoveProject({ dir: 'down', dist: 20, startX: 255, startY: 40 });
  paintSolid(project, 1, 11, columnOffsets(0));
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(settleMove(nes));
  assert.equal(mem[PLAYER_Y], 40, 'blocked on the very first tick -- the x-crossing probe fired before y ever moved');
});

test('finding 1, repro 3 (corner): a RIGHT Move at (250,239) is blocked by the BOTTOM-RIGHT neighbour', boots, async () => {
  // Both the moving axis (candidate+BODY_R can carry once candidate>=243) and the perpendicular
  // axis (old_y+BODY_B=254, local y=14, metatile row 0) cross at once -- the diagonal neighbour is
  // screen 4 (col1/row1). Painting ONLY that screen's own row 0 (never screens 1 or 3, the
  // single-axis neighbours) solid means a normalization that only checks one axis reads an open,
  // untouched screen and fails to block.
  const project = baseMoveProject({ dir: 'right', dist: 20, startX: 250, startY: 239 });
  paintSolid(project, 4, 12, rowOffsets(0));
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(settleMove(nes));
  assert.equal(mem[PLAYER_X], 250, 'blocked on the very first tick by the diagonal neighbour alone');
});

test('a crossing probe reading passable (open) neighbour terrain lets the player reach the true edge', boots, async () => {
  const project = solidProject({ dir: 'right', dist: 60, startX: 200, startY: 112, fillSolid: false });
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(settleMove(nes));
  assert.equal(mem[PLAYER_X], 255, 'open neighbour terrain must not block reaching the true edge');
});

// Off-grid crossings: the grid's own far corner (LAST_SCREEN) has no real neighbour past its own
// right column or bottom row, so sw_terrain_or_fill's bounds check -- not a real screen read --
// decides. Each of the three shapes (right edge only, bottom edge only, both at once) is run with
// the fill metatile both solid and open, matching Part D's explicit six-way requirement.
// Fix round 2, finding C (ruling L): an off-grid movement/solid probe is unconditionally solid
// before any bank switch, never sw_fill_metatile_id's own collision type -- open and solid fill
// must produce IDENTICAL collision. This replaces the pre-fix expectation that an open fill let
// the probe pass through to the accumulator's own predicted (wrong) endpoint.
for (const solid of [true, false]) {
  test(`off-grid RIGHT-edge crossing is blocked identically regardless of fill (${solid ? 'solid' : 'open'})`, boots, async () => {
    const project = baseMoveProject({ dir: 'right', dist: 20, startX: 250, startY: 112, moveScreen: LAST_SCREEN });
    if (solid) project.metatiles[project.maps[0].fillMetatileId ?? 0].collision = 'solid';
    const { nes, mem } = await buildAndBoot(project);
    assert.ok(settleMove(nes));
    assert.equal(mem[PLAYER_X], 250, `${solid ? 'a solid' : 'an open'} fill must block the off-grid right-edge crossing -- fix round 2, finding C`);
  });

  test(`off-grid BOTTOM-edge crossing is blocked identically regardless of fill (${solid ? 'solid' : 'open'})`, boots, async () => {
    const project = baseMoveProject({ dir: 'down', dist: 20, startX: 112, startY: 230, moveScreen: LAST_SCREEN });
    if (solid) project.metatiles[project.maps[0].fillMetatileId ?? 0].collision = 'solid';
    const { nes, mem } = await buildAndBoot(project);
    assert.ok(settleMove(nes));
    assert.equal(mem[PLAYER_Y], 230, `${solid ? 'a solid' : 'an open'} fill must block the off-grid bottom-edge crossing -- fix round 2, finding C`);
  });

  test(`off-grid CORNER crossing is blocked identically regardless of fill (${solid ? 'solid' : 'open'})`, boots, async () => {
    const project = baseMoveProject({ dir: 'right', dist: 20, startX: 250, startY: 239, moveScreen: LAST_SCREEN });
    if (solid) project.metatiles[project.maps[0].fillMetatileId ?? 0].collision = 'solid';
    const { nes, mem } = await buildAndBoot(project);
    assert.ok(settleMove(nes));
    assert.equal(mem[PLAYER_X], 250, `${solid ? 'a solid' : 'an open'} fill must block the off-grid corner crossing -- fix round 2, finding C`);
  });
}

// ==========================================================================
// Part D item 8/8b: the accumulator rate, frame by frame, from a known start
// residue of 0 (boot clears $0300+), including a distance-clipped final step
// and the residue left behind afterwards -- both on a normal completion and
// on a tick the wall refuses outright (8b, the pinned residue policy).
// ==========================================================================

test('a scripted player Move on X advances at sw_walk_step_x, frame by frame, including a clipped final step', boots, async () => {
  // Escape this closes: flat PLAYER_SPEED (every step would be 2, not the true 1,2,1,2,...
  // pattern); SUB_Y used for X; any other constant -- each diverges from this trace within the
  // first couple of frames.
  const trace = simulateWalk(SW_SPEED_SUB_X, 12);
  const distanceThrough11 = trace.slice(0, 11).reduce((sum, f) => sum + f.step, 0);
  const dist = distanceThrough11 + 1; // frame 12's own candidate (2) must be clipped down to 1
  const project = solidProject({ dir: 'right', dist, startX: 40, startY: 112 });
  const { nes, mem } = await buildAndBoot(project);
  const started = awaitMoveStart(nes, mem);
  assert.ok(started >= 0, 'the Move must start');
  assert.equal(mem[SW_WALK_ACC_X], 0, 'sw_walk_acc_x must still read the boot-cleared 0 the instant mv_left first goes nonzero');
  const x0 = mem[PLAYER_X];
  let cumulative = 0;
  for (let i = 0; i < 12; i++) {
    nes.frame();
    const predictedStep = Math.min(trace[i].step, dist - cumulative);
    cumulative += predictedStep;
    assert.equal(mem[PLAYER_X], x0 + cumulative, `frame ${i + 1}: position must match the accumulator's own predicted step`);
    assert.equal(mem[SW_WALK_ACC_X], trace[i].acc, `frame ${i + 1}: sw_walk_acc_x must advance by the RAW step, unclipped -- no refund from the distance clip`);
  }
  assert.equal(mem[MV_LEFT], 0, 'the Move must have finished exactly on schedule');
  assert.equal(mem[PLAYER_X], x0 + dist, 'the full authored distance must land exactly, whatever the per-frame step sizes were');
});

test('a scripted player Move on Y advances at sw_walk_step_y, frame by frame, including a clipped final step', boots, async () => {
  const trace = simulateWalk(SW_SPEED_SUB_Y, 12);
  const distanceThrough9 = trace.slice(0, 9).reduce((sum, f) => sum + f.step, 0);
  const dist = distanceThrough9 + 1; // frame 10's own candidate must be clipped down
  const project = solidProject({ dir: 'down', dist, startX: 120, startY: 40 });
  const { nes, mem } = await buildAndBoot(project);
  const started = awaitMoveStart(nes, mem);
  assert.ok(started >= 0, 'the Move must start');
  assert.equal(mem[SW_WALK_ACC_Y], 0, 'sw_walk_acc_y must still read the boot-cleared 0 the instant mv_left first goes nonzero');
  const y0 = mem[PLAYER_Y];
  let cumulative = 0;
  let frame = 0;
  while (mem[MV_LEFT] !== 0 && frame < 12) {
    nes.frame();
    const predictedStep = Math.min(trace[frame].step, dist - cumulative);
    cumulative += predictedStep;
    assert.equal(mem[PLAYER_Y], y0 + cumulative, `frame ${frame + 1}: position must match sw_walk_step_y's own prediction, not sw_walk_step_x's`);
    assert.equal(mem[SW_WALK_ACC_Y], trace[frame].acc, `frame ${frame + 1}: sw_walk_acc_y must advance by the RAW step, unclipped`);
    frame++;
  }
  assert.equal(mem[MV_LEFT], 0, 'the Move must have finished');
  assert.equal(mem[PLAYER_Y], y0 + dist, 'the full authored distance must land exactly');
});

test('8b: a tick the wall refuses still keeps its own accumulator advance -- no refund', boots, async () => {
  // Starting at x=3 moving left with a large distance: the wall (borrow past 0) refuses the third
  // tick outright, yet move_speed (and so the accumulator) has already run on that very tick --
  // the residue policy's own contract (docs/reference-engine.md).
  const trace = simulateWalk(SW_SPEED_SUB_X, 3);
  const project = solidProject({ dir: 'left', dist: 60, startX: 3, startY: 112 });
  const { nes, mem } = await buildAndBoot(project);
  const started = awaitMoveStart(nes, mem);
  assert.ok(started >= 0, 'the Move must start');
  assert.equal(mem[SW_WALK_ACC_X], 0, 'known start residue: 0');
  let frame = 0;
  while (mem[MV_LEFT] !== 0 && frame < 10) {
    nes.frame();
    frame++;
  }
  assert.equal(frame, 3, 'x=3 must borrow past 0 on exactly the third tick (steps 1, 2, then a refused 1)');
  assert.equal(mem[PLAYER_X], 0, 'the first two ticks (1 then 2) land exactly on 0; the third is refused');
  assert.equal(mem[SW_WALK_ACC_X], trace[2].acc, 'the refused tick\'s own accumulator advance is kept, not refunded');
});

// ==========================================================================
// Fix round 2, Part B (review-2 finding 2): 8b's own x=3 case reaches zero
// EXACTLY on steps 1,2 -- no tick ever overshoots the wall, so a restored
// clamp ("already at the wall -> refuse; otherwise subtract/add the step and
// clamp an out-of-range candidate to the wall, rather than refusing the
// whole tick") passes every existing test unnoticed. These four cases start
// one pixel inside the rectangle on a tick whose own step is 2, so the
// correct wall (refuse outright, stay one pixel short, keep the
// accumulator's advance) and a clamp (silently land on the wall anyway)
// disagree.
// ==========================================================================

test('8c: an off-parity step is refused exactly one pixel short of the wall, not clamped to it, in all four directions', boots, async () => {
  const scenarios = [
    { label: 'LEFT toward 0', dir: 'left', axis: 'x', sub: SW_SPEED_SUB_X, towardZero: true, ceiling: 255, other: 112 },
    { label: 'UP toward 0', dir: 'up', axis: 'y', sub: SW_SPEED_SUB_Y, towardZero: true, ceiling: 239, other: 120 },
    { label: 'RIGHT toward 255', dir: 'right', axis: 'x', sub: SW_SPEED_SUB_X, towardZero: false, ceiling: 255, other: 112 },
    { label: 'DOWN toward 239', dir: 'down', axis: 'y', sub: SW_SPEED_SUB_Y, towardZero: false, ceiling: 239, other: 120 }
  ];
  for (const { label, dir, axis, sub, towardZero, ceiling, other } of scenarios) {
    const double = firstDoubleStep(sub);
    const start = towardZero ? 1 + double.cumulativeBefore : (ceiling - 1) - double.cumulativeBefore;
    const reg = axis === 'x' ? PLAYER_X : PLAYER_Y;
    const accReg = axis === 'x' ? SW_WALK_ACC_X : SW_WALK_ACC_Y;
    const project = solidProject({
      dir,
      dist: 60,
      startX: axis === 'x' ? start : other,
      startY: axis === 'y' ? start : other
    });
    const { nes, mem } = await buildAndBoot(project);
    const started = awaitMoveStart(nes, mem);
    assert.ok(started >= 0, `${label}: the Move must start`);
    assert.equal(mem[accReg], 0, `${label}: known start residue: 0`);
    const expected = walkToWall(sub, start, { towardZero, ceiling });
    let frame = 0;
    while (mem[MV_LEFT] !== 0 && frame < expected.ticks + 5) {
      nes.frame();
      frame++;
    }
    assert.equal(frame, expected.ticks, `${label}: the wall must refuse on tick ${expected.ticks}, one pixel short -- not the tick a clamp/off-by-one would land on`);
    assert.equal(mem[MV_LEFT], 0, `${label}: the Move must have finished (refused, not retried)`);
    assert.equal(mem[reg], expected.pos, `${label}: the wall must refuse the overshooting tick outright, one pixel short of the true edge -- not clamp to it`);
    assert.equal(mem[accReg], expected.acc, `${label}: the refused tick's own accumulator advance is kept, not refunded`);
  }
});

// ==========================================================================
// Part D item 7: the ordinary map keeps both today's MAX_X/MAX_Y wall AND
// today's flat PLAYER_SPEED rate (not the streamed accumulator).
// ==========================================================================

test('a scripted player Move on the ORDINARY map of a mixed project walls at MAX_X/MAX_Y and steps at PLAYER_SPEED', boots, async () => {
  const PLAYER_SPEED = 2; // main/build/generate.js: 'PLAYER_SPEED  = 2'
  function ordinaryMoveProject(dir, startX, startY, dist) {
    const project = createStreamedProject({ mixed: true });
    assert.equal(project.project.startMap, 0);
    assert.equal(project.maps[0].streamed, undefined);
    const actorId = project.sprites.actors.length;
    project.sprites.actors.push({ name: 'Mover', behavior: 'npc', hp: 1, damage: 0 });
    project.maps[0].screens[0].entities.push({
      actorId,
      x: startX,
      y: startY,
      props: {
        trigger: 'enter',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'move', who: 'player', dir, dist }] }] }
      }
    });
    project.project.startX = startX;
    project.project.startY = startY;
    return project;
  }

  // X: MAX_X (240), rate PLAYER_SPEED.
  {
    const project = ordinaryMoveProject('right', 200, 112, 60);
    const { nes, mem } = await buildAndBoot(project, { requireStreamed: false });
    const started = awaitMoveStart(nes, mem);
    assert.ok(started >= 0);
    let frames = 0;
    while (mem[MV_LEFT] !== 0 && frames < 60) { nes.frame(); frames++; }
    assert.equal(mem[PLAYER_X], MAX_X, "an ordinary map keeps today's MAX_X wall (240)");
    // +1: the tick that lands exactly on 240 does not itself refuse -- the wall only fires on the
    // NEXT tick's own candidate (242), one more call to move_speed that moves nothing (the same
    // refused-tick residue accounting test 8b pins) but still costs a frame.
    assert.equal(frames, (MAX_X - 200) / PLAYER_SPEED + 1, 'an ordinary player Move must step at the flat PLAYER_SPEED, not the accumulator');
  }
  // Y: MAX_Y (224), rate PLAYER_SPEED.
  {
    const project = ordinaryMoveProject('down', 120, 190, 60);
    const { nes, mem } = await buildAndBoot(project, { requireStreamed: false });
    const started = awaitMoveStart(nes, mem);
    assert.ok(started >= 0);
    let frames = 0;
    while (mem[MV_LEFT] !== 0 && frames < 60) { nes.frame(); frames++; }
    assert.equal(mem[PLAYER_Y], MAX_Y, "an ordinary map keeps today's MAX_Y wall (224)");
    assert.equal(frames, (MAX_Y - 190) / PLAYER_SPEED + 1, 'an ordinary player Move must step at the flat PLAYER_SPEED');
  }
});

// ==========================================================================
// Part D item 9: an NPC (self) Move on a streamed map keeps the tighter
// MAX_X/MAX_Y actor-policy wall AND its own actor_speed -- give it speed 1
// so a wrong implementation hardcoding 2 (or any other constant) fails.
// ==========================================================================

test('a scripted NPC (self) Move on a streamed map keeps MAX_X/MAX_Y and its own actor_speed (1)', boots, async () => {
  {
    const project = createStreamedProject({
      moveCommands: [{ op: 'move', who: 'self', dir: 'right', dist: 60 }],
      moveX: 200,
      moveY: 112
    });
    project.sprites.actors[project.sprites.actors.length - 1].speed = 1;
    const entity = project.maps[0].screens[0].entities.find((e) => e.props?.event);
    entity.props.trigger = 'enter';
    const { nes, mem } = await buildAndBoot(project);
    const started = awaitMoveStart(nes, mem);
    assert.ok(started >= 0);
    let frames = 0;
    while (mem[MV_LEFT] !== 0 && frames < 60) { nes.frame(); frames++; }
    assert.equal(mem[ENT_X], MAX_X, "the NPC mover's own MAX_X wall (240) is unchanged by ruling 7 -- only the player mover is wider");
    // +1: the wall-refusal tick past the exact landing (see the ordinary-map test's own comment).
    assert.equal(frames, MAX_X - 200 + 1, 'an NPC self-Move must step at its OWN actor_speed (1 here), not a hardcoded 2');
  }
  // Fix round 2, Part B (review-2 finding 3, bullet 4): the X-only version above cannot tell a
  // hardcoded MAX_X reuse on the Y axis apart from a correct MAX_Y -- this is that Y counterpart.
  {
    const project = createStreamedProject({
      moveCommands: [{ op: 'move', who: 'self', dir: 'down', dist: 60 }],
      moveX: 120,
      moveY: 190
    });
    project.sprites.actors[project.sprites.actors.length - 1].speed = 1;
    const entity = project.maps[0].screens[0].entities.find((e) => e.props?.event);
    entity.props.trigger = 'enter';
    const { nes, mem } = await buildAndBoot(project);
    const started = awaitMoveStart(nes, mem);
    assert.ok(started >= 0);
    let frames = 0;
    while (mem[MV_LEFT] !== 0 && frames < 60) { nes.frame(); frames++; }
    assert.equal(mem[ENT_Y], MAX_Y, "the NPC mover's own MAX_Y wall (224) is unchanged by ruling 7 -- only the player mover is wider");
    assert.equal(frames, MAX_Y - 190 + 1, 'an NPC self-Move must step at its OWN actor_speed (1 here) on the Y axis too');
  }
});

// ==========================================================================
// Part D item 2/10: mv_ent identity. The decoy has a different speed AND a
// different y from the mover, and none of ent_x/ent_y/ent_frame may ever
// move on it -- a live-talk_ent read (instead of the captured mv_ent) in
// ANY of move_get_y/move_speed/move_animate would show up as a decoy value
// changing, or the mover's own ent_frame never animating at all.
// ==========================================================================

test('a MOVE_SELF Move keeps its own captured mv_ent slot even if talk_ent is reassigned mid-flight', boots, async () => {
  const project = createStreamedProject({
    moveCommands: [{ op: 'move', who: 'self', dir: 'right', dist: 30 }],
    moveX: 32,
    moveY: 112
  });
  const moverActor = project.sprites.actors[project.sprites.actors.length - 1];
  moverActor.speed = 1;
  // A real, minimal 2-frame/1-duration walk-side animation so ent_frame actually has somewhere
  // to go -- without one, entity_animation answers NO_ANIM and ent_frame trivially never changes
  // for ANY entity, mover included, proving nothing about mv_ent.
  project.sprites.metasprites = [{ tiles: [{ y: 0, tile: 0, palette: 0, hflip: false, vflip: false, x: 0 }] }];
  project.sprites.animations = [{ frames: [{ metaspriteId: 0, duration: 1 }, { metaspriteId: 0, duration: 1 }] }];
  moverActor.anims = { walkSide: 0 };
  const entity = project.maps[0].screens[0].entities.find((e) => e.props?.event);
  entity.props.trigger = 'enter';
  // A second, decoy NPC: a different speed AND a different y, no animation, no event of its own --
  // talk_ent is forced to name it mid-Move.
  const decoyId = project.sprites.actors.length;
  project.sprites.actors.push({ name: 'Decoy', behavior: 'npc', hp: 1, damage: 0, speed: 5 });
  project.maps[0].screens[0].entities.push({ actorId: decoyId, x: 96, y: 200, props: {} });
  const { nes, mem } = await buildAndBoot(project);

  let frames = 0;
  while (mem[MV_LEFT] === 0 && frames < 60) { nes.frame(); frames++; }
  assert.ok(mem[MV_LEFT] > 0, 'the Move must be in flight before the sabotage RAM write lands');
  const moverSlot = mem[MV_ENT];
  const decoySlot = 1 - moverSlot;
  const decoyXBefore = mem[ENT_X + decoySlot];
  const decoyYBefore = mem[ENT_Y + decoySlot];
  const decoyFrameBefore = mem[ENT_FRAME + decoySlot];
  assert.equal(decoyXBefore, 96, "the decoy must still be at its own untouched starting x");
  assert.equal(decoyYBefore, 200, "the decoy must still be at its own untouched starting y");

  // Sabotage: force talk_ent to name the decoy mid-flight. A wrong implementation reading live
  // talk_ent (instead of the captured mv_ent) would now redirect every remaining
  // move_get_*/move_set_*/move_speed/move_animate call onto the decoy's slot instead of the
  // mover's -- which, since the decoy's own speed (5) and y (200) differ from the mover's (1, 112),
  // would show up immediately as a wrong step size or a moving y.
  mem[TALK_ENT] = decoySlot;

  // Fix round 2, Part A (review-2 finding 1): the endpoint alone does not discriminate
  // move_speed -- distance 30 lands on the identical 32+30 endpoint whether the mover steps at
  // its OWN speed (1, thirty frames) or the decoy's (5, six frames, 30/5 divides evenly too). The
  // per-frame delta and the exact frame count below do.
  let moverFrameChanged = false;
  let prevMoverX = mem[ENT_X + moverSlot];
  frames = 0;
  while (mem[MV_LEFT] !== 0 && frames < 60) {
    nes.frame();
    frames++;
    assert.equal(mem[ENT_X + decoySlot], decoyXBefore, "the sabotaged decoy's own x must never move");
    assert.equal(mem[ENT_Y + decoySlot], decoyYBefore, "the sabotaged decoy's own y must never move");
    assert.equal(mem[ENT_FRAME + decoySlot], decoyFrameBefore, "the sabotaged decoy's own ent_frame must never animate");
    const curMoverX = mem[ENT_X + moverSlot];
    assert.equal(curMoverX, prevMoverX + 1, "the mover's own per-frame step must be its OWN speed (1), not the decoy's (5) -- a live-talk_ent move_speed reads the wrong actor_speed");
    prevMoverX = curMoverX;
    if (mem[ENT_FRAME + moverSlot] !== 0) moverFrameChanged = true;
  }
  assert.equal(mem[MV_LEFT], 0, 'the Move must still end');
  assert.equal(frames, 30, 'the mover must take exactly 30 frames at its OWN speed (1) -- a live-talk_ent speed read (5) would finish in only 6');
  assert.equal(mem[ENT_X + moverSlot], 32 + 30, 'mv_ent must keep the original entity as the mover, moving its OWN full distance at its OWN speed (1) despite the talk_ent sabotage');
  assert.equal(mem[ENT_Y + moverSlot], 112, "the mover's own y must be untouched by a horizontal Move");
  assert.ok(moverFrameChanged, "the mover's own ent_frame must actually animate over the course of the Move");
});

// ==========================================================================
// Fix round 2, Part A (review-2 finding 1): the horizontal test above only exercises
// move_get_x/move_set_x (the moving axis), move_speed and move_animate -- its own Y axis is never
// written (a horizontal Move never calls move_set_y) and its Y read only feeds the collision
// PROBE, whose row happens to be open on both the mover's and the decoy's own y, so a live-
// talk_ent move_get_y (or move_set_y) passed that test outright. These two close that gap.
// ==========================================================================

test('a vertical MOVE_SELF Move keeps its own captured mv_ent slot for the Y getter and setter, even if talk_ent is reassigned mid-flight', boots, async () => {
  const project = createStreamedProject({
    moveCommands: [{ op: 'move', who: 'self', dir: 'down', dist: 30 }],
    moveX: 120,
    moveY: 40
  });
  project.sprites.actors[project.sprites.actors.length - 1].speed = 1;
  const entity = project.maps[0].screens[0].entities.find((e) => e.props?.event);
  entity.props.trigger = 'enter';
  // A decoy with a different y and no event of its own -- talk_ent is forced to name it mid-Move.
  const decoyId = project.sprites.actors.length;
  project.sprites.actors.push({ name: 'Decoy', behavior: 'npc', hp: 1, damage: 0 });
  project.maps[0].screens[0].entities.push({ actorId: decoyId, x: 96, y: 200, props: {} });
  const { nes, mem } = await buildAndBoot(project);

  let frames = 0;
  while (mem[MV_LEFT] === 0 && frames < 60) { nes.frame(); frames++; }
  assert.ok(mem[MV_LEFT] > 0, 'the Move must be in flight before the sabotage RAM write lands');
  const moverSlot = mem[MV_ENT];
  const decoySlot = 1 - moverSlot;
  const decoyXBefore = mem[ENT_X + decoySlot];
  const decoyYBefore = mem[ENT_Y + decoySlot];
  assert.equal(decoyYBefore, 200, 'the decoy must still be at its own untouched starting y');

  mem[TALK_ENT] = decoySlot;

  frames = 0;
  while (mem[MV_LEFT] !== 0 && frames < 60) {
    nes.frame();
    frames++;
    assert.equal(mem[ENT_X + decoySlot], decoyXBefore, "the sabotaged decoy's own x must never move");
    assert.equal(mem[ENT_Y + decoySlot], decoyYBefore, "the sabotaged decoy's own y must never move -- a live-talk_ent move_set_y would write the mover's own advance into its slot instead");
  }
  assert.equal(mem[MV_LEFT], 0, 'the Move must still end');
  assert.equal(mem[ENT_Y + moverSlot], 40 + 30, "mv_ent must keep the original entity as the mover: a live-talk_ent move_get_y would read the decoy's own y (200) instead of the mover's, missing this predicted endpoint");
  assert.equal(mem[ENT_X + moverSlot], 120, "the mover's own x must be untouched by a vertical Move");
});

test("a horizontal MOVE_SELF Move probes its OWN y, not a reassigned talk_ent's, when the two rows disagree on collision", boots, async () => {
  const project = createStreamedProject({
    moveCommands: [{ op: 'move', who: 'self', dir: 'right', dist: 20 }],
    moveX: 32,
    moveY: 112 // probe row: (112+BODY_B(15))=127, 127>>4 = metatile row 7
  });
  project.sprites.actors[project.sprites.actors.length - 1].speed = 1;
  const entity = project.maps[0].screens[0].entities.find((e) => e.props?.event);
  entity.props.trigger = 'enter';
  const decoyId = project.sprites.actors.length;
  project.sprites.actors.push({ name: 'Decoy', behavior: 'npc', hp: 1, damage: 0 });
  // probe row: (200+15)=215, 215>>4 = metatile row 13 -- different from the mover's own row 7.
  project.maps[0].screens[0].entities.push({ actorId: decoyId, x: 96, y: 200, props: {} });
  paintSolid(project, 0, 10, rowOffsets(13)); // the decoy's own probe row: solid; row 7 stays open
  const { nes, mem } = await buildAndBoot(project);

  let frames = 0;
  while (mem[MV_LEFT] === 0 && frames < 60) { nes.frame(); frames++; }
  assert.ok(mem[MV_LEFT] > 0, 'the Move must be in flight before the sabotage RAM write lands');
  const moverSlot = mem[MV_ENT];
  const decoySlot = 1 - moverSlot;
  mem[TALK_ENT] = decoySlot;

  assert.ok(settleMove(nes), 'the Move must still end');
  assert.equal(mem[ENT_X + moverSlot], 32 + 20, "the mover's own probe row (7) is open -- a live-talk_ent move_get_y would probe the decoy's own row (13, painted solid) and block the very first tick instead");
});
