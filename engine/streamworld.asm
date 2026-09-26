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

; SW_KB_SPEED_SUB -- phase 2 slice 5's own streamed-knockback pacing: 128 is the identical
; WHOLE_STEP-1-plus-overflow-every-other-frame shape SW_SPEED_SUB_X already uses, 1.5 px/frame
; average. Unlike SW_SPEED_SUB_Y, both knockback axes share this one rate (the accepted
; hypothesis is "16 frames at 1.5 px/frame", not an asymmetric pair) -- knockback is a bounded
; SW_KB_TIME(16)-frame/24px burst that then stops, not sustained indefinite walking, so
; SW_SPEED_SUB_Y's own margin reasoning (a sustained crossing's worst case ties the row strip's
; own vblank need at 128) does not automatically transfer; empirical containment testing across
; all four directions, phases and a boundary crossing is what actually settles it, not this
; comment.
SW_KB_SPEED_SUB = 128

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
; Fix round 2 (finding D/ruling M): a bare exec breakpoint on the target of a conditional branch
; cannot distinguish "reached because the branch fell through" from "reached because it was taken"
; without also comparing PCs by hand -- this label gives the Mesen spawn-adapter harness (test/lua/
; sw_spawn_adapter.lua.template) a direct, named point that is executed if and only if the page-
; crossing carry branch was actually taken, real evidence rather than an inferred one from timing
; alone. A label costs the cartridge nothing.
sw_adv_offset_carry:
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
; sw_terrain_or_fill_solid_type -- fix round 2, finding C: a MOVEMENT/
; collision probe's own bounds check, never sw_terrain_or_fill's fill
; passthrough. sw_fill_metatile_id is a per-map VISUAL choice (its own
; collision type is whatever the project's tileset says, open by default),
; so routing a collision probe through sw_terrain_or_fill lets an off-grid
; probe stay passable on open fill (ruling L's named "outer-edge" defect) --
; the two callers below (sw_move_probe_solid, sw_hazard_probe_cross's own
; tail) need an off-grid probe to be unconditionally solid, independent of
; fill, and to never reach sw_peek_byte's own bank switch. sw_terrain_or_
; fill itself is untouched (test/unit/streamworldresident.test.js's own
; direct-call test still exercises its documented fill behaviour) -- this
; is a second, narrower accessor sharing its bounds check, not a change to
; what sw_terrain_or_fill itself does for a caller that still wants fill.
;
; In: A=screenCol, X=screenRow, Y=offset within that screen (as
;     sw_terrain_or_fill's own callers already compute).
; Out: A = the metatile's own mt_collision type when in bounds (the real,
;     restoring read); COL_SOLID when off grid, with no bank switch
;     attempted. Clobbers X, Y (the in-bounds case, same as sw_peek_byte);
;     clobbers nothing off grid.
; ==========================================================================
sw_terrain_or_fill_solid_type:
  cmp sw_grid_w
  bcs sw_tofst_solid           ; screenCol >= gridW (or wrapped negative) -> solid
  cpx sw_grid_h
  bcs sw_tofst_solid           ; screenRow >= gridH (or wrapped negative) -> solid
  jsr sw_peek_byte
  tay
  lda mt_collision,y
  rts
sw_tofst_solid:
  lda #COL_SOLID
  rts

; ==========================================================================
; sw_move_probe_solid -- a scripted Move's leading-edge probe once it has
; crossed the CURRENT streamed screen's own edge (docs/design-streamed-
; worlds.md §7, ruling 7). probe_type/probe_solid (engine/player.asm) only
; ever answer for the current screen ([mtptr_lo],y); a probe point that has
; crossed reads through sw_terrain_or_fill instead, then applies the
; IDENTICAL mt_collision/COL_DAMAGE threshold probe_solid does -- one
; collision policy, not a second one for the seam.
;
; In: A = target screenCol, X = target screenRow, probe_x/probe_y = the
;     ALREADY-WRAPPED local pixel point on that target screen (the caller's
;     own per-direction crossing arithmetic, engine/entities.asm's
;     move_tick). mt_collision and COL_DAMAGE are both kernel-lo, reachable
;     from this resident kernel-hi routine with no bank switch -- kernel-lo
;     and kernel-hi are both always mapped, the same reason this file
;     already calls sw_adv_offset/sw_locate_current the other way.
; Out: A = 0 passable, nonzero blocked -- probe_solid's own convention.
; Clobbers X, Y (as sw_terrain_or_fill's real-read case does) and <tmp>
; (mainline scratch, the identical reuse probe_type itself makes).
;
; Gated on MOVE_ENABLED, not merely living inside this already-STREAMING_
; ENABLED-gated file: move_tick (engine/entities.asm) is this routine's only
; caller, and move_tick itself only exists when MOVE_ENABLED is on -- a
; streamed project with no live Move command must not pay kernel-hi for a
; routine nothing could ever call (phase 2 slice 3, Part D).
; ==========================================================================
  .if MOVE_ENABLED
sw_move_probe_solid:
  pha                        ; stash target screenCol
  lda <probe_y
  and #$F0
  sta <tmp
  lda <probe_x
  lsr a
  lsr a
  lsr a
  lsr a
  clc
  adc <tmp
  tay                        ; Y = offset within the target screen (0-239)
  pla                        ; A = target screenCol, restored; X (target
                              ; screenRow) was never touched above
  jsr sw_terrain_or_fill_solid_type
  cmp #COL_DAMAGE
  bcc sw_move_probe_solid_done
  lda #0
sw_move_probe_solid_done:
  cmp #0
  rts

; ==========================================================================
; sw_move_probe -- normalizes a scripted Move's own leading-edge probe point
; before dispatching it (fix round 1, finding 1): EITHER coordinate of
; (probe_x,probe_y) can leave the CURRENT streamed screen regardless of
; which axis is actually moving -- right/down's own moving axis, but also
; left/up/right/down's own PERPENDICULAR axis (old_x/old_y unchanged by the
; move, offset by the leading-edge BODY_* constant) whenever that unchanged
; coordinate already sits near its own edge. A corner needs both at once.
; This is the one place both are checked, not four copies duplicating the
; same two comparisons.
;
; In: <probe_x> = the raw candidate probe x, already 8-bit-wrapped by the
;     caller's own `adc #BODY_L/R` the same way the screen's own 256px width
;     wraps; <probe_y> = the raw candidate probe y (0-254, never wraps -- a
;     screen is 240px tall, well under 256, so no information is lost the
;     way an 8-bit x wrap would lose it). Y = 1 if the caller's own add that
;     produced probe_x carried past 255 (screenCol+1), 0 otherwise --
;     captured by the caller immediately after that add (`lda #0 / adc #0 /
;     tay`), before this jsr, since the 8-bit wraparound itself throws the
;     carry away and move_get_x/move_get_y (the caller's own next steps)
;     touch only A and X, never Y, so it survives untouched.
; Out: A = 0 passable, nonzero blocked (probe_solid's own convention), Z set
;     to match. <probe_y> is normalized in place (-240) when it crossed;
;     <probe_x>'s own wrapped value already IS the correct local x on the
;     neighbour screen, needing no further adjustment.
; Clobbers A, X, Y, <tmp> (sw_move_probe_solid's own reuse, the one path
; that reaches it); sw_col/sw_row are read, never written.
;
; Phase 2 slice "landing": this used to add dx/dy to win_col_screen/win_row_
; screen (the camera window's own origin) instead of sw_col/sw_row (the
; player's own current screen) -- flagged, not fixed, by phase 2 slice 4b's
; own progress notes as a latent quirk masked only because a landing back
; then always pinned win_col_screen/win_row_screen to the entered screen
; itself. This fix's own sw_camera_window_install ends that coincidence --
; a landing's window is now the real, player-centred, clamped origin, which
; a corner (or any edge) landing puts a whole screen away from sw_col/sw_row
; -- so a scripted Move issued before the first real crossing could resolve
; its leading-edge probe against the WRONG neighbour screen, letting an
; off-grid crossing read real (passable) terrain instead of being refused
; outright. sw_hazard_probe_type (below) already uses sw_col/sw_row for the
; identical reason its own header gives; this brings sw_move_probe in line
; with it rather than leaving two probes disagreeing on which screen is
; "current".
; ==========================================================================
sw_move_probe:
  tya
  pha                         ; stash dx (Y) across the y-crossing check below
  lda <probe_y
  cmp #240
  bcc sw_move_probe_no_dy
  sec
  sbc #240
  sta <probe_y
  ldy #1
  jmp sw_move_probe_have_dy
sw_move_probe_no_dy:
  ldy #0
sw_move_probe_have_dy:
  pla                         ; A = dx, Z set from it
  bne sw_move_probe_cross
  cpy #0
  beq sw_move_probe_same
sw_move_probe_cross:
  ; A = dx, Y = dy here (dx=0 falls through from the cpy/beq above with A
  ; still holding the 0 pla just set).
  clc
  adc sw_col                  ; A = target screenCol
  pha
  tya
  clc
  adc sw_row                  ; A = target screenRow
  tax
  pla
  jsr sw_move_probe_solid
  rts
sw_move_probe_same:
  jmp probe_solid
  .endif

; ==========================================================================
; sw_hazard_probe_type -- engine/combat.asm's player_hazard, straddling case
; (phase 2 slice 4b, orchestrator ruling 9). docs/design-streamed-worlds.md
; §6's "natural ownership rectangle" lets a SCRIPTED player Move reach x up
; to 255 / y up to 239 -- wider than held movement's own MAX_X/MAX_Y wall --
; so player_hazard's own player_x+8/player_y+12 probe point can genuinely
; land past the current streamed screen's own edge, the one case this
; engine's "actor policy, current screen only" contract rule does not cover
; (an entity itself never reaches this: entity_contact's own
; entity_touching_player never leaves the entity's spawn screen).
;
; Same dx/dy normalization shape as sw_move_probe (above), against sw_col/
; sw_row: sw_col/sw_row is the player's own CURRENT screen, the identity
; sw_locate_current/sw_enter_screen are built around and sw_cross_left/
; right/up/down keep live every frame. win_col_screen/win_row_screen is the
; camera WINDOW's own origin instead -- slice 4b's own sw_win_col_inc/dec
; (above) deliberately step it at most one block a frame, up to a whole
; screen's own lag behind sw_col/sw_row while the window arms, and phase 2
; slice "landing" made a landing's own window generally differ from the
; entered screen too -- reusing that tracker here would misresolve the
; target screen. (sw_move_probe used win_col_screen/win_row_screen until
; the "landing" fix exposed the same misresolution there; both probes now
; agree on sw_col/sw_row as "current screen".)
;
; Unlike sw_move_probe_solid, this does not collapse the result to a solid/
; passable boolean -- player_hazard needs the RAW mt_collision type (an
; exact COL_DAMAGE match, probe_type's own convention), a distinction a
; wall and a damage tile would otherwise lose. Kept as its own routine
; rather than a shared refactor of sw_move_probe_solid, matching this
; file's own established precedent (sw_peek_byte's header) of keeping
; separate bank-safe read contracts as separate named routines.
;
; In: <probe_x> = the raw candidate probe x, already 8-bit-wrapped by the
;     caller's own `adc #8`; <probe_y> = the raw candidate probe y (0-254,
;     never wraps). Y = 1 if the caller's own add that produced probe_x
;     carried past 255, 0 otherwise -- captured by the caller immediately
;     after that add, sw_move_probe's own convention.
; Out: A = the metatile's own raw collision type (probe_type's own
;     convention, not probe_solid's collapse). <probe_y> normalized in
;     place (-240) when it crossed; <probe_x>'s own wrapped value already
;     IS the correct local x on the neighbour screen.
; Clobbers A, X, Y, <tmp>. Not gated on MOVE_ENABLED: player_hazard calls
; this on every streamed screen regardless of whether the project uses Move
; at all, so it lives unconditionally in this already-STREAMING_ENABLED-
; gated file rather than sharing MOVE_ENABLED's own narrower gate.
; ==========================================================================
sw_hazard_probe_type:
  tya
  pha                         ; stash dx (Y) across the y-crossing check below
  lda <probe_y
  cmp #240
  bcc sw_hazard_probe_no_dy
  sec
  sbc #240
  sta <probe_y
  ldy #1
  jmp sw_hazard_probe_have_dy
sw_hazard_probe_no_dy:
  ldy #0
sw_hazard_probe_have_dy:
  pla                         ; A = dx, Z set from it
  bne sw_hazard_probe_cross
  cpy #0
  beq sw_hazard_probe_same
sw_hazard_probe_cross:
  ; A = dx, Y = dy here (dx=0 falls through from the cpy/beq above with A
  ; still holding the 0 pla just set).
  clc
  adc sw_col                  ; A = target screenCol
  pha
  tya
  clc
  adc sw_row                  ; A = target screenRow
  tax
  pla                         ; A = target screenCol, X = target screenRow
  pha                         ; stash target screenCol across the offset calc
  lda <probe_y
  and #$F0
  sta <tmp
  lda <probe_x
  lsr a
  lsr a
  lsr a
  lsr a
  clc
  adc <tmp
  tay                         ; Y = offset within the target screen (0-239)
  pla                         ; A = target screenCol, restored; X (target
                              ; screenRow) was never touched above
  jsr sw_terrain_or_fill_solid_type
  rts
sw_hazard_probe_same:
  jmp probe_type
sw_hazard_probe_type_end:

; ==========================================================================
; sw_hazard_probe_solid / sw_hazard_probe_solid_cross -- fix round 1,
; finding 3: probe_solid's own COL_DAMAGE collapse (open/solid/water block,
; damage/warp pass -- handled elsewhere), applied to sw_hazard_probe_type's
; straddling read instead of the current-screen-only probe_type. Two
; entries share the collapse: the top one is sw_hazard_probe_type's own
; auto-detecting entry (Y=dx, <probe_y> raw/unwrapped -- sw_pstep_left/
; right's own contract, and sw_pstep_down/up's own case-A, no-row-crossing
; probes); the _cross entry is sw_hazard_probe_type's own "cross" tail
; called directly with a CALLER-SUPPLIED dx/dy (A/Y) and an
; ALREADY-normalized <probe_x>/<probe_y> -- sw_pstep_down/up's own case B,
; where the 240 (not 256) row boundary has already been crossed by the
; step itself and re-deriving dy from a pre-wrapped <probe_y> would
; misread it as the CURRENT row instead of the neighbour's.
; ==========================================================================
sw_hazard_probe_solid:
  jsr sw_hazard_probe_type
  jmp sw_hazard_probe_solid_collapse
sw_hazard_probe_solid_cross:
  jsr sw_hazard_probe_cross
sw_hazard_probe_solid_collapse:
  cmp #COL_DAMAGE
  bcc sw_hazard_probe_solid_done
  lda #0
sw_hazard_probe_solid_done:
  cmp #0
  rts

; ==========================================================================
; sw_pstep_left/right/up/down -- fix round 1, findings 1/3/4/7: the held
; streamed movement driver's own per-axis step, replacing the ordinary
; move_left/right/up/down + cross_*_go pair sw_up_do_x/y and
; sw_knockback_step used to reach. Crosses at the true 256 (X) / 240 (Y)
; ownership boundary carrying the signed overshoot (contract §6), never the
; ordinary MAX_X=240/MAX_Y=224 containment cut sw_pstep's own callers no
; longer reach through. A crossing commit does the FULL contract §5 work in
; the crossing frame, same-routine: sw_cross_*'s own O(1) bookkeeping (which
; now also updates <flat_screen> -- finding 4, see sw_cross_right/left/up/
; down below) and sw_locate_current re-point identity/bank; spawn_entities
; repopulates the incoming screen's actors and arms its entry event (finding
; 1); screen_fresh=1 stops the frame for the transition exactly as an
; ordinary crossing's own redraw_screen path does (engine/player.asm's own
; update_player_vertical/update_player_anim checks, boot.asm:245-247's
; update_entities gate) -- sw_update_player's own restructured tail (below)
; is what actually enforces the stop; setting the flag here is what lets it.
;
; X (left/right): candidate = player_x +/- cur_speed via plain 8-bit
; adc/sbc -- 256 is a power of two, so the wrap IS the crossing test, no
; explicit compare needed (the codebase's own established carry/borrow
; convention, entities.asm's move_tick). Y (up/down): 240 is not a power of
; two, so the crossing test is an explicit cmp #240/#0 the way
; sw_hazard_probe_type's own header already documents.
;
; Each body-corner probe re-derives <probe_x>/<probe_y> and its own dx/dy
; fresh: a resting position near the 256/240 edge (legally reachable via the
; wide 0-255/0-239 ownership rectangle, docs/design-streamed-worlds.md §6 --
; wider than the MAX_X/MAX_Y wall a scripted Move's sw_move_probe/
; sw_move_probe_solid still use) plus a small BODY_* offset can overflow a
; SECOND time on top of the step's own crossing; the two carries are summed
; (`lda sw_tmp2 / adc #0`), not assumed independent, so a probe corner that
; reaches a screen the step itself has not yet reached still resolves
; against the right neighbour.
;
; Fix round 1 (post-review, second pass): sw_tmp/sw_tmp2/sw_tmp3 cannot be
; trusted to survive a `jsr sw_hazard_probe_solid`/`_cross` call. A
; straddling probe that lands on a real (in-bounds) neighbour screen reaches
; sw_terrain_or_fill's non-fill path, which is sw_peek_byte, which is
; sw_goto -- and sw_goto's own header (above) says outright: "Clobbers A, X,
; Y, sw_tmp..sw_tmp6." Every probe below the FIRST one in each direction
; therefore recomputes its candidate through a small per-axis `sw_p*_calc*`
; helper (reading only player_x/player_y/cur_speed/sw_row, none of which
; sw_goto touches) rather than re-reading sw_tmp left over from before the
; jsr; the final commit (`sta player_x`/`sta player_y`) recomputes once more
; for the same reason, after the SECOND probe's own jsr. The first probe in
; each direction still reads the top-of-routine computation directly, since
; nothing has jsr'd yet at that point. A candidate is fully determined by
; player_x/player_y/cur_speed alone, which never change mid-routine, so a
; recompute always reproduces the exact same value -- this is not a second,
; independent calculation that could disagree with the first.
;
; Refuses outright (leaves player_x/y and every crossed/committed field
; untouched) when blocked by collision or when the grid has no neighbour in
; that direction -- ruling C: "grid edges stay walls," the physical ring's
; torus is not permission to wrap the authored map, mirrored from
; cross_right_go/cross_left_go/cross_up_go/cross_down_go's own now-removed
; boundary checks (engine/player.asm).
; ==========================================================================
; Every collision-blocked exit below is a bare `rts` reached through an
; inline `beq continue / rts`, never a shared far label: several of these
; checks are well past a plain branch's +/-128 byte reach from their own
; probe (the codebase's own established trap -- CLAUDE.md, "branches are
; +/-128 bytes; long dispatch chains need jmp"), and jmp costs one more byte
; than the branch it would replace at every one of these sites, where an
; inline rts costs nothing extra (the byte a shared label's own rts would
; have cost anyway, just moved next to the check instead of shared).
sw_pr_calc:
  lda <player_x
  clc
  adc <cur_speed
  sta sw_tmp
  lda #0
  adc #0
  sta sw_tmp2                    ; step's own dx: 0 or 1
  rts

sw_pstep_right:
  lda #DIR_RIGHT
  sta <player_dir
  jsr sw_pr_calc
  lda sw_tmp2
  beq sw_pr_gok
  lda sw_col
  clc
  adc #1
  cmp sw_grid_w
  bcc sw_pr_gok
  rts
sw_pr_gok:
  lda sw_tmp
  clc
  adc #BODY_R
  sta <probe_x
  lda sw_tmp2
  adc #0
  tay
  lda <player_y
  clc
  adc #BODY_T
  sta <probe_y
  jsr sw_hazard_probe_solid
  beq sw_pr_c1
  rts
sw_pr_c1:
  jsr sw_pr_calc                 ; the probe above may have reached sw_goto
  lda sw_tmp
  clc
  adc #BODY_R
  sta <probe_x
  lda sw_tmp2
  adc #0
  tay
  lda <player_y
  clc
  adc #BODY_B
  sta <probe_y
  jsr sw_hazard_probe_solid
  beq sw_pr_c2
  rts
sw_pr_c2:
  jsr sw_pr_calc                 ; likewise after the second probe
  lda sw_tmp
  sta <player_x
  inc <moving
  lda sw_tmp2
  beq sw_pr_done
  jsr sw_cross_right
  jsr sw_locate_current
  jsr spawn_entities
  lda #1
  sta <screen_fresh
sw_pr_done:
  rts

sw_pl_calc:
  lda <player_x
  sec
  sbc <cur_speed
  sta sw_tmp
  lda #0
  sbc #0
  sta sw_tmp2                    ; step's own dx: 0 or $FF(-1)
  rts

sw_pstep_left:
  lda #DIR_LEFT
  sta <player_dir
  jsr sw_pl_calc
  lda sw_tmp2
  beq sw_pl_gok
  lda sw_col
  bne sw_pl_gok
  rts
sw_pl_gok:
  lda sw_tmp
  clc
  adc #BODY_L
  sta <probe_x
  lda sw_tmp2
  adc #0
  tay
  lda <player_y
  clc
  adc #BODY_T
  sta <probe_y
  jsr sw_hazard_probe_solid
  beq sw_pl_c1
  rts
sw_pl_c1:
  jsr sw_pl_calc
  lda sw_tmp
  clc
  adc #BODY_L
  sta <probe_x
  lda sw_tmp2
  adc #0
  tay
  lda <player_y
  clc
  adc #BODY_B
  sta <probe_y
  jsr sw_hazard_probe_solid
  beq sw_pl_c2
  rts
sw_pl_c2:
  jsr sw_pl_calc
  lda sw_tmp
  sta <player_x
  inc <moving
  lda sw_tmp2
  beq sw_pl_done
  jsr sw_cross_left
  jsr sw_locate_current
  jsr spawn_entities
  lda #1
  sta <screen_fresh
sw_pl_done:
  rts

sw_pd_calc_a:
  lda <player_y
  clc
  adc <cur_speed
  sta sw_tmp                     ; raw candidate y, unwrapped (<=~241)
  rts

sw_pd_calc_b:
  lda <player_y
  clc
  adc <cur_speed                 ; guaranteed >=240 whenever this is called
  sec
  sbc #240
  sta sw_tmp                     ; wrapped local y on the row below (small)
  rts

sw_pstep_down:
  lda #DIR_DOWN
  sta <player_dir
  jsr sw_pd_calc_a
  lda sw_tmp
  cmp #240
  bcs sw_pd_cross
  lda <player_x
  clc
  adc #BODY_L
  sta <probe_x
  lda #0
  adc #0
  tay
  lda sw_tmp
  clc
  adc #BODY_B
  sta <probe_y
  jsr sw_hazard_probe_solid
  beq sw_pd_c1
  rts
sw_pd_c1:
  jsr sw_pd_calc_a               ; the probe above may have reached sw_goto
  lda <player_x
  clc
  adc #BODY_R
  sta <probe_x
  lda #0
  adc #0
  tay
  lda sw_tmp
  clc
  adc #BODY_B
  sta <probe_y
  jsr sw_hazard_probe_solid
  beq sw_pd_c2
  rts
sw_pd_c2:
  jsr sw_pd_calc_a               ; likewise after the second probe
  lda sw_tmp
  sta <player_y
  inc <moving
  rts
sw_pd_cross:
  lda sw_row
  clc
  adc #1
  cmp sw_grid_h
  bcc sw_pd_cok
  rts
sw_pd_cok:
  jsr sw_pd_calc_b
  lda <player_x
  clc
  adc #BODY_L
  sta <probe_x
  lda #0
  adc #0
  sta sw_tmp3
  lda sw_tmp
  clc
  adc #BODY_B
  sta <probe_y
  ldy #1
  lda sw_tmp3
  jsr sw_hazard_probe_solid_cross
  beq sw_pd_c3
  rts
sw_pd_c3:
  jsr sw_pd_calc_b                ; the probe above may have reached sw_goto
  lda <player_x
  clc
  adc #BODY_R
  sta <probe_x
  lda #0
  adc #0
  sta sw_tmp3
  lda sw_tmp
  clc
  adc #BODY_B
  sta <probe_y
  ldy #1
  lda sw_tmp3
  jsr sw_hazard_probe_solid_cross
  beq sw_pd_c4
  rts
sw_pd_c4:
  jsr sw_pd_calc_b                ; likewise after the second probe
  lda sw_tmp
  sta <player_y
  inc <moving
  jsr sw_cross_down
  jsr sw_locate_current
  jsr spawn_entities
  lda #1
  sta <screen_fresh
  rts

sw_pu_calc_noborrow:
  lda <player_y
  sec
  sbc <cur_speed
  sta sw_tmp                     ; raw candidate y, no borrow (guaranteed)
  rts

sw_pu_calc_b:
  lda <player_y
  sec
  sbc <cur_speed                 ; guaranteed to borrow whenever this is called
  sec
  sbc #16                        ; 256-240: the byte wrap's own excess
  sta sw_tmp                     ; wrapped local y on the row above (small)
  rts

sw_pstep_up:
  lda #DIR_UP
  sta <player_dir
  lda <player_y
  sec
  sbc <cur_speed
  sta sw_tmp                     ; raw candidate y, 8-bit-wrapped if borrowed
  bcc sw_pu_borrowed              ; carry clear = borrow = crossing
; fix round 2 (findings A/B growth pushed sw_pu_noborrow past a plain
; branch's +/-128 byte reach -- CLAUDE.md's own established trap, "branches
; are +/-128 bytes; long dispatch chains need jmp").
  jmp sw_pu_noborrow              ; carry set = no borrow = no crossing (far)
sw_pu_borrowed:
  lda sw_row
  bne sw_pu_gok
  rts
sw_pu_gok:
  jsr sw_pu_calc_b
  lda <player_x
  clc
  adc #BODY_L
  sta <probe_x
  lda #0
  adc #0
  sta sw_tmp3
  lda sw_tmp
  clc
  adc #BODY_T
; fix round 2, finding B (ruling K): sw_tmp is already normalized into the
; TARGET (crossing) row's own 0-239 local frame by sw_pu_calc_b, so adding
; the body offset here can push a SECOND time past 240 -- not into a further
; row above, but back down past the row boundary this step just crossed,
; into the ORIGINAL row's own low y (the body straddles the seam). Passing
; that un-renormalized sum straight to the _cross accessor's own already-
; normalized-probe contract misreads it as row -1's own out-of-range offset,
; which lands on that row's post-terrain metadata (an entity count, etc.)
; instead of real terrain. Renormalize here, adjusting dy from -1 (the
; target row) to 0 (the ORIGINAL row, dy relative to sw_row/sw_col -- this
; step's own crossing is what made -1 the target in the first place) exactly
; when the sum reaches back into it.
  cmp #240
  bcs sw_pu_p1_carry
  sta <probe_y
  ldy #$FF
  jmp sw_pu_p1_go
sw_pu_p1_carry:
  sec
  sbc #240
  sta <probe_y
  ldy #0
sw_pu_p1_go:
  lda sw_tmp3
  jsr sw_hazard_probe_solid_cross
  beq sw_pu_c1
  rts
sw_pu_c1:
  jsr sw_pu_calc_b                ; the probe above may have reached sw_goto
  lda <player_x
  clc
  adc #BODY_R
  sta <probe_x
  lda #0
  adc #0
  sta sw_tmp3
  lda sw_tmp
  clc
  adc #BODY_T
; same renormalization as the first probe above, and the same BODY_T (not
; BODY_B) as the first probe -- fix round 2, finding A (ruling J): a
; vertical move's two probes share ONE leading-edge Y offset (BODY_T for
; Up, BODY_B for Down) and vary only X (BODY_L then BODY_R), the same shape
; move_vertical_probe (engine/player.asm) already uses; this probe used
; BODY_B before the fix, checking the trailing (not leading) edge and
; leaving the true leading corner unchecked.
  cmp #240
  bcs sw_pu_p2_carry
  sta <probe_y
  ldy #$FF
  jmp sw_pu_p2_go
sw_pu_p2_carry:
  sec
  sbc #240
  sta <probe_y
  ldy #0
sw_pu_p2_go:
  lda sw_tmp3
  jsr sw_hazard_probe_solid_cross
  beq sw_pu_c2
  rts
sw_pu_c2:
  jsr sw_pu_calc_b                ; likewise after the second probe
  lda sw_tmp
  sta <player_y
  inc <moving
  jsr sw_cross_up
  jsr sw_locate_current
  jsr spawn_entities
  lda #1
  sta <screen_fresh
  rts
sw_pu_noborrow:
  lda <player_x
  clc
  adc #BODY_L
  sta <probe_x
  lda #0
  adc #0
  tay
  lda sw_tmp
  clc
  adc #BODY_T
  sta <probe_y
  jsr sw_hazard_probe_solid
  beq sw_pu_c3
  rts
sw_pu_c3:
  jsr sw_pu_calc_noborrow         ; the probe above may have reached sw_goto
  lda <player_x
  clc
  adc #BODY_R
  sta <probe_x
  lda #0
  adc #0
  tay
  lda sw_tmp
  clc
  adc #BODY_T
  sta <probe_y
  jsr sw_hazard_probe_solid
  beq sw_pu_c4
  rts
sw_pu_c4:
  jsr sw_pu_calc_noborrow         ; likewise after the second probe
  lda sw_tmp
  sta <player_y
  inc <moving
  rts
sw_pstep_end:

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
; sw_oam_rowbase -- phase 2 slice 4a. row*240 (16-bit), for the Y half of a
; tile's own world position (a screen is 240 px tall, not a power of two,
; so unlike X -- world_x_hi is exactly sw_col/the tile's own carried screen
; column, no arithmetic at all -- Y genuinely needs a multiply). row*240 =
; row*256 - row*16: row*256 as a 16-bit pair is simply {hi=row, lo=0}, so
; only row*16 needs computing, via 4 left shifts.
;
; Recomputed at every Y-axis OAM projection call (ruling 2/docs/reference-
; kernel-budget.md) rather than cached across a whole OAM-build pass: the
; only zero-page byte sw_project_axis's own clobber list (sw_tmp..sw_tmp4,
; sw_tmp6) leaves free is sw_tmp5, one byte short of a 16-bit cache, and
; every other RAM run near it ($C7-$FD zero page, $07F0-$07F8) is already
; named for slices 7b-9 -- claiming either would collide with a real future
; slice rather than reuse genuinely idle space. The shift-subtract itself
; is mainline-only (never NMI) and cheap (~30 cycles), so recomputing it a
; handful of times a frame (2 for the player's own top/bottom rows, one per
; projected entity) costs far less than a new persistent byte would.
;
; In: A = absolute screen row (0-254). Out: sw_tmp/sw_tmp2 = row*240 lo/hi.
; Clobbers A, X, sw_tmp, sw_tmp2.
; ==========================================================================
sw_oam_rowbase:
  pha                          ; the original row, needed again after the
                                ; shift below overwrites sw_tmp with row*16
  sta sw_tmp
  lda #0
  sta sw_tmp2
  ldx #4
sw_oam_rowbase_shift:
  asl sw_tmp
  rol sw_tmp2
  dex
  bne sw_oam_rowbase_shift
  ; sw_tmp/sw_tmp2 = row*16
  lda #0
  sec
  sbc sw_tmp
  sta sw_tmp
  pla                          ; original row back
  sbc sw_tmp2
  sta sw_tmp2
  rts

; ==========================================================================
; sw_oam_project_x -- phase 2 slice 4a. Projects one tile's own X position
; (docs/design-streamed-worlds.md §7): world_x_lo is the tile's own local X
; (already offset and wrapped by the caller, mod 256 -- a screen is exactly
; 256 px wide, so no multiply is ever needed for this axis), world_x_hi is
; sw_col plus whatever carry the caller's own offset-add produced (crossing
; into the next screen column). No -1 convention on this axis (that belongs
; to Y alone, sw_oam_project_y below).
;
; In: A = local X lo (post-offset, wrapped). Carry = 1 if the caller's own
;     offset-add overflowed past 255 (the tile crossed into sw_col+1), 0
;     otherwise -- the caller must set this explicitly (CLC for no offset,
;     or the real ADC's own carry-out), never rely on incoming flags.
; Out: A = the OAM X byte. Carry SET means hidden (sw_project_axis's own
;     convention, passed straight through).
; Clobbers A, sw_tmp..sw_tmp4, sw_tmp6 (sw_project_axis's own clobber set).
; ==========================================================================
sw_oam_project_x:
  sta sw_tmp                  ; world_x lo
  lda #0
  adc #0                       ; the caller's own offset-add carry -> 0 or 1
  clc
  adc sw_col
  jmp sw_oam_project_x_core     ; A = world_x hi = sw_col + carry

; ==========================================================================
; sw_oam_project_tile_x -- phase 2 slice 4a fix round 1 (reviewer finding
; 2). The general SIGNED-offset counterpart of sw_oam_project_x above, for
; one tile of an entity's own metasprite: docs/design-streamed-worlds.md's
; metasprite offsets are legal across the full -128..127 range
; (shared/project.js), not just the player's fixed non-negative +0/+8
; corner offsets, so a tile can cross a screen boundary EITHER direction.
; sw_oam_project_x's own "carry=1 means +1 screen" convention (a single
; bit) can only express a forward crossing -- correct for the player, but
; not general enough here. Standard 16-bit signed-add technique instead:
; sign-extend the offset (0 if >=0, $FF if <0) and add THAT (with the low
; byte's own real carry) to sw_col, rather than adding a bare 1-bit carry.
;
; In: A = signed x-offset byte (straight from the metasprite data, not
;     pre-added by the caller -- unlike sw_oam_project_x above). <de_ex> =
;     the entity's own base LOCAL x (unprojected, stashed by the caller
;     once before its tile loop began, docs/reference-engine.md).
; Out/clobbers: identical to sw_oam_project_x, plus X (used as scratch to
;     hold the offset's own sign across the low-byte add).
; ==========================================================================
sw_oam_project_tile_x:
  tax                          ; stash the offset -- its own sign decides the
                                ; branch below, once the low-byte carry it
                                ; also needs to produce is captured into A
  clc
  adc <de_ex
  sta sw_tmp                   ; world_x lo (wrapped)
  lda #0
  adc #0                        ; raw unsigned add-carry -> 0 or 1
  cpx #0                         ; offset's own sign (CPX unavoidably clobbers
                                  ; Carry too, which is why it runs only AFTER
                                  ; the carry above was already captured into A)
  bpl sw_oam_project_tile_x_ext  ; offset >= 0: screenColDelta IS that raw carry
  sec
  sbc #1                          ; offset < 0: screenColDelta = carry-1
                                    ; (raw carry 1 -> 0, raw carry 0 -> $FF/-1)
sw_oam_project_tile_x_ext:
  clc
  adc sw_col
sw_oam_project_x_core:
  sta sw_tmp2                  ; world_x hi
  lda sw_cam_origin_x_lo
  sta sw_tmp3
  lda sw_cam_origin_x_hi
  sta sw_tmp4
  lda #0                       ; visibleWidth = 256 (sw_project_axis's own
                                ; 0 sentinel)
  jmp sw_project_axis           ; tail call -- its own rts answers for ours

; ==========================================================================
; sw_oam_project_y -- phase 2 slice 4a. The Y-axis counterpart of
; sw_oam_project_x above, with the one-scanline-early OAM convention
; applied ONCE here (design §7: "a Y-axis caller subtracts 1 from the
; returned byte before writing OAM") rather than by each of this routine's
; own callers -- every caller of this routine IS a Y-axis caller, so there
; is no second copy of that subtract anywhere. A hidden tile returns $FF
; (the same park sentinel build_oam_park/draw_entities_park already use)
; rather than a raw, meaningless byte.
;
; In: A = local Y lo (post-offset, wrapped). Carry = 1 if the caller's own
;     offset-add overflowed past 255 (the tile crossed into sw_row+1), 0
;     otherwise -- set explicitly by the caller, same contract as the X
;     routine above.
; Out: A = the OAM Y byte (already -1'd if visible, or $FF if hidden).
;     Carry SET means hidden (matches sw_project_axis's own convention).
; Clobbers A, X, sw_tmp..sw_tmp4, sw_tmp6 (sw_oam_rowbase's own clobber set
; plus sw_project_axis's own).
; ==========================================================================
sw_oam_project_y:
  sta sw_tmp6                  ; local Y lo, stashed -- sw_oam_rowbase below
                                ; never touches sw_tmp6
  lda #0
  adc #0                        ; the caller's own offset-add carry -> 0 or 1
  clc
  adc sw_row
  jsr sw_oam_rowbase             ; A = the tile's own absolute row; out
                                 ; sw_tmp/sw_tmp2 = that row*240
  lda sw_tmp
  clc
  adc sw_tmp6                    ; += local Y lo (0-255; may itself carry)
  sta sw_tmp
  lda sw_tmp2
  adc #0
  sta sw_tmp2                    ; sw_tmp/sw_tmp2 = world_y lo/hi
  jmp sw_oam_project_worldy_core

; ==========================================================================
; sw_oam_project_tile_y -- phase 2 slice 4a fix round 1 (reviewer finding
; 2). The sw_oam_project_tile_x counterpart for Y, same "a metasprite
; offset is signed across the full -128..127 range" reasoning -- but Y
; cannot reuse the same "sign-extend a 1-bit carry into sw_row" shortcut
; sw_oam_project_tile_x uses for X: sw_oam_rowbase computes row*240 by
; MULTIPLYING whatever absolute-row byte it is given, and multiplication
; does not preserve two's-complement wraparound the way addition does -- if
; sw_row is 0 and a tile's own offset crosses one row backward, feeding
; sw_oam_rowbase a wrapped $FF (meant to mean "row -1") would compute the
; UNSIGNED product for row 255, not the signed product for row -1, and
; those differ by far more than a rounding error. So here the REAL row
; (sw_row, always a genuine 0-254 screen) is multiplied exactly ONCE, by
; the caller, before any tile's own offset is considered; every per-tile
; signed Y offset is folded in afterward by pure 16-bit addition instead,
; which -- unlike multiplication -- stays consistent under wraparound
; regardless of how far net-negative the running total gets.
;
; In: A = signed y-offset byte (straight from the metasprite data). <de_ey>
;     = the entity's own base LOCAL y. <tmp>/<tmp2> = rowBase16 (sw_row*240
;     lo/hi), precomputed ONCE by the caller via sw_oam_rowbase before its
;     tile loop began (docs/reference-engine.md).
; Out/clobbers: identical to sw_oam_project_y.
; ==========================================================================
sw_oam_project_tile_y:
  tax                            ; stash the offset -- its own sign decides
                                  ; the high-byte extension below, computed
                                  ; FIRST so nothing after it needs to survive
                                  ; a compare's own carry-clobber
  cpx #0
  bmi sw_oam_project_tile_y_neg
  lda #0
  jmp sw_oam_project_tile_y_sext
sw_oam_project_tile_y_neg:
  lda #$FF
sw_oam_project_tile_y_sext:
  sta sw_tmp6                    ; the offset's own sign, extended to a full
                                  ; byte ($00 or $FF) -- this file's one spare
                                  ; scratch byte between calls (see sw_oam_
                                  ; project_x_core's own header)

  lda <tmp
  clc
  adc <de_ey
  sta sw_tmp
  lda <tmp2
  adc #0                          ; local Y's own high byte is always 0
  sta sw_tmp2                     ; sw_tmp/sw_tmp2 = rowBase16 + localY

  txa
  clc
  adc sw_tmp
  sta sw_tmp                      ; world_y lo, final
  lda sw_tmp6
  adc sw_tmp2                      ; sign-extended offset hi + the low add's
                                     ; own carry (live: nothing between the
                                     ; two ADCs above touches it)
  sta sw_tmp2                       ; world_y hi, final
  jmp sw_oam_project_worldy_core

; The shared tail sw_oam_project_y/sw_oam_project_tile_y both reach once
; their own world_y16 (sw_tmp/sw_tmp2) is ready: subtract the camera origin,
; test visibility, apply the one-scanline-early OAM convention.
sw_oam_project_worldy_core:
  lda sw_cam_origin_y_lo
  sta sw_tmp3
  lda sw_cam_origin_y_hi
  sta sw_tmp4
  lda #240                        ; visibleWidth = 240 (Y's real bound)
  jsr sw_project_axis
  bcs sw_oam_project_y_hidden
  sec
  sbc #1                          ; the one-scanline-early convention
  clc                              ; report "visible"
  rts
sw_oam_project_y_hidden:
  lda #$FF
  sec                              ; report "hidden"
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
  inc <flat_screen              ; fix round 1, finding 4: the global id moves
                                 ; with the ownership commit, not only the
                                 ; streamed sw_col/sw_row bookkeeping -- a
                                 ; crossing never leaves the grid it started
                                 ; in (grid edges are walls, ruling C), so
                                 ; this is always a plain +/-1 (a column
                                 ; step) or +/- sw_grid_w (a row step,
                                 ; below), never a mixed-map prefix delta.
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
  dec <flat_screen               ; finding 4 -- see sw_cross_right's own note
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
  lda <flat_screen               ; finding 4 -- a row step is +/- sw_grid_w,
  clc                            ; the CURRENT map's own width (never a
  adc sw_grid_w                  ; mixed-map prefix: a crossing never leaves
  sta <flat_screen                ; the map it started in)
  lda sw_row_bank_base
  clc
  adc sw_regions_per_row
  sta sw_row_bank_base
  rts

sw_cross_up:
  dec sw_row
  lda <flat_screen
  sec
  sbc sw_grid_w
  sta <flat_screen
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
; vblank that must share its budget with another producer. Called from
; boot.asm's own NMI arbitration splice since phase 2 slice 4a
; (MIXED_VBLANK_MAX_BYTES) -- reachable in principle since then, but nothing
; could arm a strip for it to drain until phase 2 slice 4b's movement driver
; lifted Part C's wall, so this is that slice's first real exercise.
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
;   win_col_screen/row+local already hold the real clamped, player-centred
;   window sw_camera_window_install computes (phase 2 slice "landing" --
;   sw_resolve_divdone, below -- not the entered screen's own top-left
;   corner, and in general NOT zero-local on either axis), cam_nt/cam_x_lo/
;   cam_y_lo already hold that origin's own landing scroll, sw_cam_origin_x_lo/hi
;   and sw_cam_origin_y_lo/hi already hold that SAME origin in world-space
;   (screenCol*256, screenRow*240 -- phase 2 slice 4a, ruling 1: this is
;   the origin's first production writer; slice 4b's movement driver
;   becomes its CONTINUOUS per-frame writer), cur_map/music already
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
  ;
  ; Landing window (phase 2 slice "landing", fixing the defect fix round 2's
  ; review found: a top-left-aligned landing window/scroll left the visible
  ; rect outside completed content for ~70 frames until sw_frame_camera_
  ; window's own per-frame tracking caught up -- docs/reference-engine.md).
  ; sw_enter_screen must run FIRST: it is the single writer of sw_col/sw_row
  ; (this screen's own grid position), and sw_camera_window_install's own
  ; recompute reads those two bytes to build worldX/worldY, the identical
  ; formula sw_frame_camera_window's per-frame tracking uses. player_x/
  ; player_y are already the landing position -- every one of the 5 landing
  ; sites (cold boot, start_game, restart_game, take_door, continue_game)
  ; sets them before ever reaching sw_resolve_screen (docs/reference-
  ; engine.md's own "5 landing sites" paragraph) -- so this is the SAME
  ; clamped, player-centred camera/window computation tracking will make on
  ; its very next frame, installed now instead of only published a few
  ; frames later: single writer, sw_camera_window_recompute, below.
  lda sw_tmp5                    ; A = screenCol
  ldx sw_tmp3                    ; X = screenRow
  jsr sw_enter_screen
  jmp sw_camera_window_install    ; tail call -- its own rts answers for ours

; ==========================================================================
; Phase 2 slice 4b -- the movement driver's own per-frame camera-feed and
; window arm decision. Everything below is new; nothing in this file
; consumed sw_cam_origin_x/y_lo/hi before this slice (grep confirms), so
; this is the first real writer of the whole per-frame camera-to-PPU
; publish path, not merely an update to something else already reads.
;
; Called once a frame from engine/player.asm's streamed update_player
; branch, after any movement/knockback for the frame has already landed in
; player_x/player_y/sw_col/sw_row. Always runs, whether or not the player
; actually moved this frame -- cheap when nothing changed (the arm decision
; below finds desired==current and does nothing), and camera-follow must
; keep working through a capped knockback too.
; ==========================================================================

; sw_win_col_inc/dec, sw_win_row_inc/dec -- step the window's own persistent
; "current" origin by exactly one block, wrapping local mod 16 (col) or mod
; 15 (row) with a carry into screen. In/out: win_col_screen/win_col_local or
; win_row_screen/win_row_local, in place. Clobbers A.
sw_win_col_inc:
  inc win_col_local
  lda win_col_local
  cmp #16
  bne sw_win_col_inc_done
  lda #0
  sta win_col_local
  inc win_col_screen
sw_win_col_inc_done:
  rts

sw_win_col_dec:
  lda win_col_local
  bne sw_win_col_dec_simple
  lda #15
  sta win_col_local
  dec win_col_screen
  rts
sw_win_col_dec_simple:
  dec win_col_local
  rts

sw_win_row_inc:
  inc win_row_local
  lda win_row_local
  cmp #15
  bne sw_win_row_inc_done
  lda #0
  sta win_row_local
  inc win_row_screen
sw_win_row_inc_done:
  rts

sw_win_row_dec:
  lda win_row_local
  bne sw_win_row_dec_simple
  lda #14
  sta win_row_local
  dec win_row_screen
  rts
sw_win_row_dec_simple:
  dec win_row_local
  rts

; sw_win_entering_col_right / sw_win_entering_row_down -- the far (leading)
; edge of the 32-block-wide (30-block-tall) window, computed from its own
; just-stepped "current" (near) edge: entering = current + 31 blocks (col)
; or +29 blocks (row) = current's own local+15 (col) or +14 (row), carrying
; 1 screen if that stays under 16/15, or 2 screens (subtracting 16/15) if it
; doesn't -- worked out and verified against two hand examples per axis,
; docs/design-streamed-worlds.md's own "torus and window" section.
; In: win_col_screen/win_col_local (or the row pair), already stepped.
; Out: A=screenCol/screenRow, X=localCol/localRow of the entering edge, the
; exact operand sw_stream_start_col/row expects. Clobbers nothing but A/X.
sw_win_entering_col_right:
  lda win_col_local
  clc
  adc #15
  cmp #16
  bcc sw_wecr_c1
  sec
  sbc #16
  tax
  lda win_col_screen
  clc
  adc #2
  rts
sw_wecr_c1:
  tax
  lda win_col_screen
  clc
  adc #1
  rts

sw_win_entering_row_down:
  lda win_row_local
  clc
  adc #14
  cmp #15
  bcc sw_wedr_c1
  sec
  sbc #15
  tax
  lda win_row_screen
  clc
  adc #2
  rts
sw_wedr_c1:
  tax
  lda win_row_screen
  clc
  adc #1
  rts

; ==========================================================================
; sw_camera_window_recompute -- the whole per-frame sequence: derive this
; frame's clamped camera position from the player's own world pixel
; position, publish it to cam_x_lo/cam_y_lo/cam_nt under the cam_dirty
; lock (engine/camera.asm's own bracketing convention), then derive the
; desired window origin from that same clamped camera position into
; sw_fc_desc/desl/desr/desrl. Single writer of this whole computation --
; sw_frame_camera_window (below) tail-calls sw_win_arm with it every
; ordinary frame; sw_camera_window_install (below) installs its answer
; directly as the window's own "current" origin at a landing, so a landing
; renders the SAME clamped, player-centred rect tracking would otherwise
; only reach ~70 frames later (the defect sw_resolve_divdone's own comment,
; above, names).
;
; worldX is free: hi=sw_col, lo=player_x (a screen is exactly 256px, a full
; byte, so no arithmetic joins them). worldY = sw_row*240+player_y needs the
; shift-and-subtract identity sw_resolve_screen's own landing-time code
; already uses (240 = 256-16), reproduced here as this value's declared
; CONTINUOUS per-frame writer (that routine's own comment, above).
;
; The camera clamp is docs/design-streamed-worlds.md's one formula per
; axis: cameraOrigin = clamp(desiredOrigin, 0, max(mapPixels-viewportPixels,
; 0)), desiredOrigin = worldPos-centre (centre=120 X, 112 Y -- half the
; viewport less half the player's own sprite width).
;
; The X->cam_x_lo/cam_nt-bit0 step needs no window-relative subtraction at
; all: physical ring position is a pure function of (screenCol&1, localCol)
; (independent of screenCol's own higher bits -- the parity rule's whole
; point, confirmed against sw_resolve_screen's own landing values above,
; where camPx=screenCol*256 exactly and cam_x_lo/cam_nt-bit0 fall out of
; this identical formula as their degenerate case). camPx's own low byte
; already IS the local-pixel-within-screen value; camPx's bit 8 already IS
; the screenCol's own parity. Y is not power-of-two (screen height 240, not
; 256), so it needs a real camPy/240 divmod -- a bounded repeated-subtract
; loop, the same cold-path idiom sw_resolve_screen's own screenRow divmod
; already uses (never more than sw_grid_h iterations, once a frame).
;
; Out: sw_fc_desc/desl/desr/desrl = this call's own desired window origin
; (screen+local, per axis). Clobbers A, X, Y, sw_tmp..sw_tmp6, sw_fc_*.
; ==========================================================================
sw_camera_window_recompute:
  ; ---- worldY = sw_row*240 + player_y (sw_tmp/sw_tmp2 = row<<4, staged) ----
  lda sw_row
  sta sw_tmp
  lda #0
  sta sw_tmp2
  ldx #4
sw_fcw_rowshift:
  asl sw_tmp
  rol sw_tmp2
  dex
  bne sw_fcw_rowshift
  lda #0
  sec
  sbc sw_tmp
  sta sw_fc_wy_lo
  lda sw_row
  sbc sw_tmp2
  sta sw_fc_wy_hi
  lda sw_fc_wy_lo
  clc
  adc <player_y
  sta sw_fc_wy_lo
  lda sw_fc_wy_hi
  adc #0
  sta sw_fc_wy_hi

  ; ---- camPx = clamp(worldX-120, 0, (sw_grid_w-1)*256) ----
  lda <player_x
  sec
  sbc #120
  sta sw_fc_px_lo
  lda sw_col
  sbc #0
  sta sw_fc_px_hi
  bcs sw_fcw_x_nonneg
  lda #0
  sta sw_fc_px_lo
  sta sw_fc_px_hi
sw_fcw_x_nonneg:
  lda sw_grid_w
  sec
  sbc #1
  sta sw_tmp3                  ; ceiling hi (ceiling lo is always 0)
  lda sw_fc_px_hi
  cmp sw_tmp3
  bcc sw_fcw_x_clamp_done
  bne sw_fcw_x_over
  lda sw_fc_px_lo
  beq sw_fcw_x_clamp_done
sw_fcw_x_over:
  lda sw_tmp3
  sta sw_fc_px_hi
  lda #0
  sta sw_fc_px_lo
sw_fcw_x_clamp_done:

  ; ---- camPy = clamp(worldY-112, 0, (sw_grid_h-1)*240) ----
  lda sw_fc_wy_lo
  sec
  sbc #112
  sta sw_fc_py_lo
  lda sw_fc_wy_hi
  sbc #0
  sta sw_fc_py_hi
  bcs sw_fcw_y_nonneg
  lda #0
  sta sw_fc_py_lo
  sta sw_fc_py_hi
sw_fcw_y_nonneg:
  lda sw_grid_h
  sec
  sbc #1
  sta sw_tmp4                  ; gridH-1
  lda sw_tmp4
  sta sw_tmp
  lda #0
  sta sw_tmp2
  ldx #4
sw_fcw_yceil_shift:
  asl sw_tmp
  rol sw_tmp2
  dex
  bne sw_fcw_yceil_shift
  lda #0
  sec
  sbc sw_tmp
  sta sw_tmp5                  ; ceiling lo
  lda sw_tmp4
  sbc sw_tmp2
  sta sw_tmp6                  ; ceiling hi
  lda sw_fc_py_hi
  cmp sw_tmp6
  bcc sw_fcw_y_clamp_done
  bne sw_fcw_y_over
  lda sw_fc_py_lo
  cmp sw_tmp5
  bcc sw_fcw_y_clamp_done
  beq sw_fcw_y_clamp_done
sw_fcw_y_over:
  lda sw_tmp5
  sta sw_fc_py_lo
  lda sw_tmp6
  sta sw_fc_py_hi
sw_fcw_y_clamp_done:

  ; ---- publish cam_x_lo/cam_nt-bit0 (X half); cam_dirty brackets both axes ----
  inc <cam_dirty
  lda sw_fc_px_lo
  sta <cam_x_lo
  ; Fix round 1, finding 2: the full clamped world-space origin is published
  ; alongside the physical scroll, every frame, under this same cam_dirty
  ; lock -- oam.asm/entities.asm's sw_project_axis consumers (:703-705,
  ; :812-814) read sw_cam_origin_x/y_lo/hi, not cam_x_lo/cam_y_lo, so a
  ; continuous walk with only the physical scroll updated leaves every
  ; sprite projected against a stale (landing-only) origin. sw_fc_px_lo/hi
  ; is exactly this axis's own clamped world value -- ruling B: "the landing
  ; write in sw_resolve_divdone stays as the landing's own value," unchanged
  ; above; this is the value's declared CONTINUOUS writer (this routine's
  ; own header).
  sta sw_cam_origin_x_lo
  lda sw_fc_px_hi
  sta sw_cam_origin_x_hi
  and #1
  sta sw_tmp                    ; stash bit0 across the Y divmod below

  ; ---- camScreenRow = camPy/240, camLocalPxY = camPy mod 240 (destructive
  ; to sw_fc_py_lo/hi) -- sw_cam_origin_y_lo/hi is published FIRST, from the
  ; still-intact clamped value, before this loop consumes it. ----
  lda sw_fc_py_lo
  sta sw_cam_origin_y_lo
  lda sw_fc_py_hi
  sta sw_cam_origin_y_hi
  lda #0
  sta sw_fc_scr
sw_fcw_ydiv_loop:
  lda sw_fc_py_hi
  bne sw_fcw_ydiv_sub
  lda sw_fc_py_lo
  cmp #240
  bcc sw_fcw_ydiv_done
sw_fcw_ydiv_sub:
  lda sw_fc_py_lo
  sec
  sbc #240
  sta sw_fc_py_lo
  lda sw_fc_py_hi
  sbc #0
  sta sw_fc_py_hi
  inc sw_fc_scr
  jmp sw_fcw_ydiv_loop
sw_fcw_ydiv_done:
  lda sw_fc_py_lo
  sta sw_fc_lpy
  sta <cam_y_lo

  lda sw_fc_scr
  and #1
  asl a
  ora sw_tmp
  sta <cam_nt
  dec <cam_dirty

  ; ---- desired window X: camBlockX = (camPx_hi<<4) + (camPx_lo>>4);
  ; desiredBlockX = camBlockX-8, floored at 0; split by divmod 16; clamp ----
  lda sw_fc_px_hi
  sta sw_tmp
  lda #0
  sta sw_tmp2
  ldx #4
sw_fcw_blkx_shift:
  asl sw_tmp
  rol sw_tmp2
  dex
  bne sw_fcw_blkx_shift
  lda sw_fc_px_lo
  lsr a
  lsr a
  lsr a
  lsr a
  clc
  adc sw_tmp
  sta sw_tmp3                   ; camBlockX lo
  lda sw_tmp2
  adc #0
  sta sw_tmp4                   ; camBlockX hi
  lda sw_tmp3
  sec
  sbc #8
  sta sw_tmp3
  lda sw_tmp4
  sbc #0
  sta sw_tmp4
  bcs sw_fcw_blkx_nonneg
  lda #0
  sta sw_tmp3
  sta sw_tmp4
sw_fcw_blkx_nonneg:
  lda sw_tmp3
  and #15
  tax                           ; X = localCol
  lda sw_tmp3
  lsr a
  lsr a
  lsr a
  lsr a
  sta sw_tmp5
  lda sw_tmp4
  asl a
  asl a
  asl a
  asl a                         ; safe: desiredBlockX < sw_grid_w*16 <= 4080,
                                 ; so this hi byte is always <= 15
  ora sw_tmp5
  tay                           ; Y = screenCol (stashed -- X already holds
                                 ; localCol and sw_clamp_col wants A=screenCol)
  tya
  jsr sw_clamp_col
  sta sw_fc_desc
  stx sw_fc_desl

  ; ---- desired window Y: camBlockY = camScreenRow*15 + (camLocalPxY>>4);
  ; desiredBlockY = camBlockY-7, floored at 0; divmod 15 (not power-of-2 --
  ; bounded repeated-subtract, same cold-path idiom as above); clamp ----
  lda sw_fc_scr
  sta sw_tmp
  lda #0
  sta sw_tmp2
  ldx #4
sw_fcw_blky_shift:
  asl sw_tmp
  rol sw_tmp2
  dex
  bne sw_fcw_blky_shift
  lda sw_tmp
  sec
  sbc sw_fc_scr
  sta sw_tmp                    ; scr*16 - scr = scr*15, lo
  lda sw_tmp2
  sbc #0
  sta sw_tmp2                   ; scr*15 hi
  lda sw_fc_lpy
  lsr a
  lsr a
  lsr a
  lsr a
  clc
  adc sw_tmp
  sta sw_tmp3                   ; camBlockY lo
  lda sw_tmp2
  adc #0
  sta sw_tmp4                   ; camBlockY hi
  lda sw_tmp3
  sec
  sbc #7
  sta sw_tmp3
  lda sw_tmp4
  sbc #0
  sta sw_tmp4
  bcs sw_fcw_blky_nonneg
  lda #0
  sta sw_tmp3
  sta sw_tmp4
sw_fcw_blky_nonneg:
  lda #0
  sta sw_tmp5                   ; screenRow quotient
sw_fcw_ydivmod15_loop:
  lda sw_tmp4
  bne sw_fcw_ydivmod15_sub
  lda sw_tmp3
  cmp #15
  bcc sw_fcw_ydivmod15_done
sw_fcw_ydivmod15_sub:
  lda sw_tmp3
  sec
  sbc #15
  sta sw_tmp3
  lda sw_tmp4
  sbc #0
  sta sw_tmp4
  inc sw_tmp5
  jmp sw_fcw_ydivmod15_loop
sw_fcw_ydivmod15_done:
  lda sw_tmp5                   ; A = screenRow
  ldx sw_tmp3                   ; X = localRow
  jsr sw_clamp_row
  sta sw_fc_desr
  stx sw_fc_desrl
  rts

; ==========================================================================
; sw_frame_camera_window -- the ordinary per-frame entry point: recompute
; this frame's desired window (above), then tail-call the arm decision,
; which steps the window's own "current" origin toward it by at most one
; block and arms a fresh strip for the newly-entered edge. Called once a
; frame from engine/player.asm's streamed update_player branch, after any
; movement/knockback for the frame has already landed in player_x/player_y/
; sw_col/sw_row. Always runs, whether or not the player actually moved this
; frame -- cheap when nothing changed (the arm decision below finds
; desired==current and does nothing), and camera-follow must keep working
; through a capped knockback too.
; ==========================================================================
sw_frame_camera_window:
  ; Fix round 1, finding 2: an OUTER cam_dirty hold, raised before recompute
  ; ever runs and released only once this frame's guard decision is known --
  ; sw_camera_window_recompute's own inc/dec pair nests inside it (cam_dirty
  ; goes 1->2->1 across that call, never back to 0), so nmi_scroll's own
  ; `lda <cam_dirty / bne nmi_scroll_cam_stale` (engine/boot.asm) keeps
  ; reading it as held and skips refreshing nmi_cam_x_lo/y_lo/nt from the
  ; freshly-published-but-not-yet-decided cam_x_lo/y_lo/cam_nt for every
  ; instruction between "camera published" and "the guard decides," not only
  ; the handful right before the guard's own forced blank. An unrestricted
  ; jump published first, even for one NMI, scans an unredrawn window --
  ; detection has to precede publication, not merely follow it closely.
  inc <cam_dirty
  jsr sw_camera_window_recompute
  jsr sw_pjg_check
  bne sw_pjg_trigger
  ; Ordinary frame: no jump detected, so this frame's freshly published
  ; camera is safe to publish for real -- release the outer hold now, same
  ; instant sw_win_arm's own ordinary per-frame tail would have run before
  ; this fix.
  dec <cam_dirty
  jmp sw_win_arm                ; tail call -- its own rts answers for ours
sw_pjg_trigger:
  ; The outer hold stays raised across the whole guard transaction --
  ; sw_position_jump_guard releases it itself, only once the transaction
  ; (forced blank through resumed rendering) is complete.
  jmp sw_position_jump_guard    ; jmp, not bne -- sw_pjg_check's own body
                                 ; below is long enough to exceed a branch's
                                 ; +-128 byte reach (CLAUDE.md's own trap)

; ==========================================================================
; sw_position_jump_guard -- obligation 3's own active response. Fires when
; sw_pjg_check (below) finds either axis's lag (the window's own persistent
; "current" origin vs. this frame's freshly computed "desired" one, both in
; blocks) at or past the design's threshold of 6. Operative order, exactly
; docs/design-streamed-worlds.md's own "position-jump guard" section:
; suppress camera/OAM publication for this frame and every frame until the
; resync completes (here, forcing $2000/$2001 off IS the suppression -- no
; PPU-scanned content reaches the screen while blanked, so nothing "shows"
; the still-mismatched camera/window pair sw_camera_window_recompute just
; published) and cancel any in-flight strip (moot once the redraw below
; repaints the whole window anyway); install the target window origin
; directly (current := desired, both axes, no incremental approach); force
; blank (both writes below -- true for the whole redraw's length, since
; nothing else in this synchronous call chain returns to main_loop until
; this routine's own rts, so mainline movement/input is frozen throughout,
; the same "the world is frozen for the whole transaction" rule a dialogue
; freeze already applies elsewhere); redraw the whole window at that target
; origin (sw_render_window, never incremental); rebuild OAM against it;
; publish the camera that redraw now genuinely agrees with (already sitting
; in cam_nt/cam_x_lo/cam_y_lo from this frame's own recompute); resume
; rendering only once all of that is done. This is NOT a screen ownership
; change (unlike a landing) -- flat_screen/ord_screen/sw_col/sw_row are
; already correct, so this never calls spawn_entities/rebuild_bound_cache/
; apply_map_music the way a redraw_screen landing does: no entry event, no
; screen_fresh, matching the contract's own transition matrix (docs/design-
; streamed-worlds.md §8, "Teleport resync (lag guard)" row).
; ==========================================================================
sw_position_jump_guard:
  lda #0
  sta $2000                 ; NMI off while the redraw drives raw PPU writes
  sta $2001                 ; rendering off -- forced blank for the whole
                             ; resync, not merely this one frame
  sta st_active              ; cancel any in-flight strip on guard entry
  lda sw_fc_desc
  sta win_col_screen         ; target-origin install: current := desired,
  lda sw_fc_desl             ; both axes, immediately -- never sw_win_arm's
  sta win_col_local           ; own one-block-at-a-time approach
  lda sw_fc_desr
  sta win_row_screen
  lda sw_fc_desrl
  sta win_row_local
  jsr sw_render_window        ; full torus redraw at the target origin --
                              ; never incremental
  jsr build_oam
  jsr draw_entities
  jsr wait_vblank_poll
  ; Fix round 1, finding 3: DMA the just-rebuilt shadow OAM into hardware
  ; OAM here, under blank, before resuming -- NMI is off for the whole
  ; redraw (the very first store this routine makes, above), so the ordinary
  ; per-vblank `sta $2003 / lda #$02 / sta $4014` the nmi handler otherwise
  ; does (engine/boot.asm) never ran during it. Without this, the hardware
  ; OAM the PPU scans still describes the pre-guard frame at the first
  ; display-enable below, even though the shadow (and the nametable/
  ; attribute bytes sw_render_window just painted) are already correct.
  lda #$00
  sta $2003
  lda #$02
  sta $4014
  lda <cam_nt                 ; already this frame's corrected values, from
  ora #PPUCTRL_ON               ; sw_camera_window_recompute above -- the
  sta $2000                    ; redraw just now made them true; re-applying
  lda <cam_x_lo                 ; them is what "resumes ordinary rendering
  sta $2005                     ; and publication" means
  lda <cam_y_lo
  sta $2005
  lda #PPUMASK_ON
  sta $2001
  ; Fix round 1, finding 2: release the outer cam_dirty hold sw_frame_camera_
  ; window raised, only now that the full guard transaction -- forced blank,
  ; redraw, OAM DMA, resumed rendering -- is genuinely complete.
  dec <cam_dirty
  rts

; sw_pjg_check -- both axes' lag, window "current" origin vs. this frame's
; "desired" one (sw_fc_desc/desl/desr/desrl, sw_camera_window_recompute's own
; output, just above), in blocks. Both axes are always checked (never a
; short-circuit branch on the first one's own result) -- the two results are
; ORed together via sw_fc_wy_lo -- sw_camera_window_recompute's own worldY-
; shift scratch, already fully consumed and free by the time this runs,
; never touched by sw_win_arm either. Out: Z clear when either axis's lag is
; >= 6 (the caller's own `bne`), Z set otherwise. Clobbers A, sw_tmp..
; sw_tmp5, sw_fc_wy_lo.
;
; Fix round 1, finding 4: this used to total both origins to 16-bit block
; counts via a 4-iteration shift-and-add per side (four shift loops, two
; 16-bit adds, two 16-bit subtracts, every frame) before ever comparing
; them. Screens first, cheaper: equal screens need only the local-coordinate
; difference; adjacent screens (current screen = desired screen +/-1) need
; that same local difference adjusted by one axis's own screen span (16
; blocks X, 15 Y) in the matching direction; origins two or more screens
; apart necessarily differ by well over 6 blocks regardless of either
; local coordinate (worst case, adjacent locals at opposite screen edges,
; is still a 17-block gap for two screens) so no arithmetic beyond the
; screen-index compare is needed at all. Every combined magnitude sw_pjg_
; lag_trip below actually computes (equal: 0-14; adjacent: -30..31) fits a
; signed byte with room to spare, so this needs no 16-bit math anywhere.
sw_pjg_check:
  ; ---- X axis ----
  lda win_col_screen
  sta sw_tmp
  lda win_col_local
  sta sw_tmp2
  lda sw_fc_desc
  sta sw_tmp3
  lda sw_fc_desl
  sta sw_tmp4
  lda #16                     ; blocks per screen, X axis
  sta sw_tmp5
  jsr sw_pjg_lag_trip
  sta sw_fc_wy_lo             ; stash: 1 if the X axis alone already tripped
  ; ---- Y axis ----
  lda win_row_screen
  sta sw_tmp
  lda win_row_local
  sta sw_tmp2
  lda sw_fc_desr
  sta sw_tmp3
  lda sw_fc_desrl
  sta sw_tmp4
  lda #15                     ; blocks per screen, Y axis
  sta sw_tmp5
  jsr sw_pjg_lag_trip
  ora sw_fc_wy_lo             ; combine: nonzero (Z clear) iff either axis tripped
  rts

; sw_pjg_lag_trip -- in: sw_tmp/sw_tmp2 = one axis's current screen/local;
; sw_tmp3/sw_tmp4 = that axis's desired screen/local; sw_tmp5 = that axis's
; own blocks-per-screen span (16 X, 15 Y). Screen indices are small (well
; under 128 for any real grid), so a plain signed byte subtraction of them
; is exact -- never the fill/probe routines' own separate $ff off-map
; sentinel (sw_rw_probe and friends), which this routine never reads. Out:
; Z clear (A=1) when |current-desired|, in local units, is >= 6; Z set
; (A=0) otherwise. Clobbers A, sw_tmp6.
sw_pjg_lag_trip:
  lda sw_tmp
  sec
  sbc sw_tmp3                 ; A = current screen - desired screen
  beq sw_pjg_lt_same
  cmp #1
  beq sw_pjg_lt_pos1
  cmp #$ff
  beq sw_pjg_lt_neg1
  bne sw_pjg_lt_yes            ; |screenDelta| >= 2: over threshold regardless of either local
sw_pjg_lt_same:
  lda sw_tmp2
  sec
  sbc sw_tmp4                 ; A = currentLocal - desiredLocal
  jmp sw_pjg_lt_abs
sw_pjg_lt_pos1:                ; current screen = desired screen + 1
  lda sw_tmp5
  clc
  adc sw_tmp2
  sec
  sbc sw_tmp4                 ; A = unitsPerScreen + currentLocal - desiredLocal
  jmp sw_pjg_lt_abs
sw_pjg_lt_neg1:                ; current screen = desired screen - 1
  lda sw_tmp2
  sec
  sbc sw_tmp4
  sec
  sbc sw_tmp5                  ; A = currentLocal - desiredLocal - unitsPerScreen
sw_pjg_lt_abs:
  bpl sw_pjg_lt_abs_done
  eor #$ff
  clc
  adc #1                        ; two's-complement negate: A = |A|
sw_pjg_lt_abs_done:
  cmp #6
  bcc sw_pjg_lt_no
sw_pjg_lt_yes:
  lda #1
  rts
sw_pjg_lt_no:
  lda #0
  rts

; ==========================================================================
; sw_camera_window_install -- the landing entry point (sw_resolve_divdone,
; above): recompute the SAME clamped, player-centred desired window
; sw_frame_camera_window's tracking would otherwise only reach a few frames
; later, then install it DIRECTLY as the window's own "current" origin
; (win_col_screen/local, win_row_screen/local) instead of sw_win_arm's own
; approach-by-one-block-and-arm-a-strip dance -- there is no prior "current"
; window to approach FROM at a landing, and sw_render_window (the caller's
; very next call, engine/boot.asm/engine/screens.asm) renders whatever
; win_col/row screen+local hold, so this must already be the full desired
; rect before that call, not merely armed toward it. Because install sets
; current equal to desired, sw_win_arm's own first ordinary comparison next
; frame finds nothing to arm (the plan's own "the first tracking frame after
; the landing must compute already-at-desired" requirement) -- unless the
; player has itself moved in the interim (impossible between a landing and
; its own very next frame).
;
; sw_camera_window_recompute's own cam_x_lo/cam_y_lo/cam_nt/sw_cam_origin_*
; publish already ran by the time this returns, so the caller's own
; enable_rendering-adjacent $2000/$2005/$2005 write sequence (identical in
; boot.asm and screens.asm) reads the correct, already-clamped scroll --
; camera, physical scroll and OAM are all consistent before display turns on.
;
; In: sw_col/sw_row/player_x/player_y already the landing position (set by
; sw_enter_screen and by the caller, respectively, both of which run before
; this). Clobbers exactly as sw_camera_window_recompute does.
; ==========================================================================
sw_camera_window_install:
  jsr sw_camera_window_recompute
  lda sw_fc_desc
  sta win_col_screen
  lda sw_fc_desl
  sta win_col_local
  lda sw_fc_desr
  sta win_row_screen
  lda sw_fc_desrl
  sta win_row_local
  rts

; ==========================================================================
; sw_win_arm -- compares this frame's desired window origin (sw_fc_desc/
; desl/desr/desrl, just computed) against the window's own persistent
; "current" origin, pair-order (screen first, then local). A differing axis
; steps current by exactly one block toward desired and arms a fresh strip
; for the newly-entered edge -- but ONLY while st_active==0 (engine/
; constants.asm: "0 idle, 1 column strip, 2 row strip"): arming while a
; strip is still draining would overwrite sbuf/st_len/st_cur out from under
; sw_nmi_stream's own in-flight read (confirmed by reading its drain loop,
; above). At most one axis arms per frame -- sw_stream_start_col/row's own
; last act sets st_active nonzero, so the row check below naturally declines
; if col just armed. A blocked or unchanged axis is simply retried next
; frame; the window's own 7-8 block margin absorbs the slack.
; ==========================================================================
sw_win_arm:
  lda win_col_screen
  cmp sw_fc_desc
  bne sw_win_arm_col_try
  lda win_col_local
  cmp sw_fc_desl
  beq sw_win_arm_row
sw_win_arm_col_try:
  lda st_active
  bne sw_win_arm_row
  lda win_col_screen
  cmp sw_fc_desc
  bcc sw_win_arm_col_inc
  bne sw_win_arm_col_dec
  lda win_col_local
  cmp sw_fc_desl
  bcc sw_win_arm_col_inc
sw_win_arm_col_dec:
  jsr sw_win_col_dec
  lda win_col_screen
  ldx win_col_local
  jsr sw_stream_start_col
  jmp sw_win_arm_row
sw_win_arm_col_inc:
  jsr sw_win_col_inc
  jsr sw_win_entering_col_right
  jsr sw_stream_start_col
sw_win_arm_row:
  lda win_row_screen
  cmp sw_fc_desr
  bne sw_win_arm_row_try
  lda win_row_local
  cmp sw_fc_desrl
  beq sw_win_arm_done
sw_win_arm_row_try:
  lda st_active
  bne sw_win_arm_done
  lda win_row_screen
  cmp sw_fc_desr
  bcc sw_win_arm_row_inc
  bne sw_win_arm_row_dec
  lda win_row_local
  cmp sw_fc_desrl
  bcc sw_win_arm_row_inc
sw_win_arm_row_dec:
  jsr sw_win_row_dec
  lda win_row_screen
  ldx win_row_local
  jsr sw_stream_start_row
  jmp sw_win_arm_done
sw_win_arm_row_inc:
  jsr sw_win_row_inc
  jsr sw_win_entering_row_down
  jsr sw_stream_start_row
sw_win_arm_done:
  rts
sw_win_arm_region_end:
  ; Kernel-budget boundary label (unconditional): brackets sw_win_col_inc/dec,
  ; sw_win_row_inc/dec, sw_win_entering_col_right/row_down,
  ; sw_camera_window_recompute, sw_frame_camera_window,
  ; sw_camera_window_install (the landing slice's own factoring-out of the
  ; per-frame tracking computation, shared with sw_resolve_divdone above --
  ; single writer, no second copy of the clamp/centre arithmetic) and
  ; sw_win_arm as one named kernel-hi term, excluding sw_knockback_step below
  ; regardless of BATTLE_ENABLED (this
  ; label sits at the same address sw_knockback_step would start at on an
  ; action project, and at sw_update_player's own address on an RPG, where
  ; the `.if !BATTLE_ENABLED` block below assembles to nothing).

  .if !BATTLE_ENABLED
; ==========================================================================
; sw_knockback_step -- phase 2 slice 5: the accepted-hypothesis pacing, 16
; frames (sw_kb_timer, SW_KB_TIME) at an average 1.5px/frame (sw_kb_acc,
; SW_KB_SPEED_SUB) -- combat.asm's own knockback_step, but with a real
; sub-pixel accumulator driving 1-or-2px/frame instead of a bare constant
; speed, exactly sw_walk_step_x's own WHOLE_STEP+overflow shape. Same
; dispatch shape, same move_up/left/right/down reuse (their own probe never
; straddles on a streamed map either -- see the report's own proof), same
; jmp-ends-in-rts convention (lands back in sw_update_player's own caller).
; !BATTLE_ENABLED-gated, matching knockback_step's own gate -- an RPG has no
; knockback concept at all.
; ==========================================================================
sw_knockback_step:
  dec sw_kb_timer
  jsr sw_kb_step_pixels
  sta <cur_speed
  lda <kb_dir
  cmp #DIR_UP
  beq sw_knockback_up
  cmp #DIR_LEFT
  beq sw_knockback_left
  cmp #DIR_RIGHT
  beq sw_knockback_right_step
  jmp sw_pstep_down
sw_knockback_up:
  jmp sw_pstep_up
sw_knockback_left:
  jmp sw_pstep_left
sw_knockback_right_step:
  jmp sw_pstep_right

; sw_kb_step_pixels -- sw_walk_step_x/y's own accumulator shape (this file,
; above), a distinct copy for the knockback burst alone: Out: A = this
; frame's whole-pixel step (1 or 2). Clobbers nothing but A.
sw_kb_step_pixels:
  lda sw_kb_acc
  clc
  adc #SW_KB_SPEED_SUB
  sta sw_kb_acc
  lda #1
  bcc sw_kb_step_pixels_done
  lda #2
sw_kb_step_pixels_done:
  rts
  .endif
sw_knockback_step_end:
  ; Kernel-budget boundary label: brackets sw_knockback_step alone, gated
  ; identically (`.if !BATTLE_ENABLED`) -- 0 bytes on an RPG, where the block
  ; above assembles to nothing and this label lands at the same address as
  ; sw_knockback_step itself.

; ==========================================================================
; sw_update_player -- phase 2 slice 4b: reached by a plain jmp from
; engine/player.asm's update_player (map_is_streamed set), replacing the
; ordinary per-button pad dispatch entirely. This routine's own rts
; therefore returns directly to update_player's caller (main_loop), the
; same "jmp ends in rts, lands past the jumper" shape cross_*/redraw_screen
; already use.
;
; Order: iframes already decremented by the caller (update_player, before
; the jmp here); <moving> already reset to 0 there too (update_player's own
; top, before its streamed branch), so sw_pstep_*'s own `inc <moving>` is
; this frame's only writer. sw_event_freeze (an event started this frame)
; skips movement outright; streamed knockback (sw_kb_timer active, !BATTLE_ENABLED
; only) overrides the ordinary axis dispatch; otherwise axis arbitration
; (sw_axis_pref) plus the accumulator (sw_walk_step_x/y) drive exactly one
; axis via cur_speed=delta into sw_pstep_left/right/up/down (fix round 1,
; finding 3: the true 256/240 ownership boundary, never the ordinary
; MAX_X/MAX_Y cut sw_pstep's callers no longer reach through).
;
; Fix round 1, finding 1: a crossing this frame (screen_fresh, set by
; sw_pstep_*'s own ownership commit -- spawn_entities already run, identity
; already updated) stops the frame's remaining per-screen work -- hazard,
; encounter, walk animation -- exactly as the ordinary engine's own
; update_player_vertical/update_player_anim checks do (engine/player.asm),
; deferring to the next frame. Finding 7: walk animation runs in the
; non-crossed path, the identical shape update_player_anim's own tail uses
; (moving? advance anim_timer/toggle anim_frame : reset both). The window
; arm decision and the continuous camera-feed derivation
; (sw_frame_camera_window, above) still run every frame the player did NOT
; just get a lethal hit on, whether or not the player moved and whether or
; not this frame crossed -- a crossing changes player_x/player_y/sw_col/
; sw_row in the very same frame, so the camera must follow immediately, not
; on a one-frame lag.
; ==========================================================================
sw_update_player:
  lda <sw_event_freeze
  bne sw_up_hazard
  .if !BATTLE_ENABLED
  lda sw_kb_timer
  beq sw_up_axis
  jsr sw_knockback_step
  jmp sw_up_hazard
  .endif
sw_up_axis:
  lda <pad
  and #BTN_LEFT+BTN_RIGHT+BTN_UP+BTN_DOWN
  beq sw_up_hazard          ; no held direction -- nothing to arbitrate
  ; A fresh press this frame (pad_new) reassigns ownership outright -- "most
  ; recently pressed axis owns." X is checked first, so a simultaneous fresh
  ; press of both axes has X win the tie.
  lda <pad_new
  and #BTN_LEFT+BTN_RIGHT
  bne sw_up_axis_newx
  lda <pad_new
  and #BTN_UP+BTN_DOWN
  bne sw_up_axis_newy
  jmp sw_up_axis_continue
sw_up_axis_newx:
  lda #0
  sta <sw_axis_pref
  jmp sw_up_axis_continue
sw_up_axis_newy:
  lda #1
  sta <sw_axis_pref
sw_up_axis_continue:
  ; No fresh press this frame (or one was just applied above): honour
  ; sw_axis_pref if that axis is still held, otherwise fall back to
  ; whichever axis IS held -- a stale pref can still name an axis the player
  ; released frames ago while continuing to hold the other one.
  lda <sw_axis_pref
  bne sw_up_pref_y
  lda <pad
  and #BTN_LEFT+BTN_RIGHT
  bne sw_up_do_x
  lda <pad
  and #BTN_UP+BTN_DOWN
  beq sw_up_hazard
  lda #1
  sta <sw_axis_pref
  jmp sw_up_do_y
sw_up_pref_y:
  lda <pad
  and #BTN_UP+BTN_DOWN
  bne sw_up_do_y
  lda <pad
  and #BTN_LEFT+BTN_RIGHT
  beq sw_up_hazard
  lda #0
  sta <sw_axis_pref
sw_up_do_x:
  jsr sw_walk_step_x
  sta <cur_speed
  lda <pad
  and #BTN_LEFT
  beq sw_up_x_right
  jsr sw_pstep_left
  jmp sw_up_hazard
sw_up_x_right:
  jsr sw_pstep_right
  jmp sw_up_hazard
sw_up_do_y:
  jsr sw_walk_step_y
  sta <cur_speed
  lda <pad
  and #BTN_UP
  beq sw_up_y_down
  jsr sw_pstep_up
  jmp sw_up_hazard
sw_up_y_down:
  jsr sw_pstep_down
sw_up_hazard:
  lda <screen_fresh
  bne sw_up_camera
  jsr player_hazard
  .if BATTLE_ENABLED
  lda <game_state
  bne sw_up_done
  jsr check_encounter
  .endif
  lda <moving
  beq sw_up_stand
  inc <anim_timer
  lda <anim_timer
  cmp #ANIM_RATE
  bcc sw_up_camera
  lda #0
  sta <anim_timer
  lda <anim_frame
  eor #1
  sta <anim_frame
  jmp sw_up_camera
sw_up_stand:
  lda #0
  sta <anim_frame
  sta <anim_timer
sw_up_camera:
  jsr sw_frame_camera_window
sw_up_done:
  rts
sw_update_player_end:
  ; Kernel-budget boundary label: brackets sw_update_player itself (the
  ; per-frame driver dispatch: event-freeze check, capped-knockback branch,
  ; axis arbitration, the accumulator dispatch, player_hazard/check_encounter,
  ; the tail call into sw_frame_camera_window), unconditional regardless of
  ; BATTLE_ENABLED.

; ==========================================================================
; The dialogue overlay: address mapper, split-at-seam packet writer, and
; masked-attribute code (docs/design-streamed-worlds.md §7, phase 2 slice
; 7a -- the mapper/packet/attribute subset only; no lifecycle state machine
; here, and no production call site into text.asm yet -- see the slice's
; own "Left out"). Gated on TEXT_ENABLED as well as STREAMING_ENABLED (this
; whole file's own guard): a streamed project with no text assembles none
; of it. sw_dlg_mapper_start/end bracket the span for
; STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE (main/build/generate.js),
; measured off nesasm's own symbol table, not by hand.
;
; Both mappers below assume the camera is already floored to a 16px
; (metatile) boundary on both axes -- cam_x_lo/cam_y_lo's low 4 bits are 0
; -- the precondition the lifecycle's own nudge (slice 7b) establishes
; before it ever opens a box. Neither mapper re-floors; a caller that
; violates the precondition gets an address computed from whatever
; cam_x_lo/cam_y_lo actually hold, unchecked.
sw_dlg_mapper_start:
  .if TEXT_ENABLED

; sw_dlg_attr_precompute's own 3-iteration band loop below assumes the box is
; exactly BOX_ROWS_HIGH (6) tile rows -- 3 metatile-row bands -- high; two
; one-directional comparisons, the same restricted `>`-only pattern
; flash.asm's own driver-size guard uses (nesasm v3.1's expression grammar
; has no working `!=`).
  .if BOX_ROWS_HIGH > 6
  .fail
  .endif
  .if 6 > BOX_ROWS_HIGH
  .fail
  .endif

; ==========================================================================
; sw_dlg_tile_addr -- the address mapper, tile granularity. A = box-
; relative tile row (0-5, added to the fixed row-24 origin every ordinary
; box already uses); X = box-local column (0-31). Returns A = $2006 hi
; byte, Y = $2006 lo byte. physRow = (cam_y_lo>>3 + 24 + A) mod 30
; (crossing XORs cam_nt bit 1); physCol = (cam_x_lo>>3 + X) mod 32
; (crossing XORs cam_nt bit 0); addrLo = (physRow AND 7)<<5 OR physCol;
; addrHi = sw_rw_nt_hi[cam_nt XOR ntbit] + (physRow>>3) -- sw_rw_nt_hi is
; sw_render_window's own nametable-hi table, above, reused rather than a
; second copy.
; ==========================================================================
sw_dlg_tile_addr:
  clc
  adc #BOX_MT_ROW*2         ; tile row 24 -- BOX_MT_ROW (metatile rows) in tile rows
  sta <sw_dlgw_ta_tmp
  lda <cam_y_lo
  lsr a
  lsr a
  lsr a
  clc
  adc <sw_dlgw_ta_tmp
  cmp #30
  bcc sw_dlgta_row_ok
  sbc #30
  sta <sw_dlgw_ta_row
  lda #2
  jmp sw_dlgta_row_done
sw_dlgta_row_ok:
  sta <sw_dlgw_ta_row
  lda #0
sw_dlgta_row_done:
  sta <sw_dlgw_ta_nt
  lda <cam_x_lo
  lsr a
  lsr a
  lsr a
  sta <sw_dlgw_ta_tmp
  txa
  clc
  adc <sw_dlgw_ta_tmp
  cmp #32
  bcc sw_dlgta_col_ok
  sbc #32
  sta <sw_dlgw_ta_col
  lda <sw_dlgw_ta_nt
  ora #1
  jmp sw_dlgta_combine
sw_dlgta_col_ok:
  sta <sw_dlgw_ta_col
  lda <sw_dlgw_ta_nt
sw_dlgta_combine:
  sta <sw_dlgw_ta_nt
  lda <sw_dlgw_ta_row
  and #7
  asl a
  asl a
  asl a
  asl a
  asl a
  ora <sw_dlgw_ta_col
  tay
  lda <cam_nt
  eor <sw_dlgw_ta_nt
  and #3
  tax
  lda <sw_dlgw_ta_row
  lsr a
  lsr a
  lsr a
  clc
  adc sw_rw_nt_hi,x
  rts

; ==========================================================================
; sw_dlg_write_row -- the split-at-seam packet writer, tile granularity.
; A = box-relative tile row (0-5); sw_dlgw_srclo/hi point at 32 source
; bytes. Queues them via the ordinary vram_open/push/end primitives
; (engine/text.asm), split into two packets when the row straddles a
; physical nametable seam. Never opens a packet it will not push to: the
; r==0 case (camera exactly nametable-aligned horizontally) skips the
; second packet outright rather than opening one with a zero count --
; vram_drain_byte's own 256-byte trap (CLAUDE.md), applied to this
; producer's own direct-write path.
; ==========================================================================
sw_dlg_write_row:
  sta <sw_dlgw_band
  lda <cam_x_lo
  lsr a
  lsr a
  lsr a
  sta <sw_dlgw_r
  beq sw_dlgwr_nosplit
  lda #32
  sec
  sbc <sw_dlgw_r
  sta <sw_dlgw_count1
  lda <sw_dlgw_band
  ldx #0
  jsr sw_dlg_tile_addr
  jsr vram_open
  ldy #0
sw_dlgwr_seg1_loop:
  lda [sw_dlgw_srclo],y
  jsr vram_push
  iny
  cpy <sw_dlgw_count1
  bne sw_dlgwr_seg1_loop
  jsr vram_end
  lda <sw_dlgw_band
  ldx <sw_dlgw_count1
  jsr sw_dlg_tile_addr
  jsr vram_open
  ldy <sw_dlgw_count1
sw_dlgwr_seg2_loop:
  lda [sw_dlgw_srclo],y
  jsr vram_push
  iny
  cpy #32
  bne sw_dlgwr_seg2_loop
  jmp vram_end
sw_dlgwr_nosplit:
  lda <sw_dlgw_band
  ldx #0
  jsr sw_dlg_tile_addr
  jsr vram_open
  ldy #0
sw_dlgwr_ns_loop:
  lda [sw_dlgw_srclo],y
  jsr vram_push
  iny
  cpy #32
  bne sw_dlgwr_ns_loop
  jmp vram_end

; ==========================================================================
; sw_dlg_attr_precompute -- must run once before any sw_dlg_attr_open_band/
; sw_dlg_attr_close_band call for a given open box (the camera does not
; move while one is up -- §7's own frozen-world pending-open rule -- so one
; precompute per open/close transaction is enough). Computes, for each of
; the box's three metatile-row bands (0-2, tile rows 24-25/26-27/28-29):
; the attribute row (0-7) and row-wrap nt bit its own physical position
; resolves to, and its own row-half mask (top $0F, bottom $F0) -- promoted
; to the full byte ($FF) for BOTH bands of whichever adjacent pair shares
; one physical attribute byte (docs/design-streamed-worlds.md §7's own
; empirically-found addition: applying the half mask independently per row
; is wrong when two band rows share a byte, since each would compute from
; pristine attr_shadow and the second write would undo the first's already-
; correct half; forcing the full mask on both makes the write idempotent
; regardless of order). Also computes the column seam: edgeAc (the
; attribute column straddling it), cxodd (nonzero when the seam falls
; mid-attribute-column, needing a quadrant-only mask there) and wrapEnd
; (the last attribute column the wrapped-nt segment touches).
; ==========================================================================
sw_dlg_attr_precompute:
  lda <cam_y_lo
  lsr a
  lsr a
  lsr a
  lsr a
  clc
  adc #BOX_MT_ROW
  sta <sw_dlgw_baserow      ; held constant across the loop -- see its own comment
                              ; (engine/constants.asm) for why: each iteration below re-derives
                              ; that band's UNWRAPPED logical row from this same untouched base
                              ; plus its own index, rather than carrying a destructively-wrapped
                              ; remainder forward, so a band on the far side of the seam (its own
                              ; unwrapped row already >=15) is not mistaken for an unwrapped one
                              ; just because the PRIOR band's remainder happened to fall < 15
  ldx #0
sw_dlgap_loop:
  txa
  clc
  adc <sw_dlgw_baserow
  cmp #15
  bcc sw_dlgap_ok
  sbc #15
  sta <sw_dlgw_tmp
  lda #2
  sta <sw_dlgw_ntb,x
  jmp sw_dlgap_store
sw_dlgap_ok:
  sta <sw_dlgw_tmp
  lda #0
  sta <sw_dlgw_ntb,x
sw_dlgap_store:
  lda <sw_dlgw_tmp
  lsr a
  sta <sw_dlgw_arow,x
  lda <sw_dlgw_tmp
  and #1
  bne sw_dlgap_bottom
  lda #$0F
  jmp sw_dlgap_halfdone
sw_dlgap_bottom:
  lda #$F0
sw_dlgap_halfdone:
  sta <sw_dlgw_rowmask,x
  inx
  cpx #3
  bne sw_dlgap_loop
  ldx #0
  lda <sw_dlgw_arow,x
  ldx #1
  cmp <sw_dlgw_arow,x
  bne sw_dlgap_sh01_no
  ldx #0
  lda <sw_dlgw_ntb,x
  ldx #1
  cmp <sw_dlgw_ntb,x
  bne sw_dlgap_sh01_no
  lda #$FF
  ldx #0
  sta <sw_dlgw_rowmask,x
  ldx #1
  sta <sw_dlgw_rowmask,x
sw_dlgap_sh01_no:
  ldx #1
  lda <sw_dlgw_arow,x
  ldx #2
  cmp <sw_dlgw_arow,x
  bne sw_dlgap_sh12_no
  ldx #1
  lda <sw_dlgw_ntb,x
  ldx #2
  cmp <sw_dlgw_ntb,x
  bne sw_dlgap_sh12_no
  lda #$FF
  ldx #1
  sta <sw_dlgw_rowmask,x
  ldx #2
  sta <sw_dlgw_rowmask,x
sw_dlgap_sh12_no:
  lda <cam_x_lo
  lsr a
  lsr a
  lsr a
  lsr a
  and #1
  sta <sw_dlgw_cxodd
  lda <cam_x_lo
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a
  sta <sw_dlgw_edgeac
  clc
  adc <sw_dlgw_cxodd
  sec
  sbc #1
  sta <sw_dlgw_wrapend
  rts

; sw_dlg_attr_addr -- A = column-seam nt bit (0 = home segment, 1 =
; wrapped). Uses sw_dlgw_curarow/curntb (set by the caller) and
; sw_dlgw_ac (the attribute column, 0-7) to compute both the $2006 hi/lo
; pair (returned A=hi, Y=lo) and the matching attr_shadow offset (left in
; sw_dlgw_shadowlo -- shadow's own high byte is always the constant
; HIGH(attr_shadow), a whole 256-byte page, so only the low byte varies:
; (nt<<6) | (arow<<3) | ac, the same bit-packed layout sw_ns_row_lo/
; sw_rw_shadow_lo already use above). This routine itself writes that
; constant into sw_dlgw_tmp (== sw_dlgw_shadowlo+1, the pointer's own hi
; byte) as the last thing before returning, since sw_dlgw_tmp is also this
; routine's own scratch for the seam-bit parameter earlier -- a caller
; indirecting through [sw_dlgw_shadowlo],y right after this call sees a
; valid pointer without setting anything up itself. The attribute region's
; own $2006 hi byte is constant per nametable (sw_rw_nt_hi[nt]+3) regardless
; of attribute row -- arow only ever affects the lo byte.
sw_dlg_attr_addr:
  sta <sw_dlgw_tmp
  lda <cam_nt
  eor <sw_dlgw_curntb
  eor <sw_dlgw_tmp
  and #3
  pha
  tax
  txa
  asl a
  asl a
  asl a
  asl a
  asl a
  asl a
  sta <sw_dlgw_shadowlo
  lda <sw_dlgw_curarow
  asl a
  asl a
  asl a
  clc
  adc <sw_dlgw_shadowlo
  clc
  adc <sw_dlgw_ac
  sta <sw_dlgw_shadowlo
  pla
  tax
  lda sw_rw_nt_hi,x
  clc
  adc #3
  pha
  lda <sw_dlgw_curarow
  asl a
  asl a
  asl a
  clc
  adc <sw_dlgw_ac
  clc
  adc #$C0
  tay
  lda #HIGH(attr_shadow)      ; same symbolic form as sw_ns_row_hi/sw_rw_shadow_hi above
                               ; (streamworld.asm:2008,2126) -- nesasm v3.1 accepts HIGH(), unlike
                               ; a `>`-of-equate expression
  sta <sw_dlgw_tmp
  pla
  rts

; sw_dlg_attr_overlay -- A = column mask (quadrant bits actually inside the
; band for the byte at sw_dlgw_shadowlo). Combines with sw_dlgw_currm (the
; band's own row mask) and returns overlay = shadow AND NOT (row AND col)
; in A -- the box's fixed background palette 0 (text.asm's identical
; choice) makes "mask in the box palette" a plain clear, no OR needed.
sw_dlg_attr_overlay:
  and <sw_dlgw_currm
  eor #$FF
  sta <sw_dlgw_mask            ; NOT sw_dlgw_tmp -- sw_dlgw_tmp is [sw_dlgw_shadowlo]'s own
                                ; pointer hi byte (sw_dlg_attr_addr's own doc comment); clobbering
                                ; it here before the indirect read below would misdirect the read
                                ; to page $00 or the mask's own byte instead of attr_shadow.
  ldy #0
  lda [sw_dlgw_shadowlo],y
  and <sw_dlgw_mask
  rts

; ==========================================================================
; sw_dlg_attr_open_band -- A = band index (0-2). Requires
; sw_dlg_attr_precompute to have already run for this open. Writes the
; masked attribute bytes for this band: one packet for the home-nt segment
; (attribute columns edgeAc..7, full width -- the box always spans the
; whole visible screen), one for the wrapped-nt segment (columns
; 0..wrapEnd, only when non-empty), each byte computed straight from
; attr_shadow via sw_dlg_attr_overlay -- attr_shadow itself is never
; written here, only read.
; ==========================================================================
sw_dlg_attr_open_band:
  tax
  lda <sw_dlgw_arow,x
  sta <sw_dlgw_curarow
  lda <sw_dlgw_ntb,x
  sta <sw_dlgw_curntb
  lda <sw_dlgw_rowmask,x
  sta <sw_dlgw_currm

  lda <sw_dlgw_edgeac
  sta <sw_dlgw_ac
  lda #0
  jsr sw_dlg_attr_addr
  jsr vram_open
sw_dlg_aob_home_loop:
  lda <sw_dlgw_ac
  cmp <sw_dlgw_edgeac
  bne sw_dlg_aob_home_mask
  lda <sw_dlgw_cxodd
  beq sw_dlg_aob_home_mask
  lda #$CC                    ; edge byte, home side: right quadrants only
  jmp sw_dlg_aob_home_go
sw_dlg_aob_home_mask:
  lda #$FF
sw_dlg_aob_home_go:
  jsr sw_dlg_attr_overlay
  jsr vram_push
  inc <sw_dlgw_shadowlo
  inc <sw_dlgw_ac
  lda <sw_dlgw_ac
  cmp #8
  bne sw_dlg_aob_home_loop
  jsr vram_end

  lda <sw_dlgw_edgeac
  ora <sw_dlgw_cxodd
  beq sw_dlg_aob_done          ; wrapped segment empty -- never open its packet
  lda #0
  sta <sw_dlgw_ac
  lda #1
  jsr sw_dlg_attr_addr
  jsr vram_open
sw_dlg_aob_wrap_loop:
  lda <sw_dlgw_ac
  cmp <sw_dlgw_edgeac
  bne sw_dlg_aob_wrap_mask
  lda <sw_dlgw_cxodd
  beq sw_dlg_aob_wrap_mask
  lda #$33                    ; edge byte, wrapped side: left quadrants only
  jmp sw_dlg_aob_wrap_go
sw_dlg_aob_wrap_mask:
  lda #$FF
sw_dlg_aob_wrap_go:
  jsr sw_dlg_attr_overlay
  jsr vram_push
  lda <sw_dlgw_ac
  cmp <sw_dlgw_wrapend
  beq sw_dlg_aob_wrap_end
  inc <sw_dlgw_shadowlo
  inc <sw_dlgw_ac
  jmp sw_dlg_aob_wrap_loop
sw_dlg_aob_wrap_end:
  jsr vram_end
sw_dlg_aob_done:
  rts

; ==========================================================================
; sw_dlg_attr_close_band -- A = band index (0-2). Restores every attribute
; byte sw_dlg_attr_open_band touched for this band, verbatim from
; attr_shadow -- no mask math on close (docs/design-streamed-worlds.md
; §7's "masked on open, plain on close, one rule": the masked write never
; touches an outside-band quadrant, so every quadrant stays byte-identical
; to attr_shadow for the whole transaction, and close can restore the
; whole byte unmasked). Reads attr_shadow only; never writes it.
; ==========================================================================
sw_dlg_attr_close_band:
  tax
  lda <sw_dlgw_arow,x
  sta <sw_dlgw_curarow
  lda <sw_dlgw_ntb,x
  sta <sw_dlgw_curntb

  lda <sw_dlgw_edgeac
  sta <sw_dlgw_ac
  lda #0
  jsr sw_dlg_attr_addr
  jsr vram_open
sw_dlg_acb_home_loop:
  ldy #0
  lda [sw_dlgw_shadowlo],y
  jsr vram_push
  inc <sw_dlgw_shadowlo
  inc <sw_dlgw_ac
  lda <sw_dlgw_ac
  cmp #8
  bne sw_dlg_acb_home_loop
  jsr vram_end

  lda <sw_dlgw_edgeac
  ora <sw_dlgw_cxodd
  beq sw_dlg_acb_done
  lda #0
  sta <sw_dlgw_ac
  lda #1
  jsr sw_dlg_attr_addr
  jsr vram_open
sw_dlg_acb_wrap_loop:
  ldy #0
  lda [sw_dlgw_shadowlo],y
  jsr vram_push
  lda <sw_dlgw_ac
  cmp <sw_dlgw_wrapend
  beq sw_dlg_acb_wrap_end
  inc <sw_dlgw_shadowlo
  inc <sw_dlgw_ac
  jmp sw_dlg_acb_wrap_loop
sw_dlg_acb_wrap_end:
  jsr vram_end
sw_dlg_acb_done:
  rts

; ==========================================================================
; sw_dlg_origin_capture -- phase 2 slice 7b: Chris ruled (2026-09-25) this
; slice owns sw_dlg_metatile, the close-path terrain-tile accessor, and this
; is its companion. Captures this open/close transaction's own box origin
; into sw_dlg_ocol/ocol_l/orow/orow_l (engine/constants.asm), once, from
; sw_cam_origin_x_lo/hi and sw_cam_origin_y_lo/hi -- the streamed camera's
; own published world-space origin, "the world position already sitting at
; screen column/row 0" (that pair's own constants.asm comment). The
; dialogue nudge (not yet built -- see this slice's own report) keeps that
; origin floored to a 16px boundary and in lockstep with cam_x_lo/cam_y_lo
; for as long as a box stays open, and the world is frozen for the whole
; transaction (docs/design-streamed-worlds.md §7's own DLG_PENDING rule),
; so one capture serves every sw_dlg_metatile call of that transaction --
; the identical "compute once, consult many times" shape sw_dlg_attr_
; precompute already has, above.
;
; screenCol needs no division: a screen is exactly 256px wide, so
; sw_cam_origin_x_hi already IS the origin's own screenCol, and
; sw_cam_origin_x_lo>>4 is its local metatile column (0-15) -- a clean
; shift because the nudge floors it to a 16px multiple. screenRow needs a
; real divmod: a screen is 240px tall, not a power of two -- the same
; bounded repeated-subtract idiom sw_camera_window_recompute's own
; sw_fcw_ydiv_loop already uses (bounded by sw_grid_h, as that routine's
; own header documents), run here on a local copy in sw_dlg_scr0/scr1 so
; sw_cam_origin_y_lo/hi itself is left untouched for sw_project_axis's own
; next frame.
;
; In: none. Out: sw_dlg_ocol/ocol_l/orow/orow_l set. Clobbers A, X.
; ==========================================================================
sw_dlg_origin_capture:
  lda sw_cam_origin_x_hi
  sta sw_dlg_ocol
  lda sw_cam_origin_x_lo
  lsr a
  lsr a
  lsr a
  lsr a
  sta sw_dlg_ocol_l

  lda sw_cam_origin_y_lo
  sta sw_dlg_scr0
  lda sw_cam_origin_y_hi
  sta sw_dlg_scr1
  ldx #0
sw_dlgoc_ydiv_loop:
  lda sw_dlg_scr1
  bne sw_dlgoc_ydiv_sub
  lda sw_dlg_scr0
  cmp #240
  bcc sw_dlgoc_ydiv_done
sw_dlgoc_ydiv_sub:
  lda sw_dlg_scr0
  sec
  sbc #240
  sta sw_dlg_scr0
  lda sw_dlg_scr1
  sbc #0
  sta sw_dlg_scr1
  inx
  jmp sw_dlgoc_ydiv_loop
sw_dlgoc_ydiv_done:
  stx sw_dlg_orow
  lda sw_dlg_scr0
  lsr a
  lsr a
  lsr a
  lsr a
  sta sw_dlg_orow_l
  rts

; ==========================================================================
; sw_dlg_metatile -- the close-path terrain-tile accessor: composes
; sw_terrain_or_fill with the caller-supplied origin sw_dlg_origin_capture
; (above) already resolved, exactly as docs/design-streamed-worlds.md §7's
; own "On close ... via sw_dlg_metatile (composing sw_terrain_or_fill with a
; caller-supplied origin ...)" describes. sw_dlg_origin_capture must already
; have run for this transaction; this routine does not call it, so a
; caller's every close-path cell lookup pays only this routine's own small
; add/wrap arithmetic, not a fresh divmod per cell.
;
; In: A = box-relative metatile row (0-2, BOX_MT_ROW's own three bands);
;     X = box-relative metatile column (0-15).
; Out: A = the metatile id at that cell (sw_terrain_or_fill's own fill-aware
;     read). Clobbers X, Y (as sw_terrain_or_fill's real-read case does) and
;     this routine's own sw_dlg_scr0-3 scratch.
; ==========================================================================
sw_dlg_metatile:
  sta sw_dlg_scr1          ; stash box-relative row; A is about to be reused
  txa
  clc
  adc sw_dlg_ocol_l
  cmp #16
  bcc sw_dlgmt_col_ok
  sbc #16
  sta sw_dlg_scr0
  lda sw_dlg_ocol
  clc
  adc #1
  sta sw_dlg_scr2
  jmp sw_dlgmt_row
sw_dlgmt_col_ok:
  sta sw_dlg_scr0
  lda sw_dlg_ocol
  sta sw_dlg_scr2
sw_dlgmt_row:
  lda sw_dlg_scr1          ; the stashed box-relative row
  clc
  adc #BOX_MT_ROW
  clc
  adc sw_dlg_orow_l
  cmp #15
  bcc sw_dlgmt_row_ok
  sbc #15
  sta sw_dlg_scr1
  lda sw_dlg_orow
  clc
  adc #1
  sta sw_dlg_scr3
  jmp sw_dlgmt_offset
sw_dlgmt_row_ok:
  sta sw_dlg_scr1
  lda sw_dlg_orow
  sta sw_dlg_scr3
sw_dlgmt_offset:
  lda sw_dlg_scr1          ; local row (0-14)
  asl a
  asl a
  asl a
  asl a                     ; * 16 metatiles per row
  clc
  adc sw_dlg_scr0          ; + local col -- offset within the target screen
  tay
  ldx sw_dlg_scr3          ; screenRow
  lda sw_dlg_scr2          ; screenCol
  jmp sw_terrain_or_fill

; ==========================================================================
; sw_dlg_run_open/push/reopen -- the split-aware run writer, generalised
; from sw_dlg_write_row above to an arbitrary starting column and an
; arbitrary (even variable, caller-decided) length: border/close-row writes
; run the full 32-tile width from column 0, but a text-clear or choice-label
; row starts at column 2 and runs at most BOX_COLS (28), and a choice
; label's real length is however many glyphs precede its TXT_END, capped
; there. sw_dlg_write_row's own single fixed-shape split is unaffected (its
; producers, the attribute band writers, keep using it).
;
; sw_dlg_run_open never calls vram_open itself -- only sw_dlg_run_push's own
; first call does, lazily, so a caller that computes the seam and then finds
; it has nothing to write (a blank choice label) never opens a zero-push
; packet (CLAUDE.md's "a count of zero drains as 256" trap).
;
; In: A = box-relative tile row (0-5); X = box-relative starting column
;     (0-31). Out: sw_dlgw_band/col store the row/column for
;     sw_dlg_run_push's own first-call reopen; sw_dlgw_seamcol is the column
;     at which the physical nametable wraps (32 minus cam_x_lo>>3 -- 32 when
;     cam_x_lo is nametable-aligned, a value no real 0-31 column ever
;     equals, so no split ever fires); sw_dlgw_open = 0. Clobbers A.
; ==========================================================================
sw_dlg_run_open:
  sta <sw_dlgw_band
  stx <sw_dlgw_col
  lda <cam_x_lo
  lsr a
  lsr a
  lsr a
  sta <sw_dlgw_tmp          ; r, transient -- no attr call is ever in flight
                              ; here (see sw_dlgw_tmp's own comment above)
  lda #32
  sec
  sbc <sw_dlgw_tmp
  sta <sw_dlgw_seamcol
  lda #0
  sta <sw_dlgw_open
  rts

; In: A = the byte to write at the current column (sw_dlgw_col), advanced
; here. Must be called once per column in strictly ascending order, starting
; at the column sw_dlg_run_open was given. Preserves X and Y -- matching
; vram_push's own contract, which every caller here is written against (a
; loop counter in X, or a shared index/id in Y computed once and read again
; after the call, the same shapes the ordinary vram_push callers already
; use) -- even though the reopen path below genuinely clobbers both via
; sw_dlg_tile_addr, saved and restored around it rather than left to leak.
sw_dlg_run_push:
  pha
  txa
  pha
  tya
  pha
  lda <sw_dlgw_open
  bne sw_dlgrp_check_seam
  jsr sw_dlg_run_reopen
  lda #1
  sta <sw_dlgw_open
  jmp sw_dlgrp_restore
sw_dlgrp_check_seam:
  lda <sw_dlgw_col
  cmp <sw_dlgw_seamcol
  bne sw_dlgrp_restore
  jsr vram_end
  jsr sw_dlg_run_reopen
sw_dlgrp_restore:
  pla
  tay
  pla
  tax
  pla
  jsr vram_push
  inc <sw_dlgw_col
  rts

; Open a fresh packet at sw_dlgw_band/col's own current position. Clobbers
; A, X, Y.
sw_dlg_run_reopen:
  lda <sw_dlgw_band
  ldx <sw_dlgw_col
  jsr sw_dlg_tile_addr
  jmp vram_open

; ==========================================================================
; sw_dlg_write_border -- one 32-tile-wide border row (text_open_step's own
; corner/rule-or-frame/blank byte choice, made by the caller), split-aware.
; In: A = box-relative tile row (0-5); sw_dlgw_edge = the tile at columns 0
; and 31; sw_dlgw_fill = the tile for columns 1-30.
; ==========================================================================
sw_dlg_write_border:
  ldx #0
  jsr sw_dlg_run_open
  lda <sw_dlgw_edge
  jsr sw_dlg_run_push
  ldx #30
sw_dlgwb_loop:
  lda <sw_dlgw_fill
  jsr sw_dlg_run_push
  dex
  bne sw_dlgwb_loop
  lda <sw_dlgw_edge
  jsr sw_dlg_run_push
  jmp vram_end

; ==========================================================================
; sw_dlg_close_row -- rebuild one 32-tile-wide tile row from terrain via
; sw_dlg_metatile, split-aware -- text_close_step's own metatile math
; (box-relative tile row 0-5 maps to metatile row (tile_row>>1)+BOX_MT_ROW,
; top/bottom half = tile_row&1), reusing sw_dlgw_edge as the metatile-column
; loop counter (0-15) -- safe because a border write and a close-row rebuild
; never run in the same transaction (opposite ends of the box's own
; open/close lifecycle).
; In: A = box-relative tile row (0-5). Clobbers A, X, Y, sw_dlgw_mtrow/half/
; edge, sw_dlg_metatile's own scratch.
; ==========================================================================
sw_dlg_close_row:
  tax
  and #1
  sta <sw_dlgw_half
  txa
  lsr a
  sta <sw_dlgw_mtrow
  txa
  ldx #0
  jsr sw_dlg_run_open
  lda #0
  sta <sw_dlgw_edge
sw_dlgcr_loop:
  lda <sw_dlgw_mtrow
  ldx <sw_dlgw_edge
  jsr sw_dlg_metatile
  tay
  lda <sw_dlgw_half
  bne sw_dlgcr_bottom
  lda mt_tl,y
  jsr sw_dlg_run_push
  lda mt_tr,y
  jsr sw_dlg_run_push
  jmp sw_dlgcr_next
sw_dlgcr_bottom:
  lda mt_bl,y
  jsr sw_dlg_run_push
  lda mt_br,y
  jsr sw_dlg_run_push
sw_dlgcr_next:
  inc <sw_dlgw_edge
  lda <sw_dlgw_edge
  cmp #16
  bne sw_dlgcr_loop
  jmp vram_end

; ==========================================================================
; sw_dlg_single -- one tile, through the mapper; a single byte can never
; straddle a seam, so no split bookkeeping is needed. In: A = box-relative
; tile row (0-5); X = box-relative tile column (0-31); the byte to write is
; already on the caller's own stack (the same pha/…/pla shape every ordinary
; single-tile site in engine/text.asm already uses around its own
; vram_open). Pulls it, pushes it, closes the packet.
; ==========================================================================
sw_dlg_single:
  jsr sw_dlg_tile_addr
  jsr vram_open
  pla
  jsr vram_push
  jmp vram_end

; ==========================================================================
; sw_dlg15_pending_step -- called once per frame from text_tick while
; sw_dlg15_state == SW_DLG15_PENDING (box_begin deferred this transaction's
; own open). Waits for the strip to go idle, then floors the camera to a
; 16px boundary (snapshotting the exact pre-nudge state for the un-nudge to
; restore verbatim, never re-derived) and opens the camera/OAM publication
; hold, then completes the deferred box_begin transition.
;
; X axis: cam_x_lo and sw_cam_origin_x_lo are always the same value
; (sw_camera_window_recompute writes both from sw_fc_px_lo, above) -- floored
; independently here anyway, for symmetry with the Y axis rather than
; leaning on that equality. Y axis: cam_y_lo = worldY mod 240 while
; sw_cam_origin_y_lo/hi is the full world-space value; 240 is itself a
; multiple of 16, so flooring each independently by AND #$F0 cannot
; disagree. Neither hi byte is ever touched by a floor (AND only clears
; bits, never borrows) -- saved and restored anyway, matching the design's
; own 4-byte x_lo/x_hi/y_lo/y_hi block rather than depending on that.
; ==========================================================================
sw_dlg15_pending_step:
  lda st_active
  bne sw_dlg15p_wait
  lda <cam_x_lo
  sta sw_dlg_cam_x_lo
  lda <cam_y_lo
  sta sw_dlg_cam_y_lo
  lda sw_cam_origin_x_lo
  sta <sw_dlg15_origin_x_lo
  lda sw_cam_origin_x_hi
  sta <sw_dlg15_origin_x_hi
  lda sw_cam_origin_y_lo
  sta <sw_dlg15_origin_y_lo
  lda sw_cam_origin_y_hi
  sta <sw_dlg15_origin_y_hi
  ; Fix round 1, finding A1: acquire the publication lock BEFORE the first
  ; store to a byte nmi_scroll/nmi_oam_guard actually read (cam_x_lo,
  ; sw_cam_origin_x/y_lo) -- an NMI landing between these stores must never
  ; see a torn floor. Unlike the shipped code this replaces, the lock is
  ; held only for this one mainline frame: OAM is rebuilt against the
  ; already-floored origin (below) before the lock is released, so the same
  ; NMI that first observes cam_dirty==0 finds the scroll write and the OAM
  ; DMA mutually consistent. The world itself stays motionless for the
  ; whole conversation by a completely different, pre-existing mechanism --
  ; game_state != ST_GAMEPLAY already keeps main_loop from ever calling
  ; update_player again (engine/boot.asm) once a box is up, so
  ; sw_frame_camera_window/sw_camera_window_recompute do not run again
  ; until the box closes. This lock is not what holds the camera still; it
  ; only brackets the two moments (nudge, un-nudge) the published camera
  ; actually changes.
  inc <cam_dirty
  lda <cam_x_lo
  and #$F0
  sta <cam_x_lo
  lda sw_cam_origin_x_lo
  and #$F0
  sta sw_cam_origin_x_lo
  lda <cam_y_lo
  and #$F0
  sta <cam_y_lo
  lda sw_cam_origin_y_lo
  and #$F0
  sta sw_cam_origin_y_lo
  ; Fix round 1, finding A2: capture this transaction's own terrain-restore
  ; origin now, the instant the camera has settled at its floored value --
  ; the only production call site sw_dlg_close_row's own sw_dlg_metatile
  ; call depends on.
  ; Fix round 1, finding A4: sw_dlg_lifecycle_open_start/_end brackets only
  ; this fix round's own new bytes (A1's rebuild-before-release call pair
  ; plus A2's origin capture) -- kept OUT of the pre-existing
  ; STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE span measurement and
  ; charged instead to its own STREAMWORLD_DIALOGUE_LIFECYCLE_KERNEL_HI_
  ; ALLOWANCE, per Chris's 2026-09-25 ruling not to fold lifecycle growth
  ; into the 7a mapper term.
sw_dlg_lifecycle_open_start:
  jsr sw_dlg_origin_capture
  ; Fix round 1, finding A1: rebuild the sprite shadow against the just-
  ; floored origin before the lock is released below -- otherwise the very
  ; next NMI could DMA a shadow still describing the pre-nudge camera while
  ; already publishing the floored scroll, the exact one-frame mismatch the
  ; walk/interact/open probe recorded. build_oam/draw_entities are already
  ; called unconditionally, every frame, from main_loop_draw
  ; (engine/boot.asm) right after this routine's own caller returns --
  ; calling them again there this same frame is redundant, not wrong (both
  ; are pure projections of state this routine does not otherwise touch),
  ; and is what makes it safe to publish before that second call runs.
  jsr build_oam
  jsr draw_entities
  ; the release itself is also new -- the pre-fix routine never decremented
  ; here at all, relying on sw_dlg17_camrelease's own dec to match an
  ; inc <cam_dirty this routine left standing across the whole conversation.
  dec <cam_dirty
sw_dlg_lifecycle_open_end:
  lda #1
  sta sw_dlg17_camhold
  lda #SW_DLG15_IDLE
  sta <sw_dlg15_state
  lda #BOX_OPENING
  sta <box_state
  rts
sw_dlg15p_wait:
  rts

; ==========================================================================
; sw_dlg17_camrelease -- called unconditionally, once per frame, from
; main_loop_idle (engine/boot.asm), regardless of game_state -- text_tick is
; not reached once close_ui has already run, so the drain-acknowledged
; release cannot live there. sw_dlg17_camhold makes the common case (no
; hold open, every ordinary frame of the whole game) a single cheap flag
; test.
; ==========================================================================
sw_dlg17_camrelease:
  lda sw_dlg17_camhold
  beq sw_dlg17cr_done
  lda <sw_dlg15_state
  cmp #SW_DLG15_DRAINING
  bne sw_dlg17cr_done
  lda <vram_ready
  bne sw_dlg17cr_done
  ; Fix round 1, finding A1: acquire before the first restore store, exactly
  ; as sw_dlg15_pending_step's own nudge does above -- this routine is
  ; polled from main_loop_idle (engine/boot.asm), AFTER this same frame's
  ; main_loop_draw already ran build_oam/draw_entities against the still-
  ; floored camera, so without a rebuild here the shadow DMA'd at the very
  ; next NMI would still describe the floored position even though that
  ; same NMI's scroll write already shows the restored one -- the
  ; observed one-frame, 14-pixel sprite pop. Restore the camera, rebuild
  ; OAM against it, THEN release: the matching pair publishes together.
  ; sw_dlg_lifecycle_close_a/_close_b bracket only this fix round's own new
  ; bytes (the fresh acquire, then the rebuild-before-release call pair) --
  ; the restore stores between them already existed before this fix round
  ; and stay counted in the pre-existing mapper span, not this new term. See
  ; sw_dlg_lifecycle_open_start's own comment above.
  ;
  ; Round 2, finding A1: draw_entities parks every remaining sprite
  ; (engine/entities.asm), which erases the action HUD's hearts that
  ; main_loop_draw's own earlier draw_hud call (engine/boot.asm) already drew
  ; this same frame -- this second, later rebuild must reproduce the whole
  ; applicable OAM composition main_loop_draw itself publishes
  ; (build_oam/draw_entities/draw_hud, in that order), not just the world
  ; projection, or the very next real DMA shows a heart-less HUD for one
  ; frame. Matches main_loop_draw's own !BATTLE_ENABLED gate exactly -- an
  ; RPG has no action HUD to preserve here (ui_tick's own battle overlay
  ; owns the shadow instead, the same reason main_loop_draw itself skips
  ; draw_hud there).
sw_dlg_lifecycle_close_a_start:
  inc <cam_dirty
sw_dlg_lifecycle_close_a_end:
  lda sw_dlg_cam_x_lo
  sta <cam_x_lo
  lda sw_dlg_cam_y_lo
  sta <cam_y_lo
  lda <sw_dlg15_origin_x_lo
  sta sw_cam_origin_x_lo
  lda <sw_dlg15_origin_x_hi
  sta sw_cam_origin_x_hi
  lda <sw_dlg15_origin_y_lo
  sta sw_cam_origin_y_lo
  lda <sw_dlg15_origin_y_hi
  sta sw_cam_origin_y_hi
sw_dlg_lifecycle_close_b_start:
  jsr build_oam
  jsr draw_entities
  .if !BATTLE_ENABLED
  jsr draw_hud
  .endif
sw_dlg_lifecycle_close_b_end:
  dec <cam_dirty
  lda #0
  sta sw_dlg17_camhold
  lda #SW_DLG15_IDLE
  sta <sw_dlg15_state
  jmp close_ui
sw_dlg17cr_done:
  rts

; ==========================================================================
; Fix round 1 (review round 1, finding A4): six text.asm call sites --
; text_open_row, text_open_attr, text_put_char, text_clear_step,
; text_choice_step, text_close_attr -- kept only a 7-byte kernel-lo dispatch
; (`lda <map_is_streamed / beq ordinary / jmp` here); this is where their
; bodies actually live now. Fix round 2 (review round 2, finding A4):
; finished the same relocation for the remaining six sites Chris's
; 2026-09-25 ruling also named -- box_begin, text_tick, text_arrow_write,
; choice_cursor, text_close_step, text_close_attr_tail -- so all thirteen
; kernel-lo call sites (the twelve in text.asm plus boot.asm's own
; camrelease_call) now hold only their own small dispatch. Each relocated
; body is byte-for-byte the guard body text.asm used to hold inline, only
; relocated -- every jmp back into text.asm targets the exact label the
; inline version fell through to (a bare conditional branch back to a
; text.asm label would be out of range from here -- CLAUDE.md's own "branches
; are +-128 bytes" trap -- so every one of these ends in a jmp, or, where the
; original body itself branched into two different distant continuations
; (sw_dlg_hi_text_tick, sw_dlg_hi_close_attr_tail), a short LOCAL branch to a
; second local label that then jmps). sw_dlg_relocated_start/_end brackets
; the combined span of all twelve -- STREAMWORLD_DIALOGUE_RELOCATED_KERNEL_HI_
; ALLOWANCE (main/build/generate.js), a THIRD term kept apart from both the
; 7a mapper allowance and this fix round's own lifecycle-hi allowance above,
; since it is neither: it is the kernel-lo bytes A4 moved, not new bytes A1/
; A2 added.
; ==========================================================================
sw_dlg_relocated_start:
sw_dlg_hi_open_row:
  lda <tmp
  sta <sw_dlgw_edge
  lda <tmp2
  sta <sw_dlgw_fill
  lda <box_row
  jsr sw_dlg_write_border
  jmp text_open_row_done

; Fix round 1 (A6): contract §7 (docs/design-streamed-worlds.md) requires six
; row frames PLUS THREE attribute frames -- one band per frame -- not all
; three bands queued in a single frame the way the pre-fix body here did.
; box_row already tracks exactly this: text_open_step keeps calling here on
; every frame box_row is >= BOX_ROWS_HIGH, so this routine reads the same
; register text_open_row_dispatch already reads to tell rows apart, and
; steps its OWN one band per call, `inc <box_row` (or `jmp box_handover`,
; which resets it to 0 itself) instead of the caller. sw_dlg_attr_precompute
; still runs exactly once, on the first of the three calls, per its own
; header requirement.
sw_dlg_hi_open_attr:
  lda <box_row
  cmp #BOX_ROWS_HIGH
  bne sw_dlg_hi_open_attr_1
  jsr sw_dlg_attr_precompute
  lda #0
  jsr sw_dlg_attr_open_band
  inc <box_row
  rts
sw_dlg_hi_open_attr_1:
  cmp #BOX_ROWS_HIGH+1
  bne sw_dlg_hi_open_attr_2
  lda #1
  jsr sw_dlg_attr_open_band
  inc <box_row
  rts
sw_dlg_hi_open_attr_2:
  lda #2
  jsr sw_dlg_attr_open_band
  inc <box_row
  jmp box_handover

sw_dlg_hi_put_char:
  lda <msg_line
  clc
  adc #1                    ; tile row 1-4 -- the four interior text rows
  pha
  lda <msg_col
  clc
  adc #2                    ; tile col 2-29 -- BOX_TEXT_LO's own col
  tax                       ; component (2), never overflowing 32
  pla
  jmp sw_dlg_single

sw_dlg_hi_clear_step:
  lda <box_row
  clc
  adc #1
  ldx #2
  jsr sw_dlg_run_open
  ldy #BOX_COLS
sw_dlg_hi_clear_loop:
  lda #TILE_SPACE
  jsr sw_dlg_run_push
  dey
  bne sw_dlg_hi_clear_loop
  jsr vram_end
  jmp text_clear_step_done

sw_dlg_hi_choice_step:
  lda <box_row
  clc
  adc #1
  ldx #2
  jsr sw_dlg_run_open
  lda #BOX_COLS
  sta <box_col
  ldy #0
sw_dlg_hi_choice_glyph:
  lda [msg_ptr_lo],y
  beq sw_dlg_hi_choice_drawn
  jsr sw_dlg_run_push       ; preserves Y, which is walking the label
  iny
  dec <box_col
  bne sw_dlg_hi_choice_glyph
sw_dlg_hi_choice_drawn:
  jsr vram_end
  jmp text_choice_blank

; Fix round 1 (A6): the close-side twin of sw_dlg_hi_open_attr's own fix
; above -- one band per frame, paced off the same box_row range
; text_close_step already dispatches through. sw_dlg_attr_close_band reuses
; sw_dlg_attr_precompute's open-time results (its own header: one precompute
; per open/close transaction), so no precompute call belongs here.
sw_dlg_hi_close_attr:
  lda <box_row
  cmp #BOX_ROWS_HIGH
  bne sw_dlg_hi_close_attr_1
  lda #0
  jsr sw_dlg_attr_close_band
  inc <box_row
  rts
sw_dlg_hi_close_attr_1:
  cmp #BOX_ROWS_HIGH+1
  bne sw_dlg_hi_close_attr_2
  lda #1
  jsr sw_dlg_attr_close_band
  inc <box_row
  rts
sw_dlg_hi_close_attr_2:
  lda #2
  jsr sw_dlg_attr_close_band
  inc <box_row
  jmp text_close_attr_tail

; Fix round 2 (review round 2, finding A4): the six remaining relocated
; bodies -- box_begin, text_tick, text_arrow_write, choice_cursor,
; text_close_step, text_close_attr_tail. Each is byte-for-byte the guard
; body text.asm used to hold inline.
sw_dlg_hi_box_begin:
  lda #SW_DLG15_PENDING     ; defer the open until sw_dlg15_pending_step's
  sta <sw_dlg15_state        ; own strip-idle wait and camera nudge run
  rts

; text_tick's own body branched to TWO different distant text.asm
; continuations depending on sw_dlg15_state (the ordinary fallthrough, or a
; tail call into sw_dlg15_pending_step) -- neither is reachable by a bare
; conditional branch from here, so the PENDING check itself stays a local
; branch (to a second local label, within range) and each of the two real
; destinations is reached by its own jmp.
sw_dlg_hi_text_tick:
  lda <sw_dlg15_state
  cmp #SW_DLG15_PENDING
  beq sw_dlg_hi_text_tick_pending
  jmp text_tick_ordinary    ; IDLE or DRAINING -- DRAINING's own completion
                            ; is main_loop_idle's sw_dlg17_camrelease, not
                            ; this per-tick dispatch; box_state is already 0
                            ; throughout both, so falling through here is
                            ; already exactly "waiting"
sw_dlg_hi_text_tick_pending:
  jmp sw_dlg15_pending_step  ; tail call -- its own rts answers for ours

sw_dlg_hi_arrow_write:
  lda #4                    ; ARROW_LO (158) -- fixed tile row 4, col 30
  ldx #30
  jmp sw_dlg_single

sw_dlg_hi_choice_cursor:
  lda <choice_sel
  clc
  adc #1                    ; tile row 1-4, same four rows text_put_char uses
  ldx #1                    ; the padding column, left of the text (BOX_TEXT_LO-1)
  jmp sw_dlg_single

sw_dlg_hi_close_step:
  lda <box_row
  jsr sw_dlg_close_row
  jmp text_close_step_done

; text_close_attr_tail's own body: a session that never engaged the streamed
; camera-hold (in-game naming's own raise never floors the camera -- it
; never goes through box_begin/sw_dlg15_pending_step at all) has nothing for
; sw_dlg17_camrelease to resolve later; close immediately, exactly as an
; ordinary (non-streamed) close already would. The camhold check's own
; false branch used to fall straight into text_close_attr_done -- out of
; range from here, so it goes through a local label first.
sw_dlg_hi_close_attr_tail:
  lda sw_dlg17_camhold
  beq sw_dlg_hi_close_attr_tail_done
  lda #SW_DLG15_DRAINING
  sta <sw_dlg15_state
  rts
sw_dlg_hi_close_attr_tail_done:
  jmp text_close_attr_done
sw_dlg_relocated_end:

  .endif
sw_dlg_mapper_end:
