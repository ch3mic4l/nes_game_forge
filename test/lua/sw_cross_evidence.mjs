// Phase 3a slice S3b fix round 1, finding 4: parent success/refusal receipts and per-ID need/free/shortfall/provenance evidence for the five refusal
// groups (kept apart). PURE (files only; no build, no Mesen).
//
// Parent evidence is loaded EXPLICITLY from fresh parent campaign files (`--parent-evidence`): a record (`.records`) is a measured parent twin, an error
// (`.errors`) a refusal receipt whose need/free are parsed from the build's own message. Nothing is inferred from a pin.
// The evidence fixture (test/fixtures/crossstage/exclusions-evidence.json) holds, for EVERY id of each group, the final pin: the new side's need, free and
// shortfall, and what the parent did (refused with need/free, or built, with the parent record's provenance), plus the tree provenance it was read at.
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './sw_manifest_scene.mjs';
import { GROUP_NAMES, refusalNeed, partnerOf } from './sw_cross_exclusions.mjs';
import { validateEnvelopes, EvidenceError } from './sw_cross_validate.mjs';

export const EVIDENCE_FILE = 'test/fixtures/crossstage/exclusions-evidence.json';
const PARENT_PROV_FIELDS = ['engine', 'harness', 'generator', 'mesen'];
/** What the evidence pins of the archived parent tree: its engine, its harness, its generator (plain and the compacting root's) and the Mesen it was measured with. */
export const PINNED_PARENT_FIELDS = ['engine', 'harness', 'generator', 'compactGenerator', 'mesen'];

/**
 * Map id -> { status: 'measured', prov, kind, source } | { status: 'refused', need, free, reason, source } from parent campaign result files.
 *
 * A parent file is evidence only if it VALIDATES (sw_cross_validate.mjs): a complete, clean launch of the pinned parent tree by this campaign's code, every
 * record for a planned parent cell with its own options, complete provenance of that tree, a successful measurement, and a raw pointer that checks out or an
 * explicit historical justification. Refusal receipts are bound to the same envelope, so they carry the parent source too. `cellsById` = the planned cells,
 * `trees.parent` = the pinned parent tree, `current` = this campaign's { measure, judge, fixtures } fingerprints. A file that does not validate throws an
 * EvidenceError naming every problem: it is never read as a success receipt.
 */
export function loadParentEvidence(files, { cellsById, trees, current }) {
  const loaded = files.map((f) => ({ name: path.basename(f), j: JSON.parse(fs.readFileSync(f, 'utf8')), side: 'parent' }));
  for (const { name, j } of loaded) {
    if (!Array.isArray(j.records) || !Array.isArray(j.errors)) throw new Error(`${name} is not a campaign result (no records/errors arrays)`);
    for (const r of [...j.records, ...j.errors]) if (!r.id?.startsWith('parent/')) throw new Error(`${name}: ${r.id} is not a parent-side id`);
  }
  const v = validateEnvelopes(loaded, { cellsById, trees, current });
  if (v.problems.length) throw new EvidenceError(v.problems, 'the parent evidence');
  return parentEvidenceFromEnvelopes(loaded);
}

/** The receipts of ALREADY VALIDATED parent envelopes ([{ name, j }]): a record is a measured twin, an error a refusal receipt (need/free parsed from the build's own message). */
export function parentEvidenceFromEnvelopes(loaded) {
  const out = new Map();
  const put = (id, v) => { if (out.has(id)) throw new Error(`parent evidence lists ${id} twice (${out.get(id).source} and ${v.source})`); out.set(id, v); };
  for (const { name, j } of loaded) {
    for (const r of j.records) put(r.id, { status: 'measured', prov: r.prov, kind: r.raw ? 'raw' : 'historical', source: path.basename(name) });
    for (const e of j.errors) {
      const n = refusalNeed(e.error);
      put(e.id, n ? { status: 'refused', need: n.need, free: n.free, reason: e.error, source: path.basename(name) } : { status: 'failed', reason: e.error, source: path.basename(name) });
    }
  }
  return out;
}

export const loadEvidence = (root = REPO) => JSON.parse(fs.readFileSync(path.join(root, EVIDENCE_FILE), 'utf8'));

/** { id -> row } over one group's evidence rows. */
export const evidenceIndex = (rows) => new Map(rows.map((r) => [r.id, r]));

/** The evidence fixture must cover EXACTLY the ids of each group, with consistent numbers; a group's rows are never merged into another's. */
export function evidenceStructureProblems(groups, evidence) {
  const out = [];
  for (const name of GROUP_NAMES) {
    const rows = evidence[name];
    if (!Array.isArray(rows)) { out.push(`the evidence has no ${name} rows`); continue; }
    const have = new Set(rows.map((r) => r.id));
    if (have.size !== rows.length) out.push(`${name}: the evidence lists an id twice`);
    for (const id of groups[name].ids) if (!have.has(id)) out.push(`${name}: ${id} has no evidence row`);
    for (const id of have) if (!groups[name].ids.has(id)) out.push(`${name}: the evidence row ${id} is not in the group`);
    for (const r of rows) {
      if (!(r.need > 0 && r.free > 0)) out.push(`${name}: ${r.id} has no need/free`);
      else if (r.shortfall !== r.need - r.free || !(r.shortfall > 0)) out.push(`${name}: ${r.id} shortfall ${r.shortfall} is not need ${r.need} - free ${r.free} > 0`);
      if (!r.parent || !['refused', 'built'].includes(r.parent.status)) { out.push(`${name}: ${r.id} has no parent receipt`); continue; }
      if (r.parent.status === 'refused' && !(r.parent.need > 0 && r.parent.free > 0 && r.parent.need > r.parent.free)) out.push(`${name}: ${r.id} parent refusal lacks a need > free`);
      if (r.parent.status === 'built' && !PARENT_PROV_FIELDS.every((f) => typeof r.parent.prov?.[f] === 'string')) out.push(`${name}: ${r.id} parent success carries no provenance`);
      const wantRefused = groups[name].parentRefuses;
      if (wantRefused !== (r.parent.status === 'refused')) out.push(`${name}: ${r.id} parent ${r.parent.status} contradicts the group (${wantRefused ? 'excluded because the parent refuses it too' : 'a new-engine-only exclusion'})`);
    }
  }
  const seenIn = new Map();
  for (const name of GROUP_NAMES) for (const r of evidence[name] ?? []) { if (seenIn.has(r.id) && seenIn.get(r.id) !== name) out.push(`${r.id} is in both ${seenIn.get(r.id)} and ${name}: the groups are kept apart`); seenIn.set(r.id, name); }
  const prov = evidence.prov?.new;
  if (!prov || typeof prov.engine !== 'string' || typeof prov.generator !== 'string') out.push('the evidence carries no new-tree provenance (engine, generator)');
  for (const f of PINNED_PARENT_FIELDS) if (!/^[0-9a-f]{64}$/.test(evidence.prov?.parent?.[f] ?? '')) out.push(`the evidence pins no parent-tree ${f} (every parent record and envelope is validated against it)`);
  return out;
}

/**
 * Holds ONE new-side refusal of a group to its evidence row and to the parent evidence. Returns problems ([] when sound).
 * `r` = { id, reason }, `row` = the evidence row, `parent` = parentEvidence.get(partnerOf(id)) or undefined.
 */
export function refusalEvidenceProblems(name, r, row, parent, { parentEvidenceGiven }) {
  const out = [];
  const got = refusalNeed(r.reason);
  if (!row) return [`${name}: ${r.id} has no evidence row`];
  if (!got) return [`${name}: ${r.id} was refused for a reason that is not a capacity shortfall`];
  if (got.need !== row.need) out.push(`${name}: ${r.id} needs ${got.need} bytes, the evidence pins ${row.need}`);
  if (got.free !== row.free) out.push(`${name}: ${r.id} has ${got.free} free bytes, the evidence pins ${row.free}`);
  if (got.need - got.free !== row.shortfall) out.push(`${name}: ${r.id} is short by ${got.need - got.free} bytes, the evidence pins ${row.shortfall}`);
  if (!parentEvidenceGiven) { out.push(`${name}: ${r.id} cannot be checked against its parent twin: no parent evidence was supplied`); return out; }
  if (!parent) { out.push(`${name}: ${r.id} has no parent receipt (neither a measured twin nor a refusal) in the parent evidence`); return out; }
  if (row.parent.status === 'refused') {
    if (parent.status !== 'refused') out.push(`${name}: ${r.id} is excluded because the parent refuses it, but the parent evidence says ${parent.status}`);
    else if (parent.need !== row.parent.need || parent.free !== row.parent.free) out.push(`${name}: ${r.id} parent receipt is need ${parent.need} / free ${parent.free}, the evidence pins need ${row.parent.need} / free ${row.parent.free}`);
  } else if (parent.status !== 'measured') out.push(`${name}: ${r.id} is a new-engine-only exclusion, but the parent evidence says ${parent.status}: no successful parent twin`);
  else for (const f of PARENT_PROV_FIELDS) if (parent.prov?.[f] !== row.parent.prov[f]) out.push(`${name}: ${r.id} parent twin was measured with another ${f} (${String(parent.prov?.[f]).slice(0, 12)}) than the evidence pins (${String(row.parent.prov[f]).slice(0, 12)})`);
  return out;
}

/** The new-tree provenance (engine, generator) a refusal was read at must be what this launch runs on. */
export function evidenceProvenanceProblems(evidence, current) {
  const pinned = evidence.prov?.new;
  if (!current) return [];
  return ['engine', 'generator'].filter((f) => pinned?.[f] !== current[f]).map((f) => `the exclusion evidence was read at ${f} ${String(pinned?.[f]).slice(0, 12)}, this tree is ${String(current[f]).slice(0, 12)}: regenerate it (a pin is never silently carried across an edit)`);
}

/**
 * Parent coverage of a COMPLETE result set: every new-side planned cell must have a parent twin with SOME result. A cell measured on the new tree whose
 * twin was measured too has its baseline; one whose twin was REFUSED has none (a note: recorded, never claimed as a baseline); one whose twin failed or
 * has no result at all is a problem. `outcomeOf(id)` = 'measured' | 'refused' | 'failed' | undefined. Returns { problems, notes }.
 */
export function parentCoverageProblems(planned, outcomeOf) {
  const problems = [];
  const notes = [];
  for (const c of planned) {
    if (c.which !== 'new') continue;
    const mine = outcomeOf(c.id);
    if (mine === undefined) continue;
    const twin = outcomeOf(partnerOf(c.id));
    if (twin === undefined) problems.push(`${c.id}: its parent twin has no result at all`);
    else if (twin === 'failed') problems.push(`${c.id}: its parent twin failed to measure`);
    else if (mine === 'measured' && twin === 'refused') notes.push(`${c.id}: measured on the new tree but its parent twin is refused: no baseline (recorded, never claimed as one)`);
  }
  return { problems, notes };
}
