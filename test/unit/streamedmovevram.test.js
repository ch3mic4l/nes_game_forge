// Phase 3a slice S3a, T8 (plan §7 S3a, §8.1): the VRAM envelope of a streamed Move's FINAL frame.
//
// move_finish -> script_resume can run further commands in the same frame (Say, Flash, a switch effect, a second Move), so the frame a
// Move ends on is the heaviest one. The Move adds no VRAM producer: its strips are built in sbuf and streamed by NMI, and everything else
// still queues in vram_buf. What decides how a strip shares a vblank with that queue is the shipped arbitration at nmi_vram_dispatch
// (engine/boot.asm): nothing ready -> a FULL strip chunk; a ready queue of at most MIXED_VBLANK_MAX_BYTES (35) -> the queue drains AND a
// REDUCED chunk advances; a larger queue -> an exclusive drain and the strip waits.
//
// This test drives the real ROM, hooks every NMI (the PC at nmi_vram_dispatch), and records for each: vram_ready, vram_len, st_active,
// st_cur, and which of the three paths NMI took (PC at sw_nmi_stream / sw_nmi_stream_reduced / nmi_drain_big). It then pins, per final-frame
// combination, the actual lengths and chunks, and checks the arbitration RULE on every observation. The full-frame CYCLE count of the same
// scenes is the Mesen manifest's (M11b, T9): a headless emulator has no cycle accounting.
//
// Constants below are hand-written: 35 from engine/constants.asm (MIXED_VBLANK_MAX_BYTES), 3 and 2 from engine/streamworld.asm
// (SW_STREAM_CHUNK, SW_STREAM_MIXED_CHUNK), vram_len/vram_ready from engine/constants.asm.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { A, terrainProject, buildBoot, awaitMoveStart, tracePc } from '../lib/streamedmovecam.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const boots = { skip: !hasNesasm && 'nesasm not found on PATH' };

const VRAM_LEN = 0x3c; // engine/constants.asm
const VRAM_READY = 0x3f;
const MIXED_MAX = 35;
const FULL_CHUNK = 3;
const REDUCED_CHUNK = 2;

// A 4-pixel Move right from x = 100 on screen 1: its last step lands where the camera crosses a block boundary, so a column strip is armed on
// the very frame the Move finishes (the first NMI after move_finish sees st_active = 1, st_cur = 0).
const MOVE = { op: 'move', who: 'player', dir: 'right', dist: 4 };
const COMBOS = {
  'move only': { tail: [] },
  'Say': { tail: [{ op: 'say', text: 'Hello there, traveller.' }] },
  'Flash': { tail: [{ op: 'flash' }] },
  'switch effect': { tail: [{ op: 'setSwitch', switch: 5 }] },
  'second Move': { tail: [{ op: 'move', who: 'player', dir: 'right', dist: 4 }] }
};

/** Boots the combination and returns one record per NMI from the first NMI after the first Move's move_finish, for `frames` frames. */
async function observe(gameType, tail, frames = 40) {
  const project = terrainProject({ gameType, commands: [MOVE, ...tail], startX: 100, startY: 112, moveScreen: 1 });
  const { nes, mem, syms } = await buildBoot(project);
  for (const label of ['nmi_vram_dispatch', 'sw_nmi_stream_reduced', 'sw_nmi_stream', 'nmi_drain_big', 'move_finish']) assert.ok(syms[label] !== undefined, `no ${label}`);
  const obs = [];
  let finished = false;
  let cur = null;
  const stop = tracePc(nes, (pc) => {
    if (pc === syms.move_finish) finished = true;
    if (pc === syms.nmi_vram_dispatch) {
      cur = { len: mem[VRAM_LEN], ready: mem[VRAM_READY], st: mem[A.ST_ACTIVE], stCur: mem[A.ST_CUR], path: 'none', after: finished };
      obs.push(cur);
    }
    if (cur && pc === syms.sw_nmi_stream) cur.path = 'full';
    if (cur && pc === syms.sw_nmi_stream_reduced) cur.path = 'reduced';
    if (cur && pc === syms.nmi_drain_big) cur.path = 'big';
  });
  try {
    assert.ok(awaitMoveStart(nes) >= 0, 'the Move must start');
    for (let i = 0; i < frames; i++) nes.frame();
  } finally {
    stop();
  }
  const after = obs.filter((o) => o.after);
  assert.ok(after.length >= 15, `observed ${after.length} NMIs after the Move finished`);
  return after;
}

for (const gameType of ['action', 'rpg']) {
  for (const [name, { tail }] of Object.entries(COMBOS)) {
    test(`T8 (${gameType}) Move ending with ${name}: the arbitration rule holds on every NMI of the final frames, and the lengths and chunks are the pinned ones`, boots, async () => {
      const after = await observe(gameType, tail);
      // precondition: a strip really was active on the final frame
      assert.equal(after[0].st, 1, 'a column strip is active at the first NMI after the Move finished');
      assert.equal(after[0].stCur, 0, 'and it has not advanced yet');

      // the arbitration rule, on every observation (hand-written from boot.asm's three exits)
      for (const [i, o] of after.entries()) {
        const want = !o.ready ? 'full' : o.len <= MIXED_MAX ? 'reduced' : 'big';
        assert.equal(o.path, want, `NMI ${i}: ready ${o.ready}, vram_len ${o.len}, strip ${o.st}: took ${o.path}, the rule says ${want}`);
        assert.ok(o.len <= 38, `NMI ${i}: vram_len ${o.len} stays inside the pinned maximum of 38 (the 81-byte worst case is not approached)`);
        if (o.path === 'big') assert.equal(o.st, 0, `NMI ${i}: an exclusive drain never overlaps an active strip (the strip waits, the dialogue waits for the strip)`);
        const next = after[i + 1];
        if (next && o.st === 1 && next.st === 1) {
          const advance = next.stCur - o.stCur;
          if (o.path === 'full') assert.equal(advance, FULL_CHUNK, `NMI ${i}: a full chunk advances the strip by ${FULL_CHUNK}`);
          if (o.path === 'reduced') assert.equal(advance, REDUCED_CHUNK, `NMI ${i}: a reduced chunk advances the strip by ${REDUCED_CHUNK}`);
        }
      }

      // the lengths and regimes this combination actually produces
      const lens = after.filter((o) => o.len > 0);
      const completes = after.findIndex((o) => o.st === 0);
      assert.ok(completes > 0, 'the strip completes within the window');
      if (name === 'Say') {
        assert.ok(lens.length > 0, 'the box packets are queued');
        assert.deepEqual([...new Set(lens.map((o) => o.len))].sort((a, b) => b - a), [38, 15, 4], 'the Say box queues a 38-byte packet, then 15 and 4 bytes');
        assert.deepEqual([...new Set(lens.filter((o) => o.len > MIXED_MAX).map((o) => o.path))], ['big'], 'the 38-byte packet takes the exclusive drain (the one over 35)');
        assert.deepEqual([...new Set(lens.filter((o) => o.len <= MIXED_MAX).map((o) => o.path))], ['reduced'], 'the small ones the mixed path');
        assert.ok(after.indexOf(lens[0]) >= completes, 'it is queued only after the strip has completed (the strip never shares a vblank with it)');
        assert.ok(after.slice(0, completes).every((o) => o.path === 'full' && o.len === 0), 'while the strip runs the vblank is the strip\'s alone: full chunks');
      } else if (name === 'Flash') {
        assert.deepEqual([...new Set(lens.map((o) => o.len))], [MIXED_MAX], 'Flash\'s palette packet is exactly 35 bytes: the largest queue that still shares a vblank');
        assert.deepEqual([...new Set(lens.map((o) => o.path))], ['reduced']);
        assert.ok(lens.every((o) => o.st === 1), 'and every one of them shares its vblank with the ACTIVE strip');
        assert.ok(lens.length >= 2, 'both the on and the restore publication reach NMI during the strip');
      } else {
        assert.equal(lens.length, 0, `${name} queues nothing: the strip has every vblank to itself`);
        assert.ok(after.slice(0, completes).every((o) => o.path === 'full'));
      }
    });
  }
}
