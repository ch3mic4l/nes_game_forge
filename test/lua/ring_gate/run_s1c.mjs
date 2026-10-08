#!/usr/bin/env node
// Phase 3b S1c rows 5 (NMI strip deadline), 6 (the text-box close) and 8 (the MMC3 split/lock) for ONE cell x game type x dialogue placement, on Mesen's cycle-accurate core
// (a ring-patched copy of the shipped engine: ringtree.mjs makeTree). A positive run must PASS every item; a --control run mutates the scene as s1ccontrols.mjs declares and is
// judged against the DECLARED outcome for that cell: CAUGHT (every named item FAILS, in an operationally sound run) or PASS (a patch that does not reach this axis).
//   node test/lua/ring_gate/run_s1c.mjs --row=5|6|8 --cell=MMC1-V --gt=action|rpg [--placement=resident|banked] [--control=<id>] [--prov-dir=<dir>] [--json=f] [--log=f] [--list]
// Exit 0 = the declared outcome was met; 1 = it was not (a positive with a FAIL/UNMEASURED item, a control not caught, or caught by an item it does not name); 2 = an error.
import fs from 'node:fs';
import os from 'node:os';
import zlib from 'node:zlib';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { makeTree, sha256 } from './ringtree.mjs';
import { CELLS, GAME_TYPES, ringProject } from './ringworld.mjs';
import { openIsolatedHome, auditChain } from './ringhome.mjs';
import { MESEN, mesenUnavailable, userSavesSnapshot } from './ringrun_mesen.mjs';
import { harnessFingerprint, writeAttempt, finishAttempt, nesasmStamp, hostStamp, mesenStamp, fileStamp, projectSha256 } from './ringprov.mjs';
import { buildNmiRing, spawnMesen, parseNmiOutput, judgeNmi } from './ringnmi.mjs';
import { buildCloseRing, parseCloseOutput, judgeClose } from './ringclose.mjs';
import { buildSplitRing, parseSplitOutput, judgeSplit } from './ringsplit.mjs';
import { CONTROLS, declaredFor, controlFlags, positiveLabel, controlLabel, SLICE } from './s1ccontrols.mjs';

const BULK = 3000;
// Why rows 5/6/8 are N/A on jsnes (round 2, finding 4). Mesen's Lua callbacks (execute / write / masterClock / PPU position) are the authoritative deadline and split measurement; this slice
// has NO jsnes timing recorder, so nothing about jsnes is measured here. No claim is made that a jsnes measurement is impossible.
const JSNES_NA_BASE = 'not measured: this slice has no jsnes timing recorder; Mesen (its Lua execute/write callbacks with the master clock and PPU position) is the authoritative measurement';
const JSNES_NA = {
  5: `${JSNES_NA_BASE}. The vendored core does track the PPU at dot granularity (ppu.advanceDots, dot-level vblank events), so a recorder is possible in principle, but none exists here and its agreement with Mesen would itself need certifying`,
  6: `${JSNES_NA_BASE}. The close-frame deadline is a Mesen cycle measurement; a jsnes recorder is possible in principle but does not exist in this slice`,
  8: `${JSNES_NA_BASE}. In addition the vendored core clocks its MMC3 IRQ counter at scanline boundaries (clockIrqCounter in renderer/emulator/core/ppu/index.js), not on A12 edges, so the split IRQ line and the register-write timing are an approximation there; Mesen is the authoritative split measurement`
};
const args = process.argv.slice(2);
const flag = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const die = (msg, code = 2) => { console.error(`run_s1c: ${msg}`); process.exit(code); };
const known = ['row', 'cell', 'gt', 'placement', 'control', 'prov-dir', 'json', 'log'];
for (const a of args) if (a !== '--list' && !known.some((k) => a.startsWith(`--${k}=`))) die(`unknown argument ${a}`);
const row = Number(flag('row'));
if (![5, 6, 8].includes(row)) die(`--row=${flag('row')} is not 5|6|8`);
const cellId = flag('cell'), gt = flag('gt', 'action'), placement = flag('placement', 'resident'), controlId = flag('control');
const cell = CELLS.find((c) => c.id === cellId) ?? die(`--cell=${cellId} is not one of ${CELLS.map((c) => c.id).join(', ')}`);
if (!GAME_TYPES.includes(gt)) die(`--gt=${gt} is not one of ${GAME_TYPES.join(', ')}`);
if (!['resident', 'banked'].includes(placement)) die(`--placement=${placement}`);
if (controlId !== undefined && !(controlId in CONTROLS)) die(`--control=${controlId} is not a declared control (s1ccontrols.mjs)`);
if (controlId !== undefined && CONTROLS[controlId].row !== row) die(`--control=${controlId} targets row ${CONTROLS[controlId].row}, not ${row}`);
if (args.includes('--list')) { for (const [id, c] of Object.entries(CONTROLS)) if (c.row === row) console.log(`${id}\t${c.kind}\t${c.what}`); process.exit(0); }
if (mesenUnavailable()) die(`Mesen is unavailable: ${mesenUnavailable()}`);
const out = (l) => console.log(l);
const label = controlId ? controlLabel(controlId, cell.id, gt, placement) : positiveLabel(row, cell.id, gt, placement);

// ---- N/A: a banked dialogue placement does not exist on an action ring. Proven from the SAME predicate the build uses (streamworldDialogueBanked, on the patched tree's own
// modules): an action project has no battle bank, so it is false whatever the text volume. The scene carrying 3,000 characters of never-reached text (what forces an RPG's overlay
// into its battle bank) is built, and the capacity verdict reported: resident or refused, never banked.
if (placement === 'banked' && gt === 'action') {
  const tree = makeTree({ ring: true });
  const base = pathToFileURL(tree.root).href;
  const sp = await import(`${base}/main/build/streamplacement.js`), sh = await import(`${base}/shared/project.js`), gen = await import(`${base}/main/build/generate.js`), cart = await import(`${base}/shared/cartridge.js`);
  const { project } = ringProject({ cell, gameType: 'action', n: 4, talkers: 'none', start: { screen: 0, x: 120, y: 120 }, bulkText: BULK });
  const mapper = cart.resolveMapper(project.cartridge.mapper);
  const bank = sh.battleBankEnabled(project, mapper), banked = sp.streamworldDialogueBanked(project, mapper);
  const cap = gen.checkCapacity(project).problems.filter((p) => p.severity === 'error').map((p) => p.message.split('\n')[0].slice(0, 120));
  fs.rmSync(tree.root, { recursive: true, force: true });
  if (bank !== false || banked !== false) die(`the action scene reports battleBankEnabled=${bank}, streamworldDialogueBanked=${banked}: the N/A proof is void`, 1);
  out(`${cell.id} action banked  N/A  row ${row}: an action project cannot place the dialogue overlay in a battle bank: battleBankEnabled(project, ${project.cartridge.mapper}) = false, hence streamworldDialogueBanked = false (main/build/streamplacement.js) for the scene carrying ${BULK} characters of text; its capacity check ${cap.length ? `refuses it (${cap[0]})` : 'admits it with the overlay resident'}`);
  process.exit(0);
}
if (row === 8 && !cell.id.startsWith('MMC3')) {
  out(`${cell.id} ${gt} ${placement}  N/A  row 8 applies to the MMC3 cells only: the split/lock (engine/split.asm, MMC3's scanline IRQ) is assembled only when MMC3_SPLIT is set, and ${cell.id} is ${cell.mapper}`);
  process.exit(0);
}

const declared = controlId ? declaredFor(controlId, cell.ring) : { outcome: 'pass-all' };
const flags = controlId ? controlFlags(controlId) : { sabotage: null, mutation: null, breakMode: null, split: null };
const savesBefore = userSavesSnapshot();
const iso = openIsolatedHome();
const { home, loaded } = iso;
const tree = makeTree({ ring: true, extra: flags.sabotage ? [flags.sabotage] : [] });
const provDir = flag('prov-dir');
const links = { result: flag('json') ? path.resolve(flag('json')) : null, log: flag('log') ? path.resolve(flag('log')) : null, raw: flag('json') ? path.resolve(flag('json')).replace(/\.json$/, '.raw.gz') : null };
const provPath = writeAttempt(provDir, label, {
  kind: 's1c-run', row, cell: cell.id, gameType: gt, placement, control: controlId ?? null, declared, links,
  head: tree.head, trackedStatus: tree.status, baseline: tree.baseline, patches: tree.patches, harness: harnessFingerprint(), nesasm: nesasmStamp(), host: hostStamp()
});
const PURPOSE = { 5: 'row5-nmi', 6: 'row6-close', 8: 'row8-split' }[row];
let built = null, items = [], run = null, parsed = null;
const cleanup = () => { built?.dispose?.(); fs.rmSync(tree.root, { recursive: true, force: true }); iso.dispose(); };
try {
  if (row === 5) {
    built = await buildNmiRing({ cell, gt, placement, sabotage: flags.sabotage, mutation: flags.mutation, breakMode: flags.breakMode, label, tree });
    run = await spawnMesen(built.luaPath, built.romPath, iso.ctx, { purpose: PURPOSE });
    parsed = parseNmiOutput(run.stdout);
    items = judgeNmi(parsed, { ring: built.ring, tiles: built.tiles, palFx: built.palFx, cases: built.cases, cover: built.cover, wcet: built.wcet });
    items.unshift({ id: 'run:exit', status: run.status === 0 ? 'PASS' : 'FAIL', detail: run.status === 0 ? 'Mesen exited 0 (every case ran to its end)' : `Mesen exited ${run.status}: ${(/^ERROR (.*)$/m.exec(run.stdout) ?? [])[1] ?? run.stderr}` });
  } else if (row === 6) {
    built = await buildCloseRing({ cell, gt, placement, sabotage: flags.sabotage, mutation: flags.mutation, breakMode: flags.breakMode, label, tree });
    run = await spawnMesen(built.luaPath, built.romPath, iso.ctx, { purpose: PURPOSE });
    parsed = parseCloseOutput(run.stdout, run.status);
    items = judgeClose(parsed, { ring: built.ring, struct: built.struct });
  } else {
    built = await buildSplitRing({ cell, gt, placement, sabotage: flags.split, label, tree });
    run = await spawnMesen(built.luaPath, built.romPath, iso.ctx, { purpose: PURPOSE });
    parsed = parseSplitOutput(run.stdout);
    items = judgeSplit(parsed, built.ctx);
    items.unshift({ id: 'run:exit', status: run.status === 0 ? 'PASS' : 'FAIL', detail: run.status === 0 ? 'Mesen exited 0 (every planned trial ran)' : `Mesen exited ${run.status}: ${(/^ERROR (.*)$/m.exec(run.stdout) ?? [])[1] ?? run.stderr}` });
  }
} catch (e) {
  finishAttempt(provPath, 'error', { error: { firstLine: String(e.message).split('\n')[0], message: String(e.stack ?? e.message).slice(0, 4000) } });
  console.error(`run_s1c: ${e.stack ?? e.message}`);
  cleanup();
  process.exit(2);
}

// ---- report and verdict
const pad = (s, k) => String(s).padEnd(k);
for (const i of items) out(`${pad(i.status, 10)} ${pad(i.id, 18)} ${i.detail}`);
const counts = items.reduce((a, i) => ({ ...a, [i.status]: (a[i.status] ?? 0) + 1 }), {});
out(`row ${row} ${cell.id} ${gt} ${placement}${controlId ? ` control ${controlId}` : ''}: ${items.length} items: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
const failed = items.filter((i) => i.status === 'FAIL').map((i) => i.id);
const unsound = items.filter((i) => ['run:exit', 'run:complete', 'run:operational', 'r8:run'].includes(i.id) && i.status !== 'PASS');
const anyBad = items.some((i) => i.status === 'FAIL' || i.status === 'UNMEASURED');
let verdictOk, verdictLine;
if (!controlId) {
  verdictOk = !anyBad;
  verdictLine = anyBad ? `${cell.id} ${gt} ${placement}: S1c row ${row} FAIL` : `${cell.id} ${gt} ${placement}: S1c row ${row} all pass (${items.length} items)`;
} else if (declared.outcome === 'pass') {
  verdictOk = !anyBad;
  verdictLine = `control ${controlId} (${cell.id} ${gt} ${placement}): ${verdictOk ? 'PASS as declared' : 'DID NOT PASS, declared pass'} (${declared.why})`;
} else {
  const missing = declared.mustFail.filter((id) => !failed.includes(id));
  verdictOk = unsound.length === 0 && missing.length === 0;
  const extra = failed.filter((id) => !declared.mustFail.includes(id));
  verdictLine = `control ${controlId} (${cell.id} ${gt} ${placement}): ${verdictOk ? 'CAUGHT as declared' : unsound.length ? 'NOT CAUGHT: the run itself was unsound' : 'NOT CAUGHT'} (declared items ${declared.mustFail.join(', ')}; failed: ${failed.join(', ') || 'none'}${missing.length ? `; NOT failed: ${missing.join(', ')}` : ''}${extra.length ? `; also failed: ${extra.join(', ')}` : ''})`;
}
out(verdictLine);

// ---- the Mesen invocation chain, the user's saves, the stamp
const chain = iso.chain();
const statusOk = controlId ? [0, 5, 7, 8, 9] : [0];
const chainProblems = auditChain(chain, [{ spec: PURPOSE, purpose: PURPOSE }], { statusOk });
if (chainProblems.length) { console.error(`run_s1c: the Mesen invocation chain is unsound:\n  ${chainProblems.join('\n  ')}`); finishAttempt(provPath, 'error', { error: { firstLine: 'Mesen invocation chain unsound', message: chainProblems.join('; ') } }); cleanup(); process.exit(2); }
const savesAfter = userSavesSnapshot();
const untouched = JSON.stringify(savesBefore) === JSON.stringify(savesAfter);
if (!untouched) { console.error('run_s1c: the user\'s own Mesen save directory CHANGED during the run'); cleanup(); process.exit(2); }
const result = { label, row, cell: cell.id, gameType: gt, placement, control: controlId ?? null, declared, verdictOk, items, counts, failed, mesenStatus: run.status, romSha256: built.romSha256, luaSha256: built.luaSha256 };
if (links.result) fs.writeFileSync(links.result, JSON.stringify(result, null, 1));
// the recorder's raw output (what Mesen printed) is retained beside the result, gzipped and hashed in the stamp: the judged items are a function of it, so an auditor can re-judge or inspect it
let retainedRaw = null;
if (links.raw) { const gz = zlib.gzipSync(Buffer.from(String(run.stdout ?? ''), 'utf8'), { level: 9, mtime: 0 }); fs.writeFileSync(links.raw, gz); retainedRaw = { sha256: sha256(gz), bytes: gz.length, stdoutBytes: String(run.stdout ?? '').length }; }
if (provPath) {
  const stamps = mesenStamp(MESEN, [...loaded], [...loaded].sort().map((p) => fileStamp(p)).filter(Boolean).map((f) => ({ ...f, path: f.path.startsWith(home) ? `<isolated-HOME>${f.path.slice(home.length)}` : f.path })));
  const planned = { row, cell: cell.id, gameType: gt, placement, control: controlId ?? null, purpose: PURPOSE, romSha256: built.romSha256, luaSha256: built.luaSha256 };
  finishAttempt(provPath, 'built', {
    romSha256: built.romSha256, luaSha256: built.luaSha256, projectSha256: projectSha256(built.built.project), plan: { ...planned, sha256: sha256(JSON.stringify(planned)) },
    build: { streamRing: built.built.prov.streamRing, placement: built.built.prov.placement, resources: built.built.prov.resources, header: built.built.prov.header },
    counts, failed, verdictOk, mesenStatus: run.status, slice: SLICE, retained: { raw: retainedRaw },
    matchingPositive: controlId ? positiveLabel(row, cell.id, gt, placement) : null,
    emulators: { mesen: stamps, jsnes: { na: JSNES_NA[row] } },
    mesenChain: chain, userSavesUntouched: untouched,
    results: [{ scene: label, emu: 'mesen', counts, verdictOk, mesenInvocations: chain.length, userSavesUntouched: untouched, emulatorStamp: stamps }]
  });
}
cleanup();
process.exit(verdictOk ? 0 : 1);
