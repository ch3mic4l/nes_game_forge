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
// Re-pinned for the Character Forge phase 2 (docs/design-character-forge.md
// §2): sample-mmc1/sample-mmc3/sample-u512 moved. They are action projects
// with a live Save, and saveIdentity (shared/save.js) folds partyCount,
// which goes 0 -> 1 for every action project under this phase (a project
// always has someone to play as, per createPartyMember/normalizeProject) --
// so SAVE_IDENTITY_0..3 in each fixture's own build/assets/config.inc
// changed, and only those four lines (confirmed by diffing config.inc
// against a HEAD-3949316 build of the same fixture). sample/, sample-rpg/
// and sample-rpg-mmc1/ are unchanged: sample has no live Save at all, and
// both RPG fixtures already had a 1+ member party.
const BASELINES = {
  sample: '471562e528e8ad08a44c9211bd0784b8e6b5e9811e9793ebf21f02e2143bcd82',
  'sample-rpg': 'c7bc3dc326996831e488b929d238f19b71095dd02a8e2c24c37f5612f6f251be',
  'sample-mmc1': 'f24816f2bd35c7e4df6974823409db384b92cb90bea263b08bdc05fa4d4e2b76',
  'sample-mmc3': '689bf6cc813dc21870be606d7eac2e892b1fdeb6c33be4238db61d24ad79bf97',
  'sample-u512': '2a2f9d63a30cde781e34951dff595f777f7beba65472014c881cb525691da3ae',
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
