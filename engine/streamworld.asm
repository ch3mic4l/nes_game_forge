; streamworld.asm -- the resident set for large streamed worlds
; (docs/design-streamed-worlds.md, ROADMAP item 15). Migrated from the
; design's own proven prototype (handoff-next/streamed-worlds-scratch,
; minimal-u512-fix23-move-clean/build/streamworld.asm), stripped of every
; test hook, coverage counter and superseded/retired variant. Assembled
; only when STREAMING_ENABLED (a project with a streamed map) -- see
; engine/main.asm's own .if around the include. No entry point here calls
; into this file yet: the resolver, refusal-narrowing and every real call
; site are phase 2 slice 2b onward. Every RAM byte this file references is
; allocated in engine/constants.asm, never here (single allocation map).
;
; The physical ring position of a world metatile is a function of its
; ABSOLUTE (screenCol,localCol)/(screenRow,localRow) alone, never of how
; far it sits from the window's current edge: a screen (16 cols x 15 rows)
; is exactly half the 32x30 torus on each axis, so the physical half a
; metatile belongs to is its owning screen's own row/column PARITY (even
; screenCol -> left half, odd -> right half; even screenRow -> top half,
; odd -> bottom half), and its position within that half is 2*localCol /
; 2*localRow. Retained content keeps its physical slot while only the
; entering edge moves.

; SW_STREAM_CHUNK -- metatiles drawn per vblank by sw_nmi_stream, under
; the arbitrated NMI (either the VRAM queue drains or a strip chunk runs,
; never both in the same vblank -- boot.asm's own arbitration). Measured
; against real Mesen vblank timing on both sample-u512 and sample-mmc3
; with everything else that can share a vblank (SPLIT_ENABLED's split_arm,
; CAMERA_ENABLED's $2000/$2005 rewrite) also live: 3 finishes with margin,
; 4 misses. Not project-derived -- an engine timing constant, not wire
; layout, so it lives here rather than shared/streamlayout.js.
SW_STREAM_CHUNK = 3

; SW_STREAM_MIXED_CHUNK -- sw_nmi_stream_reduced's own arming value, for a vblank that must share
; its budget with something sw_nmi_stream's own full chunk never had to (prototype fix round 11
; Part A): the identical draw loop, armed lower.
SW_STREAM_MIXED_CHUNK = 2

; Per-axis walk speeds for sw_walk_step_x/y, matched to each axis's own
; strip cost (a column strip is 30 blocks/10 vblanks at SW_STREAM_CHUNK=3;
; a row strip is 32 blocks/11 vblanks -- asymmetric, unlike a square
; window, so the two axes need different sustained rates). SW_SPEED_SUB_X
; = 128 is 1.5 px/frame (WHOLE_STEP 1, overflow every other frame): the
; worst-case single 16px crossing takes 11 frames against the column
; strip's 10-vblank need, a full frame of margin. SW_SPEED_SUB_Y = 112 is
; 1.4375 px/frame, not 128: at 128 the worst-case vertical crossing ties
; the row strip's 11-vblank need with zero margin and the mean crossing
; time runs an unbounded deficit; at 112 both the worst case (12 frames)
; and the mean (11.13 frames) clear 11 with real margin.
SW_SPEED_SUB_X = 128
SW_SPEED_SUB_Y = 112

; ==========================================================================
; sw_goto -- A=absolute screen column (0-254), X=absolute screen row
; (0-254). Selects the PRG bank holding that screen and points mtptr at its
; own terrain block, offset 0. Cold path only (strip-arming, render-window,
; map entry) -- the hot path (sw_locate_current, sw_cross_*) never calls
; this or multiplies anything.
; ==========================================================================
sw_goto:
  stx sw_tmp3                ; row
  ldx #0
sw_goto_coldiv:
  cmp #STREAM_SCREENS_PER_REGION
  bcc sw_goto_colrem
  sec
  sbc #STREAM_SCREENS_PER_REGION
  inx
  jmp sw_goto_coldiv
sw_goto_colrem:
  sta sw_tmp                 ; col_rem
  stx sw_tmp2                ; col_region
  ; col_byte = col_rem * STREAM_RECORD_BYTES, bounded repeated-add (<=23
  ; iterations) -- cold path only, never the hot path's own concern.
  lda #0
  sta sw_tmp5
  sta sw_tmp6
  ldx sw_tmp
  beq sw_goto_bytedone
sw_goto_byteloop:
  lda sw_tmp5
  clc
  adc #LOW(STREAM_RECORD_BYTES)
  sta sw_tmp5
  lda sw_tmp6
  adc #HIGH(STREAM_RECORD_BYTES)
  sta sw_tmp6
  dex
  bne sw_goto_byteloop
sw_goto_bytedone:
  lda #0
  sta sw_tmp4                 ; row_bank_base accumulator
  ldx sw_tmp3
  beq sw_goto_rowdone
sw_goto_rowloop:
  lda sw_tmp4
  clc
  adc sw_regions_per_row
  sta sw_tmp4
  dex
  bne sw_goto_rowloop
sw_goto_rowdone:
  lda sw_tmp4
  clc
  adc sw_tmp2
  clc
  adc sw_base_bank            ; A = absolute region index
  lsr a                       ; carry = region's low bit (org half)
  pha
  lda sw_tmp6
  bcc sw_goto_8000
  clc
  adc #$A0
  jmp sw_goto_orgset
sw_goto_8000:
  clc
  adc #$80
sw_goto_orgset:
  sta <mtptr_hi
  lda sw_tmp5
  sta <mtptr_lo
  pla
  jsr switch_prg_bank
  rts

; sw_locate_current -- O(1) recompute of the CURRENT screen's bank+mtptr
; from the persistently-maintained sw_col_byte_lo/hi/sw_col_region/
; sw_row_bank_base. Every caller that peeked at another screen calls this
; again afterward to restore.
sw_locate_current:
  lda sw_row_bank_base
  clc
  adc sw_col_region
  clc
  adc sw_base_bank
  lsr a
  pha
  lda sw_col_byte_hi
  bcc sw_lc_8000
  clc
  adc #$A0
  jmp sw_lc_orgset
sw_lc_8000:
  clc
  adc #$80
sw_lc_orgset:
  sta <mtptr_hi
  lda sw_col_byte_lo
  sta <mtptr_lo
  pla
  jsr switch_prg_bank
  rts

; ==========================================================================
; sw_enter_screen -- the cold-landing counterpart sw_goto itself never was:
; sw_goto only computes bank+mtptr TRANSIENTLY (sw_tmp..sw_tmp6), it never
; persists the "current field screen" fields sw_locate_current/sw_cross_*
; depend on. This is the one place those fields get a first, non-incremental
; value -- called only at a landing (phase 2 slice 2b's sw_resolve_screen),
; never mid-strip, never from NMI.
;
; In: A=screenCol, X=screenRow (the just-resolved streamed target).
; Out: mtptr/PRG bank point at the screen's own terrain, offset 0 (sw_goto's
; own contract); sw_col/sw_row/sw_col_rem/sw_col_region/sw_col_byte_lo/hi/
; sw_row_bank_base all hold this screen's own values, ready for
; sw_locate_current/sw_cross_* to build on. Clobbers A, X, Y, sw_tmp..sw_tmp6.
; ==========================================================================
sw_enter_screen:
  sta sw_col
  stx sw_row
  jsr sw_goto
  ; sw_goto's own transient scratch is still exactly what it computed --
  ; switch_prg_bank (every mapper variant) clobbers only A/X, and nothing
  ; else has run since -- so this is a straight copy, not a recompute.
  lda sw_tmp
  sta sw_col_rem
  lda sw_tmp2
  sta sw_col_region
  lda sw_tmp5
  sta sw_col_byte_lo
  lda sw_tmp6
  sta sw_col_byte_hi
  lda sw_tmp4
  sta sw_row_bank_base
  rts

; ==========================================================================
; sw_adv_offset -- advance an [mtptr_lo],y byte cursor by one, crossing into
; mtptr_hi+1 when Y wraps. A streamed record is STREAM_RECORD_BYTES (338)
; long -- past any single 8-bit Y -- so a sequential field-by-field walk
; past offset 255 (spawn_entities' own streamed branch, entities.asm) needs
; this instead of a bare `iny`. The caller is responsible for leaving
; mtptr_hi exactly as found once its own walk is done (jsr sw_locate_current
; -- the same restore sw_peek_byte/sw_render_window already end with).
; In/Out: Y. Clobbers nothing but Y; A/flags preserved by the caller's own
; next `lda [mtptr_lo],y`.
; ==========================================================================
sw_adv_offset:
  iny
  bne sw_adv_offset_done
  inc <mtptr_hi
sw_adv_offset_done:
  rts

; ==========================================================================
; sw_peek_byte -- the whole switch/read/restore sequence as ONE routine,
; never split across a caller-side "switch here, restore there" pair: a
; caller cannot reselect its own code bank after a jsr that just switched
; PRG banks out from under it, so this routine holds the whole transaction
; and restores the CALLER'S current field screen (via sw_locate_current)
; before returning -- a caller never sees the "wrong" screen mapped in.
;
; In: A = target screenCol, X = target screenRow, Y = byte offset within
;     that screen's own terrain (0-239).
; Out: A = the byte. sw_tmp3 clobbered. Clobbers X, Y.
; ==========================================================================
sw_peek_byte:
  ; Y needs no stashing: sw_goto never touches it. A/X must reach sw_goto
  ; exactly as the caller set them -- sw_goto uses sw_tmp..sw_tmp6 as its
  ; own scratch from its very first instruction, and a `tya` to stash Y
  ; would clobber A, the register sw_goto needs for screenCol.
  jsr sw_goto
  lda [mtptr_lo],y
  pha
  jsr sw_locate_current
  pla
  rts

; ==========================================================================
; sw_terrain_or_fill -- routes every terrain read through a fill-aware
; bounds check before any bank switch is attempted. The check is UNSIGNED:
; a resolved screenCol/Row of 255 (the 8-bit wraparound of a probe one
; column/row past the left/top edge) is >= any real sw_grid_w/sw_grid_h,
; so it falls into the fill path the same way a coordinate past the
; right/bottom edge does -- one check covers every direction.
;
; In: A=screenCol, X=screenRow, Y=offset within that screen (as
;     sw_peek_byte/sw_goto already expect).
; Out: A = the byte -- either the real terrain byte (sw_peek_byte's own
;     full switch/read/restore) or sw_fill_metatile_id, with no bank
;     switch attempted in the fill case. Clobbers X, Y exactly as
;     sw_peek_byte does in the real-read case; clobbers nothing in the
;     fill case.
; ==========================================================================
sw_terrain_or_fill:
  cmp sw_grid_w
  bcs sw_tof_fill              ; screenCol >= gridW (or wrapped negative) -> fill
  cpx sw_grid_h
  bcs sw_tof_fill              ; screenRow >= gridH (or wrapped negative) -> fill
  jmp sw_peek_byte             ; in bounds -- the real, restoring read
sw_tof_fill:
  lda sw_fill_metatile_id
  rts

; ==========================================================================
; sw_read_transaction -- the general resident switch/read/restore
; transaction, distinct from sw_peek_byte: where sw_peek_byte always
; restores the CURRENT FIELD screen (correct only when the caller IS
; mainline/field code), this restores whatever PRG bank the caller itself
; names -- correct for a caller resident in any bank (a banked consumer
; such as the RPG battle bank) whose own code bank is not the field's
; current screen.
;
; In: A = target screenCol, X = target screenRow, Y = offset within screen,
;     sw_caller_bank = the PRG bank number to restore (the CALLER's own
;     bank -- set this before the jsr).
; Out: A = the byte read. Clobbers X, Y.
; ==========================================================================
sw_read_transaction:
  jsr sw_goto
  lda [mtptr_lo],y
  pha
  lda sw_caller_bank
  jsr switch_prg_bank
  pla
  rts

; ==========================================================================
; sw_read_run -- the resident BOUNDED-RUN transaction: several real
; consumers (a collision probe checking more than one metatile across a
; straddled edge) need more than sw_read_transaction's single byte, and
; copying them to sw_run_buf BEFORE the restoring switch_prg_bank runs is
; mandatory for the same reason sw_read_transaction restores before
; returning at all -- the instruction after switch_prg_bank executes from
; whatever bank it just selected, so a caller resident in a different bank
; cannot safely dereference the target screen's own mtptr a second time
; once the restore has happened. sw_run_buf is its own dedicated 8-byte
; buffer (engine/constants.asm) -- it never reuses sbuf, the incremental
; strip's own in-flight buffer; a probe running mid-strip must not corrupt
; strip state, and a strip resuming after a probe must see nothing but its
; own bytes.
;
; In: A = target screenCol, X = target screenRow, Y = starting offset
;     within that screen's record, sw_run_len = byte count (1-8),
;     sw_caller_bank = the PRG bank number to restore (as
;     sw_read_transaction).
; Out: sw_run_buf[0..sw_run_len-1] holds the copy. Clobbers A, X, Y.
; Constraint, real and disclosed rather than guarded: Y+sw_run_len-1 must
; not exceed 255 (indirect-indexed addressing has no second index register
; to carry an overflow into mtptr_hi). Every caller in this design reads at
; most 8 bytes starting at a probe-computed offset within a 240-byte
; terrain block, so this never binds.
; ==========================================================================
sw_read_run:
  jsr sw_goto
  sty sw_run_off
  ldx #0
sw_read_run_loop:
  cpx sw_run_len
  bcs sw_read_run_done
  txa
  clc
  adc sw_run_off
  tay
  lda [mtptr_lo],y
  sta sw_run_buf,x
  inx
  jmp sw_read_run_loop
sw_read_run_done:
  lda sw_caller_bank
  jsr switch_prg_bank
  rts

; ==========================================================================
; sw_project_axis -- world-to-screen projection for a streamed camera. The
; second argument (sw_tmp3/sw_tmp4) is the camera's own WORLD-SPACE
; ORIGIN -- the world position already sitting at screen column/row 0 --
; never the player's own centre position; deriving that origin from the
; player is a separate, once-per-frame computation outside this routine.
; World and camera positions are UNSIGNED 16-bit: a legal 255-screen-wide
; world can reach world x=65,279, which a signed 16-bit value cannot hold.
; This does not change the subtraction below -- 6502 SBC is
; representation-agnostic two's-complement arithmetic; what matters is
; that any camera-to-tile distance this design ever asks about is small,
; so the result's own high byte is reliably $00 (a small positive/visible
; delta) or $FF (a small negative delta) whenever the tile is anywhere
; near the camera.
;
; A tile is visible iff 0 <= delta < visibleWidth. Any negative delta
; hides -- there is no partial-left-edge case: OAM X/Y truncation already
; draws a partial sprite for free once visibleWidth's own upper bound is
; respected.
;
; In: A = visibleWidth (256 truncates to 0 in an 8-bit compare, so the
;     caller passes 0 for X's own 256-wide case and the real 240 for Y),
;     sw_tmp/sw_tmp2 = world position lo/hi, sw_tmp3/sw_tmp4 = camera
;     ORIGIN lo/hi (already centred by the caller).
; Out: A = the 8-bit OAM byte (valid regardless of carry -- a hidden
;     tile's own truncated byte is still returned). Carry SET means fully
;     hidden; CLEAR means visible. Y-axis callers apply the
;     one-scanline-early OAM convention themselves.
; Clobbers nothing but A. Reuses sw_tmp/sw_tmp2/sw_tmp3/sw_tmp4/sw_tmp6 to
; stash visibleWidth -- safe because this never runs concurrently with
; sw_goto's cold path (both are mainline-only, never interrupt-time).
; ==========================================================================
sw_project_axis:
  sta sw_tmp6                 ; stash visibleWidth (0 means "256" for X)
  lda sw_tmp
  sec
  sbc sw_tmp3                 ; delta_lo = world_lo - cam_lo
  sta sw_tmp
  lda sw_tmp2
  sbc sw_tmp4                 ; delta_hi = world_hi - cam_hi
  sta sw_tmp2
  bne sw_project_hide         ; delta_hi != 0 (neither a small positive nor
                                ; a small negative delta) -> nowhere close
  lda sw_tmp6
  beq sw_project_visible      ; visibleWidth==0 means 256 -- every delta_hi==0
                                ; value (0-255) is visible, no further test
  lda sw_tmp
  cmp sw_tmp6                 ; delta_lo < visibleWidth (Y's real 240)?
  bcc sw_project_visible
sw_project_hide:
  lda sw_tmp
  sec
  rts
sw_project_visible:
  lda sw_tmp
  clc
  rts

; ==========================================================================
; sw_walk_step_x / sw_walk_step_y -- FALLEN STAR's own mechanism: WHOLE_STEP
; plus a per-axis subpixel accumulator that carries one extra pixel on
; overflow, duplicated per axis because the two axes need different
; sustained rates (SW_SPEED_SUB_X/SW_SPEED_SUB_Y, above). Each axis's own
; accumulator persists only while that axis is the one actually moving (no
; diagonal movement on a streamed map, so the two never run in the same
; frame), so switching axes never loses or duplicates fractional progress
; on the axis not currently held.
;
; In: nothing. Out: A = this frame's whole-pixel step (1 or 2) for the
; named axis. Clobbers nothing but A.
; ==========================================================================
sw_walk_step_x:
  lda sw_walk_acc_x
  clc
  adc #SW_SPEED_SUB_X
  sta sw_walk_acc_x
  lda #1
  bcc sw_walk_step_x_done
  lda #2
sw_walk_step_x_done:
  rts

sw_walk_step_y:
  lda sw_walk_acc_y
  clc
  adc #SW_SPEED_SUB_Y
  sta sw_walk_acc_y
  lda #1
  bcc sw_walk_step_y_done
  lda #2
sw_walk_step_y_done:
  rts

; ==========================================================================
; sw_clamp_col/sw_clamp_row -- clamp a desired window origin so the whole
; 32x30 resident window stays inside a map at least as big as the window.
; Exact, despite clamping at screen+local granularity rather than doing
; 16-bit flat arithmetic: the window's own far edge is origin+32 blocks
; (columns) or +30 (rows), and a screen is exactly 16 (or 15) blocks wide,
; so the only way a desired origin can overflow the grid is (a) screenCol
; already > grid_w-2, in which case any local offset also overflows, or
; (b) screenCol == grid_w-2 with a nonzero local offset. Both cases clamp
; to the identical result: (grid_w-2, 0), the exact rightmost/bottommost
; valid placement.
;
; Precondition, checked by the CALLER: sw_grid_w >= 2 (cols) / sw_grid_h
; >= 2 (rows) -- a map narrower/shorter than the window itself is a
; different policy (not implemented here).
;
; In: A=screenCol/screenRow, X=localCol/localRow (desired).
; Out: A=screenCol/screenRow, X=localCol/localRow (clamped).
; Clobbers sw_tmp/sw_tmp2 -- safe: this runs only at window-repositioning
; time, never from NMI.
; ==========================================================================
sw_clamp_col:
  sta sw_tmp2               ; desired screenCol
  stx sw_tmp                ; desired localCol
  lda sw_grid_w
  sec
  sbc #2
  cmp sw_tmp2
  bcc sw_clamp_col_clamp    ; max < screenCol -> overflow, clamp
  bne sw_clamp_col_fine     ; max > screenCol -> always fine, no clamp
  lda sw_tmp                ; max == screenCol: only local==0 is fine
  beq sw_clamp_col_fine
sw_clamp_col_clamp:
  lda sw_grid_w
  sec
  sbc #2
  ldx #0
  rts
sw_clamp_col_fine:
  lda sw_tmp2
  ldx sw_tmp
  rts

; sw_clamp_row: identical shape, screen height 15 (not 16) and ring height
; 30 (not 32) -- the clamp rule never depended on the screen/ring size
; values themselves, only on "a screen is one unit of the grid axis."
sw_clamp_row:
  sta sw_tmp2
  stx sw_tmp
  lda sw_grid_h
  sec
  sbc #2
  cmp sw_tmp2
  bcc sw_clamp_row_clamp
  bne sw_clamp_row_fine
  lda sw_tmp
  beq sw_clamp_row_fine
sw_clamp_row_clamp:
  lda sw_grid_h
  sec
  sbc #2
  ldx #0
  rts
sw_clamp_row_fine:
  lda sw_tmp2
  ldx sw_tmp
  rts

; sw_cross_right/left/up/down -- O(1) incremental updates. sw_col_byte_lo/
; hi track col_rem*STREAM_RECORD_BYTES incrementally (+/-STREAM_RECORD_BYTES
; per step, or reset/recomputed only at a region-boundary wrap), never a
; runtime multiply on this path.
sw_cross_right:
  inc sw_col
  inc sw_col_rem
  lda sw_col_rem
  cmp #STREAM_SCREENS_PER_REGION
  bne sw_cr_addbyte
  lda #0
  sta sw_col_rem
  inc sw_col_region
  sta sw_col_byte_lo
  sta sw_col_byte_hi
  rts
sw_cr_addbyte:
  lda sw_col_byte_lo
  clc
  adc #LOW(STREAM_RECORD_BYTES)
  sta sw_col_byte_lo
  lda sw_col_byte_hi
  adc #HIGH(STREAM_RECORD_BYTES)
  sta sw_col_byte_hi
  rts

sw_cross_left:
  lda sw_col_rem
  bne sw_cl_subbyte
  lda #STREAM_SCREENS_PER_REGION-1
  sta sw_col_rem
  dec sw_col_region
  ; recompute byte via a bounded repeated-add (rare: only at a region-
  ; boundary crossing, at most once every 24 screens of walking)
  lda #0
  sta sw_col_byte_lo
  sta sw_col_byte_hi
  ldx #STREAM_SCREENS_PER_REGION-1
sw_cl_wraploop:
  lda sw_col_byte_lo
  clc
  adc #LOW(STREAM_RECORD_BYTES)
  sta sw_col_byte_lo
  lda sw_col_byte_hi
  adc #HIGH(STREAM_RECORD_BYTES)
  sta sw_col_byte_hi
  dex
  bne sw_cl_wraploop
  jmp sw_cl_done
sw_cl_subbyte:
  dec sw_col_rem
  lda sw_col_byte_lo
  sec
  sbc #LOW(STREAM_RECORD_BYTES)
  sta sw_col_byte_lo
  lda sw_col_byte_hi
  sbc #HIGH(STREAM_RECORD_BYTES)
  sta sw_col_byte_hi
sw_cl_done:
  dec sw_col
  rts

sw_cross_down:
  inc sw_row
  lda sw_row_bank_base
  clc
  adc sw_regions_per_row
  sta sw_row_bank_base
  rts

sw_cross_up:
  dec sw_row
  lda sw_row_bank_base
  sec
  sbc sw_regions_per_row
  sta sw_row_bank_base
  rts

; --------------------------------------------------------------------------
; sw_stream_start_col -- A=screenCol, X=localCol of the ENTERING edge (an
; absolute screen/local pair, never a window-relative offset). Reads 30
; world metatiles (the window's own current row range, starting at
; win_row_screen/win_row_local) into sbuf, and sets st_ftile/st_fnt/
; st_vary from this design's own parity rule. Restores the CURRENT
; (player) screen's own bank before returning. Clobbers A, X, Y.
; --------------------------------------------------------------------------
sw_stream_start_col:
  stx sw_ss_lc
  sta sw_ss_sc
  txa
  asl a
  sta st_ftile                ; tile column = 2*localCol
  lda sw_ss_sc
  and #1
  asl a
  asl a
  sta st_fnt                  ; nt-hi contribution = (screenCol&1)*4
  ; st_vary starting value = (win_row_screen&1)*15 + win_row_local -- the
  ; window's own current physical row start.
  lda win_row_local
  sta st_vary
  lda win_row_screen
  and #1
  beq sw_ssc_novoffset
  lda st_vary
  clc
  adc #15
  sta st_vary
sw_ssc_novoffset:
  lda win_row_screen
  sta sw_probe_row_screen
  lda win_row_local
  sta sw_probe_row_local
  lda #0
  sta ss_i
  lda #$FF
  sta sw_last_screen_row
  sta sw_last_screen_col
sw_ssc_loop:
; Fill-aware bounds check, before the relocate cache test: sw_ss_sc is
; fixed for the whole column strip, so an out-of-bounds ENTERING column
; (a map narrower than the window needs) fills every block; sw_probe_
; row_screen advances every 15 local rows, so it alone can also carry the
; strip off the map's own authored bottom edge on a shorter map. Same
; unsigned test sw_terrain_or_fill uses.
  lda sw_ss_sc
  cmp sw_grid_w
  bcs sw_ssc_fill
  lda sw_probe_row_screen
  cmp sw_grid_h
  bcs sw_ssc_fill
  lda sw_ss_sc
  cmp sw_last_screen_col
  bne sw_ssc_relocate
  lda sw_probe_row_screen
  cmp sw_last_screen_row
  beq sw_ssc_read
sw_ssc_relocate:
  lda sw_ss_sc
  sta sw_last_screen_col
  lda sw_probe_row_screen
  sta sw_last_screen_row
  lda sw_ss_sc
  ldx sw_probe_row_screen
  jsr sw_goto
sw_ssc_read:
  lda sw_probe_row_local
  asl a
  asl a
  asl a
  asl a
  clc
  adc sw_ss_lc
  tay
  lda [mtptr_lo],y
  jmp sw_ssc_store
sw_ssc_fill:
; No real screen there -- invalidate the relocate cache (this strip's own
; screenRow only ever increases, so real territory is never re-entered
; after a fill run) and use the map's own fill metatile instead of
; dereferencing mtptr at all.
  lda #$FF
  sta sw_last_screen_col
  sta sw_last_screen_row
  lda sw_fill_metatile_id
sw_ssc_store:
  ldy ss_i
  sta sbuf,y
  inc ss_i
  inc sw_probe_row_local
  lda sw_probe_row_local
  cmp #15
  bne sw_ssc_noadv
  lda #0
  sta sw_probe_row_local
  inc sw_probe_row_screen
sw_ssc_noadv:
  lda ss_i
  cmp #30
  bne sw_ssc_loop
  jsr sw_locate_current        ; restore the CURRENT (player) screen
  lda #30
  sta st_len
  lda #0
  sta st_cur
  lda #1
  sta st_active
  rts

; sw_stream_start_row -- A=screenRow, X=localRow of the entering edge.
; Mirrors sw_stream_start_col's own shape exactly for the row axis.
sw_stream_start_row:
  stx sw_ss_lr
  sta sw_ss_sr
  txa
  asl a
  sta st_ftile                ; tile row = 2*localRow
  lda sw_ss_sr
  and #1
  asl a
  asl a
  asl a
  sta st_fnt                  ; nt-hi contribution = (screenRow&1)*8
  lda win_col_local
  sta st_vary
  lda win_col_screen
  and #1
  beq sw_ssr_novoffset
  lda st_vary
  clc
  adc #16
  sta st_vary
sw_ssr_novoffset:
  lda win_col_screen
  sta sw_probe_col_screen
  lda win_col_local
  sta sw_probe_col_local
  lda #0
  sta ss_i
  lda #$FF
  sta sw_last_screen_row
  sta sw_last_screen_col
sw_ssr_loop:
; The row arm's own mirror of the column arm's bounds-check fix above --
; sw_ss_sr is fixed for the whole row strip, sw_probe_col_screen advances
; every 16 local columns.
  lda sw_ss_sr
  cmp sw_grid_h
  bcs sw_ssr_fill
  lda sw_probe_col_screen
  cmp sw_grid_w
  bcs sw_ssr_fill
  lda sw_probe_col_screen
  cmp sw_last_screen_col
  bne sw_ssr_relocate
  lda sw_ss_sr
  cmp sw_last_screen_row
  beq sw_ssr_read
sw_ssr_relocate:
  lda sw_probe_col_screen
  sta sw_last_screen_col
  lda sw_ss_sr
  sta sw_last_screen_row
  lda sw_probe_col_screen
  ldx sw_ss_sr
  jsr sw_goto
sw_ssr_read:
  lda sw_ss_lr
  asl a
  asl a
  asl a
  asl a
  clc
  adc sw_probe_col_local
  tay
  lda [mtptr_lo],y
  jmp sw_ssr_store
sw_ssr_fill:
  lda #$FF
  sta sw_last_screen_col
  sta sw_last_screen_row
  lda sw_fill_metatile_id
sw_ssr_store:
  ldy ss_i
  sta sbuf,y
  inc ss_i
  inc sw_probe_col_local
  lda sw_probe_col_local
  cmp #16
  bne sw_ssr_noadv
  lda #0
  sta sw_probe_col_local
  inc sw_probe_col_screen
sw_ssr_noadv:
  lda ss_i
  cmp #32
  bne sw_ssr_loop
  jsr sw_locate_current
  lda #32
  sta st_len
  lda #0
  sta st_cur
  lda #2
  sta st_active
  rts

; ==========================================================================
; sw_nmi_stream -- draw SW_STREAM_CHUNK metatiles per vblank from sbuf.
; Uses sw_ns_chunk, a dedicated NMI-exclusive zero-page byte, never a
; mainline scratch byte such as sw_tmp4 -- an NMI can land mid-sw_goto
; (mainline code), so sharing scratch with it would corrupt sw_goto's own
; in-flight computation. st_vary is WRAPPED (mod 30 for a column strip,
; mod 32 for a row strip), not merely incremented forever.
; ==========================================================================
sw_nmi_stream:
  lda st_active
  bne sw_ns_go
  rts
sw_ns_go:
  lda #SW_STREAM_CHUNK
  sta <sw_ns_chunk
sw_ns_loop:
  lda st_cur
  cmp st_len
  bcs sw_ns_finish
  jsr sw_ns_draw_block
  inc st_cur
  lda st_cur
  cmp st_len
  bcs sw_ns_finish
  inc st_vary
  lda st_active
  cmp #1
  bne sw_ns_wrap32
  lda st_vary
  cmp #30
  bne sw_ns_wrapdone
  lda #0
  sta st_vary
  jmp sw_ns_wrapdone
sw_ns_wrap32:
  lda st_vary
  cmp #32
  bne sw_ns_wrapdone
  lda #0
  sta st_vary
sw_ns_wrapdone:
  dec <sw_ns_chunk
  bne sw_ns_loop
  rts
sw_ns_finish:
  lda #0
  sta st_active
  rts

; sw_nmi_stream_reduced -- the identical draw loop, armed with
; SW_STREAM_MIXED_CHUNK instead of the compiled SW_STREAM_CHUNK, for a
; vblank that must share its budget with another producer. No caller yet
; (phase 2b onward), migrated unreachable like the rest of this file.
sw_nmi_stream_reduced:
  lda st_active
  bne sw_nsr_go
  rts
sw_nsr_go:
  lda #SW_STREAM_MIXED_CHUNK
  sta <sw_ns_chunk
  jmp sw_ns_loop

; --------------------------------------------------------------------------
; sw_ns_draw_block -- draws metatile sbuf[st_cur] at its own TORUS
; position. This split logic (physical row 15 / column 16 boundary) is
; correct once st_vary genuinely holds the physical ring coordinate.
; X = metatile id.
; --------------------------------------------------------------------------
sw_ns_draw_block:
  ldy st_cur
  ldx sbuf,y
  lda st_active
  cmp #1
  bne sw_ndb_row
  lda st_ftile
  sta <sw_ns_col
  lda st_vary
  cmp #15
  bcc sw_ndb_col_top
  sec
  sbc #15
  asl a
  sta <sw_ns_row
  lda st_fnt
  clc
  adc #$08
  sta <sw_ns_nt
  jmp sw_ndb_addr
sw_ndb_col_top:
  asl a
  sta <sw_ns_row
  lda st_fnt
  sta <sw_ns_nt
  jmp sw_ndb_addr
sw_ndb_row:
  lda st_ftile
  sta <sw_ns_row
  lda st_vary
  cmp #16
  bcc sw_ndb_row_left
  sec
  sbc #16
  asl a
  sta <sw_ns_col
  lda st_fnt
  clc
  adc #$04
  sta <sw_ns_nt
  jmp sw_ndb_addr
sw_ndb_row_left:
  asl a
  sta <sw_ns_col
  lda st_fnt
  sta <sw_ns_nt
sw_ndb_addr:
  lda <sw_ns_row
  lsr a
  lsr a
  lsr a
  clc
  adc #$20
  clc
  adc <sw_ns_nt
  sta <sw_ns_row_hi
  lda <sw_ns_row
  and #7
  asl a
  asl a
  asl a
  asl a
  asl a
  ora <sw_ns_col
  sta <sw_ns_row_lo
  bit $2002
  lda <sw_ns_row_hi
  sta $2006
  lda <sw_ns_row_lo
  sta $2006
  lda mt_tl,x
  sta $2007
  lda mt_tr,x
  sta $2007
  lda <sw_ns_row_lo
  clc
  adc #32
  sta <sw_ns_row_lo
  bcc sw_ns_nohi
  inc <sw_ns_row_hi
sw_ns_nohi:
  lda <sw_ns_row_hi
  sta $2006
  lda <sw_ns_row_lo
  sta $2006
  lda mt_bl,x
  sta $2007
  lda mt_br,x
  sta $2007
  ; fall through to the attribute RMW (X still = metatile id)

sw_ns_draw_attr:
  lda <sw_ns_col
  lsr a
  and #1
  sta <sw_ns_q
  lda <sw_ns_row
  lsr a
  and #1
  asl a
  ora <sw_ns_q
  sta <sw_ns_q
  lda mt_pal,x
  ldy <sw_ns_q
  beq sw_nda_pdone
sw_nda_pshift:
  asl a
  asl a
  dey
  bne sw_nda_pshift
sw_nda_pdone:
  sta <sw_ns_pb
  lda #3
  ldy <sw_ns_q
  beq sw_nda_cdone
sw_nda_cshift:
  asl a
  asl a
  dey
  bne sw_nda_cshift
sw_nda_cdone:
  eor #$FF
  sta <sw_ns_cm
  lda <sw_ns_row
  lsr a
  lsr a
  asl a
  asl a
  asl a
  sta <sw_ns_ai
  lda <sw_ns_col
  lsr a
  lsr a
  ora <sw_ns_ai
  sta <sw_ns_ai
  lda <sw_ns_nt
  asl a
  asl a
  asl a
  asl a
  ora <sw_ns_ai
  sta <sw_ns_row_lo
  lda #HIGH(attr_shadow)
  sta <sw_ns_row_hi
  ldy #0
  lda [sw_ns_row_lo],y
  and <sw_ns_cm
  ora <sw_ns_pb
  sta [sw_ns_row_lo],y
  pha
  lda <sw_ns_nt
  clc
  adc #$23
  sta <sw_ns_row_hi
  lda <sw_ns_ai
  ora #$C0
  sta <sw_ns_row_lo
  bit $2002
  lda <sw_ns_row_hi
  sta $2006
  lda <sw_ns_row_lo
  sta $2006
  pla
  sta $2007
  rts

; ==========================================================================
; sw_render_window -- full four-nametable forced-blank redraw from the
; current window origin. sw_rw_attr_bl/br SKIP entirely (return 0,
; contribute nothing) for the 8th attribute cell row (arow==7), since a
; single 15-block-tall physical nametable has no valid content for that
; quadrant at all (its own row 15 belongs to a different physical
; nametable) -- matching this project's own screenAttributes' skip
; convention.
; ==========================================================================
sw_render_window:
  ; Compute the window's own ring origin once, before any nametable is
  ; drawn: wbase_col = (win_col_screen&1)*16 + win_col_local, wbase_row =
  ; (win_row_screen&1)*15 + win_row_local.
  lda win_col_screen
  and #1
  beq sw_rw_wbc_even
  lda #16
  jmp sw_rw_wbc_add
sw_rw_wbc_even:
  lda #0
sw_rw_wbc_add:
  clc
  adc win_col_local
  sta sw_rw_wbase_col
  lda win_row_screen
  and #1
  beq sw_rw_wbr_even
  lda #15
  jmp sw_rw_wbr_add
sw_rw_wbr_even:
  lda #0
sw_rw_wbr_add:
  clc
  adc win_row_local
  sta sw_rw_wbase_row
  lda #0
  sta sw_rw_nt
sw_rw_nt_loop:
  ldx sw_rw_nt
  lda sw_rw_nt_hi,x
  bit $2002
  sta $2006
  lda #0
  sta $2006
  lda sw_rw_ntx,x
  sta sw_rw_base_col
  lda sw_rw_nty,x
  sta sw_rw_base_row
  lda #$FF
  sta sw_last_screen_row
  sta sw_last_screen_col
  lda #0
  sta sw_rw_row
sw_rw_brow:
  lda #0
  sta sw_rw_col
sw_rw_top:
  jsr sw_rw_probe
  jsr sw_rw_read_metatile
  tax
  lda mt_tl,x
  sta $2007
  lda mt_tr,x
  sta $2007
  inc sw_rw_col
  lda sw_rw_col
  cmp #16
  bne sw_rw_top
  lda #0
  sta sw_rw_col
sw_rw_bot:
  jsr sw_rw_probe
  jsr sw_rw_read_metatile
  tax
  lda mt_bl,x
  sta $2007
  lda mt_br,x
  sta $2007
  inc sw_rw_col
  lda sw_rw_col
  cmp #16
  bne sw_rw_bot
  inc sw_rw_row
  lda sw_rw_row
  cmp #15
  bne sw_rw_brow
  lda sw_rw_nt
  asl a
  asl a
  asl a
  asl a
  asl a
  asl a
  sta <sw_rw_shadow_lo
  lda #HIGH(attr_shadow)
  sta <sw_rw_shadow_hi
  lda #0
  sta sw_rw_arow
sw_rw_arow_loop:
  lda #0
  sta sw_rw_acol
sw_rw_acol_loop:
  jsr sw_rw_attr_tl
  sta sw_rw_tmp
  jsr sw_rw_attr_tr
  asl a
  asl a
  ora sw_rw_tmp
  sta sw_rw_tmp
  jsr sw_rw_attr_bl
  asl a
  asl a
  asl a
  asl a
  ora sw_rw_tmp
  sta sw_rw_tmp
  jsr sw_rw_attr_br
  asl a
  asl a
  asl a
  asl a
  asl a
  asl a
  ora sw_rw_tmp
  sta $2007
  ldy #0
  sta [sw_rw_shadow_lo],y
  inc <sw_rw_shadow_lo
  bne sw_rw_shadow_nohi
  inc <sw_rw_shadow_hi
sw_rw_shadow_nohi:
  inc sw_rw_acol
  lda sw_rw_acol
  cmp #8
  bne sw_rw_acol_loop
  inc sw_rw_arow
  lda sw_rw_arow
  cmp #8
  bne sw_rw_arow_loop
  inc sw_rw_nt
  lda sw_rw_nt
  cmp #4
  beq sw_rw_done
  jmp sw_rw_nt_loop
sw_rw_done:
  jsr sw_locate_current
  rts

sw_rw_probe:
  lda sw_rw_base_col
  clc
  adc sw_rw_col
  jsr sw_rw_col_delta
  jsr sw_col_at_offset
  sta sw_probe_col_screen
  stx sw_probe_col_local
  lda sw_rw_base_row
  clc
  adc sw_rw_row
  jsr sw_rw_row_delta
  jsr sw_row_at_offset
  sta sw_probe_row_screen
  stx sw_probe_row_local
  lda sw_probe_row_local
  asl a
  asl a
  asl a
  asl a
  clc
  adc sw_probe_col_local
  sta sw_rw_offset
; Bounds check before the relocate cache test -- a probed cell can resolve
; to a screen past the map's own authored extent on either axis whenever
; the map is smaller than the render window's own two-screen physical
; reach. Same unsigned test sw_terrain_or_fill/the strip arms use.
  lda sw_probe_col_screen
  cmp sw_grid_w
  bcs sw_rwp_fill
  lda sw_probe_row_screen
  cmp sw_grid_h
  bcs sw_rwp_fill
  lda #0
  sta sw_rw_oob
  lda sw_probe_col_screen
  cmp sw_last_screen_col
  bne sw_rwp_relocate
  lda sw_probe_row_screen
  cmp sw_last_screen_row
  beq sw_rwp_done
sw_rwp_relocate:
  lda sw_probe_col_screen
  sta sw_last_screen_col
  lda sw_probe_row_screen
  sta sw_last_screen_row
  lda sw_probe_col_screen
  ldx sw_probe_row_screen
  jsr sw_goto
sw_rwp_done:
  rts
sw_rwp_fill:
; No real screen at this probe position -- invalidate the cache (a render
; pass revisits screens in a fixed raster order, never depending on a fill
; excursion leaving a stale "current" screen behind) and let sw_rw_read_
; metatile substitute the fill metatile with no dereference.
  lda #1
  sta sw_rw_oob
  lda #$FF
  sta sw_last_screen_col
  sta sw_last_screen_row
  rts

; sw_rw_read_metatile -- the single fill-aware read point shared by the
; terrain probe (sw_rw_top/sw_rw_bot, via sw_rw_probe above) and the
; attribute probe (sw_rw_attr_read, via sw_rw_attr_y_combine below) --
; both set sw_rw_oob and sw_rw_offset before falling in here.
sw_rw_read_metatile:
  lda sw_rw_oob
  beq sw_rw_rm_real
  lda sw_fill_metatile_id
  rts
sw_rw_rm_real:
  ldy sw_rw_offset
  lda [mtptr_lo],y
  rts

; sw_rw_col_delta/sw_rw_row_delta -- A = a torus/physical position (0-31
; col, 0-29 row) -> A = the window-relative DELTA (0-31 / 0-29)
; sw_col_at_offset/sw_row_at_offset expect.
sw_rw_col_delta:
  sec
  sbc sw_rw_wbase_col
  and #31
  rts

sw_rw_row_delta:
  clc
  adc #30
  sec
  sbc sw_rw_wbase_row
  cmp #30
  bcc sw_rw_row_delta_ok
  sec
  sbc #30
sw_rw_row_delta_ok:
  rts

; sw_col_at_offset/sw_row_at_offset -- window-relative-DELTA-to-world
; mapping (the delta already wbase-relative, via sw_rw_col_delta/
; sw_rw_row_delta above), used only by sw_render_window/sw_rw_probe (a
; full, fresh-every-time redraw, where window-relative addressing is
; safe -- nothing is retained across calls the way the incremental strip
; path must retain physical positions).
sw_col_at_offset:
  clc
  adc win_col_local
  pha
  and #15
  tax
  pla
  lsr a
  lsr a
  lsr a
  lsr a
  clc
  adc win_col_screen
  rts

sw_row_at_offset:
  clc
  adc win_row_local
  ldx #0
sw_row_off_loop:
  cmp #15
  bcc sw_row_off_done
  sec
  sbc #15
  inx
  jmp sw_row_off_loop
sw_row_off_done:
  tay
  txa
  clc
  adc win_row_screen
  pha
  tya
  tax
  pla
  rts

; sw_rw_attr_* -- return A = mt_pal of one of the current cell's four
; blocks, or 0 if the quadrant has no valid same-nametable content.
sw_rw_attr_tl:
  jsr sw_rw_attr_x0
  jsr sw_rw_attr_y0
  jmp sw_rw_attr_read
sw_rw_attr_tr:
  jsr sw_rw_attr_x1
  jsr sw_rw_attr_y0
  jmp sw_rw_attr_read
sw_rw_attr_bl:
  lda sw_rw_arow
  cmp #7
  beq sw_rw_attr_zero
  jsr sw_rw_attr_x0
  jsr sw_rw_attr_y1
  jmp sw_rw_attr_read
sw_rw_attr_br:
  lda sw_rw_arow
  cmp #7
  beq sw_rw_attr_zero
  jsr sw_rw_attr_x1
  jsr sw_rw_attr_y1
sw_rw_attr_read:
  jsr sw_rw_read_metatile
  tax
  lda mt_pal,x
  rts
sw_rw_attr_zero:
  lda #0
  rts
sw_rw_attr_x0:
  lda sw_rw_acol
  asl a
  clc
  adc sw_rw_base_col
  jsr sw_rw_col_delta
  jsr sw_col_at_offset
  sta sw_tmp3
  jmp sw_rw_attr_x_read
sw_rw_attr_x1:
  lda sw_rw_acol
  asl a
  clc
  adc #1
  clc
  adc sw_rw_base_col
  jsr sw_rw_col_delta
  jsr sw_col_at_offset
  sta sw_tmp3
sw_rw_attr_x_read:
  stx sw_rw_tmp2
  rts
sw_rw_attr_y0:
  lda sw_rw_arow
  asl a
  clc
  adc sw_rw_base_row
  jsr sw_rw_row_delta
  jsr sw_row_at_offset
  jmp sw_rw_attr_y_combine
sw_rw_attr_y1:
  lda sw_rw_arow
  asl a
  clc
  adc #1
  clc
  adc sw_rw_base_row          ; every bottom-half quadrant must read the
                                ; actual world row, not as if base_row
                                ; were 0
  jsr sw_rw_row_delta
  jsr sw_row_at_offset
sw_rw_attr_y_combine:
  pha
  txa
  asl a
  asl a
  asl a
  asl a
  clc
  adc sw_rw_tmp2
  sta sw_rw_offset
; The same bounds check as sw_rw_probe, applied to the ATTRIBUTE
; quadrant's own (possibly different) probed screen -- an attribute
; lookup can reach one metatile past the terrain probe's own position (the
; neighbour quadrant), so it needs its own independent check.
  lda sw_tmp3                 ; screenCol
  cmp sw_grid_w
  bcs sw_rwa_fill_col
  pla                          ; A = screenRow, stack now balanced
  cmp sw_grid_h
  bcs sw_rwa_fill_row
  pha                          ; restore the original stack shape for the
                                ; unchanged cache-compare logic below
  lda #0
  sta sw_rw_oob
  lda sw_tmp3
  cmp sw_last_screen_col
  bne sw_rwa_relocate
  pla
  cmp sw_last_screen_row
  beq sw_rwa_done
  pha
sw_rwa_relocate:
  lda sw_tmp3
  sta sw_last_screen_col
  pla
  sta sw_last_screen_row
  lda sw_tmp3
  ldx sw_last_screen_row
  jsr sw_goto
sw_rwa_done:
  rts
sw_rwa_fill_col:
  pla                          ; balance the entry pha; value unused (fill)
sw_rwa_fill_row:
  lda #1
  sta sw_rw_oob
  lda #$FF
  sta sw_last_screen_col
  sta sw_last_screen_row
  rts

sw_rw_nt_hi:  .db $20, $24, $28, $2C
sw_rw_ntx:    .db 0, 16, 0, 16
sw_rw_nty:    .db 0, 0, 15, 15

; ==========================================================================
; sw_resolve_screen -- phase 2 slice 2b. The runtime counterpart of
; main/build/streamed.js's own resolveGlobalScreen(): a map-order prefix
; walk over map_base/stream_type_bits/stream_columns (every one already
; emitted for some other consumer; no new ROM table exists for this) that
; turns a GLOBAL screen id into either an ordinary table row or a streamed
; landing. This is the single place either happens -- every one of the 5
; landing sites (cold boot, start_game, restart_game, take_door via
; redraw_screen, continue_game via redraw_screen) reaches this and only this.
;
; In: A = target GLOBAL screen id (0..NUM_SCREENS-1 -- the caller's own
;     bounds check, take_door's `cmp #NUM_SCREENS`/save.asm's SAVE_FLAT_
;     SCREEN check, already guarantee this).
; Out: map_is_streamed set to 0 (ordinary) or 1 (streamed).
;   Ordinary: ord_screen holds the compacted row index every *_bank/
;   *_tileset/*_mt_lo/*_left/*_map/*_ent_lo/*_bound_lo table is keyed by.
;   No other state touched -- the caller still does its own switch_chr_bank/
;   set_screen_ptr/etc, unchanged.
;   Streamed: mtptr/PRG bank/CHR bank already point at the target screen,
;   win_col_screen/row+local already frame the entered screen as the
;   window's own top-left origin (no local offset -- no scrolling wired
;   yet, Part C's wall keeps the player here), cam_nt/cam_x_lo/cam_y_lo
;   already hold that origin's own landing scroll, cur_map/music already
;   updated (apply_map_music_direct). The caller must still call
;   sw_render_window (the streamed "draw the picture" -- there is no
;   redraw_screen-equivalent single call, by design: an ordinary landing's
;   own draw_screen/rebuild_bound_cache/spawn_entities/etc split stays
;   exactly what it is) and its own spawn_entities/build_oam/draw_entities/
;   scroll-publish tail.
; Clobbers: A, X, Y, sw_tmp..sw_tmp6.
; ==========================================================================
; STREAM_COL_TILESET/FILL/BASE_BANK/REGIONS_PER_ROW/GRID_W/GRID_H are
; generated equates (config.inc, main/build/generate.js), the same
; single-writer STREAM_MAP_COLUMNS shared/streamlayout.js's own emitter
; uses -- not redefined here.
sw_bit_mask: .db 1, 2, 4, 8, 16, 32, 64, 128

sw_resolve_screen:
  ; F9 (phase 2 slice 2b fix round 1): NO_SCREEN is rejected FIRST, before any
  ; prefix walk -- the plan's own word for the result is "parked": the
  ; resolved identity (map_is_streamed/ord_screen and everything the streamed
  ; branch below sets) is left exactly as it was before this call, not
  ; overwritten with a screen-0-shaped guess a caller might go on to render.
  ; No shipping caller passes NO_SCREEN today (take_door/save.asm both bounds-
  ; check first), so this is a contract completion, not a reachable-today fix.
  cmp #NO_SCREEN
  bne sw_resolve_not_parked
  rts                        ; parked: previously-resolved identity untouched
sw_resolve_not_parked:
  sta sw_tmp                 ; target id
  ; A real landing (never a park) also clears any strip-arming/in-flight state
  ; slice 2a allocated: st_active is the master idle flag (0 = idle), and
  ; nothing arms a strip yet (Part C's wall), so this is defensive against
  ; slice 4b's future movement driver leaving stale state across a landing,
  ; not a claim of a presently reachable race.
  lda #0
  sta st_active
  sta sw_tmp3                 ; ordinaryPrefix
  sta sw_tmp4                 ; streamedPrefix (== streamedMapIndex-so-far)
  ldx #0                      ; X = mapIndex
sw_resolve_loop:
  ; next = (mapIndex+1 < NUM_MAPS) ? map_base[mapIndex+1] : NUM_SCREENS
  inx
  cpx #NUM_MAPS
  bcc sw_resolve_next_table
  lda #NUM_SCREENS
  jmp sw_resolve_have_next
sw_resolve_next_table:
  lda map_base,x
sw_resolve_have_next:
  dex                         ; X = mapIndex again
  sta sw_tmp5                 ; next
  ; streamed = bit (mapIndex & 7) of stream_type_bits[mapIndex >> 3]
  txa
  lsr a
  lsr a
  lsr a
  tay
  lda stream_type_bits,y
  sta sw_tmp6                  ; this map's own type-bits byte
  txa
  and #7
  tay
  lda sw_bit_mask,y
  and sw_tmp6
  sta sw_tmp6                  ; sw_tmp6 = streamed flag (0 or nonzero)
  lda sw_tmp
  cmp sw_tmp5                  ; id < next?
  bcc sw_resolve_owner
  lda sw_tmp6
  beq sw_resolve_ordinary_advance
  inc sw_tmp4                  ; streamedPrefix += 1
  jmp sw_resolve_continue
sw_resolve_ordinary_advance:
  lda sw_tmp5
  sec
  sbc map_base,x
  clc
  adc sw_tmp3
  sta sw_tmp3                  ; ordinaryPrefix += next - map_base[mapIndex]
sw_resolve_continue:
  inx
  cpx #NUM_MAPS
  bne sw_resolve_loop
  ; Ran off the end without finding an owner -- cannot happen for an id the
  ; caller's own bounds check already admitted; defensively resolve as
  ; ordinary screen 0 rather than dispatch on garbage.
  lda #0
  sta <map_is_streamed
  sta <ord_screen
  rts

sw_resolve_owner:
  lda sw_tmp
  sec
  sbc map_base,x
  sta sw_tmp5                  ; offset within the owning map (next no longer needed)
  lda sw_tmp6
  bne sw_resolve_owner_streamed
  lda sw_tmp3
  clc
  adc sw_tmp5
  sta <ord_screen
  lda #0
  sta <map_is_streamed
  rts

sw_resolve_owner_streamed:
  lda #1
  sta <map_is_streamed
  txa
  jsr apply_map_music_direct    ; X = owning raw mapIndex; A/X/Y free after
  ; streamedMapIndex * STREAM_MAP_COLUMN_BYTES (6) as a real 16-bit pointer --
  ; an 8-bit `*6` wraps past streamed map 43 (43*6=258, beyond Y's 255-byte
  ; reach from a fixed base): the codebase's own "8-bit multiply used as a
  ; table offset silently wraps; add into a 16-bit pointer instead" trap
  ; (CLAUDE.md). sw_tmp/sw_tmp6 hold streamedMapIndex*2 (16-bit); ptr_lo/
  ; ptr_hi (generic scratch pointer, untouched by apply_map_music_direct and
  ; switch_chr_bank) accumulate *4 then +*2 = *6, then the table's own base
  ; address, for indirect-indexed field reads below.
  lda sw_tmp4                   ; streamedMapIndex
  asl a
  sta sw_tmp                    ; idx*2 lo
  lda #0
  rol a
  sta sw_tmp6                   ; idx*2 hi
  lda sw_tmp
  sta <ptr_lo
  lda sw_tmp6
  sta <ptr_hi                   ; ptr_lo/ptr_hi = idx*2
  asl <ptr_lo
  rol <ptr_hi                   ; ptr_lo/ptr_hi = idx*4
  lda <ptr_lo
  clc
  adc sw_tmp
  sta <ptr_lo
  lda <ptr_hi
  adc sw_tmp6
  sta <ptr_hi                   ; ptr_lo/ptr_hi = idx*4 + idx*2 = idx*6
  lda <ptr_lo
  clc
  adc #LOW(stream_columns)
  sta <ptr_lo
  lda <ptr_hi
  adc #HIGH(stream_columns)
  sta <ptr_hi                   ; ptr_lo/ptr_hi = &stream_columns[idx*6]
  ldy #STREAM_COL_TILESET
  lda [ptr_lo],y
  pha                            ; stashed across the RAM-mirror stores below
  ldy #STREAM_COL_FILL
  lda [ptr_lo],y
  sta sw_fill_metatile_id
  ldy #STREAM_COL_BASE_BANK
  lda [ptr_lo],y
  sta sw_base_bank
  ldy #STREAM_COL_REGIONS_PER_ROW
  lda [ptr_lo],y
  sta sw_regions_per_row
  ldy #STREAM_COL_GRID_W
  lda [ptr_lo],y
  sta sw_grid_w
  sta sw_tmp2                    ; gridW, stashed for the division below
  ldy #STREAM_COL_GRID_H
  lda [ptr_lo],y
  sta sw_grid_h
  pla
  jsr switch_chr_bank
  ; screenCol = offset % gridW, screenRow = offset / gridW (bounded: a
  ; streamed map's own screen count never exceeds 255, so the repeated
  ; subtraction below runs at most gridH-1 times, cold path only)
  lda #0
  sta sw_tmp3                    ; screenRow accumulator
sw_resolve_divloop:
  lda sw_tmp5
  cmp sw_tmp2
  bcc sw_resolve_divdone
  sec
  sbc sw_tmp2
  sta sw_tmp5
  inc sw_tmp3
  jmp sw_resolve_divloop
sw_resolve_divdone:
  ; sw_tmp5 = screenCol, sw_tmp3 = screenRow
  lda sw_tmp5
  sta win_col_screen
  lda #0
  sta win_col_local
  lda sw_tmp3
  sta win_row_screen
  lda #0
  sta win_row_local
  ; Landing scroll: the window is aligned to the entered screen's own
  ; top-left corner (no local offset), so the physical origin
  ; sw_render_window computes always lands on a whole nametable multiple --
  ; cam_x_lo/cam_y_lo are always 0, only the nametable-select bits vary,
  ; one per axis, matching sw_rw_nt_hi's own bit0=horizontal/bit1=vertical
  ; convention.
  lda sw_tmp5
  and #1
  sta sw_tmp6
  lda sw_tmp3
  and #1
  asl a
  ora sw_tmp6
  sta <cam_nt
  lda #0
  sta <cam_x_lo
  sta <cam_y_lo
  lda sw_tmp5                    ; A = screenCol
  ldx sw_tmp3                    ; X = screenRow
  jmp sw_enter_screen             ; tail call -- its own rts answers for ours
