#!/usr/bin/env node
// The coverage campaign runner (handoff-next/phase3b-s1a-coverage.md): builds every admitted (cell x game type x scene x placement), runs it in
// jsnes and/or Mesen, and judges it with the SAME verdicts as run_oracle (vram per record, coverage incl. the exact record sequence and the
// scene's required witness identities). N/A pairs are printed with their source reason, never skipped.
//   node test/lua/ring_gate/run_campaign.mjs [--cell=...] [--ring=1|2] [--gt=action,rpg] [--scene=sw-N5,...] [--placement=resident,banked]
//        [--emu=jsnes|mesen|both] [--sabotage=<name>] [--expect=vram|coverage|any] [--prov-dir=<dir>] [--json=f] [--log=f] [--list] [--verbose]
// Exit 0 = every selected, applicable row passes both verdicts; 1 = a FAIL (or, with --sabotage, a NOT CAUGHT row) or an UNMEASURED row (a requested
// emulator the scene registry does not run: printed with its reason, never dropped); 2 = any error (build, run, placement, selection). Errors outrank failures. With --sabotage the run EXPECTS every executed row to fail the --expect verdict.
import fs from 'node:fs';
import path from 'node:path';
import { makeTree } from './ringtree.mjs';
import { CELLS, GAME_TYPES, ringProject, buildCell } from './ringworld.mjs';
import { scenesFor, ALL_SCENE_IDS } from './ringcampaign.mjs';
import { bootRom, runSteps } from './ringrun_jsnes.mjs';
import { checkAddresses } from './ringaddr.mjs';
import { judge, judgeCoverage } from './ringjudge.mjs';
import { runMesen, MESEN, mesenUnavailable } from './ringrun_mesen.mjs';
import { observedWitnessRecords } from './ringwitness.mjs';
import { jsnesStamp, mesenStamp, stampResult, projectSha256 } from './ringprov.mjs';
import { sha256 } from './ringtree.mjs';
import { IDENTITY_OUTCOME } from './ringsabotage.mjs';

const BULK = 3000;
const args = process.argv.slice(2);
const flag = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const die = (msg) => { console.error(`run_campaign: ${msg}`); process.exit(2); };
const list = (name, valid, dflt) => {
  const raw = flag(name);
  if (raw === undefined) return dflt;
  const got = raw.split(',');
  if (!raw || got.some((g) => !valid.includes(g))) die(`--${name}=${raw} names nothing valid (valid: ${valid.join(', ')})`);
  return got;
};
const known = ['cell', 'ring', 'gt', 'scene', 'placement', 'emu', 'sabotage', 'expect', 'prov-dir', 'json', 'log', 'registry-emus'];
for (const a of args) if (a !== '--verbose' && a !== '--list' && !known.some((k) => a.startsWith(`--${k}=`))) die(`unknown argument ${a}`);
const sabotage = flag('sabotage');
if (sabotage !== undefined && !(sabotage in IDENTITY_OUTCOME)) die(`--sabotage=${sabotage} is not a declared sabotage (ringsabotage.mjs)`);
const expectVerdict = flag('expect', 'any');
if (!['any', 'vram', 'coverage'].includes(expectVerdict)) die(`--expect=${expectVerdict}`);
const emus = { jsnes: ['jsnes'], mesen: ['mesen'], both: ['jsnes', 'mesen'] }[flag('emu', 'jsnes')] ?? die(`--emu=${flag('emu')} is not jsnes|mesen|both`);
const ringSel = flag('ring') === undefined ? null : ['1', '2'].includes(flag('ring')) ? Number(flag('ring')) : die(`--ring=${flag('ring')} is not 1|2`);
const cellIds = list('cell', CELLS.map((c) => c.id), null);
const cells = CELLS.filter((c) => (!cellIds || cellIds.includes(c.id)) && (ringSel === null || c.ring === ringSel));
const gts = list('gt', GAME_TYPES, GAME_TYPES);
const sceneSel = list('scene', ALL_SCENE_IDS, ALL_SCENE_IDS);
const placements = list('placement', ['resident', 'banked'], ['resident', 'banked']);
if (!cells.length) die('the --cell/--ring selection matches no cell');
const verbose = args.includes('--verbose');
const provDir = flag('prov-dir');
const links = { result: flag('json') ? path.resolve(flag('json')) : null, log: flag('log') ? path.resolve(flag('log')) : null };

const plan = [];
// --registry-emus=<list> is a TEST HOOK: it narrows which emulators the registry says a scene runs in, so a control can prove a requested-but-unrunnable
// emulator prints as UNMEASURED (and fails the exit code) instead of vanishing
const registryEmus = list('registry-emus', ['jsnes', 'mesen'], null);
for (const cell of cells) for (const gameType of gts) for (const s of scenesFor(cell, gameType)) if (sceneSel.includes(s.id) && placements.includes(s.placement)) {
  plan.push({ cell, gameType, ...s, ...(registryEmus && s.emus ? { emus: s.emus.filter((e) => registryEmus.includes(e)), emuReasons: Object.fromEntries(['jsnes', 'mesen'].filter((e) => !registryEmus.includes(e)).map((e) => [e, `--registry-emus=${registryEmus.join(',')} withdrew ${e} from the registry`])) } : {}) });
}
if (!plan.length) die('the selection matches no scene');
if (args.includes('--list')) { for (const p of plan) console.log(`${p.cell.id} ${p.gameType} ${p.id} ${p.placement} N=${p.n} ${p.na ? 'N/A ' + p.na : `${p.scene.steps.length} steps, ${p.scene.expect.witnesses.length} witnesses`}`); process.exit(0); }

const tree = makeTree({ ring: true, extra: sabotage ? [sabotage] : [] });
const emuStamps = { jsnes: jsnesStamp() };
const rows = [];
for (const p of plan) {
  const { cell, gameType, scene } = p;
  const base = { cell: cell.id, gameType, scene: p.id, placement: p.placement, n: p.n };
  if (p.na) { rows.push({ ...base, emu: '-', na: p.na }); continue; }
  const banked = p.placement === 'banked';
  const { project, gridW, gridH } = ringProject({ cell, gameType, n: p.n, talkers: scene.world?.talkers ?? 'none', start: scene.start, bulkText: banked ? BULK : 0, mutate: scene.world?.mutate });
  const label = `${registryEmus ? 'reg-' + registryEmus.join('+') + '-' : ''}${sabotage ? `sab-${sabotage}${expectVerdict === 'any' ? '' : `-exp-${expectVerdict}`}-` : ''}${cell.id}-${gameType}-${p.placement}-${p.id}`;
  let built;
  try { built = await buildCell({ tree, project, cell, gameType, provDir, links, sabotage: sabotage ?? null, label, requestedPlacement: p.placement }); }
  catch (e) { rows.push({ ...base, emu: 'build', error: `build failed: ${e.message.split('\n')[0]}` }); if (e.provPath) stampResult(e.provPath, { ...base, error: e.message.split('\n')[0] }); continue; }
  if (banked) {
    const pl = built.prov.placement;
    if (pl.assembled !== 'switchable' || pl.generatedFlag !== 1) { rows.push({ ...base, emu: 'build', error: `placement: requested banked, flag ${pl.generatedFlag}, sw_dlg_single assembled ${pl.assembled}` }); stampResult(built.provPath, { ...base, error: 'placement disagreement' }); fs.rmSync(built.dir, { recursive: true, force: true }); continue; }
  }
  const addrBad = checkAddresses(built.symbols);
  if (addrBad.length) die(`transcribed RAM addresses disagree with the build: ${addrBad.join('; ')}`);
  const ctx = { project, ring: cell.ring, gridW, gridH, typing: scene.expect.typing };
  for (const emu of emus) {
    if (!p.emus.includes(emu) || (emu === 'mesen' && mesenUnavailable())) {
      // a requested emulator this scene cannot run is a row of its own, never a silent skip
      const why = p.emuReasons?.[emu] ?? (!p.emus.includes(emu) ? `the scene registry (ringcampaign.mjs scenesFor) does not run this scene in ${emu}` : `Mesen is unavailable: ${mesenUnavailable()}`);
      rows.push({ ...base, emu, unmeasured: why });
      stampResult(built.provPath, { ...base, emu, unmeasured: why });
      continue;
    }
    let recs;
    try { recs = emu === 'jsnes' ? runSteps(bootRom(built.romPath), scene.steps) : await runMesen(built.romPath, scene.steps); }
    catch (e) { rows.push({ ...base, emu, error: `run failed: ${e.message}` }); stampResult(built.provPath, { ...base, emu, error: `run failed: ${e.message}` }); continue; }
    const stampOf = emu === 'mesen' ? mesenStamp(MESEN, recs.loadedPaths ?? [], recs.loadedStamps ?? []) : emuStamps.jsnes;
    const verdicts = recs.map((r) => judge(r, ctx));
    const bad = verdicts.filter((v) => !v.ok);
    const cov = judgeCoverage(recs, scene.expect, ctx);
    const seen = observedWitnessRecords(recs, { ring: cell.ring, n: p.n });
    const row = { ...base, emu, checkpoints: recs.filter((r) => r.kind !== 'hold').length, vramOk: !bad.length, coverageOk: cov.ok,
      witnesses: { required: scene.expect.witnesses.length, observed: scene.expect.witnesses.filter((w) => seen.has(w)).length },
      vramFails: bad.slice(0, 3).map((v) => `${v.label}: ${v.fails.slice(0, 3).join(' | ')}`), coverageFails: cov.fails.slice(0, 6) };
    rows.push(row);
    // the planned definition (scene, steps, exact record sequence, required witnesses) and, per required witness, the FIRST record that observed it and the
    // state that made it so (null = never observed): the stamp says what the run was supposed to cover and where each piece of it was seen
    const planned = { sceneId: p.id, placement: p.placement, n: p.n, start: scene.start ?? null, talkers: scene.world?.talkers ?? 'none', steps: scene.steps, sequence: scene.expect.sequence, witnesses: scene.expect.witnesses };
    const plan = { ...planned, sha256: sha256(JSON.stringify(planned)), projectSha256: projectSha256(project) };
    const witnessMap = Object.fromEntries(scene.expect.witnesses.map((w) => [w, seen.get(w) ?? null]));
    stampResult(built.provPath, { ...base, emu, vramOk: row.vramOk, coverageOk: row.coverageOk, checkpoints: row.checkpoints, witnesses: row.witnesses, plan, witnessMap, emulatorStamp: stampOf, sabotage: sabotage ?? null,
      ...(emu === 'mesen' ? { mesenChain: recs.invocations, userSavesUntouched: recs.userSavesUntouched } : {}) });
    if (verbose) recs.forEach((r, i) => r.kind !== 'hold' && console.log('   ', verdicts[i].ok ? 'ok  ' : 'FAIL', r.label.padEnd(22), `scr=(${r.state.sw_col},${r.state.sw_row}) p=(${r.state.player_x},${r.state.player_y}) cam=(${r.state.cam_x_lo},${r.state.cam_y_lo}) nt=${r.state.cam_nt}`, verdicts[i].fails.join(' | ')));
  }
  fs.rmSync(built.dir, { recursive: true, force: true });
}
fs.rmSync(tree.root, { recursive: true, force: true });

const pad = (s, n) => String(s).padEnd(n);
const executed = rows.filter((r) => !r.error && !r.na && !r.unmeasured);
const unmeasured = rows.filter((r) => r.unmeasured);
const errors = rows.filter((r) => r.error);
const nas = rows.filter((r) => r.na);
for (const r of rows) {
  const id = `${pad(r.cell, 7)} ${pad(r.gameType, 6)} ${pad(r.scene, 9)} ${pad(r.placement, 8)} ${pad(r.emu, 6)}`;
  if (r.error) console.log(`${id} ERROR ${r.error}`);
  else if (r.unmeasured) console.log(`${id} UNMEASURED ${r.unmeasured}`);
  else if (r.na) console.log(`${id} N/A ${r.na}`);
  else console.log(`${id} vram=${r.vramOk ? 'PASS' : 'FAIL'} coverage=${r.coverageOk ? 'PASS' : 'FAIL'} (${r.checkpoints} checkpoints, witnesses ${r.witnesses.observed}/${r.witnesses.required})${r.vramOk ? '' : ' VRAM: ' + r.vramFails.join(' // ')}${r.coverageOk ? '' : ' COVERAGE: ' + r.coverageFails.join(' // ')}`);
}
if (flag('json')) fs.writeFileSync(flag('json'), JSON.stringify(rows, null, 1));
if (!executed.length && !errors.length) die('the selection executed zero rows (every selected scene is N/A)');
const verdictFails = (r) => ({ any: !r.vramOk || !r.coverageOk, vram: !r.vramOk, coverage: !r.coverageOk })[expectVerdict];
if (sabotage) {
  const missed = executed.filter((r) => !verdictFails(r));
  console.log(`sabotage ${sabotage} (expect ${expectVerdict}): ${executed.length - missed.length}/${executed.length} rows fail it, ${missed.length} NOT CAUGHT, ${nas.length} N/A, ${errors.length} unexpected errors, ${unmeasured.length} unmeasured`);
  process.exit(errors.length ? 2 : missed.length || unmeasured.length ? 1 : 0);
}
const failing = executed.filter((r) => !r.vramOk || !r.coverageOk).length;
console.log(`${executed.length} executed, ${failing} FAIL, ${errors.length} ERROR, ${nas.length} N/A, ${unmeasured.length} unmeasured`);
process.exit(errors.length ? 2 : failing || unmeasured.length ? 1 : 0);
