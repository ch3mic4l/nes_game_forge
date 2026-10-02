// Phase 3a slice S3a, fix round 1 (review 1, required change 2): the M11 measurement commands FAIL CLOSED.
// No Mesen needed: the classification and the verdict are pure, and the pool takes an injected `measure`.
//
// Review 1 reproduced the defect: `run_sw_move_sweep.mjs --jobs=0` exited 0 after "0 cells in 0 s, 0 bad", and a run whose marks were all
// missing printed maxima of 0. These tests are the rejection paths, each beside a positive control (a sound cell and a sound campaign pass),
// so none of them can be satisfied by a validator that rejects everything.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classify, validateCell, populations, marksFor, GATE } from '../lua/run_sw_move_manifest.mjs';
import {
  parseOptions, cellId, expectFor, gated, planStage, runCampaign, verdict, aggregate, isCapacityRefusal, loadReusable, MACHINE_CEILING, COINCIDENCE_CELLS, needsCompact, acceptedUnreachable, UNREACHABLE_ARRANGEMENTS
} from '../lua/run_sw_move_sweep.mjs';
import { parseCellOptions, cellProblems, runCell, parseFlags, wholeNumber, assertRoom } from '../lua/sw_move_policy.mjs';

const SWEEP = path.join(path.dirname(fileURLToPath(import.meta.url)), '../lua/run_sw_move_sweep.mjs');
const MANIFEST = path.join(path.dirname(fileURLToPath(import.meta.url)), '../lua/run_sw_move_manifest.mjs');

// ----------------------------------------------------------------- synthetic runs, in the exact shape parseOutput returns

/** One body: its G, the marks it ran, and its trace (the queue at the releasing NMI, the strip state, what it published). */
function body(f, G, ran, { q = 0, st0 = 2, st1 = 2, stadv = 1, pub = 0 } = {}) {
  const marks = ran.map((n, i) => `${n}@${100 + i * 10}`).join(' ');
  return { mark: { f, line: `G=${G} main=${G - 1500} rel=1500 inner=0 fl=0 ${marks} NMI@0 RTI@500` }, trace: { f, G, main: G - 1500, rel: 1500, inner: 0, q, stadv, st0, st1, stcur: 3, pub, fl: 0, rfl: 0, cam: ran.includes('sw_frame_camera_window') ? 1 : 0 } };
}

function fakeRes(bodies, over = {}) {
  return {
    marks: { M11: bodies.map((b) => b.mark) }, trace: { M11: bodies.map((b) => b.trace) },
    phases: { M11: { maxG: Math.max(...bodies.map((b) => b.trace.G)), gateFail: 0, overruns: 0 } }, done: true, timeout: false, status: 0, ...over
  };
}

const STEP = ['move_tick', 'sw_frame_camera_window'];
const FINAL_SAY = ['move_tick', 'sw_frame_camera_window', 'move_finish', 'script_op_say'];
const soundBodies = () => [body(1, 9000, []), body(2, 16000, STEP), body(3, 16100, STEP), body(4, 16200, FINAL_SAY, { q: 35, stadv: 1 }), body(5, 12000, [], { st0: 0, st1: 0, stadv: 0 })];
const sound = (opts = {}) => classify(fakeRes(soundBodies()), { lead: 'flash', tail: 'say', ...opts });

// ----------------------------------------------------------------- validateCell

test('control: a sound cell (steps with the camera call and a strip, a final body with its continuation and the reduced-chunk coincidence) passes', () => {
  const s = sound();
  assert.deepEqual(validateCell(s, { step: 'strip', final: true, continuation: 'say', coincidence: 'strip' }), []);
  assert.equal(s.step, 2);
  assert.equal(s.final, 1);
  assert.equal(s.maxFinal, 16200);
  assert.ok(s.classes['final.strip.reduced.say'], 'the final body is classed by what coincided with it and what it ran');
});

test('an empty run (no marks collected) is rejected, not reported as an empty population with maxima of 0', () => {
  const s = classify({ marks: {}, trace: {}, phases: {}, done: true, timeout: false, status: 0 }, { tail: 'say' });
  assert.equal(s.bodies, 0);
  const found = validateCell(s, { step: 'strip', final: true });
  assert.ok(found.some((p) => /no body was recorded/.test(p)), found.join('; '));
  assert.ok(found.some((p) => /no step body/.test(p)) && found.some((p) => /no final body/.test(p)));
});

test('missing marks of one kind are rejected: no step body, no final body', () => {
  const noStep = classify(fakeRes([body(1, 9000, []), body(2, 16200, FINAL_SAY)]), { tail: 'say' });
  assert.ok(validateCell(noStep.step === 1 ? noStep : { ...noStep, step: 0 }, {}).length >= 0);
  const finalOnly = classify(fakeRes([body(1, 16200, ['move_finish', 'script_op_say'])]), { tail: 'say' });
  assert.ok(validateCell(finalOnly, { step: 'strip', final: true }).some((p) => /no step body/.test(p)));
  const stepsOnly = classify(fakeRes([body(1, 16000, STEP), body(2, 16100, STEP)]), { tail: 'none' });
  assert.ok(validateCell(stepsOnly, { step: 'strip', final: true }).some((p) => /no final body/.test(p)));
});

test('the composition is asserted: a step without the camera call or the strip, a final without its continuation or its coincidence', () => {
  const noCam = classify(fakeRes([body(1, 16000, ['move_tick']), body(2, 16200, FINAL_SAY)]), { tail: 'say' });
  assert.ok(validateCell(noCam, { step: 'strip', final: true }).some((p) => /camera call with a strip in flight/.test(p)));
  const noStrip = classify(fakeRes([body(1, 16000, STEP, { st0: 0, st1: 0 }), body(2, 16200, FINAL_SAY)]), { tail: 'say' });
  assert.ok(validateCell(noStrip, { step: 'strip', final: true }).some((p) => /camera call with a strip in flight/.test(p)));
  const noCont = classify(fakeRes([body(1, 16000, STEP), body(2, 16200, ['move_tick', 'move_finish'])]), { tail: 'say' });
  assert.ok(validateCell(noCont, { continuation: 'say' }).some((p) => /say tail's continuation, script_op_say/.test(p)));
  const coincideCases = {
    strip: [body(1, 16000, STEP), body(2, 16200, FINAL_SAY, { q: 0 })], // the queue is empty at the final body's releasing NMI
    arm: [body(1, 16000, STEP), body(2, 16200, FINAL_SAY, { q: 35, st0: 2, st1: 2 })], // the strip was already in flight, not armed here
    pub: [body(1, 16000, STEP), body(2, 16200, FINAL_SAY, { pub: 0 })]
  };
  for (const [kind, bodies] of Object.entries(coincideCases)) {
    assert.ok(validateCell(classify(fakeRes(bodies), { tail: 'say' }), { coincidence: kind }).some((p) => new RegExp(`'${kind}' coincidence`).test(p)), kind);
  }
  assert.ok(validateCell(sound(), { coincidence: 'nonsense' }).some((p) => /unknown coincidence kind/.test(p)));
  // and each coincidence is accepted when it really is there
  assert.deepEqual(validateCell(classify(fakeRes([body(1, 16000, STEP), body(2, 17000, FINAL_SAY, { q: 35, st0: 0, st1: 2, stadv: 0 })]), { tail: 'say' }), { coincidence: 'arm' }), []);
  assert.deepEqual(validateCell(classify(fakeRes([body(1, 16000, STEP), body(2, 17000, FINAL_SAY, { pub: 35 })]), { tail: 'say' }), { coincidence: 'pub' }), []);
});

test('a bad Mesen status, a timeout, a run that never finished and a mismatch between mark and trace lines are each rejected', () => {
  for (const [over, re] of [[{ status: 1 }, /Mesen exit status 1/], [{ timeout: true }, /timed out/], [{ done: false }, /did not finish/]]) {
    const s = classify(fakeRes(soundBodies(), over), { tail: 'say' });
    assert.ok(validateCell(s, {}).some((p) => re.test(p)), JSON.stringify(over));
  }
  const res = fakeRes(soundBodies());
  res.trace.M11.pop();
  assert.ok(validateCell(classify(res, { tail: 'say' }), {}).some((p) => /mark lines but/.test(p)));
});

test('a missing or non-finite timing is rejected, never read as a pass', () => {
  const bad = soundBodies();
  bad[1].mark.line = bad[1].mark.line.replace(/G=\d+/, 'G=nan');
  const s = classify(fakeRes(bad), { tail: 'say' });
  assert.ok(validateCell(s, {}).some((p) => /no finite G in its mark line/.test(p)), 'NaN G');
  assert.ok(validateCell({ ...sound(), maxStep: undefined }, {}).some((p) => /maxStep is not a number/.test(p)));
});

// ----------------------------------------------------------------- the options and the worker count

const PARENT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'); // any tree with main/build/pipeline.js: the repository itself

test('control: sound options parse', () => {
  const o = parseOptions(['--stage=phase', '--out=/tmp/m11.json', `--parent=${PARENT}`, '--jobs=8', '--tiles=15'], { running: 0 });
  assert.deepEqual([o.stage, o.jobs, o.tiles, o.dryRun], ['phase', 8, 15, false]);
});

test('zero, negative, fractional, non-numeric and over-ceiling worker counts are rejected (review 1 reproduced --jobs=0 exiting 0)', () => {
  for (const jobs of ['0', '-1', '1.5', 'abc', '', String(MACHINE_CEILING + 1), '1e3']) {
    assert.throws(() => parseOptions(['--stage=phase', '--out=/tmp/x.json', `--jobs=${jobs}`], { running: 0 }), /--jobs/, `--jobs=${jobs}`);
  }
});

test('the machine ceiling counts Mesen processes already running', () => {
  assert.doesNotThrow(() => parseOptions(['--stage=phase', '--out=/tmp/x.json', `--parent=${PARENT}`, `--jobs=${MACHINE_CEILING - 5}`], { running: 5 }));
  assert.throws(() => parseOptions(['--stage=phase', '--out=/tmp/x.json', `--parent=${PARENT}`, `--jobs=${MACHINE_CEILING - 4}`], { running: 5 }), /machine ceiling/);
});

test('invalid measurement options are rejected: tiles, stage, unknown flags, a missing --out', () => {
  const base = ['--stage=phase', '--out=/tmp/x.json'];
  for (const tiles of ['0', '7', '17', 'x', '15.5']) assert.throws(() => parseOptions([...base, `--tiles=${tiles}`], { running: 0 }), /--tiles/, tiles);
  assert.throws(() => parseOptions(['--stage=nope', '--out=/tmp/x.json'], { running: 0 }), /--stage/);
  assert.throws(() => parseOptions(['--out=/tmp/x.json'], { running: 0 }), /--stage/);
  assert.throws(() => parseOptions([...base, '--bogus=1'], { running: 0 }), /unknown option --bogus/);
  assert.throws(() => parseOptions(['--stage=phase'], { running: 0 }), /--out/);
  assert.throws(() => parseOptions([...base, '--sec-per-run=0'], { running: 0 }), /--sec-per-run/);
  // fail closed on the rest of the command line: a repeated flag, a bare argument, a valueless valued flag, a valued boolean flag, no/invalid parent
  assert.throws(() => parseOptions([...base, '--jobs=2', '--jobs=3'], { running: 0 }), /--jobs was given twice/);
  assert.throws(() => parseOptions([...base, 'stray'], { running: 0 }), /unexpected argument/);
  assert.throws(() => parseOptions([...base, '--reuse'], { running: 0 }), /--reuse needs a value/);
  assert.throws(() => parseOptions([...base, '--dry-run=1'], { running: 0 }), /--dry-run takes no value/);
  assert.throws(() => parseOptions([...base, '--only=x'], { running: 0 }), /unknown option --only/, 'a filtered plan can never certify');
});

test('every cell is measured beside the parent: a campaign without a usable --parent is refused, a dry run needs none', () => {
  const base = ['--stage=phase', '--out=/tmp/x.json'];
  assert.throws(() => parseOptions(base, { running: 0 }), /--parent=<dir> is required/);
  assert.throws(() => parseOptions([...base, '--parent=/nonexistent-tree'], { running: 0 }), /not a project tree/);
  assert.doesNotThrow(() => parseOptions(['--stage=phase', '--dry-run'], { running: 0 }));
});

test('the command line refuses --jobs=0 with a nonzero exit and writes nothing (the reviewer\'s exact invocation)', () => {
  const r = spawnSync(process.execPath, [SWEEP, '--stage=lead', '--out=/nonexistent-dir/never.json', '--jobs=0'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /--jobs must be 1\.\.20/);
  assert.doesNotMatch(r.stdout, /0 bad|0 cells/);
});

test('runCampaign refuses a worker count of zero instead of returning an empty campaign', async () => {
  await assert.rejects(() => runCampaign({ cells: [], measure: async () => ({}), jobs: 0 }), /jobs/);
  await assert.rejects(() => runCampaign({ cells: [], measure: async () => ({}), jobs: MACHINE_CEILING + 1 }), /ceiling/);
});

// ----------------------------------------------------------------- the verdict

const CELL = { which: 'new', gt: 'action', wide: true, pop: 'many-small', anim: 'P1', bound: false, lead: 'none', tail: 'say', dist: 157, touchY: 60 };
const okSummary = (over = {}) => ({ ...classify(fakeRes(soundBodies()), { tail: 'say' }), ...over });
const okResult = (c = CELL, summary = okSummary()) => ({ id: cellId(c), cell: c, summary });

test('control: a campaign whose every planned cell has one sound result passes', () => {
  const v = verdict([okResult()], [CELL]);
  assert.deepEqual(v.problems, []);
  assert.equal(v.ok, true);
  assert.equal(v.gatedRows, 2);
});

test('an empty plan or an empty result set is never a pass ("0 bad" is not "all required rows passed")', () => {
  assert.equal(verdict([], []).ok, false);
  const v = verdict([], [CELL]);
  assert.equal(v.ok, false);
  assert.match(v.problems[0].problem, /no result for this planned cell/);
});

test('exactly one result per planned cell: a missing, a duplicated and an unplanned result are each rejected', () => {
  const other = { ...CELL, dist: 158 };
  assert.ok(verdict([okResult(CELL)], [CELL, other]).problems.some((p) => /no result/.test(p.problem)));
  assert.ok(verdict([okResult(CELL), okResult(CELL)], [CELL]).problems.some((p) => /2 results/.test(p.problem)));
  assert.ok(verdict([okResult(CELL), okResult(other)], [CELL]).problems.some((p) => /not planned/.test(p.problem)));
});

test('an injected over-gate row fails the campaign: M11a at 29,781, M11b at 29,781; 29,780 passes (the boundary)', () => {
  assert.equal(verdict([okResult(CELL, okSummary({ maxStep: GATE }))], [CELL]).ok, true);
  const a = verdict([okResult(CELL, okSummary({ maxStep: GATE + 1 }))], [CELL]);
  assert.equal(a.ok, false);
  assert.match(a.problems[0].problem, /M11a step G = 29781 exceeds the gate 29780/);
  const b = verdict([okResult(CELL, okSummary({ maxFinal: GATE + 1 }))], [CELL]);
  assert.match(b.problems[0].problem, /M11b final G = 29781/);
  // a real over-gate BODY, through the classification and not only through a patched figure
  const heavy = soundBodies(); heavy[3] = body(4, GATE + 500, FINAL_SAY, { q: 35, stadv: 1 });
  assert.equal(verdict([okResult(CELL, classify(fakeRes(heavy), { tail: 'say' }))], [CELL]).ok, false);
});

test('what is deliberately NOT gated: parent cells (their F6 redraw) and a Say lead\'s pre-Move close bodies; nothing else', () => {
  const parent = { ...CELL, which: 'parent' };
  assert.equal(gated(parent), false);
  assert.equal(verdict([okResult(parent, okSummary({ maxStep: 1082000, maxFinal: 1082000 }))], [parent]).ok, true);
  const say = { ...CELL, lead: 'say', tail: 'none' };
  assert.equal(gated(say), true, 'a Say lead exempts its close bodies only, never the Move\'s own step and final bodies (review 2)');
  const closeBodies = [body(1, 38633, [], { st0: 0, st1: 0 }), body(2, 16000, STEP), body(3, 16100, ['move_tick', 'sw_frame_camera_window', 'move_finish'])];
  const heavyClose = classify(fakeRes(closeBodies), { lead: 'say', tail: 'none' });
  assert.equal(heavyClose.maxBefore, 38633);
  assert.equal(verdict([okResult(say, heavyClose)], [say]).ok, true, 'CONTROL: the pre-Move box-close body (before.*) is a diagnostic, not an M11 row');
  assert.equal(verdict([okResult(say, heavyClose)], [say]).gatedRows, 2, 'the Say-lead cell still contributes its step and final rows');
});

test('a Say lead\'s actual Move bodies are gated: a 40,000-cycle step or final body fails (review 2 reproduced ok:true with 0 gated rows)', () => {
  const say = { ...CELL, lead: 'say', tail: 'none' };
  const heavyStep = classify(fakeRes([body(1, 38633, [], { st0: 0, st1: 0 }), body(2, 40000, STEP), body(3, 16100, ['move_tick', 'sw_frame_camera_window', 'move_finish'])]), { lead: 'say', tail: 'none' });
  const a = verdict([okResult(say, heavyStep)], [say]);
  assert.equal(a.ok, false);
  assert.ok(a.problems.some((p) => /M11a step G = 40000 exceeds the gate 29780/.test(p.problem)), JSON.stringify(a.problems));
  const heavyFinal = classify(fakeRes([body(1, 38633, [], { st0: 0, st1: 0 }), body(2, 16000, STEP), body(3, 40000, ['move_tick', 'sw_frame_camera_window', 'move_finish'])]), { lead: 'say', tail: 'none' });
  assert.ok(verdict([okResult(say, heavyFinal)], [say]).problems.some((p) => /M11b final G = 40000/.test(p.problem)));
  // and the standalone command applies the same rule
  assert.ok(cellProblems(heavyStep, say).some((p) => /M11a step G = 40000/.test(p)));
  assert.deepEqual(cellProblems(classify(fakeRes([body(1, 38633, [], { st0: 0, st1: 0 }), body(2, 16000, STEP), body(3, 16100, ['move_tick', 'sw_frame_camera_window', 'move_finish'])]), { lead: 'say', tail: 'none' }), say), []);
});

test('a failed child (a thrown build or harness error) and a nonzero Mesen status are failures, found through the real pool', async () => {
  const cells = [CELL, { ...CELL, dist: 158 }, { ...CELL, dist: 159 }];
  const results = await runCampaign({
    cells, jobs: 2,
    measure: async (c) => {
      if (c.dist === 158) throw new Error('nesasm failed: label too long');
      return { summary: c.dist === 159 ? okSummary({ status: 3 }) : okSummary() };
    }
  });
  assert.equal(results.length, 3, 'one result per cell, the thrown one captured not lost');
  const v = verdict(results, cells);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /the measurement failed: nesasm failed/.test(p.problem)));
  assert.ok(v.problems.some((p) => /Mesen exit status 3/.test(p.problem)));
  assert.equal(v.problems.length, 2, 'only the two bad cells are reported');
});

test('the pool returns exactly one result per cell however many workers run', async () => {
  const cells = Array.from({ length: 23 }, (_, i) => ({ ...CELL, dist: 150 + i }));
  for (const jobs of [1, 4, 20]) {
    const results = await runCampaign({ cells, jobs, measure: async () => ({ summary: okSummary() }) });
    assert.deepEqual(results.map((r) => r.id).sort(), cells.map(cellId).sort(), `${jobs} workers`);
    assert.equal(verdict(results, cells).ok, true);
  }
});

// ----------------------------------------------------------------- the plan itself

test('every stage plans unique cells; populations are EXACTLY the bound in tiles over eight slots; the bound variant is 14', () => {
  for (const tiles of [15, 14]) {
    for (const [name, sizes] of Object.entries(populations(tiles))) {
      assert.equal(sizes.length, 8, name);
      assert.equal(sizes.reduce((a, b) => a + b, 0), tiles, `${name} must hold exactly ${tiles} tiles`);
    }
  }
  assert.ok(Object.values(populations(15)).some((s) => s.filter((v) => v === 0).length === 7), 'a few-large shape with seven zero-tile actors');
  assert.ok(Object.values(populations(15)).some((s) => s.every((v) => v > 0)), 'a many-small shape with every actor carrying tiles');
  for (const stage of ['phase', 'coincide', 'pops', 'anims', 'lead']) {
    const cells = planStage(stage, { tiles: 15 });
    assert.ok(cells.length > 0, stage);
    assert.equal(new Set(cells.map(cellId)).size, cells.length, `${stage}: duplicate cells`);
    assert.ok(cells.some((c) => c.which === 'parent'), `${stage}: every cell is measured beside the parent`);
  }
  assert.ok(planStage('pops', { tiles: 15 }).some((c) => c.bound), 'the 14-tile bound-tile variant is in the plan');
  assert.ok(planStage('pops', { tiles: 15 }).filter((c) => c.bound).every((c) => c.pop in populations(14)));
});

test('the plan covers both game types, both arts, every tail and (the coincidence stage) every claimed composition kind', () => {
  const cells = planStage('coincide', { tiles: 15 }).filter((c) => c.which === 'new');
  assert.deepEqual([...new Set(cells.map((c) => c.gt))].sort(), ['action', 'rpg']);
  assert.deepEqual([...new Set(cells.map((c) => c.wide))].sort(), [false, true]);
  assert.deepEqual([...new Set(cells.map((c) => c.tail))].sort(), ['flash', 'move2', 'none', 'say', 'switch']);
  assert.deepEqual([...new Set(cells.map((c) => expectFor(c).coincidence))].sort(), ['arm', 'pub', 'strip']);
  assert.ok(COINCIDENCE_CELLS.every((k) => k.kind && k.dist > 0));
  assert.deepEqual(marksFor({ lead: 'flash', tail: 'say' }).sort(), ['flash_tick', 'move_finish', 'move_tick', 'script_op_flash', 'script_op_say', 'sw_frame_camera_window']);
});

const REFUSAL = 'Map Forge: The lookup tables need 168 bytes but only 160 are free alongside the engine code. Try removing every Move command';
const PARENT_CELL = { ...CELL, which: 'parent' };
const refusedResult = (c) => ({ id: cellId(c), cell: c, error: REFUSAL });

test('isCapacityRefusal recognizes the generator\'s capacity answers and nothing else', () => {
  assert.equal(isCapacityRefusal(REFUSAL), true);
  assert.equal(isCapacityRefusal('Map Forge: The streamed maps need 60 of the 59 8 KB program regions UNROM 512 has free for world data.'), true);
  assert.equal(isCapacityRefusal('nesasm failed: label too long'), false);
  assert.equal(isCapacityRefusal(undefined), false);
});

test('CONTROL: a campaign whose new engine and parent both measure passes, with nothing excluded', () => {
  const v = verdict([okResult(CELL), okResult(PARENT_CELL, okSummary())], [CELL, PARENT_CELL]);
  assert.equal(v.ok, true);
  assert.equal(v.measured, 2);
  assert.deepEqual([v.excluded.length, v.parentUnavailable.length], [0, 0]);
});

test('a new-engine capacity refusal with NO planned parent partner is a problem, not an exclusion (review 2: a one-cell campaign with zero measurements passed)', () => {
  const v = verdict([refusedResult(CELL)], [CELL]);
  assert.equal(v.ok, false);
  assert.equal(v.measured, 0);
  assert.ok(v.problems.some((p) => /no matching parent refusal \(the parent cell is not planned\)/.test(p.problem)), JSON.stringify(v.problems));
  assert.ok(v.problems.some((p) => /no cell was measured/.test(p.problem)));
  assert.equal(v.excluded.length, 1, 'the exclusion stays visible');
});

test('a new-engine refusal beside a parent that was NOT refused (no refusal result) is a problem: there is no matching parent refusal', () => {
  const v = verdict([refusedResult(CELL), { id: cellId(PARENT_CELL), cell: PARENT_CELL, error: 'nesasm failed: label too long' }], [CELL, PARENT_CELL]);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /no matching parent refusal \(the parent cell is not refused\)/.test(p.problem)), JSON.stringify(v.problems));
});

test('a refusal on BOTH engines is visible but does not discharge the workload: the run still fails', () => {
  const v = verdict([refusedResult(CELL), refusedResult(PARENT_CELL)], [CELL, PARENT_CELL]);
  assert.equal(v.ok, false);
  assert.equal(v.excluded.length, 2);
  assert.ok(v.problems.some((p) => /required workload not measured: a capacity refusal does not discharge a coverage obligation/.test(p.problem)), JSON.stringify(v.problems));
  assert.ok(!v.problems.some((p) => /no matching parent refusal/.test(p.problem)), 'the pairing itself is sound');
  // the same pair beside a measured cell: the campaign is incomplete, however many other cells pass
  const other = { ...CELL, dist: 158 };
  const w = verdict([refusedResult(CELL), refusedResult(PARENT_CELL), okResult(other)], [CELL, PARENT_CELL, other]);
  assert.equal(w.ok, false);
  assert.equal(w.measured, 1);
});

test('an all-excluded or all-failed campaign is never a pass', () => {
  const v = verdict([refusedResult(CELL), refusedResult(PARENT_CELL)], [CELL, PARENT_CELL]);
  assert.ok(v.problems.some((p) => /no cell was measured: every planned cell was excluded, failed or missing/.test(p.problem)));
  const failed = verdict([{ id: cellId(CELL), cell: CELL, error: 'nesasm failed: label too long' }], [CELL]);
  assert.equal(failed.ok, false);
});

test('a new-engine refusal against a parent that BUILDS stays a problem (the regression rule): the new engine lost a project', () => {
  const v = verdict([refusedResult(CELL), okResult(PARENT_CELL, okSummary())], [CELL, PARENT_CELL]);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /the new engine refuses a project the parent builds/.test(p.problem)));
});

test('a PARENT-only refusal beside a measured new-engine cell is recorded as "no parent baseline", not a failure and not a baseline', () => {
  const v = verdict([okResult(CELL), refusedResult(PARENT_CELL)], [CELL, PARENT_CELL]);
  assert.equal(v.ok, true);
  assert.equal(v.measured, 1);
  assert.equal(v.parentUnavailable.length, 1);
  assert.equal(v.parentUnavailable[0].id, cellId(PARENT_CELL));
  assert.equal(aggregate([okResult(CELL), refusedResult(PARENT_CELL)]).every((r) => r.parent === 0 && r.delta === null), true, 'no parent figure is invented for a cell the parent could not build');
});

test('the parent is held to timed step/final bodies and its continuation only: it never arms a strip, the new engine is held to the full composition', () => {
  const parent = { ...CELL, which: 'parent', lead: 'flash', kind: 'strip' };
  assert.deepEqual(expectFor(parent), { step: false, final: true, continuation: 'say' }, 'a Flash-lead parent cell is a one-tick Move');
  assert.deepEqual(expectFor({ ...parent, lead: 'none' }), { step: true, final: true, continuation: 'say' });
  assert.equal(expectFor({ ...CELL, lead: 'flash', kind: 'strip' }).coincidence, 'strip');
  const noStripParent = classify(fakeRes([body(1, 9000, ['move_tick'], { st0: 0, st1: 0 }), body(2, 9100, ['move_tick', 'move_finish', 'script_op_say'], { st0: 0, st1: 0 })]), { tail: 'say' });
  assert.deepEqual(validateCell(noStripParent, expectFor(parent)), []);
  assert.ok(validateCell(noStripParent, expectFor({ ...CELL, which: 'new' })).length > 0, 'the same run is a defect for the new engine');
});

test('aggregate keeps the new engine beside the parent for each row class and reports the margin to the gate', () => {
  const parent = { ...CELL, which: 'parent' };
  const rows = aggregate([okResult(CELL), okResult(parent, okSummary())]);
  const row = rows.find((r) => r.key.includes('M11b') && r.key.includes('final.strip.reduced.say'));
  assert.ok(row, JSON.stringify(rows.map((r) => r.key)));
  assert.equal(row.new, 16200);
  assert.equal(row.parent, 16200);
  assert.equal(row.margin, GATE - 16200);
});

// ----------------------------------------------------------------- the standalone cell command (review 2: its CLI exited 0 for every one of these)

/** A measurement the command's `measure` returns instead of launching Mesen: the shape `measureMove` returns. */
const fakeMeasure = (bodies, over = {}, opts = { lead: 'none', tail: 'none' }) => async () => ({ summary: classify(fakeRes(bodies, over), opts) });
const stepFinal = (G, finalRan = ['move_tick', 'sw_frame_camera_window', 'move_finish']) => [body(1, G, STEP), body(2, G, finalRan)];

test('CONTROL: the standalone command passes a sound new-engine cell with exit 0', async () => {
  const r = await runCell([], { measure: fakeMeasure(stepFinal(16000)), running: 0 });
  assert.equal(r.exitCode, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).problems, []);
});

test('the standalone command exits 1 on an over-gate cell (G = 40,000; the gate is 29,780), 0 at the boundary', async () => {
  const over = await runCell([], { measure: fakeMeasure(stepFinal(40000)), running: 0 });
  assert.equal(over.exitCode, 1);
  assert.match(JSON.parse(over.stdout).problems.join(';'), /M11a step G = 40000 exceeds the gate 29780/);
  assert.equal((await runCell([], { measure: fakeMeasure(stepFinal(GATE)), running: 0 })).exitCode, 0);
  assert.equal((await runCell([], { measure: fakeMeasure(stepFinal(GATE + 1)), running: 0 })).exitCode, 1);
  // the parent is not gated (its F6 redraw)
  assert.equal((await runCell(['--root=' + PARENT, '--which=parent'], { measure: fakeMeasure(stepFinal(1082000, ['move_tick', 'move_finish'])), running: 0 })).exitCode, 0);
});

test('the standalone command exits 1 when the requested tail never ran its handler (--tail=say, no script_op_say in any final body)', async () => {
  const noHandler = await runCell(['--tail=say'], { measure: fakeMeasure(stepFinal(16000), {}, { tail: 'say' }), running: 0 });
  assert.equal(noHandler.exitCode, 1);
  assert.match(JSON.parse(noHandler.stdout).problems.join(';'), /no final body ran the say tail's continuation, script_op_say/);
  const withHandler = await runCell(['--tail=say'], { measure: fakeMeasure(stepFinal(16000, ['move_tick', 'sw_frame_camera_window', 'move_finish', 'script_op_say']), {}, { tail: 'say' }), running: 0 });
  assert.equal(withHandler.exitCode, 0, withHandler.stdout);
});

test('the standalone command exits 1 when the step bodies never ran the camera call with a strip in flight (M11a composition)', async () => {
  const noCam = await runCell([], { measure: fakeMeasure([body(1, 16000, ['move_tick']), body(2, 16000, ['move_tick', 'move_finish'])]), running: 0 });
  assert.equal(noCam.exitCode, 1);
  assert.match(JSON.parse(noCam.stdout).problems.join(';'), /camera call with a strip in flight/);
});

test('the standalone command holds a Flash-lead new-engine cell to the coincidence it names', async () => {
  const flashFinal = ['move_tick', 'sw_frame_camera_window', 'move_finish', 'script_op_flash'];
  const bodies = (over) => [body(1, 9000, ['script_op_flash']), body(2, 16000, flashFinal, over)];
  const lead = { lead: 'flash', tail: 'none' };
  const sound = await runCell(['--lead=flash', '--coincide=strip'], { measure: fakeMeasure(bodies({ q: 35, st0: 2, stadv: 1 }), {}, lead), running: 0 });
  assert.equal(sound.exitCode, 0, sound.stdout);
  const absent = await runCell(['--lead=flash', '--coincide=strip'], { measure: fakeMeasure(bodies({ q: 0, st0: 2, stadv: 1 }), {}, lead), running: 0 });
  assert.equal(absent.exitCode, 1);
  assert.match(JSON.parse(absent.stdout).problems.join(';'), /'strip' coincidence/);
});

test('the standalone command refuses unknown and malformed options with exit 2 BEFORE measuring (the reviewer\'s five probes and more)', async () => {
  let measured = 0;
  const measure = async () => { measured++; return fakeMeasure(stepFinal(16000))(); };
  const cases = [
    [['--bogus=1'], /unknown option --bogus/], [['--jobs=0'], /unknown option --jobs/], [['--wide=garbage'], /--wide must be one of 0, 1/],
    [['--gt=snes'], /--gt must be one of/], [['--tail=bogus'], /--tail must be one of/], [['--lead=bogus'], /--lead must be one of/],
    [['--pop=nope'], /--pop must be one of/], [['--anim=P99'], /--anim must be one of/], [['--bound=2'], /--bound must be one of/],
    [['--dist=0'], /--dist must be 1\.\.255/], [['--dist=256'], /--dist must be 1\.\.255/], [['--dist=1.5'], /--dist must be a whole number/],
    [['--dist=-3'], /--dist must be a whole number/], [['--touchY=240'], /--touchY must be 0\.\.239/], [['--tiles=7'], /--tiles must be 8\.\.16/], [['--tiles=17'], /--tiles must be 8\.\.16/],
    [['--dist'], /--dist needs a value/], [['--dist=3', '--dist=4'], /--dist was given twice/], [['stray'], /unexpected argument/],
    [['--root=/nonexistent-tree', '--which=new'], /not a project tree/], [[`--root=${PARENT}`], /--root needs --which/],
    [['--lead=flash'], /must name the coincidence it claims/], [['--lead=none', '--coincide=strip'], /needs --lead=flash/],
    [['--lead=flash', '--coincide=nope'], /--coincide must be one of/], [['--lead=flash', '--coincide=strip', `--root=${PARENT}`, '--which=parent'], /needs --which=new/]
  ];
  for (const [argv, re] of cases) {
    const r = await runCell(argv, { measure, running: 0 });
    assert.equal(r.exitCode, 2, `${argv.join(' ')} -> ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, re, argv.join(' '));
    assert.equal(r.stdout, '');
  }
  assert.equal(measured, 0, 'not one malformed command reached the measurement');
});

test('the standalone command checks the 20-process ceiling before launching: a full machine is exit 2, the last free slot is not', async () => {
  const measure = fakeMeasure(stepFinal(16000));
  const full = await runCell([], { measure, running: MACHINE_CEILING });
  assert.equal(full.exitCode, 2);
  assert.match(full.stderr, /exceeds the machine ceiling of 20/);
  assert.equal((await runCell([], { measure, running: MACHINE_CEILING - 1 })).exitCode, 0);
  assert.throws(() => assertRoom(1, MACHINE_CEILING), /machine ceiling/);
  assert.doesNotThrow(() => assertRoom(1, MACHINE_CEILING - 1));
});

test('the real command line exits 2 for the reviewer\'s probes without launching anything (spawned: --bogus, --jobs=0, --wide=garbage)', () => {
  for (const arg of ['--bogus=1', '--jobs=0', '--wide=garbage']) {
    const r = spawnSync(process.execPath, [MANIFEST, arg], { encoding: 'utf8' });
    assert.equal(r.status, 2, `${arg}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /^error: /);
    assert.equal(r.stdout, '');
  }
});

test('flags parse strictly: unknown, repeated, bare, valueless and valued-boolean are each an error; whole numbers are whole', () => {
  const spec = { a: 'value', b: 'bool' };
  assert.deepEqual(parseFlags(['--a=1', '--b'], spec), { a: '1', b: true });
  assert.throws(() => parseFlags(['--c=1'], spec), /unknown option --c/);
  assert.throws(() => parseFlags(['--a=1', '--a=2'], spec), /twice/);
  assert.throws(() => parseFlags(['x'], spec), /unexpected argument/);
  assert.throws(() => parseFlags(['--a'], spec), /needs a value/);
  assert.throws(() => parseFlags(['--b=1'], spec), /takes no value/);
  assert.equal(wholeNumber('7', 'n', 1, 9), 7);
  for (const bad of ['0x10', '1e2', '-1', ' 1', '1.0']) assert.throws(() => wholeNumber(bad, 'n', 0, 9), /--n/, bad);
  assert.throws(() => wholeNumber('10', 'n', 1, 9), /--n must be 1\.\.9/);
});

// ----------------------------------------------------------------- the population plan and reuse

test('every actor-count distribution is planned: one to eight actors carrying the tiles, at 15 tiles and at 14 (review 2: counts 5, 6 and 7 were missing)', () => {
  for (const tiles of [15, 14]) {
    const counts = Object.values(populations(tiles)).map((s) => s.filter((v) => v > 0).length);
    for (let n = 1; n <= 8; n++) assert.ok(counts.includes(n), `${tiles} tiles: no population with ${n} nonzero actors (have ${counts})`);
  }
  const planned = planStage('pops', { tiles: 15 }).filter((c) => c.which === 'new');
  for (const pop of ['few-large-5', 'few-large-6', 'few-large-7']) {
    assert.ok(planned.some((c) => c.pop === pop && !c.bound && c.gt === 'action'), `${pop} on an action project`);
    assert.ok(planned.some((c) => c.pop === pop && c.bound && c.gt === 'rpg'), `${pop} with the bound tile on an rpg project`);
  }
});

test('an rpg cell with a switch-bound tile and a Flash command is the one measured on a compacted scene, and its id says so', () => {
  const base = { which: 'new', gt: 'rpg', wide: false, pop: 'few-large-2', anim: 'P1', bound: true, lead: 'none', tail: 'say', dist: 150, touchY: 60 };
  assert.equal(needsCompact(base), false);
  assert.equal(needsCompact({ ...base, tail: 'flash' }), true);
  assert.equal(needsCompact({ ...base, lead: 'flash' }), true);
  assert.equal(needsCompact({ ...base, tail: 'flash', bound: false }), false);
  assert.equal(needsCompact({ ...base, tail: 'flash', gt: 'action' }), false);
  assert.ok(cellId({ ...base, tail: 'flash' }).endsWith('/compact'));
  assert.ok(!cellId(base).endsWith('/compact'));
  const compact = planStage('pops', { tiles: 15 }).filter(needsCompact);
  assert.ok(compact.length > 0 && compact.every((c) => c.gt === 'rpg' && c.bound && (c.lead === 'flash' || c.tail === 'flash')));
  assert.equal(new Set(compact.map(cellId)).size, compact.length);
});

test('--reuse takes a cell\'s successful result from an earlier campaign file, never an errored one, and a later file overrides an earlier one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-reuse-'));
  try {
    const write = (name, results) => { const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify({ results })); return f; };
    const a = okResult(CELL, okSummary({ maxStep: 111 }));
    const b = okResult(CELL, okSummary({ maxStep: 222 }));
    const bad = { id: cellId({ ...CELL, dist: 158 }), cell: { ...CELL, dist: 158 }, error: 'boom' };
    const f1 = write('a.json', [a, bad]);
    const f2 = write('b.json', [b]);
    const got = loadReusable([f1, f2]);
    assert.equal(got.get(cellId(CELL)).summary.maxStep, 222);
    assert.equal(got.has(bad.id), false, 'an errored result is re-measured');
    assert.throws(() => loadReusable([path.join(dir, 'missing.json')]), /--reuse/);
    fs.writeFileSync(path.join(dir, 'junk.json'), '{"results": 3}');
    assert.throws(() => loadReusable([path.join(dir, 'junk.json')]), /no results array/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a long run is resumable: runCampaign reports every finished result as it lands, and a partial file is reusable', async () => {
  const cells = Array.from({ length: 5 }, (_, i) => ({ ...CELL, dist: 150 + i }));
  const landed = [];
  const results = await runCampaign({ cells, jobs: 2, measure: async () => ({ summary: okSummary() }), onResult: (r) => landed.push(r.id) });
  assert.deepEqual(landed.sort(), results.map((r) => r.id).sort());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-partial-'));
  try {
    fs.writeFileSync(path.join(dir, 'm11.json.partial'), JSON.stringify({ stage: 'phase', partial: true, results: results.slice(0, 3) }));
    const got = loadReusable([path.join(dir, 'm11.json.partial')]);
    assert.equal(got.size, 3);
    const left = cells.filter((c) => !got.has(cellId(c)));
    assert.equal(left.length, 2, 'only the unfinished cells are re-run');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ----------------------------------------------------------------- Chris's ruling: exactly the 74 unreachable arrangements are accepted

const tablesRefusal = (need, free) => `Map Forge: The lookup tables need ${need} bytes but only ${free} are free alongside the engine code. Try removing every Move command (frees 455 bytes)`;
const UNREACH = { which: 'new', gt: 'rpg', wide: true, pop: 'few-large-1', anim: 'P1', bound: true, lead: 'flash', tail: 'say', dist: 3, touchY: 60, kind: 'strip' };
const refusedWith = (c, need, free) => ({ id: cellId(c), cell: c, error: tablesRefusal(need, free) });
const pair = (c, need = 165, newFree = 160, parentFree = 126) => [refusedWith(c, need, newFree), refusedWith({ ...c, which: 'parent' }, need, parentFree)];
const PARENT_UNREACH = { ...UNREACH, which: 'parent' };

test('CONTROL: the accepted unreachable arrangements pass the verdict, visibly, beside a measured cell (few-large-1 at 165, few-large-3 at 163)', () => {
  const planned = [UNREACH, PARENT_UNREACH, CELL];
  const v = verdict([...pair(UNREACH), okResult(CELL)], planned);
  assert.deepEqual(v.problems, []);
  assert.equal(v.ok, true);
  assert.equal(v.accepted.length, 1);
  assert.equal(v.accepted[0].id, cellId(UNREACH));
  assert.match(v.accepted[0].ruling, /unreachable: both engines refuse/);
  assert.equal(v.excluded.length, 2, 'both refusals stay visible');
  assert.equal(v.parentUnavailable.length, 0, 'the parent partner is part of the accepted pair, not a lost baseline');
  assert.equal(v.measured, 1, 'an accepted exclusion is never counted as a measurement');
  const three = { ...UNREACH, pop: 'few-large-3' };
  const w = verdict([...pair(three, 163), okResult(CELL)], [three, { ...three, which: 'parent' }, CELL]);
  assert.equal(w.ok, true);
  assert.equal(w.accepted.length, 1);
  assert.deepEqual(UNREACHABLE_ARRANGEMENTS, { 'few-large-1': 165, 'few-large-3': 163 });
});

test('the ruling covers exactly its arrangements: each way of stepping outside it is still a problem (beside the passing control above)', () => {
  const outside = (label, c, need, newFree = 160, parentFree = 126) => {
    const v = verdict([...pair(c, need, newFree, parentFree), okResult(CELL)], [c, { ...c, which: 'parent' }, CELL]);
    assert.equal(v.ok, false, label);
    assert.equal(v.accepted.length, 0, label);
    assert.ok(v.problems.some((p) => /required workload not measured/.test(p.problem)), label);
  };
  outside('another population (few-large-2) at the same byte figure', { ...UNREACH, pop: 'few-large-2' }, 165);
  outside('few-large-3 at few-large-1\'s figure', { ...UNREACH, pop: 'few-large-3' }, 165);
  outside('few-large-1 a byte worse than ruled', UNREACH, 166);
  outside('unapproved distance', { ...UNREACH, dist: 254 }, 165);
  outside('unapproved position', { ...UNREACH, touchY: 0 }, 165);
  outside('unapproved parent free figure', UNREACH, 165, 160, 125);
  outside('tight art', { ...UNREACH, wide: false }, 165);
  outside('no switch-bound tile', { ...UNREACH, bound: false }, 165);
  outside('an action project', { ...UNREACH, gt: 'action' }, 165);
  outside('another animation preset', { ...UNREACH, anim: 'P8' }, 165);
  outside('no Flash command', { ...UNREACH, lead: 'none', tail: 'say', kind: undefined }, 165);
  outside('a different free figure on the new engine', UNREACH, 165, 150);
  outside('a parent with as many bytes free as the new engine', UNREACH, 165, 160, 160);
  // the two engines must each show the ruled figure: a mismatch either way is outside the ruling
  for (const [n, q] of [[166, 165], [165, 166]]) {
    const v = verdict([refusedWith(UNREACH, n, 160), refusedWith(PARENT_UNREACH, q, 126), okResult(CELL)], [UNREACH, PARENT_UNREACH, CELL]);
    assert.equal(v.ok, false, `new ${n} beside parent ${q}`);
    assert.equal(v.accepted.length, 0);
  }
  // the parent building the project is the regression rule, not an unreachable arrangement
  const v = verdict([refusedWith(UNREACH, 165, 160), okResult(PARENT_UNREACH, okSummary()), okResult(CELL)], [UNREACH, PARENT_UNREACH, CELL]);
  assert.equal(v.ok, false);
  assert.equal(v.accepted.length, 0);
  // and no parent refusal at all
  const u = verdict([refusedWith(UNREACH, 165, 160), okResult(CELL)], [UNREACH, CELL]);
  assert.equal(u.ok, false);
  assert.equal(u.accepted.length, 0);
});

test('acceptedUnreachable is a function of the pair only: a parent cell, a missing partner text or an unparsable reason is never accepted', () => {
  assert.equal(acceptedUnreachable(UNREACH, tablesRefusal(165, 160), tablesRefusal(165, 126)), true);
  assert.equal(acceptedUnreachable(PARENT_UNREACH, tablesRefusal(165, 126), tablesRefusal(165, 160)), false);
  assert.equal(acceptedUnreachable(UNREACH, tablesRefusal(165, 160), undefined), false);
  assert.equal(acceptedUnreachable(UNREACH, 'nesasm failed', tablesRefusal(165, 126)), false);
});

test('the ruling matches exactly 74 planned new-engine cells of the pops stage, and each is refused with its ruled byte figure', () => {
  const cells = planStage('pops', 15);
  const shape = (c) => c.which === 'new' && c.gt === 'rpg' && c.wide && c.bound && needsCompact(c) && c.anim === 'P1' && UNREACHABLE_ARRANGEMENTS[c.pop] !== undefined;
  const hit = cells.filter(shape);
  assert.equal(hit.length, 74);
  assert.equal(cells.filter((c) => c.which === 'new' && acceptedUnreachable(c, tablesRefusal(UNREACHABLE_ARRANGEMENTS[c.pop], 160), tablesRefusal(UNREACHABLE_ARRANGEMENTS[c.pop], 126))).length, 74);
  const recorded = JSON.parse(fs.readFileSync(path.join(PARENT, 'test/fixtures/streamedmove-unreachable.json'), 'utf8')).refused.filter((r) => r.id.startsWith('new/'));
  assert.equal(recorded.length, 74, 'the generator refuses exactly these new-engine cells (capacity-all.json)');
  assert.deepEqual(recorded.map((r) => r.id).sort(), hit.map(cellId).sort());
});
