// The ring gate's one tree-maker: a mkdtemp copy of engine/ main/ shared/ (+ package.json, so `type: module` holds) with the
// ring gate's patches applied by `git apply`, and the imports to build a project through THAT copy's real public path
// (buildProject). It fails loudly if a patch does not apply and never falls back to the unpatched tree: a silent four-screen
// fallback counted as a ring pass is the exact defect the row-1 identity cell exists to catch.
//
// Two kinds of ring tree, by STREAM_RING mode (phase 3b S2 rebaselined the gate onto C2's production vertical ring):
//   ring 1 (vertical)   = BASELINE + 00-refusal-lift.patch (+ the sabotage's vertical form). The vertical ring's forks are C2's SHIPPED
//                         code, byte for byte: `verifyProductionVertical` rebuilds the EXACT expected content (BASELINE's blobs with the
//                         canonical, hashed patches applied in order) and requires every file of the tree to equal it by git blob hash -- an
//                         edit inside a file a sabotage already declares is a mismatch too. `loadTree` re-proves it at every build.
//   ring 2 (horizontal) = the same, plus the S1 prototype's horizontal half (01-ring-select, 02-ring-engine, 03-player-far-branch), which
//                         S3 will productionize.
// A vertical cell therefore can never be built through a prototype-patched tree: makeTree gives it a tree of its own, and buildCell refuses a
// tree whose ring is not the cell's.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const PATCH_DIR = path.join(ROOT, 'test/lua/ring_gate');
/** The patches each ring mode's tree carries, in application order. Mode 1 is production + the refusal lift only. */
export const RING_PATCH_SETS = {
  1: ['00-refusal-lift.patch'],
  2: ['00-refusal-lift.patch', '01-ring-select.patch', '02-ring-engine.patch', '03-player-far-branch.patch']
};
export const RING_PATCHES = RING_PATCH_SETS[2];
const COPIED = ['engine', 'main', 'shared'];
/** The certification baseline: the tree makeTree copies must equal it (S2 commit C2, the production vertical ring). */
export const BASELINE = 'cd7a9f825aa8c71a36fa53f31064e3d2f78c20b8';
/** The baseline the S1b certificate (rounds 1-3) was built at, before the rebaseline onto C2: the only baseline a historical re-judgment (s1b_rejudge.mjs) may carry. */
export const PRE_C2_BASELINE = '5138c1f0c33107016a90423da17dcbb33d8697ca';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Resolves a patch name ('00-...patch' or a sabotage name) to its file; a sabotage has a vertical form (sabotage/vertical/) and a horizontal one. */
export function patchFile(name, ring = 2) {
  const rel = name.endsWith('.patch') ? name : ring === 1 ? `sabotage/vertical/${name}.patch` : `sabotage/${name}.patch`;
  const p = path.join(PATCH_DIR, rel);
  if (!fs.existsSync(p)) throw new Error(`ring patch not found${name.endsWith('.patch') ? '' : ` (sabotage ${name} has no ring-${ring} form)`}: ${p}`);
  return p;
}

/** Does sabotage `name` have a form for ring `ring`? (The vertical production tree has no row fork, so a row-fork sabotage has no vertical form.) */
export function sabotageHasRing(name, ring) {
  return fs.existsSync(path.join(PATCH_DIR, ring === 1 ? `sabotage/vertical/${name}.patch` : `sabotage/${name}.patch`));
}

/**
 * Refuses unless engine/ main/ shared/ in the working tree are exactly BASELINE's: no tracked diff, no untracked file. The patches are made
 * against that baseline, so a tree that drifted from it would be certified under the wrong name.
 */
export function verifyBaseline() {
  const run = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
  try { execFileSync('git', ['diff', '--quiet', BASELINE, '--', ...COPIED], { cwd: ROOT }); }
  catch { throw new Error(`engine/ main/ shared/ differ from ${BASELINE} (git diff ${BASELINE} -- engine main shared); the ring gate certifies only that baseline:\n${run('diff', '--stat', BASELINE, '--', ...COPIED)}`); }
  const untracked = run('ls-files', '--others', '--exclude-standard', '--', ...COPIED);
  if (untracked) throw new Error(`untracked files under engine/ main/ shared/ (the gate certifies ${BASELINE} only):\n${untracked}`);
}

/** The files a patch file touches (its `diff --git a/<x>/<path> b/<x>/<path>` headers, two leading components stripped as `git apply -p2` does). */
export function patchedFiles(patchText) {
  const out = [];
  for (const m of patchText.matchAll(/^diff --git a\/[^/]+\/(\S+) b\/[^/]+\/(\S+)$/gm)) { if (m[1] !== m[2]) throw new Error(`a ring patch renames ${m[1]} -> ${m[2]}`); out.push(m[1]); }
  return out;
}

const gitBlobSha1 = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
function walk(dir, rel, out) {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(dir, r, out); else out.push(r);
  }
}
let baselineBlobs = null;
/** { path -> git blob sha1 } of every file of engine/ main/ shared/ at BASELINE. */
function baselineBlobMap() {
  if (baselineBlobs) return baselineBlobs;
  const text = execFileSync('git', ['ls-tree', '-r', BASELINE, '--', ...COPIED], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  baselineBlobs = new Map(text.trim().split('\n').map((l) => { const m = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(l); if (!m) throw new Error(`unreadable ls-tree line: ${l}`); return [m[2], m[1]]; }));
  return baselineBlobs;
}

/** The files of `root`'s engine/ main/ shared/ that differ from BASELINE (changed, added or missing), by git blob hash. */
export function filesDifferingFromBaseline(root) {
  const base = baselineBlobMap();
  const have = [];
  for (const d of COPIED) walk(root, d, have);
  const diff = [];
  for (const f of have) if (base.get(f) !== gitBlobSha1(fs.readFileSync(path.join(root, f)))) diff.push(f);
  for (const f of base.keys()) if (!have.includes(f)) diff.push(f);
  return [...new Set(diff)].sort();
}

/** The forks C2 ships (the ring-only labels and the config lines); their presence in BASELINE's own sources is asserted so a baseline that is not C2 fails here. */
const SHIPPED_FORKS = [
  ['engine/streamworld.asm', ['sw_ring_col_cmp:', 'sw_ring_col_len:', 'sw_ring_wrap_col:', 'sw_ring_nt_step:', 'sw_ring_nt_end:', '.if STREAM_RING']],
  ['main/build/generate.js', ['`STREAM_RING = ${ringMode}`', '`SW_RING_COL_LEN = ${ringMode === 1 ? 15 : 30}`', '`SW_RW_NT_END = ${ringMode === 1 ? 2 : 4}`']],
  ['shared/cartridge.js', ['export function streamRingMode(']]
];

const PROTOTYPE_PATCHES = ['01-ring-select.patch', '02-ring-engine.patch', '03-player-far-branch.patch'];

/** Checks that `applied` ([{name, file, sha256?}]) is a canonical ring-1 patch list: the required set in order, then only sabotage forms from sabotage/vertical/. Returns [{name, file, sha256, bytes}]: each canonical file is read ONCE, and the hash, the parse and the `git apply` all use those same bytes. */
function canonicalVerticalPatches(applied) {
  const base = RING_PATCH_SETS[1];
  if (applied.some(({ name }) => PROTOTYPE_PATCHES.includes(name))) throw new Error('a vertical (ring 1) tree carries a horizontal-prototype patch: the vertical ring must run on C2\'s shipped code, not be re-patched into the prototype');
  const names = applied.map(({ name }) => name);
  base.forEach((n, i) => { if (names[i] !== n) throw new Error(`a vertical (ring 1) tree's patch list must start ${base.join(', ')} in that order, got ${names.join(', ') || '(none)'}`); });
  return applied.map(({ name, file, sha256: claimed }, i) => {
    if (i >= base.length && name.endsWith('.patch')) throw new Error(`a vertical (ring 1) tree may carry only sabotage forms after the required set, not ${name}`);
    const canonical = patchFile(name, 1);
    if (path.resolve(file) !== path.resolve(canonical)) throw new Error(`ring patch ${name} was applied from ${file}, not the canonical ${canonical}`);
    const bytes = fs.readFileSync(canonical);
    const actual = sha256(bytes);
    if (claimed !== undefined && claimed !== actual) throw new Error(`ring patch ${name} changed on disk since the tree was made (applied ${claimed.slice(0, 12)}, now ${actual.slice(0, 12)})`);
    return { name, file: canonical, sha256: actual, bytes };
  });
}

const expectedCache = new Map();
/** Test hook: forgets the cached expected contents, so the next derivation applies the patches again. */
export const resetExpectedCache = () => expectedCache.clear();
/**
 * The exact content a ring-1 tree must have, built from nothing but BASELINE and the patch files: every file the patches declare is written to a scratch dir as
 * BASELINE's blob, then the patches are applied in order with `git apply -p2`. Returns { patches, declared, expected: {file -> git blob sha1} }; cached by the patch hashes.
 */
export function expectedVerticalContent(applied) {
  const patches = canonicalVerticalPatches(applied);
  const key = patches.map((p) => `${p.name}:${p.sha256}`).join('|');
  if (!expectedCache.has(key)) {
    const declared = new Set();
    for (const { bytes } of patches) for (const f of patchedFiles(bytes.toString('utf8'))) declared.add(f);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-expect-'));
    try {
      for (const f of declared) {
        fs.mkdirSync(path.dirname(path.join(scratch, f)), { recursive: true });
        fs.writeFileSync(path.join(scratch, f), execFileSync('git', ['show', `${BASELINE}:${f}`], { cwd: ROOT, maxBuffer: 64 << 20 }));
      }
      for (const { name, bytes } of patches) {
        try { execFileSync('git', ['apply', '-p2', '--whitespace=nowarn', '-'], { cwd: scratch, input: bytes, stdio: ['pipe', 'pipe', 'pipe'] }); }
        catch (e) { throw new Error(`ring patch ${name} does not apply to ${BASELINE}'s declared files:\n${e.stderr?.toString() ?? e.message}`); }
      }
      const expected = {};
      for (const f of [...declared].sort()) expected[f] = gitBlobSha1(fs.readFileSync(path.join(scratch, f)));
      expectedCache.set(key, { declared: Object.keys(expected), expected });
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }
  const { declared, expected } = expectedCache.get(key);
  return { patches: patches.map(({ name, sha256: h }) => ({ name, sha256: h })), declared: [...declared], expected: { ...expected } };
}

let shippedForksChecked = null;
/** The baseline itself must carry the shipped forks (a baseline that is not C2 would make "unmodified" meaningless). Returns the number of needles found. */
function checkShippedForks() {
  if (shippedForksChecked !== null) return shippedForksChecked;
  const base = baselineBlobMap();
  let n = 0;
  for (const [file, needles] of SHIPPED_FORKS) {
    const text = execFileSync('git', ['show', `${BASELINE}:${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
    for (const needle of needles) { if (!text.includes(needle)) throw new Error(`${BASELINE}:${file} does not contain the shipped ring fork ${JSON.stringify(needle)}: BASELINE is not the production vertical ring`); n += 1; }
    if (!base.has(file)) throw new Error(`${file} is not in ${BASELINE}`);
  }
  return (shippedForksChecked = n);
}

/**
 * The production-vertical proof. Throws unless `root` (a ring-1 tree) is EXACTLY BASELINE plus the canonical patches `applied` (in order, hashed): every file differing
 * from BASELINE is a declared one, every declared file's git blob hash equals the one expected from applying the patches to BASELINE, and no declared file is unchanged.
 * An undeclared edit in an undeclared file, an extra edit in a declared file (a prototype fork applied into a sabotage's file, a second hunk in shared/project.js), a
 * prototype patch and a patch changed on disk since the tree was made are all refused. Returns the proof the stamps carry:
 * { exact: true, baseline, patches, declared, changed, expected, forksChecked, unmodifiedShippedFiles }.
 */
export function verifyProductionVertical(root, applied) {
  const { patches, declared, expected } = expectedVerticalContent(applied);
  const changed = filesDifferingFromBaseline(root);
  const extra = changed.filter((f) => !declared.includes(f));
  if (extra.length) throw new Error(`a vertical (ring 1) tree differs from ${BASELINE} in files no applied patch declares (the shipped vertical forks must be unmodified): ${extra.join(', ')}`);
  const unchanged = declared.filter((f) => !changed.includes(f));
  if (unchanged.length) throw new Error(`a vertical (ring 1) tree's patches declare ${unchanged.join(', ')} but the tree equals ${BASELINE} there: the patch did nothing`);
  for (const f of declared) {
    const actual = gitBlobSha1(fs.readFileSync(path.join(root, f)));
    if (actual !== expected[f]) throw new Error(`a vertical (ring 1) tree's ${f} is not ${BASELINE} plus its applied patches (git blob ${actual.slice(0, 12)}, expected ${expected[f].slice(0, 12)}): an undeclared edit inside a declared file`);
  }
  if (!patches.some(({ name }) => name === '00-refusal-lift.patch')) throw new Error('a vertical (ring 1) tree is missing 00-refusal-lift.patch');
  return proofOf(patches, declared, changed, expected);
}

function proofOf(patches, declared, changed, expected) {
  return { exact: true, baseline: BASELINE, patches, declared: [...declared].sort(), changed: [...changed].sort(), expected, forksChecked: checkShippedForks(), unmodifiedShippedFiles: SHIPPED_FORKS.map(([f]) => f).filter((f) => !changed.includes(f)) };
}

/**
 * The tree-provenance fields ({ baseline, patches, treeKind, productionVertical, consumed }) a stamp for ring `ring` (1|2) with the sabotage forms `extras` must carry, computed from BASELINE and
 * the canonical patch files alone -- no tree is made. What the audit (ringprovindex.mjs `auditTreeProvenance`) accepts; the controls start from it.
 */
export function provenanceFor(ring, extras = []) {
  if (ring !== 1 && ring !== 2) throw new Error(`provenanceFor: ring must be 1 or 2, got ${ring}`);
  const names = [...RING_PATCH_SETS[ring], ...extras];
  let patches, productionVertical = null;
  if (ring === 1) {
    const exp = expectedVerticalContent(names.map((name) => ({ name, file: patchFile(name, 1) })));
    patches = exp.patches;
    productionVertical = proofOf(exp.patches, exp.declared, exp.declared, exp.expected);
  } else patches = names.map((name) => ({ name, sha256: sha256(fs.readFileSync(patchFile(name, ring))) }));
  let consumed = null;
  if (ring === 1) {
    const blobs = expectedTreeBlobs(productionVertical.expected);
    consumed = { mechanism: CONSUMED_MECHANISM, baseline: BASELINE, engine: { builds: 1, files: Object.fromEntries(expectedEngineNames(blobs).map((n) => [n, blobs.get(`engine/${n}`)])) }, js: { files: Object.fromEntries(REQUIRED_JS.map((m) => [m, blobs.get(m)])) } };
  }
  return { baseline: BASELINE, patches, treeKind: ring === 1 ? 'production-vertical' : 'prototype-horizontal', productionVertical, consumed };
}

/**
 * makeTree({ ring: 1|2|false, extra: ['strip-len-30-vertical'] }) -> { root, ring, kind, patches: [{name, sha256}], head, status, production? }.
 * ring 1 = the vertical production tree, ring 2 = the horizontal prototype tree, ring false = the pristine copy (the control for the STREAM_RING=0
 * identity proof). `ring: true` is refused: which ring a tree is for is never a default. Sabotages apply in their form for that ring.
 */
export function makeTree({ ring, extra = [] } = {}) {
  if (ring !== false && ring !== 1 && ring !== 2) throw new Error(`makeTree: ring must be 1 (vertical production), 2 (horizontal prototype) or false (pristine), got ${JSON.stringify(ring)}`);
  verifyBaseline();
  if (!ring && extra.length) throw new Error('extra patches need a ring tree');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ring-tree-${ring || 0}-`));
  try {
    for (const d of COPIED) fs.cpSync(path.join(ROOT, d), path.join(root, d), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(root, 'package.json'));
    const names = ring ? [...RING_PATCH_SETS[ring], ...extra] : [];
    const patches = [];
    const applied = [];
    for (const name of names) {
      const file = patchFile(name, ring);
      const bytes = fs.readFileSync(file); // read ONCE: the bytes applied are the bytes hashed
      if (bytes.length === 0) throw new Error(`ring patch ${name} is empty: every required patch of the shipped set changes something at ${BASELINE}`);
      try {
        execFileSync('git', ['apply', '-p2', '--whitespace=nowarn', '-'], { cwd: root, input: bytes, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e) {
        throw new Error(`ring patch ${name} does not apply to this tree (HEAD moved? re-run regen_patches.mjs):\n${e.stderr?.toString() ?? e.message}`);
      }
      patches.push({ name, sha256: sha256(bytes) });
      applied.push({ name, file, sha256: sha256(bytes) });
    }
    const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
    const tree = { root, ring: ring || 0, kind: !ring ? 'pristine' : ring === 1 ? 'production-vertical' : 'prototype-horizontal', patches, applied, baseline: BASELINE, head: git('rev-parse', 'HEAD'), status: git('status', '--short', '--', 'engine', 'main', 'shared', 'renderer', 'docs') || 'clean' };
    if (ring === 1) { tree.production = verifyProductionVertical(root, applied); registerConsumedGuard(tree); }
    return tree;
  } catch (e) { fs.rmSync(root, { recursive: true, force: true }); throw e; }
}

/**
 * One tree per STREAM_RING mode, made lazily, for a runner that builds both orientations in one process. `forCell(cell)` is the only way a cell gets
 * its tree: a vertical cell gets the production-vertical tree, a horizontal one the prototype tree, never the other.
 */
export function makeTreeSet({ extra = [] } = {}) {
  const trees = new Map();
  return {
    forRing(ring) { if (!trees.has(ring)) trees.set(ring, makeTree({ ring, extra })); return trees.get(ring); },
    forCell(cell) { return this.forRing(cell.ring); },
    roots() { return [...trees.values()].map((t) => t.root); },
    dispose() { for (const t of trees.values()) fs.rmSync(t.root, { recursive: true, force: true }); trees.clear(); }
  };
}

// ---- the consumed-input guard (C3 fix 2) ----------------------------------------------------------------------------------------------------------
// The exact-content proof above describes the tree at CHECK time. What matters is the bytes a build CONSUMED. A ring-1 tree is therefore registered here, and two process-wide interposers
// act only on paths under a registered root (anything else passes through untouched):
//   verified COPY  generate.js copies engine/*.asm into the build directory with `fs/promises.copyFile`; the assembler reads those copies. The wrapper reads the source ONCE, hashes THOSE
//                  bytes, refuses unless they are the expected blob (BASELINE's, or BASELINE plus the declared patches), and writes THOSE bytes to the destination. A source edited only
//                  for the instant of the copy (and restored) is refused, and what the assembler reads is by construction what was verified.
//   verified LOAD  a `module.registerHooks` load hook hashes the source the ESM loader actually read for each module of the tree (main/, shared/) against the expected blob. An ES module
//                  is read once per URL and cached, and main/ shared/ read no source lazily after import (no dynamic import, no readFile of a source: grep in the fix-2 report), so
//                  the load-time check binds every JS byte the build executed -- including a sabotage's declared edit to generate.js, which is expected to be the PATCHED blob.
// Both record what they verified; `consumedEvidence` turns that into the stamp's evidence, which the audit re-derives from BASELINE and the patch files.
export const CONSUMED_MECHANISM = 'verified-copy+verified-load';
/** The modules every ring-1 build executes; the evidence of a finished build must list them. */
export const REQUIRED_JS = ['main/build/generate.js', 'main/build/pipeline.js', 'main/build/nesasm.js', 'shared/project.js'];
const guards = new Map(); // root (and its realpath) -> record
const guardOf = (p) => { for (const [root, rec] of guards) if (String(p).startsWith(root + path.sep)) return { rec, rel: String(p).slice(root.length + 1).split(path.sep).join('/') }; return null; };

/** The git blob every file of engine/ main/ shared/ must have in a ring-1 tree: BASELINE's, with the proof's expected blobs over the declared files. */
export function expectedTreeBlobs(expected) { return new Map([...baselineBlobMap(), ...Object.entries(expected)]); }
/** The engine source names a ring-1 build must copy: BASELINE's engine/*.asm (plus any declared engine file). */
export const expectedEngineNames = (blobs) => [...blobs.keys()].filter((k) => /^engine\/[^/]+\.asm$/.test(k)).map((k) => k.slice('engine/'.length)).sort();

function registerConsumedGuard(tree) {
  installConsumedGuards();
  const rec = { tree, root: tree.root, blobs: expectedTreeBlobs(tree.production.expected), builds: new Map(), js: new Map() };
  tree.guard = rec;
  guards.set(tree.root, rec);
  try { guards.set(fs.realpathSync(tree.root), rec); } catch { /* the tree exists: realpath cannot fail here */ }
}

let guardsInstalled = false;
function installConsumedGuards() {
  if (guardsInstalled) return;
  guardsInstalled = true;
  const copyFile = fsp.copyFile, readFile = fsp.readFile, writeFile = fsp.writeFile;
  fsp.copyFile = async function guardedCopyFile(src, dest, ...rest) {
    const hit = guardOf(src);
    if (!hit) return copyFile.call(this, src, dest, ...rest);
    const { rec, rel } = hit;
    if (!/^engine\/[^/]+\.asm$/.test(rel)) throw new Error(`consumed-input guard: a build copied ${rel} out of a ring-1 tree; only engine/*.asm is a copied source`);
    const bytes = await readFile(src);
    const blob = gitBlobSha1(bytes);
    const want = rec.blobs.get(rel);
    if (want === undefined) throw new Error(`consumed-input guard: ${rel} is not an engine source of ${BASELINE} plus the tree's patches`);
    if (blob !== want) throw new Error(`consumed-input guard: the build read ${rel} as git blob ${blob.slice(0, 12)}, expected ${want.slice(0, 12)} (${BASELINE} plus its applied patches): the source changed while the build consumed it`);
    await writeFile(dest, bytes);
    const dir = path.dirname(String(dest));
    if (!rec.builds.has(dir)) rec.builds.set(dir, new Map());
    rec.builds.get(dir).set(path.basename(rel), blob);
  };
  registerHooks({
    load(url, context, nextLoad) {
      const r = nextLoad(url, context);
      if (!url.startsWith('file:')) return r;
      const hit = guardOf(fileURLToPath(url));
      if (!hit) return r;
      const { rec, rel } = hit;
      if (r.source === null || r.source === undefined) throw new Error(`consumed-input guard: ${rel} was loaded as ${r.format} without a source the guard can hash (a ring-1 tree's modules must be ES modules)`);
      const blob = gitBlobSha1(Buffer.from(r.source));
      const want = rec.blobs.get(rel);
      if (want === undefined) throw new Error(`consumed-input guard: ${rel} is not a source of ${BASELINE} plus the tree's patches`);
      if (blob !== want) throw new Error(`consumed-input guard: the loader read ${rel} as git blob ${blob.slice(0, 12)}, expected ${want.slice(0, 12)} (${BASELINE} plus its applied patches)`);
      rec.js.set(rel, blob);
      return r;
    }
  });
}

const sortedObject = (map) => Object.fromEntries([...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));

/**
 * The stamp's consumed-input evidence for a ring-1 tree (null for any other tree): every build the guard saw copied exactly the expected engine set with the expected blobs, and every module
 * the loader read had its expected blob. `min` is the number of builds the caller requires (a finished run needs >= 1; an error snapshot needs none). Throws on an incomplete or divergent build.
 */
export function consumedEvidence(tree, { min = 1, only = null } = {}) {
  const rec = tree.guard;
  if (!rec) return null;
  const want = expectedEngineNames(rec.blobs);
  const engine = new Map(want.map((n) => [n, rec.blobs.get(`engine/${n}`)]));
  if (only !== null && !rec.builds.has(only)) throw new Error(`consumed-input guard: no verified engine copy into ${only}: the ROM was not built through the guarded copy`);
  const builds = only !== null ? [[only, rec.builds.get(only)]] : [...rec.builds];
  for (const [dir, files] of builds) {
    const got = [...files.keys()].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`consumed-input guard: the build in ${dir} copied [${got.join(', ')}], expected exactly the engine set [${want.join(', ')}]`);
    for (const [n, blob] of files) if (blob !== engine.get(n)) throw new Error(`consumed-input guard: ${dir}/${n} is blob ${blob.slice(0, 12)}, expected ${engine.get(n).slice(0, 12)}`);
  }
  if (builds.length < min) throw new Error(`consumed-input guard: ${builds.length} verified build(s) of ${tree.root}, ${min} required: the ROM was not built through the guarded copy`);
  return { mechanism: CONSUMED_MECHANISM, baseline: BASELINE, engine: { builds: builds.length, files: sortedObject(engine) }, js: { files: sortedObject(rec.js) } };
}

/** consumedEvidence for an error stamp: whatever the guard verified so far, never throwing (a refused build is the reason for the error). */
export function consumedSnapshot(tree) {
  if (!tree.guard) return null;
  try { return consumedEvidence(tree, { min: 0 }); } catch (e) { return { mechanism: CONSUMED_MECHANISM, baseline: BASELINE, refused: String(e.message).split('\n')[0], engine: { builds: 0, files: {} }, js: { files: {} } }; }
}

/**
 * After a build into `dir` (a ring-1 tree): hashes the engine sources the assembler actually read -- the copies in `dir/build` -- and requires each to equal the expected blob (or, for a name the
 * project's Code Forge declares, the declared override text), and the set of copies to be exactly the expected set. Returns the stamp evidence (the guard's own record of that one build,
 * plus the override names).
 */
export function verifyBuildDir(tree, dir, project) {
  const rec = tree.guard;
  if (!rec) return null;
  const buildDir = path.join(dir, 'build');
  const want = expectedEngineNames(rec.blobs);
  const overrides = new Map((project?.code?.overrides ?? []).map((o) => [o.name, gitBlobSha1(Buffer.from(o.text, 'utf8'))]));
  const extras = new Set((project?.code?.files ?? []).map((o) => o.name));
  const have = fs.readdirSync(buildDir).filter((n) => n.endsWith('.asm'));
  for (const n of want) {
    if (!have.includes(n)) throw new Error(`consumed-input guard: the build directory has no copy of engine/${n}`);
    const blob = gitBlobSha1(fs.readFileSync(path.join(buildDir, n)));
    const expect = overrides.get(n) ?? rec.blobs.get(`engine/${n}`);
    if (blob !== expect) throw new Error(`consumed-input guard: the assembler read ${n} as git blob ${blob.slice(0, 12)}, expected ${expect.slice(0, 12)}${overrides.has(n) ? ' (a declared Code Forge override)' : ''}`);
  }
  const unexplained = have.filter((n) => !want.includes(n) && !extras.has(n));
  if (unexplained.length) throw new Error(`consumed-input guard: the build directory holds assembler sources no engine file or declared Code Forge file explains: ${unexplained.join(', ')}`);
  return { ...consumedEvidence(tree, { only: buildDir }), overrides: [...overrides.keys()].sort() };
}

/**
 * Reads `rel` (e.g. 'engine/text.asm') out of a ring-1 tree for a harness that derives an override from it. A ring-1 tree's file must be the expected blob; the text returned is the verified
 * bytes. A tree of any other ring is read as it is.
 */
export function readTreeText(tree, rel) {
  const bytes = fs.readFileSync(path.join(tree.root, rel));
  if (tree.guard) {
    const want = tree.guard.blobs.get(rel);
    if (want === undefined || gitBlobSha1(bytes) !== want) throw new Error(`consumed-input guard: ${rel} read for a harness override is not ${BASELINE} plus the tree's patches`);
  }
  return bytes.toString('utf8');
}

/** Throws unless `tree` is the tree of cell `cell`'s ring (a vertical cell is built only through the production-vertical tree, a horizontal one only through the prototype tree). */
export function assertCellRing(tree, cell) {
  if (!cell || cell.ring === undefined) return;
  if (tree.ring !== cell.ring) throw new Error(`cell ${cell.id ?? '?'} is ring ${cell.ring} but the tree is ${tree.kind} (ring ${tree.ring}): a vertical cell is built only through the production-vertical tree, a horizontal one only through the prototype tree`);
}

/** The ring check plus, for a ring-1 tree, the production-vertical proof re-run NOW from the files on disk. Returns that proof (also stored as `tree.production`), or null for any other tree. */
export function assertTreeForCell(tree, cell) {
  assertCellRing(tree, cell);
  return refreshProof(tree);
}

/** Re-runs the production-vertical proof for a ring-1 tree and stores it as `tree.production`; null for a tree of any other ring. A stamp carries the proof of the check that gated ITS build, never the one from tree creation. */
export function refreshProof(tree) {
  if (tree.ring !== 1) return null;
  tree.production = verifyProductionVertical(tree.root, tree.applied);
  return tree.production;
}

/**
 * Imports the patched copy's own modules (a distinct file URL per tree, so module caches never alias the real tree). A ring-1 tree is re-proved first: every build path goes through here.
 * A ring-1 tree's modules also load through the consumed-input guard (below): the source the loader actually read is hashed and must be the expected blob, so the proof above and the
 * bytes the modules were compiled from cannot differ.
 */
export async function loadTree(tree) {
  refreshProof(tree);
  const u = (p) => pathToFileURL(path.join(tree.root, p)).href;
  const pipeline = await import(u('main/build/pipeline.js'));
  const projectIo = await import(u('main/project-io.js'));
  const shared = await import(u('shared/project.js'));
  const cartridge = await import(u('shared/cartridge.js'));
  return { buildProject: pipeline.buildProject, saveProject: projectIo.saveProject, shared, cartridge, tree, proof: tree.production ?? null };
}
