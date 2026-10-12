// Phase 3b S2 (C2), test (a) -- the full-redraw path through Continue (a save, a power cycle, the title screen).
//
// Every scene drives one REAL entry into sw_render_window (the single full-redraw renderer) and then walks on to show ordinary streaming
// resumed; calling the renderer directly is never a witness. The scenes, interpreter and judge are the S1 prototype's (test/lua/ring_gate/
// ringredraw.mjs, ringrun_jsnes.mjs, ringjudge.mjs over test/lib/ringoracle.js), run against the PRODUCTION engine through the test-only
// bypass copy. After each redraw the live nametables must equal the oracle (terrain + attributes), the camera registers must equal the
// camera rule, and no PPU write may be addressed to $28xx/$2Cxx.
//
// Wrong implementations these catch: a render window enumerating four nametables ('render-4-nts': the redraw writes $28xx/$2Cxx over the live
// pair), one that skips nametable 1 ('render-step-2'), an attribute shadow at n*32 ('shadow-n32': the first strip after a redraw reads a
// corrupt shadow), and an unforked strip resuming after the redraw ('strip-len-30').
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { makeBypassTree, loadBypassTree } from '../lib/ringbypass.js';
import { runScene, cellById, assertRingRun, RING_BOARDS, RING_FULL } from '../lib/ringrun.js';
import { redrawScene, landScene, LAND_CASES, landId } from '../lua/ring_gate/ringredraw.mjs';

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
const battery = (cell) => cell.mapper !== 30; // SRAM on MMC1/MMC3, the flash sector on UNROM 512

// Continue from the title screen: a Save NPC per target window origin, a power cycle, Continue (SRAM on MMC1/MMC3, the flash sector on UNROM 512)
for (const boardId of RING_BOARDS) {
  const cell = cellById(boardId);
  for (const gameType of GAME_TYPES) {
    test(`(a) redraw by Continue after a Save: ${boardId} ${gameType}`, { skip }, async () => {
      const scene = redrawScene({ ring: 1, entry: 'continue', battery: battery(cell) });
      assertRingRun(assert, await runScene({ loaded, cell, gameType, scene, talkers: 'none' }), `${boardId} ${gameType} redraw-continue`);
    });
  }
  // the landings no walk reaches: Continue at local y 225 / 239 on both NT parities
  if (!RING_FULL) continue;
  for (const c of LAND_CASES[1]) {
    test(`(a) Continue landing ${landId(1, c)}: ${boardId} action`, { skip }, async () => {
      const scene = landScene({ ring: 1, ...c, battery: battery(cell) });
      assertRingRun(assert, await runScene({ loaded, cell, gameType: 'action', scene, talkers: 'none' }), `${boardId} ${landId(1, c)}`);
    });
  }
}

// (c) the PPU write trace across Continue. reloadROM replaces the PPU, so the trace has to follow it: a $2800/$2C00 write injected right after
// EVERY power cycle (a real MMC3-V action Continue scene) must be counted and must fail assertRingRun -- with a trace wrapped on the first PPU
// alone this scene passed with 0 aliases -- and what is drawn after Continue must itself be witnessed on the replacement PPU.
test('(c) an alias write injected after every Continue power cycle is caught; the post-Continue redraw is witnessed', { skip }, async () => {
  const cell = cellById('MMC3-V');
  const scene = redrawScene({ ring: 1, entry: 'continue', battery: true });
  let injected = 0;
  const onNes = (nes) => {
    const reload = nes.reloadROM.bind(nes);
    nes.reloadROM = () => {
      reload();
      for (const hi of [0x28, 0x2c]) { nes.mmap.write(0x2006, hi); nes.mmap.write(0x2006, 0x00); nes.mmap.write(0x2007, 0x55); injected++; }
    };
  };
  const r = await runScene({ loaded, cell, gameType: 'action', scene, talkers: 'none', onNes });
  assert.ok(r.trace.resets > 0 && injected === 2 * r.trace.resets, `every power cycle got its injection (${injected} for ${r.trace.resets} cycle(s))`);
  assert.equal(r.trace.alias.length, injected, 'every injected alias write was counted');
  assert.throws(() => assertRingRun(assert, r, 'injected'), /mirror alias/);
  // the uninjected scene: each PPU, including the one Continue ran on, has drawn both live nametables by itself
  const clean = await runScene({ loaded, cell, gameType: 'action', scene, talkers: 'none' });
  assertRingRun(assert, clean, 'MMC3-V action continue (clean)');
  assert.equal(clean.trace.epochs.length, clean.trace.resets + 1);
  assert.ok(clean.trace.resets > 0, 'the scene really power-cycled');
  for (const e of clean.trace.epochs.slice(1)) assert.ok(e.byNt[0x2000] > 0 && e.byNt[0x2400] > 0, `the PPU after Continue drew both live nametables: ${JSON.stringify(e.byNt)}`);
});
