// The harness-transfer certificate: producer and verifier (the consumer, validateTransfer, lives in test/lua/sw_transfer_lib.mjs).
//
// QUESTION. test/fixtures/streambound-curve.json records the harness (sw_provenance.mjs HARNESS_FILES) that took its Mesen measurements. Phase 3b S1b changed
// two of those files (run_sw_manifest.mjs, sw_manifest_scene.mjs) for the ring cells, so the live harness is no longer the recorded one, and no engine change
// can pass streamtilebound.test.js. A measurement-script change can invalidate measured bounds without changing a ROM, so the harness equality cannot just
// be deleted; this tool PROVES the old and the current harness measure the curve's workload identically, and the proof is checked in.
//
//   node test/lua/sw_harness_transfer.mjs --old-tree=<worktree of the recorded harness's commit> --dir=<evidence dir> [--workers=N] [--mesen=<path>]
//        [--out=test/fixtures/harness-transfer/<name>.json]  written only after full coverage and a complete pilot, never over an existing file
//        [--report=<file.json>] [--limit=K | --shard=I/M]    a PARTIAL run: never a certificate (exit 3 when clean)
//   test-only: TRANSFER_SABOTAGE=kill-worker|flip-rom-byte|drift-binding|sym-address|sym-only|recipe  (TRANSFER_SABOTAGE_SIDE=old|new)
//              TRANSFER_CONTROL=omit-old|omit-new|omit-pilot-old|omit-pilot-new|pilot-diff|pilot-extra-key   (each proves a refusal; never writes a certificate)
//   node test/lua/sw_harness_transfer.mjs --verify=<certificate.json> [--dir=<evidence dir>]   revalidate against the live sources, and re-derive the pilot
//        manifest and the stage digests from the evidence when it is present.
//
// WHAT IT RUNS (every one of the curve's recorded Mesen-run jobs: 11,760 direct incl. confirmations, 832 reuses resolved to their matched sources).
//   OLD pass   the checked-in ARCHIVE of the recorded harness (test/fixtures/harness-transfer/archive-7b1155d0e306) must equal, byte for byte, the six harness
//              files of --old-tree, whose harness hash is the curve's; the worker then imports the harness FROM that tree (sw_transfer_worker.mjs).
//   NEW pass   the same worker, harness from this tree.
//   Each side has its OWN ledger and verdict (expected == answered == matched == keys reproduced == directCount); then every direct job is compared id by id:
//   project, ROM, ROM-file, rendered-Lua digest and symbol-line digest of old vs new (the key check does not look at the symbol line; this comparison does).
//   PILOT      ~40 jobs from selectPilot (a pinned coverage manifest) through real Mesen under BOTH harnesses; the parsed measurements must be deep-equal and each run complete.
// Exit: 0 certified; 1 not certified; 2 malformed option; 3 clean partial run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPO } from './sw_manifest_scene.mjs';
import { MESEN_DEFAULT } from './run_sw_manifest.mjs';
import { validateRows, isBad } from './sw_bound_sweep.mjs';
import { processProvenance, UNIFORM_FIELDS, EXEC_FLAGS, HARNESS_FILES } from './sw_provenance.mjs';
import { makeLedger } from './sw_rebuild_check.mjs';
import { parseOptions, buildWorkset, runPool, verdictOf, CURVE_REL, EVIDENCE_DIR_REL, EVIDENCE_FILES, WORKER_FILE, liveSources } from './sw_identity_cert.mjs';
import {
  sha256, sortedDigest, sealOf, isHex, TRANSFER_KIND, TRANSFER_VERSION, TOOL_VERSION, TRANSFER_DIR_REL, ARCHIVE_DIR_REL, TRANSFER_SCOPE, TRANSFER_STAGES, PILOT_MIN,
  helperPins, harnessFileShas, archiveFileShas, archivedHarnessHash, verifyOldTree, validateTransfer, selectPilot, pilotMeasurement
} from './sw_transfer_lib.mjs';

const SELF = fileURLToPath(import.meta.url);
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === SELF;
const EMPTY_SHA = sha256('');
const readLines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** The old-vs-new comparison of the two sides' answers, id by id. `ids` is what each side was asked; a missing answer on either side is its own problem. Pure. */
export function comparePairs(ids, oldRun, newRun) {
  const problems = []; const lines = [];
  const eq = { compared: 0, equalProject: 0, equalRom: 0, equalRomFile: 0, equalLua: 0, equalSym: 0 };
  for (const id of ids) {
    const o = oldRun.hashOf.get(id); const n = newRun.hashOf.get(id);
    if (!o) problems.push(`${id}: no answer on the old side`);
    if (!n) problems.push(`${id}: no answer on the new side`);
    if (!o || !n) continue;
    eq.compared++;
    if (o.project === n.project) eq.equalProject++; else problems.push(`${id}: the normalized project differs between the harnesses`);
    if (o.rom === n.rom) eq.equalRom++; else problems.push(`${id}: the ROM hash differs between the harnesses`);
    if (o.romFile === n.romFile) eq.equalRomFile++; else problems.push(`${id}: the ROM file differs between the harnesses`);
    const lo = oldRun.luaOf.get(id); const ln = newRun.luaOf.get(id);
    if (isHex(lo) && lo === ln) eq.equalLua++; else problems.push(`${id}: the rendered Lua differs between the harnesses`);
    const so = oldRun.symOf.get(id); const sn = newRun.symOf.get(id);
    const symOk = isHex(so) && isHex(sn) && so !== EMPTY_SHA && sn !== EMPTY_SHA;
    if (!symOk) problems.push(`${id}: no valid symbol-line evidence on ${isHex(so) && so !== EMPTY_SHA ? 'the new' : 'the old'} side`);
    else if (so !== sn) problems.push(`${id}: the symbol bindings differ between the harnesses`);
    else eq.equalSym++;
    lines.push(`${id}|${o.project}|${o.rom}|${o.romFile}|${lo}|${so}`);
  }
  return { problems, ...eq, digest: sortedDigest(lines) };
}

/** The pilot comparison, per manifest entry. `oldRes`/`newRes`: Map id -> the worker's measurement result (symbols already a digest). Pure. */
export function comparePilot(manifest, oldRes, newRes, recordsById) {
  const problems = []; const results = [];
  for (const m of manifest) {
    const a = oldRes.get(m.id); const b = newRes.get(m.id);
    if (!a) problems.push(`pilot incomplete: ${m.id} has no old-harness measurement`);
    if (!b) problems.push(`pilot incomplete: ${m.id} has no new-harness measurement`);
    if (!a || !b) { results.push({ id: m.id, complete: false, noExtraKeys: false, oldDigest: null, newDigest: null, matchesRecorded: false }); continue; }
    const pa = pilotMeasurement(a); const pb = pilotMeasurement(b);
    const complete = [a, b].every((r) => r.done === true && r.timeout === false && r.status === 0 && r.phases && Object.keys(r.phases).length > 0 && (recordsById.get(m.id)?.stage !== 'R' || r.contact));
    const noExtraKeys = pa.extra.length === 0 && pb.extra.length === 0;
    if (!complete) problems.push(`pilot differs: ${m.id} did not complete on both harnesses`);
    if (!noExtraKeys) problems.push(`pilot differs: ${m.id} carries ${[...pa.extra, ...pb.extra].join(',')} (a key the recorded harness cannot produce)`);
    if (pa.digest !== pb.digest) problems.push(`pilot differs: ${m.id} ${Object.keys(pa.body).filter((k) => JSON.stringify(pa.body[k]) !== JSON.stringify(pb.body[k])).join(',')}`);
    const rec = recordsById.get(m.id);
    const matchesRecorded = !!rec && pa.body.frames === rec.frames && Object.entries(rec.phases).every(([k, v]) => pa.body.phases[k] && pa.body.phases[k].maxG === v.maxG && pa.body.phases[k].gateFail === v.gateFail && pa.body.phases[k].n === v.n);
    results.push({ id: m.id, complete, noExtraKeys, oldDigest: pa.digest, newDigest: pb.digest, matchesRecorded });
  }
  return { problems, results };
}

/** The pilot's Mesen runs on forked measuring workers: Map id -> result, with a ledger of its own. */
function runMeasure(jobs, { harnessRoot, expectHarness, side, mesen, workers, env }) {
  const ledger = makeLedger(jobs.map((r) => r.id));
  const out = new Map(); const queue = jobs.slice(); const errors = []; let live = 0;
  return new Promise((resolve) => {
    const fin = () => { if (--live === 0) resolve({ result: ledger.result(), out, errors }); };
    for (let i = 0; i < Math.min(workers, jobs.length); i++) {
      live++; const name = `m${i}`;
      const kid = fork(WORKER_FILE, [`--harness-root=${harnessRoot}`, `--expect-harness=${expectHarness}`, '--mode=measure', `--side=${side}`, `--mesen=${mesen}`, `--index=${i}`], { env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      const next = () => { const r = queue.shift(); if (r) { ledger.assign(name, r.id); kid.send(r); } else { ledger.release(name); kid.send('exit'); } };
      kid.on('message', (m) => {
        if (m?.ready) { next(); return; }
        const kind = m && typeof m.error === 'string' ? 'errored' : m?.result ? 'matched' : 'errored';
        if (!ledger.respond(name, m?.id, kind)) { kid.kill('SIGKILL'); return; }
        if (kind === 'errored') errors.push({ id: m?.id, error: m?.error ?? 'malformed measurement reply' }); else out.set(m.id, m.result);
        next();
      });
      kid.on('error', (e) => ledger.problem(`measure worker ${name}: ${String(e?.message ?? e).slice(0, 100)}`));
      kid.on('exit', (code, signal) => { ledger.exit(name, code, signal); fin(); });
    }
    if (jobs.length === 0) resolve({ result: ledger.result(), out, errors });
  });
}

const sideState = (root, mesen) => {
  const s = processProvenance(root, mesen, { harnessRoot: root, freshMesen: true });
  const pins = helperPins(root);
  return { ...s, helpersDigest: sha256(JSON.stringify(pins)), pins };
};
const gitInfo = (dir) => {
  const run = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  const head = run('rev-parse', 'HEAD'); const st = run('status', '--porcelain', '--untracked-files=no');
  return head.status === 0 ? { head: head.stdout.trim(), dirty: st.stdout.trim().length > 0 } : null;
};

async function main() {
  const t0 = Date.now();
  const arg = (n, d) => { const a = process.argv.find((s) => s.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
  const say = (m) => console.log(m);
  const curvePath = path.resolve(REPO, arg('curve', CURVE_REL));
  const archiveDir = path.join(REPO, ARCHIVE_DIR_REL);
  const evidence = () => {
    const dir = path.resolve(REPO, arg('dir', EVIDENCE_DIR_REL));
    const names = arg('files', EVIDENCE_FILES.join(',')).split(',');
    if (names.length !== TRANSFER_STAGES.length || names.some((n, i) => n !== EVIDENCE_FILES[i])) throw new Error(`--files must be exactly ${EVIDENCE_FILES.join(',')} (the pinned evidence)`);
    const files = names.map((n) => path.join(dir, n));
    const stageInfo = Object.fromEntries(files.map((f, i) => [TRANSFER_STAGES[i], { file: `${EVIDENCE_DIR_REL}/${names[i]}`, sha256: sha256(fs.readFileSync(f)), lines: fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length }]));
    return { files, stageInfo };
  };

  const verifyPath = arg('verify', null);
  if (verifyPath) {
    const cert = JSON.parse(fs.readFileSync(path.resolve(verifyPath), 'utf8'));
    const curveBytes = fs.readFileSync(curvePath); const curve = JSON.parse(curveBytes);
    const problems = validateTransfer(cert, { curve, curveBytes, live: liveSources(), archiveDir });
    if (arg('dir', null) !== null) {
      try {
        const ev = evidence();
        for (const s of TRANSFER_STAGES) if (cert.stages?.[s]?.sha256 !== ev.stageInfo[s].sha256) problems.push(`stage ${s}: the evidence file is not the one the certificate pinned`);
        const ws = buildWorkset(validateRows(ev.files.flatMap(readLines), 'the evidence'), { curve, stageInfo: ev.stageInfo });
        problems.push(...ws.problems.slice(0, 10));
        if (ws.directDigest !== cert.workset?.directDigest || ws.reuseDigest !== cert.workset?.reuseDigest) problems.push('the evidence workset is not the certified one');
        const manifest = selectPilot(ws.direct, ws.reuses, cert.pilot?.manifest?.length ?? PILOT_MIN);
        if (JSON.stringify(manifest) !== JSON.stringify(cert.pilot?.manifest)) problems.push('the pilot manifest is not the one selectPilot derives from the evidence');
      } catch (e) { problems.push(`cannot re-derive from the evidence: ${e.message}`); }
    }
    for (const m of problems) console.error(`INVALID: ${m}`);
    say(problems.length ? 'transfer certificate INVALID for the live sources' : 'transfer certificate valid for the live sources');
    process.exit(problems.length ? 1 : 0);
  }

  let options;
  try { options = parseOptions(process.argv.slice(2)); } catch (e) { console.error(`usage error: ${e.message}`); process.exit(2); }
  const mesen = arg('mesen', MESEN_DEFAULT);
  const oldTree = arg('old-tree', null);
  if (!oldTree) { console.error('usage error: --old-tree=<a worktree holding the recorded harness> is required'); process.exit(2); }
  const outPath = arg('out', null); const reportPath = arg('report', null);
  const sabotage = process.env.TRANSFER_SABOTAGE || process.env.CERT_SABOTAGE || null;
  const control = process.env.TRANSFER_CONTROL || null;
  const partial = options.limit !== null || options.shard !== null;
  if (outPath && partial) { console.error('usage error: a partial run (--limit/--shard) never writes a certificate; drop --out'); process.exit(2); }
  if (outPath && path.dirname(path.resolve(REPO, outPath)) !== path.join(REPO, TRANSFER_DIR_REL)) { console.error(`usage error: --out must be a file directly under ${TRANSFER_DIR_REL}`); process.exit(2); }
  if (outPath && fs.existsSync(path.resolve(REPO, outPath))) { console.error(`REFUSED: ${outPath} exists; certificates are immutable and are never overwritten`); process.exit(1); }
  const report = { tool: TOOL_VERSION, partial, sabotage, control, options };
  const fail = (code, ...msgs) => { for (const m of msgs) console.error(m); if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ ...report, exit: code, messages: msgs }, null, 1) + '\n'); process.exit(code); };
  const oldRoot = fs.realpathSync(path.resolve(oldTree));

  // 1. pin and validate the evidence, then the trees
  let curve; let curveBytes; let ev; let ws;
  try {
    curveBytes = fs.readFileSync(curvePath); curve = JSON.parse(curveBytes);
    ev = evidence();
    ws = buildWorkset(validateRows(ev.files.flatMap(readLines), ev.files.join(', ')), { curve, stageInfo: ev.stageInfo });
  } catch (e) { fail(1, `REFUSED: ${String(e.message ?? e)}`); }
  if (ws.problems.length) fail(1, ...ws.problems.slice(0, 40).map((m) => `REFUSED: ${m}`));
  const treeProblems = verifyOldTree({ oldTree: oldRoot, archiveDir, curve, newTree: REPO });
  const og = gitInfo(oldRoot);
  if (og?.dirty) treeProblems.push('the old tree has uncommitted changes to tracked files');
  if (oldRoot === fs.realpathSync(REPO)) treeProblems.push('the old tree is the current tree');
  if (treeProblems.length) fail(1, ...treeProblems.map((m) => `REFUSED: ${m}`));

  const oldBefore = sideState(oldRoot, mesen); const newBefore = sideState(REPO, mesen);
  const rec = curve.provenance;
  const sourceCheck = (st, harness, label) => [['engine', rec.engine], ['generator', rec.generator], ['mesen', rec.mesen], ['harness', harness]].filter(([f, v]) => st[f] !== v).map(([f, v]) => `${label} ${f} ${st[f].slice(0, 12)} is not the expected ${v.slice(0, 12)}`);
  const stateProblems = [...sourceCheck(oldBefore, rec.harness, 'old tree'), ...sourceCheck(newBefore, newBefore.harness, 'current tree')];
  if (newBefore.engine !== rec.engine || newBefore.generator !== rec.generator) stateProblems.push('the current tree\'s engine/generator are not the curve\'s recorded ones: run the transfer on a clean checkout of the harness slice, without any engine change');
  if (newBefore.harness === rec.harness) stateProblems.push('the live harness IS the recorded one: there is nothing to transfer');
  if (oldBefore.helpersDigest !== newBefore.helpersDigest) stateProblems.push('the helper files differ between the old and the current tree');
  if (stateProblems.length) fail(1, ...stateProblems.map((m) => `REFUSED: ${m}`));
  say(`records: ${ws.all.length} ids = ${ws.direct.length} direct (incl. ${ws.confirms.length} confirmations) + ${ws.reuses.length} reuses; stages ${Object.entries(ws.perStage).map(([s, n]) => `${s}:${n}`).join(' ')}`);
  say(`old harness ${oldBefore.harness.slice(0, 12)} (archive-verified, tree ${oldRoot}${og ? ` @ ${og.head.slice(0, 9)}` : ''}) | new harness ${newBefore.harness.slice(0, 12)}`);
  say(`engine ${rec.engine.slice(0, 12)} generator ${rec.generator.slice(0, 12)} on both trees; helpers ${oldBefore.helpersDigest.slice(0, 12)} on both`);

  // 2. both exhaustive passes, each with its own ledger
  let todo = ws.direct;
  if (options.limit !== null) todo = todo.slice(0, options.limit);
  if (options.shard) todo = todo.filter((_, i) => i % options.shard.of === options.shard.index);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-harness-transfer-'));
  const cleanup = () => { try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ } };
  process.on('exit', cleanup);
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { cleanup(); process.exit(130); });
  const runs = {}; const verdicts = {}; const wall = {};
  const sides = [['old', oldRoot, oldBefore], ['new', REPO, newBefore]];
  for (const [side, root, st] of sides) {
    let sideTodo = todo;
    if (control === `omit-${side}`) sideTodo = todo.slice(0, -1); // an incomplete transfer: this side silently lacks its last job
    const t1 = Date.now();
    say(`${side} pass: rebuilding ${sideTodo.length} of ${ws.direct.length} direct records on ${Math.min(options.workers, sideTodo.length || 1)} workers${partial ? ' (PARTIAL)' : ''}${sabotage ? ` [${sabotage}]` : ''}${control ? ` [control ${control}]` : ''}`);
    runs[side] = await runPool(sideTodo, {
      workers: options.workers, worker: { file: WORKER_FILE, args: [`--harness-root=${root}`, `--expect-harness=${st.harness}`, '--mode=prepare', `--side=${side}`, `--mesen=${mesen}`] },
      env: { ...process.env, TMPDIR: base }, current: st,
      progress: (done, mm, ee) => { if (done % 1000 === 0) console.error(`  ${side} ${done}/${sideTodo.length} ${((Date.now() - t1) / 1000).toFixed(0)}s, ${mm} mismatches, ${ee} errors`); }
    });
    wall[side] = Math.round((Date.now() - t1) / 1000);
  }
  // the reuse records resolve to matched direct records, per side
  const reuseResolved = {};
  for (const [side] of sides) {
    const matchedIds = new Set(Object.entries(runs[side].result.kinds).filter(([, k]) => k === 'matched').map(([id]) => id));
    reuseResolved[side] = []; const bad = [];
    if (!partial) for (const r of ws.reuses) (matchedIds.has(r.reuse.of) ? reuseResolved[side] : bad).push(r.id);
    verdicts[side] = { bad: bad.map((id) => `${side} side: reuse ${id}: its source is not a matched rebuild`) };
  }

  // 3. the pilot: real Mesen, both harnesses
  const recordsById = new Map(ws.all.map((r) => [r.id, r]));
  const manifest = selectPilot(ws.direct, ws.reuses);
  let pilotManifest = partial ? manifest.filter((_, i) => i % 7 === 0) : manifest;
  const pilotRuns = {};
  for (const [side, root, st] of sides) {
    let jobs = pilotManifest.map((m) => recordsById.get(m.id));
    if (control === `omit-pilot-${side}`) jobs = jobs.slice(0, -1);
    const t1 = Date.now();
    say(`${side} pilot: ${jobs.length} Mesen runs`);
    pilotRuns[side] = await runMeasure(jobs, { harnessRoot: root, expectHarness: st.harness, side, mesen, workers: Math.min(options.workers, 8), env: { ...process.env, TMPDIR: base } });
    wall[`${side}Pilot`] = Math.round((Date.now() - t1) / 1000);
  }
  if (control === 'pilot-diff') { const r = pilotRuns.new.out.get(pilotManifest[0].id); if (r) { const k = Object.keys(r.phases)[0]; r.phases[k] = { ...r.phases[k], maxG: (r.phases[k].maxG ?? 0) + 1 }; } }
  if (control === 'pilot-extra-key') { const r = pilotRuns.new.out.get(pilotManifest[0].id); if (r) r.keys = [...r.keys, 'counters']; }
  const pilot = comparePilot(pilotManifest, pilotRuns.old.out, pilotRuns.new.out, recordsById);

  // 4. pin again after both passes and the pilot
  const oldAfter = sideState(oldRoot, mesen); const newAfter = sideState(REPO, mesen);
  const sourceProblems = [];
  for (const [side, b, a] of [['old', oldBefore, oldAfter], ['new', newBefore, newAfter]]) {
    for (const f of [...UNIFORM_FIELDS, 'helpersDigest']) if (b[f] !== a[f]) sourceProblems.push(`${side} source ${f} changed during the run`);
  }
  try { const again = evidence(); for (const s of TRANSFER_STAGES) if (again.stageInfo[s].sha256 !== ev.stageInfo[s].sha256) sourceProblems.push(`stage file ${s} changed during the run`); if (sha256(fs.readFileSync(curvePath)) !== sha256(curveBytes)) sourceProblems.push('the curve changed during the run'); } catch (e) { sourceProblems.push(`cannot re-read the pinned files: ${e.message}`); }
  if (archivedHarnessHash(archiveDir) !== rec.harness) sourceProblems.push('the archive changed during the run');
  const treeAgain = verifyOldTree({ oldTree: oldRoot, archiveDir, curve, newTree: REPO }); sourceProblems.push(...treeAgain);

  // 5. the verdict: each side on its own, then the pair, then the pilot
  const sideVerdict = {};
  for (const [side, , st] of sides) {
    const run = runs[side];
    sideVerdict[side] = verdictOf({ directCount: partial ? todo.length : ws.direct.length, partial, result: run.result, drift: run.drift.length, sourceProblems: [], sabotage: null, reuseProblems: verdicts[side].bad });
    if (run.cnevHits) sideVerdict[side].why.push(`${side} side: ${run.cnevHits} rendered scripts print a CN/EV line`);
  }
  const pairs = comparePairs(todo.map((r) => r.id), runs.old, runs.new);
  const why = [
    ...['old', 'new'].flatMap((s) => sideVerdict[s].why.map((m) => `${s} side: ${m}`)),
    ...pairs.problems.slice(0, 40), ...pilot.problems.slice(0, 40), ...sourceProblems,
    ...(pilotRuns.old.result.problems.concat(pilotRuns.new.result.problems)).slice(0, 10).map((m) => `pilot worker: ${m}`),
    ...(partial ? [] : pilotRuns.old.errors.concat(pilotRuns.new.errors).slice(0, 10).map((e) => `pilot error ${e.id}: ${e.error}`))
  ];
  for (const s of ['old', 'new']) for (const m of runs[s].mismatches.slice(0, 20)) say(`MISMATCH ${s} ${m.stage} ${m.id}: ${m.differs.join('+')}`);
  for (const s of ['old', 'new']) for (const e of runs[s].errors.slice(0, 10)) say(`ERROR ${s} ${e.stage} ${e.id}: ${e.error}`);
  for (const s of ['old', 'new']) for (const m of runs[s].result.problems.slice(0, 10)) say(`PROBLEM ${s}: ${m}`);
  if (sabotage || control) why.push(`${sabotage ? `TRANSFER_SABOTAGE=${sabotage}` : `TRANSFER_CONTROL=${control}`} is set: a sabotaged run is never a certification`);
  const exit = why.length ? 1 : partial ? 3 : 0;
  const matchesRecorded = pilot.results.filter((r) => r.matchesRecorded).length;
  const wallSeconds = Math.round((Date.now() - t0) / 1000);
  say(`old: ${runs.old.result.matched}/${todo.length} matched, ${runs.old.mismatches.length} mismatched, ${runs.old.errors.length} errors; new: ${runs.new.result.matched}/${todo.length} matched, ${runs.new.mismatches.length} mismatched, ${runs.new.errors.length} errors`);
  say(`pairs: ${pairs.compared} compared, project ${pairs.equalProject} rom ${pairs.equalRom} romfile ${pairs.equalRomFile} lua ${pairs.equalLua} sym ${pairs.equalSym}; CN/EV hits old ${runs.old.cnevHits} new ${runs.new.cnevHits}`);
  say(`pilot: ${pilot.results.length} jobs, ${pilot.results.filter((r) => r.complete && r.noExtraKeys && r.oldDigest === r.newDigest).length} equal, ${matchesRecorded} also equal the recorded record; wall old ${wall.old}s new ${wall.new}s pilot ${wall.oldPilot}s+${wall.newPilot}s total ${wallSeconds}s`);
  for (const m of why.slice(0, 40)) console.error(`REFUSED: ${m}`);
  say(exit === 0 ? 'TRANSFER CERTIFIED: both harnesses reproduce every recorded job identically' : exit === 3 ? 'PARTIAL CHECK, not a certification' : `NOT CERTIFIED (${why.length} problems)`);
  Object.assign(report, { exit, why, wallSeconds, wall, direct: ws.direct.length, todo: todo.length, pairs: { ...pairs, problems: pairs.problems.slice(0, 40) }, pilot: { size: pilot.results.length, matchesRecorded }, counts: { old: runs.old.result, new: runs.new.result } });

  if (exit === 0 && outPath) {
    const countsOf = (run, side) => ({
      expected: run.result.expected, answered: run.result.answered, matched: run.result.matched, mismatched: run.mismatches.length, errored: run.errors.length,
      keysReproduced: run.luaOf.size, reusesResolved: reuseResolved[side].length
    });
    const luaDigest = (run) => sortedDigest([...run.luaOf].map(([id, l]) => `${id}|${l}`));
    const symDigest = (run) => sortedDigest([...run.symOf].map(([id, l]) => `${id}|${l}`));
    const sideCert = (side, run, b, a) => ({
      harness: b.harness, counts: countsOf(run, side), directDigest: ws.directDigest, reuseDigest: ws.reuseDigest, luaDigest: luaDigest(run), symDigest: symDigest(run),
      scriptsScanned: run.luaOf.size, symLines: [...run.symOf.values()].filter((v) => isHex(v) && v !== EMPTY_SHA).length, cnevHits: run.cnevHits,
      sources: { before: { engine: b.engine, harness: b.harness, generator: b.generator, mesen: b.mesen, helpersDigest: b.helpersDigest }, after: { engine: a.engine, harness: a.harness, generator: a.generator, mesen: a.mesen, helpersDigest: a.helpersDigest } }
    });
    const oldFiles = archiveFileShas(archiveDir); const newFiles = harnessFileShas(REPO);
    const files = HARNESS_FILES.map((name) => ({ name, oldSha: oldFiles[name], newSha: newFiles[name], status: oldFiles[name] === newFiles[name] ? 'unchanged' : 'changed' }));
    const cert = {
      kind: TRANSFER_KIND, version: TRANSFER_VERSION,
      tool: { name: 'test/lua/sw_harness_transfer.mjs', version: TOOL_VERSION, sha256: { cli: sha256(fs.readFileSync(SELF)), lib: sha256(fs.readFileSync(path.join(path.dirname(SELF), 'sw_transfer_lib.mjs'))), worker: sha256(fs.readFileSync(WORKER_FILE)) } },
      scope: TRANSFER_SCOPE, date: new Date().toISOString().slice(0, 10), partial: false,
      curve: { file: CURVE_REL, sha256: sha256(curveBytes), jobs: curve.jobs, reused: curve.reused, confirms: curve.confirms, provenance: { ...curve.provenance } },
      stages: ev.stageInfo,
      workset: { directCount: ws.direct.length, reuseCount: ws.reuses.length, confirms: ws.confirms.length, perStage: ws.perStage, directDigest: ws.directDigest, reuseDigest: ws.reuseDigest },
      oldHarness: oldBefore.harness, newHarness: newBefore.harness,
      archive: { dir: ARCHIVE_DIR_REL, hash: archivedHarnessHash(archiveDir), files: HARNESS_FILES.map((name) => ({ name, sha256: oldFiles[name] })), oldTree: og ? { head: og.head } : null },
      files, declaredInert: files.filter((f) => f.status === 'changed').map((f) => f.name),
      helpers: { old: oldBefore.pins, new: newBefore.pins },
      recorded: { engine: rec.engine, generator: rec.generator, mesen: rec.mesen },
      execFlags: EXEC_FLAGS,
      sides: { old: sideCert('old', runs.old, oldBefore, oldAfter), new: sideCert('new', runs.new, newBefore, newAfter) },
      pairs: { compared: pairs.compared, equalProject: pairs.equalProject, equalRom: pairs.equalRom, equalRomFile: pairs.equalRomFile, equalLua: pairs.equalLua, equalSym: pairs.equalSym, digest: pairs.digest },
      pilot: { manifest: pilotManifest, manifestDigest: sha256(JSON.stringify(pilotManifest)), results: pilot.results, matchesRecorded },
      workers: options.workers, wallSeconds
    };
    cert.selfDigest = sealOf(cert);
    const own = validateTransfer(cert, { curve, curveBytes, live: liveSources(), archiveDir });
    if (own.length) { console.error(`REFUSED: the certificate just built does not validate: ${own.join('; ')}`); report.exit = 1; if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 1) + '\n'); process.exit(1); }
    fs.mkdirSync(path.dirname(path.resolve(REPO, outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(REPO, outPath), JSON.stringify(cert, null, 1) + '\n', { flag: 'wx' });
    say(`certificate written: ${outPath}`);
  }
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 1) + '\n');
  process.exit(exit);
}

if (IS_MAIN) await main();
