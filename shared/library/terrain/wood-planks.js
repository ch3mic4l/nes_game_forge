// Starter terrain: an indoor wood-plank floor plus a corner-border edge
// tile. Shares the "Built" background palette with stone-floor.js -- see
// that file's own header for why the palette array is a deliberately
// identical literal across the two.
import { tile, split16 } from '../authoring.js';

const BUILT_PALETTE = [0x0f, 0x00, 0x10, 0x20];

const PLAIN = ['11111111', '11131111', '22222222', '11111111', '11111111', '22222222', '11111111', '11111111'];

// The same "L" shaped corner border stone-floor.js uses, but a checkerboard
// grout fill rather than a fixed 4-pixel grid, so the two entries' art
// stays visually distinct even though both draw from the identical shared
// "Built" palette.
function edgeRows() {
  const rows = [];
  for (let r = 0; r < 16; r++) {
    let row = '';
    for (let c = 0; c < 16; c++) {
      if (r < 2 || c < 2) row += '0';
      else if (r === 2 || c === 2) row += '3';
      else row += (r + c) % 2 === 0 ? '1' : '2';
    }
    rows.push(row);
  }
  return rows;
}

const EDGE_QUADRANTS = split16(edgeRows());

export default {
  kind: 'terrain',
  name: 'Wood Planks',
  license: { type: 'CC0-1.0', author: 'NES Game Forge' },
  palette: BUILT_PALETTE,
  tiles: [tile(PLAIN), ...EDGE_QUADRANTS],
  metatiles: [
    { name: 'Wood Planks Plain', tiles: [0, 0, 0, 0], collision: 'open' },
    { name: 'Wood Planks Edge', tiles: [1, 2, 3, 4], collision: 'open' }
  ]
};
