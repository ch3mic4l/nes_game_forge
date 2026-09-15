// Battle-side animation, phase 3 (docs/design-battle-animation.md §15.2,
// §15.4, §15.5, §15.7's own "Stepper unit tests"/"Pacer unit tests"/
// "dynamic viewport unit... cases" rows): fast, DOM-free, no ROM, no build --
// the tests an implementation runs on every save. §15.6's own frame-for-frame
// ROM trace (test/unit/rpg.test.js) is the acceptance proof that these fast
// tests agree with the real engine, not a replacement for them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { armBattleFx, tickBattleFx, drawnBattleFx, createBattleFxPacer, battleFxBounds } from '../../renderer/widgets/battlefx.js';

// ---------------------------------------------------------------------------
// Stepper: armBattleFx / tickBattleFx / drawnBattleFx
// ---------------------------------------------------------------------------

test('armBattleFx(null) arms nothing', () => {
  // Wrong implementation this catches: one that returns a state object
  // regardless of its input, rather than modeling battle_fx_arm_at's own
  // NO_ANIM/missing-animation case (§15.1's first table row).
  assert.equal(armBattleFx(null), null);
});

test('armBattleFx of an empty animation (frames: []) arms nothing -- battle_fx_arm_at_empty', () => {
  // Wrong implementation this catches: an arm that stages an empty animation
  // as "live with nothing to tick" instead of reverting outright
  // (battle_fx_arm_at_empty, engine/battleturn.asm:312-325) -- §15.1's third
  // table row, §15.6 case 4.
  assert.equal(armBattleFx({ frames: [] }), null);
});

test('armBattleFx of a real animation arms at frame 0, timer 0', () => {
  const animation = { frames: [{ metaspriteId: 7, duration: 5 }] };
  const state = armBattleFx(animation);
  assert.deepEqual(state, { animation, frame: 0, timer: 0 });
});

test('tickBattleFx(null) is a no-op', () => {
  assert.equal(tickBattleFx(null), null);
});

test('duration 1: a single-frame animation holds for its OWN one tick, not zero -- does not skip the hold', () => {
  // Wrong implementation this catches: "skips a single-frame animation's own
  // hold" (treats frames.length === 1 as "no timing, end immediately on
  // arm") -- §15.6's wrong-implementation table. A buggy stepper of that
  // shape would already diverge at arm (never live at all); the correct one
  // is live at frame 0 immediately after arming, then ends on the very next
  // tick because duration is 1.
  const animation = { frames: [{ metaspriteId: 1, duration: 1 }] };
  let state = armBattleFx(animation);
  assert.notEqual(state, null, 'must be live immediately after arming, per its own duration');
  assert.equal(state.frame, 0);
  assert.equal(state.timer, 0);
  state = tickBattleFx(state);
  assert.equal(state, null, 'a duration-1 frame must end after exactly one tick (post-increment 1 < 1 is false)');
});

test('duration 255: holds for exactly 255 ticks, ending at the 255th, never earlier and never "forever"', () => {
  // Wrong implementations this catches: (1) "treats duration 255 as
  // never-ending" (the $FF-sentinel-confusion shape §15.6 names) -- would
  // still be live after 255 ticks; (2) "compares timer <= duration instead
  // of post-increment timer < duration" -- would end one tick early, at 254.
  const animation = { frames: [{ metaspriteId: 2, duration: 255 }] };
  let state = armBattleFx(animation);
  for (let i = 1; i <= 254; i++) {
    state = tickBattleFx(state);
    assert.notEqual(state, null, `must still be live after tick ${i} (< 255)`);
    assert.equal(state.timer, i, `timer must read ${i} after tick ${i}`);
  }
  state = tickBattleFx(state);
  assert.equal(state, null, 'must end at exactly the 255th tick, not the 254th and not "never"');
});

test('a 3+-frame sequence with distinct durations, one at 255, advances on the correct boundaries and terminates -- does not wrap', () => {
  // Wrong implementations this catches: (1) "wraps" (frame = (frame + 1) %
  // frames.length, advancePreviewFrame's own rule) -- would go back to
  // frame 0 with `live: true` instead of ending; (2) off-by-one on the
  // post-increment compare -- would diverge at EVERY frame boundary here,
  // not only the first, since there are three of them.
  const animation = {
    frames: [
      { metaspriteId: 10, duration: 2 },
      { metaspriteId: 11, duration: 3 },
      { metaspriteId: 12, duration: 4 },
      { metaspriteId: 13, duration: 255 }
    ]
  };
  let state = armBattleFx(animation);
  const observe = () => (state ? { frame: state.frame, timer: state.timer } : null);
  const trace = [observe()];
  // Total ticks to exhaust: 2 + 3 + 4 + 255 = 264.
  for (let i = 0; i < 264; i++) {
    state = tickBattleFx(state);
    trace.push(observe());
  }
  assert.deepEqual(trace[0], { frame: 0, timer: 0 });
  // Frame 0 (duration 2): live at timer 0, timer 1; ends (advances) on tick 2.
  assert.deepEqual(trace[1], { frame: 0, timer: 1 });
  assert.deepEqual(trace[2], { frame: 1, timer: 0 }); // advanced to frame 1
  // Frame 1 (duration 3): timers 0,1,2; advances at tick 3 more (index 5).
  assert.deepEqual(trace[3], { frame: 1, timer: 1 });
  assert.deepEqual(trace[4], { frame: 1, timer: 2 });
  assert.deepEqual(trace[5], { frame: 2, timer: 0 });
  // Frame 2 (duration 4): timers 0,1,2,3; advances at 4 more (index 9).
  assert.deepEqual(trace[6], { frame: 2, timer: 1 });
  assert.deepEqual(trace[7], { frame: 2, timer: 2 });
  assert.deepEqual(trace[8], { frame: 2, timer: 3 });
  assert.deepEqual(trace[9], { frame: 3, timer: 0 });
  // Frame 3 (duration 255): index 9 + 255 = 264 is where it terminates.
  assert.notEqual(trace[9 + 254], null, 'must still be live one tick before its own 255th');
  assert.equal(trace[9 + 255], null, "must terminate to null exactly at the last frame's own duration, never wrapping back to frame 0");
});

test('an empty animation never arms, and a null animation never arms', () => {
  assert.equal(armBattleFx({ frames: [] }), null);
  assert.equal(armBattleFx(null), null);
  assert.equal(armBattleFx(undefined), null);
});

test('drawnBattleFx: a zero-tile frame never draws, even though it PASSES the room compare (tiles === 0 is not folded into tiles > room)', () => {
  // Wrong implementation this catches: `drawnBattleFx` folding the zero-tile
  // check into `tiles > room` alone -- `0 > room` is always false, so such
  // an implementation would wrongly report a draw for a legal, live,
  // ticking zero-tile frame (§15.1's zero-tile row, §15.6 case 5).
  const animation = { frames: [{ metaspriteId: 99, duration: 8 }] };
  const state = armBattleFx(animation);
  const tileCount = (id) => (id === 99 ? 0 : 4);
  assert.equal(drawnBattleFx(state, 64, tileCount), null);
  // Even with room = 0, the answer is still null for the same reason -- not
  // because 0 > 0 is false but because tiles === 0 short-circuits first.
  assert.equal(drawnBattleFx(state, 0, tileCount), null);
});

test('drawnBattleFx: fit at exactly room draws; room + 1 does not', () => {
  // Wrong implementation this catches: an off-by-one in the room compare
  // (`tiles >= room` instead of `tiles > room`), which would wrongly skip an
  // exact-fit frame.
  const room = 10;
  const exactFit = { frames: [{ metaspriteId: 1, duration: 8 }] };
  const oneOver = { frames: [{ metaspriteId: 2, duration: 8 }] };
  const tileCount = (id) => (id === 1 ? room : room + 1);
  assert.equal(drawnBattleFx(armBattleFx(exactFit), room, tileCount), 1, 'a frame using exactly `room` tiles must draw');
  assert.equal(drawnBattleFx(armBattleFx(oneOver), room, tileCount), null, 'a frame using room + 1 tiles must not draw');
});

test('drawnBattleFx: the fit check is re-evaluated every call, both orders (small-then-oversized, oversized-then-small)', () => {
  // Wrong implementation this catches: "decides fit once at arm time,
  // caches it, never re-checks per frame" -- passes a single-frame fit test
  // but diverges here, where the small frame must draw and the oversized one
  // must not, independently of authored order (§15.6 case 7).
  const room = 10;
  const tileCount = (id) => (id === 1 ? 4 /* small */ : 20 /* oversized */);

  const smallThenOversized = { frames: [{ metaspriteId: 1, duration: 1 }, { metaspriteId: 2, duration: 1 }] };
  let state = armBattleFx(smallThenOversized);
  assert.equal(drawnBattleFx(state, room, tileCount), 1, 'small-then-oversized: frame 0 (small) must draw');
  state = tickBattleFx(state);
  assert.equal(drawnBattleFx(state, room, tileCount), null, 'small-then-oversized: frame 1 (oversized) must not draw');

  const oversizedThenSmall = { frames: [{ metaspriteId: 2, duration: 1 }, { metaspriteId: 1, duration: 1 }] };
  state = armBattleFx(oversizedThenSmall);
  assert.equal(drawnBattleFx(state, room, tileCount), null, 'oversized-then-small: frame 0 (oversized) must not draw');
  state = tickBattleFx(state);
  assert.equal(drawnBattleFx(state, room, tileCount), 1, 'oversized-then-small: frame 1 (small) must draw');
});

test('+2 past termination: the stepper stays null and drawnBattleFx keeps returning null, never the last frame', () => {
  // Wrong implementation this catches: "keeps drawing the last frame after
  // the pass ends" (forgets to gate drawnBattleFx on state === null) --
  // passes every mid-animation observation but diverges at the +2-past-
  // termination observations (§15.6's own wrong-implementation table).
  const animation = { frames: [{ metaspriteId: 5, duration: 1 }] };
  let state = armBattleFx(animation);
  state = tickBattleFx(state); // ends
  assert.equal(state, null);
  const tileCount = () => 4;
  assert.equal(drawnBattleFx(state, 64, tileCount), null);
  state = tickBattleFx(state); // +1
  assert.equal(state, null);
  assert.equal(drawnBattleFx(state, 64, tileCount), null);
  state = tickBattleFx(state); // +2
  assert.equal(state, null);
  assert.equal(drawnBattleFx(state, 64, tileCount), null);
});

// ---------------------------------------------------------------------------
// Pacer: createBattleFxPacer (§15.4)
// ---------------------------------------------------------------------------

test('pacer: a 60 Hz injected sequence over t=0..1000 sums to exactly 60 ticks, not a tolerance band', () => {
  const pacer = createBattleFxPacer(); // default NES_FPS ~= 60.0988
  let total = 0;
  for (let i = 0; i <= 60; i++) {
    total += pacer.advanceTo((i * 1000) / 60);
  }
  assert.equal(total, 60);
});

test('pacer: a 120 Hz injected sequence over the SAME t=0..1000 endpoints also sums to exactly 60 ticks', () => {
  const pacer = createBattleFxPacer();
  let total = 0;
  for (let i = 0; i <= 120; i++) {
    total += pacer.advanceTo((i * 1000) / 120);
  }
  assert.equal(total, 60, 'the same real second must accrue the same 60 ticks regardless of callback rate');
});

test('pacer: fractional debt carries across calls and crosses a whole tick on an exact, predetermined call', () => {
  // nesFps = 60 exactly, for clean fractions: each 4ms interval accrues
  // 4 * 60 / 1000 = 0.24 ticks. Zero on calls 1-4 (cumulative 0.24/0.48/
  // 0.72/0.96), crossing to 1 on call 5 (cumulative 1.20).
  const pacer = createBattleFxPacer(60);
  assert.equal(pacer.advanceTo(0), 0); // first call: establishes origin, no credit
  assert.equal(pacer.advanceTo(4), 0);
  assert.equal(pacer.advanceTo(8), 0);
  assert.equal(pacer.advanceTo(12), 0);
  assert.equal(pacer.advanceTo(16), 0, 'must still be zero one call before the boundary (owed = 0.96)');
  assert.equal(pacer.advanceTo(20), 1, 'must return exactly 1 on the call that crosses the whole-tick boundary (owed = 1.20)');
});

test('pacer: a single call with a multi-second gap returns exactly 4, never more', () => {
  const pacer = createBattleFxPacer();
  assert.equal(pacer.advanceTo(0), 0);
  assert.equal(pacer.advanceTo(10000), 4, 'a 10-second real gap must cap at 4 ticks, not ~600');
});

test('pacer: reset() zeroes both lastTime AND owed -- a stale fractional debt must not leak into the next interval', () => {
  // A reset() that clears lastTime but forgets to zero owed would still pass
  // a bare "first call after reset returns 0" check, since the very next
  // call after ANY reset always returns 0 as the "first callback" case
  // regardless of whether debt was actually cleared. This test additionally
  // makes a SECOND post-reset call at an interval chosen so that leaked
  // debt would push its result over what a truly zero-origin pacer owes.
  const pacer = createBattleFxPacer(60); // clean fractions again
  // Accrue real, nonzero fractional debt: 0.96, one call short of a tick.
  pacer.advanceTo(0);
  pacer.advanceTo(4);
  pacer.advanceTo(8);
  pacer.advanceTo(12);
  pacer.advanceTo(16); // owed = 0.96, no tick returned yet
  pacer.reset();
  assert.equal(pacer.advanceTo(1000), 0, 'necessary but not sufficient: first call after reset is always 0');
  // A fresh 16ms interval from the new origin (1000) accrues 16*60/1000 =
  // 0.96 ticks -- a truly zero-origin pacer returns 0 here. If the stale
  // 0.96 had leaked through, this call would see 0.96 + 0.96 = 1.92 and
  // return 1 instead.
  assert.equal(pacer.advanceTo(1016), 0, 'a correct reset must not let pre-reset debt push this call to 1');
});

// ---------------------------------------------------------------------------
// Bounds: battleFxBounds (§15.5's dynamic viewport)
// ---------------------------------------------------------------------------

test('bounds: a tile at x = 64 is included in full -- the whole 8x8 extent, not merely "some" viewport', () => {
  // Wrong implementation this catches: reusing the old fixed 64x64/origin-16
  // frame (or any bounds function that clips rather than unions) would
  // silently lose this tile; a bounds function that only captures the tile's
  // origin without its own width/height would under-report the extent.
  const metasprites = [{ tiles: [{ x: 64, y: 0 }] }];
  const animation = { frames: [{ metaspriteId: 0, duration: 8 }] };
  const bounds = battleFxBounds(animation, metasprites);
  assert.equal(bounds.width, 8, 'the full 8px width of the tile at x=64 must be included');
  assert.equal(bounds.height, 8);
  assert.equal(bounds.originX, -64);
  assert.equal(bounds.originY, 0);
});

test('bounds: an all-zero-tile animation falls back to the named 64x64 / origin (0,0) viewport, never 0x0', () => {
  // Wrong implementation this catches: a bounds function whose all-zero-tile
  // branch returns 0x0 (or NaN/undefined) instead of the named fallback --
  // §15.7's own dedicated fallback row.
  const metasprites = [{ tiles: [] }];
  const animation = { frames: [{ metaspriteId: 0, duration: 8 }] };
  const bounds = battleFxBounds(animation, metasprites);
  assert.equal(bounds.width, 64);
  assert.equal(bounds.height, 64);
  assert.equal(bounds.originX, 0);
  assert.equal(bounds.originY, 0);
  assert.ok(Number.isFinite(bounds.width) && Number.isFinite(bounds.height));
});

test('bounds: an empty frames array also falls back to the named 64x64 viewport', () => {
  const bounds = battleFxBounds({ frames: [] }, []);
  assert.deepEqual(bounds, { width: 64, height: 64, originX: 0, originY: 0 });
});

test('bounds: a frame naming a missing metasprite contributes nothing, and does not throw', () => {
  const animation = { frames: [{ metaspriteId: 999, duration: 8 }] };
  assert.doesNotThrow(() => battleFxBounds(animation, []));
  const bounds = battleFxBounds(animation, []);
  assert.deepEqual(bounds, { width: 64, height: 64, originX: 0, originY: 0 });
});

test('bounds: a negative-offset tile produces a positive origin landing it at (0, 0)', () => {
  const metasprites = [{ tiles: [{ x: -10, y: -20 }] }];
  const animation = { frames: [{ metaspriteId: 0, duration: 8 }] };
  const bounds = battleFxBounds(animation, metasprites);
  assert.equal(bounds.originX, 10);
  assert.equal(bounds.originY, 20);
  assert.equal(bounds.width, 8);
  assert.equal(bounds.height, 8);
});
