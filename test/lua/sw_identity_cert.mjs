// The ROM-identity certificate (written in phase 3a slice S2 fix round 1 per Chris's ruling of 2026-10-01, review 1 section D; S2 was
// shelved and the certifier restored from its archive for slice S3a, adapted from "H-off S2" to "S3a engine" -- there is no handover).
//
// QUESTION. test/fixtures/streambound-curve.json is Mesen evidence for ONE engine (its fingerprint) and one generator. After S3a the engine SOURCE
// differs. The emulator executes ROM bytes, so the recorded measurements still stand for the current sources IF every measured ROM is rebuilt
// byte-identical, the measurement script and its symbol bindings are unchanged, and the harness and Mesen are the recorded ones.
// This certifier checks exactly that and, only on complete success, writes an immutable certificate that streamtilebound.test.js accepts in place of
// an exact fingerprint match. It is NOT a re-measurement, and it says nothing about a workload the sweep did not run (a streamed player Move, which
// S3a changes, is not one of the swept workloads -- that is WHY every swept ROM is expected identical) or any later change: a differing ROM needs a re-sweep.
//
//   node test/lua/sw_identity_cert.mjs [--dir=handoff-next/s1-a1/sweep] [--files=A.out,B.out,C.out,F.out,R.out]
//        [--curve=test/fixtures/streambound-curve.json] [--workers=N (1..12, default 12)] [--mesen=<path>]
//        [--out=test/fixtures/identity-cert/<name>.json]      written only after full coverage, never over an existing file
//        [--report=<file.json>]                               a JSON account of the run, certifying or not
//        [--limit=K | --shard=I/M]                            a PARTIAL run: never a certificate (exit 3 when clean)
//   test-only: CERT_SABOTAGE=kill-worker | flip-rom-byte | drift-binding   (proves the run fails closed; never writes a certificate)
//   node test/lua/sw_identity_cert.mjs --verify=<certificate.json>   revalidate a certificate against the live sources and, when the sweep's
//        stage files are present, against them too.
//
// What each of review 1 section D's six requirements maps to:
//  1 pins   the curve digest, every stage file's digest, the OLD engine/generator fingerprints (the curve's own), the CURRENT ones, the certifier
//           version and the scope; validates job schemas (validateRows), unique ids, stage coverage, a non-zero direct workset, confirmations
//           and the reuse graph (`buildWorkset`).
//  2 rebuilds EVERY direct record (confirmations included) with its complete original recipe on the current sources and compares the normalized
//           project and ROM SHA-256; the reuse records are resolved to their matched direct records, never counted as rebuilds.
//  3 accounts for each job once (makeLedger of sw_rebuild_check.mjs): one valid answer from its assigned worker; duplicate/unknown/missing
//           answers, a dead worker, a build error and a malformed reply fail; expected == answered == matched == directCount > 0; a partial run
//           is never success; a bad numeric option or an empty workset fails.
//  4 pins   the measurement bindings: harness and Mesen equal the recorded ones, the execution flags, and each job's effective RENDERED Lua is
//           re-derived and must reproduce the record's own cacheKey (the key hashes project, ROM, the rendered script with its symbol addresses,
//           the source state and the execution flags): a renamed or rebound symbol that moved an address the instrumentation reads fails it.
//  5 pins   the sources before, at every build (the build's own provenance) and after the run; any drift or mismatch is non-zero; the certificate
//           is written only after full coverage.
//  6 is test/unit/identitycert.test.js.
// Exit: 0 certified; 1 not certified (mismatch, error, drift, accounting, refused sources); 2 malformed option; 3 clean partial run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPO } from './sw_manifest_scene.mjs';
import { runManifest, SCENARIOS, MESEN_DEFAULT } from './run_sw_manifest.mjs';
import { ANIM_PRESETS, validateRows, jobProvenanceProblems, isBad } from './sw_bound_sweep.mjs';
import { makeMutate } from './sw_sweep_mutate.mjs';
import { processProvenance, UNIFORM_FIELDS, measurementKey, EXEC_FLAGS, harnessHash, generatorHash } from './sw_provenance.mjs';
import { makeLedger, compareHashes } from './sw_rebuild_check.mjs';
import { engineFingerprint } from '../lib/enginefingerprint.js';

export const CERTIFIER_VERSION = 1;
export const CERT_KIND = 'rom-identity-certificate';
export const STAGES = ['A', 'B', 'C', 'F', 'R'];
export const MAX_WORKERS = 12;
export const CURVE_REL = 'test/fixtures/streambound-curve.json';
export const CERT_DIR_REL = 'test/fixtures/identity-cert';
export const SCOPE = 'S3a engine: the recorded sweep (no streamHandover flag in any recorded job; S2 is shelved); every recorded Mesen-run job rebuilt byte-identical on the current engine and generator; measurement script and bindings unchanged';

const SELF = fileURLToPath(import.meta.url);
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === SELF;
const HEX64 = /^[0-9a-f]{64}$/;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sha256File = (f) => sha(fs.readFileSync(f));
const sortedDigest = (lines) => sha(lines.slice().sort().join('\n'));
const readLines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// ---- options -------------------------------------------------------------------------------------------------------------------
/** --workers=N, --limit=K, --shard=I/M: each at most once, exactly this shape; anything else (banana, 0, -1, 1.5, 1e3, empty, bare, I >= M) throws. */
export function parseOptions(argv) {
  const out = { workers: MAX_WORKERS, limit: null, shard: null };
  const once = (name) => {
    const hits = argv.filter((s) => s === `--${name}` || s.startsWith(`--${name}=`));
    if (hits.length > 1) throw new Error(`--${name} given ${hits.length} times`);
    if (!hits.length) return null;
    if (!hits[0].startsWith(`--${name}=`)) throw new Error(`--${name} needs a value (--${name}=...), got ${JSON.stringify(hits[0])}`);
    return hits[0].slice(name.length + 3);
  };
  const pos = (name, raw) => { if (!/^[1-9][0-9]{0,8}$/.test(raw)) throw new Error(`--${name} must be a positive integer, got ${JSON.stringify(raw)}`); return Number(raw); };
  const w = once('workers'); if (w !== null) out.workers = Math.min(MAX_WORKERS, pos('workers', w));
  const l = once('limit'); if (l !== null) out.limit = pos('limit', l);
  const s = once('shard');
  if (s !== null) {
    const m = /^(0|[1-9][0-9]{0,5})\/([1-9][0-9]{0,5})$/.exec(s);
    if (!m || Number(m[1]) >= Number(m[2])) throw new Error(`--shard must be I/M with 0 <= I < M, got ${JSON.stringify(s)}`);
    out.shard = { index: Number(m[1]), of: Number(m[2]) };
  }
  if (out.limit !== null && out.shard) throw new Error('--limit and --shard are alternatives');
  return out;
}

// ---- the workset ---------------------------------------------------------------------------------------------------------------
/**
 * The workset of validated, one-per-id records: the direct records (ran Mesen, including confirmation re-runs) that must each be rebuilt, the reuse
 * records that must resolve to a matched direct record, and the digests that pin both. `problems` is non-empty when the records are not a usable
 * workset (the caller refuses). `curve` is the parsed curve fixture; `stageInfo` ({A: {sha256, lines}, ...}) the digests of the files read.
 */
export function buildWorkset(all, { curve, stages = STAGES, stageInfo = null }) {
  const problems = [];
  const bad = all.filter(isBad);
  const reuses = all.filter((r) => !isBad(r) && r.reuse);
  const direct = all.filter((r) => !isBad(r) && !r.reuse);
  const confirms = direct.filter((r) => r.confirmOf);
  if (bad.length) problems.push(`${bad.length} bad (unusable) records`);
  if (direct.length === 0) problems.push('empty workset: there are no Mesen-run records to rebuild');
  const ids = new Set();
  for (const r of all) { if (ids.has(r.id)) problems.push(`duplicate record id ${r.id}`); ids.add(r.id); }
  problems.push(...jobProvenanceProblems(all.filter((r) => !isBad(r))));
  for (const r of direct) {
    if (!HEX64.test(r.prov?.project ?? '') || !HEX64.test(r.prov?.rom ?? '')) problems.push(`${r.id}: no recorded project/ROM hash`);
    if (!HEX64.test(r.cacheKey ?? '')) problems.push(`${r.id}: no recorded cacheKey (the measurement binding cannot be checked)`);
    if (/andover/i.test(JSON.stringify([r.cfg, r.tag, r.shape, r.scenario]))) problems.push(`${r.id}: a handover job is outside the certified scope`);
  }
  // stage coverage: every expected stage has records, and no record names another stage
  const perStage = Object.fromEntries(stages.map((s) => [s, 0]));
  for (const r of all) { if (r.stage in perStage) perStage[r.stage]++; else problems.push(`${r.id}: stage ${JSON.stringify(r.stage)} is not one of ${stages.join(',')}`); }
  for (const s of stages) if (!perStage[s]) problems.push(`stage ${s} has no records`);
  // the reuse graph: each reuse resolves to a DIRECT record with the same key, project, ROM and measurement
  const directById = new Map(direct.map((r) => [r.id, r]));
  for (const r of reuses) {
    const src = directById.get(r.reuse?.of);
    if (!src) problems.push(`${r.id}: reuse source ${r.reuse?.of} is not a direct record`);
    else if (!(src.cacheKey === r.cacheKey && r.reuse.key === r.cacheKey && src.prov.project === r.prov?.project && src.prov.rom === r.prov?.rom && JSON.stringify(src.phases) === JSON.stringify(r.phases))) problems.push(`${r.id}: reuse of ${src.id} does not match its key, project, ROM or measurement`);
  }
  // the curve's own counts
  if (curve) {
    if (direct.length !== curve.jobs - curve.reused + curve.confirms) problems.push(`direct records ${direct.length} != curve jobs ${curve.jobs} - reused ${curve.reused} + confirms ${curve.confirms}`);
    if (reuses.length !== curve.reused) problems.push(`reuse records ${reuses.length} != curve.reused ${curve.reused}`);
    if (confirms.length !== curve.confirms) problems.push(`confirmation records ${confirms.length} != curve.confirms ${curve.confirms}`);
    const first = all.find((r) => !isBad(r))?.prov;
    for (const f of UNIFORM_FIELDS) if (first && first[f] !== curve.provenance?.[f]) problems.push(`records' ${f} is not the curve's recorded one`);
  }
  const directDigest = sortedDigest(direct.map((r) => `${r.id}|${r.prov.project}|${r.prov.rom}|${r.cacheKey}`));
  const reuseDigest = sortedDigest(reuses.map((r) => `${r.id}|${r.reuse?.of}|${r.reuse?.key}|${r.prov?.project}|${r.prov?.rom}`));
  return { all, direct, reuses, confirms, bad, perStage, directDigest, reuseDigest, stageInfo, problems };
}

// ---- one answer ----------------------------------------------------------------------------------------------------------------
const isHex = (v) => typeof v === 'string' && HEX64.test(v);
/**
 * Classify one worker answer for `rec` against the record: matched, or mismatched with the fields that differ (project, rom, romfile, binding),
 * or errored. The binding check re-derives the record's own cacheKey from the REBUILT effective script digest: it reproduces only when the rendered
 * Lua (phases, marks and every symbol address it reads) and the execution flags are what they were when the measurement was taken.
 */
export function classifyAnswer(rec, m) {
  if (m && typeof m.error === 'string') return { kind: 'errored', error: m.error };
  if (!m || !isHex(m.prov?.project) || !isHex(m.prov?.rom) || !isHex(m.lua) || !isHex(m.romFile)) return { kind: 'errored', error: 'malformed worker response (project, rom, rendered-script digest and ROM-file digest are required)' };
  const differs = compareHashes(rec, m.prov);
  if (m.romFile !== rec.prov.rom) differs.push('romfile');
  const key = measurementKey({ project: rec.prov.project, rom: rec.prov.rom, lua: m.lua, prov: rec.prov, flags: EXEC_FLAGS });
  if (key !== rec.cacheKey) differs.push('binding');
  return differs.length ? { kind: 'mismatched', differs } : { kind: 'matched' };
}

/** Rebuild `todo` on forked workers. The worker protocol: {ready}, then one {id, prov, lua, romFile, sym} or {id, error} per job given. */
export function runPool(todo, { workers, worker, env, current, progress = () => {} }) {
  const ledger = makeLedger(todo.map((r) => r.id));
  const byId = new Map(todo.map((r) => [r.id, r]));
  const mismatches = []; const errors = []; const drift = []; const luaOf = new Map(); const symOf = new Map();
  const queue = todo.slice(); let done = 0; let live = 0;
  return new Promise((resolve) => {
    const out = () => ({ result: ledger.result(), mismatches, errors, drift, luaOf, symOf });
    const finish = () => { if (--live === 0) resolve(out()); };
    for (let i = 0; i < Math.min(workers, todo.length); i++) {
      live++;
      const name = `w${i}`;
      const kid = fork(worker.file, [...worker.args, `--index=${i}`], { env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      const send = (v) => { try { kid.send(v); } catch (e) { ledger.problem(`worker ${name}: send failed: ${String(e?.message ?? e).slice(0, 100)}`); } };
      const next = () => { const r = queue.shift(); if (r) { ledger.assign(name, r.id); send(r); } else { ledger.release(name); send('exit'); } };
      kid.on('message', (m) => {
        if (m?.ready) { next(); return; }
        const rec = byId.get(m?.id);
        const c = rec ? classifyAnswer(rec, m) : { kind: 'errored', error: 'response for an unknown job' };
        if (!ledger.respond(name, m?.id, c.kind)) { kid.kill('SIGKILL'); return; } // not a counted answer: the ledger holds the problem
        if (c.kind === 'errored') errors.push({ id: m.id, stage: rec.stage, error: c.error });
        else {
          if (c.kind === 'mismatched') mismatches.push({ id: m.id, stage: rec.stage, differs: c.differs, recorded: { project: rec.prov.project, rom: rec.prov.rom }, rebuilt: { project: m.prov.project, rom: m.prov.rom, romFile: m.romFile } });
          luaOf.set(m.id, m.lua); if (typeof m.sym === 'string') symOf.set(m.id, m.sym);
          const moved = UNIFORM_FIELDS.filter((f) => m.prov[f] !== current[f]); // the build's own source state, at THIS build
          if (moved.length) drift.push({ id: m.id, moved });
        }
        progress(++done, mismatches.length, errors.length);
        next();
      });
      kid.on('error', (e) => ledger.problem(`worker ${name}: ${String(e?.message ?? e).slice(0, 100)}`));
      kid.on('exit', (code, signal) => { ledger.exit(name, code, signal); finish(); });
    }
    if (todo.length === 0) resolve(out());
  });
}

// ---- the verdict ---------------------------------------------------------------------------------------------------------------
/**
 * Success is complete, disjoint, clean coverage only: expected == answered == matched == directCount > 0, no accounting problems, no mismatch, error,
 * source drift or stage-file/curve drift, and not a partial or sabotaged run. exit: 1 not certified, 3 clean partial, 0 certified.
 */
export function verdictOf({ directCount, partial, result, drift = 0, sourceProblems = [], sabotage = null, reuseProblems = [] }) {
  const why = [];
  if (!(directCount > 0)) why.push('empty workset: there are no Mesen-run records to rebuild');
  if (result.problems.length) why.push(`${result.problems.length} worker/accounting problems`);
  if (result.missing.length) why.push(`${result.missing.length} jobs never answered`);
  if (result.mismatched) why.push(`${result.mismatched} mismatches`);
  if (result.errored) why.push(`${result.errored} errors`);
  if (drift) why.push(`source drift at ${drift} builds`);
  for (const p of sourceProblems) why.push(p);
  for (const p of reuseProblems) why.push(p);
  if (result.matched !== result.expected || result.answered !== result.expected) why.push(`matched ${result.matched} / answered ${result.answered} != workset ${result.expected}`);
  if (!partial && (result.expected !== directCount || result.matched !== directCount)) why.push(`checked ${result.matched} matched of ${result.expected}, not every one of ${directCount} direct records`);
  if (sabotage) why.push(`CERT_SABOTAGE=${sabotage} is set: a sabotaged run is never a certification`);
  const exit = why.length ? 1 : partial ? 3 : 0;
  return { exit, why, label: exit === 0 ? 'CERTIFIED: every recorded Mesen-run job rebuilds to the identical project and ROM, and the measurement bindings reproduce' : exit === 3 ? 'PARTIAL CHECK, not a certification' : `NOT CERTIFIED (${why.join('; ')})` };
}

// ---- the certificate -----------------------------------------------------------------------------------------------------------
/** The seal: the digest of every field but `selfDigest`, key order fixed by the writer (a later edit of any field breaks it). */
export const sealOf = (cert) => { const { selfDigest, ...rest } = cert; return sha(JSON.stringify(rest)); };

export function buildCertificate({ workset, curve, curveFile, curveDigest, stageInfo, current, recordedProv, before, after, result, luaOf, symOf, workers, date = new Date().toISOString().slice(0, 10) }) {
  const luaDigest = sortedDigest([...luaOf].map(([id, l]) => `${id}|${l}`));
  const symDigest = sortedDigest([...symOf].map(([id, l]) => `${id}|${l}`));
  const cert = {
    kind: CERT_KIND,
    version: 1,
    certifier: { name: 'test/lua/sw_identity_cert.mjs', version: CERTIFIER_VERSION, sha256: sha256File(SELF) },
    scope: SCOPE,
    date,
    partial: false,
    curve: { file: curveFile, sha256: curveDigest, jobs: curve.jobs, reused: curve.reused, confirms: curve.confirms, provenance: { ...curve.provenance } },
    stages: stageInfo,
    fingerprints: {
      old: { engine: recordedProv.engine, generator: recordedProv.generator },
      current: { engine: current.engine, generator: current.generator }
    },
    harness: recordedProv.harness,
    mesen: recordedProv.mesen,
    execFlags: EXEC_FLAGS,
    counts: { expected: result.expected, answered: result.answered, matched: result.matched, mismatched: result.mismatched, errored: result.errored, directCount: workset.direct.length, reuseCount: workset.reuses.length, confirms: workset.confirms.length, reusesResolved: workset.reuses.length, keysReproduced: luaOf.size },
    directDigest: workset.directDigest,
    reuseDigest: workset.reuseDigest,
    bindings: { luaDigest, symDigest, distinctScripts: new Set(luaOf.values()).size, distinctSymbolTables: new Set(symOf.values()).size },
    sources: { before, after },
    workers
  };
  cert.selfDigest = sealOf(cert);
  return cert;
}

/**
 * The problems that stop `cert` from certifying the checked-in curve for the sources in `live` ({engine, generator, harness}); [] = valid.
 * `curveBytes` are the bytes of the checked-in curve file. Pure: a unit test drives it with made-up certificates and sources.
 */
export function validateCertificate(cert, { curve, curveBytes, live }) {
  const p = [];
  const need = (ok, msg) => { if (!ok) p.push(msg); };
  if (!cert || typeof cert !== 'object') return ['not an object'];
  need(cert.kind === CERT_KIND && cert.version === 1, 'not a version-1 rom-identity certificate');
  need(cert.certifier?.version === CERTIFIER_VERSION, `produced by certifier version ${cert.certifier?.version}, this is ${CERTIFIER_VERSION}`);
  need(cert.selfDigest === sealOf(cert), 'the seal does not match the contents (the certificate was edited)');
  need(cert.scope === SCOPE, 'the scope is not this certifier\'s scope');
  need(cert.partial === false, 'a partial run is not a certificate');
  const c = cert.counts ?? {};
  need(Number.isInteger(c.directCount) && c.directCount > 0, 'no direct records');
  need(c.expected === c.directCount && c.answered === c.directCount && c.matched === c.directCount, `expected ${c.expected} / answered ${c.answered} / matched ${c.matched} / directCount ${c.directCount} are not all equal`);
  need(c.mismatched === 0 && c.errored === 0, 'mismatches or errors recorded');
  need(c.keysReproduced === c.directCount, 'not every job reproduced its recorded measurement key');
  need(cert.directDigest && HEX64.test(cert.directDigest) && HEX64.test(cert.reuseDigest ?? ''), 'direct/reuse digests missing');
  need(c.reusesResolved === c.reuseCount, 'a reuse record was not resolved');
  // the curve it is for
  need(cert.curve?.sha256 === sha(curveBytes), 'the pinned curve digest is not the checked-in curve');
  need(c.directCount === curve.jobs - curve.reused + curve.confirms && c.reuseCount === curve.reused && c.confirms === curve.confirms, 'the counts are not the curve\'s own job/reuse/confirmation counts');
  for (const f of UNIFORM_FIELDS) need(cert.curve?.provenance?.[f] === curve.provenance[f], `the pinned curve provenance.${f} differs from the curve`);
  need(cert.fingerprints?.old?.engine === curve.provenance.engine && cert.fingerprints.old.engine === curve.engine?.sha256, 'the OLD engine fingerprint is not the curve\'s');
  need(cert.fingerprints?.old?.generator === curve.provenance.generator, 'the OLD generator fingerprint is not the curve\'s');
  need(cert.harness === curve.provenance.harness && cert.mesen === curve.provenance.mesen, 'harness or Mesen differs from the curve\'s recorded ones');
  // the CURRENT sources it was taken on must be the live ones
  need(cert.fingerprints?.current?.engine === live.engine, 'the certificate\'s current engine fingerprint is not the live engine');
  need(cert.fingerprints?.current?.generator === live.generator, 'the certificate\'s current generator fingerprint is not the live generator');
  if (live.harness !== undefined) need(cert.harness === live.harness, 'the live harness is not the certified one');
  need(JSON.stringify(cert.execFlags) === JSON.stringify(EXEC_FLAGS), 'the execution flags are not the live ones');
  const b = cert.sources?.before; const a = cert.sources?.after;
  need(b && a && UNIFORM_FIELDS.every((f) => b[f] === a[f]), 'the sources moved during the run');
  need(b?.engine === cert.fingerprints?.current?.engine && b?.generator === cert.fingerprints?.current?.generator, 'the run\'s sources are not the certificate\'s current fingerprints');
  need(cert.bindings && HEX64.test(cert.bindings.luaDigest ?? '') && cert.bindings.distinctScripts > 0, 'no measurement-binding evidence');
  for (const s of STAGES) need(HEX64.test(cert.stages?.[s]?.sha256 ?? '') && cert.stages[s].lines > 0, `stage ${s} digest missing`);
  return p;
}

/** The certificates in `dir`, each with its problems for the live sources: [{file, problems}]. */
export function checkCertificates(dir, ctx) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    let cert; try { cert = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return { file: f, problems: [`unreadable: ${e.message}`] }; }
    return { file: f, problems: validateCertificate(cert, ctx) };
  });
}

/**
 * What streamtilebound.test.js asks of the curve's provenance: is the checked-in curve's Mesen evidence valid for the LIVE sources? Yes, if the live
 * engine AND the live generator fingerprints are both exactly the ones the curve recorded (nothing changed), or if some certificate in `verdicts`
 * ([{file, problems}] from checkCertificates) is valid for the live fingerprints. The exact-match branch checks BOTH: review 2 finding 2 found a
 * consumer that returned on an equal engine alone, accepting the original engine with an arbitrarily changed generator.
 */
export function curveEvidenceVerdict({ curve, live, verdicts }) {
  const engine = live.engine === curve.engine?.sha256 && live.engine === curve.provenance?.engine;
  const generator = live.generator === curve.provenance?.generator;
  if (engine && generator) return { ok: true, via: 'exact', why: [] };
  const valid = verdicts.find((v) => v.problems.length === 0);
  if (valid) return { ok: true, via: `certificate ${valid.file}`, why: [] };
  const why = [];
  if (!engine) why.push('the live engine is not the recorded one');
  if (!generator) why.push('the live generator is not the recorded one');
  return { ok: false, via: null, why };
}

/** The live sources a certificate is read against (what the consumer test needs; no Mesen). */
export const liveSources = (root = REPO) => ({ engine: engineFingerprint(root).sha256, generator: generatorHash(root), harness: harnessHash(REPO) });

// ---- the worker: one rebuild at a time, no Mesen ---------------------------------------------------------------------------------
async function rebuildOne(rec, { mesen, base, sabotage, index, count }) {
  const ph = structuredClone(SCENARIOS[rec.scenario ?? 'walk']);
  for (const p of ph) if (p.trace) p.trace = false;
  if (rec.idle) ph.splice(1, 0, { name: 'idle', frames: rec.idle });
  const cfg = rec.cfg ? structuredClone(rec.cfg) : null;
  const dir = await fs.promises.mkdtemp(path.join(base, 'cert-'));
  try {
    // the sweep's own arguments (sw_bound_sweep.mjs runJob), with a kept output folder so the effective rendered script can be read back; if these
    // arguments ever drifted from the original recipe the record's cacheKey would not reproduce (classifyAnswer), so the check is self-validating
    const r = await runManifest({
      gt: rec.gt, sizes: rec.sizes, wide: !!rec.wide, scenario: rec.scenario ?? 'walk', phases: ph,
      flashAt: rec.y !== null && rec.y !== undefined ? [rec.flashX ?? 242, rec.y] : (cfg ? [242, 234] : null),
      anim: ANIM_PRESETS[rec.anim ?? 'P0'], root: rec.root, ...(rec.gridH ? { gridH: rec.gridH } : {}), mutate: cfg ? makeMutate(cfg) : null,
      expect: null, cache: null, prepareOnly: true, jobId: rec.id, waitInflight: true, mesen, outDir: dir
    });
    const romPath = path.join(dir, 'scene.nes');
    if (sabotage === 'flip-rom-byte' && index === 0 && count === 1) { const b = fs.readFileSync(romPath); b[b.length >> 1] ^= 1; fs.writeFileSync(romPath, b); }
    const luaText = fs.readFileSync(path.join(dir, 'manifest.lua'), 'utf8');
    let lua = sha(luaText);
    if (sabotage === 'drift-binding' && index === 0 && count === 1) lua = sha(luaText + '\n-- a rebound symbol');
    const symLine = /^local SYM = .*$/m.exec(luaText)?.[0] ?? '';
    return { id: rec.id, prov: r.prov, lua, romFile: sha(fs.readFileSync(romPath)), sym: sha(symLine) };
  } finally { await fs.promises.rm(dir, { recursive: true, force: true }); }
}

if (IS_MAIN && process.argv.includes('--worker')) {
  const arg = (n, d) => { const a = process.argv.find((s) => s.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
  const mesen = arg('mesen', MESEN_DEFAULT); const index = Number(arg('index', '0'));
  const sabotage = process.env.CERT_SABOTAGE || null; const base = process.env.TMPDIR || os.tmpdir(); let count = 0;
  process.on('message', async (rec) => {
    if (rec === 'exit') process.exit(0);
    count++;
    if (sabotage === 'kill-worker' && index === 0 && count === 1) process.kill(process.pid, 'SIGKILL');
    try { process.send(await rebuildOne(rec, { mesen, base, sabotage, index, count })); } catch (e) { process.send({ id: rec.id, error: String(e?.message ?? e).slice(0, 400) }); }
  });
  process.send({ ready: true });
} else if (IS_MAIN) {
  await main();
}

// ---- the CLI -------------------------------------------------------------------------------------------------------------------
function pinFiles(dir, files, curvePath) {
  const stageInfo = {};
  files.forEach((f, i) => { const file = path.join(dir, f); stageInfo[STAGES[i] ?? f] = { file: path.relative(REPO, file), sha256: sha256File(file), lines: fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length }; });
  return { stageInfo, curveDigest: sha256File(curvePath) };
}

async function main() {
  const t0 = Date.now();
  const arg = (n, d) => { const a = process.argv.find((s) => s.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
  const say = (m) => console.log(m);
  const verifyPath = arg('verify', null);
  const curvePath = path.resolve(REPO, arg('curve', CURVE_REL));
  if (verifyPath) {
    const cert = JSON.parse(fs.readFileSync(path.resolve(verifyPath), 'utf8'));
    const curveBytes = fs.readFileSync(curvePath);
    const problems = validateCertificate(cert, { curve: JSON.parse(curveBytes), curveBytes, live: liveSources() });
    for (const m of problems) console.error(`INVALID: ${m}`);
    say(problems.length ? 'certificate INVALID for the live sources' : 'certificate valid for the live sources');
    process.exit(problems.length ? 1 : 0);
  }
  let options;
  try { options = parseOptions(process.argv.slice(2)); } catch (e) { console.error(`usage error: ${e.message}`); process.exit(2); }
  const dir = path.resolve(REPO, arg('dir', 'handoff-next/s1-a1/sweep'));
  const fileNames = arg('files', STAGES.map((s) => `${s}.out`).join(',')).split(',');
  if (fileNames.length !== STAGES.length) { console.error(`usage error: --files must name the ${STAGES.length} stage files in order ${STAGES.join(',')}`); process.exit(2); }
  const files = fileNames.map((f) => path.join(dir, f));
  const mesen = arg('mesen', MESEN_DEFAULT);
  const outPath = arg('out', null); const reportPath = arg('report', null);
  const sabotage = process.env.CERT_SABOTAGE || null;
  const partial = options.limit !== null || options.shard !== null;
  if (outPath && partial) { console.error('usage error: a partial run (--limit/--shard) never writes a certificate; drop --out'); process.exit(2); }
  if (outPath && fs.existsSync(path.resolve(REPO, outPath))) { console.error(`REFUSED: ${outPath} exists; certificates are immutable and are never overwritten`); process.exit(1); }

  const report = { certifier: CERTIFIER_VERSION, partial, sabotage, options };
  const fail = (code, ...msgs) => { for (const m of msgs) console.error(m); if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ ...report, exit: code, messages: msgs }, null, 1) + '\n'); process.exit(code); };

  // 1. pin and validate
  let curve; let pinned; let workset;
  try {
    curve = JSON.parse(fs.readFileSync(curvePath, 'utf8'));
    pinned = pinFiles(dir, fileNames, curvePath);
    workset = buildWorkset(validateRows(files.flatMap(readLines), files.join(', ')), { curve, stageInfo: pinned.stageInfo });
  } catch (e) { fail(1, `REFUSED: ${String(e.message ?? e)}`); }
  if (workset.problems.length) fail(1, ...workset.problems.slice(0, 40).map((m) => `REFUSED: ${m}`));
  const recordedProv = workset.all.find((r) => !isBad(r)).prov;
  const before = processProvenance(REPO, mesen, { freshMesen: true });
  say(`records: ${workset.all.length} ids = ${workset.direct.length} direct (incl. ${workset.confirms.length} confirmation re-runs) + ${workset.reuses.length} reuses; stages ${Object.entries(workset.perStage).map(([s, n]) => `${s}:${n}`).join(' ')}`);
  say('sources (recorded | current):');
  const refused = [];
  for (const f of UNIFORM_FIELDS) {
    const same = recordedProv[f] === before[f];
    say(`  ${f.padEnd(9)} ${recordedProv[f].slice(0, 16)} | ${before[f].slice(0, 16)}  ${same ? 'equal' : f === 'engine' || f === 'generator' ? 'differs (being certified)' : 'DIFFERS (REFUSED)'}`);
    if (!same && f !== 'engine' && f !== 'generator') refused.push(`${f} differs: recorded ${recordedProv[f].slice(0, 12)}, now ${before[f].slice(0, 12)}`);
  }
  if (refused.length) fail(1, ...refused.map((m) => `REFUSED: ${m}`));

  // 2. rebuild
  let todo = workset.direct;
  if (options.limit !== null) todo = todo.slice(0, options.limit);
  if (options.shard) todo = todo.filter((_, i) => i % options.shard.of === options.shard.index);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-identity-cert-'));
  const cleanup = () => { try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ } };
  process.on('exit', cleanup);
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { cleanup(); process.exit(130); });
  say(`rebuilding ${todo.length} of ${workset.direct.length} direct records on ${Math.min(options.workers, todo.length || 1)} workers${partial ? ' (PARTIAL)' : ''}${sabotage ? ` [CERT_SABOTAGE=${sabotage}]` : ''}`);
  const { result, mismatches, errors, drift, luaOf, symOf } = await runPool(todo, {
    workers: options.workers, worker: { file: SELF, args: ['--worker', `--mesen=${mesen}`] }, env: { ...process.env, TMPDIR: base }, current: before,
    progress: (done, mm, ee) => { if (done % 500 === 0) console.error(`  ${done}/${todo.length} ${((Date.now() - t0) / 1000).toFixed(0)}s, ${mm} mismatches, ${ee} errors`); }
  });

  // 3. pin again after the run: the sources, the stage files, the curve
  const after = processProvenance(REPO, mesen, { freshMesen: true });
  const sourceProblems = [];
  for (const f of UNIFORM_FIELDS) if (before[f] !== after[f]) sourceProblems.push(`source ${f} changed during the run`);
  try { const again = pinFiles(dir, fileNames, curvePath); if (again.curveDigest !== pinned.curveDigest) sourceProblems.push('the curve changed during the run'); for (const s of STAGES) if (again.stageInfo[s].sha256 !== pinned.stageInfo[s].sha256) sourceProblems.push(`stage file ${s} changed during the run`); } catch (e) { sourceProblems.push(`cannot re-read the pinned files: ${e.message}`); }

  // 4. the reuse records resolve to matched direct records
  const matchedIds = new Set(Object.entries(result.kinds).filter(([, k]) => k === 'matched').map(([id]) => id));
  const reuseProblems = [];
  if (!partial) for (const r of workset.reuses) if (!matchedIds.has(r.reuse.of)) reuseProblems.push(`reuse ${r.id}: its source ${r.reuse.of} is not a matched rebuild`);

  const verdict = verdictOf({ directCount: workset.direct.length, partial, result, drift: drift.length, sourceProblems, sabotage, reuseProblems });
  for (const m of mismatches.slice(0, 100)) say(`MISMATCH ${m.stage} ${m.id}: ${m.differs.join('+')}`);
  for (const e of errors.slice(0, 40)) say(`ERROR ${e.stage} ${e.id}: ${e.error}`);
  for (const m of result.problems.slice(0, 40)) say(`PROBLEM ${m}`);
  if (result.missing.length) say(`UNANSWERED ${result.missing.length} jobs, first: ${result.missing.slice(0, 5).join(', ')}`);
  for (const d of drift.slice(0, 5)) say(`SOURCE DRIFT at ${d.id}: ${d.moved.join(', ')}`);
  const wallSeconds = Math.round((Date.now() - t0) / 1000);
  say(`checked ${result.answered}/${workset.direct.length} direct records: ${result.matched} matched, ${mismatches.length} mismatched, ${errors.length} errors; ${workset.reuses.length} reuse records ${partial ? 'not resolved (partial)' : 'resolved to matched sources'}; wall ${wallSeconds}s`);
  say(`engine ${recordedProv.engine.slice(0, 12)} -> ${before.engine.slice(0, 12)}; generator ${recordedProv.generator.slice(0, 12)} -> ${before.generator.slice(0, 12)}`);
  say(verdict.label);
  Object.assign(report, { exit: verdict.exit, why: verdict.why, direct: workset.direct.length, reuses: workset.reuses.length, confirms: workset.confirms.length, expected: result.expected, answered: result.answered, matched: result.matched, mismatched: mismatches.length, errors: errors.length, problems: result.problems, wallSeconds, before, after, mismatches: mismatches.slice(0, 100) });

  if (verdict.exit === 0 && outPath) {
    const cert = buildCertificate({ workset, curve, curveFile: CURVE_REL, curveDigest: pinned.curveDigest, stageInfo: pinned.stageInfo, current: before, recordedProv, before, after, result, luaOf, symOf, workers: options.workers });
    const own = validateCertificate(cert, { curve, curveBytes: fs.readFileSync(curvePath), live: liveSources() });
    if (own.length) { console.error(`REFUSED: the certificate just built does not validate: ${own.join('; ')}`); report.exit = 1; if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 1) + '\n'); process.exit(1); }
    fs.mkdirSync(path.dirname(path.resolve(REPO, outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(REPO, outPath), JSON.stringify(cert, null, 1) + '\n', { flag: 'wx' });
    say(`certificate written: ${outPath}`);
  }
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 1) + '\n');
  process.exit(verdict.exit);
}
