// The provenance AUDIT of a certificate run (review 2 finding 3): every stamp in <prov-dir> must be complete, linked to the log and result file
// that produced it, and carry what a certified build must (inputs, resources, placement, the emulator implementation that judged it). Writes
// <prov-dir>/INDEX.json (sha256 of every stamp, log and result) and exits nonzero on any problem.
//   node test/lua/ring_gate/ringprovindex.mjs <prov-dir> <log-dir>
import { auditChain } from './ringhome.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256 } from './ringtree.mjs';
import zlib from 'node:zlib';
import { relationshipFailures, requiredEvidence } from './s1bagree.mjs';
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

/** Audits one stamp object; returns problem strings. `exists(p)` says whether a linked file exists. */
export function auditStamp(st, name, exists, read = undefined) {
  const bad = [];
  const need = (cond, msg) => { if (!cond) bad.push(`${name}: ${msg}`); };
  need(st.schema === 'ring-prov-3', `schema ${st.schema}`);
  if (st.kind === 'ring0-identity-comparison') {
    need(st.status === 'built', `comparison status ${st.status}`);
    for (const side of ['pristine', 'patched']) {
      const c = st.constituents?.[side];
      need(c?.stamp && exists(c.stamp), `${side} constituent stamp ${c?.stamp} missing`);
      need(isHex(c?.sha256), `${side} constituent has no sha256`);
    }
    need(isHex(st.pristineRomSha256) && isHex(st.patchedRomSha256), 'ROM hashes missing');
    need(st.equal === true, 'the six-fixture STREAM_RING=0 comparison is not equal');
    need(st.links?.result && exists(st.links.result), 'comparison does not link an existing result file');
    need(st.links?.log && exists(st.links.log), 'comparison does not link an existing log file');
    need(st.harness && Object.keys(st.harness).length > 20, 'no harness fingerprint');
    return bad;
  }
  need(['built', 'error'].includes(st.status), `status ${st.status} (an attempt that never completed)`);
  need(st.attempt?.startedAt && st.harness && Object.keys(st.harness).length > 20, 'no attempt record / harness fingerprint');
  need(st.head && st.baseline && Array.isArray(st.patches), 'head, baseline or patches missing');
  need(st.links?.result && exists(st.links.result), `links.result ${st.links?.result} missing or not on disk`);
  need(st.links?.log && exists(st.links.log), `links.log ${st.links?.log} missing or not on disk`);
  need(st.nesasm?.sha256 && st.host?.kernel, 'assembler or host stamp missing');
  need(Array.isArray(st.results) && st.results.length >= 1, 'no result linked: the stamp never reached a verdict');
  if (st.status === 'error') {
    need(st.error?.firstLine, 'error stamp without the error text');
    return bad;
  }
  if (st.kind === 'ring0-build') {
    need(isHex(st.romSha256) && isHex(st.projectSha256), 'ring-0 build: ROM or project hash missing');
    need(st.resources?.bankUsage && Object.keys(st.resources.bankUsage).length > 0, 'ring-0 build: no resources');
    need(st.links?.comparison && exists(st.links.comparison), 'ring-0 build: comparison not linked');
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
    if (st.links?.result && exists(st.links.result) && st.retained !== undefined) bad.push(...auditRetained(st, name, st.links.result, read));
    else if (st.expect === 'pass') need(false, 's1b: a positive stamp without its retained per-body records');
    for (const r of st.results) bad.push(...auditEmulator(r.emulatorStamp, name));
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

/** Audits a directory pair; returns { ok, problems, index }. */
export function auditProvenance(provDir, logDir) {
  const problems = [];
  const exists = (p) => fs.existsSync(p);
  const files = fs.readdirSync(provDir).filter((f) => f.endsWith('.json') && f !== 'INDEX.json').sort();
  if (!files.length) problems.push(`${provDir}: no stamps at all`);
  const index = { schema: 'ring-prov-index-3', stamps: {}, logs: {}, results: {}, counts: { stamps: files.length, built: 0, error: 0, comparisons: 0 } };
  for (const f of files) {
    const file = path.join(provDir, f);
    let st;
    try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { problems.push(`${f}: unreadable (${e.message})`); continue; }
    problems.push(...auditStamp(st, f, exists));
    index.stamps[f] = sha256(fs.readFileSync(file));
    if (st.kind === 'ring0-identity-comparison') index.counts.comparisons++; else index.counts[st.status === 'error' ? 'error' : 'built']++;
    for (const k of ['result', 'log']) if (st.links?.[k] && exists(st.links[k])) (k === 'log' ? index.logs : index.results)[st.links[k]] = sha256(fs.readFileSync(st.links[k]));
  }
  if (logDir && fs.existsSync(logDir)) for (const f of fs.readdirSync(logDir).filter((x) => x.endsWith('.log'))) {
    const p = path.join(logDir, f);
    index.logs[path.resolve(p)] ??= sha256(fs.readFileSync(p));
  }
  return { ok: !problems.length, problems, index };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [prov, logs] = process.argv.slice(2);
  if (!prov) { console.error('usage: ringprovindex.mjs <prov-dir> <log-dir>'); process.exit(2); }
  const r = auditProvenance(path.resolve(prov), logs ? path.resolve(logs) : null);
  fs.writeFileSync(path.join(prov, 'INDEX.json'), JSON.stringify(r.index, null, 1));
  for (const p of r.problems.slice(0, 40)) console.log(`PROBLEM ${p}`);
  console.log(`provenance audit: ${r.index.counts.stamps} stamps (${r.index.counts.built} built, ${r.index.counts.error} error, ${r.index.counts.comparisons} ring-0 comparisons), ${r.problems.length} problems`);
  process.exit(r.ok ? 0 : 1);
}
