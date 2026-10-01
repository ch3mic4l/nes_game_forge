// Phase 3a slice S1, tests T5 (handoff-next/streamed-worlds-phase3a-plan.md section 7 "S1"): the inside class's
// derived bounds, and the reachable-pose enumerator that says they are sound.
//
// What is under test: SW_UXMIN..SW_UYMAX in build/assets/config.inc (= bound + 128), derived by streamProjBounds
// (shared/streamlayout.js) from the real art of every actor placed on a streamed map -- every authored frame of
// every facing plus metasprite 0 for a zero-frame animation. The engine's inside class (engine/streamworld.asm
// draw_one_entity_show_sw, dsw_in_tile) writes no per-tile range test, so a bound that is too small draws a tile
// off screen without parking it. Nothing here imports the generator's own notion of a pose or of the placed set:
// the scan, the tables and the enumerator are test code (test/lib/poseenumerator.js) written from the engine source.
//
//   T5(i)   derived bounds == an independent scan of the JSON, on fixtures whose extremal offsets sit (a) in a
//           later frame of a multi-frame animation, (b) only in the fallback metasprite 0 of a ZERO-FRAME
//           animation, (c) at -128/127 exactly; actors that are not placed on a streamed map do not widen them;
//           plus a seeded corpus. Vacuity guards: every fixture's bounds differ from a first-frame-only and from
//           an authored-frames-only computation (asserted in the test, so a sabotage of either kind has to move a
//           number this file compares).
//   T5(i)b  class level, on the real ROM: PC hits on dsw_cull_tile / dsw_in_tile / dsw_st_tile decide which class a
//           draw took; the expected class is computed from the independently scanned bounds and the position, at
//           the exact edge of every one of the four bounds (and the cull edges). Art beyond the inside class lands
//           in the straddle class, never inside, and a tile of an inside draw is always on screen.
//   T5(ii)  bounds(authored + zero-frame fallback) == bounds(every reachable pose), all five numbers (OXMIN, OXMAX,
//           OYMIN, OYMAX, max tile count), on the fixtures and on the ROM fixture, with the tables the ROM was
//           generated from. An empty enumeration must fail (states > 0 is part of the verdict).
//   T5(iii) one discriminating fixture per writer (Turn, Move blocked on its first tick, Move free, adoption): with
//           ONLY that writer's clamp switched off in the rule set the equality fails, on the bound that fixture
//           moves; withRawWriter refuses a rule set that does not model the writer, so a set lacking Move or
//           adoption fails these tests instead of passing vacuously. The pre-S0 rule set's violation count over a
//           seeded random corpus is logged (the precursor python model found 4,966 of 20,000 by pose-set
//           containment; this file counts poses outside the authored set and bound-moving cases separately).
//   Engine link: the model's entity_animate and move_face transitions are compared with the ROM's own routines
//           (callRoutine), exhaustively over a small state space, so the rule set the enumerator walks is the
//           shipped one and not a restatement of it.
//
// sw_held_fit (S2's adoption clamp) does not exist in this tree: adoption is modelled from the documented rule
// (plan section 2.4: frame := held frame clamped against the restored facing, timer stays 0).
//
// RAM addresses are transcribed from engine/constants.asm (comments on each); routine and table addresses come
// from the build's own game.fns.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import NES from '../../renderer/emulator/core/nes.js';
import { generateAssets } from '../../main/build/generate.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { buildRom, symbols } from '../lib/faceframescene.js';
import {
  FULL_RULES,
  PRE_S0_RULES,
  NO_ANIM,
  withRawWriter,
  placedActorIds,
  tablesFromProject,
  tablesFromSpritesInc,
  enumerateStates,
  animateStep,
  moveFaceStep,
  compareReachableToAuthored,
  authoredMetasprites,
  boundsOfMetasprites,
  facingAnims
} from '../lib/poseenumerator.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const needsRom = { skip: !hasNesasm && 'nesasm not found on PATH' };

// ------------------------------------------------------------------------------------------------ fixtures

const tile = (x, y) => ({ x, y, tile: 32, palette: 0, hflip: false, vflip: false });
const ms = (id, ...pts) => ({ id, name: `m${id}`, tiles: pts.map(([x, y]) => tile(x, y)) });
const anim = (id, ...frames) => ({ id, name: `a${id}`, loop: true, frames: frames.map(([metaspriteId, duration]) => ({ metaspriteId, duration })) });
const actor = (name, behavior, anims) => ({ name, behavior, hp: 1, damage: 0, speed: 1, anims });

/**
 * A streamed project (createStreamedProject, UNROM 512, 3x2 grid) with the given art. `placements` are
 * [actorId, screen, x, y]; an actor with no placement is not on any map. `turn` gives placement 0 an event
 * holding a Turn (which is what makes FACE_ENABLED, and so move_face, assemble). `ordinary` places the listed
 * actors on an ordinary map instead (a mixed project).
 */
function artProject({ metasprites, animations, actors, placements, turn = false, ordinary = [] }) {
  const p = createStreamedProject({ mixed: ordinary.length > 0, moveCommands: turn ? [{ op: 'turn', who: 'self', dir: 'up' }, { op: 'say', text: 'Hi' }] : undefined });
  p.sprites.metasprites = metasprites;
  p.sprites.animations = animations;
  p.sprites.actors = actors;
  const streamed = p.maps.find((m) => m.streamed === true);
  const event = streamed.screens[0].entities?.[0]?.props?.event;
  for (const screen of streamed.screens) screen.entities = [];
  placements.forEach(([actorId, screenIndex, x, y], i) => {
    streamed.screens[screenIndex].entities.push({ actorId, x, y, props: i === 0 && event ? { event } : {} });
  });
  if (ordinary.length) {
    const map = p.maps.find((m) => m.streamed !== true);
    map.screens[0].entities = ordinary.map((actorId, i) => ({ actorId, x: 20 + i * 16, y: 20, props: {} }));
  }
  return p;
}

// -- F_neg: negative offsets; the extremal tiles are in LATER frames, and the widest art (metasprite 4) belongs to
// actors that are not placed on a streamed map (one unplaced, one on an ordinary map).
const fNeg = () =>
  artProject({
    metasprites: [ms(0, [0, 0]), ms(1, [-8, -16], [0, 0]), ms(2, [-64, -32], [20, 40]), ms(3, [12, -100]), ms(4, [-128, 127])],
    animations: [anim(0, [0, 4], [1, 4], [2, 4]), anim(1, [3, 4]), anim(2, [4, 4])],
    actors: [actor('Placed', 'npc', { walkDown: 0, walkUp: 0, walkSide: 1 }), actor('Unplaced', 'npc', { walkDown: 2 }), actor('OnOrdinaryMap', 'npc', { walkDown: 2 })],
    placements: [[0, 0, 40, 40]],
    ordinary: [2]
  });
const F_NEG_EXPECT = { OXMIN: -64, OXMAX: 20, OYMIN: -100, OYMAX: 40, maxTiles: 2 };

// -- F_zero: the extremal offset is ONLY in metasprite 0, the fallback of a zero-frame animation.
const fZero = () =>
  artProject({
    metasprites: [ms(0, [-128, 100], [5, 5]), ms(1, [0, 0], [8, 8])],
    animations: [anim(0), anim(1, [1, 6])],
    actors: [actor('Fallback', 'npc', { walkDown: 0, walkUp: 1, walkSide: 1 })],
    placements: [[0, 0, 60, 60]]
  });
const F_ZERO_EXPECT = { OXMIN: -128, OXMAX: 8, OYMIN: 0, OYMAX: 100, maxTiles: 2 };

// -- F_edge: exactly -128 and 127 on both axes (SW_UXMIN = 0, SW_UXMAX = 255 must not wrap or clamp).
const fEdge = () =>
  artProject({
    metasprites: [ms(0, [-128, -128], [127, 127])],
    animations: [anim(0, [0, 5])],
    actors: [actor('Edge', 'npc', { walkDown: 0 })],
    placements: [[0, 0, 60, 60]]
  });

// -- The ROM fixture R: all three effects in one build. Bounds: x -100..30, y -50..60 (fallback m0 and later frame m2
// carry the extremes). Actor 2 walks side-ways on P, whose first frame lasts 255 (an 8-bit timer that never exceeds it).
const R_ART = () => ({
  metasprites: [ms(0, [-100, 60], [7, 7]), ms(1, [0, 0], [6, -6]), ms(2, [-10, -50], [30, 20]), ms(3, [0, 0])],
  animations: [anim(0), anim(1, [1, 3], [2, 3]), anim(2, [3, 2]), anim(3, [1, 255], [3, 2])],
  actors: [
    actor('Talker', 'npc', { walkDown: 1, walkUp: 2, walkSide: 1 }),
    actor('Patrol', 'patroller', { walkDown: 0, walkUp: 1, walkSide: 2 }),
    actor('Chase', 'chaser', { walkDown: 2, walkUp: 0, walkSide: 3 })
  ]
});
const fR = () => artProject({ ...R_ART(), placements: [[0, 0, 32, 32], [1, 1, 64, 64], [2, 2, 96, 96]], turn: true });
const R_EXPECT = { OXMIN: -100, OXMAX: 30, OYMIN: -50, OYMAX: 60, maxTiles: 2 };

// -- One fixture per writer. LONG (2 frames) / SHORT (1 frame) / NEXT (1 frame, unreferenced by any facing of any
// placed actor, emitted immediately after SHORT). An unclamped frame 1 on SHORT reads NEXT's frame 0. The NEXT tile
// moves a different bound per fixture.
function writerFixture(nextTile) {
  return artProject({
    metasprites: [ms(0, [0, 0]), ms(1, nextTile)],
    animations: [anim(0, [0, 3], [0, 3]), anim(1, [0, 3]), anim(2, [1, 3])],
    actors: [actor('Walker', 'npc', { walkDown: 0, walkUp: 1, walkSide: 1 })],
    placements: [[0, 0, 40, 40]]
  });
}
const WRITER_FIXTURES = {
  turn: { tile: [100, 0], bound: 'OXMAX', value: 100 },
  moveBlocked: { tile: [0, -90], bound: 'OYMIN', value: -90 },
  moveFree: { tile: [-70, 0], bound: 'OXMIN', value: -70 },
  adopt: { tile: [0, 80], bound: 'OYMAX', value: 80 }
};

// ------------------------------------------------------------------------------------------------ independent scan

/** OXMIN..OYMAX + max tile count over the JSON: placed on a streamed map, all four facings, every authored frame
 * plus metasprite 0 for a zero-frame animation. Own code; does not call streamProjBounds or animFor. */
function scan(project) {
  const t = tablesFromProject(project);
  const ids = new Set();
  for (const a of placedActorIds(project)) for (const id of authoredMetasprites(t, a)) ids.add(id);
  const b = boundsOfMetasprites(project, ids);
  assert.equal(b.unresolved, 0);
  return b;
}

/** first frame of each facing's animation only (what sabotage 3 computes), and authored frames only (sabotage 12). */
function alternates(project) {
  const first = new Set();
  const authoredOnly = new Set();
  for (const id of placedActorIds(project)) {
    for (const a of facingAnims(project.sprites.actors[id])) {
      if (a === NO_ANIM) continue;
      const frames = project.sprites.animations[a].frames;
      if (frames.length) {
        first.add(frames[0].metaspriteId);
        for (const f of frames) authoredOnly.add(f.metaspriteId);
      } else first.add(0);
    }
  }
  return { firstFrameOnly: boundsOfMetasprites(project, first), authoredOnly: boundsOfMetasprites(project, authoredOnly) };
}

async function generated(project) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streambounds-'));
  try {
    await generateAssets({ dir, project: structuredClone(project), log: () => {} });
    const cfg = fs.readFileSync(path.join(dir, 'build/assets/config.inc'), 'utf8');
    const sprites = fs.readFileSync(path.join(dir, 'build/assets/sprites.inc'), 'utf8');
    const u = {};
    for (const m of cfg.matchAll(/^SW_U(XMIN|XMAX|YMIN|YMAX) = (\d+)/gm)) u[`O${m[1]}`] = Number(m[2]) - 128;
    return { cfg, sprites, u, enabled: /^STREAM_PROJ_ENABLED = 1$/m.test(cfg), hasU: Object.keys(u).length };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const four = (b) => ({ OXMIN: b.OXMIN, OXMAX: b.OXMAX, OYMIN: b.OYMIN, OYMAX: b.OYMAX });

// ------------------------------------------------------------------------------------------------ seeded PRNG

function rng(seed) {
  let s = seed >>> 0;
  return (n) => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s % n;
  };
}
const OFFSETS = [-128, -100, -64, -8, -1, 0, 1, 8, 63, 100, 127];
const BEHAVIORS = ['npc', 'patroller', 'chaser', 'pickup', 'door'];

/** A random art set as a bare project (enough for the enumerator and the scan; not buildable). */
function randomArt(r, { durations = [1, 2, 3], zeroFrame = true } = {}) {
  const nMs = 2 + r(4);
  const metasprites = Array.from({ length: nMs }, (_, i) => ms(i, ...Array.from({ length: r(4) }, () => [OFFSETS[r(OFFSETS.length)], OFFSETS[r(OFFSETS.length)]])));
  const nAn = 2 + r(4);
  const animations = Array.from({ length: nAn }, (_, i) =>
    anim(i, ...Array.from({ length: zeroFrame ? r(4) : 1 + r(3) }, () => [r(nMs), durations[r(durations.length)]]))
  );
  const nAct = 1 + r(3);
  const pick = () => (r(4) === 0 ? null : r(nAn));
  const actors = Array.from({ length: nAct }, () => actor('x', BEHAVIORS[r(BEHAVIORS.length)], { walkDown: pick(), walkUp: pick(), walkSide: pick(), idle: r(3) === 0 ? r(nAn) : null }));
  return {
    maps: [{ streamed: true, screens: [{ entities: actors.map((_, i) => ({ actorId: i })) }] }],
    sprites: { metasprites, animations, actors }
  };
}

// ================================================================================================ T5(i)

for (const [label, make, expect] of [
  ['negative offsets in later frames; wide art on unplaced and ordinary-map actors excluded', fNeg, F_NEG_EXPECT],
  ['extremal offset only in the zero-frame fallback (metasprite 0)', fZero, F_ZERO_EXPECT],
  ['exactly -128 and 127 on both axes', fEdge, { OXMIN: -128, OXMAX: 127, OYMIN: -128, OYMAX: 127, maxTiles: 2 }],
  ['the ROM fixture R (fallback and later-frame extremes together)', fR, R_EXPECT]
]) {
  test(`T5(i) derived bounds equal an independent scan of the art: ${label}`, async () => {
    const project = make();
    const mine = scan(project);
    assert.deepEqual(mine, { ...expect, unresolved: 0 }, 'the independent scan disagrees with the fixture design');
    const g = await generated(project);
    assert.ok(g.enabled, 'STREAM_PROJ_ENABLED must be on when an actor is placed on a streamed map');
    assert.deepEqual(g.u, four(mine), 'SW_UXMIN..SW_UYMAX (minus 128) must equal the scan');
    // vacuity guards: each sabotage of the derivation has to move a number this test compares
    const alt = alternates(project);
    if (make === fNeg || make === fR) {
      assert.notDeepEqual(four(alt.firstFrameOnly), four(mine), 'fixture does not discriminate first-frame-only bounds');
    }
    if (make === fZero || make === fR) {
      assert.notDeepEqual(four(alt.authoredOnly), four(mine), 'fixture does not discriminate authored-frames-only bounds (the fallback must carry an extreme)');
    }
    for (const v of Object.values(g.u)) assert.ok(v >= -128 && v <= 127);
  });
}

test('T5(i) no art to bound: all four bounds are zero (SW_U* = 128); no placed actor: no SW_U* and the projection is off', async () => {
  const noTiles = artProject({
    metasprites: [ms(0)],
    animations: [anim(0, [0, 5])],
    actors: [actor('Ghost', 'npc', { walkDown: 0 })],
    placements: [[0, 0, 40, 40]]
  });
  assert.deepEqual(scan(noTiles), { OXMIN: 0, OXMAX: 0, OYMIN: 0, OYMAX: 0, maxTiles: 0, unresolved: 0 });
  const g = await generated(noTiles);
  assert.ok(g.enabled);
  assert.deepEqual(g.u, { OXMIN: 0, OXMAX: 0, OYMIN: 0, OYMAX: 0 });
  const unplaced = artProject({ metasprites: [ms(0, [3, 3])], animations: [anim(0, [0, 5])], actors: [actor('Nobody', 'npc', { walkDown: 0 })], placements: [] });
  const h = await generated(unplaced);
  assert.equal(h.enabled, false);
  assert.equal(h.hasU, 0, 'a streaming project with no placed actor emits no SW_U*');
});

test('T5(i) a seeded corpus of 30 random art sets: generated bounds equal the independent scan', async () => {
  const r = rng(20260929);
  let widest = 0;
  for (let i = 0; i < 30; i++) {
    const art = randomArt(r, { durations: [1, 2, 5, 8] });
    const p = artProject({
      metasprites: art.sprites.metasprites,
      animations: art.sprites.animations,
      actors: art.sprites.actors,
      placements: art.sprites.actors.map((_, k) => [k, k % 6, 20 + 10 * k, 30])
    });
    const mine = scan(p);
    const g = await generated(p);
    assert.deepEqual(g.u, four(mine), `random art set #${i}`);
    widest = Math.max(widest, mine.OXMAX - mine.OXMIN);
  }
  assert.ok(widest > 0, 'the corpus produced no art at all');
  console.log(`# T5(i) corpus: 30 random art sets checked, widest X span seen ${widest}`);
});

// ================================================================================================ T5(ii)

test('T5(ii) the enumerator rule set models every transition the plan requires', () => {
  assert.deepEqual(
    Object.keys(FULL_RULES).sort(),
    ['adopt', 'animate', 'chase', 'moveBlocked', 'moveFree', 'patrol', 'spawnOrdinary', 'spawnStreamed', 'turn'],
    'spawn (ordinary and streamed), animate, patrol, chase, Turn, Move (blocked and free), adoption'
  );
  for (const w of ['turn', 'moveBlocked', 'moveFree', 'adopt']) assert.equal(FULL_RULES[w], 'clamp', w);
  for (const w of ['spawnOrdinary', 'spawnStreamed', 'animate', 'patrol', 'chase']) assert.equal(FULL_RULES[w], true, w);
  assert.equal(PRE_S0_RULES.turn, 'raw');
  assert.equal(PRE_S0_RULES.moveBlocked, 'raw');
  assert.equal(PRE_S0_RULES.adopt, null);
});

for (const [label, make, expect] of [
  ['F_neg', fNeg, F_NEG_EXPECT],
  ['F_zero', fZero, F_ZERO_EXPECT],
  ['F_edge', fEdge, { OXMIN: -128, OXMAX: 127, OYMIN: -128, OYMAX: 127, maxTiles: 2 }],
  ['R', fR, R_EXPECT]
]) {
  test(`T5(ii) bounds over authored frames + zero-frame fallback equal bounds over every reachable pose: ${label}`, async () => {
    const project = make();
    const g = await generated(project);
    const fromInc = tablesFromSpritesInc(g.sprites);
    const fromJson = tablesFromProject(project);
    assert.deepEqual({ start: fromInc.start, count: fromInc.count.map(Number), data: fromInc.data, dir: fromInc.actorAnimDir }, { start: fromJson.start, count: fromJson.count, data: fromJson.data, dir: fromJson.actorAnimDir }, 'the replica of the emitted tables must equal sprites.inc');
    const v = compareReachableToAuthored(project, fromInc, FULL_RULES);
    assert.ok(v.states > 0, 'empty enumeration');
    assert.deepEqual(v.moved, [], `bounds moved: authored ${JSON.stringify(v.authored)} reachable ${JSON.stringify(v.reachable)}`);
    assert.equal(v.ok, true);
    assert.deepEqual(four(v.reachable), g.u, 'the reachable bounds equal the generated SW_U* (minus 128)');
    assert.equal(v.reachable.maxTiles, expect.maxTiles);
    assert.deepEqual(v.outsideAuthored, []);
  });
}

test('T5(ii) an empty reachable set fails the equality (it is not pose-set containment)', () => {
  const project = fNeg();
  const tables = tablesFromProject(project);
  const none = compareReachableToAuthored(project, tables, { ...FULL_RULES, spawnOrdinary: false, spawnStreamed: false });
  assert.equal(none.states, 0);
  assert.equal(none.ok, false);
  // and a set that only spawns (frame 0 of DOWN) is too small: authored extremes live in later frames and other facings
  const spawnOnly = compareReachableToAuthored(project, tables, { spawnOrdinary: true, spawnStreamed: true });
  assert.equal(spawnOnly.ok, false);
  assert.ok(spawnOnly.moved.length > 0);
  // every transition group is load-bearing: without animate the later-frame extremes are unreachable
  const noAnimate = compareReachableToAuthored(project, tables, { ...FULL_RULES, animate: false, patrol: false, chase: false });
  assert.equal(noAnimate.ok, false, 'without animate only frame 0 of each facing is reachable: the later-frame extremes are missed');
  assert.ok(noAnimate.moved.length > 0);
});

// ================================================================================================ T5(iii)

for (const [writer, fx] of Object.entries(WRITER_FIXTURES)) {
  test(`T5(iii) ${writer}: the fixture is clean with every clamp on; the ${writer} clamp off alone moves ${fx.bound}`, async () => {
    const project = writerFixture(fx.tile);
    assert.equal(scan(project).maxTiles, 1);
    assert.deepEqual(four(scan(project)), { OXMIN: 0, OXMAX: 0, OYMIN: 0, OYMAX: 0 }, 'NEXT is unreferenced, so the authored bounds are the narrow art');
    const g = await generated(project);
    const tables = tablesFromSpritesInc(g.sprites);
    const clean = compareReachableToAuthored(project, tables, FULL_RULES);
    assert.equal(clean.ok, true);
    assert.deepEqual(clean.moved, []);
    const raw = compareReachableToAuthored(project, tables, withRawWriter(FULL_RULES, writer));
    assert.equal(raw.ok, false);
    assert.equal(raw.reachable[fx.bound], fx.value, `${writer} unclamped reads NEXT's tile`);
    assert.ok(raw.moved.includes(fx.bound));
    assert.deepEqual(raw.outsideAuthored, [1], 'the unauthored pose is metasprite 1');
    // no other writer's absence is needed to see it: every other writer stays clamped in this rule set
    for (const other of Object.keys(WRITER_FIXTURES).filter((w) => w !== writer)) assert.equal(withRawWriter(FULL_RULES, writer)[other], 'clamp');
  });
}

test('T5(iii) a rule set that models neither Move nor adoption cannot run their ablations (it would pass vacuously)', () => {
  const precursor = { ...FULL_RULES, moveBlocked: null, moveFree: null, adopt: null };
  for (const w of ['moveBlocked', 'moveFree', 'adopt']) assert.throws(() => withRawWriter(precursor, w), /does not model/);
  assert.doesNotThrow(() => withRawWriter(precursor, 'turn'));
  // and the pre-S0 rule set on every writer fixture is caught by the equality
  for (const fx of Object.values(WRITER_FIXTURES)) {
    const project = writerFixture(fx.tile);
    const v = compareReachableToAuthored(project, tablesFromProject(project), PRE_S0_RULES);
    assert.equal(v.ok, false);
    assert.ok(v.moved.includes(fx.bound));
  }
});

test('T5(iii) violation counts over a seeded random corpus: pre-S0 rule set versus every clamp on', () => {
  const r = rng(424242);
  const N = 20000;
  const count = { pre: 0, preOutside: 0, post: 0, postOutside: 0, empty: 0, unresolved: 0 };
  const perWriter = { turn: 0, moveBlocked: 0, moveFree: 0, adopt: 0 };
  let firstPre = null;
  for (let i = 0; i < N; i++) {
    const p = randomArt(r);
    const t = tablesFromProject(p);
    const pre = compareReachableToAuthored(p, t, PRE_S0_RULES);
    const post = compareReachableToAuthored(p, t, FULL_RULES);
    if (!pre.ok) count.pre++;
    if (pre.outsideAuthored.length || pre.oob) count.preOutside++;
    if (!post.ok) count.post++;
    if (post.outsideAuthored.length || post.oob) count.postOutside++;
    if (post.states === 0) count.empty++;
    if (!pre.ok && !firstPre) firstPre = { seed: i, moved: pre.moved };
    for (const w of Object.keys(perWriter)) if (!compareReachableToAuthored(p, t, withRawWriter(FULL_RULES, w)).ok) perWriter[w]++;
  }
  console.log(`# T5(iii) corpus (${N} random art sets, seed 424242): pre-S0 rule set: ${count.pre} bound-moving, ${count.preOutside} with a pose outside the authored set; all clamps on: ${count.post} bound-moving, ${count.postOutside} outside; single writer raw: ${JSON.stringify(perWriter)}; first pre-S0 case #${firstPre?.seed} moved ${firstPre?.moved}`);
  assert.equal(count.post, 0, 'with every clamp on, reachable bounds equal authored bounds in every case');
  assert.equal(count.postOutside, 0);
  assert.equal(count.empty, 0);
  assert.ok(count.pre > 0, 'the pre-S0 rule set must be detected on this corpus');
  assert.ok(count.preOutside >= count.pre, 'a bound can only move if a pose outside the authored set was reached');
  for (const [w, n] of Object.entries(perWriter)) assert.ok(n > 0, `${w} raw alone must be detectable on this corpus`);
});

test('T5(iii) durations of 254/255 in the mix: with every clamp on, every reachable pose is authored; a failure can only be an authored frame the 8-bit timer never reaches', () => {
  const r = rng(99);
  let pinned = 0;
  for (let i = 0; i < 3000; i++) {
    const p = randomArt(r, { durations: [1, 3, 254, 255] });
    const v = compareReachableToAuthored(p, tablesFromProject(p), FULL_RULES);
    assert.deepEqual(v.outsideAuthored, [], 'reachable poses are always authored');
    assert.equal(v.oob, 0);
    if (!v.ok) {
      pinned++;
      // the only way to fail with every clamp on is a metasprite the timer never reaches: a strict subset of the authored ids
      assert.ok(v.reachableIds.every((id) => v.authoredIds.includes(id)) && v.reachableIds.length < v.authoredIds.length);
    }
  }
  console.log(`# T5(iii) durations 254/255: ${pinned} of 3000 art sets have an authored frame the timer can never reach (a strict subset of the authored metasprites is reachable, never a foreign one)`);
  assert.ok(pinned > 0, 'the corpus must contain the pinned-frame case, or the superset branch above is untested');
});

// ================================================================================================ ROM: engine link and classes

// from engine/constants.asm
const OAM_IDX = 0x20;
const TALK_ENT = 0x3a;
const MV_WHO = 0x94; // mv_who = sv_len+1 (constants.asm): 0 = an entity, otherwise the player
const MAP_IS_STREAMED = 0xfe;
const ENT_ACTIVE = 0x0300;
const ENT_ACTOR = 0x0308;
const ENT_X = 0x0310;
const ENT_Y = 0x0318;
const ENT_DIR = 0x0320;
const ENT_FRAME = 0x0328;
const ENT_TIMER = 0x0330;
const ENT_HURT = 0x0388;
const SW_COL = 0x05a0;
const SW_ROW = 0x05a1;
const SW_CAM_X_LO = 0x035c;
const SW_CAM_X_HI = 0x035d;
const SW_CAM_Y_LO = 0x035e;
const SW_CAM_Y_HI = 0x035f;
const OAM = 0x0200;

let romPromise;
function romR() {
  romPromise ??= buildRom(fR());
  return romPromise;
}

function fresh(rom) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(rom);
  return nes;
}

/** callRoutine (test/lib/callroutine.js), with the registers preset and the PCs of chosen labels counted.
 * REG_PC holds the address of the instruction BEFORE the one about to run, hence the +1. */
function call(nes, address, { a = 0, x = 0, y = 0, watch = {} } = {}) {
  nes.mmap.write(0x2000, 0);
  nes.cpu.irqRequested = false;
  nes.cpu.F_INTERRUPT = 1;
  nes.cpu.mem.set([0x20, address & 255, address >> 8, 0xea], 0x700);
  nes.cpu.REG_PC = 0x6ff;
  nes.cpu.REG_ACC = a;
  nes.cpu.REG_X = x;
  nes.cpu.REG_Y = y;
  const hits = Object.fromEntries(Object.keys(watch).map((k) => [k, 0]));
  const byPc = new Map(Object.entries(watch).map(([k, v]) => [v, k]));
  let steps = 0;
  while (nes.cpu.REG_PC + 1 !== 0x703) {
    const label = byPc.get(nes.cpu.REG_PC + 1);
    if (label) hits[label]++;
    nes.cpu.emulate();
    assert.ok(++steps < 200000, 'routine never returned');
  }
  return hits;
}

test('ROM fixture R builds: the projection is on, move_face is assembled, and its bounds are the design figures', needsRom, async () => {
  const { rom, syms } = await romR();
  for (const name of ['dsw_in_tile', 'dsw_cull_tile', 'dsw_st_tile', 'draw_entities', 'entity_animate', 'move_face']) assert.ok(name in syms, `${name} missing from game.fns`);
  assert.equal(rom[0], 0x4e);
});

test('T5(ii) the tables in the ROM are laid out back to back exactly as the replica assumes (anim_data_N addresses in game.fns)', needsRom, async () => {
  const { syms } = await romR();
  const project = fR();
  const t = tablesFromProject(project);
  for (let i = 0; i + 1 < project.sprites.animations.length; i++) {
    assert.equal(syms[`anim_data_${i + 1}`] - syms[`anim_data_${i}`], Math.max(1, 2 * project.sprites.animations[i].frames.length), `anim_data_${i} .. anim_data_${i + 1}`);
    assert.equal(t.start[i + 1] - t.start[i], syms[`anim_data_${i + 1}`] - syms[`anim_data_${i}`]);
  }
});

test('Engine link: entity_animate and move_face in the ROM equal the enumerator transitions (exhaustive over a small state space)', needsRom, async () => {
  const { rom, syms } = await romR();
  const project = fR();
  const tables = tablesFromProject(project);
  const nes = fresh(rom);
  const mem = nes.cpu.mem;
  let animateCases = 0;
  let faceCases = 0;
  let rawDiffers = 0;
  const slot = 3;
  for (let a = 0; a < project.sprites.actors.length; a++) {
    for (let dir = 0; dir < 4; dir++) {
      for (const frame of [0, 1, 2, 3, 5]) {
        for (const timer of [0, 1, 2, 3, 4, 254, 255]) {
          const s = { dir, frame, timer };
          const setup = () => {
            mem[ENT_ACTOR + slot] = a;
            mem[ENT_DIR + slot] = dir;
            mem[ENT_FRAME + slot] = frame;
            mem[ENT_TIMER + slot] = timer;
          };
          setup();
          call(nes, syms.entity_animate, { x: slot });
          const got = { dir: mem[ENT_DIR + slot], frame: mem[ENT_FRAME + slot], timer: mem[ENT_TIMER + slot] };
          assert.deepEqual(got, animateStep(tables, a, s), `entity_animate actor ${a} ${JSON.stringify(s)}`);
          animateCases++;
          for (let nd = 0; nd < 4; nd++) {
            setup();
            mem[TALK_ENT] = slot;
            mem[MV_WHO] = 0;
            call(nes, syms.move_face, { a: nd, x: 0 });
            const face = { dir: mem[ENT_DIR + slot], frame: mem[ENT_FRAME + slot], timer: mem[ENT_TIMER + slot] };
            assert.deepEqual(face, moveFaceStep(tables, a, s, nd, 'clamp'), `move_face actor ${a} ${JSON.stringify(s)} -> ${nd}`);
            if (JSON.stringify(moveFaceStep(tables, a, s, nd, 'raw')) !== JSON.stringify(face)) rawDiffers++;
            faceCases++;
          }
        }
      }
    }
  }
  assert.ok(rawDiffers > 50, `the clamp must matter on this state space (${rawDiffers} cases where raw != shipped)`);
  console.log(`# engine link: ${animateCases} entity_animate and ${faceCases} move_face cases equal the model; ${rawDiffers} of them are cases the clamp changes`);
});

test('Engine link: a frame whose duration is 255 never advances (8-bit timer), in the ROM and in the model', needsRom, async () => {
  const { rom, syms } = await romR();
  const project = fR();
  const tables = tablesFromProject(project);
  const nes = fresh(rom);
  const mem = nes.cpu.mem;
  // actor 2 walks side-ways on animation 3 (frame 0 lasts 255); facing LEFT = 2
  mem[ENT_ACTOR] = 2;
  mem[ENT_DIR] = 2;
  mem[ENT_FRAME] = 0;
  mem[ENT_TIMER] = 0;
  let s = { dir: 2, frame: 0, timer: 0 };
  for (let i = 0; i < 700; i++) {
    call(nes, syms.entity_animate, { x: 0 });
    s = animateStep(tables, 2, s);
    assert.deepEqual({ frame: mem[ENT_FRAME], timer: mem[ENT_TIMER] }, { frame: s.frame, timer: s.timer }, `step ${i}`);
  }
  assert.equal(mem[ENT_FRAME], 0, 'still on frame 0 after 700 animate ticks');
  console.log('# note: an authored frame with duration 255 pins the animation (timer wraps 255 -> 0 and never exceeds the duration); later frames of that animation are never drawn');
});

// ---- class-level checks

const CLASSES = ['cull', 'inside', 'straddle'];

/** Which class draw_one_entity_show_sw took, by PC hits. Screen position (sx, sy) of the entity's ORIGIN. */
function classOf(nes, syms, { actorId, dir, frame, sx, sy }) {
  const mem = nes.cpu.mem;
  mem.fill(0xee, OAM, OAM + 256); // a distinct prefill: an untouched slot stays visible
  mem[OAM_IDX] = 0x20;
  mem[MAP_IS_STREAMED] = 1;
  mem[SW_COL] = 0;
  mem[SW_ROW] = 0;
  const entX = 100;
  const entY = 100;
  const camX = (entX - sx) & 0xffff;
  const camY = (entY - sy) & 0xffff;
  mem[SW_CAM_X_LO] = camX & 255;
  mem[SW_CAM_X_HI] = camX >> 8;
  mem[SW_CAM_Y_LO] = camY & 255;
  mem[SW_CAM_Y_HI] = camY >> 8;
  for (let i = 0; i < 8; i++) {
    mem[ENT_ACTIVE + i] = i === 0 ? 1 : 0;
    mem[ENT_HURT + i] = 0;
  }
  mem[ENT_ACTOR] = actorId;
  mem[ENT_X] = entX;
  mem[ENT_Y] = entY;
  mem[ENT_DIR] = dir;
  mem[ENT_FRAME] = frame;
  mem[ENT_TIMER] = 0;
  const hits = call(nes, syms.draw_entities, { watch: { cull: syms.dsw_cull_tile, inside: syms.dsw_in_tile, straddle: syms.dsw_st_tile } });
  const taken = CLASSES.filter((c) => hits[c] > 0);
  assert.equal(taken.length, 1, `exactly one class must run (${JSON.stringify(hits)}) at ${sx},${sy}`);
  return taken[0];
}

/** The expected class from the position and the independently scanned bounds (plan section 3.2's table). */
function expectedClass(b, sx, sy) {
  // base = origin - 128 (16 bit): its high byte must be $00 or $FF, i.e. base in -256..255
  if (sx - 128 < -256 || sx - 128 > 255 || sy - 128 < -256 || sy - 128 > 255) return 'cull';
  if (sx + b.OXMIN >= 0 && sx + b.OXMAX <= 255 && sy + b.OYMIN >= 0 && sy + b.OYMAX <= 239) return 'inside';
  return 'straddle';
}

test('T5(i)b class level: cull, inside and straddle are decided by the independently derived bounds, at the exact edge of every bound', needsRom, async () => {
  const { rom, syms } = await romR();
  const project = fR();
  const b = scan(project);
  const nes = fresh(rom);
  // poses: actor 0 (Talker) down frame 0 / frame 1; actor 1 (Patrol) down = ZERO-FRAME animation (metasprite 0 fallback)
  const poses = [
    { actorId: 0, dir: 0, frame: 0 },
    { actorId: 0, dir: 0, frame: 1 },
    { actorId: 1, dir: 0, frame: 0 }
  ];
  const xs = new Set([-129, -128, -127, -b.OXMIN - 1, -b.OXMIN, 255 - b.OXMAX, 256 - b.OXMAX, 383, 384, 100]);
  const ys = new Set([-129, -128, -127, -b.OYMIN - 1, -b.OYMIN, 239 - b.OYMAX, 240 - b.OYMAX, 383, 384, 100]);
  const seen = { cull: 0, inside: 0, straddle: 0 };
  let edgeInside = 0;
  let edgeStraddle = 0;
  const check = (pose, sx, sy) => {
    const got = classOf(nes, syms, { ...pose, sx, sy });
    const want = expectedClass(b, sx, sy);
    assert.equal(got, want, `pose ${JSON.stringify(pose)} at screen ${sx},${sy}: the engine took ${got}, the derived bounds say ${want}`);
    seen[got]++;
    return got;
  };
  for (const pose of poses) {
    for (const sx of xs) for (const sy of [100, ...ys]) check(pose, sx, sy);
    for (const sy of ys) for (const sx of [100, ...xs]) check(pose, sx, sy);
  }
  // the exact edges, one bound at a time, with the other axis comfortably inside
  for (const pose of poses) {
    if (check(pose, -b.OXMIN, 100) === 'inside') edgeInside++;
    if (check(pose, -b.OXMIN - 1, 100) === 'straddle') edgeStraddle++;
    if (check(pose, 255 - b.OXMAX, 100) === 'inside') edgeInside++;
    if (check(pose, 256 - b.OXMAX, 100) === 'straddle') edgeStraddle++;
    if (check(pose, 100, -b.OYMIN) === 'inside') edgeInside++;
    if (check(pose, 100, -b.OYMIN - 1) === 'straddle') edgeStraddle++;
    if (check(pose, 100, 239 - b.OYMAX) === 'inside') edgeInside++;
    if (check(pose, 100, 240 - b.OYMAX) === 'straddle') edgeStraddle++;
  }
  assert.equal(edgeInside, 12);
  assert.equal(edgeStraddle, 12);
  assert.ok(seen.cull > 0 && seen.inside > 0 && seen.straddle > 0, `every class must be exercised ${JSON.stringify(seen)}`);
  console.log(`# T5(i)b classes exercised: ${JSON.stringify(seen)} (bounds ${JSON.stringify(four(b))})`);
});

test('T5(i)b the fallback-extremal pose: a zero-frame facing straddles exactly when its metasprite-0 tile leaves the screen; an inside draw never leaves it', needsRom, async () => {
  const { rom, syms } = await romR();
  const project = fR();
  const b = scan(project);
  const nes = fresh(rom);
  const fallbackTiles = project.sprites.metasprites[0].tiles; // actor 1 faces DOWN on the zero-frame animation
  const onScreen = (sx, sy, tiles) => tiles.every((t) => sx + t.x >= 0 && sx + t.x <= 255 && sy + t.y >= 0 && sy + t.y <= 239);
  // one pixel inside the extremal tile's edge: the tile at x = -100 is on screen at sx = 100 and off at sx = 99
  const sxOn = -Math.min(...fallbackTiles.map((t) => t.x));
  assert.equal(sxOn, -b.OXMIN, 'the fallback carries the X minimum');
  const on = classOf(nes, syms, { actorId: 1, dir: 0, frame: 0, sx: sxOn, sy: 100 });
  const off = classOf(nes, syms, { actorId: 1, dir: 0, frame: 0, sx: sxOn - 1, sy: 100 });
  assert.equal(on, 'inside');
  assert.equal(off, 'straddle');
  assert.equal(onScreen(sxOn, 100, fallbackTiles), true);
  assert.equal(onScreen(sxOn - 1, 100, fallbackTiles), false, 'the drawn tile really is off screen there, so inside would have been a wrong draw');
  // soundness sweep: wherever the engine says inside, every tile of the drawn pose is on screen
  let insideDraws = 0;
  for (const pose of [{ actorId: 1, dir: 0, frame: 0 }, { actorId: 0, dir: 0, frame: 1 }, { actorId: 0, dir: 0, frame: 0 }]) {
    const tiles = project.sprites.metasprites[resolveMs(project, pose)].tiles;
    for (let sx = -140; sx <= 400; sx += 7) {
      for (const sy of [-60, 0, 49, 50, 100, 179, 180, 300]) {
        if (classOf(nes, syms, { ...pose, sx, sy }) === 'inside') {
          insideDraws++;
          assert.ok(onScreen(sx, sy, tiles), `inside class drew an off-screen tile: ${JSON.stringify(pose)} at ${sx},${sy}`);
        }
      }
    }
  }
  assert.ok(insideDraws > 20, 'the sweep produced inside draws');
});

function resolveMs(project, { actorId, dir, frame }) {
  const t = tablesFromProject(project);
  const a = t.actorAnimDir[actorId * 4 + dir];
  return t.count[a] === 0 ? 0 : t.data[t.start[a] + 2 * frame];
}

test('T5(ii) equality on the ROM fixture with the tables read from the ROM itself (anim_data bytes at the game.fns addresses)', needsRom, async () => {
  const { rom, syms } = await romR();
  const project = fR();
  // the concatenated animation bytes as the CPU sees them, from PRG: kernel-lo lookups are in the fixed bank
  const prgBase = 16; // iNES header; the fixed $C000-$FFFF bank is the LAST 16 KB of PRG
  const prgSize = rom[4] * 16384;
  const fixedStart = prgBase + prgSize - 16384;
  const at = (addr) => rom[fixedStart + (addr - 0xc000)];
  const t = tablesFromProject(project);
  const last = project.sprites.animations.length - 1;
  const endAddr = syms[`anim_data_${last}`] + Math.max(1, 2 * project.sprites.animations[last].frames.length);
  const romData = [];
  for (let addr = syms.anim_data_0; addr < endAddr; addr++) romData.push(at(addr));
  assert.deepEqual(romData, t.data, 'anim_data_0.. in the ROM equals the replica byte for byte');
  const romActorDir = [];
  for (let i = 0; i < project.sprites.actors.length * 4; i++) romActorDir.push(at(syms.actor_anim_dir + i));
  assert.deepEqual(romActorDir, t.actorAnimDir);
  const romCount = [];
  for (let i = 0; i <= last; i++) romCount.push(at(syms.anim_count + i));
  assert.deepEqual(romCount, t.count);
  const v = compareReachableToAuthored(project, { start: t.start, count: romCount, data: romData, actorAnimDir: romActorDir }, FULL_RULES);
  assert.equal(v.ok, true);
  assert.deepEqual(v.reachable, { ...R_EXPECT, unresolved: 0 });
});
