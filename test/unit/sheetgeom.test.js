// ROADMAP item 8 (validate-as-you-draw), Phase 4 -- docs/design-draw-validation.md
// §3.4/§7. reservedRangeRects is pure, DOM-free geometry (renderer/widgets/
// sheetgeom.js), so it is tested directly here rather than through any
// rendering code.

import test from 'node:test';
import assert from 'node:assert/strict';
import { reservedRangeRects } from '../../renderer/widgets/sheetgeom.js';

const COLS = 16;

test('reservedRangeRects: an empty range (end <= start) returns []', () => {
  assert.deepEqual(reservedRangeRects(10, 10, COLS), []);
  assert.deepEqual(reservedRangeRects(10, 5, COLS), []);
});

test('reservedRangeRects: a same-row partial range returns one rectangle narrower than the sheet', () => {
  // [10, 14) sits entirely inside row 0 -- caught: an implementation that
  // always returns a full-width rectangle regardless of how much of the row
  // the range actually covers.
  assert.deepEqual(reservedRangeRects(10, 14, COLS), [{ col: 10, row: 0, cols: 4, rows: 1 }]);
});

test('reservedRangeRects: a row-aligned range merges every whole row into one rectangle, not one per row', () => {
  // [0, 32) at cols=16 is exactly two whole rows (the player range) --
  // caught: emitting one rectangle per whole row instead of merging
  // consecutive whole rows into a single taller rectangle.
  assert.deepEqual(reservedRangeRects(0, 32, COLS), [{ col: 0, row: 0, cols: 16, rows: 2 }]);
});

test('reservedRangeRects: the font range [160, 256) merges its six whole rows into one rectangle', () => {
  assert.deepEqual(reservedRangeRects(160, 256, COLS), [{ col: 0, row: 10, cols: 16, rows: 6 }]);
});

test('reservedRangeRects: partial-first/partial-last -- [10, 40) at cols=16 produces three rectangles, not one merged block', () => {
  // caught: merging the partial first/last rows into the whole middle row's
  // own rectangle (which would silently shade columns 0-9 of row 0 and
  // columns 8-15 of row 2 that the range does not actually cover), or
  // dropping the partial rows entirely and returning only the whole one.
  assert.deepEqual(reservedRangeRects(10, 40, COLS), [
    { col: 10, row: 0, cols: 6, rows: 1 },
    { col: 0, row: 1, cols: 16, rows: 1 },
    { col: 0, row: 2, cols: 8, rows: 1 }
  ]);
});

test('reservedRangeRects: a single reserved cell -- [253, 254) (the $FD cursor) -- is one 1x1 rectangle', () => {
  assert.deepEqual(reservedRangeRects(253, 254, COLS), [{ col: 13, row: 15, cols: 1, rows: 1 }]);
});

test('reservedRangeRects: the last two columns of the last row -- [254, 256) (the $FE-$FF hearts) -- is one 2-wide, 1-tall rectangle', () => {
  assert.deepEqual(reservedRangeRects(254, 256, COLS), [{ col: 14, row: 15, cols: 2, rows: 1 }]);
});

test('reservedRangeRects: multi-row -- three or more whole rows plus a partial tail merges every whole row into one rectangle and keeps the tail separate', () => {
  // [0, 56) at cols=16: rows 0-2 are whole (48 tiles), row 3 holds the
  // remaining 8 tiles (56 - 48) as a partial tail -- caught: merging the
  // partial tail into the whole-row rectangle (which would over-shade
  // columns 8-15 of row 3), or failing to merge the three whole rows
  // together (returning three separate 1-row rectangles instead of one
  // 3-row rectangle).
  assert.deepEqual(reservedRangeRects(0, 56, COLS), [
    { col: 0, row: 0, cols: 16, rows: 3 },
    { col: 0, row: 3, cols: 8, rows: 1 }
  ]);
});

test('reservedRangeRects: a whole first row followed by a partial second row does NOT merge -- only a run of consecutive WHOLE rows merges', () => {
  // [0, 20) at cols=16: row 0 is whole, row 1 is partial (cols 0-3 only) --
  // caught: merging a partial row into the preceding whole row's rectangle,
  // which would grow its own `rows` count while silently widening its
  // shaded area past what the range actually covers.
  assert.deepEqual(reservedRangeRects(0, 20, COLS), [
    { col: 0, row: 0, cols: 16, rows: 1 },
    { col: 0, row: 1, cols: 4, rows: 1 }
  ]);
});
