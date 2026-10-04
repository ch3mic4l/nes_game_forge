// Phase 3a slice S3b fix round 2, finding 2: evidence is validated where it ENTERS (a parent envelope loaded as a receipt, a result file handed to the
// exclusion check, a record reused into another launch) and again where it is AGGREGATED -- never only when deciding whether to reuse a record.
//
// A result file ("envelope") is only evidence if it is a complete, clean launch of the tree it claims (its `tree` stamp equals the expected tree of its side) by
// the same measuring, judging and fixture code as this campaign. Each record in it must be for a planned cell of the right side, measured with that cell's own
// normalized options, with a complete provenance whose engine / harness / generator / Mesen equal the expected tree's and whose measuring-implementation
// fingerprint (`campaign`) equals this campaign's, and it must show a successful measurement (exit 0, finished, no timeout). A record is then one of two kinds:
//   raw         newly measured: carries a raw pointer { dir, file, sha256, bytes }; the file must exist where the pointer says (its ORIGINATING directory, which a
//               reuse into another envelope preserves), hash and length as recorded, and link back to the record (id, cache key, provenance, exit state), and the
//               record's derived rows / summary must be exactly what the raw marks and trace give
//   historical  carries no raw trace but an explicit `restamp` justification (an earlier run's measurement whose ROM and project were re-derived by a deterministic
//               rebuild on the same tree): counted and reported SEPARATELY, never taken for newly recorded raw evidence
// Anything else is a problem. PURE but for reading the raw files the records point at; no build, no Mesen.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { PROVENANCE_FIELDS, provenanceFieldProblems } from './sw_provenance.mjs';
import { cellOptions, CROSS_STAGES } from './sw_cross_cells.mjs';
import { bodyRows } from './sw_cross_classes.mjs';
import { classify } from './run_sw_move_manifest.mjs';
import { needsCompact } from './sw_move_policy.mjs';
import { usesCompactRoot } from './sw_cross_scene.mjs';

/** The tree-identifying fields an envelope stamps and an expected tree supplies. */
export const TREE_FIELDS = ['engine', 'harness', 'generator', 'compactGenerator', 'mesen'];
export const CAMPAIGN_PARTS = ['measure', 'judge', 'fixtures'];
const sideOfLaunch = (launch) => (/^P\d/.test(launch ?? '') ? 'parent' : /^L\d/.test(launch ?? '') ? 'new' : null);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** An Error carrying every problem (so a loader can refuse a bad file and a CLI can print all of them). */
export class EvidenceError extends Error {
  constructor(problems, what = 'evidence') {
    super(`${what} is not valid:\n  ${problems.slice(0, 12).join('\n  ')}${problems.length > 12 ? `\n  ... and ${problems.length - 12} more` : ''}`);
    this.name = 'EvidenceError';
    this.problems = problems;
  }
}

/** The stamp a launch writes into its envelope: which tree it measured (`side`) and that tree's hashes. */
export const treeStamp = (side, h) => ({ side, ...Object.fromEntries(TREE_FIELDS.map((f) => [f, h[f]])) });

/**
 * Problems of an envelope AS A WHOLE: complete, not partial, its own verdict clean, a launch name of this side, the tree it measured equal to `expected`
 * (what this side's tree is now / what the evidence pins), and the measuring, judging and fixture fingerprints equal to this campaign's (`current`:
 * { measure, judge, fixtures } sha-256 each). `side` = the side the caller needs the file to be.
 */
export function envelopeProblems(env, { name, side, expected, current }) {
  const at = (m) => `${name}: ${m}`;
  if (!env || typeof env !== 'object' || !Array.isArray(env.records) || !Array.isArray(env.errors)) return [at('not a campaign result (no records/errors arrays)')];
  const out = [];
  if (env.partial === true) out.push(at('a partial result: the launch did not finish'));
  if (env.complete !== true) out.push(at('not marked complete: the launch did not run every planned cell to the end (a finalized envelope is written by the launch itself, never by hand)'));
  if (env.verdict?.ok !== true) out.push(at('its own verdict is not ok'));
  if (sideOfLaunch(env.launch) !== side) out.push(at(`launch ${JSON.stringify(env.launch)} is not a ${side}-side launch`));
  const t = env.tree;
  if (!t || typeof t !== 'object') out.push(at('carries no tree stamp: which tree it measured is unknown'));
  else {
    if (t.side !== side) out.push(at(`its tree stamp says side ${JSON.stringify(t.side)}, not ${side}`));
    for (const f of TREE_FIELDS) if (t[f] !== expected?.[f]) out.push(at(`measured ${f} ${String(t[f]).slice(0, 12)}, the expected ${side} tree has ${String(expected?.[f]).slice(0, 12)}`));
  }
  for (const k of CAMPAIGN_PARTS) if (env.campaign?.[k]?.sha256 !== current?.[k]) out.push(at(`its ${k} fingerprint ${String(env.campaign?.[k]?.sha256).slice(0, 12)} is not this campaign's ${String(current?.[k]).slice(0, 12)}: another implementation produced it`));
  return out;
}

/** Reads and checks the raw file a record points at. Returns { problems, raw }. */
export function readRaw(rec) {
  const p = rec.raw;
  const at = (m) => `${rec.id}: raw ${m}`;
  if (!p || typeof p !== 'object' || typeof p.dir !== 'string' || typeof p.file !== 'string' || !/^[0-9a-f]{64}$/.test(p.sha256 ?? '') || !Number.isInteger(p.bytes)) return { problems: [at('pointer is not { dir, file, sha256, bytes }')] };
  if (p.file !== path.basename(p.file) || !/\.json\.gz$/.test(p.file)) return { problems: [at(`file ${JSON.stringify(p.file)} is not a plain .json.gz name`)] };
  const full = path.join(p.dir, p.file);
  if (!fs.existsSync(full)) return { problems: [at(`file ${full} does not exist`)] };
  const buf = fs.readFileSync(full);
  if (buf.length !== p.bytes) return { problems: [at(`file ${full} has ${buf.length} bytes, the pointer says ${p.bytes}`)] };
  if (sha(buf) !== p.sha256) return { problems: [at(`file ${full} hashes to ${sha(buf).slice(0, 12)}, the pointer says ${p.sha256.slice(0, 12)}`)] };
  try { return { problems: [], raw: JSON.parse(gunzipSync(buf).toString('utf8')) }; } catch (e) { return { problems: [at(`file ${full} cannot be read: ${e.message}`)] }; }
}

/** The raw measurement against its record: identity, cache key, provenance, exit state, and the derived rows/summary the record carries. */
export function rawLinkProblems(rec, raw, cell) {
  const out = [];
  const at = (m) => `${rec.id}: raw ${m}`;
  if (raw.id !== rec.id) out.push(at(`is for ${raw.id}`));
  if (raw.cacheKey !== rec.source?.cacheKey) out.push(at(`cache key ${String(raw.cacheKey).slice(0, 12)} is not the record's ${String(rec.source?.cacheKey).slice(0, 12)}`));
  for (const f of PROVENANCE_FIELDS) if (raw.prov?.[f] !== rec.prov?.[f]) out.push(at(`provenance.${f} differs from the record's`));
  for (const f of ['status', 'done', 'timeout']) if (raw[f] !== rec[f]) out.push(at(`${f} ${JSON.stringify(raw[f])} differs from the record's ${JSON.stringify(rec[f])}`));
  if (rec.rows) {
    try { if (!same(bodyRows(raw), rec.rows)) out.push(at('does not give the record\'s rows')); } catch (e) { out.push(at(`cannot be turned into rows: ${e.message}`)); }
  }
  if (rec.summary && cell?.lead !== undefined) {
    try { if (!same(classify(raw, { lead: cell.lead, tail: cell.tail }), rec.summary)) out.push(at('does not give the record\'s summary')); } catch (e) { out.push(at(`cannot be classified: ${e.message}`)); }
  }
  return out;
}

/**
 * Problems of one RECORD for its planned `cell`, and its evidence kind. `expected` = the expected tree of the cell's side; `measureFp` = this campaign's
 * measuring-implementation fingerprint.
 */
export function recordProblems(rec, cell, { expected, measureFp }) {
  const at = (m) => `${rec.id}: ${m}`;
  if (!cell) return { problems: [at('is not a planned cell')], kind: null };
  const out = [];
  if (rec.id !== cell.id) out.push(at(`is the record of ${cell.id}`));
  if (!rec.id?.startsWith(`${cell.which}/`)) out.push(at(`is not a ${cell.which}-side id`));
  if (!same(rec.options, cellOptions(cell))) out.push(at('was measured with other options than the cell\'s own normalized options'));
  for (const m of provenanceFieldProblems(rec.prov)) out.push(at(m));
  const compact = rec.source?.compact === true;
  const wantCompact = cell.stages?.some((s) => CROSS_STAGES.includes(s)) ? usesCompactRoot(cell) : needsCompact(cell);
  if (typeof rec.source !== 'object' || rec.source === null) out.push(at('carries no source block'));
  else if (compact !== wantCompact) out.push(at(`says compact=${compact}, the cell is built ${wantCompact ? '' : 'not '}through the compacting root`));
  for (const f of ['engine', 'harness', 'mesen']) if (rec.prov?.[f] !== expected?.[f]) out.push(at(`provenance.${f} ${String(rec.prov?.[f]).slice(0, 12)} is not the expected tree's ${String(expected?.[f]).slice(0, 12)}`));
  const wantGen = compact ? expected?.compactGenerator : expected?.generator;
  if (rec.prov?.generator !== wantGen) out.push(at(`provenance.generator ${String(rec.prov?.generator).slice(0, 12)} is not the expected ${compact ? 'compacting-root ' : ''}generator ${String(wantGen).slice(0, 12)}`));
  if (compact && rec.source?.plainGenerator !== expected?.generator) out.push(at('a compact record names another plain generator than the expected tree\'s'));
  if (rec.campaign !== measureFp) out.push(at(`measuring-implementation fingerprint ${String(rec.campaign).slice(0, 12)} is not this campaign's ${String(measureFp).slice(0, 12)}`));
  if (!(Array.isArray(rec.rows) && rec.rows.length) && !(rec.summary && typeof rec.summary === 'object')) out.push(at('carries no measurement (no rows, no summary)'));
  let kind = null;
  if (rec.raw) {
    kind = 'raw';
    if (typeof rec.source?.cacheKey !== 'string') out.push(at('a measured record names no cache key'));
    for (const [f, v] of [['status', 0], ['done', true], ['timeout', false]]) if (rec[f] !== v) out.push(at(`${f} is ${JSON.stringify(rec[f])}, a successful run has ${JSON.stringify(v)}`));
    const r = readRaw(rec);
    out.push(...r.problems);
    if (r.raw) out.push(...rawLinkProblems(rec, r.raw, cell));
  } else if (typeof rec.restamp?.validated === 'string' && rec.restamp.validated && typeof rec.restamp.from === 'string') {
    kind = 'historical';
    for (const [f, v] of [['status', 0], ['done', true], ['timeout', false]]) if (rec[f] !== undefined && rec[f] !== v) out.push(at(`${f} is ${JSON.stringify(rec[f])}, a successful run has ${JSON.stringify(v)}`));
  } else out.push(at('has neither a raw pointer nor an explicit historical (restamp) justification'));
  return { problems: out, kind };
}

/**
 * Every problem of a list of envelopes. `files` = [{ name, j, side }], `cellsById` = Map id -> planned cell, `trees` = { new, parent } expected trees,
 * `current` = { measure, judge, fixtures } of this campaign's code. Returns { problems, shape (the envelope-level problems alone), kinds: { raw, historical }, perFile }.
 */
export function validateEnvelopes(files, { cellsById, trees, current }) {
  const problems = [];
  const shape = []; // the problems of the envelopes AS WHOLES (not complete, another tree, other code): a file with one is not read any further by an aggregate
  const kinds = { raw: 0, historical: 0 };
  const perFile = [];
  for (const { name, j, side } of files) {
    const ep = envelopeProblems(j, { name, side, expected: trees[side], current });
    problems.push(...ep);
    shape.push(...ep);
    const k = { raw: 0, historical: 0 };
    if (Array.isArray(j?.records)) {
      for (const rec of j.records) {
        const cell = cellsById.get(rec.id);
        const r = recordProblems(rec, cell, { expected: trees[side], measureFp: current?.measure });
        if (cell && cell.which !== side) problems.push(`${name}: ${rec.id} is a ${cell.which}-side cell in a ${side}-side file`);
        problems.push(...r.problems.map((p) => `${name}: ${p}`));
        if (r.kind) { k[r.kind]++; kinds[r.kind]++; }
      }
    }
    if (Array.isArray(j?.errors)) {
      for (const e of j.errors) {
        const cell = cellsById.get(e.id);
        if (!cell) problems.push(`${name}: ${e.id} is an error for a cell that is not planned`);
        else if (cell.which !== side) problems.push(`${name}: ${e.id} is a ${cell.which}-side cell in a ${side}-side file`);
        if (typeof e.error !== 'string' || !e.error) problems.push(`${name}: ${e.id} is an error with no message`);
      }
    }
    perFile.push({ name, launch: j?.launch ?? null, side, records: j?.records?.length ?? 0, errors: j?.errors?.length ?? 0, ...k });
  }
  return { problems, shape, kinds, perFile };
}
