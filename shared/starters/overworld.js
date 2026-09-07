// The overworld adventure starter (docs/design-starter-projects.md §9.1,
// ROADMAP item 8's starter-projects phase 2). No DOM, no Node API; every
// import is from shared/.

import { createProject, planLibraryImport, applyPlannedProject, LIMITS, PLAYER_TILES } from '../project.js';
import { LIBRARY_ENTRIES } from '../library/index.js';
import { metasprite } from '../library/authoring.js';
import { screenFromArt } from './authoring.js';
import { writePlayerFigure, writeDoorwayFigure, HERO_IDLE_TILES } from './figures.js';
import { BLANK_TILE } from '../chr.js';

function libraryEntry(kind, name) {
  const entry = LIBRARY_ENTRIES.find((e) => e.kind === kind && e.name === name);
  if (!entry) throw new Error(`Overworld starter: no ${kind} library entry named "${name}".`);
  return entry;
}

/** Imports `name` via planLibraryImport/applyPlannedProject and returns its report. */
function importEntry(project, kind, name) {
  const entry = libraryEntry(kind, name);
  const planned = planLibraryImport(project, entry, { tilesetId: 0 });
  if (!planned.ok) throw new Error(`Overworld starter: importing "${name}" failed: ${planned.reason}`);
  applyPlannedProject(project, planned.project);
  return planned.report;
}

function metatileIdByName(project, name) {
  const found = project.metatiles.find((m) => m.name === name);
  if (!found) throw new Error(`Overworld starter: no metatile named "${name}".`);
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

const VILLAGER_PALETTE = [0x0f, 0x1a, 0x2a, 0x30];

function buildOverworld(name) {
  const project = createProject(name, 'action');

  // Library imports, in the design's own fixed order (§9.1): each import's
  // slot/written outcome is pinned by test 15, so this order is load-bearing.
  // applyPlannedProject (shared/project.js) replaces `project.tilesets`
  // wholesale with each import's own cloned array, so nothing may hold a
  // `project.tilesets[0]` reference across an import -- it is re-read fresh
  // below, once every import is done.
  importEntry(project, 'terrain', 'Grass Plains');
  importEntry(project, 'terrain', 'Dirt Path');
  importEntry(project, 'terrain', 'Wood Planks');
  const batReport = importEntry(project, 'monster', 'Bat');
  const coinReport = importEntry(project, 'pickup', 'Coin');
  const batActorId = batReport.actor.id;
  const coinActorId = coinReport.actor.id;

  const tileset0 = project.tilesets[0];

  // The shared player figure.
  project.sprites.playerTiles = writePlayerFigure(tileset0);

  // The Villager metasprite: a copy of the player's own idle art, sprite
  // palette 3 (the one slot the imports above leave unclaimed), its own
  // distinct colours. Design §9.1 says to point this metasprite straight at
  // the player's own tiles $00-$03 ("at zero extra tile cost") -- but doing
  // that literally trips validateProject's own reserved-tile-reference
  // warning (shared/project.js:6516-6520, ROADMAP item 8's already-shipped
  // "validate-as-you-draw" feature: ANY metasprite naming a tile inside the
  // player's own $00-$1F reservation warns "will be replaced at build
  // time", with no `.slice(1)` carve-out the way the blank-tile check a few
  // lines above it has), which test 7 (zero warnings) then fails. Deviation
  // from §9.1, reported: a second, identical copy of the idle art is
  // written into its own free sprite run instead, at a real (if small) tile
  // cost §9.1 did not budget for -- see the report for the probed index.
  const villagerFirstIndex = firstFreeSpriteRun(tileset0);
  if (villagerFirstIndex === null) {
    throw new Error('Overworld starter: no free four-tile sprite run for the Villager after the library imports.');
  }
  HERO_IDLE_TILES.forEach((quadrant, index) => (tileset0.sprites.tiles[villagerFirstIndex + index] = quadrant));
  project.palettes.sprite[3] = VILLAGER_PALETTE;
  const villagerMetaspriteId = project.sprites.metasprites.length;
  project.sprites.metasprites.push(metasprite(villagerMetaspriteId, 'Villager', villagerFirstIndex, 3));
  const villagerAnimId = project.sprites.animations.length;
  project.sprites.animations.push({
    id: villagerAnimId,
    name: 'Villager idle',
    loop: true,
    frames: [{ metaspriteId: villagerMetaspriteId, duration: 30 }]
  });

  // The Doorway metasprite: the next free four-tile run after the Villager's
  // own copy above -- probed, not assumed. Design §9.1 claims index 40
  // ($28) for this; the Villager's own extra tile cost above (not budgeted
  // by §9.1) pushes it four tiles later, to 44 ($2C) -- named in the report.
  const doorwayFirstIndex = firstFreeSpriteRun(tileset0);
  if (doorwayFirstIndex === null) {
    throw new Error('Overworld starter: no free four-tile sprite run for the Doorway after the library imports.');
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

  // The Villager and Door actors -- one of each, placed twice below with
  // their own per-placement event/props, since a placement's event lives on
  // the entity, not the actor (§9.1: "both NPCs below use this same actor
  // art"). The imported Bat stays exactly as imported: already a
  // `patroller` with its own contact damage, no override needed.
  const villagerActorId = project.sprites.actors.length;
  project.sprites.actors.push({
    id: villagerActorId,
    name: 'Villager',
    behavior: 'npc',
    speed: 0,
    hp: 1,
    anims: { idle: villagerAnimId }
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

  // The Coin item -- a real, canBackItem-backed item bound directly to the
  // imported Coin actor's own id, never placed on any screen (§9.1). No
  // `effect` field: deriveItemEffect resolves it the moment saveProject
  // normalizes the project (the Coin's own battle.heal is 0, so this
  // resolves to `{kind: 'none', amount: 0}`).
  project.items = [{ id: 0, name: 'Coin', actorId: coinActorId, metaspriteId: null }];

  // The switch the Cottage villager's give page guards.
  project.switches = ['Coin given'];

  // Maps and screens.
  const grassPlain = metatileIdByName(project, 'Grass Plain');
  const dirtPlain = metatileIdByName(project, 'Dirt Plain');
  const woodPlain = metatileIdByName(project, 'Wood Planks Plain');

  const greenwoodLegend = { g: grassPlain, d: dirtPlain };
  // A vertical dirt path bisects the grass clearing, with a spur at row 3
  // leading to the Door on the east edge -- decorative only (every terrain
  // metatile in this starter is `collision: 'open'`, so nothing here needs
  // to be a barrier the way the dungeon starter's own walls will).
  const greenwoodRows = [];
  for (let row = 0; row < LIMITS.screenRows; row++) {
    if (row === 3) {
      greenwoodRows.push('gggggggg' + 'ddddddd' + 'g');
    } else {
      greenwoodRows.push('gggggggg' + 'd' + 'ggggggg');
    }
  }
  const greenwood = { name: '', boundTiles: [], ...screenFromArt(greenwoodRows, greenwoodLegend) };

  const cottageLegend = { w: woodPlain };
  const cottageRows = Array.from({ length: LIMITS.screenRows }, () => 'w'.repeat(LIMITS.screenCols));
  const cottage = { name: '', boundTiles: [], ...screenFromArt(cottageRows, cottageLegend) };

  const titleLegend = { g: grassPlain };
  const titleRows = Array.from({ length: LIMITS.screenRows }, () => 'g'.repeat(LIMITS.screenCols));
  const title = { name: '', boundTiles: [], ...screenFromArt(titleRows, titleLegend) };

  greenwood.entities = [
    { actorId: batActorId, x: 96, y: 80, props: {} },
    {
      actorId: villagerActorId,
      x: 160,
      y: 96,
      props: {
        trigger: 'interact',
        event: {
          pages: [
            {
              cond: { type: 'none', arg: 0 },
              commands: [
                { op: 'say', text: 'Which way did the old bridge go?' },
                {
                  op: 'choice',
                  options: [
                    {
                      text: 'North, past the mill',
                      commands: [
                        {
                          op: 'say',
                          text: 'The trader nods.\n\nThe crossing there still holds, they say -- go on and see for yourself.'
                        }
                      ]
                    },
                    {
                      text: 'South, through the ravine',
                      commands: [
                        {
                          op: 'say',
                          text: 'The trader shakes their head.\n\nThat path washed out years ago, and nobody has fixed it since.'
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    },
    {
      actorId: doorActorId,
      x: 224,
      y: 48,
      props: { toScreen: 1, toX: 32, toY: 176, trigger: 'touch' }
    }
  ];

  cottage.entities = [
    {
      actorId: villagerActorId,
      x: 128,
      y: 96,
      props: {
        trigger: 'interact',
        event: {
          pages: [
            {
              cond: { type: 'switchOff', arg: 0 },
              commands: [
                { op: 'say', text: 'The villager presses a coin into your hand.' },
                { op: 'give', item: 0 },
                { op: 'setSwitch', switch: 0 }
              ]
            },
            { cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'The villager has nothing more to give.' }] }
          ]
        }
      }
    },
    {
      actorId: doorActorId,
      x: 32,
      y: 48,
      props: { toScreen: 0, toX: 64, toY: 176, trigger: 'touch' }
    }
  ];

  const mapDefaults = () => ({ battleSkyTile: 0, battleGroundTile: 0, encounters: { rate: 0, actorIds: [] }, folder: null });
  project.maps = [
    { id: 0, name: 'Greenwood', gridW: 1, gridH: 1, screens: [greenwood], songId: null, tilesetId: 0, ...mapDefaults() },
    { id: 1, name: 'Cottage', gridW: 1, gridH: 1, screens: [cottage], songId: null, tilesetId: 0, ...mapDefaults() },
    { id: 2, name: 'Title', gridW: 1, gridH: 1, screens: [title], songId: null, tilesetId: 0, ...mapDefaults() }
  ];
  project.project.titleMap = 2;
  project.project.titleScreen = 0;
  project.project.startMap = 0;
  project.project.startScreen = 0;
  project.project.startX = 48;
  project.project.startY = 192;

  return project;
}

export default {
  id: 'overworld',
  label: 'Overworld adventure',
  hint:
    'A small village and a cottage to explore, starting on NROM -- a wandering Bat, a trader with a ' +
    'question, and a coin to earn.',
  gameType: 'action',
  build: buildOverworld
};
