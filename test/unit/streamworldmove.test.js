// Large streamed worlds (ROADMAP item 15), phase 2 slice 4b: the movement driver -- continuous
// crossing. Covers engine/streamworld.asm's new sw_update_player/sw_frame_camera_window/
// sw_win_arm/sw_knockback_step and engine/player.asm's cross_left/right/up/down real crossing.
//
// Every expectation below is computed from the documented per-frame algorithm (the accumulator's
// own 8-bit-carry cadence, the axis-arbitration rule, the camera clamp formula), not merely
// checked against a final position -- a wrong implementation that reads the wrong axis, never
// switches axes, or publishes the wrong camera byte must produce a value this file can tell apart
// from correct, the same discipline test/unit/streamedmove.test.js's own header describes.
//
// Addresses below are transcribed by hand from the named engine file, per CLAUDE.md's own rule
// that a test reading the file it is checking proves nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import NES from '../../renderer/emulator/core/nes.js';
import { actionDetail } from '../../renderer/forges/controller/controller.js';
import { createProject } from '../../shared/project.js';
import { callRoutine } from '../lib/callroutine.js';
import { watchPositionJumpGuard } from '../lib/pjgguard.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
// Fix round 1 (phase 2 slice 5): the retained negative-control test reads the real
// engine/streamworld.asm off disk (never edits it) to build a scratch project.code override --
// same ROOT-from-import.meta.url convention test/unit/bankedbytes.test.js's own ROOT constant uses.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// from engine/constants.asm
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const GAME_STATE = 0x25;
const KB_TIMER = 0x50;
const KB_DIR = 0x51;
// Phase 2 slice 5 -- engine/constants.asm:1337-1338 (the two bytes right after sw_fc_desrl,
// $078C-$078D). Not zero page: absolute addressing, no `<` prefix.
const SW_KB_TIMER = 0x078c;
const SW_KB_ACC = 0x078d;
const PLAYER_DIR = 0x12; // engine/constants.asm:25
const MAX_ENTITIES = 8; // engine/constants.asm:692 -- knockback_dir's own floor-hit branch (X >= this)
const KNOCKBACK_TIME_CONST = 8; // engine/constants.asm:1333 -- the ordinary (non-streamed) knockback's own frame count, unchanged by this slice
const DASH_ON = 0x28;
const PAD = 0x17;
const MAP_IS_STREAMED = 0xfe;
const SW_AXIS_PREF = 0xc7;
const SW_EVENT_FREEZE = 0xfd;
const SW_COL = 0x5a0;
const SW_ROW = 0x5a1;
const WIN_COL_SCREEN = 0x5b1;
const WIN_COL_LOCAL = 0x5b2;
const WIN_ROW_SCREEN = 0x5b3;
const WIN_ROW_LOCAL = 0x5b4;
const ST_ACTIVE = 0x5b5;
const ST_CUR = 0x5b6;
const ST_LEN = 0x5b7;
const CAM_X_LO = 0xaf; // test/unit/camera.test.js's own transcription, cam_x_lo = bt_walk_step+1
const CAM_Y_LO = 0xb0;
const CAM_NT = 0xb1;
// sw_cam_origin_x/y_lo/hi -- engine/constants.asm:679-682. Fix round 1, finding 2/ruling F: the
// continuous world-space camera origin sw_frame_camera_window now publishes every frame, the same
// symbols test/unit/streamworldprojection.test.js already reads (there, only ever hand-poked; here,
// read back after a real driven walk).
const SW_CAM_ORIGIN_X_LO = 0x035c;
const SW_CAM_ORIGIN_X_HI = 0x035d;
const SW_CAM_ORIGIN_Y_LO = 0x035e;
const SW_CAM_ORIGIN_Y_HI = 0x035f;
// sw_ss_sc/lc/sr/lr -- engine/constants.asm:1032-1035. sw_stream_start_col/row's own saved
// entering-edge (screen,local) argument: the FAR (leading) edge on an increment arm, the near
// (current) edge on a decrement arm (sw_win_arm_col_inc calls sw_win_entering_col_right first;
// sw_win_arm_col_dec passes win_col_screen/local straight through -- engine/streamworld.asm:
// 3146-3193). Round-1 gate-closure-fix-1 finding 2/ruling R2: the physical fixed strip coordinate
// makeContainmentChecker's own first-observation fallback now reads directly, instead of guessing
// direction from predictDesiredWindow/pairLess.
const SW_SS_SC = 0x05dc;
const SW_SS_LC = 0x05dd;
const SW_SS_SR = 0x05de;
const SW_SS_LR = 0x05df;
const OAM = 0x0200; // engine/oam.asm's shadow OAM -- the player's own TL corner is OAM+0 (Y), OAM+3 (X)
const FLAT_SCREEN = 0x16; // engine/constants.asm:29
const ENT_ACTIVE = 0x0300; // engine/constants.asm:706, @size=MAX_ENTITIES
const ENT_ACTOR = 0x0308; // engine/constants.asm:707, @size=MAX_ENTITIES
const ENT_X = 0x0310; // engine/constants.asm:708, @size=MAX_ENTITIES
const ENT_Y = 0x0318; // engine/constants.asm:709, @size=MAX_ENTITIES
// Round 2 fix, finding 1: entity_touching_player's own overlap box (engine/entities.asm:559-584) --
// touching means |dx| < TOUCH_RANGE AND |dy| < TOUCH_RANGE, the same box entity_contact itself gates
// a real hit on.
const TOUCH_RANGE = 12; // engine/constants.asm:1245
const ST_GAMEPLAY = 0;
const ST_DIALOG = 2;
const MAX_X = 240;
const MAX_Y = 224;
const DIR_RIGHT = 3;
const PROBE_X = 0x08;
const PROBE_Y = 0x09;
const PLAYER_HP = 0x4e;
const PLAYER_IFRAMES = 0x4f;
const COL_DAMAGE = 3;
const SW_WALK_ACC_X = 0x03d8; // engine/constants.asm:759
const SW_WALK_ACC_Y = 0x03d9; // engine/constants.asm:760
const COL_OPEN = 0;
const ANIM_FRAME = 0x13; // engine/constants.asm:26
const ANIM_TIMER = 0x14; // engine/constants.asm:27
const MOVING = 0x15; // engine/constants.asm:28
const SCREEN_FRESH = 0x7d; // engine/constants.asm:91
const ANIM_RATE = 8; // engine/constants.asm:1645
const PAUSED = 0x26; // engine/constants.asm:52 -- "a pause freezes the world, not the screen" (engine/boot.asm)
const VRAM_LEN = 0x3c;
const VRAM_READY = 0x3f;

// from engine/streamworld.asm
const SW_SPEED_SUB_X = 128;
const SW_SPEED_SUB_Y = 112;
const SW_STREAM_CHUNK = 3;
// Phase 2 slice 5's own accepted-hypothesis knockback pacing -- 16 frames at an average
// 1.5px/frame, one shared rate for both axes (engine/streamworld.asm:53, engine/constants.asm's
// own SW_KB_TIME).
const SW_KB_SPEED_SUB = 128;
const SW_KB_TIME = 16;

// from renderer/emulator/core/controller.js. Default gameplay bindings (shared/project.js:4280)
// map B, not A, to the 'interact' action -- A is 'attack'.
const B = 1;
const UP = 4;
const DOWN = 5;
const LEFT = 6;
const RIGHT = 7;

// engine/constants.asm:1633-1636 -- DIR_DOWN=0, DIR_UP=1, DIR_LEFT=2, DIR_RIGHT=3 (defined below).
const DIR_DOWN = 0;
const DIR_UP = 1;
const DIR_LEFT = 2;

/** engine/streamworld.asm sw_walk_step_x/y's own documented shape: acc += sub (8-bit wrap), step
 * is 2 on carry-out, 1 otherwise. */
function walkStep(acc, sub) {
  const sum = acc + sub;
  return { step: sum >= 256 ? 2 : 1, acc: sum & 0xff };
}

function simulateWalk(sub, frames) {
  const trace = [];
  let acc = 0;
  for (let i = 0; i < frames; i++) {
    const { step, acc: next } = walkStep(acc, sub);
    trace.push(step);
    acc = next;
  }
  return trace;
}

// Plan test 7 (deferred from slice 4a per ruling 1, discharged here): a literal step/position/arm
// trace at a direction reversal and at a screen crossing, independently computed against
// engine/streamworld.asm's own documented per-frame formulas (sw_frame_camera_window/sw_win_arm's
// own header comments spell out the camera clamp and desired-window-origin math in prose, not just
// asm -- transcribed from that prose here, not from reading the routine's own instructions).
//
// sw_clamp_col/sw_clamp_row (engine/streamworld.asm): max legal screen is gridSize-2; a desired
// screen past that, or exactly at it with a nonzero local offset, clamps to (gridSize-2, 0).
function clampWindowAxis(desiredScreen, desiredLocal, gridSize) {
  const maxScreen = gridSize - 2;
  if (desiredScreen > maxScreen || (desiredScreen === maxScreen && desiredLocal !== 0)) {
    return { screen: maxScreen, local: 0 };
  }
  return { screen: desiredScreen, local: desiredLocal };
}

// sw_frame_camera_window's own header: worldX = sw_col*256+player_x, worldY = sw_row*240+player_y;
// camPx = clamp(worldX-120, 0, (gridW-1)*256), camPy = clamp(worldY-112, 0, (gridH-1)*240);
// desired window X: camBlockX = camPx>>4, desiredBlockX = max(camBlockX-8, 0), split by divmod 16
// then clamped; desired window Y: camBlockY = floor(camPy/240)*15 + ((camPy%240)>>4), desiredBlockY
// = max(camBlockY-7, 0), split by divmod 15 then clamped.
function predictDesiredWindow({ swCol, swRow, playerX, playerY, gridW, gridH }) {
  const worldX = swCol * 256 + playerX;
  const worldY = swRow * 240 + playerY;
  const camPx = Math.min(Math.max(worldX - 120, 0), (gridW - 1) * 256);
  const camPy = Math.min(Math.max(worldY - 112, 0), (gridH - 1) * 240);
  const camScreenRow = Math.floor(camPy / 240);
  const camLocalPxY = camPy % 240;
  const desiredBlockX = Math.max(Math.floor(camPx / 16) - 8, 0);
  const col = clampWindowAxis(Math.floor(desiredBlockX / 16), desiredBlockX % 16, gridW);
  const camBlockY = camScreenRow * 15 + Math.floor(camLocalPxY / 16);
  const desiredBlockY = Math.max(camBlockY - 7, 0);
  const row = clampWindowAxis(Math.floor(desiredBlockY / 15), desiredBlockY % 15, gridH);
  // camPx/camPy also returned (additive -- every existing caller destructures only the desCol/
  // desColLocal/desRow/desRowLocal fields it already used) so the "landing" tests below can assert
  // the published sw_cam_origin_x/y against the identical clamp formula without a second copy of it.
  return { desCol: col.screen, desColLocal: col.local, desRow: row.screen, desRowLocal: row.local, camPx, camPy };
}

// sw_win_col_inc/dec, sw_win_row_inc/dec: step "current" by exactly one block, wrapping local mod
// 16 (col) or mod 15 (row) with a carry into screen.
function stepWinAxis(screen, local, inc, localWrap) {
  if (inc) {
    local += 1;
    if (local === localWrap) return { screen: screen + 1, local: 0 };
    return { screen, local };
  }
  if (local === 0) return { screen: screen - 1, local: localWrap - 1 };
  return { screen, local: local - 1 };
}

// pair-order compare (screen first, then local), the same order sw_win_arm's own cmp/bcc sequence
// uses.
function pairLess(screenA, localA, screenB, localB) {
  if (screenA !== screenB) return screenA < screenB;
  return localA < localB;
}

// sw_win_arm: col is tried first, then row -- but a row step is only attempted if col did NOT just
// arm this same frame (both share the single st_active gate, and col's own branch runs first).
// stActiveIn is the value as read at the end of the PREVIOUS frame (before this frame's own NMI
// drain has had a chance to run) -- the same value sw_win_arm itself reads, since it runs from
// mainline before this frame's vblank/NMI. Returns the new "current" origin and, if this frame
// armed a strip, which axis and what st_active becomes (1=col, 2=row) -- engine/streamworld.asm's
// own sw_stream_start_col/row.
function predictWinArmStep(state) {
  const { desCol, desColLocal, desRow, desRowLocal } = predictDesiredWindow(state);
  let { winColScreen, winColLocal, winRowScreen, winRowLocal } = state;
  let stActive = state.stActiveIn;
  let armed = null;
  const colEqual = winColScreen === desCol && winColLocal === desColLocal;
  if (!colEqual && stActive === 0) {
    const inc = pairLess(winColScreen, winColLocal, desCol, desColLocal);
    ({ screen: winColScreen, local: winColLocal } = stepWinAxis(winColScreen, winColLocal, inc, 16));
    stActive = 1;
    armed = 'col';
  }
  const rowEqual = winRowScreen === desRow && winRowLocal === desRowLocal;
  if (!rowEqual && stActive === 0) {
    const inc = pairLess(winRowScreen, winRowLocal, desRow, desRowLocal);
    ({ screen: winRowScreen, local: winRowLocal } = stepWinAxis(winRowScreen, winRowLocal, inc, 15));
    stActive = 2;
    armed = 'row';
  }
  return { winColScreen, winColLocal, winRowScreen, winRowLocal, stActive, armed };
}

// Round-3 finding 3: real geometric containment, contract §5 ("The valid-content invariant is now
// checked as real geometric containment... The corrected check computes two real rectangles every
// frame and asserts the first is a subset of the second, both axes, both sides"). Computed
// independently from the design's own two formulas -- NOT from predictDesiredWindow/
// predictWinArmStep above (those model the ARM decision; this models what is actually SAFE to
// show), and never reading anything the sabotage below could freeze without this check noticing:
//
//   1. The visible block rectangle (§5 item 1): camPx = clamp(worldX-120, 0, mapPxW-256), and
//      symmetrically for Y (centre 112, viewport 240) -- the camera's own pixel-precise position,
//      not the block-granular window origin. Visible range [floor(camPx/16), floor((camPx+
//      viewportPx-1)/16)] -- real division, so a fine-scroll partial edge is included by
//      construction.
//   2. The completed-content rectangle (§5 item 2): from the window's own persistent "current"
//      (win_col_screen/local, win_row_screen/local -- read from real engine RAM, flattened to a
//      block index the same way worldX/Y flattens swCol/playerX: screen*blocksPerScreen+local,
//      16 blocks/screen on X, 15 on Y -- stepWinAxis's own localWrap values above), window width
//      32 blocks (X) / 30 blocks (Y) (design ~1100-1109's own "32-block window"/"30-block
//      window"). While st_active names THIS axis as in flight (1=col, 2=row -- sw_win_arm's own
//      header comment, engine/streamworld.asm), the entering edge is excluded: high edge if the
//      window's own current just moved in the positive direction on that axis, low edge if
//      negative -- direction is read off two consecutive real "current" samples (the frame
//      current itself changes IS the frame it armed, per sw_win_arm's own "current moves... and a
//      fresh strip is armed" -- design ~1064-1066), never assumed from which direction the test
//      is currently holding.
//
// A build that disables all arming (the round-3 reviewer's own `rts` at sw_win_arm entry) freezes
// the completed-content rectangle at its landing position forever while the visible rectangle
// keeps sliding with the player -- this check catches that the first frame the visible rectangle
// would need a block the frozen window never reaches. A build that races the window ahead of what
// has actually been drawn (this session's own sabotage: engine/streamworld.asm's window-margin
// literal `sbc #8`, sw_frame_camera_window's own X-behind-margin constant, patched to `sbc #0`)
// removes the design's own 8-block behind buffer entirely, so ordinary held movement runs the
// visible rectangle's low edge past the completed rectangle's low edge (mid-drain, where the
// entering-edge exclusion shaves the remaining margin to nothing) -- see the gates report's own
// sabotage table for both runs.
function makeContainmentChecker(mem, { gridW, gridH }) {
  const mapPxW = gridW * 256;
  const mapPxH = gridH * 240;
  const winBlocksX = 32; // design ~1100-1109
  const winBlocksY = 30;
  let prevColBlock = null;
  let prevRowBlock = null;
  let colArmDir = null; // sign of "current"'s own last real observed motion on this axis (+1/-1)
  let rowArmDir = null;
  return function assertContained(label) {
    const swCol = mem[SW_COL];
    const swRow = mem[SW_ROW];
    const playerX = mem[PLAYER_X];
    const playerY = mem[PLAYER_Y];
    // Read the REAL published camera origin (sw_cam_origin_x/y_lo/hi -- the brief's own "camera
    // origin", ruling F's continuous per-frame publish) rather than recomputing the idealized
    // clamp(worldPos-centre,...) formula from raw player position. The two coincide during
    // ordinary steady-state movement, but a legitimate publication hold -- boot's own landing
    // settle, or the position-jump guard's forced-blank resync (design ~1532, "suppresses
    // camera/OAM publication for this frame and every frame until the resync") -- deliberately
    // holds the published origin back until it is safe, and the idealized formula does not know
    // that. Checking what is truly SHOWN (the publish) against what is truly STREAMED (the
    // window) is also the actual safety property; deriving an idealized target the engine hasn't
    // promised to have reached yet on this exact frame produced two false failures at the very
    // first frame of a boot landed close to a grid edge (colBlock 9, desired-formula visLoX 8, no
    // real content ever missing on screen -- the publish itself was still correctly held at the
    // landing-safe value; only this checker's own oracle was reading the wrong signal).
    //
    // Round-1 gate-closure-fix-1 finding 1/ruling R2: RAW, unclamped -- round-1's own review
    // executed this exact helper in isolation (grid 3x2, window X [16,47], idle strip, published
    // X=65535) and found it PASSED, because the old code below clamped 65535 down to 512 (the map's
    // own legal ceiling) before ever comparing it against the completed-content rectangle,
    // silently repairing exactly the invalid publication this invariant exists to reject. The
    // publication-bounds check right below is now a SEPARATE, additional assertion with its own
    // failure text -- never a clamp applied before containment.
    const camPx = (mem[SW_CAM_ORIGIN_X_HI] << 8) | mem[SW_CAM_ORIGIN_X_LO];
    const camPy = (mem[SW_CAM_ORIGIN_Y_HI] << 8) | mem[SW_CAM_ORIGIN_Y_LO];
    const maxCamPx = Math.max(mapPxW - 256, 0);
    const maxCamPy = Math.max(mapPxH - 240, 0);
    assert.ok(camPx >= 0 && camPx <= maxCamPx,
      `${label}: published camera X origin ${camPx} is outside its own publication bounds [0,${maxCamPx}]`);
    assert.ok(camPy >= 0 && camPy <= maxCamPy,
      `${label}: published camera Y origin ${camPy} is outside its own publication bounds [0,${maxCamPy}]`);
    const visLoX = Math.floor(camPx / 16);
    const visHiX = Math.floor((camPx + 255) / 16);
    const visLoY = Math.floor(camPy / 16);
    const visHiY = Math.floor((camPy + 239) / 16);

    const colScreen = mem[WIN_COL_SCREEN];
    const colLocal = mem[WIN_COL_LOCAL];
    const rowScreen = mem[WIN_ROW_SCREEN];
    const rowLocal = mem[WIN_ROW_LOCAL];
    const colBlock = colScreen * 16 + colLocal;
    const rowBlock = rowScreen * 15 + rowLocal;
    const stActive = mem[ST_ACTIVE];

    // A real observed transition always wins (robust across a reversal mid-drain: "current" only
    // moves at arm time, so the direction of that move IS the entering edge, and it stays latched
    // correctly for every later frame of the SAME drain even once the player has since reversed
    // and a fresh, opposite-direction demand is merely queued, not yet armed).
    if (prevColBlock !== null && colBlock !== prevColBlock) colArmDir = colBlock > prevColBlock ? 1 : -1;
    if (prevRowBlock !== null && rowBlock !== prevRowBlock) rowArmDir = rowBlock > prevRowBlock ? 1 : -1;
    // No transition observed yet (this checker's very first call, mid-arm already at construction
    // time -- a real, expected shape: boot_streamed_landing's own initial placement need not equal
    // the per-frame desired formula, so the landing settle can already be mid-drain before this
    // trace's own input ever gets pressed). Round-1 gate-closure-fix-1 finding 2/ruling R2: derive
    // the entering edge from the REAL saved strip coordinates (sw_ss_sc/lc for a column strip,
    // sw_ss_sr/lr for a row strip -- the physical fixed strip coordinate sw_stream_start_col/row
    // itself saved at arm time, engine/streamworld.asm:3146-3193) rather than guessing from
    // predictDesiredWindow/pairLess's own comparison between "current" and a freshly-derived
    // "desired": that comparison classifies an ALREADY-REACHED positive arm (current == desired
    // after stepping exactly one block) as negative -- equal compares as "not less" -- which is
    // wrong whenever the arm was actually positive. The saved entering edge does not have this
    // failure mode: it is either the window's own current NEAR edge (a decrement arm) or exactly
    // FAR_EDGE = current + winBlocks-1 (an increment arm), unambiguous regardless of whether
    // current has since caught up to desired.
    if (stActive === 1 && colArmDir === null) {
      const enteringColBlock = mem[SW_SS_SC] * 16 + mem[SW_SS_LC];
      if (enteringColBlock === colBlock) colArmDir = -1;
      else if (enteringColBlock === colBlock + winBlocksX - 1) colArmDir = 1;
      else assert.fail(`${label}: sw_ss_sc/lc entering-edge block ${enteringColBlock} matched neither the near edge ${colBlock} nor the far edge ${colBlock + winBlocksX - 1} of the completed-content X window`);
    }
    if (stActive === 2 && rowArmDir === null) {
      const enteringRowBlock = mem[SW_SS_SR] * 15 + mem[SW_SS_LR];
      if (enteringRowBlock === rowBlock) rowArmDir = -1;
      else if (enteringRowBlock === rowBlock + winBlocksY - 1) rowArmDir = 1;
      else assert.fail(`${label}: sw_ss_sr/lr entering-edge block ${enteringRowBlock} matched neither the near edge ${rowBlock} nor the far edge ${rowBlock + winBlocksY - 1} of the completed-content Y window`);
    }

    let compLoX = colBlock;
    let compHiX = colBlock + winBlocksX - 1;
    if (stActive === 1) {
      if (colArmDir >= 0) compHiX -= 1;
      else compLoX += 1;
    }
    let compLoY = rowBlock;
    let compHiY = rowBlock + winBlocksY - 1;
    if (stActive === 2) {
      if (rowArmDir >= 0) compHiY -= 1;
      else compLoY += 1;
    }

    assert.ok(visLoX >= compLoX && visHiX <= compHiX,
      `${label}: visible X block range [${visLoX},${visHiX}] must be contained in the completed-content X range [${compLoX},${compHiX}] (win col block ${colBlock}, st_active=${stActive})`);
    assert.ok(visLoY >= compLoY && visHiY <= compHiY,
      `${label}: visible Y block range [${visLoY},${visHiY}] must be contained in the completed-content Y range [${compLoY},${compHiY}] (win row block ${rowBlock}, st_active=${stActive})`);

    prevColBlock = colBlock;
    prevRowBlock = rowBlock;
  };
}

// sw_pstep_right/left (engine/streamworld.asm), fix round 1, finding 3 (ruling C): held streamed
// movement crosses at the TRUE 256-pixel ownership boundary carrying the signed overshoot, never
// the ordinary engine's MAX_X cut-and-snap -- 256 is a power of two, so the 8-bit adc/sbc's own
// carry/borrow flag IS the crossing test, and the wrapped sum/difference IS the correct local x on
// the neighbour screen, with no further adjustment. UNLESS the target screen is off-grid, in which
// case the whole move is refused and player_x is left completely untouched (sw_pstep_right/left's
// own "clamp edges" guard, a bare rts before player_x is ever written) -- ruling C: grid edges stay
// walls, the physical ring's torus is not permission to wrap the authored map.
function predictHorizontalStep({ playerX, acc, swCol, gridW, dir }) {
  const { step, acc: nextAcc } = walkStep(acc, SW_SPEED_SUB_X);
  if (dir === 'right') {
    const raw = playerX + step;
    if (raw > 255) {
      if (swCol + 1 >= gridW) return { playerX, swCol, acc: nextAcc };
      return { playerX: raw - 256, swCol: swCol + 1, acc: nextAcc };
    }
    return { playerX: raw, swCol, acc: nextAcc };
  }
  const raw = playerX - step;
  if (raw < 0) {
    if (swCol === 0) return { playerX, swCol, acc: nextAcc };
    return { playerX: raw + 256, swCol: swCol - 1, acc: nextAcc };
  }
  return { playerX: raw, swCol, acc: nextAcc };
}

// sw_pstep_down/up's own mirror on the Y axis: 240 is NOT a power of two, so the crossing test is
// an explicit >=240 (down) / <0 (up, an 8-bit borrow already IS "<0" in two's-complement terms)
// compare rather than a hardware carry/borrow flag alone, and the neighbour-screen local y is the
// raw over/undershoot floored against 240, not 256 (sw_pd_calc_b's "-240" / sw_pu_calc_b's own
// "8-bit wrap, then -16" -- the 256-240=16 excess a plain 8-bit borrow leaves behind).
function predictVerticalStep({ playerY, acc, swRow, gridH, dir }) {
  const { step, acc: nextAcc } = walkStep(acc, SW_SPEED_SUB_Y);
  if (dir === 'down') {
    const raw = playerY + step;
    if (raw >= 240) {
      if (swRow + 1 >= gridH) return { playerY, swRow, acc: nextAcc };
      return { playerY: raw - 240, swRow: swRow + 1, acc: nextAcc };
    }
    return { playerY: raw, swRow, acc: nextAcc };
  }
  const raw = playerY - step;
  if (raw < 0) {
    if (swRow === 0) return { playerY, swRow, acc: nextAcc };
    return { playerY: raw + 240, swRow: swRow - 1, acc: nextAcc };
  }
  return { playerY: raw, swRow, acc: nextAcc };
}

// Phase 2 slice 5's own independent oracle: sw_kb_step_pixels' documented shape (identical to
// sw_walk_step_x/y's own WHOLE_STEP+overflow accumulator, engine/streamworld.asm, but SW_KB_SPEED_SUB
// on either axis, distinct sw_kb_acc state) composed with the same crossing math
// predictHorizontalStep/predictVerticalStep already use -- one function covering all four
// directions so a single call site can drive any of them from a shared trace loop.
function predictKnockbackStep({ playerX, playerY, acc, swCol, swRow, gridW, gridH, dir }) {
  const { step, acc: nextAcc } = walkStep(acc, SW_KB_SPEED_SUB);
  if (dir === 'right') {
    const raw = playerX + step;
    if (raw > 255) {
      if (swCol + 1 >= gridW) return { playerX, playerY, swCol, swRow, acc: nextAcc };
      return { playerX: raw - 256, playerY, swCol: swCol + 1, swRow, acc: nextAcc };
    }
    return { playerX: raw, playerY, swCol, swRow, acc: nextAcc };
  }
  if (dir === 'left') {
    const raw = playerX - step;
    if (raw < 0) {
      if (swCol === 0) return { playerX, playerY, swCol, swRow, acc: nextAcc };
      return { playerX: raw + 256, playerY, swCol: swCol - 1, swRow, acc: nextAcc };
    }
    return { playerX: raw, playerY, swCol, swRow, acc: nextAcc };
  }
  if (dir === 'down') {
    const raw = playerY + step;
    if (raw >= 240) {
      if (swRow + 1 >= gridH) return { playerX, playerY, swCol, swRow, acc: nextAcc };
      return { playerX, playerY: raw - 240, swCol, swRow: swRow + 1, acc: nextAcc };
    }
    return { playerX, playerY: raw, swCol, swRow, acc: nextAcc };
  }
  // dir === 'up'
  const raw = playerY - step;
  if (raw < 0) {
    if (swRow === 0) return { playerX, playerY, swCol, swRow, acc: nextAcc };
    return { playerX, playerY: raw + 240, swCol, swRow: swRow - 1, acc: nextAcc };
  }
  return { playerX, playerY: raw, swCol, swRow, acc: nextAcc };
}

async function buildAndBoot(project, { requireStreamed = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworldmove-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const bytes = new Uint8Array(fs.readFileSync(built.romPath));
    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(bytes);
    const mem = nes.cpu.mem;
    const symbols = fs.readFileSync(built.symbolPath, 'utf8');
    // Fix round 3, finding 2: watch from before cold boot even starts, so a caller that goes on
    // to drive an ordinary sustained-movement/containment/camera workload can call
    // guard.assertNone(...) over its OWN driven span too, not only the boot settle -- the helper
    // installs the watcher, the caller (which alone knows whether its own workload is meant to be
    // ordinary or a deliberate over-budget negative control) decides whether/when to assert.
    const guard = watchPositionJumpGuard(nes, symbols);
    let frames = 0;
    while ((mem[GAME_STATE] !== ST_GAMEPLAY || (requireStreamed && mem[MAP_IS_STREAMED] !== 1)) && frames < 200) {
      nes.frame();
      frames++;
    }
    assert.ok(frames < 200, 'cold boot must reach ST_GAMEPLAY well within 200 frames');
    // game_state/map_is_streamed are set early in the landing sequence, well before
    // sw_render_window's own full-window forced-blank draw actually finishes (the same
    // "flat_screen is already the new value well before the draw completes" property
    // test/unit/streamedmixed.test.js's own runUntilFlatScreenChanges documents) -- a real
    // cold-boot render on this project's exact grid was measured (scratchpad probe) to take
    // ~38 nes.frame() calls; 100 is a generous, deterministic margin past that, cheap next to
    // the hundreds of settle frames other passing tests already spend.
    for (let i = 0; i < 100; i++) nes.frame();
    return { nes, mem, symbols, guard };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Phase 2 slice "landing" fix round 1, finding 1: identical shape to buildAndBoot's own cold-boot
// poll, except it also observes the landing's own REAL first displayed frame -- the actual $2001
// write that turns rendering on (bits $18) while map_is_streamed is already 1 -- via a write hook
// on the emulator's own memory-mapper, synchronously, before ANY later frame's own main-loop code
// (including ordinary per-frame camera tracking) can run and repair a wrong initial publication.
// game_state/map_is_streamed reaching ST_GAMEPLAY/1 (buildAndBoot's own poll condition) happens
// well BEFORE this -- sw_render_window's own full-window forced-blank draw is still running -- so
// the loop below polls for the real enable, not that state. Returns full RAM snapshots
// (mem.slice(), plain data -- the emulator itself keeps running underneath) taken at that exact
// write (firstEnableMem) and after exactly one more nes.frame() (afterFirstTrackingMem -- the
// first ordinary per-frame tracking call following the landing), plus the live nes/mem (already a
// further 99 frames settled, for the same additional stability checks buildAndBoot's own 100-frame
// margin used to gate everything on).
async function buildAndBootLanding(project) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworldmove-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const bytes = new Uint8Array(fs.readFileSync(built.romPath));
    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(bytes);
    const mem = nes.cpu.mem;
    // Round 2 finding A5: watch the whole landing (not just a settled-afterward workload) --
    // installing the tracking window at a fresh landing must never itself need the guard's rescue.
    const guard = watchPositionJumpGuard(nes, fs.readFileSync(built.symbolPath, 'utf8'));
    let firstEnableMem = null;
    // Fix round 2 (review round 2 finding (a)): the rendered PPU content -- nametable tiles and
    // attribute bytes -- is not on `mem` at all (it lives on `nes.ppu`, separate emulated address
    // space); a snapshot must be taken synchronously in this SAME write hook, at the SAME instant as
    // firstEnableMem, or a later frame's own tracking/redraw could have already changed it by the
    // time a caller reads `nes.ppu` back out. `.slice()` on each nametable's own `tile`/`attrib`
    // Uint8Array copies the data out, same reasoning as `mem.slice()` above.
    let firstEnablePPU = null;
    const originalWrite = nes.mmap.write.bind(nes.mmap);
    let previousMask = 0;
    nes.mmap.write = (address, value) => {
      if (address === 0x2001) {
        if ((value & 0x18) && !(previousMask & 0x18) && mem[MAP_IS_STREAMED] === 1 && !firstEnableMem) {
          firstEnableMem = mem.slice();
          firstEnablePPU = nes.ppu.nameTable.map((nt) => ({ tile: nt.tile.slice(), attrib: nt.attrib.slice() }));
        }
        previousMask = value;
      }
      return originalWrite(address, value);
    };
    let frames = 0;
    while (!firstEnableMem && frames < 400) {
      nes.frame();
      frames++;
    }
    assert.ok(firstEnableMem, 'the landing must reach its own real $2001 display-enable write (rendering turned on while streamed) within 400 frames');
    nes.frame(); // the first ordinary per-frame tracking call after the landing's own display enable
    const afterFirstTrackingMem = mem.slice();
    for (let i = 0; i < 99; i++) nes.frame();
    guard.assertNone('streamed landing (boot or door), through settle');
    guard.unwatch();
    const symbols = fs.readFileSync(built.symbolPath, 'utf8');
    return { nes, mem, firstEnableMem, firstEnablePPU, afterFirstTrackingMem, symbols };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('streamworldmove', { skip: !hasNesasm && 'nesasm not on PATH' }, async (t) => {
  await t.test('X accumulator: held Right steps player_x by the documented 1,2,1,2... cadence', async () => {
    const project = createStreamedProject({});
    const { nes, mem, guard } = await buildAndBoot(project);
    const trace = simulateWalk(SW_SPEED_SUB_X, 6);
    let expected = mem[PLAYER_X];
    nes.buttonDown(1, RIGHT);
    for (const step of trace) {
      nes.frame();
      expected += step;
      assert.equal(mem[PLAYER_X], expected, `player_x after this tick`);
    }
    nes.buttonUp(1, RIGHT);
    guard.assertNone('X accumulator, ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('Y accumulator: held Down steps player_y by the documented 1,2,1,2... cadence', async () => {
    const project = createStreamedProject({});
    const { nes, mem, guard } = await buildAndBoot(project);
    const trace = simulateWalk(SW_SPEED_SUB_Y, 6);
    let expected = mem[PLAYER_Y];
    nes.buttonDown(1, DOWN);
    for (const step of trace) {
      nes.frame();
      expected += step;
      assert.equal(mem[PLAYER_Y], expected, `player_y after this tick`);
    }
    nes.buttonUp(1, DOWN);
    guard.assertNone('Y accumulator, ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('dash is genuinely ignored: cadence is unchanged while dash_on is forced set', async () => {
    const project = createStreamedProject({});
    const { nes, mem, guard } = await buildAndBoot(project);
    const trace = simulateWalk(SW_SPEED_SUB_X, 6);
    let expected = mem[PLAYER_X];
    nes.buttonDown(1, RIGHT);
    for (const step of trace) {
      mem[DASH_ON] = 1; // forced every frame -- a real dash binding would set this identically
      nes.frame();
      expected += step;
      assert.equal(mem[PLAYER_X], expected, 'dash_on must not change the per-frame step');
    }
    nes.buttonUp(1, RIGHT);
    guard.assertNone('dash-ignored, ordinary design-rate workload');
    guard.unwatch();
  });

  // Fix round 1, finding 7: the streamed driver used to return without ever running the ordinary
  // movement animation bookkeeping (engine/player.asm:70-98's update_player_anim tail) -- moving
  // was set by sw_pstep_*'s own `inc <moving>`, but anim_timer never advanced and anim_frame never
  // toggled. sw_update_player now runs the identical shape at its own tail (engine/streamworld.asm
  // sw_up_hazard.. sw_up_camera). Each assertion below is checked every single frame against the
  // exact documented algorithm (inc timer; at ANIM_RATE, reset and toggle), not just a final value.
  await t.test('walk animation: moving on a streamed map advances anim_timer/toggles anim_frame at the ordinary ANIM_RATE cadence', async () => {
    const project = createStreamedProject({});
    const { nes, mem, guard } = await buildAndBoot(project);
    nes.buttonDown(1, RIGHT);
    let expectedTimer = 0;
    let expectedFrame = 0;
    for (let i = 0; i < 40; i++) {
      nes.frame();
      assert.equal(mem[MOVING], 1, `frame ${i}: moving must be set while a held direction is actually stepping`);
      expectedTimer += 1;
      if (expectedTimer === ANIM_RATE) {
        expectedTimer = 0;
        expectedFrame ^= 1;
      }
      assert.equal(mem[ANIM_TIMER], expectedTimer, `frame ${i}: anim_timer must advance exactly like update_player_anim's own cadence`);
      assert.equal(mem[ANIM_FRAME], expectedFrame, `frame ${i}: anim_frame must toggle exactly on the ANIM_RATE-th frame`);
    }
    nes.buttonUp(1, RIGHT);
    guard.assertNone('walk animation advances, ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('walk animation: releasing input resets moving/anim_timer/anim_frame to 0 the following frame', async () => {
    const project = createStreamedProject({});
    const { nes, mem, guard } = await buildAndBoot(project);
    nes.buttonDown(1, RIGHT);
    for (let i = 0; i < 10; i++) nes.frame();
    assert.equal(mem[MOVING], 1, 'precondition: still moving after 10 held frames');
    nes.buttonUp(1, RIGHT);
    nes.frame();
    assert.equal(mem[MOVING], 0, 'moving must clear the frame after the button is released');
    assert.equal(mem[ANIM_TIMER], 0, 'anim_timer must reset to 0 on a released/standing frame, matching update_player_stand');
    assert.equal(mem[ANIM_FRAME], 0, 'anim_frame must reset to 0 on a released/standing frame, matching update_player_stand');
    guard.assertNone('walk animation release, ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('walk animation freezes on the crossing frame itself, exactly as the ordinary engine\'s own screen_fresh check in update_player_anim', async () => {
    const project = createStreamedProject({});
    project.project.startX = 235; // close to MAX_X -- crosses within a handful of frames
    const { nes, mem, guard } = await buildAndBoot(project);
    const startCol = mem[SW_COL];
    nes.buttonDown(1, RIGHT);
    let timerBefore = mem[ANIM_TIMER];
    let frameBefore = mem[ANIM_FRAME];
    let crossed = false;
    let resumed = false;
    for (let i = 0; i < 20 && !resumed; i++) {
      nes.frame();
      if (!crossed && mem[SW_COL] !== startCol) {
        crossed = true;
        assert.equal(mem[SCREEN_FRESH], 1, 'the crossing frame must set screen_fresh');
        assert.equal(mem[ANIM_TIMER], timerBefore, 'anim_timer must not advance on the crossing frame itself');
        assert.equal(mem[ANIM_FRAME], frameBefore, 'anim_frame must not toggle on the crossing frame itself');
        continue;
      }
      if (crossed) {
        resumed = true;
        assert.equal(mem[SCREEN_FRESH], 0, 'screen_fresh must clear the frame after a crossing');
        assert.equal(mem[ANIM_TIMER], timerBefore + 1, 'anim_timer must resume advancing the frame after the crossing');
        break;
      }
      timerBefore = mem[ANIM_TIMER];
      frameBefore = mem[ANIM_FRAME];
    }
    nes.buttonUp(1, RIGHT);
    assert.ok(crossed && resumed, 'must have crossed and then observed the resume frame within 20 frames');
    guard.assertNone('walk animation freeze on crossing, ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('axis arbitration: a fresh press on the other axis takes over mid-hold', async () => {
    const project = createStreamedProject({});
    const { nes, mem, guard } = await buildAndBoot(project);
    nes.buttonDown(1, LEFT);
    nes.frame();
    nes.frame();
    assert.equal(mem[SW_AXIS_PREF], 0, 'X owns the accumulator while only Left is held');
    const xAfterLeft = mem[PLAYER_X];
    nes.buttonDown(1, UP); // fresh press this frame, Left still held too
    nes.frame();
    assert.equal(mem[SW_AXIS_PREF], 1, 'a fresh Up press must take ownership from X');
    assert.equal(mem[PLAYER_X], xAfterLeft, 'player_x must not move on the frame Y takes over');
    const yAfterSwitch = mem[PLAYER_Y];
    nes.frame();
    assert.notEqual(mem[PLAYER_Y], yAfterSwitch, 'Y must now be the one moving');
    assert.equal(mem[PLAYER_X], xAfterLeft, 'player_x must stay put while Y owns the accumulator');
    nes.buttonUp(1, LEFT);
    nes.buttonUp(1, UP);
    guard.assertNone('axis arbitration (fresh press mid-hold), ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('axis arbitration: a simultaneous fresh press of both axes has X win the tie', async () => {
    const project = createStreamedProject({});
    const { nes, mem, guard } = await buildAndBoot(project);
    const yBefore = mem[PLAYER_Y];
    const xBefore = mem[PLAYER_X];
    nes.buttonDown(1, LEFT);
    nes.buttonDown(1, UP);
    nes.frame();
    assert.equal(mem[SW_AXIS_PREF], 0, 'X must win a simultaneous fresh press of both axes');
    assert.notEqual(mem[PLAYER_X], xBefore, 'X must be the axis that actually moved');
    assert.equal(mem[PLAYER_Y], yBefore, 'Y must not move on the tie-broken frame');
    nes.buttonUp(1, LEFT);
    nes.buttonUp(1, UP);
    guard.assertNone('axis arbitration (simultaneous tie), ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('crossing right: sw_col increments, player_x wraps to 0, the window keeps pace', async () => {
    const project = createStreamedProject({});
    project.project.startX = 235; // close to MAX_X=240 -- crosses within a handful of frames
    const { nes, mem, guard } = await buildAndBoot(project);
    const startCol = mem[SW_COL];
    nes.buttonDown(1, RIGHT);
    let crossed = false;
    for (let i = 0; i < 20 && !crossed; i++) {
      nes.frame();
      if (mem[SW_COL] !== startCol) crossed = true;
    }
    nes.buttonUp(1, RIGHT);
    assert.ok(crossed, 'sw_col must have incremented within 20 frames of holding Right from x=235');
    assert.equal(mem[SW_COL], startCol + 1, 'sw_col must advance by exactly one screen');
    assert.ok(mem[PLAYER_X] < MAX_X, 'player_x must have wrapped to the new screen\'s left edge, not kept climbing past MAX_X');
    guard.assertNone('crossing right, ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('camera publish: cam_x_lo/cam_nt match the documented clamp formula while walking, unclamped', async () => {
    const project = createStreamedProject({});
    const { nes, mem, guard } = await buildAndBoot(project);
    const startX = mem[PLAYER_X]; // 120 (createProject's own default) -- camPx = worldX-120 = 0 at rest
    const frames = 8;
    const trace = simulateWalk(SW_SPEED_SUB_X, frames);
    const cumulative = trace.reduce((a, b) => a + b, 0);
    assert.ok(startX + cumulative < 256, 'test picked a frame count that stays inside one screen');
    nes.buttonDown(1, RIGHT);
    for (let i = 0; i < frames; i++) nes.frame();
    nes.buttonUp(1, RIGHT);
    // worldX = sw_col*256+player_x = 0*256+(startX+cumulative); camPx = worldX-120 = cumulative
    // (not clamped -- grid is 3 screens wide, ceiling is (3-1)*256=512, well above cumulative).
    assert.equal(mem[CAM_X_LO], cumulative & 0xff, 'cam_x_lo must equal camPx\'s own low byte');
    assert.equal(mem[CAM_NT] & 1, (cumulative >> 8) & 1, 'cam_nt bit0 must equal camPx\'s own bit 8 (screenCol parity)');
    guard.assertNone('camera publish, ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('window arm: win_col_local tracks the player leaving the margin, st_active drains back to 0', async () => {
    const project = createStreamedProject({});
    const { nes, mem, guard } = await buildAndBoot(project);
    const startLocal = mem[WIN_COL_LOCAL];
    const startScreen = mem[WIN_COL_SCREEN];
    nes.buttonDown(1, RIGHT);
    // The window only steps once the camera's own desired block origin clears its 8-block
    // left margin (sw_frame_camera_window: desiredBlockX = camBlockX-8, floored at 0) -- from
    // the default start (player_x=120, camPx=0), that needs camPx>=144, i.e. roughly 144px of
    // walking at SW_SPEED_SUB_X's own ~1.5px/frame average (~96 frames minimum); 200 is a
    // generous margin past that, not a guess.
    let armed = false;
    for (let i = 0; i < 200 && !armed; i++) {
      nes.frame();
      if (mem[WIN_COL_LOCAL] !== startLocal || mem[WIN_COL_SCREEN] !== startScreen) armed = true;
    }
    assert.ok(armed, 'the window\'s own current origin must step at least once within 200 frames of continuous walking');
    // Give any in-flight strip time to drain (SW_STREAM_CHUNK per vblank, ~30 metatiles) before
    // asserting idle -- st_active must not be stuck non-zero indefinitely.
    for (let i = 0; i < 30 && mem[ST_ACTIVE] !== 0; i++) nes.frame();
    assert.equal(mem[ST_ACTIVE], 0, 'a strip armed by ordinary walking must finish draining, not corrupt/stall');
    nes.buttonUp(1, RIGHT);
    guard.assertNone('window arm, ordinary design-rate workload');
    guard.unwatch();
  });

  // Phase 2 slice 5's own accepted-hypothesis knockback pacing (16 frames at an average
  // 1.5px/frame, a distinct sw_kb_timer/sw_kb_acc accumulator) replaces slice 4b's interim
  // 8-frame/1px-flat sw_knockback_step -- see handoff-next/streamed-worlds-phase2-s5-report.md
  // for the decision-rule matrix. knockback_dir's own floor-hit branch (X >= MAX_ENTITIES) gives
  // kb_dir = player_dir XOR 1 ("bounce back the way you came") -- setting player_dir to the
  // INVERSE of the desired knockback direction before calling hurt_player is the only way to
  // choose kb_dir deterministically through the real gate, rather than poking kb_dir directly.
  const KB_DIR_INVERSE = { [DIR_DOWN]: DIR_UP, [DIR_UP]: DIR_DOWN, [DIR_LEFT]: DIR_RIGHT, [DIR_RIGHT]: DIR_LEFT };
  function triggerFloorHit(nes, mem, addrOf, dir, hearts = 1) {
    mem[PLAYER_DIR] = KB_DIR_INVERSE[dir];
    nes.cpu.REG_ACC = hearts;
    nes.cpu.REG_X = MAX_ENTITIES;
    callRoutine(nes, addrOf('hurt_player'));
  }

  // Fix round 1 (review-phase2-s5-round1-findings.md, findings 1-3): shared plumbing for the
  // augmented containment matrix, the Flash/strip/knockback co-occurrence gate and the real
  // end-to-end hit path below.
  const DIR_BUTTON = { right: RIGHT, left: LEFT, up: UP, down: DOWN };
  const DIR_CONST_BY_NAME = { right: DIR_RIGHT, left: DIR_LEFT, up: DIR_UP, down: DIR_DOWN };
  const DIR_NAME_BY_CONST = { [DIR_RIGHT]: 'right', [DIR_LEFT]: 'left', [DIR_UP]: 'up', [DIR_DOWN]: 'down' };
  const DIR_AXIS = { right: 1, left: 1, up: 2, down: 2 }; // ST_ACTIVE: 1=col, 2=row
  const DIR_INVERSE = { right: 'left', left: 'right', up: 'down', down: 'up' };

  // Holds a real direction until the engine itself arms a strip on the named axis (never a poke of
  // st_active) or gives up at maxFrames -- a genuine, frame-driven precondition, not a simulated one.
  function approachUntilAxis(nes, mem, dirName, targetAxis, maxFrames = 200) {
    const button = DIR_BUTTON[dirName];
    nes.buttonDown(1, button);
    let f = 0;
    while (mem[ST_ACTIVE] !== targetAxis && f++ < maxFrames) nes.frame();
    nes.buttonUp(1, button);
    return f;
  }

  // Per-section strip-state (idle/col/row) frame tallies, the same shape as the round-1 review's
  // own strip-summary.json -- written once at the very end of this whole test to
  // handoff-next/fix1-evidence/strip-summary.json so the fix report can quote real counts.
  const stripTally = {};
  function tallyStrip(section, mem) {
    const key = String(mem[ST_ACTIVE]);
    stripTally[section] = stripTally[section] || {};
    stripTally[section][key] = (stripTally[section][key] || 0) + 1;
  }
  function checkAndTally(assertContained, section, mem, label) {
    assertContained(label);
    tallyStrip(section, mem);
  }

  // Retained negative control (finding 1): a flat, faster-than-design per-frame knockback rate,
  // applied ONLY through a scratch project.code override -- the real engine/streamworld.asm on disk
  // is never touched, so `git diff --stat -- engine main shared` stays identical before and after
  // this file runs (this fix round's own scope is tests-only). The regex targets exactly
  // sw_kb_step_pixels' own documented body (engine/streamworld.asm:3293-3302).
  function fasterKnockbackOverride(project, rate) {
    const enginePath = path.join(ROOT, 'engine', 'streamworld.asm');
    const original = fs.readFileSync(enginePath, 'utf8');
    const patched = original.replace(
      /sw_kb_step_pixels:\n[\s\S]*?sw_kb_step_pixels_done:\n {2}rts/,
      `sw_kb_step_pixels:\n  lda #${rate}\n  rts`
    );
    assert.notEqual(patched, original, 'fasterKnockbackOverride: the regex must actually match sw_kb_step_pixels in the real engine file');
    project.code = { overrides: [{ name: 'streamworld.asm', text: patched }], files: [] };
  }

  // Retained negative control (round 2 finding 1): neutralizes BOTH real invulnerability gates --
  // hurt_player's own `ldy <player_iframes / bne hurt_player_done` (engine/combat.asm:203-204) and
  // entity_contact's own `lda <player_iframes / bne entity_contact_done` (engine/combat.asm:452-453)
  // -- applied ONLY through a scratch project.code override, the real engine/combat.asm on disk is
  // never touched. Mutating only one of the two gates leaves the other still blocking the real
  // reapproach contact below, so it would not discriminate this specific end-to-end test; both must
  // go together to prove this test can actually tell a broken invulnerability window apart from a
  // working one.
  function bothInvulnerabilityGatesOffOverride(project) {
    const enginePath = path.join(ROOT, 'engine', 'combat.asm');
    let text = fs.readFileSync(enginePath, 'utf8');
    for (const [load, label] of [['ldy', 'hurt_player_done'], ['lda', 'entity_contact_done']]) {
      const needle = `  ${load} <player_iframes\n  bne ${label}`;
      assert.ok(text.includes(needle), `bothInvulnerabilityGatesOffOverride: the ${label} gate text must actually be found in the real engine file`);
      text = text.replace(needle, `  ${load} <player_iframes\n  nop\n  nop`);
    }
    project.code = { overrides: [{ name: 'combat.asm', text }], files: [] };
  }

  test('phase 2 slice 5: streamed knockback (16 frames, 1.5px/frame average, distinct state)', { skip: !hasNesasm && 'nesasm not on PATH' }, async (t) => {
    // -------------------------------------------------- test 1: the gate itself
    await t.test('the streamed knockback gate fires on an all-streamed project and on a mixed one; the ordinary map in a mixed project keeps the ordinary 8-frame/3px gate', async () => {
      // Opt-out (fix round 4, item 3), all 3 sub-cases below: synthetic direct-call routine probes
      // (triggerFloorHit's own one-shot callRoutine dispatch into hurt_player), no further
      // nes.frame() loop -- buildAndBootWithSymbols's own returned guard is unused, per its header.
      // (a) all-streamed
      {
        const project = createStreamedProject({});
        const { dir, nes, mem, addrOf } = await buildAndBootWithSymbols(project);
        try {
          triggerFloorHit(nes, mem, addrOf, DIR_RIGHT);
          assert.equal(mem[SW_KB_TIMER], SW_KB_TIME, 'all-streamed: hurt_player must arm sw_kb_timer at SW_KB_TIME(16)');
          assert.equal(mem[SW_KB_ACC], 0, 'all-streamed: sw_kb_acc must start fresh at 0');
          assert.equal(mem[KB_TIMER], 0, 'all-streamed: the ordinary kb_timer must stay untouched (0)');
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
      // (b) mixed, landed directly on the streamed map (map index 1)
      {
        const project = createStreamedProject({ mixed: true });
        project.project.startMap = 1;
        project.project.startScreen = 0;
        const { dir, nes, mem, addrOf } = await buildAndBootWithSymbols(project);
        try {
          triggerFloorHit(nes, mem, addrOf, DIR_RIGHT);
          assert.equal(mem[SW_KB_TIMER], SW_KB_TIME, 'mixed, on the streamed map: hurt_player must arm sw_kb_timer');
          assert.equal(mem[KB_TIMER], 0, 'mixed, on the streamed map: the ordinary kb_timer must stay untouched');
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
      // (c) mixed, landed on the DEFAULT start -- the ordinary "Before" map (map index 0,
      // createStreamedProject's own default startMap)
      // Opt-out (fix round 4, item 3): a synthetic direct-call routine probe (triggerFloorHit's own
      // one-shot callRoutine dispatch) with no further nes.frame() loop, so no guard is installed.
      {
        const project = createStreamedProject({ mixed: true });
        const d = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworldmove-'));
        try {
          await saveProject(d, project);
          const built = await buildProject({ dir: d, project, log: () => {} });
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
          while (mem[GAME_STATE] !== ST_GAMEPLAY && frames < 200) {
            nes.frame();
            frames++;
          }
          assert.ok(frames < 200, 'cold boot must reach ST_GAMEPLAY well within 200 frames');
          // buildAndBoot/buildAndBootWithSymbols's own margin: game_state/map_is_streamed settle
          // well before the landing sequence (and any spawn-grace player_iframes) fully finishes.
          for (let i = 0; i < 100; i++) nes.frame();
          assert.equal(mem[MAP_IS_STREAMED], 0, 'precondition: the default mixed start must be the ordinary "Before" map');
          triggerFloorHit(nes, mem, addrOf, DIR_RIGHT);
          assert.equal(mem[KB_TIMER], KNOCKBACK_TIME_CONST, 'mixed, on the ordinary map: hurt_player must arm the ordinary kb_timer at KNOCKBACK_TIME(8)');
          assert.equal(mem[SW_KB_TIMER], 0, 'mixed, on the ordinary map: sw_kb_timer must stay untouched (0)');
        } finally {
          fs.rmSync(d, { recursive: true, force: true });
        }
      }
    });

    // -------------------------------------------------- tests 2/3: containment matrix --
    // all four directions, fractional starting phases, under the slower vertical strip
    // schedule as much as the horizontal one, driven straight from a RAM-poked sw_kb_timer/
    // sw_kb_acc/kb_dir (the same "poke the state a hit would have produced" convention slice
    // 4b's own interim test already used) rather than restaging a real hit each time.
    await t.test('containment (idle strip -- no approach): all four directions x four starting accumulator phases never expose undrawn terrain', async () => {
      const project = createStreamedProject({});
      const { gridW, gridH } = { gridW: 3, gridH: 2 };
      const directions = [
        ['up', DIR_UP],
        ['down', DIR_DOWN],
        ['left', DIR_LEFT],
        ['right', DIR_RIGHT]
      ];
      const phases = [0, 64, 128, 192];
      for (const [dirName, dirConst] of directions) {
        for (const phase of phases) {
          const { nes, mem, symbols } = await buildAndBoot(project);
          // Round 2 finding A5: the shared guard hook, wired directly into this ordinary
          // (design-rate) workload, not only into the dedicated "stays silent" duplicate test --
          // a real violation reached only through this matrix's own case shapes must be caught here.
          const guard = watchPositionJumpGuard(nes, symbols);
          const assertContained = makeContainmentChecker(mem, { gridW, gridH });
          checkAndTally(assertContained, 'idle-matrix', mem, `${dirName} phase ${phase}: landing`);
          mem[KB_DIR] = dirConst;
          mem[SW_KB_ACC] = phase;
          mem[SW_KB_TIMER] = SW_KB_TIME;
          for (let i = 0; i < SW_KB_TIME; i++) {
            nes.frame();
            checkAndTally(assertContained, 'idle-matrix', mem, `${dirName} phase ${phase}: knockback frame ${i}`);
          }
          assert.equal(mem[SW_KB_TIMER], 0, `${dirName} phase ${phase}: sw_kb_timer must have counted all the way down`);
          // Give the strip a further 20 frames to fully settle/drain after the burst ends --
          // containment must hold through the catch-up too, not just during the burst.
          for (let i = 0; i < 20; i++) {
            nes.frame();
            checkAndTally(assertContained, 'idle-matrix', mem, `${dirName} phase ${phase}: post-knockback settle frame ${i}`);
          }
          guard.assertNone(`idle-matrix ${dirName} phase ${phase}, ordinary design-rate workload`);
          guard.unwatch();
        }
      }
    });

    // -------------------------------------------------- fix round 1, finding 1: the matrix above
    // never actually had a strip in flight (st_active stayed 0 throughout the burst in every one of
    // its 16 cases -- the round-1 review's own defect). This augmented matrix drives a REAL approach
    // (held input, never a poke of st_active) until the engine itself arms a strip on a specific
    // axis, explicitly asserts st_active equals that axis at the hit frame (so a "precondition
    // removed" sabotage -- counting a burst that never actually had a strip in flight -- fails
    // loudly), and only then arms the knockback (phase still poked, the same convention every other
    // test in this file already uses for sw_kb_acc's own starting value -- only the strip's own arm
    // is real). Covers all 4 knockback directions against BOTH a column strip and a row strip in
    // flight: for a horizontal knockback (right/left) the same-axis strip is the column strip and
    // the orthogonal one is the row strip, and conversely for a vertical knockback (down/up) -- so
    // every direction exercises both strip axes across the whole matrix. The 4 accumulator phases
    // are split evenly across the same-axis sub-case: phases 0/128 reinforce the approach direction
    // (knockback continues the way the strip was armed), phases 64/192 REVERSE it (knockback bounces
    // back the way the player came, the strip still draining from the other direction) -- covering
    // "knockback that reverses the walking/approach direction" across phase classes rather than as
    // one single bolted-on extra case. A 5x5 grid (vs. the 3x2 grid above) is used so both a column
    // and a row strip can actually be put in flight from the same landing screen (12, the grid
    // centre) -- verified empirically (this fix round's own scratch probes) that holding any of the
    // 4 directions from that landing arms the matching-axis strip within at most 12 frames, well
    // inside the 200-frame bound below.
    await t.test('containment: all four directions x four starting phases, with a REAL column or row strip actually in flight', async () => {
      const gridW = 5, gridH = 5;
      const directions = ['right', 'left', 'down', 'up'];
      const phases = [0, 64, 128, 192];
      // Orthogonal approach direction for each knockback direction's OTHER axis -- validated
      // (scratch probes) to arm the opposite-axis strip within at most 12 frames from the default
      // (5x5, screen 12) landing: holding Right arms the column strip, holding Down arms the row
      // strip, from this exact landing.
      const ORTHOGONAL_APPROACH = { right: 'down', left: 'down', up: 'right', down: 'right' };
      for (const dirName of directions) {
        const dirConst = DIR_CONST_BY_NAME[dirName];
        const sameAxis = DIR_AXIS[dirName];
        const orthogonalAxis = sameAxis === 1 ? 2 : 1;
        for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex++) {
          const phase = phases[phaseIndex];
          const reversing = phaseIndex % 2 === 1;
          const approachDirName = reversing ? DIR_INVERSE[dirName] : dirName;

          // same-axis sub-case (reinforcing on phases 0/128, reversing on phases 64/192)
          {
            const project = createStreamedProject({ gridW, gridH });
            project.project.startScreen = 12;
            const { nes, mem, symbols } = await buildAndBoot(project);
            const guard = watchPositionJumpGuard(nes, symbols);
            const assertContained = makeContainmentChecker(mem, { gridW, gridH });
            const armFrames = approachUntilAxis(nes, mem, approachDirName, sameAxis);
            assert.ok(armFrames < 200, `${dirName} phase ${phase} same-axis: the ${approachDirName} approach must actually arm axis ${sameAxis} within 200 frames`);
            assert.equal(mem[ST_ACTIVE], sameAxis, `${dirName} phase ${phase} same-axis: precondition -- a strip must genuinely be in flight on axis ${sameAxis} at the hit frame`);
            checkAndTally(assertContained, 'in-flight-same-axis', mem, `${dirName} phase ${phase} same-axis: hit frame`);
            mem[KB_DIR] = dirConst;
            mem[SW_KB_ACC] = phase;
            mem[SW_KB_TIMER] = SW_KB_TIME;
            for (let i = 0; i < SW_KB_TIME; i++) {
              nes.frame();
              checkAndTally(assertContained, 'in-flight-same-axis', mem, `${dirName} phase ${phase} same-axis (${reversing ? 'reversing' : 'reinforcing'}): knockback frame ${i}`);
            }
            assert.equal(mem[SW_KB_TIMER], 0, `${dirName} phase ${phase} same-axis: sw_kb_timer must have counted all the way down`);
            for (let i = 0; i < 20; i++) {
              nes.frame();
              checkAndTally(assertContained, 'in-flight-same-axis', mem, `${dirName} phase ${phase} same-axis: post-knockback settle frame ${i}`);
            }
            guard.assertNone(`in-flight-same-axis ${dirName} phase ${phase}, ordinary design-rate workload`);
            guard.unwatch();
          }

          // orthogonal-axis sub-case: the real strip in flight is on the OTHER axis from the
          // knockback direction.
          {
            const project = createStreamedProject({ gridW, gridH });
            project.project.startScreen = 12;
            const { nes, mem, symbols } = await buildAndBoot(project);
            const guard = watchPositionJumpGuard(nes, symbols);
            const assertContained = makeContainmentChecker(mem, { gridW, gridH });
            const orthogonalApproachDirName = ORTHOGONAL_APPROACH[dirName];
            const armFrames = approachUntilAxis(nes, mem, orthogonalApproachDirName, orthogonalAxis);
            assert.ok(armFrames < 200, `${dirName} phase ${phase} orthogonal-axis: the ${orthogonalApproachDirName} approach must actually arm axis ${orthogonalAxis} within 200 frames`);
            assert.equal(mem[ST_ACTIVE], orthogonalAxis, `${dirName} phase ${phase} orthogonal-axis: precondition -- a strip must genuinely be in flight on axis ${orthogonalAxis} (orthogonal to the ${dirName} knockback) at the hit frame`);
            checkAndTally(assertContained, 'in-flight-orthogonal-axis', mem, `${dirName} phase ${phase} orthogonal-axis: hit frame`);
            mem[KB_DIR] = dirConst;
            mem[SW_KB_ACC] = phase;
            mem[SW_KB_TIMER] = SW_KB_TIME;
            for (let i = 0; i < SW_KB_TIME; i++) {
              nes.frame();
              checkAndTally(assertContained, 'in-flight-orthogonal-axis', mem, `${dirName} phase ${phase} orthogonal-axis: knockback frame ${i}`);
            }
            assert.equal(mem[SW_KB_TIMER], 0, `${dirName} phase ${phase} orthogonal-axis: sw_kb_timer must have counted all the way down`);
            for (let i = 0; i < 20; i++) {
              nes.frame();
              checkAndTally(assertContained, 'in-flight-orthogonal-axis', mem, `${dirName} phase ${phase} orthogonal-axis: post-knockback settle frame ${i}`);
            }
            guard.assertNone(`in-flight-orthogonal-axis ${dirName} phase ${phase}, ordinary design-rate workload`);
            guard.unwatch();
          }
        }
      }
    });

    // -------------------------------------------------- superseded by phase 2 slice 6's position-
    // jump guard: these two cases were retained negative controls through slice 5 (a flat,
    // faster-than-design knockback rate reliably overran the completed-content window and failed
    // containment, proving the checker's own sensitivity -- see git history for the pre-slice-6
    // text). Slice 6 adds sw_pjg_check/sw_position_jump_guard (engine/streamworld.asm, called from
    // sw_frame_camera_window right after sw_camera_window_recompute): once the window's own lag
    // behind its desired origin reaches 6 blocks on either axis, it forces blank, snaps the window
    // directly to the desired origin with a full sw_render_window redraw, and holds camera/OAM
    // publication through that resync -- exactly the obligation-3 mechanism
    // docs/design-streamed-worlds.md's "position-jump guard" section describes. A scratch probe
    // (handoff-next/ for phase 2 slice 6) traced win_col_screen/local block-for-block through both
    // these exact rate-8/9 bursts: with the slice-5 engine (git-stashed to confirm), lag climbs
    // past 6 and the window sticks, exactly the old failure; with slice 6's engine, lag reaches
    // exactly 5 the frame before it would hit 6, then the NEXT frame reads back lag 0 -- the guard
    // firing mid-frame, before either containment check below ever sees an uncorrected sample. These
    // two rates are consequently no longer negative controls (the defect they exercised is closed);
    // they are now positive regression proof that the guard reaches this exact real-world scenario,
    // not merely the synthetic direct-call case the dedicated obligation-3 test below covers.
    await t.test('phase 2 slice 6: the position-jump guard closes the former negative control -- a faster-than-design flat knockback rate no longer breaks containment', async () => {
      const gridW = 5, gridH = 5;
      const rate = 9;
      const project = createStreamedProject({ gridW, gridH });
      project.project.startScreen = 12;
      fasterKnockbackOverride(project, rate);
      const { nes, mem, symbols } = await buildAndBoot(project);
      const assertContained = makeContainmentChecker(mem, { gridW, gridH });
      // Fix round 1, finding 5: this rate is retained as a POSITIVE guard test (see the header
      // comment above) -- it must show the guard actually firing, not merely that containment
      // happens to hold; a mutation that made the guard a no-op but coincidentally left
      // containment intact some other way would otherwise slip through silently.
      const guard = watchPositionJumpGuard(nes, symbols);
      const armFrames = approachUntilAxis(nes, mem, 'right', 1);
      assert.ok(armFrames < 200, 'the approach must still arm the column strip within 200 frames');
      assert.equal(mem[ST_ACTIVE], 1, 'precondition -- a real strip must be in flight before the burst');
      mem[KB_DIR] = DIR_RIGHT;
      mem[SW_KB_TIMER] = SW_KB_TIME;
      for (let i = 0; i < SW_KB_TIME; i++) {
        nes.frame();
        assertContained(`rate ${rate}: knockback frame ${i}`);
      }
      for (let i = 0; i < 20; i++) {
        nes.frame();
        assertContained(`rate ${rate}: post-knockback settle frame ${i}`);
      }
      assert.ok(guard.count() > 0, `rate ${rate}: the position-jump guard should have fired at least once -- this rate exists to prove containment survives BECAUSE the guard catches it, not merely that it survives`);
      // Round 2 finding A5: this over-speed rate must fail the SAME ordinary-workload assertion
      // (guard.assertNone) the design-rate tests above rely on -- proving that assertion is a real
      // negative control here, not merely an assertion nothing in this suite ever exercises.
      assert.throws(() => guard.assertNone(`rate ${rate}`), /sw_position_jump_guard fired/,
        `rate ${rate}: the ordinary-workload guard.assertNone oracle must fail on this deliberately over-speed rate`);
      guard.unwatch();
    });

    await t.test('phase 2 slice 6: the position-jump guard closes the former negative control -- the full matrix\'s more sensitive reversing case at rate 8 no longer breaks containment', async () => {
      const gridW = 5, gridH = 5;
      const rate = 8;
      const project = createStreamedProject({ gridW, gridH });
      project.project.startScreen = 12;
      fasterKnockbackOverride(project, rate);
      const { nes, mem, symbols } = await buildAndBoot(project);
      const assertContained = makeContainmentChecker(mem, { gridW, gridH });
      const guard = watchPositionJumpGuard(nes, symbols);
      const armFrames = approachUntilAxis(nes, mem, 'left', 1);
      assert.ok(armFrames < 200, 'the left approach must still arm the column strip within 200 frames');
      assert.equal(mem[ST_ACTIVE], 1, 'precondition -- a real strip must be in flight before the burst');
      mem[KB_DIR] = DIR_RIGHT;
      mem[SW_KB_ACC] = 64;
      mem[SW_KB_TIMER] = SW_KB_TIME;
      for (let i = 0; i < SW_KB_TIME; i++) {
        nes.frame();
        assertContained(`rate ${rate} (RIGHT phase 64 reversing): knockback frame ${i}`);
      }
      for (let i = 0; i < 20; i++) {
        nes.frame();
        assertContained(`rate ${rate} (RIGHT phase 64 reversing): post-knockback settle frame ${i}`);
      }
      assert.ok(guard.count() > 0, `rate ${rate} (RIGHT phase 64 reversing): the position-jump guard should have fired at least once`);
      assert.throws(() => guard.assertNone(`rate ${rate} (RIGHT phase 64 reversing)`), /sw_position_jump_guard fired/,
        `rate ${rate} (RIGHT phase 64 reversing): the ordinary-workload guard.assertNone oracle must fail on this deliberately over-speed rate`);
      guard.unwatch();
    });

    // -------------------------------------------------- fix round 1, finding 5: a shared test-side
    // PC hook at sw_position_jump_guard (test/lib/pjgguard.js), proving the converse of the two
    // rate-8/9 tests just above -- ORDINARY movement/strip/knockback, at the design's own real
    // rate (fasterKnockbackOverride never applied), never needs the guard's rescue at all. The two
    // rate-9/rate-8 tests above stayed useful as positive guard-reaches-this-scenario evidence
    // (their own header explains why), but neither one -- nor the containment-only matrices around
    // them -- had ever asserted that ordinary play stays clear of the guard; a coder mistake that
    // silently widened the guard's own trip threshold, or slowed ordinary tracking enough to
    // graze it, could have passed every existing containment assertion while still routing
    // ordinary play through a mechanism meant only for the rescue case.
    await t.test('phase 2 slice 6 fix round 1, finding 5: the position-jump guard stays silent through ordinary movement, strip and knockback, at the design\'s own rate', async () => {
      // Idle-strip case: all four directions, all four starting phases, no approach -- the same
      // scenario shape as the idle-matrix test above, at the un-sped-up design rate.
      {
        const project = createStreamedProject({});
        const { gridW, gridH } = { gridW: 3, gridH: 2 };
        const directions = [['up', DIR_UP], ['down', DIR_DOWN], ['left', DIR_LEFT], ['right', DIR_RIGHT]];
        const phases = [0, 64, 128, 192];
        for (const [dirName, dirConst] of directions) {
          for (const phase of phases) {
            const { nes, mem, symbols } = await buildAndBoot(project);
            const guard = watchPositionJumpGuard(nes, symbols);
            mem[KB_DIR] = dirConst;
            mem[SW_KB_ACC] = phase;
            mem[SW_KB_TIMER] = SW_KB_TIME;
            for (let i = 0; i < SW_KB_TIME; i++) nes.frame();
            for (let i = 0; i < 20; i++) nes.frame();
            guard.assertNone(`idle-strip, ${dirName} phase ${phase}, design rate`);
            guard.unwatch();
          }
        }
      }
      // In-flight-strip case: a real approach arms the column strip (5x5 grid, centre landing,
      // matching the rate-8/9 tests' own setup), then a design-rate knockback burst runs with that
      // strip genuinely in flight.
      {
        const gridW = 5, gridH = 5;
        const project = createStreamedProject({ gridW, gridH });
        project.project.startScreen = 12;
        const { nes, mem, symbols } = await buildAndBoot(project);
        const guard = watchPositionJumpGuard(nes, symbols);
        const armFrames = approachUntilAxis(nes, mem, 'right', 1);
        assert.ok(armFrames < 200, 'the approach must still arm the column strip within 200 frames');
        assert.equal(mem[ST_ACTIVE], 1, 'precondition -- a real strip must be in flight before the burst');
        mem[KB_DIR] = DIR_RIGHT;
        mem[SW_KB_TIMER] = SW_KB_TIME;
        for (let i = 0; i < SW_KB_TIME; i++) nes.frame();
        for (let i = 0; i < 20; i++) nes.frame();
        guard.assertNone('in-flight strip, design rate');
        guard.unwatch();
      }
      // Landing case: the guard must also stay silent across a fresh streamed landing and its own
      // first tracking frames -- the same shape buildAndBoot itself exercises on every call above,
      // watched explicitly here so a landing-specific regression cannot hide behind the burst cases.
      {
        const project = createStreamedProject({});
        const { nes, symbols } = await buildAndBoot(project);
        const guard = watchPositionJumpGuard(nes, symbols);
        for (let i = 0; i < 60; i++) nes.frame();
        guard.assertNone('post-landing settle, design rate');
        guard.unwatch();
      }
    });

    // -------------------------------------------------- ownership-boundary crossing, both axes
    // (base case -- an idle strip: st_active starts, and stays, 0 unless the burst's own movement
    // happens to arm one incidentally)
    await t.test('containment: a knockback that crosses an ownership (screen) boundary mid-flight, both axes', async () => {
      const cases = [
        { dirName: 'right', dirConst: DIR_RIGHT, startScreen: 0, startX: 245, startY: 112 },
        { dirName: 'left', dirConst: DIR_LEFT, startScreen: 1, startX: 8, startY: 112 },
        { dirName: 'down', dirConst: DIR_DOWN, startScreen: 0, startX: 120, startY: 232 },
        { dirName: 'up', dirConst: DIR_UP, startScreen: 3, startX: 120, startY: 6 } // screen (col0,row1), gridW=3
      ];
      for (const { dirName, dirConst, startScreen, startX, startY } of cases) {
        const project = createStreamedProject({});
        project.project.startScreen = startScreen;
        project.project.startX = startX;
        project.project.startY = startY;
        const { nes, mem, symbols } = await buildAndBoot(project);
        const guard = watchPositionJumpGuard(nes, symbols);
        const assertContained = makeContainmentChecker(mem, { gridW: 3, gridH: 2 });
        assertContained(`crossing ${dirName}: landing`);
        const startSwCol = mem[SW_COL];
        const startSwRow = mem[SW_ROW];
        mem[KB_DIR] = dirConst;
        mem[SW_KB_TIMER] = SW_KB_TIME;
        let crossed = false;
        for (let i = 0; i < SW_KB_TIME; i++) {
          nes.frame();
          assertContained(`crossing ${dirName}: knockback frame ${i}`);
          if (mem[SW_COL] !== startSwCol || mem[SW_ROW] !== startSwRow) crossed = true;
        }
        assert.ok(crossed, `crossing ${dirName}: this case must actually cross a screen boundary within the burst`);
        for (let i = 0; i < 20; i++) {
          nes.frame();
          assertContained(`crossing ${dirName}: post-knockback settle frame ${i}`);
        }
        guard.assertNone(`crossing ${dirName}, ordinary design-rate workload`);
        guard.unwatch();
      }
    });

    // -------------------------------------------------- fix round 1, finding 1: the same crossing
    // property, now with a REAL strip in flight (not idle) at the moment of the crossing. A 5x5
    // grid, landing on screen 12 (grid centre) with a per-direction startX/startY close to that
    // screen's own far edge, makes both properties achievable together: the player is already far
    // enough into the grid that a real approach arms the matching-axis strip in a handful of frames
    // (this fix round's own scratch probes), while still being close enough to the screen edge that
    // the 16-frame knockback burst crosses it before the strip finishes draining.
    await t.test('containment: an ownership-boundary crossing WITH a real strip in flight, all four directions', async () => {
      const gridW = 5, gridH = 5;
      const cases = [
        { dirName: 'right', dirConst: DIR_RIGHT, startX: 220, axis: 1 },
        { dirName: 'left', dirConst: DIR_LEFT, startX: 36, axis: 1 },
        { dirName: 'down', dirConst: DIR_DOWN, startY: 228, axis: 2 },
        { dirName: 'up', dirConst: DIR_UP, startY: 8, axis: 2 }
      ];
      for (const { dirName, dirConst, startX, startY, axis } of cases) {
        const project = createStreamedProject({ gridW, gridH });
        project.project.startScreen = 12;
        if (startX != null) project.project.startX = startX;
        if (startY != null) project.project.startY = startY;
        const { nes, mem, symbols } = await buildAndBoot(project);
        const guard = watchPositionJumpGuard(nes, symbols);
        const assertContained = makeContainmentChecker(mem, { gridW, gridH });
        const startSwCol = mem[SW_COL];
        const startSwRow = mem[SW_ROW];
        const armFrames = approachUntilAxis(nes, mem, dirName, axis);
        assert.ok(armFrames < 200, `crossing+strip ${dirName}: the approach must arm axis ${axis} within 200 frames`);
        assert.equal(mem[ST_ACTIVE], axis, `crossing+strip ${dirName}: precondition -- a strip must genuinely be in flight at the hit frame`);
        checkAndTally(assertContained, 'crossing-with-strip', mem, `crossing+strip ${dirName}: hit frame`);
        mem[KB_DIR] = dirConst;
        mem[SW_KB_TIMER] = SW_KB_TIME;
        let crossed = false;
        let activeAtCross = null;
        for (let i = 0; i < SW_KB_TIME; i++) {
          nes.frame();
          checkAndTally(assertContained, 'crossing-with-strip', mem, `crossing+strip ${dirName}: knockback frame ${i}`);
          if (!crossed && (mem[SW_COL] !== startSwCol || mem[SW_ROW] !== startSwRow)) {
            crossed = true;
            activeAtCross = mem[ST_ACTIVE];
          }
        }
        assert.ok(crossed, `crossing+strip ${dirName}: this case must actually cross a screen boundary within the burst`);
        assert.notEqual(activeAtCross, 0, `crossing+strip ${dirName}: the strip must still have been in flight (st_active != 0) at the exact crossing frame, not already drained`);
        for (let i = 0; i < 20; i++) {
          nes.frame();
          checkAndTally(assertContained, 'crossing-with-strip', mem, `crossing+strip ${dirName}: post-knockback settle frame ${i}`);
        }
        guard.assertNone(`crossing+strip ${dirName}, ordinary design-rate workload`);
        guard.unwatch();
      }
    });

    // -------------------------------------------------- clamped map edge, both axes, idle strip.
    // Continuing straight outward from an already-settled boundary cannot arm a strip on that SAME
    // axis -- there is architecturally no further screen to stream INTO past the map's own edge, so
    // this base case never puts a strip in flight (verified empirically, this fix round's own scratch
    // probes). Round 2 finding 2: that does NOT make "clamped edge" and "strip in flight" mutually
    // exclusive in general -- movement ALONG the boundary can still arm an ORTHOGONAL-axis strip
    // while the player sits at the edge, and an outward knockback can then run concurrently with that
    // strip draining. The dedicated case for that is right after this one.
    await t.test('containment: a knockback driven straight into a clamped map edge never exposes undrawn terrain', async () => {
      const cases = [
        { dirName: 'left-at-col0', dirConst: DIR_LEFT, startScreen: 0, startX: 3, startY: 112 },
        { dirName: 'right-at-far-col', dirConst: DIR_RIGHT, startScreen: 2, startX: 252, startY: 112 }, // gridW=3, far col=2
        { dirName: 'up-at-row0', dirConst: DIR_UP, startScreen: 0, startX: 120, startY: 3 },
        { dirName: 'down-at-far-row', dirConst: DIR_DOWN, startScreen: 3, startX: 120, startY: 236 } // gridH=2, far row=1 (screen index 3 = col0,row1)
      ];
      for (const { dirName, dirConst, startScreen, startX, startY } of cases) {
        const project = createStreamedProject({});
        project.project.startScreen = startScreen;
        project.project.startX = startX;
        project.project.startY = startY;
        const { nes, mem, symbols } = await buildAndBoot(project);
        const guard = watchPositionJumpGuard(nes, symbols);
        const assertContained = makeContainmentChecker(mem, { gridW: 3, gridH: 2 });
        assertContained(`edge ${dirName}: landing`);
        mem[KB_DIR] = dirConst;
        mem[SW_KB_TIMER] = SW_KB_TIME;
        for (let i = 0; i < SW_KB_TIME; i++) {
          nes.frame();
          assertContained(`edge ${dirName}: knockback frame ${i}`);
        }
        for (let i = 0; i < 10; i++) {
          nes.frame();
          assertContained(`edge ${dirName}: post-knockback settle frame ${i}`);
        }
        guard.assertNone(`edge ${dirName}, ordinary design-rate workload`);
        guard.unwatch();
      }
    });

    // -------------------------------------------------- round 2 finding 2: a clamped map edge WITH
    // a real ORTHOGONAL-axis strip in flight. Landing directly on the edge screen (so the approach
    // itself never has to cross the very boundary under test), then holding the direction ALONG the
    // boundary until the engine itself arms a strip on the other axis (never poked), then knocking
    // straight outward into the clamped edge while that strip is still draining. A 5x5 grid, the same
    // four owner screens the round-2 review's own scratch probes used: left at (col 0, row 2), right
    // at (col 4, row 2) with a row strip; up at (col 2, row 0), down at (col 2, row 4) with a column
    // strip.
    await t.test('containment: a knockback into a clamped map edge WITH a real orthogonal strip in flight', async () => {
      const gridW = 5, gridH = 5;
      const cases = [
        { dirName: 'left', dirConst: DIR_LEFT, startScreen: 10, startX: 3, startY: 112, approachButton: DOWN, axis: 2, edgeAddr: SW_COL, edgeValue: 0 },
        { dirName: 'right', dirConst: DIR_RIGHT, startScreen: 14, startX: 242, startY: 112, approachButton: DOWN, axis: 2, edgeAddr: SW_COL, edgeValue: gridW - 1 },
        { dirName: 'up', dirConst: DIR_UP, startScreen: 2, startX: 120, startY: 3, approachButton: RIGHT, axis: 1, edgeAddr: SW_ROW, edgeValue: 0 },
        { dirName: 'down', dirConst: DIR_DOWN, startScreen: 22, startX: 120, startY: 224, approachButton: RIGHT, axis: 1, edgeAddr: SW_ROW, edgeValue: gridH - 1 }
      ];
      for (const { dirName, dirConst, startScreen, startX, startY, approachButton, axis, edgeAddr, edgeValue } of cases) {
        const project = createStreamedProject({ gridW, gridH });
        project.project.startScreen = startScreen;
        project.project.startX = startX;
        project.project.startY = startY;
        const { nes, mem, symbols } = await buildAndBoot(project);
        const guard = watchPositionJumpGuard(nes, symbols);
        const assertContained = makeContainmentChecker(mem, { gridW, gridH });
        assert.equal(mem[edgeAddr], edgeValue, `edge+strip ${dirName}: precondition -- the landing must genuinely sit on the clamped map edge`);
        nes.buttonDown(1, approachButton);
        let f = 0;
        while (mem[ST_ACTIVE] !== axis && f++ < 200) { nes.frame(); checkAndTally(assertContained, 'edge-with-strip', mem, `edge+strip ${dirName}: approach frame ${f}`); }
        nes.buttonUp(1, approachButton);
        assert.ok(f < 200, `edge+strip ${dirName}: the along-the-boundary approach must actually arm axis ${axis} within 200 frames`);
        assert.equal(mem[ST_ACTIVE], axis, `edge+strip ${dirName}: precondition -- a strip must genuinely be in flight on axis ${axis} at the hit frame`);
        assert.equal(mem[edgeAddr], edgeValue, `edge+strip ${dirName}: precondition -- the player must still be sitting on the clamped map edge at the hit frame`);
        checkAndTally(assertContained, 'edge-with-strip', mem, `edge+strip ${dirName}: hit frame`);
        mem[KB_DIR] = dirConst;
        mem[SW_KB_TIMER] = SW_KB_TIME;
        for (let i = 0; i < SW_KB_TIME; i++) {
          nes.frame();
          checkAndTally(assertContained, 'edge-with-strip', mem, `edge+strip ${dirName}: knockback frame ${i}`);
        }
        assert.equal(mem[edgeAddr], edgeValue, `edge+strip ${dirName}: the clamped edge must have refused the outward crossing -- the owning screen must be unchanged after the burst`);
        for (let i = 0; i < 20; i++) {
          nes.frame();
          checkAndTally(assertContained, 'edge-with-strip', mem, `edge+strip ${dirName}: post-knockback settle frame ${i}`);
        }
        guard.assertNone(`edge+strip ${dirName}, ordinary design-rate workload`);
        guard.unwatch();
      }
    });

    // -------------------------------------------------- test 4a: independent oracle. Poke-driven
    // (SW_KB_TIMER/SW_KB_ACC/KB_DIR directly, the same convention tests 2/3/6/7 already use), so
    // the frame-stepping loop below never follows a callRoutine call -- callRoutine's own PC-hijack
    // stub (test/lib/callroutine.js) is a one-shot "arm state, then read RAM back" tool everywhere
    // else in this codebase (every player_hazard/hurt_player callRoutine call in this same file
    // asserts on RAM immediately, never drives a further nes.frame()); continuing normal frame
    // emulation from wherever the stub's own PC (0x703) landed walks off the actual main loop and
    // into whatever RAM happens to follow, which surfaced as a real crash ("invalid opcode at
    // address $828") the first time this test tried it. Test 4b below keeps callRoutine to its own
    // established one-shot-assertion role for the repeat-hit rule instead.
    // Fix round 1 pending item (d): extended to loop over all 4 starting accumulator phase classes
    // too, not just phase 0 -- still fully poke-driven (SW_KB_ACC set directly), so the total
    // expected displacement is computed by the SAME shared walkStep primitive every other oracle in
    // this file already uses, starting from that same poked phase, rather than a hardcoded 24.
    await t.test('the real 1.5px/frame-for-16-frames workload matches an independently computed oracle, every direction x every starting accumulator phase', async () => {
      const directions = [
        ['right', DIR_RIGHT, 'playerX'],
        ['left', DIR_LEFT, 'playerX'],
        ['down', DIR_DOWN, 'playerY'],
        ['up', DIR_UP, 'playerY']
      ];
      const phases = [0, 64, 128, 192];
      const gridW = 3, gridH = 2;
      for (const [dirName, dirConst, axisField] of directions) {
        for (const phase of phases) {
          const project = createStreamedProject({});
          const { nes, mem, guard } = await buildAndBoot(project);
          let model = { playerX: mem[PLAYER_X], playerY: mem[PLAYER_Y], acc: phase, swCol: mem[SW_COL], swRow: mem[SW_ROW] };
          const startAxis = model[axisField];
          mem[KB_DIR] = dirConst;
          mem[SW_KB_ACC] = phase;
          mem[SW_KB_TIMER] = SW_KB_TIME;
          let expectedTotal = 0;
          let acc = phase;
          for (let i = 0; i < SW_KB_TIME; i++) {
            const { step, acc: next } = walkStep(acc, SW_KB_SPEED_SUB);
            expectedTotal += step;
            acc = next;
          }
          for (let i = 0; i < SW_KB_TIME; i++) {
            nes.frame();
            model = predictKnockbackStep({ ...model, dir: dirName, gridW, gridH });
            assert.equal(mem[PLAYER_X], model.playerX, `${dirName} phase ${phase}: frame ${i} player_x`);
            assert.equal(mem[PLAYER_Y], model.playerY, `${dirName} phase ${phase}: frame ${i} player_y`);
            assert.equal(mem[SW_COL], model.swCol, `${dirName} phase ${phase}: frame ${i} sw_col`);
            assert.equal(mem[SW_ROW], model.swRow, `${dirName} phase ${phase}: frame ${i} sw_row`);
          }
          assert.equal(mem[SW_KB_TIMER], 0, `${dirName} phase ${phase}: sw_kb_timer must have reached 0 after exactly SW_KB_TIME frames`);
          const netWorld =
            axisField === 'playerX'
              ? model.swCol * 256 + model.playerX - startAxis
              : model.swRow * 240 + model.playerY - startAxis;
          const signedExpected = dirName === 'right' || dirName === 'down' ? expectedTotal : -expectedTotal;
          assert.equal(netWorld, signedExpected, `${dirName} phase ${phase}: net world-space displacement over the burst must exactly match the independently summed walkStep trace from starting phase ${phase} (${expectedTotal}px), not a partial or over-shot amount`);
          guard.assertNone(`knockback oracle ${dirName} phase ${phase}, ordinary design-rate workload`);
          guard.unwatch();
        }
      }
    });

    // -------------------------------------------------- test 4b: the repeated-hit rule, ISOLATED/
    // POKE-BASED (a legal repeat after both the knockback AND the remaining invulnerability window
    // have elapsed does not compound; a hit inside invulnerability has no effect at all). Each
    // callRoutine call below is its own one-shot arm-then-read, exactly the established convention --
    // "the window has elapsed" is simulated the same way this file already simulates mid-burst state
    // (a direct mem[PLAYER_IFRAMES] poke), not by driving real frames through a callRoutine-hijacked
    // PC. Kept alongside (not replaced by) the real, frame-driven end-to-end test below: this one
    // isolates the repeat-hit rule itself across all 4 directions cheaply; that one proves the same
    // rule holds through a real contact, a real oracle-matched burst and a real natural expiry.
    // Opt-out (fix round 4, item 3): a synthetic direct-call routine probe, per the above -- no
    // nes.frame() loop, so buildAndBootWithSymbols's own returned guard is unused here.
    await t.test('a repeated hit obeys IFRAME_TIME: no effect while invulnerable, a fresh non-compounding burst once it has elapsed', async () => {
      const directions = [DIR_RIGHT, DIR_LEFT, DIR_DOWN, DIR_UP];
      for (const dirConst of directions) {
        const project = createStreamedProject({});
        const { dir, nes, mem, addrOf } = await buildAndBootWithSymbols(project);
        try {
          const hpBefore = mem[PLAYER_HP];
          triggerFloorHit(nes, mem, addrOf, dirConst);
          assert.equal(mem[PLAYER_HP], hpBefore - 1, 'hurt_player must have taken exactly one heart');
          assert.equal(mem[PLAYER_IFRAMES], 60, 'player_iframes must be armed at IFRAME_TIME(60)');
          assert.equal(mem[SW_KB_TIMER], SW_KB_TIME, 'sw_kb_timer must be armed at SW_KB_TIME(16)');

          // A hit attempted while still invulnerable (player_iframes > 0, whether or not a
          // knockback burst happens to still be in flight) must have no effect at all.
          const hpDuringIframes = mem[PLAYER_HP];
          const kbTimerDuringIframes = mem[SW_KB_TIMER];
          const kbAccDuringIframes = mem[SW_KB_ACC];
          triggerFloorHit(nes, mem, addrOf, dirConst);
          assert.equal(mem[PLAYER_HP], hpDuringIframes, 'a hit inside invulnerability must not take a heart');
          assert.equal(mem[SW_KB_TIMER], kbTimerDuringIframes, 'a hit inside invulnerability must not touch sw_kb_timer');
          assert.equal(mem[SW_KB_ACC], kbAccDuringIframes, 'a hit inside invulnerability must not touch sw_kb_acc');

          // Simulate the invulnerability window (and any knockback burst) having fully elapsed --
          // the same "poke the state a real frame-driven wait would have reached" convention the
          // containment/oracle tests already use.
          mem[PLAYER_IFRAMES] = 0;
          mem[SW_KB_TIMER] = 0;
          const hpBeforeRepeat = mem[PLAYER_HP];
          triggerFloorHit(nes, mem, addrOf, dirConst);
          assert.equal(mem[PLAYER_HP], hpBeforeRepeat - 1, 'a legal repeat hit must take exactly one more heart');
          assert.equal(mem[PLAYER_IFRAMES], 60, 'a legal repeat hit must re-arm IFRAME_TIME(60)');
          assert.equal(mem[SW_KB_TIMER], SW_KB_TIME, 'a legal repeat hit must arm a fresh SW_KB_TIME(16), not a stacked value');
          assert.equal(mem[SW_KB_ACC], 0, "a legal repeat hit's sw_kb_acc must restart fresh at 0, not compound the prior burst's leftover phase");
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    });

    // -------------------------------------------------- fix round 1, finding 3: the real hit path,
    // end-to-end, no pokes and no callRoutine-then-further-frames (test 4a's own header comment
    // explains why the latter crashes -- test/lib/callroutine.js's PC-hijack stub is a one-shot
    // arm-then-read tool, not a place to resume normal frame emulation from). A real damaging NPC is
    // walked into for real; the resulting burst is checked against the same independent oracle test
    // 4a above uses (starting phase is always 0 here -- the only value a REAL hurt_player dispatch
    // ever produces, per test 4b's own "restart fresh at 0" assertion; the 4 poked phase classes are
    // covered by 4a's own extended matrix above, not duplicated here without pokes); a second
    // contact attempted while still invulnerable must have no effect; stepping further away and then
    // waiting out the rest of the window with no input at all lets player_iframes decrement
    // naturally, once per real frame (never polled), down to exactly 0; a fresh contact after that
    // arms a non-compounding second burst. Two approach axes, horizontal and vertical. Round 2 fix,
    // finding 1: an optional engineOverride is applied to the project right before build, so the
    // dedicated negative control below can reuse this exact real-contact/reapproach/retreat/cooldown
    // sequence against a sabotaged engine, instead of a second hand-duplicated copy of it.
    async function realHitEndToEnd(dirName, npcPos, engineOverride) {
      const gridW = 5, gridH = 5;
      const project = createStreamedProject({ gridW, gridH });
      project.project.startScreen = 12;
      const aid = project.sprites.actors.length;
      project.sprites.actors.push({ name: 'Damage', behavior: 'npc', hp: 1, damage: 1 });
      const screen = project.maps.find((m) => m.streamed).screens[12];
      screen.entities = screen.entities ?? [];
      screen.entities.push({ actorId: aid, x: npcPos.x, y: npcPos.y, props: {} });
      if (engineOverride) engineOverride(project);
      const { nes, mem, guard } = await buildAndBoot(project);
      const assertContained = makeContainmentChecker(mem, { gridW, gridH });
      const button = DIR_BUTTON[dirName];
      const oppositeButton = DIR_BUTTON[DIR_INVERSE[dirName]];

      const hp0 = mem[PLAYER_HP];
      for (let hit = 0; hit < 2; hit++) {
        const hpBefore = mem[PLAYER_HP];
        nes.buttonDown(1, button);
        let f = 0;
        while (mem[PLAYER_HP] === hpBefore && f++ < 150) { nes.frame(); checkAndTally(assertContained, 'real-hit-path', mem, `${dirName} hit ${hit}: approach frame ${f}`); }
        nes.buttonUp(1, button);
        assert.ok(f < 150, `${dirName} hit ${hit}: a real walk-in contact must occur within 150 frames`);
        assert.equal(mem[PLAYER_HP], hpBefore - 1, `${dirName} hit ${hit}: a real contact must take exactly one heart`);
        assert.equal(mem[PLAYER_IFRAMES], 60, `${dirName} hit ${hit}: a real contact must arm player_iframes at IFRAME_TIME(60)`);
        assert.equal(mem[SW_KB_TIMER], SW_KB_TIME, `${dirName} hit ${hit}: a real contact must arm sw_kb_timer at SW_KB_TIME(16)`);
        assert.equal(mem[SW_KB_ACC], 0, `${dirName} hit ${hit}: a fresh real contact's sw_kb_acc must start at 0`);

        const kbDirName = DIR_NAME_BY_CONST[mem[KB_DIR]];
        let model = { playerX: mem[PLAYER_X], playerY: mem[PLAYER_Y], acc: 0, swCol: mem[SW_COL], swRow: mem[SW_ROW] };
        for (let k = 0; k < SW_KB_TIME; k++) {
          nes.frame();
          model = predictKnockbackStep({ ...model, dir: kbDirName, gridW, gridH });
          assert.equal(mem[PLAYER_X], model.playerX, `${dirName} hit ${hit}: frame ${k} player_x vs the independent oracle`);
          assert.equal(mem[PLAYER_Y], model.playerY, `${dirName} hit ${hit}: frame ${k} player_y vs the independent oracle`);
          assert.equal(mem[SW_KB_TIMER], SW_KB_TIME - 1 - k, `${dirName} hit ${hit}: frame ${k} sw_kb_timer must decrement naturally, once per real frame`);
          checkAndTally(assertContained, 'real-hit-path', mem, `${dirName} hit ${hit}: burst frame ${k}`);
        }
        assert.equal(mem[SW_KB_TIMER], 0, `${dirName} hit ${hit}: sw_kb_timer must reach exactly 0 after the real burst`);

        // Round 2 fix, finding 1: the review found the original code below pressed the WRONG pair of
        // buttons here -- oppositeButton to "reapproach", then button to "retreat" -- which walks the
        // player AWAY from the NPC on both legs, so unchanged HP proved nothing (no contact was ever
        // attempted). Reapproach with the ORIGINAL approach button (back toward the NPC) and retreat
        // with its opposite. A real contact OPPORTUNITY is asserted directly -- player/NPC hitboxes
        // actually overlapping, the same |dx|<TOUCH_RANGE && |dy|<TOUCH_RANGE box entity_contact's own
        // entity_touching_player checks (engine/entities.asm:559-584) -- while player_iframes is still
        // positive, so a build that merely never reaches the NPC again cannot pass this by accident.
        const hpDuringIframes = mem[PLAYER_HP];
        const kbTimerDuringIframes = mem[SW_KB_TIMER];
        nes.buttonDown(1, button);
        let reapproachFrames = 0;
        let contactOpportunity = false;
        while (mem[PLAYER_IFRAMES] > 10 && reapproachFrames++ < 60) {
          nes.frame();
          checkAndTally(assertContained, 'real-hit-path', mem, `${dirName} hit ${hit}: reapproach frame ${reapproachFrames}`);
          if (Math.abs(mem[ENT_X] - mem[PLAYER_X]) < TOUCH_RANGE && Math.abs(mem[ENT_Y] - mem[PLAYER_Y]) < TOUCH_RANGE) {
            contactOpportunity = true;
            break;
          }
        }
        nes.buttonUp(1, button);
        assert.ok(contactOpportunity, `${dirName} hit ${hit}: reapproaching with the original approach direction must actually reach a real contact opportunity (player/NPC hitboxes overlapping) while player_iframes is still positive (${mem[PLAYER_IFRAMES]} remaining, ${reapproachFrames} frames)`);
        assert.equal(mem[PLAYER_HP], hpDuringIframes, `${dirName} hit ${hit}: a contact attempted during the remaining invulnerability must have no effect`);
        assert.equal(mem[SW_KB_TIMER], kbTimerDuringIframes, `${dirName} hit ${hit}: a contact attempted during the remaining invulnerability must not re-arm sw_kb_timer`);

        // Step further away to genuinely break contact before letting the rest of the window
        // expire with no input at all -- otherwise standing on the (non-solid, touch-damage-only)
        // NPC would re-trigger a hit the instant invulnerability reached 0, corrupting the natural-
        // expiry observation below.
        nes.buttonDown(1, oppositeButton);
        for (let i = 0; i < 8; i++) {
          nes.frame();
          checkAndTally(assertContained, 'real-hit-path', mem, `${dirName} hit ${hit}: retreat frame ${i}`);
        }
        nes.buttonUp(1, oppositeButton);

        let drainFrames = 0;
        let expected = mem[PLAYER_IFRAMES];
        while (mem[PLAYER_IFRAMES] > 0 && drainFrames++ < 80) {
          nes.frame();
          checkAndTally(assertContained, 'real-hit-path', mem, `${dirName} hit ${hit}: cooldown frame ${drainFrames}`);
          expected -= 1;
          assert.equal(mem[PLAYER_IFRAMES], Math.max(expected, 0), `${dirName} hit ${hit}: player_iframes must decrement by exactly 1 per real frame (never poked)`);
          assert.equal(mem[PLAYER_HP], hpBefore - 1, `${dirName} hit ${hit}: hp must not change while the invulnerability window drains naturally`);
        }
        assert.equal(mem[PLAYER_IFRAMES], 0, `${dirName} hit ${hit}: invulnerability must reach exactly 0 via real per-frame decrement, never poked`);
      }
      assert.equal(mem[PLAYER_HP], hp0 - 2, `${dirName}: two real, separated contacts must take exactly two hearts total, non-compounding`);
      guard.assertNone(`real hit path ${dirName}, ordinary design-rate workload`);
      guard.unwatch();
    }

    await t.test('the real hit path, end-to-end, frame-driven only: natural contact, oracle-matched burst, blocked repeat, natural expiry, fresh non-compounding second hit', async () => {
      await realHitEndToEnd('right', { x: 158, y: 112 });
      await realHitEndToEnd('down', { x: 120, y: 150 });
    });

    // -------------------------------------------------- round 2 finding 1: negative control --
    // neutralizing BOTH real invulnerability gates must fail this exact end-to-end test, specifically
    // on the reapproach's own "no effect" HP assertion: with both gates off, the real reapproach
    // contact this fix establishes now lands a genuine second hit while player_iframes is still
    // positive, taking a heart it must not take.
    await t.test('negative control: neutralizing both invulnerability gates fails the real hit path on the reapproach HP assertion', async () => {
      await assert.rejects(
        () => realHitEndToEnd('right', { x: 158, y: 112 }, bothInvulnerabilityGatesOffOverride),
        /a contact attempted during the remaining invulnerability must have no effect/,
        'both invulnerability gates neutralized must fail specifically on the reapproach HP assertion, not some unrelated failure'
      );
    });

    // -------------------------------------------------- test 5 (fix round 1, finding 2 rewrite):
    // Flash concurrent with a REAL strip in flight AND a real knockback underway -- the round-1
    // review's own defect was that the old version below never had a real strip in flight either
    // (an idle 3x2 landing, no approach). flash_tick is a genuine vram_buf producer
    // (script_op_flash queues a real palette-flash packet -- unlike Shake, which only ever touches
    // nmi_scroll/shake_left, never vram_buf); a real strip draw (sw_render_strip's own
    // SW_STREAM_CHUNK-at-a-time queueing) is the second producer sharing the same frames. The
    // nes.cpu.write hook below captures vram_ready the INSTANT it is set nonzero, before this same
    // frame's own NMI drain can clear it back to 0 -- a plain post-frame mem[] read would already
    // see it cleared (nes.frame() runs mainline+NMI atomically).
    await t.test('a Flash event, a real strip in flight, and a real knockback all co-occur without starving the strip draw', async () => {
      const gridW = 5, gridH = 5;
      const project = createStreamedProject({ gridW, gridH });
      project.project.startScreen = 12;
      const actorId = project.sprites.actors.length;
      project.sprites.actors.push({ name: 'Flasher', behavior: 'npc', hp: 1, damage: 0 });
      const screen = project.maps.find((m) => m.streamed).screens[12];
      screen.entities = screen.entities ?? [];
      screen.entities.push({
        actorId,
        x: 140,
        y: 112,
        props: {
          trigger: 'interact',
          event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'flash' }, { op: 'shake', frames: 20 }] }] }
        }
      });
      const { nes, mem, guard } = await buildAndBoot(project);
      const assertContained = makeContainmentChecker(mem, { gridW, gridH });
      assertContained('landing');

      const originalWrite = nes.cpu.write.bind(nes.cpu);
      const hits = [];
      nes.cpu.write = (address, value) => {
        if (address === VRAM_READY && (value & 0xff) !== 0) {
          hits.push({ vramReady: value & 0xff, vramLen: mem[VRAM_LEN], stActive: mem[ST_ACTIVE], swKbTimer: mem[SW_KB_TIMER] });
        }
        return originalWrite(address, value);
      };

      const armFrames = approachUntilAxis(nes, mem, 'right', 1);
      assert.ok(armFrames < 200, 'Flash+strip+knockback: the approach must arm the column strip within 200 frames');
      assert.equal(mem[ST_ACTIVE], 1, 'Flash+strip+knockback: precondition -- a real column strip must be in flight before the interact/knockback');
      assertContained('after approach, before interact');

      mem[PLAYER_DIR] = DIR_RIGHT;
      nes.buttonDown(1, B);
      nes.frame();
      nes.buttonUp(1, B);
      assertContained('after interact, before knockback');

      mem[KB_DIR] = DIR_RIGHT;
      mem[SW_KB_ACC] = 0;
      mem[SW_KB_TIMER] = SW_KB_TIME;
      for (let i = 0; i < SW_KB_TIME; i++) {
        nes.frame();
        assertContained(`Flash/strip/knockback concurrent: frame ${i}`);
      }
      assert.equal(mem[SW_KB_TIMER], 0, 'sw_kb_timer must still have counted all the way down with Flash+strip concurrent');
      for (let i = 0; i < 20; i++) {
        nes.frame();
        assertContained(`Flash/strip/knockback concurrent: settle frame ${i}`);
      }

      nes.cpu.write = originalWrite;

      assert.ok(hits.length > 0, 'the Flash-produced vram_buf packet must actually have been observed opening (vram_ready != 0) at least once during this run');
      for (const hit of hits) {
        assert.ok(hit.vramReady !== 0, `a captured hit must have vram_ready != 0: ${JSON.stringify(hit)}`);
        assert.ok(hit.vramLen > 0 && hit.vramLen <= 35, `a captured hit's vram_len must be in (0,35]: ${JSON.stringify(hit)}`);
        assert.notEqual(hit.stActive, 0, `a captured hit must co-occur with a real strip in flight: ${JSON.stringify(hit)}`);
        assert.notEqual(hit.swKbTimer, 0, `a captured hit must co-occur with a real knockback burst in flight: ${JSON.stringify(hit)}`);
      }
      guard.assertNone('Flash+strip+knockback co-occurrence, ordinary design-rate workload');
      guard.unwatch();
      fs.mkdirSync(path.join(ROOT, 'handoff-next', 'fix1-evidence'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'handoff-next', 'fix1-evidence', 'flash-strip-hits.json'), JSON.stringify(hits, null, 2));
    });

    // -------------------------------------------------- test 6: regression gate -- the streamed
    // knockback step is never the ordinary uncapped KNOCKBACK_SPEED (3px/frame)
    await t.test('regression gate: a streamed knockback never steps 3px in a single frame (the ordinary uncapped KNOCKBACK_SPEED)', async () => {
      const project = createStreamedProject({});
      const { nes, mem, guard } = await buildAndBoot(project);
      mem[KB_DIR] = DIR_RIGHT;
      mem[SW_KB_ACC] = 0;
      mem[SW_KB_TIMER] = SW_KB_TIME;
      let prevX = mem[PLAYER_X];
      let total = 0;
      for (let i = 0; i < SW_KB_TIME; i++) {
        nes.frame();
        const delta = mem[PLAYER_X] - prevX; // no crossing expected in this run (well clear of any edge)
        assert.ok(delta === 1 || delta === 2, `frame ${i}: streamed knockback stepped ${delta}px -- must be 1 or 2, never KNOCKBACK_SPEED's ordinary 3`);
        total += delta;
        prevX = mem[PLAYER_X];
      }
      assert.equal(total, 24, 'total displacement over the burst must be exactly 24px (16 frames averaging 1.5px/frame)');
      guard.assertNone('regression gate (knockback speed cap), ordinary design-rate workload');
      guard.unwatch();
    });

    // -------------------------------------------------- test 7: distinct state
    await t.test('the streamed knockback counter/accumulator is distinct from kb_timer and from the walk accumulators; ordinary knockback and ordinary walking speed are both unchanged', async () => {
      // (a) a streamed knockback must never touch kb_timer/kb_dir's OWN ordinary counter (kb_dir
      // is shared -- knockback_dir's own direction math -- but kb_timer must stay 0), nor the walk
      // accumulators (sw_walk_acc_x/y), which a streamed knockback never calls into (sw_pstep_*
      // is reached directly, not through sw_walk_step_x/y).
      {
        const project = createStreamedProject({});
        const { nes, mem, guard } = await buildAndBoot(project);
        mem[KB_DIR] = DIR_RIGHT;
        mem[SW_KB_TIMER] = SW_KB_TIME;
        for (let i = 0; i < SW_KB_TIME; i++) {
          nes.frame();
          assert.equal(mem[KB_TIMER], 0, `frame ${i}: kb_timer must stay 0 during a streamed knockback`);
          assert.equal(mem[SW_WALK_ACC_X], 0, `frame ${i}: sw_walk_acc_x must stay untouched by a streamed knockback`);
          assert.equal(mem[SW_WALK_ACC_Y], 0, `frame ${i}: sw_walk_acc_y must stay untouched by a streamed knockback`);
        }
        guard.assertNone('distinct-state (a) streamed knockback, ordinary design-rate workload');
        guard.unwatch();
      }
      // (b) ordinary (non-streamed) knockback is completely unchanged: KNOCKBACK_TIME(8) frames
      // at KNOCKBACK_SPEED(3) px/frame, 24px total, using kb_timer/kb_dir -- and it must never
      // touch sw_kb_timer/sw_kb_acc, which mean nothing on an ordinary map.
      {
        const project = createStreamedProject({ mixed: true }); // default start: the ordinary "Before" map
        const { nes, mem, guard } = await buildAndBoot(project, { requireStreamed: false });
        assert.equal(mem[MAP_IS_STREAMED], 0, 'precondition: landed on the ordinary map');
        mem[KB_DIR] = DIR_RIGHT;
        mem[KB_TIMER] = KNOCKBACK_TIME_CONST;
        let prevX = mem[PLAYER_X];
        let total = 0;
        for (let i = 0; i < KNOCKBACK_TIME_CONST; i++) {
          nes.frame();
          const delta = mem[PLAYER_X] - prevX;
          assert.equal(delta, 3, `frame ${i}: ordinary knockback must still move exactly KNOCKBACK_SPEED's 3px/frame, unchanged`);
          assert.equal(mem[SW_KB_TIMER], 0, `frame ${i}: sw_kb_timer must stay 0 on an ordinary map`);
          total += delta;
          prevX = mem[PLAYER_X];
        }
        assert.equal(total, 24, 'ordinary knockback must still total exactly 24px over its own unchanged 8 frames');
        assert.equal(mem[KB_TIMER], 0, 'kb_timer must have counted all the way down');
        guard.assertNone('distinct-state (b) ordinary-map knockback, ordinary design-rate workload');
        guard.unwatch();
      }
      // (c) ordinary walking speed (both game surfaces) is unaffected -- sw_walk_acc_x's own
      // documented cadence (SW_SPEED_SUB_X=128, the same 1/2px alternation the walking tests
      // above already pin) is untouched by anything in this file.
      {
        const project = createStreamedProject({});
        const { nes, mem, guard } = await buildAndBoot(project);
        const startX = mem[PLAYER_X];
        const frames = 8;
        const trace = simulateWalk(SW_SPEED_SUB_X, frames);
        const cumulative = trace.reduce((a, b) => a + b, 0);
        nes.buttonDown(1, RIGHT);
        for (let i = 0; i < frames; i++) nes.frame();
        nes.buttonUp(1, RIGHT);
        assert.equal(mem[PLAYER_X], startX + cumulative, 'ordinary walking speed/cadence on a streamed map must be exactly what it always was');
        guard.assertNone('distinct-state (c) ordinary walking speed, ordinary design-rate workload');
        guard.unwatch();
      }
    });

    // Fix round 1: write the accumulated strip-state tallies out for the fix report to quote --
    // the same idle(0)/col(1)/row(2) shape the round-1 review's own strip-summary.json used.
    fs.mkdirSync(path.join(ROOT, 'handoff-next', 'fix1-evidence'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'handoff-next', 'fix1-evidence', 'strip-summary.json'), JSON.stringify(stripTally, null, 2));
  });

  await t.test('sw_event_freeze: the frame interact opens a conversation, the player does not also step', async () => {
    const project = createStreamedProject({});
    const actorId = project.sprites.actors.length;
    project.sprites.actors.push({ name: 'Talker', behavior: 'npc', hp: 1, damage: 0 });
    const screen = project.maps[0].screens[0];
    screen.entities = screen.entities ?? [];
    // player starts at (120,112) -- REACH_RANGE=20, so a few pixels away is comfortably in reach.
    screen.entities.push({
      actorId,
      x: 124,
      y: 112,
      props: {
        // Not 'say' -- validateProject refuses a Say/Ask command on any entity placed on a
        // streamed screen (shared/project.js's own Item 4 rule, "shows text ... which a streamed
        // screen cannot yet"). A lone setSwitch was tried first and found the event finishes
        // synchronously within the same frame start_dialog opens it (no text box to wait on),
        // so game_state is already back to ST_GAMEPLAY by the time this test's own frame() call
        // returns -- Wait holds the page open for real, without showing any text, so ST_DIALOG
        // is still the read game_state on the very frame this test checks.
        trigger: 'interact',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'wait', frames: 10 }] }] }
      }
    });
    const { nes, mem, guard } = await buildAndBoot(project);
    const xBefore = mem[PLAYER_X];
    nes.buttonDown(1, RIGHT);
    nes.buttonDown(1, B);
    nes.frame();
    assert.equal(mem[GAME_STATE], ST_DIALOG, 'pressing interact next to the NPC must open a conversation this frame');
    assert.equal(mem[PLAYER_X], xBefore, 'the player must not also move on the frame the conversation opens');
    nes.buttonUp(1, RIGHT);
    nes.buttonUp(1, B);
    guard.assertNone('sw_event_freeze: interact opens conversation, ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('an interact press that finds nobody in reach does not freeze movement', async () => {
    const project = createStreamedProject({});
    const { nes, mem, guard } = await buildAndBoot(project);
    const xBefore = mem[PLAYER_X];
    nes.buttonDown(1, RIGHT);
    nes.buttonDown(1, B);
    nes.frame();
    assert.notEqual(mem[GAME_STATE], ST_DIALOG, 'no NPC is in reach -- no conversation should open');
    assert.notEqual(mem[PLAYER_X], xBefore, 'pressing interact into empty space must not freeze a frame that never needed it');
    nes.buttonUp(1, RIGHT);
    nes.buttonUp(1, B);
    guard.assertNone('interact finds nobody, ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('sw_event_freeze survives within the SAME frame it is armed: a held direction plus a Flash-only interact must not also step', async () => {
    // Distinct from the two tests above: neither held a direction at the same time as the
    // interact press, so neither actually exercised what sw_event_freeze exists for. OP_FLASH
    // finishes synchronously (engine/script.asm's own comment) -- game_state is already back to
    // ST_PLAYING by the time this frame's own update_player runs, so ONLY sw_event_freeze (armed
    // by do_talk inside dispatch_input, checked by sw_update_player later the same frame, cleared
    // at the very end of the frame in main_loop_idle) stops the held direction from also being
    // applied on this exact frame. A build that clears the latch too early -- e.g. right after
    // dispatch_input itself, before update_player ever reads it -- passes both tests above yet
    // still lets the player also step on this frame; only this test tells the two apart.
    const project = createStreamedProject({});
    const actorId = project.sprites.actors.length;
    project.sprites.actors.push({ name: 'Flasher', behavior: 'npc', hp: 1, damage: 0 });
    const screen = project.maps.find((m) => m.streamed).screens[0];
    screen.entities = screen.entities ?? [];
    screen.entities.push({
      actorId,
      x: 124,
      y: 112,
      props: {
        trigger: 'interact',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'flash' }] }] }
      }
    });
    const { nes, mem, guard } = await buildAndBoot(project);
    const xBefore = mem[PLAYER_X];
    nes.buttonDown(1, RIGHT);
    nes.buttonDown(1, B);
    nes.frame();
    assert.notEqual(mem[GAME_STATE], ST_DIALOG, 'OP_FLASH must not open a dialog box');
    assert.equal(
      mem[PLAYER_X],
      xBefore,
      'the player must not also step on the exact frame a held-direction interact triggers a synchronous Flash event'
    );
    nes.buttonUp(1, RIGHT);
    nes.buttonUp(1, B);
    guard.assertNone('sw_event_freeze survives within same frame (Flash), ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('sw_event_freeze is cleared every frame in main_loop_idle', async () => {
    const project = createStreamedProject({});
    const { nes, mem, guard } = await buildAndBoot(project);
    nes.frame();
    assert.equal(mem[SW_EVENT_FREEZE], 0, 'sw_event_freeze must read 0 on an ordinary frame');
    guard.assertNone('sw_event_freeze cleared every frame, ordinary design-rate workload');
    guard.unwatch();
  });
});

// Phase 2 slice 4b, orchestrator ruling 9: player_hazard's own straddling-collision probe.
// docs/design-streamed-worlds.md §6's "natural ownership rectangle" lets a SCRIPTED player Move
// reach x up to 255 / y up to 239 -- wider than held movement's own MAX_X/MAX_Y wall -- so
// player_hazard's own player_x+8/player_y+12 probe point can genuinely land past the current
// streamed screen's own edge. metatile id 2 is given `damage` collision (matching
// test/lib/streamedproject.js's own streamedScreen formula: screen(col=1,row=0)'s offset 0 is
// `1 + ((1+0+0) % 3)` = 2), so the neighbour screen immediately to the right of the landing
// screen (0,0) carries a real hazard at its own offset 0 -- everything else stays the fixture's
// ordinary varied-then-fill pattern, so a same-screen probe is unaffected.
async function buildHazardProject() {
  const project = createStreamedProject({});
  project.metatiles[2].collision = 'damage';
  return project;
}

async function buildAndBootWithSymbols(project) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworldhazard-'));
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
  // Fix round 3, finding 2: same watcher, installed the same way buildAndBoot's own now is.
  const guard = watchPositionJumpGuard(nes, symbols);
  let frames = 0;
  while ((mem[GAME_STATE] !== ST_GAMEPLAY || mem[MAP_IS_STREAMED] !== 1) && frames < 200) {
    nes.frame();
    frames++;
  }
  assert.ok(frames < 200, 'cold boot must reach ST_GAMEPLAY well within 200 frames');
  for (let i = 0; i < 100; i++) nes.frame();
  // Opt-out (fix round 4, item 3): every caller of this helper drives its own probe with a single
  // callRoutine dispatch (or a direct RAM poke + one hurt_player call via triggerFloorHit), never a
  // further nes.frame() loop -- a synthetic direct-call routine probe, not an ordinary frame-driven
  // movement workload the guard is meant to police, so its callers legitimately never assert
  // guard.assertNone. The guard is still returned (unused by every caller) rather than removed, so a
  // caller that changes shape to drive real frames regains it for free.
  return { dir, nes, mem, addrOf, guard };
}

// Opt-out (fix round 4, item 3), every subtest in this file's own block: each is a synthetic
// direct-call routine probe (a single callRoutine dispatch into sw_hazard_probe_type/player_hazard
// after a RAM poke), never a further nes.frame() loop -- buildAndBootWithSymbols's own returned
// guard is unused here, per its header comment.
test('sw_hazard_probe_type (phase 2 slice 4b, orchestrator ruling 9)', { skip: !hasNesasm && 'nesasm not on PATH' }, async (t) => {
  await t.test('same-screen probe (dx=0, dy=0) matches probe_type on the current screen -- the "same" fallthrough, a control', async () => {
    const project = await buildHazardProject();
    const { dir, nes, mem, addrOf } = await buildAndBootWithSymbols(project);
    try {
      assert.equal(mem[SW_COL], 0, 'precondition: landed on screen col 0');
      assert.equal(mem[SW_ROW], 0, 'precondition: landed on screen row 0');
      const swHazardProbeType = addrOf('sw_hazard_probe_type');
      // Screen (0,0)'s own offset 0: 1 + ((0+0+0) % 3) = 1 -- open (only id 2 was set to damage).
      mem[PROBE_X] = 5; // block col 0
      mem[PROBE_Y] = 5; // block row 0 (top-left 16x16 block, offset 0)
      nes.cpu.REG_Y = 0; // dx = 0
      callRoutine(nes, swHazardProbeType);
      assert.equal(nes.cpu.REG_ACC, COL_OPEN, 'screen(0,0) offset 0 is metatile id 1 (open), not the damage tile');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('dx=1 straddle: the probe crosses into the right-hand neighbour screen and reads its real damage tile', async () => {
    const project = await buildHazardProject();
    const { dir, nes, mem, addrOf } = await buildAndBootWithSymbols(project);
    try {
      const swHazardProbeType = addrOf('sw_hazard_probe_type');
      mem[PROBE_X] = 5; // already-wrapped local x on the TARGET screen, block col 0
      mem[PROBE_Y] = 5; // block row 0, offset 0
      nes.cpu.REG_Y = 1; // dx = 1: the caller's own probe_x add carried past 255
      callRoutine(nes, swHazardProbeType);
      assert.equal(
        nes.cpu.REG_ACC,
        COL_DAMAGE,
        'screen(1,0) offset 0 is metatile id 2, given damage collision -- the straddling read must reach the REAL neighbour screen, not the fill tile'
      );
      assert.equal(mem[PROBE_Y], 5, 'a pure dx crossing must leave probe_y untouched (only a dy>=240 crossing normalizes it)');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('dy=1 straddle (probe_y >= 240): probe_y is normalized in place (-240) and the row-neighbour screen is read', async () => {
    const project = await buildHazardProject();
    const { dir, nes, mem, addrOf } = await buildAndBootWithSymbols(project);
    try {
      const swHazardProbeType = addrOf('sw_hazard_probe_type');
      // Screen (0,1)'s own offset 0: 1 + ((0+1+0) % 3) = 2 -- also the damage id, so this probes
      // the DOWN neighbour rather than reusing the right neighbour's own coincidental id.
      mem[PROBE_X] = 5; // block col 0
      mem[PROBE_Y] = 245; // 245 - 240 = 5 -> block row 0 on the neighbour, offset 0
      nes.cpu.REG_Y = 0; // dx = 0 -- only the y crossing is live here
      callRoutine(nes, swHazardProbeType);
      assert.equal(nes.cpu.REG_ACC, COL_DAMAGE, 'screen(0,1) offset 0 is metatile id 2, given damage collision');
      assert.equal(mem[PROBE_Y], 5, 'probe_y must be normalized to 245-240=5 in place');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('uses sw_col/sw_row, NOT win_col_screen/win_row_screen -- a forced window-arm lag must not misresolve the target screen', async () => {
    // sw_move_probe (phase 2 slice 3, unchanged by this slice) targets
    // win_col_screen/win_row_screen instead; this file's own progress notes flag that as a
    // possible latent divergence risk now that slice 4b's own window-arm mechanism
    // (sw_win_col_inc/dec) can lag win_col_screen behind sw_col by design. This test proves
    // sw_hazard_probe_type does NOT share that risk: win_col_screen is forced to a value that
    // would resolve the WRONG neighbour screen if it were used, while sw_col (the player's own
    // real current screen) is left at its correct post-landing value.
    const project = await buildHazardProject();
    const { dir, nes, mem, addrOf } = await buildAndBootWithSymbols(project);
    try {
      const swHazardProbeType = addrOf('sw_hazard_probe_type');
      assert.equal(mem[SW_COL], 0, 'precondition: sw_col is really 0 post-landing');
      mem[WIN_COL_SCREEN] = 99; // deliberately wrong -- were this the base, target col would be 100
      mem[PROBE_X] = 5;
      mem[PROBE_Y] = 5;
      nes.cpu.REG_Y = 1; // dx = 1 -- target should be sw_col+1 = 1, the real neighbour
      callRoutine(nes, swHazardProbeType);
      assert.equal(
        nes.cpu.REG_ACC,
        COL_DAMAGE,
        'a wrong win_col_screen must not affect the result -- the routine must still resolve screen(1,0) (sw_col+1), not screen(100,0) or the fill tile'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('end-to-end: player_hazard fires through the straddling probe when the player is at the scripted-Move-only fringe (x=255)', async () => {
    const project = await buildHazardProject();
    const { dir, nes, mem, addrOf } = await buildAndBootWithSymbols(project);
    try {
      const playerHazard = addrOf('player_hazard');
      assert.equal(mem[SW_COL], 0, 'precondition: landed on screen col 0');
      assert.equal(mem[SW_ROW], 0, 'precondition: landed on screen row 0');
      // player_x=255: probe_x = 255+8 = 263 -> wraps to 7 with carry (dx=1), a legal resting spot
      // in the wide 0-255 ownership rectangle held movement can now also reach (fix round 1, ruling
      // C), reached here directly by poking RAM rather than walking there. player_y=0: probe_y =
      // 0+12 = 12, block row 0
      // (12 & $F0 = 0), dy=0 -- isolates the dx=1 straddle alone. Target screen (sw_col+1,
      // sw_row) = (1,0), offset = 0 (block row 0) + 0 (block col 0, since probe_x=7 -> 7>>4=0) =
      // 0 -- metatile id 1+((1+0+0)%3)=2, the id this fixture gave damage collision.
      mem[PLAYER_X] = 255;
      mem[PLAYER_Y] = 0;
      mem[PLAYER_IFRAMES] = 0;
      const hpBefore = mem[PLAYER_HP];
      callRoutine(nes, playerHazard);
      assert.equal(mem[PLAYER_HP], hpBefore - 1, 'the real straddling hazard must land a hit (party_damage/hurt_player), not silently pass through the neighbour screen as open');
      assert.equal(mem[PLAYER_IFRAMES], 60, 'a landed hit sets IFRAME_TIME (60), confirming hurt_player actually ran');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('player_hazard_dispatch: map_is_streamed=0 must route through ordinary probe_type, never sw_hazard_probe_type, even at the straddling fringe', async () => {
    // Same fringe geometry as the end-to-end test above (player_x=255, dx=1 would resolve
    // screen(1,0)'s real damage tile through sw_hazard_probe_type) -- but with map_is_streamed
    // forced to 0, simulating the player standing on an ORDINARY map of a mixed project.
    // player_hazard_dispatch's own `lda map_is_streamed / beq player_hazard_probe_same` gate
    // (engine/combat.asm) exists precisely so this case never reaches sw_hazard_probe_type at
    // all: an ordinary map has no real "neighbour screen" for sw_col/sw_row to resolve, so the
    // probe must fall back to plain probe_type against the currently loaded mtptr, reading the
    // wrapped local position (7, 12) on the SAME (landing) screen -- block (0,0), metatile id 1,
    // COL_OPEN -- not screen(1,0)'s damage tile. A build that drops this gate reaches the exact
    // same neighbour-screen damage hit the end-to-end test above expects, indistinguishable from
    // it except for this one flag.
    const project = await buildHazardProject();
    const { dir, nes, mem, addrOf } = await buildAndBootWithSymbols(project);
    try {
      const playerHazard = addrOf('player_hazard');
      assert.equal(mem[SW_COL], 0, 'precondition: landed on screen col 0');
      mem[MAP_IS_STREAMED] = 0;
      mem[PLAYER_X] = 255;
      mem[PLAYER_Y] = 0;
      mem[PLAYER_IFRAMES] = 0;
      const hpBefore = mem[PLAYER_HP];
      callRoutine(nes, playerHazard);
      assert.equal(
        mem[PLAYER_HP],
        hpBefore,
        'map_is_streamed=0 must read the current (same) screen via ordinary probe_type, not manufacture a hit off screen(1,0)\'s real damage tile through sw_hazard_probe_type'
      );
      assert.equal(mem[PLAYER_IFRAMES], 0, 'hurt_player must not have run');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('negative control: the same fringe position but no damage tile on the neighbour screen leaves the player untouched', async () => {
    // No metatiles.collision override at all here -- screen(1,0) offset 0 stays whatever
    // createMetatile's own default ('open') leaves it, so this is the exact same geometry as the
    // test above with the one variable (the neighbour's real collision type) changed. An actor
    // with damage>0 forces COMBAT_ENABLED on (projectUsesCombat, shared/font.js) the same way the
    // damage metatile did above, without touching any metatile's own collision -- otherwise
    // player_hazard's very first check (`lda #COMBAT_ENABLED / beq player_hazard_done`) would
    // return before ever reaching the straddling probe this test means to exercise.
    const project = createStreamedProject({});
    project.sprites.actors.push({ name: 'Biter', behavior: 'npc', hp: 1, damage: 1 });
    const { dir, nes, mem, addrOf } = await buildAndBootWithSymbols(project);
    try {
      const playerHazard = addrOf('player_hazard');
      mem[PLAYER_X] = 255;
      mem[PLAYER_Y] = 0;
      mem[PLAYER_IFRAMES] = 0;
      const hpBefore = mem[PLAYER_HP];
      callRoutine(nes, playerHazard);
      assert.equal(mem[PLAYER_HP], hpBefore, 'no damage tile on the neighbour screen -- the straddling probe must not manufacture a hit');
      assert.equal(mem[PLAYER_IFRAMES], 0, 'hurt_player must not have run');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Fix round 2, findings A and B (handoff-next/review-phase2-s4b-round2-findings.md): permanent,
// assertion-level regression coverage for sw_pstep_up/sw_pstep_down's corner probing. A wrong
// implementation that probes diagonal corners (Down: top-left/bottom-right instead of both
// bottom; Up: top-left/bottom-right instead of both top) passes every flat-terrain crossing test
// elsewhere in this file -- only an isolated wall under exactly one leading corner tells the two
// apart, which is why ruling J requires this as its own test rather than folded into an existing
// crossing case.
test('streamed vertical movement corner probing (fix round 2, findings A/B)', { skip: !hasNesasm && 'nesasm not on PATH' }, async (t) => {
  // Builds a 3x3 streamed grid, landed on the center screen (index 4, row 1 col 1), with every
  // screen's terrain cleared to metatile id 0 (collision 'open') and metatile id 1 set 'solid'.
  // `col`/`row` place the one solid tile within the center screen's own 16x15 metatile grid (16px
  // metatiles: 16 columns, 15 rows across the 240-row terrain).
  async function buildWallScenario({ startY, col, row }) {
    const project = createStreamedProject({ gridW: 3, gridH: 3 });
    for (const s of project.maps[0].screens) s.metatiles.fill(0);
    project.metatiles[0].collision = 'open';
    project.metatiles[1].collision = 'solid';
    project.project.startScreen = 4;
    project.project.startX = 8;
    project.project.startY = startY;
    project.maps[0].screens[4].metatiles[row * 16 + col] = 1;
    return buildAndBoot(project);
  }

  await t.test('down-left-wall: a solid tile under the LEFT leading corner (BODY_L, BODY_B) blocks Down -- the diagonal-probe bug missed this by checking BODY_T there instead', async () => {
    const { nes, mem, guard } = await buildWallScenario({ startY: 32, col: 0, row: 3 });
    const before = mem[PLAYER_Y];
    nes.buttonDown(1, DOWN);
    nes.frame();
    assert.equal(mem[PLAYER_Y], before, 'a solid tile under the left BODY_B corner must block Down entirely');
    guard.assertNone('down-left-wall, ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('down-right-wall: a solid tile under the RIGHT leading corner (BODY_R, BODY_B) blocks Down -- a positive control the diagonal-probe bug already passed by accident', async () => {
    const { nes, mem, guard } = await buildWallScenario({ startY: 32, col: 1, row: 3 });
    const before = mem[PLAYER_Y];
    nes.buttonDown(1, DOWN);
    nes.frame();
    assert.equal(mem[PLAYER_Y], before, 'a solid tile under the right BODY_B corner must block Down');
    guard.assertNone('down-right-wall, ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('up-right-wall: a solid tile under the RIGHT leading corner (BODY_R, BODY_T) blocks Up -- the diagonal-probe bug missed this by checking BODY_B there instead', async () => {
    const { nes, mem, guard } = await buildWallScenario({ startY: 40, col: 1, row: 2 });
    const before = mem[PLAYER_Y];
    nes.buttonDown(1, UP);
    nes.frame();
    assert.equal(mem[PLAYER_Y], before, 'a solid tile under the right BODY_T corner must block Up entirely');
    guard.assertNone('up-right-wall, ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('up-left-wall: a solid tile under the LEFT leading corner (BODY_L, BODY_T) blocks Up -- a positive control the diagonal-probe bug already passed by accident', async () => {
    const { nes, mem, guard } = await buildWallScenario({ startY: 40, col: 0, row: 2 });
    const before = mem[PLAYER_Y];
    nes.buttonDown(1, UP);
    nes.frame();
    assert.equal(mem[PLAYER_Y], before, 'a solid tile under the left BODY_T corner must block Up');
    guard.assertNone('up-left-wall, ordinary design-rate workload');
    guard.unwatch();
  });

  // Ruling K's own explicit requirement: an up-seam crossing must move IDENTICALLY whether or not
  // an entity sits on the incoming screen. Before the fix, adding an unrelated NPC to the
  // incoming screen's entity list changed the outcome -- the unnormalized probe (player_y=239,
  // +BODY_T/BODY_B without renormalizing past 240) read offset 247/254 into the SCREEN RECORD,
  // which is entity-count metadata, not terrain, and a nonzero entity count was misread as solid
  // metatile id 1.
  await t.test('up-seam-empty and up-seam-actor cross identically -- an incoming screen\'s entity count must never be read as collision', async () => {
    async function buildSeamScenario(withActor) {
      const project = createStreamedProject({ gridW: 3, gridH: 3 });
      for (const s of project.maps[0].screens) s.metatiles.fill(0);
      project.metatiles[0].collision = 'open';
      // metatile id 1 is deliberately 'solid' -- matching the reviewer's own
      // review-s4b-round2-collision-repro.mjs exactly: this is what makes a misread garbage byte
      // that happens to equal 1 (an entity count) actually manifest as a blocked probe instead of
      // silently reading as open by mt_collision's own default, which would make this test blind
      // to the bug it exists to catch.
      project.metatiles[1].collision = 'solid';
      project.project.startScreen = 4;
      project.project.startX = 8;
      project.project.startY = 0;
      if (withActor) {
        project.sprites.actors.push({ name: 'Unrelated', behavior: 'npc', hp: 1, damage: 0 });
        project.maps[0].screens[1].entities = [{ actorId: 0, x: 100, y: 100, props: {} }];
      }
      return buildAndBoot(project);
    }
    const empty = await buildSeamScenario(false);
    const actor = await buildSeamScenario(true);
    const state = (mem) => ({ row: mem[SW_ROW], x: mem[PLAYER_X], y: mem[PLAYER_Y], flat: mem[FLAT_SCREEN] });
    assert.deepEqual(state(empty.mem), state(actor.mem), 'preconditions must match before either press');
    empty.nes.buttonDown(1, UP);
    empty.nes.frame();
    actor.nes.buttonDown(1, UP);
    actor.nes.frame();
    assert.deepEqual(
      state(actor.mem),
      state(empty.mem),
      'an unrelated entity on the incoming screen must never change whether/where the crossing lands'
    );
    assert.equal(state(empty.mem).row, 0, 'the empty-screen control itself must actually have crossed row 1 -> 0');
    empty.guard.assertNone('up-seam-empty (control), ordinary design-rate workload');
    empty.guard.unwatch();
    actor.guard.assertNone('up-seam-actor (crossing with an unrelated incoming entity), ordinary design-rate workload');
    actor.guard.unwatch();
  });
});

// Ruling N (round-1 finding 6's own remainder, closed in fix round 2): high unsigned
// world-coordinate driver cases, an independent geometric containment check, and individual
// real-driver-armed NMI arbitration cases. "Real-driver-armed" means every strip in this section
// is armed by an actual held direction through sw_win_arm, the same as ordinary gameplay -- never
// the RAM-poke/direct-routine-injection technique streamworldnmi.test.js uses (that file predates
// phase 2 slice 4b's movement driver and has no other way to arm one).
// A direct RAM poke of vram_open/vram_push/vram_end's own documented packet layout
// (engine/text.asm: addr hi, addr lo, count, then `count` payload bytes, then a 0 terminator;
// vram_len is the running total, vram_ready gates the drain) -- deliberately NOT callRoutine,
// which forces $2000 (NMI generation) off as its own documented side effect
// (test/lib/callroutine.js) and never restores it. streamworldnmi.test.js can use callRoutine
// freely because it never calls nes.frame() again afterward; every test in this section keeps
// driving the real game loop with ordinary nes.frame() calls after queuing a packet, so leaving
// $2000 clobbered mid-loop crashed the CPU into unmapped memory the first time this was tried.
function queuePacket(mem, { addr, payload }) {
  const VRAM_BUF = 0x0400;
  mem[VRAM_BUF] = (addr >> 8) & 0xff;
  mem[VRAM_BUF + 1] = addr & 0xff;
  mem[VRAM_BUF + 2] = payload.length & 0xff;
  for (let i = 0; i < payload.length; i++) mem[VRAM_BUF + 3 + i] = payload[i];
  mem[VRAM_BUF + 3 + payload.length] = 0;
  mem[VRAM_LEN] = 3 + payload.length;
  mem[VRAM_READY] = 1;
}

test('streamed movement: high coordinates, geometric containment, real-driver-armed NMI arbitration (ruling N)', { skip: !hasNesasm && 'nesasm not on PATH' }, async (t) => {
  await t.test('high unsigned world-coordinate driver case: a held Right crossing at swCol=150->151 (well past the 8th-bit/sign boundary) matches the independently computed oracle every frame', async () => {
    // The column axis, not the row axis: checkCapacity's own region packing (one 8 KB region per
    // GRID ROW, measured empirically against the real buildAndBoot path while writing this test --
    // a plain gridH=140 single-column grid refuses to build on UNROM 512's 61 available regions,
    // even though gridW=180/gridH=1 builds cleanly) caps sw_row at 60 in any real project, so a
    // row-axis case could never exercise sw_row > 127 at all. sw_col carries no such ceiling.
    const project = createStreamedProject({ gridW: 180, gridH: 1 });
    project.project.startScreen = 150; // gridH=1, so screen index === col
    project.project.startX = 8;
    project.project.startY = 112;
    const { nes, mem, guard } = await buildAndBoot(project);
    let oracle = { playerX: mem[PLAYER_X], swCol: mem[SW_COL], acc: 0 };
    assert.equal(oracle.swCol, 150, 'precondition: landed at the high column this case means to exercise');
    nes.buttonDown(1, RIGHT);
    let crossed = false;
    for (let i = 0; i < 220; i++) {
      nes.frame();
      oracle = predictHorizontalStep({ playerX: oracle.playerX, acc: oracle.acc, swCol: oracle.swCol, gridW: 180, dir: 'right' });
      assert.equal(mem[PLAYER_X], oracle.playerX, `frame ${i}: player_x`);
      assert.equal(mem[SW_COL], oracle.swCol, `frame ${i}: sw_col`);
      if (oracle.swCol === 151) crossed = true;
    }
    assert.ok(crossed, 'the walk must actually have crossed swCol 150 -> 151 within the frame budget');
    nes.buttonUp(1, RIGHT);
    guard.assertNone('high unsigned world-coordinate crossing, ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('independent geometric containment check: the visible camera-pixel rectangle stays a subset of the completed-content window rectangle (contract §5) on every single frame of a long walk in each direction', async () => {
    // Round-3 finding 3: the prior version of this test only checked the world-pixel POSITION
    // against the grid's own outer bounds -- never read camera origin, window origin, strip
    // axis/direction or completion state, so it could not tell "the player is somewhere on the
    // map" from "the screen the player is looking at is actually safe to show". makeContainmentChecker
    // (above) computes the real two-rectangle subset test contract §5 defines instead.
    const gridW = 3, gridH = 3;
    const project = createStreamedProject({ gridW, gridH });
    project.project.startScreen = 4; // center: (1,1)
    project.project.startX = 120;
    project.project.startY = 112;
    const { nes, mem, guard } = await buildAndBoot(project);
    const assertContained = makeContainmentChecker(mem, { gridW, gridH });
    assertContained('landing');
    for (const dir of [LEFT, UP, RIGHT, DOWN]) {
      nes.buttonDown(1, dir);
      for (let i = 0; i < 120; i++) {
        nes.frame();
        assertContained(`dir ${dir} frame ${i}`);
      }
      nes.buttonUp(1, dir);
    }
    guard.assertNone('independent geometric containment check, ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('next-NMI-first: the NMI immediately following a real arm is the first to service it -- no frame is ever wasted with st_active already set and nothing drawn', async () => {
    // jsnes' own nes.frame() boundary runs that frame's NMI BEFORE that frame's mainline
    // instructions (confirmed empirically: st_cur reads 0 in the very call that first shows
    // st_active nonzero, since mainline -- which arms the strip -- runs after that call's own
    // NMI). The arming mainline instruction therefore belongs to frame N, and the strip's own
    // first possible servicing opportunity is frame N+1's NMI -- this test's job is to prove that
    // opportunity is never missed (no frame N+1, N+2, ... goes by with st_active set and st_cur
    // unmoved).
    const project = createStreamedProject({});
    const { nes, mem, guard } = await buildAndBoot(project);
    nes.buttonDown(1, RIGHT);
    let armedAtFrame = null;
    for (let i = 0; i < 200 && armedAtFrame === null; i++) {
      const before = mem[ST_ACTIVE];
      nes.frame();
      if (before === 0 && mem[ST_ACTIVE] !== 0) armedAtFrame = i;
    }
    assert.ok(armedAtFrame !== null, 'a strip must have armed within 200 frames of continuous walking');
    assert.equal(mem[ST_CUR], 0, 'precondition: the arming frame\'s own NMI (which ran before that frame\'s mainline armed the strip) must not have drawn anything yet');
    const stLen = mem[ST_LEN];
    nes.frame();
    const expected = Math.min(3, stLen);
    assert.equal(mem[ST_CUR], expected, `the very next frame's NMI (the first one to run after arming) must already have drawn min(SW_STREAM_CHUNK, st_len) = ${expected} blocks`);
    nes.buttonUp(1, RIGHT);
    guard.assertNone('next-NMI-first, ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('mixed chunk 2 at <=35 bytes: a real 35-byte vram_buf packet drains AND the real-armed strip still advances by SW_STREAM_MIXED_CHUNK (2) that same frame', async () => {
    const project = createStreamedProject({});
    const { nes, mem, guard } = await buildAndBoot(project);
    nes.buttonDown(1, RIGHT);
    let armed = false;
    for (let i = 0; i < 200 && !armed; i++) {
      const before = mem[ST_ACTIVE];
      nes.frame();
      if (before === 0 && mem[ST_ACTIVE] !== 0) armed = true;
    }
    assert.ok(armed, 'a strip must have armed within 200 frames');
    nes.buttonUp(1, RIGHT);
    assert.equal(mem[ST_CUR], 0, 'precondition: this arming frame\'s own NMI must not have drawn anything yet (see the next-NMI-first test above)');
    const curBefore = mem[ST_CUR];
    assert.ok(mem[ST_LEN] - curBefore >= 2, 'precondition: at least 2 blocks must remain for this test to distinguish 2 from 0');
    // 3 (header: addr hi/lo + length) + 32 payload bytes = 35, the documented threshold itself.
    // Queued between frame() calls, standing in for a real producer (Flash, a bound tile, ...)
    // whose own packet-building code ran during this same mainline frame, ready for the very next
    // NMI -- the same "next NMI first" servicing point the test above already established.
    queuePacket(mem, { addr: 0x2164, payload: new Array(32).fill(0xaa) });
    nes.frame();
    assert.equal(mem[ST_CUR], curBefore + 2, 'a <=35-byte producer frame must still advance the strip by exactly SW_STREAM_MIXED_CHUNK (2)');
    assert.equal(mem[VRAM_READY], 0, 'the real 35-byte packet must have fully drained in the same frame');
    guard.assertNone('mixed chunk <=35 bytes, ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('exclusive drain above 35 bytes: a real 36-byte vram_buf packet still drains, but the real-armed strip is stalled (0 blocks) that frame', async () => {
    const project = createStreamedProject({});
    const { nes, mem, guard } = await buildAndBoot(project);
    nes.buttonDown(1, RIGHT);
    let armed = false;
    for (let i = 0; i < 200 && !armed; i++) {
      const before = mem[ST_ACTIVE];
      nes.frame();
      if (before === 0 && mem[ST_ACTIVE] !== 0) armed = true;
    }
    assert.ok(armed, 'a strip must have armed within 200 frames');
    nes.buttonUp(1, RIGHT);
    const curBefore = mem[ST_CUR];
    assert.ok(mem[ST_LEN] - curBefore >= 1, 'precondition: at least 1 block must remain for the stall to be observable');
    // 3 (header) + 33 payload bytes = 36, one byte past the documented threshold.
    queuePacket(mem, { addr: 0x2164, payload: new Array(33).fill(0xaa) });
    nes.frame();
    assert.equal(mem[ST_CUR], curBefore, 'a >35-byte producer frame must stall the strip entirely (0 blocks), not merely slow it');
    assert.equal(mem[VRAM_READY], 0, 'the real 36-byte packet must still have fully drained despite the strip stall -- the producer itself is never starved');
    guard.assertNone('exclusive drain >35 bytes, ordinary design-rate workload');
    guard.unwatch();
  });

  await t.test('active strip serviced while the world is frozen: `paused` stops the player, never the NMI strip drain (docs/reference-engine.md: "st_active alone gates the strip drawer, never game_state/paused")', async () => {
    const project = createStreamedProject({});
    const { nes, mem, guard } = await buildAndBoot(project);
    nes.buttonDown(1, RIGHT);
    let curAtArm = null;
    let lenAtArm = null;
    for (let i = 0; i < 200 && curAtArm === null; i++) {
      const before = mem[ST_ACTIVE];
      nes.frame();
      if (before === 0 && mem[ST_ACTIVE] !== 0) {
        curAtArm = mem[ST_CUR];
        lenAtArm = mem[ST_LEN];
      }
    }
    assert.ok(curAtArm !== null, 'a strip must have armed within 200 frames');
    assert.ok(lenAtArm - curAtArm >= 6, 'precondition: enough blocks must remain to see multiple frames of continued draining');
    nes.buttonUp(1, RIGHT);
    const playerXFrozen = mem[PLAYER_X];
    mem[PAUSED] = 1;
    let cur = curAtArm;
    for (let i = 0; i < 3 && mem[ST_ACTIVE] !== 0; i++) {
      nes.frame();
      assert.ok(mem[ST_CUR] > cur, `frame ${i} while paused: st_cur must still advance (${cur} -> ${mem[ST_CUR]})`);
      cur = mem[ST_CUR];
      assert.equal(mem[PLAYER_X], playerXFrozen, `frame ${i} while paused: player_x must stay frozen -- the world, not the strip, is what "paused" freezes`);
    }
    assert.ok(cur > curAtArm, 'the strip must have made real progress across the paused frames, not merely held st_active nonzero');
    guard.assertNone('active strip serviced while paused, ordinary design-rate workload');
    guard.unwatch();
  });
});

// Controller Forge: the dash label reads exactly the required string on a project with any
// streamed map, and stays the ordinary ENGINE_SUPPORT text on a project with none -- pure-JS,
// needs no nesasm build, so ungated by hasNesasm.
test('Controller Forge dash detail (phase 2 slice 4b, orchestrator ruling 8)', async (t) => {
  await t.test('a project with a streamed map: dash detail reads exactly the required string', () => {
    const project = createStreamedProject({});
    assert.ok(project.maps.some((m) => m.streamed), 'fixture sanity: createStreamedProject must produce a streamed map');
    assert.equal(actionDetail(project, 'dash', 'gameplay'), 'The engine ignores dash on a streamed map.');
  });

  await t.test('control: an ordinary project (no streamed map) keeps the normal dash detail', () => {
    const project = createProject('Ordinary Test', 'action');
    assert.ok(!project.maps.some((m) => m.streamed), 'fixture sanity: createProject must produce no streamed map');
    assert.equal(actionDetail(project, 'dash', 'gameplay'), 'Doubles walking speed for as long as the button is held.');
  });

  // Fix round 1, finding 8: streamed-worlds-phase2-plan.md:830-831 requires this exact override
  // "regardless of state", not only in the gameplay row where dash is otherwise supported -- a
  // project can bind dash to a button in ANY state's row (dispatch_input/engine/input.asm reads
  // every state's own action table the same way), so every editable row deserves the same
  // true-but-more-specific reason, not the generic static IGNORED fallback.
  await t.test('the streamed dash override applies in every state where the dash row is editable, not only gameplay', () => {
    const project = createStreamedProject({});
    for (const stateName of ['menu', 'dialog', 'title', 'nameentry']) {
      assert.equal(
        actionDetail(project, 'dash', stateName),
        'The engine ignores dash on a streamed map.',
        `dash bound in ${stateName} on a streamed project must read the streamed-specific reason, not the generic fallback`
      );
    }
  });

  await t.test('control: an ordinary project (no streamed map) keeps the static per-state fallback outside gameplay', () => {
    const project = createProject('Ordinary Test', 'action');
    assert.equal(actionDetail(project, 'dash', 'menu'), null);
    assert.equal(actionDetail(project, 'dash', 'dialog'), null);
  });

  await t.test('a locked slot (Start on the title) overrides even a streamed dash row', () => {
    const project = createStreamedProject({});
    assert.equal(
      actionDetail(project, 'dash', 'gameplay', { locked: true }),
      'Always begins the game — the one binding that cannot be taken away.'
    );
  });
});

// Phase 2 slice 4b, plan's own "Discharge tests for obligations 1/2": the containment/retention
// matrix -- reversals, both entering-edge signs, axis handoff, clamp edges, 1x1/1xN/Nx1/2-screen
// axis configurations, and repeated interact-Flash. Every case drives the real ROM under jsnes and
// asserts real engine RAM, the same discipline the rest of this file already uses -- no
// self-comparison, no prototype figures reused as acceptance constants.
test(
  'containment/retention matrix (phase 2 slice 4b, discharge tests for obligations 1/2)',
  { skip: !hasNesasm && 'nesasm not on PATH' },
  async (t) => {
    // -------------------------------------------------- both entering-edge signs
    //
    // Round-3 gate closure (task 3), NEEDS-RULING: this test and 'entering edge, negative sign
    // (vertical): crossing up' below both genuinely FAIL their own assertContained calls, on the
    // real, unmodified engine, with no sabotage applied. This is not a bug in the checker -- it is
    // the checker correctly catching a real boot-time containment violation. Measured
    // (scratchpad probes modelled on this exact test's own project shape, gridW=3 default,
    // startScreen=1, startX=5): sw_frame_camera_window publishes a landing PLACEHOLDER camera
    // origin (camPx=256, screen-aligned to the landing screen, matching the window's own initial
    // placement exactly -- margin 0) for the boot draw's own ~34 frames, then on the single frame
    // real per-frame tracking takes over it publishes the TRUE clamp(worldX-120,...) value (141)
    // discontinuously -- a 115px / ~7-block jump in one frame. The window's own "current" is 16
    // blocks from "desired" (colBlock 16 vs desired 0) at that same instant: exactly the
    // design's own `lag` the position-jump guard exists to catch (docs/design-streamed-worlds.md
    // ~1524, "The guard fires at lag >= 6"). The guard does not fire: instead of a forced-blank
    // full resync (`current := desired` immediately, camera publication suppressed until it
    // completes), ordinary single-block-per-arm incremental streaming begins (st_active=1), and
    // the already-published camera sits ahead of the window for every frame until the incremental
    // catch-up closes the gap. Measured worst margin **-7 blocks** (X axis, frame 34 of real
    // tracking) / **-6 blocks** (Y axis, the 'crossing up' test below, frame 35), recovering to a
    // steady >=8 only around frame 104 (X) / 101 (Y) -- roughly 70 real frames, over a second, of
    // genuinely unstreamed content within the camera's own claimed visible rectangle. Other traces
    // in this same matrix (crossing down, reversal, axis handoff, clamp, interact-Flash) do not
    // reach a negative margin because their own landing screens happen to sit close enough to
    // their own steady-state desired position that the same boot jump never drops below 0 --
    // confirmed by those subtests' own assertContained calls passing. Filed under needs-ruling in
    // handoff-next/streamed-worlds-phase2-s4b-gates-report.md; per the brief, this is left failing
    // rather than loosened, weakened, or silently worked around -- engine/streamworld.asm is out
    // of this slice's scope, and a passing gate here would misreport a real defect as closed.
    await t.test('entering edge, negative sign: crossing left decrements sw_col and wraps player_x to its own signed overshoot, never the ordinary MAX_X snap', async () => {
      const project = createStreamedProject({});
      project.project.startX = 5; // close to the left edge -- crosses within a handful of frames
      project.project.startScreen = 1; // grid col 1 -- a real neighbour to the left exists (col 0)
      const { nes, mem, guard } = await buildAndBoot(project);
      const streamed = project.maps.find((m) => m.streamed);
      const gridW = streamed.gridW;
      const assertContained = makeContainmentChecker(mem, { gridW, gridH: streamed.gridH });
      let model = { playerX: mem[PLAYER_X], acc: mem[SW_WALK_ACC_X], swCol: mem[SW_COL] };
      const startCol = model.swCol;
      nes.buttonDown(1, LEFT);
      let crossed = false;
      for (let i = 0; i < 20 && !crossed; i++) {
        model = predictHorizontalStep({ playerX: model.playerX, acc: model.acc, swCol: model.swCol, gridW, dir: 'left' });
        nes.frame();
        assert.equal(mem[PLAYER_X], model.playerX, `frame ${i}: player_x must match the independently computed signed-overshoot crossing`);
        assert.equal(mem[SW_COL], model.swCol, `frame ${i}: sw_col`);
        assertContained(`entering edge left frame ${i}`);
        if (model.swCol !== startCol) crossed = true;
      }
      nes.buttonUp(1, LEFT);
      assert.ok(crossed, 'sw_col must have decremented within 20 frames of holding Left from x=5');
      assert.equal(mem[SW_COL], startCol - 1, 'sw_col must retreat by exactly one screen');
      // Round-3 gate closure's own needs-ruling comment above documents that the guard does NOT
      // fire during this exact scenario (ordinary incremental streaming takes over instead) --
      // asserted here for real rather than left implicit, so a build that changes that would be
      // caught, not silently reinterpreted as "the guard's job now".
      guard.assertNone('entering edge left, ordinary design-rate workload');
      guard.unwatch();
    });

    await t.test('entering edge, positive sign (vertical): crossing down increments sw_row and wraps player_y to its own signed overshoot', async () => {
      const project = createStreamedProject({ gridH: 3 });
      project.project.startY = 219; // close to the 240 row boundary -- crosses within a handful of frames
      const { nes, mem, guard } = await buildAndBoot(project);
      const streamed = project.maps.find((m) => m.streamed);
      const gridH = streamed.gridH;
      const assertContained = makeContainmentChecker(mem, { gridW: streamed.gridW, gridH });
      let model = { playerY: mem[PLAYER_Y], acc: mem[SW_WALK_ACC_Y], swRow: mem[SW_ROW] };
      const startRow = model.swRow;
      nes.buttonDown(1, DOWN);
      let crossed = false;
      for (let i = 0; i < 20 && !crossed; i++) {
        model = predictVerticalStep({ playerY: model.playerY, acc: model.acc, swRow: model.swRow, gridH, dir: 'down' });
        nes.frame();
        assert.equal(mem[PLAYER_Y], model.playerY, `frame ${i}: player_y must match the independently computed signed-overshoot crossing`);
        assert.equal(mem[SW_ROW], model.swRow, `frame ${i}: sw_row`);
        assertContained(`entering edge down frame ${i}`);
        if (model.swRow !== startRow) crossed = true;
      }
      nes.buttonUp(1, DOWN);
      assert.ok(crossed, 'sw_row must have incremented within 20 frames of holding Down from y=219');
      assert.equal(mem[SW_ROW], startRow + 1, 'sw_row must advance by exactly one screen');
      guard.assertNone('entering edge down, ordinary design-rate workload');
      guard.unwatch();
    });

    // NEEDS-RULING, same real defect as 'entering edge, negative sign: crossing left' above, Y
    // axis: measured worst margin -6 blocks at frame 35 of real tracking, recovering only by frame
    // ~101. See that test's own comment and the gates report for the full measurement and repro.
    await t.test('entering edge, negative sign (vertical): crossing up decrements sw_row and wraps player_y to its own signed overshoot, never the ordinary MAX_Y snap', async () => {
      const project = createStreamedProject({ gridH: 3 });
      project.project.startY = 5;
      project.project.startScreen = 1 * 3; // row 1, col 0 -- a real neighbour above exists (row 0)
      const { nes, mem, guard } = await buildAndBoot(project);
      const streamed = project.maps.find((m) => m.streamed);
      const gridH = streamed.gridH;
      const assertContained = makeContainmentChecker(mem, { gridW: streamed.gridW, gridH });
      let model = { playerY: mem[PLAYER_Y], acc: mem[SW_WALK_ACC_Y], swRow: mem[SW_ROW] };
      const startRow = model.swRow;
      nes.buttonDown(1, UP);
      let crossed = false;
      for (let i = 0; i < 20 && !crossed; i++) {
        model = predictVerticalStep({ playerY: model.playerY, acc: model.acc, swRow: model.swRow, gridH, dir: 'up' });
        nes.frame();
        assert.equal(mem[PLAYER_Y], model.playerY, `frame ${i}: player_y must match the independently computed signed-overshoot crossing`);
        assert.equal(mem[SW_ROW], model.swRow, `frame ${i}: sw_row`);
        assertContained(`entering edge up frame ${i}`);
        if (model.swRow !== startRow) crossed = true;
      }
      nes.buttonUp(1, UP);
      assert.ok(crossed, 'sw_row must have decremented within 20 frames of holding Up from y=5');
      assert.equal(mem[SW_ROW], startRow - 1, 'sw_row must retreat by exactly one screen');
      guard.assertNone('entering edge up, ordinary design-rate workload');
      guard.unwatch();
    });

    // Round-1 gate-closure-fix-1 finding 2/ruling R2: a synthetic register fixture (no engine
    // build -- makeContainmentChecker only needs an indexable `mem`), exercising the
    // first-observation fallback directly for the exact case round-1's own review named:
    // "initial observation of a positive arm that has already reached its desired window". The
    // OLD predictDesiredWindow/pairLess fallback compared current against desired and classified
    // an EQUAL pair (current already caught up) as negative (pairLess returns false on a tie),
    // which is wrong here -- the arm that produced this exact "current" was a positive (increment)
    // one. The fixture below sets win_col_screen/local to a "current" that predictDesiredWindow
    // independently confirms already equals "desired" for this swCol/playerX, with the saved
    // entering edge (sw_ss_sc/lc) at the FAR edge (colBlock+31) -- the real signature of an
    // increment arm (sw_win_arm_col_inc calls sw_win_entering_col_right before saving,
    // engine/streamworld.asm:3162-3165). The published camera touches only the NEAR edge (block
    // 16), which is genuinely safe under a positive arm (the far edge, 47, is what is still
    // draining) -- assertContained must not throw. Under the old fallback (misclassifying this as
    // negative), the near edge would have been wrongly excluded instead, and this exact frame
    // would have failed.
    t.test('containment oracle: initial observation of a positive arm that has already reached its desired window', () => {
      const gridW = 3;
      const gridH = 2;
      const mem = new Uint8Array(0x0600);
      const swCol = 1;
      const playerX = 248;
      const swRow = 0;
      const playerY = 112;
      mem[SW_COL] = swCol;
      mem[PLAYER_X] = playerX;
      mem[SW_ROW] = swRow;
      mem[PLAYER_Y] = playerY;
      mem[WIN_COL_SCREEN] = 1;
      mem[WIN_COL_LOCAL] = 0; // colBlock = 16
      mem[WIN_ROW_SCREEN] = 0;
      mem[WIN_ROW_LOCAL] = 0; // rowBlock = 0, row axis idle throughout
      mem[ST_ACTIVE] = 1; // column strip mid-drain
      mem[SW_SS_SC] = 2;
      mem[SW_SS_LC] = 15; // entering block 47 = colBlock(16) + winBlocksX(32) - 1 -- the FAR edge
      const camPx = 256; // == colBlock*16 -- visible range touches only the NEAR edge (block 16)
      mem[SW_CAM_ORIGIN_X_LO] = camPx & 0xff;
      mem[SW_CAM_ORIGIN_X_HI] = (camPx >> 8) & 0xff;
      mem[SW_CAM_ORIGIN_Y_LO] = 0;
      mem[SW_CAM_ORIGIN_Y_HI] = 0;

      const { desCol, desColLocal } = predictDesiredWindow({ swCol, swRow, playerX, playerY, gridW, gridH });
      assert.equal(desCol, 1, 'fixture sanity: desired col screen must already equal "current" -- the "reached its desired window" premise');
      assert.equal(desColLocal, 0, 'fixture sanity: desired col local must already equal "current"');

      const assertContained = makeContainmentChecker(mem, { gridW, gridH });
      assertContained('synthetic positive-arm-already-reached-desired frame');
    });

    // -------------------------------------------------- reversal
    await t.test('reversal mid-drain: reversing direction right after a crossing lets the in-flight strip finish, not corrupt or stall', async () => {
      // gridW: 12 (wider than this file's ordinary 3x2 default) so the freshly-armed strip
      // genuinely spans multiple real frames of draining rather than finishing within the same
      // frame the crossing committed -- confirmed empirically (a 3-wide grid's own strip drains
      // so fast that st_active reads 0 again on the very next frame poll, making the original
      // version of this test unable to ever observe a real in-flight strip at all, only its own
      // already-idle aftermath).
      const project = createStreamedProject({ gridW: 12, gridH: 2 });
      project.project.startX = 235;
      const { nes, mem, guard } = await buildAndBoot(project);
      const assertContained = makeContainmentChecker(mem, { gridW: 12, gridH: 2 });
      const startCol = mem[SW_COL];
      nes.buttonDown(1, RIGHT);
      let crossed = false;
      for (let i = 0; i < 20 && !crossed; i++) {
        nes.frame();
        assertContained(`reversal pre-cross frame ${i}`);
        if (mem[SW_COL] !== startCol) crossed = true;
      }
      assert.ok(crossed, 'precondition: the crossing must have committed before reversing');
      // Wait for a strip to actually be mid-drain (st_active!=0, st_cur<st_len) before reversing --
      // on the wider grid this reliably happens a handful of frames after the crossing.
      let midDrain = false;
      for (let i = 0; i < 20 && !midDrain; i++) {
        nes.frame();
        assertContained(`reversal pre-drain-wait frame ${i}`);
        if (mem[ST_ACTIVE] !== 0 && mem[ST_CUR] < mem[ST_LEN]) midDrain = true;
      }
      assert.ok(midDrain, 'precondition: a strip must genuinely be mid-drain (st_active!=0, st_cur<st_len) before the reversal below means anything');
      const stCurAtReversal = mem[ST_CUR];
      const stLenAtReversal = mem[ST_LEN];
      nes.buttonUp(1, RIGHT);
      nes.buttonDown(1, LEFT);
      let drained = false;
      let recrossed = false;
      let playerXAtRecross = null;
      let prevCol = mem[SW_COL];
      // The invariant an abrupt re-arm would break: sw_win_arm only ever starts a fresh strip
      // while st_active==0 (the gate at sw_win_arm_col_try/sw_win_arm_row_try), so st_cur can only
      // ever go backward (a fresh strip's counter restarting at/near 0) at the exact frame the
      // PRIOR strip had SW_STREAM_CHUNK (3) or fewer metatiles left to drain -- the one remaining
      // drain call that legitimately finishes it (sw_ns_finish) and the immediate same-frame
      // re-arm that can follow it happen inside a single nes.frame() call, so st_active is never
      // observed to dip to 0 in between on real hardware-accurate finishes; only st_cur's backward
      // jump is externally visible. A build that drops the st_active gate (letting a mismatch
      // re-arm mid-drain) instead resets st_cur while the prior strip still had most of its length
      // left undrained -- silently discarding that many metatiles' worth of nametable writes,
      // confirmed empirically via a scratch probe: gate intact, the reset from st_cur=27 to 0 (out
      // of st_len=30) only ever happens with 3 (<=SW_STREAM_CHUNK) remaining; gate removed, the
      // very same reset happens with 27 remaining after only one drain chunk had run.
      let prevCur = mem[ST_CUR];
      let prevLen = mem[ST_LEN];
      let sawIllegalReset = null;
      for (let i = 0; i < 60 && !(drained && recrossed); i++) {
        nes.frame();
        assertContained(`reversal frame ${i}`);
        if (mem[ST_CUR] < prevCur && sawIllegalReset === null) {
          const remaining = prevLen - prevCur;
          if (remaining > SW_STREAM_CHUNK) {
            sawIllegalReset = { prevCur, prevLen, remaining };
          }
        }
        prevCur = mem[ST_CUR];
        prevLen = mem[ST_LEN];
        if (mem[ST_ACTIVE] === 0) drained = true;
        if (!recrossed && mem[SW_COL] !== prevCol) {
          recrossed = mem[SW_COL] === startCol;
          playerXAtRecross = mem[PLAYER_X];
        }
        prevCol = mem[SW_COL];
      }
      nes.buttonUp(1, LEFT);
      assert.equal(
        sawIllegalReset,
        null,
        `st_cur reset from ${sawIllegalReset?.prevCur} to a lower value while ${sawIllegalReset?.remaining} ` +
          `metatiles (> SW_STREAM_CHUNK=${SW_STREAM_CHUNK}) of a st_len=${sawIllegalReset?.prevLen} strip were ` +
          'still undrained -- the reversal let a fresh strip re-arm over an in-flight one instead of letting it finish'
      );
      assert.ok(drained, 'a strip in flight when the player reverses must still finish draining, not stall with st_active stuck nonzero');
      assert.ok(recrossed, 'walking left long enough after the reversal must re-cross back to the original screen -- sw_col must not be left desynced by the mid-drain reversal');
      // The reversal's own frame budget (a variable-length wait for a real mid-drain strip) makes
      // the exact recross frame -- and so the accumulator's exact parity at that frame -- runtime-
      // dependent, unlike the fixed-startX crossings above; the LANDING VALUE is still independently
      // derivable without it, though: a left crossing only fires when playerX < step (predictHorizontalStep's
      // own guard, ruling C), and step is always 1 or 2 (sw_walk_step_x's own documented cadence), so
      // playerX is 0 or 1 at the crossing frame and the wrapped landing (playerX-step+256) is always
      // 254 or 255 -- never MAX_X=240, the ordinary engine's now-inapplicable snap value.
      assert.ok(
        playerXAtRecross === 254 || playerXAtRecross === 255,
        `the return crossing must wrap player_x to its own signed overshoot (254 or 255), not the ordinary MAX_X=240 snap -- got ${playerXAtRecross}, proving the round trip was not corrupted`
      );
      assert.ok(
        stCurAtReversal < stLenAtReversal,
        `sanity: the strip really was mid-drain at the moment of reversal (st_cur=${stCurAtReversal}, st_len=${stLenAtReversal})`
      );
      guard.assertNone('reversal mid-drain, ordinary design-rate workload');
      guard.unwatch();
    });

    // -------------------------------------------------- axis handoff
    await t.test('axis handoff mid-crossing: switching to the other axis before a crossing completes does not corrupt it', async () => {
      const project = createStreamedProject({});
      project.project.startX = 235; // a couple of frames from crossing (SW_SPEED_SUB_X's 1,2,1,2... cadence)
      const { nes, mem, guard } = await buildAndBoot(project);
      const assertContained = makeContainmentChecker(mem, { gridW: 3, gridH: 2 });
      const startCol = mem[SW_COL];
      nes.buttonDown(1, RIGHT);
      nes.frame(); // X owns the accumulator, one step taken, not yet crossed
      assertContained('axis handoff, frame 1 (X held)');
      assert.equal(mem[SW_COL], startCol, 'precondition: must not have crossed yet after only one frame from x=235');
      assert.equal(mem[SW_AXIS_PREF], 0, 'precondition: X owns the axis after the first Right press');
      const xMidHandoff = mem[PLAYER_X];
      // A fresh Down press takes ownership mid-flight, per the axis-arbitration rule already
      // covered above -- Right is still physically held (a real player rarely releases cleanly).
      nes.buttonDown(1, DOWN);
      nes.frame();
      assertContained('axis handoff, frame 2 (Y takes over)');
      assert.equal(mem[SW_AXIS_PREF], 1, 'a fresh Down press must take ownership from X even mid-crossing-approach');
      assert.equal(mem[PLAYER_X], xMidHandoff, 'player_x must not advance on the frame Y takes over');
      const yAfterSwitch = mem[PLAYER_Y];
      nes.frame();
      assertContained('axis handoff, frame 3 (Y moving)');
      assert.notEqual(mem[PLAYER_Y], yAfterSwitch, 'Y must now be the one moving');
      // Hand ownership back to X (release Down, a fresh Right press) and finish the crossing.
      nes.buttonUp(1, DOWN);
      nes.buttonDown(1, RIGHT); // fresh press: Right was still held throughout, but Down owned the axis
      let crossed = false;
      for (let i = 0; i < 20 && !crossed; i++) {
        nes.frame();
        assertContained(`axis handoff, finishing crossing frame ${i}`);
        if (mem[SW_COL] !== startCol) crossed = true;
      }
      nes.buttonUp(1, RIGHT);
      assert.ok(crossed, 'the crossing must still complete correctly after an axis handoff interrupted its approach');
      assert.equal(mem[SW_COL], startCol + 1, 'sw_col must advance by exactly one screen, not corrupted by the interruption');
      assert.ok(mem[PLAYER_X] < MAX_X, 'player_x must wrap normally despite the handoff');
      guard.assertNone('axis handoff mid-crossing, ordinary design-rate workload');
      guard.unwatch();
    });

    // -------------------------------------------------- entity repopulation on a continuous
    // crossing (finding 1/ruling A permanent regression test, mirrored across all 4 directions --
    // derived from handoff-next/review-s4b-runtime-repro.mjs's own scenario, run below and
    // reported verbatim in the fix round 1 report). A 3x3 grid landing on the CENTER screen (index
    // 4) gives every direction a real neighbour to cross into without needing a fresh grid shape
    // per direction. 'Old' sits on the landing screen, 'New' on the one neighbour screen under
    // test; before the crossing only Old is active, after it only New is -- a continuous crossing
    // that fails to do the contract §5 work (outgoing actors cleared, incoming spawned, entry event
    // armed via screen_fresh) would leave Old resident, leave New unspawned, or both.
    const DIRECTIONS = [
      { name: 'right', button: RIGHT, neighborRow: 1, neighborCol: 2 },
      { name: 'left', button: LEFT, neighborRow: 1, neighborCol: 0 },
      { name: 'down', button: DOWN, neighborRow: 2, neighborCol: 1 },
      { name: 'up', button: UP, neighborRow: 0, neighborCol: 1 }
    ];
    for (const { name, button, neighborRow, neighborCol } of DIRECTIONS) {
      await t.test(`entity repopulation: a continuous crossing ${name} clears the outgoing screen's actor and spawns the incoming one, in the crossing frame itself`, async () => {
        const gridW = 3, gridH = 3;
        const landingCol = 1, landingRow = 1;
        const landingScreen = landingRow * gridW + landingCol;
        const neighborScreen = neighborRow * gridW + neighborCol;
        const project = createStreamedProject({ gridW, gridH });
        project.project.startScreen = landingScreen;
        const oldActorId = project.sprites.actors.length;
        project.sprites.actors.push({ name: 'Old', behavior: 'npc', hp: 1, damage: 0 });
        const newActorId = project.sprites.actors.length;
        project.sprites.actors.push({ name: 'New', behavior: 'npc', hp: 1, damage: 0 });
        project.maps[0].screens[landingScreen].entities = [{ actorId: oldActorId, x: 32, y: 32, props: {} }];
        project.maps[0].screens[neighborScreen].entities = [{ actorId: newActorId, x: 32, y: 32, props: {} }];
        const { nes, mem, guard } = await buildAndBoot(project);
        assert.equal(mem[FLAT_SCREEN], landingScreen, 'precondition: landed on the expected center screen');
        assert.equal(mem[ENT_ACTIVE], 1, 'precondition: Old must be resident and active before any crossing');
        assert.equal(mem[ENT_ACTOR], oldActorId, 'precondition: the one active slot must be Old');
        nes.buttonDown(1, button);
        let crossedFrame = -1;
        let sawFreshOnCrossingFrame = false;
        for (let i = 0; i < 400 && crossedFrame < 0; i++) {
          nes.frame();
          if (mem[FLAT_SCREEN] === neighborScreen) {
            crossedFrame = i;
            sawFreshOnCrossingFrame = mem[SCREEN_FRESH] === 1;
          }
        }
        nes.buttonUp(1, button);
        assert.ok(crossedFrame >= 0, `direction ${name}: flat_screen must reach the neighbour screen within 400 frames`);
        assert.ok(sawFreshOnCrossingFrame, `direction ${name}: screen_fresh must be set on the exact frame flat_screen changes -- the crossing frame stops via screen_fresh, ruling A`);
        assert.equal(mem[ENT_ACTIVE], 1, `direction ${name}: exactly one entity slot must be active after the crossing (New, freshly spawned)`);
        assert.equal(mem[ENT_ACTOR], newActorId, `direction ${name}: the active slot must now be New, not the stale Old`);
        guard.assertNone(`entity repopulation ${name}, ordinary design-rate workload`);
        guard.unwatch();
      });
    }

    // -------------------------------------------------- clamp edges (regression test for the
    // grid-boundary wraparound bug found and fixed this session)
    await t.test('clamp edges: holding a direction at the grid boundary contains the player, never wraps past the grid', async () => {
      const cases = [
        { dir: LEFT, name: 'Left', startScreen: 0, axis: 'col', bound: 0 },
        { dir: UP, name: 'Up', startScreen: 0, axis: 'row', bound: 0 },
        { dir: RIGHT, name: 'Right', startScreen: 2, axis: 'col', bound: 2 }, // gridW=3 default -- rightmost col is 2
        { dir: DOWN, name: 'Down', startScreen: 1 * 3, axis: 'row', bound: 1 } // gridH=2 default -- bottommost row is 1
      ];
      for (const { dir, name, startScreen, axis, bound } of cases) {
        const project = createStreamedProject({});
        project.project.startScreen = startScreen;
        const { nes, mem, guard } = await buildAndBoot(project);
        const addr = axis === 'col' ? SW_COL : SW_ROW;
        const assertContained = makeContainmentChecker(mem, { gridW: 3, gridH: 2 });
        nes.buttonDown(1, dir);
        for (let i = 0; i < 300; i++) {
          nes.frame();
          assert.equal(mem[addr], bound, `holding ${name} at the grid boundary must never move sw_${axis} off ${bound} (frame ${i})`);
          assertContained(`clamp ${name} frame ${i}`);
        }
        nes.buttonUp(1, dir);
        // Ruling C's wide 0-255/0-239 ownership rectangle (docs/design-streamed-worlds.md §6) is
        // wider than the ordinary engine's MAX_X/MAX_Y containment wall: at a real grid boundary the
        // crossing is refused (asserted above, every frame) but the collision probes are not, so the
        // player can still walk up to the true screen edge (255/239) before the probe itself blocks
        // further movement -- MAX_X/MAX_Y no longer bound held movement, only the screen size does.
        assert.ok(mem[PLAYER_X] >= 0 && mem[PLAYER_X] <= 255, `player_x must stay in its legal 0-255 range after 300 frames of ${name} at the boundary`);
        assert.ok(mem[PLAYER_Y] >= 0 && mem[PLAYER_Y] <= 239, `player_y must stay in its legal 0-239 range after 300 frames of ${name} at the boundary`);
        guard.assertNone(`clamp edges ${name}, ordinary design-rate workload`);
        guard.unwatch();
      }
    });

    // -------------------------------------------------- 1x1/1xN/Nx1/2-screen axis configurations
    await t.test('1x1 grid: every direction is refused immediately, sw_col/sw_row never move', async () => {
      const project = createStreamedProject({ gridW: 1, gridH: 1 });
      const { nes, mem, guard } = await buildAndBoot(project);
      for (const dir of [LEFT, RIGHT, UP, DOWN]) {
        nes.buttonDown(1, dir);
        for (let i = 0; i < 60; i++) {
          nes.frame();
          assert.equal(mem[SW_COL], 0, `a 1x1 grid must never move sw_col, direction under test`);
          assert.equal(mem[SW_ROW], 0, `a 1x1 grid must never move sw_row, direction under test`);
        }
        nes.buttonUp(1, dir);
      }
      guard.assertNone('1x1 grid, ordinary design-rate workload');
      guard.unwatch();
    });

    await t.test('1xN grid (gridW=1): only vertical crossing is legal, horizontal is refused', async () => {
      const project = createStreamedProject({ gridW: 1, gridH: 3 });
      project.project.startScreen = 1; // middle row -- both Up and Down have a real neighbour
      project.project.startY = 219;
      const { nes, mem, guard } = await buildAndBoot(project);
      nes.buttonDown(1, LEFT);
      for (let i = 0; i < 60; i++) {
        nes.frame();
        assert.equal(mem[SW_COL], 0, 'gridW=1: Left must never move sw_col');
      }
      nes.buttonUp(1, LEFT);
      nes.buttonDown(1, RIGHT);
      for (let i = 0; i < 60; i++) {
        nes.frame();
        assert.equal(mem[SW_COL], 0, 'gridW=1: Right must never move sw_col');
      }
      nes.buttonUp(1, RIGHT);
      const startRow = mem[SW_ROW];
      nes.buttonDown(1, DOWN);
      let crossed = false;
      for (let i = 0; i < 20 && !crossed; i++) {
        nes.frame();
        if (mem[SW_ROW] !== startRow) crossed = true;
      }
      nes.buttonUp(1, DOWN);
      assert.ok(crossed, 'gridW=1: Down must still legitimately cross rows');
      assert.equal(mem[SW_ROW], startRow + 1, 'sw_row must advance by exactly one screen');
      guard.assertNone('1xN grid, ordinary design-rate workload');
      guard.unwatch();
    });

    await t.test('Nx1 grid (gridH=1): only horizontal crossing is legal, vertical is refused', async () => {
      const project = createStreamedProject({ gridW: 3, gridH: 1 });
      project.project.startScreen = 1; // middle col -- both Left and Right have a real neighbour
      project.project.startX = 5;
      const { nes, mem, guard } = await buildAndBoot(project);
      nes.buttonDown(1, UP);
      for (let i = 0; i < 60; i++) {
        nes.frame();
        assert.equal(mem[SW_ROW], 0, 'gridH=1: Up must never move sw_row');
      }
      nes.buttonUp(1, UP);
      nes.buttonDown(1, DOWN);
      for (let i = 0; i < 60; i++) {
        nes.frame();
        assert.equal(mem[SW_ROW], 0, 'gridH=1: Down must never move sw_row');
      }
      nes.buttonUp(1, DOWN);
      const startCol = mem[SW_COL];
      nes.buttonDown(1, LEFT);
      let crossed = false;
      for (let i = 0; i < 20 && !crossed; i++) {
        nes.frame();
        if (mem[SW_COL] !== startCol) crossed = true;
      }
      nes.buttonUp(1, LEFT);
      assert.ok(crossed, 'gridH=1: Left must still legitimately cross columns');
      assert.equal(mem[SW_COL], startCol - 1, 'sw_col must retreat by exactly one screen');
      guard.assertNone('Nx1 grid, ordinary design-rate workload');
      guard.unwatch();
    });

    await t.test('2-screen grid: the window origin never leaves 0 on an axis whose grid span equals the window\'s own span', async () => {
      // The window/viewport clamp (docs/design-streamed-worlds.md) bounds the resident window's
      // own origin to [0, gridScreens - windowScreens] per axis -- a 2-screen-wide grid against a
      // 2-screen-wide window leaves exactly one legal origin, 0, on that axis: win_col_screen/
      // win_col_local must never read anything else, on landing or after any amount of walking.
      const project = createStreamedProject({ gridW: 2, gridH: 2 });
      const { nes, mem, guard } = await buildAndBoot(project);
      assert.equal(mem[WIN_COL_SCREEN], 0, 'precondition: window origin starts at screen 0 on a 2-screen-wide grid');
      assert.equal(mem[WIN_COL_LOCAL], 0, 'precondition: window origin starts at local 0');
      nes.buttonDown(1, RIGHT);
      for (let i = 0; i < 400; i++) {
        nes.frame();
        assert.equal(mem[WIN_COL_SCREEN], 0, `win_col_screen must stay 0 on a 2-screen grid (frame ${i}) -- there is nowhere else legal for it to be`);
        assert.equal(mem[WIN_COL_LOCAL], 0, `win_col_local must stay 0 on a 2-screen grid (frame ${i})`);
      }
      nes.buttonUp(1, RIGHT);
      assert.equal(mem[SW_COL], 1, 'sanity: the player did actually cross to the far column during those 400 frames');
      guard.assertNone('2-screen grid (col axis), ordinary design-rate workload');
      guard.unwatch();
    });

    await t.test('2-screen grid, row axis: the window origin never leaves 0 on the row axis either, not just column', async () => {
      // Mirror of the test above but for the ROW axis (sw_clamp_row, holding Down instead of
      // Right) -- sw_clamp_col and sw_clamp_row are two separately-written routines with identical
      // intended shape, not one shared implementation, so a bug omitting the upper-bound clamp on
      // only one axis (e.g. sw_clamp_row falling straight through to its own "fine, no clamp"
      // label without ever comparing against sw_grid_h-2) would still pass every col-axis test in
      // this file. On a 2-screen-tall grid there is exactly one legal row origin, 0, the same as
      // the col case -- win_row_screen/win_row_local must never read anything else.
      const project = createStreamedProject({ gridW: 2, gridH: 2 });
      const { nes, mem, guard } = await buildAndBoot(project);
      assert.equal(mem[WIN_ROW_SCREEN], 0, 'precondition: window origin starts at screen 0 on a 2-screen-tall grid');
      assert.equal(mem[WIN_ROW_LOCAL], 0, 'precondition: window origin starts at local 0');
      nes.buttonDown(1, DOWN);
      for (let i = 0; i < 400; i++) {
        nes.frame();
        assert.equal(mem[WIN_ROW_SCREEN], 0, `win_row_screen must stay 0 on a 2-screen-tall grid (frame ${i}) -- there is nowhere else legal for it to be`);
        assert.equal(mem[WIN_ROW_LOCAL], 0, `win_row_local must stay 0 on a 2-screen-tall grid (frame ${i})`);
      }
      nes.buttonUp(1, DOWN);
      assert.equal(mem[SW_ROW], 1, 'sanity: the player did actually cross to the far row during those 400 frames');
      guard.assertNone('2-screen grid (row axis), ordinary design-rate workload');
      guard.unwatch();
    });

    // -------------------------------------------------- camera clamp (finding 6, ruling F)
    //
    // sw_frame_camera_window's own documented formula (also transcribed in handoff-next/
    // review-s4b-clamp-sabotage.mjs, which this section's scenarios are modelled on): camPx =
    // clamp(worldX-120, 0, (gridW-1)*256); camPy = clamp(worldY-112, 0, (gridH-1)*240). Published
    // as cam_x_lo/cam_y_lo (the clamped value's own low byte) and cam_nt (bit0 = camPx's bit8,
    // bit1 = floor(camPy/240)&1 -- a screen-row parity, NOT camPy's own bit8; engine/streamworld.
    // asm:2911-2915 confirms this by direct read, not by inference from the X half's shape).
    // test/unit/streamworldmove.test.js's only prior camera-publish test (above) deliberately
    // never reaches either clamp -- these five exercise both axes' both bounds, plus the 1x1/1xN/
    // Nx1 degenerate grid shapes ruling F names.

    await t.test('camera clamp: the X axis holds at the world-width ceiling once the player reaches the grid\'s right edge, never exceeds it', async () => {
      const gridW = 3, gridH = 2;
      const project = createStreamedProject({ gridW, gridH });
      const { nes, mem, guard } = await buildAndBoot(project);
      nes.buttonDown(1, RIGHT);
      // 3 screens at SW_SPEED_SUB_X's own ~1.5px/frame average is ~500 frames; 700 is a generous
      // margin past that, including time to settle against the off-grid wall.
      for (let i = 0; i < 700; i++) nes.frame();
      nes.buttonUp(1, RIGHT);
      assert.equal(mem[SW_COL], gridW - 1, 'the player must have reached the grid\'s rightmost column');
      // Ruling C / fix round 2 finding C: an off-grid movement probe is unconditionally solid, so
      // the true resting x is not the raw 8-bit overflow boundary (255) but wherever the leading
      // BODY_R (13, engine/constants.asm) probe would first reach the off-grid neighbour column --
      // player_x+cur_speed+BODY_R >= 256 is refused, so the last committable player_x is
      // 255-BODY_R = 242. This replaces the old (finding-C-wrong) 255 expectation the review named.
      assert.equal(mem[PLAYER_X], 242, 'player_x must be pinned at 255-BODY_R=242 -- an off-grid probe is unconditionally solid (fix round 2, finding C), not a MAX_X (240) snap nor the raw 255 overflow boundary');
      const worldX = (gridW - 1) * 256 + 242;
      const camPx = Math.min(Math.max(worldX - 120, 0), (gridW - 1) * 256);
      assert.equal(mem[CAM_X_LO], camPx & 0xff, 'cam_x_lo must equal the CLAMPED camPx\'s own low byte, not the unclamped (larger) value');
      assert.equal(mem[CAM_NT] & 1, (camPx >> 8) & 1, 'cam_nt bit0 must equal the clamped camPx\'s own bit 8');
      guard.assertNone('camera clamp (X ceiling), ordinary design-rate workload');
      guard.unwatch();
    });

    await t.test('camera clamp: a 1-wide (1xN) grid pins the X axis at 0 throughout, and the Y axis holds at the world-height ceiling at the bottom edge', async () => {
      const gridW = 1, gridH = 3;
      const project = createStreamedProject({ gridW, gridH });
      const { nes, mem, guard } = await buildAndBoot(project);
      nes.buttonDown(1, DOWN);
      for (let i = 0; i < 700; i++) {
        nes.frame();
        assert.equal(mem[CAM_X_LO], 0, `frame ${i}: cam_x_lo must stay 0 on a 1-wide grid -- its own ceiling is (1-1)*256=0`);
        assert.equal(mem[CAM_NT] & 1, 0, `frame ${i}: cam_nt bit0 (X parity) must stay 0 on a 1-wide grid`);
      }
      nes.buttonUp(1, DOWN);
      assert.equal(mem[SW_ROW], gridH - 1, 'the player must have reached the grid\'s bottom row');
      // Ruling C / fix round 2 finding C: an off-grid movement probe is unconditionally solid, so
      // the true resting y is not the raw 240-row boundary (239) but wherever the leading BODY_B
      // (15, engine/constants.asm) probe would first reach the off-grid neighbour row -- the last
      // committable player_y is 239-BODY_B = 224 (coincides with the ordinary game's own MAX_Y=224,
      // but for a different reason: here it is BODY_B's own reach against the authored grid's own
      // edge, not an HUD-margin constant).
      assert.equal(mem[PLAYER_Y], 224, 'player_y must be pinned at 239-BODY_B=224 -- an off-grid probe is unconditionally solid (fix round 2, finding C), not the raw 239 row boundary');
      const worldY = (gridH - 1) * 240 + 224;
      const camPy = Math.min(Math.max(worldY - 112, 0), (gridH - 1) * 240);
      const camScreenRow = Math.floor(camPy / 240);
      assert.equal(mem[CAM_Y_LO], camPy % 240, 'cam_y_lo must equal the CLAMPED camPy mod 240, not the unclamped value');
      assert.equal((mem[CAM_NT] >> 1) & 1, camScreenRow & 1, 'cam_nt bit1 must equal floor(clamped camPy/240)\'s own parity');
      guard.assertNone('camera clamp (1-wide grid), ordinary design-rate workload');
      guard.unwatch();
    });

    await t.test('camera clamp: a 1-tall (Nx1) grid pins the Y axis at 0 throughout, mirroring the 1-wide case on the other axis', async () => {
      const gridW = 3, gridH = 1;
      const project = createStreamedProject({ gridW, gridH });
      const { nes, mem, guard } = await buildAndBoot(project);
      nes.buttonDown(1, RIGHT);
      for (let i = 0; i < 700; i++) {
        nes.frame();
        assert.equal(mem[CAM_Y_LO], 0, `frame ${i}: cam_y_lo must stay 0 on a 1-tall grid -- its own ceiling is (1-1)*240=0`);
        assert.equal(mem[CAM_NT] & 2, 0, `frame ${i}: cam_nt bit1 (Y row parity) must stay 0 on a 1-tall grid`);
      }
      nes.buttonUp(1, RIGHT);
      assert.equal(mem[SW_COL], gridW - 1, 'sanity: the player did reach the grid\'s rightmost column during those 700 frames');
      guard.assertNone('camera clamp (1-tall grid), ordinary design-rate workload');
      guard.unwatch();
    });

    await t.test('camera clamp: a 1x1 grid pins both axes at 0 regardless of in-screen movement', async () => {
      const project = createStreamedProject({ gridW: 1, gridH: 1 });
      const { nes, mem, guard } = await buildAndBoot(project);
      for (const dir of [RIGHT, DOWN, LEFT, UP]) {
        nes.buttonDown(1, dir);
        for (let i = 0; i < 60; i++) {
          nes.frame();
          assert.equal(mem[CAM_X_LO], 0, `dir ${dir} frame ${i}: cam_x_lo must stay 0 -- both grid ceilings are (1-1)*size=0`);
          assert.equal(mem[CAM_Y_LO], 0, `dir ${dir} frame ${i}: cam_y_lo must stay 0`);
          assert.equal(mem[CAM_NT] & 3, 0, `dir ${dir} frame ${i}: cam_nt's own two parity bits must both stay 0`);
        }
        nes.buttonUp(1, dir);
      }
      assert.equal(mem[SW_COL], 0, 'sanity: a 1x1 grid never advances sw_col');
      assert.equal(mem[SW_ROW], 0, 'sanity: a 1x1 grid never advances sw_row');
      guard.assertNone('camera clamp (1x1 grid), ordinary design-rate workload');
      guard.unwatch();
    });

    await t.test('camera clamp: the X axis stays pinned at 0 walking Left from the landing position, never underflows', async () => {
      // createStreamedProject's own default landing is player_x=120 (createProject's default), so
      // worldX=120 and camPx=clamp(120-120,0,...)=0 already at the floor -- walking further Left
      // pushes worldX-120 negative pre-clamp; a clamp that only guards the upper bound (or clamps
      // via an unsigned/wrapping subtract instead of a real floor) would publish a huge wrapped
      // byte instead of holding at 0.
      const project = createStreamedProject({});
      const { nes, mem, guard } = await buildAndBoot(project);
      assert.equal(mem[CAM_X_LO], 0, 'precondition: camPx starts at its own floor, 0');
      nes.buttonDown(1, LEFT);
      for (let i = 0; i < 60; i++) {
        nes.frame();
        assert.equal(mem[CAM_X_LO], 0, `frame ${i}: cam_x_lo must stay 0 walking Left from the floor, never wrap to a large byte`);
        assert.equal(mem[CAM_NT] & 1, 0, `frame ${i}: cam_nt bit0 must stay 0`);
      }
      nes.buttonUp(1, LEFT);
      guard.assertNone('camera clamp (X pinned walking Left), ordinary design-rate workload');
      guard.unwatch();
    });

    // ---------------------------------------------- moving camera OAM (finding 2, ruling F)
    await t.test('moving camera OAM: the player\'s own on-screen OAM Y tracks sw_cam_origin_y\'s continuous per-frame publish, independently computed', async () => {
      // sw_oam_project_y's own documented contract (test/unit/streamworldprojection.test.js's own
      // projectAxis/projectY, mirrored here): delta = (worldY - originY) mod 65536, visible iff
      // the high byte is exactly 0 and the low byte is < 240; a visible result reports
      // (delta-1)&0xff, a hidden one reports the $FF park sentinel. Finding 2 is what makes
      // originY (sw_cam_origin_y_lo/hi) a value that keeps changing during a real walk at all.
      // originY is derived from the SAME clamp formula the "camera publish" test above uses for
      // cam_x_lo (camPy = clamp(worldY-112, 0, (gridH-1)*240)), never read back from
      // sw_cam_origin_y_lo/hi itself -- reading it back was tried first and found NOT independent:
      // a sabotage that freezes the publish (row 24) makes the test's own oracle read the same
      // stale value sw_oam_project_y itself reads, so the two stay self-consistent and the
      // sabotage goes uncaught. The walk stays short enough (20 frames, ~22px) to guarantee both
      // the "unclamped" case (well short of MAX_Y) and the "grid is 2 tall, ceiling (2-1)*240=240,
      // well above" case, matching the pre-existing camera-clamp tests' own established grid shape.
      function projectY(worldY, originY) {
        const delta = (worldY - originY) & 0xffff;
        const deltaLo = delta & 0xff;
        const visible = (delta >> 8) === 0 && deltaLo < 240;
        return visible ? (deltaLo - 1) & 0xff : 0xff;
      }
      const project = createStreamedProject({});
      const { nes, mem, guard } = await buildAndBoot(project);
      const startY = mem[PLAYER_Y];
      nes.buttonDown(1, DOWN);
      // Short enough to stay well inside the landing screen (no crossing, no animation freeze) --
      // SW_SPEED_SUB_Y's own ~1.1px/frame average over 20 frames is ~22px, far short of MAX_Y.
      const trace = simulateWalk(SW_SPEED_SUB_Y, 20);
      let cumulative = 0;
      for (let i = 0; i < 20; i++) {
        nes.frame();
        cumulative += trace[i];
        const worldY = mem[SW_ROW] * 240 + mem[PLAYER_Y];
        assert.equal(worldY, startY + cumulative, `frame ${i}: precondition -- the independently-simulated walk must match the real world position`);
        const originY = worldY - 112; // camPy = clamp(worldY-112, 0, (gridH-1)*240); unclamped here
        assert.equal(mem[SW_CAM_ORIGIN_Y_LO] | (mem[SW_CAM_ORIGIN_Y_HI] << 8), originY, `frame ${i}: sw_cam_origin_y_lo/hi must itself match the independently-derived clamp formula, not merely agree with whatever OAM reads`);
        assert.equal(mem[OAM], projectY(worldY, originY), `frame ${i}: the player's own TL-corner OAM Y must track this frame's real sw_cam_origin_y, not a stale/landing-only value`);
      }
      nes.buttonUp(1, DOWN);
      guard.assertNone('moving camera OAM (Y axis), ordinary design-rate workload');
      guard.unwatch();
    });

    await t.test('moving camera OAM (X axis): the player\'s own on-screen OAM X tracks sw_cam_origin_x\'s continuous per-frame publish, independently computed', async () => {
      // Mirrors the Y-axis test immediately above, on the other axis -- sw_oam_project_x's own
      // contract (streamworldprojection.test.js's projectAxis, width=256: the X sentinel, so the
      // low-byte compare is a no-op and only the high-byte-zero visibility test applies) has no
      // Y-style "-1" adjustment. Fix round 1's own sabotage round (row 24) found this axis
      // completely uncovered, AND found the read-back-from-RAM oracle shape (this test's own first
      // draft) does not actually catch a frozen sw_cam_origin_x_lo/hi -- see the Y test's own
      // comment above for why; originX is independently derived from the clamp formula instead.
      function projectX(worldX, originX) {
        const delta = (worldX - originX) & 0xffff;
        return delta >> 8 === 0 ? delta & 0xff : 0xff;
      }
      const project = createStreamedProject({});
      const { nes, mem, guard } = await buildAndBoot(project);
      const startX = mem[PLAYER_X];
      nes.buttonDown(1, RIGHT);
      // Short enough to stay well inside the landing screen (no crossing, no animation freeze).
      const trace = simulateWalk(SW_SPEED_SUB_X, 20);
      let cumulative = 0;
      for (let i = 0; i < 20; i++) {
        nes.frame();
        cumulative += trace[i];
        const worldX = mem[SW_COL] * 256 + mem[PLAYER_X];
        assert.equal(worldX, startX + cumulative, `frame ${i}: precondition -- the independently-simulated walk must match the real world position`);
        const originX = worldX - 120; // camPx = clamp(worldX-120, 0, (gridW-1)*256); unclamped here
        assert.equal(mem[SW_CAM_ORIGIN_X_LO] | (mem[SW_CAM_ORIGIN_X_HI] << 8), originX, `frame ${i}: sw_cam_origin_x_lo/hi must itself match the independently-derived clamp formula, not merely agree with whatever OAM reads`);
        assert.equal(mem[OAM + 3], projectX(worldX, originX), `frame ${i}: the player's own TL-corner OAM X must track this frame's real sw_cam_origin_x, not a stale/landing-only value`);
      }
      nes.buttonUp(1, RIGHT);
      guard.assertNone('moving camera OAM (X axis), ordinary design-rate workload');
      guard.unwatch();
    });

    // -------------------------------------------------- repeated interact-Flash
    await t.test('repeated interact-Flash: sw_event_freeze engages and clears cleanly on every interact, never sticks', async () => {
      const project = createStreamedProject({});
      const actorId = project.sprites.actors.length;
      project.sprites.actors.push({ name: 'Flasher', behavior: 'npc', hp: 1, damage: 0 });
      const screen = project.maps.find((m) => m.streamed).screens[0];
      screen.entities = screen.entities ?? [];
      screen.entities.push({
        actorId,
        x: 124,
        y: 112,
        props: {
          trigger: 'interact',
          // OP_FLASH does not suspend (engine/script.asm's own comment) -- the page finishes
          // synchronously within the same frame it opens, so this never transitions to ST_DIALOG,
          // matching the "an interact press that finds nobody in reach" test's own no-dialog shape
          // but this one DOES find someone -- exercising the freeze/clear cycle itself, repeatedly.
          event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'flash' }] }] }
        }
      });
      const { nes, mem, guard } = await buildAndBoot(project);
      const assertContained = makeContainmentChecker(mem, { gridW: 3, gridH: 2 });
      for (let cycle = 0; cycle < 5; cycle++) {
        const xBefore = mem[PLAYER_X];
        nes.buttonDown(1, B);
        nes.frame();
        assertContained(`interact-Flash cycle ${cycle} frame A`);
        assert.notEqual(mem[GAME_STATE], ST_DIALOG, `cycle ${cycle}: OP_FLASH must not open a dialog box`);
        assert.equal(mem[PLAYER_X], xBefore, `cycle ${cycle}: the player must not move on the frame interact triggers Flash`);
        nes.buttonUp(1, B);
        nes.frame();
        assertContained(`interact-Flash cycle ${cycle} frame B`);
        assert.equal(mem[SW_EVENT_FREEZE], 0, `cycle ${cycle}: sw_event_freeze must have cleared by the very next frame, not stuck`);
        // A couple of ordinary frames between presses -- a real player releasing and re-pressing
        // interact, not a single held button re-triggering every frame.
        nes.frame();
        assertContained(`interact-Flash cycle ${cycle} frame C`);
        nes.frame();
        assertContained(`interact-Flash cycle ${cycle} frame D`);
      }
      guard.assertNone('repeated interact-Flash, ordinary design-rate workload');
      guard.unwatch();
    });
  }
);

// Plan test 7 (finding 5, third round; deferred from slice 4a to 4b per ruling 1's own deviation
// D3 -- "nothing in 4a crosses or reverses"): the literal frame-by-frame trace, independently
// computed against the model functions above, not an inference from "the accumulator behaved like
// an animation-order case would."
test(
  'plan test 7: a literal step/position/arm trace at a screen crossing and at a reversal',
  { skip: !hasNesasm && 'nesasm not on PATH' },
  async () => {
    const project = createStreamedProject({});
    const streamedMap = project.maps.find((m) => m.streamed);
    const { gridW, gridH } = streamedMap;
    const { nes, mem, guard } = await buildAndBoot(project);

    // Seeded from the real post-landing RAM, not assumed -- this trace's own claim to being
    // "independent" rests on the documented formulas below, not on an unstated precondition.
    let model = {
      playerX: mem[PLAYER_X],
      acc: mem[SW_WALK_ACC_X],
      swCol: mem[SW_COL],
      winColScreen: mem[WIN_COL_SCREEN],
      winColLocal: mem[WIN_COL_LOCAL],
      winRowScreen: mem[WIN_ROW_SCREEN],
      winRowLocal: mem[WIN_ROW_LOCAL],
      stActive: mem[ST_ACTIVE]
    };
    assert.equal(model.stActive, 0, 'precondition: no strip already in flight at the start of the trace');
    const swRow = mem[SW_ROW];
    const playerY = mem[PLAYER_Y];

    // ---- leg 1: hold Right across a real screen crossing, then a real window-arm event ----
    // ~96 frames covers the 144px-of-world-movement the window's own 8-block margin needs to first
    // arm (docs/design-streamed-worlds.md's own centre/margin figures, cross-checked against the
    // "window arm" test above); the crossing itself needs only ~120px, comfortably inside that same
    // walk -- 110 frames covers both with margin, not a tuned-to-fit guess.
    nes.buttonDown(1, RIGHT);
    let crossedOnce = false;
    let armedOnce = false;
    for (let i = 0; i < 110; i++) {
      const moved = predictHorizontalStep({ playerX: model.playerX, acc: model.acc, swCol: model.swCol, gridW, dir: 'right' });
      // sw_win_arm runs after the move completes, within the same sw_update_player call, so it
      // sees this frame's just-moved position -- predicted only up to the first arm event; once
      // armed, drain timing (a separate, already-tested mechanism) takes over and this trace stops
      // claiming to predict it.
      const winPrediction = armedOnce
        ? null
        : predictWinArmStep({
            swCol: moved.swCol,
            swRow,
            playerX: moved.playerX,
            playerY,
            gridW,
            gridH,
            winColScreen: model.winColScreen,
            winColLocal: model.winColLocal,
            winRowScreen: model.winRowScreen,
            winRowLocal: model.winRowLocal,
            stActiveIn: model.stActive
          });

      nes.frame();

      assert.equal(mem[SW_WALK_ACC_X], moved.acc, `leg 1 frame ${i}: sw_walk_acc_x`);
      assert.equal(mem[PLAYER_X], moved.playerX, `leg 1 frame ${i}: player_x`);
      assert.equal(mem[SW_COL], moved.swCol, `leg 1 frame ${i}: sw_col`);
      if (moved.swCol !== model.swCol) crossedOnce = true;

      if (winPrediction) {
        assert.equal(mem[WIN_COL_SCREEN], winPrediction.winColScreen, `leg 1 frame ${i}: win_col_screen`);
        assert.equal(mem[WIN_COL_LOCAL], winPrediction.winColLocal, `leg 1 frame ${i}: win_col_local`);
        assert.equal(mem[ST_ACTIVE], winPrediction.stActive, `leg 1 frame ${i}: st_active`);
        if (winPrediction.armed) armedOnce = true;
      }

      model = {
        playerX: moved.playerX,
        acc: moved.acc,
        swCol: moved.swCol,
        winColScreen: winPrediction ? winPrediction.winColScreen : model.winColScreen,
        winColLocal: winPrediction ? winPrediction.winColLocal : model.winColLocal,
        winRowScreen: winPrediction ? winPrediction.winRowScreen : model.winRowScreen,
        winRowLocal: winPrediction ? winPrediction.winRowLocal : model.winRowLocal,
        // Once armed, defer to the real value: drain timing is out of this trace's own scope.
        stActive: armedOnce ? mem[ST_ACTIVE] : (winPrediction ? winPrediction.stActive : model.stActive)
      };
    }
    nes.buttonUp(1, RIGHT);
    assert.ok(crossedOnce, 'precondition: leg 1 must include a real screen crossing');
    assert.ok(armedOnce, 'precondition: leg 1 must include a real window-arm event');

    // Let any strip finish draining before the reversal leg -- this trace's own subject is the
    // accumulator/position/crossing formula across a reversal, not an interrupted drain (item 5's
    // own "reversal mid-drain" test already covers that separately).
    for (let i = 0; i < 60 && mem[ST_ACTIVE] !== 0; i++) nes.frame();
    assert.equal(mem[ST_ACTIVE], 0, 'precondition: the strip armed during leg 1 must have finished draining before leg 2 starts');
    model.acc = mem[SW_WALK_ACC_X];
    model.playerX = mem[PLAYER_X];
    model.swCol = mem[SW_COL];

    // ---- leg 2: reverse to Left across a real screen crossing back ----
    // The accumulator must keep its own cadence uninterrupted by the reversal (engine/
    // streamworld.asm's own comment: "persists only while that axis is the one actually moving,"
    // and sw_walk_step_x runs identically regardless of which direction is held) -- a reset or
    // corrupted accumulator on direction change would show up here as a wrong step size.
    nes.buttonDown(1, LEFT);
    let recrossedOnce = false;
    for (let i = 0; i < 60; i++) {
      const moved = predictHorizontalStep({ playerX: model.playerX, acc: model.acc, swCol: model.swCol, gridW, dir: 'left' });
      nes.frame();
      assert.equal(mem[SW_WALK_ACC_X], moved.acc, `leg 2 frame ${i}: sw_walk_acc_x`);
      assert.equal(mem[PLAYER_X], moved.playerX, `leg 2 frame ${i}: player_x`);
      assert.equal(mem[SW_COL], moved.swCol, `leg 2 frame ${i}: sw_col`);
      if (moved.swCol !== model.swCol) recrossedOnce = true;
      model = { ...model, playerX: moved.playerX, acc: moved.acc, swCol: moved.swCol };
    }
    nes.buttonUp(1, LEFT);
    assert.ok(recrossedOnce, 'precondition: leg 2 must include a real screen crossing back');
    guard.assertNone('plan test 7 (sustained crossing + reversal trace), ordinary design-rate workload');
    guard.unwatch();
  }
);

// Phase 2 slice "landing": the defect this closes -- sw_resolve_divdone used to align the window,
// camera and physical scroll to the ENTERED SCREEN'S OWN top-left corner (win_*_local=0,
// cam_x_lo/cam_y_lo=0, sw_cam_origin_x/y = that screen's own pixel origin) regardless of where the
// player actually landed inside it. Boot and redraw_screen's streamed branch rendered and displayed
// that top-left window immediately; sw_frame_camera_window's own per-frame tracking then only
// caught up to the true player-centred, map-clamped origin ~70 frames later, publishing it
// discontinuously (a visible jump) and leaving the visible rect outside completed content for that
// whole span.
//
// The fix (engine/streamworld.asm): sw_resolve_divdone now runs `jsr sw_enter_screen` (the single
// writer of sw_col/sw_row for this landing) then tail-calls the new sw_camera_window_install, which
// itself calls sw_camera_window_recompute -- the exact clamp/centre arithmetic
// sw_frame_camera_window's own per-frame tracking uses, factored out of it rather than copied --
// and installs the result directly as win_col/row_screen/local instead of only reaching it a few
// frames later via sw_win_arm's one-block-at-a-time approach. sw_frame_camera_window itself is now
// just `jsr sw_camera_window_recompute` / `jmp sw_win_arm`, so ordinary per-frame tracking is
// unchanged.
//
// Six landing positions -- an interior screen, each of the four clamped edges, and a clamped corner
// -- each landed at via BOTH cold boot (project.project.startMap/startScreen/startX/startY) and a
// warp/door through redraw_screen (an ordinary "Before" map with a spawn-triggered 'enter' event,
// the identical shape streamedmixed.test.js's own buildMixedProject uses) -- the brief's own
// "shared landing path (boot AND redraw_screen)" requirement. For each: the published camera origin
// and window equal predictDesiredWindow's identical clamp/centre formula, computed independently
// here rather than read back from a value the engine itself might have gotten wrong; the visible
// rect is contained in completed content from the very first observation; a subsequent idle frame
// (no button held) arms no strip and changes nothing (the "first tracking frame already at desired"
// requirement); and the ownership bytes -- flat_screen, sw_col/sw_row, player_x/player_y -- match
// the intended landing exactly as before this slice.
const LANDING_GRID_W = 3;
// 3, not the file's usual 2: at gridH=2 the Y window (30 blocks tall) exactly covers both screens
// at once, so clampWindowAxis pins win_row_screen/local to (0,0) for EVERY landing regardless of
// position -- indistinguishable from the window's own un-installed RAM default, which let a real
// sabotage run (Y half of sw_camera_window_install skipped entirely) pass all 12 cases undetected.
// gridH=3 gives the bottom-edge/corner cases a genuine, non-(0,0) desired row block.
const LANDING_GRID_H = 3;
// playerX/playerY are kept within [0,MAX_X]/[0,MAX_Y] (engine/constants.asm's own player-position
// ceiling, 256-16/240-16) rather than the raw [0,255]/[0,239] screen range, so the SAME position
// works identically via boot (project.project.startX/Y, uncompiled) and via door (the warp
// command's own operand, byte-clamped to exactly this ceiling at compile time -- main/build/
// textcompile.js's `byte(command.x, 240)`/`byte(command.y, 224)`, a pre-existing, in-scope-for-
// every-map compile step this slice does not touch). MAX_X/MAX_Y is well past enough of each axis'
// own clamp threshold (632/352 world-pixels, above) that every edge case below still lands on the
// clamped side of the camera formula at this ceiling.
const LANDING_CASES = [
  { label: 'interior', swCol: 1, swRow: 0, playerX: 128, playerY: 200 },
  { label: 'left edge', swCol: 0, swRow: 0, playerX: 0, playerY: 200 },
  { label: 'right edge', swCol: 2, swRow: 0, playerX: MAX_X, playerY: 200 },
  { label: 'top edge', swCol: 1, swRow: 0, playerX: 128, playerY: 0 },
  { label: 'bottom edge', swCol: 1, swRow: 2, playerX: 128, playerY: MAX_Y },
  { label: 'corner (bottom-right)', swCol: 2, swRow: 2, playerX: MAX_X, playerY: MAX_Y },
  // Fix round 1, finding 3: every case above lands with camera Y in {0,88,480}, all even screen-
  // row parity, so cam_nt's bit1 (the "vertical nametable bit") was never exercised as 1 by any
  // case here. worldX=1*256+128=384, worldY=1*240+128=368; camPx=clamp(384-120,0,512)=264 (bit8=1),
  // camPy=clamp(368-112,0,480)=256 (floor(256/240)=1, an ODD screen row) -- cam_nt=3, both bits
  // set. This also lands the desired window on a genuinely NONZERO local offset on both axes
  // (desColLocal=8, desRowLocal=9 -- worked by hand, matching test/lua/build_sw_render_roms.mjs's
  // own identical owner/local pair, independently), the same gap finding 3 names for
  // makeContainmentChecker's block-granular (not local-granular) containment math -- already
  // correct for a nonzero local offset, unlike assertWindowMatchesDecoded (streamworld.test.js),
  // which this case does not use.
  { label: 'interior odd row', swCol: 1, swRow: 1, playerX: 128, playerY: 128 }
];

// TL-corner OAM projection (test/unit/streamworldprojection.test.js's own projectAxis/projectY,
// mirrored here): delta = (world - origin) mod 65536. X reports the low byte directly (no width
// restriction -- the TL corner's own delta is always < 256 for every LANDING_CASES entry, verified
// by the assertions below, which is why this file never checks a `visible` flag alongside it); Y
// reports (delta-1)&0xff, sw_oam_project_y's own one-scanline-early -1.
function projectOamX(worldX, originX) {
  return (worldX - originX) & 0xff;
}
function projectOamY(worldY, originY) {
  return ((worldY - originY) & 0xffff) - 1 & 0xff;
}

// Fix round 2 (review round 2 finding (a)): rendered-content oracle for the landing group. Ported,
// not reinvented, from test/lua/build_sw_render_roms.mjs's own resolveBlock/contentAt -- the same
// per-BLOCK mapping (wbase_col/row, physical-to-world delta, colAtOffset/rowAtOffset) that oracle's
// own header documents as a full transcription of sw_render_window's real algorithm
// (engine/streamworld.asm), independently re-derived here rather than imported, matching this
// file's own "read the file it is checking proves nothing" discipline. Unlike that Lua fixture
// (which checks every block of all four physical nametables, appropriate for a single fixed cold-
// boot landing), this covers only the VISIBLE rectangle -- the actual on-screen blocks implied by
// the published scroll -- but does so for every LANDING_CASES entry, via both boot and redraw, at
// the exact same firstEnableMem/firstEnablePPU boundary the bookkeeping assertions already use.
//
// Every one of the grid's LANDING_GRID_W*LANDING_GRID_H screens is authored with ONE uniform,
// screen-unique metatile (distinct tile ids AND distinct palette, cycling 1-3) -- not
// createStreamedProject's own default varied-then-fill pattern, which is mostly FILL_METATILE_ID
// and so cannot tell a wrong block offset from a right one across most of a screen. A wrong
// row-local or col-local offset at redraw time (this round's own discriminating mutation) shifts
// which screen's own unique tile/palette appears at a given physical position, so it cannot
// coincide with the correct picture.
const SCREEN_METATILE_BASE = 1; // ids 1..LANDING_GRID_W*LANDING_GRID_H
const FILL_METATILE_ID = 0; // matches buildStreamedMap's own fillMetatileId (test/lib/streamedproject.js)
const FILL_TILES = [50, 60, 70, 80];
const FILL_PALETTE = 0;
function screenMetatileId(screenIndex) {
  return SCREEN_METATILE_BASE + screenIndex;
}
function screenTiles(screenIndex) {
  const t = screenMetatileId(screenIndex) * 4;
  return [t, t + 1, t + 2, t + 3];
}
function screenPalette(screenIndex) {
  return 1 + (screenIndex % 3); // never 0 (FILL_PALETTE)
}
function authorLandingTerrain(project) {
  const map = project.maps.find((m) => m.streamed);
  for (let i = 0; i < LANDING_GRID_W * LANDING_GRID_H; i++) {
    map.screens[i].metatiles.fill(screenMetatileId(i));
  }
  project.metatiles[FILL_METATILE_ID] = { id: FILL_METATILE_ID, name: 'LandingFill', tiles: FILL_TILES, palette: FILL_PALETTE, collision: 'open' };
  for (let i = 0; i < LANDING_GRID_W * LANDING_GRID_H; i++) {
    const id = screenMetatileId(i);
    project.metatiles[id] = { id, name: `LandingScreen${i}`, tiles: screenTiles(i), palette: screenPalette(i), collision: 'open' };
  }
}

// wbase_col/row -- the window's own physical ring origin (sw_render_window, engine/streamworld.asm).
function wbaseAxis(screen, local, screenSize) {
  return (screen & 1) * screenSize + local;
}
// sw_col_at_offset's own inverse: a physical-ring column delta back to a world (screen,local).
function colAtOffset(delta, winColScreen, winColLocal) {
  const t = delta + winColLocal;
  return { screen: winColScreen + (t >> 4), local: t & 15 };
}
// sw_row_at_offset's own inverse (240 isn't a power of two, so this is repeated subtraction, not a
// shift, exactly like the reference oracle it is ported from).
function rowAtOffset(delta, winRowScreen, winRowLocal) {
  let t = delta + winRowLocal;
  let count = 0;
  while (t >= 15) {
    t -= 15;
    count += 1;
  }
  return { screen: winRowScreen + count, local: t };
}
// Given a physical ring position expressed as (colDelta,rowDelta) relative to the window's own
// origin (both already in [0,31]/[0,29] -- the caller never passes an out-of-range delta), resolve
// which physical nametable/block it lives in -- resolveBlock's own physCol/physRow -> nt/bc/br
// split (NT_PHYS_COL=[0,16,0,16], NT_PHYS_ROW=[0,0,15,15]) run forward from the window's own wbase,
// instead of backward from an already-known physical position.
function physicalFromDelta(colDelta, rowDelta, window) {
  const wbaseCol = wbaseAxis(window.colScreen, window.colLocal, 16);
  const wbaseRow = wbaseAxis(window.rowScreen, window.rowLocal, 15);
  const physCol = (wbaseCol + colDelta) % 32;
  const physRow = (wbaseRow + rowDelta) % 30;
  const nt = (physCol >= 16 ? 1 : 0) | (physRow >= 15 ? 2 : 0);
  return { nt, bc: physCol % 16, br: physRow % 15 };
}
// The authored content a correctly-rendered block at ring offset (colDelta,rowDelta) from the
// window's own origin must hold -- sw_col_at_offset/sw_row_at_offset's own inverse (colAtOffset/
// rowAtOffset above), independently derived from the window's own current origin, never read back
// from the engine.
function expectedBlockContent(colDelta, rowDelta, window) {
  const at = colAtOffset(colDelta, window.colScreen, window.colLocal);
  const rowAt = rowAtOffset(rowDelta, window.rowScreen, window.rowLocal);
  const inBounds = at.screen >= 0 && at.screen < LANDING_GRID_W && rowAt.screen >= 0 && rowAt.screen < LANDING_GRID_H;
  if (!inBounds) return { tiles: FILL_TILES, palette: FILL_PALETTE };
  const screenIndex = rowAt.screen * LANDING_GRID_W + at.screen;
  return { tiles: screenTiles(screenIndex), palette: screenPalette(screenIndex) };
}

// Reads the visible rectangle (from the real published scroll -- camPx/camPy, block-granular, plus
// the partial-edge block a nonzero fine offset exposes) out of a firstEnablePPU snapshot and asserts
// every tile id and attribute byte against expectedBlockContent's independent oracle. `window` is
// {colScreen,colLocal,rowScreen,rowLocal} -- predictDesiredWindow's own desCol/desColLocal/desRow/
// desRowLocal fields, renamed here to match resolveBlock's own parameter shape.
//
// The window's own origin is NOT the visible rectangle's own top-left corner: predictDesiredWindow
// deliberately starts the buffered window 8 blocks (X) / 7 blocks (Y) BEHIND the camera's own
// viewport (desiredBlockX = camBlockX-8, desiredBlockY = camBlockY-7, each clamped) so there is
// already-drawn content on both sides as the camera keeps moving. The delta from the window's own
// flat origin to the visible rectangle's own top-left corner is therefore camBlock - windowFlat,
// generally 8/7 but LESS at a grid edge where the window's own clamp already pins it at 0 -- an
// earlier version of this function assumed delta 0 (the window's own origin) was always the first
// visible block, which missed every real content defect this check exists to catch (verified against
// the round-2 reviewer's own visible-content-tests.mjs sampler and its exact "bx=16,by=30" first
// mismatch, reproduced here as the same (colDelta,rowDelta)=(8,21) position for the identical case).
function assertVisibleContent(firstEnablePPU, window, camPx, camPy, tag) {
  const windowFlatX = window.colScreen * 16 + window.colLocal;
  const windowFlatY = window.rowScreen * 15 + window.rowLocal;
  const colDeltaStart = Math.floor(camPx / 16) - windowFlatX;
  const rowDeltaStart = Math.floor(camPy / 16) - windowFlatY;
  const visBlocksX = 16 + (camPx % 16 !== 0 ? 1 : 0);
  const visBlocksY = 15 + (camPy % 16 !== 0 ? 1 : 0);
  for (let ry = 0; ry < visBlocksY; ry++) {
    const rowDelta = rowDeltaStart + ry;
    for (let rx = 0; rx < visBlocksX; rx++) {
      const colDelta = colDeltaStart + rx;
      const { nt, bc, br } = physicalFromDelta(colDelta, rowDelta, window);
      const { tiles, palette } = expectedBlockContent(colDelta, rowDelta, window);
      const ntable = firstEnablePPU[nt];
      const base = 2 * br * 32 + 2 * bc; // NameTable width is 32 tiles (nametable.js)
      const positions = [base, base + 1, base + 32, base + 33];
      const corners = ['tl', 'tr', 'bl', 'br'];
      for (let k = 0; k < 4; k++) {
        assert.equal(ntable.tile[positions[k]], tiles[k],
          `${tag}: visible block (nt ${nt}, ${bc},${br}) ${corners[k]} tile id`);
        assert.equal(ntable.attrib[positions[k]], palette * 4,
          `${tag}: visible block (nt ${nt}, ${bc},${br}) ${corners[k]} attribute/palette`);
      }
    }
  }
}

async function landOnStreamedViaBoot({ swCol, swRow, playerX, playerY }) {
  const project = createStreamedProject({ gridW: LANDING_GRID_W, gridH: LANDING_GRID_H });
  authorLandingTerrain(project);
  const screenIndex = swRow * LANDING_GRID_W + swCol;
  project.project.startMap = 0;
  project.project.startScreen = screenIndex;
  project.project.startX = playerX;
  project.project.startY = playerY;
  const { nes, mem, firstEnableMem, firstEnablePPU, afterFirstTrackingMem } = await buildAndBootLanding(project);
  return { nes, mem, firstEnableMem, firstEnablePPU, afterFirstTrackingMem, flatScreen: screenIndex };
}

async function landOnStreamedViaDoor({ swCol, swRow, playerX, playerY }) {
  // mixed:true carries an ordinary 2x2 "Before" map (global screens 0-3) ahead of the streamed map
  // (createStreamedProject's own fixed layout), so the streamed map's own screens start at global
  // id 4 -- the identical arithmetic streamedmixed.test.js's own buildMixedProject uses. The player
  // boots onto Before screen 0 (project's own startMap/startScreen defaults) and an 'enter'-
  // triggered NPC sitting exactly at the default spawn (project.project.startX/Y) fires the warp
  // the instant gameplay begins, the same "arrives already armed" shape buildMixedProject documents.
  const project = createStreamedProject({ gridW: LANDING_GRID_W, gridH: LANDING_GRID_H, mixed: true });
  authorLandingTerrain(project);
  const [before] = project.maps;
  const streamedBase = 4;
  const screenIndex = swRow * LANDING_GRID_W + swCol;
  const targetGlobal = streamedBase + screenIndex;
  project.sprites.actors.push({ name: 'Door', behavior: 'npc', hp: 1, damage: 0 });
  const actorId = project.sprites.actors.length - 1;
  before.screens[0].entities.push({
    actorId,
    x: project.project.startX,
    y: project.project.startY,
    props: {
      trigger: 'enter',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'warp', screen: targetGlobal, x: playerX, y: playerY }] }] }
    }
  });
  const { nes, mem, firstEnableMem, firstEnablePPU, afterFirstTrackingMem } = await buildAndBootLanding(project);
  return { nes, mem, firstEnableMem, firstEnablePPU, afterFirstTrackingMem, flatScreen: targetGlobal };
}

test('streamed landing installs the tracking window directly (phase 2 slice "landing")', { skip: !hasNesasm && 'nesasm not on PATH' }, async (t) => {
  for (const via of ['boot', 'door']) {
    for (const c of LANDING_CASES) {
      await t.test(`${via}, ${c.label}`, async () => {
        const { mem, firstEnableMem, firstEnablePPU, afterFirstTrackingMem, flatScreen } = via === 'boot'
          ? await landOnStreamedViaBoot(c)
          : await landOnStreamedViaDoor(c);
        const tag = `${via}, ${c.label}`;

        const expected = predictDesiredWindow({
          swCol: c.swCol, swRow: c.swRow, playerX: c.playerX, playerY: c.playerY,
          gridW: LANDING_GRID_W, gridH: LANDING_GRID_H
        });
        const expectedCamNt = ((expected.camPx >> 8) & 1) | ((Math.floor(expected.camPy / 240) & 1) << 1);
        const worldX = c.swCol * 256 + c.playerX;
        const worldY = c.swRow * 240 + c.playerY;
        const expectedOamX = projectOamX(worldX, expected.camPx);
        const expectedOamY = projectOamY(worldY, expected.camPy);

        // ---- fix round 1, finding 1: the REAL first displayed frame -- firstEnableMem, a full RAM
        // snapshot taken synchronously at the landing's own $2001 display-enable write, before ANY
        // later frame's own tracking call could repair a wrong initial publication.

        // Ownership: exactly today's fields, untouched by this slice.
        assert.equal(firstEnableMem[FLAT_SCREEN], flatScreen, `${tag}: flat_screen at first display-enable`);
        assert.equal(firstEnableMem[SW_COL], c.swCol, `${tag}: sw_col at first display-enable`);
        assert.equal(firstEnableMem[SW_ROW], c.swRow, `${tag}: sw_row at first display-enable`);
        assert.equal(firstEnableMem[PLAYER_X], c.playerX, `${tag}: player_x at first display-enable`);
        assert.equal(firstEnableMem[PLAYER_Y], c.playerY, `${tag}: player_y at first display-enable`);

        // Published world camera origin equals the identical clamped, player-centred formula
        // tracking itself would compute -- independently derived here, never read back from the
        // engine.
        const camX0 = (firstEnableMem[SW_CAM_ORIGIN_X_HI] << 8) | firstEnableMem[SW_CAM_ORIGIN_X_LO];
        const camY0 = (firstEnableMem[SW_CAM_ORIGIN_Y_HI] << 8) | firstEnableMem[SW_CAM_ORIGIN_Y_LO];
        assert.equal(camX0, expected.camPx, `${tag}: sw_cam_origin_x at first display-enable`);
        assert.equal(camY0, expected.camPy, `${tag}: sw_cam_origin_y at first display-enable`);
        // The real PPU scroll/nametable-select half of the same publish (docs/reference-engine.md's
        // "publish consistent camera/scroll/OAM before display enables"), not merely the world-space
        // sw_cam_origin_x/y tracking value -- catches a landing that installs the window correctly
        // but leaves cam_x_lo/cam_y_lo/cam_nt at their own boot-clear default (case 20's own
        // "hardcoded 0" sabotage shape, phase 2 plan's sabotage list) -- checked here, at the real
        // display-enable boundary, not after a later tracking call could have repaired it.
        assert.equal(firstEnableMem[CAM_X_LO], expected.camPx & 0xff, `${tag}: cam_x_lo at first display-enable`);
        assert.equal(firstEnableMem[CAM_Y_LO], expected.camPy % 240, `${tag}: cam_y_lo at first display-enable`);
        assert.equal(firstEnableMem[CAM_NT], expectedCamNt, `${tag}: cam_nt at first display-enable`);

        // The window itself is already the desired one on the first displayed frame -- not merely
        // armed toward it.
        assert.equal(firstEnableMem[WIN_COL_SCREEN], expected.desCol, `${tag}: win_col_screen at first display-enable`);
        assert.equal(firstEnableMem[WIN_COL_LOCAL], expected.desColLocal, `${tag}: win_col_local at first display-enable`);
        assert.equal(firstEnableMem[WIN_ROW_SCREEN], expected.desRow, `${tag}: win_row_screen at first display-enable`);
        assert.equal(firstEnableMem[WIN_ROW_LOCAL], expected.desRowLocal, `${tag}: win_row_local at first display-enable`);
        assert.equal(firstEnableMem[ST_ACTIVE], 0, `${tag}: st_active must be idle at first display-enable -- nothing left to arm`);

        // The player's own on-screen (TL-corner) OAM position, independently projected from the
        // same expected world camera origin above.
        assert.equal(firstEnableMem[OAM + 3], expectedOamX, `${tag}: player's own TL-corner OAM X at first display-enable`);
        assert.equal(firstEnableMem[OAM], expectedOamY, `${tag}: player's own TL-corner OAM Y at first display-enable`);

        // The visible rect is inside completed content from the very first displayed frame.
        makeContainmentChecker(firstEnableMem, { gridW: LANDING_GRID_W, gridH: LANDING_GRID_H })(`${tag}: first display-enable`);

        // Fix round 2 (review round 2 finding (a)): the rendered PPU nametable/attribute content of
        // the visible rectangle itself, from the same real $2001 display-enable snapshot, for BOTH
        // boot and redraw (door) landings -- not merely the RAM bookkeeping above. A landing whose
        // window/camera/OAM bookkeeping is all correct but whose render (sw_render_window/
        // redraw_screen) drew the wrong row-local/col-local offset now fails here.
        assertVisibleContent(
          firstEnablePPU,
          { colScreen: expected.desCol, colLocal: expected.desColLocal, rowScreen: expected.desRow, rowLocal: expected.desRowLocal },
          expected.camPx, expected.camPy, `${tag}: first display-enable render`
        );

        // ---- the first real tracking call (one nes.frame() later) computes "already at desired"
        // and arms nothing -- observed separately from the display-enable snapshot above.
        assert.equal(afterFirstTrackingMem[ST_ACTIVE], 0, `${tag}: the first tracking frame must not arm a strip`);
        assert.equal(afterFirstTrackingMem[WIN_COL_SCREEN], expected.desCol, `${tag}: win_col_screen must not drift on the first tracking frame`);
        assert.equal(afterFirstTrackingMem[WIN_COL_LOCAL], expected.desColLocal, `${tag}: win_col_local must not drift on the first tracking frame`);
        assert.equal(afterFirstTrackingMem[WIN_ROW_SCREEN], expected.desRow, `${tag}: win_row_screen must not drift on the first tracking frame`);
        assert.equal(afterFirstTrackingMem[WIN_ROW_LOCAL], expected.desRowLocal, `${tag}: win_row_local must not drift on the first tracking frame`);
        const camX1 = (afterFirstTrackingMem[SW_CAM_ORIGIN_X_HI] << 8) | afterFirstTrackingMem[SW_CAM_ORIGIN_X_LO];
        const camY1 = (afterFirstTrackingMem[SW_CAM_ORIGIN_Y_HI] << 8) | afterFirstTrackingMem[SW_CAM_ORIGIN_Y_LO];
        assert.equal(camX1, expected.camPx, `${tag}: sw_cam_origin_x must not drift on the first tracking frame`);
        assert.equal(camY1, expected.camPy, `${tag}: sw_cam_origin_y must not drift on the first tracking frame`);
        makeContainmentChecker(afterFirstTrackingMem, { gridW: LANDING_GRID_W, gridH: LANDING_GRID_H })(`${tag}: first tracking frame`);

        // ---- additional stability check (kept from the pre-fix version): still settled a further
        // 99 frames later (nes/mem are already advanced that far by buildAndBootLanding).
        assert.equal(mem[ST_ACTIVE], 0, `${tag}: settled state must still have nothing armed`);
        assert.equal(mem[WIN_COL_SCREEN], expected.desCol, `${tag}: win_col_screen must still match once settled`);
        assert.equal(mem[WIN_COL_LOCAL], expected.desColLocal, `${tag}: win_col_local must still match once settled`);
        assert.equal(mem[WIN_ROW_SCREEN], expected.desRow, `${tag}: win_row_screen must still match once settled`);
        assert.equal(mem[WIN_ROW_LOCAL], expected.desRowLocal, `${tag}: win_row_local must still match once settled`);
        makeContainmentChecker(mem, { gridW: LANDING_GRID_W, gridH: LANDING_GRID_H })(`${tag}: settled`);
      });
    }
  }
});
