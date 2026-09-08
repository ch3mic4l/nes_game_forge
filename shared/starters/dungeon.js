// The dungeon crawl starter (docs/design-starter-projects.md §9.2,
// ROADMAP item 8's starter-projects phase 3). No DOM, no Node API; every
// import is from shared/.

import { createProject, planLibraryImport, applyPlannedProject, unusedMetatileSlots, LIMITS, PLAYER_TILES } from '../project.js';
import { LIBRARY_ENTRIES } from '../library/index.js';
import { tile, metasprite } from '../library/authoring.js';
import { screenFromArt } from './authoring.js';
import { writePlayerFigure, writeDoorwayFigure } from './figures.js';
import { BLANK_TILE } from '../chr.js';

function libraryEntry(kind, name) {
  const entry = LIBRARY_ENTRIES.find((e) => e.kind === kind && e.name === name);
  if (!entry) throw new Error(`Dungeon starter: no ${kind} library entry named "${name}".`);
  return entry;
}

/** Imports `name` via planLibraryImport/applyPlannedProject and returns its report. */
function importEntry(project, kind, name) {
  const entry = libraryEntry(kind, name);
  const planned = planLibraryImport(project, entry, { tilesetId: 0 });
  if (!planned.ok) throw new Error(`Dungeon starter: importing "${name}" failed: ${planned.reason}`);
  applyPlannedProject(project, planned.project);
  return planned.report;
}

function metatileIdByName(project, name) {
  const found = project.metatiles.find((m) => m.name === name);
  if (!found) throw new Error(`Dungeon starter: no metatile named "${name}".`);
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

/** The first still-blank background tile at or past index 1 (index 0 backs the default "Empty" metatile). */
function firstFreeBackgroundTile(tileset) {
  const tiles = tileset.background.tiles;
  for (let i = 1; i < tiles.length; i++) {
    if (tiles[i] === BLANK_TILE) return i;
  }
  return null;
}

/** The smallest still-pristine, unreferenced metatile id, or null. Mirrors planTerrainImport's own claim logic. */
function firstFreeMetatileId(project) {
  const unused = unusedMetatileSlots(project);
  const id = Object.keys(unused)
    .map(Number)
    .find((candidateId) => unused[candidateId]);
  return id === undefined ? null : id;
}

// A small, simple brick pattern: mortar rows (2) alternating with brick rows
// (1/2), one 8x8 tile reused for all four quadrants of the Wall metatile --
// original pixels, on Stone Floor's own background palette slot (§9.2: the
// substitute and the painted cell must share a palette group for the
// switch-bound swap below to be legal at all).
const WALL_BRICK_ROWS = ['22222222', '21212121', '22222222', '12121212', '22222222', '21212121', '22222222', '12121212'];

function buildDungeon(name) {
  const project = createProject(name, 'action');

  // Library imports, in the design's own fixed order (§9.2): each import's
  // slot/written outcome is pinned by test 15, so this order is load-bearing.
  // applyPlannedProject (shared/project.js) replaces `project.tilesets`
  // wholesale with each import's own cloned array, so nothing may hold a
  // `project.tilesets[0]` reference across an import -- it is re-read fresh
  // below, once every import is done.
  importEntry(project, 'terrain', 'Stone Floor');
  const skeletonReport = importEntry(project, 'monster', 'Skeleton');
  const batReport = importEntry(project, 'monster', 'Bat');
  const keyReport = importEntry(project, 'pickup', 'Key');
  const potionReport = importEntry(project, 'pickup', 'Potion');
  const skeletonActorId = skeletonReport.actor.id;
  const batActorId = batReport.actor.id;
  const keyActorId = keyReport.actor.id;
  const potionActorId = potionReport.actor.id;

  const tileset0 = project.tilesets[0];

  // The shared player figure.
  project.sprites.playerTiles = writePlayerFigure(tileset0);

  // The Skeleton is deliberately overridden to a chaser -- a boss that
  // hunts the player reads as a real threat in the room it is finally
  // reached in, which the imported default (patroller) would not. Nothing
  // else about the imported actor changes (hp 8, damage 2 stay as
  // imported).
  project.sprites.actors[skeletonActorId].behavior = 'chaser';

  // The Doorway metasprite: the first free four-tile run after the four
  // library imports above, on sprite palette 2 -- the slot Key/Potion's own
  // imports claimed, reused rather than claimed fresh.
  const doorwayFirstIndex = firstFreeSpriteRun(tileset0);
  if (doorwayFirstIndex === null) {
    throw new Error('Dungeon starter: no free four-tile sprite run for the Doorway after the library imports.');
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

  // The key mechanism: a hand-authored npc whose idle art is the imported
  // Key pickup's own animation -- no art authored here, only reused.
  const keyActor = project.sprites.actors[keyActorId];
  const keyMechanismActorId = project.sprites.actors.length;
  project.sprites.actors.push({
    id: keyMechanismActorId,
    name: 'Key pedestal',
    behavior: 'npc',
    speed: 0,
    hp: 1,
    anims: { idle: keyActor.anims.idle }
  });

  // The Wall metatile (§9.2): a small brick tile authored directly into
  // tileset 0's background table at the first free index past Stone
  // Floor's own imported tiles, on Stone Floor Plain's own palette slot --
  // required, not cosmetic: validateProject refuses a switch-bound
  // substitute whose palette differs from what is painted at that cell.
  const wallTileIndex = firstFreeBackgroundTile(tileset0);
  if (wallTileIndex === null) {
    throw new Error('Dungeon starter: no free background tile for the Wall brick art.');
  }
  tileset0.background.tiles[wallTileIndex] = tile(WALL_BRICK_ROWS);

  const stoneFloorPlainId = metatileIdByName(project, 'Stone Floor Plain');
  const stoneFloorPalette = project.metatiles[stoneFloorPlainId].palette;
  const wallId = firstFreeMetatileId(project);
  if (wallId === null) {
    throw new Error('Dungeon starter: no free metatile slot for the Wall.');
  }
  project.metatiles[wallId] = {
    id: wallId,
    name: 'Wall',
    tiles: [wallTileIndex, wallTileIndex, wallTileIndex, wallTileIndex],
    palette: stoneFloorPalette,
    collision: 'solid'
  };

  // The switch the key mechanism's give page guards, and the row-7 gap's
  // own boundTiles entry substitutes on.
  project.switches = ['Wall opened'];

  // The Key item -- a key item, kind 'none' (CLAUDE.md's own "an item's own
  // effect... none... a key item" line), bound directly to the imported
  // Key pickup's own actor id (never placed on any screen). The Potion --
  // placed for real, in the Boss Chamber -- keeps its own imported heal
  // amount explicit rather than left to normalizeItem's own migration.
  project.items = [
    { id: 0, name: 'Key', actorId: keyActorId, metaspriteId: null, effect: { kind: 'none', amount: 0 } },
    { id: 1, name: 'Potion', actorId: potionActorId, metaspriteId: null, effect: { kind: 'heal', amount: 20 } }
  ];

  // Screens.
  const wallChar = 'W';
  const floorChar = '.';
  const legend = { [wallChar]: wallId, [floorChar]: stoneFloorPlainId };

  const cols = LIMITS.screenCols;
  const openRow = wallChar + floorChar.repeat(cols - 2) + wallChar;
  const solidRow = wallChar.repeat(cols);
  const GAP_COL = 8;
  const lockedRow = wallChar.repeat(GAP_COL) + floorChar + wallChar.repeat(cols - GAP_COL - 1);

  // Dungeon Entrance: a full wall spanning the room, with the locked cell
  // (row 7, col 8) as its only gap -- a real barrier, not a single blocked
  // cell (§9.2: move_vertical_probe only probes the player's own leading
  // body edge, so an isolated solid cell is not a barrier at all).
  const entranceRows = [solidRow, ...Array(6).fill(openRow), lockedRow, ...Array(6).fill(openRow), solidRow];
  const entrance = { name: '', boundTiles: [], ...screenFromArt(entranceRows, legend) };
  // The gap's own STORED base value is Wall; the boundTiles entry is what
  // resolves it to floor once switch 0 is set (engine/screens.asm's
  // bound_tile_lookup, read on the collision path too, not only the draw
  // path).
  entrance.metatiles[7 * cols + GAP_COL] = wallId;
  entrance.boundTiles = [{ switchId: 0, row: 7, col: GAP_COL, metatileId: stoneFloorPlainId }];

  // Key Hall and Boss Chamber: the same bordered shape, outer ring Wall,
  // interior Stone Floor Plain, no row-7 wall.
  const borderedRows = [solidRow, ...Array(LIMITS.screenRows - 2).fill(openRow), solidRow];
  const keyHall = { name: '', boundTiles: [], ...screenFromArt(borderedRows, legend) };
  const bossChamber = { name: '', boundTiles: [], ...screenFromArt(borderedRows, legend) };

  // Title: interior floor only, no border -- kept simple.
  const titleRows = Array.from({ length: LIMITS.screenRows }, () => floorChar.repeat(cols));
  const title = { name: '', boundTiles: [], ...screenFromArt(titleRows, { [floorChar]: stoneFloorPlainId }) };

  // Placements, exactly §9.2's own table. Flat screen indices follow map
  // order below: Entrance 0, Key Hall 1, Boss Chamber 2, Title 3.
  const ENTRANCE = 0;
  const KEY_HALL = 1;
  const BOSS_CHAMBER = 2;

  entrance.entities = [
    { actorId: doorActorId, x: 208, y: 48, props: { toScreen: KEY_HALL, toX: 32, toY: 112, trigger: 'touch' } },
    { actorId: doorActorId, x: 128, y: 160, props: { toScreen: BOSS_CHAMBER, toX: 128, toY: 112, trigger: 'touch' } }
  ];

  keyHall.entities = [
    { actorId: doorActorId, x: 32, y: 96, props: { toScreen: ENTRANCE, toX: 208, toY: 80, trigger: 'touch' } },
    // The Bat, imported but never given a placement by §9.2's own table (a
    // design gap this starter resolves -- see the report). Placed at the
    // leftmost interior column: a patroller always spawns facing down
    // (engine/entities.asm's spawn_entities) and entity_patrol only ever
    // steps along its current axis, reversing at a wall -- so this Bat
    // patrols straight up and down column x=16 for as long as the screen is
    // loaded, 16 pixels clear of the key mechanism's own touch line at
    // x=32..128, y=112 (smoke step 16c's own walk) on the x-axis alone,
    // which is already >= TOUCH_RANGE (12) regardless of the Bat's own y at
    // any given frame.
    { actorId: batActorId, x: 16, y: 48, props: {} },
    {
      actorId: keyMechanismActorId,
      x: 128,
      y: 112,
      props: {
        trigger: 'touch',
        hideSwitch: 0,
        event: {
          pages: [
            {
              cond: { type: 'switchOff', arg: 0 },
              commands: [
                { op: 'say', text: 'The pedestal gives up its key, and somewhere a wall grinds open.' },
                { op: 'give', item: 0 },
                { op: 'setSwitch', switch: 0 },
                { op: 'visible', state: 'hidden' }
              ]
            },
            { cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Just an empty pedestal now.' }] }
          ]
        }
      }
    }
  ];

  bossChamber.entities = [
    { actorId: skeletonActorId, x: 128, y: 192, props: {} },
    { actorId: potionActorId, x: 128, y: 64, props: {} },
    { actorId: doorActorId, x: 192, y: 64, props: { toScreen: ENTRANCE, toX: 192, toY: 176, trigger: 'touch' } }
  ];

  // Maps.
  const mapDefaults = () => ({ battleSkyTile: 0, battleGroundTile: 0, encounters: { rate: 0, actorIds: [] }, folder: null });
  project.maps = [
    { id: 0, name: 'Dungeon Entrance', gridW: 1, gridH: 1, screens: [entrance], songId: null, tilesetId: 0, ...mapDefaults(), folder: 'Dungeon' },
    { id: 1, name: 'Key Hall', gridW: 1, gridH: 1, screens: [keyHall], songId: null, tilesetId: 0, ...mapDefaults(), folder: 'Dungeon' },
    { id: 2, name: 'Boss Chamber', gridW: 1, gridH: 1, screens: [bossChamber], songId: null, tilesetId: 0, ...mapDefaults(), folder: 'Dungeon' },
    { id: 3, name: 'Title', gridW: 1, gridH: 1, screens: [title], songId: null, tilesetId: 0, ...mapDefaults() }
  ];
  project.project.titleMap = 3;
  project.project.titleScreen = 0;
  project.project.startMap = 0;
  project.project.startScreen = 0;
  project.project.startX = 32;
  project.project.startY = 48;

  return project;
}

export default {
  id: 'dungeon',
  label: 'Dungeon crawl',
  hint:
    'Interior rooms linked by doors, on NROM -- a wall locked behind a switch a key sets, and a ' +
    'chasing Skeleton guarding a healing potion.',
  gameType: 'action',
  build: buildDungeon
};
