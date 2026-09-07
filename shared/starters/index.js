// The whole starter catalog (docs/design-starter-projects.md §3.2): one flat
// manifest array, the single writer both the renderer's picker and
// main/project-io.js's createProjectAt read from. Phase 1 ships only the two
// blank entries; later phases append one entry each for the overworld,
// dungeon and RPG starters -- nothing about this array's own shape changes
// when they do.
import blankAction from './blank-action.js';
import blankRpg from './blank-rpg.js';

export const STARTERS = [blankAction, blankRpg];
