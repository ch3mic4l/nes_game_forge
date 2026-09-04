// The six sample generators (tools/make-*.js) are read by nobody but their
// own npm scripts, so nothing else in this suite would ever notice one
// drifting from what the checked-in fixture it is supposed to reproduce
// actually contains. That is exactly how phase 3's item-schema migration
// broke all five without a single existing test failing: each generator
// builds on createProject(), which now supplies `items: []`, so a generator
// still authoring a legacy `{ op: 'give', actor: N }` or an actor-valued
// `battle.drop` produces a project the migration correctly declines to
// touch (an `items` array, even empty, means "already migrated") — the
// reference just resolves to nothing. The checked-in fixtures kept working
// because they are still old-format *on disk*, so loading them migrates
// correctly every time; the break only shows up the moment someone
// regenerates, which is the documented workflow (`npm run sample && npm run
// build:sample`) this project asks users to run before testing.
//
// The check: run each generator into a mkdtemp directory (never over the
// checked-in fixture — CLAUDE.md's own rule), then assert that loading it
// produces a project deepEqual to loading the checked-in fixture. Both go
// through the identical normalizeProject/loadProject path, so this compares
// "what the generator authors directly" against "what the migration derives
// from the checked-in old-format data" — which is exactly the equivalence
// that broke.
//
// The on-disk bytes are *not* expected to match, and that is deliberate, not
// a gap this test should close. sample-rpg/ in particular is a pre-migration
// snapshot: it ships with no items.json and a `battle.drop` still pointing at
// an actor id, so every load runs migrateItemsFromActors (shared/project.js)
// for real, against a real project, deriving the one Potion item and
// remapping the drop reference to it. Regenerating the fixture in place would
// make it post-migration on disk and silently delete that coverage -- nobody
// would be exercising the migration path again until the *next* schema
// change broke it unnoticed, the exact failure mode this file exists to
// catch. The other fixtures carry the same kind of additive, schema-only
// drift (saveCompatToken, boundTiles, map folder). So the invariant pinned
// here is load-equality, not file-equality: regenerating a fixture into a
// fresh directory must produce a project that loads identically to the
// checked-in one, however differently the two are actually spelled on disk.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadProject } from '../../main/project-io.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const GENERATORS = [
  { name: 'sample', script: 'tools/make-sample.js' },
  { name: 'sample-rpg', script: 'tools/make-rpg-sample.js' },
  { name: 'sample-mmc1', script: 'tools/make-mmc1-sample.js' },
  { name: 'sample-mmc3', script: 'tools/make-mmc3-sample.js' },
  { name: 'sample-u512', script: 'tools/make-u512-sample.js' },
  { name: 'sample-rpg-mmc1', script: 'tools/make-rpg-save-sample.js' }
];

// A cheap proof that loadProject(checkedIn) never wrote back into the
// fixture it just read: every file's relative path and mtime, unaffected by
// the mkdtemp regeneration happening alongside it.
async function snapshotFixture(dir) {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath ?? e.path, e.name));
  files.sort();
  return Promise.all(
    files.map(async (file) => {
      const stat = await fs.stat(file);
      return `${path.relative(dir, file)}:${stat.mtimeMs}`;
    })
  );
}

for (const { name, script } of GENERATORS) {
  test(`${script} reproduces what the checked-in ${name}/ migrates to`, async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-samplegen-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));

    const fixtureDir = path.join(ROOT, name);
    const before = await snapshotFixture(fixtureDir);

    execFileSync(process.execPath, [path.join(ROOT, script), dir], { stdio: 'ignore' });

    const checkedIn = await loadProject(fixtureDir);
    const regenerated = await loadProject(dir);
    assert.deepEqual(
      regenerated,
      checkedIn,
      `${script}'s own output must load to exactly what the checked-in ${name}/ does. A mismatch here means the ` +
        'generator and the fixture have drifted -- most dangerously in project.items or a give/take/Carrying/drop ' +
        'reference, which can drift silently (no build error, no crash) while quietly handing out or checking for ' +
        'nothing at runtime.'
    );

    const after = await snapshotFixture(fixtureDir);
    assert.deepEqual(after, before, `${name}/ must not be written to by this test -- CLAUDE.md: "No test may mutate any of the six."`);
  });
}
