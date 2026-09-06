// Starter terrain: shallow, walkable-but-wet water plus a diagonal edge
// tile. Shares the "Nature" background palette with grass-plains.js and
// dirt-path.js (design-starter-library.md §8.1/§8.3); collision: 'water'
// is what actually marks this set as water, since the shared palette gives
// it no colour of its own to be recognised by.
import { tile, split16 } from '../authoring.js';

const NATURE_PALETTE = [0x0f, 0x1a, 0x2a, 0x30];

const PLAIN = ['11111111', '22222222', '11111111', '11113111', '11111111', '22222222', '11111111', '11111111'];

// The same diagonal-boundary shape the other two Nature-palette entries
// use, but a horizontal ripple fill (varying by row, not by diagonal
// position) so this one reads as water rather than ground. A plain `r % 2`
// repeats with period 2, which the top-right/bottom-left quadrants' own
// +8 row offset preserves exactly (8 is even) -- the same degenerate case
// grass-plains.js's own header explains; folding in a column term broken
// into 3-wide bands keeps the ripple look while breaking that symmetry.
// The open/seam thresholds (14/16, one row later than grass's 13/15 -- a
// wider open corner, a plausible water-specific difference: the shoreline
// reaches further in before the water itself shows) are also deliberately
// not grass's or dirt's own pair, for the identical reason dirt-path.js's
// header states: the top-left quadrant never reaches the filled region, so
// a shared threshold would leave every Nature-palette entry's own top-left
// edge tile byte-identical.
function edgeRows() {
  const rows = [];
  for (let r = 0; r < 16; r++) {
    let row = '';
    for (let c = 0; c < 16; c++) {
      const d = r + c;
      if (d < 14) row += '0';
      else if (d < 16) row += '3';
      else row += (r + Math.floor(c / 3)) % 2 === 0 ? '2' : '1';
    }
    rows.push(row);
  }
  return rows;
}

const EDGE_QUADRANTS = split16(edgeRows());

export default {
  kind: 'terrain',
  name: 'Shallow Water',
  license: { type: 'CC0-1.0', author: 'NES Game Forge' },
  palette: NATURE_PALETTE,
  tiles: [tile(PLAIN), ...EDGE_QUADRANTS],
  metatiles: [
    { name: 'Shallow Water Plain', tiles: [0, 0, 0, 0], collision: 'water' },
    { name: 'Shallow Water Edge', tiles: [1, 2, 3, 4], collision: 'water' }
  ]
};
