// Phase 3b S2 (C2), tests (a) and (c): the vertical ring's VRAM + attribute oracle after a lap, and the PPU write trace.
//
// Each scenario is the certified S1 prototype's own (test/lua/ring_gate/ringscene.mjs laps/seam, the interpreter ringrun_jsnes.mjs and the
// judge ringjudge.mjs over the independent oracle test/lib/ringoracle.js), run here against the PRODUCTION engine through the test-only
// bypass copy (test/lib/ringbypass.js). A lap walks a 4 x 1 ring forward across every seam and back with an `enter` talker per screen, so
// strips stream, the window wraps both live nametables, and a dialogue opens and closes at every crossing. After EVERY checkpoint the live
// nametables must equal the oracle byte for byte, attribute tables included, and the whole run must contain no PPU write addressed to
// $28xx/$2Cxx (the mirror aliases of the two live nametables on vertical mirroring).
//
// Wrong implementations these catch (see handoff-next/s2-c2/sabotage.log for the measured catch of each):
//   unforked strip (len/compare/wrap 30): blocks 15..29 draw at +$08 = $28xx, overwriting the live $20xx on vertical -> oracle bytes AND alias trace
//   strip wrap skipped: NOT visible to this oracle -- on a vertical ring the wrap compare is unreachable (st_vary starts at 0, a 15-block strip ends
//     before it could reach 15), so the assembled `cmp #15` operand is pinned from the ROM in streamring.test.js and that pin catches it
//   render window enumerating four nametables: indices 2,3 are written to $28xx/$2Cxx, clobbering the live pair -> alias trace + oracle
//   attribute shadow at n*32: NT1's shadow overlaps NT0's, the next strip's read-modify-write corrupts attributes -> attribute oracle
//   STREAM_RING generated 0 on a vertical board: all of the above at once
//   compacted cam_nt ({0,2}): the displayed nametable is an alias, the dialogue XOR picks an alias -> displayed-NT check + alias trace
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { makeBypassTree, loadBypassTree } from '../lib/ringbypass.js';
import { runScene, cellById, assertRingRun, RING_BOARDS, RING_FULL } from '../lib/ringrun.js';
import { laps, seam, seamStart } from '../lua/ring_gate/ringscene.mjs';

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

const GAME_TYPES = RING_FULL ? ['action', 'rpg'] : ['action'];

for (const boardId of RING_BOARDS) {
  for (const gameType of GAME_TYPES) {
    const cell = cellById(boardId);
    test(`(a) lap: ${boardId} ${gameType} -- terrain + attributes of both live nametables after every checkpoint, enter dialogues at every crossing, no alias write`, { skip }, async () => {
      const scene = { ...laps({ ring: 1, talkers: 'enter' }), start: {} };
      assertRingRun(assert, await runScene({ loaded, cell, gameType, scene, talkers: 'enter' }), `${boardId} ${gameType} lap`);
    });
    test(`(a) lap without dialogue: ${boardId} ${gameType} -- the strip stream alone`, { skip: skip || !RING_FULL }, async () => {
      const scene = { ...laps({ ring: 1, talkers: 'none' }), start: {} };
      assertRingRun(assert, await runScene({ loaded, cell, gameType, scene, talkers: 'none' }), `${boardId} ${gameType} lap/no talkers`);
    });
    for (const variant of [0, 1]) {
      test(`(e) seam landing ${variant}: ${boardId} ${gameType} -- the dialogue box straddles the NT0|NT1 join (split close rows), terrain + attributes`, { skip }, async () => {
        const scene = { ...seam({ ring: 1, variant }), start: seamStart({ ring: 1, variant }) };
        assertRingRun(assert, await runScene({ loaded, cell, gameType, scene, talkers: 'enter' }), `${boardId} ${gameType} seam${variant}`);
      });
    }
  }
}

// the resident / battle-bank placements of the dialogue overlay both run: banked needs an RPG whose text overflows the resident ceiling
for (const boardId of RING_FULL ? RING_BOARDS : []) {
  test(`(a)+(e) lap with the dialogue overlay in the battle bank: ${boardId} rpg`, { skip }, async () => {
    const scene = { ...laps({ ring: 1, talkers: 'enter' }), start: {} };
    const r = await runScene({ loaded, cell: cellById(boardId), gameType: 'rpg', scene, placement: 'banked', talkers: 'enter' });
    assert.ok(r.fns.sw_dlg_single < 0xc000 && r.fns.sw_dlg_single >= 0x8000, `the overlay must really be banked (sw_dlg_single at $${r.fns.sw_dlg_single?.toString(16)})`);
    assertRingRun(assert, r, `${boardId} rpg banked lap`);
  });
}

test('(c) the PPU write trace itself works: a four-screen-style write to $2800 would be counted (control)', { skip }, async () => {
  // The trace is installed by runScene; prove it records an alias-addressed $2007 write at all, so "0 alias writes" above means something.
  const { bootRom } = await import('../lua/ring_gate/ringrun_jsnes.mjs');
  const { installPpuTrace } = await import('../lib/ringrun.js');
  const { sceneProject } = await import('../lib/ringrun.js');
  const { buildThrough } = await import('../lib/ringbypass.js');
  const fs = await import('node:fs');
  const scene = { ...seam({ ring: 1, variant: 0 }), start: seamStart({ ring: 1, variant: 0 }) };
  const { project } = sceneProject({ cell: cellById('MMC3-V'), gameType: 'action', scene });
  const built = await buildThrough(loaded, project);
  try {
    const nes = bootRom(built.romPath);
    const trace = installPpuTrace(nes, { aliasRange: (a) => a >= 0x2800 && a < 0x3000 });
    for (let i = 0; i < 40; i++) nes.frame();
    nes.mmap.write(0x2006, 0x28); // the register path a CPU store takes: $2006 hi, $2006 lo, then $2007 data
    nes.mmap.write(0x2006, 0x00);
    nes.mmap.write(0x2007, 0x55);
    assert.deepEqual(trace.alias, [0x2800], 'a $2007 write addressed to $2800 is recorded as an alias write');
  } finally {
    fs.rmSync(built.dir, { recursive: true, force: true });
  }
});

test('(c) the PPU write trace survives every power cycle: an alias write AFTER reloadROM is counted (control for the Continue scenes)', { skip }, async () => {
  // reloadROM -> reset() replaces the PPU; a trace wrapped on the first PPU alone would stay silent for everything drawn after a Continue.
  const { bootRom } = await import('../lua/ring_gate/ringrun_jsnes.mjs');
  const { installPpuTrace, sceneProject } = await import('../lib/ringrun.js');
  const { buildThrough } = await import('../lib/ringbypass.js');
  const fs = await import('node:fs');
  const scene = { ...seam({ ring: 1, variant: 0 }), start: seamStart({ ring: 1, variant: 0 }) };
  const { project } = sceneProject({ cell: cellById('MMC3-V'), gameType: 'action', scene });
  const built = await buildThrough(loaded, project);
  const aliasWrite = (nes, hi) => { nes.mmap.write(0x2006, hi); nes.mmap.write(0x2006, 0x00); nes.mmap.write(0x2007, 0x55); };
  try {
    const nes = bootRom(built.romPath);
    const trace = installPpuTrace(nes, { aliasRange: (a) => a >= 0x2800 && a < 0x3000 });
    for (let i = 0; i < 40; i++) nes.frame();
    const ppu0 = nes.ppu;
    aliasWrite(nes, 0x28);
    assert.deepEqual(trace.alias, [0x2800], 'before the power cycle');
    nes.reloadROM();
    assert.notEqual(nes.ppu, ppu0, 'reloadROM must really replace the PPU for this control to mean anything');
    assert.equal(trace.resets, 1);
    assert.equal(trace.epochs.length, 2, 'one epoch per PPU');
    for (let i = 0; i < 40; i++) nes.frame();
    const epoch1 = trace.epochs[1].writes;
    assert.ok(epoch1 > 0, 'the replacement PPU\'s own boot writes are traced (they did not exist for the old trace)');
    aliasWrite(nes, 0x2c);
    assert.deepEqual(trace.alias, [0x2800, 0x2c00], 'a $2C00 write after reloadROM is counted');
    nes.reloadROM();
    aliasWrite(nes, 0x28);
    assert.deepEqual(trace.alias, [0x2800, 0x2c00, 0x2800], 'and after a second power cycle');
    assert.equal(trace.resets, 2);
    assert.equal(trace.writes, trace.epochs.reduce((n, e) => n + e.writes, 0), 'the whole-scene count is the sum of the per-PPU counts');
  } finally {
    fs.rmSync(built.dir, { recursive: true, force: true });
  }
});
