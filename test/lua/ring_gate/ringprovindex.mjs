// The provenance AUDIT of a certificate run (review 2 finding 3): every stamp in <prov-dir> must be complete, linked to the log and result file
// that produced it, and carry what a certified build must (inputs, resources, placement, the emulator implementation that judged it). Writes
// <prov-dir>/INDEX.json (sha256 of every stamp, log and result) and exits nonzero on any problem.
//   node test/lua/ring_gate/ringprovindex.mjs <prov-dir> <log-dir> --verify | --construct
import { auditChain } from './ringhome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256 } from './ringtree.mjs';
import zlib from 'node:zlib';
import { relationshipFailures, requiredEvidence } from './s1bagree.mjs';
import { validateS1cResult } from './s1caudit.mjs';
const MAPPER_OF = { MMC1: 1, MMC3: 4, U512: 30 };

/**
 * Audits a witness result's RETAINED per-body records (round 2, finding 4): the gzipped bodies and sweeps linked by SHA-256 must exist next to the result, hash to what the stamp says, and -- for a
 * positive -- every retained body of both emulators must satisfy the transaction arithmetic and every required evidence kind again, recomputed here from the retained bytes (not from the judge's own
 * verdict), so a stamp cannot certify records that do not hold what its log says.
 */
export function auditRetained(st, name, resultPath, read = (f) => fs.readFileSync(f)) {
  const bad = [];
  const need = (c, m) => { if (!c) bad.push(`${name}: ${m}`); };
  const r = st.retained;
  need(r?.bodies?.sha256 && r?.sweeps?.sha256, 'the stamp links no retained per-body records / swept read-cost matrices');
  if (!r?.bodies?.sha256 || !r?.sweeps?.sha256) return bad;
  const dir = path.dirname(resultPath);
  let bodies = null;
  for (const [k, v] of Object.entries(r)) {
    let buf; try { buf = read(path.join(dir, v.file)); } catch { need(false, `retained ${k} file ${v.file} is missing`); continue; }
    need(sha256(buf) === v.sha256, `retained ${k} file ${v.file} does not hash to the stamp's ${v.sha256.slice(0, 12)}`);
    if (k === 'bodies') { try { bodies = JSON.parse(zlib.gunzipSync(buf)); } catch (e) { need(false, `retained bodies do not decode: ${e.message}`); } }
  }
  if (bodies && st.expect === 'pass') {
    const mapper = MAPPER_OF[String(st.plan?.cell ?? '').split('-')[0]];
    const perSpec = bodies.map((b) => ({ name: b.name, mesen: b.mesen ? { rows: b.mesen } : null, jsnes: b.jsnes ? { rows: b.jsnes } : null }));
    for (const emu of ['mesen', 'jsnes']) {
      if (!perSpec.some((x) => x[emu])) continue;
      const rf = relationshipFailures(perSpec, emu, mapper), ev = requiredEvidence(perSpec, emu);
      need(rf.length === 0, `${rf.length} retained ${emu} bodies break the transaction arithmetic when recomputed (first ${rf[0]?.at})`);
      need(ev.missing.length === 0, `the retained ${emu} bodies hold no ${ev.missing.join(', ')} evidence`);
    }
    need(perSpec.every((x) => (x.mesen?.rows?.length ?? 1) > 0), 'a retained spec holds no bodies');
  }
  return bad;
}

const isHex = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);

/** What an emulator stamp must identify: the Mesen process's native core and managed assembly (or jsnes' vendored core hash). */
export function auditEmulator(e, name) {
  const bad = [];
  const need = (cond, msg) => { if (!cond) bad.push(`${name}: ${msg}`); };
  if (!e) return bad;
  if (/Mesen/.test(e.emulator ?? '')) {
    need(e.loadedFiles?.some((f) => /MesenCore\.so$/.test(f.path) && isHex(f.sha256)), 'Mesen result does not identify the NATIVE core the process loaded');
    need(e.loadedFiles?.some((f) => /Mesen\.dll$/.test(f.path)) && e.binarySha256 && e.host?.kernel, 'Mesen result lacks the managed assembly, host binary or machine');
  } else need(isHex(e.coreSha256), 'jsnes result lacks the vendored core hash');
  return bad;
}

/**
 * Audits one stamp object; returns problem strings. `exists(p, kind)` says whether a linked file exists (`kind`: 'result' | 'log' | 'raw' | 'comparison' | 'stamp' -- the directory audit
 * resolves each kind from its own directory argument, by file name, never from the absolute path the stamp recorded). `read(p)` returns a linked file's bytes (the S1c content audit and
 * the retained records read through it).
 */
export function auditStamp(st, name, exists, read = undefined) {
  const bad = [];
  const need = (cond, msg) => { if (!cond) bad.push(`${name}: ${msg}`); };
  need(st.schema === 'ring-prov-3', `schema ${st.schema}`);
  if (st.kind === 'ring0-identity-comparison') {
    need(st.status === 'built', `comparison status ${st.status}`);
    for (const side of ['pristine', 'patched']) {
      const c = st.constituents?.[side];
      need(c?.stamp && exists(c.stamp, 'stamp'), `${side} constituent stamp ${c?.stamp} missing`);
      need(isHex(c?.sha256), `${side} constituent has no sha256`);
    }
    need(isHex(st.pristineRomSha256) && isHex(st.patchedRomSha256), 'ROM hashes missing');
    need(st.equal === true, 'the six-fixture STREAM_RING=0 comparison is not equal');
    need(st.links?.result && exists(st.links.result, 'result'), 'comparison does not link an existing result file');
    need(st.links?.log && exists(st.links.log, 'log'), 'comparison does not link an existing log file');
    need(st.harness && Object.keys(st.harness).length > 20, 'no harness fingerprint');
    return bad;
  }
  need(['built', 'error'].includes(st.status), `status ${st.status} (an attempt that never completed)`);
  need(st.attempt?.startedAt && st.harness && Object.keys(st.harness).length > 20, 'no attempt record / harness fingerprint');
  need(st.head && st.baseline && Array.isArray(st.patches), 'head, baseline or patches missing');
  need(st.links?.result && exists(st.links.result, 'result'), `links.result ${st.links?.result} missing or not on disk`);
  need(st.links?.log && exists(st.links.log, 'log'), `links.log ${st.links?.log} missing or not on disk`);
  need(st.nesasm?.sha256 && st.host?.kernel, 'assembler or host stamp missing');
  need(Array.isArray(st.results) && st.results.length >= 1, 'no result linked: the stamp never reached a verdict');
  if (st.status === 'error') {
    need(st.error?.firstLine, 'error stamp without the error text');
    return bad;
  }
  if (st.kind === 'ring0-build') {
    need(isHex(st.romSha256) && isHex(st.projectSha256), 'ring-0 build: ROM or project hash missing');
    need(st.resources?.bankUsage && Object.keys(st.resources.bankUsage).length > 0, 'ring-0 build: no resources');
    need(st.links?.comparison && exists(st.links.comparison, 'comparison'), 'ring-0 build: comparison not linked');
    need(st.results.some((r) => r.comparison), 'ring-0 build: result does not name its comparison');
    return bad;
  }
  if (st.kind === 's1b-witness') {
    // a row 2/4/7 witness run (run_s1b.mjs): the planned scene list hashes to what it says, every emulator that judged it is identified, the verdict the job
    // DECLARED (a positive: all pass; a sabotage/fault: gate-fail / fail) is the one reached, and the Mesen processes ran in a private HOME that left the user's saves alone
    need(isHex(st.romSha256) && isHex(st.projectSha256), 's1b: plan or scene-ROM hash missing');
    const { sha256: claimed, ...planned } = st.plan ?? {};
    need(isHex(claimed) && claimed === sha256(JSON.stringify(planned)), 's1b: the stamped plan does not hash to its own sha256');
    need(Array.isArray(planned.specs) && planned.specs.length > 0 && planned.specs.every((x) => isHex(x.romSha256)), 's1b: the plan names no specs, or one lacks its scene-ROM hash');
    need(st.verdictOk === true && ['pass', 'gate-fail', 'bound-fail', 'seam-fail', 'fail'].includes(st.expect), `s1b: the declared verdict (${st.expect}) was not reached`);
    need(st.userSavesUntouched === true, 's1b: the run does not attest that the user\'s own Mesen saves were untouched');
    // every Mesen invocation of the run (a Move scene's calibration session included) is retained with what it was for, its pid, the HOME the kernel reported, its exit status and the files it mapped;
    // the chain must equal the invocations the plan names (round 2, finding 3: round 1 manufactured statuses and never saw the calibration spawn)
    for (const p of auditChain(st.mesenChain, (planned.specs ?? []).flatMap((x) => (x.invocations ?? []).map((purpose) => ({ spec: x.name, purpose }))))) need(false, `s1b: ${p}`);
    need((planned.specs ?? []).every((x) => Array.isArray(x.invocations) && x.invocations.includes('witness')), 's1b: the plan does not name every spec\'s planned invocations');
    need(st.counts && Number.isFinite(st.counts.PASS), 's1b: no verdict counts');
    if (st.expect === 'pass') need(!st.counts.FAIL && !st.counts.UNMEASURED, `s1b: a positive with ${st.counts?.FAIL ?? 0} FAIL / ${st.counts?.UNMEASURED ?? 0} UNMEASURED items`);
    if (st.expect === 'gate-fail') need(st.gateFailed === true && st.sabotage && st.gateFailures >= 1 && st.operationalFailures === 0, 's1b: a sabotage control that did not fail the G gate on a NUMERICAL G failure of a completed non-C0 body in an operationally sound run');
    if (st.expect === 'bound-fail') need(st.sabotage && st.gateFailures === 0 && st.operationalFailures === 0, 's1b: an under-pad control (sampled estimate refusal) must show NO numerical G failure and no operational failure (the class estimate alone refuses)');
    if (st.expect === 'seam-fail') need(st.sabotage && st.operationalFailures === 0, 's1b: a seam sabotage control must be a declared sabotage in an operationally sound run');
    if (st.links?.result && exists(st.links.result, 'result') && st.retained !== undefined) bad.push(...auditRetained(st, name, st.links.result, read));
    else if (st.expect === 'pass') need(false, 's1b: a positive stamp without its retained per-body records');
    for (const r of st.results) bad.push(...auditEmulator(r.emulatorStamp, name));
    return bad;
  }
  if (st.kind === 's1c-run') {
    // a row 5/6/8 run (run_s1c.mjs): the planned run hashes to what it says, the build is the ring cell it names in the placement it names, the Mesen process ran in a private HOME that left
    // the user's saves alone, and the verdict reached is the one DECLARED (s1ccontrols.mjs): a positive passes every item; a control is CAUGHT only when every named item failed.
    const wantRing = String(st.cell).endsWith('-V') ? 1 : 2;
    need(isHex(st.romSha256) && isHex(st.luaSha256) && isHex(st.projectSha256), 's1c: ROM, Lua or project hash missing');
    const { sha256: claimed, ...planned } = st.plan ?? {};
    need(isHex(claimed) && claimed === sha256(JSON.stringify(planned)), 's1c: the stamped plan does not hash to its own sha256');
    need(planned.romSha256 === st.romSha256 && planned.luaSha256 === st.luaSha256 && planned.cell === st.cell && planned.row === st.row && planned.control === st.control, 's1c: the plan does not describe this run');
    need([5, 6, 8].includes(st.row), `s1c: row ${st.row}`);
    need(st.build?.streamRing === wantRing, `s1c: the build's STREAM_RING is ${st.build?.streamRing}, ${st.cell} wants ${wantRing}`);
    need(st.build?.placement?.requested === st.placement && st.build.placement.assembled === (st.placement === 'banked' ? 'switchable' : 'resident'), `s1c: the assembled dialogue placement ${st.build?.placement?.assembled} is not what ${st.placement} requires`);
    need(st.verdictOk === true, 's1c: the declared verdict was not reached');
    need(st.userSavesUntouched === true, 's1c: the run does not attest that the user\'s own Mesen saves were untouched');
    need(Array.isArray(st.mesenChain) && st.mesenChain.length === 1 && st.mesenChain[0].purpose === `row${st.row}-${{ 5: 'nmi', 6: 'close', 8: 'split' }[st.row]}`, 's1c: the run does not retain exactly its one Mesen invocation');
    for (const p of auditChain(st.mesenChain, [{ spec: st.mesenChain?.[0]?.spec, purpose: st.mesenChain?.[0]?.purpose }], { statusOk: st.control ? [0, 5, 7, 8, 9] : [0] })) need(false, `s1c: ${p}`);
    need(st.counts && Number.isFinite(st.counts.PASS) && st.counts.PASS > 0, 's1c: no verdict counts (or none PASS)');
    // round 2, finding 1: the stamp's summary is a claim about the result it links. The result is READ and every claim recomputed from its own items against the current
    // declarations (identity, the exact required item set, legal statuses, counts, failed ids, the verdict, the Mesen exit); the raw recorder output is retained and hashed.
    let linked = null;
    try { linked = JSON.parse(String((read ?? ((f) => fs.readFileSync(f)))(st.links.result))); } catch { linked = null; }
    for (const m of validateS1cResult(linked, st, st.label)) need(false, `s1c: ${m}`);
    const rawFile = st.links?.raw, rawHash = st.retained?.raw?.sha256;
    need(rawFile && exists(rawFile, 'raw') && isHex(rawHash), 's1c: the raw recorder output is not retained and linked');
    if (rawFile && exists(rawFile, 'raw') && isHex(rawHash)) { let b = null; try { b = (read ?? ((f) => fs.readFileSync(f)))(rawFile); } catch { b = null; } need(b && sha256(b) === rawHash, 's1c: the retained raw recorder output does not hash to the stamp\'s sha256'); }
    if (!st.control) {
      need(!st.counts?.FAIL && !st.counts?.UNMEASURED && st.mesenStatus === 0, `s1c: a positive with ${st.counts?.FAIL ?? 0} FAIL / ${st.counts?.UNMEASURED ?? 0} UNMEASURED items (Mesen exit ${st.mesenStatus})`);
    } else if (st.declared?.outcome === 'caught') {
      need(Array.isArray(st.declared.mustFail) && st.declared.mustFail.length > 0 && st.declared.mustFail.every((i) => st.failed?.includes(i)), `s1c: control ${st.control} is declared caught by ${st.declared?.mustFail} but failed ${st.failed}`);
      need(typeof st.matchingPositive === 'string', 's1c: a control without its matching positive');
    } else {
      need(st.declared?.outcome === 'pass' && !st.counts?.FAIL && !st.counts?.UNMEASURED, `s1c: control ${st.control} declared a pass (${st.declared?.why}) but has FAIL/UNMEASURED items`);
      need(typeof st.matchingPositive === 'string', 's1c: a control without its matching positive');
    }
    for (const r of st.results) bad.push(...auditEmulator(r.emulatorStamp, name));
    need(typeof st.emulators?.jsnes?.na === 'string' && st.emulators.jsnes.na.length > 40, 's1c: jsnes is neither measured nor declared N/A with its source proof');
    return bad;
  }
  need(st.kind === 'cell-build', `unknown kind ${st.kind}`);
  need(isHex(st.romSha256) && isHex(st.projectSha256), 'ROM or project hash missing');
  need(st.header && st.streamRing !== undefined && st.ringConsts, 'header / STREAM_RING / constants missing');
  need(Number.isFinite(st.resources?.kernelLoFree) && Number.isFinite(st.resources?.kernelHiFree), 'kernel-lo/hi free missing');
  need(st.placement && st.placement.assembled, 'placement witness missing');
  if (st.gameType === 'rpg') need(st.resources?.battleRegionBytes !== null && st.resources?.battleRegionBytes !== undefined, 'RPG build without battle-region bytes');
  for (const r of st.results) bad.push(...auditEmulator(r.emulatorStamp, name));
  for (const r of st.results) bad.push(...auditCampaignResult(r, name));
  return bad;
}

/** A campaign result's own claims: the planned definition hashes to what it says, every required witness has its first-observing record (when the row
 *  claims coverage), an `unmeasured` row says why, and a Mesen Continue chain really was one invocation per power cycle with the user's saves untouched. */
export function auditCampaignResult(r, name) {
  const bad = [];
  const need = (cond, msg) => { if (!cond) bad.push(`${name}: ${r.scene}/${r.emu}: ${msg}`); };
  if (r.unmeasured !== undefined) { need(typeof r.unmeasured === 'string' && r.unmeasured.length > 8, 'an unmeasured row without its reason'); return bad; }
  if (!r.plan) {
    // an oracle (row 3) Mesen result has no plan, but it too runs in a private HOME and must attest that the user's own saves were untouched and say which process ran
    if (r.emu === 'mesen' && r.emulatorStamp) {
      need(r.userSavesUntouched === true, 'the oracle run does not attest that the user\'s own Mesen saves were untouched');
      need(Array.isArray(r.mesenChain) && r.mesenChain.length === 1 && r.mesenChain[0].status === 0 && r.mesenChain[0].pid && r.mesenChain[0].settingsSha256, 'the oracle run does not retain its one Mesen invocation (exit status 0, pid, settings hash)');
    }
    return bad;
  }
  const { sha256: claimed, projectSha256, ...planned } = r.plan;
  need(isHex(claimed) && claimed === sha256(JSON.stringify(planned)), 'the stamped plan does not hash to its own sha256 (the planned scene/sequence/witnesses were altered after the run)');
  need(isHex(projectSha256), 'the plan has no project hash');
  need(Array.isArray(planned.witnesses) && planned.witnesses.length > 0 && Array.isArray(planned.steps) && Array.isArray(planned.sequence), 'plan lacks steps, sequence or witnesses');
  const keys = Object.keys(r.witnessMap ?? {}).sort();
  need(JSON.stringify(keys) === JSON.stringify([...(planned.witnesses ?? [])].sort()), 'the witness map does not list exactly the planned witnesses');
  if (r.coverageOk && !r.sabotage) for (const [w, rec] of Object.entries(r.witnessMap ?? {})) need(rec && rec.label && rec.index >= 0, `witness ${w} passed coverage but has no first-observing record`);
  if (r.emu === 'mesen') {
    const cycles = (planned.steps ?? []).filter((x) => x.op === 'cycle').length;
    need(Array.isArray(r.mesenChain) && r.mesenChain.length === 1 + cycles, `a Mesen run with ${cycles} power cycle(s) must be ${1 + cycles} invocations, stamp has ${r.mesenChain?.length}`);
    need(r.userSavesUntouched === true, 'the run does not attest that the user\'s own Mesen saves were untouched');
    for (const c of r.mesenChain ?? []) need(c.status === 0 && c.pid && c.settingsSha256, `invocation ${c.n} lacks exit status 0, pid or settings hash`);
    if (cycles) need(r.mesenChain?.[0]?.persistence && r.mesenChain[0].persistence !== 'none' && Object.keys(r.mesenChain?.[1]?.seededSaves ?? {}).length > 0 && Object.keys(r.mesenChain?.[0]?.producedSaves ?? {}).length > 0, 'a power-cycle chain lacks its persisted save files (produced by 1, seeded into 2)');
  }
  return bad;
}

const baseKeys = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [path.basename(k), v]));

/**
 * Audits a certificate's directory pair; returns { ok, problems, byFile, index, mode }. EVERY linked file is resolved from the two directory arguments by file name (results, logs and
 * the raw recorder output from `logDir`; ring-0 comparisons and constituent stamps from `provDir`), never from the absolute paths the stamps recorded, so a certificate copied to another
 * machine or checkout audits where it lies. Read-only: it writes nothing (the CLI and the matrix write INDEX.json from the `index` it returns).
 *   opts.construct  true = the certificate is being BUILT (the matrix's own gate job, the matrix report): the hashes are computed in memory, any INDEX.json is ignored and the result's
 *                   `mode` is 'construct' (an UNFINALIZED result, never a verified certificate). It must be asked for explicitly.
 *   otherwise       VERIFY (the default): <provDir>/INDEX.json must exist and be readable, and its recorded hashes (stamps, logs, results, raw output) are checked against the files.
 *                   A missing or unreadable index is a PROBLEM, never a silent fallback to construction (round 3, finding 1).
 */
export function auditProvenance(provDir, logDir, opts = {}) {
  const problems = [];
  const byFile = new Map();
  const note = (f, ms) => { for (const m of ms) { problems.push(m); (byFile.get(f) ?? byFile.set(f, []).get(f)).push(m); } };
  const under = (dir, p) => (dir && p ? path.join(dir, path.basename(String(p))) : null);
  const resolveLink = (p, kind) => (kind === 'comparison' || kind === 'stamp' ? under(provDir, p) : under(logDir, p));
  const exists = (p, kind) => { const r = resolveLink(p, kind); return r ? fs.existsSync(r) : false; };
  const read = (p) => fs.readFileSync(under(logDir, p) ?? (() => { throw new Error('no log directory was supplied'); })());
  const files = fs.readdirSync(provDir).filter((f) => f.endsWith('.json') && f !== 'INDEX.json').sort();
  if (!files.length) problems.push(`${provDir}: no stamps at all`);
  if (!logDir) problems.push('no log directory was supplied: the results and logs the stamps link cannot be resolved');
  const index = { schema: 'ring-prov-index-4', stamps: {}, logs: {}, results: {}, counts: { stamps: files.length, built: 0, error: 0, comparisons: 0 } };
  const byLabel = new Map();
  for (const f of files) {
    const file = path.join(provDir, f);
    let st;
    try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { note(f, [`${f}: unreadable (${e.message})`]); continue; }
    if (st.label) byLabel.set(st.label, st);
    note(f, auditStamp(st, f, exists, read));
    index.stamps[f] = sha256(fs.readFileSync(file));
    if (st.kind === 'ring0-identity-comparison') index.counts.comparisons++; else index.counts[st.status === 'error' ? 'error' : 'built']++;
    for (const k of ['result', 'log', 'raw']) if (st.links?.[k] && exists(st.links[k], k)) (k === 'log' ? index.logs : index.results)[path.basename(st.links[k])] = sha256(fs.readFileSync(resolveLink(st.links[k], k)));
  }
  // a ring-0 comparison records the hash of each constituent's FINAL stamp: the file now in the provenance directory must still hash to it
  for (const st of files.map((f) => ({ f, st: (() => { try { return JSON.parse(fs.readFileSync(path.join(provDir, f), 'utf8')); } catch { return null; } })() }))) {
    if (st.st?.kind !== 'ring0-identity-comparison') continue;
    for (const side of ['pristine', 'patched']) {
      const c = st.st.constituents?.[side];
      const fileP = c?.stamp ? path.join(provDir, path.basename(c.stamp)) : null;
      if (fileP && fs.existsSync(fileP) && isHex(c.sha256) && sha256(fs.readFileSync(fileP)) !== c.sha256) note(st.f, [`${st.f}: the ${side} constituent stamp ${path.basename(c.stamp)} no longer hashes to the sha256 the comparison recorded`]);
    }
  }
  // a control's MATCHING POSITIVE must be in the same certificate and must itself have passed, validated from its own result the same way the control is (a control means nothing next
  // to a positive that was never shown to pass: the horizontal no-flash control is meaningful only once the horizontal 85-byte positive passes; a zero-item positive passes nothing)
  for (const st of byLabel.values()) {
    if (st.kind !== 's1c-run' || !st.control || !st.matchingPositive) continue;
    const f = `${st.label}.json`;
    const pos = byLabel.get(st.matchingPositive);
    if (!pos) { note(f, [`${st.label}: its matching positive ${st.matchingPositive} is not in this certificate`]); continue; }
    if (!(pos.kind === 's1c-run' && !pos.control && pos.status === 'built' && pos.verdictOk === true && pos.row === st.row && pos.cell === st.cell && pos.gameType === st.gameType && pos.placement === st.placement)) { note(f, [`${st.label}: its matching positive ${st.matchingPositive} did not pass`]); continue; }
    let res = null;
    try { res = JSON.parse(String(read(pos.links?.result))); } catch { res = null; }
    const v = validateS1cResult(res, pos, pos.label);
    if (v.length) note(f, [`${st.label}: its matching positive ${st.matchingPositive} is not valid evidence: ${v[0]}`]);
  }
  if (logDir && fs.existsSync(logDir)) for (const f of fs.readdirSync(logDir).filter((x) => x.endsWith('.log'))) index.logs[f] ??= sha256(fs.readFileSync(path.join(logDir, f)));
  // a finalized certificate: verify the recorded hashes (construct mode reads no index and so is not one)
  const indexFile = path.join(provDir, 'INDEX.json');
  const mode = opts.construct ? 'construct' : 'verify';
  if (mode === 'verify') {
    let rec = null;
    if (!fs.existsSync(indexFile)) problems.push(`INDEX.json is missing: ${provDir} is not a finalized certificate (verification never falls back to construction; construction must be requested explicitly)`);
    else {
      let parsed;
      try { parsed = JSON.parse(fs.readFileSync(indexFile, 'utf8')); rec = parsed; } catch (e) { problems.push(`INDEX.json is unreadable (${e.message})`); }
      if (rec !== null && (typeof rec !== 'object' || Array.isArray(rec))) { problems.push('INDEX.json is not an index object'); rec = null; }
      else if (rec === null && parsed === null) problems.push('INDEX.json is not an index object');
    }
    if (rec) {
      for (const sec of ['stamps', 'logs', 'results']) {
        const recorded = baseKeys(rec[sec]), now = index[sec];
        for (const k of new Set([...Object.keys(recorded), ...Object.keys(now)])) {
          if (!(k in recorded)) problems.push(`INDEX.json ${sec}: ${k} is on disk but was never recorded (added after the certificate was finalized)`);
          else if (!(k in now)) problems.push(`INDEX.json ${sec}: ${k} is recorded but absent or no longer linked`);
          else if (recorded[k] !== now[k]) problems.push(`INDEX.json ${sec}: ${k} does not hash to the recorded ${recorded[k].slice(0, 12)} (now ${now[k].slice(0, 12)})`);
        }
      }
    }
  }
  return { ok: !problems.length, problems, byFile, index, mode };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  const known = ['--verify', '--construct'];
  const bad = argv.filter((a) => a.startsWith('--') && !known.includes(a));
  const verify = argv.includes('--verify'), construct = argv.includes('--construct');
  const [prov, logs] = argv.filter((a) => !a.startsWith('--'));
  if (!prov || !logs || bad.length || verify === construct) {
    console.error('usage: ringprovindex.mjs <prov-dir> <log-dir> --verify | --construct   (exactly one; --verify: read-only, INDEX.json must exist and its recorded hashes must hold; --construct: INDEX.json is (re)written, an UNFINALIZED certificate)');
    process.exit(2);
  }
  const r = auditProvenance(path.resolve(prov), path.resolve(logs), { construct });
  if (construct) fs.writeFileSync(path.join(prov, 'INDEX.json'), JSON.stringify(r.index, null, 1));
  for (const p of r.problems.slice(0, 40)) console.log(`PROBLEM ${p}`);
  console.log(`provenance audit (${construct ? 'construct mode: INDEX.json written, UNFINALIZED' : 'verify: recorded hashes checked'}): ${r.index.counts.stamps} stamps (${r.index.counts.built} built, ${r.index.counts.error} error, ${r.index.counts.comparisons} ring-0 comparisons), ${r.problems.length} problems`);
  process.exit(r.ok ? 0 : 1);
}
