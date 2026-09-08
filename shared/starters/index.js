// The whole starter catalog (docs/design-starter-projects.md §3.2): one flat
// manifest array, the single writer both the renderer's picker and
// main/project-io.js's createProjectAt read from. Phase 2 added the
// overworld content starter beside the two blanks; phase 3 adds the dungeon
// crawl starter here; the RPG starter follows in a later phase -- nothing
// about this array's own shape changes when it does.
import blankAction from './blank-action.js';
import blankRpg from './blank-rpg.js';
import overworld from './overworld.js';
import dungeon from './dungeon.js';

export const STARTERS = [blankAction, blankRpg, overworld, dungeon];
