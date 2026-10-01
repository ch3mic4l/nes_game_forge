// The Mesen sweep behind STREAM_TILE_BOUND (phase 3a slice S1, plan section 5.5 / 11): plans a job list, runs it (one scene ROM +
// one Mesen run per job, test/lua/run_sw_manifest.mjs), and aggregates the results into test/fixtures/streambound-curve.json with
// per-job provenance (test/lua/sw_provenance.mjs).
//
//   node test/lua/sw_bound_sweep.mjs plan <stage> [--n=..] [--from=out.jsonl,..] > jobs.jsonl    (stages A B C F R S; `plan <stage> | wc -l` counts)
//   node test/lua/sw_bound_sweep.mjs run  <jobs.jsonl> <out.jsonl> [--procs=20]       (resumable: keeps only valid same-provenance records; STOPS at the first candidate-n gate failure; exit 1/3/5)
//   node test/lua/sw_bound_sweep.mjs runF <jobs.jsonl> <out.jsonl> [--procs=20]       (stage F: in plan order, each curve stops at its first CONFIRMED failing row (re-run once alone, never reused); exit 4 if a curve is exhausted)
//   node test/lua/sw_bound_sweep.mjs agg  <out.jsonl>... [--write]                    (prints, or writes the fixture; REFUSES mixed or missing provenance)
//   node test/lua/sw_bound_sweep.mjs worst <out.jsonl>... [--k=20] [--n=..]           (top jobs by G, as a job list)
//
// THE DESIGN (Chris's ruling of 2026-09-30, margin policy): the shipped bound of a curve is the largest passing n, minus one, so a curve
// needs two facts: (1) EVERYTHING passes at the candidate n (plain 16, bound tiles 15), exhaustively; (2) at least one CONFIRMED failing
// row at the next n (plain 17, bound tiles 16), found by a failure search and re-run once alone. Every other n is SAMPLED, and the
// curve's provenance says so. The stages:
//   A  named rows (the review cases) and the dense Flash-y band 186-238 on P6/P8, at the candidate n only
//   B  the Q1c grid at the candidate n of each curve: P1-P8 x 2 arts x 4 shapes x k{0,4,7,8} x (12 y + Flash-free)
//   C  full unordered-partition sets at the candidate n of each curve, presets P1/P2/P6/P8, both arts, k = 0, y 225 and 234
//   F  the failure search at the next n of each curve, likeliest-to-fail first, each curve stopping at its first failing row
//   R  RPG spot checks at n = 16: P0/P1/P5/P7/P8, both arts, k{0,7}, a sampled set of partitions including the uneven ones
//   S  the authored stand/say scenarios and the SYNTHETIC forced-Flash stress (not part of the bound; optional)
//
// The record is EVIDENCE FOR ONE ENGINE: it stores a fingerprint of engine/*.asm (comments stripped) and
// test/unit/streamtilebound.test.js fails when the engine no longer matches, because a change that moves the cycles of a streamed body
// invalidates every figure in it. Re-run all stages, then `agg --write`.
//
// Axes (every scene is normalized and must validate with zero errors, sw_manifest_scene.mjs; the authored mutation is sw_sweep_mutate.mjs):
//   gt          action | rpg
//   art         tight (each actor's art exactly its tile count) | wide (+ a far actor with +-128 art: the project-global
//               bounds lose the inside fast path)
//   scenario    walk (column strip, touch Flash, row strip: authored) | stand | say (authored) | stress (SYNTHETIC, RAM re-arm)
//   y           the touch-Flash npc's y (null = Flash-free; 225 = restore publication on the row arm, 234 = Flash-on)
//   n           sprite tiles on the busy screen = the sum of the eight actors' art
//   sizes       one distribution of n over the eight actors: a partition (parts 1..16, at most eight) assigned to slots by a rotation
//   k           blocked chasers: actors 0..k-1 stand at `pos` inside a solid box, so they probe every body and never move (k = 8 also
//               turns the eighth into a chaser, without the Flash event)
//   bound       an ordinary second map with one switch-bound tile turns BOUND_TILE_ENABLED on project-wide (grid 3x60)
//   anim        ANIM_PRESETS: frame count, per-frame duration (per actor slot), alternate one-tile pose
//   tag         a NAMED non-standard row (pos / flash x / R3-F1 turn animations); '' for the standard configuration
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runManifest, SCENARIOS, GATE } from './run_sw_manifest.mjs';
import { REPO } from './sw_manifest_scene.mjs';
import { engineFingerprint } from '../lib/enginefingerprint.js';
import { makeMutate, shapes, YSET, POS } from './sw_sweep_mutate.mjs';
import { processProvenance, provenanceFieldProblems, provenanceUniformityProblems, sourceDifferences, assertSameSources, SourceChangedError, MeasurementCache, UNIFORM_FIELDS } from './sw_provenance.mjs';
import { MESEN_DEFAULT } from './run_sw_manifest.mjs';

export const OUT_FIXTURE = path.join(REPO, 'test/fixtures/streambound-curve.json');
export const MAX_PART = 16; // LIMITS: one actor's art is at most 16 tiles in these scenes (a 4x4 grid)
export const ACTORS = 8;

// Animation presets: `frames`/`dur` are per actor slot 0-7 (a scalar applies to all eight). A per-slot `dur` may itself be a
// vector, one duration per frame (P8).
//
// These are SAMPLED timing coverage of what the editor admits, not the admitted domain: the editor allows up to 32 frames per
// animation, durations 1..255 and non-looping animations (shared/project.js), while P0..P8 use 1..4 frames, durations 1/2/8 and
// loops. Nothing here claims the bound holds over the larger domain; the reasoning that carries it further (a longer
// duration only removes advances, so the entity_animate work of a body is at most the all-durations-1 case's) is in
// shared/streambound.js and the report, and is an argument, not a measurement.
export const ANIM_PRESETS = {
  P0: null, // legacy: one frame, duration 8 (never advances) -- the art of the pre-fix-round-1 curve
  P1: { frames: 2, dur: 1 }, // every actor advances on the same body; every other advance wraps
  P2: { frames: 2, dur: 1, alt: true }, // as P1, the odd frame a one-tile pose (metasprite change on every advance)
  P3: { frames: 3, dur: 1 }, // wraps every third advance
  P4: { frames: 2, dur: [1, 2, 1, 2, 1, 2, 1, 2] }, // two periods: the actors go out of phase
  P5: { frames: 4, dur: [1, 1, 2, 2, 1, 1, 2, 2], alt: true }, // four frames, mixed durations, one-tile odd frames
  P6: { frames: 2, dur: 2 }, // slower: advance every third body
  P7: { frames: [2, 3, 2, 3, 2, 3, 2, 3], dur: 1 }, // different frame counts: wraps at different bodies
  // fix round 2 (the reviewer's extra workload): three frames with an alternate pose and per-slot duration VECTORS that vary
  // within one animation -- [1,2,1], [2,1,1], [1,1,2] cycling over the eight slots -- so an actor advances on a different
  // body of its cycle than its neighbours and no two adjacent frames of one actor share a duration
  P8: { frames: 3, dur: [[1, 2, 1], [2, 1, 1], [1, 1, 2], [1, 2, 1], [2, 1, 1], [1, 1, 2], [1, 2, 1], [1, 1, 2]], alt: true }
};

// Partitions of n into at most `maxParts` parts of 1..maxPart, parts in descending order.
export function partitions(n, maxParts = ACTORS, maxPart = MAX_PART) {
  const out = [];
  const go = (left, max, acc) => {
    if (left === 0) { out.push(acc.slice()); return; }
    if (acc.length === maxParts) return;
    for (let p = Math.min(max, left); p >= 1; p--) { acc.push(p); go(left - p, p, acc); acc.pop(); }
  };
  go(n, maxPart, []);
  return out;
}
export const padSizes = (part) => { const d = part.slice(); while (d.length < ACTORS) d.push(0); return d; };
export const rotate = (d, r) => d.map((_, i) => d[(i + r) % ACTORS]);
export const partitionKey = (sizes) => sizes.filter((v) => v > 0).sort((a, b) => b - a).join(',');
export const partitionDigest = (keys) => crypto.createHash('sha256').update([...new Set(keys)].sort().join('|')).digest('hex').slice(0, 16);

const arg = (name, dflt) => { const a = process.argv.find((s) => s.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
const list = (v) => String(v).split(',').map((s) => (Number.isNaN(Number(s)) ? s : Number(s)));

// The two curves and the n that decides each (Chris's ruling of 2026-09-30). `plain` is a streamed project with no switch-bound
// tile; `bound` has BOUND_TILE_ENABLED project-wide (an ordinary second map with one bound tile, grid 3x60).
export const CANDIDATE = { plain: 16, bound: 15 };
export const EVIDENCE_N = { plain: 17, bound: 16 };
export const CURVES = ['plain', 'bound'];
export const GRID_H = { plain: undefined, bound: 60 }; // 3x61 does not build with BOUND_TILE_ENABLED
export const PRESETS_B = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];
export const PRESETS_C = ['P1', 'P2', 'P6', 'P8'];
export const KS_B = [0, 4, 7, 8];
export const SHAPES_B = ['even', 'front', 'back', 'scatter'];
export const YS_C = [225, 234];
export const DENSE_Y = Array.from({ length: 53 }, (_, i) => 186 + i); // 186..238
export const RPG_PRESETS = ['P0', 'P1', 'P5', 'P7', 'P8'];
export const RPG_KS = [0, 7];
export const RPG_PARTITIONS = 25;
export const POS_GRID = [[175, 184], [175, 191], [175, 192], [175, 198], [175, 199], [175, 201], [175, 202], [175, 207], [175, 208], [175, 215], [175, 216], [160, 200], [167, 200], [168, 200], [176, 200], [183, 200], [184, 200], [191, 200]];
const ARTS = [false, true]; // wide?

// NAMED non-standard rows: a tag names one authored configuration. `at(n)` is the sizes for a tile count n; `cfg` the mutation; `flashX`.
const R3_POS = [175, 159];
const r3 = (turn, k = 7) => ({ anim: 'P2', wide: true, y: 234, k, pos: R3_POS, geom: 'r3patch', turn, sizes: (n) => [n - 13, 2, 2, 2, 2, 2, 2, 1] });
export const NAMED = {
  // review 3, R3-F1: chasers authored inside a solid patch with direction-specific looping turn animations (side/up length, down length)
  r3turn: r3({ side: 4, up: 4, down: 2, dur: 1 }),
  r3ctl: r3(null),
  r3reset: r3({ side: 3, up: 3, down: 1, dur: 1 }),
  // review 2: Flash x outside the 12-y grid's own x (241), placement (174,203), sizes [1,3,1,3,1,3,1,3] at k=5
  flashx241: { flashX: 241 },
  pos174_203: { pos: [174, 203] },
  k5alt: { k: 5, sizes: (n) => { const s = [1, 3, 1, 3, 1, 3, 1, 3]; s[7] -= 16 - n; return s; } },
  // review 2/Q1c viii: placements around the box and its edges
  ...Object.fromEntries(POS_GRID.map((p) => [`pos${p[0]}_${p[1]}`, { pos: p }]))
};

// evenly strided sample of k items
const sample = (xs, k) => { if (xs.length <= k) return xs; const out = []; for (let i = 0; i < k; i++) out.push(xs[Math.floor((i * xs.length) / k)]); return out; };

/**
 * One job. `shape` labels how the sizes were chosen ('even' | 'front' | 'back' | 'scatter' | 'part' | 'named'); `tag` names a
 * non-standard configuration ('' = the standard one); `y` is the touch-Flash npc's y (null = Flash-free); `k` the blocked chasers.
 */
export function mkJob({ stage, gt = 'action', sizes, wide, anim, y, k = 0, shape, bound = false, tag = '', pos, flashX, geom, turn = null, scenario = 'walk', idle = 0, authored = true }) {
  const n = sizes.reduce((a, b) => a + b, 0);
  const cfg = authored ? { k, geom: geom ?? 'box', pos: pos ?? POS, flash: y !== null, ...(bound ? { bound: true } : {}), ...(turn ? { turn } : {}) } : null;
  const id = [gt, wide ? 'wide' : 'tight', anim, `n${n}`, `k${k}`, shape, y === null ? 'free' : `y${y}`, bound ? 'bound' : null, tag || null, flashX && flashX !== 242 ? `fx${flashX}` : null, `s${sizes.join('.')}`, scenario !== 'walk' ? scenario : null, idle ? `i${idle}` : null].filter(Boolean).join('-');
  return { id, stage, gt, wide: !!wide, anim, n, sizes, y, k, shape, bound, tag, scenario, idle, flashX: flashX ?? 242, gridH: bound ? GRID_H.bound : null, cfg };
}

// the standard configuration at n for one curve: the Q1c grid's own cells
function gridJobs(stage, curve, n, { presets, ks, shapeNames = SHAPES_B, ys = YS_Q1C, arts = ARTS, gt = 'action' }) {
  const out = [];
  const bound = curve === 'bound';
  for (const anim of presets) for (const wide of arts) for (const shape of shapeNames) {
    const sizes = shapes(n)[shape];
    if (!sizes) throw new Error(`no ${shape} shape at n=${n}`);
    for (const k of ks) {
      out.push(mkJob({ stage, gt, sizes, wide, anim, y: null, k, shape, bound }));
      if (k !== 8) for (const y of ys) out.push(mkJob({ stage, gt, sizes, wide, anim, y, k, shape, bound }));
    }
  }
  return out;
}
const YS_Q1C = YSET;

/** The full unordered-partition set of n for one curve, the C stage's presets/arts/ys. */
function partitionJobs(stage, curve, n, { gt = 'action', presets = PRESETS_C, ys = YS_C, k = 0, arts = ARTS } = {}) {
  const out = [];
  partitions(n).forEach((part, i) => {
    const sizes = rotate(padSizes(part), i % ACTORS);
    for (const wide of arts) for (const y of ys) for (const anim of presets) out.push(mkJob({ stage, gt, sizes, wide, anim, y, k, shape: 'part', bound: curve === 'bound' }));
  });
  return out;
}

const namedJob = (stage, curve, n, tag, over = {}) => {
  const d = NAMED[tag];
  const sizes = (d.sizes ?? ((m) => shapes(m).even))(n);
  return mkJob({ stage, sizes, wide: d.wide ?? true, anim: d.anim ?? 'P8', y: d.y ?? 216, k: d.k ?? 7, shape: 'named', bound: curve === 'bound', tag, pos: d.pos, flashX: d.flashX, geom: d.geom, turn: d.turn ?? null, ...over });
};

function stageA(curve = null) {
  const jobs = [];
  for (const c of curve ? [curve] : CURVES) {
    const n = CANDIDATE[c];
    // R3-F1 named scenes (the review 3 authored turn / reset / control scenes)
    for (const tag of ['r3turn', 'r3ctl', 'r3reset']) jobs.push(namedJob('A', c, n, tag));
    // review 2: Flash x 241, placement (174,203), sizes [1,3,1,3,1,3,1,3] at k=5; P6 and P8 wide, four Flash y
    for (const tag of ['flashx241', 'pos174_203', 'k5alt']) for (const anim of ['P6', 'P8']) for (const y of [212, 216, 225, 234]) jobs.push(namedJob('A', c, n, tag, { anim, y }));
    // dense Flash y band 186-238, P6 and P8 wide k=7, even and front
    for (const anim of ['P6', 'P8']) for (const shape of ['even', 'front']) for (const y of DENSE_Y) jobs.push(mkJob({ stage: 'A', sizes: shapes(n)[shape], wide: true, anim, y, k: 7, shape, bound: c === 'bound' }));
    // odd k (1, 3, 5), a sample
    for (const anim of ['P6', 'P8']) for (const shape of ['even', 'front']) for (const k of [1, 3, 5]) for (const y of [212, 216, 225]) jobs.push(mkJob({ stage: 'A', sizes: shapes(n)[shape], wide: true, anim, y, k, shape, bound: c === 'bound' }));
  }
  // review 2/Q1c viii: the placement grid around the box, on the plain curve
  for (const tag of POS_GRID.map((p) => `pos${p[0]}_${p[1]}`)) for (const anim of ['P6', 'P8']) for (const y of [212, 216, 218]) jobs.push(namedJob('A', 'plain', CANDIDATE.plain, tag, { anim, y }));
  return jobs;
}

function stageR() {
  const jobs = [];
  const n = CANDIDATE.plain;
  const parts = partitions(n);
  const strided = sample(parts, RPG_PARTITIONS - 3).map((p, i) => ({ sizes: rotate(padSizes(p), i % ACTORS), shape: 'part' }));
  const set = [...['front', 'back', 'scatter'].map((s) => ({ sizes: shapes(n)[s], shape: s })), ...strided];
  for (const anim of RPG_PRESETS) for (const wide of ARTS) for (const k of RPG_KS) for (const s of set) jobs.push(mkJob({ stage: 'R', gt: 'rpg', sizes: s.sizes, wide, anim, y: 234, k, shape: s.shape }));
  return jobs;
}

// the authored stand/say scenarios and the SYNTHETIC forced-Flash stress; not part of the bound
function stageS() {
  const jobs = [];
  for (const gt of list(arg('gt', 'action,rpg'))) {
    const n = 16;
    sample(partitions(n), Number(arg('k', 6))).forEach((part, i) => {
      const sizes = rotate(padSizes(part), i % ACTORS);
      for (const wide of ARTS) for (const y of YS_C) {
        for (const scenario of ['stand', 'say']) for (const anim of ['P0', 'P1', 'P5']) jobs.push(mkJob({ stage: 'S', gt, sizes, wide, anim, y, shape: 'part', scenario, authored: false }));
        if (gt === 'action') jobs.push(mkJob({ stage: 'S', gt, sizes, wide, anim: 'P0', y, shape: 'part', scenario: 'stress', authored: false }));
      }
    });
  }
  return jobs;
}

// ---- stage F: the failure search at the next n of each curve -------------------------------------------------------------
const FAIL_CAP = 500; // candidates per curve before the search gives up and reports
const bump = (sizes) => { // one more tile on the first smallest actor that can take it
  const s = sizes.slice(); let best = -1;
  for (let i = 0; i < s.length; i++) if (s[i] < MAX_PART && (best < 0 || s[i] < s[best])) best = i;
  s[best]++; return s;
};

/** The known failing shapes of Q1c (handoff-next/s1-q1c/fix1/f1.jsonl, prototype (a1)) at the next n of each curve. */
export function knownFailing(curve) {
  const n = EVIDENCE_N[curve];
  const out = [];
  const bound = curve === 'bound';
  if (curve === 'plain') {
    for (const y of [212, 214, 216]) for (const [anim, shape] of [['P8', 'even'], ['P6', 'front'], ['P8', 'front']]) out.push(mkJob({ stage: 'F', sizes: shapes(n)[shape], wide: true, anim, y, k: 7, shape }));
  } else {
    for (const y of [212, 214, 216]) for (const anim of ['P6', 'P8']) out.push(mkJob({ stage: 'F', sizes: shapes(n).even, wide: true, anim, y, k: 7, shape: 'even', bound }));
  }
  // review 3: the R3-F1 scenes at n+1
  for (const tag of ['r3turn', 'r3ctl', 'r3reset']) out.push(namedJob('F', curve, n, tag));
  return out;
}

/** The generic fallback grid, likeliest to fail first: tight presets, wide art, blocked chasers, the y values that failed in Q1c. */
function fallbackJobs(curve) {
  const n = EVIDENCE_N[curve];
  const bound = curve === 'bound';
  const out = [];
  const tiers = [
    { anims: ['P8', 'P6'], arts: [true], shapeNames: ['even', 'front'], ks: [7], ys: [216, 212, 214, 218, 225, 234] },
    { anims: ['P8', 'P6', 'P4', 'P7'], arts: [true], shapeNames: ['even', 'front', 'back', 'scatter'], ks: [7, 8, 4], ys: [216, 212, 214, 218, 225, 234, 209, 210, 202, 226] },
    { anims: ['P8', 'P6', 'P4', 'P7', 'P2', 'P5', 'P1', 'P3'], arts: [true, false], shapeNames: SHAPES_B, ks: [7, 8, 4, 0], ys: [216, 212, 214, 218, 225, 234, 209, 210, 202, 226, 193, 194, null] }
  ];
  for (const t of tiers) for (const k of t.ks) for (const y of t.ys) for (const shape of t.shapeNames) for (const anim of t.anims) for (const wide of t.arts) {
    if (k === 8 && y !== null && y !== t.ys[0]) continue;
    out.push(mkJob({ stage: 'F', sizes: shapes(n)[shape], wide, anim, y: k === 8 ? null : y, k, shape, bound }));
  }
  return out;
}

/** Stage F for one curve: the n+1 extensions of the worst-margin candidate-n rows (from `--from` records), then the known failing shapes, then the fallback grid; at most FAIL_CAP, each job once. */
export function stageF(curve, fromRows = []) {
  const seen = new Set(); const out = [];
  const add = (j) => { if (out.length < FAIL_CAP && !seen.has(j.id)) { seen.add(j.id); out.push({ ...j, curve, order: out.length }); } };
  const n = CANDIDATE[curve];
  const base = fromRows.filter((r) => !isBad(r) && r.gt === 'action' && !!r.bound === (curve === 'bound') && r.n === n && (r.scenario ?? 'walk') === 'walk' && r.cfg);
  base.sort((a, b) => jobMax(b) - jobMax(a));
  for (const r of base.slice(0, 120)) {
    const sizes = bump(r.sizes);
    add(mkJob({ stage: 'F', sizes, wide: r.wide, anim: r.anim, y: r.y, k: r.k, shape: r.shape === 'named' ? 'named' : r.shape, bound: !!r.bound, tag: r.tag, pos: r.cfg?.pos && r.tag ? r.cfg.pos : undefined, flashX: r.flashX, geom: r.cfg?.geom, turn: r.cfg?.turn ?? null }));
  }
  for (const j of knownFailing(curve)) add(j);
  for (const j of fallbackJobs(curve)) add(j);
  return out;
}

export function plan(stage) {
  if (stage === 'A') return stageA();
  if (stage === 'R') return stageR();
  if (stage === 'S') return stageS();
  if (stage === 'B') return CURVES.flatMap((c) => gridJobs('B', c, CANDIDATE[c], { presets: PRESETS_B, ks: KS_B }));
  if (stage === 'C') return CURVES.flatMap((c) => partitionJobs('C', c, CANDIDATE[c]));
  if (stage === 'F') {
    const from = arg('from', null) ? list(arg('from')).flatMap((f) => fs.readFileSync(String(f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))) : [];
    return CURVES.flatMap((c) => stageF(c, from));
  }
  throw new Error(`unknown stage ${stage}`);
}

// ---- running ---------------------------------------------------------------------------------------------------------------
// The fields that make a job THE SAME JOB: a record is a result for a planned job only if these agree. (Not `stage`: stages A and B plan some of the
// same jobs under one id, and the two results are one measurement.)
const JOB_FIELDS = ['gt', 'wide', 'anim', 'n', 'sizes', 'y', 'k', 'shape', 'bound', 'tag', 'scenario', 'idle', 'flashX', 'gridH', 'cfg', 'curve'];
export const jobConfig = (r) => JSON.stringify(JOB_FIELDS.map((f) => r?.[f] ?? null));
export const MAX_ATTEMPTS = 3; // an operational error is retried on resume at most this many attempts in all (the explicit retry policy)

/** `ctx`: { expect (the stage's source state), cache (a MeasurementCache), mesen, waitInflight }. */
export async function runJob(job, ctx = {}) {
  const ph = structuredClone(SCENARIOS[job.scenario ?? 'walk']);
  for (const p of ph) if (p.trace) p.trace = false;
  if (job.idle) ph.splice(1, 0, { name: 'idle', frames: job.idle });
  const cfg = job.cfg ? structuredClone(job.cfg) : null;
  const r = await runManifest({
    gt: job.gt, sizes: job.sizes, wide: !!job.wide, scenario: job.scenario ?? 'walk', phases: ph,
    flashAt: job.y !== null && job.y !== undefined ? [job.flashX ?? 242, job.y] : (cfg ? [242, 234] : null),
    anim: ANIM_PRESETS[job.anim ?? 'P0'], root: job.root, ...(job.gridH ? { gridH: job.gridH } : {}), mutate: cfg ? makeMutate(cfg) : null,
    expect: ctx.expect ?? null, cache: ctx.cache ?? null, prepareOnly: !!ctx.prepareOnly, jobId: job.id, waitInflight: ctx.waitInflight ?? true, ...(ctx.mesen ? { mesen: ctx.mesen } : {})
  });
  if (r.pending) return { pending: true };
  if (ctx.prepareOnly) return { id: job.id, cacheKey: r.cacheKey, prov: r.prov }; // builds the scene and computes the measurement key; no Mesen
  const out = { ...job, n: job.sizes.reduce((a, b) => a + b, 0), done: r.done, timeout: r.timeout, status: r.status, frames: r.frames, timing: r.timing, prov: r.prov, cacheKey: r.cacheKey, ...(r.reuse ? { reuse: r.reuse } : {}), phases: {} };
  for (const [k, v] of Object.entries(r.phases)) out.phases[k] = { maxG: v.maxG, gateFail: v.gateFail, n: v.n };
  return out;
}

const readLines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const DEFER = Symbol('defer');

/** `fn(item, index, deferrals)` runs on up to `procs` workers; it may answer DEFER (the item goes to the back of the queue); `stop()` ends the scheduling (running items finish). */
async function pool(items, procs, fn, { stop = () => false } = {}) {
  const queue = items.map((item, i) => ({ item, i, deferrals: 0 }));
  await Promise.all(Array.from({ length: Math.max(1, Math.min(procs, items.length)) }, async () => {
    while (queue.length && !stop()) {
      const e = queue.shift();
      if ((await fn(e.item, e.i, e.deferrals)) === DEFER) { e.deferrals++; queue.push(e); await new Promise((res) => setTimeout(res, 25)); }
    }
  }));
}
// an OPERATIONAL error (Mesen died, the build threw) becomes an error row; a changed source state is not one: it aborts the stage
const runOne = async (j, ctx = {}) => { try { return await runJob(j, ctx); } catch (e) { if (e instanceof SourceChangedError) throw e; return { ...j, error: String(e).slice(0, 300) }; } };

/** The source state a stage runs against: read FRESH (uncached) now, and again whenever the stage checks. */
export const makeProvenance = ({ root = REPO, mesen = MESEN_DEFAULT, harnessRoot = REPO } = {}) => (fresh = false) => processProvenance(root, mesen, { harnessRoot, freshMesen: fresh });

// ---- one gate, one confirmation -------------------------------------------------------------------------------------------
export const jobMax = (r) => Math.max(...Object.values(r.phases).map((p) => p.maxG));
const jobFails = (r) => Object.values(r.phases).reduce((a, p) => a + p.gateFail, 0);
/** A phase's gateFail and its maxG must say the same thing about the gate (failure is strictly G > GATE). */
const gateInconsistent = (r) => Object.values(r.phases ?? {}).some((p) => (p.gateFail > 0) !== (p.maxG > GATE));
/** Not a usable measurement: an operational error, an unfinished or timed-out session, a failed process, no phases, or fields that disagree about the gate. */
export const isBad = (r) => !!(r.error || !r.done || r.timeout || r.status !== 0 || !r.phases || gateInconsistent(r));
/** A GENUINE gate failure: a complete measurement in which some phase's worst frame exceeds the gate. */
export const genuineFailure = (r) => !isBad(r) && Object.values(r.phases).some((p) => p.gateFail > 0 && p.maxG > GATE);
const candidateCurve = (r) => (r.bound ? 'bound' : 'plain');
/** A failure at the candidate n of its curve, in a stage that must be clean (A, B, C, R): the bound is lower than expected. */
export const isCandidateFailure = (r) => ['A', 'B', 'C', 'R'].includes(r.stage) && r.n === CANDIDATE[candidateCurve(r)] && genuineFailure(r);

/**
 * THE confirmation predicate: fresh search (runF), resume and `agg` all ask it. `confirm` confirms `orig` only if both are valid
 * measurements carrying complete provenance, the confirmation is the isolated re-run of THIS job (same id root, configuration, curve and n),
 * the project and ROM hashes match, the process provenance (engine/harness/generator/Mesen) is the same, both are genuine gate failures,
 * and the confirmation itself ran Mesen (a reuse is not a confirmation). Returns the list of reasons it does not; [] = confirmed.
 */
export function confirmationProblems(orig, confirm) {
  if (!orig) return ['no original record'];
  if (!confirm) return ['no confirming record'];
  const p = [];
  for (const [label, r] of [['original', orig], ['confirmation', confirm]]) {
    if (isBad(r)) { p.push(`the ${label} is not a valid measurement`); continue; }
    for (const m of provenanceFieldProblems(r.prov)) p.push(`${label}: ${m}`);
    if (!genuineFailure(r)) p.push(`the ${label} is not a genuine gate failure`);
  }
  if (confirm.confirmOf !== orig.id || confirm.id !== `${orig.id}#confirm`) p.push('the confirming record is not the re-run of this original');
  if (jobConfig(orig) !== jobConfig(confirm)) p.push('the job configuration (curve, n, ...) differs');
  if (confirm.reuse) p.push('a confirmation must be an isolated Mesen run, not a reuse');
  if (orig.prov && confirm.prov) {
    if (orig.prov.project !== confirm.prov.project) p.push('the project hash differs');
    if (orig.prov.rom !== confirm.prov.rom) p.push('the ROM hash differs');
    const d = sourceDifferences(orig.prov, confirm.prov);
    if (d.length) p.push(`the process provenance differs (${d.join(', ')})`);
  }
  return p;
}

// ---- resume: reuse only what is valid ---------------------------------------------------------------------------------------
const measurementSig = (r) => JSON.stringify([jobConfig(r), r.cacheKey ?? null, r.prov ?? null, r.done ?? null, r.timeout ?? null, r.status ?? null, r.frames ?? null, Object.entries(r.phases ?? {}).map(([k, v]) => [k, v.maxG, v.gateFail, v.n]), r.error ?? null]);
/**
 * THE record-validity function shared by agg (`validateRows`) and resume (`loadResume`): the relationships of ONE raw record to the records
 * around it. `rowsOf(id)` lists the records with that id. A confirmation needs its original; a reuse needs a DIRECT measurement
 * (not itself a reuse) with the same cache key, project, ROM and measurement, and its own reference key must be its cache key.
 */
export function relationProblems(r, rowsOf) {
  const p = [];
  if (r.confirmOf && rowsOf(r.confirmOf).length === 0) p.push(`${r.id}: a confirmation whose original ${r.confirmOf} is absent`);
  if (r.reuse) {
    const all = rowsOf(r.reuse.of); const srcs = all.filter((x) => !x.reuse);
    if (all.length === 0) p.push(`${r.id}: reuse source ${r.reuse.of} is absent`);
    else if (srcs.length === 0) p.push(`${r.id}: reuse source ${r.reuse.of} is itself a reuse`);
    else if (!srcs.some((src) => src.cacheKey === r.cacheKey && r.reuse.key === r.cacheKey && src.prov?.project === r.prov?.project && src.prov?.rom === r.prov?.rom && JSON.stringify(src.phases) === JSON.stringify(r.phases) && src.frames === r.frames)) p.push(`${r.id}: reuse of ${r.reuse.of} does not match its key, project, ROM or measurement`);
  }
  return p;
}

/** Group records by id; repeated ids must agree on everything that was measured (configuration, cache key, provenance, project, ROM, measurements), or the call throws. */
export function groupRows(rows, label = 'records') {
  const groups = new Map();
  for (const r of rows) {
    if (typeof r?.id !== 'string' || !r.id) throw new Error(`REFUSED: a record in ${label} has no id`);
    if (!groups.has(r.id)) groups.set(r.id, []);
    groups.get(r.id).push(r);
  }
  const conflicts = [];
  for (const [id, g] of groups) if (g.some((r) => measurementSig(r) !== measurementSig(g[0]))) conflicts.push(id);
  if (conflicts.length) throw new Error(`REFUSED: ${conflicts.length} id(s) are recorded more than once with different configuration, provenance, project, ROM or measurements in ${label}: ${conflicts.slice(0, 5).join(', ')}`);
  return new Map([...groups].map(([id, g]) => [id, g[0]]));
}

/**
 * Load the out file for a resume and keep ONLY records that may be reused: a successful measurement of the same job, taken on the
 * source state this stage runs against. Everything else (an error row, a stale or mismatched record) is moved to <out>.superseded.jsonl
 * and the out file is rewritten without it, atomically, so a retry never leaves two records for one id (no first-result-wins). An error
 * row's attempt count is carried so the retry policy is bounded (MAX_ATTEMPTS in all); a row at the limit stays in the out file.
 */
export function loadResume(outFile, jobs, stageProv) {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const raw = readLines(outFile);
  const groups = groupRows(raw, outFile);
  const have = new Map(); const dropped = []; const attempts = new Map(); const permanent = [];
  const usable = (r, job) => !isBad(r) && provenanceFieldProblems(r.prov).length === 0 && sourceDifferences(r.prov, stageProv).length === 0 && (!job || jobConfig(job) === jobConfig(r));
  for (const [id, r] of groups) { // originals and foreign rows first, then confirmations of the kept originals
    if (r.confirmOf) continue;
    const job = byId.get(id);
    if (isBad(r)) {
      const n = r.attempt ?? 1;
      attempts.set(id, n);
      if (n >= MAX_ATTEMPTS) { have.set(id, r); permanent.push(id); } else dropped.push({ ...r, supersededBecause: `operational error, attempt ${n}` });
    } else if (!usable(r, job)) dropped.push({ ...r, supersededBecause: job ? 'stale: not the same job or not the same source state' : 'stale source state' });
    else have.set(id, r);
  }
  for (const [id, r] of groups) {
    if (!r.confirmOf) continue;
    const orig = have.get(r.confirmOf);
    const job = byId.get(r.confirmOf);
    if (isBad(r)) { const n = r.attempt ?? 1; attempts.set(id, n); if (orig && n >= MAX_ATTEMPTS) { have.set(id, r); permanent.push(id); } else dropped.push({ ...r, supersededBecause: `operational error, attempt ${n}` }); }
    else if (!orig || !usable(r, job)) dropped.push({ ...r, supersededBecause: orig ? 'stale confirmation' : 'its original is not kept' });
    else have.set(id, r);
  }
  // the same relationship validity agg applies: a reuse or confirmation whose relations are broken is superseded (and its job re-run), never treated as done
  // or seeded into the cache; dropping one can break another (a reuse of a dropped source), so repeat until stable
  for (let again = true; again;) {
    again = false;
    for (const [id, r] of [...have]) {
      const p = relationProblems(r, (x) => (have.has(x) ? [have.get(x)] : []));
      if (p.length) { have.delete(id); dropped.push({ ...r, supersededBecause: `invalid relations: ${p.join('; ')}` }); again = true; }
    }
  }
  const seen = new Set(); // a repeated id (identical, or the file would have been refused) is one record: the extra copies are archived
  for (const r of raw) { if (seen.has(r.id)) dropped.push({ ...r, supersededBecause: 'repeated record' }); seen.add(r.id); }
  if (dropped.length) {
    fs.appendFileSync(`${outFile}.superseded.jsonl`, dropped.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const tmp = `${outFile}.tmp`;
    fs.writeFileSync(tmp, [...have.values()].map((r) => JSON.stringify(r)).join('\n') + (have.size ? '\n' : ''));
    fs.renameSync(tmp, outFile);
  }
  return { have, dropped, attempts, permanent };
}

const seedCache = (cache, have) => {
  for (const r of have.values()) if (r.cacheKey && !r.reuse && !isBad(r)) cache.seed(r.cacheKey, { jobId: r.id, measurement: { done: r.done, timeout: r.timeout, status: r.status, frames: r.frames, phases: r.phases } });
};
const countOf = (rows) => ({ reused: rows.filter((r) => r.reuse).length, executed: rows.filter((r) => !r.reuse && r.timing?.mesenMs > 0).length });

/**
 * Stage A/B/C/R/S runner. Resumable: only valid, same-provenance records are kept (loadResume). It STOPS scheduling the moment a job at
 * the candidate n fails the gate (jobs already running finish); the failing record is preserved and reported. An operational error is
 * recorded (with its attempt count), does not stop the stage, and is retried on resume up to MAX_ATTEMPTS. A changed source state aborts
 * (throws SourceChangedError; the job it hit leaves no record). Duplicate jobs (same measurement key) are reused, one record per planned id.
 * Returns { status: 'ok' | 'candidate-failed' | 'errors', ... }.
 */
export async function runAll(jobsFile, outFile, procs, run = runOne, opts = {}) {
  const provenance = opts.provenance ?? makeProvenance({ mesen: opts.mesen ?? MESEN_DEFAULT });
  const stageProv = provenance(true);
  const jobs = readLines(jobsFile);
  const { have, dropped, attempts, permanent } = loadResume(outFile, jobs, stageProv);
  const res = { status: 'ok', total: jobs.length, kept: have.size, dropped: dropped.length, ran: 0, executed: 0, reused: 0, errors: [], candidateFailures: [...have.values()].filter(isCandidateFailure).map((r) => r.id), permanent };
  const log = opts.log ?? ((m) => console.error(m));
  const cache = opts.cache ?? new MeasurementCache();
  seedCache(cache, have);
  const todo = jobs.filter((j) => !have.has(j.id));
  log(`${jobs.length} jobs, ${have.size} kept, ${dropped.length} superseded, ${todo.length} to run, ${procs} procs`);
  let aborted = null; let stop = res.candidateFailures.length > 0;
  const t0 = Date.now();
  const check = (when, fresh = false) => { try { assertSameSources(stageProv, provenance(fresh), when); return true; } catch (e) { aborted ??= e; return false; } };
  await pool(todo, procs, async (j, _i, deferrals) => {
    if (aborted || stop || !check(`before ${j.id} was scheduled`)) return undefined;
    let r;
    try { r = await run(j, { expect: stageProv, cache, mesen: opts.mesen, waitInflight: deferrals >= 2 }); } catch (e) { if (e instanceof SourceChangedError) { aborted ??= e; return undefined; } throw e; }
    if (r.pending) return DEFER;
    if (!check(`during ${j.id}`)) return undefined;
    const prior = attempts.get(j.id) ?? 0;
    if (prior) r = { ...r, attempt: prior + 1 };
    fs.appendFileSync(outFile, JSON.stringify(r) + '\n');
    have.set(j.id, r); res.ran++;
    if (isBad(r)) res.errors.push(j.id);
    else if (isCandidateFailure(r)) { res.candidateFailures.push(j.id); stop = true; log(`CANDIDATE-N FAILURE: ${j.id} (${jobMax(r)} > ${GATE}); not scheduling further jobs -- stop and report, the bound is lower than expected`); }
    if (res.ran % 200 === 0) log(`  ${res.ran}/${todo.length} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    return undefined;
  }, { stop: () => stop || aborted });
  check('at the end of the stage', true); // a fresh, uncached read of everything, the Mesen binary included
  Object.assign(res, countOf([...have.values()].filter((r) => !isBad(r))));
  if (aborted) throw aborted;
  if (res.candidateFailures.length) res.status = 'candidate-failed';
  else if (res.errors.length || permanent.length) res.status = 'errors';
  log(`${res.status}: ${res.ran} ran, ${res.executed} Mesen sessions in all, ${res.reused} reused, ${res.errors.length} errors${permanent.length ? `, ${permanent.length} permanently failed` : ''}`);
  return res;
}

/**
 * Stage F: each curve in plan order, in waves of `procs`; a failing row of a wave (plan order) is re-run once ALONE (nothing else
 * running, and Mesen always runs: never a reuse), and the curve ends when `confirmationProblems` says the re-run confirms it. A
 * re-run that does not confirm is recorded and the search goes on. Operational errors are reported, not counted as candidates. A curve
 * with no confirmed failure after its candidates is EXHAUSTED: the result's status says so and the CLI exits non-zero.
 * Returns { status: 'confirmed' | 'exhausted' | 'errors', curves: { plain, bound } }.
 */
export async function runF(jobsFile, outFile, procs, run = runOne, opts = {}) {
  const provenance = opts.provenance ?? makeProvenance({ mesen: opts.mesen ?? MESEN_DEFAULT });
  const stageProv = provenance(true);
  const log = opts.log ?? ((m) => console.error(m));
  const jobs = readLines(jobsFile);
  const { have, attempts, permanent } = loadResume(outFile, jobs, stageProv);
  const cache = opts.cache ?? new MeasurementCache();
  seedCache(cache, have);
  let aborted = null;
  const check = (when, fresh = false) => { try { assertSameSources(stageProv, provenance(fresh), when); return true; } catch (e) { aborted ??= e; return false; } };
  const append = (r, id) => {
    const prior = attempts.get(id) ?? 0;
    const row = prior ? { ...r, attempt: prior + 1 } : r;
    fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
    have.set(id, row);
    return row;
  };
  const curves = {};
  for (const curve of CURVES) {
    const mine = jobs.filter((j) => j.curve === curve).sort((a, b) => a.order - b.order);
    const mineIds = new Set(mine.map((j) => j.id));
    const cr = { curve, status: 'exhausted', candidates: 0, errors: [], confirmedBy: null, rejected: [] };
    curves[curve] = cr;
    const prior = [...have.values()].find((r) => r.confirmOf && mineIds.has(r.confirmOf) && confirmationProblems(have.get(r.confirmOf), r).length === 0);
    if (prior) { cr.status = 'confirmed'; cr.confirmedBy = prior.confirmOf; log(`${curve}: already confirmed by ${prior.confirmOf}`); continue; }
    let i = 0;
    while (i < mine.length && cr.status !== 'confirmed' && !aborted) {
      const wave = mine.slice(i, i + procs); i += wave.length;
      const results = new Array(wave.length);
      await pool(wave, procs, async (j, w, deferrals) => {
        if (have.has(j.id)) { results[w] = have.get(j.id); return undefined; }
        if (aborted || !check(`before ${j.id} was scheduled`)) return undefined;
        let r;
        try { r = await run(j, { expect: stageProv, cache, mesen: opts.mesen, waitInflight: deferrals >= 2 }); } catch (e) { if (e instanceof SourceChangedError) { aborted ??= e; return undefined; } throw e; }
        if (r.pending) return DEFER;
        if (!check(`during ${j.id}`)) return undefined;
        results[w] = append(r, j.id);
        return undefined;
      }, { stop: () => aborted });
      if (aborted) break;
      for (let w = 0; w < wave.length && cr.status !== 'confirmed'; w++) {
        const r = results[w]; const j = wave[w];
        if (isBad(r)) { cr.errors.push(j.id); log(`${curve}: ${j.id} is an operational error (${r.error ?? 'bad measurement'}): reported, not a candidate`); continue; }
        cr.candidates++;
        if (!genuineFailure(r)) continue;
        const cid = `${j.id}#confirm`;
        let again = have.get(cid);
        if (!again) {
          const cj = { ...j, id: cid, confirmOf: j.id };
          try { again = await run(cj, { expect: stageProv, cache: null, mesen: opts.mesen, waitInflight: true }); } catch (e) { if (e instanceof SourceChangedError) { aborted = e; break; } throw e; }
          if (!check(`during ${cid}`)) break;
          again = append(again, cid);
        }
        if (isBad(again)) { cr.errors.push(cid); log(`${curve}: ${j.id} fails (${jobMax(r)}); its isolated re-run is an operational error: reported, retried on resume`); continue; }
        const problems = confirmationProblems(r, again);
        log(`${curve}: ${j.id} fails (${jobMax(r)}); isolated re-run ${jobMax(again)} ${problems.length ? `NOT confirmed (${problems.join('; ')})` : 'CONFIRMED'}`);
        if (problems.length) cr.rejected.push({ id: j.id, problems });
        else { cr.status = 'confirmed'; cr.confirmedBy = j.id; }
      }
    }
    if (aborted) break;
    if (cr.status !== 'confirmed') {
      // exhaustion is a MEASUREMENT result (every candidate ran cleanly and none failed); unresolved operational errors mean no clean result at all
      if (cr.errors.length) { cr.status = 'errors'; log(`${curve}: no confirmed failing row, but ${cr.errors.length} operational error(s) over ${cr.candidates} measured candidates: NOT an exhaustion, no clean result (re-run to retry them)`); }
      else log(`${curve}: no confirmed failing row after ${cr.candidates} candidates (EXHAUSTED -- stop and report: the bound may be higher than expected)`);
    }
  }
  check('at the end of the stage', true); // a fresh, uncached read of everything, the Mesen binary included
  if (aborted) throw aborted;
  const errors = Object.values(curves).flatMap((c) => c.errors).concat(permanent);
  // status: `errors` (CLI exit 3) whenever unresolved operational errors prevent a clean result, in any curve; `exhausted` (exit 4) only for a
  // clean exhaustion; the per-curve statuses stay, so a curve that really is exhausted is visible next to one that has errors
  const status = errors.length || Object.values(curves).some((c) => c.status === 'errors') ? 'errors' : (Object.values(curves).some((c) => c.status === 'exhausted') ? 'exhausted' : 'confirmed');
  return { status, curves, errors: [...new Set(errors)], ...countOf([...have.values()].filter((r) => !isBad(r))) };
}

// ---- aggregation -----------------------------------------------------------------------------------------------------------
const scenarioLabel = (s) => (s === 'stress' ? 'stress (SYNTHETIC RAM re-arm, period 7)' : s);
const short = (h) => h.slice(0, 16);
const keyOf = (r) => [r.gt, r.wide ? 'wide' : 'tight', scenarioLabel(r.scenario ?? 'walk'), r.anim ?? 'P0', r.n, r.bound ? 'bound' : 'plain', r.k ?? 0, r.y === null || r.y === undefined ? 'free' : r.y, r.tag ?? ''].join('|');

/** The provenance problems of a list of job records (agg refuses on any). */
export function jobProvenanceProblems(rows) {
  const good = rows.filter((r) => !r.error);
  return provenanceUniformityProblems(good.map((r) => r.prov), (i) => good[i].id);
}

/**
 * Validate EVERY input record, before any deduplication, and return the one-record-per-id list. Refuses (throws) on: a record with no id;
 * repeated ids that disagree on configuration, provenance, project, ROM or measurements; a confirmation whose original is absent; a reuse
 * record whose source is absent, is itself a reuse, or differs in key, project, ROM or measurement.
 */
export function validateRows(all, label = 'the input records') {
  for (const r of all) if (typeof r?.id !== 'string' || !r.id) throw new Error(`REFUSED: a record in ${label} has no id`);
  // EVERY raw record's relationships are checked against the whole input set BEFORE ids are collapsed: an invalid second copy behind a good
  // first copy is refused. (A direct measurement in one stage and a valid reuse of it in another stays legal: `reuse`/`confirmOf` are not part of
  // the equality signature, the relationship check is what covers them.)
  const raw = new Map();
  for (const r of all) { if (!raw.has(r.id)) raw.set(r.id, []); raw.get(r.id).push(r); }
  const rowsOf = (id) => raw.get(id) ?? [];
  const problems = all.flatMap((r) => relationProblems(r, rowsOf));
  if (problems.length) throw new Error(`REFUSED: ${problems.length} invalid record(s):\n  ${problems.slice(0, 12).join('\n  ')}`);
  return [...groupRows(all, label).values()]; // throws on conflicting duplicates; ids unique after this
}
const readOut = (files) => validateRows(files.flatMap((f) => readLines(f)), files.join(', '));
const readOutLenient = (files) => { const seen = new Set(); return files.flatMap((f) => readLines(f)).filter((r) => !seen.has(r.id) && seen.add(r.id)); };

export function aggregate(rows) {
  let bad = 0; const g = new Map();
  const confirms = new Map(rows.filter((r) => r.confirmOf).map((r) => [r.confirmOf, r]));
  for (const r of rows.filter((x) => !x.confirmOf)) {
    if (isBad(r)) { bad++; continue; }
    const key = keyOf(r);
    let o = g.get(key);
    if (!o) {
      o = { gt: r.gt, art: r.wide ? 'wide' : 'tight', scenario: scenarioLabel(r.scenario ?? 'walk'), anim: r.anim ?? 'P0', n: r.n, bound: !!r.bound, k: r.k ?? 0, y: r.y ?? null, tag: r.tag ?? '', jobs: 0, gateFail: 0, confirmed: 0, maxG: 0, shapes: new Set(), keys: new Set(), assignments: new Set(), idles: new Set(), pairs: [], worst: null, firstFail: null };
      g.set(key, o);
    }
    o.jobs++; o.shapes.add(r.shape ?? 'part'); o.keys.add(partitionKey(r.sizes)); o.assignments.add(r.sizes.join(',')); o.idles.add(r.idle ?? 0);
    o.pairs.push(`${r.prov.project}:${r.prov.rom}`);
    const m = jobMax(r);
    const spec = { id: r.id, sizes: r.sizes.join(','), y: r.y ?? null, idle: r.idle ?? 0, maxG: m };
    if (m > o.maxG) { o.maxG = m; o.worst = spec; }
    if (jobFails(r) > 0) {
      o.gateFail++; if (!o.firstFail) o.firstFail = spec;
      if (confirmationProblems(r, confirms.get(r.id)).length === 0) o.confirmed++;
    }
  }
  const out = [...g.values()].map((o) => ({
    gt: o.gt, art: o.art, scenario: o.scenario, anim: o.anim, n: o.n, bound: o.bound, k: o.k, y: o.y, tag: o.tag, jobs: o.jobs, gateFail: o.gateFail, confirmed: o.confirmed, maxG: o.maxG,
    shapes: [...o.shapes].sort(), partitions: { distinct: o.keys.size, digest: partitionDigest([...o.keys]) }, assignments: o.assignments.size,
    idles: [...o.idles].sort((a, b) => a - b), worst: o.worst, firstFail: o.firstFail, jobSet: crypto.createHash('sha256').update(o.pairs.sort().join('|')).digest('hex').slice(0, 16)
  }));
  out.sort((a, b) => keyOf({ ...a, wide: a.art === 'wide' }).localeCompare(keyOf({ ...b, wide: b.art === 'wide' })));
  return { bad, rows: out };
}

export const SAMPLING = [
  'EXHAUSTIVE (the design of Chris\'s 2026-09-30 ruling): at the candidate n of each curve (plain 16, bound tiles 15), action: presets P1-P8 x both arts x shapes even/front/back/scatter x k {0,4,7,8} x (the 12 Flash y values + Flash-free; k=8 is Flash-free only); and the full unordered-partition set of that n on presets P1/P2/P6/P8 x both arts x k=0 x y 225 and 234.',
  'EVIDENCE: at the next n of each curve (plain 17, bound tiles 16), at least one failing row found by the stage F search and CONFIRMED by an isolated re-run.',
  'NAMED rows at the candidate n: the R3-F1 scenes (turn, control, reset, eight chasers), review 2 (Flash x 241, placement (174,203), sizes [1,3,1,3,1,3,1,3] at k=5), the dense Flash y band 186-238 on P6/P8 wide k=7 even/front, and a placement grid (plain curve only).',
  'SAMPLED, NOT COVERED: every n other than the four above; the partitions of presets P3/P4/P5/P7 and of y values other than 225/234 (those presets and y are covered by the Q1c-grid shapes only); odd k (1,3,5) on a sample (P6/P8 wide, even/front, y 212/216/225); the placement grid on the plain curve only; Flash x other than 241/242; animation durations and frame counts outside P0-P8; RPG beyond the n=16 spot checks (P0/P1/P5/P7/P8 x both arts x k {0,7} x 25 partitions incl. uneven ones, y 234); the bound-tile cell/switch values (one bound tile: row 0, col 0, switch 0, metatile 2).'
];

export const buildRecord = (files, opts = {}) => buildRecordFromRows(readOut(files), opts);

/**
 * The record from validated job records. REFUSES unless the records share one provenance AND that provenance is the source state of the files
 * as they are NOW: engine, harness, generator and the Mesen binary, each read fresh (`opts.current`, a { engine, harness, generator, mesen }, is for tests).
 */
export function buildRecordFromRows(all, opts = {}) {
  const problems = jobProvenanceProblems(all);
  if (problems.length) throw new Error(`REFUSED: the records do not share one provenance:\n  ${problems.slice(0, 12).join('\n  ')}`);
  const { bad, rows } = aggregate(all);
  const good = all.filter((r) => !isBad(r) && !r.confirmOf);
  const first = good[0]?.prov;
  if (!first) throw new Error('REFUSED: no measured job');
  let current = opts.current;
  if (!current) { try { current = makeProvenance({ mesen: opts.mesen ?? MESEN_DEFAULT })(true); } catch (e) { throw new Error(`REFUSED: cannot read the current sources to compare with the records: ${e.message}`); } }
  const stale = UNIFORM_FIELDS.filter((f) => first[f] !== current[f]);
  if (stale.length) throw new Error(`REFUSED: the jobs were measured on other sources than the files now: ${stale.map((f) => `${f} ${first[f].slice(0, 12)} (recorded) != ${current[f].slice(0, 12)} (now)`).join(', ')}`);
  const eng = engineFingerprint(REPO);
  if (eng.sha256 !== first.engine) throw new Error(`REFUSED: the jobs were measured on engine ${first.engine.slice(0, 12)} but the engine now is ${eng.sha256.slice(0, 12)}`);
  const prov = { engine: first.engine, harness: first.harness, generator: first.generator, mesen: first.mesen };
  const stamp = Object.fromEntries(Object.entries(prov).map(([k, v]) => [k, short(v)]));
  return {
    version: 3,
    evidenceFor: 'ONE engine: the fingerprint below (engine/*.asm with comments stripped). A change that moves the cycles of a streamed body invalidates every figure here; re-run test/lua/sw_bound_sweep.mjs (stages A, B, C, F, R, then agg --write) and re-derive shared/streambound.js.',
    engine: eng,
    provenance: prov,
    gate: GATE,
    unit: 'cycles per frame, Mesen full-system (mainline + coincident interrupt)',
    design: { candidate: CANDIDATE, evidence: EVIDENCE_N, rule: 'ship the largest passing n minus one, separately per curve: everything passes at the candidate n, and a confirmed failing row exists at the next n' },
    sampling: SAMPLING,
    partitionRule: `unordered partitions of n into at most ${ACTORS} parts of 1..${MAX_PART}; a row is one game type x art x scenario x preset x n x curve x k x touch-Flash y x tag, and its partitions.digest is sha256 of its sorted distinct partition keys`,
    named: Object.fromEntries(Object.entries(NAMED).map(([t, d]) => [t, { anim: d.anim ?? null, wide: d.wide ?? null, y: d.y ?? null, k: d.k ?? null, pos: d.pos ?? null, flashX: d.flashX ?? null, geom: d.geom ?? null, turn: d.turn ?? null }])),
    animPresets: ANIM_PRESETS,
    jobs: all.filter((r) => !r.confirmOf).length, reused: all.filter((r) => r.reuse).length, confirms: all.filter((r) => r.confirmOf).length, bad,
    rows: rows.map((r) => ({ ...r, provenance: { ...stamp, set: r.jobSet } })).map(({ jobSet, ...r }) => r)
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, ...rest] = process.argv.slice(2).filter((s) => !s.startsWith('--'));
  if (cmd === 'plan') { for (const j of plan(rest[0])) console.log(JSON.stringify(j)); }
  else if (cmd === 'run' || cmd === 'runF') {
    // exit codes: 0 clean; 1 a candidate-n job failed the gate (stage run); 3 operational errors; 4 a curve is exhausted (stage F); 5 the sources changed under the stage
    const EXIT = { ok: 0, confirmed: 0, 'candidate-failed': 1, errors: 3, exhausted: 4 };
    try {
      const res = await (cmd === 'run' ? runAll : runF)(rest[0], rest[1], Math.min(20, Number(arg('procs', 20))), runOne, arg('mesen', null) ? { mesen: arg('mesen') } : {});
      console.error(JSON.stringify({ status: res.status, ...(res.curves ? { curves: res.curves } : { candidateFailures: res.candidateFailures, errors: res.errors, permanent: res.permanent }), executed: res.executed, reused: res.reused }));
      process.exitCode = EXIT[res.status] ?? 1;
    } catch (e) {
      console.error(String(e.message ?? e));
      process.exitCode = e instanceof SourceChangedError ? 5 : 1;
    }
  }
  else if (cmd === 'agg') {
    const rec = buildRecord(rest, arg('mesen', null) ? { mesen: arg('mesen') } : {});
    console.log(rec.jobs, 'jobs', rec.confirms, 'confirm re-runs', rec.bad, 'bad', rec.rows.length, 'rows');
    if (process.argv.includes('--write')) { fs.writeFileSync(OUT_FIXTURE, JSON.stringify({ ...rec, rows: undefined }, null, 1).replace(/\n\}\s*$/, ',\n "rows": [\n' + rec.rows.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n ]\n}\n')); console.log('wrote', OUT_FIXTURE); }
  } else if (cmd === 'table') {
    // the worst row per curve x n x preset x art, from the checked-in fixture
    const rec = JSON.parse(fs.readFileSync(OUT_FIXTURE, 'utf8'));
    for (const gt of ['action', 'rpg']) for (const bound of [false, true]) {
      const ns = [...new Set(rec.rows.filter((r) => r.gt === gt && !!r.bound === bound).map((r) => r.n))].sort((a, b) => a - b);
      for (const n of ns) {
        console.log(`${gt} ${bound ? 'bound' : 'plain'} n=${n}`);
        for (const art of ['tight', 'wide']) {
          const cells = Object.keys(rec.animPresets).map((p) => {
            const rs = rec.rows.filter((r) => r.gt === gt && !!r.bound === bound && r.n === n && r.art === art && r.anim === p && r.scenario === 'walk');
            return rs.length ? `${p} ${Math.max(...rs.map((r) => r.maxG))}${rs.some((r) => r.gateFail) ? '!' + rs.reduce((a, r) => a + r.gateFail, 0) : ''}` : `${p} -`;
          });
          console.log(`  ${art.padEnd(5)} ${cells.join('  ')}`);
        }
      }
    }
  } else if (cmd === 'worst') {
    const k = Number(arg('k', 20)); const ns = arg('n', null) ? list(arg('n')).map(Number) : null;
    const gt = arg('gt', 'action');
    const all = readOutLenient(rest).filter((r) => !isBad(r) && !r.confirmOf && r.gt === gt && (!ns || ns.includes(r.n)) && (r.scenario ?? 'walk') === 'walk');
    all.sort((a, b) => jobMax(b) - jobMax(a));
    for (const r of all.slice(0, k)) console.log(JSON.stringify({ id: r.id, gt: r.gt, n: r.n, bound: !!r.bound, maxG: jobMax(r) }));
  } else { console.error('usage: plan|run|runF|agg|table|worst'); process.exit(2); }
}
