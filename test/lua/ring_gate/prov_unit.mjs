// Controls for the harness's own provenance and verdict machinery (review 2 findings 3 and 4). No emulator runs here except one fast failing build.
//   node --test test/lua/ring_gate/prov_unit.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeTree, makeCellTree, makeTreeSet, LIFT_PATCH, patchSetFor, liftNeeded, checkNoLiftNeeded, PATCH_DIR, sha256, BASELINE, patchFile, sabotageHasRing, patchedFiles, verifyProduction, assertTreeForCell, filesDifferingFromBaseline, loadTree, provenanceFor, refreshProof, PRE_C2_BASELINE, expectedContent, resetExpectedCache, consumedEvidence, verifyBuildDir, readTreeText, RETIRED_PATCHES, TREE_KIND, PROTOTYPE_TREE_KIND, checkRetiredShipped } from './ringtree.mjs';
import { makeBypassTree, loadBypassTree, buildThrough } from '../../lib/ringbypass.js';
import { fileOffsetOfKernelAddr } from './ringidentity.mjs';
import fsp from 'node:fs/promises';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { buildScene } from '../sw_manifest_scene.mjs';
import { locateBlock } from './regen_patches.mjs';
import { cellById, ringProject, buildCell } from './ringworld.mjs';
import { CELLS, GAME_TYPES } from './ringcells.mjs';
import { mesenStamp, fileStamp, stampResult, harnessFingerprint, fingerprintGaps, writeAttempt, finishAttempt, EVIDENCE_ENTRIES, EXTRA_ROOT } from './ringprov.mjs';
import { matrixScripts, NOFLAG_BASELINES, NOFLAG_HISTORY, S1B_R3_REAL, REQUIRED_DATA } from './ringjobs.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RING_ADDR, checkAddresses } from './ringaddr.mjs';
import { scanEquates, resolveEquates, STOCK_CARTRIDGE_EQUATES } from '../../lib/equates.js';
import { MESEN, MESEN_ERROR, resolveMesen } from './ringrun_mesen.mjs';
import { auditStamp, auditProvenance, auditTreeProvenance, isHistoricalStamp, HISTORICAL_KINDS } from './ringprovindex.mjs';
import { jobs, runMatrix, judgeJob, matrixReport } from './run_matrix.mjs';
import { IDENTITY_OUTCOME, SABOTAGE_RINGS, NO_FORM_REASON, noFormReason, sabotageRings, buildErrorWitness, classifyBuildError } from './ringsabotage.mjs';
import { identityFailures } from './ringidentity.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ring-prov-unit-'));
// A representative cell + game type per ring, found by asking the cell table (never named), so a slice that adds a board moves it with no edit here. Since S5 C2 production admits EVERY cell for both game types
// (no cell needs a refusal lift: checkNoLiftNeeded), so `REP` is an RPG cell (the game type that was lifted until S5) and `ACTION` an action cell; both are built on the one unlifted tree.
const REP = Object.fromEntries([1, 2].map((ring) => [ring, { id: CELLS.find((c) => c.ring === ring).id, gameType: 'rpg' }]));
const ACTION = Object.fromEntries([1, 2].map((ring) => [ring, { id: CELLS.find((c) => c.ring === ring).id, gameType: 'action' }]));

// ---- the Mesen implementation stamp identifies the core, not only the host (review 2: a dummy sibling core left the old stamp unchanged).
// Built from a COMPLETE SYNTHETIC release in a mkdtemp directory, so the core assertions need no installed Mesen. `release(dir, {core})` writes the five
// files a release holds; the executable under test is `Mesen` unless a test names another.
const SYNTH = { 'Mesen': 'synthetic host', 'Mesen.dll': 'synthetic managed assembly', 'Mesen.runtimeconfig.json': '{"runtimeOptions":{"tfm":"net8.0"}}', 'Mesen.deps.json': '{}', 'MesenCore.so': 'synthetic native core' };
const release = (dir, over = {}) => { fs.mkdirSync(dir, { recursive: true }); for (const [f, body] of Object.entries({ ...SYNTH, ...over })) fs.writeFileSync(path.join(dir, f), body, { mode: f === 'Mesen' ? 0o755 : 0o644 }); return path.join(dir, 'Mesen'); };
test('mesenStamp: a different MesenCore.so beside an identical host changes the stamp; the loaded core is identified by hash (synthetic release, no installed Mesen needed)', () => {
  const dir = tmp();
  try {
    const a = release(path.join(dir, 'a'));
    const b = release(path.join(dir, 'b'), { 'MesenCore.so': 'a dummy core' });
    const genuine = mesenStamp(a), dummy = mesenStamp(b);
    assert.equal(dummy.binarySha256, genuine.binarySha256, 'the host binary is identical');
    assert.notEqual(dummy.siblingFiles['MesenCore.so'].sha256, genuine.siblingFiles['MesenCore.so'].sha256);
    assert.notDeepEqual(dummy, genuine);
    // a core the process really loaded (a path outside the binary's directory, as Mesen does) is hashed and compared with the sibling
    const loaded = path.join(dir, 'loaded-core.so');
    fs.writeFileSync(loaded, 'the extracted core');
    const withLoaded = mesenStamp(b, [loaded]);
    assert.equal(withLoaded.loadedCoreSha256, null, 'a loaded file not named MesenCore.so is not mistaken for the core');
    const loadedCore = path.join(dir, 'extracted', 'MesenCore.so');
    fs.mkdirSync(path.dirname(loadedCore));
    fs.writeFileSync(loadedCore, 'the extracted core');
    const w2 = mesenStamp(b, [loadedCore]);
    assert.equal(w2.loadedCoreSha256, fileStamp(loadedCore).sha256);
    assert.equal(w2.coreLoadedFromSibling, false, 'the executed core differs from the sibling one');
    const same = mesenStamp(a, [path.join(dir, 'a', 'MesenCore.so')]);
    assert.equal(same.coreLoadedFromSibling, true, 'the sibling core itself, loaded, is the sibling');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('mesenStamp: the RESOLVED EXECUTABLE is hashed as itself -- a renamed `mesen-custom` is never stamped as its sibling `Mesen`; the sibling release host is kept separately', () => {
  const dir = tmp();
  try {
    const rel = release(path.join(dir, 'r'));
    const custom = path.join(dir, 'r', 'mesen-custom');
    fs.writeFileSync(custom, '#!/bin/sh\nprintf "CUSTOM %s\\n" "$0"\n', { mode: 0o755 });
    const s = mesenStamp(custom);
    assert.equal(s.binary, custom);
    assert.equal(s.binarySha256, sha256(fs.readFileSync(custom)), 'the stamp must hash the executable that ran');
    assert.notEqual(s.binarySha256, sha256(fs.readFileSync(rel)), 'it must not hash the sibling Mesen');
    assert.equal(s.binaryBytes, fs.statSync(custom).size);
    assert.equal(s.siblingHostSha256, sha256(fs.readFileSync(rel)), 'the sibling release host is recorded apart');
    assert.equal(s.siblingFiles.Mesen.sha256, s.siblingHostSha256);
    // the plain-named executable is itself and its own sibling
    const plain = mesenStamp(rel);
    assert.equal(plain.binarySha256, plain.siblingHostSha256);
    assert.notEqual(plain.binarySha256, s.binarySha256);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
// the availability of a real installed Mesen is its own (counted) check; none of the stamp assertions above depends on it
test('an installed Mesen release, when one resolves, stamps as itself with its own sibling files', { skip: MESEN_ERROR ? false : !MESEN ? 'no executable Mesen (set $MESEN or put Mesen on PATH)' : false }, () => {
  if (MESEN_ERROR) throw new Error(MESEN_ERROR); // an invalid configured $MESEN is an error, never a skip
  const s = mesenStamp(MESEN);
  assert.equal(s.binary, MESEN);
  assert.equal(s.binarySha256, sha256(fs.readFileSync(MESEN)));
});

// ---- the harness fingerprint includes what the import closure misses (review 2 finding 3)
test('harnessFingerprint covers the matrix, the fixture-hash script and every patch file', () => {
  const fp = Object.keys(harnessFingerprint());
  for (const must of ['test/lua/ring_gate/run_matrix.mjs', 'test/lua/ring_gate/ringprovindex.mjs', 'test/lua/ring_gate/judge_unit.mjs', 'test/lua/ring_gate/fixture-hashes.mjs', 'test/lua/ring_gate/fixture-hashes-before.txt', 'test/lua/ring_gate/fixture-hashes-r4-before.txt',
    'test/lua/ring_gate/ring_oracle.lua.template', 'test/lua/ring_gate/sabotage/instant-text.patch', 'test/lua/ring_gate/sabotage/vertical/instant-text.patch']) assert.ok(fp.includes(must), `${must} is not in the harness fingerprint`);
  assert.ok(!fp.includes('test/lua/ring_gate/00-refusal-lift.patch'), 'the retired refusal lift is gone from the tree and so from the fingerprint');
});

// ---- attempt stamps: written before the build, completed with the outcome, an errored build leaves one
test('a failing build leaves an error stamp that was written as an attempt first', async () => {
  const dir = tmp();
  const tree = makeTree({ ring: 1, lifted: false });
  try {
    const cell = cellById(REP[1].id);
    const { project } = ringProject({ cell, gameType: REP[1].gameType, n: 400 }); // beyond any admitted world: the generator refuses it before assembling
    let err;
    try { await buildCell({ tree, project, cell, gameType: REP[1].gameType, provDir: dir, label: 'doomed', links: { result: path.join(dir, 'r.json'), log: path.join(dir, 'l.log') } }); } catch (e) { err = e; }
    assert.ok(err, 'the oversized world must fail to build');
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'doomed.json'), 'utf8'));
    assert.equal(st.status, 'error');
    assert.ok(st.attempt.startedAt && st.finishedAt && st.error.firstLine, 'attempt time, finish time and the error text are recorded');
    assert.ok(st.projectSha256 && st.patches.length === 0 && st.treeKind === 'production-vertical' && st.productionProof.changed.length === 0 && Object.keys(st.harness).length > 20 && st.nesasm?.sha256, 'inputs were stamped BEFORE the build');
    assert.equal(err.provPath, path.join(dir, 'doomed.json'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(tree.root, { recursive: true, force: true }); }
});
test('writeAttempt alone (a build that died) is status "started" and the audit rejects it', () => {
  const dir = tmp();
  try {
    const p = writeAttempt(dir, 'died', { kind: 'cell-build' });
    assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).status, 'started');
    const bad = auditStamp(JSON.parse(fs.readFileSync(p, 'utf8')), 'died.json', () => true);
    assert.ok(bad.some((x) => /never completed/.test(x)), bad.join('|'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('auditStamp rejects a built stamp without links, resources, results, or the Mesen native core', () => {
  const full = {
    schema: 'ring-prov-3', kind: 'cell-build', status: 'built', cell: ACTION[1].id, gameType: ACTION[1].gameType, attempt: { startedAt: 'x' }, head: 'h', ...provenanceFor(1, false),
    harness: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`f${i}`, 'x'])), links: { result: '/r', log: '/l' }, nesasm: { sha256: 'x' }, host: { kernel: 'k' },
    romSha256: 'a'.repeat(64), projectSha256: 'b'.repeat(64), header: {}, streamRing: 1, ringConsts: {}, resources: { kernelLoFree: 1, kernelHiFree: 2 }, placement: { assembled: 'resident' },
    results: [{ emulatorStamp: { emulator: 'Mesen2 --testRunner', binarySha256: 'x', host: { kernel: 'k' }, loadedFiles: [{ path: '/m/MesenCore.so', sha256: 'c'.repeat(64) }, { path: '/m/Mesen.dll', sha256: 'd'.repeat(64) }] } }]
  };
  const ok = () => true;
  assert.deepEqual(auditStamp(full, 'x', ok), [], 'the matching positive');
  const without = (mut, re) => { const s = structuredClone(full); mut(s); const bad = auditStamp(s, 'x', ok); assert.ok(bad.some((b) => re.test(b)), `${re}: ${bad.join('|')}`); };
  without((s) => { s.links.log = null; }, /links\.log/);
  without((s) => { s.links.result = null; }, /links\.result/);
  without((s) => { s.results = []; }, /no result linked/);
  without((s) => { delete s.resources.kernelLoFree; }, /kernel-lo/);
  without((s) => { s.placement = null; }, /placement/);
  without((s) => { s.results[0].emulatorStamp.loadedFiles = [{ path: '/m/Mesen.dll', sha256: 'd'.repeat(64) }]; }, /NATIVE core/);
  without((s) => { s.gameType = 'rpg'; }, /battle-region/);
  assert.ok(auditStamp(full, 'x', (p) => p !== '/l').some((b) => /links\.log/.test(b)), 'a linked log that is not on disk');
});
test('auditProvenance: a stamp left "started" and a missing comparison constituent both fail the directory audit', () => {
  const dir = tmp();
  try {
    writeAttempt(dir, 'half', { kind: 'cell-build' });
    fs.writeFileSync(path.join(dir, 'ring0-x.json'), JSON.stringify({ schema: 'ring-prov-3', kind: 'ring0-identity-comparison', status: 'built', equal: true, constituents: {} }));
    const r = auditProvenance(dir, null);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /half\.json.*never completed/.test(p)) && r.problems.some((p) => /ring0-x\.json.*constituent/.test(p)), r.problems.join('|'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- the matrix verdict compares each job with its declaration (review 2 finding 4)
test('the matrix flags a job whose exit status or log differs from its declaration, and keeps a deliberate selection error an error', async () => {
  const L = tmp();
  try {
    const mk = (name, code, text, expect) => ({ name, argv: ['-e', `console.log(${JSON.stringify(text)}); process.exit(${code})`], expect, group: 1 });
    const list = [
      mk('positive-ok', 0, 'all pass', { exit: 0, log: /all pass/ }),
      mk('positive-fails', 3, 'all pass', { exit: 0, log: /all pass/ }), // the old matrix's `echo exit=$?` hid this
      mk('positive-wrong-log', 0, 'nothing useful', { exit: 0, log: /all pass/ }),
      mk('selection-error-kept', 2, 'names nothing valid', { exit: 2, log: /names nothing valid/ }),
      mk('selection-error-lost', 0, 'all pass', { exit: 2, log: /names nothing valid/ }), // a selection error that stopped erroring
      mk('control-not-caught', 1, 'NOT CAUGHT', { exit: 0, log: /rows fail it/ })
    ];
    const { rows, unexpected } = await runMatrix(list, L, 3);
    const byName = Object.fromEntries(rows.map((r) => [r.job.name, r.verdict.ok]));
    assert.deepEqual(byName, { 'positive-ok': true, 'positive-fails': false, 'positive-wrong-log': false, 'selection-error-kept': true, 'selection-error-lost': false, 'control-not-caught': false });
    assert.equal(unexpected.length, 4);
    assert.equal(judgeJob(list[0], { status: 0, log: 'all pass' }).ok, true);
  } finally { fs.rmSync(L, { recursive: true, force: true }); }
});
test('the real job list: every sabotage patch is run by identity, every selection-error job is declared exit 2, every positive exit 0', () => {
  const list = jobs('/p', '/l');
  const dirOf = (d) => fs.readdirSync(path.join(PATCH_DIR, 'sabotage', d)).filter((f) => f.endsWith('.patch')).map((f) => f.replace(/\.patch$/, ''));
  const patches = [...new Set([...dirOf(''), ...dirOf('vertical')])].sort();
  assert.deepEqual(patches, Object.keys(IDENTITY_OUTCOME).sort(), 'every sabotage patch (of either ring) has a declared identity outcome, and no declaration lacks its patch');
  for (const s of patches) assert.ok(list.some((j) => j.name === `identity-${s}`), `no identity job for ${s}`);
  for (const j of list.filter((x) => x.name.startsWith('selection-'))) assert.equal(j.expect.exit, 2, j.name);
  for (const j of list.filter((x) => /-positive/.test(x.name))) assert.equal(j.expect.exit, 0, j.name);
  assert.ok(list.every((j) => j.expect.log instanceof RegExp), 'every job declares a log pattern');
});

// ---- the predeclared-unbuildable witnesses
test('buildErrorWitness: declared for exactly the source-proven combinations; classifyBuildError separates witnessed from unexpected errors', () => {
  const act = { id: 'MMC1-V', ring: 1 }, h = { id: 'MMC1-H', ring: 2 };
  assert.ok(buildErrorWitness('forced-banked', act, 'action'));
  assert.equal(buildErrorWitness('forced-banked', act, 'rpg'), null);
  assert.ok(buildErrorWitness('ring-forced-0', h, 'action'));
  assert.equal(buildErrorWitness('ring-forced-0', act, 'action'), null);
  assert.equal(classifyBuildError('ring-forced-0', h, 'rpg', 'player.asm:344: Branch address out of range!').kind, 'witnessed');
  assert.equal(classifyBuildError('ring-forced-0', h, 'rpg', 'streamworld.asm:1: Undefined symbol').kind, 'unexpected', 'a different error than declared is not witnessed');
  assert.equal(classifyBuildError('ring-forced-0', act, 'rpg', 'player.asm:344: Branch address out of range!').kind, 'unexpected', 'an undeclared combination erroring is an error');
  assert.equal(classifyBuildError(null, h, 'rpg', 'anything').kind, 'unexpected');
});

// ---- Part A: the fingerprint is seeded from what the matrix really executes (review 3 task 2)
test('harnessFingerprint covers EVERY script the matrix executes (argv[0] of each job, and the file after --test); removing one from the seed is caught', () => {
  const scripts = matrixScripts();
  // the executed scripts review 3 named, each present in the job list itself (not a hand list that could drift from it)
  for (const must of ['run_campaign', 'ringcapacity', 'repro_battle_slot5', 'repro_continue_y', 'run_oracle', 'run_identity', 'judge_unit', 'record_controls', 'prov_unit']) {
    assert.ok(scripts.some((s) => s.includes(must)), `${must} is not among the matrix's executed scripts`);
  }
  assert.deepEqual(fingerprintGaps(harnessFingerprint()), [], 'the default fingerprint covers every executed script');
  // the control: a seed WITHOUT one executed script (nothing else imports it) leaves it out, the gap check names it, and the checked form throws
  for (const drop of ['run_campaign.mjs', 'repro_battle_slot5.mjs', 'repro_continue_y.mjs']) {
    const seed = ['test/lua/ring_gate/run_matrix.mjs', ...scripts.filter((s) => !s.endsWith(drop))];
    const gaps = fingerprintGaps(harnessFingerprint({ seed, check: false }));
    assert.deepEqual(gaps.map((g) => path.basename(g)), [drop], `dropping ${drop} from the seed must leave exactly it unhashed`);
    assert.throws(() => harnessFingerprint({ seed }), (e) => e.message.includes(drop), `a fingerprint missing ${drop} must be refused`);
  }
  // round 2, finding 7: the evidence-producing entry points (the builder-identity proof, the report tables, the isolated-HOME spawner, ...) are matrix jobs AND named evidence: dropping one is a gap
  for (const drop of ['s1b_noflag.mjs', 's1b_tables.mjs']) {
    assert.ok(scripts.some((x) => x.endsWith(drop)), `${drop} is a script the matrix executes`);
    assert.ok(EVIDENCE_ENTRIES.includes(drop), `${drop} is a named evidence entry`);
    const seed = ['test/lua/ring_gate/run_matrix.mjs', ...scripts.filter((x) => !x.endsWith(drop))];
    const gaps = fingerprintGaps(harnessFingerprint({ seed, check: false }));
    assert.deepEqual(gaps.map((g) => path.basename(g)), [drop], `dropping ${drop} must leave exactly it unhashed`);
    assert.throws(() => harnessFingerprint({ seed }), (e) => e.message.includes(drop));
  }
  for (const must of ['s1b_noflag.mjs', 's1b_tables.mjs', 'ringhome.mjs', 'iso_unit.mjs']) assert.ok(`test/lua/ring_gate/${must}` in harnessFingerprint(), `${must} is in the default fingerprint`);
  // and a fingerprint is sensitive to the dropped script's CONTENT only when it is seeded: with the script seeded its hash is present
  assert.ok('test/lua/ring_gate/repro_continue_y.mjs' in harnessFingerprint());
});

// ---- C3 fix 4 (review 4, item 3): every non-script input the certificate reads is TRACKED, fingerprinted and required ------------------------------------------------------
test('the two no-flag jobs read the tracked baselines (s1c and s1b ce7d009, the C6b commit; never handoff-next), and both baselines, the three superseded no-flag files (s1b cd7a9f8 and aaa678a, s1c cd7a9f8) and every S1b real-record fixture file are hashed into the fingerprint', () => {
  const noflag = Object.fromEntries(jobs('/p', '/l').filter((j) => /^s1[bc]-noflag$/.test(j.name)).map((j) => [j.name, j.argv]));
  assert.deepEqual(Object.keys(noflag).sort(), ['s1b-noflag', 's1c-noflag']);
  assert.deepEqual(noflag['s1c-noflag'].slice(1), ['check', 'test/lua/ring_gate/noflag/s1c-ce7d009.json']);
  assert.deepEqual(noflag['s1b-noflag'].slice(1), ['check', 'test/lua/ring_gate/noflag/s1b-ce7d009.json']);
  assert.deepEqual(Object.values(NOFLAG_BASELINES).sort(), ['test/lua/ring_gate/noflag/s1b-ce7d009.json', 'test/lua/ring_gate/noflag/s1c-ce7d009.json']);
  assert.deepEqual(Object.values(NOFLAG_HISTORY).sort(), ['test/lua/ring_gate/noflag/s1b-aaa678a.json', 'test/lua/ring_gate/noflag/s1b-cd7a9f8.json', 'test/lua/ring_gate/noflag/s1c-cd7a9f8.json'], 'the three superseded files stay required, fingerprinted inputs');
  const fp = harnessFingerprint();
  const want = [...Object.values(NOFLAG_BASELINES), ...Object.values(NOFLAG_HISTORY), ...S1B_R3_REAL.logs.map((f) => `${S1B_R3_REAL.dir}/logs/${f}`), ...S1B_R3_REAL.prov.map((f) => `${S1B_R3_REAL.dir}/prov/${f}`)];
  assert.deepEqual([...want].sort(), [...REQUIRED_DATA].sort(), 'REQUIRED_DATA is exactly the baselines, the historical no-flag files and the fixture files');
  assert.equal(want.length, 2 + 3 + 4 + 1);
  for (const f of want) {
    assert.ok(!/handoff-/.test(f), `${f} must not live under an ignored handoff directory`);
    assert.ok(EXTRA_ROOT.includes(f), `${f} is a required root input`);
    assert.equal(fp[f], sha256(fs.readFileSync(path.join(REPO, f))), `${f} is hashed into the fingerprint with its own content hash`);
  }
});
const HISTORICAL_S1B_SHA = 'ac88beeb60fb4c730ceeac03d805e8611aa868a2bc2d7f6c3f61ab7b9dbec251'; // noflag/s1b-cd7a9f8.json as recorded at cd7a9f8 (reproduced byte for byte at RULE-A)
const HISTORICAL_S1B_AAA_SHA = 'fec88c0a5f9f0b834c68d3540bb59f660d2650d324ad72d95bbfeda2dd47db27'; // noflag/s1b-aaa678a.json as recorded at aaa678a (S3 C1), the active S1b baseline until Equipment C6c (E14)
const HISTORICAL_S1C_SHA = '00db040ed432cf6bbc7e5de10c4095defafe00f6eba471d242f500045e6f7a88'; // noflag/s1c-cd7a9f8.json as recorded at cd7a9f8 (S2 C2), the active S1c baseline until Equipment C6c (E15)
test('RULE-A continuity (superseded): the S1b no-flag file aaa678a keeps every project/rom/scene.nes/manifest.lua hash of the older cd7a9f8 file; only symbols.json differs, in every configuration', () => {
  const o = JSON.parse(fs.readFileSync(path.join(REPO, NOFLAG_HISTORY.s1b), 'utf8')), n = JSON.parse(fs.readFileSync(path.join(REPO, NOFLAG_HISTORY.s1bPrev), 'utf8'));
  assert.deepEqual(Object.keys(n), Object.keys(o), 'same configurations in the same order');
  assert.equal(Object.keys(o).length, 11);
  for (const c of Object.keys(o)) {
    assert.deepEqual(Object.keys(n[c]), Object.keys(o[c]), `${c}: same artifact keys`);
    for (const k of Object.keys(o[c])) {
      if (k === 'symbols.json') assert.notEqual(n[c][k], o[c][k], `${c}: the symbol file gained ram.SW_RING_ROW_LEN, so its hash differs`);
      else assert.equal(n[c][k], o[c][k], `${c}/${k} must keep its cd7a9f8 hash`);
    }
  }
  // the historical file itself is pinned to its recorded bytes (it is evidence, never edited)
  assert.equal(sha256(fs.readFileSync(path.join(REPO, NOFLAG_HISTORY.s1b))), HISTORICAL_S1B_SHA);
  // and so is the aaa678a file, now history too: both superseded S1b files, and the superseded S1c file, are pinned to their bytes
  assert.equal(sha256(fs.readFileSync(path.join(REPO, NOFLAG_HISTORY.s1bPrev))), HISTORICAL_S1B_AAA_SHA);
  assert.equal(sha256(fs.readFileSync(path.join(REPO, NOFLAG_HISTORY.s1cPrev))), HISTORICAL_S1C_SHA);
});
// Equipment C6c (E14): the S1b baseline moved from aaa678a to ce7d009 (the C6b commit). The delta is EXACT and attributed (handoff-next/equip/c6/noflag/audit.md, section 21): C2 added party[].startEquip (project, all 11),
// C3/C4/C5b added symbols and C1b shifted the RPG code.* addresses by +6 (symbols.json, all 11), C1b and C3b moved the three RPG ROMs (rom + scene.nes). The rendered Lua and every action ROM are untouched.
const S1B_RPG_CONFIGS = ['manifest-rpg-walk', 'manifest-rpg-name', 'move-rpg-flash-flash'];
test('S1b continuity aaa678a -> ce7d009 (E14): the same 11 configurations; manifest.lua equal in all 11; rom and scene.nes equal in the 8 action configurations and different in exactly the 3 RPG ones; project and symbols.json different in all 11 (28 of 55 differ, 27 equal)', () => {
  const o = JSON.parse(fs.readFileSync(path.join(REPO, NOFLAG_HISTORY.s1bPrev), 'utf8')), n = JSON.parse(fs.readFileSync(path.join(REPO, NOFLAG_BASELINES.s1b), 'utf8'));
  assert.deepEqual(Object.keys(n), Object.keys(o), 'same configurations in the same order');
  assert.equal(Object.keys(o).length, 11);
  let differ = 0, equal = 0;
  for (const c of Object.keys(o)) {
    assert.deepEqual(Object.keys(n[c]), Object.keys(o[c]), `${c}: same artifact keys`);
    for (const k of Object.keys(o[c])) {
      const rpgRom = (k === 'rom' || k === 'scene.nes') && S1B_RPG_CONFIGS.includes(c);
      const mustDiffer = k === 'project' || k === 'symbols.json' || rpgRom;
      if (mustDiffer) assert.notEqual(n[c][k], o[c][k], `${c}/${k} must differ from aaa678a`); else assert.equal(n[c][k], o[c][k], `${c}/${k} must keep its aaa678a hash`);
      if (n[c][k] === o[c][k]) equal++; else differ++;
    }
  }
  assert.deepEqual([differ, equal], [28, 27]);
});
test('S1b project continuity (E14): rebuilding each of the 11 configurations in memory exactly as s1b_noflag.mjs does and deleting party[].startEquip (in this test only) reproduces the aaa678a project hash, so the project delta is exactly the C2 schema addition', async () => {
  const src = fs.readFileSync(path.join(HERE, 's1b_noflag.mjs'), 'utf8');
  const CONFIGS = new Function(`return ${src.match(/export const CONFIGS = (\[[\s\S]*?\n\]);/)[1]}`)();
  const old = JSON.parse(fs.readFileSync(path.join(REPO, NOFLAG_HISTORY.s1bPrev), 'utf8'));
  assert.deepEqual(CONFIGS.map((c) => c.id), Object.keys(old), 'the recorder\'s configurations are the baseline\'s');
  const { runManifest } = await import('../run_sw_manifest.mjs');
  const { measureMove } = await import('../run_sw_move_manifest.mjs');
  const realStringify = JSON.stringify;
  let seen = null;
  // projectHash() is sha256(JSON.stringify(project)): capture the very object the harness hashes, then hash it again with startEquip deleted from a clone
  JSON.stringify = function (v, ...rest) { if (v && typeof v === 'object' && Array.isArray(v.party) && Array.isArray(v.maps)) seen = v; return realStringify(v, ...rest); };
  try {
    for (const cfg of CONFIGS) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-noflag-proj-'));
      try {
        seen = null;
        let res;
        if (cfg.kind === 'manifest') res = await runManifest({ ...cfg.opts, outDir: dir, prepareOnly: true });
        else ({ res } = await measureMove({ ...cfg.opts, outDir: dir, prepareOnly: true }));
        assert.ok(seen, `${cfg.id}: the harness hashed a project`);
        assert.equal(sha256(realStringify(seen)), res.prov.project, `${cfg.id}: the captured object is the one the harness hashed`);
        assert.ok(seen.party.some((m) => 'startEquip' in m), `${cfg.id}: the project carries the C2 startEquip default (else the strip proves nothing)`);
        const stripped = structuredClone(seen);
        for (const m of stripped.party) delete m.startEquip;
        assert.equal(sha256(realStringify(stripped)), old[cfg.id].project, `${cfg.id}: minus startEquip the project is the aaa678a project`);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
  } finally { JSON.stringify = realStringify; }
});
// Equipment C6c (E15): the S1c baseline moved from cd7a9f8 to ce7d009. Exactly the six close-deadline ROMs moved (the close-deadline builders assemble the RPG scene: C1b, then C3b); no NMI ROM, no rendered Lua moved.
test('S1c continuity cd7a9f8 -> ce7d009 (E15): the same 12 configurations and artifact keys; the 6 nmi-* ROM and Lua hashes equal; the 6 close-* Lua hashes equal; the 6 close-* sw_close_deadline.nes hashes different (6 of 24 differ)', () => {
  const o = JSON.parse(fs.readFileSync(path.join(REPO, NOFLAG_HISTORY.s1cPrev), 'utf8')), n = JSON.parse(fs.readFileSync(path.join(REPO, NOFLAG_BASELINES.s1c), 'utf8'));
  assert.deepEqual(Object.keys(n), Object.keys(o), 'same configurations in the same order');
  assert.equal(Object.keys(o).length, 12);
  assert.equal(Object.keys(o).filter((c) => c.startsWith('nmi-')).length, 6);
  assert.equal(Object.keys(o).filter((c) => c.startsWith('close-')).length, 6);
  let differ = 0;
  for (const c of Object.keys(o)) {
    assert.deepEqual(Object.keys(n[c]), Object.keys(o[c]), `${c}: same artifact keys`);
    for (const k of Object.keys(o[c])) {
      if (c.startsWith('close-') && k === 'sw_close_deadline.nes') assert.notEqual(n[c][k], o[c][k], `${c}/${k} must differ from cd7a9f8`);
      else assert.equal(n[c][k], o[c][k], `${c}/${k} must keep its cd7a9f8 hash`);
      if (n[c][k] !== o[c][k]) differ++;
    }
  }
  assert.equal(differ, 6);
});
test('SABOTAGE of the required-input rule: a required input that is missing REFUSES the fingerprint (it is never silently omitted), with or without the gap check', () => {
  for (const f of REQUIRED_DATA) {
    const required = [...EXTRA_ROOT, f.replace(/\.([^./]+)$/, '.missing.$1')];
    assert.throws(() => harnessFingerprint({ required }), (e) => e.message.includes('required input') && e.message.includes('.missing.'), `a missing ${f} must refuse`);
    assert.throws(() => harnessFingerprint({ required, check: false }), /required input/, 'refused even with the gap check off');
  }
  assert.throws(() => harnessFingerprint({ required: ['test/lua/ring_gate/noflag/no-such-baseline.json'] }), /lacks required input file\(s\): test\/lua\/ring_gate\/noflag\/no-such-baseline\.json/);
  // the old behaviour (skip what is absent) would have returned a fingerprint without the file; the real default list is never short of the tracked inputs
  assert.ok(Object.keys(harnessFingerprint()).length >= EXTRA_ROOT.length);
});

// ---- Part E: the checked allocation map holds the place identity bytes; cur_map is a CHAINED equate, resolved by the repo's own scanner
test('RING_ADDR agrees with engine/constants.asm through scanEquates/resolveEquates, cur_map (= bt_owner_rec+1) and flat_screen included', () => {
  const pending = new Map();
  scanEquates(fs.readFileSync(path.join(REPO, 'engine/constants.asm'), 'utf8'), pending);
  scanEquates(STOCK_CARTRIDGE_EQUATES, pending);
  const symbols = new Map();
  resolveEquates(pending, symbols);
  assert.deepEqual(checkAddresses(symbols), []);
  for (const n of ['cur_map', 'flat_screen', 'bt_from_ent']) assert.equal(RING_ADDR[n], symbols.get(n), n);
  // the chain is real: cur_map is not a literal in constants.asm
  assert.match(fs.readFileSync(path.join(REPO, 'engine/constants.asm'), 'utf8'), /^cur_map\s*=\s*bt_owner_rec\+1/m);
  // a moved byte fails loudly
  const moved = new Map(symbols); moved.set('cur_map', 0x8b);
  assert.deepEqual(checkAddresses(moved), ['cur_map: transcribed $8a, build has $8b']);
});
test('the ordinary-mode battle repro is scheduled in the matrix beside the streamed one, with the same anchored pattern', () => {
  const list = jobs('/p', '/l');
  const s = list.find((j) => j.name === 'repro-battle-slot5'), o = list.find((j) => j.name === 'repro-battle-slot5-ordinary');
  assert.ok(s && o);
  assert.deepEqual([s.argv[1], o.argv[1]], ['streamed', 'ordinary']);
  assert.equal(String(s.expect.log), String(o.expect.log));
  assert.ok(String(o.expect.log).startsWith('/^') && String(o.expect.log).endsWith('$/m'), 'anchored');
});

// ---- Part E: a selection of only stamp-free jobs reports its verdicts and skips the audit; the full certificate's empty-directory refusal stays
test('the matrix: an all-raw --only selection exits 0 and says the audit was skipped (real CLI); a selection with a stamping job still audits and refuses an empty directory', () => {
  const P = tmp(), L = tmp();
  try {
    const r = spawnSync('node', ['test/lua/ring_gate/run_matrix.mjs', P, L, '--only=^selection-(misspelled-cell|unknown-argument)$'], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^OK +selection-misspelled-cell/m);
    assert.match(r.stdout, /provenance audit SKIPPED: all 2 selected jobs are stamp-free/);
    assert.doesNotMatch(r.stdout, /PROVENANCE PROBLEM|no stamps at all/);
    // the same code path with a stamping job in the selection: the audit runs, and an empty provenance directory is a problem (exit 1)
    const list = [{ name: 'stamping', argv: [], expect: { exit: 0, log: /x/ }, group: 1, stamps: true }, { name: 'raw', argv: [], expect: { exit: 0, log: /x/ }, group: 1, stamps: false }];
    const rows = list.map((j) => ({ job: j, res: { status: 0, log: 'x' }, verdict: { ok: true, why: '' } }));
    const full = matrixReport(list, rows, [], P, L);
    assert.equal(full.code, 1);
    assert.ok(full.audit.problems.some((p) => /no stamps at all/.test(p)), full.lines.join('|'));
    assert.ok(!full.lines.some((l) => /SKIPPED/.test(l)));
    // and the raw-only selection with an UNEXPECTED job still exits 1
    const bad = [{ ...list[1], name: 'raw-bad' }];
    const rep = matrixReport(bad, [{ job: bad[0], res: { status: 3, log: 'y' }, verdict: { ok: false, why: 'exit 3, declared 0' } }], [{ job: bad[0] }], P, L);
    assert.equal(rep.code, 1);
    // the audit itself is untouched: an empty directory is refused
    assert.ok(auditProvenance(P, null).problems.some((p) => /no stamps at all/.test(p)));
  } finally { fs.rmSync(P, { recursive: true, force: true }); fs.rmSync(L, { recursive: true, force: true }); }
});

test('auditCampaignResult: a real Mesen Continue result audits clean; an altered plan, a dropped witness record, a missing invocation, touched user saves and a reasonless unmeasured row each fail', async () => {
  const { auditCampaignResult } = await import('./ringprovindex.mjs');
  const { sha256 } = await import('./ringtree.mjs');
  const hex = (c) => c.repeat(64);
  const planned = { sceneId: 'land-s1-y224', placement: 'resident', n: 4, start: null, talkers: 'none', steps: [{ op: 'boot' }, { op: 'cycle', axis: 'x', target: 't', battery: true }], sequence: [{ t: 'check', label: 'a' }], witnesses: ['w1', 'w2'] };
  const good = {
    scene: 'land-s1-y224', emu: 'mesen', coverageOk: true, sabotage: null, userSavesUntouched: true,
    plan: { ...planned, sha256: sha256(JSON.stringify(planned)), projectSha256: hex('a') },
    witnessMap: { w1: { label: 'x', index: 0 }, w2: { label: 'y', index: 3 } },
    mesenChain: [
      { n: 1, status: 0, pid: 5, settingsSha256: hex('b'), persistence: 'battery RAM (.sav)', seededSaves: {}, producedSaves: { 'game.sav': { sha256: hex('c'), bytes: 8192 } } },
      { n: 2, status: 0, pid: 6, settingsSha256: hex('b'), persistence: 'battery RAM (.sav)', seededSaves: { 'game.sav': { sha256: hex('c'), bytes: 8192 } }, producedSaves: {} }
    ]
  };
  assert.deepEqual(auditCampaignResult(good, 'x'), []);
  const probs = (r) => auditCampaignResult(r, 'x').join(' | ');
  assert.match(probs({ ...good, plan: { ...good.plan, witnesses: ['w1', 'w2', 'w3'] } }), /does not hash to its own sha256/);
  assert.match(probs({ ...good, plan: { ...good.plan, steps: [{ op: 'boot' }, { op: 'cycle' }, { op: 'boot' }] } }), /does not hash/);
  assert.match(probs({ ...good, witnessMap: { w1: { label: 'x', index: 0 }, w2: null } }), /witness w2 passed coverage but has no first-observing record/);
  assert.match(probs({ ...good, witnessMap: { w1: { label: 'x', index: 0 } } }), /does not list exactly the planned witnesses/);
  assert.match(probs({ ...good, mesenChain: [good.mesenChain[0]] }), /must be 2 invocations/);
  assert.match(probs({ ...good, userSavesUntouched: false }), /user's own Mesen saves/);
  assert.match(probs({ ...good, mesenChain: [good.mesenChain[0], { ...good.mesenChain[1], seededSaves: {} }] }), /persisted save files/);
  assert.match(probs({ scene: 's', emu: 'mesen', unmeasured: '' }), /without its reason/);
  assert.deepEqual(auditCampaignResult({ scene: 's', emu: 'mesen', unmeasured: 'the registry does not run this scene in mesen' }, 'x'), []);
});

test('writeAttempt: under RING_PROV_UNIQUE a second writer of one label is refused (it would replace the first stamp\'s results); without it the old behaviour holds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-unique-'));
  try {
    const prev = process.env.RING_PROV_UNIQUE;
    delete process.env.RING_PROV_UNIQUE;
    writeAttempt(dir, 'x', { kind: 'cell-build' });
    writeAttempt(dir, 'x', { kind: 'cell-build' }); // plain re-run: overwrite
    process.env.RING_PROV_UNIQUE = '1';
    assert.throws(() => writeAttempt(dir, 'x', { kind: 'cell-build' }), /stamp collision/);
    assert.ok(writeAttempt(dir, 'y', { kind: 'cell-build' }));
    if (prev === undefined) delete process.env.RING_PROV_UNIQUE; else process.env.RING_PROV_UNIQUE = prev;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- the Mesen executable is resolved ONCE, to an absolute path, and that one path is spawned, stamped and used for the availability decision (commit review finding 1)
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const stub = (p, body = 'printf "STUB_EXECUTABLE %s\\n" "$0"\n') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, `#!/bin/sh\n${body}`, { mode: 0o755 }); return p; };
/** Runs a child node in a controlled environment that imports the harness's own resolver, stamps what it resolved and spawns it (the reviewer's path-probe, bounded). */
function probe({ env, cwd }) {
  const code = `import {MESEN,MESEN_ERROR,mesenUnavailable} from ${JSON.stringify(path.join(HERE, 'ringrun_mesen.mjs'))};
import {mesenStamp} from ${JSON.stringify(path.join(HERE, 'ringprov.mjs'))};
import {spawnSync} from 'node:child_process';
const out={MESEN,MESEN_ERROR,unavailable:mesenUnavailable()};
if(MESEN){const r=spawnSync(MESEN,[],{encoding:'utf8'});out.ran=r.stdout.trim();out.stampedPath=mesenStamp(MESEN).binary;out.stampedSha=mesenStamp(MESEN).binarySha256;}
console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const sandbox = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesen-resolve-')); const d = (n) => { const p = path.join(root, n); fs.mkdirSync(p, { recursive: true }); return p; }; return { root, bin: d('bin'), cwd: d('cwd'), home: d('home'), d }; };

test('Mesen resolution: an absolute $MESEN is the path spawned AND stamped (a working-directory decoy is never hashed)', () => {
  const sb = sandbox();
  try {
    const actual = stub(path.join(sb.d('elsewhere'), 'Mesen'));
    const decoy = path.join(sb.cwd, 'Mesen'); fs.writeFileSync(decoy, 'unexecuted working-directory decoy');
    const got = probe({ cwd: sb.cwd, env: { HOME: sb.home, PATH: `${sb.bin}:/usr/bin:/bin`, MESEN: actual } });
    assert.equal(got.MESEN, actual); assert.equal(got.stampedPath, actual);
    assert.match(got.ran, /^STUB_EXECUTABLE /); assert.equal(got.stampedSha, sha(actual)); assert.notEqual(got.stampedSha, sha(decoy));
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

test('Mesen resolution: a PATH-only Mesen is resolved to its ABSOLUTE path; the stamp hashes the PATH executable that ran, not a same-named file in the working directory', () => {
  const sb = sandbox();
  try {
    const actual = stub(path.join(sb.bin, 'Mesen'));
    const decoy = path.join(sb.cwd, 'Mesen'); fs.writeFileSync(decoy, 'unexecuted working-directory decoy');
    const got = probe({ cwd: sb.cwd, env: { HOME: sb.home, PATH: `${sb.bin}:/usr/bin:/bin` } });
    assert.equal(got.MESEN, actual, 'a bare `Mesen` was kept instead of the absolute PATH hit');
    assert.match(got.ran, /^STUB_EXECUTABLE /); assert.equal(got.stampedPath, actual);
    assert.equal(got.stampedSha, sha(actual)); assert.notEqual(got.stampedSha, sha(decoy));
    assert.equal(got.unavailable, null);
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

test('Mesen resolution: no Mesen anywhere is "unavailable" (null, no error: a counted unit skip / UNMEASURED row), precedence is $MESEN > home candidate > PATH, and a bad $MESEN is an explicit error', () => {
  const sb = sandbox();
  try {
    const none = probe({ cwd: sb.cwd, env: { HOME: sb.home, PATH: `${sb.bin}:/usr/bin:/bin` } });
    assert.equal(none.MESEN, null); assert.equal(none.MESEN_ERROR, null); assert.match(none.unavailable, /no executable Mesen/);
    const pathOne = stub(path.join(sb.bin, 'Mesen'));
    const homeOne = stub(path.join(sb.home, 'Downloads/Mesen2/bin/linux-x64/Release/Mesen'));
    const envOne = stub(path.join(sb.d('chosen'), 'Mesen'));
    const env = { HOME: sb.home, PATH: `${sb.bin}:/usr/bin:/bin` };
    assert.equal(resolveMesen({ env, home: sb.home }).path, homeOne, 'the home candidate beats PATH');
    assert.equal(resolveMesen({ env: { ...env, MESEN: envOne }, home: sb.home }).path, envOne, '$MESEN beats the home candidate and PATH');
    assert.equal(resolveMesen({ env: { ...env, MESEN: 'Mesen' }, home: sb.home }).path, pathOne, 'a bare $MESEN is looked up on PATH and made absolute');
    fs.rmSync(homeOne); assert.equal(resolveMesen({ env, home: sb.home }).path, pathOne, 'PATH is the last resort');
    // executability, not existence: a non-executable file, a missing path and a directory are all explicit errors, never a fallback to another Mesen
    const plain = path.join(sb.cwd, 'plain'); fs.writeFileSync(plain, 'data', { mode: 0o644 });
    for (const bad of [plain, path.join(sb.cwd, 'absent'), sb.cwd, 'no-such-command']) {
      const r = resolveMesen({ env: { ...env, MESEN: bad }, home: sb.home });
      assert.equal(r.path, null, bad); assert.match(r.error, /is not an executable file/, bad);
    }
    const viaChild = probe({ cwd: sb.cwd, env: { ...env, MESEN: plain } });
    assert.equal(viaChild.MESEN, null); assert.match(viaChild.MESEN_ERROR, /is not an executable file/); assert.equal(viaChild.unavailable, viaChild.MESEN_ERROR);
    assert.throws(() => mesenStamp('Mesen'), /not an absolute path/);
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

test('a campaign that requests Mesen when none can run fails EXPLICITLY: an UNMEASURED row and exit 1, with the reason (real CLI, jsnes still runs)', () => {
  const sb = sandbox();
  try {
    const r = spawnSync(process.execPath, ['test/lua/ring_gate/run_campaign.mjs', '--emu=both', '--cell=MMC1-V', '--gt=action', '--scene=redraw-guard'], { cwd: path.resolve(HERE, '../../..'), env: { ...process.env, MESEN: path.join(sb.cwd, 'absent') }, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /redraw-guard resident jsnes\s+vram=PASS coverage=PASS/);
    assert.match(r.stdout, /redraw-guard resident mesen\s+UNMEASURED Mesen is unavailable: \$MESEN=.*is not an executable file/);
    assert.match(r.stdout, /^1 executed, 0 FAIL, 0 ERROR, 0 N\/A, 1 unmeasured$/m);
  } finally { fs.rmSync(sb.root, { recursive: true, force: true }); }
});

// ---- an oracle (row 3) Mesen row retains the invocation and the user-saves attestation, and the audit refuses one that does not (S1b part A.3)
test('auditCampaignResult: an oracle Mesen row without userSavesUntouched or its invocation fails the audit; with both it is clean; a jsnes oracle row needs neither', async () => {
  const { auditCampaignResult } = await import('./ringprovindex.mjs');
  const inv = { n: 1, ops: 'boot,check', status: 0, pid: 4242, settingsSha256: 'a'.repeat(64), seededSaves: {}, producedSaves: {} };
  const good = { cell: 'MMC1-V', emu: 'mesen', vramOk: true, emulatorStamp: { emulator: 'Mesen2 --testRunner' }, mesenChain: [inv], userSavesUntouched: true };
  const probs = (r) => auditCampaignResult(r, 'x').join(' | ');
  assert.equal(probs(good), '');
  assert.match(probs({ ...good, userSavesUntouched: undefined }), /does not attest/);
  assert.match(probs({ ...good, mesenChain: undefined }), /does not retain its one Mesen invocation/);
  assert.match(probs({ ...good, mesenChain: [{ ...inv, status: 3 }] }), /does not retain its one Mesen invocation/);
  assert.equal(probs({ cell: 'MMC1-V', emu: 'jsnes', vramOk: true, emulatorStamp: { emulator: 'jsnes (vendored core)' } }), '');
});

// ---- S3 C2: the gate certifies the PRODUCTION vertical AND horizontal rings; neither cell kind is ever re-patched into the S1 prototype
const RETIRED = Object.keys(RETIRED_PATCHES);
const PROTO_RETIRED = RETIRED.filter((n) => n !== LIFT_PATCH); // the S1 prototype's three (the refusal lift's retirement is a different one: S5 C3, tested below)
const PROTO_BASE = 'cd7a9f8'; // the last baseline whose ring-2 tree was the S1 prototype: its three patches (and the prototype's 00) are in git history at 803a252
const gitHead = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
const gitShow = (spec) => execFileSync('git', ['show', spec], { cwd: REPO, maxBuffer: 64 << 20 });
const blobSha1 = (bytes) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
let protoCache = null;
/** The S1 prototype tree's ring files ({file -> Buffer}): PROTO_BASE's sources with the prototype's 00 and the three retired patches (read from git history) applied -- what a ring-2 cell used to be built from. */
function prototypeFiles() {
  if (protoCache) return protoCache;
  const scratch = tmp();
  try {
    const patches = ['00-refusal-lift.patch', ...PROTO_RETIRED].map((n) => gitShow(`803a252:test/lua/ring_gate/${n}`));
    const files = new Set(patches.flatMap((b) => patchedFiles(b.toString('utf8'))));
    for (const f of files) { fs.mkdirSync(path.dirname(path.join(scratch, f)), { recursive: true }); fs.writeFileSync(path.join(scratch, f), gitShow(`${PROTO_BASE}:${f}`)); }
    for (const b of patches) execFileSync('git', ['apply', '-p2', '--whitespace=nowarn', '-'], { cwd: scratch, input: b, stdio: ['pipe', 'pipe', 'pipe'] });
    protoCache = Object.fromEntries([...files].sort().map((f) => [f, fs.readFileSync(path.join(scratch, f))]));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  return protoCache;
}
/** Re-patches a production ring tree into the S1 prototype: the prototype's ring files replace the tree's. */
const repatchIntoPrototype = (root) => { for (const [f, bytes] of Object.entries(prototypeFiles())) fs.writeFileSync(path.join(root, f), bytes); };
const RING_CELL = { 1: REP[1].id, 2: REP[2].id };
test('BASELINE is a real commit whose engine/main/shared the working tree equals; a ring tree carries no required patch (the refusal lift is retired)', () => {
  assert.match(BASELINE, /^[0-9a-f]{40}$/);
  assert.equal(gitHead('cat-file', '-t', BASELINE), 'commit');
  assert.equal(BASELINE, 'ce7d0091ca6c016bfdfc5a3369af329fb3ba8bf9', 'Equipment C6b: the commit whose engine/main/shared the matrix certifies; it carries f3833db\'s ring admission (UNROM 512, MMC1, MMC3), so production refuses none of the 18 cells');
  assert.deepEqual(patchSetFor(false), []);
  assert.throws(() => patchSetFor(true), /refusal lift .* is retired at S5 C3/);
  assert.equal(LIFT_PATCH, '00-refusal-lift.patch');
});
test('the S1 prototype patches are RETIRED: in no ring\'s patch set, not on disk, not in the fingerprint, refused by name, and production ships what each one added (none still applies to BASELINE)', () => {
  assert.deepEqual(PROTO_RETIRED, ['01-ring-select.patch', '02-ring-engine.patch', '03-player-far-branch.patch']);
  const fp = Object.keys(harnessFingerprint());
  for (const n of PROTO_RETIRED) {
    assert.ok(!patchSetFor(false).includes(n), `${n} is in the patch set`);
    assert.ok(!fs.existsSync(path.join(PATCH_DIR, n)), `${n} still exists on disk`);
    assert.ok(!fp.includes(`test/lua/ring_gate/${n}`), `${n} is in the harness fingerprint`);
    assert.ok(RETIRED_PATCHES[n].reason.length > 20, `${n}: a retirement records its reason`);
    assert.throws(() => patchFile(n), /is retired/);
    assert.throws(() => patchFile(n, 1), /is retired/);
    assert.throws(() => makeTree({ ring: 2, lifted: false, extra: [n] }), /is retired/);
    assert.throws(() => makeTree({ ring: 1, lifted: false, extra: [n] }), /is retired/);
    // the retired file is identified by its bytes in git history, and it can no longer be applied to BASELINE (its effect is shipped: checkRetiredShipped below names the needles)
    const bytes = gitShow(`803a252:test/lua/ring_gate/${n}`);
    assert.equal(sha256(bytes), RETIRED_PATCHES[n].sha256, `${n}: the recorded hash is the file's at 803a252`);
    const scratch = tmp();
    try {
      for (const f of patchedFiles(bytes.toString('utf8'))) { fs.mkdirSync(path.dirname(path.join(scratch, f)), { recursive: true }); fs.writeFileSync(path.join(scratch, f), gitShow(`${BASELINE}:${f}`)); }
      assert.throws(() => execFileSync('git', ['apply', '--check', '-p2', '--whitespace=nowarn', '-'], { cwd: scratch, input: bytes, stdio: ['pipe', 'pipe', 'pipe'] }), `${n} would still change ${BASELINE}`);
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }
  assert.ok(checkRetiredShipped() >= 8, 'the needles of every retirement are in BASELINE');
});
test('the declared rings of each sabotage equal the patch files that exist (a ring with no meaningful form has none and a printed proof: wrap-row-32 on ring 1, strip-len-30-vertical and wrap-col-30 on ring 2)', () => {
  const horizontal = fs.readdirSync(path.join(PATCH_DIR, 'sabotage')).filter((f) => f.endsWith('.patch')).map((f) => f.slice(0, -6)).sort();
  const vertical = fs.readdirSync(path.join(PATCH_DIR, 'sabotage', 'vertical')).filter((f) => f.endsWith('.patch')).map((f) => f.slice(0, -6)).sort();
  const names = Object.keys(IDENTITY_OUTCOME).sort();
  for (const n of names) {
    assert.equal(sabotageHasRing(n, 2), sabotageRings(n).includes(2), `${n}: ring 2`);
    assert.equal(sabotageHasRing(n, 1), sabotageRings(n).includes(1), `${n}: ring 1`);
  }
  assert.deepEqual(horizontal, names.filter((n) => sabotageRings(n).includes(2)));
  assert.deepEqual(vertical, names.filter((n) => sabotageRings(n).includes(1)));
  // the exclusions are exactly these three equivalent mutants; every one carries its own reason and nothing else is excluded
  const EXCLUDED = { 'strip-len-30-vertical': [1], 'wrap-col-30': [1], 'wrap-row-32': [2] };
  assert.deepEqual(SABOTAGE_RINGS, EXCLUDED);
  assert.deepEqual(names.filter((n) => sabotageRings(n).length !== 2), Object.keys(EXCLUDED).sort());
  assert.deepEqual(Object.keys(NO_FORM_REASON).sort(), Object.keys(EXCLUDED).sort());
  for (const [n, rings] of Object.entries(EXCLUDED)) {
    const gone = 3 - rings[0];
    assert.deepEqual(Object.keys(NO_FORM_REASON[n]).map(Number), [gone], `${n}: the reason names the ring that has no form`);
    assert.match(noFormReason(n, gone), /equivalent mutant/);
    assert.throws(() => makeTree({ ring: gone, lifted: false, extra: [n] }), new RegExp(`no ring-${gone} form: .*equivalent mutant`));
  }
});
// The three equivalent mutants, each shown by building both rings' ROMs with and without the mutation (the edit is the one regen_patches.mjs cuts for the ring that keeps the form).
const EQUIVALENT_MUTANTS = {
  'wrap-row-32': { noFormRing: 1, edit: { file: 'engine/streamworld.asm', from: 'sw_ring_wrap_row:\n  cmp #SW_RING_ROW_LEN', to: 'sw_ring_wrap_row:\n  cmp #32' }, why: '`cmp #32` assembles to the bytes `cmp #SW_RING_ROW_LEN` (= 32) already is' },
  'wrap-col-30': { noFormRing: 2, edit: { file: 'engine/streamworld.asm', from: 'sw_ring_wrap_col:\n  cmp #SW_RING_COL_LEN', to: 'sw_ring_wrap_col:\n  cmp #30' }, why: '`cmp #30` assembles to the bytes `cmp #SW_RING_COL_LEN` (= 30) already is' },
  'strip-len-30-vertical': { noFormRing: 2, edit: { file: 'main/build/generate.js', from: 'SW_RING_COL_LEN = ${ringMode === 1 ? 15 : 30}', to: 'SW_RING_COL_LEN = 30' }, why: 'the generator already emits SW_RING_COL_LEN = 30' }
};
test('wrap-row-32 on ring 1, wrap-col-30 and strip-len-30-vertical on ring 2 are EQUIVALENT MUTANTS, shown by building: the ROM with the mutation is byte-identical to the one without it on the excluded ring, while on the other ring the same mutation changes the ROM', async () => {
  const rom = async (cell, edits) => {
    const tree = makeBypassTree({ edits });
    try {
      const loaded = await loadBypassTree(tree);
      const b = await buildThrough(loaded, ringProject({ cell, gameType: 'action' }).project);
      try { return fs.readFileSync(b.romPath); } finally { fs.rmSync(b.dir, { recursive: true, force: true }); }
    } finally { tree.dispose(); }
  };
  const cells = { 1: cellById('MMC1-V'), 2: cellById('MMC1-H') };
  const base = { 1: await rom(cells[1], []), 2: await rom(cells[2], []) };
  assert.ok(base[1].length > 16 && base[2].length > 16);
  assert.deepEqual(Object.keys(EQUIVALENT_MUTANTS).sort(), Object.keys(SABOTAGE_RINGS).sort(), 'every excluded sabotage has its evidence');
  for (const [name, m] of Object.entries(EQUIVALENT_MUTANTS)) {
    const dead = m.noFormRing, live = 3 - dead;
    assert.deepEqual(sabotageRings(name), [live], `${name}: SABOTAGE_RINGS keeps exactly the ring where the mutation is real`);
    const mutated = { [dead]: await rom(cells[dead], [m.edit]), [live]: await rom(cells[live], [m.edit]) };
    assert.ok(base[dead].equals(mutated[dead]), `${name} on ring ${dead}: ${m.why}, so the ROM is unchanged`);
    assert.ok(!base[live].equals(mutated[live]), `${name} on ring ${live}: the mutation is real`);
  }
});
test('every patch of the shipped set and every sabotage form applies to its own ring\'s tree and changes something; each tree changes only what its patches declare', () => {
  for (const ring of [1, 2]) {
    const t = makeTree({ ring, lifted: false });
    try {
      assert.equal(t.kind, TREE_KIND[ring]);
      assert.deepEqual(t.patches.map((p) => p.name), patchSetFor(false));
      assert.deepEqual(filesDifferingFromBaseline(t.root), [], `ring ${ring}: the files that differ from ${BASELINE}`);
    } finally { fs.rmSync(t.root, { recursive: true, force: true }); }
    for (const n of Object.keys(IDENTITY_OUTCOME)) {
      if (!sabotageRings(n).includes(ring)) continue;
      const s = makeTree({ ring, lifted: false, extra: [n] });
      try {
        const declared = new Set(s.patches.flatMap((p) => patchedFiles(fs.readFileSync(patchFile(p.name, ring), 'utf8'))));
        assert.deepEqual(new Set(filesDifferingFromBaseline(s.root)), declared, `${n} (ring ${ring}) changes exactly the files its patches declare`);
        const sab = patchedFiles(fs.readFileSync(patchFile(n, ring), 'utf8'));
        assert.ok(sab.length > 0, `${n}`);
        for (const f of sab) assert.ok(filesDifferingFromBaseline(s.root).includes(f), `${n} (ring ${ring}) really changes ${f}`);
      } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
    }
  }
});
test('a ring tree is the shipped forks unmodified: no file differs from BASELINE, the shipped fork text is in the tree\'s own files, and the proof names the ring it was made for', () => {
  for (const ring of [1, 2]) {
    const t = makeTree({ ring, lifted: false });
    try {
      assert.deepEqual(t.production.changed, []);
      assert.equal(t.production.ring, ring);
      assert.equal(t.production.exact, true);
      assert.deepEqual(t.production.unmodifiedShippedFiles.sort(), ring === 1 ? ['engine/streamworld.asm', 'main/build/generate.js', 'shared/cartridge.js'] : ['engine/player.asm', 'engine/streamworld.asm', 'main/build/generate.js', 'shared/cartridge.js']);
      const asm = fs.readFileSync(path.join(t.root, 'engine/streamworld.asm'), 'utf8');
      for (const l of ['sw_ring_col_cmp:', 'sw_ring_col_len:', 'sw_ring_wrap_col:', 'sw_ring_nt_step:', 'sw_ring_nt_end:', 'sw_ring_row_cmp:', 'sw_ring_row_len:', 'sw_ring_wrap_row:']) assert.ok(asm.includes(l), `ring ${ring}: ${l}`);
      assert.ok(fs.readFileSync(path.join(t.root, 'main/build/generate.js'), 'utf8').includes('SW_RING_ROW_LEN'));
      assert.ok(fs.readFileSync(path.join(t.root, 'engine/player.asm'), 'utf8').includes('bne ring_far1'));
      assert.doesNotThrow(() => verifyProduction(t.root, t.applied, ring, false));
    } finally { fs.rmSync(t.root, { recursive: true, force: true }); }
  }
});
test('SABOTAGE of the production assertion: a ring tree re-patched into the S1 prototype, or edited by hand, FAILS it (and a cell will not build through it); a retired patch named among the applied ones is refused', async () => {
  for (const ring of [1, 2]) {
    const cell = cellById(RING_CELL[ring]);
    const t = makeTree({ ring, lifted: false });
    try {
      repatchIntoPrototype(t.root);
      assert.ok(filesDifferingFromBaseline(t.root).includes('engine/player.asm'), 'the prototype really differs from the shipped ring');
      assert.throws(() => verifyProduction(t.root, t.applied, ring, false), /differs from .* in files no applied patch declares/, `ring ${ring}`);
      assert.throws(() => assertTreeForCell(t, cell, REP[ring].gameType), /differs from/, `ring ${ring}`);
      await assert.rejects(loadTree(t), /differs from/);
    } finally { fs.rmSync(t.root, { recursive: true, force: true }); }
    const u = makeTree({ ring, lifted: false });
    try {
      for (const n of PROTO_RETIRED) assert.throws(() => verifyProduction(u.root, [...u.applied, { name: n, file: path.join(PATCH_DIR, n) }], ring, false), /retired prototype patch/, n);
      // a hand edit of one shipped fork operand (what a partial re-patch would do)
      const f = path.join(u.root, 'engine/streamworld.asm');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('cmp #SW_RING_COL_LEN\n  .else', 'cmp #30\n  .else'));
      assert.throws(() => verifyProduction(u.root, u.applied, ring, false), /engine\/streamworld\.asm/);
      // a tree that equals BASELINE where its sabotage form should be: the patch did nothing
      const u2 = makeTree({ ring, lifted: false, extra: ['dest-plus08-vertical'] });
      try {
        fs.writeFileSync(path.join(u2.root, 'engine/streamworld.asm'), gitShow(`${BASELINE}:engine/streamworld.asm`));
        assert.throws(() => verifyProduction(u2.root, u2.applied, ring, false), /the patch did nothing/);
      } finally { fs.rmSync(u2.root, { recursive: true, force: true }); }
    } finally { fs.rmSync(u.root, { recursive: true, force: true }); }
  }
  // the prototype fixture is what the harness used to build: it carries the row fork as a PATCH, which the shipped tree now ships (so a re-patch is a real change, not a no-op)
  // (engine/streamworld.asm itself is line-for-line the shipped file, which is why C1 could retire patch 02: the files that differ are the player, the generator and the refusal lift)
  assert.ok(prototypeFiles()['engine/streamworld.asm'].equals(fs.readFileSync(path.join(REPO, 'engine/streamworld.asm'))));
  for (const f of ['engine/player.asm', 'main/build/generate.js']) assert.ok(!prototypeFiles()[f].equals(fs.readFileSync(path.join(REPO, f))), `${f}: the prototype's text is not the shipped text`);
});
test('a cell is built only through its own ring\'s tree: a vertical cell refuses the horizontal tree and a horizontal cell refuses the vertical one', () => {
  const set = makeTreeSet();
  try {
    assert.doesNotThrow(() => assertTreeForCell(set.forCell(cellById('MMC3-V'), 'action'), cellById('MMC3-V'), 'action'));
    assert.doesNotThrow(() => assertTreeForCell(set.forCell(cellById('MMC3-H'), 'action'), cellById('MMC3-H'), 'action'));
    assert.notEqual(set.forRing(1, false).root, set.forRing(2, false).root);
    assert.equal(set.forRing(1, false).kind, 'production-vertical');
    assert.equal(set.forRing(2, false).kind, 'production-horizontal');
    assert.throws(() => assertTreeForCell(set.forRing(2, false), cellById('MMC3-V'), 'action'), /vertical cell is built only through the production-vertical tree/);
    assert.throws(() => assertTreeForCell(set.forRing(1, false), cellById('MMC3-H'), 'action'), /horizontal one only through the production-horizontal tree/);
  } finally { set.dispose(); }
  assert.throws(() => makeTree({ ring: true, lifted: false }), /ring must be 1/);
  assert.throws(() => makeTree({}), /ring must be 1/);
});
test('row 1 on a production build of EACH ring: the shipped fork operands pass identity; a forged record or ROM (a missing fork, a wrong constant, a flipped operand, the other ring\'s geometry) fails it; the stamp carries the exact proof and the consumed evidence', async () => {
  for (const ring of [1, 2]) {
    const cell = cellById(RING_CELL[ring]);
    const tree = makeTree({ ring, lifted: false });
    const { project } = ringProject({ cell, gameType: REP[ring].gameType });
    let built;
    try {
      built = await buildCell({ tree, project, cell, gameType: REP[ring].gameType, label: `unit-identity-${cell.id}` });
      assert.deepEqual(identityFailures(built, cell, { expectBanked: false }), [], `the production ring-${ring} ROM passes row 1`);
      assert.equal(built.prov.treeKind, TREE_KIND[ring]);
      assert.deepEqual(built.prov.productionProof, provenanceFor(ring, false).productionProof, 'the build\'s stamp carries the exact proof of the check that gated it');
      assert.equal(built.prov.consumed.engine.builds, 1, 'and the consumed-input evidence of its verified build');
      assert.equal(built.prov.ringConsts.SW_RING_ROW_LEN, ring === 1 ? 32 : 16, 'the generator emits the ring\'s own row length');
      assert.ok(Number.isFinite(built.fns.sw_ring_row_cmp), 'the row fork is assembled on every ring');
      const without = (label) => ({ ...built, fns: Object.fromEntries(Object.entries(built.fns).filter(([k]) => k !== label)) });
      assert.ok(identityFailures(without('sw_ring_col_cmp'), cell, { expectBanked: false }).some((f) => /sw_ring_col_cmp is not in game\.fns/.test(f)));
      assert.ok(identityFailures(without('sw_ring_row_cmp'), cell, { expectBanked: false }).some((f) => /sw_ring_row_cmp is not in game\.fns/.test(f)));
      const wrongLen = { ...built, prov: { ...built.prov, ringConsts: { ...built.prov.ringConsts, SW_RING_ROW_LEN: ring === 1 ? 16 : 32 } } };
      assert.ok(identityFailures(wrongLen, cell, { expectBanked: false }).some((f) => /SW_RING_ROW_LEN = /.test(f)));
      const rom = Buffer.from(built.rom);
      rom[fileOffsetOfKernelAddr(rom, built.fns.sw_ring_row_cmp) + 1] ^= 1;
      assert.ok(identityFailures({ ...built, rom }, cell, { expectBanked: false }).some((f) => /sw_ring_row_cmp.*operand/.test(f)), 'a flipped operand in the ROM');
      assert.ok(identityFailures(built, cell, { expectBanked: false, expectRing: 3 - ring }).length > 0, 'the other ring\'s geometry does not hold');
    } finally { if (built) fs.rmSync(built.dir, { recursive: true, force: true }); fs.rmSync(tree.root, { recursive: true, force: true }); }
  }
});

// ---- C3 fix 1, finding 1 (now for BOTH rings): the production proof compares EXACT content (BASELINE + the canonical hashed patches), not the set of changed file names
test('SABOTAGE of the exact-content proof, on BOTH rings: an edit inside a file a sabotage already declares (the review\'s repro shape), its #32 build variant, an edit of an undeclared file and one in a sabotage\'s other file are all refused', async () => {
  for (const ring of [1, 2]) {
    const cell = cellById(RING_CELL[ring]);
    // (1) dest-plus08-vertical declares engine/streamworld.asm; an UNDECLARED edit inside it keeps the changed-file NAMES exactly the declared ones
    const t = makeTree({ ring, lifted: false, extra: ['dest-plus08-vertical'] });
    try {
      assert.doesNotThrow(() => verifyProduction(t.root, t.applied, ring, false), 'the legitimate sabotage form is accepted');
      const f = path.join(t.root, 'engine/streamworld.asm');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replaceAll('#SW_RING_ROW_LEN', '#32'));
      assert.deepEqual(filesDifferingFromBaseline(t.root), patchedFiles(fs.readFileSync(patchFile('dest-plus08-vertical', ring), 'utf8')).sort(), 'the file NAMES are exactly the declared ones, which is why a name-set comparison passed this');
      assert.throws(() => verifyProduction(t.root, t.applied, ring, false), /engine\/streamworld\.asm is not .* plus its applied patches/);
      assert.throws(() => assertTreeForCell(t, cell, REP[ring].gameType), /plus its applied patches/);
      // (2) the #32 build variant: the build would complete -- the proof, run by loadTree at every build, refuses it first
      await assert.rejects(loadTree(t), /plus its applied patches/);
      const { project } = ringProject({ cell, gameType: REP[ring].gameType });
      const dir = tmp();
      try { await assert.rejects(buildCell({ tree: t, project, cell, gameType: REP[ring].gameType, provDir: dir, label: 'forged-row-fork' }), /plus its applied patches/); assert.deepEqual(fs.readdirSync(dir), [], 'no stamp is written for a build the proof refused'); }
      finally { fs.rmSync(dir, { recursive: true, force: true }); }
    } finally { fs.rmSync(t.root, { recursive: true, force: true }); }
    // (3) an edit of a file no patch declares (shared/project.js, where the retired refusal lift used to live), and one inside a sabotage's other declared file
    const a = makeTree({ ring, lifted: false });
    try {
      fs.appendFileSync(path.join(a.root, 'shared/project.js'), '\n// unauthorized additional source edit\n');
      assert.throws(() => assertTreeForCell(a, cell, REP[ring].gameType), /no applied patch declares .*: shared\/project\.js/);
    } finally { fs.rmSync(a.root, { recursive: true, force: true }); }
    const b = makeTree({ ring, lifted: false, extra: ['render-four-nts'] });
    try {
      fs.appendFileSync(path.join(b.root, 'main/build/generate.js'), '\n// a second edit in a file the sabotage declares\n');
      assert.throws(() => verifyProduction(b.root, b.applied, ring, false), /generate\.js is not .* plus its applied patches/);
    } finally { fs.rmSync(b.root, { recursive: true, force: true }); }
  }
});
test('the exact-content proof pins the patch list too, on both rings: non-canonical files, a hash changed since the tree was made, a non-sabotage name, a missing sabotage form, the retired lift, a retired prototype patch', () => {
  for (const ring of [1, 2]) {
    const t = makeTree({ ring, lifted: false, extra: ['render-four-nts'] });
    try {
      const [sab] = t.applied;
      const copy = path.join(t.root, 'copy-of-sab.patch');
      fs.copyFileSync(sab.file, copy);
      assert.throws(() => verifyProduction(t.root, [{ ...sab, file: copy }], ring, false), /not the canonical/);
      assert.throws(() => verifyProduction(t.root, [{ ...sab, sha256: '0'.repeat(64) }], ring, false), /changed on disk since the tree was made/);
      assert.throws(() => verifyProduction(t.root, [sab, { name: 'not-a-sabotage.patch', file: sab.file }], ring, false), /only sabotage forms/);
      assert.throws(() => verifyProduction(t.root, [], ring, false), /no applied patch declares/, 'the sabotage form missing from the list');
      assert.throws(() => verifyProduction(t.root, [{ name: LIFT_PATCH, file: sab.file }, sab], ring, false), /refusal lift is retired/);
      for (const n of PROTO_RETIRED) assert.throws(() => verifyProduction(t.root, [{ name: n, file: sab.file }, sab], ring, false), /retired prototype patch/);
      if (ring === 1) assert.throws(() => verifyProduction(t.root, [{ name: 'wrap-row-32', file: sab.file }], ring, false), /no ring-1 form/);
      else for (const n of ['strip-len-30-vertical', 'wrap-col-30']) assert.throws(() => verifyProduction(t.root, [{ name: n, file: sab.file }], ring, false), /no ring-2 form/);
    } finally { fs.rmSync(t.root, { recursive: true, force: true }); }
  }
});
test('every build check re-proves the tree, on both rings: loadTree and assertTreeForCell return the CURRENT proof, not the one cached at tree creation; a pristine tree has none', async () => {
  for (const ring of [1, 2]) {
    const cell = cellById(RING_CELL[ring]);
    const t = makeTree({ ring, lifted: false, extra: ['dest-plus08-vertical'] });
    try {
      const made = t.production;
      const checked = assertTreeForCell(t, cell, REP[ring].gameType);
      assert.deepEqual(checked, made);
      assert.notEqual(checked, made, 'a fresh proof object, computed from the files on disk now');
      assert.equal(t.production, checked, 'the tree keeps the latest check');
      assert.deepEqual((await loadTree(t)).proof, provenanceFor(ring, false, ['dest-plus08-vertical']).productionProof, 'loadTree returns the proof of ITS check, equal to the one computed from the patches alone');
      // the tree is edited AFTER it was made: the next check refuses, and the stale cached proof is not what a stamp would carry
      fs.appendFileSync(path.join(t.root, 'engine/streamworld.asm'), '\n; late edit\n');
      assert.throws(() => refreshProof(t), /plus its applied patches/);
      await assert.rejects(loadTree(t), /plus its applied patches/);
    } finally { fs.rmSync(t.root, { recursive: true, force: true }); }
  }
  const p = makeTree({ ring: false });
  try { assert.equal(refreshProof(p), null, 'the pristine tree has no production proof'); } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

// ---- C3 fix 1, finding 2 (now for BOTH rings): the certificate audit validates the tree provenance of every build / run stamp
test('SABOTAGE of the audit, on BOTH rings: a REAL build stamp with missing or contradictory tree provenance is refused (baseline, treeKind, patch names/order/hashes, the exact proof, the declared sabotage, a retired patch, the other ring\'s proof)', async () => {
  for (const ring of [1, 2]) {
    const cell = cellById(RING_CELL[ring]);
    const tree = makeTree({ ring, lifted: false });
    const dir = tmp();
    let built;
    try {
      const { project } = ringProject({ cell, gameType: REP[ring].gameType });
      built = await buildCell({ tree, project, cell, gameType: REP[ring].gameType, provDir: dir, label: 'real-stamp', links: { result: path.join(dir, 'r.json'), log: path.join(dir, 'l.log') } });
      const real = JSON.parse(fs.readFileSync(path.join(dir, 'real-stamp.json'), 'utf8'));
      assert.equal(real.status, 'built');
      assert.equal(real.treeKind, TREE_KIND[ring]);
      const prov = (s) => auditTreeProvenance(s, 'x.json');
      assert.deepEqual(prov(real), [], `the real ring-${ring} stamp passes`);
      assert.equal(auditStamp(real, 'x.json', () => true).filter((b) => /tree provenance/.test(b)).length, 0);
      const refuse = (mut, re, label, stamp = real) => {
        const s = structuredClone(stamp); mut(s);
        const direct = prov(s), via = auditStamp(s, 'x.json', () => true).filter((b) => /tree provenance/.test(b));
        assert.ok(direct.some((b) => re.test(b)), `ring ${ring} ${label}: direct ${direct.join('|') || '(accepted)'}`);
        assert.ok(via.some((b) => re.test(b)), `ring ${ring} ${label}: auditStamp ${via.join('|') || '(accepted)'}`);
      };
      const want = TREE_KIND[ring], other = TREE_KIND[3 - ring];
      refuse((s) => { s.treeKind = PROTOTYPE_TREE_KIND; s.productionProof = null; }, new RegExp(`treeKind .*needs ${want}`), 'prototype-horizontal with no proof');
      refuse((s) => { s.treeKind = PROTOTYPE_TREE_KIND; }, new RegExp(`treeKind .*needs ${want}`), 'prototype-horizontal WITH the proof (contradictory)');
      refuse((s) => { s.treeKind = other; }, new RegExp(`treeKind .*needs ${want}`), 'the other ring\'s production kind');
      refuse((s) => { delete s.treeKind; delete s.productionProof; }, /treeKind undefined|carries no exact production proof/, 'both fields omitted');
      refuse((s) => { s.baseline = 'wrong-baseline'; s.patches = []; }, /baseline "wrong-baseline"/, 'wrong baseline and no patches');
      refuse((s) => { s.baseline = PRE_C2_BASELINE; }, /certification baseline/, 'the pre-C2 baseline on a current stamp');
      refuse((s) => { s.patches = [{ name: LIFT_PATCH, sha256: RETIRED_PATCHES[LIFT_PATCH].sha256 }]; }, /carries 00-refusal-lift\.patch: the refusal lift is retired .*no stamp carries a lift/, 'the retired lift listed');
      refuse((s) => { s.patches = [{ name: 'dest-plus08-vertical', sha256: '0'.repeat(64) }]; s.sabotage = 'dest-plus08-vertical'; }, new RegExp(`is not the canonical ring-${ring} patch file's`), 'a patch hash that is not the canonical file\'s');
      for (const n of RETIRED) refuse((s) => { s.patches = [{ name: n, sha256: RETIRED_PATCHES[n].sha256 }]; }, new RegExp(`not a ring-${ring} sabotage form|canonical ring-${ring}`), `the retired ${n} listed`);
      refuse((s) => { s.patches.push({ name: 'dest-plus08-vertical', sha256: sha256(fs.readFileSync(patchFile('dest-plus08-vertical', ring))) }); }, /not exactly its declared sabotage/, 'an extra patch with no declared sabotage');
      refuse((s) => { s.sabotage = 'dest-plus08-vertical'; }, /not exactly its declared sabotage/, 'a declared sabotage with no patch');
      refuse((s) => { s.productionProof.expected['engine/streamworld.asm'] = '0'.repeat(40); }, /expected file contents are not BASELINE plus/, 'a proof whose expected content is altered');
      refuse((s) => { s.productionProof.exact = false; }, /carries no exact production proof/, 'a proof that is not marked exact');
      refuse((s) => { s.productionProof.ring = 3 - ring; }, new RegExp(`carries no exact production proof for ring ${ring}`), 'a proof made for the other ring');
      refuse((s) => { s.productionProof.changed = ['engine/streamworld.asm']; }, /changed files are not exactly/, 'a proof listing a changed file the patches do not declare');
      refuse((s) => { s.productionProof.patches = [{ name: 'dest-plus08-vertical', sha256: '0'.repeat(64) }]; }, /different patches than the stamp lists/, 'a proof made for other patches');
      refuse((s) => { s.productionVertical = s.productionProof; }, /legacy productionVertical/, 'the legacy field name');
      refuse((s) => { delete s.consumed; }, /carries none/, 'a stamp lacking consumed-input evidence');
      // the whole other ring's provenance on this ring's cell
      refuse((s) => { Object.assign(s, provenanceFor(3 - ring, false)); }, new RegExp(`needs ${want}|required set`), 'the other ring\'s whole provenance');
      assert.ok(prov({ ...real, cell: 'MMC1-X' }).some((b) => /no tree can be derived/.test(b)));
      if (ring === 2) {
        // a ring-2 cell RE-PATCHED INTO THE PROTOTYPE: the stamp such a tree would honestly produce (prototype kind, the three retired patches with their hashes, no proof, no evidence) is refused, with or without the historical option
        const proto = { ...real, treeKind: PROTOTYPE_TREE_KIND, patches: [...PROTO_RETIRED.map((n) => ({ name: n, sha256: RETIRED_PATCHES[n].sha256 }))], productionProof: null, consumed: null };
        const bad = prov(proto);
        for (const re of [/needs production-horizontal/, /not a ring-2 sabotage form/, /carries no exact production proof/]) assert.ok(bad.some((b) => re.test(b)), `${re}: ${bad.join('|')}`);
        assert.ok(auditStamp(proto, 'x.json', () => true, undefined, { historicalTree: true }).some((b) => /tree provenance/.test(b)), 'and the historical option does not admit it at the current baseline');
        // a SWAPPED CONSUMED FILE: the evidence names the prototype's bytes for a file the production ring ships
        for (const [section, key, re] of [['engine', 'player.asm', /engine\/player\.asm was consumed as git blob/], ['js', 'main/build/generate.js', /main\/build\/generate\.js was loaded as git blob/], ['js', 'shared/project.js', /shared\/project\.js was loaded as git blob/]]) {
          const protoFile = section === 'engine' ? `engine/${key}` : key;
          const swapped = blobSha1(prototypeFiles()[protoFile] ?? gitShow(`${PROTO_BASE}:${protoFile}`));
          assert.notEqual(swapped, real.consumed[section].files[key], `${protoFile}: the prototype's bytes differ from the shipped ones`);
          refuse((s) => { s.consumed[section].files[key] = swapped; }, re, `consumed ${protoFile} swapped for the prototype's`);
        }
      }
    } finally { if (built) fs.rmSync(built.dir, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(tree.root, { recursive: true, force: true }); }
  }
});
test('the audit handles ring-0 comparisons and declared sabotage controls explicitly (both rings are production trees)', () => {
  const prov = (s) => auditTreeProvenance(s, 'x.json');
  // declared sabotage controls: exactly the declared patch, in its ring's form
  for (const ring of [1, 2]) {
    const cell = RING_CELL[ring];
    const sab = { kind: 'cell-build', cell, gameType: REP[ring].gameType, sabotage: 'dest-plus08-vertical', ...provenanceFor(ring, false, ['dest-plus08-vertical']) };
    assert.deepEqual(prov(sab), [], `ring ${ring}`);
    assert.ok(prov({ ...sab, sabotage: 'no-walk-v' }).some((b) => /not exactly its declared sabotage/.test(b)), 'a different sabotage declared');
    assert.ok(prov({ ...sab, sabotage: null }).some((b) => /not exactly its declared sabotage/.test(b)));
    const wrongForm = { ...sab, sabotage: 'render-four-nts', patches: [...sab.patches.slice(0, 1), { name: 'render-four-nts', sha256: sha256(fs.readFileSync(patchFile('render-four-nts', 3 - ring))) }] };
    assert.ok(prov(wrongForm).some((b) => new RegExp(`canonical ring-${ring} patch file`).test(b)), `the ring-${3 - ring} form of a sabotage on a ring-${ring} cell`);
    assert.ok(prov({ ...sab, kind: 's1b-witness' }).length === 0, 'an s1b witness declares its sabotage the same way');
    // an s1c control declares its sabotage through its control id
    const ctl = { kind: 's1c-run', cell, gameType: REP[ring].gameType, control: 'nmi-dest-plus08-vertical', ...provenanceFor(ring, false, ['dest-plus08-vertical']) };
    assert.deepEqual(prov(ctl), []);
    assert.ok(prov({ ...ctl, control: null }).some((b) => /not exactly its declared sabotage/.test(b)));
    assert.ok(prov({ ...ctl, control: 'no-such-control' }).some((b) => /not a declared S1c control/.test(b)));
    assert.deepEqual(prov({ kind: 's1c-run', cell, gameType: REP[ring].gameType, ...provenanceFor(ring, false) }), [], 'an s1c positive');
  }
  const hsab = { kind: 'cell-build', cell: 'MMC3-H', gameType: 'action', sabotage: 'wrap-row-32', ...provenanceFor(2, false, ['wrap-row-32']) }; // an MMC3 action cell: production admits it, so no lift
  assert.deepEqual(prov(hsab), [], 'wrap-row-32 exists only for ring 2');
  assert.ok(prov({ ...hsab, cell: 'MMC3-V' }).length > 0, 'and a ring-1 cell cannot carry it');
  // ring 0: the pristine side has no patches and no tree; the patched side is a ring-2 production build; the six-fixture comparison names that tree
  const p2 = provenanceFor(2, false);
  const ring0 = (tree, patches) => (tree === 'patched' ? { kind: 'ring0-build', tree, ...p2, patches } : { kind: 'ring0-build', tree, baseline: BASELINE, patches });
  assert.deepEqual(prov(ring0('pristine', [])), []);
  assert.deepEqual(prov(ring0('patched', p2.patches)), []);
  assert.ok(prov(ring0('pristine', provenanceFor(2, false, ['dest-plus08-vertical']).patches)).some((b) => /declared sabotage/.test(b)), 'a pristine side that carries patches');
  assert.ok(prov({ ...ring0('pristine', []), treeKind: 'production-horizontal' }).some((b) => /pristine ring-0 stamp carries treeKind/.test(b)), 'a pristine side with a tree kind');
  assert.ok(prov({ ...ring0('pristine', []), productionProof: p2.productionProof }).some((b) => /pristine ring-0 stamp carries a production proof/.test(b)));
  const LIFT_LISTED = [{ name: LIFT_PATCH, sha256: RETIRED_PATCHES[LIFT_PATCH].sha256 }];
  assert.ok(prov(ring0('patched', LIFT_LISTED)).some((b) => /no stamp carries a lift/.test(b)), 'a patched side that lists the retired lift');
  assert.ok(prov({ ...ring0('patched', p2.patches), baseline: 'old' }).some((b) => /certification baseline/.test(b)));
  assert.ok(prov({ ...ring0('patched', p2.patches), treeKind: 'production-vertical' }).some((b) => /needs production-horizontal/.test(b)));
  assert.ok(prov({ ...ring0('patched', p2.patches), treeKind: PROTOTYPE_TREE_KIND }).some((b) => /needs production-horizontal/.test(b)));
  assert.ok(prov({ ...ring0('patched', p2.patches), consumed: undefined }).some((b) => /carries none/.test(b)), 'the patched ring-0 build must carry its consumed evidence');
  assert.ok(prov({ ...ring0('elsewhere', []) }).some((b) => /no tree can be derived/.test(b)));
  const { consumed: _omit, ...p2NoEvidence } = p2;
  const cmp = { kind: 'ring0-identity-comparison', ...p2NoEvidence };
  assert.deepEqual(prov(cmp), []);
  assert.ok(prov({ ...cmp, consumed: p2.consumed }).some((b) => /comparison builds nothing/.test(b)), 'a comparison cannot claim consumed evidence');
  assert.ok(prov({ ...cmp, patches: LIFT_LISTED }).some((b) => /no stamp carries a lift/.test(b)), 'a comparison that lists the retired lift');
  assert.ok(prov({ ...cmp, treeKind: PROTOTYPE_TREE_KIND }).some((b) => /needs production-horizontal/.test(b)), 'a comparison against the prototype');
  assert.ok(prov({ ...cmp, baseline: '5138c1f' }).some((b) => /certification baseline/.test(b)), 'a comparison against the pre-C2 baseline');
  // and auditStamp runs it on the comparison and on an errored build stamp
  assert.ok(auditStamp({ schema: 'ring-prov-3', ...cmp, patches: LIFT_LISTED, status: 'built' }, 'c.json', () => true).some((b) => /tree provenance/.test(b)));
  assert.ok(auditStamp({ schema: 'ring-prov-3', kind: 'cell-build', cell: 'MMC1-V', status: 'error', head: 'h', baseline: 'wrong-baseline', patches: [] }, 'e.json', () => true).some((b) => /tree provenance/.test(b)), 'an errored attempt is audited too');
});

// ---- C3 fix 1, finding 3: the refusal block's end delimiter must match exactly once in its search region
test('regen_patches locateBlock: the end anchor must be unique after the start; an ambiguous, missing or ambiguous-start anchor fails', () => {
  const S = '<<start>>', E = '<<end>>';
  assert.deepEqual(locateBlock(`pre ${S} mid ${E} post`, S, E, 'blk'), { a: 4, b: 4 + S.length + 5 });
  assert.throws(() => locateBlock(`pre ${S} mid ${E} more ${E} post`, S, E, 'blk'), /blk: end anchor found 2 times after the start, expected exactly 1/);
  assert.throws(() => locateBlock(`pre ${S} mid post`, S, E, 'blk'), /end anchor found 0 times/);
  assert.throws(() => locateBlock(`${S} a ${S} b ${E}`, S, E, 'blk'), /start anchor found 2 times/);
  assert.throws(() => locateBlock(`${E} before ${S} mid`, S, E, 'blk'), /end anchor found 0 times/, 'an end anchor BEFORE the start is not in the search region');
  assert.deepEqual(locateBlock(`${E} before ${S} mid ${E}`, S, E, 'blk').b, `${E} before ${S} mid `.length, 'only the occurrence after the start counts');
});

// ---- C3 fix 2, finding 1: a vertical build is bound to the bytes it CONSUMED, not to a check of the mutable tree before and after it ----------------------------------------------
// The reviewer's repro: a source that is edited only while the generator copies it (and restored right after) passes the check before the build and the check after it.
const SCENE = { gt: REP[1].gameType, sizes: [2, 2, 2, 2, 2, 2, 2, 2], wide: true, ring: { mapper: cellById(REP[1].id).mapper, mirroring: cellById(REP[1].id).mirroring, ring: 1, n: 4, bulk: 0 } };
/** Runs `body` with fs/promises.copyFile hooked: while the generator copies the tree's engine/streamworld.asm, the row length operand is replaced by #32 (an undeclared edit); the source is restored right after the copy. Returns the number of edited copies. */
async function withSourceRestoredDuringCopy(tree, body) {
  const source = path.join(tree.root, 'engine/streamworld.asm');
  const original = fs.readFileSync(source);
  const copy = fsp.copyFile;
  let edits = 0;
  fsp.copyFile = async function hookedCopyFile(src, dest, ...rest) {
    if (String(src) !== source) return copy.call(this, src, dest, ...rest);
    fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replaceAll('#SW_RING_ROW_LEN', '#32'));
    edits++;
    try { return await copy.call(this, src, dest, ...rest); } finally { fs.writeFileSync(source, original); }
  };
  try { await body(); } finally { fsp.copyFile = copy; }
  assert.ok(fs.readFileSync(source).equals(original), 'the source is restored after the copy');
  return edits;
}
test('SABOTAGE of the consumed-input guard: the reviewer\'s restored-during-copy repro is REFUSED in buildCell, in a scene build (the S1b/S1c path) and when the copy bypasses the guard', async () => {
  const cell = cellById(REP[1].id);
  const { project } = ringProject({ cell, gameType: REP[1].gameType });
  // (1) buildCell, on BOTH rings: both tree checks (before and after) pass -- the check-time proof is exactly what the repro defeated -- and the BUILD is refused anyway
  for (const ring of [1, 2]) {
  const rcell = cellById(RING_CELL[ring]);
  const rproject = ringProject({ cell: rcell, gameType: REP[ring].gameType }).project;
  const t = makeTree({ ring, lifted: false, extra: ['dest-plus08-vertical'] });
  const dir = tmp();
  try {
    let before, after;
    const edits = await withSourceRestoredDuringCopy(t, async () => {
      before = refreshProof(t);
      await assert.rejects(buildCell({ tree: t, project: rproject, cell: rcell, gameType: REP[ring].gameType, sabotage: 'dest-plus08-vertical', provDir: dir, label: 'restored-during-copy' }), /consumed-input guard: the build read engine\/streamworld\.asm as git blob .* the source changed while the build consumed it/);
      after = refreshProof(t);
    });
    assert.equal(edits, 1, 'the hook edited the one copy');
    assert.equal(before.exact && after.exact, true, 'both mutable-tree checks pass: only the consumed-input guard can catch this');
    const [stampName] = fs.readdirSync(dir);
    const stamp = JSON.parse(fs.readFileSync(path.join(dir, stampName), 'utf8'));
    assert.equal(stamp.status, 'error', 'the refused build leaves an error stamp, never a built one');
    assert.equal(stamp.consumed.engine.builds, 0, 'no build was verified');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(t.root, { recursive: true, force: true }); }
  }
  // (2) a scene build from a vertical tree (what run_s1b.mjs / run_s1c.mjs do through runManifest and measureMove): the same hook, the same refusal
  const s = makeTree({ ring: 1, lifted: false, extra: ['dest-plus08-vertical'] });
  const out = tmp();
  try {
    const edits = await withSourceRestoredDuringCopy(s, async () => {
      refreshProof(s);
      await assert.rejects(buildScene({ root: s.root, ...SCENE, outDir: out }), /consumed-input guard: the build read engine\/streamworld\.asm/);
      assert.equal(refreshProof(s).exact, true);
    });
    assert.equal(edits, 1);
    assert.throws(() => consumedEvidence(s, { min: 1 }), /consumed-input guard: the build in .* copied \[/, 'the refused build leaves a partial copy: the tree can no longer produce evidence to stamp');
  } finally { fs.rmSync(out, { recursive: true, force: true }); fs.rmSync(s.root, { recursive: true, force: true }); }
  // (3) a copy that does not go through the guarded copyFile leaves no consumed-input evidence: the build is refused for it
  const u = makeTree({ ring: 1, lifted: false });
  let udir = null;
  try {
    const copy = fsp.copyFile;
    fsp.copyFile = async (src, dest) => fsp.writeFile(dest, await fsp.readFile(src)); // an un-guarded copy
    try { await assert.rejects(buildCell({ tree: u, project, cell, gameType: REP[1].gameType, label: 'unguarded-copy' }), /no verified engine copy/); } finally { fsp.copyFile = copy; }
  } finally { fs.rmSync(u.root, { recursive: true, force: true }); }
});
test('the consumed-input guard also binds a PERSISTENT edit seen only by a scene build, the loaded JS and a harness override; a clean scene build leaves evidence that the audit accepts', async () => {
  const out = tmp();
  // a persistent engine edit: no loadTree runs on the scene path, so only the copy-time guard stands between the edit and the ROM
  const a = makeTree({ ring: 1, lifted: false });
  try {
    fs.appendFileSync(path.join(a.root, 'engine/text.asm'), '\n; an undeclared edit\n');
    await assert.rejects(buildScene({ root: a.root, ...SCENE, outDir: out }), /consumed-input guard: the build read engine\/text\.asm/);
  } finally { fs.rmSync(a.root, { recursive: true, force: true }); }
  // a persistent edit of a module the build imports: the loader's source is hashed, so the module never loads
  const b = makeTree({ ring: 1, lifted: false });
  try {
    fs.appendFileSync(path.join(b.root, 'main/build/streamplacement.js'), '\n// an undeclared edit\n');
    await assert.rejects(buildScene({ root: b.root, ...SCENE, outDir: out }), /consumed-input guard: the loader read main\/build\/streamplacement\.js as git blob/);
  } finally { fs.rmSync(b.root, { recursive: true, force: true }); }
  // an override the harness derives from a tree file is read through the same verification
  const c = makeTree({ ring: 1, lifted: false });
  try {
    assert.match(readTreeText(c, 'engine/text.asm'), /vram_drain_byte/);
    fs.appendFileSync(path.join(c.root, 'engine/text.asm'), '\n; an undeclared edit\n');
    assert.throws(() => readTreeText(c, 'engine/text.asm'), /read for a harness override is not/);
  } finally { fs.rmSync(c.root, { recursive: true, force: true }); }
  // the clean build: evidence is the engine set and the loaded modules, and it is what the audit expects
  const d = makeTree({ ring: 1, lifted: false });
  try {
    await buildScene({ root: d.root, ...SCENE, outDir: out });
    const ev = consumedEvidence(d);
    assert.equal(ev.engine.builds, 1);
    assert.equal(Object.keys(ev.engine.files).length, 26);
    assert.ok(['main/build/generate.js', 'main/build/pipeline.js', 'shared/project.js'].every((m) => m in ev.js.files));
    assert.deepEqual(auditTreeProvenance({ kind: 's1b-witness', cell: REP[1].id, gameType: REP[1].gameType, status: 'built', sabotage: null, baseline: BASELINE, ...provenanceFor(1, false), consumed: ev }, 's1b.json'), []);
  } finally { fs.rmSync(d.root, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); }
});
test('SABOTAGE of the audit, on BOTH rings: a real build stamp with missing, wrong or incomplete consumed-input evidence is refused (and an errored attempt may be partial but never wrong)', async () => {
  for (const ring of [1, 2]) {
    const cell = cellById(RING_CELL[ring]);
    const tree = makeTree({ ring, lifted: false, extra: ['render-four-nts'] });
    const { project } = ringProject({ cell, gameType: REP[ring].gameType });
    let built;
    try {
      built = await buildCell({ tree, project, cell, gameType: REP[ring].gameType, sabotage: 'render-four-nts', label: 'unit-consumed' });
      const stamp = { kind: 'cell-build', status: 'built', ...built.prov, sabotage: 'render-four-nts' };
      const prov = (o) => auditTreeProvenance({ ...stamp, ...o }, 'c.json');
      const clone = () => structuredClone(stamp.consumed);
      assert.deepEqual(prov({}), [], 'the real stamp is clean');
      assert.equal(stamp.consumed.engine.builds, 1);
      const baseGen = execFileSync('git', ['rev-parse', `${BASELINE}:main/build/generate.js`], { cwd: REPO, encoding: 'utf8' }).trim();
      assert.ok(stamp.consumed.js.files['main/build/generate.js'], 'the sabotage targets the generator: its loaded blob is recorded');
      assert.notEqual(stamp.consumed.js.files['main/build/generate.js'], baseGen, 'and it is the PATCHED blob, not the baseline one');
      const refused = (o, re, why) => assert.ok(prov(o).some((b) => re.test(b)), `ring ${ring} ${why}: ${prov(o).join(' | ') || 'accepted'}`);
      refused({ consumed: undefined }, /carries none/, 'no evidence');
      refused({ consumed: null }, /carries none/, 'null evidence');
      let c = clone(); c.engine.files['streamworld.asm'] = '0'.repeat(40);
      refused({ consumed: c }, /engine\/streamworld\.asm was consumed as git blob 000000000000/, 'a wrong engine blob');
      c = clone(); delete c.engine.files['text.asm'];
      refused({ consumed: c }, /not exactly the engine set/, 'an engine file missing');
      c = clone(); c.engine.files['extra.asm'] = '1'.repeat(40);
      refused({ consumed: c }, /extra\.asm|not exactly the engine set/, 'an engine file nobody ships');
      c = clone(); c.js.files['main/build/generate.js'] = baseGen;
      refused({ consumed: c }, /main\/build\/generate\.js was loaded as git blob/, 'the unpatched generator for a stamp that declares the render-four-nts sabotage');
      c = clone(); delete c.js.files['main/build/pipeline.js'];
      refused({ consumed: c }, /main\/build\/pipeline\.js is not among the loaded modules/, 'a required module missing');
      c = clone(); c.engine.builds = 0;
      refused({ consumed: c }, /no verified build/, 'no build');
      c = clone(); c.mechanism = 'checked-the-tree';
      refused({ consumed: c }, /mechanism/, 'another mechanism');
      c = clone(); c.refused = 'x';
      refused({ consumed: c }, /the guard refused a build/, 'a refusal on a finished stamp');
      c = clone(); c.engine.files = null;
      refused({ consumed: c }, /no engine \/ js file maps/, 'no maps');
      // an errored attempt: partial evidence is fine, a wrong entry or no evidence at all is not
      const err = { ...stamp, status: 'error' };
      const partial = { mechanism: stamp.consumed.mechanism, baseline: BASELINE, engine: { builds: 0, files: { 'text.asm': stamp.consumed.engine.files['text.asm'] } }, js: { files: {} } };
      assert.deepEqual(auditTreeProvenance({ ...err, consumed: partial }, 'e.json'), []);
      assert.ok(auditTreeProvenance({ ...err, consumed: { ...partial, engine: { builds: 0, files: { 'text.asm': '2'.repeat(40) } } } }, 'e.json').some((b) => /engine\/text\.asm was consumed as git blob/.test(b)));
      assert.ok(auditTreeProvenance({ ...err, consumed: undefined }, 'e.json').some((b) => /carries none/.test(b)));
    } finally { if (built) fs.rmSync(built.dir, { recursive: true, force: true }); fs.rmSync(tree.root, { recursive: true, force: true }); }
  }
});
test('a patch file is read ONCE per use and git applies those bytes from stdin: the bytes hashed are the bytes parsed and applied (no path is reopened after it was hashed)', () => {
  const sab = patchFile('dest-plus08-vertical', 1);
  const reads = new Map();
  const real = fs.readFileSync, realExec = childProcess.execFileSync;
  const applies = [];
  fs.readFileSync = function spy(p, ...rest) { if (typeof p === 'string' && p === sab) reads.set(p, (reads.get(p) ?? 0) + 1); return real.call(this, p, ...rest); };
  childProcess.execFileSync = function spyExec(cmd, args, opts, ...rest) { if (cmd === 'git' && args?.[0] === 'apply') applies.push({ args, input: opts?.input }); return realExec.call(this, cmd, args, opts, ...rest); };
  syncBuiltinESMExports();
  let t;
  try {
    resetExpectedCache();
    t = makeTree({ ring: 1, lifted: false, extra: ['dest-plus08-vertical'] });
    assert.equal(reads.get(sab), 2, 'makeTree reads a patch twice: once to hash AND apply the same bytes, once for the exact-content proof it then runs');
    reads.clear();
    expectedContent(t.applied, 1, false);
    assert.equal(reads.get(sab), 1, 'the expected-content derivation reads each canonical patch once (hash, parse, apply)');
    reads.clear();
    verifyProduction(t.root, t.applied, 1, false);
    assert.equal(reads.get(sab), 1, 'and so does the proof');
    // every `git apply` (the tree's own and the expected-content derivation's) takes the patch on stdin from the captured bytes: no patch PATH is handed to git
    assert.ok(applies.length >= 2, `${applies.length} git apply calls observed`);
    for (const { args, input } of applies) {
      assert.equal(args.at(-1), '-', `git apply reads stdin: ${args.join(' ')}`);
      assert.ok(Buffer.isBuffer(input) && input.length > 0, 'and is given the captured bytes');
      assert.ok(!args.some((a) => String(a).startsWith(PATCH_DIR)), 'no patch path');
    }
    assert.ok(applies.every(({ input }) => input.equals(real.call(fs, sab))), 'the bytes applied are the patch file\'s bytes');
  } finally { fs.readFileSync = real; childProcess.execFileSync = realExec; syncBuiltinESMExports(); if (t) fs.rmSync(t.root, { recursive: true, force: true }); }
});

// ---- C3 fix 2, finding 2: the historical waiver is for the pre-C2 S1b certificate and nothing else -----------------------------------------------------------------------------
test('SABOTAGE of the historical waiver: a current-baseline stamp given { historicalTree: true } is still fully audited and refused when wrong (the reviewer\'s repro), a pre-C2 stamp of a kind the old certificate lacks is not waived, and the real pre-C2 kinds are', () => {
  const cur = { schema: 'ring-prov-3', kind: 'cell-build', cell: 'MMC1-V', status: 'error', head: 'h', baseline: BASELINE, patches: [], treeKind: 'prototype-horizontal', productionVertical: null, attempt: { startedAt: 'x' }, error: { firstLine: 'x' } };
  const audit = (st, opts) => auditStamp(st, 's.json', () => true, undefined, opts);
  assert.ok(audit(cur).some((b) => /tree provenance/.test(b)), 'the wrong current stamp is refused without the option');
  assert.ok(audit(cur, { historicalTree: true }).some((b) => /tree provenance/.test(b)), 'and WITH it: the waiver does not apply to a current-baseline stamp');
  assert.equal(isHistoricalStamp(cur), false);
  // the same wrong stamp with the pre-C2 baseline and a kind the old certificate contains IS the historical case
  const old = { ...cur, baseline: PRE_C2_BASELINE };
  assert.equal(isHistoricalStamp(old), true);
  assert.ok(!audit(old, { historicalTree: true }).some((b) => /tree provenance/.test(b)), 'a pre-C2 stamp is waived');
  assert.ok(audit(old).some((b) => /tree provenance/.test(b)), 'and refused without the option');
  // the waiver is per kind: an s1c-run (S1c did not exist in the old certificate) or an unknown kind with the pre-C2 baseline is audited in full
  for (const kind of ['s1c-run', 'cell-build-x', 'oracle']) assert.ok(audit({ ...old, kind }, { historicalTree: true }).some((b) => /tree provenance/.test(b)), `kind ${kind}`);
  for (const kind of ['cell-build', 'ring0-build', 'ring0-identity-comparison', 's1b-witness']) assert.equal(isHistoricalStamp({ baseline: PRE_C2_BASELINE, kind }), true, kind);
  // a short or different hash is not the baseline either
  assert.equal(isHistoricalStamp({ ...old, baseline: '5138c1f' }), false);
  // S3 C2: the waiver admits NO new kind and no new baseline. The list is exactly the four kinds of the pre-C2 certificate, and a ring-2 prototype stamp is waived only under PRE_C2_BASELINE
  assert.deepEqual([...HISTORICAL_KINDS].sort(), ['cell-build', 'ring0-build', 'ring0-identity-comparison', 's1b-witness']);
  assert.notEqual(BASELINE, PRE_C2_BASELINE);
  for (const baseline of [BASELINE, 'cd7a9f8', 'cd7a9f8' + '0'.repeat(33)]) assert.equal(isHistoricalStamp({ ...old, baseline }), false, baseline);
  const proto2 = { ...old, cell: 'MMC3-H' };
  assert.ok(!audit(proto2, { historicalTree: true }).some((b) => /tree provenance/.test(b)), 'the pre-C2 prototype-horizontal stamp is waived under its own baseline');
  const cur2 = { ...proto2, baseline: BASELINE };
  assert.ok(audit(cur2, { historicalTree: true }).some((b) => /tree provenance.*needs production-horizontal/.test(b)), 'the same stamp at the current baseline is refused even with the option');
  assert.deepEqual(auditTreeProvenance({ kind: 'cell-build', cell: 'MMC3-H', gameType: 'action', sabotage: null, ...provenanceFor(2, false) }, 'x.json'), [], 'and a genuine production-horizontal stamp passes without needing the waiver');
});
test('s1b_rejudge refuses a provenance directory holding a current-baseline stamp (the reviewer\'s repro) before it writes anything, and does not refuse a pre-C2 one for being current', () => {
  const run = (baseline, kind = 'cell-build') => {
    const dir = tmp();
    try {
      fs.mkdirSync(path.join(dir, 'logs')); fs.mkdirSync(path.join(dir, 'prov'));
      fs.writeFileSync(path.join(dir, 'prov', 'MMC1-V-action-resident-enter-lap.json'), JSON.stringify({ schema: 'ring-prov-3', kind, cell: 'MMC1-V', baseline, treeKind: 'prototype-horizontal', productionVertical: null }));
      const r = spawnSync(process.execPath, [path.join(HERE, 's1b_rejudge.mjs'), path.join(dir, 'logs'), path.join(dir, 'prov'), path.join(dir, 'out')], { encoding: 'utf8' });
      return { r, outExists: fs.existsSync(path.join(dir, 'out')) };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  const current = run(BASELINE);
  assert.equal(current.r.status, 2, current.r.stdout + current.r.stderr);
  assert.match(current.r.stderr, /not the pre-C2 S1b certificate/);
  assert.equal(current.outExists, false, 'nothing is written for a refused directory');
  assert.equal(run(PRE_C2_BASELINE, 's1c-run').r.status, 2, 'a kind the old certificate lacks is refused too');
  const historical = run(PRE_C2_BASELINE);
  assert.doesNotMatch(historical.r.stderr, /not the pre-C2 S1b certificate/, 'a pre-C2 cell-build stamp passes the preflight (it then fails on its own missing links, not on being current)');
  assert.equal(historical.outExists, true);
});

// ======================================================================================================================================================================
// S5 commit C3: the refusal lift is RETIRED. Until S5 C2 production refused a streamed RPG on a two-nametable board and the gate patched that one arm out (00-refusal-lift.patch) for the RPG cells; since the datum
// `streamRingGameTypes: ['action', 'rpg']` all 18 cells are admitted, so every ring tree is BASELINE itself (plus a control's own sabotage form) and `liftNeeded` survives only as a guard that must say false. The tests below
// pin that against a table written independently of it AND against production's own behaviour, show that nothing can build, apply or stamp a lift any more, and keep the audit's refusal of a lift a positive, named failure.
// ======================================================================================================================================================================
/** Written down independently of liftNeeded. */
const ALL_CELLS = ['MMC1-V', 'MMC1-H', 'MMC3-V', 'MMC3-H', 'U512-V', 'U512-H'];
const LIFT_LISTED = [{ name: LIFT_PATCH, sha256: RETIRED_PATCHES[LIFT_PATCH].sha256 }];
test('liftNeeded is false for all twelve cell x game-type pairs, by the independent table AND by production\'s own behaviour (BASELINE\'s validateProject admits every one), and ringtree.mjs holds no board list of its own', async () => {
  assert.deepEqual(CELLS.map((c) => c.id).sort(), [...ALL_CELLS].sort());
  for (const id of ALL_CELLS) for (const gt of ['action', 'rpg']) assert.equal(liftNeeded(cellById(id), gt), false, `${id} ${gt}`);
  assert.equal(checkNoLiftNeeded(), 12);
  assert.throws(() => liftNeeded(cellById('MMC3-V')), /gameType must be one of/);
  assert.throws(() => liftNeeded(cellById('MMC3-V'), 'puzzle'), /gameType must be one of/);
  // no second board list: the function body holds no mapper / cell literal, it asks production
  const src = fs.readFileSync(path.join(HERE, 'ringtree.mjs'), 'utf8');
  const body = src.slice(src.indexOf('export function liftNeeded'), src.indexOf('/** Every ring cell x game type is admitted'));
  assert.ok(body.includes('streamRingAdmitted(') && !/MMC[0-9]|U512|mapper\s*===?|mapper\s*!==?|\b(?:4|30)\b/.test(body.replace(/\/\/.*$/gm, '')), 'liftNeeded asks streamRingAdmitted and names no board');
  // production's behaviour: BASELINE (the one tree there is) refuses none of the twelve
  const u = makeTree({ ring: 1, lifted: false });
  try {
    const shared = (await loadTree(u)).shared;
    for (const id of ALL_CELLS) for (const gt of ['action', 'rpg']) {
      const { project } = ringProject({ cell: cellById(id), gameType: gt, n: 4 });
      assert.deepEqual(shared.streamedBoardProblems(project), [], `${id} ${gt}: BASELINE's own validation admits it`);
    }
  } finally { fs.rmSync(u.root, { recursive: true, force: true }); }
});
test('no second list of admitted boards in the lift path: the tree maker and the stamp audit hold no cell id literal and no mapper-number comparison, and the guard reaches them only through liftNeeded', () => {
  const code = (f) => fs.readFileSync(path.join(HERE, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
  for (const f of ['ringtree.mjs', 'ringprovindex.mjs']) {
    const text = code(f);
    assert.deepEqual(text.match(/['"`](?:MMC[0-9]|U512)-[VH]\b/g) ?? [], [], `${f} names a cell id`);
    assert.deepEqual(text.match(/\.mapper\s*[=!]==?\s*\d+|mapper\s*[=!]==?\s*\d+|\bresolveMapper\(\s*\d+/g) ?? [], [], `${f} compares a mapper number`);
    assert.ok(/\bliftNeeded\(/.test(text) || /refuses\s*=\s*liftNeeded/.test(text), `${f} asks liftNeeded`);
  }
});
test('S5 C3: the refusal lift is RETIRED -- the file is gone, its S4c C2 hash is recorded, nothing can name, apply, build or stamp it, and production ships the datum that made it unnecessary', () => {
  assert.ok(!fs.existsSync(path.join(PATCH_DIR, LIFT_PATCH)), 'the file is gone');
  assert.equal(RETIRED_PATCHES[LIFT_PATCH].sha256, sha256(gitShow(`61ed7f3:test/lua/ring_gate/${LIFT_PATCH}`)), 'the recorded hash is the S4c C2 re-cut\'s (git 61ed7f3)');
  assert.ok(RETIRED_PATCHES[LIFT_PATCH].reason.length > 20, 'a retirement records its reason');
  const set = makeTreeSet();
  try {
    for (const ring of [1, 2]) {
      assert.throws(() => patchFile(LIFT_PATCH, ring), /is retired/);
      assert.throws(() => makeTree({ ring, lifted: false, extra: [LIFT_PATCH] }), /is retired/);
      assert.throws(() => makeTree({ ring, lifted: true }), /refusal lift .* is retired at S5 C3/);
      assert.throws(() => provenanceFor(ring, true), /is retired at S5 C3/);
      assert.throws(() => expectedContent([], ring, true), /is retired at S5 C3/);
      assert.throws(() => verifyProduction('/nonexistent', [], ring, true), /is retired at S5 C3/);
      assert.throws(() => expectedContent([{ name: LIFT_PATCH, file: '/x' }], ring, false), /carries 00-refusal-lift\.patch: the refusal lift is retired/);
      assert.throws(() => set.forRing(ring, true), /is retired at S5 C3/);
    }
  } finally { set.dispose(); }
  assert.throws(() => patchSetFor(true), /is retired at S5 C3/);
  // the datum that made it unnecessary: three boards, each admitting both game types, in BASELINE's own cartridge.js
  const cart = gitShow(`${BASELINE}:shared/cartridge.js`).toString('utf8');
  assert.equal((cart.match(/streamRingGameTypes: \['action', 'rpg'\],/g) ?? []).length, 3);
  assert.ok(checkRetiredShipped() >= 9, 'and checkRetiredShipped proves it (with the prototype patches\' needles)');
});
test('a ring tree is BASELINE byte for byte in engine/ main/ shared/ (both rings); a sabotage form changes exactly the files it declares', () => {
  for (const ring of [1, 2]) {
    const t = makeTree({ ring, lifted: false });
    try {
      assert.equal(t.kind, TREE_KIND[ring]);
      assert.equal(t.lifted, false);
      assert.deepEqual(t.patches, []);
      assert.deepEqual(filesDifferingFromBaseline(t.root), [], `ring ${ring}: a tree equals ${BASELINE} byte for byte`);
      assert.deepEqual([t.production.declared, t.production.changed, t.production.expected, t.production.lifted, t.production.exact], [[], [], {}, false, true]);
      assert.ok(t.production.forksChecked > 0 && t.production.unmodifiedShippedFiles.length > 0, 'it still proves the shipped forks are in BASELINE and unmodified');
      assert.doesNotThrow(() => verifyProduction(t.root, t.applied, ring, false));
      assert.deepEqual(t.production, provenanceFor(ring, false).productionProof, 'the proof computed from the (empty) patch set alone');
    } finally { fs.rmSync(t.root, { recursive: true, force: true }); }
    for (const n of Object.keys(IDENTITY_OUTCOME)) {
      if (!sabotageRings(n).includes(ring)) continue;
      const s = makeTree({ ring, lifted: false, extra: [n] });
      try {
        const sab = patchedFiles(fs.readFileSync(patchFile(n, ring), 'utf8'));
        assert.ok(sab.length > 0, `${n} (ring ${ring}) declares files`);
        assert.deepEqual(filesDifferingFromBaseline(s.root), [...sab].sort(), `${n} (ring ${ring}): changes exactly the files it declares`);
        assert.deepEqual(s.patches.map((p) => p.name), [n]);
        assert.deepEqual(Object.keys(provenanceFor(ring, false, [n]).productionProof.expected).sort(), [...sab].sort());
      } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
    }
  }
  assert.throws(() => makeTree({ ring: 1 }), /never defaulted/);
  assert.throws(() => makeTree({ ring: 2, lifted: 'yes' }), /never defaulted/);
  assert.throws(() => makeTree({ ring: false, lifted: false }), /pristine tree has no lift/);
  assert.throws(() => provenanceFor(1, undefined), /never defaulted/);
});
test('SABOTAGE of the exact-content proof on the tree: a hand edit of a file no patch declares, the RETIRED lift applied by hand, the lift claimed in the patch list, and a lifted claim are all refused', async () => {
  const liftBytes = gitShow(`61ed7f3:test/lua/ring_gate/${LIFT_PATCH}`);
  for (const ring of [1, 2]) {
    const u = makeTree({ ring, lifted: false });
    try {
      // a one-byte edit of shared/project.js
      fs.appendFileSync(path.join(u.root, 'shared/project.js'), '\n// edit\n');
      assert.throws(() => verifyProduction(u.root, u.applied, ring, false), /differs from .* in files no applied patch declares .*: shared\/project\.js/);
      for (const id of ALL_CELLS.filter((x) => cellById(x).ring === ring)) for (const gt of ['action', 'rpg']) assert.throws(() => assertTreeForCell(u, cellById(id), gt), /differs from/, `${id} ${gt}`);
      await assert.rejects(loadTree(u), /differs from/);
      // the retired lift applied to the tree by hand, the tree still claiming to be BASELINE
      // (the S4c C2 file's hunk no longer applies to this baseline -- C2 moved its context -- so the same deletion is made by text: the old lift's own start and end marks, each unique)
      const baseProject = gitShow(`${BASELINE}:shared/project.js`).toString('utf8');
      const arm = locateBlock(baseProject, "      } else if (!streamRingAdmitted(mapper, mirroringId, gameType)) {\n        add(\n          'ringGame',", '      }\n    }\n    for (const problem of gridProblems)', 'project.js ringGame arm');
      fs.writeFileSync(path.join(u.root, 'shared/project.js'), baseProject.slice(0, arm.a) + baseProject.slice(arm.b));
      assert.ok(liftBytes.toString('utf8').includes("-          'ringGame',"), 'the retired file is the one that deleted that arm');
      assert.throws(() => verifyProduction(u.root, u.applied, ring, false), /differs from .* in files no applied patch declares .*: shared\/project\.js/);
      // claiming the lift in the patch list, and claiming the tree is lifted
      assert.throws(() => verifyProduction(u.root, [{ name: LIFT_PATCH, file: path.join(PATCH_DIR, LIFT_PATCH) }], ring, false), /refusal lift is retired/);
      assert.throws(() => verifyProduction(u.root, [], ring, true), /is retired at S5 C3/);
    } finally { fs.rmSync(u.root, { recursive: true, force: true }); }
  }
});
test('a cell is built only through its (one) form: every cell x game type gets the unlifted tree of its own ring; a forged lifted tree is refused; the tree set and makeCellTree refuse a cell production would refuse', () => {
  const set = makeTreeSet();
  try {
    for (const id of ALL_CELLS) for (const gt of ['action', 'rpg']) {
      const cell = cellById(id);
      const right = set.forCell(cell, gt);
      assert.equal(right.lifted, false, `${id} ${gt}`);
      assert.deepEqual(right.patches, []);
      assert.doesNotThrow(() => assertTreeForCell(right, cell, gt));
      assert.throws(() => assertTreeForCell({ ...right, lifted: true }, cell, gt), /the tree is lifted, but the refusal lift is retired/, `${id} ${gt}`);
      assert.throws(() => assertTreeForCell(right, cell, undefined), /gameType must be one of/);
    }
    assert.equal(set.forCell(cellById('MMC3-V'), 'action'), set.forCell(cellById('MMC3-V'), 'rpg'), 'one tree per ring: the game type no longer picks a form');
    assert.notEqual(set.forCell(cellById('MMC3-V'), 'action'), set.forCell(cellById('MMC3-H'), 'action'));
  } finally { set.dispose(); }
  const t = makeCellTree({ cell: cellById('MMC3-H'), gameType: 'rpg', extra: ['render-four-nts'] });
  try { assert.equal(t.lifted, false); assert.deepEqual(t.patches.map((p) => p.name), ['render-four-nts']); } finally { fs.rmSync(t.root, { recursive: true, force: true }); }
});
test('every cell, ACTION and RPG, builds on PLAIN production: the ROM through the one tree is byte-identical to `node main/build/cli.js` on the same project, the stamp carries no patch, no lift and BASELINE\'s consumed evidence, and the audit refuses a lift on it', async () => {
  for (const id of ALL_CELLS) for (const gt of ['action', 'rpg']) {
    const cell = cellById(id);
    const tree = makeCellTree({ cell, gameType: gt });
    const dir = tmp();
    let built, cli;
    try {
      const { project } = ringProject({ cell, gameType: gt });
      built = await buildCell({ tree, project, cell, gameType: gt, label: `unit-plain-${id}-${gt}`, provDir: dir, links: { result: path.join(dir, 'r.json'), log: path.join(dir, 'l.log') } });
      assert.deepEqual(built.prov.patches, []);
      assert.deepEqual([built.prov.productionProof.changed, built.prov.productionProof.declared, built.prov.productionProof.lifted], [[], [], false]);
      assert.equal(built.prov.streamRing, cell.ring, 'a real ring build');
      assert.ok(built.prov.ringCodeAssembled);
      // the same project, built by the shipped CLI in a fresh directory of this checkout: no tree, no patch, no bypass
      cli = tmp();
      fs.cpSync(built.dir, cli, { recursive: true, filter: (p) => path.basename(p) !== 'build' });
      const r = spawnSync(process.execPath, [path.join(REPO, 'main/build/cli.js'), cli], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(fs.readFileSync(path.join(cli, 'build/game.nes')).equals(built.rom), `${id} ${gt}: the plain-production ROM equals the tree's`);
      // the stamp is a clean one, and the audit accepts it
      const real = JSON.parse(fs.readFileSync(path.join(dir, `unit-plain-${id}-${gt}.json`), 'utf8'));
      assert.deepEqual(auditTreeProvenance(real, 'x.json'), []);
      assert.deepEqual(real.patches, []);
      // the refusals: the lift listed, its proof for a lifted tree, a missing lift flag, a cell production would refuse, and a game type the table does not know
      const refuse = (mut, re, label, opts) => {
        const s = structuredClone(real); mut(s);
        const direct = auditTreeProvenance(s, 'x.json', opts), via = auditStamp(s, 'x.json', () => true).filter((b) => /tree provenance/.test(b));
        assert.ok(direct.some((b) => re.test(b)), `${id} ${gt} ${label}: direct ${direct.join('|') || '(accepted)'}`);
        if (!opts) assert.ok(via.some((b) => re.test(b)), `${id} ${gt} ${label}: auditStamp ${via.join('|') || '(accepted)'}`);
      };
      refuse((s) => { s.patches = LIFT_LISTED; }, /carries 00-refusal-lift\.patch: .*no stamp carries a lift/, '(a) only the patch list claims the lift');
      refuse((s) => { Object.assign(s, provenanceFor(cell.ring, false, []), { patches: LIFT_LISTED }); }, /no stamp carries a lift/, '(a) a self-consistent stamp with the lift listed');
      refuse((s) => { s.productionProof.lifted = true; }, /the proof was made for a LIFTED tree: no stamp carries a lift/, '(c) the proof\'s own lift flag flipped');
      refuse((s) => { delete s.productionProof.lifted; }, /no stamp carries a lift .*exactly false/, '(c) a proof with no lift flag');
      refuse((s) => { s.productionProof.lifted = 'no'; }, /no stamp carries a lift .*exactly false/, '(c) a truthy-looking lift flag');
      refuse(() => {}, new RegExp(`${id} ${gt} is declared lifted: production refuses it`), '(b) a cell production would refuse (injected)', { refuses: () => true });
      refuse((s) => { delete s.gameType; }, /gameType undefined is none of action, rpg/, 'no game type');
      refuse((s) => { s.gameType = 'puzzle'; }, /is none of action, rpg/, 'an unknown game type');
    } finally { if (built) fs.rmSync(built.dir, { recursive: true, force: true }); for (const d of [dir, cli]) if (d) fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(tree.root, { recursive: true, force: true }); }
  }
});
test('SABOTAGE of the audit by cell: for every cell and game type the stamp passes on a build, an S1b witness and an S1c run alike, and the lift (listed, flagged in the proof, or a refused cell) is refused on each; ring 0 is the unlifted ring-2 tree', () => {
  const prov = (s, opts) => auditTreeProvenance(s, 'x.json', opts);
  for (const id of ALL_CELLS) for (const gt of ['action', 'rpg']) {
    const cell = cellById(id);
    for (const kind of ['cell-build', 's1b-witness', 's1c-run']) {
      const base = { kind, cell: id, gameType: gt, sabotage: null };
      const ok = { ...base, ...provenanceFor(cell.ring, false) };
      assert.deepEqual(prov(ok), [], `${kind} ${id} ${gt}`);
      assert.ok(prov({ ...ok, patches: LIFT_LISTED }).some((b) => /no stamp carries a lift/.test(b)), `${kind} ${id} ${gt}: the lift listed`);
      assert.ok(prov({ ...ok, productionProof: { ...ok.productionProof, lifted: true } }).some((b) => /no stamp carries a lift/.test(b)), `${kind} ${id} ${gt}: a lifted proof`);
      assert.ok(prov(ok, { refuses: () => true }).some((b) => /is declared lifted: production refuses it/.test(b)), `${kind} ${id} ${gt}: a refused cell`);
      // with a declared sabotage on top: the same rule
      if (kind !== 's1c-run') {
        const sab = { ...base, sabotage: 'render-four-nts', ...provenanceFor(cell.ring, false, ['render-four-nts']) };
        assert.deepEqual(prov(sab), [], `${kind} ${id} ${gt}: a sabotage control`);
        assert.ok(prov({ ...sab, patches: [...LIFT_LISTED, ...sab.patches] }).some((b) => /no stamp carries a lift/.test(b)), `${kind} ${id} ${gt}: a sabotage control that lists the lift`);
      }
    }
  }
  // ring 0: the pristine side has no tree, the patched side and the comparison are the (unlifted) ring-2 tree; a lifted one is refused
  const plain = provenanceFor(2, false);
  assert.deepEqual(prov({ kind: 'ring0-build', tree: 'patched', ...plain }), []);
  assert.ok(prov({ kind: 'ring0-build', tree: 'patched', ...plain, productionProof: { ...plain.productionProof, lifted: true } }).some((b) => /no stamp carries a lift/.test(b)), 'the patched ring-0 side with a lifted proof');
  const { consumed: _p, ...plainNoEv } = plain;
  assert.deepEqual(prov({ kind: 'ring0-identity-comparison', ...plainNoEv }), []);
  assert.ok(prov({ kind: 'ring0-identity-comparison', ...plainNoEv, productionProof: { ...plain.productionProof, lifted: true } }).some((b) => /no stamp carries a lift/.test(b)), 'a comparison against a lifted tree');
  assert.ok(prov({ kind: 'ring0-build', tree: 'pristine', baseline: BASELINE, patches: [] }).length === 0);
});
test('the audit states "no stamp carries a lift" positively: auditProvenance counts the stamps that list the lift or a lifted proof (0 on a clean directory) and FAILS on one that does', () => {
  const dir = tmp(), logs = tmp();
  try {
    const put = (name, over) => fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ schema: 'ring-prov-3', kind: 'cell-build', cell: 'MMC3-V', gameType: 'rpg', status: 'built', sabotage: null, results: [], ...provenanceFor(1, false), ...over }));
    put('clean', {});
    let r = auditProvenance(dir, logs, { construct: true });
    assert.equal(r.liftedStamps, 0);
    assert.ok(!r.problems.some((p) => /no stamp carries a lift/.test(p)), 'a clean stamp raises no lift problem');
    put('lifted-patch', { patches: LIFT_LISTED });
    put('lifted-proof', { productionProof: { ...provenanceFor(1, false).productionProof, lifted: true } });
    r = auditProvenance(dir, logs, { construct: true });
    assert.equal(r.liftedStamps, 2);
    assert.equal(r.ok, false);
    assert.ok(r.problems.filter((p) => /no stamp carries a lift/.test(p)).length >= 2, r.problems.join('\n'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(logs, { recursive: true, force: true }); }
});
test('the audit\'s historical waiver is as narrow as before the lift was retired: the same four kinds under the same one baseline, and a current-baseline stamp that lists the lift is never waived', () => {
  assert.deepEqual(HISTORICAL_KINDS, ['cell-build', 'ring0-build', 'ring0-identity-comparison', 's1b-witness']);
  assert.equal(PRE_C2_BASELINE, '5138c1f0c33107016a90423da17dcbb33d8697ca');
  for (const id of ALL_CELLS) {
    const ring = cellById(id).ring;
    const cur = { schema: 'ring-prov-3', kind: 'cell-build', cell: id, gameType: 'action', status: 'error', head: 'h', sabotage: null, attempt: { startedAt: 'x' }, error: { firstLine: 'x' }, ...provenanceFor(ring, false), patches: LIFT_LISTED };
    const bad = auditStamp(cur, 'x.json', () => true, undefined, { historicalTree: true });
    assert.ok(bad.some((b) => /tree provenance.*carries 00-refusal-lift\.patch: .*no stamp carries a lift/.test(b)), `${id}: ${bad.join('|')}`);
    assert.ok(!isHistoricalStamp(cur), id);
  }
});
test('S4a C2: ringcells.mjs (the cell table the tree maker, the audit and the scene builder share) is in the harness fingerprint, and the patch directory listing carries every sabotage form and NOT the retired lift', () => {
  const fp = harnessFingerprint();
  assert.ok('test/lua/ring_gate/ringcells.mjs' in fp, 'ringcells.mjs is hashed');
  assert.ok(!('test/lua/ring_gate/00-refusal-lift.patch' in fp), 'the retired lift is not fingerprinted');
  for (const n of Object.keys(IDENTITY_OUTCOME)) for (const ring of sabotageRings(n)) assert.ok(`test/lua/ring_gate/${ring === 1 ? 'sabotage/vertical' : 'sabotage'}/${n}.patch` in fp, `${n} ring ${ring}`);
  assert.deepEqual(fingerprintGaps(fp), []);
});
