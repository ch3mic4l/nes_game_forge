// Map Forge world overview (item 15 phase 4, commit C2): the DOM-free layout, hit-test, scroll and redraw rules in
// renderer/forges/map/overview.js. map.js draws and listens; this pins what it decides.
//
//   U9   geometry and hit-test: (col, row) <-> flat index `row * gridW + col`, exact inverses, last column and row
//   U10  the extent fits the box or scrolls on a flagged axis; which navigator a map gets
//   U12  the scroll target keeps the current screen in view; `inView` is the question map.js asks across a resize
//   U13  what an edit redraws: an edit to one screen is one cell, never all of them
//
// The expected geometry below is written out from the layout's own contract (pitch = cell + gap, origin = pad), not
// read back from cellRect: a test that derived its expectation from the function it checks would prove nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, mapGridLimit, createMap } from '../../shared/project.js';
import {
  usesOverview,
  overviewBox,
  layoutOverview,
  cellRect,
  cellAt,
  scrollTarget,
  inView,
  cellLabel,
  cellState,
  changedCells,
  OVERVIEW_GAP,
  OVERVIEW_PAD,
  OVERVIEW_MAX_SCALE,
  OVERVIEW_MIN_BOX_HEIGHT,
  OVERVIEW_MAX_BOX_HEIGHT
} from '../../renderer/forges/map/overview.js';

const SHAPES = [
  [1, 30],
  [30, 1],
  [255, 1],
  [1, 255],
  [16, 15],
  [17, 15],
  [4, 4],
  [1, 1],
  [3, 2]
];
const BOXES = [
  { width: 0, height: 96 },
  { width: 40, height: 96 },
  { width: 120, height: 150 },
  { width: 300, height: 180 },
  { width: 520, height: 264 },
  { width: 808, height: 182 },
  { width: 808, height: 264 },
  { width: 1600, height: 264 },
  { width: 5000, height: 264 }
];

// ---------------------------------------------------------------------------------------------------------- U9

test('U9: a screen is drawn where row * gridW + col says, and the point inside it answers that index', () => {
  for (const [gridW, gridH] of SHAPES) {
    for (const box of BOXES) {
      const layout = layoutOverview(gridW, gridH, box);
      const pitchX = LIMITS.screenCols * layout.scale + OVERVIEW_GAP;
      const pitchY = LIMITS.screenRows * layout.scale + OVERVIEW_GAP;
      for (let row = 0; row < gridH; row++) {
        for (let col = 0; col < gridW; col++) {
          const index = row * gridW + col;
          const rect = cellRect(layout, index);
          assert.deepEqual(
            rect,
            {
              x: OVERVIEW_PAD + col * pitchX,
              y: OVERVIEW_PAD + row * pitchY,
              w: LIMITS.screenCols * layout.scale,
              h: LIMITS.screenRows * layout.scale
            },
            `${gridW}x${gridH} screen ${index} (col ${col}, row ${row}) is drawn at its own column and row`
          );
          // the four corners and the centre of the picture all answer this screen -- the last column and last row included
          for (const [x, y] of [
            [rect.x, rect.y],
            [rect.x + rect.w - 1, rect.y],
            [rect.x, rect.y + rect.h - 1],
            [rect.x + rect.w - 1, rect.y + rect.h - 1],
            [rect.x + rect.w / 2, rect.y + rect.h / 2]
          ]) {
            assert.equal(cellAt(layout, x, y), index, `${gridW}x${gridH}: (${x}, ${y}) is over screen ${index}`);
          }
        }
      }
    }
  }
});

test('U9: every pixel of a small overview answers the screen drawn there, and nothing else answers', () => {
  // brute force over a 16 x 15 and a 3 x 2 layout: build the pixel -> screen map from the rectangles, compare every pixel
  for (const [gridW, gridH] of [
    [16, 15],
    [3, 2],
    [1, 3]
  ]) {
    const layout = layoutOverview(gridW, gridH, { width: 5000, height: 5000 });
    const painted = new Map();
    for (let index = 0; index < gridW * gridH; index++) {
      const rect = cellRect(layout, index);
      for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) painted.set(`${x},${y}`, index);
    }
    for (let y = -3; y < layout.height + 3; y++) {
      for (let x = -3; x < layout.width + 3; x++) {
        assert.equal(cellAt(layout, x, y), painted.get(`${x},${y}`) ?? null, `${gridW}x${gridH} pixel (${x}, ${y})`);
      }
    }
  }
});

test('U9: a point in the margin, a gap, past the last column or row, or not a number is over no screen', () => {
  for (const [gridW, gridH] of SHAPES) {
    const layout = layoutOverview(gridW, gridH, { width: 808, height: 264 });
    const last = cellRect(layout, gridW * gridH - 1);
    assert.equal(cellAt(layout, -1, -1), null);
    assert.equal(cellAt(layout, 0, 0), null, 'the margin');
    assert.equal(cellAt(layout, last.x + last.w, last.y), null, 'just past the last column');
    assert.equal(cellAt(layout, last.x, last.y + last.h), null, 'just past the last row');
    assert.equal(cellAt(layout, layout.width, layout.height), null);
    assert.equal(cellAt(layout, layout.width + 500, 5), null);
    assert.equal(cellAt(layout, NaN, 5), null);
    assert.equal(cellAt(layout, 5, undefined), null);
    assert.equal(cellAt(layout, Infinity, 5), null);
    if (gridW > 1) {
      const first = cellRect(layout, 0);
      assert.equal(cellAt(layout, first.x + first.w, first.y), null, 'the gap between two columns');
    }
    if (gridH > 1) {
      const first = cellRect(layout, 0);
      assert.equal(cellAt(layout, first.x, first.y + first.h), null, 'the gap between two rows');
    }
    assert.equal(cellRect(layout, gridW * gridH), null, 'no screen one past the end');
    assert.equal(cellRect(layout, -1), null);
    assert.equal(cellRect(layout, 1.5), null);
  }
});

test('U9: the flat index runs along a row first (a transposed hit-test would answer col * gridH + row)', () => {
  const layout = layoutOverview(16, 15, { width: 800, height: 264 });
  // screen 17 of a 16-wide map is column 1, row 1 -- not column 1 of 15 rows (= 16) nor column 2, row 0
  const centre = (col, row) => {
    const r = cellRect(layout, row * 16 + col);
    return cellAt(layout, r.x + r.w / 2, r.y + r.h / 2);
  };
  assert.equal(centre(1, 1), 17);
  assert.equal(centre(15, 0), 15, 'the last column of the first row');
  assert.equal(centre(0, 14), 224, 'the first column of the last row');
  assert.equal(centre(15, 14), 239, 'the last screen of a 16 x 15 map');
  const column = layoutOverview(1, 30, { width: 40, height: 100 });
  const r = cellRect(column, 29);
  assert.equal(cellAt(column, r.x + 1, r.y + 1), 29, 'a column of 30: the last screen is the last row');
  const row = layoutOverview(255, 1, { width: 800, height: 100 });
  const q = cellRect(row, 254);
  assert.equal(cellAt(row, q.x + 1, q.y + 1), 254, 'a row of 255: the last screen is the last column');
  assert.ok(q.x > cellRect(row, 253).x && q.y === cellRect(row, 253).y);
});

// --------------------------------------------------------------------------------------------------------- U10

test('U10: the extent fits the box, or the box scrolls on the axis it exceeds -- never anywhere it cannot be scrolled to', () => {
  for (const [gridW, gridH] of SHAPES) {
    for (const box of BOXES) {
      const layout = layoutOverview(gridW, gridH, box);
      const what = `${gridW}x${gridH} in ${box.width}x${box.height}`;
      assert.ok(layout.scale >= 1 && layout.scale <= OVERVIEW_MAX_SCALE, `${what}: scale ${layout.scale}`);
      // the extent is exactly what the cells, gaps and margin add up to
      assert.equal(layout.width, 2 * OVERVIEW_PAD + gridW * LIMITS.screenCols * layout.scale + (gridW - 1) * OVERVIEW_GAP, what);
      assert.equal(layout.height, 2 * OVERVIEW_PAD + gridH * LIMITS.screenRows * layout.scale + (gridH - 1) * OVERVIEW_GAP, what);
      // an axis that does not scroll fits; one that does is exactly the one that exceeds
      assert.equal(layout.scrollX, layout.width > box.width, `${what}: scrollX says where it overflows`);
      assert.equal(layout.scrollY, layout.height > box.height, `${what}: scrollY says where it overflows`);
      if (!layout.scrollX) assert.ok(layout.width <= box.width, what);
      if (!layout.scrollY) assert.ok(layout.height <= box.height, what);
      // the whole drawing starts at 0 and ends inside the extent: nothing lies on the negative side
      const first = cellRect(layout, 0);
      const last = cellRect(layout, gridW * gridH - 1);
      assert.ok(first.x >= 0 && first.y >= 0, `${what}: the first cell is not on the negative side`);
      assert.ok(last.x + last.w <= layout.width && last.y + last.h <= layout.height, `${what}: the last cell is inside the extent`);
    }
  }
});

test('U10: the scale is the largest at which the whole grid fits, else 1 (cells are never a fixed 64 px)', () => {
  for (const [gridW, gridH] of SHAPES) {
    for (const box of BOXES) {
      const layout = layoutOverview(gridW, gridH, box);
      const fits = (scale) =>
        2 * OVERVIEW_PAD + gridW * LIMITS.screenCols * scale + (gridW - 1) * OVERVIEW_GAP <= box.width &&
        2 * OVERVIEW_PAD + gridH * LIMITS.screenRows * scale + (gridH - 1) * OVERVIEW_GAP <= box.height;
      const best = [4, 3, 2].find(fits) ?? 1;
      assert.equal(layout.scale, best, `${gridW}x${gridH} in ${box.width}x${box.height}`);
    }
  }
  // a 4 x 4 map in a generous box is the legacy thumbnail's size, one cell for one screen
  const small = layoutOverview(4, 4, { width: 800, height: 264 });
  assert.equal(small.cellW, 64);
  assert.equal(small.cellH, 60);
  // the long shapes: 255 across cannot be seen whole in a real stage, so it scrolls sideways only
  const row = layoutOverview(255, 1, { width: 808, height: 182 });
  assert.equal(row.scrollX, true);
  assert.equal(row.scrollY, false);
  const column = layoutOverview(1, 255, { width: 808, height: 182 });
  assert.equal(column.scrollY, true);
  assert.equal(column.scrollX, false);
  // a 16 x 15 map is seen whole when the stage leaves the height for it, and scrolls vertically when it does not
  assert.equal(layoutOverview(16, 15, { width: 808, height: 264 }).scrollY, false);
  assert.equal(layoutOverview(16, 15, { width: 808, height: 182 }).scrollY, true);
});

test('U10: the room the overview may take is bounded, whatever the map', () => {
  const gap = 14;
  const screenHeight = 480;
  for (const height of [300, 600, 718, 900, 1400, 5000]) {
    const box = overviewBox({ width: 850, height }, { screenHeight, gap });
    assert.equal(box.width, 850);
    assert.ok(box.height >= OVERVIEW_MIN_BOX_HEIGHT && box.height <= OVERVIEW_MAX_BOX_HEIGHT, `stage ${height}: ${box.height}`);
    if (height - screenHeight - gap >= OVERVIEW_MIN_BOX_HEIGHT && height - screenHeight - gap <= OVERVIEW_MAX_BOX_HEIGHT) {
      assert.equal(box.height, height - screenHeight - gap, 'the screen keeps its room; the overview takes what is left');
    }
  }
  assert.equal(overviewBox({ width: 850, height: 5000 }, { screenHeight, gap }).height, OVERVIEW_MAX_BOX_HEIGHT);
  assert.equal(overviewBox({ width: 850, height: 100 }, { screenHeight, gap }).height, OVERVIEW_MIN_BOX_HEIGHT);
  // nothing in the answer depends on how many screens the map has
  assert.deepEqual(overviewBox({ width: 850, height: 718 }, { screenHeight, gap }), { width: 850, height: 224 });
});

test('U10: which navigator a map gets: the legacy thumbnails for an ordinary map of 4 x 4 or fewer, the overview otherwise', () => {
  const ordinary = (gridW, gridH) => ({ ...createMap('Map'), gridW, gridH });
  const side = mapGridLimit({});
  assert.equal(side, 4, 'the ordinary limit this predicate is built on');
  for (const [w, h] of [[1, 1], [2, 3], [4, 1], [1, 4], [4, 4]]) {
    assert.equal(usesOverview(ordinary(w, h)), false, `an ordinary ${w} x ${h} map keeps the 64 x 60 thumbnails`);
  }
  for (const [w, h] of [[1, 1], [1, 4], [4, 4], [1, 30], [255, 1], [16, 15]]) {
    assert.equal(usesOverview({ ...ordinary(w, h), streamed: true }), true, `a streamed ${w} x ${h} map gets the overview`);
  }
  // an ordinary map over the ordinary limit (the project edited by hand, or in memory) cannot be shown by 4 x 4 thumbnails either
  for (const [w, h] of [[5, 1], [1, 5], [16, 15], [255, 1]]) {
    assert.equal(usesOverview(ordinary(w, h)), true, `an ordinary ${w} x ${h} map is beyond the legacy thumbnails`);
  }
  assert.equal(usesOverview({ ...ordinary(2, 2), streamed: false }), false, 'only `streamed === true` counts, as everywhere else');
  assert.equal(usesOverview({ ...ordinary(2, 2), streamed: undefined }), false);
});

// --------------------------------------------------------------------------------------------------------- U12

test('U12: the scroll target puts the current screen whole in view, and leaves a screen already in view alone', () => {
  const view = (left, top, width, height) => ({ left, top, width, height });
  for (const [gridW, gridH, width, height] of [
    [255, 1, 800, 60],
    [1, 255, 60, 180],
    [16, 15, 300, 180],
    [17, 15, 200, 100]
  ]) {
    const layout = layoutOverview(gridW, gridH, { width, height });
    for (let index = 0; index < gridW * gridH; index++) {
      const rect = cellRect(layout, index);
      // a real scroll box only ever holds an offset in [0, extent - view]
      const valid = (left, top) => view(Math.max(0, Math.min(left, layout.width - width)), Math.max(0, Math.min(top, layout.height - height)), width, height);
      for (const start of [valid(0, 0), valid(layout.width, layout.height), valid(37, 91)]) {
        const target = scrollTarget(layout, index, start);
        const what = `${gridW}x${gridH} screen ${index} from (${start.left}, ${start.top})`;
        assert.ok(target.left >= 0 && target.top >= 0, `${what}: a scroll offset is never negative`);
        assert.ok(target.left <= Math.max(0, layout.width - width) && target.top <= Math.max(0, layout.height - height), `${what}: nor past the end`);
        assert.ok(rect.x >= target.left && rect.x + rect.w <= target.left + width, `${what}: the screen is in view across`);
        assert.ok(rect.y >= target.top && rect.y + rect.h <= target.top + height, `${what}: the screen is in view down`);
      }
    }
  }
});

test('U12: a screen already whole in view does not move the box; a far one centres', () => {
  const layout = layoutOverview(255, 1, { width: 800, height: 60 });
  const here = scrollTarget(layout, 3, { left: 0, top: 0, width: 800, height: 60 });
  assert.deepEqual(here, { left: 0, top: 0 }, 'selecting a screen you can see leaves the box where you scrolled it');
  const mid = scrollTarget(layout, 3, { left: 17, top: 0, width: 800, height: 60 });
  assert.deepEqual(mid, { left: 17, top: 0 });
  const far = scrollTarget(layout, 200, { left: 0, top: 0, width: 800, height: 60 });
  const rect = cellRect(layout, 200);
  assert.equal(far.left, Math.round(rect.x + rect.w / 2 - 400), 'a far screen is centred');
  assert.ok(far.left > 3000, 'and the box really moved');
  const last = scrollTarget(layout, 254, { left: 0, top: 0, width: 800, height: 60 });
  assert.equal(last.left, layout.width - 800, 'the last screen is clamped to the end of the extent');
  const column = layoutOverview(1, 255, { width: 60, height: 180 });
  assert.ok(scrollTarget(column, 254, { left: 0, top: 0, width: 60, height: 180 }).top > 3000, 'down a column');
  assert.deepEqual(scrollTarget(layout, 999, { left: 5, top: 6, width: 800, height: 60 }), { left: 5, top: 6 }, 'a screen the map does not have changes nothing');
});

test('U12: a screen larger than the view still reaches its start', () => {
  const layout = layoutOverview(2, 2, { width: 5000, height: 5000 }); // 64 x 60 cells
  const tiny = scrollTarget(layout, 3, { left: 0, top: 0, width: 20, height: 20 });
  assert.ok(tiny.left >= 0 && tiny.top >= 0 && tiny.left <= layout.width && tiny.top <= layout.height);
});

test('U12: inView agrees with scrollTarget -- a screen is in view exactly when the target leaves the box where it is', () => {
  for (const [gridW, gridH, width, height] of [
    [255, 1, 800, 60],
    [1, 255, 60, 180],
    [17, 15, 200, 100]
  ]) {
    const layout = layoutOverview(gridW, gridH, { width, height });
    for (let index = 0; index < gridW * gridH; index += 7) {
      for (const [left, top] of [[0, 0], [37, 91], [layout.width, layout.height]]) {
        const view = {
          left: Math.max(0, Math.min(left, layout.width - width)),
          top: Math.max(0, Math.min(top, layout.height - height)),
          width,
          height
        };
        const target = scrollTarget(layout, index, view);
        const moves = target.left !== view.left || target.top !== view.top;
        assert.equal(inView(layout, index, view), !moves, `${gridW}x${gridH} screen ${index} from (${view.left}, ${view.top})`);
      }
    }
  }
});

test('U12: inView counts the gap round the cell, where its frame is drawn -- one pixel short on either side is out of view', () => {
  const layout = layoutOverview(17, 15, { width: 300, height: 180 });
  const rect = cellRect(layout, 40);
  const size = { width: rect.w + 2 * layout.gap, height: rect.h + 2 * layout.gap };
  const at = (dx, dy) => ({ left: rect.x - layout.gap + dx, top: rect.y - layout.gap + dy, ...size });
  assert.ok(inView(layout, 40, at(0, 0)), 'the cell and its gap exactly fill the view');
  assert.ok(!inView(layout, 40, at(1, 0)), 'one pixel off on the left edge');
  assert.ok(!inView(layout, 40, at(-1, 0)), 'one pixel off on the right edge');
  assert.ok(!inView(layout, 40, at(0, 1)), 'one pixel off on the top edge');
  assert.ok(!inView(layout, 40, at(0, -1)), 'one pixel off on the bottom edge');
  // flush with the cell itself, without the gap: not whole (the frame would be cut)
  assert.ok(!inView(layout, 40, { left: rect.x, top: rect.y, width: rect.w, height: rect.h }), 'a view exactly the cell leaves its frame out');
});

test('U12: a viewport that shrinks under a visible screen hides it, and the target brings it back (the resize case)', () => {
  // 17 x 15 at scale 1: 257 px tall. A 257 px view shows screen 254 whole; a 180 px one at the same scroll does not.
  const small = layoutOverview(17, 15, { width: 300, height: 180 });
  assert.equal(small.scale, 1);
  const tall = { left: 0, top: 0, width: small.width, height: small.height };
  assert.ok(inView(small, 254, tall), 'whole in a view the size of the extent');
  const short = { left: 0, top: 0, width: small.width, height: 180 };
  assert.ok(!inView(small, 254, short), 'the same scroll in a shorter view no longer shows it');
  const back = scrollTarget(small, 254, short);
  assert.ok(back.top > 0 && inView(small, 254, { ...short, ...back }), 'and the target scrolls it back');
  const narrow = { left: 0, top: 0, width: 100, height: small.height };
  assert.ok(!inView(small, 254, narrow), 'likewise across');
  assert.ok(inView(small, 254, { ...narrow, left: scrollTarget(small, 254, narrow).left }));
  assert.ok(!inView(small, 999, tall), 'a screen the map does not have is in view of nothing');
});

test('cellLabel: the flat index, the name when there is one, and the column and row', () => {
  assert.equal(cellLabel(16, 17, ''), 'Screen 17 (col 1, row 1)');
  assert.equal(cellLabel(16, 17, '  Cave mouth '), 'Screen 17 — Cave mouth (col 1, row 1)');
  assert.equal(cellLabel(1, 29, undefined), 'Screen 29 (col 0, row 29)');
  assert.equal(cellLabel(255, 254, null), 'Screen 254 (col 254, row 0)');
});

// --------------------------------------------------------------------------------------------------------- U13

const screens = (count) =>
  Array.from({ length: count }, (_, i) => ({ name: '', metatiles: new Array(240).fill(i % 7), entities: [], boundTiles: [] }));

function drawAll(world, startIndex, currentIndex) {
  const drawn = [];
  for (const index of changedCells(drawn, world, startIndex, currentIndex)) drawn[index] = cellState(world[index], index === startIndex, index === currentIndex);
  return drawn;
}

test('U13: nothing is drawn yet, so every cell is stale; once drawn, none is', () => {
  const world = screens(255);
  assert.equal(changedCells([], world, 0, 0).length, 255);
  const drawn = drawAll(world, 0, 0);
  assert.deepEqual(changedCells(drawn, world, 0, 0), []);
  // undo hands back equal screens that are different objects: still nothing stale
  assert.deepEqual(changedCells(drawn, structuredClone(world), 0, 0), []);
});

test('U13: an edit to one screen redraws that one cell, however many screens the map has (a full rebuild would answer all of them)', () => {
  for (const count of [30, 240, 255]) {
    const world = screens(count);
    const drawn = drawAll(world, 0, 0);
    const edited = Math.floor(count / 2);
    world[edited].metatiles[17] = 99;
    assert.deepEqual(changedCells(drawn, world, 0, 0), [edited], `${count} screens: one edit, one cell`);
    // the last metatile of the last screen is compared too
    const tail = screens(count);
    const tailDrawn = drawAll(tail, 0, 0);
    tail[count - 1].metatiles[239] = 250;
    assert.deepEqual(changedCells(tailDrawn, tail, 0, 0), [count - 1]);
  }
});

test('U13: selecting another screen redraws the two cells whose frame changed; moving the start marker, the two it moved between', () => {
  const world = screens(30);
  const drawn = drawAll(world, 0, 0);
  assert.deepEqual(changedCells(drawn, world, 0, 7), [0, 7], 'the old current cell loses its frame, the new one gains it');
  assert.deepEqual(changedCells(drawn, world, 12, 0), [0, 12], 'the start marker moved from 0 to 12');
  assert.deepEqual(changedCells(drawn, world, -1, 0), [0], 'the start is on another map: its marker comes off');
});

test('U13: a metatile id above 255 is compared, not truncated', () => {
  const world = screens(2);
  world[1].metatiles[5] = 300;
  const drawn = drawAll(world, -1, -1);
  world[1].metatiles[5] = 44; // 300 mod 256 = 44: a Uint8 copy would call these equal
  assert.deepEqual(changedCells(drawn, world, -1, -1), [1]);
});

test('U13: a grid that changed shape is stale where it has no drawn cell, and a shrunk one has none stale beyond its end', () => {
  const world = screens(10);
  const drawn = drawAll(world, 0, 0);
  assert.deepEqual(changedCells(drawn, screens(12), 0, 0).filter((i) => i >= 10), [10, 11]);
  assert.deepEqual(changedCells(drawn, world.slice(0, 4), 0, 0), []);
});
