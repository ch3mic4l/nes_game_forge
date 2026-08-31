// The Forge project data model.
//
// A project lives on disk as a folder of JSON files (see main/project-io.js) but
// is a single plain object in memory. This module owns the schema, the engine
// limits every Forge validates against, and normalisation of loaded data so a
// hand-edited or older project never crashes the UI.

import { BLANK_TILE } from './chr.js';
import {
  normalizeSong,
  NO_SONG,
  songByte,
  songFrameLength,
  normalizeSfx,
  NO_SFX,
  sfxByte,
  sfxFrameLength,
  SFX_MAX_STEPS
} from './audio.js';
import {
  allCommands,
  choiceOptionsSlice,
  compiledPages,
  damageAmount,
  liveCommands,
  projectEvents,
  routeLegs
} from './eventrules.js';
import {
  DEFAULT_MAPPER,
  resolveMapper,
  mapperById,
  mirroringOptions,
  tilesetLimit,
  rpgCapable,
  rpgUnsupportedReason,
  saveMediaImplemented,
  saveUnsupportedReason,
  reservesFlashSaveRegion,
  screenCapacity,
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
  projectUsesHeartArt,
  projectUsesEffectiveTitle
} from './font.js';

export const ENGINE_VERSION = 1;
export const PROJECT_FORMAT = 1;

/**
 * The byte that means "names no actor" — a formation slot nothing filled, a
 * Give/Take whose actor does not resolve, a monster's drop that no longer
 * names one, and a Carrying item condition whose actor was deleted.
 *
 * It lives here rather than in main/build/textcompile.js (which is where it
 * used to, and which now re-exports it) because the compiler stopped being
 * its only user: `renumberActorDeletion` writes it too, and
 * `mapEncounterFormation` was already padding with a bare `0xff` that only
 * textcompile's own comment tied back to this. Three literals meaning one
 * thing is exactly what the single-writer rule is about, and this side of the
 * boundary is the one both the schema and the compiler can import from.
 *
 * **It is above `LIMITS` because `LIMITS.actors` is derived from it.** A
 * sentinel that shares its value space with real ids is only unambiguous if
 * the ids never reach it, so the roster is capped at exactly this many
 * actors — ids `0..$FE`. Before that cap existed, actor 255 was creatable and
 * collided: `actorByte` had always truncated such a reference to "missing" at
 * compile time, and once `renumberActorDeletion` made `$FF` a fixed point
 * that truncation widened into deletion-time data loss, with the two kinds of
 * reference disagreeing about the same deletion (a list filtered id 255 out;
 * a scalar read it as already-missing and left it). Capping the roster is the
 * same answer `MAX_TABLE` already gives for the compiled events table, and it
 * closes both at the source rather than teaching every `$FF` comparison in
 * the engine and the compiler to mean two things.
 */
export const NO_ACTOR = 0xff;

/**
 * The byte that means "names no item" — the same role `NO_ACTOR` plays, one
 * id space over. `inv_items`, Give/Take's `item` field, a Carrying
 * condition's `arg` and `battle.drop` all carry an item id directly now
 * (`.if ITEMS_ENABLED` in the engine; `main/build/textcompile.js` and
 * `main/build/battletables.js` on the compiler side) — bounding the id space
 * to a byte, with its own sentinel, meant this phase inherited a clean
 * ceiling instead of rediscovering the exact defect `NO_ACTOR`'s own
 * docstring already describes fixing once — an id 255 becoming creatable
 * and colliding with "nothing."
 */
export const NO_ITEM = 0xff;

/**
 * The byte that means "names no metasprite" — one id space over from
 * `NO_ACTOR`/`NO_ITEM`, for an item's own `metaspriteId`. Two things share
 * this value on purpose: `null` still means "not set — derive an icon from
 * the backing actor" (generate.js's own legacy fallback), while
 * `NO_METASPRITE` is how an author says "this item explicitly has no icon"
 * once there is an editor to say it with. `renumberMetaspriteDeletion`
 * treats both as fixed points — `null` because it never named a real
 * metasprite to begin with, `NO_METASPRITE` because it is a sentinel, not an
 * index, and shifting it the way a real reference above a deleted slot
 * shifts would silently turn "no icon" into a real, wrong one. The matching
 * engine-side equate lives in `engine/constants.asm`, hand-written like
 * `NO_ACTOR`/`NO_ANIM`/`NO_ENTITY`/`NO_MAP` already are — that whole family
 * is independent per-array literals that agree with their JS counterpart by
 * convention and comment, not by generation, and this one follows it.
 *
 * Defined here, before `LIMITS`, for the same reason `NO_ACTOR`/`NO_ITEM`
 * already are: `LIMITS.metasprites` below is this value, not a literal 255,
 * the identical shape as `LIMITS.actors`/`LIMITS.items` and for the
 * identical reason — see `LIMITS`' own comment on that field.
 */
export const NO_METASPRITE = 0xff;

/** Hard limits imposed by the NES and by the template engine. */
export const LIMITS = {
  tilesPerTable: 256,
  metatiles: 64,
  screenCols: 16, // metatiles across a screen (16 * 16px = 256px)
  screenRows: 15, // metatiles down a screen (15 * 16px = 240px)
  mapGrid: 4, // screens per axis
  entitiesPerScreen: 8,
  boundTilesPerScreen: 8, // switch-bound tiles (design-tile.md §10) -- matches
                          // entitiesPerScreen's own precedent
  palettes: 4,
  metaspriteTiles: 16,
  animationFrames: 32,
  // One body, callable from any placement's event — a chest, a shop, a
  // recurring cutscene — rather than authored again at every place it is
  // used. The real ceiling is the 255-entry compiled events table it shares
  // with every placed actor's own event; this is the authoring-side cap that
  // keeps the list itself readable well below that.
  commonEvents: 32,
  // Ids 0..$FE. Deliberately the sentinel's own value rather than a literal
  // 255: the cap exists *because* NO_ACTOR is a byte in the same space, so
  // writing the two independently is how they would drift apart. Every actor
  // reference in the engine is a byte index, so this is a real ceiling rather
  // than an authoring convenience — though capacity (checkCapacity's
  // per-actor table bytes, and battletables' 30 bytes an actor in the banked
  // region) refuses a project far below it long before this does.
  actors: NO_ACTOR,
  // Ids 0..$FE, same shape and same reason as `actors` above, one id space
  // over: `NO_ITEM` is a byte in this space too.
  items: NO_ITEM,
  // Ids 0..$FE, the identical shape again, one id space further over. Round
  // 5 finding: before this existed, a metasprite array was genuinely
  // uncapped (no LIMITS entry, and the Sprite Forge's own Add button never
  // checked one), so a project could reach 256 real metasprites — id 255
  // among them, which is byte-identical to NO_METASPRITE. From that point,
  // an item's derived icon computing to a real metasprite 255 and an item's
  // own explicit "no icon" were the same byte, with no way to tell them
  // apart at generation time or at deletion time (renumberMetaspriteDeletion's
  // fixed-point check for the sentinel would fire for a real reference to
  // metasprite 255 too). Capping the id space the same way actors/items
  // already are closes it the same way: a real metasprite can never again
  // be assigned the sentinel's own value.
  metasprites: NO_METASPRITE,
  // Ids 0..$FE, the identical shape again, one id space further over: NO_SFX
  // is a byte in this space too, so the cap is the sentinel's own value.
  sfx: NO_SFX,
  // Re-exported from shared/audio.js for display/UI purposes only --
  // shared/audio.js is the single writer (SFX_MAX_STEPS, an authoring limit,
  // not a format one), this is an alias, not a second definition.
  sfxSteps: SFX_MAX_STEPS
};

/**
 * What deleting an actor costs while the roster is over `LIMITS.actors`, or an
 * empty string when it is not.
 *
 * A pure string rather than a line inside the Sprite Forge's confirmation so
 * it can be asserted directly; `npm run smoke` covers the other half, that it
 * actually reaches the dialog. It exists because the build refusal does not
 * reach this path: `validateProject` is rendered only by the Build Forge, and
 * a project reopens in whichever Forge was last active, so an over-cap
 * project can be opened and edited from the Actors tab by somebody who has
 * never seen the refusal — and the deletion is where the references go.
 */
export const overCapDeleteWarning = (project) =>
  (project?.sprites?.actors?.length ?? 0) > LIMITS.actors
    ? `This project is over the ${LIMITS.actors}-actor ceiling, so references to any actor above id ` +
      `${LIMITS.actors - 1} are not preserved — deleting an actor now will not bring them back. Bring the ` +
      'roster under the ceiling first if you need them.'
    : '';

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
 * What an item does when it is used or spent — `none` for a key item, a
 * pickup with only Give/Take/Carrying semantics, or a stale/legacy item
 * nothing else populates. The order is the wire format the same way
 * `BEHAVIORS`/`EVENT_TRIGGERS` already are: a later round's `EFFECT_*`
 * equates in `engine/constants.asm` are this list written down, so `none`
 * stays index 0 for the same reason `interact` does in `EVENT_TRIGGERS` — it
 * is what every item meant before this field existed, and `normalizeItem`'s
 * own migration (below) falls back to it whenever an item's backing actor
 * never had a positive `battle.heal` to derive one from. Round 2
 * (`use_item_apply`, engine/ui.asm) gave the field/menu "spend an item"
 * action (`use_item`, every game type) a real reader for all three kinds:
 * `none` is a key item, kept rather than spent; `heal` and `damage` both
 * apply and are spent, through whichever health model the build has. `heal`
 * is also read by `item_heal` (`main/build/battletables.js`), the RPG battle
 * ITEM menu (`item_chosen`, engine/battleturn.asm) — but round 3's
 * `build_item_list` (engine/battleui.asm) filters that menu's own list to
 * `kind == heal AND amount > 0` first, so `item_chosen` only ever sees a row
 * it can actually spend; a `damage`-kind item or a `heal`-kind item left at
 * Amount 0 is a real, valid item everywhere else, it simply never appears
 * there as a choice. See `effectHint` (renderer/forges/items/items.js) for
 * the one thing still worth telling the author: `damage` has no
 * battle-menu presence at all, by design, so it is field-only in an RPG.
 * See `normalizeItem`'s own comment on why the migration that populates
 * this field is one-time rather than re-derived on every build.
 */
export const ITEM_EFFECT_KINDS = [
  { id: 'none', label: 'No effect' },
  { id: 'heal', label: 'Heals' },
  { id: 'damage', label: 'Damages' }
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
  { id: 'hasItem', label: 'Carrying item', arg: 'item' },
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
 * Whether a Give item / Take item command's `item`, a Carrying condition, or
 * a `battle.drop` — every one of them an *item* reference now — still names
 * a real actor once resolved through it. The single question the compiler
 * (`actorByte` below), `validateProject` and the Map Forge's own selects all
 * ask, so an id that does not resolve reads the same way no matter which of
 * them is asking. Not merely `null` — the mark `renumberActorDeletion`
 * leaves — but any id no actor currently sits at: a project written by a
 * later version, or a hand-edited one, can hold one that was never `null` to
 * begin with. Validating against "is this the deletion sentinel" instead of
 * "does this resolve" is exactly the gap that let an out-of-range id pass
 * review, compile to NO_ACTOR, and still reach `add_item` with a byte that
 * indexes the actor tables past their end.
 */
export const actorMissing = (actors, id) =>
  id === null || id === undefined || !Number.isInteger(id) || id < 0 || id >= (actors?.length ?? 0);

/**
 * The byte a formation slot, an entity placement, or any other directly-typed
 * actor reference becomes: NO_ACTOR for anything `actorMissing` says does not
 * resolve — `null`, or any other id no actor sits at — and the actor's own
 * id otherwise. Defined here rather than in main/build/textcompile.js (where
 * it used to live, and which now re-exports it) for the same reason
 * `NO_ACTOR` itself moved there once `renumberActorDeletion` needed to write
 * it: `itemMissing` below, the migration and `validateProject` all need this
 * same resolution and shared/ cannot import from main/build/.
 */
export function actorByte(actors, id) {
  return actorMissing(actors, id) ? NO_ACTOR : id;
}

/**
 * Whether an item id exists in `project.items` — nothing more. This is
 * deliberately narrower than it used to be: before Give/Take/Carrying/drops
 * carried item ids directly on the wire, an item's validity as a *reference*
 * and its `actorId`'s own resolution were the same question, because the
 * compiler had nowhere else to go but through the backing actor. Now that
 * the wire carries the item id itself, those are two separate questions —
 * see the comment on `items[].actorId` in `normalizeItem` for the second
 * one, which is about whether an item has a *physical pickup*, not whether
 * it exists. An item with `actorId: null` (never placed in the world, only
 * ever granted by script) is a fully valid, ordinary item under this
 * function — ordinary, ungated existence is genuinely all that matters to
 * Give/Take, Carrying, and a monster's drop, and conflating it with pickup
 * backing (as this function used to) made deleting a pickup's placement
 * read as breaking every unrelated script reference to the same item, when
 * `renumberActorDeletion` was already doing the right thing underneath
 * (nulling `actorId`, keeping the item).
 */
export const itemMissing = (items, id) =>
  !(Number.isInteger(id) && id >= 0 && id < (items?.length ?? 0));

/**
 * The single writer for what an item-naming `<select>` offers: every real
 * item, plus how the id currently named is represented if it names none of
 * them. Three call sites used to compute this separately — the Map Forge's
 * Carrying and Give/Take selects (renderer/forges/map/events.js) and the
 * Sprite Forge's Drops select (renderer/forges/sprite/battle.js) — the exact
 * shape CLAUDE.md already warns about for `effectiveTrigger`.
 *
 * Returns `{ healthy, missing }`:
 *
 * - `healthy` is every item in `project.items`, each shaped as `{ value,
 *   label, selected }`. An item with no physical pickup (`actorId: null`,
 *   or naming a deleted actor) is not excluded — it is a normal item that
 *   simply can never be picked up off the map, which is a legitimate,
 *   supported authoring choice (a key handed over only in a cutscene, say),
 *   not the broken-reference case `missing` exists to surface.
 * - `missing` is `null` when `selectedId` names a real item, or
 *   `{ value, label, selected: true }` when it does not — a stale/
 *   out-of-range id, or `null`/`undefined`, exactly what `itemMissing` now
 *   answers. A caller with its own meaning for `null` — the Drops select's
 *   "Nothing," a deliberate, legitimate choice rather than a broken
 *   reference — decides whether to render this entry at all for that case.
 *
 * Across `healthy` and `missing` together, at most one entry is ever
 * `selected` — `selectedId` names exactly one thing — so a caller can
 * render `missing` (if present) followed by `healthy` and never produce two
 * selected `<option>`s for a single-select to disagree about which one it
 * shows.
 */
export function itemPickerOptions(items, selectedId) {
  const healthy = (items ?? []).map((item) => ({
    value: item.id,
    label: item.name,
    selected: item.id === selectedId
  }));
  const missing = itemMissing(items, selectedId)
    ? { value: selectedId, label: 'Missing item', selected: true }
    : null;
  return { healthy, missing };
}

/**
 * Whether `actor` is the kind of thing an item can be collected from at
 * all — the single writer for a question that used to be inlined three
 * times (`migrateItemsFromActors`'s synthesis, `validateProject`'s
 * unbacked-pickup warning below, and now the Items Forge's own actor
 * picker), each spelling out `behavior === 'pickup'` independently rather
 * than asking one function. Only `pickup` qualifies: `entity_door`
 * (engine/entities.asm) is `ent_to_scr`'s one reader, and a pickup
 * placement is the one case `emitScreens` (main/build/generate.js)
 * repurposes that same byte to carry an item id instead of a door target —
 * every other behaviour never reads it as anything, so naming one of them
 * as an item's `actorId` would be a choice with no engine path behind it at
 * all, the "looks functional, does nothing" shape this codebase refuses
 * elsewhere.
 */
export const canBackItem = (actor) => actor?.behavior === 'pickup';

/**
 * Which actor an item is collected from — the pickup half of `itemMissing`'s
 * "two separate questions" (does this item exist vs. does it have a
 * physical pickup), the reverse direction of `itemPickerOptions` above (that
 * one picks an item for a reference; this picks the one actor field an item
 * itself carries). Returns `{ healthy, missing }` in the identical shape:
 *
 * - `healthy` is every `canBackItem` actor, `{ value, label, selected }`.
 *   A `patroller`/`chaser`/`door`/`npc`/`player` actor is excluded outright
 *   rather than offered and silently doing nothing if chosen.
 * - `missing` covers both ways `selectedActorId` can fail to be a live,
 *   eligible choice: it names no actor at all (`actorMissing`), or it names
 *   a real actor whose behaviour has since changed away from `pickup` (an
 *   author changed the actor after linking it) — either way the select
 *   must still show the true stored value rather than silently rendering a
 *   different option selected, the same reasoning `itemPickerOptions`
 *   already documents. `null` (script-only — no physical pickup at all,
 *   normalizeItem's own "optional metadata" state) is not `missing`: it is
 *   a normal, legitimate value with nothing to warn about, so a caller
 *   renders an explicit "None (script-only)" entry for it itself, the same
 *   way the Drops select renders its own "Nothing" for `itemPickerOptions`.
 *
 * Two items naming the same actor is a real conflict (one pickup can only
 * grant one item) — `validateProject`'s own "actor backs more than one
 * item" check already refuses that at build time, so this function does not
 * duplicate it by excluding an actor another item already claims: the
 * picker offers every eligible actor and lets the existing build-time
 * refusal, not a second inline rule here, be the single place that conflict
 * is decided.
 */
export function itemActorOptions(actors, selectedActorId) {
  const eligible = (actors ?? [])
    .map((actor, id) => ({ actor, id }))
    .filter(({ actor }) => canBackItem(actor));
  const healthy = eligible.map(({ actor, id }) => ({
    value: id,
    label: actor.name,
    selected: id === selectedActorId
  }));
  const selectedIsEligible = eligible.some(({ id }) => id === selectedActorId);
  const missing =
    selectedActorId !== null && selectedActorId !== undefined && !selectedIsEligible
      ? {
          value: selectedActorId,
          label: actorMissing(actors, selectedActorId)
            ? 'Missing actor'
            : `${actors[selectedActorId].name} (not a Pickup actor)`,
          selected: true
        }
      : null;
  return { healthy, missing };
}

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

/**
 * Event commands, in the order the compiled bytecode uses -- for every entry
 * whose opcode byte is opIndex(id) (main/build/textcompile.js), that byte
 * IS this array's own position, not a constant declared anywhere in JS.
 * engine/constants.asm hand-writes OP_END..OP_SFX in this identical
 * order, so the array is split into a real prefix (every entry backed by an
 * actual engine OP_* constant, contiguous from index 0) and a virtual tail
 * (entries marked `virtual: true`, backed by no opcode at all -- currently
 * only `route`). A future engine-backed command is inserted immediately
 * before the virtual tail, never after any virtual entry, so it only ever
 * shifts entries nothing computes an opIndex() for; a future virtual
 * command is appended after the existing virtual tail, shifting nothing.
 */
export const EVENT_COMMANDS = [
  { id: 'end', label: 'End', args: [] },
  { id: 'say', label: 'Show text', args: ['text'] },
  { id: 'give', label: 'Give item', args: ['item'] },
  { id: 'take', label: 'Take item', args: ['item'] },
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
  // name. Only offered on a board with a save medium at all (saveCapable,
  // shared/cartridge.js); validateProject refuses a live one elsewhere the
  // same way it refuses Join in a project with no party.
  { id: 'save', label: 'Save the game', args: [] },
  // [who, direction, distance in pixels]. The one command that makes something
  // *happen* on the field rather than to the save state, and the piece item 6's
  // movement routes are built out of: a route is this with a list of steps
  // instead of one. It suspends the script the way Say does, because a walk the
  // event did not wait for would read as a teleport -- the rest of the page
  // would run in the frame the actor set off.
  { id: 'move', label: 'Move actor', args: ['who', 'dir', 'dist'] },
  // [who, direction]. Move's own facing decision (move_face, engine/entities.asm)
  // made reachable on its own, for a beat that turns without walking -- "face the
  // NPC toward the player before speaking." who/dir reuse MOVE_TARGETS/
  // MOVE_DIRECTIONS exactly, the same way Move's own operands do. Unlike Move
  // this does not suspend: the facing is decided and applied in the same frame,
  // the same instant shape setSwitch/setVar already have, so the rest of the
  // page keeps running.
  { id: 'turn', label: 'Turn actor', args: ['who', 'dir'] },
  // [frames]. Suspends the script the way Move does, but pauses the whole world
  // rather than walking anyone -- a beat before the next line, or after a
  // transition. A frame count of 0 does not suspend at all, for the identical
  // reason a Move of distance 0 does not: nothing would ever resume it.
  { id: 'wait', label: 'Wait', args: ['frames'] },
  // [frames]. Unlike Wait, does not pause anything -- the world keeps running
  // while the screen shakes, the same instant shape Turn already has. Only the
  // PPU's own background scroll moves; sprites (the player, entities, any
  // sprite-based UI) hold still, a known, accepted limitation. Because it does
  // not suspend, "Shake N" followed by "Wait N" is an approximation of waiting
  // out the shake, not an exact one -- the two counters tick on different
  // schedules (Wait in the frozen-world tick, Shake every NMI), so they are
  // not guaranteed to end on the same frame.
  { id: 'shake', label: 'Shake screen', args: ['frames'] },
  // [state]. Self only -- the actor whose event is running, resolved through
  // talk_ent the same way Move/Turn's own 'self' already is; there is no
  // other entity this command could mean, so there is no 'who' to author.
  // One command with a Shown/Hidden selector rather than two opcodes, the
  // same shape Turn's own direction picker already has, since Show and Hide
  // are the two positions of one flag rather than independent actions.
  // Hidden means invisible but otherwise fully alive: AI, contact and
  // interaction all keep running, only the sprite stops being drawn -- so a
  // hidden NPC can still be talked to and a hidden damage actor can still
  // hurt the player. Does not suspend, the same instant shape Turn already
  // has. Hiding does not survive leaving the screen: spawn_entities makes
  // every placement visible again on the next redraw, so an author who wants
  // an actor permanently gone already has switches and page conditions for
  // exactly that.
  { id: 'visible', label: 'Show/hide actor', args: ['state'] },
  // [direction]. A cutscene primitive: ramps every one of the 32 live palette
  // bytes toward black over a handful of frames, or back. Suspends the
  // script the way Wait/Move do -- there is something to wait for (the ramp
  // reaching its target) and nothing to walk -- not the instant shape
  // Shake/Turn/Visible have. Unlike every other categorical-operand command
  // shipped so far, direction 0 is an explicit no-op ('none'): both of
  // Fade's real directions are highly visible, so neither is a safe default
  // for a freshly placed, not-yet-configured command. No duration operand:
  // the ramp's own pacing (FADE_STEPS/FADE_STEP_FRAMES, engine/constants.asm)
  // is an engine constant, not authored, keeping the wire format to the
  // smallest surface a suspending command has shipped with. A completed fade
  // is sticky -- it survives a warp, a battle, anything -- until an explicit
  // Fade the other way; the palette is never restored implicitly by the
  // engine except at a new session (a fresh game or a Continue), where it is
  // always restored regardless of any fade left running.
  { id: 'fade', label: 'Fade screen', args: ['fadeDir'] },
  // No operand at all -- flash the screen to a fixed white and back, a
  // short, engine-timed burst with no configuration surface. Unlike Fade,
  // there is no index-0-inert question to answer: Flash has exactly one
  // action it can take, so a freshly placed command does the one thing it
  // can do rather than needing a harmless default value picked for it. Does
  // not suspend the script -- a flash decorates whatever happens next
  // (a hit reaction, a lightning strike) rather than gating it the way
  // Fade's own fade-then-warp idiom does -- and its own countdown
  // (flash_left, engine/constants.asm) ticks unconditionally from
  // main_loop rather than from the frozen-world ui_tick dispatch every
  // other suspending/non-suspending verb above uses, so it keeps counting
  // down whether the world is frozen or running. No colour or duration
  // operand, matching Fade's own "smallest wire format" precedent: the
  // colour (FLASH_COLOR) and hold (FLASH_TOTAL_FRAMES) are engine
  // constants, not authored.
  { id: 'flash', label: 'Flash screen', args: [] },
  // [song]. Pauses whatever song is currently playing, plays the named one alone through the
  // unmodified driver, and resumes the original exactly where it left off once the sting's own
  // length has elapsed -- provided nothing else asks the driver to play a song in the meantime
  // (engine/music.asm's set_music dedup only catches a repeat request for the sting itself; any
  // other request, the original field song included, cancels the resume rather than seaming into
  // it). Does not suspend the script, the same non-suspending shape Turn/Shake/Visible/Flash
  // already have -- an author who needs the script to hold for the fanfare composes Sting then
  // Wait. No duration operand: the compiler measures the referenced song's own length (one full
  // pass through its authored order, songFrameLength in shared/audio.js) and bakes it in, so the
  // duration can never drift from the song the way an author-supplied one could. Unlike `music`,
  // null/Silence is not a legitimate choice here -- there is no silence-equivalent sting -- so a
  // live Sting naming nothing, or a song since deleted, is refused by validateProject rather than
  // silently compiling to NO_SONG the way a stale `music` reference still does.
  { id: 'sting', label: 'Sound sting', args: ['song'] },
  // [id, duration in frames]. A short, fixed-volume, single-channel burst on a
  // dedicated stolen channel (SFX_CHANNEL, engine/constants.asm) -- the running
  // song's other three channels, or a live Sting, continue completely untouched.
  // Duration is never authored: the compiler measures the effect's own total
  // length (sfxFrameLength, shared/audio.js) and bakes it in, the identical
  // single-writer shape Sting's own duration operand already has. Does not
  // suspend the script, the same instant shape Turn/Shake/Visible/Flash/Sting
  // already share. See design-sfx.md for the full design.
  { id: 'sfx', label: 'Play a sound effect', args: ['sfx'] },
  // [who, {legs: [...]}]. An authoring convenience over Move/Turn/Wait: a route
  // holds an ordered list of legs, each a real move/turn/wait record, and
  // compiles to exactly what hand-chaining the same commands would -- no new
  // opcode, no framing, see design-routes.md. `who` lives once, on the route,
  // not per leg (design-routes.md §3.2); a leg's own `who` field, if
  // normalizeEventCommand's reused move/turn handling stamped one, is deleted
  // before storage, since nothing ever reads it there.
  //
  // `nests: true` -- a route holds real commands (its legs), and `nests`
  // means exactly and only "the command holds a list of commands, whatever
  // it calls them" (see this array's own comment on the flag, a few entries
  // up). It therefore shares BRANCH_DEPTH_LIMIT/MAX_BRANCH_DEPTH with
  // branch/choice -- a route 64 levels deep throws the identical error a
  // branch that deep already does, and the editor stops offering it at
  // MAX_BRANCH_DEPTH the same way. The leg vocabulary restriction (only
  // move/turn/wait, never another route or a branch/choice) is a SEPARATE
  // fact, enforced entirely by routeLegs/ROUTE_LEG_OPS (shared/eventrules.js)
  // -- nests only gates depth, never vocabulary, for any container.
  //
  // virtual: true -- this entry carries no engine OP_* constant and no
  // dispatch code; encodeCommand's 'route' case (main/build/textcompile.js)
  // emits a route's legs directly, with no opcode byte of its own. Every
  // real (OP_*-backed) entry in this array stays contiguous from index 0, in
  // engine/constants.asm order; every virtual entry (currently only this
  // one) forms one contiguous tail after them. A future engine-backed
  // command is inserted immediately before this entry, never after -- that
  // gives it the next sequential opcode and only shifts virtual entries,
  // whose own opIndex() value is never computed by anything; a future
  // virtual command is appended after it, shifting nothing.
  // test/unit/project.test.js's own ordinal test enforces both halves of
  // this directly.
  { id: 'route', label: 'Follow a route', args: ['route'], nests: true, virtual: true }
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
  projectEvents,
  ROUTE_LEG_OPS,
  routeLegs,
  legWithWho
} from './eventrules.js';

/**
 * The subset engine/script.asm can actually run. Everything in EVENT_COMMANDS is
 * normalized, saved and compiled — so a project written by a later version
 * survives a round trip through this one — but the Map Forge only offers these,
 * because a command that silently does nothing is exactly what this codebase
 * refuses to ship. `join` is implemented, but only an RPG has a party to join,
 * so the event editor additionally hides it in an action project. `route` is
 * the first entry here with no `OP_*` of its own (`virtual: true`,
 * EVENT_COMMANDS) — it is offered because it compiles away into opcodes the
 * engine already runs, not because the engine ever sees an opcode for it.
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
  'save',
  'move',
  'turn',
  'wait',
  'shake',
  'visible',
  'fade',
  'flash',
  'sting',
  'sfx',
  'route'
]);

/**
 * Who a Move command moves. The order is the wire format: one byte of the
 * command, `MOVE_SELF`/`MOVE_PLAYER` in `engine/constants.asm` at the other end.
 *
 * `self` is index 0 because it is the one that needs no explanation on a
 * placement — the actor carrying the event is the actor the author is looking
 * at. A common event run from a placement moves that placement's actor too,
 * since `talk_ent` is whoever the conversation belongs to however deep the call
 * stack is.
 */
export const MOVE_TARGETS = [
  { id: 'self', label: 'This actor' },
  { id: 'player', label: 'The player' }
];

/**
 * Which way a Move command goes. The order is the wire format *and* the
 * engine's own `DIR_*` order (`engine/constants.asm`), so the compiled byte is
 * the direction the engine already stores in `ent_dir`/`player_dir` — a Move
 * therefore sets facing by construction rather than by a second mapping that
 * could disagree with the first.
 */
export const MOVE_DIRECTIONS = [
  { id: 'down', label: 'Down' },
  { id: 'up', label: 'Up' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' }
];

/**
 * A Show/Hide command's own state. The order is the wire format: `hidden` is
 * index 0 to match `OP_VISIBLE`'s state byte (`engine/constants.asm`), and
 * `ENT_HIDDEN` is set when the byte is 0, not 1 — a Show/Hide command with no
 * state chosen yet therefore hides, the same "the author is looking at the
 * verb that names the feature" reasoning `self` gets for being index 0 above.
 * There is no `player` entry the way `MOVE_TARGETS` has one: the player has
 * no `ent_active`/`draw_entities` presence at all, so "hide the player" has
 * no engine meaning to give it.
 */
export const VISIBLE_STATES = [
  { id: 'hidden', label: 'Hidden' },
  { id: 'shown', label: 'Shown' }
];

/**
 * A Fade command's own direction. The order is the wire format: `FADE_NONE`/
 * `FADE_OUT`/`FADE_IN` in `engine/constants.asm`, in exactly this order.
 *
 * Unlike `MOVE_DIRECTIONS`/`VISIBLE_STATES`, index 0 is an explicit no-op
 * rather than a real, harmless default: every direction Turn could face is
 * imperceptible when it is already facing that way, and both of Show/Hide's
 * states are meaningful, but Fade's two real values are both highly visible,
 * so neither is a safe default for a freshly placed, not-yet-configured
 * command. This follows the magnitude commands' own "zero is inert"
 * convention (`Wait 0`/`Shake 0` do nothing) and this codebase's existing
 * `kind`-style enumerations where index 0 is an explicit `none`
 * (`ITEM_EFFECT_KINDS`, above), rather than the way Turn/Show-Hide give a
 * fresh command a harmless default by having no do-nothing value at all.
 */
export const FADE_DIRECTIONS = [
  { id: 'none', label: '(does nothing)' },
  { id: 'out', label: 'Fade out (to black)' },
  { id: 'in', label: 'Fade in (from black)' }
];

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

/**
 * The formation one map's own wandering-encounter table actually places, as
 * four `mon_slot_actor` values ($FF = empty slot, the same sentinel the
 * engine's own RAM array uses): `map.encounters.actorIds`, trimmed to ids
 * that still index a real actor — a deleted or out-of-range one is dropped,
 * not merely truncated, unlike `battleFormationSlice` above, which enforces
 * only the slot count for a different question (an authored formation's own
 * length). The single writer for both `main/build/generate.js`'s
 * `map_enc_actors` table and anything else that needs to know what a map's
 * wandering table would actually place — a debugger poke into
 * `mon_slot_actor` included, since the shape already matches. Reading
 * `map.encounters.actorIds` directly instead can test a monster the shipped
 * ROM never places, or hand the battle bank an actor id past the end of its
 * own tables.
 */
export const mapEncounterFormation = (map, actorCount) => {
  const ids = (map?.encounters?.actorIds ?? []).filter((id) => id < actorCount).slice(0, RPG_LIMITS.encounterActors);
  return [...ids, ...new Array(RPG_LIMITS.encounterActors - ids.length).fill(NO_ACTOR)];
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
  // An unnamed screen is the empty string, not "Screen 3": the number is where
  // it sits in the map and changes when the map is resized, so storing it would
  // leave a name that quietly lies. `screenLabel` supplies the fallback.
  return { name: '', metatiles: new Array(SCREEN_METATILES).fill(0), entities: [], boundTiles: [] };
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
 * The sfx-space sibling of renumberSongDeletion above: project.sfx is a wholly
 * separate list from project.songs, so this walks command.op === 'sfx' only and
 * cannot inherit that function's own (pre-existing, out-of-scope) gap for
 * Sting's own `song` field. allCommands, not liveCommands -- a switched-off
 * command's reference must still track a deletion, so a switch back on does
 * not silently point at the wrong effect.
 */
export function renumberSfxDeletion(project, index) {
  for (const event of projectEvents(project)) {
    for (const page of event.pages ?? []) {
      for (const command of allCommands(page.commands)) {
        if (command.op !== 'sfx') continue;
        if (command.sfx === index) command.sfx = null;
        else if (command.sfx > index) command.sfx -= 1;
      }
    }
  }
  return project;
}

// Which page/branch conditions name an actor, read off EVENT_CONDITIONS rather
// than spelled out, so a second actor-argument condition added there is
// renumbered below without this having to be told about it. Empty today:
// `hasItem` (the one condition that used to sit here) names an *item* now —
// see ITEM_CONDITIONS below and renumberItemDeletion — so this currently
// renumbers nothing. It stays rather than being deleted for the same reason
// the mapper registry keeps `supported`/`unsupportedReason` fields no entry
// currently exercises: it is the mechanism a future actor-argument condition
// would need, declared once so adding one there is enough.
const ACTOR_CONDITIONS = new Set(
  EVENT_CONDITIONS.filter((entry) => entry.arg === 'actor').map((entry) => entry.id)
);

// Which page/branch conditions name an item, the same data-driven shape
// ACTOR_CONDITIONS already used before `hasItem` moved into this space. Used
// by renumberItemDeletion below.
const ITEM_CONDITIONS = new Set(
  EVENT_CONDITIONS.filter((entry) => entry.arg === 'item').map((entry) => entry.id)
);

/**
 * What every reference to an actor becomes once `index` is gone from
 * `project.sprites.actors`: renumbered down by one for everything above it,
 * the same treatment a placement gets inline where it is deleted (sprite.js)
 * and renumberSongDeletion gives a song. Left alone, an id above the deleted
 * one silently repoints at whichever actor now happens to sit there, and an
 * id equal to it survives pointing at nothing — indistinguishable, from
 * inside the reference, from a project that still has that actor.
 *
 * A Start a battle command's formation is a list, so the deleted id is
 * simply removed from it — a battle with monsters left over is still a
 * battle. A map's wandering-encounter table (`map.encounters.actorIds`) gets
 * the identical answer for the identical reason.
 *
 * **Give item, Take item, a Carrying condition and `battle.drop` are not
 * walked here any more.** Every one of those names an *item* now, not an
 * actor directly — `renumberItemDeletion` below is where they are
 * renumbered, against `project.items[]`, not `project.sprites.actors`. Two
 * functions renumbering the same reference is how the two answers drift
 * apart, so each reference is walked in exactly one of them.
 *
 * **`project.items[].actorId` is walked here instead**, and it is the one
 * new case this phase adds to this function rather than moving out of it: an
 * item's `actorId` genuinely names an actor, so deleting that actor is this
 * function's question to answer, the same as any other actor reference.
 * Unlike a Give/Take command, an item has no "the reference itself is gone"
 * shape to fall into — the item record survives, orphaned, `actorId` set to
 * `null` exactly the way `battle.drop` used to fall to `null` here before it
 * became an item reference. An orphaned item is not deleted, because nothing
 * about losing its backing actor makes the item record itself meaningless —
 * `validateProject`'s item rules (see below) are what tell an author a Give
 * or Carrying naming it no longer resolves.
 *
 * **`NO_ACTOR` is a fixed point.** Every reference below stops at it rather
 * than walking it down with the ids around it, because it is not an id — it
 * is the byte that means there is no id. Walked once per later deletion it
 * decays $FF → $FE → $FD, staying out of range for the roster of the day and
 * quietly coming back *into* range the moment the project grows enough
 * actors, at which point a reference that was marked missing starts naming a
 * real actor again. That is the same silent retarget this whole routine
 * exists to stop, arriving one deletion at a time.
 *
 * Walked through `allCommands`, not each page's own list, since a battle or a
 * *branch's own condition* can be sitting inside another branch or a
 * question same as any other command — the same reason renumberSongDeletion
 * walks it that way, and the same page-plus-nested-conditions walk
 * `usedSwitches` (renderer/forges/map/templates.js) already performs for
 * switches. A switch that was invisible to that walk got handed out twice; a
 * condition invisible to this one comes to ask about the wrong actor.
 *
 * Placed actors are renumbered separately, inline where they are deleted —
 * this only ever needs to run alongside that, never instead of it.
 *
 * Mutates `project` and returns it. The caller removes
 * `project.sprites.actors[index]` itself, before or after calling this: the
 * actor list is now walked (for each item's own `actorId`) but never
 * measured, so either order gives the same answer.
 */
export function renumberActorDeletion(project, index) {
  // The one shift, in one place: an id above the hole moves down, and the
  // sentinel is left exactly where it is (see NO_ACTOR is a fixed point above).
  const shift = (id) => (id !== NO_ACTOR && id > index ? id - 1 : id);
  const renumberCondition = (cond) => {
    if (!cond || !ACTOR_CONDITIONS.has(cond.type) || typeof cond.arg !== 'number') return;
    if (cond.arg === NO_ACTOR) return; // already marked missing; not an id to walk
    if (cond.arg === index) cond.arg = NO_ACTOR;
    else cond.arg = shift(cond.arg);
  };
  for (const item of project.items ?? []) {
    if (typeof item.actorId !== 'number' || item.actorId === NO_ACTOR) continue;
    if (item.actorId === index) item.actorId = null;
    else item.actorId = shift(item.actorId);
  }
  for (const map of project.maps ?? []) {
    const ids = map.encounters?.actorIds;
    if (!Array.isArray(ids)) continue;
    map.encounters.actorIds = ids.filter((id) => id !== index).map(shift);
  }
  for (const event of projectEvents(project)) {
    for (const page of event.pages ?? []) {
      renumberCondition(page.cond);
      for (const command of allCommands(page.commands)) {
        renumberCondition(command.cond); // a branch's own, which a page's editor also writes
        if (command.op === 'battle' && Array.isArray(command.monsters)) {
          command.monsters = command.monsters.filter((id) => id !== index).map(shift);
        }
      }
    }
  }
  return project;
}

/**
 * What every reference to an *item* becomes once `index` is gone from
 * `project.items`: the item-space sibling of `renumberActorDeletion` above,
 * covering exactly the three references that moved out of it — Give item /
 * Take item's `item`, a Carrying condition's `arg`, and every actor's
 * `battle.drop` — because all three now name an id in `project.items`, not
 * `project.sprites.actors`.
 *
 * Same shape throughout: an id above the deleted one shifts down, an id
 * equal to it becomes `NO_ITEM`/`null` (missing, not deleted or silently
 * repointed), and `NO_ITEM` is a fixed point for the identical reason
 * `NO_ACTOR` is one in `renumberActorDeletion` — walking it down would let it
 * decay back into range as the item list shrinks further.
 *
 * Give/Take gets `null` (matching how `command.actor` used to fall to `null`
 * here before it was an item reference — a Play music command's `song` is
 * the same shape for a deleted song). A Carrying condition cannot take
 * `null` — `normalizeCondition` clamps `cond.arg` to a number, so a `null`
 * written here would come back as item 0 on the next save, the very silent
 * repoint this routine exists to stop. It gets `NO_ITEM` instead, the same
 * "names nothing" byte `itemMissing` already treats a missing item id as.
 * `battle.drop` also gets `null`, matching what "Nothing" already means in
 * that field.
 *
 * Deleting an item never touches `project.sprites.actors`: nothing on an
 * actor names an item — the link is `item.actorId`, one direction only —
 * so there is nothing on the actor side for this function to fix up.
 *
 * Mutates `project` and returns it. The caller removes `project.items[index]`
 * itself, before or after calling this, the same contract
 * `renumberActorDeletion` documents.
 */
export function renumberItemDeletion(project, index) {
  const shift = (id) => (id !== NO_ITEM && id > index ? id - 1 : id);
  const renumberCondition = (cond) => {
    if (!cond || !ITEM_CONDITIONS.has(cond.type) || typeof cond.arg !== 'number') return;
    if (cond.arg === NO_ITEM) return; // already marked missing; not an id to walk
    if (cond.arg === index) cond.arg = NO_ITEM;
    else cond.arg = shift(cond.arg);
  };
  for (const actor of project.sprites?.actors ?? []) {
    const drop = actor.battle?.drop;
    if (typeof drop !== 'number' || drop === NO_ITEM) continue; // already "Nothing", or never a reference
    if (drop === index) actor.battle.drop = null;
    else actor.battle.drop = shift(drop);
  }
  for (const event of projectEvents(project)) {
    for (const page of event.pages ?? []) {
      renumberCondition(page.cond);
      for (const command of allCommands(page.commands)) {
        renumberCondition(command.cond); // a branch's own, which a page's editor also writes
        if (
          (command.op === 'give' || command.op === 'take') &&
          typeof command.item === 'number' &&
          command.item !== NO_ITEM // a hand-edited $FF here means "nothing" too
        ) {
          if (command.item === index) command.item = null;
          else command.item = shift(command.item);
        }
      }
    }
  }
  return project;
}

/**
 * What every reference to a metasprite becomes once `index` is gone from
 * `project.sprites.metasprites`. Three consumers exist — an animation
 * frame's `metaspriteId`, a party member's `metaspriteId`, and (as of this
 * phase) an item's `metaspriteId` — and the Sprite Forge's own delete
 * handler renumbered none of them before now: it spliced the array and
 * re-stamped every remaining metasprite's own `id` by position, but nothing
 * that *names* a metasprite. Left alone, an id above the deleted one
 * silently repoints at whichever metasprite now happens to sit there, the
 * identical defect `renumberActorDeletion`/`renumberSongDeletion` already
 * exist to prevent one id space over.
 *
 * Fixing this now, rather than leaving it as a standalone finding, is a
 * direct consequence of `item.metaspriteId` existing at all: shipping a
 * third silently-broken consumer of the same field, when the first two are
 * already documented and the fix is the same `shift`/fixed-point shape every
 * other reference in this file already uses, is worse than not adding the
 * field. It does not widen into a general metasprite-reference audit beyond
 * the three consumers named above.
 *
 * The party member and item cases are both the `shift`/fixed-point
 * treatment, but not the identical one: a party member's `null` already
 * means "draws nothing" ("Not drawn" in the Sprite Forge's battle tab), so a
 * reference to the deleted metasprite becomes `null` there. An item's
 * `null` means something else now (§ its own field comment in
 * `normalizeItem`: "not set — derive one from the backing actor"), so
 * mapping a deleted-metasprite reference to `null` there would silently
 * turn "this item had its own icon" into "derive one from the actor
 * instead" — swapping in unrelated art rather than clearing the icon, the
 * identical silent-repoint shape this function exists to close, reached
 * through its own fixed-point case instead of a missed one. An item's exact
 * match becomes `NO_METASPRITE` (explicit "no icon") instead; everything
 * above the deleted index shifts down the same way for both.
 *
 * **The animation-frame case is different, because it has no sentinel.**
 * `normalizeAnimation` clamps a missing or malformed `metaspriteId` to `0`
 * — there has never been a "this frame draws nothing" state in the schema,
 * unlike the nullable party-member/item fields. Clamping a frame that named
 * the *deleted* metasprite to that same `0` would silently retarget it to
 * unrelated art — worst when deleting index 0 itself, where every orphaned
 * frame would land on whatever slid into 0's place, which is the identical
 * silent-repoint defect this function exists to close, reintroduced through
 * its one hard case. So instead of clamping, a frame naming exactly the
 * deleted metasprite is **dropped** from its animation, and every frame
 * above it is shifted down like any other reference. An animation can end
 * up with fewer frames, including none: that is a state the Sprite Forge
 * already permits today (its frame list splices frames out one at a time,
 * and a fresh animation is created with zero frames whenever no metasprite
 * exists yet to default one to), so this reaches nothing new. The visible
 * result — an animation that plays shorter, or not at all, until the author
 * adds a frame back — is a glitch the author can see and fix in the Sprite
 * Forge's own preview, not a silent wrong reference the way the unfixed bug
 * was.
 *
 * Mutates `project` and returns it. The caller removes
 * `project.sprites.metasprites[index]` itself, before or after calling this.
 */
export function renumberMetaspriteDeletion(project, index) {
  const shift = (id) => (id > index ? id - 1 : id);
  // Two things fixedPoint has to get right independently, and round 7 found
  // it had conflated them: what happens on an *exact match* (the reference
  // named precisely the metasprite just deleted), and whether NO_METASPRITE
  // ($FF) is a *sentinel this field even has* at all.
  //
  // `onExactMatch` is the first -- party members and items genuinely differ
  // here: a party member's null already means "draws nothing", so its own
  // reference to the deleted metasprite becomes null; an item's null means
  // "derive an icon from the backing actor" now, so mapping its own
  // reference to null there would silently swap in unrelated art instead of
  // clearing the icon -- it needs NO_METASPRITE, the sentinel that actually
  // means "no icon" for an item.
  //
  // `preserveSentinel` is the second, and round 4's own fix (checking the
  // exact match before the sentinel, so the two checks can never disagree
  // about which applies to a real metasprite 255) did not go far enough:
  // it only closed the ambiguity for the id *being deleted*. A party member
  // referencing a real, surviving metasprite 255 while some *other* index is
  // deleted never hits the exact-match branch at all -- it falls through to
  // "is this the sentinel", and that check fired unconditionally for both
  // callers, preserving 255 instead of shifting it down like every other
  // real reference above the deleted slot. For an item that is correct
  // (NO_METASPRITE genuinely means something there, so it must never shift).
  // For a party member it is not: 255 there is only ever a real index --
  // this field has no "no icon" sentinel of its own, `null` already owns
  // that meaning -- so it must shift exactly like any other id. This is why
  // the fix from round 5 to test with metasprite 255 named the wrong
  // property; it is the recovery path (delete index 0, not 255) that
  // actually exercises this, and round 4's fixture only ever deleted 255
  // itself.
  const fixedPoint = (id, onExactMatch, preserveSentinel) => {
    if (id === null || id === undefined) return null;
    if (id === index) return onExactMatch;
    // NO_METASPRITE ($FF) is an item's explicit "no icon", not a real index
    // -- shifting it the way a real reference above the deleted slot shifts
    // would silently turn "no icon" into a real, wrong one the next time a
    // metasprite below it is deleted. Item-only: a party member's
    // metaspriteId has no sentinel of its own (null already means "draws
    // nothing"), so 255 there is always a real id and must shift with
    // everything else.
    if (preserveSentinel && id === NO_METASPRITE) return NO_METASPRITE;
    return shift(id);
  };
  for (const animation of project.sprites?.animations ?? []) {
    animation.frames = (animation.frames ?? [])
      .filter((frame) => frame?.metaspriteId !== index)
      .map((frame) => ({ ...frame, metaspriteId: shift(frame.metaspriteId) }));
  }
  for (const member of project.party ?? []) {
    member.metaspriteId = fixedPoint(member.metaspriteId, null, false);
  }
  for (const item of project.items ?? []) {
    item.metaspriteId = fixedPoint(item.metaspriteId, NO_METASPRITE, true);
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
    items: [],
    sprites: { metasprites: [], animations: [], actors: [] },
    songs: [],
    sfx: [],
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

function normalizeEventCommand(raw, depth = 0, itemCtx = EMPTY_ITEM_CTX) {
  const command = EVENT_COMMANDS.find((entry) => entry.id === raw?.op);
  if (!command || command.id === 'end') return null;
  if (command.nests && depth >= BRANCH_DEPTH_LIMIT) {
    throw new Error(`This project nests event commands more than ${BRANCH_DEPTH_LIMIT} deep.`);
  }
  // Every list of commands inside this one, wherever it hangs: a branch's two
  // sides and a question's options are the same recursion with different names.
  const inner = (list) =>
    (Array.isArray(list) ? list : [])
      .map((entry) => normalizeEventCommand(entry, depth + 1, itemCtx))
      .filter(Boolean);
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
    // A Move's who and direction are stored as their ids rather than their
    // indices, so a project file says `"dir": "left"` and survives a later
    // version inserting a direction into the middle of the list. The index is
    // the wire format, and the compiler is where the id becomes one.
    // An unrecognised id falls back to the first entry rather than being
    // dropped: a Move that lost its direction is still a Move, and dropping it
    // would erase whatever the page went on to do.
    else if (arg === 'who') out.who = MOVE_TARGETS.some((entry) => entry.id === raw?.who) ? raw.who : MOVE_TARGETS[0].id;
    else if (arg === 'dir')
      out.dir = MOVE_DIRECTIONS.some((entry) => entry.id === raw?.dir) ? raw.dir : MOVE_DIRECTIONS[0].id;
    // Same id-not-index reasoning as 'who'/'dir' above, for the same reason:
    // a Show/Hide that lost its state is still a Show/Hide, not dropped.
    else if (arg === 'state')
      out.state = VISIBLE_STATES.some((entry) => entry.id === raw?.state) ? raw.state : VISIBLE_STATES[0].id;
    // Same id-not-index reasoning as 'who'/'dir'/'state' above. Falls back to
    // FADE_DIRECTIONS[0] ('none'), which is also what a freshly authored Fade
    // command starts as — a degenerate value doing nothing is exactly the
    // guarantee Wait/Shake already give a fresh command, achieved here the
    // way item effects give it (an explicit `none` at index 0) rather than
    // the way Turn/Show-Hide give it (no such value needed at all).
    else if (arg === 'fadeDir')
      out.dir = FADE_DIRECTIONS.some((entry) => entry.id === raw?.dir) ? raw.dir : FADE_DIRECTIONS[0].id;
    // Pixels, and a whole byte of them: 16 is one metatile and 255 is just
    // under the width of a screen, which is as far as a move could be asked to
    // go without crossing an edge — and crossing one mid-event is what `warp`
    // is for, not this.
    else if (arg === 'dist') out.dist = clamp(raw?.dist, 0, 255, 0);
    // Frames, a whole byte of them, and a Wait of 0 is legal (it just never
    // suspends -- see script_op_wait, engine/script.asm).
    else if (arg === 'frames') out.frames = clamp(raw?.frames, 0, 255, 0);
    // A song index, or `null` for Silence — the same shape map.songId is,
    // and deliberately not clamped against how many songs the project
    // actually has: buildProject compiles the project the app is holding
    // rather than one freshly normalized, so the true ceiling is enforced
    // where the song count is known, at compile time (see songByte in
    // main/build/textcompile.js), the same reason 'warp's screen is a loose
    // byte clamp here and a real one in the compiler.
    else if (arg === 'song') out.song = raw?.song === null || raw?.song === undefined ? null : clamp(raw?.song, 0, 255, 0);
    // Same nullable shape as 'song' above, for the identical reason: "never
    // chosen" and "effect 0" must stay distinguishable.
    else if (arg === 'sfx') out.sfx = raw?.sfx === null || raw?.sfx === undefined ? null : clamp(raw?.sfx, 0, 255, 0);
    else if (arg === 'branch') {
      out.cond = normalizeCondition(raw?.cond, itemCtx);
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
    } else if (arg === 'route') {
      out.who = MOVE_TARGETS.some((entry) => entry.id === raw?.who) ? raw.who : MOVE_TARGETS[0].id;
      // routeLegs (shared/eventrules.js) is the single admission filter every
      // consumer of .legs shares -- applied to the RAW list before
      // normalizing, not after: normalizing an illegally-nested branch here
      // first (via the generic `inner()` a container's contents would
      // otherwise go through) would do real recursive work, and possibly
      // trip BRANCH_DEPTH_LIMIT, for content about to be discarded anyway.
      out.legs = routeLegs(raw?.legs)
        .map((leg) => normalizeEventCommand(leg, depth + 1, itemCtx))
        .filter(Boolean)
        // who lives on the route, not the leg -- see the field comment above.
        .map((leg) => {
          if (leg.op === 'move' || leg.op === 'turn') delete leg.who;
          return leg;
        });
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
    // an item -- the same shape 'song' is, and for the same reason: item
    // deletion (renumberItemDeletion) has exactly one thing it can do with a
    // Give/Take that named the item being removed, since neither command
    // holds a list to drop the id from the way a battle formation does. Not
    // 0 or any other number — a real item could be sitting at either — and
    // not dropping the command outright either, which would erase whatever
    // else the event went on to do. `main/build/textcompile.js`'s own
    // encoding is the other half: NO_ITEM for an item that does not exist
    // (itemMissing), the same as songByte's NO_SONG.
    //
    // Which raw field this reads is decided by property presence, not `??`:
    // an explicit `item: null` is a deliberately cleared target and must not
    // fall back to a legacy `actor` value and resurrect it. A conflicting
    // `item` and `actor` on the same raw command: the new field wins outright
    // and the legacy value is discarded, never merged or preferred by type.
    //
    // A raw command carrying only the legacy `actor` field is what a
    // pre-item-schema project's data looks like. `itemCtx.migrating` is true
    // for exactly one pass — normalizeProject's one-time migration, run only
    // when the project has no `items` array yet — and only there does
    // `itemCtx.actorToItem` exist, mapping every actor id the migration found
    // referenced to the item it created for it. Every other load (an
    // `items` array already exists, so this is not a migration) resolves a
    // stray legacy `actor` to missing rather than growing the items list
    // outside that one deterministic pass: synthesizing more items here would
    // make "how many items does this project have" depend on which commands
    // happen to still carry the old field, not on `project.items` itself.
    else if (arg === 'item') {
      const hasItemProp = raw && typeof raw === 'object' && Object.hasOwn(raw, 'item');
      const hasActorProp = raw && typeof raw === 'object' && Object.hasOwn(raw, 'actor');
      if (hasItemProp) out.item = nullableItemRef(raw.item);
      else if (hasActorProp) out.item = itemCtx.migrating ? itemCtx.actorToItem.get(raw.actor) ?? null : null;
      else out.item = null;
    }
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
/**
 * A reference-typed condition argument (an actor id, an item id), whichever
 * of the two `sentinel` is: not already a whole, non-negative, in-range id
 * becomes `sentinel` instead of folding to 0 the way the generic `clamp`
 * below would.
 *
 * `clamp` is wrong for this kind of field, and quietly so: it folds `null`,
 * `undefined` and anything non-numeric to its fallback of **0**, and rounds a
 * fraction or a numeric string into whatever whole number is nearest. Every
 * one of those is a value `actorMissing`/`itemMissing` calls missing and the
 * Map Forge's own select therefore renders as "Missing" — so a hand-edited
 * condition could display as missing and, on the project's very next save,
 * become a live reference to id 0 (or to whatever `2.4` rounds to). That is
 * precisely the editor-shows-one-thing, ROM-does-another disagreement the
 * select was added to prevent, reintroduced through the back door.
 *
 * This is deliberately the roster-*blind* half of `actorMissing`/
 * `itemMissing`'s question — normalization has no actor or item list in hand
 * — so an id that is structurally fine but past the end of a short list is
 * left alone here and caught downstream exactly as it is today, by
 * `actorMissing`/`itemMissing` at display and validation time. `has_item`
 * (engine/script.asm) only ever compares, so either way such a page simply
 * never matches.
 */
const referenceConditionArg = (raw, id, sentinel) =>
  Number.isInteger(raw) && raw >= 0 && raw <= conditionArgLimit(id) ? raw : sentinel;
const actorConditionArg = (raw, id) => referenceConditionArg(raw, id, NO_ACTOR);
const itemConditionArg = (raw, id) => referenceConditionArg(raw, id, NO_ITEM);

/**
 * A Give/Take target, canonicalized: `null` for a deliberately cleared or
 * absent value (preserved, not folded to a sentinel — see the `item` branch
 * of `normalizeEventCommand`, which is the only caller), `NO_ITEM` for
 * anything present but structurally invalid, and the id itself otherwise.
 * The nullable sibling of `referenceConditionArg` above, for the one field
 * that — unlike a condition's `arg` — genuinely has a `null` state of its
 * own to preserve. Bounded to 255 (not `LIMITS.items`) for the identical
 * reason `conditionArgLimit`'s own default is 255: this is the raw wire
 * width, not the roster ceiling, and the two happen to be one apart only
 * because `NO_ITEM` sits at the top of the byte.
 */
const nullableItemRef = (raw) => {
  if (raw === null || raw === undefined) return null;
  return Number.isInteger(raw) && raw >= 0 && raw <= 255 ? raw : NO_ITEM;
};

// The itemCtx normalizeEventCommand/normalizeCondition never actually need
// one, i.e. every caller outside normalizeProject's own migration pass —
// `migrating: false` short-circuits the `item` branch's legacy-actor lookup
// straight to `null` without ever touching `actorToItem`, so this is safe to
// hand out as a shared default instead of threading a fresh empty context
// through every non-migrating call site.
const EMPTY_ITEM_CTX = Object.freeze({ migrating: false, actorToItem: null });

function normalizeCondition(raw, itemCtx = EMPTY_ITEM_CTX) {
  const condition = EVENT_CONDITIONS.find((entry) => entry.id === raw?.type) ?? EVENT_CONDITIONS[0];
  let arg;
  if (condition.arg === 'actor') {
    arg = actorConditionArg(raw?.arg, condition.id);
  } else if (condition.arg === 'item') {
    // Same property-presence rule normalizeEventCommand's `item` branch
    // uses, and for the same reason: `hasItem` keeps its field name
    // (`arg`), so there is no separate legacy field to fall back to here —
    // once `project.items` exists, `arg`'s number *is* an item id, full
    // stop. The only place this reads as an actor id is inside
    // normalizeProject's own one-time migration, where `itemCtx.migrating`
    // is true and `raw.arg` is still whatever the pre-item-schema project
    // wrote — a raw actor id needing translation through `actorToItem`
    // before it is a valid item id at all.
    arg = itemCtx.migrating
      ? (typeof raw?.arg === 'number' ? itemCtx.actorToItem.get(raw.arg) : undefined) ?? NO_ITEM
      : itemConditionArg(raw?.arg, condition.id);
  } else {
    arg = condition.arg ? clamp(raw?.arg, 0, conditionArgLimit(condition.id), 0) : 0;
  }
  const cond = { type: condition.id, arg };
  // Only conditions that compare against a number carry the value byte, and
  // only they get the field — exactly as `off` is kept only when it is true.
  // Every page in every existing project would otherwise gain a `value: 0` on
  // its next save, which is a diff saying nothing happened.
  if (condition.value) cond.value = clamp(raw?.value, 0, 255, 0);
  return cond;
}

function normalizeEventPage(raw, itemCtx = EMPTY_ITEM_CTX) {
  return {
    cond: normalizeCondition(raw?.cond, itemCtx),
    commands: (Array.isArray(raw?.commands) ? raw.commands : [])
      .map((entry) => normalizeEventCommand(entry, 0, itemCtx))
      .filter(Boolean)
  };
}

/** An event is a list of pages; the engine runs the first whose condition holds. */
function normalizeEvent(raw, itemCtx = EMPTY_ITEM_CTX) {
  const pages = (Array.isArray(raw?.pages) ? raw.pages : []).map((page) => normalizeEventPage(page, itemCtx));
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
function normalizeCommonEvents(raw, rawSeq, itemCtx = EMPTY_ITEM_CTX) {
  const source = (Array.isArray(raw) ? raw : []).slice(0, LIMITS.commonEvents);
  const { ids, seq } = resolveCommonEventIds(source, rawSeq);
  const commonEvents = source.map((entry, index) => ({
    id: ids[index],
    name: normalizeLabel(entry?.name, `Common event ${index + 1}`),
    event: normalizeEvent(entry?.event, itemCtx)
  }));
  return { commonEvents, commonEventSeq: seq };
}

function normalizeEntity(raw, itemCtx = EMPTY_ITEM_CTX) {
  const props = raw?.props && typeof raw.props === 'object' ? { ...raw.props } : {};
  const event = normalizeEvent(props.event, itemCtx);
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

function normalizeScreen(raw, itemCtx = EMPTY_ITEM_CTX) {
  const screen = createScreen();
  screen.name = authorName(raw?.name);
  const source = Array.isArray(raw?.metatiles) ? raw.metatiles : [];
  for (let i = 0; i < SCREEN_METATILES && i < source.length; i++) {
    screen.metatiles[i] = clamp(source[i], 0, LIMITS.metatiles - 1, 0);
  }
  if (Array.isArray(raw?.entities)) {
    screen.entities = raw.entities.slice(0, LIMITS.entitiesPerScreen).map((entity) => normalizeEntity(entity, itemCtx));
  }
  // Switch-bound tiles (design-tile.md §10) -- clamp-on-load, the identical
  // shape normalizeEntity already uses above.
  if (Array.isArray(raw?.boundTiles)) {
    screen.boundTiles = raw.boundTiles.slice(0, LIMITS.boundTilesPerScreen).map((bound) => ({
      switchId: clamp(bound?.switchId, 0, RPG_LIMITS.switches - 1, 0),
      row: clamp(bound?.row, 0, LIMITS.screenRows - 1, 0),
      col: clamp(bound?.col, 0, LIMITS.screenCols - 1, 0),
      metatileId: clamp(bound?.metatileId, 0, LIMITS.metatiles - 1, 0)
    }));
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

function normalizeMap(raw, id, itemCtx = EMPTY_ITEM_CTX) {
  const gridW = clamp(raw?.gridW, 1, LIMITS.mapGrid, 1);
  const gridH = clamp(raw?.gridH, 1, LIMITS.mapGrid, 1);
  const count = gridW * gridH;
  const screens = [];
  for (let i = 0; i < count; i++) screens.push(normalizeScreen(raw?.screens?.[i], itemCtx));
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

function normalizeActor(raw, id, itemCtx = EMPTY_ITEM_CTX) {
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
      // What this monster may leave behind: an item id, resolved through
      // `roll_drop`/`mon_drop` (main/build/battletables.js) to the actor it
      // backs. Carrying and Give/Take keep their field names across the
      // item-schema migration, so there is no separate legacy field to
      // inspect here the way `normalizeEventCommand`'s `item` branch has —
      // once `project.items` exists, this number *is* an item id. Inside
      // normalizeProject's own one-time migration (`itemCtx.migrating`),
      // the raw value is still a pre-item-schema actor id and needs
      // translating through `actorToItem` first, the same as `hasItem`'s
      // `cond.arg` does in `normalizeCondition`. `NO_ITEM` (not a clamped-
      // but-wrong item 0) for anything present but structurally invalid —
      // the same discipline `nullableItemRef` applies for Give/Take.
      drop:
        battle.drop === null || battle.drop === undefined
          ? null
          : itemCtx.migrating
            ? (typeof battle.drop === 'number' ? itemCtx.actorToItem.get(battle.drop) : undefined) ?? null
            : (Number.isInteger(battle.drop) && battle.drop >= 0 && battle.drop <= 255 ? battle.drop : NO_ITEM),
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

// normalizeItem's own effect vocabulary guard: an unrecognized `kind` (a
// hand-edited project, or one written by a later version with a kind this
// one does not know) falls back to `none` rather than being resurrected as
// something it was not — the same safe-default shape `actorId`'s own
// `NO_ACTOR` fallback and `metaspriteId`'s `NO_METASPRITE` fallback already
// use just above and below this function, not the "refuse the build"
// treatment `LIMITS.items`'s own ceiling gets, because unlike an over-cap
// items array a bad `kind` string destroys no real content by being
// defaulted away.
function normalizeEffectKind(raw) {
  return ITEM_EFFECT_KINDS.some((entry) => entry.id === raw) ? raw : ITEM_EFFECT_KINDS[0].id;
}

/**
 * The one-time migration source for an item's `effect`, shared by
 * `normalizeItem` (an item with no `raw.effect` yet) and
 * `migrateItemsFromActors` (an item synthesized for the first time, which by
 * definition has no `raw.effect` to read at all). Both derive the same
 * heal-or-nothing default from the backing actor's own *raw*, unnormalized
 * `battle.heal` — the pre-item-schema economy this field replaces, and the
 * same source `main/build/battletables.js`'s 4b-era `item_heal` table
 * already reads on every build (see the design notes on why this migration
 * is one-time rather than a per-build re-derivation like that table's own).
 * `actorId` is the item's own already-resolved actorId — `null` or
 * `NO_ACTOR` explicitly, not merely "falsy" or "out of range": `NO_ACTOR`
 * is `LIMITS.actors` itself (255), the identical sentinel-aliasing trap
 * `LIMITS.metasprites = NO_METASPRITE` already exists to close one id space
 * over. An over-cap, 256-plus-actor project has a real raw actor sitting at
 * index 255 — indexing `rawActors` with the sentinel's own numeric value
 * would silently read *that* actor's `battle.heal` instead of deriving
 * "none," and the wrong effect would then be written back as an explicit
 * value that survives even after the roster is brought back under the cap.
 * Guarded explicitly rather than relying on `rawActors[255]` happening to be
 * `undefined` (true only while the roster stays under 255 actors).
 */
function deriveItemEffect(rawActors, actorId) {
  if (actorId === null || actorId === NO_ACTOR) return { kind: 'none', amount: 0 };
  const heal = damageAmount(rawActors[actorId]?.battle?.heal ?? 0);
  return heal > 0 ? { kind: 'heal', amount: heal } : { kind: 'none', amount: 0 };
}

function normalizeItem(raw, id, rawActors) {
  const actorId =
    raw?.actorId === null || raw?.actorId === undefined
      ? null
      : Number.isInteger(raw.actorId) && raw.actorId >= 0 && raw.actorId <= LIMITS.actors - 1
        ? raw.actorId
        : NO_ACTOR;
  return {
    id,
    name: typeof raw?.name === 'string' && raw.name ? raw.name : `Item ${id}`,
    // Safe-by-default rather than clamped-to-a-real-actor: a garbage or
    // out-of-range value becomes `NO_ACTOR`, not actor 0 — `actorMissing`
    // already treats `NO_ACTOR` as "does not resolve," the same answer it
    // gives `null`, so this is the roster-blind half of that question.
    // Resolution correctness (does this actorId still name a real, live
    // actor) is validateProject's job, not normalization's, exactly as
    // `actorConditionArg` already does it for a condition's own actor-typed
    // argument. `actorId` is optional metadata now, not a requirement for
    // the item itself to be valid — see `itemMissing`'s own docstring for
    // why existence and pickup-backing are two separate questions.
    actorId,
    // The icon. `null` means "not set — derive one from the backing actor's
    // own resting frame at generation time" (generate.js's resolveItemIcon,
    // reproducing what draw_actor_icon already drew for a migrated item
    // before this table existed, empty-animation stub included). An explicit
    // value 0-255 is used as-is (255 is `NO_METASPRITE`, an author's own
    // explicit "no icon", distinct from "not set yet"). Anything else --
    // out of range, fractional, not a number at all -- is not resurrected as
    // `null` and not rounded/clamped into a real, working-looking metasprite
    // id either: both would silently reinterpret a malformed or stale
    // explicit choice as something it was not, the identical mistake this
    // same shape already refuses one field up for `actorId` (falling back to
    // `NO_ACTOR`, not actor 0). Structurally, not via the generic numeric
    // `clamp()`: that helper rounds and clamps into range by design, which
    // is exactly wrong here — `clamp(-1, 0, 255, 0)` is 0, a real,
    // working-looking metasprite, not "no icon" — so this checks
    // `Number.isInteger` itself rather than rounding into one. Either way it
    // is a real metasprite reference the moment it is not `null`, so
    // metasprite deletion has to know about it: see renumberMetaspriteDeletion.
    metaspriteId:
      raw?.metaspriteId === null || raw?.metaspriteId === undefined
        ? null
        : Number.isInteger(raw.metaspriteId) && raw.metaspriteId >= 0 && raw.metaspriteId <= 255
          ? raw.metaspriteId
          : NO_METASPRITE,
    // One-time, at normalization, exactly like `actorId`/`metaspriteId`
    // above — not re-derived from the backing actor on every build. Once a
    // project has been saved back with an explicit `effect` object (even
    // `{kind:'none', amount:0}`), `raw.effect` is no longer undefined on the
    // next load, so this branch never re-fires — the same idempotence every
    // other field here already has. Re-deriving on every build instead would
    // let a future items editor's own value be silently overwritten the next
    // time the project is built, which is exactly the bug this shape avoids.
    // No `?? []` fallback here: every current caller passes `rawActors`
    // (normalizeProject always does), and a future call site that forgets to
    // must fail loudly (a crash on a missing array) rather than silently
    // derive `none` for every item — the same "let a caller that skips the
    // real question be told so, not defaulted past" reasoning this file
    // applies elsewhere.
    effect:
      raw?.effect && typeof raw.effect === 'object'
        ? { kind: normalizeEffectKind(raw.effect.kind), amount: damageAmount(raw.effect.amount) }
        : deriveItemEffect(rawActors, actorId)
  };
}

/**
 * Walks a *raw*, unnormalized project's maps and common events for every
 * actor id a give/take command, a Carrying condition, or an actor's own
 * `battle.drop` names — used only by the one-time item migration below,
 * before any of those fields have been normalized into the shapes this file
 * otherwise assumes. `onCond` is called for a page's own condition
 * separately from `onCommand`'s walk of that page's commands, mirroring
 * `renumberActorDeletion`'s `renumberCondition(page.cond)` — `allCommands`
 * (shared/eventrules.js) takes a command list and never yields a page's own
 * condition, so a walk that only called `onCommand` inside `allCommands`
 * would miss every page-level Carrying condition, migrating a branch's own
 * but not the page guarding it.
 */
function walkRawEvent(event, onCommand, onCond) {
  for (const page of Array.isArray(event?.pages) ? event.pages : []) {
    onCond(page.cond);
    walkRawCommandList(page.commands, onCommand, onCond);
  }
}
function walkRawCommandList(list, onCommand, onCond) {
  for (const command of Array.isArray(list) ? list : []) {
    if (!command || typeof command !== 'object') continue;
    onCommand(command);
    onCond(command.cond); // a branch's own condition, same as page.cond above
    walkRawCommandList(command.then, onCommand, onCond);
    walkRawCommandList(command.else, onCommand, onCond);
    for (const option of Array.isArray(command.options) ? command.options : []) {
      walkRawCommandList(option.commands, onCommand, onCond);
    }
  }
}

/**
 * The one-time item migration: builds `project.items` and the actor→item
 * map that lets a pre-item-schema project's Give/Take, Carrying and
 * `battle.drop` values be translated rather than lost. Runs only when
 * `raw.items` is not an array — the migration discriminator (see
 * `normalizeProject`) — and never again after: re-running this on an
 * already-migrated project would make "how many items exist" depend on
 * which references still happen to resolve rather than on `project.items`
 * itself, and would reshuffle ids a later edit may already have built on.
 *
 * The item set is the union of two things, not just one: every actor with
 * `behavior === 'pickup'`, and every actor id actually named by a
 * give/take, a Carrying condition, or a `battle.drop`, live or not, found
 * anywhere in the project (`walkRawEvent`, above). The union matters
 * because nothing before this phase required a Give/Take to name a
 * `pickup`-behavior actor — `actorMissing` only ever checked the index was
 * in range — so a project that hands out, say, a `patroller`'s id through
 * Give still needs an item synthesized for it, or that reference has
 * nothing to migrate onto and quietly becomes unresolvable.
 *
 * Ids are assigned in ascending actor-id order — deterministic, but the
 * order carries no semantic weight, since every reference is compiled
 * through the item's own id, not through numeric position. Capped at
 * `LIMITS.items`: an over-cap actor
 * roster (already its own `validateProject` error) must not manufacture an
 * over-cap item list as a side effect that nothing in this phase's UI could
 * then reduce — deleting an actor only nulls the orphaned item's `actorId`,
 * it does not remove the item.
 */
function migrateItemsFromActors(raw) {
  const rawActors = Array.isArray(raw.sprites?.actors) ? raw.sprites.actors : [];
  const referenced = new Set();
  const noteActorId = (id) => {
    if (Number.isInteger(id) && id >= 0 && id < rawActors.length) referenced.add(id);
  };
  rawActors.forEach((actor, id) => {
    if (canBackItem(actor)) referenced.add(id);
  });
  const onCommand = (command) => {
    if ((command.op === 'give' || command.op === 'take') && typeof command.actor === 'number') {
      noteActorId(command.actor);
    }
  };
  const onCond = (cond) => {
    if (cond?.type === 'hasItem' && typeof cond.arg === 'number') noteActorId(cond.arg);
  };
  for (const map of Array.isArray(raw.maps) ? raw.maps : []) {
    for (const screen of Array.isArray(map?.screens) ? map.screens : []) {
      for (const entity of Array.isArray(screen?.entities) ? screen.entities : []) {
        walkRawEvent(entity?.props?.event, onCommand, onCond);
      }
    }
  }
  for (const entry of Array.isArray(raw.commonEvents) ? raw.commonEvents : []) {
    walkRawEvent(entry?.event, onCommand, onCond);
  }
  for (const actor of rawActors) {
    if (typeof actor?.battle?.drop === 'number') noteActorId(actor.battle.drop);
  }

  const orderedActorIds = [...referenced].sort((a, b) => a - b).slice(0, LIMITS.items);
  const actorToItem = new Map(orderedActorIds.map((actorId, itemId) => [actorId, itemId]));
  const items = orderedActorIds.map((actorId, itemId) => ({
    id: itemId,
    name: (typeof rawActors[actorId]?.name === 'string' && rawActors[actorId].name) || `Item ${itemId}`,
    actorId,
    // Deliberately not seeded from the backing actor's own animation.
    // Nothing draws an item's icon in this phase, so seeding one now would
    // be a mechanism built ahead of any consumer of it.
    metaspriteId: null,
    // A freshly-synthesized item has no `raw.effect` to read at all — this
    // is the same one-time derivation `normalizeItem`'s own "not set yet"
    // branch falls back to, applied at the moment the item itself is first
    // created rather than on a later load.
    effect: deriveItemEffect(rawActors, actorId)
  }));
  return { items, itemCtx: { migrating: true, actorToItem } };
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

  // The migration discriminator: no schema version field exists anywhere in
  // this file (compatibility here is always structural), and presence vs.
  // absence of `raw.items` is it. An array — even an empty one — means this
  // project has already been through the migration (or was authored fresh
  // in the new shape), so every reference below is already an item id and
  // gets normalized as one, with no synthesis. Anything else (missing,
  // `null`, not an array) means a pre-item-schema project: `Give`/`Take`/
  // Carrying/`battle.drop` still hold actor ids, and migrateItemsFromActors
  // both builds `project.items` from them and hands back the translation
  // table (`itemCtx.actorToItem`) that lets every one of those raw actor
  // ids become the item id it now means.
  // Not sliced to LIMITS.items, unlike the migration branch below: an
  // already-present items array is real content an author (or a later
  // version) put there, and truncating it here would silently take the
  // over-cap error meant to report it with it — validateProject's own
  // items-length check would never see the entries this dropped before it
  // ever ran. The same reasoning `sprites.actors` below already applies to
  // the identical shape one id space over. `migrateItemsFromActors` is a
  // different case: what it *derives* is capped there deliberately (Q2 in
  // the round-1 review), because nothing before this phase could have
  // authored an over-cap items array by hand for that path to preserve.
  // Threaded into normalizeItem the same way migrateItemsFromActors already
  // reads it directly: an item's effect migration (normalizeItem's own
  // "not set yet" branch) needs the backing actor's *raw* battle.heal, which
  // only exists on this unnormalized array.
  const rawActors = Array.isArray(raw.sprites?.actors) ? raw.sprites.actors : [];
  let items;
  let itemCtx;
  if (Array.isArray(raw.items)) {
    items = raw.items.map((entry, id) => normalizeItem(entry, id, rawActors));
    itemCtx = EMPTY_ITEM_CTX;
  } else {
    ({ items, itemCtx } = migrateItemsFromActors(raw));
  }

  const maps = (Array.isArray(raw.maps) && raw.maps.length ? raw.maps : base.maps).map((map, id) =>
    normalizeMap(map, id, itemCtx)
  );
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

  const { commonEvents, commonEventSeq } = normalizeCommonEvents(raw.commonEvents, raw.commonEventSeq, itemCtx);

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
    items,
    sprites: {
      metasprites: (raw.sprites?.metasprites ?? []).map(normalizeMetasprite),
      animations: (raw.sprites?.animations ?? []).map(normalizeAnimation),
      // Not sliced to LIMITS.actors, unlike commonEvents above and a
      // question's options: an actor past the cap is real content, and
      // dropping it here would take every reference to it with it —
      // silently, since a placement naming a missing actor is not validated
      // anywhere. validateProject refuses the build instead, which keeps the
      // work and puts the choice of what to delete where it belongs.
      //
      // This preserves the actor *records*, and deliberately promises no more
      // than that. Every field that *names* an actor — a placement's
      // `actorId`, a Give/Take's `actor`, a formation id, an encounter id, a
      // drop, a Carrying item condition — clamps to one byte, so a reference
      // to an actor above id $FE cannot survive and is not meant to.
      //
      // Keeping those clamps is a judgement, and worth stating honestly
      // because the obvious argument for it is wrong: a widened value could
      // *not* reach a `.db`. `generateAssets` (main/build/generate.js) runs
      // `checkCapacity` — which includes `validateProject`, which refuses an
      // over-cap roster — and throws before it writes anything, so the
      // pipeline is already closed. The real reasons are:
      //
      // - The byte invariant is this boundary's own job. `normalizeEntity`
      //   below says it outright: everything the generator compiles is
      //   clamped here because a bad value here becomes a bad byte in the ROM.
      //   Widening would leave `generateAssets`' internal ordering as the only
      //   thing between a 256 and `dbBlock` — a single layer, where this
      //   codebase deliberately keeps several (`actorByte` sanitises a
      //   Give/Take *as well as* validateProject refusing one, precisely
      //   because buildProject compiles the project the app is holding rather
      //   than one that has passed validation).
      // - It is not a one-line change. The narrowing would have to move to
      //   every consumer that turns a reference into a byte — `emitScreens`
      //   admits a placement on `actorId < actorCount`, `actorByte` returns an
      //   in-roster id unchanged, `mapEncounterFormation` filters the same
      //   way, `mon_drop` asks `actorMissing`, `encodeCondition` calls
      //   `byte()` — several of which are correct today only because the
      //   schema clamped first.
      //
      // What widening would genuinely buy, stated rather than waved away:
      // `shift` (renumberActorDeletion) would track an over-cap reference
      // correctly *down* into range as the author deleted actors, instead of
      // it sitting on $FF and reading as missing. That is a real benefit, and
      // it is being declined because it accrues only inside a state no
      // version of this app can create, and only until the roster is legal
      // again.
      actors: (raw.sprites?.actors ?? []).map((actor, id) => normalizeActor(actor, id, itemCtx))
    },
    songs: (Array.isArray(raw.songs) ? raw.songs : []).map((song, index) =>
      normalizeSong(song, `Song ${index}`)
    ),
    sfx: (Array.isArray(raw.sfx) ? raw.sfx : []).map((entry, index) =>
      normalizeSfx(entry, `Effect ${index}`)
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

/**
 * The screen ceiling the Build panel's meter shows. Extracted here, rather
 * than left as an expression inline in the Build panel, specifically so the
 * meter is a call to this function and nothing else: renderer/forges/build/
 * build.js has no isRpg/bankedCode/reserveFlashSave logic of its own left to
 * regress independently.
 *
 * This is a nominal estimate -- "how many screens of a fixed size fit" --
 * not the exact packing checkCapacity's own screenCapacityFor performs
 * (main/build/generate.js), which packs the project's *real* screens
 * (screenRecordBytes adds bytes per placed entity) and only counts nominal
 * screens into what is left over. The two agree whenever packing wastes
 * nothing beyond the per-region floor, which is true of every screen in the
 * fixtures this codebase ships, but an entity-dense project can pack fewer
 * real screens than this estimate promises (measured: 8 entities on every
 * screen of `sample` already makes checkCapacity's real ceiling one lower
 * than this one). That is a pre-existing honesty gap in the meter -- not
 * something the flash-save region reservation introduced, and not corrected
 * here, since fixing the meter's formula is a separate concern from this
 * schema refactor. What holds regardless of entity density, *while neither
 * side's real screens actually reach into the region being removed*, is the
 * delta: reserving the flash sector drops this function's answer and drops
 * screenCapacityFor's by exactly one region's worth of nominal screens,
 * each. That precondition is not automatic -- a project dense enough to
 * fill the region the reservation takes gets a smaller delta on the exact
 * side, correctly, because the reservation is displacing real data rather
 * than idle space (test/unit/banked.test.js pins a case where the delta is
 * 21, not a full region). Both the ordinary-fixture delta and that dense
 * boundary are the invariant test/unit/banked.test.js checks -- equality
 * between this function and screenCapacityFor is not, and does not hold in
 * general.
 *
 * `reserveFlashSave` is normally left undefined -- computed from `project`
 * via reservesFlashSaveRegion, which is what the meter itself always does.
 * A caller may pass it explicitly to bypass that gate, the same reason
 * assignScreenBanks's own reserveFlashSave is a plain argument: production
 * reservesFlashSaveRegion is gated on saveMediaImplemented and so never
 * reads true in a real build yet, so the delta test above has nowhere else
 * to force it from.
 */
export function projectScreenCeiling(project, mapper, { reserveFlashSave } = {}) {
  const bankedCode = project.project?.gameType === 'rpg' ? 1 : 0;
  // 240 metatiles + 64 attribute bytes + 1 empty actor-list count byte --
  // mirrors SCREEN_BYTES + 1 in main/build/generate.js (the +1 there is
  // emitScreens' own `[placed.length]`, zero for a screen with no actors),
  // which this module cannot import (it reaches for node:fs).
  const bytesPerScreen = SCREEN_METATILES + 64 + 1;
  const reserve = reserveFlashSave ?? reservesFlashSaveRegion(projectUsesSave(project), mapper);
  return screenCapacity(mapper, bytesPerScreen, project.tilesets.length, bankedCode, { reserveFlashSave: reserve });
}

/**
 * The same question for `move`, and asked for a harder reason than save's.
 *
 * Move is the most expensive command in this engine — a step routine, the
 * collision probe around it, the accessors that let one copy of both serve an
 * entity and the player, and the suspend/resume path — and the kernel bank has
 * no room to carry it unconditionally. Measured on a clean tree: sample-rpg
 * with one Save command leaves 161 free bytes in the kernel-lo bank on MMC3
 * and 353 on MMC1, against roughly 400 for Move. Assembling it into every ROM
 * would not merely tighten the capacity check, it would overflow the bank and
 * fail the assembler, for projects that never use the command.
 *
 * So `MOVE_ENABLED` gates it the way `SAVE_ENABLED` gates engine/save.asm and
 * `BATTLE_ENABLED` gates the battle bank: a project with no live Move assembles
 * byte-for-byte as it did before the command existed, and one that has a Move
 * pays for it and is told in plain language by checkCapacity if it cannot
 * afford it. `liveCommands` + `compiledPages` for the same reason save uses
 * them — a Move switched off, or inside a switched-off branch, is scaffolding
 * the compiler already drops, and must not cost a project 400 bytes of kernel.
 */
export function projectUsesMove(project) {
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (command.op === 'move') return true;
      }
    }
  }
  return false;
}

/**
 * Drives the generated `TURN_ENABLED`, the same shape and the same reason
 * `projectUsesMove` drives `MOVE_ENABLED`: `script_op_turn` is real kernel-lo
 * code with nowhere to go unconditionally in a project that never turns
 * anyone. Kept separate from `projectUsesMove` rather than folded into it —
 * `move_face` (engine/entities.asm), the routine both commands actually call
 * to set a facing, is gated on its own predicate below (`projectUsesFace`)
 * precisely so a Turn-only project pays for `script_op_turn` and
 * `move_face` and nothing of `move_tick`'s own ~379 bytes, and a Move-only
 * project keeps paying for `move_face` without also paying for
 * `script_op_turn`.
 */
export function projectUsesTurn(project) {
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (command.op === 'turn') return true;
      }
    }
  }
  return false;
}

/**
 * Drives the generated `WAIT_ENABLED`. `script_op_wait` and `wait_tick`
 * (engine/entities.asm, hooked into `ui_tick` the same way `move_tick`
 * already is) are real kernel-lo code, so a project with no live Wait must
 * not pay for either, the identical reasoning `projectUsesMove` already
 * documents for `Move`.
 */
export function projectUsesWait(project) {
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (command.op === 'wait') return true;
      }
    }
  }
  return false;
}

/**
 * Drives the generated `SHAKE_ENABLED`, the same shape and the same reason
 * `projectUsesWait` drives `WAIT_ENABLED`: the perturbation code in
 * `nmi_scroll` (engine/boot.asm) and `script_op_shake` (engine/script.asm)
 * are real kernel-lo code with nowhere to go unconditionally in a project
 * that never shakes anything. Unlike Move/Turn, Shake shares no dependent
 * term with anything else (there is no `FACE_ENABLED`-style routine two
 * commands both call), so it needs no companion predicate the way Turn
 * needs `projectUsesFace`.
 */
export function projectUsesShake(project) {
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (command.op === 'shake') return true;
      }
    }
  }
  return false;
}

/**
 * Drives the generated `VISIBLE_ENABLED`, the same shape and the same reason
 * `projectUsesShake` drives `SHAKE_ENABLED`: `script_op_visible`
 * (engine/script.asm) and the `ENT_HIDDEN` check `draw_entities`
 * (engine/entities.asm) gains are real kernel-lo code with nowhere to go
 * unconditionally in a project that never hides anything. Shares no
 * dependent term with Move/Turn/Wait/Shake — there is no routine two of
 * these commands both call — so it needs no companion predicate the way
 * Turn needs `projectUsesFace`.
 */
export function projectUsesVisible(project) {
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (command.op === 'visible') return true;
      }
    }
  }
  return false;
}

/**
 * Drives the generated `FADE_ENABLED`, the same shape and the same reason
 * `projectUsesShake`/`projectUsesVisible` drive their own flags:
 * `script_op_fade`, `fade_tick` and the `fade_reload`/`redraw_screen` hookup
 * (engine/script.asm, engine/entities.asm, engine/boot.asm, engine/screens.asm,
 * engine/combat.asm) are Fade-owned kernel-lo code with nowhere to go
 * unconditionally in a project that never fades anything. `fade_apply_palette`
 * and the NMI PPUADDR cleanup are deliberately *not* driven by this flag on
 * their own — Flash's own `flash_tick`/`vram_reset` cancellation calls the
 * identical routine, so both are gated on the shared `PALETTE_FX_ENABLED`
 * (`projectUsesPaletteFx`, below) instead; see that predicate's own comment
 * for why. `liveCommands` + `compiledPages`, not a top-level scan of
 * `page.commands`: both already recurse into a branch's two sides and a
 * choice's own options (`shared/eventrules.js`), and `projectEvents` already
 * yields every common event as well as every placed actor's own event, so a
 * Fade reachable only through one of those is found here by construction,
 * the identical machinery every other `projectUses*` predicate in this file
 * already relies on.
 */
export function projectUsesFade(project) {
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (command.op === 'fade') return true;
      }
    }
  }
  return false;
}

/**
 * Drives the generated `FLASH_ENABLED`, the identical shape and reason
 * `projectUsesFade` drives its own flag: `script_op_flash`, `flash_tick` and
 * `flash_apply_on` (engine/script.asm, engine/entities.asm) plus the
 * `main_loop` hook and `vram_reset`'s own cancellation glue (engine/boot.asm,
 * engine/text.asm) are real kernel-lo code with nowhere to go unconditionally
 * in a project that never flashes anything. Shares one dependent term with
 * Fade — `fade_apply_palette` and the NMI PPUADDR fix, both re-gated on
 * `PALETTE_FX_ENABLED` below rather than bundled into `FLASH_ENABLED` or
 * `FADE_ENABLED` alone — the identical `projectUsesFace` shape `projectUsesFade`'s
 * own comment already cites for Move/Turn.
 */
export function projectUsesFlash(project) {
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (command.op === 'flash') return true;
      }
    }
  }
  return false;
}

/**
 * Drives the generated `STING_ENABLED`: `sting_snapshot`/`sting_restore`/`sting_tick`
 * (engine/music.asm), `script_op_sting` (engine/script.asm), the `main_loop` call site
 * (engine/boot.asm), and the `force_trig`/cancellation-check/`music_stop` additions to
 * `music_channel`/`music_play`/`music_stop` (engine/music.asm) are all real kernel-lo code with
 * nowhere to go unconditionally in a project that never stings anything. See
 * handoff-sting/design-sting.md §8.
 */
export function projectUsesSting(project) {
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (command.op === 'sting') return true;
      }
    }
  }
  return false;
}

/**
 * Drives the generated `SFX_ENABLED`: the restructured `music_tick`, `script_op_sfx`,
 * `sfx_channel_tick`/`sfx_read_event`/`sfx_apply`, and the ownership guards inside
 * `music_stop`/`init_session` (engine/music.asm, engine/script.asm, engine/combat.asm) are all real
 * kernel-lo code with nowhere to go unconditionally in a project that never plays a sound effect.
 * `sfx` is found here through `liveCommands`' own branch/choice recursion only -- an `sfx` command
 * sitting in a raw route leg is not an admitted leg (`ROUTE_LEG_OPS` is `move`/`turn`/`wait` only,
 * shared/eventrules.js), dropped identically by normalization and by the compiler's own route case,
 * so it never counts on either side. See design-sfx.md §3.8.
 */
export function projectUsesSfx(project) {
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (command.op === 'sfx') return true;
      }
    }
  }
  return false;
}

/**
 * Drives the generated `AUDIO_FX_ENABLED` -- the one genuinely shared piece of code between Sting
 * and SFX, the `force_trig` check-and-self-clear inside `music_channel` (engine/music.asm), gated
 * on whichever of the two features is live rather than folded permanently into `STING_ENABLED`.
 * See design-sfx.md §3.5.
 */
export function projectUsesAudioFx(project) {
  return projectUsesSting(project) || projectUsesSfx(project);
}

/**
 * Drives the generated `BOUND_TILE_ENABLED`. A genuinely different shape
 * from every sibling predicate above: a switch-bound tile is authored screen
 * data (`screen.boundTiles`), not a command inside an event, so there is no
 * `projectEvents`/`compiledPages`/`liveCommands` walk to reuse -- this walks
 * every screen of every map directly. See design-tile.md §8.
 */
export function projectUsesBoundTiles(project) {
  return project.maps.some((map) =>
    map.screens.some((screen) => (screen.boundTiles ?? []).length > 0)
  );
}

/**
 * Drives the generated `PALETTE_FX_ENABLED`, gating `fade_apply_palette` and
 * the NMI PPUADDR fix (engine/entities.asm, engine/boot.asm) on their own
 * rather than bundling them into either `FADE_ENABLED` or `FLASH_ENABLED`
 * alone — the identical shape `projectUsesFace` already uses for
 * `move_face`. `fade_apply_palette` is the one routine both Fade's own
 * `fade_tick` and Flash's own `flash_tick`/`vram_reset` cancellation call, so
 * it must assemble whenever either is live and must be charged exactly once
 * when both are.
 */
export function projectUsesPaletteFx(project) {
  return projectUsesFade(project) || projectUsesFlash(project);
}

/**
 * Drives the generated `FACE_ENABLED`, gating `move_face` (engine/entities.asm)
 * on its own rather than bundling it into either `MOVE_ENABLED` or
 * `TURN_ENABLED` alone. `move_face` is the one routine both `Move` (setting
 * facing once before the first step, script_op_move) and `Turn` (the whole
 * command) call, so it must assemble whenever either is live and must be
 * measured and charged exactly once when both are — never zero times (a
 * Turn-only project silently missing the routine it calls) and never twice
 * (a project with both commands double-charged for one routine).
 */
export function projectUsesFace(project) {
  return projectUsesMove(project) || projectUsesTurn(project);
}

/**
 * Whether this project's `items[]` engine machinery -- the bag holding item
 * ids rather than actor ids, the icon table, the enabled-path battle tables
 * -- is worth assembling at all. Drives the generated `ITEMS_ENABLED` flag
 * the same way `projectUsesMove` drives `MOVE_ENABLED`: `kernelCodeBytes`
 * charges `ITEM_KERNEL_ALLOWANCE` only when this is true, and every dual
 * `.if ITEMS_ENABLED`/`.else` site in the engine falls back to exactly
 * today's actor-id economy when it is false.
 *
 * Deliberately `.length > 0`, not "has at least one item that resolves to a
 * real actor" (an earlier draft of this predicate, and wrong): existence and
 * pickup-backing are two separate questions now (see `itemMissing`'s own
 * docstring), so gating the whole feature on resolution would make one
 * unrelated item's actor getting deleted elsewhere in the project silently
 * flip a *different*, otherwise-untouched pickup between the item economy
 * and the legacy one -- a non-local dependency an author editing one item
 * could accidentally trigger on a completely different placement. An
 * `items[]` array that exists at all, even with every entry orphaned, is a
 * deliberate authoring choice this predicate takes at face value, matching
 * how little `projectUsesMove` itself filters.
 */
export function projectUsesItems(project) {
  return (project.items?.length ?? 0) > 0;
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

      // Switch-bound tiles (design-tile.md §10): range, then duplicate-cell,
      // then palette, in that order -- each later check trusts the fields
      // the earlier one already refused, since normalization clamps a
      // project loaded through it but validateProject is not the only door a
      // project reaches it through (a hand-edited file, or one saved by a
      // later version, loaded with no normalization pass in between).
      const bound = screen.boundTiles ?? [];
      if (bound.length > LIMITS.boundTilesPerScreen) {
        add(
          'error',
          'Map Forge',
          `${screenLabel(project, mapIndex, index)} has ${bound.length} switch-bound tiles; ` +
            `the engine allows ${LIMITS.boundTilesPerScreen}.`
        );
      }

      // Range validation, defense in depth -- every entry that fails is
      // refused AND excluded from the duplicate/palette checks below, which
      // would otherwise index screen.metatiles/project.metatiles unsafely.
      const inRange = [];
      bound.forEach((entry, i) => {
        const badSwitch =
          !Number.isInteger(entry.switchId) || entry.switchId < 0 || entry.switchId >= RPG_LIMITS.switches;
        const badRow = !Number.isInteger(entry.row) || entry.row < 0 || entry.row >= LIMITS.screenRows;
        const badCol = !Number.isInteger(entry.col) || entry.col < 0 || entry.col >= LIMITS.screenCols;
        const badMetatile =
          !Number.isInteger(entry.metatileId) || entry.metatileId < 0 || entry.metatileId >= LIMITS.metatiles;
        if (badSwitch || badRow || badCol || badMetatile) {
          add(
            'error',
            'Map Forge',
            `${screenLabel(project, mapIndex, index)} has an invalid switch-bound tile (entry ${i}): ` +
              'switch, row, column or metatile is out of range.'
          );
        } else {
          inRange.push(entry);
        }
      });

      // Two bindings at the same cell would silently mean "whichever ROM
      // entry the engine's cache scan finds first" -- ambiguous authored
      // state, refused rather than left to an implementation detail
      // (bound_tile_lookup's own scan order).
      const seenCells = new Set();
      for (const entry of inRange) {
        const key = `${entry.row},${entry.col}`;
        if (seenCells.has(key)) {
          add(
            'error',
            'Map Forge',
            `${screenLabel(project, mapIndex, index)} has two switch-bound tiles at row ${entry.row}, ` +
              `col ${entry.col}. Remove one.`
          );
        }
        seenCells.add(key);
      }

      // The palette question, resolved as costing option (a): the substitute
      // must share the palette group the target cell is CURRENTLY painted
      // with, so draw_screen never needs to touch the attribute byte.
      for (const entry of inRange) {
        const paintedId = screen.metatiles[entry.row * LIMITS.screenCols + entry.col];
        const painted = project.metatiles[paintedId];
        const substitute = project.metatiles[entry.metatileId];
        if (painted && substitute && painted.palette !== substitute.palette) {
          add(
            'error',
            'Map Forge',
            `${screenLabel(project, mapIndex, index)} row ${entry.row}, col ${entry.col}: the ` +
              `switch-bound substitute uses a different palette group than what is painted there. ` +
              'Repaint the cell or choose a same-palette substitute.'
          );
        }
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
  // projectUsesHeartArt, not projectUsesCombat: draw_hud (engine/combat.asm)
  // is gated `.if !BATTLE_ENABLED`, so an RPG never draws the HUD hearts and
  // must not have its own party/portrait art refused over a reservation the
  // ROM does not contain, even though projectUsesCombat can still be true
  // there (a monster's contact damage starts a fight rather than a heart, but
  // COMBAT_ENABLED still has to be on for the check to run at all).
  if (projectUsesHeartArt(project)) {
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
    // A monster's drop is the one item reference that is a *field* rather
    // than a command, so neither the battle-formation walk below nor the
    // give/take check outside this block can see it — which is how the
    // actor-shaped version of this defect went unrenumbered and unvalidated
    // for as long as it did.
    //
    // A warning, not an error, and deliberately not the severity a live
    // Give/Take with a missing item gets. That one is fatal because
    // script_op_give (engine/script.asm) *stops the event* on NO_ITEM:
    // everything the author wrote after the Give silently never runs, which
    // is invisible from the Map Forge. A drop has no such knock-on — the
    // monster fights exactly as before and simply hands out nothing, since
    // battletables.js compiles an unresolvable drop to NO_ITEM directly and
    // roll_drop takes its early exit. That is the stale-reference shape, and
    // it gets the stale-reference severity: the same one staleBattleMonsters
    // below and the encounter table just above already use.
    //
    // `null` is not this. It is "Nothing" chosen on purpose in the Sprite
    // Forge, and it is also the mark renumberItemDeletion leaves — warning
    // about it would turn every deletion into a build complaint.
    //
    // itemMissing now asks only "does this item id exist" — a drop naming an
    // item with no physical pickup (actorId null or stale) is not this
    // warning's business; that item still exists and still gets dropped.
    for (const actor of project.sprites.actors) {
      const drop = actor.battle?.drop;
      if (drop === null || drop === undefined) continue;
      if (itemMissing(project.items, drop)) {
        add(
          'warning',
          'Sprite Forge',
          `${actor.name} is set to drop an item that no longer exists, so it will leave nothing behind.`
        );
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
    // saveMediaImplemented, not saveCapable: every registered board's medium
    // is implemented today (engine/save.asm's SAVE_BASE is media-dependent --
    // battery RAM at $6000, or a RAM buffer the flash driver commits, per
    // board -- see main/build/generate.js), so the two predicates currently
    // agree everywhere and this can only fire for a board with no save medium
    // at all. Checking saveMediaImplemented rather than saveCapable directly
    // is what keeps this refusal honest the day a future medium is declared
    // before the engine actually drives it -- see saveMediaImplemented's own
    // comment. Refusing here is what keeps the build from silently
    // assembling a Save command that writes to open bus.
    if (!saveMediaImplemented(saveMapper)) {
      add(
        'error',
        'Build',
        `${saveUnsupportedReason(saveMapper)} Choose MMC1, MMC3 or UNROM 512 in the Build panel, or remove the Save command.`
      );
    }
    // Continue is a title-screen option (engine/title.asm); a save with no
    // title to offer it from would be a ROM you cannot load a save in rather
    // than a build error you can act on before shipping it. The effective
    // form, not the loose one: a stale titleMap that names no real map
    // normalizes to null on load, but this validator runs against whatever
    // it is handed, including a project that has not been through that
    // clamp -- and generateAssets's own titleEnabled would compute 0 for
    // that project regardless of what the loose predicate says, so
    // approving it here would be exactly the false negative this check
    // exists to catch.
    if (!projectUsesEffectiveTitle(project)) {
      add(
        'error',
        'Map Forge',
        'A project with a Save command needs a title screen — Continue has nowhere to appear without one. ' +
          'Set a title map, or remove the Save command.'
      );
    }
  }

  // Not RPG-only: every build compiles actor references through the same
  // NO_ACTOR byte, so the ceiling that keeps that byte unambiguous applies to
  // an action project exactly as much.
  //
  // An error rather than a truncation on load. normalizeProject deliberately
  // keeps every actor it is handed (see its own note): a 256th actor is real,
  // drawable, placeable data a later version could legitimately support, not
  // the kind of unreachable scaffolding choiceOptionsSlice drops — and
  // silently deleting it would leave every reference to it dangling,
  // placements included, which nothing validates and which would reach the
  // generator as an index past the end of the actor tables. Refusing the
  // build and keeping the data lets the author decide which actor goes.
  //
  // The message says what over-cap editing costs. It is not, however, what
  // reaches the author first: validateProject is rendered only by the Build
  // Forge, and a project reopens in whichever Forge was last active, so
  // somebody can open an over-cap project, go straight to the Sprite Forge
  // and delete without ever having seen this. `overCapDeleteWarning` (above)
  // is what covers that path, at the confirmation for the edit itself; this
  // message is the account in the place the ceiling is actually explained.
  //
  // The policy — above the ceiling, references are simply not preserved — is
  // one rule, chosen over three narrower remedies. Restricting which actor
  // may be deleted, or refusing deletion outright, would make validation's
  // own instruction impossible to follow; carrying provenance to tell a real
  // actor 255 from the NO_ACTOR sentinel would teach every $FF comparison in
  // the schema, the compiler and the engine to mean two things. And a
  // guarantee that covered only *some* over-cap projects would be harder to
  // state than none: at 257 actors a load has already clamped references to
  // actor 256 onto the same $FF a real actor 255's references sit on, so
  // preserving one and mangling the other reads as arbitrary. That last point
  // is a reason, not a proof — at exactly 256 actors nothing has been clamped
  // onto $FF and a narrower guarantee would be perfectly coherent. One rule
  // for every over-cap project is a choice, made because a rule that changes
  // shape at 257 is worse to explain than one that does not.
  if (project.sprites.actors.length > LIMITS.actors) {
    add(
      'error',
      'Sprite Forge',
      `This project has ${project.sprites.actors.length} actors but the Forge holds ${LIMITS.actors} ` +
        `(ids 0-${LIMITS.actors - 1}) — id $FF is reserved to mean “no actor”. Delete ` +
        `${project.sprites.actors.length - LIMITS.actors} of them. The extra actors are kept, but references ` +
        `to any actor above id ${LIMITS.actors - 1} are not preserved: a reference is a single byte, so it ` +
        'cannot name them, and editing the roster while over the ceiling will not bring them back.'
    );
  }

  // The item-space sibling of the actor ceiling above. Ordinarily this
  // cannot happen — the one-time migration (normalizeProject) caps what it
  // derives at LIMITS.items, so a project built by this version's own UI
  // never grows one over-cap on its own — but a project written by a later
  // version, or a hand-edited items array (which normalizeProject now keeps
  // in full rather than silently truncating, precisely so this check can
  // still see it), still can, and the ceiling is a real one: every
  // reference to an item is a single byte carrying the item id directly.
  // Attributed to 'Items Forge' now that one exists (ROADMAP item 5 phase 4c
  // round 1b) — it is where the Delete control this message now points at
  // actually lives. Deliberately does not suggest trimming the actor roster
  // instead: an already-migrated items array does not shrink when actors do
  // (deleting one only nulls the orphaned item's actorId — see
  // renumberActorDeletion), so that advice would send the author to fix the
  // wrong list.
  if (project.items.length > LIMITS.items) {
    add(
      'error',
      'Items Forge',
      `This project has ${project.items.length} items but the Forge holds ${LIMITS.items} ` +
        `(ids 0-${LIMITS.items - 1}) — id $FF is reserved to mean “no item”. Delete ` +
        `${project.items.length - LIMITS.items} of them before this can build.`
    );
  }

  // The metasprite-space sibling of the two ceilings above, and round 5's own
  // fix: before LIMITS.metasprites existed, this array was genuinely
  // uncapped, so a project could reach a real metasprite 255 — the exact
  // value NO_METASPRITE (an item's own explicit "no icon") already uses, with
  // no way for a derived icon or an explicit reference to tell the two apart.
  // Ordinarily this cannot happen now — the Sprite Forge's own Add button
  // stops at the ceiling — but a project written by a later version, or a
  // hand-edited one (normalizeProject keeps the array in full rather than
  // silently truncating it, precisely so this check can still see it), still
  // can. Refusing the build rather than silently slicing keeps the same
  // promise the actor/item ceilings above already make: a 256th metasprite
  // is real, drawable, placeable content, not scaffolding to drop.
  if (project.sprites.metasprites.length > LIMITS.metasprites) {
    add(
      'error',
      'Sprite Forge',
      `This project has ${project.sprites.metasprites.length} metasprites but the Forge holds ` +
        `${LIMITS.metasprites} (ids 0-${LIMITS.metasprites - 1}) — id $FF is reserved to mean “no icon”. Delete ` +
        `${project.sprites.metasprites.length - LIMITS.metasprites} of them before this can build.`
    );
  }

  // Each item may name at most one backing actor. This is what makes the
  // forward direction safe to build without a collision rule of its own:
  // main/build/generate.js's emitScreens resolves a placed pickup actor's id
  // to the one item it grants (actorId -> item id, the reverse of the field
  // itself), and that lookup is only ever correct if it is 1:1. Two items
  // sharing an `actorId` would make it silently first-match dependent, which
  // is worse than refusing the build: the author would see one item drawn,
  // given and validated, while a second item quietly named the same actor
  // and never worked the way its own Give/Take/Carrying references implied,
  // and a pickup of that actor would silently grant whichever item happened
  // to be found first.
  const actorIdCounts = new Map();
  for (const item of project.items) {
    // actorMissing, not a check against NO_ACTOR alone -- round 4 finding:
    // NO_ACTOR is one way an actorId fails to resolve, but not the only one.
    // A stale in-range id (an actor that existed when the item was authored
    // and was deleted since, or a hand-edited/later-version project) passes
    // the old `!== NO_ACTOR` check and got counted, so two items both
    // orphaned onto the same no-longer-real actorId (say, both left at a
    // stale `actorId: 7` after actor 7 was deleted) raised "actor backs more
    // than one item" for an actor that does not exist, in a relationship
    // (the pickup reverse lookup) that never reads a non-resolving actorId
    // at all. Two independently malformed/stale items are a real problem,
    // same as the comment this replaces already said -- just not the one
    // this message describes, so they must not be counted here either way.
    if (actorMissing(project.sprites.actors, item.actorId)) continue;
    actorIdCounts.set(item.actorId, (actorIdCounts.get(item.actorId) ?? 0) + 1);
  }
  const sharedActorItems = [...actorIdCounts.values()].filter((count) => count > 1).length;
  if (sharedActorItems) {
    add(
      'error',
      'Sprite Forge',
      `${sharedActorItems} actor${sharedActorItems === 1 ? ' backs more than one item' : 's back more than one item each'} ` +
        '— each item must name a different actor.'
    );
  }

  // A placed pickup actor that no item's actorId names: walking into it (or
  // interacting with it) resolves to NO_ITEM and grants nothing -- still
  // vanishes off the map and still counts toward `pickups`, but never enters
  // the bag or shows a menu row. That is a real, if narrow, behaviour a
  // hand-authored project can hit (main/build/generate.js's emitScreens is
  // where it happens), and it is exactly the kind of silent "looks like a
  // pickup, does something else" case this codebase prefers to name rather
  // than let an author discover in play. A warning, not an error: nothing is
  // actually broken -- an actor is allowed to be scenery that merely
  // disappears, and this only flags the case an author might not have meant.
  //
  // Round 6 review (P1): this whole warning means something only under
  // ITEMS_ENABLED (projectUsesItems). `add_item`'s own NO_ITEM guard
  // (engine/ui.asm) is itself gated `.if ITEMS_ENABLED` and does not
  // assemble at all in a project with no items -- there, entity_pickup
  // passes the actor's own id (ent_actor,x, not an item id -- there is no
  // item id space in that economy), and add_item takes it unconditionally.
  // So a "Pickup with no backing item" in an items-free project is not
  // unbacked in any sense the disabled economy recognises: it always enters
  // the bag, by its own actor id, exactly as it did before phase 4b. The
  // set below is legitimately empty whenever the project has no items --
  // not because no actor could ever qualify, but because "backed by an
  // item" is a question only the enabled economy asks at all.
  const backedActorIds = projectUsesItems(project)
    ? new Set(project.items.filter((item) => typeof item.actorId === 'number').map((item) => item.actorId))
    : null;
  const unbackedPickups = backedActorIds
    ? project.sprites.actors.filter((actor, id) => canBackItem(actor) && !backedActorIds.has(id))
    : [];
  for (const actor of unbackedPickups) {
    add(
      'warning',
      'Sprite Forge',
      `${actor.name} has behaviour Pickup but no item names it — picking it up will disappear and count ` +
        'toward the pickup total, but will not be held in the bag. Give an item this actorId if that is not intended.'
    );
  }

  // The Items Forge's own effect select only ever writes a recognized
  // ITEM_EFFECT_KINDS id and a number clamped to 0-255 -- so a *missing*
  // `effect` (every hand-built item literal already in this test suite,
  // predating this field, included) is not flagged here: it is the same
  // "not set" state `metaspriteId: null` already tolerates, not a broken
  // value. What this does refuse is an `effect` that is *present* but does
  // not name a real kind or a byte-range amount — reachable only through a
  // hand-edited project, or one written by a later version with a kind this
  // one does not know, never through this version's own editor. Unlike
  // `actorId`/`metaspriteId`, an unrecognized `kind` has no safe sentinel
  // byte `item_heal` (`main/build/battletables.js`, its one reader so far)
  // could fall back to — there is no "invalid effect" equate the way
  // `NO_ACTOR`/`NO_METASPRITE` already are — so a malformed *explicit* value
  // reaching that table's `.db` emission would be a generator bug, not a
  // wrong-but-harmless byte.
  let malformedEffects = 0;
  for (const item of project.items) {
    if (item.effect === undefined || item.effect === null) continue;
    const validKind = ITEM_EFFECT_KINDS.some((entry) => entry.id === item.effect.kind);
    const validAmount = Number.isInteger(item.effect.amount) && item.effect.amount >= 0 && item.effect.amount <= 255;
    if (!validKind || !validAmount) malformedEffects++;
  }
  if (malformedEffects) {
    add(
      'error',
      'Items Forge',
      // Not "re-save": main/project-io.js's saveProject normalizes its own
      // local copy of whatever the renderer handed it and writes *that* to
      // disk, but never hands the normalized project back to the live
      // store -- so saving again leaves this session refusing the same
      // build forever. Only closing and reopening the project (or the
      // View ▸ Reload item, which discards the same way) runs loadProject
      // fresh and actually gets a normalized copy back into the session.
      `${malformedEffects} item${malformedEffects === 1 ? ' has' : 's have'} an effect this version cannot ` +
        'compile — close and reopen the project so it can be normalized again; re-saving alone will not fix it.'
    );
  }

  // Give item / Take item is a base-engine command (engine/ui.asm's
  // add_item/inv_items, driven by OP_GIVE/OP_TAKE in every build), not one
  // BATTLE_ENABLED gates the way the battle checks above are -- an action
  // project offers it too, so this runs unconditionally rather than inside
  // the RPG-only block. itemMissing is the same "does this exist" question
  // the compiler (main/build/textcompile.js) and the Map Forge's own select
  // ask; checking only for `null` here would miss an id past the end of the
  // item list that was never produced by a deletion at all.
  let missingGiveTake = 0;
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (
          (command.op === 'give' || command.op === 'take') &&
          itemMissing(project.items, command.item)
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
        'item. Pick an item or switch the command off.'
    );
  }

  // A Sting naming nothing, or a song since deleted, is the Give/Take shape (itemMissing above),
  // not music's own silent-NO_SONG-for-Silence shape -- Silence is a legitimate `music` choice,
  // but there is no silence-equivalent sting, so NO_SONG here can only mean "never picked" or
  // "picked, then deleted." songByte collapses both to NO_SONG identically, which is why one check
  // catches both. songFrameLength (shared/audio.js) is the same duration textcompile.js's own
  // 'sting' case computes, imported from the one shared place rather than reimplemented here, so
  // the two can never independently drift on what a given song's duration is.
  let missingStings = 0;
  let overlongStings = 0;
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (command.op !== 'sting') continue;
        const songIndex = songByte(project.songs, command.song);
        if (songIndex === NO_SONG) {
          missingStings++;
        } else if (songFrameLength(project.songs[songIndex]) > 255) {
          overlongStings++;
        }
      }
    }
  }
  if (missingStings) {
    add(
      'error',
      'Map Forge',
      `${missingStings} Sound sting command${missingStings === 1 ? '' : 's'} do not name a real ` +
        'song. Pick a song or switch the command off.'
    );
  }
  if (overlongStings) {
    add(
      'error',
      'Map Forge',
      `${overlongStings} Sound sting command${overlongStings === 1 ? '' : 's'} name a song that ` +
        'takes longer than 255 frames (4.25s) to complete its own first pass. Shorten the song ' +
        'or pick a different one.'
    );
  }

  // A Play a sound effect command naming nothing, or an effect since deleted, is the identical
  // Sting shape above, one format over: a live command promising to play a specific effect at a
  // specific moment is a promise the ROM must be able to keep, checked at build time rather than
  // silently swallowed at runtime.
  let missingSfx = 0;
  let overlongSfx = 0;
  for (const event of projectEvents(project)) {
    for (const page of compiledPages(event)) {
      for (const command of liveCommands(page.commands, CHOICE_LIMITS.options)) {
        if (command.op !== 'sfx') continue;
        const sfxIndex = sfxByte(project.sfx, command.sfx);
        if (sfxIndex === NO_SFX) {
          missingSfx++;
        } else if (sfxFrameLength(project.sfx[sfxIndex]) > 255) {
          overlongSfx++;
        }
      }
    }
  }
  if (missingSfx) {
    add(
      'error',
      'Map Forge',
      `${missingSfx} Play a sound effect command${missingSfx === 1 ? '' : 's'} do not name a real ` +
        'effect. Pick an effect or switch the command off.'
    );
  }
  if (overlongSfx) {
    add(
      'error',
      'Map Forge',
      `${overlongSfx} Play a sound effect command${overlongSfx === 1 ? '' : 's'} name an effect ` +
        'that takes longer than 255 frames (4.25s) to play. Shorten the effect or pick a different ' +
        'one.'
    );
  }

  // The sfx-space sibling of LIMITS.items' own over-cap check above: a project holding more
  // effects than LIMITS.sfx allows (hand-edited, or authored by a later version) is refused with a
  // named, actionable count, not silently truncated.
  if (project.sfx.length > LIMITS.sfx) {
    add(
      'error',
      'Sound Forge',
      `This project has ${project.sfx.length} sound effects but the Forge holds ${LIMITS.sfx} ` +
        `(ids 0-${LIMITS.sfx - 1}) — id $FF is reserved to mean "no effect". Delete ` +
        `${project.sfx.length - LIMITS.sfx} of them before this can build.`
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
