// The rebuild check behind STREAM_TILE_BOUND's provenance (phase 3a slice S1, Chris's ruling of 2026-10-01): do the sweep's records still
// describe the ROMs the CURRENT generator (main/build/ + shared/) builds? Every record that ran Mesen is rebuilt, with no Mesen, by the
// sweep's own path (`runJob` with `prepareOnly`: the same scene builder, mutation, normalization and assembler that produced the record's
// `prov.project` and `prov.rom`), and the rebuilt project hash and ROM hash are compared with the recorded ones.
//
//   node test/lua/sw_rebuild_check.mjs [--dir=handoff-next/s1-a1/sweep] [--procs=20] [--mesen=<path>] [--json=out.json]
//        [--files=A.out,B.out,C.out,F.out,R.out] [--every=K]    (K and --procs: positive integers)
//
// What it certifies: a later change to main/build/ or shared/ that moves the generator hash but builds the identical project and the
// identical ROM for every job leaves the Mesen measurements valid (the ROM is what was measured). Engine, harness and Mesen hashes must
// equal the recorded ones (as `agg` requires); the generator hash is the one field allowed to differ, and both values are printed.
// A ROM that differs is NOT covered: that needs a re-sweep. A reuse record is not rebuilt: validateRows already requires its source
// record's project, ROM and measurement to equal its own, and the source is rebuilt. `--every=K` rebuilds every K-th record only (the
// negative controls); such a run is labelled PARTIAL and is never a certification (exit 3 when clean).
//
// Not one of HARNESS_FILES (sw_provenance.mjs): it is a certifier of the records, not part of what produced them.
// Exit 0 only when EVERY direct record was rebuilt (checked == the direct-record count, which is non-zero), every one was answered exactly once
// by a worker that exited cleanly, every one matched, and the engine/harness/Mesen hashes are the recorded ones. It fails closed: 1 on a
// mismatch, an error, a refusal, an unanswered/duplicate/dead-worker job or an empty workset; 2 on a malformed option (`--every`, `--procs`
// must be positive integers); 3 on a valid partial run that is otherwise clean.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPO } from './sw_manifest_scene.mjs';
import { MESEN_DEFAULT } from './run_sw_manifest.mjs';
import { runJob, validateRows, jobProvenanceProblems, isBad } from './sw_bound_sweep.mjs';
import { processProvenance, UNIFORM_FIELDS } from './sw_provenance.mjs';

const SELF = fileURLToPath(import.meta.url);
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === SELF;
const arg = (name, dflt) => { const a = process.argv.find((s) => s.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
const readLines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** The two hashes a rebuild must reproduce. Pure so a test can drive it with made-up records. */
export function compareHashes(rec, rebuilt) {
  const differs = [];
  if (rec.prov?.project !== rebuilt.project) differs.push('project');
  if (rec.prov?.rom !== rebuilt.rom) differs.push('rom');
  return differs;
}

/** `--every` / `--procs`: each, when present, exactly once as `--name=<positive integer>`; anything else (banana, 0, -1, 1.5, 1e3, empty, bare) throws. */
export function parseOptions(argv) {
  const out = { every: 1, procs: 20 };
  for (const name of ['every', 'procs']) {
    const hits = argv.filter((s) => s === `--${name}` || s.startsWith(`--${name}=`));
    if (hits.length === 0) continue;
    if (hits.length > 1) throw new Error(`--${name} given ${hits.length} times`);
    const raw = hits[0].slice(name.length + 3);
    if (!hits[0].startsWith(`--${name}=`) || !/^[1-9][0-9]{0,8}$/.test(raw)) throw new Error(`--${name} must be a positive integer (--${name}=N), got ${JSON.stringify(hits[0])}`);
    out[name] = Number(raw);
  }
  out.procs = Math.min(20, out.procs);
  return out;
}

/** Accounting for the workset: every id must get exactly one validated response, from the worker it was assigned to, and every worker must exit cleanly after being released. */
export function makeLedger(ids) {
  const expected = new Set(ids);
  if (expected.size !== ids.length) throw new Error('duplicate record ids in the workset');
  const owner = new Map(); const held = new Map(); const answered = new Map(); const released = new Set();
  const problems = []; const counts = { matched: 0, mismatched: 0, errored: 0 };
  return {
    assign(worker, id) {
      if (!expected.has(id)) problems.push(`job ${id} is not in the workset`);
      else if (owner.has(id)) problems.push(`job ${id} assigned twice`);
      else if (held.has(worker)) problems.push(`worker ${worker} given job ${id} while holding ${held.get(worker)}`);
      else { owner.set(id, worker); held.set(worker, id); }
    },
    /** kind: 'matched' | 'mismatched' | 'errored'. Returns whether the response counted. */
    respond(worker, id, kind) {
      if (!expected.has(id)) { problems.push(`worker ${worker} answered for unknown job ${JSON.stringify(id)}`); return false; }
      if (answered.has(id)) { problems.push(`duplicate response for job ${id}`); return false; }
      if (owner.get(id) !== worker) { problems.push(`job ${id} answered by worker ${worker}, assigned to ${owner.get(id) ?? 'nobody'}`); return false; }
      answered.set(id, kind); held.delete(worker); counts[kind]++;
      return true;
    },
    release(worker) { released.add(worker); },
    exit(worker, code, signal) {
      const how = signal ? `signal ${signal}` : `code ${code}`;
      if (held.has(worker)) problems.push(`worker ${worker} exited (${how}) holding unanswered job ${held.get(worker)}`);
      else if (code !== 0 || signal || !released.has(worker)) problems.push(`worker ${worker} exited unexpectedly (${how})`);
    },
    problem(text) { problems.push(text); },
    result() {
      const missing = ids.filter((id) => !answered.has(id));
      return { kinds: Object.fromEntries(answered), expected: ids.length, answered: answered.size, ...counts, missing, problems: problems.slice(), complete: missing.length === 0 && problems.length === 0 };
    },
  };
}

/** The verdict, from completed coverage only. exit: 1 not certified, 3 clean partial, 0 certified. */
export function certify({ every, directCount, result, drift = 0 }) {
  const why = [];
  if (directCount === 0) why.push('empty workset: there are no Mesen-run records to rebuild');
  if (result.problems.length) why.push(`${result.problems.length} worker/accounting problems`);
  if (result.missing.length) why.push(`${result.missing.length} jobs never answered`);
  if (result.mismatched) why.push(`${result.mismatched} mismatches`);
  if (result.errored) why.push(`${result.errored} errors`);
  if (drift) why.push('source drift during the check');
  if (result.matched !== result.expected || result.answered !== result.expected) why.push(`matched ${result.matched} / answered ${result.answered} != workset ${result.expected}`);
  const partial = every > 1;
  if (!partial && (result.expected !== directCount || result.matched !== directCount)) why.push(`checked ${result.matched} matched of ${result.expected}, not every one of ${directCount} direct records`);
  const exit = why.length ? 1 : partial ? 3 : 0;
  return { exit, why, label: exit === 3 ? `PARTIAL CHECK (--every=${every}), not a certification` : exit === 0 ? 'ALL MATCH: the recorded measurements stand for the current generator' : `NOT CERTIFIED (${why.join('; ')}): re-sweep the stages whose ROMs differ, or rerun the check` };
}

/** Classify one worker answer for `rec`: matched / mismatched (detail) / errored (detail). A reply with neither a usable prov nor an error string is an error. */
export function classifyResponse(rec, m) {
  if (m && typeof m.error === 'string') return { kind: 'errored', error: m.error };
  if (!m || typeof m.prov?.project !== 'string' || typeof m.prov?.rom !== 'string') return { kind: 'errored', error: 'malformed worker response (no prov.project/prov.rom)' };
  const differs = compareHashes(rec, m.prov);
  return differs.length ? { kind: 'mismatched', differs } : { kind: 'matched' };
}

/** Rebuild `todo` on a pool of worker processes. `worker` is {file, args}; the reply protocol is {ready}, then one {id, prov | error} per job. */
export function runPool(todo, { procs, worker, env, current = {}, progress = () => {} }) {
  const ledger = makeLedger(todo.map((r) => r.id));
  const byId = new Map(todo.map((r) => [r.id, r]));
  const mismatches = []; const errors = []; const drift = [];
  const queue = todo.slice(); let done = 0; let live = 0;
  return new Promise((resolve) => {
    const finish = () => { if (--live === 0) resolve({ result: ledger.result(), mismatches, errors, drift }); };
    for (let i = 0; i < Math.min(procs, todo.length); i++) {
      live++;
      const name = `w${i}`;
      const kid = fork(worker.file, worker.args, { env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      const send = (v) => { try { kid.send(v); } catch (e) { ledger.problem(`worker ${name}: send failed: ${String(e?.message ?? e).slice(0, 100)}`); } };
      const next = () => { const r = queue.shift(); if (r) { ledger.assign(name, r.id); send(r); } else { ledger.release(name); send('exit'); } };
      kid.on('message', (m) => {
        if (m?.ready) { next(); return; }
        const rec = byId.get(m?.id);
        const c = rec ? classifyResponse(rec, m) : { kind: 'errored', error: 'response for an unknown job' };
        if (!ledger.respond(name, m?.id, c.kind)) { kid.kill('SIGKILL'); return; } // not a counted answer: the ledger holds the problem, and a worker out of step is ended rather than fed
        if (c.kind === 'errored') errors.push({ id: m.id, stage: rec.stage, error: c.error });
        else if (c.kind === 'mismatched') mismatches.push({ id: m.id, stage: rec.stage, differs: c.differs, recorded: { project: rec.prov.project, rom: rec.prov.rom }, rebuilt: { project: m.prov.project, rom: m.prov.rom } });
        if (c.kind !== 'errored') {
          // the sources must have stayed what they were when the check started
          const moved = UNIFORM_FIELDS.filter((f) => m.prov[f] !== current[f]);
          if (moved.length) drift.push({ id: m.id, moved });
        }
        progress(++done, mismatches.length, errors.length);
        next();
      });
      kid.on('error', (e) => ledger.problem(`worker ${name}: ${String(e?.message ?? e).slice(0, 100)}`));
      kid.on('exit', (code, signal) => { ledger.exit(name, code, signal); finish(); });
    }
    if (todo.length === 0) resolve({ result: ledger.result(), mismatches, errors, drift });
  });
}

// ---- worker: one process, one rebuild at a time, answers over IPC ----------------------------------------------------------------
if (IS_MAIN && process.argv.includes('--worker')) {
  const mesen = arg('mesen', MESEN_DEFAULT);
  process.on('message', async (rec) => {
    if (rec === 'exit') process.exit(0);
    try {
      const r = await runJob({ ...rec, root: undefined }, { prepareOnly: true, mesen });
      process.send({ id: rec.id, prov: r.prov });
    } catch (e) { process.send({ id: rec.id, error: String(e?.message ?? e).slice(0, 400) }); }
  });
  process.send({ ready: true });
} else if (IS_MAIN) {
  await main();
}

async function main() {
  const t0 = Date.now();
  const dir = path.resolve(REPO, arg('dir', 'handoff-next/s1-a1/sweep'));
  const files = arg('files', 'A.out,B.out,C.out,F.out,R.out').split(',').map((f) => path.join(dir, f));
  let options;
  try { options = parseOptions(process.argv.slice(2)); } catch (e) { console.error(`usage error: ${e.message}`); process.exit(2); }
  const { procs, every } = options;
  const mesen = arg('mesen', MESEN_DEFAULT);
  const say = (m) => console.log(m);

  let all;
  try { all = validateRows(files.flatMap(readLines), files.join(', ')); } catch (e) { console.error(String(e.message ?? e)); process.exit(1); }
  const bad = all.filter(isBad);
  const confirms = all.filter((r) => r.confirmOf);
  const reuses = all.filter((r) => r.reuse);
  const direct = all.filter((r) => !r.reuse && !isBad(r));
  const todo = direct.filter((_, i) => i % every === 0);
  say(`records: ${all.length} ids (${direct.length} ran Mesen incl. ${confirms.length} confirmation re-runs, ${reuses.length} reuses of those, ${bad.length} bad)`);

  // provenance: uniform in the records, and engine/harness/mesen equal now
  const problems = [];
  if (bad.length) problems.push(`${bad.length} bad records`);
  problems.push(...jobProvenanceProblems(all.filter((r) => !isBad(r))));
  const recorded = all.find((r) => !isBad(r))?.prov ?? {};
  const current = processProvenance(REPO, mesen, { freshMesen: true });
  say('provenance (recorded | current):');
  for (const f of UNIFORM_FIELDS) {
    const same = recorded[f] === current[f];
    say(`  ${f.padEnd(9)} ${recorded[f]} | ${current[f]}  ${same ? 'equal' : f === 'generator' ? 'DIFFERS (the one field allowed to)' : 'DIFFERS (REFUSED)'}`);
    if (!same && f !== 'generator') problems.push(`${f} differs: recorded ${String(recorded[f]).slice(0, 12)}, now ${current[f].slice(0, 12)}`);
  }
  if (problems.length) { for (const p of problems) console.error(`REFUSED: ${p}`); process.exit(1); }

  // private temp base (the scene builder's mkdtemp goes under TMPDIR), always removed
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sw-rebuild-'));
  const cleanup = () => { try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ } };
  process.on('exit', cleanup);
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { cleanup(); process.exit(130); });

  const { result, mismatches, errors, drift } = await runPool(todo, {
    procs, worker: { file: SELF, args: ['--worker', `--mesen=${mesen}`] }, env: { ...process.env, TMPDIR: base }, current,
    progress: (done, mm, ee) => { if (done % 500 === 0) console.error(`  ${done}/${todo.length} ${((Date.now() - t0) / 1000).toFixed(0)}s, ${mm} mismatches, ${ee} errors`); },
  });

  say('');
  const matched = result.matched;
  for (const m of mismatches.slice(0, 200)) say(`MISMATCH ${m.stage} ${m.id}: ${m.differs.join('+')} differs (recorded ${m.differs.map((f) => `${f} ${m.recorded[f].slice(0, 12)}`).join(', ')}; rebuilt ${m.differs.map((f) => `${f} ${m.rebuilt[f].slice(0, 12)}`).join(', ')})`);
  if (mismatches.length > 200) say(`... and ${mismatches.length - 200} more mismatches`);
  for (const e of errors.slice(0, 50)) say(`ERROR ${e.stage} ${e.id}: ${e.error}`);
  for (const p of result.problems.slice(0, 50)) say(`PROBLEM ${p}`);
  if (result.missing.length) say(`UNANSWERED ${result.missing.length} jobs, first: ${result.missing.slice(0, 5).join(', ')}`);
  for (const d of drift.slice(0, 5)) say(`SOURCE DRIFT during the check at ${d.id}: ${d.moved.join(', ')}`);
  const byStage = {};
  for (const r of todo) {
    const s = (byStage[r.stage] ??= { checked: 0, matched: 0, mismatched: 0 }); const kind = result.kinds[r.id];
    if (kind) s.checked++; // answered
    if (kind === 'matched') s.matched++; else if (kind === 'mismatched') s.mismatched++;
  }
  say(`checked ${result.answered} of ${direct.length} Mesen-run records: ${matched} matched, ${mismatches.length} mismatched, ${errors.length} errors, ${result.answered} answered; ${reuses.length} reuse records covered by their sources`);
  say(`by stage: ${Object.entries(byStage).map(([s, v]) => `${s} ${v.matched}/${todo.filter((r) => r.stage === s).length}`).join(', ')}`);
  const wallSeconds = Math.round((Date.now() - t0) / 1000);
  say(`generator: recorded ${recorded.generator} -> current ${current.generator}; engine, harness and Mesen equal; wall ${wallSeconds}s`);
  const partial = every > 1;
  const verdict = certify({ every, directCount: direct.length, result, drift: drift.length });
  say(verdict.label);
  const jsonPath = arg('json', null);
  if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify({ ids: all.length, direct: direct.length, confirms: confirms.length, reuses: reuses.length, checked: result.answered, matched, answered: result.answered, problems: result.problems, mismatched: mismatches.length, errors: errors.length, byStage, recorded, current, partial, wallSeconds, mismatches: mismatches.slice(0, 200) }, null, 1) + '\n');
  process.exit(verdict.exit);
}
