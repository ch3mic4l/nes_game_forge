// Starter terrain: an open grass field plus a diagonal edge tile so an
// author can border it against open space. Shares the "Nature" background
// palette with dirt-path.js and shallow-water.js -- the three entries
// declare the identical literal palette array on purpose, so importing all
// three in a row writes fresh colours once and exact-matches thereafter
// (design-starter-library.md §8.1/§8.3).
import { tile, split16 } from '../authoring.js';

const NATURE_PALETTE = [0x0f, 0x1a, 0x2a, 0x30];

const PLAIN = ['11112111', '11111111', '11211111', '11111112', '12111111', '11111211', '11111111', '11121111'];

// A soft diagonal boundary: open (0) in the top-left corner, a highlighted
// seam (3, 2 cells wide starting at row+col 13), then filled grass (1, with
// 2 as an occasional speckle) toward the bottom-right -- a generic "this is
// where the terrain ends" shape. The speckle coefficients (3, 7) are
// deliberately not equal and not a multiple-of-5 pair once the top-right/
// bottom-left quadrants' own +8 row/column offset is folded in -- an
// earlier (r*16+c) % 5 version put the identical speckle value in both
// quadrants (the offset between them, 120, is itself a multiple of 5),
// silently duplicating one whole tile. dirt-path.js and shallow-water.js
// each use their own, different open/seam thresholds (a plausible per-
// biome difference in how wide the transition band is) rather than this
// same 13/15 pair, since the top-left quadrant (row+col <= 14) never
// reaches the filled region at all, and three identical thresholds meant
// three files sharing one byte-identical top-left tile.
function edgeRows() {
  const rows = [];
  for (let r = 0; r < 16; r++) {
    let row = '';
    for (let c = 0; c < 16; c++) {
      const d = r + c;
      if (d < 13) row += '0';
      else if (d < 15) row += '3';
      else row += (r * 3 + c * 7) % 5 === 0 ? '2' : '1';
    }
    rows.push(row);
  }
  return rows;
}

const EDGE_QUADRANTS = split16(edgeRows());

export default {
  kind: 'terrain',
  name: 'Grass Plains',
  license: { type: 'CC0-1.0', author: 'NES Game Forge' },
  palette: NATURE_PALETTE,
  tiles: [tile(PLAIN), ...EDGE_QUADRANTS],
  metatiles: [
    { name: 'Grass Plain', tiles: [0, 0, 0, 0], collision: 'open' },
    { name: 'Grass Edge', tiles: [1, 2, 3, 4], collision: 'open' }
  ]
};
