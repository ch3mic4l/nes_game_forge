// The streamed camera rule, stated independently of the 6502, plus a rig that boots a real streamed ROM
// and runs sw_camera_window_recompute in isolation (test/lib/callroutine.js) against it. Shared by
// test/unit/streamworldcamera.test.js (a reduced grid, inside `npm test`) and any exhaustive one-off run.
//
// Nothing here reads engine/streamworld.asm, runs a second copy of the routine, or copies a constant out
// of it. The rule is docs/design-streamed-worlds.md's one-formula-per-axis camera clamp and the window's
// own geometry: a window is 32 x 30 blocks (two screens), a screen is 256 x 240 px = 16 x 15 blocks.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import NES from '../../renderer/emulator/core/nes.js';
import { callRoutine } from './callroutine.js';
import { createStreamedProject } from './streamedproject.js';
import { scanEquates, resolveEquates } from './equates.js';

// Addresses of the bytes the routine reads and writes -- hardcoded, per CLAUDE.md, and cross-checked
// against the BUILT constants.asm by `resolvedAddresses`/the test, so a moved byte fails loudly.
export const ADDR = {
  player_x: 0x10, player_y: 0x11, // from engine/constants.asm:23-24
  cam_x_lo: 0xaf, cam_y_lo: 0xb0, cam_nt: 0xb1, cam_dirty: 0xb5, // from engine/constants.asm:513-538 (the bt_walk_step chain)
  sw_col: 0x05a0, sw_row: 0x05a1, // from engine/constants.asm
  sw_grid_w: 0x05a9, sw_grid_h: 0x05aa, // from engine/constants.asm
  sw_cam_origin_x_lo: 0x035c, sw_cam_origin_x_hi: 0x035d, // from engine/constants.asm:659-662
  sw_cam_origin_y_lo: 0x035e, sw_cam_origin_y_hi: 0x035f,
  sw_fc_scr: 0x0786, sw_fc_lpy: 0x0787, // from engine/constants.asm:1322-1323
  sw_fc_desc: 0x0788, sw_fc_desl: 0x0789, sw_fc_desr: 0x078a, sw_fc_desrl: 0x078b // from engine/constants.asm:1324-1327
};

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * The camera rule for one input: grid gridW x gridH screens, the player on screen (col, row) at
 * pixel (px, py) inside it. Every figure is derived from the rule, never from the engine.
 *
 *   camPx = clamp(col*256 + px - 120, 0, (gridW-1)*256)       camPy = clamp(row*240 + py - 112, 0, (gridH-1)*240)
 *   camScreenRow, camLocalPxY = divmod(camPy, 240)             cam_nt = (camScreenRow&1)<<1 | (camPx>>8)&1
 *   desired block origin = clamp(floor(camPos/16) - 8 (X) | - 7 (Y), 0, ceiling), then divmod 16 (X) | 15 (Y)
 *
 * The window is two screens wide and tall, so its origin may not pass (gridW-2, 0) / (gridH-2, 0) --
 * sw_clamp_col/sw_clamp_row's own header ("the exact rightmost/bottommost valid placement"): a flat
 * ceiling of (gridW-2)*16 / (gridH-2)*15 blocks. A one-screen axis is outside that precondition
 * ("a different policy, not implemented"), but there camPos is pinned to 0 so the desired block is
 * 0 whatever the ceiling is: the ceiling there is 0.
 */
export function expectedCamera({ gridW, gridH, col, row, px, py }) {
  const camPx = clamp(col * 256 + px - 120, 0, (gridW - 1) * 256);
  const camPy = clamp(row * 240 + py - 112, 0, (gridH - 1) * 240);
  const screenRow = Math.floor(camPy / 240);
  const localPy = camPy % 240;
  const blockX = clamp(Math.floor(camPx / 16) - 8, 0, gridW >= 2 ? (gridW - 2) * 16 : 0);
  const blockY = clamp(Math.floor(camPy / 16) - 7, 0, gridH >= 2 ? (gridH - 2) * 15 : 0);
  return {
    sw_fc_scr: screenRow,
    sw_fc_lpy: localPy,
    sw_cam_origin_x_lo: camPx & 255,
    sw_cam_origin_x_hi: camPx >> 8,
    sw_cam_origin_y_lo: camPy & 255,
    sw_cam_origin_y_hi: camPy >> 8,
    cam_x_lo: camPx & 255,
    cam_y_lo: localPy,
    cam_nt: ((screenRow & 1) << 1) | ((camPx >> 8) & 1),
    cam_dirty: 0,
    sw_fc_desc: blockX >> 4,
    sw_fc_desl: blockX & 15,
    sw_fc_desr: Math.floor(blockY / 15),
    sw_fc_desrl: blockY % 15
  };
}

/** Builds a streamed project into a temp dir, boots it, and returns the rig. */
export async function bootCameraRig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamcamera-'));
  try {
    const project = createStreamedProject({});
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const symbols = fs.readFileSync(built.symbolPath, 'utf8');
    const m = symbols.match(/^sw_camera_window_recompute\s*=\s*\$([0-9A-Fa-f]+)/m);
    if (!m) throw new Error('sw_camera_window_recompute is not a named symbol in game.fns');
    const pending = new Map();
    scanEquates(fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8'), pending);
    scanEquates(fs.readFileSync(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8'), pending);
    const resolved = new Map();
    resolveEquates(pending, resolved);
    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
    for (let i = 0; i < 120; i++) nes.frame(); // past reset and naming-free boot; the routine is then called in isolation
    return { nes, mem: nes.cpu.mem, pc: parseInt(m[1], 16), resolved };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs the routine once on `input`; returns {cycles, actual} where actual holds every output byte. */
export function runCamera(rig, input) {
  const { mem, nes, pc } = rig;
  mem[ADDR.sw_grid_w] = input.gridW;
  mem[ADDR.sw_grid_h] = input.gridH;
  mem[ADDR.sw_col] = input.col;
  mem[ADDR.sw_row] = input.row;
  mem[ADDR.player_x] = input.px;
  mem[ADDR.player_y] = input.py;
  mem[ADDR.cam_dirty] = 0;
  const cycles = callRoutine(nes, pc);
  const actual = {};
  for (const name of Object.keys(expectedCamera({ gridW: 1, gridH: 1, col: 0, row: 0, px: 0, py: 0 }))) actual[name] = mem[ADDR[name]];
  return { cycles, actual };
}

/** First differing output of one input, as a string, or null. */
export function firstMismatch(rig, input) {
  const { actual } = runCamera(rig, input);
  const want = expectedCamera(input);
  for (const name of Object.keys(want)) {
    if (actual[name] !== want[name]) return `${name}: got ${actual[name]}, want ${want[name]} for ${JSON.stringify(input)}`;
  }
  return null;
}
