// Starter pickup: a door key. Shares the "Item" sprite palette with coin.js,
// potion.js and scroll.js -- the four entries declare the identical literal
// palette array on purpose, so importing all four in a row writes fresh
// colours once and exact-matches thereafter (design-starter-library.md
// §8.1/§8.3). No item is written by importing this entry (§2.3) -- bind the
// resulting actor to an item with the Items Forge's own "Collected from"
// control.
import { split16 } from '../authoring.js';

const ITEM_PALETTE = [0x0f, 0x06, 0x16, 0x26];

const KEY = [
  '0000111111000000',
  '0001222222100000',
  '0012233332210000',
  '0012233332210000',
  '0012233332210000',
  '0001222221000000',
  '0000011110000000',
  '0000001111000000',
  '0000000111000000',
  '0000000111100000',
  '0000000111000000',
  '0000000111100000',
  '0000000111000000',
  '0000000111311000',
  '0000000111111000',
  '0000000000000000'
];

export default {
  kind: 'pickup',
  name: 'Key',
  license: { type: 'CC0-1.0', author: 'NES Game Forge' },
  palette: ITEM_PALETTE,
  spriteTiles: split16(KEY),
  metasprite: {
    tiles: [
      { x: 0, y: 0, tile: 0, hflip: false, vflip: false },
      { x: 8, y: 0, tile: 1, hflip: false, vflip: false },
      { x: 0, y: 8, tile: 2, hflip: false, vflip: false },
      { x: 8, y: 8, tile: 3, hflip: false, vflip: false }
    ]
  },
  hp: 1,
  speed: 1,
  damage: 0,
  battle: {
    atk: 0, def: 0, acc: 0, eva: 0, speed: 0, mp: 0, xp: 0, gold: 0,
    weak: 'none', strong: 'none', dropPct: 0, heal: 0
  }
};
