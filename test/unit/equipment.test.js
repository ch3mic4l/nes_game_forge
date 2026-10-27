// Equipment (ROADMAP item 5), build commit C2: the data model only (docs/design-equipment.md sections 1, 6, 10 rows 1-4).
// Nothing here builds a ROM or touches the engine -- C2 changes no byte of any ROM; test/unit/equipidentity.test.js proves that.
// Every test names the wrong implementation it catches. Nothing touches a checked-in fixture.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import {
  ACTIONS,
  EQUIP_SLOTS,
  NO_ITEM,
  RPG_LIMITS,
  createPartyMember,
  createProject,
  grantNewMember,
  normalizeProject,
  projectUsesEquipment,
  projectUsesMagicDefence,
  projectUsesMagicPower,
  releaseEquipment,
  renumberItemDeletion,
  renumberPartyMemberDeletion,
  validateProject
} from '../../shared/project.js';
import { checkBattleTables } from '../../main/build/battletables.js';
import { generateAssets } from '../../main/build/generate.js';
import { Store } from '../../renderer/store.js';

const EVERYONE = 0b1111;

const piece = (id, name, slot, equip = {}) => ({
  id,
  name,
  actorId: null,
  metaspriteId: null,
  effect: { kind: 'none', amount: 0 },
  equip: { slot, atk: 0, def: 0, mag: 0, mdef: 0, usableBy: EVERYONE, ...equip }
});
const plain = (id, name, effect = { kind: 'none', amount: 0 }) => ({
  id,
  name,
  actorId: null,
  metaspriteId: null,
  effect,
  equip: null
});

/** An RPG with four members and items 0 Potion, 1 Sword (weapon), 2 Mail (armor), 3 Ring (accessory). */
function rpg() {
  const project = createProject('Equip', 'rpg');
  project.party = [0, 1, 2, 3].map((id) => createPartyMember(id));
  project.items = [
    plain(0, 'Potion', { kind: 'heal', amount: 20 }),
    piece(1, 'Sword', 0, { atk: 5 }),
    piece(2, 'Mail', 1, { def: 4 }),
    piece(3, 'Ring', 2, { mdef: 2 })
  ];
  return project;
}

const problemsOf = (project, rule) => validateProject(project).filter((p) => p.rule === rule);
const identity = ({ severity, where, rule, subject, counts }) => ({ severity, where, rule, subject, counts });

// ---------------------------------------------------------------------------------------------------- the constants

test('EQUIP_SLOTS is the append-only wire order and RPG_LIMITS.equipSlots is its length', () => {
  // Catches a slot count that lives in two places: the RAM size, the save field and the menu all derive from RPG_LIMITS.equipSlots.
  assert.deepEqual(EQUIP_SLOTS, ['weapon', 'armor', 'accessory']);
  assert.equal(RPG_LIMITS.equipSlots, 3);
  assert.equal(EQUIP_SLOTS.length, RPG_LIMITS.equipSlots);
});

test('ACTIONS gained `equip` at index 9 and ACT_EQUIP in constants.asm is that index (C4)', () => {
  // Catches an action appended in the JS list but not in the engine's ACT_* table (or in a different position): the input table is
  // written as ACTIONS indices, so the two numberings are one wire format. The nine earlier actions must not move.
  assert.equal(ACTIONS.length, 10);
  assert.equal(ACTIONS[9].id, 'equip');
  assert.deepEqual(ACTIONS.slice(0, 9).map((action) => action.id), [
    'none', 'attack', 'interact', 'dash', 'item', 'pause', 'cancel', 'confirm', 'continue'
  ]);
  const constants = readFileSync(new URL('../../engine/constants.asm', import.meta.url), 'utf8');
  assert.equal(Number(/^ACT_EQUIP\s*=\s*(\d+)/m.exec(constants)?.[1]), 9);
  ACTIONS.forEach((action, index) => {
    const match = new RegExp(`^ACT_${action.id.toUpperCase()}\\s*=\\s*(\\d+)`, 'm').exec(constants);
    assert.equal(Number(match?.[1]), index, `ACT_${action.id.toUpperCase()}`);
  });
});

// ---------------------------------------------------------------------------------------------------- 1. normalization

test('an old project normalizes to equip: null on every item and startEquip: [null, null, null] on every member, and nothing else changes', () => {
  // Catches a normalizer that leaves the keys off (undefined breaks every consumer that reads them) or invents a default piece.
  const fresh = createProject('Old', 'rpg');
  fresh.items = [plain(0, 'Potion', { kind: 'heal', amount: 20 })];
  const raw = structuredClone(fresh);
  for (const item of raw.items) delete item.equip;
  for (const member of raw.party) delete member.startEquip;
  const normalized = normalizeProject(raw);
  assert.deepEqual(normalized.items, fresh.items);
  assert.deepEqual(normalized.items[0].equip, null);
  assert.deepEqual(
    normalized.party.map((member) => member.startEquip),
    fresh.party.map(() => [null, null, null])
  );
  assert.deepEqual(normalizeProject(structuredClone(normalized)), normalized, 'normalizing is idempotent');
  assert.deepEqual(createPartyMember(2).startEquip, [null, null, null]);
});

test('an unusable equip record becomes an ordinary item: a slot outside EQUIP_SLOTS nulls the whole object', () => {
  // Catches a normalizer that keeps a piece in a slot that does not exist (the engine's per-slot table would index past its end).
  const project = createProject('Slots', 'rpg');
  const stats = { atk: 5, def: 5, mag: 5, mdef: 5, usableBy: 0b0011 };
  const slots = [0, 1, 2, 3, -1, 1.5, '0', null, undefined, NaN];
  project.items = slots.map((slot, id) => ({ ...plain(id, `I${id}`), equip: { slot, ...stats } }));
  project.items.push({ ...plain(slots.length, 'Bare'), equip: true }, { ...plain(slots.length + 1, 'Str'), equip: 'weapon' });
  const out = normalizeProject(project).items.map((item) => item.equip);
  assert.deepEqual(out.slice(0, 3).map((equip) => equip.slot), [0, 1, 2], 'the three real slots survive');
  assert.deepEqual(out.slice(3), new Array(out.length - 3).fill(null), 'every other slot, and a non-object, is an ordinary item');
});

test('equip stats clamp to an integer 0-255 and usableBy is masked to the four party bits', () => {
  // Catches a stat that wraps past a byte (300 -> 44) or goes negative, and a mask that forgets RPG_LIMITS.party.
  const project = createProject('Stats', 'rpg');
  project.items = [
    { ...plain(0, 'A'), equip: { slot: 0, atk: 300, def: -5, mag: 7.6, mdef: 'x', usableBy: 0xff } },
    { ...plain(1, 'B'), equip: { slot: 1, atk: 255, def: 0, mag: 1e9, mdef: -1e9, usableBy: 0b10101 } },
    { ...plain(2, 'C'), equip: { slot: 2, atk: null, def: undefined, mag: NaN, mdef: 12.4, usableBy: 0b0101 } }
  ];
  const [a, b, c] = normalizeProject(project).items.map((item) => item.equip);
  assert.deepEqual(a, { slot: 0, atk: 255, def: 0, mag: 8, mdef: 0, usableBy: 0b1111, classes: null });
  assert.deepEqual(b, { slot: 1, atk: 255, def: 0, mag: 255, mdef: 0, usableBy: 0b0101, classes: null });
  assert.deepEqual(c, { slot: 2, atk: 0, def: 0, mag: 0, mdef: 12, usableBy: 0b0101, classes: null });
});

test('a piece that does not say who may wear it is wearable by everyone; an explicit 0 stays 0', () => {
  // Catches a normalizer defaulting usableBy to 0, which makes every hand-built piece unwearable by anybody.
  const project = createProject('Who', 'rpg');
  project.items = [
    { ...plain(0, 'Missing'), equip: { slot: 0, atk: 1 } },
    { ...plain(1, 'Garbage'), equip: { slot: 0, usableBy: 'all' } },
    { ...plain(2, 'Nobody'), equip: { slot: 0, usableBy: 0 } }
  ];
  const masks = normalizeProject(project).items.map((item) => item.equip.usableBy);
  assert.deepEqual(masks, [0b1111, 0b1111, 0]);
});

test('usableBy is masked to the party bits with no byte clamp first: 0x100 -> 0, 0x101 -> 1, 256 -> 0, -1 -> 15', () => {
  // Catches a clamp to 0-255 before the mask (the review's F1): 0x101 would become 255 and then everyone, 256 everyone instead of nobody, -1 nobody
  // instead of everyone. Only the four stats saturate; a mask is bits. Two's-complement `&` makes -1 all ones, so its low four bits are 0b1111.
  const project = createProject('Mask', 'rpg');
  const masks = [0x100, 0x101, 256, 257, -1, -16, 0x1f5, 0xf0, 2 ** 32 + 3];
  project.items = masks.map((usableBy, id) => ({ ...plain(id, `M${id}`), equip: { slot: 0, usableBy } }));
  assert.deepEqual(
    normalizeProject(project).items.map((item) => item.equip.usableBy),
    [0, 1, 0, 1, 0b1111, 0, 0b0101, 0, 3]
  );
});

test('a usableBy that is not an integer means "did not say" and is everyone, not a rounded mask', () => {
  // 1.5, NaN, a numeric string and null are not a mask somebody wrote; the old clamp rounded 1.5 to 2 and read '3' as 3, inventing a restriction.
  const project = createProject('Mask', 'rpg');
  const values = [1.5, NaN, Infinity, '3', null, undefined, true, [1], {}];
  project.items = values.map((usableBy, id) => ({ ...plain(id, `N${id}`), equip: { slot: 0, usableBy } }));
  assert.deepEqual(
    normalizeProject(project).items.map((item) => item.equip.usableBy),
    values.map(() => 0b1111)
  );
});

test('an out-of-range usableBy keeps only the party bits: 257 on a weapon forbids member 1, and validateProject says so', () => {
  // The review's control. Catches the byte clamp end to end: with it item 0 would come out as everyone and member 1 would pass.
  const project = rpg();
  project.items = [{ ...piece(0, 'Blade', 0), equip: { slot: 0, atk: 1, def: 0, mag: 0, mdef: 0, usableBy: 257 } }];
  project.party[1].startEquip = [0, null, null];
  const normalized = normalizeProject(project);
  assert.equal(normalized.items[0].equip.usableBy, 1);
  assert.deepEqual(normalized.party[1].startEquip, [0, null, null], 'the id survives normalization: it names a weapon');
  assert.deepEqual(problemsOf(normalized, 'start-equip-not-allowed').map(identity), [
    { severity: 'error', where: 'Character Forge', rule: 'start-equip-not-allowed', subject: { member: 1, slot: 0 }, counts: [] }
  ]);
  normalized.party[1].startEquip = [null, null, null];
  normalized.party[0].startEquip = [0, null, null];
  assert.deepEqual(problemsOf(normalized, 'start-equip-not-allowed'), [], 'control: member 0 is allowed');
});

test('startEquip keeps a piece of its own slot, and nulls anything else: an ordinary item, another slot, a missing id, junk', () => {
  // Catches a post-pass that checks only "is an item" (a potion in the weapon slot), one that ignores the slot, and one that lets $FF through.
  const project = rpg();
  project.party[0].startEquip = [1, 2, 3]; // all correct
  project.party[1].startEquip = [0, 1, 99]; // a potion, a weapon in the armor slot, an id past the list
  project.party[2].startEquip = [NO_ITEM, 1.5, '1']; // $FF, a fraction, a string
  project.party[3].startEquip = [1]; // short: the missing entries are null
  project.party[3].startEquip.push(undefined);
  const out = normalizeProject(project).party.map((member) => member.startEquip);
  assert.deepEqual(out, [[1, 2, 3], [null, null, null], [null, null, null], [1, null, null]]);
});

test('equipment on an action game is kept, not stripped, by normalization', () => {
  // Catches a normalizer that drops equip for an action project: toggling the game type would lose the author's data (design section 1).
  const project = createProject('Action', 'action');
  project.items = [piece(0, 'Sword', 0, { atk: 5, mag: 9 })];
  project.party[0].startEquip = [0, null, null];
  const out = normalizeProject(project);
  assert.deepEqual(out.items[0].equip, { slot: 0, atk: 5, def: 0, mag: 9, mdef: 0, usableBy: EVERYONE, classes: null });
  assert.deepEqual(out.party[0].startEquip, [0, null, null]);
});

test('an item synthesized by the pre-item-schema migration is an ordinary item with equip: null', () => {
  // Catches a migration that builds items without the new key, so a legacy project and a saved one load to different shapes.
  const project = createProject('Legacy', 'rpg');
  project.sprites.actors.push({ name: 'Torch', behavior: 'pickup' });
  const raw = structuredClone(project);
  delete raw.items; // the migration discriminator: no items array at all
  const migrated = normalizeProject(raw);
  assert.equal(migrated.items.length, 1);
  assert.equal(migrated.items[0].equip, null);
});

// ---------------------------------------------------------------------------------------------------- 2. deletion and renumbering

/** A project where item 1 is Given, dropped, carried-on and a starting piece at once, and higher ids exist to renumber exactly once. */
function itemDeletionProject() {
  const project = rpg();
  project.sprites.actors = [
    { name: 'Slime', behavior: 'idle', battle: { drop: 1 } },
    { name: 'Bat', behavior: 'idle', battle: { drop: 3 } },
    { name: 'Rat', behavior: 'idle', battle: { drop: 0 } }
  ];
  project.maps[0].screens[0].entities = [
    {
      actorId: 0,
      x: 0,
      y: 0,
      props: {
        event: {
          pages: [
            {
              cond: { type: 'hasItem', arg: 1 },
              commands: [
                { op: 'give', item: 1 },
                { op: 'give', item: 3 },
                { op: 'branch', cond: { type: 'hasItem', arg: 3 }, then: [{ op: 'take', item: 2 }], else: [] }
              ]
            }
          ]
        }
      }
    }
  ];
  project.party[0].startEquip = [1, 2, 3];
  project.party[1].startEquip = [null, 2, 3];
  project.party[2].startEquip = [1, null, null];
  return project;
}

test('deleting an item renumbers every reference to it exactly once: drop, Give, Carrying and startEquip', () => {
  // Catches a startEquip shifted but its deleted id left in place (the id would now name the next item up), a double shift of a higher id, and a
  // startEquip the helper forgets (a starting piece that silently becomes a different one).
  const project = itemDeletionProject();
  renumberItemDeletion(project, 1); // delete Sword
  const [slime, bat, rat] = project.sprites.actors;
  assert.deepEqual([slime.battle.drop, bat.battle.drop, rat.battle.drop], [null, 2, 0]);
  const page = project.maps[0].screens[0].entities[0].props.event.pages[0];
  assert.equal(page.cond.arg, NO_ITEM, 'Carrying the deleted item names nothing');
  assert.deepEqual(page.commands.slice(0, 2).map((command) => command.item), [null, 2], 'a Give of the deleted item is missing; a higher id shifts once');
  assert.equal(page.commands[2].cond.arg, 2);
  assert.equal(page.commands[2].then[0].item, 1);
  assert.deepEqual(
    project.party.map((member) => member.startEquip),
    [[null, 1, 2], [null, 1, 2], [null, null, null], [null, null, null]],
    'the deleted piece is null in every member, and each higher id moved down exactly once (3 -> 2, 2 -> 1)'
  );
});

test('deleting the highest item leaves lower startEquip ids alone, and deleting item 0 shifts them all', () => {
  const high = itemDeletionProject();
  renumberItemDeletion(high, 3);
  assert.deepEqual(high.party[0].startEquip, [1, 2, null]);
  const low = itemDeletionProject();
  renumberItemDeletion(low, 0);
  assert.deepEqual(low.party[0].startEquip, [0, 1, 2]);
});

test('no reference is renumbered in both helpers: the item helper leaves usableBy alone and the member helper leaves startEquip and drops alone', () => {
  // Catches renumbering a reference in both helpers (a start piece shifted again on a member deletion, or a mask shifted on an item deletion).
  const byItem = itemDeletionProject();
  const masks = byItem.items.map((item) => item.equip?.usableBy);
  byItem.items[2].equip.usableBy = 0b0110;
  const before = byItem.items.map((item) => item.equip?.usableBy);
  renumberItemDeletion(byItem, 1);
  assert.deepEqual(byItem.items.map((item) => item.equip?.usableBy), before, 'every mask is untouched by an item deletion');
  assert.notDeepEqual(masks, before, 'the control: the masks really were distinct');

  const byMember = itemDeletionProject();
  const starts = structuredClone(byMember.party.map((member) => member.startEquip));
  const drops = byMember.sprites.actors.map((actor) => actor.battle.drop);
  renumberPartyMemberDeletion(byMember, 1);
  assert.deepEqual(byMember.party.map((member) => member.startEquip), starts, 'startEquip is untouched by a member deletion');
  assert.deepEqual(byMember.sprites.actors.map((actor) => actor.battle.drop), drops);
});

test('deleting a party member drops its bit from every mask and shifts the higher bits down: 0b1101 -> 0b101', () => {
  // Catches clearing the bit without shifting the higher ones (0b1101 -> 0b1001: member 3 would now be member 3 of a three-member party, i.e. nobody).
  const project = rpg();
  project.items[1].equip.usableBy = 0b1101;
  renumberPartyMemberDeletion(project, 2);
  assert.equal(project.items[1].equip.usableBy, 0b101);
  const cases = [
    [0, 0b1101, 0b110],
    [1, 0b1101, 0b111],
    [2, 0b1101, 0b101],
    [3, 0b1101, 0b101],
    [0, 0b0001, 0],
    [3, 0b1000, 0],
    [1, 0b0000, 0]
  ];
  for (const [index, mask, expected] of cases) {
    const p = rpg();
    p.items[1].equip.usableBy = mask;
    renumberPartyMemberDeletion(p, index);
    assert.equal(p.items[1].equip.usableBy, expected, `delete ${index} from ${mask.toString(2)}`);
  }
});

test('a mask covering all four members becomes the three-member mask, wherever the deleted member sits', () => {
  for (const index of [0, 1, 2, 3]) {
    const project = rpg();
    renumberPartyMemberDeletion(project, index);
    for (const item of project.items.filter((entry) => entry.equip)) assert.equal(item.equip.usableBy, 0b0111, `delete member ${index}`);
  }
});

test('an index outside the party, or outside 0-7, leaves every mask unchanged (no JS shift wrap)', () => {
  // Catches `1 << index` wrapping at 32: a deletion of index 32 would shift every mask down one, and 31 or -1 would make garbage of it.
  for (const index of [4, 7, 8, 31, 32, 33, -1, -32, 1.5, NaN, null, undefined, '2']) {
    const project = rpg();
    project.items[1].equip.usableBy = 0b1011;
    project.items[2].equip.usableBy = 0b0110;
    const before = project.items.map((item) => item.equip?.usableBy);
    renumberPartyMemberDeletion(project, index);
    assert.deepEqual(project.items.map((item) => item.equip?.usableBy), before, `index ${String(index)}`);
  }
});

test('deleting a member goes with its startEquip, and the other members keep theirs', () => {
  // The member's own startEquip is the member's: nothing renumbers it.
  const project = itemDeletionProject();
  renumberPartyMemberDeletion(project, 0);
  project.party.splice(0, 1);
  assert.deepEqual(project.party.map((member) => member.startEquip), [[null, 2, 3], [1, null, null], [null, null, null]]);
});

test('a raw five- or nine-member project is refused before codegen, with an error naming the Character Forge', async () => {
  // checkBattleTables is the guard (main/build/battletables.js, "party-over"): a normalized mask uses bits 0-3, and a byte cannot hold nine members.
  // Catches a build that lets a party past the four-bit domain through to the generator.
  for (const size of [5, 9]) {
    const project = rpg();
    project.party = Array.from({ length: size }, (_, id) => createPartyMember(id));
    const found = checkBattleTables(project).filter((problem) => problem.rule === 'party-over');
    assert.equal(found.length, 1, `${size} members`);
    assert.equal(found[0].severity, 'error');
    assert.equal(found[0].where, 'Character Forge');
    assert.deepEqual(found[0].counts, [size]);
    assert.doesNotThrow(() => validateProject(project));
    await assert.rejects(
      () => generateAssets({ dir: '/nonexistent-equipment-test-dir', project, log: () => {} }),
      /party holds 4 members and this project has/,
      `${size} members must be refused before any file is written`
    );
  }
  assert.deepEqual(checkBattleTables(rpg()).filter((problem) => problem.rule === 'party-over'), [], 'control: four members are fine');
});

test('grantNewMember extends only the "everyone" masks to the newcomer', () => {
  // Catches "everyone" silently excluding the newcomer (no extension), and extending a piece limited to some members.
  const project = rpg();
  project.party.length = 3; // members 0-2; the new member will be index 3
  project.items = [
    piece(0, 'Everyone', 0, { usableBy: 0b0111 }),
    piece(1, 'Two', 1, { usableBy: 0b0011 }),
    piece(2, 'Nobody', 2, { usableBy: 0 }),
    piece(3, 'Stored4', 0, { usableBy: 0b1111 }),
    plain(4, 'Potion')
  ];
  grantNewMember(project, 3);
  assert.deepEqual(
    project.items.map((item) => item.equip?.usableBy),
    [0b1111, 0b0011, 0, 0b1111, undefined]
  );
  assert.equal(project.items[4].equip, null, 'an ordinary item is not turned into a piece');
});

test('grantNewMember: a piece that covered the previous members only, in any position, is the one extended', () => {
  const project = rpg();
  project.items = [
    piece(0, 'AllTwo', 0, { usableBy: 0b0011 }), // everyone of a two-member party
    piece(1, 'OnlyFirst', 1, { usableBy: 0b0001 }),
    piece(2, 'OnlySecond', 2, { usableBy: 0b0010 })
  ];
  grantNewMember(project, 2); // the third member joins a two-member party
  assert.deepEqual(project.items.map((item) => item.equip.usableBy), [0b0111, 0b0001, 0b0010]);
});

test('grantNewMember with an index outside 1..3 changes nothing', () => {
  for (const index of [0, 4, 5, 8, -1, 1.5, NaN, null, undefined]) {
    const project = rpg();
    project.items[1].equip.usableBy = 0b0111;
    const before = structuredClone(project.items);
    grantNewMember(project, index);
    assert.deepEqual(project.items, before, `index ${String(index)}`);
  }
});

test('adding a member and granting it is one commit, and undo restores every mask', () => {
  // Catches a grant that mutates outside the commit (undo would leave the newcomer's bit behind) and the literal-mask round trip.
  const project = rpg();
  project.party.length = 3;
  project.items[1].equip.usableBy = 0b0111;
  project.items[2].equip.usableBy = 0b0011;
  const store = new Store();
  store.open('/tmp/equipment-test', project);
  const masks = () => store.project.items.map((item) => item.equip?.usableBy);
  const before = masks();
  store.commit('Add character', (draft) => {
    draft.party.push(createPartyMember(3));
    grantNewMember(draft, 3);
  });
  assert.deepEqual(masks(), [undefined, 0b1111, 0b0011, EVERYONE]);
  store.undo();
  assert.deepEqual(masks(), before);
  assert.equal(store.project.party.length, 3);
  store.redo();
  assert.deepEqual(masks(), [undefined, 0b1111, 0b0011, EVERYONE]);
});

test('releaseEquipment clears a starting piece that stops being a piece, or moves to another slot', () => {
  // Catches a release that clears every member's startEquip (not just the item's), one that ignores the new slot, and one that touches the item.
  const project = itemDeletionProject();
  project.party[3].startEquip = [2, 2, null]; // the armor Mail also (invalidly) in the weapon slot
  releaseEquipment(project, 2); // Mail becomes an ordinary item
  assert.deepEqual(
    project.party.map((member) => member.startEquip),
    [[1, null, 3], [null, null, 3], [1, null, null], [null, null, null]]
  );
  assert.equal(project.items[2].equip.slot, 1, 'the function does not edit the item');

  const moved = itemDeletionProject();
  moved.party[3].startEquip = [2, 2, null];
  releaseEquipment(moved, 2, 2); // Mail moves to the accessory slot: entries in slots 0 and 1 are stale
  assert.deepEqual(moved.party.map((member) => member.startEquip), [[1, null, 3], [null, null, 3], [1, null, null], [null, null, null]]);
  const kept = itemDeletionProject();
  releaseEquipment(kept, 2, 1); // "moved" to the slot it is already in: its entries stay
  assert.deepEqual(kept.party.map((member) => member.startEquip), [[1, 2, 3], [null, 2, 3], [1, null, null], [null, null, null]]);
});

// ---------------------------------------------------------------------------------------------------- 3. the predicates (the predicate half; the emitted-equates half is C3)

const withPieces = (gameType, stats) => {
  const project = rpg();
  project.project.gameType = gameType;
  project.items = [piece(0, 'Gear', 0, stats)];
  return project;
};

test('projectUsesEquipment: an RPG with a piece, and nothing else', () => {
  assert.equal(projectUsesEquipment(withPieces('rpg', { atk: 1 })), true);
  assert.equal(projectUsesEquipment(withPieces('rpg', {})), true, 'a piece with every stat 0 is still a piece');
  const none = withPieces('rpg', {});
  none.items[0].equip = null;
  assert.equal(projectUsesEquipment(none), false);
  none.items = [];
  assert.equal(projectUsesEquipment(none), false);
  const missing = withPieces('rpg', {});
  delete missing.items[0].equip;
  assert.equal(projectUsesEquipment(missing), false, 'a hand-built item with no equip key is an ordinary item');
});

test('the magic predicates take equipment as a third source: MAG alone turns power on, MDEF alone turns defence on, ATK/DEF turn neither', () => {
  // Catches MAG turning on magic power but also defence (or the reverse), and a predicate that never reads the pieces.
  const cases = [
    [{}, false, false],
    [{ atk: 9, def: 9 }, false, false],
    [{ mag: 1 }, true, false],
    [{ mdef: 1 }, false, true],
    [{ mag: 1, mdef: 1 }, true, true]
  ];
  for (const [stats, power, defence] of cases) {
    const project = withPieces('rpg', stats);
    assert.equal(projectUsesMagicPower(project), power, JSON.stringify(stats));
    assert.equal(projectUsesMagicDefence(project), defence, JSON.stringify(stats));
  }
  // Control: the control project really has no other source, so the true answers above are equipment's.
  const bare = withPieces('rpg', {});
  assert.equal(projectUsesMagicPower(bare), false);
  assert.equal(projectUsesMagicDefence(bare), false);
});

test('an action game answers false to all three predicates whatever its equipment data says', () => {
  // Catches a predicate that ignores gameType: the data is kept on an action game, but nothing may be assembled for it.
  for (const stats of [{}, { atk: 5 }, { mag: 200 }, { mdef: 200 }, { mag: 255, mdef: 255, atk: 255, def: 255 }]) {
    const project = withPieces('action', stats);
    assert.equal(projectUsesEquipment(project), false, JSON.stringify(stats));
    assert.equal(projectUsesMagicPower(project), false, JSON.stringify(stats));
    assert.equal(projectUsesMagicDefence(project), false, JSON.stringify(stats));
  }
  const flipped = withPieces('action', { mag: 3, mdef: 3 });
  flipped.project.gameType = 'rpg';
  assert.equal(projectUsesMagicPower(flipped), true, 'control: the same data answers true the moment the project is an RPG');
});

// ---------------------------------------------------------------------------------------------------- 4. validateProject

test('a piece with an effect is an error naming the Items Forge, with the item index as its subject', () => {
  // Catches a rule without a subject, a subject built from the name, and a check that flags an ordinary heal item or a piece with the `none` kind.
  const project = rpg();
  project.items[2].effect = { kind: 'heal', amount: 5 };
  project.items[3].effect = { kind: 'damage', amount: 5 };
  const found = problemsOf(project, 'equip-piece-has-effect');
  assert.deepEqual(found.map(identity), [
    { severity: 'error', where: 'Items Forge', rule: 'equip-piece-has-effect', subject: { item: 2 }, counts: [] },
    { severity: 'error', where: 'Items Forge', rule: 'equip-piece-has-effect', subject: { item: 3 }, counts: [] }
  ]);
  assert.match(found[0].message, /Mail/);
  assert.deepEqual(problemsOf(rpg(), 'equip-piece-has-effect'), [], 'control: pieces with no effect, and the ordinary Potion, raise nothing');
  // A rename moves the message and nothing that identifies the problem.
  const renamed = structuredClone(project);
  renamed.items[2].name = 'Plate';
  assert.deepEqual(problemsOf(renamed, 'equip-piece-has-effect').map(identity), found.map(identity));
});

test('startEquip naming something that is not a piece of its slot is an error naming the Character Forge', () => {
  // Catches a check that accepts a piece of any slot, or an ordinary item, and a subject that names the member instead of indexing it.
  const project = rpg();
  project.party[0].startEquip = [1, 2, 3]; // all right
  project.party[1].startEquip = [2, null, null]; // the armor in the weapon slot
  project.party[2].startEquip = [null, 0, null]; // a Potion in the armor slot
  project.party[3].startEquip = [null, null, 77]; // an id that is no item
  assert.deepEqual(problemsOf(project, 'start-equip-wrong-slot').map(identity), [
    { severity: 'error', where: 'Character Forge', rule: 'start-equip-wrong-slot', subject: { member: 1, slot: 0 }, counts: [] }
  ]);
  assert.deepEqual(problemsOf(project, 'start-equip-not-a-piece').map(identity), [
    { severity: 'error', where: 'Character Forge', rule: 'start-equip-not-a-piece', subject: { member: 2, slot: 1 }, counts: [] },
    { severity: 'error', where: 'Character Forge', rule: 'start-equip-not-a-piece', subject: { member: 3, slot: 2 }, counts: [] }
  ]);
  assert.deepEqual(problemsOf(project, 'start-equip-not-allowed'), []);
  const wrong = problemsOf(project, 'start-equip-wrong-slot')[0];
  assert.match(wrong.message, /weapon/);
  assert.match(wrong.message, /armor/);
});

test('starting equipment must be wearable by the member who starts with it', () => {
  // The allowed-member validation (build-obligations.md, C2; design review D1). Catches a startEquip that ignores usableBy, and one that tests the
  // wrong bit (the slot, or the item index, instead of the member's).
  const project = rpg();
  project.items[1].equip.usableBy = 0b0101; // Sword: members 0 and 2 only
  project.party[0].startEquip = [1, null, null];
  project.party[1].startEquip = [1, null, null]; // not allowed
  project.party[2].startEquip = [1, null, null];
  project.party[3].startEquip = [1, null, null]; // not allowed
  assert.deepEqual(problemsOf(project, 'start-equip-not-allowed').map(identity), [
    { severity: 'error', where: 'Character Forge', rule: 'start-equip-not-allowed', subject: { member: 1, slot: 0 }, counts: [] },
    { severity: 'error', where: 'Character Forge', rule: 'start-equip-not-allowed', subject: { member: 3, slot: 0 }, counts: [] }
  ]);
  project.items[1].equip.usableBy = EVERYONE;
  assert.deepEqual(problemsOf(project, 'start-equip-not-allowed'), []);
  // A member who has not joined yet still holds their startEquip (equip_init copies all four at boot), so they are checked too.
  assert.equal(project.party[3].startsInParty, false);
  project.items[1].equip.usableBy = 0b0111;
  assert.equal(problemsOf(project, 'start-equip-not-allowed').length, 1);
});

test('a piece on an action game is a warning naming the Items Forge, and the RPG-only errors do not apply to it', () => {
  // Catches a silently dead field (CLAUDE.md: label it), a warning that fires on an RPG, and the RPG errors firing for data an action game ignores.
  const project = withPieces('action', { atk: 5 });
  project.items.push(piece(1, 'Spear', 0));
  project.items[0].effect = { kind: 'heal', amount: 5 }; // would be an error on an RPG
  project.party[0].startEquip = [1, 1, 99]; // would be three errors on an RPG
  assert.deepEqual(problemsOf(project, 'equip-ignored-action-game').map(identity), [
    { severity: 'warning', where: 'Items Forge', rule: 'equip-ignored-action-game', subject: {}, counts: [2] }
  ]);
  for (const rule of ['equip-piece-has-effect', 'start-equip-not-a-piece', 'start-equip-wrong-slot', 'start-equip-not-allowed']) {
    assert.deepEqual(problemsOf(project, rule), [], rule);
  }
  assert.deepEqual(
    validateProject(project).filter((p) => p.severity === 'error' && /equip|wear|worn/i.test(p.message)),
    [],
    'no equipment error on an action game'
  );
  project.items.length = 1;
  assert.deepEqual(problemsOf(project, 'equip-ignored-action-game').map((p) => p.counts), [[1]], 'the count follows the number of pieces');
  project.items[0].equip = null;
  assert.deepEqual(problemsOf(project, 'equip-ignored-action-game'), [], 'control: no piece, no warning');
  assert.deepEqual(problemsOf(withPieces('rpg', { atk: 5 }), 'equip-ignored-action-game'), [], 'control: an RPG never warns');
});

test('a clean equipment RPG raises none of the equipment rules', () => {
  const project = rpg();
  project.party[0].startEquip = [1, 2, 3];
  const rules = new Set(['equip-piece-has-effect', 'equip-ignored-action-game', 'start-equip-not-a-piece', 'start-equip-wrong-slot', 'start-equip-not-allowed']);
  assert.deepEqual(validateProject(project).filter((problem) => rules.has(problem.rule)), []);
});

test('releaseEquipment leaves no dangling startEquip for validateProject to find', () => {
  // Catches an Items Forge edit that turns a piece into an ordinary item, or moves its slot, without the release: validateProject reports the leftover.
  const project = rpg();
  project.party[0].startEquip = [1, 2, null];
  project.items[1].equip = null; // Sword is an ordinary item now
  assert.equal(problemsOf(project, 'start-equip-not-a-piece').length, 1, 'the leftover is reported');
  releaseEquipment(project, 1);
  assert.deepEqual(problemsOf(project, 'start-equip-not-a-piece'), []);

  const moved = rpg();
  moved.party[0].startEquip = [1, 2, null];
  moved.items[2].equip.slot = 2; // Mail moves armor -> accessory
  assert.equal(problemsOf(moved, 'start-equip-wrong-slot').length, 1);
  releaseEquipment(moved, 2, 2);
  assert.deepEqual(problemsOf(moved, 'start-equip-wrong-slot'), []);
  assert.deepEqual(moved.party[0].startEquip, [1, null, null]);
});

test('the equipment fixtures here are real: the checked-in fixtures carry none (no fixture gains equipment)', async () => {
  // C2 touches no fixture. Each one still normalizes to equip: null everywhere (the keys appear only when an editor next saves).
  const { loadProject } = await import('../../main/project-io.js');
  for (const name of ['sample', 'sample-rpg', 'sample-mmc1', 'sample-mmc3', 'sample-u512', 'sample-rpg-mmc1']) {
    const project = await loadProject(new URL(`../../${name}`, import.meta.url).pathname);
    assert.ok(project.items.every((item) => item.equip === null), name);
    assert.ok(project.party.every((member) => member.startEquip.every((id) => id === null)), name);
    assert.equal(projectUsesEquipment(project), false, name);
    const itemsFile = await fs.readFile(new URL(`../../${name}/items.json`, import.meta.url), 'utf8').catch(() => '[]');
    assert.ok(!itemsFile.includes('"equip"'), `${name}/items.json on disk was not rewritten`);
  }
});
