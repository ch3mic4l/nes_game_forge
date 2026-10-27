// Build-time classes, slice C2 (ROADMAP item 5 remainder; handoff-next/classes-bc/design.md sec 3.2, 6 "Class growth resolver"): the three
// precedence cases of the class growth resolver (`growthRecord` in shared/project.js), each asserted twice -- on the resolver's own data
// (`effectiveGrowth` / `memberStatAt`) and on the ROM (the classed project builds the byte-identical ROM of the hand-resolved UNCLASSED
// project, and its pc_*_at tables are the intended curves):
//
//   P1  a class with a valid profile wins over the member's own profile AND its own numbers (even where the class stat is zero);
//   P2  a class with `profileId: null` assigned to a member that retains `profileId = k` falls back to profile k, never to raw numbers;
//   P3  a class with no profile, assigned to a member with no retained profile, falls back to the member's custom numbers.
//
// What "the ROM" means for P2 and P3: the build gate refuses a profile-less class that a member is assigned (`class-no-profile` is a
// validateProject error, which generateAssets throws on before nesasm -- the design assumed such a project "builds anyway"; it does not). So P1
// is compared as a built ROM (byte-identical to the hand-resolved unclassed project), while P2 and P3 -- reachable only by calling the
// generator directly -- are compared as the generated tables (`battleTables`, the text that becomes assets/*.inc: identical to the hand-resolved
// project's, and equal to the intended curves). A test further down pins the refusal itself.
//
// Three wrong resolvers each fail one case: `member-profile-wins` (precedence inverted: P1 builds the member's Decoy profile),
// `fallback-uses-raw-numbers` (P2 builds the member's raw numbers) and `class-curve-flattened` (P1 builds a linear curve). The expectations
// are written here (`statOracle`, `ownGrowth` of test/lib/classcases.js), never read off the code under test. Variants live in mkdtemp
// directories (readRom); no fixture is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveGrowth, memberStatAt } from '../../shared/project.js';
import { CASE_BASES, CASE_BOARDS, GATE_SCENARIOS, buildCase, checkGrowth, checkSpells, ownGrowth, readRom, readTables, statOracle } from '../lib/classcases.js';

const STATS = ['hp', 'mp', 'atk', 'def', 'mag', 'mdef'];

/**
 * One precedence project on `board`: member 0 is Warrior (profile 0, non-linear, zero mp) and retains profile 2 (Decoy) plus positive numbers;
 * member 1 is a profile-less class that retains profile 1 (Mage); member 2 is a profile-less class and retains nothing (custom numbers);
 * member 3 is classless. Returns { classed, hand, intent, c } -- `hand` is the same game written WITHOUT classes.
 */
async function precedenceProject(board) {
  const c = await buildCase(CASE_BASES[0], board, GATE_SCENARIOS[0]);
  const { profiles, roles, projects } = c;
  const classed = structuredClone(projects.base);
  classed.growthProfiles = structuredClone(profiles);
  classed.classes = [
    { id: 0, name: 'Warrior', profileId: 0, spells: structuredClone(roles[0].spells) },
    { id: 1, name: 'Drifter', profileId: null, spells: [] },
    { id: 2, name: 'Plain', profileId: null, spells: [] }
  ];
  const retained = projects.unassigned.party; // members 0 and 1 carry the retained positive numbers; member 0 retains profile 2
  classed.party[0] = Object.assign(structuredClone(retained[0]), { classId: 0 });
  classed.party[1] = Object.assign(structuredClone(retained[1]), { classId: 1, profileId: 1 });
  Object.assign(classed.party[2], { classId: 2, profileId: null, baseHp: 41, hpPerLevel: 7, baseMp: 5, mpPerLevel: 2, baseAtk: 9, atkPerLevel: 3, baseDef: 6, defPerLevel: 1 });
  const hand = structuredClone(classed);
  hand.classes = [];
  hand.party.forEach((m) => { m.classId = null; });
  hand.party[0].profileId = 0;           // P1: the class's profile
  hand.party[1].profileId = 1;           // P2: the member's retained profile
  hand.party[2].profileId = null;        // P3: its own numbers
  hand.party[0].spells = structuredClone(roles[0].spells);
  hand.party[1].spells = [];
  hand.party[2].spells = [];
  const intent = [
    { growth: structuredClone(profiles[0]), spells: roles[0].spells },
    { growth: structuredClone(profiles[1]), spells: [] },
    { growth: ownGrowth(classed.party[2]), spells: [] },
    { growth: ownGrowth(classed.party[3]), spells: classed.party[3].spells ?? [] }
  ];
  return { c: { ...c, tag: `precedence/${board.name}`, intent: { prec: intent } }, classed, hand, intent };
}

for (const board of CASE_BOARDS) {
  test(`${board.name}: class growth precedence -- a profiled class wins, a profile-less class falls back to the retained profile, then to the custom numbers (resolver data)`, async () => {
    // Catches member-profile-wins (P1 reads Decoy), fallback-uses-raw-numbers (P2 reads the retained positive numbers), a zero class stat read
    // as unset (P1's mp is zero under retained mp 77), a flattened class curve, and a custom-numbers fallback that reads the wrong member.
    const { classed, intent } = await precedenceProject(board);
    classed.party.forEach((member, m) => {
      const got = effectiveGrowth(classed, member);
      for (const stat of STATS) {
        assert.deepEqual(got[stat], { base: intent[m].growth[stat].base, perLevel: intent[m].growth[stat].perLevel, shape: intent[m].growth[stat].shape ?? 'linear' }, `member ${m} ${stat}: effectiveGrowth`);
        for (let level = 1; level <= 15; level++) assert.equal(memberStatAt(classed, member, stat, level), statOracle({ shape: 'linear', ...intent[m].growth[stat] }, level), `member ${m} ${stat} level ${level}: memberStatAt`);
      }
    });
    // The three precedence cases are distinguishable: each wrong answer would differ from the right one at a level where it can.
    assert.notEqual(statOracle(intent[0].growth.hp, 15), statOracle(classed.growthProfiles[2].hp, 15), 'P1: Decoy differs from Warrior');
    assert.notEqual(statOracle(intent[1].growth.hp, 15), statOracle({ base: classed.party[1].baseHp, perLevel: classed.party[1].hpPerLevel, shape: 'linear' }, 15), 'P2: the retained numbers differ from the retained profile');
    assert.notEqual(statOracle(intent[0].growth.hp, 5), statOracle({ ...intent[0].growth.hp, shape: 'linear' }, 5), 'P1: the class curve is not linear (level 5; early and linear meet at the horizon)');
    assert.equal(statOracle(intent[0].growth.mp, 15), 0, 'P1: the class mp is zero everywhere (the retained mp 77 must not show)');
  });

  test(`${board.name}: class growth precedence on the generated tables -- P1, P2 and P3 equal the hand-resolved unclassed project and the intended curves`, async () => {
    // Catches the same wrong resolvers as the data test, from the other side: the generated pc_hp/mp/atk/def_at and pc_spells_at rows (a class
    // with no profile cannot be built, see the header, so the generator is read directly).
    const { c, classed, hand } = await precedenceProject(board);
    const [x, y] = [readTables(classed, `${c.tag} classed`), readTables(hand, `${c.tag} hand-resolved`)];
    checkGrowth(c, 'prec', x);
    checkSpells(c, 'prec', x);
    checkGrowth(c, 'prec', y);
    assert.equal(x.text, y.text, `${c.tag}: the classed project's generated tables differ from the hand-resolved project's`);
  });

  test(`${board.name}: class growth precedence P1 on the ROM -- a profiled class builds the byte-identical ROM of the hand-resolved unclassed project`, async () => {
    // Catches member-profile-wins and class-curve-flattened on the real image (member 0 retains profile 2 and positive numbers under a
    // non-linear zero-mp class). Only member 0 is classed here: a profile-less class is refused by the build gate.
    const { c, classed, hand } = await precedenceProject(board);
    for (const project of [classed, hand]) { project.party[1].classId = null; project.party[2].classId = null; project.party[1].spells = []; }
    classed.party[1].profileId = 1; hand.party[1].profileId = 1; // members 1 and 2 are plain unclassed members whose own profile / numbers decide
    classed.classes = classed.classes.slice(0, 1);
    const [x, y] = [await readRom(classed, `${c.tag} classed`), await readRom(hand, `${c.tag} hand-resolved`)];
    checkGrowth(c, 'prec', x);
    assert.equal(x.size, y.size, 'same size');
    assert.ok(x.rom.equals(y.rom), `${c.tag}: the classed ROM differs from the hand-resolved one (sha256 ${x.sha} vs ${y.sha})`);
  });

  test(`${board.name}: the build gate refuses a profile-less class that a member is assigned, so P2 and P3 cannot reach a ROM`, async () => {
    // Pins the premise of the tables-level comparison above: if the gate ever let it through, P2 and P3 must be compared as ROMs.
    const { classed } = await precedenceProject(board);
    await assert.rejects(readRom(classed, 'profile-less class'), /has no growth profile/, 'class-no-profile is a build error');
  });
}
