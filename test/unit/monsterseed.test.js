// The Monster Forge's "Start from" picker for "Derive from level..." (docs/design-monster-derive-seed.md §10, U1-U10).
// seedMonsterGrowth and monsterSeedSources (renderer/forges/monster/seed.js) are pure, so this file needs no ROM and no nesasm: it runs on
// in-memory clones of sample-rpg reshaped into the design's fixture F. sample-rpg itself is only ever read.
//
// The expected numbers are written out from the design's oracle (profileStatAt / statAt, cap 255, k = level - 1), never
// computed by calling profileStatAt: a test that reads the function it checks proves nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject } from '../../main/project-io.js';
import { seedMonsterGrowth, monsterSeedSources } from '../../renderer/forges/monster/seed.js';
import {
  planMonsterGrowth,
  applyMonsterGrowth,
  createGrowthProfile,
  MONSTER_GROWTH_FIELDS
} from '../../shared/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
const sampleRpg = await loadProject(SAMPLE_RPG);

const KEYS = MONSTER_GROWTH_FIELDS.map((f) => f.key); // atk def mp gold mag mdef xp
const PARTY_KEYS = ['atk', 'def', 'mp', 'mag', 'mdef'];

const battleOf = (atk, def, mp, gold, mag, mdef, xp, extra = {}) => ({ atk, def, mp, gold, mag, mdef, xp, ...extra });

/** The design's fixture F, built in memory: Slime (open), Snake, Ghoul (damage 0, in an encounter group), Potion; Rian, Mara. */
function fixtureF() {
  const project = structuredClone(sampleRpg);
  project.sprites.actors = [
    { id: 0, name: 'Slime', damage: 1, hp: 20, anims: {}, battle: battleOf(7, 5, 3, 11, 2, 6, 13, { level: 4 }) },
    { id: 1, name: 'Snake', damage: 1, hp: 9, anims: {}, battle: battleOf(21, 17, 9, 33, 5, 8, 70, { level: 12 }) },
    { id: 2, name: 'Ghoul', damage: 0, hp: 9, anims: {}, battle: battleOf(3, 6, 2, 9, 1, 4, 8) },
    { id: 3, name: 'Potion', damage: 0, hp: 1, anims: {}, battle: battleOf(4, 2, 0, 2, 0, 0, 4) }
  ];
  for (const map of project.maps) map.encounters = { ...map.encounters, actorIds: [] };
  project.encounterGroups = [{ id: 0, name: 'Pair', monsters: [2] }];
  const [rian, mara] = project.party;
  Object.assign(rian, {
    name: 'Rian',
    profileId: null,
    baseAtk: 12,
    atkPerLevel: 2,
    baseDef: 9,
    defPerLevel: 1,
    baseMp: 6,
    mpPerLevel: 1,
    baseMag: 4,
    magPerLevel: 3,
    baseMdef: 5,
    mdefPerLevel: 2
  });
  Object.assign(mara, {
    name: 'Mara',
    profileId: null,
    baseAtk: 7,
    atkPerLevel: 1,
    baseDef: 3,
    defPerLevel: 2,
    baseMp: 11,
    mpPerLevel: 3,
    baseMag: 8,
    magPerLevel: 0,
    baseMdef: 1,
    mdefPerLevel: 4
  });
  return project;
}

const RIAN = { kind: 'party', index: 0 };
const RIAN_ROWS = {
  atk: { base: 12, perLevel: 2 },
  def: { base: 9, perLevel: 1 },
  mp: { base: 6, perLevel: 1 },
  mag: { base: 4, perLevel: 3 },
  mdef: { base: 5, perLevel: 2 }
};

/** A profile with the named stats overridden, appended to `project` and returned as its index. */
function addProfile(project, overrides) {
  const profile = createGrowthProfile(project.growthProfiles.length);
  Object.assign(profile, overrides);
  project.growthProfiles.push(profile);
  return profile.id;
}

test('U1: a party seed supplies exactly atk/def/mp/mag/mdef, with the member’s own pairs and no extra keys', () => {
  const project = fixtureF();
  const { rows } = seedMonsterGrowth(project, RIAN);
  assert.deepEqual(Object.keys(rows).sort(), [...PARTY_KEYS].sort());
  assert.deepEqual(rows, RIAN_ROWS);
});

test('U2: a profile-assigned member seeds its profile’s growth, never its retained custom baseX / xPerLevel', () => {
  const project = fixtureF();
  const id = addProfile(project, { atk: { base: 10, perLevel: 3, shape: 'early' } });
  Object.assign(project.party[0], { profileId: id, baseAtk: 99, atkPerLevel: 9 });
  assert.deepEqual(seedMonsterGrowth(project, RIAN).rows.atk, { base: 10, perLevel: 3 });
});

test('U3: a dangling profileId reads as no profile and seeds the member’s own pairs', () => {
  const project = fixtureF();
  project.party[0].profileId = 5;
  assert.equal(project.growthProfiles.length, 0);
  assert.deepEqual(seedMonsterGrowth(project, RIAN).rows, RIAN_ROWS);
});

test('U4: a hand-poked member is clamped to the monster row’s own bounds, not the party’s and not one flat limit', () => {
  const project = fixtureF();
  Object.assign(project.party[0], { atkPerLevel: 40, magPerLevel: 40, baseMp: 300 });
  const { rows } = seedMonsterGrowth(project, RIAN);
  assert.equal(rows.atk.perLevel, 32); // the monster's atk step goes to 32 (a party member's stops at 16)
  assert.equal(rows.mag.perLevel, 16); // mag/mdef agree at 16
  assert.equal(rows.mp.base, 255); // the monster's mp ceiling is 255 (a party member's is 99)
});

test('U5: curves lists each non-linear stat that actually grows, with its own shape', () => {
  const project = fixtureF();
  const id = addProfile(project, {
    atk: { base: 10, perLevel: 3, shape: 'early' },
    def: { base: 20, perLevel: 2, shape: 'late' },
    mag: { base: 4, perLevel: 2, shape: 'linear' },
    mdef: { base: 5, perLevel: 0, shape: 'early' }
  });
  project.party[0].profileId = id;
  assert.deepEqual(seedMonsterGrowth(project, RIAN).curves, [
    { key: 'atk', shape: 'early' },
    { key: 'def', shape: 'late' }
  ]);
  assert.deepEqual(seedMonsterGrowth(fixtureF(), RIAN).curves, []);
});

test('U6a: an actor seed supplies all seven rows as flat Base with + / level 0, clamped to each row’s ceiling', () => {
  const project = fixtureF();
  const snake = { kind: 'actor', index: 1 };
  assert.deepEqual(seedMonsterGrowth(project, snake).rows, {
    atk: { base: 21, perLevel: 0 },
    def: { base: 17, perLevel: 0 },
    mp: { base: 9, perLevel: 0 },
    gold: { base: 33, perLevel: 0 },
    mag: { base: 5, perLevel: 0 },
    mdef: { base: 8, perLevel: 0 },
    xp: { base: 70, perLevel: 0 }
  });
  project.sprites.actors[1].battle.xp = 70000;
  assert.equal(seedMonsterGrowth(project, snake).rows.xp.base, 65535);
  assert.deepEqual(seedMonsterGrowth(project, snake).curves, []);
});

test('U6b: an actor with no battle record, or only a level, seeds the renderer defaults 4/2/0/2/0/0/4', () => {
  const defaults = { atk: 4, def: 2, mp: 0, gold: 2, mag: 0, mdef: 0, xp: 4 };
  for (const battle of [undefined, { level: 12 }]) {
    const project = fixtureF();
    if (battle) project.sprites.actors[1].battle = battle;
    else delete project.sprites.actors[1].battle;
    const { rows } = seedMonsterGrowth(project, { kind: 'actor', index: 1 });
    assert.deepEqual(
      Object.fromEntries(KEYS.map((key) => [key, rows[key].base])),
      defaults,
      JSON.stringify(battle) ?? 'no battle'
    );
  }
});

test('U6c: a stored 0 stays 0 -- the fallback is for missing fields, not falsy ones', () => {
  const project = fixtureF();
  Object.assign(project.sprites.actors[1].battle, { atk: 0, gold: 0, xp: 0 });
  const { rows } = seedMonsterGrowth(project, { kind: 'actor', index: 1 });
  assert.equal(rows.atk.base, 0);
  assert.equal(rows.gold.base, 0);
  assert.equal(rows.xp.base, 0);
});

test('U6d: a nullish stored field is missing and opens as its default, not as the 0 normalizeActor gives a loaded null', () => {
  const project = fixtureF();
  project.sprites.actors[1].battle = { atk: null, def: 5 };
  let { rows } = seedMonsterGrowth(project, { kind: 'actor', index: 1 });
  assert.equal(rows.atk.base, 4);
  assert.equal(rows.def.base, 5);
  project.sprites.actors[1].battle = { atk: undefined };
  ({ rows } = seedMonsterGrowth(project, { kind: 'actor', index: 1 }));
  assert.equal(rows.atk.base, 4);
});

/** Derive `rows` onto a fresh clone's Slime at `level`, as the modal's Apply does, and return the seven stored values. */
function deriveAt(project, rows, level) {
  const clone = structuredClone(project);
  clone.sprites.actors[0].battle = battleOf(0, 0, 0, 0, 0, 0, 0, { level });
  const plan = planMonsterGrowth(clone, 0, rows);
  if (plan) applyMonsterGrowth(clone, plan);
  return clone.sprites.actors[0].battle;
}

test('U7: a copied pair derives as a straight line -- it meets the curve at levels 1 and 15, not in between', () => {
  const cases = [
    // [label, stat, member overrides / profile stat, [L1, L8, L15]]
    ['linear (Rian atk 12 +2)', 'atk', null, [12, 26, 40]],
    ['early (profile atk 10 +3)', 'atk', { atk: { base: 10, perLevel: 3, shape: 'early' } }, [10, 31, 52]],
    ['late (profile def 20 +2)', 'def', { def: { base: 20, perLevel: 2, shape: 'late' } }, [20, 34, 48]],
    ['saturating (Rian mag 99 +16)', 'mag', { mag: { base: 99, perLevel: 16, shape: 'linear' } }, [99, 211, 255]]
  ];
  for (const [label, stat, profile, [l1, l8, l15]] of cases) {
    const project = fixtureF();
    if (profile) project.party[0].profileId = addProfile(project, profile);
    const { rows } = seedMonsterGrowth(project, RIAN);
    assert.equal(deriveAt(project, rows, 1)[stat], l1, `${label} at level 1`);
    assert.equal(deriveAt(project, rows, 8)[stat], l8, `${label} at level 8`);
    assert.equal(deriveAt(project, rows, 15)[stat], l15, `${label} at level 15`);
  }
  const saturating = fixtureF();
  saturating.party[0].profileId = addProfile(saturating, { mag: { base: 99, perLevel: 16, shape: 'linear' } });
  assert.equal(deriveAt(saturating, seedMonsterGrowth(saturating, RIAN).rows, 12).mag, 255);
});

test('U8: the list is self, then the other catalog monsters in id order, then the party -- ids and groups only', () => {
  const project = fixtureF();
  const sources = monsterSeedSources(project, 0);
  assert.deepEqual(
    sources.map((s) => [s.id, s.group]),
    [
      ['self', null],
      ['actor:1', 'Other monsters'], // Snake
      ['actor:2', 'Other monsters'], // Ghoul: damage 0 but named by an encounter group, so still in the catalog
      ['party:0', 'Party members'], // Rian
      ['party:1', 'Party members'] // Mara
    ]
  );
  // The open monster is `self`, never listed again, whichever one is open.
  assert.deepEqual(
    monsterSeedSources(project, 1).map((s) => s.id),
    ['self', 'actor:0', 'actor:2', 'party:0', 'party:1']
  );
});

test('U9: a party entry’s rows are total -- self’s xp/gold fill what the member does not supply', () => {
  const project = fixtureF();
  project.sprites.actors[0].battle.xp = 77;
  project.sprites.actors[0].battle.gold = 33;
  const sources = monsterSeedSources(project, 0);
  const rian = sources.find((s) => s.id === 'party:0');
  assert.deepEqual(Object.keys(rian.rows).sort(), [...KEYS].sort());
  assert.deepEqual(rian.rows.xp, { base: 77, perLevel: 0 });
  assert.deepEqual(rian.rows.gold, { base: 33, perLevel: 0 });
  assert.deepEqual(rian.filled.slice().sort(), [...PARTY_KEYS].sort());
  assert.deepEqual(rian.rows.atk, RIAN_ROWS.atk);
  assert.deepEqual(sources.find((s) => s.id === 'actor:1').filled.slice().sort(), [...KEYS].sort());
  assert.deepEqual(sources[0].filled.slice().sort(), [...KEYS].sort());
});

test('U10: both helpers are pure, and no returned row aliases the project, another call or another entry', () => {
  const project = fixtureF();
  const before = JSON.stringify(project);
  const first = monsterSeedSources(project, 0);
  const seeded = seedMonsterGrowth(project, RIAN);
  assert.equal(JSON.stringify(project), before);

  first[3].rows.atk.base = 250; // Rian's atk row
  seeded.rows.def.perLevel = 31;
  assert.equal(JSON.stringify(project), before, 'a returned row aliases project data');
  const second = monsterSeedSources(project, 0);
  assert.equal(second[3].rows.atk.base, 12, 'a second call shares a row with the first');
  assert.equal(seedMonsterGrowth(project, RIAN).rows.def.perLevel, 1);

  const selfXp = second[0].rows.xp;
  second[3].rows.xp.base = 1; // Rian's xp row is a copy of self's, not self's object
  assert.equal(selfXp.base, 13, 'a party entry shares self’s xp row');
  assert.notEqual(second[1].rows.atk, second[2].rows.atk);
  assert.deepEqual(Object.keys(second[3].rows.atk).sort(), ['base', 'perLevel']);
});
