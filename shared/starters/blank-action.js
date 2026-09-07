// The "Blank action" catalog entry (docs/design-starter-projects.md §4).
// `build` is exactly what createProject already does for an action project --
// no wrapper logic, no post-processing -- so this entry is byte-for-byte
// identical to today's chooseGameType()-driven "action" choice.
import { createProject } from '../project.js';

export default {
  id: 'blank-action',
  label: 'Blank action',
  hint: 'An empty action-adventure project, starting on NROM.',
  gameType: 'action',
  build: (name) => createProject(name, 'action')
};
