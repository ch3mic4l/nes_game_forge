// The Monster Forge's "Derive from level..." action (ROADMAP item 14 point
// 2, phase 3, docs/design-monster-level-scaling.md). planMonsterGrowth and
// applyMonsterGrowth (shared/project.js) are pure; every same-tree proof in
// §3.7 lives here, plus the structural proof from §3.4 that statAt is a
// real import in main/build/battletables.js, not a local reimplementation.
//
// sample-rpg is never mutated: it is loaded once (read-only), then either
// structuredClone'd for the purely arithmetic cases below, or round-tripped
// through a real save/load into its own mkdtemp directory for the cases
// that specifically want a disk-validated project object (the same-tree
// comparison, the magic-gate-flip case, and the level-without-reapply
// case) -- the ones docs/design-monster-level-scaling.md §3.7 itself frames
// as "build two copies of sample-rpg in a mkdtemp directory". Nothing here
// calls buildProject or nesasm: battleTables/battleTableBytes operate on a
// project object directly, so this file needs no ROM at all, unlike
// test/unit/monsterlevel.test.js's own byte-identity proof.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { loadProject, saveProject } from '../../main/project-io.js';
import { battleTables, battleTableBytes } from '../../main/build/battletables.js';
import { planMonsterGrowth, applyMonsterGrowth, statAt, MONSTER_GROWTH_FIELDS, RPG_LIMITS } from '../../shared/project.js';
import { declaredLocalNames, namedImportSource } from '../lib/sourcescan.js';

/** Fails loudly if `text` is not a real, parseable ES module -- every
 *  negative control below must be one, per round-2 review finding 1: a
 *  construction the tokenizer-based detector rejects is only meaningful
 *  evidence if it could actually ship. */
function assertValidModule(text) {
  parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');

/** Read-only; never written back. Safe to structuredClone freely. */
async function freshProjectInMemory() {
  return loadProject(SAMPLE_RPG);
}

/**
 * A real save/load round trip into a fresh mkdtemp directory, never into
 * sample-rpg itself. Used only where a test wants a project object that has
 * actually passed through normalizeProject via the real save path (design
 * §3.7's own "two copies... in a mkdtemp directory"), not merely an
 * in-memory clone.
 */
async function freshProjectOnDisk(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-mongrowth-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const original = await loadProject(SAMPLE_RPG);
  await saveProject(dir, original);
  return loadProject(dir);
}

function findSnake(project) {
  return project.sprites.actors.findIndex((a) => a.name === 'Snake');
}

// --- §3.4: statAt is a real import, not a local reimplementation ----------
//
// The structural claim is two assertions together, both required: (1)
// battletables.js declares no *local* binding named statAt of any kind
// (function, const, let, var, class), and (2) the local binding statAt IS
// one bound by a real `import { ... } from '../../shared/project.js'`
// clause. Round-2 review finding 1: a version checking only "some name in
// the import clause is statAt" (rather than the clause's own local name)
// would accept an import aliased away from statAt entirely, with a real
// local statAt reimplementation sitting right next to it -- every negative
// control below is a real, `acorn`-parseable module, not merely a string
// the tokenizer happens to choke on.

test('main/build/battletables.js declares no local statAt of any kind, and its statAt binding imports from shared/project.js', () => {
  const text = fs.readFileSync(path.join(ROOT, 'main/build/battletables.js'), 'utf8');
  assertValidModule(text);
  assert.equal(declaredLocalNames(text).has('statAt'), false);
  assert.equal(namedImportSource(text, 'statAt'), '../../shared/project.js');
});

test('negative control (a): the import aliased away, plus a local const arrow reimplementation -- the reviewer’s own construction', () => {
  const sabotaged =
    "import { statAt as unusedSharedStatAt } from '../../shared/project.js';\n" +
    "export { statAt } from '../../shared/project.js';\n" +
    'const statAt = (base, perLevel, level) => Math.max(0, Math.min(255, base + (level - 1) * perLevel));\n' +
    'export { statAt as localStatAt };\n';
  assertValidModule(sabotaged);
  // Both assertions the real test relies on must fail here: a local statAt
  // exists (the arrow), and the local name statAt is not actually bound by
  // the import (it is aliased to unusedSharedStatAt instead).
  assert.equal(declaredLocalNames(sabotaged).has('statAt'), true);
  assert.notEqual(namedImportSource(sabotaged, 'statAt'), '../../shared/project.js');
});

test('negative control (b): a function statAt with the import removed entirely', () => {
  const sabotaged = 'export function statAt(base, perLevel, level) {\n  return Math.max(0, Math.min(255, base + perLevel * (level - 1)));\n}\n';
  assertValidModule(sabotaged);
  assert.equal(declaredLocalNames(sabotaged).has('statAt'), true);
  assert.equal(namedImportSource(sabotaged, 'statAt'), null);
});

test('negative control (c): an aliased import with no local statAt binding at all', () => {
  const sabotaged = "import { statAt as x } from '../../shared/project.js';\nexport { x };\n";
  assertValidModule(sabotaged);
  assert.equal(declaredLocalNames(sabotaged).has('statAt'), false);
  // There is no local `statAt` bound by this import either -- the module
  // has no real statAt binding at all, which the real test's own second
  // assertion (namedImportSource(text, 'statAt') === '../../shared/project.js')
  // correctly refuses to accept as equivalent to having one.
  assert.equal(namedImportSource(sabotaged, 'statAt'), null);
});

// --- planMonsterGrowth: the pure core ---------------------------------------

test('a null battle.level produces a null plan, not a "treat as level 1" derivation', async () => {
  const project = await freshProjectInMemory();
  const snakeId = findSnake(project);
  assert.equal(project.sprites.actors[snakeId].battle.level, null);
  const growth = { atk: { base: 10, perLevel: 2 } };
  assert.equal(planMonsterGrowth(project, snakeId, growth), null);
});

test('an undefined battle.level (not merely null) also produces a null plan', async () => {
  // Round-2 review finding 4: a guard written as `level === null` alone
  // (rather than `level === null || level === undefined`) would still pass
  // the test above but silently treat an *undefined* level as level 1, the
  // identical hazard for the other value this field can hold when unset.
  const project = await freshProjectInMemory();
  const snakeId = findSnake(project);
  delete project.sprites.actors[snakeId].battle.level;
  assert.equal(project.sprites.actors[snakeId].battle.level, undefined);
  const growth = { atk: { base: 10, perLevel: 2 } };
  assert.equal(planMonsterGrowth(project, snakeId, growth), null);
});

test('an already-populated, unchanged actor produces a null plan -- the strong "no-op" reading', async () => {
  const project = await freshProjectInMemory();
  const snakeId = findSnake(project);
  project.sprites.actors[snakeId].battle.level = 5;
  const battle = project.sprites.actors[snakeId].battle;
  const growth = {};
  for (const { key } of MONSTER_GROWTH_FIELDS) {
    growth[key] = { base: battle[key], perLevel: 0 };
  }
  assert.equal(planMonsterGrowth(project, snakeId, growth), null);
});

test('a same-session actor with only { level } gets every field written on the first Apply -- not the no-op case', async () => {
  // Deliberately NOT round-tripped through save/load: normalizeProject would
  // fill in every missing battle.* field with its own default, which is
  // exactly the state this test needs to NOT have -- it reproduces
  // sprite.js's own Add-actor handler (pushes an actor with no battle key
  // at all) followed by monster.js's set('level', ...) (spreads undefined
  // into { level }), before any save/reload has ever touched the project.
  const project = await freshProjectInMemory();
  const snakeId = findSnake(project);
  project.sprites.actors[snakeId].battle = { level: 12 };

  const growth = {};
  for (const { key } of MONSTER_GROWTH_FIELDS) {
    growth[key] = { base: 7, perLevel: 0 };
  }
  const plan = planMonsterGrowth(project, snakeId, growth);
  assert.notEqual(plan, null);
  assert.equal(Object.keys(plan.writes).length, MONSTER_GROWTH_FIELDS.length, 'every field must be written, since every stored value is undefined');
  applyMonsterGrowth(project, plan);
  for (const { key } of MONSTER_GROWTH_FIELDS) {
    assert.equal(project.sprites.actors[snakeId].battle[key], 7);
  }
});

test('fractional battle.level and fractional Base/+level inputs are rounded, not refused or truncated', async () => {
  const project = await freshProjectInMemory();
  const snakeId = findSnake(project);
  project.sprites.actors[snakeId].battle.level = 2.6; // rounds to 3
  const growth = { atk: { base: 5.4, perLevel: 1.6 } }; // rounds to 5 and 2
  const plan = planMonsterGrowth(project, snakeId, growth);
  assert.notEqual(plan, null);
  // statAt(5, 2, 3, 255) = 5 + 2*2 = 9
  assert.equal(plan.writes.atk, statAt(5, 2, 3, 255));
  assert.equal(plan.writes.atk, 9);
});

test('unsaturated out-of-range inputs clamp to the descriptor’s own bounds, distinguishably from a saturated result', async () => {
  const project = await freshProjectInMemory();
  const snakeId = findSnake(project);
  project.sprites.actors[snakeId].battle.level = 2;
  const growth = {
    gold: { base: 0, perLevel: 33 }, // perLevelMax 32 -> clamped to 32 before statAt
    mag: { base: 0, perLevel: 17 }, // perLevelMax 16 -> clamped to 16
    mdef: { base: 0, perLevel: 17 }, // perLevelMax 16 -> clamped to 16
    xp: { base: 0, perLevel: 300 } // perLevelMax 65535 -> not clamped at all
  };
  const plan = planMonsterGrowth(project, snakeId, growth);
  assert.notEqual(plan, null);
  // At level 2, statAt(0, perLevel, 2, ceiling) = perLevel exactly (one step
  // of growth), so these numbers directly expose whether perLevel itself
  // was clamped before the call, not merely whether the final result
  // happened to sit under some ceiling -- a saturated example (e.g. Base
  // 255) would clamp to 255 under both a correct 32 cap and a wrong 255
  // one, proving nothing (the exact trap N7 named).
  assert.equal(plan.writes.gold, 32, 'Gold growth of 33/level must clamp to 32, not saturate at some higher value');
  assert.equal(plan.writes.mag, 16, 'Magic growth of 17/level must clamp to 16');
  assert.equal(plan.writes.mdef, 16, 'Magic defence growth of 17/level must clamp to 16');
  assert.equal(plan.writes.xp, 300, 'Experience growth of 300/level must NOT be capped at a byte');
});

test('planMonsterGrowth itself never mutates the project -- purity, not merely the apply step', async () => {
  // Round-2 review finding 4: a planner that computed and wrote the
  // intended values while *constructing* the plan (rather than only
  // reading and returning them) could still pass every "applied vs
  // expected" comparison in this file, since those compare the project
  // only *after* apply has run too. This snapshots immediately after
  // planMonsterGrowth returns and before applyMonsterGrowth is ever called.
  const project = await freshProjectInMemory();
  const snakeId = findSnake(project);
  project.sprites.actors[snakeId].battle.level = 7;
  const beforePlan = structuredClone(project);
  const growth = { atk: { base: 30, perLevel: 4 }, xp: { base: 200, perLevel: 500 } };
  const plan = planMonsterGrowth(project, snakeId, growth);
  assert.notEqual(plan, null);
  assert.deepEqual(project, beforePlan, 'planMonsterGrowth must not write anything -- only applyMonsterGrowth may');
});

test('applyMonsterGrowth touches nothing outside the target actor’s own battle object', async () => {
  const project = await freshProjectInMemory();
  const snakeId = findSnake(project);
  project.sprites.actors[snakeId].battle.level = 4;
  const before = structuredClone(project);
  const growth = { atk: { base: 20, perLevel: 3 } };
  const plan = planMonsterGrowth(project, snakeId, growth);
  assert.notEqual(plan, null);
  applyMonsterGrowth(project, plan);

  // Put the one field that legitimately changed back, then the whole
  // project must be identical to the pre-apply snapshot -- proving no
  // other actor, no other field on this actor, and nothing else in the
  // project (maps, party, spells, ...) was touched.
  assert.notEqual(project.sprites.actors[snakeId].battle.atk, before.sprites.actors[snakeId].battle.atk);
  project.sprites.actors[snakeId].battle.atk = before.sprites.actors[snakeId].battle.atk;
  assert.deepEqual(project, before);
});

// --- §3.7: the same-tree comparison against an independent expectation -----

test('applying a derive plan matches an independently hand-set copy exactly, and compiles identically', async (t) => {
  const applied = await freshProjectOnDisk(t);
  const expected = await freshProjectOnDisk(t);
  const snakeId = findSnake(applied);
  assert.equal(snakeId, findSnake(expected));

  const level = 12; // > this project's own rpg.maxLevel (8), <= the fixed
  // RPG_LIMITS.maxLevel (15) planMonsterGrowth actually clamps against --
  // see docs/design-monster.md §3 for why the two are deliberately
  // different ceilings.
  assert.ok(level <= RPG_LIMITS.maxLevel);

  // One distinct growth rate per field, so each field's own arithmetic (and
  // its own ceiling) is exercised, not just Attack's.
  const growth = {
    atk: { base: 10, perLevel: 2 }, // 10 + 2*11 = 32
    def: { base: 5, perLevel: 1 }, // 5 + 1*11 = 16
    mp: { base: 20, perLevel: 3 }, // 20 + 3*11 = 53
    gold: { base: 1, perLevel: 5 }, // 1 + 5*11 = 56
    mag: { base: 0, perLevel: 4 }, // 0 + 4*11 = 44 -- crosses 0, flips the magic-power gate
    mdef: { base: 2, perLevel: 3 }, // 2 + 3*11 = 35 -- flips the magic-defence gate
    xp: { base: 100, perLevel: 300 } // 100 + 300*11 = 3400 -- well past a byte, never capped
  };
  const expectedValues = { atk: 32, def: 16, mp: 53, gold: 56, mag: 44, mdef: 35, xp: 3400 };

  applied.sprites.actors[snakeId].battle.level = level;
  expected.sprites.actors[snakeId].battle.level = level;
  expected.sprites.actors[snakeId].battle = { ...expected.sprites.actors[snakeId].battle, ...expectedValues };

  const plan = planMonsterGrowth(applied, snakeId, growth);
  assert.notEqual(plan, null);
  assert.equal(Object.keys(plan.writes).length, MONSTER_GROWTH_FIELDS.length);
  applyMonsterGrowth(applied, plan);

  // Full project deepEqual -- not just the seven fields -- rejects any
  // stray write to hp, level, another actor, or a persisted growth input.
  assert.deepEqual(applied, expected);

  const appliedTables = battleTables(applied);
  const expectedTables = battleTables(expected);
  assert.equal(appliedTables, expectedTables, 'battleTables() emission must agree for two projects with identical data');
  assert.equal(battleTableBytes(applied), battleTableBytes(expected));

  // Without re-applying: changing battle.level afterward must not move the
  // compiled output at all -- proving a one-time collapse, not a live link,
  // and specifically rejecting a wrong implementation that reads
  // battle.level conditionally inside the existing mon_atk emission
  // (finding 2's own named counterexample).
  const tablesBeforeLevelChange = battleTables(applied);
  applied.sprites.actors[snakeId].battle.level = 1;
  assert.equal(battleTables(applied), tablesBeforeLevelChange);
});

test('deriving a positive Magic value for the first time flips the capacity gate identically whether derived or hand-typed', async (t) => {
  const before = await freshProjectOnDisk(t);
  const derived = await freshProjectOnDisk(t);
  const handSet = await freshProjectOnDisk(t);
  const snakeId = findSnake(before);

  // Gate off on a pristine sample-rpg: no actor or party member has a
  // positive mag anywhere (checked, not assumed).
  assert.ok(before.sprites.actors.every((a) => (a.battle?.mag ?? 0) === 0));
  assert.ok(before.party.every((m) => m.baseMag === 0 && m.magPerLevel === 0));
  const bytesBeforeGate = battleTableBytes(before);

  derived.sprites.actors[snakeId].battle.level = 6;
  handSet.sprites.actors[snakeId].battle.level = 6;
  const plan = planMonsterGrowth(derived, snakeId, { mag: { base: 4, perLevel: 6 } }); // 4+6*5=34
  assert.notEqual(plan, null);
  applyMonsterGrowth(derived, plan);
  handSet.sprites.actors[snakeId].battle.mag = 34;

  assert.equal(derived.sprites.actors[snakeId].battle.mag, 34);
  assert.deepEqual(derived, handSet);

  const bytesAfterGate = battleTableBytes(derived);
  assert.notEqual(bytesAfterGate, bytesBeforeGate, 'flipping the magic-power gate must actually change the compiled byte count');
  assert.equal(bytesAfterGate, battleTableBytes(handSet), 'the derived path and the hand-typed path must cost identically');
});
