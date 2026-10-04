// The M11 campaign (plan 5.3 row M11, 7 S3a T9): the cells of a streamed player Move, measured full-system in Mesen on the live tree AND on a
// parent tree (--parent=<dir>, a `git archive` of the parent commit with node_modules linked), at the tile bound, behind a bounded worker pool.
//   node test/lua/run_sw_move_sweep.mjs --stage=<phase|coincide|pops|anims|lead> --parent=<dir> --out=<json> [--jobs=8] [--tiles=15] [--dry-run]
//        [--reuse=<json>[,<json>...]]   (earlier campaign files: a cell they measured successfully is taken, re-validated, instead of re-run)
//
// FAIL CLOSED (review 1, required change 2). The process exits 0 only when EVERY planned cell produced exactly one successful measurement whose
// composition was actually present (a step body with the camera call and a strip in flight, a final body with its continuation, the coincident
// reduced-chunk drain where the cell claims it) and no new-engine M11 row exceeds the gate G <= 29,780. A missing mark, a thrown build or
// harness error, a nonzero Mesen status, a timeout, a non-finite figure, a missing or duplicated cell, an over-gate row and a capacity refusal
// (which never discharges a required workload) are each a nonzero exit. The rules are test/lua/sw_move_policy.mjs, shared with the standalone cell command.
// Not gated, by design: parent-engine cells (their F6 post-Move redraw is the defect S3a removes) and the pre-Move text-box close bodies of a
// Say lead (`before.*`: a separately classified, known dialogue-restoration cost outside M11(a)/(b), docs/design-streamed-worlds-phase3a.md). A Say
// lead's own step and final bodies ARE gated.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { populations, GATE } from './run_sw_move_manifest.mjs';
import { REPO } from './sw_manifest_scene.mjs';
import { MACHINE_CEILING, countMesen, assertRoom, parseFlags, wholeNumber, cellId, expectFor, gated, cellProblems, measureCell, needsCompact } from './sw_move_policy.mjs';

export { MACHINE_CEILING, countMesen, cellId, expectFor, gated, needsCompact };
export const STAGES = ['phase', 'coincide', 'pops', 'anims', 'lead'];
export const PHASE_DISTS = Array.from({ length: 16 }, (_, i) => 150 + i); // every strip-arm phase (a strip arms every 16 px)
export const TAIL_NAMES = ['none', 'say', 'flash', 'switch', 'move2'];

/**
 * The measured arrangements of the coincident reduced strip drain (review 1, required change 1): Flash lead + (touchY, dist). Each entry is
 * a Move short enough that the body after Flash's published 35-byte packet is the final one. Measured by the pilot
 * (handoff-next/s3a/fix1/pilot-coincide-*.json: 128 (touchY, dist) cells on each of action/wide, action/tight and rpg/wide, the composition of
 * every one identical across game type and art -- the timing is the script's, not the population's); `plan` refuses a coincidence stage while empty.
 */
export const COINCIDENCE_CELLS = [
  { dist: 3, touchY: 60, kind: 'strip' }, { dist: 12, touchY: 60, kind: 'strip' }, { dist: 2, touchY: 61, kind: 'strip' }, // reduced chunk, strip in flight
  { dist: 3, touchY: 71, kind: 'arm' }, { dist: 12, touchY: 63, kind: 'arm' }, // the same drain on the body that arms the strip (the heaviest)
  { dist: 2, touchY: 60, kind: 'pub' }, { dist: 10, touchY: 60, kind: 'pub' } // the final body publishes Flash's packet itself
];
/** The strip-arm phases whose final/step bodies were the worst in the base-population phase sweep, per game type (filled from that sweep). */
export const WORST_DISTS = { // from the phase stage (handoff-next/s3a/fix1/m11-phase.json): the distance of the worst new-engine step and of the worst final body
  'action/none': [153, 159], 'action/say': [151, 159], 'action/flash': [150, 159], 'action/switch': [150, 159], 'action/move2': [150, 164],
  'rpg/none': [150, 159], 'rpg/say': [150, 159], 'rpg/flash': [150, 159], 'rpg/switch': [150, 159], 'rpg/move2': [151, 164]
};

const isInt = (v) => Number.isInteger(v);
const SWEEP_FLAGS = { stage: 'value', parent: 'value', out: 'value', jobs: 'value', tiles: 'value', 'dry-run': 'bool', 'sec-per-run': 'value', reuse: 'value' };

/** Parses and validates the command line; throws a plain Error naming the bad option. `running` = Mesen processes already on the machine. */
export function parseOptions(argv, { running } = {}) {
  const raw = parseFlags(argv, SWEEP_FLAGS);
  const jobs = wholeNumber(raw.jobs, 'jobs', 1, MACHINE_CEILING, 8);
  const tiles = wholeNumber(raw.tiles, 'tiles', 8, 16, 15);
  const stage = raw.stage;
  if (!STAGES.includes(stage)) throw new Error(`--stage must be one of ${STAGES.join(', ')}, got ${JSON.stringify(stage)}`);
  if (!raw['dry-run'] && !raw.out) throw new Error('--out=<json> is required');
  const secPerRun = raw['sec-per-run'] === undefined ? 6 : Number(raw['sec-per-run']);
  if (!Number.isFinite(secPerRun) || secPerRun <= 0) throw new Error('--sec-per-run must be a positive number');
  if (!raw['dry-run']) {
    if (!raw.parent) throw new Error('--parent=<dir> is required: every cell is measured beside the parent');
    if (!fs.existsSync(path.join(path.resolve(raw.parent), 'main/build/pipeline.js'))) throw new Error(`--parent ${JSON.stringify(raw.parent)} is not a project tree (no main/build/pipeline.js)`);
    assertRoom(jobs, running ?? countMesen());
  }
  return {
    stage, parent: raw.parent ? path.resolve(raw.parent) : null, out: raw.out ? path.resolve(raw.out) : null, jobs, tiles, dryRun: Boolean(raw['dry-run']), secPerRun,
    reuse: raw.reuse ? raw.reuse.split(',').map((f) => path.resolve(f)) : []
  };
}

/** The cells of one stage. `withParent` doubles every cell onto the parent tree. */
export function planStage(stage, { tiles = 15, withParent = true } = {}) {
  const projects = [];
  for (const gt of ['action', 'rpg']) for (const wide of [true, false]) projects.push({ gt, wide });
  const cells = [];
  const add = (c) => { for (const which of withParent ? ['new', 'parent'] : ['new']) cells.push({ touchY: 60, lead: 'none', anim: 'P1', bound: false, pop: 'many-small', ...c, which }); };
  if (stage === 'phase') {
    for (const p of projects) for (const tail of TAIL_NAMES) for (const dist of PHASE_DISTS) add({ ...p, tail, dist });
  } else if (stage === 'coincide') {
    if (!COINCIDENCE_CELLS.length) throw new Error('COINCIDENCE_CELLS is empty: run the pilot (handoff-next/s3a/fix1) and record the arrangements first');
    for (const p of projects) for (const tail of TAIL_NAMES) for (const k of COINCIDENCE_CELLS) add({ ...p, tail, lead: 'flash', dist: k.dist, touchY: k.touchY, kind: k.kind });
  } else if (stage === 'pops') {
    for (const p of projects) for (const bound of [false, true]) for (const pop of Object.keys(populations(bound ? tiles - 1 : tiles))) for (const tail of TAIL_NAMES) {
      for (const dist of WORST_DISTS[`${p.gt}/${tail}`] ?? PHASE_DISTS.slice(0, 1)) add({ ...p, bound, pop, tail, dist });
      for (const k of COINCIDENCE_CELLS) add({ ...p, bound, pop, tail, lead: 'flash', dist: k.dist, touchY: k.touchY, kind: k.kind });
    }
  } else if (stage === 'anims') {
    for (const p of projects) for (const pop of ['many-small', 'few-large-1', 'back']) for (const tail of TAIL_NAMES) for (const dist of WORST_DISTS[`${p.gt}/${tail}`] ?? PHASE_DISTS.slice(0, 1)) add({ ...p, anim: 'P8', pop, tail, dist });
  } else if (stage === 'lead') {
    // the text-box Move (close-for-Move): a Say before the Move, no tail -- only its pre-Move close bodies are exempt from the gate; its step and final bodies are gated
    for (const p of projects) for (const dist of [150, 157, 164, 200]) add({ ...p, lead: 'say', tail: 'none', dist });
  } else throw new Error(`unknown stage ${stage}`);
  const seen = new Set();
  for (const c of cells) { const id = cellId(c); if (seen.has(id)) throw new Error(`the plan lists ${id} twice`); seen.add(id); }
  return cells;
}

export const estimateMinutes = (cells, jobs, secPerRun) => (cells.length * secPerRun) / jobs / 60;

/** Runs every cell through `measure(cell) -> {summary}` on a pool of `jobs` workers; one result per planned cell, errors captured, never thrown. */
export async function runCampaign({ cells, measure, jobs, onProgress = () => {}, onResult = () => {} }) {
  if (!isInt(jobs) || jobs < 1) throw new Error(`jobs must be a positive whole number, got ${jobs}`);
  if (jobs > MACHINE_CEILING) throw new Error(`jobs ${jobs} exceeds the machine ceiling of ${MACHINE_CEILING}`);
  const out = [];
  let next = 0;
  let done = 0;
  async function worker() {
    for (;;) {
      const c = cells[next++];
      if (!c) return;
      try {
        const { summary } = await measure(c);
        out.push({ id: c.id ?? cellId(c), cell: c, summary });
      } catch (e) {
        out.push({ id: c.id ?? cellId(c), cell: c, error: String(e?.message ?? e).slice(0, 300) });
      }
      onResult(out[out.length - 1]);
      onProgress(++done, cells.length);
    }
  }
  await Promise.all(Array.from({ length: jobs }, worker));
  return out;
}

/**
 * A capacity refusal is the generator's plain-language answer that a project of this shape cannot be built ("need 168 bytes but only 160 are
 * free", "need 60 of the 59 8 KB program regions ... has free"). It is RECORDED in the verdict but it never discharges a workload obligation: the
 * refused arrangement may be reachable in another encoding (review 2: the RPG + bound tile + Flash scenes build once their duplicate and unplaced
 * actor definitions are shared, test/lua/sw_compact_actors.mjs). So a NEW-engine refusal fails unless it is one of the explicitly approved 74 cells with its matching parent refusal; a PARENT exclusion beside a
 * measured new-engine cell only means there is no parent baseline for it (`parentUnavailable`, visible, never claimed as a measured baseline).
 */
export const isCapacityRefusal = (msg) => /\bneeds? \d+ .*\b(free|has free|have)\b/s.test(String(msg ?? ''));

/**
 * Chris's ruling (2026-10-02, after review 2): these arrangements are UNREACHABLE and are accepted as exclusions, visibly -- never as measurements.
 * An RPG project with wide art, a switch-bound tile (so 14 tiles), a Flash command and the P1 animations needs more lookup-table bytes than the
 * 160 free, with the actors and animations already shared (sw_compact_actors.mjs): few-large-1 needs 165 and few-large-3 needs 163, and the generator
 * refuses both on the new engine AND the parent (the parent has 126 free). The bytes are the art itself, so no content-only change helps.
 * This table is the whole rule: a different population, art, animation, byte figure, free figure or tile count is not covered by it, so the
 * strict policy (a refusal never discharges coverage) applies to everything else unchanged.
 */
export const UNREACHABLE_ARRANGEMENTS = { 'few-large-1': 165, 'few-large-3': 163 };
export const UNREACHABLE_FREE = 160;
const approvedUnreachableIds = new Set(JSON.parse(fs.readFileSync(path.join(REPO, 'test/fixtures/streamedmove-unreachable.json'), 'utf8')).refused.map((r) => r.id));

const refusalNeed = (reason) => { const m = /lookup tables need (\d+) bytes but only (\d+) are free/.exec(String(reason)); return m ? { need: Number(m[1]), free: Number(m[2]) } : null; };

/** Whether the new-engine cell `c`, refused with `reason` beside a parent refused with `partnerReason`, is one of the accepted unreachable arrangements. */
export function acceptedUnreachable(c, reason, partnerReason) {
  if (c.which !== 'new' || c.gt !== 'rpg' || !c.wide || !c.bound || !needsCompact(c) || c.anim !== 'P1') return false;
  const want = UNREACHABLE_ARRANGEMENTS[c.pop];
  const a = refusalNeed(reason);
  const b = refusalNeed(partnerReason);
  return approvedUnreachableIds.has(cellId(c)) && want !== undefined && Boolean(a) && Boolean(b) && a.need === want && a.free === UNREACHABLE_FREE && b.need === want && b.free === 126;
}

/**
 * The verdict of a campaign: `ok` only when every planned cell has exactly one sound result, at least one cell was measured, no new-engine cell is
 * a capacity exclusion and no gated row is over the gate. problems = [{ id, problem }]. `gate` is injectable so a test can inject an over-gate row
 * without a 30,000-cycle figure.
 */
export function verdict(results, planned, { gate = GATE } = {}) {
  const problems = [];
  const bad = (id, problem) => problems.push({ id, problem });
  if (!planned.length) bad('(plan)', 'the plan is empty: nothing was measured');
  const want = new Map(planned.map((c) => [cellId(c), c]));
  const seen = new Map();
  for (const r of results) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
  for (const [id] of want) if (!seen.has(id)) bad(id, 'no result for this planned cell');
  for (const [id, n] of seen) { if (!want.has(id)) bad(id, 'a result for a cell that was not planned'); else if (n > 1) bad(id, `${n} results for one planned cell`); }
  let rows = 0;
  let measured = 0;
  const excluded = [];
  for (const r of results) {
    const c = want.get(r.id);
    if (!c) continue;
    if (r.error) {
      if (isCapacityRefusal(r.error)) excluded.push({ id: r.id, side: c.which, reason: String(r.error).split('\n')[0].slice(0, 160) });
      else bad(r.id, `the measurement failed: ${r.error}`);
      continue;
    }
    if (!r.summary) { bad(r.id, 'the result carries no measurement'); continue; }
    const found = cellProblems(r.summary, c, { gate });
    for (const p of found) bad(r.id, p);
    if (!found.length) measured++;
    if (gated(c)) rows += 2;
  }
  const refused = new Set(excluded.map((e) => e.id));
  const c0 = (id) => want.get(id);
  const partnerOf = (id) => id.replace(/^(new|parent)\//, (_, w) => (w === 'new' ? 'parent/' : 'new/'));
  const parentUnavailable = [];
  const accepted = [];
  for (const e of excluded) {
    const partner = partnerOf(e.id);
    if (e.side === 'parent') {
      const mine = excluded.find((x) => x.id === partner);
      if (mine && acceptedUnreachable(want.get(partner), mine.reason, e.reason)) continue;
      if (!refused.has(partner)) parentUnavailable.push(e);
      continue;
    }
    const theirs = excluded.find((x) => x.id === partner);
    if (theirs && acceptedUnreachable(c0(e.id), e.reason, theirs.reason)) { accepted.push({ id: e.id, partner, reason: e.reason, ruling: 'unreachable: both engines refuse (Chris 2026-10-02)' }); continue; }
    if (want.has(partner) && !refused.has(partner) && seen.has(partner) && results.find((r) => r.id === partner)?.summary) bad(e.id, `the new engine refuses a project the parent builds: ${e.reason}`);
    else if (!refused.has(partner)) bad(e.id, `the new engine's capacity refusal has no matching parent refusal (the parent cell ${want.has(partner) ? 'is not refused' : 'is not planned'}): ${e.reason}`);
    bad(e.id, `required workload not measured: a capacity refusal does not discharge a coverage obligation (${e.reason})`);
  }
  if (planned.length && !measured) bad('(plan)', 'no cell was measured: every planned cell was excluded, failed or missing');
  return { ok: problems.length === 0, problems, excluded, accepted, parentUnavailable, results: results.length, planned: planned.length, measured, gatedRows: rows };
}

/** The report table: the worst G of each (game type, art, population, animation, bound, row class) on the new engine beside the parent's. */
export function aggregate(results) {
  const rows = new Map();
  for (const r of results) {
    if (!r.summary) continue;
    const c = r.cell;
    for (const [cls, v] of Object.entries(r.summary.classes ?? {})) {
      if (!/^(step|final)\./.test(cls)) continue;
      const row = cls.startsWith('step.') ? 'M11a' : 'M11b';
      const key = [c.gt, c.wide ? 'wide' : 'tight', c.pop, c.anim ?? 'P0', c.bound ? 'bound14' : 'plain', row, cls, c.lead === 'flash' ? 'flash-lead' : c.lead === 'say' ? 'say-lead' : 'no-lead'].join(' | ');
      const e = rows.get(key) ?? { key, new: 0, parent: 0, newCell: null, n: 0 };
      const side = c.which === 'new' ? 'new' : 'parent';
      if (v.maxG > e[side]) { e[side] = v.maxG; if (side === 'new') e.newCell = r.id; }
      if (side === 'new') e.n += v.n;
      rows.set(key, e);
    }
  }
  return [...rows.values()].map((e) => ({ ...e, delta: e.parent ? e.new - e.parent : null, margin: GATE - e.new })).sort((a, b) => b.new - a.new);
}

/** Earlier campaign files -> the successful result of each cell id (a later file overrides an earlier one; an errored result is never taken). */
export function loadReusable(files) {
  const byId = new Map();
  for (const f of files) {
    let data;
    try { data = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error(`--reuse ${f}: ${e.message}`); }
    if (!Array.isArray(data?.results)) throw new Error(`--reuse ${f}: no results array`);
    for (const r of data.results) if (r?.id && r.summary && !r.error) byId.set(r.id, r);
  }
  return byId;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  let opt;
  try { opt = parseOptions(process.argv.slice(2)); } catch (e) { console.error(`error: ${e.message}`); process.exit(2); }
  let cells;
  let reusable;
  try { cells = planStage(opt.stage, { tiles: opt.tiles, withParent: true }); reusable = loadReusable(opt.reuse); } catch (e) { console.error(`error: ${e.message}`); process.exit(2); }
  const reused = cells.filter((c) => reusable.has(cellId(c))).map((c) => reusable.get(cellId(c)));
  const todo = cells.filter((c) => !reusable.has(cellId(c)));
  console.error(`${opt.stage}: ${cells.length} cells (${reused.length} reused from ${opt.reuse.length} file(s), ${todo.length} to measure), ${opt.jobs} at a time, estimate ${estimateMinutes(todo, opt.jobs, opt.secPerRun).toFixed(1)} min at ${opt.secPerRun} s per run`);
  if (opt.dryRun) process.exit(0);
  const t0 = Date.now();
  // a long run is resumable: every 100 results the finished ones are written to <out>.partial, which `--reuse=<out>.partial` takes like any campaign file
  const finished = [];
  const fresh = await runCampaign({
    cells: todo, jobs: opt.jobs,
    measure: (c) => measureCell(c, { tiles: opt.tiles, root: c.which === 'new' ? REPO : opt.parent }),
    onResult: (r) => { finished.push(r); if (finished.length % 100 === 0) fs.writeFileSync(`${opt.out}.partial`, JSON.stringify({ stage: opt.stage, partial: true, results: finished })); },
    onProgress: (n, total) => { if (n % 50 === 0) console.error(`${n}/${total} ${Math.round((Date.now() - t0) / 1000)}s`); }
  });
  fs.rmSync(`${opt.out}.partial`, { force: true });
  const results = [...reused, ...fresh];
  const v = verdict(results, cells);
  fs.writeFileSync(opt.out, JSON.stringify({ gate: GATE, stage: opt.stage, tiles: opt.tiles, ms: Date.now() - t0, reuse: { files: opt.reuse, reused: reused.length, measured: fresh.length }, verdict: v, rows: aggregate(results), results }, null, 1));
  if (v.excluded.length) console.log(`${v.excluded.length} cells refused by the generator's capacity check (${v.accepted.length} new-engine accepted as unreachable by ruling, with their parent partners; ${v.excluded.filter((e) => e.side === 'new').length - v.accepted.length} other new-engine: each a problem; ${v.parentUnavailable.length} parent-only: no baseline, recorded)`);
  console.log(`${results.length} cells (${reused.length} reused, ${fresh.length} measured) in ${Math.round((Date.now() - t0) / 1000)} s; ${v.problems.length} problems over ${v.gatedRows} gated rows`);
  for (const p of v.problems.slice(0, 25)) console.log(`  ${p.id}: ${p.problem}`);
  process.exit(v.ok ? 0 : 1);
}
