// Phase 3a slice S1, option (a1): the mover parity gate (engine/entities.asm, update_entities_behave).
//
// The rule: in a project that has a streamed map, each autonomous mover (patrol, chase, pickup, door) runs its
// behaviour only on bodies where (slot xor frame_cnt) & 1 == 0; animation, contact and touch still run every
// body; scripted Move is not reached through the gate at all. A project with no streamed map assembles none of it.
//
// What is asserted, and why each cannot be met by a wrong gate:
//   - GATE RULE: at every arrival at update_entities_behave (mover_parity_gate) the registers are recorded, and at
//     every arrival at mover_parity_gate_end (the behaviour dispatch). A visit passes the gate exactly when
//     (X xor frame_cnt) & 1 == 0, for every slot and every body -- the WHOLE truth table, not one slot.
//       * no `eor <frame_cnt`: slot parity alone decides (even slots always pass, odd slots never do), so the
//         frame_cnt term is gone and the table fails on half its rows.
//       * `bne` -> `beq`: the complementary parity passes: every row is inverted.
//       * no gate at all: every visit passes.
//   - RATE: two patrollers of speed 1, one per parity, advance exactly half as far as the same two in an ordinary
//     project over the same number of bodies, and the pair together covers every body (none starved).
//   - SCRIPTED MOVE is not halved: a scripted Move of 8 px on a streamed map takes the same number of bodies as on
//     an ordinary map.
//   - EVERY BODY: entity_animate, entity_contact and entity_trigger_touch are each called at every visit, including
//     the visits the gate sends past the behaviour (slot and frame_cnt both recorded), and two authored animated
//     patrollers' (ent_frame, ent_timer) follow the animation rule's own step exactly once per body -- a body that
//     skipped the animation would leave the timer a step behind the model.
// Each wrong gate (and each wrong every-body call) is built here as a Code Forge override of engine/entities.asm and must FAIL the same checks the
// real engine passes (the `sabotage` tests); the real-engine checks run first so a sabotage can only fail for the
// reason it names.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProject } from '../../shared/project.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { buildFaceScene, buildRom, bootRom, ENT_X, ENT_Y, ENT_FRAME, ENT_TIMER, MAX_ENTITIES } from '../lib/faceframescene.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm && 'nesasm not found on PATH';

// from engine/constants.asm
const FRAME_CNT = 0x1b;
const MV_LEFT_NAME = 'mv_left';
const DIR_DOWN = 0;

const ENTITIES = fs.readFileSync(path.join(ROOT, 'engine/entities.asm'), 'utf8');
const GATE = '  .if STREAMING_ENABLED\n  txa\n  eor <frame_cnt\n  and #1\n  bne update_entities_anim\n  .endif\nmover_parity_gate_end:';
const GATE_PRESENT = ENTITIES.split(GATE).length === 2;
const sabotageOf = {
  'no eor': GATE.replace('  eor <frame_cnt\n', ''),
  'bne flipped to beq': GATE.replace('  bne update_entities_anim', '  beq update_entities_anim'),
  'no gate': '  .if STREAMING_ENABLED\n  .endif\nmover_parity_gate_end:'
};

const ANIM_DURATION = 2; // frames of ent_timer a pose holds: the animation rule advances on the call after it
const CALLS = ['entity_animate', 'entity_contact', 'entity_trigger_touch'];

/** Two speed-1 patrollers placed apart on the first screen, walking down from the top; `animated` gives them a two-pose walkDown. */
function withPatrollers(project, { animated = false } = {}) {
  const a = project.sprites.actors.length;
  const actor = { name: 'Walker', behavior: 'patroller', hp: 1, damage: 0, speed: 1 };
  if (animated) {
    const s = project.sprites;
    const ms = s.metasprites.length;
    s.metasprites.push({ id: ms, name: 'step', tiles: [{ x: 0, y: 0, tile: 32, palette: 1, hflip: false, vflip: false }] });
    const an = s.animations.length;
    s.animations.push({ id: an, name: 'step', loop: true, frames: [0, 1].map(() => ({ metaspriteId: ms, duration: ANIM_DURATION })) });
    actor.anims = { walkDown: an };
  }
  project.sprites.actors.push(actor);
  const screen = project.maps[0].screens[0];
  screen.entities = [
    { actorId: a, x: 40, y: 24, props: {} },
    { actorId: a, x: 120, y: 24, props: {} }
  ];
  return project;
}

async function patrolRom({ streamed, override, animated }) {
  const project = withPatrollers(streamed ? createStreamedProject({ gameType: 'action' }) : createProject('Parity', 'action'), { animated });
  if (override) project.code.overrides.push({ name: 'entities.asm', text: override });
  return { ...(await buildRom(project)), streamed };
}

/** Boots, then runs `bodies` frames recording gate visits, the three every-body calls (slot, frame_cnt) and each slot's y/frame/timer at every body. */
function observe({ rom, syms, streamed }, bodies, { zeroSpanVisits = false } = {}) {
  const visits = [];
  const calls = [];
  let pending = null;
  const hook = (nes) => {
    const cpu = nes.cpu;
    const original = cpu.emulate.bind(cpu);
    cpu.emulate = function () {
      const pc = (cpu.REG_PC + 1) & 0xffff;
      for (const kind of CALLS) if (pc === syms[kind]) calls.push({ kind, x: cpu.REG_X, fc: cpu.mem[FRAME_CNT] });
      const empty = syms.mover_parity_gate_end === syms.mover_parity_gate;
      if (syms.mover_parity_gate !== undefined && pc === syms.mover_parity_gate && (!empty || zeroSpanVisits)) {
        // (an empty span -- no gate assembled -- is a visit that passes by falling straight through, when asked for)
        pending = { x: cpu.REG_X, fc: cpu.mem[FRAME_CNT], passed: empty };
        visits.push(pending);
      } else if (pending && pc === syms.mover_parity_gate_end) pending.passed = true;
      return original();
    };
  };
  const { nes, mem } = bootRom(rom, { streamed, hook });
  visits.length = 0;
  calls.length = 0;
  const slots = (base) => [...mem.slice(base, base + MAX_ENTITIES)].slice(0, 2);
  const start = { frames: slots(ENT_FRAME), timers: slots(ENT_TIMER) };
  const ys = [];
  const poses = [];
  for (let i = 0; i < bodies; i++) {
    nes.frame();
    ys.push(slots(ENT_Y));
    poses.push({ frames: slots(ENT_FRAME), timers: slots(ENT_TIMER) });
  }
  return { visits, calls, ys, poses, start };
}

const BODIES = 60;

test('the gate rule: a visit passes exactly when (slot xor frame_cnt) & 1 == 0, for every slot and body', { skip }, async () => {
  assert.ok(GATE_PRESENT, 'engine/entities.asm must carry the gate block this test builds its sabotages from');
  const { visits } = observe(await patrolRom({ streamed: true }), BODIES);
  assert.ok(visits.length >= BODIES * 2, `both patrollers are visited every body (${visits.length} visits)`);
  assert.deepEqual(visits.filter((v) => v.passed !== (((v.x ^ v.fc) & 1) === 0)), [], 'every visit follows the rule');
  assert.ok(visits.some((v) => v.passed) && visits.some((v) => !v.passed), 'and the table has both outcomes');
  for (const slot of [0, 1]) {
    const mine = visits.filter((v) => v.x === slot);
    assert.ok(mine.some((v) => v.passed && v.fc % 2 === 0) !== mine.some((v) => v.passed && v.fc % 2 === 1), `slot ${slot} passes on one parity of frame_cnt only`);
  }
});

test('the rate: a streamed project\'s patrollers step half as often as an ordinary project\'s, and every body has one mover step', { skip }, async () => {
  const streamed = observe(await patrolRom({ streamed: true }), BODIES);
  const ordinary = observe(await patrolRom({ streamed: false }), BODIES);
  assert.equal(ordinary.visits.length, 0, 'an ordinary project assembles no gate (zero-size labels, no visits)');
  const travelled = (o) => o.ys[BODIES - 1].map((y, i) => y - o.ys[0][i]);
  const elapsed = BODIES - 1;
  // the ordinary pair is the control: full rate, one pixel per body each (no wall in the walk)
  assert.deepEqual(travelled(ordinary), [elapsed, elapsed], 'ordinary patrollers: one pixel per body');
  const [a, b] = travelled(streamed);
  assert.ok([a, b].every((n) => n === (elapsed >> 1) || n === (elapsed >> 1) + 1), `each streamed patroller covers half the distance (${a}, ${b} of ${elapsed})`);
  assert.equal(a + b, elapsed, 'together the two parities cover every body exactly once: one mover step per body');
  // and no body moves both, none neither: the per-body steps alternate between the two slots
  const moved = (i) => streamed.ys[i].map((y, k) => y !== streamed.ys[i - 1][k]);
  for (let i = 1; i < BODIES; i++) assert.equal(moved(i).filter(Boolean).length, 1, `body ${i}: exactly one of the two patrollers stepped`);
});

/** A scripted Move of 8 px up by an NPC (the face scene's host), started by poking pending_ent; bodies until it lands. */
function scriptedMoveBodies({ rom, streamed }) {
  const { nes, mem } = bootRom(rom, { streamed });
  const PENDING_ENT = 0x7c; // from engine/constants.asm
  const y0 = mem[ENT_Y];
  mem[PENDING_ENT] = 0;
  const ys = [];
  for (let i = 0; i < 40; i++) {
    nes.frame();
    ys.push(mem[ENT_Y]);
  }
  const done = ys.findIndex((y) => y === y0 - 8);
  return { done, ys, y0 };
}

test('scripted Move is not halved: 8 px takes the same number of bodies on a streamed map as on an ordinary one', { skip }, async () => {
  const commands = [{ op: 'move', who: 'self', dir: 'up', dist: 8 }];
  const build = async (streamed) => ({ ...(await buildRom(buildFaceScene({ streamed, commands, x: 120, y: 100 }).project)), streamed });
  const s = scriptedMoveBodies(await build(true));
  const o = scriptedMoveBodies(await build(false));
  assert.ok(o.done >= 0 && s.done >= 0, `both Moves land (ordinary at body ${o.done}, streamed at ${s.done})`);
  assert.equal(s.done, o.done, 'a scripted Move takes the same number of bodies whether or not the project streams');
  assert.ok(o.done <= 12, `and at full rate that is about 8 bodies, not 16 (${o.done})`);
});

/** The animation rule (entity_animate), one call: the timer counts up, and the pose advances once it has passed its duration. */
function animateStep({ frame, timer }, frames, duration) {
  timer += 1;
  if (duration >= timer) return { frame, timer };
  return { frame: (frame + 1) % frames, timer: 0 };
}

/** Asserts every kind of every-body call was made once at each gate visit, in visit order. */
function assertEveryBody({ visits, calls }) {
  const sites = visits.map(({ x, fc }) => ({ x, fc }));
  for (const kind of CALLS) {
    const got = calls.filter((c) => c.kind === kind).map(({ x, fc }) => ({ x, fc }));
    assert.deepEqual(got, sites, `${kind}: called once per gate visit (slot and frame_cnt), the gated-out bodies included`);
  }
}

test('every body: animation, contact and touch run at every gate visit, the bodies the gate skips included', { skip }, async () => {
  const seen = observe(await patrolRom({ streamed: true, animated: true }), BODIES);
  assert.ok(seen.visits.length >= BODIES * 2, `both patrollers are visited every body (${seen.visits.length} visits)`);
  assert.ok(seen.visits.some((v) => !v.passed), 'the visits include bodies the gate sends past the behaviour');
  assertEveryBody(seen);
});

test('every body: two animated patrollers\' ent_frame/ent_timer follow the animation rule once per body, though they step every other body', { skip }, async () => {
  const seen = observe(await patrolRom({ streamed: true, animated: true }), BODIES);
  const bad = animationDeviations(seen);
  assert.deepEqual(bad, [], 'every body, each slot (frame, timer) is exactly one animation step on from the body before');
  const advances = (k) => seen.poses.filter((p, i) => p.frames[k] !== (i ? seen.poses[i - 1].frames[k] : seen.start.frames[k])).length;
  const expected = Math.floor(BODIES / (ANIM_DURATION + 1));
  for (const k of [0, 1]) assert.ok(Math.abs(advances(k) - expected) <= 1, `slot ${k}: ${advances(k)} pose advances in ${BODIES} bodies (about ${expected})`);
});

/** Every (body, slot) at which the recorded (frame, timer) is not one animation step on from the body before. */
function animationDeviations({ poses, start }) {
  const bad = [];
  for (let i = 0; i < poses.length; i++) {
    const before = i ? poses[i - 1] : start;
    for (const k of [0, 1]) {
      const want = animateStep({ frame: before.frames[k], timer: before.timers[k] }, 2, ANIM_DURATION);
      if (poses[i].frames[k] !== want.frame || poses[i].timers[k] !== want.timer) bad.push({ body: i, slot: k });
    }
  }
  return bad;
}

// ---- the sabotages: each wrong gate must fail the very checks the real engine passes ----------------------------

for (const [name, replacement] of Object.entries(sabotageOf)) {
  test(`sabotage (${name}): the gate-rule table fails`, { skip }, async () => {
    assert.ok(GATE_PRESENT, 'the gate block must be present to be sabotaged');
    const override = ENTITIES.replace(GATE, replacement);
    assert.notEqual(override, ENTITIES, 'the sabotage must change the engine');
    const { visits } = observe(await patrolRom({ streamed: true, override }), BODIES, { zeroSpanVisits: true });
    const wrong = visits.filter((v) => v.passed !== (((v.x ^ v.fc) & 1) === 0));
    assert.ok(wrong.length > 0, `${name}: some visit must break the rule (${visits.length} visits)`);
  });
}

test('sabotage (no gate): the rate check fails too -- the patrollers run at full rate', { skip }, async () => {
  const override = ENTITIES.replace(GATE, sabotageOf['no gate']);
  const { ys } = observe(await patrolRom({ streamed: true, override }), BODIES);
  assert.equal(ys[BODIES - 1][0] - ys[0][0], BODIES - 1, 'without the gate a streamed project\'s patroller is back at one pixel per body');
});

// The every-body contract's own sabotages: each wrong engine must fail the checks the real engine passes above.
// All four put a parity skip into entities.asm (the same `txa / eor / and / bne` the gate itself uses), around
// everything after the dispatch (the reviewer's mutant: only the gated-out bodies lose animation, contact and touch)
// or around one of the three calls alone.
const SKIP = (label) => `  .if STREAMING_ENABLED\n  txa\n  eor <frame_cnt\n  and #1\n  bne ${label}\n  .endif\n`;
const everyBodySabotages = {
  'all three skipped on the gated-out bodies': () => ENTITIES.replace('update_entities_anim:\n', `update_entities_anim:\n${SKIP('update_entities_next')}`),
  'animation alone halved': () => ENTITIES.replace('  jsr entity_animate\n', `${SKIP('sab_anim_done')}  jsr entity_animate\nsab_anim_done:\n`),
  'contact alone halved': () => ENTITIES.replace('  jsr entity_contact\n', `${SKIP('sab_contact_done')}  jsr entity_contact\nsab_contact_done:\n`),
  'touch alone halved': () => ENTITIES.replace('  jsr entity_trigger_touch\n', `${SKIP('sab_touch_done')}  jsr entity_trigger_touch\nsab_touch_done:\n`)
};

for (const [name, make] of Object.entries(everyBodySabotages)) {
  test(`sabotage (${name}): the every-body call check fails${name === 'contact alone halved' || name === 'touch alone halved' ? '' : ' and the animation progression drifts'}`, { skip }, async () => {
    const override = make();
    assert.notEqual(override, ENTITIES, 'the sabotage must change the engine');
    const seen = observe(await patrolRom({ streamed: true, animated: true, override }), BODIES);
    assert.throws(() => assertEveryBody(seen), { code: 'ERR_ASSERTION' }, `${name}: some call is missing at some visit`);
    if (!name.startsWith('contact') && !name.startsWith('touch')) {
      assert.ok(animationDeviations(seen).length > 0, `${name}: the animation timer falls behind the one-step-per-body model`);
    }
  });
}
