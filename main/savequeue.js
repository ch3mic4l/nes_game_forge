// A generic per-key promise queue, and the fan-out helper that makes it
// SAFE to use for a save that writes several files at once. Pulled out of
// main/project-io.js into their own module so both can be unit-tested in
// total isolation from the filesystem -- the earlier fs-level tests for
// "two concurrent saves serialize" and "a fan-out awaits every settle" both
// had to watch REAL fs operations to prove anything, which is itself a
// timing assumption (how long a real write+rename takes relative to however
// many event-loop turns a test pumps) rather than a proof of the queue's
// own logic. Neither of these two exports touches fs at all, so a test can
// control every promise involved directly and assert deterministically.

/**
 * `run(key, task)` chains `task` calls sharing the same `key` strictly one
 * after another -- `task` is not even invoked until every earlier call for
 * that key has fully settled (resolved or rejected) -- while different keys
 * run fully concurrently, never waiting on each other. This is a QUEUE, not
 * a refuse-the-second-caller gate (main/build/buildgate.js's own shape):
 * every caller here already holds a snapshot it means to write, so the
 * right answer is "run both, in the order they were called," never "refuse
 * the second." A rejected task must not stall the key's queue for whatever
 * runs next -- `.catch(() => {})` on the stored tail is what keeps the
 * chain advancing regardless, while the promise handed back to `run`'s own
 * caller still carries that task's real result or rejection, unflattened.
 */
export function createSaveQueue() {
  const chains = new Map();
  return {
    run(key, task) {
      const previous = chains.get(key) ?? Promise.resolve();
      const result = previous.catch(() => {}).then(task);
      chains.set(key, result.catch(() => {}));
      return result;
    }
  };
}

/**
 * Awaits every promise in a fanned-out write to *settle* -- succeed or fail
 * -- before this function itself settles, unlike Promise.all, which settles
 * (rejects) the instant the FIRST one rejects while its siblings' own writes
 * (and renames) are still in flight and unawaited by anyone. That gap is
 * real: a caller (createSaveQueue's own run(), above) that sees a task's
 * promise reject moves on to whatever is next queued for that key
 * immediately, but a sibling write this function stopped waiting for is
 * still running in the background and can rename its own (stale) content
 * into place *after* that later, successful task already finished --
 * corrupting a directory a subsequent save should have owned outright.
 * Waiting for every settlement first closes that gap: nothing from this
 * fan-out is still in flight by the time its own promise resolves or
 * rejects, so the next queued task never races a straggler. Only the first
 * rejection (in array order) is thrown, matching Promise.all's usual
 * "first failure wins" contract for the caller.
 */
export async function awaitAllSettled(promises) {
  const results = await Promise.allSettled(promises);
  const rejected = results.find((result) => result.status === 'rejected');
  if (rejected) throw rejected.reason;
}
