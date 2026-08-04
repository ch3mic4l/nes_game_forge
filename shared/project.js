// The Forge project data model.
//
// A project lives on disk as a folder of JSON files (see main/project-io.js) but
// is a single plain object in memory. This module owns the schema, the engine
// limits every Forge validates against, and normalisation of loaded data so a
// hand-edited or older project never crashes the UI.

import { BLANK_TILE } from './chr.js';
import { normalizeSong } from './audio.js';
import {
  DEFAULT_MAPPER,
  resolveMapper,
  mapperById,
  mirroringOptions,
  tilesetLimit,
  rpgCapable,
  rpgUnsupportedReason,
  defaultMapperFor
} from './cartridge.js';
import {
  FONT_BASE,
  HEART_FULL_TILE,
  SPRITE_ARROW_TILE,
  fontBankSplit,
  projectUsesText,
  projectUsesCombat
} from './font.js';

export const ENGINE_VERSION = 1;
export const PROJECT_FORMAT = 1;

/** Hard limits imposed by the NES and by the template engine. */
export const LIMITS = {
  tilesPerTable: 256,
  metatiles: 64,
  screenCols: 16, // metatiles across a screen (16 * 16px = 256px)
  screenRows: 15, // metatiles down a screen (15 * 16px = 240px)
  mapGrid: 4, // screens per axis
  entitiesPerScreen: 8,
  palettes: 4,
  metaspriteTiles: 16,
  animationFrames: 32
};

export const SCREEN_METATILES = LIMITS.screenCols * LIMITS.screenRows; // 240

/** Collision behaviours a metatile can carry. Index is what the engine sees. */
export const COLLISION_TYPES = [
  { id: 'open', label: 'Open', color: 'transparent' },
  { id: 'solid', label: 'Solid', color: 'rgba(255,70,90,0.55)' },
  { id: 'water', label: 'Water', color: 'rgba(70,140,255,0.5)' },
  { id: 'damage', label: 'Damage', color: 'rgba(255,160,40,0.55)' },
  { id: 'warp', label: 'Warp', color: 'rgba(180,90,255,0.55)' }
];

export const collisionIndex = (id) => Math.max(0, COLLISION_TYPES.findIndex((t) => t.id === id));

/**
 * Behaviours the template engine implements for placed actors. The order is the
 * wire format: `BEH_*` in engine/constants.asm is this list written down, so a
 * new behaviour is appended here and there in the same change.
 */
export const BEHAVIORS = [
  { id: 'player', label: 'Player start' },
  { id: 'patroller', label: 'Patroller' },
  { id: 'chaser', label: 'Chaser' },
  { id: 'pickup', label: 'Pickup' },
  { id: 'door', label: 'Door / warp' },
  { id: 'npc', label: 'NPC / prop (stands still)' }
];

/**
 * The animation an actor draws, chosen by which way it is facing. Every one of
 * these is read by the engine (`actor_anim_dir`, four entries per actor, with
 * left and right sharing `walkSide`); an unset slot falls back to `idle`.
 * Nothing speculative lives here — a slot the engine does not draw would be a
 * field in the Sprite Forge that quietly does nothing.
 */
export const ANIM_SLOTS = [
  { id: 'idle', label: 'Idle animation' },
  { id: 'walkDown', label: 'Facing down' },
  { id: 'walkUp', label: 'Facing up' },
  { id: 'walkSide', label: 'Facing sideways' }
];

/** Buttons the Controller Forge can bind. */
export const BUTTONS = ['A', 'B', 'SELECT', 'START'];

/** Engine actions a button can be bound to. */
export const ACTIONS = [
  { id: 'none', label: 'Nothing' },
  { id: 'attack', label: 'Attack' },
  { id: 'interact', label: 'Interact / talk' },
  { id: 'dash', label: 'Dash' },
  { id: 'item', label: 'Use item' },
  { id: 'pause', label: 'Pause menu' },
  { id: 'cancel', label: 'Cancel / back' },
  { id: 'confirm', label: 'Confirm' }
];

/**
 * Game states that can carry their own button mapping. The order is the wire
 * format — `generate.js` emits one row of `input_actions` per state and the
 * engine indexes it with `game_state * NUM_BUTTONS`, so `ST_*` in
 * engine/constants.asm is this list written down. **Append only.**
 */
export const INPUT_STATES = ['gameplay', 'menu', 'dialog', 'title', 'gameover', 'battle'];

/**
 * What kind of game the project builds. Chosen when the project is created and
 * fixed thereafter in the UI, because it decides whether the cartridge carries a
 * battle system at all — and therefore which mappers can hold it.
 */
export const GAME_TYPES = [
  { id: 'action', label: 'Action adventure', hint: 'Real-time movement, contact damage and an attack button.' },
  { id: 'rpg', label: 'Turn-based RPG', hint: 'Random encounters and menu battles with XP, gold, magic and drops.' }
];

/** Elements a spell can carry and a monster can be weak or strong against. */
export const ELEMENTS = [
  { id: 'none', label: 'None' },
  { id: 'fire', label: 'Fire' },
  { id: 'ice', label: 'Ice' },
  { id: 'wind', label: 'Wind' },
  { id: 'earth', label: 'Earth' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' }
];

/** What a spell does when it lands. The order is the wire format (SK_* in
 * engine/constants.asm), so entries are append-only. */
export const SPELL_KINDS = [
  { id: 'damage', label: 'Damage' },
  { id: 'heal', label: 'Heal' },
  // Poison ignores `amount`: the victim loses a fixed 2 HP after each of its
  // turns until it is cured by a heal or the battle ends.
  { id: 'poison', label: 'Poison' }
];

/** Who a spell reaches. */
export const SPELL_SCOPES = [
  { id: 'one', label: 'One target' },
  { id: 'all', label: 'All targets' }
];

/** Event-page conditions, in the order the compiled bytecode uses. */
export const EVENT_CONDITIONS = [
  { id: 'none', label: 'Always', arg: null },
  { id: 'switchOn', label: 'Switch is on', arg: 'switch' },
  { id: 'switchOff', label: 'Switch is off', arg: 'switch' },
  { id: 'hasItem', label: 'Carrying item', arg: 'actor' }
];

/** Event commands, in the order the compiled bytecode uses. */
export const EVENT_COMMANDS = [
  { id: 'end', label: 'End', args: [] },
  { id: 'say', label: 'Show text', args: ['text'] },
  { id: 'give', label: 'Give item', args: ['actor'] },
  { id: 'take', label: 'Take item', args: ['actor'] },
  { id: 'setSwitch', label: 'Turn switch on', args: ['switch'] },
  { id: 'clearSwitch', label: 'Turn switch off', args: ['switch'] },
  { id: 'warp', label: 'Warp player', args: ['screen', 'x', 'y'] },
  { id: 'join', label: 'Party member joins', args: ['member'] }
];

/**
 * The subset engine/script.asm can actually run. Everything in EVENT_COMMANDS is
 * normalized, saved and compiled — so a project written by a later version
 * survives a round trip through this one — but the Map Forge only offers these,
 * because a command that silently does nothing is exactly what this codebase
 * refuses to ship. `join` is implemented, but only an RPG has a party to join,
 * so the event editor additionally hides it in an action project.
 */
export const IMPLEMENTED_COMMANDS = new Set(['say', 'give', 'take', 'setSwitch', 'clearSwitch', 'warp', 'join']);

/** Limits the battle system imposes on top of LIMITS. */
export const RPG_LIMITS = {
  party: 4,
  monstersPerBattle: 4,
  switches: 64,
  spells: 32,
  maxLevel: 15,
  encounterActors: 4,
  battleArtTiles: 12, // the widest/tallest monster block, in 8x8 tiles
  // Names are padded to this in the compiled tables, so the engine needs no
  // length byte — and it is what the battle box's message area has room for.
  nameLength: 10
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** The universal background colour shared by all four background palettes. */
export const DEFAULT_BACKDROP = 0x0f;

const DEFAULT_BG_PALETTES = [
  [0x0f, 0x30, 0x10, 0x00],
  [0x0f, 0x1a, 0x2a, 0x0a],
  [0x0f, 0x17, 0x27, 0x37],
  [0x0f, 0x12, 0x22, 0x32]
];

const DEFAULT_SPRITE_PALETTES = [
  [0x0f, 0x16, 0x27, 0x30],
  [0x0f, 0x11, 0x21, 0x30],
  [0x0f, 0x19, 0x29, 0x30],
  [0x0f, 0x14, 0x24, 0x30]
];

export function blankTileTable(count = LIMITS.tilesPerTable) {
  return Array.from({ length: count }, () => BLANK_TILE);
}

/**
 * One tileset is one 8 KB CHR bank: a background table and a sprite table that
 * the hardware switches together. See shared/cartridge.js.
 */
export function createTileset(id, name = `Tileset ${id}`) {
  return { id, name, background: { tiles: blankTileTable() }, sprites: { tiles: blankTileTable() } };
}

/**
 * The tileset at `id`, falling back to the first. Every consumer goes through
 * this so a stale index in UI state can never throw mid-render.
 */
export function tilesetAt(project, id = 0) {
  return project.tilesets[id] ?? project.tilesets[0];
}

/**
 * Bring a project's cartridge config and tilesets back into agreement after the
 * mapper or mirroring has changed. Apply this inside the same `commit()` as the
 * change: `normalizeProject` performs the same reconciliation, but only on load,
 * so without this the in-memory project can hold a combination the UI has already
 * stopped offering — four-screen on a board with no nametable RAM, or more
 * tilesets than the new cartridge addresses.
 *
 * Mutates `project` and returns it.
 */
export function reconcileCartridge(project) {
  // An RPG cannot build on a board that has nowhere to put the battle system, so
  // switching a project to one raises the mapper rather than leaving a
  // combination the Build panel has already stopped offering. This only ever
  // moves upward, and only here — `normalizeProject` keeps its downward-only
  // fallback, because silently upgrading a file on load would surprise.
  if (project.project?.gameType === 'rpg' && !rpgCapable(resolveMapper(project.cartridge.mapper))) {
    project.cartridge.mapper = defaultMapperFor('rpg');
  }

  const mapper = resolveMapper(project.cartridge.mapper);
  project.cartridge.mapper = mapper.id;

  if (!mirroringOptions(mapper).some((entry) => entry.id === project.cartridge.mirroring)) {
    project.cartridge.mirroring = 'vertical';
  }

  const limit = tilesetLimit(mapper, project.cartridge);
  if (project.tilesets.length > limit) project.tilesets.length = limit;
  project.tilesets.forEach((tileset, index) => {
    tileset.id = index;
  });
  for (const map of project.maps) {
    if (map.tilesetId >= project.tilesets.length) map.tilesetId = 0;
  }
  return project;
}

export function createMetatile(id) {
  return { id, name: id === 0 ? 'Empty' : `Metatile ${id}`, tiles: [0, 0, 0, 0], palette: 0, collision: 'open' };
}

export function createScreen() {
  return { metatiles: new Array(SCREEN_METATILES).fill(0), entities: [] };
}

export function createMap(id, name = 'World') {
  return {
    id,
    name,
    gridW: 1,
    gridH: 1,
    screens: [createScreen()],
    songId: null,
    tilesetId: 0,
    // Battle backdrop and wandering monsters. Tile indices are into the battle
    // tileset's background table, not this map's, because the battle screen
    // switches CHR banks before it draws. Ignored outside RPG projects.
    battleSkyTile: 0,
    battleGroundTile: 0,
    encounters: { rate: 0, actorIds: [] } // rate 0 = no random encounters here
  };
}

export function defaultInput() {
  return {
    states: {
      gameplay: { A: 'attack', B: 'interact', SELECT: 'item', START: 'pause' },
      menu: { A: 'confirm', B: 'cancel', SELECT: 'none', START: 'pause' },
      dialog: { A: 'confirm', B: 'confirm', SELECT: 'none', START: 'none' },
      // The title row is bindable in the Controller Forge, but Start also works
      // unconditionally there, the way the D-pad works everywhere: a game you
      // cannot start because of a rebinding would be a trap. The game-over
      // screen keeps Start hardwired outright.
      title: { A: 'confirm', B: 'none', SELECT: 'none', START: 'confirm' },
      gameover: { A: 'confirm', B: 'none', SELECT: 'none', START: 'confirm' },
      battle: { A: 'confirm', B: 'cancel', SELECT: 'none', START: 'none' }
    }
  };
}

/** Hero progression, shared by every party member. */
export function defaultRpg() {
  return {
    xpBase: 25, // experience for level 2
    xpGrow: 12, // added to each subsequent level's requirement
    maxLevel: RPG_LIMITS.maxLevel,
    battleTilesetId: 0, // the CHR bank the battle screen switches to
    encounterMusic: null
  };
}

export function createPartyMember(id, name = `Member ${id + 1}`) {
  return {
    id,
    name,
    metaspriteId: null, // how the member is drawn in battle
    startsInParty: id === 0, // the rest are recruited with the Join command
    baseHp: 24,
    hpPerLevel: 5,
    baseMp: 8,
    mpPerLevel: 2,
    baseAtk: 6,
    atkPerLevel: 1,
    baseDef: 4,
    defPerLevel: 1,
    speed: 4,
    acc: 200,
    eva: 8,
    spells: [] // { spellId, level } — learned on reaching that level
  };
}

export function createSpell(id, name = `Spell ${id}`) {
  return { id, name, mpCost: 2, kind: 'damage', amount: 8, element: 'none', scope: 'one' };
}

/**
 * A new project. `gameType` decides the cartridge: an RPG carries a battle
 * system in a switchable code bank and a battle tileset, neither of which the
 * default NROM board can hold, so it starts on the smallest mapper that can —
 * see `defaultMapperFor` in shared/cartridge.js.
 */
export function createProject(name = 'Untitled Game', gameType = 'action') {
  const type = GAME_TYPES.some((entry) => entry.id === gameType) ? gameType : 'action';
  const rpg = type === 'rpg';
  return {
    format: PROJECT_FORMAT,
    project: {
      name,
      engineVersion: ENGINE_VERSION,
      gameType: type,
      startMap: 0,
      startScreen: 0,
      startX: 120,
      startY: 112,
      maxHearts: 3, // action mode's HUD; an RPG shows HP in the battle box
      titleMap: null, // null = boot straight into gameplay
      titleScreen: 0
    },
    cartridge: { mapper: defaultMapperFor(type), mirroring: 'vertical' },
    tilesets: rpg
      ? [createTileset(0, 'Main'), createTileset(1, 'Battle')]
      : [createTileset(0, 'Main')],
    palettes: {
      bg: DEFAULT_BG_PALETTES.map((p) => [...p]),
      sprite: DEFAULT_SPRITE_PALETTES.map((p) => [...p])
    },
    metatiles: Array.from({ length: LIMITS.metatiles }, (_, id) => createMetatile(id)),
    maps: [createMap(0, 'World')],
    sprites: { metasprites: [], animations: [], actors: [] },
    songs: [],
    input: defaultInput(),
    switches: [], // names only; the engine just sees 64 bits
    party: rpg ? [createPartyMember(0, 'Hero')] : [],
    spells: [],
    rpg: { ...defaultRpg(), battleTilesetId: rpg ? 1 : 0 },
    code: { overrides: [], files: [] }
  };
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const clamp = (value, min, max, fallback = min) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
};

function normalizeTileTable(table) {
  const tiles = blankTileTable();
  const source = Array.isArray(table?.tiles) ? table.tiles : [];
  for (let i = 0; i < LIMITS.tilesPerTable && i < source.length; i++) {
    const tile = source[i];
    if (typeof tile === 'string' && tile.length === 64) tiles[i] = tile;
  }
  return { tiles };
}

/**
 * Tilesets. Format 1 stored a single `{ background, sprites }` object; that is
 * migrated to a one-entry list so older projects load unchanged. The list is
 * trimmed to what the chosen mapper can actually hold, because a project whose
 * mapper was changed downward must not keep banks the cartridge cannot address.
 */
function normalizeTilesets(raw, mapper, cartridge) {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? [{ id: 0, name: 'Main', background: raw.background, sprites: raw.sprites }]
      : [];
  const list = source.slice(0, tilesetLimit(mapper, cartridge)).map((entry, index) => ({
    id: index,
    name: normalizeLabel(entry?.name, `Tileset ${index}`),
    background: normalizeTileTable(entry?.background),
    sprites: normalizeTileTable(entry?.sprites)
  }));
  return list.length ? list : [createTileset(0, 'Main')];
}

function normalizeLabel(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, 40) : fallback;
}

function normalizeCartridge(raw) {
  // An unsupported or unknown mapper falls back to NROM rather than failing to
  // load: the project is still valid data, it just cannot build as authored.
  const requested = mapperById(clamp(raw?.mapper, 0, 255, DEFAULT_MAPPER));
  const mapper = resolveMapper(requested?.id ?? DEFAULT_MAPPER);
  // Four-screen needs nametable RAM on the board, so it falls back rather than
  // producing a header describing hardware the cartridge does not have.
  const allowed = mirroringOptions(mapper);
  const mirroring = allowed.some((entry) => entry.id === raw?.mirroring) ? raw.mirroring : 'vertical';
  return { mapper: mapper.id, mirroring };
}

function normalizePaletteSet(input, fallback) {
  const out = [];
  for (let i = 0; i < LIMITS.palettes; i++) {
    const source = Array.isArray(input?.[i]) ? input[i] : fallback[i];
    out.push([0, 1, 2, 3].map((slot) => clamp(source?.[slot], 0, 0x3f, fallback[i][slot])));
  }
  return out;
}

function normalizeMetatile(raw, id) {
  const base = createMetatile(id);
  if (!raw || typeof raw !== 'object') return base;
  const tiles = Array.isArray(raw.tiles) ? raw.tiles : base.tiles;
  return {
    id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : base.name,
    tiles: [0, 1, 2, 3].map((i) => clamp(tiles[i], 0, LIMITS.tilesPerTable - 1, 0)),
    palette: clamp(raw.palette, 0, LIMITS.palettes - 1, 0),
    collision: COLLISION_TYPES.some((t) => t.id === raw.collision) ? raw.collision : 'open'
  };
}

const MAX_DIALOGUE = 240; // one message is a handful of pages at 28 columns

function normalizeEventCommand(raw) {
  const command = EVENT_COMMANDS.find((entry) => entry.id === raw?.op);
  if (!command || command.id === 'end') return null;
  const out = { op: command.id };
  for (const arg of command.args) {
    if (arg === 'text') out.text = String(raw?.text ?? '').slice(0, MAX_DIALOGUE);
    else if (arg === 'switch') out.switch = clamp(raw?.switch, 0, RPG_LIMITS.switches - 1, 0);
    else if (arg === 'member') out.member = clamp(raw?.member, 0, RPG_LIMITS.party - 1, 0);
    else out[arg] = clamp(raw?.[arg], 0, 255, 0);
  }
  return out;
}

function normalizeEventPage(raw) {
  const condition = EVENT_CONDITIONS.find((entry) => entry.id === raw?.cond?.type) ?? EVENT_CONDITIONS[0];
  const limit = condition.arg === 'switch' ? RPG_LIMITS.switches - 1 : 255;
  return {
    cond: { type: condition.id, arg: condition.arg ? clamp(raw?.cond?.arg, 0, limit, 0) : 0 },
    commands: (Array.isArray(raw?.commands) ? raw.commands : []).map(normalizeEventCommand).filter(Boolean)
  };
}

/** An event is a list of pages; the engine runs the first whose condition holds. */
function normalizeEvent(raw) {
  const pages = (Array.isArray(raw?.pages) ? raw.pages : []).map(normalizeEventPage);
  return pages.length ? { pages } : null;
}

function normalizeEntity(raw) {
  const props = raw?.props && typeof raw.props === 'object' ? { ...raw.props } : {};
  const event = normalizeEvent(props.event);
  const dialogue = String(props.dialogue ?? '').slice(0, MAX_DIALOGUE);
  const hideSwitch =
    props.hideSwitch === null || props.hideSwitch === undefined
      ? null
      : clamp(props.hideSwitch, 0, RPG_LIMITS.switches - 1, 0);
  // Unknown props are still preserved — the bag is how a Forge attaches data the
  // engine has not learned to read yet — but everything the generator compiles
  // is clamped here, because a bad value becomes a bad byte in the ROM.
  return {
    actorId: clamp(raw?.actorId, 0, 255, 0),
    x: clamp(raw?.x, 0, 255, 0),
    y: clamp(raw?.y, 0, 239, 0),
    props: {
      ...props,
      toScreen: clamp(props.toScreen, 0, 255, 0),
      toX: clamp(props.toX, 0, 240, 112),
      toY: clamp(props.toY, 0, 224, 112),
      dialogue,
      event,
      hideSwitch
    }
  };
}

function normalizeScreen(raw) {
  const screen = createScreen();
  const source = Array.isArray(raw?.metatiles) ? raw.metatiles : [];
  for (let i = 0; i < SCREEN_METATILES && i < source.length; i++) {
    screen.metatiles[i] = clamp(source[i], 0, LIMITS.metatiles - 1, 0);
  }
  if (Array.isArray(raw?.entities)) {
    screen.entities = raw.entities.slice(0, LIMITS.entitiesPerScreen).map(normalizeEntity);
  }
  return screen;
}

function normalizeMap(raw, id) {
  const gridW = clamp(raw?.gridW, 1, LIMITS.mapGrid, 1);
  const gridH = clamp(raw?.gridH, 1, LIMITS.mapGrid, 1);
  const count = gridW * gridH;
  const screens = [];
  for (let i = 0; i < count; i++) screens.push(normalizeScreen(raw?.screens?.[i]));
  return {
    id,
    name: typeof raw?.name === 'string' && raw.name ? raw.name : `Map ${id}`,
    gridW,
    gridH,
    screens,
    songId: raw?.songId ?? null,
    // Clamped against the tileset list in normalizeProject, which is the only
    // place that knows how many tilesets survived the mapper's limit.
    tilesetId: clamp(raw?.tilesetId, 0, 255, 0),
    battleSkyTile: clamp(raw?.battleSkyTile, 0, LIMITS.tilesPerTable - 1, 0),
    battleGroundTile: clamp(raw?.battleGroundTile, 0, LIMITS.tilesPerTable - 1, 0),
    encounters: {
      // Steps between rolls; 0 turns wandering monsters off for this map.
      rate: clamp(raw?.encounters?.rate, 0, 255, 0),
      actorIds: (Array.isArray(raw?.encounters?.actorIds) ? raw.encounters.actorIds : [])
        .slice(0, RPG_LIMITS.encounterActors)
        .map((id) => clamp(id, 0, 255, 0))
    }
  };
}

function normalizeMetasprite(raw, id) {
  const tiles = Array.isArray(raw?.tiles) ? raw.tiles : [];
  return {
    id,
    name: typeof raw?.name === 'string' && raw.name ? raw.name : `Metasprite ${id}`,
    tiles: tiles.slice(0, LIMITS.metaspriteTiles).map((t) => ({
      x: clamp(t?.x, -128, 127, 0),
      y: clamp(t?.y, -128, 127, 0),
      tile: clamp(t?.tile, 0, LIMITS.tilesPerTable - 1, 0),
      palette: clamp(t?.palette, 0, LIMITS.palettes - 1, 0),
      hflip: Boolean(t?.hflip),
      vflip: Boolean(t?.vflip)
    }))
  };
}

function normalizeAnimation(raw, id) {
  const frames = Array.isArray(raw?.frames) ? raw.frames : [];
  return {
    id,
    name: typeof raw?.name === 'string' && raw.name ? raw.name : `Animation ${id}`,
    loop: raw?.loop !== false,
    frames: frames.slice(0, LIMITS.animationFrames).map((f) => ({
      metaspriteId: clamp(f?.metaspriteId, 0, 255, 0),
      duration: clamp(f?.duration, 1, 255, 8)
    }))
  };
}

const elementId = (value) => (ELEMENTS.some((e) => e.id === value) ? value : 'none');

function normalizeActor(raw, id) {
  const anims = {};
  for (const { id: slot } of ANIM_SLOTS) {
    const value = raw?.anims?.[slot];
    anims[slot] = value === null || value === undefined ? null : clamp(value, 0, 255, 0);
  }
  const battle = raw?.battle ?? {};
  return {
    id,
    name: typeof raw?.name === 'string' && raw.name ? raw.name : `Actor ${id}`,
    behavior: BEHAVIORS.some((b) => b.id === raw?.behavior) ? raw.behavior : 'patroller',
    speed: clamp(raw?.speed, 1, 8, 1),
    hp: clamp(raw?.hp, 1, 255, 1),
    // In action mode this is contact damage; in an RPG a non-zero value is what
    // marks an actor hostile, and `battle.atk` decides how hard it hits.
    damage: clamp(raw?.damage, 0, 8, 0),
    anims,
    battle: {
      atk: clamp(battle.atk, 0, 255, 4),
      def: clamp(battle.def, 0, 255, 2),
      acc: clamp(battle.acc, 0, 255, 180),
      eva: clamp(battle.eva, 0, 255, 4),
      speed: clamp(battle.speed, 0, 255, 4),
      mp: clamp(battle.mp, 0, 255, 0),
      xp: clamp(battle.xp, 0, 65535, 4),
      gold: clamp(battle.gold, 0, 255, 2),
      weak: elementId(battle.weak),
      strong: elementId(battle.strong),
      // What this monster may leave behind: another actor, used as an item.
      drop: battle.drop === null || battle.drop === undefined ? null : clamp(battle.drop, 0, 255, 0),
      dropPct: clamp(battle.dropPct, 0, 100, 10),
      // How much this actor heals when used from the bag. 0 = not a potion.
      heal: clamp(battle.heal, 0, 255, 0),
      // The spell this monster casts in battle when it can afford the MP.
      // Clamped to a byte here; the generator drops an id past the spell table.
      spellId:
        battle.spellId === null || battle.spellId === undefined ? null : clamp(battle.spellId, 0, 255, 0),
      // Battle artwork: a block of background tiles on the battle tileset. null
      // falls back to drawing the actor's `battle` animation as sprites.
      battleTile:
        battle.battleTile === null || battle.battleTile === undefined
          ? null
          : clamp(battle.battleTile, 0, LIMITS.tilesPerTable - 1, 0),
      battleW: clamp(battle.battleW, 1, RPG_LIMITS.battleArtTiles, 4),
      battleH: clamp(battle.battleH, 1, RPG_LIMITS.battleArtTiles, 4),
      battlePalette: clamp(battle.battlePalette, 0, LIMITS.palettes - 1, 2)
    }
  };
}

function normalizeSpell(raw, id) {
  const base = createSpell(id);
  return {
    id,
    name: normalizeLabel(raw?.name, base.name),
    mpCost: clamp(raw?.mpCost, 0, 99, base.mpCost),
    kind: SPELL_KINDS.some((k) => k.id === raw?.kind) ? raw.kind : base.kind,
    amount: clamp(raw?.amount, 1, 255, base.amount),
    element: elementId(raw?.element),
    scope: SPELL_SCOPES.some((s) => s.id === raw?.scope) ? raw.scope : base.scope
  };
}

function normalizePartyMember(raw, id, spellCount, maxLevel) {
  const base = createPartyMember(id);
  const num = (key, min, max) => clamp(raw?.[key], min, max, base[key]);
  return {
    id,
    name: normalizeLabel(raw?.name, base.name),
    metaspriteId:
      raw?.metaspriteId === null || raw?.metaspriteId === undefined
        ? null
        : clamp(raw.metaspriteId, 0, 255, 0),
    // Member 0 always starts, or an RPG would open with an empty party.
    startsInParty: id === 0 ? true : Boolean(raw?.startsInParty),
    baseHp: num('baseHp', 1, 255),
    hpPerLevel: num('hpPerLevel', 0, 32),
    baseMp: num('baseMp', 0, 99),
    mpPerLevel: num('mpPerLevel', 0, 16),
    baseAtk: num('baseAtk', 0, 255),
    atkPerLevel: num('atkPerLevel', 0, 16),
    baseDef: num('baseDef', 0, 255),
    defPerLevel: num('defPerLevel', 0, 16),
    speed: num('speed', 0, 255),
    acc: num('acc', 0, 255),
    eva: num('eva', 0, 255),
    spells: (Array.isArray(raw?.spells) ? raw.spells : [])
      .filter((entry) => spellCount > 0 && Number(entry?.spellId) < spellCount)
      .slice(0, RPG_LIMITS.spells)
      .map((entry) => ({
        spellId: clamp(entry?.spellId, 0, Math.max(0, spellCount - 1), 0),
        level: clamp(entry?.level, 1, maxLevel, 1)
      }))
  };
}

function normalizeRpg(raw, tilesetCount) {
  const base = defaultRpg();
  return {
    xpBase: clamp(raw?.xpBase, 1, 255, base.xpBase),
    xpGrow: clamp(raw?.xpGrow, 0, 255, base.xpGrow),
    maxLevel: clamp(raw?.maxLevel, 1, RPG_LIMITS.maxLevel, base.maxLevel),
    battleTilesetId: clamp(raw?.battleTilesetId, 0, Math.max(0, tilesetCount - 1), 0),
    encounterMusic: raw?.encounterMusic ?? null
  };
}

function normalizeInput(raw) {
  const base = defaultInput();
  if (!raw?.states) return base;
  for (const state of INPUT_STATES) {
    for (const button of BUTTONS) {
      const value = raw.states?.[state]?.[button];
      if (ACTIONS.some((a) => a.id === value)) base.states[state][button] = value;
    }
  }
  return base;
}

/**
 * A Code Forge filename. No slashes, so a name can never escape the folder it is
 * written into, and no leading dot, so it cannot become a config file — the
 * generator writes these straight into `build/` beside the engine sources.
 */
export const CODE_FILE_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,30}\.asm$/;

export const CODE_LIMITS = {
  fileBytes: 128 * 1024, // one source file
  files: 64 // per group
};

/**
 * Source text as the generator will write it: LF endings and a trailing newline,
 * so a save/load round-trip is byte-identical and the last line of a file never
 * runs into the next `.include`.
 */
export function normalizeCodeText(raw) {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n').slice(0, CODE_LIMITS.fileBytes);
  if (!text) return '';
  return text.endsWith('\n') ? text : `${text}\n`;
}

const normalizeCodeGroup = (raw) => {
  const seen = new Set();
  const files = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const name = typeof entry?.name === 'string' ? entry.name : '';
    if (!CODE_FILE_RE.test(name) || seen.has(name)) continue;
    seen.add(name);
    files.push({ name, text: normalizeCodeText(entry?.text) });
    if (files.length >= CODE_LIMITS.files) break;
  }
  // Sorted so the order matches the readdir that reads them back, which is what
  // makes a save/load round-trip compare equal.
  return files.sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * The Code Forge slice: edited copies of stock engine files, and the user's own
 * files. Which names are *stock* is not knowable here — this module may not touch
 * the filesystem — so the engine-name checks live in the generator's
 * `checkCapacity`, which can read the engine folder.
 */
export function normalizeCode(raw) {
  const overrides = normalizeCodeGroup(raw?.overrides);
  const taken = new Set(overrides.map((file) => file.name));
  // A user file may not shadow an override: both are written into the same build
  // folder, so one would silently overwrite the other.
  const files = normalizeCodeGroup(raw?.files).filter((file) => !taken.has(file.name));
  return { overrides, files };
}

/** Fill in defaults and clamp everything so the UI can trust the shape. */
export function normalizeProject(raw) {
  const base = createProject(raw?.project?.name || 'Untitled Game');
  if (!raw || typeof raw !== 'object') return base;

  // A project written before game types existed is an action game: that is what
  // it was authored as, and nothing in it can have depended on a battle system.
  const gameType = GAME_TYPES.some((entry) => entry.id === raw.project?.gameType)
    ? raw.project.gameType
    : 'action';

  const project = {
    ...base.project,
    name: typeof raw.project?.name === 'string' && raw.project.name ? raw.project.name : base.project.name,
    gameType,
    startMap: clamp(raw.project?.startMap, 0, 63, 0),
    startScreen: clamp(raw.project?.startScreen, 0, LIMITS.mapGrid ** 2 - 1, 0),
    startX: clamp(raw.project?.startX, 0, 255, base.project.startX),
    startY: clamp(raw.project?.startY, 0, 239, base.project.startY),
    maxHearts: clamp(raw.project?.maxHearts, 1, 6, base.project.maxHearts),
    titleMap:
      raw.project?.titleMap === null || raw.project?.titleMap === undefined
        ? null
        : clamp(raw.project.titleMap, 0, 63, 0),
    titleScreen: clamp(raw.project?.titleScreen, 0, LIMITS.mapGrid ** 2 - 1, 0)
  };

  const cartridge = normalizeCartridge(raw.cartridge);

  const bg = normalizePaletteSet(raw.palettes?.bg, DEFAULT_BG_PALETTES);
  const sprite = normalizePaletteSet(raw.palettes?.sprite, DEFAULT_SPRITE_PALETTES);
  // The NES shares one backdrop colour across every background palette.
  const backdrop = bg[0][0];
  for (const palette of bg) palette[0] = backdrop;
  for (const palette of sprite) palette[0] = backdrop;

  const tilesets = normalizeTilesets(raw.tilesets, resolveMapper(cartridge.mapper), cartridge);

  const maps = (Array.isArray(raw.maps) && raw.maps.length ? raw.maps : base.maps).map(normalizeMap);
  if (project.startMap >= maps.length) project.startMap = 0;
  if (project.startScreen >= maps[project.startMap].screens.length) project.startScreen = 0;
  // A map pointing at a tileset that the mapper change removed falls back to the
  // first one rather than generating a bank switch to nowhere.
  for (const map of maps) if (map.tilesetId >= tilesets.length) map.tilesetId = 0;
  // Same for a title screen whose map or screen has since been deleted.
  if (project.titleMap !== null && project.titleMap >= maps.length) project.titleMap = null;
  if (project.titleMap !== null && project.titleScreen >= maps[project.titleMap].screens.length) {
    project.titleScreen = 0;
  }

  const rpg = normalizeRpg(raw.rpg, tilesets.length);
  const spells = (Array.isArray(raw.spells) ? raw.spells : [])
    .slice(0, RPG_LIMITS.spells)
    .map(normalizeSpell);
  const party = (Array.isArray(raw.party) ? raw.party : [])
    .slice(0, RPG_LIMITS.party)
    .map((member, index) => normalizePartyMember(member, index, spells.length, rpg.maxLevel));
  // An RPG always has someone to play as; an action game has no party at all.
  if (project.gameType === 'rpg' && !party.length) party.push(createPartyMember(0, 'Hero'));

  return {
    format: PROJECT_FORMAT,
    project,
    cartridge,
    tilesets,
    palettes: { bg, sprite },
    metatiles: Array.from({ length: LIMITS.metatiles }, (_, id) =>
      normalizeMetatile(raw.metatiles?.[id], id)
    ),
    maps,
    sprites: {
      metasprites: (raw.sprites?.metasprites ?? []).map(normalizeMetasprite),
      animations: (raw.sprites?.animations ?? []).map(normalizeAnimation),
      actors: (raw.sprites?.actors ?? []).map(normalizeActor)
    },
    songs: (Array.isArray(raw.songs) ? raw.songs : []).map((song, index) =>
      normalizeSong(song, `Song ${index}`)
    ),
    input: normalizeInput(raw.input),
    switches: (Array.isArray(raw.switches) ? raw.switches : [])
      .slice(0, RPG_LIMITS.switches)
      .map((name, index) => normalizeLabel(name, `Switch ${index}`)),
    party,
    spells,
    rpg,
    code: normalizeCode(raw.code)
  };
}

/**
 * Capacity checks the Build panel surfaces before ever invoking the assembler,
 * so users see "too many metatiles" rather than raw nesasm output.
 */
export function validateProject(project) {
  const problems = [];
  const add = (severity, where, message) => problems.push({ severity, where, message });

  if (!project.maps.length) add('error', 'Map Forge', 'A project needs at least one map.');

  project.maps.forEach((map) => {
    map.screens.forEach((screen, index) => {
      if (screen.entities.length > LIMITS.entitiesPerScreen) {
        add(
          'error',
          'Map Forge',
          `${map.name} screen ${index} has ${screen.entities.length} entities; the engine allows ${LIMITS.entitiesPerScreen}.`
        );
      }
    });
  });

  const players = project.sprites.actors.filter((a) => a.behavior === 'player');
  if (players.length > 1) {
    add('warning', 'Sprite Forge', 'More than one actor is marked as the player; the first is used.');
  }

  const usedMetatiles = new Set();
  for (const map of project.maps) {
    for (const screen of map.screens) for (const id of screen.metatiles) usedMetatiles.add(id);
  }
  if (usedMetatiles.size > LIMITS.metatiles) {
    add('error', 'Map Forge', `Maps reference ${usedMetatiles.size} metatiles; the limit is ${LIMITS.metatiles}.`);
  }

  // The message font is stamped over the top of every background table, so any
  // art up there is about to be overwritten. Only checked when the project
  // actually shows text — a text-free game keeps all 256 tiles — and never on a
  // scanline-IRQ board, where the font ships in its own CHR bank and the
  // tilesets are left alone (see fontBankSplit in shared/font.js).
  const splitFont = fontBankSplit(project, resolveMapper(project.cartridge.mapper));
  if (projectUsesText(project) && !splitFont) {
    for (const tileset of project.tilesets) {
      const occupied = tileset.background.tiles.findIndex(
        (tile, index) => index >= FONT_BASE && tile !== BLANK_TILE
      );
      if (occupied >= 0) {
        add(
          'error',
          'Tile Forge',
          `Tileset "${tileset.name}" has artwork in background tiles $${FONT_BASE.toString(16).toUpperCase()}-$FF, ` +
            'which the message font reserves while dialogue, a title screen, combat or an RPG battle system is in ' +
            'use. Move that artwork below row 10.'
        );
      }
    }
  }
  if (projectUsesCombat(project)) {
    for (const tileset of project.tilesets) {
      const occupied = tileset.sprites.tiles.findIndex(
        (tile, index) => index >= HEART_FULL_TILE && tile !== BLANK_TILE
      );
      if (occupied >= 0) {
        add(
          'error',
          'Tile Forge',
          `Tileset "${tileset.name}" has artwork in the last two sprite tiles, which the HUD hearts reserve ` +
            'while anything in the project can hurt the player.'
        );
      }
    }
  }

  if (project.project.gameType === 'rpg' && splitFont) {
    // The battle targeting cursor is a sprite on a split-font board (the arrow
    // glyph's bank is only switched in below the battle box), so one more
    // sprite tile joins the hearts' reservation.
    for (const tileset of project.tilesets) {
      const tile = tileset.sprites.tiles[SPRITE_ARROW_TILE];
      if (tile && tile !== BLANK_TILE) {
        add(
          'error',
          'Tile Forge',
          `Tileset "${tileset.name}" has artwork in sprite tile $${SPRITE_ARROW_TILE.toString(16).toUpperCase()}, ` +
            'which the battle targeting cursor reserves on this cartridge.'
        );
      }
    }
  }

  if (project.project.gameType === 'rpg') {
    const mapper = resolveMapper(project.cartridge.mapper);
    if (!rpgCapable(mapper)) {
      add(
        'error',
        'Build',
        `${rpgUnsupportedReason(mapper)} Choose a mapper with program bank switching in the Build panel.`
      );
    }
    if (!project.party.length) add('error', 'Sprite Forge', 'A turn-based RPG needs at least one party member.');
    const hostile = project.sprites.actors.filter((actor) => actor.damage > 0);
    if (!hostile.length) {
      add('warning', 'Sprite Forge', 'No actor deals damage, so no battle can ever start.');
    }
    for (const actor of project.sprites.actors) {
      // A validator runs against whatever it is handed, including a project the
      // UI is mid-edit on, so it never assumes normalisation has been through.
      const { battleTile, battleW = 4, battleH = 4 } = actor.battle ?? {};
      if (battleTile === null || battleTile === undefined) continue;
      // Battle art is stamped as background tiles on the battle tileset, so it
      // competes with the font for the same 256 entries — except on a
      // split-font board, where the font is not in the tileset at all and the
      // monsters stand above the split, in the tileset's own bank.
      const last = battleTile + (battleH - 1) * LIMITS.screenCols + battleW - 1;
      if (last >= FONT_BASE && !splitFont) {
        add(
          'error',
          'Sprite Forge',
          `${actor.name}'s battle artwork runs into the message font's tiles. Move it below background tile ` +
            `$${FONT_BASE.toString(16).toUpperCase()} or make it smaller.`
        );
      }
    }
    for (const map of project.maps) {
      for (const id of map.encounters.actorIds) {
        if (id >= project.sprites.actors.length) {
          add('warning', 'Map Forge', `${map.name}'s encounter table names an actor that no longer exists.`);
        }
      }
    }
  }

  return problems;
}

/** Index helpers shared by Map Forge and the generator. */
export const screenIndex = (map, col, row) => row * map.gridW + col;
export const metatileIndex = (col, row) => row * LIMITS.screenCols + col;
