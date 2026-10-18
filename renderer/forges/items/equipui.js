// The authoring side of equipment (ROADMAP item 5, C5; docs/design-equipment.md section 7): what the Items Forge's Equipment section and
// the Character Forge's Starting equipment row write. Pure -- no DOM -- so test/unit/equipui.test.js drives it without a window. The data
// model, the renumbering and the validate rules are shared/project.js's (releaseEquipment, grantNewMember, normalizeEquip); this file only
// composes them into the one `store.commit` per author action that the undo history wants.

import {
  EQUIP_SLOTS,
  RPG_LIMITS,
  createPartyMember,
  grantNewMember,
  releaseEquipment
} from '../../../shared/project.js';

// The four stats a piece adds, in the order the Forge lists them. `label` is the name the shortfall messages use for the same
// control ("the Magic field of every equipment piece in the Items Forge", main/build/battletables.js), and the Character Forge's
// own stat fields: one name per stat across the three places.
export const EQUIP_STATS = [
  { key: 'atk', label: 'Attack' },
  { key: 'def', label: 'Defence' },
  { key: 'mag', label: 'Magic' },
  { key: 'mdef', label: 'Magic defence' }
];

export const slotLabel = (slot) => EQUIP_SLOTS[slot].charAt(0).toUpperCase() + EQUIP_SLOTS[slot].slice(1);

/** Equipment is an RPG feature: an action game never shows a piece, whatever its items carry (design section 7). */
export const equipmentVisible = (project) => project.project?.gameType === 'rpg';

const everyoneMask = () => (1 << RPG_LIMITS.party) - 1;

/** What "Can be worn" turns on: a weapon adding nothing, any party member allowed. */
export function defaultEquip() {
  return { slot: 0, atk: 0, def: 0, mag: 0, mdef: 0, usableBy: everyoneMask() };
}

/** A stat the way normalizeEquip clamps it: rounded to an integer, 0-255, and 0 for anything that is not a number. */
export function clampStat(raw) {
  const number = Number(raw);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(255, Math.round(number)));
}

/** Whether party member `member` may wear `item` (item-side mask, bit i = member i). */
export const mayWear = (item, member) => Boolean(item.equip) && ((item.equip.usableBy >> member) & 1) === 1;

/** The pieces of `slot` that member may wear, as `{ id, name }` in item order: the choices of that slot's Starting equipment select. */
export function wearablePieces(project, member, slot) {
  const found = [];
  project.items.forEach((item, id) => {
    if (item.equip && item.equip.slot === slot && mayWear(item, member)) found.push({ id, name: item.name });
  });
  return found;
}

/** How many pieces, of any slot, that member may wear: the Character Forge's "Can wear N pieces". */
export function wearableCount(project, member) {
  return project.items.filter((item) => mayWear(item, member)).length;
}

// ---------------------------------------------------------------------------------------------------------- project mutators

/**
 * "Can be worn". On: a default weapon. Off: the piece stops being one, and every starting-equipment entry that named it goes with
 * it (releaseEquipment) -- in the caller's one commit, since commit() never runs normalizeProject. Turning it on for something
 * already worn is a no-op, so a stale second click cannot reset the stats.
 */
export function setCanBeWorn(project, itemIndex, on) {
  const item = project.items[itemIndex];
  if (!item) return project;
  if (on) {
    if (!item.equip) item.equip = defaultEquip();
  } else {
    releaseEquipment(project, itemIndex);
    item.equip = null;
  }
  return project;
}

/** Move a piece to another slot; starting equipment that named it in the slot it left is cleared in the same step. */
export function setEquipSlot(project, itemIndex, slot) {
  const item = project.items[itemIndex];
  if (!item?.equip || !Number.isInteger(slot) || slot < 0 || slot >= EQUIP_SLOTS.length) return project;
  releaseEquipment(project, itemIndex, slot);
  item.equip.slot = slot;
  return project;
}

export function setEquipStat(project, itemIndex, key, raw) {
  const item = project.items[itemIndex];
  if (!item?.equip || !EQUIP_STATS.some((stat) => stat.key === key)) return project;
  item.equip[key] = clampStat(raw);
  return project;
}

/**
 * A "Worn by" checkbox. Taking a member off also clears the starting slot they hold this very piece in: leaving it would be a
 * `start-equip-not-allowed` error the author never asked for.
 */
export function setWornBy(project, itemIndex, member, on) {
  const item = project.items[itemIndex];
  if (!item?.equip || !Number.isInteger(member) || member < 0 || member >= RPG_LIMITS.party) return project;
  if (on) item.equip.usableBy |= 1 << member;
  else {
    item.equip.usableBy &= ~(1 << member);
    const start = project.party[member]?.startEquip;
    if (start && start[item.equip.slot] === itemIndex) start[item.equip.slot] = null;
  }
  return project;
}

/** One Starting equipment select. `id` is a piece id, or null for None. */
export function setStartEquip(project, member, slot, id) {
  const entry = project.party[member];
  if (!entry || !Number.isInteger(slot) || slot < 0 || slot >= EQUIP_SLOTS.length) return project;
  if (!Array.isArray(entry.startEquip)) entry.startEquip = new Array(RPG_LIMITS.equipSlots).fill(null);
  entry.startEquip[slot] = id;
  return project;
}

/** The Character Forge's Add: the new member, and every "everyone" piece gains them, as one step (design section 1). */
export function appendPartyMember(project) {
  const index = project.party.length;
  project.party.push(createPartyMember(index));
  grantNewMember(project, index);
  return project;
}

// ------------------------------------------------------------------------------------------------- the Select-in-bag helper

const actionBound = (project, action) =>
  ['gameplay', 'menu'].some((state) => Object.values(project.input?.states?.[state] ?? {}).includes(action));

/**
 * Whether to offer "Open Equip from the bag with Select": the project has a piece, nothing in play or the bag opens Equip yet,
 * and Select in the bag is free. Quiet otherwise -- a Select that already does something is never taken away, and with another
 * binding in place the C4 validate warning has nothing left to say.
 */
export function selectHelperOffered(project) {
  if (!equipmentVisible(project) || !project.items.some((item) => item.equip)) return false;
  if (actionBound(project, 'equip')) return false;
  return project.input?.states?.menu?.SELECT === 'none';
}

/** Bind Select in the bag to Equip -- only when it is unbound. Returns whether it bound. */
export function bindSelectToEquip(project) {
  if (project.input?.states?.menu?.SELECT !== 'none') return false;
  project.input.states.menu.SELECT = 'equip';
  return true;
}

// ----------------------------------------------------------------------------------------------- one commit per author action

export const commitCanBeWorn = (store, itemIndex, on) =>
  store.commit(on ? 'Make item wearable' : 'Make item ordinary', (project) => setCanBeWorn(project, itemIndex, on));
export const commitEquipSlot = (store, itemIndex, slot) =>
  store.commit('Change equipment slot', (project) => setEquipSlot(project, itemIndex, slot));
export const commitEquipStat = (store, itemIndex, key, raw) =>
  store.commit('Change equipment bonus', (project) => setEquipStat(project, itemIndex, key, raw));
export const commitWornBy = (store, itemIndex, member, on) =>
  store.commit('Change who wears equipment', (project) => setWornBy(project, itemIndex, member, on));
export const commitStartEquip = (store, member, slot, id) =>
  store.commit('Change starting equipment', (project) => setStartEquip(project, member, slot, id));
export const commitAddMember = (store) => store.commit('Add character', appendPartyMember);
/** Returns whether it bound; the commit happens only when there is something to bind. */
export function commitSelectBinding(store) {
  if (store.project?.input?.states?.menu?.SELECT !== 'none') return false;
  store.commit('Bind Select in the bag to Equip', bindSelectToEquip);
  return true;
}
