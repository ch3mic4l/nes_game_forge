// Phase 3a slice S3b fix round 1, finding 3: the spike's accepted matrix / confirmation corpus is audited against the final manifest. Pure (no build, no Mesen).
// The fixture is test/fixtures/crossstage/corpus-ids.json (normalized new-side ids; its only exemptions carry their reasons).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enumerateAll } from '../lua/sw_cross_cells.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/crossstage/corpus-ids.json'), 'utf8'));
const cells = enumerateAll();
const byId = new Map(cells.map((c) => [c.id, c]));
const parentOf = (id) => id.replace(/^new\//, 'parent/');

for (const [name, want] of [['matrix160', 160], ['spikeReview3_19', 19], ['spikeReview3_10', 10], ['confirmation98', 94]]) {
  test(`corpus ${name}: all ${want} ids are planned cells of x5h, new AND parent`, () => {
    assert.equal(corpus[name].length, want);
    assert.equal(new Set(corpus[name]).size, want, 'the corpus lists an id twice');
    for (const id of corpus[name]) {
      assert.ok(byId.has(id), `${id} is not planned`);
      assert.ok(byId.get(id).stages.includes('x5h'), `${id} is not in stage x5h`);
      assert.ok(byId.has(parentOf(id)), `${parentOf(id)}: no parent twin`);
    }
  });
}

test('the 19 spike-review-3 combinations the review found missing are present (the exact list)', () => {
  const missing19 = JSON.parse(fs.readFileSync(path.join(ROOT, 'handoff-next/s3b/reviewer6/missing19.json'), 'utf8'));
  assert.equal(missing19.missing.length, 19);
  for (const id of missing19.missing) assert.ok(byId.has(id), id);
});

test('the superseded exemptions are exactly the four pure repeats and the forty reduced-workload nowait rows; nothing else is exempt', () => {
  assert.equal(corpus.superseded.pureRepeats.ids.length, 4);
  for (const id of corpus.superseded.pureRepeats.ids) assert.ok(/\/rep\d+$/.test(id) && !byId.has(id), id);
  assert.equal(corpus.superseded.nowaitReducedWorkload.count, 40);
});

test('the matrix is the product game x width x four populations x plain/bound x five tails: 160, and every one has enter-set', () => {
  assert.equal(corpus.matrix160.length, 2 * 2 * 4 * 2 * 5);
  for (const id of corpus.matrix160) assert.match(id, /\/enter-set\//);
});
