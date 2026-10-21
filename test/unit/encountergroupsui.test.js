// Encounter groups, slice C3: the Monster Forge "Groups" tab's pure logic (shared/encountergroups.js) -- the editing
// moves the UI makes inside one store.commit, the 32-group limit, the delete renumber, and the actor-delete prompt's N.
// The renderer itself needs a window; main/smoke.js drives it. Everything the tab *decides* is tested here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../renderer/store.js';
import {
  AUTHOR_NAME_MAX,
  RPG_LIMITS,
  createProject,
  monsterActorIds,
  normalizeProject,
  renumberActorDeletion
} from '../../shared/project.js';
import {
  applyAddGroup,
  cleanGroupName,
  commitGroupRename,
  deleteEncounterGroup,
  groupProblems,
  groupRoom,
  groupSlotOptions,
  groupsNamingActor,
  mapsUsingGroup,
  planAddGroup,
  renameGroup,
  setGroupMonster
} from '../../shared/encountergroups.js';

const actor = (name, damage) => ({ name, behavior: damage ? 'monster' : 'wander', hp: 5, damage });

/** An RPG with Slime(0), Bat(1), Rock(2, harmless), two maps and three groups; map 0 is group-mode. */
function fixture() {
  const project = createProject('Groups', 'rpg');
  project.sprites.actors = [actor('Slime', 1), actor('Bat', 1), actor('Rock', 0)];
  project.encounterGroups = [
    { name: 'Pack', monsters: [0, 0, 1] },
    { name: 'Rocks', monsters: [2] },
    { name: 'Bats', monsters: [1, 1] }
  ];
  project.maps.push({ ...structuredClone(project.maps[0]), id: 1, name: 'Cave' });
  project.maps[0].encounters = { rate: 4, actorIds: [0], mode: 'groups', table: [{ group: 0, weight: 2 }, { group: 2, weight: 5 }] };
  project.maps[1].encounters = { rate: 4, actorIds: [], mode: 'groups', table: [{ group: 2, weight: 1 }] };
  return project;
}

test('cleanGroupName is the name rule normalizeProject applies on load (no drift)', () => {
  for (const raw of ['  Slime   pack ', 'x'.repeat(AUTHOR_NAME_MAX + 9), 'Tab\tand\nnewline', 'ok']) {
    const project = fixture();
    project.encounterGroups[0].name = raw;
    assert.equal(cleanGroupName(raw), normalizeProject(structuredClone(project)).encounterGroups[0].name, JSON.stringify(raw));
  }
  assert.equal(cleanGroupName('   '), '');
  assert.equal(cleanGroupName(undefined), '');
});

test('the 32-group limit: the plan refuses at the limit with the limit named, one below it still plans', () => {
  const project = fixture();
  project.encounterGroups = Array.from({ length: RPG_LIMITS.encounterGroups - 1 }, (_, i) => ({ name: `G${i}`, monsters: [] }));
  assert.equal(groupRoom(project).full, false);
  const plan = planAddGroup(project);
  assert.equal(plan.ok, true);
  applyAddGroup(project, plan);
  assert.equal(project.encounterGroups.length, RPG_LIMITS.encounterGroups);
  assert.deepEqual([groupRoom(project).full, groupRoom(project).count, groupRoom(project).limit], [true, 32, 32]);
  const refused = planAddGroup(project);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /at most 32 encounter groups/);
  assert.equal(planAddGroup(project, 0).ok, false, 'a duplicate counts toward the limit too');
  assert.equal(project.encounterGroups.length, 32, 'a refusal changes nothing');
});

test('a refused add never reaches store.commit; an accepted one is one undoable commit', () => {
  const project = fixture();
  project.encounterGroups = Array.from({ length: 32 }, (_, i) => ({ name: `G${i}`, monsters: [] }));
  const store = new Store();
  store.open('/tmp/groups', project);
  const before = [store.revision, store.undoStack.length, store.dirty];
  assert.equal(planAddGroup(store.project).ok, false);
  assert.deepEqual([store.revision, store.undoStack.length, store.dirty], before);

  const small = new Store();
  small.open('/tmp/groups', fixture());
  const plan = planAddGroup(small.project);
  small.commit('Add encounter group', (draft) => applyAddGroup(draft, plan));
  assert.equal(small.project.encounterGroups.length, 4);
  assert.equal(small.undoStack.length, 1);
  small.undo();
  assert.equal(small.project.encounterGroups.length, 3);
  small.redo();
  assert.deepEqual(small.project.encounterGroups[3], { name: 'Group 1', monsters: [] });
});

test('new group names are the first unused "Group N"; a duplicate copies the monsters and is its own array', () => {
  const project = fixture();
  assert.equal(planAddGroup(project).group.name, 'Group 1');
  project.encounterGroups.push({ name: 'Group 1', monsters: [] }, { name: 'Group 2', monsters: [] });
  assert.equal(planAddGroup(project).group.name, 'Group 3');
  const copy = planAddGroup(project, 0);
  assert.deepEqual(copy.group, { name: 'Pack copy', monsters: [0, 0, 1] });
  assert.notEqual(copy.group.monsters, project.encounterGroups[0].monsters);
  assert.equal(planAddGroup(project, 99).ok, false);
  const long = fixture();
  long.encounterGroups[0].name = 'n'.repeat(AUTHOR_NAME_MAX);
  assert.equal(planAddGroup(long, 0).group.name.length, AUTHOR_NAME_MAX);
});

test('rename: collapses whitespace, caps the length, and leaves an empty or unchanged name alone', () => {
  const project = fixture();
  assert.equal(renameGroup(project, 0, '  Big   pack '), true);
  assert.equal(project.encounterGroups[0].name, 'Big pack');
  assert.equal(renameGroup(project, 0, 'Big pack'), false);
  assert.equal(renameGroup(project, 0, '   '), false);
  assert.equal(project.encounterGroups[0].name, 'Big pack');
  assert.equal(renameGroup(project, 0, 'z'.repeat(80)), true);
  assert.equal(project.encounterGroups[0].name.length, AUTHOR_NAME_MAX);
  assert.equal(renameGroup(project, 9, 'nope'), false);
});

test('commitGroupRename: blank, normalized-unchanged and absent-target renames never reach store.commit', () => {
  const store = new Store();
  store.open('/tmp/groups', fixture());
  // Build a redo stack: one real edit, undone, so a phantom commit would visibly destroy it.
  assert.equal(commitGroupRename(store, 1, 'Boulders'), true);
  store.undo();
  assert.equal(store.redoStack.length, 1);
  const snapshot = () => ({
    project: structuredClone(store.project),
    dirty: store.dirty,
    revision: store.revision,
    undo: store.undoStack.length,
    redo: store.redoStack.length
  });
  const before = snapshot();
  let commits = 0;
  const realCommit = store.commit.bind(store);
  store.commit = (...args) => {
    commits++;
    return realCommit(...args);
  };
  for (const [index, raw] of [[0, '   '], [0, ''], [0, undefined], [0, 'Pack'], [0, '  Pack  '], [0, 'Pack'.padEnd(40, ' ')], [9, 'Nope'], [-1, 'Nope']]) {
    assert.equal(commitGroupRename(store, index, raw), false, JSON.stringify([index, raw]));
  }
  assert.equal(commits, 0, 'store.commit was never called');
  assert.deepEqual(snapshot(), before, 'project data, dirty, revision, undo stack and the existing redo stack are unchanged');
});

test('commitGroupRename: a real rename is one commit that undoes and redoes', () => {
  const store = new Store();
  store.open('/tmp/groups', fixture());
  const [undo, revision] = [store.undoStack.length, store.revision];
  assert.equal(commitGroupRename(store, 0, '  Big   pack '), true);
  assert.equal(store.project.encounterGroups[0].name, 'Big pack');
  assert.deepEqual([store.undoStack.length, store.revision, store.dirty], [undo + 1, revision + 1, true]);
  store.undo();
  assert.equal(store.project.encounterGroups[0].name, 'Pack');
  store.redo();
  assert.equal(store.project.encounterGroups[0].name, 'Big pack');
});

test('monster slots: append, replace, clear closes the gap, at most four, duplicates legal', () => {
  const project = fixture();
  const monsters = () => project.encounterGroups[1].monsters;
  assert.deepEqual(monsters(), [2]);
  assert.equal(setGroupMonster(project, 1, 1, 0), true);
  assert.equal(setGroupMonster(project, 1, 2, 0), true);
  assert.deepEqual(monsters(), [2, 0, 0], 'a duplicate is a legal group');
  assert.equal(setGroupMonster(project, 1, 3, 1), true);
  assert.deepEqual(monsters(), [2, 0, 0, 1]);
  assert.equal(setGroupMonster(project, 1, 4, 1), false, 'there is no fifth slot');
  assert.deepEqual(monsters(), [2, 0, 0, 1]);
  assert.equal(setGroupMonster(project, 1, 0, 1), true);
  assert.deepEqual(monsters(), [1, 0, 0, 1], 'replace');
  assert.equal(setGroupMonster(project, 1, 1, null), true);
  assert.deepEqual(monsters(), [1, 0, 1], 'clearing closes the list up');
  assert.equal(setGroupMonster(project, 7, 0, 1), false);
  assert.equal(setGroupMonster(project, 1, -1, 1), false);
});

test('delete a group: the group goes, every table naming it loses the row, higher ids shift down, mode stays', () => {
  const project = fixture();
  assert.deepEqual(mapsUsingGroup(project, 2), [0, 1]);
  assert.deepEqual(mapsUsingGroup(project, 1), [], 'a group in no table');
  assert.equal(deleteEncounterGroup(project, 0), true);
  assert.deepEqual(project.encounterGroups.map((group) => group.name), ['Rocks', 'Bats']);
  assert.deepEqual(project.maps[0].encounters.table, [{ group: 1, weight: 5 }], 'the row naming group 0 is gone, Bats shifted 2 -> 1');
  assert.deepEqual(project.maps[1].encounters.table, [{ group: 1, weight: 1 }]);
  assert.equal(deleteEncounterGroup(project, 1), true);
  assert.deepEqual(project.maps[0].encounters, { rate: 4, actorIds: [0], mode: 'groups', table: [] }, 'an emptied table stays group-mode and keeps its list');
  assert.equal(deleteEncounterGroup(project, 5), false);
});

test('delete is one undoable, redoable commit', () => {
  const store = new Store();
  store.open('/tmp/groups', fixture());
  const before = structuredClone(store.project);
  store.commit('Delete encounter group', (draft) => {
    deleteEncounterGroup(draft, 0);
  });
  assert.equal(store.undoStack.length, 1);
  const after = structuredClone(store.project);
  assert.equal(after.encounterGroups.length, 2);
  store.undo();
  assert.deepEqual(store.project, before);
  store.redo();
  assert.deepEqual(store.project, after);
});

test('groupsNamingActor counts groups (not slots) and is the N the Sprite Forge delete prompt shows', () => {
  const project = fixture();
  assert.equal(groupsNamingActor(project, 0), 1, 'Slime twice in Pack is one group');
  assert.equal(groupsNamingActor(project, 1), 2, 'Bat is in Pack and Bats');
  assert.equal(groupsNamingActor(project, 2), 1);
  assert.equal(groupsNamingActor(project, 9), 0);
  assert.equal(groupsNamingActor({ sprites: { actors: [] } }, 0), 0, 'a project with no groups key');
  // The prompt's N agrees with what renumberActorDeletion then does: deleting Bat strips it from exactly those groups.
  const lengthsBefore = project.encounterGroups.map((group) => group.monsters.length);
  renumberActorDeletion(project, 1);
  const changed = project.encounterGroups.filter((group, i) => group.monsters.length !== lengthsBefore[i]).length;
  assert.equal(changed, groupsNamingActor(fixture(), 1));
});

test('group problems: missing actors and dead groups are reported separately', () => {
  const project = fixture();
  assert.deepEqual(groupProblems(project, 0), { missing: [], dead: false });
  project.encounterGroups[0].monsters = [0, 8, 8];
  assert.deepEqual(groupProblems(project, 0), { missing: [8], dead: false }, 'live through Slime, one id missing');
  project.encounterGroups[0].monsters = [8];
  assert.deepEqual(groupProblems(project, 0), { missing: [8], dead: true });
  project.encounterGroups[0].monsters = [];
  assert.deepEqual(groupProblems(project, 0), { missing: [], dead: true }, 'an empty group starts no fight');
  assert.deepEqual(groupProblems(project, 9), { missing: [], dead: false });
});

test('slot options are the Monster Forge catalog; a stale id is offered once and labelled missing', () => {
  const project = fixture();
  const ids = monsterActorIds(project);
  assert.deepEqual(groupSlotOptions(project, 0).map((option) => option.value), ids);
  assert.ok(groupSlotOptions(project, 0).every((option) => !option.missing));
  const stale = groupSlotOptions(project, 9);
  assert.deepEqual(stale.at(-1), { value: 9, label: 'Missing actor #9', missing: true });
  assert.equal(stale.length, ids.length + 1);
  assert.equal(groupSlotOptions(project, undefined).length, ids.length, 'an empty slot adds nothing');
});

test('a group naming a harmless actor puts it in the Monster Forge catalog (so the picker can show it)', () => {
  const project = fixture();
  assert.ok(monsterActorIds(project).includes(2), 'Rock is harmless but named by the Rocks group');
  project.encounterGroups = project.encounterGroups.filter((group) => !group.monsters.includes(2));
  assert.ok(!monsterActorIds(project).includes(2));
});
