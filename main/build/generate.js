// Turns a project into the .inc/.chr files the template engine includes.
//
// Everything the engine and the generator both need to agree on is emitted
// here into assets/config.inc, so there is exactly one writer for each shared
// constant and no chance of the two drifting apart.

import fs from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
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
  projectUsesText,
  projectUsesEffectiveTitle
} from '../../shared/font.js';
import { compileSong, songTables } from './songcompile.js';
import { NO_EVENT, compileText, textTables, songByte } from './textcompile.js';
import {
  battleTables,
  battleCodeOverridden,
  battleRegionBytes,
  battleRegionPlacementOverridden,
  battleRegionRelocates,
  battleTableBytes,
  battleRegionCeiling,
  battleShortfallAdvice,
  checkBattleTables
} from './battletables.js';
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
  reconcileCartridge,
  projectUsesSave,
  projectUsesMove,
  projectUsesTurn,
  projectUsesWait,
  projectUsesShake,
  projectUsesVisible,
  projectUsesFade,
  projectUsesFace,
  projectUsesItems,
  projectEvents,
  allCommands,
  mapEncounterFormation,
  itemMissing,
  canBackItem,
  ITEM_EFFECT_KINDS,
  NO_ITEM,
  NO_METASPRITE
} from '../../shared/project.js';
import { SAVE_FIELDS, saveBodySize, saveIdentity } from '../../shared/save.js';
import {
  CHR_BANK_BYTES,
  NESASM_BANK_BYTES,
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
// The pieces, each measured by building sample-rpg with every
// conditionally-assembled block heal/damage's own measurement already
// covered (dialogue, action combat, the RPG battle system, branches,
// questions, common-event calls, Play music, Start a battle, Heal/Damage) --
// nesasm's kernel-lo usage minus that build's own fixedBytes + tableBytes:
//
// BASE_KERNEL_CODE_BYTES_BY_MAPPER is the worst case with nothing
// conditional turned on -- no title screen, no Save, no Move, no text on a
// split-font board -- measured per mapper rather than once. A single flat
// number, measured on UNROM 512 because banks.asm emits the most code for
// it, used to be charged to every board; MMC3's own switch_chr_bank/
// switch_prg_bank pair is smaller, so that overcharged every MMC3 project by
// 8 bytes, and MMC1's by 195 -- both boards forced to carry UNROM 512's own
// combined PRG/CHR register plumbing, which neither of them has. Only three
// mappers can be measured this way at all: sample-rpg needs a mapper that
// switches both PRG and CHR (rpgCapable() in shared/cartridge.js), which is
// exactly UNROM 512, MMC1 and MMC3 -- the same three test/unit/kernelbytes.
// test.js already builds.
//   UNROM 512: 6466   MMC1: 6271   MMC3: 6446
// (MMC3's own figure excludes SPLIT_LOCK_KERNEL_ALLOWANCE, kept a separate
// term below for the same reason it always was -- see its own paragraph. A
// title-off sample-rpg still shows text on MMC3 -- projectUsesText is true
// for the RPG game type alone, regardless of titleMap -- so the raw
// title-off measurement, 6465, already has SPLIT_LOCK_KERNEL_ALLOWANCE's 19
// bytes baked in exactly as the old title-on raw measurement did; 6446 is
// that measurement with the same 19 bytes subtracted back out, the same
// bookkeeping the old 6670 already did against its own raw 6689.)
// Every other supported mapper -- NROM, CNROM, GxROM, Color Dreams, UxROM --
// cannot build an RPG at all, so this methodology cannot measure a base for
// any of them; baseKernelCodeBytes() falls back to the largest of the three
// figures above for a mapper this table has no entry for, which is not a
// guess standing in for a measurement -- it is the same shape this function
// has always used for an unmeasured board, so a project on one of those
// five still reserves a safe over-estimate rather than nothing.
// codebuild.test.js's byte-identical NROM build depends on this fallback
// staying a safe over-estimate (it changed value, from 6678 to 6466, the
// day the title term below was carved out of it -- see that term's own
// paragraph for why NROM's own byte-identical build is unaffected: NROM's
// build carries no title screen, so nothing here changes what it emits).
// cartridge.test.js's UxROM screen-count test depends on the fallback the
// same way.
//
// TITLE_KERNEL_ALLOWANCE_BY_MAPPER is the extra a board pays only when the
// project actually has a title screen that resolves (projectUsesEffectiveTitle,
// shared/font.js) -- OR, independent of that, has a live Save command, which
// needs one in every valid build regardless of whether titleMap happens to
// resolve yet; see kernelCodeBytes's own comment beside `usesTitle` for why
// charging on projectUsesEffectiveTitle alone undercharges an in-progress,
// still-invalid Save project by exactly this term. Carved out of the base above rather than
// left baked into it, because every measurement that produced the old base
// numbers (6678/6483/6670) forced `titleMap = 0` unconditionally, even for
// the "nothing conditional" baseline, so *every* RPG project on every board
// used to be charged for `engine/title.asm`'s code whether or not it had a
// title screen. sample-rpg as checked in has `titleMap: null` -- no title
// screen -- so this was a real, measured overcharge on the fixture this
// very budget is calibrated against, not a hypothetical one. Measured the
// same way as every other term: sample-rpg's "no Save, no Move" baseline
// built once with a title screen and once without, on each board --
//   UNROM 512: 6678 - 6466 = 212   MMC1: 6483 - 6271 = 212   MMC3: 6689 - 6465 = 224
// MMC3 pays 12 bytes more than the other two, and it is not slack: MMC3 is
// the only board with SPLIT_ENABLED (see split.asm's own header), and
// engine/split.asm's split_select carries its own `.if TITLE_ENABLED` block
// -- five instructions deciding whether the current frame's font-CHR split
// program is the title one -- that MMC1 and UNROM 512 never assemble at
// all, because split.asm's entire body is conditional on SPLIT_ENABLED and
// neither board ever sets it. engine/title.asm itself has no MMC3-specific
// branch anywhere in it (checked: no SPLIT_ENABLED/split_ reference in that
// file), so its own cost is identical on all three boards; the other 12
// bytes are exactly this one extra branch, elsewhere, that only a
// split-font board with a title screen pays. A flat constant would either
// undercharge MMC3 by 12 bytes (unsafe -- promising table room the
// assembler then refuses) or overcharge the other two by the same 12
// (safe, but a term is supposed to equal its board's own real cost, the
// same standard SAVE_KERNEL_ALLOWANCE_BY_MAPPER's own multi-revision
// history below already holds every other term to), so this is the
// SAVE_KERNEL_ALLOWANCE_BY_MAPPER shape, not the flat MOVE_KERNEL_ALLOWANCE
// one. Every other supported mapper falls back to the largest of the three
// figures for the same reason baseKernelCodeBytes's own fallback does -- an
// action project on NROM, CNROM, GxROM, Color Dreams or UxROM can have a
// title screen too, and this term must still be a safe over-estimate for
// it.
//
// SAVE_KERNEL_ALLOWANCE_BY_MAPPER is the extra a board pays only when
// save/load itself assembles, derived per board from the difference
// save/load actually measures on the two boards that can build it at all --
// not guessed, and not the larger of the two charged to both the way it used
// to be, now that a per-mapper base makes a per-mapper allowance the same
// kind of number: MMC1 goes from 6483 to 7030 (+547), MMC3 from 6689 to 7241
// (+552, text always on for an RPG on a split-font board -- see
// SPLIT_LOCK_KERNEL_ALLOWANCE below). Both sides of that subtraction carry a
// title screen (validateProject refuses a live Save with no title screen —
// "Continue has nowhere to appear without one" — so a project that pays
// SAVE_KERNEL_ALLOWANCE always pays TITLE_KERNEL_ALLOWANCE too), which is
// exactly why splitting the title cost out of the base above left this
// delta unchanged: 6483 and 7030 are both title-on figures, so the 547
// between them is the cost of save/load alone, with title's own cost
// present -- and cancelling out -- on both sides. Re-measured directly
// against the new title-off base after the split (title forced on for both
// the with-Save and without-Save sides, kernelbytes.test.js's own
// `measureCodeBytes(..., { withTitle: true })`) rather than assumed: still
// 547/552/719, to the byte. (This grew from an earlier +453/+458
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
// HISTORICAL -- every figure in this paragraph and the next is superseded;
// see the "current state" paragraph below for what actually holds today.
// Kept only for the shape of the story (per-mapper budgeting recovering a
// bounded, named amount, and a specific combination's fit moving back and
// forth as later changes cost or freed real bytes), not for any number in
// it to be read as still true. When per-mapper terms first shipped, every
// configuration this file could measure left exactly KERNEL_SLACK bytes of
// margin against its own real worst case: MMC3 with Save and Move (base
// 6670 at the time + SPLIT_LOCK_KERNEL_ALLOWANCE 19 + SAVE_KERNEL_ALLOWANCE
// 552 + MOVE_KERNEL_ALLOWANCE 395 + KERNEL_SLACK 20 = 7656) reserved 20
// bytes over a real measured 7636; MMC1 with the same two features (base
// 6483 at the time + 547 + 395 + 20 = 7445) reserved 20 over a real
// measured 7425. At that same point, checkCapacity had just stopped
// refusing sample-rpg with a Save command *and* a Move command on MMC3: the
// per-mapper base had recovered 8 of the 12 bytes that combination used to
// be short by (MMC3's true base was 8 less than the UNROM 512 figure it
// used to be charged), and a second, unrelated fix -- entity_contact
// (engine/combat.asm) no longer reading player_iframes before starting an
// RPG's contact battle, which happened to remove 2 instructions (5 bytes)
// from the RPG build on every board -- had closed the remaining 4 and then
// some. nesasm assembled that exact combination into the kernel-lo bank
// with 21 bytes to spare (8171 of 8192, lookup tables included) at that
// point in history. When a project genuinely does not fit, checkCapacity
// names the specific feature (or combination of active features -- see
// kernelShortfallAdvice's own comment) or board that would close the gap,
// instead of only reporting the shortfall -- and a board is only ever
// offered if it can actually hold everything the project already has
// (tilesets, screens, mirroring), not merely a smaller kernel-byte
// reservation, or the "fix" would have reconcileCartridge (shared/project.js)
// silently truncate something the moment it was applied. That part is not
// historical -- it is still exactly how the advice works today.
//
// HISTORICAL, continued -- three changes since have each moved the same
// combination's fit, and none of the figures above reflect any of them.
// Phase 4b costed items[] for real (ITEM_KERNEL_ALLOWANCE, 16 bytes,
// measured on all three RPG-capable boards) and reopened the MMC3
// Save+Move gap the paragraph above had just closed -- sample-rpg carries
// one live item, so this combination went from 21 real bytes free back to
// short by 16 (change one). A kernel diet closed it again: engine/
// player.asm's four movement direction routines (move_left_inside/
// move_right_inside/move_up_inside/move_down_inside) each ended in an
// identical two-corner probe-and-commit tail, differing only in which
// body-offset constant fed the first probe and which of player_x/player_y
// the result committed to. move_horizontal_probe and move_vertical_probe
// are that shared tail now, with each _inside label falling into its
// axis's tail by `jmp` rather than `jsr` so the tail's own `rts` still
// returns to whichever caller originally `jsr`'d move_left et al. --
// removing duplication, not changing behaviour. It dropped every
// RPG-capable board's own base by 70 bytes alike, which reopened sample-
// rpg's Save+Move+item combination on MMC3 with real headroom rather than
// landing back at a single spare byte (change two). Phase 4c round 2 then
// spent that headroom and reopened the same gap a third time:
// engine/ui.asm's use_item_apply is real engine code the field menu's
// "spend an item" action always needed, gated by the identical
// ITEMS_ENABLED toggle phase 4b's own item cost already shares, and
// ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE.rpg (60 bytes, measured) is
// exactly what it costs -- short by 8 bytes this time (change three).
// Unlike the first two, this one was not chased with a further diet: the
// outcome was decided deliberately rather than discovered as a surprise,
// and accepted as a documented limitation the same way UNROM 512's own
// Save+Move shortfall already is.
//
// CURRENT STATE, as of phase 4c round 2: sample-rpg with a live Save
// command, a live Move command and its one live item does NOT build on
// MMC3 -- test/unit/kernelbytes.test.js's "...does not build on MMC3 --
// round 2 reopened the gap the kernel diet had closed" is the check for
// exactly this combination, and it asserts the refusal, not a fit. Every
// other RPG-capable configuration (MMC1, and MMC3 without this exact
// combination) still measures the same KERNEL_SLACK margin the first
// historical paragraph above describes the shape of; this is the one
// corner where the margin ran out. BASE_KERNEL_CODE_BYTES_BY_MAPPER's real
// current values are declared just below this comment, not quoted here --
// the two paragraphs above already show what happens when a number gets
// copied into prose instead of read from its own declaration.
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
//
// +3 on each board, this round: battle_end (engine/rpg.asm) now restores
// talk_ent to the resolved owner slot before a resumed script continues --
// without it, a Move or Turn targeting "self" right after a scripted battle
// read talk_ent as still NO_ENTITY (battle_begin clears it unconditionally
// and nothing put it back) and silently jmp script_finish'd the whole rest
// of the page. battle_end is unconditional kernel code (BATTLE_ENABLED
// alone, not gated by MOVE_ENABLED/TURN_ENABLED), so this is a base cost
// every RPG project pays, not a new named allowance term.
export const BASE_KERNEL_CODE_BYTES_BY_MAPPER = { 30: 6399, 1: 6204, 4: 6379 };
const FALLBACK_BASE_KERNEL_CODE_BYTES = Math.max(...Object.values(BASE_KERNEL_CODE_BYTES_BY_MAPPER));
export function baseKernelCodeBytes(mapper) {
  return BASE_KERNEL_CODE_BYTES_BY_MAPPER[mapper.id] ?? FALLBACK_BASE_KERNEL_CODE_BYTES;
}

export const TITLE_KERNEL_ALLOWANCE_BY_MAPPER = { 30: 212, 1: 212, 4: 224 };
const FALLBACK_TITLE_KERNEL_ALLOWANCE = Math.max(...Object.values(TITLE_KERNEL_ALLOWANCE_BY_MAPPER));
export function titleKernelAllowance(mapper) {
  return TITLE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id] ?? FALLBACK_TITLE_KERNEL_ALLOWANCE;
}

// 30 (UNROM 512) is measured the same way as the other two, from a real
// build of sample-rpg with and without a live Save command: 6678 -> 7397,
// +719 -- both sides carrying a title screen, since Save requires one; 6678
// is base (6466) + title (212), not the base alone (see the title-split
// paragraph above for why that distinction now matters: folding a title-on
// baseline back into a bare "base" figure is exactly the mistake that
// undercharged every titleless project before this file's own base/title
// split). Substantially larger than MMC1/MMC3's own allowance because flash
// save is not just a checksum/marker-write difference from battery -- it
// carries its own RAM-resident driver (engine/flash.asm: the JEDEC unlock
// sequence, the erase, the 87-byte program loop, all position-independent)
// plus save_media_fetch/commit's wrapper (the vblank wait, the forced
// blank, the copy-to-RAM, the mapper_shadow save/restore) that battery's
// save_media_fetch/commit reduce to a no-op. UNROM 512's own base-plus-title
// (6678, the largest of the three, and title-on because Save requires it)
// is what leaves room for it: 719 against roughly 1514 bytes of headroom
// before KERNEL_SLACK and the fallback base even
// enter the picture.
export const SAVE_KERNEL_ALLOWANCE_BY_MAPPER = { 1: 547, 4: 552, 30: 719 };
// move_tick/move_get_x/y/move_set_x/y/move_speed/move_animate only --
// move_face moved out to its own FACE_KERNEL_ALLOWANCE below (item 6's
// Turn/Wait first slice), so this dropped from the 395 bytes it measured
// before that split: 379, measured (not derived) the same way every figure
// below is -- build sample-rpg with and without the command, on all three
// RPG-capable boards, and read nesasm's own kernel-lo BANK line each time.
// All four deltas below (this one included) came out identical to the byte
// on MMC1, MMC3 and UNROM 512, which is what justifies each staying a flat
// constant rather than *_BY_MAPPER the way SAVE_KERNEL_ALLOWANCE_BY_MAPPER
// has to be -- nothing any of these four gate on branches by board.
export const MOVE_KERNEL_ALLOWANCE = 379;
// move_face alone (engine/entities.asm), gated on FACE_ENABLED
// (projectUsesFace = projectUsesMove || projectUsesTurn) -- charged once
// whenever either Move or Turn is live, never twice when both are. Measured
// by isolating it two ways that have to agree: MOVE_KERNEL_ALLOWANCE (379)
// plus this (16) sums to the pre-split 395 exactly, and a build with both
// Move and Turn live measures exactly MOVE_KERNEL_ALLOWANCE +
// TURN_KERNEL_ALLOWANCE + this (379 + 35 + 16 = 430) -- not 430 + 16 again --
// confirming the routine is charged once, not twice, when both commands are.
export const FACE_KERNEL_ALLOWANCE = 16;
// script_op_turn plus its own dispatch-chain entry in script_run
// (engine/script.asm) -- not move_face, which is FACE_KERNEL_ALLOWANCE.
export const TURN_KERNEL_ALLOWANCE = 35;
// script_op_wait, wait_tick, both dispatch-chain entries (script_run and
// ui_tick), and script_start's own wt_left clear. Additive with
// TURN_KERNEL_ALLOWANCE exactly (35 + 48 = 99, the real measured delta of a
// build with both live and neither Move), because Wait touches no code Turn
// or Face also touch.
export const WAIT_KERNEL_ALLOWANCE = 48;
// The shake block inside nmi_scroll (engine/boot.asm) plus script_op_shake
// and its dispatch-chain entry in script_run (engine/script.asm) plus the
// shake_left clear in vram_reset (engine/text.asm). Flat across boards --
// nothing here branches on SPLIT_ENABLED or anything else mapper-specific,
// the same reasoning MOVE_KERNEL_ALLOWANCE/TURN_KERNEL_ALLOWANCE/
// WAIT_KERNEL_ALLOWANCE are flat -- and shares no dependent term with
// anything else the way Move/Turn share FACE_KERNEL_ALLOWANCE, since no
// other command calls into Shake's own code. Measured on all three
// RPG-capable boards, identically -- 65, not the 63 this first measured
// before script_op_shake's own zero-operand check (a Shake of 0 must not
// stomp a shake already running, the identical "zero means nothing happens"
// rule Wait/Heal/Damage already hold to) added its own beq and label.
export const SHAKE_KERNEL_ALLOWANCE = 65;
// script_op_visible and its dispatch-chain entry in script_run
// (engine/script.asm) plus the ENT_HIDDEN check in draw_entities
// (engine/entities.asm). Flat across boards for the identical reason
// SHAKE_KERNEL_ALLOWANCE is: nothing here branches on SPLIT_ENABLED or any
// other mapper-specific fact -- measured identically (49) on UNROM 512,
// MMC1 and MMC3. Shares no dependent term with anything else -- no other
// command calls script_op_visible or reads ENT_HIDDEN.
export const VISIBLE_KERNEL_ALLOWANCE = 49;
// script_op_fade, fade_tick and fade_apply_palette (engine/script.asm,
// engine/entities.asm), both dispatch-chain entries (script_run and
// ui_tick), script_start's own fade_left clear, the fade_reload arm in
// init_session and its consumption in redraw_screen (engine/combat.asm,
// engine/screens.asm), the PPUADDR cleanup in nmi (engine/boot.asm) and
// reset's own fade_reload clear right after cold boot's init_session call.
// Flat across boards, the same reasoning SHAKE_KERNEL_ALLOWANCE/
// VISIBLE_KERNEL_ALLOWANCE are: nothing here branches on SPLIT_ENABLED, a
// CHR/PRG bank, or any other mapper-specific fact -- every routine reads
// palette_data (a plain ROM table, same address on every board) and writes
// only through vram_push/vram_open/vram_end or raw $2006 writes, machinery
// every board already shares. Measured on all three RPG-capable boards,
// isolated per board, test/unit/kernelbytes.test.js's own combinatorial
// shape (diffing a with-Fade build against a Fade-stripped one and asserting
// equality) -- identically 201 on UNROM 512, MMC1 and MMC3, and additive
// with SHAKE_KERNEL_ALLOWANCE exactly (a combined Fade+Shake build measures
// 266 = 201 + 65, not less). Not trusted from design-fade.md's own
// pre-measurement estimate (~174-183) -- the real figure landed higher, as
// that document's own §12 says plainly it might.
export const FADE_KERNEL_ALLOWANCE = 201;
export const SPLIT_LOCK_KERNEL_ALLOWANCE = 19;
// Phase 4b: item_metasprite's own draw_item_icon routine (gated on
// ITEMS_ENABLED as a whole routine, not just its callers -- see
// engine/ui.asm) plus add_item's centralized NO_ITEM guard, gated by
// projectUsesItems -- see the phase 4 design document's §3 for the
// pre-implementation estimate (16 bytes) this matched exactly. Flat, not
// per-mapper: nothing this term covers branches on SPLIT_ENABLED or any
// other mapper-specific fact, the same reasoning that keeps
// MOVE_KERNEL_ALLOWANCE flat rather than *_BY_MAPPER. Measured on all three
// RPG-capable boards, isolated per board -- test/unit/kernelbytes.test.js's
// own combinatorial test, which diffs a with-items build against an
// items-stripped one and asserts equality, the same shape every other
// allowance here is measured by -- rather than trusted from the estimate.
export const ITEM_KERNEL_ALLOWANCE = 16;
// use_item_apply and the ITEMS_ENABLED half of use_item (engine/ui.asm) --
// round 2's own cost, kept as its own named constant separate from
// ITEM_KERNEL_ALLOWANCE (phase 4b's) for the identical reason
// SAVE_KERNEL_ALLOWANCE_BY_MAPPER and MOVE_KERNEL_ALLOWANCE are two
// constants rather than one: each commit's byte accounting stays
// self-contained, and each is independently what kernelShortfallAdvice
// would attribute a drop to. Gated by the same predicate as
// ITEM_KERNEL_ALLOWANCE (usesItems below) -- use_item_apply is assembled
// whenever ITEMS_ENABLED is true, regardless of which kinds any particular
// item actually carries.
//
// Flat across boards -- measured identically on all eight registered
// boards for an action project and all three RPG-capable boards for an
// RPG, in test/unit/kernelbytes.test.js -- but NOT flat across game type,
// which no other allowance here has needed to be: use_item_apply's damage
// branch calls party_damage (RPG, BATTLE_ENABLED) or lose_hearts plus a
// zero-page lda of player_hp (action, !BATTLE_ENABLED), and those two
// bodies are not the same size. Measured exactly: 63 bytes for an action
// project, 60 for an RPG. Splitting by game type here rather than
// reserving the flat worst case for both is the identical move
// BASE_KERNEL_CODE_BYTES_BY_MAPPER already made once per-board variance
// was discovered instead of charging every board the worst one's figure --
// asserted exactly (not merely "covers enough"), the same discipline
// every other allowance here is held to.
export const ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE = { action: 63, rpg: 60 };
const FALLBACK_ITEM_EFFECT_KERNEL_ALLOWANCE = Math.max(...Object.values(ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE));
// A project not yet through normalizeProject (the app is holding one mid-edit,
// same reasoning kernelCodeBytes' own callers already have to live with
// elsewhere) can carry a gameType this table has no entry for -- falls back
// to the larger of the two measured figures, the identical shape
// baseKernelCodeBytes' own fallback already uses for an unmeasured mapper.
export function itemEffectKernelAllowance(project) {
  return ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE[project.project?.gameType] ?? FALLBACK_ITEM_EFFECT_KERNEL_ALLOWANCE;
}
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
  const usesTurn = projectUsesTurn(project);
  const usesWait = projectUsesWait(project);
  const usesShake = projectUsesShake(project);
  const usesVisible = projectUsesVisible(project);
  const usesFade = projectUsesFade(project);
  const usesFace = projectUsesFace(project);
  // projectUsesSave(project), not the narrower usesSave just above: a live
  // Save command needs a title screen in *every* valid build of this
  // project (validateProject refuses one with no title regardless of which
  // mapper is selected — "Continue has nowhere to appear without one" is
  // not conditional on saveMediaImplemented, which is a separate refusal),
  // so a titleless Save project has to be budgeted as the only thing it can
  // legally become, not as the invalid thing it currently is. Charging
  // usesSave alone would undercharge it by exactly TITLE_KERNEL_ALLOWANCE
  // right up until the author adds the title screen they are already being
  // told they must -- which is what let a mapper get recommended, and the
  // Build panel's own meter show room, for a project that both stops
  // fitting and stops being buildable at all the moment that happens. This
  // is deliberately not "withhold the advice instead": the same wrong
  // number also feeds checkCapacity's pass/fail and the meter directly, and
  // patching only the one consumer that happened to surface it would leave
  // the other two silently wrong. Using the OR rather than requiring both
  // means dropping Save (projectWithoutCommands, kernelShortfallAdvice)
  // correctly frees title's own cost too when nothing else on the project
  // asked for a title — the two terms are correlated, not summed twice: a
  // project that also set a real, resolving titleMap of its own keeps
  // paying for it even once Save is gone. The *effective* predicate, not
  // the loose one: a stale titleMap that names no real map assembles to
  // TITLE_ENABLED = 0 regardless of what the loose check says, and charging
  // for a title screen that will not be in the ROM is exactly the
  // overcharge this whole term exists to remove -- round 4 fixed
  // validateProject's own version of this mistake and left this one, its
  // mirror image, in place.
  const usesTitle = projectUsesEffectiveTitle(project) || projectUsesSave(project);
  const usesSplitLock = fontBankSplit(project, mapper);
  const usesItems = projectUsesItems(project);
  return (
    baseKernelCodeBytes(mapper) +
    (usesTitle ? titleKernelAllowance(mapper) : 0) +
    (usesSave ? SAVE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id] : 0) +
    (usesMove ? MOVE_KERNEL_ALLOWANCE : 0) +
    (usesTurn ? TURN_KERNEL_ALLOWANCE : 0) +
    (usesWait ? WAIT_KERNEL_ALLOWANCE : 0) +
    (usesShake ? SHAKE_KERNEL_ALLOWANCE : 0) +
    (usesVisible ? VISIBLE_KERNEL_ALLOWANCE : 0) +
    (usesFade ? FADE_KERNEL_ALLOWANCE : 0) +
    (usesFace ? FACE_KERNEL_ALLOWANCE : 0) +
    (usesSplitLock ? SPLIT_LOCK_KERNEL_ALLOWANCE : 0) +
    (usesItems ? ITEM_KERNEL_ALLOWANCE + itemEffectKernelAllowance(project) : 0) +
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
 * The boards this project could switch to without losing something in the
 * move -- the candidate list every "would a different mapper fix this?"
 * answer is drawn from, shared by kernelShortfallAdvice and
 * battleShortfallAdvice (main/build/battletables.js) so the two cannot reach
 * different conclusions about whether the same switch is safe.
 *
 * This asks the authorities rather than restating their rules. An earlier
 * version was a chain of hand-written filters -- tileset limit, mirroring,
 * screens, save medium -- and the trouble with that shape is that it is a
 * list someone has to keep complete. It was already missing three rules when
 * it was reviewed: art in the tilesets' $A0-$FF, which only a scanline-IRQ
 * board leaves to the author; sprite tile $FD, which a split-font board
 * reserves for the battle targeting cursor, so *entering* MMC3 can break a
 * project too; and a monster's battle art block running past $A0, which is an
 * error off MMC3 even when the tileset's own upper slots are empty. Three
 * misses in one pass is the shape of a rule that should not be a list.
 *
 * So the test is behavioural, and there are exactly two questions:
 *
 *  - **Does the switch cost anything?** reconcileCartridge (shared/project.js)
 *    is the single writer for what changes when the cartridge changes -- it
 *    truncates tilesets past the new board's limit and resets a mirroring the
 *    new board does not offer. If it alters the project at all, the switch is
 *    lossy, and a "fix" that silently drops a tileset is not a fix. Comparing
 *    before and after catches that without this function knowing what any of
 *    those limits are.
 *  - **Does the switch introduce a new error, and does the result still fit
 *    the banks this can measure?** Not "would it build", which is stronger
 *    than what is actually checked: a project being advised may keep errors it
 *    already had, and hand-written code is unmeasurable (see the guard at the
 *    top). validateProject answers every content rule at once, including all
 *    three the old chain missed and any added later; the capacity questions it
 *    does not own are asked directly -- the tileset ceiling checkCapacity uses
 *    (font page included, which reconcileCartridge's own does not), screens,
 *    kernel-lo, and for an RPG the banked code region. A board that fixed one
 *    bounded bank by overflowing another was offered by the old chain, in both
 *    directions.
 *
 * The validation half compares error sets rather than counting them, and that
 * is not fussiness. A project being advised is a project with a problem, and
 * it may well have unrelated ones too -- a live Save with no title screen, say
 * -- which every board shares. Rejecting a candidate for an error it merely
 * inherited would mean a project with one unrelated mistake gets no mapper
 * advice at all, silently. Only an error the *switch introduces* disqualifies
 * a board. Errors are keyed by their rendered text, which can call the same
 * rule "new" when a message quotes the board's own name; that direction is the
 * safe one -- a board wrongly withheld is weaker advice, a board wrongly
 * offered is wrong advice.
 *
 * checkCapacity is deliberately NOT called here, even though it would answer
 * the capacity half in one line: it calls kernelShortfallAdvice, which calls
 * this, which would call it again. The three fit checks below are its own
 * arithmetic, reached directly.
 */
export function switchableMappers(project, mapper, { checkBattleRegion = true } = {}) {
  // Hand-written 6502 makes every "it would fit" below a guess, so no board is
  // offered at all when the project carries any. The fit checks are the whole
  // value of this function, and two of the three read models of stock code:
  // kernelCodeBytes measures the stock kernel, battleRegionBytes the stock
  // battle system. A Code Forge override replaces one of those files, and even
  // a plain user file lands in kernel-lo through assets/usercode.inc -- so a
  // candidate can save enough *modelled* bytes to pass while the real,
  // unmeasured code still overflows. Recommending a board on that basis is the
  // same guess CLAUDE.md refuses to make about user code anywhere else, just
  // aimed at the Build panel's mapper select instead of a capacity number.
  //
  // Withholding is the graceful failure: the advice that survives is the
  // feature- and content-removal kind, which stays true regardless. This also
  // closes the same overclaim in kernelShortfallAdvice, which had it first.
  if ((project.code?.overrides ?? []).length || (project.code?.files ?? []).length) return [];

  const isRpg = project.project?.gameType === 'rpg';
  const wantsSave = projectUsesSave(project);
  const { flat } = flattenScreens(project);
  const bankedCode = codeRegionCount(project);
  const actorCount = project.sprites.actors.length;
  const { fixedBytes, tableBytes } = kernelTableBytes(project);

  return SUPPORTED_MAPPERS.filter((candidate) => candidate.id !== mapper.id)
    .filter((candidate) => !isRpg || rpgCapable(candidate))
    // saveMediaImplemented, not saveCapable: recommending UNROM 512 to a
    // project with a live Save command would just trade this shortfall for
    // validateProject's flash-unimplemented refusal -- not a fix.
    .filter((candidate) => !wantsSave || saveMediaImplemented(candidate))
    .filter((candidate) => {
      // Lossless? reconcileCartridge works in place, so this is done on a
      // clone -- nothing here may touch the project it is advising about.
      const moved = structuredClone(project);
      moved.cartridge.mapper = candidate.id;
      reconcileCartridge(moved);
      const before = structuredClone(project);
      before.cartridge.mapper = candidate.id;
      // isDeepStrictEqual, not JSON.stringify: string comparison would depend
      // on key order and would silently drop any key reconcileCartridge set to
      // undefined, which is exactly the kind of change this is here to notice.
      // node:util is fine in this file -- generate.js already reaches for
      // node:fs and is the Node-side half of this check for that reason.
      if (!isDeepStrictEqual(moved, before)) return false;
      // Still valid? Warnings are fine -- they do not stop a build -- and so
      // are errors this project already had before the switch was considered.
      // Counted, not a Set: two identical error texts collapse to one under
      // set membership, so a switch that added a *second* copy of an error the
      // project already had once would read as having introduced nothing.
      // Multiplicity is cheap to keep and the rule is "introduced no errors",
      // not "introduced no new kinds of error".
      //
      // No test covers this, and that is stated rather than left to be
      // discovered: no reachable case was found. Every mapper-dependent error
      // validateProject raises is gated on the board as a whole (the font
      // range, sprite $FD), so the count for a given text goes 0 -> n or
      // n -> 0, never 1 -> 2, and set membership and this agree on all of
      // those. It is kept because it is free and because the day a per-item
      // mapper-dependent rule appears, the Set version fails silently and in
      // the unsafe direction -- offering a board that breaks the project.
      const errorKey = (problem) => `${problem.where}: ${problem.message}`;
      const tally = (list) => {
        const counts = new Map();
        for (const problem of list) {
          if (problem.severity !== 'error') continue;
          const key = errorKey(problem);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return counts;
      };
      const existing = tally(validateProject(project));
      for (const [key, count] of tally(validateProject(moved))) {
        if (count > (existing.get(key) ?? 0)) return false;
      }
      // Still fits? Three banks, asked in the same terms checkCapacity asks.
      if (
        screenCapacityFor(
          candidate,
          moved.tilesets.length,
          bankedCode,
          flat,
          actorCount,
          reservesFlashSaveRegion(wantsSave, candidate)
        ) < flat.length
      ) {
        return false;
      }
      // The tileset ceiling checkCapacity enforces, which is NOT the one
      // reconcileCartridge applies: reconcile calls tilesetLimit without the
      // font-page term, so on MMC3 it will happily keep 32 tilesets that
      // checkCapacity then refuses because the split font costs a CHR page.
      // Losslessness therefore cannot stand in for this one.
      if (moved.tilesets.length > tilesetLimit(candidate, moved.cartridge, fontChrPages(moved, candidate))) {
        return false;
      }
      if (kernelCodeBytes(moved, candidate) + fixedBytes + tableBytes > BANK_SIZE) return false;
      // The one fit check a caller may waive, and only the caller that owns
      // this bank does. battleShortfallAdvice needs to tell "no board is safe
      // to switch to" apart from "safe boards exist, none has room" -- they
      // deserve different sentences, and with the check applied here both
      // arrive as an empty list. Every other caller keeps it, so a board that
      // fixed kernel-lo by overflowing the battle region is still never
      // offered.
      if (checkBattleRegion && bankedCode && battleRegionBytes(moved, candidate) > battleRegionCeiling(candidate)) {
        return false;
      }
      return true;
    });
}

/**
 * When a project's lookup tables do not fit alongside kernelCodeBytes's own
 * reservation, name what would actually close the gap instead of only
 * reporting the shortfall: dropping one active optional feature (Move, Turn,
 * Wait, Save), dropping the smallest combination of them that frees enough
 * when no single one does, or targeting another mapper that reserves less kernel
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
  const usesTurn = projectUsesTurn(project);
  const usesWait = projectUsesWait(project);
  const usesShake = projectUsesShake(project);
  const usesVisible = projectUsesVisible(project);
  const usesFade = projectUsesFade(project);
  // "Every" rather than "the": a project can carry more than one live Move or
  // Save command (several actors, several pages), and removing just one of
  // several does not free anything at all -- kernelCodeBytes only drops the
  // term once *no* live occurrence remains (projectUsesSave/projectUsesMove).
  const active = [];
  if (usesMove) active.push({ op: 'move', label: 'every Move command' });
  if (usesTurn) active.push({ op: 'turn', label: 'every Turn command' });
  if (usesWait) active.push({ op: 'wait', label: 'every Wait command' });
  if (usesShake) active.push({ op: 'shake', label: 'every Shake command' });
  if (usesVisible) active.push({ op: 'visible', label: 'every Show/Hide command' });
  if (usesFade) active.push({ op: 'fade', label: 'every Fade command' });
  if (usesSave) active.push({ op: 'save', label: 'every Save command' });
  // A title screen is not offered here even though it is now its own term in
  // kernelCodeBytes: this list is specifically "commands projectWithoutCommands
  // can switch off", and a title screen is content on a map, not a command --
  // there is no opcode to disable the way `move.off = true` disables a Move.
  // It would also be misleading advice on its own terms even if it could be
  // named: a project that reaches this function with a live Save command
  // cannot drop its title screen at all (validateProject refuses a Save with
  // no title screen), and "delete your title screen" is not a comparable
  // suggestion to "remove every Move command" for a project that has neither
  // -- it is the one piece of content on the whole map, not one command among
  // several. Left out on purpose, not missed.
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
  // mapper this project could still target reserves enough less kernel code
  // to fit. Which boards those are is switchableMappers below, shared with
  // the banked code region's own advice so the two cannot come to different
  // conclusions about whether a switch is safe.
  const alternative = switchableMappers(project, mapper)
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

/**
 * The kernel-lo bank's mapper-independent occupants: the fixed tables, and the
 * lookup tables this project's own content generates. Neither depends on the
 * cartridge, which is exactly why they are extracted -- switchableMappers has
 * to ask "would kernel-lo still fit on that board", and the only term that
 * changes across boards is kernelCodeBytes. Computing these twice, once here
 * and once there, is how the check that refuses a build and the advice about
 * how to fix it come to disagree about the same project.
 */
export function kernelTableBytes(project) {
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
  // item_metasprite, item_effect_kind, item_effect_amount (assets/items.inc)
  // -- one byte per item per table, gated the same way the code that reads
  // them is: a project with no items pays nothing, matching itemTables' own
  // "emit nothing at all when disabled" rule.
  const itemBytes = projectUsesItems(project) ? 3 * Math.max(1, (project.items ?? []).length) : 0;
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
  const tableBytes = 13 * flat.length + 9 * project.maps.length + spriteBytes + itemBytes;
  return { fixedBytes, tableBytes };
}

/** Capacity checks that must pass before the assembler is worth running. */
export function checkCapacity(project) {
  const text = compileText(project);
  const problems = [...validateProject(project), ...text.problems, ...checkBattleTables(project)];
  const { flat } = flattenScreens(project);

  const { fixedBytes, tableBytes } = kernelTableBytes(project);

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
  // The other bank with a budget: the switchable code region holding
  // engine/battle.asm and the tables battletables.js generates for it. Raised
  // here rather than inside checkBattleTables, which is otherwise the natural
  // home for a battle-system problem, because the two ask different kinds of
  // question. checkBattleTables asks whether the battle *data* is coherent --
  // nobody starts in the party, a spell learned past the level cap -- and
  // answers without knowing anything about the cartridge. This is capacity: it
  // needs the mapper, the region size and the layout, none of which that
  // function takes or should have to. Giving it a mapper argument to host one
  // piece of arithmetic would put capacity math in two files.
  //
  // Attributed to the Sprite Forge because that is where every input to these
  // tables is edited today -- monsters, spells and the party all live in
  // renderer/forges/sprite/battle.js. One input does not: “Highest level” is a
  // Build panel field, and one of the larger levers (five bytes per party
  // member per level), so battleShortfallAdvice names the panel explicitly
  // whenever lowering it is one of the fixes, rather than leaving `where` to
  // send the author to the wrong Forge for it. ATTRIBUTION
  // WILL HAVE TO WIDEN IN PHASE 5: item records land in this same region with
  // the Database Forge as their editing home, so once project.items exists
  // this `where` can no longer name one Forge for every input.
  if (bankedCode && !battleRegionPlacementOverridden(project)) {
    // Refuse only what is knowable. With the stock battle code the region's
    // contents are exact (see battleRegionBytes), so the whole figure is
    // checked. With a Code Forge override of battle.asm the base term is a
    // measurement of a file that is no longer being assembled -- and refusing
    // on it would do the very thing CLAUDE.md's rule against sizing
    // hand-written 6502 exists to prevent: turn away a project that fits,
    // because someone's smaller custom battle system was charged for the
    // engine's larger one. So an override project is checked against the one
    // bound that holds no matter what it assembles to: the generated tables
    // alone, which the override cannot shrink. Anything past that the
    // assembler answers, with the .fail after the include as the backstop.
    const overridden = battleCodeOverridden(project);
    const regionCeiling = battleRegionCeiling(mapper);
    // ...unless main.asm itself is overridden, in which case there is nothing
    // to check against. assets/code.inc -- the region's own .bank/.org, the
    // tables, the include of battle.asm and the end-of-region .fail -- reaches
    // the ROM only because main.asm includes it, so an overriding main may put
    // the tables somewhere else entirely. Refusing on "the tables alone do not
    // fit *this* region" would then turn away a project that fits fine. The
    // assembler is the only check left, and the .fail is not part of it either,
    // having gone with the include.
    const regionBytes = overridden ? battleTableBytes(project) : battleRegionBytes(project, mapper);
    if (regionBytes > regionCeiling) {
      problems.push({
        severity: 'error',
        where: 'Sprite Forge',
        message:
          (overridden
            ? `The battle system’s tables alone need ${regionBytes} bytes but its program bank holds ` +
              `${regionCeiling}, before this project’s own battle code is counted at all. `
            : `The battle system needs ${regionBytes} bytes but its program bank holds ${regionCeiling}. `) +
          battleShortfallAdvice(project, mapper, regionBytes - regionCeiling, {
            // checkBattleRegion: false -- this advice applies that test itself,
            // so it can distinguish a board with no room from no board at all.
            alternatives: switchableMappers(project, mapper, { checkBattleRegion: false }),
            exact: !overridden
          })
      });
    }
  }
  // The end-of-region guard's own blind spot, said out loud rather than left
  // for someone to discover in a corrupted ROM. A relocating override finishes
  // inside the region's bounds having written somewhere else entirely, and the
  // `.fail` -- which can only read the final location counter -- sees nothing.
  //
  // A warning, not an error, for two reasons that both matter: the arithmetic
  // above is still right (the tables are emitted from assets/battle.inc before
  // any override is reached), and the finding itself is lexical -- it says the
  // file's text contains something shaped like a relocation, not that the
  // token really is a directive, still less that it is ever assembled. A label
  // named `org`, a `.org` inside `.if 0` and nesasm's own `* .org` whole-line
  // comment all trip it while assembling perfectly legitimately.
  // battleRegionRelocates' own comment lists what it cannot see; the message
  // below says the same thing to the user, because a warning that sounds like
  // a verdict is worse than none.
  if (bankedCode && battleRegionRelocates(project)) {
    problems.push({
      severity: 'warning',
      where: 'Code Forge',
      message:
        'This project’s override of the battle system contains text that looks like a .bank or .org ' +
        'relocation, which if it is one may write outside its own program bank. Neither the capacity check ' +
        'nor the guard at the end of that bank can bound where those bytes land, and the assembler only ' +
        'objects if they land somewhere with no room for them. This is a read of the file’s text, not a ' +
        'check of the build: what it found may be a label or a comment rather than a directive, it does not ' +
        'know whether a real directive is ever assembled, and it cannot see a relocation reached through ' +
        '.include or produced by a macro at all.'
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
  // Whether the bag holds item ids or legacy actor ids for this build --
  // drives ITEMS_ENABLED, item_metasprite's emission, the pickup paths'
  // dual code, and item_chosen/draw_list_item_name's own dual reads.
  // Computed once here for the same drift-avoidance reason actorCount is.
  const itemsEnabled = projectUsesItems(project);
  const itemCount = project.items?.length ?? 0;

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
  const usesTurn = projectUsesTurn(project);
  const usesWait = projectUsesWait(project);
  const usesShake = projectUsesShake(project);
  const usesVisible = projectUsesVisible(project);
  const usesFade = projectUsesFade(project);
  const usesFace = projectUsesFace(project);
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
  // The region's assembler-side tripwire, for the one class of overrun the JS
  // side above cannot see and nesasm does not catch either.
  //
  // Be precise about what this does and does not cover, because a .fail that
  // cannot be reached is worse than none -- it reads as coverage. Three cases:
  //
  //  - The tables grow too big. checkCapacity refuses that above, exactly,
  //    before the assembler runs. That is the primary mechanism.
  //  - A Code Forge *override* of battle.asm is simply too big. nesasm's own
  //    per-byte bank check catches that first, at the instruction that crosses
  //    the boundary -- `Bank overflow, offset > $1FFF!` against battle.asm.
  //    Raw assembler output, but pointing at the file the user actually
  //    edited, and no check placed *after* the content can beat it to the
  //    punch. This guard is unreachable for that case, by construction.
  //  - An override that *relocates* -- its own `.bank`/`.org` -- and finishes
  //    outside the region. Nothing trips nesasm's per-byte check, because the
  //    bytes land in a bank with room for them. This is the case, and it is
  //    not hypothetical: verified by stripping this guard and running nesasm
  //    by hand, an override ending `.bank 1 / .org $A000` and an override
  //    ending `.bank 2 / .org $C000` both assemble with exit 0, no reported
  //    errors and a complete 163856-byte ROM -- battle code silently spliced
  //    over screen data in the first case and over the kernel in the second.
  //    The second is the backward-`.org` splice CLAUDE.md already documents as
  //    a real, empirically proven nesasm behaviour, the one engine/flash.asm
  //    is position-independent to avoid. With the guard, both are refused.
  //
  // So the condition is "did the location counter finish inside this region",
  // not "is the content too big" -- two one-directional comparisons, the same
  // shape and the same reason as engine/main.asm's flash guard: nesasm v3.1's
  // expression grammar is limited, and `>` with the constant on either side is
  // what it has been proved to accept.
  //
  // Be exact about the limits, because there are two and neither is closable
  // here. `.if` can see neither the current bank nor the assembler's history,
  // so this bounds where the region *ends up*, not where the assembler *went*:
  //
  //  - A relocation to the same address in a different bank (`.bank 5 /
  //    .org $8000`) lands back inside these bounds.
  //  - Worse, and confirmed on a real build: an override can relocate, emit
  //    bytes elsewhere, and RETURN before this runs. On UNROM 512, ending an
  //    override `.bank 0 / .org $8000 / .db $AA,$BB,$CC,$DD / .bank 1 /
  //    .org $B000` overwrites four bytes of the CHR payload already emitted at
  //    bank 0, finishes tidily inside the region, and ships the corruption in
  //    a ROM that assembled cleanly. The final counter is all this can read,
  //    and the final counter is fine.
  //
  // That second one is why checkCapacity warns separately whenever an override
  // of a battle-region source contains a `.bank` or `.org` at all
  // (battleRegionRelocates, main/build/battletables.js). A text scan is not a
  // guess about hand-written code the way sizing it would be, and a warning
  // costs nothing when it misfires. Neither mechanism turns this guard into a
  // complete one; together they mean nothing is claimed that is not true.
  //
  // Placed after both includes for the reason engine/main.asm's flash guard
  // spells out: a check sees only the counter's value at its own line, so it
  // has to sit after everything it bounds has already assembled.
  // `.include "battle.asm"` resolves to the override when there is one, so it
  // is the override this bounds.
  //
  // Emitted into this generated file rather than into engine/main.asm on
  // purpose, and it buys something: an override of a file the guard lived in
  // would take the guard away with it, and battle.asm -- the file most likely
  // to be overridden here -- is exactly such a file. assets/code.inc is
  // regenerated every build and cannot be overridden.
  //
  // It is NOT proof against an override of main.asm, and that is worth saying
  // rather than leaving implied: this file reaches the ROM only because
  // main.asm includes it, so a custom main that drops the include drops the
  // guard too. checkCapacity withdraws its own refusal in that case for the
  // same reason (see battleRegionPlacementOverridden), which leaves the
  // assembler alone -- the ordinary consequence of taking over the file that
  // decides the whole ROM layout.
  //
  // The bounds come from the region rather than from literals, because the org
  // is not a per-board constant at all: it is $8000 on MMC1 and MMC3, and on
  // UNROM 512 it depends on how many regions the CHR-RAM payloads took off the
  // front first -- $8000 when `max(1, tilesetCount)` is even and $A000 when it
  // is odd, the same parity rule the two-region note in CLAUDE.md turns on.
  // (An earlier version of this comment said flatly "$A000 on UNROM 512",
  // which is only what sample-rpg's own three tilesets happen to produce.)
  // Reading codeSlots[0].org is what makes the guard right on all of them. The upper
  // bound is the region's *true* end, deliberately not the JS budget's ceiling
  // (which holds BATTLE_SLACK back): a backstop that refused a build the
  // hardware would have accepted is a bug, and the slack exists so the JS
  // check speaks first, not so this one fires early.
  //
  // A tripped `.fail` prints an ordinary nesasm error block and then exits 0
  // -- the quirk main/build/nesasm.js already works around -- so
  // parseNesasmErrors picks it up by its `# N error(s)` count and reports it
  // against this file and this line, which is what puts the Build panel's deep
  // link on the comment above it.
  const codeFloor = codeSlots.length ? codeSlots[0].org : 0;
  const codeCeiling = codeFloor + NESASM_BANK_BYTES;
  const asHex = (value) => `$${value.toString(16).toUpperCase()}`;
  await fs.writeFile(
    path.join(assetsDir, 'code.inc'),
    codeSlots.length
      ? [
          '; Generated -- the switchable bank holding engine/battle.asm.',
          `  .bank ${codeSlots[0].nesasmBank}`,
          `  .org ${asHex(codeFloor)}`,
          '  .include "assets/battle.inc"',
          '  .include "battle.asm"',
          '; The battle system did not finish inside its own program bank. An',
          '; override of battle.asm in the Code Forge has relocated with its own',
          '; .bank/.org and left code somewhere it does not belong -- over screen',
          '; data, or over the engine kernel. Remove the relocation; $C000 is',
          '; mapped at all times, so a user routine never needs one.',
          `  .if * > ${asHex(codeCeiling)}`,
          '  .fail',
          '  .endif',
          `  .if ${asHex(codeFloor)} > *`,
          '  .fail',
          '  .endif',
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
  // projectUsesEffectiveTitle (shared/font.js) is the single writer for
  // this -- an earlier version of this line duplicated its own
  // mapBase[titleMap] !== undefined check inline instead of calling it,
  // reasoning that mapBase was already in hand from flattening a few lines
  // up so the duplicate cost nothing extra. That missed the actual point:
  // a second implementation of the same fact is exactly the drift this
  // codebase's single-writer rule exists to prevent, "costs nothing to
  // compute" notwithstanding.
  const titleEnabled = projectUsesEffectiveTitle(project);
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
    // restored inv_items entry against this, under `.if !ITEMS_ENABLED`,
    // before draw_actor_icon (engine/ui.asm) is allowed to index
    // actor_anim_dir with it. Stays live (not dead once ITEMS_ENABLED
    // exists) precisely because a project with no items[] still falls back
    // to this exact legacy check -- see shared/save.js's saveIdentity for
    // why the count is also folded into the save identity, not only checked
    // here.
    `NUM_ACTORS    = ${actorCount}`,
    // This build's own item catalogue size -- save_check_valid's enabled-path
    // bound (`.if ITEMS_ENABLED`), the sibling of NUM_ACTORS just above for
    // the same restored-inv_items-entry reason, once the bag holds item ids
    // rather than actor ids.
    `NUM_ITEMS     = ${itemCount}`,
    // Whether the bag holds item ids (draw_item_icon, add_item's NO_ITEM
    // guard, item_chosen/draw_list_item_name's enabled reads, and the save
    // bound above) or legacy actor ids. projectUsesItems (shared/project.js)
    // is the single writer; see its own docstring for why this is
    // `.length > 0` rather than "has at least one item that resolves".
    `ITEMS_ENABLED = ${itemsEnabled ? 1 : 0}`,
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
    // OP_TURN and OP_WAIT, the same shape as MOVE_ENABLED and each other --
    // see projectUsesTurn/projectUsesWait (shared/project.js). FACE_ENABLED
    // gates move_face (engine/entities.asm) on its own: both Move and Turn
    // call it, so it must assemble whenever either does and be charged
    // exactly once when both do.
    `TURN_ENABLED = ${usesTurn ? 1 : 0}`,
    `WAIT_ENABLED = ${usesWait ? 1 : 0}`,
    // OP_SHAKE, the same shape again -- see projectUsesShake (shared/project.js).
    // No companion *_ENABLED the way Turn has FACE_ENABLED: nothing else calls
    // into Shake's own code.
    `SHAKE_ENABLED = ${usesShake ? 1 : 0}`,
    // OP_VISIBLE, the same shape again -- see projectUsesVisible
    // (shared/project.js). No companion *_ENABLED: nothing else calls
    // script_op_visible or reads ENT_HIDDEN.
    `VISIBLE_ENABLED = ${usesVisible ? 1 : 0}`,
    // OP_FADE, the same shape again -- see projectUsesFade (shared/project.js).
    // No companion *_ENABLED: nothing else calls script_op_fade, fade_tick or
    // fade_apply_palette.
    `FADE_ENABLED = ${usesFade ? 1 : 0}`,
    `FACE_ENABLED = ${usesFace ? 1 : 0}`,
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
  await fs.writeFile(path.join(assetsDir, 'items.inc'), itemTables(project, itemsEnabled));

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
        project.maps.flatMap((map) => mapEncounterFormation(map, actorCount)),
        RPG_LIMITS.encounterActors
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
  // actorId -> item id, for a placed pickup entity's own record byte below.
  // Safe to build as a plain first-wins map: validateProject already refuses
  // a build where two items share an actorId (see its own "each item must
  // name a different actor" check), so this is 1:1 for any project that
  // reaches this function at all -- generateAssets calls checkCapacity
  // (which includes validateProject's errors) and throws before emission
  // ever starts.
  const itemIdForActor = new Map();
  if (itemsEnabled) {
    for (const item of project.items ?? []) {
      if (typeof item.actorId === 'number' && !itemIdForActor.has(item.actorId)) {
        itemIdForActor.set(item.actorId, item.id);
      }
    }
  }
  let droppedEntities = 0;
  const emitScreens = (from, to) => {
    const chunks = [
      '; Generated -- per screen: 240 metatile ids, 64 attribute bytes, then the',
      '; actor list as a count followed by (actor, x, y, door screen (or, for',
      '; a pickup actor under ITEMS_ENABLED, the item id it grants -- behavior',
      '; is exclusive, so the two meanings never collide), door x, door y,',
      '; event, trigger, hide switch).'
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
        // A pickup actor's own record byte is the item it grants under
        // ITEMS_ENABLED, not a door target -- and deliberately NOT run
        // through the door clamp below, which would silently corrupt an
        // item id above the screen count on any project with fewer than 255
        // screens (every real one). NO_ITEM for a pickup actor no item's
        // actorId names (see validateProject's own warning for this case).
        // Every other behaviour keeps today's door-target expression,
        // unchanged, entity_door being the field's only reader of it.
        const actor = project.sprites.actors[entity.actorId];
        const target =
          itemsEnabled && canBackItem(actor)
            ? itemIdForActor.get(entity.actorId) ?? NO_ITEM
            : Math.min(entity.props?.toScreen ?? 0, Math.max(0, flat.length - 1));
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
  // animFor is module-scoped (below spriteTables) rather than local to it --
  // resolveItemIcon needs the identical fallback chain to reproduce what
  // draw_actor_icon already draws for a migrated item's legacy icon, and a
  // second copy of this exact logic is the drift single-writer exists to
  // prevent.
  const animTable = list.flatMap((actor) => [
    animFor(actor, 'walkDown'),
    animFor(actor, 'walkUp'),
    animFor(actor, 'walkSide'),
    animFor(actor, 'walkSide')
  ]);
  chunks.push(`actor_anim_dir:\n${dbBlock(animTable, 4)}`);

  return `${chunks.join('\n')}\n`;
}

// A slot the Sprite Forge left empty falls back to the idle animation, and
// an actor with nothing at all is marked $FF so the engine draws nothing.
// Module-scoped: both spriteTables' own actor_anim_dir table and
// resolveItemIcon below (item.js) need the identical fallback chain --
// resolveItemIcon reproduces what draw_actor_icon already draws for a
// migrated item's legacy icon, so a second copy of this logic would be
// exactly the drift single-writer exists to prevent.
function animFor(actor, slot) {
  const value = actor.anims?.[slot];
  if (value !== null && value !== undefined) return value;
  const idle = actor.anims?.idle;
  return idle === null || idle === undefined ? 0xff : idle;
}

/**
 * item_metasprite[itemId] -- the icon draw_item_icon (engine/ui.asm) draws.
 * `item.metaspriteId`:
 *
 * - `NO_METASPRITE` ($FF): an author's explicit "no icon". Passed through.
 * - a real, in-range value: used as-is.
 * - an out-of-range value (a stale reference, or a hand-edited project):
 *   degraded to NO_METASPRITE rather than resurrected as "unset" -- doing
 *   the latter would silently reinterpret a broken explicit choice as
 *   "please derive one for me", which is a bigger behaviour change than
 *   refusing to draw a corrupt index. The same "a bad reference becomes
 *   nothing, not garbage" rule screenRecordBytes already applies to a stale
 *   entity.actorId.
 * - `null` (not set): derived from the backing actor's own resting frame,
 *   reproducing draw_actor_icon's *exact* runtime behaviour for a migrated
 *   item -- animFor's own idle/walkDown fallback, then frame 0 of whatever
 *   animation that resolves to. The one easy-to-miss case: an animation
 *   that exists but has zero frames is explicitly permitted (the Sprite
 *   Forge allows it, and spriteTables emits a one-byte `.db $00` stub for
 *   it), and draw_actor_icon dereferences that stub as if it were real
 *   frame data -- drawing metasprite 0, not nothing. This function
 *   reproduces that exactly (`frames.length ? frames[0].metaspriteId : 0`),
 *   not the more intuitive but wrong "no frames means no icon".
 */
export function resolveItemIcon(item, actor, animations, metasprites) {
  // Round 5 had a defensive `Math.min(metasprites.length, LIMITS.metasprites)`
  // ceiling here, on the reasoning that buildProject compiles the project the
  // app is holding rather than one that has passed validateProject. Round 6
  // sabotage-testing found that reasoning does not hold for THIS function:
  // metaspriteId is a byte (0-255), so the only value the clamp could ever
  // treat differently from a plain `< metasprites.length` bound is 255 --
  // and 255 is NO_METASPRITE's own value, so both branches return the
  // identical byte either way. There is no input this clamp changes the
  // output for; it read as protection while protecting nothing, which is
  // worse than no code at all. Removed rather than kept as inert ceremony.
  //
  // The real guarantee that a *real* metasprite id here is never 255 is
  // LIMITS.metasprites (shared/project.js) plus validateProject's own
  // over-cap refusal, upstream of this function entirely -- a project that
  // reaches generation has already been refused if it could produce the
  // ambiguity. This function needs no bound of its own to enforce that; it
  // would be redundant even if it could distinguish the values, which it
  // provably cannot.
  if (item.metaspriteId === NO_METASPRITE) return NO_METASPRITE;
  if (item.metaspriteId !== null) {
    return item.metaspriteId < metasprites.length ? item.metaspriteId : NO_METASPRITE;
  }
  if (!actor) return NO_METASPRITE; // no backing actor at all -- nothing to derive from
  const animId = animFor(actor, 'walkDown');
  if (animId === 0xff) return NO_METASPRITE;
  const frames = animations[animId]?.frames ?? [];
  return frames.length ? frames[0].metaspriteId : 0;
}

/**
 * `assets/items.inc`: the ITEMS_ENABLED-only kernel-lo table an item's icon
 * comes from. Its own file (not folded into spriteTables' sprites.inc)
 * because items are `project.items`, not `project.sprites` -- keeping the
 * two apart is what keeps spriteTables itself scoped to what its own name
 * says. Included in main.asm right after sprites.inc, the same kernel-lo
 * region every other lookup table already lives in.
 *
 * Emits nothing (not even a stub) when `enabled` is false: a project with no
 * items pays zero bytes for this table, and nothing downstream references
 * item_metasprite in that build at all (draw_menu's own `.if ITEMS_ENABLED`
 * dual path never reads it) -- see kernelTableBytes' matching charge.
 */
// item_effect_kind's own index into ITEM_EFFECT_KINDS -- the JS-side order
// EFFECT_NONE/EFFECT_HEAL/EFFECT_DAMAGE (engine/constants.asm) is that same
// order written down by hand, the identical relationship BEHAVIORS/ACTIONS
// already have with BEH_*/ACT_*. A kind's number is spelled in exactly one
// of those two places -- here, deriving it, never as a literal alongside it.
const effectKindIndex = (kind) => Math.max(0, ITEM_EFFECT_KINDS.findIndex((entry) => entry.id === kind));

function itemTables(project, enabled) {
  if (!enabled) return '; Generated -- ITEMS_ENABLED is off; nothing to emit.\n';
  const { actors, metasprites, animations } = project.sprites;
  const items = project.items ?? [];
  const chunks = ['; Generated -- item lookup tables (kernel-lo, ITEMS_ENABLED only).'];
  chunks.push(
    `item_metasprite:\n${dbBlock(
      items.map((item) => resolveItemIcon(item, actors[item.actorId], animations, metasprites))
    )}`
  );
  // use_item_apply's own two tables (engine/ui.asm) -- kind and amount kept
  // separate rather than packed, matching how every other per-item table
  // here is one byte per item, one concept per table.
  chunks.push(`item_effect_kind:\n${dbBlock(items.map((item) => effectKindIndex(item.effect?.kind)))}`);
  chunks.push(`item_effect_amount:\n${dbBlock(items.map((item) => item.effect?.amount ?? 0))}`);
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
