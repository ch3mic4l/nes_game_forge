// The rebuild certifier (test/lua/sw_rebuild_check.mjs) must fail closed. Its R2-1 and R2-2 holes, found in the final review of S1 (a1):
//   R2-1  a malformed `--every` (NaN) selected zero records and still printed ALL MATCH, exit 0
//   R2-2  a worker killed before answering counted as a matched rebuild (matched was `todo.length - mismatches - errors`)
// Nothing here rebuilds a ROM: the pool is driven with a stand-in worker that speaks the same IPC protocol, so the real parent
// wiring (fork, message, exit, signal) is exercised in seconds without the 10,893-record sweep.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseOptions, makeLedger, certify, classifyResponse, runPool } from '../lua/sw_rebuild_check.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lua/sw_rebuild_check.mjs');
const rec = (i) => ({ id: `job${i}`, stage: 'A', prov: { project: `p${i}`, rom: `r${i}` } });
const recs = (n) => Array.from({ length: n }, (_, i) => rec(i));

// a stand-in worker; MODE says how it misbehaves. 'ok' answers every job with the recorded hashes.
const WORKER = `
const mode = process.argv[2];
let seen = 0;
process.on('message', (r) => {
  if (r === 'exit') process.exit(0);
  seen++;
  const good = { id: r.id, prov: { project: r.prov.project, rom: r.prov.rom } };
  if (mode === 'kill' || (mode === 'kill-second' && seen === 2)) process.kill(process.pid, 'SIGKILL');
  if (mode === 'exit0' || (mode === 'exit0-second' && seen === 2)) process.exit(0);
  if (mode === 'crash') process.exit(7);
  if (mode === 'dup') { process.send(good); process.send(good); return; }
  if (mode === 'mismatch') { process.send({ id: r.id, prov: { project: r.prov.project, rom: 'different' } }); return; }
  if (mode === 'garbage') { process.send({ id: r.id }); return; }
  if (mode === 'wrongid') { process.send({ id: 'nobody', prov: good.prov }); return; }
  if (mode === 'silent') return;
  process.send(good);
});
process.send({ ready: true });
`;
let workerFile;
test.before(() => { workerFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-rebuildcheck-')), 'worker.mjs'); fs.writeFileSync(workerFile, WORKER); });
test.after(() => fs.rmSync(path.dirname(workerFile), { recursive: true, force: true }));
const pool = (todo, mode, procs = 2) => runPool(todo, { procs, worker: { file: workerFile, args: [mode] }, env: process.env, current: {} });
const verdict = (todo, r, every = 1, directCount = todo.length) => certify({ every, directCount, result: r.result, drift: r.drift.length });

test('R2-1: --every and --procs accept only a positive integer, once, as --name=N', () => {
  assert.deepEqual(parseOptions([]), { every: 1, procs: 20 });
  assert.deepEqual(parseOptions(['--every=10000', '--procs=4']), { every: 10000, procs: 4 });
  assert.equal(parseOptions(['--procs=64']).procs, 20, 'a valid --procs above the cap is clamped, as before');
  for (const bad of ['--every=banana', '--every=', '--every', '--every=0', '--every=-1', '--every=1.5', '--every=1e3', '--every=0x10', '--every= 2', '--every=NaN', '--every=Infinity', '--every=9999999999', '--procs=0', '--procs=x', '--procs']) {
    assert.throws(() => parseOptions([bad]), /positive integer/, bad);
  }
  assert.throws(() => parseOptions(['--every=2', '--every=3']), /given 2 times/);
});

test('R2-1: the CLI exits non-zero on a malformed option before it reads or rebuilds anything', () => {
  for (const bad of ['--every=banana', '--every=0', '--every', '--procs=abc']) {
    const r = spawnSync(process.execPath, [SCRIPT, bad], { encoding: 'utf8', timeout: 60000 });
    assert.notEqual(r.status, 0, `${bad} must not exit 0`);
    assert.ok(!/ALL MATCH|PARTIAL CHECK/.test(r.stdout), `${bad} must not print a verdict`);
    assert.match(r.stderr, /usage error/);
  }
});

test('R2-1: an empty workset never certifies, whatever the option', () => {
  for (const every of [1, 2, 10000]) {
    const v = certify({ every, directCount: 0, result: makeLedger([]).result() });
    assert.equal(v.exit, 1);
    assert.match(v.label, /NOT CERTIFIED.*empty workset/);
  }
  // a nonempty record set whose workset came out empty (the NaN modulus case) is a count mismatch, not a success
  const v = certify({ every: 1, directCount: 10893, result: makeLedger([]).result() });
  assert.equal(v.exit, 1);
});

test('certify: success needs every direct record answered once and matched; a clean partial run is exit 3, never 0', () => {
  const ids = recs(3).map((r) => r.id);
  const full = () => { const l = makeLedger(ids); ids.forEach((id) => { l.assign('w0', id); l.respond('w0', id, 'matched'); }); l.release('w0'); l.exit('w0', 0, null); return l.result(); };
  assert.equal(certify({ every: 1, directCount: 3, result: full() }).exit, 0);
  assert.equal(certify({ every: 1, directCount: 4, result: full() }).exit, 1, 'checked 3 of 4 direct records is not a full check');
  assert.equal(certify({ every: 2, directCount: 4, result: full() }).exit, 3);
  assert.equal(certify({ every: 1, directCount: 3, result: full(), drift: 1 }).exit, 1);
});

test('ledger: a missing response, a duplicate, a wrong owner and an unknown id are each a problem; counts come from responses only', () => {
  const l = makeLedger(['a', 'b']);
  l.assign('w0', 'a'); l.assign('w1', 'b');
  assert.equal(l.respond('w0', 'a', 'matched'), true);
  assert.equal(l.respond('w0', 'a', 'matched'), false, 'duplicate');
  assert.equal(l.respond('w0', 'b', 'matched'), false, 'b belongs to w1');
  assert.equal(l.respond('w0', 'zzz', 'matched'), false, 'unknown id');
  const r = l.result();
  assert.equal(r.matched, 1, 'only the one valid answer counts');
  assert.deepEqual(r.missing, ['b']);
  assert.equal(r.problems.length, 3);
  assert.equal(r.complete, false);
  assert.throws(() => makeLedger(['a', 'a']), /duplicate record ids/);
});

test('classifyResponse: matched, mismatched, an error string, and a reply with no usable prov', () => {
  const r = rec(1);
  assert.deepEqual(classifyResponse(r, { id: r.id, prov: { project: 'p1', rom: 'r1' } }), { kind: 'matched' });
  assert.deepEqual(classifyResponse(r, { id: r.id, prov: { project: 'p1', rom: 'x' } }), { kind: 'mismatched', differs: ['rom'] });
  assert.equal(classifyResponse(r, { id: r.id, error: 'boom' }).kind, 'errored');
  for (const m of [{ id: r.id }, { id: r.id, prov: {} }, { id: r.id, prov: { project: 1, rom: 2 } }, null]) assert.equal(classifyResponse(r, m).kind, 'errored');
});

test('pool: honest workers certify; every counted match came from a response', async () => {
  const todo = recs(7);
  const out = await pool(todo, 'ok', 3);
  assert.equal(out.result.matched, 7);
  assert.equal(out.result.answered, 7);
  assert.deepEqual(out.result.problems, []);
  assert.equal(verdict(todo, out).exit, 0);
  assert.equal(verdict(todo, out, 2).exit, 3);
});

test('R2-2: a worker killed by a signal before answering is an error, not a match', async () => {
  const todo = recs(6);
  const out = await pool(todo, 'kill', 2);
  assert.equal(out.result.matched, 0);
  assert.ok(out.result.missing.length > 0);
  assert.ok(out.result.problems.some((p) => /SIGKILL.*unanswered job/.test(p)), out.result.problems.join('|'));
  const v = verdict(todo, out);
  assert.equal(v.exit, 1);
  assert.doesNotMatch(v.label, /ALL MATCH/);
  assert.equal(verdict(todo, out, 2).exit, 1, 'a partial run with a dead worker is a failure, not a clean exit 3');
});

test('R2-2: a worker that dies after answering some jobs, an unexpected exit(0), a crash are all failures', async () => {
  for (const mode of ['kill-second', 'exit0', 'exit0-second', 'crash']) {
    const todo = recs(6);
    const out = await pool(todo, mode, 1);
    assert.ok(out.result.problems.length > 0, mode);
    assert.ok(out.result.missing.length > 0, mode);
    assert.equal(verdict(todo, out).exit, 1, mode);
  }
});

test('R2-2: a duplicate response, a response for the wrong job, and a reply with no prov each fail closed', async () => {
  for (const [mode, rx] of [['dup', /duplicate response/], ['wrongid', /unknown job/], ['garbage', /./]]) {
    const todo = recs(4);
    const out = await pool(todo, mode, 2);
    assert.equal(verdict(todo, out).exit, 1, mode);
    if (mode !== 'garbage') assert.ok(out.result.problems.some((p) => rx.test(p)), `${mode}: ${out.result.problems.join('|')}`);
  }
});

test('pool: a real hash mismatch is reported as a mismatch and fails; no workers for an empty workset is not a success', async () => {
  const todo = recs(3);
  const out = await pool(todo, 'mismatch', 2);
  assert.equal(out.mismatches.length, 3);
  assert.equal(out.result.matched, 0);
  assert.equal(verdict(todo, out).exit, 1);
  const empty = await pool([], 'ok');
  assert.equal(certify({ every: 1, directCount: 0, result: empty.result }).exit, 1);
});
