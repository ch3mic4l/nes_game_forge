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
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import NES from '../../renderer/emulator/core/nes.js';
import { actionDetail } from '../../renderer/forges/controller/controller.js';
import { createProject } from '../../shared/project.js';
import { callRoutine } from '../lib/callroutine.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// from engine/constants.asm
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const GAME_STATE = 0x25;
const KB_TIMER = 0x50;
const KB_DIR = 0x51;
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

// from renderer/emulator/core/controller.js. Default gameplay bindings (shared/project.js:4280)
// map B, not A, to the 'interact' action -- A is 'attack'.
const B = 1;
const UP = 4;
const DOWN = 5;
const LEFT = 6;
const RIGHT = 7;

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
  return { desCol: col.screen, desColLocal: col.local, desRow: row.screen, desRowLocal: row.local };
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

async function buildAndBoot(project, { requireStreamed = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworldmove-'));
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
    // game_state/map_is_streamed are set early in the landing sequence, well before
    // sw_render_window's own full-window forced-blank draw actually finishes (the same
    // "flat_screen is already the new value well before the draw completes" property
    // test/unit/streamedmixed.test.js's own runUntilFlatScreenChanges documents) -- a real
    // cold-boot render on this project's exact grid was measured (scratchpad probe) to take
    // ~38 nes.frame() calls; 100 is a generous, deterministic margin past that, cheap next to
    // the hundreds of settle frames other passing tests already spend.
    for (let i = 0; i < 100; i++) nes.frame();
    return { nes, mem };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('streamworldmove', { skip: !hasNesasm && 'nesasm not on PATH' }, async (t) => {
  await t.test('X accumulator: held Right steps player_x by the documented 1,2,1,2... cadence', async () => {
    const project = createStreamedProject({});
    const { nes, mem } = await buildAndBoot(project);
    const trace = simulateWalk(SW_SPEED_SUB_X, 6);
    let expected = mem[PLAYER_X];
    nes.buttonDown(1, RIGHT);
    for (const step of trace) {
      nes.frame();
      expected += step;
      assert.equal(mem[PLAYER_X], expected, `player_x after this tick`);
    }
    nes.buttonUp(1, RIGHT);
  });

  await t.test('Y accumulator: held Down steps player_y by the documented 1,2,1,2... cadence', async () => {
    const project = createStreamedProject({});
    const { nes, mem } = await buildAndBoot(project);
    const trace = simulateWalk(SW_SPEED_SUB_Y, 6);
    let expected = mem[PLAYER_Y];
    nes.buttonDown(1, DOWN);
    for (const step of trace) {
      nes.frame();
      expected += step;
      assert.equal(mem[PLAYER_Y], expected, `player_y after this tick`);
    }
    nes.buttonUp(1, DOWN);
  });

  await t.test('dash is genuinely ignored: cadence is unchanged while dash_on is forced set', async () => {
    const project = createStreamedProject({});
    const { nes, mem } = await buildAndBoot(project);
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
  });

  // Fix round 1, finding 7: the streamed driver used to return without ever running the ordinary
  // movement animation bookkeeping (engine/player.asm:70-98's update_player_anim tail) -- moving
  // was set by sw_pstep_*'s own `inc <moving>`, but anim_timer never advanced and anim_frame never
  // toggled. sw_update_player now runs the identical shape at its own tail (engine/streamworld.asm
  // sw_up_hazard.. sw_up_camera). Each assertion below is checked every single frame against the
  // exact documented algorithm (inc timer; at ANIM_RATE, reset and toggle), not just a final value.
  await t.test('walk animation: moving on a streamed map advances anim_timer/toggles anim_frame at the ordinary ANIM_RATE cadence', async () => {
    const project = createStreamedProject({});
    const { nes, mem } = await buildAndBoot(project);
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
  });

  await t.test('walk animation: releasing input resets moving/anim_timer/anim_frame to 0 the following frame', async () => {
    const project = createStreamedProject({});
    const { nes, mem } = await buildAndBoot(project);
    nes.buttonDown(1, RIGHT);
    for (let i = 0; i < 10; i++) nes.frame();
    assert.equal(mem[MOVING], 1, 'precondition: still moving after 10 held frames');
    nes.buttonUp(1, RIGHT);
    nes.frame();
    assert.equal(mem[MOVING], 0, 'moving must clear the frame after the button is released');
    assert.equal(mem[ANIM_TIMER], 0, 'anim_timer must reset to 0 on a released/standing frame, matching update_player_stand');
    assert.equal(mem[ANIM_FRAME], 0, 'anim_frame must reset to 0 on a released/standing frame, matching update_player_stand');
  });

  await t.test('walk animation freezes on the crossing frame itself, exactly as the ordinary engine\'s own screen_fresh check in update_player_anim', async () => {
    const project = createStreamedProject({});
    project.project.startX = 235; // close to MAX_X -- crosses within a handful of frames
    const { nes, mem } = await buildAndBoot(project);
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
  });

  await t.test('axis arbitration: a fresh press on the other axis takes over mid-hold', async () => {
    const project = createStreamedProject({});
    const { nes, mem } = await buildAndBoot(project);
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
  });

  await t.test('axis arbitration: a simultaneous fresh press of both axes has X win the tie', async () => {
    const project = createStreamedProject({});
    const { nes, mem } = await buildAndBoot(project);
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
  });

  await t.test('crossing right: sw_col increments, player_x wraps to 0, the window keeps pace', async () => {
    const project = createStreamedProject({});
    project.project.startX = 235; // close to MAX_X=240 -- crosses within a handful of frames
    const { nes, mem } = await buildAndBoot(project);
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
  });

  await t.test('camera publish: cam_x_lo/cam_nt match the documented clamp formula while walking, unclamped', async () => {
    const project = createStreamedProject({});
    const { nes, mem } = await buildAndBoot(project);
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
  });

  await t.test('window arm: win_col_local tracks the player leaving the margin, st_active drains back to 0', async () => {
    const project = createStreamedProject({});
    const { nes, mem } = await buildAndBoot(project);
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
  });

  await t.test('capped knockback moves the player 1px/frame on a streamed map, not the ordinary 3', async () => {
    const project = createStreamedProject({});
    const { nes, mem } = await buildAndBoot(project);
    mem[KB_TIMER] = 4;
    mem[KB_DIR] = DIR_RIGHT;
    let prevX = mem[PLAYER_X];
    for (let i = 0; i < 4; i++) {
      nes.frame();
      assert.equal(mem[PLAYER_X], prevX + 1, `knockback tick ${i} must move exactly 1px, not KNOCKBACK_SPEED's ordinary 3`);
      prevX = mem[PLAYER_X];
    }
    assert.equal(mem[KB_TIMER], 0, 'kb_timer must have counted all the way down');
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
    const { nes, mem } = await buildAndBoot(project);
    const xBefore = mem[PLAYER_X];
    nes.buttonDown(1, RIGHT);
    nes.buttonDown(1, B);
    nes.frame();
    assert.equal(mem[GAME_STATE], ST_DIALOG, 'pressing interact next to the NPC must open a conversation this frame');
    assert.equal(mem[PLAYER_X], xBefore, 'the player must not also move on the frame the conversation opens');
    nes.buttonUp(1, RIGHT);
    nes.buttonUp(1, B);
  });

  await t.test('an interact press that finds nobody in reach does not freeze movement', async () => {
    const project = createStreamedProject({});
    const { nes, mem } = await buildAndBoot(project);
    const xBefore = mem[PLAYER_X];
    nes.buttonDown(1, RIGHT);
    nes.buttonDown(1, B);
    nes.frame();
    assert.notEqual(mem[GAME_STATE], ST_DIALOG, 'no NPC is in reach -- no conversation should open');
    assert.notEqual(mem[PLAYER_X], xBefore, 'pressing interact into empty space must not freeze a frame that never needed it');
    nes.buttonUp(1, RIGHT);
    nes.buttonUp(1, B);
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
    const { nes, mem } = await buildAndBoot(project);
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
  });

  await t.test('sw_event_freeze is cleared every frame in main_loop_idle', async () => {
    const project = createStreamedProject({});
    const { nes, mem } = await buildAndBoot(project);
    nes.frame();
    assert.equal(mem[SW_EVENT_FREEZE], 0, 'sw_event_freeze must read 0 on an ordinary frame');
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
  let frames = 0;
  while ((mem[GAME_STATE] !== ST_GAMEPLAY || mem[MAP_IS_STREAMED] !== 1) && frames < 200) {
    nes.frame();
    frames++;
  }
  assert.ok(frames < 200, 'cold boot must reach ST_GAMEPLAY well within 200 frames');
  for (let i = 0; i < 100; i++) nes.frame();
  return { dir, nes, mem, addrOf };
}

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
    const { nes, mem } = await buildWallScenario({ startY: 32, col: 0, row: 3 });
    const before = mem[PLAYER_Y];
    nes.buttonDown(1, DOWN);
    nes.frame();
    assert.equal(mem[PLAYER_Y], before, 'a solid tile under the left BODY_B corner must block Down entirely');
  });

  await t.test('down-right-wall: a solid tile under the RIGHT leading corner (BODY_R, BODY_B) blocks Down -- a positive control the diagonal-probe bug already passed by accident', async () => {
    const { nes, mem } = await buildWallScenario({ startY: 32, col: 1, row: 3 });
    const before = mem[PLAYER_Y];
    nes.buttonDown(1, DOWN);
    nes.frame();
    assert.equal(mem[PLAYER_Y], before, 'a solid tile under the right BODY_B corner must block Down');
  });

  await t.test('up-right-wall: a solid tile under the RIGHT leading corner (BODY_R, BODY_T) blocks Up -- the diagonal-probe bug missed this by checking BODY_B there instead', async () => {
    const { nes, mem } = await buildWallScenario({ startY: 40, col: 1, row: 2 });
    const before = mem[PLAYER_Y];
    nes.buttonDown(1, UP);
    nes.frame();
    assert.equal(mem[PLAYER_Y], before, 'a solid tile under the right BODY_T corner must block Up entirely');
  });

  await t.test('up-left-wall: a solid tile under the LEFT leading corner (BODY_L, BODY_T) blocks Up -- a positive control the diagonal-probe bug already passed by accident', async () => {
    const { nes, mem } = await buildWallScenario({ startY: 40, col: 0, row: 2 });
    const before = mem[PLAYER_Y];
    nes.buttonDown(1, UP);
    nes.frame();
    assert.equal(mem[PLAYER_Y], before, 'a solid tile under the left BODY_T corner must block Up');
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
    const { nes, mem } = await buildAndBoot(project);
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
    const { nes, mem } = await buildAndBoot(project);
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
    const { nes, mem } = await buildAndBoot(project);
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
  });

  await t.test('mixed chunk 2 at <=35 bytes: a real 35-byte vram_buf packet drains AND the real-armed strip still advances by SW_STREAM_MIXED_CHUNK (2) that same frame', async () => {
    const project = createStreamedProject({});
    const { nes, mem } = await buildAndBoot(project);
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
  });

  await t.test('exclusive drain above 35 bytes: a real 36-byte vram_buf packet still drains, but the real-armed strip is stalled (0 blocks) that frame', async () => {
    const project = createStreamedProject({});
    const { nes, mem } = await buildAndBoot(project);
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
  });

  await t.test('active strip serviced while the world is frozen: `paused` stops the player, never the NMI strip drain (docs/reference-engine.md: "st_active alone gates the strip drawer, never game_state/paused")', async () => {
    const project = createStreamedProject({});
    const { nes, mem } = await buildAndBoot(project);
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
      const { nes, mem } = await buildAndBoot(project);
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
    });

    await t.test('entering edge, positive sign (vertical): crossing down increments sw_row and wraps player_y to its own signed overshoot', async () => {
      const project = createStreamedProject({ gridH: 3 });
      project.project.startY = 219; // close to the 240 row boundary -- crosses within a handful of frames
      const { nes, mem } = await buildAndBoot(project);
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
    });

    // NEEDS-RULING, same real defect as 'entering edge, negative sign: crossing left' above, Y
    // axis: measured worst margin -6 blocks at frame 35 of real tracking, recovering only by frame
    // ~101. See that test's own comment and the gates report for the full measurement and repro.
    await t.test('entering edge, negative sign (vertical): crossing up decrements sw_row and wraps player_y to its own signed overshoot, never the ordinary MAX_Y snap', async () => {
      const project = createStreamedProject({ gridH: 3 });
      project.project.startY = 5;
      project.project.startScreen = 1 * 3; // row 1, col 0 -- a real neighbour above exists (row 0)
      const { nes, mem } = await buildAndBoot(project);
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
      const { nes, mem } = await buildAndBoot(project);
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
    });

    // -------------------------------------------------- axis handoff
    await t.test('axis handoff mid-crossing: switching to the other axis before a crossing completes does not corrupt it', async () => {
      const project = createStreamedProject({});
      project.project.startX = 235; // a couple of frames from crossing (SW_SPEED_SUB_X's 1,2,1,2... cadence)
      const { nes, mem } = await buildAndBoot(project);
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
        const { nes, mem } = await buildAndBoot(project);
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
        const { nes, mem } = await buildAndBoot(project);
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
      }
    });

    // -------------------------------------------------- 1x1/1xN/Nx1/2-screen axis configurations
    await t.test('1x1 grid: every direction is refused immediately, sw_col/sw_row never move', async () => {
      const project = createStreamedProject({ gridW: 1, gridH: 1 });
      const { nes, mem } = await buildAndBoot(project);
      for (const dir of [LEFT, RIGHT, UP, DOWN]) {
        nes.buttonDown(1, dir);
        for (let i = 0; i < 60; i++) {
          nes.frame();
          assert.equal(mem[SW_COL], 0, `a 1x1 grid must never move sw_col, direction under test`);
          assert.equal(mem[SW_ROW], 0, `a 1x1 grid must never move sw_row, direction under test`);
        }
        nes.buttonUp(1, dir);
      }
    });

    await t.test('1xN grid (gridW=1): only vertical crossing is legal, horizontal is refused', async () => {
      const project = createStreamedProject({ gridW: 1, gridH: 3 });
      project.project.startScreen = 1; // middle row -- both Up and Down have a real neighbour
      project.project.startY = 219;
      const { nes, mem } = await buildAndBoot(project);
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
    });

    await t.test('Nx1 grid (gridH=1): only horizontal crossing is legal, vertical is refused', async () => {
      const project = createStreamedProject({ gridW: 3, gridH: 1 });
      project.project.startScreen = 1; // middle col -- both Left and Right have a real neighbour
      project.project.startX = 5;
      const { nes, mem } = await buildAndBoot(project);
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
    });

    await t.test('2-screen grid: the window origin never leaves 0 on an axis whose grid span equals the window\'s own span', async () => {
      // The window/viewport clamp (docs/design-streamed-worlds.md) bounds the resident window's
      // own origin to [0, gridScreens - windowScreens] per axis -- a 2-screen-wide grid against a
      // 2-screen-wide window leaves exactly one legal origin, 0, on that axis: win_col_screen/
      // win_col_local must never read anything else, on landing or after any amount of walking.
      const project = createStreamedProject({ gridW: 2, gridH: 2 });
      const { nes, mem } = await buildAndBoot(project);
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
      const { nes, mem } = await buildAndBoot(project);
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
      const { nes, mem } = await buildAndBoot(project);
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
    });

    await t.test('camera clamp: a 1-wide (1xN) grid pins the X axis at 0 throughout, and the Y axis holds at the world-height ceiling at the bottom edge', async () => {
      const gridW = 1, gridH = 3;
      const project = createStreamedProject({ gridW, gridH });
      const { nes, mem } = await buildAndBoot(project);
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
    });

    await t.test('camera clamp: a 1-tall (Nx1) grid pins the Y axis at 0 throughout, mirroring the 1-wide case on the other axis', async () => {
      const gridW = 3, gridH = 1;
      const project = createStreamedProject({ gridW, gridH });
      const { nes, mem } = await buildAndBoot(project);
      nes.buttonDown(1, RIGHT);
      for (let i = 0; i < 700; i++) {
        nes.frame();
        assert.equal(mem[CAM_Y_LO], 0, `frame ${i}: cam_y_lo must stay 0 on a 1-tall grid -- its own ceiling is (1-1)*240=0`);
        assert.equal(mem[CAM_NT] & 2, 0, `frame ${i}: cam_nt bit1 (Y row parity) must stay 0 on a 1-tall grid`);
      }
      nes.buttonUp(1, RIGHT);
      assert.equal(mem[SW_COL], gridW - 1, 'sanity: the player did reach the grid\'s rightmost column during those 700 frames');
    });

    await t.test('camera clamp: a 1x1 grid pins both axes at 0 regardless of in-screen movement', async () => {
      const project = createStreamedProject({ gridW: 1, gridH: 1 });
      const { nes, mem } = await buildAndBoot(project);
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
    });

    await t.test('camera clamp: the X axis stays pinned at 0 walking Left from the landing position, never underflows', async () => {
      // createStreamedProject's own default landing is player_x=120 (createProject's default), so
      // worldX=120 and camPx=clamp(120-120,0,...)=0 already at the floor -- walking further Left
      // pushes worldX-120 negative pre-clamp; a clamp that only guards the upper bound (or clamps
      // via an unsigned/wrapping subtract instead of a real floor) would publish a huge wrapped
      // byte instead of holding at 0.
      const project = createStreamedProject({});
      const { nes, mem } = await buildAndBoot(project);
      assert.equal(mem[CAM_X_LO], 0, 'precondition: camPx starts at its own floor, 0');
      nes.buttonDown(1, LEFT);
      for (let i = 0; i < 60; i++) {
        nes.frame();
        assert.equal(mem[CAM_X_LO], 0, `frame ${i}: cam_x_lo must stay 0 walking Left from the floor, never wrap to a large byte`);
        assert.equal(mem[CAM_NT] & 1, 0, `frame ${i}: cam_nt bit0 must stay 0`);
      }
      nes.buttonUp(1, LEFT);
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
      const { nes, mem } = await buildAndBoot(project);
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
      const { nes, mem } = await buildAndBoot(project);
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
      const { nes, mem } = await buildAndBoot(project);
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
    const { nes, mem } = await buildAndBoot(project);

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
  }
);
