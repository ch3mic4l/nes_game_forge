#!/usr/bin/env node
// The JUDGE-ONLY successor evaluation of a completed S1b matrix (reviewer's triage ruling on round 3): no emulator, no Mesen, no matrix. It takes the ORIGINAL records (the per-cell result files, their
// retained gzipped bodies and the stamps), re-derives from the retained bodies exactly the items whose rule the triage changed -- agree:bodies / agree:chase / agree:reported (dsp split out), the new
// agree:dsp (UNCERTIFIED) and the per-emulator sanity:dsp -- with the SAME functions the judge uses (s1bjudge.agreementItems, s1bagree.dspRangeFailures), carries every other item unchanged, recomputes
// the verdicts the changed items can move (a positive: no FAIL/UNMEASURED; an under-pad: s1bjudge.estimateRefusal) and carries every other verdict as recorded.
//   node test/lua/ring_gate/s1b_rejudge.mjs <orig-log-dir> <orig-prov-dir> <out-dir>
// Writes <out-dir>/<same file names> (successor result files + the unchanged retained files), <out-dir>/SUCCESSOR.json (successor judge hashes, original evidence hashes, per-record before/after,
// the reconciliation against the original items, and the successor provenance audit) and <out-dir>/INDEX-successor.json. Nothing in the original directories is modified.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { rejudgeRecord } from './s1bsuccessor.mjs';
import { auditStamp } from './ringprovindex.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [logDir, provDir, outDir] = process.argv.slice(2).map((p) => (p ? path.resolve(p) : p));
if (!logDir || !provDir || !outDir) { console.error('usage: s1b_rejudge.mjs <orig-log-dir> <orig-prov-dir> <out-dir>'); process.exit(2); }
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const shaFile = (f) => sha(fs.readFileSync(f));
if (fs.existsSync(outDir) && fs.readdirSync(outDir).length) { console.error(`${outDir} is not empty`); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

const refusals = [];
const records = [];
for (const f of fs.readdirSync(logDir).filter((x) => /^s1b-.*\.json$/.test(x)).sort()) {
  const rec = JSON.parse(fs.readFileSync(path.join(logDir, f), 'utf8'));
  const row = { file: f, original: { sha256: shaFile(path.join(logDir, f)), verdictOk: rec.verdictOk, counts: rec.counts, expect: rec.expect } };
  const bodiesRef = rec.retained?.bodies;
  if (!bodiesRef) { fs.copyFileSync(path.join(logDir, f), path.join(outDir, f)); row.carried = 'no retained bodies'; refusals.push(`${f}: no retained bodies to reconstruct the comparison from`); row.refused = ['no retained bodies']; records.push(row); continue; }
  const bodiesBuf = fs.readFileSync(path.join(logDir, bodiesRef.file));
  if (sha(bodiesBuf) !== bodiesRef.sha256) throw new Error(`${f}: retained bodies do not hash to the record's ${bodiesRef.sha256}`);
  const r = rejudgeRecord(rec, JSON.parse(zlib.gunzipSync(bodiesBuf)));
  for (const v of Object.values(rec.retained)) fs.copyFileSync(path.join(logDir, v.file), path.join(outDir, v.file));
  if (!r.ok) {
    // REFUSED: the record goes out exactly as recorded (the positive stays red) with the refusal attached, and the evaluation exits nonzero
    fs.writeFileSync(path.join(outDir, f), JSON.stringify({ ...rec, successor: { of: f, originalSha256: row.original.sha256, refused: r.reasons } }, null, 1));
    row.refused = r.reasons; row.successor = { verdictOk: rec.verdictOk, counts: rec.counts, rule: r.rule, sha256: shaFile(path.join(outDir, f)) };
    for (const why of r.reasons) refusals.push(`${f}: ${why}`);
    records.push(row); continue;
  }
  const newFails = r.fresh.filter((i) => i.status === 'FAIL').map((i) => `${i.emu}:${i.id}`);
  if (newFails.length && rec.expect !== 'pass') row.note = `changed items failing in a control record: ${newFails.join(', ')}`;
  if (r.reconcile?.reconstructed) row.reconcile = r.reconcile;
  if (r.refused) row.refused_classes = r.refused;
  const out = { ...rec, items: r.items, counts: r.counts, verdictOk: r.verdictOk, successor: { of: f, originalSha256: row.original.sha256, originalVerdictOk: rec.verdictOk, originalCounts: rec.counts, rule: r.rule, changedItems: r.fresh.map((i) => `${i.emu}:${i.id}`) } };
  fs.writeFileSync(path.join(outDir, f), JSON.stringify(out, null, 1));
  row.successor = { verdictOk: r.verdictOk, counts: r.counts, rule: r.rule, sha256: shaFile(path.join(outDir, f)) };
  row.statusDsp = { agreeDsp: r.fresh.find((i) => i.id === 'agree:dsp')?.detail.match(/(\d+) bodies compared, (\d+) differ \(largest absolute difference (\d+)\)/)?.slice(1).map(Number) ?? null, sanityDspFails: r.fresh.filter((i) => i.id === 'sanity:dsp' && i.status === 'FAIL').length };
  records.push(row);
}

// ---- the successor provenance audit: every s1b-witness stamp is audited with the successor verdict and counts; the retained files are the unchanged originals
const problems = [], index = { schema: 'ring-prov-index-successor-1', stamps: {}, results: {} };
const byResult = new Map(records.filter((r) => r.successor && !r.refused).map((r) => [path.join(logDir, r.file), r]));
const exists = (p) => fs.existsSync(p);
let audited = 0, swapped = 0;
for (const f of fs.readdirSync(provDir).filter((x) => x.endsWith('.json') && x !== 'INDEX.json').sort()) {
  const st = JSON.parse(fs.readFileSync(path.join(provDir, f), 'utf8'));
  index.stamps[f] = shaFile(path.join(provDir, f));
  audited++;
  const rec = st.kind === 's1b-witness' && st.links?.result ? byResult.get(path.resolve(st.links.result)) : null;
  if (rec) {
    swapped++;
    const view = { ...st, counts: rec.successor.counts, verdictOk: rec.successor.verdictOk, links: { ...st.links, result: path.join(outDir, rec.file), log: st.links.log } };
    problems.push(...auditStamp(view, f, exists));
    index.results[rec.file] = rec.successor.sha256;
  } else problems.push(...auditStamp(st, f, exists));
}
for (const why of refusals) problems.push(`reconciliation refused: ${why}`);
index.counts = { stamps: audited, successorViews: swapped, refused: refusals.length, problems: problems.length };
fs.writeFileSync(path.join(outDir, 'INDEX-successor.json'), JSON.stringify({ ...index, problems }, null, 1));

// ---- the manifest: successor judge hashes, original evidence hashes, before/after
const harness = ['s1bsuccessor.mjs', 's1bagree.mjs', 's1bjudge.mjs', 's1bbound.mjs', 's1bcover.mjs', 'run_s1b.mjs', 'ringjobs.mjs', 'ringprovindex.mjs', 's1b_rejudge.mjs', 's1b_unit.mjs'];
const evidence = {
  matrixExit: fs.existsSync(path.join(logDir, '..', 's1b-r3-matrix.exit')) ? fs.readFileSync(path.join(logDir, '..', 's1b-r3-matrix.exit'), 'utf8').trim() : null,
  matrixOut: fs.existsSync(path.join(logDir, '..', 's1b-r3-matrix.out')) ? shaFile(path.join(logDir, '..', 's1b-r3-matrix.out')) : null,
  originalProvenanceIndex: fs.existsSync(path.join(provDir, 'INDEX.json')) ? shaFile(path.join(provDir, 'INDEX.json')) : null,
  originalResults: Object.fromEntries(records.map((r) => [r.file, r.original.sha256])),
  originalRetained: Object.fromEntries(records.flatMap((r) => { const rec = JSON.parse(fs.readFileSync(path.join(logDir, r.file), 'utf8')); return Object.values(rec.retained ?? {}).map((v) => [v.file, v.sha256]); }))
};
const manifest = {
  schema: 's1b-successor-evaluation-1', kind: 'judge-only (no emulator, no matrix)', of: { logDir, provDir },
  successorJudge: Object.fromEntries(harness.map((h) => [h, shaFile(path.join(HERE, h))])), originalEvidence: evidence,
  records, audit: { stamps: audited, problems: problems.length, first: problems.slice(0, 20) }
};
fs.writeFileSync(path.join(outDir, 'SUCCESSOR.json'), JSON.stringify(manifest, null, 1));
const changed = records.filter((r) => r.successor && (r.successor.verdictOk !== r.original.verdictOk));
console.log(`successor evaluation: ${records.length} records (${records.filter((r) => r.successor).length} re-judged, ${changed.length} verdicts changed); provenance (successor views): ${audited} stamps, ${swapped} s1b views, ${problems.length} problems`);
for (const r of changed) console.log(`  ${r.file}: verdictOk ${r.original.verdictOk} -> ${r.successor.verdictOk} (${r.successor.rule})`);
for (const p of problems.slice(0, 20)) console.log(`PROBLEM ${p}`);
process.exit(problems.length ? 1 : 0);
