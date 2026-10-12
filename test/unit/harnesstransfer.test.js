// The harness-transfer certificate (test/lua/sw_harness_transfer.mjs, test/lua/sw_transfer_lib.mjs, test/lua/sw_transfer_worker.mjs).
// Two kinds of test live here, kept apart (phase 3b S2 C1, review F1 and Chris's 2026-10-11 ruling):
//   CURRENT EVIDENCE   what test/fixtures/harness-transfer/ holds now and what the fresh curve needs. The fresh curve was measured by the live harness, so the live
//                      directory holds NO certificate and the curve is accepted through test/fixtures/identity-cert/s2-c1-metadata.json; a stale or forged artifact
//                      presented as active evidence is refused.
//   HISTORICAL CONTROLS the validator itself, exercised against the retired certificate, its archive and the old curve bytes (test/fixtures/harness-transfer/retired/):
//                      the untouched certificate validates with zero problems under a historical new-side source context, and every rejecting control mutates it
//                      (re-sealed where the control is semantic, so the seal is not what refuses it) and must fail at its own comparison.
// Plus the pure comparisons, the pilot selection, the pinned helper closure and the shared rebuild worker's recipe (review F1: a real R job renders its contact
// endpoint; the same job without it renders another script). Nothing here runs Mesen; the one render builds an RPG scene (no emulator).
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
import { STAGES, runPool, liveSources, liveTransfers, validateCertificate, checkCertificates, curveEvidenceVerdict, CERT_DIR_REL } from '../lua/sw_identity_cert.mjs';
import { comparePairs, comparePilot } from '../lua/sw_harness_transfer.mjs';
import {
  TRANSFER_DIR_REL, RETIRED_DIR_REL, ARCHIVE_DIR_REL, TRANSFER_STAGES, HELPER_FILES, PILOT_MIN, TRANSFER_SCOPE, ARCHIVE_SUFFIX,
  validateTransfer, checkTransfers, archivedHarnessHash, archiveFileShas, harnessFileShas, helperPins, helperClosure, localImports, verifyOldTree, selectPilot, pilotTags, pilotMeasurement, canonical, sealOf, sha256
} from '../lua/sw_transfer_lib.mjs';

const ROOT = REPO;
const sha = sha256;

// ---- the CURRENT evidence: the fresh curve and the live sources ----------------------------------------------------------------------------------
const nowCurveBytes = fs.readFileSync(path.join(ROOT, 'test/fixtures/streambound-curve.json'));
const nowCurve = JSON.parse(nowCurveBytes);
const liveNow = liveSources(ROOT);
const nowCtx = { curve: nowCurve, curveBytes: nowCurveBytes, live: liveNow };
const liveDir = path.join(ROOT, TRANSFER_DIR_REL);

// ---- the HISTORICAL controls: the retired certificate, its archive, the old curve bytes, and the new-side sources the certificate was made for ---------
const retiredDir = path.join(ROOT, RETIRED_DIR_REL);
const CERT_FILE = 'harness-transfer-7b1155d0e306-5eb745b13901.json';
const certBytes = fs.readFileSync(path.join(retiredDir, CERT_FILE));
const CERT = JSON.parse(certBytes);
const curveBytes = fs.readFileSync(path.join(retiredDir, 'streambound-curve-7b1155d0e306.json')); // git show f9d5f42:test/fixtures/streambound-curve.json
const curve = JSON.parse(curveBytes);
const archiveDir = path.join(ROOT, ARCHIVE_DIR_REL);
// The new-side sources the certificate was proven for, pinned here as literals (harness 5eb745b13901, the live one at the time, with its six file shas and the five
// helper shas). Deliberately NOT read from the checkout: the live sources move on, and deriving them from the certificate would prove nothing.
const HIST_DIGESTS = { cert: '6f6d3631705f54aaee434980f2246576d33586ce51c372d922486389d9491daa', curve: 'f5ade981862b2a3c2f32d746d1966ba09790799733dca8e4e2e2404a67609b09' };
const HIST_LIVE = {
  harness: '5eb745b13901e3edaea94a9e28f45215ac30fd9020f25b2c22f53f003b4c6f2c',
  harnessFiles: {
    'sw_manifest.lua.template': '02eefdd26af3020f741d6e4d2fdb1ce8b3bd7ff154d44a77220ed1964d7921b2', 'run_sw_manifest.mjs': '46d0cf00736c418197acd1ef931e763eeae29d4d2032a6e040a0a83bfe2a6fd8', 'sw_manifest_scene.mjs': '57bcfd684886a9f4384202e6c9e563d8c770697bb4463a027b4e2d751e1aa84b',
    'sw_sweep_mutate.mjs': '3564536c38a15c99ac549456bd7c46e57b4d20b24febab811e024a073c687fc3', 'sw_bound_sweep.mjs': 'c932e1676290965f1348a9894b7eee62827366eb28e5b302d32fa9d105844039',
    'sw_provenance.mjs': '99812edb69a8d56a32c6b1e9943c2bcbed0922eb248a9a1dda6b0488fff86a77'
  },
  helpers: {
    'main/paths.js': '0ba6cf88e1f3a3ff9d6175e7be644c8c9f6a3403992eabdfb4896a64dc4d25c3', 'main/project-io.js': '27fd08ba00d787ff1946579e6010bbe7ecbf9ea7443b89f79bbdcd62b3d3d927',
    'main/savequeue.js': '9371793b08151266337d9d8297f594f71b993826d2d8c6153e30648c9d38a796', 'test/lib/enginefingerprint.js': 'ac78d2e32f6cacf71050512e56ad5e773f4eab73a04edf81d3eb69dcb864dbfe',
    'test/lib/equates.js': 'b53ca0c352147b82e4c2b9c9cda5677feb43905f305d962e2d09701ace4c45dc'
  }
};
const live = HIST_LIVE;
const ctx = { curve, curveBytes, live, archiveDir };
const reseal = (c) => ({ ...c, selfDigest: sealOf(c) });
const mutate = (fn) => reseal(fn(structuredClone(CERT)));
const problemsOf = (cert, c = ctx) => validateTransfer(cert, c);
const refuses = (cert, re, c = ctx) => { const p = problemsOf(cert, c); assert.ok(p.some((m) => re.test(m)), `${re}: got ${JSON.stringify(p.slice(0, 4))}`); return p; };

/** The current-evidence inventory rule (pure). Every discovered live certificate must validate for the current curve and sources (`transfers` is checkTransfers' answer);
 * none at all is acceptable only when the curve's recorded harness IS the live harness; otherwise a valid one for exactly this live harness must exist. */
function inventoryProblems(transfers, { curve: c, live: l }) {
  const p = [];
  for (const t of transfers) for (const m of t.problems) p.push(`${t.file}: ${m}`);
  if (transfers.length === 0) { if (c.provenance.harness !== l.harness) p.push('no live transfer certificate, and the curve\'s recorded harness is not the live harness'); }
  else if (!transfers.some((t) => t.problems.length === 0 && t.newHarness === l.harness)) p.push('no valid live transfer certificate is for this live harness');
  return p;
}
const tmpDir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `forge-${tag}-`));
/** A scratch "live" transfer directory holding the retired certificate and, beside it, the readable retired archive: the stale evidence presented as active. */
function plantRetired(certOverride = null) {
  const d = tmpDir('xfer-live');
  fs.writeFileSync(path.join(d, CERT_FILE), certOverride ? JSON.stringify(certOverride) : certBytes);
  fs.cpSync(archiveDir, path.join(d, path.basename(ARCHIVE_DIR_REL)), { recursive: true });
  return d;
}
/** Live sources of a harness that moved after the fresh curve, with the engine and generator the curve recorded (so only the harness differs). */
const movedLive = () => ({ ...liveNow, engine: nowCurve.provenance.engine, generator: nowCurve.provenance.generator, harness: sha('a later live harness'), harnessFiles: { ...liveNow.harnessFiles, 'run_sw_manifest.mjs': sha('a later run_sw_manifest') } });

// ---- CURRENT evidence --------------------------------------------------------------------------------------------------------------------------
test('current evidence: the live directory holds no harness-transfer certificate, the fresh curve records the live harness, and retired/ is not discovered', () => {
  assert.deepEqual(fs.readdirSync(liveDir).sort(), ['retired'], 'only the retired/ directory: no live certificate, no live archive');
  assert.equal(nowCurve.provenance.harness, liveNow.harness, 'the fresh curve was measured by the live harness: nothing to transfer');
  assert.deepEqual(liveTransfers(nowCtx, ROOT), [], 'live discovery sees no certificate (and so not the one in retired/)');
  assert.deepEqual(checkTransfers(liveDir, nowCtx), []);
  assert.deepEqual(inventoryProblems(liveTransfers(nowCtx, ROOT), nowCtx), []);
  assert.notEqual(nowCurve.provenance.harness, CERT.oldHarness, 'the fresh curve is not the one the retired certificate recorded');
});

test('current evidence: the fresh curve is accepted through the C2 identity certificate, not a transfer; removing it, or moving the harness, refuses', () => {
  const transfers = liveTransfers(nowCtx, ROOT);
  const verdicts = checkCertificates(path.join(ROOT, CERT_DIR_REL), { ...nowCtx, transfers });
  const meta = verdicts.find((v) => v.file === 's2c2.json');
  assert.ok(meta, 'the C2 identity certificate is checked in');
  assert.deepEqual(meta.problems, []);
  // C1's metadata certificate certified the engine C1 committed; C2 changed the engine, so it is history now and may only fail on exactly those two bindings
  const c1 = verdicts.find((v) => v.file === 's2-c1-metadata.json');
  assert.ok(c1, 'the C1 metadata certificate stays checked in as history');
  assert.deepEqual(c1.problems, ["the certificate's current engine fingerprint is not the live engine", "the certificate's current generator fingerprint is not the live generator"]);
  assert.equal(transfers.length, 0);
  assert.equal(curveEvidenceVerdict({ curve: nowCurve, live: liveNow, verdicts, transfers }).via, 'certificate s2c2.json');
  // the generator was edited after the sweep (the margin edit): the sweep's records reach it only through that certificate, so without it the curve is refused
  assert.notEqual(liveNow.generator, nowCurve.provenance.generator, 'precondition: the live generator is not the recorded one');
  const without = curveEvidenceVerdict({ curve: nowCurve, live: liveNow, verdicts: verdicts.filter((v) => v.file !== meta.file), transfers });
  assert.equal(without.ok, false); assert.match(without.why.join(';'), /generator is not the recorded one/);
  // the live harness moved and nothing transfers it, with the engine and generator the curve recorded: refused whatever certificates exist
  const moved = movedLive();
  const verdictsMoved = checkCertificates(path.join(ROOT, CERT_DIR_REL), { curve: nowCurve, curveBytes: nowCurveBytes, live: moved, transfers: [] });
  const r = curveEvidenceVerdict({ curve: nowCurve, live: moved, verdicts: verdictsMoved, transfers: [] });
  assert.equal(r.ok, false); assert.match(r.why.join(';'), /harness is not the recorded one and no valid harness-transfer certificate covers it/);
  assert.ok(inventoryProblems([], { curve: nowCurve, live: moved }).some((m) => /recorded harness is not the live harness/.test(m)), 'zero transfers are acceptable only while the harnesses are equal');
  // and a transfer alone never carries a changed engine or generator (route A needs both recorded)
  const hist = checkTransfers(plantRetired(), ctx);
  assert.deepEqual(hist.map((x) => x.problems), [[]]);
  assert.equal(curveEvidenceVerdict({ curve, live: { ...live, engine: curve.provenance.engine, generator: curve.provenance.generator }, verdicts: [], transfers: hist }).via, `harness transfer ${CERT_FILE}`, 'the historical route-A positive');
  assert.equal(curveEvidenceVerdict({ curve, live: { ...live, engine: sha('a later engine'), generator: curve.provenance.generator }, verdicts: [], transfers: hist }).ok, false);
  assert.equal(curveEvidenceVerdict({ curve, live: { ...live, engine: curve.provenance.engine, generator: sha('a later generator') }, verdicts: [], transfers: hist }).ok, false);
});

test('current evidence, no-transfer cases: a missing directory, an empty one and one holding only retired/ discover nothing', () => {
  assert.deepEqual(checkTransfers(path.join(os.tmpdir(), 'no-such-transfer-dir'), nowCtx), []);
  const empty = tmpDir('xfer-empty'); assert.deepEqual(checkTransfers(empty, nowCtx), []);
  const withRetired = tmpDir('xfer-retired'); fs.cpSync(retiredDir, path.join(withRetired, 'retired'), { recursive: true });
  assert.ok(fs.existsSync(path.join(withRetired, 'retired', CERT_FILE)), 'the retired certificate is really there');
  assert.deepEqual(checkTransfers(withRetired, nowCtx), [], 'a certificate under retired/ is invisible to discovery');
  assert.deepEqual(inventoryProblems([], nowCtx), [], 'equal harnesses: zero transfers is the complete inventory');
});

test('integration: the retired certificate presented as active evidence, with its readable archive, is refused at the curve/source bindings and authorizes nothing', () => {
  const dir = plantRetired();
  const found = checkTransfers(dir, nowCtx);
  assert.equal(found.length, 1); assert.equal(found[0].file, CERT_FILE);
  const msgs = found[0].problems.join('\n');
  assert.doesNotMatch(msgs, /archive cannot be read/, 'the archive IS readable: the refusal is not a missing file');
  assert.doesNotMatch(msgs, /seal does not match/, 'the certificate is untouched: the seal is not what refuses it');
  assert.match(msgs, /pinned curve digest is not the checked-in curve/);
  assert.match(msgs, /pinned curve provenance\.(engine|harness|generator)/);
  assert.match(msgs, /old harness is not the curve's recorded harness/);
  assert.match(msgs, /experiment's engine\/generator\/Mesen are not the curve's recorded ones/);
  assert.ok(inventoryProblems(found, nowCtx).length > 0, 'a stale active artifact fails the inventory');
  // it authorizes no moved harness, for any live sources
  const moved = movedLive();
  const stale = checkTransfers(dir, { ...nowCtx, live: moved });
  assert.ok(stale[0].problems.length > 0);
  const r = curveEvidenceVerdict({ curve: nowCurve, live: moved, verdicts: [], transfers: stale });
  assert.equal(r.ok, false); assert.match(r.why.join(';'), /no valid harness-transfer certificate covers it/);
  // not even with its own new harness as the live harness (the harness it was proven FOR): it is about another curve
  const own = checkTransfers(dir, { ...nowCtx, live: { ...liveNow, harness: CERT.newHarness, harnessFiles: HIST_LIVE.harnessFiles, helpers: HIST_LIVE.helpers } });
  assert.ok(own[0].problems.some((m) => /pinned curve digest/.test(m)));
  // restamping the curve pins and re-sealing does not rescue it: the old side is still not the fresh curve's recorded harness
  const restamped = reseal({ ...structuredClone(CERT), curve: { ...CERT.curve, sha256: sha(nowCurveBytes), jobs: nowCurve.jobs, reused: nowCurve.reused, confirms: nowCurve.confirms, provenance: { ...nowCurve.provenance } }, recorded: { engine: nowCurve.provenance.engine, generator: nowCurve.provenance.generator, mesen: nowCurve.provenance.mesen } });
  const rs = checkTransfers(plantRetired(restamped), nowCtx)[0].problems.join('\n');
  assert.doesNotMatch(rs, /seal does not match/); assert.match(rs, /transfer's old harness is not the curve's recorded harness/);
});

test('integration: a re-sealed forged transfer for the fresh curve is refused with its specific refusal, and authorizes no moved harness', () => {
  const moved = movedLive();
  const forged = reseal((() => {
    const c = structuredClone(CERT); const rec = nowCurve.provenance;
    c.curve = { ...c.curve, sha256: sha(nowCurveBytes), jobs: nowCurve.jobs, reused: nowCurve.reused, confirms: nowCurve.confirms, provenance: { ...rec } };
    c.recorded = { engine: rec.engine, generator: rec.generator, mesen: rec.mesen };
    c.oldHarness = rec.harness; c.archive.hash = rec.harness; c.newHarness = moved.harness;
    for (const f of c.files) { f.newSha = moved.harnessFiles[f.name]; f.status = f.oldSha === f.newSha ? 'unchanged' : 'changed'; }
    c.declaredInert = c.files.filter((f) => f.status === 'changed').map((f) => f.name);
    for (const side of ['old', 'new']) for (const w of ['before', 'after']) { const s = c.sides[side].sources[w]; s.engine = rec.engine; s.generator = rec.generator; s.mesen = rec.mesen; s.harness = side === 'old' ? rec.harness : moved.harness; }
    return c;
  })());
  const dir = plantRetired(forged);
  const found = checkTransfers(dir, { ...nowCtx, live: moved });
  const msgs = found[0].problems;
  assert.ok(!msgs.some((m) => /seal does not match/.test(m)), 're-sealed: the seal is not what refuses it');
  assert.ok(msgs.some((m) => /archived old harness is not the recorded one/.test(m)), `the checked-in archive is harness 7b11, not the claimed old harness: ${msgs.slice(0, 5)}`);
  assert.ok(inventoryProblems(found, { curve: nowCurve, live: moved }).length > 0);
  const r = curveEvidenceVerdict({ curve: nowCurve, live: moved, verdicts: [], transfers: found });
  assert.equal(r.ok, false);
});

test('historical: the retired certificate, archive and old curve are the immutable bytes the certificate pins, and the untouched certificate validates with zero problems', () => {
  assert.equal(sha(certBytes), HIST_DIGESTS.cert, 'the retired certificate is byte-for-byte the one that was moved');
  assert.equal(sha(curveBytes), HIST_DIGESTS.curve, 'the old curve bytes are the ones git show f9d5f42:test/fixtures/streambound-curve.json prints');
  assert.equal(CERT.curve.sha256, sha(curveBytes), 'and they are exactly the curve digest the unchanged certificate pins');
  assert.notEqual(sha(curveBytes), sha(nowCurveBytes), 'the fresh curve superseded it');
  assert.equal(CERT.newHarness, HIST_LIVE.harness);
  assert.deepEqual(CERT.files.map((f) => [f.name, f.newSha]), HARNESS_FILES.map((n) => [n, HIST_LIVE.harnessFiles[n]]));
  assert.deepEqual(CERT.helpers.new, HIST_LIVE.helpers);
  assert.deepEqual(problemsOf(CERT), [], 'ZERO problems for the unmodified historical certificate');
  assert.equal(CERT.oldHarness, curve.provenance.harness, 'the OLD side is the harness the old curve recorded');
  assert.equal(CERT.scope, TRANSFER_SCOPE);
  assert.deepEqual(checkTransfers(plantRetired(), ctx).map((x) => [x.file, x.problems]), [[CERT_FILE, []]], 'through the directory consumer too');
  assert.deepEqual(Object.keys(HIST_LIVE.harnessFiles), HARNESS_FILES);
});


test('historical: the archive IS the recorded harness: its six files hash to the curve\'s recorded harness, file by file, and nothing else lives beside them', () => {
  assert.equal(archivedHarnessHash(archiveDir), curve.provenance.harness);
  assert.deepEqual(fs.readdirSync(archiveDir).sort(), HARNESS_FILES.map((n) => n + ARCHIVE_SUFFIX).sort());
  assert.deepEqual(CERT.files.map((f) => f.oldSha), HARNESS_FILES.map((n) => archiveFileShas(archiveDir)[n]));
  // only the two files S1b changed differ from the live harness; the template, the mutator, the sweep driver and the provenance module are byte-identical
  assert.deepEqual(CERT.declaredInert, ['run_sw_manifest.mjs', 'sw_manifest_scene.mjs']);
  assert.deepEqual(CERT.files.filter((f) => f.status === 'unchanged').map((f) => f.name), ['sw_manifest.lua.template', 'sw_sweep_mutate.mjs', 'sw_bound_sweep.mjs', 'sw_provenance.mjs']);
});

test('historical: the certificate covers all 12,592 validated records on each side separately, and the pilot is the pinned ~40-job manifest', () => {
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
test('historical C1b/C5/C5b: a changed archive, a forged new harness, a relabelled old harness and a changed archived file are each refused at their own comparison', () => {
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

test('historical C6/C6b/C7: an undeclared changed file, a declared file that moved again, and a moved live harness with a stale transfer are refused', () => {
  refuses(mutate((c) => { c.files[4].oldSha = sha('x'); c.files[4].status = 'changed'; return c; }), /undeclared harness file changed|pinned old sha/);
  refuses(mutate((c) => { c.declaredInert = ['run_sw_manifest.mjs']; return c; }), /undeclared harness file changed/);
  // a declared file moved again after the certificate: the live run_sw_manifest.mjs is not the certified one
  const live2 = { ...live, harnessFiles: { ...live.harnessFiles, 'run_sw_manifest.mjs': sha('a later run_sw_manifest') } };
  refuses(CERT, /run_sw_manifest.mjs: the live file is not the certified one/, { ...ctx, live: live2 });
  refuses(CERT, /new harness is not the live harness/, { ...ctx, live: { ...live, harness: sha('a later harness') } });
  refuses(mutate((c) => { c.files[0].status = 'changed'; return c; }), /status does not match its shas/);
});

test('historical F4: any helper file changing alone (engine, generator and harness equal) invalidates the certificate', () => {
  for (const f of HELPER_FILES) {
    const pins = { ...live.helpers, [f]: sha(`an edited ${f}`) };
    refuses(CERT, /a helper file differs from the certified one/, { ...ctx, live: { ...live, helpers: pins } });
  }
  refuses(CERT, /a helper file differs/, { ...ctx, live: { ...live, helpers: undefined } });
  refuses(mutate((c) => { c.helpers.old['main/paths.js'] = sha('other'); return c; }), /helper pins are not the pinned helper files, equal on both sides/);
  refuses(mutate((c) => { delete c.helpers.new['main/savequeue.js']; delete c.helpers.old['main/savequeue.js']; return c; }), /helper pins are not the pinned helper files/);
});

// ---- CURRENT sources: the helper closure (independent of the historical context above) ---------------------------------------------------------------
test('F4 (current sources): the pin list is the six harness files\' import closure, and the live helper pins are the checkout\'s', () => {
  // the closure of the harness files' relative imports outside main/build, shared and the harness itself IS the pin list (project-io's own dependencies included)
  assert.deepEqual(helperClosure(ROOT), [...HELPER_FILES].sort());
  assert.deepEqual(liveNow.helpers, helperPins(ROOT));
  assert.ok(HELPER_FILES.includes('main/paths.js') && HELPER_FILES.includes('main/savequeue.js'), 'project-io.js local dependencies');
  assert.deepEqual(localImports("import a from './x.js';\nimport('./y.mjs');\nimport './z.js';\nimport q from 'node:fs';\nexport { b } from '../w.js';"), ['./x.js', '../w.js', './y.mjs', './z.js']);
});

test('historical C4/F5: an incomplete transfer is refused whichever side or part lacks a job, independently', () => {
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

test('historical C8: a pilot with a missing job, a short manifest, a differing or incomplete measurement, or a counters/events key is refused', () => {
  refuses(mutate((c) => { c.pilot.results.pop(); return c; }), /pilot incomplete/);
  refuses(mutate((c) => { c.pilot.manifest = c.pilot.manifest.slice(0, 10); c.pilot.results = c.pilot.results.slice(0, 10); c.pilot.manifestDigest = sha(JSON.stringify(c.pilot.manifest)); return c; }), /pilot manifest is missing, short of/);
  refuses(mutate((c) => { c.pilot.manifestDigest = sha('another manifest'); return c; }), /not its digest/);
  refuses(mutate((c) => { c.pilot.results[3].newDigest = sha('another measurement'); return c; }), new RegExp(`pilot differs: ${CERT.pilot.results[3].id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  refuses(mutate((c) => { c.pilot.results[0].noExtraKeys = false; return c; }), /counters\/events keys/);
  refuses(mutate((c) => { c.pilot.results[0].complete = false; return c; }), /pilot differs/);
  refuses(mutate((c) => { c.pilot.manifest[0] = { ...c.pilot.manifest[0], id: 'nobody' }; c.pilot.manifestDigest = sha(JSON.stringify(c.pilot.manifest)); return c; }), /pilot incomplete/);
});

test('historical: the certificate is refused for: another curve, other counts, a missing stage, other execution flags, another recorded engine, another scope or version, an edited seal', () => {
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
test('historical F3: the old tree must hold the archived harness byte for byte; the current tree, or one with a single changed harness byte, is refused while the archive is intact', () => {
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
