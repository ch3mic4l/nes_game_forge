// Controls for the harness's own provenance and verdict machinery (review 2 findings 3 and 4). No emulator runs here except one fast failing build.
//   node --test test/lua/ring_gate/prov_unit.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { makeTree, PATCH_DIR } from './ringtree.mjs';
import { cellById, ringProject, buildCell } from './ringworld.mjs';
import { mesenStamp, fileStamp, stampResult, harnessFingerprint, fingerprintGaps, writeAttempt, finishAttempt } from './ringprov.mjs';
import { matrixScripts } from './ringjobs.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RING_ADDR, checkAddresses } from './ringaddr.mjs';
import { scanEquates, resolveEquates } from '../../lib/equates.js';
import { MESEN, MESEN_ERROR, resolveMesen } from './ringrun_mesen.mjs';
import { auditStamp, auditProvenance } from './ringprovindex.mjs';
import { jobs, runMatrix, judgeJob, matrixReport } from './run_matrix.mjs';
import { IDENTITY_OUTCOME, buildErrorWitness, classifyBuildError } from './ringsabotage.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ring-prov-unit-'));

// A counted skip when no Mesen can run, or the one resolved is not a full release (this test symlinks and compares its sibling files). An invalid configured $MESEN is NOT a skip: the test body throws it.
const mesenTestSkip = () => (MESEN_ERROR ? false : !MESEN ? 'no executable Mesen (set $MESEN or put Mesen on PATH)'
  : ['Mesen.dll', 'MesenCore.so', 'Mesen.runtimeconfig.json', 'Mesen.deps.json'].some((f) => !fs.existsSync(path.join(path.dirname(MESEN), f))) ? `${MESEN} has no sibling Mesen release files` : false);
// ---- the Mesen implementation stamp identifies the core, not only the host (review 2: a dummy sibling core left the old stamp unchanged)
test('mesenStamp: a different MesenCore.so beside an identical host changes the stamp; the loaded core is identified by hash', { skip: mesenTestSkip() }, () => {
  if (MESEN_ERROR) throw new Error(MESEN_ERROR); // an invalid configured $MESEN is an error, never a skip
  const real = path.dirname(MESEN);
  const dir = tmp();
  try {
    for (const f of ['Mesen', 'Mesen.dll', 'Mesen.runtimeconfig.json', 'Mesen.deps.json']) fs.symlinkSync(path.join(real, f), path.join(dir, f));
    fs.writeFileSync(path.join(dir, 'MesenCore.so'), 'a dummy core');
    const dummy = mesenStamp(path.join(dir, 'Mesen'));
    const genuine = mesenStamp(MESEN);
    assert.equal(dummy.binarySha256, genuine.binarySha256, 'the host binary is identical');
    assert.notEqual(dummy.siblingFiles['MesenCore.so'].sha256, genuine.siblingFiles['MesenCore.so'].sha256);
    assert.notDeepEqual(dummy, genuine);
    // a core the process really loaded (a path outside the binary's directory, as Mesen does) is hashed and compared with the sibling
    const loaded = path.join(dir, 'loaded-core.so');
    fs.writeFileSync(loaded, 'the extracted core');
    const withLoaded = mesenStamp(path.join(dir, 'Mesen'), [loaded]);
    assert.equal(withLoaded.loadedCoreSha256, null, 'a loaded file not named MesenCore.so is not mistaken for the core');
    const loadedCore = path.join(dir, 'extracted', 'MesenCore.so');
    fs.mkdirSync(path.dirname(loadedCore));
    fs.writeFileSync(loadedCore, 'the extracted core');
    const w2 = mesenStamp(path.join(dir, 'Mesen'), [loadedCore]);
    assert.equal(w2.loadedCoreSha256, fileStamp(loadedCore).sha256);
    assert.equal(w2.coreLoadedFromSibling, false, 'the executed core differs from the sibling one');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- the harness fingerprint includes what the import closure misses (review 2 finding 3)
test('harnessFingerprint covers the matrix, the fixture-hash script and every patch file', () => {
  const fp = Object.keys(harnessFingerprint());
  for (const must of ['test/lua/ring_gate/run_matrix.mjs', 'test/lua/ring_gate/ringprovindex.mjs', 'test/lua/ring_gate/judge_unit.mjs', 'test/lua/ring_gate/fixture-hashes.mjs', 'test/lua/ring_gate/fixture-hashes-before.txt', 'test/lua/ring_gate/fixture-hashes-r4-before.txt',
    'test/lua/ring_gate/ring_oracle.lua.template', 'test/lua/ring_gate/01-ring-select.patch', 'test/lua/ring_gate/sabotage/instant-text.patch']) assert.ok(fp.includes(must), `${must} is not in the harness fingerprint`);
});

// ---- attempt stamps: written before the build, completed with the outcome, an errored build leaves one
test('a failing build leaves an error stamp that was written as an attempt first', async () => {
  const dir = tmp();
  const tree = makeTree({ ring: true });
  try {
    const cell = cellById('MMC1-V');
    const { project } = ringProject({ cell, gameType: 'action', n: 400 }); // beyond any admitted world: the generator refuses it before assembling
    let err;
    try { await buildCell({ tree, project, cell, gameType: 'action', provDir: dir, label: 'doomed', links: { result: path.join(dir, 'r.json'), log: path.join(dir, 'l.log') } }); } catch (e) { err = e; }
    assert.ok(err, 'the oversized world must fail to build');
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'doomed.json'), 'utf8'));
    assert.equal(st.status, 'error');
    assert.ok(st.attempt.startedAt && st.finishedAt && st.error.firstLine, 'attempt time, finish time and the error text are recorded');
    assert.ok(st.projectSha256 && st.patches.length === 3 && Object.keys(st.harness).length > 20 && st.nesasm?.sha256, 'inputs were stamped BEFORE the build');
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
    schema: 'ring-prov-3', kind: 'cell-build', status: 'built', gameType: 'action', attempt: { startedAt: 'x' }, head: 'h', baseline: 'b', patches: [{}],
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
  const patches = fs.readdirSync(path.join(PATCH_DIR, 'sabotage')).map((f) => f.replace(/\.patch$/, '')).sort();
  assert.deepEqual(patches, Object.keys(IDENTITY_OUTCOME).sort(), 'every sabotage patch has a declared identity outcome, and no declaration lacks its patch');
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
  // and a fingerprint is sensitive to the dropped script's CONTENT only when it is seeded: with the script seeded its hash is present
  assert.ok('test/lua/ring_gate/repro_continue_y.mjs' in harnessFingerprint());
});

// ---- Part E: the checked allocation map holds the place identity bytes; cur_map is a CHAINED equate, resolved by the repo's own scanner
test('RING_ADDR agrees with engine/constants.asm through scanEquates/resolveEquates, cur_map (= bt_owner_rec+1) and flat_screen included', () => {
  const pending = new Map();
  scanEquates(fs.readFileSync(path.join(REPO, 'engine/constants.asm'), 'utf8'), pending);
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
