// Phase 3b S1b round 2, finding 1: the EXHAUSTIVE cost of a terrain read. A read = one sw_peek_byte = sw_goto (column division, repeated add, the row loop, the bank switch) +
// sw_locate_current (the O(1) restore, its own bank switch) + the wrapper (lda, pha, pla, rts). Its cycles are a deterministic function of (target screen, current screen) and of
// where the assembled code sits (a taken branch that crosses a page costs one more), so the figure is MEASURED on every distinct assembled layout by calling the real routines over
// the whole domain under jsnes (test/lib/callroutine.js: the same JSR stub every routine unit test uses), and each measured value is then required to equal the Mesen figure
// at every coordinate the Mesen witness runs actually executed (ringcount.mjs `g`/`l`/`p` events, exact in both emulators).
//   domain  : every (target screen t, current screen c) with t, c in [0, n) along the ring axis (ring 1: sw_goto(col, 0); ring 2: sw_goto(0, row)) -- n = the deepest
//             world the capacity check admits for the scene, so every shallower world is a subset. An off-grid target never reaches sw_goto (the wall/fill paths) and is not in it.
//   result  : peek[c*n + t] cycles of a whole sw_peek_byte call INCLUDING the caller's JSR and the final RTS (callRoutine's stub has both), goto[c*n+t] / loc[c*n+t] likewise.
import fs from 'node:fs';
import crypto from 'node:crypto';
import NES from '../../../renderer/emulator/core/nes.js';
import { callRoutine } from '../../lib/callroutine.js';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** Boots a scene ROM to gameplay on its start screen and returns { nes, cpu, ram, code }. */
export function bootScene(romPath, sym, { frames = 90 } = {}) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  const cpu = nes.cpu;
  if (cpu.mem[sym.ram.game_state] !== sym.ram.ST_GAMEPLAY || cpu.mem[sym.ram.map_is_streamed] !== 1) throw new Error('s1bcost: the scene did not reach streamed gameplay');
  // the first callRoutine after a boot absorbs a pending NMI/IRQ's service (measured: a 51-cycle routine returned 363), so it is made once, on a routine that does nothing, and discarded
  callRoutine(nes, sym.code.sw_locate_current);
  callRoutine(nes, sym.code.sw_locate_current);
  return { nes, cpu, ram: sym.ram, code: sym.code };
}

/** What decides the timing of the read routines: the assembled bytes of sw_goto..sw_enter_screen and 400 bytes of switch_prg_bank, and every entry's low byte (page crossings). */
export function layoutSignature(sym, cpuMem) {
  const c = sym.code;
  const span = (a, b) => cpuMem.slice(a, b);
  const bytes = Buffer.concat([Buffer.from(span(c.sw_goto, c.sw_enter_screen + 40)), Buffer.from(span(c.switch_prg_bank, c.switch_prg_bank + 400)), Buffer.from(span(c.sw_peek_byte, c.sw_peek_byte + 16))]);
  return { sha256: sha(bytes), low: ['sw_goto', 'sw_locate_current', 'sw_enter_screen', 'sw_peek_byte', 'switch_prg_bank'].map((n) => [n, c[n] & 0xff]), at: ['sw_goto', 'sw_locate_current', 'sw_peek_byte', 'switch_prg_bank'].map((n) => [n, c[n]]) };
}

const call = (b, name, a, x, y = 0) => { b.cpu.REG_ACC = a; b.cpu.REG_X = x; b.cpu.REG_Y = y; return callRoutine(b.nes, b.code[name]); };

/**
 * Sweeps the whole read domain. `ring` 1 = the world is n x 1 (sw_goto(col, 0)), 2 = 1 x n (sw_goto(0, row)). Returns { n, ring, layout, goto, loc, peek (Uint16Array n*n, index c*n+t),
 * max: { goto, loc, peek, gotoAt, locAt, peekAt }, maxAdj (|t-c| <= 1) }.
 */
export function sweepReads({ romPath, sym, ring, n }) {
  const b = bootScene(romPath, sym);
  const at = (t) => (ring === 1 ? [t, 0] : [0, t]);
  const peek = new Uint16Array(n * n).fill(65535), peekHi = new Uint16Array(n * n), gt = new Uint16Array(n * n), lc = new Uint16Array(n * n), gtLo = new Uint16Array(n * n).fill(65535), lcLo = new Uint16Array(n * n).fill(65535);
  // UNROM 512's bank write is `lda unrom512_identity,x` with x = mapper_shadow (PRG bits | CHR page bits | mirroring bit): the absolute,X load costs one more when the table's low byte + x crosses a
  // page, so the cost of every read routine depends on the shadow's HIGH bits too (found by the round-2 event check: a live RPG read priced 103 against the sweep's 102). The sweep therefore repeats
  // the whole domain at each of the eight values of those three bits and keeps the dearest (and the cheapest) of each cell. Every other mapper has no such state: one pass.
  const shadow = sym.ram.mapper_shadow !== undefined && sym.code.unrom512_identity !== undefined ? [0, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0, 0xe0] : [null];
  const withShadow = (hi) => { if (hi !== null) b.cpu.mem[sym.ram.mapper_shadow] = (b.cpu.mem[sym.ram.mapper_shadow] & 0x1f) | hi; };
  const callS = (hi, name, a, x, y = 0) => { withShadow(hi); return call(b, name, a, x, y); };
  for (const hi of shadow) for (let c = 0; c < n; c++) {
    const [cc, cr] = at(c);
    callS(hi, 'sw_enter_screen', cc, cr);
    for (let t = 0; t < n; t++) {
      const [tc, tr] = at(t);
      const i = c * n + t;
      // each routine is called from the SAME well-defined state: the current screen c mapped (sw_enter_screen / the previous call's restore). Y = 0 and Y = 255: the indirect
      // load `lda [mtptr_lo],y` costs one more exactly when the pointer's low byte + Y crosses a page, which is monotone in Y, so these two bound every Y.
      const p0 = callS(hi, 'sw_peek_byte', tc, tr, 0), p1 = callS(hi, 'sw_peek_byte', tc, tr, 255), g0 = callS(hi, 'sw_goto', tc, tr);
      const l0 = callS(hi, 'sw_locate_current', 0, 0); // restores c after the sw_goto above: its bank switch moves from t's bank to c's
      peek[i] = Math.min(peek[i], p0); peekHi[i] = Math.max(peekHi[i], p1);
      gt[i] = Math.max(gt[i], g0); gtLo[i] = Math.min(gtLo[i], g0);
      lc[i] = Math.max(lc[i], l0); lcLo[i] = Math.min(lcLo[i], l0);
    }
  }
  // ring-adjacent: a probe or an arm reads the screen itself or a neighbour of it, wrapping at the ring's seam (the source argument is in s1bbound.mjs)
  const adjacent = (c, t) => { const d = (t - c + n) % n; return d === 0 || d === 1 || d === n - 1; };
  const mx = (arr, adj) => { let m = -1, at2 = null; for (let c = 0; c < n; c++) for (let t = 0; t < n; t++) { if (adj && !adjacent(c, t)) continue; const v = arr[c * n + t]; if (v > m) { m = v; at2 = [t, c]; } } return { cycles: m, at: at2 }; };
  const stats = (arr) => ({ all: mx(arr, false), adj: mx(arr, true) });
  // invariances the event validation relies on: sw_goto's cost does not depend on the current screen, sw_locate_current's not on the target
  let gotoCInvariant = true, locTInvariant = true;
  for (let c = 0; c < n; c++) for (let t = 0; t < n; t++) { if (gt[c * n + t] !== gt[t]) gotoCInvariant = false; if (lc[c * n + t] !== lc[c * n]) locTInvariant = false; }
  return { n, ring, shadowValues: shadow.length, layout: layoutSignature(sym, b.cpu.mem), goto: gt, loc: lc, gotoLo: gtLo, locLo: lcLo, peek, peekHi, gotoCInvariant, locTInvariant, stats: { goto: stats(gt), loc: stats(lc), peek: stats(peek), peekHi: stats(peekHi) }, digest: sha(Buffer.concat([Buffer.from(peek.buffer), Buffer.from(peekHi.buffer), Buffer.from(gt.buffer), Buffer.from(lc.buffer), Buffer.from(gtLo.buffer), Buffer.from(lcLo.buffer)])) };
}

/** A sweep's small, retained form (no matrices): what the report and the bound read. The matrices themselves are written next to the records, gzipped, by run_s1b. */
export const sweepSummary = (sw) => ({ n: sw.n, ring: sw.ring, shadowValues: sw.shadowValues, layout: sw.layout, stats: sw.stats, gotoCInvariant: sw.gotoCInvariant, locTInvariant: sw.locTInvariant, digest: sw.digest });

/**
 * The projection routines, exhaustively over every input CLASS that decides one of their branches (their cost is a function of those outcomes and of the assembled layout, nothing
 * else): sw_project_axis (delta high byte zero / nonzero / negative, visible width 0 or 240, delta low byte against it), sw_oam_project_x / _tile_x (carry, offset sign, screen column
 * against the camera origin's), sw_oam_project_y / _tile_y (carry, offset sign, row base against the camera origin's), sw_oam_rowbase (data independent). Each figure is the whole
 * call's cycles including its JSR and RTS. Returns { <routine>: { max, min, calls } }.
 */
export function sweepProjection({ romPath, sym }) {
  const b = bootScene(romPath, sym);
  const R = b.ram, mem = b.cpu.mem;
  const H = [0, 1, 2, 254, 255], L = [0, 1, 127, 128, 255], RB = [0, 1, 2, 14, 15, 16, 255];
  const out = {};
  const run = (name, grid) => {
    let max = -1, min = 1e9, calls = 0, at = null;
    grid((setup, A, carry) => {
      setup();
      b.cpu.F_CARRY = carry;
      const cyc = call(b, name, A, 0, 0);
      calls++;
      if (cyc > max) { max = cyc; at = A; }
      if (cyc < min) min = cyc;
    });
    out[name] = { max, min, calls, at };
  };
  const all = (f) => { for (let A = 0; A < 256; A++) f(A); };
  run('sw_project_axis', (go) => { for (const w of [0, 240]) for (const hi of [0, 1, 255]) for (const ch of [0, 1, 255]) for (const cl of [0, 128, 255]) all((lo) => go(() => { mem[R.sw_tmp] = lo; mem[R.sw_tmp2] = hi; mem[R.sw_tmp3] = cl; mem[R.sw_tmp4] = ch; }, w, 0)); });
  run('sw_oam_project_x', (go) => { for (const col of H) for (const ch of H) for (const cl of L) for (const carry of [0, 1]) all((A) => go(() => { mem[R.sw_col] = col; mem[R.sw_cam_origin_x_hi] = ch; mem[R.sw_cam_origin_x_lo] = cl; }, A, carry)); });
  run('sw_oam_project_tile_x', (go) => { for (const col of H) for (const ch of H) for (const cl of L) for (const ex of [0, 128, 255]) all((A) => go(() => { mem[R.sw_col] = col; mem[R.sw_cam_origin_x_hi] = ch; mem[R.sw_cam_origin_x_lo] = cl; mem[R.de_ex] = ex; }, A, 0)); });
  run('sw_oam_rowbase', (go) => { for (let A = 0; A < 255; A++) go(() => {}, A, 0); });
  run('sw_oam_project_y', (go) => { for (const row of [0, 1, 2, 100, 254]) for (const ch of RB) for (const cl of L) for (const carry of [0, 1]) all((A) => go(() => { mem[R.sw_row] = row; mem[R.sw_cam_origin_y_hi] = ch; mem[R.sw_cam_origin_y_lo] = cl; }, A, carry)); });
  run('sw_oam_project_tile_y', (go) => { for (const t2 of RB) for (const t1 of [0, 255]) for (const ch of RB) for (const cl of [0, 128, 255]) for (const ey of [0, 128, 255]) all((A) => go(() => { mem[R.tmp] = t1; mem[R.tmp2] = t2; mem[R.sw_cam_origin_y_hi] = ch; mem[R.sw_cam_origin_y_lo] = cl; mem[R.de_ey] = ey; }, A, 0)); });
  return out;
}
