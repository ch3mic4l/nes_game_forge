// Phase 3b S3 (C1), test (c): the text-box CLOSE frame's queue on the horizontal ring is ONE close-row packet -- Flip top, Flip bottom, Flash, arrow hide, ONE
// 3+32 close row, terminator = 85 bytes, vram_len 84 -- where the vertical ring, mid-scroll, splits the row across the $2000/$2400 join (88 bytes, vram_len 87).
//
// On the horizontal ring cam_x_lo is pinned to 0, so the dialogue run writer's seam column (32 - cam_x_lo>>3) is 32, a value no real column equals, and the row
// is never split. The queue is captured under jsnes at main_loop_ready on the frame the dismissing press is consumed (test/lib/ringcloseframe.js: the Mesen
// close-deadline harness's scene and its synthetic Flip + Flash poke), and validated BY STRUCTURE (each header, in main_loop's call order), never by a fixed length.
//
// Wrong implementations this catches: a hard-coded split ('h-close-split-16': the run writer's seam at column 16 publishes the row as two packets), and the
// converse -- a vertical expectation applied to the horizontal ring (the retired fixed vram_len 87 / two close packets).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { makeBypassTree, loadBypassTree } from '../lib/ringbypass.js';
import { cellById, RING_FULL } from '../lib/ringrun.js';
import { captureCloseFrame, closeShape } from '../lib/ringcloseframe.js';

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

const hiLive = (ring, hi) => (ring === 1 ? hi >= 0x20 && hi <= 0x27 : (hi >= 0x20 && hi <= 0x23) || (hi >= 0x28 && hi <= 0x2b));

/** The structure of the close frame's queue: [Flip, Flip, Flash, arrow hide, close row x parts], then the terminator at vram_len. */
function assertCloseStructure(assert, r, parts, label) {
  const p = r.packets;
  assert.equal(p.length, 4 + parts, `${label}: ${p.length} packets queued, ${4 + parts} expected (flip, flip, Flash, arrow hide, close row in ${parts})`);
  assert.ok(p[0].cnt === 2 && p[1].cnt === 2 && hiLive(r.ring, p[0].hi) && hiLive(r.ring, p[1].hi), `${label}: the Flip's two packets (queued first) are 2-byte bodies in a live nametable`);
  assert.ok(p[2].hi === 0x3f && p[2].lo === 0 && p[2].cnt === 32, `${label}: the Flash packet is the 32-byte palette write at $3F00`);
  assert.ok(hiLive(r.ring, p[3].hi) && p[3].cnt === 1, `${label}: the arrow hide is a 1-byte write in a live nametable`);
  const c = p[4];
  assert.ok(hiLive(r.ring, c.hi), `${label}: the close row's first packet is in a live nametable`);
  if (parts === 1) {
    assert.ok(c.cnt === 32 && (c.lo & 0x1f) === 0, `${label}: the close row is one whole 32-tile row from the left edge`);
  } else {
    const d = p[5];
    assert.ok(c.cnt >= 1 && c.cnt <= 31 && (c.lo & 0x1f) + c.cnt === 32, `${label}: the first part runs to the nametable's right edge`);
    assert.ok(hiLive(r.ring, d.hi) && c.cnt + d.cnt === 32 && (d.lo & 0x1f) === 0 && Math.abs(d.hi - c.hi) === 4, `${label}: the second part is the same row's left edge on the other live nametable`);
  }
  assert.equal(r.vramLen, p.reduce((n, k) => n + 3 + k.cnt, 0), `${label}: vram_len is headers + data`);
}

const BOARDS = RING_FULL ? ['MMC3-H', 'MMC1-H', 'U512-H'] : ['MMC3-H'];
const GAME_TYPES = RING_FULL ? ['action', 'rpg'] : ['action'];
for (const boardId of BOARDS) {
  for (const gameType of GAME_TYPES) {
    test(`(c) horizontal close frame: ${boardId} ${gameType} -- one 3+32 close row, 85 bytes, vram_len 84, no split`, { skip }, async () => {
      const r = await captureCloseFrame({ loaded, tree, cell: cellById(boardId), gameType });
      assert.deepEqual(closeShape(2), { parts: 1, vramLen: 84, bytes: 85 }, 'the declared shape');
      assertCloseStructure(assert, r, 1, `${boardId} ${gameType}`);
      assert.equal(r.vramLen, 84, 'vram_len 84');
      assert.equal(r.vramLen + 1, 85, 'the 85-byte frame (terminator included)');
    });
  }
}

test('(c) control: the vertical ring, mid-scroll, still splits its close row (88 bytes, vram_len 87) -- the structure check discriminates', { skip }, async () => {
  const r = await captureCloseFrame({ loaded, tree, cell: cellById('MMC3-V'), gameType: 'action' });
  assertCloseStructure(assert, r, 2, 'MMC3-V action');
  assert.equal(r.vramLen, 87);
  assert.throws(() => assertCloseStructure(assert, r, 1, 'vertical read as horizontal'), /packets queued/);
});
