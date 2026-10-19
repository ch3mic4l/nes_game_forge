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
// ONE-TIME CAPACITY TRANSITION (Chris's ruling E19, 2026-10-18; triage handoff-next/equip/c6b-free-triage.md): C1b (720d976) added a six-byte battle-only check to
// dispatch_input, so every RPG board has six fewer kernel-lo bytes and all 340 rows below are six bytes further over capacity. RENEWAL below is the ONLY thing that
// lets a refresh see a free different from the fixture's, and it is bound to the exact old fixture (sha256 of its bytes), its exact group/ID sets, its old new-tree
// source fingerprints and the measured target fingerprints: any other input -- a wrong fixture, an added or dropped id, another tree -- gets the ordinary rule, an
// EXACT match of need/free/shortfall. It permits two free transitions (140 -> 134, 97 -> 91), need + 0 and shortfall + 6, nothing else, and it is spent by adoption:
// once the candidate replaces the fixture, the fixture's sha256 no longer matches and a refresh must again be exact. Every parent assertion, authority seal and
// scene-identity check below is unchanged.
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

// BEGIN one-time renewal (the focused controls in handoff-next/equip/c6/scratch extract this block verbatim)
const RENEWAL = Object.freeze({
  oldFixtureSha256: 'ae6c9fc9783dd16be977fe71728ad38a27ae3af7b104dcd626b746cb2b02e3bd',
  oldNew: Object.freeze({ engine: 'd5add2c0fc864be5f7e05cb1b535f755a91c4aaf099b33089e4931b58cef6580', generator: 'a413d897437728a1f12a32f4520bfe5ccfdf518f984d9bf8a76c1ae3ed98b94b' }),
  target: Object.freeze({ engine: '1137252e04c6ef7d1f4b34ada6aa0757880e903d9fd4b50f8a9fb91a8279f64d', generator: '0a92b984f69fe4da11eadb421aa7709974db58ef1d0379d1aa9fcd2e803cd026' }),
  // sha256 of each group's sorted ids joined by "\n" (the group sizes are 74/111/89/18/48)
  groups: Object.freeze({
    approved74: [74, '80f36ba02c8a0e0723cb1b86174ff7d329734461b6d8013e12a3f0be93bc284c'],
    conditional111: [111, '3b9f4215bda000dff5c3d5a858313030840e5db679753853e7e7e3389aaea00f'],
    appendix: [89, 'dcb30af3829517063cba43ab435fa8df1ab59acbb1d2c4d910489f77c11b373c'],
    origParentRefused: [18, 'f78a869fe59c2482e45fe99e6eeefcab0dc52b576a137e5b42f76a5e872efdf2'],
    origNewRegression: [48, 'b3dd741799b0f877350820a710ab1c39d4d1dcec57168e79f846c068cdd0b255'],
  }),
  freeTransitions: Object.freeze({ 140: 134, 97: 91 }),
  needDelta: 0,
  shortfallDelta: 6,
});
/** True only when EVERY binding holds: the old fixture's bytes, its group/ID sets, its old source fingerprints and the measured target fingerprints. */
function renewalApplies({ fixtureBytes, evidence, measured }) {
  if (crypto.createHash('sha256').update(fixtureBytes).digest('hex') !== RENEWAL.oldFixtureSha256) return false;
  if (evidence.prov?.new?.engine !== RENEWAL.oldNew.engine || evidence.prov?.new?.generator !== RENEWAL.oldNew.generator) return false;
  if (measured.engine !== RENEWAL.target.engine || measured.generator !== RENEWAL.target.generator) return false;
  for (const [g, [n, sha]] of Object.entries(RENEWAL.groups)) {
    const ids = (evidence[g] ?? []).map(r => r.id).sort();
    if (ids.length !== n || crypto.createHash('sha256').update(ids.join('\n')).digest('hex') !== sha) return false;
  }
  return Object.keys(RENEWAL.groups).length === GROUP_NAMES.length && GROUP_NAMES.every(g => g in RENEWAL.groups);
}
/** What a refusal of fixture row `row` must read: the row itself (ordinary rule) or, when the renewal applies, its one permitted transition. */
function expectedRefusal(row, renewal) {
  if (!renewal) return { need: row.need, free: row.free, shortfall: row.shortfall };
  const free = RENEWAL.freeTransitions[row.free];
  assert.ok(free !== undefined, `${row.id}: free ${row.free} has no permitted transition`);
  return { need: row.need + RENEWAL.needDelta, free, shortfall: row.shortfall + RENEWAL.shortfallDelta };
}
// END one-time renewal

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
const fixtureBytes = fs.readFileSync(path.join(root, 'test/fixtures/crossstage/exclusions-evidence.json'));
const renewal = renewalApplies({ fixtureBytes, evidence: old, measured: pn });
console.log(renewal ? 'ONE-TIME RENEWAL (ruling E19): free 140 -> 134 and 97 -> 91, need + 0, shortfall + 6 are expected' : 'ordinary refresh: need, free and shortfall must match the fixture exactly');
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
    const want = expectedRefusal(row, renewal);
    assert.equal(need.need, want.need, `${row.id}: new need changed; report, do not extend a ruling`);
    assert.equal(need.free, want.free, `${row.id}: new free changed; report, do not extend a ruling`);
    assert.equal(need.need - need.free, want.shortfall, `${row.id}: new shortfall changed; report, do not extend a ruling`);
    row.free = need.free; row.shortfall = need.need - need.free;
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
// The note is kept in layers: the original paragraph (historical), the S2 C1 refresh paragraph (historical), the E19 transition paragraph (kept once it is written),
// and, on an ordinary refresh, this run's own paragraph. A replay replaces only the last.
const HIST_1 = 'Historical (the refresh of this fixture on the combined slot-5 battle and Continue y fixes, commit 5138c1f; every free figure in this paragraph is superseded by the last paragraph of this note): ';
const HIST_2 = 'Historical (phase 3b S2 C1 refresh of this fixture, commit d7fa346; it describes that run only, not the rows as they stand now): ';
const TRANSITION_MARK = '\nRe-attested 2026-10-18';
const TRANSITION = `${TRANSITION_MARK} for Equipment (ROADMAP item 5) C6b by test/lua/refresh_sw_exclusions.mjs (build-only), under Chris's ruling E19. This is a one-time capacity transition, not a re-confirmation: the same 340 ids in the same five groups were rebuilt at engine ${RENEWAL.target.engine.slice(0, 12)} / generator ${RENEWAL.target.generator.slice(0, 12)}; every need is unchanged, every free is exactly six bytes lower (140 -> 134 on 262 rows, 97 -> 91 on 78) and every shortfall exactly six bytes larger. The cause is solely commit C1b 720d976 (a six-byte battle-only check in dispatch_input, engine/input.asm, BATTLE_KERNEL_ALLOWANCE_BY_MAPPER +6 on every RPG board); no other commit from f3833db to C6a changes any row's need or free. Current RPG Move lookup room is 134 bytes. The fixture this replaces had sha256 ${RENEWAL.oldFixtureSha256} and prov.new engine ${RENEWAL.oldNew.engine.slice(0, 12)} / generator ${RENEWAL.oldNew.generator.slice(0, 12)}. All 181 parent refusals keep their exact need/free; each of the 159 successful parent twins was rebuilt by the CURRENT scene builders and its normalized-project and ROM sha256 equal the ORIGINAL measurement receipts' (the archived recipes transfer to the current builders unchanged); prov.parent and every parent row are unchanged archived facts. Only each row's free and shortfall, prov.new and this note changed. No Mesen timing is refreshed or claimed.`;
const ORDINARY = '\nRefreshed by test/lua/refresh_sw_exclusions.mjs (build-only): all 340 current original scenes refused at their same exact need/free/shortfall as the fixture this one replaces; all 340 pinned-parent twins built or refused as recorded; each of the 159 successful parent twins was rebuilt by the CURRENT scene builders and its normalized-project and ROM sha256 equal the ORIGINAL measurement receipts\'. Only this paragraph and the two new-tree fingerprints changed. No Mesen timing refreshed or claimed.';
const H2_MARK = '\nHistorical (phase 3b S2 C1 refresh';
let head, hist2;
if (old.note.includes(H2_MARK)) {            // already re-attested or ordinary-refreshed: both historical layers are kept as they are
  head = old.note.slice(0, old.note.indexOf(H2_MARK));
  hist2 = old.note.slice(old.note.indexOf(H2_MARK)).split(TRANSITION_MARK)[0].split('\nRefreshed by test/lua/refresh_sw_exclusions.mjs')[0];
} else {                                       // the pre-renewal fixture: its two paragraphs become the two historical layers
  const [first, ...rest] = old.note.split('\nRefreshed after the dead sw_dlg_write_row was removed, by test/lua/refresh_sw_exclusions.mjs (build-only): ');
  assert.equal(rest.length, 1, 'the S2 C1 paragraph is expected exactly once in a pre-renewal fixture');
  head = HIST_1 + first;
  hist2 = '\n' + HIST_2 + rest[0];
}
candidate.prov.new = { engine: pn.engine, generator: pn.generator };
const keepTransition = renewal || old.note.includes(TRANSITION_MARK);
candidate.note = head + hist2 + (keepTransition ? TRANSITION : '') + (renewal ? '' : ORDINARY);
assert.deepEqual(evidenceStructureProblems(groups, candidate), []);
if (control) throw new Error('CONTROL FAILED: the perturbed parent scene was not refused');
fs.writeFileSync(out, JSON.stringify(candidate, null, 1) + '\n');
fs.writeFileSync(out.replace(/\.json$/, '.rebuild.json'), JSON.stringify({ archivedMeasurement: old.prov.parent, currentRebuild: { ...pn, mesen: pn.mesen }, parentTreeHarness: pp.harness, harnessCompared: false, scenesTransferred: transferred, receiptsUsed: [...new Set([...receipt.values()].map((r) => r.file))] }, null, 1) + '\n');
console.log(`PASS: 340 new refusals and 340 parent receipts re-established, ${transferred} parent scenes transferred by project+ROM identity; candidate ${out}`);
} catch (e) {
  if (control && e instanceof SceneIdentityMismatch && e.sceneId === firstBuiltParent) { console.log(`CONTROL PASS (the perturbed scene ${firstBuiltParent} was refused by its identity check): ${e.message}`); process.exit(0); }
  throw e;
}
