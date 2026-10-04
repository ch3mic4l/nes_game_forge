// Phase 3a slice S3b fix round 1, finding 7: the campaign's own implementation is fingerprinted, separately from the bound sweep's harness hash
// (sw_provenance.mjs HARNESS_FILES, which stays exactly as it was so that every recorded parent figure keeps its harness hash).
//
//   measure   the files that decide WHAT is measured: the cell enumerator, the scene builders and marks, the compaction (root and pass), the move policy
//             and the manifest/sweep helpers they call. Stamped on every record; a record may stand for a cell only if it matches (sw_cross_reuse.mjs).
//   judge     the files that decide what a measurement MEANS (classes, exclusions, reuse, the runner) and the fixtures they read. Pinned in the campaign
//             envelope of every launch; a verdict from other judging code is not the verdict of this campaign.
// Both hash file names and bytes, in a fixed order. PURE (reads files only).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { REPO } from './sw_manifest_scene.mjs';

export const MEASURE_FILES = ['sw_cross_cells.mjs', 'sw_cross_scene.mjs', 'sw_compact_root.mjs', 'sw_compact_actors.mjs', 'sw_move_policy.mjs', 'run_sw_move_manifest.mjs', 'run_sw_move_sweep.mjs'].map((f) => `test/lua/${f}`);
export const JUDGE_FILES = ['sw_cross_classes.mjs', 'sw_cross_exclusions.mjs', 'sw_cross_reuse.mjs', 'sw_cross_evidence.mjs', 'sw_cross_fingerprint.mjs', 'sw_cross_validate.mjs', 'run_sw_cross.mjs'].map((f) => `test/lua/${f}`);
export const FIXTURE_FILES = ['streamedmove-unreachable.json', 'crossstage/exclusions-appendix.json', 'crossstage/exclusions-conditional.json', 'crossstage/exclusions-orig-capacity.json', 'crossstage/exclusions-evidence.json', 'crossstage/corpus-ids.json'].map((f) => `test/fixtures/${f}`);

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function hashList(root, files) {
  const per = {};
  const h = crypto.createHash('sha256');
  for (const f of files) {
    const p = path.join(root, f);
    const bytes = fs.existsSync(p) ? fs.readFileSync(p) : Buffer.from('<missing>');
    per[f] = sha(bytes);
    h.update(`${f}\n`); h.update(bytes); h.update('\n');
  }
  return { sha256: h.digest('hex'), files: per };
}

/** The measuring implementation's hash (stamped on every record). */
export const measureFingerprint = (root = REPO) => hashList(root, MEASURE_FILES).sha256;
/** The whole campaign implementation: measure, judge and fixtures (per file), plus the options of the launch. */
export function campaignFingerprint(options = {}, root = REPO) {
  const measure = hashList(root, MEASURE_FILES);
  const judge = hashList(root, JUDGE_FILES);
  const fixtures = hashList(root, FIXTURE_FILES);
  const opts = sha(JSON.stringify(options, Object.keys(options).sort()));
  return { measure, judge, fixtures, options: { sha256: opts, value: options }, sha256: sha(`${measure.sha256}\n${judge.sha256}\n${fixtures.sha256}\n${opts}`) };
}
