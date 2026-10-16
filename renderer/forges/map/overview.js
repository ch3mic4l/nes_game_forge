// The Map Forge's world overview: the layout, hit-test and scroll rules for a map too big for the legacy
// 64 x 60 thumbnails (a streamed map, or any grid larger than an ordinary map's 4 x 4).
//
// Pure and DOM-free; imports shared/ only. It decides -- map.js draws and listens:
//   * which navigator a map gets (`usesOverview`, the single predicate);
//   * the room the overview may take, and the cell size and extent inside it (`overviewBox`, `layoutOverview`);
//   * which screen a point is over, and where a screen is drawn (`cellAt`, `cellRect`: exact inverses);
//   * where to scroll so the current screen is in view (`scrollTarget`);
//   * which cells an edit made stale (`changedCells`), so an edit redraws what it touched and no more.
//
// A screen's flat index is `row * gridW + col`, the order `map.screens` is stored in and every other part of the
// Forge addresses a screen by.

import { LIMITS, mapGridLimit } from '../../../shared/project.js';

/** The gap between cells, and the margin round the grid: the current screen's 2 px frame is drawn in them. */
export const OVERVIEW_GAP = 2;
export const OVERVIEW_PAD = 2;
/** Pixels per metatile. 4 is the legacy thumbnail (64 x 60); a cell is `screenCols * scale` by `screenRows * scale`. */
export const OVERVIEW_MAX_SCALE = 4;
/** The overview box's own height bounds: it takes what the screen above it leaves, never less than a few rows. */
export const OVERVIEW_MIN_BOX_HEIGHT = 96;
export const OVERVIEW_MAX_BOX_HEIGHT = 264;

/**
 * Which navigator a map gets, and the only place that is decided: the overview for a streamed map and for any grid
 * larger than an ordinary map's limit; the legacy 64 x 60 thumbnails for an ordinary map of 4 x 4 or fewer (thirteen
 * smoke selectors find them by that size). Per axis, like the limit itself.
 */
export function usesOverview(map) {
  const ordinary = mapGridLimit({});
  return map.streamed === true || map.gridW > ordinary || map.gridH > ordinary;
}

/**
 * The most room the overview may take inside a stage of `stage` pixels: all of its width, and the height the screen
 * (`screenHeight`, at its smallest zoom) and the gap above the overview leave. Bounded either way, so the screen never
 * gives up room in proportion to how many screens the map has.
 */
export function overviewBox(stage, { screenHeight, gap }) {
  const room = Math.floor(stage.height) - screenHeight - gap;
  return {
    width: Math.max(0, Math.floor(stage.width)),
    height: Math.max(OVERVIEW_MIN_BOX_HEIGHT, Math.min(OVERVIEW_MAX_BOX_HEIGHT, room))
  };
}

const extentAt = (cells, perCell, scale) => 2 * OVERVIEW_PAD + cells * perCell * scale + (cells - 1) * OVERVIEW_GAP;

/**
 * The cell size and the laid-out extent of a `gridW` x `gridH` map inside a box of `box` pixels.
 *
 * The largest scale (1..OVERVIEW_MAX_SCALE) at which the whole grid fits wins, so a 4 x 4 map and a 16 x 15 one are
 * both seen whole when the room allows. A world that cannot fit even at scale 1 is drawn at scale 1 and scrolls: the
 * smallest cell shows the most of the world at once, and a screen's picture is a colour patch at any size this small.
 * The extent therefore exceeds the box only on an axis where `scrollX` / `scrollY` says the box scrolls -- the box is
 * its own `overflow: auto` container, so both ends of a scrolled axis are reachable.
 */
export function layoutOverview(gridW, gridH, box) {
  const widthAt = (scale) => extentAt(gridW, LIMITS.screenCols, scale);
  const heightAt = (scale) => extentAt(gridH, LIMITS.screenRows, scale);
  let scale = 1;
  for (let candidate = OVERVIEW_MAX_SCALE; candidate > 1; candidate--) {
    if (widthAt(candidate) <= box.width && heightAt(candidate) <= box.height) {
      scale = candidate;
      break;
    }
  }
  const width = widthAt(scale);
  const height = heightAt(scale);
  const cellW = LIMITS.screenCols * scale;
  const cellH = LIMITS.screenRows * scale;
  return {
    gridW,
    gridH,
    scale,
    cellW,
    cellH,
    gap: OVERVIEW_GAP,
    pad: OVERVIEW_PAD,
    width,
    height,
    scrollX: width > box.width,
    scrollY: height > box.height
  };
}

/** Where screen `index` is drawn, in the overview's own pixels; null for an index the map does not have. */
export function cellRect(layout, index) {
  if (!Number.isInteger(index) || index < 0 || index >= layout.gridW * layout.gridH) return null;
  const col = index % layout.gridW;
  const row = Math.floor(index / layout.gridW);
  return {
    x: layout.pad + col * (layout.cellW + layout.gap),
    y: layout.pad + row * (layout.cellH + layout.gap),
    w: layout.cellW,
    h: layout.cellH
  };
}

/**
 * The screen under a point in the overview's own pixels, or null for the margin, a gap between cells and anywhere
 * outside the grid. The exact inverse of `cellRect`: a point inside `cellRect(i)` answers `i`, and nowhere else does.
 */
export function cellAt(layout, x, y) {
  const localX = x - layout.pad;
  const localY = y - layout.pad;
  if (!(localX >= 0 && localY >= 0)) return null;
  const col = Math.floor(localX / (layout.cellW + layout.gap));
  const row = Math.floor(localY / (layout.cellH + layout.gap));
  if (col >= layout.gridW || row >= layout.gridH) return null;
  if (localX - col * (layout.cellW + layout.gap) >= layout.cellW) return null;
  if (localY - row * (layout.cellH + layout.gap) >= layout.cellH) return null;
  return row * layout.gridW + col;
}

const fitsAxis = (start, size, scroll, room) => start >= scroll && start + size <= scroll + room;

/**
 * Whether screen `index` (with the gap round it, where its frame is drawn) is whole in `view`, the box's `{ left, top,
 * width, height }`. The same test `scrollTarget` leaves a box alone by. A screen the map does not have is in view of
 * nothing.
 */
export function inView(layout, index, view) {
  const rect = cellRect(layout, index);
  if (!rect) return false;
  return (
    fitsAxis(rect.x - layout.gap, rect.w + 2 * layout.gap, view.left, view.width) &&
    fitsAxis(rect.y - layout.gap, rect.h + 2 * layout.gap, view.top, view.height)
  );
}

/**
 * Where the box must scroll so screen `index` is whole in view. `view` is the box's current `{ left, top, width, height }`
 * (its scroll offsets and its inner size). A screen already whole in view leaves the box alone, so selecting by
 * clicking never jerks it; one that is not is centred on each axis that needs it, clamped to the scrollable range.
 */
export function scrollTarget(layout, index, view) {
  const rect = cellRect(layout, index);
  if (!rect) return { left: view.left, top: view.top };
  const axis = (start, size, scroll, room, extent) => {
    if (fitsAxis(start, size, scroll, room)) return scroll;
    const centred = start + size / 2 - room / 2;
    return Math.max(0, Math.min(Math.max(0, extent - room), Math.round(centred)));
  };
  return {
    left: axis(rect.x - layout.gap, rect.w + 2 * layout.gap, view.left, view.width, layout.width),
    top: axis(rect.y - layout.gap, rect.h + 2 * layout.gap, view.top, view.height, layout.height)
  };
}

/** A screen's tooltip: its flat index, its name if it has one, and where it sits in the grid. */
export function cellLabel(gridW, index, name) {
  const where = `col ${index % gridW}, row ${Math.floor(index / gridW)}`;
  return name?.trim() ? `Screen ${index} — ${name.trim()} (${where})` : `Screen ${index} (${where})`;
}

/** What a drawn cell looked like: an exact copy of its metatiles, whether it carried the start marker, whether it was current. */
export const cellState = (screen, isStart, isCurrent) => ({
  tiles: Uint16Array.from(screen.metatiles),
  start: isStart,
  current: isCurrent
});

const sameCell = (drawn, screen, isStart, isCurrent) => {
  if (!drawn || drawn.start !== isStart || drawn.current !== isCurrent) return false;
  const tiles = screen.metatiles;
  if (drawn.tiles.length !== tiles.length) return false;
  for (let i = 0; i < tiles.length; i++) if (drawn.tiles[i] !== tiles[i]) return false;
  return true;
};

/**
 * The cells whose picture is stale: `drawn[i]` (a `cellState`, or nothing) no longer matches `screens[i]`, or the
 * start marker or the current-screen frame moved onto or off it. An edit to one screen answers one index; selecting
 * another screen answers two. Exact comparison, not a hash, so no edit can slip past.
 */
export function changedCells(drawn, screens, startIndex, currentIndex) {
  const stale = [];
  for (let i = 0; i < screens.length; i++) {
    if (!sameCell(drawn[i], screens[i], i === startIndex, i === currentIndex)) stale.push(i);
  }
  return stale;
}
