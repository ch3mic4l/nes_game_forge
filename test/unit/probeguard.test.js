// Slice S3b fix round 2, finding 4: the shared guard of every Mesen-launching probe entry point. No Mesen: the machine count is injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { probeOptions, claimRoom, requireWork, runPool } from '../lua/sw_probe_guard.mjs';
import { MACHINE_CEILING } from '../lua/sw_move_policy.mjs';

const SPEC = { match: 'value', out: 'value', show: 'bool' };

test('probeOptions: procs is a whole number 1..20, defaulted; every other malformed option is named', () => {
  assert.equal(probeOptions([], SPEC, { defaultProcs: 4 }).procs, 4);
  assert.equal(probeOptions(['--procs=20'], SPEC).procs, 20);
  assert.equal(probeOptions(['--procs=1', '--match=x', '--show'], SPEC).a.match, 'x');
  for (const bad of ['--procs=0', '--procs=21', '--procs=-1', '--procs=1.5', '--procs=abc', '--procs=', '--procs', '--procs=1e1', '--procs= 3']) assert.throws(() => probeOptions([bad], SPEC), /--procs/, bad);
  assert.throws(() => probeOptions(['--procs=2', '--procs=3'], SPEC), /twice/);
  assert.throws(() => probeOptions(['--nope=1'], SPEC), /unknown option --nope/);
  assert.throws(() => probeOptions(['bare'], SPEC), /unexpected argument/);
  assert.throws(() => probeOptions(['--show=1'], SPEC), /takes no value/);
});

test('claimRoom: the requested concurrency plus the Mesen already running must fit under the machine ceiling', () => {
  claimRoom(8, { running: 12 });
  claimRoom(MACHINE_CEILING, { running: 0 });
  assert.throws(() => claimRoom(9, { running: 12 }), /exceeds the machine ceiling of 20/);
  assert.throws(() => claimRoom(1, { running: 20 }), /exceeds the machine ceiling/);
});

test('requireWork rejects an empty selection and returns a non-empty one', () => {
  assert.throws(() => requireWork([], 'cells'), /no cells matched/);
  assert.deepEqual(requireWork([1], 'cells'), [1]);
});

test('runPool: never more than procs at once, keeps input order, rechecks the machine count before every launch, and stops when the machine is full', async () => {
  let live = 0; let peak = 0; const counts = [];
  const out = await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (x) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return x * 2; }, { running: () => { counts.push(live); return live; } });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]);
  assert.ok(peak <= 3 && peak >= 2, `peak ${peak}`);
  assert.equal(counts.length, 7, 'one machine check per launch');
  await assert.rejects(runPool([1, 2], 2, async () => 1, { running: () => 20 }), /exceeds the machine ceiling/);
  for (const bad of [0, 21, 1.5, NaN]) await assert.rejects(runPool([1], bad, async () => 1, { running: () => 0 }), /pool size/, String(bad));
  assert.deepEqual(await runPool([], 4, async () => 1, { running: () => 0 }), []);
});
