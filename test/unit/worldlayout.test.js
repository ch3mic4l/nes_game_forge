// Map Forge World view (ROADMAP item 7, build commit C1): the pure layout in renderer/forges/map/worldlayout.js, and the
// golden table that pins the two overview.js extractions it rests on. docs/design-world-overview.md section 7 names each
// test; every one states, in its first comment line, the wrong implementation it exists to catch.
//
//   L1 packing and extent   L2 exact inverse, headers, row-major   L3 scale (Fit)   L4 scroll target and label
//   L5 keys and the tileset pool   L6 the window   M-pick markers   E1 golden for the overview.js extractions   P1 purity
//
// Literals below are written out from the contract (WORLD_PAD 8, WORLD_BLOCK_GAP 14, WORLD_HEADER 14, OVERVIEW_PAD/GAP 2, a
// cell 16 x 15 metatiles at `scale` px each), not read back from the function under test.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WORLD_HEADER,
  WORLD_MIN_BLOCK_W,
  WORLD_BLOCK_GAP,
  WORLD_PAD,
  WORLD_FALLBACK_SCALE,
  WORLD_WINDOW_MARGIN,
  WORLD_WINDOW_SLACK,
  layoutWorld,
  chooseWorldScale,
  worldCellRect,
  worldHit,
  worldMarkerRect,
  worldMarkerSize,
  markerAt,
  worldScrollTarget,
  worldInView,
  worldResizeTarget,
  blockLabel,
  windowRetains,
  worldWindow,
  intersectsWindow,
  worldLayoutKey,
  worldBlockKey,
  worldHeaderKey,
  createTilesetPool
} from '../../renderer/forges/map/worldlayout.js';
import {
  OVERVIEW_GAP,
  OVERVIEW_PAD,
  layoutOverview,
  gridLayoutAt,
  cellRect,
  cellAt,
  inView,
  scrollTarget,
  cellState,
  changedCells
} from '../../renderer/forges/map/overview.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BOX = { width: 900, height: 520 };
const grids = (...shapes) => shapes.map(([gridW, gridH]) => ({ gridW, gridH }));
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ------------------------------------------------------------------------------------------------------------- L1

test('L1: blocks are in map order, never overlap, lie inside the extent, and the extent flags say whether the box scrolls', () => {
  // wrong: blocks sorted by area or folder; a block placed on top of another; a block outside the extent; a scroll flag that lies
  const worlds = {
    '1x1': grids([1, 1]),
    '4x4': grids([4, 4]),
    '1x30': grids([1, 30]),
    '30x1': grids([30, 1]),
    '255x1': grids([255, 1]),
    '1x255': grids([1, 255]),
    '16x15': grids([16, 15]),
    '255 of 1x1': grids(...Array.from({ length: 255 }, () => [1, 1])),
    'mixed 127x1 + 1x128': grids([127, 1], [1, 128]),
    'several rows': grids([3, 2], [1, 1], [2, 3], [5, 1], [1, 1], [4, 4])
  };
  for (const [name, maps] of Object.entries(worlds)) {
    for (const box of [BOX, { width: 300, height: 200 }, { width: 5000, height: 5000 }]) {
      for (let scale = 1; scale <= 4; scale++) {
        const layout = layoutWorld(maps, box, scale);
        assert.equal(layout.blocks.length, maps.length, `${name}: one block per map`);
        layout.blocks.forEach((b, i) => {
          assert.equal(b.mapIndex, i, `${name}: block ${i} is map ${i} (project order)`);
          assert.ok(b.x >= WORLD_PAD && b.y >= WORLD_PAD, `${name}: block ${i} clears the margin`);
          assert.ok(b.x + b.w + WORLD_PAD <= layout.width && b.y + b.h + WORLD_PAD <= layout.height, `${name}: block ${i} is inside the extent`);
        });
        for (let i = 0; i < layout.blocks.length; i++) {
          for (let j = i + 1; j < layout.blocks.length; j++) assert.ok(!overlap(layout.blocks[i], layout.blocks[j]), `${name} @${scale}: blocks ${i} and ${j} overlap`);
        }
        assert.equal(layout.scrollX, layout.width > box.width, `${name} @${scale} ${box.width}: scrollX says whether the extent is wider than the box`);
        assert.equal(layout.scrollY, layout.height > box.height, `${name} @${scale} ${box.width}: scrollY says whether the extent is taller than the box`);
      }
    }
  }
  // a lone 255 x 1 is wider than the box and short: it sets scrollX only
  const wide = layoutWorld(grids([255, 1]), BOX, 2);
  assert.equal(wide.scrollX, true);
  assert.equal(wide.scrollY, false);
});

test('L1: the first two blocks sit where the contract puts them, and a block wraps exactly when it would pass the box', () => {
  // wrong: `>=` for `>` at the wrap; a row as tall as the LAST block; a block y that ignores the header or the gap; a layout that squeezes
  // A 3 x 2 map at 2x: grid 3*32 + 2*2 + 2*2 = 104 wide, 2*30 + 2 + 2*2 = 66 tall; a 1 x 1: grid 36 wide, 34 tall (so a 96 px block).
  const maps = grids([3, 2], [1, 1]);
  const side = layoutWorld(maps, { width: 230, height: 520 }, 2);
  assert.deepEqual(
    side.blocks.map(({ mapIndex, x, y, w, h, gridX, gridY }) => ({ mapIndex, x, y, w, h, gridX, gridY })),
    [
      { mapIndex: 0, x: 8, y: 8, w: 104, h: 80, gridX: 8, gridY: 22 },
      { mapIndex: 1, x: 126, y: 8, w: 96, h: 48, gridX: 126, gridY: 22 }
    ]
  );
  assert.deepEqual([side.width, side.height], [230, 96], 'the second block ends 8 short of the 230 px box: it fits exactly, so it does not wrap');
  const wrapped = layoutWorld(maps, { width: 229, height: 520 }, 2);
  assert.deepEqual(
    wrapped.blocks.map(({ x, y }) => [x, y]),
    [[8, 8], [8, 102]],
    'one pixel narrower: it would pass, so it wraps, 14 px under the tallest block of the row it left (80 tall, not the 48 of the block that wrapped)'
  );
  assert.deepEqual([wrapped.width, wrapped.height], [120, 158]);
});

test('L1: a lone over-wide block takes its own row, and a block after it starts the next row', () => {
  // wrong: wrapping an empty row forever; the next block sharing a row with a block already past the edge; squeezing a wide map to fit
  const layout = layoutWorld(grids([1, 1], [255, 1], [1, 1]), BOX, 4);
  const [a, b, c] = layout.blocks;
  assert.equal(a.y, 8);
  assert.equal(b.x, 8, 'the wide block starts a row of its own');
  assert.equal(b.y, a.y + a.h + WORLD_BLOCK_GAP);
  assert.equal(b.w, 16832, 'and is not squeezed: 255 cells of 64 plus 254 gaps plus the margins');
  assert.equal(c.x, 8, 'what follows it starts another row');
  assert.equal(c.y, b.y + b.h + WORLD_BLOCK_GAP);
  assert.equal(layout.width, 16832 + 2 * WORLD_PAD);
});

test('L1: the extents the design quotes for the worst shapes are exactly these', () => {
  // wrong: a changed margin or gap; a header or padding the sums forget (16,848 x 94, 112 x 15,842, 4,336 x 4,190 and 8,400 x 8,060 are the design's figures)
  const dims = (maps, scale) => {
    const l = layoutWorld(maps, BOX, scale);
    return [l.width, l.height];
  };
  assert.deepEqual(dims(grids([255, 1]), 4), [16848, 94]);
  assert.deepEqual(dims(grids([1, 255]), 4), [112, 15842]);
  assert.deepEqual(dims(grids([127, 1], [1, 128]), 2), [4336, 4190]);
  assert.deepEqual(dims(grids([127, 1], [1, 128]), 4), [8400, 8060]);
});

// ------------------------------------------------------------------------------------------------------------- L2

test('L2: every pixel of a multi-row world answers the cell or header drawn there and nothing else answers, at scales 1-4', () => {
  // wrong: the header answering a cell; an off-by-one at a gap or the last row/column; a hit-test using a pad the rectangle does not; two blocks answering one pixel
  const maps = grids([3, 2], [1, 1], [2, 3], [5, 1], [1, 1], [4, 4]);
  for (let scale = 1; scale <= 4; scale++) {
    const layout = layoutWorld(maps, { width: 300, height: 400 }, scale);
    const painted = new Map();
    for (const block of layout.blocks) {
      for (let y = block.y; y < block.y + WORLD_HEADER; y++) for (let x = block.x; x < block.x + block.w; x++) painted.set(`${x},${y}`, `h${block.mapIndex}`);
      const count = maps[block.mapIndex].gridW * maps[block.mapIndex].gridH;
      for (let index = 0; index < count; index++) {
        const rect = worldCellRect(layout, block.mapIndex, index);
        for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) painted.set(`${x},${y}`, `${block.mapIndex}:${index}`);
      }
    }
    for (let y = -3; y < layout.height + 3; y++) {
      for (let x = -3; x < layout.width + 3; x++) {
        const hit = worldHit(layout, x, y);
        const got = hit === null ? null : hit.header ? `h${hit.mapIndex}` : `${hit.mapIndex}:${hit.screenIndex}`;
        if (got !== (painted.get(`${x},${y}`) ?? null)) assert.fail(`@${scale}: pixel (${x}, ${y}) answers ${got}, the picture says ${painted.get(`${x},${y}`) ?? null}`);
      }
    }
    assert.equal(worldCellRect(layout, 0, 6), null, 'a 3 x 2 map has no screen 6');
    assert.equal(worldCellRect(layout, 99, 0), null);
    assert.equal(worldCellRect(layout, 0, -1), null);
  }
});

test('L2: row-major, from hand-written literals -- screen 4 of a 3 x 2 map at 2x is column 1, row 1', () => {
  // wrong: a transposed `col * gridH + row` in cellRect AND in the hit-test, which are still exact inverses and pass any self-derived scan
  const layout = layoutWorld(grids([3, 2]), BOX, 2);
  // origin: margin 8 + OVERVIEW_PAD 2 across; margin 8 + header 14 + OVERVIEW_PAD 2 down; pitch 32 + 2 across, 30 + 2 down
  assert.deepEqual(worldCellRect(layout, 0, 0), { x: 10, y: 24, w: 32, h: 30 });
  assert.deepEqual(worldCellRect(layout, 0, 1), { x: 44, y: 24, w: 32, h: 30 });
  assert.deepEqual(worldCellRect(layout, 0, 2), { x: 78, y: 24, w: 32, h: 30 });
  assert.deepEqual(worldCellRect(layout, 0, 3), { x: 10, y: 56, w: 32, h: 30 });
  assert.deepEqual(worldCellRect(layout, 0, 4), { x: 44, y: 56, w: 32, h: 30 });
  assert.deepEqual(worldHit(layout, 44, 56), { mapIndex: 0, screenIndex: 4 });
  assert.deepEqual(worldHit(layout, 75, 85), { mapIndex: 0, screenIndex: 4 });
  assert.equal(worldHit(layout, 76, 56), null, 'the gap right of screen 4');
  assert.equal(worldHit(layout, 44, 86), null, 'the gap under it');
  assert.equal(worldHit(layout, 43, 56), null, 'and the gap left of it');
  assert.deepEqual(worldHit(layout, 78, 24), { mapIndex: 0, screenIndex: 2 }, 'column 2, row 0 is screen 2, not screen 4');
});

test('L2: the header answers through its last row, the two padding rows under it answer nothing, the first cell starts at gridY + OVERVIEW_PAD', () => {
  // wrong: the header answering a cell; a hit-test that drops the grid's own padding (review 2, finding 4); a header strip one row short or long
  const layout = layoutWorld(grids([3, 2], [1, 1]), BOX, 2);
  for (const block of layout.blocks) {
    const inside = block.x + 5;
    assert.deepEqual(worldHit(layout, inside, block.y), { mapIndex: block.mapIndex, header: true }, 'the first header row');
    assert.deepEqual(worldHit(layout, block.x, block.y + WORLD_HEADER - 1), { mapIndex: block.mapIndex, header: true }, 'the last header row, at the left edge');
    assert.deepEqual(worldHit(layout, block.x + block.w - 1, block.y + WORLD_HEADER - 1), { mapIndex: block.mapIndex, header: true }, 'and at the right edge');
    assert.equal(block.gridY, block.y + WORLD_HEADER);
    for (let pad = 0; pad < OVERVIEW_PAD; pad++) {
      assert.equal(worldHit(layout, block.gridX + OVERVIEW_PAD + 3, block.gridY + pad), null, `grid padding row ${pad} under the header answers nothing`);
    }
    assert.deepEqual(
      worldHit(layout, block.gridX + OVERVIEW_PAD + 3, block.gridY + OVERVIEW_PAD),
      { mapIndex: block.mapIndex, screenIndex: 0 },
      'the first cell row starts at gridY + OVERVIEW_PAD'
    );
    // padding at the sides, and the block's own edges
    assert.equal(worldHit(layout, block.gridX, block.gridY + OVERVIEW_PAD + 3), null, 'left padding');
    assert.equal(worldHit(layout, block.gridX + OVERVIEW_PAD - 1, block.gridY + OVERVIEW_PAD + 3), null, 'left padding, last column');
    assert.deepEqual(worldHit(layout, block.gridX + OVERVIEW_PAD, block.gridY + OVERVIEW_PAD + 3), { mapIndex: block.mapIndex, screenIndex: 0 });
    assert.equal(worldHit(layout, block.x + block.w, block.y + 3), null, 'one pixel right of the header');
    assert.equal(worldHit(layout, block.x - 1, block.y + 3), null);
    assert.equal(worldHit(layout, block.x + 3, block.y - 1), null);
  }
  const wide = layout.blocks[1];
  assert.ok(wide.w > wide.grid.width, 'a 1 x 1 block is wider than its grid (96 px minimum)');
  assert.equal(worldHit(layout, wide.gridX + wide.grid.width, wide.gridY + 4), null, 'the empty space right of a narrow grid answers nothing');
  assert.deepEqual(worldHit(layout, wide.gridX + wide.w - 1, wide.y + 2), { mapIndex: 1, header: true }, 'but the header strip spans the whole block');
});

test('L2: a point that is not finite, or outside the world, is over nothing', () => {
  // wrong: a NaN that compares false everywhere and lands on block 0; a negative coordinate wrapping into the last block
  const layout = layoutWorld(grids([3, 2], [1, 1]), BOX, 2);
  for (const [x, y] of [[NaN, 5], [5, NaN], [undefined, 5], [-1, -1], [layout.width, layout.height], [layout.width + 10, 0], [0, layout.height + 10], [Infinity, 5]]) {
    assert.equal(worldHit(layout, x, y), null, `(${x}, ${y})`);
  }
});

// ------------------------------------------------------------------------------------------------------------- L3

test('L3: Fit picks the largest scale at which the whole world fits, falls back to 2 when none does, and is 1 when only 1x fits', () => {
  // wrong: "always 4"; "always smallest"; a fallback that forbids 1; "does not fit" confused with "unavailable"
  const one = grids([1, 1]); // a 1 x 1 world is 112 x 94 at 4x, 79 tall at 3x, 64 at 2x, 49 at 1x; 112 wide at every scale (96 px block)
  assert.equal(chooseWorldScale(one, { width: 112, height: 94 }), 4);
  assert.equal(chooseWorldScale(one, { width: 111, height: 94 }), WORLD_FALLBACK_SCALE, 'one pixel too narrow: the 96 px block makes the world 112 wide at every scale, so none fits');
  assert.equal(chooseWorldScale(one, { width: 112, height: 93 }), 3, 'one pixel too short for 4x');
  assert.equal(chooseWorldScale(one, { width: 112, height: 79 }), 3);
  assert.equal(chooseWorldScale(one, { width: 112, height: 78 }), 2);
  assert.equal(chooseWorldScale(one, { width: 112, height: 64 }), 2);
  assert.equal(chooseWorldScale(one, { width: 112, height: 63 }), 1, 'only 1x fits whole: 1, not the fallback');
  assert.equal(chooseWorldScale(one, { width: 112, height: 49 }), 1);
  assert.equal(chooseWorldScale(one, { width: 112, height: 48 }), WORLD_FALLBACK_SCALE, 'none fits: the fallback');
  assert.equal(WORLD_FALLBACK_SCALE, 2);
  assert.equal(chooseWorldScale(one, { width: 0, height: 0 }), 2);
});

test('L3: the longest worlds are allowed at every scale (no extent guard) and Fit falls back to 2 for them in the 900 x 520 box', () => {
  // wrong: a stale 16,000 px guard refusing 4x; an unavailable scale; Fit choosing a scale that does not fit
  for (const scale of [1, 2, 3, 4]) {
    assert.ok(layoutWorld(grids([255, 1]), BOX, scale).scrollX);
    assert.ok(layoutWorld(grids([1, 255]), BOX, scale).scrollY);
  }
  assert.deepEqual([layoutWorld(grids([255, 1]), BOX, 4).width, layoutWorld(grids([255, 1]), BOX, 4).height], [16848, 94]);
  assert.deepEqual([layoutWorld(grids([1, 255]), BOX, 4).width, layoutWorld(grids([1, 255]), BOX, 4).height], [112, 15842]);
  assert.equal(chooseWorldScale(grids([255, 1]), BOX), 2);
  assert.equal(chooseWorldScale(grids([1, 255]), BOX), 2);
  // a world that wraps still fits: four 1 x 1 maps in a box four blocks wide
  const four = grids([1, 1], [1, 1], [1, 1], [1, 1]);
  assert.equal(chooseWorldScale(four, { width: 8 + 4 * 96 + 3 * 14 + 8, height: 94 }), 4);
  assert.equal(chooseWorldScale(four, { width: 8 + 4 * 96 + 3 * 14 + 7, height: 94 }), 2, 'one pixel narrower: it wraps to two rows, which 94 px cannot hold at any scale');
});

// ------------------------------------------------------------------------------------------------------------- L4

test('L4: a whole-visible cell leaves the box alone; a far one is centred and clamped to the scrollable range', () => {
  // wrong: centring on every call (jerking the box on a click); no clamp (a negative offset or one past the end); the gap round the cell ignored
  const layout = layoutWorld(grids([255, 1]), BOX, 2); // 8,688 wide; cell k at x = 10 + 34 k, y 24, 32 x 30
  const view = (left, top = 0) => ({ left, top, width: BOX.width, height: BOX.height });
  assert.deepEqual(worldScrollTarget(layout, 0, 5, view(17)), { left: 17, top: 0 }, 'cell 5 is whole in view: nothing moves');
  assert.deepEqual(worldScrollTarget(layout, 0, 100, view(0)), { left: 2976, top: 0 }, 'cell 100 centres: 3408 + 18 - 450');
  assert.deepEqual(worldScrollTarget(layout, 0, 254, view(0)), { left: 8688 - 900, top: 0 }, 'the last cell clamps to extent - view');
  assert.deepEqual(worldScrollTarget(layout, 0, 0, view(3000)), { left: 0, top: 0 }, 'the first cell clamps at 0, never negative');
  assert.deepEqual(worldScrollTarget(layout, 0, 999, view(123)), { left: 123, top: 0 }, 'a screen the world does not have leaves the box alone');
  // the gap counts: a cell whose frame is cut off by one pixel is not whole in view
  assert.equal(worldInView(layout, 0, 5, view(176)), true);
  assert.equal(worldInView(layout, 0, 5, view(179)), false, 'the 2 px gap round cell 5 starts at 178');
  assert.equal(worldInView(layout, 0, 5, { left: 0, top: 0, width: 150, height: 520 }), false, 'a view too narrow for it');
  assert.equal(worldInView(layout, 3, 0, view(0)), false);
});

test('L4: a resize keeps the current cell in view only if it was whole in the layout and view it had BEFORE, whichever way a wrap moved it', () => {
  // wrong: asking the new layout whether the cell fits the old viewport size (a wrap moves the cell out of a viewport it was in); recentring a scrolled-away box on every resize
  const maps = grids([4, 4], [4, 4], [4, 4]);
  const wide = layoutWorld(maps, { width: 900, height: 300 }, 4);
  const narrow = layoutWorld(maps, { width: 560, height: 300 }, 4);
  assert.deepEqual(worldCellRect(wide, 2, 0), { x: 570, y: 24, w: 64, h: 60 }, 'one row at 900: the third map sits right of the second');
  assert.deepEqual(worldCellRect(narrow, 2, 0), { x: 10, y: 580, w: 64, h: 60 }, 'at 560 the third block wraps to a second row, 556 px lower');
  const before = { layout: wide, view: { left: 0, top: 0, width: 900, height: 300 } };
  const after = { left: 0, top: 0, width: 560, height: 300 };
  assert.equal(worldInView(narrow, 2, 0, { ...after, width: 900 }), false, 'the new layout against the old viewport size: the cell is offscreen');
  assert.equal(worldInView(wide, 2, 0, before.view), true, 'but it was whole in the old layout');
  const target = worldResizeTarget(before, narrow, 2, 0, after);
  assert.deepEqual(target, { left: 0, top: 580 + 30 - 150 }, 'centred on the new row: 610 - 150');
  assert.equal(worldInView(narrow, 2, 0, { ...after, top: target.top }), true, 'whole again after the scroll');
  // scrolled away before the resize (the cell is below the 300 px box): nothing moves
  const away = { layout: wide, view: { left: 0, top: 0, width: 900, height: 40 } };
  assert.equal(worldInView(wide, 2, 0, away.view), false);
  assert.equal(worldResizeTarget(away, narrow, 2, 0, { ...after, height: 40 }), null, 'a cell that was not whole stays where it is');
  assert.equal(worldResizeTarget(null, narrow, 2, 0, after), null, 'nothing was shown before: nothing to keep');
  assert.equal(worldResizeTarget({ layout: wide, view: { left: 0, top: 0, width: 0, height: 0 } }, narrow, 2, 0, after), null, 'a box that had no size shows nothing to keep');
});

test('L4: a block label carries its folder, its size and its streamed suffix', () => {
  // wrong: a header without the folder; a size dropped; a streamed map not marked; an unnamed map labelled "undefined"
  assert.equal(blockLabel({ name: 'Greenwood', folder: 'Dungeons', gridW: 2, gridH: 2, streamed: false }, 0), '[Dungeons] Greenwood · 2×2');
  assert.equal(blockLabel({ name: 'Caves', folder: null, gridW: 1, gridH: 30, streamed: true }, 1), 'Caves · 1×30 · streamed');
  assert.equal(blockLabel({ name: '  ', folder: '', gridW: 1, gridH: 1 }, 3), 'Map 3 · 1×1');
});

// ------------------------------------------------------------------------------------------------------------- L5

test('L5: one edited screen is one stale cell however many screens a map has', () => {
  // wrong: a full rebuild per edit; a key that is a hash a different edit can share
  const screens = Array.from({ length: 255 }, (_, i) => ({ metatiles: Uint16Array.from({ length: 240 }, (_, n) => (n + i) % 7) }));
  const drawn = screens.map((s) => cellState(s, false, false));
  assert.deepEqual(changedCells(drawn, screens, -1, -1), []);
  screens[137].metatiles[200] = 9;
  assert.deepEqual(changedCells(drawn, screens, -1, -1), [137]);
});

test('L5: a moved block, a new scale, a reshaped grid, or another tileset binding changes the block key; a rename changes only the header key', () => {
  // wrong: a key without the tileset binding or the label; a version-only key; a block key that follows the map's name
  const maps = grids([2, 2], [3, 1]);
  const layout = layoutWorld(maps, BOX, 2);
  const [a, b] = layout.blocks;
  const ts = (tilesetId, serial = 1, version = 0) => ({ tilesetId, serial, version });
  const base = worldBlockKey(a, 2, ts(0));
  assert.equal(worldBlockKey({ ...a }, 2, ts(0)), base, 'the same inputs, the same key');
  assert.notEqual(worldBlockKey({ ...a, x: a.x + 1 }, 2, ts(0)), base, 'moved in x');
  assert.notEqual(worldBlockKey({ ...a, y: a.y + 1 }, 2, ts(0)), base, 'moved in y');
  assert.notEqual(worldBlockKey(a, 3, ts(0)), base, 'a new scale');
  assert.notEqual(worldBlockKey({ ...a, grid: { ...a.grid, gridW: 3 } }, 2, ts(0)), base, 'a reshaped grid');
  assert.notEqual(worldBlockKey({ ...a, mapIndex: 1 }, 2, ts(0)), base, 'another map at the same place');
  assert.notEqual(worldBlockKey(a, 2, ts(1)), base, 'another tileset');
  assert.notEqual(worldBlockKey(a, 2, ts(0, 2)), base, 'a recreated renderer (new serial)');
  assert.notEqual(worldBlockKey(a, 2, ts(0, 1, 1)), base, 'new art (version)');
  // two maps exchanging tileset ids, geometry and versions equal: both keys change
  const sameShape = layoutWorld(grids([2, 2], [2, 2]), BOX, 2).blocks;
  const before = sameShape.map((block, i) => worldBlockKey(block, 2, ts(i)));
  const after = sameShape.map((block, i) => worldBlockKey(block, 2, ts(1 - i)));
  assert.notEqual(before[0], after[0]);
  assert.notEqual(before[1], after[1]);
  // a rename or a folder edit: the header key moves, the block key does not (it takes no label)
  const label = blockLabel({ name: 'World', folder: null, gridW: 2, gridH: 2 }, 0);
  const renamed = blockLabel({ name: 'World 2', folder: null, gridW: 2, gridH: 2 }, 0);
  const foldered = blockLabel({ name: 'World', folder: 'Act 1', gridW: 2, gridH: 2 }, 0);
  assert.notEqual(worldHeaderKey(a, 2, label), worldHeaderKey(a, 2, renamed));
  assert.notEqual(worldHeaderKey(a, 2, label), worldHeaderKey(a, 2, foldered));
  assert.equal(worldHeaderKey(a, 2, label), worldHeaderKey({ ...a }, 2, label));
  assert.notEqual(worldHeaderKey(a, 2, label), worldHeaderKey({ ...a, w: a.w + 1 }, 2, label), 'a wider header is another header');
  assert.notEqual(worldHeaderKey(a, 2, label), worldHeaderKey(a, 3, label), 'and so is another scale');
  assert.notEqual(worldLayoutKey(layout), worldLayoutKey(layoutWorld(maps, BOX, 3)), 'the layout key follows the scale');
  assert.equal(worldLayoutKey(layout), worldLayoutKey(layoutWorld(maps, BOX, 2)), 'and not the map names, which it never sees');
  assert.ok(b.x > a.x);
});

test('L5: a pooled renderer is rebuilt every sync, dropped when unused, and a recreated one never reuses a serial', () => {
  // wrong: a serial taken from the renderer's own version (an instance counter two renderers can share); a pool that never drops; a stale renderer left unbuilt
  const built = [];
  let made = 0;
  const pool = createTilesetPool(() => ({ version: 0, id: ++made, rebuild(project, id) { built.push([this.id, id, project]); } }));
  const project = { tag: 'p1' };
  pool.sync(project, [0, 1, 1]);
  assert.equal(pool.size, 2);
  assert.deepEqual(pool.get(0).serial, 1);
  assert.deepEqual(pool.get(1).serial, 2);
  assert.equal(built.length, 2, 'each tileset is built once per sync');
  pool.sync({ tag: 'p2' }, [0, 1]);
  assert.equal(built.length, 4, 'and again on the next');
  assert.equal(pool.get(0).serial, 1, 'a renderer kept keeps its serial');
  pool.sync({ tag: 'p3' }, [0]);
  assert.equal(pool.size, 1);
  assert.equal(pool.get(1), null, 'dropped when unused');
  pool.sync({ tag: 'p4' }, [0, 1]);
  assert.equal(pool.get(1).serial, 3, 'recreated under a new serial, never 2 again');
  assert.equal(pool.get(5), null);
});

// ------------------------------------------------------------------------------------------------------------- L6

const view = (left, top, width = 900, height = 520) => ({ left, top, width, height });
const BIG = { width: 8400, height: 8060 }; // the extent of the 127 x 1 + 1 x 128 world at 4x (asserted above)
const win = (x, y, w, h) => ({ x, y, w, h });
const containsView = (w, layout, v) => {
  const left = Math.max(0, Math.min(v.left, layout.width - v.width));
  const top = Math.max(0, Math.min(v.top, layout.height - v.height));
  return w.x <= left && w.y <= top && w.x + w.w >= Math.min(layout.width, left + v.width) && w.y + w.h >= Math.min(layout.height, top + v.height);
};

test('L6 (a): a slow scroll hands back the same window object through left 192, and the first new one at 193 is 1349 wide', () => {
  // wrong: recomputing on every call (identity lost, a clear per scroll event); an inner zone of the wrong size; a window re-centred too early
  const first = worldWindow(BIG, view(0, 0), null);
  assert.deepEqual(first, win(0, 0, 1156, 776), 'the 900 x 520 viewport grown by 256, clipped at the origin');
  let prev = first;
  for (let left = 1; left <= 192; left++) {
    const next = worldWindow(BIG, view(left, 0), prev);
    assert.equal(next, prev, `left ${left}: the same object`);
  }
  const moved = worldWindow(BIG, view(193, 0), prev);
  assert.notEqual(moved, prev);
  assert.deepEqual(moved, win(0, 0, 1349, 776));
  assert.equal(WORLD_WINDOW_MARGIN - WORLD_WINDOW_SLACK, 192, 'the 192 px of travel the margin leaves over the slack');
});

test('L6 (b): a jump beyond the margin gives a window that contains the viewport and shares no pixel with the old one', () => {
  // wrong: a retention test that compares scroll deltas to the margin; a one-step shift that leaves a blank band
  const old = worldWindow(BIG, view(0, 0), null);
  const jumped = worldWindow(BIG, view(5000, 0), old);
  assert.deepEqual(jumped, win(4744, 0, 1412, 776));
  assert.ok(containsView(jumped, BIG, view(5000, 0)));
  assert.ok(!intersectsWindow(old, jumped), 'disjoint from the old window');
});

test('L6 (c): on the mixed 127 x 1 + 1 x 128 world a vertical exit and a horizontal exit each move the window, both at once move it once', () => {
  // wrong: a retention test on one axis only; per-axis windows that disagree with the canvas rectangle
  const mixed = layoutWorld(grids([127, 1], [1, 128]), BOX, 2);
  assert.deepEqual([mixed.width, mixed.height], [4336, 4190]);
  const start = worldWindow(mixed, view(0, 0), null);
  assert.deepEqual(start, win(0, 0, 1156, 776));
  const vertical = worldWindow(mixed, view(100, 193), start);
  assert.notEqual(vertical, start, 'top 193: past the vertical slack while x is inside its zone');
  assert.deepEqual(vertical, win(0, 0, 1256, 969), 'left 100 grown by 256 reaches 1256');
  const horizontal = worldWindow(mixed, view(193, 100), start);
  assert.notEqual(horizontal, start, 'left 193: past the horizontal slack while y is inside its zone');
  assert.deepEqual(horizontal, win(0, 0, 1349, 876));
  const stillInside = worldWindow(mixed, view(100, 100), start);
  assert.equal(stillInside, start, 'inside on both axes: unchanged');
  const diagonal = worldWindow(mixed, view(400, 400), start);
  assert.deepEqual(diagonal, win(144, 144, 1412, 1032));
  // a diagonal walk: the window object changes only when a coordinate leaves its zone, and always holds the viewport
  let prev = start;
  let moves = 0;
  for (let step = 0; step <= 2000; step += 7) {
    const v = view(step, step);
    const next = worldWindow(mixed, v, prev);
    if (next !== prev) moves++;
    assert.ok(containsView(next, mixed, v), `step ${step}: the window holds the viewport`);
    prev = next;
  }
  assert.ok(moves > 1 && moves < 2000 / 7 / 10, `a diagonal walk of 2,000 px moves the window a few times, not per step (${moves})`);
});

test('L6 (d): returning to an earlier scroll position gives the earlier rectangle exactly', () => {
  // wrong: an accumulated or history-dependent origin that drifts on the way out and back
  const first = worldWindow(BIG, view(0, 0), null);
  const away = worldWindow(BIG, view(5000, 0), first);
  const back = worldWindow(BIG, view(0, 0), away);
  assert.deepEqual(back, first);
  assert.deepEqual(back, win(0, 0, 1156, 776));
  const farAway = worldWindow(BIG, view(5000, 4000), back);
  assert.deepEqual(worldWindow(BIG, view(5000, 4000), null), farAway, 'the window of a view does not depend on where it came from');
});

test('L6 (e): at the right and bottom edge the clipped window is retained, a window beyond the extent is not, offsets are clamped, a small world is whole', () => {
  // wrong: thrash at the extent (an unclipped inner zone asks for coverage past the world); a view that is not clamped; a prev that exceeds the new extent kept
  const corner = worldWindow(BIG, view(8400 - 900, 8060 - 520), null);
  assert.deepEqual(corner, win(7244, 7284, 1156, 776));
  for (let left = 8400 - 900; left >= 8400 - 900 - 192; left--) assert.ok(windowRetains(corner, BIG, view(left, 8060 - 520)), `left ${left}`);
  assert.equal(windowRetains(corner, BIG, view(8400 - 900 - 193, 8060 - 520)), false, '193 px back leaves the slack');
  assert.equal(worldWindow(BIG, view(9999, 9999), corner), corner, 'offsets past the end are clamped to it');
  assert.deepEqual(worldWindow(BIG, view(-50, -50), null), win(0, 0, 1156, 776), 'negative offsets are clamped to 0');
  const small = { width: 300, height: 200 };
  assert.deepEqual(worldWindow(small, view(0, 0), null), win(0, 0, 300, 200), 'an extent smaller than the viewport gives the whole extent');
  const prev = win(0, 0, 1156, 776);
  const shrunk = { width: 1000, height: 776 };
  assert.equal(windowRetains(prev, shrunk, view(0, 0)), false, 'a prev that exceeds the extent is not retained');
  assert.notEqual(worldWindow(shrunk, view(0, 0), prev), prev);
  assert.equal(windowRetains(null, BIG, view(0, 0)), false);
});

test('L6 (f): no window is larger than the viewport grown by the margin, including the longest worlds at 4x', () => {
  // wrong: a window the size of the extent; an unclipped inner zone; an unclamped view
  const cases = [
    BIG,
    layoutWorld(grids([255, 1]), BOX, 4),
    layoutWorld(grids([1, 255]), BOX, 4),
    layoutWorld(grids([127, 1], [1, 128]), BOX, 2)
  ];
  for (const layout of cases) {
    for (const [left, top] of [[0, 0], [5000, 0], [0, 5000], [100000, 100000], [3000, 3000]]) {
      for (const size of [[900, 520], [1920, 1080], [40, 40]]) {
        const v = view(left, top, size[0], size[1]);
        const w = worldWindow(layout, v, null);
        assert.ok(w.w * w.h <= (size[0] + 2 * WORLD_WINDOW_MARGIN) * (size[1] + 2 * WORLD_WINDOW_MARGIN), `${layout.width}x${layout.height} ${size}`);
        assert.ok(w.x >= 0 && w.y >= 0 && w.x + w.w <= layout.width && w.y + w.h <= layout.height, 'inside the extent');
        assert.ok(containsView(w, layout, v));
        assert.equal(w.w % 1, 0);
      }
    }
  }
});

test('L6 (g): a window left over from a larger viewport is not kept: the viewport shrank, so the window is recomputed to the bound', () => {
  // wrong: retention that checks coverage only (a smaller viewport stays covered by the huge window, so its canvases stay at the large allocation for good)
  const mixed = layoutWorld(grids([127, 1], [1, 128]), { width: 3800, height: 2100 }, 2);
  const large = worldWindow(BIG, view(0, 0, 3800, 2100), null);
  assert.deepEqual(large, win(0, 0, 4056, 2356), 'a 3,800 x 2,100 viewport grown by 256, clipped at the origin');
  assert.equal(large.w * large.h, 9555936);
  const small = view(0, 0, 500, 300);
  assert.equal(windowRetains(large, BIG, small), false, 'it covers the small viewport but is more than the margin larger than it');
  const next = worldWindow(BIG, small, large);
  assert.notEqual(next, large);
  assert.deepEqual(next, win(0, 0, 756, 556), 'the 500 x 300 viewport grown by 256, clipped at the origin');
  assert.ok(next.w * next.h <= (500 + 2 * WORLD_WINDOW_MARGIN) * (300 + 2 * WORLD_WINDOW_MARGIN), 'under the (w + 512) x (h + 512) bound: 821,744 px');
  assert.ok(containsView(next, BIG, small));
  // the bound is on size, not position: a window the right size is kept wherever the viewport is inside its zone
  assert.equal(worldWindow(BIG, view(100, 100, 500, 300), next), next);
  // one pixel past the bound on either axis is recomputed; exactly at it is kept
  assert.equal(windowRetains(win(0, 0, 500 + 512, 300 + 512), BIG, small), true, 'exactly the bound');
  assert.equal(windowRetains(win(0, 0, 500 + 513, 300 + 512), BIG, small), false, 'one pixel too wide');
  assert.equal(windowRetains(win(0, 0, 500 + 512, 300 + 513), BIG, small), false, 'one pixel too tall');
  // a window the previous (larger) viewport got, recomputed after a modest shrink, is never larger than the bound either
  const wide = worldWindow(mixed, view(0, 0, 1200, 800), null);
  const shrunk = worldWindow(mixed, view(0, 0, 900, 520), wide);
  assert.notEqual(shrunk, wide);
  assert.deepEqual(shrunk, win(0, 0, 1156, 776));
});

// ------------------------------------------------------------------------------------------------------------ markers

test('M-pick: a marker is centred on its pixel, kept inside its cell, and found by its own rectangle before the cell', () => {
  // wrong: a marker outside its cell at a corner; a hit-test that ignores the marker size; the cell answering where a marker sits
  const layout = layoutWorld(grids([2, 1]), BOX, 2);
  const cell = worldCellRect(layout, 0, 1);
  const size = worldMarkerSize(2);
  assert.equal(size, 9);
  const start = { kind: 'start', mapIndex: 0, screenIndex: 1, x: 112, y: 112 };
  const rect = worldMarkerRect(layout, start);
  assert.equal(rect.w, size);
  assert.equal(rect.x, cell.x + Math.round(((112 + 8) * 2) / 16 - 9 / 2), 'centred on the middle of the 16 x 16 thing at 112,112');
  const corner = worldMarkerRect(layout, { ...start, x: 0, y: 0 });
  assert.deepEqual([corner.x, corner.y], [cell.x, cell.y], 'a marker at 0,0 is held inside the cell');
  const far = worldMarkerRect(layout, { ...start, x: 240, y: 224 });
  assert.deepEqual([far.x + far.w, far.y + far.h], [cell.x + cell.w, cell.y + cell.h], 'and at 240,224');
  assert.equal(markerAt(layout, [start], rect.x + 1, rect.y + 1), start);
  assert.equal(markerAt(layout, [start], rect.x - 1, rect.y + 1), null);
  assert.equal(markerAt(layout, [start], rect.x + rect.w, rect.y + 1), null);
  const title = { kind: 'title', mapIndex: 0, screenIndex: 1, x: 112, y: 112 };
  assert.equal(markerAt(layout, [start, title], rect.x + 2, rect.y + 2), start, 'the first marker in priority order wins where two share a spot');
  assert.equal(worldMarkerRect(layout, { ...start, screenIndex: 9 }), null);
});

// ------------------------------------------------------------------------------------------------------------- E1

const golden = JSON.parse(fs.readFileSync(path.join(here, 'overview-golden.json'), 'utf8'));
const unpack = (values) => Object.fromEntries(golden.keys.map((key, i) => [key, values[i]]));
const decodeIndex = (index) => (index === 'NaN' ? NaN : index === 'undef' ? undefined : index);

test('E1: layoutOverview returns exactly the frozen value, scrollX and scrollY included, at every fit boundary', () => {
  // wrong: an extraction that changes the scale thresholds, the extent, a field name or the scroll flags (frozen from the code before the refactor)
  assert.ok(golden.layouts.length > 400);
  for (const [gridW, gridH, width, height, expected] of golden.layouts) {
    assert.deepEqual(layoutOverview(gridW, gridH, { width, height }), unpack(expected), `${gridW}x${gridH} in ${width}x${height}`);
  }
});

test('E1: gridLayoutAt carries layoutOverview\'s geometry fields and no flag', () => {
  // wrong: a gridLayoutAt that disagrees with layoutOverview about a cell size or an extent, or that smuggles in a box-dependent flag
  for (const [gridW, gridH, width, height] of golden.layouts) {
    const full = layoutOverview(gridW, gridH, { width, height });
    const geometry = gridLayoutAt(gridW, gridH, full.scale);
    const { scrollX, scrollY, ...rest } = full;
    assert.deepEqual(geometry, rest);
    assert.equal('scrollX' in geometry || 'scrollY' in geometry, false);
  }
  assert.equal(gridLayoutAt(3, 2, 2).gap, OVERVIEW_GAP);
  assert.equal(gridLayoutAt(3, 2, 2).pad, OVERVIEW_PAD);
});

test('E1: cellRect, cellAt, inView and scrollTarget answer exactly the frozen values over literal layouts', () => {
  // wrong: an extraction that moves a clamp, a rounding, the gap-inclusive visibility test, or the answer for an invalid index or a zero-size view
  let hits = 0;
  let views = 0;
  for (const entry of golden.cells) {
    const layout = unpack(entry.layout);
    for (const [index, rect] of entry.rects) assert.deepEqual(cellRect(layout, decodeIndex(index)), rect, `cellRect ${index}`);
    for (const [x, y, expected] of entry.hits) {
      assert.equal(cellAt(layout, x, y), expected, `cellAt ${x},${y}`);
      hits++;
    }
    for (const [index, left, top, width, height, visible, targetLeft, targetTop] of entry.views) {
      const v = { left, top, width, height };
      assert.equal(inView(layout, index, v), visible === 1, `inView ${index} @${left},${top} ${width}x${height}`);
      assert.deepEqual(scrollTarget(layout, index, v), { left: targetLeft, top: targetTop }, `scrollTarget ${index} @${left},${top} ${width}x${height}`);
      views++;
    }
  }
  assert.ok(hits > 3000 && views > 3000, `the table is not empty (${hits} hits, ${views} views)`);
});

// ------------------------------------------------------------------------------------------------------------- P1

test('P1: the pure World modules import only shared/ and their siblings and touch no DOM global', () => {
  // wrong: a pure module that reaches the DOM or the project state, which could not load under node:test and could write to the project
  const SIBLINGS = new Set(['./overview.js', './worldlayout.js', './worldmarkers.js']);
  for (const file of ['worldlayout.js', 'worldmarkers.js']) {
    const source = fs.readFileSync(path.join(here, '../../renderer/forges/map', file), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of code.matchAll(/from '([^']+)'/g)) assert.ok(m[1].startsWith('../../../shared/') || SIBLINGS.has(m[1]), `${file} imports ${m[1]}`);
    assert.doesNotMatch(code, /\b(document|window|localStorage|globalThis|navigator|getComputedStyle)\b/, `${file} is DOM-free`);
  }
});
