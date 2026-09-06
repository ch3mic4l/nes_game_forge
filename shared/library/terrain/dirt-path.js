// Starter terrain: a walkable dirt path plus a diagonal edge tile. Shares
// the "Nature" background palette with grass-plains.js and
// shallow-water.js -- see that file's own header for why the palette array
// is a deliberately identical literal across the three (design-starter-
// library.md §8.1/§8.3).
import { tile, split16 } from '../authoring.js';

const NATURE_PALETTE = [0x0f, 0x1a, 0x2a, 0x30];

const PLAIN = ['11111111', '12111211', '11111111', '11211112', '11111111', '12111111', '11112111', '11111111'];

// The same diagonal-boundary shape grass-plains.js uses -- open in the
// top-left corner, a highlighted seam, filled ground toward the
// bottom-right -- but a checkerboard-like fill rather than grass's sparse
// speckle, so the two entries' art stays visually distinct even though
// both draw from the identical shared "Nature" palette. Plain (r+c) % 2
// depends only on the SUM of row and column, which is exactly what the
// top-right/bottom-left quadrants' own +8 row/column swap preserves --
// that degenerate case duplicated one whole tile (grass-plains.js's own
// header explains the general shape of the bug); the coefficients here (2,
// 3) are deliberately unequal so the swap changes the result. The open/seam
// thresholds (12/14, one row earlier than grass's 13/15 -- a narrower open
// corner, a plausible dirt-path-specific difference in how quickly the
// ground shows through) are also deliberately not grass's own 13/15: the
// top-left quadrant never reaches the filled region at all, so without a
// distinct threshold here too, every Nature-palette entry's own top-left
// edge tile would be byte-identical (grass-plains.js's header explains why
// that matters for the whole catalog's own distinct-tile count).
function edgeRows() {
  const rows = [];
  for (let r = 0; r < 16; r++) {
    let row = '';
    for (let c = 0; c < 16; c++) {
      const d = r + c;
      if (d < 12) row += '0';
      else if (d < 14) row += '3';
      else row += (r * 2 + c * 3) % 3 === 0 ? '2' : '1';
    }
    rows.push(row);
  }
  return rows;
}

const EDGE_QUADRANTS = split16(edgeRows());

export default {
  kind: 'terrain',
  name: 'Dirt Path',
  license: { type: 'CC0-1.0', author: 'NES Game Forge' },
  palette: NATURE_PALETTE,
  tiles: [tile(PLAIN), ...EDGE_QUADRANTS],
  metatiles: [
    { name: 'Dirt Plain', tiles: [0, 0, 0, 0], collision: 'open' },
    { name: 'Dirt Edge', tiles: [1, 2, 3, 4], collision: 'open' }
  ]
};
