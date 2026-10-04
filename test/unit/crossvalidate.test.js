// Phase 3a slice S3b fix round 2, finding 2 (review 2): evidence is validated where it ENTERS (a parent file loaded as a receipt) and where it is
// AGGREGATED, not only when deciding reuse. The reviewer's serialized-boundary sabotages are tests here: a failed parent read as a success receipt; a real
// child record whose engine, measuring-code fingerprint and raw pointer are wrong yet which the verdict passed; and the rest of the ways a file can lie
// (side, options, tree, fingerprints, raw bytes, raw linkage, an unjustified historical record). Pure: no build, no Mesen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { validateEnvelopes, recordProblems, envelopeProblems, readRaw, EvidenceError } from '../lua/sw_cross_validate.mjs';
import { loadParentEvidence } from '../lua/sw_cross_evidence.mjs';
import { cells, byId, trees, parts, measureFp, historical, measured, envelope, world, files, tmp, groups, FAKE_MESEN } from '../lib/crossworld.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNNER = path.join(ROOT, 'test/lua/run_sw_cross.mjs');
const cellsById = byId;
const ctx = { cellsById, trees, current: parts };
const x4 = cells.find((c) => c.which === 'new' && c.stages.includes('x4') && c.gt === 'action');
const px4 = byId.get(x4.id.replace(/^new\//, 'parent/'));
const check = (j, side = 'new', name = 'f.json') => validateEnvelopes([{ name, j, side }], ctx);
const clean = (side, rec) => envelope(side === 'new' ? 'L3' : 'P1', side, [rec], []);
const joined = (v) => v.problems.join(';');

test('a valid raw record, a valid historical record and a valid envelope pass, and the two kinds are counted apart', () => {
  const dir = tmp();
  const a = check(clean('new', measured(x4, trees.new, dir)));
  assert.deepEqual(a.problems, []);
  assert.deepEqual(a.kinds, { raw: 1, historical: 0 });
  const b = check(clean('new', historical(x4, trees.new)));
  assert.deepEqual(b.problems, []);
  assert.deepEqual(b.kinds, { raw: 0, historical: 1 });
  assert.deepEqual(check(clean('parent', measured(px4, trees.parent, dir)), 'parent').problems, []);
});

// ---------------------------------------------------------------- reviewer sabotage 1: a failed parent is not a success receipt

test('sabotage: a parent file with complete:false, verdict.ok:false and a record with status 1 / done false / timeout true is refused by the loader, never read as a measured twin', () => {
  const dir = tmp();
  const f = path.join(dir, 'p.json');
  const rec = { ...historical(px4, trees.parent), status: 1, done: false, timeout: true };
  const bad = { ...clean('parent', rec), complete: false, verdict: { ok: false } };
  fs.writeFileSync(f, JSON.stringify(bad));
  assert.throws(() => loadParentEvidence([f], ctx), (e) => e instanceof EvidenceError && /not marked complete/.test(e.message) && /its own verdict is not ok/.test(e.message) && /status is 1, a successful run has 0/.test(e.message) && /done is false/.test(e.message) && /timeout is true/.test(e.message));
  // each defect alone is enough
  for (const [what, edit, re] of [
    ['incomplete', (j) => { j.complete = false; }, /not marked complete/],
    ['partial', (j) => { j.partial = true; }, /a partial result/],
    ['verdict not ok', (j) => { j.verdict = { ok: false }; }, /verdict is not ok/],
    ['timeout', (j) => { j.records[0].timeout = true; }, /timeout is true/],
    ['exit status', (j) => { j.records[0].status = 1; }, /status is 1/],
    ['not done', (j) => { j.records[0].done = false; }, /done is false/]
  ]) {
    const j = clean('parent', historical(px4, trees.parent));
    edit(j);
    fs.writeFileSync(f, JSON.stringify(j));
    assert.throws(() => loadParentEvidence([f], ctx), re, what);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- reviewer sabotage 2: the child record that passed with every link wrong

test('sabotage: a real child record with prov.engine = wrong-tree, campaign = obsolete-measuring-code and a raw pointer to a missing file with a wrong hash/length fails on each, at validation AND through the CLI', () => {
  const dir = tmp();
  const good = measured(x4, trees.new, dir);
  const rec = structuredClone(good);
  rec.prov.engine = 'wrong-tree';
  rec.campaign = 'obsolete-measuring-code';
  rec.raw = { dir, file: 'nonexistent.json.gz', sha256: 'f'.repeat(64), bytes: 123 };
  const out = joined(check(clean('new', rec)));
  assert.match(out, /provenance\.engine is missing or not a sha-256/);
  assert.match(out, /measuring-implementation fingerprint obsolete-mea/);
  assert.match(out, /raw file .*nonexistent\.json\.gz does not exist/);
  // the same defects through the exclusion CLI and the aggregate: neither passes it, neither stamps a fresh fingerprint over it
  const w = world();
  const stub = w.records[0];
  const broken = { ...structuredClone(stub), campaign: 'obsolete-measuring-code', raw: { dir, file: 'nonexistent.json.gz', sha256: 'f'.repeat(64), bytes: 123 } };
  broken.prov.engine = 'wrong-tree';
  w.records[0] = broken;
  const { newEnv, parentEnv } = files(w);
  const n = path.join(dir, 'n.json'); const p = path.join(dir, 'p.json');
  fs.writeFileSync(n, JSON.stringify(newEnv)); fs.writeFileSync(p, JSON.stringify(parentEnv));
  const v = spawnSync(process.execPath, [RUNNER, `--mesen=${FAKE_MESEN}`, `--verify-exclusions=${n}`, `--parent-evidence=${p}`], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(v.status, 1, v.stdout + v.stderr);
  assert.match(v.stdout, /measuring-implementation fingerprint obsolete-mea/);
  const aggOut = path.join(dir, 'agg.json');
  const a = spawnSync(process.execPath, [RUNNER, `--mesen=${FAKE_MESEN}`, `--parent-evidence=${p}`, `--aggregate=${n},${p}`, `--out=${aggOut}`], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(a.status, 1, a.stdout + a.stderr);
  const j = JSON.parse(fs.readFileSync(aggOut, 'utf8'));
  assert.ok(j.verdict.problems.some((x) => x.id === '(evidence)' && /obsolete-mea/.test(x.problem)), 'the aggregate carries the record\'s own problem');
  assert.equal(j.verdict.ok, false);
  assert.ok(j.fileHashes.every((h) => /^[0-9a-f]{64}$/.test(h.sha256)), 'the aggregate names the exact bytes of every file it judged');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- the rest of the ways a file can lie

test('sabotage: a record of the wrong side, another cell, other options, another tree, an old fingerprint or no source block is a named problem', () => {
  const dir = tmp();
  const base = () => measured(x4, trees.new, dir);
  const probe = (edit, re, { side = 'new', cell = x4 } = {}) => {
    const rec = base(); edit(rec);
    const r = recordProblems(rec, cell, { expected: trees[side], measureFp });
    assert.match(r.problems.join(';'), re);
  };
  probe((r) => { r.options = { ...r.options, dist: 1 }; }, /other options than the cell's own/);
  probe((r) => { r.id = 'new/not/a/cell'; }, /is the record of/);
  probe((r) => { r.prov.harness = 'a'.repeat(64); }, /provenance\.harness/);
  probe((r) => { r.prov.mesen = 'a'.repeat(64); }, /provenance\.mesen/);
  probe((r) => { r.prov.generator = 'a'.repeat(64); }, /provenance\.generator/);
  probe((r) => { r.campaign = 'b'.repeat(64); }, /measuring-implementation fingerprint/);
  probe((r) => { delete r.source; }, /no source block/);
  probe((r) => { r.rows = []; }, /carries no measurement/);
  assert.match(recordProblems(base(), undefined, { expected: trees.new, measureFp }).problems.join(';'), /is not a planned cell/);
  // a parent-side cell inside a new-side file
  assert.match(joined(check(clean('new', historical(px4, trees.new)), 'new')), /is a parent-side cell in a new-side file/);
  // a compact record claims the compacting root's generator; a plain generator on it is wrong
  const comp = cells.find((c) => c.which === 'new' && c.stages.includes('x4') && c.id.includes('/compact'));
  if (comp) {
    const r = historical(comp, trees.new); r.prov.generator = trees.new.generator;
    assert.match(recordProblems(r, comp, { expected: trees.new, measureFp }).problems.join(';'), /compacting-root generator/);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sabotage: an envelope of another tree, produced by other code, unstamped, or of the wrong side is refused as a whole', () => {
  const probe = (edit, re, side = 'new') => {
    const j = clean(side, historical(side === 'new' ? x4 : px4, trees[side]));
    edit(j);
    assert.match(envelopeProblems(j, { name: 'f.json', side, expected: trees[side], current: parts }).join(';'), re);
  };
  probe((j) => { delete j.tree; }, /no tree stamp/);
  probe((j) => { j.tree.engine = 'c'.repeat(64); }, /measured engine/);
  probe((j) => { j.tree.compactGenerator = 'c'.repeat(64); }, /measured compactGenerator/);
  probe((j) => { j.tree.side = 'parent'; }, /tree stamp says side "parent"/);
  probe((j) => { j.campaign.measure.sha256 = 'd'.repeat(64); }, /its measure fingerprint/);
  probe((j) => { j.campaign.judge.sha256 = 'd'.repeat(64); }, /its judge fingerprint/);
  probe((j) => { j.campaign.fixtures.sha256 = 'd'.repeat(64); }, /its fixtures fingerprint/);
  probe((j) => { j.launch = 'P1'; }, /not a new-side launch/);
  probe((j) => { j.launch = 'L1'; }, /not a parent-side launch/, 'parent');
  probe((j) => { delete j.campaign; }, /fingerprint/);
});

test('sabotage: raw evidence. A corrupt file, a wrong length, a wrong hash, another cell\'s raw, a provenance that differs and rows that are not the raw\'s each fail', () => {
  const dir = tmp();
  const fresh = () => measured(x4, trees.new, dir);
  const rawPath = (r) => path.join(r.raw.dir, r.raw.file);
  const probe = (edit, re) => { const r = fresh(); edit(r); assert.match(joined(check(clean('new', r))), re); };
  probe((r) => { fs.writeFileSync(rawPath(r), 'not gzip'); r.raw.bytes = 8; r.raw.sha256 = require_sha('not gzip'); }, /cannot be read/);
  probe((r) => { r.status = 1; }, /status is 1, a successful run has 0/);
  probe((r) => { r.done = false; }, /done is false/);
  probe((r) => { r.timeout = true; }, /timeout is true/);
  probe((r) => { delete r.source.cacheKey; }, /names no cache key/);
  probe((r) => { r.raw.bytes += 1; }, /bytes, the pointer says/);
  probe((r) => { r.raw.sha256 = '0'.repeat(64); }, /hashes to/);
  probe((r) => { delete r.raw.dir; }, /pointer is not/);
  probe((r) => { r.raw.file = '../escape.json.gz'; }, /not a plain \.json\.gz name/);
  // a raw file of ANOTHER cell, with a pointer that matches its own bytes: the file is intact, the link is wrong
  probe((r) => { const other = measured(byId.get('new/rpg/wide/few-large-1/P1/bound/lead-flash/tail-none/d3/y60/compact') ?? cells.find((c) => c.which === 'new' && c.id !== x4.id), trees.new, dir); r.raw = other.raw; }, /raw is for /);
  const withRaw = (mut) => (r) => { const f = rawPath(r); const j = JSON.parse(require_gunzip(fs.readFileSync(f))); mut(j); const body = gzipSync(JSON.stringify(j)); fs.writeFileSync(f, body); r.raw.bytes = body.length; r.raw.sha256 = require_sha(body); };
  probe(withRaw((j) => { j.cacheKey = 'zz'; }), /cache key/);
  probe(withRaw((j) => { j.prov.rom = 'e'.repeat(64); }), /provenance\.rom differs/);
  probe(withRaw((j) => { j.status = 1; }), /status 1 differs/);
  probe(withRaw((j) => { j.marks.M11[0].line = 'MK move_tick G=9'; }), /does not give the record's rows/);
  fs.rmSync(dir, { recursive: true, force: true });
});
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
function require_sha(b) { return crypto.createHash('sha256').update(b).digest('hex'); }
function require_gunzip(b) { return gunzipSync(b).toString('utf8'); }

test('sabotage: a record with neither a raw pointer nor a historical justification is refused; a historical record is counted as historical, never as raw', () => {
  const rec = historical(x4, trees.new);
  delete rec.restamp;
  assert.match(joined(check(clean('new', rec))), /neither a raw pointer nor an explicit historical \(restamp\) justification/);
  const r2 = historical(x4, trees.new); r2.restamp = { validated: '', from: 'x' };
  assert.match(joined(check(clean('new', r2))), /neither a raw pointer/);
  const ok = check(clean('new', historical(x4, trees.new)));
  assert.deepEqual(ok.kinds, { raw: 0, historical: 1 });
  assert.deepEqual(ok.perFile[0], { name: 'f.json', launch: 'L3', side: 'new', records: 1, errors: 0, raw: 0, historical: 1 });
});

test('a reused raw record keeps pointing at its ORIGINATING directory: its envelope can be written anywhere and the raw file is still found', () => {
  const dirA = tmp(); const dirB = tmp();
  const rec = measured(x4, trees.new, path.join(dirA, 'raw'));
  assert.ok(path.isAbsolute(rec.raw.dir));
  // the record is copied into an envelope written under another directory
  const j = clean('new', rec);
  fs.writeFileSync(path.join(dirB, 'other-launch.json'), JSON.stringify(j));
  assert.deepEqual(check(JSON.parse(fs.readFileSync(path.join(dirB, 'other-launch.json'), 'utf8'))).problems, []);
  assert.deepEqual(readRaw(rec).problems, []);
  fs.rmSync(dirA, { recursive: true, force: true });
  assert.match(readRaw(rec).problems.join(';'), /does not exist/, 'removing the originating directory breaks it, as it must');
  fs.rmSync(dirB, { recursive: true, force: true });
});

test('an error in a file that is not planned, of the other side or without a message is a problem; errors never pass as measurements', () => {
  const j = envelope('L3', 'new', [], [{ id: 'new/nope', error: 'x' }, { id: px4.id, error: 'x' }, { id: x4.id }]);
  const out = joined(check(j));
  assert.match(out, /new\/nope is an error for a cell that is not planned/);
  assert.match(out, /is a parent-side cell in a new-side file/);
  assert.match(out, /is an error with no message/);
});

test('groups are untouched by the validator: the world\'s refusals still pass (a regression guard on the helper itself)', () => {
  const w = world();
  assert.deepEqual(check(files(w).newEnv).problems, []);
  assert.deepEqual(check(files(w).parentEnv, 'parent').problems, []);
  assert.ok(groups.origNewRegression.ids.size === 48);
});
