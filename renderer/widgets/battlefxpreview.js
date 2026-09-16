// The Magic/Monster Forge preview canvas (docs/design-battle-animation.md
// §15.5, §15.8) -- a DOM wrapper around renderer/widgets/battlefx.js's own
// pure stepper/pacer/bounds, the identical "pure model beside its DOM
// wrapper" split metasprite.js's own paintMetasprite/drawMetaspritePreview
// already establishes. Shared by both Forges (§15.8) so the engine contract
// (§15.6's own gate) is proven once, not once per Forge that happens to call
// this widget.

import { el, fill, fitZoom, observeSize } from '../ui.js';
import { armBattleFx, tickBattleFx, drawnBattleFx, createBattleFxPacer, battleFxBounds } from './battlefx.js';
import { drawMetaspritePreview } from './metasprite.js';
import {
  isPlayableBattleAnimation,
  isValidAnimationRef,
  battleFxOamRoom,
  tilesetAt,
  animationPickerOptions
} from '../../shared/project.js';
import { tileFromString } from '../../shared/chr.js';
import { resolveMapper } from '../../shared/cartridge.js';

const BLANK_BOUNDS = { width: 64, height: 64, originX: 0, originY: 0 };

// A battle animation picker: "None" (null) plus every catalog entry, plus --
// only when the currently stored id does not resolve -- a synthetic, always-
// selected "Missing animation N" option, so re-rendering the select never
// silently substitutes a real animation for a stale one
// (docs/design-battle-animation.md §4, animationPickerOptions/shared/project.js).
// §16.8: deduped here (Chris's own "Dedupe all three now" answer) rather than
// living in each Forge -- `project` is an explicit parameter, not a
// closed-over global reference, so this module keeps the same
// caller-supplies-everything shape mountBattleFxPreview's own
// getProject/getAnimationId callbacks already use.
export function animationSelect(project, selectedId, onChange) {
  const options = animationPickerOptions(project, selectedId);
  return el(
    'select',
    { onchange: (event) => onChange(event.target.value === '' ? null : Number(event.target.value)) },
    el('option', { value: '', selected: selectedId === null || selectedId === undefined }, 'None'),
    options.missing
      ? el('option', { value: options.missing.value, selected: true }, options.missing.label)
      : null,
    options.healthy.map((option) => el('option', { value: option.value, selected: option.selected }, option.label))
  );
}

/**
 * Mounts the preview into `host`, which the widget owns completely: a canvas
 * inside a fixed-size stage (`overflow: hidden`), one Play/Replay button, and
 * one caption paragraph, all built once here.
 *
 * `getProject`/`getAnimationId` are called fresh every `sync()` (never
 * cached) -- which field holds the id is each Forge's own business (a
 * spell's `anim`, an actor's `battle.attackAnim`); `now`/`schedule` default
 * to a `performance.now()`-calling wrapper (a bare `performance.now`
 * reference loses its own `this` binding and throws "Illegal invocation"
 * the moment it is called detached, as `now()`) and `requestAnimationFrame`,
 * and exist so a test can drive the arm-and-scheduled-tick integration
 * deterministically (§15.7).
 *
 * Returns `{ sync, stepPreview, destroy }`.
 */
export function mountBattleFxPreview(host, { getProject, getAnimationId, now = () => performance.now(), schedule = requestAnimationFrame }) {
  const usingRealScheduler = schedule === requestAnimationFrame;

  // Classed distinctly from every other canvas/button/caption a Forge's own
  // panel might have (Monster's own artPicker sheet canvas, notably), so a
  // caller -- or a test -- can find this widget's own DOM unambiguously.
  const canvas = el('canvas.battlefx-canvas', { style: { imageRendering: 'pixelated', display: 'block' } });
  const previewStage = el(
    'div.battlefx-stage',
    {
      style: {
        width: '100%',
        height: '180px',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000',
        border: '1px solid var(--line)',
        borderRadius: '3px'
      }
    },
    canvas
  );
  const button = el('button.btn.btn-sm.battlefx-button', { style: { marginTop: '8px' }, onclick: () => sync({ forceReplay: true }) }, 'Play');
  const caption = el('p.hint.battlefx-caption', { style: { marginTop: '6px', minHeight: '1.2em' } });
  const wrapper = el('div.battlefx-preview', null, previewStage, button, caption);
  fill(host, wrapper);

  // Playback state, mirroring battlefx.js's own `state` shape (§15.2).
  let state = null;
  let armedId = null;
  let armedSignature = null;

  // Cached art/room/bounds/zoom, refreshed every sync() (never per-tick) --
  // the tick loop, stepPreview() and the resize-driven redraw all repaint
  // from these cached values rather than re-fetching the project, since
  // nothing besides a fresh sync() call can change them (§15.5, §15.10's
  // render-tear analysis: a project mutation always reaches sync()
  // synchronously before any later tick can run).
  let currentMetasprites = null;
  let currentDecodedTiles = null;
  let currentSpritePalettes = null;
  let currentRoom = 0;
  let currentBounds = BLANK_BOUNDS;
  let currentZoom = 1;

  // Non-null in the unplayable/empty branches: the fixed caption to show
  // unconditionally, regardless of any later resize or tick. Null means
  // "branch 3 -- compute the crop/fit-skip caption dynamically from state."
  let fixedCaption = 'No animation selected';

  const pacer = createBattleFxPacer();
  let disposed = false;
  let loopRunning = false;
  let rafHandle = null;

  function currentTileCount(metaspriteId) {
    return currentMetasprites?.[metaspriteId]?.tiles.length ?? 0;
  }

  function frameSignature(animation) {
    return animation.frames.map((f) => `${f.metaspriteId}:${f.duration}`).join(',');
  }

  function describeUnplayableCaption(id, project) {
    if (id === null || id === undefined) return 'No animation selected';
    if (!isValidAnimationRef(id, project)) return 'This animation no longer exists';
    return 'This animation references missing artwork';
  }

  /** The same padding-subtracted content box fitZoom itself measures from. */
  function stageContentBox() {
    const style = getComputedStyle(previewStage);
    const width = previewStage.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
    const height = previewStage.clientHeight - parseFloat(style.paddingTop || 0) - parseFloat(style.paddingBottom || 0);
    return { width, height };
  }

  function isCropped(bounds) {
    const box = stageContentBox();
    if (box.width <= 0 || box.height <= 0) return false; // not laid out yet -- the honest "don't know" answer
    return bounds.width > box.width || bounds.height > box.height;
  }

  /** Repaints the canvas and the button/caption from the CURRENT state and cached art -- the one place both do. */
  function paintAndCaption() {
    canvas.width = currentBounds.width;
    canvas.height = currentBounds.height;
    canvas.style.width = `${currentBounds.width * currentZoom}px`;
    canvas.style.height = `${currentBounds.height * currentZoom}px`;
    const ctx = canvas.getContext('2d');

    const drawnId = state === null ? null : drawnBattleFx(state, currentRoom, currentTileCount);
    if (drawnId === null) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else {
      drawMetaspritePreview(canvas, currentMetasprites[drawnId], currentDecodedTiles, currentSpritePalettes, {
        width: currentBounds.width,
        height: currentBounds.height,
        originX: currentBounds.originX,
        originY: currentBounds.originY,
        zoom: currentZoom
      });
    }

    if (fixedCaption !== null) {
      button.disabled = true;
      button.textContent = 'Play';
      caption.textContent = fixedCaption;
      return;
    }

    button.disabled = false;
    button.textContent = state === null ? 'Replay' : 'Play';

    if (isCropped(currentBounds)) {
      caption.textContent = 'Art extends beyond the preview area';
      return;
    }
    // The fit-skip caption (§15.3): a live frame that battle_fx_draw would
    // skip this tick for exceeding room. A zero-tile frame is also "not
    // drawn" but gets no caption at all (a deliberate held beat, not a
    // mistake) -- distinguished by re-checking the tile count itself here,
    // never by trusting `drawnId === null` alone.
    if (state !== null && drawnId === null) {
      const frame = state.animation.frames[state.frame];
      const tiles = currentTileCount(frame.metaspriteId);
      if (tiles > currentRoom) {
        caption.textContent = `This frame won't draw in-game (${tiles} tiles, only ${currentRoom} available) — reduce the party, formation, or the frame's own tile count.`;
        return;
      }
    }
    caption.textContent = '';
  }

  function ensureLoopRunning() {
    if (loopRunning) return;
    loopRunning = true;
    rafHandle = schedule(scheduledLoop);
  }

  // The single self-rescheduling loop (sprite.js:1260-1263's own precedent),
  // with the disposed check BEFORE both rescheduling and stepping -- the
  // opposite order from that precedent, deliberately (§15.7's own smoke row):
  // a post-destroy() callback that reschedules itself before checking
  // disposal would requeue a new callback forever even though it correctly
  // leaves pixels alone.
  function scheduledLoop() {
    if (disposed) {
      loopRunning = false;
      return;
    }
    rafHandle = schedule(scheduledLoop);
    const ticks = pacer.advanceTo(now());
    if (ticks > 0) {
      for (let i = 0; i < ticks; i++) state = tickBattleFx(state);
      paintAndCaption();
    }
  }

  /**
   * sync() -- called from the host Forge's own render(), after that
   * render's own field rebuild. `forceReplay` is internal only (the public
   * return object below does not expose it); the Replay button's own click
   * handler is the only caller that passes it.
   */
  function sync({ forceReplay = false } = {}) {
    const project = getProject();
    const id = getAnimationId();

    // Branch 1: unplayable (null id, or isPlayableBattleAnimation false).
    if (id === null || id === undefined || !isPlayableBattleAnimation(id, project)) {
      state = null;
      armedId = null;
      armedSignature = null;
      fixedCaption = describeUnplayableCaption(id, project);
      currentBounds = BLANK_BOUNDS;
      currentZoom = fitZoom(previewStage, currentBounds.width, currentBounds.height, { min: 1 });
      paintAndCaption();
      return;
    }

    const animation = project.sprites.animations[id];

    // Branch 2: empty (playable, but frames.length === 0) -- distinct from
    // branch 1, checked before branch 3, never falls through to armBattleFx.
    if (animation.frames.length === 0) {
      state = null;
      armedId = null;
      armedSignature = null;
      fixedCaption = 'This animation has no frames.';
      currentBounds = BLANK_BOUNDS;
      currentZoom = fitZoom(previewStage, currentBounds.width, currentBounds.height, { min: 1 });
      paintAndCaption();
      return;
    }

    // Branch 3: playable and non-empty. Four sub-steps, strictly in order.
    // (i) Read + validate, compute the signature, and fresh art/room/bounds/zoom.
    const mapper = resolveMapper(project.cartridge.mapper);
    const signature = frameSignature(animation);
    const metasprites = project.sprites.metasprites;
    const tileset = tilesetAt(project, project.rpg.battleTilesetId);
    const decodedTiles = tileset.sprites.tiles.map(tileFromString);
    const spritePalettes = project.palettes.sprite;
    const room = battleFxOamRoom(project, mapper);
    const bounds = battleFxBounds(animation, metasprites);
    const zoom = fitZoom(previewStage, bounds.width, bounds.height, { min: 1 });

    currentMetasprites = metasprites;
    currentDecodedTiles = decodedTiles;
    currentSpritePalettes = spritePalettes;
    currentRoom = room;
    currentBounds = bounds;
    currentZoom = zoom;
    fixedCaption = null;

    // (ii) Reconcile/re-arm state, using only the signature/id above.
    const reArm = forceReplay || id !== armedId || signature !== armedSignature;
    if (reArm) {
      state = armBattleFx(animation);
      armedId = id;
      armedSignature = signature;
    }

    // (iii) Paint exactly once.
    paintAndCaption();

    // (iv) Only on a real re-arm: reset and re-establish the pacer's own
    // time origin, then ensure the single self-rescheduling loop is running.
    if (reArm) {
      pacer.reset();
      pacer.advanceTo(now());
      ensureLoopRunning();
    }
  }

  /** One synchronous tick plus a repaint, bypassing the pacer entirely (§15.4). */
  function stepPreview() {
    state = tickBattleFx(state);
    paintAndCaption();
  }

  function destroy() {
    disposed = true;
    stopWatchingStage();
    if (usingRealScheduler && rafHandle !== null) cancelAnimationFrame(rafHandle);
  }

  const stopWatchingStage = observeSize(previewStage, () => {
    currentZoom = fitZoom(previewStage, currentBounds.width, currentBounds.height, { min: 1 });
    paintAndCaption();
  });

  // Paint the initial idle state once at construction, so the canvas is
  // never left uninitialized before the host Forge's first sync() call.
  paintAndCaption();

  return { sync, stepPreview, destroy };
}
