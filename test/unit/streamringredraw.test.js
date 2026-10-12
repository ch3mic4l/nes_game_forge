// Phase 3b S2 (C2), test (a) -- the full-redraw paths: position-jump guard, door warp and RPG battle return.
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

for (const boardId of RING_BOARDS) {
  const cell = cellById(boardId);
  for (const gameType of GAME_TYPES) {
    for (const entry of ['guard', 'warp']) {
      test(`(a) redraw by ${entry === 'guard' ? 'the position-jump guard' : 'a door warp'}: ${boardId} ${gameType} -- every window origin residue, then ordinary streaming`, { skip }, async () => {
        const scene = redrawScene({ ring: 1, entry, battery: battery(cell) });
        assertRingRun(assert, await runScene({ loaded, cell, gameType, scene, talkers: 'none' }), `${boardId} ${gameType} redraw-${entry}`);
      });
    }
  }
  if (!RING_FULL) continue;
  for (const placement of ['resident', 'banked']) {
    test(`(a) redraw by an RPG battle return: ${boardId} rpg ${placement}`, { skip }, async () => {
      const scene = redrawScene({ ring: 1, entry: 'battle', battery: battery(cell) });
      assertRingRun(assert, await runScene({ loaded, cell, gameType: 'rpg', scene, placement, talkers: 'none' }), `${boardId} rpg ${placement} redraw-battle`);
    });
  }
}
