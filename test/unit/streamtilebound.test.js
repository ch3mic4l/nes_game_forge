// Phase 3a slice S1 (plan section 5.5, fix round 1 F1): STREAM_TILE_BOUND and STREAM_TILE_BOUND_WITH_BOUND_TILES are the gate's OUTPUT. The Mesen sweep it
// was derived from is recorded in test/fixtures/streambound-curve.json; this test recomputes the bound from that
// record, so the constant and the evidence cannot drift apart, and checks that the record COVERS the axes the
// bound claims to hold over. It does not re-run Mesen (test/lua/sw_bound_sweep.mjs does).
//
// THE RECORD IS EVIDENCE FOR ONE ENGINE. It stores a fingerprint of engine/*.asm (comments and whitespace stripped)
// and this test fails when the engine no longer matches it: any change that moves the cycles of a streamed body
// (draw_entities, entity_animate, the strip arms, the NMI) can move the curve, and the bound with it. The remedy
// is to re-run the sweep (stages A, B, C, R, F in test/lua/sw_bound_sweep.mjs, then `agg --write`), not to edit the
// fingerprint.
//
// Wrong implementations caught: a hand-picked constant; one bound where the curves differ (plain and bound tiles); a
// shipped figure that is not one below the certified n (the margin policy); a margin in cycles that is not the record's;
// a record whose pass/fail flags disagree with the gate; a
// record measured on another engine; a boundary row that
// sampled a few partitions instead of all of them; a record missing an animation axis, a Flash position, a game type
// or an art shape at the boundary. Coverage is checked PER COMBINATION (game type x n x art x Flash y x preset), not
// pooled over a bucket: coverageProblems fails when ANY single combination row is removed or its partition provenance
// damaged, and on the two holes the round-2 recheck found (every animated wide-art boundary row; y = 234 on every
// wide-art boundary row).
//
// WHAT THE PRESETS ARE. P0..P8 are SAMPLED timing coverage of what the editor admits (up to 32 frames per animation,
// durations 1..255, non-looping animations -- shared/project.js), not the admitted domain: they use 1-4 frames,
// durations 1/2/8 and loops. The record supports the bound over those workloads; a claim over the larger domain
// needs reasoning (shared/streambound.js), and is not a measurement.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STREAM_TILE_BOUND, STREAM_TILE_BOUND_WITH_BOUND_TILES, STREAM_TILE_CERTIFIED, STREAM_TILE_MARGIN, STREAM_TILE_MARGIN_CYCLES } from '../../shared/streambound.js';
import { STREAM_TILE_BOUND as REEXPORT, STREAM_TILE_BOUND_WITH_BOUND_TILES as REEXPORT_BT } from '../../shared/streamlayout.js';
import { engineFingerprint } from '../lib/enginefingerprint.js';
import { checkCertificates, validateCertificate, liveSources, curveEvidenceVerdict, CERT_DIR_REL } from '../lua/sw_identity_cert.mjs';
import os from 'node:os';
import { partitions, partitionKey, partitionDigest, ANIM_PRESETS, CANDIDATE, EVIDENCE_N, plan, stageF, knownFailing, runF, buildRecordFromRows, jobProvenanceProblems, mkJob, validateRows } from '../lua/sw_bound_sweep.mjs';
import { provenanceFieldProblems, provenanceUniformityProblems, PROVENANCE_FIELDS } from '../lua/sw_provenance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const curve = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/streambound-curve.json'), 'utf8'));
const GATE = 29780; // plan section 5.1: the action frame (mainline + coincident interrupt), Mesen

// What the record certifies, per curve (plain: no bound tile; bound: a bound tile in the project). The certified n is the one BELOW
// the first n at which a row of the curve fails the gate -- not "the largest passing n": a bound must hold for every n at or under
// it -- provided nothing at or below it fails. The margin is the tightest passing action row at the certified n, in cycles.
function certify(rows, boundCurve) {
  const mine = rows.filter((r) => !!r.bound === boundCurve && r.scenario === 'walk');
  const failing = mine.filter((r) => r.gateFail > 0).map((r) => r.n);
  assert.ok(failing.length > 0, 'the curve has a failing row: the sweep found its end');
  const firstFail = Math.min(...failing);
  const certified = firstFail - 1;
  const at = mine.filter((r) => r.n === certified && r.gt === 'action');
  return { firstFail, certified, below: mine.filter((r) => r.n <= certified), at, marginCycles: GATE - Math.max(...at.map((r) => r.maxG)) };
}

// The animation parameters a preset stands for, from the record itself (curve.animPresets).
const perSlot = (v, i, d) => (Array.isArray(v) ? v[i] : (v ?? d));
function animFacts(preset) {
  if (!preset) return { frames: [1], durations: [8], outOfPhase: false, alt: false, animated: false, varies: false };
  const frames = [...new Set(Array.from({ length: 8 }, (_, i) => perSlot(preset.frames, i, 1)))];
  const durOf = (i) => { const d = perSlot(preset.dur, i, 8); return Array.isArray(d) ? d : [d]; };
  const durations = [...new Set(Array.from({ length: 8 }, (_, i) => durOf(i)).flat())];
  const vec = (i) => JSON.stringify([perSlot(preset.frames, i, 1), perSlot(preset.dur, i, 8)]);
  const outOfPhase = new Set(Array.from({ length: 8 }, (_, i) => vec(i))).size > 1;
  // durations that differ from frame to frame WITHIN one actor's animation (not merely from actor to actor)
  const varies = Array.from({ length: 8 }, (_, i) => new Set(durOf(i)).size > 1).some(Boolean);
  return { frames, durations, outOfPhase, alt: !!preset.alt, animated: frames.some((f) => f > 1), varies };
}

// WHAT THE RECORD MUST HOLD (Chris's ruling of 2026-09-30, the margin policy: ship the largest passing n minus one, separately
// for the plain curve and the bound-tile curve). A curve is decided by TWO facts, and this requires exactly those two:
//   (1) everything passes at the candidate n (plain 16, bound tiles 15), and the sweep is EXHAUSTIVE there over the axes below;
//   (2) at the next n (plain 17, bound tiles 16) there is at least one failing row that an isolated re-run CONFIRMED.
// Every other n is sampled, and says so (curve.sampling). The axis lists are written HERE, not read from the record or from the
// sweep: a record that stops listing a value must fail, not shrink the requirement. (CAND/EVID are cross-checked against the
// sweep's own constants below, so the two cannot drift apart silently.)
const CAND = { plain: 16, bound: 15 };
const EVID = { plain: 17, bound: 16 };
const CURVES = ['plain', 'bound'];
const ARTS = ['tight', 'wide'];
const PRESETS_B = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];
const PRESETS_C = ['P1', 'P2', 'P6', 'P8'];
const KS_B = [0, 4, 7, 8];
const SHAPES_B = ['even', 'front', 'back', 'scatter'];
const Y12 = [193, 194, 202, 209, 210, 212, 214, 216, 218, 225, 226, 234]; // the selected 12-y set of the Q1c grid
const YS_C = [225, 234];
const DENSE_Y = Array.from({ length: 53 }, (_, i) => 186 + i); // 186..238
const RPG_PRESETS = ['P0', 'P1', 'P5', 'P7', 'P8'];
const RPG_KS = [0, 7];
const R3_TAGS = ['r3turn', 'r3ctl', 'r3reset'];
const REVIEW2 = [['flashx241', 7], ['pos174_203', 7], ['k5alt', 5]];
const POS_TAGS = [[175, 184], [175, 191], [175, 192], [175, 198], [175, 199], [175, 201], [175, 202], [175, 207], [175, 208], [175, 215], [175, 216], [160, 200], [167, 200], [168, 200], [176, 200], [183, 200], [184, 200], [191, 200]].map((p) => `pos${p[0]}_${p[1]}`);
const keyOf = (c, r) => [r.gt, r.art, r.anim, r.n, c, r.k, r.y === null ? 'free' : r.y, r.tag].join('|');
const need = (gt, art, anim, n, c, k, y, tag = '') => keyOf(c, { gt, art, anim, n, k, y, tag });

/** Every required EXHAUSTIVE row at the candidate n: { key, want: { shapes?, partitions?, jobs? } } -- one entry per combination. */
export function requiredRows() {
  const out = new Map();
  const add = (key, want) => { const o = out.get(key) ?? { shapes: new Set(), full: false, minJobs: 1, minDistinct: 0 }; for (const sh of want.shapes ?? []) o.shapes.add(sh); if (want.full) o.full = true; o.minJobs = Math.max(o.minJobs, want.minJobs ?? 1); o.minDistinct = Math.max(o.minDistinct, want.minDistinct ?? 0); out.set(key, o); };
  for (const c of CURVES) {
    const n = CAND[c];
    // B: the Q1c grid
    for (const anim of PRESETS_B) for (const art of ARTS) for (const k of KS_B) {
      add(need('action', art, anim, n, c, k, null), { shapes: SHAPES_B });
      if (k !== 8) for (const y of Y12) add(need('action', art, anim, n, c, k, y), { shapes: SHAPES_B });
    }
    // C: the full unordered-partition set at k = 0, y 225 and 234, four presets, both arts
    for (const anim of PRESETS_C) for (const art of ARTS) for (const y of YS_C) add(need('action', art, anim, n, c, 0, y), { shapes: ['part'], full: true });
    // A: the named rows
    for (const tag of R3_TAGS) add(need('action', 'wide', 'P2', n, c, 7, 234, tag), {});
    for (const [tag, k] of REVIEW2) for (const anim of ['P6', 'P8']) for (const y of [212, 216, 225, 234]) add(need('action', 'wide', anim, n, c, k, y, tag), {});
    for (const anim of ['P6', 'P8']) for (const y of DENSE_Y) add(need('action', 'wide', anim, n, c, 7, y), { shapes: ['even', 'front'] });
    for (const anim of ['P6', 'P8']) for (const k of [1, 3, 5]) for (const y of [212, 216, 225]) add(need('action', 'wide', anim, n, c, k, y), { shapes: ['even', 'front'] });
  }
  for (const tag of POS_TAGS) for (const anim of ['P6', 'P8']) for (const y of [212, 216, 218]) add(need('action', 'wide', anim, CAND.plain, 'plain', 7, y, tag), {});
  // R: the RPG spot checks at n = 16 (plain): sampled partitions including the uneven shapes
  for (const anim of RPG_PRESETS) for (const art of ARTS) for (const k of RPG_KS) add(need('rpg', art, anim, 16, 'plain', k, 234), { shapes: ['front', 'back', 'scatter', 'part'], minJobs: 25, minDistinct: 20 });
  return out;
}

const HEX16 = /^[0-9a-f]{16}$/;
/** Problems with a record's provenance: complete, uniform, and the engine one the fingerprint says. */
export function provenanceProblems(rec) {
  const problems = [];
  const top = rec.provenance;
  for (const f of ['engine', 'harness', 'generator', 'mesen']) if (!/^[0-9a-f]{64}$/.test(top?.[f] ?? '')) problems.push(`record: provenance.${f} is missing or not a sha-256`);
  if (top && rec.engine && rec.engine.sha256 !== top.engine) problems.push('record: provenance.engine is not the engine fingerprint');
  if (!top) return problems;
  rec.rows.forEach((r, i) => {
    const p = r.provenance;
    if (!p || typeof p !== 'object') { problems.push(`row ${i} (${r.gt}/${r.art}/${r.anim}/n${r.n}): no provenance`); return; }
    for (const f of [...PROVENANCE_FIELDS.filter((x) => x !== 'project' && x !== 'rom'), 'set']) {
      if (!HEX16.test(p[f] ?? '')) problems.push(`row ${i}: provenance.${f} missing or not a 16-hex stamp`);
      else if (f !== 'set' && p[f] !== (top[f] ?? '').slice(0, 16)) problems.push(`row ${i}: provenance.${f} differs from the record's (mixed provenance)`);
    }
  });
  return problems;
}

/** What the record must contain: every problem found, one per missing or malformed requirement. */
export function coverageProblems(rec) {
  const problems = [];
  const rows = rec.rows.filter((r) => r.scenario === 'walk');
  const byKey = new Map();
  for (const r of rows) { const k = keyOf(r.bound ? 'bound' : 'plain', r); byKey.set(k, [...(byKey.get(k) ?? []), r]); }
  const fullDigest = {};
  for (const [key, want] of requiredRows()) {
    const found = byKey.get(key) ?? [];
    if (found.length === 0) { problems.push(`${key}: missing`); continue; }
    if (found.length > 1) { problems.push(`${key}: ${found.length} rows`); continue; }
    const r = found[0];
    if (r.jobs < want.minJobs) problems.push(`${key}: ${r.jobs} jobs, wanted ${want.minJobs}`);
    for (const sh of want.shapes) if (!(r.shapes ?? []).includes(sh)) problems.push(`${key}: no ${sh} job`);
    if (r.partitions.distinct < want.minDistinct) problems.push(`${key}: ${r.partitions.distinct} distinct partitions, wanted ${want.minDistinct}`);
    if (want.full) {
      const n = r.n;
      const all = partitions(n);
      fullDigest[n] ??= partitionDigest(all.map((p) => partitionKey(p)));
      if (r.partitions.distinct !== all.length || r.partitions.digest !== fullDigest[n]) problems.push(`${key}: ${r.partitions.distinct} of ${all.length} partitions (digest ${r.partitions.digest})`);
    }
    if (r.gateFail !== 0 || r.maxG > GATE) problems.push(`${key}: FAILS at the candidate n (maxG ${r.maxG}); stop and report, do not widen`);
  }
  // everything at or below the candidate n of a curve passes, whatever else is in the record
  for (const r of rows) {
    const c = r.bound ? 'bound' : 'plain';
    if (r.n <= CAND[c] && (r.gateFail > 0 || r.maxG > GATE)) problems.push(`row ${keyOf(c, r)} fails at or below the candidate n`);
  }
  // the evidence at the next n: a failing row, confirmed by an isolated re-run
  for (const c of CURVES) {
    const ev = rows.filter((r) => r.gt === 'action' && !!r.bound === (c === 'bound') && r.n === EVID[c] && r.gateFail > 0 && r.confirmed > 0 && r.maxG > GATE);
    if (ev.length === 0) problems.push(`${c}: no confirmed failing row at n=${EVID[c]}`);
  }
  for (const r of rec.rows) if (!(r.anim in rec.animPresets)) problems.push(`row ${keyOf(r.bound ? 'bound' : 'plain', r)} names an unknown preset`);
  // the animation facts the claim rests on, from the record's own definitions of the presets it names
  const facts = [...new Set([...PRESETS_B, ...RPG_PRESETS])].map((p) => animFacts(rec.animPresets[p]));
  const frameCounts = new Set(facts.flatMap((f) => f.frames));
  const durations = new Set(facts.flatMap((f) => f.durations));
  if (!facts.some((f) => f.animated)) problems.push('no animated preset');
  if (![...frameCounts].some((c) => c >= 3)) problems.push(`no animation with 3+ frames (frame counts ${[...frameCounts]})`);
  if (!durations.has(1)) problems.push('no per-frame duration of 1');
  if (![...durations].some((d) => d > 1)) problems.push('no duration above 1');
  if (!facts.some((f) => f.outOfPhase)) problems.push('no phase offset between actors');
  if (!facts.some((f) => f.alt)) problems.push('no metasprite-changing (alt) frames');
  if (!facts.some((f) => f.varies)) problems.push('no duration that varies from frame to frame within one animation');
  return problems;
}

test('the record was measured on THIS engine and generator, or a valid ROM-identity certificate carries it to them (a change to engine/*.asm or main/build/ alone otherwise invalidates the evidence)', () => {
  const now = engineFingerprint(ROOT);
  assert.ok(curve.engine && curve.engine.sha256, 'the record carries an engine fingerprint');
  assert.match(curve.evidenceFor, /ONE engine/);
  // Never stops checking: an exact match of BOTH recorded fingerprints (engine and generator), or a certificate of test/lua/sw_identity_cert.mjs that pins this
  // very curve and these very current fingerprints (every recorded ROM rebuilt byte-identical, bindings unchanged). Review 2 finding 2: the exact branch
  // used to look at the engine alone and so accepted the original engine with an arbitrarily changed generator.
  const live = liveSources(ROOT);
  assert.equal(live.engine, now.sha256);
  const curveBytes = fs.readFileSync(path.join(ROOT, 'test/fixtures/streambound-curve.json'));
  const verdicts = checkCertificates(path.join(ROOT, CERT_DIR_REL), { curve, curveBytes, live });
  const verdict = curveEvidenceVerdict({ curve, live, verdicts });
  assert.ok(verdict.ok,
    `${verdict.why.join(' and ')}, and no valid ROM-identity certificate covers the current engine and generator. ` +
    (verdicts.length ? `Certificates present: ${verdicts.map((v) => `${v.file}: ${v.problems.join('; ')}`).join(' | ')}. ` : `None under ${CERT_DIR_REL}. `) +
    'Run `node test/lua/sw_identity_cert.mjs --out=' + CERT_DIR_REL + '/<name>.json` (about 90 s, no Mesen: it rebuilds every recorded job and writes the certificate only if every ROM is identical), ' +
    'or re-run test/lua/sw_bound_sweep.mjs (stages A, B, C, R, F; then `agg --write`) and re-derive shared/streambound.js.');
});

test('the certificate consumer is not vacuous: a missing directory certifies nothing, a certificate-shaped object the certifier did not seal is rejected, and a changed generator alone is not an exact match', () => {
  const curveBytes = fs.readFileSync(path.join(ROOT, 'test/fixtures/streambound-curve.json'));
  const live = liveSources(ROOT);
  assert.deepEqual(checkCertificates(path.join(os.tmpdir(), 'no-such-certificate-dir'), { curve, curveBytes, live }), []);
  assert.ok(validateCertificate({ kind: 'rom-identity-certificate', version: 1, selfDigest: 'x' }, { curve, curveBytes, live }).length > 0);
  // the engine the sweep ran on with a generator it did not: only a certificate may carry that, and there is none for these made-up sources
  const sources = { engine: curve.engine.sha256, generator: '0'.repeat(64), harness: live.harness };
  assert.equal(curveEvidenceVerdict({ curve, live: sources, verdicts: checkCertificates(path.join(ROOT, CERT_DIR_REL), { curve, curveBytes, live: sources }) }).ok, false);
});

test('the record states the gate and was a clean sweep (no timeouts, no crashed jobs)', () => {
  assert.equal(curve.gate, GATE);
  assert.equal(curve.bad, 0);
  // version 2 is the pre-(a1) record; version 3 is the (a1) re-sweep of Chris's 2026-09-30 design (stages A B C F R)
  assert.ok(curve.version === 2 || curve.version === 3, `unknown record version ${curve.version}`);
  assert.ok(curve.jobs >= (curve.version === 3 ? 11000 : 9000), `expected the full sweep, got ${curve.jobs} jobs`);
  assert.equal(curve.jobs, curve.rows.reduce((a, r) => a + r.jobs, 0), 'every job is accounted for in exactly one row');
});

test('every row flag agrees with the gate: gateFail only where maxG exceeds it (and at least one failing job)', () => {
  for (const r of curve.rows) {
    if (r.gateFail === 0) assert.ok(r.maxG <= GATE, `${r.gt}/${r.art}/${r.scenario}/${r.anim}/n${r.n}: passes but maxG ${r.maxG} > gate`);
    else assert.ok(r.maxG > GATE, `${r.gt}/${r.art}/${r.scenario}/${r.anim}/n${r.n}: fails but maxG ${r.maxG} <= gate`);
  }
});

test('the certified n of each curve is recomputed from the rows; the shipped bounds are one below it (the margin policy)', () => {
  const plain = certify(curve.rows, false);
  const bound = certify(curve.rows, true);
  assert.deepEqual({ ...STREAM_TILE_CERTIFIED }, { plain: plain.certified, boundTiles: bound.certified }, JSON.stringify({ plain: plain.firstFail, bound: bound.firstFail }));
  assert.equal(STREAM_TILE_MARGIN, 1);
  assert.equal(STREAM_TILE_BOUND, plain.certified - 1);
  assert.equal(STREAM_TILE_BOUND_WITH_BOUND_TILES, bound.certified - 1);
  assert.equal(REEXPORT, STREAM_TILE_BOUND, 'shared/streamlayout.js re-exports the one definition');
  assert.equal(REEXPORT_BT, STREAM_TILE_BOUND_WITH_BOUND_TILES);
  assert.ok(STREAM_TILE_BOUND_WITH_BOUND_TILES < STREAM_TILE_BOUND, 'bound tiles make the frame dearer, so their figure is the lower one');
  // Q1 (plan 5.6): the confirmed largest shipped streamed population is 16 tiles, which the plain curve certifies and ships one below.
  assert.ok(plain.certified >= 16);
});

test('the recorded margins in cycles are the record\'s tightest passing action row at each certified n', () => {
  const plain = certify(curve.rows, false);
  const bound = certify(curve.rows, true);
  assert.deepEqual({ ...STREAM_TILE_MARGIN_CYCLES }, { plain: plain.marginCycles, boundTiles: bound.marginCycles });
  assert.ok(plain.marginCycles > 0 && bound.marginCycles > 0, 'every row at the certified n passes');
  assert.ok(bound.marginCycles < plain.marginCycles, 'bound tiles spend the margin, which is why their certified n is lower');
});

test('the bounds are not vacuous: the first n above each certified n fails on a CONFIRMED action row, and nothing at or below it fails', () => {
  for (const [name, isBound, certified] of [['plain', false, STREAM_TILE_CERTIFIED.plain], ['bound tiles', true, STREAM_TILE_CERTIFIED.boundTiles]]) {
    const c = certify(curve.rows, isBound);
    assert.equal(c.firstFail, certified + 1, name);
    const ev = curve.rows.filter((r) => !!r.bound === isBound && r.gt === 'action' && r.n === certified + 1 && r.gateFail > 0 && r.confirmed > 0);
    assert.ok(ev.length > 0, `${name}: n=${certified + 1} fails on a confirmed row, or the figure is just the end of the sweep`);
    assert.ok(c.below.every((r) => r.gateFail === 0), `${name}: no row at or below ${certified} fails`);
    assert.ok(c.at.length > 0, `${name}: the certified n was swept`);
  }
});

// ---- a record built from the PLAN itself, with synthetic results: what a conforming sweep looks like ----------------------------------
const sha = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
const NOW = engineFingerprint(ROOT).sha256;
const PROV = { engine: NOW, harness: sha('harness'), generator: sha('generator'), mesen: sha('mesen') };
const fakeResult = (job, over = {}) => ({
  ...job, done: true, timeout: false, status: 0, frames: 643, timing: { buildMs: 50, mesenMs: 3900 },
  prov: { ...PROV, project: sha(`p${job.confirmOf ?? job.id}`), rom: sha(`r${job.confirmOf ?? job.id}`) }, // a confirmation re-runs the same job: same project and ROM
  phases: { walkR: { maxG: 23000 + (parseInt(sha(job.id).slice(0, 4), 16) % 3000), gateFail: 0, n: 260 }, walkD: { maxG: 26000 + (parseInt(sha(job.id).slice(4, 8), 16) % 3000), gateFail: 0, n: 240 } }, ...over
});
const failing = (job) => fakeResult(job, { phases: { walkR: { maxG: 23100, gateFail: 0, n: 260 }, walkD: { maxG: GATE + 1500, gateFail: 1, n: 240 } } });
let conforming = null;
function conformingRows() {
  if (conforming) return conforming;
  const rows = ['A', 'B', 'C', 'R'].flatMap((st) => plan(st)).map((j) => fakeResult(j));
  for (const c of CURVES) {
    const j = stageF(c, [])[0];
    const f = failing(j);
    rows.push(f, { ...fakeResult({ ...j, id: `${j.id}#confirm`, confirmOf: j.id }), phases: f.phases });
  }
  conforming = rows;
  return rows;
}
let conformingRec = null;
const CURRENT = { engine: PROV.engine, harness: PROV.harness, generator: PROV.generator, mesen: PROV.mesen }; // the sources "as they are now" for a synthetic record
const conformingRecord = () => (conformingRec ??= buildRecordFromRows(conformingRows(), { current: CURRENT }));
const clone = (x) => structuredClone(x);
const without = (rec, pred) => ({ ...rec, rows: rec.rows.filter((r) => !pred(r)) });
const curveOf = (r) => (r.bound ? 'bound' : 'plain');

test('the axes the test requires are the sweep\'s own (no silent drift between the requirement and the plan)', () => {
  assert.deepEqual(CAND, CANDIDATE);
  assert.deepEqual(EVID, EVIDENCE_N);
  assert.deepEqual(curve.animPresets, JSON.parse(JSON.stringify(ANIM_PRESETS)), 'the record\'s presets are the harness\'s presets (the rows\' labels mean what the sweep ran)');
});

test('the stage plans have exactly the arithmetic job counts, and every job id is unique', () => {
  // B: per curve 8 presets x 2 arts x 4 shapes x (k 0,4,7: 12 y + Flash-free; k 8: Flash-free only) = 8*2*4*(3*13+1) = 2560
  assert.equal(plan('B').length, 2 * 8 * 2 * 4 * (3 * 13 + 1));
  // C: unordered partitions of 16 (186) and of 15 (146) x 4 presets x 2 arts x 2 y
  assert.equal(plan('C').length, (partitions(16).length + partitions(15).length) * 4 * 2 * 2);
  assert.equal(partitions(16).length, 186); assert.equal(partitions(15).length, 146);
  // R: 5 presets x 2 arts x 2 k x 25 partitions
  assert.equal(plan('R').length, 5 * 2 * 2 * 25);
  // A, per curve: 3 R3-F1 scenes + 3 review-2 tags x 2 presets x 4 y + dense y 2 presets x 2 shapes x 53 + odd k 2 presets x 2 shapes x 3 k x 3 y; plus the plain placement grid 18 x 2 x 3
  assert.equal(plan('A').length, 2 * (3 + 3 * 2 * 4 + 2 * 2 * 53 + 2 * 2 * 3 * 3) + 18 * 2 * 3);
  for (const st of ['A', 'B', 'C', 'R', 'F', 'S']) { const j = plan(st); assert.equal(new Set(j.map((x) => x.id)).size, j.length, `stage ${st} ids are unique`); }
});

test('stage F: at the next n only, at most 500 candidates per curve; n+1 extensions of the worst-margin candidate-n rows first, then the known failing shapes', () => {
  for (const c of CURVES) {
    const f = stageF(c, []);
    assert.ok(f.length <= 500 && f.length > 0);
    assert.ok(f.every((j) => j.n === EVID[c] && j.curve === c && j.bound === (c === 'bound') && j.stage === 'F'));
    assert.deepEqual(f.map((j) => j.order), f.map((_, i) => i), 'a plan order the runner can stop in');
    assert.equal(f.every((j) => (c === 'bound') === (j.gridH === 60)), true, 'the bound-tile curve is the 3x60 grid');
    // the known failing Q1c shapes lead when there are no candidate-n records
    const known = knownFailing(c).map((j) => j.id);
    assert.deepEqual(f.slice(0, known.length).map((j) => j.id), known);
  }
  // with candidate-n records, the extensions come first, ordered by margin (the highest G first), each one tile bigger, config kept
  const base = plan('B').filter((j) => j.stage === 'B' && !j.bound && j.shape !== 'part').slice(0, 40).map((j, i) => fakeResult(j, { phases: { walkD: { maxG: 20000 + i * 100, gateFail: 0, n: 1 } } }));
  const f = stageF('plain', base);
  const worst = base[base.length - 1];
  assert.equal(f[0].n, 17);
  assert.equal(f[0].anim, worst.anim); assert.equal(f[0].k, worst.k); assert.equal(f[0].y, worst.y); assert.equal(f[0].wide, worst.wide);
  assert.equal(f[0].sizes.reduce((a, b) => a + b, 0), worst.sizes.reduce((a, b) => a + b, 0) + 1);
  assert.ok(f.length <= 500);
  // a bound-curve plan never takes plain records as its extensions
  assert.ok(stageF('bound', base).every((j, i) => j.bound && j.n === 16));
  // F4: a stage C (partition) source is ranked and extended like any other: the worst-margin row overall is a partition row, and its n+1 extension leads
  const part = plan('C').find((j) => !j.bound && j.anim === 'P8' && j.wide);
  const withPart = [...base, fakeResult(part, { phases: { walkD: { maxG: 29700, gateFail: 0, n: 1 } } })];
  const g = stageF('plain', withPart);
  const want = part.sizes.slice(); want[want.indexOf(Math.min(...want))]++;
  assert.equal(g[0].shape, 'part', 'the partition source is the worst margin, so its extension is first');
  assert.deepEqual(g[0].sizes, want);
  assert.equal(g[0].anim, 'P8'); assert.equal(g[0].y, part.y); assert.equal(g[0].k, part.k); assert.equal(g[0].wide, part.wide);
  assert.ok(g.some((j) => j.shape !== 'part' && j.id === f[0].id), 'the others are still there');
});

test('runF stops each curve at its first failing row, confirms it by one isolated re-run, and reports a curve with none', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sw-runf-'));
  const quiet = console.error; const log = [];
  console.error = (m) => log.push(String(m));
  try {
    const jobs = [];
    for (const c of CURVES) for (let i = 0; i < 10; i++) jobs.push({ ...mkJob({ stage: 'F', sizes: [3, 2, 2, 2, 2, 2, 2, i % 2 ? 2 : 3], wide: true, anim: `P${1 + (i % 8)}`, y: 200 + i, k: 7, shape: 'even', bound: c === 'bound' }), curve: c, order: i });
    const jf = path.join(dir, 'jobs.jsonl'); fs.writeFileSync(jf, jobs.map((j) => JSON.stringify(j)).join('\n') + '\n');
    const ran = [];
    const failIds = new Set([jobs[5].id, jobs[7].id]); // plain 5 and 7 fail; bound never does
    let aloneCalls = 0;
    const run = async (j) => { ran.push(j.id); if (j.confirmOf) aloneCalls++; return failIds.has(j.confirmOf ?? j.id) ? failing(j) : fakeResult(j); };
    const out = path.join(dir, 'out.jsonl');
    await runF(jf, out, 4, run, { provenance: () => CURRENT });
    const recs = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    // plain: waves of 4 -> wave 1 = orders 0-3 (no failure), wave 2 = 4-7 (5 fails first in plan order): the curve ends there and 8, 9 are never run
    const plainRan = recs.filter((r) => r.curve === 'plain' && !r.confirmOf).map((r) => r.order);
    assert.deepEqual(plainRan.sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
    const confirms = recs.filter((r) => r.confirmOf);
    assert.deepEqual(confirms.map((r) => r.confirmOf), [jobs[5].id], 'the FIRST failing row in plan order was re-run once, alone; row 7 was not');
    assert.equal(aloneCalls, 1);
    // bound: nothing fails, every candidate runs, nothing is confirmed, and the exhaustion is said
    assert.equal(recs.filter((r) => r.curve === 'bound' && !r.confirmOf).length, 10);
    assert.ok(log.some((m) => /bound: no confirmed failing row after 10 candidates \(EXHAUSTED/.test(m)));
    assert.ok(log.some((m) => /plain: .* CONFIRMED/.test(m)));
    // resumable: a second run adds no work, and a confirmed curve is not searched again
    const before = ran.length;
    await runF(jf, out, 4, run, { provenance: () => CURRENT });
    assert.equal(ran.length, before, 'nothing re-run');
    // a failure the isolated re-run does NOT reproduce does not end the search (and is not evidence)
    const out2 = path.join(dir, 'out2.jsonl');
    const flaky = async (j) => (j.confirmOf ? fakeResult(j) : (j.id === jobs[2].id ? failing(j) : fakeResult(j)));
    console.error = (m) => log.push(String(m));
    await runF(jf, out2, 4, flaky, { provenance: () => CURRENT });
    const r2 = fs.readFileSync(out2, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(r2.filter((r) => r.curve === 'plain' && !r.confirmOf).length, 10, 'the search went on past the unconfirmed failure');
    assert.ok(log.some((m) => /NOT confirmed/.test(m)));
  } finally { console.error = quiet; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the plan itself satisfies the requirement: a record built from stages A, B, C, R and a confirmed failing row per curve has no coverage or provenance problem', () => {
  const rec = conformingRecord();
  assert.deepEqual(coverageProblems(rec), []);
  assert.deepEqual(provenanceProblems(rec), []);
  assert.equal(requiredRows().size, 1662, 'per curve 640 grid rows + 3 R3-F1 + 24 review-2 + 82 dense-y (the other 24 of its 106 are grid rows) + 18 odd-k = 767, x 2; + 108 placement-grid rows; + 20 RPG rows');
});

test('DEDUP: a record in which the duplicate jobs of stage B are REUSED measurements (one logical record per planned id, labels intact) satisfies coverage; a reuse that differs in any one component does not validate', () => {
  const rows = conformingRows().map((r) => ({ ...r }));
  const firstOf = new Map(); let reused = 0;
  for (const r of rows) {
    if (r.stage !== 'B') continue;
    const sig = JSON.stringify([r.gt, r.sizes, r.anim, r.wide, r.y, r.k, !!r.bound, r.tag, r.flashX, r.cfg]);
    const src = firstOf.get(sig);
    if (!src) { firstOf.set(sig, r); continue; }
    Object.assign(r, { prov: { ...src.prov }, phases: src.phases, cacheKey: src.cacheKey, reuse: { of: src.id, key: src.cacheKey }, timing: { buildMs: 50, mesenMs: 0 } });
    reused++;
  }
  assert.equal(reused, 640, 'plain n=16: scatter has the same sizes as even, so 640 of stage B\'s 5120 jobs are duplicates of another job');
  const rec = buildRecordFromRows(validateRows(rows), { current: CURRENT });
  assert.deepEqual(coverageProblems(rec), []);
  assert.deepEqual(provenanceProblems(rec), []);
  assert.equal(rec.reused, 640);
  // one component different, and the record is refused rather than counted
  const victim = rows.findIndex((r) => r.reuse);
  for (const [what, f] of [['key', (r) => ({ ...r, cacheKey: sha('x') })], ['project', (r) => ({ ...r, prov: { ...r.prov, project: sha('x') } })], ['ROM', (r) => ({ ...r, prov: { ...r.prov, rom: sha('x') } })], ['measurement', (r) => ({ ...r, phases: { walkD: { maxG: 1, gateFail: 0, n: 240 } } })]]) {
    assert.throws(() => validateRows(rows.map((r, i) => (i === victim ? f(r) : r))), /REFUSED/, `a reuse whose ${what} differs`);
  }
});

test('COVERAGE (the real record) is exactly the design: exhaustive at the candidate n of each curve, and a confirmed failing row at the next n', () => {
  // This fails until the (a1) re-sweep (stages A B C F R, then `agg --write`) has replaced the pre-(a1) record.
  assert.deepEqual(coverageProblems(curve), []);
});

test('PROVENANCE (the real record): every row carries provenance, and it is uniform', () => {
  // This fails until the (a1) re-sweep has replaced the pre-(a1) record.
  assert.deepEqual(provenanceProblems(curve), []);
  assert.equal(curve.version, 3);
});

test('COVERAGE is checked per combination: removing or damaging any single required combination makes coverageProblems fail', () => {
  const rec = conformingRecord();
  const full = requiredRows();
  let n = 0;
  for (const [key, want] of full) {
    const hit = (r) => keyOf(curveOf(r), r) === key && r.scenario === 'walk';
    assert.ok(coverageProblems(without(rec, hit)).length > 0, `${key} removed: coverageProblems must fail`);
    const row = rec.rows.find(hit);
    for (const sh of want.shapes) {
      const damaged = { ...rec, rows: rec.rows.map((r) => (r === row ? { ...r, shapes: r.shapes.filter((x) => x !== sh) } : r)) };
      assert.ok(coverageProblems(damaged).length > 0, `${key} without a ${sh} job: coverageProblems must fail`);
    }
    if (want.full) {
      const sampled = { ...rec, rows: rec.rows.map((r) => (r === row ? { ...r, partitions: { ...r.partitions, distinct: r.partitions.distinct - 1 } } : r)) };
      assert.ok(coverageProblems(sampled).length > 0, `${key} sampled partitions: coverageProblems must fail`);
      const swapped = { ...rec, rows: rec.rows.map((r) => (r === row ? { ...r, partitions: { ...r.partitions, digest: '0'.repeat(16) } } : r)) };
      assert.ok(coverageProblems(swapped).length > 0, `${key} wrong partition digest: coverageProblems must fail`);
    }
    if (want.minJobs > 1) {
      const thin = { ...rec, rows: rec.rows.map((r) => (r === row ? { ...r, jobs: want.minJobs - 1 } : r)) };
      assert.ok(coverageProblems(thin).length > 0, `${key} sampled too thinly: coverageProblems must fail`);
    }
    n++;
  }
  assert.equal(n, 1662);
});

test('COVERAGE: each axis value removed from the candidate n of a curve, and each way of losing the n+1 evidence, makes coverageProblems fail', () => {
  const rec = conformingRecord();
  const cand = (r) => r.n === CAND[curveOf(r)] && r.scenario === 'walk' && r.gt === 'action' && r.tag === '';
  const named = {};
  for (const c of CURVES) {
    const mine = (pred) => (r) => curveOf(r) === c && cand(r) && pred(r);
    for (const p of PRESETS_B) named[`${c}: preset ${p}`] = mine((r) => r.anim === p);
    for (const a of ARTS) named[`${c}: ${a} art`] = mine((r) => r.art === a);
    for (const k of KS_B) named[`${c}: k=${k}`] = mine((r) => r.k === k);
    for (const y of Y12) named[`${c}: y=${y}`] = mine((r) => r.y === y);
    named[`${c}: Flash-free`] = mine((r) => r.y === null);
    for (const y of [186, 200, 212, 238]) named[`${c}: dense y=${y}`] = mine((r) => r.y === y && r.k === 7);
    for (const k of [1, 3, 5]) named[`${c}: odd k=${k}`] = mine((r) => r.k === k);
    for (const t of R3_TAGS) named[`${c}: ${t}`] = (r) => curveOf(r) === c && r.tag === t;
    for (const [t] of REVIEW2) named[`${c}: ${t}`] = (r) => curveOf(r) === c && r.tag === t;
    // the n+1 evidence
    named[`${c}: the n=${EVID[c]} failing rows`] = (r) => curveOf(r) === c && r.n === EVID[c];
  }
  for (const [name, pred] of Object.entries(named)) assert.ok(coverageProblems(without(rec, pred)).length > 0, `${name}: coverageProblems must fail`);
  for (const t of POS_TAGS.slice(0, 3)) assert.ok(coverageProblems(without(rec, (r) => r.tag === t)).length > 0, `placement ${t}`);
  // a shape removed from every row that lists it, one at a time
  for (const sh of SHAPES_B) {
    const d = { ...rec, rows: rec.rows.map((r) => ({ ...r, shapes: r.shapes.filter((x) => x !== sh) })) };
    assert.ok(coverageProblems(d).length > 0, `shape ${sh} removed everywhere`);
  }
  // the RPG spot checks, one axis value at a time
  for (const p of RPG_PRESETS) assert.ok(coverageProblems(without(rec, (r) => r.gt === 'rpg' && r.anim === p)).length > 0, `rpg ${p}`);
  for (const a of ARTS) assert.ok(coverageProblems(without(rec, (r) => r.gt === 'rpg' && r.art === a)).length > 0, `rpg ${a}`);
  for (const k of RPG_KS) assert.ok(coverageProblems(without(rec, (r) => r.gt === 'rpg' && r.k === k)).length > 0, `rpg k${k}`);
  // the evidence row must be a FAILING row, CONFIRMED by an isolated re-run, at the right n, on the action game
  for (const c of CURVES) {
    const ev = (r) => curveOf(r) === c && r.n === EVID[c];
    const mut = (f) => ({ ...rec, rows: rec.rows.map((r) => (ev(r) ? f(r) : r)) });
    assert.ok(coverageProblems(mut((r) => ({ ...r, confirmed: 0 }))).length > 0, `${c}: unconfirmed evidence`);
    assert.ok(coverageProblems(mut((r) => ({ ...r, gateFail: 0, maxG: 25000 }))).length > 0, `${c}: evidence row that passes`);
    assert.ok(coverageProblems(mut((r) => ({ ...r, n: r.n + 1 }))).length > 0, `${c}: evidence at the wrong n`);
    assert.ok(coverageProblems(mut((r) => ({ ...r, gt: 'rpg' }))).length > 0, `${c}: evidence on the wrong game type`);
    // a failing row at the candidate n, or any n below it, means the bound is lower than expected: stop, not a pass
    const row = rec.rows.find((r) => curveOf(r) === c && r.n === CAND[c] && r.gt === 'action' && r.tag === '' && r.k === 0);
    const failed = { ...rec, rows: rec.rows.map((r) => (r === row ? { ...r, gateFail: 1, maxG: GATE + 1 } : r)) };
    assert.ok(coverageProblems(failed).some((m) => /FAILS at the candidate n/.test(m)), `${c}: a failing candidate-n row`);
    const below = { ...rec, rows: [...rec.rows, { ...clone(row), n: CAND[c] - 3, gateFail: 1, maxG: GATE + 5 }] };
    assert.ok(coverageProblems(below).some((m) => /fails at or below/.test(m)), `${c}: a failing row below the candidate n`);
  }
  // a duplicated row, a row recorded under another scenario, an unknown preset
  assert.ok(coverageProblems({ ...rec, rows: [...rec.rows, clone(rec.rows.find((r) => r.gt === 'rpg'))] }).length > 0, 'duplicate row');
  const other = { ...rec, rows: rec.rows.map((r, i) => (i === rec.rows.findIndex((x) => x.gt === 'action' && cand(x) && x.k === 7 && x.anim === 'P8') ? { ...r, scenario: 'stand' } : r)) };
  assert.ok(coverageProblems(other).length > 0, 'a boundary row recorded under another scenario');
  assert.ok(coverageProblems({ ...rec, animPresets: { ...rec.animPresets, P8: undefined } }).length > 0, 'a preset the record does not define');
  // the animation facts
  const weaker = (f) => { const c = clone(rec); f(c); return coverageProblems(c).length > 0; };
  assert.ok(weaker((c) => { for (const k of Object.keys(c.animPresets)) c.animPresets[k] = null; }), 'every preset static');
  assert.ok(weaker((c) => { c.animPresets.P8 = { ...c.animPresets.P8, dur: 1 }; }), 'no varying duration');
  assert.ok(weaker((c) => { for (const k of Object.keys(c.animPresets)) if (c.animPresets[k]) c.animPresets[k] = { ...c.animPresets[k], alt: false }; }), 'no alternate pose');
});

test('PROVENANCE (R3-F2): job records from two harnesses, generators, Mesen builds or engines are refused; so is a missing field', () => {
  const jobs = conformingRows().slice(0, 30);
  assert.deepEqual(jobProvenanceProblems(jobs), []);
  for (const f of ['engine', 'harness', 'generator', 'mesen']) {
    const mixed = jobs.map((j, i) => (i === 7 ? { ...j, prov: { ...j.prov, [f]: sha(`other-${f}`) } } : j));
    assert.ok(jobProvenanceProblems(mixed).some((m) => new RegExp(`${f} differs`).test(m)), `${f}: one job from another ${f} must be flagged`);
    assert.throws(() => buildRecordFromRows(mixed, { current: CURRENT }), /REFUSED/, `${f}: agg refuses`);
  }
  for (const f of PROVENANCE_FIELDS) {
    const missing = jobs.map((j, i) => (i === 3 ? { ...j, prov: Object.fromEntries(Object.entries(j.prov).filter(([k]) => k !== f)) } : j));
    assert.ok(jobProvenanceProblems(missing).some((m) => new RegExp(`provenance.${f} is missing`).test(m)), `${f}: missing field flagged`);
    assert.throws(() => buildRecordFromRows(missing, { current: CURRENT }), /REFUSED/, `${f}: agg refuses a missing field`);
  }
  assert.ok(jobProvenanceProblems(jobs.map((j, i) => (i === 3 ? { ...j, prov: undefined } : j))).length > 0, 'a job with no provenance block at all');
  assert.throws(() => buildRecordFromRows(jobs.map((j) => ({ ...j, prov: { ...j.prov, engine: sha('an older engine') } })), { current: CURRENT }), /REFUSED.*engine/, 'a uniform record measured on another engine than the current one is refused too');
  assert.doesNotThrow(() => buildRecordFromRows(jobs, { current: CURRENT }));
  // a malformed hash is a missing field
  assert.ok(provenanceFieldProblems({ ...jobs[0].prov, rom: 'abc' }).length > 0);
});

test('PROVENANCE (R3-F2): a record whose rows disagree, or lack a stamp, fails provenanceProblems', () => {
  const rec = conformingRecord();
  assert.deepEqual(provenanceProblems(rec), []);
  const bad = (f) => { const c = clone(rec); f(c); return provenanceProblems(c).length > 0; };
  assert.ok(bad((c) => { delete c.provenance; }), 'no record provenance');
  assert.ok(bad((c) => { delete c.rows[5].provenance; }), 'a row with no provenance');
  for (const f of ['engine', 'harness', 'generator', 'mesen']) {
    assert.ok(bad((c) => { c.rows[9].provenance[f] = sha('x').slice(0, 16); }), `a row from another ${f}`);
    assert.ok(bad((c) => { delete c.rows[2].provenance[f]; }), `a row missing its ${f} stamp`);
    assert.ok(bad((c) => { delete c.provenance[f]; }), `the record missing ${f}`);
  }
  assert.ok(bad((c) => { delete c.rows[2].provenance.set; }), 'a row missing its job-set stamp');
  assert.ok(bad((c) => { c.engine = { ...c.engine, sha256: sha('other') }; }), 'the engine fingerprint is not the provenance engine');
});

test('the RPG rows are spot checks that pass with room to spare: action is the game type that binds', () => {
  const rpg = curve.rows.filter((r) => r.gt === 'rpg');
  assert.ok(rpg.length > 0);
  assert.ok(rpg.every((r) => r.n === 16 && r.gateFail === 0), 'every RPG row is at n = 16 and passes');
  const action16 = curve.rows.filter((r) => r.gt === 'action' && !r.bound && r.n === 16);
  assert.ok(Math.max(...rpg.map((r) => r.maxG)) < Math.max(...action16.map((r) => r.maxG)) - 5000, 'an RPG-only derivation could not have found the end of either curve');
});

test('the animated presets are what bind: the worst row at each certified n, and every n+1 evidence row, is on animated art', () => {
  for (const [isBound, certified] of [[false, STREAM_TILE_CERTIFIED.plain], [true, STREAM_TILE_CERTIFIED.boundTiles]]) {
    const worst = (n) => curve.rows.filter((r) => r.gt === 'action' && !!r.bound === isBound && r.n === n).sort((a, b) => b.maxG - a.maxG)[0];
    assert.ok(animFacts(curve.animPresets[worst(certified).anim]).animated, `the worst row at n = ${certified} (${worst(certified).anim})`);
    const ev = curve.rows.filter((r) => r.gt === 'action' && !!r.bound === isBound && r.n === certified + 1 && r.gateFail > 0);
    assert.ok(ev.length > 0 && ev.every((r) => animFacts(curve.animPresets[r.anim]).animated), 'the failing rows are on animated art');
  }
});

test('the record holds walk rows only: the SYNTHETIC forced-Flash stress was not run on this engine, and no row pretends to be it', () => {
  assert.ok(curve.rows.every((r) => r.scenario === 'walk'), 'no scenario but the authored walk');
  assert.ok(curve.sampling.some((t) => /SAMPLED, NOT COVERED/.test(t)), 'the record says what it sampled');
  assert.match(fs.readFileSync(path.join(ROOT, 'shared/streambound.js'), 'utf8'), /SYNTHETIC forced-Flash stress[^]*NOT run on this engine/, 'shared/streambound.js says so too');
});

test('the equivalence record (test/lua/sw_rebuild_check.mjs) certifies THIS curve: same engine, harness, Mesen, recorded generator and job count', () => {
  const eq = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/streambound-equivalence.json'), 'utf8'));
  assert.equal(eq.engine, curve.provenance.engine, 'engine');
  assert.equal(eq.harness, curve.provenance.harness, 'harness');
  assert.equal(eq.mesen, curve.provenance.mesen, 'Mesen');
  assert.equal(eq.recordedGenerator, curve.provenance.generator, 'the generator the curve was measured on');
  assert.match(eq.finalGenerator, /^[0-9a-f]{64}$/);
  assert.equal(eq.jobs, curve.jobs, 'job count');
  assert.equal(eq.reused, curve.reused, 'reused count');
  assert.equal(eq.confirms, curve.confirms, 'confirmation re-runs');
  assert.equal(eq.checked, eq.jobs - eq.reused + eq.confirms, 'every record that ran Mesen was rebuilt (a reuse is covered by its source)');
  assert.equal(eq.matched, eq.checked, 'every rebuilt project and ROM equals the recorded one');
  assert.equal(eq.mismatched, 0);
  assert.equal(eq.errors, 0);
});
