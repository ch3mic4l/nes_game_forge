// A hooked walk of the streamed-world manifest scene (test/lua/sw_manifest_scene.mjs), body by body, for the
// tests that pin the Flash-publication deferral (engine/streamworld.asm, sw_win_arm_flash_guard).
//
// Every main-loop body gets a uniquely numbered record. PC hooks (not body-start RAM, which is only a hint)
// say what that body really did: `flash_apply_on` (the Flash-on publication), `fade_apply_palette` reached
// from inside flash_tick (the restore publication), the guard's entry and exit, `sw_stream_start_row` /
// `sw_stream_start_col` (a strip armed) and `sw_win_arm_done` (the end of the window arm). From those the
// laws in `checkLaws` are decidable on any schedule.
//
// Addresses are transcribed from engine/constants.asm by hand, a test that read the file it checks would
// prove nothing; labels come from the built game.fns via buildScene's symbols.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import NES from '../../renderer/emulator/core/nes.js';
import { buildScene } from '../lua/sw_manifest_scene.mjs';

// from engine/constants.asm
export const A = {
  GAME_STATE: 0x25,
  MAP_IS_STREAMED: 0xfe,
  FLASH_LEFT: 0xa0,
  FLASH_PENDING: 0xff,
  FLASH_ARM_VALUE: 7,
  WIN_COL_SCREEN: 0x5b1,
  WIN_COL_LOCAL: 0x5b2,
  WIN_ROW_SCREEN: 0x5b3,
  WIN_ROW_LOCAL: 0x5b4,
  ST_ACTIVE: 0x5b5,
  ST_CUR: 0x5b6,
  ST_LEN: 0x5b7,
  SBUF: 0x5bc,
  SBUF_LEN: 32,
  SW_FC_DESC: 0x788,
  SW_FC_DESL: 0x789,
  SW_FC_DESR: 0x78a,
  SW_FC_DESRL: 0x78b,
  CAM_ORIGIN_Y_LO: 0x35e,
  CAM_ORIGIN_Y_HI: 0x35f,
  CAM_ORIGIN_X_LO: 0x35c,
  CAM_ORIGIN_X_HI: 0x35d
};
export const BTN = { A: 0, B: 1, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7 };
export const ROW_STRIP_WINDOW_BLOCKS = 29; // the entering row of a downward strip is 29 blocks past the window origin

export async function bootScene(opts) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-flashdefer-'));
  try {
    const built = await buildScene({ ...opts, outDir });
    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
    const mem = nes.cpu.mem;
    const gameplay = built.symbols.ram.ST_GAMEPLAY;
    let frames = 0;
    while ((mem[A.GAME_STATE] !== gameplay || mem[A.MAP_IS_STREAMED] !== 1) && frames < 400) { nes.frame(); frames++; }
    assert.equal(mem[A.GAME_STATE], gameplay, 'the scene should reach gameplay on the streamed map');
    return { nes, mem, code: built.symbols.code, ram: built.symbols.ram };
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

export const rowAbs = (mem) => mem[A.WIN_ROW_SCREEN] * 15 + mem[A.WIN_ROW_LOCAL];
export const colAbs = (mem) => mem[A.WIN_COL_SCREEN] * 16 + mem[A.WIN_COL_LOCAL]; // 16 block columns per screen, 15 rows
export const desiredRowAbs = (mem) => mem[A.SW_FC_DESR] * 15 + mem[A.SW_FC_DESRL];
export const desiredColAbs = (mem) => mem[A.SW_FC_DESC] * 16 + mem[A.SW_FC_DESL];
const camY = (mem) => mem[A.CAM_ORIGIN_Y_LO] | (mem[A.CAM_ORIGIN_Y_HI] << 8);
const strip = (mem) => `${mem[A.ST_ACTIVE]}/${mem[A.ST_CUR]}/${mem[A.ST_LEN]}/` + Array.from(mem.slice(A.SBUF, A.SBUF + A.SBUF_LEN)).join(',');

/** The steps of the reference walk: Down, Right+Down, Down (the manifest's `walk` scenario). */
export const WALK_DOWN = [
  { frames: 95, held: [BTN.DOWN] },
  { frames: 260, held: [BTN.RIGHT, BTN.DOWN] },
  { frames: 240, held: [BTN.DOWN] }
];
/** A trip back: Up, then Left+Up, then Up. Meant to follow WALK_DOWN. */
export const WALK_UP = [
  { frames: 200, held: [BTN.UP] },
  { frames: 200, held: [BTN.LEFT, BTN.UP] },
  { frames: 240, held: [BTN.UP] }
];

/**
 * Run `steps` ([{ frames, held: [BTN...] }]) with the body hooks armed and return the trace.
 * `poke(rec, mem)`, when given, runs at the top of every body (after its record is opened, before
 * flash_tick) -- a RAM poke is SYNTHETIC: it is how a test forces a Flash publication onto a chosen body.
 * `pokeScript(rec, mem)` runs at settle_owed, i.e. after flash_tick and before the guard: where a script's
 * own Flash command re-arms flash_left. `step.held` may be a function (frameIndex, mem) => [BTN...].
 */
export function traceRun(env, steps, { poke = null, pokeScript = null } = {}) {
  const { nes, mem, code } = env;
  const at = (k) => { assert.ok(Number.isFinite(code[k]), `${k} should be a named symbol`); return code[k]; };
  const hooks = new Map();
  // a Flash-free build has no flash_tick / flash_apply_on / fade_apply_palette: those hooks are simply not armed
  const on = (k, fn, optional = false) => {
    if (optional && !Number.isFinite(code[k])) return;
    const a = at(k);
    (hooks.get(a) ?? hooks.set(a, []).get(a)).push(fn);
  };
  const flashTickLo = code.flash_tick;
  const flashTickHi = code.flash_tick_confirm;
  const bodies = [];
  const rows = []; // completed row strips
  let cur = null;
  let open = null; // a row strip whose completion is being waited for
  let nextIndex = 0;

  const finish = () => { if (cur) bodies.push(cur); cur = null; };
  const retAddr = () => {
    const sp = nes.cpu.REG_SP & 0xff;
    return (((mem[0x100 + ((sp + 2) & 0xff)] << 8) | mem[0x100 + ((sp + 1) & 0xff)]) + 1) & 0xffff;
  };

  on('main_loop_body_start', () => {
    finish();
    // the previous body's strip has now had its NMIs: complete?
    if (open && open.arm < nextIndex && mem[A.ST_ACTIVE] === 0) {
      const cy = camY(mem);
      const visibleBottom = Math.floor((cy + 239) / 16);
      const visibleTop = Math.floor(cy / 16);
      const margin = open.dir === 'down' ? open.entering - visibleBottom : visibleTop - open.entering;
      rows.push({ arm: open.arm, done: nextIndex, frames: nextIndex - open.arm, dir: open.dir, margin });
      open = null;
    }
    cur = {
      n: nextIndex++, row0: rowAbs(mem), col0: colAbs(mem), fl0: mem[A.FLASH_LEFT], applyOn: false, restorePub: false, guard: null, guardPassed: false,
      startRow: false, startCol: false, done: null, rowDist: Math.abs(desiredRowAbs(mem) - rowAbs(mem)), colDist: Math.abs(desiredColAbs(mem) - colAbs(mem))
    };
    cur.state0 = mem[A.GAME_STATE];
    if (poke) poke(cur, mem);
  });
  on('settle_owed', () => { if (cur && pokeScript) pokeScript(cur, mem); });
  on('flash_apply_on', () => { if (cur) cur.applyOn = true; }, true);
  on('fade_apply_palette', () => { const r = retAddr(); if (cur && r > flashTickLo && r <= flashTickHi) cur.restorePub = true; }, true);
  on('sw_win_arm_flash_guard', () => {
    if (!cur) return;
    const stActive = mem[A.ST_ACTIVE];
    const dRow = desiredRowAbs(mem) - rowAbs(mem);
    cur.guard = {
      fl: mem[A.FLASH_LEFT], stActive, wantsRow: stActive === 0 && dRow !== 0, dir: dRow > 0 ? 'down' : 'up',
      row: rowAbs(mem), col: colAbs(mem), strip: strip(mem), backlogRow: Math.abs(dRow), backlogCol: Math.abs(desiredColAbs(mem) - colAbs(mem))
    };
  });
  on('sw_win_arm_flash_guard_end', () => {
    // a Flash-free build has zero-size guard labels: this address is also the guard's own entry, and reaching it is not a "pass"
    if (cur && flashGuardExists) cur.guardPassed = true;
  });
  const flashGuardExists = code.sw_win_arm_flash_guard_end !== code.sw_win_arm_flash_guard;
  on('sw_stream_start_row', () => {
    if (!cur) return;
    cur.startRow = true;
    const dir = cur.guard ? cur.guard.dir : 'down';
    // the window has stepped already: the entering row is the new origin (up) or 29 past it (down)
    open = { arm: cur.n, dir, entering: dir === 'down' ? rowAbs(mem) + ROW_STRIP_WINDOW_BLOCKS : rowAbs(mem) };
  });
  on('sw_stream_start_col', () => { if (cur) cur.startCol = true; });
  on('sw_win_arm_done', () => { if (cur) cur.done = { row: rowAbs(mem), col: colAbs(mem), strip: strip(mem), stActive: mem[A.ST_ACTIVE] }; });

  const original = nes.cpu.emulate.bind(nes.cpu);
  nes.cpu.emulate = function hooked() {
    const fns = hooks.get(nes.cpu.REG_PC + 1);
    if (fns) for (const fn of fns) fn();
    return original();
  };
  try {
    for (const step of steps) {
      for (let i = 0; i < step.frames; i++) {
        for (const b of Object.values(BTN)) nes.buttonUp(1, b);
        const held = typeof step.held === 'function' ? step.held(i, mem) : step.held ?? [];
        for (const b of held) nes.buttonDown(1, b);
        nes.frame();
      }
    }
  } finally {
    nes.cpu.emulate = original;
  }
  finish();
  const isPub = (b) => b.applyOn || b.restorePub;
  return {
    bodies, rows, flashGuardExists,
    deferrals: bodies.filter((b) => b.guard && b.guard.wantsRow && !b.guardPassed && flashGuardExists),
    publications: bodies.filter(isPub)
  };
}

export const isPublication = (b) => b.applyOn || b.restorePub;
export const sameStrip = (a, b) => a === b;

/**
 * The laws every schedule obeys. Returns { violations: [..], stats }. Each law is written so that a named wrong
 * implementation (below) breaks it:
 *  L1 no publication body arms a row strip ............ guard removed / wrong state value / one publication left out
 *  L2 a deferred body moved neither the row origin nor, absent a column arm, the strip state .... coordinates advance before the guard returns
 *  L3 a row wanted on a non-deferring body IS armed on it ..... a guard that defers too much (value, or state, or direction)
 *  L4 a deferral is a publication body and a publication body with a wanted row is a deferral ..... wrong value; bypass in one direction
 *  L5 two deferrals never fall on consecutive bodies (a deferral is followed by a body that can arm) .... repeated deferral
 *  L6 every row strip completes within `maxFrames` bodies and with `minMargin` visible blocks to spare
 * `allowReArm` names the one residual the guard cannot see: a script re-arm in the very body of a Flash-on
 * publication makes the guard read FLASH_ARM_VALUE, so that body may arm a row.
 */
export function checkLaws(trace, { maxFrames = 12, minMargin = 5, allowReArm = false } = {}) {
  const v = [];
  const bodies = trace.bodies;
  const stats = { reArmCoincidence: 0, deferred: 0, armedOnPublication: 0 };
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    const g = b.guard;
    if (!g) continue;
    const deferred = trace.flashGuardExists && !b.guardPassed;
    if (deferred) {
      stats.deferred++;
      if (b.startRow) v.push(`body ${b.n}: a deferred body armed a row strip`);
      if (b.done && b.done.row !== g.row) v.push(`body ${b.n}: a deferred body moved the row origin ${g.row} -> ${b.done.row}`);
      if (b.done && !b.startCol && b.done.strip !== g.strip) v.push(`body ${b.n}: a deferred body changed the stream buffer`);
      if (!isPublication(b)) v.push(`body ${b.n}: deferred (flash_left=${g.fl}) with no publication in the body`);
      if (g.fl !== A.FLASH_PENDING && g.fl !== A.FLASH_ARM_VALUE - 1) v.push(`body ${b.n}: deferred at flash_left=${g.fl}`);
      const next = bodies[i + 1];
      if (next && next.guard && trace.flashGuardExists && !next.guardPassed && next.n === b.n + 1) v.push(`body ${b.n}: deferred on two consecutive bodies`);
    } else {
      if (g.wantsRow && !b.startRow) v.push(`body ${b.n}: a wanted row (flash_left=${g.fl}) was not armed on a body that does not defer`);
      if (isPublication(b) && b.startRow) {
        if (allowReArm && b.applyOn && g.fl === A.FLASH_ARM_VALUE) stats.reArmCoincidence++;
        else v.push(`body ${b.n}: armed a row strip on a Flash publication body (applyOn=${b.applyOn} restorePub=${b.restorePub} flash_left=${g.fl})`);
        stats.armedOnPublication++;
      }
    }
    if (trace.flashGuardExists && isPublication(b) && g.wantsRow && !deferred && !(allowReArm && b.applyOn && g.fl === A.FLASH_ARM_VALUE)) {
      v.push(`body ${b.n}: a publication body with a wanted row did not defer (flash_left=${g.fl})`);
    }
  }
  for (const r of trace.rows) {
    if (r.frames > maxFrames) v.push(`row armed at body ${r.arm} (${r.dir}) took ${r.frames} bodies`);
    if (r.margin < minMargin) v.push(`row armed at body ${r.arm} (${r.dir}) finished with ${r.margin} visible blocks in hand`);
  }
  return { violations: v, stats };
}
