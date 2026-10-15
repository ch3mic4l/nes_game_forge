// The ring selection of the G-gate builders (phase 3b S1b): resolves a ring cell id to the scene's `ring` spec ({ mapper, mirroring, ring, n }) and the
// patched tree that builds it. `test/lua/run_sw_manifest.mjs --ring=<cell>` and `test/lua/run_sw_move_manifest.mjs --ring=<cell>` import this ONLY
// when the flag is given, so every four-screen invocation is unchanged (proved by s1b_noflag.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeCellTree, assertTreeForCell } from './ringtree.mjs';
import { cellById } from './ringworld.mjs';
import { layoutMutate } from './ringlayout.mjs';

/** The smallest world the scenes need (start screen, two target screens, one empty screen behind them). */
export const MIN_RING_N = 4;

/**
 * The largest N (>= MIN_RING_N) the REAL capacity check admits for this cell, game type and scene (the manifest workload: eight actors per target,
 * the touch Shake/Flash/Sfx npc, a damage npc, art), by bisection through the patched tree's own checkCapacity -- the deepest world the board holds
 * with the workload on it, never an assumed table value. `build(root, n)` returns the normalized scene project (throws if the scene is refused).
 * Monotonicity is verified by probing N+1..N+2.
 */
export async function maxWorkloadN(tree, cell, gt, build, hi = 255) {
  const gen = await import(pathToFileURL(path.join(tree.root, 'main/build/generate.js')).href);
  const ok = async (n) => {
    try { const project = await build(tree.root, n); return gen.checkCapacity(project).problems.every((p) => p.severity !== 'error'); } catch { return false; }
  };
  if (!(await ok(MIN_RING_N))) throw new Error(`${cell.id}/${gt}: even N=${MIN_RING_N} is refused with this workload`);
  let lo = MIN_RING_N;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (await ok(mid)) lo = mid; else hi = mid - 1; }
  for (const k of [1, 2]) if (lo + k <= hi && (await ok(lo + k))) throw new Error(`non-monotone admission at ${cell.id}/${gt}: N=${lo} then N=${lo + k}`);
  return lo;
}

/**
 * Which tileset layout the gate's RPG workload uses on a cell, DERIVED and not listed (S5 C3): the layout -- the default two-tileset RPG (Main + Battle) or the one-tileset RPG (rpg.battleTilesetId = the field's) -- whose
 * `maxWorkloadN` is deeper, so the gate cell runs at the board's real RPG ceiling; on a tie the default two-tileset layout stays, so a cell where the layout changes nothing (MMC1, MMC3: their tilesets sit in CHR ROM;
 * every vertical ring: the grid limit bounds it) keeps its project byte for byte. Decided ONCE per cell from the canonical gate workload (no per-screen talkers, the resident scene) through a fresh PLAIN BASELINE
 * tree -- never the caller's tree, which may carry a control's sabotage form that moves the capacity check -- so a control's project is its baseline cell's project. Cached per process.
 * Returns { oneTileset, depths: { two, one } }.
 */
const layoutCache = new Map();
export async function rpgLayoutFor(cell) {
  if (!layoutCache.has(cell.id)) {
    layoutCache.set(cell.id, (async () => {
      const t = makeCellTree({ cell, gameType: 'rpg' });
      try {
        const { buildSceneProject } = await import(pathToFileURL(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../sw_manifest_scene.mjs')).href);
        const depth = (oneTileset) => maxWorkloadN(t, cell, 'rpg', async (root, nn) => { const ring = { mapper: cell.mapper, mirroring: cell.mirroring, ring: cell.ring, n: nn, bulk: 0, ...(oneTileset ? { oneTileset: true } : {}) }; return (await buildSceneProject({ root, gt: 'rpg', sizes: null, wide: true, ring, nosfx: false, mutate: layoutMutate(ring) })).project; });
        const two = await depth(false), one = await depth(true);
        return { oneTileset: one > two, depths: { two, one } };
      } finally { fs.rmSync(t.root, { recursive: true, force: true }); }
    })());
  }
  return layoutCache.get(cell.id);
}

/**
 * { tree, ring, dispose }: a patched ring tree and the scene's `ring` spec for `cellId`. `n` null = the deepest admitted world for this workload
 * (maxWorkloadN); a given `n` must itself be admitted.
 */
export async function prepareRing({ cellId, gt = 'action', n = null, sizes = null, wide = false, scene = {}, tree = null, bulk = 0, chaserDamage = 0, terrain = false }) {
  const cell = cellById(cellId);
  const own = tree === null;
  const t = tree ?? makeCellTree({ cell, gameType: gt });
  assertTreeForCell(t, cell, gt);
  const { buildSceneProject } = await import(pathToFileURL(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../sw_manifest_scene.mjs')).href);
  const oneTileset = gt === 'rpg' && (await rpgLayoutFor(cell)).oneTileset;
  const build = async (root, nn) => { const ring = { mapper: cell.mapper, mirroring: cell.mirroring, ring: cell.ring, n: nn, bulk, ...(oneTileset ? { oneTileset: true } : {}), ...(chaserDamage ? { chaserDamage } : {}), ...(terrain ? { terrain: true } : {}) }; return (await buildSceneProject({ root, gt, sizes, wide, ring, ...scene, mutate: layoutMutate(ring, scene.mutate) })).project; };
  const N = n ?? await maxWorkloadN(t, cell, gt, build);
  if (n !== null) await build(t.root, n); // a stated N must at least be a scene the builder admits
  return { tree: t, cell, ring: { mapper: cell.mapper, mirroring: cell.mirroring, ring: cell.ring, n: N, bulk, ...(oneTileset ? { oneTileset: true } : {}), ...(chaserDamage ? { chaserDamage } : {}), ...(terrain ? { terrain: true } : {}) }, dispose: () => { if (own) fs.rmSync(t.root, { recursive: true, force: true }); } };
}
