// The "Blank RPG" catalog entry (docs/design-starter-projects.md §4). `build`
// is exactly what createProject already does for an rpg project -- no
// wrapper logic, no post-processing -- so this entry is byte-for-byte
// identical to today's chooseGameType()-driven "rpg" choice. The mapper
// sentence used to live in chooseGameType's own fixed footer
// (renderer/app.js, the old chooseGameType); design §8.1 moves it onto this
// starter's own hint, since there is no longer a single footer shared by
// only two choices.
import { createProject } from '../project.js';
import { RPG_DEFAULT_MAPPER, mapperById } from '../cartridge.js';

export default {
  id: 'blank-rpg',
  label: 'Blank RPG',
  hint:
    `An empty turn-based RPG project, starting on ${mapperById(RPG_DEFAULT_MAPPER).name}, because its ` +
    'battle system needs a cartridge that can switch program banks.',
  gameType: 'rpg',
  build: (name) => createProject(name, 'rpg')
};
