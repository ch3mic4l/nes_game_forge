// In-game party-member name entry (docs/design-name-entry.md), phase 1 --
// the save migration alone. This phase adds no engine code, no predicate and
// no UI: it only grows the save record (SAVE_FIELDS gains pc_name_ram) and
// bumps SAVE_LAYOUT_VERSION 2 -> 3, both unconditional. Every later phase's
// naming-off ROM has to compare byte-for-byte against a pinned baseline, and
// this phase is that baseline: the six fixture ROMs, hashed here, are what
// phase 2 and beyond re-hash against with the feature fully present but
// still universally disabled.
//
// `sample/` and `sample-rpg/` carry no Save command, so their two hashes are
// untouched by this phase (SAVE_FIELDS/SAVE_LAYOUT_VERSION only reach a
// project's ROM through engine/save.asm's own `.if SAVE_ENABLED` block) --
// pinned here anyway, so a later phase's re-hash has a same-file diff to
// read rather than a silent omission.
//
// Builds happen into a fresh mkdtemp directory via buildProject
// (main/build/pipeline.js), never into any of the six checked-in build/
// directories -- CLAUDE.md: "No test may mutate any of the six."
// generateAssets only ever reads its `dir` argument to know where to write,
// never to read project data back off disk (see main/build/generate.js's
// own generateAssets/ENGINE_DIR), so a project loaded once with loadProject
// is a complete, self-contained object and can be built into any directory.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// Phase-1 name-entry baselines: SHA-256 of each fixture's ROM, built from the
// checked-in project (loadProject) with SAVE_FIELDS carrying pc_name_ram and
// SAVE_LAYOUT_VERSION at 3, naming code not yet existing at all. sample/ and
// sample-rpg/ are unchanged from their pre-phase-1 hashes (no Save command);
// the other four moved (they all carry a live Save). If this is a deliberate
// re-pin, rebuild the six fixtures on the exact tree the re-pin is for
// (`npm run build:sample`, `build:sample:rpg`, `build:sample:mmc1`,
// `build:sample:mmc3`, `build:sample:u512`, and `node main/build/cli.js
// sample-rpg-mmc1`), hash each `<fixture>/build/game.nes` with sha256sum,
// and say in the commit which engine change moved which hashes.
const BASELINES = {
  sample: '471562e528e8ad08a44c9211bd0784b8e6b5e9811e9793ebf21f02e2143bcd82',
  'sample-rpg': 'c7bc3dc326996831e488b929d238f19b71095dd02a8e2c24c37f5612f6f251be',
  'sample-mmc1': 'd2b8a23d41340ddbfac5ca1cf7176d85c6df999008d8d96efd68caae182c27b5',
  'sample-mmc3': '52618166b837e589d343903ee3eaed97bca908b3581b88b2ab1c2e30d4efec99',
  'sample-u512': '10a558d9a51487a44d171e32fe0897bc9725bda73909a2f7da3c8fcfbb29c565',
  'sample-rpg-mmc1': 'f24658ab023a888df23722cd6da0a94f85ba1480b9267ef1906df58ebbceeba8'
};

for (const name of Object.keys(BASELINES)) {
  test(
    `${name}/ builds to the phase-1 name-entry baseline`,
    { skip: !hasNesasm && 'nesasm not found on PATH' },
    async (t) => {
      const fixtureDir = path.join(ROOT, name);
      const project = await loadProject(fixtureDir);

      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-nameentry-'));
      t.after(() => fs.rm(dir, { recursive: true, force: true }));

      const built = await buildProject({ dir, project, log: () => {} });
      const rom = await fs.readFile(built.romPath);
      const hash = crypto.createHash('sha256').update(rom).digest('hex');

      assert.equal(
        hash,
        BASELINES[name],
        `${name}/ must assemble byte-for-byte identically to the phase-1 name-entry baseline -- if this is a ` +
          'deliberate change, re-pin the hash by building this exact fixture on the tree the re-pin is for and ' +
          'say why in the commit'
      );
    }
  );
}
