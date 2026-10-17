// The Map Forge's World view, the DOM half: one scroll box holding a surface the size of the whole world, and two canvases
// (the pictures, and the markers and frames over them) that are only as large as a *window* of it. The decisions -- where
// every block sits, which cell a point is over, which window a view needs, what makes a drawn block stale -- are the pure
// modules `worldlayout.js` and `worldmarkers.js`; this file draws and listens (docs/design-world-overview.md, sections 4-5).
//
// Local boundary (docs/reference-electron-layout.md, "The World view"): this view is read-only and synchronous. It is handed
// the project by a function and the one thing it may do to the Forge, `openFromWorld`, by the Forge; it never holds the
// project state itself, so a gesture on it cannot write to the project. Nothing in it waits: every handler runs to the end
// in one task, and `flushWorld` is the one function that sizes, positions, clears or paints either canvas.

import { el, fill } from '../../ui.js';
import { LIMITS } from '../../../shared/project.js';
import { MetatileRenderer } from './render.js';
import { cellLabel, cellState, changedCells } from './overview.js';
import {
  WORLD_HEADER,
  layoutWorld,
  chooseWorldScale,
  worldCellRect,
  worldHit,
  worldMarkerRect,
  markerAt,
  worldScrollTarget,
  worldResizeTarget,
  blockLabel,
  worldWindow,
  intersectsWindow,
  worldLayoutKey,
  worldBlockKey,
  worldHeaderKey,
  createTilesetPool
} from './worldlayout.js';
import { buildWorldMarkers } from './worldmarkers.js';

const START_COLOR = '#ff9d3c';
const TITLE_COLOR = '#6fd0ff';
const HALO = 'rgba(8, 10, 16, 0.85)';

/**
 * Make a World view. `getProject()` answers the project to show, `getCurrent()` the `{ mapIndex, screenIndex }` the Forge
 * is on, and `openFromWorld({ mapIndex, screenIndex })` is what a click means. Returns the box to put in the stage and the
 * calls that drive it; the Forge owns when to show it.
 */
export function createWorldView({ getProject, getCurrent, openFromWorld }) {
  const pool = createTilesetPool(() => new MetatileRenderer());
  const world = {
    box: null,
    scaleChoice: 'fit',
    project: null,
    layout: null,
    layoutKey: '',
    markers: null,
    win: null,
    paintAll: true,
    blocks: [],
    blocksSignature: '',
    pointer: null,
    hover: null,
    colors: null,
    shown: '',
    view: { width: 0, height: 0 },
    flushes: 0,
    moves: 0,
    redrawn: 0,
    headersRedrawn: 0,
    drawnTotal: 0,
    headersTotal: 0
  };

  const fixed = { position: 'absolute', pointerEvents: 'none' };
  const picture = el('canvas', { dataset: { worldPicture: '' }, style: { ...fixed, left: '0', top: '0', imageRendering: 'pixelated' } });
  const overlay = el('canvas', { dataset: { worldOverlay: '' }, style: { ...fixed, left: '0', top: '0' } });
  const blocksNode = el('div', { dataset: { worldBlocks: '' }, style: { ...fixed, inset: '0' } });
  const surface = el(
    'div.world-surface',
    {
      dataset: { worldSurface: '' },
      onpointermove: (event) => {
        world.pointer = { clientX: event.clientX, clientY: event.clientY };
        flushWorld('hover');
      },
      onpointerleave: () => {
        world.pointer = null;
        flushWorld('hover');
      },
      onclick: (event) => {
        if (!world.layout) return;
        const at = surfacePoint(event.clientX, event.clientY);
        const target = pick(at.x, at.y);
        if (target) openFromWorld(destination(target));
      }
    },
    picture,
    overlay,
    blocksNode
  );
  const box = el('div.world-box', { dataset: { worldBox: '' } }, surface);
  world.box = box;
  const pictureContext = picture.getContext('2d');
  const overlayContext = overlay.getContext('2d');

  const onScroll = (event) => {
    if (world.box !== event.currentTarget) return; // a scroll event the browser queued before this view was left
    flushWorld('scroll');
  };
  box.addEventListener('scroll', onScroll);

  // ------------------------------------------------------------------------------------------ coordinates and picking

  /** A client pixel as full-world pixels: the surface's own rectangle already includes the box's scroll offset. */
  function surfacePoint(clientX, clientY) {
    const rect = surface.getBoundingClientRect();
    return { x: Math.floor(clientX - rect.left), y: Math.floor(clientY - rect.top) };
  }

  /** What a full-world pixel is over: a marker first, then a cell or a header, else null. */
  function pick(x, y) {
    const marker = markerAt(world.layout, world.markers.markers, x, y);
    if (marker) return { kind: 'marker', marker, mapIndex: marker.mapIndex, screenIndex: marker.screenIndex };
    const hit = worldHit(world.layout, x, y);
    if (!hit) return null;
    return hit.header ? { kind: 'header', mapIndex: hit.mapIndex } : { kind: 'cell', mapIndex: hit.mapIndex, screenIndex: hit.screenIndex };
  }

  /** What a click on a target opens: a header opens its map's first screen, everything else its own screen. */
  const destination = (target) => ({ mapIndex: target.mapIndex, screenIndex: target.kind === 'header' ? 0 : target.screenIndex });

  /** The tooltip for a target, from the project as last drawn. */
  function describe(target) {
    const project = world.project;
    const map = project.maps[target.mapIndex];
    if (target.kind === 'header') return `${blockLabel(map, target.mapIndex)} — click to open its first screen`;
    const screen = map.screens[target.screenIndex];
    const here = world.markers.byScreen.get(flatIndex(target.mapIndex, target.screenIndex))?.markers ?? [];
    const where = `${map.name} · ${cellLabel(map.gridW, target.screenIndex, screen?.name)}`;
    if (target.kind === 'marker') return `${target.marker.title} — ${where} (click to open)`;
    const notes = here.map((m) => (m.kind === 'start' ? 'Start' : 'Title screen'));
    return [where, ...notes].join(' · ') + ' — click to open';
  }

  function flatIndex(mapIndex, screenIndex) {
    let flat = screenIndex;
    for (let i = 0; i < mapIndex; i++) flat += world.project.maps[i].screens.length;
    return flat;
  }

  const hoverName = (target) =>
    !target ? '' : target.kind === 'marker' ? `marker:${target.marker.kind}` : target.kind === 'header' ? `header:${target.mapIndex}` : `${target.mapIndex}:${target.screenIndex}`;

  // ------------------------------------------------------------------------------------------------------- painting

  function palette() {
    const style = getComputedStyle(box);
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    return { header: read('--bg-3', '#252a38'), text: read('--text', '#e6e9f0'), line: read('--line', '#2c3242'), accent: read('--accent', '#ff9d3c') };
  }

  function truncate(context, text, width) {
    if (context.measureText(text).width <= width) return text;
    let cut = text.length;
    while (cut > 1 && context.measureText(`${text.slice(0, cut)}…`).width > width) cut--;
    return `${text.slice(0, cut)}…`;
  }

  function paintHeader(block, label, colors) {
    const context = pictureContext;
    context.clearRect(block.x, block.y, block.w, WORLD_HEADER);
    context.fillStyle = colors.header;
    context.fillRect(block.x, block.y, block.w, WORLD_HEADER);
    context.fillStyle = colors.line;
    context.fillRect(block.x, block.y + WORLD_HEADER - 1, block.w, 1);
    context.fillStyle = colors.text;
    context.font = '11px system-ui, sans-serif';
    context.textBaseline = 'middle';
    context.fillText(truncate(context, label, block.w - 8), block.x + 4, block.y + WORLD_HEADER / 2);
  }

  function paintCell(block, index, screen, tileset) {
    const context = pictureContext;
    const local = cellRectOf(block, index);
    const gap = block.grid.gap;
    context.clearRect(local.x - gap, local.y - gap, local.w + 2 * gap, local.h + 2 * gap);
    // a screen at one pixel per metatile is an average, not a sample
    context.imageSmoothingEnabled = block.grid.scale === 1;
    context.imageSmoothingQuality = 'high';
    for (let row = 0; row < LIMITS.screenRows; row++) {
      for (let col = 0; col < LIMITS.screenCols; col++) {
        tileset.renderer.draw(context, screen.metatiles[row * LIMITS.screenCols + col], local.x + col * block.grid.scale, local.y + row * block.grid.scale, block.grid.scale);
      }
    }
  }

  const cellRectOf = (block, index) => worldCellRect(world.layout, block.mapIndex, index);

  /** Paint a whole block's cells that the window holds, recording what was drawn; returns the number of cells painted. */
  function paintBlockCells(block, map, entry, tileset, indices) {
    let drawn = 0;
    for (const index of indices) {
      if (!intersectsWindow(world.win, cellRectOf(block, index))) continue;
      paintCell(block, index, map.screens[index], tileset);
      entry.drawn[index] = cellState(map.screens[index], false, false);
      drawn++;
    }
    return drawn;
  }

  const allIndices = (map) => Array.from({ length: map.screens.length }, (_, i) => i);

  function paintPicture(full, colors) {
    const { layout, project } = world;
    const win = world.win;
    let cells = 0;
    let headers = 0;
    layout.blocks.forEach((block) => {
      const map = project.maps[block.mapIndex];
      const tileset = pool.get(map.tilesetId ?? 0);
      const entry = world.blocks[block.mapIndex];
      const label = blockLabel(map, block.mapIndex);
      const blockKey = worldBlockKey(block, layout.scale, tileset);
      const headerKey = worldHeaderKey(block, layout.scale, label);
      const blockRect = { x: block.x, y: block.y, w: block.w, h: block.h };
      const near = intersectsWindow(win, blockRect);
      if (full || blockKey !== entry.blockKey) {
        // redrawn whole: the canvases no longer hold what the snapshots describe (a moved window), or the block is not what it was
        entry.drawn = [];
        if (near) {
          if (!full) pictureContext.clearRect(block.x, block.y, block.w, block.h);
          paintHeader(block, label, colors);
          headers++;
          cells += paintBlockCells(block, map, entry, tileset, allIndices(map));
        }
      } else {
        if (headerKey !== entry.headerKey && intersectsWindow(win, { x: block.x, y: block.y, w: block.w, h: WORLD_HEADER })) {
          paintHeader(block, label, colors);
          headers++;
        }
        if (near) {
          const stale = changedCells(entry.drawn, map.screens, -1, -1);
          cells += paintBlockCells(block, map, entry, tileset, stale);
        }
      }
      entry.blockKey = blockKey;
      entry.headerKey = headerKey;
    });
    return { cells, headers };
  }

  function paintOverlay(colors) {
    const context = overlayContext;
    const { layout } = world;
    const win = world.win;
    context.clearRect(win.x, win.y, win.w, win.h);
    // markers: the title under the start when they share a corner
    for (const entry of [...world.markers.markers].reverse()) {
      const rect = worldMarkerRect(layout, entry);
      if (!rect || !intersectsWindow(win, rect)) continue;
      context.beginPath();
      context.fillStyle = entry.kind === 'start' ? START_COLOR : TITLE_COLOR;
      context.strokeStyle = HALO;
      context.lineWidth = 2;
      if (entry.kind === 'start') context.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 2 - 1, 0, Math.PI * 2);
      else context.rect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
      context.stroke();
      context.fill();
    }
    // the current screen's frame lives in the gap round its cell
    const current = getCurrent();
    const cell = worldCellRect(layout, current.mapIndex, current.screenIndex);
    if (cell && intersectsWindow(win, { x: cell.x - 2, y: cell.y - 2, w: cell.w + 4, h: cell.h + 4 })) {
      context.strokeStyle = colors.accent;
      context.lineWidth = 2;
      context.strokeRect(cell.x - 1, cell.y - 1, cell.w + 2, cell.h + 2);
    }
    // the hover frame
    const hover = world.hover;
    if (hover) {
      let rect = null;
      if (hover.kind === 'marker') rect = worldMarkerRect(layout, hover.marker);
      else if (hover.kind === 'cell') rect = worldCellRect(layout, hover.mapIndex, hover.screenIndex);
      else {
        const block = layout.blocks[hover.mapIndex];
        rect = { x: block.x, y: block.y, w: block.w, h: WORLD_HEADER };
      }
      if (rect) {
        context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        context.lineWidth = 1;
        context.strokeRect(rect.x - 0.5, rect.y - 0.5, rect.w + 1, rect.h + 1);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------- flush

  /**
   * The one function that sizes, positions, clears or paints either canvas. It takes no scroll offset and no layout: it
   * reads `world.*` and the box's own size and offsets when it runs, so it is always the latest state, and it runs to the
   * end in one task -- both canvases move together and are painted before it returns.
   *
   * `reason` is 'render' (a project change, scale, resize), 'scroll', or 'hover' (the overlay only: the view did not move).
   */
  function flushWorld(reason = 'render') {
    if (world.box === null || !world.layout) return;
    const hoverOnly = reason === 'hover';
    const resolve = () => {
      const at = world.pointer ? surfacePoint(world.pointer.clientX, world.pointer.clientY) : null;
      world.hover = at ? pick(at.x, at.y) : null;
      surface.title = world.hover ? describe(world.hover) : '';
      surface.dataset.worldHover = hoverName(world.hover);
    };
    world.flushes++;
    let cells = 0;
    let headers = 0;
    // the theme can change between renders but not between pointer moves: read it once per render
    const colors = hoverOnly && world.colors ? world.colors : (world.colors = palette());
    if (!hoverOnly) {
      const view = { left: box.scrollLeft, top: box.scrollTop, width: box.clientWidth, height: box.clientHeight };
      const win = worldWindow(world.layout, view, world.win);
      const moved = win !== world.win;
      const key = worldLayoutKey(world.layout);
      const full = moved || key !== world.layoutKey || world.paintAll;
      if (full) {
        // width/height clear a canvas; both go to the window together, so neither shows blank, old or half-painted content
        if (moved) world.moves++;
        world.win = win;
        picture.width = overlay.width = win.w;
        picture.height = overlay.height = win.h;
        picture.style.left = overlay.style.left = `${win.x}px`;
        picture.style.top = overlay.style.top = `${win.y}px`;
        pictureContext.setTransform(1, 0, 0, 1, -win.x, -win.y);
        overlayContext.setTransform(1, 0, 0, 1, -win.x, -win.y);
        world.paintAll = false;
        world.layoutKey = key;
      }
      const painted = paintPicture(full, colors);
      cells = painted.cells;
      headers = painted.headers;
    }
    resolve();
    paintOverlay(colors);
    world.drawnTotal += cells;
    world.headersTotal += headers;
    if (reason === 'render') {
      world.redrawn = cells;
      world.headersRedrawn = headers;
    }
    publish();
  }

  function publish() {
    const data = surface.dataset;
    const { layout, win } = world;
    const current = getCurrent();
    data.worldScale = String(layout.scale);
    data.worldExtent = `${layout.width}x${layout.height}`;
    data.worldWindow = `${win.x},${win.y},${win.w},${win.h}`;
    data.worldMoves = String(world.moves);
    data.worldFlushes = String(world.flushes);
    data.worldRedrawn = String(world.redrawn);
    data.worldHeadersRedrawn = String(world.headersRedrawn);
    data.worldDrawnTotal = String(world.drawnTotal);
    data.worldHeadersTotal = String(world.headersTotal);
    data.worldCurrent = `${current.mapIndex}:${current.screenIndex}`;
    data.worldScaleChoice = String(world.scaleChoice);
  }

  // ------------------------------------------------------------------------------------------------------ rendering

  /** The block placeholders: invisible, pointer-transparent boxes that carry each block's geometry for a reader of the DOM. */
  function renderBlocks(layout) {
    const signature = JSON.stringify(layout.blocks.map((b) => [b.mapIndex, b.x, b.y, b.w, b.h, b.grid.gridW, b.grid.gridH, b.grid.scale]));
    if (signature === world.blocksSignature) return;
    world.blocksSignature = signature;
    fill(
      blocksNode,
      layout.blocks.map((b) =>
        el('div', {
          dataset: {
            worldBlock: '',
            map: b.mapIndex,
            x: b.x,
            y: b.y,
            w: b.w,
            h: b.h,
            gridX: b.gridX,
            gridY: b.gridY,
            gridW: b.grid.gridW,
            gridH: b.grid.gridH,
            cellW: b.grid.cellW,
            cellH: b.grid.cellH,
            gap: b.grid.gap,
            pad: b.grid.pad,
            header: WORLD_HEADER
          },
          style: { position: 'absolute', left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`, pointerEvents: 'none' }
        })
      )
    );
  }

  /**
   * Lay the world out in the room the box has now, replace the markers, keep the tileset pool current, scroll the current
   * screen into view when it, the scale or the view changed (never because a project change merely repainted), and flush.
   */
  function render() {
    if (world.box === null) return;
    const project = getProject();
    const current = getCurrent();
    world.project = project;
    // what the box showed before this render, decided before the layout or the surface changes: the old layout, at the old size
    const previous = world.layout ? { layout: world.layout, view: { left: box.scrollLeft, top: box.scrollTop, width: world.view.width, height: world.view.height } } : null;
    const size = { width: box.clientWidth, height: box.clientHeight };
    const maps = project.maps.map((map) => ({ gridW: map.gridW, gridH: map.gridH }));
    const scale = world.scaleChoice === 'fit' ? chooseWorldScale(maps, size) : world.scaleChoice;
    const layout = layoutWorld(maps, size, scale);
    world.layout = layout;
    world.markers = buildWorldMarkers(project);
    pool.sync(project, project.maps.map((map) => map.tilesetId ?? 0));
    while (world.blocks.length < layout.blocks.length) world.blocks.push({ blockKey: '', headerKey: '', drawn: [] });
    world.blocks.length = layout.blocks.length;
    // The stable gutter takes its width out of clientWidth but not out of the range the browser lets the box scroll: with the
    // surface exactly the world wide, the last gutter-wide strip of the world could never be scrolled to. The surface is
    // that much wider (blank, and hit-tested as nothing), so the box can scroll to the world's far edge.
    const gutter = Math.max(0, box.offsetWidth - box.clientWidth - 2 * box.clientLeft);
    surface.style.width = `${layout.width + gutter}px`;
    surface.style.height = `${layout.height}px`;
    renderBlocks(layout);

    // The current cell was whole in the old room (old layout, old size, old offsets) and a resize or the wrap it caused took
    // it out: keep it in view. A cell the author had scrolled away from stays where it is -- a resize is not a reason to
    // snatch the box back -- and so does a plain repaint.
    const resized = size.width !== world.view.width || size.height !== world.view.height;
    const toView = { left: box.scrollLeft, top: box.scrollTop, width: box.clientWidth, height: box.clientHeight };
    const keep = resized ? worldResizeTarget(previous, layout, current.mapIndex, current.screenIndex, toView) : null;
    world.view = size;
    const shown = `${scale}:${current.mapIndex}:${current.screenIndex}`;
    if ((shown !== world.shown || keep) && size.width > 0) {
      world.shown = shown;
      const target = keep ?? worldScrollTarget(layout, current.mapIndex, current.screenIndex, toView);
      box.scrollLeft = target.left;
      box.scrollTop = target.top;
    }
    flushWorld('render');
  }

  return {
    box,
    /** Choose the scale: 'fit' or 1..4. A choice overrides Fit until changed. */
    setScale(choice) {
      world.scaleChoice = choice;
    },
    scaleChoice: () => world.scaleChoice,
    render,
    /** Drop the window and every snapshot: the next flush paints the whole window afresh. */
    reset() {
      world.win = null;
      world.paintAll = true;
      world.blocks = [];
      world.shown = '';
      world.view = { width: 0, height: 0 };
    },
    /** Remove the listener, drop the window and every snapshot, and discard the box with its canvases. */
    destroy() {
      box.removeEventListener('scroll', onScroll);
      world.box = null;
      world.win = null;
      world.layout = null;
      world.markers = null;
      world.project = null;
      world.blocks = [];
      world.pointer = null;
      world.hover = null;
      picture.width = overlay.width = 0;
      box.remove();
    }
  };
}
