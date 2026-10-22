// GROWTH_LIMITS (shared/project.js): the one table of party growth ranges, read by normalizePartyMember and by the Character Forge's inputs
// (ROADMAP item 5, growth profiles, commit D1; handoff-next/classes/design.md sec 1.2). Before D1 the Forge offered mp 0-255 and mp / atk /
// def per level 0-32 while the normalizer clamped them to 0-99 and 0-16, so a value the editor accepted was silently changed on load.
//
// (a) pins the table to a LITERAL copy of the pre-D1 normalizer ranges and clamps through the real normalizer, so neither the table nor the
// normalizer can drift alone; (b) is an acorn AST guard over the Character Forge source, one check per growth input, so a numeric literal
// restored in a `number(...)` call fails here before the smoke run reads the real DOM (main/smoke.js, step "growth input ranges").
// acorn is a TEST-ONLY devDependency: nothing under main/, renderer/, shared/ or tools/ imports it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { GROWTH_LIMITS, normalizeProject } from '../../shared/project.js';
import { declaredLocalNames, namedImportSource } from '../lib/sourcescan.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHARACTER_FORGE = path.join(ROOT, 'renderer/forges/character/character.js');

// The ranges normalizePartyMember clamped to before D1 (HEAD 621b0ab, shared/project.js): written out here, never read from the tree.
const PRE_D1 = {
  hp: { baseMin: 1, baseMax: 255, perLevelMin: 0, perLevelMax: 32 },
  mp: { baseMin: 0, baseMax: 99, perLevelMin: 0, perLevelMax: 16 },
  atk: { baseMin: 0, baseMax: 255, perLevelMin: 0, perLevelMax: 16 },
  def: { baseMin: 0, baseMax: 255, perLevelMin: 0, perLevelMax: 16 },
  mag: { baseMin: 0, baseMax: 255, perLevelMin: 0, perLevelMax: 16 },
  mdef: { baseMin: 0, baseMax: 255, perLevelMin: 0, perLevelMax: 16 }
};

// stat -> [base field, per-level field] on a party member.
const FIELDS = {
  hp: ['baseHp', 'hpPerLevel'],
  mp: ['baseMp', 'mpPerLevel'],
  atk: ['baseAtk', 'atkPerLevel'],
  def: ['baseDef', 'defPerLevel'],
  mag: ['baseMag', 'magPerLevel'],
  mdef: ['baseMdef', 'mdefPerLevel']
};

const normalizedMember = (raw) => normalizeProject({ project: { gameType: 'rpg' }, cartridge: { mapper: 1 }, party: [raw] }).party[0];

test('(a) GROWTH_LIMITS equals the literal pre-D1 normalizer ranges', () => {
  // Catches a table edit that changes what a member may hold (and so a ROM), and a stat added or dropped from the table.
  assert.deepEqual(GROWTH_LIMITS, PRE_D1);
});

test('(a) normalizePartyMember clamps min-1 up to min and max+1 down to max for all twelve growth fields', () => {
  // Catches the normalizer reading anything but the table's bounds, in either direction, on any single field.
  for (const [stat, [base, perLevel]] of Object.entries(FIELDS)) {
    const range = PRE_D1[stat];
    const below = normalizedMember({ [base]: range.baseMin - 1, [perLevel]: range.perLevelMin - 1 });
    assert.equal(below[base], range.baseMin, `${base} at min - 1`);
    assert.equal(below[perLevel], range.perLevelMin, `${perLevel} at min - 1`);
    const above = normalizedMember({ [base]: range.baseMax + 1, [perLevel]: range.perLevelMax + 1 });
    assert.equal(above[base], range.baseMax, `${base} at max + 1`);
    assert.equal(above[perLevel], range.perLevelMax, `${perLevel} at max + 1`);
    const inside = normalizedMember({ [base]: range.baseMax, [perLevel]: range.perLevelMax });
    assert.equal(inside[base], range.baseMax, `${base} at max is kept`);
    assert.equal(inside[perLevel], range.perLevelMax, `${perLevel} at max is kept`);
  }
});

test('(a) the four ranges the Forge once offered but the normalizer clamped are the normalizer\'s', () => {
  // The original defect, by value: mp base 200 -> 99, and mp / atk / def per level 30 -> 16 (hp per level 30 stays).
  const member = normalizedMember({ baseMp: 200, mpPerLevel: 30, atkPerLevel: 30, defPerLevel: 30, hpPerLevel: 30 });
  assert.deepEqual(
    [member.baseMp, member.mpPerLevel, member.atkPerLevel, member.defPerLevel, member.hpPerLevel],
    [99, 16, 16, 16, 30]
  );
});

// ---- (b) AST guard over the Character Forge source --------------------------------------------------------------------------------

/** Every node under `node`, depth first. */
function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child, visit);
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

/** `object.property` with both names plain identifiers (non-computed), else null. */
function dotted(node) {
  if (node?.type !== 'MemberExpression' || node.computed || node.property.type !== 'Identifier') return null;
  return { object: node.object, property: node.property.name };
}

/** Is `node` exactly `GROWTH_LIMITS.<stat>.<bound>`? */
function isGrowthBound(node, stat, bound) {
  const outer = dotted(node);
  if (!outer || outer.property !== bound) return false;
  const inner = dotted(outer.object);
  return Boolean(inner) && inner.property === stat && inner.object.type === 'Identifier' && inner.object.name === 'GROWTH_LIMITS';
}

/**
 * The twelve growth inputs of `text` (a Character Forge module): for each member field named in FIELDS, the `number(member.<field>, min, max, ...)`
 * calls found, as { field, min, max } nodes. Returns { calls, problems } where problems lists every violation, so a failure names the control.
 */
function growthInputProblems(text) {
  const ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
  const expected = new Map(); // field -> { stat, bound: 'base' | 'perLevel' }
  for (const [stat, [base, perLevel]] of Object.entries(FIELDS)) {
    expected.set(base, { stat, kind: 'base' });
    expected.set(perLevel, { stat, kind: 'perLevel' });
  }
  const found = new Map(); // field -> number of number(member.<field>, ...) calls
  const problems = [];
  walk(ast, (node) => {
    if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier' || node.callee.name !== 'number') return;
    const first = dotted(node.arguments[0]);
    if (!first || first.object.type !== 'Identifier' || first.object.name !== 'member' || !expected.has(first.property)) return;
    const field = first.property;
    found.set(field, (found.get(field) ?? 0) + 1);
    const { stat, kind } = expected.get(field);
    const [, min, max] = node.arguments;
    if (!isGrowthBound(min, stat, `${kind}Min`)) problems.push(`${field}: min is not GROWTH_LIMITS.${stat}.${kind}Min`);
    if (!isGrowthBound(max, stat, `${kind}Max`)) problems.push(`${field}: max is not GROWTH_LIMITS.${stat}.${kind}Max`);
    for (const bound of [min, max]) {
      walk(bound, (inner) => {
        if (inner.type === 'Literal' && typeof inner.value === 'number') problems.push(`${field}: numeric literal ${inner.value} in a range`);
      });
    }
  });
  for (const field of expected.keys()) {
    if (found.get(field) !== 1) problems.push(`${field}: expected exactly one number(member.${field}, ...) control, found ${found.get(field) ?? 0}`);
  }
  return problems;
}

test('(b) every one of the twelve Character Forge growth inputs takes its range from GROWTH_LIMITS, with no numeric literal', () => {
  // Catches a restored UI literal (e.g. number(member.baseMp, 0, 255, ...)), a wrong stat / bound expression, and a refactor that hides a control.
  const text = fs.readFileSync(CHARACTER_FORGE, 'utf8');
  assert.deepEqual(growthInputProblems(text), []);
});

test('(b) GROWTH_LIMITS in the Character Forge is the shared export, not a local binding', () => {
  // Catches a module-local GROWTH_LIMITS (or an aliased import) that would satisfy the shape check above while diverging from the table.
  const text = fs.readFileSync(CHARACTER_FORGE, 'utf8');
  assert.equal(declaredLocalNames(text).has('GROWTH_LIMITS'), false);
  assert.equal(namedImportSource(text, 'GROWTH_LIMITS'), '../../../shared/project.js');
});

test('(b) negative controls: each kind of restored literal or lost control is reported', () => {
  const real = fs.readFileSync(CHARACTER_FORGE, 'utf8');
  const control = (from, to) => {
    assert.equal(real.split(from).length, 2, `control anchor occurs once: ${from}`);
    return growthInputProblems(real.replace(from, to));
  };
  // The reviewer's S10 construction: a literal range on the MP base input.
  const mp = control('number(member.baseMp, GROWTH_LIMITS.mp.baseMin, GROWTH_LIMITS.mp.baseMax,', 'number(member.baseMp, 0, 255,');
  assert.ok(mp.some((p) => p.startsWith('baseMp: min')) && mp.some((p) => p.startsWith('baseMp: max')), mp.join('; '));
  // A literal 0 in a minimum position (the case an "exempt 0" rule would have let through).
  assert.ok(control('number(member.baseAtk, GROWTH_LIMITS.atk.baseMin,', 'number(member.baseAtk, 0,').some((p) => p.startsWith('baseAtk: min')));
  // A per-level input bounded by the wrong stat, and one bounded by the base bound.
  assert.ok(control('number(member.defPerLevel, GROWTH_LIMITS.def.perLevelMin, GROWTH_LIMITS.def.perLevelMax,', 'number(member.defPerLevel, GROWTH_LIMITS.atk.perLevelMin, GROWTH_LIMITS.atk.perLevelMax,').length > 0);
  assert.ok(control('number(member.mdefPerLevel, GROWTH_LIMITS.mdef.perLevelMin, GROWTH_LIMITS.mdef.perLevelMax,', 'number(member.mdefPerLevel, GROWTH_LIMITS.mdef.baseMin, GROWTH_LIMITS.mdef.baseMax,').length > 0);
  // A control hidden from the guard (renamed callee) and a duplicated one are both reported, not silently accepted.
  assert.ok(control('number(member.hpPerLevel,', 'num(member.hpPerLevel,').some((p) => p.startsWith('hpPerLevel: expected exactly one')));
  const duplicated = growthInputProblems(`${real}\nnumber(member.magPerLevel, GROWTH_LIMITS.mag.perLevelMin, GROWTH_LIMITS.mag.perLevelMax, () => {});`);
  assert.ok(duplicated.some((p) => p.startsWith('magPerLevel: expected exactly one')));
});
