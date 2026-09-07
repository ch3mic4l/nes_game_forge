// Starter monster: a slow, sturdy blob. Shares the "Creature" sprite palette
// with bat.js and skeleton.js -- the three entries declare the identical
// literal palette array on purpose, so importing all three in a row writes
// fresh colours once and exact-matches thereafter
// (design-starter-library.md §8.1/§8.3).
import { split16 } from '../authoring.js';

const CREATURE_PALETTE = [0x0f, 0x18, 0x28, 0x38];

// A flatter, wider blob with two dot eyes and a drip point at the bottom --
// deliberately a different silhouette from a simple rounded circle, so none
// of its 4 tiles collides with sample/'s or sample-rpg/'s own sprite tables
// (both fixtures already carry a plain rounded slime of their own).
const SLIME = [
  '0000000000000000',
  '0001111111111000',
  '0113322222331100',
  '0133222222223310',
  '1332211221123310',
  '1322211221122310',
  '1322222222222310',
  '1322233333222310',
  '1322222222222310',
  '0132222222223100',
  '0013222222231000',
  '0001333333310000',
  '0000133333100000',
  '0000011111000000',
  '0000001110000000',
  '0000000000000000'
];

export default {
  kind: 'monster',
  name: 'Slime',
  license: { type: 'CC0-1.0', author: 'NES Game Forge' },
  palette: CREATURE_PALETTE,
  spriteTiles: split16(SLIME),
  metasprite: {
    tiles: [
      { x: 0, y: 0, tile: 0, hflip: false, vflip: false },
      { x: 8, y: 0, tile: 1, hflip: false, vflip: false },
      { x: 0, y: 8, tile: 2, hflip: false, vflip: false },
      { x: 8, y: 8, tile: 3, hflip: false, vflip: false }
    ]
  },
  hp: 5,
  speed: 1,
  damage: 1,
  battle: {
    atk: 4, def: 1, acc: 170, eva: 2, speed: 2, mp: 0, xp: 4, gold: 2,
    weak: 'fire', strong: 'ice', dropPct: 20, heal: 0
  }
};
