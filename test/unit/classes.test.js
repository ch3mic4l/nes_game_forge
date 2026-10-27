// Classes, data layer (ROADMAP item 5 remainder, slice C1; handoff-next/classes-bc/design.md sections 3 and 6): the `classes` table,
// `member.classId` and `item.equip.classes` in the schema, the three predicates (`memberClass`, `memberMayWear`, `memberSpellList`),
// the deletion refusals and renumbering, `clearStartEquipNotAllowed`, `classes.json`, and every RC1 diagnostic. Nothing here builds a
// ROM and nothing asserts class growth semantics: the generator still reads the member's own fields (slice C2).
//
// Every test names the wrong implementation it would catch. Sabotage runs: handoff-next/classes-bc/c1/report.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject, saveProject } from '../../main/project-io.js';
import { checkBattleTables } from '../../main/build/battletables.js';
import {
  RPG_LIMITS,
  classUsers,
  clearStartEquipNotAllowed,
  createClass,
  createGrowthProfile,
  createPartyMember,
  createProject,
  createSpell,
  growthProfileUsers,
  memberClass,
  memberMayWear,
  memberSpellList,
  normalizeProject,
  renumberClassDeletion,
  renumberGrowthProfileDeletion,
  renumberSpellDeletion,
  validateProject
} from '../../shared/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const normalized = (project) => normalizeProject(structuredClone(project));
const EVERYONE = 0b1111;

const piece = (id, name, slot, equip = {}) => ({
  id,
  name,
  actorId: null,
  metaspriteId: null,
  effect: { kind: 'none', amount: 0 },
  equip: { slot, atk: 0, def: 0, mag: 0, mdef: 0, usableBy: EVERYONE, classes: null, ...equip }
});

/**
 * A normalized RPG: members Ax Bx Cx Dx; three spells; two growth profiles; classes 0 Knight (profile 0), 1 Mage (profile 1),
 * 2 Thief (profile 0); items 0 Sword (weapon) 1 Robe (armor) 2 Ring (accessory), all `classes: null`. Member classes via `assign`.
 */
function world(assign = [null, null, null, null], { maxLevel = 15 } = {}) {
  const project = createProject('Quest', 'rpg');
  project.rpg.maxLevel = maxLevel;
  project.spells = [createSpell(0, 'Fire'), createSpell(1, 'Ice'), createSpell(2, 'Bolt')];
  project.growthProfiles = [createGrowthProfile(0, 'Brawn'), createGrowthProfile(1, 'Wit')];
  project.classes = [createClass(0, 'Knight'), createClass(1, 'Mage'), createClass(2, 'Thief')];
  project.classes[0].profileId = 0;
  project.classes[1].profileId = 1;
  project.classes[2].profileId = 0;
  project.party = assign.map((classId, id) => ({ ...createPartyMember(id, String.fromCharCode(65 + id) + 'x'), classId }));
  project.items = [piece(0, 'Sword', 0), piece(1, 'Robe', 1), piece(2, 'Ring', 2)];
  return normalized(project);
}
const problems = (project, rule) => validateProject(project).filter((p) => p.rule === rule);
const battle = (project, rule) => checkBattleTables(project).filter((p) => p.rule === rule);
const identity = (p) => ({ severity: p.severity, where: p.where, rule: p.rule, subject: p.subject, counts: p.counts });

// ----------------------------------------------------------------------------------------------- normalization

test('N1: an absent classes / classId / equip.classes reads as [] / null / null, and the creators carry them', () => {
  // Catches a normalizer that leaves the fields undefined on a pre-classes project (every consumer would need its own guard), or one
  // that reads a missing mask as 0 ("no class may wear it") and so locks every legacy piece away from classed members.
  const old = createProject('Old', 'rpg');
  assert.deepEqual(old.classes, [], 'createProject carries classes: []');
  assert.equal(createPartyMember(0).classId, null);
  old.items = [piece(0, 'Sword', 0)];
  delete old.items[0].equip.classes;
  delete old.classes;
  for (const member of old.party) delete member.classId;
  const out = normalizeProject(old);
  assert.deepEqual(out.classes, []);
  assert.ok(out.party.every((member) => member.classId === null));
  assert.equal(out.items[0].equip.classes, null);
  assert.equal(RPG_LIMITS.classes, 8);
});

test('N2: classes are capped at RPG_LIMITS.classes, ids follow the index, names default, dangling profile ids become null', () => {
  // Catches a missing cap (a ninth class would overflow the one-byte item mask), ids kept from the file rather than restamped, a blank
  // name kept, and a profile id that names nothing kept (the generator would index past the profile table).
  const project = createProject('Many', 'rpg');
  project.growthProfiles = [createGrowthProfile(0, 'Only')];
  project.classes = Array.from({ length: 12 }, (_, i) => ({ id: 99 - i, name: i === 3 ? '   ' : `C${i}`, profileId: i === 1 ? 5 : i === 2 ? 'x' : 0 }));
  const out = normalizeProject(project);
  assert.equal(out.classes.length, 8);
  assert.deepEqual(out.classes.map((cls) => cls.id), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(out.classes[3].name, 'Class 3');
  assert.deepEqual(out.classes.slice(0, 4).map((cls) => cls.profileId), [0, null, null, 0]);
  assert.deepEqual(out.classes[0].spells, []);
});

test('N3: a class spell list follows the member rules: dangling spells dropped, level clamped to 1..maxLevel, capped', () => {
  // Catches a class list that skips the member list's filter (a stale spell id would index past the catalogue) or its level clamp.
  const project = world([null, null, null, null], { maxLevel: 6 });
  project.classes[1].spells = [
    { spellId: 1, level: 3 },
    { spellId: 7, level: 3 },
    { spellId: 0, level: 99 },
    { spellId: 2, level: 0 },
    { spellId: 'x', level: 2 }
  ];
  const out = normalized(project);
  assert.deepEqual(out.classes[1].spells, [
    { spellId: 1, level: 3 },
    { spellId: 0, level: 6 },
    { spellId: 2, level: 1 }
  ]);
});

test('N4: classId out of range, negative, fractional or not a number is null; a valid one is kept (retained data survives)', () => {
  // Catches a classId that is kept dangling (memberClass would return undefined but the field would lie), or one that is zeroed
  // instead of nulled (every bad id would silently become class 0).
  const project = world([2, 0, 1, 0]);
  for (const [bad, expected] of [[3, null], [-1, null], [1.5, null], ['1', null], [undefined, null], [2, 2], [0, 0]]) {
    project.party[3].classId = bad;
    assert.equal(normalized(project).party[3].classId, expected, String(bad));
  }
  project.party[3].classId = 0;
  assert.deepEqual(normalized(project).party.map((m) => m.classId), [2, 0, 1, 0]);
});

test('N5: the class mask keeps null, 0 and all-bits distinct, and is clamped to the class count', () => {
  // Catches the three collapses the design names: null read as 0 (nobody may wear it), 0 read as null (the emptied mask silently widened
  // to "any class", R4a), all-bits folded to null (it would stop meaning "these classes only" and follow a class added later), and a
  // mask whose bits name classes that do not exist.
  const project = world();
  const masks = [null, 0, 0b111, 0xff, 0b101, 1.5, 'x', undefined];
  project.items = masks.map((classes, id) => piece(id, `P${id}`, 0, { classes }));
  assert.deepEqual(normalized(project).items.map((item) => item.equip.classes), [null, 0, 0b111, 0b111, 0b101, null, null, null]);
  project.classes.pop();
  assert.deepEqual(normalized(project).items.map((item) => item.equip.classes), [null, 0, 0b11, 0b11, 0b01, null, null, null], 'two classes');
  project.classes = [];
  assert.deepEqual(
    normalized(project).items.map((item) => item.equip.classes),
    [null, 0, 0, 0, 0, null, null, null],
    'no classes: an explicit mask holds no bit, null is not a mask'
  );
  const plain = world();
  plain.items.push({ ...piece(3, 'Potion', 0), equip: null });
  assert.equal(normalized(plain).items[3].equip, null, 'an ordinary item still has no equip record');
});

// ----------------------------------------------------------------------------------------------- predicates

test('P1: memberMayWear -- the member bit AND (classless OR mask null OR class bit); a classless member is never class-restricted', () => {
  // Catches a classless member restricted by a class mask (R3), a mask ignored for a classed member, the class bit read from the wrong
  // index, the member bit dropped, and a non-equipment item that "may be worn".
  const project = world([0, 1, null, 1]);
  const sword = project.items[0];
  const cases = [
    // [classes mask, usableBy, expected per member 0..3] -- members: 0 Knight, 1 Mage, 2 classless, 3 Mage
    [null, 0b1111, [true, true, true, true]],
    [0b111, 0b1111, [true, true, true, true]],
    [0, 0b1111, [false, false, true, false]],
    [0b01, 0b1111, [true, false, true, false]],
    [0b10, 0b1111, [false, true, true, true]],
    [0b10, 0b0101, [false, false, true, false]],
    [null, 0b0110, [false, true, true, false]],
    [0b01, 0b0000, [false, false, false, false]]
  ];
  for (const [classes, usableBy, expected] of cases) {
    sword.equip.classes = classes;
    sword.equip.usableBy = usableBy;
    assert.deepEqual([0, 1, 2, 3].map((m) => memberMayWear(project, sword, m)), expected, `classes ${classes} usableBy ${usableBy.toString(2)}`);
  }
  assert.equal(memberMayWear(project, { id: 9, name: 'Potion', equip: null }, 0), false);
  assert.equal(memberMayWear(project, undefined, 0), false);
});

test('P2: memberMayWear and memberClass read a hand-built (unnormalized) project: a missing classes table or dangling classId is classless', () => {
  // Catches a predicate that throws on an in-memory project that never went through normalizeProject (commit() does not normalize).
  const project = createProject('Bare', 'rpg');
  delete project.classes;
  project.items = [piece(0, 'Sword', 0, { classes: 0b1 })];
  delete project.items[0].equip.classes;
  project.party[0].classId = 3;
  assert.equal(memberClass(project, project.party[0]), undefined);
  assert.equal(memberMayWear(project, project.items[0], 0), true);
});

test('P3: memberSpellList -- a classed member has its class list and nothing else; an empty class list does not fall back to the member', () => {
  // Catches a union of class and member lists (R2 chose replace), a `||` that treats an empty class list as "none, use the member's",
  // and a classless member whose own list is hidden.
  const project = world([1, 1, null, 0]);
  project.party[0].spells = [{ spellId: 2, level: 9 }];
  project.party[2].spells = [{ spellId: 0, level: 2 }];
  project.party[3].spells = [{ spellId: 1, level: 4 }];
  project.classes[1].spells = [{ spellId: 1, level: 3 }];
  project.classes[0].spells = [];
  const out = normalized(project);
  assert.deepEqual(memberSpellList(out, out.party[0]), [{ spellId: 1, level: 3 }], 'classed: class list, retained list ignored');
  assert.deepEqual(memberSpellList(out, out.party[2]), [{ spellId: 0, level: 2 }], 'classless: its own');
  assert.deepEqual(memberSpellList(out, out.party[3]), [], 'classed with an empty class list: empty, not the member list');
  assert.deepEqual(out.party[0].spells, [{ spellId: 2, level: 9 }], 'the retained list is untouched');
});

// ----------------------------------------------------------------------------------------------- deletion

test('D1: a class a member is assigned cannot be deleted: the members are named and nothing changes', () => {
  // Catches a deletion that silently nulls the members' classId (R4c refuses instead) or one that mutates part way before it throws.
  const project = world([1, 0, 1, null]);
  project.items[0].equip.classes = 0b110;
  const before = structuredClone(project);
  assert.deepEqual(classUsers(project, 1).map((m) => m.name), ['Ax', 'Cx']);
  assert.deepEqual(classUsers(project, 2), []);
  assert.throws(() => renumberClassDeletion(project, 1), /Ax, Cx/);
  assert.deepEqual(project, before, 'a refused deletion leaves the project untouched');
});

test('D2: renumberClassDeletion shifts higher member class ids and every item mask; null is untouched; an emptied mask stays 0', () => {
  // Catches a renumber that forgets the item masks (a mask then names the wrong class after the shift), shifts the wrong way, rewrites
  // `null` into a number, and an emptied mask silently widened to null (R4a: no class may wear it; that is a data-changing guess).
  for (const doomed of [0, 1, 2]) {
    const others = [0, 1, 2].filter((c) => c !== doomed); // a member may hold any class but the doomed one (that is refused)
    const project = world([others[0], others[1], null, others[1]]);
    const masks = [null, 0, 0b001, 0b010, 0b100, 0b111, 0b101];
    project.items = masks.map((classes, id) => piece(id, `P${id}`, 0, { classes }));
    const classIdsBefore = project.party.map((m) => m.classId);
    renumberClassDeletion(project, doomed);
    project.classes.splice(doomed, 1);
    project.classes.forEach((cls, id) => (cls.id = id));
    const expectedMask = (mask) => {
      if (mask === null) return null;
      const kept = [0, 1, 2].filter((c) => c !== doomed).map((c) => (mask >> c) & 1);
      return kept.reduce((acc, bit, i) => acc | (bit << i), 0);
    };
    assert.deepEqual(project.items.map((item) => item.equip.classes), masks.map(expectedMask), `mask after deleting class ${doomed}`);
    assert.deepEqual(project.party.map((m) => m.classId), classIdsBefore.map((id) => (id === null ? null : id > doomed ? id - 1 : id)));
  }
  const emptied = world();
  emptied.items = [piece(0, 'Sword', 0, { classes: 0b001 })];
  renumberClassDeletion(emptied, 0);
  assert.equal(emptied.items[0].equip.classes, 0, 'a mask emptied by the deletion is 0, not null');
});

test('D3: renumberSpellDeletion drops and shifts class.spells exactly as it does a member list', () => {
  // Catches a class list left pointing at the wrong spell (or at none) after a spell is deleted from the Magic Forge.
  const project = world();
  project.classes[1].spells = [{ spellId: 0, level: 2 }, { spellId: 1, level: 3 }, { spellId: 2, level: 4 }];
  project.party[0].spells = [{ spellId: 1, level: 1 }, { spellId: 2, level: 5 }];
  renumberSpellDeletion(project, 1);
  assert.deepEqual(project.classes[1].spells, [{ spellId: 0, level: 2 }, { spellId: 1, level: 4 }]);
  assert.deepEqual(project.party[0].spells, [{ spellId: 1, level: 5 }]);
  assert.deepEqual(project.classes[0].spells, []);
});

test('D4: a growth profile a class uses cannot be deleted: classes and members are named; unreferenced deletion shifts class.profileId', () => {
  // Catches a profile deletion that ignores classes (the class would keep a dangling profile id), a growthProfileUsers that names only
  // members, a refusal that names only one kind of user, and a shift that forgets class.profileId.
  const project = world([null, 0, null, null]);
  project.party[2].profileId = 1; // a classless member's own profile
  project.party[1].profileId = 1; // a classed member RETAINS a profile: still a reference
  const users = growthProfileUsers(project, 1);
  assert.deepEqual(users.map((u) => u.name), ['Mage', 'Bx', 'Cx'], 'classes first, then members, retained ones included');
  assert.deepEqual(growthProfileUsers(project, 0).map((u) => u.name), ['Knight', 'Thief']);
  assert.throws(() => renumberGrowthProfileDeletion(project, 1), /classes Mage and by Bx, Cx/);
  assert.throws(() => renumberGrowthProfileDeletion(project, 0), /classes Knight, Thief/);
  const before = structuredClone(project);
  try { renumberGrowthProfileDeletion(project, 1); } catch { /* refused */ }
  assert.deepEqual(project, before, 'nothing changed by a refused deletion');
  const free = world();
  free.growthProfiles.push(createGrowthProfile(2, 'Spare'));
  free.classes[2].profileId = 2;
  free.classes[1].profileId = null;
  free.party[0].profileId = 2;
  renumberGrowthProfileDeletion(free, 1);
  assert.deepEqual(free.classes.map((cls) => cls.profileId), [0, null, 1]);
  assert.equal(free.party[0].profileId, 1);
});

// ----------------------------------------------------------------------------------------------- clearStartEquipNotAllowed

test('C1: clearStartEquipNotAllowed({ member }) clears exactly that member\'s newly ineligible starting slots', () => {
  // Catches clearing every slot (an eligible piece lost), clearing none (the error the author never asked for), and collateral on another
  // member, a non-piece slot or a piece of the wrong slot (other rules own those).
  const project = world([0, 1, null, 0]);
  project.items[0].equip.classes = 0b110; // Sword + Robe blocked for class 0 (Knight)
  project.items[1].equip.classes = 0b110;
  project.items[2].equip.classes = 0b001;
  for (const member of [0, 1, 2, 3]) project.party[member].startEquip = [0, 1, 2];
  project.party[3].startEquip = [0, 2, 99]; // slot 2 names a non-piece: not this function's business
  const snapshot = structuredClone(project);
  clearStartEquipNotAllowed(project, { member: 0 });
  assert.deepEqual(project.party[0].startEquip, [null, null, 2], 'Knight loses Sword and Robe, keeps the Ring');
  for (const other of [1, 2, 3]) assert.deepEqual(project.party[other].startEquip, snapshot.party[other].startEquip, `member ${other} untouched`);
  // A wrong-slot piece is left alone.
  const odd = world([0, null, null, null]);
  odd.items[0].equip.classes = 0b110;
  odd.party[0].startEquip = [null, 0, 99]; // Sword in the armor slot, and a non-piece: start-equip-wrong-slot's and -not-a-piece's business
  clearStartEquipNotAllowed(odd, { member: 0 });
  assert.deepEqual(odd.party[0].startEquip, [null, 0, 99]);
  // Nothing to clear: eligible everywhere.
  const fine = world([0, 1, null, 0]);
  for (const member of fine.party) member.startEquip = [0, 1, 2];
  const same = structuredClone(fine);
  clearStartEquipNotAllowed(fine, { member: 1 });
  assert.deepEqual(fine, same);
});

test('C2: clearStartEquipNotAllowed({ item }) clears that piece from exactly the members it now excludes', () => {
  // Catches a clear that also drops the piece from members it still admits, drops other pieces of an excluded member, or touches a
  // member whose bit (not class) excludes it (that is the Worn-by checkbox's own clearing).
  const project = world([0, 1, null, 1]);
  for (const member of project.party) member.startEquip = [0, 1, 2];
  project.items[0].equip.classes = 0b010; // Mages only
  clearStartEquipNotAllowed(project, { item: 0 });
  assert.deepEqual(project.party.map((m) => m.startEquip), [[null, 1, 2], [0, 1, 2], [0, 1, 2], [0, 1, 2]], 'only the Knight loses the Sword; classless keeps it');
  assert.deepEqual(validateProject(project).filter((p) => p.rule === 'start-equip-not-allowed'), []);
  const none = world([0, 1, null, 1]);
  for (const member of none.party) member.startEquip = [0, 1, 2];
  clearStartEquipNotAllowed(none, {});
  clearStartEquipNotAllowed(none, { member: 'x' });
  assert.deepEqual(none.party.map((m) => m.startEquip), [[0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 1, 2]], 'no target: nothing is cleared');
});

// ----------------------------------------------------------------------------------------------- persistence

test('IO1: classes.json is written explicitly (empty array too), round-trips with the member and piece fields, and a missing file loads as []', async (t) => {
  // Catches a conditional write (an author's last deletion would vanish), a read that yields null for a missing file, and a mask / classId
  // that does not survive a save and reload.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-classes-io-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, normalized(createProject('Empty', 'rpg')));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'classes.json'), 'utf8')), []);
  await fs.rm(path.join(dir, 'classes.json'));
  assert.deepEqual((await loadProject(dir)).classes, []);

  const project = world([1, null, 0, null]);
  project.classes[1].spells = [{ spellId: 2, level: 4 }];
  project.items[0].equip.classes = 0;
  project.items[1].equip.classes = 0b010;
  const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-classes-io-'));
  t.after(() => fs.rm(dir2, { recursive: true, force: true }));
  await saveProject(dir2, project);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir2, 'classes.json'), 'utf8')).length, 3);
  const loaded = await loadProject(dir2);
  assert.deepEqual(loaded, project);
  assert.deepEqual(loaded.party.map((m) => m.classId), [1, null, 0, null]);
  assert.deepEqual(loaded.items.map((item) => item.equip.classes), [0, 0b010, null]);
});

test('IO2: a legacy project loads, saves and loads again with only classes.json added', async (t) => {
  // Catches a save that rewrites or drops a legacy file, a load that depends on classes.json existing, and a migration that is not
  // idempotent (the second load must equal the first). The legacy project is a copy of sample-rpg saved once, with classes.json and the
  // class fields stripped back out: what the previous version wrote. The fixtures themselves are never written.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-classes-legacy-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const copy = path.join(dir, 'copy');
  await fs.cp(path.join(ROOT, 'sample-rpg'), copy, { recursive: true, filter: (from) => path.basename(from) !== 'build' });
  await saveProject(copy, await loadProject(copy));
  await fs.rm(path.join(copy, 'classes.json'));
  const strip = async (file, fn) => {
    const p = path.join(copy, file);
    const json = JSON.parse(await fs.readFile(p, 'utf8'));
    fn(json);
    await fs.writeFile(p, JSON.stringify(json, null, 2));
  };
  await strip('party.json', (party) => party.forEach((member) => delete member.classId));
  await strip('items.json', (items) => items.forEach((item) => item.equip && delete item.equip.classes));
  const listing = async (root) => {
    const out = [];
    const walk = async (rel) => {
      for (const entry of await fs.readdir(path.join(root, rel), { withFileTypes: true })) {
        const next = path.join(rel, entry.name);
        if (entry.isDirectory()) await walk(next);
        else out.push(next);
      }
    };
    await walk('');
    return out.sort();
  };
  const before = await listing(copy);
  assert.ok(!before.includes('classes.json'));
  const first = await loadProject(copy);
  assert.deepEqual(first.classes, []);
  assert.ok(first.party.every((member) => member.classId === null));
  assert.ok(first.items.every((item) => !item.equip || item.equip.classes === null));
  await saveProject(copy, first);
  assert.deepEqual(await listing(copy), [...before, 'classes.json'].sort(), 'only classes.json is new');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(copy, 'classes.json'), 'utf8')), []);
  assert.deepEqual(await loadProject(copy), first);
  assert.ok(!(await listing(path.join(ROOT, 'sample-rpg'))).includes('classes.json'), 'the checked-in fixture is untouched');
});

// ----------------------------------------------------------------------------------------------- diagnostics

test('G1: spell-learned-past-max fires for an assigned class entry past maxLevel, naming the class, not for a shadowed member\'s retained list', () => {
  // Catches the old raw `member.spells` loop (a resolver-only build keeps passing every ROM test and gives false author feedback): it
  // would warn for the shadowed member's list, which is not in the ROM, and stay silent for the class list, which is.
  const project = world([1, 1, null, null], { maxLevel: 5 });
  project.classes[1].spells = [{ spellId: 0, level: 2 }, { spellId: 1, level: 9 }];
  project.party[0].spells = [{ spellId: 2, level: 12 }]; // retained, shadowed by the class
  project.party[2].spells = [{ spellId: 0, level: 7 }]; // classless: its own list is the ROM's
  // The project is handed over as authored, not normalized: normalization clamps a level to maxLevel, so only a hand-edited or later
  // lowered maxLevel can leave an entry past it, exactly as the member rule's own tests do.
  const out = battle(project, 'spell-learned-past-max');
  assert.deepEqual(out.map(identity), [
    { severity: 'warning', where: 'Character Forge', rule: 'spell-learned-past-max', subject: { class: 1, spell: 1 }, counts: [9, 5] },
    { severity: 'warning', where: 'Character Forge', rule: 'spell-learned-past-max', subject: { member: 2, spell: 0 }, counts: [7, 5] }
  ], 'once for the class (two members share it), once for the classless member; none for the shadowed list');
  assert.match(out[0].message, /Mage/);
  assert.match(out[1].message, /Cx/);
  // Negative controls: a class entry at the limit, and an unassigned class (not in the ROM).
  const quiet = world([1, null, null, null], { maxLevel: 5 });
  quiet.classes[1].spells = [{ spellId: 0, level: 5 }];
  quiet.classes[0].spells = [{ spellId: 0, level: 99 }]; // nobody holds Knight: not in the ROM
  assert.deepEqual(battle(quiet, 'spell-learned-past-max'), []);
});

test('G2: growth-profile-unused -- silent for a profile only a class references (draft too), fires for an unreferenced one and for one only a shadowed member keeps', () => {
  // Catches the old `new Set(party.map(m => m.profileId))` (a class-only profile called unused), a class counted only when assigned
  // (a draft class IS an authored use), and a shadowed member's retained profile counted as a use (it has no effect on the game).
  const project = world([null, 1, null, null]);
  project.growthProfiles.push(createGrowthProfile(2, 'Spare'), createGrowthProfile(3, 'Retained'), createGrowthProfile(4, 'Mine'));
  project.classes[0].profileId = 0; // Knight is a draft: no member holds it
  project.party[1].profileId = 3; // Bx is a Mage: profile 3 is retained, shadowed
  project.party[2].profileId = 4; // Cx is classless: profile 4 is a real use
  const out = battle(normalized(project), 'growth-profile-unused');
  assert.deepEqual(out.map((p) => p.subject), [{ profile: 2 }, { profile: 3 }], 'profiles 0 (draft class), 1 (assigned class), 4 (classless member) are used');
  assert.ok(out.every((p) => p.severity === 'warning' && p.where === 'Character Forge' && p.rule === 'growth-profile-unused'));
  assert.doesNotMatch(out[0].message, /kept by/);
  assert.match(out[1].message, /Bx/, 'the shadowed profile\'s warning names who keeps it');
  // The deletion guard still sees the retained reference even though the warning calls the profile unused.
  const normal = normalized(project);
  assert.deepEqual(growthProfileUsers(normal, 3).map((u) => u.name), ['Bx']);
  assert.throws(() => renumberGrowthProfileDeletion(normal, 3), /Bx/);
});

test('G3: class-no-profile is an error only for a class some member is assigned; a draft class is silent', () => {
  // Catches an error on a draft class (R4b: drafts are allowed), no error for an assigned profile-less class, and a subject that is not
  // the class index.
  const project = world([null, null, null, null]);
  project.classes[1].profileId = null;
  assert.deepEqual(problems(project, 'class-no-profile'), [], 'draft: silent');
  project.party[2].classId = 1;
  project.party[3].classId = 1;
  const out = problems(normalized(project), 'class-no-profile');
  assert.deepEqual(out.map(identity), [{ severity: 'error', where: 'Character Forge', rule: 'class-no-profile', subject: { class: 1 }, counts: [] }]);
  assert.match(out[0].message, /Mage/);
  assert.match(out[0].message, /Cx, Dx/);
  assert.match(out[0].message, /Character Forge/);
  project.classes[1].profileId = 1;
  assert.deepEqual(problems(normalized(project), 'class-no-profile'), [], 'with a profile: silent');
});

test('G4: class-mask-empty is a warning for an explicit empty mask (e.g. left by a deletion), not for null or a non-empty mask', () => {
  // Catches an emptied mask widened to null (silent), an error instead of a warning (the project still builds), and a warning for `null`.
  const project = world();
  project.items[0].equip.classes = 0b001;
  project.items[1].equip.classes = 0b110;
  renumberClassDeletion(project, 0);
  project.classes.splice(0, 1);
  project.classes.forEach((cls, id) => (cls.id = id));
  assert.deepEqual(project.items.map((item) => item.equip.classes), [0, 0b11, null]);
  const out = problems(project, 'class-mask-empty');
  assert.deepEqual(out.map(identity), [{ severity: 'warning', where: 'Items Forge', rule: 'class-mask-empty', subject: { item: 0 }, counts: [] }]);
  assert.match(out[0].message, /Sword/);
});

test('G4b: deleting the LAST class leaves an explicit 0 mask that still warns, and null masks stay silent in a zero-class project', () => {
  // Catches the diagnostics gated on a non-empty class table: the stored restriction survives the deletion (R4a), matters again when a
  // class is added, and so must keep warning; a null mask, or a member bit that already excludes the member, must stay silent.
  const project = world([null, null, null, null]);
  project.classes.splice(1);
  project.items[0].equip.classes = 0b1; // Sword: Knights only, worn by everyone via usableBy -- all four members are classless
  project.items[1].equip.usableBy = 0b0011;
  project.items[1].equip.classes = 0b1; // Robe: Knights only, but the classless members it names are 0 and 1
  assert.deepEqual(problems(project, 'class-mask-empty'), [], 'one class, bit 0 set: not empty');
  renumberClassDeletion(project, 0);
  project.classes.splice(0, 1);
  assert.equal(project.classes.length, 0);
  assert.deepEqual(project.items.map((item) => item.equip.classes), [0, 0, null]);
  assert.deepEqual(problems(project, 'class-mask-empty').map(identity), [
    { severity: 'warning', where: 'Items Forge', rule: 'class-mask-empty', subject: { item: 0 }, counts: [] },
    { severity: 'warning', where: 'Items Forge', rule: 'class-mask-empty', subject: { item: 1 }, counts: [] }
  ]);
  assert.deepEqual(
    problems(project, 'piece-class-mask-classless-wearer').map((p) => p.subject),
    [{ item: 0, member: 0 }, { item: 0, member: 1 }, { item: 0, member: 2 }, { item: 0, member: 3 }, { item: 1, member: 0 }, { item: 1, member: 1 }],
    'the member bit still decides who is named'
  );
  // Negative controls in the same zero-class project: nothing restricted, nobody named.
  project.items[0].equip.classes = null;
  project.items[1].equip.classes = null;
  assert.deepEqual(problems(project, 'class-mask-empty'), [], 'null mask: silent');
  assert.deepEqual(problems(project, 'piece-class-mask-classless-wearer'), [], 'null mask: no wearer named');
  project.items[0].equip.classes = 0;
  project.items[0].equip.usableBy = 0;
  assert.equal(problems(project, 'class-mask-empty').length, 1, 'a 0 mask still warns even when no member wears it');
  assert.deepEqual(problems(project, 'piece-class-mask-classless-wearer'), [], 'member-bit exclusion: no wearer named');
});

test('G5: piece-class-mask-classless-wearer names the piece and each classless wearer; silent for a null mask or classed-only wearers', () => {
  // Catches a warning for an unrestricted piece, none for a restricted piece a classless member can wear (R3: the limit silently does not
  // apply to them), a subject missing the member, and a warning for a classless member the piece's own bit excludes.
  const project = world([0, 1, null, null]);
  project.items[0].equip.classes = 0b001; // restricted; usableBy everyone: Cx and Dx are classless wearers
  project.items[1].equip.classes = 0b010;
  project.items[1].equip.usableBy = 0b0011; // restricted, but only classed members are named
  project.items[2].equip.classes = null; // unrestricted
  const out = problems(normalized(project), 'piece-class-mask-classless-wearer');
  assert.deepEqual(out.map(identity), [
    { severity: 'warning', where: 'Items Forge', rule: 'piece-class-mask-classless-wearer', subject: { item: 0, member: 2 }, counts: [] },
    { severity: 'warning', where: 'Items Forge', rule: 'piece-class-mask-classless-wearer', subject: { item: 0, member: 3 }, counts: [] }
  ]);
  assert.match(out[0].message, /Sword/);
  assert.match(out[0].message, /Cx/);
  project.party[2].classId = 2;
  project.party[3].classId = 2;
  assert.deepEqual(problems(normalized(project), 'piece-class-mask-classless-wearer'), [], 'no classless wearer left: silent');
});

test('G6: start-equip-not-allowed follows memberMayWear: a class mask can raise it for a classed member, never for a classless one', () => {
  // Catches the old member-bit-only test (a classed member could start in a piece its class may not wear with no error), and a
  // check that restricts a classless member by a class mask.
  const project = world([0, 1, null, null]);
  project.items[0].equip.classes = 0b010; // Mages only
  for (const member of project.party) member.startEquip = [0, null, null];
  const out = problems(normalized(project), 'start-equip-not-allowed');
  assert.deepEqual(out.map(identity), [{ severity: 'error', where: 'Character Forge', rule: 'start-equip-not-allowed', subject: { member: 0, slot: 0 }, counts: [] }]);
  assert.match(out[0].message, /Knight/, 'the advice names the class when the class said no');
  project.items[0].equip.classes = 0b001;
  assert.deepEqual(problems(normalized(project), 'start-equip-not-allowed').map((p) => p.subject), [{ member: 1, slot: 0 }]);
  project.items[0].equip.classes = null;
  project.items[0].equip.usableBy = 0b1110;
  assert.deepEqual(problems(normalized(project), 'start-equip-not-allowed').map((p) => p.subject), [{ member: 0, slot: 0 }], 'the member bit still raises it');
  assert.doesNotMatch(problems(normalized(project), 'start-equip-not-allowed')[0].message, /class/);
});

test('G7: the new diagnostics carry stable kebab-case ids, structured subjects and numeric counts only', () => {
  // Catches an id with a digit or an interpolated subject: the three callers of diagnosticids.test.js decide "same problem" from them.
  const project = world([null, null, 1, null]);
  project.classes[1].profileId = null;
  project.items[0].equip.classes = 0;
  project.items[1].equip.classes = 0b010;
  const all = [...validateProject(normalized(project)), ...checkBattleTables(normalized(project))].filter((p) =>
    ['class-no-profile', 'class-mask-empty', 'piece-class-mask-classless-wearer'].includes(p.rule)
  );
  assert.deepEqual([...new Set(all.map((p) => p.rule))].sort(), ['class-mask-empty', 'class-no-profile', 'piece-class-mask-classless-wearer']);
  for (const p of all) {
    assert.match(p.rule, /^[a-z]+(-[a-z]+)*$/);
    assert.ok(Object.values(p.subject).every(Number.isInteger), p.rule);
    assert.ok(p.counts.every(Number.isInteger), p.rule);
  }
});
