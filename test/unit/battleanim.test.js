// Battle-side animation, phase 1b (docs/design-battle-animation.md) -- a
// narrow, repeatable regression pin, the monsterlevel.test.js shape (build
// twice, expect identical ROMs) applied to a GATE rather than a dead field.
//
// Review round 1, P3 finding 7: stated precisely, this test proves two
// separate things, by two separate mechanisms, and neither one alone is
// the whole claim. The explicit `projectUsesBattleAnimation` before/after
// assertions call the real, exported gate function directly and check its
// boolean answer -- this is what actually catches a presence-based gate
// (one that reads a field's own KEY existing at all as "authored," rather
// than its value being non-null/non-undefined): `loadProject` already
// normalizes a never-authored project's own `spell.anim`/`battle.
// attackAnim` to an explicit `null` key, so by the time either build is
// compiled BOTH sides already have the key present -- a broken,
// presence-based `projectUsesBattleAnimation` would read `true` for both,
// and the two builds would still compile identically bloated, so the ROM
// comparison below CANNOT distinguish that bug on its own. What the ROM
// comparison independently adds is proof that `projectWithoutBattleAnimation`
// itself writes back a project the GENERATOR treats exactly like one that
// never authored either field -- not merely that the gate function's own
// boolean reads correctly, which the JS-level assertions already establish
// without ever building anything. Neither half proves the gate is wired
// correctly against every possible wrong implementation on its own (a
// build that emitted `mon_anim_attack`/`spell_anim` or the four
// `battle_fx_*` routines UNCONDITIONALLY, in both builds alike, would also
// compare byte-identical here, since both sides would be equally, and
// identically, bloated) -- closing that particular gap is the six-fixture
// cross-tree gate's own job (against the pre-1b baseline, b65144a -- see
// the phase 1b implementation report), not this file's.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { projectUsesBattleAnimation, projectWithoutBattleAnimation } from '../../shared/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
const hasRom = fs.existsSync(path.join(SAMPLE_RPG, 'build/game.nes'));
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = (!hasRom && 'run `npm run sample:rpg && npm run build:sample:rpg` first') ||
  (!hasNesasm && 'nesasm not found on PATH');

/** sample-rpg, copied into its own mkdtemp directory, with `mutate` applied. */
async function buildWith(t, mutate) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-battleanim-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE_RPG);
  mutate(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return built.romPath;
}

test(
  'a battle animation authored and then stripped by projectWithoutBattleAnimation compiles byte-identical to one never authored at all',
  { skip },
  async (t) => {
    const neverAuthoredRom = await buildWith(t, () => {});

    const strippedRom = await buildWith(t, (project) => {
      // Author both locations for real -- a real, playable animation
      // (sample-rpg's own catalog entry 1, "Slime," one frame naming a real
      // metasprite) so projectWithoutBattleAnimation has something genuine
      // to strip, not a no-op on an already-null field.
      project.sprites.actors[0].battle.attackAnim = 1;
      project.spells[0].anim = 1;
      assert.ok(projectUsesBattleAnimation(project), 'sanity: the gate must read as on before stripping');
      const stripped = projectWithoutBattleAnimation(project);
      assert.ok(!projectUsesBattleAnimation(stripped), 'sanity: the gate must read as off after stripping');
      Object.assign(project, stripped);
    });

    assert.deepEqual(
      [...fs.readFileSync(strippedRom)],
      [...fs.readFileSync(neverAuthoredRom)],
      'a project whose battle animation was authored and then stripped by projectWithoutBattleAnimation must ' +
        'assemble byte-identical to one that never authored it at all -- together with the sanity assertions ' +
        'above (which independently prove the gate function itself reads correctly), this is what shows the ' +
        'stripped project is not merely reported as off but actually compiles as off'
    );
  }
);
