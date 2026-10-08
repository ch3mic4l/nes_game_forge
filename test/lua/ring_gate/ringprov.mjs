// Certificate provenance helpers (phase 3b plan review 3, obligation 2): fingerprints of the HARNESS (every local module and template the
// run imports or reads), of the generated project, of the emulators; and the stamp that links a build's record to the result it produced.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT, sha256 } from './ringtree.mjs';
import { matrixScripts } from './ringjobs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The entry points of the gate that no matrix job names (the matrix's own scripts come from the job list itself, below: matrixScripts()); the closure
// of their local imports is hashed, plus the Lua template and the patch files' directory listing.
// EVIDENCE entry points: scripts that PRODUCE certificate evidence without being a stamped matrix job's argv (the builder-identity proof of the G-gate builders, the report tables,
// the isolated-HOME spawner). Round 2, finding 7: round 1 left s1b_noflag.mjs and s1b_tables.mjs out of the fingerprint. Each is also hashed WITH its import closure, and a fingerprint that
// lacks one is a gap (fingerprintGaps), so a later evidence script added here but not hashed cannot stamp.
export const EVIDENCE_ENTRIES = ['s1b_noflag.mjs', 's1b_tables.mjs', 'run_s1b.mjs', 'ringhome.mjs', 'ringcount.mjs', 'ringseam.mjs', 'ringwork.mjs', 'ringcli.mjs', 's1bjudge.mjs', 's1bspecs.mjs', 's1b_unit.mjs', 'iso_unit.mjs', 's1bcost.mjs', 's1bbound.mjs', 's1bagree.mjs', 's1bcover.mjs', 's1b_coverage.mjs',
  // S1c: the row 5/6/8 runner, the judges and recorders it imports, the controls table, the no-flag proof, the unit tests and the gate table
  'run_s1c.mjs', 's1ccontrols.mjs', 'ringnmi.mjs', 'ringclose.mjs', 'ringsplit.mjs', 'ringsections.mjs', 's1c_noflag.mjs', 's1c_unit.mjs', 's1c_gate.mjs', 's1caudit.mjs', 'ringwcet.mjs'];
const ENTRIES = [...EVIDENCE_ENTRIES, 'ringworld.mjs', 'ringjudge.mjs', 'ringrun_jsnes.mjs', 'ringrun_mesen.mjs', 'run_oracle.mjs', 'run_identity.mjs', 'ringidentity.mjs', 'ringscene.mjs',
  'ringsabotage.mjs', 'run_matrix.mjs', 'ringprovindex.mjs', 'judge_unit.mjs', 'record_controls.mjs', 'prov_unit.mjs'];
// Executed by the certificate but outside the import closure of the entries: the Lua template, the patch generator, every patch file (the three
// production patches and each sabotage), the matrix shell wrapper's replacement, and the fixture-hash script + its recorded baseline.
// S1c: the three row 5/6/8 Lua templates (and the legacy deadline templates and builders the no-flag proof executes) are read from test/lua, outside the import closure
const EXTRA = ['ring_oracle.lua.template', 'regen_patches.mjs', '../sw_nmi_ring.lua.template', '../sw_close_deadline.lua.template', '../sw_split_ring.lua.template', '../sw_nmi_deadline.lua.template',
  '../build_sw_nmi_roms.mjs', '../build_sw_close_deadline_roms.mjs', '../run_sw_ring_gate.sh'];
const EXTRA_ROOT = ['test/lua/ring_gate/fixture-hashes.mjs', 'test/lua/ring_gate/fixture-hashes-before.txt', 'test/lua/ring_gate/fixture-hashes-r4-before.txt'];
const patchFiles = () => {
  const out = [];
  for (const d of ['', 'sabotage']) for (const f of fs.existsSync(path.join(HERE, d)) ? fs.readdirSync(path.join(HERE, d)) : []) if (f.endsWith('.patch')) out.push(path.join(HERE, d, f));
  return out;
};

function localImports(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const p = path.resolve(path.dirname(file), m[1]);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) out.push(p);
  }
  return out;
}

/**
 * The scripts the matrix really executes that the fingerprint does not cover: [] for a sound fingerprint. `fp` is a harnessFingerprint() result,
 * `scripts` the repo-relative list (default: matrixScripts(), the argv[0] / `--test` file of every job). The unit control for the fingerprint.
 */
export const fingerprintGaps = (fp, scripts = matrixScripts()) => [...new Set([...scripts, ...EVIDENCE_ENTRIES.map((e) => path.join('test/lua/ring_gate', e))])].filter((s) => !(s in fp));

/**
 * { relativePath: sha256 } of every harness/oracle file the gate imports (transitively, inside the repo) plus the Lua template. The seed is the
 * matrix's REAL executed script list (matrixScripts(): run_campaign, ringcapacity, both repro entries, the unit-test files, ... each job's argv[0])
 * together with ENTRIES; `seed` replaces it (a control passes a seed with one script removed). With `check` (default) a script the matrix executes
 * that the result lacks throws: a stamp must never certify a harness whose executed script it did not hash.
 */
export function harnessFingerprint({ seed, check = true } = {}) {
  const seen = new Set();
  const seedFiles = seed ?? [...ENTRIES.map((e) => path.join('test/lua/ring_gate', e)), ...matrixScripts()];
  const stack = seedFiles.map((e) => path.resolve(ROOT, e)).filter((p) => fs.existsSync(p));
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const d of localImports(f)) stack.push(d);
  }
  for (const e of EXTRA) seen.add(path.join(HERE, e));
  for (const e of EXTRA_ROOT) if (fs.existsSync(path.join(ROOT, e))) seen.add(path.join(ROOT, e));
  for (const f of patchFiles()) seen.add(f);
  const out = {};
  for (const f of [...seen].sort()) if (fs.existsSync(f)) out[path.relative(ROOT, f)] = sha256(fs.readFileSync(f));
  const gaps = check ? fingerprintGaps(out) : [];
  if (gaps.length) throw new Error(`harness fingerprint lacks matrix-executed script(s): ${gaps.join(', ')}`);
  return out;
}

const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);
/** sha256 of the canonical (sorted-key) JSON of the generated project: the scene the cell was built from. */
export const projectSha256 = (project) => sha256(JSON.stringify(canonical(project)));

/** The jsnes vendored core's identity: the hash over every source file of renderer/emulator/core (its FORGE-PATCHES.md included). */
export function jsnesStamp() {
  const dir = path.join(ROOT, 'renderer/emulator/core');
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
  walk(dir);
  const h = crypto.createHash('sha256');
  for (const f of files.sort()) h.update(path.relative(dir, f)).update(fs.readFileSync(f));
  return { emulator: 'jsnes (vendored core)', coreSha256: h.digest('hex'), patchesDoc: sha256(fs.readFileSync(path.join(dir, 'FORGE-PATCHES.md'))) };
}
const hashCache = new Map();
/** sha256 + size of a file, cached per (path, mtime). Null when the file is absent. */
export function fileStamp(file) {
  try {
    const st = fs.statSync(file);
    const key = `${file}:${st.mtimeMs}:${st.size}`;
    if (!hashCache.has(key)) hashCache.set(key, { path: file, sha256: sha256(fs.readFileSync(file)), bytes: st.size });
    return hashCache.get(key);
  } catch { return null; }
}

/** The host the certificate ran on: OS, kernel, CPU architecture, Node. */
export function hostStamp() {
  let osRelease = null;
  try { osRelease = /^PRETTY_NAME="?([^"\n]*)"?/m.exec(fs.readFileSync('/etc/os-release', 'utf8'))?.[1] ?? null; } catch { /* no os-release */ }
  return { os: osRelease, kernel: os.release(), arch: os.arch(), node: process.version };
}

// The files a Mesen process actually maps that identify its implementation: the apphost, its managed assemblies, the NATIVE core (which Mesen
// extracts to ~/.config/Mesen2 and loads from THERE, not from the sibling MesenCore.so), and the .NET runtime that executes it.
const MESEN_LOADED = /(\/Mesen(\.dll)?$|\/MesenCore\.so$|\/Mesen2\/|libcoreclr\.so$|libhostfxr\.so$|libhostpolicy\.so$|System\.Private\.CoreLib\.dll$)/;
export function loadedFilesOfPid(pid, into = new Set()) {
  try { for (const l of fs.readFileSync(`/proc/${pid}/maps`, 'utf8').split('\n')) { const m = l.match(/\s(\/\S+)$/); if (m && MESEN_LOADED.test(m[1])) into.add(m[1]); } } catch { /* process gone */ }
  return into;
}
/**
 * The Mesen implementation. `loadedPaths` (optional) = the files a real run was seen to map (runMesen collects them from /proc/<pid>/maps):
 * each is hashed, so the NATIVE core that really executed is identified, not just the host. `loadedStamps` is the same for files that no longer exist. Also hashed: the sibling host, Mesen.dll, the sibling
 * MesenCore.so, the runtime config and deps (siblingFiles; `Mesen` there is the release's own host beside the executable, hashed separately from `binarySha256`, which is the resolved executable itself). `coreLoadedFromSibling` says whether the executed core is the one beside the binary.
 */
export function mesenStamp(binary, loadedPaths = [], loadedStamps = []) {
  if (!path.isAbsolute(binary)) throw new Error(`mesenStamp: ${binary} is not an absolute path (resolve the executable first: ringrun_mesen.mjs resolveMesen)`);
  const dir = path.dirname(binary);
  // the resolved executable ITSELF (what was spawned: `mesen-custom` is hashed as itself, never as the sibling `Mesen`), kept apart from the release metadata beside it
  const executable = fileStamp(binary);
  const sibling = {};
  for (const f of ['Mesen', 'Mesen.dll', 'MesenCore.so', 'Mesen.runtimeconfig.json', 'Mesen.deps.json']) sibling[f] = fileStamp(path.join(dir, f));
  let runtimeConfig = null;
  try { runtimeConfig = JSON.parse(fs.readFileSync(path.join(dir, 'Mesen.runtimeconfig.json'), 'utf8')).runtimeOptions; } catch { /* absent */ }
  // `loadedStamps`: files already hashed by the runner while the process's private HOME existed (paths normalised to `<isolated-HOME>/...`); `loadedPaths`: live paths
  const byKey = new Map();
  for (const f of [...[...new Set(loadedPaths)].sort().map((p) => fileStamp(p)).filter(Boolean), ...loadedStamps]) byKey.set(`${f.path}:${f.sha256}`, f);
  const loaded = [...byKey.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const loadedCore = loaded.find((f) => /MesenCore\.so$/.test(f.path)) ?? null;
  return {
    emulator: 'Mesen2 --testRunner', binary, binarySha256: executable?.sha256 ?? null, binaryBytes: executable?.bytes ?? null,
    siblingHostSha256: sibling.Mesen?.sha256 ?? null, siblingFiles: sibling, runtimeConfig, host: hostStamp(),
    loadedFiles: loaded, loadedCoreSha256: loadedCore?.sha256 ?? null,
    coreLoadedFromSibling: loadedCore && sibling['MesenCore.so'] ? loadedCore.sha256 === sibling['MesenCore.so'].sha256 : null
  };
}

/** The assembler the build used: path and sha256 of the nesasm on PATH. */
export function nesasmStamp() {
  for (const d of (process.env.PATH ?? '').split(':')) { const p = path.join(d, 'nesasm'); if (fs.existsSync(p)) return fileStamp(p); }
  return null;
}

// ---- attempt stamps (review 2 finding 3): a stamp is written BEFORE the build it describes, so a build that fails or crashes still leaves one;
// it is then completed with the outcome, and the results appended later link back to it. status: started -> built | error.
let attemptSeq = 0;
export function writeAttempt(provDir, label, fields) {
  if (!provDir) return null;
  fs.mkdirSync(provDir, { recursive: true });
  const provPath = path.join(provDir, `${label}.json`);
  // Under the matrix (RING_PROV_UNIQUE=1) two jobs may never write one stamp: a second writer silently REPLACES the first's results (round 4: a control that
  // withdrew Mesen from a scene replaced the positive campaign's stamp for that scene). A collision is an error naming the label.
  if (process.env.RING_PROV_UNIQUE === '1' && fs.existsSync(provPath)) throw new Error(`stamp collision: ${provPath} already exists in this matrix run (two jobs/scenes share the label ${label})`);
  fs.writeFileSync(provPath, JSON.stringify({ schema: 'ring-prov-3', label, status: 'started', attempt: { n: ++attemptSeq, pid: process.pid, startedAt: new Date().toISOString() }, ...fields, results: [] }, null, 1));
  return provPath;
}
export function updateStamp(provPath, patch) {
  if (!provPath) return;
  const cur = JSON.parse(fs.readFileSync(provPath, 'utf8'));
  fs.writeFileSync(provPath, JSON.stringify({ ...cur, ...patch }, null, 1));
}
export const finishAttempt = (provPath, status, patch = {}) => updateStamp(provPath, { status, finishedAt: new Date().toISOString(), ...patch });

/** Rewrites a build's provenance JSON with the emulator stamps and the result record it was judged under. */
export function stampResult(provPath, result) {
  if (!provPath || !fs.existsSync(provPath)) return;
  const prov = JSON.parse(fs.readFileSync(provPath, 'utf8'));
  prov.results = [...(prov.results ?? []), result];
  fs.writeFileSync(provPath, JSON.stringify(prov, null, 1));
}
export { pathToFileURL };
