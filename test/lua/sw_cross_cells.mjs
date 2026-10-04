// Phase 3a slice S3b: the cells of the whole slice, enumerated and NORMALIZED (plan section 6.A.3, review 2 section 3). PURE: no build, no Mesen.
//
// One cell = one measurement. Every cell is normalized (all defaults written out) and keyed by its final ID, so an implicit default and the same value
// written explicitly are one cell (review 2: X4 had 436 lines but 432 distinct IDs, because a loop default and an explicit preset coincided). A cell
// that belongs to several stages (x1 and x3 both contain distance 200 / touchY 60 / many-small) is ONE job with `stages: [...]`; the stage verdicts
// each read it, and the union of the classes its stages require is what it is held to.
//
// Sides. Every cell has a `new` twin (the S3b tree) and a `parent` twin (the unchanged 15c11b7 tree: it stops at the seam, so a missing crossing there
// is expected; the parent only has to run soundly). A parent twin exists for EVERY new cell, the cross stage's included (review 2: X4 and X6 had none).
//
// Stages (the plan's stage names; `x5h`/`x5r` are the horizontal and return rows):
//   phase coincide pops anims lead   S3a's own stages, replayed on the S3b tree (planStage, unchanged)
//   x1  the long-Move envelope: distances 166..230 x games x art x five tails, PLUS the exact historical P0 rows (see HISTORICAL_P0)
//   x2  the crossing's strip-arm phase: touchY 40..87
//   x3  a populated destination: ten populations x five tails x two long distances
//   x4  the vertical composition (a Flash lead, a Move that crosses on its final step): bound x populations x tails, plus the nine animation presets
//   x5h the horizontal composition: the spike's registry of 97 normalized IDs (F1) and class (a), 26 alignments x 3 populations x 4 game shapes
//   x5r the return crossing, A -> B -> A: the live rebind that resolves the talker's last slot
//   x6  hand-written code (project.code), the vseam composition at the bound
import { planStage } from './run_sw_move_sweep.mjs';
import { cellId } from './sw_move_policy.mjs';
import { populations, TAILS } from './run_sw_move_manifest.mjs';
import { ANIM_PRESETS } from './sw_bound_sweep.mjs';

export const EXISTING_STAGES = ['phase', 'coincide', 'pops', 'anims', 'lead'];
export const CROSS_STAGES = ['x1', 'x2', 'x3', 'x4', 'x5h', 'x5r', 'x6'];
export const ALL_STAGES = [...EXISTING_STAGES, ...CROSS_STAGES];
export const SIDES = ['new', 'parent'];

const GAMES = ['action', 'rpg'];
const TAIL_NAMES = Object.keys(TAILS);
const PROJECTS = GAMES.flatMap((gt) => [true, false].map((wide) => ({ gt, wide })));

/**
 * The four historical rows of the long-Move envelope, EXACTLY (plan section 5; review 2: "preserve those four P0 rows explicitly on each side"): distance 200,
 * no lead, touchY 60, many-small, NO animation preset (P0), plain, with the tail the historical run used -- plus the tight/no-tail reference rows.
 */
export const HISTORICAL_P0 = [
  { gt: 'action', wide: true, tail: 'say' }, { gt: 'action', wide: false, tail: 'say' },
  { gt: 'rpg', wide: true, tail: 'flash' }, { gt: 'rpg', wide: false, tail: 'flash' },
  { gt: 'action', wide: false, tail: 'none' }, { gt: 'rpg', wide: false, tail: 'none' }
].map((r) => ({ ...r, dist: 200, lead: 'none', touchY: 60, pop: 'many-small', anim: null, bound: false }));

/** The 26 alignments of class (a) (Flash; Wait w; Flash; Move right 14; Set): the spike's hseamA2 hits, every one confirmed by the same-body classifier. */
export const CLASS_A_ALIGNMENTS = [
  [1, 244, 237, 210], [1, 244, 237, 214], [1, 244, 238, 206], [1, 244, 238, 210], [1, 245, 237, 210], [1, 245, 237, 214], [1, 245, 238, 206], [1, 245, 238, 210],
  [2, 244, 236, 206], [2, 244, 236, 210], [2, 244, 236, 214], [2, 244, 237, 206], [2, 245, 236, 206], [2, 245, 236, 210], [2, 245, 236, 214], [2, 245, 237, 206],
  [3, 244, 234, 210], [3, 244, 234, 214], [3, 244, 235, 206], [3, 244, 235, 210], [3, 244, 235, 214], [3, 245, 234, 210], [3, 245, 234, 214], [3, 245, 235, 206], [3, 245, 235, 210], [3, 245, 235, 214]
].map(([wf, startX, ty, startY]) => ({ wf, startX, ty, startY }));
export const CLASS_A_POPS = ['many-small', 'few-large-1', 'few-large-5'];
/**
 * RPG + switch-bound class (a), the buildable equivalent (review 1 finding 3). The 78 approved appendix IDs of this shape are refusal receipts (the Wait
 * between the two Flashes costs 43 kernel-lo bytes; free 144 -> 101). The equivalent replaces that Wait by the Wait-free gap (FLASHMOVE_GAP in
 * sw_cross_scene.mjs) and keeps everything else; many-small is the one population whose tables fit (need 128 <= free 144). These are the alignments the
 * real search found to produce the same-body class (a) on the RPG-bound scene itself (impl/fix1/classaprobe-rpg-bound.json: 8 of the 26 tried).
 */
export const CLASS_A_RPGBOUND_ALIGNMENTS = [[244, 236, 210], [244, 236, 206], [244, 236, 214], [245, 236, 210], [245, 236, 214], [245, 236, 206], [245, 237, 206], [244, 237, 206]]
  .map(([startX, ty, startY]) => ({ startX, ty, startY }));
/** Class (a)'s four game shapes: action plain (P0), action bound (P1), RPG plain (P0), RPG bound (P1; refused by capacity: the 78 of the appendix). */
export const CLASS_A_SHAPES = [{ gt: 'action', bound: false }, { gt: 'action', bound: true }, { gt: 'rpg', bound: false }, { gt: 'rpg', bound: true }];

// ----------------------------------------------------------------- normalization and IDs

const VERTICAL_DEFAULTS = { touchY: 60, lead: 'none', anim: 'P1', bound: false, pop: 'many-small' };
const HORIZONTAL_DEFAULTS = { pop: 'many-small', anim: 'P0', bound: false, enter: 'set', ty: 239 };
const VERTICAL_KEYS = ['which', 'gt', 'wide', 'pop', 'anim', 'bound', 'lead', 'tail', 'dist', 'touchY'];
/** The vertical scenes: 'walk' (the S3a scene, the default and never written into an id or an option), 'dest' (x3) and 'composed' (x4/x6), see sw_cross_scene.mjs. */
export const VERTICAL_SCENES = ['walk', 'dest', 'composed'];
const SCENE_ID = { dest: '/dest-pop', composed: '/composed' };
const HORIZONTAL_KEYS = ['which', 'gt', 'wide', 'pop', 'anim', 'bound', 'tail', 'enter', 'startX', 'startY', 'ty', 'dist'];

/** The ID of a horizontal cell. The F1 core keeps the spike's own spelling (an empty scene segment) because the committed appendix pins IDs in it. */
export function horizontalCore(c) {
  return [c.gt, '', c.wide ? 'wide' : 'tight', c.pop, c.anim, c.bound ? 'bound' : 'plain', `tail-${c.tail}`, `enter-${c.enter}`, `x${c.startX}y${c.startY}d${c.dist}`,
    ...(c.ty !== 239 ? [`ty${c.ty}`] : []), ...(c.lead2 ? [`${c.lead2}${c.wf}`] : []), ...(c.nolead ? ['nolead'] : [])].join('/');
}

/** Fills every default of a cell, validates it and gives it its final `id`. Throws on a field the stage does not know. */
export function normalizeCell(raw) {
  if (!ALL_STAGES.includes(raw.stage)) throw new Error(`unknown stage ${raw.stage}`);
  if (!SIDES.includes(raw.which)) throw new Error(`cell has no side: ${JSON.stringify(raw)}`);
  const horizontal = raw.stage === 'x5h' || raw.stage === 'x5r';
  const c = horizontal
    ? { ...HORIZONTAL_DEFAULTS, dir: 'right', ...raw }
    : { ...VERTICAL_DEFAULTS, dir: 'down', ...raw };
  for (const k of horizontal ? HORIZONTAL_KEYS : VERTICAL_KEYS) if (c[k] === undefined) throw new Error(`cell ${JSON.stringify(raw)} lacks ${k}`);
  if (!(c.tail in TAILS) && c.tail !== 'ret') throw new Error(`unknown tail ${c.tail}`);
  if (c.tail === 'ret' && c.stage !== 'x5r') throw new Error('the return tail belongs to x5r');
  if (c.scene !== undefined && (!VERTICAL_SCENES.includes(c.scene) || c.scene === 'walk' || horizontal)) throw new Error(`unknown or redundant scene ${c.scene}`);
  if (!(c.pop in populations(15))) throw new Error(`unknown population ${c.pop}`);
  if (c.anim !== null && !(c.anim in ANIM_PRESETS)) throw new Error(`unknown animation preset ${c.anim}`);
  c.id = (horizontal ? `${c.which}/${horizontalCore(c)}` : `${cellId(c)}${SCENE_ID[c.scene] ?? ''}${c.code ? '/code' : ''}`);
  return c;
}

/** The measured options of a cell, side and stage left out: what a recorded result must have been measured with to count for it (the reuse check). */
export function cellOptions(c) {
  const keys = c.dir === 'right' ? [...HORIZONTAL_KEYS, 'lead2', 'wf', 'nolead', 'kind', 'dir'] : [...VERTICAL_KEYS, 'kind', 'code', 'dir', 'scene'];
  return Object.fromEntries(keys.filter((k) => k !== 'which' && c[k] !== undefined).map((k) => [k, c[k]]));
}

// ----------------------------------------------------------------- the stages

const addAll = (out, stage, base) => { for (const which of SIDES) out.push(normalizeCell({ ...base, stage, which })); };

function crossVertical() {
  const out = [];
  const bases = (stage, c) => addAll(out, stage, c);
  // x1: the long-Move envelope (default P1), then the exact historical P0 rows
  for (const p of PROJECTS) for (const tail of TAIL_NAMES) for (let dist = 166; dist <= 230; dist++) bases('x1', { ...p, tail, dist });
  for (const h of HISTORICAL_P0) bases('x1', { ...h, kind: 'hist' });
  // x2: the crossing's strip-arm phase
  for (const p of PROJECTS) for (let touchY = 40; touchY <= 87; touchY++) bases('x2', { ...p, tail: 'none', dist: 200, touchY });
  // x3: a populated destination
  for (const p of PROJECTS) for (const pop of Object.keys(populations(15))) for (const tail of TAIL_NAMES) for (const dist of [200, 236]) bases('x3', { ...p, pop, tail, dist, scene: 'dest' });
  // x4: the vertical composition at the bound and without, every population and tail, then every animation preset
  const compose = { lead: 'flash', dist: 11, touchY: 239, scene: 'composed' };
  for (const p of PROJECTS) for (const bound of [false, true]) for (const pop of Object.keys(populations(bound ? 14 : 15))) for (const tail of TAIL_NAMES) bases('x4', { ...p, bound, pop, tail, ...compose });
  // (P1 is the default of the base loop above: the four cells it would add are those cells again -- review 2's 436 lines for 432 distinct IDs)
  for (const p of PROJECTS) for (const anim of Object.keys(ANIM_PRESETS).filter((a) => a !== 'P1')) bases('x4', { ...p, anim, bound: true, pop: 'many-small', tail: 'flash', ...compose });
  // x6: hand-written code (a user file and one unrelated engine override), the composition at the bound -- built, composition-validated and gated
  for (const p of PROJECTS) for (const pop of ['many-small', 'few-large-1']) bases('x6', { ...p, bound: true, pop, tail: 'flash', ...compose, code: true });
  return out;
}

/** The base scene's rows of the horizontal registry: the spike's confirmation rows (without the HEAD control and without the pure repeat). */
const F1_ROWS = [
  { wide: true, tail: 'switch' }, { wide: true, tail: 'none' }, { wide: true, tail: 'say' }, { wide: true, tail: 'flash' }, { wide: true, tail: 'move2' },
  { wide: false, tail: 'switch' }, { wide: true, tail: 'switch', animP1: true }, { wide: true, tail: 'switch', pop: 'few-large-1' },
  ...[204, 206, 208, 212, 214, 216, 218, 220].map((startY) => ({ wide: true, tail: 'switch', startX: 245, startY, dist: 11 }))
];
export const MATRIX_POPS = ['many-small', 'few-large-1', 'few-large-4', 'few-large-5'];
const F1_EXTRA_POPS = ['many-small', 'few-large-1', 'few-large-2', 'few-large-3', 'few-large-4', 'few-large-5', 'few-large-6', 'few-large-7', 'front', 'back'];

function crossHorizontal() {
  const out = [];
  const seen = new Set();
  // one normalized ID is one cell of the stage, whichever registry (F1, the matrix, class (a)) names it first
  const add = (stage, c) => { for (const which of SIDES) { const n = normalizeCell({ ...c, stage, which }); const key = `${stage}\u0000${n.id}`; if (seen.has(key)) continue; seen.add(key); out.push(n); } };
  // F1: the confirmation rows x games x plain/bound (bound runs P1), deduplicated by normalized ID, then the base scene across all ten populations
  for (const r of F1_ROWS) for (const gt of GAMES) for (const bound of [false, true]) {
    add('x5h', { kind: 'f1', gt, wide: r.wide, pop: r.pop ?? 'many-small', anim: bound || r.animP1 ? 'P1' : 'P0', bound, tail: r.tail, startX: r.startX ?? 246, startY: r.startY ?? 210, dist: r.dist ?? 10 });
  }
  for (const pop of F1_EXTRA_POPS) for (const gt of GAMES) for (const bound of [false, true]) add('x5h', { kind: 'f1', gt, wide: true, pop, anim: bound ? 'P1' : 'P0', bound, tail: 'switch', startX: 246, startY: 210, dist: 10 });
  // the original acceptance matrix, ALL 160 combinations (review 1 finding 3: only the F1 subset had been kept, so the 19 combinations the spike's third
  // review completed -- and 97 more -- were never planned): game x width x {many-small, few-large-1, few-large-4, few-large-5} x plain/bound x five tails
  for (const gt of GAMES) for (const wide of [true, false]) for (const pop of MATRIX_POPS) for (const bound of [false, true]) for (const tail of TAIL_NAMES) {
    add('x5h', { kind: 'matrix', gt, wide, pop, anim: bound ? 'P1' : 'P0', bound, tail, startX: 246, startY: 210, dist: 10 });
  }
  // the original matrix's ten combinations the parent cannot build (RPG, bound, wide, few-large-1 / few-large-4, five tails): planned like any
  // cell so that the approved appendix pins exact IDs that really exist; each is expected to be refused at build, on both sides
  for (const pop of ['few-large-1', 'few-large-4']) for (const tail of TAIL_NAMES) add('x5h', { kind: 'f1', gt: 'rpg', wide: true, pop, anim: 'P1', bound: true, tail, startX: 246, startY: 210, dist: 10 });
  // class (a): the drain + strip completion + column arm + crossing, 26 alignments x 3 populations x the four game shapes
  for (const a of CLASS_A_ALIGNMENTS) for (const pop of CLASS_A_POPS) for (const s of CLASS_A_SHAPES) {
    add('x5h', { kind: 'classA', gt: s.gt, wide: true, pop, anim: s.bound ? 'P1' : 'P0', bound: s.bound, tail: 'switch', lead2: 'flashwait', wf: a.wf, startX: a.startX, startY: a.startY, ty: a.ty, dist: 14 });
  }
  // class (a) on RPG + bound: the buildable equivalent, the Wait-free gap (kind classARpgBound, its own completion check)
  for (const a of CLASS_A_RPGBOUND_ALIGNMENTS) add('x5h', { kind: 'classARpgBound', gt: 'rpg', wide: true, pop: 'many-small', anim: 'P1', bound: true, tail: 'switch', lead2: 'flashmove', wf: 0, startX: a.startX, startY: a.startY, ty: a.ty, dist: 14 });
  // x5r: the return crossing -- Move right across the seam, then Move left back (the talker's last slot found by record), an observable Set after it
  for (const gt of GAMES) for (const wide of [true, false]) for (const bound of [false, true]) for (const pop of ['many-small', 'few-large-5']) {
    add('x5r', { kind: 'return', gt, wide, pop, anim: bound ? 'P1' : 'P0', bound, tail: 'ret', startX: 246, startY: 210, dist: 10 });
  }
  return out;
}

/** Every cell of the slice, both sides, deduplicated by final ID: [{ ...cell, stages: [...] }]. Throws if a stage lists one ID twice. */
export function enumerateAll({ tiles = 15 } = {}) {
  const byId = new Map();
  const perStage = new Map();
  const put = (c) => {
    const key = `${c.stage}\u0000${c.id}`;
    if (perStage.has(key)) throw new Error(`stage ${c.stage} lists ${c.id} twice`);
    perStage.set(key, true);
    const have = byId.get(c.id);
    if (have) { have.stages.push(c.stage); have.kinds.push(c.kind ?? null); return; }
    const { stage, ...rest } = c;
    byId.set(c.id, { ...rest, stage, stages: [c.stage], kinds: [c.kind ?? null] });
  };
  for (const stage of EXISTING_STAGES) for (const c of planStage(stage, { tiles })) put(normalizeCell({ ...c, stage }));
  for (const c of [...crossVertical(), ...crossHorizontal()]) put(c);
  return [...byId.values()];
}

/** Counts by stage and side (a cell in several stages counts under each; `unique` counts it once). */
export function countCells(cells) {
  const per = {};
  for (const c of cells) for (const s of c.stages) { per[s] ??= { new: 0, parent: 0 }; per[s][c.which]++; }
  const unique = { new: cells.filter((c) => c.which === 'new').length, parent: cells.filter((c) => c.which === 'parent').length };
  return { per, unique };
}
