// Phase 3a slice S3b fix round 2, finding 4: the ONE guard of every probe or diagnostic entry point that launches Mesen. A local pool limit is not the
// machine-wide ceiling: every such entry point parses its options strictly (the same parser as the campaign commands), rejects an invalid limit before
// any build or launch, and checks the Mesen processes ALREADY running against the concurrency it will actually use, both once up front and again at
// every launch. Not a harness file (test/lua/sw_provenance.mjs HARNESS_FILES) and not measuring code (sw_cross_fingerprint.mjs).
import { MACHINE_CEILING, assertRoom, countMesen, parseFlags, wholeNumber } from './sw_move_policy.mjs';

/**
 * Parses `argv` against `spec` ({ name: 'value' | 'bool' }; `procs` is added) with the shared strict parser. `procs` must be a whole number 1..20
 * (default `defaultProcs`). An unknown, repeated, valueless or non-numeric option throws a plain Error naming it; nothing has been launched yet.
 */
export function probeOptions(argv, spec, { defaultProcs = 4 } = {}) {
  const a = parseFlags(argv, { ...spec, procs: 'value' });
  return { a, procs: wholeNumber(a.procs, 'procs', 1, MACHINE_CEILING, defaultProcs) };
}

/** The machine-wide check, with the concurrency the entry point will actually use. `running` = Mesen processes already on the machine (counted when omitted). */
export function claimRoom(procs, { running } = {}) {
  assertRoom(procs, running ?? countMesen());
}

/** An entry point that selected no work did not run: an empty selection is an error, never a pass. */
export function requireWork(items, what) {
  if (!items.length) throw new Error(`no ${what} matched: nothing would run`);
  return items;
}

/**
 * Maps `fn` over `items` on at most `procs` workers. Before EACH launch the machine's own count is checked again, so another launcher that grew in the
 * meantime stops this one with an error instead of pushing the machine over the ceiling. Results keep the input order; the first error rejects.
 */
export async function runPool(items, procs, fn, { running = countMesen } = {}) {
  if (!Number.isInteger(procs) || procs < 1 || procs > MACHINE_CEILING) throw new Error(`the pool size must be a whole number 1..${MACHINE_CEILING}, got ${procs}`);
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      assertRoom(1, running()); // every Mesen already on the machine (this pool's own included) plus the one about to start
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(procs, items.length) }, worker));
  return out;
}
