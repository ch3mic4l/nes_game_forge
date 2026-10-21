// Encounter groups, data layer (ROADMAP item 5 remainder, slice C1): the persisted `mode`
// discriminator, the group table, the helpers, both renumbers, conversion planning and the
// validation rules. Nothing here builds a ROM: the generator and engine are a later slice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../../renderer/store.js';
import { resolveMapper } from '../../shared/cartridge.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import {
  AUTHOR_NAME_MAX,
  NO_ACTOR,
  RPG_LIMITS,
  applyEncounterConversion,
  battleCombatantOamMax,
  createMap,
  createProject,
  duplicateMapCore,
  encounterEntryTotal,
  encounterGroupFormation,
  encounterRowPlan,
  encounterThresholds,
  mapCompiledEntryCount,
  mapEncounterEntries,
  mapEncounterFormation,
  monsterActorIds,
  normalizeProject,
  planEncounterConversion,
  projectUsesEncounterGroups,
  renumberActorDeletion,
  renumberEncounterGroupDeletion,
  useLegacyEncounterList,
  validateProject
} from '../../shared/project.js';

/** An RPG project with `actors` plain actors named A, B, C, ... and one map. */
function rpgProject(actors = 3) {
  const project = createProject('Quest', 'rpg');
  project.sprites.actors = Array.from({ length: actors }, (_, id) => ({ name: String.fromCharCode(65 + id), damage: 0 }));
  return project;
}
const normalized = (project) => normalizeProject(structuredClone(project));
const groupEncounters = (rate, table, actorIds = []) => ({ rate, actorIds, mode: 'groups', table });
const encounterIssues = (project) =>
  validateProject(project).filter((issue) => /^encounter-(group|table|entries|rows)/.test(issue.rule));
const encounterErrors = (project) => encounterIssues(project).filter((issue) => issue.severity === 'error');

/** `count` maps, each a rate-1 group map; `tables[i]` is map i's table (default: empty, one fallback entry). */
function manyGroupMaps(project, tables, rate = 1) {
  project.maps = tables.map((table, index) => {
    const map = createMap(index, `M${index}`);
    map.encounters = groupEncounters(rate, table);
    return map;
  });
  return project;
}
const rows = (count, from = 0) => Array.from({ length: count }, (_, i) => ({ group: from + i, weight: 1 }));
const liveGroups = (project, count) => {
  project.encounterGroups = Array.from({ length: count }, (_, i) => ({ name: `G${i}`, monsters: [0] }));
  return project;
};

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

test('a legacy map still serializes to exactly {rate, actorIds}; a table without a mode is ignored', () => {
  const project = rpgProject();
  project.encounterGroups = [{ name: 'G', monsters: [0] }];
  project.maps[0].encounters = { rate: 5, actorIds: [0, 1], table: [{ group: 0, weight: 3 }] };
  const map = normalized(project).maps[0];
  assert.deepEqual(Object.keys(map.encounters), ['rate', 'actorIds']);
  assert.deepEqual(createMap(0, 'x').encounters, { rate: 0, actorIds: [] }, 'new maps are legacy');
});

test('mode is "groups" or absent: every other value normalizes to legacy', () => {
  for (const mode of ['legacy', 'GROUPS', true, 1, null, '']) {
    const project = rpgProject();
    project.maps[0].encounters = { rate: 5, actorIds: [], mode, table: [] };
    assert.equal('mode' in normalized(project).maps[0].encounters, false, `mode ${JSON.stringify(mode)}`);
  }
});

test('normalizing a table: drops missing groups, clamps weights, merges duplicates, caps at 8; never touches mode', () => {
  const project = rpgProject();
  project.encounterGroups = Array.from({ length: 10 }, (_, i) => ({ name: `G${i}`, monsters: [0] }));
  const run = (table) => {
    project.maps[0].encounters = groupEncounters(4, table, [1]);
    return normalized(project).maps[0].encounters;
  };
  assert.deepEqual(run([{ group: 3, weight: 0 }, { group: 4, weight: 99 }, { group: 5, weight: 'x' }]).table, [
    { group: 3, weight: 1 },
    { group: 4, weight: 16 },
    { group: 5, weight: 1 }
  ]);
  assert.deepEqual(run([{ group: 2, weight: 3 }, { group: 7, weight: 1 }, { group: 2, weight: 4 }]).table, [
    { group: 2, weight: 7 },
    { group: 7, weight: 1 }
  ], 'same-group rows merge at the first position');
  assert.deepEqual(run([{ group: 2, weight: 10 }, { group: 2, weight: 10 }]).table, [{ group: 2, weight: 16 }], 'merged weight is capped');
  assert.equal(run(rows(10)).table.length, RPG_LIMITS.encounterTableEntries);
  const dropped = run([{ group: 10, weight: 2 }, { group: -1, weight: 2 }, { group: 1.5, weight: 2 }, null, { weight: 2 }]);
  assert.deepEqual(dropped.table, [], 'every row naming a group that does not exist is dropped');
  assert.equal(dropped.mode, 'groups', 'an emptied table is still group mode');
  assert.deepEqual(dropped.actorIds, [1], 'the retained list rides along');
  assert.deepEqual(run('nonsense').table, []);
});

test('normalizing groups: name fallback and trim, 32 groups, 4 monsters, ids clamped, absent => []', () => {
  const project = rpgProject();
  project.encounterGroups = [
    { name: '  Slime   pack ', monsters: [0, 1, 2, 0, 1] },
    { name: '', monsters: [999, -3, 'x'] },
    { name: 'x'.repeat(AUTHOR_NAME_MAX + 9) },
    null
  ];
  const groups = normalized(project).encounterGroups;
  assert.deepEqual(groups[0], { name: 'Slime pack', monsters: [0, 1, 2, 0] });
  assert.deepEqual(groups[1], { name: 'Group 1', monsters: [255, 0, 0] });
  assert.equal(groups[2].name.length, AUTHOR_NAME_MAX);
  assert.deepEqual(groups[2].monsters, []);
  assert.deepEqual(groups[3], { name: 'Group 3', monsters: [] });
  project.encounterGroups = Array.from({ length: 40 }, () => ({ name: 'g', monsters: [0] }));
  assert.equal(normalized(project).encounterGroups.length, RPG_LIMITS.encounterGroups);
  delete project.encounterGroups;
  assert.deepEqual(normalized(project).encounterGroups, []);
  assert.deepEqual(createProject('x', 'rpg').encounterGroups, []);
  const once = normalized({ ...rpgProject(), encounterGroups: [{ name: 'a', monsters: [1] }] });
  assert.deepEqual(normalizeProject(structuredClone(once)), once, 'normalization is a fixed point');
});

test('the four limits are the approved ones', () => {
  assert.equal(RPG_LIMITS.encounterGroups, 32);
  assert.equal(RPG_LIMITS.encounterTableEntries, 8);
  assert.equal(RPG_LIMITS.encounterWeightMax, 16);
  assert.equal(RPG_LIMITS.encounterEntriesTotal, 255);
});

// ---------------------------------------------------------------------------
// B1: the mode matrix -- normalize -> save -> load -> duplicate -> undo/redo
// ---------------------------------------------------------------------------

for (const mode of ['legacy', 'groups']) {
  for (const tableEmpty of [true, false]) {
    for (const actorIds of [[0, 1], []]) {
      test(`mode matrix: ${mode}, table ${tableEmpty ? 'empty' : 'non-empty'}, actorIds [${actorIds}]`, async (t) => {
        const raw = rpgProject();
        raw.encounterGroups = [{ name: 'Pack', monsters: [2] }];
        const table = tableEmpty ? [] : [{ group: 0, weight: 3 }];
        raw.maps[0].encounters = mode === 'groups' ? groupEncounters(6, table, actorIds) : { rate: 6, actorIds, table };
        const project = normalized(raw);
        const encounters = project.maps[0].encounters;
        assert.equal(encounters.mode, mode === 'groups' ? 'groups' : undefined);
        assert.deepEqual(encounters.table, mode === 'groups' ? table : undefined);

        // persistence
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-encmatrix-'));
        t.after(() => fs.rm(dir, { recursive: true, force: true }));
        await saveProject(dir, project);
        const loaded = await loadProject(dir);
        assert.deepEqual(loaded.maps[0].encounters, encounters);
        assert.deepEqual(loaded.encounterGroups, project.encounterGroups);

        // duplicate: identical and a deep copy
        const clone = duplicateMapCore(loaded, 0);
        assert.deepEqual(clone.encounters, encounters);
        if (mode === 'groups') {
          clone.encounters.table.push({ group: 0, weight: 9 });
          clone.encounters.mode = 'edited';
          assert.deepEqual(loaded.maps[0].encounters, encounters, 'the source did not move');
        }

        // undo / redo are whole-project snapshots
        const store = new Store();
        store.open('/tmp/enc', project);
        store.commit('rename', (p) => {
          p.name = 'renamed';
        });
        store.undo();
        store.redo();
        assert.deepEqual(store.project.maps[0].encounters, encounters);

        // consumers read mode, never table.length or actorIds
        const entries = mapEncounterEntries(project, 0);
        assert.deepEqual(entries, mode === 'groups' && !tableEmpty ? [{ group: 0, weight: 3 }] : []);
        assert.equal(projectUsesEncounterGroups(project), mode === 'groups', 'the predicate reads mode, even with an empty table');
      });
    }
  }
}

test('mode matrix: the last group deleted and the last row removed both leave an empty group-mode table', () => {
  const project = rpgProject();
  project.encounterGroups = [{ name: 'Only', monsters: [0] }];
  project.maps[0].encounters = groupEncounters(6, [{ group: 0, weight: 2 }], [0, 1]);
  const afterGroup = normalized(project);
  renumberEncounterGroupDeletion(afterGroup, 0);
  afterGroup.encounterGroups.splice(0, 1);
  assert.deepEqual(afterGroup.maps[0].encounters, groupEncounters(6, [], [0, 1]), 'mode stays; actorIds stay dormant');
  assert.deepEqual(mapEncounterEntries(afterGroup, 0), [], 'the dormant list is never exposed as the table');
  assert.equal(projectUsesEncounterGroups(afterGroup), true);
  const afterRow = normalized(project);
  afterRow.maps[0].encounters.table.pop();
  assert.equal(normalized(afterRow).maps[0].encounters.mode, 'groups');
  assert.deepEqual(normalized(afterRow).maps[0].encounters.table, []);
});

test('projectUsesEncounterGroups: rate>0 group maps only, RPG only; a rate-0 group map and unused groups do not count', () => {
  const project = rpgProject();
  project.encounterGroups = [{ name: 'G', monsters: [0] }];
  assert.equal(projectUsesEncounterGroups(project), false, 'groups alone');
  project.maps[0].encounters = groupEncounters(0, [{ group: 0, weight: 1 }], [0]);
  assert.equal(projectUsesEncounterGroups(project), false, 'a rate-0 group map');
  project.maps[0].encounters.rate = 1;
  assert.equal(projectUsesEncounterGroups(project), true);
  const other = createMap(1, 'Legacy');
  other.encounters = { rate: 9, actorIds: [0] };
  project.maps.push(other);
  assert.equal(projectUsesEncounterGroups(project), true, 'a legacy rate>0 map beside it changes nothing');
  project.maps[0].encounters.rate = 0;
  assert.equal(projectUsesEncounterGroups(project), false, 'false once every group map is rate 0');
  const action = createProject('Act', 'action');
  action.maps[0].encounters = groupEncounters(5, []);
  assert.equal(projectUsesEncounterGroups(action), false, 'RPG only');
});

test('a duplicated group-mode map carries mode and table as a deep copy', () => {
  const project = normalized({ ...rpgProject(), encounterGroups: [{ name: 'G', monsters: [0] }] });
  project.maps[0].encounters = groupEncounters(3, [{ group: 0, weight: 2 }], [1]);
  const clone = duplicateMapCore(project, 0);
  assert.notEqual(clone.encounters, project.maps[0].encounters);
  assert.notEqual(clone.encounters.table, project.maps[0].encounters.table);
  assert.deepEqual(clone.encounters, project.maps[0].encounters);
});

// ---------------------------------------------------------------------------
// Persistence (project-io)
// ---------------------------------------------------------------------------

test('project-io: encounterGroups.json is always written, [] included; absent reads back as []', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-encio-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, normalized(rpgProject()));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'encounterGroups.json'), 'utf8')), []);
  await fs.rm(path.join(dir, 'encounterGroups.json'));
  assert.deepEqual((await loadProject(dir)).encounterGroups, []);
});

test('project-io: groups and a group-mode map round-trip; a legacy map file stays {rate, actorIds}', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-encio-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const project = rpgProject();
  project.encounterGroups = [
    { name: 'Pair', monsters: [0, 1] },
    { name: 'Solo', monsters: [2] }
  ];
  project.maps[0].encounters = groupEncounters(7, [{ group: 1, weight: 5 }, { group: 0, weight: 2 }], [2]);
  const legacy = createMap(1, 'Old');
  legacy.encounters = { rate: 4, actorIds: [0] };
  project.maps.push(legacy);
  const saved = normalized(project);
  await saveProject(dir, saved);
  const mapFile = async (i) => JSON.parse(await fs.readFile(path.join(dir, 'maps', `${i}.json`), 'utf8'));
  assert.deepEqual((await mapFile(1)).encounters, { rate: 4, actorIds: [0] });
  assert.equal((await mapFile(0)).encounters.mode, 'groups');
  const loaded = await loadProject(dir);
  assert.deepEqual(loaded.encounterGroups, saved.encounterGroups);
  assert.deepEqual(loaded.maps.map((m) => m.encounters), saved.maps.map((m) => m.encounters));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

test('encounterGroupFormation: padded like mapEncounterFormation, drops dead ids, a missing group is empty', () => {
  const project = normalized({ ...rpgProject(2), encounterGroups: [{ name: 'G', monsters: [1, 0, 7] }] });
  assert.deepEqual(encounterGroupFormation(project, 0), [1, 0, NO_ACTOR, NO_ACTOR]);
  assert.deepEqual(encounterGroupFormation(project, 5), [NO_ACTOR, NO_ACTOR, NO_ACTOR, NO_ACTOR]);
});

test('mapEncounterEntries drops missing/dead groups, never reads actorIds, and is empty for a legacy map', () => {
  const project = rpgProject(2);
  project.encounterGroups = [
    { name: 'Live', monsters: [0] },
    { name: 'Dead', monsters: [] },
    { name: 'Gone', monsters: [9] }
  ];
  project.maps[0].encounters = groupEncounters(5, [{ group: 0, weight: 2 }, { group: 1, weight: 5 }, { group: 2, weight: 7 }], [0, 1]);
  const n = normalized(project);
  assert.deepEqual(mapEncounterEntries(n, 0), [{ group: 0, weight: 2 }]);
  assert.deepEqual(mapEncounterEntries(n, 3), [], 'no such map');
  n.maps[0].encounters = { rate: 5, actorIds: [0] };
  assert.deepEqual(mapEncounterEntries(n, 0), []);
});

test('encounterThresholds: the documented examples and the edge cases', () => {
  assert.deepEqual(encounterThresholds([1, 2, 5]), [31, 95, 255]);
  assert.deepEqual(encounterThresholds([1, 1, 1, 1]), [63, 127, 191, 255]);
  assert.deepEqual(encounterThresholds([1, 1, 2]), [63, 127, 255]);
  assert.deepEqual(encounterThresholds([1, 3]), [63, 255]);
  assert.deepEqual(encounterThresholds([4]), [255]);
  assert.deepEqual(encounterThresholds([16]), [255]);
  assert.deepEqual(encounterThresholds([]), []);
  assert.deepEqual(encounterThresholds([1, 1, 1, 1, 2]), [42, 85, 127, 170, 255], 'five entries: floor, not round or ceil');
});

function checkThresholds(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  const thr = encounterThresholds(weights);
  assert.equal(thr.length, weights.length);
  // the exact rule, spelled out independently: floor(cumulative * 255 / total), the last forced to 255
  let running = 0;
  const exact = weights.map((weight, i) => {
    running += weight;
    return i === weights.length - 1 ? 255 : Math.floor((running * 255) / total);
  });
  assert.deepEqual(thr, exact, `${weights}: the cumulative floor rule`);
  assert.equal(thr.at(-1), 255, `${weights}: last threshold`);
  let previous = 0;
  thr.forEach((value, i) => {
    const width = value - previous;
    assert.ok(width >= 1, `${weights}: entry ${i} must be reachable`);
    // |width/255 - w/total| < 1/255, in integers
    assert.ok(Math.abs(width * total - 255 * weights[i]) < total, `${weights}: entry ${i} share`);
    previous = value;
  });
}

test('encounterThresholds: exhaustive for n <= 4 (69,904 weight vectors)', () => {
  let count = 0;
  const walk = (prefix, n) => {
    if (prefix.length === n) {
      checkThresholds(prefix);
      count++;
      return;
    }
    for (let w = 1; w <= 16; w++) walk([...prefix, w], n);
  };
  for (let n = 1; n <= 4; n++) walk([], n);
  assert.equal(count, 16 + 256 + 4096 + 65536);
});

test('encounterThresholds: seeded sample for n = 5..8 plus boundary vectors', () => {
  let seed = 0x5eed1234; // mulberry32
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 20000; i++) {
    const n = 5 + Math.floor(next() * 4);
    checkThresholds(Array.from({ length: n }, () => 1 + Math.floor(next() * 16)));
  }
  for (const n of [1, 2, 8]) {
    checkThresholds(new Array(n).fill(1));
    checkThresholds(new Array(n).fill(16));
  }
  checkThresholds([16, 1, 1, 1, 1, 1, 1, 1]);
  checkThresholds([1, 1, 1, 1, 1, 1, 1, 16]);
  checkThresholds([16, 1, 1, 1, 1, 1, 1, 16]);
});

test('encounter entry totals and the row plan follow the compiled-entry rules', () => {
  const project = liveGroups(rpgProject(), 6);
  project.encounterGroups[4].monsters = []; // dead
  manyGroupMaps(project, [
    [{ group: 3, weight: 1 }, { group: 1, weight: 1 }], // 2 entries
    [], // fallback => 1
    [{ group: 4, weight: 1 }] // only a dead group => fallback => 1
  ]);
  project.maps.push(Object.assign(createMap(3, 'Zero'), { encounters: groupEncounters(0, rows(3)) }));
  project.maps.push(Object.assign(createMap(4, 'Legacy'), { encounters: { rate: 5, actorIds: [0] } }));
  const n = normalized(project);
  assert.deepEqual(n.maps.map((_, i) => mapCompiledEntryCount(n, i)), [2, 1, 1, 0, 0]);
  assert.equal(encounterEntryTotal(n), 4);
  // dense by authored id (1 then 3); group 4 is dead, groups 0/2/5 unreferenced, the rate-0 map's rows (0..2) add none
  assert.deepEqual(encounterRowPlan(n), { groups: [1, 3], fallback: true, count: 3 });
  n.maps[1].encounters.table = rows(1, 5);
  n.maps[2].encounters.table = rows(1, 5);
  assert.deepEqual(encounterRowPlan(n), { groups: [1, 3, 5], fallback: false, count: 3 }, 'no fallback, no empty row');
});

// ---------------------------------------------------------------------------
// Both renumbers
// ---------------------------------------------------------------------------

test('renumberActorDeletion walks group monsters: removes, shifts, keeps NO_ACTOR, keeps an emptied group', () => {
  const project = rpgProject(4);
  project.encounterGroups = [
    { name: 'A', monsters: [0, 1, 2, 3] },
    { name: 'B', monsters: [1] },
    { name: 'C', monsters: [255, 3] }
  ];
  project.maps[0].encounters = groupEncounters(4, [{ group: 0, weight: 1 }], [1, 2]);
  const n = normalized(project);
  renumberActorDeletion(n, 1);
  assert.deepEqual(n.encounterGroups.map((g) => g.monsters), [[0, 1, 2], [], [255, 2]]);
  assert.equal(n.encounterGroups.length, 3, 'an emptied group stays');
  assert.deepEqual(n.maps[0].encounters.actorIds, [1], 'the dormant list is renumbered like any other');
  assert.deepEqual(n.maps[0].encounters.table, [{ group: 0, weight: 1 }]);
  assert.deepEqual(mapEncounterEntries({ ...n, sprites: { ...n.sprites, actors: n.sprites.actors.slice(0, 3) } }, 0), [{ group: 0, weight: 1 }]);
  renumberActorDeletion(n, 0);
  renumberActorDeletion(n, 0);
  assert.deepEqual(n.encounterGroups[2].monsters, [255, 0], 'NO_ACTOR is a fixed point across deletions');
});

test('renumberEncounterGroupDeletion: drops the rows, shifts higher ids, keeps mode, keeps an emptied table, skips legacy maps', () => {
  const project = liveGroups(rpgProject(), 4);
  project.maps = [
    Object.assign(createMap(0, 'A'), { encounters: groupEncounters(3, [{ group: 0, weight: 1 }, { group: 2, weight: 2 }, { group: 3, weight: 3 }], [1]) }),
    Object.assign(createMap(1, 'B'), { encounters: groupEncounters(3, [{ group: 2, weight: 5 }]) }),
    Object.assign(createMap(2, 'C'), { encounters: { rate: 3, actorIds: [0, 1] } })
  ];
  const n = normalized(project);
  renumberEncounterGroupDeletion(n, 2);
  n.encounterGroups.splice(2, 1);
  assert.deepEqual(n.maps[0].encounters.table, [{ group: 0, weight: 1 }, { group: 2, weight: 3 }], 'row 3 became row 2');
  assert.deepEqual(n.maps[1].encounters, groupEncounters(3, []), 'the emptied table stays, mode untouched');
  assert.deepEqual(n.maps[2].encounters, { rate: 3, actorIds: [0, 1] });
  assert.deepEqual(n.maps[0].encounters.actorIds, [1]);
  assert.deepEqual(n.maps[0].encounters.table.map((e) => n.encounterGroups[e.group].name), ['G0', 'G3'], 'each row still names the group it named');
});

test('monsterActorIds counts a group member as an authored monster mention', () => {
  const project = normalized({ ...rpgProject(4), encounterGroups: [{ name: 'G', monsters: [2, 9] }] });
  assert.deepEqual(monsterActorIds(project), [2], 'in-range ids only');
});

// ---------------------------------------------------------------------------
// Draw cost: a group map charges its groups, not its dormant list
// ---------------------------------------------------------------------------

test('battle draw cost: a group map charges each live group; the dormant actorIds and a rate-0 map charge nothing', () => {
  const project = rpgProject(3);
  const tiles = (n) => ({ tiles: Array.from({ length: n }, () => ({})) });
  project.sprites.metasprites = [tiles(1), tiles(5)];
  project.sprites.animations = [{ frames: [{ metaspriteId: 0 }] }, { frames: [{ metaspriteId: 1 }] }];
  project.sprites.actors[0].anims = { idle: 0 }; // 1 tile
  project.sprites.actors[1].anims = { idle: 1 }; // 5 tiles
  project.sprites.actors[2].anims = { idle: 1 }; // 5 tiles
  const mapper = resolveMapper(project.cartridge.mapper);
  const cost = (encounters) => {
    const copy = structuredClone(project);
    copy.encounterGroups = [
      { name: 'Light', monsters: [0, 0, 0] }, // 3
      { name: 'Heavy', monsters: [1, 2] } // 10
    ];
    copy.maps[0].encounters = encounters;
    return battleCombatantOamMax(normalized(copy), mapper);
  };
  const none = cost({ rate: 0, actorIds: [] });
  assert.equal(cost(groupEncounters(4, [{ group: 0, weight: 1 }], [1, 2])) - none, 3, 'dormant [5+5] is not charged');
  assert.equal(cost(groupEncounters(4, [{ group: 0, weight: 1 }, { group: 1, weight: 1 }], [])) - none, 10, 'each group at its own cost');
  assert.equal(cost(groupEncounters(0, [{ group: 1, weight: 1 }], [1, 2])) - none, 0, 'rate 0 charges none');
  assert.equal(cost(groupEncounters(4, [], [1, 2])) - none, 0, 'an empty group table charges nothing, not the list');
  assert.equal(cost({ rate: 4, actorIds: [1, 2] }) - none, 10, 'a legacy map is unchanged');
});

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

test('conversion plan: the legacy prefix law for k = 1..4, weights and thresholds', () => {
  const expectedWeights = { 1: [4], 2: [1, 3], 3: [1, 1, 2], 4: [1, 1, 1, 1] };
  const expectedThresholds = { 1: [255], 2: [63, 255], 3: [63, 127, 255], 4: [63, 127, 191, 255] };
  for (let k = 1; k <= 4; k++) {
    const project = normalized(rpgProject(4));
    project.maps[0].encounters = { rate: 5, actorIds: [0, 1, 2, 3].slice(0, k) };
    const plan = planEncounterConversion(project, 0);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.table.map((e) => e.weight), expectedWeights[k]);
    assert.deepEqual(encounterThresholds(plan.table.map((e) => e.weight)), expectedThresholds[k]);
    assert.deepEqual(plan.newGroups.map((g) => g.monsters), [[0], [0, 1], [0, 1, 2], [0, 1, 2, 3]].slice(0, k));
    applyEncounterConversion(project, plan);
    assert.deepEqual(project.encounterGroups.map((g) => g.monsters), plan.newGroups.map((g) => g.monsters));
    assert.equal(project.maps[0].encounters.mode, 'groups');
    assert.deepEqual(project.maps[0].encounters.actorIds, [0, 1, 2, 3].slice(0, k), 'the list is retained');
    assert.deepEqual(mapEncounterEntries(project, 0).map((e) => e.weight), expectedWeights[k]);
  }
});

test('conversion plan: names join actor names, blank names read #id, long names truncate', () => {
  const project = rpgProject(3);
  project.sprites.actors[1].name = '   ';
  project.sprites.actors[2].name = 'W'.repeat(40);
  project.maps[0].encounters = { rate: 5, actorIds: [0, 1, 2] };
  const plan = planEncounterConversion(normalized(project), 0);
  assert.deepEqual(plan.newGroups.map((g) => g.name), ['A', 'A + #1', ('A + #1 + ' + 'W'.repeat(40)).slice(0, AUTHOR_NAME_MAX)]);
});

test('conversion plan: an identical formation reuses the existing group under its own name', () => {
  const project = rpgProject(3);
  project.encounterGroups = [{ name: 'Starter pair', monsters: [0, 1] }, { name: 'Other', monsters: [1, 0] }];
  project.maps[0].encounters = { rate: 5, actorIds: [0, 1] };
  const n = normalized(project);
  const plan = planEncounterConversion(n, 0);
  assert.deepEqual(plan.newGroups, [{ name: 'A', monsters: [0] }]);
  assert.deepEqual(plan.table, [{ group: 2, weight: 1 }, { group: 0, weight: 3 }], 'the order [1,0] is a different formation');
  applyEncounterConversion(n, plan);
  assert.equal(n.encounterGroups.length, 3);
  assert.equal(n.encounterGroups[0].name, 'Starter pair');
});

test('conversion plan: L comes from the padded formation (out-of-range ids dropped, short lists fine)', () => {
  const project = rpgProject(2);
  project.maps[0].encounters = { rate: 5, actorIds: [0, 200, 1] };
  const n = normalized(project);
  assert.deepEqual(mapEncounterFormation(n.maps[0], 2), [0, 1, NO_ACTOR, NO_ACTOR]);
  const plan = planEncounterConversion(n, 0);
  assert.deepEqual(plan.newGroups.map((g) => g.monsters), [[0], [0, 1]]);
  assert.deepEqual(plan.table.map((e) => e.weight), [1, 3], 'k = 2, not 3');
});

test('conversion plan: an empty list converts to an empty table and creates nothing', () => {
  const project = normalized(rpgProject());
  project.maps[0].encounters = { rate: 5, actorIds: [] };
  const plan = planEncounterConversion(project, 0);
  assert.deepEqual(plan, { ok: true, mapIndex: 0, newGroups: [], table: [] });
  applyEncounterConversion(project, plan);
  assert.deepEqual(project.maps[0].encounters, groupEncounters(5, []));
  assert.deepEqual(project.encounterGroups, []);
});

test('conversion plan: a refused plan changes nothing and names the numbers', () => {
  const filler = (project, count) => {
    project.encounterGroups = Array.from({ length: count }, (_, i) => ({ name: `F${i}`, monsters: [2] }));
  };
  const attempt = (existing, ids) => {
    const project = rpgProject(3);
    filler(project, existing);
    project.maps[0].encounters = { rate: 5, actorIds: ids };
    const n = normalized(project);
    const before = structuredClone(n);
    const plan = planEncounterConversion(n, 0);
    assert.deepEqual(n, before, 'planning is pure');
    return plan;
  };
  assert.equal(attempt(31, [0]).ok, true, '31 groups: one new group fits');
  const two = attempt(31, [0, 1]);
  assert.equal(two.ok, false, '31 groups: two new groups do not');
  assert.equal(
    two.message,
    'Converting World needs 2 new groups; the project has room for 1 (limit 32). ' +
      "Delete unused groups in the Monster Forge, or pick fewer actors in World's list."
  );
  assert.equal(attempt(32, [0]).ok, false, '32 groups: nothing new fits');
  const four = attempt(30, [0, 1, 2]);
  assert.match(four.message, /needs 3 new groups; the project has room for 2 \(limit 32\)/);
  // 32 groups with the prefixes already present: only a fully reusing plan passes
  const project = rpgProject(3);
  filler(project, 30);
  project.encounterGroups.push({ name: 'p1', monsters: [0] }, { name: 'p2', monsters: [0, 1] });
  project.maps[0].encounters = { rate: 5, actorIds: [0, 1] };
  assert.equal(planEncounterConversion(normalized(project), 0).ok, true);
});

test('conversion plan: refuses a missing map and a map already in group mode', () => {
  const project = normalized(rpgProject());
  assert.equal(planEncounterConversion(project, 9).ok, false);
  project.maps[0].encounters = groupEncounters(3, []);
  assert.equal(planEncounterConversion(project, 0).ok, false);
});

test('conversion plan: the compiled-entry preflight, at both rates, around the 255 boundary', () => {
  const build = (existingTotal, rate, ids) => {
    const project = rpgProject(4);
    project.encounterGroups = [{ name: 'Z', monsters: [3] }];
    const tables = new Array(existingTotal).fill([]); // each: one fallback entry
    manyGroupMaps(project, tables);
    const target = createMap(existingTotal, 'Target');
    target.encounters = { rate, actorIds: ids };
    project.maps.push(target);
    return normalized(project);
  };
  const ok = (existingTotal, rate, ids) => {
    const project = build(existingTotal, rate, ids);
    assert.equal(encounterEntryTotal(project), existingTotal);
    return planEncounterConversion(project, existingTotal).ok;
  };
  // k = 0 rate-positive costs its one fallback entry
  assert.equal(ok(254, 1, []), true, '254 -> 255');
  assert.equal(ok(255, 1, []), false, '255 -> 256');
  assert.equal(ok(255, 0, []), true, 'rate 0, k = 0 costs none');
  // k >= 1 rate-positive costs k; rate 0 costs none
  assert.equal(ok(253, 1, [0, 1]), true, '253 + 2 = 255');
  assert.equal(ok(254, 1, [0, 1]), false, '254 + 2 = 256');
  assert.equal(ok(255, 0, [0, 1]), true, 'rate 0, k = 2 costs none');
  const refused = planEncounterConversion(build(254, 1, [0, 1]), 254);
  assert.match(refused.message, /needs 2 encounter table entries; the project has room for 1 \(limit 255\)/);

  // The project's total after conversion must fit, so a project already over the limit refuses even a
  // zero-cost (rate 0) conversion; at exactly 255 the same conversions pass (asserted above).
  for (const [rate, ids] of [[0, []], [0, [0]], [0, [0, 1]], [1, [0]]]) {
    const over = build(256, rate, ids);
    assert.equal(encounterEntryTotal(over), 256);
    const before = structuredClone(over);
    const plan = planEncounterConversion(over, 256);
    assert.equal(plan.ok, false, `256 existing, rate ${rate}, k = ${ids.length}`);
    assert.deepEqual(over, before, 'the whole project is unchanged');
    if (rate === 0) {
      assert.match(plan.message, /already over the encounter table limit by 1 entries \(256 of 255\)/);
    }
  }
  // The review's layout: 32 maps of eight live entries (256), then a legacy rate-0 target.
  const wide = liveGroups(rpgProject(4), 8);
  manyGroupMaps(wide, new Array(32).fill(rows(8)));
  wide.maps.push(Object.assign(createMap(32, 'Legacy'), { encounters: { rate: 0, actorIds: [0, 1] } }));
  const wideN = normalized(wide);
  assert.equal(encounterEntryTotal(wideN), 256);
  const wideBefore = structuredClone(wideN);
  assert.equal(planEncounterConversion(wideN, 32).ok, false);
  assert.deepEqual(wideN, wideBefore);
});

test('conversion plan carries mapIndex: applying a plan for map 2 changes map 2 only', () => {
  const project = rpgProject(2);
  project.maps = [0, 1, 2].map((i) => Object.assign(createMap(i, `M${i}`), { encounters: { rate: 3, actorIds: [0, 1] } }));
  const n = normalized(project);
  const plan = planEncounterConversion(n, 2);
  assert.equal(plan.mapIndex, 2);
  applyEncounterConversion(n, plan);
  assert.deepEqual(n.maps.map((m) => m.encounters.mode), [undefined, undefined, 'groups']);
  assert.throws(() => applyEncounterConversion(n, { ok: false, message: 'no' }));
});

test('useLegacyEncounterList: removes mode and table, keeps the groups, and the actorIds are live again', () => {
  const project = normalized(rpgProject());
  project.maps[0].encounters = { rate: 5, actorIds: [0, 1] };
  applyEncounterConversion(project, planEncounterConversion(project, 0));
  const groups = structuredClone(project.encounterGroups);
  useLegacyEncounterList(project, 0);
  assert.deepEqual(project.maps[0].encounters, { rate: 5, actorIds: [0, 1] });
  assert.deepEqual(project.encounterGroups, groups);
  assert.deepEqual(mapEncounterFormation(project.maps[0], 3), [0, 1, NO_ACTOR, NO_ACTOR]);
  assert.doesNotThrow(() => useLegacyEncounterList(project, 99));
});

test('conversion through a store: a refusal opens no commit; a success is one whole-project undo entry', () => {
  // The conversion caller's order, written out here against a real Store (the Map Forge caller itself
  // lands with its UI): plan outside the commit, refuse by returning, apply alone inside the commit.
  const convert = (store, mapIndex) => {
    const plan = planEncounterConversion(store.project, mapIndex);
    if (!plan.ok) return plan.message;
    store.commit('Convert to groups', (project) => applyEncounterConversion(project, plan));
    return null;
  };
  const project = normalized(rpgProject(4));
  project.maps[0].encounters = { rate: 5, actorIds: [0, 1, 2, 3] };
  project.encounterGroups = Array.from({ length: 30 }, (_, i) => ({ name: `F${i}`, monsters: [3, 3] }));
  const store = new Store();
  store.open('/tmp/enc', project);
  let commits = 0;
  const realCommit = store.commit.bind(store);
  store.commit = (...args) => {
    commits++;
    return realCommit(...args);
  };
  const before = structuredClone(store.project);
  const [revision, undo, redo, dirty] = [store.revision, store.undoStack.length, store.redoStack.length, store.dirty];
  assert.match(convert(store, 0), /needs 4 new groups/);
  assert.equal(commits, 0, 'commit was never called');
  assert.deepEqual([store.revision, store.undoStack.length, store.redoStack.length, store.dirty], [revision, undo, redo, dirty]);
  assert.deepEqual(store.project, before);

  store.project.encounterGroups.length = 0; // room again
  assert.equal(convert(store, 0), null);
  assert.equal(commits, 1);
  assert.equal(store.undoStack.length, 1);
  const converted = structuredClone(store.project);
  assert.equal(converted.maps[0].encounters.mode, 'groups');
  store.undo();
  assert.equal(store.project.maps[0].encounters.mode, undefined);
  assert.deepEqual(store.project.encounterGroups, []);
  store.redo();
  assert.deepEqual(store.project, converted);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('validation: legacy projects raise none of the new rules and keep encounter-actor-missing', () => {
  const project = rpgProject(2);
  project.maps[0].encounters = { rate: 5, actorIds: [0, 77] };
  const issues = validateProject(normalized(project));
  assert.deepEqual(encounterIssues(normalized(project)), []);
  assert.equal(issues.filter((i) => i.rule === 'encounter-actor-missing').length, 1);
});

test('validation: a group-mode map’s dormant actorIds are not checked as its table', () => {
  const project = rpgProject(2);
  project.encounterGroups = [{ name: 'G', monsters: [0] }];
  project.maps[0].encounters = groupEncounters(5, [{ group: 0, weight: 1 }], [0, 77]);
  assert.equal(validateProject(normalized(project)).some((i) => i.rule === 'encounter-actor-missing'), false);
});

test('validation: encounter-group-actor-missing names the group', () => {
  const project = rpgProject(2);
  project.encounterGroups = [{ name: 'Fine', monsters: [0, 1] }, { name: 'Stale', monsters: [0, 5] }];
  const [issue, ...rest] = encounterIssues(normalized(project));
  assert.equal(rest.length, 0);
  assert.equal(issue.rule, 'encounter-group-actor-missing');
  assert.equal(issue.severity, 'warning');
  assert.equal(issue.message, 'Group "Stale" names an actor that no longer exists.');
  assert.deepEqual(issue.subject, { group: 1 });
});

test('validation: encounter-table-empty needs rate > 0 and no live entry (never-filled and emptied alike)', () => {
  const run = (rate, table, groups = [{ name: 'G', monsters: [0] }, { name: 'Dead', monsters: [] }]) => {
    const project = rpgProject(2);
    project.encounterGroups = groups;
    project.maps[0].encounters = groupEncounters(rate, table, [0, 1]);
    return encounterIssues(normalized(project)).map((i) => i.rule);
  };
  assert.deepEqual(run(5, []), ['encounter-table-empty']);
  assert.deepEqual(run(5, [{ group: 1, weight: 1 }]), ['encounter-table-empty'], 'only a dead group');
  assert.deepEqual(run(0, []), [], 'rate 0 never rolls');
  assert.deepEqual(run(5, [{ group: 0, weight: 1 }]), []);
  const project = rpgProject(2);
  project.maps[0].encounters = groupEncounters(5, []);
  const [warning] = encounterIssues(normalized(project));
  assert.equal(warning.severity, 'warning');
  assert.equal(warning.where, 'Map Forge');
  assert.deepEqual(warning.subject, { map: 0 });
});

test('validation: encounter-entries-over is exact at 255 / 256 and counts fallback entries and skips rate-0 maps', () => {
  const project = liveGroups(rpgProject(), 8);
  manyGroupMaps(project, [...new Array(31).fill(rows(8)), rows(7), rows(1)]); // 248 + 7 + 1
  const at255 = normalized(project);
  assert.equal(encounterEntryTotal(at255), 256);
  assert.deepEqual(encounterErrors(at255).map((i) => i.rule), ['encounter-entries-over']);
  at255.maps[31].encounters.table.pop(); // 7 -> 6 entries
  assert.equal(encounterEntryTotal(at255), 255);
  assert.deepEqual(encounterErrors(at255), []);
  at255.maps.push(Object.assign(createMap(33, 'Quiet'), { encounters: groupEncounters(0, rows(8)) }));
  assert.equal(encounterEntryTotal(at255), 255, 'a rate-0 group map costs none');
  assert.deepEqual(encounterErrors(at255), []);
  const one = normalizeProject(structuredClone(at255));
  one.maps.push(Object.assign(createMap(34, 'Fallback'), { encounters: groupEncounters(1, []) }));
  assert.equal(encounterEntryTotal(one), 256, 'a fallback entry counts');
  assert.equal(encounterErrors(one)[0].rule, 'encounter-entries-over');
  assert.deepEqual(encounterErrors(one)[0].counts, [256, 255]);
});

test('validation: the overflow advice names edits that lower the total (31 x 8 + 7 + 1 = 256)', () => {
  const project = liveGroups(rpgProject(), 8);
  manyGroupMaps(project, [...new Array(31).fill(rows(8)), rows(7), rows(1)]);
  const n = normalized(project);
  const single = n.maps[32];
  single.name = 'Singleton';
  const issue = encounterErrors(n)[0];
  assert.equal(issue.severity, 'error');
  assert.match(issue.message, /compile to 256 entries; the limit is 255, so 1 must go/);
  assert.match(issue.message, /M0 \(up to 7 of 8\)/);
  assert.match(issue.message, /M31 \(up to 6 of 7\)/);
  assert.match(issue.message, /remove 1 row from M0 \(8 entries\)/);
  assert.doesNotMatch(issue.message, /Singleton/, 'a lone entry frees nothing');

  const cleared = structuredClone(n);
  cleared.maps[32].encounters.table = [];
  assert.equal(encounterEntryTotal(cleared), 256, 'clearing the singleton row leaves its fallback entry');

  const applied = structuredClone(n);
  applied.maps[0].encounters.table.pop(); // the recommended edit
  assert.equal(encounterEntryTotal(applied), 255);
  assert.deepEqual(encounterErrors(applied), []);
});

test('validation: reducible total uses max(0, live - 1): fallback maps free nothing and are not a minus one', () => {
  const project = liveGroups(rpgProject(), 2);
  manyGroupMaps(project, [rows(2), ...new Array(254).fill([])]);
  const n = normalized(project);
  assert.equal(encounterEntryTotal(n), 256);
  const issue = encounterErrors(n)[0];
  assert.match(issue.message, /so 1 must go/);
  assert.match(issue.message, /remove 1 row from M0 \(2 entries\)/, 'one row off the two-entry table suffices');
  assert.doesNotMatch(issue.message, /cannot be enough/);
  n.maps[0].encounters.table.pop();
  assert.equal(encounterEntryTotal(n), 255);
  assert.deepEqual(encounterErrors(n), []);
});

test('validation: when row removal cannot suffice the advice is rate 0 or the actor list, and that edit validates clean', () => {
  const project = liveGroups(rpgProject(), 1);
  manyGroupMaps(project, new Array(300).fill(rows(1)));
  const n = normalized(project);
  assert.equal(encounterEntryTotal(n), 300);
  const issue = encounterErrors(n)[0];
  assert.match(issue.message, /so 45 must go/);
  assert.match(issue.message, /Removing rows cannot be enough/);
  assert.match(issue.message, /"Use the actor list again"/);
  const named = n.maps.filter((m) => issue.message.includes(`${m.name} (1 entry)`));
  assert.equal(named.length, 45);
  for (const map of named) map.encounters.rate = 0;
  assert.equal(encounterEntryTotal(n), 255);
  assert.deepEqual(encounterErrors(n), []);
  // and the actor-list way back frees them too
  const back = normalized(project);
  for (const map of named.map((m) => back.maps[m.id])) useLegacyEncounterList(back, map.id);
  assert.deepEqual(encounterErrors(back), []);
});

test('validation: encounter-rows-over is reached only by an un-normalized project (the normalizer caps groups at 32)', () => {
  const project = liveGroups(rpgProject(), 34);
  manyGroupMaps(project, Array.from({ length: 34 }, (_, i) => rows(1, i)));
  const issues = encounterErrors(project);
  assert.deepEqual(issues.map((i) => i.rule), ['encounter-rows-over']);
  assert.equal(issues[0].severity, 'error');
  assert.deepEqual(issues[0].counts, [34, 33]);
  const capped = normalized(project);
  assert.equal(capped.encounterGroups.length, 32);
  assert.deepEqual(encounterErrors(capped), [], 'after normalization the 33-row ceiling cannot be exceeded');
  // 32 live groups + one fallback map is exactly the 33-row ceiling and is accepted
  const edge = liveGroups(rpgProject(), 32);
  manyGroupMaps(edge, [...Array.from({ length: 32 }, (_, i) => rows(1, i)), []]);
  const plan = encounterRowPlan(normalized(edge));
  assert.equal(plan.count, 33);
  assert.deepEqual(encounterErrors(normalized(edge)), []);
});
