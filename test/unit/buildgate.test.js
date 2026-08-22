// One in-flight build per project directory (ROADMAP item 3's "Reload the
// ROM" bullet), main/build/buildgate.js. Tested through the handler-shaped
// runGated() seam itself, not by calling tryStart()/finish() directly --
// this module has no such pair, deliberately: testing raw Set operations in
// isolation would prove the bookkeeping is internally consistent without
// proving the real IPC handler actually pairs them correctly, so runGated()
// is the one thing both production and this file call.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBuildGate, canonicalizeBuildDir } from '../../main/build/buildgate.js';

/** A promise plus its own resolve/reject, for controlling exactly when
 * a stubbed build "finishes". */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('resolved work releases the gate for the same directory', async () => {
  const gate = createBuildGate();
  const first = await gate.runGated('/proj/a', async () => ({ ok: true, value: 1 }));
  assert.deepEqual(first, { ok: true, value: 1 });
  const second = await gate.runGated('/proj/a', async () => ({ ok: true, value: 2 }));
  assert.deepEqual(second, { ok: true, value: 2 }, 'a later request for the same directory must succeed');
});

test('rejected/thrown work also releases the gate -- not only a successful resolution', async () => {
  const gate = createBuildGate();
  await assert.rejects(gate.runGated('/proj/b', async () => { throw new Error('boom'); }));
  const after = await gate.runGated('/proj/b', async () => ({ ok: true, value: 'recovered' }));
  assert.deepEqual(
    after,
    { ok: true, value: 'recovered' },
    'a build that threw must still release its directory -- a finally-shaped bug that only releases on success would fail this'
  );
});

test('a refused second request for the same directory does not release the first, and a third is refused too', async () => {
  const gate = createBuildGate();
  const held = deferred();
  const firstRun = gate.runGated('/proj/c', () => held.promise);

  const second = await gate.runGated('/proj/c', async () => ({ ok: true, value: 'should not run' }));
  assert.equal(second.ok, false);
  assert.match(second.error, /already running/);

  // The first request must still be the only one holding the gate -- a
  // buggy runGated() that (incorrectly) released on the refused second
  // request would let this third one straight through instead of refusing it.
  const third = await gate.runGated('/proj/c', async () => ({ ok: true, value: 'should not run either' }));
  assert.equal(third.ok, false);

  held.resolve({ ok: true, value: 'first result' });
  const firstResult = await firstRun;
  assert.deepEqual(firstResult, { ok: true, value: 'first result' });

  const fourth = await gate.runGated('/proj/c', async () => ({ ok: true, value: 'now it is my turn' }));
  assert.deepEqual(fourth, { ok: true, value: 'now it is my turn' });
});

test('two different directories build concurrently -- the gate is per directory, not global', async () => {
  const gate = createBuildGate();
  const heldA = deferred();
  const runA = gate.runGated('/proj/d', () => heldA.promise);
  // Started while /proj/d is still in flight -- must not be refused.
  const runB = await gate.runGated('/proj/e', async () => ({ ok: true, value: 'e' }));
  assert.deepEqual(runB, { ok: true, value: 'e' });
  heldA.resolve({ ok: true, value: 'd' });
  assert.deepEqual(await runA, { ok: true, value: 'd' });
});

test('canonicalizeBuildDir treats a symlink and its target as the same directory', async (t) => {
  if (process.platform === 'win32') return t.skip('symlinks need elevated privileges on Windows');
  const real = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'forge-gate-real-'));
  t.after(() => fsPromises.rm(real, { recursive: true, force: true }));
  const linkPath = path.join(os.tmpdir(), `forge-gate-link-${process.pid}-${Date.now()}`);
  fs.symlinkSync(real, linkPath);
  t.after(() => fsPromises.rm(linkPath, { force: true }));

  assert.equal(canonicalizeBuildDir(linkPath), canonicalizeBuildDir(real));
});

test('a build gated by a symlink path refuses a concurrent build gated by the real path', async (t) => {
  if (process.platform === 'win32') return t.skip('symlinks need elevated privileges on Windows');
  const real = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'forge-gate-real-'));
  t.after(() => fsPromises.rm(real, { recursive: true, force: true }));
  const linkPath = path.join(os.tmpdir(), `forge-gate-link2-${process.pid}-${Date.now()}`);
  fs.symlinkSync(real, linkPath);
  t.after(() => fsPromises.rm(linkPath, { force: true }));

  const gate = createBuildGate();
  const held = deferred();
  const runViaLink = gate.runGated(linkPath, () => held.promise);
  const viaReal = await gate.runGated(real, async () => ({ ok: true, value: 'should be refused' }));

  assert.equal(viaReal.ok, false, 'a raw-string gate would treat these as two different directories and let this through');
  held.resolve({ ok: true, value: 'via link' });
  await runViaLink;
});

test('canonicalizeBuildDir falls back to path.resolve for a directory that does not exist', () => {
  const missing = path.join(os.tmpdir(), 'forge-gate-does-not-exist', 'nested');
  assert.equal(canonicalizeBuildDir(missing), path.resolve(missing));
});
