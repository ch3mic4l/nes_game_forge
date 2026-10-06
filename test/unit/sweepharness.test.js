// The sweep harness itself (test/lua/sw_bound_sweep.mjs, run_sw_manifest.mjs, sw_provenance.mjs): phase 3a slice S1, follow-up 4, the
// findings of the pre-launch harness review. Nothing here measures anything: the runners are injected stubs, or a FAKE Mesen (a shell
// script that prints a PHASE/DONE report and counts its invocations), so these tests run in seconds and prove the harness's own rules:
//   F1  one confirmation predicate shared by fresh search, resume and agg; exhaustion is a failure the CLI honours
//   F2  a candidate-n failure stops the stage; an operational error is distinct, retried a bounded number of times, never first-result-wins
//   F3  provenance binds: sources are re-read fresh, a live edit aborts, agg compares harness/generator/Mesen/engine with the files now,
//       every input record is validated before any deduplication
//   F5  the bound-tile curve's one tile is authored as row 0 / col 0 and checked by its normalized coordinates
//   duplicate-skipping: a measurement is reused only when every component of its key is equal; a confirmation never reuses
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  runAll, runF, runJob, manifestArgs, mkJob, relationProblems, confirmationProblems, loadResume, groupRows, validateRows, buildRecord, buildRecordFromRows, aggregate, isBad, genuineFailure, isCandidateFailure, makeProvenance, MAX_ATTEMPTS, stageF, plan
} from '../lua/sw_bound_sweep.mjs';
import {
  harnessHash, generatorHash, engineHash, processProvenance, mesenHash, sourceDifferences, assertSameSources, SourceChangedError, measurementKey, EXEC_FLAGS, MeasurementCache, HARNESS_FILES, UNIFORM_FIELDS
} from '../lua/sw_provenance.mjs';
import { runManifest, GATE, IDLE_REG, CONTACT_IDLE_REG, parseOutput, contactEndpointProblems } from '../lua/run_sw_manifest.mjs';
import { buildSceneProject } from '../lua/sw_manifest_scene.mjs';
import { makeMutate, shapes, BOUND_TILE } from '../lua/sw_sweep_mutate.mjs';
import { ANIM_PRESETS } from '../lua/sw_bound_sweep.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
const CURRENT = { engine: sha('engine'), harness: sha('harness'), generator: sha('generator'), mesen: sha('mesen') };
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sw-harness-'));
const quiet = async (f) => { const e = console.error; console.error = () => {}; try { return await f(); } finally { console.error = e; } };
const readRows = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const write = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));

// a result for `job`: passing, or failing the gate (maxG over GATE, one failing frame), carrying the provenance of CURRENT
const ok = (job, over = {}) => ({
  ...job, done: true, timeout: false, status: 0, frames: 643, timing: { buildMs: 50, mesenMs: 3900 },
  prov: { ...CURRENT, project: sha(`p${job.confirmOf ?? job.id}`), rom: sha(`r${job.confirmOf ?? job.id}`) },
  cacheKey: sha(`k${job.confirmOf ?? job.id}`), phases: { walkD: { maxG: 27000, gateFail: 0, n: 240 } }, ...over
});
const bad = (job, over = {}) => ok(job, { phases: { walkD: { maxG: GATE + 1500, gateFail: 1, n: 240 } }, ...over });
const bJob = (i, over = {}) => ({ ...mkJob({ stage: 'B', sizes: shapes(16).even, wide: false, anim: 'P1', y: 200 + i, k: 0, shape: 'even' }), ...over });
const fJob = (i, curve = 'plain') => ({ ...mkJob({ stage: 'F', sizes: shapes(curve === 'plain' ? 17 : 16).even, wide: true, anim: 'P8', y: 200 + i, k: 7, shape: 'even', bound: curve === 'bound' }), curve, order: i });
const opts = { provenance: () => CURRENT, log: () => {} };

// ---------------------------------------------------------------------------------------------------------------------------------
// F1: one confirmation predicate
test('F1: confirmationProblems accepts a genuine, matching confirmation and refuses every way a confirmation can be wrong', () => {
  const o = bad(fJob(0));
  const c = bad({ ...fJob(0), id: `${o.id}#confirm`, confirmOf: o.id });
  assert.deepEqual(confirmationProblems(o, c), []);
  const refused = (what, orig, conf, re) => assert.ok(confirmationProblems(orig, conf).some((m) => re.test(m)), `${what}: ${JSON.stringify(confirmationProblems(orig, conf))}`);
  refused('a changed project hash', o, { ...c, prov: { ...c.prov, project: sha('other project') } }, /project hash differs/);
  refused('a changed ROM hash', o, { ...c, prov: { ...c.prov, rom: sha('other rom') } }, /ROM hash differs/);
  for (const f of UNIFORM_FIELDS) refused(`a changed ${f}`, o, { ...c, prov: { ...c.prov, [f]: sha(`other ${f}`) } }, new RegExp(`provenance differs.*${f}`));
  refused('a confirmation that passes the gate', o, ok({ ...fJob(0), id: `${o.id}#confirm`, confirmOf: o.id }), /confirmation is not a genuine gate failure/);
  refused('a confirmation whose process failed', o, { ...c, status: 1 }, /confirmation is not a valid measurement/);
  refused('a confirmation that is an error', o, { ...c, error: 'mesen died', phases: undefined }, /confirmation is not a valid measurement/);
  refused('a timed-out confirmation', o, { ...c, timeout: true }, /not a valid measurement/);
  refused('an unfinished confirmation', o, { ...c, done: false }, /not a valid measurement/);
  refused('an absent original', undefined, c, /no original record/);
  refused('an absent confirmation', o, undefined, /no confirming record/);
  refused('an original that is an error row', { ...o, error: 'x', phases: undefined }, c, /original is not a valid measurement/);
  refused('an original that passes', ok(fJob(0)), c, /original is not a genuine gate failure/);
  refused('a gate field that contradicts maxG (gateFail with maxG at the gate)', { ...o, phases: { walkD: { maxG: GATE, gateFail: 1, n: 240 } } }, c, /not a valid measurement/);
  refused('a failing frame hidden behind gateFail 0', { ...o, phases: { walkD: { maxG: GATE + 1, gateFail: 0, n: 240 } } }, c, /not a valid measurement/);
  refused('another job (n)', o, { ...c, n: 18 }, /job configuration/);
  refused('another job (curve)', o, { ...c, curve: 'bound' }, /job configuration/);
  refused('another job (y)', o, { ...c, y: 1 }, /job configuration/);
  refused('another original id', o, { ...c, confirmOf: 'someone-else' }, /not the re-run of this original/);
  refused('a reuse standing in for the isolated re-run', o, { ...c, reuse: { of: o.id, key: c.cacheKey } }, /not a reuse/);
  refused('a record without provenance', o, { ...c, prov: undefined }, /no provenance block/);
  refused('a malformed hash', o, { ...c, prov: { ...c.prov, rom: 'abc' } }, /provenance.rom is missing/);
});

test('F1: agg counts a confirmation only when the SAME predicate accepts it (the reviewer\'s mismatched-ROM case, and a changed engine or harness)', () => {
  const o = bad(fJob(0));
  const conf = (over) => ({ ...bad({ ...fJob(0), id: `${o.id}#confirm`, confirmOf: o.id }), ...over });
  const confirmed = (c) => aggregate([o, c]).rows.reduce((a, r) => a + r.confirmed, 0);
  assert.equal(confirmed(conf({})), 1);
  assert.equal(confirmed(conf({ prov: { ...o.prov, rom: sha('different') } })), 0);
  assert.equal(confirmed(conf({ prov: { ...o.prov, project: sha('different') } })), 0);
  assert.equal(confirmed(conf({ prov: { ...o.prov, harness: sha('different') } })), 0, 'the old agg check ignored every field but project and ROM');
  assert.equal(confirmed(conf({ prov: { ...o.prov, engine: sha('different') } })), 0);
  assert.equal(confirmed(conf({ status: 2 })), 0);
  assert.equal(aggregate([o]).rows.reduce((a, r) => a + r.confirmed, 0), 0, 'no confirmation record at all');
});

test('F1: runF -- a rejected confirmation does not end the search, resume does not trust it, and a failed-process confirmation is re-run', async () => {
  const dir = tmpdir();
  try {
    const jobs = [0, 1, 2].map((i) => fJob(i));
    const jf = path.join(dir, 'jobs.jsonl'); write(jf, jobs);
    const out = path.join(dir, 'mismatch.jsonl'); const ran = [];
    // every confirmation comes back on another ROM and project (the reviewer's control)
    const run = async (j) => { ran.push(j.id); return bad(j, j.confirmOf ? { prov: { ...CURRENT, project: sha('different project'), rom: sha('different rom') } } : {}); };
    const res = await runF(jf, out, 1, run, opts);
    assert.equal(res.curves.plain.status, 'exhausted', 'no accepted confirmation: the curve is exhausted, not confirmed');
    assert.deepEqual(ran.filter((id) => !id.endsWith('#confirm')), jobs.map((j) => j.id), 'the search went on past every mismatched confirmation');
    assert.equal(res.curves.plain.rejected.length, 3);
    assert.equal(aggregate(readRows(out)).rows.reduce((a, r) => a + r.confirmed, 0), 0);
    // resume: the mismatched confirmations are on file, so nothing is re-run and nothing is "already confirmed"
    const before = ran.length;
    const again = await runF(jf, out, 1, run, opts);
    assert.equal(ran.length, before); assert.equal(again.curves.plain.status, 'exhausted');
    // a confirmation whose process failed is an operational error: re-run on resume, replaced (one record per id), never "already confirmed"
    const out2 = path.join(dir, 'failed-confirm.jsonl');
    write(out2, [bad(jobs[0]), bad({ ...jobs[0], id: `${jobs[0].id}#confirm`, confirmOf: jobs[0].id }, { status: 1 })]);
    const ran2 = [];
    const res2 = await runF(jf, out2, 1, async (j) => { ran2.push(j.id); return bad(j); }, opts);
    assert.deepEqual(ran2, [`${jobs[0].id}#confirm`], 'the failed confirmation was re-run (the original row was reusable and was not)');
    assert.equal(res2.curves.plain.status, 'confirmed');
    const rows = readRows(out2);
    assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'one record per id');
    assert.equal(rows.find((r) => r.id.endsWith('#confirm')).attempt, 2);
    assert.equal(readRows(`${out2}.superseded.jsonl`).length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F1: runF -- an absent original or a bad confirmation row on file is never "already confirmed"; operational errors are reported, not counted as candidates', async () => {
  const dir = tmpdir();
  try {
    const jobs = [0, 1, 2].map((i) => fJob(i));
    const jf = path.join(dir, 'jobs.jsonl'); write(jf, jobs);
    // a confirmation row on file whose original is absent from it
    const out = path.join(dir, 'orphan.jsonl');
    write(out, [bad({ ...jobs[1], id: `${jobs[1].id}#confirm`, confirmOf: jobs[1].id })]);
    const ran = [];
    const res = await runF(jf, out, 1, async (j) => { ran.push(j.id); return ok(j); }, opts);
    assert.equal(res.curves.plain.status, 'exhausted'); assert.equal(ran.length, 3, 'all three candidates ran: the orphan confirmation did not end the search');
    assert.equal(readRows(`${out}.superseded.jsonl`).length, 1, 'the orphan confirmation was set aside');
    // errors: an operational error is reported, does not count as a candidate, and does not confirm anything
    const out2 = path.join(dir, 'errors.jsonl');
    const res2 = await runF(jf, out2, 1, async (j) => (j.id === jobs[1].id ? { ...j, error: 'mesen crashed' } : ok(j)), opts);
    assert.equal(res2.curves.plain.candidates, 2, 'three planned, one an operational error');
    assert.deepEqual(res2.curves.plain.errors, [jobs[1].id]);
    assert.equal(res2.curves.plain.status, 'errors', 'an unconfirmed curve with an operational error is not an exhaustion');
    assert.equal(res2.status, 'errors');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------------------------
// the CLI, against a fake Mesen (which, like the real contact endpoint, prints the CONTACT marker only for a script that carries the endpoint)
const FAKE = (dir, { fail = false, exitCode = 0, name = 'fake-mesen', dieFromRun = 0 } = {}) => {
  const f = path.join(dir, name); const count = path.join(dir, `${name}.count`);
  fs.writeFileSync(f, `#!/bin/sh\necho run >> ${count}\n${dieFromRun ? `if [ $(wc -l < ${count}) -ge ${dieFromRun} ]; then exit 7; fi\n` : ''}${exitCode ? '' : `echo "PHASE walkD n=240 maxG=${fail ? GATE + 1500 : 27000} maxMain=1 maxIntr=1 maxRel=1 overruns=0 gateFail=${fail ? 1 : 0} maxOam=1 maxPlusMax=2 guards=0 bigN=0 bigAdv=0"\nfor a in "$@"; do case "$a" in *.lua) L="$a";; esac; done\nF=643\nif grep -q contactPhase "$L"; then F=580; echo "CONTACT frame=580 phase=walkD"; fi\necho "DONE frames=$F"\n`}exit ${exitCode}\n`);
  fs.chmodSync(f, 0o755);
  return { path: f, runs: () => (fs.existsSync(count) ? fs.readFileSync(count, 'utf8').split('\n').filter(Boolean).length : 0) };
};
const cli = (args) => spawnSync(process.execPath, [path.join(ROOT, 'test/lua/sw_bound_sweep.mjs'), ...args], { encoding: 'utf8', timeout: 300000 });

test('F1: the CLI exits non-zero when a curve is exhausted (runF), and 0 when both curves are confirmed', () => {
  const dir = tmpdir();
  try {
    const jobs = [fJob(0, 'plain'), fJob(0, 'bound')];
    const jf = path.join(dir, 'jobs.jsonl'); write(jf, jobs);
    const pass = FAKE(dir, { name: 'pass' });
    const r = cli(['runF', jf, path.join(dir, 'out.jsonl'), '--procs=2', `--mesen=${pass.path}`]);
    assert.equal(r.status, 4, `exhausted must exit 4: ${r.stderr.slice(-400)}`);
    assert.match(r.stderr, /EXHAUSTED/);
    const fail = FAKE(dir, { name: 'fail', fail: true });
    const out2 = path.join(dir, 'out2.jsonl');
    const r2 = cli(['runF', jf, out2, '--procs=2', `--mesen=${fail.path}`]);
    assert.equal(r2.status, 0, r2.stderr.slice(-400));
    // the isolated confirmation always ran Mesen again: 2 originals + 2 confirmations, and neither confirmation is a reuse
    assert.equal(fail.runs(), 4);
    assert.ok(readRows(out2).filter((x) => x.confirmOf).every((x) => !x.reuse && x.timing.mesenMs > 0));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------------------------
// F2: stop on candidate-n failure; resume is honest
test('F2: runAll stops scheduling at a candidate-n failure (the reviewer\'s stub: candidate0 fails, candidate1 and candidate2 are not scheduled)', async () => {
  const dir = tmpdir();
  try {
    const jobs = [0, 1, 2].map((i) => bJob(i));
    const jf = path.join(dir, 'jobs.jsonl'); write(jf, jobs);
    const out = path.join(dir, 'out.jsonl'); const ran = [];
    const run = async (j) => { ran.push(j.id); return bad(j); };
    const res = await runAll(jf, out, 1, run, opts);
    assert.deepEqual(ran, [jobs[0].id], 'candidate1 and candidate2 were never scheduled');
    assert.equal(res.status, 'candidate-failed'); assert.deepEqual(res.candidateFailures, [jobs[0].id]);
    assert.deepEqual(readRows(out).map((r) => r.id), [jobs[0].id], 'the failing result is preserved');
    // a resume does not carry on past it either: the stop stands until the bound is re-ruled
    const again = await runAll(jf, out, 1, run, opts);
    assert.equal(again.status, 'candidate-failed'); assert.equal(ran.length, 1);
    // running jobs may finish: with two workers the second job, already running, completes and is recorded; the third is never started
    const out2 = path.join(dir, 'out2.jsonl'); const started = [];
    const res2 = await runAll(jf, out2, 2, async (j) => { started.push(j.id); if (j === jobs[0] || j.id === jobs[0].id) return bad(j); await new Promise((r) => setTimeout(r, 40)); return ok(j); }, opts);
    assert.equal(res2.status, 'candidate-failed');
    assert.ok(!started.includes(jobs[2].id)); assert.deepEqual(readRows(out2).map((r) => r.id).sort(), [jobs[0].id, jobs[1].id].sort());
    // a failure that is NOT at a candidate n (stage F's n+1) or not in a clean stage does not stop a run
    const f = fJob(0); assert.equal(isCandidateFailure(bad(f)), false);
    assert.equal(isCandidateFailure(bad(bJob(9))), true);
    assert.equal(isCandidateFailure(bad(bJob(9, { stage: 'S' }))), false);
    assert.equal(isCandidateFailure(ok(bJob(9))), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F2: an operational error is distinct from a gate failure: recorded, retried on resume under a bounded policy, never two records for one id', async () => {
  const dir = tmpdir();
  try {
    const jobs = [0, 1, 2].map((i) => bJob(i));
    const jf = path.join(dir, 'jobs.jsonl'); write(jf, jobs);
    const out = path.join(dir, 'out.jsonl');
    // run 1: job 0 errors; the stage does not stop (an error is not a candidate failure), and its status says errors
    const res = await runAll(jf, out, 1, async (j) => (j.id === jobs[0].id ? { ...j, error: 'transient build failure' } : ok(j)), opts);
    assert.equal(res.status, 'errors'); assert.deepEqual(res.errors, [jobs[0].id]); assert.equal(readRows(out).length, 3);
    // run 2 (resume): ONLY the errored job is run again; its error row is superseded, and the file holds one record per id
    const ran = [];
    const res2 = await runAll(jf, out, 1, async (j) => { ran.push(j.id); return ok(j); }, opts);
    assert.deepEqual(ran, [jobs[0].id], 'the errored row is re-run, the good ones are not');
    assert.equal(res2.status, 'ok');
    const rows = readRows(out);
    assert.equal(rows.length, 3); assert.equal(new Set(rows.map((r) => r.id)).size, 3, 'no ambiguous first-result-wins duplicate');
    assert.equal(rows.find((r) => r.id === jobs[0].id).attempt, 2); assert.equal(rows.find((r) => r.id === jobs[0].id).error, undefined);
    const side = readRows(`${out}.superseded.jsonl`);
    assert.equal(side.length, 1); assert.match(side[0].error, /transient/); assert.match(side[0].supersededBecause, /operational error, attempt 1/);
    // the policy is bounded: MAX_ATTEMPTS attempts in all, then it stays failed, is reported, and is not run again
    const out3 = path.join(dir, 'out3.jsonl'); let calls = 0;
    const alwaysError = async (j) => { calls++; return { ...j, error: 'persistent' }; };
    await runAll(jf, out3, 1, alwaysError, opts);
    for (let a = 2; a <= MAX_ATTEMPTS; a++) await runAll(jf, out3, 1, alwaysError, opts);
    const callsAtLimit = calls;
    const last = await runAll(jf, out3, 1, alwaysError, opts);
    assert.equal(calls, callsAtLimit, `after ${MAX_ATTEMPTS} attempts nothing is retried`);
    assert.equal(last.status, 'errors'); assert.equal(last.permanent.length, 3);
    assert.ok(readRows(out3).every((r) => r.attempt === MAX_ATTEMPTS));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F2: resume reuses only successful, validated results of the same job and provenance (a mismatched row is refused and re-run; conflicting duplicates are refused outright)', async () => {
  const dir = tmpdir();
  try {
    const jobs = [0, 1, 2, 3].map((i) => bJob(i));
    const jf = path.join(dir, 'jobs.jsonl'); write(jf, jobs);
    const out = path.join(dir, 'out.jsonl');
    write(out, [
      ok(jobs[0]), // good
      ok(jobs[1], { prov: { ...ok(jobs[1]).prov, harness: sha('an older harness') } }), // another source state
      ok(jobs[2], { sizes: shapes(16).front }), // the same id but not the same job
      ok(jobs[3], { status: 1 }) // a failed process
    ]);
    const ran = [];
    const res = await runAll(jf, out, 2, async (j) => { ran.push(j.id); return ok(j); }, opts);
    assert.deepEqual(ran.sort(), [jobs[1].id, jobs[2].id, jobs[3].id].sort(), 'only the good, same-provenance row was kept');
    assert.equal(res.dropped, 3); assert.equal(res.status, 'ok');
    const rows = readRows(out);
    assert.equal(rows.length, 4); assert.equal(new Set(rows.map((r) => r.id)).size, 4);
    assert.ok(rows.every((r) => sourceDifferences(r.prov, CURRENT).length === 0));
    const side = readRows(`${out}.superseded.jsonl`).map((r) => r.supersededBecause);
    assert.equal(side.length, 3); assert.ok(side.some((m) => /stale/.test(m)));
    // two records for one id that disagree: refused outright (no first-result-wins)
    const dup = path.join(dir, 'dup.jsonl');
    write(dup, [ok(jobs[0]), ok(jobs[0], { phases: { walkD: { maxG: 20000, gateFail: 0, n: 240 } } })]);
    await assert.rejects(runAll(jf, dup, 1, async (j) => ok(j), opts), /recorded more than once with different/);
    // while identical repeats are one record
    write(dup, [ok(jobs[0]), ok(jobs[0])]);
    assert.doesNotThrow(() => groupRows(readRows(dup)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F2: the CLI stops a real run at a candidate-n failure with exit 1 (only candidate0 recorded); an operational error exits 3 and a resume re-runs exactly it', () => {
  const dir = tmpdir();
  try {
    const jobs = [0, 1, 2].map((i) => bJob(i));
    const jf = path.join(dir, 'jobs.jsonl'); write(jf, jobs);
    const fail = FAKE(dir, { name: 'fail', fail: true });
    const out = path.join(dir, 'out.jsonl');
    const r = cli(['run', jf, out, '--procs=1', `--mesen=${fail.path}`]);
    assert.equal(r.status, 1, r.stderr.slice(-500));
    assert.equal(readRows(out).length, 1); assert.equal(fail.runs(), 1, 'Mesen was started once: candidate1 and candidate2 were never scheduled');
    // operational errors: the fake Mesen dies without a report
    const dead = FAKE(dir, { name: 'dead', exitCode: 7 });
    const out2 = path.join(dir, 'out2.jsonl');
    const r2 = cli(['run', jf, out2, '--procs=3', `--mesen=${dead.path}`]);
    assert.equal(r2.status, 3, r2.stderr.slice(-500));
    assert.equal(readRows(out2).length, 3); assert.ok(readRows(out2).every((x) => isBad(x)));
    const good = FAKE(dir, { name: 'good' });
    const r3 = cli(['run', jf, out2, '--procs=3', `--mesen=${good.path}`]);
    assert.equal(r3.status, 0, r3.stderr.slice(-500));
    const rows = readRows(out2);
    assert.equal(rows.length, 3); assert.ok(rows.every((x) => !isBad(x) && x.attempt === 2)); assert.equal(readRows(`${out2}.superseded.jsonl`).length, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------------------------
// F3: provenance that binds
const scratchTree = () => {
  const tmp = tmpdir();
  for (const sub of ['engine', 'main/build', 'shared']) fs.cpSync(path.join(ROOT, sub), path.join(tmp, sub), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'test/lua'), { recursive: true });
  for (const f of HARNESS_FILES) fs.copyFileSync(path.join(ROOT, 'test/lua', f), path.join(tmp, 'test/lua', f));
  const mesen = path.join(tmp, 'mesen'); fs.writeFileSync(mesen, 'a stand-in for the emulator');
  return { tmp, mesen };
};

test('F3a: the source hashes are read FRESH every time (a live edit changes the next hash; nothing is cached for the life of the process)', () => {
  const { tmp, mesen } = scratchTree();
  try {
    const before = processProvenance(tmp, mesen, { harnessRoot: tmp });
    fs.appendFileSync(path.join(tmp, 'test/lua/sw_manifest.lua.template'), '\n-- a live harness edit\n');
    fs.appendFileSync(path.join(tmp, 'shared/streambound.js'), '\n// a live generator edit\n');
    fs.appendFileSync(path.join(tmp, 'engine/main.asm'), '\n    nop ; a live engine edit\n');
    const after = processProvenance(tmp, mesen, { harnessRoot: tmp });
    assert.notEqual(after.harness, before.harness); assert.notEqual(after.generator, before.generator); assert.notEqual(after.engine, before.engine);
    assert.equal(after.mesen, before.mesen);
    assert.deepEqual(sourceDifferences(before, after), ['engine', 'harness', 'generator']);
    assert.throws(() => assertSameSources(before, after, 'during the stage'), (e) => e instanceof SourceChangedError && /engine .*harness .*generator|harness/.test(e.message));
    fs.writeFileSync(mesen, 'a different emulator');
    assert.notEqual(mesenHash(mesen), before.mesen, 'a changed Mesen file is noticed (size/mtime keyed)');
    // the shipped helpers agree with each other and with a direct hash of the repository
    assert.equal(harnessHash(ROOT), harnessHash()); assert.equal(generatorHash(ROOT), generatorHash()); assert.equal(engineHash(ROOT), engineHash());
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('F3a: a live edit mid-stage aborts the stage with SourceChangedError; the job it hit leaves no record and nothing further is scheduled', async () => {
  const { tmp, mesen } = scratchTree();
  const dir = tmpdir();
  try {
    const jobs = [0, 1, 2, 3].map((i) => bJob(i));
    const jf = path.join(dir, 'jobs.jsonl'); write(jf, jobs);
    const out = path.join(dir, 'out.jsonl');
    const provenance = makeProvenance({ root: tmp, mesen, harnessRoot: tmp });
    const stage = provenance(true);
    const ran = [];
    const run = async (j) => {
      ran.push(j.id);
      if (j.id === jobs[1].id) fs.appendFileSync(path.join(tmp, 'test/lua/sw_sweep_mutate.mjs'), '\n// edited while job 1 was running\n');
      return { ...ok(j), prov: { ...ok(j).prov, ...stage } };
    };
    await assert.rejects(runAll(jf, out, 1, run, { provenance, log: () => {} }), (e) => e instanceof SourceChangedError && /harness/.test(e.message));
    assert.deepEqual(ran, [jobs[0].id, jobs[1].id], 'job 2 and 3 were not scheduled');
    assert.deepEqual(readRows(out).map((r) => r.id), [jobs[0].id], 'job 1 ran against changed sources: no record');
    // the same for stage F
    const out2 = path.join(dir, 'out2.jsonl');
    const fjobs = [0, 1, 2].map((i) => fJob(i)); const jf2 = path.join(dir, 'jobsF.jsonl'); write(jf2, fjobs);
    const provenance2 = makeProvenance({ root: tmp, mesen, harnessRoot: tmp });
    await assert.rejects(runF(jf2, out2, 1, async (j) => { fs.appendFileSync(path.join(tmp, 'shared/streambound.js'), '\n// edited again\n'); return ok(j); }, { provenance: provenance2, log: () => {} }), SourceChangedError);
    assert.equal(readRows(out2).length, 0);
    // runManifest checks the stage's state before it builds anything
    await assert.rejects(runManifest({ expect: { ...CURRENT }, mesen: path.join(ROOT, 'test/lua/sw_provenance.mjs') }), (e) => e instanceof SourceChangedError);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F3b: agg compares the recorded engine, harness, generator and Mesen with the files NOW (a uniform record from an older harness or generator is refused)', () => {
  const rows = [0, 1, 2].map((i) => ok(bJob(i), { prov: { ...ok(bJob(i)).prov, engine: engineHash(ROOT) } }));
  const here = { engine: engineHash(ROOT), harness: rows[0].prov.harness, generator: rows[0].prov.generator, mesen: rows[0].prov.mesen };
  assert.doesNotThrow(() => buildRecordFromRows(rows, { current: here }));
  for (const f of ['harness', 'generator', 'mesen']) assert.throws(() => buildRecordFromRows(rows, { current: { ...here, [f]: sha(`now ${f}`) } }), new RegExp(`REFUSED.*other sources.*${f}`), `${f}: a record uniformly from an older ${f}`);
  assert.throws(() => buildRecordFromRows(rows, { current: { ...here, engine: sha('now engine') } }), /REFUSED.*engine/);
  // with no `current` given the real files are read (fresh): synthetic hashes are of course not what the files are
  assert.throws(() => buildRecordFromRows(rows), /REFUSED/);
  // and a Mesen that cannot be read refuses rather than skipping the check
  assert.throws(() => buildRecordFromRows(rows, { mesen: '/nonexistent/mesen' }), /REFUSED: cannot read the current sources/);
});

test('F3c: every input record is validated before deduplication; repeated ids must agree, or agg refuses (the reviewer\'s two-file duplicate case)', () => {
  const dir = tmpdir();
  try {
    const j = bJob(0);
    const r = ok(j, { prov: { ...ok(j).prov, engine: engineHash(ROOT) } });
    const files = [path.join(dir, 'a.jsonl'), path.join(dir, 'b.jsonl')];
    const current = { ...r.prov }; delete current.project; delete current.rom;
    write(files[0], [r]);
    // identical repeats are one record
    write(files[1], [r]);
    assert.equal(buildRecord(files, { current }).jobs, 1);
    // another harness, another ROM -- the reviewer's case
    write(files[1], [{ ...r, prov: { ...r.prov, harness: sha('new harness'), rom: sha('different rom') } }]);
    assert.throws(() => buildRecord(files, { current }), /recorded more than once with different/);
    // each component on its own
    for (const [what, other] of [['project', { prov: { ...r.prov, project: sha('x') } }], ['ROM', { prov: { ...r.prov, rom: sha('x') } }], ['generator', { prov: { ...r.prov, generator: sha('x') } }], ['configuration', { sizes: shapes(16).front }], ['measurement', { phases: { walkD: { maxG: 20000, gateFail: 0, n: 240 } } }], ['frames', { frames: 600 }]]) {
      write(files[1], [{ ...r, ...other }]);
      assert.throws(() => buildRecord(files, { current }), /recorded more than once with different/, `${what} differs between the two records`);
    }
    // an invalid second copy is not hidden behind a good first one
    write(files[1], [{ ...r, prov: undefined }]);
    assert.throws(() => buildRecord(files, { current }), /REFUSED/);
    write(files[1], [{ ...r, error: 'x', phases: undefined }]);
    assert.throws(() => buildRecord(files, { current }), /REFUSED/);
    // a confirmation whose original is absent
    write(files[1], [bad({ ...fJob(3), id: 'orphan#confirm', confirmOf: 'orphan' })]);
    assert.throws(() => buildRecord(files, { current }), /original orphan is absent/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------------------------
// F5: the bound-tile curve's one tile
test('F5: the bound-tile curve\'s one tile is authored as row 0, col 0, switch 0, metatile 2 and checked by its NORMALIZED coordinates', async () => {
  const j = plan('B').find((x) => x.bound && x.gt === 'action');
  const build = (mutate) => buildSceneProject({ gt: j.gt, sizes: j.sizes, wide: j.wide, anim: ANIM_PRESETS[j.anim], flashAt: [j.flashX, j.y ?? 234], gridH: j.gridH, mutate });
  const { project } = await build(makeMutate(structuredClone(j.cfg)));
  const tiles = project.maps.flatMap((m, mi) => m.screens.flatMap((s, si) => s.boundTiles.map((b) => ({ mi, si, ...b }))));
  assert.deepEqual(tiles, [{ mi: 1, si: 0, switchId: 0, row: 0, col: 0, metatileId: 2 }], 'exactly one bound tile, on the ordinary second map, at (0,0)');
  assert.deepEqual(BOUND_TILE, { switchId: 0, row: 0, col: 0, metatileId: 2 });
  const src = fs.readFileSync(path.join(ROOT, 'test/lua/sw_sweep_mutate.mjs'), 'utf8');
  assert.ok(!/cell:\s*5/.test(src.replace(/\/\/.*$/gm, '')), 'the ignored `cell: 5` spelling is gone from the code');
  // the independent assertion fires: a scene that means another cell, or meant no bound tile, is refused
  const m = makeMutate(structuredClone(j.cfg));
  await assert.rejects(build((p, c) => ({ ...m(p, c), boundTile: { ...BOUND_TILE, row: 1 } })), /the bound tile is .* wanted exactly/);
  await assert.rejects(build((p, c) => ({ ...m(p, c), boundTile: null })), /unexpected bound tiles/);
  await assert.rejects(build((p, c) => { const r = m(p, c); p.maps[1].screens[0].boundTiles = [{ switchId: 0, row: 2, col: 3, metatileId: 2 }]; return r; }), /the bound tile is .* wanted exactly/);
  // a plain-curve scene carries none
  const plain = plan('B').find((x) => !x.bound && x.gt === 'action');
  const pp = await buildSceneProject({ gt: plain.gt, sizes: plain.sizes, wide: plain.wide, anim: ANIM_PRESETS[plain.anim], flashAt: [plain.flashX, plain.y ?? 234], mutate: makeMutate(structuredClone(plain.cfg)) });
  assert.equal(pp.project.maps.flatMap((mm) => mm.screens.flatMap((s) => s.boundTiles)).length, 0);
  assert.match((await import('../lua/sw_bound_sweep.mjs')).SAMPLING.join(' '), /one bound tile: row 0, col 0, switch 0/);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// duplicate-skipping
test('DEDUP: the measurement key changes with ANY one component (project, ROM, rendered script, engine, harness, generator, Mesen, flags) and with none of the others', () => {
  const base = { project: sha('p'), rom: sha('r'), lua: sha('l'), prov: { ...CURRENT }, flags: EXEC_FLAGS };
  const key = measurementKey(base);
  assert.equal(measurementKey({ ...base, prov: { ...base.prov, project: sha('ignored'), rom: sha('ignored') } }), key, 'prov.project/rom are the key\'s own components, not read twice');
  const changes = { project: sha('p2'), rom: sha('r2'), lua: sha('l2'), flags: { ...EXEC_FLAGS, killMs: EXEC_FLAGS.killMs + 1 } };
  for (const [c, v] of Object.entries(changes)) assert.notEqual(measurementKey({ ...base, [c]: v }), key, `${c} changed`);
  assert.notEqual(measurementKey({ ...base, flags: { ...EXEC_FLAGS, args: [...EXEC_FLAGS.args, '--x'] } }), key, 'an execution flag changed');
  for (const f of UNIFORM_FIELDS) assert.notEqual(measurementKey({ ...base, prov: { ...base.prov, [f]: sha(`other ${f}`) } }), key, `${f} changed`);
});

test('DEDUP: MeasurementCache hands a finished measurement to a second job, defers an in-flight one, and releases a failed claim', async () => {
  const c = new MeasurementCache();
  const a = await c.acquire('k');
  assert.equal(a.hit, false);
  assert.deepEqual(await c.acquire('k', { wait: false }), { hit: false, pending: true });
  const waiter = c.acquire('k');
  a.publish({ jobId: 'first', measurement: { phases: {} } });
  assert.equal((await waiter).hit, true); assert.equal((await c.acquire('k')).value.jobId, 'first');
  const f = await c.acquire('k2'); f.fail();
  assert.equal((await c.acquire('k2')).hit, false, 'a failed measurement is not reusable: the next job takes the claim');
  c.seed('k3', { jobId: 'disk' });
  assert.equal((await c.acquire('k3')).value.jobId, 'disk');
});

test('DEDUP: through the runner and a fake Mesen -- an identical project+ROM+script is measured once and reused (one record per planned id, both labelled); any one component different is measured again', async () => {
  const dir = tmpdir();
  try {
    // even and scatter are the same sizes at plain n=16: the same project, ROM and script; `front` is a different ROM; `idle` changes the rendered script only
    const same = (shape, over = {}) => mkJob({ stage: 'B', sizes: shapes(16)[shape], wide: false, anim: 'P1', y: 216, k: 0, shape, ...over });
    const jobs = [same('even'), same('scatter'), same('front'), same('even', { idle: 30 })];
    assert.deepEqual(shapes(16).even, shapes(16).scatter, 'the premise: even == scatter at n=16');
    const jf = path.join(dir, 'jobs.jsonl'); write(jf, jobs);
    const fake = FAKE(dir, { name: 'm' });
    const out = path.join(dir, 'out.jsonl');
    const r = cli(['run', jf, out, '--procs=1', `--mesen=${fake.path}`]);
    assert.equal(r.status, 0, r.stderr.slice(-500));
    const rows = readRows(out);
    assert.equal(rows.length, 4, 'one logical record per planned id');
    assert.equal(fake.runs(), 3, 'Mesen ran for 3 of the 4: scatter was reused');
    const byId = new Map(rows.map((x) => [x.id, x]));
    const even = byId.get(jobs[0].id); const scatter = byId.get(jobs[1].id);
    assert.equal(even.reuse, undefined); assert.deepEqual(scatter.reuse, { of: even.id, key: even.cacheKey });
    assert.deepEqual(scatter.phases, even.phases); assert.equal(scatter.prov.project, even.prov.project); assert.equal(scatter.prov.rom, even.prov.rom); assert.equal(scatter.cacheKey, even.cacheKey);
    assert.equal(scatter.shape, 'scatter', 'its own labels are kept (coverage is never erased)'); assert.equal(scatter.timing.mesenMs, 0);
    for (const id of [jobs[2].id, jobs[3].id]) { assert.equal(byId.get(id).reuse, undefined, `${id} was measured`); assert.notEqual(byId.get(id).cacheKey, even.cacheKey); }
    assert.notEqual(byId.get(jobs[2].id).prov.rom, even.prov.rom, 'front: another ROM');
    assert.equal(byId.get(jobs[3].id).prov.rom, even.prov.rom, 'idle: the same ROM...'); assert.notEqual(byId.get(jobs[3].id).cacheKey, even.cacheKey, '...but another rendered script, so another key');
    assert.doesNotThrow(() => validateRows(rows));
    // a resume re-seeds the cache from the file: nothing runs again, and a new job with the same key is reused from disk
    const jobs2 = [...jobs, same('scatter', { y: 216, tag: '' })];
    assert.equal(new Set(jobs2.map((x) => x.id)).size, 4);
    const before = fake.runs();
    const r2 = cli(['run', jf, out, '--procs=1', `--mesen=${fake.path}`]);
    assert.equal(r2.status, 0); assert.equal(fake.runs(), before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('DEDUP: validateRows refuses a reuse record whose source is absent, is itself a reuse, or differs in key, project, ROM or measurement; a reused record is a normal row for aggregation', () => {
  const a = ok(bJob(0)); const b = { ...ok(bJob(1), { prov: { ...a.prov }, cacheKey: a.cacheKey, phases: a.phases }), reuse: { of: a.id, key: a.cacheKey }, timing: { buildMs: 50, mesenMs: 0 } };
  assert.doesNotThrow(() => validateRows([a, b]));
  const refused = (rows, re, what) => assert.throws(() => validateRows(rows), re, what);
  refused([b], /reuse source .* is absent/, 'no source');
  refused([a, { ...b, reuse: { of: b.id, key: a.cacheKey } }], /is itself a reuse/, 'a reuse of a reuse');
  refused([a, { ...b, cacheKey: sha('x') }], /does not match its key/, 'another key');
  refused([a, { ...b, reuse: { of: a.id, key: sha('x') } }], /does not match its key/, 'a reuse reference with another key');
  refused([a, { ...b, prov: { ...b.prov, rom: sha('x') } }], /does not match/, 'another ROM');
  refused([a, { ...b, prov: { ...b.prov, project: sha('x') } }], /does not match/, 'another project');
  refused([a, { ...b, phases: { walkD: { maxG: 1, gateFail: 0, n: 240 } } }], /does not match/, 'another measurement');
  const g = aggregate([a, b]);
  assert.equal(g.bad, 0); assert.equal(g.rows.reduce((s, r) => s + r.jobs, 0), 2);
});

test('DEDUP: stage F\'s isolated confirmation is never given the cache (it always runs Mesen), while its search rows are', async () => {
  const dir = tmpdir();
  try {
    const jobs = [0, 1].map((i) => fJob(i)); const jf = path.join(dir, 'jobs.jsonl'); write(jf, jobs);
    const ctxs = [];
    await runF(jf, path.join(dir, 'out.jsonl'), 1, async (j, ctx) => { ctxs.push({ id: j.id, cache: ctx.cache }); return bad(j); }, opts);
    const confirm = ctxs.find((c) => c.id.endsWith('#confirm'));
    assert.ok(confirm); assert.equal(confirm.cache, null);
    assert.ok(ctxs.filter((c) => !c.id.endsWith('#confirm')).every((c) => c.cache instanceof MeasurementCache));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------------------------
// follow-up 5: R2-1 .. R2-4
test('R2-1: operational errors are not exhaustion: runF says `errors` (CLI exit 3), per-curve detail keeps a really exhausted curve visible, and exit 4 is only for a clean exhaustion', async () => {
  const dir = tmpdir();
  try {
    // every job of both curves is an operational error: no measurement at all
    const both = [0, 1, 2].flatMap((i) => [fJob(i, 'plain'), fJob(i, 'bound')]);
    const jf = path.join(dir, 'jobs.jsonl'); write(jf, both);
    const all = await runF(jf, path.join(dir, 'e1.jsonl'), 2, async (j) => ({ ...j, error: 'operational failure' }), opts);
    assert.equal(all.status, 'errors'); assert.equal(all.curves.plain.status, 'errors'); assert.equal(all.curves.bound.status, 'errors');
    assert.equal(all.curves.plain.candidates, 0);
    // plain cleanly exhausted, bound has an error: the overall status is errors, and plain stays visibly `exhausted`
    const mixed = await runF(jf, path.join(dir, 'e2.jsonl'), 2, async (j) => (j.bound ? { ...j, error: 'x' } : ok(j)), opts);
    assert.equal(mixed.curves.plain.status, 'exhausted'); assert.equal(mixed.curves.bound.status, 'errors'); assert.equal(mixed.status, 'errors');
    // a clean exhaustion (nothing failed, nothing errored) is `exhausted`
    const clean = await runF(jf, path.join(dir, 'e3.jsonl'), 2, async (j) => ok(j), opts);
    assert.equal(clean.status, 'exhausted'); assert.deepEqual(clean.errors, []);
    // a failing isolated confirmation is an error, not an exhaustion
    const noConfirm = await runF(jf, path.join(dir, 'e4.jsonl'), 2, async (j) => (j.confirmOf ? { ...j, error: 'died' } : bad(j)), opts);
    assert.equal(noConfirm.status, 'errors');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('R2-1: the CLI exits 3 when every process fails and when the isolated confirmation fails, 4 only for a clean exhaustion', () => {
  const dir = tmpdir();
  try {
    const jobs = [fJob(0, 'plain'), fJob(0, 'bound')];
    const jf = path.join(dir, 'jobs.jsonl'); write(jf, jobs);
    const dead = FAKE(dir, { name: 'dead', exitCode: 7 });
    const a = cli(['runF', jf, path.join(dir, 'a.jsonl'), '--procs=2', `--mesen=${dead.path}`]);
    assert.equal(a.status, 3, `every process failing: ${a.stderr.slice(-400)}`);
    assert.doesNotMatch(a.stderr, /\(EXHAUSTED/, 'an execution failure is not reported as bound exhaustion');
    // the original fails the gate, then the isolated confirmation's process dies (plain curve only; the bound curve has no jobs)
    const onlyPlain = path.join(dir, 'plain.jsonl'); write(onlyPlain, [jobs[0]]);
    const flaky = FAKE(dir, { name: 'flaky', fail: true, dieFromRun: 2 });
    const b = cli(['runF', onlyPlain, path.join(dir, 'b.jsonl'), '--procs=1', `--mesen=${flaky.path}`]);
    assert.equal(b.status, 3, `a failing isolated confirmation: ${b.stderr.slice(-400)}`);
    assert.equal(flaky.runs(), 2);
    const pass = FAKE(dir, { name: 'pass' });
    const c = cli(['runF', jf, path.join(dir, 'c.jsonl'), '--procs=2', `--mesen=${pass.path}`]);
    assert.equal(c.status, 4); assert.match(c.stderr, /EXHAUSTED/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// a direct measurement K, and a valid reuse of it
const K = sha('shared key');
const direct = (i, over = {}) => ok(bJob(i), { cacheKey: K, prov: { ...CURRENT, project: sha('P'), rom: sha('R') }, ...over });
const reuseOf = (src, i, over = {}) => ({ ...direct(i), reuse: { of: src.id, key: K }, timing: { buildMs: 50, mesenMs: 0 }, ...over });

test('R2-2: every raw record is validated against the whole input BEFORE ids collapse: an invalid second copy behind a good first copy is refused', () => {
  const dir = tmpdir();
  try {
    const j = bJob(0); const r = direct(0);
    const files = [path.join(dir, 'a.jsonl'), path.join(dir, 'b.jsonl')];
    const current = { ...CURRENT };
    write(files[0], [r]);
    const refused = (what, second, re) => { write(files[1], [second]); assert.throws(() => buildRecord(files, { current }), re, what); };
    refused('an invalid reuse (missing source)', { ...r, reuse: { of: 'missing', key: r.cacheKey } }, /reuse source missing is absent/);
    refused('an orphan confirmOf', { ...r, confirmOf: 'missing' }, /original missing is absent/);
    refused('a conflicting cache key', { ...r, cacheKey: sha('changed') }, /recorded more than once with different/);
    refused('a reuse whose reference key is not its cache key', { ...r, reuse: { of: r.id, key: sha('x') } }, /reuse|recorded more than once/);
    // relationProblems is the one function: the same verdicts without files
    const rowsOf = (id) => (id === r.id ? [r] : []);
    assert.deepEqual(relationProblems(r, rowsOf), []);
    assert.equal(relationProblems({ ...r, reuse: { of: 'missing', key: K } }, rowsOf).length, 1);
    // the legitimate A/B overlap: the same job measured DIRECTLY in one stage and validly REUSED in another still passes
    const src = direct(1); const asDirect = direct(2); const asReuse = reuseOf(src, 2);
    assert.doesNotThrow(() => validateRows([asDirect, src, asReuse]));
    assert.equal(validateRows([asDirect, src, asReuse]).length, 2, 'two logical records');
    assert.doesNotThrow(() => validateRows([asReuse, src, asDirect]), 'in either order');
    // ...and a bad copy of that overlap is still refused
    assert.throws(() => validateRows([asDirect, src, reuseOf(src, 2, { reuse: { of: src.id, key: sha('x') } })]), /does not match its key/);
    assert.throws(() => validateRows([asDirect, src, reuseOf(src, 2, { prov: { ...asReuse.prov, rom: sha('x') } })]), /recorded more than once|does not match/);
    void j;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('R2-2: resume applies the same validity: a reuse whose cache key changed (source present) is superseded and re-run, never `ok` with zero jobs; extra copies are archived', async () => {
  const dir = tmpdir();
  try {
    const jobs = [0, 1, 2, 3].map((i) => bJob(i)); const jf = path.join(dir, 'jobs.jsonl'); write(jf, jobs);
    const out = path.join(dir, 'out.jsonl');
    const src = direct(0); const good = reuseOf(src, 1); const broken = reuseOf(src, 2, { cacheKey: sha('wrong') });
    write(out, [src, good, broken, direct(3)]);
    const ran = [];
    const res = await runAll(jf, out, 1, async (j) => { ran.push(j.id); return direct(jobs.findIndex((x) => x.id === j.id)); }, opts);
    assert.deepEqual(ran, [jobs[2].id], 'the invalid reuse was re-run; the valid reuse and the direct rows were kept');
    assert.equal(res.status, 'ok'); assert.equal(res.dropped, 1);
    assert.match(readRows(`${out}.superseded.jsonl`)[0].supersededBecause, /invalid relations/);
    assert.doesNotThrow(() => validateRows(readRows(out)), 'the finished file is one agg accepts');
    // a reuse whose source was itself superseded (stale) goes with it
    const out2 = path.join(dir, 'out2.jsonl'); const stale = direct(0, { prov: { ...direct(0).prov, harness: sha('older harness') } });
    write(out2, [stale, reuseOf(stale, 1)]);
    const ran2 = [];
    await runAll(jf, out2, 1, async (j) => { ran2.push(j.id); return direct(jobs.findIndex((x) => x.id === j.id)); }, opts);
    assert.deepEqual(ran2.slice().sort(), jobs.map((j) => j.id).sort(), 'the stale source and its reuse were both re-run');
    // the cache is not seeded from an invalid reuse: nothing in it answers the broken key
    const out3 = path.join(dir, 'out3.jsonl'); write(out3, [src, reuseOf(src, 1, { cacheKey: sha('wrong') })]);
    const cache = new MeasurementCache(); let measured = 0;
    await runAll(jf, out3, 1, async (j, ctx) => { measured++; return direct(jobs.findIndex((x) => x.id === j.id)); }, { ...opts, cache });
    assert.equal(measured, 3, 'job 1 (invalid reuse), 2 and 3 ran');
    // identical repeats of one id are one record; the extra copy is archived
    const out4 = path.join(dir, 'out4.jsonl'); write(out4, [src, src]);
    const lr = loadResume(out4, [jobs[0]], CURRENT);
    assert.equal(lr.have.size, 1); assert.equal(readRows(out4).length, 1); assert.equal(readRows(`${out4}.superseded.jsonl`)[0].supersededBecause, 'repeated record');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('R2-4: the Mesen stat key includes device, inode and ctime (an atomic same-size, same-mtime replacement is detected), and the stage end takes a fresh, uncached read', async () => {
  const dir = tmpdir();
  try {
    const mesen = path.join(dir, 'mesen'); fs.writeFileSync(mesen, 'ABCDEFGHIJ'); fs.utimesSync(mesen, 1700000000, 1700000000);
    const oldHash = mesenHash(mesen, { fresh: true }); const ino = fs.statSync(mesen).ino;
    const replacement = `${mesen}.new`; fs.writeFileSync(replacement, '1234567890'); fs.utimesSync(replacement, 1700000000, 1700000000); fs.renameSync(replacement, mesen);
    assert.notEqual(fs.statSync(mesen).ino, ino, 'the premise: an atomic replacement is another inode, with the same size and mtime');
    assert.equal(fs.statSync(mesen).mtimeMs, 1700000000000);
    assert.notEqual(mesenHash(mesen), oldHash, 'the cached read noticed it');
    assert.equal(mesenHash(mesen), mesenHash(mesen, { fresh: true }));
    // the stage's last check is fresh (and the first, which fixes the state, is too)
    const jobs = [0, 1].map((i) => bJob(i)); const jf = path.join(dir, 'jobs.jsonl'); write(jf, jobs);
    const calls = [];
    await runAll(jf, path.join(dir, 'o.jsonl'), 1, async (j) => ok(j), { provenance: (fresh) => { calls.push(!!fresh); return CURRENT; }, log: () => {} });
    assert.equal(calls[0], true); assert.equal(calls.at(-1), true); assert.ok(calls.slice(1, -1).every((f) => f === false), 'the per-job checks stay cheap');
    const fcalls = [];
    await runF(jf.replace('jobs', 'jobsF'), path.join(dir, 'f.jsonl'), 1, async (j) => ok(j), { provenance: (fresh) => { fcalls.push(!!fresh); return CURRENT; }, log: () => {} }).catch(() => {});
    write(path.join(dir, 'jobsF.jsonl'), [fJob(0)]);
    await runF(path.join(dir, 'jobsF.jsonl'), path.join(dir, 'f2.jsonl'), 1, async (j) => ok(j), { provenance: (fresh) => { fcalls.push(!!fresh); return CURRENT; }, log: () => {} });
    assert.equal(fcalls.at(-1), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The R-stage CONTACT ENDPOINT (test/lua/run_sw_manifest.mjs CONTACT_IDLE_REG; the real-Mesen half is test/lua/run_sw_contact_check.mjs). The RPG walk ends in
// the contact battle, but phases advance on emulator frames and DONE prints whatever the mainline is doing, so a hung contact body (the slot-5 battle_begin
// bug) was blessed as 177 completed bodies. These tests run the REAL scene build and script rendering against a fake Mesen that captures the rendered Lua and
// prints a chosen report; they prove the harness's rules, not the Lua's behaviour in Mesen.
// A fake Mesen that keeps the rendered script, and prints a PHASE report plus (contact: 'always' | 'never' | 'wrapped' = only for a script carrying the endpoint) a CONTACT line.
const FAKE_CAPTURE = (dir, { contact = 'wrapped', gateFail = 0, name = 'cap', marker = null, frames = 580 } = {}) => {
  const f = path.join(dir, name);
  fs.writeFileSync(f, `#!/bin/sh
for a in "$@"; do case "$a" in *.lua) L="$a";; esac; done
cp "$L" "${dir}/${name}.lua"
echo "PHASE walkD n=178 maxG=${gateFail ? GATE + 1500 : 20663} maxMain=1 maxIntr=1 maxRel=1 overruns=0 gateFail=${gateFail} maxOam=1 maxPlusMax=2 guards=0 bigN=0 bigAdv=0"
${marker ? `echo "${marker}"` : contact === 'always' ? 'echo "CONTACT frame=580 phase=walkD"' : contact === 'wrapped' ? 'grep -q contactPhase "$L" && echo "CONTACT frame=580 phase=walkD"' : ''}
echo "DONE frames=${frames}"
exit 0
`);
  fs.chmodSync(f, 0o755);
  return { path: f, lua: () => fs.readFileSync(`${dir}/${name}.lua`, 'utf8') };
};
const rJob = () => plan('R')[0];

test('CONTACT: a completed contact is a usable R record (marker kept, the phase summary intact) and the rendered script carries the endpoint -- catches an R script without the wrapper', async () => {
  const dir = tmpdir();
  try {
    const fake = FAKE_CAPTURE(dir);
    const r = await runJob(rJob(), { mesen: fake.path });
    assert.deepEqual(r.contact, { frame: 580, phase: 'walkD' });
    assert.equal(isBad(r), false);
    assert.deepEqual(r.phases.walkD, { maxG: 20663, gateFail: 0, n: 178 });
    const lua = fake.lua();
    assert.ok(lua.includes(CONTACT_IDLE_REG) && !lua.includes(IDLE_REG), 'the wrapper replaces the plain registration, once');
    assert.match(lua, /\["ST_BATTLE"\]=\d+/, 'the state values come from this build\'s equates, never a number in the template');
    // the wrapper runs the COMPLETE onIdle measurement, THEN may end the run: a contact body that finish() skipped would never be measured
    assert.ok(CONTACT_IDLE_REG.indexOf('onIdle()') !== -1 && CONTACT_IDLE_REG.indexOf('onIdle()') < CONTACT_IDLE_REG.indexOf('finish()'), 'onIdle first, finish after');
    assert.match(CONTACT_IDLE_REG, /exec, SYM\.wait_vblank_loop\)$/, 'registered at the idle poll, never battle_begin or main_loop_ready');
    assert.ok(!/battle_begin|main_loop_ready|endFrame/.test(CONTACT_IDLE_REG), 'no other stopping point');
    // the endpoint ends only the TERMINAL phase, on a body that BEGAN in gameplay and ended in battle
    assert.match(CONTACT_IDLE_REG, /ph == contactPhase and ph\.collect and gs0 == SYM\.ST_GAMEPLAY and rd\(SYM\.game_state\) == SYM\.ST_BATTLE/);
    assert.deepEqual(parseOutput('CONTACT frame=580 phase=walkD\nDONE frames=580').contact, { frame: 580, phase: 'walkD' });
    assert.equal('contact' in parseOutput('DONE frames=1'), false, 'no marker, no field');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CONTACT: an R run that reaches its frame limit without the marker is an operational failure, never a passing prefix -- catches a missing marker treated as a pass', async () => {
  const dir = tmpdir();
  try {
    const none = FAKE_CAPTURE(dir, { contact: 'never', name: 'none' });
    await assert.rejects(runJob(rJob(), { mesen: none.path }), /contact endpoint was not reached/);
    // through the runner: the job becomes an ERROR row (exit 3, retried on resume), not a measurement
    const jf = path.join(dir, 'jobs.jsonl'); const out = path.join(dir, 'out.jsonl'); write(jf, [rJob()]);
    const r = cli(['run', jf, out, '--procs=1', `--mesen=${none.path}`]);
    assert.equal(r.status, 3, r.stderr.slice(-300));
    const rows = readRows(out);
    assert.equal(rows.length, 1); assert.match(rows[0].error, /contact endpoint was not reached/); assert.equal(isBad(rows[0]), true);
    // and the same job with the marker is a clean pass
    const yes = FAKE_CAPTURE(dir, { contact: 'always', name: 'yes' });
    const out2 = path.join(dir, 'out2.jsonl');
    assert.equal(cli(['run', jf, out2, '--procs=1', `--mesen=${yes.path}`]).status, 0);
    assert.equal(readRows(out2)[0].contact.phase, 'walkD');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- the persisted endpoint: ONE validator (run_sw_manifest.mjs contactEndpointProblems), applied to every record that is a planned R job ------------------
const EP = { frame: 580, phase: 'walkD' };
const rOk = (job, over = {}) => ok(job, { frames: 580, contact: { ...EP }, ...over }); // a VALID R record: the run ended on the frame of its marker, in the terminal collected phase
const strip = (r, ...fields) => { const x = structuredClone(r); for (const f of fields) delete x[f]; return x; };
const resumeOf = (dir, rows, jobs, name = 'r.jsonl') => { const f = path.join(dir, name); write(f, rows); return loadResume(f, jobs, CURRENT); };

test('CONTACT: a valid endpoint is accepted by every record check, an absent one refused, and a non-R record is unaffected -- catches a check that looks only at the runner', () => {
  const r = rOk(rJob());
  assert.equal(isBad(r), false);
  assert.equal(isBad(ok(rJob())), true, 'an R record from the old harness (no marker) is not a measurement');
  assert.equal(isBad(ok(bJob(0))), false, 'stage B has no contact endpoint');
  assert.equal(isBad(ok(fJob(0))), false);
  // the checks every consumer uses (resume, agg, confirmation) all go through isBad
  assert.ok(confirmationProblems(bad(rJob(), { frames: 580, contact: { ...EP } }), bad({ ...rJob(), id: `${rJob().id}#confirm`, confirmOf: rJob().id })).some((m) => /not a valid measurement/.test(m)), 'a confirmation without the marker is refused');
  assert.equal(aggregate([ok(rJob())]).bad, 1, 'agg counts it as a bad record, not as a row');
  assert.equal(aggregate([r]).bad, 0);
});

test('CONTACT: a malformed or inconsistent marker is refused by isBad, aggregation AND resume, never kept or seeded -- catches a truthiness check on the marker', () => {
  const dir = tmpdir();
  try {
    const job = rJob();
    const cases = {
      'an empty object': { contact: {} }, 'true': { contact: true }, 'a string': { contact: 'walkD' }, 'an array': { contact: [580, 'walkD'] },
      'frame 0 in phase boot': { contact: { frame: 0, phase: 'boot' } }, 'a wrong phase': { contact: { frame: 580, phase: 'walkR' } },
      'a non-integer frame': { contact: { frame: 580.5, phase: 'walkD' } }, 'a string frame': { contact: { frame: '580', phase: 'walkD' } }, 'a negative frame': { contact: { frame: -580, phase: 'walkD' } },
      'an extra field': { contact: { ...EP, extra: 1 } }, 'a frame that is not where the run ended': { contact: { frame: 579, phase: 'walkD' } },
      'a run with no frame count': { frames: undefined }, 'a non-integer run frame count': { frames: 580.5 },
      'a terminal phase with no bodies': { phases: { walkD: { maxG: 20663, gateFail: 0, n: 0 } } }, 'no terminal phase': { phases: { walkR: { maxG: 15802, gateFail: 0, n: 260 } } }
    };
    for (const [what, over] of Object.entries(cases)) {
      const r = rOk(job, over);
      assert.equal(isBad(r), true, `isBad: ${what}`);
      assert.equal(aggregate([r]).bad, 1, `aggregate: ${what}`);
      const res = resumeOf(dir, [r], [job]);
      assert.equal(res.have.size, 0, `resume must not keep: ${what}`);
      assert.match(res.dropped[0].supersededBecause, /operational error/, `resume supersedes it as an operational error: ${what}`);
    }
    assert.equal(resumeOf(dir, [rOk(job)], [job], 'valid.jsonl').have.size, 1, 'the valid record is kept');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CONTACT: a planned R row whose stage and contact were stripped (or whose stage was rewritten) is refused on resume and aggregation -- the PLAN decides, not the row\'s own stage', () => {
  const dir = tmpdir();
  try {
    const job = rJob();
    for (const [what, r] of Object.entries({
      'stage and contact both removed': strip(rOk(job), 'stage', 'contact'), 'stage rewritten to B, contact removed': { ...strip(rOk(job), 'contact'), stage: 'B' }, 'contact removed': strip(rOk(job), 'contact'),
      'stage rewritten to B, contact malformed': { ...rOk(job, { contact: {} }), stage: 'B' }
    })) {
      assert.equal(isBad(r), true, `isBad: ${what}`);
      assert.equal(aggregate([r]).bad, 1, `aggregate: ${what}`);
      const res = resumeOf(dir, [r], [job]);
      assert.equal(res.have.size, 0, `resume must not keep: ${what}`);
      assert.equal(res.dropped.length, 1, what);
    }
    assert.equal(isBad(strip(rOk(job), 'stage')), false, 'a missing stage alone is harmless: the endpoint is valid');
    assert.equal(resumeOf(dir, [strip(rOk(job), 'stage')], [job], 'nostage.jsonl').have.size, 1);
    // the job the resume matched the row to decides too, for an id the plan does not name
    const custom = { ...job, id: 'custom-r-job' };
    const loose = strip(rOk(custom), 'stage', 'contact');
    assert.equal(isBad(loose), false, 'by itself that row names no planned R job');
    assert.equal(resumeOf(dir, [loose], [custom], 'custom.jsonl').have.size, 0, 'but the job it resumes is an R job');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CONTACT: raw copies of one R record that differ only in the endpoint are refused before deduplication, in BOTH orders, by agg and resume -- catches a marker left out of the measurement signature', () => {
  const dir = tmpdir();
  try {
    const job = rJob();
    const valid = rOk(job);
    const variants = { 'no marker': strip(valid, 'contact'), 'a different marker': { ...valid, contact: { frame: 579, phase: 'walkD' } }, 'a null marker': { ...valid, contact: null } };
    for (const [what, other] of Object.entries(variants)) {
      for (const [order, rows] of [['valid first', [valid, other]], ['valid second', [other, valid]]]) {
        assert.throws(() => validateRows(rows), /recorded more than once with different/, `validateRows, ${what}, ${order}`);
        assert.throws(() => groupRows(rows), /recorded more than once/, `groupRows, ${what}, ${order}`);
        assert.throws(() => resumeOf(dir, rows, [job]), /recorded more than once with different/, `resume, ${what}, ${order}`);
      }
    }
    // exact duplicates (key order aside) are one record, as before
    assert.equal(validateRows([valid, { ...valid, contact: { phase: 'walkD', frame: 580 } }]).length, 1);
    assert.equal(resumeOf(dir, [valid, structuredClone(valid)], [job], 'same.jsonl').have.size, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CONTACT: a reuse must carry its source\'s endpoint, and its source must itself be a valid measurement -- catches reuse equality that ignores the marker', () => {
  const dir = tmpdir();
  try {
    const [a, b] = plan('R');
    const src = rOk(a);
    const reuseOf = (over = {}) => ({ ...rOk(b), cacheKey: src.cacheKey, prov: src.prov, phases: src.phases, reuse: { of: src.id, key: src.cacheKey }, ...over });
    assert.equal(validateRows([src, reuseOf()]).length, 2, 'a faithful reuse is accepted');
    for (const [what, r] of Object.entries({ 'a different marker': reuseOf({ contact: { frame: 579, phase: 'walkD' } }), 'no marker': strip(reuseOf(), 'contact'), 'a null marker': reuseOf({ contact: null }) })) {
      assert.throws(() => validateRows([src, r]), /REFUSED/, what);
      assert.throws(() => validateRows([r, src]), /REFUSED/, `${what}, reversed`);
    }
    // a source that is not a valid measurement (its marker stripped, or malformed) is no source, however faithfully the reuse copies it
    for (const [what, badSrc] of Object.entries({ 'stripped': strip(src, 'contact', 'stage'), 'malformed': { ...src, contact: {} } })) {
      assert.ok(relationProblems(reuseOf({ contact: badSrc.contact }), (id) => (id === src.id ? [badSrc] : [])).some((m) => /not a valid measurement/.test(m)), `source ${what}`);
      assert.throws(() => validateRows([badSrc, reuseOf({ contact: badSrc.contact })]), /REFUSED/, `source ${what}`);
      assert.equal(resumeOf(dir, [badSrc, reuseOf({ contact: badSrc.contact })], [a, b], `src-${what}.jsonl`).have.size, 0, `resume keeps neither: source ${what}`);
    }
    assert.equal(resumeOf(dir, [src, reuseOf()], [a, b], 'good.jsonl').have.size, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CONTACT: a stage A / stage B overlap (one id planned by both) is still ONE valid record, with no endpoint on either -- catches "fixing" the stripped-stage hole by requiring equal stages', () => {
  const dir = tmpdir();
  try {
    const a = ok({ ...bJob(0), stage: 'A' }); const b = ok(bJob(0));
    assert.equal(a.id, b.id); assert.notEqual(a.stage, b.stage);
    assert.equal(isBad(a) || isBad(b), false);
    for (const rows of [[a, b], [b, a]]) {
      assert.equal(validateRows(rows).length, 1);
      assert.equal(resumeOf(dir, rows, [bJob(0)], 'ab.jsonl').have.size, 1);
    }
    assert.equal(aggregate(validateRows([a, b])).bad, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CONTACT: a fresh run whose marker is inconsistent (wrong phase, a frame that is not where the run ended) is an operational failure, by the same validator -- catches a presence-only check in runManifest', async () => {
  const dir = tmpdir();
  try {
    for (const [what, opts] of Object.entries({ 'wrong phase': { marker: 'CONTACT frame=580 phase=walkR' }, 'frame not where the run ended': { marker: 'CONTACT frame=579 phase=walkD' }, 'no run frame count': { frames: 'x' } })) {
      const fake = FAKE_CAPTURE(dir, { ...opts, name: `bad-${what.replace(/\W/g, '')}` });
      await assert.rejects(runJob(rJob(), { mesen: fake.path }), /not a valid completed endpoint|not reached/, what);
    }
    assert.equal((await runJob(rJob(), { mesen: FAKE_CAPTURE(dir, { name: 'good' }).path })).contact.frame, 580);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CONTACT: an over-gate contact body is KEPT and judged, not dropped -- catches an endpoint that ends the run before the body is measured, or discards an over-gate one', async () => {
  const dir = tmpdir();
  try {
    const fake = FAKE_CAPTURE(dir, { contact: 'always', gateFail: 1, name: 'over' });
    const r = await runJob({ ...rJob(), n: 16 }, { mesen: fake.path });
    assert.equal(isBad(r), false, 'a failing contact body is a valid measurement');
    assert.equal(genuineFailure(r), true); assert.equal(r.phases.walkD.gateFail, 1);
    assert.equal(isCandidateFailure(r), true, 'at the candidate n of an R row, a gate failure is the candidate failure the stage stops on');
    // the ordering that makes this true in the Lua: the wrapper calls onIdle (which counts the body and its gateFail) before it can finish
    assert.ok(/onIdle\(\)\n  if began/.test(CONTACT_IDLE_REG));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CONTACT: the endpoint is R-only and a non-R rendered script is byte-identical to the one before the endpoint existed -- catches a wrapper (or any new binding) emitted for every job', async () => {
  // the template with its one substitution token restored to the line it replaced IS the pre-change template. Re-pin ONLY when a template edit is meant to change
  // every non-R measurement (and then the harness stamp invalidates every record anyway).
  const PRE_CHANGE_TEMPLATE_SHA = '190c41da07f851b9bc83b641cafb3a819e90dcfb5fec1c0e2f6580aa01f14486';
  const template = fs.readFileSync(path.join(ROOT, 'test/lua/sw_manifest.lua.template'), 'utf8');
  assert.equal(template.split('__IDLE_REG__').length, 2, 'one token');
  assert.equal(sha(template.split('__IDLE_REG__').join(IDLE_REG)), PRE_CHANGE_TEMPLATE_SHA);
  assert.equal(IDLE_REG, 'emu.addMemoryCallback(onIdle, emu.callbackType.exec, SYM.wait_vblank_loop)');
  // only stage R opts in
  for (const st of ['A', 'B', 'C', 'P', 'S']) assert.equal(manifestArgs(plan(st)[0]).contactEndpoint, undefined, `stage ${st}`);
  assert.equal(manifestArgs(fJob(0)).contactEndpoint, undefined, 'stage F');
  assert.equal(manifestArgs(rJob()).contactEndpoint, true);
  // a representative job of each non-R kind, built for real: the rendered script holds the plain registration once and nothing of the endpoint
  const dir = tmpdir();
  try {
    for (const [label, job] of [['A', plan('A')[0]], ['B', plan('B')[0]], ['C', plan('C')[0]], ['F', fJob(0)], ['P', plan('P')[0]], ['S', plan('S')[0]]]) {
      const fake = FAKE_CAPTURE(dir, { contact: 'never', name: `n${label}` });
      await runJob(job, { mesen: fake.path });
      const lua = fake.lua();
      assert.equal(lua.split(IDLE_REG).length, 2, `${label}: the plain registration, once`);
      assert.ok(!/contactPhase|ST_BATTLE|CONTACT|__IDLE_REG__/.test(lua), `${label}: nothing of the endpoint`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CONTACT: runManifest refuses an endpoint on a script whose terminal phase is not collected (before it builds anything)', async () => {
  await assert.rejects(runManifest({ gt: 'rpg', sizes: [2, 2, 2, 2, 2, 2, 2, 2], phases: [{ name: 'boot', waitFor: 'gameplay' }, { name: 'pre', frames: 5 }], contactEndpoint: true, mesen: '/nonexistent' }), /TERMINAL phase/);
});
