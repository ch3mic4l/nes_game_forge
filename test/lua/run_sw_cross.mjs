// Phase 3a slice S3b: the campaign runner. One entry point for every launch of the slice; every launch is one named group of cells.
//
//   node test/lua/run_sw_cross.mjs --dry-run [--jobs=20] [--sec-per-run=6] [--reuse=a.json,b.json]   the launch table (cells, runs, estimate); no build, no Mesen
//   node test/lua/run_sw_cross.mjs --preflight [--root=<tree>] [--jobs=8]                              capacity preflight: BUILD every new-side cross cell, no Mesen
//   node test/lua/run_sw_cross.mjs --launch=<name> --out=<json> [--parent=<tree>] [--jobs=20]         one launch; REFUSES a launch that is not named below
//   ... --reuse=<restamped.json,...> --reuse-only                                                  FINALIZE a launch by reuse: every cell a reused record or a pinned refusal (zero Mesen), else exit 2
//
// Launches (plan 6): P1 parent x-stages, P2 parent phase/coincide/anims/lead, P3 parent pops (all on the unchanged tree: --parent, a git archive of
// 15c11b7); L1 new phase/coincide/anims/lead; L3 new x-stages; L4 new pops-only. L5 (talker + battle), X5 (authoring search) and the bound
// re-sweep have their own scripts and are listed in the table only. Chris's per-launch go-ahead is a precondition of running one: this file cannot
// know it, so it asks for the name and refuses anything else, and the 20-process ceiling is checked before anything starts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO } from './sw_manifest_scene.mjs';
import { MACHINE_CEILING, assertRoom, countMesen, parseFlags, wholeNumber, measureCell, cellProblems, needsCompact } from './sw_move_policy.mjs';
import { runCampaign, isCapacityRefusal } from './run_sw_move_sweep.mjs';
import { enumerateAll, CROSS_STAGES, EXISTING_STAGES, cellOptions } from './sw_cross_cells.mjs';
import { measureCrossCell, usesCompactRoot } from './sw_cross_scene.mjs';
import { cellVerdict, stageCompositionProblems, shapeCompletionProblems, STAGE_NEEDS, GATE, worstGated, parentTiming } from './sw_cross_classes.mjs';
import { loadGroups, groupProblems, pinProblems, refusalProblems, refusalNeed, partnerOf, GROUP_NAMES } from './sw_cross_exclusions.mjs';
import { loadEvidence, loadParentEvidence, parentEvidenceFromEnvelopes, evidenceStructureProblems, parentCoverageProblems } from './sw_cross_evidence.mjs';
import { validateEnvelopes, treeStamp, EvidenceError, TREE_FIELDS } from './sw_cross_validate.mjs';
import { measureFingerprint, campaignFingerprint } from './sw_cross_fingerprint.mjs';
import { gzipSync } from 'node:zlib';
import crypto from 'node:crypto';
import { planReuse } from './sw_cross_reuse.mjs';
import { processProvenance, generatorHash } from './sw_provenance.mjs';
import { compactRoot } from './sw_compact_root.mjs';
import { MESEN_DEFAULT } from './run_sw_manifest.mjs';

const isExisting = (c) => c.stages.some((s) => EXISTING_STAGES.includes(s));
const isPopsOnly = (c) => c.stages.every((s) => s === 'pops');

/** The launch a cell belongs to, per side. A cell shared by phase/coincide/anims/lead and pops runs once, in the small launch. */
export function launchOf(c) {
  const p = c.which === 'parent';
  if (!isExisting(c)) return p ? 'P1' : 'L3';
  return isPopsOnly(c) ? (p ? 'P3' : 'L4') : (p ? 'P2' : 'L1');
}
export const LAUNCHES = {
  P1: { what: 'parent baselines of the cross stages (x1 x2 x3 x4 x5h x5r x6)', tree: 'parent: unchanged 15c11b7 archive' },
  P2: { what: 'parent baselines of phase + coincide + anims + lead', tree: 'parent: unchanged 15c11b7 archive' },
  P3: { what: 'parent baselines of pops', tree: 'parent: unchanged 15c11b7 archive' },
  L1: { what: 'new phase + coincide + anims + lead', tree: 'new: S3b tree' },
  L3: { what: 'new cross stages (x1 x2 x3 x4 x5h x5r x6)', tree: 'new: S3b tree' },
  L4: { what: 'new pops (pops-only cells; the 180 it shares with L1 run there)', tree: 'new: S3b tree' }
};
export const OTHER_LAUNCHES = [
  { name: 'L5', what: 'talker + scripted Battle after a crossing (RPG): the 24 pinned cases of test/lua/sw_talker_battle.mjs (8 T5 owed-entry + 16 T6 talker-state x self-command), run with `node test/lua/sw_talker_battle.mjs --run --procs=4 --out=<json>`; every expectation hand-written there', cells: 24, processes: 4, minutes: 2, tree: 'new' },
  { name: 'X5', what: 'hseam authoring search / confirmation against the real engine (dev probe)', cells: '<= 600', processes: 20, minutes: 3, tree: 'new' },
  { name: 'RS', what: 'bound re-sweep (stages A B C R F P) + identity certificate (no Mesen, ~110 s); S3a.5 measured 12,590 records in 4,189 s at 16 processes', cells: '12,590 records', processes: 20, minutes: Math.round(4189 * 16 / 20 / 60), tree: 'new (after every edit under main/ shared/ and the harness files is final)' }
];

/**
 * The firm launch table. `cells` = enumerateAll(); `groups` = loadGroups(); `records` = Map id -> record, `expectedBySide` = { new, parent } current hashes
 * (null = unknown: nothing is reused). A cell pinned as refused costs a build, not a Mesen run, so it is excluded from `runs`.
 */
export function launchTable(cells, { groups, evidence = null, records = new Map(), expectedBySide = {}, jobs = MACHINE_CEILING, secPerRun = 6 } = {}) {
  // a cell pinned as refused costs a build, not a Mesen run -- on the new side every group's ids, on the parent side the twins of the groups the parent refuses
  // too (a parent that builds its twin is a real parent run: the success receipt of a new-engine-only exclusion)
  const refusedNew = new Set(GROUP_NAMES.flatMap((n) => [...groups[n].ids]));
  const refusedParent = new Set(GROUP_NAMES.filter((n) => groups[n].parentRefuses).flatMap((n) => [...groups[n].ids].map(partnerOf)));
  const reuse = planReuse(cells, records, expectedBySide);
  const reusedIds = new Set(reuse.reused.map((r) => r.cell.id));
  const rows = [];
  for (const [name, info] of Object.entries(LAUNCHES)) {
    const mine = cells.filter((c) => launchOf(c) === name);
    const todo = mine.filter((c) => !reusedIds.has(c.id));
    const refused = todo.filter((c) => (c.which === 'new' ? refusedNew : refusedParent).has(c.id));
    const runs = todo.length - refused.length;
    const processes = Math.min(jobs, MACHINE_CEILING, Math.max(1, runs));
    const minutes = (runs * secPerRun) / processes / 60;
    rows.push({ name, ...info, cells: mine.length, reused: mine.length - todo.length, buildOnlyRefusals: refused.length, runs, processes, minutes: Number(minutes.toFixed(1)), over15: minutes > 15 });
  }
  return { rows, other: OTHER_LAUNCHES, reasons: reuse.reasons, secPerRun, jobs };
}

// ----------------------------------------------------------------- the verdict of a campaign

/** Every problem of one measured cell, over ALL the stages that list it (the union of what its stages require). */
export function crossCellProblems(c, measured, { gate = GATE } = {}) {
  const out = new Set();
  const stages = c.stages.filter((s) => CROSS_STAGES.includes(s));
  if (!stages.length || c.which === 'parent') return cellVerdict({ ...c, stage: stages[0] ?? c.stage }, measured, { gate });
  for (const [i, s] of c.stages.entries()) {
    if (!CROSS_STAGES.includes(s)) continue;
    for (const p of cellVerdict({ ...c, stage: s, kind: c.kinds[i] ?? c.kind }, measured, { gate })) out.add(p);
  }
  return [...out];
}

/**
 * The verdict of one launch. `results` = [{ id, error?, rows?, summary?, ... }] with exactly one per planned cell. A capacity refusal is never a
 * measurement: it is checked against the five groups (exact-set, unexpected-refusal, all-excluded) and reported by group.
 */
export function campaignVerdict({ planned, results, groups, complete = true, gate = GATE, evidence = null, parentEvidence = null, currentProv = null }) {
  const problems = [];
  const bad = (id, p) => problems.push({ id, problem: p });
  if (!planned.length) bad('(plan)', 'the plan is empty: nothing was measured');
  const want = new Map(planned.map((c) => [c.id, c]));
  const seen = new Map();
  for (const r of results) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
  for (const id of want.keys()) if (!seen.has(id)) bad(id, 'no result for this planned cell');
  for (const [id, n] of seen) { if (!want.has(id)) bad(id, 'a result for a cell that was not planned'); else if (n > 1) bad(id, `${n} results for one planned cell`); }
  const refusals = [];
  const measured = new Map();
  let worst = 0;
  const parentT = { maxMove: 0, maxFinal: 0, measured: 0 };
  for (const r of results) {
    const c = want.get(r.id);
    if (!c) continue;
    if (r.error) {
      if (isCapacityRefusal(r.error)) refusals.push({ id: r.id, reason: r.error });
      else bad(r.id, `the measurement failed: ${r.error}`);
      continue;
    }
    measured.set(r.id, r);
    const found = r.summary && !r.rows ? cellProblems(r.summary, c, { gate }) : (r.rows ? crossCellProblems(c, r, { gate }) : ['the result carries no measurement']);
    for (const p of found) bad(r.id, p);
    if (r.rows && c.which === 'new') worst = Math.max(worst, worstGated(r.rows));
    else if (r.summary && c.which === 'new') worst = Math.max(worst, r.summary.maxStep ?? 0, r.summary.maxFinal ?? 0);
    // a parent never crosses, but its scripted Move bodies are measured and reported (review 1 finding 6: "worst G 0" was wrong)
    if (c.which === 'parent') {
      parentT.measured++;
      if (r.rows) { const t = parentTiming(r.rows); parentT.maxMove = Math.max(parentT.maxMove, t.move); parentT.maxFinal = Math.max(parentT.maxFinal, t.final); }
      else if (r.summary) { parentT.maxMove = Math.max(parentT.maxMove, r.summary.maxStep ?? 0, r.summary.maxFinal ?? 0); parentT.maxFinal = Math.max(parentT.maxFinal, r.summary.maxFinal ?? 0); }
    }
  }
  const ref = refusalProblems({ planned, refusals, groups, complete, evidence, parentEvidence, currentProv });
  for (const p of ref.problems) bad('(refusals)', p);
  for (const s of CROSS_STAGES) {
    const cs = planned.filter((c) => c.stages.includes(s));
    if (cs.some((c) => c.which !== 'parent') && STAGE_NEEDS[s]) for (const p of stageCompositionProblems(s, cs.map((c) => ({ ...c, stage: s, kind: c.kinds[c.stages.indexOf(s)] })), measured, { need: STAGE_NEEDS })) bad(`(${s})`, p);
  }
  for (const p of shapeCompletionProblems(planned, measured)) bad('(shape)', p);
  if (planned.length && !measured.size) bad('(plan)', 'no cell was measured: every planned cell was excluded, failed or missing');
  return { ok: problems.length === 0, problems, planned: planned.length, measured: measured.size, refused: refusals.length, byGroup: Object.fromEntries(Object.entries(ref.byGroup).map(([k, v]) => [k, v.length])), notes: ref.notes, worstGated: worst, parentTiming: parentT };
}

// ----------------------------------------------------------------- measuring and recording

/**
 * The raw measurement of one run, written beside the results as `<rawDir>/<sha of the id>.json.gz` (mark order, multiplicity and cycle positions are
 * what an audit of a last-slot rebind needs; the derived rows keep only names). Returns the pointer the record carries: { dir, file, sha256, bytes }, where
 * `dir` is the ORIGINATING directory (absolute): a record reused into another launch's envelope keeps pointing at the file where it was written.
 */
export function writeRaw(rawDir, id, res) {
  fs.mkdirSync(rawDir, { recursive: true });
  const body = gzipSync(JSON.stringify({ id, cacheKey: res.cacheKey, prov: res.prov, status: res.status, done: res.done, timeout: res.timeout, frames: res.frames, timing: res.timing, phases: res.phases, marks: res.marks, trace: res.trace }));
  const file = `${crypto.createHash('sha256').update(id).digest('hex').slice(0, 24)}.json.gz`;
  fs.writeFileSync(path.join(rawDir, file), body);
  return { dir: path.resolve(rawDir), file, sha256: crypto.createHash('sha256').update(body).digest('hex'), bytes: body.length };
}

/**
 * One cell -> the record the reuse map and the verdict read: { id, options, prov, campaign, source, raw?, rows | summary, status, done, timeout, facts }.
 * `campaign` is the measuring implementation's fingerprint (a record is reusable only under the same one); `source` links the run to its ROM/project
 * (prov.rom / prov.project), the Mesen-key (`cacheKey`) and whether the generator was the compacting root (then `plainGenerator` is the real tree's hash).
 */
export async function measureRecord(c, { tiles, root, mesen = MESEN_DEFAULT, rawDir = null }) {
  const campaign = measureFingerprint();
  const cross = c.stages.some((s) => CROSS_STAGES.includes(s));
  const m = cross ? await measureCrossCell(c, { tiles, root, mesen, keepRes: Boolean(rawDir) }) : await measureCell(c, { tiles, root }).then(({ res, summary }) => ({ res, summary, prov: res.prov, cacheKey: res.cacheKey }));
  const res = m.res ?? m;
  const compact = cross ? usesCompactRoot(c) : needsCompact(c);
  const source = { cacheKey: m.cacheKey, compact, ...(compact ? { plainGenerator: processProvenance(root, mesen).generator } : {}) };
  const raw = rawDir && res.marks ? writeRaw(rawDir, c.id, res) : null;
  if (cross) return { id: c.id, options: cellOptions(c), prov: m.prov, campaign, source, ...(raw ? { raw } : {}), rows: m.rows, ...(m.summary ? { summary: m.summary } : {}), status: m.status, done: m.done, timeout: m.timeout, facts: m.facts ?? null };
  return { id: c.id, options: cellOptions(c), prov: m.prov, campaign, source, ...(raw ? { raw } : {}), summary: m.summary, status: res.status, done: res.done, timeout: res.timeout };
}

/** Build-only: every new-side cell of the cross stages through `prepareOnly`, returning the refusals. No Mesen. */
export async function preflight(cells, { tiles = 15, root = REPO, jobs = 8, only = null, onProgress = () => {} } = {}) {
  const mine = cells.filter((c) => c.which === 'new' && c.stages.some((s) => CROSS_STAGES.includes(s)) && (!only || only.test(c.id)));
  const out = await runCampaign({ cells: mine.map((c) => ({ ...c, which: 'new' })), jobs, onProgress, measure: async (c) => { await measureCrossCell(c, { tiles, root, prepareOnly: true }); return { summary: { prepared: true } }; } });
  return { built: out.filter((r) => !r.error).length, refusals: out.filter((r) => r.error).map((r) => ({ id: r.cell.id, reason: r.error })), results: out };
}

/**
 * The exclusion contract against SERIALIZED launch results, no Mesen: `launchFiles` (new-tree result files, each { records, errors }) held to the final
 * per-id evidence and to the parent campaigns' receipts (`parentFiles`, the P* result files). BOTH sets of files are validated first (sw_cross_validate.mjs):
 * a launch or parent file that is partial, incomplete, of another tree, produced by other code or carrying unlinked or corrupt raw evidence is a problem (parent
 * files throw: they are never read as receipts). Exact sets apply (the files are complete launches), every parent twin must have a result, and a stage x game
 * type with every cell refused fails. { problems, notes, byGroup, residual, results, evidenceKinds }.
 */
export function verifyExclusions({ launchFiles, parentFiles, groups, evidence, allCells, trees, current }) {
  const cellsById = new Map(allCells.map((c) => [c.id, c]));
  const loaded = launchFiles.map((f) => ({ name: path.basename(f), j: JSON.parse(fs.readFileSync(f, 'utf8')), side: 'new' }));
  const parentEvidence = loadParentEvidence(parentFiles, { cellsById, trees, current });
  const ev = validateEnvelopes(loaded, { cellsById, trees, current });
  const results = loaded.flatMap(({ j }) => [...(j.records ?? []), ...(j.errors ?? [])]);
  const have = new Set(results.map((r) => r.id));
  const planned = allCells.filter((c) => have.has(c.id));
  const problems = [...ev.problems];
  for (const n of GROUP_NAMES) for (const id of groups[n].ids) if (!have.has(id)) problems.push(`${n}: ${id} is pinned but no launch file has a result for it (the files must be the whole launch set)`);
  const refusals = results.filter((r) => r.error && isCapacityRefusal(r.error)).map((r) => ({ id: r.id, reason: r.error }));
  for (const r of results) if (r.error && !isCapacityRefusal(r.error)) problems.push(`${r.id}: the measurement failed: ${r.error}`);
  const ref = refusalProblems({ planned, refusals, groups, complete: true, evidence, parentEvidence, currentProv: trees.new });
  problems.push(...ref.problems);
  const outcome = (id) => { if (parentEvidence.has(id)) { const e = parentEvidence.get(id); return e.status; } const r = results.find((x) => x.id === id); return r === undefined ? undefined : r.error ? 'refused' : 'measured'; };
  const cov = parentCoverageProblems(planned, outcome);
  problems.push(...cov.problems);
  const pinned = new Set(GROUP_NAMES.flatMap((n) => [...groups[n].ids]));
  const residual = refusals.filter((r) => r.id.startsWith('new/') && !pinned.has(r.id)).map((r) => ({ id: r.id, new: refusalNeed(r.reason), parent: parentEvidence.get(partnerOf(r.id)) ?? null }));
  return { problems, notes: [...ref.notes, ...cov.notes], byGroup: ref.byGroup, residual, results: results.length, evidenceKinds: ev.kinds };
}

// ----------------------------------------------------------------- envelopes and the trees evidence is validated against

/**
 * Writes a result file COMPACT (no indentation): a parent envelope holds ~120 KB of rows per record, and the indented form of the P1 re-run would pass V8's
 * string limit (~536 M characters) after the whole launch had run. A string that is still too long is an error naming the limit, never a lost launch.
 */
export function writeEnvelope(file, env) {
  let text;
  try { text = JSON.stringify(env); } catch (e) { throw new Error(`the result file ${file} is too large to serialize (${e.message}): split the launch`); }
  fs.writeFileSync(file, text);
  return text.length;
}

const hashesOf = (root, mesen) => { const p = processProvenance(root, mesen); return { engine: p.engine, harness: p.harness, generator: p.generator, mesen: p.mesen, compactGenerator: generatorHash(compactRoot(root)) }; };
const currentHashes = (root, mesen) => ({ ...hashesOf(root, mesen), campaign: measureFingerprint() });
/** This campaign's own code: the measuring, judging and fixture fingerprints an envelope must carry. */
export const campaignParts = () => { const c = campaignFingerprint({}); return { measure: c.measure.sha256, judge: c.judge.sha256, fixtures: c.fixtures.sha256 }; };

/**
 * The trees evidence is validated against: the NEW side is this tree now; the PARENT side is the tree the evidence PINS (so a parent file is judged without
 * the archive on disk) -- and when `parentRoot` is given (a parent launch, or an explicit --parent) that tree must BE the pinned one.
 */
export function expectedTrees(evidence, { mesen, parentRoot = null }) {
  const pin = evidence.prov?.parent ?? {};
  if (parentRoot) {
    const live = hashesOf(parentRoot, mesen);
    const bad = TREE_FIELDS.filter((f) => live[f] !== pin[f]);
    if (bad.length) throw new Error(`${parentRoot} is not the pinned parent tree (${bad.map((f) => `${f} ${String(live[f]).slice(0, 12)} != pinned ${String(pin[f]).slice(0, 12)}`).join(', ')}): regenerate the evidence pin or use the pinned tree`);
  }
  return { new: treeStamp('new', hashesOf(REPO, mesen)), parent: treeStamp('parent', pin) };
}

// ----------------------------------------------------------------- CLI

const FLAGS = { 'dry-run': 'bool', preflight: 'bool', 'reuse-only': 'bool', launch: 'value', out: 'value', parent: 'value', jobs: 'value', tiles: 'value', root: 'value', 'sec-per-run': 'value', reuse: 'value', mesen: 'value', only: 'value', 'parent-evidence': 'value', aggregate: 'value', 'verify-exclusions': 'value' };
const sideOfLaunch = (launch) => (/^P\d/.test(launch ?? '') ? 'parent' : 'new');
const fileSha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    await main();
  } catch (e) {
    console.error(e instanceof EvidenceError ? e.message : `error: ${e.message}`);
    process.exit(e instanceof EvidenceError ? 1 : 2);
  }
}

async function main() {
  const raw = parseFlags(process.argv.slice(2), FLAGS);
  const jobs = wholeNumber(raw.jobs, 'jobs', 1, MACHINE_CEILING, MACHINE_CEILING);
  const tiles = wholeNumber(raw.tiles, 'tiles', 8, 16, 15);
  const secPerRun = raw['sec-per-run'] === undefined ? 6 : Number(raw['sec-per-run']);
  if (!Number.isFinite(secPerRun) || secPerRun <= 0) throw new Error('--sec-per-run must be a positive number');
  const mesen = raw.mesen ?? MESEN_DEFAULT;
  const groups = loadGroups();
  const cells = enumerateAll({ tiles });
  const gp = [...groupProblems(groups), ...pinProblems(groups, cells)];
  if (gp.length) { console.error(gp.join('\n')); process.exit(2); }
  const records = new Map();
  for (const f of (raw.reuse ?? '').split(',').filter(Boolean)) for (const r of JSON.parse(fs.readFileSync(f, 'utf8')).records ?? []) records.set(r.id, r);
  if (raw['dry-run']) {
    let expectedBySide = {};
    try { expectedBySide = { new: currentHashes(REPO, mesen), parent: raw.parent ? currentHashes(path.resolve(raw.parent), mesen) : null }; } catch { /* hashes unknown: nothing is reused */ }
    const t = launchTable(cells, { groups, evidence: loadEvidence(), records, expectedBySide, jobs, secPerRun });
    console.log(JSON.stringify(t, null, 1));
    return;
  }
  const evidence = loadEvidence();
  const cellsById = new Map(cells.map((c) => [c.id, c]));
  const parentFiles = (raw['parent-evidence'] ?? '').split(',').filter(Boolean);
  const parentRoot = raw.parent ? path.resolve(raw.parent) : null;
  const ctx = () => ({ cellsById, trees: expectedTrees(evidence, { mesen, parentRoot }), current: campaignParts() });
  if (raw.preflight) {
    const only = raw.only ? new RegExp(raw.only) : null;
    const p = await preflight(cells, { tiles, root: raw.root ? path.resolve(raw.root) : REPO, jobs, only, onProgress: (n, total) => { if (n % 250 === 0) console.error(`${n}/${total}`); } });
    const planned = cells.filter((c) => c.which === 'new' && c.stages.some((s) => CROSS_STAGES.includes(s)) && (!only || only.test(c.id)));
    // a whole-plan preflight with the parent receipts is held to the final per-id evidence like a launch (exact sets, free/delta, parent twins)
    const full = !only && parentFiles.length > 0;
    let ref;
    if (full) { const c = ctx(); ref = refusalProblems({ planned, refusals: p.refusals, groups, complete: true, evidence, parentEvidence: loadParentEvidence(parentFiles, c), currentProv: c.trees.new }); }
    else ref = refusalProblems({ planned, refusals: p.refusals, groups, complete: false });
    fs.writeFileSync(raw.out ?? 'preflight.json', JSON.stringify({ built: p.built, refusals: p.refusals, problems: ref.problems, notes: ref.notes }, null, 1));
    console.log(`${p.built} built, ${p.refusals.length} refused, ${ref.problems.length} problems`);
    process.exit(ref.problems.length ? 1 : 0);
  }
  // the exclusion contract is checked against the final per-id evidence and the fresh parent campaigns' receipts, never against a pin alone
  const ep = evidenceStructureProblems(groups, evidence);
  if (ep.length) { console.error(ep.join('\n')); process.exit(2); }
  if (raw['verify-exclusions']) {
    if (!parentFiles.length) { console.error('--parent-evidence=<P*.json,...> is required with --verify-exclusions'); process.exit(2); }
    const c = ctx();
    const v = verifyExclusions({ launchFiles: raw['verify-exclusions'].split(',').filter(Boolean), parentFiles, groups, evidence, allCells: cells, ...c });
    if (raw.out) fs.writeFileSync(raw.out, JSON.stringify(v, null, 1));
    console.log(`${v.results} results; ${v.problems.length} problems; ${v.residual.length} refusals outside every group; evidence ${v.evidenceKinds.raw} raw, ${v.evidenceKinds.historical} historical`);
    for (const p of v.problems.slice(0, 25)) console.log(`  ${p}`);
    process.exit(v.problems.length ? 1 : 0);
  }
  if (raw.aggregate) {
    // THE MANDATORY FINAL AGGREGATE: every launch's result file at once, against the whole plan; the exact sets, every stage and shape need, and the
    // parent twin of every measured cell are checked together (a child launch cannot do that: it holds a subset). Every file and every record in it is
    // VALIDATED first (sw_cross_validate.mjs): tree, code fingerprints, options, provenance, successful measurement, raw pointers and linkage.
    const c = ctx();
    const files = raw.aggregate.split(',').filter(Boolean);
    const loaded = files.map((f) => ({ name: f, j: JSON.parse(fs.readFileSync(f, 'utf8')) })).map((x) => ({ ...x, side: sideOfLaunch(x.j.launch) }));
    const ev = validateEnvelopes(loaded, c);
    const shape = ev.shape;
    if (shape.length) { console.error(`these launches are not clean:\n  ${shape.slice(0, 20).join('\n  ')}`); process.exit(1); }
    const results = loaded.flatMap(({ j }) => [...j.records, ...j.errors]);
    const parentLoaded = loaded.filter((x) => x.side === 'parent');
    const parentEvidence = parentEvidenceFromEnvelopes(parentLoaded);
    const resultById = new Map(results.map((r) => [r.id, r]));
    const v = campaignVerdict({ planned: cells, results, groups, complete: true, evidence, parentEvidence, currentProv: c.trees.new });
    for (const p of ev.problems) v.problems.push({ id: '(evidence)', problem: p });
    const cov = parentCoverageProblems(cells, (id) => { const e = parentEvidence.get(id); if (e) return e.status; const r = resultById.get(id); return r === undefined ? undefined : r.error ? 'refused' : 'measured'; });
    for (const p of cov.problems) v.problems.push({ id: '(parent coverage)', problem: p });
    v.notes.push(...cov.notes);
    v.ok = v.problems.length === 0;
    v.evidenceKinds = ev.kinds;
    const refusedNew = results.filter((r) => r.error && r.id.startsWith('new/')).map((r) => r.id);
    const pinned = new Set(GROUP_NAMES.flatMap((n) => [...groups[n].ids]));
    const residual = refusedNew.filter((id) => !pinned.has(id)).map((id) => ({ id, new: refusalNeed(resultById.get(id).error), parent: parentEvidence.get(partnerOf(id)) ?? null }));
    fs.writeFileSync(raw.out ?? 'aggregate.json', JSON.stringify({ aggregate: true, files, fileHashes: files.map((f) => ({ file: f, sha256: fileSha(f) })), complete: true, campaign: campaignFingerprint({ aggregate: files }), evidence: { kinds: ev.kinds, perFile: ev.perFile }, verdict: v, residual }, null, 1));
    console.log(`aggregate of ${files.length} launches: ${results.length} results; ${v.problems.length} problems; ${residual.length} refusals outside every group; evidence ${ev.kinds.raw} raw, ${ev.kinds.historical} historical`);
    for (const p of v.problems.slice(0, 25)) console.log(`  ${p.id}: ${p.problem}`);
    process.exit(v.ok ? 0 : 1);
  }
  if (!raw.launch || !(raw.launch in LAUNCHES)) { console.error(`--launch must be one of ${Object.keys(LAUNCHES).join(', ')}`); process.exit(2); }
  if (!raw.out) { console.error('--out=<json> is required'); process.exit(2); }
  const parentLaunch = raw.launch.startsWith('P');
  if (parentLaunch && !raw.parent) { console.error('--parent=<tree> is required for a parent launch (a git archive of 15c11b7)'); process.exit(2); }
  // a child launch is held to its parents: the fresh parent campaigns' result files are mandatory evidence (review 1 finding 4)
  if (!parentLaunch && !parentFiles.length) { console.error('--parent-evidence=<P*.json,...> is required for a new-tree launch: its exclusions are checked against the parent receipts'); process.exit(2); }
  const c = ctx(); // a parent launch must run on the PINNED parent tree: expectedTrees refuses any other
  const parentEvidence = parentFiles.length ? loadParentEvidence(parentFiles, c) : null;
  const root = parentLaunch ? parentRoot : REPO;
  if (!fs.existsSync(path.join(root, 'main/build/pipeline.js'))) { console.error(`${root} is not a project tree`); process.exit(2); }
  const side = parentLaunch ? 'parent' : 'new';
  const mine = cells.filter((c2) => launchOf(c2) === raw.launch);
  const expected = currentHashes(root, mesen);
  const plan = planReuse(mine, records, { new: expected, parent: expected });
  const runs = plan.fresh.filter((c2) => !(c2.which === 'new' ? new Set(GROUP_NAMES.flatMap((n) => [...groups[n].ids])) : new Set(GROUP_NAMES.filter((n) => groups[n].parentRefuses).flatMap((n) => [...groups[n].ids].map(partnerOf)))).has(c2.id)).length;
  // --reuse-only is a FINALIZATION: every measured cell must come from a reused record and only the pinned refusals are built (their receipts); a cell that
  // would need Mesen stops the launch before anything starts, so "zero Mesen runs" is a property of the command, not a hope
  if (raw['reuse-only'] && runs > 0) { console.error(`--reuse-only: ${raw.launch} would run ${runs} cell(s) in Mesen (${plan.fresh.length} not reused): ${JSON.stringify(plan.reasons)}`); process.exit(2); }
  assertRoom(runs ? Math.min(jobs, runs) : 0, countMesen()); // a launch that only builds (finalizing parents by reuse, build-only receipts) needs no Mesen room
  console.error(`${raw.launch}: ${mine.length} cells (${plan.reused.length} reused, ${plan.fresh.length} not reused: ${runs} to run in Mesen, ${plan.fresh.length - runs} pinned refusals built only), ${jobs} at a time, estimate ${((runs * secPerRun) / jobs / 60).toFixed(1)} min at ${secPerRun} s per run`);
  const t0 = Date.now();
  const finished = [];
  const rawDir = `${raw.out}.raw`;
  const fresh = await runCampaign({
    cells: plan.fresh, jobs,
    measure: async (c2) => { const r = await measureRecord(c2, { tiles, root, mesen, rawDir }); return { summary: r }; },
    onResult: (r) => { finished.push(r); if (finished.length % 100 === 0) fs.writeFileSync(`${raw.out}.partial`, JSON.stringify({ launch: raw.launch, partial: true, done: finished.length })); },
    onProgress: (n, total) => { if (n % 50 === 0) console.error(`${n}/${total} ${Math.round((Date.now() - t0) / 1000)}s`); }
  });
  fs.rmSync(`${raw.out}.partial`, { force: true });
  const results = [...plan.reused.map((r) => r.record), ...fresh.map((r) => (r.error ? { id: r.id, error: r.error } : r.summary))];
  const records2 = results.filter((r) => !r.error);
  // the launch ran EVERY planned cell of its group to completion: the exact-set checks apply (`complete`), against the evidence and the parent receipts
  const v = campaignVerdict({ planned: mine, results, groups, complete: true, evidence, parentEvidence, currentProv: c.trees.new });
  const env = { gate: GATE, launch: raw.launch, tiles, ms: Date.now() - t0, complete: true, tree: c.trees[side], campaign: campaignFingerprint({ launch: raw.launch, tiles, jobs, reuse: records.size ? [...(raw.reuse ?? '').split(',').filter(Boolean)] : [], parentEvidence: parentFiles }), reuse: { reused: plan.reused.length, measured: fresh.filter((r) => !r.error).length, refused: fresh.filter((r) => r.error).length }, verdict: v, records: records2, errors: results.filter((r) => r.error) };
  // the launch validates what it is about to certify (fresh and reused records alike) exactly as every later reader will
  const ev = validateEnvelopes([{ name: raw.launch, j: { ...env, verdict: { ok: true } }, side }], c);
  for (const p of ev.problems) v.problems.push({ id: '(evidence)', problem: p });
  v.ok = v.problems.length === 0;
  v.evidenceKinds = ev.kinds;
  writeEnvelope(raw.out, env);
  console.log(`${results.length} cells (${plan.reused.length} reused, ${fresh.filter((r) => !r.error).length} measured, ${fresh.filter((r) => r.error).length} refused or failed) in ${Math.round((Date.now() - t0) / 1000)} s; ${v.problems.length} problems; worst gated G ${v.worstGated ?? 'n/a'}; parent Move max ${v.parentTiming.maxMove} (final ${v.parentTiming.maxFinal}) over ${v.parentTiming.measured} parent records; evidence ${ev.kinds.raw} raw, ${ev.kinds.historical} historical`);
  for (const p of v.problems.slice(0, 25)) console.log(`  ${p.id}: ${p.problem}`);
  process.exit(v.ok ? 0 : 1);
}
