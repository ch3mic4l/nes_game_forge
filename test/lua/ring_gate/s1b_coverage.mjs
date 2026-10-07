#!/usr/bin/env node
// Renders the S1b ROUND 3 coverage document from the final result files of a matrix run: node test/lua/ring_gate/s1b_coverage.mjs <log-dir>
// Every descriptive claim is read from the records (the items of <log-dir>/s1b-<cell>-<gt>-<placement>.json and the sabotage / fault results next to them); nothing here is typed in.
import fs from 'node:fs';
import path from 'node:path';

const CELLS = ['MMC1-V', 'MMC1-H', 'MMC3-V', 'MMC3-H', 'U512-V', 'U512-H'];
const dir = process.argv[2];
if (!dir) { console.error('usage: s1b_coverage.mjs <log-dir>'); process.exit(2); }
const load = (f) => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : null);
const variants = [];
for (const c of CELLS) for (const [gt, pl] of [['action', 'resident'], ['rpg', 'resident'], ['rpg', 'banked']]) variants.push({ c, gt, pl, r: load(`s1b-${c}-${gt}-${pl}.json`) });
const out = [];
const have = variants.filter((v) => v.r);
out.push(`# S1b round 3: coverage, agreement, class estimate and seam evidence (generated from ${have.length} of ${variants.length} witness results in ${dir})\n`);
out.push('## Certification status (read this first)\n');
const cert = have.map((v) => v.r.bound?.certification).filter(Boolean);
const unc = have.flatMap((v) => v.r.items.filter((i) => i.status === 'UNCERTIFIED').map((i) => ({ v, i })));
out.push(`**The class bounds are NOT certified.** ${cert.length} of ${have.length} cell results carry a class bound whose certification is "${[...new Set(cert)].join('", "') || 'none'}": the remainder, the per-pass entity draw and the releasing NMI are sampled maxima, so every figure called an estimate below is a composed estimate (\`estimate (uncertified: sampled remainder, sampled entity draw, sampled NMI)\`), never certified slack against 29,780. The MEASURED Mesen G of every class keeps its own PASS/FAIL verdict (strict: G < 29,780).\n`);
const byId = new Map(); for (const { v, i } of unc) byId.set(i.id.replace(/:C[0-9a-z]+$/, ':<class>'), (byId.get(i.id.replace(/:C[0-9a-z]+$/, ':<class>')) ?? 0) + 1);
out.push(`Items with the status UNCERTIFIED, by id (count over all cell results): ${[...byId].map(([k, n]) => `\`${k}\` ${n}`).join(', ') || 'none'}.\n`);
out.push('Every line below is read from the retained result files; the per-body records and read-cost matrices they were judged from are the `.bodies.json.gz` / `.sweeps.json.gz` files linked by SHA-256 in each result and stamp.\n');

const FAMILIES = [
  ['Coverage map (finding 2): one body carries each conjunction', /^cover:/],
  ['Per-body agreement and arithmetic of the transactions (finding 4)', /^(agree|sanity):/],
  ['Read-cost sweep, event pricing and the class estimate (UNCERTIFIED, not PASS)', /^(cost|bound|gate:near)/],
  ['Seams: scroll, terrain, binding (finding 5)', /^seam:/]
];
const ids = (re) => [...new Set(have.flatMap((v) => v.r.items.map((i) => i.id)).filter((id) => re.test(id)))].sort();
for (const [title, re] of FAMILIES) {
  out.push(`## ${title}\n`);
  const I = ids(re);
  out.push(`| item | ${have.map((v) => `${v.c} ${v.gt[0]}${v.pl === 'banked' ? 'b' : ''}`).join(' | ')} |`, `|---|${have.map(() => '---').join('|')}|`);
  for (const id of I) out.push(`| ${id} | ${have.map((v) => { const its = v.r.items.filter((i) => i.id === id); return its.length ? [...new Set(its.map((i) => i.status))].join('/') : '-'; }).join(' | ')} |`);
  out.push('');
}
out.push('## Declared non-attainments and divergences (carried verbatim from the records)\n');
const seen = new Map();
for (const v of have) for (const i of v.r.items) {
  if (/^cover:route-/.test(i.id) && /NOT attained/.test(i.detail)) { const k = `${i.id}: ${i.detail.replace(/\d+ bodies; /, '')}`; seen.set(k, [...(seen.get(k) ?? []), `${v.c} ${v.gt} ${v.pl}`]); }
  if (i.id === 'agree:reported') { const k = `agree:reported: ${i.detail}`; seen.set(k, [...(seen.get(k) ?? []), `${v.c} ${v.gt} ${v.pl}`]); }
  if (/^cover:arm-alignment$/.test(i.id)) { const k = `cover:arm-alignment: ${i.detail}`; seen.set(k, [...(seen.get(k) ?? []), `${v.c} ${v.gt} ${v.pl}`]); }
}
for (const [k, who] of seen) out.push(`- (${who.length} variant(s): ${who.join(', ')}) ${k}`);
out.push('\n## Sabotage and fault controls (the verdict each one reached, read from its own record)\n');
const ctl = fs.readdirSync(dir).filter((f) => /^s1b-(seam|fault|pad)-.*\.json$/.test(f)).sort();
out.push('| control | cell | game | expect | verdictOk (declared outcome reached) | numerical G failures | operational failures | failing item categories (id prefix x count) |', '|---|---|---|---|---|---|---|---|');
const cats = (items) => { const o = {}; for (const i of items.filter((x) => x.status === 'FAIL' || x.status === 'UNMEASURED')) { const k = i.id.split(':')[0]; o[k] = (o[k] ?? 0) + 1; } return Object.entries(o).map(([k, n]) => `${k} x${n}`).join(', ') || 'none'; };
for (const f of ctl) { const r = load(f); if (!r) continue; out.push(`| ${r.sabotage ?? r.fault} | ${r.cell} | ${r.gameType}/${r.placement} | ${r.expect} | ${typeof r.verdictOk === 'boolean' ? (r.verdictOk ? 'CAUGHT (true)' : 'NOT CAUGHT (false)') : 'NOT RECORDED'} | ${r.gateFailures ?? '-'} | ${Array.isArray(r.operationalFailures) ? r.operationalFailures.length : (r.operationalFailures ?? '-')} | ${cats(r.items)} |`); }
out.push('\n## Appendix: every coverage / agreement / seam / bound item, in full\n');
for (const v of have) {
  out.push(`### ${v.c} ${v.gt} ${v.pl} (N=${v.r.n})\n`);
  for (const i of v.r.items.filter((x) => /^(cover|agree|sanity|seam|cost|bound|gate:near)/.test(x.id))) out.push(`- ${i.status} [${i.emu}] ${i.id}: ${i.detail}`);
  out.push('');
}
console.log(out.join('\n'));
