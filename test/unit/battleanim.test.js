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
import { generateAssets } from '../../main/build/generate.js';
import { projectUsesBattleAnimation, projectWithoutBattleAnimation } from '../../shared/project.js';
import { MISS_TILE_M, MISS_TILE_I, MISS_TILE_S, MISS_TILE_M_ART, MISS_TILE_I_ART, MISS_TILE_S_ART } from '../../shared/font.js';
import { encodeTiles } from '../../shared/chr.js';
import { SUPPORTED_MAPPERS, rpgCapable } from '../../shared/cartridge.js';

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

// Phase 2b MISS overlay (docs/design-battle-animation.md §13.5, §14 round 3
// "Reservation integration", case (e)): MISS_TILE_M/I/S art is stamped into
// EVERY tileset -- not only the currently-selected battle tileset -- on all
// three RPG-capable boards. sample-rpg has three tilesets and
// battleTilesetId 1, so tilesets 0 and 2 are the ones an implementation
// that only stamped the battle tileset would silently leave blank.
test('MISS overlay: MISS_TILE_M/I/S art is stamped into every tileset, on every RPG-capable board', async (t) => {
  for (const mapper of SUPPORTED_MAPPERS.filter(rpgCapable)) {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-missstamp-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
    const project = await loadProject(SAMPLE_RPG);
    project.cartridge.mapper = mapper.id;
    project.rpg.miss = true;
    assert.ok(project.tilesets.length > 1, 'sanity: sample-rpg must ship more than one tileset');
    await generateAssets({ dir, project });

    const mArt = encodeTiles([MISS_TILE_M_ART]);
    const iArt = encodeTiles([MISS_TILE_I_ART]);
    const sArt = encodeTiles([MISS_TILE_S_ART]);
    for (let i = 0; i < project.tilesets.length; i++) {
      // CHR-ROM boards ship tilesN.chr; a CHR-RAM board (UNROM 512) streams
      // the identical payload from chrramN.bin instead (main/build/
      // generate.js's own two branches for the same tileset payload).
      const chrPath = mapper.chrRam
        ? path.join(dir, 'build', 'assets', `chrram${i}.bin`)
        : path.join(dir, 'build', 'assets', `tiles${i}.chr`);
      const chr = await fs.promises.readFile(chrPath);
      const spriteBase = 4096;
      assert.deepEqual(
        [...chr.slice(spriteBase + MISS_TILE_M * 16, spriteBase + MISS_TILE_M * 16 + 16)],
        [...mArt],
        `${mapper.name}: tileset ${i} must carry the MISS_TILE_M art, not just the battle tileset (1)`
      );
      assert.deepEqual(
        [...chr.slice(spriteBase + MISS_TILE_I * 16, spriteBase + MISS_TILE_I * 16 + 16)],
        [...iArt],
        `${mapper.name}: tileset ${i} must carry the MISS_TILE_I art`
      );
      assert.deepEqual(
        [...chr.slice(spriteBase + MISS_TILE_S * 16, spriteBase + MISS_TILE_S * 16 + 16)],
        [...sArt],
        `${mapper.name}: tileset ${i} must carry the MISS_TILE_S art`
      );
    }

    const config = await fs.promises.readFile(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8');
    assert.match(config, /MISS_ENABLED = 1/, `${mapper.name}: MISS_ENABLED must read 1`);
  }
});

// (f) with MISS_ENABLED off, no tileset gains the stamped art -- off-path
// byte-identity for the stamping itself.
test('MISS overlay: (f) with miss:false, no tileset carries the MISS art and MISS_ENABLED reads 0', async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-missstamp-off-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE_RPG);
  assert.equal(project.rpg.miss, false, 'sanity: sample-rpg ships with miss off');
  await generateAssets({ dir, project });

  for (let i = 0; i < project.tilesets.length; i++) {
    const chr = await fs.promises.readFile(path.join(dir, 'build', 'assets', `tiles${i}.chr`));
    const spriteBase = 4096;
    for (const tile of [MISS_TILE_M, MISS_TILE_I, MISS_TILE_S]) {
      assert.ok(
        [...chr.slice(spriteBase + tile * 16, spriteBase + tile * 16 + 16)].every((byte) => byte === 0),
        `tileset ${i}, tile $${tile.toString(16)} must stay blank with miss:false`
      );
    }
  }
  const config = await fs.promises.readFile(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8');
  assert.match(config, /MISS_ENABLED = 0/);
});

// §14 round 2, test row "MISS OAM overflow, exact-fit boundary restored"
// (finding 5, P2). The generated BATTLE_FX_OAM_ROOM constant must subtract
// MISS_OAM_TILES once MISS is live -- battle_fx_draw's own runtime fit
// check (engine/battleui.asm) is unchanged code that trusts this single
// compiled figure completely, so a formula missing the term would silently
// let the flipbook eat into MISS's own reserved room with no code-level
// symptom at all.
// Wrong implementation this catches: battleFxOamRoom (main/build/
// generate.js) computed without its own `- MISS_OAM_TILES` term.
test('MISS overlay: the compiled BATTLE_FX_OAM_ROOM subtracts MISS_OAM_TILES once MISS is live', async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-missoamroom-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE_RPG);
  project.rpg.miss = true;
  await generateAssets({ dir, project });

  const { battleCombatantOamMax, MAX_OAM_ENTRIES } = await import('../../shared/project.js');
  const { resolveMapper } = await import('../../shared/cartridge.js');
  const mapper = resolveMapper(project.cartridge.mapper);
  const expectedRoom = Math.max(0, MAX_OAM_ENTRIES - battleCombatantOamMax(project, mapper) - 4);

  const config = await fs.promises.readFile(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8');
  const match = config.match(/^BATTLE_FX_OAM_ROOM\s*=\s*(\d+)/m);
  assert.ok(match, 'BATTLE_FX_OAM_ROOM must be a named constant in config.inc');
  assert.equal(
    Number(match[1]),
    expectedRoom,
    `BATTLE_FX_OAM_ROOM must equal MAX_OAM_ENTRIES - battleCombatantOamMax - MISS_OAM_TILES (${expectedRoom}) once MISS is live`
  );
});
