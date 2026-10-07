#!/usr/bin/env node
// Phase 3b S1b rows 2, 4 and 7 for ONE cell x game type x dialogue placement: runs the witness specs (s1bspecs.mjs) in Mesen (G + executed-path counters) and jsnes
// (counters + the seam decode), classifies every measured body by observed execution, and judges them (s1bjudge.mjs).
//   node test/lua/ring_gate/run_s1b.mjs --cell=MMC1-H --gt=action [--placement=resident|banked] [--specs=a,b] [--emu=both|mesen|jsnes]
//        [--sabotage=<name>] [--expect=pass|gate-fail|bound-fail|seam-fail|fail] [--fault=freeze-drops-move] [--prov-dir=<dir>] [--json=f] [--log=f] [--n=<N>] [--list]
// Exit 0 = every item PASS or N/A (with a source proof); 1 = a FAIL or an UNMEASURED item; 2 = an error. With --sabotage/--fault the run EXPECTS the verdict named by
// --expect (default gate-fail for a sabotage, fail for a fault): exit 0 only when it came out that way.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { makeTree } from './ringtree.mjs';
import { CELLS, GAME_TYPES } from './ringworld.mjs';
import { prepareRing } from './ringcli.mjs';
import { runWitness, plannedInvocations, SIZES } from './ringwork.mjs';
import { openIsolatedHome, auditChain } from './ringhome.mjs';
import { reconcile } from './s1bbound.mjs';
import { decodeFrame, decodeSeams, bindCrossings } from './ringseam.mjs';
import { SPECS, SPEC_NAMES } from './s1bspecs.mjs';
import { judgeCell, summary, GATE, perClass, allRows, gateFailControl, gateAllows, NEAR, estimateRefusal } from './s1bjudge.mjs';
import zlib from 'node:zlib';
import { COUNTER_FAULTS } from './ringcount.mjs';
import { sweepSummary } from './s1bcost.mjs';
import { IDENTITY_OUTCOME } from './ringsabotage.mjs';
import { classify } from './ringcount.mjs';
import { MESEN, mesenUnavailable, userSavesSnapshot } from './ringrun_mesen.mjs';
import { harnessFingerprint, writeAttempt, finishAttempt, nesasmStamp, hostStamp, mesenStamp, jsnesStamp, fileStamp } from './ringprov.mjs';
import { sha256 } from './ringtree.mjs';
import { makeMutate } from '../sw_sweep_mutate.mjs';

const BULK = 3000;
const args = process.argv.slice(2);
const flag = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const die = (msg, code = 2) => { console.error(`run_s1b: ${msg}`); process.exit(code); };
const known = ['cell', 'gt', 'placement', 'specs', 'emu', 'sabotage', 'expect', 'fault', 'prov-dir', 'json', 'log', 'n'];
for (const a of args) if (a !== '--list' && !known.some((k) => a.startsWith(`--${k}=`))) die(`unknown argument ${a}`);
const cellId = flag('cell'), gt = flag('gt', 'action'), placement = flag('placement', 'resident');
const cell = CELLS.find((c) => c.id === cellId) ?? die(`--cell=${cellId} is not one of ${CELLS.map((c) => c.id).join(', ')}`);
if (!GAME_TYPES.includes(gt)) die(`--gt=${gt} is not one of ${GAME_TYPES.join(', ')}`);
if (!['resident', 'banked'].includes(placement)) die(`--placement=${placement}`);
const specSel = flag('specs') === undefined ? SPEC_NAMES : flag('specs').split(',');
for (const s of specSel) if (!SPEC_NAMES.includes(s)) die(`--specs names ${s}: valid ${SPEC_NAMES.join(', ')}`);
const emus = { both: ['mesen', 'jsnes'], mesen: ['mesen'], jsnes: ['jsnes'] }[flag('emu', 'both')] ?? die(`--emu=${flag('emu')}`);
const sabotage = flag('sabotage');
if (sabotage !== undefined && !(sabotage in IDENTITY_OUTCOME)) die(`--sabotage=${sabotage} is not a declared sabotage (ringsabotage.mjs)`);
const fault = flag('fault');
if (fault !== undefined && fault !== 'freeze-drops-move' && !COUNTER_FAULTS.includes(fault)) die(`--fault=${fault}: the declared faults are freeze-drops-move, ${COUNTER_FAULTS.join(', ')}`);
const counterFault = COUNTER_FAULTS.includes(fault) ? fault : null;
const expect = flag('expect', sabotage ? 'gate-fail' : fault ? 'fail' : 'pass');
if (!['pass', 'gate-fail', 'bound-fail', 'seam-fail', 'fail'].includes(expect)) die(`--expect=${expect}`);
if (args.includes('--list')) { for (const s of SPECS.filter((x) => specSel.includes(x.name))) console.log(`${s.name}\t${s.kind}\t${s.desc}`); process.exit(0); }
if (mesenUnavailable()) die(`Mesen is unavailable: ${mesenUnavailable()}`);

const out = (l) => console.log(l);
const label = `s1b-${sabotage ? `sab-${sabotage}-` : ''}${fault ? `fault-${fault}-` : ''}${cell.id}-${gt}-${placement}${flag('specs') ? '-sel' : ''}${flag('emu') ? `-${flag('emu')}` : ''}`;

// ---- N/A: a banked dialogue placement does not exist on an action ring. Proven from the SAME predicate the build uses (streamworldDialogueBanked, called on the
// patched tree's own normalized project): an action project has no battle bank, so the predicate is false whatever the text volume. The scene carrying 3,000 characters
// of never-reached text (what forces an RPG's overlay into its battle bank) is built, and its capacity verdict reported: resident or refused, never banked.
if (placement === 'banked' && gt === 'action') {
  const tree = makeTree({ ring: true });
  const info = await prepareRing({ cellId: cell.id, gt, sizes: SIZES, wide: true, bulk: BULK, tree, n: 4 });
  const base = pathToFileURL(tree.root).href;
  const sp = await import(`${base}/main/build/streamplacement.js`), sh = await import(`${base}/shared/project.js`), gen = await import(`${base}/main/build/generate.js`), cart = await import(`${base}/shared/cartridge.js`);
  const { buildSceneProject } = await import(pathToFileURL(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../sw_manifest_scene.mjs')).href);
  const { project } = { project: (await buildSceneProject({ root: tree.root, gt, sizes: SIZES, wide: true, ring: info.ring })).project };
  const mapper = cart.resolveMapper(project.cartridge.mapper);
  const bank = sh.battleBankEnabled(project, mapper), banked = sp.streamworldDialogueBanked(project, mapper);
  const cap = gen.checkCapacity(project).problems.filter((p) => p.severity === 'error').map((p) => p.message.split('\n')[0].slice(0, 120));
  if (bank !== false || banked !== false) die(`the action scene reports battleBankEnabled=${bank}, streamworldDialogueBanked=${banked}: the N/A proof is void`, 1);
  out(`${cell.id} action banked  N/A  an action project cannot place the dialogue overlay in a battle bank: battleBankEnabled(project, ${project.cartridge.mapper}) = false, hence streamworldDialogueBanked = false (main/build/streamplacement.js:639) for the scene carrying ${BULK} characters of text; its capacity check ${cap.length ? `refuses it (${cap[0]})` : 'admits it with the overlay resident'}`);
  info.dispose(); fs.rmSync(tree.root, { recursive: true, force: true });
  process.exit(0);
}

// ---- a private HOME for every Mesen process (never the user's ~/.config/Mesen2): settings copied, an empty save directory (ringhome.mjs). The witness builder always starts a
// Mesen session (the Lua template is what renders the phase script), so even a jsnes-only run needs it; EVERY spawn of the run (a Move scene's calibration included) takes its hooks from it.
const savesBefore = userSavesSnapshot();
const iso = openIsolatedHome();
const { home, loaded } = iso;
const mesenCtx = iso.ctx;

const tree = makeTree({ ring: true, extra: sabotage ? [sabotage] : [] });
const provDir = flag('prov-dir');
const links = { result: flag('json') ? path.resolve(flag('json')) : null, log: flag('log') ? path.resolve(flag('log')) : null };
const provPath = writeAttempt(provDir, label, {
  kind: 's1b-witness', cell: cell.id, gameType: gt, placement, sabotage: sabotage ?? null, fault: fault ?? null, specs: specSel, links,
  head: tree.head, trackedStatus: tree.status, baseline: tree.baseline, patches: tree.patches, harness: harnessFingerprint(), nesasm: nesasmStamp(), host: hostStamp()
});
let items = [], perSpec = [], cellInfo = null, bound = null;
const sweepCache = new Map();
const costBySpec = {};
try {
  cellInfo = await prepareRing({ cellId: cell.id, gt, sizes: SIZES, wide: true, bulk: placement === 'banked' ? BULK : 0, tree, n: flag('n') ? Number(flag('n')) : null, scene: { nosfx: false } });
  const { ring, n } = cellInfo.ring;
  out(`${cell.id} ${gt} ${placement}: N=${n} (${n === 255 ? 'the 255-screen NO_SCREEN ceiling' : 'the deepest world the capacity check admits with this workload'}), specs ${specSel.join(',')}`);
  for (const spec0 of SPECS.filter((s) => specSel.includes(s.name))) {
    const spec = { ...spec0 };
    if (typeof spec.script === 'function') spec.script = spec.script(cellInfo.ring);
    const frames = [];
    const t0 = Date.now();
    // a bound-tile project holds one more (ordinary) screen, so the deepest admitted world is re-derived by the capacity check for THAT project
    let ci = cellInfo;
    if (spec.ringExtra) ci = await prepareRing({ cellId: cell.id, gt, sizes: spec.sizes ?? SIZES, wide: true, tree, n: cellInfo.ring.n, bulk: cellInfo.ring.bulk, scene: { nosfx: false }, ...spec.ringExtra });
    if (spec.bound) { ci = await prepareRing({ cellId: cell.id, gt, sizes: spec.sizes, wide: true, tree, bulk: cellInfo.ring.bulk, scene: { nosfx: false, mutate: makeMutate({ bound: true }) } }); out(`  (${spec.name}: the bound-tile project admits N=${ci.ring.n})`); }
    const gridW = ci.ring.ring === 1 ? ci.ring.n : 1, gridH = ci.ring.ring === 1 ? 1 : ci.ring.n;
    const r = await runWitness({ cellInfo: ci, gt, spec, mesen: undefined, withJsnes: emus.includes('jsnes'), mesenCtx, counterFault, sweepCache, onFrame: (nes, f, ph, ram, sc) => frames.push(decodeFrame(nes, f, ph, ram, spec.terrain ? { distinct: true, ring: ci.ring.ring, project: sc.sceneProject, gridW, gridH } : null, frames[frames.length - 1] ?? null)) });
    costBySpec[spec.name] = { sweep: sweepCache.get(r.sweepKey), proj: sweepCache.get(r.projKey) };
    if (!emus.includes('mesen')) r.mesen.rows = [];
    // a fault injection: the generic frozen-state classifier that drops every body in which game_state != 0 (a Move/Wait body runs INSIDE ST_DIALOG)
    if (fault === 'freeze-drops-move') for (const e of ['mesen', 'jsnes']) if (r[e]) r[e].rows = r[e].rows.filter((row) => row.gs === 0);
    const seams = emus.includes('jsnes') && !spec0.noSeam ? decodeSeams(frames, { ring: ci.ring.ring, screens: r.sceneScreens, gridW, gridH }) : null;
    if (seams) seams.binding = bindCrossings(seams.crossings, r.jsnes?.rows ?? [], { ring: ci.ring.ring });
    perSpec.push({ name: spec.name, mesen: emus.includes('mesen') ? r.mesen : null, jsnes: r.jsnes, dlgSingle: r.dlgSingle, hasKnock: r.hasKnock, seams, script: r.script, distinctTerrain: !!spec.terrain, romSha256: r.romSha256, consts: r.consts, spec: { name: spec.name, kind: spec.kind, desc: spec0.desc } });
    out(`  ${spec.name.padEnd(9)} ${((Date.now() - t0) / 1000).toFixed(1)}s mesen ${r.mesen.rows.length} bodies (exit ${r.mesen.status}) jsnes ${r.jsnes?.rows.length ?? '-'} bodies, ${seams ? seams.crossings.length : '-'} crossings decoded, ROM ${r.romSha256.slice(0, 12)}`);
  }
  const consts = perSpec[0]?.consts ?? {};
  const jctx = { cell, gt, ring, n, placement, emus, consts, mapper: cellInfo.ring.mapper, cost: { sweeps: Object.values(costBySpec).map((c) => c.sweep).filter(Boolean), bySpec: costBySpec } };
  items = judgeCell({ perSpec, ctx: jctx });
  bound = jctx.boundOut ?? null;
} catch (e) {
  finishAttempt(provPath, 'error', { error: { firstLine: String(e.message).split('\n')[0], message: String(e.stack ?? e.message).slice(0, 4000) } });
  console.error(`run_s1b: ${e.stack ?? e.message}`);
  cellInfo?.dispose?.(); fs.rmSync(tree.root, { recursive: true, force: true }); iso.dispose();
  process.exit(2);
}

// ---- report
const pad = (s, k) => String(s).padEnd(k);
for (const i of items) out(`${pad(i.status, 10)} ${pad(i.emu, 6)} ${pad(i.id, 26)} ${i.detail}`);
const counts = summary(items);
out(`${cell.id} ${gt} ${placement}: ${items.length} items: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
// the declared gate-fail outcome of a padding sabotage: at least one completed, non-C0 mainline body whose G the NUMERICAL threshold refuses, in an operationally sound run
// (an overrun diagnostic or a failed run is never a control success: s1bjudge.gateFailControl)
const gateCtl = gateFailControl(items, perSpec);
const gateFailed = gateCtl.ok;
const anyFail = items.some((i) => i.status === 'FAIL' || i.status === 'UNMEASURED');
let verdictOk;
if (expect === 'pass') verdictOk = !anyFail;
else if (expect === 'gate-fail') verdictOk = gateFailed && (sabotage !== undefined);
// the bound-fail outcome of an UNDER-pad, named SAMPLED ESTIMATE REFUSAL (s1bjudge.estimateRefusal): the measured gate passes (no numerical G failure, no operational failure), a class estimate reaching or exceeding
// 29,780 alone refuses, and every other item is PASS, N/A or one of the declared uncertified items (bound:*, agree:dsp, agree:chase). There is no tolerance for any other failing item (the round-3 baselineRed tolerance
// was rejected by the reviewer's triage). It does not prove a class bound: the estimate's remainder, entity draw and NMI are sampled maxima.
else if (expect === 'bound-fail') verdictOk = sabotage !== undefined && estimateRefusal(items, gateCtl, bound).ok;
// the seam-fail outcome of a seam sabotage: at least one seam:* item FAILS (a decode failure of the crossing, scroll, terrain or binding), in an operationally sound run
else if (expect === 'seam-fail') verdictOk = sabotage !== undefined && items.some((i) => i.id.startsWith('seam:') && i.status === 'FAIL');
// a COUNTER fault (a deliberately wrong executed-path hook) is caught only by the transaction arithmetic / required evidence of finding 4 (the sanity:* items), never by a coincidental failure elsewhere
else if (counterFault) verdictOk = items.some((i) => /^sanity:(relationships|evidence)$/.test(i.id) && (i.status === 'FAIL' || i.status === 'UNMEASURED'));
else verdictOk = anyFail;
// the Mesen invocations the run actually made (calibration sessions included), against the ones it planned: a missing, unplanned, unisolated or failed one is a hard error
const chain = iso.chain();
const specsRun = SPECS.filter((x) => specSel.includes(x.name));
const plannedInv = specsRun.flatMap(plannedInvocations);
const chainProblems = auditChain(chain, plannedInv);
if (chainProblems.length) { console.error(`run_s1b: the Mesen invocation chain is unsound:\n  ${chainProblems.join('\n  ')}`); finishAttempt(provPath, 'error', { error: { firstLine: 'Mesen invocation chain unsound', message: chainProblems.join('; ') } }); process.exit(2); }
const savesAfter = userSavesSnapshot();
const untouched = JSON.stringify(savesBefore) === JSON.stringify(savesAfter);
if (!untouched) { console.error('run_s1b: the user\'s own Mesen save directory CHANGED during the run'); process.exit(2); }
const result = { label, cell: cell.id, gameType: gt, placement, n: cellInfo.ring.n, sabotage: sabotage ?? null, fault: fault ?? null, expect, verdictOk, gateFailed, gateFailures: gateCtl.numeric.length, operationalFailures: gateCtl.operational, items, counts, bound,
  perSpec: perSpec.map((s) => ({ name: s.name, romSha256: s.romSha256, dlgSingle: s.dlgSingle, hasKnock: s.hasKnock, seams: s.seams, classes: Object.fromEntries(emus.map((e) => [e, Object.fromEntries(Object.entries(perClass((s[e]?.rows ?? []).map((r) => ({ ...r, spec: s.name })))).map(([c, k]) => [c, { n: k.n, maxG: k.maxG, gateFail: k.gateFail, ovr: k.ovr, max: k.max, top: k.top ? { frame: k.top.frame, G: k.top.G, cyc: k.top.cyc, counters: k.top.counters, state: k.top.state } : null }]))])) })),
  classes: Object.fromEntries(emus.map((e) => [e, Object.fromEntries(Object.entries(perClass(allRows(perSpec, e))).map(([c, k]) => [c, { n: k.n, maxG: k.maxG, gateFail: k.gateFail, ovr: k.ovr, at29780: k.at, max: k.max, top: k.top ? { spec: k.top.spec, frame: k.top.frame, G: k.top.G, counters: k.top.counters, state: k.top.state, terms: k.top.terms } : null }]))])) };
// retained evidence (round 2 findings 1 and 4): every body of both emulators and the swept read-cost matrices, gzipped next to the result and linked by SHA-256, so the report's numbers regenerate from them
// the plan-2.2 reconciliation inputs and every body within NEAR cycles of the gate (C0 included, marked), by name, from the retained records
result.recon = reconcile(perSpec);
result.near = emus.includes('mesen') ? allRows(perSpec, 'mesen').filter((r) => Number.isFinite(r.G) && Math.abs(r.G - GATE) <= NEAR).map((r) => ({ at: `${r.spec}@${r.frame}`, cls: r.cls, G: r.G, allowed: gateAllows(r.G), exempt: r.cls === 'C0' })) : [];
result.retained = {};
if (links.result) {
  const keep = (suffix, obj) => { const f = `${links.result}.${suffix}.json.gz`; const buf = zlib.gzipSync(JSON.stringify(obj)); fs.writeFileSync(f, buf); result.retained[suffix] = { file: path.basename(f), sha256: sha256(buf), bytes: buf.length }; };
  keep('bodies', perSpec.map((sp) => ({ name: sp.name, romSha256: sp.romSha256, mesen: sp.mesen?.rows ?? null, jsnes: sp.jsnes?.rows ?? null })));
  const uniq = [...new Map(Object.values(costBySpec).filter((c) => c.sweep).map((c) => [c.sweep.key, c.sweep])).values()];
  keep('sweeps', { reads: uniq.map((w) => ({ key: w.key, ...sweepSummary(w), peek: [...w.peek], peekHi: [...w.peekHi], goto: [...w.goto], loc: [...w.loc], gotoLo: [...w.gotoLo], locLo: [...w.locLo] })), projection: Object.values(costBySpec).map((c) => c.proj).filter(Boolean).filter((p, i, a) => a.findIndex((q) => q.key === p.key) === i) });
}
if (links.result) fs.writeFileSync(links.result, JSON.stringify(result, null, 1));
if (provPath) {
  const stamps = mesenStamp(MESEN, [...loaded], [...loaded].sort().map((p) => fileStamp(p)).filter(Boolean).map((f) => ({ ...f, path: f.path.startsWith(home) ? `<isolated-HOME>${f.path.slice(home.length)}` : f.path })));
  const planned = { cell: cell.id, gameType: gt, placement, n: result.n, specs: perSpec.map((s) => ({ name: s.name, kind: s.spec.kind, romSha256: s.romSha256, invocations: plannedInvocations(specsRun.find((x) => x.name === s.name)).map((i) => i.purpose) })) };
  finishAttempt(provPath, 'built', {
    romSha256: sha256(JSON.stringify(planned)), projectSha256: sha256(JSON.stringify(perSpec.map((s) => s.romSha256))),
    plan: { ...planned, sha256: sha256(JSON.stringify(planned)) }, counts, expect, verdictOk, gateFailed, gateFailures: gateCtl.numeric.length, operationalFailures: gateCtl.operational.length, sabotage: sabotage ?? null, fault: fault ?? null,
    retained: result.retained, emulators: { mesen: stamps, jsnes: jsnesStamp() }, mesenChain: chain, userSavesUntouched: untouched,
    results: [{ scene: label, emu: emus.join('+'), counts, expect, verdictOk, gateFailed, mesenInvocations: chain.length, userSavesUntouched: untouched, emulatorStamp: stamps }]
  });
}
cellInfo.dispose(); fs.rmSync(tree.root, { recursive: true, force: true }); iso.dispose();
if (expect === 'pass') { out(anyFail ? `${cell.id} ${gt} ${placement}: S1b FAIL` : `${cell.id} ${gt} ${placement}: S1b all pass (${items.length} items, ${counts['N/A'] ?? 0} N/A)`); process.exit(anyFail ? 1 : 0); }
out(`${sabotage ? `sabotage ${sabotage}` : `fault ${fault}`} (expect ${expect}): ${verdictOk ? (expect === 'seam-fail' ? 'CAUGHT: a seam item failed as declared' : expect === 'bound-fail' ? 'CAUGHT: sampled estimate refusal -- the measured gate passed and the class estimate alone refused, as declared' : (counterFault ? 'CAUGHT: the transaction arithmetic / required evidence failed as declared' : 'CAUGHT: the gate verdict failed as declared')) : 'NOT CAUGHT: the verdict did not fail'} (numerical G failures: ${gateCtl.numeric.length}${gateCtl.numeric[0] ? `, first ${gateCtl.numeric[0].spec}@${gateCtl.numeric[0].frame} ${gateCtl.numeric[0].cls} G=${gateCtl.numeric[0].G}` : ''}; operational failures: ${gateCtl.operational.length}; all failing items: ${items.filter((i) => i.status === 'FAIL').length})`);
process.exit(verdictOk ? 0 : 1);
