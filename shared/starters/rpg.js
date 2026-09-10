// The turn-based RPG starter (docs/design-starter-projects.md §9.3,
// ROADMAP item 8's starter-projects phase 4). No DOM, no Node API; every
// import is from shared/.

import { createProject, planLibraryImport, applyPlannedProject, createPartyMember, createSpell, LIMITS, PLAYER_TILES } from '../project.js';
import { LIBRARY_ENTRIES } from '../library/index.js';
import { split16, metasprite } from '../library/authoring.js';
import { screenFromArt } from './authoring.js';
import { writePlayerFigure, writeDoorwayFigure, HERO_IDLE_TILES } from './figures.js';
import { BLANK_TILE } from '../chr.js';

function libraryEntry(kind, name) {
  const entry = LIBRARY_ENTRIES.find((e) => e.kind === kind && e.name === name);
  if (!entry) throw new Error(`RPG starter: no ${kind} library entry named "${name}".`);
  return entry;
}

/** Imports `name` via planLibraryImport/applyPlannedProject and returns its report. */
function importEntry(project, kind, name) {
  const entry = libraryEntry(kind, name);
  const planned = planLibraryImport(project, entry, { tilesetId: 0 });
  if (!planned.ok) throw new Error(`RPG starter: importing "${name}" failed: ${planned.reason}`);
  applyPlannedProject(project, planned.project);
  return planned.report;
}

function metatileIdByName(project, name) {
  const found = project.metatiles.find((m) => m.name === name);
  if (!found) throw new Error(`RPG starter: no metatile named "${name}".`);
  return found.id;
}

/** The first free four-tile run at or past `PLAYER_TILES`, or null. */
function firstFreeSpriteRun(tileset) {
  const sprites = tileset.sprites.tiles;
  for (let i = PLAYER_TILES; i + 3 < sprites.length; i++) {
    if ([0, 1, 2, 3].every((offset) => sprites[i + offset] === BLANK_TILE)) return i;
  }
  return null;
}

// A small, procedurally-generated hooded figure -- original pixels, distinct
// from both HERO (figures.js) and the Doorway: a pointed hood tip, a rounded
// head/shoulders band with a face highlight, then a straight-sided robe.
// Shared by all three Village NPCs (Saver, Innkeeper, Ally recruit) the same
// way the dungeon starter's key mechanism reuses the imported Key's own
// idle animation (shared/starters/dungeon.js) -- there is no player *actor*
// with its own anims.idle to reuse the identical way here (the player is
// drawn directly from project.sprites.playerTiles, never through an actor
// record), so this is the "otherwise" branch: one small shared frame,
// authored once.
function npcRows() {
  const rows = [];
  for (let y = 0; y < 16; y++) {
    let row = '';
    for (let x = 0; x < 16; x++) {
      const cx = x - 7.5;
      const cy = y - 7.5;
      const r = Math.sqrt(cx * cx + cy * cy);
      if (y < 3) {
        row += Math.abs(cx) <= 1 ? '1' : '0';
      } else if (y < 9) {
        if (r > 6.5) row += '0';
        else if (r > 5.5) row += '1';
        else if (y >= 5 && y <= 6 && Math.abs(cx) <= 2) row += '3';
        else row += '2';
      } else {
        if (Math.abs(cx) > 5.5) row += '0';
        else if (Math.abs(cx) > 4.5) row += '1';
        else row += '3';
      }
    }
    rows.push(row);
  }
  return rows;
}

const NPC_TILES = split16(npcRows());

function buildRpg(name) {
  const project = createProject(name, 'rpg');

  // Library imports, in the design's own fixed order (§9.3): each import's
  // slot/written outcome is pinned by test 15, so this order is load-bearing.
  // applyPlannedProject (shared/project.js) replaces `project.tilesets`
  // wholesale with each import's own cloned array, so nothing may hold a
  // `project.tilesets[0]` reference across an import -- it is re-read fresh
  // below, once every import is done.
  importEntry(project, 'terrain', 'Grass Plains');
  importEntry(project, 'terrain', 'Dirt Path');
  importEntry(project, 'terrain', 'Stone Floor');
  const slimeReport = importEntry(project, 'monster', 'Slime');
  const batReport = importEntry(project, 'monster', 'Bat');
  const potionReport = importEntry(project, 'pickup', 'Potion');
  const slimeActorId = slimeReport.actor.id;
  const batActorId = batReport.actor.id;
  const potionActorId = potionReport.actor.id;

  const tileset0 = project.tilesets[0];

  // The shared player figure.
  project.sprites.playerTiles = writePlayerFigure(tileset0);

  // The Doorway metasprite: the first free four-tile run after the three
  // actor imports above, on sprite palette 2 -- the slot Potion's own import
  // claimed, reused rather than claimed fresh.
  const doorwayFirstIndex = firstFreeSpriteRun(tileset0);
  if (doorwayFirstIndex === null) {
    throw new Error('RPG starter: no free four-tile sprite run for the Doorway after the library imports.');
  }
  writeDoorwayFigure(tileset0, doorwayFirstIndex);
  const doorwayMetaspriteId = project.sprites.metasprites.length;
  project.sprites.metasprites.push(metasprite(doorwayMetaspriteId, 'Doorway', doorwayFirstIndex, 2));
  const doorwayAnimId = project.sprites.animations.length;
  project.sprites.animations.push({
    id: doorwayAnimId,
    name: 'Doorway idle',
    loop: true,
    frames: [{ metaspriteId: doorwayMetaspriteId, duration: 30 }]
  });

  const doorActorId = project.sprites.actors.length;
  project.sprites.actors.push({
    id: doorActorId,
    name: 'Door',
    behavior: 'door',
    speed: 1,
    hp: 1,
    anims: { idle: doorwayAnimId }
  });

  // The shared NPC frame: the next free four-tile run after the Doorway, on
  // sprite palette 0 -- never overwritten by an import (reservedPaletteSlots
  // reserves sprite slot 0 for the player), so its colours are stable and
  // distinct from Slime/Bat's own "Creature" palette (slot 1) and Potion's
  // "Item" palette (slot 2). Done before the tileset-1 copy below, so it
  // mirrors there too, exactly like the player and Doorway art.
  const npcFirstIndex = firstFreeSpriteRun(tileset0);
  if (npcFirstIndex === null) {
    throw new Error('RPG starter: no free four-tile sprite run for the shared NPC frame after the Doorway.');
  }
  NPC_TILES.forEach((quadrant, index) => (tileset0.sprites.tiles[npcFirstIndex + index] = quadrant));
  const npcMetaspriteId = project.sprites.metasprites.length;
  project.sprites.metasprites.push(metasprite(npcMetaspriteId, 'Villager', npcFirstIndex, 0));
  const npcAnimId = project.sprites.animations.length;
  project.sprites.animations.push({
    id: npcAnimId,
    name: 'Villager idle',
    loop: true,
    frames: [{ metaspriteId: npcMetaspriteId, duration: 30 }]
  });

  // The Hero battle metasprite. Design §9.3 says to point this straight at
  // the player's own tiles $00-$03 ("referencing tiles 0-3 directly works")
  // -- but doing that literally trips validateProject's own reserved-tile-
  // reference warning (shared/project.js, the same ROADMAP item 8
  // "validate-as-you-draw" check overworld.js's own Villager comment
  // already documents hitting: ANY metasprite naming a tile inside the
  // player's own $00-$1F reservation warns "will be replaced at build
  // time", with no carve-out for this exact "the player's own reserved
  // range is deliberately never refused as artwork" argument), which test
  // 7 (zero warnings) then fails. Deviation from §9.3, reported: a second,
  // identical copy of the idle art is written into its own free sprite run
  // instead, at a real (if small) tile cost §9.3 did not budget for --
  // exactly the fix overworld.js's own Villager already applies, and
  // exactly what tools/make-rpg-sample.js's own HERO-at-$20 idiom already
  // does for the identical reason (design §9.3 called that duplication
  // "unnecessary here", which this probe disproves). Written and mirrored
  // BEFORE the tileset-1 copy below, so it reaches the Battle tileset too
  // -- unlike playerTiles' own $00-$1F range, this new index is outside
  // generateAssets' own per-tileset player restamp, so nothing else would
  // mirror it.
  const heroFirstIndex = firstFreeSpriteRun(tileset0);
  if (heroFirstIndex === null) {
    throw new Error('RPG starter: no free four-tile sprite run for the Hero battle portrait after the NPC frame.');
  }
  HERO_IDLE_TILES.forEach((quadrant, index) => (tileset0.sprites.tiles[heroFirstIndex + index] = quadrant));
  const heroMetaspriteId = project.sprites.metasprites.length;
  project.sprites.metasprites.push(metasprite(heroMetaspriteId, 'Hero', heroFirstIndex, 0));

  // The battle-tileset sprite copy, done LAST -- after every import and
  // after the player, Doorway, NPC and Hero-portrait art are all written
  // into tileset 0 (design §9.3, round-1 finding 2): battle rendering
  // switches the whole CHR bank to BATTLE_TILESET before drawing anything
  // (engine/battle.asm), and a sprite-fallback monster (Slime and Bat both
  // keep battle.battleTile: null) draws its own art out of THAT bank
  // (engine/battleui.asm's battle_sprite_mon), which would otherwise be
  // nothing this starter ever wrote there. One copy, one statement.
  // Background art is not copied: neither monster declares block art, so
  // nothing this starter's battles draw ever reads tileset 1's background
  // table -- map.battleSkyTile/battleGroundTile stay at createMap's own
  // default (0, BLANK_TILE, a plain backdrop).
  project.tilesets[1].sprites.tiles = project.tilesets[0].sprites.tiles.slice();

  // Spells: one, hand-authored -- the library has no "spell" kind at all.
  project.spells = [{ ...createSpell(0, 'Ember'), mpCost: 3, kind: 'damage', amountMin: 6, amountMax: 6, element: 'fire', scope: 'one' }];

  // The party: member 0 is createProject's own default Hero, given a real
  // spell and a real battle portrait; member 1 is Ally, hand-authored,
  // recruited on the field via a join command, sharing the identical
  // battle portrait -- nothing requires a party member's own portrait to
  // be unique, and authoring a second figure just for Ally would be new
  // art this starter does not need. Both opt into naming (docs/design-name-
  // entry.md v16.4 §1 item 4, §17 item 5) -- the RPG starter's own decision,
  // per that design item; no other starter opts in.
  project.party[0] = { ...project.party[0], renamable: true, spells: [{ spellId: 0, level: 1 }], metaspriteId: heroMetaspriteId };
  project.party.push({ ...createPartyMember(1, 'Ally'), startsInParty: false, renamable: true, metaspriteId: heroMetaspriteId, spells: [] });

  // The switch the Ally recruit's join event sets, and hides herself on
  // (the overworld.js idiom).
  project.switches = ['Ally recruited'];

  // The three hand-authored Village NPCs, sharing the one Villager idle art
  // above -- each their own actor, since a placement's event lives on the
  // entity, not the actor.
  const saverActorId = project.sprites.actors.length;
  project.sprites.actors.push({ id: saverActorId, name: 'Saver', behavior: 'npc', speed: 0, hp: 1, damage: 0, anims: { idle: npcAnimId } });
  const innkeeperActorId = project.sprites.actors.length;
  project.sprites.actors.push({
    id: innkeeperActorId,
    name: 'Innkeeper',
    behavior: 'npc',
    speed: 0,
    hp: 1,
    damage: 0,
    anims: { idle: npcAnimId }
  });
  const allyActorId = project.sprites.actors.length;
  project.sprites.actors.push({ id: allyActorId, name: 'Ally', behavior: 'npc', speed: 0, hp: 1, damage: 0, anims: { idle: npcAnimId } });

  // The Potion item -- bound directly to the imported Potion's own actor
  // id, its own explicit heal amount stated rather than left to
  // normalizeItem's own migration.
  project.items = [{ id: 0, name: 'Potion', actorId: potionActorId, metaspriteId: null, effect: { kind: 'heal', amount: 20 } }];

  // Screens.
  const stoneFloorPlainId = metatileIdByName(project, 'Stone Floor Plain');
  const stoneFloorEdgeId = metatileIdByName(project, 'Stone Floor Edge');
  const grassPlainId = metatileIdByName(project, 'Grass Plain');
  const dirtPlainId = metatileIdByName(project, 'Dirt Plain');

  const cols = LIMITS.screenCols;
  const rows = LIMITS.screenRows;

  // Village: a Stone Floor Plain interior with a Stone Floor Edge border --
  // both metatiles are collision 'open', so this is decoration, not a
  // barrier (design §9's own "the open, no-border screens... need no wall"
  // passage applies here regardless).
  const villageLegend = { e: stoneFloorEdgeId, '.': stoneFloorPlainId };
  const villageRows = [];
  for (let row = 0; row < rows; row++) {
    if (row === 0 || row === rows - 1) villageRows.push('e'.repeat(cols));
    else villageRows.push('e' + '.'.repeat(cols - 2) + 'e');
  }
  const village = { name: '', boundTiles: [], ...screenFromArt(villageRows, villageLegend) };

  // Field: a Grass Plains interior with a Dirt Path strip.
  const fieldLegend = { g: grassPlainId, d: dirtPlainId };
  const fieldRows = [];
  for (let row = 0; row < rows; row++) {
    fieldRows.push('g'.repeat(8) + 'd' + 'g'.repeat(cols - 9));
  }
  const field = { name: '', boundTiles: [], ...screenFromArt(fieldRows, fieldLegend) };

  // Title: plain floor.
  const titleRows = Array.from({ length: rows }, () => '.'.repeat(cols));
  const title = { name: '', boundTiles: [], ...screenFromArt(titleRows, { '.': stoneFloorPlainId }) };

  // Placements, exactly §9.3's own table. Flat screen indices follow map
  // order below: Village 0, Field 1, Title 2.
  const VILLAGE = 0;
  const FIELD = 1;

  village.entities = [
    { actorId: saverActorId, x: 64, y: 64, props: { trigger: 'interact', event: { pages: [buildSaverPage()] } } },
    { actorId: innkeeperActorId, x: 192, y: 64, props: { trigger: 'interact', event: { pages: [buildInnkeeperPage()] } } },
    // Two pages, the dungeon key-mechanism idiom (shared/starters/dungeon.js's
    // own key pedestal): `hideSwitch` is read only once, when spawn_entities
    // places the screen's own entities at load time (engine/entities.asm) --
    // closing the message box never re-runs that placement, so Ally stays
    // `ent_active` on the Village for the rest of this visit even after her
    // join sets switch 0, and do_talk (engine/input.asm) finds her again on
    // the very next interact press. A single unguarded page would therefore
    // run the join a second time, in the same visit, before the player ever
    // leaves the screen and lets hideSwitch take effect on the next load --
    // `hidden is enough` is true only across a screen change, never within
    // one. The guarded give-then-fallback page here is what actually stops
    // the repeat; hideSwitch on the placement is still what removes her on
    // re-entry.
    {
      actorId: allyActorId,
      x: 128,
      y: 32,
      props: { trigger: 'interact', hideSwitch: 0, event: { pages: buildAllyPages() } }
    },
    { actorId: doorActorId, x: 224, y: 112, props: { toScreen: FIELD, toX: 192, toY: 176, trigger: 'touch' } }
  ];

  field.entities = [
    { actorId: potionActorId, x: 192, y: 64, props: {} },
    { actorId: doorActorId, x: 32, y: 112, props: { toScreen: VILLAGE, toX: 128, toY: 208, trigger: 'touch' } }
  ];

  // Maps.
  const mapDefaults = () => ({ battleSkyTile: 0, battleGroundTile: 0, encounters: { rate: 0, actorIds: [] }, folder: null });
  project.maps = [
    { id: 0, name: 'Village', gridW: 1, gridH: 1, screens: [village], songId: null, tilesetId: 0, ...mapDefaults() },
    {
      id: 1,
      name: 'Field',
      gridW: 1,
      gridH: 1,
      screens: [field],
      songId: null,
      tilesetId: 0,
      ...mapDefaults(),
      encounters: { rate: 20, actorIds: [slimeActorId, batActorId] }
    },
    { id: 2, name: 'Title', gridW: 1, gridH: 1, screens: [title], songId: null, tilesetId: 0, ...mapDefaults() }
  ];
  project.project.titleMap = 2;
  project.project.titleScreen = 0;
  project.project.startMap = 0;
  project.project.startScreen = 0;
  project.project.startX = 48;
  project.project.startY = 176;

  return project;
}

function buildSaverPage() {
  return {
    cond: { type: 'none', arg: 0 },
    commands: [{ op: 'say', text: 'Rest easy -- your journey is recorded here.' }, { op: 'save' }]
  };
}

function buildInnkeeperPage() {
  return {
    cond: { type: 'none', arg: 0 },
    commands: [{ op: 'say', text: 'You look tired. Rest here a while.' }, { op: 'heal', value: 255 }]
  };
}

function buildAllyPages() {
  return [
    {
      cond: { type: 'switchOff', arg: 0 },
      commands: [
        { op: 'say', text: "I've been waiting for someone headed to the Field. Let me come with you." },
        { op: 'join', member: 1 },
        { op: 'setSwitch', switch: 0 }
      ]
    },
    { cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Ready when you are.' }] }
  ];
}

// Capacity note for a future edit, not a code change: buildRpg's own output
// leaves 384 bytes free in kernel-lo on MMC1 (measured via kernelCodeBytes/
// kernelTableBytes); one live Move command (MOVE_KERNEL_ALLOWANCE, 395
// bytes) would already be refused by 11 bytes.
export default {
  id: 'rpg',
  label: 'Turn-based RPG',
  hint:
    'A village with a save point, an inn and a recruit, starting on MMC1 -- a Field with a wandering ' +
    'Slime or Bat to fight, and a Potion to find.',
  gameType: 'rpg',
  build: buildRpg
};
