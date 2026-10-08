#!/usr/bin/env node
// The streamed-worlds ring gate's acceptance table (plan 2.5): rows 1-9 x the six mapper/mirroring cells x game type x dialogue placement x emulator, printed from the evidence a
// certificate run left on disk, never from a hand-kept list. `test/lua/run_sw_ring_gate.sh` is its shell front.
//
//   node test/lua/ring_gate/s1c_gate.mjs --prov=<provenance dir> --logs=<matrix log dir> [--s1b=<dir of s1b-<cell>-<gt>-<placement>.json records>] [--json=<out.json>]
//
// Where each row comes from:
//   1 identity      <logs>/identity-positive.json                         (static header/ring check: emulator-independent)
//   2 / 4 / 7       S1b result records (items by id prefix), from --s1b (e.g. a judge-only successor evaluation directory) when given, else RE-DERIVED from the
//                   records the matrix wrote into <logs> (s1b-<cell>-<gt>-<placement>.json); the header line says which
//   3 oracle        <logs>/oracle-positive-<cell>.json                    (both emulators)
//   5 / 6 / 8       <prov>/s1c-r<row>-<cell>-<gt>-<placement>.json        (Mesen; jsnes N/A with the proof the stamp carries)
//   9 controls      the S1c control stamps of that build, plus (action resident) the S1b pad / seam / fault control jobs of the cell; the global control jobs are judged below the table
// Every matrix job is also judged against its declaration (ringjobs.mjs) from its log: an unexpected or missing job is a failure of the gate. A cell is PASS, FAIL, UNMEASURED, N/A (with a
// stated proof) or UNCERTIFIED (passes, but carries S1b's declared-uncertified items -- option A -- which are never shown as PASS). Exit 0 = no FAIL, no UNMEASURED anywhere; 1 = otherwise;
// 2 = usage.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { jobs } from './ringjobs.mjs';
import { judgeJob } from './run_matrix.mjs';
import { auditProvenance } from './ringprovindex.mjs';
import { validateS1cResult, summarize } from './s1caudit.mjs';
import { harnessFingerprint } from './ringprov.mjs';
import { CONTROLS, CELL_IDS, MMC3_CELLS, controlBuilds, positiveLabel, controlLabel } from './s1ccontrols.mjs';

export const BUILDS4 = [['action', 'resident'], ['rpg', 'resident'], ['rpg', 'banked'], ['action', 'banked']];
export const ROW_NAMES = { 1: 'ROM identity', 2: 'workload witnesses', 3: 'VRAM+attr oracle', 4: 'mainline G', 5: 'NMI deadline', 6: 'close', 7: 'decoded seam', 8: 'MMC3 split/lock', 9: 'controls' };
// S1b item-id prefix -> the 2.5 row it evidences. run/placement/arm are validity items every row depends on.
const S1B_ROW = { 2: ['class', 'reads', 'cover', 'path', 'coexist', 'cost', 'agree', 'sanity'], 4: ['gate', 'overruns', 'bound'], 7: ['seam'] };
const S1B_COMMON = ['run', 'placement', 'arm'];
const CODE = { PASS: 'P', FAIL: 'F', UNMEASURED: 'U', 'N/A': 'N', UNCERTIFIED: 'C' };

const cell = (status, note = '') => ({ status, note });
const both = (status, note) => ({ mesen: cell(status, note), jsnes: cell(status, note) });
const worst = (list) => {
  for (const s of ['FAIL', 'UNMEASURED', 'UNCERTIFIED', 'PASS', 'N/A']) if (list.includes(s)) return s;
  return 'UNMEASURED';
};
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

/**
 * The S1b item status of one (record, row, emulator). The row's OWN items decide whether it applies and what it is; the row-independent validity items (run / placement / arm) may FAIL or leave
 * a row UNMEASURED but never upgrade a row with no item of its own to PASS (round 2, finding 5: a `gate: N/A` row on jsnes read PASS because the common items were all PASS).
 */
export function s1bRowStatus(rec, row, emu) {
  if (!rec) return cell('UNMEASURED', 'no S1b record');
  if (rec.sabotage || rec.fault) return cell('UNMEASURED', 'a sabotage/fault record, not a positive');
  const ids = S1B_ROW[row];
  const prefix = (i) => i.id.split(':')[0];
  const onEmu = (rec.items ?? []).filter((i) => i.emu === emu || i.emu === 'both' || i.emu === '-');
  const mine = onEmu.filter((i) => ids.includes(prefix(i)));
  const common = onEmu.filter((i) => S1B_COMMON.includes(prefix(i)));
  const commonBad = common.filter((i) => i.status === 'FAIL' || i.status === 'UNMEASURED');
  const fromCommon = commonBad.length ? cell(commonBad.some((i) => i.status === 'FAIL') ? 'FAIL' : 'UNMEASURED', `common validity item(s): ${commonBad.map((i) => `${i.id} ${i.status}`).join(', ')}`) : null;
  if (!mine.length) {
    // S1b decodes the seams from the jsnes core's VRAM/OAM state only (s1bjudge.mjs, "decoded seams (jsnes)"); the Mesen column of row 7 is therefore not a decode. It is N/A only while Mesen
    // really ran the same two seam specs to the end (run:seam-walk and run:seam-move PASS on mesen) -- the specs whose bodies the agree:bodies cross-check compares with jsnes's.
    let base;
    if (row === 7 && emu === 'mesen') {
      const ran = ['run:seam-walk', 'run:seam-move'].every((id) => (rec.items ?? []).some((i) => i.id === id && i.emu === 'mesen' && i.status === 'PASS'));
      base = ran ? cell('N/A', 'S1b decodes seams from jsnes state only (test/lua/ring_gate/s1bjudge.mjs "decoded seams (jsnes)"); Mesen ran the seam-walk and seam-move specs to their end (run:seam-walk, run:seam-move PASS) and their bodies are compared with jsnes\'s by agree:bodies, but no Mesen-side decode exists -- NEEDS A RULING whether that is sufficient')
        : cell('UNMEASURED', 'the Mesen seam specs did not run to their end');
    } else base = cell(emu === 'jsnes' && row === 4 ? 'N/A' : 'UNMEASURED', emu === 'jsnes' && row === 4 ? 'G is a Mesen cycle measurement; the jsnes core has no cycle-accurate mainline' : `no row-${row} item on ${emu}`);
    return fromCommon ?? base;
  }
  // every item of the row itself is N/A (S1b's own statement that the row does not apply on this emulator): the row is N/A -- the common validity items can only FAIL it, never make it PASS
  if (mine.every((i) => i.status === 'N/A')) return fromCommon ?? cell('N/A', mine[0].detail ?? `S1b: row ${row} does not apply on ${emu}`);
  const items = [...mine, ...common];
  const status = worst(items.map((i) => i.status));
  const unc = [...new Set(items.filter((i) => i.status === 'UNCERTIFIED').map((i) => i.id.replace(/^bound:(C\w+)$/, 'bound:<class>')))];
  const bad = items.filter((i) => i.status === 'FAIL' || i.status === 'UNMEASURED').map((i) => i.id);
  if (status === 'PASS' && rec.verdictOk === false) return cell('FAIL', 'the record is not verdictOk');
  return cell(status, bad.length ? bad.join(', ') : unc.length ? `UNCERTIFIED (declared, option A): ${unc.join(', ')}` : '');
}

/** Builds the whole table. `ctx`: { prov, logs, s1b } directories. Returns { entries, notes, jobProblems, headers }. */
export function buildGate({ prov, logs, s1b, construct = false }) {
  // the evidence the table reads is AUDITED first, read-only (round 2, finding 1): every stamp, the result and log it links (resolved from the two directory arguments only), the S1c result
  // contents recomputed from their items, and the finalized INDEX.json's recorded hashes VERIFIED: a missing or unreadable index fails the gate. Only the matrix's own pre-finalization
  // gate job asks for `construct` (no index exists yet, the hashes are computed in memory); that result is labelled UNFINALIZED and is not a verified certificate
  const audit = prov && logs && fs.existsSync(prov) ? auditProvenance(prov, logs, { construct }) : { ok: false, problems: ['no provenance directory'], byFile: new Map(), mode: 'none', index: { counts: {} } };
  const problemsFor = (label) => audit.byFile.get(`${label}.json`) ?? [];
  const stamps = new Map();
  if (prov && fs.existsSync(prov)) for (const f of fs.readdirSync(prov).filter((x) => x.endsWith('.json') && x !== 'INDEX.json')) { const st = readJson(path.join(prov, f)); if (st?.label) stamps.set(st.label, st); }
  const logText = (name) => readText(path.join(logs, `${name}.log`));
  const result = (name) => readJson(path.join(logs, `${name}.json`));
  const entries = []; // { cell, gt, placement, row, mesen, jsnes }
  const put = (c, gt, pl, row, e) => entries.push({ cell: c, gt, placement: pl, row, ...e });
  const naLog = (name) => { const t = logText(name); return t && /\bN\/A\b/.test(t) ? cell('N/A', t.split('\n').find((l) => /N\/A/.test(l))?.replace(/^\S+ (action|rpg) (resident|banked)\s+N\/A\s+/, '').slice(0, 400) ?? 'N/A') : null; };
  const identity = result('identity-positive') ?? [];
  const s1bSource = s1b ? `S1b records read from ${s1b}` : `S1b records re-derived from the matrix's own results in ${logs}`;
  const s1bRec = (c, gt, pl) => readJson(path.join(s1b ?? logs, `s1b-${c}-${gt}-${pl}.json`));
  // the gate's own matrix job (group 7, after every other job has logged) is not one of the jobs it judges
  const matrixJobs = jobs(prov ?? '/p', logs ?? '/l').filter((j) => j.name !== 's1c-gate');
  const jobVerdict = new Map();
  for (const j of matrixJobs) {
    const t = logText(j.name);
    if (t === null) { jobVerdict.set(j.name, { ok: false, missing: true, why: 'no log: the job did not run' }); continue; }
    const m = /^exit=(\S+)$/m.exec(t);
    jobVerdict.set(j.name, judgeJob(j, { status: m ? Number(m[1]) : 128, log: t }));
  }
  for (const c of CELL_IDS) {
    const ring = c.endsWith('-V') ? 1 : 2;
    for (const [gt, pl] of BUILDS4) {
      const banNA = gt === 'action' && pl === 'banked';
      const s1bNA = banNA ? naLog(`s1b-${c}-action-banked-na`) : null;
      // row 1
      if (banNA) put(c, gt, pl, 1, both(s1bNA?.status ?? 'UNMEASURED', s1bNA?.note ?? 'the action-banked N/A proof log is missing'));
      else {
        const r = identity.find((x) => x.row === 'identity' && x.cell === c && x.gameType === gt && x.placement === pl);
        put(c, gt, pl, 1, both(!r ? 'UNMEASURED' : r.fails?.length ? 'FAIL' : 'PASS', r ? (r.fails?.length ? r.fails.join('; ') : 'static header / STREAM_RING / placement check (emulator-independent)') : 'no identity row'));
      }
      // rows 2, 4, 7
      for (const row of [2, 4, 7]) {
        if (banNA) { put(c, gt, pl, row, both(s1bNA?.status ?? 'UNMEASURED', s1bNA?.note ?? '')); continue; }
        const rec = s1bRec(c, gt, pl);
        put(c, gt, pl, row, { mesen: s1bRowStatus(rec, row, 'mesen'), jsnes: s1bRowStatus(rec, row, 'jsnes') });
      }
      // row 3
      if (banNA) put(c, gt, pl, 3, both(s1bNA?.status ?? 'UNMEASURED', s1bNA?.note ?? ''));
      else {
        const rows = (result(`oracle-positive-${c}`) ?? []).filter((x) => x.gameType === gt && x.placement === pl);
        const one = (emu) => { const r = rows.filter((x) => x.emu === emu); return !r.length ? cell('UNMEASURED', `no ${emu} oracle row`) : cell(r.every((x) => x.vramOk && x.dialogueOk && x.coverageOk) ? 'PASS' : 'FAIL', `${r.length} scene(s)`); };
        put(c, gt, pl, 3, { mesen: one('mesen'), jsnes: one('jsnes') });
      }
      // rows 5, 6, 8
      for (const row of [5, 6, 8]) {
        const lbl = positiveLabel(row, c, gt, pl);
        const mmc3 = MMC3_CELLS.includes(c);
        if (row === 8 && !mmc3) { const n = naLog(`${lbl}-na`); put(c, gt, pl, row, both(n?.status ?? 'UNMEASURED', n?.note ?? `no N/A proof log ${lbl}-na`)); continue; }
        if (banNA) { const n = naLog(`${lbl}-na`); put(c, gt, pl, row, both(n?.status ?? 'UNMEASURED', n?.note ?? `no N/A proof log ${lbl}-na`)); continue; }
        const st = stamps.get(lbl);
        if (!st) { put(c, gt, pl, row, both('UNMEASURED', `no stamp ${lbl}`)); continue; }
        const res = result(lbl); // <logs>/<label>.json: the file the stamp links, resolved from the directory argument
        const probs = [...new Set([...problemsFor(lbl), ...validateS1cResult(res, st, lbl)])];
        const ok = st.status === 'built' && !st.control && probs.length === 0;
        const jna = st.emulators?.jsnes?.na;
        put(c, gt, pl, row, { mesen: cell(ok ? 'PASS' : 'FAIL', ok ? summarize(res) : `evidence invalid: ${probs[0] ?? `status ${st.status}`}${probs.length > 1 ? ` (+${probs.length - 1} more)` : ''}`), jsnes: jna ? cell('N/A', jna) : cell('UNMEASURED', 'no jsnes statement in the stamp') });
      }
      // row 9: the S1c controls of this build (Mesen), plus the S1b controls of the cell on action resident
      const mine = [];
      for (const [id, ctl] of Object.entries(CONTROLS)) {
        if (ctl.row === 8 && !MMC3_CELLS.includes(c)) continue;
        if (!controlBuilds(id).some(([g, p]) => g === gt && p === pl)) continue;
        const lbl = controlLabel(id, c, gt, pl), st = stamps.get(lbl);
        mine.push({ id, st, lbl });
      }
      if (banNA) put(c, gt, pl, 9, both(s1bNA?.status ?? 'UNMEASURED', s1bNA?.note ?? ''));
      else {
        const fails = [];
        const sts = mine.map((m) => {
          if (!m.st) { fails.push(`${m.id} (no stamp)`); return 'UNMEASURED'; }
          const posLbl = positiveLabel(CONTROLS[m.id].row, c, gt, pl);
          const probs = [...new Set([...problemsFor(m.lbl), ...validateS1cResult(result(m.lbl), m.st, m.lbl), ...problemsFor(posLbl), ...(stamps.get(posLbl) ? validateS1cResult(result(posLbl), stamps.get(posLbl), posLbl) : ['its matching positive has no stamp'])])];
          const ok = m.st.status === 'built' && m.st.control === m.id && m.st.matchingPositive === posLbl && probs.length === 0;
          if (!ok) fails.push(`${m.id} (${m.st.status !== 'built' ? m.st.status : probs.length ? `evidence invalid: ${probs[0]}` : 'not as declared'})`);
          return ok ? 'PASS' : 'FAIL';
        });
        if (gt === 'action' && pl === 'resident') {
          const re = new RegExp(`^s1b-(pad-(over|under)-|seam-.*-|fault-.*-)${c}$|^s1b-fault-.*-${c}-?`);
          for (const j of matrixJobs.filter((x) => re.test(x.name))) { const v = jobVerdict.get(j.name); sts.push(v.ok ? 'PASS' : v.missing ? 'UNMEASURED' : 'FAIL'); if (!v.ok) fails.push(`${j.name}: ${v.why}`); }
        }
        if (!sts.length) put(c, gt, pl, 9, { mesen: cell('N/A', 'no S1c control is declared on this build (controls run on action resident, and on rpg banked for the deadline controls; the matching positive of every control is the build it ran on)'), jsnes: cell('N/A', 'S1c controls are Mesen-only (rows 5/6/8 jsnes N/A)') });
        else put(c, gt, pl, 9, { mesen: cell(worst(sts), fails.length ? fails.join(', ') : `${sts.length} control(s) each caught or passing as declared`), jsnes: cell('N/A', 'S1c controls are Mesen-only (rows 5/6/8 jsnes N/A); the oracle controls run on both emulators (global controls below)') });
      }
    }
  }
  const unexpected = [...jobVerdict].filter(([, v]) => !v.ok).map(([n, v]) => `${n}: ${v.why}`);
  // the certificate's harness fingerprint: every stamp must carry the fingerprint of THIS checkout's harness files (an edited judge, gate or template invalidates the evidence it produced)
  let fpNow = null;
  try { fpNow = JSON.stringify(harnessFingerprint()); } catch { fpNow = null; }
  const stale = [...stamps.values()].filter((st) => st.harness && JSON.stringify(st.harness) !== fpNow).length;
  return { entries, unexpected, jobsJudged: jobVerdict.size, s1bSource, stamps: stamps.size, construct, audit: { ok: audit.ok, mode: audit.mode, problems: audit.problems.slice(0, 40), count: audit.problems.length }, staleStamps: stale, fingerprintKnown: fpNow !== null };
}

export function render({ entries, unexpected, jobsJudged, s1bSource, stamps, audit, staleStamps, fingerprintKnown, construct }, dirs) {
  const out = [];
  out.push(`streamed-worlds ring gate, acceptance table 2.5 (rows 1-9 x 6 cells x game type x placement x emulator)`);
  out.push(`provenance ${dirs.prov} (${stamps} stamps), matrix logs ${dirs.logs}; rows 2/4/7: ${s1bSource}`);
  out.push(`evidence audit (read-only; every file resolved from those two directories): ${audit.mode === 'verify' ? 'VERIFY: the recorded INDEX.json is required and its recorded hashes are checked' : audit.mode === 'construct' ? 'CONSTRUCT mode (explicit): UNFINALIZED certificate under construction, hashes computed in memory, NOT verified against a recorded index' : 'no provenance directory'}; ${audit.count} problem(s); harness fingerprint: ${!fingerprintKnown ? 'could not be computed' : staleStamps ? `${staleStamps} stamp(s) carry a different fingerprint than this checkout's harness files` : 'every stamp equals this checkout\'s'}`);
  for (const p of audit.problems.slice(0, 12)) out.push(`  AUDIT PROBLEM ${p}`);
  out.push(`entry = mesen/jsnes: P PASS, F FAIL, U UNMEASURED, N N/A (a source proof is printed below), C UNCERTIFIED (declared by Chris, option A -- the S1b class bounds, agree:dsp, agree:chase in horizontal cells, bound:CB; never PASS)`);
  out.push('');
  out.push(`${'cell'.padEnd(7)} ${'build'.padEnd(14)} ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => `r${r}`.padEnd(5)).join(' ')}`);
  const flat = [];
  for (const c of CELL_IDS) for (const [gt, pl] of BUILDS4) {
    const cols = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => { const e = entries.find((x) => x.cell === c && x.gt === gt && x.placement === pl && x.row === r); return e; });
    out.push(`${c.padEnd(7)} ${`${gt} ${pl}`.padEnd(14)} ${cols.map((e) => (e ? `${CODE[e.mesen.status]}/${CODE[e.jsnes.status]}` : '?/?').padEnd(5)).join(' ')}`);
    for (const e of cols) if (e) flat.push(e);
  }
  out.push('');
  const bad = flat.flatMap((e) => ['mesen', 'jsnes'].map((m) => ({ ...e, emu: m, ...e[m] }))).filter((x) => x.status === 'FAIL' || x.status === 'UNMEASURED');
  const unc = flat.flatMap((e) => ['mesen', 'jsnes'].map((m) => ({ ...e, emu: m, ...e[m] }))).filter((x) => x.status === 'UNCERTIFIED');
  const na = new Map();
  for (const e of flat) for (const m of ['mesen', 'jsnes']) if (e[m].status === 'N/A') { const k = `row ${e.row} ${m}: ${e[m].note.replace(/battleBankEnabled\(project, \d+\)/, 'battleBankEnabled(project, mapper)').replace(/\(Music compiles.*$/, '').replace(/ is \d+$/, '').replace(/ and MMC\S+ is$/, '')}`; na.set(k, (na.get(k) ?? 0) + 1); }
  const count = (s) => flat.reduce((a, e) => a + ['mesen', 'jsnes'].filter((m) => e[m].status === s).length, 0);
  out.push(`cells (row x cell x build x emulator): ${count('PASS')} PASS, ${count('UNCERTIFIED')} UNCERTIFIED, ${count('N/A')} N/A, ${count('FAIL')} FAIL, ${count('UNMEASURED')} UNMEASURED`);
  for (const b of bad) out.push(`  ${b.status} row ${b.row} ${b.cell} ${b.gt} ${b.placement} ${b.emu}: ${b.note}`);
  if (unc.length) {
    const kinds = new Map();
    for (const u of unc) { const k = `row ${u.row} ${u.emu}: ${u.note}`; kinds.set(k, (kinds.get(k) ?? 0) + 1); }
    out.push('UNCERTIFIED cells (not shown as PASS; declared by Chris, option A):');
    for (const [k, n] of kinds) out.push(`  ${n} x ${k}`);
  }
  out.push('N/A proofs:');
  for (const [k, n] of na) out.push(`  ${n} x ${k}`);
  out.push('');
  out.push(`matrix jobs: ${jobsJudged} judged against their declared exit and log pattern, ${unexpected.length} unexpected (global controls -- the oracle, campaign, identity-sabotage and repro jobs -- are among them)`);
  for (const u of unexpected.slice(0, 40)) out.push(`  UNEXPECTED ${u}`);
  const fail = bad.length > 0 || unexpected.length > 0 || !audit.ok || staleStamps > 0 || !fingerprintKnown;
  const label = construct ? ' (construct mode, UNFINALIZED: not a verified certificate)' : '';
  out.push(fail ? `GATE FAIL${label}: ${bad.length} FAIL/UNMEASURED cell(s), ${unexpected.length} unexpected job(s), ${audit.count} audit problem(s), ${staleStamps} stale-fingerprint stamp(s)` : `GATE PASS${label}: no FAIL and no UNMEASURED cell${unc.length ? `; ${unc.length} UNCERTIFIED cells are declared option-A items, not certified` : ''}`);
  return { text: out.join('\n'), fail };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  for (const a of args) if (!['prov', 'logs', 's1b', 'json'].some((k) => a.startsWith(`--${k}=`)) && a !== '--construct') { console.error(`s1c_gate: unknown argument ${a}`); process.exit(2); }
  if (!flag('prov') || !flag('logs')) { console.error('usage: s1c_gate.mjs --prov=<provenance dir> --logs=<matrix log dir> [--s1b=<S1b records dir>] [--json=<out.json>] [--construct]'); process.exit(2); }
  const dirs = { prov: path.resolve(flag('prov')), logs: path.resolve(flag('logs')), s1b: flag('s1b') ? path.resolve(flag('s1b')) : undefined };
  const construct = args.includes('--construct');
  for (const [k, d] of Object.entries(dirs)) if (d && !fs.existsSync(d)) { console.error(`s1c_gate: ${k} directory ${d} does not exist`); process.exit(2); }
  const g = buildGate({ ...dirs, construct });
  const r = render(g, dirs);
  console.log(r.text);
  if (flag('json')) fs.writeFileSync(path.resolve(flag('json')), JSON.stringify({ dirs, ...g, fail: r.fail }, null, 1));
  process.exit(r.fail ? 1 : 0);
}
