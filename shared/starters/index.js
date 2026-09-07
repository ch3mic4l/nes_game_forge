// The whole starter catalog (docs/design-starter-projects.md §3.2): one flat
// manifest array, the single writer both the renderer's picker and
// main/project-io.js's createProjectAt read from. Phase 2 adds the overworld
// content starter beside the two blanks; the dungeon and RPG starters follow
// in later phases -- nothing about this array's own shape changes when they
// do.
import blankAction from './blank-action.js';
import blankRpg from './blank-rpg.js';
import overworld from './overworld.js';

export const STARTERS = [blankAction, blankRpg, overworld];
