// The Monster Forge "Groups" tab's pure logic (encounter groups, handoff-next/encgroups design section 4): what the
// UI adds, renames, edits and deletes, and what it reports about a group. Every count, limit and renumbering comes
// from shared/project.js; this file only decides the editing moves, so the renderer holds no rule of its own.
// Each mutator takes the project inside one `store.commit` and never throws on a stale index.

import {
  AUTHOR_NAME_MAX,
  RPG_LIMITS,
  encounterGroupIsLive,
  mapUsesEncounterGroups,
  monsterActorIds,
  renumberEncounterGroupDeletion
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
