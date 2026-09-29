// Slice 10b: the committed streamed-RPG content inventory, as a module. These builders are
// duplicated VERBATIM from test/unit/streamedceiling.test.js (slice 10's own committed inventory,
// lines noted below at the time of copying) because that file is a test, not a module, and exports
// nothing. Slice 10b's tests, and its baseline hash scripts, need the identical project shapes.
// If the inventory in streamedceiling.test.js ever changes, this file must change with it; the
// slice 10b tests pin the same sorted-lines digest that file does.
import { createProject, createMap, createScreen, createSpell, planLibraryImport, applyPlannedProject } from '../../shared/project.js';
import { LIBRARY_ENTRIES } from '../../shared/library/index.js';
import { checkCapacity, contentCeilingBytes } from '../../main/build/generate.js';

export function distinctScreen(col, row) {
  const screen = createScreen();
  const variedCount = Math.floor(screen.metatiles.length / 3);
  for (let i = 0; i < screen.metatiles.length; i++) {
    screen.metatiles[i] = i < variedCount ? 1 + ((col + row + i) % 3) : 0;
  }
  return screen;
}

export function base(gameType = 'rpg') {
  const p = createProject('Ceiling probe', gameType);
  p.cartridge.mapper = 30;
  p.cartridge.mirroring = 'fourscreen';
  p.cartridge.camera = true;
  const map = createMap(0, 'Streamed');
  const gridW = 3,
    gridH = 2;
  map.gridW = gridW;
  map.gridH = gridH;
  map.streamed = true;
  map.fillMetatileId = 0;
  map.screens = [];
  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) map.screens.push(distinctScreen(col, row));
  }
  p.maps = [map];
  return p;
}

export function importLibraryContent(p) {
  for (const entry of LIBRARY_ENTRIES.filter((e) => e.kind === 'song')) {
    const plan = planLibraryImport(p, entry, {});
    if (!plan.ok) throw new Error(`song import refused: ${plan.reason}`);
    applyPlannedProject(p, plan.project);
  }
  for (const entry of LIBRARY_ENTRIES.filter((e) => e.kind === 'sfx')) {
    const plan = planLibraryImport(p, entry, {});
    if (!plan.ok) throw new Error(`sfx import refused: ${plan.reason}`);
    applyPlannedProject(p, plan.project);
  }
  // planLibraryImport's clone resets cartridge to createProject's own default -- restore this
  // module's own streamed board settings every caller needs.
  p.cartridge.mapper = 30;
  p.cartridge.mirroring = 'fourscreen';
  p.cartridge.camera = true;
}

export function importLibraryMonsters(p) {
  const ids = [];
  for (const entry of LIBRARY_ENTRIES.filter((e) => e.kind === 'monster')) {
    const plan = planLibraryImport(p, entry, {});
    if (!plan.ok) throw new Error(`monster import refused: ${plan.reason}`);
    applyPlannedProject(p, plan.project);
    ids.push(p.sprites.actors.length - 1);
  }
  p.cartridge.mapper = 30;
  p.cartridge.mirroring = 'fourscreen';
  p.cartridge.camera = true;
  return ids; // in LIBRARY_ENTRIES order: [Slime, Bat, Skeleton]
}

export const COMMITTED_DIALOGUE = {
  npc: [
    "Riverside's mill hasn't stopped turning in forty years.",
    'My grandmother remembers when the bridge still had a toll.',
    'The old well out back runs dry every summer now.',
    "Have you seen the miller's cat? She wanders into the flour again.",
    'Travelers say the mine past the ridge swallowed a whole crew once.',
    "I traded my father's sword for a plow years ago. No regrets.",
    'The chapel bell cracked last winter. We still ring it anyway.',
    'Millhaven used to be twice this size before the fever came through.',
    "The blacksmith's forge hasn't cooled since his son took over.",
    'Watch your step near the old quarry, the fence rotted through.',
    'They say a hermit lives past the northern gate now.',
    'Our well water tastes of iron since the earthquake.',
    "The innkeeper waters down the ale, but don't tell her I said so.",
    "Millhaven's founder is buried under that crooked oak."
  ],
  sign: ['RIVERSIDE - POPULATION 62', 'MILLHAVEN - MIND THE QUARRY', 'SHOP - POTIONS AND SUPPLIES', 'DANGER: MINE ENTRANCE AHEAD'],
  shop: [
    'Welcome, traveler. Care to see my wares?',
    "That'll cost you, but it's fair coin for fair goods.",
    'Come back if you need more. The road is long.'
  ],
  story: [
    'Something stirs beneath the old mine. The elders are afraid.',
    'You have reached the heart of the mine. The air grows cold.',
    'The tremors have stopped. Riverside and Millhaven are safe again.'
  ]
};


export const COMMITTED_DIALOGUE_ALL = [...COMMITTED_DIALOGUE.npc, ...COMMITTED_DIALOGUE.sign, ...COMMITTED_DIALOGUE.shop, ...COMMITTED_DIALOGUE.story];

/**
 * Places all 24 committed dialogue lines round-robin across `project`'s own streamed-map screens.
 * Split out from buildCommittedInventory so buildR4Sample can import its monsters FIRST and place
 * dialogue LAST -- planLibraryImport/applyPlannedProject clone-and-reassign `project.maps` on
 * every import (see importLibraryContent's own comment), which would silently orphan any
 * `sayCommand` object captured before a later import call.
 *
 * `linesPerEntity` groups consecutive committed lines onto ONE entity as consecutive `say`
 * commands in a single page -- a short conversation, not padding: the 24 lines and their content
 * are identical either way, only how many distinct placed actors carry them changes. Default 1
 * (one NPC/sign per line) for the kernel-hi-only measurement (item 1/case 1, which never calls
 * buildProject and so never meets kernel-lo's own, unrelated entity-table budget). buildR4Sample
 * uses a larger grouping because it DOES build for real: 24 distinct placed actors plus a full
 * monster/item/spell/battle roster overflows kernel-lo's entity tables on this board, a genuinely
 * separate capacity ceiling from the kernel-hi content ceiling this whole slice is about.
 */
export function placeCommittedDialogue(project, { linesPerEntity = 1 } = {}) {
  const screens = project.maps[0].screens;
  const sayCommands = [];
  for (let i = 0; i < COMMITTED_DIALOGUE_ALL.length; i += linesPerEntity) {
    const chunk = COMMITTED_DIALOGUE_ALL.slice(i, i + linesPerEntity);
    const screen = screens[Math.floor(i / linesPerEntity) % screens.length];
    const actorId = project.sprites.actors.length;
    project.sprites.actors.push({ name: `Talker${actorId}`, behavior: 'npc', hp: 1, damage: 0 });
    screen.entities = screen.entities ?? [];
    const commands = chunk.map((text) => ({ op: 'say', text }));
    screen.entities.push({
      actorId,
      x: 32,
      y: 32,
      props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } }
    });
    const page = screen.entities[screen.entities.length - 1].props.event.pages[0];
    sayCommands.push(...page.commands);
  }
  return sayCommands;
}

/**
 * base(gameType) + the full committed inventory above, every line placed round-robin across the
 * streamed map's own screens. The one project shape item 1's measurement, case 1's pin and
 * buildR4Sample() all build from, so they can never silently disagree about what "the committed
 * inventory" contains.
 */
export function buildCommittedInventory(gameType = 'rpg') {
  const p = base(gameType);
  importLibraryContent(p);
  // FIX 3 (2026-09-28): the full three-monster roster case 12 already imports is part of the
  // committed inventory too, so case 1's measurement path carries it and pins it. Imported BEFORE
  // the dialogue is placed for the reason placeCommittedDialogue's own comment gives.
  const monsterIds = importLibraryMonsters(p);
  const sayCommands = placeCommittedDialogue(p);
  return { project: p, sayCommands, monsterIds };
}

// R9's precondition: the RPG+Move+Save combination on this board was already confirmed refused by
// kernel-LO capacity (content-independent) in an earlier slice-10 session -- so this sample
// carries Save (live, via the last story-beat line's own `save` command) but never Move.
export function buildR4Sample() {
  const p = base('rpg');
  p.project.titleMap = 0;
  p.project.titleScreen = 0;
  importLibraryContent(p);
  const monsterIds = importLibraryMonsters(p); // [Slime, Bat, Skeleton], in that order
  // Grouped 3 lines/entity (8 placed actors, not 24) -- see placeCommittedDialogue's own comment:
  // this build DOES call buildProject for real, and 24 distinct actors plus a full battle roster
  // overflows kernel-lo's entity tables on this board, a separate ceiling from kernel-hi content.
  const sayCommands = placeCommittedDialogue(p, { linesPerEntity: 3 }); // placed LAST

  // Two real spells, within Hero's own baseMp (8).
  p.spells = [createSpell(0, 'Spark'), createSpell(1, 'Mend')];
  p.spells[1].kind = 'heal';
  p.spells[1].amountMin = 10;
  p.spells[1].amountMax = 10;
  p.party[0].spells = [0, 1];

  // Two real items.
  p.items = [
    { id: 0, name: 'Potion', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 20 } },
    { id: 1, name: 'Bomb', actorId: null, metaspriteId: null, effect: { kind: 'damage', amount: 10 } }
  ];

  // A realistic wandering formation: all three imported monsters.
  p.maps[0].encounters = { rate: 40, actorIds: monsterIds };

  // The last committed line (the story's resolution beat) also saves the game live.
  const lastSay = sayCommands[sayCommands.length - 1];
  const lastEntity = p.maps[0].screens.flatMap((s) => s.entities ?? []).find((e) => e.props?.event?.pages?.[0]?.commands?.includes(lastSay));
  lastEntity.props.event.pages[0].commands.push({ op: 'save' });

  return { project: p, monsterIds, sayCommands };
}

/**
 * Case 12's own trim loop (streamedceiling.test.js, "R4: report FITS/PINCH honestly"), lifted out:
 * shortens the longest dialogue line, 1 character at a time down to a 10-character floor, until
 * music+sfx+text fit under the ceiling. Returns { trimmedBytes, spare }. Only dialogue is trimmed.
 */
export function trimDialogueToFit(p, sayCommands, ceilingOf = contentCeilingBytes) {
  let cap = checkCapacity(p);
  let ceiling = ceilingOf(p);
  let sum = cap.musicBytes + cap.sfxBytes + cap.textBytes;
  let trimmedBytes = 0;
  while (sum > ceiling) {
    let longest = -1;
    let longestLen = 10;
    for (let i = 0; i < sayCommands.length; i++) {
      if (sayCommands[i].text.length > longestLen) {
        longest = i;
        longestLen = sayCommands[i].text.length;
      }
    }
    if (longest < 0) throw new Error(`content cannot be trimmed further and still overflows by ${sum - ceiling} bytes`);
    const before = checkCapacity(p).textBytes;
    sayCommands[longest].text = sayCommands[longest].text.slice(0, -1).trimEnd();
    trimmedBytes += before - checkCapacity(p).textBytes;
    cap = checkCapacity(p);
    ceiling = ceilingOf(p);
    sum = cap.musicBytes + cap.sfxBytes + cap.textBytes;
  }
  return { trimmedBytes, spare: ceiling - sum };
}
