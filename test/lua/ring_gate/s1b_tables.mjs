#!/usr/bin/env node
// Renders the S1b report tables (rows 2, 4, 7) from the result files of a matrix run: node test/lua/ring_gate/s1b_tables.mjs <log-dir>
// Reads <log-dir>/s1b-<cell>-<gt>-<placement>.json (the --json file run_s1b.mjs wrote) and prints markdown: the verdict counts per row/emulator per cell, the
// per-class max G table (Mesen), the read-count confirmation table and every non-PASS item by name.
// Round 3: the class bound is printed as an UNCERTIFIED ESTIMATE (never as a proof or as certified slack), the verdict counts carry an UNCERTIFIED column, and the gate is strict (G < 29,780).
import fs from 'node:fs';
import path from 'node:path';

const ROW = (id) => (/^(seam):/.test(id) ? 7 : /^(gate|overruns|bound|cost)(:|$)/.test(id) ? 4 : 2);
const CELLS = ['MMC1-V', 'MMC1-H', 'MMC3-V', 'MMC3-H', 'U512-V', 'U512-H'];
const dir = process.argv[2];
if (!dir) { console.error('usage: s1b_tables.mjs <log-dir>'); process.exit(2); }
const results = [];
for (const c of CELLS) for (const [gt, pl] of [['action', 'resident'], ['rpg', 'resident'], ['rpg', 'banked']]) {
  const f = path.join(dir, `s1b-${c}-${gt}-${pl}.json`);
  results.push({ c, gt, pl, r: fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null });
}
for (const c of CELLS) results.push({ c, gt: 'action', pl: 'banked', na: true });
const out = [];
const cnt = (items, pred) => { const o = {}; for (const i of items.filter(pred)) o[i.status] = (o[i.status] ?? 0) + 1; return ['PASS', 'FAIL', 'UNCERTIFIED', 'N/A', 'UNMEASURED'].map((k) => `${o[k] ?? 0}`).join('/'); };
out.push('## Verdicts per cell, row and emulator (PASS/FAIL/UNCERTIFIED/N/A/UNMEASURED item counts)\n');
out.push('UNCERTIFIED is not PASS: it is an item whose evidence is an estimate or a cross-check this round did not establish (the class estimates of row 4 and, in the horizontal cells, `agree:chase` of row 2). It is never counted as proof.\n');
out.push('| cell | game | placement | N | row 2 mesen | row 2 jsnes | row 4 mesen | row 4 jsnes | row 7 jsnes |', '|---|---|---|---|---|---|---|---|---|');
for (const { c, gt, pl, r, na } of results) {
  if (na) { out.push(`| ${c} | action | banked | - | N/A | N/A | N/A | N/A | N/A |`); continue; }
  if (!r) { out.push(`| ${c} | ${gt} | ${pl} | - | UNMEASURED | UNMEASURED | UNMEASURED | UNMEASURED | UNMEASURED |`); continue; }
  const it = r.items;
  const row = (n, emu) => cnt(it, (i) => ROW(i.id) === n && (i.emu === emu || i.emu === 'both' || (i.emu === '-' && emu === 'mesen')));
  out.push(`| ${c} | ${gt} | ${pl} | ${r.n} | ${row(2, 'mesen')} | ${row(2, 'jsnes')} | ${row(4, 'mesen')} | ${row(4, 'jsnes')} | ${row(7, 'jsnes')} |`);
}
out.push('\n"N/A" cells are action x banked (proved by the capacity check; see the coverage document) and each N/A item inside a cell carries its own source proof in its result file.\n');
out.push('## Mainline G per class (Mesen; maxG cycles, gateFail = bodies at or over 29,780 (the verdict is strict, G < 29,780), overruns = bodies with an NMI landing inside)\n');
const classes = ['C0', 'C1', 'C1s', 'C2', 'C3s', 'C3a', 'C3b', 'CB', 'C4a', 'C4b', 'C4bw', 'C4c'];
out.push(`| cell | game | placement | ${classes.join(' | ')} |`, `|---|---|---|${classes.map(() => '---').join('|')}|`);
for (const { c, gt, pl, r } of results) {
  if (!r) continue;
  const k = r.classes?.mesen ?? {};
  out.push(`| ${c} | ${gt} | ${pl} | ${classes.map((cl) => (k[cl] ? `${k[cl].maxG ?? '-'}${k[cl].gateFail ? ` **${k[cl].gateFail} over**` : ''}${k[cl].ovr ? ` ovr ${k[cl].ovr}` : ''}` : '-')).join(' | ')} |`);
}
out.push('\n## The class ESTIMATE (uncertified: sampled remainder, sampled entity draw, sampled NMI), Mesen\n');
out.push('**NOT CLAIMED: a proof for the remainder, the entity-draw pass or the releasing NMI (each is a maximum over the sampled bodies), certified slack against 29,780, or a bound for an unsampled project.** The estimate is NMI (sampled max) + remainder (sampled max over every body of the class) + reads (source ceiling x exhaustive price) + passes x player projection (source pass count x exhaustive per-routine maxima) + passes x entity-draw pass (source pass count x sampled per-pass max). Each cell: `estimate` = max(the decomposed formula, the worst body with no jsnes counterpart bounded as itself). The distance from 29,780 of any figure below is therefore NOT certified slack. The measured Mesen G table above keeps its own PASS/FAIL gate verdict.\n');
out.push(`| cell | game | placement | NMI max (sampled) | proj pass ceiling | draw pass max (sampled) | peek / goto / restore (cyc) | ${classes.filter((x) => x !== 'C0').join(' | ')} |`, `|---|---|---|---|---|---|---|${classes.filter((x) => x !== 'C0').map(() => '---').join('|')}|`);
for (const { c, gt, pl, r } of results) {
  if (!r?.bound?.byClass) continue;
  const b = r.bound, pr = b.prices.adj;
  out.push(`| ${c} | ${gt} | ${pl} | ${b.nmiMax} | ${b.projCeiling} | ${(b.drawPass ?? b.drawMax)?.cycles ?? "-"} | ${pr.peek} / ${pr.goto} / ${pr.loc} | ${classes.filter((x) => x !== 'C0').map((cl) => (b.byClass[cl] ? `est. ${b.byClass[cl].bound.adj}${b.byClass[cl].ok ? '' : ' **REFUSED**'}` : '-')).join(' | ')} |`);
}
out.push('\n### Term breakdown of every class estimate (remainder and draw sampled; reads and projection source x exhaustive)\n');
out.push('| cell | game | placement | class | n (decomposed / total) | OAM passes (source) | remainder (sampled) | reads | projection | draw (sampled) | formula | unpaired bodies bound | class estimate (uncertified) | worst measured G |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const { c, gt, pl, r } of results) {
  if (!r?.bound?.byClass) continue;
  for (const cl of classes.filter((x) => x !== 'C0')) { const b = r.bound.byClass[cl]; if (!b) continue; out.push(`| ${c} | ${gt} | ${pl} | ${cl} | ${b.nPaired}/${b.n} | ${b.passes} | ${b.remMax} | ${b.reads.adj} | ${b.projCeil} | ${b.drawCeil} | ${b.formula.adj} | ${b.unpairedMax.cycles >= 0 ? b.unpairedMax.cycles : '-'} | ${b.bound.adj} | ${b.maxG} |`); }
}
out.push('\n## Bodies within 64 cycles of 29,780 (either side; the harness verdict is strict, `G < 29780`; the Lua template\'s own raw `gateFail` diagnostic counts `G > 29780` and is not the verdict)\n');
const nearRows = results.flatMap(({ c, gt, pl, r }) => (r?.near ?? []).map((x) => `- ${c} ${gt} ${pl}: ${x.cls} ${x.at} G=${x.G} (${x.exempt ? 'C0, exempt' : x.allowed ? 'allowed' : 'REFUSED (not < 29780)'})`));
out.push(nearRows.length ? nearRows.join('\n') : 'None: no body of any cell, game type or placement came within 64 cycles of the gate (the largest measured G per class is in the table above).');
out.push('\n## Plan 2.2 reconciliation (per cell; measured maxima of the jsnes profile, inclusive call cost with JSR; the groups NEST, so rows are compared with the plan\'s same-named figure, never summed)\n');
const PLAN = { nmi: 2167, probes: 5648, projection: 1206, driver: 563, arm: 7668, busy: 11839 };
out.push('Plan figures (design-streamed-worlds.md, UNROM 512 PROVEN row): NMI 2,167; boundary probes 5,648; projection 1,206 (18 calls x 67: STALE at HEAD, the player projects 4 tiles = 8 `sw_project_axis` paths and the entities none); driver 563; worst arm 7,668 (`sw_stream_start_row`); busy ordinary body 11,839.\n');
out.push('| cell | game | placement | NMI (Mesen max) | probes | projection | driver (incl. probes) | arm (`sw_stream_start_*`) | `sw_win_arm` | entity draw | `update_entities` | `main_loop_draw` |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const { c, gt, pl, r } of results) {
  if (!r?.recon) continue;
  const g = r.recon.groups, v = (k) => (g[k] ? `${g[k].cycles}` : '-');
  out.push(`| ${c} | ${gt} | ${pl} | ${r.recon.nmi.cycles} | ${v('probes')} | ${r.recon.proj.cycles} (${r.recon.proj.calls} calls) | ${v('driver')} | ${v('strip')} | ${v('winarm')} | ${v('draw')} | ${v('ent')} | ${v('mld')} |`);
}
out.push('\n### Per class: the max-G Mesen body\n');
out.push('| cell | game | placement | ' + classes.filter((x) => x !== 'C0').join(' | ') + ' |', '|---|---|---|' + classes.filter((x) => x !== 'C0').map(() => '---').join('|') + '|');
for (const { c, gt, pl, r } of results) {
  if (!r?.recon) continue;
  out.push(`| ${c} | ${gt} | ${pl} | ${classes.filter((x) => x !== 'C0').map((cl) => (r.recon.byClass[cl] ? `${r.recon.byClass[cl].G} @ ${r.recon.byClass[cl].at} (NMI ${r.recon.byClass[cl].nmiT}, reads ${r.recon.byClass[cl].reads})` : '-')).join(' | ')} |`);
}
out.push('\n## Read counts per class: max sw_peek_byte / sw_goto observed (Mesen) against the plan 2.2 ceiling (peek/goto)\n');
const ceil = { C1: '3/3', C2: '3/4', C3a: '2/3', C3b: '3/4', C4a: '0/0', C4bw: '0/0', C4b: '2/3', C4c: '2/3', CB: '0/0', C1s: '1/1', C3s: '0/0' };
out.push(`| cell | game | placement | ${Object.keys(ceil).map((k) => `${k} (${ceil[k]})`).join(' | ')} |`, `|---|---|---|${Object.keys(ceil).map(() => '---').join('|')}|`);
for (const { c, gt, pl, r } of results) {
  if (!r) continue;
  const k = r.classes?.mesen ?? {};
  out.push(`| ${c} | ${gt} | ${pl} | ${Object.keys(ceil).map((cl) => (k[cl] ? `${k[cl].max.peek ?? 0}/${k[cl].max.goto ?? 0}` : '-')).join(' | ')} |`);
}
out.push('\n## Every item that is not PASS\n');
const na = new Map();
for (const { c, gt, pl, r } of results) {
  if (!r) { if (!results.find((x) => x.na && x.c === c && x.pl === pl && x.gt === gt)) out.push(`- ${c} ${gt} ${pl}: NO RESULT FILE (UNMEASURED)`); continue; }
  for (const i of r.items.filter((x) => x.status !== 'PASS')) {
    if (i.status === 'N/A') { const k = `${i.emu}|${i.id}|${i.detail}`; na.set(k, (na.get(k) ?? 0) + 1); } else out.push(`- ${c} ${gt} ${pl} [${i.emu}] ${i.id}: ${i.status}: ${i.detail}`);
  }
}
for (const [k, n] of na) { const [emu, id, ...d] = k.split('|'); out.push(`- N/A [${emu}] ${id} (${n} cell results): ${d.join('|')}`); }
console.log(out.join('\n'));
