// Phase 3b S2 (C2), test (e): the streamed dialogue overlay on the vertical ring -- open, write, close -- at BOTH live nametable indices
// (the camera's NT parity 0 and 1) and at box positions that do and do not straddle the NT0|NT1 join (so the first close row is split into
// two packets, the 88-byte worst frame), judged against the terrain AND attribute oracle at the typing stage, the typed (open) state and
// the closed terrain. The dialogue/attribute consumers (engine/streamdialog.asm) are NOT edited by C2: this pins that they are correct on
// the ring unchanged.
//
// Scenes are the S1 prototype's dialogueScene (ring 1): one landing per (box start column residue r = 2k, NT parity), one `enter` talker on
// the landing screen. k = 0 is the unsplit box (starts at the NT's first column), k = 8 / 15 straddle the join (r0 = 16 / 30).
//
// Wrong implementations these catch:
//   a compacted/offset NT index breaking sw_dlg_*_addr ('cam-nt-compacted'): the box is written through an alias or the wrong NT
//   the attribute table hi byte forgetting +3 ('attr-hi-3-omitted'): the box's attribute overlay lands in the tile area of the NT
//   a render/strip fork that left the attribute shadow inconsistent ('shadow-n32'): the open band reads a corrupt shadow, the closed restore is wrong
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

const KS = [0, 8, 15];
const RUNS = RING_FULL
  ? [
      { board: 'MMC3-V', gameType: 'action', placement: 'resident' },
      { board: 'MMC1-V', gameType: 'rpg', placement: 'resident' },
      { board: 'MMC1-V', gameType: 'rpg', placement: 'banked' },
      { board: 'U512-V', gameType: 'rpg', placement: 'resident' },
      { board: 'U512-V', gameType: 'rpg', placement: 'banked' }
    ]
  : [{ board: 'MMC3-V', gameType: 'action', placement: 'resident' }];

for (const { board, gameType, placement } of RUNS) {
  for (const k of KS) {
    for (const parity of [0, 1]) {
      test(`(e) dialogue open/write/close: ${board} ${gameType} ${placement}, box column r=${2 * k}, camera NT index ${parity}${k > 0 ? ' (split close row)' : ''}`, { skip }, async () => {
        const scene = dialogueScene({ ring: 1, k, parity });
        const r = await runScene({ loaded, cell: cellById(board), gameType, scene, placement, talkers: 'landing' });
        assertRingRun(assert, r, `${board} ${gameType} ${placement} r=${2 * k} p=${parity}`);
        assert.equal(r.recs.filter((x) => x.kind === 'dlg-open').length, 1, 'exactly one dialogue was opened and closed');
        assert.ok(r.recs.some((x) => x.kind === 'dlg-typing'), 'a mid-typing stage was recorded and judged');
        if (placement === 'banked') assert.ok(r.fns.sw_dlg_single >= 0x8000 && r.fns.sw_dlg_single < 0xc000, 'the overlay is in the switchable (battle) bank');
        else assert.ok(r.fns.sw_dlg_single >= 0xc000, 'the overlay is resident');
      });
    }
  }
}
