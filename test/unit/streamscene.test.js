// Phase 3a slice S1, fix round 2 (R2-F1a): the frame-gate sweep's scene builder is itself under test.
//
// STREAM_TILE_BOUND is derived from Mesen runs of scenes built by test/lua/sw_manifest_scene.mjs. A scene whose
// "wide" far actor pointed at the wrong art measured a project whose projection bounds were NARROW (X 0..24, Y 0..8),
// and no downstream check could see it: the reference was valid, only wrong. So the builder asserts, after
// normalizeProject, that every actor's animation and poses are the intended ones and that streamProjBounds equals the
// intended bound of the art shape, and THIS file checks the same facts with its own arithmetic, for every animation
// preset x art shape, so `npm test` fails when the harness (not the engine) is wrong.
//
// Wrong implementations caught: a far actor whose animation/metasprite ids are computed from an earlier count
// (`msBase + used.length`) instead of the arrays' lengths at the moment of appending (the alternate-pose and the
// per-slot animation presets append a variable number of entries); a builder without its post-normalization
// assertion; a wide scene whose bounds are not -128..127, or a tight scene that has any; an animation with the wrong
// frame count, duration or pose; the emitted SW_U* constants (config.inc) disagreeing with the intended art.
//
// Also here: runManifest rejects (rather than crashing Node) when the emulator cannot be spawned, and its temp
// folders are gone afterwards.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSceneProject, assertSceneArt } from '../lua/sw_manifest_scene.mjs';
import { runManifest } from '../lua/run_sw_manifest.mjs';
import { ANIM_PRESETS } from '../lua/sw_bound_sweep.mjs';
import { streamProjBounds } from '../../shared/streamlayout.js';
import { generateAssets } from '../../main/build/generate.js';

const perSlot = (v, i, d) => (Array.isArray(v) ? v[i] : (v ?? d));
const SIZE_SETS = [
  [5, 2, 2, 2, 2, 2, 2, 1], // the reviewer's binding shape
  [6, 2, 2, 2, 2, 2, 2, 1],
  [16, 3, 0, 0, 0, 0, 0, 0], // zero-tile actors among sized ones, a full 4x4 grid
  [1, 1, 1, 1, 1, 1, 1, 1], // every actor the same size: one animation per (frames, durations) key
  [0, 0, 0, 0, 0, 0, 0, 0] // eight zero-tile metasprites
];
const isWideBound = (b) => b.OXMIN === -128 && b.OXMAX === 127 && b.OYMIN === -128 && b.OYMAX === 127;

// The bound of the intended TIGHT art, from the sizes alone (4-wide grids of 8x8 tiles at (0,0)).
function tightBound(sizes) {
  const k = Math.max(...sizes);
  return k === 0 ? { OXMIN: 0, OXMAX: 0, OYMIN: 0, OYMAX: 0 } : { OXMIN: 0, OXMAX: 8 * (Math.min(k, 4) - 1), OYMIN: 0, OYMAX: 8 * (Math.ceil(k / 4) - 1) };
}

function independentChecks(project, sizes, preset, wide, label) {
  const anim = ANIM_PRESETS[preset];
  const want = wide ? { OXMIN: -128, OXMAX: 127, OYMIN: -128, OYMAX: 127 } : tightBound(sizes);
  assert.deepEqual(streamProjBounds(project), want, `${label}: projection bounds`);
  if (wide) assert.ok(isWideBound(streamProjBounds(project)), `${label}: the far actor's art must give the wide bound`);
  // the chasers are actors 0-6, slot = index; the touch npc (7) and damage npc (last of the base three) are slot 7
  const actors = project.sprites.actors;
  const slotActors = [...Array.from({ length: 7 }, (_, i) => [i, i]), [7, 7], [8, 7]];
  for (const [id, slot] of slotActors) {
    const an = project.sprites.animations[actors[id].anims.walkDown];
    assert.ok(an, `${label}: actor ${id} has an animation`);
    assert.equal(an.frames.length, perSlot(anim?.frames, slot, 1), `${label}: actor ${id} frame count`);
    an.frames.forEach((fr, f) => {
      const d = perSlot(anim?.dur, slot, 8);
      assert.equal(fr.duration, Array.isArray(d) ? d[f % d.length] : d, `${label}: actor ${id} frame ${f} duration`);
      const tiles = project.sprites.metasprites[fr.metaspriteId].tiles.length;
      const full = sizes[slot];
      assert.equal(tiles, anim?.alt && f % 2 === 1 && full > 1 ? 1 : full, `${label}: actor ${id} frame ${f} pose size`);
    });
  }
  if (wide) {
    const far = actors.at(-1);
    assert.equal(far.name, 'WideFar');
    const an = project.sprites.animations[far.anims.walkDown];
    assert.equal(an.frames.length, 1, `${label}: far actor animation`);
    const ms = project.sprites.metasprites[an.frames[0].metaspriteId];
    assert.deepEqual(ms.tiles.map((t) => [t.x, t.y]), [[-128, -128], [127, 127]], `${label}: far actor draws the +-128 metasprite`);
  }
}

test('every animation preset x art shape builds the intended scene (animations, poses, far art, projection bounds)', async () => {
  let scenes = 0;
  for (const [preset, anim] of Object.entries(ANIM_PRESETS)) {
    for (const wide of [false, true]) {
      for (const sizes of SIZE_SETS) {
        const label = `${preset} ${wide ? 'wide' : 'tight'} [${sizes}]`;
        const { project } = await buildSceneProject({ sizes, wide, anim });
        independentChecks(project, sizes, preset, wide, label);
        scenes++;
      }
    }
  }
  assert.equal(scenes, Object.keys(ANIM_PRESETS).length * 2 * SIZE_SETS.length);
  assert.ok(Object.keys(ANIM_PRESETS).length >= 9, 'P0..P8, including the per-frame duration vectors');
});

test('the RPG scene shape (30-row grid, no Sfx) is built by the same rules', async () => {
  for (const [preset, anim] of Object.entries(ANIM_PRESETS)) {
    for (const wide of [false, true]) {
      const sizes = [5, 2, 2, 2, 2, 2, 2, 1];
      const { project } = await buildSceneProject({ gt: 'rpg', sizes, wide, anim });
      independentChecks(project, sizes, preset, wide, `rpg ${preset} ${wide ? 'wide' : 'tight'}`);
    }
  }
});

test('the emitted SW_U* constants (config.inc) carry the intended bounds for every preset x art shape', async () => {
  for (const [preset, anim] of Object.entries(ANIM_PRESETS)) {
    for (const wide of [false, true]) {
      const sizes = SIZE_SETS[0];
      const { project } = await buildSceneProject({ sizes, wide, anim });
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamscene-'));
      try {
        await generateAssets({ dir, project: structuredClone(project), log: () => {} });
        const cfg = fs.readFileSync(path.join(dir, 'build/assets/config.inc'), 'utf8');
        const got = {};
        for (const m of cfg.matchAll(/^SW_U(XMIN|XMAX|YMIN|YMAX) = (\d+)/gm)) got[`O${m[1]}`] = Number(m[2]) - 128;
        assert.deepEqual(got, wide ? { OXMIN: -128, OXMAX: 127, OYMIN: -128, OYMAX: 127 } : tightBound(sizes), `${preset} ${wide ? 'wide' : 'tight'}`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
});

test('the builder assertion is live: a far actor pointed at existing art, or a wrong pose, throws', async () => {
  const anim = ANIM_PRESETS.P2;
  const sizes = SIZE_SETS[0];
  const good = await buildSceneProject({ sizes, wide: true, anim });
  const ctx = (project) => {
    // rebuild the assertion context the way the builder holds it: chasers 0-6, touch npc 7, damage npc 8, far actor last
    const intended = new Map(project.sprites.actors.slice(0, 9).map((a, id) => [id, { slot: Math.min(id, 7), k: sizes[Math.min(id, 7)] }]));
    return { sizes, anim, wide: true, wideActor: project.sprites.actors.length - 1, intended };
  };
  assert.doesNotThrow(() => assertSceneArt(good.project, ctx(good.project)));
  // the pre-fix-round-2 defect: the far actor's animation is an existing one (here animation 0, a
  // busy actor's), a perfectly valid reference to the wrong art
  const wrongFar = structuredClone(good.project);
  const far = wrongFar.sprites.actors.at(-1);
  far.anims = { walkDown: 0, walkUp: 0, walkSide: 0 };
  assert.throws(() => assertSceneArt(wrongFar, ctx(wrongFar)), /far actor|projection bounds/);
  // a narrowed far metasprite (bounds not wide)
  const narrow = structuredClone(good.project);
  const farAn = narrow.sprites.animations[narrow.sprites.actors.at(-1).anims.walkDown];
  narrow.sprites.metasprites[farAn.frames[0].metaspriteId].tiles[1].x = 24;
  assert.throws(() => assertSceneArt(narrow, ctx(narrow)), /far actor|projection bounds/);
  // a wrong duration on one frame of one actor
  const dur = structuredClone(good.project);
  dur.sprites.animations[dur.sprites.actors[2].anims.walkDown].frames[1].duration += 1;
  assert.throws(() => assertSceneArt(dur, ctx(dur)), /duration/);
  // a wide scene whose bounds came out tight, and a tight scene carrying wide art
  const t = await buildSceneProject({ sizes, wide: false, anim });
  assert.throws(() => assertSceneArt(t.project, { ...ctx(t.project), wide: true, wideActor: t.project.sprites.actors.length - 1 }), /far actor/);
});

test('runManifest rejects, and leaves no temp folder, when the emulator cannot be spawned', async () => {
  const private_tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamscene-tmp-'));
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = private_tmp; // os.tmpdir() reads it at every call: the scene and the run folders land here
  try {
    await assert.rejects(runManifest({ mesen: path.join(private_tmp, 'no-such-mesen'), sizes: [2, 2, 2, 2, 2, 2, 2, 2] }), /ENOENT/);
    assert.deepEqual(fs.readdirSync(private_tmp), [], 'the run folder (with the built scene) was removed by finally');
  } finally {
    if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved;
    fs.rmSync(private_tmp, { recursive: true, force: true });
  }
});
