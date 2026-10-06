// Which world lengths N the build admits for each ring cell, game type and resource shape -- asked of the real capacity check
// (`checkCapacity`, main/build/generate.js) on the ring-prototype tree, never assumed. The PRG demand of a streamed map is
// `gridH * ceil(gridW / 24)` regions (shared/streamlayout.js `streamRegionsPerRow`, STREAM_SCREENS_PER_REGION = 24) and a streamed screen pays NO
// per-screen kernel-lo column (main/build/generate.js, `kernelTableBytes`: the 13 bytes/screen term charges ordinary screens only), so a
// vertical N x 1 world needs ceil(N/24) regions and a horizontal 1 x N world needs N.
//   node test/lua/ring_gate/ringcapacity.mjs [--json=<file>]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeTree } from './ringtree.mjs';
import { CELLS, GAME_TYPES, ringProject } from './ringworld.mjs';

/**
 * The admitted maximum N of a terrain-only world per cell and game type -- the table the campaign (ringcampaign.mjs) and the coverage document
 * (section 1) use. `node ringcapacity.mjs --check` re-derives every entry from the real capacity check and exits 1 on any difference.
 */
export const MAX_N = {
  'MMC1-V': { action: 255, rpg: 255 }, 'MMC3-V': { action: 255, rpg: 255 }, 'U512-V': { action: 255, rpg: 255 },
  'MMC1-H': { action: 14, rpg: 13 }, 'MMC3-H': { action: 30, rpg: 29 }, 'U512-H': { action: 61, rpg: 59 }
};

/** Resource shapes of a campaign world: what is placed per screen. `none` = terrain only; `talker` = the oracle's one enter-talker per screen. */
export const RESOURCE_SHAPES = ['none', 'landing', 'enter'];

/** { ok, problems } of `checkCapacity` for the world (errors only) -- through the patched tree's own copy. */
export async function admits(tree, { cell, gameType, n, talkers, bulk = false }) {
  const gen = await import(pathToFileURL(path.join(tree.root, 'main/build/generate.js')).href);
  const { project } = ringProject({ cell, gameType, n, talkers, bulkText: bulk ? 3000 : 0 });
  const problems = gen.checkCapacity(project).problems.filter((p) => p.severity === 'error').map((p) => p.message);
  return { ok: problems.length === 0, problems };
}

/** The largest N in [1, 255] the check admits (monotone: verified by also probing N+1..N+3 and a few below). */
export async function maxAdmitted(tree, spec) {
  let lo = 0, hi = 255;
  if (!(await admits(tree, { ...spec, n: 1 })).ok) return { max: 0, firstProblem: (await admits(tree, { ...spec, n: 1 })).problems[0] };
  lo = 1;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if ((await admits(tree, { ...spec, n: mid })).ok) lo = mid; else hi = mid - 1; }
  const over = lo < 255 ? (await admits(tree, { ...spec, n: lo + 1 })).problems[0] : null;
  for (const k of [1, 2, 3]) if (lo + k <= 255 && (await admits(tree, { ...spec, n: lo + k })).ok) throw new Error(`non-monotone admission at ${spec.cell.id} ${spec.gameType} ${spec.talkers}: N=${lo} then N=${lo + k} admitted`);
  return { max: lo, firstProblem: over };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const tree = makeTree({ ring: true });
  const rows = [];
  for (const cell of CELLS) for (const gameType of GAME_TYPES) for (const talkers of RESOURCE_SHAPES) for (const bulk of gameType === 'rpg' && talkers === 'landing' ? [false, true] : [false]) {
    const r = await maxAdmitted(tree, { cell, gameType, talkers, bulk });
    rows.push({ cell: cell.id, ring: cell.ring, gameType, talkers, bulk, max: r.max, firstRefusal: r.firstProblem });
    console.log(`${cell.id.padEnd(7)} ring ${cell.ring} ${gameType.padEnd(6)} ${(talkers + (bulk ? '+bulk' : '')).padEnd(11)} max N = ${String(r.max).padStart(3)}  ${r.firstProblem ? '| N+1: ' + r.firstProblem.slice(0, 150) : ''}`);
  }
  const wrong = rows.filter((r) => r.talkers === 'none' && !r.bulk && r.max !== MAX_N[r.cell][r.gameType]);
  for (const r of wrong) console.log(`MAX_N MISMATCH ${r.cell} ${r.gameType}: table ${MAX_N[r.cell][r.gameType]}, capacity check ${r.max}`);
  const j = process.argv.find((a) => a.startsWith('--json='))?.slice(7);
  if (j) fs.writeFileSync(j, JSON.stringify(rows, null, 1));
  fs.rmSync(tree.root, { recursive: true, force: true });
  console.log(wrong.length ? `${wrong.length} MAX_N entries differ from the capacity check` : `MAX_N table matches the capacity check (${rows.filter((r) => r.talkers === 'none').length} entries)`);
  process.exit(wrong.length ? 1 : 0);
}
