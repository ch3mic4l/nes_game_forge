// Starter monster: a fast, fragile flyer. Shares the "Creature" sprite
// palette with slime.js and skeleton.js -- the three entries declare the
// identical literal palette array on purpose, so importing all three in a
// row writes fresh colours once and exact-matches thereafter
// (design-starter-library.md §8.1/§8.3).
import { split16 } from '../authoring.js';

const CREATURE_PALETTE = [0x0f, 0x18, 0x28, 0x38];

const BAT = [
  '0011000000001100',
  '0111100000011110',
  '1112110000112111',
  '1112211001122111',
  '0112221111222110',
  '0011222222221100',
  '0001222222221000',
  '0000122222210000',
  '0000133223310000',
  '0000012332100000',
  '0000112222110000',
  '0001222222221000',
  '0011222002221100',
  '0111220000221110',
  '0110000000000110',
  '0000000000000000'
];

export default {
  kind: 'monster',
  name: 'Bat',
  license: { type: 'CC0-1.0', author: 'NES Game Forge' },
  palette: CREATURE_PALETTE,
  spriteTiles: split16(BAT),
  metasprite: {
    tiles: [
      { x: 0, y: 0, tile: 0, hflip: false, vflip: false },
      { x: 8, y: 0, tile: 1, hflip: false, vflip: false },
      { x: 0, y: 8, tile: 2, hflip: false, vflip: false },
      { x: 8, y: 8, tile: 3, hflip: false, vflip: false }
    ]
  },
  hp: 3,
  speed: 4,
  damage: 1,
  battle: {
    atk: 3, def: 0, acc: 190, eva: 12, speed: 8, mp: 0, xp: 3, gold: 1,
    weak: 'light', strong: 'wind', dropPct: 10, heal: 0
  }
};
