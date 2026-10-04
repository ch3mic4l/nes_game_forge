// Phase 3a slice S3b: the cross stage's plan (test/lua/sw_cross_cells.mjs), its five refusal groups (sw_cross_exclusions.mjs), the reuse rule
// (sw_cross_reuse.mjs) and the campaign verdict / launch table (run_sw_cross.mjs). Pure: no build, no Mesen. Every count is hand-derived from the plan
// (the arithmetic is in the comment beside it), not read back from the code under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { enumerateAll, countCells, normalizeCell, cellOptions, HISTORICAL_P0, CLASS_A_ALIGNMENTS, CLASS_A_POPS, CLASS_A_SHAPES, horizontalCore } from '../lua/sw_cross_cells.mjs';
import { loadGroups, groupProblems, pinProblems, refusalProblems, refusalNeed, partnerOf, GROUP_NAMES } from '../lua/sw_cross_exclusions.mjs';
import { reuseDecision, planReuse } from '../lua/sw_cross_reuse.mjs';
import { launchTable, launchOf, campaignVerdict, crossCellProblems } from '../lua/run_sw_cross.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/crossstage/real-bodies.json'), 'utf8'));
const vert = JSON.parse(gunzipSync(fs.readFileSync(path.join(ROOT, 'test/fixtures/crossstage/real-vertical.json.gz'))));
const cells = enumerateAll();
const byId = new Map(cells.map((c) => [c.id, c]));
const stage = (s, which = 'new') => cells.filter((c) => c.stages.includes(s) && c.which === which);
const groups = loadGroups();

test('every planned id is unique, normalized and carries its side; a cell in two stages is one job listing both', () => {
  assert.equal(byId.size, cells.length);
  for (const c of cells) assert.ok(c.id.startsWith(`${c.which}/`), c.id);
  const both = cells.filter((c) => c.stages.length > 1);
  assert.ok(both.length > 0);
  for (const c of both) assert.equal(new Set(c.stages).size, c.stages.length);
  // an implicit default and the same value written out are one cell
  const a = normalizeCell({ stage: 'x4', which: 'new', gt: 'action', wide: true, tail: 'flash', lead: 'flash', dist: 11, touchY: 239 });
  const b = normalizeCell({ stage: 'x4', which: 'new', gt: 'action', wide: true, tail: 'flash', lead: 'flash', dist: 11, touchY: 239, anim: 'P1', bound: false, pop: 'many-small' });
  assert.equal(a.id, b.id);
  assert.throws(() => normalizeCell({ stage: 'x4', which: 'new', gt: 'action', wide: true, tail: 'zzz', dist: 1 }), /unknown tail/);
  assert.throws(() => normalizeCell({ stage: 'x4', gt: 'action', wide: true, tail: 'none', dist: 1 }), /no side/);
  assert.throws(() => normalizeCell({ stage: 'x4', which: 'new', gt: 'action', wide: true, tail: 'ret', dist: 1 }), /belongs to x5r/);
});

test('stage sizes, derived by hand: S3a stages unchanged; x1 1,300 + 6 historical; x2 192; x3 400; x4 432; x6 8; x5h 538; x5r 16', () => {
  const per = countCells(cells).per;
  assert.deepEqual([per.phase.new, per.coincide.new, per.pops.new, per.anims.new, per.lead.new], [320, 140, 3600, 120, 16]);
  // x1: 4 projects x 5 tails x distances 166..230 (65) = 1300; plus the six exact historical P0 rows
  assert.equal(per.x1.new, 4 * 5 * 65 + HISTORICAL_P0.length);
  assert.equal(HISTORICAL_P0.length, 6);
  assert.equal(per.x2.new, 4 * 48); // touchY 40..87
  assert.equal(per.x3.new, 4 * 10 * 5 * 2); // ten populations x five tails x two distances
  assert.equal(per.x4.new, 4 * 2 * 10 * 5 + 4 * 8); // bound x pops x tails, then the 9 presets less P1 (already the base) = 8; no substitute cell (review 2 finding 1)
  assert.equal(per.x4.new, 432);
  assert.equal(per.x6.new, 8);
  assert.equal(per.x5h.new, 94 + 124 + 312 + 8); // f1, restored accepted matrix, class (a), RPG-bound class (a) target
  assert.equal(per.x5r.new, 2 * 2 * 2 * 2); // games x widths x plain/bound x two populations
  assert.equal(CLASS_A_ALIGNMENTS.length * CLASS_A_POPS.length * CLASS_A_SHAPES.length, 312);
  assert.equal(cells.filter((c) => c.stages.includes('x5h') && c.which === 'new' && c.kind === 'classA').length, 312);
  assert.equal(cells.filter((c) => c.stages.includes('x5h') && c.which === 'new' && c.kind === 'classARpgBound').length, 8, 'the explicit RPG-bound class (a) buildable-equivalent target');
  assert.equal(cells.filter((c) => c.sub !== undefined).length, 0, 'no substitute cell exists: nothing stands for an original');
  for (const s of Object.keys(per)) assert.equal(per[s].parent, per[s].new, `${s}: every new cell has a parent twin`);
});

test('the six historical P0 rows are present on both sides with no animation preset, and are not the P1 rows', () => {
  const want = [
    'action/wide/many-small/P0/plain/lead-none/tail-say/d200/y60', 'action/tight/many-small/P0/plain/lead-none/tail-say/d200/y60',
    'rpg/wide/many-small/P0/plain/lead-none/tail-flash/d200/y60', 'rpg/tight/many-small/P0/plain/lead-none/tail-flash/d200/y60',
    'action/tight/many-small/P0/plain/lead-none/tail-none/d200/y60', 'rpg/tight/many-small/P0/plain/lead-none/tail-none/d200/y60'
  ];
  for (const w of want) for (const side of ['new', 'parent']) assert.ok(byId.has(`${side}/${w}`), `${side}/${w}`);
  assert.ok(byId.has('new/action/wide/many-small/P1/plain/lead-none/tail-say/d200/y60'), 'the P1 row is its own cell');
});

test('x4 distinct ids: the animation loop does not re-add the four P1 cells (436 lines, 432 ids)', () => {
  const p1 = stage('x4').filter((c) => c.anim === 'P1' && c.bound && c.pop === 'many-small' && c.tail === 'flash');
  assert.equal(p1.length, 4);
  assert.equal(new Set(stage('x4').map((c) => c.id)).size, 432);
});

test('x5h: the 78 + 11 appendix ids and every conditional/approved pin are real planned cells; class (a) carries its alignment in its id', () => {
  for (const name of GROUP_NAMES) for (const id of groups[name].ids) assert.ok(byId.has(id), `${name} ${id}`);
  const classA = stage('x5h').filter((c) => c.kind === 'classA');
  const first = classA.find((c) => c.wf === 1 && c.startX === 244 && c.ty === 237 && c.startY === 210 && c.gt === 'action' && !c.bound && c.pop === 'many-small');
  assert.equal(first.id, 'new/action//wide/many-small/P0/plain/tail-switch/enter-set/x244y210d14/ty237/flashwait1');
  assert.equal(horizontalCore(first), first.id.replace(/^new\//, ''));
  assert.equal(stage('x5h').filter((c) => c.kind === 'f1' && c.tail === 'switch' && c.startX === 246 && c.startY === 210 && c.dist === 10 && c.gt === 'rpg' && c.bound && c.pop === 'few-large-1').length, 1);
});

test('x5r rows are the base horizontal scene with the return tail, and only x5r may carry it', () => {
  for (const c of stage('x5r')) { assert.equal(c.tail, 'ret'); assert.equal(c.dir, 'right'); assert.match(c.id, /\/tail-ret\//); }
});

test('cellOptions is the measured scene only: no side, no stage list, no id', () => {
  const o = cellOptions(byId.get('new/action/wide/many-small/P1/bound/lead-flash/tail-flash/d11/y239/composed'));
  assert.equal(o.which, undefined);
  assert.equal(o.id, undefined);
  assert.equal(o.stages, undefined);
  assert.deepEqual([o.gt, o.tail, o.dist, o.touchY, o.bound, o.scene], ['action', 'flash', 11, 239, true, 'composed']);
});

// ---------------------------------------------------------------- the five refusal groups

test('the groups are disjoint, hold 74 / 111 / 89 / 18 / 48 ids, every id is new-side, and the appendix is approved with its crosswalk', () => {
  assert.deepEqual(groupProblems(groups), []);
  assert.deepEqual(pinProblems(groups, cells), [], 'every pin is a planned cell');
  assert.match(pinProblems(groups, cells.filter((c) => !groups.appendix.ids.has(c.id))).join(';'), /which no stage plans/);
  assert.deepEqual(GROUP_NAMES.map((n) => groups[n].ids.size), [74, 111, 89, 18, 48]);
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/crossstage/exclusions-appendix.json'), 'utf8'));
  assert.equal(app.approved, true);
  assert.deepEqual([app.f1.length, app.classA.length], [11, 78]);
  for (const r of app.f1) { assert.match(r.parent.sha256, /^[0-9a-f]{64}$/); assert.match(r.child.sha256, /^[0-9a-f]{64}$/); assert.equal(typeof r.parent.recordIndex, 'number'); }
  for (const r of app.classA) { assert.match(r.recipeSha256, /^[0-9a-f]{64}$/); assert.match(r.evidence.sha256, /^[0-9a-f]{64}$/); assert.ok(r.need > r.free); }
  assert.match(app.scope, /grants NO population or shape exclusion/);
  // an id in two groups is refused by the structural check
  const bad = structuredClone({ ...groups, conditional111: { ...groups.conditional111, ids: new Set([...groups.conditional111.ids, [...groups.approved74.ids][0]]), rows: [...groups.conditional111.rows, groups.approved74.rows[0]] } });
  assert.match(groupProblems(bad).join(';'), /kept apart/);
});

test('the two original-capacity groups: 18 parent-refused + 48 new regressions, kept apart, each an original (never a substitute) with its conditional scope text', () => {
  const orig = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/crossstage/exclusions-orig-capacity.json'), 'utf8'));
  assert.equal(orig.final, true);
  assert.deepEqual([orig.origParentRefused.length, orig.origNewRegression.length], [18, 48]);
  assert.deepEqual([orig.counts.origParentRefused, orig.counts.origNewRegression], [18, 48]);
  assert.equal(groups.origParentRefused.parentRefuses, true);
  assert.equal(groups.origNewRegression.parentRefuses, false, 'the 48 build on the parent: its twin must be a success receipt, not a refusal');
  // the acceptance is conditional, never coverage, never a population exclusion, and never merged with the other groups
  assert.match(orig.scope, /CONDITIONAL on every other buildable composition, and the applicable bound and custom-code evidence, passing in D/);
  assert.match(orig.scope, /NEVER counted as coverage/);
  assert.match(orig.scope, /grants NO population, shape or game-type exclusion/);
  assert.match(orig.scope, /never merged with the approved 74, the conditional 111 or the approved 89 appendix/);
  for (const n of ['origParentRefused', 'origNewRegression']) for (const r of groups[n].rows) {
    const c = byId.get(r.id);
    assert.equal(c.which, 'new');
    assert.equal(c.gt, 'rpg', r.id);
    assert.equal(c.bound, true, r.id);
    assert.equal(c.sub, undefined, `${r.id} is an original`);
    assert.ok(c.stages.some((s) => ['x4', 'x5h', 'x5r', 'x6'].includes(s)), r.id);
  }
  // none of the 66 is in an older group
  for (const n of ['origParentRefused', 'origNewRegression']) for (const o of ['approved74', 'conditional111', 'appendix']) for (const id of groups[n].ids) assert.ok(!groups[o].ids.has(id), `${id} in ${n} and ${o}`);
  // the evidence rows: the original's OWN need/free/shortfall (1..38 against 144 free), the parent receipt of its group
  const ev = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/crossstage/exclusions-evidence.json'), 'utf8'));
  const shorts = [...ev.origParentRefused, ...ev.origNewRegression].map((r) => r.shortfall);
  assert.deepEqual([Math.min(...shorts), Math.max(...shorts)], [1, 38]);
  assert.ok(ev.origNewRegression.every((r) => r.free === 144 && r.parent.status === 'built'));
  assert.ok(ev.origParentRefused.every((r) => r.parent.status === 'refused' && r.parent.need > r.parent.free));
});

test('the appendix pins RPG-bound class (a) only: all 78 are rpg + bound + class (a); the 11 F1 are rpg + bound + wide', () => {
  for (const r of groups.appendix.rows) {
    const c = byId.get(r.id);
    assert.equal(c.gt, 'rpg', r.id);
    assert.equal(c.bound, true, r.id);
    assert.ok(['classA', 'f1', 'matrix'].includes(c.kind), `${r.id}: ${c.kind}`); // an F1 id that the restored accepted matrix also lists is one cell, kept under the first kind
  }
  assert.equal(groups.appendix.rows.filter((r) => byId.get(r.id).kind === 'classA').length, 78);
  // 26 alignments x 3 populations x ONE of the four shapes (rpg bound) = 78: the other three shapes are measured, not excluded
  assert.equal(CLASS_A_ALIGNMENTS.length * CLASS_A_POPS.length, 78);
});

const refusedText = (need, free) => `The lookup tables need ${need} bytes but only ${free} are free.`;
const refusalsFor = (names) => names.flatMap((n) => [...groups[n].ids].flatMap((id) => {
  const need = groups[n].need.get(id) ?? 165;
  const out = [{ id, reason: refusedText(need, 160) }];
  if (groups[n].parentRefuses) out.push({ id: partnerOf(id), reason: refusedText(need, 160) });
  return out;
}));
const pops = cells.filter((c) => ['pops', 'x4', 'x5h', 'x5r', 'x6'].some((s) => c.stages.includes(s)));

test('refusalProblems: the exact expected refusals pass; an exact-set shortfall, an unexpected refusal and an all-excluded stage each fail', () => {
  const planned = pops;
  const ok = refusalProblems({ planned, refusals: refusalsFor(GROUP_NAMES), groups, complete: true });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.byGroup && Object.values(ok.byGroup).map((v) => v.length), [74, 111, 89, 18, 48]);
  // exact set: a pinned id whose build is no longer refused -> the pin must be removed
  const all = refusalsFor(GROUP_NAMES);
  const drop = [...groups.conditional111.ids][0];
  assert.match(refusalProblems({ planned, refusals: all.filter((r) => r.id !== drop), groups, complete: true }).problems.join(';'), /pinned as refused but its build was not refused/);
  assert.deepEqual(refusalProblems({ planned, refusals: all.filter((r) => r.id !== drop), groups, complete: false }).problems, [], 'a partial run does not apply the exact-set check');
  // unexpected refusal: an id in no group
  const other = planned.find((c) => c.which === 'new' && !GROUP_NAMES.some((n) => groups[n].ids.has(c.id)));
  assert.match(refusalProblems({ planned, refusals: [...all, { id: other.id, reason: refusedText(200, 160) }], groups }).problems.join(';'), /unexpected refusal/);
  // all-excluded: every new cell of a stage x game type refused
  const rpgX5h = stage('x5h').filter((c) => c.gt === 'rpg');
  const flood = rpgX5h.map((c) => ({ id: c.id, reason: refusedText(200, 160) }));
  assert.match(refusalProblems({ planned: rpgX5h, refusals: flood, groups }).problems.join(';'), /all-excluded: every planned x5h\/rpg cell/);
});

test('refusalProblems: the need is the pin, the parent twin must agree, and a conditional exclusion must have a BUILDING parent', () => {
  const planned = pops;
  const id = [...groups.appendix.ids][0];
  const need = groups.appendix.need.get(id);
  const good = [{ id, reason: refusedText(need, 160) }, { id: partnerOf(id), reason: refusedText(need, 160) }];
  assert.deepEqual(refusalProblems({ planned, refusals: good, groups }).problems, []);
  assert.match(refusalProblems({ planned, refusals: [{ id, reason: refusedText(need + 1, 160) }, good[1]], groups }).problems.join(';'), /but the pin says/);
  assert.match(refusalProblems({ planned, refusals: [good[0]], groups }).problems.join(';'), /parent twin was not refused/);
  assert.match(refusalProblems({ planned, refusals: [good[0], { id: partnerOf(id), reason: refusedText(need + 5, 160) }], groups }).problems.join(';'), /its parent twin needs/);
  const c = [...groups.conditional111.ids][0];
  const cn = groups.conditional111.need.get(c);
  assert.deepEqual(refusalProblems({ planned, refusals: [{ id: c, reason: refusedText(cn, 150) }], groups }).problems, []);
  assert.match(refusalProblems({ planned, refusals: [{ id: c, reason: refusedText(cn, 150) }, { id: partnerOf(c), reason: refusedText(cn, 150) }], groups }).problems.join(';'), /new-engine-only exclusion/);
  // a free-byte difference on an appendix id is a NOTE (re-confirmed at the final pin), never a silent pass of a different need
  const drift = refusalProblems({ planned, refusals: [{ id, reason: refusedText(need, 150) }, { id: partnerOf(id), reason: refusedText(need, 150) }], groups });
  assert.deepEqual(drift.problems, []);
  assert.match(drift.notes.join(';'), /free-byte drift/);
  assert.deepEqual(refusalNeed('The lookup tables need 165 bytes but only 160 are free.'), { need: 165, free: 160 });
  assert.equal(refusalNeed('boom'), null);
});

// ---------------------------------------------------------------- reuse

const exp = { engine: 'e1', harness: 'h1', generator: 'g1', mesen: 'm1', campaign: 'c1' };
const c0 = byId.get('new/action/wide/many-small/P1/bound/lead-flash/tail-flash/d11/y239/composed');
const { campaign: _c, ...expProv } = exp;
const rec = (over = {}) => ({ id: c0.id, options: cellOptions(c0), prov: { ...expProv, project: 'p', rom: 'r' }, campaign: 'c1', rows: [{ G: 1 }], ...over });
test('reuse fails closed: only a successful record with matching provenance AND options stands for a cell', () => {
  assert.equal(reuseDecision(c0, rec(), exp).reuse, true);
  const no = (r, why, e = exp) => { const d = reuseDecision(c0, r, e); assert.equal(d.reuse, false); assert.match(d.reason, why); };
  no(undefined, /no record/);
  no(rec({ error: 'x' }), /an error/);
  no(rec({ rows: undefined }), /no measurement/);
  no(rec({ prov: undefined }), /no provenance/);
  for (const f of ['engine', 'harness', 'generator', 'mesen']) { no(rec({ prov: { ...expProv, [f]: 'zz' } }), new RegExp(`${f} differs`)); no(rec({ prov: { ...expProv, [f]: undefined } }), new RegExp(`lacks provenance.${f}`)); }
  // the measuring implementation (cells, scenes, compaction, policy) is fingerprinted: a record from other code, or none, runs again (review 1 finding 7)
  no(rec({ campaign: undefined }), /no campaign/);
  no(rec({ campaign: 'zz' }), /measuring implementation/);
  no(rec(), /campaign fingerprint is unknown/, { ...exp, campaign: undefined });
  no(rec(), /current engine hash is unknown/, { ...exp, engine: undefined });
  no(rec(), /^$|unknown/, null);
  no(rec({ id: 'new/other' }), /another id/);
  no(rec({ options: { ...cellOptions(c0), dist: 12 } }), /other options/);
  // an S3a record (no provenance at all) never stands for a cell
  no({ id: c0.id, summary: { maxStep: 1 } }, /no provenance/);
});

test('planReuse counts the reasons and never lets a record cross sides', () => {
  const p = byId.get(c0.id.replace(/^new\//, 'parent/'));
  const records = new Map([[c0.id, rec()], [p.id, { ...rec({ id: p.id, options: cellOptions(p) }) }]]);
  const out = planReuse([c0, p], records, { new: exp, parent: { ...exp, engine: 'parent-engine' } });
  assert.deepEqual(out.reused.map((r) => r.cell.id), [c0.id]);
  assert.equal(out.fresh.length, 1);
  assert.deepEqual(out.reasons, { 'engine differs from this tree': 1 });
});

// ---------------------------------------------------------------- campaign verdict and launch table

const ran = (n) => ['move_tick', 'spawn_entities', 'sw_talker_cross', ...n];
const compNew = vert.composedNew.switch;
const x4 = () => byId.get(compNew.id);
const okOf = (c, x, over = {}) => ({ id: c.id, rows: x.rows, facts: x.facts, status: 0, done: true, timeout: false, ...over });
test('a multi-stage cell is held to the UNION of what its stages require, once per problem', () => {
  const multi = cells.find((c) => c.which === 'new' && c.stages.includes('x1') && c.stages.includes('x2'));
  const m = { status: 0, done: true, timeout: false, rows: [{ ...real.vseam.rows[0], ran: ['move_tick'] }] };
  const out = crossCellProblems(multi, m);
  assert.ok(out.length > 0);
  assert.equal(new Set(out).size, out.length);
});

test('campaignVerdict: a measured populated vertical cell passes; every other result shape is a named problem', () => {
  const c = x4();
  const okRes = okOf(c, compNew);
  const v = campaignVerdict({ planned: [c], results: [okRes], groups });
  assert.deepEqual(v.problems.filter((p) => !/\((x4|x6)\)/.test(p.id)), []);
  const probs = (results, planned = [c]) => campaignVerdict({ planned, results, groups }).problems.map((p) => p.problem).join(';');
  assert.match(probs([]), /no result for this planned cell/);
  assert.match(probs([okRes, okRes]), /2 results/);
  assert.match(probs([{ id: 'new/zz', rows: [] }, okRes]), /not planned/);
  assert.match(probs([{ id: c.id, error: 'spawn failed' }]), /the measurement failed: spawn failed/);
  const hot = compNew.rows.map((r) => (r.ran.includes('spawn_entities') ? { ...r, G: 29781 } : r));
  assert.match(probs([okOf(c, { rows: hot, facts: compNew.facts })]), /exceeds the gate 29780/);
  assert.match(probs([{ id: c.id }]), /no measurement/);
  assert.match(probs([], []), /plan is empty/);
  // the populated scene's own facts are held: a destination of one actor is a different workload
  assert.match(probs([okOf(c, { rows: compNew.rows, facts: { ...compNew.facts, destEntities: 1 } })]), /destination has 1 actors, not 8/);
  // a refusal is never a measurement: the only cell is refused and in no group -> unexpected, and nothing was measured
  const p = probs([{ id: c.id, error: refusedText(300, 160) }]);
  assert.match(p, /unexpected refusal/);
  assert.match(p, /no cell was measured/);
});

test('campaignVerdict reports the PARENT timing maxima (never "worst G 0") and holds a parent to its scripted work', () => {
  const par = vert.composedParent.switch;
  const c = byId.get(par.id);
  const v = campaignVerdict({ planned: [c], results: [okOf(c, par)], groups });
  assert.equal(v.worstGated, 0, 'a parent is not gated');
  assert.ok(v.parentTiming.maxMove > 10000 && v.parentTiming.maxFinal > 5000, JSON.stringify(v.parentTiming));
  assert.equal(v.parentTiming.measured, 1);
  const walking = par.rows.filter((r) => !r.ran.includes('move_tick') && !r.ran.includes('move_finish'));
  const bad = campaignVerdict({ planned: [c], results: [okOf(c, { rows: walking, facts: par.facts })], groups });
  assert.ok(bad.problems.some((q) => /the parent ran no Move step/.test(q.problem)), 'a walking-only parent record is not a baseline');
});

test('campaignVerdict: a stage whose cells never show the stage\'s composition class fails even though each cell ran soundly', () => {
  const planned = stage('x4').slice(0, 3);
  const noArm = compNew.rows.map((r) => ({ ...r, ran: r.ran.filter((m) => m !== 'sw_stream_start_row') }));
  const results = planned.map((c) => okOf(c, { rows: noArm, facts: compNew.facts }));
  const v = campaignVerdict({ planned, results, groups });
  assert.ok(v.problems.some((p) => p.id === '(x4)' && /no planned cell produced a vseam body/.test(p.problem)));
});

test('launchTable: each cell is in exactly one launch; refusals cost a build not a run; the parent baselines run on the unchanged tree; nothing is reused without provenance', () => {
  const t = launchTable(cells, { groups });
  const total = t.rows.reduce((n, r) => n + r.cells, 0);
  assert.equal(total, cells.length);
  const by = Object.fromEntries(t.rows.map((r) => [r.name, r]));
  // hand count: the cross stages are 1,306 + 192 + 400 + 432 + 8 + 538 + 16 = 2,892 stage lines per side, less the 4 cells x1 and x2 share = 2,888 cells; the S3a small stages 596; pops-only 3,420
  assert.equal(by.L3.cells, 1306 + 192 + 400 + 432 + 8 + 538 + 16 - 4);
  assert.equal(by.L1.cells, 596);
  assert.equal(by.P2.cells, 596);
  assert.equal(by.L4.cells, 3420);
  assert.equal(by.P3.cells, 3420);
  assert.equal(by.L3.cells, by.P1.cells);
  assert.equal(by.L3.buildOnlyRefusals, 89 + 18 + 48); // the appendix 11 + 78, and the 66 original capacity outcomes (18 + 48)
  assert.equal(by.P1.buildOnlyRefusals, 89 + 18); // the appendix twins and the 18 the parent refuses too; the 48 parent twins BUILD and run
  assert.equal(by.L4.buildOnlyRefusals, 74 + 111);
  assert.equal(by.P3.buildOnlyRefusals, 74); // only the approved 74 are refused by the parent too
  for (const r of t.rows) { assert.equal(r.reused, 0); assert.equal(r.runs, r.cells - r.buildOnlyRefusals); assert.ok(r.processes <= 20); }
  assert.ok(t.rows.every((r) => /parent|new/.test(r.tree)));
  assert.equal(launchOf(cells.find((c) => c.which === 'parent' && c.stages.includes('x4'))), 'P1');
  assert.equal(launchOf(cells.find((c) => c.which === 'new' && c.stages.includes('phase') && c.stages.includes('pops'))), 'L1');
  assert.deepEqual(t.other.map((o) => o.name), ['L5', 'X5', 'RS']);
  // the estimate is runs x seconds / processes, and the 15-minute line is flagged
  assert.equal(by.L3.minutes, Number(((by.L3.runs * 6) / 20 / 60).toFixed(1)));
  assert.equal(by.L4.over15, by.L4.runs * 6 / 20 / 60 > 15);
});

test('launchTable reuse: a matching record removes the cell from the runs and is counted; a wrong-side record does not', () => {
  const c = cells.find((x) => x.which === 'new' && x.stages.includes('x4'));
  const r = { id: c.id, options: cellOptions(c), prov: { ...expProv, project: 'p', rom: 'r' }, campaign: 'c1', rows: [{ G: 1 }] };
  const base = launchTable(cells, { groups }).rows.find((x) => x.name === 'L3');
  const t = launchTable(cells, { groups, records: new Map([[c.id, r]]), expectedBySide: { new: exp, parent: exp } }).rows.find((x) => x.name === 'L3');
  assert.equal(t.reused, 1);
  assert.equal(t.runs, base.runs - 1);
});
