// Stable diagnostic ids (docs/design-equipment.md section 9a, ROADMAP item 5 commit C1).
//
// Every problem a producer raises is `{ severity, where, message, rule, subject, counts }`: `rule` a semantic variant id,
// `subject` the structured indices of what it is about, `counts` the project-dependent numbers the message states, listed by
// the producer and never parsed from the wording. Three callers decide "same problem" from that identity, each keeping its OWN
// count policy:
//   - `newErrors` (Map Forge)             where | rule | subject; counts ignored; a multiset
//   - `attributedErrors` (library import) severity+where bucket, rule + subject, counts positionally non-increasing
//   - `introducesErrors` (switchableMappers' tally) where | rule | subject | counts; equal values required, multiplicity kept
//
// Every test names the wrong implementation it would catch. Sabotage runs for this file are recorded in
// handoff-next/equip/c1/sabotage.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  attributeProblems,
  attributedErrors,
  createMap,
  createProject,
  createScreen,
  createSpell,
  normalizeProject,
  streamedBoardProblems,
  validateProject
} from '../../shared/project.js';
import { MAPPERS, SUPPORTED_MAPPERS } from '../../shared/cartridge.js';
import { errorProblems, newErrors, ruleKey } from '../../renderer/forges/map/streamedui.js';
import { checkCapacity, diagnosticTallyKey, errorTally, introducesErrors } from '../../main/build/generate.js';
import { compileText } from '../../main/build/textcompile.js';
import { diagnosticProducers } from '../lib/sourcescan.js';
import { createStreamedProject } from '../lib/streamedproject.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const errors = (project) => validateProject(project).filter((p) => p.severity === 'error');
const only = (list, rule) => list.filter((p) => p.rule === rule);

// ----------------------------------------------------------------------------------------------- fixtures

// shared/project.js LIMITS.entitiesPerScreen is 8: a ninth entity is the "screen-entities-over" error, counts [n].
const ENTITY_LIMIT = 8;
const entity = () => ({ actorId: 0, x: 0, y: 0, props: {} });

/** An action project whose one map "World" holds `screens` screens; `crowded` maps a screen index to its entity count. */
function crowded(screens, crowd) {
  const project = createProject('Diag', 'action');
  const map = project.maps[0];
  map.screens = Array.from({ length: screens }, () => createScreen());
  map.gridW = screens;
  map.gridH = 1;
  for (const [index, count] of Object.entries(crowd)) {
    map.screens[Number(index)].entities = Array.from({ length: count }, entity);
  }
  return project;
}

/** A hand-built, fully identified problem (what a producer returns). */
const problem = (rule, subject, counts, extra = {}) => ({
  severity: 'error',
  where: 'Map Forge',
  message: `${rule} ${JSON.stringify(subject)} ${counts.join(' ')}`,
  rule,
  subject,
  counts,
  ...extra
});

// ----------------------------------------------------------------------------------------------- (1) migration between screens

test('(1) an error that moves between two different unquoted named screens is a NEW error to all three callers', () => {
  // Catches an identity built from rule + counts alone: "World · screen 3 has 9 entities" and "World · screen 5 has 9 entities" are the same
  // words and the same numbers, so only `subject` can tell the author the problem moved rather than stayed. The screen name is in no quote,
  // so the old wording-derived keys could not see the difference either (the digit comparison skeletonised 3 and 5 alike).
  for (const names of [false, true]) {
    const before = crowded(6, { 3: ENTITY_LIMIT + 1 });
    const after = crowded(6, { 5: ENTITY_LIMIT + 1 });
    if (names) {
      for (const project of [before, after]) {
        project.maps[0].screens[3].name = 'Cave';
        project.maps[0].screens[5].name = 'Hall';
      }
    }
    const was = errors(before);
    const now = errors(after);
    assert.equal(was.length, 1);
    assert.equal(now.length, 1);
    assert.equal(was[0].rule, now[0].rule, 'the same rule');
    assert.deepEqual(was[0].counts, now[0].counts, 'the same numbers');
    assert.match(was[0].message, names ? /World · Cave has 9 entities/ : /World · screen 3 has 9 entities/);
    assert.match(now[0].message, names ? /World · Hall has 9 entities/ : /World · screen 5 has 9 entities/);
    assert.deepEqual(was[0].subject, { map: 0, screen: 3 });
    assert.deepEqual(now[0].subject, { map: 0, screen: 5 });
    assert.equal(newErrors(was, now).length, 1, 'Map Forge multiset: one new error');
    assert.equal(attributedErrors(before, after).length, 1, 'library import: refused');
    assert.equal(introducesErrors(validateProject(before), validateProject(after)), true, 'mapper-switch tally: refused');
  }
});

test('(1b) the same error left on the same screen is not new to any caller, however many screens surround it', () => {
  // Catches an identity that includes anything outside the problem (the screen COUNT of the map, the project name).
  const before = crowded(4, { 3: ENTITY_LIMIT + 1 });
  const after = crowded(9, { 3: ENTITY_LIMIT + 1 });
  assert.equal(newErrors(errors(before), errors(after)).length, 0);
  assert.equal(attributedErrors(before, after).length, 0);
  assert.equal(introducesErrors(validateProject(before), validateProject(after)), false);
});

// ----------------------------------------------------------------------------------------------- (2) forwarded rule change

test('(2) a board problem forwarded through validateStreamedMaps keeps its rule, subject and counts; a variant change on one map follows', () => {
  // Catches the old forwarding `add('error', problem.where, problem.message)`, which dropped `kind` and `mapIndex` (and so every id):
  // validateProject's problem must be the board problem, not a re-stringified copy of it.
  const overfull = createStreamedProject({ mapper: 4, mirroring: 'vertical', gridW: 1, gridH: 1 });
  overfull.maps[0].screens.push(createScreen()); // 2 screens in a 1 x 1 grid: a `grid` problem
  const tall = createStreamedProject({ mapper: 4, mirroring: 'vertical', gridW: 1, gridH: 5 }); // the dead axis: a `deadAxis` problem
  const board = (project) => streamedBoardProblems(project);
  const forwarded = (project, rule) => only(errors(project), rule);

  assert.deepEqual(board(overfull).map((p) => [p.kind, p.rule]), [['grid', 'streamed-grid-overfull']]);
  assert.deepEqual(board(tall).map((p) => [p.kind, p.rule]), [['deadAxis', 'streamed-dead-axis-tall']]);
  for (const [project, rule] of [[overfull, 'streamed-grid-overfull'], [tall, 'streamed-dead-axis-tall']]) {
    const [original] = board(project);
    const [seen] = forwarded(project, rule);
    assert.ok(seen, `${rule} reaches validateProject`);
    assert.deepEqual([seen.rule, seen.subject, seen.counts, seen.where, seen.message], [original.rule, original.subject, original.counts, original.where, original.message]);
  }
  assert.deepEqual(forwarded(overfull, 'streamed-grid-overfull')[0].counts, [2, 1, 1], 'screens authored, then the grid axes');
  assert.deepEqual(forwarded(tall, 'streamed-dead-axis-tall')[0].counts, [5]);

  // One map, the variant changes from grid to deadAxis: A -> B is a new error for every caller (a different rule on the same subject).
  const moved = structuredClone(overfull);
  moved.maps[0].gridH = 5; // 2 screens now fit, but the vertical-mirroring board cannot stream upward
  assert.equal(only(errors(moved), 'streamed-grid-overfull').length, 0);
  assert.equal(only(errors(moved), 'streamed-dead-axis-tall').length, 1);
  assert.equal(newErrors(errors(overfull), errors(moved)).length, 1);
  assert.equal(attributedErrors(overfull, moved).length, 1);
  assert.equal(introducesErrors(validateProject(overfull), validateProject(moved)), true);
});

// ----------------------------------------------------------------------------------------------- (3) duplicate instances

test('(3) two identical problems on one subject count as two in the multiset, in the tally and in attributedErrors', () => {
  // Catches a Set-based key (two instances collapse to one), a tally that stops at "key already seen", and an attribution that lets one
  // before-instance cover both after-instances.
  const P = problem('r', { map: 0 }, [1]);
  assert.equal(newErrors([P], [P, P]).length, 1);
  assert.equal(newErrors([P, P], [P]).length, 0);
  assert.equal(introducesErrors([P], [P, P]), true);
  assert.equal(introducesErrors([P, P], [P]), false, 'a fall in multiplicity is accepted');
  assert.equal(errorTally([P, P]).get(diagnosticTallyKey(P)), 2);
  assert.equal(attributeProblems([P], [P, P]).length, 1, 'the second after-instance has no unclaimed before-instance');
  assert.equal(attributeProblems([P, P], [P, P]).length, 0);
  assert.equal(attributeProblems([P, P], [P]).length, 0);
});

test('(3b) the same through the real validator: three bound tiles on one cell are two errors on one subject', () => {
  // The real producer of two identical instances: `bound-tile-duplicate` fires once per extra entry on a cell.
  const cell = { switchId: 0, row: 1, col: 1, metatileId: 0 };
  const withTiles = (n) => {
    const project = crowded(1, {});
    project.maps[0].screens[0].boundTiles = Array.from({ length: n }, () => ({ ...cell }));
    return project;
  };
  const once = withTiles(2);
  const twice = withTiles(3);
  assert.equal(only(errors(once), 'bound-tile-duplicate').length, 1);
  assert.equal(only(errors(twice), 'bound-tile-duplicate').length, 2);
  const [a, b] = only(errors(twice), 'bound-tile-duplicate');
  assert.deepEqual([a.subject, a.counts], [b.subject, b.counts], 'identical in every identifying field');
  assert.deepEqual(a.subject, { map: 0, screen: 0, row: 1, col: 1 });
  assert.equal(newErrors(errors(once), errors(twice)).length, 1);
  assert.equal(attributedErrors(once, twice).length, 1);
  assert.equal(introducesErrors(validateProject(once), validateProject(twice)), true);
  // and one of the two instances removed is accepted by all three
  assert.equal(newErrors(errors(twice), errors(once)).length, 0);
  assert.equal(attributedErrors(twice, once).length, 0);
  assert.equal(introducesErrors(validateProject(twice), validateProject(once)), false);
});

// ----------------------------------------------------------------------------------------------- (4) the value matrix

test('(4) the value matrix, hand-built, at all three consumers: one problem on one subject, before -> after', () => {
  // Catches, one per row: a ruleKey that reads counts (increase/decrease read as new); an attributedErrors that ignores counts (increase
  // accepted) or compares with `===` (decrease refused); a tally key without counts (increase AND decrease pass: the second review's hole);
  // a tally that treats a lower count as a new key's absence (decrease accepted).
  const at = (n) => problem('screens-over', { map: 0 }, [n]);
  const table = [
    // [label, before, after, newErrors adds, attributedErrors refuses, tally refuses]
    ['equal', [at(271)], [at(271)], 0, 0, false],
    ['increase 271 -> 272', [at(271)], [at(272)], 0, 1, true],
    ['decrease 272 -> 271', [at(272)], [at(271)], 0, 0, true],
    ['duplicate instance added', [at(271)], [at(271), at(271)], 1, 1, true],
    ['one of two instances removed', [at(271), at(271)], [at(271)], 0, 0, false],
    ['a rule that was not failing', [], [at(271)], 1, 1, true],
    ['cleared', [at(271)], [], 0, 0, false]
  ];
  for (const [label, before, after, fresh, refused, tallied] of table) {
    assert.equal(newErrors(before, after).length, fresh, `${label}: newErrors`);
    assert.equal(attributeProblems(before, after).length, refused, `${label}: attributedErrors`);
    assert.equal(introducesErrors(before, after), tallied, `${label}: tally`);
  }
  // counts are POSITIONAL and of equal length for attributedErrors: a vector that grows in length is not "no greater".
  const two = (a, b) => problem('grid', { map: 0 }, [a, b]);
  assert.equal(attributeProblems([two(5, 5)], [two(5, 4)]).length, 0);
  assert.equal(attributeProblems([two(5, 5)], [two(4, 6)]).length, 1, 'one value rising refuses even when the other falls');
  assert.equal(attributeProblems([two(5, 5)], [problem('grid', { map: 0 }, [5, 5, 1])]).length, 1, 'unequal length: the vector grew');
  // The vector SHRINKING is as unequal as it growing: every remaining position is no greater, so only the explicit length guard refuses it.
  // Catches `countsNotWorse` without `before.length === after.length` (an `every` over the shorter after-vector passes both).
  assert.equal(attributeProblems([two(5, 5)], [problem('grid', { map: 0 }, [5])]).length, 1, 'unequal length: [5, 5] -> [5]');
  assert.equal(attributeProblems([problem('grid', { map: 0 }, [5])], [problem('grid', { map: 0 }, [])]).length, 1, 'unequal length: [5] -> []');
});

test('(4b) the value matrix through the real validator (screen-entities-over, counts [n])', () => {
  // The same table on real projects, so a producer that listed its counts in a different shape than its rule needs is caught too.
  const over = (n) => crowded(2, { 1: n });
  const rows = [
    ['equal', 9, 9, 0, 0, false],
    ['increase', 9, 10, 0, 1, true],
    ['decrease', 10, 9, 0, 0, true]
  ];
  for (const [label, was, now, fresh, refused, tallied] of rows) {
    const before = over(was);
    const after = over(now);
    assert.deepEqual(only(errors(before), 'screen-entities-over')[0].counts, [was], `${label}: the producer lists the entity count`);
    assert.equal(newErrors(errors(before), errors(after)).length, fresh, `${label}: newErrors`);
    assert.equal(attributedErrors(before, after).length, refused, `${label}: attributedErrors`);
    assert.equal(introducesErrors(validateProject(before), validateProject(after)), tallied, `${label}: tally`);
  }
});

// ----------------------------------------------------------------------------------------------- (5) wording-only changes

test('(5) rewording every message changes none of the three results and none of the producers\' counts', () => {
  // Catches any caller that still reads the words (a plural, a word order, an extra clause moves its answer) and any `counts` parsed from the
  // message: the reworded copy below keeps rule, subject and counts byte-identical but scrambles the words, so a parsed number would move.
  const reword = (p) => ({
    ...p,
    message: `Rewritten for the test: ${p.message.split(' ').reverse().join(' ').replace(/s\b/g, '')} (and one clause more, 7 8 9).`
  });
  const scenarios = [
    [crowded(6, { 3: 9 }), crowded(6, { 3: 10 })],
    [crowded(6, { 3: 10 }), crowded(6, { 3: 9 })],
    [crowded(6, { 3: 9 }), crowded(6, { 5: 9 })],
    [crowded(6, { 3: 9 }), crowded(6, { 3: 9, 5: 9 })],
    [crowded(6, { 3: 9, 5: 9 }), crowded(6, { 3: 9 })],
    [crowded(6, {}), crowded(6, { 0: 12 })]
  ];
  for (const [index, [before, after]] of scenarios.entries()) {
    const was = validateProject(before);
    const now = validateProject(after);
    const wasWords = was.map(reword);
    const nowWords = now.map(reword);
    const errorsOf = (list) => list.filter((p) => p.severity === 'error');
    const summary = (list) => list.map((p) => `${p.rule} ${JSON.stringify(p.subject)} ${JSON.stringify(p.counts)}`);
    assert.deepEqual(summary(newErrors(errorsOf(wasWords), errorsOf(nowWords))), summary(newErrors(errorsOf(was), errorsOf(now))), `scenario ${index}: newErrors`);
    assert.deepEqual(summary(attributeProblems(wasWords, nowWords)), summary(attributeProblems(was, now)), `scenario ${index}: attributedErrors`);
    assert.equal(introducesErrors(wasWords, nowWords), introducesErrors(was, now), `scenario ${index}: tally`);
    assert.deepEqual([...errorTally(wasWords)], [...errorTally(was)], `scenario ${index}: tally keys`);
    assert.deepEqual(wasWords.map((p) => p.counts), was.map((p) => p.counts), `scenario ${index}: counts`);
  }
});

test('(5b) counts are the producer\'s own numbers, not the digits of its message', () => {
  // Catches a `counts` filled by parsing the message: each project below states digits that are NOT quantities (a screen's position, a
  // build constant, a plural count word) and the counts must hold only the project-dependent quantities, in print order.
  const message = (project, rule) => only(validateProject(project), rule)[0];
  const entities = message(crowded(6, { 3: 9 }), 'screen-entities-over');
  assert.match(entities.message, /screen 3 has 9 entities; the engine allows 8/);
  assert.deepEqual(entities.counts, [9], 'not [3, 9, 8]: the screen index is the subject and 8 is a build constant');

  const give = (n) => {
    const project = crowded(1, {});
    project.maps[0].screens[0].entities = [
      { actorId: 0, x: 0, y: 0, props: { trigger: 'touch', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: Array.from({ length: n }, () => ({ op: 'give', item: 99 })) }] } } }
    ];
    return message(project, 'give-take-missing-item');
  };
  assert.deepEqual(give(1).counts, [1]);
  assert.deepEqual(give(2).counts, [2]);
  assert.notEqual(give(1).message.replace(/\d+/, ''), give(2).message.replace(/\d+/, ''), 'the grammar differs between 1 and 2 (command/commands)');

  const bound = createStreamedProject({ mapper: 4, mirroring: 'vertical', gridW: 1, gridH: 5 });
  assert.deepEqual(message(bound, 'streamed-dead-axis-tall').counts, [5]);
});

test('(5c) the legacy fallbacks are per caller and still say what they used to', () => {
  // A hand-built problem with no rule is read the way each caller always read it (the three derivations differ on purpose).
  const bare = (message, where = 'Map Forge') => ({ severity: 'error', where, message });
  assert.equal(ruleKey(bare('2 Sound sting commands do not name a real song.')), ruleKey(bare('1 Sound sting command do not name a real song.')), 'ruleKey: folded words');
  assert.equal(attributeProblems([bare('Map has 3 things')], [bare('Map has 4 things')]).length, 1, 'attributedErrors: digits may not grow');
  assert.equal(attributeProblems([bare('Map has 3 things')], [bare('Map has 2 things')]).length, 0);
  assert.equal(introducesErrors([bare('holds 271')], [bare('holds 272')]), true, 'tally: where: message');
  assert.equal(introducesErrors([bare('holds 271')], [bare('holds 270')]), true);
  assert.equal(introducesErrors([bare('holds 271')], [bare('holds 271')]), false);
  // and a fully identified problem is NOT read through the words
  const a = problem('r', { map: 0 }, [1], { message: 'completely different words' });
  const b = problem('r', { map: 0 }, [1], { message: 'nothing alike at all' });
  assert.equal(ruleKey(a), ruleKey(b));
});

// ----------------------------------------------------------------------------------------------- a rename is not a new problem

test('a subject holds indices, never names: renaming the map or the screen changes no identity', () => {
  // Catches a subject built from a name (`{ map: map.name }`): a rename would look like a brand new problem to all three callers.
  const before = crowded(6, { 3: 9 });
  const after = structuredClone(before);
  after.maps[0].name = 'Renamed world';
  after.maps[0].screens[3].name = 'Renamed screen';
  assert.notEqual(errors(before)[0].message, errors(after)[0].message, 'the words changed');
  assert.deepEqual(errors(before)[0].subject, errors(after)[0].subject);
  assert.equal(newErrors(errors(before), errors(after)).length, 0);
  assert.equal(attributedErrors(before, after).length, 0);
  assert.equal(introducesErrors(validateProject(before), validateProject(after)), false);
});

test('a rule never embeds a count: raising or lowering a number leaves the rule id alone', () => {
  // Catches a `rule` like `screens-over-${n}`: "holds 272" would read as a different rule from "holds 271" at newErrors.
  const rules = new Set();
  for (const n of [9, 10, 40]) rules.add(only(errors(crowded(2, { 1: n })), 'screen-entities-over')[0]?.rule);
  assert.deepEqual([...rules], ['screen-entities-over']);
  for (const p of errors(crowded(6, { 3: 9 }))) assert.match(p.rule, /^[a-z]+(-[a-z]+)*$/);
});

// ----------------------------------------------------------------------------------------------- (7) the source scan

const PRODUCER_FILES = {
  'shared/project.js': { add: 59, addFrom: 7, push: 4, return: 7 },
  'main/build/generate.js': { push: 14, 'return-array': 2 },
  'main/build/battletables.js': { push: 5 },
  'main/build/textcompile.js': { push: 4 }
};

test('(7) every diagnostic producer carries rule, subject and counts, in every file that raises one', () => {
  // Catches a producer added (or left) without an id: the legacy fallbacks stay unreachable only while this holds. The expected shape of the
  // inventory is pinned too, so a scan that quietly found nothing (a renamed closure) fails here instead of passing vacuously.
  // project.js: 64 original sites = 2 streamedGridProblems + 2 closures + 6 streamedBoardProblems + 4 validateStreamedMaps + 50 validateProject (43 add + 7 addFrom),
  // plus the 7 diagnose* builders' return objects and addFrom's own `add` forward. Equipment C2 (docs/design-equipment.md section 6) added 5 validateProject
  // `add` sites: equip-ignored-action-game, equip-piece-has-effect, start-equip-not-a-piece, start-equip-wrong-slot, start-equip-not-allowed (54 -> 59). generate.js 14 pushed (checkCode 4 + checkCapacity 10) + 2 returned in arrays by streamedCapacityProblems (fix round 1, F3), battletables.js 5,
  // and textcompile.js's 4, which the D2 inventory missed (compileText feeds checkCapacity).
  for (const [file, expected] of Object.entries(PRODUCER_FILES)) {
    const sites = diagnosticProducers(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    const kinds = {};
    for (const site of sites) kinds[site.kind] = (kinds[site.kind] ?? 0) + 1;
    assert.deepEqual(kinds, expected, `${file}: the inventory of producer sites`);
    for (const site of sites) {
      assert.deepEqual([site.missing, site.bad], [[], []], `${file}:${site.line} (${site.kind} in ${site.fn}) lacks an id or has a malformed one`);
    }
  }
});

/** The files (path -> source) that raise a diagnostic the pinned inventory does not list. */
function uncoveredProducerFiles(files) {
  return Object.entries(files)
    .filter(([rel, source]) => !(rel in PRODUCER_FILES) && diagnosticProducers(source).length > 0)
    .map(([rel]) => rel);
}

test('(7b) no other file under shared/ or main/ raises a diagnostic the scan does not cover', () => {
  // Catches a fifth producer file (the way textcompile.js was missed by the first inventory).
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(full);
      return entry.name.endsWith('.js') ? [full] : [];
    });
  const files = {};
  for (const file of [...walk(path.join(ROOT, 'shared')), ...walk(path.join(ROOT, 'main'))]) {
    files[path.relative(ROOT, file)] = fs.readFileSync(file, 'utf8');
  }
  assert.ok(Object.keys(files).length > 20, 'the walk found the tree');
  assert.deepEqual(uncoveredProducerFiles(files), []);
});

test('(7c) the scan itself: each way to build an unidentified diagnostic is reported (negative controls)', () => {
  // Catches a scanner that passes anything: every snippet below is a distinct defect and must be flagged for exactly that reason.
  const scan = (body) => diagnosticProducers(`function f(add, addFrom, problems) {\n${body}\n}\nfunction diagnoseX() {\n  return { message: 'm' };\n}`);
  const flagged = (body) => scan(body).filter((s) => s.fn !== 'diagnoseX' && (s.missing.length || s.bad.length));
  assert.equal(flagged(`add('error', 'Map Forge', 'm');`).length, 1, 'add( without rule, subject, counts');
  assert.deepEqual(flagged(`add('error', 'Map Forge', 'm', 'r', {});`)[0].missing, ['counts']);
  assert.equal(flagged(`add('error', 'Map Forge', 'm', 'r', {}, []);`).length, 0, 'a complete add( is clean');
  assert.match(flagged(`add('error', 'Map Forge', 'm', 'screens-over-272', {}, []);`)[0].bad.join(), /kebab-case id with no digits/);
  assert.match(flagged('add(\'error\', \'Map Forge\', \'m\', `screens-over-${n}`, {}, []);')[0].bad.join(), /template literal/);
  assert.match(flagged(`add('error', 'Map Forge', 'm', 'r', { map: map.name }, []);`)[0].bad.join(), /reads \.name/);
  assert.match(flagged('add(\'error\', \'Map Forge\', \'m\', \'r\', { map: `${a}` }, []);')[0].bad.join(), /template literal/);
  assert.match(flagged(`add('error', 'Map Forge', 'm', 'r', 'map 3', []);`)[0].bad.join(), /not a structured object/);
  assert.match(flagged(`add('error', 'Map Forge', 'm', 'r', {}, ['3']);`)[0].bad.join(), /counts holds a string/);
  assert.equal(flagged(`problems.push({ severity: 'error', where: 'W', message: 'm' });`)[0].missing.length, 3, 'a pushed object literal');
  assert.deepEqual(flagged(`problems.push({ severity: 'error', where: 'W', message: 'm', rule: 'r', subject: {} });`)[0].missing, ['counts']);
  assert.equal(flagged(`addFrom('error', 'W');`)[0].missing.length, 3, 'addFrom( without its diagnostic');
  assert.equal(flagged(`addFrom('error', 'W', { message: 'm' });`).length, 1, 'a literal handed to addFrom must be complete');
  const builder = scan('').find((s) => s.fn === 'diagnoseX');
  assert.deepEqual(builder.missing, ['rule', 'subject', 'counts'], 'a diagnose* builder returning a bare message');
  assert.equal(scan(`const x = { message: 'unrelated', ok: false };`).filter((s) => s.fn !== 'diagnoseX').length, 0, 'an unrelated object with a message is not a diagnostic');
});

// ----------------------------------------------------------------------------------------------- (b) the wording fixes

const mapperNamed = (name) => MAPPERS.find((m) => m.name === name);

/** A streamed project on `mapper` whose streamed world needs `extra` more regions than the board has. */
function overStreamed(mapper, extra = 1) {
  const project = createProject('Capacity');
  project.maps = [];
  project.cartridge.mapper = mapper.id;
  project.cartridge.mirroring = mapper.supportsFourScreen ? 'fourscreen' : 'horizontal';
  const probe = createMap(0, 'Probe');
  probe.gridW = 1;
  probe.gridH = 1;
  probe.screens = [createScreen()];
  probe.streamed = true;
  project.maps.push(probe);
  const usable = checkCapacity(project).screenCount; // not used: keep the call cheap-free
  void usable;
  for (let n = 2; n < 400; n++) {
    probe.gridH = n;
    probe.screens = Array.from({ length: n }, () => createScreen());
    const refused = checkCapacity(project).problems.find((p) => p.rule === 'streamed-regions-over');
    if (refused) {
      const need = refused.counts[0];
      probe.gridH = need + extra - 1;
      probe.screens = Array.from({ length: need + extra - 1 }, () => createScreen());
      return project;
    }
  }
  throw new Error('no overflow found');
}

test('(b) "choose a board with more program space" is advice only where a larger streamable board exists', () => {
  // Catches the clause shown unconditionally (the shipped defect: it told an UNROM 512 author to choose a board that does not exist) and the
  // clause dropped everywhere. Board facts, from shared/cartridge.js: MMC1 holds 128 KB, MMC3 256 KB, UNROM 512 512 KB; all three stream.
  for (const [name, hasLarger] of [['MMC1', true], ['MMC3', true], ['UNROM 512', false]]) {
    const mapper = mapperNamed(name);
    const found = checkCapacity(overStreamed(mapper)).problems.filter((p) => p.rule === 'streamed-regions-over');
    assert.equal(found.length, 1, `${name}: the regions refusal`);
    assert.match(found[0].message, /Shrink a streamed map/);
    assert.equal(/choose a board with more program space/.test(found[0].message), hasLarger, `${name}: the board clause`);
    if (!hasLarger) assert.match(found[0].message, /remove one\.$/, `${name}: the message ends after "remove one."`);
    assert.deepEqual(found[0].counts.length, 2);
  }
});

test('(b2) the clause is derived from the registry, not from a board id', () => {
  // Catches `mapper.id !== 30` (the literal): a new, larger streamable board must make the old largest board's message grow the clause.
  const u512 = mapperNamed('UNROM 512');
  const project = overStreamed(u512);
  const before = checkCapacity(project).problems.find((p) => p.rule === 'streamed-regions-over');
  assert.doesNotMatch(before.message, /choose a board/);
  const bigger = { ...u512, id: 99, name: 'Bigger', prgUnits: u512.prgUnits * 2, streamable: true };
  SUPPORTED_MAPPERS.push(bigger);
  try {
    const during = checkCapacity(project).problems.find((p) => p.rule === 'streamed-regions-over');
    assert.match(during.message, /choose a board with more program space in the Build panel\.$/);
    // a larger board that cannot stream is no advice either
    SUPPORTED_MAPPERS[SUPPORTED_MAPPERS.length - 1] = { ...bigger, streamable: false };
    assert.doesNotMatch(checkCapacity(project).problems.find((p) => p.rule === 'streamed-regions-over').message, /choose a board/);
  } finally {
    SUPPORTED_MAPPERS.pop();
  }
  assert.doesNotMatch(checkCapacity(project).problems.find((p) => p.rule === 'streamed-regions-over').message, /choose a board/);
});

test('(b3) the ordinary-screens refusal obeys the same rule', () => {
  // Catches fixing one of the two streamedCapacityProblems messages and leaving the other advising a board that does not exist.
  for (const [name, hasLarger] of [['MMC1', true], ['UNROM 512', false]]) {
    const mapper = mapperNamed(name);
    const project = createProject('Ordinary');
    project.maps = [];
    project.cartridge.mapper = mapper.id;
    project.cartridge.mirroring = mapper.supportsFourScreen ? 'fourscreen' : 'horizontal';
    const addMap = (w, h, streamed) => {
      const map = createMap(project.maps.length, `M${project.maps.length}`);
      map.gridW = w;
      map.gridH = h;
      map.screens = Array.from({ length: w * h }, () => createScreen());
      if (streamed) map.streamed = true;
      project.maps.push(map);
    };
    for (let i = 0; i < 12; i++) addMap(4, 4, false);
    addMap(1, 1, true);
    let found = null;
    for (let rows = 1; rows < 60 && !found; rows++) {
      project.maps.at(-1).gridH = rows;
      project.maps.at(-1).screens = Array.from({ length: rows }, () => createScreen());
      found = checkCapacity(project).problems.find((p) => p.rule === 'streamed-ordinary-screens-over');
    }
    assert.ok(found, `${name}: found an ordinary-screens refusal`);
    assert.equal(/choose a board with more program space/.test(found.message), hasLarger, name);
    assert.equal(found.counts.length, 3);
  }
});

// ----------------------------------------------------------------------------------------------- fix round 1

// F1 -- a count the message does not print.
test('F1: streamed-screen-bound-tiles states no quantity, so its counts are empty and a second valid bound tile is not an attributed error', () => {
  // Catches `counts: [screen.boundTiles.length]`: the message only says the screen HAS switch-bound tiles, so adding a second otherwise-valid
  // one made [1] -> [2], and attributedErrors refused an import that changed nothing the author can read in the diagnostic.
  const withTiles = (cells) => {
    const project = createStreamedProject({ gridW: 1, gridH: 4 });
    const screen = project.maps[0].screens[0];
    screen.boundTiles = cells.map(([row, col]) => ({ switchId: 0, row, col, metatileId: screen.metatiles[row * 16 + col] }));
    return project;
  };
  const one = withTiles([[0, 0]]);
  const two = withTiles([[0, 0], [1, 0]]);
  for (const project of [one, two]) {
    const found = only(errors(project), 'streamed-screen-bound-tiles');
    assert.equal(found.length, 1);
    assert.deepEqual(found[0].counts, []);
    assert.deepEqual(found[0].subject, { map: 0, screen: 0 });
    assert.equal(only(errors(project), 'bound-tile-invalid').length + only(errors(project), 'bound-tile-duplicate').length, 0, 'the added tile is valid');
  }
  assert.deepEqual(attributedErrors(one, two).map((p) => p.rule), []);
  assert.equal(newErrors(errors(one), errors(two)).length, 0);
  assert.equal(introducesErrors(validateProject(one), validateProject(two)), false);
});

test('F1: font-glyph-missing (the warning in compileText) states no quantity either, however many glyphs are missing', () => {
  // Catches `counts: [unmapped.size]`: the message lists the characters, which are not a count.
  const glyphs = (text) => {
    const project = normalizeProject({
      project: { name: 'T', gameType: 'action' },
      commonEvents: [{ id: 0, name: 'E', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text }] }] } }]
    });
    return compileText(project).problems.filter((p) => p.rule === 'font-glyph-missing');
  };
  for (const text of ['One \u20ac here', 'One \u20ac and \u00a4 and \u2603 here']) {
    const found = glyphs(text);
    assert.equal(found.length, 1);
    assert.deepEqual([found[0].severity, found[0].subject, found[0].counts], ['warning', {}, []]);
  }
});

test('F1: kernel-lo-tables-over lists the two quantities its message prints (tables, free), not the derived deficit', () => {
  // Catches a third count (-kernelFree) that the message never states -- the shortfall advice names saved bytes, not the deficit.
  const source = fs.readFileSync(path.join(ROOT, 'main/build/generate.js'), 'utf8');
  const at = source.indexOf("rule: 'kernel-lo-tables-over'");
  assert.match(source.slice(at, at + 160), /counts: \[tableBytes, BANK_SIZE - kernelBudget - fixedBytes\]\n/);
});

// F2 -- the locations an aggregate animation error names.
const ANIMATION_RULES = [
  // [rule, the project builder for "reference i is broken", the field it reads]
  ['animation-ref-invalid', 'invalid'],
  ['animation-ref-unplayable', 'unplayable']
];

/**
 * An RPG with two actors and two spells and one animation. `broken` names the references that are wrong, in the vocabulary of the walk:
 * { actor: 0, slot: 'idle' } | { spell: 1 } | { member: 0 }. `kind` 'invalid' points them at a missing animation id; 'unplayable' at animation 0,
 * whose one frame names a metasprite that does not exist (only battle-only references -- spells and party -- are hop 2).
 */
function animationProject(kind, broken, names = {}) {
  const project = normalizeProject({
    project: { name: 'Quest', gameType: 'rpg' },
    sprites: { actors: [{ name: names.alpha ?? 'Alpha' }, { name: names.beta ?? 'Beta' }] },
    spells: [createSpell(0, names.bolt ?? 'Bolt'), createSpell(1, names.fire ?? 'Fire')]
  });
  project.sprites.metasprites = [{ id: 0, name: 'M0', tiles: [] }];
  project.sprites.animations = [{ id: 0, name: 'Bad', loop: false, frames: [{ metaspriteId: 5, duration: 8 }] }];
  const target = kind === 'invalid' ? 99 : 0;
  for (const ref of broken) {
    if (ref.actor !== undefined) project.sprites.actors[ref.actor].anims[ref.slot] = target;
    else if (ref.spell !== undefined) project.spells[ref.spell].anim = target;
    else project.party[ref.member].attackAnim = target;
  }
  if (names.member) project.party[0].name = names.member;
  return project;
}

const animationCases = {
  invalid: { first: [{ actor: 0, slot: 'idle' }], second: [{ actor: 1, slot: 'idle' }], slot: [{ actor: 0, slot: 'walkDown' }] },
  unplayable: { first: [{ spell: 0 }], second: [{ spell: 1 }], slot: [{ member: 0 }] }
};

test('F2: an animation reference error migrating to another location at an equal count is new to all three callers (both rules)', () => {
  // Catches `subject: {}` on the aggregate: "Actor 0's Idle animation" and "Actor 1's Idle animation" were one identity `{}` / [1], so a bad
  // reference that MOVED to another actor (or another slot, spell or party member) was accepted by every caller. The messages still differ,
  // which the old wording-based keys saw.
  for (const [rule, kind] of ANIMATION_RULES) {
    const { first, second, slot } = animationCases[kind];
    const before = animationProject(kind, first);
    const was = only(errors(before), rule);
    assert.equal(was.length, 1, `${rule}: one aggregate error`);
    assert.deepEqual(was[0].counts, [1]);
    assert.notDeepEqual(was[0].subject, {}, `${rule}: the subject names the broken reference`);
    for (const [label, moved] of [['another actor/spell', second], ['another slot/kind', slot]]) {
      const after = animationProject(kind, moved);
      const now = only(errors(after), rule);
      assert.equal(now.length, 1, `${rule} ${label}: still one error`);
      assert.deepEqual(now[0].counts, was[0].counts, `${rule} ${label}: at an equal count`);
      assert.notEqual(JSON.stringify(now[0].subject), JSON.stringify(was[0].subject), `${rule} ${label}: a different subject`);
      assert.equal(newErrors(errors(before), errors(after)).length, 1, `${rule} ${label}: newErrors`);
      assert.equal(attributedErrors(before, after).length, 1, `${rule} ${label}: attributedErrors`);
      assert.equal(introducesErrors(validateProject(before), validateProject(after)), true, `${rule} ${label}: tally`);
    }
    // the same location, still broken, is the same problem
    assert.equal(newErrors(errors(before), errors(animationProject(kind, first))).length, 0);
    assert.equal(attributedErrors(before, animationProject(kind, first)).length, 0);
  }
});

test('F2: renaming the actor, spell or party member that holds a broken animation reference is not new (both rules)', () => {
  // Catches a subject built from the names in the message ("Actor 0 (\"Alpha\")'s ..."): a rename would read as a new problem.
  for (const [rule, kind] of ANIMATION_RULES) {
    const { first } = animationCases[kind];
    const before = animationProject(kind, first);
    const after = animationProject(kind, first, { alpha: 'Renamed', bolt: 'Renamed', member: 'Renamed' });
    assert.notEqual(only(errors(before), rule)[0].message, only(errors(after), rule)[0].message, `${rule}: the words changed`);
    assert.deepEqual(only(errors(before), rule)[0].subject, only(errors(after), rule)[0].subject);
    assert.equal(newErrors(errors(before), errors(after)).length, 0, `${rule}: newErrors`);
    assert.equal(attributedErrors(before, after).length, 0, `${rule}: attributedErrors`);
    assert.equal(introducesErrors(validateProject(before), validateProject(after)), false, `${rule}: tally`);
  }
});

test('F2: reordering the diagnostic list, or the order the broken references were authored in, is not new (both rules)', () => {
  // Catches a subject whose order follows the list a caller happens to hold (or insertion order): the walk is by index, so the SAME set of
  // broken references always yields the same subject.
  for (const [rule, kind] of ANIMATION_RULES) {
    const { first, second } = animationCases[kind];
    const both = [...first, ...second];
    const forward = animationProject(kind, both);
    const backward = animationProject(kind, [...both].reverse());
    const a = validateProject(forward);
    assert.equal(only(a, rule).length, 1);
    assert.equal(only(a, rule)[0].counts[0], 2);
    assert.deepEqual(only(validateProject(backward), rule)[0].subject, only(a, rule)[0].subject, `${rule}: authoring order`);
    const reversed = [...a].reverse();
    assert.equal(newErrors(errors(forward), errors(backward)).length, 0);
    assert.equal(newErrors(a.filter((p) => p.severity === 'error'), reversed.filter((p) => p.severity === 'error')).length, 0, `${rule}: newErrors`);
    assert.equal(attributeProblems(a, reversed).length, 0, `${rule}: attributedErrors`);
    assert.equal(introducesErrors(a, reversed), false, `${rule}: tally`);
    assert.equal(attributedErrors(forward, backward).length, 0);
  }
});

test('F2: give/take stays a project-wide total: subject {} with counts [N]', () => {
  // The accepted deviation: the message names no locations, so there is nothing structured to carry.
  const project = crowded(1, {});
  project.maps[0].screens[0].entities = [{ actorId: 0, x: 0, y: 0, props: {} }];
  const found = only(validateProject(project), 'give-take-missing-item');
  for (const p of found) assert.deepEqual(p.subject, {});
});

// F3 -- diagnostics returned in arrays.
test('F3: the scan sees the diagnostics streamedCapacityProblems returns in arrays, and a missing field in them is caught', () => {
  // Catches a scan that only looks at pushes, `add(` calls and `diagnose*` object returns.
  const source = fs.readFileSync(path.join(ROOT, 'main/build/generate.js'), 'utf8');
  const sites = diagnosticProducers(source).filter((site) => site.fn === 'streamedCapacityProblems');
  assert.deepEqual(sites.map((site) => site.kind), ['return-array', 'return-array']);
  assert.deepEqual(sites.map((site) => [site.missing, site.bad]), [[[], []], [[], []]]);
  for (const field of ['subject', 'counts']) {
    // remove `field` from both returned objects, in memory
    let broken = source;
    if (field === 'subject') broken = broken.replace(/(rule: 'streamed-(?:regions|ordinary-screens)-over',\s*)subject: \{\},/g, '$1');
    else {
      broken = broken.replace(/,\n\s*counts: \[plan\.streamedNeed, plan\.usable\.length\]/, '').replace(/,\n\s*counts: \[plan\.ordinaryFlat\.length, plan\.streamedNeed, plan\.usable\.length\]/, '');
    }
    assert.notEqual(broken, source, `${field}: the sabotage applied`);
    const found = diagnosticProducers(broken).filter((site) => site.fn === 'streamedCapacityProblems');
    assert.equal(found.length, 2, `${field}: both sites still seen`);
    assert.deepEqual(found.map((site) => site.missing), [[field], [field]], `${field}: reported missing from both`);
  }
});

test('F3: a list-returning builder in an otherwise unlisted file is a producer the inventory test would catch', () => {
  // Catches (7b) finding nothing for `export function capacityProblems() { return [{ message: 'bad' }]; }`.
  const shapes = [
    "export function capacityProblems() { return [{ message: 'bad' }]; }",
    "export function capacityProblems(x) { if (x) return []; return x ? [{ message: 'a', rule: 'r', subject: {}, counts: [] }] : [{ message: 'b' }]; }"
  ];
  for (const text of shapes) {
    const found = diagnosticProducers(text);
    assert.ok(found.length >= 1, text);
    assert.ok(found.some((site) => site.missing.length === 3 || site.missing.length > 0), text);
    assert.deepEqual(uncoveredProducerFiles({ 'shared/new.js': text }), ['shared/new.js'], `(7b) names the file: ${text}`);
  }
  assert.deepEqual(uncoveredProducerFiles({ 'shared/project.js': shapes[0] }), [], 'a listed file is the scan test\'s business, not 7b\'s');
  assert.deepEqual(uncoveredProducerFiles({ 'shared/quiet.js': 'export const x = { message: "unrelated" }; export const list = () => [1, 2];' }), []);
});

// F3, round 2 -- the shapes a list-returning builder is written in.
//
// diagnosticProducers follows a returned value through a BOUNDED set of shapes (conditional and logical result branches; within an array
// its elements, their own conditional / logical branches, and spreads of literal arrays), for a `return` argument and an expression-bodied
// arrow's body alike. It is not dataflow analysis: a callback argument, a nested object property or an identifier is out of scope.
const FULL_FIELDS = "rule: 'r', subject: {}, counts: []";
const LIST_SHAPES = {
  'a spread of a literal array': (obj) => `export function capacityProblems() { return [...[${obj('bad')}]]; }`,
  'conditional elements': (obj) => `export function capacityProblems(x) { return [x ? ${obj('a')} : ${obj('b')}]; }`,
  'an expression-bodied arrow': (obj) => `export const capacityProblems = () => [${obj('bad')}];`,
  'a logical element': (obj) => `export function capacityProblems(x) { return [x && ${obj('bad')}]; }`,
  'a conditional returned list': (obj) => `export function capacityProblems(x) { return x ? [${obj('a')}] : [${obj('b')}]; }`,
  'an arrow returning a conditional of lists': (obj) => `export const capacityProblems = (x) => (x ? [] : [${obj('bad')}]);`
};
const objectWith = (fields) => (message) => `{ message: '${message}'${fields ? `, ${fields}` : ''} }`;
const without = (field) => FULL_FIELDS.split(', ').filter((part) => !part.startsWith(`${field}:`)).join(', ');

test('F3 round 2: each list-returning shape is a producer, is named by the inventory test, and a complete one is clean', () => {
  // Catches a recognizer that handles only `return [ {…}, {…} ]` with direct elements: each of these returned 0 sites.
  for (const [label, shape] of Object.entries(LIST_SHAPES)) {
    const bare = shape(objectWith(''));
    const found = diagnosticProducers(bare);
    assert.ok(found.length >= 1, `${label}: seen`);
    assert.ok(found.every((site) => site.kind === 'return-array' && site.fn === 'capacityProblems'), `${label}: kind and function`);
    assert.deepEqual(uncoveredProducerFiles({ 'shared/new.js': bare }), ['shared/new.js'], `${label}: (7b) names the file`);
    const complete = diagnosticProducers(shape(objectWith(FULL_FIELDS)));
    assert.equal(complete.length, found.length, `${label}: the same number of sites`);
    assert.deepEqual(complete.map((site) => [site.missing, site.bad]), complete.map(() => [[], []]), `${label}: a complete object is clean`);
  }
});

test('F3 round 2: for each shape, an object missing subject (then counts) is reported as missing exactly that field', () => {
  // Catches a recognizer that finds the object but does not hold it to the shape (or finds only the first branch of a conditional).
  for (const [label, shape] of Object.entries(LIST_SHAPES)) {
    for (const field of ['subject', 'counts']) {
      const found = diagnosticProducers(shape(objectWith(without(field))));
      assert.ok(found.length >= 1, `${label}: seen`);
      for (const site of found) assert.deepEqual(site.missing, [field], `${label}: missing ${field}`);
    }
  }
  // both branches of a conditional are each held to it
  assert.equal(diagnosticProducers(LIST_SHAPES['conditional elements'](objectWith(without('subject')))).length, 2);
});

test('F3 round 2: false-positive controls -- nested message properties, callback arguments and standalone objects report nothing', () => {
  // Catches a walker that descends into arbitrary object properties or call arguments, or reports any object with a `message`.
  const quiet = [
    "export function f() { return { detail: { message: 'x' } }; }",
    "export function f() { return { items: [{ message: 'x' }] }; }",
    // Out of scope BY DESIGN: a `{ message }` built inside a callback argument of a returned expression. Following it would need dataflow
    // analysis (what `list` is, what map returns); a builder written that way is not recognised, and the inventory cannot see it.
    "export function f(list) { return list.map(() => ({ message: 'x' })); }",
    "export function f(list) { return [].concat(list.map(() => ({ message: 'x' }))); }",
    "export const f = (list) => list.map(() => ({ message: 'x' }));",
    "const standalone = { message: 'x' }; export function f() { return standalone; }",
    "export function f() { const o = { message: 'x' }; return o; }",
    "export const standalone = { message: 'x' };",
    "export function f() { return [1, 2, [{ message: 'x' }]]; }",
    "export function f() { return [...other, ...[]]; }"
  ];
  for (const text of quiet) assert.deepEqual(diagnosticProducers(text), [], text);
  assert.deepEqual(uncoveredProducerFiles(Object.fromEntries(quiet.map((text, i) => [`shared/q${i}.js`, text]))), []);
  // A bare returned object is a producer only in a diagnose* builder.
  assert.equal(diagnosticProducers("export function diagnoseX() { return { message: 'x' }; }").length, 1);
  assert.equal(diagnosticProducers("export const diagnoseX = () => ({ message: 'x' });").length, 1);
  assert.equal(diagnosticProducers("export function other() { return { message: 'x' }; }").length, 0);
});

test('F3 round 2: the real tree keeps its pinned producer inventory', () => {
  // The walker was widened, so the real files must not have gained or lost a site: generate.js is still 14 pushed + 2 returned in arrays.
  for (const [file, expected] of Object.entries(PRODUCER_FILES)) {
    const kinds = {};
    for (const site of diagnosticProducers(fs.readFileSync(path.join(ROOT, file), 'utf8'))) kinds[site.kind] = (kinds[site.kind] ?? 0) + 1;
    assert.deepEqual(kinds, expected, file);
  }
  assert.deepEqual(PRODUCER_FILES['main/build/generate.js'], { push: 14, 'return-array': 2 });
});
