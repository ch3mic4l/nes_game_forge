// Monster Forge phase 2 -- battle.level is authored, stored and shown, but
// read by nothing that emits a compiled byte (docs/design-monster.md §3/§5).
// This is the repeatable, same-tree half of that proof: build two variants of
// sample-rpg from the same tree, differing only in whether one monster's
// battle.level is set, and assert the two ROMs are byte-identical. The
// one-time, cross-tree half (proving phase 1 itself changed no compiled
// byte) belongs in that phase's own implementation report instead -- see §5
// for why the two are deliberately not the same kind of check. Shape copied
// from routes.test.js's own byte-identity tests (:84-108).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
const hasRom = fs.existsSync(path.join(SAMPLE_RPG, 'build/game.nes'));
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = (!hasRom && 'run `npm run sample:rpg && npm run build:sample:rpg` first') ||
  (!hasNesasm && 'nesasm not found on PATH');

/**
 * sample-rpg, copied into its own mkdtemp directory (never mutated in
 * place), with actor 0's (Slime) battle.level set to `level`. Actor 0 being
 * a monster is incidental here, not load-bearing: battleTables()
 * (main/build/battletables.js) emits one row per actor, hostile or not, so
 * any actor's battle.level reaching a compiled byte would show up the same
 * way. Mirrors routes.test.js's own `buildWith`.
 */
async function buildWithLevel(t, level) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-monlevel-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE_RPG);
  project.sprites.actors[0].battle.level = level;
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return built.romPath;
}

test('a monster\'s authored battle.level compiles byte-identical to one left unset', { skip }, async (t) => {
  const unsetRomPath = await buildWithLevel(t, null);
  const setRomPath = await buildWithLevel(t, 7);
  assert.deepEqual(
    [...fs.readFileSync(setRomPath)],
    [...fs.readFileSync(unsetRomPath)],
    'battle.level must be read by nothing that emits a compiled byte -- setting it must not change the ROM at all'
  );
});
