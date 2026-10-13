// Phase 3b S3 (C1), tests (b) and (c): the horizontal ring's VRAM + attribute oracle after a lap, and the PPU write trace.
//
// The certified S1 prototype's own scenes (test/lua/ring_gate/ringscene.mjs, ring 2), interpreter (ringrun_jsnes.mjs) and judge (ringjudge.mjs over the
// independent oracle test/lib/ringoracle.js), run against the PRODUCTION engine through the test-only bypass copy (test/lib/ringbypass.js). A lap walks a
// 1 x 4 ring down across every seam and back with an `enter` talker per screen, so row strips stream, the window wraps both live nametables ($2000/$2800)
// and a dialogue opens and closes at every crossing. After EVERY checkpoint the live nametables must equal the oracle byte for byte, attribute tables
// included, the camera registers must equal the camera rule, and the whole run must contain no PPU write addressed to $24xx/$2Cxx (the mirror aliases of
// the two live nametables on horizontal mirroring).
//
// Wrong implementations these catch (the sabotage log, handoff-next/s3-c1/sabotage.log, has the measured catch of each):
//   row strip at the torus length (32) or load (32): the second half of a row draws at +$04 of a nametable that does not exist on this ring -> oracle + alias trace
//   render window stepping the index by 1: nametables 1 and 3 (aliases of 0 and 2) are drawn over the live pair -> alias trace + oracle
//   compacted cam_nt (Y parity in bit 0): the displayed nametable is an alias -> displayed-NT check
//   column strip reached on a horizontal build: st_active = 1 -> the strip-mode assertion and the oracle
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { makeBypassTree, loadBypassTree } from '../lib/ringbypass.js';
import { runScene, cellById, assertRingRun, aliasRangeOf, liveNtsOf, RING_BOARDS_H, RING_FULL } from '../lib/ringrun.js';
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

for (const boardId of RING_BOARDS_H) {
  for (const gameType of GAME_TYPES) {
    const cell = cellById(boardId);
    test(`(b) lap: ${boardId} ${gameType} -- terrain + attributes of both live nametables after every checkpoint, enter dialogues at every crossing, no alias write`, { skip }, async () => {
      const scene = { ...laps({ ring: 2, talkers: 'enter' }), start: {} };
      assertRingRun(assert, await runScene({ loaded, cell, gameType, scene, talkers: 'enter' }), `${boardId} ${gameType} lap`);
    });
    test(`(b) lap without dialogue: ${boardId} ${gameType} -- the row strip stream alone`, { skip: skip || !RING_FULL }, async () => {
      const scene = { ...laps({ ring: 2, talkers: 'none' }), start: {} };
      assertRingRun(assert, await runScene({ loaded, cell, gameType, scene, talkers: 'none' }), `${boardId} ${gameType} lap/no talkers`);
    });
    for (const variant of [0, 1]) {
      test(`(b) seam landing ${variant}: ${boardId} ${gameType} -- the dialogue box straddles the NT0|NT2 join, terrain + attributes`, { skip }, async () => {
        const scene = { ...seam({ ring: 2, variant }), start: seamStart({ ring: 2, variant }) };
        assertRingRun(assert, await runScene({ loaded, cell, gameType, scene, talkers: 'enter' }), `${boardId} ${gameType} seam${variant}`);
      });
    }
  }
}

// the resident / battle-bank placements of the dialogue overlay both run: banked needs an RPG whose text overflows the resident ceiling
for (const boardId of RING_FULL ? RING_BOARDS_H : []) {
  test(`(b) lap with the dialogue overlay in the battle bank: ${boardId} rpg`, { skip }, async () => {
    const scene = { ...laps({ ring: 2, talkers: 'enter' }), start: {} };
    const r = await runScene({ loaded, cell: cellById(boardId), gameType: 'rpg', scene, placement: 'banked', talkers: 'enter' });
    assert.ok(r.fns.sw_dlg_single < 0xc000 && r.fns.sw_dlg_single >= 0x8000, `the overlay must really be banked (sw_dlg_single at $${r.fns.sw_dlg_single?.toString(16)})`);
    assertRingRun(assert, r, `${boardId} rpg banked lap`);
  });
}

test('(c) the horizontal alias range is exactly the mirrors of the two live nametables, and the vertical range is unchanged (control for "0 alias writes")', () => {
  const h = aliasRangeOf(2);
  const v = aliasRangeOf(1);
  assert.deepEqual(liveNtsOf(2), [0x2000, 0x2800]);
  for (const live of [0x2000, 0x2003, 0x23ff, 0x2800, 0x2bff]) assert.equal(h(live), false, `horizontal live $${live.toString(16)} is not an alias`);
  for (const alias of [0x2400, 0x27ff, 0x2c00, 0x2fff, 0x3400, 0x3c00]) assert.equal(h(alias), true, `horizontal alias $${alias.toString(16)}`);
  for (const alias of [0x2800, 0x2c00, 0x2fff, 0x3800]) assert.equal(v(alias), true, `vertical alias $${alias.toString(16)}`);
  for (const live of [0x2000, 0x2400, 0x27ff]) assert.equal(v(live), false, `vertical live $${live.toString(16)}`);
});

test('(c) a $2400 write on a horizontal ring is recorded as an alias write and a live $2800 write is not (the trace works per ring)', { skip }, async () => {
  const { bootRom } = await import('../lua/ring_gate/ringrun_jsnes.mjs');
  const { installPpuTrace, sceneProject } = await import('../lib/ringrun.js');
  const { buildThrough } = await import('../lib/ringbypass.js');
  const fs = await import('node:fs');
  const scene = { ...seam({ ring: 2, variant: 0 }), start: seamStart({ ring: 2, variant: 0 }) };
  const { project } = sceneProject({ cell: cellById('MMC3-H'), gameType: 'action', scene });
  const built = await buildThrough(loaded, project);
  try {
    const nes = bootRom(built.romPath);
    const trace = installPpuTrace(nes, { aliasRange: aliasRangeOf(2) });
    for (let i = 0; i < 40; i++) nes.frame();
    const before = trace.alias.length;
    const write = (hi) => { nes.mmap.write(0x2006, hi); nes.mmap.write(0x2006, 0x00); nes.mmap.write(0x2007, 0x55); };
    write(0x28);
    assert.equal(trace.alias.length, before, 'a write to the live $2800 is not an alias write');
    write(0x24);
    write(0x2c);
    assert.deepEqual(trace.alias.slice(before), [0x2400, 0x2c00], 'writes addressed to $2400 and $2C00 are recorded');
  } finally {
    fs.rmSync(built.dir, { recursive: true, force: true });
  }
});
