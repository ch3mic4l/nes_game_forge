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
import { encodeTiles, tileFromString, BLANK_TILE, isBlank } from '../../shared/chr.js';
import { normalizeSong, MAX_TOTAL_INSTRUMENTS } from '../../shared/audio.js';
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
  MISS_TILE_M,
  MISS_TILE_I,
  MISS_TILE_S,
  MISS_TILE_M_ART,
  MISS_TILE_I_ART,
  MISS_TILE_S_ART,
  TILE_SPACE,
  fontBankSplit,
  fontChrPages,
  projectUsesCombat,
  projectUsesHeartArt,
  projectUsesText,
  projectUsesEffectiveTitle
} from '../../shared/font.js';
import { songTables, songTableBytes, compileSfx, sfxTables } from './songcompile.js';
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
  checkBattleTables,
  nameTiles
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
  projectUsesCamera,
  projectWithoutCamera,
  projectUsesVisible,
  projectUsesFade,
  projectUsesFlash,
  projectUsesPaletteFx,
  projectUsesFace,
  projectUsesItems,
  projectUsesMagicPower,
  projectUsesMagicDefence,
  projectUsesMonsterSpellList,
  projectUsesAnyBattleAnimation,
  projectUsesPartyAttackAnim,
  projectUsesHitFeedback,
  projectUsesMiss,
  MISS_OAM_TILES,
  battleCombatantOamMax,
  battleFxOamRoom,
  MAX_OAM_ENTRIES,
  projectUsesSting,
  projectUsesSfx,
  projectUsesAudioFx,
  projectUsesBoundTiles,
  projectEvents,
  allCommands,
  mapEncounterFormation,
  itemMissing,
  canBackItem,
  ITEM_EFFECT_KINDS,
  NO_ITEM,
  PLAYER_FRAMES,
  PLAYER_TILES,
  animFor,
  resolveItemIcon,
  metaspriteKernelBytes,
  projectUsesHeroNaming,
  projectUsesJoinNaming,
  projectUsesNameEntry,
  projectUsesNameToken,
  battleBankEnabled,
  projectWithoutHeroNaming,
  projectWithoutJoinNaming,
  projectWithoutNameToken,
  projectNeedsHeroDefault,
  projectNeedsNameSeed,
  streamedBoardProblems
} from '../../shared/project.js';
import {
  streamRegionsPerRow,
  mapTypeTableBytes,
  STREAM_RECORD_BYTES,
  STREAM_OFFSETS,
  STREAM_TERRAIN_BYTES,
  STREAM_HIGH_PAGE,
  STREAM_SCREENS_PER_REGION,
  STREAM_MAP_COLUMNS,
  STREAM_MAP_COLUMN_BYTES,
  STREAM_ENTITY_RECORD,
  STREAM_BOUND_RECORD,
  projectUsesStreaming
} from '../../shared/streamlayout.js';
import { emitStreamedLayout } from './streamed.js';
import { SAVE_FIELDS, saveBodySize, saveIdentity } from '../../shared/save.js';
import {
  CHR_BANK_BYTES,
  NESASM_BANK_BYTES,
  PRG_SWITCH,
  SCREEN_REGION_BYTES,
  SUPPORTED_MAPPERS,
  cameraAxes,
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

/**
 * How many instrument entries every song in the project contributes,
 * combined -- item 12: songTables (main/build/songcompile.js) concatenates
 * every song's own instruments into one flat set rather than only song 0's,
 * so this is the real total the flat inst_* tables and song_inst_base will
 * hold, not one song's count standing in for the whole project. A project
 * with no songs still gets the one SILENT instrument songTables emits for
 * it.
 */
function totalInstrumentCount(songs) {
  const list = songs?.length ? songs : [];
  if (!list.length) return 1; // SILENT's own single instrument
  return list.reduce((total, song) => total + (normalizeSong(song).instruments.length || 1), 0);
}

/**
 * Bytes the compiled music will occupy: period table, instruments and
 * streams. Review-fixes slice C round 2, finding 2: measures songTables'
 * own real emitted output (songTableBytes, main/build/songcompile.js)
 * rather than a hand-maintained formula -- the same "derive the figure from
 * the code path that actually emits it" discipline battleTableBytes already
 * holds battleTables to, so this and songTables cannot drift apart. The old
 * formula charged a flat 32 bytes for every instrument's own envelope
 * regardless of its real length (up to 16 steps each), which could
 * undercount a project with several large-envelope instruments by
 * thousands of bytes and let checkCapacity pass a project the assembler
 * then refused.
 */
function musicSize(songs) {
  return songTableBytes(songs);
}

/** Bytes the compiled sound effects will occupy: each effect's own compiled stream plus the one
 *  2-byte pointer-table entry it owns. Unconditional -- an authored, unreferenced effect still
 *  compiles, mirroring musicSize's own identical, pre-existing behavior for songs. See
 *  design-sfx.md §3.10. */
function sfxSize(sfxList) {
  const list = sfxList?.length ? sfxList : [];
  return list.reduce((total, sfx) => total + compileSfx(sfx).bytes.length + 2, 0);
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
// nesasm's kernel-lo usage minus that build's own fixedBytes + tableBytes --
// **except BASE_KERNEL_CODE_BYTES_BY_MAPPER itself, which is measured
// against `sample` (the action fixture) instead; see its own paragraph for
// why, and BATTLE_KERNEL_ALLOWANCE_BY_MAPPER right after it for the
// RPG-only remainder that split out of it.**
//
// BASE_KERNEL_CODE_BYTES_BY_MAPPER is the worst case with nothing
// conditional turned on -- no title screen, no Save, no Move, no text on a
// split-font board -- measured per mapper rather than once, and, since
// `docs/kernel-base-overcharge-report.md`, against `sample` rather than
// `sample-rpg`. A single flat number, measured on UNROM 512 because
// banks.asm emits the most code for it, used to be charged to every board;
// MMC3's own switch_chr_bank/switch_prg_bank pair is smaller, so that
// overcharged every MMC3 project by 8 bytes, and MMC1's by 195 -- both
// boards forced to carry UNROM 512's own combined PRG/CHR register
// plumbing, which neither of them has. That per-mapper split fixed the
// wrong-board defect but not the wrong-*game-type* one sitting right next
// to it: for as long as this table was measured only against `sample-rpg`,
// it was a `BATTLE_ENABLED` figure -- the size of the kernel *with* the
// RPG-only code eight other kernel files gate on that flag -- charged in
// full to action projects too, a 270/282-byte overcharge with nothing to
// catch it (every existing action-side check in this file is a *delta*
// between two action builds, which cancels a wrong base out; see
// `docs/kernel-base-overcharge-report.md` for the full account, now
// resolved by this change).
//
// Re-measured against `sample`, title off, nothing else conditional, on all
// three RPG-capable boards (rpgCapable() in shared/cartridge.js -- the same
// three test/unit/kernelbytes.test.js already builds for this term) -- not
// because the action fixture itself needs a mapper that switches PRG and
// CHR (it does not; measureFallbackCodeBytes, same file, builds `sample` on
// all five fallback boards too), but because BATTLE_KERNEL_ALLOWANCE_BY_MAPPER
// right after it is the *paired* action-versus-RPG residual, and only these
// three boards can build both fixtures to take that residual from:
//   MMC1: 6033   MMC3: 6215   UNROM 512: 6228
// -- nesasm's own real usage, default item included (`sample` carries one,
// same as `sample-rpg`; ITEM_KERNEL_ALLOWANCE + ITEM_EFFECT_KERNEL_ALLOWANCE_
// BY_GAME_TYPE.action's own 79 bytes are still owed on top of whatever this
// table holds, the same as ever -- this paragraph's own figures are the raw
// build, not what BASE_KERNEL_CODE_BYTES_BY_MAPPER is set to). MMC3 also
// shows text unconditionally on `sample` (it has real dialogue, so
// projectUsesText is true regardless of game type), so its own raw figure
// already has SPLIT_KERNEL_ALLOWANCE's bytes baked in, the identical
// bookkeeping the RPG-side measurement already needed. Subtracting the
// item allowance (and, on MMC3, the split allowance) from each raw
// figure gives the table's own values below: `{1: 5954, 4: 5971,
// 30: 6149}`. MMC3's own entry moved a second time after this passage was
// first written: the 6117 it originally landed on (6215-79-19, and
// cross-checked against `docs/kernel-base-overcharge-report.md` §6's own
// 6379-262) subtracted `SPLIT_KERNEL_ALLOWANCE`'s own then-measured value,
// 19 -- which `docs/split-lock-not-pinned-report.md` found was never
// actually isolated, and `handoff-magic/brief-split-term-1.md` then
// re-measured at 165 (a fresh action project, text on vs. off, real nesasm
// builds -- see that term's own declaration for the full account). 6215
// still real, still nesasm's own output; only which subtrahend it is split
// against changed. The other two boards are untouched by this correction --
// neither has a scanline IRQ, so `SPLIT_KERNEL_ALLOWANCE` was always 0 for
// them regardless of what its own figure was.
// Every other supported mapper -- NROM, CNROM, GxROM, Color Dreams, UxROM --
// cannot build an RPG at all, so `sample-rpg` was never buildable on them and
// the paired action-versus-RPG residual above cannot be derived for any of
// them. The action fixture's own base is not unmeasurable there, though: it
// builds fine on all five (measureFallbackCodeBytes, same file), which is
// exactly what lets that same test confirm the fallback below still covers
// each one. baseKernelCodeBytes() falls back to the largest of the three
// figures above for a mapper this table has no entry for regardless, which is
// not a guess standing in for a measurement -- it is the same shape this
// function has always used for an unmeasured board, so a project on one of
// those five still reserves a safe over-estimate rather than nothing. This
// fallback stays a *base*-shaped one (largest-of-three, not "fail loudly")
// deliberately: unlike the two BATTLE_ENABLED-gated terms below, which can
// only ever be indexed for a real, registered rpgCapable() mapper (see
// their own fallback paragraphs), the base is charged to *every* project on
// *every* board, including the five that can never be RPG-capable at all --
// an unmeasured board among those five still needs a safe number here, or
// checkCapacity would compute NaN for a project that never touched
// anything conditional.
// codebuild.test.js's byte-identical NROM build depends on this fallback
// staying a safe over-estimate (it changed value, from 6678 to 6466, the
// day the title term below was carved out of it, and again with this
// change -- see that term's own paragraph for why NROM's own byte-identical
// build is unaffected either time: NROM's build carries no title screen and
// is never an RPG, so nothing here changes what it emits).
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
// neither board ever sets it -- a claim this file used to make right beside
// a 19-byte SPLIT_KERNEL_ALLOWANCE without ever noticing the two disagreed:
// an entire file's worth of split machinery, contradicted by a term sized
// for one thirteen-byte critical section inside it. See that term's own
// declaration for the corrected figure and where the other 146 bytes had
// been hiding. engine/title.asm itself has no MMC3-specific
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
// SAVE_KERNEL_ALLOWANCE_BY_MAPPER + SAVE_BATTLE_KERNEL_ALLOWANCE together are
// the extra a board pays only when save/load itself assembles, derived per
// board from the difference save/load actually measures on the two boards
// that can build it at all -- not guessed, and not the larger of the two
// charged to both the way it used to be, now that a per-mapper base makes a
// per-mapper allowance the same kind of number: MMC1 goes from 6483 to 7030
// (+547), MMC3 from 6689 to 7241 (+552, text always on for an RPG on a
// split-font board -- see SPLIT_KERNEL_ALLOWANCE below). Both sides of
// that subtraction carry a title screen (validateProject refuses a live Save
// with no title screen — "Continue has nowhere to appear without one" — so a
// project that pays this always pays TITLE_KERNEL_ALLOWANCE too), which is
// exactly why splitting the title cost out of the base above left this
// delta unchanged: 6483 and 7030 are both title-on figures, so the 547
// between them is the cost of save/load alone, with title's own cost
// present -- and cancelling out -- on both sides. Re-measured directly
// against the new title-off base after the split (title forced on for both
// the with-Save and without-Save sides, kernelbytes.test.js's own
// `measureCodeBytes(..., { withTitle: true })`) rather than assumed: still
// 547/552/719, to the byte -- the RPG total as it stood before `BE_RESTORE`
// (Magic Forge phase 4, below) added its own call site; see that paragraph
// for the post-`BE_RESTORE` figures. (This grew from an earlier +453/+458
// once a review pass range-checked every restored value load_apply_body
// trusts as a table index -- player_dir, player_y, each live inv_items
// entry, each pc_level -- and widened the identity from two bytes to four;
// then from +526/+531 once a further pass added the pc_in_party bound and
// the jmp relay save_check_valid's own branch-range fix needed once that
// bound pushed save_check_invalid out of a bne's reach -- see
// engine/save.asm's own header comment and shared/save.js's saveIdentity()
// for what each of those costs and why. This figure's own history is why a
// passing kernelbytes.test.js run is not the same as having re-measured it:
// the allowance drifted one round behind reality -- 531 recorded while the
// real delta had already grown to 552 -- and the test still passed, because
// 531 still covered 552's own shortfall against a much looser bound than the
// one below. Caught only by re-running the real measurement by hand and
// diffing it against this comment's claim, not by the test going green.)
//
// That 547/552/719 figure is the RPG *total* -- what an RPG project on each
// board actually pays for save/load -- and it used to be
// SAVE_KERNEL_ALLOWANCE_BY_MAPPER's own value directly. It no longer is.
// save_check_valid (engine/save.asm) wraps its own pc_level range check and
// its pc_in_party-vs-PARTY_SIZE check in `.if BATTLE_ENABLED` -- the *only*
// game-type-varying code anywhere in the Save path (grepped: the sole
// `.if BATTLE_ENABLED` in that file) -- so an action project's real Save
// cost is smaller than an RPG's, on every board, and by the same amount:
// measured directly (build `sample` and `sample-rpg`, each with a live Save
// command and nothing else, on all three boards, title-on baseline
// subtracted out on both sides the identical way the paragraph above
// already does) gives 511/516/683 for action, 547/552/719 for RPG -- a flat
// 36-byte gap on every board. `SAVE_KERNEL_ALLOWANCE_BY_MAPPER` now holds
// the smaller, action-side figure -- the cost of the Save code every
// save-capable board assembles regardless of game type -- and
// `SAVE_BATTLE_KERNEL_ALLOWANCE` (below) is the RPG-only supplement
// `kernelCodeBytes` adds on top to reach the same 547/552/719 total for an
// RPG. Before this split, an action project with a live Save was overcharged
// by 36 bytes on every board -- a real, measurable violation of this file's
// own "a conditional feature's cost is a separate generated allowance,
// never folded into a base" rule (CLAUDE.md, "The kernel budget"), caught
// only once someone actually measured Save's cost against `sample` rather
// than only ever against `sample-rpg`, the way every measurement above this
// line always had been.
//
// Magic Forge phase 4 (`BE_RESTORE`, handoff-magic/phase4-design.md) grew
// that RPG-only supplement again, from 36 to 41: `continue_game`
// (engine/save.asm) now calls `call_battle` once more, right after
// `load_apply_body`, to recompute every party member's `pc_spells` (and, as
// an accepted side effect, `pc_hp_max`/`pc_mp_max`) from their restored
// level against the *current* build's own tables -- a save's raw
// `pc_spells` byte is a bitmask of catalog positions a spell delete since
// the save was written can retarget, so it is never trusted directly (see
// `party_restore`'s own comment, engine/battle.asm, for the full account).
// That call site is itself `.if BATTLE_ENABLED`-gated, for the same reason
// the range-check block below is: `call_battle` does not assemble outside
// an RPG at all. Measured once the routine was actually written, not
// estimated: the RPG total moves from 547/552/719 to 552/557/724 -- a
// uniform +5 on every board, the same flatness the range-check block's own
// gap already has, since the call site is a plain two-instruction `jsr`
// with nothing mapper-specific in it.
//
// SAVE_BATTLE_KERNEL_ALLOWANCE is that RPG-only supplement, and it is a flat
// constant, not `*_BY_MAPPER`, on purpose: a term earns per-mapper treatment
// only once real variance between boards is measured (the same standard the
// title paragraph above already holds itself to, in the opposite direction —
// MMC3's own extra 12 bytes there is exactly the kind of measured difference
// that earns a `*_BY_MAPPER` shape), and there is none here to earn it. The
// 41-byte gap (36 from the pre-existing range-check block, 5 from
// `BE_RESTORE`'s own call site) is identical on MMC1, MMC3 and UNROM 512 --
// three boards whose own `SAVE_KERNEL_ALLOWANCE_BY_MAPPER` figures differ by
// hundreds of bytes from each other -- because neither piece has any
// mapper-specific instruction in it: no register layout, no bank-switch
// shape, nothing that reads differently on a board whose Save medium is
// battery-WRAM versus one whose medium is a flash driver. `test/unit/
// kernelbytes.test.js` equality-asserts this figure
// on all three boards independently (not merely once and assumed to
// generalize), specifically to keep the flatness a measured claim rather
// than a structural assumption -- if a future change to save_check_valid
// ever makes this block's own size depend on the mapper, the test that
// would catch it is already in place, and this constant becomes
// `*_BY_MAPPER` at that point, on real evidence, the same way every other
// term in this file already earned its own shape.
//
// Name entry phase 1 (docs/design-name-entry.md §2/§10) moved
// SAVE_KERNEL_ALLOWANCE_BY_MAPPER again, uniformly this time (not
// BASE_KERNEL_CODE_BYTES_BY_MAPPER, below -- this term alone): SAVE_FIELDS
// gained pc_name_ram, unconditional on any naming code existing, which grows
// save_field_lo/hi/len (assets/save.inc) by 3 real bytes on every
// save-capable board regardless of game type or naming --
// 511/516/683 -> 514/519/686. SAVE_BATTLE_KERNEL_ALLOWANCE is untouched (no
// BATTLE_ENABLED branch reads pc_name_ram), so the RPG total moves by the
// identical +3: 552/557/724 -> 555/560/727.
//
// Declared below, beside
// `SAVE_KERNEL_ALLOWANCE_BY_MAPPER` itself, not here -- this whole comment
// block is prose introducing every term before any of their real
// declarations begin (see BASE_KERNEL_CODE_BYTES_BY_MAPPER's own export a
// little further down), and the two Save terms' declarations stay adjacent
// to each other the way the rest of this file already keeps a term's
// declaration next to its own explanatory comment.
//
// SPLIT_KERNEL_ALLOWANCE is a third term, MMC3-only and conditional the
// same way, and it stays a separate term rather than folding into MMC3's own
// base: the entire font-bank split machinery -- engine/split.asm's whole
// body (`.if SPLIT_ENABLED` wraps the file end to end: the split programs,
// split_select, split_arm, the IRQ handler), the `.if SPLIT_ENABLED` blocks
// in engine/boot.asm (three) and engine/screens.asm (one), and
// engine/banks.asm's own two (the chr_r1 shadow switch_chr_bank keeps, and
// switch_prg_bank's critical section against the call_battle interrupt race
// -- split_lock in engine/constants.asm, which is the one piece this term
// used to be named for) -- assembles only under that same flag, so only a
// project that shows text on MMC3 (fontBankSplit) pays any of it. Renamed
// from SPLIT_LOCK_KERNEL_ALLOWANCE (handoff-magic/brief-split-term-1.md,
// docs/split-lock-not-pinned-report.md §8) once a real text-on/text-off
// isolation on a fresh action project measured the true cost at 165 bytes,
// not the 19 the old name and figure both implied: `split_lock`'s own
// critical section is a genuinely small part of a much larger whole, and the
// old figure had only ever been checked against residuals that already
// contained the rest of that whole baked into other terms -- see
// BASE_KERNEL_CODE_BYTES_BY_MAPPER's own comment above for exactly where the
// other 146 bytes had been hiding. Every RPG shows text unconditionally
// (projectUsesText returns true for the game type alone, battle messages
// included), so this is really "every RPG on MMC3" rather than a case that
// has to be sought out -- MMC3's own SAVE_ENABLED-off figure above (6689)
// already has it baked in; the per-mapper base does not, or an *action*
// project on MMC3 with no text would be overcharged for a fix its own ROM
// cannot contain. This is the same reasoning SAVE_KERNEL_ALLOWANCE_BY_MAPPER
// above and MOVE_KERNEL_ALLOWANCE below are already built on, applied to a
// fix instead of a feature -- and it is what "per-mapper base" does not
// subsume: a base is a property of the board, this is a property of the
// board *and* whether the project shows text, so it cannot become one more
// row in the base table without overcharging every text-free MMC3 project.
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
// alone, not gated by MOVE_ENABLED/TURN_ENABLED), so this was folded into
// the base below as "a cost every RPG project pays, not a new named
// allowance term" -- **correction, `docs/kernel-base-overcharge-report.md`:
// "unconditional whenever BATTLE_ENABLED" and "belongs in the shared base"
// are different claims, and this +3 is exactly an instance of the first
// without the second -- rpg.asm assembles only under BATTLE_ENABLED at all,
// so this is RPG-only code, the identical shape of byte
// BATTLE_KERNEL_ALLOWANCE_BY_MAPPER (below) now exists to hold instead of
// the base. The figure this note is attached to (`{30: 6399, 1: 6204,
// 4: 6379}`) was measured against `sample-rpg` and included this +3 as part
// of the base; re-measuring against `sample` (the action fixture) moved it,
// along with every other RPG-only byte in this figure, out into the new
// term below.**
// +15 on each board, review-fixes slice C, item 12: music_play now looks up
// song_inst_base and seeds mus_inst_base before initializing every channel's
// own mus_inst,x from it (8 bytes), each channel's own init trades one
// shared zero-store for a dedicated mus_inst_base copy (+3 bytes), and the
// $F0-$F7 instrument-select handler in music_read_event adds mus_inst_base
// onto the stream's local 0-7 select rather than storing it verbatim (+4
// bytes) -- unconditional kernel code (music.asm is never gated out), so
// this is a cost every project pays, folded into the base like the +3 above
// it. See mus_inst_base's own comment in engine/constants.asm.
// NROM (0) added by docs/design-name-entry.md §11's own "durable fix": NROM
// is the one board where action-side hero naming actually fits a real
// fixture (sample), so an unmeasured base there -- previously falling back
// to UNROM 512's own 6217, always the largest of the three RPG-capable
// boards' figures -- was exactly the game-type/board blind spot this
// ledger's own discipline warns about. Measured the identical way the other
// three are (title off, sample's own default item kept and its 79-byte
// ITEM_KERNEL_ALLOWANCE + ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE.action
// subtracted back out): 6031 - 79 = 5952.
// Re-measured for the zero-page kernel diet (docs/design-kernel-diet.md):
// every board's own kernel-lo code shrank once every bare zero-page operand
// carries nesasm's `<` zero-page-addressing prefix instead of assembling
// absolute. Historical figures above stay as history; current measured
// values: { 0: 5367, 1: 5428, 4: 5449, 30: 5617 }.
export const BASE_KERNEL_CODE_BYTES_BY_MAPPER = { 0: 5367, 1: 5428, 4: 5449, 30: 5617 };
const FALLBACK_BASE_KERNEL_CODE_BYTES = Math.max(...Object.values(BASE_KERNEL_CODE_BYTES_BY_MAPPER));
export function baseKernelCodeBytes(mapper) {
  return BASE_KERNEL_CODE_BYTES_BY_MAPPER[mapper.id] ?? FALLBACK_BASE_KERNEL_CODE_BYTES;
}

// BATTLE_KERNEL_ALLOWANCE_BY_MAPPER is the RPG-only remainder
// BASE_KERNEL_CODE_BYTES_BY_MAPPER gave up moving from sample-rpg to
// sample: every byte outside save_check_valid (SAVE_BATTLE_KERNEL_ALLOWANCE
// already owns that one) that eight kernel files -- player.asm, boot.asm,
// combat.asm, save.asm, rpg.asm, banks.asm, script.asm, ui.asm, plus
// split.asm on MMC3 -- assemble only under `.if BATTLE_ENABLED` (in both
// directions: an RPG assembles party/battle code an action project does
// not, and an action project assembles its own hearts/knockback code an
// RPG does not, so this is a genuine two-sided swap, not one side's code
// simply vanishing). Charged as the *excess* of the old, sample-rpg-measured
// base over its own real usage past KERNEL_SLACK -- 6204-5954=250 (MMC1),
// 6379-6117=262 (MMC3), 6399-6149=250 (UNROM 512) -- because that excess is,
// by construction, exactly the RPG-only byte count the old base was silently
// carrying: handing it back as its own term is what restores the RPG side's
// original reservation (and its original KERNEL_SLACK margin) to the byte,
// while the new, smaller base finally reserves what an action project's own
// build actually needs. Those three figures (250/262/250) were the
// extraction-era measurement; the encounter-roll fix (`inc bt_tmp2`,
// engine/rpg.asm, unconditional on every RPG build, absolute-addressed so 3
// bytes) raised each entry by three, to 253/265/253.
// `*_BY_MAPPER`, not flat like SAVE_BATTLE_KERNEL_ALLOWANCE: MMC3 genuinely
// differs from the other two by 12 bytes, measured and identified rather
// than left as noise -- split_select's own `.if BATTLE_ENABLED` arm
// (engine/split.asm), five instructions (`lda`/`cmp`/`bne`/`lda`/`jmp`,
// 3+2+2+2+3) that only a split-font board assembles, entirely separate from
// the `.if TITLE_ENABLED` arm right above it in the same routine that
// TITLE_KERNEL_ALLOWANCE_BY_MAPPER's own MMC3 entry already charges for.
// This is the ledger's own rule working as designed, not a coincidence: a
// term stays flat until real variance is measured (SAVE_BATTLE_KERNEL_
// ALLOWANCE, above), and earns `*_BY_MAPPER` the moment it is (this term,
// TITLE_KERNEL_ALLOWANCE_BY_MAPPER, the base).
// No fallback -- `BASE_KERNEL_CODE_BYTES_BY_MAPPER`'s own `?? FALLBACK_...`
// is not copied by reflex. The base needs one because it is charged to
// *every* project on *every* board, RPG-capable or not; this term is only
// ever read when `battleEnabled` is true (kernelCodeBytes, below). Round 1
// argued that condition can only hold for a real, registered rpgCapable()
// mapper, on the strength of reconcileCartridge forcing `gameType === 'rpg'`
// to imply `rpgCapable(mapper)` -- but reconcileCartridge runs on an *edit*,
// not on every read: normalizeProject deliberately does not call it, and
// checkCapacity (below) resolves `project.cartridge.mapper` directly with no
// reconciling step of its own, so a hand-edited or older-version RPG project
// carrying a non-rpgCapable mapper (UxROM, mapper 2 -- switchable PRG with no
// switchable CHR, so `codeRegions(...).length > 0` while `rpgCapable` is
// false) reaches this term with no entry to find. Indexing straight into the
// table there produces `undefined`, then a `NaN` kernel-lo budget that
// silently passes `checkCapacity`'s own `kernelFree < 0` check -- the bug a
// review round found and this comment used to (wrongly) argue could not
// happen. Guarded for real now, three ways: `battleKernelAllowance(mapper)`
// (below) is the only reader of this table and throws instead of returning
// `undefined` when an entry is missing; `checkCapacity` checks
// `battleEnabledFor(project, mapper) && !hasBattleKernelAllowance(mapper)`
// for the project's own (unreconciled) mapper *before* ever calling it, and
// reports a named `problems` entry instead of computing a broken budget; and
// `switchableMappers` (below) never offers a *candidate* mapper that would
// hit the throw, on top of its existing `rpgCapable(candidate)` filter. A
// new RPG-capable mapper added to the registry without a measured entry here
// therefore still fails loudly -- via the throw, not via `NaN` -- for any
// caller that does not pre-check, which is the same "a newly implemented
// board with no measured entry must fail loudly" rule the Save table's own
// comment argues, now actually enforced rather than assumed unreachable.
// Re-measured for the zero-page kernel diet (docs/design-kernel-diet.md):
// { 1: 229, 4: 240, 30: 229 } -- MMC3's own gap over the other two boards is
// 11 bytes now, 12 before the diet (240-229=11, was 265-253=12): still
// traces to the identical split_select `.if BATTLE_ENABLED` arm; the arm
// itself shrank by one byte under the diet, not the gap's own cause.
export const BATTLE_KERNEL_ALLOWANCE_BY_MAPPER = { 1: 229, 4: 240, 30: 229 };

/** Whether `battleKernelAllowance` has a real, measured entry for `mapper`. */
export function hasBattleKernelAllowance(mapper) {
  return mapper.id in BATTLE_KERNEL_ALLOWANCE_BY_MAPPER;
}

// The single reader of BATTLE_KERNEL_ALLOWANCE_BY_MAPPER -- kernelCodeBytes
// (below) calls this rather than indexing the table directly, so a missing
// entry cannot silently become `undefined`-then-`NaN` again by a future edit
// that reaches for the table's own bracket syntax instead of this function.
export function battleKernelAllowance(mapper) {
  if (!hasBattleKernelAllowance(mapper)) {
    throw new Error(
      `BATTLE_KERNEL_ALLOWANCE_BY_MAPPER has no measured entry for ${mapper.name} (mapper ${mapper.id}). ` +
        'A caller reached this with battleEnabled true for a mapper this table does not cover -- add a ' +
        'measured entry before this mapper can be used for an RPG project.'
    );
  }
  return BATTLE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id];
}

// Re-measured for the zero-page kernel diet: { 30: 200, 1: 200, 4: 211 }.
export const TITLE_KERNEL_ALLOWANCE_BY_MAPPER = { 30: 200, 1: 200, 4: 211 };
const FALLBACK_TITLE_KERNEL_ALLOWANCE = Math.max(...Object.values(TITLE_KERNEL_ALLOWANCE_BY_MAPPER));
export function titleKernelAllowance(mapper) {
  return TITLE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id] ?? FALLBACK_TITLE_KERNEL_ALLOWANCE;
}

// 30 (UNROM 512) is measured the same way as the other two, from a real
// build of sample-rpg with and without a live Save command, title on both
// sides since Save requires one: 6687 -> 7414, +727 (re-measured for name
// entry phase 1's own +3, docs/design-name-entry.md §2/§10 -- the no-Save
// side is unaffected, since save_field_lo/hi/len only assembles inside
// save.asm's own `.if SAVE_ENABLED` block, so the whole +3 lands on the
// with-Save side alone. Before that: 6687 -> 7411, +724, re-measured against
// the tree with Magic Forge phase 4's `BE_RESTORE` landed; both sides were
// 6678 -> 7397, +719 before it, matching this constant's own action-side 683
// plus the prerequisite phase's 36, before `BE_RESTORE` added its own
// 5-byte call site -- see the split's own paragraph above).
// Substantially larger than MMC1/MMC3's own allowance because flash
// save is not just a checksum/marker-write difference from battery -- it
// carries its own RAM-resident driver (engine/flash.asm: the JEDEC unlock
// sequence, the erase, the 87-byte program loop, all position-independent)
// plus save_media_fetch/commit's wrapper (the vblank wait, the forced
// blank, the copy-to-RAM, the mapper_shadow save/restore) that battery's
// save_media_fetch/commit reduce to a no-op. UNROM 512's own base-plus-title
// figure is what leaves room for the RPG total (727 = this constant's own
// action-side 686 plus SAVE_BATTLE_KERNEL_ALLOWANCE's 41, below) against
// roughly 1500 bytes of headroom before KERNEL_SLACK and the fallback base
// even enter the picture.
// Re-measured for the zero-page kernel diet: { 1: 470, 4: 475, 30: 640 }.
export const SAVE_KERNEL_ALLOWANCE_BY_MAPPER = { 1: 470, 4: 475, 30: 640 };
// The RPG-only supplement the paragraph above this table derives -- flat,
// not *_BY_MAPPER, and why, is argued there in full; this is only the
// declaration, kept next to the table it supplements. Unchanged by the
// zero-page kernel diet -- save_check_valid's own `.if BATTLE_ENABLED`
// range-check block measures identically before and after (observed, not
// yet traced to a specific reason why it has no eligible bare operand).
export const SAVE_BATTLE_KERNEL_ALLOWANCE = 41;
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
// Re-measured for the zero-page kernel diet: 324 (down from 379) -- the
// FACE/MOVE split above it derived from the identical MOVE+TURN+FACE(once)
// triangulation this figure was originally split out of.
// Re-measured again for phase 2 slice 3's ruling 7 (docs/design-streamed-
// worlds.md): move_get_x/y, move_set_x/y, move_speed's NPC branch and
// move_animate's NPC branch (engine/entities.asm) each traded a 2-byte
// `ldx <talk_ent` for a 3-byte `ldx mv_ent` (mv_ent is $0300+ RAM, never
// zero-page -- decision/ruling: no `<` prefix), and script_op_move
// (engine/script.asm) gained a 5-byte `lda <talk_ent / sta mv_ent` capture.
// Unconditional on MOVE_ENABLED itself, not gated on STREAMING_ENABLED --
// every project using Move pays it, streamed or not. +11 bytes: 335.
export const MOVE_KERNEL_ALLOWANCE = 335;
// move_face alone (engine/entities.asm), gated on FACE_ENABLED
// (projectUsesFace = projectUsesMove || projectUsesTurn) -- charged once
// whenever either Move or Turn is live, never twice when both are. Measured
// by isolating it two ways that have to agree: MOVE_KERNEL_ALLOWANCE (379)
// plus this (16) sums to the pre-split 395 exactly, and a build with both
// Move and Turn live measures exactly MOVE_KERNEL_ALLOWANCE +
// TURN_KERNEL_ALLOWANCE + this (379 + 35 + 16 = 430) -- not 430 + 16 again --
// confirming the routine is charged once, not twice, when both commands are.
// Re-measured for the zero-page kernel diet: 13 (down from 16), re-derived
// from the same MOVE+TURN+FACE(once) triangulation as MOVE_KERNEL_ALLOWANCE.
export const FACE_KERNEL_ALLOWANCE = 13;
// script_op_turn plus its own dispatch-chain entry in script_run
// (engine/script.asm) -- not move_face, which is FACE_KERNEL_ALLOWANCE.
// Re-measured for the zero-page kernel diet: 33 (down from 35).
export const TURN_KERNEL_ALLOWANCE = 33;
// script_op_wait, wait_tick, both dispatch-chain entries (script_run and
// ui_tick), and script_start's own wt_left clear. Additive with
// TURN_KERNEL_ALLOWANCE exactly (35 + 48 = 99, the real measured delta of a
// build with both live and neither Move), because Wait touches no code Turn
// or Face also touch. Re-measured for the zero-page kernel diet: 43 (down
// from 48) -- wt_left (engine/constants.asm) is an expression-chained name
// the diet's own expanded resolver reaches; TURN+WAIT together now measure
// 33 + 43 = 76, still additive, still real (the identical delta a build with
// both live and neither Move reports).
export const WAIT_KERNEL_ALLOWANCE = 43;
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
// Re-measured for the zero-page kernel diet: 60 (down from 65) --
// shake_left (engine/constants.asm) is an expression-chained name the
// diet's own expanded resolver reaches.
export const SHAKE_KERNEL_ALLOWANCE = 60;
// docs/design-camera.md §8, phase 1: nmi_scroll's own camera-register path
// (engine/boot.asm) -- the cam_dirty-gated snapshot refresh plus the
// unconditional $2000/$2005 write, with no consumer built on top of it yet
// (that is the consumer's own gate, a later phase). The design document calls
// this term CAMERA_PHASE1_KERNEL_ALLOWANCE; shipped under this name because
// "phase 1" is a rollout concept for this document's own rollout plan, not a
// feature the ledger needs to name -- the byte cost is simply what turning
// the camera register on costs, regardless of how the rollout was staged.
// Flat across boards -- measured identically on NROM, MMC1, MMC3 and
// UNROM 512 (test/unit/kernelbytes.test.js), the same reasoning
// SHAKE_KERNEL_ALLOWANCE/VISIBLE_KERNEL_ALLOWANCE are flat.
export const CAMERA_KERNEL_ALLOWANCE = 20;
// The Shake+camera composition branch inside nmi_scroll's own `.if
// CAMERA_ENABLED` block (engine/boot.asm) -- composing the +-2 pixel offset
// onto a *variable* nmi_cam_x_lo/nmi_cam_nt pair costs more than composing
// it onto the constant (0,0) SHAKE_KERNEL_ALLOWANCE already charges for: the
// ADC carry and SBC borrow each fire at a different threshold of
// nmi_cam_x_lo (255 vs 0..1), so the +2 and -2 phases need their own
// nametable-toggle arithmetic instead of sharing one carry test. Charged
// only when camera AND Shake are both live, the STING_SFX_INTERACTION_
// ALLOWANCE shape -- neither term alone assembles this branch. Flat across
// boards, the same reasoning CAMERA_KERNEL_ALLOWANCE is.
export const CAMERA_SHAKE_INTERACTION_ALLOWANCE = 19;
// docs/design-camera.md §8, phase 2: the consumer's own incremental delta,
// measured against a register-only build (CAMERA_ENABLED=1,
// CAMERA_SLIDE_ENABLED=0 -- see the ledger test's own config.inc patch), NOT
// against camera-off -- that would silently re-absorb CAMERA_KERNEL_ALLOWANCE
// a second time. Covers redraw_screen_slide, camera_slide_tick and
// camera_slide_complete_b (engine/camera.asm), the cross_* stub additions
// (engine/player.asm) and draw_screen_at/draw_screen's own two-instruction
// wrapper (`lda #0 / jmp draw_screen_at`, engine/screens.asm) -- smaller than
// the design document's own prototype figure (303) because this build never
// needed the design's candidate-(a) `_for` shims (set_screen_ptr/
// rebuild_bound_cache already read flat_screen internally, and (b) never
// draws the outgoing screen). Flat across boards, gated on projectUsesCamera
// -- the same predicate CAMERA_KERNEL_ALLOWANCE uses, since
// CAMERA_SLIDE_ENABLED is generated from the identical flag (main/build/
// generate.js's own config.inc emission).
// Measured at 298 (design document's own prototype figure: 303, with the
// shims) -- this is the axis-independent share alone; CAMERA_AXIS_KERNEL_
// ALLOWANCE below is the per-axis share. One live axis therefore totals
// 20 (register) + 298 + 52 = 370, five bytes under the design's own +375.
// The decomposition (docs/design-camera.md §5, Decision 4, re-verified
// against isolated prototype-shim builds): the prototype's screen-pointer
// shim nets +5 over this build's own plain `jsr set_screen_ptr` (the shim
// itself is +5 bytes -- `ldy <flat_screen` (2) + `jmp set_screen_ptr_for`
// (3) -- removing the original routine's own two `ldy <flat_screen` (2
// sites x 2 bytes = 4) it no longer needs, and adding two caller-side
// `ldy <flat_screen` at camera.asm's own two call sites, totaling four
// bytes ACROSS both sites (2 sites x 2 bytes = 4): +5 -4 +4 = +5).
// The bound-cache shim nets a SEPARATE +7 the same way (+5 shim, -2 for the
// one `ldy <flat_screen` the original rebuild_bound_cache no longer needs,
// +4 total across two caller-side `ldy`s: +5 -2 +4 = +7). The design's own
// 13 is therefore this build's shipped two `jsr rebuild_bound_cache` calls
// (6, BOUND_TILE_CAMERA_INTERACTION_ALLOWANCE below) plus the 7 that only
// the `_for` shape ever paid -- not one term silently moved to another.
export const CAMERA_SLIDE_KERNEL_ALLOWANCE = 298;
// design-camera.md §5/Q3: the cross_* stub shape that actually attempts a
// slide (vs. the plain-cut shape an axis with no live content compiles to)
// costs this much PER enabled axis -- cameraAxes(mapper, project.cartridge)
// answers one or two (never zero: "neither axis" is not a reachable
// normalized state, cameraAxes' own doc comment). Flat per axis regardless
// of which one (horizontal and vertical each touch one axis-independent
// pair of cross_* stubs).
export const CAMERA_AXIS_KERNEL_ALLOWANCE = 52;
// The two `sta $E000` instructions in engine/camera.asm (redraw_screen_slide
// and camera_slide_complete_b, one each, both under `.if SPLIT_ENABLED`)
// that disable AND acknowledge MMC3's own scanline IRQ before each
// forced-blank draw -- guarding against an already-armed IRQ from before
// forced blank began still landing mid-draw, alongside each routine's own
// $2000 NMI-off write. This is NOT a CHR-bank reselection, and NOT the same
// reason redraw_screen's own `sta $E000` exists (engine/screens.asm, which
// protects a switch_chr_bank $8000/$8001 register pair): draw_screen_at
// itself calls neither switch_chr_bank NOR set_screen_ptr -- its only
// conditional callee is bound_tile_lookup. It is redraw_screen_slide and
// camera_slide_complete_b (engine/camera.asm) that call set_screen_ptr
// (which selects PRG, not CHR) before either one calls draw_screen_at.
// Charged only when both SPLIT_ENABLED and CAMERA_SLIDE_ENABLED are live,
// the same STING_SFX_INTERACTION_ALLOWANCE shape.
export const CAMERA_SPLIT_INTERACTION_ALLOWANCE = 6;
// engine/camera.asm's own two extra rebuild_bound_cache call sites (arm and
// completion, 3 bytes each) that only assemble once BOUND_TILE_ENABLED is
// live -- draw_screen_at's own bound_tile_lookup arm costs nothing extra
// here: it is the identical two-site swap BOUND_TILE_KERNEL_ALLOWANCE already
// prices for draw_screen, just paid inside draw_screen_at instead once camera
// replaces draw_screen with it (never both at once). Charged only when
// camera and switch-bound tiles are both live. Measured at 6, not the design
// document's own prototype figure of 13 -- that prototype called
// rebuild_bound_cache_for (a shim this build does not carry, Decision 4).
export const BOUND_TILE_CAMERA_INTERACTION_ALLOWANCE = 6;
// script_op_visible and its dispatch-chain entry in script_run
// (engine/script.asm) plus the ENT_HIDDEN check in draw_entities
// (engine/entities.asm). Flat across boards for the identical reason
// SHAKE_KERNEL_ALLOWANCE is: nothing here branches on SPLIT_ENABLED or any
// other mapper-specific fact -- measured identically (49) on UNROM 512,
// MMC1 and MMC3. Shares no dependent term with anything else -- no other
// command calls script_op_visible or reads ENT_HIDDEN.
// Re-measured for the zero-page kernel diet: 47 (down from 49).
export const VISIBLE_KERNEL_ALLOWANCE = 47;
// script_op_fade and fade_tick only (engine/script.asm, engine/entities.asm)
// -- NOT fade_apply_palette or the NMI PPUADDR fix, which moved to
// PALETTE_FX_KERNEL_ALLOWANCE below when Flash's own design (handoff-flash/
// design-flash.md §4) re-gated both on the derived PALETTE_FX_ENABLED flag so
// Flash could reuse them without a second, independently-maintained copy of
// the exact-$0D clamp. Also covers script_run's own dispatch entry,
// script_start's fade_left clear, the fade_reload arm in init_session and its
// consumption in redraw_screen (engine/combat.asm, engine/screens.asm), and
// reset's own fade_reload clear right after cold boot's init_session call.
// Flat across boards, the same reasoning SHAKE_KERNEL_ALLOWANCE/
// VISIBLE_KERNEL_ALLOWANCE are. FADE_KERNEL_ALLOWANCE +
// PALETTE_FX_KERNEL_ALLOWANCE together still equal 201 -- the whole,
// unchanged, shipped Fade-only delta -- because the re-gate moved which
// named constant a byte is counted under, never which bytes assemble for a
// Fade-only build. Solved, not merely subtracted from an estimate, from
// three real measured deltas (Fade live/Flash absent; Flash live/Fade
// absent; both live) per test/unit/kernelbytes.test.js's own three-equation
// procedure -- see PALETTE_FX_KERNEL_ALLOWANCE/FLASH_KERNEL_ALLOWANCE below.
// Re-measured for the zero-page kernel diet: FADE_KERNEL_ALLOWANCE +
// PALETTE_FX_KERNEL_ALLOWANCE together now equal 176 (down from 201) --
// fade_step/fade_target/fade_left/fade_reload (engine/constants.asm) are
// all expression-chained names the diet's own expanded resolver reaches.
// Re-solved from the same three-equation procedure: 124 (down from 146).
export const FADE_KERNEL_ALLOWANCE = 124;
// fade_apply_palette's own body plus the NMI PPUADDR fix (engine/
// entities.asm, engine/boot.asm) -- one physical copy, gated on the derived
// PALETTE_FX_ENABLED (projectUsesPaletteFx = projectUsesFade ||
// projectUsesFlash), charged once whenever either is live, never twice when
// both are, the identical FACE_KERNEL_ALLOWANCE shape projectUsesFace's own
// comment describes for move_face. Flat across boards, the same reasoning
// FADE_KERNEL_ALLOWANCE is. Solved from the same three-equation measurement
// as FADE_KERNEL_ALLOWANCE/FLASH_KERNEL_ALLOWANCE: PALETTE_FX_KERNEL_ALLOWANCE
// = D_fade + D_flash - D_both, where D_fade/D_flash/D_both are the three real
// measured deltas (Fade alone, Flash alone, both together) --
// test/unit/kernelbytes.test.js asserts the exported constant equals the
// solved value, not merely that some triple satisfying the equations exists.
// Re-measured for the zero-page kernel diet: 52 (down from 55), re-solved
// from the same three-equation procedure as FADE_KERNEL_ALLOWANCE/
// FLASH_KERNEL_ALLOWANCE.
export const PALETTE_FX_KERNEL_ALLOWANCE = 52;
// script_op_flash, flash_tick, flash_apply_on, the main_loop hook, and
// vram_reset's own cancellation glue (engine/script.asm, engine/entities.asm,
// engine/boot.asm, engine/text.asm) -- NOT fade_apply_palette or the NMI
// PPUADDR fix, which PALETTE_FX_KERNEL_ALLOWANCE already covers whenever
// Flash is live, whether or not Fade also is. Flat across boards, the same
// reasoning FADE_KERNEL_ALLOWANCE/PALETTE_FX_KERNEL_ALLOWANCE are: nothing
// here branches on SPLIT_ENABLED, a CHR/PRG bank, or any other
// mapper-specific fact. Solved, not summed from two independently-measured
// "Flash alone" figures for the combined build -- FLASH_KERNEL_ALLOWANCE =
// D_flash - PALETTE_FX_KERNEL_ALLOWANCE, the same three-equation procedure.
// Re-measured for the zero-page kernel diet: 91 (down from 98), re-solved
// from the same three-equation procedure as FADE_KERNEL_ALLOWANCE/
// PALETTE_FX_KERNEL_ALLOWANCE.
export const FLASH_KERNEL_ALLOWANCE = 91;
// Re-measured for the zero-page kernel diet: 151 (down from 165) --
// split_lock (engine/constants.asm) is an expression-chained name the
// diet's own expanded resolver reaches, on top of every literal-equate site
// already inside split.asm's own font-bank-split machinery.
export const SPLIT_KERNEL_ALLOWANCE = 151;
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
// Unchanged by the zero-page kernel diet: the combined ITEM_KERNEL_ALLOWANCE
// + ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE delta did shrink (see that
// table's own comment below), but no project toggle isolates this term from
// that one -- both are charged together the instant `usesItems` is true,
// regardless of any item's own effect kind. A direct instruction-by-
// instruction accounting confirms all of the shrinkage really does belong
// to the other term, not a guess pending a future isolation: this one is
// exactly `add_item`'s own gated `cmp #NO_ITEM` / `beq` (4 bytes,
// engine/ui.asm) plus `draw_item_icon` in full (12 bytes) = 16, unaffected
// by the diet because neither instruction touches a zero-page-eligible
// operand -- `item_metasprite,y` is `assets/items.inc` table data, well
// above $100.
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
// Re-measured for the zero-page kernel diet: { action: 61, rpg: 59 } -- the
// combined ITEM_KERNEL_ALLOWANCE+this delta dropped from 79 to 77 (action)
// and from 76 to 75 (rpg); see ITEM_KERNEL_ALLOWANCE's own comment above for
// why the entire drop lands here rather than being split between the two.
export const ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE = { action: 61, rpg: 59 };
const FALLBACK_ITEM_EFFECT_KERNEL_ALLOWANCE = Math.max(...Object.values(ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE));
// A project not yet through normalizeProject (the app is holding one mid-edit,
// same reasoning kernelCodeBytes' own callers already have to live with
// elsewhere) can carry a gameType this table has no entry for -- falls back
// to the larger of the two measured figures, the identical shape
// baseKernelCodeBytes' own fallback already uses for an unmeasured mapper.
export function itemEffectKernelAllowance(project) {
  return ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE[project.project?.gameType] ?? FALLBACK_ITEM_EFFECT_KERNEL_ALLOWANCE;
}
// sting_snapshot/sting_restore/sting_tick, the main_loop call site, script_op_sting, and the
// force_trig/cancellation-check/music_stop-clear additions to music_channel/music_play/music_stop
// (engine/music.asm, engine/script.asm, engine/boot.asm) -- see handoff-sting/design-sting.md §7.
// Flat across boards, the same reasoning MOVE_KERNEL_ALLOWANCE/SHAKE_KERNEL_ALLOWANCE/etc. are:
// nothing here branches on SPLIT_ENABLED or any other mapper-specific fact -- measured 175 on all
// three RPG-capable boards, exactly, not merely close. Measured the same way every other allowance
// here is: build sample-rpg with and without a live Sting, isolated against a baseline that already
// carries a surviving text-triggering event so MMC3's own SPLIT_KERNEL_ALLOWANCE stays out of
// this delta -- test/unit/kernelbytes.test.js asserts the three boards agree exactly.
//
// Not the design's own 176-byte pre-implementation estimate: implementation deviated from
// design-sting.md §7's script_op_sting sketch by 5 bytes (43 -> 38) after finding its own cited
// "script_op_give/NO_ITEM family shape" was mischaracterized -- the real family precedent (also
// script_op_call's own NO_COMMON_EVENT check) stops the event via script_finish on a
// recognised-command-naming-nothing operand, not skip-and-continue, which needs no duplicated
// skip-and-jmp-script_run block at all. See handoff-sting/sting-implementation-report.md for the
// full reasoning; the remaining 4-byte gap between the hand-adjusted estimate (171) and the real
// measurement (175) is named, not just measured: the design's own byte-cost table priced the four
// cur_song/mus_enabled loads and stores in sting_snapshot/sting_restore as two-byte zero-page
// instructions, but nesasm assembles each as a three-byte absolute instruction, so 171 + 4 = 175 --
// exactly the kind of small addressing-mode slip measurement exists to catch rather than trust.
//
// Split into two terms once SFX shipped and needed the same force_trig check-and-clear block
// (engine/music.asm, music_channel) Sting already paid for -- design-sfx.md §3.6. The 175 total is
// preserved exactly (STING_KERNEL_ALLOWANCE_STANDALONE + AUDIO_FX_KERNEL_ALLOWANCE below); a
// Sting-only project's own kernel-lo byte count does not move by one byte from this split, the
// identical MOVE_KERNEL_ALLOWANCE -> MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE precedent.
// Measured (test/unit/kernelbytes.test.js): a Sting-only build's own delta over its no-Sting-no-Sfx
// baseline was 175 on every RPG-capable board; the music_channel..music_channel_tick label-span diff
// below is what splits that 175 into this term (was 160) and AUDIO_FX_KERNEL_ALLOWANCE (15) rather
// than guessing which side of the split each byte belongs to.
//
// +12, review-fixes slice C, item 12: sting_snapshot/sting_restore (engine/music.asm) now
// save/restore mus_inst_base alongside cur_song and mus_enabled -- `lda mus_inst_base / sta
// sting_shadow_inst_base` in the snapshot and its mirror in the restore, 6 bytes each -- entirely
// inside the outer `.if STING_ENABLED` block, so none of it is AUDIO_FX_KERNEL_ALLOWANCE's shared
// force_trig code. Re-measured Sting-only delta: 187 on every RPG-capable board (was 175); 187 - 15
// (AUDIO_FX_KERNEL_ALLOWANCE, unmoved) = 172.
// Re-measured for the zero-page kernel diet: 166 (down from 172), re-derived
// as the Sting-alone combined delta (181) minus AUDIO_FX_KERNEL_ALLOWANCE
// (15, unchanged) -- see that constant's own comment for why it is
// unaffected.
export const STING_KERNEL_ALLOWANCE_STANDALONE = 166;
// force_trig's own check-and-self-clear inside music_channel (engine/music.asm) -- shared by
// Sting and SFX, gated AUDIO_FX_ENABLED rather than STING_ENABLED alone. Already fully paid by
// STING_KERNEL_ALLOWANCE_STANDALONE + this term summing to the historical 175 for a Sting-only
// project; charged once, not twice, for a project with both live -- see design-sfx.md §3.6.
// Measured directly, not by subtraction: nesasm's own symbol table gives the music_channel..
// music_channel_tick label span as 13 bytes with neither feature live and 28 with either live
// (Sting-only, Sfx-only or both -- identical either way, confirming the block assembles once
// regardless of which flag turned AUDIO_FX_ENABLED on) -- 28 - 13 = 15, matching design-sfx.md's
// own estimate exactly, on every RPG-capable board.
// Unchanged by the zero-page kernel diet: re-measured directly via the
// identical music_channel..music_channel_tick label-span-growth isolation
// (test/unit/kernelbytes.test.js) this constant was originally split from,
// and the growth is still exactly 15 -- the force_trig check-and-clear
// block itself indexes force_trig,x ($543) and mus_trig,x ($358), both well
// above $100, never a bare zero-page operand, so the diet has nothing to
// shrink there.
export const AUDIO_FX_KERNEL_ALLOWANCE = 15;
// sting_restore_silence's own ownership guard (ldy sfx_state / bne skip, engine/music.asm) -- a
// genuine Sting x SFX interaction term, not SFX-standalone code: the guard is nested inside the
// shipped outer `.if STING_ENABLED` block, so it can only ever assemble when BOTH STING_ENABLED
// and SFX_ENABLED are true. See design-sfx.md §3.6.
// Measured directly: nesasm's own symbol table gives the sting_restore_silence..sting_tick label
// span as 17 bytes on a Sting-only build and 22 on a both-live build -- 22 - 17 = 5, matching
// design-sfx.md's own estimate exactly, on every RPG-capable board.
// Unchanged by the zero-page kernel diet: re-measured directly via the
// identical sting_restore_silence..sting_tick span-growth isolation, still
// exactly 5 -- the nested-ownership guard indexes data, not a bare
// zero-page operand, the identical reason AUDIO_FX_KERNEL_ALLOWANCE above
// is unaffected.
export const STING_SFX_INTERACTION_ALLOWANCE = 5;
// The restructured music_tick, script_op_sfx (including its sfx_state/$4015 writes), the
// two-phase sfx_channel_tick/sfx_read_event/sfx_apply, the script_run dispatch entry, music_stop's
// own ownership guard, and init_session's new session-boundary clear (engine/music.asm,
// engine/script.asm, engine/combat.asm) -- real kernel-lo code with nowhere to go unconditionally
// in a project that never plays a sound effect. Excludes sting_restore_silence's own guard (see
// STING_SFX_INTERACTION_ALLOWANCE above) -- that 5 bytes is not SFX-standalone cost. See
// design-sfx.md §3.6/§8.
// Measured, not the design's own 283-byte estimate: an SFX-only build's own delta over its
// no-Sting-no-Sfx baseline is 310 on every RPG-capable board (test/unit/kernelbytes.test.js);
// 310 - AUDIO_FX_KERNEL_ALLOWANCE (15) = 295. Consistent with the both-live measurement too: 160 +
// 295 + 15 + 5 = 475, exactly the measured both-live delta on every board. The 12-byte gap from the
// design's own 283 is a real, declared deviation -- see sfx-implementation-report.md.
// Re-measured for the zero-page kernel diet: 283 (down from 295), re-derived
// as the Sfx-alone combined delta (298) minus AUDIO_FX_KERNEL_ALLOWANCE (15,
// unchanged).
export const SFX_KERNEL_ALLOWANCE_STANDALONE = 283;
// design-tile.md §8: bound_tile_lookup, rebuild_bound_cache, the
// script_op_set/script_op_clear hooks, tile_switch_changed,
// queue_or_defer_flip (with dedupe), flip_cell_blocked, flip_emit/
// flip_emit_packet, flip_tick plus its main_loop call site, the four
// draw_screen/probe_type/text_close_step lookup-swap call sites, and the
// vram_reset pending-queue clear -- measured per-board
// (kernelbytes.test.js), flat across MMC1/MMC3/UNROM 512 exactly as
// STING_KERNEL_ALLOWANCE's own comment already found for a different
// feature. Not the design's own 382-byte estimate: nesasm's symbol table
// (game.fns, a real build) puts bound_tile_lookup+rebuild_bound_cache
// (engine/screens.asm) at 93 bytes -- not 90, corrected in code-fixes
// round 1: the routine's own tail, `stx bind_count` (rbc_done), is a
// 3-byte absolute store, not a 2-byte zero-page one, since bind_count lives
// at $0557, outside zero page -- the exact "$0300+ addressing costs 3
// bytes, not 2" pattern STING_KERNEL_ALLOWANCE's own comment already found
// for cur_song/mus_enabled; the first measurement counted the label span
// bound_tile_lookup..rbc_done rather than through rbc_done's own body, and
// undercounted by those same 3 bytes. The script.asm block --
// flip_cell_blocked through tile_switch_changed -- measures 218, a few
// bytes under the design's 225 estimate; flip_tick (engine/entities.asm)
// measures exactly the estimated 54. The remaining 23 bytes are the four
// lookup-swap call sites (each trades a 2-byte `lda [mtptr_lo],y` for a
// 3-byte `jsr bound_tile_lookup`, +1 apiece = 4), the two new unconditional
// call sites (`jsr rebuild_bound_cache` in redraw_screen, `jsr flip_tick`
// in main_loop, 3 bytes each = 6), the vram_reset clear (`sta
// flip_pending_count`, 3 bytes -- absolute, not zero-page, the same pattern
// as rbc_done's own `stx bind_count` above), and the script_op_set/
// script_op_clear pha/pla/jsr wrapping (5 bytes each site = 10). 93 + 54 +
// 218 + 23 = 388 exactly, with nothing left unaccounted -- see
// handoff-tile/tile-code-fixes1-report.md for the full symbol-span trace
// this correction came from.
// Re-measured for the zero-page kernel diet: 381 (down from 388).
export const BOUND_TILE_KERNEL_ALLOWANCE = 381;

// In-game party-member naming (docs/design-name-entry.md §4/§11). Six
// kernel-lo terms. NAME_ENTRY_KERNEL_ALLOWANCE, JOIN_NAMING_KERNEL_ALLOWANCE,
// HERO_NAMING_KERNEL_ALLOWANCE and HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE are
// nesasm-measured, exactly, against sample-rpg on MMC1/MMC3/UNROM 512
// (identical on all three, so flat rather than *_BY_MAPPER -- test/unit/
// kernelbytes.test.js's own isolation matrix asserts this), by triangulating
// three real deltas (naming off vs. join-only, off vs. hero-only, off vs.
// both, all titled) the same way MOVE_KERNEL_ALLOWANCE-style terms already
// are elsewhere in this file: N = (off->join) + (off->hero) - (off->both),
// H = (off->hero) - N, J = (off->join) - N; HT is the same titled-vs-
// titleless subtraction X3 already specifies. NAME_ENTRY_ACTION_KERNEL_
// ALLOWANCE is measured the same way against sample (action, all four
// action-capable boards, identical on all four) once HERO_DEFAULT_KERNEL_
// ALLOWANCE's own exact 21 bytes and the shared N/H above are subtracted out
// of the one combined delta an action build can ever isolate (there is no
// build-time lever, in this phase, that turns HERO_NAMING_ENABLED on for an
// action project without also turning on NAME_ENTRY_ACTION and
// projectNeedsHeroDefault at the same time -- see NAME_ENTRY_ACTION's own
// comment below).
//
// NAME_ENTRY_KERNEL_ALLOWANCE is the hook glue shared by every naming feature
// regardless of game type: dispatch_input's nm_acted latch, do_action_confirm/
// do_action_cancel's own naming arms (plus the do_action dispatch chain's own
// branch-range fix), draw_ui's naming arm, ui_tick's routing arm, text_tick's
// naming arm, and the five kernel-lo shims (name_begin/tick/draw/select/
// cancel) that let those hook sites reach either placement identically. This
// is v13's own shim rewrite landing higher than the pre-implementation
// static count (95) predicted -- the five shims are a genuinely new
// kernel-lo block neither v12 nor the static estimate had to include.
// Re-measured for the zero-page kernel diet: 107 (down from 115), from the
// identical triangulation (N = (off->join) + (off->hero) - (off->both)).
export const NAME_ENTRY_KERNEL_ALLOWANCE = 107;
// docs/design-streamed-worlds.md (ROADMAP item 15), phase 2 slice 2a. The
// resident streamed-worlds package (engine/streamworld.asm), a KERNEL-HI
// allowance, not kernel-lo like every other one on this page: it is
// assembled inside `.if STREAMING_ENABLED` after assets/text.inc, before
// the CPU vectors, and charged against the $E000 half of the fixed kernel
// (checkCapacity's own music+sfx+text check), never against kernelCodeBytes.
// Fresh nesasm measurement (test/lib/streamedproject.js's generator, both
// game types and its `mixed` shape): kernel-hi bank usage of a streamed
// build minus the same board's unstreamed baseline, minus
// STREAMWORLD_MT_PAL_KERNEL_HI_BYTES below (both land in the same `.if
// STREAMING_ENABLED` region, so the raw delta charges both together). Flat
// at 2432 across game type and `mixed` (2496 combined with
// STREAMWORLD_MT_PAL_KERNEL_HI_BYTES), measured and equality-asserted on
// UNROM 512 -- test/unit/kernelbytes.test.js. Phase 2 slice 2b's Part D
// item 1 narrowed streaming to UNROM 512 (streamCapableFourScreen) alone,
// so the per-mapper board list this comment used to name (MMC1/MMC3 too)
// no longer applies; MMC1/MMC3 are refused outright by validateStreamedMaps
// regardless of what this allowance would measure on them. Re-measured up
// from 2050 by this same slice's own landing-site resolver/render call
// sites (sw_resolve_screen, sw_render_window, sw_locate_current and the
// rest of engine/streamworld.asm's phase 2 slice 2b growth) -- the prior
// figure predates all of it. Fix round 1 (streamed-worlds-phase2-s2b-review1.
// md) grew this again, from 2376 to 2432: finding 1's 16-bit locator pointer
// (sw_resolve_owner_streamed) and finding 9's NO_SCREEN park/st_active clear
// (sw_resolve_screen) both live in this same resident file, and both are
// real net growth over the multiply-that-wraps and no-op-on-invalid-input
// they replace. Re-measured directly (kernel-hi bank usage, streamed minus
// unstreamed baseline), not derived by adding the two fixes' own byte counts
// by hand. Phase 2 slice 4a grew this again, from 2432 to 2611: the three
// new resident subroutines (sw_oam_rowbase, sw_oam_project_x,
// sw_oam_project_y, engine/streamworld.asm) plus sw_resolve_divdone's own
// new camera-origin write are the whole 179-byte difference -- re-measured
// directly (real kernel-hi delta 2675 on UNROM 512, flat across action/rpg/
// mixed; 2675 - STREAMWORLD_MT_PAL_KERNEL_HI_BYTES(64) = 2611), not derived
// by hand from the new code's own line count. Phase 2 slice 4a round 1
// review fix grew this again, from 2611 to 2689: real per-tile clipping
// (finding 2) needs a general SIGNED offset projection per axis, not
// sw_oam_project_x/y's own single-carry-bit contract, so each gained a
// sibling (sw_oam_project_tile_x, sw_oam_project_tile_y) plus a small
// shared core label each now falls through to -- all still resident in
// this same file/region. Re-measured directly (real kernel-hi delta 2753 on
// UNROM 512, flat across action/rpg/mixed; 2753 -
// STREAMWORLD_MT_PAL_KERNEL_HI_BYTES(64) = 2689), not derived by hand.
// Fix round 1 (streamed-worlds-phase2-s4b-fix1) grew this again, from 2689
// to 3385: finding 1's real crossing implementation lives entirely in new
// resident code (sw_hazard_probe_solid/sw_hazard_probe_solid_cross, six
// small per-axis recompute helpers -- sw_pr_calc/sw_pl_calc/sw_pd_calc_a/
// sw_pd_calc_b/sw_pu_calc_noborrow/sw_pu_calc_b -- and the four
// sw_pstep_left/right/up/down routine bodies, all in engine/streamworld.asm
// ahead of sw_update_player, all unconditional under STREAMING_ENABLED),
// none of which falls inside any other named span. Re-measured directly
// (fix round 2: real kernel-hi delta 4601 on UNROM 512 action, 4566 rpg,
// 4601 action-mixed; each equals STREAMWORLD_MT_PAL_KERNEL_HI_BYTES(64) +
// STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE(834) +
// STREAMWORLD_KNOCKBACK_KERNEL_HI_ALLOWANCE(32, action only) +
// streamworldUpdatePlayerKernelHiAllowance (170 action / 167 rpg) +
// STREAMWORLD_HAZARD_KERNEL_HI_ALLOWANCE(64, fix round 2 finding C shrank
// sw_hazard_probe_cross's tail by 4 bytes) + 3437 exactly, all three
// shapes -- the remaining +52 over the fix-round-1 value of 3385 is
// sw_terrain_or_fill_solid_type (fix round 2 finding C, shared by
// sw_move_probe_solid and sw_hazard_probe_cross) plus the Finding A/B
// rewrite of sw_pstep_up's crossing case (per-probe renormalization, plus
// the bcc/jmp branch-range fix)), not derived by hand from the new code's
// own line count. The "landing" slice (fixing the top-left-landing-window
// defect: sw_resolve_divdone used to align a streamed landing to the
// entered screen's own top-left corner, leaving the visible rect outside
// completed content for ~70 frames until sw_frame_camera_window's own
// per-frame tracking caught up) shrank this again, from 3437 to 3342:
// sw_resolve_divdone's own inline top-left window/scroll/origin computation
// (screenCol/screenRow into win_col/row screen+local with local always 0,
// cam_nt/cam_x_lo/cam_y_lo from screen parity, sw_cam_origin_x/y from the
// screen's own pixel origin) is gone outright, replaced by a two-call tail
// (`jsr sw_enter_screen` / `jmp sw_camera_window_install`) that reuses
// tracking's own clamp/centre arithmetic instead of a second copy of it --
// real net shrinkage in this region, the code that moved growing
// STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE below instead. Re-measured
// directly (real kernel-hi delta 4538 on UNROM 512 action, 4503 rpg, 4538
// action-mixed; each equals STREAMWORLD_MT_PAL_KERNEL_HI_BYTES(64) +
// STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE(866) +
// STREAMWORLD_KNOCKBACK_KERNEL_HI_ALLOWANCE(32, action only) +
// streamworldUpdatePlayerKernelHiAllowance (170 action / 167 rpg) +
// STREAMWORLD_HAZARD_KERNEL_HI_ALLOWANCE(64) + 3342 exactly, all three
// shapes), not derived by hand from the new code's own line count.
export const STREAMWORLD_KERNEL_HI_ALLOWANCE = 3342;
// mt_pal (assets/streamworld_metatiles.inc, generated alongside but
// separate from assets/metatiles.inc -- the ordinary metatile tables exist
// on every project, this one only when streaming is live), the
// per-metatile attribute-quadrant lookup sw_ns_draw_attr/sw_rw_attr_* need
// to synthesize attribute bytes at render time -- the ordinary engine never
// needs this (it reads a PRE-computed per-screen attribute block instead,
// screenAttributes()), so no such table exists until streaming needs one. A
// fixed LIMITS.metatiles bytes, exactly like mt_tl/tr/bl/br/mt_collision's
// own charge above -- but gated on projectUsesStreaming, unlike those four,
// or every project's kernel-hi would grow regardless of whether it uses
// streaming at all. Assembled inside the same `.if STREAMING_ENABLED`
// region as streamworld.asm, right after it, so it is a kernel-HI cost too,
// not kernel-lo -- see the same equality test.
export const STREAMWORLD_MT_PAL_KERNEL_HI_BYTES = LIMITS.metatiles;
// Phase 2 slice 7a: the dialogue overlay's address mapper, split-at-seam
// packet writer and masked-attribute code (sw_dlg_mapper_start..sw_dlg_
// origin_capture, engine/streamworld.asm -- 7a's own last routine,
// sw_dlg_attr_close_band, ends exactly where 7b's first routine,
// sw_dlg_origin_capture, begins). Gated on projectUsesStreaming &&
// projectUsesText: a streamed project with no text assembles none of it
// (the span is itself `.if TEXT_ENABLED` inside the `.if STREAMING_ENABLED`
// file). Measured directly off nesasm's own symbol table (test/unit/
// kernelbytes.test.js), sw_dlg_origin_capture - sw_dlg_mapper_start, on a
// fresh clean build -- action, RPG and mixed all equal. Round 2 fix (review
// round 1, finding A1): sw_dlg_attr_precompute now re-derives each band's
// row from an unwrapped base held in its own sw_dlgw_baserow byte instead
// of a destructively-wrapped running remainder -- 611 -> 613.
// Fix round 2 (review round 2, finding A4): Chris's 2026-09-25 ruling --
// "the 7a mapper term stays at its measured 613." Round 1 had folded slice
// 7b's own growth (the terrain accessor, the production caller and the
// lifecycle state machine, all added inside this same sw_dlg_mapper_start..
// end span because nesasm places call-linked code together) into this term,
// taking it to 1114 -- 501 bytes of which were never 7a's own content. That
// growth now has its own term, STREAMWORLD_DIALOGUE_LIFECYCLE_TERRAIN_
// CONSUMER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE below, re-measured directly at
// the true sw_dlg_mapper_start..sw_dlg_origin_capture boundary -- 613, not
// derived by subtracting the other two terms from the combined span.
export const STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE = 613;
// Fix round 2 (review round 2, finding A4): Chris's 2026-09-25 ruling --
// "the lifecycle/terrain/consumer helpers get their own term." This is
// slice 7b's OWN content inside sw_dlg_mapper_start..end, everything after
// 7a's own mapper primitives and before the six relocated dispatch targets
// (sw_dlg_origin_capture..sw_dlg_relocated_start): the terrain-tile
// accessor (sw_dlg_origin_capture, sw_dlg_metatile), the production caller
// (sw_dlg_run_open/push/reopen, sw_dlg_write_border, sw_dlg_close_row,
// sw_dlg_single) and the lifecycle state machine itself (sw_dlg15_pending_
// step, sw_dlg17_camrelease) -- one lumped term, per the reviewer's own
// partition of the combined span ("613 mapper + 520 lifecycle/terrain/
// consumer helpers + 167 relocated helpers"). Round 1's camera/OAM
// publication-barrier fix (a single-frame cam_dirty hold at open and close,
// each rebuilding OAM before releasing) and this round's A1 fix (the close
// path's `.if !BATTLE_ENABLED / jsr draw_hud / .endif`, restoring the
// action HUD the close rebuild used to erase) both live inside
// sw_dlg17_camrelease, so both are already part of this same term, not a
// separate one. Game-type-varying: A1's draw_hud call is the ONLY thing in
// this whole span that reads BATTLE_ENABLED -- everything else (origin
// capture, metatile, the run/border/row/single writers, the state
// transitions themselves) is flat across game type, so the 3-byte
// difference is exactly A1's own fix, gated the identical way
// STREAMWORLD_UPDATE_PLAYER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE's own
// knockback/check_encounter arms are. Measured directly off nesasm's own
// symbol table, sw_dlg_relocated_start - sw_dlg_origin_capture, on a fresh
// clean build: 523 action/mixed, 520 rpg/mixed. (The three sw_dlg_
// lifecycle_* boundary-label brackets from round 1 -- open_start..end 11,
// close_a_start..end 2, close_b_start..end 9 action/6 rpg, summing to 22
// action/19 rpg -- still exist and are still asserted below as an internal
// cross-check; they are a SUBSET of this lump, not an addend to it.) Gated
// identically to the mapper term above (both live in the same `.if
// TEXT_ENABLED` bracket of the same file).
export const STREAMWORLD_DIALOGUE_LIFECYCLE_TERRAIN_CONSUMER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE = {
  action: 523,
  rpg: 520
};
const FALLBACK_STREAMWORLD_DIALOGUE_LIFECYCLE_TERRAIN_CONSUMER_KERNEL_HI_ALLOWANCE = Math.max(
  ...Object.values(STREAMWORLD_DIALOGUE_LIFECYCLE_TERRAIN_CONSUMER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE)
);
export function streamworldDialogueLifecycleTerrainConsumerKernelHiAllowance(project) {
  return (
    STREAMWORLD_DIALOGUE_LIFECYCLE_TERRAIN_CONSUMER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE[project.project?.gameType] ??
    FALLBACK_STREAMWORLD_DIALOGUE_LIFECYCLE_TERRAIN_CONSUMER_KERNEL_HI_ALLOWANCE
  );
}
// Fix round 1 (A4): Chris's 2026-09-25 ruling to move the streamed dialogue
// branches out of kernel-lo into kernel-hi, keeping only a small dispatch
// (`lda <map_is_streamed / beq ordinary / jmp`) at each of six named
// text.asm call sites. Their bodies now live in engine/streamworld.asm as
// sw_dlg_hi_* helpers, byte-for-byte the same code the guard blocks used to
// hold inline -- a THIRD term, kept apart from both the mapper allowance
// and the lifecycle/terrain/consumer allowance above, since it is neither
// new content nor this slice's own new work: it is relocated bodies, moved.
// Measured directly, sw_dlg_relocated_start..end (bracketing all twelve
// helpers together): originally 131 (round 1's own first six: text_open_
// row, text_open_attr, text_put_char, text_clear_step, text_choice_step,
// text_close_attr), then +36 (to 167) once A6's one-band-per-frame pacing
// fix turned sw_dlg_hi_open_attr/sw_dlg_hi_close_attr from three
// unconditional band calls each into a three-way box_row dispatch each.
// Fix round 2 (review round 2, finding A4): the remaining six sites
// (box_begin, text_tick, text_arrow_write, choice_cursor, text_close_step,
// text_close_attr_tail) relocated the same way -- +55 (to 222), byte-for-
// byte the same bodies these six guards used to hold inline, flat across
// game type (none of the six new bodies reads BATTLE_ENABLED).
// STREAMWORLD_DIALOGUE_LIFECYCLE_KERNEL_ALLOWANCE (kernel-lo, below) is the
// sum of thirteen individually-named per-site terms now, not one lump --
// each of the twelve relocated text.asm sites plus boot.asm's own
// camrelease poll measures 7 or 3 bytes on its own.
export const STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_ALLOWANCE = 222;
// Phase 2 slice 2b, Part F: the kernel-LO terms streaming adds, each its own
// named allowance rather than one lump sum -- every one of these lives
// before assets/kernel_hi.inc in engine/main.asm's own include order (see
// STREAMWORLD_KERNEL_HI_ALLOWANCE's own comment for the ones that don't),
// gated on projectUsesStreaming, so an ordinary project assembles with none
// of it. Measured directly off nesasm's own symbol table
// (test/unit/kernelbytes.test.js), not by hand: each site now carries a
// pair of unconditional boundary labels bracketing exactly its own `.if
// STREAMING_ENABLED` addition (boot_streamed_landing/boot_draw_ordinary,
// redraw_screen_dispatch/redraw_screen_ordinary, and so on), so the byte
// count is `symbolAddr(after) - symbolAddr(before)` off a real build, the
// same rigor every other allowance on this page already gets from a
// deliberately-shaped project -- just read from a span instead of a
// text/off delta, because unlike text there is no way to build "half of
// streaming" to diff against. Flat across game type and the `mixed` shape
// (test/lib/streamedproject.js) -- confirmed, not assumed, by measuring all
// three.
//
// engine/boot.asm's own copy of the resolve-and-render dispatch (cold boot
// draws its first screen inline rather than calling redraw_screen, so it
// carries a second copy of the identical pattern -- see boot.asm's own
// comment). 49 bytes: `jsr sw_resolve_screen` plus the map_is_streamed
// branch plus the whole streamed-landing render sequence (sw_render_window,
// spawn_entities, build_oam, draw_entities, wait_vblank_poll, the cam_nt/
// cam_x_lo/cam_y_lo scroll write) plus the tail jmp back into the ordinary
// path's own shared tail.
export const STREAMWORLD_RESOLVER_KERNEL_ALLOWANCE = 49;
// engine/screens.asm's redraw_screen -- the "re-keyed consumer" version of
// the identical dispatch STREAMWORLD_RESOLVER_KERNEL_ALLOWANCE measures in
// boot.asm, reached by every OTHER landing (start_game, restart_game,
// take_door, continue_game). 47, not 49: this one ends in `rts` (1 byte)
// where boot's copy ends in `jmp boot_draw_done` (3 bytes) back into its own
// shared tail -- the only difference between the two copies.
export const STREAMWORLD_REDRAW_KERNEL_ALLOWANCE = 47;
// engine/screens.asm's set_screen_ptr: an early return through
// sw_locate_current when the CURRENT screen is streamed (call_battle always
// ends `jmp set_screen_ptr` -- the restore IS the return -- so this runs
// even for a non-fight session-lifecycle entry). `lda/beq/jsr/rts` -- 8
// bytes flat, no per-mapper variance measured.
export const STREAMWORLD_SET_SCREEN_PTR_KERNEL_ALLOWANCE = 8;
// engine/entities.asm's spawn_entities: the streamed-vs-ordinary dispatch in
// spawn_clear's own preamble (12 bytes: map_is_streamed branch, `ldy
// <ord_screen`/`jmp spawn_have_ptr` for the ordinary side reached through
// the same shared join point) plus spawn_streamed's own body (164 bytes: the
// actor/x/y/target/toX/toY/event/trigger/hideSwitch field loop, identical
// order to spawn_any's own ordinary-record loop, walked with sw_adv_offset
// instead of a bare `iny` since a streamed record is STREAM_RECORD_BYTES
// long). One name for the whole consumer, matching how every other named
// term on this page charges a single routine's own total delta rather than
// a sub-block within it.
export const STREAMWORLD_SPAWN_KERNEL_ALLOWANCE = 12 + 164;
// engine/music.asm's apply_map_music/apply_map_music_direct: named because
// Part F requires this consumer named individually like every other one,
// even though its own measured delta is exactly zero -- `ldy <ord_screen`
// and `ldy <flat_screen` are both a 2-byte zero-page load (zeropage.test.js
// already guards every `<`-prefixed operand in the engine resolves below
// $100), so swapping which one assembles costs nothing. Confirmed by
// measuring the real ON/OFF delta directly rather than trusting that
// reasoning alone (both builds: apply_map_music_direct - apply_map_music ==
// 5, the identical `ldy <x` + `lda screen_map,y` span either way).
export const STREAMWORLD_MUSIC_KERNEL_ALLOWANCE = 0;
// engine/rpg.asm's check_encounter/start_encounter, the brief's one named
// term for both (Part F). Fix round 1 (finding 1): a streamed screen's
// encounter rate and formation now resolve for real, through cur_map (the
// owning map's raw index, already set at the landing by
// apply_map_music_direct via sw_resolve_screen) instead of
// screen_map[ord_screen], which has no row for a streamed screen. Each
// routine adds one pure 9-byte shortcut (`lda <map_is_streamed` / `beq` /
// `lda`-or-`ldy <cur_map` / `jmp`, all zero-page operands); the ord_screen/
// flat_screen swap that follows costs nothing extra, the same reasoning
// STREAMWORLD_MUSIC_KERNEL_ALLOWANCE documents. Combined: 9 + 9 = 18.
// RPG-only: rpg.asm's entire contents assemble inside `.if BATTLE_ENABLED`,
// so this is gated on that too, the same as every other RPG-only term on
// this page.
export const STREAMWORLD_ENCOUNTER_KERNEL_ALLOWANCE = 18;
// engine/banks.asm's call_battle: phase 2 slice 6's own strip-cancellation
// guard (`lda #0` / `sta st_active`, gated `.if STREAMING_ENABLED` inside the
// routine's own `.if BATTLE_ENABLED` body) -- st_active lives above zero
// page ($05B5), so `sta st_active` assembles as 3-byte absolute, plus the
// 2-byte `lda #0` = 5. Measured directly (kernel-lo real usage with and
// without this addition, both game types on UNROM 512): 7330 -> 7335 on RPG
// (+5, matches exactly), 7120 -> 7120 on action (+0, correctly gated -- an
// action project's call_battle body never assembles at all). RPG-only, same
// as STREAMWORLD_ENCOUNTER_KERNEL_ALLOWANCE above, since call_battle only
// exists at all inside `.if BATTLE_ENABLED`.
export const STREAMWORLD_BATTLE_STRIP_CANCEL_KERNEL_ALLOWANCE = 5;
// engine/combat.asm's init_session: a streamed landing is about to
// overwrite both of these for real, but they're cleared defensively on
// every "new game" anyway so a stale value from the previous session's
// image state never survives into a reactive read that could in principle
// run before the first landing does -- `sta <map_is_streamed` + `sta
// <ord_screen`, 4 bytes, both zero page. Unconditional whenever streaming
// is on (init_session runs on every boot and game-over restart, not gated
// on game type or any other feature) -- the one term Part F's own listed
// consumers didn't name but that the worst-case margin test below caught:
// omitting it left kernelCodeBytes 4 bytes short of real usage on every
// streamed project, flat regardless of shape, game type or which other
// conditional terms were also active.
export const STREAMWORLD_INIT_SESSION_KERNEL_ALLOWANCE = 4;
// Phase 2 slice 5: engine/combat.asm's hurt_player -- the map_is_streamed
// dispatch into sw_kb_timer/sw_kb_acc (the streamed-map knockback's own
// 16-frame/1.5px accumulator start) versus the ordinary kb_timer=
// KNOCKBACK_TIME set (measureStreamedSpan, hurt_player_kb_sw_dispatch/
// hurt_player_kb_sw_done -- 0 bytes when STREAMING_ENABLED is off, the same
// bracket convention as update_player_knock/update_player_knock_ord).
// !BATTLE_ENABLED-gated same as hurt_player itself and
// STREAMWORLD_KNOCKBACK_KERNEL_HI_ALLOWANCE above (an RPG has no knockback
// concept, streamed or ordinary, and hurt_player does not even assemble
// there). Kernel-lo (engine/combat.asm assembles before the kernel-hi
// streamed-worlds package). Measured directly, not assumed near-zero.
export const STREAMWORLD_HURT_PLAYER_KERNEL_ALLOWANCE = 17;
// Phase 2 slice 5: engine/combat.asm's init_session -- the defensive
// sw_kb_timer/sw_kb_acc clear (a stale nonzero sw_kb_timer surviving a game
// over would run the streamed-knockback dispatch on the very first frame of
// a new session), the same reasoning STREAMWORLD_INIT_SESSION_KERNEL_
// ALLOWANCE above already documents for map_is_streamed/ord_screen, but its
// own separate bracket (init_session_kb_dispatch/init_session_kb_done) and
// term since this one is ALSO gated `.if !BATTLE_ENABLED` (an RPG never
// allocates the bytes any use, unlike map_is_streamed/ord_screen which both
// game types clear). Kernel-lo. Measured directly.
export const STREAMWORLD_KB_INIT_KERNEL_ALLOWANCE = 6;
// engine/screens.asm's rebuild_bound_cache: a streamed CURRENT screen
// returns an empty cache rather than reading a stale row -- Part D refuses a
// streamed map its own bound tile, but tile_switch_changed can still reach
// this reactively from an ordinary map's own Set/Clear while the player
// stands on a streamed screen. `lda/beq/stx bind_count/rts` -- 8 bytes
// (`stx bind_count` is absolute, not zero page: bind_count lives at $0557).
// Gated on BOTH projectUsesStreaming and projectUsesBoundTiles --
// rebuild_bound_cache's entire body, this branch included, assembles only
// inside `.if BOUND_TILE_ENABLED`, so a streamed project that never
// authors a bound tile anywhere (including its ordinary maps) pays nothing.
export const STREAMWORLD_BOUND_CACHE_KERNEL_ALLOWANCE = 8;
// engine/player.asm's cross_left/cross_right/cross_up/cross_down. Phase 2
// slice 4b originally replaced Part C's interim wall (every edge solid
// while the CURRENT screen is streamed) with a real per-direction crossing
// arm inside these four routines themselves (a grid-boundary "clamp edges"
// guard plus a snap of the leaving axis) -- STREAMWORLD_CROSS_KERNEL_
// ALLOWANCE used to price that, flat 21+27+21+27 = 96 bytes. Fix round 1
// (streamed-worlds-phase2-s4b-fix1, finding 1) found that design itself
// defective (a held crossing needs to land mid-frame at the TRUE 256(X)/
// 240(Y) boundary with its signed overshoot, not snap to MAX_X/MAX_Y on the
// FOLLOWING frame) and moved the real crossing entirely into
// sw_pstep_left/right/up/down (engine/streamworld.asm) instead, reached
// straight from sw_update_player, never from cross_left/right/up/down --
// sw_update_player never falls through to move_left/right/up/down. That
// left cross_left/right/up/down exactly as they were before slice 4b: pure
// ordinary-screen crossing code with no map_is_streamed branch, no
// grid-boundary guard, and no streaming-conditional byte cost beyond the
// STREAMING_ENABLED ord_screen/flat_screen operand choice already priced by
// STREAMWORLD_CROSS_TRANSLATE_KERNEL_ALLOWANCE's call-site half below (a
// `ldy <ord_screen`/`ldy <flat_screen` swap costs the same 2 bytes either
// way). Re-measured directly (test/unit/kernelbytes.test.js's own
// measureStreamedSpan region-delta technique, cross_left..cross_none,
// streamed minus unstreamed baseline: 21 exactly, matching
// STREAMWORLD_CROSS_TRANSLATE_KERNEL_ALLOWANCE alone with nothing left
// over) -- the old per-direction dispatch this constant priced is fully
// gone, not merely relabeled, so it is retired rather than zeroed in place.
// engine/player.asm's cross_set_screen: a real crossing runs through this
// helper instead of a bare `sta <flat_screen`, so flat_screen stays the
// global id (decision 2, never a compacted index) while ord_screen adopts
// the newly-crossed-to compacted index too -- the delta-based fix for the
// stale/wrong-value defect sabotage case 8 names. The helper itself
// (`pha/sec/sbc/clc/adc/sta/pla/sta/rts`, two 2-byte zero-page operands,
// six 1-byte implied ones) is a fixed 13 bytes, unconditional under
// STREAMING_ENABLED regardless of camera axis config. Each of its 8 call
// sites (the slide branch and the cut fallback, times all 4 directions)
// replaces a 2-byte `sta <flat_screen` with a 3-byte `jsr cross_set_screen`,
// +1 byte each -- and all 8 always assemble: a streamed map only ever
// reaches the build on UNROM 512 with four-screen mirroring (the only ring
// implemented so far, shared/project.js's own streamed-map validation), and
// cameraAxes answers both axes true under four-screen, so there is no
// camera-axis-dependent variant to track here.
export const STREAMWORLD_CROSS_TRANSLATE_KERNEL_ALLOWANCE = 13 + 8;
// Fix round 1, finding 3: a streamed landing must not inherit the previous
// OWNER screen's active bound-tile cache -- both landing-site copies of the
// resolve-and-render dispatch (engine/boot.asm's boot_streamed_landing,
// engine/screens.asm's redraw_screen_dispatch) now call rebuild_bound_cache,
// which itself already takes the empty-cache branch whenever map_is_streamed
// is set (STREAMWORLD_BOUND_CACHE_KERNEL_ALLOWANCE, above). Each call site is
// `jsr rebuild_bound_cache` inside `.if BOUND_TILE_ENABLED` -- a fixed 3
// bytes, falling inside the SAME bracketed spans STREAMWORLD_RESOLVER_
// KERNEL_ALLOWANCE/STREAMWORLD_REDRAW_KERNEL_ALLOWANCE already measure, so
// those two constants stay correct for a project with no bound tiles
// (BOUND_TILE_ENABLED off, 0 bytes either way) and this is the marginal
// term for a project that has both streaming AND a bound tile somewhere.
export const STREAMWORLD_LANDING_BOUND_CACHE_KERNEL_ALLOWANCE = 2 * 3;
// Fix round 1, finding 2: an ordinary landing reached AFTER a streamed one
// (a Warp back off the streamed map) must reset cam_x_lo/cam_y_lo/cam_nt to
// (0,0,0) rather than inherit the streamed screen's own nonzero values --
// engine/screens.asm's redraw_screen_ordinary body, right before
// enable_rendering (`lda #0` + three zero-page `sta`, 8 bytes). Cold boot's
// OWN ordinary path (engine/boot.asm) needs no equivalent: reset's own
// boot_clear loop zeroes all of $0000-$07FF (cam_x_lo/y_lo/nt included)
// before that path ever runs, and it runs exactly once, so the reset there
// would be unreachable dead weight, not a real fix.
export const STREAMWORLD_ORDINARY_CAM_RESET_KERNEL_ALLOWANCE = 8;
// Fix round 1, finding 5: engine/script.asm's tile_switch_changed carries a
// SECOND streamed guard of its own, distinct from
// STREAMWORLD_BOUND_CACHE_KERNEL_ALLOWANCE's rebuild_bound_cache guard above
// -- rebuild_bound_cache_dispatch already leaves the active cache empty for
// a streamed CURRENT screen, but tile_switch_changed's own second, ROM-side
// walk (queuing visual flips) must ALSO refuse to index screen_bound_lo/hi
// by ord_screen when the current screen is streamed, since a streamed
// screen has no row in that table at all. `lda <map_is_streamed` + `bne
// tsc_done`, 4 bytes, gated on the same projectUsesStreaming &&
// projectUsesBoundTiles predicate (tile_switch_changed's whole body already
// assembles only inside `.if BOUND_TILE_ENABLED`).
export const STREAMWORLD_TILE_SWITCH_KERNEL_ALLOWANCE = 4;
// Phase 2 slice 4a (docs/design-streamed-worlds.md §5): engine/boot.asm's own
// NMI arbitration splice (nmi_vram_dispatch..nmi_scroll) REPLACES the six-
// line "drain if ready" the .else arm still carries for an ordinary project,
// rather than adding a branch in front of code that stays -- unlike every
// other term on this page, so this is the net delta (streaming's own span
// minus the .else arm's own span it displaces), not the streaming span
// alone. Measured directly (both spans exist unconditionally, bracketed by
// the same two labels either way): 24, flat across action/RPG/mixed.
// PALETTE_FX_ENABLED (Fade or Flash somewhere in the project) grows this by
// a further 8 -- STREAMWORLD_NMI_PALETTE_FX_KERNEL_ALLOWANCE below -- the
// $2006/$2006 VRAM-address-park block appears TWICE in the streaming arm
// (the reduced-drain path and the exclusive-drain path each carry their own
// copy) but only ONCE in the .else arm it replaces, so the net delta grows
// by one extra copy's worth (8 bytes) rather than staying flat the way a
// purely-additive term's PALETTE_FX_ENABLED interaction usually would.
export const STREAMWORLD_NMI_KERNEL_ALLOWANCE = 24;
export const STREAMWORLD_NMI_PALETTE_FX_KERNEL_ALLOWANCE = 8;
// Phase 2 slice 4a: the OAM-build projection wiring, one combined term for
// both call sites (engine/oam.asm's build_oam_draw_dispatch branch plus the
// build_oam_draw_sw routine it reaches; engine/entities.asm's identical
// draw_one_entity_show branch plus the streamed projection block ending at
// draw_one_entity_animate) -- STREAMWORLD_SPAWN_KERNEL_ALLOWANCE's own
// precedent for naming one consumer's several sub-blocks as a single term.
// Both sites are purely additive (the ordinary body stays, unconditional,
// either way), unlike the NMI splice above, so each site's own span
// (nesasm's real symbol table, test/unit/kernelbytes.test.js) is exactly
// its own new-byte count, no baseline subtraction needed: oam.asm 4
// (branch) + 108 (build_oam_draw_sw..build_oam_draw_sw_end) = 112,
// entities.asm 4 (branch) + 167 (draw_one_entity_ordinary_join..
// draw_one_entity_animate) = 171, combined 283, PLUS a third entities.asm
// term that -- unlike those two -- is a REPLACE, not a purely-additive
// bracket: draw_one_entity_hurt_dispatch/draw_one_entity_show costs the
// ordinary build its original 2-byte bne either way, and a streamed build
// 5 bytes (a jmp's-worth more), so only the 3-byte streamed-minus-ordinary
// delta belongs here (kernelbytes.test.js's own double-difference
// technique, identical to how the NMI splice below is measured). The
// entities.asm terms grew (45 -> 167, and a new +3) in the round-1 review
// fix (real per-tile projection for entities, replacing origin-only
// projection -- docs/design-streamed-worlds.md §7 rulings 3/4, phase 2
// slice 4a round 1 review finding 2): the join span now also duplicates
// entity_animation's own NO_ANIM/metasprite-id lookup (needed before X is
// safe to spend on the per-tile projection calls, finding 1 of the same
// review) rather than sharing it with draw_one_entity_animate's tail, and
// that much larger streamed-only routine is what pushes draw_one_entity's
// own ent_hurt dispatch out of a plain bne's +-128 range in a streaming
// build alone. Combined: 283 + 3 = 286. A raw whole-kernel-lo-bank-USED
// delta reads smaller than this (conflating it with an unrelated TABLE-
// region shrink: an ordinary screen costs its own screen_ent_lo/hi row
// that a streamed screen's own entity data, stored in the streamed region
// instead, does not -- forcing map.streamed off to build the baseline for
// a delta measurement adds that row back, which has nothing to do with
// this code) -- kernelCodeBytes' own `used - (resetAddr - 0xC000)`
// convention (the worst-case margin test's own technique) is what strips
// that confound out, and cross-checked against it this term reads exactly
// 286. Flat across action/RPG/mixed.
export const STREAMWORLD_PROJECT_KERNEL_ALLOWANCE = 286;
// Phase 2 slice 3 (docs/design-streamed-worlds.md §7, ruling 7): move_tick's
// own streamed-player bound/crossing-probe arms in engine/entities.asm
// (kernel-lo only -- the resident sw_move_probe/sw_move_probe_solid pair
// this code calls into is a SEPARATE kernel-hi term,
// STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE, below; fix round 1, finding 2
// corrected this comment, which previously folded the resident helper's own
// bytes into this kernel-lo figure by mistake). Every byte here is gated
// `.if STREAMING_ENABLED`, so an ordinary (non-streamed) project pays
// nothing regardless of Move. Measured in isolation
// (test/unit/kernelbytes.test.js): streamed-with-Move minus streamed-
// without-Move, minus the ordinary project's own Move-on/off delta (348 =
// MOVE_KERNEL_ALLOWANCE + FACE_KERNEL_ALLOWANCE, cross-checked directly, not
// assumed, since it must not have drifted) -- the streaming-only remainder,
// flat across action, RPG and the mixed shape. Fix round 1, finding 4
// removed the clamp-to-the-true-edge arms this figure used to include: the
// streamed player's own wall is now the ordinary wall's shape with a wider
// bound (an add that carries or a candidate of 240 is itself the wall for
// right/down; a borrow is the wall for left/up, identical to the ordinary
// bound so left/up need no separate wall arm at all any more), and finding
// 1's probe-normalization arms (all four directions, not just right/down)
// were added in the same pass -- both changes re-measured together, never
// derived by adding one fix's own byte count to the prior figure by hand.
export const STREAMWORLD_MOVE_KERNEL_ALLOWANCE = 159;
// Fix round 1, finding 2: sw_move_probe/sw_move_probe_solid (engine/
// streamworld.asm) are the resident half of ruling 7's own probe-crossing
// mechanism -- kernel-HI, not kernel-lo, and gated `.if MOVE_ENABLED` inside
// the already-`.if STREAMING_ENABLED` file, so a streamed project with no
// live Move command pays nothing extra in kernel-hi either. Measured the
// same isolated way as the kernel-lo term above (streamed-with-Move minus
// streamed-without-Move, minus the ordinary project's own kernel-hi Move
// delta -- fix round 2: that ordinary delta is 9 bank bytes of compiled
// event data (the Move command's own operands), but its ENGINE-CODE
// contribution is 0 -- an ordinary project's Move code never touches the
// $E000 bank at all, only its own compiled event bytes live there), flat
// across action, RPG and the mixed shape.
export const STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE = 76;
// Phase 2 slice 4b (docs/design-streamed-worlds.md §5, the continuous
// movement driver): engine/player.asm's update_player_knock own streamed
// dispatch branch -- `lda <map_is_streamed / bne` into the capped (1px,
// SW_KNOCKBACK_SPEED) knockback step instead of the ordinary 3px one, 7
// bytes, gated `.if STREAMING_ENABLED`. Measured
// (test/unit/kernelbytes.test.js's own measureStreamedSpan,
// update_player_knock/update_player_knock_ord), flat across action/RPG/
// mixed.
export const STREAMWORLD_UPDATE_PLAYER_DISPATCH_KERNEL_ALLOWANCE = 7;
// Phase 2 slice 4b: sw_event_freeze's own two call sites -- engine/
// input.asm's do_talk (armed the same frame an interact opens a
// conversation, so a page with nothing to wait on can't also let the
// player step that frame) and engine/boot.asm's main_loop_idle (cleared
// every frame gameplay is live, mirroring how dash_on itself is refreshed
// rather than latched). Each site is `lda #imm/sta <sw_event_freeze` -- 4
// bytes -- summed into one term, the STREAMWORLD_LANDING_BOUND_CACHE_
// KERNEL_ALLOWANCE precedent for a two-call-site term. Both gated `.if
// STREAMING_ENABLED`. Measured (measureStreamedSpan, do_talk_freeze_
// dispatch/do_talk_freeze_done and main_loop_idle_freeze_dispatch/
// main_loop_idle_freeze_done), flat across action/RPG/mixed.
export const STREAMWORLD_EVENT_FREEZE_KERNEL_ALLOWANCE = 4 + 4;
// Phase 2 slice 4b, orchestrator ruling 9: player_hazard's own straddling-
// probe dispatch (engine/combat.asm) -- kernel-lo, unconditional (every
// streamed project pays it, not merely a Move-using one): the dx-capture
// triple right after the probe_x add (5 bytes) plus the map_is_streamed
// dispatch into sw_hazard_probe_type vs. the ordinary probe_type fallthrough
// (10 bytes), summed into one term the same way STREAMWORLD_EVENT_FREEZE_
// KERNEL_ALLOWANCE sums its own two call sites. Measured (measureStreamedSpan,
// player_hazard_dx_capture/player_hazard_dx_capture_end and player_hazard_
// dispatch/player_hazard_dispatch_end), flat across action/RPG/mixed: 5 + 10.
export const STREAMWORLD_HAZARD_KERNEL_ALLOWANCE = 5 + 10;
// Phase 2 slice 7b: the dialogue lifecycle's call-site hooks scattered
// across engine/text.asm's twelve pre-existing `.if STREAMING_ENABLED`
// blocks (each now also dispatches into the new lifecycle/mapper routines
// added to streamworld.asm's sw_dlg_mapper_start..end span, itself costed
// separately by STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE above --
// that is kernel-HI; this is the kernel-LO call-site overhead at each of
// the twelve sites) plus engine/boot.asm's own camrelease_call_gs..ge
// (the main_loop_idle poll for sw_dlg17_camrelease). Every site is `.if
// TEXT_ENABLED` nested inside text.asm's own `.if STREAMING_ENABLED`, or
// (the boot.asm site) `.if STREAMING_ENABLED / .if TEXT_ENABLED` directly,
// so a streamed project with no text pays nothing -- gated on
// projectUsesStreaming && projectUsesText, the STREAMWORLD_DIALOGUE_MAPPER_
// KERNEL_HI_ALLOWANCE precedent. Measured directly off nesasm's own symbol
// table with the unconditional-boundary-label technique (one guard_start/
// guard_end pair per site, summed), flat across action/RPG/mixed: 226, then
// 231 once fix round 1's own A1/A2/A5 edits landed, then 118 once fix
// round 1's own A4 relocated the first six of the thirteen sites (each
// down to a 7-byte dispatch).
// Fix round 2 (review round 2, finding A4): Chris's 2026-09-25 ruling --
// "Name and equality-assert the kernel-lo terms per site, replacing the
// single 118-byte term." The remaining six sites (box_begin, text_tick,
// text_arrow_write, choice_cursor, text_close_step, text_close_attr_tail)
// now relocate the same way, leaving all twelve text.asm sites at a
// uniform 7-byte dispatch (`lda <sw_dlg15_state`-or-`<map_is_streamed` /
// branch / jmp), plus boot.asm's own 3-byte unconditional camrelease poll
// (`jsr sw_dlg17_camrelease`, no dispatch needed -- it is called
// unconditionally from main_loop_idle regardless of streamed/ordinary,
// the poll IS the dispatch). Each of the thirteen names its own site,
// equality-asserted individually (test/unit/kernelbytes.test.js) rather
// than only as a combined sum, per the ruling. Measured directly off
// nesasm's own symbol table, one guard_start/guard_end pair per site, flat
// across action/RPG/mixed.
export const STREAMWORLD_DIALOGUE_BOX_BEGIN_KERNEL_ALLOWANCE = 7;
export const STREAMWORLD_DIALOGUE_TEXT_TICK_KERNEL_ALLOWANCE = 7;
export const STREAMWORLD_DIALOGUE_TEXT_OPEN_ROW_KERNEL_ALLOWANCE = 7;
export const STREAMWORLD_DIALOGUE_TEXT_OPEN_ATTR_KERNEL_ALLOWANCE = 7;
export const STREAMWORLD_DIALOGUE_TEXT_PUT_CHAR_KERNEL_ALLOWANCE = 7;
export const STREAMWORLD_DIALOGUE_TEXT_ARROW_WRITE_KERNEL_ALLOWANCE = 7;
export const STREAMWORLD_DIALOGUE_TEXT_CLEAR_STEP_KERNEL_ALLOWANCE = 7;
export const STREAMWORLD_DIALOGUE_TEXT_CHOICE_STEP_KERNEL_ALLOWANCE = 7;
export const STREAMWORLD_DIALOGUE_CHOICE_CURSOR_KERNEL_ALLOWANCE = 7;
export const STREAMWORLD_DIALOGUE_TEXT_CLOSE_STEP_KERNEL_ALLOWANCE = 7;
export const STREAMWORLD_DIALOGUE_TEXT_CLOSE_ATTR_KERNEL_ALLOWANCE = 7;
export const STREAMWORLD_DIALOGUE_TEXT_CLOSE_ATTR_TAIL_KERNEL_ALLOWANCE = 7;
export const STREAMWORLD_DIALOGUE_CAMRELEASE_KERNEL_ALLOWANCE = 3;
// The combined thirteen-site total -- kept as its own export since the
// capacity accounting below (and several existing tests) charge the whole
// lifecycle call-site cost as one addend, the identical STREAMWORLD_
// HAZARD_KERNEL_ALLOWANCE/STREAMWORLD_EVENT_FREEZE_KERNEL_ALLOWANCE
// precedent of summing several named per-site constants into one exported
// sum rather than repeating the addition at every call site.
export const STREAMWORLD_DIALOGUE_LIFECYCLE_KERNEL_ALLOWANCE =
  STREAMWORLD_DIALOGUE_BOX_BEGIN_KERNEL_ALLOWANCE +
  STREAMWORLD_DIALOGUE_TEXT_TICK_KERNEL_ALLOWANCE +
  STREAMWORLD_DIALOGUE_TEXT_OPEN_ROW_KERNEL_ALLOWANCE +
  STREAMWORLD_DIALOGUE_TEXT_OPEN_ATTR_KERNEL_ALLOWANCE +
  STREAMWORLD_DIALOGUE_TEXT_PUT_CHAR_KERNEL_ALLOWANCE +
  STREAMWORLD_DIALOGUE_TEXT_ARROW_WRITE_KERNEL_ALLOWANCE +
  STREAMWORLD_DIALOGUE_TEXT_CLEAR_STEP_KERNEL_ALLOWANCE +
  STREAMWORLD_DIALOGUE_TEXT_CHOICE_STEP_KERNEL_ALLOWANCE +
  STREAMWORLD_DIALOGUE_CHOICE_CURSOR_KERNEL_ALLOWANCE +
  STREAMWORLD_DIALOGUE_TEXT_CLOSE_STEP_KERNEL_ALLOWANCE +
  STREAMWORLD_DIALOGUE_TEXT_CLOSE_ATTR_KERNEL_ALLOWANCE +
  STREAMWORLD_DIALOGUE_TEXT_CLOSE_ATTR_TAIL_KERNEL_ALLOWANCE +
  STREAMWORLD_DIALOGUE_CAMRELEASE_KERNEL_ALLOWANCE;
// Phase 2 slice 7b: engine/boot.asm's nmi_oam_guard_start..end -- the
// cam_dirty check that skips OAM DMA for a frame while a dialogue's camera
// nudge briefly holds cam_dirty (sw_dlg15_pending_step/sw_dlg17_camrelease,
// engine/streamworld.asm). Fix round 1 (review round 1, finding A5): the
// only production writer of cam_dirty during a dialogue is text.asm's own
// lifecycle, itself `.if TEXT_ENABLED` -- a streamed project with no text
// can never see cam_dirty nonzero here, so the guard is now nested `.if
// STREAMING_ENABLED / .if TEXT_ENABLED` too (it was unconditional inside
// just `.if STREAMING_ENABLED` before this fix, which cost a streaming-
// without-text build 4 bytes its pre-7b build never paid). Gated here on
// projectUsesStreaming && projectUsesText, the STREAMWORLD_DIALOGUE_MAPPER_
// KERNEL_HI_ALLOWANCE precedent. Measured directly (measureStreamedSpan,
// nmi_oam_guard_start/nmi_oam_guard_end), flat across action/RPG/mixed: 4
// with text, 0 without.
export const STREAMWORLD_OAM_GUARD_KERNEL_ALLOWANCE = 4;
// Phase 2 slice 4b: the window/camera-window region in engine/
// streamworld.asm (sw_win_col_inc/dec, sw_win_row_inc/dec, sw_win_
// entering_col_right/row_down, sw_frame_camera_window, sw_win_arm) --
// kernel-hi, unconditional (no BATTLE_ENABLED interior gate, unlike
// sw_knockback_step just below). Measured (measureStreamedSpan,
// sw_win_col_inc/sw_win_arm_region_end), flat across action/RPG/mixed:
// 816. Fix round 1 (finding 2, ruling B) grew this again, from 816 to
// 834: sw_frame_camera_window now publishes the full clamped world-space
// origin (sw_cam_origin_x/y_lo/hi) alongside the physical scroll every
// frame under the same cam_dirty lock, not only at a landing -- the
// oam.asm/entities.asm sw_project_axis consumers read that origin, not
// cam_x_lo/cam_y_lo, so a continuous walk needs it kept live. Re-measured
// directly (measureStreamedSpan, same boundary labels): 834, flat across
// action/RPG/mixed. The "landing" slice grew this again, from 834 to 866:
// the per-frame recompute (worldX/Y, the clamp, the desired-window divmods)
// is factored out of sw_frame_camera_window into its own
// sw_camera_window_recompute, called by two entry points in this same
// span -- sw_frame_camera_window itself (jsr recompute / jmp sw_win_arm,
// the ordinary per-frame tracking path, unchanged behaviour) and the new
// sw_camera_window_install (jsr recompute, then four loads/stores copying
// the desired window straight into win_col/row screen+local), the landing
// path's own single reuse of tracking's clamp/centre arithmetic rather than
// a second copy of it (sw_resolve_divdone, engine/streamworld.asm, now just
// `jsr sw_enter_screen` / `jmp sw_camera_window_install`). Re-measured
// directly (measureStreamedSpan, same boundary labels): 866, flat across
// action/RPG/mixed. Phase 2 slice 6 grew this again, from 866 to 1209: the
// position-jump guard (sw_position_jump_guard/sw_pjg_check/sw_pjg_lag_trip)
// lands inside this same bracket -- called from sw_frame_camera_window right
// after sw_camera_window_recompute -- rather than opening a new bracket of
// its own, the identical reasoning the landing slice gave for reusing this
// span over opening a second one. Re-measured directly (measureStreamedSpan,
// same boundary labels): 1209, flat across action/RPG/mixed (confirmed by a
// real build of both game types, not assumed from one). Fix round 1 grew
// this again, from 1209 to 1225: finding 2's outer cam_dirty hold
// (sw_frame_camera_window's own `inc <cam_dirty` before the recompute/check
// pair, and the `dec <cam_dirty` on both the ordinary-frame release and
// sw_position_jump_guard's own end, replacing sw_camera_window_recompute's
// formerly-innermost release) plus finding 3's OAM DMA
// (`lda #$00 / sta $2003 / lda #$02 / sta $4014`, sw_position_jump_guard,
// before the resume sequence) both land inside this same bracket. Re-
// measured directly (measureStreamedSpan, same boundary labels): 1225, flat
// across action/RPG/mixed (confirmed by a real build of both game types).
// Fix round 1 (finding 4) then shrank this, from 1225 to 1102: sw_pjg_check/
// sw_pjg_lag_trip no longer total each axis's current and desired origins to
// a 16-bit block count via a 4-iteration shift-and-add per side before
// comparing them -- they compare screen indices first (equal screens need
// only the local-coordinate difference; adjacent screens need that
// difference adjusted by one axis's own screen span; origins two or more
// screens apart necessarily exceed the lag threshold without any further
// arithmetic), so the four shift loops and the 16-bit add/subtract pairs
// are gone. Re-measured directly (measureStreamedSpan, same boundary
// labels): 1102, flat across action/RPG/mixed (confirmed by a real build of
// both game types).
export const STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE = 1102;
// Phase 2 slice 5: sw_update_player's own streamed-knockback branch
// (engine/streamworld.asm's sw_knockback_step, now the accepted-hypothesis
// 16-frame/1.5px-average accumulator-driven pacing, not slice 4b's interim
// 8-frame/1px-flat run) -- kernel-hi, gated `.if !BATTLE_ENABLED` (mixed-
// projects/action only, per the brief's own scope: an RPG's knockback stays
// the ordinary battle-system one). nesasm emits no symbol at all for a
// label inside a false `.if`, so this measured 0 on an RPG build (no span
// to take -- sw_knockback_step_end's own address is never reached by a
// build where the block never assembles), confirmed by the label lookup
// throwing rather than by assuming the old "shares an address with what
// follows" model. Grown from slice 4b's own 32 to 50 on action/mixed: the
// dispatch body's `dec <kb_timer`/`lda #SW_KNOCKBACK_SPEED` pair (a 2-byte
// zero-page DEC plus a 2-byte immediate load) is replaced by `dec
// sw_kb_timer` (3 bytes, absolute -- not zero page; zero page is fully
// committed, engine/constants.asm's own mv_ent comment) and `jsr
// sw_kb_step_pixels` (3 bytes) -- net +2 in the dispatch body -- plus the
// new sw_kb_step_pixels helper itself (16 bytes: an absolute lda/sta pair
// for the accumulator, clc/adc/two immediate loads/bcc/rts). Measured
// directly (measureStreamedSpan, same boundary labels), not derived by hand.
export const STREAMWORLD_KNOCKBACK_KERNEL_HI_ALLOWANCE = 50;
// Phase 2 slice 4b: sw_update_player itself (engine/streamworld.asm) --
// the per-frame driver dispatch: the sw_event_freeze check, the capped-
// knockback branch above, axis arbitration via sw_axis_pref, the
// accumulator dispatch into sw_pstep_left/right/up/down (fix round 1,
// finding 1 -- no longer cross_left/right/up/down, which never see a
// streamed crossing at all any more), player_hazard/check_encounter, and
// the tail call into sw_frame_camera_window -- kernel-hi. Game-type-
// varying: two blocks inside its own body are each gated on BATTLE_ENABLED
// in opposite directions -- an action-only `.if !BATTLE_ENABLED`
// knockback-dispatch arm near the top and an RPG-only `.if BATTLE_ENABLED`
// check_encounter call near the bottom -- net difference +3 action over
// rpg, exactly the measured 171-vs-167 gap (170-vs-167 before phase 2 slice
// 5, and 135-vs-132 before that, since fix round 1's growth -- findings
// 1/4/7: the true 256/240 ownership commit and flat_screen update now live
// in sw_pstep_left/right/up/down rather than here, but the screen_fresh
// gate that arms them and the walk-animation restore on a same-frame
// crossing (finding 7) both grew this body directly -- is identical on
// both game types). Measured (measureStreamedSpan, sw_update_player/
// sw_update_player_end) on both game types; the mixed shape (action
// gameType, mixed:true) measures identical to plain action, confirming
// this varies on gameType alone, not on mixed-ness. Mirrors
// ITEM_EFFECT_KERNEL_ALLOWANCE_BY_GAME_TYPE's own by-game-type shape,
// above. Phase 2 slice 5: action grew 170 -> 171 -- the top-of-body
// knockback-timer read (`lda <kb_timer`, gated `.if !BATTLE_ENABLED`, so
// RPG's own 167 is untouched) became `lda sw_kb_timer`, a zero-page load
// replaced by an absolute one (+1 byte), same reasoning as the knockback
// dispatch body's own DEC above.
export const STREAMWORLD_UPDATE_PLAYER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE = { action: 171, rpg: 167 };
const FALLBACK_STREAMWORLD_UPDATE_PLAYER_KERNEL_HI_ALLOWANCE = Math.max(
  ...Object.values(STREAMWORLD_UPDATE_PLAYER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE)
);
export function streamworldUpdatePlayerKernelHiAllowance(project) {
  return (
    STREAMWORLD_UPDATE_PLAYER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE[project.project?.gameType] ??
    FALLBACK_STREAMWORLD_UPDATE_PLAYER_KERNEL_HI_ALLOWANCE
  );
}
// Phase 2 slice 4b, orchestrator ruling 9: sw_hazard_probe_type (engine/
// streamworld.asm) -- player_hazard's own straddling-collision probe for a
// scripted player Move's wider ownership rectangle. Kernel-hi, unconditional
// (not gated on MOVE_ENABLED or BATTLE_ENABLED -- player_hazard calls this
// on every streamed screen regardless of either). Measured
// (measureStreamedSpan, sw_hazard_probe_type/sw_hazard_probe_type_end), flat
// across action/RPG/mixed. Fix round 2 finding C: sw_hazard_probe_cross's
// tail collapsed from `jsr sw_terrain_or_fill / tay / lda mt_collision,y /
// rts` to `jsr sw_terrain_or_fill_solid_type / rts`, -4 bytes: 68 -> 64.
export const STREAMWORLD_HAZARD_KERNEL_HI_ALLOWANCE = 64;
// script_op_join's own growth (engine/script.asm) -- RPG-only, since Join is
// itself an RPG-only command.
// Re-measured for the zero-page kernel diet: 63 (down from 64).
export const JOIN_NAMING_KERNEL_ALLOWANCE = 63;
// start_game's own naming arm (engine/title.asm) -- both game types.
// Unchanged by the zero-page kernel diet: start_game's own naming arm
// measures identically (10) in both scopes -- observed, not yet traced to a
// specific reason.
export const HERO_NAMING_KERNEL_ALLOWANCE = 10;
// reset's own titleless naming arm (engine/boot.asm) -- only paid when there
// is no title screen to reach start_game through instead.
// Re-measured for the zero-page kernel diet: 14 (down from 15).
export const HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE = 14;
// The naming grid's own body (engine/nameentry.asm, nameentry_begin through
// draw_nameentry_cursor) when it has nowhere else to live: on an RPG this is
// banked (NAME_ENTRY_BATTLE_ALLOWANCE, battletables.js), charged here only
// when NAME_ENTRY_BANKED is false -- an action project, which never has a
// battle bank to hold it in. Measured, not the pre-implementation static
// count of 722: identical on NROM, MMC1, MMC3 and UNROM 512 (nothing here
// branches on SPLIT_ENABLED or any other mapper-specific fact), computed as
// the one combined post-reset delta a naming-on action build (titled or
// titleless, both agree) can isolate, minus NAME_ENTRY_KERNEL_ALLOWANCE,
// HERO_NAMING_KERNEL_ALLOWANCE (both shared with the RPG placement above)
// and HERO_DEFAULT_KERNEL_ALLOWANCE's own 11 (the copy loop alone --
// hero_name_default's own 10-byte table lives BEFORE reset, so it was never
// part of this delta to begin with; P1-2's own fix, below, is what corrects
// this term from a wrong 699 that had subtracted 21 instead of 11).
// Re-measured for the zero-page kernel diet: 683 (down from 709), in
// dependency order -- the raw combined delta this triangulates from is NOT
// the same number on both measurement paths: the titled path's own raw
// deltaTitled is 811 post-diet (down from 845 pre-diet: 709+115+10+11), the
// titleless path's own raw deltaTitleless is 825, 14 higher, because it
// carries HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE (14) as a fourth subtrahend
// the titled path never pays. What the triangulation test's own two-path
// agreement checks is that the two paths converge on the same FINAL 683 once
// each subtracts its own respective shared terms -- titled: 811 - 107 (N) -
// 10 (H) - 11 (DEFAULT) = 683; titleless: 825 - 107 (N) - 10 (H) - 14 (HT) -
// 11 (DEFAULT) = 683 -- confirmed by a real rerun of this file's own
// triangulation test rather than computed by hand -- this is the exact
// stale-subtrahend trap docs/design-kernel-diet.md's own §4/§15 predicted
// (675 + (115-107) = 683) resolved for real, not merely assumed.
export const NAME_ENTRY_ACTION_KERNEL_ALLOWANCE = 683;
// Fix round 1, finding A4/Chris's ruling 2026-09-25(b): the streamed-dispatch
// delta nameentry.asm's own `.if STREAMING_ENABLED` sites (nameentry_raise_step,
// nameentry_push, nameentry_queue_cell) add on top of NAME_ENTRY_ACTION_KERNEL_
// ALLOWANCE above, once a streamed map makes STREAMING_ENABLED true for the
// kernel-lo action placement. Measured directly rather than assumed equal to
// STREAMWORLD_NAMEENTRY_BATTLE_ALLOWANCE (main/build/battletables.js, the same
// file's own delta on the banked RPG placement) -- nameentry.asm's own header
// promise ("identical source text assembles to identical bytes on either
// placement") only covers the file's OWN body, and the first whole-bank
// measurement here came back 169, not 47: turning naming on for a project
// with no other text source also flips projectUsesText (shared/font.js --
// "the grid IS text"), which on a streamed map separately charges
// STREAMWORLD_DIALOGUE_LIFECYCLE_KERNEL_ALLOWANCE (118 at the time) and
// STREAMWORLD_OAM_GUARD_KERNEL_ALLOWANCE (4) for the first time (47+118+4 =
// 169 exactly, at fix round 1's own kernel-lo figure -- fix round 2's A4
// relocation of the remaining six sites has since dropped the lifecycle
// term to 87, so the same isolation would measure 138 today; the isolating
// TECHNIQUE below, not this historical total, is what this term's own test
// still relies on) -- both already modelled below, gated on usesText, so
// folding them into this term too would double-charge them. Re-measured against a
// streamed action project that already carries a dialogue string (so naming
// on/off no longer flips usesText, the same isolation test/unit/
// kernelbytes.test.js's own "SPLIT_KERNEL_ALLOWANCE is charged to a
// naming-only MMC3 action project" comment already names as the one case that
// needs a text-free baseline -- here it is the opposite: a text-present
// baseline, to avoid that same confound instead of demonstrating it) came back
// exactly 47, confirming the header's promise for real once the confound is
// controlled for.
export const STREAMWORLD_NAMEENTRY_ACTION_KERNEL_ALLOWANCE = 47;
// init_session's own 11-byte action-side copy loop that reads
// hero_name_default (engine/combat.asm) -- the loop ALONE, not the table:
// hero_name_default's own 10-byte .db table is charged in kernelTableBytes's
// fixedBytes instead (main/build/generate.js), gated on the identical
// projectNeedsHeroDefault predicate, because the table lives in main.asm's
// lookup-table region, BEFORE reset -- outside the region kernelCodeBytes/
// measureCodeBytes both model, the same "a code term and a table term stay
// in the ledgers they each belong to" rule the 4-byte input row already
// follows. Exact by construction (five unbranching instructions whose
// widths nesasm cannot disagree with: ldy #imm(2) + lda abs,y(3) +
// sta abs,y(3) + dey(1) + bpl(2) = 11), not measured in isolation -- see
// NAME_ENTRY_ACTION_KERNEL_ALLOWANCE's own comment for why this phase has
// no build-time lever that could isolate it from that term.
// Unchanged by the zero-page kernel diet, and provably so, not merely
// observed: five unbranching instructions (ldy #imm/lda abs,y/sta abs,y/
// dey/bpl), none a bare zero-page operand -- hero_name_default,y is
// indexed-absolute, not zero page, so `<` never applies to it at all.
export const HERO_DEFAULT_KERNEL_ALLOWANCE = 11;
// The Say token's own text_type_step arm (engine/text.asm, docs/
// design-name-entry.md §9a) -- gated on NAME_TOKEN_ENABLED alone, no
// battleEnabledFor term: text.asm is kernel-lo on every board and every game
// type. Measured (not the pre-implementation guess), nesasm-identical on
// MMC1/MMC3/UNROM 512 (test/unit/kernelbytes.test.js's own withNameToken
// isolation, sample-rpg) -- text_type_step has no SPLIT_ENABLED arm of its
// own, so this stays flat rather than becoming a *_BY_MAPPER table.
// Re-measured for the zero-page kernel diet: 55 (down from 58).
export const NAME_TOKEN_KERNEL_ALLOWANCE = 55;

export const KERNEL_SLACK = 20;

// Whether BATTLE_ENABLED itself actually assembles for `project` on `mapper`
// -- the single, shared predicate every BATTLE_ENABLED-gated allowance in
// kernelCodeBytes reads, rather than each recomputing its own copy, and the
// same predicate checkCapacity (below) consults for the project's own
// mapper before it ever calls kernelCodeBytes or battleKernelAllowance, so
// the two cannot disagree about when a battle allowance is needed at all.
// This is *not* simply `gameType === 'rpg'`. BATTLE_ENABLED (assets/
// config.inc) is `codeRegions(mapper, tilesetCount,
// codeRegionCount(project)).length > 0`, and codeRegionCount(project) is
// exactly the gameType === 'rpg' test -- but codeRegions can still come back
// empty for a CHR-RAM board whose tileset payloads have already claimed
// every switchable region, a strictly narrower condition than "is an RPG",
// and it can come back *non*-empty for a switchable-PRG board with no
// switchable CHR (UxROM, mapper 2) even though that board is not
// `rpgCapable` at all -- codeRegions only requires PRG switching,
// rpgCapable requires PRG *and* CHR. So this does not imply rpgCapable(mapper)
// on its own, which is exactly why a caller may not assume a
// BATTLE_KERNEL_ALLOWANCE_BY_MAPPER entry exists just because this is true;
// see battleKernelAllowance's own comment for the guard that follows from
// that. Charging a project for bytes that would not actually assemble is
// exactly the overcharge both BATTLE_ENABLED-gated terms in kernelCodeBytes
// exist to remove.
export function battleEnabledFor(project, mapper) {
  return battleBankEnabled(project, mapper);
}

export function kernelCodeBytes(project, mapper) {
  // saveMediaImplemented, not saveCapable: SAVE_KERNEL_ALLOWANCE_BY_MAPPER
  // only has a measured entry for a board whose save/load code actually
  // assembles -- every registered board's medium is implemented today,
  // UNROM 512 (683 base + 41 RPG supplement = 724 total, engine/flash.asm's
  // driver plus save_media_fetch/commit's own wrapper) included, so this
  // currently agrees with saveCapable everywhere. It stays saveMediaImplemented
  // rather than collapsing to saveCapable for the same reason
  // saveMediaImplemented's own comment gives: a board with no save medium at
  // all must cost nothing here regardless, and a future medium declared
  // before the engine drives it would need to cost nothing here too, exactly
  // the shape this already handles and saveCapable alone would not -- it
  // would index this table with a mapper id that has no entry for it yet.
  const usesSave = projectUsesSave(project) && saveMediaImplemented(mapper);
  // See battleEnabledFor's own comment, above, for what this is and is not
  // equivalent to.
  const battleEnabled = battleEnabledFor(project, mapper);
  // save_check_valid's own `.if BATTLE_ENABLED` range-check block -- the
  // Save-only slice of the RPG-vs-action gap (SAVE_BATTLE_KERNEL_ALLOWANCE,
  // above).
  const usesSaveBattle = usesSave && battleEnabled;
  // Every other BATTLE_ENABLED-gated byte outside save_check_valid --
  // BASE_KERNEL_CODE_BYTES_BY_MAPPER's own comment and
  // BATTLE_KERNEL_ALLOWANCE_BY_MAPPER's (below) explain what this covers and
  // why it needs its own term rather than folding into the base.
  const usesBattleBase = battleEnabled;
  const usesText = projectUsesText(project);
  const usesMove = projectUsesMove(project);
  const usesTurn = projectUsesTurn(project);
  const usesWait = projectUsesWait(project);
  const usesShake = projectUsesShake(project);
  const usesCamera = projectUsesCamera(project);
  const usesVisible = projectUsesVisible(project);
  const usesFade = projectUsesFade(project);
  const usesFlash = projectUsesFlash(project);
  const usesPaletteFx = projectUsesPaletteFx(project);
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
  const usesSplit = fontBankSplit(project, mapper);
  const usesItems = projectUsesItems(project);
  const usesSting = projectUsesSting(project);
  const usesSfx = projectUsesSfx(project);
  const usesAudioFx = projectUsesAudioFx(project); // = usesSting || usesSfx
  const usesBoundTiles = projectUsesBoundTiles(project);
  // In-game party-member naming (docs/design-name-entry.md §4/§8/§9, D8).
  // usesHeroNaming drops any "&& battleEnabled" -- an action project's own
  // battleEnabled is always false (no code region at all), so ANDing it in
  // would make hero naming unreachable on exactly the game type D6 exists to
  // add it to. usesJoinNaming keeps its own "&& battleEnabled" implicitly,
  // since projectUsesJoinNaming already refuses a non-RPG project and Join
  // naming can only ever run through the banked party_join/battle_entry
  // machinery. usesNameEntry is the plain OR of the two, not a third
  // independent battleEnabled AND of its own. nameEntryBanked is a separate,
  // placement-only fact -- where the naming code lives, never whether it is
  // live at all -- read by the two placement-conditional terms below.
  const usesHeroNaming = projectUsesHeroNaming(project);
  const usesJoinNaming = projectUsesJoinNaming(project) && battleEnabled;
  const usesNameEntry = usesHeroNaming || usesJoinNaming;
  const usesHeroNamingTitleless = usesHeroNaming && !usesTitle;
  const nameEntryBanked = battleEnabled;
  const needsHeroDefault = projectNeedsHeroDefault(project);
  const usesNameToken = projectUsesNameToken(project);
  // design-camera.md §5/Q3: CAMERA_SLIDE_ENABLED is generated from the same
  // projectUsesCamera flag CAMERA_ENABLED is (main/build/generate.js's own
  // config.inc emission) -- there is no separate schema field -- so every
  // consumer term below is gated on usesCamera too, never a second read of a
  // flag that does not exist. axisCount is one or two (never zero --
  // cameraAxes' own doc comment), from the project's own fixed mirroring
  // choice against THIS mapper.
  const cameraAxisFlags = cameraAxes(mapper, project.cartridge);
  const cameraAxisCount = (cameraAxisFlags.horizontal ? 1 : 0) + (cameraAxisFlags.vertical ? 1 : 0);
  // Phase 2 slice 2b, Part F: usesStreaming alone gates every kernel-lo
  // streaming term except the two that are ALSO gated on an existing
  // feature flag the underlying routine itself only assembles behind
  // (usesBattleBase for check_encounter/start_encounter -- rpg.asm's whole
  // file is `.if BATTLE_ENABLED` -- and usesBoundTiles for
  // rebuild_bound_cache, `.if BOUND_TILE_ENABLED`).
  const usesStreaming = projectUsesStreaming(project);
  return (
    baseKernelCodeBytes(mapper) +
    (usesBattleBase ? battleKernelAllowance(mapper) : 0) +
    (usesTitle ? titleKernelAllowance(mapper) : 0) +
    (usesSave ? SAVE_KERNEL_ALLOWANCE_BY_MAPPER[mapper.id] : 0) +
    (usesSaveBattle ? SAVE_BATTLE_KERNEL_ALLOWANCE : 0) +
    (usesMove ? MOVE_KERNEL_ALLOWANCE : 0) +
    (usesTurn ? TURN_KERNEL_ALLOWANCE : 0) +
    (usesWait ? WAIT_KERNEL_ALLOWANCE : 0) +
    (usesShake ? SHAKE_KERNEL_ALLOWANCE : 0) +
    (usesCamera ? CAMERA_KERNEL_ALLOWANCE : 0) +
    (usesCamera && usesShake ? CAMERA_SHAKE_INTERACTION_ALLOWANCE : 0) +
    (usesCamera ? CAMERA_SLIDE_KERNEL_ALLOWANCE : 0) +
    (usesCamera ? CAMERA_AXIS_KERNEL_ALLOWANCE * cameraAxisCount : 0) +
    (usesCamera && usesSplit ? CAMERA_SPLIT_INTERACTION_ALLOWANCE : 0) +
    (usesCamera && usesBoundTiles ? BOUND_TILE_CAMERA_INTERACTION_ALLOWANCE : 0) +
    (usesVisible ? VISIBLE_KERNEL_ALLOWANCE : 0) +
    (usesFade ? FADE_KERNEL_ALLOWANCE : 0) +
    (usesFlash ? FLASH_KERNEL_ALLOWANCE : 0) +
    (usesPaletteFx ? PALETTE_FX_KERNEL_ALLOWANCE : 0) +
    (usesFace ? FACE_KERNEL_ALLOWANCE : 0) +
    (usesSplit ? SPLIT_KERNEL_ALLOWANCE : 0) +
    (usesItems ? ITEM_KERNEL_ALLOWANCE + itemEffectKernelAllowance(project) : 0) +
    (usesSting ? STING_KERNEL_ALLOWANCE_STANDALONE : 0) +
    (usesSfx ? SFX_KERNEL_ALLOWANCE_STANDALONE : 0) +
    (usesAudioFx ? AUDIO_FX_KERNEL_ALLOWANCE : 0) +
    (usesSting && usesSfx ? STING_SFX_INTERACTION_ALLOWANCE : 0) +
    (usesBoundTiles ? BOUND_TILE_KERNEL_ALLOWANCE : 0) +
    (usesNameEntry ? NAME_ENTRY_KERNEL_ALLOWANCE : 0) +
    (usesJoinNaming ? JOIN_NAMING_KERNEL_ALLOWANCE : 0) +
    (usesHeroNaming ? HERO_NAMING_KERNEL_ALLOWANCE : 0) +
    (usesHeroNamingTitleless ? HERO_NAMING_TITLELESS_KERNEL_ALLOWANCE : 0) +
    (usesHeroNaming && !nameEntryBanked ? NAME_ENTRY_ACTION_KERNEL_ALLOWANCE : 0) +
    (usesHeroNaming && !nameEntryBanked && usesStreaming ? STREAMWORLD_NAMEENTRY_ACTION_KERNEL_ALLOWANCE : 0) +
    (needsHeroDefault ? HERO_DEFAULT_KERNEL_ALLOWANCE : 0) +
    (usesNameToken ? NAME_TOKEN_KERNEL_ALLOWANCE : 0) +
    (usesStreaming ? STREAMWORLD_RESOLVER_KERNEL_ALLOWANCE : 0) +
    (usesStreaming ? STREAMWORLD_REDRAW_KERNEL_ALLOWANCE : 0) +
    (usesStreaming ? STREAMWORLD_SET_SCREEN_PTR_KERNEL_ALLOWANCE : 0) +
    (usesStreaming ? STREAMWORLD_SPAWN_KERNEL_ALLOWANCE : 0) +
    (usesStreaming ? STREAMWORLD_MUSIC_KERNEL_ALLOWANCE : 0) +
    (usesStreaming && usesBattleBase ? STREAMWORLD_ENCOUNTER_KERNEL_ALLOWANCE : 0) +
    (usesStreaming && usesBattleBase ? STREAMWORLD_BATTLE_STRIP_CANCEL_KERNEL_ALLOWANCE : 0) +
    (usesStreaming && usesBoundTiles ? STREAMWORLD_BOUND_CACHE_KERNEL_ALLOWANCE : 0) +
    (usesStreaming ? STREAMWORLD_CROSS_TRANSLATE_KERNEL_ALLOWANCE : 0) +
    (usesStreaming ? STREAMWORLD_INIT_SESSION_KERNEL_ALLOWANCE : 0) +
    (usesStreaming && !usesBattleBase ? STREAMWORLD_HURT_PLAYER_KERNEL_ALLOWANCE : 0) +
    (usesStreaming && !usesBattleBase ? STREAMWORLD_KB_INIT_KERNEL_ALLOWANCE : 0) +
    (usesStreaming && usesBoundTiles ? STREAMWORLD_LANDING_BOUND_CACHE_KERNEL_ALLOWANCE : 0) +
    (usesStreaming ? STREAMWORLD_ORDINARY_CAM_RESET_KERNEL_ALLOWANCE : 0) +
    (usesStreaming && usesBoundTiles ? STREAMWORLD_TILE_SWITCH_KERNEL_ALLOWANCE : 0) +
    (usesStreaming && usesMove ? STREAMWORLD_MOVE_KERNEL_ALLOWANCE : 0) +
    (usesStreaming ? STREAMWORLD_NMI_KERNEL_ALLOWANCE : 0) +
    (usesStreaming && usesPaletteFx ? STREAMWORLD_NMI_PALETTE_FX_KERNEL_ALLOWANCE : 0) +
    (usesStreaming ? STREAMWORLD_PROJECT_KERNEL_ALLOWANCE : 0) +
    (usesStreaming ? STREAMWORLD_UPDATE_PLAYER_DISPATCH_KERNEL_ALLOWANCE : 0) +
    (usesStreaming ? STREAMWORLD_EVENT_FREEZE_KERNEL_ALLOWANCE : 0) +
    (usesStreaming ? STREAMWORLD_HAZARD_KERNEL_ALLOWANCE : 0) +
    (usesStreaming && usesText ? STREAMWORLD_DIALOGUE_LIFECYCLE_KERNEL_ALLOWANCE : 0) +
    (usesStreaming && usesText ? STREAMWORLD_OAM_GUARD_KERNEL_ALLOWANCE : 0) +
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
 * can turn the split term off too. kernelShortfallAdvice asks
 * kernelCodeBytes rather than re-deriving what it already knows, which is
 * the whole point of calling this first. Never touches `project` itself.
 */
export function projectWithoutCommands(project, ops) {
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
  // boundTilesEnabled is computed once and reused for every candidate:
  // switching mapper candidates never changes which screens author bound
  // tiles, only cartridge fields (design-tile.md §8). fixedBytes/tableBytes
  // themselves are NOT reused this way any more -- chrTableBytes (this
  // file's own kernelTableBytes) depends on whether a given CANDIDATE mapper
  // is chrRam, so they are recomputed per candidate, below, against `moved`
  // (the already-reconciled clone) and `candidate` rather than the
  // project's own current mapper.
  const boundTilesEnabled = projectUsesBoundTiles(project);
  // design-camera.md §5/Q3: a candidate that would drop an axis the
  // project's CURRENT mapper provides is excluded, the identical treatment
  // CLAUDE.md's own existing rule already gives tilesets and mirroring --
  // camera axes are a direct consequence of mirroring, not a new mechanism.
  // currentCameraAxes is evaluated against `mapper` (the project's own
  // current board); each candidate's own axes, below, are evaluated against
  // that SAME candidate -- never the candidate both times. The question
  // asked is "does switching lose an axis this project's mirroring choice
  // currently provides", never "does the candidate support the raw
  // mirroring string in the abstract".
  const usesCamera = projectUsesCamera(project);
  const streamedWorld = projectUsesStreaming(project);
  const currentCameraAxes = usesCamera ? cameraAxes(mapper, project.cartridge) : null;

  return SUPPORTED_MAPPERS.filter((candidate) => candidate.id !== mapper.id)
    .filter((candidate) => !isRpg || rpgCapable(candidate))
    // saveMediaImplemented, not saveCapable: recommending UNROM 512 to a
    // project with a live Save command would just trade this shortfall for
    // validateProject's flash-unimplemented refusal -- not a fix.
    .filter((candidate) => !wantsSave || saveMediaImplemented(candidate))
    .filter((candidate) => {
      if (!usesCamera) return true;
      const candidateAxes = cameraAxes(candidate, project.cartridge);
      return (
        (!currentCameraAxes.horizontal || candidateAxes.horizontal) &&
        (!currentCameraAxes.vertical || candidateAxes.vertical)
      );
    })
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
      // Still fits? Three banks, asked in the same terms checkCapacity asks. A project with a streamed
      // map asks checkStreamedMapperSwitch for the screen-region half instead of restating it: the
      // streamed maps' own screens are not ordinary records, so the flat count below would be wrong.
      if (streamedWorld) {
        if (checkStreamedMapperSwitch(project, candidate.id, project.cartridge.mirroring).length) return false;
      } else if (
        screenCapacityFor(
          candidate,
          moved.tilesets.length,
          bankedCode,
          flat,
          actorCount,
          reservesFlashSaveRegion(wantsSave, candidate),
          boundTilesEnabled
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
      // rpgCapable(candidate) was already required above for an RPG project,
      // which today always carries a measured BATTLE_KERNEL_ALLOWANCE_BY_MAPPER
      // entry -- but that correspondence is a fact about the current
      // registry, not something this filter chain can see on its own (see
      // battleEnabledFor's own comment), so a candidate whose own battle
      // allowance is unmeasured is excluded here rather than left to throw
      // out of kernelCodeBytes uncaught. Never reachable today; the guard is
      // for the mapper this table has no entry for yet.
      if (battleEnabledFor(moved, candidate) && !hasBattleKernelAllowance(candidate)) return false;
      const { fixedBytes, tableBytes } = kernelTableBytes(moved, candidate);
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
function projectWithoutBoundTiles(project) {
  const clone = structuredClone(project);
  for (const map of clone.maps) for (const screen of map.screens) screen.boundTiles = [];
  return clone;
}

// Phase 2 slice 2b, Part F: the streaming-specific shape of the same
// "what would dropping this feature free" question -- every streamed map's
// own flag cleared, matching the exact operation kernelCodeBytes' own
// usesStreaming reads (projectUsesStreaming). Reads the project only; never
// mutates it. Not a suggestion that the result is otherwise valid (a
// streamed map cleared this way can leave its fillMetatileId/gridW/gridH
// fields behind, harmless once `streamed` is false) -- the same "occupancy
// only" scope projectWithoutBoundTiles/projectWithoutCommands already have.
function projectWithoutStreaming(project) {
  const clone = structuredClone(project);
  for (const map of clone.maps) map.streamed = false;
  return clone;
}

function kernelShortfallAdvice(project, mapper, deficit) {
  // saveMediaImplemented for the same reason kernelCodeBytes itself reads it:
  // "active" below feeds freedByDropping, which calls kernelCodeBytes, so
  // this must agree with what that function actually charges.
  const usesSave = projectUsesSave(project) && saveMediaImplemented(mapper);
  const usesMove = projectUsesMove(project);
  const usesTurn = projectUsesTurn(project);
  const usesWait = projectUsesWait(project);
  const usesShake = projectUsesShake(project);
  const usesCamera = projectUsesCamera(project);
  const usesVisible = projectUsesVisible(project);
  const usesFade = projectUsesFade(project);
  const usesFlash = projectUsesFlash(project);
  const usesSting = projectUsesSting(project);
  const usesSfx = projectUsesSfx(project);
  // design-tile.md §8: its own local declaration, independent of
  // kernelCodeBytes's/generateAssets's own locals of the same name -- the
  // usesSting three-scope precedent, not a value threaded across a function
  // boundary.
  const usesBoundTiles = projectUsesBoundTiles(project);
  // "Every" rather than "the": a project can carry more than one live Move or
  // Save command (several actors, several pages), and removing just one of
  // several does not free anything at all -- kernelCodeBytes only drops the
  // term once *no* live occurrence remains (projectUsesSave/projectUsesMove).
  const active = [];
  if (usesMove) active.push({ label: 'every Move command', strip: (p) => projectWithoutCommands(p, ['move']) });
  if (usesTurn) active.push({ label: 'every Turn command', strip: (p) => projectWithoutCommands(p, ['turn']) });
  if (usesWait) active.push({ label: 'every Wait command', strip: (p) => projectWithoutCommands(p, ['wait']) });
  if (usesShake) active.push({ label: 'every Shake command', strip: (p) => projectWithoutCommands(p, ['shake']) });
  // docs/design-camera.md §8, phase 1: not a command strip -- priced by full
  // occupancy like every other lever, so on a project with Shake also live
  // this frees CAMERA_KERNEL_ALLOWANCE + CAMERA_SHAKE_INTERACTION_ALLOWANCE
  // together (39), not just the 20-byte register term alone.
  if (usesCamera) active.push({ label: 'the camera', strip: (p) => projectWithoutCamera(p) });
  if (usesVisible) {
    active.push({ label: 'every Show/Hide command', strip: (p) => projectWithoutCommands(p, ['visible']) });
  }
  if (usesFade) active.push({ label: 'every Fade command', strip: (p) => projectWithoutCommands(p, ['fade']) });
  if (usesFlash) active.push({ label: 'every Flash command', strip: (p) => projectWithoutCommands(p, ['flash']) });
  if (usesSting) active.push({ label: 'every Sting command', strip: (p) => projectWithoutCommands(p, ['sting']) });
  if (usesSfx) active.push({ label: 'every Play a sound effect command', strip: (p) => projectWithoutCommands(p, ['sfx']) });
  // design-tile.md §8, finding 5: bound tiles are the first strippable
  // feature that is authored screen data, not an event command -- its own
  // strip cannot go through projectWithoutCommands at all.
  if (usesBoundTiles) active.push({ label: 'every switch-bound tile', strip: (p) => projectWithoutBoundTiles(p) });
  // Phase 2 slice 2b, Part F: streaming's own resolver/render/dispatch cost
  // (STREAMWORLD_RESOLVER_KERNEL_ALLOWANCE and the rest, above) is named here
  // the same way every other feature is, rather than leaving a streaming
  // project's overflow message silent about what its own biggest kernel-lo
  // consumer actually is.
  if (projectUsesStreaming(project)) {
    active.push({ label: 'every streamed map', strip: (p) => projectWithoutStreaming(p) });
  }
  if (usesSave) active.push({ label: 'every Save command', strip: (p) => projectWithoutCommands(p, ['save']) });
  // In-game naming (docs/design-name-entry.md §11): no bespoke combination
  // logic needed -- the existing solo-then-combination search below already
  // tries "both together" the moment neither alone suffices, generic over
  // whatever active holds.
  if (projectUsesHeroNaming(project)) {
    active.push({ label: 'hero naming at the start of a new game', strip: (p) => projectWithoutHeroNaming(p) });
  }
  if (projectUsesJoinNaming(project)) {
    active.push({ label: 'every named Join', strip: (p) => projectWithoutJoinNaming(p) });
  }
  if (projectUsesNameToken(project)) {
    active.push({ label: 'the name token', strip: (p) => projectWithoutNameToken(p) });
  }
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
  //
  // design-tile.md §8, finding 5: compares full kernel-lo occupancy
  // (kernelCodeBytes + fixedBytes + tableBytes), the exact quantity
  // checkCapacity's own kernelFree is computed from, not kernelCodeBytes
  // alone -- bound tiles are the first strippable feature whose removal also
  // changes kernelTableBytes's own fixedBytes (the 30-byte row table) and
  // tableBytes (the 2-bytes/screen pointer table). For every existing
  // command-only strip, removing the command never touches screen.boundTiles/
  // screen.entities/anything else kernelTableBytes reads, so this reduces
  // algebraically to the identical kernelCodeBytes-only delta the shipped
  // function already computed -- every existing command-only advice string is
  // unchanged by this switch.
  const occupancy = (proj) => {
    const { fixedBytes, tableBytes } = kernelTableBytes(proj, mapper);
    return kernelCodeBytes(proj, mapper) + fixedBytes + tableBytes;
  };
  const budget = occupancy(project);
  const freedByDropping = (features) => {
    const stripped = features.reduce((p, feature) => feature.strip(p), project);
    return budget - occupancy(stripped);
  };

  // Any one active feature that alone frees enough bytes is offered as its
  // own choice -- dropping one thing is simpler than dropping several, and
  // when more than one alone would do it the author gets to pick which.
  const solo = active
    .map((feature) => ({ feature, freed: freedByDropping([feature]) }))
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
  // being it). Each combination's freed count comes from stripping every
  // chosen feature off the SAME project together, not from adding up
  // separately-measured single drops, so a dependent term two features would
  // each have to give up on their own is not double-counted or missed.
  let combo = null;
  for (let mask = 1; mask < 1 << active.length; mask++) {
    const chosen = active.filter((_, index) => mask & (1 << index));
    if (chosen.length < 2) continue; // already covered by the solo case above
    const freed = freedByDropping(chosen);
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
  // Priced by full kernel-lo occupancy (code + fixedBytes + tableBytes), the
  // same counterfactual-occupancy rule every command-removal candidate above
  // already follows, not by kernelCodeBytes alone: kernelTableBytes is
  // itself mapper-dependent now (the CHR-RAM streaming tables, phase 3 fix
  // round 3 -- 3 bytes per tileset on a chrRam board, 0 elsewhere), so a
  // switch off a chrRam board also frees table bytes a code-only comparison
  // never sees. A candidate that saves 195 code bytes but also 9 table bytes
  // was being reported as saving only 195, understating -- or in the
  // reviewer's reproduction, missing entirely -- a board switchableMappers
  // itself already considers safe.
  const alternative = switchableMappers(project, mapper)
    .map((candidate) => {
      const { fixedBytes, tableBytes } = kernelTableBytes(project, candidate);
      return { candidate, occupancy: kernelCodeBytes(project, candidate) + fixedBytes + tableBytes };
    })
    .filter((entry) => budget - entry.occupancy >= deficit)
    .sort((a, b) => a.occupancy - b.occupancy)[0];
  if (alternative) {
    const saved = budget - alternative.occupancy;
    return `Try ${alternative.candidate.name} in the Build panel — it reserves ${saved} fewer bytes for the same features.`;
  }

  return 'Reduce the number of screens, actors or metasprites.';
}

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
 * The ordinary screens' own compacted view (docs/design-streamed-worlds.md §3, "Charge,
 * resolved"): flattenScreens' own global-identity flat, filtered to non-streamed maps, in the
 * same row order planStreamedRegions' own ordinaryFlat already uses -- with left/right/up/down
 * recomputed against THIS compacted numbering, never the raw flat array's. Every ordinary table
 * generateAssets emits (maps.inc, screens.inc) is built from this, not from flattenScreens' own
 * flat -- flattenScreens' own numbering is untouched and stays what resolveGlobalScreen,
 * Warp/door operands and saves use. A neighbour is always within the same map, and a streamed
 * map's screens never enter this view at all, so a found neighbour is always another entry of
 * this same compacted list.
 */
export function ordinaryScreenView(project) {
  const { flat } = flattenScreens(project);
  const ordinaryFlat = flat.filter((entry) => entry.map.streamed !== true);
  const compactIndex = new Map();
  ordinaryFlat.forEach((entry, index) => compactIndex.set(entry.screen, index));
  const at = (map, col, row) => {
    if (col < 0 || row < 0 || col >= map.gridW || row >= map.gridH) return 0xff;
    return compactIndex.get(map.screens[row * map.gridW + col]) ?? 0xff;
  };
  const neighbours = { left: [], right: [], up: [], down: [] };
  for (const { map, col, row } of ordinaryFlat) {
    neighbours.left.push(at(map, col - 1, row));
    neighbours.right.push(at(map, col + 1, row));
    neighbours.up.push(at(map, col, row - 1));
    neighbours.down.push(at(map, col, row + 1));
  }
  return { ordinaryFlat, neighbours };
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

// switch, cell index, metatile -- design-tile.md §4.
export const BOUND_TILE_RECORD = 3;

/**
 * Bytes one screen occupies: metatiles, attributes, the actor list, and --
 * only when boundTilesEnabled, since a feature-free project cannot emit
 * records that do not exist and so cannot be charged for them (design-tile.md
 * §8, finding 6; byte identity picks this direction, not the `_ent`-shaped
 * unconditional one) -- its own switch-bound tile list.
 */
function screenRecordBytes(entry, actorCount, boundTilesEnabled = false) {
  const placed = entry.screen.entities.filter((entity) => entity.actorId < actorCount);
  const bound = boundTilesEnabled ? entry.screen.boundTiles ?? [] : [];
  return (
    SCREEN_BYTES +
    1 +
    ENTITY_RECORD * placed.length +
    (boundTilesEnabled ? 1 : 0) +
    BOUND_TILE_RECORD * bound.length
  );
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
  // design-tile.md §11, finding 13, §12 test 18: esptr_lo/esptr_hi's shared-
  // scratch lifetime (bdptr_lo/bdptr_hi aliased onto it, engine/constants.asm)
  // is provably safe against every *stock* call graph -- spawn_entities and
  // rebuild_bound_cache/tile_switch_changed each set and fully consume it
  // inside one call, never nested, never touched by NMI. An entities.asm
  // override that legally stashes esptr_lo/esptr_hi across its own calls
  // (nothing in stock code overwrites the pointer between calls today) is
  // silently broken the instant the same project also turns
  // BOUND_TILE_ENABLED on, because a Turn switch command anywhere in that
  // project's events can now clobber the override's own assumption with no
  // assembler error. A grep-level scan of the override's own text for the
  // token esptr_lo/esptr_hi is a weaker claim than "this override actually
  // stashes it across a call" -- the same "weaker-claim-but-true" spirit
  // battleRegionRelocates already uses for a different override risk -- but
  // it is a fact about the text, not a guess about behaviour this codebase
  // is otherwise forbidden from sizing, and a false positive costs nothing.
  const entitiesOverride = code.overrides.find((file) => file.name === 'entities.asm');
  if (entitiesOverride && projectUsesBoundTiles(project) && /\besptr_(lo|hi)\b/.test(String(entitiesOverride.text ?? ''))) {
    problems.push({
      severity: 'warning',
      where: 'Code Forge',
      message:
        'This project’s override of entities.asm references esptr_lo/esptr_hi, and a live switch-bound ' +
        'tile is also present. esptr_lo/esptr_hi is shared, aliased scratch (bdptr_lo/bdptr_hi, ' +
        'engine/constants.asm): rebuild_bound_cache and tile_switch_changed set and consume it inside one ' +
        'call whenever a Turn switch command runs, so an override that stashes esptr_lo/esptr_hi across its ' +
        'own calls will have it silently clobbered, with no assembler error.'
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
export function screenCapacityFor(
  mapper,
  tilesetCount,
  bankedCode,
  flat,
  actorCount,
  reserveFlashSave = false,
  boundTilesEnabled = false,
  options = {}
) {
  const spare = [];
  let packed = 0;
  for (const _region of options.regionsOverride ?? screenRegions(mapper, tilesetCount, bankedCode, { reserveFlashSave })) {
    let used = 0;
    while (packed < flat.length) {
      const size = screenRecordBytes(flat[packed], actorCount, boundTilesEnabled);
      if (used + size > SCREEN_REGION_BYTES) break;
      used += size;
      packed++;
    }
    spare.push(SCREEN_REGION_BYTES - used);
  }
  // design-tile.md §8, finding 6: an enabled project's own empty screen still
  // carries a 1-byte .db 0 bound record, so this divisor needs +2, not +1,
  // under the same gate screenRecordBytes' own +1 already uses.
  const emptyScreen = SCREEN_BYTES + 1 + (boundTilesEnabled ? 1 : 0);
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
export function assignScreenBanks(
  mapper,
  tilesetCount,
  bankedCode,
  reserveFlashSave,
  flat,
  actorCount,
  boundTilesEnabled = false,
  options = {}
) {
  const screenBank = new Array(flat.length).fill(0);
  const regionRanges = [];
  let cursor = 0;
  // `options.regionsOverride` packs against that region list in place of the mapper's full one: the
  // streamed-first allocation (planStreamedRegions) hands the ordinary screens only what the
  // streamed maps have not reserved. Absent, this is exactly the packer it always was.
  for (const region of options.regionsOverride ?? screenRegions(mapper, tilesetCount, bankedCode, { reserveFlashSave })) {
    const from = cursor;
    let used = 0;
    while (cursor < flat.length) {
      const size = screenRecordBytes(flat[cursor], actorCount, boundTilesEnabled);
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
 * Would these screens pack? The real packer in validation mode (assignScreenBanks), never a
 * generic count: screenCapacityFor counts a region's leftover tail as room for one more *empty*
 * screen, which can be too small for the real record being asked about. The eighth argument is
 * forwarded -- a wrapper that stopped at seven would drop `regionsOverride` and check against the
 * full region list, a false pass for exactly the project the streamed reservation exists to refuse.
 */
export function fitsCapacity(
  mapper,
  tilesetCount,
  bankedCode,
  reserveFlashSave,
  flat,
  actorCount,
  boundTilesEnabled,
  options
) {
  try {
    assignScreenBanks(mapper, tilesetCount, bankedCode, reserveFlashSave, flat, actorCount, boundTilesEnabled, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Streamed-first region allocation (docs/design-streamed-worlds.md §4). A streamed map's row-chunks
 * are whole 8 KB regions, so they are reserved first, off the front of the usable list, and the real
 * packer runs against whatever is left for the ordinary screens.
 *
 * `baseBanks` is one entry per streamed map in project order: the ABSOLUTE nesasm bank number of that
 * map's first region (`prgLayout`'s `nesasmBank`, the unit sw_locate_current adds row/chunk to), not an
 * ordinal into the usable list -- code and CHR-payload regions come off the front of the full list, so
 * the two differ. A map's regions are contiguous: `screenRegions` only ever removes a prefix (CHR
 * payload, battle code) and a suffix (the flash sector), so what is left is a run of consecutive
 * banks, and this asserts it rather than assuming it. Null while the streamed maps do not fit.
 */
export function planStreamedRegions(project, mapper, options = {}) {
  const tilesetCount = options.tilesetCount ?? project.tilesets.length;
  const reserveFlashSave = options.reserveFlashSave ?? reservesFlashSaveRegion(projectUsesSave(project), mapper);
  const usable = screenRegions(mapper, tilesetCount, codeRegionCount(project), { reserveFlashSave });
  const streamedMaps = project.maps
    .map((map, mapIndex) => ({ map, mapIndex }))
    .filter(({ map }) => map.streamed === true)
    .map(({ map, mapIndex }) => ({ mapIndex, regionCount: map.gridH * streamRegionsPerRow(map.gridW) }));
  const streamedNeed = streamedMaps.reduce((sum, entry) => sum + entry.regionCount, 0);
  const fits = streamedNeed <= usable.length;
  let baseBanks = null;
  if (fits) {
    baseBanks = [];
    let cursor = 0;
    for (const entry of streamedMaps) {
      for (let k = 1; k < entry.regionCount; k++) {
        if (usable[cursor + k].nesasmBank !== usable[cursor].nesasmBank + k) {
          throw new Error(`internal: ${mapper.name}'s usable regions are not contiguous`);
        }
      }
      baseBanks.push(usable[cursor].nesasmBank);
      cursor += entry.regionCount;
    }
  }
  return {
    usable,
    streamedMaps,
    streamedNeed,
    baseBanks,
    remainingRegions: usable.slice(streamedNeed),
    reserveFlashSave,
    ordinaryFlat: ordinaryScreenView(project).ordinaryFlat
  };
}

/**
 * The aggregate streamed-world capacity failures for a project on a board, in plain language, in
 * order: too many streamed regions for the board, then ordinary screens that no longer fit beside
 * them. Empty for a project with no streamed map. Reads `mapper` rather than the project's own
 * cartridge so a candidate board can be asked about (checkStreamedMapperSwitch).
 */
function streamedCapacityProblems(project, mapper, options = {}) {
  if (!project.maps.some((map) => map.streamed === true)) return [];
  const plan = planStreamedRegions(project, mapper, options);
  if (!plan.baseBanks) {
    return [
      `The streamed maps need ${plan.streamedNeed} of the ${plan.usable.length} 8 KB program regions ${mapper.name} has free ` +
        'for world data. Shrink a streamed map, remove one, or choose a board with more program space in the Build panel.'
    ];
  }
  const fits = fitsCapacity(
    mapper,
    project.tilesets.length,
    codeRegionCount(project),
    plan.reserveFlashSave,
    plan.ordinaryFlat,
    project.sprites.actors.length,
    projectUsesBoundTiles(project),
    { regionsOverride: plan.remainingRegions }
  );
  if (fits) return [];
  return [
    `The ${plan.ordinaryFlat.length} ordinary screens no longer fit beside the streamed maps, which take ${plan.streamedNeed} of ` +
      `${mapper.name}'s ${plan.usable.length} 8 KB program regions. Remove a screen, shrink a map, or choose a board with more ` +
      'program space in the Build panel.'
  ];
}

/**
 * Would switching this project to `candidateMapperId` (and, when given, `candidateMirroring`) leave
 * every streamed map buildable? A pure preflight: it works on a structuredClone, applies the
 * candidate, runs reconcileCartridge (a switch can itself shrink the tileset ceiling or force a
 * mirroring, and the aggregate check must see the post-switch shape), then asks three checks in
 * order and returns the first failing one's plain-language refusals -- (1) the candidate can stream
 * at all, (2) its dead-axis restriction holds for every streamed map's grid, (3) the aggregate
 * region check. An empty list means no objection; the real project is never touched. It lives in
 * main/build rather than shared/ because check 3 needs assignScreenBanks, so it cannot be called
 * from the renderer without moving that packer.
 */
export function checkStreamedMapperSwitch(project, candidateMapperId, candidateMirroring) {
  if (!project.maps.some((map) => map.streamed === true)) return [];
  const moved = structuredClone(project);
  moved.cartridge.mapper = candidateMapperId;
  if (candidateMirroring !== undefined) moved.cartridge.mirroring = candidateMirroring;
  reconcileCartridge(moved);
  const board = streamedBoardProblems(moved);
  for (const kind of ['capability', 'deadAxis']) {
    const failed = board.filter((problem) => problem.kind === kind);
    if (failed.length) return failed.map((problem) => problem.message);
  }
  return streamedCapacityProblems(moved, resolveMapper(moved.cartridge.mapper));
}

/**
 * The kernel-lo bank's mapper-independent occupants: the fixed tables, and the
 * lookup tables this project's own content generates. Neither depends on the
 * cartridge, which is exactly why they are extracted -- switchableMappers has
 * to ask "would kernel-lo still fit on that board", and the only term that
 * changes across boards is kernelCodeBytes. Computing these twice, once here
 * and once there, is how the check that refuses a build and the advice about
 * how to fix it come to disagree about the same project. Two of the terms
 * below are the first in this function to depend on whether an *optional
 * feature* is in use, where every other term here is unconditional --
 * bound_row_lo/hi (fixedBytes) and the screen_bound_lo/hi pointer table
 * (tableBytes), both design-tile.md §8 (finding 6), both gated on
 * projectUsesBoundTiles since a feature-free project emits neither.
 */
export function kernelTableBytes(project, mapper) {
  const { flat } = flattenScreens(project);
  const boundTilesEnabled = projectUsesBoundTiles(project);
  // tileset_bank/tileset_lo/tileset_hi (assets/chrtables.inc) -- one byte
  // each per chrPayloadRegions() region, kernel-lo, before reset, so this
  // has to be charged here the same way the naming table above is. Zero on
  // every CHR-ROM board (chrPayloadRegions returns [] unless mapper.chrRam,
  // which today only UNROM 512 sets) -- pre-existing at 1e21fde, entirely
  // unrelated to naming; found while measuring the naming allowances'
  // whole-bank margin on UNROM 512 (docs/design-name-entry.md phase 3 fix
  // round 2/3). `mapper` is optional so a caller mid-transition (there are
  // none left after this fix, but future callers might reasonably still
  // only have a project) degrades to 0 rather than throwing.
  const chrTableBytes = mapper?.chrRam ? 3 * chrPayloadRegions(mapper, project.tilesets.length).length : 0;
  // The nameentry row only exists in input_actions when a project actually
  // opts into naming (docs/design-name-entry.md §4, Y1): INPUT_STATES stays
  // append-only in the schema, but the emitted row count is conditional, or
  // every naming-off project (including every one that predates this
  // feature) would pay 4 bytes it never used. projectUsesNameEntry(project)
  // alone, with no mapper argument, is the correct gate here -- see §4's own
  // reasoning for why a mapper-aware check is both unavailable at this call
  // site and unnecessary (it is a safe, content-only superset of the real
  // code-side gate, HERO_NAMING_ENABLED || JOIN_NAMING_ENABLED).
  const inputStateCount = projectUsesNameEntry(project) ? INPUT_STATES.length : INPUT_STATES.length - 1;
  // hero_name_default (assets/nameentry.inc) is a 10-byte .db table, included
  // in engine/main.asm BEFORE boot.asm -- i.e. before reset -- alongside the
  // other generated lookup tables (palettes, metatiles, sprites, input,
  // maps, chrtables), never after it. kernelCodeBytes/measureCodeBytes both
  // measure kernel-lo usage MINUS everything before reset, so this table has
  // to be charged here, in fixedBytes, or it is invisible to every capacity
  // check that adds kernelCodeBytes to kernelTableBytes (checkCapacity's own
  // arithmetic) -- the identical "a code term and a table term stay in the
  // ledgers they each belong to" rule the 4-byte input row above already
  // follows. HERO_DEFAULT_KERNEL_ALLOWANCE (generate.js) is the copy loop
  // alone, not this table.
  const fixedBytes =
    32 +
    5 * LIMITS.metatiles +
    PLAYER_TILES +
    1 +
    inputStateCount * BUTTONS.length +
    (boundTilesEnabled ? 30 : 0) +
    (projectNeedsHeroDefault(project) ? 10 : 0) +
    chrTableBytes;
  // behavior, speed, hp, damage, 4 anim slots -- shared/project.js's
  // metaspriteKernelBytes (single writer, design-draw-validation.md §3.11).
  const spriteBytes = metaspriteKernelBytes(project);
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
  // screen_bound_lo/hi (2 bytes/screen, design-tile.md §4/§8) -- the same
  // bucket screen_ent_lo/hi already lives in (part of the 13-bytes/screen
  // term above), unlike that term conditional on the feature being used at
  // all.
  //
  // A streamed map (docs/design-streamed-worlds.md §3, "Charge, resolved") pays no per-screen column at
  // all: 13 x ordinary screens, 9 per map (identity, paid by every map once), 6 per streamed map
  // (tileset, fill, 4-byte locator) and the packed 1-bit map-type table. All of it is gated on a
  // streamed map existing, so a project with none is charged exactly as before, type table included.
  const streamedMapCount = project.maps.filter((map) => map.streamed === true).length;
  const ordinaryScreens = streamedMapCount
    ? flat.filter((entry) => entry.map.streamed !== true).length
    : flat.length;
  const streamedBytes = streamedMapCount ? 6 * streamedMapCount + mapTypeTableBytes(project.maps.length) : 0;
  const boundTileBytes = boundTilesEnabled ? 2 * ordinaryScreens : 0;
  const tableBytes =
    13 * ordinaryScreens + 9 * project.maps.length + streamedBytes + spriteBytes + itemBytes + boundTileBytes;
  return { fixedBytes, tableBytes };
}

/** Capacity checks that must pass before the assembler is worth running. */
export function checkCapacity(project) {
  const text = compileText(project);
  const problems = [...validateProject(project), ...text.problems, ...checkBattleTables(project)];
  const { flat } = flattenScreens(project);

  const mapper = resolveMapper(project.cartridge.mapper);
  const { fixedBytes, tableBytes } = kernelTableBytes(project, mapper);
  // resolveMapper reads project.cartridge.mapper directly, with no
  // reconciling step of its own (reconcileCartridge runs on an edit, not on
  // every read -- normalizeProject deliberately does not call it either).
  // So an RPG project can reach here carrying a mapper that is not
  // rpgCapable(), and battleEnabledFor can still be true for it (see that
  // function's own UxROM example) even though BATTLE_KERNEL_ALLOWANCE_BY_MAPPER
  // has no entry for it -- checked here, before kernelCodeBytes is ever
  // called, so that case becomes a named problem instead of
  // kernelCodeBytes's own throw (battleKernelAllowance) propagating out of
  // this function uncaught. validateProject already refuses this exact
  // project for other reasons (a non-rpgCapable mapper fails its own RPG
  // checks), so this is defense in depth for today's registry and the real
  // guard for a future rpgCapable mapper shipped without a measured entry.
  let kernelBudget = null;
  let kernelFree = null;
  if (battleEnabledFor(project, mapper) && !hasBattleKernelAllowance(mapper)) {
    problems.push({
      severity: 'error',
      where: 'Build',
      message:
        `${mapper.name} has no measured kernel-lo battle allowance yet, so this project's real capacity ` +
        'cannot be computed on it. This is a gap in engine support for that mapper, not a problem with ' +
        'the project -- choose a different mapper in the Build panel.'
    });
  } else {
    kernelBudget = kernelCodeBytes(project, mapper);
    kernelFree = BANK_SIZE - kernelBudget - fixedBytes - tableBytes;
  }

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
  const boundTilesEnabled = projectUsesBoundTiles(project);
  // With a streamed map, the ordinary screens pack into what the streamed maps leave (planStreamedRegions);
  // otherwise this is exactly the call it always was.
  const hasStreamed = projectUsesStreaming(project);
  const streamedPlan = hasStreamed ? planStreamedRegions(project, mapper, { reserveFlashSave }) : null;
  const capacity = screenCapacityFor(
    mapper,
    project.tilesets.length,
    bankedCode,
    streamedPlan ? streamedPlan.ordinaryFlat : flat,
    actorCount,
    reserveFlashSave,
    boundTilesEnabled,
    streamedPlan ? { regionsOverride: streamedPlan.remainingRegions } : {}
  );

  const musicBytes = musicSize(project.songs);
  const sfxBytes = sfxSize(project.sfx);

  if (hasStreamed) {
    for (const message of streamedCapacityProblems(project, mapper, { reserveFlashSave })) {
      problems.push({ severity: 'error', where: 'Map Forge', message });
    }
  } else if (flat.length > capacity) {
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
  if (kernelFree !== null && kernelFree < 0) {
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
  // Attributed to the Build panel's own capacity math for a project fed by
  // every Forge listed here: a monster's own battle stats (attack, drops,
  // weak/resist, spell list, battle artwork) are edited in the Monster Forge;
  // hp and name are general actor fields, edited in the Sprite Forge's own
  // Actor panel; a spell's own catalog entry (name, kind, damage/heal
  // range, MP cost, element, scope) is edited in the Magic Forge; an
  // item's own name and heal amount are edited in the Items Forge; a party
  // member's own stats, growth and learned spells are edited in the
  // Character Forge. "Highest level" and the two XP-curve fields beside it
  // are Build panel fields in their own right, and "Highest level" is one
  // of the larger levers (five bytes per party member per level), so
  // battleShortfallAdvice names the panel explicitly whenever lowering it
  // is one of the fixes, rather than leaving `where` to send the author to
  // the wrong Forge for it.
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
        // The region is fed by every Forge listed here: the Monster Forge's
        // battle stats, the Sprite Forge's own actor hp/name, the Magic Forge's
        // spells, the Items Forge, and (moving here under this design) the
        // Character Forge's own party -- plus the mapper choice itself (a
        // Build-panel decision, reconcileCartridge) that decides its ceiling --
        // no single content Forge owns this overflow the way each of the other
        // `where:` strings in this file names a Forge that owns the entirety
        // of what it reports on. 'Build & Play' is the one existing Forge
        // title (renderer/app.js) that already shows this exact number.
        where: 'Build & Play',
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
  // Item 12: every song's own instruments land in one flat table (songTables,
  // main/build/songcompile.js), and the driver indexes it with Y -- an 8-bit
  // register -- so the combined total across every song can never exceed 256,
  // regardless of how the per-song MAX_INSTRUMENTS(8) cap is spent across them.
  const totalInstruments = totalInstrumentCount(project.songs);
  if (totalInstruments > MAX_TOTAL_INSTRUMENTS) {
    problems.push({
      severity: 'error',
      where: 'Sound Forge',
      message:
        `This project's songs use ${totalInstruments} instruments combined, but the driver can only ` +
        `address ${MAX_TOTAL_INSTRUMENTS}. Remove some instruments from one or more songs.`
    });
  }
  // Round 2 finding 1: LIMITS.songs (shared/project.js) is a real hardware
  // ceiling -- music_play's 8-bit song*4 index wraps at 64 -- and
  // validateProject already refuses a project over it. Checked again here,
  // defense in depth: buildProject compiles the project actually in hand,
  // not one that necessarily passed validateProject, the same reasoning
  // every other checkCapacity refusal above already holds to.
  if (project.songs.length > LIMITS.songs) {
    problems.push({
      severity: 'error',
      where: 'Sound Forge',
      message:
        `This project has ${project.songs.length} songs but the driver can only address ${LIMITS.songs} ` +
        `(ids 0-${LIMITS.songs - 1}). Delete ${project.songs.length - LIMITS.songs} of them before this can build.`
    });
  }
  // Music, sound effects, text and (streaming only) the resident streamed-worlds package share
  // the $E000 half of the fixed kernel, above the vectors (docs/design-streamed-worlds.md, phase 2
  // slice 2a: STREAMWORLD_KERNEL_HI_ALLOWANCE + STREAMWORLD_MT_PAL_KERNEL_HI_BYTES, gated on
  // projectUsesStreaming alone, zero for every project that does not use the feature). Fix round 1,
  // finding 2: sw_move_probe/sw_move_probe_solid (engine/streamworld.asm, `.if MOVE_ENABLED`) are a
  // THIRD, separately-gated kernel-hi term -- a streamed project with no live Move must not pay for
  // a routine nothing could ever call, so this is gated on usesMoveHere := projectUsesMove(project)
  // as well as hasStreamed, never folded into the unconditional pair above.
  const usesMoveHere = projectUsesMove(project);
  const streamworldMoveHiBytes = hasStreamed && usesMoveHere ? STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE : 0;
  // Phase 2 slice 4b: sw_update_player's own driver body and the window/
  // camera-window region it calls into are unconditional kernel-hi terms,
  // paid by every streamed project regardless of Move -- STREAMWORLD_WINDOW_
  // KERNEL_HI_ALLOWANCE (flat) plus streamworldUpdatePlayerKernelHiAllowance
  // (by game type, see that function's own comment). sw_knockback_step is a
  // FOURTH, separately-gated term, `.if !BATTLE_ENABLED` inside sw_update_
  // player's own file -- an RPG never assembles it (nesasm emits no symbol
  // for a label inside a false `.if`, confirmed directly rather than assumed
  // to share an address with what follows), so this is gated on
  // !battleEnabledFor(project, mapper), the same predicate the RPG-vs-action
  // split already uses everywhere else in this function.
  const streamworldKnockbackHiBytes =
    hasStreamed && !battleEnabledFor(project, mapper) ? STREAMWORLD_KNOCKBACK_KERNEL_HI_ALLOWANCE : 0;
  // Phase 2 slice 7a: the dialogue mapper/packet/attribute code is a FIFTH,
  // separately-gated kernel-hi term -- projectUsesText as well as
  // hasStreamed, since it lives inside its own `.if TEXT_ENABLED` (see
  // STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE's own comment).
  const streamworldDialogueMapperHiBytes =
    hasStreamed && projectUsesText(project) ? STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE : 0;
  // Fix round 2 (A4): slice 7b's own lifecycle/terrain/consumer helpers,
  // named separately (STREAMWORLD_DIALOGUE_LIFECYCLE_TERRAIN_CONSUMER_
  // KERNEL_HI_ALLOWANCE_BY_GAME_TYPE's own comment) but gated identically to
  // the mapper term above -- both live in the same sw_dlg_mapper_start..end
  // span. Game-type-varying (A1's draw_hud fix), the same reason
  // streamworldUpdatePlayerKernelHiAllowance(project) above is a function
  // call rather than a flat constant.
  const streamworldDialogueLifecycleHiBytes =
    hasStreamed && projectUsesText(project)
      ? streamworldDialogueLifecycleTerrainConsumerKernelHiAllowance(project)
      : 0;
  // Fix round 1 (A4): the twelve relocated text.asm bodies, named separately
  // (STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_ALLOWANCE's own comment) but
  // gated identically to the mapper term above -- all three live in the
  // same sw_dlg_mapper_start..end span.
  const streamworldDialogueRelocatedHiBytes =
    hasStreamed && projectUsesText(project) ? STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_ALLOWANCE : 0;
  const streamworldHiBytes = hasStreamed
    ? STREAMWORLD_KERNEL_HI_ALLOWANCE +
      STREAMWORLD_MT_PAL_KERNEL_HI_BYTES +
      streamworldMoveHiBytes +
      STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE +
      streamworldKnockbackHiBytes +
      streamworldUpdatePlayerKernelHiAllowance(project) +
      STREAMWORLD_HAZARD_KERNEL_HI_ALLOWANCE +
      streamworldDialogueMapperHiBytes +
      streamworldDialogueLifecycleHiBytes +
      streamworldDialogueRelocatedHiBytes
    : 0;
  if (musicBytes + sfxBytes + text.bytes + streamworldHiBytes > BANK_SIZE - 64) {
    problems.push({
      severity: 'error',
      where: musicBytes + sfxBytes > text.bytes ? 'Sound Forge' : 'Map Forge',
      message:
        `The songs and sound effects compile to ${musicBytes + sfxBytes} bytes (${musicBytes} music, ` +
        `${sfxBytes} effects), the dialogue to ${text.bytes}` +
        (streamworldHiBytes
          ? `, and the streaming engine${streamworldMoveHiBytes ? ' (including its scripted-Move probe)' : ''}` +
            ` to ${streamworldHiBytes}`
          : '') +
        `, which together do not fit the ${BANK_SIZE}-byte music and text bank. Shorten a song or ` +
        'effect, or cut some dialogue.'
    });
  }
  return {
    problems,
    capacity,
    reserveFlashSave,
    screenCount: flat.length,
    musicBytes,
    sfxBytes,
    textBytes: text.bytes,
    dataBankCount: layout.dataBankCount,
    streamedPlan
  };
}

/**
 * What a placed entity's own record byte (`ent_to_scr`) means, resolved
 * exactly once so emitScreens (below) and anything checking the same
 * question against a different build (test/lib/eventdecoder.js's own
 * consumer, handoff-maporg/design-maporg.md §7 item 2) get the identical
 * answer. Behaviour is exclusive -- a pickup actor's byte is the item it
 * grants under ITEMS_ENABLED, never a door target; every other behaviour
 * keeps the door-target expression `entity_door` is the only reader of --
 * so the two meanings never collide, and this is the single place that
 * decides which one a given placement's byte is (verbatim extraction of the
 * inline ternary this replaces; no ROM-visible change).
 */
export function resolveEntityByte(entity, actor, itemsEnabled, itemIdForActor, flatLength) {
  if (itemsEnabled && canBackItem(actor)) {
    return { kind: 'item', itemId: itemIdForActor.get(entity.actorId) ?? NO_ITEM };
  }
  return { kind: 'screen', flatIndex: Math.min(entity.props?.toScreen ?? 0, Math.max(0, flatLength - 1)) };
}

export async function generateAssets({ dir, project, log = () => {} }) {
  const { problems, capacity, reserveFlashSave, screenCount, streamedPlan } = checkCapacity(project);
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

  // Per-slot, every-tileset player stamp (design-modular-parts.md §4.3,
  // ROADMAP item 8 phase 2). Replaces the old all-or-nothing, tileset-0-only
  // spriteTableEmpty check outright: project.sprites.playerTiles is now the
  // single canonical source (generatePlayerSpriteCore writes only there,
  // never to a tileset directly, §4.1), so every tileset's own sprite table
  // is stamped fresh from it on every build, and a still-null slot falls back
  // to the placeholder per-slot rather than only when the whole table is
  // blank. This also fixes the pre-existing tileset-0-only placeholder gap
  // for free (§4.3's own "structural side effect"): a multi-tileset project
  // with no playerTiles content now shows the placeholder consistently on
  // every tileset, not only tileset 0.
  const placeholderQuadrants = PLACEHOLDER_FRAMES.map(split16);
  const placeholderFor = (i) => Array.from(placeholderQuadrants[Math.floor(i / 4) % 2][i % 4]).join('');
  for (const [tilesetIndex, tileset] of tilesets.entries()) {
    const overwrittenReal = [];
    for (let i = 0; i < PLAYER_TILES; i++) {
      const canonical = project.sprites.playerTiles[i];
      const replacement = canonical !== null ? canonical : placeholderFor(i);
      // A real, non-blank tile already sitting here that is about to become
      // something different is the "silent repaint of existing content" risk
      // (§3.2's own migration limitation, an NPC's own art, or simply a
      // tileset nobody has stamped yet) -- named below, once per divergent
      // tileset, per build. A tile that is already blank becoming real
      // content (or the placeholder) is the ordinary, intended case and
      // never worth a warning.
      if (!isBlank(tileset.sprites[i]) && tileset.sprites[i] !== replacement) overwrittenReal.push(i);
      tileset.sprites[i] = replacement;
    }
    if (overwrittenReal.length) {
      log(
        `warning: tileset ${tilesetIndex} ("${project.tilesets[tilesetIndex].name}") has ` +
          `${overwrittenReal.length} tile(s) in the player's reserved range ($00-$1F) that do not ` +
          'match the generated character and will look different in this build.'
      );
    }
  }
  // usedPlaceholder now means "at least one of the 32 slots resolved to the
  // placeholder," i.e. some playerTiles[i] === null -- not "the whole table
  // was blank," which is what the old spriteTableEmpty check meant.
  const placeholderSlotCount = project.sprites.playerTiles.filter((tile) => tile === null).length;
  const usedPlaceholder = placeholderSlotCount > 0;
  if (usedPlaceholder) {
    log(`note: ${placeholderSlotCount} of the ${PLAYER_TILES} player sprite slots used the placeholder.`);
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
  // Whether combatant_mag/combatant_mdef and spell_damage/cast_heal's own
  // call-site additions assemble at all -- MAGIC_POWER_ENABLED/MAGIC_DEFENCE_
  // ENABLED below, docs/design-magic-power.md §8. Two independent flags, not
  // one: a project can author one stat without the other, and each must be
  // gated on its own so a build using only one never assembles the other's
  // code (§8's own delta-measurement trap).
  const magicPowerEnabled = projectUsesMagicPower(project);
  const magicDefenceEnabled = projectUsesMagicDefence(project);
  // monster_turn's pick-first rewrite (docs/design-monster-spell-list.md
  // §6/§7) -- true iff some actor's battle.spellIds has two or more entries.
  const monsterSpellListEnabled = projectUsesMonsterSpellList(project);
  // Battle-side animation (docs/design-battle-animation.md §3.5):
  // battle_fx_tick/arm/draw. Broadened (§16, fix round 1) to
  // projectUsesAnyBattleAnimation -- battle_fx_arm_attack's own monster
  // branch and cast_spell's fallback call to it are reached whenever this
  // flag is live for ANY reason, including a party-only project, so the
  // shared mon_anim_attack/spell_anim tables must exist whenever a party
  // member's own attackAnim alone turns this flag on.
  const battleAnimEnabled = projectUsesAnyBattleAnimation(project);
  // §16 (docs/design-battle-animation.md, fix round 1): a party member's own
  // attackAnim, armed directly in attack_target (never through
  // battle_fx_arm_attack, which stays monster-only and untouched) -- an
  // independent gate from battleAnimEnabled above, since a project can want
  // either without the other.
  const partyAttackAnimEnabled = projectUsesPartyAttackAnim(project);
  // Phase 2a hit feedback (docs/design-battle-animation.md §12.7):
  // battle_hurt_arm/tick/attr_open/restore_slot, gated independently of
  // BATTLE_ANIM_ENABLED.
  const hitFeedbackEnabled = projectUsesHitFeedback(project);
  // Phase 2b MISS overlay (docs/design-battle-animation.md §13.9):
  // battle_miss_arm/tick/draw, gated independently of both
  // BATTLE_ANIM_ENABLED and HIT_FEEDBACK_ENABLED.
  const missEnabled = projectUsesMiss(project);
  // One generated constant, not a duplicated engine-side MAX_OAM_ENTRIES
  // equate plus a runtime add (§3.6). BATTLE_FX_OAM_ROOM is the room left for
  // the running effect once the worst-case combatant icons, the split-only
  // cursor and MISS's own fixed 4 tiles (§13.6, when live) have taken their
  // own share -- battle_fx_draw's own fit check (engine/battleui.asm)
  // compares a frame's ms_count against this single figure directly
  // (`cmp #BATTLE_FX_OAM_ROOM+1`), no addition and so no byte-overflow
  // question. Emitted unconditionally (an equate costs nothing unless used,
  // and it is only ever read inside .if BATTLE_ANIM_ENABLED code).
  // Single-writer extraction (docs/design-battle-animation.md §15.3): the
  // arithmetic itself now lives in shared/project.js's own battleFxOamRoom,
  // called here under a renamed local so the import is never shadowed by its
  // own initializer (a `const battleFxOamRoom = battleFxOamRoom(...)` line
  // would be a TDZ ReferenceError on every build).
  const battleFxRoom = battleFxOamRoom(project, mapper);

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
  const usesCamera = projectUsesCamera(project);
  const usesVisible = projectUsesVisible(project);
  const usesFade = projectUsesFade(project);
  const usesFlash = projectUsesFlash(project);
  const usesPaletteFx = projectUsesPaletteFx(project);
  const usesFace = projectUsesFace(project);
  const usesSting = projectUsesSting(project);
  const usesSfx = projectUsesSfx(project);
  const usesAudioFx = projectUsesAudioFx(project); // = usesSting || usesSfx
  // design-tile.md §8: its own local declaration, the usesSting three-scope
  // precedent (generateAssets computes its own local usesMove at line 1755 to
  // emit MOVE_ENABLED below, the identical shape).
  const usesBoundTiles = projectUsesBoundTiles(project);
  const saveIdentityValue = saveIdentity(project);
  if (usesHeartArt) {
    for (const tileset of tilesets) {
      for (const [index, tile] of Object.entries(HEART_TILES)) tileset.sprites[Number(index)] = tile;
    }
  }

  // The battle targeting cursor, or the naming grid's own cursor. On a
  // split-font board the background arrow glyph lives in the font's own
  // bank, which is only switched in below the text windows — and the battle
  // cursor points at monsters above them, so that build draws it as a sprite
  // instead. The naming disjunct is NOT ANDed with codeRegionCount: an action
  // project's own naming-grid cursor needs the identical art with no code
  // region in the picture at all (docs/design-name-entry.md §4, D8) --
  // spriteReservedRanges' own mirror-image widening is what reserves the
  // slot this stamps.
  if ((fontSplit && codeRegionCount(project)) || projectUsesNameEntry(project)) {
    for (const tileset of tilesets) tileset.sprites[SPRITE_ARROW_TILE] = SPRITE_ARROW_ART;
  }

  // Phase 2b MISS overlay (docs/design-battle-animation.md §13.5): every
  // tileset, not the battle tileset alone -- battleTilesetId can change
  // later, and every tileset must keep the slots free regardless, the
  // identical reasoning the arrow tile's own stamping above already uses.
  if (missEnabled) {
    for (const tileset of tilesets) {
      tileset.sprites[MISS_TILE_M] = MISS_TILE_M_ART;
      tileset.sprites[MISS_TILE_I] = MISS_TILE_I_ART;
      tileset.sprites[MISS_TILE_S] = MISS_TILE_S_ART;
    }
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
  const { flat, mapBase } = flattenScreens(project);
  // The compacted view every ordinary table below is built from (finding 2, phase 2 slice 1): a
  // streamed map's screens never occupy a row here, so this is shorter than `flat` whenever one
  // exists, and identical to it -- byte for byte, including row order -- when none does.
  const { ordinaryFlat, neighbours } = ordinaryScreenView(project);
  const hasStreamed = streamedPlan !== null;
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
  // GLOBAL, bounded by the GLOBAL screen count -- see NUM_SCREENS/START_SCREEN's own comment
  // below (finding 1, phase 2 slice 1 fix round 1): a compacted ordinary bound here would clamp a
  // title screen that legitimately lives on a later map.
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
  // In-game party-member naming (docs/design-name-entry.md §4/§8/§9). The
  // identical D8 shape kernelCodeBytes' own locals already use: usesHeroNaming
  // drops any battleEnabled AND (an action project's own battleEnabled is
  // always false), usesJoinNaming keeps it (Join naming can only ever run
  // through the banked machinery), and nameEntryBanked is the placement fact
  // the five kernel-lo shims read, independent of whether naming is live at
  // all.
  const usesHeroNaming = projectUsesHeroNaming(project);
  const usesJoinNaming = projectUsesJoinNaming(project) && codeSlots.length > 0;
  const usesNameEntry = usesHeroNaming || usesJoinNaming;
  const nameEntryBanked = codeSlots.length > 0;
  const usesNameSeed = projectNeedsNameSeed(project);
  const needsHeroDefault = projectNeedsHeroDefault(project);
  const usesNameToken = projectUsesNameToken(project);
  // NUM_SCREENS/START_SCREEN are GLOBAL identities, not the compacted ordinaryFlat count/index:
  // engine/boot.asm:290 (take_door) compares a GLOBAL warp target (warp_scr) against NUM_SCREENS,
  // and engine/save.asm:301 (save_check_range) compares a GLOBAL saved id (SAVE_FLAT_SCREEN)
  // against it too -- a value already truncated to the ordinary-only count here can never be
  // recovered at runtime (phase 2 slice 1 fix round 1, finding 1). Only the ORDINARY TABLE row
  // indices (screen_map, screen_bank, the pointer tables, screen_left/right/up/down) are compact;
  // they are built from ordinaryFlat, below, not from this count.
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
    // Moved here from battletables.js (docs/design-name-entry.md §5, P1-3):
    // nameentry.asm's own kernel-lo placement needs this equate too, and
    // battletables.js's own output is omitted entirely from an action
    // project's build -- so this project-independent RPG_LIMITS figure is
    // emitted unconditionally, the same shape NUM_VARIABLES just above
    // already uses, rather than duplicated in two places.
    `NAME_LEN      = ${RPG_LIMITS.nameLength}`,
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
    // Phase 2b MISS overlay (docs/design-battle-animation.md §13.5) --
    // generated FROM shared/font.js's own single JS authority, never
    // hand-typed in engine/constants.asm.
    `MISS_TILE_M = ${hex(MISS_TILE_M)}`,
    `MISS_TILE_I = ${hex(MISS_TILE_I)}`,
    `MISS_TILE_S = ${hex(MISS_TILE_S)}`,
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
    // In-game party-member naming (docs/design-name-entry.md §4/§5/§9).
    // NAME_ENTRY_BANKED decides which of engine/nameentry.asm's two mutually
    // exclusive .include sites fires; the other four are content flags,
    // independent of where the code lives.
    `NAME_ENTRY_ENABLED = ${usesNameEntry ? 1 : 0}`,
    `JOIN_NAMING_ENABLED = ${usesJoinNaming ? 1 : 0}`,
    `HERO_NAMING_ENABLED = ${usesHeroNaming ? 1 : 0}`,
    `NAME_ENTRY_BANKED = ${nameEntryBanked ? 1 : 0}`,
    `NAME_SEED_ENABLED = ${usesNameSeed ? 1 : 0}`,
    // The Say token (docs/design-name-entry.md §9a) -- no battleEnabledFor
    // term: text.asm is kernel-lo on every board and every game type.
    `NAME_TOKEN_ENABLED = ${usesNameToken ? 1 : 0}`,
    // The grid's own layout constants -- generated from shared/font.js's
    // charToTile, the same single-writer source engine/text.asm's own glyph
    // indices already come from. Cost nothing to emit off-gate (equates, no
    // bytes), so always present rather than conditional.
    `NAME_GRID_UPPER_BASE = ${hex(charToTile('A'))}`,
    `NAME_GRID_LOWER_BASE = ${hex(charToTile('a'))}`,
    `NAME_GRID_D_TILE = ${hex(charToTile('D'))}`,
    `NAME_GRID_E_TILE = ${hex(charToTile('E'))}`,
    `NAME_GRID_L_TILE = ${hex(charToTile('L'))}`,
    `NAME_GRID_N_TILE = ${hex(charToTile('N'))}`,
    // (BOX_TEXT_LO & $1F)*8 -- BOX_TEXT_LO is engine/constants.asm's own fixed
    // $22, not a generated value, so it is spelled out here rather than
    // imported from anywhere.
    `NAME_GRID_TEXT_COL0 = ${(0x22 & 0x1f) * 8}`,
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
    // Whether engine/streamworld.asm (the streamed-worlds resident set) is
    // assembled at all, from ONE predicate, projectUsesStreaming
    // (shared/streamlayout.js) -- docs/design-streamed-worlds.md, phase 2
    // slice 2a. A project with no streamed map assembles with the file
    // absent: ROM byte-identical.
    `STREAMING_ENABLED = ${hasStreamed ? 1 : 0}`,
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
    // docs/design-camera.md §8: gates the camera-register path inside
    // nmi_scroll (engine/boot.asm) -- the register and NMI rewrite phase 1
    // shipped alone, now paired with phase 2's own consumer
    // (CAMERA_SLIDE_ENABLED, below), derived from this identical flag. See
    // projectUsesCamera (shared/project.js).
    `CAMERA_ENABLED = ${usesCamera ? 1 : 0}`,
    // docs/design-camera.md §8, phase 2: the consumer's own gate --
    // screens.asm's draw_screen_at/draw_screen family, player.asm's cross_*
    // stub modifications, and main.asm's own camera.asm include. Derived
    // from the identical projectUsesCamera flag CAMERA_ENABLED reads -- there
    // is no separate project-level toggle; the split exists so a build that
    // measures the register alone (this file's own kernel-lo ledger tests)
    // can rewrite this one generated line without touching the schema.
    `CAMERA_SLIDE_ENABLED = ${usesCamera ? 1 : 0}`,
    // design-camera.md §5/Q3: which axis genuinely shows different content
    // across an edge, decided once at build time from the project's own
    // fixed mirroring choice against the real, resolved mirroring machinery
    // (cameraAxes, shared/cartridge.js) rather than a raw mirroring string --
    // vertical mirroring makes horizontal neighbours differ, horizontal
    // mirroring makes vertical neighbours differ, four-screen (UNROM 512
    // only) makes both differ. cross_left/right fold in CAMERA_SLIDE_H,
    // cross_up/down fold in CAMERA_SLIDE_V; the crossing's own DIR_* decides
    // which one applies, so no per-crossing runtime branch is needed -- the
    // whole gate is one compile-time constant per stub.
    `CAMERA_SLIDE_H = ${cameraAxes(mapper, project.cartridge).horizontal ? 1 : 0}`,
    `CAMERA_SLIDE_V = ${cameraAxes(mapper, project.cartridge).vertical ? 1 : 0}`,
    // OP_VISIBLE, the same shape again -- see projectUsesVisible
    // (shared/project.js). No companion *_ENABLED: nothing else calls
    // script_op_visible or reads ENT_HIDDEN.
    `VISIBLE_ENABLED = ${usesVisible ? 1 : 0}`,
    // OP_FADE, the same shape again -- see projectUsesFade (shared/project.js).
    // fade_apply_palette itself is gated on PALETTE_FX_ENABLED below, not
    // this flag alone, so Flash can reuse it -- see projectUsesPaletteFx.
    `FADE_ENABLED = ${usesFade ? 1 : 0}`,
    // OP_FLASH, the same shape again -- see projectUsesFlash
    // (shared/project.js).
    `FLASH_ENABLED = ${usesFlash ? 1 : 0}`,
    // Gates fade_apply_palette and the NMI PPUADDR fix (engine/entities.asm,
    // engine/boot.asm) on their own, the identical FACE_ENABLED shape below
    // gates move_face: both FADE_ENABLED and FLASH_ENABLED reach into this
    // one routine, so it must assemble whenever either does and be charged
    // exactly once when both do -- see projectUsesPaletteFx.
    `PALETTE_FX_ENABLED = ${usesPaletteFx ? 1 : 0}`,
    `FACE_ENABLED = ${usesFace ? 1 : 0}`,
    // OP_STING, the same shape again -- see projectUsesSting (shared/project.js). Gates
    // sting_snapshot/sting_restore/sting_tick and script_op_sting, plus the force_trig/
    // cancellation-check/music_stop-clear additions inside music_channel/music_play/music_stop.
    `STING_ENABLED = ${usesSting ? 1 : 0}`,
    // OP_SFX -- see projectUsesSfx (shared/project.js). Gates the restructured music_tick,
    // script_op_sfx, sfx_channel_tick/sfx_read_event/sfx_apply, music_stop's own ownership guard,
    // and init_session's session-boundary clear. See design-sfx.md §3.6/§3.8.
    `SFX_ENABLED = ${usesSfx ? 1 : 0}`,
    // The one piece genuinely shared between Sting and SFX -- force_trig's own check-and-clear
    // inside music_channel, plus sting_restore_silence's own SFX-ownership guard (which needs BOTH
    // flags, not this one alone -- see STING_SFX_INTERACTION_ALLOWANCE, main/build/generate.js).
    // See design-sfx.md §3.5.
    `AUDIO_FX_ENABLED = ${usesAudioFx ? 1 : 0}`,
    // Switch-bound tiles (design-tile.md §8): bound_tile_lookup,
    // rebuild_bound_cache, the script_op_set/script_op_clear hooks,
    // tile_switch_changed, queue_or_defer_flip, flip_cell_blocked, flip_emit/
    // flip_emit_packet, flip_tick and its main_loop call, the text_close_step
    // resolver swap, and the vram_reset pending-queue clear. BOUND_CAP is
    // generated from LIMITS.boundTilesPerScreen (shared/project.js) rather
    // than hand-spelled in engine/constants.asm the way MAX_ENTITIES
    // currently is for LIMITS.entitiesPerScreen -- a stronger single-writer
    // guarantee than that existing precedent.
    `BOUND_TILE_ENABLED = ${usesBoundTiles ? 1 : 0}`,
    `BOUND_CAP = ${LIMITS.boundTilesPerScreen}`,
    // combatant_mag/pc_mag_at/mon_mag and spell_damage's/cast_heal's own
    // add, and combatant_mdef/pc_mdef_at/mon_mdef and spell_damage's own
    // subtract-and-floor -- see projectUsesMagicPower/projectUsesMagicDefence
    // (shared/project.js) and docs/design-magic-power.md §7/§8. Two
    // independent flags: a project can author one stat without the other.
    `MAGIC_POWER_ENABLED = ${magicPowerEnabled ? 1 : 0}`,
    `MAGIC_DEFENCE_ENABLED = ${magicDefenceEnabled ? 1 : 0}`,
    // monster_turn's pick-first rewrite and its two gated helpers
    // (mod_monster_len, monster_pick_limit) -- see projectUsesMonsterSpellList
    // (shared/project.js) and docs/design-monster-spell-list.md §6/§7.
    // MONSTER_SPELLS is generated from RPG_LIMITS.monsterSpells the same way
    // NUM_VARIABLES above is generated from RPG_LIMITS.variables;
    // NO_SPELL is hand-defined in engine/constants.asm instead, a compile-time
    // engine sentinel rather than a project-derived limit.
    `MONSTER_SPELLS = ${RPG_LIMITS.monsterSpells}`,
    `MONSTER_SPELL_LIST_ENABLED = ${monsterSpellListEnabled ? 1 : 0}`,
    // Battle-side animation (docs/design-battle-animation.md §3.5/§3.6):
    // battle_fx_tick/arm/draw, gated on BATTLE_ANIM_ENABLED.
    // BATTLE_FX_OAM_ROOM is the compiled fit-check constant battle_fx_draw
    // reads (engine/battleui.asm); BATTLE_COMBATANT_OAM_MAX is never emitted.
    `BATTLE_ANIM_ENABLED = ${battleAnimEnabled ? 1 : 0}`,
    `BATTLE_FX_OAM_ROOM = ${battleFxRoom}`,
    // §16 (docs/design-battle-animation.md, fix round 1): attack_target's
    // own direct arm of a party member's attackAnim (pc_anim_attack),
    // independent of BATTLE_ANIM_ENABLED above -- a project can want either
    // without the other. The walk itself (BP_WALK) has no flag: it is
    // unconditional for every RPG project, per Chris's own "always on for
    // RPGs" answer, so it needs no generated equate at all.
    `PARTY_ATTACK_ANIM_ENABLED = ${partyAttackAnimEnabled ? 1 : 0}`,
    // Phase 2a hit feedback (docs/design-battle-animation.md §12.7):
    // battle_hurt_arm/tick/attr_open/restore_slot, and the blink-skip checks
    // in battle_sprite_pc/battle_sprite_mon. Independent of BATTLE_ANIM_ENABLED.
    `HIT_FEEDBACK_ENABLED = ${hitFeedbackEnabled ? 1 : 0}`,
    // Phase 2b MISS overlay (docs/design-battle-animation.md §13.9):
    // battle_miss_arm/tick/draw. Independent of both BATTLE_ANIM_ENABLED and
    // HIT_FEEDBACK_ENABLED.
    `MISS_ENABLED = ${missEnabled ? 1 : 0}`,
    // Streamed worlds (docs/design-streamed-worlds.md §3), phase 2 slice 1: the wire layout's own
    // constants, generated from shared/streamlayout.js (the single writer) rather than hand-typed
    // here -- emitted only when the project actually has a streamed map, so an ordinary project's
    // config.inc stays byte-for-byte what it always was. Nothing streamed reaches nesasm yet
    // (checkCapacity's own refusal, still live): these exist for the emitted layout files below,
    // and for the phase 2 engine that will read them.
    ...(hasStreamed
      ? [
          `STREAM_RECORD_BYTES = ${STREAM_RECORD_BYTES}`,
          `STREAM_TERRAIN_BYTES = ${STREAM_TERRAIN_BYTES}`,
          `STREAM_HIGH_PAGE = ${STREAM_HIGH_PAGE}`,
          `STREAM_SCREENS_PER_REGION = ${STREAM_SCREENS_PER_REGION}`,
          `STREAM_MAP_COLUMN_BYTES = ${STREAM_MAP_COLUMN_BYTES}`,
          `STREAM_OFF_TERRAIN = ${STREAM_OFFSETS.terrain}`,
          `STREAM_OFF_ENTITY_COUNT = ${STREAM_OFFSETS.entityCount}`,
          `STREAM_OFF_ENTITIES = ${STREAM_OFFSETS.entities}`,
          `STREAM_OFF_BOUND_COUNT = ${STREAM_OFFSETS.boundCount}`,
          `STREAM_OFF_BOUNDS = ${STREAM_OFFSETS.bounds}`,
          `STREAM_COL_TILESET = ${STREAM_MAP_COLUMNS.tileset}`,
          `STREAM_COL_FILL = ${STREAM_MAP_COLUMNS.fill}`,
          `STREAM_COL_BASE_BANK = ${STREAM_MAP_COLUMNS.baseBank}`,
          `STREAM_COL_REGIONS_PER_ROW = ${STREAM_MAP_COLUMNS.regionsPerRow}`,
          `STREAM_COL_GRID_W = ${STREAM_MAP_COLUMNS.gridW}`,
          `STREAM_COL_GRID_H = ${STREAM_MAP_COLUMNS.gridH}`,
          `STREAM_ENTITY_RECORD = ${STREAM_ENTITY_RECORD}`,
          `STREAM_BOUND_RECORD = ${STREAM_BOUND_RECORD}`
        ]
      : []),
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
      // design-tile.md §7/§8: the 15-entry nametable-address table
      // flip_emit_packet indexes by metatile row (0-14) to compute a bound
      // cell's own top/bottom packet addresses. Kernel-lo FIXED table data
      // (kernelTableBytes' own 30-byte fixedBytes term), not code -- emitted
      // only when the project uses the feature at all, matching every other
      // BOUND_TILE_ENABLED-gated emission.
      ...(usesBoundTiles
        ? [
            `bound_row_lo:\n${dbBlock(
              Array.from({ length: 15 }, (_, row) => ((row * 64) & 0xff))
            )}`,
            `bound_row_hi:\n${dbBlock(
              Array.from({ length: 15 }, (_, row) => (0x20 + ((row * 64) >> 8)))
            )}`
          ]
        : []),
      ''
    ].join('\n')
  );

  // docs/design-streamed-worlds.md (ROADMAP item 15), phase 2 slice 2a: mt_pal, the per-metatile
  // attribute-quadrant lookup sw_ns_draw_attr/sw_rw_attr_* (engine/streamworld.asm) need to
  // synthesize attribute bytes at render time -- the ordinary engine never needs this (it reads a
  // PRE-computed per-screen attribute block instead, screenAttributes()). A SEPARATE file from
  // metatiles.inc above and included from engine/main.asm inside the same `.if STREAMING_ENABLED`
  // block as streamworld.asm itself, in the kernel-HI region, not kernel-lo like mt_tl/tr/bl/br
  // above. Kernel-lo occupancy is NOT equal between a streamed and an unstreamed project any more
  // (fix round 1, finding 1 gated `assets/streamed.inc`'s locator/type tables into kernel-lo
  // beside `assets/maps.inc`); those tables are real, measured bytes -- kernelTableBytes' own
  // `streamedBytes` term, above, not this file. The .inc is compiled out entirely, not merely
  // empty, only when streaming is off.
  await fs.writeFile(
    path.join(assetsDir, 'streamworld_metatiles.inc'),
    hasStreamed
      ? `; Generated -- one attribute-quadrant palette entry per metatile id.\nmt_pal:\n${dbBlock(column((m) => m.palette ?? 0))}\n`
      : '; Generated -- this project has no streamed map; nothing to emit.\n'
  );

  // --- sprites, animations and actors --------------------------------------
  const playerTiles = Array.from({ length: PLAYER_TILES }, (_, index) => index);
  const playerActor = project.sprites.actors.find((actor) => actor.behavior === 'player');
  await fs.writeFile(path.join(assetsDir, 'sprites.inc'), spriteTables(project, playerTiles));
  await fs.writeFile(path.join(assetsDir, 'items.inc'), itemTables(project, itemsEnabled));

  // --- the naming grid's own default-name table -----------------------------
  // hero_name_default (docs/design-name-entry.md §8): kernel-lo, not $E000,
  // because its one reader (init_session's own action-side re-seed) is
  // kernel-lo code already. Emitted only when needsHeroDefault -- an RPG
  // never reads it at all, seeding pc_name_ram from the banked pc_name/
  // party_join path instead (§7/§8).
  await fs.writeFile(
    path.join(assetsDir, 'nameentry.inc'),
    needsHeroDefault
      ? `; Generated -- the hero's default name, for a build with no battle bank to seed pc_name_ram from.\n` +
        `hero_name_default:\n  .db ${nameTiles(project.party[0].name)
          .map((tile) => hex(tile))
          .join(',')}\n`
      : '; Generated -- an RPG seeds pc_name_ram from the banked pc_name table instead (see engine/battle.asm).\n'
  );

  // --- music ---------------------------------------------------------------
  await fs.writeFile(
    path.join(assetsDir, 'music.inc'),
    songTables(project.songs ?? []) + sfxTables(project.sfx ?? [])
  );

  // --- dialogue and events -------------------------------------------------
  await fs.writeFile(path.join(assetsDir, 'text.inc'), textTables(text));

  // --- controller mapping --------------------------------------------------
  // The nameentry row exists only when this project actually opts into
  // naming -- kernelTableBytes' own identical gate, above (§4's Y1 fix).
  const nameEntryStates = projectUsesNameEntry(project) ? INPUT_STATES : INPUT_STATES.slice(0, -1);
  const actionRows = nameEntryStates.map((state) => {
    const bindings = project.input.states[state] ?? {};
    return BUTTONS.map((button) => actionIndex(bindings[button]));
  });
  await fs.writeFile(
    path.join(assetsDir, 'input.inc'),
    [
      '; Generated -- one action per button, for each game state.',
      `; States: ${nameEntryStates.join(', ')}. Buttons: ${BUTTONS.join(', ')}.`,
      `input_actions:\n${actionRows.map((row) => `  .db ${row.map(hex).join(',')}`).join('\n')}`,
      ''
    ].join('\n')
  );

  // --- screen bank assignment ----------------------------------------------
  // Decided before maps.inc is written, because the lookup tables there carry the
  // bank each screen lives in. reserveFlashSave came back from checkCapacity
  // above rather than being recomputed here, so this and checkCapacity's own
  // screenCapacityFor call are provably looking at the same region list. With a streamed map,
  // streamedPlan is checkCapacity's own too (reused, not recomputed), so this packs the ordinary
  // screens into exactly what checkCapacity's own screenCapacityFor call already proved they fit.
  const { screenBank, regionRanges } = assignScreenBanks(
    mapper,
    project.tilesets.length,
    bankedCode,
    reserveFlashSave,
    ordinaryFlat,
    actorCount,
    usesBoundTiles,
    hasStreamed ? { regionsOverride: streamedPlan.remainingRegions } : {}
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
      `screen_map:\n${dbBlock(ordinaryFlat.map((entry) => project.maps.indexOf(entry.map)))}`,
      // One byte per screen rather than a map lookup at runtime: entering a
      // screen is the hot path, and screens.asm already has the flat index.
      `screen_tileset:\n${dbBlock(ordinaryFlat.map((entry) => entry.map.tilesetId))}`,
      // Which 16 KB PRG bank holds this screen's data. set_screen_ptr selects it
      // before dereferencing the pointers below.
      `screen_bank:\n${dbBlock(screenBank)}`,
      `screen_left:\n${dbBlock(neighbours.left)}`,
      `screen_right:\n${dbBlock(neighbours.right)}`,
      `screen_up:\n${dbBlock(neighbours.up)}`,
      `screen_down:\n${dbBlock(neighbours.down)}`,
      `screen_mt_lo:\n${pointerBlock(ordinaryFlat, (i) => `LOW(${screenLabel(i)})`)}`,
      `screen_mt_hi:\n${pointerBlock(ordinaryFlat, (i) => `HIGH(${screenLabel(i)})`)}`,
      `screen_at_lo:\n${pointerBlock(ordinaryFlat, (i) => `LOW(${screenLabel(i)}_attr)`)}`,
      `screen_at_hi:\n${pointerBlock(ordinaryFlat, (i) => `HIGH(${screenLabel(i)}_attr)`)}`,
      `screen_ent_lo:\n${pointerBlock(ordinaryFlat, (i) => `LOW(${screenLabel(i)}_ent)`)}`,
      `screen_ent_hi:\n${pointerBlock(ordinaryFlat, (i) => `HIGH(${screenLabel(i)}_ent)`)}`,
      // design-tile.md §4/§8: emitted only when the project uses the feature
      // at all -- a feature-free project cannot emit records that do not
      // exist, so it cannot be charged for them (byte identity).
      ...(usesBoundTiles
        ? [
            `screen_bound_lo:\n${pointerBlock(ordinaryFlat, (i) => `LOW(${screenLabel(i)}_bound)`)}`,
            `screen_bound_hi:\n${pointerBlock(ordinaryFlat, (i) => `HIGH(${screenLabel(i)}_bound)`)}`
          ]
        : []),
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
      const { screen } = ordinaryFlat[index];
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
        // unchanged, entity_door being the field's only reader of it. The
        // bound is the GLOBAL screen count, not ordinaryFlat.length: an
        // ordinary entity's door target is a GLOBAL id (resolveGlobalScreen's
        // own input at runtime), the same as a streamed entity's below --
        // only the ordinary LOOKUP TABLES this loop indexes into are compact
        // (phase 2 slice 1 fix round 1, finding 2).
        const actor = project.sprites.actors[entity.actorId];
        const resolved = resolveEntityByte(entity, actor, itemsEnabled, itemIdForActor, flat.length);
        const target = resolved.kind === 'item' ? resolved.itemId : resolved.flatIndex;
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

      // design-tile.md §4: count-prefixed, exactly the _ent shape -- switch,
      // cell index (row*16+col, the identical row-major index draw_screen/
      // probe_type/text_close_step already compute), substitute metatile.
      // Emitted only when the project uses the feature at all, matching the
      // screen_bound_lo/hi pointer table's own gate above.
      if (usesBoundTiles) {
        const boundBytes = [];
        const bound = screen.boundTiles ?? [];
        for (const entry of bound) {
          boundBytes.push(entry.switchId, entry.row * LIMITS.screenCols + entry.col, entry.metatileId);
        }
        chunks.push(`${screenLabel(index)}_bound:\n${dbBlock([bound.length, ...boundBytes], BOUND_TILE_RECORD)}`);
      }
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

  // --- streamed layout -------------------------------------------------------
  // Phase 2 slice 1 (docs/design-streamed-worlds.md §3): the emitter is wired into a real build,
  // but checkCapacity's own refusal above still fires for every streamed project on every board,
  // so nothing here has an engine consumer yet -- these files exist to be inspected and pinned by
  // test/unit/streamedlayout.test.js, and slice 2 is what actually .includes them into a ROM.
  // Emitted only when the project has a streamed map, matching every other conditional emission
  // in this function (an ordinary project's build is untouched, file for file).
  if (hasStreamed) {
    // Reuses the exact functions the ordinary screen emitter above already calls
    // (resolveEntityByte, text.eventFor, triggerIndex) rather than a second implementation of
    // any of the three -- CLAUDE.md's single-writer rule, applied to a placement's own fields.
    const streamedEntityFields = (entity, total) => {
      const actor = project.sprites.actors[entity.actorId];
      const resolved = resolveEntityByte(entity, actor, itemsEnabled, itemIdForActor, total);
      return {
        target: resolved.kind === 'item' ? resolved.itemId : resolved.flatIndex,
        event: text.eventFor.get(entity) ?? NO_EVENT,
        trigger: triggerIndex(entity, actor, project)
      };
    };
    const streamedLayout = emitStreamedLayout(project, {
      baseBanks: streamedPlan.baseBanks,
      entityFields: streamedEntityFields,
      actorCount
    });
    await fs.writeFile(
      path.join(assetsDir, 'streamed.inc'),
      [
        '; Generated -- the streamed-world type table (one bit per raw map index) and the',
        '; per-streamed-map locator columns (tileset, fill, base bank, regions per row, grid',
        '; width, grid height), kernel-lo.',
        `stream_type_bits:\n${dbBlock(streamedLayout.typeBits)}`,
        `stream_columns:\n${dbBlock(streamedLayout.streamedColumns, STREAM_MAP_COLUMN_BYTES)}`,
        ''
      ].join('\n')
    );
    // One 8 KB region per row-chunk, at its own allocated absolute nesasm bank
    // (planStreamedRegions' own baseBanks). The origin comes from `layout.regions`
    // (shared/cartridge.js's own prgLayout(mapper), already computed above) -- the single writer
    // for the bank-to-origin convention every other switchable-window region in this file already
    // reads it from (regionRanges' own `region.org`, just above) -- rather than a second,
    // hand-typed parity formula (phase 2 slice 1 fix round 1, finding 3: the prior formula's
    // `.toString(16)` also omitted nesasm's required `$` prefix, so `.org 8000` assembled as
    // decimal and `.org A000` as an undefined symbol).
    const regionOrg = new Map(layout.regions.map((r) => [r.nesasmBank, r.org]));
    const streamedRegionChunks = streamedLayout.maps
      .filter((map) => map.streamed)
      .flatMap((map) =>
        map.regions.map((region) => {
          const org = regionOrg.get(region.region);
          if (org === undefined) {
            throw new Error(`internal: streamed region ${region.region} is not one of ${mapper.name}'s switchable-window regions`);
          }
          return (
            `  .bank ${region.region}\n` +
            `  .org $${org.toString(16).toUpperCase()}\n` +
            `stream_region_${region.region}:\n${dbBlock(region.bytes)}`
          );
        })
      );
    await fs.writeFile(
      path.join(assetsDir, 'streamed_regions.inc'),
      `; Generated -- streamed map data, packed into 8 KB program regions (${STREAM_RECORD_BYTES} bytes per screen).\n${streamedRegionChunks.join('\n')}\n`
    );
  }

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
    `generated ${ordinaryFlat.length} screen${ordinaryFlat.length === 1 ? '' : 's'} across ${banksUsed} of ` +
      `${layout.dataBankCount} PRG bank${layout.dataBankCount === 1 ? '' : 's'}, capacity ${capacity}`
  );
  if (droppedEntities) {
    log(`warning: skipped ${droppedEntities} placed actor(s) that refer to an actor which no longer exists.`);
  }

  return {
    buildDir,
    warnings: problems.filter((problem) => problem.severity !== 'error'),
    stats: { screenCount, capacity, usedPlaceholder, playerActor: playerActor?.name ?? null }
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
  // an actor with nothing at all is marked NO_ANIM ($FF) so the engine draws
  // nothing. animFor lives in shared/project.js (single writer) since
  // resolveItemIcon and design-draw-validation.md's own predicates need the
  // identical fallback chain, and a second copy of this exact logic is the
  // drift single-writer exists to prevent.
  const animTable = list.flatMap((actor) => [
    animFor(actor, 'walkDown'),
    animFor(actor, 'walkUp'),
    animFor(actor, 'walkSide'),
    animFor(actor, 'walkSide')
  ]);
  chunks.push(`actor_anim_dir:\n${dbBlock(animTable, 4)}`);

  return `${chunks.join('\n')}\n`;
}

// animFor and resolveItemIcon now live in shared/project.js (single writer,
// design-draw-validation.md §3.5/§3.6) -- imported above rather than defined
// here.

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
