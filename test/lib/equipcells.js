// The conjunction cells the equipment allowances are measured on (review R3 of the C3 round: CLAUDE.md's kernel-ledger rule "a term is
// measured on every game type and condition it is charged to"). Shared by test/unit/bankedbytes.test.js (the banked core, MAG and MDEF
// terms) and test/unit/kernelbytes.test.js (the Save supplement). A cell is a function from { mapper, items, sources } to a project,
// where `items` are the pieces (or ordinary items) to append and `sources` turns the party's own baseMag / baseMdef on so the gated MAG /
// MDEF terms are measured as the equipment term alone.
//
// Coverage boundary (handoff-next/equip/c3/fix2/report.md). Streamed + Save + Move and streamed + Save + the battle features are
// measured in their compact form (see `compact`). Where a project truly exceeds the kernel-lo capacity it is refused for THAT project,
// named as such, never for the feature conjunction: the compact streamed + Save + Move project on MMC3 and UNROM 512 (free bytes
// -70 and -282 with no equipment), and the uncompacted streamed + Save + Move project on every board. `equipRefusedOn` (C4): boards where the cell
// fits with no equipment but one piece is refused, because the Equip opener (EQUIP_KERNEL_ALLOWANCE, 30 bytes, 49 with Save) takes
// kernel-lo over its edge -- UNROM 512 streamed + Save (20 bytes short with one piece; 32 free without) and UNROM 512 compact streamed + Save +
// the battle features (8 short; 44 free without); asserted as exactly that refusal in kernelbytes.test.js, so no equipment ROM exists there
// for THOSE projects. The conjunctions stay supported in smaller projects and are measured there (review R3 of C4, `trimmed`): the same
// streamed + Save with the title map cut to one screen (`compact`), and the battle-feature cell with the unplaced Iris NPC removed -- UNROM 512
// only, appended to both ledgers; no feature predicate changes. Not cells: a streamed map with
// the camera off (refused); DEF-only/ATK-only pieces in the new cells (they share the core's gate, measured on the
// default cells); encounters (the grafted monsters are never placed).

import { loadProject } from '../../main/project-io.js';
import {
  projectUsesBattleAnimation,
  projectUsesHitFeedback,
  projectUsesMiss,
  projectUsesMonsterSpellList,
  projectUsesMove,
  projectUsesNameEntry,
  projectUsesSave
} from '../../shared/project.js';
import { projectUsesStreaming } from '../../shared/streamlayout.js';
import { equipProject, equipStreamedProject, SAMPLE_RPG } from './equipharness.js';

/** The shape a built cell project really has, read off the repo's own predicates: a cell that does not build the shape it names measures nothing. */
export const shapeOf = (p) => ({
  save: projectUsesSave(p),
  naming: projectUsesNameEntry(p),
  anim: projectUsesBattleAnimation(p),
  spells: projectUsesMonsterSpellList(p),
  hit: projectUsesHitFeedback(p),
  miss: projectUsesMiss(p),
  streamed: projectUsesStreaming(p),
  move: projectUsesMove(p)
});
const F = { save: false, naming: false, anim: false, spells: false, hit: false, miss: false, streamed: false, move: false };

export const CELL_BOARDS = [1, 4, 30]; // MMC1, MMC3, UNROM 512: the RPG-capable boards

const withSources = (p) => {
  p.party[0].baseMag = 5;
  p.party[0].magPerLevel = 1;
  p.party[0].baseMdef = 5;
  p.party[0].mdefPerLevel = 1;
};
const naming = (p) => {
  for (const m of p.party) m.renamable = true;
};
const animation = (p) => {
  p.sprites.actors[0].battle.attackAnim = 1;
  p.spells[0].anim = 2;
  p.party[0].attackAnim = 0;
};
const spellList = (p) => {
  const snake = p.sprites.actors.find((a) => a.battle?.spellIds?.length);
  snake.battle.spellIds = [...snake.battle.spellIds, 0];
};
const hitAndMiss = (p) => {
  p.rpg.hitFeedback = true;
  p.rpg.miss = true;
};
/** A live Move command on a new NPC, as test/lib/streamedproject.js places one. */
const move = (p) => {
  const actorId = p.sprites.actors.length;
  p.sprites.actors.push({ name: 'Mover', behavior: 'npc', hp: 1, damage: 0 });
  p.maps[0].screens[0].entities.push({
    actorId,
    x: 32,
    y: 32,
    props: { toX: 0, toY: 0, event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'move', who: 'self', dir: 'up', dist: 16 }] }] } }
  });
};

/** sample-rpg's monsters, spells and animations grafted onto a streamed project (which ships none), then the battle features on. */
let sampleCache;
const graftBattleContent = async (p) => {
  const sample = (sampleCache ??= await loadProject(SAMPLE_RPG));
  p.spells = structuredClone(sample.spells);
  p.sprites.animations = structuredClone(sample.sprites.animations);
  p.sprites.metasprites = structuredClone(sample.sprites.metasprites);
  p.sprites.actors = structuredClone(sample.sprites.actors);
  animation(p);
  spellList(p);
  hitAndMiss(p);
};

const ordinary = (mutate) => async ({ mapper, items = [], sources = false, save = false }) =>
  equipProject({ mapper, items, save, mutate: (p) => { mutate?.(p); if (sources) withSources(p); } });
/**
 * The compact form of a mixed streamed project (review R3a of C3 round 2): the unused trailing "After" map dropped and the ordinary title
 * map cut to its one screen. Both are pure lookup-table savings (100 bytes) that touch no feature predicate -- `shapeOf` is asserted per
 * cell -- and are what lets the tight conjunctions (streamed + Save + Move; streamed + Save + the battle features) fit and be measured.
 */
export const compact = (p) => {
  if (p.maps.length !== 3 || p.maps[2].streamed || !p.maps[1].streamed) throw new Error('compact() expects the mixed Before / Streamed / After layout');
  p.maps.pop();
  p.maps[0].screens = [p.maps[0].screens[0]];
  p.maps[0].gridW = 1;
  p.maps[0].gridH = 1;
};
/** Removes the grafted sample-rpg's unplaced Iris NPC (no entity references her): 'Rian' and 'Slime' stay, every battle-feature predicate stays true. */
const dropUnplacedIris = (p) => {
  const index = p.sprites.actors.findIndex((a) => a.name === 'Iris');
  if (index !== 2 || p.maps.some((m) => m.screens.some((s) => s.entities.some((e) => e.actorId === index)))) throw new Error('dropUnplacedIris expects the unplaced Iris NPC at actor 2');
  p.sprites.actors.splice(index, 1);
};
const streamed = (opts, graft) => async ({ mapper, items = [], sources = false, save = false }) => {
  const p = equipStreamedProject({ mapper, items, save: opts.save ?? save, move: opts.move });
  if (opts.compact) compact(p);
  if (graft) await graftBattleContent(p);
  if (opts.dropIris) dropUnplacedIris(p);
  if (sources) withSources(p);
  return p;
};
// A streamed project ships no items, so its baseline carries one ordinary item both with and without the piece: the piece alone differs.
const streamedItems = (items) => [{ id: 0, name: 'Tonic', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 20 } }, ...items];
const streamedCell = (opts, graft) => async (args) => (streamed(opts, graft))({ ...args, items: streamedItems(args.items ?? []) });

/** Banked-ledger cells, in the order of the review: every one a conjunction the banked core is charged on. */
export const BANKED_CELLS = [
  { label: 'Save + naming together', make: ordinary(naming), save: true, shape: { ...F, save: true, naming: true } },
  { label: 'title-less, Save off', make: ordinary(), save: false, titleless: true, shape: { ...F } },
  { label: 'battle animation (monster, spell and party attack visuals)', make: ordinary(animation), shape: { ...F, anim: true } },
  { label: 'monster spell lists', make: ordinary(spellList), shape: { ...F, spells: true } },
  { label: 'everything at once: Save + naming + animation + spell list + hit feedback + miss', make: ordinary((p) => { naming(p); animation(p); spellList(p); hitAndMiss(p); }), save: true, shape: { ...F, save: true, naming: true, anim: true, spells: true, hit: true, miss: true } },
  { label: 'streamed world', make: streamedCell({}, false), shape: { ...F, streamed: true } },
  { label: 'streamed world + animation + spell list + hit feedback + miss', make: streamedCell({}, true), shape: { ...F, streamed: true, anim: true, spells: true, hit: true, miss: true } },
  { label: 'streamed world + Save', make: streamedCell({ save: true }, false), save: true, shape: { ...F, streamed: true, save: true }, equipRefusedOn: [30] },
  { label: 'compact streamed world + Save + Move', make: streamedCell({ save: true, move: true, compact: true }, false), save: true,
    shape: { ...F, streamed: true, save: true, move: true }, boards: [1] },
  { label: 'compact streamed world + Save + animation + spell list + hit feedback + miss', make: streamedCell({ save: true, compact: true }, true), save: true,
    shape: { ...F, streamed: true, save: true, anim: true, spells: true, hit: true, miss: true }, equipRefusedOn: [30] },
  // The supported conjunctions the two refusals above would otherwise leave unmeasured (review R3 of C4): UNROM 512 only.
  { label: 'streamed world + Save, title map trimmed to one screen', make: streamedCell({ save: true, compact: true }, false), save: true,
    shape: { ...F, streamed: true, save: true }, boards: [30] },
  { label: 'compact streamed world + Save + animation + spell list + hit feedback + miss, unplaced Iris NPC removed', make: streamedCell({ save: true, compact: true, dropIris: true }, true), save: true,
    shape: { ...F, streamed: true, save: true, anim: true, spells: true, hit: true, miss: true }, boards: [30] }
];

/** Kernel-ledger cells (the Save supplement is charged only with Save; the other cells prove it is 0 without).
 *  `boards` limits a cell to the boards it fits; `refusedOn` names boards where THIS project exceeds the kernel-lo capacity even with no
 *  equipment (asserted for exactly that project, never for the feature conjunction); `pinnedMargin` records a pre-existing excess of the
 *  base model's whole-bank margin over [KERNEL_SLACK, 2*KERNEL_SLACK], measured with no equipment: { mapperId: margin }. */
export const KERNEL_CELLS = [
  { label: 'streamed world + Save', make: streamedCell({ save: true }, false), save: true, shape: { ...F, streamed: true, save: true },
    pinnedMargin: { 1: 50, 4: 50 }, equipRefusedOn: [30] },
  // The supported UNROM 512 forms of the two conjunctions its equipRefusedOn entries refuse (review R3 of C4).
  { label: 'streamed world + Save, title map trimmed to one screen', make: streamedCell({ save: true, compact: true }, false), save: true,
    shape: { ...F, streamed: true, save: true }, boards: [30] },
  { label: 'compact streamed world + Save + animation + spell list + hit feedback + miss, unplaced Iris NPC removed', make: streamedCell({ save: true, compact: true, dropIris: true }, true), save: true,
    shape: { ...F, streamed: true, save: true, anim: true, spells: true, hit: true, miss: true }, boards: [30] },
  { label: 'Move + Save', make: ordinary(move), save: true, shape: { ...F, save: true, move: true } },
  { label: 'Move + Save + naming', make: ordinary((p) => { move(p); naming(p); }), save: true, shape: { ...F, save: true, move: true, naming: true } },
  { label: 'streamed world + Move (no Save)', make: streamedCell({ move: true }, false), save: false, shape: { ...F, streamed: true, move: true } },
  // The compact cells (review R3a): the mixed project with its unused "After" map dropped and its title map cut to one screen.
  { label: 'compact streamed world + Save + Move', make: streamedCell({ save: true, move: true, compact: true }, false), save: true,
    shape: { ...F, streamed: true, save: true, move: true }, boards: [1], refusedOn: [4, 30], pinnedMargin: { 1: 50 } },
  { label: 'compact streamed world + Save + animation + spell list + hit feedback + miss', make: streamedCell({ save: true, compact: true }, true), save: true,
    shape: { ...F, streamed: true, save: true, anim: true, spells: true, hit: true, miss: true }, pinnedMargin: { 1: 50, 4: 50 }, equipRefusedOn: [30] }
];
