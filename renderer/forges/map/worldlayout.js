// The Map Forge's World view, the pure half: where every map's block sits in the one picture of the whole project, which
// screen (or header, or marker) a point is over, which pixels of it a canvas must hold, and what makes a drawn block stale.
//
// Pure and DOM-free; imports shared/ and the per-map overview's own arithmetic (`overview.js`) only. It decides --
// world.js draws and listens (docs/design-world-overview.md, sections 2 and 5):
//   * the packing of maps into blocks (`layoutWorld`), and the scale that fits them (`chooseWorldScale`);
//   * which cell a point is over and where a cell is drawn (`worldHit`, `worldCellRect`: exact inverses), and which marker (`worldMarkerRect`, `markerAt`);
//   * the rectangle of the world a pair of canvases holds (`worldWindow`, `windowRetains`) -- in full-world pixels, always;
//   * the keys that say a drawn block or header is stale (`worldBlockKey`, `worldHeaderKey`, `worldLayoutKey`);
//   * the pool of one renderer per tileset (`createTilesetPool`), whose `serial` makes a block key honest.
//
// A block is a header strip of WORLD_HEADER pixels over the map's own grid, laid out by `gridLayoutAt` (overview.js), so a
// cell inside a block is `cellRect` / `cellAt` of that grid shifted by the block's origin, never a second copy of the sum.

import { OVERVIEW_MAX_SCALE, gridLayoutAt, cellRect, cellAt, scrollTargetFor, inViewFor } from './overview.js';

/** The strip of text above each block's grid. */
export const WORLD_HEADER = 14;
/** A block is never narrower than this, so a 1 x 1 map's header can carry a name. */
export const WORLD_MIN_BLOCK_W = 96;
/** The space between blocks, in both directions. */
export const WORLD_BLOCK_GAP = 14;
/** The margin round the whole world. */
export const WORLD_PAD = 8;
/** The scale Fit falls back to when no scale in 1..OVERVIEW_MAX_SCALE shows the whole world: a 1x cell is 16 x 15 px, too small for a marker. */
export const WORLD_FALLBACK_SCALE = 2;
/** The picture canvases hold the viewport grown by this on every side, clipped to the world. */
export const WORLD_WINDOW_MARGIN = 256;
/** The viewport may come within this of an uncovered window edge before the window moves. */
export const WORLD_WINDOW_SLACK = 64;

/** The scales the toolbar offers besides Fit. */
export const WORLD_SCALES = Array.from({ length: OVERVIEW_MAX_SCALE }, (_, i) => i + 1);

/**
 * Pack the maps, in project order, left to right, wrapping into rows. `maps` is `[{ gridW, gridH }]`, `box` the scroll
 * box's client `{ width, height }`. A block wraps when it would pass `box.width - WORLD_PAD` and its row is not empty,
 * so a lone over-wide block takes its own row and the box scrolls; a row is as tall as its tallest block.
 */
export function layoutWorld(maps, box, scale) {
  const limit = box.width - WORLD_PAD;
  const blocks = [];
  let x = WORLD_PAD;
  let y = WORLD_PAD;
  let rowHeight = 0;
  let inRow = 0;
  let right = 0;
  maps.forEach((map, mapIndex) => {
    const grid = gridLayoutAt(map.gridW, map.gridH, scale);
    const w = Math.max(WORLD_MIN_BLOCK_W, grid.width);
    const h = WORLD_HEADER + grid.height;
    if (inRow > 0 && x + w > limit) {
      y += rowHeight + WORLD_BLOCK_GAP;
      x = WORLD_PAD;
      rowHeight = 0;
      inRow = 0;
    }
    blocks.push({ mapIndex, x, y, w, h, gridX: x, gridY: y + WORLD_HEADER, grid });
    right = Math.max(right, x + w);
    x += w + WORLD_BLOCK_GAP;
    rowHeight = Math.max(rowHeight, h);
    inRow++;
  });
  const width = blocks.length ? right + WORLD_PAD : 2 * WORLD_PAD;
  const height = blocks.length ? y + rowHeight + WORLD_PAD : 2 * WORLD_PAD;
  return { scale, blocks, width, height, scrollX: width > box.width, scrollY: height > box.height };
}

/** The largest scale 1..OVERVIEW_MAX_SCALE at which the whole world fits `box` with no scrolling; WORLD_FALLBACK_SCALE when none does. */
export function chooseWorldScale(maps, box) {
  for (let scale = OVERVIEW_MAX_SCALE; scale >= 1; scale--) {
    const layout = layoutWorld(maps, box, scale);
    if (!layout.scrollX && !layout.scrollY) return scale;
  }
  return WORLD_FALLBACK_SCALE;
}

/** Where screen `screenIndex` of map `mapIndex` is drawn, in full-world pixels; null for one the world does not have. */
export function worldCellRect(layout, mapIndex, screenIndex) {
  const block = layout.blocks[mapIndex];
  if (!block) return null;
  const rect = cellRect(block.grid, screenIndex);
  if (!rect) return null;
  return { x: block.gridX + rect.x, y: block.gridY + rect.y, w: rect.w, h: rect.h };
}

/**
 * What is under a point in full-world pixels: `{ mapIndex, screenIndex }` for a cell, `{ mapIndex, header: true }` for a
 * block's header strip, null for the margin, a gap, the padding round a grid and anything outside. The exact inverse of
 * `worldCellRect`: a point inside it answers that cell, and nowhere else does.
 */
export function worldHit(layout, x, y) {
  for (const block of layout.blocks) {
    if (x < block.x || x >= block.x + block.w || y < block.y || y >= block.y + block.h) continue;
    if (y < block.gridY) return { mapIndex: block.mapIndex, header: true };
    const screenIndex = cellAt(block.grid, x - block.gridX, y - block.gridY);
    return screenIndex === null ? null : { mapIndex: block.mapIndex, screenIndex };
  }
  return null;
}

/** A marker's side in pixels at `scale`: large enough to point at, small enough to leave the picture under it readable. */
export const worldMarkerSize = (scale) => 5 + 2 * scale;

/**
 * Where a marker (`{ mapIndex, screenIndex, x, y }`, its pixel inside the 256 x 240 screen) is drawn, in full-world pixels:
 * centred on the pixel of the 16 x 16 thing it marks, and kept inside its cell. Null for a screen the world does not have.
 */
export function worldMarkerRect(layout, marker) {
  const cell = worldCellRect(layout, marker.mapIndex, marker.screenIndex);
  if (!cell) return null;
  const size = Math.min(worldMarkerSize(layout.scale), cell.w, cell.h);
  const scaled = (pixel) => ((pixel + 8) * layout.scale) / 16;
  const place = (centre, origin, extent) => origin + Math.max(0, Math.min(extent - size, Math.round(centre - size / 2)));
  return { x: place(scaled(marker.x), cell.x, cell.w), y: place(scaled(marker.y), cell.y, cell.h), w: size, h: size };
}

/** The first marker in `markers` (priority order) whose rectangle holds the point, or null. */
export function markerAt(layout, markers, x, y) {
  for (const marker of markers) {
    const rect = worldMarkerRect(layout, marker);
    if (rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) return marker;
  }
  return null;
}

/** Where the box must scroll so the cell is whole in `view` (`{ left, top, width, height }`): `scrollTarget`'s rule across the whole world. */
export function worldScrollTarget(layout, mapIndex, screenIndex, view) {
  const rect = worldCellRect(layout, mapIndex, screenIndex);
  const gap = layout.blocks[mapIndex]?.grid.gap ?? 0;
  return scrollTargetFor(rect, gap, { width: layout.width, height: layout.height }, view);
}

/** Whether the cell, with the gap round it, is whole in `view`: the test `worldScrollTarget` leaves a box alone by. */
export function worldInView(layout, mapIndex, screenIndex, view) {
  return inViewFor(worldCellRect(layout, mapIndex, screenIndex), layout.blocks[mapIndex]?.grid.gap ?? 0, view);
}

/**
 * Where the box must scroll after a re-layout so the current cell is whole again, or null to leave it alone. `prev` is the
 * layout and view the box showed *before* the change (`{ layout, view }`, null when it showed nothing): the cell is kept in
 * view only if it was whole there. Asking the new layout about the old view's size answers a different question -- a wrap
 * can move the cell out of a viewport it was in without changing the scale or the current screen -- and a cell the author
 * had scrolled away from stays where it is.
 */
export function worldResizeTarget(prev, layout, mapIndex, screenIndex, view) {
  if (!prev || !(prev.view.width > 0) || !worldInView(prev.layout, mapIndex, screenIndex, prev.view)) return null;
  return worldScrollTarget(layout, mapIndex, screenIndex, view);
}

/** A block's header: `[folder] Name · 2×2`, ` · streamed` for a streamed map. The DOM side truncates it to the block's width. */
export function blockLabel(map, mapIndex) {
  const name = map.name?.trim() || `Map ${mapIndex}`;
  const folder = map.folder ? `[${map.folder}] ` : '';
  return `${folder}${name} · ${map.gridW}×${map.gridH}${map.streamed === true ? ' · streamed' : ''}`;
}

// -------------------------------------------------------------------------------------------------------- the window

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** The view, kept inside the extent: the offsets the browser itself would clamp to. */
function clampedView(layout, view) {
  return {
    left: clamp(view.left, 0, Math.max(0, layout.width - view.width)),
    top: clamp(view.top, 0, Math.max(0, layout.height - view.height)),
    width: view.width,
    height: view.height
  };
}

/** The viewport grown by `by` on every side, clipped to the extent, as `{ x0, y0, x1, y1 }`. */
function grown(layout, view, by) {
  const v = clampedView(layout, view);
  return {
    x0: Math.max(0, v.left - by),
    y0: Math.max(0, v.top - by),
    x1: Math.min(layout.width, v.left + v.width + by),
    y1: Math.min(layout.height, v.top + v.height + by)
  };
}

/**
 * Whether `win` (`{ x, y, w, h }`, integers in full-world pixels) still serves `view`: it is no wider or taller than the
 * viewport grown by WORLD_WINDOW_MARGIN on both sides (so a window left over from a larger viewport is not kept), it lies
 * inside the extent, and the viewport grown by WORLD_WINDOW_SLACK, clipped to the extent, lies inside it. Clipping makes the
 * zone inclusive at the world's edge, so a window clipped to an edge never asks for coverage beyond the extent and does not
 * thrash there. It sees four coordinates, the viewport's size and the extent, never where `win` came from.
 */
export function windowRetains(win, layout, view) {
  if (!win) return false;
  if (win.x < 0 || win.y < 0 || win.x + win.w > layout.width || win.y + win.h > layout.height) return false;
  if (win.w > view.width + 2 * WORLD_WINDOW_MARGIN || win.h > view.height + 2 * WORLD_WINDOW_MARGIN) return false;
  const zone = grown(layout, view, WORLD_WINDOW_SLACK);
  return win.x <= zone.x0 && win.y <= zone.y0 && win.x + win.w >= zone.x1 && win.y + win.h >= zone.y1;
}

/**
 * The window a pair of canvases should hold: `prev` itself (the same object) while it is retained, else the viewport grown
 * by WORLD_WINDOW_MARGIN, clipped to the extent. A moved window depends on the layout and the view only, never on history.
 */
export function worldWindow(layout, view, prev) {
  if (prev && windowRetains(prev, layout, view)) return prev;
  const ideal = grown(layout, view, WORLD_WINDOW_MARGIN);
  return { x: ideal.x0, y: ideal.y0, w: ideal.x1 - ideal.x0, h: ideal.y1 - ideal.y0 };
}

/** Whether the rectangle `{ x, y, w, h }` shares a pixel with the window. */
export const intersectsWindow = (win, rect) =>
  rect.x < win.x + win.w && rect.x + rect.w > win.x && rect.y < win.y + win.h && rect.y + rect.h > win.y;

// ----------------------------------------------------------------------------------------------------------- the keys

/** What the geometry of a layout is: the extent, the scale and every block's `[mapIndex, x, y, w, h]`. A change repaints everything. */
export const worldLayoutKey = (layout) =>
  JSON.stringify([layout.width, layout.height, layout.scale, layout.blocks.map((b) => [b.mapIndex, b.x, b.y, b.w, b.h])]);

/**
 * What a drawn block's pictures depend on besides its screens' tiles (which `changedCells` compares exactly): where it is,
 * the scale, the grid, and the tileset's renderer -- `tilesetId`, its never-reused `serial`, and its art `version`.
 */
export const worldBlockKey = (block, scale, tileset) =>
  JSON.stringify([block.mapIndex, block.x, block.y, scale, block.grid.gridW, block.grid.gridH, tileset.tilesetId, tileset.serial, tileset.version]);

/** What a drawn header depends on: where it is, its width, the scale and its text. */
export const worldHeaderKey = (block, scale, label) => JSON.stringify([block.x, block.y, block.w, scale, label]);

// ------------------------------------------------------------------------------------------------ the tileset pool

/**
 * One renderer per tileset in use. `serial` is a counter that is never reused -- `renderer.version` belongs to an
 * instance, not to a map's assignment, so a dropped and recreated renderer would otherwise repeat a version a block was
 * drawn at. `makeRenderer()` supplies an object with `rebuild(project, tilesetId)` and a `version`.
 */
export function createTilesetPool(makeRenderer) {
  let nextSerial = 1;
  const entries = new Map();
  return {
    /** Rebuild every renderer in `tilesetIds` for `project`; drop the ones no longer used. */
    sync(project, tilesetIds) {
      const used = new Set(tilesetIds);
      for (const id of [...entries.keys()]) if (!used.has(id)) entries.delete(id);
      for (const id of used) {
        let entry = entries.get(id);
        if (!entry) {
          entry = { tilesetId: id, renderer: makeRenderer(), serial: nextSerial++ };
          entries.set(id, entry);
        }
        entry.renderer.rebuild(project, id);
      }
    },
    /** `{ tilesetId, renderer, serial, version }` for a tileset in use, else null. */
    get(id) {
      const entry = entries.get(id);
      return entry ? { tilesetId: id, renderer: entry.renderer, serial: entry.serial, version: entry.renderer.version } : null;
    },
    get size() {
      return entries.size;
    }
  };
}
