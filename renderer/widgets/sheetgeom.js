// Pure integer geometry for a pattern-table sheet's own tile grid. Zero
// imports, zero DOM references anywhere in this file -- the CLAUDE.md-
// documented shape a node:test-importable renderer helper needs (the same
// shape gif.js/capture.js already hold to: "DOM-free and Node-free...
// node:test imports them directly"). renderer/widgets/sheet.js does not
// qualify for that today (document.createElement sits inside drawSheet's own
// function body, not at module scope), and shared/ is reserved for the
// project-data model, not sheet-grid geometry with no project-domain meaning
// -- see docs/design-draw-validation.md §3.4.

/**
 * Decompose a half-open tile-index range [start, end) on a `cols`-wide sheet
 * into the minimal set of cell rectangles covering it. Collapses to one
 * rectangle when the whole range sits in a single row, merges every
 * consecutive whole row (including a first or last row that happens to be
 * whole) into one taller rectangle, and returns [] when `end <= start`.
 */
export function reservedRangeRects(start, end, cols) {
  if (end <= start) return [];
  const segments = [];
  let i = start;
  while (i < end) {
    const row = Math.floor(i / cols);
    const rowStart = row * cols;
    const rowEnd = rowStart + cols;
    const segEnd = Math.min(end, rowEnd);
    segments.push({ row, col: i - rowStart, cols: segEnd - i });
    i = segEnd;
  }
  const rects = [];
  for (const seg of segments) {
    const full = seg.col === 0 && seg.cols === cols;
    const prev = rects[rects.length - 1];
    if (full && prev && prev.col === 0 && prev.cols === cols && prev.row + prev.rows === seg.row) {
      prev.rows += 1;
    } else {
      rects.push({ col: seg.col, row: seg.row, cols: seg.cols, rows: 1 });
    }
  }
  return rects;
}
