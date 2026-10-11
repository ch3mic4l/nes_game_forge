// Build-only revalidation of all FIVE current exclusion groups and their unchanged parent twins.
// Writes a CANDIDATE only: never edits a tracked fixture. Run after final generator edits.
//
// Two kinds of provenance are kept APART and never relabelled into each other:
//   archived measurement provenance  prov.parent.* and every parent row's prov.* in the fixture: engine/harness/generator/mesen the parent twins were
//                                    MEASURED with (harness 27289ea4...). Checked against the pinned archive; never rewritten.
//   current rebuild provenance       what THIS run built with (the live harness, the live engine/generator): reported in the candidate's sibling
//                                    `.rebuild.json`; the fixture carries only prov.new (engine, generator) for the refusals.
// The current harness cannot equal the archived one (S1a-S1c edited test/lua), so its identity is NOT compared. What carries the archived recipes to the
// current scene builders instead is a SCENE-IDENTITY TRANSFER: every successful parent twin is rebuilt by the current scene builders against the pinned
// parent tree and its normalized-project sha256 and its ROM sha256 must equal the ORIGINAL measurement receipts' prov.project / prov.rom (the records the
// archived harness wrote, listed in RECEIPTS below). A changed scene builder that still builds changes one of those two hashes. Refusal twins keep the exact
// need/free comparison. The Lua template and symbol bindings are measurement-only; no timing is refreshed or claimed.
// `--control=scene` is the negative control: it perturbs one parent scene (a different tile count) and the run must REFUSE (exit 0 = refused as required).
// It counts as success ONLY when the designated scene's own project/ROM identity check fails (SceneIdentityMismatch carrying that scene's id); any other
// exception -- a wrong --parent, a missing receipt, a capacity change, a different scene's mismatch -- is still a failure (exit 1), and so is a perturbed
// scene that was NOT refused.
//
// USAGE (all three inputs are explicit; the large archived evidence stays outside git):
//   node test/lua/refresh_sw_exclusions.mjs --parent=<pinned parent tree> --receipts=<S3b evidence dir> --out=<candidate.json> [--control=scene]
// The candidate is never the tracked fixture; compare it with test/fixtures/crossstage/exclusions-evidence.json and copy it over by hand if accepted.
//   --parent    the checked-out parent tree 15c11b7 (its engine/, main/, shared/, test/lua and a compact root); its engine/generator/compactGenerator/harness/mesen are
//               pinned by PINNED_PARENT_FIELDS in sw_cross_evidence.mjs and a different tree refuses.
//   --receipts  the archived S3b campaign directory (originally handoff-next/s3b), laid out as RECEIPTS below names (paths relative to it):
//                 impl/D/P1.json, impl/D/P3.json                       the FIRST AUTHORITIES (final validated launches; see AUTHORITY_SHA256)
//                 impl/fix1/restamped/{P1r,P3}.json, impl/fix2/restamped/{P1r,P3}.json, impl/fix2/final/P3.json, reviewer8/P3.json     restamps; must agree with the above
//               impl/runs/* are the superseded first runs (a same-id project/ROM conflict exists there) and are deliberately NOT read.
//   Authority: D/P1 supplies the 48 origNewRegression successes' receipts, D/P3 the 111 conditional successes'. Their identities are the SHA-256s the accepted final
//   aggregate (reviewer9/aggregate.json) names and seals, pinned below: a substituted or edited receipt refuses before any record is read.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { enumerateAll, CROSS_STAGES } from './sw_cross_cells.mjs';
import { measureCrossCell } from './sw_cross_scene.mjs';
import { measureMove } from './run_sw_move_manifest.mjs';
import { needsCompact, cellTiles } from './sw_move_policy.mjs';
import { compactRoot } from './sw_compact_root.mjs';
import { runCampaign } from './run_sw_move_sweep.mjs';
import { GROUP_NAMES, loadGroups, partnerOf, refusalNeed } from './sw_cross_exclusions.mjs';
import { loadEvidence, evidenceStructureProblems, PINNED_PARENT_FIELDS } from './sw_cross_evidence.mjs';
import { processProvenance, generatorHash, assertSameSources } from './sw_provenance.mjs';
import { MESEN_DEFAULT } from './run_sw_manifest.mjs';
import crypto from 'node:crypto';

// SHA-256 of the two first-authority receipt files (D/P1 and D/P3), as sealed by the accepted final aggregate reviewer9/aggregate.json.
export const AUTHORITY_SHA256 = {
  'impl/D/P1.json': '07f86e4e4a3bd14a97581381303c4f4c8c76b02f268892edde504388b2fe4eba',
  'impl/D/P3.json': 'e0cc74613acada73d95fddfa3e5b23ad17c9e7106f00c56366ee84606acd593d',
};

class SceneIdentityMismatch extends Error {
  constructor(id, message) { super(message); this.name = 'SceneIdentityMismatch'; this.sceneId = id; }
}

// The final measurement receipts (the validated S3b campaign files; impl/runs/* are the superseded first runs, whose scenes differ) of the 159 successful parent twins (project/rom written by the archived harness). Every file listing an id must agree.
const RECEIPTS = ['impl/D/P1.json', 'impl/fix1/restamped/P1r.json', 'impl/fix2/restamped/P1r.json', 'impl/D/P3.json', 'impl/fix1/restamped/P3.json', 'impl/fix2/restamped/P3.json', 'impl/fix2/final/P3.json', 'reviewer8/P3.json'];

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const i = a.indexOf('=');
  if (!a.startsWith('--') || i < 0) throw new Error(`bad argument ${a}`);
  return [a.slice(2, i), a.slice(i + 1)];
}));
const root = process.cwd();
for (const k of ['parent', 'receipts', 'out']) assert.ok(args[k], `--${k}=<path> is required (see the header)`);
assert.deepEqual(Object.keys(args).filter(k => !['parent', 'receipts', 'out', 'control'].includes(k)), [], 'unknown argument');
const parent = path.resolve(args.parent);
const out = path.resolve(args.out);
const receiptDir = path.resolve(args.receipts);
const control = args.control ?? null;
assert.ok(control === null || control === 'scene', `unknown control ${control}`);
assert.notEqual(out, path.join(root, 'test/fixtures/crossstage/exclusions-evidence.json'));
const old = loadEvidence(root), groups = loadGroups();
const candidate0 = old;
assert.deepEqual(evidenceStructureProblems(groups, old), []);
const pn = processProvenance(root, MESEN_DEFAULT, { freshMesen: true });
const pp = { ...processProvenance(parent, MESEN_DEFAULT, { harnessRoot: parent }), compactGenerator: generatorHash(compactRoot(parent)) };
for (const f of PINNED_PARENT_FIELDS) assert.equal(pp[f], old.prov.parent[f], `parent ${f} changed: use the pinned archive`);
// the original receipts: id -> { project, rom }, every file listing an id must agree on both
const receipt = new Map();
for (const [f, want] of Object.entries(AUTHORITY_SHA256)) {
  const got = crypto.createHash('sha256').update(fs.readFileSync(path.join(receiptDir, f))).digest('hex');
  assert.equal(got, want, `${f}: not the sealed first-authority receipt (sha256 ${got})`);
}
for (const f of RECEIPTS) {
  const j = JSON.parse(fs.readFileSync(path.join(receiptDir, f), 'utf8'));
  for (const r of j.records ?? []) {
    if (!r.id?.startsWith('parent/') || !r.prov?.project || !r.prov?.rom) continue;
    const have = receipt.get(r.id);
    if (have) assert.deepEqual(have.hashes, { project: r.prov.project, rom: r.prov.rom }, `${r.id}: receipts ${have.file} and ${f} disagree`);
    else receipt.set(r.id, { file: f, hashes: { project: r.prov.project, rom: r.prov.rom } });
  }
}
const byId = new Map(enumerateAll({ tiles: 15 }).map(c => [c.id, c]));
const ids = GROUP_NAMES.flatMap(g => [...groups[g].ids]);
assert.equal(ids.length, 340);
assert.equal(new Set(ids).size, ids.length);
const cells = ids.flatMap(id => [id, partnerOf(id)]).map(id => {
  assert.ok(byId.has(id), `${id} is not planned`); return byId.get(id);
});
const built = new Map();
const firstBuiltParent = (() => { for (const g of GROUP_NAMES) for (const row of candidate0[g]) if (row.parent.status === 'built') return partnerOf(row.id); })();
try {
const control_id = control === 'scene' ? firstBuiltParent : null;
const results = await runCampaign({ cells, jobs: 8, measure: async c => {
  const r = c.which === 'new' ? root : parent;
  const prepared = c.stages.some(s => CROSS_STAGES.includes(s))
    ? await measureCrossCell(c, { tiles: c.id === control_id ? 14 : 15, root: r, prepareOnly: true })
    : await measureMove({ ...c, tiles: c.id === control_id ? cellTiles(c, 14) : cellTiles(c, 15), root: needsCompact(c) ? compactRoot(r) : r, prepareOnly: true });
  built.set(c.id, prepared.prov ?? prepared.res?.prov);
  return { summary: { built: true } };
} });
const byResult = new Map(results.map(r => [r.id, r]));
const candidate = structuredClone(old);
let transferred = 0;
for (const g of GROUP_NAMES) {
  for (const row of candidate[g]) {
    const n = byResult.get(row.id), p = byResult.get(partnerOf(row.id));
    const need = n.error && refusalNeed(n.error);
    assert.ok(need, `${g}: ${row.id} built or failed otherwise: ${n.error}`);
    assert.equal(need.need, row.need, `${row.id}: new need changed; report, do not extend a ruling`);
    assert.equal(need.free, row.free, `${row.id}: new free changed; report, do not extend a ruling`);
    if (row.parent.status === 'refused') {
      const got = p.error && refusalNeed(p.error);
      assert.ok(got, `${row.id}: parent no longer refused for capacity`);
      assert.equal(got.need, row.parent.need);
      assert.equal(got.free, row.parent.free);
    } else {
      assert.ok(!p.error, `${row.id}: parent failed: ${p.error}`);
      const prov = built.get(partnerOf(row.id));
      // build sources (the harness is deliberately absent: the archived harness hash is an ARCHIVED measurement fact, see the header)
      for (const f of ['engine', 'generator', 'mesen']) assert.equal(prov?.[f], row.parent.prov[f], `${row.id}: parent built provenance ${f} changed`);
      // scene identity: the rebuilt twin is the SAME scene and ROM the archived harness measured
      const rc = receipt.get(partnerOf(row.id));
      assert.ok(rc, `${row.id}: no original receipt carries its project/rom hashes`);
      for (const [k, label] of [['project', 'PROJECT'], ['rom', 'ROM']]) {
        if (prov?.[k] !== rc.hashes[k]) throw new SceneIdentityMismatch(partnerOf(row.id), `${row.id}: the rebuilt parent ${label} differs from the original receipt (${rc.file}): the scene builder changed`);
      }
      transferred++;
    }
  }
}
assert.equal(transferred, 159, 'every successful parent twin must be transferred');
assertSameSources(pn, processProvenance(root, MESEN_DEFAULT, { freshMesen: true }), 'during exclusion refresh');
const ppEnd = { ...processProvenance(parent, MESEN_DEFAULT, { harnessRoot: parent }), compactGenerator: generatorHash(compactRoot(parent)) };
for (const f of PINNED_PARENT_FIELDS) assert.equal(ppEnd[f], pp[f]);
candidate.prov.new = { engine: pn.engine, generator: pn.generator };
// idempotent: a replay over an already-refreshed fixture replaces this paragraph rather than stacking a second one
candidate.note = `${old.note.split('\nRefreshed after the dead sw_dlg_write_row')[0]}\nRefreshed after the dead sw_dlg_write_row was removed, by test/lua/refresh_sw_exclusions.mjs (build-only): all 340 current original scenes refused at their same exact need/free/shortfall; all 340 pinned-parent twins built or refused as recorded. Each of the 159 successful parent twins was rebuilt by the CURRENT scene builders and its normalized-project and ROM sha256 equal the ORIGINAL measurement receipts' (so the archived recipes transfer to the current builders unchanged); the archived harness hash and every parent row's provenance are archived measurement facts and are unchanged, and the current harness is not claimed to equal them. Only this note and the two new-tree fingerprints changed. No Mesen timing refreshed or claimed.`;
assert.deepEqual(evidenceStructureProblems(groups, candidate), []);
if (control) throw new Error('CONTROL FAILED: the perturbed parent scene was not refused');
fs.writeFileSync(out, JSON.stringify(candidate, null, 1) + '\n');
fs.writeFileSync(out.replace(/\.json$/, '.rebuild.json'), JSON.stringify({ archivedMeasurement: old.prov.parent, currentRebuild: { ...pn, mesen: pn.mesen }, parentTreeHarness: pp.harness, harnessCompared: false, scenesTransferred: transferred, receiptsUsed: [...new Set([...receipt.values()].map((r) => r.file))] }, null, 1) + '\n');
console.log(`PASS: 340 new refusals and 340 parent receipts re-established, ${transferred} parent scenes transferred by project+ROM identity; candidate ${out}`);
} catch (e) {
  if (control && e instanceof SceneIdentityMismatch && e.sceneId === firstBuiltParent) { console.log(`CONTROL PASS (the perturbed scene ${firstBuiltParent} was refused by its identity check): ${e.message}`); process.exit(0); }
  throw e;
}
