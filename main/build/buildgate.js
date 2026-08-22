// One in-flight build per project directory (ROADMAP item 3's "Reload the
// ROM" bullet). The main process is the only thing that survives a Build
// Forge mount being destroyed mid-build, and it owns the filesystem the
// pipeline writes to, so it is the only place a second build for the same
// directory can be refused before it starts deleting the first one's output
// out from under it — generate.js's own fs.rm(buildDir, {recursive: true})
// has no coordination against a second, concurrent caller today, and never
// did before this feature; leaving mid-build is just far more likely to
// happen now that reloading is a normal thing to do.
//
// Refused, not queued: a queued build would run, whenever its turn came,
// against whatever the project has become by then — silently reintroducing
// the exact staleness shared/reloadcoordinator.js works to avoid by
// resolving against the build's own returned project rather than a second,
// later read of the live one.

import { realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * The same real location can be spelled more than one way — a symlink and
 * its target, say — so two requests naming the same directory by different
 * strings still have to be recognised as the same build. realpathSync
 * requires the directory to already exist, which every project directory
 * this is ever called with does; path.resolve is a fallback for the one
 * case it doesn't (a directory vanishing between open and build), not a
 * silent substitute for real canonicalisation the rest of the time.
 */
export function canonicalizeBuildDir(dir) {
  try {
    return realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

/**
 * `runGated` canonicalises synchronously, before anything else — there is no
 * `await` between reading the directory and checking whether it is already
 * building, so two concurrent requests for the same real location cannot
 * both slip past the check before either registers (JavaScript does not
 * preempt a synchronous prefix, so the first call's synchronous portion —
 * canonicalise, check, register — always completes before a second call's
 * own continuation can run).
 */
export function createBuildGate() {
  const inFlight = new Set();
  return {
    async runGated(dir, work) {
      const key = canonicalizeBuildDir(dir);
      if (inFlight.has(key)) {
        return { ok: false, error: 'A build for this project is already running.' };
      }
      inFlight.add(key);
      try {
        return await work();
      } finally {
        inFlight.delete(key);
      }
    }
  };
}
