// Per-job provenance of the Mesen sweep (phase 3a slice S1, review 3's R3-F2): what produced a figure, recorded with the figure
// so that a record can never silently mix evidence from two harnesses, two generators or two Mesen builds.
//   engine      engineFingerprint(): engine/*.asm with comments stripped
//   harness     the sweep's own files (the Lua template, the runner, the scene builder, the mutation, the sweep driver, this module)
//   generator   everything the build pipeline reads: main/build/ and shared/ (every file, path and content)
//   mesen       the emulator: the launcher, MesenCore.so and Mesen.dll beside it (the launcher alone is a 72 KB stub)
//   project     sha256 of the normalized project JSON the job built (JSON.stringify of the validated project)
//   rom         sha256 of the assembled ROM the job ran
// engine/harness/generator/mesen are per STATE OF THE SOURCES, and the sources are read FRESH on every call (nothing here is
// cached for the life of the process: a live edit in the middle of a stage must change the next hash). Only the Mesen files are
// stat-keyed (path, device, inode, size, ctime, mtime, high resolution), because they are 30 MB of binary that does not change under a running sweep; `agg` reads them fresh.
// project and rom are per JOB. A stage takes the sources' state before it measures, every job re-reads it before building and after
// measuring, and any difference aborts (SourceChangedError); `agg` then refuses records that disagree with each other OR with the files
// as they are now.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { REPO } from './sw_manifest_scene.mjs';
import { engineFingerprint } from '../lib/enginefingerprint.js';

export const HARNESS_FILES = ['sw_manifest.lua.template', 'run_sw_manifest.mjs', 'sw_manifest_scene.mjs', 'sw_sweep_mutate.mjs', 'sw_bound_sweep.mjs', 'sw_provenance.mjs'];
export const PROVENANCE_FIELDS = ['engine', 'harness', 'generator', 'mesen', 'project', 'rom'];
export const UNIFORM_FIELDS = ['engine', 'harness', 'generator', 'mesen'];

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const sha256 = sha;

export class SourceChangedError extends Error {
  constructor(message) { super(message); this.name = 'SourceChangedError'; }
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.isFile()) out.push(p);
  }
  return out;
}
function hashFiles(root, files) {
  const h = crypto.createHash('sha256');
  for (const f of files) { h.update(path.relative(root, f) + '\n'); h.update(fs.readFileSync(f)); h.update('\n'); }
  return h.digest('hex');
}

/** The sweep's own files, read now. `harnessRoot` is where they live (the repository, unless a test points elsewhere). */
export const harnessHash = (harnessRoot = REPO) => hashFiles(harnessRoot, HARNESS_FILES.map((f) => path.join(harnessRoot, 'test/lua', f)));
export const generatorHash = (root = REPO) => hashFiles(root, [...walk(path.join(root, 'main/build')), ...walk(path.join(root, 'shared'))]);
export const engineHash = (root = REPO) => engineFingerprint(root).sha256;
export const projectHash = (project) => sha(JSON.stringify(project));
export const romHash = (romPath) => sha(fs.readFileSync(romPath));

const MESEN_PARTS = ['MesenCore.so', 'Mesen.dll'];
const mesenFiles = (mesenPath) => [mesenPath, ...MESEN_PARTS.map((n) => path.join(path.dirname(mesenPath), n)).filter((p) => fs.existsSync(p))];
const mesenStat = new Map();
/** The emulator's hash: the launcher and the core and managed library beside it. Stat-keyed (dev, ino, size, ctime, mtime; high resolution) unless `fresh`. */
export function mesenHash(mesenPath, { fresh = false } = {}) {
  const files = mesenFiles(mesenPath);
  // high-resolution device, inode, size, ctime and mtime: an atomic replacement by same-size bytes with a restored mtime still changes inode and ctime
  const key = files.map((f) => { const s = fs.statSync(f, { bigint: true }); return `${f}:${s.dev}:${s.ino}:${s.size}:${s.ctimeNs}:${s.mtimeNs}`; }).join('|');
  const hit = mesenStat.get(mesenPath);
  if (!fresh && hit && hit.key === key) return hit.hash;
  const h = crypto.createHash('sha256');
  for (const f of files) { h.update(path.basename(f) + '\n'); h.update(fs.readFileSync(f)); h.update('\n'); }
  const hash = h.digest('hex');
  mesenStat.set(mesenPath, { key, hash });
  return hash;
}

/** The four source-state fields, read now: engine and generator of `root` (the tree under test), the harness of `harnessRoot`, the Mesen binary. */
export const processProvenance = (root, mesenPath, { harnessRoot = REPO, freshMesen = false } = {}) => ({ engine: engineHash(root), harness: harnessHash(harnessRoot), generator: generatorHash(root), mesen: mesenHash(mesenPath, { fresh: freshMesen }) });

/** The fields in which two source states differ. */
export const sourceDifferences = (a, b) => UNIFORM_FIELDS.filter((f) => a?.[f] !== b?.[f]);
/** Throws SourceChangedError when `actual` is not `expected` (`when` says where in a job or a stage the check was made). */
export function assertSameSources(expected, actual, when) {
  const d = sourceDifferences(expected, actual);
  if (d.length) throw new SourceChangedError(`the sources changed ${when}: ${d.map((f) => `${f} ${String(expected?.[f]).slice(0, 12)} -> ${String(actual?.[f]).slice(0, 12)}`).join(', ')}`);
}

// ---- duplicate skipping --------------------------------------------------------------------------------------------------------
/** How a Mesen session is executed: part of every measurement's key, and what the runner actually spawns. */
export const EXEC_FLAGS = { args: ['--testRunner', '--enableStdout'], killMs: 600000 };

/**
 * The key under which one measurement may be reused by another job: the normalized project, the assembled ROM, the effective
 * rendered Lua script (its phase parameters, marks, symbol bindings), the four source-state hashes, and the execution flags. A
 * measurement is reused only when EVERY component is equal.
 */
export const measurementKey = ({ project, rom, lua, prov, flags = EXEC_FLAGS }) => sha(JSON.stringify({ project, rom, lua, prov: UNIFORM_FIELDS.map((f) => prov[f]), flags }));

/**
 * In-process cache of measurements by key: a second job with the same key takes the first's measurement instead of running Mesen.
 * `acquire(key, {wait})` answers one of { hit, value } (a finished measurement), { pending } (it is being measured now and `wait` is false:
 * the caller defers the job rather than block a worker), or { hit: false, publish, fail } (a claim on measuring it: `publish(value)` once
 * the measurement is complete and good, `fail()` otherwise, which releases the claim).
 */
export class MeasurementCache {
  constructor() { this.map = new Map(); }
  async acquire(key, { wait = true } = {}) {
    for (;;) {
      const e = this.map.get(key);
      if (!e) {
        const entry = { done: false, value: null, promise: null };
        let settle;
        entry.promise = new Promise((res) => { settle = res; });
        this.map.set(key, entry);
        return {
          hit: false,
          publish: (value) => { entry.done = true; entry.value = value; settle(true); },
          fail: () => { this.map.delete(key); settle(false); }
        };
      }
      if (e.done) return { hit: true, value: e.value };
      if (!wait) return { hit: false, pending: true };
      await e.promise; // the owner published (loop: hit) or failed (loop: take the claim ourselves)
    }
  }
  /** Seed from a measurement already on disk. */
  seed(key, value) { if (!this.map.has(key)) this.map.set(key, { done: true, value, promise: Promise.resolve(true) }); }
  has(key) { return this.map.has(key); }
}

const HEX = /^[0-9a-f]{64}$/;
/** Problems with one provenance block: a missing or malformed field. */
export function provenanceFieldProblems(prov) {
  if (!prov || typeof prov !== 'object') return ['no provenance block'];
  return PROVENANCE_FIELDS.filter((f) => !HEX.test(prov[f] ?? '')).map((f) => `provenance.${f} is missing or not a sha-256`);
}
/**
 * Problems with a list of provenance blocks as one record: each must be complete, and the per-process fields must be identical
 * across all of them. `label(i)` names block i in a message.
 */
export function provenanceUniformityProblems(provs, label = (i) => `#${i}`) {
  const problems = [];
  provs.forEach((p, i) => { for (const m of provenanceFieldProblems(p)) problems.push(`${label(i)}: ${m}`); });
  const good = provs.filter((p) => provenanceFieldProblems(p).length === 0);
  for (const f of UNIFORM_FIELDS) {
    const vals = [...new Set(good.map((p) => p[f]))];
    if (vals.length > 1) problems.push(`${f} differs across the record (${vals.length} values: ${vals.map((v) => v.slice(0, 12)).join(', ')})`);
  }
  return problems;
}
