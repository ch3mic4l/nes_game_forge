// Slice S3b fix round 1, finding 7: the campaign's provenance. No Mesen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { compactRoot } from '../lua/sw_compact_root.mjs';
import { generatorHash } from '../lua/sw_provenance.mjs';
import { measureFingerprint, campaignFingerprint, MEASURE_FILES, JUDGE_FILES, FIXTURE_FILES } from '../lua/sw_cross_fingerprint.mjs';
import { writeRaw } from '../lua/run_sw_cross.mjs';

const REPO = path.resolve(new URL('../..', import.meta.url).pathname);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function fakeRoot() {
  const d = tmp('forge-fake-root-');
  for (const sub of ['engine', 'shared', 'main/build']) fs.mkdirSync(path.join(d, sub), { recursive: true });
  fs.writeFileSync(path.join(d, 'engine/a.asm'), 'nop\n');
  fs.writeFileSync(path.join(d, 'shared/s.js'), 'export const s = 1;\n');
  fs.writeFileSync(path.join(d, 'main/build/pipeline.js'), 'export async function buildProject() {}\n');
  fs.writeFileSync(path.join(d, 'main/build/generate.js'), 'export const g = 1;\n');
  fs.writeFileSync(path.join(d, 'main/build/other.js'), 'export const o = 1;\n');
  return d;
}

test('the compact root holds real copies of every main/build file, so a change behind the wrapper changes the generator hash', () => {
  const a = fakeRoot();
  const b = fakeRoot();
  fs.writeFileSync(path.join(b, 'main/build/other.js'), 'export const o = 2;\n'); // a module BEHIND the pipeline wrapper
  const ra = compactRoot(a);
  const rb = compactRoot(b);
  for (const f of fs.readdirSync(path.join(ra, 'main/build'))) assert.ok(!fs.lstatSync(path.join(ra, 'main/build', f)).isSymbolicLink(), `${f} is a real file, not a symlink`);
  assert.ok(fs.existsSync(path.join(ra, 'main/build/sw_compact_actors.mjs')), 'the compactor is copied in, so its bytes are hashed');
  assert.ok(fs.existsSync(path.join(ra, 'main/build/pipeline.real.js')));
  assert.notEqual(generatorHash(ra), generatorHash(rb), 'a generator module behind the wrapper is part of the hash');
  const wrapper = fs.readFileSync(path.join(ra, 'main/build/pipeline.js'), 'utf8');
  assert.ok(!wrapper.includes(a) && !wrapper.includes(REPO), 'the wrapper holds no absolute path');
  assert.equal(compactRoot(a), ra, 'one root per tree');
});

test('the compact root of the real tree hashes the real generator and the compactor (dependency bytes, not only the wrapper)', () => {
  const root = compactRoot(REPO);
  const walked = (d) => fs.readdirSync(d, { recursive: true }).filter((f) => fs.statSync(path.join(d, f)).isFile()).length;
  assert.equal(walked(path.join(root, 'main/build')), walked(path.join(REPO, 'main/build')) + 2, 'every real main/build file, plus the compactor and the pipeline wrapper (pipeline.js itself is kept as pipeline.real.js)');
  const real = fs.readFileSync(path.join(REPO, 'main/build/generate.js'));
  assert.deepEqual(fs.readFileSync(path.join(root, 'main/build/generate.js')), real);
  assert.notEqual(generatorHash(root), generatorHash(REPO), 'the compact build is a different generator than the plain one');
});

test('the campaign fingerprint covers every measuring, judging and fixture file, and changes with each, with the options, and with a missing file', () => {
  for (const f of [...MEASURE_FILES, ...JUDGE_FILES, ...FIXTURE_FILES]) assert.ok(fs.existsSync(path.join(REPO, f)), `${f} exists`);
  const root = tmp('forge-fp-root-');
  for (const f of [...MEASURE_FILES, ...JUDGE_FILES, ...FIXTURE_FILES]) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), `// ${f}\n`); }
  const base = campaignFingerprint({ jobs: 20 }, root);
  assert.equal(base.sha256, campaignFingerprint({ jobs: 20 }, root).sha256, 'deterministic');
  assert.notEqual(base.sha256, campaignFingerprint({ jobs: 19 }, root).sha256, 'the options are part of it');
  assert.equal(base.sha256, campaignFingerprint({ jobs: 20 }, root).sha256);
  for (const f of [...MEASURE_FILES, ...JUDGE_FILES, ...FIXTURE_FILES]) {
    fs.appendFileSync(path.join(root, f), '// edited\n');
    assert.notEqual(campaignFingerprint({ jobs: 20 }, root).sha256, base.sha256, `${f} is covered`);
    if (MEASURE_FILES.includes(f)) assert.notEqual(measureFingerprint(root), measureFingerprint(tmp('forge-fp-empty-')), 'measure fingerprint reads it');
    fs.writeFileSync(path.join(root, f), `// ${f}\n`);
  }
  const before = measureFingerprint(root);
  fs.rmSync(path.join(root, MEASURE_FILES[0]));
  assert.notEqual(measureFingerprint(root), before, 'a missing file is a different fingerprint, never skipped');
});

test('a measure-file edit changes the measure fingerprint only, a judge-file edit leaves it alone', () => {
  const root = tmp('forge-fp-root2-');
  for (const f of [...MEASURE_FILES, ...JUDGE_FILES, ...FIXTURE_FILES]) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), 'x\n'); }
  const m = measureFingerprint(root);
  fs.appendFileSync(path.join(root, JUDGE_FILES[0]), 'y');
  assert.equal(measureFingerprint(root), m, 'judging code does not invalidate a measurement');
  fs.appendFileSync(path.join(root, MEASURE_FILES[1]), 'y');
  assert.notEqual(measureFingerprint(root), m);
});

test('raw marks and traces are preserved with ROM/project/source linkage, and the pointer verifies the stored bytes', () => {
  const dir = tmp('forge-raw-');
  const res = { cacheKey: 'k1', prov: { rom: 'r'.repeat(64), project: 'p'.repeat(64), engine: 'e', harness: 'h', generator: 'g', mesen: 'm' }, status: 0, done: true, timeout: false, frames: 900, timing: { a: 1 }, phases: ['x'], marks: [{ name: 'sw_tr_loop', cycle: 100 }, { name: 'sw_tr_loop', cycle: 140 }], trace: [{ row: 1 }] };
  const ptr = writeRaw(dir, 'new/x4/y', res);
  const body = fs.readFileSync(path.join(dir, ptr.file));
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'), ptr.sha256);
  assert.equal(body.length, ptr.bytes);
  const back = JSON.parse(zlib.gunzipSync(body));
  assert.equal(back.id, 'new/x4/y');
  assert.equal(back.cacheKey, 'k1', 'linked to the Mesen run key');
  assert.equal(back.prov.rom, res.prov.rom);
  assert.equal(back.prov.project, res.prov.project);
  assert.equal(back.marks.length, 2, 'multiplicity kept: two executions of one mark are two entries');
  assert.deepEqual(back.trace, res.trace);
  assert.notEqual(writeRaw(dir, 'new/x4/z', res).file, ptr.file, 'one file per id');
});
