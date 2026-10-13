// Phase 3b S3 (C1), tests (d) and (e), and the row strip's own shape.
//
//  * the horizontal ring's ROW strip reads ONE screen: a torus row strip is 32 blocks wide and reads two screens (one bank switch per screen read, plus the
//    restore of the player's own screen); on a horizontal ring the dead axis (X) holds exactly one screen, so the strip is 16 blocks and reads one.
//    sw_stream_start_row is called directly (test/lib/ringrun.js tracedCall) with every PC hit on switch_prg_bank, sw_goto and the out-of-grid fill path counted.
//    Observed shape asserted below: ring = 2 switches (1 read + the restore), 1 sw_goto, 0 fill iterations, st_len 16, 16 buffer bytes equal to the authored
//    row; torus control = 3 switches, st_len 32. ('h-row-len-32', 'h-row-load-32')
//  * what it does NOT test: the row wrap (`sw_ring_wrap_row`, st_vary modulo 16). st_vary starts at win_col_local (+16 on an odd window column screen); on a
//    horizontal ring both are 0 (the camera's X is pinned), so a 16-block strip ends before st_vary can reach 16 and the compare is unreachable. Its operand is
//    pinned from the ROM image in streamringh.test.js ('h-wrap-32', 'h-wrap-30').
//  * (d) the X-dead camera never moves X: the player walks the whole width of the one-screen-wide world and cam_x_lo (and the X bit of cam_nt) stay 0 on every
//    frame. An extent clamp that drifts ('h-camera-x-unfrozen') makes the camera follow the player's X.
//  * (e) a column strip never arms on a world one screen wide (gridW == 1), a row strip never on one screen tall (gridH == 1), walking along BOTH axes.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { makeBypassTree, loadBypassTree, buildThrough } from '../lib/ringbypass.js';
import { cellById, sceneProject, readFns, buildSymbols, tracedCall } from '../lib/ringrun.js';
import { bootRom, runSteps } from '../lua/ring_gate/ringrun_jsnes.mjs';
import { createStreamedProject } from '../lib/streamedproject.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm && 'nesasm not found on PATH';
let tree;
let loaded;
before(async () => {
  if (skip) return;
  tree = makeBypassTree();
  loaded = await loadBypassTree(tree);
});
after(() => tree?.dispose());

async function startRow(fns, symbols, romPath, screenRow, localRow) {
  const nes = bootRom(romPath);
  runSteps(nes, [{ op: 'boot' }]);
  const m = () => nes.cpu.mem;
  assert.equal(m()[symbols.get('st_active')], 0, 'the strip engine is idle before the call');
  const hits = tracedCall(nes, fns.sw_stream_start_row, { switch_prg_bank: fns.switch_prg_bank, sw_goto: fns.sw_goto, fill: fns.sw_ssr_fill }, { a: screenRow, x: localRow });
  const sbuf = symbols.get('sbuf');
  return { hits, len: m()[symbols.get('st_len')], active: m()[symbols.get('st_active')], cur: m()[symbols.get('st_cur')], buf: Array.from(m().slice(sbuf, sbuf + 32)), ssi: m()[symbols.get('ss_i')] };
}

test('the horizontal ring row strip reads one screen: 2 bank switches (1 read + the restore), no fill iteration, 16 blocks equal to the authored row', { skip }, async () => {
  const cell = cellById('MMC3-H');
  const { project } = sceneProject({ cell, gameType: 'action', scene: { world: { n: 4, talkers: 'none' } } });
  const built = await buildThrough(loaded, project);
  try {
    const symbols = buildSymbols(built.dir);
    const fns = readFns(built.symbolPath);
    for (const [sr, lr] of [[1, 3], [2, 14], [3, 0]]) {
      const r = await startRow(fns, symbols, built.romPath, sr, lr);
      const want = Array.from({ length: 16 }, (_, col) => project.maps[0].screens[sr].metatiles[lr * 16 + col]);
      assert.equal(r.len, 16, `screen ${sr} row ${lr}: st_len`);
      assert.equal(r.active, 2, 'a row strip is armed');
      assert.equal(r.cur, 0);
      assert.equal(r.ssi, 16, 'the builder looped exactly 16 times');
      assert.deepEqual(r.buf.slice(0, 16), want, `screen ${sr} row ${lr}: the buffer is the authored row, read from ONE screen`);
      assert.equal(r.hits.fill, 0, 'no block of the strip is outside the one-wide grid');
      assert.equal(r.hits.switch_prg_bank, 2, 'one screen read + one restore of the current screen');
      assert.equal(r.hits.sw_goto, 1, 'one relocate');
    }
  } finally {
    fs.rmSync(built.dir, { recursive: true, force: true });
  }
});

test('control: the four-screen torus row strip is 32 blocks and reads two screens (3 bank switches) -- the counting method discriminates', { skip }, async () => {
  const project = createStreamedProject({ gridW: 4, gridH: 2, camera: true });
  const built = await buildThrough(loaded, project);
  try {
    const symbols = buildSymbols(built.dir);
    const fns = readFns(built.symbolPath);
    const r = await startRow(fns, symbols, built.romPath, 1, 3);
    assert.equal(r.len, 32);
    assert.equal(r.ssi, 32);
    assert.equal(r.hits.fill, 0, 'both screens are real');
    assert.equal(r.hits.switch_prg_bank, 3, 'two screens read + the restore');
    assert.equal(r.hits.sw_goto, 2);
  } finally {
    fs.rmSync(built.dir, { recursive: true, force: true });
  }
});

// ---- (d) and (e): walking the dead axis ------------------------------------------------------------------------------------------------------

/** Builds a ring cell's project, boots it, walks `steps` and returns the per-frame camera samples and the strip modes seen. */
async function walk(boardId, steps) {
  const cell = cellById(boardId);
  const { project } = sceneProject({ cell, gameType: 'action', scene: { world: { n: 4, talkers: 'none' } } });
  const built = await buildThrough(loaded, project);
  try {
    const symbols = buildSymbols(built.dir);
    const nes = bootRom(built.romPath);
    const g = (n) => symbols.get(n);
    const samples = { camX: new Set(), camY: new Set(), ntBit0: new Set(), ntBit1: new Set(), px: [], py: [], st: new Set() };
    runSteps(nes, steps, {
      onFrame: (n) => {
        const m = n.cpu.mem;
        if (m[g('game_state')] !== 0 && m[g('game_state')] !== 2) return;
        samples.camX.add(m[g('cam_x_lo')]);
        samples.camY.add(m[g('cam_y_lo')]);
        samples.ntBit0.add(m[g('cam_nt')] & 1);
        samples.ntBit1.add((m[g('cam_nt')] >> 1) & 1);
        samples.px.push(m[g('player_x')]);
        samples.py.push(m[g('player_y')]);
        samples.st.add(m[g('st_active')]);
      }
    });
    return samples;
  } finally {
    fs.rmSync(built.dir, { recursive: true, force: true });
  }
}
const spread = (xs) => [Math.min(...xs), Math.max(...xs)];

test('(d) the X-dead camera never moves X on a horizontal ring: the player walks the whole screen width, cam_x_lo and the X bit of cam_nt stay 0 on every frame; no column strip arms (e)', { skip }, async () => {
  const s = await walk('MMC3-H', [
    { op: 'boot' },
    { op: 'hold', btn: 'left', axis: 'x', lte: 24, max: 600 },
    { op: 'check', label: 'left' },
    { op: 'hold', btn: 'right', axis: 'x', gte: 232, max: 900 },
    { op: 'check', label: 'right' },
    { op: 'hold', btn: 'down', axis: 'y', gte: 200, max: 600 },
    { op: 'hold', btn: 'left', axis: 'x', lte: 120, max: 600 },
    { op: 'check', label: 'back' }
  ]);
  const [lo, hi] = spread(s.px);
  assert.ok(lo <= 40 && hi >= 216, `the player really walked the screen width (player_x ${lo}..${hi})`);
  assert.deepEqual([...s.camX], [0], 'cam_x_lo is 0 on every frame');
  assert.deepEqual([...s.ntBit0], [0], 'the X parity bit of cam_nt is 0 on every frame');
  assert.ok(!s.st.has(1), 'a column strip never armed');
});

test('(e) a column strip never arms on a horizontal ring (gridW == 1) while a Y walk streams rows; a row strip never arms on a vertical ring (gridH == 1) while an X walk streams columns, and cam_y stays 0 there', { skip }, async () => {
  const h = await walk('MMC3-H', [
    { op: 'boot' },
    { op: 'hold', btn: 'down', axis: 'y', gte: 500, max: 900 },
    { op: 'hold', btn: 'up', axis: 'y', lte: 130, max: 900 },
    { op: 'hold', btn: 'left', axis: 'x', lte: 24, max: 600 },
    { op: 'hold', btn: 'right', axis: 'x', gte: 232, max: 900 }
  ]);
  assert.ok(h.st.has(2), 'the horizontal walk really streamed rows (st_active = 2 seen)');
  assert.ok(!h.st.has(1), 'no column strip (st_active = 1) on a horizontal ring');
  const v = await walk('MMC3-V', [
    { op: 'boot' },
    { op: 'hold', btn: 'right', axis: 'x', gte: 500, max: 900 },
    { op: 'hold', btn: 'left', axis: 'x', lte: 130, max: 900 },
    { op: 'hold', btn: 'up', axis: 'y', lte: 24, max: 600 },
    { op: 'hold', btn: 'down', axis: 'y', gte: 200, max: 900 }
  ]);
  assert.ok(v.st.has(1), 'the vertical walk really streamed columns (st_active = 1 seen)');
  assert.ok(!v.st.has(2), 'no row strip (st_active = 2) on a vertical ring');
  assert.deepEqual([...v.camY], [0], 'cam_y_lo stays 0 on a vertical ring (the Y-dead camera)');
  assert.deepEqual([...v.ntBit1], [0], 'the Y parity bit of cam_nt stays 0 on a vertical ring');
});
