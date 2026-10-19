// The ring gate's one tree-maker: a mkdtemp copy of engine/ main/ shared/ (+ package.json, so `type: module` holds) with the
// ring gate's patches applied by `git apply`, and the imports to build a project through THAT copy's real public path
// (buildProject). It fails loudly if a patch does not apply and never falls back to the unpatched tree: a silent four-screen
// fallback counted as a ring pass is the exact defect the row-1 identity cell exists to catch.
//
// Two kinds of ring tree, by STREAM_RING mode. Phase 3b S2 rebaselined the gate onto C2's production vertical ring, S3 C2 onto C1's production horizontal ring, S4a C2 onto the commit that admits the ring on MMC3 for
// action games, S4b C2 onto the one that admits it on MMC1, S4c C2 onto the one that admits it on UNROM 512, S5 C3 onto the one that admits a streamed RPG (f3833db), Equipment C6c onto the C6b commit (ce7d009: f3833db's rings plus the equipment work, C1b and C3b moving every RPG ROM); ALL of it is production code and the gate patches in NOTHING but a control's own sabotage:
//   ring 1 (vertical)   = BASELINE (+ the sabotage's ring-1 form on a control job). The vertical ring's forks are C2's SHIPPED code, byte for byte.
//   ring 2 (horizontal) = BASELINE (+ the sabotage's ring-2 form on a control job). The horizontal ring's forks are C1's SHIPPED code, byte for byte
//                         (the S1 prototype's 01-ring-select / 02-ring-engine / 03-player-far-branch are RETIRED: see RETIRED_PATCHES).
// THE REFUSAL LIFT IS RETIRED (S5 C3). Until S5 C2 production refused a streamed RPG on a two-nametable board and the gate patched that one arm out (00-refusal-lift.patch) for the RPG cells; since the datum
// `streamRingGameTypes: ['action', 'rpg']` every one of the 18 cells is admitted by production, so every tree is BASELINE itself. `liftNeeded` is kept as a GUARD, not a switch: it asks BASELINE's own streamRingAdmitted and
// every runner/audit that would need a lift throws instead, because a gate that patched a refusal back out would certify something production still refuses. The `lifted` field of a tree and of a stamp's proof stays
// (always false, never defaulted) so a stamp's shape did not change; a stamp or a proof that says otherwise is an audit FAILURE (ringprovindex.mjs).
// `verifyProduction` rebuilds the EXACT expected content of a tree (BASELINE's blobs with the canonical, hashed patches applied in order) and requires every file of
// the tree to equal it by git blob hash -- an edit inside a file a sabotage already declares is a mismatch too. `loadTree` re-proves it at every build, and the
// consumed-input guard (below) binds the bytes a build actually read. Both rings get the SAME proof; only the forks the baseline must carry differ (SHIPPED_FORKS).
// A cell is built only through its own ring's tree: makeTree gives each ring a tree of its own, and buildCell refuses a tree whose ring is not the cell's.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const PATCH_DIR = path.join(ROOT, 'test/lua/ring_gate');
/** The name of the RETIRED refusal-lift patch (see RETIRED_PATCHES): no tree carries it and no file of that name exists; the name survives only so the audit can refuse a stamp that lists it, by name. */
export const LIFT_PATCH = '00-refusal-lift.patch';
/** The one place the retirement is stated: a ring tree is never lifted. `lifted` must be the boolean false (never defaulted, never true). */
export function assertNotLifted(lifted, what) {
  if (lifted === true) throw new Error(`${what}: the refusal lift (${LIFT_PATCH}) is retired at S5 C3 -- production admits all 18 ring cells, so no ring tree is lifted and no stamp may carry a lift`);
  if (lifted !== false) throw new Error(`${what}: a ring tree is unlifted (false), never defaulted: got ${JSON.stringify(lifted)}`);
}
/** The required patches (in application order) of a ring tree: none -- the lift is retired (S5 C3). Sabotage forms are the only patches a ring tree carries. */
export const patchSetFor = (lifted) => { assertNotLifted(lifted, 'patchSetFor'); return []; };
/** The treeKind a stamp of each ring must carry. A ring-2 stamp of kind 'prototype-horizontal' belongs to a certificate built before S3 C2 and is refused at this baseline. */
export const TREE_KIND = { 1: 'production-vertical', 2: 'production-horizontal' };
export const PROTOTYPE_TREE_KIND = 'prototype-horizontal';
/**
 * The RETIRED ring patches: the S1 prototype's horizontal patches (retired at S3 C2: C1 (aaa678a) ships all of their effect as production code) and the test-only refusal lift (retired at S5 C3: C2 (f3833db)
 * admits every ring cell, so the lift would be empty). At this baseline each would change nothing. A retired patch is never applied, hashed or listed again: patchFile() refuses its name, no ring's patch set holds it, and no file of that name exists (prov_unit.mjs pins all three).
 * `sha256` identifies the retired file (its last committed bytes: the prototype patches at aaa678a's parent, 803a252; the lift at 61ed7f3); `shipped` are needles the baseline's own sources must still carry, so a baseline that
 * lost the code a retired patch used to add fails loudly (checkRetiredShipped, run by regen_patches.mjs and the unit tests).
 */
export const RETIRED_PATCHES = {
  [LIFT_PATCH]: { sha256: '3943e8318eca35c121b3163841165ac324831cc53b807f4b393fd32df273c1b5', reason: 'the refusal lift (it deleted the `ringGame` arm of streamedBoardProblems) is not needed since S5 C2: every registered board admits an action AND an rpg game on its ring (the `streamRingGameTypes` datum), so production refuses none of the 18 cells; the file is the S4c C2 re-cut (git 61ed7f3)',
    shipped: [['shared/cartridge.js', ["streamRingGameTypes: ['action', 'rpg'],"]]], absent: [] },
  '01-ring-select.patch': { sha256: '187251bd580b86fa47d3c0de75d915b1c80b31da3b058a916c358e28603bd165', reason: 'the generated constants SW_RING_ROW_LEN and the mode-2 render step, and the lift of generate.js\'s mode-2 refusal, are production code since S3 C1',
    shipped: [['main/build/generate.js', ['`SW_RING_ROW_LEN = ${ringMode === 2 ? 16 : 32}`', '`SW_RW_NT_STEP = ${ringMode === 2 ? 2 : 1}`']]], absent: [['main/build/generate.js', ['not implemented yet']]] },
  '02-ring-engine.patch': { sha256: '212ec1cc1c43e57107de2d8fb22f47e67cf75b47b79775524e7cc600a896c70f', reason: 'the row-strip fork (compare, length load) and the row wrap in engine/streamworld.asm are production code since S3 C1',
    shipped: [['engine/streamworld.asm', ['sw_ring_row_cmp:', 'sw_ring_row_len:', 'sw_ring_wrap_row:']]], absent: [] },
  '03-player-far-branch.patch': { sha256: 'c41944ec72108164d3548974a733cf4e1516e60f6bf598a9d77fb1401383800e', reason: 'the far branch around cross_none in engine/player.asm is production code since S3 C1 (ring_far1)',
    shipped: [['engine/player.asm', ['ring_far1:', 'bne ring_far1']]], absent: [] }
};
const COPIED = ['engine', 'main', 'shared'];
/** The certification baseline: the tree makeTree copies must equal it (Equipment C6c, the C6b commit ce7d009; the rings are f3833db's, S5 commit C2: the production vertical AND horizontal rings, admitted on UNROM 512, MMC1 and MMC3 for action AND rpg games -- nothing is refused, so nothing is lifted). */
export const BASELINE = 'ce7d0091ca6c016bfdfc5a3369af329fb3ba8bf9';
/** The baseline the S1b certificate (rounds 1-3) was built at, before the rebaseline onto C2: the only baseline a historical re-judgment (s1b_rejudge.mjs) may carry. */
export const PRE_C2_BASELINE = '5138c1f0c33107016a90423da17dcbb33d8697ca';

import { noFormReason } from './ringsabotage.mjs';
import { cellById, GAME_TYPES, CELLS } from './ringcells.mjs';
import { createRequire } from 'node:module';
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

let baselineCartridgeModule = null;
/**
 * BASELINE's own shared/cartridge.js (it imports nothing), read from the git object -- never from the working tree, which an audit of an old certificate may not equal -- written to a scratch
 * `.mjs` and loaded synchronously. The ring gate asks PRODUCTION which boards it admits, so there is no second board list to drift from it.
 */
function baselineCartridge() {
  if (baselineCartridgeModule) return baselineCartridgeModule;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-cartridge-'));
  try {
    const file = path.join(scratch, 'cartridge.mjs');
    fs.writeFileSync(file, execFileSync('git', ['show', `${BASELINE}:shared/cartridge.js`], { cwd: ROOT, maxBuffer: 64 << 20 }));
    baselineCartridgeModule = createRequire(import.meta.url)(file);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  return baselineCartridgeModule;
}
/**
 * Would the cell `cell` ({ mapper, mirroring }) running game type `gameType` need a refusal lift? Exactly when production REFUSES that board / mirroring / game type:
 * `!streamRingAdmitted(...)` read from BASELINE's shared/cartridge.js (the datum validateProject itself asks). At BASELINE (as at f3833db before it) the answer is false for all 18 cell x game-type pairs (checkNoLiftNeeded), and the
 * lift is retired: this is the GUARD every runner and the audit call (a true answer makes makeCellTree throw and the audit fail), none restates a board list. `gameType` is required.
 */
export function liftNeeded(cell, gameType) {
  if (!GAME_TYPES.includes(gameType)) throw new Error(`liftNeeded: gameType must be one of ${GAME_TYPES.join(', ')}, got ${JSON.stringify(gameType)} (the lift depends on it: production admits a board for some game types and not others)`);
  const { resolveMapper, streamRingAdmitted } = baselineCartridge();
  return !streamRingAdmitted(resolveMapper(cell.mapper), cell.mirroring, gameType);
}
/** Every ring cell x game type is admitted by production at BASELINE (no refusal is left to lift). Returns the number of pairs checked; throws naming the first pair production refuses. */
export function checkNoLiftNeeded() {
  let n = 0;
  for (const gameType of GAME_TYPES) for (const cell of CELLS) { if (liftNeeded(cell, gameType)) throw new Error(`production refuses ${cell.id} ${gameType} at ${BASELINE}: the gate would need a refusal lift, which is retired (the gate certifies only what production admits)`); n += 1; }
  return n;
}
/** The cell id of a stamp -> its cell record, or null when it names none of the six. */
export function cellOfId(id) { try { return cellById(id); } catch { return null; } }

/** Resolves a patch name ('00-...patch' or a sabotage name) to its file; a sabotage has a ring-1 form (sabotage/vertical/) and a ring-2 one (sabotage/). A retired patch resolves to nothing. */
export function patchFile(name, ring = 2) {
  if (RETIRED_PATCHES[name]) throw new Error(`ring patch ${name} is retired (${RETIRED_PATCHES[name].reason}); no ring tree carries it`);
  const rel = name.endsWith('.patch') ? name : ring === 1 ? `sabotage/vertical/${name}.patch` : `sabotage/${name}.patch`;
  const p = path.join(PATCH_DIR, rel);
  if (!fs.existsSync(p)) throw new Error(`ring patch not found${name.endsWith('.patch') ? '' : ` (sabotage ${name} has no ring-${ring} form: ${noFormReason(name, ring)})`}: ${p}`);
  return p;
}

/** Does sabotage `name` have a form for ring `ring`? (A ring whose form would be an equivalent mutant has none: SABOTAGE_RINGS in ringsabotage.mjs names them.) */
export function sabotageHasRing(name, ring) {
  return fs.existsSync(path.join(PATCH_DIR, ring === 1 ? `sabotage/vertical/${name}.patch` : `sabotage/${name}.patch`));
}

/**
 * Refuses unless engine/ main/ shared/ in the working tree are exactly BASELINE's: no tracked diff, no untracked file. The patches are made
 * against that baseline, so a tree that drifted from it would be certified under the wrong name.
 */
export function verifyBaseline() {
  const run = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
  try { execFileSync('git', ['diff', '--quiet', BASELINE, '--', ...COPIED], { cwd: ROOT }); }
  catch { throw new Error(`engine/ main/ shared/ differ from ${BASELINE} (git diff ${BASELINE} -- engine main shared); the ring gate certifies only that baseline:\n${run('diff', '--stat', BASELINE, '--', ...COPIED)}`); }
  const untracked = run('ls-files', '--others', '--exclude-standard', '--', ...COPIED);
  if (untracked) throw new Error(`untracked files under engine/ main/ shared/ (the gate certifies ${BASELINE} only):\n${untracked}`);
}

/** The files a patch file touches (its `diff --git a/<x>/<path> b/<x>/<path>` headers, two leading components stripped as `git apply -p2` does). */
export function patchedFiles(patchText) {
  const out = [];
  for (const m of patchText.matchAll(/^diff --git a\/[^/]+\/(\S+) b\/[^/]+\/(\S+)$/gm)) { if (m[1] !== m[2]) throw new Error(`a ring patch renames ${m[1]} -> ${m[2]}`); out.push(m[1]); }
  return out;
}

const gitBlobSha1 = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
function walk(dir, rel, out) {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(dir, r, out); else out.push(r);
  }
}
let baselineBlobs = null;
/** { path -> git blob sha1 } of every file of engine/ main/ shared/ at BASELINE. */
function baselineBlobMap() {
  if (baselineBlobs) return baselineBlobs;
  const text = execFileSync('git', ['ls-tree', '-r', BASELINE, '--', ...COPIED], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  baselineBlobs = new Map(text.trim().split('\n').map((l) => { const m = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(l); if (!m) throw new Error(`unreadable ls-tree line: ${l}`); return [m[2], m[1]]; }));
  return baselineBlobs;
}

/** The files of `root`'s engine/ main/ shared/ that differ from BASELINE (changed, added or missing), by git blob hash. */
export function filesDifferingFromBaseline(root) {
  const base = baselineBlobMap();
  const have = [];
  for (const d of COPIED) walk(root, d, have);
  const diff = [];
  for (const f of have) if (base.get(f) !== gitBlobSha1(fs.readFileSync(path.join(root, f)))) diff.push(f);
  for (const f of base.keys()) if (!have.includes(f)) diff.push(f);
  return [...new Set(diff)].sort();
}

/** The retired prototype patches (RETIRED_PATCHES): refused in every ring's patch list. */
const RETIRED_NAMES = Object.keys(RETIRED_PATCHES);

/**
 * The forks the baseline must carry in its own sources, per ring: [file, needles that must be present, needles that must be absent]. A ring-2 baseline carries ring 1's forks AND the
 * horizontal ones (C1), and neither ring's generator may still refuse mode 2. Asserted so a baseline that is not the production ring would make "unmodified" meaningless.
 */
const VERTICAL_FORKS = [
  ['engine/streamworld.asm', ['sw_ring_col_cmp:', 'sw_ring_col_len:', 'sw_ring_wrap_col:', 'sw_ring_nt_step:', 'sw_ring_nt_end:', '.if STREAM_RING'], []],
  ['main/build/generate.js', ['`STREAM_RING = ${ringMode}`', '`SW_RING_COL_LEN = ${ringMode === 1 ? 15 : 30}`', '`SW_RW_NT_END = ${ringMode === 1 ? 2 : 4}`'], ['horizontal two-nametable ring -- not implemented yet']],
  ['shared/cartridge.js', ['export function streamRingMode('], []]
];
const HORIZONTAL_FORKS = [
  ['engine/streamworld.asm', ['sw_ring_row_cmp:', 'sw_ring_row_len:', 'sw_ring_wrap_row:', 'cmp #SW_RING_ROW_LEN'], []],
  ['engine/player.asm', ['ring_far1:', 'bne ring_far1', '.if STREAM_RING'], []],
  ['main/build/generate.js', ['`SW_RING_ROW_LEN = ${ringMode === 2 ? 16 : 32}`', '`SW_RW_NT_STEP = ${ringMode === 2 ? 2 : 1}`'], []]
];
const shippedForksOf = (ring) => (ring === 1 ? VERTICAL_FORKS : [...VERTICAL_FORKS, ...HORIZONTAL_FORKS]);

/** Checks that `applied` ([{name, file, sha256?}]) is a canonical patch list for ring `ring` in its `lifted` / unlifted form: the required set (patchSetFor) in order, then only sabotage forms of that ring (sabotage/ for ring 2, sabotage/vertical/ for ring 1). Returns [{name, file, sha256, bytes}]: each canonical file is read ONCE, and the hash, the parse and the `git apply` all use those same bytes. */
function canonicalPatches(applied, ring, lifted) {
  const base = patchSetFor(lifted); // [] (and throws for any lifted other than false)
  const word = `${ring === 1 ? 'vertical (ring 1)' : 'horizontal (ring 2)'}`;
  const names = applied.map(({ name }) => name);
  if (names.includes(LIFT_PATCH)) throw new Error(`a ${word} tree carries ${LIFT_PATCH}: the refusal lift is retired (S5 C3) -- production admits every ring cell, so every tree is BASELINE itself (plus a sabotage form on a control job)`);
  const retired = applied.find(({ name }) => RETIRED_NAMES.includes(name));
  if (retired) throw new Error(`a ${word} tree carries the retired prototype patch ${retired.name}: both rings run on the shipped code, a retired patch is never applied again`);
  return applied.map(({ name, file, sha256: claimed }, i) => {
    if (i >= base.length && name.endsWith('.patch')) throw new Error(`a ${word} tree may carry only sabotage forms (no patch is required at this baseline), not ${name}`);
    const canonical = patchFile(name, ring);
    if (path.resolve(file) !== path.resolve(canonical)) throw new Error(`ring patch ${name} was applied from ${file}, not the canonical ${canonical}`);
    const bytes = fs.readFileSync(canonical);
    const actual = sha256(bytes);
    if (claimed !== undefined && claimed !== actual) throw new Error(`ring patch ${name} changed on disk since the tree was made (applied ${claimed.slice(0, 12)}, now ${actual.slice(0, 12)})`);
    return { name, file: canonical, sha256: actual, bytes };
  });
}

const expectedCache = new Map();
/** Test hook: forgets the cached expected contents, so the next derivation applies the patches again. */
export const resetExpectedCache = () => expectedCache.clear();
/**
 * The exact content a ring `ring` tree (`lifted`: always false, the lift is retired) must have, built from nothing but BASELINE and the patch files: every file the patches declare is written to a scratch dir as
 * BASELINE's blob, then the patches are applied in order with `git apply -p2`. Returns { patches, declared, expected: {file -> git blob sha1} }; cached by ring and patch hashes.
 */
export function expectedContent(applied, ring, lifted) {
  if (ring !== 1 && ring !== 2) throw new Error(`expectedContent: ring must be 1 or 2, got ${JSON.stringify(ring)}`);
  const patches = canonicalPatches(applied, ring, lifted);
  const key = `${ring}|${lifted}|${patches.map((p) => `${p.name}:${p.sha256}`).join('|')}`;
  if (!expectedCache.has(key)) {
    const declared = new Set();
    for (const { bytes } of patches) for (const f of patchedFiles(bytes.toString('utf8'))) declared.add(f);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-expect-'));
    try {
      for (const f of declared) {
        fs.mkdirSync(path.dirname(path.join(scratch, f)), { recursive: true });
        fs.writeFileSync(path.join(scratch, f), execFileSync('git', ['show', `${BASELINE}:${f}`], { cwd: ROOT, maxBuffer: 64 << 20 }));
      }
      for (const { name, bytes } of patches) {
        try { execFileSync('git', ['apply', '-p2', '--whitespace=nowarn', '-'], { cwd: scratch, input: bytes, stdio: ['pipe', 'pipe', 'pipe'] }); }
        catch (e) { throw new Error(`ring patch ${name} does not apply to ${BASELINE}'s declared files:\n${e.stderr?.toString() ?? e.message}`); }
      }
      const expected = {};
      for (const f of [...declared].sort()) expected[f] = gitBlobSha1(fs.readFileSync(path.join(scratch, f)));
      expectedCache.set(key, { declared: Object.keys(expected), expected });
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }
  const { declared, expected } = expectedCache.get(key);
  return { patches: patches.map(({ name, sha256: h }) => ({ name, sha256: h })), declared: [...declared], expected: { ...expected } };
}

const shippedForksChecked = new Map();
/** The baseline itself must carry the shipped forks of ring `ring` (a baseline that is not the production ring would make "unmodified" meaningless). Returns the number of needles checked. */
function checkShippedForks(ring) {
  if (shippedForksChecked.has(ring)) return shippedForksChecked.get(ring);
  const base = baselineBlobMap();
  let n = 0;
  for (const [file, present, absent] of shippedForksOf(ring)) {
    if (!base.has(file)) throw new Error(`${file} is not in ${BASELINE}`);
    const text = execFileSync('git', ['show', `${BASELINE}:${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
    for (const needle of present) { if (!text.includes(needle)) throw new Error(`${BASELINE}:${file} does not contain the shipped ring fork ${JSON.stringify(needle)}: BASELINE is not the production ${ring === 1 ? 'vertical' : 'horizontal'} ring`); n += 1; }
    for (const needle of absent) { if (text.includes(needle)) throw new Error(`${BASELINE}:${file} still contains ${JSON.stringify(needle)}: BASELINE is not the production ${ring === 1 ? 'vertical' : 'horizontal'} ring`); n += 1; }
  }
  shippedForksChecked.set(ring, n);
  return n;
}

/**
 * Each retired prototype patch's effect must be in the baseline already (RETIRED_PATCHES[..].shipped present, .absent absent), and its file must be gone. Returns the number of needles checked;
 * throws naming the first violation. regen_patches.mjs runs it, and so do the unit tests: a retirement is a recorded, checked fact, never a silent drop.
 */
export function checkRetiredShipped() {
  const read = (file) => execFileSync('git', ['show', `${BASELINE}:${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  let n = 0;
  for (const [name, r] of Object.entries(RETIRED_PATCHES)) {
    if (fs.existsSync(path.join(PATCH_DIR, name))) throw new Error(`retired patch ${name} still exists on disk (${PATCH_DIR})`);
    for (const [file, needles] of r.shipped) for (const needle of needles) { if (!read(file).includes(needle)) throw new Error(`retired ${name}: ${BASELINE}:${file} does not carry ${JSON.stringify(needle)}, which production must ship now`); n += 1; }
    for (const [file, needles] of r.absent) for (const needle of needles) { if (read(file).includes(needle)) throw new Error(`retired ${name}: ${BASELINE}:${file} still carries ${JSON.stringify(needle)}`); n += 1; }
  }
  return n;
}

/**
 * The production proof. Throws unless `root` (a ring `ring` tree) is EXACTLY BASELINE plus the canonical patches `applied` (in order, hashed): every file differing
 * from BASELINE is a declared one, every declared file's git blob hash equals the one expected from applying the patches to BASELINE, and no declared file is unchanged.
 * An undeclared edit in an undeclared file, an extra edit in a declared file (a retired prototype fork applied into a sabotage's file, a second hunk in shared/project.js), a
 * retired patch and a patch changed on disk since the tree was made are all refused. Returns the proof the stamps carry:
 * { exact: true, ring, baseline, patches, declared, changed, expected, forksChecked, unmodifiedShippedFiles }.
 */
export function verifyProduction(root, applied, ring, lifted) {
  const word = ring === 1 ? 'vertical (ring 1)' : 'horizontal (ring 2)';
  const { patches, declared, expected } = expectedContent(applied, ring, lifted);
  const changed = filesDifferingFromBaseline(root);
  const extra = changed.filter((f) => !declared.includes(f));
  if (extra.length) throw new Error(`a ${word} tree differs from ${BASELINE} in files no applied patch declares (the shipped forks must be unmodified): ${extra.join(', ')}`);
  const unchanged = declared.filter((f) => !changed.includes(f));
  if (unchanged.length) throw new Error(`a ${word} tree's patches declare ${unchanged.join(', ')} but the tree equals ${BASELINE} there: the patch did nothing`);
  for (const f of declared) {
    const actual = gitBlobSha1(fs.readFileSync(path.join(root, f)));
    if (actual !== expected[f]) throw new Error(`a ${word} tree's ${f} is not ${BASELINE} plus its applied patches (git blob ${actual.slice(0, 12)}, expected ${expected[f].slice(0, 12)}): an undeclared edit inside a declared file`);
  }
  if (patches.some(({ name }) => name === LIFT_PATCH)) throw new Error(`a ${word} tree carries ${LIFT_PATCH}: the refusal lift is retired`);
  if (patches.length === 0 && changed.length !== 0) throw new Error(`an unlifted tree without a sabotage must equal ${BASELINE} byte for byte in engine/ main/ shared/, but differs in ${changed.join(', ')}`);
  return proofOf(patches, declared, changed, expected, ring, lifted);
}

function proofOf(patches, declared, changed, expected, ring, lifted) {
  return { exact: true, ring, lifted, baseline: BASELINE, patches, declared: [...declared].sort(), changed: [...changed].sort(), expected, forksChecked: checkShippedForks(ring), unmodifiedShippedFiles: shippedForksOf(ring).map(([f]) => f).filter((f, i, a) => a.indexOf(f) === i && !changed.includes(f)) };
}

/**
 * The tree-provenance fields ({ baseline, patches, treeKind, productionProof, consumed }) a stamp for ring `ring` (1|2) with the sabotage forms `extras` must carry -- in its `lifted` form (a cell
 * production refuses) or its unlifted one (a cell production admits) -- computed from BASELINE and the canonical patch files alone: no tree is made. What the audit (ringprovindex.mjs
 * `auditTreeProvenance`) accepts for a cell; the controls start from it. `lifted` must be false (the lift is retired): the parameter is kept so a caller that asks for a lifted stamp fails loudly.
 */
export function provenanceFor(ring, lifted, extras = []) {
  if (ring !== 1 && ring !== 2) throw new Error(`provenanceFor: ring must be 1 or 2, got ${ring}`);
  const names = [...patchSetFor(lifted), ...extras];
  const exp = expectedContent(names.map((name) => ({ name, file: patchFile(name, ring) })), ring, lifted);
  const productionProof = proofOf(exp.patches, exp.declared, exp.declared, exp.expected, ring, lifted);
  const blobs = expectedTreeBlobs(productionProof.expected);
  const consumed = { mechanism: CONSUMED_MECHANISM, baseline: BASELINE, engine: { builds: 1, files: Object.fromEntries(expectedEngineNames(blobs).map((n) => [n, blobs.get(`engine/${n}`)])) }, js: { files: Object.fromEntries(REQUIRED_JS.map((m) => [m, blobs.get(m)])) } };
  return { baseline: BASELINE, patches: exp.patches, treeKind: TREE_KIND[ring], productionProof, consumed };
}

/**
 * makeTree({ ring: 1|2|false, lifted, extra: ['strip-len-30-vertical'] }) -> { root, ring, lifted, kind, patches: [{name, sha256}], head, status, production }.
 * ring 1 = the vertical production tree, ring 2 = the horizontal production tree, ring false = the pristine copy (the control for the STREAM_RING=0 identity proof). `ring: true` is refused: which
 * ring a tree is for is never a default, and neither is `lifted`, which must be false (BASELINE itself; true was BASELINE + the refusal lift, retired at S5 C3): a cell's tree is `makeCellTree`.
 * Sabotages apply in their form for that ring, on either form of the tree.
 */
export function makeTree({ ring, lifted, extra = [] } = {}) {
  if (ring !== false && ring !== 1 && ring !== 2) throw new Error(`makeTree: ring must be 1 (vertical production), 2 (horizontal production) or false (pristine), got ${JSON.stringify(ring)}`);
  if (ring === false) { if (lifted !== undefined) throw new Error('makeTree: a pristine tree has no lift'); } else assertNotLifted(lifted, 'makeTree');
  verifyBaseline();
  if (!ring && extra.length) throw new Error('extra patches need a ring tree');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ring-tree-${ring || 0}-`));
  try {
    for (const d of COPIED) fs.cpSync(path.join(ROOT, d), path.join(root, d), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(root, 'package.json'));
    const names = ring ? [...patchSetFor(lifted), ...extra] : [];
    const patches = [];
    const applied = [];
    for (const name of names) {
      const file = patchFile(name, ring);
      const bytes = fs.readFileSync(file); // read ONCE: the bytes applied are the bytes hashed
      if (bytes.length === 0) throw new Error(`ring patch ${name} is empty: every patch of the shipped set changes something at ${BASELINE}`);
      try {
        execFileSync('git', ['apply', '-p2', '--whitespace=nowarn', '-'], { cwd: root, input: bytes, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e) {
        throw new Error(`ring patch ${name} does not apply to this tree (HEAD moved? re-run regen_patches.mjs):\n${e.stderr?.toString() ?? e.message}`);
      }
      patches.push({ name, sha256: sha256(bytes) });
      applied.push({ name, file, sha256: sha256(bytes) });
    }
    const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
    const tree = { root, ring: ring || 0, lifted: ring ? lifted : false, kind: !ring ? 'pristine' : TREE_KIND[ring], patches, applied, baseline: BASELINE, head: git('rev-parse', 'HEAD'), status: git('status', '--short', '--', 'engine', 'main', 'shared', 'renderer', 'docs') || 'clean' };
    if (ring) { tree.production = verifyProduction(root, applied, ring, lifted); registerConsumedGuard(tree); }
    return tree;
  } catch (e) { fs.rmSync(root, { recursive: true, force: true }); throw e; }
}

/** The tree of ring cell `cell` running `gameType`: its ring, BASELINE itself -- the only way a runner makes a cell's tree. Refuses a cell production refuses (there is no lift to make it buildable). */
export function makeCellTree({ cell, gameType, extra = [] }) {
  if (liftNeeded(cell, gameType)) throw new Error(`cell ${cell.id} ${gameType} is refused by production at ${BASELINE} and the refusal lift is retired: the gate certifies only what production admits`);
  return makeTree({ ring: cell.ring, lifted: false, extra });
}

/**
 * One tree per STREAM_RING mode, made lazily, for a runner that builds both orientations (and both game types) in one process. `forCell(cell, gameType)` is the only way a cell gets
 * its tree: a vertical cell gets a production-vertical tree, a horizontal one a production-horizontal tree, never the other, never lifted.
 */
export function makeTreeSet({ extra = [] } = {}) {
  const trees = new Map();
  return {
    forRing(ring, lifted = false) { assertNotLifted(lifted, 'forRing'); if (!trees.has(ring)) trees.set(ring, makeTree({ ring, lifted: false, extra })); return trees.get(ring); },
    forCell(cell, gameType) { if (liftNeeded(cell, gameType)) throw new Error(`cell ${cell.id} ${gameType} is refused by production at ${BASELINE}: no lift exists`); return this.forRing(cell.ring); },
    roots() { return [...trees.values()].map((t) => t.root); },
    dispose() { for (const t of trees.values()) fs.rmSync(t.root, { recursive: true, force: true }); trees.clear(); }
  };
}

// ---- the consumed-input guard (C3 fix 2) ----------------------------------------------------------------------------------------------------------
// The exact-content proof above describes the tree at CHECK time. What matters is the bytes a build CONSUMED. A production tree (ring 1 or 2) is therefore registered here, and two process-wide interposers
// act only on paths under a registered root (anything else passes through untouched):
//   verified COPY  generate.js copies engine/*.asm into the build directory with `fs/promises.copyFile`; the assembler reads those copies. The wrapper reads the source ONCE, hashes THOSE
//                  bytes, refuses unless they are the expected blob (BASELINE's, or BASELINE plus the declared patches), and writes THOSE bytes to the destination. A source edited only
//                  for the instant of the copy (and restored) is refused, and what the assembler reads is by construction what was verified.
//   verified LOAD  a `module.registerHooks` load hook hashes the source the ESM loader actually read for each module of the tree (main/, shared/) against the expected blob. An ES module
//                  is read once per URL and cached, and main/ shared/ read no source lazily after import (no dynamic import, no readFile of a source: grep in the fix-2 report), so
//                  the load-time check binds every JS byte the build executed -- including a sabotage's declared edit to generate.js, which is expected to be the PATCHED blob.
// Both record what they verified; `consumedEvidence` turns that into the stamp's evidence, which the audit re-derives from BASELINE and the patch files.
export const CONSUMED_MECHANISM = 'verified-copy+verified-load';
/** The modules every production-tree build executes; the evidence of a finished build must list them. */
export const REQUIRED_JS = ['main/build/generate.js', 'main/build/pipeline.js', 'main/build/nesasm.js', 'shared/project.js'];
const guards = new Map(); // root (and its realpath) -> record
const guardOf = (p) => { for (const [root, rec] of guards) if (String(p).startsWith(root + path.sep)) return { rec, rel: String(p).slice(root.length + 1).split(path.sep).join('/') }; return null; };

/** The git blob every file of engine/ main/ shared/ must have in a production tree: BASELINE's, with the proof's expected blobs over the declared files. */
export function expectedTreeBlobs(expected) { return new Map([...baselineBlobMap(), ...Object.entries(expected)]); }
/** The engine source names a production build must copy: BASELINE's engine/*.asm (plus any declared engine file). */
export const expectedEngineNames = (blobs) => [...blobs.keys()].filter((k) => /^engine\/[^/]+\.asm$/.test(k)).map((k) => k.slice('engine/'.length)).sort();

function registerConsumedGuard(tree) {
  installConsumedGuards();
  const rec = { tree, root: tree.root, blobs: expectedTreeBlobs(tree.production.expected), builds: new Map(), js: new Map() };
  tree.guard = rec;
  guards.set(tree.root, rec);
  try { guards.set(fs.realpathSync(tree.root), rec); } catch { /* the tree exists: realpath cannot fail here */ }
}

let guardsInstalled = false;
function installConsumedGuards() {
  if (guardsInstalled) return;
  guardsInstalled = true;
  const copyFile = fsp.copyFile, readFile = fsp.readFile, writeFile = fsp.writeFile;
  fsp.copyFile = async function guardedCopyFile(src, dest, ...rest) {
    const hit = guardOf(src);
    if (!hit) return copyFile.call(this, src, dest, ...rest);
    const { rec, rel } = hit;
    if (!/^engine\/[^/]+\.asm$/.test(rel)) throw new Error(`consumed-input guard: a build copied ${rel} out of a production ring tree; only engine/*.asm is a copied source`);
    const bytes = await readFile(src);
    const blob = gitBlobSha1(bytes);
    const want = rec.blobs.get(rel);
    if (want === undefined) throw new Error(`consumed-input guard: ${rel} is not an engine source of ${BASELINE} plus the tree's patches`);
    if (blob !== want) throw new Error(`consumed-input guard: the build read ${rel} as git blob ${blob.slice(0, 12)}, expected ${want.slice(0, 12)} (${BASELINE} plus its applied patches): the source changed while the build consumed it`);
    await writeFile(dest, bytes);
    const dir = path.dirname(String(dest));
    if (!rec.builds.has(dir)) rec.builds.set(dir, new Map());
    rec.builds.get(dir).set(path.basename(rel), blob);
  };
  registerHooks({
    load(url, context, nextLoad) {
      const r = nextLoad(url, context);
      if (!url.startsWith('file:')) return r;
      const hit = guardOf(fileURLToPath(url));
      if (!hit) return r;
      const { rec, rel } = hit;
      if (r.source === null || r.source === undefined) throw new Error(`consumed-input guard: ${rel} was loaded as ${r.format} without a source the guard can hash (a production ring tree's modules must be ES modules)`);
      const blob = gitBlobSha1(Buffer.from(r.source));
      const want = rec.blobs.get(rel);
      if (want === undefined) throw new Error(`consumed-input guard: ${rel} is not a source of ${BASELINE} plus the tree's patches`);
      if (blob !== want) throw new Error(`consumed-input guard: the loader read ${rel} as git blob ${blob.slice(0, 12)}, expected ${want.slice(0, 12)} (${BASELINE} plus its applied patches)`);
      rec.js.set(rel, blob);
      return r;
    }
  });
}

const sortedObject = (map) => Object.fromEntries([...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));

/**
 * The stamp's consumed-input evidence for a production ring tree (null for the pristine tree): every build the guard saw copied exactly the expected engine set with the expected blobs, and every module
 * the loader read had its expected blob. `min` is the number of builds the caller requires (a finished run needs >= 1; an error snapshot needs none). Throws on an incomplete or divergent build.
 */
export function consumedEvidence(tree, { min = 1, only = null } = {}) {
  const rec = tree.guard;
  if (!rec) return null;
  const want = expectedEngineNames(rec.blobs);
  const engine = new Map(want.map((n) => [n, rec.blobs.get(`engine/${n}`)]));
  if (only !== null && !rec.builds.has(only)) throw new Error(`consumed-input guard: no verified engine copy into ${only}: the ROM was not built through the guarded copy`);
  const builds = only !== null ? [[only, rec.builds.get(only)]] : [...rec.builds];
  for (const [dir, files] of builds) {
    const got = [...files.keys()].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`consumed-input guard: the build in ${dir} copied [${got.join(', ')}], expected exactly the engine set [${want.join(', ')}]`);
    for (const [n, blob] of files) if (blob !== engine.get(n)) throw new Error(`consumed-input guard: ${dir}/${n} is blob ${blob.slice(0, 12)}, expected ${engine.get(n).slice(0, 12)}`);
  }
  if (builds.length < min) throw new Error(`consumed-input guard: ${builds.length} verified build(s) of ${tree.root}, ${min} required: the ROM was not built through the guarded copy`);
  return { mechanism: CONSUMED_MECHANISM, baseline: BASELINE, engine: { builds: builds.length, files: sortedObject(engine) }, js: { files: sortedObject(rec.js) } };
}

/** consumedEvidence for an error stamp: whatever the guard verified so far, never throwing (a refused build is the reason for the error). */
export function consumedSnapshot(tree) {
  if (!tree.guard) return null;
  try { return consumedEvidence(tree, { min: 0 }); } catch (e) { return { mechanism: CONSUMED_MECHANISM, baseline: BASELINE, refused: String(e.message).split('\n')[0], engine: { builds: 0, files: {} }, js: { files: {} } }; }
}

/**
 * After a build into `dir` (a production ring tree): hashes the engine sources the assembler actually read -- the copies in `dir/build` -- and requires each to equal the expected blob (or, for a name the
 * project's Code Forge declares, the declared override text), and the set of copies to be exactly the expected set. Returns the stamp evidence (the guard's own record of that one build,
 * plus the override names).
 */
export function verifyBuildDir(tree, dir, project) {
  const rec = tree.guard;
  if (!rec) return null;
  const buildDir = path.join(dir, 'build');
  const want = expectedEngineNames(rec.blobs);
  const overrides = new Map((project?.code?.overrides ?? []).map((o) => [o.name, gitBlobSha1(Buffer.from(o.text, 'utf8'))]));
  const extras = new Set((project?.code?.files ?? []).map((o) => o.name));
  const have = fs.readdirSync(buildDir).filter((n) => n.endsWith('.asm'));
  for (const n of want) {
    if (!have.includes(n)) throw new Error(`consumed-input guard: the build directory has no copy of engine/${n}`);
    const blob = gitBlobSha1(fs.readFileSync(path.join(buildDir, n)));
    const expect = overrides.get(n) ?? rec.blobs.get(`engine/${n}`);
    if (blob !== expect) throw new Error(`consumed-input guard: the assembler read ${n} as git blob ${blob.slice(0, 12)}, expected ${expect.slice(0, 12)}${overrides.has(n) ? ' (a declared Code Forge override)' : ''}`);
  }
  const unexplained = have.filter((n) => !want.includes(n) && !extras.has(n));
  if (unexplained.length) throw new Error(`consumed-input guard: the build directory holds assembler sources no engine file or declared Code Forge file explains: ${unexplained.join(', ')}`);
  return { ...consumedEvidence(tree, { only: buildDir }), overrides: [...overrides.keys()].sort() };
}

/**
 * Reads `rel` (e.g. 'engine/text.asm') out of a production ring tree for a harness that derives an override from it. Its file must be the expected blob; the text returned is the verified
 * bytes. A tree of any other ring is read as it is.
 */
export function readTreeText(tree, rel) {
  const bytes = fs.readFileSync(path.join(tree.root, rel));
  if (tree.guard) {
    const want = tree.guard.blobs.get(rel);
    if (want === undefined || gitBlobSha1(bytes) !== want) throw new Error(`consumed-input guard: ${rel} read for a harness override is not ${BASELINE} plus the tree's patches`);
  }
  return bytes.toString('utf8');
}

/**
 * Throws unless `tree` is the tree of cell `cell`'s ring (a vertical cell is built only through the production-vertical tree, a horizontal one only through the production-horizontal tree) AND
 * of its (only) form: unlifted, for either game type, and only for a cell production admits.
 */
export function assertCellRing(tree, cell, gameType) {
  if (!cell || cell.ring === undefined) return;
  if (tree.ring !== cell.ring) throw new Error(`cell ${cell.id ?? '?'} is ring ${cell.ring} but the tree is ${tree.kind} (ring ${tree.ring}): a vertical cell is built only through the production-vertical tree, a horizontal one only through the production-horizontal tree`);
  if (liftNeeded(cell, gameType)) throw new Error(`cell ${cell.id ?? '?'} ${gameType} is refused by production at ${BASELINE} and the refusal lift is retired: the gate certifies only what production admits`);
  if (tree.lifted !== false) throw new Error(`cell ${cell.id ?? '?'} ${gameType}: the tree is lifted, but the refusal lift is retired (S5 C3)`);
}

/** The ring check plus, for a production ring tree, the exact-content proof re-run NOW from the files on disk. Returns that proof (also stored as `tree.production`), or null for the pristine tree. */
export function assertTreeForCell(tree, cell, gameType) {
  assertCellRing(tree, cell, gameType);
  return refreshProof(tree);
}

/** Re-runs the exact-content proof for a production ring tree and stores it as `tree.production`; null for the pristine tree. A stamp carries the proof of the check that gated ITS build, never the one from tree creation. */
export function refreshProof(tree) {
  if (tree.ring !== 1 && tree.ring !== 2) return null;
  tree.production = verifyProduction(tree.root, tree.applied, tree.ring, tree.lifted);
  return tree.production;
}

/**
 * Imports the patched copy's own modules (a distinct file URL per tree, so module caches never alias the real tree). A production ring tree is re-proved first: every build path goes through here.
 * A production ring tree's modules also load through the consumed-input guard (below): the source the loader actually read is hashed and must be the expected blob, so the proof above and the
 * bytes the modules were compiled from cannot differ.
 */
export async function loadTree(tree) {
  refreshProof(tree);
  const u = (p) => pathToFileURL(path.join(tree.root, p)).href;
  const pipeline = await import(u('main/build/pipeline.js'));
  const projectIo = await import(u('main/project-io.js'));
  const shared = await import(u('shared/project.js'));
  const cartridge = await import(u('shared/cartridge.js'));
  return { buildProject: pipeline.buildProject, saveProject: projectIo.saveProject, shared, cartridge, tree, proof: tree.production ?? null };
}
