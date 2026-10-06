// Phase 3a slice S3b fix rounds 1-2: the exclusion contract is held to PER-ID evidence (need, free, shortfall, provenance) for each of the five refusal
// groups kept apart, to the parent campaigns' success and refusal receipts, and to exact sets -- THROUGH THE CLI AND SERIALIZED RESULT FILES, not only
// through the functions. The files are VALID complete envelopes (test/lib/crossworld.js) with one thing broken per test. Pure but for the spawned
// `node run_sw_cross.mjs --verify-exclusions`; no build, no Mesen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { partnerOf, GROUP_NAMES } from '../lua/sw_cross_exclusions.mjs';
import { evidenceStructureProblems, evidenceProvenanceProblems, parentCoverageProblems, loadParentEvidence } from '../lua/sw_cross_evidence.mjs';
import { writeEnvelope, expectedTrees } from '../lua/run_sw_cross.mjs';
import { groups, evidence, cells, byId, text, tmp, world, files, historical, envelope, trees, parts, FAKE_MESEN } from '../lib/crossworld.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNNER = path.join(ROOT, 'test/lua/run_sw_cross.mjs');

// ---------------------------------------------------------------- the evidence fixture itself

test('the evidence covers EXACTLY the ids of each of the five groups, with consistent numbers, and the sets stay apart', () => {
  assert.deepEqual(evidenceStructureProblems(groups, evidence), []);
  assert.deepEqual(GROUP_NAMES.map((g) => evidence[g].length), [74, 111, 89, 18, 48]);
  assert.equal(evidence.substituted, undefined, 'no substituted set: nothing is exempted by having a substitute');
  assert.equal(evidence.residual, undefined, 'no residual: every refusal is pinned by exact id or fails');
  const all = GROUP_NAMES.flatMap((g) => evidence[g].map((r) => r.id));
  assert.equal(new Set(all).size, all.length, 'no id is in two sets');
  // every row: shortfall is need - free, positive; a refused parent has need > free; a built parent carries a provenance
  for (const g of GROUP_NAMES) for (const r of evidence[g]) {
    assert.equal(r.shortfall, r.need - r.free); assert.ok(r.shortfall > 0);
    if (r.parent.status === 'refused') assert.ok(r.parent.need > r.parent.free); else assert.match(r.parent.prov.engine, /^[0-9a-f]{64}$/);
  }
  // the conditional 111 and the 48 new regressions are final and have a parent that BUILDS; the approved 74, the appendix 89 and the 18 have a parent that refuses
  assert.ok(evidence.conditional111.every((r) => r.parent.status === 'built' && r.free === 140));
  assert.ok(evidence.origNewRegression.every((r) => r.parent.status === 'built' && r.free === 140));
  for (const g of ['approved74', 'appendix']) assert.ok(evidence[g].every((r) => r.parent.status === 'refused' && r.parent.need === r.need));
  assert.ok(evidence.origParentRefused.every((r) => r.parent.status === 'refused' && r.parent.need === r.need));
  const cond = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/crossstage/exclusions-conditional.json'), 'utf8'));
  assert.equal(cond.final, true);
  assert.doesNotMatch(cond.note, /^PROVISIONAL/);
  assert.equal(cond.finalAllowance.talkerKernelLo.total, 19);
  // the parent tree is pinned in full: its engine, harness, generator (plain and the compacting root's) and Mesen
  for (const f of ['engine', 'harness', 'generator', 'compactGenerator', 'mesen']) assert.match(evidence.prov.parent[f], /^[0-9a-f]{64}$/, f);
});

test('structure checks name each way the evidence can be wrong: a missing row, an extra row, a bad shortfall, a merged set, a missing parent receipt or provenance', () => {
  const bad = (f) => { const e = structuredClone(evidence); f(e); return evidenceStructureProblems(groups, e).join(';'); };
  assert.match(bad((e) => e.conditional111.pop()), /has no evidence row/);
  assert.match(bad((e) => e.appendix.push({ ...e.appendix[0], id: 'new/zz' })), /not in the group/);
  assert.match(bad((e) => { e.approved74[0].shortfall = 3; }), /shortfall 3 is not need/);
  assert.match(bad((e) => { e.origNewRegression.push(structuredClone(e.approved74[0])); }), /kept apart/);
  assert.match(bad((e) => { e.origParentRefused.pop(); }), /has no evidence row/);
  assert.match(bad((e) => { delete e.conditional111[0].parent; }), /no parent receipt/);
  assert.match(bad((e) => { delete e.conditional111[0].parent.prov; }), /parent success carries no provenance/);
  assert.match(bad((e) => { e.conditional111[0].parent = { status: 'refused', need: 160, free: 150 }; }), /contradicts the group/);
  assert.match(bad((e) => { e.origNewRegression[0].parent = { status: 'refused', need: 160, free: 150 }; }), /contradicts the group/);
  assert.match(bad((e) => { e.origParentRefused[0].parent = { status: 'built', prov: e.prov.parent }; }), /contradicts the group/);
  assert.match(bad((e) => { delete e.prov; }), /no new-tree provenance/);
  assert.match(bad((e) => { delete e.prov.parent.compactGenerator; }), /pins no parent-tree compactGenerator/);
  assert.match(bad((e) => { e.prov.parent.mesen = 'x'; }), /pins no parent-tree mesen/);
  assert.match(evidenceProvenanceProblems(evidence, { engine: 'x'.repeat(64), generator: evidence.prov.new.generator }).join(';'), /read at engine/);
  assert.deepEqual(evidenceProvenanceProblems(evidence, { engine: evidence.prov.new.engine, generator: evidence.prov.new.generator }), []);
});

test('parentCoverageProblems: a parent twin with no result or a failed one is a problem; a refused twin of a measured cell is a note, never a baseline', () => {
  const c = (id) => ({ id: `new/${id}`, which: 'new' });
  const out = { 'new/a': 'measured', 'parent/a': 'measured', 'new/b': 'measured', 'parent/b': 'refused', 'new/c': 'measured', 'new/d': 'measured', 'parent/d': 'failed' };
  const r = parentCoverageProblems([c('a'), c('b'), c('c'), c('d')], (id) => out[id]);
  assert.equal(r.problems.length, 2);
  assert.match(r.problems.join(';'), /new\/c: its parent twin has no result at all/);
  assert.match(r.problems.join(';'), /new\/d: its parent twin failed/);
  assert.match(r.notes.join(';'), /new\/b: measured on the new tree but its parent twin is refused/);
});

// ---------------------------------------------------------------- through the CLI

/** Runs --verify-exclusions on the world's two files; `edit({newEnv, parentEnv})` breaks them first. */
function run(w, edit = () => {}, { parent = true } = {}) {
  const dir = tmp();
  const f = files(w);
  edit(f);
  const n = path.join(dir, 'new.json'); const p = path.join(dir, 'parent.json');
  fs.writeFileSync(n, JSON.stringify(f.newEnv));
  fs.writeFileSync(p, JSON.stringify(f.parentEnv));
  const r = spawnSync(process.execPath, [RUNNER, `--mesen=${FAKE_MESEN}`, `--verify-exclusions=${n}`, ...(parent ? [`--parent-evidence=${p}`] : [])], { cwd: ROOT, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
const rx = (id) => id.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

test('CLI: the exact expected serialized results pass with no problem; the missing parent evidence is refused outright', () => {
  const ok = run(world());
  assert.equal(ok.status, 0, ok.out);
  assert.match(ok.out, /0 problems/);
  assert.match(ok.out, /historical/);
  const raw = run(world({ kind: 'raw' }));
  assert.equal(raw.status, 0, raw.out);
  assert.match(raw.out, /evidence \d+ raw, 0 historical/);
  const none = run(world(), () => {}, { parent: false });
  assert.equal(none.status, 2);
  assert.match(none.out, /--parent-evidence/);
});

test('CLI sabotage: the reviewer\'s free = 1 (a need that matches, a free that does not) fails, per group', () => {
  for (const g of GROUP_NAMES) {
    const row = evidence[g][3];
    const r = run(world(), ({ newEnv }) => { newEnv.errors.find((e) => e.id === row.id).error = text(row.need, 1); });
    assert.equal(r.status, 1, g);
    assert.match(r.out, new RegExp(`${g}: ${rx(row.id)} has 1 free bytes, the evidence pins ${row.free}`));
    assert.match(r.out, /short by/);
  }
});

test('CLI sabotage: a wrong need, or a wrong shortfall (need and free both moved), fails', () => {
  const row = evidence.conditional111[0];
  assert.match(run(world(), ({ newEnv }) => { newEnv.errors.find((e) => e.id === row.id).error = text(row.need + 1, row.free); }).out, /needs 156 bytes, the evidence pins 155/);
  const r2 = evidence.approved74[0];
  const out = run(world(), ({ newEnv }) => { newEnv.errors.find((e) => e.id === r2.id).error = text(r2.need + 20, r2.free + 3); }).out;
  assert.match(out, /needs 185 bytes, the evidence pins 165/);
  assert.match(out, /is short by 42 bytes, the evidence pins 25/);
  // the same for the original-capacity groups, which carry the original scene's own figures
  for (const g of ['origParentRefused', 'origNewRegression']) {
    const o = evidence[g][0];
    const x = run(world(), ({ newEnv }) => { newEnv.errors.find((e) => e.id === o.id).error = text(o.need + 4, o.free); });
    assert.equal(x.status, 1, g);
    assert.match(x.out, new RegExp(`${g}: ${rx(o.id)} needs ${o.need + 4} bytes, the evidence pins ${o.need}`));
  }
});

test('CLI sabotage: a missing parent SUCCESS (conditional, new regression) and a parent that refuses where the evidence says it builds each fail', () => {
  for (const g of ['conditional111', 'origNewRegression']) {
    const row = evidence[g][0];
    const r = run(world(), ({ parentEnv }) => { parentEnv.records = parentEnv.records.filter((x) => x.id !== partnerOf(row.id)); });
    assert.equal(r.status, 1, g);
    assert.match(r.out, new RegExp(`${g}: .* has no parent receipt`));
    assert.match(r.out, /its parent twin has no result at all/);
    const v = run(world(), ({ parentEnv }) => { parentEnv.records = parentEnv.records.filter((x) => x.id !== partnerOf(row.id)); parentEnv.errors.push({ id: partnerOf(row.id), error: text(155, 160) }); });
    assert.match(v.out, /new-engine-only exclusion, but the parent evidence says refused: no successful parent twin/);
    // a parent success measured with another engine than the one the evidence pins: a problem of the file itself AND of the receipt
    const q = run(world(), ({ parentEnv }) => { parentEnv.records.find((x) => x.id === partnerOf(row.id)).prov.engine = 'f'.repeat(64); });
    assert.equal(q.status, 1);
    assert.match(q.out, /provenance\.engine/);
  }
});

test('CLI sabotage: a missing parent REFUSAL (approved74, appendix, origParentRefused) and a parent refusal with the wrong need/free fail', () => {
  for (const g of ['approved74', 'appendix', 'origParentRefused']) {
    const row = evidence[g][5];
    const r = run(world(), ({ parentEnv }) => { parentEnv.errors = parentEnv.errors.filter((e) => e.id !== partnerOf(row.id)); });
    assert.equal(r.status, 1, g);
    assert.match(r.out, new RegExp(`${g}: .* has no parent receipt`));
    const v = run(world(), ({ parentEnv }) => { parentEnv.errors.find((e) => e.id === partnerOf(row.id)).error = text(row.parent.need, row.parent.free - 1); });
    assert.match(v.out, new RegExp(`${g}: .* parent receipt is need ${row.parent.need} / free ${row.parent.free - 1}, the evidence pins need ${row.parent.need} / free ${row.parent.free}`));
  }
});

test('CLI sabotage: the exact set. A pinned id that built (the pin must be removed), an id refused that no set pins, and an original that is not exempted by having a substitute', () => {
  for (const g of ['approved74', 'origParentRefused', 'origNewRegression']) {
    const row = evidence[g][0];
    const w = world();
    const r = run(w, ({ newEnv }) => { newEnv.errors = newEnv.errors.filter((e) => e.id !== row.id); newEnv.records.push(historical(byId.get(row.id), trees.new)); });
    assert.match(r.out, new RegExp(`${g}: .* is pinned as refused but its build was not refused`), g);
  }
  const other = cells.find((c) => c.which === 'new' && c.stages.includes('x4') && !GROUP_NAMES.some((n) => groups[n].ids.has(c.id)));
  const v = run(world(), ({ newEnv, parentEnv }) => { newEnv.errors.push({ id: other.id, error: text(190, 144) }); parentEnv.records.push(historical(byId.get(partnerOf(other.id)), trees.parent)); });
  assert.match(v.out, /unexpected refusal: .* is in no approved, conditional or original-capacity group/);
  // an original capacity id left unrefused AND unmeasured (its old "substitute" gone) is not covered by anything: the pin set is exact, a missing refusal fails
  const row = evidence.origNewRegression[1];
  const u = run(world(), ({ newEnv }) => { newEnv.errors = newEnv.errors.filter((e) => e.id !== row.id); });
  assert.equal(u.status, 1);
  assert.match(u.out, new RegExp(`${rx(row.id)}`));
});

test('CLI sabotage: all-excluded. A stage x game type whose every cell is refused measured nothing', () => {
  const rpgX5h = cells.filter((c) => c.which === 'new' && c.stages.includes('x5h') && c.gt === 'rpg');
  const out = run(world(), ({ newEnv }) => { newEnv.records = newEnv.records.filter((r) => !(byId.get(r.id).stages.includes('x5h') && byId.get(r.id).gt === 'rpg')); });
  assert.ok(rpgX5h.length > 0);
  assert.equal(out.status, 1);
  assert.match(out.out, /all-excluded: every planned x5h\/rpg cell/);
});

test('loadParentEvidence reads a record as a measured twin and an error as a refusal receipt, and refuses a non-parent id or a duplicate', () => {
  const dir = tmp();
  const f = path.join(dir, 'p.json');
  const cellsById = new Map(cells.map((c) => [c.id, c]));
  const ctx = { cellsById, trees, current: parts };
  const pc = cells.filter((c) => c.which === 'parent' && !GROUP_NAMES.some((n) => groups[n].ids.has(partnerOf(c.id))));
  const [a, b] = [pc[0], pc[1]];
  const refused = [...groups.approved74.ids].map(partnerOf)[0];
  const env = (records, errors) => ({ launch: 'P1', complete: true, tree: { side: 'parent', ...Object.fromEntries(['engine', 'harness', 'generator', 'compactGenerator', 'mesen'].map((k) => [k, trees.parent[k]])) }, campaign: files(world()).parentEnv.campaign, verdict: { ok: true }, records, errors });
  fs.writeFileSync(f, JSON.stringify(env([historical(a, trees.parent)], [{ id: refused, error: text(165, 160) }, { id: b.id, error: 'boom' }])));
  const m = loadParentEvidence([f], ctx);
  assert.deepEqual([m.get(a.id).status, m.get(a.id).kind, m.get(refused).status, m.get(refused).need, m.get(refused).free, m.get(b.id).status], ['measured', 'historical', 'refused', 165, 160, 'failed']);
  assert.throws(() => loadParentEvidence([f, f], ctx), /not valid|twice/);
  fs.writeFileSync(f, JSON.stringify(env([{ ...historical(cells.find((c) => c.which === 'new'), trees.new) }], [])));
  assert.throws(() => loadParentEvidence([f], ctx), /not a parent-side id/);
  fs.writeFileSync(f, JSON.stringify({ nope: 1 }));
  assert.throws(() => loadParentEvidence([f], ctx), /not a campaign result/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ the CLI boundary: the final aggregate and the launch gates (no Mesen)

const cli = (...args) => spawnSync(process.execPath, [RUNNER, `--mesen=${FAKE_MESEN}`, ...args], { encoding: 'utf8' });
const tmpJson = (obj) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-agg-')), 'x.json'); fs.writeFileSync(f, JSON.stringify(obj)); return f; };

test('--aggregate refuses a launch file that is partial, not complete, or whose verdict was not ok (the final aggregate is mandatory and clean)', () => {
  const base = envelope('L1', 'new', [], []);
  for (const [name, f] of [['partial', { ...base, partial: true }], ['not complete', { ...base, complete: undefined }], ['not ok', { ...base, verdict: { ok: false } }]]) {
    const r = cli(`--aggregate=${tmpJson(f)}`);
    assert.equal(r.status, 1, `${name}: exit 1`);
    assert.match(r.stderr, /not clean/, name);
  }
});

test('--aggregate of clean but INCOMPLETE launches fails: the plan\'s missing cells and parent twins are named, never silently passed', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-agg-out-')), 'agg.json');
  const r = cli(`--aggregate=${tmpJson(envelope('L1', 'new', [], []))}`, `--out=${out}`);
  assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(j.aggregate, true);
  assert.equal(j.complete, true);
  assert.ok(j.verdict.problems.length > 1000, 'every unmeasured planned cell is a problem');
  assert.match(j.campaign.sha256, /^[0-9a-f]{64}$/);
});

test('a new-tree launch without --parent-evidence is refused before anything runs; a parent launch without --parent is refused', () => {
  const out = path.join(os.tmpdir(), 'never-written.json');
  const a = cli('--launch=L1', `--out=${out}`);
  assert.equal(a.status, 2);
  assert.match(a.stderr, /--parent-evidence/);
  const b = cli('--launch=P1', `--out=${out}`);
  assert.equal(b.status, 2);
  assert.match(b.stderr, /--parent=/);
  assert.ok(!fs.existsSync(out));
});

test('--reuse-only finalizes by reuse or stops: a launch that would need Mesen exits 2 before building or launching anything, naming the count', () => {
  const dir = tmp();
  const { parentEnv } = files(world());
  const p = path.join(dir, 'parent.json');
  fs.writeFileSync(p, JSON.stringify(parentEnv));
  const out = path.join(dir, 'never.json');
  const r = cli('--launch=L1', `--out=${out}`, `--parent-evidence=${p}`, '--reuse-only');
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /--reuse-only: L1 would run \d+ cell\(s\) in Mesen \(\d+ not reused\)/);
  assert.ok(!fs.existsSync(out));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a parent launch must run on the PINNED parent tree: any other tree is refused with the fields that differ, before anything is built', () => {
  assert.throws(() => expectedTrees(evidence, { mesen: FAKE_MESEN, parentRoot: ROOT }), /is not the pinned parent tree \(engine [0-9a-f]{12} != pinned [0-9a-f]{12}/);
  assert.deepEqual(Object.keys(trees.parent).sort(), ['compactGenerator', 'engine', 'generator', 'harness', 'mesen', 'side']);
});

test('writeEnvelope writes the result COMPACT (a parent file is ~100 KB a record: the indented form would pass the string limit) and names the limit when it cannot', () => {
  const dir = tmp();
  const f = path.join(dir, 'e.json');
  const n = writeEnvelope(f, { a: 1, b: [1, 2] });
  assert.equal(fs.readFileSync(f, 'utf8'), '{"a":1,"b":[1,2]}');
  assert.equal(n, 17);
  const cyc = {}; cyc.self = cyc;
  assert.throws(() => writeEnvelope(path.join(dir, 'x.json'), cyc), /too large to serialize|circular/i);
  fs.rmSync(dir, { recursive: true, force: true });
});
