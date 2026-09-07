// Starter monster: a slow, hard-hitting undead. Shares the "Creature"
// sprite palette with slime.js and bat.js -- the three entries declare the
// identical literal palette array on purpose, so importing all three in a
// row writes fresh colours once and exact-matches thereafter
// (design-starter-library.md §8.1/§8.3).
import { split16 } from '../authoring.js';

const CREATURE_PALETTE = [0x0f, 0x18, 0x28, 0x38];

const SKELETON = [
  '0001111111110000',
  '0011222222221100',
  '0112222222222110',
  '0122211221122210',
  '0122211221122210',
  '0122222222222210',
  '0112223333222110',
  '0011222332221100',
  '0000112222110000',
  '0000011111100000',
  '0001133333311000',
  '0011133333311100',
  '0011113333111100',
  '0111111111111110',
  '0011113333111100',
  '0001111111111000'
];

export default {
  kind: 'monster',
  name: 'Skeleton',
  license: { type: 'CC0-1.0', author: 'NES Game Forge' },
  palette: CREATURE_PALETTE,
  spriteTiles: split16(SKELETON),
  metasprite: {
    tiles: [
      { x: 0, y: 0, tile: 0, hflip: false, vflip: false },
      { x: 8, y: 0, tile: 1, hflip: false, vflip: false },
      { x: 0, y: 8, tile: 2, hflip: false, vflip: false },
      { x: 8, y: 8, tile: 3, hflip: false, vflip: false }
    ]
  },
  hp: 8,
  speed: 1,
  damage: 2,
  battle: {
    atk: 7, def: 3, acc: 175, eva: 1, speed: 1, mp: 0, xp: 7, gold: 3,
    weak: 'holy', strong: 'earth', dropPct: 25, heal: 0
  }
};
