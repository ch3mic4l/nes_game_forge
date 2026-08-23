// The Record button's policy: which emulated frames get kept, when a
// recording stops itself, and who owns the GIF encoder. DOM-free and
// Node-free, like gif.js, so test/unit/capture.test.js can drive it with
// nothing that looks like a canvas or an emulator.
//
// player.js (phase 2) is the caller. Its shape is fixed by three things this
// module has to accommodate without touching a DOM API itself:
//
// - `onFrame` runs inside emulator.runFrame(), so offerFrame() only ever
//   decides whether a frame is due and, if so, copies it onto a queue. It
//   must not encode: encoding is real work, onFrame has no frame of slack to
//   spend on it, and an exception thrown from inside it is caught by tick()'s
//   own handler and reported as "Crashed: ...", turning a recorder bug into
//   what reads as an emulator crash. tick() itself bounds a single drain gap
//   to 4 real frames (owedFrames), but stepOver()/stepOut() are not tick()
//   -- they can run arbitrarily many real frames before stepAnd() ever
//   drains, which is what PENDING_QUEUE_LIMIT below is for.
// - drain() is what actually calls into the GIF encoder, meant to be invoked
//   once after the frame loop (tick()) or after a single step (stepAnd()),
//   inside the caller's own try/catch -- a capture failure should stop the
//   recording and toast, not crash the player.
// - stepAnd() also fires a synthetic onFrame to make single-stepping visible
//   (writeFrame() outside runFrame()), which is not a completed emulated
//   frame and must never reach offerFrame() at all. That guard lives in the
//   caller (a `presenting` flag around the one call site); this module just
//   has to not assume every offerFrame() call corresponds to a full frame
//   advance, which the queue-based design already doesn't.

import { createGifEncoder } from './gif.js';

const SAMPLE_EVERY = 3; // every third *offered* frame after the immediate first, per the design's 20.03fps timing
const DEFAULT_CAP = 300; // 15s at the sampled rate; the recording stops itself here
// tick() bounds itself to 4 real frames between drains (owedFrames), but
// stepOver()/stepOut() are not tick() -- they can run an unbounded number of
// real frames (walking out of a subroutine, say) before stepAnd() ever
// returns and drains. 8 is comfortably above tick()'s own ceiling, so it
// never fires there, while still bounding the worst case to a handful of
// frames (a few hundred KB of raw copies) rather than the 300-frame cap's
// own ~74MB if nothing ever drained a runaway step.
const PENDING_QUEUE_LIMIT = 8;

/**
 * @param {object} options
 * @param {number} options.width
 * @param {number} options.height
 * @param {number} options.delayCs GIF delay units (1/100s) between kept frames
 * @param {number} [options.cap] kept-frame ceiling before the recording stops itself
 */
export function createRecorder({ width, height, delayCs, cap = DEFAULT_CAP }) {
  let encoder = null;
  let recording = false;
  let capped = false;
  let overflowed = false;
  let offeredSinceKeep = 0; // counts offerFrame() calls since the last kept frame
  let keptCount = 0;
  const queue = [];

  /** Record captures the frame on screen immediately -- a recording stopped straight away is a one-frame GIF, never zero. */
  function start(firstFrame) {
    encoder = createGifEncoder({ width, height, delayCs });
    recording = true;
    capped = false;
    overflowed = false;
    offeredSinceKeep = 0;
    keptCount = 0;
    queue.length = 0;
    keep(firstFrame);
  }

  /**
   * The frame that would push the queue past PENDING_QUEUE_LIMIT is refused
   * outright, not dropped-but-counted and not queued anyway: dropping would
   * silently shorten the recording's own clock (the same reasoning behind
   * keeping a 1x1 no-op for an identical frame rather than skipping it), and
   * queuing past the limit is the unbounded retention this limit exists to
   * rule out. Recording stops here -- the caller (player.js) is expected to
   * finish() whatever made it in and tell the user why it stopped short.
   */
  function keep(frame) {
    if (queue.length >= PENDING_QUEUE_LIMIT) {
      recording = false;
      overflowed = true;
      return;
    }
    queue.push(frame.slice());
    keptCount++;
    if (keptCount >= cap) {
      recording = false;
      capped = true;
    }
  }

  /** Called once per completed emulated frame. A no-op once stopped, capped, or never started. */
  function offerFrame(frame) {
    if (!recording) return;
    offeredSinceKeep++;
    if (offeredSinceKeep % SAMPLE_EVERY === 0) keep(frame);
  }

  /** Feeds whatever is queued into the encoder, in order. Safe to call whether or not anything is queued. */
  function drain() {
    while (queue.length) encoder.addFrame(queue.shift());
  }

  function isRecording() {
    return recording;
  }

  /** True once the cap stopped the recording on its own, rather than an explicit stop. */
  function hitCap() {
    return capped;
  }

  /** True once a step ran further than the pending queue could hold, stopping the recording on its own. */
  function queueOverflowed() {
    return overflowed;
  }

  /** Drains, finalizes the GIF, and returns its bytes. Recording is over either way. */
  function finish() {
    recording = false;
    drain();
    const bytes = encoder.finish();
    encoder = null;
    return bytes;
  }

  /** Abandons the recording with nothing written -- a torn-down player, a failed reload, or a fresh Reload Test. */
  function discard() {
    recording = false;
    queue.length = 0;
    encoder = null;
  }

  return {
    start,
    offerFrame,
    drain,
    finish,
    discard,
    isRecording,
    hitCap,
    queueOverflowed,
    get frameCount() {
      return keptCount;
    }
  };
}
