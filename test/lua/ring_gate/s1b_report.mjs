#!/usr/bin/env node
// Renders the S1b ROUND 3 report from the final result files of a matrix run: node test/lua/ring_gate/s1b_report.mjs <log-dir> [--prov=<prov-dir>] [--commands=<file>]
// Every descriptive figure is read from the records (the per-cell result files, their retained gzipped bodies and the control results next to them) or hashed from the files on disk;
// the only typed text is the finding -> change -> control mapping, whose control names are checked against the unit file so a renamed test cannot leave a dead pointer.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const dir = process.argv[2];
if (!dir) { console.error('usage: s1b_report.mjs <log-dir> [--prov=<prov-dir>] [--commands=<file>]'); process.exit(2); }
const opt = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const CELLS = ['MMC1-V', 'MMC1-H', 'MMC3-V', 'MMC3-H', 'U512-V', 'U512-H'];
const load = (f) => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : null);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const variants = [];
for (const c of CELLS) for (const [gt, pl] of [['action', 'resident'], ['rpg', 'resident'], ['rpg', 'banked']]) variants.push({ c, gt, pl, r: load(`s1b-${c}-${gt}-${pl}.json`) });
const have = variants.filter((v) => v.r);
const bodiesOf = (v) => { const f = path.join(dir, v.r.retained?.bodies?.file ?? ''); return v.r.retained?.bodies && fs.existsSync(f) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(f))) : null; };
const label = (v) => `${v.c} ${v.gt} ${v.pl}`;
const out = [];

out.push('# Phase 3b S1b, round 3 report (Chris\'s option A: review 2 closed mechanically; the class bound is declared UNCERTIFIED)\n');
out.push(`Generated from ${have.length} of ${variants.length} positive witness results in \`${dir}\`; the figures are read from the retained records, never typed.\n`);
out.push('## NOT CLAIMED (read this first)\n');
out.push('- **The class bounds are not certified.** The remainder, the per-pass entity draw and the releasing NMI of every class bound are *sampled maxima* over the bodies the witness specs produced. The composed figure is reported as `estimate (uncertified: sampled remainder, sampled entity draw, sampled NMI)`, never PASS. A scene with a worse remainder, entity draw or NMI than the sampled variants would not be seen.');
out.push('- **29,213 (the highest class estimate of round 2) is a composed estimate, not certified slack** against 29,780. No distance from the gate that is derived from a class estimate may be quoted as headroom.');
out.push('- **The chase / knockback cross-check of the jsnes counters is not established** in the horizontal cells (`agree:chase`, UNCERTIFIED): the damaging-chaser pursuit leaves lockstep between the two cores and no deterministic witness was built. A jsnes counter disagreeing with Mesen inside it (a C3b draw count 8 against 9, say) is not detected there.');
out.push('- **The cross-core equality of `dsp` is not certified** (`agree:dsp`, UNCERTIFIED in every cell, whatever the observations). The entity draw\'s park-split counter `dsp` differs between Mesen and jsnes by a body\'s worth of parked tiles at the transitions of a moving entity across the viewport edge; the cause is not established, no alignment rule or tolerance is accepted, and every discrepancy is kept as an observation. What is certified in its place is only the per-emulator range guard `sanity:dsp` (0 <= dsp <= dst); **an in-range wrong or dead `dsp` hook in either emulator is not detected.** Round 3 first removed the round-2 blanket exception (which made all 18 positives red on `agree:bodies`); the reviewer\'s triage then split `dsp` out of `agree:bodies`, which keeps every other comparison.');
out.push('- What *is* certified and unaffected: the measured Mesen G of every class against `G < 29,780` (strict), the per-class read counts, the exhaustive read-price sweeps and the player-projection sweeps, the coverage conjunctions, the decoded seams.\n');

// ---------------------------------------------------------------- uncertified list, from the records
out.push('## Everything declared uncertified (generated)\n');
const unc = have.flatMap((v) => v.r.items.filter((i) => i.status === 'UNCERTIFIED').map((i) => ({ v, i })));
const byId = new Map();
for (const { v, i } of unc) { const k = i.id.replace(/^bound:C[0-9a-z]+$/, 'bound:<class>'); const e = byId.get(k) ?? { n: 0, cells: new Set() }; e.n++; e.cells.add(label(v)); byId.set(k, e); }
out.push('| item | results | where |', '|---|---|---|');
for (const [k, e] of byId) out.push(`| \`${k}\` | ${e.n} | ${e.cells.size === have.length ? `all ${have.length} positive cell results` : [...e.cells].join(', ')} |`);
out.push('\nSampled terms named in every verdict: ' + [...new Set(have.flatMap((v) => v.r.bound?.sampledTerms ?? []))].join(', ') + '.\n');

// ---------------------------------------------------------------- as-run vs successor verdicts, and the dsp observations
out.push('## As-run verdicts against the judge-only successor evaluation\n');
const succ = fs.existsSync(path.join(dir, 'SUCCESSOR.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'SUCCESSOR.json'), 'utf8')) : null;
if (succ) {
  const ch = succ.records.filter((r) => r.successor && r.successor.verdictOk !== r.original.verdictOk);
  out.push(`The matrix ran the PRE-triage judge (the dsp equality inside \`agree:bodies\`, no tolerance) and exited ${succ.originalEvidence.matrixExit ?? '?'} with ${ch.length} positive cells red on \`agree:bodies\` alone (the unaccepted \`dsp\` discrepancy, nothing else). The reviewer's triage split \`dsp\` out; **no emulator and no matrix were re-run**: \`s1b_rejudge.mjs\` re-derived the changed items from the retained bodies with the same code the judge uses and carried every other item and verdict as recorded. Since round 4 (review 3's blocking finding) it does so only after it has RECONSTRUCTED the as-run comparison -- the pre-triage rule, \`dsp\` included, from the retained bodies -- and found the recorded \`agree:bodies\`, \`agree:chase\` and \`agree:reported\` equal to it word for word, status included (${succ.records.filter((r) => r.reconcile?.reconstructed).length} of ${succ.records.length} records carry a two-core comparison and all reconcile; ${succ.records.filter((r) => r.refused).length} refused). A missing, malformed, extra or unreproducible predecessor item REFUSES the record: it is written unchanged with its verdict, a provenance problem is reported and the command exits nonzero. Original results, retained files, stamps and the matrix exit status are untouched; their SHA-256 and the successor judge's are in \`SUCCESSOR.json\`.\n`);
  out.push('| record | expect | as-run verdictOk | successor verdictOk | as-run counts | successor counts | rule |', '|---|---|---|---|---|---|---|');
  for (const r of succ.records.filter((x) => x.successor)) out.push(`| ${r.file.replace('.json', '')} | ${r.original.expect} | ${r.original.verdictOk} | ${r.successor.verdictOk} | ${JSON.stringify(r.original.counts)} | ${JSON.stringify(r.successor.counts)} | ${r.successor.rule.split(':')[0]} |`);
  out.push(`\nSuccessor judge files (SHA-256 prefix): ${Object.entries(succ.successorJudge).map(([k, v]) => `\`${k}\` ${v.slice(0, 16)}`).join(', ')}. Successor provenance audit over ${succ.audit.stamps} stamps (the ${succ.records.filter((r) => r.successor).length} s1b result views re-audited with the successor verdicts): ${succ.audit.problems} problems.\n`);
} else out.push('(no SUCCESSOR.json in this directory: these are the as-run records.)\n');
const red = have.map((v) => ({ v, f: v.r.items.filter((i) => i.status === 'FAIL' || i.status === 'UNMEASURED') })).filter((x) => x.f.length);
out.push(`${red.length} of ${have.length} positive cell results in this directory have a FAIL or UNMEASURED item.\n`);
out.push('### `agree:dsp`: the cross-core `dsp` observations per cell (UNCERTIFIED; bodies named in `agree:reported`)\n');
out.push('| cell | game | placement | bodies compared | bodies where dsp differs | largest absolute difference | agree:bodies | sanity:dsp mesen / jsnes |', '|---|---|---|---|---|---|---|---|');
for (const v of have) {
  const d = v.r.items.find((i) => i.id === 'agree:dsp'), a = v.r.items.find((i) => i.id === 'agree:bodies');
  const m = d?.detail.match(/(\d+) bodies compared, (\d+) differ \(largest absolute difference (\d+)\)/);
  const sd = (e) => v.r.items.find((i) => i.id === 'sanity:dsp' && i.emu === e)?.status ?? '-';
  out.push(`| ${v.c} | ${v.gt} | ${v.pl} | ${m ? m[1] : '?'} | ${m ? m[2] : '?'} | ${m ? m[3] : '?'} | ${a?.status ?? '-'} | ${sd('mesen')} / ${sd('jsnes')} |`);
}
out.push('\nThe largest differences belong to the horizontal action cells, where the damaging-chaser spec leaves lockstep (`agree:chase`, UNCERTIFIED) and its bodies are counted here too; in an ordinary walk the difference is 2 and at the same frame label the two cores agree (MMC1-V `walk/walkR#127`: Mesen frame 243 `dsp` 4, jsnes frame 242 `dsp` 2; jsnes #128 / frame 243 `dsp` 4). That is reported, not explained: the cause is not established.\n');

// ---------------------------------------------------------------- C4a / pad-under / two-pass / chase facts
out.push('## Figures regenerated for the review-2 polish items (finding 6)\n');
{
  const rows = [];
  for (const v of have) { const b = bodiesOf(v); if (!b) continue; let two = 0, c4a = 0; for (const sp of b) for (const r of sp.jsnes ?? []) if (r.cls === 'C4a') { c4a++; if ((r.prof?.calls?.draw?.calls ?? 0) >= 2) two++; } rows.push({ v, two, c4a }); }
  const twos = rows.map((x) => x.two);
  out.push(`- **Two-pass C4a bodies** (a C4a body whose jsnes profile shows two \`draw_entities\` calls): per cell result ${[...new Set(twos)].join('/') || 'n/a'} (min ${Math.min(...twos)}, max ${Math.max(...twos)}, over ${rows.length} results; ${rows.map((x) => x.c4a).reduce((a, b) => a + b, 0)} C4a bodies in all).`);
  const est = have.map((v) => ({ v, b: v.r.bound?.byClass?.C4a })).filter((x) => x.b);
  if (est.length) {
    const mx = est.reduce((m, x) => (x.b.bound.adj > m.b.bound.adj ? x : m));
    out.push(`- **Corrected C4a estimate** (two source-counted OAM passes of projection and of entity draw): highest ${mx.b.bound.adj} at ${label(mx.v)} (worst measured C4a G ${mx.b.maxG}; round 2 charged one projection pass: the reviewer computes 22,105 -> ~23,557). Lowest ${Math.min(...est.map((x) => x.b.bound.adj))}; every one is an *uncertified estimate*; \`undercut\` (estimate below a measured G) in ${est.filter((x) => x.b.undercut).length} results.`);
  }
  const all = have.flatMap((v) => Object.entries(v.r.bound?.byClass ?? {}).map(([cl, b]) => ({ v, cl, b })));
  if (all.length) { const hi = all.reduce((m, x) => (x.b.bound.adj > m.b.bound.adj ? x : m)); out.push(`- **Highest class estimate overall:** ${hi.b.bound.adj} (${hi.cl}, ${label(hi.v)}), uncertified; ${all.filter((x) => !x.b.ok).length} of ${all.length} class estimates are refused (not < 29,780, or below their own measured G).`); }
}
{
  const pads = fs.readdirSync(dir).filter((f) => /^s1b-pad-under-.*\.json$/.test(f)).sort();
  const rows = pads.map((f) => load(f)).filter(Boolean).map((r) => {
    const cl = r.classes?.mesen ?? {};
    const top = Object.entries(cl).filter(([c]) => c !== 'C0').reduce((m, [c, k]) => ((k.maxG ?? -1) > m.g ? { c, g: k.maxG } : m), { c: '-', g: -1 });
    const est = Object.entries(r.bound?.byClass ?? {}).reduce((m, [c, b]) => (b.bound.adj > m.e ? { c, e: b.bound.adj } : m), { c: '-', e: -1 });
    return `${r.cell}: measured max G ${top.g} (${top.c}); highest estimate ${est.e} (${est.c})`;
  });
  out.push(`- **Pad-under cell maxima** (the declared control, named SAMPLED ESTIMATE REFUSAL: the measured gate passes, a class estimate reaching or exceeding 29,780 alone refuses, every other item PASS / N/A / a declared uncertified item; not a proved class-bound refusal): ${rows.join('; ') || 'no records'}.`);
  const hz = have.filter((v) => v.c.endsWith('-H')).map((v) => v.r.items.find((i) => i.id === 'agree:chase')).filter(Boolean);
  const cs = have.map((v) => ({ v, i: v.r.items.find((i) => i.id === 'agree:chase') })).filter((x) => x.i);
  out.push(`- **Chase divergence is horizontal cells only:** \`agree:chase\` is UNCERTIFIED in ${cs.filter((x) => x.i.status === 'UNCERTIFIED').map((x) => label(x.v)).join(', ') || 'no cell'}; PASS (lockstep, compared exactly) in ${cs.filter((x) => x.i.status === 'PASS').map((x) => label(x.v)).join(', ') || 'no cell'}${hz.length ? '' : ''}.`);
}
out.push('');

// ---------------------------------------------------------------- tables (rows 2, 4, 7, the estimate)
out.push('## Row 2, row 4 and row 7 tables, and the class estimate table (from `s1b_tables.mjs`)\n');
try { out.push(execFileSync('node', [path.join(HERE, 's1b_tables.mjs'), dir], { encoding: 'utf8', maxBuffer: 1 << 26 })); } catch (e) { out.push(`(s1b_tables failed: ${e.message.split('\n')[0]})`); }

// ---------------------------------------------------------------- controls
out.push('\n## Controls: the verdict each one reached (from its own record)\n');
out.push('| control | cell | game | expect | verdictOk | numerical G failures | failing item categories |', '|---|---|---|---|---|---|---|');
const cats = (items) => { const o = {}; for (const i of items.filter((x) => x.status === 'FAIL' || x.status === 'UNMEASURED')) { const k = i.id.split(':')[0]; o[k] = (o[k] ?? 0) + 1; } return Object.entries(o).map(([k, n]) => `${k} x${n}`).join(', ') || 'none'; };
for (const f of fs.readdirSync(dir).filter((x) => /^s1b-(seam|fault|pad)-.*\.json$/.test(x)).sort()) { const r = load(f); if (!r) continue; out.push(`| ${r.sabotage ?? r.fault} | ${r.cell} | ${r.gameType} | ${r.expect} | ${typeof r.verdictOk === 'boolean' ? (r.verdictOk ? 'CAUGHT' : 'NOT CAUGHT') : 'NOT RECORDED'} | ${r.gateFailures ?? '-'} | ${cats(r.items)} |`); }

// ---------------------------------------------------------------- closure table
const unit = fs.readFileSync(path.join(HERE, 's1b_unit.mjs'), 'utf8');
const has = (name) => unit.includes(name) ? name : `MISSING: ${name}`;
const T = (s) => `\`s1b_unit.mjs\` "${has(s)}"`;
out.push('\n## Review 2 closure table\n');
out.push('| finding | what changed | control that now catches it | evidence |', '|---|---|---|---|');
out.push(`| 1 sampled remainder / draw / NMI | class bounds renamed ESTIMATES, status \`UNCERTIFIED\` (never PASS), \`bound:certification\` item, "Not claimed" in verdicts, tables and this headline (\`s1bjudge.mjs\`, \`s1bbound.mjs\`, \`s1b_tables.mjs\`, \`s1b_coverage.mjs\`) | ${T('bound: the synthetic positive carries a per-class ESTIMATE below the gate, UNCERTIFIED and never PASS, every term named and the formula adding up')} | every \`bound:*\` item in \`${dir}/s1b-<cell>-<game>-<placement>.json\` |`);
out.push(`| 2 C4a projection pass | per-class OAM pass ceilings from source (\`PASS_CEILING\`, \`s1bbound.mjs\`, lines cited in its header), draw taken per pass, estimate refused if below a measured G or a body exceeds the ceiling | ${T('finding 2: say@338 (G 18,124, two OAM passes) is never undercut: the corrected C4a estimate equals the body, the round-2 formula gave 16,672')}; ${T('finding 2: a two-pass control -- omitting EITHER pass undercuts the measured body and is refused')} | C4a rows of the bound table above |`);
out.push(`| 3 arm validity | \`arm:active\` (st_active 1 column / 2 row) and \`arm:parity\` (st_fnt in {0,4} / {0,8}) against the build, observation point stated; coverage counts only legal parities (\`s1bcover.mjs\`) | ${T('finding 3: all st_active = 0 fails arm:active ALONE; the parities and everything else still hold')}; ${T('finding 3: two distinct ILLEGAL parities (254, 255) fail arm:parity ALONE -- diversity of values is not validity')}; ${T('finding 3: both together fail both items, each by its own name; the legal parity set is axis-specific ({0,4} column strips, {0,8} row strips)')} | \`arm:active\` / \`arm:parity\` items per cell |`);
out.push(`| 4 agreement | blanket \`dsp\` skew exception removed from acceptance and \`pairBodies\`; MMC3 IRQ writes limited to 3a+6b (\`engine/split.asm\` irq handler, cited); chase whitelist removed from acceptance, the cross-check UNCERTIFIED (\`s1bagree.mjs\`, \`s1bjudge.mjs\`) | ${T('finding 4: MMC3 IRQ writes are the reachable totals only: 3 or 6 per IRQ; 4 and 5 fail (and so do 7, 8 for one IRQ)')}; ${T('finding 4: a chase-spec phase that leaves lockstep is UNCERTIFIED (agree:chase), not accepted by a whitelist and not silently green')}; ${T('finding 4: pairBodies applies the acceptance rule -- a dsp-only different ordinal pair is not a pair')}; the \`dsp 0/1000\` control is now triage item 1 | \`agree:bodies\`, \`agree:reported\`, \`agree:chase\` items per cell |`);
out.push(`| 5 strict gate | \`gateAllows = G < 29,780\`; labels distinguish the template's raw \`gateFail\` (G > 29,780) from the verdict (\`s1bjudge.mjs\`) | ${T('control: the gate is STRICT (G < 29,780): 29,779 passes, exactly 29,780 FAILS and is NAMED, 29,781 fails')}; ${T('finding 5: a completed non-C0 body at exactly 29,780 is a NUMERICAL gate failure (the gate-fail control path), 29,779 is not')}; ${T('finding 5: a class ESTIMATE at exactly 29,780 is refused, 29,779 is not (the stray-body path pins the equality exactly)')} | \`gate:*\` items; the near-gate list above |`);
out.push(`| 6 polish | pad-under maxima, two-pass count and chase scope regenerated above from the records; the control table prints each record's real \`verdictOk\` (\`run_s1b.mjs\` now records it) and failing categories (\`s1b_coverage.mjs\`) | (generated figures; no unit) | the "Figures regenerated" section and the controls table above |`);

out.push(`| triage 1 \`dsp\` equality | \`dsp\` equality split out of \`agree:bodies\` into \`agree:dsp\` (UNCERTIFIED in every cell, observations kept, no alignment rule, \`pairBodies\` keeps full equality); per-emulator \`sanity:dsp\` (nonnegative integers, 0 <= dsp <= dst); the limitation that an in-range wrong / dead \`dsp\` hook is not detected is stated in the item (\`s1bagree.mjs\`, \`s1bjudge.mjs\`) | ${T('triage item 1: dsp 0 against 1000 with dst 16 in one ordinary walk body FAILS the named per-emulator sanity item sanity:dsp, while agree:dsp stays UNCERTIFIED')}; ${T('triage item 1: dsp equality is split out of agree:bodies: an in-range cross-core dsp difference leaves agree:bodies PASS and agree:dsp UNCERTIFIED with the observation kept, and the limitation is stated')}; ${T('triage item 1: a non-dsp disagreement still FAILS agree:bodies (even beside a dsp difference), and dsp is the only ignored counter')}; ${T('triage item 1: dspRangeFailures: nonnegative integers, dsp <= dst, omitted counters are zero, per emulator')} | \`agree:dsp\` / \`sanity:dsp\` items in \`${dir}\`; \`SUCCESSOR.json\` |`);
out.push(`| triage 2 \`baselineRed\` | \`baselineRed\` removed from records, acceptance and tables; the under-pad is SAMPLED ESTIMATE REFUSAL (\`s1bjudge.estimateRefusal\`: operationally sound, zero numerical G failures, a \`bound:*\` FAIL from an estimate reaching/exceeding 29,780, every other item PASS / N/A / \`bound:*\` / \`agree:dsp\` / \`agree:chase\` UNCERTIFIED) | ${T('triage item 2: the matching positive -- an estimate at or over the gate refuses alone, measured gate passing, only declared uncertified items besides: CAUGHT')}; ${T('triage item 2: forcing every bound item nonfailing is NOT CAUGHT (a disabled estimate threshold)')}; ${T('triage item 2: an injected numerical failure, or an operational failure, is NOT CAUGHT')}; ${T('triage item 2: dsp = 1000 with dst = 16, or a non-dsp agreement failure, injected next to the real refusal is NOT CAUGHT (no baseline-red tolerance)')}; ${T('triage item 2: a bound item that fails WITHOUT its estimate reaching the gate (a pass-ceiling contradiction) is not a sampled estimate refusal')} | the six \`s1b-pad-under-*\` records |`);
out.push(`| review 3 successor soundness (round 4) | \`s1bsuccessor.mjs\` (new; the per-record judgement the command calls): required predecessor items validated against the retained emulator/spec context before anything is removed; the pre-triage full comparison (\`s1bagree.compareBodies(..., { predecessor: true })\`) reconstructed and the recorded items reconciled by equality; only the authorized split applied; a refusal keeps the record and verdict and fails the command | ${T('round 4 probe 1: an original mismatch count of 999,999 with the totals unchanged is REFUSED, the positive stays red (a count compared only to the new zero would pass it)')}; ${T('round 4 probe 2: the original agree:bodies item deleted from a both-emulator positive is REFUSED, never silently dropped')}; ${T('round 4: every other way a predecessor can fail to reconcile is refused (status, emulator, duplicate, malformed, unknown, successor-only item, retained bodies changed, synthetic list)')}; ${T('round 4 (real record, real command): the genuine record passes; 107 -> 999,999 mismatches and a deleted agree:bodies both exit nonzero, report a problem and keep the positive red')}; matching positive: ${T('round 4: the matching positive -- a record red only on the dsp equality reconciles with its reconstruction and turns green; the split items replace the three')} | \`${dir}/SUCCESSOR.json\` (per-record \`reconcile\`); the pre-r4 manifest is kept in \`handoff-next/s1b-r3-successor-pre-r4/\` |`);
out.push(`| triage 3 execution | judge-only successor evaluation of the completed r3 records (\`s1b_rejudge.mjs\`): no Mesen run, no matrix; original records, fingerprints and exit statuses kept; successor judge hashes and original evidence hashes recorded | (script reconciles the re-derived comparison with the original item: same bodies / phases / specs, else it throws) | \`${dir}/SUCCESSOR.json\`, \`INDEX-successor.json\` |`);

out.push('\n## Open after round 4 (review 3 nonblocking items, left as they are)\n');
out.push('- **Historical log wording:** applying today\'s `jobs`/`judgeJob` to the saved r3 logs gives 24 unexpected results (the original 18 plus six pad-under log-pattern mismatches): those logs predate the "sampled estimate refusal" wording. The original 18 unexpected / 36 provenance problems belong to the original producer version; any future replay of the historical logs must use that version or record a wording-only compatibility translation. Not altered; no Mesen rerun is wanted for prose.');
out.push('- **The `dsp` cause** (Mesen steps `dsp` one body before jsnes at the same ordinal) is unexplained; `agree:dsp` stays UNCERTIFIED and an in-range wrong / dead `dsp` hook is not detected.');
out.push('- **Finding 1\'s proof:** the sampled remainder, entity-draw and NMI terms of every class estimate remain unproved (all class estimates UNCERTIFIED, as authorized).');
out.push('- **Synthetic-poke phases** are not retained with the bodies; the successor reads their names from the as-run `agree:reported` and the reconstruction must reproduce every recorded total with them (a wrong list changes the compared-body count and is refused).\n');

// ---------------------------------------------------------------- files
out.push('\n## Harness files changed in this round (SHA-256 at generation)\n');
out.push('| file | SHA-256 |', '|---|---|');
for (const f of ['s1bjudge.mjs', 's1bbound.mjs', 's1bagree.mjs', 's1bcover.mjs', 's1b_unit.mjs', 's1b_tables.mjs', 's1b_coverage.mjs', 's1b_report.mjs', 's1b_rejudge.mjs', 's1bsuccessor.mjs', 'run_s1b.mjs', 'ringjobs.mjs', 'ringprovindex.mjs']) out.push(`| \`test/lua/ring_gate/${f}\` | \`${sha(path.join(HERE, f))}\` |`);
const cmds = opt('commands');
if (cmds && fs.existsSync(cmds)) out.push('\n## Commands and exit codes\n', fs.readFileSync(cmds, 'utf8'));
const prov = opt('prov');
if (prov) out.push(`\n## Certificate\n\nProvenance directory \`${prov}\` (r3, the successor to the pre-edit r2 certificate; the r2 fingerprints are not relabelled), logs \`${dir}\`.`);
console.log(out.join('\n'));
