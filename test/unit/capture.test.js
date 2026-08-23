// renderer/emulator/capture.js's sampling and cap policy, checked exactly
// (not with >=) per the design's own instruction -- these are requirements,
// not incidental behaviour.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder } from '../../renderer/emulator/capture.js';
import { decodeGif } from '../lib/gifdecode.js';

/** Pixel 0 carries a marker so a decoded frame can be traced back to the offer that produced it. */
function markerFrame(width, height, marker) {
  const frame = new Uint32Array(width * height);
  frame[0] = marker;
  return frame;
}

test('Record keeps the frame on screen immediately, then exactly every third offered frame', () => {
  const recorder = createRecorder({ width: 2, height: 2, delayCs: 5 });
  recorder.start(markerFrame(2, 2, 0));
  for (let i = 1; i <= 10; i++) recorder.offerFrame(markerFrame(2, 2, i));

  assert.equal(recorder.frameCount, 1 + Math.floor(10 / 3));
  const gif = decodeGif(recorder.finish());
  const markers = gif.frames.map((frame) => frame.pixels[0]);
  assert.deepEqual(markers, [0, 3, 6, 9]);
});

test('a recording stopped immediately after Record is a one-frame GIF, never zero', () => {
  const recorder = createRecorder({ width: 2, height: 2, delayCs: 5 });
  recorder.start(markerFrame(2, 2, 42));
  assert.equal(recorder.frameCount, 1);

  const gif = decodeGif(recorder.finish());
  assert.equal(gif.frames.length, 1);
});

test('the 300th kept frame stops the recording; the 301st is never offered to the encoder', () => {
  const recorder = createRecorder({ width: 2, height: 2, delayCs: 5, cap: 300 });
  recorder.start(markerFrame(2, 2, 0));
  // 299 more keeps are due from offerFrame -- one every 3rd call -- so 897 calls lands exactly on frame 300.
  // Drained every few offers, the way tick()'s own drainCapture() would in
  // practice, so the pending-queue limit (8) never gets in the way of
  // reaching the 300-frame cap this test is actually about.
  for (let i = 0; i < 897; i++) {
    recorder.offerFrame(markerFrame(2, 2, 1));
    if (i % 5 === 0) recorder.drain();
  }
  recorder.drain();
  assert.equal(recorder.frameCount, 300);
  assert.equal(recorder.isRecording(), false);
  assert.equal(recorder.hitCap(), true);
  assert.equal(recorder.queueOverflowed(), false);

  // Further offers after the cap must never reach the encoder.
  for (let i = 0; i < 20; i++) recorder.offerFrame(markerFrame(2, 2, 1));
  assert.equal(recorder.frameCount, 300);

  const gif = decodeGif(recorder.finish());
  assert.equal(gif.frames.length, 300);
});

test('stopping short of the cap does not report it as having been hit', () => {
  const recorder = createRecorder({ width: 2, height: 2, delayCs: 5, cap: 300 });
  recorder.start(markerFrame(2, 2, 0));
  for (let i = 0; i < 9; i++) recorder.offerFrame(markerFrame(2, 2, 1));
  assert.equal(recorder.hitCap(), false);
  recorder.finish();
});

test('discard abandons a recording: no further frames are kept, and nothing queued survives to a later finish()', () => {
  const recorder = createRecorder({ width: 2, height: 2, delayCs: 5 });
  recorder.start(markerFrame(2, 2, 0));
  recorder.offerFrame(markerFrame(2, 2, 1));
  recorder.offerFrame(markerFrame(2, 2, 2));
  recorder.offerFrame(markerFrame(2, 2, 3)); // the 3rd offer -- kept, so 2 frames sit queued, undrained, when discard() runs
  recorder.discard();
  assert.equal(recorder.isRecording(), false);

  const countAfterDiscard = recorder.frameCount;
  recorder.offerFrame(markerFrame(2, 2, 4));
  recorder.offerFrame(markerFrame(2, 2, 5));
  recorder.offerFrame(markerFrame(2, 2, 6));
  assert.equal(recorder.frameCount, countAfterDiscard);

  // A discard() that only set recording=false, leaving the queue and the
  // encoder intact, would still let finish() succeed here and hand back a
  // real GIF built from the 2 frames that were supposedly abandoned. The
  // queue (and the encoder) must actually be gone.
  assert.throws(() => recorder.finish());
});

test("offerFrame() only queues -- it never touches the encoder, whose own validation would otherwise fire synchronously", () => {
  const recorder = createRecorder({ width: 2, height: 2, delayCs: 5 });
  recorder.start(markerFrame(2, 2, 0));
  const wrongSize = new Uint32Array(9); // not 2x2 -- gif.js's addFrame() rejects any size but width*height
  // If offerFrame() called into the encoder directly (the "encode inside
  // keep()" shape rev 3's own finding 2 rules out), this would throw here,
  // on the 3rd (due) offer, synchronously inside offerFrame() itself.
  assert.doesNotThrow(() => {
    recorder.offerFrame(wrongSize);
    recorder.offerFrame(wrongSize);
    recorder.offerFrame(wrongSize);
  });
  // The encoder only ever sees it once drain() actually runs -- and its own
  // dimension check is what proves that's where the real work happens.
  assert.throws(() => recorder.drain(), /expected 4 pixels/);
});

test('offerFrame() copies the buffer immediately -- mutating the caller\'s own buffer afterward does not change what gets encoded', () => {
  const recorder = createRecorder({ width: 2, height: 2, delayCs: 5 });
  // A single reused buffer, exactly like the emulator hands onFrame the same
  // Uint32Array every frame (renderer/emulator/player.js's own lastFrameBuffer).
  const shared = markerFrame(2, 2, 0);
  recorder.start(shared.slice()); // the "immediate" frame -- a snapshot taken before any of the mutations below
  shared[0] = 111;
  recorder.offerFrame(shared); // offer 1 of 3 -- not due
  shared[0] = 222;
  recorder.offerFrame(shared); // offer 2 of 3 -- not due
  shared[0] = 3;
  recorder.offerFrame(shared); // offer 3 of 3 -- due; must be captured with THIS value
  shared[0] = 999; // mutated again, after the due offer -- must not reach the kept copy
  recorder.drain();

  const gif = decodeGif(recorder.finish());
  assert.deepEqual(
    gif.frames.map((frame) => frame.pixels[0]),
    [0, 3]
  );
});

test('the pending queue is bounded at 8 -- overflow stops the recording rather than growing unbounded or silently dropping', () => {
  const recorder = createRecorder({ width: 2, height: 2, delayCs: 5 });
  recorder.start(markerFrame(2, 2, 0));
  // stepOver()/stepOut() can run many real frames before stepAnd() ever
  // drains, so nothing bounds the queue from the caller's side -- offer 24
  // frames with no drain() in between. Every 3rd is due: 8 due offers (at
  // i=3,6,...,24) would grow the queue from 1 (the immediate frame) to 9,
  // one past the 8-frame limit; the 8th due offer is refused instead.
  for (let i = 1; i <= 24; i++) recorder.offerFrame(markerFrame(2, 2, i));

  assert.equal(recorder.isRecording(), false);
  assert.equal(recorder.queueOverflowed(), true);
  assert.equal(recorder.hitCap(), false);
  assert.equal(recorder.frameCount, 8); // the immediate frame + 7 successfully queued -- the 8th due offer was refused, not counted

  // Further offers after the overflow must never reach the queue either.
  recorder.offerFrame(markerFrame(2, 2, 999));
  assert.equal(recorder.frameCount, 8);

  // Whatever made it in before the overflow must still drain and finish
  // cleanly -- an overflow is a stop, not a corruption of what was captured.
  recorder.drain();
  const gif = decodeGif(recorder.finish());
  assert.equal(gif.frames.length, 8);
  assert.deepEqual(
    gif.frames.map((frame) => frame.pixels[0]),
    [0, 3, 6, 9, 12, 15, 18, 21]
  );
});
