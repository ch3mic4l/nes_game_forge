// Where a streamed world's dialogue overlay lives, and the resident kernel-hi arithmetic that
// decides it (phase 2 slice 10b, review round 1 finding F1). `streamworldDialogueBanked` is the
// SINGLE definition of "this build moves engine/streamdialog.asm into the battle bank"; checkCapacity,
// the generated SW_DLG_BANKED flag, streamworldHiBytesFor, kernelCodeBytes AND the Build panel's battle
// meter all take it from here, so the panel can never promise room the build then denies.
//
// This module is renderer-safe: it touches no Node API, and everything it imports is itself pure --
// shared/, plus the two compilers main/build/songcompile.js and main/build/textcompile.js, which import
// only from shared/ (renderer/forges/sound/sound.js already imports songcompile.js the same way). It is
// the same purity rule main/build/battletables.js obeys; test/unit/streamplacementpure.test.js walks
// this file's whole import closure and refuses any `node:` specifier. The allowance constants below
// moved here verbatim from main/build/generate.js, which re-exports every name it used to export.

import { LIMITS, battleBankEnabled, projectUsesBoundTiles, projectUsesFlash, projectUsesMove, projectUsesSave } from '../../shared/project.js';
import { projectUsesText } from '../../shared/font.js';
import { resolveMapper, saveMediaImplemented } from '../../shared/cartridge.js';
import { projectUsesStreaming, projectUsesStreamedActors } from '../../shared/streamlayout.js';
import { songTableBytes, compileSfx } from './songcompile.js';
import { compileText } from './textcompile.js';
import { battleRegionBytes } from './battletables.js';

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
export function musicSize(songs) {
  return songTableBytes(songs);
}

/** Bytes the compiled sound effects will occupy: each effect's own compiled stream plus the one
 *  2-byte pointer-table entry it owns. Unconditional -- an authored, unreferenced effect still
 *  compiles, mirroring musicSize's own identical, pre-existing behavior for songs. See
 *  design-sfx.md §3.10. */
export function sfxSize(sfxList) {
  const list = sfxList?.length ? sfxList : [];
  return list.reduce((total, sfx) => total + compileSfx(sfx).bytes.length + 2, 0);
}

export const BANK_SIZE = 8192;

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
// STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE(834 then; 1024 now, see the history
// block at that constant) +
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
// clean build: 540 action/mixed, 537 rpg/mixed (523/520 before the Say/Move overrun fix, which
// rewrote sw_dlg_close_row to read each screen run once in chunks: +17 either way, charged to this
// lump; its resident reader is the separate READ_CHUNK term below). (The three sw_dlg_
// lifecycle_* boundary-label brackets from round 1 -- open_start..end 11,
// close_a_start..end 2, close_b_start..end 9 action/6 rpg, summing to 22
// action/19 rpg -- still exist and are still asserted below as an internal
// cross-check; they are a SUBSET of this lump, not an addend to it.) Gated
// identically to the mapper term above (both live in the same `.if
// TEXT_ENABLED` bracket of the same file).
export const STREAMWORLD_DIALOGUE_LIFECYCLE_TERRAIN_CONSUMER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE = {
  action: 540,
  rpg: 537
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

// The text-box close's bounded terrain read (engine/streamworld.asm, sw_dlg_read_chunk..
// sw_dlg_read_chunk_end: `jsr sw_read_run / jmp sw_locate_current`), the Say/Move overrun fix
// (handoff-next/streamed-worlds-say-move-overrun-impl-report.md). It is resident in BOTH
// placements -- the overlay may not name sw_locate_current or select a bank itself -- so it is
// charged by streamworldResidentHiBytes and stays charged when the overlay's three terms leave
// kernel-hi for the battle bank. Gated on usesText exactly like the three terms above (the
// label pair sits inside the file's own `.if TEXT_ENABLED`), flat across game type and mapper.
// Measured off nesasm's own symbol table by test/unit/kernelbytes.test.js.
export const STREAMWORLD_DIALOGUE_READ_CHUNK_KERNEL_HI_ALLOWANCE = 6;

// B1 (phase 2 slice 9 fix round 1b): the shared kernel-HI render routine
// itself (engine/streamworld.asm, sw_redraw_screen_landing..
// sw_redraw_screen_landing_end) -- new code in the sense that it did not
// exist as its own routine before (it was inlined, byte-for-byte, at BOTH
// call sites), but not new BEHAVIOR: deduplicating the two identical copies
// is exactly what shrank STREAMWORLD_RESOLVER_KERNEL_ALLOWANCE and
// STREAMWORLD_REDRAW_KERNEL_ALLOWANCE above. Gated identically to
// STREAMWORLD_KERNEL_HI_ALLOWANCE (hasStreamed alone -- every streamed
// project reaches at least one of the two call sites). Measured directly
// off nesasm's own symbol table, flat across action/rpg/mixed (confirmed,
// not assumed): 38.
export const STREAMWORLD_REDRAW_LANDING_KERNEL_HI_ALLOWANCE = 38;

// B1 (phase 2 slice 9 fix round 1b): spawn_streamed's own body, relocated
// whole to engine/streamworld.asm (spawn_streamed..spawn_streamed_end) --
// see STREAMWORLD_SPAWN_KERNEL_ALLOWANCE's own comment. Gated identically
// (hasStreamed alone). Measured directly, flat across action/rpg/mixed: 164
// -- byte-for-byte the same body, unchanged by the move.
export const STREAMWORLD_SPAWN_KERNEL_HI_ALLOWANCE = 164;

// B1 (phase 2 slice 9 fix round 1b): the single `jsr rebuild_bound_cache`
// inside `.if BOUND_TILE_ENABLED` that now lives in the shared kernel-HI
// sw_redraw_screen_landing (see STREAMWORLD_LANDING_BOUND_CACHE_KERNEL_
// ALLOWANCE's own comment) -- one call site now, not two, so 3 bytes, not 6.
// Gated on hasStreamed && usesBoundTiles, same as its kernel-lo predecessor.
// Measured directly (sw_redraw_screen_landing's span grows from 38 to 41
// with a bound tile authored anywhere in the project).
export const STREAMWORLD_LANDING_BOUND_CACHE_KERNEL_HI_ALLOWANCE = 3;

// B1 (phase 2 slice 9 fix round 1b): build_oam_draw_sw's own body, relocated
// whole to engine/streamworld.asm (build_oam_draw_sw..build_oam_draw_sw_end)
// -- see STREAMWORLD_PROJECT_KERNEL_ALLOWANCE's own comment. Gated
// identically (hasStreamed alone). Measured directly, flat across
// action/rpg/mixed: 108 -- byte-for-byte the same body, unchanged by the
// move.
export const STREAMWORLD_OAM_DRAW_SW_KERNEL_HI_ALLOWANCE = 108;

// B1 (phase 2 slice 9 fix round 1b): draw_one_entity_show_sw's own body,
// relocated whole to engine/streamworld.asm (draw_one_entity_show_sw..
// draw_one_entity_show_sw_end) -- see STREAMWORLD_PROJECT_KERNEL_ALLOWANCE's
// own comment. Gated identically (hasStreamed alone). Measured directly,
// flat across action/rpg/mixed: 164 -- byte-for-byte the same body,
// unchanged by the move.
export const STREAMWORLD_ENTITY_SHOW_SW_KERNEL_HI_ALLOWANCE = 164;

// Phase 3a slice S1: the cheap streamed entity projection (engine/streamworld.asm) REPLACES
// draw_one_entity_show_sw's 164 bytes on a project that places an actor on a streamed screen
// (projectUsesStreamedActors): sw_ent_setup (the per-frame origin, 59) followed by the
// three-class routine (336), one contiguous span sw_ent_setup..draw_one_entity_show_sw_end.
// The setup body is inside this term -- its 3-byte call is PROJ_SETUP_KERNEL_LO_ALLOWANCE
// (generate.js) -- so nothing is charged twice. Measured, flat across action and RPG: 395.
export const STREAMWORLD_ENTITY_PROJ_KERNEL_HI_ALLOWANCE = 395;

// Phase 3a slice S1: the Flash-publication deferral at sw_win_arm_row (engine/streamworld.asm,
// sw_win_arm_flash_guard..sw_win_arm_flash_guard_end): `lda <flash_left / cmp #FLASH_PENDING /
// beq sw_win_arm_done / cmp #FLASH_ARM_VALUE-1 / beq sw_win_arm_done`, 2 + 2 + 2 + 2 + 2 -- a row
// arm is skipped on a body whose flash_left reads the restore publication (FLASH_PENDING) or the Flash-on publication
// (FLASH_ARM_VALUE-1 at the guard, after flash_tick's decrement); a script re-arm after flash_tick is the exception. Kernel-hi, charged on
// projectUsesFlash while the project streams (streamworldResidentHiBytes is only reached for a
// streaming project); a project without Flash or without a streamed map assembles none of it. It
// sits inside the sw_win_col_inc..sw_win_arm_region_end span, so kernelbytes.test.js measures
// STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE with this span subtracted. Measured: 10, flat across
// action and RPG (6 while it covered the restore publication alone).
export const STREAMWORLD_WIN_ARM_FLASH_GUARD_KERNEL_HI_ALLOWANCE = 10;

// Phase 3a slice S3b: the streamed Move's own kernel-hi term (STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE, 76 for ruling 7's
// resident probe pair, 20 after S3a for the four sw_step_nocross guards) is GONE: the Move crosses a seam like a walking
// step, so the guards, the byte and the term are deleted, and the talker's kernel-hi cost below is the Move's whole
// streamed kernel-hi cost.

// Phase 3a slice S3b: the scripted Move may cross a screen seam, so the talker (the actor whose event is
// running) needs an identity that survives the respawn a crossing makes -- the one predicate for every
// talker term below, the generated TALKER_ENABLED flag and the Map Forge's own warning removal. A player
// Move is not required: an NPC-only Move on a streamed map pays the same (the plan's X = U and M).
export const projectUsesTalker = (project) => projectUsesStreaming(project) && projectUsesMove(project);

// The kernel-hi half of S3b's talker bookkeeping: sw_talker_capture/rebind/cross/battle_resume, Rule R's
// three entries and sw_talker_reset (engine/streamworld.asm, sw_talker_capture..sw_talker_end, one span: 196 on every
// board and game type). Gated projectUsesTalker; kernelbytes.test.js asserts it equal to nesasm's real span.
export const TALKER_KERNEL_HI_ALLOWANCE = 196;
// ...and the four `jsr sw_talker_cross` that end sw_pstep_right/left/down/up (3 bytes each, inside code that was already there).
export const TALKER_CROSS_CALLS_KERNEL_HI_ALLOWANCE = 12;

// Phase 2 slice 8: engine/streamworld.asm's sw_dlg_closeformove_start..end,
// the release half of the mechanism -- sw_dlg17_camrelease's own draw-down
// release jmps here instead of close_ui whenever MOVE_ENABLED (one 3-byte
// JMP absolute either way, so that call site itself costs the
// STREAMWORLD_DIALOGUE_LIFECYCLE_TERRAIN_CONSUMER_KERNEL_HI_ALLOWANCE_BY_
// GAME_TYPE span nothing, confirmed by re-measuring that span with usesMove
// on and off: 523/520 either way at the time, unchanged from before this slice; 540/537 since the
// Say/Move overrun fix, still the same on and off). Lives
// entirely inside the file's own `.if TEXT_ENABLED` bracket, itself gated on
// MOVE_ENABLED, so this is charged only usesStreaming && usesMove &&
// usesText, the identical gate as the kernel-lo term above. Measured
// directly (measureStreamedSpan), flat across all four action/RPG x
// streamed-only/mixed shapes: 14.
export const STREAMWORLD_CLOSEFORMOVE_KERNEL_HI_ALLOWANCE = 14;

// Phase 2 slice 8, review round 1 fix (B1's relocation ruling):
// engine/streamworld.asm's sw_dlg_cfm_guard_start..end -- the arming half of
// the mechanism, relocated whole out of kernel-lo (see
// STREAMWORLD_CLOSEFORMOVE_KERNEL_ALLOWANCE's own comment above). Also holds
// finding A1's fix: the mv_who check that restricts arming to the player
// (mv_who != 0), never an NPC's own scripted Move (mv_who == MOVE_SELF).
// Gated identically to its two siblings above (usesStreaming && usesMove &&
// usesText -- this routine lives inside the same `.if MOVE_ENABLED` block as
// sw_dlg_closeformove_check, itself inside the file's own `.if
// TEXT_ENABLED`). Measured directly (measureStreamedSpan), flat across all
// four action/RPG x streamed-only/mixed shapes: 31.
export const STREAMWORLD_CLOSEFORMOVE_GUARD_KERNEL_HI_ALLOWANCE = 31;

// Phase 2 slice 9: engine/streamworld.asm's sw_dlg17cr_save_check_start..end
// -- sw_dlg17_camrelease's own early-return when a Save is pending (acking
// the deferred close there and leaving the actual commit to ui_tick's poll,
// the same "acknowledge here, resolve later" split as close-for-Move's own
// camrelease/ui_tick pair). Lives inside the file's `.if SAVE_FLASH`
// wrapper, itself inside the dialogue package's `.if TEXT_ENABLED`, itself
// inside the file's own `.if STREAMING_ENABLED` include guard, so the
// effective gate is usesStreaming && usesText && usesSave (SAVE_FLASH ⟹
// TEXT_ENABLED makes this equal usesStreaming && usesSave in practice, but
// the nesting itself needs usesText named explicitly the same way its
// close-for-Move sibling above does). Measured directly
// (measureStreamedSpan): 6 with streaming+text+save. The labels do not
// exist at all with usesSave false (scenario B, the whole `.if SAVE_FLASH`
// block is absent) or with usesStreaming false (scenario C, the whole file
// is absent) -- both structurally correct absences, not measurement
// failures.
export const STREAMWORLD_SAVE_CAMRELEASE_KERNEL_HI_ALLOWANCE = 6;

// Phase 2 slice 9: engine/streamworld.asm's
// sw_dlg20_save_dispatch_start..end -- sw_dlg20_save_dispatch (the deferred-
// vs-immediate decision reached from script_op_save), sw_dlg20_save_check
// (the actual commit, reached either immediately or from the completion
// hook below) and, since fix round 1 (finding A1), sw_dlg20_pending_tick
// (the single completion hook engine/boot.asm's main_loop_save_gate now
// jsrs, replacing round 1's own ui_tick-based poll) all together. Same
// placement and gate as STREAMWORLD_SAVE_CAMRELEASE_KERNEL_HI_ALLOWANCE
// just above: usesStreaming && usesText && usesSave. Measured directly
// (handoff-next/s9-fix1-evidence/measure-terms.mjs): 52 with all three true
// (up from round 1's 35 -- sw_dlg20_pending_tick's own body, 12 bytes, plus
// its box_state/sw_dlg15_state double-check and A/Z-to-caller contract, is
// the entire growth), N/A (block absent, not a failure) with either
// usesSave or usesStreaming false.
export const STREAMWORLD_SAVE_DISPATCH_KERNEL_HI_ALLOWANCE = 52;

// Phase 2 slice 9, fix round 1 (B1 local win): engine/streamworld.asm's
// sw_save_commit_tail_start..end -- the kernel-hi trampoline that now holds
// the map_is_streamed dispatch save_media_commit's own tail used to decide
// in kernel-lo (see STREAMWORLD_SAVE_COMMIT_RESYNC_KERNEL_ALLOWANCE's own
// comment). Own `.if SAVE_FLASH` wrapper, bracketing labels outside it
// (same convention as sw_save_resync's own pair just below), inside the
// file's `.if STREAMING_ENABLED` include guard. Effective gate:
// usesStreaming && usesSave (no usesText -- a Save can commit with no
// dialogue box ever having been open). Measured directly: 12 with
// streaming+save, confirmed a true 0 with usesSave false and streaming
// true, N/A (file absent) with usesStreaming false.
export const STREAMWORLD_SAVE_COMMIT_TAIL_KERNEL_HI_ALLOWANCE = 12;

// Continue-y fix: engine/streamworld.asm's sw_save_streamed_screen_start..end --
// the body save_check_valid's player_y gate calls to ask whether a saved flat screen
// belongs to a streamed map (the map_base walk plus the stream_type_bits test, the
// two tables sw_resolve_screen reads). Inside the routine's own `.if SAVE_ENABLED`
// with the labels outside it, the convention of the commit-tail term above, so it
// measures a true 0 with no Save and is absent when the project is not streamed.
// 24 bytes, flat across game type and mapper (nothing conditional inside it). The
// call site is STREAMWORLD_SAVE_RANGE_KERNEL_ALLOWANCE (generate.js, kernel-lo).
export const STREAMWORLD_SAVE_RANGE_KERNEL_HI_ALLOWANCE = 24;

// Phase 2 slice 9: engine/streamworld.asm's sw_save_resync_start..end --
// sw_save_resync itself, the completion-frame resync (full sw_render_window
// redraw, OAM/DMA republish, manual $2000/$2005/$2005/$2001 scroll
// republish) that replaces the ordinary enable_rendering(0,0) tail once a
// streamed-map commit finishes. Placed near sw_position_jump_guard, outside
// the dialogue package entirely (a Save can commit with no dialogue box
// ever having been open, so this cannot depend on TEXT_ENABLED) -- only
// `.if SAVE_FLASH` around the routine body, inside the file's own `.if
// STREAMING_ENABLED` include guard. Effective gate: usesStreaming &&
// usesSave (no usesText). Measured directly: 48 with streaming+save on
// action, confirmed a true 0 with usesSave false and streaming true, and
// N/A (file absent) with usesStreaming false.
//
// Fix round 1 (finding A3): this term varies by game type and a flat 48
// overcharges RPG by 3 bytes -- the body's own `.if !BATTLE_ENABLED / jsr
// draw_hud / .endif` (one 3-byte call, engine/streamworld.asm) is
// action-only; RPG's own HUD is drawn elsewhere (draw_hud itself is
// unconditionally skipped whenever BATTLE_ENABLED, and every RPG project
// has battle enabled). Modeled the same way as
// STREAMWORLD_UPDATE_PLAYER_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE above: action
// 48 (measured directly), rpg 45 (derived by removing the one
// BATTLE_ENABLED-gated 3-byte call -- not independently measured by
// assembling a full RPG+Save ROM, because RPG + streamed + camera +
// SAVE_FLASH overflows kernel-lo for reasons unrelated to this term at all,
// see the needs-ruling kernelbytes.test.js entry just below this section;
// the arithmetic is exact regardless, since draw_hud's call site is the
// only BATTLE_ENABLED-conditional code anywhere in this routine's body).
export const STREAMWORLD_SAVE_RESYNC_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE = { action: 48, rpg: 45 };

const FALLBACK_STREAMWORLD_SAVE_RESYNC_KERNEL_HI_ALLOWANCE = Math.max(
  ...Object.values(STREAMWORLD_SAVE_RESYNC_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE)
);

export function streamworldSaveResyncKernelHiAllowance(project) {
  return (
    STREAMWORLD_SAVE_RESYNC_KERNEL_HI_ALLOWANCE_BY_GAME_TYPE[project.project?.gameType] ??
    FALLBACK_STREAMWORLD_SAVE_RESYNC_KERNEL_HI_ALLOWANCE
  );
}

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
// both game types). S3a.5 then shrank this, from 1102 to 1024:
// sw_camera_window_recompute's two per-frame repeated-subtract loops (camPy/240
// and the desired row's divmod 15) became closed forms off player_y, and the
// routine's Y half got 78 bytes shorter. Re-measured directly
// (measureStreamedSpan, same boundary labels): 1024, flat across
// action/RPG/mixed (confirmed by a real build of each).
export const STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE = 1024;

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

/**
 * Does this build move the streamed-world dialogue overlay (engine/streamdialog.asm) into the
 * battle bank? THE single writer of that fact (phase 2 slice 10b): the generated SW_DLG_BANKED
 * flag, checkCapacity, streamworldHiBytesFor/contentCeilingBytes, kernelCodeBytes and every
 * battleRegionBytes caller take it from here and nothing re-derives it.
 *
 * True only for a project that streams, has text, HAS a battle bank (battleBankEnabled -- never a
 * gameType string), and whose music+sfx+text exceed the RESIDENT ceiling, i.e. the ceiling as if
 * the overlay were not relocated. Computed from resident figures alone, so it can never depend on
 * its own outcome: a project that fits resident stays byte-identical to what it always was.
 */
export function streamworldDialogueBanked(project, mapper = resolveMapper(project.cartridge.mapper)) {
  if (!projectUsesStreaming(project) || !projectUsesText(project)) return false;
  if (!battleBankEnabled(project, mapper)) return false;
  const residentCeiling = BANK_SIZE - 64 - streamworldResidentHiBytes(project, mapper);
  return musicSize(project.songs) + sfxSize(project.sfx) + compileText(project).bytes > residentCeiling;
}

export function streamworldResidentHiBytes(project, mapper) {
  const usesMoveHere = projectUsesMove(project);
  const usesText = projectUsesText(project);
  const usesSaveHere = projectUsesSave(project) && saveMediaImplemented(mapper);
  const talkerHiBytes = projectUsesTalker(project) ? TALKER_KERNEL_HI_ALLOWANCE + TALKER_CROSS_CALLS_KERNEL_HI_ALLOWANCE : 0;
  const streamworldKnockbackHiBytes = !battleEnabledFor(project, mapper) ? STREAMWORLD_KNOCKBACK_KERNEL_HI_ALLOWANCE : 0;
  const streamworldDialogueMapperHiBytes = usesText ? STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE : 0;
  const streamworldDialogueLifecycleHiBytes = usesText
    ? streamworldDialogueLifecycleTerrainConsumerKernelHiAllowance(project)
    : 0;
  const streamworldDialogueRelocatedHiBytes = usesText ? STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_ALLOWANCE : 0;
  const streamworldDialogueReadChunkHiBytes = usesText ? STREAMWORLD_DIALOGUE_READ_CHUNK_KERNEL_HI_ALLOWANCE : 0;
  const streamworldCloseformoveHiBytes =
    usesMoveHere && usesText ? STREAMWORLD_CLOSEFORMOVE_KERNEL_HI_ALLOWANCE : 0;
  const streamworldCloseformoveGuardHiBytes =
    usesMoveHere && usesText ? STREAMWORLD_CLOSEFORMOVE_GUARD_KERNEL_HI_ALLOWANCE : 0;
  const streamworldSaveCamreleaseHiBytes =
    usesSaveHere && usesText ? STREAMWORLD_SAVE_CAMRELEASE_KERNEL_HI_ALLOWANCE : 0;
  const streamworldSaveDispatchHiBytes =
    usesSaveHere && usesText ? STREAMWORLD_SAVE_DISPATCH_KERNEL_HI_ALLOWANCE : 0;
  const streamworldSaveCommitTailHiBytes = usesSaveHere ? STREAMWORLD_SAVE_COMMIT_TAIL_KERNEL_HI_ALLOWANCE : 0;
  const streamworldSaveRangeHiBytes = usesSaveHere ? STREAMWORLD_SAVE_RANGE_KERNEL_HI_ALLOWANCE : 0;
  const streamworldSaveResyncHiBytes = usesSaveHere ? streamworldSaveResyncKernelHiAllowance(project) : 0;
  const streamworldLandingBoundCacheHiBytes = projectUsesBoundTiles(project)
    ? STREAMWORLD_LANDING_BOUND_CACHE_KERNEL_HI_ALLOWANCE
    : 0;
  return (
    STREAMWORLD_KERNEL_HI_ALLOWANCE +
    STREAMWORLD_MT_PAL_KERNEL_HI_BYTES +
    talkerHiBytes +
    STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE +
    (projectUsesFlash(project) ? STREAMWORLD_WIN_ARM_FLASH_GUARD_KERNEL_HI_ALLOWANCE : 0) +
    streamworldKnockbackHiBytes +
    streamworldUpdatePlayerKernelHiAllowance(project) +
    STREAMWORLD_HAZARD_KERNEL_HI_ALLOWANCE +
    streamworldDialogueMapperHiBytes +
    streamworldDialogueLifecycleHiBytes +
    streamworldDialogueRelocatedHiBytes +
    streamworldDialogueReadChunkHiBytes +
    streamworldCloseformoveHiBytes +
    streamworldCloseformoveGuardHiBytes +
    streamworldSaveCamreleaseHiBytes +
    streamworldSaveDispatchHiBytes +
    streamworldSaveCommitTailHiBytes +
    streamworldSaveRangeHiBytes +
    streamworldSaveResyncHiBytes +
    STREAMWORLD_SPAWN_KERNEL_HI_ALLOWANCE +
    STREAMWORLD_OAM_DRAW_SW_KERNEL_HI_ALLOWANCE +
    (projectUsesStreamedActors(project)
      ? STREAMWORLD_ENTITY_PROJ_KERNEL_HI_ALLOWANCE
      : STREAMWORLD_ENTITY_SHOW_SW_KERNEL_HI_ALLOWANCE) +
    STREAMWORLD_REDRAW_LANDING_KERNEL_HI_ALLOWANCE +
    streamworldLandingBoundCacheHiBytes
  );
}

/**
 * The battle region's byte total as the build sees it: the stock figure plus the dialogue overlay
 * when streamworldDialogueBanked relocates it into the region. The Build panel's "Battle system"
 * meter calls this and nothing else, so its used-bytes figure is checkCapacity's own.
 */
export function battleRegionBytesPlaced(project, mapper = resolveMapper(project.cartridge.mapper)) {
  return battleRegionBytes(project, mapper, { streamDialogueBanked: streamworldDialogueBanked(project, mapper) });
}
