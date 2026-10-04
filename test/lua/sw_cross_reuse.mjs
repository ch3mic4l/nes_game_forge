// Phase 3a slice S3b: which recorded measurements may stand for a cell of this campaign, and which cells must run again (plan 6.A.3, review 2: "reuse is
// allowed only per cell, with provenance that matches exactly"). PURE. It fails CLOSED: anything it cannot positively match is run fresh, and says why.
//
// A record may stand for a cell only if ALL hold: it succeeded; it carries a provenance object with every uniform field; each of engine / harness /
// generator / mesen / campaign equals what THIS side's tree has now (the S3a records carry none, so every one of them runs again); and the options it was measured
// with equal the cell's own normalized options. The new tree and the parent tree have different engine hashes by construction, so a record can never
// stand for the other side.
import { UNIFORM_FIELDS } from './sw_provenance.mjs';
import { cellOptions } from './sw_cross_cells.mjs';
import { measureFingerprint } from './sw_cross_fingerprint.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** { reuse, reason }. `expected` = the current { engine, harness, generator, mesen } of the tree this cell's side runs on. */
export function reuseDecision(cell, record, expected) {
  if (!record) return { reuse: false, reason: 'no record' };
  if (record.error) return { reuse: false, reason: 'the record is an error' };
  if (!record.rows && !record.summary) return { reuse: false, reason: 'the record carries no measurement' };
  const p = record.prov;
  if (!p || typeof p !== 'object') return { reuse: false, reason: 'no provenance on the record' };
  for (const f of UNIFORM_FIELDS) if (typeof p[f] !== 'string' || !p[f]) return { reuse: false, reason: `the record lacks provenance.${f}` };
  // a record built through the compacting root (sw_compact_root.mjs) carries THAT root's generator hash (copy-based, so it covers the real generator
  // bytes plus the compactor and wrapper) and names the plain tree it was made from in `source.plainGenerator`: both must be this tree's
  const compact = record.source?.compact === true;
  for (const f of UNIFORM_FIELDS) {
    const want = f === 'generator' && compact ? expected?.compactGenerator : expected?.[f];
    if (typeof want !== 'string' || !want) return { reuse: false, reason: `the current ${f === 'generator' && compact ? 'compact-root generator' : f} hash is unknown` };
    if (p[f] !== want) return { reuse: false, reason: `${f} differs from this tree` };
  }
  if (compact && record.source.plainGenerator !== expected.generator) return { reuse: false, reason: 'the compact record was made from another generator tree' };
  if (typeof record.campaign !== 'string' || !record.campaign) return { reuse: false, reason: 'the record carries no campaign (measuring-implementation) fingerprint' };
  if (typeof expected?.campaign !== 'string' || !expected.campaign) return { reuse: false, reason: 'the current campaign fingerprint is unknown' };
  if (record.campaign !== expected.campaign) return { reuse: false, reason: 'the measuring implementation (cells, scene, compaction, policy) differs from the record\'s' };
  if (record.id !== cell.id) return { reuse: false, reason: 'the record is for another id' };
  if (!same(record.options, cellOptions(cell))) return { reuse: false, reason: 'the record was measured with other options' };
  return { reuse: true, reason: 'provenance and options match exactly' };
}

/**
 * Splits `cells` into { reused: [{cell, record}], fresh: [cell], reasons: { reason: count } }. `records` = Map id -> record, `expectedBySide` = { new, parent }.
 * A cell with no record counts under 'no record'.
 */
export function planReuse(cells, records, expectedBySide) {
  const reused = [];
  const fresh = [];
  const reasons = {};
  for (const cell of cells) {
    const d = reuseDecision(cell, records.get(cell.id), expectedBySide[cell.which]);
    if (d.reuse) reused.push({ cell, record: records.get(cell.id) });
    else { fresh.push(cell); reasons[d.reason] = (reasons[d.reason] ?? 0) + 1; }
  }
  return { reused, fresh, reasons };
}
