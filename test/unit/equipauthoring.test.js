// Equipment (ROADMAP item 5), build commit C5: what the Items Forge's Equipment section and the Character Forge's Starting equipment row
// write (renderer/forges/items/equipui.js; docs/design-equipment.md section 7). Pure -- a real Store stands in for the window, so "one undo
// entry" is counted on the real undo stack. Each test names the wrong implementation it catches.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EQUIP_SLOTS,
  createPartyMember,
  createProject,
  normalizeProject,
  validateProject
} from '../../shared/project.js';
import { Store } from '../../renderer/store.js';
import {
  EQUIP_STATS,
  bindSelectToEquip,
  clampStat,
  commitAddMember,
  commitCanBeWorn,
  commitEquipSlot,
  commitEquipStat,
  commitSelectBinding,
  commitStartEquip,
  commitWornBy,
  defaultEquip,
  equipmentVisible,
  selectHelperOffered,
  wearableCount,
  wearablePieces
} from '../../renderer/forges/items/equipui.js';

const EVERYONE = 0b1111;
const item = (id, name, equip = null, effect = { kind: 'none', amount: 0 }) => ({ id, name, actorId: null, metaspriteId: null, effect, equip });
const gear = (slot, extra = {}) => ({ slot, atk: 0, def: 0, mag: 0, mdef: 0, usableBy: EVERYONE, ...extra });

/** An RPG of `members` party members; items 0 Potion, 1 Sword (weapon), 2 Axe (weapon, members 0 and 2 only), 3 Mail (armor), 4 Rock (plain). */
function rpg(members = 4) {
  const project = createProject('Gear', 'rpg');
  project.party = Array.from({ length: members }, (_, id) => createPartyMember(id));
  project.items = [
    item(0, 'Potion', null, { kind: 'heal', amount: 20 }),
    item(1, 'Sword', gear(0, { atk: 5 })),
    item(2, 'Axe', gear(0, { atk: 7, usableBy: 0b0101 })),
    item(3, 'Mail', gear(1, { def: 4 })),
    item(4, 'Rock')
  ];
  return project;
}
const opened = (project) => {
  const store = new Store();
  store.open('/nowhere', project);
  return store;
};
/** How many undo entries the action added. */
function undoCost(store, action) {
  const before = store.undoStack.length;
  action();
  return store.undoStack.length - before;
}
const ids = (list) => list.map((entry) => entry.id);

// ---------------------------------------------------------------------------------------------------- the per-slot starting list

test('wearablePieces: only the pieces of that slot this member may wear', () => {
  // Catches a list that ignores usableBy (member 1 would be offered the Axe it may not wear), one that ignores the slot (the Mail under
  // Weapon), and one that lists plain items (the Potion, the Rock).
  const project = rpg();
  assert.deepEqual(ids(wearablePieces(project, 0, 0)), [1, 2], 'member 0: both weapons');
  assert.deepEqual(ids(wearablePieces(project, 1, 0)), [1], 'member 1 is not in the Axe\'s mask');
  assert.deepEqual(ids(wearablePieces(project, 2, 0)), [1, 2]);
  assert.deepEqual(ids(wearablePieces(project, 0, 1)), [3], 'armor slot');
  assert.deepEqual(ids(wearablePieces(project, 0, 2)), [], 'no accessory exists');
  assert.deepEqual(wearablePieces(project, 1, 0), [{ id: 1, name: 'Sword' }]);
});

test('wearableCount: pieces of any slot the member may wear, nothing else', () => {
  // Catches a count of all pieces regardless of usableBy, one that counts only weapons, and one that counts plain items.
  const project = rpg();
  assert.equal(wearableCount(project, 0), 3);
  assert.equal(wearableCount(project, 1), 2, 'Sword and Mail; not the Axe');
  assert.equal(wearableCount(project, 3), 2);
  project.items[1].equip.usableBy = 0;
  assert.equal(wearableCount(project, 0), 2, 'a piece nobody wears counts for nobody');
});

// ---------------------------------------------------------------------------------------------------------- Can be worn

test('Can be worn on: a default weapon, every stat 0, everyone allowed, in one undo entry; undo and redo restore it', () => {
  // Catches a default with usableBy 0 (nobody can wear it), a default with non-zero stats, one that is not a weapon, and a toggle that
  // takes two commits.
  const store = opened(rpg());
  assert.equal(undoCost(store, () => commitCanBeWorn(store, 4, true)), 1);
  assert.deepEqual(store.project.items[4].equip, { slot: 0, atk: 0, def: 0, mag: 0, mdef: 0, usableBy: EVERYONE });
  assert.deepEqual(store.project.items[4].equip, defaultEquip());
  store.undo();
  assert.equal(store.project.items[4].equip, null);
  store.redo();
  assert.deepEqual(store.project.items[4].equip, defaultEquip());
});

test('Can be worn on, again, on a piece that already is one: the stats survive', () => {
  // Catches a toggle-on that rebuilds the default over a piece with authored stats.
  const project = rpg();
  commitCanBeWorn(opened(project), 1, true);
  const store = opened(project);
  commitCanBeWorn(store, 1, true);
  assert.equal(store.project.items[1].equip.atk, 5);
});

test('Can be worn off: the starting-equipment entries that named it are cleared in the SAME commit; the others stay', () => {
  // Catches a toggle-off that skips releaseEquipment (a dangling startEquip, which validate reports as an error), one that clears every
  // starting slot, and one that releases in a second commit.
  const project = rpg();
  project.party[0].startEquip = [1, 3, null];
  project.party[2].startEquip = [1, null, null];
  const store = opened(project);
  assert.equal(undoCost(store, () => commitCanBeWorn(store, 1, false)), 1, 'one undo entry');
  assert.equal(store.project.items[1].equip, null);
  assert.deepEqual(store.project.party[0].startEquip, [null, 3, null], 'the Sword is gone from member 0, the Mail stays');
  assert.deepEqual(store.project.party[2].startEquip, [null, null, null]);
  assert.deepEqual(validateProject(store.project).filter((p) => /^start-equip/.test(p.rule)), [], 'nothing dangles');
  store.undo();
  assert.deepEqual(store.project.party[0].startEquip, [1, 3, null], 'one undo restores the item and the starting slots together');
  assert.ok(store.project.items[1].equip);
});

// -------------------------------------------------------------------------------------------------------------- Slot

test('Slot change: starting equipment that named the piece in the slot it left is cleared, in one entry', () => {
  // Catches a slot select that edits only equip.slot (the Sword would stay in Weapon's starting slot while being an armor: validate's
  // start-equip-wrong-slot), and one that clears the slot it is moving INTO.
  const project = rpg();
  project.party[0].startEquip = [1, null, null];
  const store = opened(project);
  assert.equal(undoCost(store, () => commitEquipSlot(store, 1, 1)), 1);
  assert.equal(store.project.items[1].equip.slot, 1);
  assert.deepEqual(store.project.party[0].startEquip, [null, null, null]);
  assert.deepEqual(validateProject(store.project).filter((p) => /^start-equip/.test(p.rule)), []);
  const before = opened(rpg());
  commitEquipSlot(before, 1, 99);
  assert.equal(before.project.items[1].equip.slot, 0, 'a slot outside EQUIP_SLOTS is refused');
});

// ------------------------------------------------------------------------------------------------------------ stat fields

test('clampStat agrees with the normalizer on every kind of input', () => {
  // Catches a field clamp that differs from normalizeEquip's (a typed 300 stored as 300, -4 stored as -4, 2.6 left fractional, "" as NaN),
  // which would round-trip to a different value after the next load.
  for (const raw of [0, 7, 255, 256, 300, -4, 2.4, 2.6, '12', '', 'abc', null, undefined, NaN, Infinity, -Infinity, 1e9]) {
    const project = rpg();
    project.items[4].equip = gear(0, { atk: clampStat(raw) });
    const viaUi = normalizeProject(structuredClone(project)).items[4].equip.atk;
    const raw2 = rpg();
    raw2.items[4].equip = gear(0, { atk: raw });
    const viaNormalizer = normalizeProject(raw2).items[4].equip.atk;
    assert.equal(viaUi, viaNormalizer, `input ${String(raw)}`);
    assert.equal(clampStat(raw), viaNormalizer, `input ${String(raw)}`);
  }
});

test('stat fields write their own stat and nothing else, one entry per edit', () => {
  // Catches a field wired to the wrong stat key (Magic writing mdef), an unclamped write, and an edit that takes two commits.
  const store = opened(rpg());
  for (const [key, raw, expected] of [['atk', '9', 9], ['def', '300', 255], ['mag', '-3', 0], ['mdef', '2.6', 3]]) {
    assert.equal(undoCost(store, () => commitEquipStat(store, 1, key, raw)), 1, key);
    assert.equal(store.project.items[1].equip[key], expected, key);
  }
  assert.deepEqual(
    EQUIP_STATS.map((stat) => stat.key),
    ['atk', 'def', 'mag', 'mdef']
  );
  assert.deepEqual(
    EQUIP_STATS.map((stat) => stat.label),
    ['Attack', 'Defence', 'Magic', 'Magic defence'],
    'the names the shortfall messages and the Character Forge use for the same stats'
  );
  const piece = store.project.items[1].equip;
  assert.deepEqual({ ...piece, slot: undefined, usableBy: undefined }, { slot: undefined, atk: 9, def: 255, mag: 0, mdef: 3, usableBy: undefined });
  commitEquipStat(store, 1, 'bogus', 5);
  assert.equal(store.project.items[1].equip.bogus, undefined, 'an unknown stat key writes nothing');
});

// ------------------------------------------------------------------------------------------------------------- Worn by

test('Worn by: toggles exactly that member\'s bit; taking a member off also clears the slot they start in with this piece', () => {
  // Catches a checkbox that flips the wrong bit or replaces the mask, and one that leaves the member starting in a piece they may no longer
  // wear (validate's start-equip-not-allowed, an error the author never asked for).
  const project = rpg();
  project.party[1].startEquip = [1, null, null];
  const store = opened(project);
  assert.equal(undoCost(store, () => commitWornBy(store, 1, 1, false)), 1);
  assert.equal(store.project.items[1].equip.usableBy, 0b1101);
  assert.deepEqual(store.project.party[1].startEquip, [null, null, null]);
  assert.deepEqual(validateProject(store.project).filter((p) => /^start-equip/.test(p.rule)), []);
  commitWornBy(store, 1, 1, true);
  assert.equal(store.project.items[1].equip.usableBy, EVERYONE);
  commitWornBy(store, 1, 3, false);
  assert.equal(store.project.items[1].equip.usableBy, 0b0111);
  assert.deepEqual(store.project.party[0].startEquip, [null, null, null], 'another member\'s start is not touched');
  const other = rpg();
  other.party[3].startEquip = [2, null, null];
  other.items[2].equip.usableBy = 0b1111;
  const second = opened(other);
  commitWornBy(second, 1, 3, false);
  assert.deepEqual(second.project.party[3].startEquip, [2, null, null], 'taking a member off the Sword does not clear their Axe');
});

// ------------------------------------------------------------------------------------------------- Starting equipment select

test('Starting equipment: one entry per change, valid for validateProject, None clears', () => {
  // Catches a select that writes the option index instead of the item id, and one that adds the id to the wrong slot.
  const store = opened(rpg());
  assert.equal(undoCost(store, () => commitStartEquip(store, 0, 0, 2)), 1);
  commitStartEquip(store, 0, 1, 3);
  assert.deepEqual(store.project.party[0].startEquip, [2, 3, null]);
  assert.deepEqual(validateProject(store.project).filter((p) => /^start-equip/.test(p.rule)), []);
  commitStartEquip(store, 0, 0, null);
  assert.deepEqual(store.project.party[0].startEquip, [null, 3, null]);
});

// -------------------------------------------------------------------------------------------------------------- Add member

test('Add character: every "everyone" piece gains the newcomer, a limited piece does not, in ONE undo entry', () => {
  // Catches an Add that pushes the member without grantNewMember ("everyone" silently excluding the newcomer), one that grants every
  // piece (the Axe is limited), and an Add split into two commits (the grant surviving an undo of the push).
  const project = rpg(3);
  project.items[1].equip.usableBy = 0b0111; // everyone, of the three members that exist
  project.items[3].equip.usableBy = 0b0111;
  project.items[2].equip.usableBy = 0b0101; // limited
  const store = opened(project);
  assert.equal(undoCost(store, () => commitAddMember(store)), 1);
  assert.equal(store.project.party.length, 4);
  assert.equal(store.project.items[1].equip.usableBy, 0b1111);
  assert.equal(store.project.items[3].equip.usableBy, 0b1111);
  assert.equal(store.project.items[2].equip.usableBy, 0b0101);
  assert.equal(wearableCount(store.project, 3), 2, 'the newcomer can wear the two "everyone" pieces');
  store.undo();
  assert.equal(store.project.party.length, 3);
  assert.equal(store.project.items[1].equip.usableBy, 0b0111, 'one undo removes the member AND the grant');
  assert.equal(store.project.items[3].equip.usableBy, 0b0111);
});

// ------------------------------------------------------------------------------------------------------ the Select helper

test('Select helper: offered only with a piece, no equip binding anywhere, and Select free in the bag', () => {
  // Catches a helper that is offered with no piece, one offered when another button already opens Equip, and one offered on an action game.
  const project = rpg();
  assert.equal(project.input.states.menu.SELECT, 'none', 'the default the helper exists for');
  assert.equal(selectHelperOffered(project), true);
  const noPiece = rpg();
  noPiece.items.forEach((entry) => (entry.equip = null));
  assert.equal(selectHelperOffered(noPiece), false, 'nothing to open Equip for');
  const bound = rpg();
  bound.input.states.gameplay.START = 'equip';
  assert.equal(selectHelperOffered(bound), false, 'something already opens Equip');
  const elsewhere = rpg();
  elsewhere.input.states.title.A = 'equip';
  assert.equal(selectHelperOffered(elsewhere), true, 'a binding in a state where Equip is ignored does not count');
  const action = createProject('Act', 'action');
  action.items = [item(0, 'Sword', gear(0))];
  assert.equal(equipmentVisible(action), false);
  assert.equal(selectHelperOffered(action), false);
});

test('Select helper: binds Select in the bag to equip in one entry, and never overwrites a binding', () => {
  // Catches a helper that binds even when Select already does something (the author's "confirm" or "cancel" silently lost), and one
  // that leaves any other binding changed.
  const store = opened(rpg());
  const rows = structuredClone(store.project.input.states);
  assert.equal(undoCost(store, () => assert.equal(commitSelectBinding(store), true)), 1);
  assert.equal(store.project.input.states.menu.SELECT, 'equip');
  const expected = structuredClone(rows);
  expected.menu.SELECT = 'equip';
  assert.deepEqual(store.project.input.states, expected, 'only that one cell changed');
  store.undo();
  assert.equal(store.project.input.states.menu.SELECT, 'none');
  for (const taken of ['confirm', 'cancel', 'item', 'pause', 'equip']) {
    const busy = rpg();
    busy.input.states.menu.SELECT = taken;
    const guarded = opened(busy);
    assert.equal(undoCost(guarded, () => assert.equal(commitSelectBinding(guarded), false)), 0, `${taken}: no commit`);
    assert.equal(guarded.project.input.states.menu.SELECT, taken, `${taken} kept`);
    assert.equal(bindSelectToEquip(busy), false);
    assert.equal(busy.input.states.menu.SELECT, taken);
  }
});

// ------------------------------------------------------------------------------------------------------------ action games

test('an action game: equipment is invisible to the UI and the data is kept', () => {
  // Catches a predicate that shows the section for an action game, and a toggle that strips data from one.
  const action = createProject('Act', 'action');
  action.items = [item(0, 'Sword', gear(0, { atk: 3 }))];
  assert.equal(equipmentVisible(action), false);
  assert.equal(equipmentVisible(rpg()), true);
  assert.deepEqual(normalizeProject(structuredClone(action)).items[0].equip, { ...gear(0, { atk: 3 }), classes: null }, 'kept through normalization');
  assert.ok(validateProject(action).some((p) => p.rule === 'equip-ignored-action-game'), 'the C2 warning still shows');
  assert.equal(EQUIP_SLOTS.length, 3);
});
