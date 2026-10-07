// Spawn-level isolation controls (phase 3b S1b round 2, finding 3). The round-1 hole: ringwork's Move CALIBRATION launched Mesen with no env, i.e. under the parent HOME, while the
// witness it fed was isolated. These tests put a STUB executable where Mesen goes, make a REAL witness run (real ring build, real runWitness / calibrateTouchBody) and read what the
// stub says it was started with. Run: node --test test/lua/ring_gate/iso_unit.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareRing } from './ringcli.mjs';
import { runWitness, calibrateTouchBody, needsCalibration, plannedInvocations } from './ringwork.mjs';
import { SPECS } from './s1bspecs.mjs';
import { openIsolatedHome, auditChain, homeOfPid } from './ringhome.mjs';
import { runManifest, requirePrivateHome } from '../run_sw_manifest.mjs';
import { measureMove } from '../run_sw_move_manifest.mjs';

let ci = null, scratch = null, stub = null, log = null;
before(async () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-unit-'));
  log = path.join(scratch, 'stub.log');
  stub = path.join(scratch, 'mesen-stub');
  // records the HOME and argument list it was started with, then exits 0 without printing a measurement
  fs.writeFileSync(stub, `#!/bin/sh\necho "HOME=$HOME ARGS=$*" >> '${log}'\nsleep 0.4\nexit 0\n`, { mode: 0o755 });
  ci = await prepareRing({ cellId: 'MMC1-H', n: 4, gt: 'action', sizes: [2, 2, 2, 2, 2, 2, 2, 2], wide: true });
});
after(() => { ci?.dispose(); fs.rmSync(scratch, { recursive: true, force: true }); });
const stubRuns = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
const fresh = () => { fs.rmSync(log, { force: true }); return openIsolatedHome({ settings: path.join(scratch, 'none.json'), requireSettings: false }); };
// the runner (run_s1b.mjs) resolves a spec's script function against the cell's ring before the run
const spec = (name) => { const s = { ...SPECS.find((x) => x.name === name) }; if (typeof s.script === 'function') s.script = s.script(ci.ring); return s; };

test('the calibration spawn carries the private HOME and is recorded as a calibration invocation', async () => {
  const iso = fresh();
  try {
    await assert.rejects(calibrateTouchBody({ cellInfo: ci, gt: 'action', touchY: 150, mesen: stub, mesenCtx: iso.ctx, spec: spec('mv-lead') }), /never ran a move_tick body/); // the stub measures nothing: the spawn is the point
    const runs = stubRuns();
    assert.equal(runs.length, 1, runs.join('|'));
    assert.equal(runs[0].split(' ')[0], `HOME=${iso.home}`, 'the calibration process must start under the private HOME');
    assert.notEqual(runs[0].split(' ')[0], `HOME=${os.homedir()}`);
    const chain = iso.chain();
    assert.equal(chain.length, 1);
    assert.equal(chain[0].purpose, 'calibration'); assert.equal(chain[0].spec, 'mv-lead'); assert.equal(chain[0].status, 0); assert.equal(chain[0].isolated, true);
  } finally { iso.dispose(); }
});

test('a witness spawn (kind move with a script, and kind manifest) carries the private HOME and is recorded', async () => {
  for (const name of ['mv-wait', 'walk']) {
    const iso = fresh();
    try {
      await runWitness({ cellInfo: ci, gt: 'action', spec: spec(name), mesen: stub, withJsnes: false, mesenCtx: iso.ctx }).catch((e) => { if (stubRuns().length === 0) throw e; }); // the stub's empty output may make the run throw AFTER its spawn, never before
      const runs = stubRuns();
      assert.equal(runs.length, 1, `${name}: ${runs.join('|')}`);
      assert.equal(runs[0].split(' ')[0], `HOME=${iso.home}`, name);
      assert.deepEqual(iso.chain().map((c) => [c.spec, c.purpose, c.isolated]), [[name, 'witness', true]]);
    } finally { iso.dispose(); }
  }
});

test('a lead-Say Move spec plans a calibration AND a witness invocation, and its runner reaches the calibration spawn first', async () => {
  assert.equal(needsCalibration(spec('mv-lead')), true);
  assert.deepEqual(plannedInvocations(spec('mv-lead')), [{ spec: 'mv-lead', purpose: 'calibration' }, { spec: 'mv-lead', purpose: 'witness' }]);
  assert.deepEqual(plannedInvocations(spec('mv-wait')), [{ spec: 'mv-wait', purpose: 'witness' }]);
  const iso = fresh();
  try {
    await runWitness({ cellInfo: ci, gt: 'action', spec: spec('mv-lead'), mesen: stub, withJsnes: false, mesenCtx: iso.ctx }).catch(() => {});
    assert.equal(stubRuns().length, 1, 'the calibration is the first spawn; the stub measures nothing, so the run stops there');
    assert.equal(iso.chain()[0].purpose, 'calibration');
    // and the chain the run retained is NOT the planned one: the audit says the witness never ran
    assert.ok(auditChain(iso.chain(), plannedInvocations(spec('mv-lead'))).some((m) => /expected 1 mv-lead\/witness/.test(m)));
  } finally { iso.dispose(); }
});

test('NEGATIVE: a ring run without a private environment is refused BEFORE anything spawns (the round-1 hole is closed at its source)', async () => {
  fs.rmSync(log, { force: true });
  await assert.rejects(runManifest({ root: ci.tree.root, ring: ci.ring, gt: 'action', sizes: [2, 2, 2, 2, 2, 2, 2, 2], wide: true, mesen: stub }), /needs a private environment/);
  await assert.rejects(runManifest({ root: ci.tree.root, ring: ci.ring, gt: 'action', sizes: [2, 2, 2, 2, 2, 2, 2, 2], wide: true, mesen: stub, mesenEnv: { ...process.env, HOME: os.homedir() } }), /HOME is the user's own/);
  await assert.rejects(measureMove({ gt: 'action', tail: 'none', lead: 'none', root: ci.tree.root, ring: ci.ring, mesen: stub }), /needs a private environment/);
  assert.equal(stubRuns().length, 0, 'nothing may have been spawned');
  assert.throws(() => requirePrivateHome({}), /private environment/);
  assert.doesNotThrow(() => requirePrivateHome({ HOME: '/tmp/some-private-home' }));
});

test('homeOfPid reports the HOME the kernel started a process with', async () => {
  const { spawn } = await import('node:child_process');
  const child = spawn('sleep', ['1'], { env: { ...process.env, HOME: '/tmp/iso-unit-home-marker' } });
  assert.equal(homeOfPid(child.pid), '/tmp/iso-unit-home-marker');
  child.kill();
});

test('auditChain: an invocation that ran under the parent HOME, or a missing planned one, is a problem', () => {
  const ok = { n: 1, spec: 's', purpose: 'witness', pid: 5, status: 0, isolated: true, homeSeen: '<isolated-HOME>', exe: '/x/Mesen', settingsSha256: 'a'.repeat(64), loadedFiles: [{ path: '/x' }] };
  assert.deepEqual(auditChain([ok], [{ spec: 's', purpose: 'witness' }]), []);
  assert.ok(auditChain([{ ...ok, isolated: false, homeSeen: '/home/chris' }], [{ spec: 's', purpose: 'witness' }]).some((m) => /private HOME/.test(m)));
  assert.ok(auditChain([], [{ spec: 's', purpose: 'witness' }]).length > 0);
  assert.ok(auditChain([ok], [{ spec: 's', purpose: 'witness' }, { spec: 's', purpose: 'calibration' }]).some((m) => /expected 1 s\/calibration/.test(m)));
});
