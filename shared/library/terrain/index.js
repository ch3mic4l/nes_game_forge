// The terrain slice of the starter library (design-starter-library.md §8.1).
// A terrain-only manifest for this phase -- the top-level
// shared/library/index.js aggregating every kind waits until monster/
// pickup/sfx/song exist too (phases 5-6).
import grassPlains from './grass-plains.js';
import dirtPath from './dirt-path.js';
import shallowWater from './shallow-water.js';
import stoneFloor from './stone-floor.js';
import woodPlanks from './wood-planks.js';

export const TERRAIN_ENTRIES = [grassPlains, dirtPath, shallowWater, stoneFloor, woodPlanks];
