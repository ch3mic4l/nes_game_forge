// Growth profiles, data layer (ROADMAP item 5 remainder, slice C1): the `growthProfiles` table and `member.profileId`
// in the schema, the integer curves, the resolver, the deletion helpers, persistence and the `growth-profile-unused`
// diagnostic. Nothing here builds a ROM: the generator still reads the member's own fields (slice C2).
//
// Every test names the wrong implementation it would catch. Sabotage runs: handoff-next/classes/c1/report.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject, saveProject } from '../../main/project-io.js';
import { checkBattleTables } from '../../main/build/battletables.js';
import { TERRAIN_ENTRIES } from '../../shared/library/terrain/index.js';
import {
  GROWTH_HORIZON_LEVEL,
  GROWTH_LIMITS,
  GROWTH_SHAPES,
  GROWTH_STATS,
  RPG_LIMITS,
  applyPlannedProject,
  createGrowthProfile,
  createPartyMember,
  createProject,
  effectiveGrowth,
  growthProfileUsers,
  memberGrowthFields,
  memberStatAt,
  normalizeProject,
  planLibraryImport,
  profileStatAt,
  renumberGrowthProfileDeletion,
  statAt
} from '../../shared/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const normalized = (project) => normalizeProject(structuredClone(project));
const rec = (base, perLevel, shape = 'linear') => ({ base, perLevel, shape });
const levels = (record) => Array.from({ length: 15 }, (_, i) => profileStatAt(record, i + 1));

/** A normalized RPG project with `profiles` default profiles and `members` party members (member i -> profile `assign[i]`). */
function rpg(profiles = 3, assign = []) {
  const project = createProject('Quest', 'rpg');
  project.growthProfiles = Array.from({ length: profiles }, (_, id) => createGrowthProfile(id, `P${id}`));
  project.party = Array.from({ length: assign.length || 1 }, (_, id) => ({
    ...createPartyMember(id, String.fromCharCode(65 + id) + 'x'),
    profileId: assign[id] ?? null
  }));
  return normalized(project);
}
const unused = (project) => checkBattleTables(project).filter((p) => p.rule === 'growth-profile-unused');

// ----------------------------------------------------------------------------------------------- T-N1 normalize

test('T-N1: an absent growthProfiles / profileId reads as [] / null, and createProject carries both', () => {
  // Catches a normalizer that leaves the field undefined on a pre-profile project (every consumer would then need its own guard).
  const old = createProject('Old', 'rpg');
  delete old.growthProfiles;
  for (const member of old.party) delete member.profileId;
  const loaded = normalizeProject(old);
  assert.deepEqual(loaded.growthProfiles, []);
  assert.ok(loaded.party.every((member) => member.profileId === null));
  assert.deepEqual(createProject('New', 'rpg').growthProfiles, []);
  assert.equal(createPartyMember(0).profileId, null);
});

test('T-N1: more than RPG_LIMITS.growthProfiles profiles are sliced to the cap', () => {
  // Catches a missing slice (a ninth profile would survive and outgrow the limit the UI promises).
  assert.equal(RPG_LIMITS.growthProfiles, 8);
  const project = createProject('Big', 'rpg');
  project.growthProfiles = Array.from({ length: 11 }, (_, id) => ({ name: `P${id}` }));
  const out = normalizeProject(project);
  assert.equal(out.growthProfiles.length, 8);
  assert.equal(out.growthProfiles[7].name, 'P7');
});

test('T-N1: an unknown or missing shape normalizes to linear; the three real shapes survive', () => {
  // Catches a normalizer that keeps an arbitrary string (profileStatAt would then fall through to some branch by accident).
  assert.deepEqual(GROWTH_SHAPES, ['linear', 'early', 'late']);
  const project = createProject('Shapes', 'rpg');
  project.growthProfiles = [{ hp: { shape: 'late' }, mp: { shape: 'early' }, atk: { shape: 'linear' }, def: { shape: 'ease-in' }, mag: { shape: 7 } }];
  const [profile] = normalizeProject(project).growthProfiles;
  assert.deepEqual(
    GROWTH_STATS.map((stat) => profile[stat].shape),
    ['late', 'early', 'linear', 'linear', 'linear', 'linear']
  );
});

test('T-N1: every profile field clamps to GROWTH_LIMITS, min-1 and max+1, and a non-number falls back to the default', () => {
  // Catches a profile normalizer with its own literal ranges (it would drift from the member's, as D1 fixed) or one that drops a stat.
  const project = createProject('Clamp', 'rpg');
  const low = {};
  const high = {};
  const junk = {};
  for (const stat of GROWTH_STATS) {
    const l = GROWTH_LIMITS[stat];
    low[stat] = { base: l.baseMin - 1, perLevel: l.perLevelMin - 1 };
    high[stat] = { base: l.baseMax + 1, perLevel: l.perLevelMax + 1 };
    junk[stat] = { base: 'x', perLevel: 'y' };
  }
  project.growthProfiles = [low, high, junk];
  const [lo, hi, dflt] = normalizeProject(project).growthProfiles;
  const defaults = createGrowthProfile(0);
  for (const stat of GROWTH_STATS) {
    const l = GROWTH_LIMITS[stat];
    assert.deepEqual([lo[stat].base, lo[stat].perLevel], [l.baseMin, l.perLevelMin], `${stat} low`);
    assert.deepEqual([hi[stat].base, hi[stat].perLevel], [l.baseMax, l.perLevelMax], `${stat} high`);
    assert.deepEqual([dflt[stat].base, dflt[stat].perLevel], [defaults[stat].base, defaults[stat].perLevel], `${stat} junk`);
  }
});

test('T-N1: a new profile, and a normalized profile with no stored record, carry HP 24/+5, MP 8/+2, ATK 6/+1, DEF 4/+1, MAG 0/+0, MDEF 0/+0, all linear', () => {
  // The default numbers as literals (c1-review1: the clamp/fallback test above derives its expectation from createGrowthProfile itself,
  // so a createGrowthProfile that used each stat's minimum base and zero growth passed all 26 tests). Catches that mutation, and a
  // normalizer whose missing-record fallback drifts from the creator.
  const DEFAULTS = {
    hp: [24, 5],
    mp: [8, 2],
    atk: [6, 1],
    def: [4, 1],
    mag: [0, 0],
    mdef: [0, 0]
  };
  const shape = (profile) => Object.fromEntries(GROWTH_STATS.map((stat) => [stat, [profile[stat].base, profile[stat].perLevel, profile[stat].shape]]));
  const expected = Object.fromEntries(Object.entries(DEFAULTS).map(([stat, [base, perLevel]]) => [stat, [base, perLevel, 'linear']]));
  assert.deepEqual(shape(createGrowthProfile(0)), expected, 'createGrowthProfile');
  const project = createProject('Defaults', 'rpg');
  project.growthProfiles = [{}, { name: 'Named' }, { hp: {}, mp: null }];
  for (const profile of normalizeProject(project).growthProfiles) assert.deepEqual(shape(profile), expected, profile.name);
});

test('T-N1: a profileId outside [0, profileCount) or not an integer normalizes to null; a live one is kept', () => {
  // Catches a dangling id surviving (a generator would later emit hex(NaN) -> $00 and zero a row, S5) and a Number() coercion of '0'.
  const project = createProject('Ids', 'rpg');
  project.growthProfiles = [{ name: 'A' }, { name: 'B' }];
  project.party = [-1, 2, 1.5, '0', NaN, null, 0, 1].map((profileId, id) => ({ ...createPartyMember(id), profileId }));
  project.gameType = 'rpg';
  // characterCap slices to the party limit, so check in two batches of four.
  const first = normalizeProject(structuredClone(project));
  assert.deepEqual(first.party.map((m) => m.profileId), [null, null, null, null]);
  project.party = project.party.slice(4);
  assert.deepEqual(normalizeProject(project).party.map((m) => m.profileId), [null, null, 0, 1]);
  // And with no profiles at all, even a "valid-looking" 0 is dangling.
  const none = createProject('None', 'rpg');
  none.party[0].profileId = 0;
  assert.equal(normalizeProject(none).party[0].profileId, null);
});

test('T-N1: profile ids are restamped to the array index on load, whatever the file said', () => {
  // Catches an id kept from the file: after a hand edit two profiles could share an id and a deletion would restamp the wrong one.
  const project = createProject('Stamp', 'rpg');
  project.growthProfiles = [{ id: 7, name: 'A' }, { id: 7, name: 'B' }, { name: 'C' }];
  assert.deepEqual(normalizeProject(project).growthProfiles.map((p) => [p.id, p.name]), [[0, 'A'], [1, 'B'], [2, 'C']]);
  const unnamed = createProject('Names', 'rpg');
  unnamed.growthProfiles = [{}, { name: '   ' }];
  assert.deepEqual(normalizeProject(unnamed).growthProfiles.map((p) => p.name), ['Profile 0', 'Profile 1']);
});

test('T-N1: normalizeProject is idempotent over the new fields', () => {
  // Catches a normalizer whose output it cannot read back (e.g. a record shape it re-wraps each pass).
  const project = rpg(3, [1, 2, 0]);
  project.growthProfiles[1].hp = rec(10, 9, 'early');
  const once = normalized(project);
  assert.deepEqual(normalized(once), once);
  assert.deepEqual(once.growthProfiles[1].hp, rec(10, 9, 'early'));
});

test('T-N1: a library import keeps growthProfiles and profileId (they ride the clone / apply)', () => {
  // Catches an apply that rebuilds the project from a field list and drops the new keys.
  const project = rpg(2, [1]);
  project.growthProfiles[1].mag = rec(5, 3, 'late');
  const plan = planLibraryImport(project, TERRAIN_ENTRIES[0], { paletteSlot: 1 });
  assert.ok(plan.ok, plan.reason);
  const target = structuredClone(project);
  applyPlannedProject(target, plan.project);
  assert.deepEqual(target.growthProfiles, project.growthProfiles);
  assert.equal(target.party[0].profileId, 1);
});

// ----------------------------------------------------------------------------------------------- T-N2 curves

test('T-N2: early / late literals for perLevel 3 (hand computed from the integer formulas)', () => {
  // Catches a wrong divisor / rounding constant, swapped early and late, and an off-by-one level (S4: k = level).
  const early = [0, 1, 2, 7, 14].map((k) => profileStatAt(rec(0, 3, 'early'), k + 1));
  const late = [0, 1, 2, 7, 14].map((k) => profileStatAt(rec(0, 3, 'late'), k + 1));
  assert.deepEqual(early, [0, 6, 11, 32, 42]);
  assert.deepEqual(late, [0, 0, 1, 11, 42]);
  // base is added, not folded into the gain.
  assert.deepEqual([1, 2, 15].map((level) => profileStatAt(rec(24, 3, 'early'), level)), [24, 30, 66]);
  // A base-only profile (perLevel 0) is flat in every shape.
  for (const shape of GROWTH_SHAPES) assert.deepEqual(new Set(levels(rec(40, 0, shape))), new Set([40]));
});

test('T-N2: saturation at 255 for every shape', () => {
  // Catches a missing ceiling on the non-linear branches (statAt clamps; a re-implemented curve might not).
  for (const shape of GROWTH_SHAPES) {
    const row = levels(rec(250, 32, shape));
    assert.ok(row.every((v) => v <= 255), shape);
    assert.equal(row[14], 255, shape);
  }
});

test('T-N2: every shape is monotone, <= 255, level 1 == base and level 15 == linear, over base x slope', () => {
  // Catches a curve that dips, overshoots its endpoint or starts above its base (the property the "avg / level to Lv 15" label promises).
  for (const base of [0, 1, 24, 255]) {
    for (const slope of [0, 1, 3, 16, 32]) {
      const linear = levels(rec(base, slope));
      for (const shape of GROWTH_SHAPES) {
        const row = levels(rec(base, slope, shape));
        const label = `${shape} base ${base} slope ${slope}`;
        assert.equal(row[0], base, `${label}: level 1`);
        assert.equal(row[14], linear[14], `${label}: level 15 equals linear`);
        for (let i = 1; i < 15; i++) assert.ok(row[i] >= row[i - 1] && row[i] <= 255, `${label}: level ${i + 1}`);
      }
    }
  }
});

test('T-N2: the horizon is the fixed 15, independent of project.rpg.maxLevel (S12)', () => {
  // Catches a horizon taken from the level cap: lowering maxLevel would retune every level. Pure: profileStatAt and memberStatAt
  // never see rpg.maxLevel, and rows at a lower cap are the prefix of the cap-15 rows.
  assert.equal(GROWTH_HORIZON_LEVEL, 15);
  const project = rpg(1, [0]);
  project.growthProfiles[0].hp = rec(24, 3, 'early');
  const at = (cap) => {
    const copy = structuredClone(project);
    copy.rpg.maxLevel = cap;
    return Array.from({ length: cap }, (_, i) => memberStatAt(copy, copy.party[0], 'hp', i + 1));
  };
  const full = at(15);
  for (const cap of [1, 5, 8, 14]) assert.deepEqual(at(cap), full.slice(0, cap), `cap ${cap}`);
  // The documented cap-8 example: base 24 / +3 at level 8 is linear 45, early 56, late 35.
  assert.deepEqual(['linear', 'early', 'late'].map((shape) => profileStatAt(rec(24, 3, shape), 8)), [45, 56, 35]);
});

// ----------------------------------------------------------------------------------------------- T-N3 resolver

test('T-N3: profileId null returns the member\'s own fields (shape linear); an assigned member returns the profile', () => {
  // Catches a resolver that reads the profile when none is assigned, or ignores the profile when one is.
  const project = rpg(2, [null, 1]);
  project.party[0].baseMag = 4;
  project.party[0].mdefPerLevel = 2;
  project.growthProfiles[1].atk = rec(9, 4, 'late');
  const own = effectiveGrowth(project, project.party[0]);
  assert.deepEqual(own.mag, rec(4, 0));
  assert.deepEqual(own.mdef, rec(0, 2));
  assert.deepEqual(own.hp, rec(project.party[0].baseHp, project.party[0].hpPerLevel));
  assert.deepEqual(Object.keys(own), GROWTH_STATS);
  const assigned = effectiveGrowth(project, project.party[1]);
  assert.deepEqual(assigned.atk, rec(9, 4, 'late'));
  assert.deepEqual(assigned, Object.fromEntries(GROWTH_STATS.map((stat) => [stat, project.growthProfiles[1][stat]])));
  // Own numbers are retained, not read, while a profile is assigned.
  project.party[1].baseAtk = 200;
  assert.equal(memberStatAt(project, project.party[1], 'atk', 1), 9);
  // The result is a copy: editing it never edits the profile.
  assigned.atk.base = 99;
  assert.equal(project.growthProfiles[1].atk.base, 9);
});

test('T-N3: a dangling profileId on an un-normalized project reads as the member\'s own fields, never NaN', () => {
  // Catches a resolver that indexes growthProfiles[id] unguarded (TypeError, or a NaN row).
  const project = rpg(1, [0]);
  project.party[0].profileId = 5;
  assert.equal(memberStatAt(project, project.party[0], 'hp', 3), statAt(project.party[0].baseHp, project.party[0].hpPerLevel, 3));
  delete project.growthProfiles;
  assert.equal(memberStatAt(project, project.party[0], 'hp', 3), statAt(project.party[0].baseHp, project.party[0].hpPerLevel, 3));
});

test('T-N3: memberStatAt(linear) equals statAt for levels 1..15 over random inputs, for all six stats', () => {
  // Catches a linear branch that drifts from statAt by a clamp or a level offset (the identity the ROM-equal claim rests on).
  let seed = 12345;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % (n + 1));
  for (let trial = 0; trial < 200; trial++) {
    const project = createProject('R', 'rpg');
    project.growthProfiles = [createGrowthProfile(0)];
    const member = { ...createPartyMember(0), profileId: trial % 2 ? 0 : null };
    for (const stat of GROWTH_STATS) {
      const fields = memberGrowthFields(stat);
      const value = rec(rnd(255), rnd(32));
      member[fields.base] = value.base;
      member[fields.perLevel] = value.perLevel;
      project.growthProfiles[0][stat] = { ...value };
    }
    project.party = [member];
    for (const stat of GROWTH_STATS) {
      const fields = memberGrowthFields(stat);
      for (let level = 1; level <= 15; level++) {
        assert.equal(memberStatAt(project, member, stat, level), statAt(member[fields.base], member[fields.perLevel], level), `${stat} ${level}`);
      }
    }
  }
  assert.deepEqual(memberGrowthFields('hp'), { base: 'baseHp', perLevel: 'hpPerLevel' });
  assert.deepEqual(memberGrowthFields('mdef'), { base: 'baseMdef', perLevel: 'mdefPerLevel' });
});

// ----------------------------------------------------------------------------------------------- T-R deletion

/** Delete profile `index` the way the Character Forge will: renumber, splice, restamp. */
function deleteProfile(project, index) {
  renumberGrowthProfileDeletion(project, index);
  project.growthProfiles.splice(index, 1);
  project.growthProfiles.forEach((profile, i) => (profile.id = i));
}

test('T-R: deleting an unreferenced first / middle / last profile shifts higher ids, restamps, and round-trips', async (t) => {
  // Catches a renumber that nulls instead of shifting, forgets a higher id, or leaves ids un-restamped.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-gp-r-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const doomed of [0, 1, 2]) {
    // Four members (RPG party cap): on profile 0, 1, 2 and Custom; the doomed profile is free of members.
    const members = [0, 1, 2, null].map((id) => (id === doomed ? null : id));
    const project = rpg(3, members);
    project.growthProfiles.forEach((profile, i) => (profile.hp = rec(10 + i, i + 1, GROWTH_SHAPES[i])));
    const custom = structuredClone(project.party.map(({ baseHp, hpPerLevel, startEquip, spells }) => ({ baseHp, hpPerLevel, startEquip, spells })));
    const survivors = project.growthProfiles.filter((_, i) => i !== doomed).map((p) => p.name);
    deleteProfile(project, doomed);
    assert.deepEqual(project.growthProfiles.map((p) => p.name), survivors, `doomed ${doomed}`);
    assert.deepEqual(project.growthProfiles.map((p) => p.id), [0, 1], 'restamped');
    // Each member still points at the profile it named (by name), and Custom stays null.
    members.forEach((was, i) => {
      if (was === null) assert.equal(project.party[i].profileId, null);
      else assert.equal(project.growthProfiles[project.party[i].profileId].name, `P${was}`, `member ${i}`);
    });
    // Own numbers, spells and equipment were not touched.
    assert.deepEqual(project.party.map(({ baseHp, hpPerLevel, startEquip, spells }) => ({ baseHp, hpPerLevel, startEquip, spells })), custom);
    assert.deepEqual(normalized(project), project, 'equals its own normalizeProject');
    await saveProject(dir, project);
    assert.deepEqual(await loadProject(dir), project, 'survives saveProject / loadProject');
  }
});

test('T-R: a referenced delete is refused -- the helper throws, users are listed, and the project is unchanged (S7)', () => {
  // Catches a delete that nulls or ignores references (a member silently losing its profile) and a throw that fires after mutating.
  const project = rpg(3, [0, 2, 2, 1]);
  const before = structuredClone(project);
  assert.deepEqual(growthProfileUsers(project, 2).map((m) => m.name), ['Bx', 'Cx']);
  assert.deepEqual(growthProfileUsers(project, 0).map((m) => m.id), [0]);
  assert.deepEqual(growthProfileUsers(project, 7), []);
  assert.throws(() => renumberGrowthProfileDeletion(project, 2), /Bx, Cx/);
  assert.throws(() => renumberGrowthProfileDeletion(project, 0), /Ax/);
  assert.deepEqual(project, before, 'nothing moved');
});

test('T-R: the helper reads no profile data, so splicing first gives the same result', () => {
  // Catches a helper that indexes growthProfiles (it would see the spliced list) -- the documented either-order guarantee.
  const a = rpg(3, [null, 1, 2]);
  const b = structuredClone(a);
  renumberGrowthProfileDeletion(a, 0);
  a.growthProfiles.splice(0, 1);
  b.growthProfiles.splice(0, 1);
  renumberGrowthProfileDeletion(b, 0);
  assert.deepEqual(a, b);
  assert.deepEqual(a.party.map((m) => m.profileId), [null, 0, 1]);
});

// ----------------------------------------------------------------------------------------------- T-L ranges

test('T-L: profile clamps equal member clamps for all six stats, including the RC1 counterexamples', () => {
  // Catches a profile domain that differs from the member's (v1's wider mp base 255 / growth 32): a number could then not move
  // between a profile and a custom member without loss.
  const project = createProject('Range', 'rpg');
  const wild = { base: 200, perLevel: 17 };
  project.growthProfiles = [Object.fromEntries(GROWTH_STATS.map((stat) => [stat, { ...wild }]))];
  const memberRaw = { ...createPartyMember(0) };
  for (const stat of GROWTH_STATS) {
    const fields = memberGrowthFields(stat);
    memberRaw[fields.base] = wild.base;
    memberRaw[fields.perLevel] = wild.perLevel;
  }
  project.party = [memberRaw];
  const out = normalizeProject(project);
  for (const stat of GROWTH_STATS) {
    const fields = memberGrowthFields(stat);
    assert.deepEqual(
      [out.growthProfiles[0][stat].base, out.growthProfiles[0][stat].perLevel],
      [out.party[0][fields.base], out.party[0][fields.perLevel]],
      stat
    );
  }
  assert.equal(out.growthProfiles[0].mp.base, 99, 'MP base 200 -> 99');
  assert.deepEqual(['mp', 'atk', 'def'].map((s) => out.growthProfiles[0][s].perLevel), [16, 16, 16], 'growth 17 -> 16');
});

test('T-L: copying profile numbers into a member and back is the identity', () => {
  // Catches asymmetric ranges: a value valid in one editor but clamped in the other.
  const project = createProject('Copy', 'rpg');
  const profile = createGrowthProfile(0);
  for (const stat of GROWTH_STATS) {
    const l = GROWTH_LIMITS[stat];
    profile[stat] = rec(l.baseMax, l.perLevelMax, 'early');
  }
  project.growthProfiles = [profile];
  const member = createPartyMember(0);
  for (const stat of GROWTH_STATS) {
    const fields = memberGrowthFields(stat);
    member[fields.base] = profile[stat].base;
    member[fields.perLevel] = profile[stat].perLevel;
  }
  project.party = [member];
  const out = normalizeProject(project);
  assert.deepEqual(out.growthProfiles[0], profile, 'profile survives untouched at its maxima');
  const back = createGrowthProfile(0);
  for (const stat of GROWTH_STATS) {
    const fields = memberGrowthFields(stat);
    back[stat] = rec(out.party[0][fields.base], out.party[0][fields.perLevel], 'early');
  }
  assert.deepEqual(back, profile);
});

// ----------------------------------------------------------------------------------------------- T-V diagnostic

test('T-V: growth-profile-unused fires for exactly the unreferenced profiles, as a warning with a stable id', () => {
  // Catches a rule that fires on existence (a referenced profile warned), one that never fires, and one missing subject / counts.
  const project = rpg(3, [1, null, 1]);
  const found = unused(project);
  assert.deepEqual(found.map((p) => p.subject), [{ profile: 0 }, { profile: 2 }]);
  assert.ok(found.every((p) => p.severity === 'warning' && p.where === 'Character Forge' && Array.isArray(p.counts)));
  assert.match(found[0].message, /"P0"/);
  assert.deepEqual(unused(rpg(2, [0, 1])), [], 'control: both referenced');
  assert.deepEqual(unused(rpg(0, [null])), [], 'control: no profiles at all');
  // Referencing it clears it; unreferencing brings it back.
  project.party[1].profileId = 0;
  project.party[0].profileId = 2;
  project.party[2].profileId = 2;
  assert.deepEqual(unused(project).map((p) => p.subject), [{ profile: 1 }]);
});

test('T-V: the rule is RPG-only, like the rest of checkBattleTables', () => {
  // Catches a rule raised on an action project, where the profile table is kept but never used.
  const action = createProject('Act', 'action');
  action.growthProfiles = [createGrowthProfile(0)];
  assert.deepEqual(checkBattleTables(action), []);
});

// ----------------------------------------------------------------------------------------------- T-IO persistence

test('T-IO: a referenced non-linear profile and the member\'s retained custom numbers survive save / load', async (t) => {
  // Catches a file omitted from I/O (S9), a dropped shape, or a profile edit that overwrote the member's own numbers.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-gp-io-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const project = rpg(2, [1, null]);
  project.growthProfiles[1].name = 'Mage';
  GROWTH_STATS.forEach((stat, i) => (project.growthProfiles[1][stat] = rec(i, i + 1, GROWTH_SHAPES[i % 3])));
  project.party[0].baseHp = 77;
  project.party[0].hpPerLevel = 9;
  const saved = normalized(project);
  await saveProject(dir, saved);
  assert.ok(JSON.parse(await fs.readFile(path.join(dir, 'growthProfiles.json'), 'utf8')).length === 2);
  const loaded = await loadProject(dir);
  assert.deepEqual(loaded.growthProfiles, saved.growthProfiles);
  assert.equal(loaded.growthProfiles[1].id, 1);
  assert.deepEqual(GROWTH_STATS.map((stat) => loaded.growthProfiles[1][stat].shape), ['linear', 'early', 'late', 'linear', 'early', 'late']);
  assert.equal(loaded.party[0].profileId, 1);
  assert.deepEqual([loaded.party[0].baseHp, loaded.party[0].hpPerLevel], [77, 9]);
  assert.deepEqual(loaded, saved);
});

test('T-IO: [] is written explicitly, and a missing growthProfiles.json loads as []', async (t) => {
  // Catches a conditional write (an author's last deletion would vanish silently) and a missing-file read that throws or yields null.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-gp-io-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, rpg(0, [null]));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'growthProfiles.json'), 'utf8')), []);
  await fs.rm(path.join(dir, 'growthProfiles.json'));
  const loaded = await loadProject(dir);
  assert.deepEqual(loaded.growthProfiles, []);
  assert.equal(loaded.party[0].profileId, null);
});

test('T-IO: assign -> edit profile -> unassign -> save / reload (and a structuredClone restore) returns the original custom numbers', async (t) => {
  // Catches an assignment that bakes the profile into the member (the unassign could not restore the author's numbers, R2 "no bake").
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-gp-io-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const project = rpg(1, [null]);
  const original = project.party[0];
  project.party[0] = { ...original, baseHp: 31, hpPerLevel: 7, baseMag: 5, magPerLevel: 2 };
  const custom = structuredClone(project.party[0]);
  const snapshot = structuredClone(project); // the store's undo mechanism
  project.party[0].profileId = 0;
  project.growthProfiles[0].hp = rec(200, 1, 'late');
  assert.equal(memberStatAt(project, project.party[0], 'hp', 1), 200, 'profile in force');
  project.party[0].profileId = null;
  assert.deepEqual(project.party[0], custom, 'unassign restores the member exactly');
  await saveProject(dir, normalized(project));
  assert.deepEqual((await loadProject(dir)).party[0], custom, 'and it survives reload');
  assert.equal(memberStatAt(snapshot, snapshot.party[0], 'hp', 1), 31, 'the snapshot restore still has the original');
  assert.deepEqual(snapshot.party[0], custom);
});

test('T-IO: the six checked-in fixtures carry no growthProfiles.json and load with [] / null (nothing regenerates them)', async () => {
  // Catches a fixture that gained the file (the six are hand-edited JSON, never regenerated) or a load that needs it.
  for (const name of ['sample', 'sample-mmc1', 'sample-mmc3', 'sample-u512', 'sample-rpg', 'sample-rpg-mmc1']) {
    const dir = path.join(ROOT, name);
    await assert.rejects(fs.access(path.join(dir, 'growthProfiles.json')), `${name} has no growthProfiles.json`);
    const loaded = await loadProject(dir);
    assert.deepEqual(loaded.growthProfiles, [], name);
    assert.ok(loaded.party.every((member) => member.profileId === null), name);
  }
});
