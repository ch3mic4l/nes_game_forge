// main/savequeue.js -- createSaveQueue and awaitAllSettled, tested in total
// isolation from the filesystem. The earlier fs-level tests for "two
// concurrent saves serialize" and "a fan-out awaits every settle"
// (test/unit/project.test.js) both had to watch REAL fs operations settle
// to prove anything, which is itself a timing assumption -- how long a real
// write+rename takes relative to however many event-loop turns a test pumps
// -- and the reviewer found a mutant (the second save's first fs op merely
// delayed 250ms) that fooled it. Neither export here touches fs at all, so
// every test controls every promise involved directly: nothing here can be
// fooled by making an unrelated operation slower or faster.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveQueue, awaitAllSettled } from '../../main/savequeue.js';

/**
 * Drains the microtask queue -- deterministic here (unlike a real fs test)
 * because nothing but promise chains sits between one turn and the next;
 * there is no actual I/O anywhere in these tests for the event loop to be
 * waiting on.
 */
async function drainMicrotasks(turns = 50) {
  for (let i = 0; i < turns; i++) await new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// --------------------------------------------------------------- createSaveQueue

test('createSaveQueue: task 2 (same key) does not even START until task 1 resolves', async () => {
  const queue = createSaveQueue();
  const held = deferred();
  let task1Started = 0;
  let task2Started = 0;

  const run1 = queue.run('key', () => {
    task1Started++;
    return held.promise;
  });
  const run2 = queue.run('key', () => {
    task2Started++;
    return Promise.resolve('done2');
  });

  await drainMicrotasks();
  assert.equal(task1Started, 1, 'task1 must have started');
  assert.equal(task2Started, 0, 'task2 must not have started while task1 is still held');

  held.resolve('done1');
  assert.equal(await run1, 'done1');
  assert.equal(await run2, 'done2');
  assert.equal(task2Started, 1, 'task2 must have started only once task1 resolved');
});

test('createSaveQueue: a different key runs fully concurrently, never waiting behind the first', async () => {
  const queue = createSaveQueue();
  const held = deferred();
  let bStarted = 0;

  const runA = queue.run('keyA', () => held.promise);
  const runB = queue.run('keyB', () => {
    bStarted++;
    return Promise.resolve('doneB');
  });

  await drainMicrotasks();
  assert.equal(bStarted, 1, 'a different key must run concurrently, not queue behind keyA');
  assert.equal(await runB, 'doneB');

  held.resolve('doneA');
  assert.equal(await runA, 'doneA');
});

test('createSaveQueue: a rejected task 1 still releases the queue for task 2 (same key), and task 2’s own result is unaffected', async () => {
  const queue = createSaveQueue();
  const run1 = queue.run('key', () => Promise.reject(new Error('boom')));
  let task2Ran = false;
  const run2 = queue.run('key', () => {
    task2Ran = true;
    return Promise.resolve('ok');
  });
  await assert.rejects(run1, /boom/);
  assert.equal(await run2, 'ok');
  assert.equal(task2Ran, true);
});

test('createSaveQueue: three tasks for one key run in call order, not completion order', async () => {
  const queue = createSaveQueue();
  const order = [];
  const held2 = deferred();

  const run1 = queue.run('key', async () => {
    order.push('1-start');
    order.push('1-end');
    return 1;
  });
  const run2 = queue.run('key', async () => {
    order.push('2-start');
    await held2.promise; // 2 is slower than 3 would be, if 3 were allowed to race it
    order.push('2-end');
    return 2;
  });
  const run3 = queue.run('key', async () => {
    order.push('3-start');
    order.push('3-end');
    return 3;
  });

  await drainMicrotasks();
  assert.deepEqual(order, ['1-start', '1-end', '2-start'], 'task 3 must not have started while task 2 is still running, even though task 2 is slow');

  held2.resolve();
  assert.deepEqual(await Promise.all([run1, run2, run3]), [1, 2, 3]);
  assert.deepEqual(order, ['1-start', '1-end', '2-start', '2-end', '3-start', '3-end']);
});

// ---------------------------------------------------------------- awaitAllSettled

test('awaitAllSettled: does not settle until EVERY input has settled, then rejects with the first rejection', async () => {
  const error = new Error('A failed');
  const aRejected = Promise.reject(error);
  aRejected.catch(() => {}); // this exact promise is also awaited below; avoid a spurious unhandled-rejection warning in between

  const held = deferred();
  let bSideEffectHappened = false;
  const bPromise = held.promise.then(() => {
    bSideEffectHappened = true;
    return 'B done';
  });

  const combined = awaitAllSettled([aRejected, bPromise]);
  let combinedSettled = false;
  combined.then(
    () => {
      combinedSettled = true;
    },
    () => {
      combinedSettled = true;
    }
  );

  await drainMicrotasks();
  assert.equal(combinedSettled, false, 'must not settle while B is still pending, even though A already rejected');
  assert.equal(bSideEffectHappened, false);

  held.resolve();
  await assert.rejects(combined, /A failed/);
  assert.equal(bSideEffectHappened, true, 'B must have actually run to completion (its own side effect happened) before the combined promise settled');
});

test('awaitAllSettled: all-success resolves once every input has, in no particular return shape the caller relies on', async () => {
  await assert.doesNotReject(awaitAllSettled([Promise.resolve(1), Promise.resolve(2)]));
});
