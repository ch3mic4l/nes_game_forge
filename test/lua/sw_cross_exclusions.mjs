// Phase 3a slice S3b: the five kept-apart refusal groups and the checks that hold a campaign to them (plan 3.3, review 2 section 3, review 3 section 3).
//
//   approved74         test/fixtures/streamedmove-unreachable.json   the S3a ruling: RPG + wide + bound + P1, few-large-1 / few-large-3; both engines refuse
//   conditional111     test/fixtures/crossstage/exclusions-conditional.json   the S3b tax: the parent builds, the S3b engine cannot (final since C.8)
//   appendix           test/fixtures/crossstage/exclusions-appendix.json      11 F1 + 78 class-(a) IDs the parent refuses too (approved, with its crosswalk)
//   origParentRefused  test/fixtures/crossstage/exclusions-orig-capacity.json  18 ORIGINAL composed scenes the parent refuses too (Chris 2026-10-03)
//   origNewRegression  test/fixtures/crossstage/exclusions-orig-capacity.json  48 ORIGINAL composed scenes that build on the parent and are refused on S3b (free 144)
//
// A group grants an EXACT-ID exclusion and nothing more: no population, shape or game-type exclusion, and the appendix does not certify the
// unmeasured RPG-bound class-(a) composition. The two original-capacity groups are never covered by a substitute: nothing may be exempted by having one
// (review 2 finding 1). PURE: reads the fixtures, never a build or Mesen.
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './sw_manifest_scene.mjs';
import { refusalEvidenceProblems, evidenceIndex, evidenceProvenanceProblems } from './sw_cross_evidence.mjs';

const read = (root, f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
export const GROUP_NAMES = ['approved74', 'conditional111', 'appendix', 'origParentRefused', 'origNewRegression'];

/** `lookup tables need N bytes but only M are free` -> { need, free }; null for any other text. */
export const refusalNeed = (reason) => { const m = /lookup tables need (\d+) bytes but only (\d+) are free/.exec(String(reason ?? '')); return m ? { need: Number(m[1]), free: Number(m[2]) } : null; };
/** The twin of a cell id on the other side. */
export const partnerOf = (id) => id.replace(/^(new|parent)\//, (_, w) => (w === 'new' ? 'parent/' : 'new/'));

/** The five groups as { name: { ids: Set, need: Map(id -> need|null), final, parentRefuses, rows } }. */
export function loadGroups(root = REPO) {
  const a74 = read(root, 'test/fixtures/streamedmove-unreachable.json');
  const cond = read(root, 'test/fixtures/crossstage/exclusions-conditional.json');
  const app = read(root, 'test/fixtures/crossstage/exclusions-appendix.json');
  const orig = read(root, 'test/fixtures/crossstage/exclusions-orig-capacity.json');
  const need = (rows) => new Map(rows.map((r) => [r.id, r.need ?? null]));
  const appRows = [...app.f1, ...app.classA];
  return {
    approved74: { ids: new Set(a74.refused.map((r) => r.id)), need: need(a74.refused), final: true, parentRefuses: true, rows: a74.refused },
    conditional111: { ids: new Set(cond.rows.map((r) => r.id)), need: need(cond.rows), final: cond.final === true, parentRefuses: false, rows: cond.rows },
    appendix: { ids: new Set(appRows.map((r) => r.id)), need: need(appRows), final: app.approved === true, parentRefuses: true, rows: appRows },
    origParentRefused: { ids: new Set(orig.origParentRefused.map((r) => r.id)), need: need(orig.origParentRefused), final: orig.final === true, parentRefuses: true, rows: orig.origParentRefused },
    origNewRegression: { ids: new Set(orig.origNewRegression.map((r) => r.id)), need: need(orig.origNewRegression), final: orig.final === true, parentRefuses: false, rows: orig.origNewRegression }
  };
}

/** Structural problems of the groups themselves: an ID in two groups, a group id that is not a new-side id, or a group not marked final/approved. */
export function groupProblems(groups) {
  const out = [];
  const owner = new Map();
  for (const name of GROUP_NAMES) {
    for (const id of groups[name].ids) {
      if (!id.startsWith('new/')) out.push(`${name} pins ${id}, which is not a new-side id`);
      if (owner.has(id)) out.push(`${id} is pinned by both ${owner.get(id)} and ${name}: the groups are kept apart`);
      owner.set(id, name);
    }
    if (groups[name].ids.size !== groups[name].rows.length) out.push(`${name} lists an id twice`);
  }
  for (const name of GROUP_NAMES) if (!groups[name].final) out.push(`${name} is not marked final/approved`);
  return out;
}

/** Every pinned id must be a planned new-side cell of the WHOLE plan (a launch holds a subset of it, so this is checked once against all cells). */
export function pinProblems(groups, allCells) {
  const have = new Set(allCells.map((c) => c.id));
  return GROUP_NAMES.flatMap((name) => [...groups[name].ids].filter((id) => !have.has(id)).map((id) => `${name} pins ${id}, which no stage plans`));
}

/**
 * Holds one campaign's refusals to the groups. `planned` = every planned cell (both sides, with `id`, `which`, `stages`, `gt`), `refusals` = [{ id, reason }]
 * for every cell the build refused. `complete: true` = the campaign ran every planned cell of every group's stage, which is when the exact-set checks apply.
 * Returns { problems, notes, byGroup }: a problem fails the campaign, a note is reported (a parent-only refusal: no baseline; a free-byte drift).
 *
 * With `evidence` (the per-id final pins, sw_cross_evidence.mjs) every group refusal is held to its pinned need, free and shortfall, and to its PARENT
 * receipt from `parentEvidence` (a Map from the fresh parent campaigns; omitted = a problem, never a pass): the parent twin of an excluded-because-the-
 * parent-refuses id must be refused with the pinned need/free, the parent twin of a new-engine-only id must have been measured with the pinned provenance.
 * The parent twin is read from the parent evidence, NOT from this launch's own refusals, so a standalone child launch can no longer fail a pinned exclusion
 * for a missing twin, nor pass one whose twin was never refused. `currentProv` = { engine, generator } of the tree under test.
 */
export function refusalProblems({ planned, refusals, groups, complete = false, evidence = null, parentEvidence = null, currentProv = null }) {
  const problems = [];
  const notes = [];
  const byId = new Map(planned.map((c) => [c.id, c]));
  const refused = new Map(refusals.map((r) => [r.id, r]));
  const owner = new Map();
  for (const name of GROUP_NAMES) for (const id of groups[name].ids) owner.set(id, name);
  const byGroup = Object.fromEntries(GROUP_NAMES.map((n) => [n, []]));
  const index = evidence ? Object.fromEntries(GROUP_NAMES.map((n) => [n, evidenceIndex(evidence[n] ?? [])])) : null;
  if (evidence && refusals.some((r) => byId.get(r.id)?.which === 'new')) problems.push(...evidenceProvenanceProblems(evidence, currentProv));

  for (const [id, r] of refused) {
    const c = byId.get(id);
    if (!c) { problems.push(`${id} was refused but is not a planned cell`); continue; }
    const got = refusalNeed(r.reason);
    if (c.which === 'parent') {
      const twinId = partnerOf(id);
      const twin = refused.get(twinId);
      const g = GROUP_NAMES.find((n) => groups[n].ids.has(twinId));
      if (evidence && g && groups[g].parentRefuses) {
        // the parent's own receipt must be the pinned one (the parent launch is where it is produced)
        const row = index[g].get(twinId);
        if (!row || got?.need !== row.parent?.need || got?.free !== row.parent?.free) problems.push(`${g}: parent receipt of ${id} is need ${got?.need} / free ${got?.free}, the evidence pins need ${row?.parent?.need} / free ${row?.parent?.free}`);
      } else if (evidence && g && !groups[g].parentRefuses) {
        problems.push(`${g}: the parent refuses ${id}, but the evidence pins its parent twin as a success (a new-engine-only exclusion)`);
      } else if (!twin && !g) notes.push(`parent-only refusal ${id}: no baseline for ${twinId} (recorded, never claimed as a measured baseline)`);
      continue;
    }
    const name = owner.get(id);
    if (!name) { problems.push(`unexpected refusal: ${id} is in no approved, conditional or original-capacity group (${String(r.reason).split('\n')[0].slice(0, 120)})`); continue; }
    byGroup[name].push(id);
    const g = groups[name];
    const pinned = g.need.get(id);
    if (evidence) {
      problems.push(...refusalEvidenceProblems(name, r, index[name].get(id), parentEvidence?.get(partnerOf(id)), { parentEvidenceGiven: parentEvidence !== null }));
      continue;
    }
    if (pinned != null && (!got || got.need !== pinned)) problems.push(`${name}: ${id} is refused for ${got ? `${got.need} bytes` : 'a different reason'} but the pin says ${pinned}`);
    const twin = refused.get(partnerOf(id));
    if (g.parentRefuses && !twin) problems.push(`${name}: ${id} is excluded only because the parent refuses it too, but the parent twin was not refused`);
    if (g.parentRefuses && twin && got && refusalNeed(twin.reason)?.need !== got.need) problems.push(`${name}: ${id} needs ${got.need} bytes but its parent twin needs ${refusalNeed(twin.reason)?.need ?? 'a different reason'}`);
    if (!g.parentRefuses && twin) problems.push(`${name}: ${id} is a new-engine-only exclusion but its parent twin is refused too`);
    if (name === 'appendix') {
      const row = g.rows.find((x) => x.id === id);
      if (row && got && got.free !== row.free) notes.push(`appendix free-byte drift on ${id}: pinned ${row.free}, measured ${got.free} (the need is the pin; re-confirmed at the final pin)`);
    }
  }

  if (complete) for (const name of GROUP_NAMES) {
    const have = new Set(byGroup[name]);
    for (const id of groups[name].ids) if (byId.has(id) && !have.has(id)) problems.push(`${name}: ${id} is pinned as refused but its build was not refused (the exact set no longer matches: a pin must be removed, not left)`);
  }

  // all-excluded: a stage x game type whose every planned new-side cell is refused measured nothing
  const per = new Map();
  for (const c of planned) {
    if (c.which !== 'new') continue;
    for (const s of c.stages ?? [c.stage]) {
      const k = `${s}/${c.gt}`;
      const e = per.get(k) ?? { n: 0, refused: 0 };
      e.n++;
      if (refused.has(c.id)) e.refused++;
      per.set(k, e);
    }
  }
  for (const [k, e] of per) if (e.n && e.refused === e.n) problems.push(`all-excluded: every planned ${k} cell (${e.n}) was refused, so the stage measured nothing for that game type`);
  return { problems, notes, byGroup };
}
