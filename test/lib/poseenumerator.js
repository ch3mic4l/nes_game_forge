// An independent reachable-pose enumerator for the streamed entity projection's derived bounds
// (phase 3a slice S1, test/unit/streambounds.test.js, plan section 3.1 / S1 T5).
//
// The question it answers: which (facing, frame) poses can an entity be DRAWN in, and do the
// offset bounds over that set equal the bounds over the AUTHORED frames plus the zero-frame
// fallback (the domain SW_UXMIN..SW_UYMAX are derived from)? Written from the engine source and the
// plan, NOT from shared/project.js or shared/streamlayout.js (no import of either), so a defect in
// the generator's own notion of "a pose" cannot hide in the checker. handoff-next/a1_pose_model.py
// is the narrower precursor: pose-set containment only, no Move, no adoption, no offset bounds.
//
// State of one entity: (dir, frame, timer). The transitions, each with the engine line it models:
//   spawnOrdinary / spawnStreamed  dir=DOWN, frame=0, timer=0        entities.asm spawn_place; streamworld.asm spawn_streamed_place
//   animate                        entity_animate: clamp, advance, wrap     entities.asm entity_animate
//   patrol                         dir ^= 1 then animate, one iteration     entity_turn; update_entities_behave -> update_entities_anim
//   chase                          dir := any facing then animate           entity_chase (same iteration)
//   turn / moveBlocked / moveFree  move_face: dir := d, then (S0) the clamp. Turn draws the state as it is;
//                                  a Move blocked on its first tick skips move_animate; a free Move draws one
//                                  frame before the first move_tick (all three observe the post-move_face state)
//   adopt                          sw_held_fit (S2; NOT in the S1 tree -- the documented rule set is modelled):
//                                  dir := any facing, frame := held frame clamped against that facing, timer := 0
// A writer's mode is 'clamp' (frame >= count of the resolved animation => frame = timer = 0; NO_ANIM
// untouched), 'raw' (the pre-S0 behaviour: frame and timer untouched) or null (transition absent).
// patrol/chase/animate/spawn always apply entity_animate's own clamp: it is the shipped rule, not a switch.

export const NO_ANIM = 0xff; // from engine/constants.asm
const DIRS = [0, 1, 2, 3]; // DIR_DOWN, DIR_UP, DIR_LEFT, DIR_RIGHT, from engine/constants.asm
const WRITERS = ['turn', 'moveBlocked', 'moveFree', 'adopt'];

export const FULL_RULES = Object.freeze({
  spawnOrdinary: true,
  spawnStreamed: true,
  animate: true,
  patrol: true,
  chase: true,
  turn: 'clamp',
  moveBlocked: 'clamp',
  moveFree: 'clamp',
  adopt: 'clamp'
});
/** The engine before S0: move_face has no clamp; adoption does not exist yet. */
export const PRE_S0_RULES = Object.freeze({ ...FULL_RULES, turn: 'raw', moveBlocked: 'raw', moveFree: 'raw', adopt: null });

/** `rules` with one writer's clamp switched off. Throws unless that writer is present and clamped,
 * so a rule set that has lost the transition cannot pass an ablation test by accident. */
export function withRawWriter(rules, writer) {
  if (!WRITERS.includes(writer)) throw new Error(`unknown writer ${writer}`);
  if (rules[writer] !== 'clamp') throw new Error(`rule set does not model ${writer} with a clamp (${rules[writer]})`);
  return { ...rules, [writer]: 'raw' };
}

// ---------------------------------------------------------------- project reading (own code)

/** Actor indices placed on any screen of a streamed map (ascending). */
export function placedActorIds(project) {
  const ids = new Set();
  for (const map of project.maps) {
    if (map.streamed !== true) continue;
    for (const screen of map.screens) for (const e of screen.entities ?? []) ids.add(e.actorId);
  }
  return [...ids].sort((a, b) => a - b);
}

const slotValue = (actor, slot) => {
  const own = actor.anims?.[slot];
  if (own !== null && own !== undefined) return own;
  const idle = actor.anims?.idle;
  return idle === null || idle === undefined ? NO_ANIM : idle;
};
/** The animation id each of the four facings draws (down, up, left, right = side, side). */
export const facingAnims = (actor) => [slotValue(actor, 'walkDown'), slotValue(actor, 'walkUp'), slotValue(actor, 'walkSide'), slotValue(actor, 'walkSide')];

/** The tables the ROM carries, rebuilt from the project the way the emitter lays them out:
 * animation records back to back, a zero-frame animation as a single $00 byte. */
export function tablesFromProject(project) {
  const anims = project.sprites.animations;
  const data = [];
  const start = [];
  const count = [];
  for (const a of anims) {
    start.push(data.length);
    count.push(a.frames.length);
    if (a.frames.length) for (const f of a.frames) data.push(f.metaspriteId & 255, f.duration & 255);
    else data.push(0);
  }
  if (!anims.length) {
    start.push(0);
    count.push(0);
    data.push(0);
  }
  const actors = project.sprites.actors.length ? project.sprites.actors : [{ anims: {} }];
  return { start, count, data, actorAnimDir: actors.flatMap(facingAnims) };
}

/** The same tables, read back out of the generated sprites.inc (anim_count, anim_data_N, actor_anim_dir). */
export function tablesFromSpritesInc(text) {
  const blocks = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    const label = line.match(/^(\w+):/);
    if (label) {
      current = [];
      blocks.set(label[1], current);
    } else if (current && /^\s*\.db\s/.test(line)) {
      for (const tok of line.replace(/;.*/, '').replace(/^\s*\.db\s+/, '').split(',')) {
        const t = tok.trim();
        if (/^\$[0-9a-fA-F]+$/.test(t)) current.push(parseInt(t.slice(1), 16));
        else if (/^\d+$/.test(t)) current.push(Number(t));
        else current.push(t); // LOW(...) / HIGH(...) label bytes are not numeric
      }
    }
  }
  const data = [];
  const start = [];
  for (let i = 0; blocks.has(`anim_data_${i}`); i++) {
    start.push(data.length);
    data.push(...blocks.get(`anim_data_${i}`));
  }
  return { start, count: blocks.get('anim_count'), data, actorAnimDir: blocks.get('actor_anim_dir') };
}

// ---------------------------------------------------------------- transitions

const animOf = (tables, actor, dir) => tables.actorAnimDir[actor * 4 + dir];

/** The clamp entity_animate applies (and S0 puts inside move_face). */
function clamped(tables, actor, s) {
  const a = animOf(tables, actor, s.dir);
  if (a === NO_ANIM) return s;
  return s.frame >= tables.count[a] ? { dir: s.dir, frame: 0, timer: 0 } : s;
}

/** entity_animate on the entity as it stands (models entities.asm entity_animate, byte for byte). */
export function animateStep(tables, actor, s) {
  const a = animOf(tables, actor, s.dir);
  if (a === NO_ANIM) return s;
  let { frame, timer } = clamped(tables, actor, s);
  const count = tables.count[a];
  if (count < 2) return { dir: s.dir, frame, timer };
  timer = (timer + 1) & 255; // inc ent_timer,x wraps
  const duration = tables.data[tables.start[a] + 2 * frame + 1];
  if (duration >= timer) return { dir: s.dir, frame, timer }; // cmp / bcs: not time to advance yet
  timer = 0;
  frame += 1;
  if (frame >= count) frame = 0;
  return { dir: s.dir, frame, timer };
}

/** move_face with the writer's mode. */
export function moveFaceStep(tables, actor, s, dir, mode) {
  const turned = { dir, frame: s.frame, timer: s.timer };
  return mode === 'clamp' ? clamped(tables, actor, turned) : turned;
}

const key = (s) => s.dir | (s.frame << 2) | (s.timer << 10);

/** Every (dir, frame, timer) state a drawn entity can be in under `rules`. `behavior` is the actor's
 * project behaviour id ('patroller' | 'chaser' | anything else = no direction writes of its own). */
export function enumerateStates(tables, actor, behavior, rules) {
  const seen = new Map();
  const todo = [];
  const add = (s) => {
    const k = key(s);
    if (!seen.has(k)) {
      seen.set(k, s);
      todo.push(s);
    }
  };
  if (rules.spawnOrdinary || rules.spawnStreamed) add({ dir: 0, frame: 0, timer: 0 });
  while (todo.length) {
    const s = todo.pop();
    if (rules.animate) add(animateStep(tables, actor, s));
    if (rules.patrol && behavior === 'patroller') add(animateStep(tables, actor, { ...s, dir: s.dir ^ 1 }));
    if (rules.chase && behavior === 'chaser') for (const d of DIRS) add(animateStep(tables, actor, { ...s, dir: d }));
    for (const w of ['turn', 'moveBlocked', 'moveFree']) if (rules[w]) for (const d of DIRS) add(moveFaceStep(tables, actor, s, d, rules[w]));
    if (rules.adopt) {
      for (const d of DIRS) {
        const held = { dir: d, frame: s.frame, timer: 0 };
        add(rules.adopt === 'clamp' ? clamped(tables, actor, held) : held);
      }
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------- resolution and bounds

/** The metasprite id a draw of (actor, dir, frame) reads, straight from the concatenated animation
 * bytes with no bounds check (the shipped draw's own unchecked index). */
export function resolvePose(tables, actor, dir, frame) {
  const a = animOf(tables, actor, dir);
  if (a === NO_ANIM) return { kind: 'none' };
  const at = tables.start[a] + 2 * frame;
  if (at >= tables.data.length) return { kind: 'oob' };
  return { kind: 'ms', msid: tables.data[at] };
}

/** The authored domain: every frame of every facing's animation, plus metasprite 0 for a zero-frame one. */
export function authoredMetasprites(tables, actor) {
  const ids = new Set();
  for (const d of DIRS) {
    const a = animOf(tables, actor, d);
    if (a === NO_ANIM) continue;
    if (tables.count[a] === 0) ids.add(0);
    else for (let f = 0; f < tables.count[a]; f++) ids.add(tables.data[tables.start[a] + 2 * f]);
  }
  return ids;
}

const signed = (v) => (v > 127 ? v - 256 : v);

/** OXMIN/OXMAX/OYMIN/OYMAX and the largest tile count over a set of metasprite ids. `unresolved` counts
 * ids naming no metasprite (a read outside the animation tables or the metasprite table). */
export function boundsOfMetasprites(project, ids) {
  let xmin = 127, xmax = -128, ymin = 127, ymax = -128, maxTiles = 0, any = false, unresolved = 0;
  for (const id of ids) {
    const ms = project.sprites.metasprites[id];
    if (!ms) {
      unresolved += 1;
      continue;
    }
    maxTiles = Math.max(maxTiles, ms.tiles.length);
    for (const t of ms.tiles) {
      any = true;
      xmin = Math.min(xmin, signed(t.x & 255));
      xmax = Math.max(xmax, signed(t.x & 255));
      ymin = Math.min(ymin, signed(t.y & 255));
      ymax = Math.max(ymax, signed(t.y & 255));
    }
  }
  if (!any) xmin = xmax = ymin = ymax = 0;
  return { OXMIN: xmin, OXMAX: xmax, OYMIN: ymin, OYMAX: ymax, maxTiles, unresolved };
}

/**
 * The T5(ii) comparison for a whole project: bounds over authored frames + zero-frame fallback of every
 * placed actor versus bounds over every pose reachable under `rules`. Returns both, the five-number
 * verdict, the number of reachable states (0 = empty enumeration) and the reachable metasprite ids that
 * are NOT authored (pose-set containment, reported separately).
 */
export function compareReachableToAuthored(project, tables, rules) {
  const authoredIds = new Set();
  const reachableIds = new Set();
  let states = 0;
  let oob = 0;
  for (const actor of placedActorIds(project)) {
    for (const id of authoredMetasprites(tables, actor)) authoredIds.add(id);
    const behavior = project.sprites.actors[actor]?.behavior;
    for (const s of enumerateStates(tables, actor, behavior, rules)) {
      states += 1;
      const pose = resolvePose(tables, actor, s.dir, s.frame);
      if (pose.kind === 'oob') oob += 1;
      else if (pose.kind === 'ms') reachableIds.add(pose.msid);
    }
  }
  const authored = boundsOfMetasprites(project, authoredIds);
  const reachable = boundsOfMetasprites(project, reachableIds);
  const numbers = ['OXMIN', 'OXMAX', 'OYMIN', 'OYMAX', 'maxTiles'];
  const moved = numbers.filter((n) => authored[n] !== reachable[n]);
  const outside = [...reachableIds].filter((id) => !authoredIds.has(id));
  const ok = states > 0 && oob === 0 && reachable.unresolved === 0 && moved.length === 0;
  return { ok, states, oob, authored, reachable, moved, outsideAuthored: outside, authoredIds: [...authoredIds], reachableIds: [...reachableIds] };
}
