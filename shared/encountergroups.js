// The Monster Forge "Groups" tab's pure logic (encounter groups, handoff-next/encgroups design section 4): what the
// UI adds, renames, edits and deletes, and what it reports about a group. Every count, limit and renumbering comes
// from shared/project.js; this file only decides the editing moves, so the renderer holds no rule of its own.
// Each mutator takes the project inside one `store.commit` and never throws on a stale index.
// The Map Forge half (slice C4, below the Monster Forge helpers): the per-map table editor, Convert / way back, and what
// the battle-test section offers for a legacy map versus a group map.

import {
  AUTHOR_NAME_MAX,
  RPG_LIMITS,
  applyEncounterConversion,
  encounterEntryTotal,
  encounterGroupFormation,
  encounterGroupIsLive,
  encounterThresholds,
  mapEncounterFormation,
  mapUsesEncounterGroups,
  monsterActorIds,
  planEncounterConversion,
  renumberEncounterGroupDeletion,
  useLegacyEncounterList
} from './project.js';

/**
 * The same name rule `normalizeEncounterGroups` applies on load (whitespace collapsed, trimmed, at most
 * AUTHOR_NAME_MAX characters); encountergroupsui.test.js round-trips one through normalizeProject so the two cannot drift.
 */
export const cleanGroupName = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, AUTHOR_NAME_MAX);

/** Whether another group still fits, with the text that names the limit when it does not. */
export function groupRoom(project) {
  const count = project.encounterGroups?.length ?? 0;
  const limit = RPG_LIMITS.encounterGroups;
  return {
    count,
    limit,
    full: count >= limit,
    message: count >= limit ? `A project holds at most ${limit} encounter groups. Delete one to add another.` : null
  };
}

/** The first "Group N" (N from 1) no group already uses. */
function freshGroupName(project) {
  const used = new Set((project.encounterGroups ?? []).map((group) => group.name));
  let n = 1;
  while (used.has(`Group ${n}`)) n++;
  return `Group ${n}`;
}

/**
 * Plans a new group (empty, or a copy of group `copyOf`). Pure and refusing: `{ok:false, message}` leaves the caller
 * to show the text without ever calling `store.commit`.
 */
export function planAddGroup(project, copyOf = null) {
  const room = groupRoom(project);
  if (room.full) return { ok: false, message: room.message };
  const source = copyOf === null ? null : project.encounterGroups?.[copyOf];
  if (copyOf !== null && !source) return { ok: false, message: 'That group no longer exists.' };
  return {
    ok: true,
    group: source
      ? { name: cleanGroupName(`${source.name} copy`), monsters: [...source.monsters] }
      : { name: freshGroupName(project), monsters: [] }
  };
}

/** Appends a planned group and returns its index. */
export function applyAddGroup(project, plan) {
  project.encounterGroups ??= [];
  project.encounterGroups.push(structuredClone(plan.group));
  return project.encounterGroups.length - 1;
}

/** Renames group `index`; an empty or unchanged name changes nothing and answers false. */
export function renameGroup(project, index, raw) {
  const group = project.encounterGroups?.[index];
  const name = cleanGroupName(raw);
  if (!group || !name || name === group.name) return false;
  group.name = name;
  return true;
}

/**
 * Renames group `index` through `store` (the renderer's Store, or anything with `project` and `commit`). The decision is
 * made BEFORE `store.commit`, because commit snapshots, clears redo, bumps the revision and marks the project dirty
 * whatever its mutator returns: a blank name, a name that normalizes to the current one, or a group that is gone is
 * answered `false` with the store untouched. A real rename is exactly one commit. This is what the Name field calls.
 */
export function commitGroupRename(store, index, raw) {
  const group = store.project.encounterGroups?.[index];
  const name = cleanGroupName(raw);
  if (!group || !name || name === group.name) return false;
  store.commit('Rename encounter group', (draft) => {
    renameGroup(draft, index, name);
  });
  return true;
}

/**
 * Sets one monster slot of group `index`: `actorId` null clears the slot, a slot at the end appends, and the list
 * stays closed up (no gaps) at most RPG_LIMITS.encounterActors long. Duplicates are legal -- a group of two Slimes.
 */
export function setGroupMonster(project, index, slot, actorId) {
  const group = project.encounterGroups?.[index];
  if (!group || !Number.isInteger(slot) || slot < 0 || slot >= RPG_LIMITS.encounterActors) return false;
  const next = [...group.monsters];
  if (actorId === null || actorId === undefined) next.splice(slot, 1);
  else if (slot < next.length) next[slot] = actorId;
  else next.push(actorId);
  group.monsters = next.slice(0, RPG_LIMITS.encounterActors);
  return true;
}

/** Removes group `index` and rewrites every map table that named it, in the same call (one commit). */
export function deleteEncounterGroup(project, index) {
  if (!project.encounterGroups?.[index]) return false;
  project.encounterGroups.splice(index, 1);
  renumberEncounterGroupDeletion(project, index);
  return true;
}

/** The maps (indices) whose group-mode table names group `index`, any rate. */
export const mapsUsingGroup = (project, index) =>
  (project.maps ?? [])
    .map((map, mapIndex) => (mapUsesEncounterGroups(map) && (map.encounters.table ?? []).some((entry) => entry.group === index) ? mapIndex : -1))
    .filter((mapIndex) => mapIndex >= 0);

/** How many groups name actor `actorId` (a group naming it twice counts once): the Sprite Forge delete prompt's N. */
export const groupsNamingActor = (project, actorId) =>
  (project.encounterGroups ?? []).filter((group) => (group.monsters ?? []).includes(actorId)).length;

/**
 * What is wrong with group `index`: `missing` are the monster ids that name no actor (the
 * `encounter-group-actor-missing` warning), `dead` that no slot holds a live actor, so a fight from it starts nothing.
 */
export function groupProblems(project, index) {
  const group = project.encounterGroups?.[index];
  const actorCount = project.sprites?.actors?.length ?? 0;
  if (!group) return { missing: [], dead: false };
  return {
    missing: [...new Set(group.monsters.filter((id) => id >= actorCount))],
    dead: !encounterGroupIsLive(project, index)
  };
}

/**
 * The options one monster slot offers: the Monster Forge's own catalog, plus the slot's current id when it is not in
 * it (an id past the end of the actor table is labelled missing, never silently shown as another monster).
 */
export function groupSlotOptions(project, current) {
  const actors = project.sprites?.actors ?? [];
  const ids = monsterActorIds(project);
  const options = ids.map((id) => ({ value: id, label: actors[id]?.name ?? `#${id}`, missing: false }));
  if (Number.isInteger(current) && !ids.includes(current)) {
    options.push({ value: current, label: actors[current]?.name ?? `Missing actor #${current}`, missing: !actors[current] });
  }
  return options;
}

// ---------------------------------------------------------------------------
// The Map Forge's encounter section (slice C4). Every committing function takes the renderer's Store (or anything with
// `project` and `commit`), decides BEFORE `store.commit` -- commit snapshots, clears redo, bumps the revision and marks
// the project dirty whatever its mutator does -- and answers `{ok:true, changed}` or `{ok:false, message}`.
// ---------------------------------------------------------------------------

const NOT_GROUP_MODE = (map) => `${map?.name ?? 'This map'} does not use encounter groups.`;

/**
 * Whether the Map Forge shows the group-mode table editor for map `mapIndex`: whenever the map IS in group mode, and for
 * no other reason. Never a function of how many groups the project holds, of hostile actors, or of the retained actor
 * list -- deleting the only group must leave the empty-table warning and "Use the actor list again" on screen.
 */
export const encounterEditorVisible = (project, mapIndex) => mapUsesEncounterGroups(project.maps?.[mapIndex]);

/** Whether another row still fits in map `mapIndex`'s table, with the text that names the limit when it does not. */
export function tableRoom(project, mapIndex) {
  const count = project.maps?.[mapIndex]?.encounters?.table?.length ?? 0;
  const limit = RPG_LIMITS.encounterTableEntries;
  return {
    count,
    limit,
    full: count >= limit,
    message: count >= limit ? `A table holds at most ${limit} groups. Remove one to add another.` : null
  };
}

/**
 * The editor's view of map `mapIndex`'s table: every authored row with its group's name, whether the group is live (a
 * row naming a dead group is dropped by the compiler, `mapEncounterEntries`) and its chance of a fight, derived from
 * `encounterThresholds` over the LIVE rows only -- the bytes the ROM actually compares a roll against. The chance is
 * `width / 255` of the 255 possible rolls; a dead row has none (`percent: null`).
 */
export function tableRows(project, mapIndex) {
  const map = project.maps?.[mapIndex];
  if (!mapUsesEncounterGroups(map)) return [];
  const groups = project.encounterGroups ?? [];
  const table = map.encounters.table ?? [];
  const live = table.map((entry) => encounterGroupIsLive(project, entry.group));
  const liveWeights = table.filter((_, row) => live[row]).map((entry) => entry.weight);
  const thresholds = encounterThresholds(liveWeights);
  let liveRow = 0;
  return table.map((entry, row) => {
    let percent = null;
    if (live[row]) {
      const width = thresholds[liveRow] - (liveRow ? thresholds[liveRow - 1] : 0);
      percent = (width / 255) * 100;
      liveRow++;
    }
    return {
      row,
      group: entry.group,
      weight: entry.weight,
      name: groups[entry.group]?.name ?? `Missing group #${entry.group}`,
      live: live[row],
      percent
    };
  });
}

/** The groups a table row (or the Add menu) may choose: every project group not already in the table, plus `keep`. */
export function tableGroupChoices(project, mapIndex, keep = null) {
  const used = new Set((project.maps?.[mapIndex]?.encounters?.table ?? []).map((entry) => entry.group));
  return (project.encounterGroups ?? [])
    .map((group, index) => ({ value: index, label: group.name }))
    .filter((choice) => choice.value === keep || !used.has(choice.value));
}

/** Whether "+ Add group" can do anything for map `mapIndex`, and when it cannot, the sentence saying why. */
export function addRowState(project, mapIndex) {
  if (!(project.encounterGroups?.length ?? 0)) {
    return { disabled: true, message: 'The project has no encounter groups yet. Create one in the Monster Forge (Groups tab).' };
  }
  const room = tableRoom(project, mapIndex);
  if (room.full) return { disabled: true, message: room.message };
  if (!tableGroupChoices(project, mapIndex).length) {
    return { disabled: true, message: 'Every encounter group is already in this table.' };
  }
  return { disabled: false, message: null };
}

/**
 * Plans replacing map `mapIndex`'s table with `next`: refuses when the map is not in group mode, or when the change
 * would leave the project's compiled entry total over RPG_LIMITS.encounterEntriesTotal AND higher than it was before
 * (`after > limit && after > before`). So a project already over the limit (say 256) can still have a weight or group
 * changed, or a row removed, because those do not make the total worse; only an edit that raises it is refused.
 */
function planTable(project, mapIndex, next) {
  const map = project.maps?.[mapIndex];
  if (!mapUsesEncounterGroups(map)) return { ok: false, message: NOT_GROUP_MODE(map) };
  const before = encounterEntryTotal(project);
  const candidate = {
    ...project,
    maps: project.maps.map((entry, index) =>
      index === mapIndex ? { ...entry, encounters: { ...entry.encounters, table: next } } : entry
    )
  };
  const after = encounterEntryTotal(candidate);
  const limit = RPG_LIMITS.encounterEntriesTotal;
  if (after > limit && after > before) {
    return {
      ok: false,
      message:
        `${map.name}'s table cannot take that: the project would hold ${after} encounter table entries (limit ${limit}). ` +
        "Remove rows from other maps' tables, or set their encounter rate to 0."
    };
  }
  return { ok: true };
}

function commitTable(store, mapIndex, label, next) {
  const current = store.project.maps?.[mapIndex]?.encounters?.table ?? [];
  const plan = planTable(store.project, mapIndex, next);
  if (!plan.ok) return plan;
  if (JSON.stringify(current) === JSON.stringify(next)) return { ok: true, changed: false };
  store.commit(label, (draft) => {
    draft.maps[mapIndex].encounters.table = next.map(({ group, weight }) => ({ group, weight }));
  });
  return { ok: true, changed: true };
}

const clampWeight = (raw) => {
  const weight = Math.round(Number(raw));
  return Number.isFinite(weight) ? Math.max(1, Math.min(RPG_LIMITS.encounterWeightMax, weight)) : null;
};

/** Appends a row for `group` (weight 1). Refuses a full table, a group already in it, or one that does not exist. */
export function commitTableAdd(store, mapIndex, group) {
  const project = store.project;
  const map = project.maps?.[mapIndex];
  if (!mapUsesEncounterGroups(map)) return { ok: false, message: NOT_GROUP_MODE(map) };
  const state = addRowState(project, mapIndex);
  if (state.disabled) return { ok: false, message: state.message };
  if (!project.encounterGroups?.[group]) return { ok: false, message: 'That group no longer exists.' };
  if (map.encounters.table.some((entry) => entry.group === group)) {
    return { ok: false, message: `${project.encounterGroups[group].name} is already in this table. Raise its weight instead.` };
  }
  return commitTable(store, mapIndex, 'Add encounter table row', [...map.encounters.table, { group, weight: 1 }]);
}

/** Sets row `row`'s weight, clamped to 1..16; a non-number or an unchanged weight commits nothing. */
export function commitTableWeight(store, mapIndex, row, raw) {
  const map = store.project.maps?.[mapIndex];
  if (!mapUsesEncounterGroups(map)) return { ok: false, message: NOT_GROUP_MODE(map) };
  const current = map.encounters.table[row];
  const weight = clampWeight(raw);
  if (!current) return { ok: false, message: 'That row no longer exists.' };
  if (weight === null) return { ok: false, message: `A weight is a whole number from 1 to ${RPG_LIMITS.encounterWeightMax}.` };
  if (weight === current.weight) return { ok: true, changed: false };
  return commitTable(
    store,
    mapIndex,
    'Change encounter weight',
    map.encounters.table.map((entry, index) => (index === row ? { ...entry, weight } : entry))
  );
}

/** Points row `row` at another group; a group the table already holds is refused, the same group commits nothing. */
export function commitTableGroup(store, mapIndex, row, group) {
  const project = store.project;
  const map = project.maps?.[mapIndex];
  if (!mapUsesEncounterGroups(map)) return { ok: false, message: NOT_GROUP_MODE(map) };
  const current = map.encounters.table[row];
  if (!current) return { ok: false, message: 'That row no longer exists.' };
  if (!project.encounterGroups?.[group]) return { ok: false, message: 'That group no longer exists.' };
  if (group === current.group) return { ok: true, changed: false };
  if (map.encounters.table.some((entry) => entry.group === group)) {
    return { ok: false, message: `${project.encounterGroups[group].name} is already in this table.` };
  }
  return commitTable(
    store,
    mapIndex,
    'Change encounter table group',
    map.encounters.table.map((entry, index) => (index === row ? { ...entry, group } : entry))
  );
}

/** Removes row `row`. Removing the last row leaves a group-mode map with an empty table; only the way back changes mode. */
export function commitTableRemove(store, mapIndex, row) {
  const map = store.project.maps?.[mapIndex];
  if (!mapUsesEncounterGroups(map)) return { ok: false, message: NOT_GROUP_MODE(map) };
  if (!map.encounters.table[row]) return { ok: false, message: 'That row no longer exists.' };
  return commitTable(store, mapIndex, 'Remove encounter table row', map.encounters.table.filter((_, index) => index !== row));
}

/**
 * The Map Forge's "Convert to groups" caller, in the exact synchronous order design 2.5 fixes: plan from the store's
 * project, answer a refusal with its text WITHOUT calling `store.commit`, otherwise one commit whose mutator is only the
 * apply. A refusal therefore leaves the project, undo and redo stacks, dirty flag and revision as they were.
 */
export function commitConvertEncounters(store, mapIndex) {
  const plan = planEncounterConversion(store.project, mapIndex);
  if (!plan.ok) return { ok: false, message: plan.message };
  store.commit('Convert encounters to groups', (draft) => {
    applyEncounterConversion(draft, plan);
  });
  return { ok: true, changed: true };
}

/** Whether map `mapIndex` can go back to its actor list: only a group-mode map can. The confirm lives in the caller. */
export function planUseLegacyList(project, mapIndex) {
  const map = project.maps?.[mapIndex];
  return mapUsesEncounterGroups(map) ? { ok: true } : { ok: false, message: NOT_GROUP_MODE(map) };
}

/** The mutator for the way back (`useLegacyEncounterList` under a name that says what the author pressed). */
export const applyUseLegacyList = useLegacyEncounterList;

/**
 * What the Map Forge's Battle-test section offers for map `mapIndex`. A legacy map keeps its one "This map's table"
 * button (the full padded list). A group map has NO button labelled as its table -- that would fire the dormant
 * `actorIds`, which the map's own ROM picker never reads -- and instead one button per DISTINCT live group its table
 * names, or `emptyNote` when it names none. Visibility is a separate question from the editor's: a group map shows the
 * section when it has a group formation or the project has a hostile actor (for the hand-picked formation tool); a
 * legacy map when its list is non-empty or a hostile actor exists. `hostileCount` is the hand-picker's catalog size.
 */
export function battleTestOffer(project, mapIndex, hostileCount) {
  const map = project.maps?.[mapIndex];
  if (mapUsesEncounterGroups(map)) {
    const seen = new Set();
    const groupButtons = [];
    for (const entry of map.encounters.table ?? []) {
      if (seen.has(entry.group) || !encounterGroupIsLive(project, entry.group)) continue;
      seen.add(entry.group);
      groupButtons.push({
        group: entry.group,
        name: project.encounterGroups[entry.group].name,
        formation: encounterGroupFormation(project, entry.group)
      });
    }
    return {
      mode: 'groups',
      visible: groupButtons.length > 0 || hostileCount > 0,
      tableButton: null,
      groupButtons,
      emptyNote: groupButtons.length === 0
    };
  }
  const formation = mapEncounterFormation(map, project.sprites?.actors?.length ?? 0);
  const empty = formation.every((id) => id === 0xff);
  return {
    mode: 'legacy',
    visible: !empty || hostileCount > 0,
    tableButton: { formation, empty },
    groupButtons: [],
    emptyNote: false
  };
}
