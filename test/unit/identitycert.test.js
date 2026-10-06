// The ROM-identity certifier (test/lua/sw_identity_cert.mjs) must fail closed, and its certificate must certify only what it says (review 1 section D).
// Nothing here rebuilds a ROM: the pool is driven with a stand-in worker that speaks the same IPC protocol, so the real parent wiring (fork, message, exit,
// signal, the ledger, the verdict) runs in seconds, and the certificate is built and validated from small made-up records.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseOptions, buildWorkset, classifyAnswer, runPool, verdictOf, buildCertificate, validateCertificate, sealOf, curveEvidenceVerdict, STAGES, SCOPE, CERTIFIER_VERSION } from '../lua/sw_identity_cert.mjs';
import { measurementKey, EXEC_FLAGS, UNIFORM_FIELDS } from '../lua/sw_provenance.mjs';
import { makeLedger } from '../lua/sw_rebuild_check.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lua/sw_identity_cert.mjs');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const OLD = { engine: sha('old engine'), harness: sha('harness'), generator: sha('old generator'), mesen: sha('mesen') };
const CURRENT = { ...OLD, engine: sha('new engine'), generator: sha('new generator') };

/** A made-up sweep: `direct` Mesen-run records (the last `confirms` are confirmation re-runs), `reuses` reuse records; every one carries the key a faithful rebuild reproduces. */
function mock({ direct = 7, reuses = 2, confirms = 1 } = {}) {
  const luaOf = (id) => sha(`lua ${id}`);
  const base = (id, stage) => {
    const prov = { ...OLD, project: sha(`project ${id}`), rom: sha(`rom ${id}`) };
    return { id, stage, gt: 'action', wide: false, anim: 'P1', n: 16, sizes: [2, 2, 2, 2, 2, 2, 2, 2], scenario: 'walk', done: true, timeout: false, status: 0, frames: stage === 'R' ? 580 : 643, prov, phases: { walkD: { maxG: 20000, gateFail: 0, n: 100 } }, ...(stage === 'R' ? { contact: { frame: 580, phase: 'walkD' } } : {}) }; // a VALID R endpoint: the run ended on the frame of its marker, in the terminal collected phase (contactEndpointProblems)
  };
  const rows = [];
  for (let i = 0; i < direct - confirms; i++) { const r = base(`d${i}`, STAGES[i % STAGES.length]); r.cacheKey = measurementKey({ project: r.prov.project, rom: r.prov.rom, lua: luaOf(r.id), prov: r.prov }); rows.push(r); }
  for (let i = 0; i < confirms; i++) { const o = rows[i]; const r = { ...base(`${o.id}#confirm`, o.stage), confirmOf: o.id }; r.cacheKey = measurementKey({ project: r.prov.project, rom: r.prov.rom, lua: luaOf(r.id), prov: r.prov }); rows.push(r); }
  for (let i = 0; i < reuses; i++) { const src = rows[i]; rows.push({ ...structuredClone(src), id: `u${i}`, stage: STAGES[(i + 1) % STAGES.length], reuse: { of: src.id, key: src.cacheKey } }); }
  const curve = { jobs: direct - confirms + reuses, reused: reuses, confirms, provenance: { ...OLD }, engine: { sha256: OLD.engine } };
  return { rows, curve, luaOf };
}
const workset = (m, o = {}) => buildWorkset(m.rows, { curve: m.curve, stageInfo: Object.fromEntries(STAGES.map((s) => [s, { file: `${s}.out`, sha256: sha(s), lines: 3 }])), ...o });

// ---- the stand-in worker ---------------------------------------------------------------------------------------------------------
const WORKER = `
const mode = process.argv[2];
const { createHash } = await import('node:crypto');
const sha = (s) => createHash('sha256').update(s).digest('hex');
let seen = 0;
process.on('message', (r) => {
  if (r === 'exit') process.exit(0);
  seen++;
  const good = { id: r.id, prov: { ...r.prov }, lua: sha('lua ' + r.id), romFile: r.prov.rom, sym: sha('sym') };
  if (mode === 'kill-second' && seen === 2) process.kill(process.pid, 'SIGKILL');
  if (mode === 'kill') process.kill(process.pid, 'SIGKILL');
  if (mode === 'crash') process.exit(7);
  if (mode === 'dup') { process.send(good); process.send(good); return; }
  if (mode === 'mismatch') { process.send({ ...good, prov: { ...good.prov, rom: sha('another rom') } }); return; }
  if (mode === 'project') { process.send({ ...good, prov: { ...good.prov, project: sha('another project') } }); return; }
  if (mode === 'romfile') { process.send({ ...good, romFile: sha('a flipped byte') }); return; }
  if (mode === 'binding') { process.send({ ...good, lua: sha('a rebound symbol ' + r.id) }); return; }
  if (mode === 'drift') { process.send({ ...good, prov: { ...good.prov, generator: sha('edited mid-run') } }); return; }
  if (mode === 'garbage') { process.send({ id: r.id }); return; }
  if (mode === 'wrongid') { process.send({ ...good, id: 'nobody' }); return; }
  process.send(good);
});
process.send({ ready: true });
`;
let workerFile;
test.before(() => { workerFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-identitycert-')), 'worker.mjs'); fs.writeFileSync(workerFile, WORKER); });
const run = async (todo, mode, { workers = 3, current = CURRENT, partial = false, directCount = todo.length, sabotage = null } = {}) => {
  const pool = await runPool(todo, { workers, worker: { file: workerFile, args: [mode] }, env: process.env, current });
  const verdict = verdictOf({ directCount, partial, result: pool.result, drift: pool.drift.length, sabotage });
  return { pool, verdict };
};
// the pool answers with the record's own recorded provenance, so the "current" source state is whatever the records say
const currentOf = (m) => ({ ...OLD });

test('a faithful rebuild of every direct record certifies; the 3 reuse records resolve and are not counted as rebuilds', async () => {
  const m = mock(); const ws = workset(m);
  assert.deepEqual(ws.problems, []);
  assert.equal(ws.direct.length, 7); assert.equal(ws.reuses.length, 2);
  const { pool, verdict } = await run(ws.direct, 'ok', { current: currentOf(m) });
  assert.equal(verdict.exit, 0, verdict.why.join('; '));
  assert.equal(pool.result.expected, 7); assert.equal(pool.result.answered, 7); assert.equal(pool.result.matched, 7);
  assert.equal(pool.luaOf.size, 7, 'one rendered-script digest per rebuilt direct record, none for a reuse');
});

test('options: --workers/--limit/--shard must be exact positive integers; workers are capped at 12; limit and shard exclude each other', () => {
  assert.deepEqual(parseOptions([]), { workers: 12, limit: null, shard: null });
  assert.equal(parseOptions(['--workers=40']).workers, 12);
  assert.deepEqual(parseOptions(['--shard=1/4']).shard, { index: 1, of: 4 });
  for (const bad of ['--workers=banana', '--workers=0', '--workers=-1', '--workers=1.5', '--workers=1e3', '--workers=', '--workers', '--limit=0', '--limit=x', '--shard=4/4', '--shard=0/0', '--shard=1', '--shard=a/b']) {
    assert.throws(() => parseOptions([bad]), /--(workers|limit|shard)/, bad);
  }
  assert.throws(() => parseOptions(['--workers=2', '--workers=3']), /twice|2 times/);
  assert.throws(() => parseOptions(['--limit=3', '--shard=0/2']), /alternatives/);
});

test('ZERO WORK is refused: an empty workset, an empty pool run, and a verdict with no direct records are never success', async () => {
  const ws = buildWorkset([], { curve: { jobs: 0, reused: 0, confirms: 0, provenance: OLD } });
  assert.ok(ws.problems.some((p) => /empty workset/.test(p)));
  const { pool, verdict } = await run([], 'ok', { directCount: 0 });
  assert.equal(pool.result.expected, 0);
  assert.equal(verdict.exit, 1); assert.match(verdict.why.join(';'), /empty workset/);
  // a workset that exists but of which nothing was asked: still not success
  assert.equal(verdictOf({ directCount: 6, partial: false, result: pool.result }).exit, 1);
});

test('PARTIAL COVERAGE is never success: a subset is exit 3 when it says so and exit 1 when it claims to be complete', async () => {
  const m = mock(); const ws = workset(m);
  const subset = ws.direct.slice(0, 3);
  const claimsComplete = await run(subset, 'ok', { current: currentOf(m), directCount: ws.direct.length, partial: false });
  assert.equal(claimsComplete.verdict.exit, 1); assert.match(claimsComplete.verdict.why.join(';'), /not every one of 7/);
  const declared = await run(subset, 'ok', { current: currentOf(m), directCount: ws.direct.length, partial: true });
  assert.equal(declared.verdict.exit, 3, 'a clean declared partial run');
  assert.notEqual(declared.verdict.exit, 0);
  // an unanswered job in a full run
  const r = makeLedger(['a', 'b']); r.assign('w0', 'a'); r.respond('w0', 'a', 'matched');
  assert.equal(verdictOf({ directCount: 2, partial: false, result: r.result() }).exit, 1);
});

test('DUPLICATE OWNERSHIP: a job assigned twice, answered twice, answered by a worker that does not own it, or for an unknown id is refused', async () => {
  const l = makeLedger(['a', 'b']);
  l.assign('w0', 'a'); l.assign('w1', 'a');
  assert.ok(l.result().problems.some((p) => /assigned twice/.test(p)));
  const l2 = makeLedger(['a', 'b']); l2.assign('w0', 'a'); l2.respond('w1', 'a', 'matched');
  assert.ok(l2.result().problems.some((p) => /assigned to w0/.test(p)));
  assert.throws(() => makeLedger(['a', 'a']), /duplicate record ids/);
  const m = mock(); const ws = workset(m);
  for (const mode of ['dup', 'wrongid']) {
    const { pool, verdict } = await run(ws.direct, mode, { current: currentOf(m) });
    assert.equal(verdict.exit, 1, mode); assert.ok(pool.result.problems.length > 0, `${mode}: ${pool.result.problems.join('|')}`);
  }
  // two records with one id are not a workset
  const dup = mock(); dup.rows.push(structuredClone(dup.rows[0]));
  assert.ok(workset(dup).problems.some((p) => /duplicate record id/.test(p)));
});

test('a DEAD WORKER (killed, crashed, killed mid-run) leaves jobs unanswered and fails; the job it held is named', async () => {
  const m = mock(); const ws = workset(m);
  for (const mode of ['kill', 'crash', 'kill-second']) {
    const { pool, verdict } = await run(ws.direct, mode, { current: currentOf(m), workers: 2 });
    assert.equal(verdict.exit, 1, mode);
    assert.ok(pool.result.problems.some((p) => /exited .*holding unanswered job|exited unexpectedly/.test(p)), `${mode}: ${pool.result.problems.join('|')}`);
    assert.ok(pool.result.matched < ws.direct.length, mode);
  }
});

test('a MISMATCH fails: a different ROM hash, a different project hash, a flipped ROM-file byte, an error, a malformed reply', async () => {
  const m = mock(); const ws = workset(m);
  for (const [mode, field] of [['mismatch', 'rom'], ['project', 'project'], ['romfile', 'romfile']]) {
    const { pool, verdict } = await run(ws.direct, mode, { current: currentOf(m) });
    assert.equal(verdict.exit, 1, mode); assert.equal(pool.result.mismatched, ws.direct.length, mode);
    assert.ok(pool.mismatches.every((x) => x.differs.includes(field)), `${mode} names ${field}`);
  }
  const g = await run(ws.direct, 'garbage', { current: currentOf(m) });
  assert.equal(g.verdict.exit, 1); assert.equal(g.pool.result.errored, ws.direct.length);
  assert.equal(classifyAnswer(ws.direct[0], { id: 'x', error: 'boom' }).kind, 'errored');
});

test('CHANGED BINDINGS: a rendered script (a rebound symbol) or execution flags that do not reproduce the record\'s own key fail', async () => {
  const m = mock(); const ws = workset(m);
  const { pool, verdict } = await run(ws.direct, 'binding', { current: currentOf(m) });
  assert.equal(verdict.exit, 1);
  assert.ok(pool.mismatches.length === ws.direct.length && pool.mismatches.every((x) => x.differs.join() === 'binding'), 'project and ROM equal, only the binding differs');
  // the key also pins the execution flags: a record taken under other flags does not reproduce
  const rec = ws.direct[0];
  const good = { id: rec.id, prov: { ...rec.prov }, lua: m.luaOf(rec.id), romFile: rec.prov.rom };
  assert.equal(classifyAnswer(rec, good).kind, 'matched');
  const other = { ...rec, cacheKey: measurementKey({ project: rec.prov.project, rom: rec.prov.rom, lua: m.luaOf(rec.id), prov: rec.prov, flags: { ...EXEC_FLAGS, killMs: 1 } }) };
  assert.deepEqual(classifyAnswer(other, good).differs, ['binding']);
  // and one whose source state (engine/harness/generator/Mesen) moved mid-run
  const drifted = await run(ws.direct, 'drift', { current: currentOf(m) });
  assert.equal(drifted.verdict.exit, 1); assert.ok(drifted.pool.drift.length > 0);
  const moved = verdictOf({ directCount: 6, partial: false, result: (await run(ws.direct, 'ok', { current: currentOf(m) })).pool.result, sourceProblems: ['source harness changed during the run'] });
  assert.equal(moved.exit, 1);
});

test('a CERT_SABOTAGE run is never a certification, even when every rebuild matched', async () => {
  const m = mock(); const ws = workset(m);
  const { verdict } = await run(ws.direct, 'ok', { current: currentOf(m), sabotage: 'kill-worker' });
  assert.equal(verdict.exit, 1); assert.match(verdict.why.join(';'), /sabotaged/);
});

// ---- the certificate -------------------------------------------------------------------------------------------------------------
async function certify(m = mock()) {
  const ws = workset(m);
  const { pool } = await run(ws.direct, 'ok', { current: currentOf(m) });
  const curveBytes = Buffer.from(JSON.stringify(m.curve));
  const cert = buildCertificate({ workset: ws, curve: m.curve, curveFile: 'test/fixtures/streambound-curve.json', curveDigest: sha(curveBytes), stageInfo: ws.stageInfo, current: CURRENT, recordedProv: OLD, before: CURRENT, after: CURRENT, result: pool.result, luaOf: pool.luaOf, symOf: pool.symOf, workers: 3 });
  const ctx = { curve: m.curve, curveBytes, live: { engine: CURRENT.engine, generator: CURRENT.generator, harness: OLD.harness } };
  return { cert, ctx, ws, m, reseal: (c) => ({ ...c, selfDigest: sealOf(c) }) };
}

test('a certificate from a complete run validates for exactly the current fingerprints and the curve it pins', async () => {
  const { cert, ctx } = await certify();
  assert.deepEqual(validateCertificate(cert, ctx), []);
  assert.equal(cert.certifier.version, CERTIFIER_VERSION); assert.equal(cert.scope, SCOPE); assert.equal(cert.partial, false);
  assert.equal(cert.counts.expected, cert.counts.directCount); assert.equal(cert.counts.matched, cert.counts.directCount); assert.ok(cert.counts.directCount > 0);
  assert.equal(cert.fingerprints.old.engine, OLD.engine); assert.equal(cert.fingerprints.current.engine, CURRENT.engine);
});

test('WRONG CURRENT FINGERPRINT: the certificate does not certify another engine or another generator (nor another harness)', async () => {
  const { cert, ctx } = await certify();
  assert.ok(validateCertificate(cert, { ...ctx, live: { ...ctx.live, engine: sha('a later engine') } }).some((p) => /live engine/.test(p)));
  assert.ok(validateCertificate(cert, { ...ctx, live: { ...ctx.live, generator: sha('a later generator') } }).some((p) => /live generator/.test(p)));
  assert.ok(validateCertificate(cert, { ...ctx, live: { ...ctx.live, harness: sha('another harness') } }).some((p) => /harness/.test(p)));
});

test('CORRUPTED CURVE DIGEST: another curve, an edited pinned digest (even re-sealed), or other counts than the curve\'s are refused', async () => {
  const { cert, ctx, reseal } = await certify();
  assert.ok(validateCertificate(cert, { ...ctx, curveBytes: Buffer.from(JSON.stringify({ ...ctx.curve, rows: [] })) }).some((p) => /curve digest/.test(p)), 'the checked-in curve changed');
  const bent = reseal({ ...cert, curve: { ...cert.curve, sha256: sha('another curve') } });
  assert.ok(validateCertificate(bent, ctx).some((p) => /curve digest/.test(p)), 'a re-sealed edit of the pinned digest');
  const other = { ...ctx.curve, jobs: ctx.curve.jobs + 1 };
  assert.ok(validateCertificate(cert, { ...ctx, curve: other, curveBytes: Buffer.from(JSON.stringify(other)) }).some((p) => /counts are not the curve/.test(p)));
  const oldFp = reseal({ ...cert, fingerprints: { ...cert.fingerprints, old: { ...cert.fingerprints.old, engine: sha('another old engine') } } });
  assert.ok(validateCertificate(oldFp, ctx).some((p) => /OLD engine/.test(p)));
});

test('CORRUPTED REUSE DIGEST: an edited digest breaks the seal; a corrupted reuse record fails the reuse graph', async () => {
  const { cert, ctx, reseal } = await certify();
  assert.ok(validateCertificate({ ...cert, reuseDigest: sha('x') }, ctx).some((p) => /seal/.test(p)), 'edited without re-sealing');
  assert.ok(validateCertificate(reseal({ ...cert, counts: { ...cert.counts, reusesResolved: cert.counts.reuseCount - 1 } }), ctx).some((p) => /reuse record was not resolved/.test(p)));
  const pinned = workset(mock()).reuseDigest;
  const mk = (mut) => { const m = mock(); mut(m.rows.find((r) => r.id === 'u0')); return workset(m); };
  assert.equal(mk(() => {}).reuseDigest, pinned, 'the digest is stable');
  assert.notEqual(mk((r) => { r.reuse.key = sha('another key'); }).reuseDigest, pinned);
  assert.ok(mk((r) => { r.reuse.key = sha('another key'); }).problems.some((p) => /does not match its key/.test(p)));
  assert.ok(mk((r) => { r.prov.rom = sha('another rom'); }).problems.some((p) => /does not match its key, project, ROM or measurement/.test(p)));
  assert.ok(mk((r) => { r.reuse.of = 'nowhere'; }).problems.some((p) => /not a direct record/.test(p)));
  assert.ok(mk((r) => { r.phases.walkD.maxG = 1; }).problems.some((p) => /does not match/.test(p)), 'a reused measurement that is not its source\'s');
});

test('a certificate is refused for: no counts equality, a partial flag, another certifier version, another scope, moved sources, no binding evidence, a missing stage', async () => {
  const { cert, ctx, reseal } = await certify();
  const bad = (fn, re) => assert.ok(validateCertificate(reseal(fn(JSON.parse(JSON.stringify(cert)))), ctx).some((p) => re.test(p)), String(re));
  bad((c) => { c.counts.matched -= 1; return c; }, /not all equal/);
  bad((c) => { c.counts.keysReproduced -= 1; return c; }, /measurement key/);
  bad((c) => { c.partial = true; return c; }, /partial/);
  bad((c) => { c.certifier.version = 999; return c; }, /certifier version/);
  bad((c) => { c.scope = 'everything'; return c; }, /scope/);
  bad((c) => { c.sources.after.generator = sha('moved'); return c; }, /moved during the run/);
  bad((c) => { c.bindings.distinctScripts = 0; return c; }, /binding evidence/);
  bad((c) => { delete c.stages.C; return c; }, /stage C/);
  bad((c) => { c.execFlags = { args: [], killMs: 1 }; return c; }, /execution flags/);
  assert.ok(validateCertificate({ ...cert, counts: { ...cert.counts, directCount: 0, expected: 0, answered: 0, matched: 0 } }, ctx).length > 0);
  assert.deepEqual(validateCertificate(null, ctx), ['not an object']);
});

test('the workset is refused for: a missing stage, a direct count that is not the curve\'s, a handover job, a record with no key, a bad record, mixed provenance', () => {
  const m = mock(); m.rows = m.rows.filter((r) => r.stage !== 'F');
  assert.ok(workset(m).problems.some((p) => /stage F has no records/.test(p)));
  const c = mock(); c.curve.jobs += 3;
  assert.ok(workset(c).problems.some((p) => /curve jobs/.test(p)));
  const h = mock(); h.rows[0].cfg = { streamHandover: true };
  assert.ok(workset(h).problems.some((p) => /outside the certified scope/.test(p)));
  const k = mock(); delete k.rows[0].cacheKey;
  assert.ok(workset(k).problems.some((p) => /cacheKey/.test(p)));
  const b = mock(); b.rows[1].done = false;
  assert.ok(workset(b).problems.some((p) => /bad \(unusable\)/.test(p)));
  const mix = mock(); mix.rows[2].prov.generator = sha('other');
  assert.ok(workset(mix).problems.some((p) => /generator differs across the record/.test(p)));
  const st = mock(); st.rows[0].stage = 'Z';
  assert.ok(workset(st).problems.some((p) => /stage "Z"/.test(p)));
});

test('the CLI: a malformed option exits 2, a partial run with --out exits 2, an existing --out is never overwritten (exit 1)', () => {
  const cli = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8' });
  for (const bad of ['--workers=banana', '--limit=0', '--shard=2/2']) assert.equal(cli(bad).status, 2, bad);
  assert.equal(cli('--limit=5', '--out=/tmp/never-written.json').status, 2);
  const existing = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-identitycert-out-')), 'cert.json'); fs.writeFileSync(existing, '{}');
  const r = cli(`--out=${existing}`);
  assert.equal(r.status, 1); assert.match(r.stderr, /immutable/);
  assert.equal(fs.readFileSync(existing, 'utf8'), '{}');
});

// ---- review 2 finding 2: the consumer's exact-match branch checks the generator too ---------------------------------------------------
test('curveEvidenceVerdict: exact only when BOTH recorded fingerprints are the live ones; otherwise a valid certificate or nothing', () => {
  const curve = { jobs: 1, reused: 0, confirms: 0, provenance: { ...OLD }, engine: { sha256: OLD.engine } };
  const none = [];
  assert.deepEqual(curveEvidenceVerdict({ curve, live: { engine: OLD.engine, generator: OLD.generator }, verdicts: none }), { ok: true, via: 'exact', why: [] });
  // the defect: the original engine with an arbitrarily changed generator was accepted without a certificate
  const changedGenerator = curveEvidenceVerdict({ curve, live: { engine: OLD.engine, generator: sha('an edited generator') }, verdicts: none });
  assert.equal(changedGenerator.ok, false);
  assert.deepEqual(changedGenerator.why, ['the live generator is not the recorded one']);
  const changedEngine = curveEvidenceVerdict({ curve, live: { engine: sha('an edited engine'), generator: OLD.generator }, verdicts: none });
  assert.equal(changedEngine.ok, false);
  assert.deepEqual(changedEngine.why, ['the live engine is not the recorded one']);
  assert.equal(curveEvidenceVerdict({ curve, live: { engine: sha('e'), generator: sha('g') }, verdicts: none }).why.length, 2);
  // a certificate carrying the live fingerprints rescues either change; one with problems rescues nothing
  const good = [{ file: 'good.json', problems: [] }];
  const bad = [{ file: 'bad.json', problems: ['the seal does not match the contents (the certificate was edited)'] }];
  assert.equal(curveEvidenceVerdict({ curve, live: { engine: OLD.engine, generator: sha('g') }, verdicts: good }).via, 'certificate good.json');
  assert.equal(curveEvidenceVerdict({ curve, live: { engine: OLD.engine, generator: sha('g') }, verdicts: bad }).ok, false);
  // a curve whose own two engine fields disagree is not an exact match for either
  const split = { ...curve, engine: { sha256: sha('another engine') } };
  assert.equal(curveEvidenceVerdict({ curve: split, live: { engine: OLD.engine, generator: OLD.generator }, verdicts: none }).ok, false);
});

test('the probe stage P (S3a.5) is a stage the certifier requires: a record set without it is refused, and the stage list is the sweep\'s own', () => {
  assert.deepEqual(STAGES, ['A', 'B', 'C', 'F', 'R', 'P']);
  const m = mock(); m.rows = m.rows.filter((r) => r.stage !== 'P');
  assert.match(workset(m, { curve: null }).problems.join(';'), /stage P has no records/);
});
