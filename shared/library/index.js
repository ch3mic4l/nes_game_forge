// The whole starter library (design-starter-library.md §4): one flat manifest
// array, in fixed order -- terrain, monster, pickup, sfx, song -- each kind's
// own index order preserved within that. Every Forge picker and every test
// iterates this array rather than any one kind's own index.
import { TERRAIN_ENTRIES } from './terrain/index.js';
import { MONSTER_ENTRIES } from './monster/index.js';
import { PICKUP_ENTRIES } from './pickup/index.js';
import { SFX_ENTRIES } from './sfx/index.js';
import { SONG_ENTRIES } from './song/index.js';

export const LIBRARY_ENTRIES = [
  ...TERRAIN_ENTRIES,
  ...MONSTER_ENTRIES,
  ...PICKUP_ENTRIES,
  ...SFX_ENTRIES,
  ...SONG_ENTRIES
];
