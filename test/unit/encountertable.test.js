// Encounter groups, slice C4: the Map Forge's table editor, Convert / way back and mode-aware battle-test, as pure logic
// (shared/encountergroups.js) driven through a real renderer Store. The renderer needs a window; main/smoke.js drives
// the DOM. Everything the Map Forge *decides* is asserted here (handoff-next/encgroups appendix-tests.md B4 and E).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../renderer/store.js';
import { confirmUseActorListAgain } from '../../renderer/forges/map/encounterway.js';
import { RPG_LIMITS, createProject, encounterEntryTotal, normalizeProject } from '../../shared/project.js';
import {
  addRowState,
  battleTestOffer,
  commitConvertEncounters,
  commitTableAdd,
  commitTableGroup,
  commitTableRemove,
  commitTableWeight,
  deleteEncounterGroup,
  encounterEditorVisible,
  planUseLegacyList,
  tableGroupChoices,
  tableRoom,
  tableRows
} from '../../shared/encountergroups.js';

const actor = (name, damage) => ({ name, behavior: damage ? 'monster' : 'wander', hp: 5, damage });

/** Slime(0), Bat(1), Rock(2, harmless); groups Pack [0,0,1], Rocks [2], Bats [1,1]; map 0 legacy [Slime, Bat]. */
function fixture() {
  const project = createProject('Table', 'rpg');
  project.sprites.actors = [actor('Slime', 1), actor('Bat', 1), actor('Rock', 0)];
  project.encounterGroups = [
    { name: 'Pack', monsters: [0, 0, 1] },
    { name: 'Rocks', monsters: [2] },
    { name: 'Bats', monsters: [1, 1] }
  ];
  project.maps[0].encounters = { rate: 4, actorIds: [0, 1] };
  return project;
}

const openStore = (project) => {
  const store = new Store();
  store.open('/tmp/encounter-table', project);
  return store;
};

/** The five numbers a refusal must leave alone. */
const history = (store) => [store.revision, store.undoStack.length, store.redoStack.length, store.dirty, JSON.stringify(store.project)];

test('Convert (the real caller): a refusal shows its text and never reaches store.commit', () => {
  const project = fixture();
  project.encounterGroups = Array.from({ length: 31 }, (_, i) => ({ name: `G${i}`, monsters: [2] }));
  project.maps[0].encounters = { rate: 4, actorIds: [0, 1, 2] }; // three prefixes, none of which exists: needs 3 new, room for 1
  const store = openStore(project);
  const before = history(store);
  let commits = 0;
  const realCommit = store.commit.bind(store);
  store.commit = (...args) => {
    commits++;
    return realCommit(...args);
  };
  const result = commitConvertEncounters(store, 0);
  assert.equal(result.ok, false);
  assert.match(result.message, /needs 3 new groups; the project has room for 1/);
  assert.equal(commits, 0, 'a refused conversion must not call store.commit');
  assert.deepEqual(history(store), before, 'project, undo/redo lengths, dirty and revision are all unchanged');
  assert.equal(store.project.maps[0].encounters.mode, undefined);
});

test('Convert (the real caller): success is exactly one commit; undo and redo restore and replay the whole project', () => {
  const store = openStore(fixture());
  const original = JSON.stringify(store.project);
  let commits = 0;
  const realCommit = store.commit.bind(store);
  store.commit = (...args) => {
    commits++;
    return realCommit(...args);
  };
  const result = commitConvertEncounters(store, 0);
  assert.deepEqual(result, { ok: true, changed: true });
  assert.equal(commits, 1);
  assert.equal(store.undoStack.length, 1);
  const converted = JSON.stringify(store.project);
  assert.equal(store.project.maps[0].encounters.mode, 'groups');
  // [Slime, Bat]: prefixes [0] and [0,1]; neither equals an existing group, so two new ones, weights 1 and 3.
  assert.equal(store.project.encounterGroups.length, 5);
  assert.deepEqual(store.project.maps[0].encounters.table, [
    { group: 3, weight: 1 },
    { group: 4, weight: 3 }
  ]);
  assert.deepEqual(store.project.maps[0].encounters.actorIds, [0, 1], 'the actor list is retained');
  store.undo();
  assert.equal(JSON.stringify(store.project), original);
  store.redo();
  assert.equal(JSON.stringify(store.project), converted);
});

test('Convert: a map that is already in group mode is refused without a commit', () => {
  const store = openStore(fixture());
  commitConvertEncounters(store, 0);
  const before = history(store);
  const result = commitConvertEncounters(store, 0);
  assert.equal(result.ok, false);
  assert.match(result.message, /already uses encounter groups/);
  assert.deepEqual(history(store), before);
});

test('Convert: an empty-list legacy map converts to an empty table, then the first group comes from the Add menu', () => {
  const project = fixture();
  project.maps[0].encounters = { rate: 4, actorIds: [] };
  const store = openStore(project);
  assert.deepEqual(commitConvertEncounters(store, 0), { ok: true, changed: true });
  assert.equal(store.project.maps[0].encounters.mode, 'groups');
  assert.deepEqual(store.project.maps[0].encounters.table, []);
  assert.equal(store.project.encounterGroups.length, 3, 'no groups were created');
  assert.equal(addRowState(store.project, 0).disabled, false);
  assert.deepEqual(commitTableAdd(store, 0, 2), { ok: true, changed: true });
  assert.deepEqual(store.project.maps[0].encounters.table, [{ group: 2, weight: 1 }]);
});

test('table rows: the chance beside each row is its share of the 255 rolls, over live rows only', () => {
  const project = fixture();
  project.maps[0].encounters = {
    rate: 4,
    actorIds: [],
    mode: 'groups',
    table: [
      { group: 0, weight: 1 },
      { group: 2, weight: 2 },
      { group: 1, weight: 5 }
    ]
  };
  project.sprites.actors = project.sprites.actors.slice(0, 2); // Rock gone: group 1 ([2]) is dead
  const rows = tableRows(project, 0);
  assert.deepEqual(rows.map((row) => row.live), [true, true, false]);
  // live weights 1:2 -> thresholds floor(255/3)=85, 255 -> widths 85 and 170 of 255
  assert.equal(rows[0].percent, (85 / 255) * 100);
  assert.equal(rows[1].percent, (170 / 255) * 100);
  assert.equal(rows[2].percent, null);
  assert.equal(rows[2].name, 'Rocks');
  assert.deepEqual(tableRows(project, 1), [], 'a legacy map has no rows');
});

test('add: a full table, a group already in it and a missing group are refused before commit; the limit is named', () => {
  const project = fixture();
  project.encounterGroups = Array.from({ length: 10 }, (_, i) => ({ name: `G${i}`, monsters: [0] }));
  project.maps[0].encounters = { rate: 0, actorIds: [], mode: 'groups', table: [] };
  const store = openStore(project);
  for (let group = 0; group < RPG_LIMITS.encounterTableEntries; group++) assert.equal(commitTableAdd(store, 0, group).ok, true);
  assert.equal(store.undoStack.length, 8);
  assert.equal(tableRoom(store.project, 0).full, true);
  const before = history(store);
  const full = commitTableAdd(store, 0, 9);
  assert.equal(full.ok, false);
  assert.match(full.message, /at most 8 groups/);
  assert.equal(addRowState(store.project, 0).disabled, true);
  assert.equal(commitTableAdd(store, 0, 99).ok, false);
  assert.deepEqual(history(store), before, 'refusals leave the store untouched');

  const small = openStore(fixture());
  small.commit('make group mode', (draft) => {
    draft.maps[0].encounters = { rate: 0, actorIds: [], mode: 'groups', table: [{ group: 0, weight: 1 }] };
  });
  const smallBefore = history(small);
  const dup = commitTableAdd(small, 0, 0);
  assert.equal(dup.ok, false);
  assert.match(dup.message, /already in this table/);
  assert.deepEqual(history(small), smallBefore);
  assert.deepEqual(tableGroupChoices(small.project, 0).map((choice) => choice.value), [1, 2], 'the Add menu leaves out groups the table holds');
  assert.deepEqual(tableGroupChoices(small.project, 0, 0).map((choice) => choice.value), [0, 1, 2], 'a row keeps its own group');
});

test('weight, group and remove: one commit each, refusals and no-ops commit nothing, all undo', () => {
  const project = fixture();
  project.maps[0].encounters = {
    rate: 4,
    actorIds: [],
    mode: 'groups',
    table: [
      { group: 0, weight: 2 },
      { group: 1, weight: 2 }
    ]
  };
  const store = openStore(project);
  assert.deepEqual(commitTableWeight(store, 0, 0, 5), { ok: true, changed: true });
  assert.equal(store.project.maps[0].encounters.table[0].weight, 5);
  assert.equal(store.undoStack.length, 1);
  assert.equal(commitTableWeight(store, 0, 0, 99).ok, true, 'a too-large weight clamps to 16');
  assert.equal(store.project.maps[0].encounters.table[0].weight, RPG_LIMITS.encounterWeightMax);
  assert.equal(commitTableWeight(store, 0, 0, 0).ok, true, 'a zero weight clamps to 1');
  assert.equal(store.project.maps[0].encounters.table[0].weight, 1);

  const before = history(store);
  assert.deepEqual(commitTableWeight(store, 0, 0, 1), { ok: true, changed: false }, 'an unchanged weight is no commit');
  assert.equal(commitTableWeight(store, 0, 0, 'abc').ok, false);
  assert.equal(commitTableWeight(store, 0, 7, 3).ok, false, 'a row that is gone');
  assert.deepEqual(commitTableGroup(store, 0, 0, 0), { ok: true, changed: false });
  const clash = commitTableGroup(store, 0, 0, 1);
  assert.equal(clash.ok, false, 'pointing a row at a group the table already holds is refused');
  assert.deepEqual(history(store), before);

  assert.deepEqual(commitTableGroup(store, 0, 0, 2), { ok: true, changed: true });
  assert.equal(store.project.maps[0].encounters.table[0].group, 2);
  assert.deepEqual(commitTableRemove(store, 0, 1), { ok: true, changed: true });
  assert.deepEqual(commitTableRemove(store, 0, 0), { ok: true, changed: true });
  assert.deepEqual(store.project.maps[0].encounters.table, []);
  assert.equal(store.project.maps[0].encounters.mode, 'groups', 'removing the last row never changes the mode');
  store.undo();
  assert.equal(store.project.maps[0].encounters.table.length, 1);
});

test('a legacy map refuses every table edit without a commit', () => {
  const store = openStore(fixture());
  const before = history(store);
  for (const result of [
    commitTableAdd(store, 0, 0),
    commitTableWeight(store, 0, 0, 3),
    commitTableGroup(store, 0, 0, 1),
    commitTableRemove(store, 0, 0)
  ]) {
    assert.equal(result.ok, false);
    assert.match(result.message, /does not use encounter groups/);
  }
  assert.deepEqual(history(store), before);
});

/** `bigMaps` rate-positive group maps of eight rows each, plus one of `last` rows, over eight live groups. */
function nearlyFullProject(last, rate = 4) {
  const project = createProject('Entries', 'rpg');
  project.sprites.actors = [actor('Slime', 1)];
  project.encounterGroups = Array.from({ length: 8 }, (_, i) => ({ name: `G${i}`, monsters: [0] }));
  const table = (rows) => Array.from({ length: rows }, (_, group) => ({ group, weight: 1 }));
  const template = project.maps[0];
  project.maps = Array.from({ length: 32 }, (_, index) => ({
    ...structuredClone(template),
    id: index,
    name: `M${index}`,
    encounters: { rate: index === 31 ? rate : 4, actorIds: [], mode: 'groups', table: table(index === 31 ? last : 8) }
  }));
  return project;
}

test('the project-wide 255-entry total: an edit that crosses it is refused with the numbers; one that does not worsen it is not', () => {
  const store = openStore(nearlyFullProject(7));
  assert.equal(encounterEntryTotal(store.project), 255);
  const before = history(store);
  const refused = commitTableAdd(store, 31, 7);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /would hold 256 encounter table entries \(limit 255\)/);
  assert.deepEqual(history(store), before);
  // removing a row, or changing a weight, only ever lowers or keeps the total
  assert.deepEqual(commitTableWeight(store, 31, 0, 9), { ok: true, changed: true });
  assert.deepEqual(commitTableRemove(store, 31, 6), { ok: true, changed: true });
  assert.equal(encounterEntryTotal(store.project), 254);

  const rateZero = openStore(nearlyFullProject(7, 0));
  assert.equal(encounterEntryTotal(rateZero.project), 248, 'a rate-0 group map costs none');
  assert.deepEqual(commitTableAdd(rateZero, 31, 7), { ok: true, changed: true });
});

test('a project already at 256 entries: count-neutral edits and removals pass, only an edit that raises the total is refused', () => {
  const project = nearlyFullProject(8); // 32 maps x 8 = 256, one over the limit
  project.encounterGroups.push({ name: 'Ninth', monsters: [0] });
  const store = openStore(project);
  assert.equal(encounterEntryTotal(store.project), 256);
  assert.deepEqual(commitTableWeight(store, 31, 0, 9), { ok: true, changed: true }, 'a weight change does not raise the total');
  assert.deepEqual(commitTableGroup(store, 31, 0, 8), { ok: true, changed: true }, 'a group swap does not raise the total');
  assert.equal(encounterEntryTotal(store.project), 256);
  assert.deepEqual(commitTableRemove(store, 31, 7), { ok: true, changed: true });
  assert.equal(encounterEntryTotal(store.project), 255);
  const before = history(store);
  const again = commitTableAdd(store, 31, 7);
  assert.equal(again.ok, false, 'putting the row back raises 255 to 256: refused');
  assert.match(again.message, /would hold 256 encounter table entries/);
  assert.deepEqual(history(store), before);
});

test('Use the actor list again: only a group map can; the production path removes mode and table, keeps groups, one undoable commit', async () => {
  const store = openStore(fixture());
  assert.equal(planUseLegacyList(store.project, 0).ok, false);
  assert.equal(await confirmUseActorListAgain(store, 0, { confirm: async () => true, isCurrent: () => true }), 'refused');
  commitConvertEncounters(store, 0);
  const groups = JSON.stringify(store.project.encounterGroups);
  const undoBefore = store.undoStack.length;
  assert.equal(planUseLegacyList(store.project, 0).ok, true);
  assert.equal(await confirmUseActorListAgain(store, 0, { confirm: async () => true, isCurrent: () => true }), 'committed');
  assert.equal(store.undoStack.length, undoBefore + 1, 'exactly one commit');
  const encounters = store.project.maps[0].encounters;
  assert.equal('mode' in encounters, false);
  assert.equal('table' in encounters, false);
  assert.deepEqual(encounters.actorIds, [0, 1]);
  assert.equal(JSON.stringify(store.project.encounterGroups), groups);
  store.undo();
  assert.equal(store.project.maps[0].encounters.mode, 'groups');
  store.redo();
  assert.equal('mode' in store.project.maps[0].encounters, false);
});

/** Two group-mode maps, the way back opened on map 0; `during(store, flags)` runs while the confirmation is open. */
async function wayBackWhileOpen(answer, during) {
  const project = fixture();
  project.maps.push({ ...structuredClone(project.maps[0]), id: 1, name: 'Cave' });
  for (const map of project.maps) map.encounters = { rate: 4, actorIds: [0], mode: 'groups', table: [{ group: 0, weight: 2 }] };
  const store = openStore(project);
  const flags = { mounted: true, selected: 0 };
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const pending = confirmUseActorListAgain(store, 0, {
    confirm: () => gate,
    isCurrent: () => flags.mounted && flags.selected === 0
  });
  const before = history(store);
  during?.(store, flags);
  const afterDuring = history(store);
  release(answer);
  const outcome = await pending;
  return { store, outcome, before, afterDuring };
}

test('way back, stale cases through the production confirm/commit path: nothing commits and nothing moves', async () => {
  const cases = [
    ['dismissed (null)', null, undefined, 'cancelled'],
    ['declined (false)', false, undefined, 'cancelled'],
    ['an intervening revision', true, (store) => store.commit('unrelated edit', (p) => { p.project.name = 'Changed'; }), 'stale'],
    ['the selected map changed', true, (_store, flags) => { flags.selected = 1; }, 'stale'],
    ['the Forge was destroyed', true, (_store, flags) => { flags.mounted = false; }, 'stale']
  ];
  for (const [label, answer, during, expected] of cases) {
    const { store, outcome, afterDuring } = await wayBackWhileOpen(answer, during);
    assert.equal(outcome, expected, label);
    assert.deepEqual(history(store), afterDuring, `${label}: the answer changed no project, history, dirty flag or revision`);
    assert.equal(store.project.maps[0].encounters.mode, 'groups', `${label}: map 0 keeps its table`);
    assert.equal(store.project.maps[1].encounters.mode, 'groups');
  }
});

test('way back: a confirmed, unchanged target is exactly one undoable commit, and the target is re-read at commit time', async () => {
  const { store, outcome, before } = await wayBackWhileOpen(true);
  assert.equal(outcome, 'committed');
  assert.equal(store.undoStack.length, before[1] + 1);
  assert.equal('mode' in store.project.maps[0].encounters, false);
  assert.equal(store.project.maps[1].encounters.mode, 'groups', 'only the confirmed map changed');
  store.undo();
  assert.equal(JSON.stringify(store.project), before[4]);

  // the map stops being group-mode while the dialog is open (a write that bypasses commit leaves the revision alone): refused, no commit
  const raced = await wayBackWhileOpen(true, (st) => {
    st.project.maps[0].encounters = { rate: 4, actorIds: [0] };
  });
  assert.equal(raced.outcome, 'refused');
  assert.deepEqual(history(raced.store), raced.afterDuring);
});

// --- RC5: the Battle-test section is mode-aware ------------------------------------------------------------------

test('RC5: a group map retaining legacy [A] with active group [B,C] offers no "table" button and nothing that fires [A]', () => {
  const project = fixture(); // Slime 0, Bat 1
  project.encounterGroups = [{ name: 'Bat pair', monsters: [1, 2] }];
  project.maps[0].encounters = { rate: 4, actorIds: [0], mode: 'groups', table: [{ group: 0, weight: 3 }] };
  const offer = battleTestOffer(project, 0, 2);
  assert.equal(offer.mode, 'groups');
  assert.equal(offer.tableButton, null, 'no action labelled as the map table exists');
  assert.deepEqual(offer.groupButtons.map((button) => button.formation), [[1, 2, 0xff, 0xff]]);
  assert.equal(
    offer.groupButtons.some((button) => button.formation.includes(0)),
    false,
    'nothing fires the retained [A]'
  );
  assert.equal(offer.emptyNote, false);
});

test('RC5: a legacy map keeps exactly its one table button (the full padded list); an empty list disables it', () => {
  const project = fixture();
  const offer = battleTestOffer(project, 0, 2);
  assert.equal(offer.mode, 'legacy');
  assert.deepEqual(offer.tableButton, { formation: [0, 1, 0xff, 0xff], empty: false });
  assert.deepEqual(offer.groupButtons, []);
  project.maps[0].encounters = { rate: 4, actorIds: [] };
  const empty = battleTestOffer(project, 0, 2);
  assert.equal(empty.tableButton.empty, true);
  assert.equal(empty.visible, true, 'a hostile actor keeps the hand-picked tool');
  assert.equal(battleTestOffer(project, 0, 0).visible, false, 'no list and no hostile actor: hidden, as today');
});

test('RC5: an empty group table shows the empty state, and the section stays for the hand-picked tool', () => {
  const project = fixture();
  project.maps[0].encounters = { rate: 4, actorIds: [0, 1], mode: 'groups', table: [] };
  const offer = battleTestOffer(project, 0, 2);
  assert.equal(offer.tableButton, null);
  assert.deepEqual(offer.groupButtons, []);
  assert.equal(offer.emptyNote, true);
  assert.equal(offer.visible, true);
  assert.equal(battleTestOffer(project, 0, 0).visible, false);
});

test('RC5: a group whose only actor is harmless but referenced is testable; a dead group and a repeated row are not extra buttons', () => {
  const project = fixture(); // Rock (2) is harmless
  project.maps[0].encounters = {
    rate: 4,
    actorIds: [],
    mode: 'groups',
    table: [
      { group: 1, weight: 1 },
      { group: 2, weight: 1 }
    ]
  };
  let offer = battleTestOffer(project, 0, 0);
  assert.deepEqual(offer.groupButtons.map((button) => button.name), ['Rocks', 'Bats']);
  assert.equal(offer.visible, true, 'group formations alone keep the section even with no hostile actor');
  project.encounterGroups[2].monsters = [9]; // names no actor: dead
  offer = battleTestOffer(project, 0, 0);
  assert.deepEqual(offer.groupButtons.map((button) => button.name), ['Rocks']);
});

// --- RC2.3: the editor never depends on the catalog ----------------------------------------------------------------

test('RC2.3: deleting the only group of a sole-entry table keeps the editor, the warning and the way back, through undo, redo and reload', () => {
  const project = fixture();
  project.encounterGroups = [{ name: 'Only', monsters: [0] }];
  project.sprites.actors = [actor('Rock', 0)]; // no hostile actor either
  project.sprites.actors[0].damage = 0;
  project.maps[0].encounters = { rate: 4, actorIds: [0], mode: 'groups', table: [{ group: 0, weight: 4 }] };
  const store = openStore(project);

  const expectEmptyEditor = (p, label) => {
    assert.equal(p.encounterGroups.length, 0, `${label}: zero groups`);
    assert.equal(encounterEditorVisible(p, 0), true, `${label}: the editor is still shown`);
    assert.equal(tableRows(p, 0).length, 0, `${label}: and its table is empty`);
    assert.equal(planUseLegacyList(p, 0).ok, true, `${label}: the way back is still available`);
    const add = addRowState(p, 0);
    assert.equal(add.disabled, true, `${label}: Add is disabled`);
    assert.match(add.message, /Monster Forge/, `${label}: with Monster Forge guidance`);
    assert.equal(battleTestOffer(p, 0, 0).visible, false, `${label}: battle-test stays hidden (a separate predicate)`);
    assert.equal(battleTestOffer(p, 0, 0).emptyNote, true);
  };

  assert.equal(encounterEditorVisible(store.project, 0), true);
  store.commit('Delete encounter group', (draft) => deleteEncounterGroup(draft, 0));
  expectEmptyEditor(store.project, 'after delete');
  assert.equal(store.project.maps[0].encounters.mode, 'groups');

  store.undo();
  assert.equal(store.project.encounterGroups.length, 1, 'undo: the group returns');
  assert.deepEqual(store.project.maps[0].encounters.table, [{ group: 0, weight: 4 }], 'undo: and the table row');
  store.redo();
  expectEmptyEditor(store.project, 'after redo');

  const reloaded = normalizeProject(JSON.parse(JSON.stringify(store.project)));
  expectEmptyEditor(reloaded, 'after save/reload');
});

test('the editor is shown for every group-mode map and no legacy one, whatever the catalog holds', () => {
  const project = fixture();
  assert.equal(encounterEditorVisible(project, 0), false);
  project.encounterGroups = [];
  project.sprites.actors = [];
  project.maps[0].encounters = { rate: 0, actorIds: [], mode: 'groups', table: [] };
  assert.equal(encounterEditorVisible(project, 0), true);
});
