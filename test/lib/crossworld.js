// Serialized campaign results for tests (S3b fix round 2): VALID complete envelopes of the cross campaign, written the way a launch writes them, so a
// test can break exactly one thing in them and watch the boundary refuse it. No build, no Mesen: the "Mesen" is a one-line file whose hash stands in.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { enumerateAll, cellOptions, CROSS_STAGES } from '../lua/sw_cross_cells.mjs';
import { loadGroups, partnerOf, GROUP_NAMES } from '../lua/sw_cross_exclusions.mjs';
import { loadEvidence } from '../lua/sw_cross_evidence.mjs';
import { measureFingerprint, campaignFingerprint } from '../lua/sw_cross_fingerprint.mjs';
import { expectedTrees, campaignParts } from '../lua/run_sw_cross.mjs';
import { treeStamp } from '../lua/sw_cross_validate.mjs';
import { usesCompactRoot } from '../lua/sw_cross_scene.mjs';
import { needsCompact } from '../lua/sw_move_policy.mjs';
import { bodyRows } from '../lua/sw_cross_classes.mjs';
import { classify } from '../lua/run_sw_move_manifest.mjs';

export const groups = loadGroups();
export const evidence = loadEvidence();
export const cells = enumerateAll();
export const byId = new Map(cells.map((c) => [c.id, c]));
export const text = (need, free) => `Map Forge: The lookup tables need ${need} bytes but only ${free} are free alongside the engine code. Try removing every Move command.`;
export const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'forge-crossworld-'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const mesenDir = tmp();
/** A stand-in for the Mesen binary: provenance only hashes the file. */
export const FAKE_MESEN = path.join(mesenDir, 'Mesen');
fs.writeFileSync(FAKE_MESEN, 'not a real emulator');

export const trees = expectedTrees(evidence, { mesen: FAKE_MESEN });
export const parts = campaignParts();
export const measureFp = measureFingerprint();
export const isCross = (c) => c.stages.some((s) => CROSS_STAGES.includes(s));
export const isCompact = (c) => (isCross(c) ? usesCompactRoot(c) : needsCompact(c));

/** A valid HISTORICAL record (a restamped bridge record: no raw trace, an explicit justification) of cell `c` measured on `tree`. */
export function historical(c, tree) {
  const compact = isCompact(c);
  return {
    id: c.id, options: cellOptions(c),
    prov: { engine: tree.engine, harness: tree.harness, generator: compact ? tree.compactGenerator : tree.generator, mesen: tree.mesen, project: sha(`p ${c.id}`), rom: sha(`r ${c.id}`) },
    campaign: measureFp,
    source: { cacheKey: sha(`k ${c.id}`), compact, ...(compact ? { plainGenerator: tree.generator } : {}) },
    // a cross cell records its body rows; an S3a cell (phase, pops, ...) records only its summary
    ...(isCross(c) ? { rows: [{ G: 1, ran: [], count: {} }] } : { summary: { maxStep: 1, maxFinal: 1, classes: {} } }),
    status: 0, done: true, timeout: false,
    restamp: { validated: 'test: ROM and project re-derived on the same tree', from: 'an earlier run' }
  };
}

/** A valid RAW record of cell `c`: its raw measurement written gzipped under `rawDir`, the pointer and the derived rows linked to it. */
export function measured(c, tree, rawDir) {
  const rec = historical(c, tree);
  delete rec.restamp;
  const raw = { id: c.id, cacheKey: rec.source.cacheKey, prov: rec.prov, status: 0, done: true, timeout: false, frames: 5, timing: {}, phases: {}, marks: { M11: [{ f: 3, line: 'MK move_tick G=1234' }] }, trace: { M11: [{ f: 3 }] } };
  if (rec.rows) rec.rows = bodyRows(raw);
  if (rec.summary) rec.summary = classify(raw, { lead: c.lead, tail: c.tail });
  fs.mkdirSync(rawDir, { recursive: true });
  const body = gzipSync(JSON.stringify(raw));
  const file = `${sha(c.id).slice(0, 24)}.json.gz`;
  fs.writeFileSync(path.join(rawDir, file), body);
  rec.raw = { dir: rawDir, file, sha256: sha(body), bytes: body.length };
  return rec;
}

export const envelope = (launch, side, records, errors) => ({ launch, complete: true, tree: treeStamp(side, trees[side]), campaign: campaignFingerprint({}), verdict: { ok: true }, records, errors });

/**
 * The files that satisfy the exclusion contract exactly: every pinned id refused on the new side with its evidence's need/free; every parent twin as the
 * evidence says (a refusal, or a building twin); one measured stub per stage x game type of the pinned cells (so nothing is all-excluded), each with a
 * measured parent twin. `kind` = 'historical' | 'raw'.
 */
export function world({ kind = 'historical', dir = tmp() } = {}) {
  const mk = (c, tree) => (kind === 'raw' ? measured(c, tree, path.join(dir, 'raw')) : historical(c, tree));
  const errors = []; const records = []; const parentErrors = []; const parentRecords = [];
  const pinned = new Set();
  const twin = (id) => byId.get(partnerOf(id));
  for (const g of GROUP_NAMES) for (const row of evidence[g]) {
    errors.push({ id: row.id, error: text(row.need, row.free) });
    if (row.parent.status === 'refused') parentErrors.push({ id: partnerOf(row.id), error: text(row.parent.need, row.parent.free) });
    else parentRecords.push(mk(twin(row.id), trees.parent));
    pinned.add(row.id);
  }
  const seen = new Set();
  for (const id of pinned) for (const s of byId.get(id).stages) {
    const k = `${s}/${byId.get(id).gt}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const c = cells.find((x) => x.which === 'new' && !pinned.has(x.id) && x.stages.includes(s) && x.gt === byId.get(id).gt && !records.some((r) => r.id === x.id));
    if (!c) continue;
    records.push(mk(c, trees.new));
    parentRecords.push(mk(twin(c.id), trees.parent));
  }
  return { dir, errors, records, parentErrors, parentRecords };
}

/** The two files of a world as envelopes. */
export const files = (w) => ({ newEnv: envelope('L3', 'new', w.records, w.errors), parentEnv: envelope('P1', 'parent', w.parentRecords, w.parentErrors) });
