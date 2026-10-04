// Phase 3a slice S3a, fix round 2 (review 2, required change 1): the content-only compaction that makes the RPG + switch-bound-tile + Flash
// scenes buildable (test/lua/sw_compact_actors.mjs, test/lua/sw_compact_root.mjs). The campaign used to record 999 "not constructible" cells; the
// reviewer showed the scene, not the workload, was refused: the scene builder gives each placed entity its own actor definition and defines a
// ninth, never-placed one, and every definition costs lookup-table bytes. Each test here has a positive and a negative control.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSceneProject, buildScene, REPO } from '../lua/sw_manifest_scene.mjs';
import { populations, sceneMutation, LEADS, TAILS } from '../lua/run_sw_move_manifest.mjs';
import { ANIM_PRESETS } from '../lua/sw_bound_sweep.mjs';
import { compactActors, assertPreserved } from '../lua/sw_compact_actors.mjs';
import { compactRoot } from '../lua/sw_compact_root.mjs';
import { checkCapacity } from '../../main/build/generate.js';
import { validateProject } from '../../shared/project.js';

// the reviewer's scene: RPG, tight art, 14 tiles over two actors (the bound variant), Flash lead + Move 3 + Say tail. Uncompacted it needs 161 table bytes of 160.
const SCENE = {
  gt: 'rpg', wide: false, sizes: populations(14)['few-large-2'], anim: ANIM_PRESETS.P1,
  flashCmds: [...LEADS.flash, { op: 'move', who: 'player', dir: 'down', dist: 3 }, ...TAILS.say], mutate: sceneMutation({ bound: true })
};
const errorsOf = (project) => checkCapacity(project).problems.filter((p) => p.severity === 'error').map((p) => p.message);
const placed = (project) => project.maps.flatMap((m) => m.screens.flatMap((s) => (s.entities ?? [])));
const tilesOfEntity = (project, e) => { const a = project.sprites.actors[e.actorId]; const an = project.sprites.animations[a.anims.walkDown]; return project.sprites.metasprites[an.frames[0].metaspriteId].tiles.length; };

// Phase 3a S3b: the scene's table need (161) is unchanged, but an RPG with a streamed Move now carries 16 more bytes of kernel-lo engine code
// (net of the nocross pair: the talker call sites), so the free figure in the refusal fell from 160 to 144. The claim is that the need exceeds what is free.
test('CONTROL: the uncompacted scene IS refused by the generator (161 bytes of lookup tables, fewer than that free): the defect the compaction answers', async () => {
  const { project } = await buildSceneProject({ root: REPO, ...SCENE });
  const errs = errorsOf(project);
  assert.equal(errs.length, 1, errs.join('; '));
  const m = /lookup tables need 161 bytes but only (\d+) are free/.exec(errs[0]);
  assert.ok(m && Number(m[1]) < 161, errs[0]);
});

test('compaction makes the same scene admissible and within capacity, with every placed entity unchanged and the tile total exactly 14', async () => {
  const { project } = await buildSceneProject({ root: REPO, ...SCENE });
  const before = placed(project).map((e) => ({ ...e, actorId: 0, tiles: tilesOfEntity(project, e), body: JSON.stringify({ ...project.sprites.actors[e.actorId], name: 0, id: 0 }) }));
  const stats = compactActors(project);
  assert.deepEqual(errorsOf(project), []);
  assert.deepEqual(validateProject(project).filter((p) => p.severity === 'error'), []);
  const after = placed(project).map((e) => ({ ...e, actorId: 0, tiles: tilesOfEntity(project, e), body: JSON.stringify({ ...project.sprites.actors[e.actorId], name: 0, id: 0 }) }));
  assert.deepEqual(after, before, 'every entity keeps its position, trigger, event, actor body and tile count');
  assert.equal(stats.entities, 15);
  assert.equal(stats.placedTiles, 28, 'both walk targets carry the 14-tile population');
  assert.deepEqual([stats.before, stats.after, stats.unplaced], [9, 3, 1]);
  const target = project.maps[0].screens.find((s) => (s.entities ?? []).some((e) => e.props?.trigger === 'touch'));
  assert.equal(target.entities.length, 8, 'eight live actors on the Move\'s own screen');
  assert.equal(target.entities.reduce((n, e) => n + tilesOfEntity(project, e), 0), 14, 'exactly 14 tiles there (the bound variant of 15)');
  assert.deepEqual(target.entities.map((e) => tilesOfEntity(project, e)).sort((a, b) => b - a), [7, 7, 0, 0, 0, 0, 0, 0]);
});

test('compaction shares only IDENTICAL definitions: actors differing in behaviour, hit points or damage stay distinct', async () => {
  const { project } = await buildSceneProject({ root: REPO, ...SCENE });
  const chasers = project.sprites.actors.filter((a) => a.name.startsWith('Chaser') && !(project.sprites.animations[a.anims.walkDown].frames[0].metaspriteId === project.sprites.animations[project.sprites.actors[0].anims.walkDown].frames[0].metaspriteId));
  assert.ok(chasers.length >= 2, 'the scene has several zero-tile chasers');
  chasers[0].hp = 7; // one zero-tile chaser is no longer identical to the rest
  const placing = placed(project).filter((e) => project.sprites.actors[e.actorId] === chasers[0]).length; // one entity per walk target
  const stats = compactActors(project);
  assert.deepEqual([stats.before, stats.after], [9, 4], 'one more definition than the identical case (3)');
  assert.equal(placed(project).filter((e) => project.sprites.actors[e.actorId].hp === 7).length, placing, 'exactly the entities that placed the changed actor keep it');
});

test('compaction refuses to run on a project it cannot prove it preserved: an entity placing an undefined actor throws', async () => {
  const { project } = await buildSceneProject({ root: REPO, ...SCENE });
  placed(project)[0].actorId = 99;
  assert.throws(() => compactActors(project), /places actor 99, which is not defined/);
});

test('compaction is idempotent: a compacted project compacts to itself', async () => {
  const { project } = await buildSceneProject({ root: REPO, ...SCENE });
  compactActors(project);
  const snapshot = JSON.stringify(project);
  const again = compactActors(project);
  assert.equal(JSON.stringify(project), snapshot);
  assert.equal(again.before, again.after);
});

test('the compacting build root builds the scene the generator refused (a real ROM), through the harness\'s own buildScene; the real root still refuses it', async () => {
  const dir = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/forge-compact-test-`);
  try {
    const root = compactRoot(REPO);
    assert.notEqual(root, REPO);
    const built = await buildScene({ root, outDir: dir, ...SCENE }); // the scene's own art assertions run on the uncompacted project, then the build compacts
    const rom = fs.readFileSync(built.romPath);
    assert.equal(rom.subarray(0, 4).toString('latin1'), 'NES\x1a');
    assert.ok(rom.length > 16);
    await assert.rejects(() => buildScene({ root: REPO, outDir: `${dir}/real`, ...SCENE }), /lookup tables need 161 bytes but only \d+ are free/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the compacting root is the real tree: engine/shared by symlink, every main/build file a byte-identical COPY except the pipeline wrapper (so the hash covers the real generator)', () => {
  const root = compactRoot(REPO);
  for (const rel of ['engine', 'shared']) assert.ok(fs.lstatSync(`${root}/${rel}`).isSymbolicLink(), rel);
  for (const rel of ['main/build/generate.js', 'main/build/nesasm.js']) {
    assert.ok(fs.lstatSync(`${root}/${rel}`).isFile() && !fs.lstatSync(`${root}/${rel}`).isSymbolicLink(), `${rel} is a real file`);
    assert.deepEqual(fs.readFileSync(`${root}/${rel}`), fs.readFileSync(`${REPO}/${rel}`), `${rel} is the real file's bytes`);
  }
  assert.ok(fs.lstatSync(`${root}/main/build/pipeline.js`).isFile());
  assert.deepEqual(fs.readFileSync(`${root}/main/build/pipeline.real.js`), fs.readFileSync(`${REPO}/main/build/pipeline.js`), 'the real pipeline is kept under its own name');
  assert.equal(compactRoot(REPO), root, 'one root per tree');
  assert.equal(fs.realpathSync(`${root}/engine`), fs.realpathSync(`${REPO}/engine`));
});

test('the proof itself rejects each way a compaction could go wrong, and accepts the real one (assertPreserved)', async () => {
  const { project } = await buildSceneProject({ root: REPO, ...SCENE });
  const compacted = structuredClone(project);
  compactActors(compacted);
  assert.deepEqual(assertPreserved(project, compacted), { entities: 15, placedTiles: 28 });
  const tamper = (fn) => { const c = structuredClone(compacted); fn(c); return c; };
  assert.throws(() => assertPreserved(project, tamper((c) => { placed(c)[0].x += 1; })), /changed a placed entity/);
  assert.throws(() => assertPreserved(project, tamper((c) => { placed(c).find((e) => c.sprites.actors[e.actorId].behavior === 'chaser').actorId = placed(c).find((e) => c.sprites.actors[e.actorId].behavior === 'npc').actorId; })), /changed a placed entity/);
  assert.throws(() => assertPreserved(project, tamper((c) => { c.sprites.actors[0].hp += 1; })), /changed a placed entity/);
  assert.throws(() => assertPreserved(project, tamper((c) => { c.sfx.push({ name: 'x' }); })), /something other than the actor table/);
  assert.throws(() => assertPreserved(project, tamper((c) => { c.sprites.metasprites[1].tiles.pop(); })), /changed a placed entity/);
  assert.throws(() => assertPreserved(project, tamper((c) => { placed(c)[0].actorId = 99; })), /places actor 99, which is not defined/);
});


test('preservation does not mask actorId outside placed entities', async () => {
  const { project } = await buildSceneProject({ root: REPO, ...SCENE });
  project.items = [{ name: 'probe', actorId: null }];
  const after = structuredClone(project);
  compactActors(after);
  assert.doesNotThrow(() => assertPreserved(project, after));
  after.items[0].actorId = 0;
  assert.throws(() => assertPreserved(project, after), /something other than the actor table/);
});
