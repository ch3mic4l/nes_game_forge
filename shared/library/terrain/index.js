// The terrain slice of the starter library (design-starter-library.md §8.1).
// The top-level shared/library/index.js aggregates this alongside monster/
// pickup/sfx/song into LIBRARY_ENTRIES.
import grassPlains from './grass-plains.js';
import dirtPath from './dirt-path.js';
import shallowWater from './shallow-water.js';
import stoneFloor from './stone-floor.js';
import woodPlanks from './wood-planks.js';

export const TERRAIN_ENTRIES = [grassPlains, dirtPath, shallowWater, stoneFloor, woodPlanks];
