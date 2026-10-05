// Input acceptance for the streamed text-box close (Say/Move overrun fix, review 2 section 2): Cadence, Ownership, Release.
// The close is nine bodies (six rows, three attribute bodies) in which the box state is CLOSING; `text.asm` accepts a press only in
// PAGEWAIT / ENDWAIT / CHOICEWAIT, so a pulse inside the close is ignored, not queued. These tests pin THAT contract; no input queue exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAndBoot, press, BTN, BOX_STATE, GAME_STATE, PLAYER_X, PLAYER_Y, BOX_ENDWAIT, ST_GAMEPLAY } from '../lib/streamedpinching.js';
import { buildCloseDeadlineProject } from '../lib/closedeadline.js';

const PAD = 0x17; // engine/constants.asm: pad (held), pad_new (pressed this frame); bits A B Sel Start U D L R = 7..0
const PAD_B = 0x40;
const PAD_START = 0x10;
const PAD_NEW = 0x18;
const BOX_CLOSING = 5; // engine/constants.asm BOX_CLOSING (the value box_state holds while the close runs)
const ST_DIALOG = 2;

/** Boots the deadline project (streamed map, talker beside the player), opens the talker with B and parks at ENDWAIT. */
async function atEndwait() {
  const { nes, mem } = await buildAndBoot(buildCloseDeadlineProject());
  for (let i = 0; i < 100 && mem[GAME_STATE] !== ST_GAMEPLAY; i++) nes.frame();
  for (let i = 0; i < 100; i++) nes.frame();
  press(nes, BTN.B, 0);
  let n = 0;
  while (mem[BOX_STATE] !== BOX_ENDWAIT && n++ < 300) nes.frame();
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the conversation reached ENDWAIT');
  for (let i = 0; i < 4; i++) nes.frame();
  return { nes, mem };
}

/** Frames with the box CLOSING after the closing press; `onFrame(i)` runs before each frame. Returns the per-frame trace. */
function runClose(nes, mem, onFrame = () => {}) {
  const trace = [];
  for (let i = 0; i < 40; i++) {
    onFrame(i);
    nes.frame();
    trace.push({ box: mem[BOX_STATE], row: mem[0x41], gs: mem[GAME_STATE], pad: mem[PAD], padNew: mem[PAD_NEW], x: mem[PLAYER_X], y: mem[PLAYER_Y] });
  }
  return trace;
}

test('Cadence: the close samples the pad once per frame, and the close actually ran (CLOSING for the nine bodies, then gameplay)', async () => {
  const { nes, mem } = await atEndwait();
  nes.buttonDown(1, BTN.B);
  const trace = runClose(nes, mem, (i) => { if (i === 2) nes.buttonUp(1, BTN.B); if (i === 4) nes.buttonDown(1, BTN.START); if (i === 5) nes.buttonUp(1, BTN.START); });
  const closing = trace.filter((t) => t.box === BOX_CLOSING).length;
  assert.ok(closing >= 6, `the close ran: ${closing} CLOSING frames`);
  assert.equal(trace.at(-1).gs, ST_GAMEPLAY);
  assert.equal(trace[0].pad & PAD_B, PAD_B, 'frame 0 sampled B held');
  assert.equal(trace[0].padNew, PAD_B, 'and as a fresh press');
  assert.equal(trace[1].pad & PAD_B, PAD_B, 'frame 1 still held');
  assert.equal(trace[1].padNew, 0, 'a held button is not a fresh press on the next frame');
  assert.equal(trace[2].pad, 0, 'frame 2 sampled the release (the release is injected before it)');
  assert.equal(trace[4].pad & PAD_START, PAD_START, 'a one-frame Start pulse injected at frame 4 is sampled in exactly that frame');
  assert.equal(trace[4].padNew & PAD_START, PAD_START);
  assert.equal(trace[5].pad & PAD_START, 0, 'and gone the next');
});

test('Ownership: a pulse wholly inside the close is ignored and not replayed after release; a held confirm makes no new press', async () => {
  // reference: the same close with no pulse at all -- the number of frames the box spends CLOSING
  const quiet = await atEndwait();
  press(quiet.nes, BTN.B, 0);
  const qt = runClose(quiet.nes, quiet.mem);
  const quietClosing = qt.filter((t) => t.box === BOX_CLOSING).length + 1; // + the closing press's own frame, which already sets CLOSING
  assert.ok(quietClosing >= 6);

  const { nes, mem } = await atEndwait();
  let closing = 0;
  const step = () => { nes.frame(); if (mem[BOX_STATE] === BOX_CLOSING) closing++; };
  nes.buttonDown(1, BTN.B); step(); nes.buttonUp(1, BTN.B); // the closing press
  assert.equal(mem[BOX_STATE], BOX_CLOSING);
  nes.buttonDown(1, BTN.A); step(); nes.buttonUp(1, BTN.A); // a pulse inside CLOSING
  nes.buttonDown(1, BTN.B); step(); nes.buttonUp(1, BTN.B);
  const rows = [];
  for (let i = 0; i < 40; i++) { step(); if (mem[BOX_STATE] === BOX_CLOSING) rows.push(mem[0x41]); }
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY);
  assert.ok(rows.every((r, k) => k === 0 || r >= rows[k - 1]), `box_row fell back during the close (a pulse restarted it): ${rows}`);
  assert.equal(closing, quietClosing, 'two pulses inside the close neither restarted nor lengthened it');
  assert.ok(closing >= 6, 'the close ran');
  for (let k = 0; k < 30; k++) { nes.frame(); assert.equal(mem[BOX_STATE], 0, 'no conversation reopened after the close: the pulses were not queued'); }
  // a held confirm across the close: still no new press once the close is over
  const held = await atEndwait();
  held.nes.buttonDown(1, BTN.B);
  const t2 = runClose(held.nes, held.mem);
  const end = t2.findIndex((t) => t.gs === ST_GAMEPLAY && t.box === 0);
  assert.ok(end >= 0, 'the held-confirm close finished');
  assert.ok(t2.slice(end).every((t) => t.box === 0 && t.padNew === 0), 'held B across the close produced no new press and no new conversation');
  // CONTROL: release and press afresh -- a new conversation does open
  held.nes.buttonUp(1, BTN.B);
  held.nes.frame();
  press(held.nes, BTN.B, 0);
  let opened = false;
  for (let k = 0; k < 60 && !opened; k++) { held.nes.frame(); opened = held.mem[BOX_STATE] !== 0; }
  assert.ok(opened, 'CONTROL: a fresh press after release opens the talker again');
});

test('Release: a fresh press in the first eligible dispatch body acts like one later; a direction released before then does not move the player', async () => {
  // reference: let the close finish, wait, press B
  const ref = await atEndwait();
  press(ref.nes, BTN.B, 0);
  for (let i = 0; i < 30; i++) ref.nes.frame();
  assert.equal(ref.mem[GAME_STATE], ST_GAMEPLAY);
  for (let i = 0; i < 20; i++) ref.nes.frame();
  press(ref.nes, BTN.B, 0);
  let refOpen = false;
  for (let k = 0; k < 60 && !refOpen; k++) { ref.nes.frame(); refOpen = ref.mem[BOX_STATE] !== 0; }
  assert.ok(refOpen, 'reference: a fresh press once gameplay owns input opens the talker');

  // first eligible body: press on the frame gameplay owns input again
  const fast = await atEndwait();
  press(fast.nes, BTN.B, 0);
  let k = 0;
  while (fast.mem[GAME_STATE] !== ST_GAMEPLAY && k++ < 40) fast.nes.frame();
  assert.equal(fast.mem[GAME_STATE], ST_GAMEPLAY);
  press(fast.nes, BTN.B, 0);
  let fastOpen = false;
  for (let j = 0; j < 60 && !fastOpen; j++) { fast.nes.frame(); fastOpen = fast.mem[BOX_STATE] !== 0; }
  assert.ok(fastOpen, 'a fresh press in the first eligible body behaves like the reference');

  // a direction held during the close and released before gameplay resumes does not move the player; held through, it resumes after
  const rel = await atEndwait();
  const x0 = rel.mem[PLAYER_X], y0 = rel.mem[PLAYER_Y];
  press(rel.nes, BTN.B, 0);
  rel.nes.buttonDown(1, BTN.UP);
  const trace = runClose(rel.nes, rel.mem, (i) => { if (i === 3) rel.nes.buttonUp(1, BTN.UP); });
  assert.ok(trace.filter((t) => t.box === BOX_CLOSING).every((t) => t.x === x0 && t.y === y0), 'no movement while the box is closing');
  assert.deepEqual([trace.at(-1).x, trace.at(-1).y], [x0, y0], 'a direction released before gameplay owns input never moves the player');
  const held = await atEndwait();
  const hy = held.mem[PLAYER_Y];
  press(held.nes, BTN.B, 0);
  held.nes.buttonDown(1, BTN.UP);
  const t2 = runClose(held.nes, held.mem);
  assert.ok(t2.filter((t) => t.gs === ST_DIALOG).every((t) => t.y === hy), 'the world is not released early: no movement in a dialog frame');
  assert.notEqual(t2.at(-1).y, hy, 'CONTROL: a direction held through the close resumes movement once gameplay owns input');
});
