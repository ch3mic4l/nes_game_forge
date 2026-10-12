// Phase 3b S2 (C2), test (d): the vertical ring's column strip reads ONE screen.
//
// A torus column strip is 30 blocks tall and so reads two screens of the world (one bank switch per screen read, plus the restore of the
// player's own screen). On the vertical ring the dead axis holds exactly one screen, so the strip is 15 blocks and reads one: engine
// routine sw_stream_start_col is called directly (test/lib/callroutine.js's technique, with a program-counter trace added) with every PC hit on
// switch_prg_bank, sw_goto and the out-of-grid fill path counted, and the strip buffer it fills is compared with the authored metatile column.
//
// Observed shape (asserted below): ring = 2 switches (1 read + 1 restore), 0 fill iterations, st_len 15, 15 buffer bytes equal to the
// authored column; four-screen control = 3 switches (2 reads + 1 restore), st_len 30. A strip that kept its two-screen length on the ring
// ('strip-len-30') executes 15 fill iterations (the second "screen" is outside the one-deep grid) and reports st_len 30 -- it switches banks
// no more often than the correct strip, which is why the switch count alone cannot be the whole test and the fill path, st_len and the
// buffer are asserted too.
//
// What this does NOT test: the strip's wrap (`sw_ring_wrap_col`, st_vary modulo 15). st_vary starts at win_row_local (+15 on an odd window
// row screen); on a vertical ring both are always 0 (the camera's Y is pinned), so a 15-block strip finishes before st_vary can reach 15 and the wrap
// compare is not reachable. Its operand is pinned instead (streamring.test.js reads the assembled `cmp #15` back from the ROM).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { makeBypassTree, loadBypassTree, buildThrough } from '../lib/ringbypass.js';
import { cellById, sceneProject, readFns, buildSymbols } from '../lib/ringrun.js';
import { bootRom, runSteps } from '../lua/ring_gate/ringrun_jsnes.mjs';
import { createStreamedProject } from '../lib/streamedproject.js';
import fs from 'node:fs';

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

/** callRoutine's stub, with a PC trace: returns { hits: {name: n}, writes: mapper-register stores } for the routine at `address`. */
function tracedCall(nes, address, watch, regs) {
  nes.mmap.write(0x2000, 0);
  nes.cpu.irqRequested = false;
  nes.cpu.F_INTERRUPT = 1;
  nes.cpu.mem.set([0x20, address & 255, address >> 8, 0xea], 0x700);
  nes.cpu.REG_PC = 0x6ff;
  nes.cpu.REG_ACC = regs.a;
  nes.cpu.REG_X = regs.x;
  const hits = Object.fromEntries(Object.keys(watch).map((k) => [k, 0]));
  const byPc = new Map(Object.entries(watch).map(([k, v]) => [v, k]));
  let steps = 0;
  while (nes.cpu.REG_PC + 1 !== 0x703) {
    const name = byPc.get(nes.cpu.REG_PC + 1);
    if (name) hits[name]++;
    nes.cpu.emulate();
    assert.ok(++steps < 200000, 'the strip builder never returned');
  }
  return hits;
}

async function startColumn(project, fns, symbols, romPath, screenCol, localCol) {
  const nes = bootRom(romPath);
  runSteps(nes, [{ op: 'boot' }]);
  const m = () => nes.cpu.mem;
  assert.equal(m()[symbols.get('st_active')], 0, 'the strip engine is idle before the call');
  const hits = tracedCall(nes, fns.sw_stream_start_col, { switch_prg_bank: fns.switch_prg_bank, sw_goto: fns.sw_goto, fill: fns.sw_ssc_fill }, { a: screenCol, x: localCol });
  const sbuf = symbols.get('sbuf');
  const len = m()[symbols.get('st_len')];
  return { hits, len, active: m()[symbols.get('st_active')], cur: m()[symbols.get('st_cur')], buf: Array.from(m().slice(sbuf, sbuf + 32)), ssi: m()[symbols.get('ss_i')] };
}

test('(d) the vertical ring column strip reads one screen: 2 bank switches (1 read + the restore), no fill iteration, 15 blocks equal to the authored column', { skip }, async () => {
  const cell = cellById('MMC3-V');
  const { project } = sceneProject({ cell, gameType: 'action', scene: { world: { n: 4, talkers: 'none' } } });
  const built = await buildThrough(loaded, project);
  try {
    const symbols = buildSymbols(built.dir);
    const fns = readFns(built.symbolPath);
    for (const [sc, lc] of [[1, 3], [2, 15], [3, 0]]) {
      const r = await startColumn(project, fns, symbols, built.romPath, sc, lc);
      const want = Array.from({ length: 15 }, (_, row) => project.maps[0].screens[sc].metatiles[row * 16 + lc]);
      assert.equal(r.len, 15, `screen ${sc} column ${lc}: st_len`);
      assert.equal(r.active, 1, 'the strip is armed');
      assert.equal(r.cur, 0);
      assert.equal(r.ssi, 15, 'the builder looped exactly 15 times');
      assert.deepEqual(r.buf.slice(0, 15), want, `screen ${sc} column ${lc}: the buffer is the authored column, read from ONE screen`);
      assert.equal(r.hits.fill, 0, 'no block of the strip is outside the one-deep grid');
      assert.equal(r.hits.switch_prg_bank, 2, 'one screen read + one restore of the current screen');
      assert.equal(r.hits.sw_goto, 1, 'one relocate');
    }
  } finally {
    fs.rmSync(built.dir, { recursive: true, force: true });
  }
});

test('(d) control: the four-screen torus column strip is 30 blocks and reads two screens (3 bank switches) -- the counting method discriminates', { skip }, async () => {
  const project = createStreamedProject({ gridW: 4, gridH: 2, camera: true });
  const built = await buildThrough(loaded, project);
  try {
    const symbols = buildSymbols(built.dir);
    const fns = readFns(built.symbolPath);
    const r = await startColumn(project, fns, symbols, built.romPath, 1, 3);
    assert.equal(r.len, 30);
    assert.equal(r.ssi, 30);
    assert.equal(r.hits.fill, 0, 'both screens are real');
    assert.equal(r.hits.switch_prg_bank, 3, 'two screens read + the restore');
    assert.equal(r.hits.sw_goto, 2);
  } finally {
    fs.rmSync(built.dir, { recursive: true, force: true });
  }
});
