// Turns a project into the .inc/.chr files the template engine includes.
//
// Everything the engine and the generator both need to agree on is emitted
// here into assets/config.inc, so there is exactly one writer for each shared
// constant and no chance of the two drifting apart.

import fs from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeTiles, tileFromString, BLANK_TILE } from '../../shared/chr.js';
import { normalizeSong } from '../../shared/audio.js';
import {
  ARROW_TILE,
  BORDER_CORNER,
  BORDER_H,
  BORDER_V,
  BOX_COLS,
  FONT_BASE,
  charToTile,
  FONT_TILES,
  HEART_EMPTY_TILE,
  HEART_FULL_TILE,
  HEART_TILES,
  SPRITE_ARROW_ART,
  SPRITE_ARROW_TILE,
  TILE_SPACE,
  fontBankSplit,
  fontChrPages,
  projectUsesCombat,
  projectUsesHeartArt,
  projectUsesText
} from '../../shared/font.js';
import { compileSong, songTables } from './songcompile.js';
import { NO_EVENT, compileText, textTables, songByte } from './textcompile.js';
import { battleTables, checkBattleTables } from './battletables.js';
import {
  LIMITS,
  RPG_LIMITS,
  SCREEN_METATILES,
  BEHAVIORS,
  ACTIONS,
  BUTTONS,
  EVENT_TRIGGERS,
  INPUT_STATES,
  effectiveTrigger,
  collisionIndex,
  validateProject,
  projectUsesSave,
  projectUsesMove,
  projectEvents,
  allCommands
} from '../../shared/project.js';
import { SAVE_FIELDS, saveBodySize, saveIdentity } from '../../shared/save.js';
import {
  CHR_BANK_BYTES,
  PRG_SWITCH,
  SCREEN_REGION_BYTES,
  SUPPORTED_MAPPERS,
  chrBanksFor,
  chrPayloadRegions,
  chrRegisterTable,
  codeRegions,
  flashSaveCapable,
  flashSaveSectorBank,
  mirroringOptions,
  mirroringValue,
  prgLayout,
  reservesFlashSaveRegion,
  resolveMapper,
  rpgCapable,
  saveMediaImplemented,
  screenRegions,
  tilesetLimit
} from '../../shared/cartridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE_DIR = path.resolve(__dirname, '../../engine');

export const SCREEN_BYTES = SCREEN_METATILES + 64; // 240 metatiles + 64 attribute bytes

/**
 * The stock engine sources, which is what makes a Code Forge override an
 * *override* rather than a new file. The engine folder is the single writer for
 * that list — nothing else may keep a copy of it.
 */
let engineFileCache = null;
export function engineFileNames() {
  if (!engineFileCache) {
    engineFileCache = readdirSync(ENGINE_DIR)
      .filter((file) => file.endsWith('.asm'))
      .sort();
  }
  return engineFileCache;
}

// actor, x, y, the door target (screen, x, y), then the event it runs, what
// makes it run, and the switch that hides it. Actors that use none of it carry
// zeroes and $FF there; a uniform record keeps the engine's spawn loop trivial.
//
// The hide switch stays last because it is the one field spawn_entities reads
// and then may act on by abandoning the record — everything after it would have
// to be stepped over on the path that declines the actor as well as the one that
// keeps it, which is two places to get the cursor right instead of none.
export const ENTITY_RECORD = 9;

/** Bytes the compiled music will occupy: period table, instruments and streams. */
function musicSize(songs) {
  const list = songs?.length ? songs : [];
  const streams = list.reduce(
    (total, song) =>
      total + compileSong(song).channels.reduce((sum, channel) => sum + channel.bytes.length + 3, 0),
    0
  );
  const instruments = list.length ? (normalizeSong(list[0]).instruments.length || 1) : 1;
  return 192 + instruments * 5 + 32 + streams + 4 * Math.max(1, list.length) * 2;
}
const BANK_SIZE = 8192;

/**
 * How many 8 KB regions of the switchable window this project spends on engine
 * code rather than data. One, for the battle system, and only for an RPG — which
 * is the whole reason an RPG needs a mapper that can switch PRG at all.
 */
export const codeRegionCount = (project) => (project.project?.gameType === 'rpg' ? 1 : 0);

// Where the two title lines sit, in tile rows. Clear of the overscan at both
// ends, and far enough apart to read as a title and a prompt rather than a
// paragraph.
// Encounter formations are a fixed four slots per map so the engine can index
// with a shift; $FF is an empty slot.
const RPG_ENCOUNTER_SLOTS = 4;
const encounterRow = (map, actorCount) => {
  const ids = (map.encounters?.actorIds ?? []).filter((id) => id < actorCount).slice(0, RPG_ENCOUNTER_SLOTS);
  return [...ids, ...new Array(RPG_ENCOUNTER_SLOTS - ids.length).fill(0xff)];
};

const TITLE_NAME_ROW = 10;
const TITLE_PROMPT_ROW = 19;

// Engine code in the fixed kernel, which shares its 8 KB bank with the lookup
// tables. The reservation this leaves checkCapacity() must be an
// over-estimate of the real code -- too low and it promises table room the
// assembler then refuses -- but it is no longer one flat number, because a
// single shared constant charges every project on every mapper for the most
// expensive thing *any* project can turn on, whether or not this one does.
//
// That stopped being a rounding error the day save/load (engine/save.asm,
// MMC1/MMC3 only) needed ~370 extra bytes: raising one flat constant to cover
// it took a 54-screen UxROM project — which never asked for a battery, was
// building the day before, and was already only five bytes under the old
// ceiling — and broke it, `The lookup tables need 806 bytes but only 441 are
// free`. That project's own mapper has vastly more screen-storage capacity
// than it was using; the shared kernel-lo table budget became the binding
// wall before UxROM's own advertised capacity was ever in play. This is not
// a one-off: the bigger a board's PRG and screen capacity, the sooner the
// flat reservation becomes the real ceiling instead of the one the Build
// panel's mapper hint promises, for *any* feature that grows the kernel
// enough -- combat, the RPG kernel-side half and the title screen all still
// charge every project the same way save/load did before this split. Making
// the whole reservation a function of every conditional block, the way the
// two terms below are of just this one, is real and worth doing, but it is
// its own change of unknown size — noted here for whoever plans it, not
// started.
//
// kernelCodeBytes(project, mapper) is the single writer now, the way
// fontBankSplit (shared/font.js) and tilesetLimit (shared/cartridge.js)
// already are for their own conditional rules: checkCapacity() and
// test/unit/kernelbytes.test.js both call it rather than importing a bare
// number, so the two cannot end up with two different answers about the same
// project the way a flat constant let them.
//
// The pieces, each measured by building sample-rpg with a title and every
// conditionally-assembled block heal/damage's own measurement already
// covered (dialogue, action combat, the RPG battle system, branches,
// questions, common-event calls, Play music, Start a battle, Heal/Damage) --
// nesasm's kernel-lo usage minus that build's own fixedBytes + tableBytes:
//
// BASE_KERNEL_CODE_BYTES_BY_MAPPER is the worst case with nothing
// conditional turned on -- no Save, no Move, no text on a split-font board
// -- measured per mapper rather than once. A single flat number, measured on
// UNROM 512 because banks.asm emits the most code for it, used to be charged
// to every board; MMC3's own switch_chr_bank/switch_prg_bank pair is smaller,
// so that overcharged every MMC3 project by 8 bytes, and MMC1's by 195 --
// both boards forced to carry UNROM 512's own combined PRG/CHR register
// plumbing, which neither of them has. Only three mappers can be measured
// this way at all: sample-rpg needs a mapper that switches both PRG and CHR
// (rpgCapable() in shared/cartridge.js), which is exactly UNROM 512, MMC1 and
// MMC3 -- the same three test/unit/kernelbytes.test.js already builds.
//   UNROM 512: 6678   MMC1: 6483   MMC3: 6670
// (MMC3's own figure excludes SPLIT_LOCK_KERNEL_ALLOWANCE, kept a separate
// term below for the same reason it always was -- see its own paragraph.)
// Every other supported mapper -- NROM, CNROM, GxROM, Color Dreams, UxROM --
// cannot build an RPG at all, so this methodology cannot measure a base for
// any of them; baseKernelCodeBytes() falls back to the largest of the three
// figures above for a mapper this table has no entry for, which is not a
// guess standing in for a measurement -- it is the exact same worst-case
// number this function charged every board before this change, so a project
// on one of those five reserves precisely the budget it always did.
// codebuild.test.js's byte-identical NROM build and cartridge.test.js's
// UxROM screen-count test both depend on that fallback never moving.
//
// SAVE_KERNEL_ALLOWANCE_BY_MAPPER is the extra a board pays only when
// save/load itself assembles, derived per board from the difference
// save/load actually measures on the two boards that can build it at all --
// not guessed, and not the larger of the two charged to both the way it used
// to be, now that a per-mapper base makes a per-mapper allowance the same
// kind of number: MMC1 goes from 6483 to 7030 (+547), MMC3 from 6689 to 7241
// (+552, text always on for an RPG on a split-font board -- see
// SPLIT_LOCK_KERNEL_ALLOWANCE below). (This grew from an earlier +453/+458
// once a review pass range-checked every restored value load_apply_body
// trusts as a table index -- player_dir, player_y, each live inv_items
// entry, each pc_level -- and widened the identity from two bytes to four;
// then from +526/+531 once a further pass added the pc_in_party bound and
// the jmp relay save_check_valid's own branch-range fix needed once that
// bound pushed save_check_invalid out of a bne's reach -- see
// engine/save.asm's own header comment and shared/save.js's saveIdentity()
// for what each of those costs and why. This constant's own history is why a
// passing kernelbytes.test.js run is not the same as having re-measured it:
// the allowance drifted one round behind reality -- 531 recorded while the
// real delta had already grown to 552 -- and the test still passed, because
// 531 still covered 552's own shortfall against a much looser bound than the
// one below. Caught only by re-running the real measurement by hand and
// diffing it against this comment's claim, not by the test going green.)
//
// SPLIT_LOCK_KERNEL_ALLOWANCE is a third term, MMC3-only and conditional the
// same way, and it stays a separate term rather than folding into MMC3's own
// base: switch_prg_bank's critical section against the call_battle interrupt
// race (engine/banks.asm, engine/split.asm — split_lock in
// engine/constants.asm) is wrapped `.if SPLIT_ENABLED`, so only a project
// that shows text on MMC3 (fontBankSplit) pays it, measured at 19 bytes.
// Every RPG shows text unconditionally (projectUsesText returns true for the
// game type alone, battle messages included), so this is really "every RPG
// on MMC3" rather than a case that has to be sought out -- MMC3's own
// SAVE_ENABLED-off figure above (6689) already has it baked in; the
// per-mapper base does not, or an *action* project on MMC3 with no text
// would be overcharged 19 bytes for a fix its own ROM cannot contain. This is
// the same reasoning SAVE_KERNEL_ALLOWANCE_BY_MAPPER above and
// MOVE_KERNEL_ALLOWANCE below are already built on, applied to a fix instead
// of a feature -- and it is what "per-mapper base" does not subsume: a base
// is a property of the board, this is a property of the board *and* whether
// the project shows text, so it cannot become one more row in the base table
// without overcharging every MMC3 project that carries no dialogue.
//
// KERNEL_SLACK is kept on the *total*, once, here — never inside any term
// above, or a margin on each would compound into a bigger one than any was
// meant to carry. It is deliberate headroom on top of terms that are each
// already supposed to equal their own worst measured delta -- not a second,
// looser allowance that a stale term gets to quietly borrow from.
// test/unit/kernelbytes.test.js enforces that distinction directly: the
// margin between what kernelCodeBytes reserves for a project and what the
// worst real board actually measures must not fall below KERNEL_SLACK.
//
// MOVE_KERNEL_ALLOWANCE stays a single flat constant rather than a per-mapper
// table, and this is measured rather than stylistic: Move's implementation
// costs exactly 395 bytes on every RPG-capable board alike -- UNROM 512,
// MMC1 and MMC3 all go up by exactly 395 with a live Move and nothing else
// turned on, so unlike the base this term has no cross-board difference to
// capture. Folding it into any base would not have tightened the capacity
// check, it would have overflowed the bank and failed nesasm outright -- for
// every project, whether or not it moves anything. So engine/entities.asm's
// move_tick and engine/script.asm's script_op_move sit inside
// `.if MOVE_ENABLED`, the same shape save.asm already had, and only a
// project with a live Move pays. The allowance is exactly 395, not 395 plus
// a margin of its own: KERNEL_SLACK is the *only* deliberate headroom in
// this function, by design, and a second one folded into this term would be
// exactly the "second, looser allowance" KERNEL_SLACK's own comment already
// warns against.
//
// With per-mapper terms, every configuration this file can measure now
// leaves exactly KERNEL_SLACK bytes of margin against its own real worst
// case -- not a coincidence, but the point of measuring per board instead of
// charging every board the same worst case: MMC3 with Save and Move (its own
// base 6670, + SPLIT_LOCK_KERNEL_ALLOWANCE 19, + SAVE_KERNEL_ALLOWANCE 552,
// + MOVE_KERNEL_ALLOWANCE 395, + KERNEL_SLACK 20 = 7656) reserves 20 bytes
// over a real measured 7636; MMC1 with the same two features (its own base
// 6483, + 547 + 395 + 20 = 7445) reserves 20 over a real measured 7425.
// checkCapacity no longer refuses sample-rpg with a Save command *and* a
// Move command on MMC3: the per-mapper base recovered 8 of the 12 bytes that
// combination used to be short by (MMC3's true base is 8 less than the
// UNROM 512 figure it used to be charged), and a second, unrelated fix --
// entity_contact (engine/combat.asm) no longer reads player_iframes before
// starting an RPG's contact battle, which happens to remove 2 instructions
// (5 bytes) from the RPG build on every board -- closed the remaining 4 and
// then some. nesasm now assembles this exact combination into the kernel-lo
// bank with 21 bytes to spare (8171 of 8192, lookup tables included), which
// is a real fit, not a promise: kernelbytes.test.js builds it and asserts
// that figure directly, because 21 bytes is not a margin to lean on, it is
// what happened to be left once every currently-measured term was paid for,
// and the next byte the kernel-lo bank grows anywhere on this board reopens
// the gap. When a project genuinely does not fit, checkCapacity names the
// specific feature (or combination of active features -- see
// kernelShortfallAdvice's own comment) or board that would close the gap,
// instead of only reporting the shortfall -- and a board is only ever
// offered if it can actually hold everything the project already has
// (tilesets, screens, mirroring), not merely a smaller kernel-byte
// reservation, or the "fix" would have reconcileCartridge (shared/project.js)
// silently truncate something the moment it was applied.
//
// These figures are quoted only to explain how kernelCodeBytes reached its
// shape -- hand-copied snapshots, not the source of truth, and
// SAVE_KERNEL_ALLOWANCE's own history (eight revisions before this one) is
// the reason not to trust them blindly. test/unit/kernelbytes.test.js is the
// source of truth: it re-measures every RPG-capable board, with and without
// a live Save command, from a real build on every run, and fails the moment
// any configuration exceeds what kernelCodeBytes reserves for it, or the
// margin between reservation and reality erodes below KERNEL_SLACK. Trust
// its output over this comment if the two ever disagree, and re-measure by
// running it rather than hand-editing either.
export const BASE_KERNEL_CODE_BYTES_BY_MAPPER = { 30: 6678, 1: 6483, 4: 6670 };
const FALLBACK_BASE_KERNEL_CODE_BYTES = Math.max(...Object.values(BASE_KERNEL_CODE_BYTES_BY_MAPPER));
export function baseKernelCodeBytes(mapper) {
  return BASE_KERNEL_CODE_BYTES_BY_MAPPER[mapper.id] ?? FALLBACK_BASE_KERNEL_CODE_BYTES;
}

// 30 (UNROM 512) is measured the same way as the other two, from a real
// build of sample-rpg with and without a live Save command: 6678 -> 7397,
// +719. Substantially larger than MMC1/MMC3's own allowance because flash
// save is not just a checksum/marker-write difference from battery -- it
// carries its own RAM-resident driver (engine/flash.asm: the JEDEC unlock
// sequence, the erase, the 87-byte program loop, all position-independent)
// plus save_media_fetch/commit's wrapper (the vblank wait, the forced
// blank, the copy-to-RAM, the mapper_shadow save/restore) that battery's
// save_media_fetch/commit reduce to a no-op. UNROM 512's own base (6678,
// the largest of the three) is what leaves room for it: 719 against roughly
// 1514 bytes of headroom before KERNEL_SLACK and the fallback base even
// enter the picture.
export const SAVE_KERNEL_ALLOWANCE_BY_MAPPER = { 1: 547, 4: 552, 30: 719 };
export const MOVE_KERNEL_ALLOWANCE = 395;
export const SPLIT_LOCK_KERNEL_ALLOWANCE = 19;
export const KERNEL_SLACK = 20;

export function kernelCodeBytes(project, mapper) {
  // saveMediaImplemented, not saveCapable: SAVE_KERNEL_ALLOWANCE_BY_MAPPER
  // only has a measured entry for a board whose save/load code actually
  // assembles -- every registered board's medium is implemented today,
  // UNROM 512 (719, engine/flash.asm's driver plus save_media_fetch/
  // commit's own wrapper) included, so this currently agrees with
  // saveCapable everywhere. It stays saveMediaImplemented rather than
  // collapsing to saveCapable for the same reason saveMediaImplemented's
  // own comment gives: a board with no save medium at all must cost
  // nothing here regardless, and a future medium declared before the
  // engine drives it would need to cost nothing here too, exactly the
  // shape this already handles and saveCapable alone would not -- it would
  // index this table with a mapper id that has no entry for it yet.
  const usesSave = projectUsesSave(project) && saveMediaImplemented(mapper);
  const usesMove = projectUsesMove(project);
  const usesSplitLock = fontBankSplit(project, mapper);
  return (
    baseKernelCodeBytes(mapper) +
    (usesSave ? SAVE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id] : 0) +
    (usesMove ? MOVE_KERNEL_ALLOWANCE : 0) +
    (usesSplitLock ? SPLIT_LOCK_KERNEL_ALLOWANCE : 0) +
    KERNEL_SLACK
  );
}

/**
 * A deep clone of `project` with every live occurrence of the given command
 * opcodes -- across every placed entity's event and every common event,
 * including inside a branch's two sides and a question's options, the same
 * reach `allCommands` (shared/eventrules.js) gives every other "does this
 * project use X" question -- switched off. What actually removing every
 * Move or Save command from the project would leave, for kernelCodeBytes to
 * answer every question about, including ones this function does not itself
 * know to ask: fontBankSplit (shared/font.js) reads projectUsesText, which a
 * command's own page can be the project's only source of, so disabling it
 * can turn the split-lock term off too. kernelShortfallAdvice asks
 * kernelCodeBytes rather than re-deriving what it already knows, which is
 * the whole point of calling this first. Never touches `project` itself.
 */
function projectWithoutCommands(project, ops) {
  const clone = structuredClone(project);
  for (const event of projectEvents(clone)) {
    for (const page of event.pages ?? []) {
      for (const command of allCommands(page.commands)) {
        if (ops.includes(command.op)) command.off = true;
      }
    }
  }
  return clone;
}

/**
 * When a project's lookup tables do not fit alongside kernelCodeBytes's own
 * reservation, name what would actually close the gap instead of only
 * reporting the shortfall: dropping one active optional feature (Move,
 * Save), dropping the smallest combination of them that frees enough when no
 * single one does, or targeting another mapper that reserves less kernel
 * code for the same feature set *and* can still hold everything the project
 * already has. Every byte figure here is kernelCodeBytes's own answer on a
 * hypothetical project with that combination's commands turned off
 * (projectWithoutCommands), not a sum of the allowance constants -- summing
 * them would miss a dependent term a removal can also switch off (see
 * projectWithoutCommands's own comment), so this asks kernelCodeBytes
 * directly instead of re-deriving what it already knows. A suggestion is
 * only made when the byte count or board it names is actually large enough
 * / capable enough to cover `deficit` on its own, so this never recommends
 * something that would leave the project still short -- or, for a mapper,
 * something that would silently truncate a tileset, a screen or the
 * mirroring choice the moment the author applied it. Reads the project only;
 * never mutates it.
 */
function kernelShortfallAdvice(project, mapper, deficit) {
  // saveMediaImplemented for the same reason kernelCodeBytes itself reads it:
  // "active" below feeds freedByDropping, which calls kernelCodeBytes, so
  // this must agree with what that function actually charges.
  const usesSave = projectUsesSave(project) && saveMediaImplemented(mapper);
  const usesMove = projectUsesMove(project);
  // "Every" rather than "the": a project can carry more than one live Move or
  // Save command (several actors, several pages), and removing just one of
  // several does not free anything at all -- kernelCodeBytes only drops the
  // term once *no* live occurrence remains (projectUsesSave/projectUsesMove).
  const active = [];
  if (usesMove) active.push({ op: 'move', label: 'every Move command' });
  if (usesSave) active.push({ op: 'save', label: 'every Save command' });

  const budget = kernelCodeBytes(project, mapper);
  const freedByDropping = (ops) => budget - kernelCodeBytes(projectWithoutCommands(project, ops), mapper);

  // Any one active feature that alone frees enough bytes is offered as its
  // own choice -- dropping one thing is simpler than dropping several, and
  // when more than one alone would do it the author gets to pick which.
  const solo = active
    .map((feature) => ({ feature, freed: freedByDropping([feature.op]) }))
    .filter((entry) => entry.freed >= deficit);
  if (solo.length) {
    return `Try removing ${solo.map((entry) => `${entry.feature.label} (frees ${entry.freed} bytes)`).join(' or ')}.`;
  }

  // No single active feature covers the gap alone -- a project short by more
  // than either one frees individually can still be short by less than what
  // dropping both frees together, so look for the smallest combination that
  // does (smallest count first, so this never asks an author to drop more
  // than it has to; every subset rather than just "all of them", because a
  // future third optional feature could make a two-of-three combination the
  // tightest fit without either a single feature or all three together
  // being it). Each combination's freed count comes from one
  // projectWithoutCommands call with every op in it turned off together, not
  // from adding up separately-measured single drops, so a dependent term two
  // features would each have to give up on their own is not double-counted
  // or missed.
  let combo = null;
  for (let mask = 1; mask < 1 << active.length; mask++) {
    const chosen = active.filter((_, index) => mask & (1 << index));
    if (chosen.length < 2) continue; // already covered by the solo case above
    const freed = freedByDropping(chosen.map((feature) => feature.op));
    if (freed < deficit) continue;
    if (!combo || chosen.length < combo.chosen.length) combo = { chosen, freed };
  }
  if (combo) {
    return `Try removing ${combo.chosen.map((feature) => feature.label).join(' and ')} together (frees ${combo.freed} bytes).`;
  }

  // No combination of active features closes the gap either -- see whether a
  // mapper this project could still target, with everything it currently has
  // intact, reserves enough less kernel code to fit. "Still target" means
  // more than the RPG/battery gates kernelCodeBytes itself reads: a board
  // that cannot hold every tileset, every screen (packed the same way the
  // generator packs them) or the project's current mirroring choice would
  // have reconcileCartridge silently truncate one of them the moment the
  // author actually switched, which is not a fix, it is quiet data loss.
  const isRpg = project.project?.gameType === 'rpg';
  const wantsSave = projectUsesSave(project);
  const { flat } = flattenScreens(project);
  const bankedCode = codeRegionCount(project);
  const actorCount = project.sprites.actors.length;
  const alternative = SUPPORTED_MAPPERS.filter((candidate) => candidate.id !== mapper.id)
    .filter((candidate) => !isRpg || rpgCapable(candidate))
    // saveMediaImplemented, not saveCapable: recommending UNROM 512 to a
    // project with a live Save command would just trade this shortfall for
    // validateProject's flash-unimplemented refusal -- not a fix.
    .filter((candidate) => !wantsSave || saveMediaImplemented(candidate))
    .filter(
      (candidate) =>
        tilesetLimit(candidate, project.cartridge, fontChrPages(project, candidate)) >= project.tilesets.length
    )
    .filter((candidate) => mirroringOptions(candidate).some((entry) => entry.id === project.cartridge.mirroring))
    .filter(
      (candidate) =>
        screenCapacityFor(
          candidate,
          project.tilesets.length,
          bankedCode,
          flat,
          actorCount,
          reservesFlashSaveRegion(wantsSave, candidate)
        ) >= flat.length
    )
    .filter((candidate) => kernelCodeBytes(project, mapper) - kernelCodeBytes(project, candidate) >= deficit)
    .sort((a, b) => kernelCodeBytes(project, a) - kernelCodeBytes(project, b))[0];
  if (alternative) {
    const saved = kernelCodeBytes(project, mapper) - kernelCodeBytes(project, alternative);
    return `Try ${alternative.name} in the Build panel — it reserves ${saved} fewer bytes for the same features.`;
  }

  return 'Reduce the number of screens, actors or metasprites.';
}
const PLAYER_FRAMES = 8; // 4 directions x 2 walk frames
const PLAYER_TILES = PLAYER_FRAMES * 4;

// Drawn into the CHR output (never into project data) when the sprite table is
// still empty, so a brand-new project builds into something you can actually see.
const PLACEHOLDER_FRAMES = [
  [
    '0000111111110000',
    '0001111111111000',
    '0011122222211100',
    '0011222222221100',
    '0011233223321100',
    '0011222222221100',
    '0011122222211100',
    '0001112222111000',
    '0000133333310000',
    '0001333333333100',
    '0011133333331100',
    '0011133333331100',
    '0011133333331100',
    '0000122222210000',
    '0000110000110000',
    '0001110000111000'
  ],
  [
    '0000111111110000',
    '0001111111111000',
    '0011122222211100',
    '0011222222221100',
    '0011233223321100',
    '0011222222221100',
    '0011122222211100',
    '0001112222111000',
    '0000133333310000',
    '0001333333333100',
    '0011133333331100',
    '0011133333331100',
    '0011133333331100',
    '0000122222210000',
    '0001110000111000',
    '0011100000011100'
  ]
];

const hex = (value) => `$${(value & 0xff).toString(16).padStart(2, '0').toUpperCase()}`;

function dbBlock(values, perLine = 16) {
  const lines = [];
  for (let i = 0; i < values.length; i += perLine) {
    lines.push(`  .db ${values.slice(i, i + perLine).map(hex).join(',')}`);
  }
  return lines.join('\n');
}

/** Split a 16x16 pixel grid into four 8x8 tiles in TL, TR, BL, BR order. */
function split16(rows) {
  const tiles = [];
  for (let quadrant = 0; quadrant < 4; quadrant++) {
    const originX = (quadrant % 2) * 8;
    const originY = Math.floor(quadrant / 2) * 8;
    const tile = new Uint8Array(64);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        tile[y * 8 + x] = Number(rows[originY + y][originX + x]);
      }
    }
    tiles.push(tile);
  }
  return tiles;
}

/**
 * One attribute byte covers a 32x32 pixel square = 2x2 metatiles, two bits per
 * metatile. A screen is 15 metatiles tall, so the bottom attribute row only has
 * its upper half on screen; the unused quadrants stay 0.
 */
export function screenAttributes(screen, metatiles) {
  const attributes = new Uint8Array(64);
  const quadrants = [
    [0, 0, 0],
    [1, 0, 2],
    [0, 1, 4],
    [1, 1, 6]
  ];
  for (let ay = 0; ay < 8; ay++) {
    for (let ax = 0; ax < 8; ax++) {
      let byte = 0;
      for (const [dx, dy, shift] of quadrants) {
        const col = ax * 2 + dx;
        const row = ay * 2 + dy;
        if (col >= LIMITS.screenCols || row >= LIMITS.screenRows) continue;
        const id = screen.metatiles[row * LIMITS.screenCols + col];
        byte |= (metatiles[id]?.palette ?? 0) << shift;
      }
      attributes[ay * 8 + ax] = byte;
    }
  }
  return attributes;
}

/** Flatten every map's screens into one list and work out edge neighbours. */
export function flattenScreens(project) {
  const flat = [];
  const mapBase = [];
  for (const map of project.maps) {
    mapBase.push(flat.length);
    map.screens.forEach((screen, index) => {
      flat.push({
        screen,
        map,
        base: mapBase[mapBase.length - 1],
        col: index % map.gridW,
        row: Math.floor(index / map.gridW)
      });
    });
  }

  const neighbours = { left: [], right: [], up: [], down: [] };
  for (const entry of flat) {
    const { map, base, col, row } = entry;
    const at = (c, r) => (c < 0 || r < 0 || c >= map.gridW || r >= map.gridH ? 0xff : base + r * map.gridW + c);
    neighbours.left.push(at(col - 1, row));
    neighbours.right.push(at(col + 1, row));
    neighbours.up.push(at(col, row - 1));
    neighbours.down.push(at(col, row + 1));
  }
  return { flat, mapBase, neighbours };
}

/**
 * The mirroring value for mappers that set it from their own register instead of
 * the iNES header. MMC1 control bits 0-1 use 2 for vertical and 3 for horizontal;
 * MMC3's $A000 bit 0 uses 0 for vertical and 1 for horizontal. `mirroringValue`
 * returns the header bit, where 1 means vertical.
 */
function mapperMirror(mapper, mirroring) {
  const vertical = mirroringValue(mirroring) === 1;
  if (mapper.prgSwitch === PRG_SWITCH.mmc1) return vertical ? 2 : 3;
  if (mapper.prgSwitch === PRG_SWITCH.mmc3) return vertical ? 0 : 1;
  return 0;
}

/**
 * The trigger byte for a placement: which of EVENT_TRIGGERS it carries, as the
 * index the engine's TRIG_* constants are. A trigger the actor's behaviour has
 * no room for falls back to the first, which is what every event did before
 * there were triggers — the same answer normalization gives an unknown one.
 */
function triggerIndex(entity, actor, project) {
  const trigger = effectiveTrigger(entity, actor, project);
  return Math.max(0, EVENT_TRIGGERS.findIndex((entry) => entry.id === trigger));
}

/** Bytes one screen occupies: metatiles, attributes, then its actor list. */
function screenRecordBytes(entry, actorCount) {
  const placed = entry.screen.entities.filter((entity) => entity.actorId < actorCount);
  return SCREEN_BYTES + 1 + ENTITY_RECORD * placed.length;
}

/** A tile table short of 256 entries (a hand-edited project) pads with blanks. */
function padTable(tiles) {
  const out = tiles.slice(0, LIMITS.tilesPerTable);
  while (out.length < LIMITS.tilesPerTable) out.push(BLANK_TILE);
  return out;
}

/**
 * Code Forge checks. Deliberately *not* a byte estimate: how much a source file
 * assembles to cannot be known from its text, and a wrong guess would either
 * refuse a project that fits or promise room the assembler then denies. The
 * assembler is the capacity check for hand-written code, and its overflow error
 * names the file and line, which the Code Forge opens directly.
 */
function checkCode(project) {
  const problems = [];
  const code = project.code ?? { overrides: [], files: [] };
  const stock = new Set(engineFileNames());

  for (const file of code.files) {
    if (stock.has(file.name)) {
      problems.push({
        severity: 'error',
        where: 'Code Forge',
        message:
          `"${file.name}" is the name of a stock engine file, so it would overwrite it. Rename your file, or ` +
          'edit the engine file itself — the Code Forge keeps your changes as a per-project copy.'
      });
    }
  }
  // An override naming a file this version does not ship is skipped rather than
  // refused, so a project saved by a later version still builds here.
  for (const file of code.overrides) {
    if (!stock.has(file.name)) {
      problems.push({
        severity: 'warning',
        where: 'Code Forge',
        message: `"${file.name}" is not a file in this version's engine, so your edited copy is not used.`
      });
    }
  }
  if (code.overrides.length || code.files.length) {
    problems.push({
      severity: 'warning',
      where: 'Code Forge',
      message:
        'This project contains hand-written engine code, which the capacity check above does not measure. ' +
        'The assembler enforces the bank limits; any overflow names the file and line.'
    });
  }
  return problems;
}

/**
 * How many screens `mapper` can hold for this project's tileset count and
 * banked-code claim, packed the same way the generator actually packs them
 * -- the single writer both checkCapacity's own screen-count error and
 * kernelShortfallAdvice's mapper-swap check call, so a board offered as
 * roomier there cannot secretly be one that would truncate a screen here.
 * Packs the real screens exactly as the generator will, then counts how many
 * more entity-free screens would still fit in what is left of each region.
 * Counting per region rather than on a total keeps boundary fragmentation in
 * the number, so the figure quoted to the user is one the assembler will
 * honour.
 *
 * Exported, and taking `reserveFlashSave` as a plain argument, for the same
 * reason assignScreenBanks is: checkCapacity's own `reserveFlashSave` is
 * gated on saveMediaImplemented and so is always false in a real build
 * today, so a test that wants "what would checkCapacity show with the
 * reservation on" has to call the exact function checkCapacity calls, with
 * the flip forced explicitly, rather than go through the gate.
 */
export function screenCapacityFor(mapper, tilesetCount, bankedCode, flat, actorCount, reserveFlashSave = false) {
  const spare = [];
  let packed = 0;
  for (const _region of screenRegions(mapper, tilesetCount, bankedCode, { reserveFlashSave })) {
    let used = 0;
    while (packed < flat.length) {
      const size = screenRecordBytes(flat[packed], actorCount);
      if (used + size > SCREEN_REGION_BYTES) break;
      used += size;
      packed++;
    }
    spare.push(SCREEN_REGION_BYTES - used);
  }
  const emptyScreen = SCREEN_BYTES + 1;
  return packed + spare.reduce((total, free) => total + Math.floor(free / emptyScreen), 0);
}

/**
 * Assigns each flattened screen to a PRG bank, packing regions front-to-back
 * exactly as screenCapacityFor above counts them. Exported and taking
 * `reserveFlashSave` as a plain argument -- like screenRegions/screenCapacity
 * themselves -- so this, the actual code generateAssets runs for the
 * screen-bank emit path, is directly testable with an explicit true, the
 * same way finding 1's region arithmetic is: real production behaviour never
 * reaches reserveFlashSave: true yet (see reservesFlashSaveRegion), so a
 * black-box test of a real build could never exercise this otherwise.
 */
export function assignScreenBanks(mapper, tilesetCount, bankedCode, reserveFlashSave, flat, actorCount) {
  const screenBank = new Array(flat.length).fill(0);
  const regionRanges = [];
  let cursor = 0;
  for (const region of screenRegions(mapper, tilesetCount, bankedCode, { reserveFlashSave })) {
    const from = cursor;
    let used = 0;
    while (cursor < flat.length) {
      const size = screenRecordBytes(flat[cursor], actorCount);
      if (used + size > SCREEN_REGION_BYTES) break;
      used += size;
      screenBank[cursor] = region.prgBank;
      cursor++;
    }
    regionRanges.push({ region, from, to: cursor });
    if (cursor >= flat.length) break;
  }
  if (cursor < flat.length) {
    // checkCapacity() should have caught this; failing loudly beats emitting a
    // ROM whose later screens silently point at the wrong bank.
    throw new Error(`internal: ${flat.length - cursor} screens did not fit into ${mapper.name}'s PRG banks`);
  }
  return { screenBank, regionRanges };
}

/** Capacity checks that must pass before the assembler is worth running. */
export function checkCapacity(project) {
  const text = compileText(project);
  const problems = [...validateProject(project), ...text.problems, ...checkBattleTables(project)];
  const { flat } = flattenScreens(project);

  // maps.inc holds four neighbour tables, four screen pointer tables and the
  // actor-list *pointers*; everything else in bank 0 is fixed size. The input
  // table is one byte per button per game state, so it grows when a state is
  // added — deriving it here rather than writing a constant keeps this honest.
  const fixedBytes =
    32 + 5 * LIMITS.metatiles + PLAYER_TILES + 1 + INPUT_STATES.length * BUTTONS.length;
  const { metasprites, animations, actors } = project.sprites;
  const spriteBytes =
    3 * Math.max(1, metasprites.length) +
    4 * metasprites.reduce((total, entry) => total + entry.tiles.length, 0) +
    3 * Math.max(1, animations.length) +
    2 * animations.reduce((total, entry) => total + entry.frames.length, 0) +
    8 * Math.max(1, actors.length); // behavior, speed, hp, damage, 4 anim slots
  // 13 bytes per screen of lookup tables (4 neighbours, 4 data pointers, 2
  // actor-list pointers, tileset, bank, map) and 9 per map (base, encounter
  // rate, four formation slots, the two battle backdrop tiles, and the song).
  // Not the entity *records* those two pointers address — screen_ent_lo/hi
  // here are only the LOW/HIGH of where each screen's own list lives, and
  // that list (`${screenLabel}_ent`, generate.js's emitScreens) is written
  // into the screen's own region of the *switchable* window alongside its
  // metatiles and attributes, not into this fixed kernel-lo bank at all --
  // screenRecordBytes already charges it against screen capacity there,
  // correctly. An earlier version of this formula also added ENTITY_RECORD
  // bytes per placed entity here, which double-charged every entity against
  // kernel-lo space it was never going to occupy: harmless while kernel-lo had
  // headroom to spare, but it silently ate 37-plus bytes of the real margin
  // save/load and Move already need on MMC3, and would have refused a real
  // ROM (sample-rpg with a Save command and a Move command, on MMC3) that
  // nesasm assembles into the bank with room left over. Caught by comparing
  // this formula's own claim against nesasm's real kernel-lo usage rather
  // than trusting either checkCapacity or kernelCodeBytes alone.
  const tableBytes = 13 * flat.length + 9 * project.maps.length + spriteBytes;

  const mapper = resolveMapper(project.cartridge.mapper);
  const kernelBudget = kernelCodeBytes(project, mapper);
  const kernelFree = BANK_SIZE - kernelBudget - fixedBytes - tableBytes;

  const layout = prgLayout(mapper);
  const bankedCode = codeRegionCount(project);
  // A live Save command on a flash-capable board gives up its last screen
  // region for the flash sector (see screenRegions' own comment) -- gated on
  // a live Save, not merely on the board, so a project with no Save at all
  // never pays for it, and gated by reservesFlashSaveRegion itself on
  // saveMediaImplemented, so the region is not actually removed from a
  // project the engine cannot save on yet -- that combination is already
  // refused by validateProject, and removing the region too would only stack
  // a misleading "reduce screens" capacity error on top of the real one.
  // Returned below rather than left a local: generateAssets calls
  // checkCapacity first and reuses this exact value for the screen-bank
  // emit path, so there is one computation, not two that could drift.
  const reserveFlashSave = reservesFlashSaveRegion(projectUsesSave(project), mapper);

  // On a scanline-IRQ board the font rides in its own CHR page, which is one
  // page the tilesets cannot have. The schema already enforces this ceiling on
  // load; checking again here keeps a hand-edited project honest.
  const fontPages = fontChrPages(project, mapper);
  const tilesetCeiling = tilesetLimit(mapper, project.cartridge, fontPages);
  if (project.tilesets.length > tilesetCeiling) {
    problems.push({
      severity: 'error',
      where: 'Tile Forge',
      message:
        `This project has ${project.tilesets.length} tilesets but ${mapper.name} holds ${tilesetCeiling}` +
        (fontPages ? ' alongside the message font’s own graphics page. ' : '. ') +
        'Remove a tileset.'
    });
  }

  // Screens are packed into 8 KB regions of the switchable window, two per 16 KB
  // bank. Capacity is computed by the same packing the generator performs, so the
  // number quoted here is the number that will actually fit.
  const actorCount = project.sprites.actors.length;
  const capacity = screenCapacityFor(mapper, project.tilesets.length, bankedCode, flat, actorCount, reserveFlashSave);

  const musicBytes = musicSize(project.songs);

  if (flat.length > capacity) {
    problems.push({
      severity: 'error',
      where: 'Map Forge',
      message:
        `This project has ${flat.length} screens but ${mapper.name} holds ${capacity}. ` +
        (layout.dataBankCount === 1
          ? 'Choose a mapper with program bank switching in the Build panel, remove a screen, or shrink a map grid.'
          : 'Remove a screen or shrink a map grid.')
    });
  }
  if (kernelFree < 0) {
    problems.push({
      severity: 'error',
      where: 'Map Forge',
      message:
        `The lookup tables need ${tableBytes} bytes but only ${BANK_SIZE - kernelBudget - fixedBytes} are ` +
        `free alongside the engine code. ${kernelShortfallAdvice(project, mapper, -kernelFree)}`
    });
  }
  problems.push(...checkCode(project));
  // Music and text share the $E000 half of the fixed kernel, above the vectors.
  if (musicBytes + text.bytes > BANK_SIZE - 64) {
    problems.push({
      severity: 'error',
      where: musicBytes > text.bytes ? 'Sound Forge' : 'Map Forge',
      message:
        `The songs compile to ${musicBytes} bytes and the dialogue to ${text.bytes}, which together do not fit ` +
        `the ${BANK_SIZE}-byte music and text bank. Shorten a song, or cut some dialogue.`
    });
  }
  return {
    problems,
    capacity,
    reserveFlashSave,
    screenCount: flat.length,
    musicBytes,
    textBytes: text.bytes,
    dataBankCount: layout.dataBankCount
  };
}

export async function generateAssets({ dir, project, log = () => {} }) {
  const { problems, capacity, reserveFlashSave, screenCount } = checkCapacity(project);
  const errors = problems.filter((problem) => problem.severity === 'error');
  if (errors.length) {
    const error = new Error(errors.map((problem) => `${problem.where}: ${problem.message}`).join('\n'));
    error.problems = problems;
    throw error;
  }

  const buildDir = path.join(dir, 'build');
  const assetsDir = path.join(buildDir, 'assets');
  await fs.rm(buildDir, { recursive: true, force: true });
  await fs.mkdir(assetsDir, { recursive: true });

  // --- cartridge header ----------------------------------------------------
  // The iNES header is generated rather than written in engine/main.asm so the
  // mapper has exactly one definition, shared with the UI via shared/cartridge.js.
  const mapper = resolveMapper(project.cartridge.mapper);
  const layout = prgLayout(mapper);
  // On a scanline-IRQ board (MMC3) the font gets a CHR page of its own instead
  // of being stamped into every tileset — the split machinery in
  // engine/split.asm switches it in where the text windows start.
  const fontSplit = fontBankSplit(project, mapper);
  const chrBanks = chrBanksFor(mapper, project.tilesets.length + fontChrPages(project, mapper));
  const chrRegister = chrRegisterTable(mapper);
  // A mapper with switchable CHR but no register table has its own routine
  // (MMC1's serial port, MMC3's register pair, UNROM 512's shared register).
  const chrSwitchNone = !mapper.switchableChr;
  const needsMapperInit =
    mapper.prgSwitch === PRG_SWITCH.mmc1 ||
    mapper.prgSwitch === PRG_SWITCH.mmc3 ||
    mapper.prgSwitch === PRG_SWITCH.unrom512;
  await fs.writeFile(
    path.join(assetsDir, 'cartridge.inc'),
    [
      '; Generated by NES Game Forge -- do not edit.',
      `; ${mapper.name}: ${mapper.summary}`,
      `  .inesprg ${mapper.prgUnits}`,
      `  .ineschr ${chrBanks}`,
      `  .inesmap ${mapper.id}`,
      `  .inesmir ${mirroringValue(project.cartridge.mirroring)}`,
      ''
    ].join('\n')
  );

  // --- CHR -----------------------------------------------------------------
  // One 8 KB file per CHR bank: nesasm's banks are 8 KB, so a single .incbin
  // spanning several of them would overflow the bank it starts in.
  const tilesets = project.tilesets.map((tileset) => ({
    background: padTable(tileset.background.tiles),
    sprites: padTable(tileset.sprites.tiles)
  }));

  // The font is stamped into these build-time copies, never into project data:
  // it is the engine's art, so it must not turn up in the Tile Forge as
  // something the user drew and can paint over. validateProject has already
  // refused any artwork inside the range, and the Tile Forge marks it reserved,
  // both from the same predicate. On a scanline-IRQ board the font ships in its
  // own CHR page instead (appended below), so the tilesets stay untouched and
  // the project keeps all 256 background tiles.
  const usesText = projectUsesText(project);
  if (usesText && !fontSplit) {
    for (const tileset of tilesets) {
      FONT_TILES.forEach((tile, index) => {
        tileset.background[FONT_BASE + index] = tile;
      });
    }
  }

  const spriteTableEmpty = tilesets[0].sprites
    .slice(0, PLAYER_TILES)
    .every((tile) => tile === BLANK_TILE);
  if (spriteTableEmpty) {
    const frames = PLACEHOLDER_FRAMES.map(split16);
    for (let frame = 0; frame < PLAYER_FRAMES; frame++) {
      const source = frames[frame % 2];
      for (let quadrant = 0; quadrant < 4; quadrant++) {
        tilesets[0].sprites[frame * 4 + quadrant] = Array.from(source[quadrant]).join('');
      }
    }
    log('note: the sprite table is empty, so a placeholder player was drawn into the ROM.');
  }

  // This project's actual actor roster size -- computed once here and reused
  // by every site in this function that needs it (NUM_ACTORS below, the
  // screen-bank packing, the encounter table, the placed-entity filter), so
  // it cannot drift into disagreeing with itself the way three independent
  // `project.sprites.actors.length` expressions eventually would.
  const actorCount = project.sprites.actors.length;

  // The HUD hearts, stamped after the placeholder check so an empty sprite table
  // is still recognised as empty. Two tiles, and only for a game that can hurt
  // the player *and draws them* -- draw_hud (engine/combat.asm) is gated
  // `.if !BATTLE_ENABLED`, so an RPG never assembles it and must not keep the
  // tiles reserved either; projectUsesHeartArt (shared/font.js) is that
  // narrower predicate, and validateProject's own collision check asks it too.
  const usesCombat = projectUsesCombat(project);
  const usesHeartArt = projectUsesHeartArt(project);
  const usesSave = projectUsesSave(project);
  const usesMove = projectUsesMove(project);
  const saveIdentityValue = saveIdentity(project);
  if (usesHeartArt) {
    for (const tileset of tilesets) {
      for (const [index, tile] of Object.entries(HEART_TILES)) tileset.sprites[Number(index)] = tile;
    }
  }

  // The battle targeting cursor. On a split-font board the background arrow
  // glyph lives in the font's own bank, which is only switched in below the
  // text windows — and this cursor points at monsters above them, so those
  // builds draw it as a sprite instead. Same conditional-reservation rule as
  // the hearts, one tile lower.
  if (fontSplit && codeRegionCount(project)) {
    for (const tileset of tilesets) tileset.sprites[SPRITE_ARROW_TILE] = SPRITE_ARROW_ART;
  }

  // Each tileset becomes one 8 KB payload: background table then sprite table,
  // which is the layout of a pattern-table pair either way. On a CHR-ROM board it
  // is incbin'd into a CHR bank; on a CHR-RAM board it goes into program space and
  // the engine streams it into the pattern tables at boot.
  const chrPayloads = tilesets.map((source) => {
    const chr = new Uint8Array(CHR_BANK_BYTES);
    chr.set(encodeTiles(padTable(source.background)), 0);
    chr.set(encodeTiles(padTable(source.sprites)), CHR_BANK_BYTES / 2);
    return chr;
  });

  // The font page, appended after the tilesets. Glyphs sit at the same $A0-$FF
  // indices they occupy in a stamped tileset, so the engine's text drawing is
  // identical either way — only which CHR bank is live under the text differs.
  // switch_chr_bank range-checks against NUM_TILESETS, so no map can select it.
  if (fontSplit) {
    const fontBackground = padTable([]);
    FONT_TILES.forEach((tile, index) => {
      fontBackground[FONT_BASE + index] = tile;
    });
    const chr = new Uint8Array(CHR_BANK_BYTES);
    chr.set(encodeTiles(fontBackground), 0);
    chrPayloads.push(chr);
  }

  const chrIncludes = ['; Generated by NES Game Forge -- do not edit.'];
  for (let bank = 0; bank < chrBanks; bank++) {
    // Unused banks are still emitted: the header has declared them, so the file
    // must contain them or the ROM size will not match.
    const chr = chrPayloads[bank] ?? new Uint8Array(CHR_BANK_BYTES);
    await fs.writeFile(path.join(assetsDir, `tiles${bank}.chr`), chr);
    chrIncludes.push(`  .bank ${mapper.prgUnits * 2 + bank}`, '  .org $0000', `  .incbin "assets/tiles${bank}.chr"`);
  }
  chrIncludes.push('');
  await fs.writeFile(path.join(assetsDir, 'chr.inc'), chrIncludes.join('\n'));

  // --- CHR-RAM payloads in program space -----------------------------------
  // One 8 KB region per tileset, taken off the front of the switchable window.
  const chrRegions = chrPayloadRegions(mapper, tilesets.length);
  const chrRamChunks = ['; Generated -- tileset payloads streamed into CHR-RAM at boot.'];
  for (const [index, region] of chrRegions.entries()) {
    await fs.writeFile(path.join(assetsDir, `chrram${index}.bin`), chrPayloads[index] ?? new Uint8Array(CHR_BANK_BYTES));
    chrRamChunks.push(
      `  .bank ${region.nesasmBank}`,
      `  .org $${region.org.toString(16).toUpperCase()}`,
      `tileset_src_${index}:`,
      `  .incbin "assets/chrram${index}.bin"`
    );
  }
  chrRamChunks.push('');
  await fs.writeFile(path.join(assetsDir, 'chrram.inc'), chrRamChunks.join('\n'));

  // Where each payload lives. These tables are read while banks are being switched,
  // so unlike the payloads they must sit in the fixed kernel.
  await fs.writeFile(
    path.join(assetsDir, 'chrtables.inc'),
    chrRegions.length
      ? [
          '; Generated -- which PRG bank and address holds each tileset payload.',
          `tileset_bank:\n${dbBlock(chrRegions.map((region) => region.prgBank))}`,
          `tileset_lo:\n${pointerBlock(chrRegions, (i) => `LOW(tileset_src_${i})`)}`,
          `tileset_hi:\n${pointerBlock(chrRegions, (i) => `HIGH(tileset_src_${i})`)}`,
          ''
        ].join('\n')
      : `; Generated -- ${mapper.name} has CHR-ROM, so there is nothing to stream.\n`
  );

  // The bank-select values, one per tileset slot. banks.asm writes an entry back
  // over itself: that both selects the bank and matches what the ROM is already
  // driving onto the bus, which is how a discrete mapper avoids a bus conflict.
  await fs.writeFile(
    path.join(assetsDir, 'banktable.inc'),
    chrRegister.length
      ? `; Generated -- ${mapper.name} CHR select values.\nchr_bank_values:\n${dbBlock(chrRegister)}\n`
      : `; Generated -- ${mapper.name} has no CHR bank register.\n`
  );

  // --- banked engine code --------------------------------------------------
  // One region off the front of the switchable window, after the CHR-RAM
  // payloads, holding engine/battle.asm. The kernel keeps only the trampoline in
  // banks.asm, which is what makes the battle system affordable at all.
  const bankedCode = codeRegionCount(project);
  const codeSlots = codeRegions(mapper, tilesets.length, bankedCode);
  await fs.writeFile(
    path.join(assetsDir, 'battle.inc'),
    codeSlots.length ? battleTables(project) : '; Generated -- not an RPG, so there is no battle system.\n'
  );
  await fs.writeFile(
    path.join(assetsDir, 'code.inc'),
    codeSlots.length
      ? [
          '; Generated -- the switchable bank holding engine/battle.asm.',
          `  .bank ${codeSlots[0].nesasmBank}`,
          `  .org $${codeSlots[0].org.toString(16).toUpperCase()}`,
          '  .include "assets/battle.inc"',
          '  .include "battle.asm"',
          ''
        ].join('\n')
      : '; Generated -- this project reserves no banked code region.\n'
  );

  // --- config --------------------------------------------------------------
  const { flat, mapBase, neighbours } = flattenScreens(project);
  const startFlat = (mapBase[project.project.startMap] ?? 0) + project.project.startScreen;

  // The title screen, if the project names one: a map screen of its own with two
  // lines written over it. Both are centred here rather than in the engine,
  // because the compiler is the only side that knows how long they are.
  const text = compileText(project);
  const titleMap = project.project.titleMap;
  const titleEnabled = titleMap !== null && titleMap !== undefined && mapBase[titleMap] !== undefined;
  const titleFlat = titleEnabled
    ? Math.min((mapBase[titleMap] ?? 0) + (project.project.titleScreen ?? 0), flat.length - 1)
    : 0;
  const centred = (row, line) => 0x2000 + row * 32 + ((32 - Math.min(32, line.length)) >> 1);
  const nameAddr = centred(TITLE_NAME_ROW, text.system.sys_title);
  const promptAddr = centred(TITLE_PROMPT_ROW, text.system.sys_press_start);
  // Its own centring: a different string, a different length, a different
  // address to start it at so it still lands in the middle of the row.
  const promptContinueAddr = centred(TITLE_PROMPT_ROW, text.system.sys_press_start_continue);
  // One attribute byte covers four tile rows, so each line of the title sits in
  // exactly one attribute row and the engine blanks that row to make it legible.
  const attrRow = (row) => 0x23c0 + (row >> 2) * 8;
  const config = [
    '; Generated by NES Game Forge -- do not edit.',
    `NUM_SCREENS   = ${flat.length}`,
    `NUM_MAPS      = ${project.maps.length}`,
    `START_SCREEN  = ${Math.min(startFlat, flat.length - 1)}`,
    `START_X       = ${project.project.startX}`,
    `START_Y       = ${project.project.startY}`,
    'PLAYER_SPEED  = 2',
    // Which song boots up is no longer a separate fact: engine/boot.asm calls
    // apply_map_music once flat_screen is final (the title's, if there is
    // one), the same routine redraw_screen calls on every arrival, so it
    // reads map_song off whichever screen is about to be drawn instead of a
    // constant baked in here for the start map alone.
    // How many named counters an event can use. constants.asm allocates the
    // block; RPG_LIMITS.variables is what says how big it is, here and in the
    // clamp that keeps a variable index inside it.
    `NUM_VARIABLES = ${RPG_LIMITS.variables}`,
    `NUM_TILESETS  = ${project.tilesets.length}`,
    // This build's own actor roster size -- save_check_valid range-checks a
    // restored inv_items entry against this before draw_actor_icon (engine/ui.asm)
    // is allowed to index actor_anim_dir with it. See shared/save.js's saveIdentity
    // for why the count is also folded into the save identity, not only checked here.
    `NUM_ACTORS    = ${actorCount}`,
    // banks.asm has one routine for every discrete single-write mapper; which one
    // is in use shows up only as the register values in chr_bank_values below.
    `NUM_PRG_BANKS  = ${layout.dataBankCount}`,
    // banks.asm selects its routines from these. One flag per family rather than a
    // comparison on MAPPER_ID, so adding a family is additive.
    `CHR_SWITCH_TABLE = ${chrRegister.length ? 1 : 0}`,
    `CHR_SWITCH_MMC1  = ${mapper.prgSwitch === PRG_SWITCH.mmc1 && mapper.switchableChr ? 1 : 0}`,
    `CHR_SWITCH_MMC3  = ${mapper.prgSwitch === PRG_SWITCH.mmc3 && mapper.switchableChr ? 1 : 0}`,
    `CHR_SWITCH_UNROM512 = ${mapper.prgSwitch === PRG_SWITCH.unrom512 ? 1 : 0}`,
    `CHR_SWITCH_NONE  = ${chrSwitchNone ? 1 : 0}`,
    `PRG_SWITCH_NONE   = ${mapper.prgSwitch === PRG_SWITCH.none ? 1 : 0}`,
    `PRG_SWITCH_SIMPLE = ${mapper.prgSwitch === PRG_SWITCH.simple ? 1 : 0}`,
    `PRG_SWITCH_MMC1   = ${mapper.prgSwitch === PRG_SWITCH.mmc1 ? 1 : 0}`,
    `PRG_SWITCH_MMC3   = ${mapper.prgSwitch === PRG_SWITCH.mmc3 ? 1 : 0}`,
    `PRG_SWITCH_UNROM512 = ${mapper.prgSwitch === PRG_SWITCH.unrom512 ? 1 : 0}`,
    `CHR_RAM = ${mapper.chrRam ? 1 : 0}`,
    `MAPPER_INIT_NONE  = ${needsMapperInit ? 0 : 1}`,
    // MMC1 and MMC3 ignore the header's mirroring bit and take it from their own
    // registers, in their own encodings.
    `MAPPER_MIRROR = ${mapperMirror(mapper, project.cartridge.mirroring)}`,
    // The message font: which background tiles carry the window furniture, and
    // how wide the box is. shared/font.js is the single writer for all of it,
    // so engine/text.asm never spells a glyph index out.
    `TEXT_ENABLED  = ${usesText ? 1 : 0}`,
    `BOX_COLS      = ${BOX_COLS}`,
    `TILE_SPACE    = ${hex(TILE_SPACE)}`,
    `BORDER_H      = ${hex(BORDER_H)}`,
    `BORDER_V      = ${hex(BORDER_V)}`,
    `BORDER_CORNER = ${hex(BORDER_CORNER)}`,
    `ARROW_TILE    = ${hex(ARROW_TILE)}`,
    `TILE_ZERO     = ${hex(charToTile('0'))}`,
    // The scanline split: on a board with a scanline IRQ the font is not in the
    // tilesets at all — engine/split.asm switches MMC3's R1 register (background
    // tiles $80-$FF) to the font's own CHR page where the text windows start.
    // FONT_R1 is that page's $0800-$0FFF half in MMC3's 1 KB bank units.
    `SPLIT_ENABLED = ${fontSplit ? 1 : 0}`,
    `FONT_R1       = ${fontSplit ? project.tilesets.length * 8 + 2 : 0}`,
    `SPRITE_ARROW_TILE = ${hex(SPRITE_ARROW_TILE)}`,
    // Action-mode combat. Zero when no actor deals damage and no Damage metatile
    // is painted, in which case the hearts are not drawn and nothing can call in.
    `COMBAT_ENABLED = ${usesCombat ? 1 : 0}`,
    `MAX_HEARTS    = ${project.project.maxHearts ?? 3}`,
    `HEART_FULL_TILE  = ${hex(HEART_FULL_TILE)}`,
    `HEART_EMPTY_TILE = ${hex(HEART_EMPTY_TILE)}`,
    `TITLE_ENABLED = ${titleEnabled ? 1 : 0}`,
    `TITLE_FLAT_SCREEN = ${titleFlat}`,
    `TITLE_NAME_ADDR   = $${nameAddr.toString(16).toUpperCase()}`,
    `TITLE_PROMPT_ADDR = $${promptAddr.toString(16).toUpperCase()}`,
    `TITLE_PROMPT_CONTINUE_ADDR = $${promptContinueAddr.toString(16).toUpperCase()}`,
    `TITLE_NAME_ATTR   = $${attrRow(TITLE_NAME_ROW).toString(16).toUpperCase()}`,
    `TITLE_PROMPT_ATTR = $${attrRow(TITLE_PROMPT_ROW).toString(16).toUpperCase()}`,
    // The rows themselves, for the split programs in engine/split.asm.
    `TITLE_NAME_ROW    = ${TITLE_NAME_ROW}`,
    `TITLE_PROMPT_ROW  = ${TITLE_PROMPT_ROW}`,
    // The banked code region, and the PRG bank the trampoline switches in.
    `BATTLE_ENABLED = ${codeSlots.length ? 1 : 0}`,
    `BATTLE_BANK    = ${codeSlots.length ? codeSlots[0].prgBank : 0}`,
    // The CHR bank a battle switches to, which is where the monster artwork
    // lives. Clamped to what survived the mapper's tileset limit.
    `BATTLE_TILESET = ${Math.min(project.rpg?.battleTilesetId ?? 0, Math.max(0, project.tilesets.length - 1))}`,
    // Save. Pays nothing when the project has no live Save command, the
    // same rule COMBAT_ENABLED and TITLE_ENABLED already hold their own
    // projects to — see engine/save.asm for what this gates, and
    // shared/save.js for the identity's derivation (assets/save.inc holds
    // the record's own field layout, generated from the same list). Four
    // bytes, little-endian byte 0 first -- see saveIdentity's own comment
    // for why 16 bits, then a second widening, stopped being enough, and for
    // what this identity can and cannot guarantee on its own.
    `SAVE_ENABLED = ${usesSave ? 1 : 0}`,
    // Which medium SAVE_ENABLED means, for engine/save.asm's own
    // save_media_fetch/save_media_commit to dispatch on -- a no-op pair on
    // battery, the RAM-resident driver (engine/flash.asm) on flash. Always
    // emitted, the same reasoning SAVE_ENABLED itself already documents:
    // never referenced when it does not apply, so it costs nothing to name
    // regardless of medium.
    `SAVE_FLASH = ${usesSave && flashSaveCapable(mapper) ? 1 : 0}`,
    // Bank 30's own $B000-$BFFF (shared/cartridge.js's flashSaveSectorBank,
    // the same function main/build/pipeline.js's post-build all-$FF check
    // reads) -- meaningless off a flash board, but harmless to name; nothing
    // outside .if SAVE_FLASH ever reads it.
    `SAVE_BANK = ${flashSaveCapable(mapper) ? flashSaveSectorBank(mapper) : 0}`,
    // The whole record's length, body plus checksum plus identity plus
    // marker -- SAVE_BODY_LEN below only covers the body, and lives inside
    // assets/save.inc's own .if SAVE_ENABLED block, so engine/constants.asm's
    // unconditional RAM reservation for the flash buffer (needed regardless
    // of SAVE_ENABLED so test/unit/rammap.test.js can always audit it) has
    // nothing else to size itself against. engine/flash.asm's own copy loop
    // uses this too, rather than re-deriving SAVE_BODY_LEN+7 by hand.
    `SAVE_RECORD_LEN = ${saveBodySize() + 7}`,
    `SAVE_IDENTITY_0 = ${saveIdentityValue & 0xff}`,
    `SAVE_IDENTITY_1 = ${(saveIdentityValue >> 8) & 0xff}`,
    `SAVE_IDENTITY_2 = ${(saveIdentityValue >> 16) & 0xff}`,
    `SAVE_IDENTITY_3 = ${(saveIdentityValue >> 24) & 0xff}`,
    // Whether OP_MOVE's implementation is assembled at all. The most expensive
    // command in the engine against a kernel bank with nothing spare -- see
    // projectUsesMove (shared/project.js) for the measured numbers and why this
    // could not simply be added to every ROM the way Heal and Damage were.
    `MOVE_ENABLED = ${usesMove ? 1 : 0}`,
    ''
  ].join('\n');
  await fs.writeFile(path.join(assetsDir, 'config.inc'), config);

  // --- save record layout ---------------------------------------------------
  // One address equate per field, laid out back-to-back from SAVE_BASE in the
  // order shared/save.js's SAVE_FIELDS lists them in — the single writer for
  // this layout, so engine/save.asm never spells an offset by hand. Emitted
  // even when the project has no Save command: the labels cost nothing
  // unreferenced, and it keeps this file's shape independent of SAVE_ENABLED,
  // the same reason every system string compiles unconditionally.
  //
  // Media-dependent: $6000 is battery-backed WRAM, always mapped once
  // mapper_init enables it, so the record lives there directly. $0700 is
  // ordinary RAM -- the flash medium's own record never lives in RAM
  // permanently; save_media_fetch/save_media_commit (engine/save.asm) copy
  // it to and from the flash sector, so SAVE_BASE here just names the
  // buffer they use, not where the record persists. Every routine that
  // reads or writes SAVE_BASE only ever does so through `SAVE_BASE,y` or
  // LOW/HIGH(SAVE_BASE) (engine/save.asm's own header comment lists all six
  // sites), so this is genuinely the only place the address itself matters.
  const SAVE_BASE = flashSaveCapable(mapper) ? 0x0700 : 0x6000;
  let saveOffset = SAVE_BASE;
  const saveFieldLines = SAVE_FIELDS.map((field) => {
    const line = `SAVE_${field.ram.toUpperCase()} = $${saveOffset.toString(16).toUpperCase()}`;
    saveOffset += field.size;
    return line;
  });
  const saveBodyLen = saveBodySize();
  // Three parallel tables, one entry per SAVE_FIELDS field, in the same order
  // — the table-driven form of the same layout the equates above spell out.
  // engine/save.asm's one generic copy routine walks these in both
  // directions (RAM<->SAVE_BASE, media-dependent -- battery RAM or a flash
  // driver's RAM buffer) rather than eighteen hand-written loops that
  // could silently drift out of agreement with each other about what the
  // record contains; LOW()/HIGH() resolve against the real engine symbol
  // (constants.asm), the same way every other pointer table here does.
  const chunkedDb = (values, perLine = 12) => {
    const lines = [];
    for (let i = 0; i < values.length; i += perLine) {
      lines.push(`  .db ${values.slice(i, i + perLine).join(',')}`);
    }
    return lines.join('\n');
  };
  const saveInc = [
    '; Generated -- the save record\'s layout at SAVE_BASE, media-dependent',
    '; (battery RAM or a flash driver\'s RAM buffer; see engine/save.asm\'s own',
    '; header). shared/save.js is the single writer; engine/save.asm addresses',
    '; every field by these equates and the descriptor tables below.',
    `SAVE_BASE = $${SAVE_BASE.toString(16).toUpperCase()}`,
    ...saveFieldLines,
    `SAVE_BODY_LEN = ${saveBodyLen}`,
    // The body, then a two-byte checksum over it, then the four-byte project
    // identity, then the one-byte marker last of all -- see engine/save.asm's
    // write order (and why it invalidates the marker again, first, before
    // any of this, on every save after the first).
    `SAVE_CHECKSUM_LO = $${(SAVE_BASE + saveBodyLen).toString(16).toUpperCase()}`,
    `SAVE_CHECKSUM_HI = $${(SAVE_BASE + saveBodyLen + 1).toString(16).toUpperCase()}`,
    `SAVE_IDENTITY_0_ADDR = $${(SAVE_BASE + saveBodyLen + 2).toString(16).toUpperCase()}`,
    `SAVE_IDENTITY_1_ADDR = $${(SAVE_BASE + saveBodyLen + 3).toString(16).toUpperCase()}`,
    `SAVE_IDENTITY_2_ADDR = $${(SAVE_BASE + saveBodyLen + 4).toString(16).toUpperCase()}`,
    `SAVE_IDENTITY_3_ADDR = $${(SAVE_BASE + saveBodyLen + 5).toString(16).toUpperCase()}`,
    `SAVE_MARKER = $${(SAVE_BASE + saveBodyLen + 6).toString(16).toUpperCase()}`,
    `SAVE_FIELD_COUNT = ${SAVE_FIELDS.length}`,
    'save_field_lo:',
    chunkedDb(SAVE_FIELDS.map((field) => `LOW(${field.ram})`)),
    'save_field_hi:',
    chunkedDb(SAVE_FIELDS.map((field) => `HIGH(${field.ram})`)),
    'save_field_len:',
    chunkedDb(SAVE_FIELDS.map((field) => field.size)),
    ''
  ].join('\n');
  await fs.writeFile(path.join(assetsDir, 'save.inc'), saveInc);

  // --- palettes ------------------------------------------------------------
  const paletteBytes = [
    ...project.palettes.bg.flat().map((value) => value & 0x3f),
    ...project.palettes.sprite.flat().map((value) => value & 0x3f)
  ];
  await fs.writeFile(
    path.join(assetsDir, 'palettes.inc'),
    `; Generated -- 16 background bytes then 16 sprite bytes.\npalette_data:\n${dbBlock(paletteBytes, 4)}\n`
  );

  // --- metatiles -----------------------------------------------------------
  const column = (pick) => project.metatiles.map(pick);
  await fs.writeFile(
    path.join(assetsDir, 'metatiles.inc'),
    [
      '; Generated -- one entry per metatile id.',
      `mt_tl:\n${dbBlock(column((m) => m.tiles[0]))}`,
      `mt_tr:\n${dbBlock(column((m) => m.tiles[1]))}`,
      `mt_bl:\n${dbBlock(column((m) => m.tiles[2]))}`,
      `mt_br:\n${dbBlock(column((m) => m.tiles[3]))}`,
      `mt_collision:\n${dbBlock(column((m) => collisionIndex(m.collision)))}`,
      ''
    ].join('\n')
  );

  // --- sprites, animations and actors --------------------------------------
  const playerTiles = Array.from({ length: PLAYER_TILES }, (_, index) => index);
  const playerActor = project.sprites.actors.find((actor) => actor.behavior === 'player');
  await fs.writeFile(path.join(assetsDir, 'sprites.inc'), spriteTables(project, playerTiles));

  // --- music ---------------------------------------------------------------
  await fs.writeFile(path.join(assetsDir, 'music.inc'), songTables(project.songs ?? []));

  // --- dialogue and events -------------------------------------------------
  await fs.writeFile(path.join(assetsDir, 'text.inc'), textTables(text));

  // --- controller mapping --------------------------------------------------
  const actionRows = INPUT_STATES.map((state) => {
    const bindings = project.input.states[state] ?? {};
    return BUTTONS.map((button) => actionIndex(bindings[button]));
  });
  await fs.writeFile(
    path.join(assetsDir, 'input.inc'),
    [
      '; Generated -- one action per button, for each game state.',
      `; States: ${INPUT_STATES.join(', ')}. Buttons: ${BUTTONS.join(', ')}.`,
      `input_actions:\n${actionRows.map((row) => `  .db ${row.map(hex).join(',')}`).join('\n')}`,
      ''
    ].join('\n')
  );

  // --- screen bank assignment ----------------------------------------------
  // Decided before maps.inc is written, because the lookup tables there carry the
  // bank each screen lives in. reserveFlashSave came back from checkCapacity
  // above rather than being recomputed here, so this and checkCapacity's own
  // screenCapacityFor call are provably looking at the same region list.
  const { screenBank, regionRanges } = assignScreenBanks(
    mapper,
    project.tilesets.length,
    bankedCode,
    reserveFlashSave,
    flat,
    actorCount
  );

  // --- maps ----------------------------------------------------------------
  const screenLabel = (index) => `screen_${index}`;
  await fs.writeFile(
    path.join(assetsDir, 'maps.inc'),
    [
      '; Generated -- screen lookup and edge-neighbour tables ($FF = map edge).',
      `map_base:\n${dbBlock(mapBase)}`,
      // Wandering monsters are a property of the map, not the screen, so the
      // rate and the formation live once per map and every screen carries the
      // map it belongs to. One byte per screen buys the lookup at no per-screen
      // cost worth speaking of.
      `map_enc_rate:\n${dbBlock(project.maps.map((map) => map.encounters?.rate ?? 0))}`,
      `map_enc_actors:\n${dbBlock(
        project.maps.flatMap((map) => encounterRow(map, actorCount)),
        RPG_ENCOUNTER_SLOTS
      )}`,
      `map_battle_sky:\n${dbBlock(project.maps.map((map) => map.battleSkyTile ?? 0))}`,
      `map_battle_ground:\n${dbBlock(project.maps.map((map) => map.battleGroundTile ?? 0))}`,
      // The song a map plays, in the same NO_SONG-for-Silence byte a Play
      // music command's argument compiles to (see songByte) — apply_map_music
      // indexes this with screen_map's answer, one map lookup after the other.
      `map_song:\n${dbBlock(project.maps.map((map) => songByte(project.songs, map.songId)))}`,
      `screen_map:\n${dbBlock(flat.map((entry) => project.maps.indexOf(entry.map)))}`,
      // One byte per screen rather than a map lookup at runtime: entering a
      // screen is the hot path, and screens.asm already has the flat index.
      `screen_tileset:\n${dbBlock(flat.map((entry) => entry.map.tilesetId))}`,
      // Which 16 KB PRG bank holds this screen's data. set_screen_ptr selects it
      // before dereferencing the pointers below.
      `screen_bank:\n${dbBlock(screenBank)}`,
      `screen_left:\n${dbBlock(neighbours.left)}`,
      `screen_right:\n${dbBlock(neighbours.right)}`,
      `screen_up:\n${dbBlock(neighbours.up)}`,
      `screen_down:\n${dbBlock(neighbours.down)}`,
      `screen_mt_lo:\n${pointerBlock(flat, (i) => `LOW(${screenLabel(i)})`)}`,
      `screen_mt_hi:\n${pointerBlock(flat, (i) => `HIGH(${screenLabel(i)})`)}`,
      `screen_at_lo:\n${pointerBlock(flat, (i) => `LOW(${screenLabel(i)}_attr)`)}`,
      `screen_at_hi:\n${pointerBlock(flat, (i) => `HIGH(${screenLabel(i)}_attr)`)}`,
      `screen_ent_lo:\n${pointerBlock(flat, (i) => `LOW(${screenLabel(i)}_ent)`)}`,
      `screen_ent_hi:\n${pointerBlock(flat, (i) => `HIGH(${screenLabel(i)}_ent)`)}`,
      ''
    ].join('\n')
  );

  // --- screen data ---------------------------------------------------------
  let droppedEntities = 0;
  const emitScreens = (from, to) => {
    const chunks = [
      '; Generated -- per screen: 240 metatile ids, 64 attribute bytes, then the',
      '; actor list as a count followed by (actor, x, y, door screen, door x,',
      '; door y, event, trigger, hide switch).'
    ];
    for (let index = from; index < to; index++) {
      const { screen } = flat[index];
      chunks.push(`${screenLabel(index)}:\n${dbBlock(screen.metatiles)}`);
      chunks.push(`${screenLabel(index)}_attr:\n${dbBlock([...screenAttributes(screen, project.metatiles)])}`);

      // An actor that was deleted after being placed would index past the end
      // of the actor tables, so drop it here rather than emit a bad reference.
      const placed = screen.entities.filter((entity) => entity.actorId < actorCount);
      droppedEntities += screen.entities.length - placed.length;
      const bytes = [placed.length];
      for (const entity of placed) {
        const target = Math.min(entity.props?.toScreen ?? 0, Math.max(0, flat.length - 1));
        bytes.push(
          entity.actorId,
          entity.x,
          entity.y,
          target,
          entity.props?.toX ?? 0,
          entity.props?.toY ?? 0,
          text.eventFor.get(entity) ?? NO_EVENT,
          // Which trigger this placement gets is the actor's behaviour question
          // as well as the author's, and `availableTriggers` is the single
          // writer for it — applied here and not only in the Map Forge, because
          // buildProject is handed the project the app is holding.
          triggerIndex(entity, project.sprites.actors[entity.actorId], project),
          entity.props?.hideSwitch ?? 0xff
        );
      }
      chunks.push(`${screenLabel(index)}_ent:\n${dbBlock(bytes, ENTITY_RECORD)}`);
    }
    return `${chunks.join('\n')}\n`;
  };
  const regionChunks = regionRanges.flatMap(({ region, from, to }) => [
    `  .bank ${region.nesasmBank}`,
    `  .org $${region.org.toString(16).toUpperCase()}`,
    emitScreens(from, to)
  ]);
  await fs.writeFile(
    path.join(assetsDir, 'screens.inc'),
    `; Generated -- screen data, packed into the switchable $8000-$BFFF window.\n${regionChunks.join('\n')}\n`
  );

  // The fixed kernel's two 8 KB halves.
  await fs.writeFile(
    path.join(assetsDir, 'kernel_lo.inc'),
    `; Generated -- fixed kernel: tables and engine code.\n  .bank ${layout.kernelLoBank}\n  .org $C000\n`
  );
  await fs.writeFile(
    path.join(assetsDir, 'kernel_hi.inc'),
    `; Generated -- fixed kernel: music data, then the CPU vectors.\n  .bank ${layout.kernelHiBank}\n  .org $E000\n`
  );

  // --- engine source -------------------------------------------------------
  // Stock first, then the Code Forge's copies over the top: an override is a
  // per-project edit of an engine file, so it must land at the same name and the
  // same line numbers (the assembler's errors are reported against these files,
  // and the Code Forge opens them by name and line). The app's own engine/ folder
  // is never written to.
  for (const file of engineFileNames()) {
    await fs.copyFile(path.join(ENGINE_DIR, file), path.join(buildDir, file));
  }
  const code = project.code ?? { overrides: [], files: [] };
  const stock = new Set(engineFileNames());
  let overridden = 0;
  for (const file of code.overrides) {
    if (!stock.has(file.name)) continue; // warned about in checkCapacity
    await fs.writeFile(path.join(buildDir, file.name), file.text, 'utf8');
    overridden += 1;
  }
  for (const file of code.files) {
    await fs.writeFile(path.join(buildDir, file.name), file.text, 'utf8');
  }

  // The include slot for user files. engine/main.asm includes this one file
  // unconditionally, in the fixed kernel at $C000 — permanently mapped on every
  // supported mapper, so a `jsr` into user code works from anywhere without the
  // user having to think about banking. Always emitted, so a project with no
  // code of its own assembles exactly as it did before the Code Forge existed.
  await fs.writeFile(
    path.join(assetsDir, 'usercode.inc'),
    code.files.length
      ? `; Generated -- Code Forge files, in the fixed kernel.\n${code.files
          .map((file) => `  .include "${file.name}"`)
          .join('\n')}\n`
      : '; Generated -- this project has no Code Forge files of its own.\n'
  );

  if (overridden || code.files.length) {
    log(
      `code: ${overridden} engine file${overridden === 1 ? '' : 's'} overridden, ` +
        `${code.files.length} user file${code.files.length === 1 ? '' : 's'} included`
    );
  }

  const banksUsed = new Set(screenBank).size;
  log(
    `generated ${flat.length} screen${flat.length === 1 ? '' : 's'} across ${banksUsed} of ` +
      `${layout.dataBankCount} PRG bank${layout.dataBankCount === 1 ? '' : 's'}, capacity ${capacity}`
  );
  if (droppedEntities) {
    log(`warning: skipped ${droppedEntities} placed actor(s) that refer to an actor which no longer exists.`);
  }

  // The player takes four sprites and the NES can only show 64, so a screen
  // full of large actors will start dropping tiles.
  const largest = Math.max(0, ...project.sprites.metasprites.map((entry) => entry.tiles.length));
  if (largest && 4 + largest * LIMITS.entitiesPerScreen > 64) {
    log(
      `warning: ${LIMITS.entitiesPerScreen} actors of ${largest} tiles each plus the player exceed the ` +
        "NES's 64 sprites; some will not be drawn on a crowded screen."
    );
  }

  return {
    buildDir,
    warnings: problems.filter((problem) => problem.severity !== 'error'),
    stats: { screenCount, capacity, usedPlaceholder: spriteTableEmpty, playerActor: playerActor?.name ?? null }
  };
}

/**
 * Metasprite, animation and actor tables.
 *
 * Metasprite tiles are stored in OAM order (y, tile, attributes, x) with the
 * offsets already applied, so drawing one is a straight copy with the entity's
 * position added. Every table gets at least one entry even when the project has
 * none, because the engine's `.db` labels have to exist either way.
 */
function spriteTables(project, playerTiles) {
  const { metasprites, animations, actors } = project.sprites;
  const chunks = [
    '; Generated -- player frames, metasprites, animations and actors.',
    `player_tiles:\n${dbBlock(playerTiles, 4)}`,
    `player_pal:\n  .db ${hex(0)}`
  ];

  // Metasprites.
  const msCounts = metasprites.length ? metasprites.map((entry) => entry.tiles.length) : [0];
  chunks.push(`ms_count:\n${dbBlock(msCounts)}`);
  chunks.push(`ms_ptr_lo:\n${labelBlock(msCounts.length, (i) => `LOW(ms_data_${i})`)}`);
  chunks.push(`ms_ptr_hi:\n${labelBlock(msCounts.length, (i) => `HIGH(ms_data_${i})`)}`);
  if (!metasprites.length) {
    chunks.push('ms_data_0:\n  .db $00');
  } else {
    metasprites.forEach((metasprite, index) => {
      const bytes = [];
      for (const tile of metasprite.tiles) {
        const attributes = (tile.palette & 3) | (tile.hflip ? 0x40 : 0) | (tile.vflip ? 0x80 : 0);
        bytes.push(tile.y & 0xff, tile.tile & 0xff, attributes, tile.x & 0xff);
      }
      chunks.push(`ms_data_${index}:\n${bytes.length ? dbBlock(bytes, 4) : '  .db $00'}`);
    });
  }

  // Animations: (metasprite, duration) per frame.
  const animCounts = animations.length ? animations.map((entry) => entry.frames.length) : [0];
  chunks.push(`anim_count:\n${dbBlock(animCounts)}`);
  chunks.push(`anim_ptr_lo:\n${labelBlock(animCounts.length, (i) => `LOW(anim_data_${i})`)}`);
  chunks.push(`anim_ptr_hi:\n${labelBlock(animCounts.length, (i) => `HIGH(anim_data_${i})`)}`);
  if (!animations.length) {
    chunks.push('anim_data_0:\n  .db $00');
  } else {
    animations.forEach((animation, index) => {
      const bytes = animation.frames.flatMap((frame) => [frame.metaspriteId & 0xff, frame.duration & 0xff]);
      chunks.push(`anim_data_${index}:\n${bytes.length ? dbBlock(bytes, 2) : '  .db $00'}`);
    });
  }

  // Actors.
  const list = actors.length ? actors : [{ behavior: 'patroller', speed: 1, hp: 1, damage: 0, anims: {} }];
  chunks.push(`actor_behavior:\n${dbBlock(list.map((actor) => behaviorIndex(actor.behavior)))}`);
  chunks.push(`actor_speed:\n${dbBlock(list.map((actor) => actor.speed ?? 1))}`);
  chunks.push(`actor_hp:\n${dbBlock(list.map((actor) => actor.hp ?? 1))}`);
  // Contact damage in an action game; in an RPG a non-zero value marks the actor
  // hostile and the battle system reads its strength from the battle tables.
  chunks.push(`actor_damage:\n${dbBlock(list.map((actor) => actor.damage ?? 0))}`);

  // Four animations per actor, indexed by facing (down, up, left, right).
  // A slot the Sprite Forge left empty falls back to the idle animation, and
  // an actor with nothing at all is marked $FF so the engine draws nothing.
  const animFor = (actor, slot) => {
    const value = actor.anims?.[slot];
    if (value !== null && value !== undefined) return value;
    const idle = actor.anims?.idle;
    return idle === null || idle === undefined ? 0xff : idle;
  };
  const animTable = list.flatMap((actor) => [
    animFor(actor, 'walkDown'),
    animFor(actor, 'walkUp'),
    animFor(actor, 'walkSide'),
    animFor(actor, 'walkSide')
  ]);
  chunks.push(`actor_anim_dir:\n${dbBlock(animTable, 4)}`);

  return `${chunks.join('\n')}\n`;
}

const behaviorIndex = (id) => Math.max(0, BEHAVIORS.findIndex((entry) => entry.id === id));
const actionIndex = (id) => Math.max(0, ACTIONS.findIndex((entry) => entry.id === id));

function labelBlock(count, format, perLine = 8) {
  const lines = [];
  for (let i = 0; i < count; i += perLine) {
    const slice = [];
    for (let j = i; j < Math.min(i + perLine, count); j++) slice.push(format(j));
    lines.push(`  .db ${slice.join(',')}`);
  }
  return lines.join('\n');
}

function pointerBlock(flat, format, perLine = 8) {
  const lines = [];
  for (let i = 0; i < flat.length; i += perLine) {
    const slice = [];
    for (let j = i; j < Math.min(i + perLine, flat.length); j++) slice.push(format(j));
    lines.push(`  .db ${slice.join(',')}`);
  }
  return lines.join('\n');
}
