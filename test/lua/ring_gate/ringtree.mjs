// The ring gate's one tree-maker: a mkdtemp copy of engine/ main/ shared/ (+ package.json, so `type: module` holds) with the
// phase 3b ring patches applied by `git apply`, and the imports to build a project through THAT copy's real public path
// (buildProject). It fails loudly if a patch does not apply and never falls back to the unpatched tree: a silent four-screen
// fallback counted as a ring pass is the exact defect the row-1 identity cell exists to catch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const PATCH_DIR = path.join(ROOT, 'test/lua/ring_gate');
export const RING_PATCHES = ['01-ring-select.patch', '02-ring-engine.patch', '03-player-far-branch.patch'];
const COPIED = ['engine', 'main', 'shared'];
/** The certification baseline: the tree makeTree copies must equal it (S0 committed). */
export const BASELINE = '5138c1f0c33107016a90423da17dcbb33d8697ca';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Resolves a patch name ('01-...patch' or 'sabotage/x') to its file. */
export function patchFile(name) {
  const rel = name.endsWith('.patch') ? name : `sabotage/${name}.patch`;
  const p = path.join(PATCH_DIR, rel);
  if (!fs.existsSync(p)) throw new Error(`ring patch not found: ${p}`);
  return p;
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

/**
 * makeTree({ ring: true|false, extra: ['strip-len-30-vertical'] }) -> { root, patches: [{name, sha256}], head, status }.
 * ring:false is the pristine copy (the control for the STREAM_RING=0 identity proof); extra patches only apply on top of ring:true.
 */
export function makeTree({ ring = true, extra = [] } = {}) {
  verifyBaseline();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-tree-'));
  for (const d of COPIED) fs.cpSync(path.join(ROOT, d), path.join(root, d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(root, 'package.json'));
  const names = ring ? [...RING_PATCHES, ...extra] : [];
  if (!ring && extra.length) throw new Error('extra patches need ring:true');
  const patches = [];
  for (const name of names) {
    const file = patchFile(name);
    if (fs.statSync(file).size === 0) throw new Error(`ring patch ${name} is empty: every required patch of the shipped set changes something at ${BASELINE}`);
    try {
      execFileSync('git', ['apply', '-p2', '--whitespace=nowarn', file], { cwd: root, stdio: 'pipe' });
    } catch (e) {
      throw new Error(`ring patch ${name} does not apply to this tree (HEAD moved? re-run regen_patches.mjs):\n${e.stderr?.toString() ?? e.message}`);
    }
    patches.push({ name, sha256: sha256(fs.readFileSync(file)) });
  }
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
  return { root, patches, baseline: BASELINE, head: git('rev-parse', 'HEAD'), status: git('status', '--short', '--', 'engine', 'main', 'shared', 'renderer', 'docs') || 'clean' };
}

/** Imports the patched copy's own modules (a distinct file URL per tree, so module caches never alias the real tree). */
export async function loadTree(tree) {
  const u = (p) => pathToFileURL(path.join(tree.root, p)).href;
  const pipeline = await import(u('main/build/pipeline.js'));
  const projectIo = await import(u('main/project-io.js'));
  const shared = await import(u('shared/project.js'));
  const cartridge = await import(u('shared/cartridge.js'));
  return { buildProject: pipeline.buildProject, saveProject: projectIo.saveProject, shared, cartridge, tree };
}
