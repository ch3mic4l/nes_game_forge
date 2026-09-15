// A pure, DOM-free model of battle_fx_arm_at/battle_fx_tick/battle_fx_draw
// (engine/battleturn.asm, engine/battleui.asm; docs/design-battle-animation.md
// §15.1). Input is always a NORMALIZED animation object -- shared/project.js's
// own normalizeAnimation clamps every frame's duration to 1-255 (defaulted to
// 8) unconditionally, so the stepper never has to special-case a missing one.
// A hand-built test fixture that omits a frame's own duration is not a legal
// stepper input on its own and must be normalized (or authored with an
// explicit duration) first -- §15.6 restates this for the trace test's own
// fixture.
//
// `state` is `null` when the effect is not running -- the JS equivalent of
// bt_fx_anim == NO_ANIM -- or `{ animation, frame, timer }` otherwise,
// mirroring bt_fx_frame/bt_fx_timer/"which animation" (bt_fx_anim itself,
// but held as an object reference rather than re-derived from an id every
// tick). loop is never read, on purpose (§15.1).
//
// Placement: beside renderer/widgets/metasprite.js, not shared/ -- nothing in
// main/build/ needs a playback stepper (§15.2's own placement rationale).

/**
 * battle_fx_arm_at, restricted to arming a FRESH preview -- it takes no
 * prior-state argument, so it cannot model the ROM's own "already live"
 * branch (the early `cmp #NO_ANIM`/`beq`, engine/battleturn.asm:310-311,
 * which leaves an existing effect running rather than clearing it -- §15.1's
 * own two NO_ANIM rows). Selecting "None" in the UI is a separate CLEAR
 * policy (§15.5), never a call to this function with `animation = null`.
 * Returns null (NO_ANIM) for a missing animation or one with zero frames
 * (battle_fx_arm_at_empty, :322-325).
 */
export function armBattleFx(animation) {
  if (!animation || animation.frames.length === 0) return null;
  return { animation, frame: 0, timer: 0 };
}

/** battle_fx_tick. `state` is a prior armBattleFx/tickBattleFx result; null is a no-op. */
export function tickBattleFx(state) {
  if (!state) return null;
  const timer = state.timer + 1;
  const { duration } = state.animation.frames[state.frame];
  if (timer < duration) return { animation: state.animation, frame: state.frame, timer };
  const frame = state.frame + 1;
  if (frame >= state.animation.frames.length) return null; // one pass; loop never read
  return { animation: state.animation, frame, timer: 0 };
}

/**
 * battle_fx_draw's own fit check, re-evaluated fresh every call -- never
 * cached from arm time (§15.1). `tileCount(metaspriteId)` is the caller's
 * own lookup (§15.3); `room` is battleFxOamRoom(project, mapper). A
 * zero-tile metasprite is legal (normalizeMetasprite enforces no minimum
 * length, shared/project.js). Zero PASSES the room check itself (0 is never
 * > room) -- what actually stops the draw is the downstream compositor's own
 * separate zero-count return (draw_metasprite, engine/entities.asm:621-624,
 * reached only after battle_fx_draw's own room compare,
 * engine/battleui.asm:1059-1061, has already let it through). So `tiles ===
 * 0` must be checked explicitly here rather than folded into `tiles > room`
 * (round-1 finding P2-3: `0 > room` is false, which would have wrongly
 * reported a draw).
 * Returns the frame's metaspriteId if it would draw this tick, else null.
 */
export function drawnBattleFx(state, room, tileCount) {
  if (!state) return null;
  const frame = state.animation.frames[state.frame];
  const tiles = tileCount(frame.metaspriteId);
  return tiles === 0 || tiles > room ? null : frame.metaspriteId;
}

/**
 * A DOM-free wall-clock pacer, paired with the stepper above (§15.4). Kept
 * in this same module rather than a separate file: it is three lines of
 * closure state with no DOM dependency either, and the two are always
 * consumed together by the same mount.
 */
export function createBattleFxPacer(nesFps = 60.0988) {
  let lastTime = null;
  let owed = 0;
  return {
    /** Zero accrued debt and forget the time origin -- called on every re-arm (§15.4). */
    reset() {
      lastTime = null;
      owed = 0;
    },
    /** How many whole ticks have accrued since the last call, capped and fractional-carrying (§15.4). */
    advanceTo(now) {
      if (lastTime === null) {
        lastTime = now;
        return 0; // no first-callback credit -- observation 0 is already painted at arm (§15.4)
      }
      owed += ((now - lastTime) / 1000) * nesFps;
      lastTime = now;
      if (owed > 4) owed = 4; // a stall or a hidden window never fast-forwards (player.js:211's rule)
      const ticks = Math.floor(owed);
      owed -= ticks;
      return ticks;
    }
  };
}

/**
 * The dynamic-viewport bounding box (§15.5): the union, over every frame of
 * the given (already normalized) animation and every tile entry of each
 * frame's own metasprite, of [tile.x, tile.x + 8) x [tile.y, tile.y + 8).
 * `metasprites` is the project's own `project.sprites.metasprites` array (or
 * an equivalent lookup table) -- a frame naming a metasprite that does not
 * exist (or that has no tiles) contributes nothing to the union; the widget
 * never arms such an animation (isPlayableBattleAnimation refuses it), but
 * this pure function must not throw on it regardless. Returns `{ width,
 * height, originX, originY }`, `originX = -minX`/`originY = -minY` so the
 * union's own top-left corner becomes canvas (0, 0), tight, no wasted
 * margin. When the union is empty (an empty animation, or one whose every
 * frame's metasprite has zero tiles -- both legal cases, §15.1/§15.5), the
 * named 64 x 64 / origin (0, 0) fallback is returned instead of 0 x 0.
 */
export function battleFxBounds(animation, metasprites) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const frame of animation?.frames ?? []) {
    const metasprite = metasprites?.[frame.metaspriteId];
    if (!metasprite) continue;
    for (const tile of metasprite.tiles ?? []) {
      if (tile.x < minX) minX = tile.x;
      if (tile.y < minY) minY = tile.y;
      if (tile.x + 8 > maxX) maxX = tile.x + 8;
      if (tile.y + 8 > maxY) maxY = tile.y + 8;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { width: 64, height: 64, originX: 0, originY: 0 };
  }
  // `|| 0` normalizes -0 (from -minX/-minY when the union's own minimum is
  // exactly 0) to a plain, unsigned 0 -- a real canvas coordinate, never a
  // signed-zero artifact a caller or a test could trip on.
  return { width: maxX - minX, height: maxY - minY, originX: -minX || 0, originY: -minY || 0 };
}
