// Phase 3a slice S3a, manifest row M11 (plan section 5.3, 7 S3a T9): the frames of a streamed player `Move`, full-system in Mesen.
//   (a) a mid-Move step: the delegated sw_pstep_* + sw_frame_camera_window + a strip in flight, eight live actors drawn;
//   (b) the FINAL Move frame, whose script_resume runs further commands (Say, Flash, a switch effect, a second Move), with the strip drain of
//       the NMI that released it (a coincident <= 35-byte queue takes the reduced chunk).
// It reuses the shipped manifest harness unchanged (test/lua/run_sw_manifest.mjs: `runManifest`, its Lua template and the gate definition of
// plan 11.2: G = the whole non-idle work of a frame interval incl. the coincident NMI, gate G <= 29,780) and adds no harness file of its
// own to sw_provenance.mjs's HARNESS_FILES, so the recorded curve's provenance is untouched. What it adds is the SCENE and the CLASSIFICATION:
//   - the scene is the shipped 'walk' scene (eight live actors, a Down walk along x = 242), with the touch actor moved onto the Down target at
//     (242, touchY) via `mutate` and its event replaced (`flashCmds`) by [lead] + `Move player down DIST` + [tail];
//   - the Mesen run records every body with execution marks (move_tick, move_finish, sw_frame_camera_window and the tail's own continuation
//     handler) AND the per-body trace line (queue length at the releasing NMI, strip state and chunk, the published queue, Flash state), so a
//     body is classed by what it ran and what coincided with it, never by a frame number;
//   - `classify` returns every class of body with its worst G and the evidence record of that body, and `validateCell` is the FAIL-CLOSED check
//     a cell must pass before its figures are used: a missing mark, an absent class, a bad Mesen status or a non-finite figure is an error,
//     never an empty population with maxima of 0.
// Populations (plan 5.3): EXACTLY `tiles` tiles over the eight actor slots, in many-small and few-large shapes including seven zero-tile actors;
// art = the animation preset (test/lua/sw_bound_sweep.mjs ANIM_PRESETS: P1 = every actor on its largest pose, advancing every body) and tight/wide.
// `bound` = the 14-tile variant: an ordinary second map carrying one switch-bound tile turns BOUND_TILE_ENABLED on project-wide (grid 3x60).
// CLI: node test/lua/run_sw_move_manifest.mjs --gt=action --tail=say --dist=150 [--lead=none|say|flash] [--pop=many-small] [--anim=P1] [--bound=1]
//        [--touchY=60] [--wide=0|1] [--tiles=15] [--root=<tree> --which=new|parent] [--coincide=strip|arm|pub (a new-engine Flash lead)]
//      One cell under the campaign's own policy (test/lua/sw_move_policy.mjs): unknown/malformed options exit 2 before anything launches.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runManifest, GATE, MESEN_DEFAULT } from './run_sw_manifest.mjs';
import { REPO } from './sw_manifest_scene.mjs';
import { BOUND_TILE } from './sw_sweep_mutate.mjs';
import { ANIM_PRESETS } from './sw_bound_sweep.mjs';

export { GATE };
// 3x61 (the action default) does not build with BOUND_TILE_ENABLED (test/lua/sw_bound_sweep.mjs GRID_H.bound); the rpg default grid (3x30) builds with it, and 3x60 does not ("need 60 of the 59 regions").
export const BOUND_GRID_H = 60;
export const TOUCH = { x: 242, y: 60 };
export const TAILS = {
  none: [],
  say: [{ op: 'say', text: 'Hello there, traveller.' }],
  flash: [{ op: 'flash' }],
  switch: [{ op: 'setSwitch', switch: 5 }],
  move2: [{ op: 'move', who: 'player', dir: 'down', dist: 12 }]
};
// What runs BEFORE the Move: nothing; a Say, whose open text box sw_close_for_move closes first (the close-for-Move barrier; the pre-Move box
// close is a separately classified diagnostic); or a Flash, whose 35-byte palette packet is the preceding producer that coincides with the
// Move's own frames (see COINCIDENCE below).
export const LEADS = { none: [], say: [{ op: 'say', text: 'Stand back.' }], flash: [{ op: 'flash' }] };
// The handler a tail's continuation runs in the final body (the named continuation of M11b); the lead's own marks are added for a Flash lead.
export const CONTINUATION = { none: null, say: 'script_op_say', flash: 'script_op_flash', switch: 'script_op_set', move2: 'script_op_move' };

/**
 * The reachable arrangement for M11b's coincident reduced strip drain (review 1, required change 1). Flash's packet is published by
 * `flash_tick` on the body AFTER the Flash command ran (it publishes 35 bytes; flash_tick precedes the script/Move dispatch in a body), so a
 * Flash appended as the TAIL can never coincide with the final body: it is published a body later. A Flash LEAD (`Flash; Move d; tail`) is
 * the authored preceding producer: its packet is published on the first body of the Move, and the NMI that releases the NEXT body drains it
 * together with a reduced strip chunk. With a Move of only a few ticks that next body is the final one. Which (touchY, dist) land the
 * Flash-on or restore packet in the body just before the final one is a measured question: the campaign sweeps them and `validateCell`
 * requires the coincidence to be PRESENT in the cells that claim it, per body, with the queue length and the strip chunk of the evidence.
 */
export const COINCIDENCE = { lead: 'flash' };

const held = (...names) => Object.fromEntries(names.map((n) => [n, true]));

/** The eight slot sizes of a population of EXACTLY `tiles` tiles (one 4x4 grid actor holds at most 16). Zero = a zero-tile actor. */
export function populations(tiles) {
  const evenOver = (k) => Array.from({ length: 8 }, (_, i) => (i < k ? Math.floor(tiles / k) + (i < tiles % k ? 1 : 0) : 0));
  const pops = {
    'many-small': evenOver(8), // every actor carries tiles
    'few-large-1': [tiles, 0, 0, 0, 0, 0, 0, 0], // one large actor, seven zero-tile actors' overhead
    'few-large-2': evenOver(2).map((v, i) => (i < 2 ? v : 0)),
    'few-large-3': evenOver(3),
    'few-large-4': evenOver(4),
    'few-large-5': evenOver(5),
    'few-large-6': evenOver(6),
    'few-large-7': evenOver(7), // one to eight actors carrying the tiles: every actor-count distribution (plan 5.3)
    front: [tiles - 7, 1, 1, 1, 1, 1, 1, 1], // the big actor first
    back: [1, 1, 1, 1, 1, 1, 1, tiles - 7] // the big actor is the touch actor itself (slot 7)
  };
  for (const [name, sizes] of Object.entries(pops)) {
    if (sizes.length !== 8 || sizes.reduce((a, b) => a + b, 0) !== tiles || sizes.some((v) => v < 0 || v > 16)) throw new Error(`population ${name} is not ${tiles} tiles over eight slots: ${sizes}`);
  }
  return pops;
}

/** Moves the touch actor from the Right target to the Down target at (TOUCH.x, y), replacing its damage npc: the Move starts on the Down walk. */
export function relocateTouchActor(project, y = TOUCH.y) {
  const map = project.maps[0];
  const LR = map.gridH - 3;
  const right = map.screens[LR * map.gridW + 2];
  const down = map.screens[(LR + 1) * map.gridW + 2];
  const touchIdx = right.entities.findIndex((e) => project.sprites.actors[e.actorId].name === 'ShakeFlashNpc');
  const dmgIdx = down.entities.findIndex((e) => project.sprites.actors[e.actorId].name === 'DamageNpc');
  if (touchIdx < 0 || dmgIdx < 0) throw new Error('scene shape changed: no touch / damage actor to swap');
  const [touch] = right.entities.splice(touchIdx, 1);
  down.entities.splice(dmgIdx, 1);
  touch.x = TOUCH.x; touch.y = y;
  down.entities.push(touch);
}

/** The scene's authored mutation: the touch actor relocated, and (bound) the one switch-bound tile on an ordinary second map. */
export function sceneMutation({ y = TOUCH.y, bound = false } = {}) {
  return (project, { createMap, createScreen } = {}) => {
    relocateTouchActor(project, y);
    if (bound) {
      if (!createMap || !createScreen) throw new Error('a bound-tile scene needs createMap/createScreen');
      const om = createMap(1, 'Ordinary');
      om.tilesetId = 0; om.gridW = 1; om.gridH = 1; om.screens = [createScreen()];
      om.screens[0].boundTiles = [{ ...BOUND_TILE }];
      project.maps.push(om);
    }
    return { turn: null, boundTile: bound ? BOUND_TILE : null };
  };
}

/** The marks a cell records: the Move's own, the camera call, the tail's continuation handler and (a Flash lead) flash_tick/script_op_flash. */
export function marksFor({ lead = 'none', tail = 'none' } = {}) {
  const marks = ['move_tick', 'move_finish', 'sw_frame_camera_window'];
  for (const name of [CONTINUATION[tail], lead === 'flash' ? 'script_op_flash' : null, lead === 'flash' || tail === 'flash' ? 'flash_tick' : null]) if (name && !marks.includes(name)) marks.push(name);
  return marks;
}

export async function measureMove({
  gt = 'action', tail = 'none', lead = 'none', dist = 150, root = REPO, wide = true, tiles = 15, pop = 'many-small', anim = null, bound = false, touchY = TOUCH.y,
  tail2Frames = 120, mesen = MESEN_DEFAULT, outDir = null
}) {
  if (!(tail in TAILS) || !(lead in LEADS)) throw new Error(`unknown lead/tail ${lead}/${tail}`);
  const sizes = populations(tiles)[pop];
  if (!sizes) throw new Error(`unknown population ${pop}`);
  if (anim !== null && !(anim in ANIM_PRESETS)) throw new Error(`unknown animation preset ${anim}`);
  const flashCmds = [...LEADS[lead], { op: 'move', who: 'player', dir: 'down', dist }, ...TAILS[tail]];
  const total = 140 + Math.ceil(dist * 1.2) + tail2Frames;
  // A Say before the Move needs one B press, once the box waits (a press while it types cancels the event). `held` is static per phase, so the
  // measured phase is split into same-named parts (the harness accumulates statistics per NAME). The touch fires on body TOUCH_BODY of this
  // phase on every build (measured: a lead-less run's first move_tick body, all four game type x art shapes); the box waits well before +45.
  const TOUCH_BODY = 192;
  const M = { name: 'M11', collect: true, marks: true, trace: true };
  const measured = lead !== 'say'
    ? [{ ...M, frames: total, held: held('down') }]
    : [{ ...M, frames: TOUCH_BODY + 45, held: held('down') }, { ...M, frames: 2, held: held('down', 'b') }, { ...M, frames: total - TOUCH_BODY - 47, held: held('down') }];
  const phases = [
    { name: 'boot', waitFor: 'gameplay' },
    { name: 'pre', frames: 95, held: held('down') },
    { name: 'walkR', frames: 260, held: held('right', 'down') },
    ...measured
  ];
  const res = await runManifest({
    root, gt, sizes, wide, anim: anim ? ANIM_PRESETS[anim] : null, flashCmds, mutate: sceneMutation({ y: touchY, bound }), phases,
    ...(bound && gt === 'action' ? { gridH: BOUND_GRID_H } : {}), marks: marksFor({ lead, tail }), mesen, outDir
  });
  return { res, summary: classify(res, { lead, tail }) };
}

const coincidenceWords = {
  strip: 'a 1..35-byte queue drained with a strip already in flight, in a reduced chunk',
  arm: 'a 1..35-byte queue drained on the body that arms the strip',
  pub: 'the final body published a queue'
};
const qClass = (q) => (q === 0 ? 'q0' : q <= 35 ? 'reduced' : 'exclusive');
const MARK_RE = /([A-Za-z_][A-Za-z0-9_]*)@(\d+)/g;

/**
 * Per-body classification: the MK line (G, the marks the body ran) zipped with its TR line (queue at the releasing NMI `q`, strip state
 * `st0`/`st1`, whether the releasing NMI advanced the strip `stadv`, the queue the body published `pub`, Flash state). A body is
 *   step   : ran move_tick and not move_finish (M11a),
 *   final  : ran move_finish (M11b),
 *   before : a body of the phase before the Move's first tick (a text-box lead's own frames: the pre-Move box close),
 *   after  : everything later in the phase (the tail's own frames, the redraw a parent engine takes, ordinary walking).
 * A class key is `kind.strip|nostrip.q0|reduced|exclusive[.continuation]`: `strip` = a strip was in flight at the body's start; `reduced` =
 * the releasing NMI drained a 1..35-byte queue (with a reduced strip chunk when a strip was active), `exclusive` = more than 35 bytes (the
 * strip waits). Each class keeps its count, worst G and the evidence record of that body.
 */
export function classify(res, { lead = 'none', tail = 'none' } = {}) {
  const marks = res.marks?.M11 ?? [];
  const trace = res.trace?.M11 ?? [];
  const problems = [];
  if (marks.length !== trace.length) problems.push(`the run recorded ${marks.length} mark lines but ${trace.length} trace lines`);
  const cont = CONTINUATION[tail];
  const classes = {};
  const bodies = [];
  let seenTick = false;
  for (let i = 0; i < Math.min(marks.length, trace.length); i++) {
    const { f, line } = marks[i];
    const tr = trace[i];
    if (tr.f !== f) { problems.push(`body ${i}: mark frame ${f} != trace frame ${tr.f}`); continue; }
    const G = Number(/G=(\d+)/.exec(line)?.[1]);
    if (!Number.isFinite(G)) { problems.push(`body ${i} (frame ${f}): no finite G in its mark line`); continue; }
    const ran = {};
    for (const m of line.matchAll(MARK_RE)) ran[m[1]] = (ran[m[1]] ?? 0) + 1;
    const kind = ran.move_finish ? 'final' : ran.move_tick ? 'step' : seenTick ? 'after' : 'before';
    if (ran.move_tick) seenTick = true;
    const rec = {
      f, G, kind, cam: ran.sw_frame_camera_window ?? 0, q: tr.q, st0: tr.st0, st1: tr.st1, stadv: tr.stadv, pub: tr.pub, fl: tr.fl, rfl: tr.rfl,
      ran: Object.keys(ran).filter((n) => n !== 'NMI' && n !== 'RTI')
    };
    bodies.push(rec);
    const strip = rec.st0 !== 0 ? 'strip' : 'nostrip';
    const contTag = kind === 'final' ? (cont && ran[cont] ? tail : 'none') : null;
    const key = [kind, strip, qClass(rec.q), rec.pub > 0 ? 'pub' : null, contTag].filter(Boolean).join('.');
    const c = (classes[key] ??= { n: 0, maxG: 0, worst: null });
    c.n++;
    if (!(rec.G <= c.maxG)) { c.maxG = rec.G; c.worst = rec; }
  }
  const of = (kind) => Object.entries(classes).filter(([k]) => k.startsWith(kind + '.'));
  const max = (kind) => of(kind).reduce((m, [, c]) => Math.max(m, c.maxG), 0);
  const count = (kind) => of(kind).reduce((n, [, c]) => n + c.n, 0);
  return {
    bodies: bodies.length, step: count('step'), final: count('final'), before: count('before'), after: count('after'),
    maxStep: max('step'), maxFinal: max('final'), maxBefore: max('before'), maxAfter: max('after'), classes, problems,
    maxG: res.phases?.M11?.maxG ?? null, gateFail: res.phases?.M11?.gateFail ?? null, overruns: res.phases?.M11?.overruns ?? null,
    done: res.done, timeout: res.timeout, status: res.status, lead, tail
  };
}

/**
 * The fail-closed check of one measured cell (review 1, required change 2): every problem that makes its figures unusable, [] when sound.
 * `expect` = { step: M11a executed with an active strip, final: M11b ran, continuation: the TAIL NAME whose handler ran in a final body,
 *              coincidence: the final body's composition the cell claims --
 *                'strip' : its releasing NMI drained a 1..35-byte queue together with a strip already in flight (the reduced chunk),
 *                'arm'   : the same queue drain, on the body that ARMS the strip (the camera call starts it in the final body),
 *                'pub'   : the final body itself publishes a queue (Flash's packet), drained by the NMI after it }.
 * The class key carries `.pub` for a body that published a queue, so a class names exactly what coincided.
 */
export function validateCell(summary, expect = {}) {
  const out = [...(summary.problems ?? [])];
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  if (summary.status !== 0) out.push(`Mesen exit status ${summary.status}`);
  if (!summary.done) out.push('the run did not finish (no DONE line)');
  if (summary.timeout) out.push('the run timed out');
  if (!summary.bodies) out.push('no body was recorded: no marks were collected');
  for (const [name, c] of Object.entries(summary.classes ?? {})) if (!finite(c.maxG) || (c.n > 0 && c.worst === null && c.maxG === 0)) out.push(`class ${name} has no finite timing`);
  for (const k of ['maxStep', 'maxFinal']) if (!finite(summary[k])) out.push(`${k} is not a number`);
  const cls = summary.classes ?? {};
  const some = (pred) => Object.entries(cls).some(([k, c]) => c.n > 0 && pred(k, c));
  if (expect.step !== false) {
    if (!some((k) => k.startsWith('step.'))) out.push('no step body was timed (M11a has an empty population)');
    else if (expect.step === 'strip' && !some((k, c) => k.startsWith('step.strip.') && c.worst?.cam > 0)) out.push('no step body ran the camera call with a strip in flight (M11a composition)');
  }
  if (expect.final !== false && !some((k) => k.startsWith('final.'))) out.push('no final body was timed (M11b has an empty population)');
  if (expect.continuation) {
    if (!some((k) => k.startsWith('final.') && k.endsWith('.' + expect.continuation))) out.push(`no final body ran the ${expect.continuation} tail's continuation, ${CONTINUATION[expect.continuation]} (M11b composition)`);
  }
  const coincide = {
    strip: (k, c) => k.startsWith('final.strip.reduced') && c.worst?.stadv === 1 && c.worst?.q >= 1 && c.worst?.q <= 35,
    arm: (k, c) => k.startsWith('final.nostrip.reduced') && c.worst?.st1 !== 0 && c.worst?.q >= 1 && c.worst?.q <= 35,
    pub: (k, c) => k.startsWith('final.') && k.includes('.pub') && c.worst?.pub > 0
  };
  if (expect.coincidence) {
    if (!coincide[expect.coincidence]) out.push(`unknown coincidence kind ${expect.coincidence}`);
    else if (!some(coincide[expect.coincidence])) out.push(`no final body showed the '${expect.coincidence}' coincidence (M11b composition): ${coincidenceWords[expect.coincidence]}`);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  // One cell, held to the SAME policy as a campaign cell (test/lua/sw_move_policy.mjs): unknown or malformed options and a full machine are an
  // exit 2 before anything launches; the composition the cell claims and the gate on the new engine's step/final rows are an exit 1.
  // (not awaited at the top level: the policy module imports THIS one, so the entry module must finish evaluating first)
  import('./sw_move_policy.mjs').then(({ runCell }) => runCell(process.argv.slice(2))).then((r) => {
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    process.exitCode = r.exitCode;
  }, (e) => { console.error(e); process.exitCode = 1; });
}
