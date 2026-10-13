// Phase 3b S3 (C1), test (b) -- the horizontal ring's full-redraw paths: position-jump guard, door warp, RPG battle return, Continue after a Save, and the
// Continue landings no walk reaches.
//
// Every scene drives one REAL entry into sw_render_window (the single full-redraw renderer) and then walks on to show ordinary streaming resumed; the
// scenes, interpreter and judge are the S1 prototype's (test/lua/ring_gate/ringredraw.mjs, ring 2) against the PRODUCTION engine through the bypass copy.
// After each redraw the live nametables ($2000/$2800) must equal the oracle (terrain + attributes), the camera registers the camera rule, and no PPU write may
// be addressed to $24xx/$2Cxx.
//
// Wrong implementations these catch: a render window stepping by 1 ('h-render-step-1': the redraw writes the aliases over the live pair), a compacted cam_nt
// ('h-cam-nt-compacted'), a row strip at the torus length resuming after the redraw ('h-row-len-32').
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { makeBypassTree, loadBypassTree } from '../lib/ringbypass.js';
import { runScene, cellById, assertRingRun, RING_BOARDS_H, RING_FULL } from '../lib/ringrun.js';
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

for (const boardId of RING_BOARDS_H) {
  const cell = cellById(boardId);
  for (const gameType of GAME_TYPES) {
    for (const entry of ['guard', 'warp', 'continue']) {
      test(`(b) redraw by ${{ guard: 'the position-jump guard', warp: 'a door warp', continue: 'Continue after a Save' }[entry]}: ${boardId} ${gameType} -- every window origin residue, then ordinary streaming`, { skip }, async () => {
        const scene = redrawScene({ ring: 2, entry, battery: battery(cell) });
        assertRingRun(assert, await runScene({ loaded, cell, gameType, scene, talkers: 'none' }), `${boardId} ${gameType} redraw-${entry}`);
      });
    }
  }
  if (!RING_FULL) continue;
  for (const placement of ['resident', 'banked']) {
    test(`(b) redraw by an RPG battle return: ${boardId} rpg ${placement}`, { skip }, async () => {
      const scene = redrawScene({ ring: 2, entry: 'battle', battery: battery(cell) });
      assertRingRun(assert, await runScene({ loaded, cell, gameType: 'rpg', scene, placement, talkers: 'none' }), `${boardId} rpg ${placement} redraw-battle`);
    });
  }
  // the landings no walk reaches: Continue at local y 224 / 225 / 239 on both NT parities
  for (const c of LAND_CASES[2]) {
    test(`(b) Continue landing ${landId(2, c)}: ${boardId} action`, { skip }, async () => {
      const scene = landScene({ ring: 2, ...c, battery: battery(cell) });
      assertRingRun(assert, await runScene({ loaded, cell, gameType: 'action', scene, talkers: 'none' }), `${boardId} ${landId(2, c)}`);
    });
  }
}
