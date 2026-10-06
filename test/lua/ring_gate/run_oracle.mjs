#!/usr/bin/env node
// Row 3 -- the VRAM + attribute oracle, with a coverage verdict beside it. Builds ring cells, runs each scenario in jsnes and/or Mesen, and
// reports per row  vram=PASS|FAIL  coverage=PASS|FAIL  (dialogue=PASS|FAIL is the part of vram that judges the open box).
//   node test/lua/ring_gate/run_oracle.mjs [--cell=MMC1-V,...] [--ring=1|2] [--gt=action,rpg] [--talkers=none,enter] [--placement=resident,banked]
//        [--scenario=lap,seam0,seam1] [--emu=jsnes|mesen|both] [--sabotage=<name>] [--expect=vram|coverage|dialogue] [--prov-dir=<dir>] [--json=f]
//        [--log=<path>] [--verbose]
// Exit 0 = every selected row passes both verdicts. A selection that names nothing, an unknown value, or that executes zero rows is an ERROR
// (exit 2), never "all pass". With --sabotage the run EXPECTS failure: exit 0 only if every executed row fails the --expect verdict (default
// any), exit 1 if some row was not caught, exit 2 on an unexpected build/run error (an error is not a catch; errors outrank every other verdict).
// A (sabotage, cell) combination predeclared unbuildable from source (ringsabotage.mjs) must fail to build with the declared message: that row is
// 'witnessed N/A', neither a catch nor an error; a build that succeeds contradicts the declaration and fails the run.
// --log=<path> only links the log file the caller redirects this run to into the provenance stamps.
import fs from 'node:fs';
import path from 'node:path';
import { makeTree } from './ringtree.mjs';
import { CELLS, GAME_TYPES, ringProject, buildCell } from './ringworld.mjs';
import { laps, seam, seamStart } from './ringscene.mjs';
import { bootRom, runSteps } from './ringrun_jsnes.mjs';
import { checkAddresses } from './ringaddr.mjs';
import { judge, judgeCoverage } from './ringjudge.mjs';
import { runMesen, MESEN } from './ringrun_mesen.mjs';
import { jsnesStamp, mesenStamp, stampResult } from './ringprov.mjs';
import { IDENTITY_OUTCOME, buildErrorWitness, classifyBuildError } from './ringsabotage.mjs';

const BULK = 3000; // never-reached text that pushes the overlay into the battle bank (see run_identity.mjs)
const args = process.argv.slice(2);
const flag = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const die = (msg) => { console.error(`run_oracle: ${msg}`); process.exit(2); };
const list = (name, valid, dflt) => {
  const raw = flag(name);
  if (raw === undefined) return dflt;
  const got = raw.split(',');
  if (!raw || got.some((g) => !valid.includes(g))) die(`--${name}=${raw} names nothing valid (valid: ${valid.join(', ')})`);
  return got;
};
const known = ['cell', 'ring', 'gt', 'talkers', 'placement', 'scenario', 'emu', 'sabotage', 'expect', 'prov-dir', 'json', 'log'];
for (const a of args) if (a !== '--verbose' && !known.some((k) => a.startsWith(`--${k}=`))) die(`unknown argument ${a}`);

const sabotage = flag('sabotage');
if (sabotage !== undefined && !(sabotage in IDENTITY_OUTCOME)) die(`--sabotage=${sabotage} is not a declared sabotage (ringsabotage.mjs)`);
const expectVerdict = flag('expect', 'any');
if (!['any', 'vram', 'coverage', 'dialogue'].includes(expectVerdict)) die(`--expect=${expectVerdict}`);
const emus = { jsnes: ['jsnes'], mesen: ['mesen'], both: ['jsnes', 'mesen'] }[flag('emu', 'jsnes')] ?? die(`--emu=${flag('emu')} is not jsnes|mesen|both`);
const ringSel = flag('ring') === undefined ? null : ['1', '2'].includes(flag('ring')) ? Number(flag('ring')) : die(`--ring=${flag('ring')} is not 1|2`);
const cellIds = list('cell', CELLS.map((c) => c.id), null);
const cells = CELLS.filter((c) => (!cellIds || cellIds.includes(c.id)) && (ringSel === null || c.ring === ringSel));
const gts = list('gt', GAME_TYPES, GAME_TYPES);
const talkerModes = list('talkers', ['none', 'enter'], ['none', 'enter']);
const placements = list('placement', ['resident', 'banked'], ['resident', 'banked']);
const scenarioSel = list('scenario', ['lap', 'seam0', 'seam1'], ['lap', 'seam0', 'seam1']);
if (!cells.length) die('the --cell/--ring selection matches no cell');
const verbose = args.includes('--verbose');
const provDir = flag('prov-dir');
const links = { result: flag('json') ? path.resolve(flag('json')) : null, log: flag('log') ? path.resolve(flag('log')) : null };

const tree = makeTree({ ring: true, extra: sabotage ? [sabotage] : [] });
const emuStamps = { jsnes: jsnesStamp() };
const rows = [];
const scenariosFor = (cell, talkers) => {
  const out = [{ id: 'lap', ...laps({ ring: cell.ring, talkers }), start: {} }];
  if (talkers === 'enter') for (const variant of [0, 1]) out.push({ id: `seam${variant}`, ...seam({ ring: cell.ring, variant }), start: seamStart({ ring: cell.ring, variant }) });
  return out.filter((sc) => scenarioSel.includes(sc.id));
};

for (const cell of cells) for (const gameType of gts) for (const placement of placements) for (const talkers of talkerModes) {
  const banked = placement === 'banked';
  if (banked && (gameType !== 'rpg' || talkers !== 'enter')) continue; // banked placement exists only on an RPG; the dialogue is the point, so enter talkers only
  for (const sc of scenariosFor(cell, talkers)) {
    const { project, gridW, gridH } = ringProject({ cell, gameType, talkers, start: sc.start, bulkText: banked ? BULK : 0 });
    const label = `${sabotage ? `sab-${sabotage}-` : ''}${cell.id}-${gameType}-${placement}-${talkers}-${sc.id}`;
    const base = { cell: cell.id, gameType, placement, talkers, scenario: sc.id };
    let built;
    try { built = await buildCell({ tree, project, cell, gameType, provDir, links, sabotage: sabotage ?? null, label, requestedPlacement: placement }); }
    catch (e) {
      const cls = classifyBuildError(sabotage, cell, gameType, e.message);
      if (cls.kind === 'witnessed') { rows.push({ ...base, emu: 'build', witnessed: `predeclared unbuildable: ${e.message.split('\n')[0]}` }); stampResult(e.provPath, { ...base, witnessedBuildError: cls }); }
      else { rows.push({ ...base, emu: 'build', error: `build failed: ${e.message.split('\n')[0]}` }); stampResult(e.provPath, { ...base, error: e.message.split('\n')[0] }); }
      continue;
    }
    if (sabotage && buildErrorWitness(sabotage, cell, gameType)) {
      rows.push({ ...base, emu: 'build', error: 'predeclared UNBUILDABLE combination built successfully: the source-proof declaration is contradicted' });
      stampResult(built.provPath, { ...base, contradictedDeclaration: true });
      fs.rmSync(built.dir, { recursive: true, force: true });
      continue;
    }
    // placement: the ROM witness (where sw_dlg_single assembled) must be the requested placement -- the same three-way agreement row 1 asserts
    if (talkers === 'enter') {
      const pl = built.prov.placement;
      const want = banked ? 'switchable' : 'resident';
      if (pl.assembled !== want || pl.generatedFlag !== (banked ? 1 : 0)) { rows.push({ ...base, emu: 'build', error: `placement: requested ${want}, flag ${pl.generatedFlag}, sw_dlg_single assembled ${pl.assembled}` }); stampResult(built.provPath, { ...base, error: 'placement disagreement' }); fs.rmSync(built.dir, { recursive: true, force: true }); continue; }
    }
    const addrBad = checkAddresses(built.symbols);
    if (addrBad.length) die(`transcribed RAM addresses disagree with the build: ${addrBad.join('; ')}`);
    const ctx = { project, ring: cell.ring, gridW, gridH, typing: sc.expect.typing };
    for (const emu of emus) {
      let recs;
      try { recs = emu === 'jsnes' ? runSteps(bootRom(built.romPath), sc.steps) : await runMesen(built.romPath, sc.steps); }
      catch (e) { rows.push({ ...base, emu, error: `run failed: ${e.message}` }); stampResult(built.provPath, { ...base, emu, error: `run failed: ${e.message}` }); continue; }
      // the emulator implementation THIS run used: for Mesen, the files the process really mapped (its native core is loaded from ~/.config/Mesen2)
      const stampOf = emu === 'mesen' ? mesenStamp(MESEN, recs.loadedPaths ?? [], recs.loadedStamps ?? []) : emuStamps.jsnes;
      const verdicts = recs.map((r) => judge(r, ctx));
      const bad = verdicts.filter((v) => !v.ok);
      const dlgBad = bad.filter((v) => /:(open|typing)$/.test(v.label));
      const cov = judgeCoverage(recs, sc.expect, ctx);
      const row = { ...base, emu, checkpoints: recs.filter((r) => r.kind !== 'hold').length, dialogs: recs.filter((r) => r.kind === 'dlg-open').length,
        vramOk: !bad.length, dialogueOk: !dlgBad.length, coverageOk: cov.ok,
        vramFails: bad.slice(0, 3).map((v) => `${v.label}: ${v.fails.slice(0, 3).join(' | ')}`), coverageFails: cov.fails.slice(0, 6), seen: cov.seen };
      rows.push(row);
      stampResult(built.provPath, { ...base, emu, vramOk: row.vramOk, dialogueOk: row.dialogueOk, coverageOk: row.coverageOk, checkpoints: row.checkpoints, emulatorStamp: stampOf, sabotage: sabotage ?? null });
      if (verbose) recs.forEach((r, i) => r.kind !== 'hold' && console.log('   ', verdicts[i].ok ? 'ok  ' : 'FAIL', r.label.padEnd(16), `cam_nt=${r.state.cam_nt} cam=(${r.state.cam_x_lo},${r.state.cam_y_lo}) ppuctrl_nt=${r.state.ppuctrl_nt} scr=(${r.state.sw_col},${r.state.sw_row}) p=(${r.state.player_x},${r.state.player_y}) msg=(${r.state.msg_line},${r.state.msg_col}) vlen=${r.state.vram_len}`, verdicts[i].fails.join(' | ')));
    }
    fs.rmSync(built.dir, { recursive: true, force: true });
  }
}
fs.rmSync(tree.root, { recursive: true, force: true });

const pad = (s, n) => String(s).padEnd(n);
const executed = rows.filter((r) => !r.error && !r.witnessed);
const errors = rows.filter((r) => r.error);
const witnessedRows = rows.filter((r) => r.witnessed);
for (const r of rows) {
  const id = `${pad(r.cell, 7)} ${pad(r.gameType, 6)} ${pad(r.placement, 8)} talk=${pad(r.talkers, 5)} ${pad(r.scenario, 6)} ${pad(r.emu, 6)}`;
  if (r.error) { console.log(`${id} ERROR ${r.error}`); continue; }
  if (r.witnessed) { console.log(`${id} N/A ${r.witnessed}`); continue; }
  console.log(`${id} vram=${r.vramOk ? 'PASS' : 'FAIL'} dialogue=${r.dialogueOk ? 'PASS' : 'FAIL'} coverage=${r.coverageOk ? 'PASS' : 'FAIL'} (${r.checkpoints} checkpoints, ${r.dialogs} dialogues)${r.vramOk ? '' : ' VRAM: ' + r.vramFails.join(' // ')}${r.coverageOk ? '' : ' COVERAGE: ' + r.coverageFails.join(' // ')}`);
}
if (flag('json')) fs.writeFileSync(flag('json'), JSON.stringify(rows, null, 1));
if (!executed.length && !errors.length && !witnessedRows.length) die('the selection executed zero rows');
const verdictFails = (r) => ({ any: !r.vramOk || !r.coverageOk, vram: !r.vramOk, coverage: !r.coverageOk, dialogue: !r.dialogueOk })[expectVerdict];
if (sabotage) {
  const missed = executed.filter((r) => !verdictFails(r));
  console.log(`sabotage ${sabotage} (expect ${expectVerdict}): ${executed.length - missed.length}/${executed.length} rows fail it, ${missed.length} NOT CAUGHT, ${witnessedRows.length} predeclared-unbuildable rows witnessed, ${errors.length} unexpected errors`);
  process.exit(errors.length ? 2 : missed.length || !executed.length ? 1 : 0);
}
const failing = executed.filter((r) => !r.vramOk || !r.coverageOk).length;
console.log(errors.length ? `${errors.length} ERRORS, ${failing} FAILING of ${rows.length}` : failing ? `${failing} FAILING of ${executed.length}` : `all pass (${executed.length} rows)`);
process.exit(errors.length ? 2 : failing ? 1 : 0);
