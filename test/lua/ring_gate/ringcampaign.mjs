// The scene registry of the coverage campaign (handoff-next/phase3b-s1a-coverage.md sections 4-8): which scenes exist, for which cells and game
// types they are admitted (N against the capacity check's MAX_N), and which dialogue placements each runs. A scene that does not apply to a pair
// is returned as an explicit N/A with its source reason -- never skipped silently.
import { sweepScene, reversalScene } from './ringsweep.mjs';
import { bmaxOf } from './ringwitness.mjs';
import { MAX_N } from './ringcapacity.mjs';
import { redrawScene, REDRAW_N, landScene, LAND_CASES, LAND_N, landId } from './ringredraw.mjs';
import { shakeScene } from './ringshake.mjs';
import { dialogueClasses, dialogueScene, classLabel, DLG_N } from './ringdialogue.mjs';

/** id, group, N (or a function of the pair), builder, placements ('resident' always; 'banked' where listed, RPG only). */
export const SCENE_DEFS = [
  { id: 'sw-N1', n: () => 1, build: (ring) => sweepScene({ ring, n: 1, walk: true }) },
  { id: 'sw-N2', n: () => 2, build: (ring) => sweepScene({ ring, n: 2, walk: true }) },
  { id: 'sw-N3', n: () => 3, build: (ring) => sweepScene({ ring, n: 3 }) },
  { id: 'sw-N5', n: () => 5, build: (ring) => sweepScene({ ring, n: 5 }), banked: true },
  { id: 'sw-N6', n: () => 6, build: (ring) => sweepScene({ ring, n: 6 }), banked: true },
  { id: 'sw-N20', n: () => 20, build: (ring) => (ring === 1 ? sweepScene({ ring, n: 20, b0: 222, b1: 262 }) : sweepScene({ ring, n: 20, b0: 208, b1: 270 })) },
  { id: 'sw-N27', n: () => 27, build: (ring) => (ring === 1 ? sweepScene({ ring, n: 27, b0: 350, b1: 390 }) : sweepScene({ ring, n: 27, b0: 328, b1: 376 })) },
  { id: 'sw-N130', n: () => 130, build: (ring) => sweepScene({ ring, n: 130, b0: 2030, b1: 2050 }) },
  { id: 'sw-Nmax', n: (cell, gt) => MAX_N[cell.id][gt], build: (ring, n) => sweepScene({ ring, n, b0: bmaxOf(ring, n) - 3, landTerminal: true }), banked: true },
  { id: 'rev', n: () => 6, build: (ring) => reversalScene({ ring, n: 6 }) }
];

/** Every dialogue class scene id, both rings (the ids are ring-specific in their label: r<k>-p<parity> vertical, R<row>-p<parity> horizontal). */
export const DLG_IDS = [1, 2].flatMap((ring) => dialogueClasses(ring).map((c) => `dlg-${classLabel(ring, c)}`));
export const REDRAW_IDS = ['redraw-guard', 'redraw-warp', 'redraw-battle', 'redraw-continue'];
/** The Continue landing scenes (ringredraw.mjs landScene): a Save planted by a start position at a chosen screen and local y, both rings. */
export const LAND_IDS = [...new Set([1, 2].flatMap((ring) => LAND_CASES[ring].map((c) => landId(ring, c))))];
export const SHAKE_IDS = ['shake'];
export const ALL_SCENE_IDS = [...SCENE_DEFS.map((d) => d.id), ...REDRAW_IDS, ...LAND_IDS, ...SHAKE_IDS, ...DLG_IDS];

/** [{ id, n, placement, scene | null, na: reason | null }] for one pair. */
export function scenesFor(cell, gameType) {
  const out = [];
  for (const def of SCENE_DEFS) {
    const n = def.n(cell, gameType);
    const max = MAX_N[cell.id][gameType];
    const placements = ['resident', ...(def.banked && gameType === 'rpg' ? ['banked'] : [])];
    for (const placement of placements) {
      if (n > max) out.push({ id: def.id, n, placement, scene: null, na: `N=${n} exceeds the ${max} 8 KB regions-bounded maximum of ${cell.id} ${gameType} (checkCapacity; coverage doc section 1)` });
      else out.push({ id: def.id, n, placement, scene: def.build(cell.ring, n), na: null, emus: ['jsnes', 'mesen'] });
    }
  }
  // redraw (d) entry paths: guard and warp on every pair, battle return on RPG pairs; RPG pairs run both dialogue placements
  for (const entry of ['guard', 'warp', 'battle', 'continue']) {
    const id = `redraw-${entry}`;
    const n = REDRAW_N[entry];
    if (entry === 'battle' && gameType !== 'rpg') { out.push({ id, n, placement: 'resident', scene: null, na: 'a monster-contact battle exists only in an RPG project (rpgCapable; the action game has no battle bank)' }); continue; }
    const max = MAX_N[cell.id][gameType];
    for (const placement of ['resident', ...(gameType === 'rpg' ? ['banked'] : [])]) {
      if (n > max) out.push({ id, n, placement, scene: null, na: `N=${n} exceeds the ${max} maximum of ${cell.id} ${gameType}` });
      else out.push({ id, n, placement, scene: redrawScene({ ring: cell.ring, entry, battery: cell.mapper !== 30 }), na: null, emus: ['jsnes', 'mesen'] });
    }
  }
  // the Continue landing scenes: one per (screen, local y) the ring admits; both emulators (Mesen as a chain of two private-HOME invocations), both RPG placements
  for (const c of LAND_CASES[cell.ring]) {
    const id = landId(cell.ring, c);
    const max = MAX_N[cell.id][gameType];
    for (const placement of ['resident', ...(gameType === 'rpg' ? ['banked'] : [])]) {
      if (LAND_N > max) out.push({ id, n: LAND_N, placement, scene: null, na: `N=${LAND_N} exceeds the ${max} maximum of ${cell.id} ${gameType}` });
      else out.push({ id, n: LAND_N, placement, scene: landScene({ ring: cell.ring, ...c, battery: cell.mapper !== 30 }), na: null, emus: ['jsnes', 'mesen'] });
    }
  }
  // the Shake event (section 8): a horizontal-mirroring scene; on a vertical-mirroring cell the same event swaps which LIVE NT is displayed, which the
  // gate's mirror-alias claim does not cover
  for (const placement of ['resident']) {
    if (cell.ring !== 2) out.push({ id: 'shake', n: 6, placement, scene: null, na: 'the Shake scene claims the horizontal-mirroring alias (select 1/3 shows live NT 0/2): on a vertical-mirroring cell a shake displaces X across two DIFFERENT live NTs, outside this gate\'s claim' });
    else if (6 > MAX_N[cell.id][gameType]) out.push({ id: 'shake', n: 6, placement, scene: null, na: `N=6 exceeds the ${MAX_N[cell.id][gameType]} maximum` });
    else out.push({ id: 'shake', n: 6, placement, scene: shakeScene({ ring: 2 }), na: null, emus: ['jsnes', 'mesen'] });
  }
  // dialogue classes (coverage doc section 7): EVERY class (box start residue x NT parity) on every pair -- action/resident, RPG/resident and RPG/banked --
  // in BOTH emulators. Nothing is argued by equivalence: the leading close-run lengths 1-8 (ring 1: 8-(k&7), k = cam_x_lo>>4) are all run, and the RPG/resident
  // lifecycle is run (its !BATTLE_ENABLED HUD difference does not touch nametable bytes, which are all that is judged here: coverage doc section 7).
  for (const c of dialogueClasses(cell.ring)) {
    const id = `dlg-${classLabel(cell.ring, c)}`;
    const placements = gameType === 'action' ? ['resident'] : ['resident', 'banked'];
    for (const placement of placements) out.push({ id, n: DLG_N, placement, scene: dialogueScene({ ring: cell.ring, ...c }), na: null, emus: ['jsnes', 'mesen'] });
  }
  return out;
}
