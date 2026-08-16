// The Forge project data model.
//
// A project lives on disk as a folder of JSON files (see main/project-io.js) but
// is a single plain object in memory. This module owns the schema, the engine
// limits every Forge validates against, and normalisation of loaded data so a
// hand-edited or older project never crashes the UI.

import { BLANK_TILE } from './chr.js';
import { normalizeSong } from './audio.js';
import { allCommands, choiceOptionsSlice, compiledPages, damageAmount, liveCommands, projectEvents } from './eventrules.js';
import {
  DEFAULT_MAPPER,
  resolveMapper,
  mapperById,
  mirroringOptions,
  tilesetLimit,
  rpgCapable,
  rpgUnsupportedReason,
  batteryCapable,
  batteryUnsupportedReason,
  defaultMapperFor
} from './cartridge.js';
import {
  BOX_COLS,
  BOX_ROWS,
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
  animationFrames: 32,
  // One body, callable from any placement's event — a chest, a shop, a
  // recurring cutscene — rather than authored again at every place it is
  // used. The real ceiling is the 255-entry compiled events table it shares
  // with every placed actor's own event; this is the authoring-side cap that
  // keeps the list itself readable well below that.
  commonEvents: 32
};

export const SCREEN_METATILES = LIMITS.screenCols * LIMITS.screenRows; // 240

/**
 * How long a name the author gives a screen or a placed actor may be. These are
 * authoring metadata and reach no `.inc` file, so the limit is about keeping a
 * dropdown readable rather than about ROM bytes — the engine never sees them.
 */
export const AUTHOR_NAME_MAX = 32;

const authorName = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, AUTHOR_NAME_MAX);

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
 * Who the interact action can start a conversation with — the rule `do_talk`
 * applies in the engine, written down beside the behaviours it is about. The
 * Map Forge uses it to decide whether to offer a dialogue box, and the event
 * list to decide whether "says nothing" is a remark worth making; two copies of
 * this list would drift the moment a behaviour is added.
 */
export const canTalk = (actor) => Boolean(actor) && !['pickup', 'door', 'player'].includes(actor.behavior);

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
  { id: 'confirm', label: 'Confirm' },
  // Title-only, and only meaningful when the project can save (SAVE_ENABLED):
  // loads the one save slot and resumes there. Offered here unconditionally,
  // like every other action — the Controller Forge already says "the engine
  // ignores this action here" for one bound somewhere it does nothing, and a
  // project with no Save command is exactly that, not a reason to hide the
  // option. Appended last so existing ACT_* numbering is untouched.
  { id: 'continue', label: 'Continue (load save)' }
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

/**
 * Event-page conditions, in the order the compiled bytecode uses.
 *
 * `arg` names what the first byte of the page header means; `value: true` says
 * the condition also carries the second one, which is what lets a variable be
 * compared against a number rather than only tested for being set. Every page
 * carries both bytes whether or not its condition reads them — a fixed header
 * is what `script_skip` steps over without having to know which condition it
 * just declined.
 */
export const EVENT_CONDITIONS = [
  { id: 'none', label: 'Always', arg: null },
  { id: 'switchOn', label: 'Switch is on', arg: 'switch' },
  { id: 'switchOff', label: 'Switch is off', arg: 'switch' },
  { id: 'hasItem', label: 'Carrying item', arg: 'actor' },
  { id: 'varEquals', label: 'Variable is', arg: 'variable', value: true },
  { id: 'varAtLeast', label: 'Variable is at least', arg: 'variable', value: true },
  { id: 'varUnder', label: 'Variable is under', arg: 'variable', value: true }
];

/**
 * What makes a placed actor's event run. The order is the wire format: it is one
 * byte of the entity record and `TRIG_*` in `engine/constants.asm` is this list
 * written down, so adding one means editing both ends in the same change.
 *
 * `interact` is what every event did before there were triggers, and it stays
 * the default — a project that has never seen this control builds exactly as it
 * did, which is the only reason it can be index 0.
 */
export const EVENT_TRIGGERS = [
  { id: 'interact', label: 'When talked to', hint: 'The player walks up and presses the interact button.' },
  {
    id: 'touch',
    label: 'When touched',
    hint: 'The player walks into it. It happens again only after walking away and back.'
  },
  {
    id: 'enter',
    label: 'When the screen loads',
    hint: 'Straight away, every time the screen is entered — guard it with a switch if it should happen once.'
  }
];

/**
 * What makes an actor a monster: contact damage above zero, the same field an
 * action game's spikes use. It is the single writer for that test — the Sprite
 * Forge's *In battle* tab, the Map Forge's encounter table and battle command
 * formation pickers, and `availableTriggers` below all ask this rather than
 * each spelling out `(actor.damage ?? 0) > 0` and one of them drifting.
 */
export const isMonsterActor = (actor) => (actor?.damage ?? 0) > 0;

/**
 * Whether a Give item / Take item command's `actor` still names a real
 * actor — the single question the compiler (`actorByte`,
 * main/build/textcompile.js), `validateProject` below and the Map Forge's
 * own select (`giveTargetMissing`, renderer/forges/map/events.js) all ask,
 * so an id that does not resolve reads the same way no matter which of them
 * is asking. Not merely `null` — the mark `renumberActorDeletion` leaves —
 * but any id no actor currently sits at: a project written by a later
 * version, or a hand-edited one, can hold one that was never `null` to
 * begin with. Validating against "is this the deletion sentinel" instead of
 * "does this resolve" is exactly the gap that let an out-of-range id pass
 * review, compile to NO_ACTOR, and still reach `add_item` with a byte that
 * indexes the actor tables past their end.
 */
export const actorMissing = (actors, id) =>
  id === null || id === undefined || !Number.isInteger(id) || id < 0 || id >= (actors?.length ?? 0);

/**
 * Which triggers mean something for this actor, in this project.
 *
 * `touch` is the only one that can be spoken for, because it is the only one
 * that names a moment something else already owns:
 *
 * - Walking into a **pickup** collects it and walking into a **door** goes
 *   through it. The pickup is gone before its event could run, and the door's
 *   warp would land in the middle of the conversation it started.
 * - In an **RPG**, walking into anything that deals damage starts a battle,
 *   which freezes the world — so the event behind it would never get its turn.
 *   In an action game the same contact costs a heart and the event *does* run,
 *   which is why this asks the project and not only the actor.
 *
 * Offering it anyway is the "looks functional, does something else" case this
 * codebase refuses. The compiler applies the same rule as the editor, because a
 * hand-edited project reaches the ROM through it rather than through the editor.
 *
 * `interact` and `enter` are always available: one is a button and the other is
 * the screen loading, and neither is a moment a behaviour can take.
 */
export const availableTriggers = (actor, project) => {
  const walkedInto = actor?.behavior === 'pickup' || actor?.behavior === 'door';
  const startsBattle = project?.project?.gameType === 'rpg' && isMonsterActor(actor);
  return EVENT_TRIGGERS.filter((entry) => entry.id !== 'touch' || !(walkedInto || startsBattle));
};

/**
 * The trigger a placement actually gets — its own, unless the actor has stopped
 * having room for it.
 *
 * An actor is edited in a different Forge to the one that places it, so a
 * placement set to `touch` can find itself on an actor that has since been given
 * contact damage in an RPG. The stored choice is deliberately *not* rewritten
 * when that happens: put the damage back to zero and the trigger the author
 * picked is still there. What must not happen is the three answers disagreeing —
 * the editor showing one, the hint describing another and the ROM running a
 * third — so everything that needs to know asks this.
 */
export function effectiveTrigger(entity, actor, project) {
  const wanted = entity?.props?.trigger ?? EVENT_TRIGGERS[0].id;
  const allowed = availableTriggers(actor, project).some((entry) => entry.id === wanted);
  return allowed ? wanted : EVENT_TRIGGERS[0].id;
}

/** Event commands, in the order the compiled bytecode uses. */
export const EVENT_COMMANDS = [
  { id: 'end', label: 'End', args: [] },
  { id: 'say', label: 'Show text', args: ['text'] },
  { id: 'give', label: 'Give item', args: ['actor'] },
  { id: 'take', label: 'Take item', args: ['actor'] },
  { id: 'setSwitch', label: 'Turn switch on', args: ['switch'] },
  { id: 'clearSwitch', label: 'Turn switch off', args: ['switch'] },
  { id: 'warp', label: 'Warp player', args: ['screen', 'x', 'y'] },
  { id: 'join', label: 'Party member joins', args: ['member'] },
  // A switch answers yes or no; these count. Add and subtract saturate at 0 and
  // 255 rather than wrapping, because a quest counter that rolls over to 0 is a
  // quest that silently starts again.
  { id: 'setVar', label: 'Set variable', args: ['variable', 'value'] },
  { id: 'addVar', label: 'Add to variable', args: ['variable', 'value'] },
  { id: 'subVar', label: 'Subtract from variable', args: ['variable', 'value'] },
  // The commands that contain other commands. A page condition decides which
  // page runs *before* it runs; a branch decides in the middle of one, which is
  // what "give the reward, but only if they are carrying the key" needs without
  // splitting the conversation across two pages that both have to repeat the
  // parts they share. `cond` is the same shape a page's is — the vocabulary of
  // conditions has one definition, and one encoder.
  //
  // `nests` says the command holds a list of commands, whatever it calls them.
  // The editor's depth limit and the schema's safety bound both ask this rather
  // than naming the two commands, so a third one is not a third place to edit.
  { id: 'branch', label: 'If…', args: ['branch'], nests: true },
  // A branch asks the game a question. This one asks the *player*: the message
  // box lists the options, the player puts the cursor on one, and that option's
  // commands are the ones that run. Everything a branch is, with the condition
  // replaced by somebody at the controller.
  { id: 'choice', label: 'Ask a question', args: ['choice'], nests: true },
  // Run a common event, then come back to the command after this one. Unlike
  // branch and choice this does not hold its own commands — `event` is a
  // common event's stable `id` (see normalizeCommonEvents), resolved to a
  // table slot at compile time — so it is not `nests: true`: there is
  // nothing here for the editor to nest into, only a reference to a body
  // authored somewhere else. An id rather than a position in
  // project.commonEvents is what lets one be deleted without silently
  // retargeting every call naming a later one.
  { id: 'call', label: 'Run common event', args: ['event'] },
  // Changes which song is sounding, immediately: `null` is Silence, otherwise
  // a song's index, the same idiom a map's own Music field uses (see
  // createMap). engine/music.asm's set_music is the single place either side
  // applies one, comparing against what is already sounding first — so this
  // and a map deciding its own song on arrival agree about what counts as a
  // change, and neither retriggers a song that is already playing.
  { id: 'music', label: 'Play music', args: ['song'] },
  // Up to RPG_LIMITS.monstersPerBattle monster actors (isMonsterActor), the
  // formation this fight is against — never the map's own encounter table,
  // which already has the random kind. Cannot be run from: see
  // battle_menu_run in engine/battleui.asm, which only offers Run at all when
  // bt_esc is set, and script_op_battle never sets it. Losing is already
  // defined elsewhere — the whole party falling is GAME OVER, and
  // restart_game decides where that lands — so control only
  // ever reaches the command after this one when the player won. There is no
  // lose branch to author: whatever should happen on victory is just the
  // commands that follow, the same way a page after a switch check is.
  { id: 'battle', label: 'Start a battle', args: ['monsters'] },
  // Whole-party HP, saturating at 0 and at the max -- the same saturation
  // addVar/subVar already apply, and for the same reason: a counter that
  // wraps reads as something that should not have happened. Which HP this
  // means depends on the build: player_hp (hearts) in an action project,
  // every recruited pc_hp in an RPG, decided at assemble time by
  // BATTLE_ENABLED (engine/script.asm's script_op_heal/script_op_damage) --
  // there is no third health model for a script to invent, and neither
  // command is RPG-only the way join and battle are, so both are always
  // offered. `Heal 255` is a full heal with no separate "inn" vocabulary,
  // and revives a fallen RPG party member the same way an inn would.
  { id: 'heal', label: 'Heal', args: ['value'] },
  { id: 'damage', label: 'Damage', args: ['value'] },
  // No argument -- there is exactly one save slot, so there is nothing to
  // name. Only offered on a board with battery-backed WRAM (batteryCapable,
  // shared/cartridge.js); validateProject refuses a live one elsewhere the
  // same way it refuses Join in a project with no party.
  { id: 'save', label: 'Save the game', args: [] }
];

// A command can be switched off while you work out whether you want it, the way
// you would comment a line out. What that means lives in `eventrules.js`, which
// `font.js` needs as well — re-exported here so the schema stays the one place
// to look for it.
export {
  enabledCommands,
  compiledPages,
  allCommands,
  choiceOptionsSlice,
  damageAmount,
  liveCommands,
  projectEvents
} from './eventrules.js';

/**
 * The subset engine/script.asm can actually run. Everything in EVENT_COMMANDS is
 * normalized, saved and compiled — so a project written by a later version
 * survives a round trip through this one — but the Map Forge only offers these,
 * because a command that silently does nothing is exactly what this codebase
 * refuses to ship. `join` is implemented, but only an RPG has a party to join,
 * so the event editor additionally hides it in an action project.
 */
export const IMPLEMENTED_COMMANDS = new Set([
  'say',
  'give',
  'take',
  'setSwitch',
  'clearSwitch',
  'warp',
  'join',
  'setVar',
  'addVar',
  'subVar',
  'branch',
  'choice',
  'call',
  'music',
  'battle',
  'heal',
  'damage',
  'save'
]);

/**
 * What a question fits in, which is what the message box is: one option per text
 * row, and a label as wide as a row of text. The cursor sits in the padding
 * column outside that width, so a label may use the whole of it.
 *
 * Both numbers come from the box rather than being chosen here, because the box
 * is what has to draw the answer — a fifth option would have nowhere to go.
 */
export const CHOICE_LIMITS = {
  options: BOX_ROWS,
  label: BOX_COLS
};

/** Limits the battle system imposes on top of LIMITS. */
export const RPG_LIMITS = {
  party: 4,
  monstersPerBattle: 4,
  switches: 64,
  // Named 8-bit counters, alongside the switches: a quest stage, how many of
  // something has been handed over, a stat a later scene reads back. Sixteen
  // bytes of engine RAM, and `NUM_VARIABLES` in config.inc is generated from
  // this — engine/constants.asm allocates the block but does not size it.
  variables: 16,
  spells: 32,
  maxLevel: 15,
  encounterActors: 4,
  battleArtTiles: 12, // the widest/tallest monster block, in 8x8 tiles
  // Names are padded to this in the compiled tables, so the engine needs no
  // length byte — and it is what the battle box's message area has room for.
  nameLength: 10
};

/**
 * The up-to-RPG_LIMITS.monstersPerBattle monster ids a Start a battle
 * command's formation actually compiles from — the same truncation
 * encodeCommand (main/build/textcompile.js) applies before it asks which of
 * them are still real actors. A valid id sitting past the truncation point
 * never reaches the ROM, so anything judging a formation's validity has to
 * lose it the same way the compiler does, or it can approve a formation the
 * compiler empties out — a formation whose only real monster falls in the
 * fifth slot compiles to an instant win exactly as an authored-empty one
 * does. The single writer for both the compiler and validateProject below.
 */
export const battleFormationSlice = (monsters) =>
  (Array.isArray(monsters) ? monsters : []).slice(0, RPG_LIMITS.monstersPerBattle);

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
  // An unnamed screen is the empty string, not "Screen 3": the number is where
  // it sits in the map and changes when the map is resized, so storing it would
  // leave a name that quietly lies. `screenLabel` supplies the fallback.
  return { name: '', metatiles: new Array(SCREEN_METATILES).fill(0), entities: [] };
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

/**
 * What every reference to a song becomes once `index` is gone from
 * `project.songs`: `null` (Silence) for a map or a Play music command that
 * named exactly that song, and one lower for anything that named a later one
 * — the same renumbering `resolveCommonEventIds`' callers give a deleted
 * common event's neighbours. Walks every event the project holds through
 * `allCommands` rather than each page's own list, because a Play music
 * command can be sitting inside a branch or a question same as any other —
 * `usedSwitches` in templates.js made exactly this mistake once, over a
 * switch instead of a song, and it read as two unrelated events firing
 * together rather than as what it was.
 *
 * Mutates `project` and returns it. The caller removes `project.songs[index]`
 * itself, before or after calling this — nothing here reads that list.
 */
export function renumberSongDeletion(project, index) {
  for (const map of project.maps ?? []) {
    if (map.songId === index) map.songId = null;
    else if (map.songId > index) map.songId -= 1;
  }
  for (const event of projectEvents(project)) {
    for (const page of event.pages ?? []) {
      for (const command of allCommands(page.commands)) {
        if (command.op !== 'music') continue;
        if (command.song === index) command.song = null;
        else if (command.song > index) command.song -= 1;
      }
    }
  }
  return project;
}

/**
 * What every reference to an actor becomes once `index` is gone from
 * `project.sprites.actors`: renumbered down by one for everything above it,
 * the same treatment a placement gets inline where it is deleted (sprite.js)
 * and renumberSongDeletion gives a song. Left alone, an id above the deleted
 * one silently repoints at whichever actor now happens to sit there, and an
 * id equal to it survives pointing at nothing — indistinguishable, from
 * inside the command, from a project that still has that actor.
 *
 * A Start a battle command's formation is a list, so the deleted id is
 * simply removed from it — a battle with monsters left over is still a
 * battle. Give item and Take item name exactly one actor with no such list
 * to fall back into, so their `actor` becomes `null` instead — visibly
 * missing rather than deleted or silently repointed, the same shape a Play
 * music command's `song` already is for a deleted song (normalizeEventCommand
 * above, and actorByte in main/build/textcompile.js at the other end).
 * Dropping the command outright was tried and rejected: it erases whatever
 * else the event went on to do. validateProject's own give/take check is
 * what actually stops a *live* one with a missing actor from reaching a
 * build; a disabled one keeps its scaffolding, missing actor and all.
 *
 * Walked through `allCommands`, not each page's own list, since a battle or
 * a give/take can be sitting inside a branch or a question same as any other
 * command — the same reason renumberSongDeletion walks it that way.
 *
 * Placed actors are renumbered separately, inline where they are deleted —
 * this only ever needs to run alongside that, never instead of it.
 *
 * Mutates `project` and returns it. The caller removes
 * `project.sprites.actors[index]` itself, before or after calling this —
 * nothing here reads that list.
 */
export function renumberActorDeletion(project, index) {
  for (const event of projectEvents(project)) {
    for (const page of event.pages ?? []) {
      for (const command of allCommands(page.commands)) {
        if (command.op === 'battle' && Array.isArray(command.monsters)) {
          command.monsters = command.monsters.filter((id) => id !== index).map((id) => (id > index ? id - 1 : id));
        } else if ((command.op === 'give' || command.op === 'take') && typeof command.actor === 'number') {
          if (command.actor === index) command.actor = null;
          else if (command.actor > index) command.actor -= 1;
        }
      }
    }
  }
  return project;
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
      // SELECT defaults to 'continue' rather than 'none' -- harmless on a
      // project that never saves (do_action ignores it there, same as any
      // action bound somewhere it means nothing), and the natural free slot
      // for it on a project that does.
      title: { A: 'confirm', B: 'none', SELECT: 'continue', START: 'confirm' },
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
    variables: [], // and 16 bytes, likewise named only for the author's benefit
    commonEvents: [], // bodies a `call` command reaches by stable id; see normalizeCommonEvents
    commonEventSeq: 0, // the next id a common event will be given; never reused, see resolveCommonEventIds
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

/**
 * How deep the *editor* offers to nest a command that holds commands — a branch
 * inside a branch, or an option of a question that asks another one.
 *
 * Neither the schema nor the engine has a limit: the inner one is bytes inside
 * the bytes of the outer one, and nothing is remembered but where the script
 * pointer is. This is a judgement about what stays legible in a modal, and it is
 * all it is — a project written by a later version with deeper nesting keeps
 * every command through a load and a save here.
 */
export const MAX_BRANCH_DEPTH = 8;

/**
 * A depth no authored project can reach, where normalization gives up rather
 * than recursing until the stack does. A file this deep is corrupt or hostile,
 * and failing to open it by name beats failing with a RangeError — or, far
 * worse, quietly returning a project with the deep end missing.
 */
const BRANCH_DEPTH_LIMIT = 64;

/**
 * One line of a question, which is one row of the box and cannot wrap.
 *
 * Exported because the compiler has to apply exactly this rule, for the reason
 * `conditionArgLimit` is exported: the engine draws a label by pushing glyphs
 * until the string ends, so a label the wrapper had broken into two lines would
 * put a control byte into the middle of a row of tiles.
 */
export const choiceLabel = (raw) =>
  String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, CHOICE_LIMITS.label);

/**
 * A common event id, coerced the same way wherever one is read: an entry's
 * own `id` (see `resolveCommonEventIds`, further down), a `call` command's
 * `event` reference to one (just below), and the running `commonEventSeq`
 * counter itself. All three have to agree on exactly what counts as a valid
 * id, or two of them can drift apart on the same malformed value — a `call`
 * byte-clamped to 255 while its target kept an authored id of 300 is what
 * let one stop reaching the other, and `buildProject` is handed live,
 * possibly-unnormalized project state, so a reference read straight off an
 * in-memory command has to be run through this too, not only the definition
 * it names — trusting `command.event` to already be a number the moment it
 * is read is the same mistake as trusting `entry.id` to be.
 *
 * A non-negative *safe* integer, or a string that is genuinely one, is a
 * common event id; anything else — missing, `null` (which `Number(null)` is
 * 0, not "absent" — worth calling out, since it is the one input this cannot
 * fall through to a bare `Number()` call for), `''` or a blank string, a
 * boolean or an array (`Number(false)` and `Number([])` are also 0, the same
 * trap by a different door — this is why only `number` and `string` are
 * handed to `Number()` at all), negative, fractional, NaN, or past
 * `Number.MAX_SAFE_INTEGER` — is not a common event id, and this returns
 * null rather than rounding, truncating, coercing or wrapping one into
 * existence. `resolveCommonEventIds` reassigns an entry
 * whose id fails this the same way it reassigns one that is simply missing;
 * a `call` whose reference fails it is given a sentinel a real id can never
 * be (see `normalizeEventCommand`) so it compiles away instead of being
 * reinterpreted as a call to whatever the fallback would have been.
 *
 * Safe rather than merely an integer: `next++` in `resolveCommonEventIds`
 * cannot tell 9007199254740992 from 9007199254740993 — the double past
 * which every integer stops having a unique successor — so trusting a
 * seq or an id at that point would start handing out duplicates. A project
 * would need quadrillions of added-and-deleted common events to reach it
 * legitimately; the practical reason to guard it is a hand-edited file, and
 * the guard is to distrust the number rather than try to advance it, which
 * is exactly what returning null and falling back through the normal
 * missing-id path already does.
 *
 * It is never written into the ROM as a byte of its own — only the table
 * slot it resolves to at compile time is — so nothing here bounds it to
 * 255, and a project that has added and deleted enough common events to
 * pass that number keeps working.
 */
export function commonEventId(raw) {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * What a `call` command's `event` becomes when its reference cannot be made
 * into a real id — a negative number a real id can never be, rather than a
 * fallback like 0 that a real common event could actually be sitting at.
 * `commonEventId(NO_COMMON_EVENT_ID)` is null by construction, so
 * `commonEventTableIndex.get(...)` in main/build/textcompile.js asking the
 * same question it always asks finds no slot on its own, without a separate
 * "is this the sentinel" check anywhere — never reinterpreted as a call to
 * whichever event a missing value happened to coerce to.
 *
 * Named apart from textcompile.js's own `NO_COMMON_EVENT_SLOT` ($FF, the
 * table-slot sentinel `script_op_call` in engine/script.asm actually reads
 * and refuses) on purpose, not just kept in separate modules: this is a
 * schema-level "no reference chosen" value in the same space real ids live
 * in, and $FF is a real id a stable-id project could someday reach. A caller
 * that imported the wire sentinel and stored it here — or the reverse —
 * would still run, and `commonEventId(255)` would accept it as a real id
 * rather than reject it the way this value is built to be rejected.
 */
export const NO_COMMON_EVENT_ID = -1;

function normalizeEventCommand(raw, depth = 0) {
  const command = EVENT_COMMANDS.find((entry) => entry.id === raw?.op);
  if (!command || command.id === 'end') return null;
  if (command.nests && depth >= BRANCH_DEPTH_LIMIT) {
    throw new Error(`This project nests event commands more than ${BRANCH_DEPTH_LIMIT} deep.`);
  }
  // Every list of commands inside this one, wherever it hangs: a branch's two
  // sides and a question's options are the same recursion with different names.
  const inner = (list) =>
    (Array.isArray(list) ? list : []).map((entry) => normalizeEventCommand(entry, depth + 1)).filter(Boolean);
  const out = { op: command.id };
  // Only when it is actually off, so a project that has never used the toggle
  // is byte-for-byte what it was before the toggle existed.
  if (raw?.off === true) out.off = true;
  for (const arg of command.args) {
    if (arg === 'text') out.text = String(raw?.text ?? '').slice(0, MAX_DIALOGUE);
    else if (arg === 'switch') out.switch = clamp(raw?.switch, 0, RPG_LIMITS.switches - 1, 0);
    else if (arg === 'member') out.member = clamp(raw?.member, 0, RPG_LIMITS.party - 1, 0);
    else if (arg === 'variable') out.variable = clamp(raw?.variable, 0, RPG_LIMITS.variables - 1, 0);
    // Not the generic byte clamp below: a common event id is resolved to a
    // table slot at compile time rather than written into the ROM itself,
    // so it is not bounded to 255 — see commonEventId. An invalid reference
    // becomes NO_COMMON_EVENT_ID rather than 0 — 0 is a common event id
    // common events actually get, so falling back to it would silently
    // retarget a dangling or hand-edited call to whatever that one happens
    // to be.
    else if (arg === 'event') out.event = commonEventId(raw?.event) ?? NO_COMMON_EVENT_ID;
    // A song index, or `null` for Silence — the same shape map.songId is,
    // and deliberately not clamped against how many songs the project
    // actually has: buildProject compiles the project the app is holding
    // rather than one freshly normalized, so the true ceiling is enforced
    // where the song count is known, at compile time (see songByte in
    // main/build/textcompile.js), the same reason 'warp's screen is a loose
    // byte clamp here and a real one in the compiler.
    else if (arg === 'song') out.song = raw?.song === null || raw?.song === undefined ? null : clamp(raw?.song, 0, 255, 0);
    else if (arg === 'branch') {
      out.cond = normalizeCondition(raw?.cond);
      out.then = inner(raw?.then);
      out.else = inner(raw?.else);
    } else if (arg === 'choice') {
      // Extra options are dropped rather than kept for a later version to
      // honour, which is the one place this schema does not preserve what it
      // was given: the box has four rows, so a fifth option is not data the
      // engine could ever be taught to show — it is an option the player would
      // have no way to pick and no way to see. choiceOptionsSlice
      // (shared/eventrules.js) is the same truncation encodeBody
      // (main/build/textcompile.js) and liveCommands apply, so a live,
      // not-yet-saved project reads the same "how many options" answer here
      // as it would at compile time.
      out.options = choiceOptionsSlice(raw?.options, CHOICE_LIMITS.options).map((option) => ({
        text: choiceLabel(option?.text),
        commands: inner(option?.commands)
      }));
      // A question with nothing to choose between is not a question. It would
      // compile to a box that comes up, offers nothing and takes the player's
      // answer as option zero, which is somewhere past the end of the command.
      if (!out.options.length) return null;
    } else if (arg === 'monsters') {
      // Loosely clamped here and bounded for real at compile time, the same
      // reason 'warp's screen is: buildProject compiles the project the app
      // is holding, not one freshly normalized, so only the compiler knows
      // how many actors actually exist. battleFormationSlice is the same
      // truncation encodeCommand applies, ahead of the id clamp here rather
      // than after it, so the two cannot disagree about which entries this
      // formation even has room for.
      out.monsters = battleFormationSlice(raw?.monsters).map((id) => clamp(id, 0, 255, 0));
      // A battle with nothing in it is not a battle — it would compile to an
      // instant, silent victory, the same non-command a question with no
      // options would be.
      if (!out.monsters.length) return null;
    }
    // A Give item / Take item target, or `null` for one that no longer names
    // an actor -- the same shape 'song' is, and for the same reason: actor
    // deletion (renumberActorDeletion) has exactly one thing it can do with
    // a Give/Take that named the actor being removed, since neither command
    // holds a list to drop the id from the way a battle formation does. Not
    // 0 or any other number — a real actor could be sitting at either — and
    // not dropping the command outright either, which would erase whatever
    // else the event went on to do. `actorByte` (main/build/textcompile.js)
    // is the other half: NO_ACTOR for null, the same as songByte's NO_SONG.
    else if (arg === 'actor') out.actor = raw?.actor === null || raw?.actor === undefined ? null : clamp(raw?.actor, 0, 255, 0);
    // Heal/Damage's value goes through damageAmount (shared/eventrules.js)
    // rather than the generic clamp below: encodeCommand and
    // projectUsesCombat (shared/font.js) both have to agree with whatever
    // this saves, so it is the single clamp all of them share rather than a
    // second one written here that could round a fractional value
    // differently than they do.
    else if (arg === 'value' && (command.id === 'heal' || command.id === 'damage')) out.value = damageAmount(raw?.value);
    else out[arg] = clamp(raw?.[arg], 0, 255, 0);
  }
  return out;
}

/**
 * How far a page condition's first header byte may go, which depends on what it
 * names. Exported because the compiler has to apply exactly this rule: the
 * engine indexes the variable array with that byte and does not range-check it,
 * on the grounds that only the thing that knows how many variables the build has
 * can guard it. Two answers to "how far" would put that byte past the array.
 */
export function conditionArgLimit(type) {
  const condition = EVENT_CONDITIONS.find((entry) => entry.id === type) ?? EVENT_CONDITIONS[0];
  if (condition.arg === 'switch') return RPG_LIMITS.switches - 1;
  if (condition.arg === 'variable') return RPG_LIMITS.variables - 1;
  return 255;
}

/**
 * A condition, wherever one appears. A page has one and so does a branch, and
 * they are the same three bytes in the same order in the ROM, so they are the
 * same object here — one shape, one clamp, one encoder, one engine routine.
 */
function normalizeCondition(raw) {
  const condition = EVENT_CONDITIONS.find((entry) => entry.id === raw?.type) ?? EVENT_CONDITIONS[0];
  const cond = {
    type: condition.id,
    arg: condition.arg ? clamp(raw?.arg, 0, conditionArgLimit(condition.id), 0) : 0
  };
  // Only conditions that compare against a number carry the value byte, and
  // only they get the field — exactly as `off` is kept only when it is true.
  // Every page in every existing project would otherwise gain a `value: 0` on
  // its next save, which is a diff saying nothing happened.
  if (condition.value) cond.value = clamp(raw?.value, 0, 255, 0);
  return cond;
}

function normalizeEventPage(raw) {
  return {
    cond: normalizeCondition(raw?.cond),
    commands: (Array.isArray(raw?.commands) ? raw.commands : []).map((entry) => normalizeEventCommand(entry)).filter(Boolean)
  };
}

/** An event is a list of pages; the engine runs the first whose condition holds. */
function normalizeEvent(raw) {
  const pages = (Array.isArray(raw?.pages) ? raw.pages : []).map(normalizeEventPage);
  return pages.length ? { pages } : null;
}

/**
 * The id each entry of `commonEvents` actually has, in the same order, and
 * the seq that has to be persisted afterward — resolved the same way whether
 * or not the list has been through `normalizeProject` since an entry was
 * added or removed.
 *
 * `seq` is the highest id this project has ever handed out, plus one, kept
 * as its own field (`project.commonEventSeq`) rather than derived from the
 * list on every load — deleting the common event with the highest id would
 * otherwise make a lower, already-spent number look free again. It is what
 * a fresh entry's id is drawn from, and *only* from: the lowest currently
 * unused id is exactly the one a just-deleted entry left behind, so handing
 * it to the next new entry would silently give a dangling `call` — one still
 * naming the id of whatever was deleted — a brand new target to run instead
 * of leaving it dangling. That is the same failure a stable id exists to
 * prevent in the first place, so ids must never be reused, only ever handed
 * out going up.
 *
 * An id already on an entry is kept if it is a valid id (see `commonEventId`)
 * nothing earlier in the list has already claimed, and pulls `seq` past
 * itself if it was ahead of what had been persisted — a hand-edited file, or
 * a build made before this project's last save caught up. Everything else —
 * missing, invalid, or already spent by an earlier entry in the same list —
 * draws the next id off `seq` and consumes it.
 *
 * The compiler needs this as much as the schema does and for the same
 * reason `screenCount` and `conditionArgLimit` are recomputed in
 * `main/build/textcompile.js` rather than trusted from a normalized project:
 * `buildProject` is handed the project the app is holding, not one freshly
 * renormalized, so a common event a live session added is compiled against
 * whatever id and seq it actually carries in memory. Both callers asking
 * this the same way is what makes them agree on which id a given entry has.
 */
export function resolveCommonEventIds(commonEvents, seq) {
  let next = commonEventId(seq) ?? 0;
  const used = new Set();
  const ids = [];
  for (const entry of commonEvents ?? []) {
    const requested = commonEventId(entry?.id);
    const valid = requested !== null && !used.has(requested);
    const id = valid ? requested : next++;
    used.add(id);
    if (id >= next) next = id + 1;
    ids.push(id);
  }
  return { ids, seq: next };
}

/**
 * Every common event that reaches the ROM, in table order: `{ entry, id }`
 * pairs, one per `project.commonEvents` entry with at least one live page
 * (`compiledPages(entry.event).length > 0`), each carrying the id
 * `resolveCommonEventIds` gives it — the same id a `call` command's own
 * target names. This is the single definition of "gets a slot in the
 * compiled table at all": main/build/textcompile.js assigns each pair's
 * position in this array as that common event's slot, in this exact order,
 * and `liveCommonEventIds` below asks the identical question as a plain id
 * lookup instead of a table position. A second implementation of this filter
 * is exactly how a call ends up approved on one side and dropped on the
 * other — the same shape of gap `liveCommands`/`encodeBody` closes for a
 * single command, one level up: an admission rule rather than an opcode.
 */
export function liveCommonEvents(project) {
  const { ids } = resolveCommonEventIds(project?.commonEvents, project?.commonEventSeq);
  return (project?.commonEvents ?? [])
    .map((entry, index) => ({ entry, id: ids[index] }))
    .filter(({ entry }) => compiledPages(entry?.event).length > 0);
}

/** The ids of every common event `liveCommonEvents` admits — what a `call` can actually reach. */
export function liveCommonEventIds(project) {
  return new Set(liveCommonEvents(project).map(({ id }) => id));
}

/**
 * A common event: the same page/condition/command shape a placement's own
 * event is, with a name instead of a place — `call` is what reaches it, from
 * however many placements want to. Compiled into the shared events table
 * exactly like a placed actor's event, and edited with the same modal.
 *
 * Whole-array rather than per-entry, because the `id` a `call` stores has to
 * be assigned with the rest of the list — and the running `seq` — in view:
 * `call` references an id, not a position, so that deleting entry 0 does not
 * silently turn a call naming entry 1 into a call naming entry 2 — the
 * defect `usedSwitches` already had to be taught to see through once, for a
 * different reference hiding in a different place.
 */
function normalizeCommonEvents(raw, rawSeq) {
  const source = (Array.isArray(raw) ? raw : []).slice(0, LIMITS.commonEvents);
  const { ids, seq } = resolveCommonEventIds(source, rawSeq);
  const commonEvents = source.map((entry, index) => ({
    id: ids[index],
    name: normalizeLabel(entry?.name, `Common event ${index + 1}`),
    event: normalizeEvent(entry?.event)
  }));
  return { commonEvents, commonEventSeq: seq };
}

function normalizeEntity(raw) {
  const props = raw?.props && typeof raw.props === 'object' ? { ...raw.props } : {};
  const event = normalizeEvent(props.event);
  // An unknown trigger becomes the one every event had before triggers existed,
  // rather than being dropped: a project written by a later version keeps its
  // events, and they run the way this version's engine knows how to run them.
  const trigger = EVENT_TRIGGERS.some((entry) => entry.id === props.trigger)
    ? props.trigger
    : EVENT_TRIGGERS[0].id;
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
      // What the author calls this placement — "Gate key chest", not "Chest".
      // It lives in the prop bag with the rest of the per-placement data and is
      // compiled by nothing; `entityLabel` is what reads it.
      name: authorName(props.name),
      toScreen: clamp(props.toScreen, 0, 255, 0),
      toX: clamp(props.toX, 0, 240, 112),
      toY: clamp(props.toY, 0, 224, 112),
      dialogue,
      event,
      trigger,
      hideSwitch
    }
  };
}

function normalizeScreen(raw) {
  const screen = createScreen();
  screen.name = authorName(raw?.name);
  const source = Array.isArray(raw?.metatiles) ? raw.metatiles : [];
  for (let i = 0; i < SCREEN_METATILES && i < source.length; i++) {
    screen.metatiles[i] = clamp(source[i], 0, LIMITS.metatiles - 1, 0);
  }
  if (Array.isArray(raw?.entities)) {
    screen.entities = raw.entities.slice(0, LIMITS.entitiesPerScreen).map(normalizeEntity);
  }
  return screen;
}

/**
 * How a screen reads in a menu. Every warp target, door target, title-screen
 * picker and search result goes through this, so a screen that has been named
 * is named everywhere at once and one that has not still says where it is.
 */
export function screenLabel(project, mapIndex, screenIndex) {
  const map = project.maps[mapIndex];
  if (!map) return `screen ${screenIndex}`;
  const name = map.screens[screenIndex]?.name?.trim();
  return `${map.name} · ${name || `screen ${screenIndex}`}`;
}

/**
 * Every screen in the project, in the order the engine numbers them — maps in
 * order, screens in order. That order is a wire format: it is what a door's
 * `toScreen` and a warp command's `screen` index into, and `flattenScreens` in
 * the generator builds the compiled table the same way. A test asserts the two
 * agree, because a disagreement would send the player to the wrong screen with
 * nothing in the UI looking wrong.
 */
export function flatScreens(project) {
  const out = [];
  project.maps.forEach((map, mapIndex) => {
    map.screens.forEach((screen, screenIndex) => {
      out.push({ mapIndex, screenIndex, screen, map, label: screenLabel(project, mapIndex, screenIndex) });
    });
  });
  return out;
}

/** How a placed actor reads in a list: what the author called it, or what it is. */
export function entityLabel(project, entity) {
  const actor = project.sprites.actors[entity?.actorId];
  return entity?.props?.name?.trim() || actor?.name || `Actor ${entity?.actorId ?? 0}`;
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

export const CODE_LIMITS = { files: 64 };

/**
 * Source text as the generator will write it: LF endings and a trailing newline,
 * so a save/load round-trip is byte-identical and the last line of a file never
 * runs into the next `.include`.
 */
export function normalizeCodeText(raw) {
  // Source is authored data, so normalization may make line endings canonical
  // but must never truncate it. A project can be edited outside the app, and a
  // later save must not silently throw away the tail of a large file.
  const text = String(raw ?? '').replace(/\r\n?/g, '\n');
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

  const { commonEvents, commonEventSeq } = normalizeCommonEvents(raw.commonEvents, raw.commonEventSeq);

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
    variables: (Array.isArray(raw.variables) ? raw.variables : [])
      .slice(0, RPG_LIMITS.variables)
      .map((name, index) => normalizeLabel(name, `Variable ${index}`)),
    commonEvents,
    commonEventSeq,
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
/**
 * Whether a live `save` command survives to the ROM anywhere in the project —
 * the single answer to "does this build need SAVE_ENABLED at all," asked by
 * `generate.js` (whether to assemble engine/save.asm's body and set the
 * header's battery bit), this validator's battery/title checks below, and the
 * Map Forge's own gating of the command, so the three cannot end up with three
 * different opinions about the same project. liveCommands + compiledPages,
 * not allCommands: a Save switched off, or sitting inside a switched-off
 * branch, is scaffolding the compiler already drops, and charging a project
 * for the header bit or the title's Continue option over a command the ROM
 * will never run would be exactly the "looks functional, does nothing" case
 * this codebase refuses to ship the other way around.
 */
export function projectUsesSave(project) {
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (command.op === 'save') return true;
      }
    }
  }
  return false;
}

export function validateProject(project) {
  const problems = [];
  const add = (severity, where, message) => problems.push({ severity, where, message });

  if (!project.maps.length) add('error', 'Map Forge', 'A project needs at least one map.');

  project.maps.forEach((map, mapIndex) => {
    map.screens.forEach((screen, index) => {
      if (screen.entities.length > LIMITS.entitiesPerScreen) {
        add(
          'error',
          'Map Forge',
          `${screenLabel(project, mapIndex, index)} has ${screen.entities.length} entities; ` +
            `the engine allows ${LIMITS.entitiesPerScreen}.`
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
    // Walked the same way renumberSongDeletion and renumberActorDeletion
    // are: a battle command can be sitting inside a branch or a question,
    // not only on a page's own list. An empty formation is checked here,
    // not only trusted to the Map Forge's own Save button, because the
    // renderer hands Build the live project rather than a normalized one —
    // deleting the only actor a formation named (renumberActorDeletion)
    // reaches this same live state from a completely different screen, with
    // no Save button of its own to catch it at.
    //
    // liveCommands, not allCommands, and compiledPages rather than every
    // page: a battle command an author has switched off, or one sitting
    // inside a switched-off branch, is scaffolding the compiler already
    // ignores (encodeBody, main/build/textcompile.js), so a build must not
    // stop for it. allCommands exists for the opposite question — what a
    // switch or actor is named by, off or not — and would fail a build the
    // ROM was never going to contain. The choice-option limit is passed in
    // rather than left to liveCommands' own default: a fifth option here is
    // exactly as unreachable as a battle command switched off, and skipping
    // it is what keeps this traversal the one encodeBody itself performs.
    let emptyBattles = 0;
    let staleBattleMonsters = 0;
    // A missing actor only blocks a build while the command that names it
    // is live -- the same rule an empty battle formation follows.
    // actorMissing, not `=== null`: renumberActorDeletion's null is one way
    // to end up with nothing to give, but not the only one a live project
    // can hold — an id past the end of the actor list, from a later
    // version's project or a hand-edited one, resolves to nothing exactly
    // as surely and has to be caught the same way, or it passes review,
    // compiles to NO_ACTOR, and still reaches add_item.
    for (const event of projectEvents(project)) {
      for (const page of compiledPages(event)) {
        for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
          if (command.op !== 'battle') continue;
          // Sliced to RPG_LIMITS.monstersPerBattle before anything asks which
          // ids are still real actors -- the same order encodeCommand applies
          // them in. A valid id sitting past the truncation point never
          // reaches the ROM, so a formation whose only real monster falls in
          // the fifth slot has to read as empty, not merely stale.
          const compiled = battleFormationSlice(command.monsters);
          const validMonsters = compiled.filter(
            (id) => Number.isInteger(id) && id >= 0 && id < project.sprites.actors.length
          );
          if (!validMonsters.length) emptyBattles++;
          else if (validMonsters.length < compiled.length) staleBattleMonsters++;
        }
      }
    }
    if (emptyBattles) {
      add(
        'error',
        'Map Forge',
        `${emptyBattles} Start a battle command${emptyBattles === 1 ? '' : 's'} name no monsters, which would ` +
          'compile to an instant win rather than a fight. Add at least one monster to each.'
      );
    }
    if (staleBattleMonsters) {
      add(
        'warning',
        'Map Forge',
        `${staleBattleMonsters} Start a battle command${staleBattleMonsters === 1 ? '' : 's'} name an actor that ` +
          'no longer exists.'
      );
    }
  }

  // Save is not RPG-only either -- an action project on a battery-capable
  // board can save too -- so it is checked here rather than inside the
  // RPG-only block above, the same reasoning Give/Take below already
  // documents. Two ways a live Save reaches a build it cannot work on:
  if (projectUsesSave(project)) {
    const saveMapper = resolveMapper(project.cartridge.mapper);
    if (!batteryCapable(saveMapper)) {
      add(
        'error',
        'Build',
        `${batteryUnsupportedReason(saveMapper)} Choose MMC1 or MMC3 in the Build panel, or remove the Save command.`
      );
    }
    // Continue is a title-screen option (engine/title.asm); a save with no
    // title to offer it from would be a ROM you cannot load a save in rather
    // than a build error you can act on before shipping it.
    if (project.project.titleMap === null || project.project.titleMap === undefined) {
      add(
        'error',
        'Map Forge',
        'A project with a Save command needs a title screen — Continue has nowhere to appear without one. ' +
          'Set a title map, or remove the Save command.'
      );
    }
  }

  // Give item / Take item is a base-engine command (engine/ui.asm's
  // add_item/inv_items, driven by OP_GIVE/OP_TAKE in every build), not one
  // BATTLE_ENABLED gates the way the battle checks above are -- an action
  // project offers it too, so this runs unconditionally rather than inside
  // the RPG-only block. actorMissing is the same "does this resolve"
  // question the compiler (actorByte) and the Map Forge's own select ask;
  // checking only for `null` here would miss an id past the end of the
  // actor list that was never produced by a deletion at all.
  let missingGiveTake = 0;
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (
          (command.op === 'give' || command.op === 'take') &&
          actorMissing(project.sprites.actors, command.actor)
        ) {
          missingGiveTake++;
        }
      }
    }
  }
  if (missingGiveTake) {
    add(
      'error',
      'Map Forge',
      `${missingGiveTake} Give item / Take item command${missingGiveTake === 1 ? '' : 's'} do not name a real ` +
        'actor. Pick an actor or switch the command off.'
    );
  }

  // A call to a common event that no longer has anything live in it is
  // structurally the same gap an empty battle formation and a missing give/
  // take actor are: liveCommands has no way to ask "does this reference
  // resolve" for the same reason it cannot for those two (shared/
  // eventrules.js), so a dangling call used to reach review clean and
  // compile away silently. It no longer compiles away -- textcompile.js's
  // 'call' case now emits [OP_CALL, NO_COMMON_EVENT_SLOT] rather than dropping
  // the command, and script_op_call (engine/script.asm) stops the event on
  // that sentinel the same way it already stopped one on an unrecognised
  // opcode or a Give/Take naming no actor -- but this check still refuses
  // the *build*, the same as it refuses a missing Give/Take actor or an
  // empty battle formation: an author should be told the reference is
  // broken, not have the page quietly stop running when the ROM does.
  // liveCommonEventIds is built on liveCommonEvents, the same admission rule
  // main/build/textcompile.js uses to decide which entries get a table slot
  // at all -- one definition rather than two that could disagree about which
  // id a deleted or emptied-out common event leaves behind, so a build can no
  // longer depend on the engine's own runtime stop to be the only thing
  // catching this.
  const liveEventIds = liveCommonEventIds(project);
  let danglingCalls = 0;
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (command.op === 'call' && !liveEventIds.has(commonEventId(command.event))) {
          danglingCalls++;
        }
      }
    }
  }
  if (danglingCalls) {
    add(
      'error',
      'Map Forge',
      `${danglingCalls} Run common event command${danglingCalls === 1 ? '' : 's'} name a common event that no ` +
        'longer exists or has nothing left in it. Pick another common event or switch the command off.'
    );
  }

  return problems;
}

/** Index helpers shared by Map Forge and the generator. */
export const screenIndex = (map, col, row) => row * map.gridW + col;
export const metatileIndex = (col, row) => row * LIMITS.screenCols + col;
