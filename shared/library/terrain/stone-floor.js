// Starter terrain: an indoor stone floor plus a corner-border edge tile.
// Shares the "Built" background palette with wood-planks.js -- the two
// entries declare the identical literal palette array on purpose, the same
// shared-palette pairing grass-plains.js documents for the Nature group
// (design-starter-library.md §8.1/§8.3).
import { tile, split16 } from '../authoring.js';

const BUILT_PALETTE = [0x0f, 0x00, 0x10, 0x20];

const PLAIN = ['11111111', '12121212', '11111111', '21212121', '11111111', '12121212', '11111111', '21212121'];

// An architectural corner: open outside the floor (0), a border line (3)
// two pixels in, then a gridded floor (1, with 2 marking the grout lines
// every 4 pixels) -- an "L" shaped border rather than the open terrains'
// diagonal, since a floor's own edge is a wall, not a soft boundary.
function edgeRows() {
  const rows = [];
  for (let r = 0; r < 16; r++) {
    let row = '';
    for (let c = 0; c < 16; c++) {
      if (r < 2 || c < 2) row += '0';
      else if (r === 2 || c === 2) row += '3';
      else row += r % 4 === 0 || c % 4 === 0 ? '2' : '1';
    }
    rows.push(row);
  }
  return rows;
}

const EDGE_QUADRANTS = split16(edgeRows());

export default {
  kind: 'terrain',
  name: 'Stone Floor',
  license: { type: 'CC0-1.0', author: 'NES Game Forge' },
  palette: BUILT_PALETTE,
  tiles: [tile(PLAIN), ...EDGE_QUADRANTS],
  metatiles: [
    { name: 'Stone Floor Plain', tiles: [0, 0, 0, 0], collision: 'open' },
    { name: 'Stone Floor Edge', tiles: [1, 2, 3, 4], collision: 'open' }
  ]
};
