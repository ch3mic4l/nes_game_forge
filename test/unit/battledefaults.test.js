// A never-saved actor's battle defaults must compile identically to the
// same project after a save/reopen round trip. `normalizeActor`
// (shared/project.js) runs only on load and on save, so an actor pushed
// straight onto project.sprites.actors by the Sprite Forge's "+" button
// (renderer/forges/sprite/sprite.js) -- with no `battle` key at all -- stays
// un-normalized in the in-memory project the store holds until the project
// is reopened. `battleTables` (main/build/battletables.js) used to spell its
// own `?? N` per field, and for three of them (xp, gold, dropPct) that
// number disagreed with `normalizeActor`'s own default and with what the
// Monster Forge showed for the same never-saved actor. `ACTOR_BATTLE_
// DEFAULTS` (shared/project.js) is now the single table all three read.
//
// Shape borrowed from monsterlevel.test.js (the ROM-level byte-identity
// proof, skip-guarded the same way) and monstergrowth.test.js (calling
// battleTables directly on an in-memory project, no ROM needed).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { battleTables } from '../../main/build/battletables.js';
import { normalizeProject, ANIM_SLOTS, ACTOR_BATTLE_DEFAULTS } from '../../shared/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
const BATTLETABLES_PATH = path.join(ROOT, 'main/build/battletables.js');
const hasRom = fs.existsSync(path.join(SAMPLE_RPG, 'build/game.nes'));
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = (!hasRom && 'run `npm run sample:rpg && npm run build:sample:rpg` first') ||
  (!hasNesasm && 'nesasm not found on PATH');

/**
 * Exactly what renderer/forges/sprite/sprite.js's "+" button pushes (no
 * `battle` key at all), plus the `damage: 1` the general Actor panel would
 * then set on it -- a non-zero `damage` is what marks an actor hostile in an
 * RPG (see normalizeActor's own comment on that field, shared/project.js).
 */
function pushRawHostileActor(project) {
  const id = project.sprites.actors.length;
  const anims = {};
  for (const { id: slot } of ANIM_SLOTS) anims[slot] = null;
  project.sprites.actors.push({
    id,
    name: `Actor ${id}`,
    behavior: 'patroller',
    speed: 1,
    hp: 1,
    anims,
    damage: 1
  });
  return id;
}

/** Pull one label's `.db` rows out of battleTables()'s emitted text, as decimal values. */
function extractTable(text, label) {
  const match = text.match(new RegExp(`${label}:\\n((?:  \\.db [^\\n]*\\n?)+)`));
  assert.ok(match, `table ${label} not found in emitted battle tables`);
  return match[1]
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => line.replace('  .db ', '').split(','))
    .map((hexStr) => parseInt(hexStr.replace('$', ''), 16));
}

// sample-rpg is loaded read-only and never saved into -- CLAUDE.md's "Tests
// must not mutate sample/" rule extends to every checked-in fixture. Each
// test below loads its own copy so no test can see another's mutations.

test(
  'a never-saved hostile actor with no battle key compiles the same battle tables as the same project reopened',
  async () => {
    const rawProject = await loadProject(SAMPLE_RPG); // already normalized on load
    const id = pushRawHostileActor(rawProject); // ...then this actor is pushed raw, same as the "+" button

    const reopenedEquivalent = normalizeProject(structuredClone(rawProject));

    const rawTables = battleTables(rawProject);
    const reopenedTables = battleTables(reopenedEquivalent);
    assert.equal(
      rawTables,
      reopenedTables,
      'battleTables() must emit identical text for a never-normalized actor and its normalized twin'
    );

    // Sanity check that this test can fail: read the actual numbers back out
    // of the emitted tables, not recomputed from ACTOR_BATTLE_DEFAULTS itself.
    assert.equal(extractTable(rawTables, 'mon_xp_lo')[id], 4, 'xp low byte must be the shared default, 4');
    assert.equal(extractTable(rawTables, 'mon_xp_hi')[id], 0, 'xp high byte must be 0 for a 4-xp default');
    assert.equal(extractTable(rawTables, 'mon_gold')[id], 2, 'gold must be the shared default, 2');
    assert.equal(
      extractTable(rawTables, 'mon_drop_pct')[id],
      6,
      'drop chance must be dropThreshold(10) == 6, the shared default rescaled into roll_drop\'s 0-63 domain'
    );
  }
);

test(
  'the user-visible scenario: build before saving, build after reopening, byte-identical ROMs',
  { skip },
  async (t) => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-battledefaults-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
    await fs.promises.cp(SAMPLE_RPG, dir, {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}build`)
    });

    const rawProject = await loadProject(dir);
    pushRawHostileActor(rawProject);

    // buildProject compiles the project the app is holding -- exactly what
    // Build does immediately after "+" with no save in between.
    await buildProject({ dir, project: rawProject, log: () => {} });
    const beforeSaveBytes = await fs.promises.readFile(path.join(dir, 'build', 'game.nes'));

    // Now the user saves and reopens -- normalizeActor runs, filling in the
    // battle defaults for real. Read the first ROM's bytes before this,
    // since generate.js's own build step fs.rm()s the build directory.
    await saveProject(dir, rawProject);
    const reopened = await loadProject(dir);
    await buildProject({ dir, project: reopened, log: () => {} });
    const afterReopenBytes = await fs.promises.readFile(path.join(dir, 'build', 'game.nes'));

    assert.deepEqual(
      [...beforeSaveBytes],
      [...afterReopenBytes],
      'a build made before saving a never-normalized actor must match the same build made after reopening it'
    );
  }
);

test('ACTOR_BATTLE_DEFAULTS is the pinned single source of every actor battle default', () => {
  assert.deepEqual(ACTOR_BATTLE_DEFAULTS, {
    atk: 4,
    def: 2,
    mag: 0,
    mdef: 0,
    acc: 180,
    eva: 4,
    speed: 4,
    mp: 0,
    xp: 4,
    gold: 2,
    dropPct: 10,
    heal: 0,
    battleW: 4,
    battleH: 4,
    battlePalette: 2
  });
});

test('battleTables\' monsters block spells no private `?? <digit>` default of its own', () => {
  const source = fs.readFileSync(BATTLETABLES_PATH, 'utf8');
  // The monsters block runs from the first per-actor battle field after
  // mon_hp (mon_hp's own `actor.hp ?? 1` is a top-level field, not a battle
  // default, and deliberately excluded -- see normalizeActor's own hp
  // default in shared/project.js, which already agrees) up to mon_name, the
  // last monster-only table before the party's own tables begin.
  const start = source.indexOf('mon_mp:');
  const end = source.indexOf('mon_name:');
  assert.ok(start > 0 && end > start, 'could not locate the monsters block in battletables.js');
  const monstersBlock = source.slice(start, end);
  assert.doesNotMatch(
    monstersBlock,
    /\?\?\s*\d/,
    'every numeric battle default in the monsters block must come from ACTOR_BATTLE_DEFAULTS, not a private literal'
  );
});
