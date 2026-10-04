// Phase 3a slice S3b: the SCENES of the cross stage, measured full-system in Mesen through the shipped manifest harness (run_sw_manifest.mjs).
//   vertical   x1..x4, x6  the S3a Move scene (run_sw_move_manifest.mjs: eight live actors, a Down walk along x = 242, the touch actor on the Down
//                          target) with a Move that now CROSSES the screen seam; `measureMove` is reused unchanged except for three optional
//                          parameters (extra marks, a custom-code project, build-only) whose defaults leave S3a's cells byte-identical.
//   horizontal x5h, x5r    the spike's authored corner scene (handoff-next/s3b/spike/probe.mjs, productized): the touch actor stands on
//                          (1, LR) at (246, ty), the player starts at (startX, startY) and walks Down onto it; its page is
//                          [Flash] + [Wait w + Flash] + Move player right dist + tail. x5r adds a return Move (A -> B -> A: the live rebind).
// Every cell records its own marks and the per-body trace; the classes of a body are decided by test/lua/sw_cross_classes.mjs from those, never by
// a frame number. Nothing here is a HARNESS_FILES member (test/lua/sw_provenance.mjs): it adds scenes and classification, not the harness.
import fs from 'node:fs';
import path from 'node:path';
import { runManifest, MESEN_DEFAULT } from './run_sw_manifest.mjs';
import { populations, measureMove, relocateTouchActor, LEADS, TAILS, BOUND_GRID_H } from './run_sw_move_manifest.mjs';
import { ANIM_PRESETS } from './sw_bound_sweep.mjs';
import { BOUND_TILE } from './sw_sweep_mutate.mjs';
import { compactRoot } from './sw_compact_root.mjs';
import { needsCompact, cellTiles } from './sw_move_policy.mjs';
import { REPO } from './sw_manifest_scene.mjs';
import { bodyRows } from './sw_cross_classes.mjs';

const held = (...xs) => Object.fromEntries(xs.map((x) => [x, true]));

/** The tail a return row runs after its first Move: back across the seam (a live rebind of the talker's last slot) and one observable effect. */
/** The return tail opens with a Flash so the second crossing's own body carries a palette publication (the producer the live rebind has to coexist with). */
export const RETURN_TAIL = [{ op: 'flash' }, { op: 'move', who: 'player', dir: 'left', dist: 14 }, { op: 'setSwitch', switch: 5 }];

/**
 * The marks every S3b cross cell records on the new engine (the talker bookkeeping is absent from the parent: those names are not symbols there).
 * `sw_tr_loop` is the rebind's slot scan -- one execution per slot looked at, so its count on a body IS the slot index + 1 of the talker's live slot
 * (MAX_ENTITIES executions = the last slot) -- and `sw_tr_gone` runs only when the talker was not found (review 1 finding 3: a last-slot live rebind
 * is proven by eight scan steps and no gone mark, not by the mere presence of sw_talker_rebind).
 */
export const TALKER_MARKS = ['sw_talker_cross', 'sw_talker_rebind', 'sw_tr_loop', 'sw_tr_gone'];
const COMMON_MARKS = ['settle_owed', 'start_dialog', 'move_tick', 'move_finish', 'sw_frame_camera_window', 'spawn_entities', 'sw_stream_start_row', 'sw_stream_start_col',
  'script_op_move'];
/**
 * The Flash producer's own evidence (spike review 3 section 2): `flash_left` at body handoff cannot say that Flash PUBLISHED on a body (a continuation's
 * `Flash` re-arms it to 7), so the producer's two publishing calls are marked -- flash_apply_on (the arm tick's palette packet) and fade_apply_palette
 * (the restore tick's). Recorded only in a cell that has a Flash command.
 */
export const FLASH_PRODUCER_MARKS = ['flash_tick', 'flash_apply_on', 'fade_apply_palette', 'script_op_flash'];

/** What each authored command is seen as: the handler that interprets it in a body, plus (a Flash) the producer's own evidence. */
export const OP_MARKS = {
  flash: FLASH_PRODUCER_MARKS, wait: ['script_op_wait'], say: ['script_op_say'], move: ['script_op_move'], setSwitch: ['script_op_set']
};
/** The marks a list of commands needs; an op this table does not know is an error (a new command must say what it is seen as). */
export function marksOfCommands(commands) {
  const out = [];
  for (const cmd of commands) {
    if (!(cmd.op in OP_MARKS)) throw new Error(`no marks are defined for the command ${cmd.op}`);
    out.push(...OP_MARKS[cmd.op]);
  }
  return out;
}

/**
 * The Wait-free gap between class (a)'s two Flashes (review 1 finding 3, the RPG-bound buildable equivalent): a Wait costs 43 kernel-lo bytes, which
 * RPG + bound cannot afford (free 144 -> 101), so the gap is two one-pixel Moves of the player (left, then right: net displacement zero). Move is
 * compiled in anyway; the alignments that still give the same-body class (a) were found by a real search (impl/fix1/classaprobe.mjs).
 */
export const FLASHMOVE_GAP = [{ op: 'move', who: 'player', dir: 'left', dist: 1 }, { op: 'move', who: 'player', dir: 'right', dist: 1 }];

/** The commands of the enter event a cell's destination carries (the observable work the owed entry does). */
export const enterCommands = (enter) => (enter === 'set' ? [{ op: 'setSwitch', switch: 6 }] : enter === 'wait' ? [{ op: 'wait', frames: 1 }] : []);

/**
 * The EXACT command list of the touch actor's event for one cell: the lead, the Move that crosses, the tail. Everything that reads or records what the
 * cell authored (the scene's flashCmds, the marks, the verdict) derives from this one list, so none can disagree with the scene (review 1 finding 2:
 * the implicit Flash lead of a horizontal cell was authored in the scene and absent from its marks).
 */
export function sceneCommands(c) {
  if (c.dir === 'right') {
    const lead = c.lead2 === 'flashwait' ? [...LEADS.flash, { op: 'wait', frames: c.wf ?? 1 }, ...LEADS.flash]
      : c.lead2 === 'flashmove' ? [...LEADS.flash, ...FLASHMOVE_GAP, ...LEADS.flash]
      : c.nolead ? [] : LEADS.flash;
    return [...lead, { op: 'move', who: 'player', dir: 'right', dist: c.dist }, ...(c.tail === 'ret' ? RETURN_TAIL : TAILS[c.tail])];
  }
  return [...LEADS[c.lead ?? 'none'], { op: 'move', who: 'player', dir: 'down', dist: c.dist }, ...TAILS[c.tail]];
}

/** The marks one cell records, derived from what it authored. `which === 'parent'` drops the talker symbols (they do not exist on the parent tree). */
export function crossMarks(c) {
  const marks = [...COMMON_MARKS];
  if (c.which !== 'parent') marks.push(...TALKER_MARKS);
  marks.push(...marksOfCommands(sceneCommands(c)));
  const populated = c.dir === 'right' || c.scene === 'dest' || c.scene === 'composed';
  marks.push(...marksOfCommands(enterCommands(populated ? (c.enter ?? 'set') : 'none')));
  return [...new Set(marks)];
}

/** A user file and one unrelated verbatim engine override: the hand-written-code shape of B1 (the uncached path), built through project.code. */
export function customCode(root) {
  return { overrides: [{ name: 'title.asm', text: readEngine(root, 'title.asm') }], files: [{ name: 'user_probe.asm', text: 'user_probe:\n  .db 1\n' }] };
}
const readEngine = (root, name) => fs.readFileSync(path.join(root, 'engine', name), 'utf8');

// ----------------------------------------------------------------- shared scene pieces

const nameOf = (p, e) => p.sprites.actors[e.actorId].name;
/** The tile count of an entity's walkDown first pose (what the budget counts). */
const tilesOfEntity = (p, e) => { const a = p.sprites.actors[e.actorId]; const an = p.sprites.animations[a.anims?.walkDown]; const ms = an && p.sprites.metasprites[an.frames[0]?.metaspriteId]; return ms ? ms.tiles.length : 0; };
const enterProps = (enter) => ({ trigger: 'enter', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: enterCommands(enter) }] } });
/** One switch-bound tile on an ordinary second map: the bound variant of every cell (the scene then holds 14 tiles, not 15). */
function addBoundMap(p, { createMap, createScreen }) {
  const om = createMap(1, 'Ordinary');
  om.tilesetId = 0; om.gridW = 1; om.gridH = 1; om.screens = [createScreen()];
  om.screens[0].boundTiles = [{ ...BOUND_TILE }];
  p.maps.push(om);
}
/** The build-time facts a scene asserts on, read from the MUTATED project: what a screen holds, not what the mutation meant to build. */
function screenFacts(p, screen) {
  const ents = screen.entities ?? [];
  return { entities: ents.length, tiles: ents.reduce((n, e) => n + tilesOfEntity(p, e), 0), enter: ents.filter((e) => e.props?.trigger === 'enter').length, names: ents.map((e) => nameOf(p, e)) };
}
const TOUCH_NAME = 'ShakeFlashNpc';

// ----------------------------------------------------------------- horizontal

/**
 * The runManifest options of one horizontal cell, plus the build-time `facts` the scene asserts on (filled when the project is mutated).
 * x5r (`c.tail === 'ret'`) populates its SOURCE screen as well: the return crossing must land on a populated screen whose enter actor owes an entry,
 * with the talker in the LAST slot (7), so the live rebind has to scan all eight slots (review 1 finding 3).
 */
export function horizontalOptions(c, { tiles = 15, root = REPO } = {}) {
  const facts = {};
  const { gt, wide, pop = 'many-small', anim = 'P0', bound = false, tail, startX, startY, ty = 239, enter = 'set' } = c;
  const mutate = (p, { createMap, createScreen }) => {
    const m = p.maps[0];
    const LR = m.gridH - 3;
    const W = m.gridW;
    const right = m.screens[LR * W + 2];
    const t = right.entities.find((e) => nameOf(p, e) === TOUCH_NAME);
    right.entities.splice(right.entities.indexOf(t), 1);
    const src = m.screens[LR * W + 1];
    src.entities ??= [];
    const template = structuredClone(m.screens[(LR + 1) * W + 2].entities); // seven chasers and the damage npc
    if (tail === 'ret') {
      // the return destination: seven populated actors, one of them (slot 6) the enter actor, and the talker last
      src.entities.push(...template.slice(0, 7));
      if (enter !== 'none') src.entities[6].props = enterProps(enter);
    }
    src.entities.push(t); // the LAST entity of its screen: the slot a live rebind resolves last
    t.x = startX; t.y = ty;
    p.project.startScreen = LR * W + 1; p.project.startX = startX; p.project.startY = startY;
    right.entities = structuredClone(template); // both possible rightward destinations are populated
    for (const sc of [right, m.screens[(LR + 1) * W + 2]]) {
      const e = sc.entities.at(-1);
      if (enter !== 'none') e.props = enterProps(enter);
    }
    if (bound) addBoundMap(p, { createMap, createScreen });
    const dest = screenFacts(p, m.screens[LR * W + 2]);
    const from = screenFacts(p, src);
    Object.assign(facts, {
      destEntities: dest.entities, destTiles: dest.tiles, enterEvents: dest.enter,
      boundTiles: p.maps.reduce((n, mm) => n + mm.screens.reduce((k, sc) => k + (sc.boundTiles?.length ?? 0), 0), 0),
      touchOnSource: src.entities.some((e) => nameOf(p, e) === TOUCH_NAME),
      srcEntities: from.entities, srcTiles: from.tiles, srcEnter: from.enter, touchSlot: src.entities.findIndex((e) => nameOf(p, e) === TOUCH_NAME)
    });
    return { turn: null, boundTile: bound ? BOUND_TILE : null };
  };
  const commands = sceneCommands({ ...c, dir: 'right' });
  const phases = [{ name: 'boot', waitFor: 'gameplay' }, { name: 'M11', collect: true, marks: true, trace: true, frames: 240, held: held('down') }];
  const useRoot = gt === 'rpg' && bound ? compactRoot(root) : root;
  return { facts, opts: { root: useRoot, gt, wide, sizes: populations(cellTiles({ bound }, tiles))[pop], anim: ANIM_PRESETS[anim] ?? null, flashCmds: commands, mutate, phases, marks: crossMarks({ ...c, dir: 'right' }), ...(bound && gt === 'action' ? { gridH: BOUND_GRID_H } : {}) } };
}

// ----------------------------------------------------------------- vertical

/**
 * The frames a vertical cell records after the walk to the touch actor. The player reaches a touch actor at y after walking down along x = 242;
 * in the 'composed' scene (the touch actor stays on the SOURCE screen, destination = the next screen) the crossing is measured to land about
 * COMPOSED_APPROACH frames in; the Move and the owed entry then need a few dozen more, and a tail a Say/second Move/Flash up to ~120 (review 1
 * finding 1: the old window ended 100 frames before the touch actor was reached).
 */
export const VERTICAL_APPROACH = { walk: 192, dest: 192, composed: 215 };
export function verticalWindow(c) {
  const scene = c.scene ?? 'walk';
  const moveFrames = Math.ceil(c.dist * 1.2);
  const reach = scene === 'composed' ? VERTICAL_APPROACH.composed : VERTICAL_APPROACH[scene] + Math.max(0, Math.ceil(((c.touchY ?? 60) - 60) / 1.5));
  return reach + 20 + moveFrames + 140;
}

/**
 * The runManifest options of one populated vertical cell (x3 'dest', x4/x6 'composed'; the S3a 'walk' scene is measureMove's own).
 *   composed  the touch actor stays on its own screen (2, LR) -- its LAST slot -- at (242, touchY); the destination (2, LR+1) carries all eight actors
 *             (the damage npc, last, owns an enter event whose Set is the observable owed work). Not the last world row: the camera is not clamped,
 *             so the crossing body can arm a row strip (the pilot's vertical composition, plan 4.4).
 *   dest      the S3a walk scene (touch actor on the Down screen) whose crossing destination, the NEXT screen, is populated the same way.
 */
export function verticalOptions(c, { tiles = 15, root = REPO } = {}) {
  const facts = {};
  const { gt, wide, pop = 'many-small', anim = 'P1', bound = false, touchY = 60 } = c;
  const scene = c.scene ?? 'walk';
  if (scene !== 'dest' && scene !== 'composed') throw new Error(`verticalOptions builds the populated scenes only, not '${scene}'`);
  const enter = c.enter ?? 'set';
  const mutate = (p, helpers) => {
    const m = p.maps[0];
    const LR = m.gridH - 3;
    const W = m.gridW;
    const down = m.screens[(LR + 1) * W + 2];
    const origDown = structuredClone(down.entities); // seven chasers and the damage npc, before the touch actor moves in
    let src; let dest;
    if (scene === 'composed') {
      src = m.screens[LR * W + 2];
      dest = down;
      const t = src.entities.find((e) => nameOf(p, e) === TOUCH_NAME);
      t.x = 242; t.y = touchY;
      const dmg = dest.entities.find((e) => nameOf(p, e) === 'DamageNpc');
      if (enter !== 'none') dmg.props = enterProps(enter);
    } else {
      relocateTouchActor(p, touchY); // the touch actor onto the Down screen; the damage npc leaves it
      src = down;
      dest = m.screens[(LR + 2) * W + 2];
      dest.entities = structuredClone(origDown);
      if (enter !== 'none') dest.entities.at(-1).props = enterProps(enter);
    }
    if (c.code) p.code = structuredClone(customCode(root));
    if (bound) addBoundMap(p, helpers);
    const d = screenFacts(p, dest);
    const from = screenFacts(p, src);
    Object.assign(facts, {
      destEntities: d.entities, destTiles: d.tiles, enterEvents: d.enter,
      boundTiles: p.maps.reduce((n, mm) => n + mm.screens.reduce((k, sc) => k + (sc.boundTiles?.length ?? 0), 0), 0),
      touchOnSource: src.entities.some((e) => nameOf(p, e) === TOUCH_NAME),
      srcEntities: from.entities, srcTiles: from.tiles, srcEnter: from.enter, touchSlot: src.entities.findIndex((e) => nameOf(p, e) === TOUCH_NAME)
    });
    return { turn: null, boundTile: bound ? BOUND_TILE : null };
  };
  const frames = verticalWindow(c);
  const phases = [
    { name: 'boot', waitFor: 'gameplay' },
    { name: 'pre', frames: 95, held: held('down') },
    { name: 'walkR', frames: 260, held: held('right', 'down') },
    { name: 'M11', collect: true, marks: true, trace: true, frames, held: held('down') }
  ];
  const useRoot = needsCompact(c) ? compactRoot(root) : root;
  return { facts, opts: { root: useRoot, gt, wide, sizes: populations(cellTiles({ bound }, tiles))[pop], anim: anim ? ANIM_PRESETS[anim] : null, flashCmds: sceneCommands(c), mutate, phases, marks: crossMarks(c), ...(bound && gt === 'action' ? { gridH: BOUND_GRID_H } : {}) } };
}

/** Whether the cell's scene is built through the compacting root (sw_compact_root.mjs): recorded in its source block, so the generator hash can be read as compact. */
export const usesCompactRoot = (c) => (c.dir === 'right' ? c.gt === 'rpg' && Boolean(c.bound) : needsCompact(c));
const isPopulatedVertical = (c) => c.dir === 'down' && (c.scene === 'dest' || c.scene === 'composed');

// ----------------------------------------------------------------- one measurement

/**
 * One cell, built and (unless `prepareOnly`) run. Returns { cell, rows, facts, prov, status, done, timeout, res? }: `rows` is the body list
 * (test/lua/sw_cross_classes.mjs bodyRows), the input of every classifier. A capacity refusal is the build's own plain-language error and is thrown.
 */
export async function measureCrossCell(c, { tiles = 15, root = REPO, mesen = MESEN_DEFAULT, prepareOnly = false, keepRes = false } = {}) {
  if (c.dir === 'right' || isPopulatedVertical(c)) {
    const { facts, opts } = c.dir === 'right' ? horizontalOptions(c, { tiles, root }) : verticalOptions(c, { tiles, root });
    const res = await runManifest({ ...opts, mesen, prepareOnly });
    if (prepareOnly) return { cell: c, facts, prov: res.prov, cacheKey: res.cacheKey, prepared: true };
    return { cell: c, facts, rows: bodyRows(res), prov: res.prov, cacheKey: res.cacheKey, status: res.status, done: res.done, timeout: res.timeout, frames: res.frames, timing: res.timing, ...(keepRes ? { res } : {}) };
  }
  const v = { gt: c.gt, tail: c.tail, lead: c.lead, dist: c.dist, wide: c.wide, tiles: cellTiles(c, tiles), pop: c.pop, anim: c.anim, bound: c.bound, touchY: c.touchY, mesen };
  const rootFor = needsCompact(c) ? compactRoot(root) : root;
  const out = await measureMove({ ...v, root: rootFor, extraMarks: crossMarks(c), customCode: c.code ? customCode(root) : null, prepareOnly });
  if (prepareOnly) return { cell: c, prov: out.res.prov, cacheKey: out.res.cacheKey, prepared: true };
  return { cell: c, rows: bodyRows(out.res), prov: out.res.prov, cacheKey: out.res.cacheKey, status: out.res.status, done: out.res.done, timeout: out.res.timeout, frames: out.res.frames, timing: out.res.timing, summary: out.summary, ...(keepRes ? { res: out.res } : {}) };
}
