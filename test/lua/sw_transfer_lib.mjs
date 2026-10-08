// The harness-transfer certificate's shared library: the pins, the archive, the validation (the CONSUMER side, no Mesen, no rebuild), and the pilot
// selection. test/lua/sw_harness_transfer.mjs (the producer) and test/lua/sw_identity_cert.mjs (the consumer of a transfer pointer) import it; it imports
// only test/lua/sw_provenance.mjs, so nothing here is circular.
//
// WHY. test/fixtures/streambound-curve.json records the harness (the six HARNESS_FILES of sw_provenance.mjs) that took its Mesen measurements. When the
// harness moves (phase 3b S1b changed run_sw_manifest.mjs and sw_manifest_scene.mjs for ring cells), the recorded bounds stand for the new harness only if
// the two harnesses are PROVEN to measure the curve's workload identically. A transfer certificate is that proof: the old harness, executed from a tree
// whose six files equal the checked-in archive byte for byte, and the new harness each re-render every one of the curve's recorded jobs, both reproduce
// the record's own cache key, project, ROM and symbol bindings, agree with each other job by job, and a pinned coverage pilot of ~40 jobs through real
// Mesen under both harnesses parses to the same measurement. It is bound to the recorded engine and generator; it says nothing about any other harness.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HARNESS_FILES, EXEC_FLAGS, UNIFORM_FIELDS } from './sw_provenance.mjs';

export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const HEX64 = /^[0-9a-f]{64}$/;
export const isHex = (v) => typeof v === 'string' && HEX64.test(v);

export const TRANSFER_KIND = 'harness-transfer-certificate';
export const TRANSFER_VERSION = 1;
export const TOOL_VERSION = 1;
export const TRANSFER_DIR_REL = 'test/fixtures/harness-transfer';
export const ARCHIVE_DIR_REL = `${TRANSFER_DIR_REL}/archive-7b1155d0e306`;
export const ARCHIVE_SUFFIX = '.archived';
export const PILOT_MIN = 40;
export const TRANSFER_STAGES = ['A', 'B', 'C', 'F', 'R', 'P']; // the sweep's stages (sw_identity_cert.mjs STAGES; a unit test pins the two equal)
export const TRANSFER_SCOPE = 'harness transfer: every recorded Mesen-run job re-rendered by the archived old harness and by the current harness at the recorded engine and generator, project/ROM/key/symbol bindings equal job by job, and a pinned coverage pilot measured equal through Mesen';

/**
 * The files the measurement build depends on that no source-state hash covers: HARNESS_FILES, main/build/ and shared/ (the generator hash) and the
 * engine (the engine fingerprint) are hashed, but the scene builder also imports these. Pinned here, enforced by every consumer, deliberately NOT folded
 * into harnessHash (that would move the recorded hash and the frozen ring gate's baseline). A unit test recomputes the import closure of the harness files
 * and requires it to be exactly this list, so a new dependency cannot slip in unpinned.
 */
export const HELPER_FILES = ['main/paths.js', 'main/project-io.js', 'main/savequeue.js', 'test/lib/enginefingerprint.js', 'test/lib/equates.js'];

const readSha = (f) => sha256(fs.readFileSync(f));
export const sealOf = (cert) => { const { selfDigest, ...rest } = cert; return sha256(JSON.stringify(rest)); };
export const sortedDigest = (lines) => sha256(lines.slice().sort().join('\n'));

/** sha-256 of each helper file under `root`. */
export const helperPins = (root) => Object.fromEntries(HELPER_FILES.map((f) => [f, readSha(path.join(root, f))]));
/** sha-256 of each of the six harness files under `root`. */
export const harnessFileShas = (root) => Object.fromEntries(HARNESS_FILES.map((n) => [n, readSha(path.join(root, 'test/lua', n))]));
/** The archive's files (name -> sha-256), read from `dir` (each stored as `<name>.archived`). */
export const archiveFileShas = (dir) => Object.fromEntries(HARNESS_FILES.map((n) => [n, readSha(path.join(dir, n + ARCHIVE_SUFFIX))]));
/** harnessHash's own algorithm (sw_provenance.mjs hashFiles) over the archive: `test/lua/<name>` + "\n" + bytes + "\n", in HARNESS_FILES order. */
export function archivedHarnessHash(dir) {
  const h = crypto.createHash('sha256');
  for (const n of HARNESS_FILES) { h.update(`test/lua/${n}\n`); h.update(fs.readFileSync(path.join(dir, n + ARCHIVE_SUFFIX))); h.update('\n'); }
  return h.digest('hex');
}

/** Local (relative) import specifiers of a module's source: static `from '...'`, `import '...'` and `import('...')`. */
export function localImports(text) {
  const out = [];
  for (const re of [/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g, /\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g, /^\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/gm]) for (const m of text.matchAll(re)) out.push(m[1]);
  return out;
}
/**
 * The files outside `main/build/`, `shared/` and the harness files themselves that the harness files reach through relative imports (transitively, over
 * files that exist). Computed from source, so a unit test can hold HELPER_FILES to it.
 */
export function helperClosure(root) {
  const seen = new Set(); const stack = HARNESS_FILES.filter((n) => n.endsWith('.mjs')).map((n) => `test/lua/${n}`);
  const helpers = new Set();
  while (stack.length) {
    const rel = stack.pop();
    if (seen.has(rel)) continue; seen.add(rel);
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    for (const spec of localImports(fs.readFileSync(abs, 'utf8'))) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      if (target.startsWith('..') || !fs.existsSync(path.join(root, target))) continue;
      if (target.startsWith('main/build/') || target.startsWith('shared/')) continue; // the generator hash covers these
      if (HARNESS_FILES.some((n) => target === `test/lua/${n}`)) continue; // the harness hash covers these
      if (target.startsWith('test/lua/ring_gate/')) continue; // an optional CLI-only import (run_sw_manifest.mjs --ring), never reached by a curve job; the ring gate pins its own files
      helpers.add(target);
      if (target.endsWith('.js') || target.endsWith('.mjs')) stack.push(target);
    }
  }
  return [...helpers].sort();
}

/** What must be true of the tree that executes the OLD harness before a single old-side job runs (F3): not "a worktree named for a commit". */
export function verifyOldTree({ oldTree, archiveDir, curve, newTree }) {
  const p = []; const need = (ok, m) => { if (!ok) p.push(m); };
  const want = curve.provenance.harness;
  let archive; try { archive = archivedHarnessHash(archiveDir); } catch (e) { return [`the archive cannot be read: ${e.message}`]; }
  need(archive === want, `the archived old harness (${archive.slice(0, 12)}) is not the curve's recorded harness (${want.slice(0, 12)})`);
  let files; try { files = harnessFileShas(oldTree); } catch (e) { return [...p, `the old tree's harness cannot be read: ${e.message}`]; }
  const arch = archiveFileShas(archiveDir);
  for (const n of HARNESS_FILES) need(files[n] === arch[n], `the old tree's ${n} is not the archived file (the old pass would not execute the recorded harness)`);
  let helpers; try { helpers = helperPins(oldTree); } catch (e) { return [...p, `the old tree's helper files cannot be read: ${e.message}`]; }
  if (newTree) { const theirs = helperPins(newTree); for (const f of HELPER_FILES) need(helpers[f] === theirs[f], `helper ${f} differs between the old tree and the current tree`); }
  return p;
}

// ---- validation (the consumer) --------------------------------------------------------------------------------------------------
/**
 * The problems that stop `cert` from certifying the checked-in curve's harness change for the live sources `live` ({harness, harnessFiles, helpers}).
 * [] = valid. Pure; `archiveDir` is where the archived old harness lives. A unit test drives each condition.
 */
export function validateTransfer(cert, { curve, curveBytes, live, archiveDir }) {
  const p = []; const need = (ok, m) => { if (!ok) p.push(m); };
  if (!cert || typeof cert !== 'object') return ['not an object'];
  need(cert.kind === TRANSFER_KIND && cert.version === TRANSFER_VERSION, 'not a version-1 harness-transfer certificate');
  need(cert.tool?.version === TOOL_VERSION, `produced by transfer tool version ${cert.tool?.version}, this is ${TOOL_VERSION}`);
  need(cert.selfDigest === sealOf(cert), 'the seal does not match the contents (the transfer certificate was edited)');
  need(cert.scope === TRANSFER_SCOPE, 'the scope is not this tool\'s scope');
  need(cert.partial === false, 'a partial run is not a certificate');
  // the curve and the evidence it was proven against
  need(cert.curve?.sha256 === sha256(curveBytes), 'the pinned curve digest is not the checked-in curve');
  for (const f of UNIFORM_FIELDS) need(cert.curve?.provenance?.[f] === curve.provenance?.[f], `the pinned curve provenance.${f} differs from the curve`);
  const w = cert.workset ?? {};
  need(Number.isInteger(w.directCount) && w.directCount > 0, 'no direct records');
  need(w.directCount === curve.jobs - curve.reused + curve.confirms && w.reuseCount === curve.reused && w.confirms === curve.confirms, 'the counts are not the curve\'s own job/reuse/confirmation counts');
  need(isHex(w.directDigest) && isHex(w.reuseDigest), 'direct/reuse digests missing');
  for (const s of TRANSFER_STAGES) need(isHex(cert.stages?.[s]?.sha256) && cert.stages[s].lines > 0, `stage ${s} digest missing`);
  // the OLD side is the curve's recorded harness, and the archive is what executed
  need(cert.oldHarness === curve.provenance?.harness, 'the transfer\'s old harness is not the curve\'s recorded harness');
  let archiveHash = null; let archiveShas = null;
  try { archiveHash = archivedHarnessHash(archiveDir); archiveShas = archiveFileShas(archiveDir); } catch (e) { p.push(`the archive cannot be read: ${e.message}`); }
  if (archiveHash) need(archiveHash === cert.oldHarness, 'the archived old harness is not the recorded one');
  need(cert.archive?.hash === cert.oldHarness, 'the certificate\'s archive hash is not its old harness');
  // the NEW side is the live harness, file by file
  need(isHex(cert.newHarness) && cert.newHarness === live.harness, 'the transfer\'s new harness is not the live harness');
  need(cert.newHarness !== cert.oldHarness, 'a transfer between equal harnesses proves nothing');
  const rows = Array.isArray(cert.files) ? cert.files : [];
  need(rows.length === HARNESS_FILES.length && HARNESS_FILES.every((n, i) => rows[i]?.name === n), 'the per-file table is not the six harness files in order');
  const changed = [];
  for (const r of rows) {
    if (archiveShas) need(r.oldSha === archiveShas[r.name], `${r.name}: the pinned old sha is not the archived file's`);
    need(live.harnessFiles?.[r.name] === r.newSha, `${r.name}: the live file is not the certified one (the live harness is not the certified one)`);
    need(r.status === (r.oldSha === r.newSha ? 'unchanged' : 'changed'), `${r.name}: status does not match its shas`);
    if (r.oldSha !== r.newSha) changed.push(r.name);
  }
  const declared = [...(cert.declaredInert ?? [])].sort((a, b) => HARNESS_FILES.indexOf(a) - HARNESS_FILES.indexOf(b));
  need(JSON.stringify(changed) === JSON.stringify(declared), 'an undeclared harness file changed (the changed files are not exactly the declared ones)');
  // the helpers, enforced
  need(JSON.stringify(Object.keys(cert.helpers?.new ?? {})) === JSON.stringify(HELPER_FILES) && JSON.stringify(cert.helpers?.new) === JSON.stringify(cert.helpers?.old), 'the helper pins are not the pinned helper files, equal on both sides');
  need(live.helpers !== undefined && JSON.stringify(cert.helpers?.new) === JSON.stringify(live.helpers), 'a helper file differs from the certified one');
  // the recorded sources the experiment ran on, and the execution flags
  need(cert.recorded?.engine === curve.provenance?.engine && cert.recorded?.generator === curve.provenance?.generator && cert.recorded?.mesen === curve.provenance?.mesen, 'the experiment\'s engine/generator/Mesen are not the curve\'s recorded ones');
  need(JSON.stringify(cert.execFlags) === JSON.stringify(EXEC_FLAGS), 'the execution flags are not the live ones');
  // each side, independently
  for (const [side, harness] of [['old', cert.oldHarness], ['new', cert.newHarness]]) {
    const s = cert.sides?.[side] ?? {}; const c = s.counts ?? {};
    need(c.expected === w.directCount && c.answered === w.directCount && c.matched === w.directCount && c.keysReproduced === w.directCount, `${side} side: expected ${c.expected} / answered ${c.answered} / matched ${c.matched} / keys ${c.keysReproduced} are not all the ${w.directCount} direct records`);
    need(c.mismatched === 0 && c.errored === 0, `${side} side: mismatches or errors recorded`);
    need(c.reusesResolved === w.reuseCount, `${side} side: a reuse record was not resolved`);
    need(s.directDigest === w.directDigest && s.reuseDigest === w.reuseDigest, `${side} side: its stage/direct/reuse digests are not the workset's`);
    need(isHex(s.luaDigest) && isHex(s.symDigest) && s.scriptsScanned === w.directCount && s.symLines === w.directCount, `${side} side: no rendered-script / symbol-line evidence for every direct job`);
    need(s.cnevHits === 0, `${side} side: a rendered script prints a CN/EV line`);
    const b = s.sources?.before; const a = s.sources?.after;
    need(b && a && UNIFORM_FIELDS.every((f) => b[f] === a[f]) && b.helpersDigest === a.helpersDigest, `${side} side: the sources moved during the run`);
    need(b?.harness === harness && b?.engine === cert.recorded?.engine && b?.generator === cert.recorded?.generator && b?.mesen === cert.recorded?.mesen, `${side} side: the run's sources are not the certified ones`);
    need(b?.helpersDigest === sha256(String(JSON.stringify(cert.helpers?.[side]))), `${side} side: the run's helper files are not the pinned ones`);
  }
  need(cert.sides?.old?.luaDigest === cert.sides?.new?.luaDigest && cert.sides?.old?.symDigest === cert.sides?.new?.symDigest, 'the two sides rendered different scripts or symbol tables');
  const pr = cert.pairs ?? {};
  need([pr.compared, pr.equalProject, pr.equalRom, pr.equalRomFile, pr.equalLua, pr.equalSym].every((v) => v === w.directCount) && isHex(pr.digest), 'the per-id old-vs-new comparison does not cover and match every direct job');
  // the pilot
  const pl = cert.pilot ?? {};
  const manifest = Array.isArray(pl.manifest) ? pl.manifest : [];
  need(manifest.length >= PILOT_MIN && pl.manifestDigest === sha256(JSON.stringify(manifest)), `the pilot manifest is missing, short of ${PILOT_MIN}, or not its digest`);
  const results = Array.isArray(pl.results) ? pl.results : [];
  need(results.length === manifest.length && manifest.every((m, i) => results[i]?.id === m.id), 'pilot incomplete: a manifest job has no result');
  for (const r of results) {
    need(r.complete === true && r.noExtraKeys === true && isHex(r.oldDigest) && r.oldDigest === r.newDigest, `pilot differs: ${r.id} ${r.oldDigest === r.newDigest ? 'is incomplete or has counters/events keys' : 'old and new measurements are not equal'}`);
    if (p.length > 80) break;
  }
  return p;
}

/** The transfer certificates in `dir`, each validated for the live sources: [{file, selfDigest, problems}]. */
export function checkTransfers(dir, ctx) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    let cert; try { cert = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return { file: f, selfDigest: null, problems: [`unreadable: ${e.message}`] }; }
    return { file: f, selfDigest: cert?.selfDigest ?? null, newHarness: cert?.newHarness ?? null, stages: cert?.stages ?? null, problems: validateTransfer(cert, { archiveDir: path.join(dir, path.basename(ARCHIVE_DIR_REL)), ...ctx }) };
  });
}

// ---- the pilot ----------------------------------------------------------------------------------------------------------------
/** The family of a job's authored mutation (what makeMutate branches on), or 'none'. */
export const cfgFamily = (r) => (r.cfg ? Object.keys(r.cfg).sort().join('+') : 'none');
/** The coverage values one direct record holds: every runner branch and recipe choice a curve job can take. */
export function pilotTags(r, reuseSources) {
  return [
    `stage:${r.stage}`, `gt:${r.gt}`, `scenario:${r.scenario ?? 'walk'}`, `wide:${!!r.wide}`, `y:${r.y !== null && r.y !== undefined}`, `gridH:${r.gridH ?? 'default'}`,
    `anim:${r.anim ?? 'P0'}`, `cfg:${cfgFamily(r)}`, `stagecfg:${r.stage}/${cfgFamily(r)}`, `flashX:${r.flashX ?? 'default'}`, `shape:${r.shape ?? 'none'}`, `k:${r.k ?? 'none'}`,
    `idle:${!!r.idle}`, `confirm:${!!r.confirmOf}`, `reuseSource:${reuseSources.has(r.id)}`, `contactEndpoint:${r.stage === 'R'}`
  ];
}
/**
 * The pinned coverage pilot, a deterministic function of the validated direct records: a greedy cover of every tag value (most uncovered tags first, ties
 * by the id's own sha-256), then a fill to `size` taking the lowest-hash unchosen job of each stage in turn. Returns [{id, tags}] in selection order.
 */
export function selectPilot(direct, reuses, size = PILOT_MIN) {
  const reuseSources = new Set(reuses.map((r) => r.reuse?.of));
  const tagged = direct.map((r) => ({ id: r.id, stage: r.stage, tags: pilotTags(r, reuseSources), h: sha256(r.id) })).sort((a, b) => (a.h < b.h ? -1 : 1));
  const uncovered = new Set(tagged.flatMap((t) => t.tags));
  const chosen = [];
  while (uncovered.size) {
    let best = null; let bestN = 0;
    for (const t of tagged) { if (chosen.includes(t)) continue; const n = t.tags.reduce((a, x) => a + (uncovered.has(x) ? 1 : 0), 0); if (n > bestN) { best = t; bestN = n; } }
    if (!best) break;
    chosen.push(best); for (const x of best.tags) uncovered.delete(x);
  }
  const stages = [...new Set(tagged.map((t) => t.stage))].sort();
  for (let round = 0; chosen.length < size; round++) {
    let added = false;
    for (const s of stages) { if (chosen.length >= size) break; const t = tagged.find((x) => x.stage === s && !chosen.includes(x)); if (t) { chosen.push(t); added = true; } }
    if (!added) break;
  }
  return chosen.map((t) => ({ id: t.id, tags: t.tags }));
}

/** `v` with every object's keys in sorted order (arrays keep their order). */
export const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);
/** The measurement fields a pilot compares, taken from a runManifest result (symbols reduced to a digest). `extra` lists keys the old harness cannot have produced. */
export function pilotMeasurement(r) {
  // key order is canonicalised: the template's `pairs()` over the per-class table prints its classes in a Lua-hash order that varies between two runs of the SAME harness
  const body = canonical({ phases: r.phases, trace: r.trace, marks: r.marks, contact: r.contact ?? null, done: r.done, timeout: r.timeout, frames: r.frames, status: r.status, symbols: sha256(JSON.stringify(r.symbols ?? null)) });
  const keys = r.keys ?? Object.keys(r);
  const extra = ['counters', 'events', 'boundSyms', 'script', 'sceneProject', 'sceneScreens'].filter((k) => keys.includes(k));
  return { body, digest: sha256(JSON.stringify(body)), extra };
}
