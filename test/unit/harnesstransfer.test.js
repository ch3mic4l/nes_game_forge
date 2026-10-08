// The harness-transfer certificate (test/lua/sw_harness_transfer.mjs, test/lua/sw_transfer_lib.mjs, test/lua/sw_transfer_worker.mjs): the checked-in archive and
// certificate, every rejecting control (each mutates a VALID certificate or a pure input and must fail at its own comparison, re-sealed where the
// control is semantic so the seal is not what rejects it), the pure comparisons, the pilot selection, the pinned helper closure and the shared rebuild
// worker's recipe (review F1: a real R job renders its contact endpoint; the same job without it renders another script).
// Nothing here runs Mesen; the one render builds an RPG scene (no emulator).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { REPO } from '../lua/sw_manifest_scene.mjs';
import { HARNESS_FILES } from '../lua/sw_provenance.mjs';
import { plan, manifestArgs } from '../lua/sw_bound_sweep.mjs';
import { STAGES, runPool, liveSources, liveTransfers, validateCertificate, curveEvidenceVerdict } from '../lua/sw_identity_cert.mjs';
import { comparePairs, comparePilot } from '../lua/sw_harness_transfer.mjs';
import {
  TRANSFER_DIR_REL, ARCHIVE_DIR_REL, TRANSFER_STAGES, HELPER_FILES, PILOT_MIN, TRANSFER_SCOPE, ARCHIVE_SUFFIX,
  validateTransfer, checkTransfers, archivedHarnessHash, archiveFileShas, harnessFileShas, helperPins, helperClosure, localImports, verifyOldTree, selectPilot, pilotTags, pilotMeasurement, canonical, sealOf, sha256
} from '../lua/sw_transfer_lib.mjs';

const ROOT = REPO;
const sha = sha256;
const curveBytes = fs.readFileSync(path.join(ROOT, 'test/fixtures/streambound-curve.json'));
const curve = JSON.parse(curveBytes);
const archiveDir = path.join(ROOT, ARCHIVE_DIR_REL);
const transferDir = path.join(ROOT, TRANSFER_DIR_REL);
const certFiles = fs.readdirSync(transferDir).filter((f) => f.endsWith('.json'));
const CERT = JSON.parse(fs.readFileSync(path.join(transferDir, certFiles[0]), 'utf8'));
const live = liveSources(ROOT);
const ctx = { curve, curveBytes, live, archiveDir };
const reseal = (c) => ({ ...c, selfDigest: sealOf(c) });
const mutate = (fn) => reseal(fn(structuredClone(CERT)));
const problemsOf = (cert, c = ctx) => validateTransfer(cert, c);
const refuses = (cert, re, c = ctx) => { const p = problemsOf(cert, c); assert.ok(p.some((m) => re.test(m)), `${re}: got ${JSON.stringify(p.slice(0, 4))}`); return p; };

// ---- the checked-in artifacts -----------------------------------------------------------------------------------------------------------------
test('exactly one transfer certificate is checked in, and it is valid for the live sources and the checked-in curve', () => {
  assert.equal(certFiles.length, 1, certFiles.join(','));
  assert.deepEqual(problemsOf(CERT), []);
  assert.equal(CERT.oldHarness, curve.provenance.harness, 'the OLD side is the harness the curve recorded');
  assert.equal(CERT.newHarness, live.harness, 'the NEW side is the live harness');
  assert.equal(CERT.scope, TRANSFER_SCOPE);
  const r = checkTransfers(transferDir, { curve, curveBytes, live });
  assert.deepEqual(r.map((x) => [x.file, x.problems]), [[certFiles[0], []]]);
});

test('the archive IS the recorded harness: its six files hash to the curve\'s recorded harness, file by file, and nothing else lives beside them', () => {
  assert.equal(archivedHarnessHash(archiveDir), curve.provenance.harness);
  assert.deepEqual(fs.readdirSync(archiveDir).sort(), HARNESS_FILES.map((n) => n + ARCHIVE_SUFFIX).sort());
  assert.deepEqual(CERT.files.map((f) => f.oldSha), HARNESS_FILES.map((n) => archiveFileShas(archiveDir)[n]));
  // only the two files S1b changed differ from the live harness; the template, the mutator, the sweep driver and the provenance module are byte-identical
  assert.deepEqual(CERT.declaredInert, ['run_sw_manifest.mjs', 'sw_manifest_scene.mjs']);
  assert.deepEqual(CERT.files.filter((f) => f.status === 'unchanged').map((f) => f.name), ['sw_manifest.lua.template', 'sw_sweep_mutate.mjs', 'sw_bound_sweep.mjs', 'sw_provenance.mjs']);
});

test('the certificate covers all 12,592 validated records on each side separately, and the pilot is the pinned ~40-job manifest', () => {
  const w = CERT.workset;
  assert.equal(w.directCount + w.reuseCount, 12592); assert.equal(w.directCount, 11760); assert.equal(w.reuseCount, 832); assert.equal(w.confirms, 2);
  for (const side of ['old', 'new']) {
    const c = CERT.sides[side].counts;
    assert.deepEqual([c.expected, c.answered, c.matched, c.keysReproduced, c.mismatched, c.errored, c.reusesResolved], [w.directCount, w.directCount, w.directCount, w.directCount, 0, 0, w.reuseCount], side);
    assert.equal(CERT.sides[side].cnevHits, 0); assert.equal(CERT.sides[side].scriptsScanned, w.directCount); assert.equal(CERT.sides[side].symLines, w.directCount);
  }
  assert.equal(CERT.pairs.compared, w.directCount); assert.equal(CERT.pairs.equalSym, w.directCount);
  assert.ok(CERT.pilot.manifest.length >= PILOT_MIN);
  assert.ok(CERT.pilot.results.every((r) => r.complete && r.noExtraKeys && r.oldDigest === r.newDigest));
  assert.deepEqual(Object.keys(CERT.stages), TRANSFER_STAGES);
});

// ---- rejecting controls on the certificate (each re-sealed, so the SEAL is not what refuses it) --------------------------------------------------
test('C1b/C5/C5b: a changed archive, a forged new harness, a relabelled old harness and a changed archived file are each refused at their own comparison', () => {
  // the archive is the only thing that pins the old side: one byte of the archived template and the old harness is "not the recorded one"
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-archive-'));
  for (const n of HARNESS_FILES) fs.copyFileSync(path.join(archiveDir, n + ARCHIVE_SUFFIX), path.join(tmp, n + ARCHIVE_SUFFIX));
  assert.deepEqual(problemsOf(CERT, { ...ctx, archiveDir: tmp }), [], 'the copy is valid');
  const f = path.join(tmp, 'sw_manifest.lua.template' + ARCHIVE_SUFFIX); const b = fs.readFileSync(f); b[b.length >> 1] ^= 1; fs.writeFileSync(f, b);
  refuses(CERT, /archived old harness is not the recorded one/, { ...ctx, archiveDir: tmp });
  refuses(mutate((c) => { c.newHarness = sha('a forged harness'); return c; }), /new harness is not the live harness/);
  refuses(mutate((c) => { c.newHarness = c.oldHarness; return c; }), /new harness is not the live harness|equal harnesses/);
  refuses(mutate((c) => { c.oldHarness = live.harness; return c; }), /old harness is not the curve's recorded harness/);
  refuses(mutate((c) => { c.oldHarness = live.harness; c.archive.hash = live.harness; return c; }), /archived old harness is not the recorded one/);
  refuses(mutate((c) => { c.files[1].oldSha = sha('another archived file'); return c; }), /pinned old sha is not the archived file/);
  refuses({ ...CERT, oldHarness: live.harness }, /seal does not match/);
});

test('C6/C6b/C7: an undeclared changed file, a declared file that moved again, and a moved live harness with a stale transfer are refused', () => {
  refuses(mutate((c) => { c.files[4].oldSha = sha('x'); c.files[4].status = 'changed'; return c; }), /undeclared harness file changed|pinned old sha/);
  refuses(mutate((c) => { c.declaredInert = ['run_sw_manifest.mjs']; return c; }), /undeclared harness file changed/);
  // a declared file moved again after the certificate: the live run_sw_manifest.mjs is not the certified one
  const live2 = { ...live, harnessFiles: { ...live.harnessFiles, 'run_sw_manifest.mjs': sha('a later run_sw_manifest') } };
  refuses(CERT, /run_sw_manifest.mjs: the live file is not the certified one/, { ...ctx, live: live2 });
  refuses(CERT, /new harness is not the live harness/, { ...ctx, live: { ...live, harness: sha('a later harness') } });
  refuses(mutate((c) => { c.files[0].status = 'changed'; return c; }), /status does not match its shas/);
});

test('F4: any helper file changing alone (engine, generator and harness equal) invalidates the certificate; the pin list is the six files\' import closure', () => {
  for (const f of HELPER_FILES) {
    const pins = { ...live.helpers, [f]: sha(`an edited ${f}`) };
    refuses(CERT, /a helper file differs from the certified one/, { ...ctx, live: { ...live, helpers: pins } });
  }
  refuses(CERT, /a helper file differs/, { ...ctx, live: { ...live, helpers: undefined } });
  refuses(mutate((c) => { c.helpers.old['main/paths.js'] = sha('other'); return c; }), /helper pins are not the pinned helper files, equal on both sides/);
  refuses(mutate((c) => { delete c.helpers.new['main/savequeue.js']; delete c.helpers.old['main/savequeue.js']; return c; }), /helper pins are not the pinned helper files/);
  // the closure of the harness files' relative imports outside main/build, shared and the harness itself IS the pin list (project-io's own dependencies included)
  assert.deepEqual(helperClosure(ROOT), [...HELPER_FILES].sort());
  assert.ok(HELPER_FILES.includes('main/paths.js') && HELPER_FILES.includes('main/savequeue.js'), 'project-io.js local dependencies');
  assert.deepEqual(localImports("import a from './x.js';\nimport('./y.mjs');\nimport './z.js';\nimport q from 'node:fs';\nexport { b } from '../w.js';"), ['./x.js', '../w.js', './y.mjs', './z.js']);
});

test('C4/F5: an incomplete transfer is refused whichever side or part lacks a job, independently', () => {
  for (const side of ['old', 'new']) {
    for (const field of ['expected', 'answered', 'matched', 'keysReproduced']) refuses(mutate((c) => { c.sides[side].counts[field] -= 1; return c; }), new RegExp(`${side} side: expected`));
    refuses(mutate((c) => { c.sides[side].counts.mismatched = 1; return c; }), new RegExp(`${side} side: mismatches or errors`));
    refuses(mutate((c) => { c.sides[side].counts.reusesResolved -= 1; return c; }), new RegExp(`${side} side: a reuse record was not resolved`));
    refuses(mutate((c) => { c.sides[side].scriptsScanned -= 1; return c; }), new RegExp(`${side} side: no rendered-script`));
    refuses(mutate((c) => { c.sides[side].symLines -= 1; return c; }), new RegExp(`${side} side: no rendered-script / symbol-line evidence`));
    refuses(mutate((c) => { c.sides[side].cnevHits = 1; return c; }), new RegExp(`${side} side: a rendered script prints a CN/EV line`));
    refuses(mutate((c) => { c.sides[side].directDigest = sha('another workset'); return c; }), new RegExp(`${side} side: its stage/direct/reuse digests`));
    refuses(mutate((c) => { c.sides[side].sources.after.generator = sha('moved'); return c; }), new RegExp(`${side} side: the sources moved`));
    refuses(mutate((c) => { c.sides[side].sources.before.engine = sha('another engine'); c.sides[side].sources.after.engine = c.sides[side].sources.before.engine; return c; }), new RegExp(`${side} side: the run's sources are not the certified ones`));
    refuses(mutate((c) => { c.sides[side].sources.before.helpersDigest = sha('other helpers'); c.sides[side].sources.after.helpersDigest = c.sides[side].sources.before.helpersDigest; return c; }), new RegExp(`${side} side: the run's helper files`));
  }
  refuses(mutate((c) => { c.pairs.compared -= 1; return c; }), /per-id old-vs-new comparison/);
  refuses(mutate((c) => { c.pairs.equalSym -= 1; return c; }), /per-id old-vs-new comparison/);
  refuses(mutate((c) => { c.pairs.equalLua -= 1; return c; }), /per-id old-vs-new comparison/);
  refuses(mutate((c) => { c.workset.directCount -= 1; return c; }), /counts are not the curve's own/);
  refuses(mutate((c) => { c.partial = true; return c; }), /partial/);
  // the two sides must also have rendered the SAME symbol tables and scripts (the symbol digest is its own comparison, not the seal)
  refuses(mutate((c) => { c.sides.new.symDigest = sha('another symbol table'); return c; }), /different scripts or symbol tables/);
  refuses(mutate((c) => { c.sides.old.luaDigest = sha('another script set'); return c; }), /different scripts or symbol tables/);
});

test('C8: a pilot with a missing job, a short manifest, a differing or incomplete measurement, or a counters/events key is refused', () => {
  refuses(mutate((c) => { c.pilot.results.pop(); return c; }), /pilot incomplete/);
  refuses(mutate((c) => { c.pilot.manifest = c.pilot.manifest.slice(0, 10); c.pilot.results = c.pilot.results.slice(0, 10); c.pilot.manifestDigest = sha(JSON.stringify(c.pilot.manifest)); return c; }), /pilot manifest is missing, short of/);
  refuses(mutate((c) => { c.pilot.manifestDigest = sha('another manifest'); return c; }), /not its digest/);
  refuses(mutate((c) => { c.pilot.results[3].newDigest = sha('another measurement'); return c; }), new RegExp(`pilot differs: ${CERT.pilot.results[3].id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  refuses(mutate((c) => { c.pilot.results[0].noExtraKeys = false; return c; }), /counters\/events keys/);
  refuses(mutate((c) => { c.pilot.results[0].complete = false; return c; }), /pilot differs/);
  refuses(mutate((c) => { c.pilot.manifest[0] = { ...c.pilot.manifest[0], id: 'nobody' }; c.pilot.manifestDigest = sha(JSON.stringify(c.pilot.manifest)); return c; }), /pilot incomplete/);
});

test('the certificate is refused for: another curve, other counts, a missing stage, other execution flags, another recorded engine, another scope or version, an edited seal', () => {
  refuses(CERT, /pinned curve digest/, { ...ctx, curveBytes: Buffer.from(JSON.stringify({ ...curve, rows: [] })) });
  refuses(mutate((c) => { c.curve.sha256 = sha('another curve'); return c; }), /pinned curve digest/);
  refuses(mutate((c) => { delete c.stages.C; return c; }), /stage C digest missing/);
  refuses(mutate((c) => { c.execFlags = { args: [], killMs: 1 }; return c; }), /execution flags/);
  refuses(mutate((c) => { c.recorded.engine = sha('another engine'); return c; }), /recorded ones/);
  refuses(mutate((c) => { c.scope = 'everything'; return c; }), /scope/);
  refuses(mutate((c) => { c.tool.version = 99; return c; }), /transfer tool version/);
  refuses(mutate((c) => { c.version = 2; return c; }), /version-1 harness-transfer/);
  refuses({ ...CERT, workset: { ...CERT.workset } , selfDigest: sha('forged') }, /seal does not match/);
  assert.deepEqual(validateTransfer(null, ctx), ['not an object']);
  assert.ok(validateTransfer({ kind: 'harness-transfer-certificate', version: 1, selfDigest: 'x' }, ctx).length > 0);
});

// ---- F3: the old side that executes is the archived one ---------------------------------------------------------------------------------------------
test('F3: the old tree must hold the archived harness byte for byte; the current tree, or one with a single changed harness byte, is refused while the archive is intact', () => {
  const copy = (dest, edit) => {
    fs.mkdirSync(path.join(dest, 'test/lua'), { recursive: true });
    for (const n of HARNESS_FILES) fs.copyFileSync(path.join(archiveDir, n + ARCHIVE_SUFFIX), path.join(dest, 'test/lua', n));
    for (const f of HELPER_FILES) { fs.mkdirSync(path.dirname(path.join(dest, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(dest, f)); }
    edit?.(dest);
  };
  const good = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-oldtree-')); copy(good);
  assert.deepEqual(verifyOldTree({ oldTree: good, archiveDir, curve, newTree: ROOT }), [], 'a tree holding the archive passes');
  // the CURRENT tree as --old-tree: its runner/scene builder are the new ones
  const asOld = verifyOldTree({ oldTree: ROOT, archiveDir, curve, newTree: ROOT });
  assert.ok(asOld.some((m) => /run_sw_manifest.mjs is not the archived file/.test(m)) && asOld.some((m) => /sw_manifest_scene.mjs is not the archived file/.test(m)), asOld.join('|'));
  // one byte of one harness file
  const bent = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-oldtree-')); copy(bent, (d) => { const f = path.join(d, 'test/lua/sw_sweep_mutate.mjs'); fs.appendFileSync(f, '\n'); });
  assert.ok(verifyOldTree({ oldTree: bent, archiveDir, curve, newTree: ROOT }).some((m) => /sw_sweep_mutate.mjs is not the archived file/.test(m)));
  // a helper file that differs between the trees
  const help = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-oldtree-')); copy(help, (d) => fs.appendFileSync(path.join(d, 'main/paths.js'), '\n'));
  assert.ok(verifyOldTree({ oldTree: help, archiveDir, curve, newTree: ROOT }).some((m) => /helper main\/paths.js differs/.test(m)));
  // an archive that is not the recorded harness makes every old pass meaningless
  const badArchive = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-archive-')); for (const n of HARNESS_FILES) fs.copyFileSync(path.join(archiveDir, n + ARCHIVE_SUFFIX), path.join(badArchive, n + ARCHIVE_SUFFIX));
  fs.appendFileSync(path.join(badArchive, 'sw_provenance.mjs' + ARCHIVE_SUFFIX), '\n');
  assert.ok(verifyOldTree({ oldTree: good, archiveDir: badArchive, curve, newTree: ROOT }).some((m) => /archived old harness .* is not the curve's recorded harness/.test(m)));
  assert.ok(verifyOldTree({ oldTree: path.join(os.tmpdir(), 'no-such-tree'), archiveDir, curve })[0].includes('cannot be read'));
});

// ---- F5: the pure comparisons --------------------------------------------------------------------------------------------------------------------
const answers = (ids, over = {}) => ({
  hashOf: new Map(ids.map((id) => [id, { project: sha('p' + id), rom: sha('r' + id), romFile: sha('r' + id), ...(over.hash?.[id] ?? {}) }])),
  luaOf: new Map(ids.map((id) => [id, over.lua?.[id] ?? sha('l' + id)])), symOf: new Map(ids.map((id) => [id, over.sym?.[id] ?? sha('s' + id)]))
});
test('comparePairs: every direct job is compared id by id; a differing project/ROM/ROM-file/Lua/SYM, a missing answer on either side, or an empty symbol line each fail on their own', () => {
  const ids = ['a', 'b', 'c'];
  const ok = comparePairs(ids, answers(ids), answers(ids));
  assert.deepEqual(ok.problems, []); assert.equal(ok.compared, 3); assert.equal(ok.equalSym, 3); assert.match(ok.digest, /^[0-9a-f]{64}$/);
  const one = (o, n, re) => { const r = comparePairs(ids, o, n); assert.ok(r.problems.some((m) => re.test(m)), `${re}: ${r.problems}`); return r; };
  one(answers(ids), answers(ids, { hash: { b: { project: sha('other') } } }), /b: the normalized project differs/);
  one(answers(ids), answers(ids, { hash: { b: { rom: sha('other') } } }), /b: the ROM hash differs/);
  one(answers(ids), answers(ids, { hash: { b: { romFile: sha('other') } } }), /b: the ROM file differs/);
  one(answers(ids), answers(ids, { lua: { c: sha('a rebound symbol') } }), /c: the rendered Lua differs/);
  // C2: the symbol line alone differs (the Lua digest is equal): only the pair comparison sees it, the cache key does not
  const r = one(answers(ids), answers(ids, { sym: { a: sha('another SYM line') } }), /a: the symbol bindings differ/);
  assert.equal(r.equalLua, 3); assert.equal(r.equalSym, 2);
  one(answers(ids), answers(ids, { sym: { a: sha('') } }), /a: no valid symbol-line evidence/);
  // C4: one job missing on the OLD side only, on the NEW side only
  const dropOld = answers(ids); dropOld.hashOf.delete('b');
  const rOld = one(dropOld, answers(ids), /b: no answer on the old side/); assert.equal(rOld.compared, 2);
  const dropNew = answers(ids); dropNew.hashOf.delete('c');
  one(answers(ids), dropNew, /c: no answer on the new side/);
});

const measurement = (over = {}) => ({ phases: { walkD: { maxG: 100, gateFail: 0, n: 5, bind: { x: 1 }, classes: { 'st0.q0': { n: 1 }, 'st1.q0': { n: 2 } } } }, trace: {}, marks: {}, done: true, timeout: false, frames: 640, status: 0, symbols: sha('syms'), keys: ['done', 'frames', 'marks', 'phases', 'status', 'symbols', 'timeout', 'trace'], ...over });
test('comparePilot: equal complete measurements pass (class key order is canonical); a differing field, an incomplete run, a counters/events key or a missing job each fail', () => {
  const man = [{ id: 'j1' }, { id: 'j2' }];
  const recs = new Map([['j1', { id: 'j1', stage: 'A', frames: 640, phases: { walkD: { maxG: 100, gateFail: 0, n: 5 } } }], ['j2', { id: 'j2', stage: 'R', frames: 640, phases: { walkD: { maxG: 100, gateFail: 0, n: 5 } } }]]);
  const set = (...ms) => new Map(man.map((m, i) => [m.id, ms[i]]));
  const reordered = measurement(); reordered.phases.walkD.classes = { 'st1.q0': { n: 2 }, 'st0.q0': { n: 1 } }; // Lua's pairs() order differs between two runs of one harness
  const ok = comparePilot(man, set(measurement(), measurement({ contact: { frame: 640, phase: 'walkD' } })), set(reordered, measurement({ contact: { frame: 640, phase: 'walkD' } })), recs);
  assert.deepEqual(ok.problems, []); assert.ok(ok.results.every((r) => r.complete && r.noExtraKeys && r.oldDigest === r.newDigest && r.matchesRecorded));
  const bad = (a, b, re, rs = recs) => { const r = comparePilot(man, a, b, rs); assert.ok(r.problems.some((m) => re.test(m)), `${re}: ${r.problems}`); };
  const contact = { contact: { frame: 640, phase: 'walkD' } };
  bad(set(measurement(), measurement(contact)), set(measurement({ frames: 641 }), measurement(contact)), /j1 frames/);
  bad(set(measurement(), measurement(contact)), set(measurement({ symbols: sha('other') }), measurement(contact)), /j1 symbols/);
  bad(set(measurement(), measurement(contact)), set(measurement(), measurement({ ...contact, phases: { walkD: { maxG: 101, gateFail: 0, n: 5 } } })), /j2 phases/);
  bad(set(measurement(), measurement(contact)), set(measurement({ keys: ['counters', 'done'] }), measurement(contact)), /counters/);
  bad(set(measurement(), measurement(contact)), set(measurement({ done: false }), measurement(contact)), /did not complete/);
  bad(set(measurement({ timeout: true }), measurement(contact)), set(measurement({ timeout: true }), measurement(contact)), /did not complete/); // two equal failures are not success
  bad(set(measurement(), measurement()), set(measurement(), measurement()), /j2 did not complete/); // an R job without its contact marker
  const half = set(measurement(), measurement(contact)); half.delete('j2');
  bad(half, set(measurement(), measurement(contact)), /j2 has no old-harness measurement/);
  bad(set(measurement(), measurement(contact)), half, /j2 has no new-harness measurement/);
  assert.deepEqual(canonical({ b: 1, a: { d: 1, c: [{ z: 1, y: 2 }] } }), { a: { c: [{ y: 2, z: 1 }], d: 1 }, b: 1 });
  assert.equal(pilotMeasurement(measurement()).digest, pilotMeasurement(reordered).digest);
});

test('selectPilot: deterministic, at least 40 jobs, every tag value covered, reuse sources and confirmations included, no id twice', () => {
  const rows = []; let n = 0;
  for (const stage of ['A', 'B', 'C', 'F', 'R', 'P']) for (const cfg of [null, { k: 1, flash: true }, { bound: true, k: 2 }]) for (const wide of [true, false]) for (const k of [0, 7]) {
    rows.push({ id: `${stage}${n++}`, stage, gt: stage === 'R' ? 'rpg' : 'action', wide, anim: `P${n % 9}`, y: n % 5 ? 200 + n : null, k, shape: ['even', 'front'][n % 2], flashX: n % 7 ? 242 : 241, gridH: n % 3 ? 60 : null, cfg, scenario: 'walk', idle: 0 });
  }
  rows.push({ ...rows[0], id: `${rows[0].id}#confirm`, confirmOf: rows[0].id });
  const reuses = [{ id: 'u1', reuse: { of: rows[5].id } }];
  const a = selectPilot(rows, reuses); const b = selectPilot([...rows].reverse(), reuses);
  assert.deepEqual(a, b, 'independent of the input order');
  assert.ok(a.length >= PILOT_MIN); assert.equal(new Set(a.map((x) => x.id)).size, a.length);
  const covered = new Set(a.flatMap((x) => x.tags)); const all = new Set(rows.flatMap((r) => pilotTags(r, new Set([rows[5].id]))));
  for (const t of all) assert.ok(covered.has(t), `tag ${t} is not covered`);
  assert.ok(a.some((x) => x.tags.includes('confirm:true')) && a.some((x) => x.tags.includes('reuseSource:true')) && a.some((x) => x.tags.includes('contactEndpoint:true')));
  assert.notDeepEqual(selectPilot(rows.filter((r) => r.id !== a[0].id), reuses), a, 'a different record set is a different manifest');
});

// ---- F1: the shared worker rebuilds through the sweep's own manifestArgs --------------------------------------------------------------------------------
test('F1: the worker and the identity certifier rebuild through manifestArgs, never a hand-copied recipe, and the stage list is the certifier\'s', () => {
  const worker = fs.readFileSync(path.join(ROOT, 'test/lua/sw_transfer_worker.mjs'), 'utf8');
  assert.match(worker, /sweep\.manifestArgs\(rec,/);
  assert.doesNotMatch(worker, /SCENARIOS|ANIM_PRESETS|makeMutate|contactEndpoint: true/, 'no recipe of its own');
  const cert = fs.readFileSync(path.join(ROOT, 'test/lua/sw_identity_cert.mjs'), 'utf8');
  assert.doesNotMatch(cert, /rebuildOne|ANIM_PRESETS|makeMutate|SCENARIOS\[/, 'the old hand-copied recipe is gone');
  assert.match(cert, /sw_transfer_worker\.mjs/);
  assert.deepEqual(TRANSFER_STAGES, STAGES);
});

test('F1: a real R job rendered through the shared worker carries the contact endpoint (ST_BATTLE, the contact idle register); the same job without it renders another script', async () => {
  const job = plan('R')[0];
  assert.equal(manifestArgs(job).contactEndpoint, true, 'stage R: the sweep asks for the endpoint');
  const worker = fileURLToPath(new URL('../lua/sw_transfer_worker.mjs', import.meta.url));
  const rec = { ...job, prov: { engine: sha('e'), harness: sha('h'), generator: sha('g'), mesen: sha('m'), project: sha('p'), rom: sha('r') }, cacheKey: sha('k'), n: 16 };
  const render = async (sabotage) => {
    const env = { ...process.env, ...(sabotage ? { TRANSFER_SABOTAGE: sabotage, TRANSFER_SABOTAGE_SIDE: 'current' } : {}) };
    const pool = await runPool([rec], { workers: 1, worker: { file: worker, args: [`--harness-root=${ROOT}`, '--mode=prepare', '--side=current'] }, env, current: rec.prov });
    return { pool, lua: pool.luaOf.get(rec.id) };
  };
  const [withEndpoint, without] = [await render(null), await render('no-endpoint')];
  assert.match(withEndpoint.lua, /^[0-9a-f]{64}$/); assert.match(without.lua, /^[0-9a-f]{64}$/);
  assert.notEqual(withEndpoint.lua, without.lua, 'omitting the endpoint changes the rendered script (the defect the hand-copied recipe had)');
  assert.equal(withEndpoint.pool.errors.length, 0, JSON.stringify(withEndpoint.pool.errors)); assert.equal(without.pool.errors.length, 0);
  // and directly: the endpoint binds ST_BATTLE and the contact idle register; the omitted one has neither
  const { runManifest } = await import('../lua/run_sw_manifest.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-rrender-')); const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-rrender-'));
  await runManifest(manifestArgs(job, { prepareOnly: true, tweak: (a) => ({ ...a, outDir: dir }) }));
  await runManifest(manifestArgs(job, { prepareOnly: true, tweak: (a) => { const { contactEndpoint, ...rest } = a; return { ...rest, outDir: dir2 }; } }));
  const l1 = fs.readFileSync(path.join(dir, 'manifest.lua'), 'utf8'); const l2 = fs.readFileSync(path.join(dir2, 'manifest.lua'), 'utf8');
  assert.match(l1, /ST_BATTLE/); assert.doesNotMatch(l2, /ST_BATTLE/);
  assert.equal(sha(l1), withEndpoint.lua, 'the worker renders exactly what manifestArgs renders');
  assert.equal(sha(l2), without.lua);
  assert.doesNotMatch(l1, /["'](?:CN|EV) /, 'no curve script prints a CN/EV line');
});

test('F1/F5: the other worker controls change what they are meant to change: a SYM address (Lua digest recomputed), a sym-digest-only change, a recipe change, a ROM byte', async () => {
  const job = plan('A')[0];
  const worker = fileURLToPath(new URL('../lua/sw_transfer_worker.mjs', import.meta.url));
  const rec = { ...job, prov: { engine: sha('e'), harness: sha('h'), generator: sha('g'), mesen: sha('m'), project: sha('p'), rom: sha('r') }, cacheKey: sha('k'), n: 16 };
  const render = async (sabotage) => {
    const pool = await runPool([rec], { workers: 1, worker: { file: worker, args: [`--harness-root=${ROOT}`, '--mode=prepare', '--side=current'] }, env: { ...process.env, ...(sabotage ? { TRANSFER_SABOTAGE: sabotage, TRANSFER_SABOTAGE_SIDE: 'current' } : {}) }, current: rec.prov });
    return { lua: pool.luaOf.get(rec.id), sym: pool.symOf.get(rec.id), hash: pool.hashOf.get(rec.id), errors: pool.errors };
  };
  const base = await render(null);
  assert.equal(base.errors.length, 0, JSON.stringify(base.errors));
  const symAddr = await render('sym-address'); assert.notEqual(symAddr.lua, base.lua); assert.notEqual(symAddr.sym, base.sym); assert.deepEqual(symAddr.hash, base.hash);
  const symOnly = await render('sym-only'); assert.equal(symOnly.lua, base.lua, 'the Lua digest is unchanged: classifyAnswer cannot see this'); assert.notEqual(symOnly.sym, base.sym);
  const recipe = await render('recipe'); assert.notEqual(recipe.hash.project, base.hash.project);
  const rom = await render('flip-rom-byte'); assert.notEqual(rom.hash.romFile, base.hash.romFile);
  const drift = await render('drift-binding'); assert.notEqual(drift.lua, base.lua); assert.equal(drift.sym, base.sym);
});

test('the worker refuses a harness root that is not the one it was told (the wrong tree\'s hash, or a missing tree)', async () => {
  const { spawnSync } = await import('node:child_process');
  const worker = path.join(ROOT, 'test/lua/sw_transfer_worker.mjs');
  const r = spawnSync(process.execPath, [worker, `--harness-root=${ROOT}`, `--expect-harness=${sha('another harness')}`], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 3); assert.match(r.stderr, /is not the expected/);
});
