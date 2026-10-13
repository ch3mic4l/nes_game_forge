// Phase 3b S3 (C1), test (b): the streamed dialogue overlay on the HORIZONTAL ring -- open, write, close -- at BOTH live nametable indices (the camera's
// NT index 0 and 2, i.e. Y parity 0 and 1) and at box positions that do and do not straddle the NT0|NT2 join (so the box wraps the 30-row ring), judged
// against the terrain AND attribute oracle at the typing stage, the typed (open) state and the closed terrain. engine/streamdialog.asm is NOT edited by S3:
// this pins that its address helpers are correct on the horizontal ring unchanged (vertical code reused with a compacted index would fail here:
// 'h-cam-nt-compacted').
//
// Scenes are the S1 prototype's dialogueScene (ring 2): one landing per (box start row residue R0, NT parity), one `enter` talker on the landing screen.
// R0 = (2k + 24) mod 30: k = 0 (R0 24) is the box wholly inside the NT, k = 1, 2 (R0 26, 28) straddle the join, k = 3 (R0 0) starts at the top, k = 7 is mid.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { makeBypassTree, loadBypassTree } from '../lib/ringbypass.js';
import { runScene, cellById, assertRingRun, RING_FULL } from '../lib/ringrun.js';
import { dialogueScene } from '../lua/ring_gate/ringdialogue.mjs';

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

const KS = RING_FULL ? [0, 1, 2, 3, 7] : [0, 2];
const RUNS = RING_FULL
  ? [
      { board: 'MMC3-H', gameType: 'action', placement: 'resident' },
      { board: 'MMC1-H', gameType: 'rpg', placement: 'resident' },
      { board: 'MMC1-H', gameType: 'rpg', placement: 'banked' },
      { board: 'U512-H', gameType: 'rpg', placement: 'resident' },
      { board: 'U512-H', gameType: 'rpg', placement: 'banked' }
    ]
  : [{ board: 'MMC3-H', gameType: 'action', placement: 'resident' }];

for (const { board, gameType, placement } of RUNS) {
  for (const k of KS) {
    for (const parity of [0, 1]) {
      const r0 = (2 * k + 24) % 30;
      test(`(b) dialogue open/write/close: ${board} ${gameType} ${placement}, box row R0=${r0}, camera NT index ${2 * parity}${r0 >= 25 ? ' (box wraps the join)' : ''}`, { skip }, async () => {
        const scene = dialogueScene({ ring: 2, k, parity });
        const r = await runScene({ loaded, cell: cellById(board), gameType, scene, placement, talkers: 'landing' });
        assertRingRun(assert, r, `${board} ${gameType} ${placement} R0=${r0} p=${parity}`);
        assert.equal(r.recs.filter((x) => x.kind === 'dlg-open').length, 1, 'exactly one dialogue was opened and closed');
        assert.ok(r.recs.some((x) => x.kind === 'dlg-typing'), 'a mid-typing stage was recorded and judged');
        const camNts = new Set(r.recs.map((x) => x.state.cam_nt));
        assert.ok([...camNts].every((n) => n === 0 || n === 2), `only the live NT indices {0, 2} are ever produced (saw ${[...camNts]})`);
        assert.ok(camNts.has(2 * parity), `the scene really ran at camera NT index ${2 * parity}`);
        if (placement === 'banked') assert.ok(r.fns.sw_dlg_single >= 0x8000 && r.fns.sw_dlg_single < 0xc000, 'the overlay is in the switchable (battle) bank');
        else assert.ok(r.fns.sw_dlg_single >= 0xc000, 'the overlay is resident');
      });
    }
  }
}
