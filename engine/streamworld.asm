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
; the callers below (sw_hazard_probe_cross's own tail -- the one every
; player step reaches, held and scripted alike) need an off-grid probe to be unconditionally solid, independent of
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
; The dx/dy normalization every player step shares (a scripted Move's own
; copy, sw_move_probe, was retired in phase 3a S3a once the Move took
; sw_pstep_* below), against sw_col/
; sw_row: sw_col/sw_row is the player's own CURRENT screen, the identity
; sw_locate_current/sw_enter_screen are built around and sw_cross_left/
; right/up/down keep live every frame. win_col_screen/win_row_screen is the
; camera WINDOW's own origin instead -- slice 4b's own sw_win_col_inc/dec
; (above) deliberately step it at most one block a frame, up to a whole
; screen's own lag behind sw_col/sw_row while the window arms, and phase 2
; slice "landing" made a landing's own window generally differ from the
; entered screen too -- reusing that tracker here would misresolve the
; target screen. (The Move's own probe used win_col_screen/win_row_screen
; until the "landing" fix exposed the same misresolution there; both probes
; agreed on sw_col/sw_row as "current screen" until that copy was retired.)
;
; This does not collapse the result to a solid/passable boolean --
; player_hazard needs the RAW mt_collision type (an exact COL_DAMAGE match,
; probe_type's own convention), a distinction a wall and a damage tile would
; otherwise lose; the collapse lives in sw_hazard_probe_solid below.
;
; In: <probe_x> = the raw candidate probe x, already 8-bit-wrapped by the
;     caller's own `adc #8`; <probe_y> = the raw candidate probe y (0-254,
;     never wraps). Y = 1 if the caller's own add that produced probe_x
;     carried past 255, 0 otherwise -- captured by the caller immediately
;     after that add (the convention every player probe here follows).
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
; wider than the MAX_X/MAX_Y wall the ordinary walk uses) plus a small BODY_* offset can overflow a
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
; Phase 3a S3a: a scripted player Move calls these too (entities.asm's
; move_tick) with sw_step_nocross raised, and each routine tests it at the
; one place it would take its crossing branch -- a step that would cross
; refuses exactly as a missing grid neighbour does, before any commit. That
; keeps the Move's ownership stop for S3a; S3b deletes the flag. Gated on
; MOVE_ENABLED: a streamed project with no Move assembles none of it.
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
  .if MOVE_ENABLED
  lda sw_step_nocross
  bne sw_pr_refuse
  .endif
  lda sw_col
  clc
  adc #1
  cmp sw_grid_w
  bcc sw_pr_gok
  .if MOVE_ENABLED
sw_pr_refuse:
  .endif
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
  .if MOVE_ENABLED
  lda sw_step_nocross
  bne sw_pl_refuse
  .endif
  lda sw_col
  bne sw_pl_gok
  .if MOVE_ENABLED
sw_pl_refuse:
  .endif
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
  .if MOVE_ENABLED
  lda sw_step_nocross
  bne sw_pd_refuse
  .endif
  lda sw_row
  clc
  adc #1
  cmp sw_grid_h
  bcc sw_pd_cok
  .if MOVE_ENABLED
sw_pd_refuse:
  .endif
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
  .if MOVE_ENABLED
  lda sw_step_nocross
  bne sw_pu_refuse
  .endif
  lda sw_row
  bne sw_pu_gok
  .if MOVE_ENABLED
sw_pu_refuse:
  .endif
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
; 256), but it needs no divide either: camPy is sw_row*240 + (player_y-112)
; before the clamp, so camScreenRow and camLocalPxY follow from player_y and
; sw_row directly (this row, or the row above; row 0 floors at 0,0; the last
; row's ceiling pins the local pixel at 0), and the desired window row follows
; from camLocalPxY>>4 the same way. The cost is the same at every row of every
; grid (S3a.5; the repeated-subtract loops this replaced cost ~45 cycles per
; world row, every frame). test/unit/streamworldcamera.test.js holds both the
; values (against an independent statement of the rule) and that flat cost.
;
; In: sw_row, sw_col, sw_grid_w, sw_grid_h, player_x, player_y.
; Out: sw_fc_desc/desl/desr/desrl = this call's own desired window origin
; (screen+local, per axis); also published, cam_dirty-bracketed: cam_x_lo,
; cam_y_lo, cam_nt, sw_cam_origin_x/y_lo/hi. Left behind for readers of the
; intermediates: sw_fc_px_lo/hi and sw_fc_py_lo/hi (the CLAMPED camPx/camPy --
; before S3a.5 the Y pair was destroyed into the /240 remainder), sw_fc_scr
; (camScreenRow), sw_fc_lpy (camLocalPxY), sw_fc_wy_lo/hi (worldY).
; Clobbers exactly: A, X, Y (the X half's `tay`), sw_tmp..sw_tmp6 and
; sw_fc_wy/px/py/scr/lpy/des*; the declared list is not wider than what the code
; writes. No caller reads sw_tmp* or sw_fc_py_* afterwards: sw_pjg_check and
; sw_oam_rowbase write the sw_tmp* bytes before reading them, and nothing outside
; this routine reads sw_fc_py_lo/hi, sw_fc_scr or sw_fc_lpy.
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
  sta sw_tmp                    ; stash bit0 across the Y half below (its own sw_tmp users)

  ; ---- camScreenRow = camPy/240, camLocalPxY = camPy mod 240; sw_cam_origin_y_lo/hi
  ; is the clamped camPy itself (sw_fc_py_lo/hi stays intact). ----
  lda sw_fc_py_lo
  sta sw_cam_origin_y_lo
  lda sw_fc_py_hi
  sta sw_cam_origin_y_hi
  ; No divide: the clamped camPy is sw_row*240 + (player_y-112), so camScreenRow/camLocalPxY follow from
  ; player_y directly -- player_y >= 112: this row, player_y-112 down it; player_y < 112: the row above,
  ; player_y+128 down it (the top row clamps to 0,0). The last row's ceiling pins the local pixel at 0
  ; (camPy = (gridH-1)*240). Constant cost, any row.
  lda <player_y
  cmp #112
  bcs sw_fcw_yo_ge
  ldx sw_row
  beq sw_fcw_yo_top
  dex
  stx sw_fc_scr
  clc
  adc #128
  sta sw_fc_lpy
  jmp sw_fcw_yo_done
sw_fcw_yo_top:
  lda #0                        ; row 0 floors camPy at 0
  sta sw_fc_scr
  sta sw_fc_lpy
  beq sw_fcw_yo_done
sw_fcw_yo_ge:
  sec
  sbc #112
  sta sw_fc_lpy
  lda sw_row
  sta sw_fc_scr
  lda sw_grid_h
  sec
  sbc #1
  cmp sw_row
  bne sw_fcw_yo_done
  lda #0
  sta sw_fc_lpy
sw_fcw_yo_done:
  lda sw_fc_lpy
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
  ; desiredBlockY = camBlockY-7, floored at 0, split into screenRow/localRow by
  ; 15; clamp. No divide: (camLocalPxY>>4) is 0..14, so the screenRow is
  ; camScreenRow or the row above (the top row floors at 0,0). ----
  lda sw_fc_lpy
  lsr a
  lsr a
  lsr a
  lsr a
  sec
  sbc #7
  bcs sw_fcw_blky_here          ; (lpy>>4) >= 7: this row, local = (lpy>>4)-7
  ldx sw_fc_scr
  beq sw_fcw_blky_floor
  clc
  adc #15                       ; the row above: local = (lpy>>4)-7+15
  tax
  ldy sw_fc_scr
  dey
  tya
  jmp sw_fcw_blky_clamp
sw_fcw_blky_floor:
  lda #0
  tax
  beq sw_fcw_blky_clamp
sw_fcw_blky_here:
  tax
  lda sw_fc_scr
sw_fcw_blky_clamp:
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

; ==========================================================================
; sw_save_resync -- phase 2 slice 9 (close-for-Save). save_media_commit's own
; tail (engine/save.asm) calls this instead of enable_rendering whenever
; map_is_streamed: enable_rendering hardcodes the scroll latch to 0,0, which
; is exactly wrong here -- the window never moved, only the flash chip was
; written, with rendering (and, unlike an ordinary mainline frame, NMI
; itself) off for the whole commit. This is sw_position_jump_guard's own
; redraw/OAM/DMA/scroll-publish tail, minus that routine's window-origin
; install (nothing moved, so win_col_screen/win_col_local/win_row_screen/
; win_row_local stay whatever they already were) and minus its cam_dirty
; bracket (save_media_commit's own php/sei plus genuinely-off NMI already
; make this transaction atomic to every other consumer; cam_dirty exists to
; protect against a torn read during a live frame's own NMI, which cannot
; run at all here). Nothing here touches vram_buf/vram_len/vram_ready --
; sw_render_window, like sw_position_jump_guard's own call to it, writes the
; nametables directly through $2006/$2007 while blanked, so whatever packet
; was mid-queue when save_media_commit's forced blank began is simply left
; untouched in RAM. It is NOT guaranteed to drain on the very first real NMI
; once this routine's own final $2001 write turns rendering back on -- it
; still waits for main_loop_ready to publish vram_ready exactly as any other
; queued packet would on an ordinary frame (fix round 1's own correction to
; an earlier, weaker claim here; see docs/reference-engine.md's own Flash-Save
; paragraph).
; ==========================================================================
sw_save_resync_start:
  .if SAVE_FLASH
sw_save_resync:
  jsr sw_render_window
  jsr build_oam
  jsr draw_entities
  .if !BATTLE_ENABLED
  jsr draw_hud
  .endif
  jsr draw_ui
  lda #$00
  sta $2003
  lda #$02
  sta $4014                  ; manual OAM DMA -- NMI is off for this whole
                              ; commit, so the ordinary per-vblank DMA the
                              ; nmi handler otherwise does never ran
  lda <cam_nt
  ora #PPUCTRL_ON
  sta $2000
  lda <cam_x_lo
  sta $2005
  lda <cam_y_lo
  sta $2005
  lda #PPUMASK_ON
  sta $2001
  rts
  .endif
sw_save_resync_end:

; sw_save_commit_tail -- fix 1 (B1 local win, round 1 review): save_media_
; commit's own resync-vs-ordinary dispatch (engine/save.asm), relocated from
; a kernel-lo branch to this 3-byte-call kernel-hi trampoline. Reached by
; jsr and must rts: save_media_commit's own php/sei bracket still needs its
; plp once this returns, so this cannot tail-jmp out the way sw_dlg20_
; pending_tick's own completion chain does. Its own span is bracketed
; separately from sw_save_resync_start..end just above, in its own `.if
; SAVE_FLASH` wrapper with the start/end labels outside it (the same
; sw_save_resync_start/end convention above), so the two terms never
; conflate a kernel-hi trampoline's cost with the redraw routine's own, and
; both can measure a true empirical 0 whenever SAVE_FLASH is false.
sw_save_commit_tail_start:
  .if SAVE_FLASH
sw_save_commit_tail:
  lda <map_is_streamed
  beq sw_save_commit_tail_ordinary
  jsr sw_save_resync
  rts
sw_save_commit_tail_ordinary:
  jsr enable_rendering
  rts
  .endif
sw_save_commit_tail_end:

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
; this). Clobbers A, X, Y and everything sw_camera_window_recompute does (its
; header), plus win_col_screen/local and win_row_screen/local, which it writes.
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
sw_win_arm_flash_guard:
  .if FLASH_ENABLED
  ; Phase 3a slice S1 (docs/reference-engine.md, "The row-arm guard keeps a row strip off a Flash
  ; publication body"): a row arm is skipped on a body carrying EITHER Flash publication (except a
  ; script Flash re-armed after flash_tick in a Flash-on body, see below). The restore:
  ; flash_tick sets FLASH_PENDING on the very frame it queues the 35-byte restore and the NEXT
  ; tick's flash_tick_confirm clears it. The Flash-on: flash_tick sees FLASH_ARM_VALUE, runs
  ; flash_apply_on (a 35-byte packet) and decrements, so this body -- and only this body, the next
  ; tick decrements again -- reaches here with FLASH_ARM_VALUE-1. (A script re-arm runs after
  ; flash_tick and is seen as FLASH_ARM_VALUE itself, which arms.) The row arm is skipped for that
  ; frame and nothing has advanced yet (the window origin is stepped only by sw_win_row_inc/dec,
  ; below), so a later frame recomputes the desired row and arms it. Each value is seen on one body
  ; per Flash, so a row is deferred at most twice per Flash cycle, never repeatedly. A column arm is
  ; decided above, before this point, and is not covered.
  lda <flash_left
  cmp #FLASH_PENDING
  beq sw_win_arm_done
  cmp #FLASH_ARM_VALUE-1
  beq sw_win_arm_done
  .endif
sw_win_arm_flash_guard_end:
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
  .if SW_DLG_BANKED
; ==========================================================================
; Phase 2 slice 10b -- the overlay lives in the battle bank (engine/streamdialog.asm,
; included from engine/battle.asm) for a project that would not otherwise fit its
; music+sfx+text in kernel-hi. What stays resident is this block: one shim per
; kernel-lo dispatch target, under the labels the text.asm/boot.asm sites already
; jump to, so kernel-lo is unchanged. Each shim is `A = BE_DLG_x; jmp call_battle`
; -- call_battle is the ONLY cross-bank call, and its `jmp set_screen_ptr` is the
; return. A shim that needs more than that says why beside it.
; sw_dlg_shim_start/_end bracket the block for
; STREAMWORLD_DIALOGUE_BANKED_KERNEL_HI_ALLOWANCE (main/build/generate.js).
; ==========================================================================
sw_dlg_shim_start:
sw_dlg_hi_open_row:
  lda #BE_DLG_OPEN_ROW
  jmp call_battle
sw_dlg_hi_open_attr:
  lda #BE_DLG_OPEN_ATTR
  jmp call_battle
sw_dlg_hi_clear_step:
  lda #BE_DLG_CLEAR_STEP
  jmp call_battle
sw_dlg_hi_choice_step:
  lda #BE_DLG_CHOICE_STEP
  jmp call_battle
sw_dlg_hi_close_attr:
  lda #BE_DLG_CLOSE_ATTR
  jmp call_battle
sw_dlg_hi_close_step:
  lda #BE_DLG_CLOSE_STEP
  jmp call_battle
sw_dlg_hi_close_attr_tail:
  lda #BE_DLG_CLOSE_TAIL
  jmp call_battle
sw_dlg_hi_box_begin:
  lda #BE_DLG_BOX_BEGIN
  jmp call_battle
; H4: text.asm's three single-tile sites `pha` the byte before dispatching; the
; stack cannot cross call_battle (the bank's own jsr frames sit on it), so it rides
; in bt_arg and the banked entry stub pushes it back for sw_dlg_single's pla.
sw_dlg_hi_put_char:
  pla
  sta <bt_arg
  lda #BE_DLG_PUT_CHAR
  jmp call_battle
sw_dlg_hi_arrow_write:
  pla
  sta <bt_arg
  lda #BE_DLG_ARROW
  jmp call_battle
sw_dlg_hi_choice_cursor:
  pla
  sta <bt_arg
  lda #BE_DLG_CURSOR
  jmp call_battle
; text_tick: only a PENDING frame needs the bank; every other frame (typing,
; opening, closing) is the resident text_tick_ordinary and pays no switch.
sw_dlg_hi_text_tick:
  lda <sw_dlg15_state
  cmp #SW_DLG15_PENDING
  bne sw_dlg_hi_text_tick_ordinary
  lda #BE_DLG_PENDING
  jmp call_battle
sw_dlg_hi_text_tick_ordinary:
  jmp text_tick_ordinary
; camrelease: polled every frame of the whole game from main_loop_idle, so the
; hold/state/vram_ready test is resident and a quiet frame is the same three
; loads it always was. Only a due release enters the bank; the deferred-Save /
; Move / close_ui decision after it is resident too (it reads kernel-hi state).
sw_dlg17_camrelease:
  lda sw_dlg17_camhold
  beq sw_dlg17cr_done
  lda <sw_dlg15_state
  cmp #SW_DLG15_DRAINING
  bne sw_dlg17cr_done
  lda <vram_ready
  bne sw_dlg17cr_done
  lda #BE_DLG_CAMRELEASE
  jsr call_battle
sw_dlg17cr_save_check_start:
  .if SAVE_FLASH
  lda sw_dlg20_save_pending
  beq sw_dlg17cr_no_save
  rts
sw_dlg17cr_no_save:
  .endif
sw_dlg17cr_save_check_end:
  .if MOVE_ENABLED
  jmp sw_dlg_closeformove_check
  .else
  jmp close_ui
  .endif
sw_dlg17cr_done:
  rts
; H2: the close path reads terrain through sw_terrain_or_fill, which moves the
; $8000 window to a screen bank. Banked overlay code must never run while the
; window holds one, so this resident routine does the read and puts BATTLE_BANK
; back through switch_prg_bank (never a direct mapper write) before it returns
; into the bank.
sw_dlg_terrain_read:
  jsr sw_terrain_or_fill
  pha
  lda #BATTLE_BANK
  jsr switch_prg_bank
  pla
  rts
sw_dlg_shim_end:
  .else
  .include "streamdialog.asm"
  .endif

; ==========================================================================
; sw_dlg_closeformove_check -- phase 2 slice 8. sw_dlg17_camrelease's own
; draw-down release (above) jmps here instead of close_ui whenever
; MOVE_ENABLED, and jmps straight to close_ui itself otherwise -- one 3-byte
; JMP absolute either way, so that call site costs the terrain-consumer span
; above nothing, on or off; this routine's own body is
; STREAMWORLD_CLOSEFORMOVE_KERNEL_HI_ALLOWANCE (main/build/generate.js),
; counted apart from it. If the draw-down ran because a scripted player
; Move suspended with the box still open (sw_dlg17_move_close,
; engine/ui.asm's own ui_tick_move_guard_start hands this frame to
; sw_dlg_cfm_guard below, which has the arming half), the
; conversation is NOT over: script_active, talk_ent and game_state must all
; survive so move_finish's own script_resume can find the suspended page
; again, so this returns directly instead of falling into close_ui -- the
; identical "advance before suspending, never call close_ui" shape
; close-for-Move's own arm already establishes. An ordinary close (this
; flag clear -- true end-of-event, or any close never provoked by a Move)
; falls through to the unmodified close_ui, byte-for-byte what every other
; streamed close already does.
; ==========================================================================
  .if MOVE_ENABLED
sw_dlg_closeformove_start:
sw_dlg_closeformove_check:
  lda sw_dlg17_move_close
  beq sw_dlg_closeformove_close_ui
  lda #0
  sta sw_dlg17_move_close
  rts
sw_dlg_closeformove_close_ui:
  jmp close_ui
sw_dlg_closeformove_end:

; ==========================================================================
; sw_dlg_cfm_guard -- phase 2 slice 8, review round 1 fix (finding
; B1's relocation ruling). engine/ui.asm's own ui_tick_move_guard_start tail-
; dispatches here (`jmp sw_dlg_cfm_guard`) instead of holding the
; whole arming guard inline, whenever STREAMING_ENABLED && TEXT_ENABLED
; (MOVE_ENABLED is this file's own outer gate, identical to
; sw_dlg_closeformove_check above) -- one 3-byte JMP absolute either way at
; that call site, replacing the unconditional `jmp move_tick` ui_tick has
; always ended with, so the low side costs nothing beyond what it already
; paid (STREAMWORLD_CLOSEFORMOVE_KERNEL_ALLOWANCE is 0 for exactly that
; reason). This routine's own body -- the entire guard, relocated whole --
; is STREAMWORLD_CLOSEFORMOVE_GUARD_KERNEL_HI_ALLOWANCE.
;
; Fix round 1, finding A1: docs/design-streamed-worlds.md's own contract
; (section 7) says the close-for-Move detector only ever arms for `mv_who
; != 0` reaching mv_left, i.e., the player -- an NPC's own scripted Move
; (mv_who == MOVE_SELF, talk_ent's own slot) carries no camera-tracking
; obligation and must tick exactly as it always has, box open or not (a
; Say(NPC) -> Move(self) -> Say(NPC) page, run entirely on the NPC's own
; conversation, must never touch the player's box at all). mv_who is
; checked FIRST, before the already-armed check: it is captured once by
; script_op_move and stays constant for the whole suspended Move, so an
; NPC Move skips this entire mechanism unconditionally, box open or not,
; exactly as an ordinary (non-streamed, or non-dialogue) Move already does.
; ==========================================================================
sw_dlg_cfm_guard_start:
sw_dlg_cfm_guard:
  lda <mv_who
  beq sw_dlg_cfm_guard_go     ; MOVE_SELF -- an NPC's own Move, unaffected
  lda sw_dlg17_move_close
  bne sw_dlg_cfm_guard_holding ; already armed -- this draw-down owns the frame
  lda <map_is_streamed
  beq sw_dlg_cfm_guard_go     ; ordinary map: nothing to close, unaffected
  lda <box_state
  beq sw_dlg_cfm_guard_go     ; box already closed: nothing to draw down
  lda #1
  sta sw_dlg17_move_close
  jsr box_close               ; box_row=0, box_state=BOX_CLOSING -- the same
                              ; transition an ordinary end-of-event close uses
sw_dlg_cfm_guard_holding:
  jmp ui_tick_state           ; hand this frame to the ordinary game_state
                              ; dispatch (text_tick) instead of move_tick
sw_dlg_cfm_guard_go:
  jmp move_tick
sw_dlg_cfm_guard_end:
  .endif

; ==========================================================================
; sw_dlg20_save_dispatch -- phase 2 slice 9 (close-for-Save). script_op_save
; (engine/save.asm) tail-dispatches here once it already knows map_is_
; streamed; this decides the rest. box_state alone answers "is a box
; genuinely open" here: it sits at 0 throughout both SW_DLG15_PENDING and
; SW_DLG15_DRAINING (text_close_attr_tail, engine/text.asm, sets it to
; BOX_CLOSED before sw_dlg_hi_close_attr_tail ever sets DRAINING; the open
; side is symmetric), so nonzero can only mean SW_DLG15_IDLE with a box
; actually up -- the one state script_op_save's own suspended-continuation
; reachability guarantees anyway (nothing calls script_resume/script_run
; while sw_dlg15_state is PENDING or DRAINING), making a second sw_dlg15_
; state check here redundant, not merely cheap to skip -- the same box_
; state-only test sw_dlg_cfm_guard above already relies on.
; ==========================================================================
sw_dlg20_save_dispatch_start:
  .if SAVE_FLASH
sw_dlg20_save_dispatch:
  lda <box_state
  beq sw_dlg20_save_immediate
  lda #1
  jsr script_skip              ; advance script_ptr past Save's own one-byte
                                ; opcode, exactly once -- script_next1's own
                                ; skip amount, taken here instead because the
                                ; immediate jmp script_run that follows it
                                ; there is exactly what must NOT happen on
                                ; this branch
  lda #1
  sta sw_dlg20_save_pending
  jsr box_close                 ; box_state is already known nonzero, so
                                ; box_close's own "never opened" branch can
                                ; never be taken from here
  rts                            ; suspended: script_active/script_ptr/
                                ; talk_ent/game_state all untouched, and
                                ; nothing on this path calls close_ui
sw_dlg20_save_immediate:
  jsr save_media_commit
  jmp script_next1

; sw_dlg20_save_check -- reached from sw_dlg20_pending_tick below (fix 1,
; via jsr, not jmp -- see that routine's own header) once it finds
; sw_dlg20_save_pending set and sw_dlg15_state back at SW_DLG15_IDLE. Tail-
; calls script_resume rather than jsr/rts: whatever that reaches (another
; Say, a Warp, script_finish's own close_ui) answers directly for
; sw_dlg20_pending_tick's own caller, exactly as an ordinary confirm-driven
; continuation already does from deeper inside text_tick -- jsr/jmp/…/rts is
; still one tail-call chain regardless of how many jmps sit inside it, since
; none of them touch the stack.
sw_dlg20_save_check:
  lda #0
  sta sw_dlg20_save_pending
  jsr save_media_commit         ; map_is_streamed is still set here -- its
                                ; own tail takes the resync branch, not
                                ; enable_rendering
  jmp script_resume

; sw_dlg20_pending_tick -- fix 1's single completion hook (B1's "one hook,
; not two"): engine/boot.asm's main_loop jsrs here, ahead of dispatch_input,
; on every pass where sw_dlg20_save_pending is set. Replaces the poll that
; used to open ui_tick (engine/ui.asm) -- moved here rather than duplicated,
; and now reached before input is dispatched at all rather than after, which
; is what round 1's finding A1 needed.
;
; box_state alone is NOT enough here, and neither is sw_dlg15_state alone:
; box_close (called by sw_dlg20_save_dispatch, above, the very same frame
; sw_dlg20_save_pending is armed) sets box_state to BOX_CLOSING immediately,
; but leaves sw_dlg15_state at SW_DLG15_IDLE for the whole multi-frame
; close-row/close-attr draw-down that follows -- it only becomes SW_DLG15_
; DRAINING (text_close_attr_tail's own final step, engine/text.asm, jumping
; to sw_dlg_hi_close_attr_tail) once that draw-down has already fully
; finished. A bare `sw_dlg15_state == IDLE` check would therefore read true
; on the ARM frame itself, firing the commit before the box has even started
; visibly closing. text_close_attr_tail is the ONLY place that ever restores
; box_state to BOX_CLOSED, so `box_state == BOX_CLOSED` is false for every
; frame of the real draw-down and only turns true exactly when it has
; finished -- requiring both this and sw_dlg15_state == IDLE is what makes
; this poll wait for the FULL sequence: box_state reaching BOX_CLOSED (the
; close animation itself finishing), THEN sw_dlg15_state cycling DRAINING ->
; IDLE (sw_dlg17_camrelease actually restoring the camera), never merely the
; first of the two.
;
; Returns A/Z: zero (Z set) while still closing or draining -- the caller
; falls through to the ordinary ui_tick chain, which is what lets text_tick
; keep ticking the close's own per-frame draw-down every frame until it is
; done. Nonzero (Z clear) once the real commit, resync and script_resume
; continuation have all run THIS frame -- the caller skips ui_tick too, the
; same "nothing else runs on the completion frame" rule the old poll's own
; tail-jmp-out-of-ui_tick already gave for free, now made explicit since this
; hook is reached from outside ui_tick entirely.
sw_dlg20_pending_tick:
  lda <box_state
  bne sw_dlg20_pending_tick_wait
  lda <sw_dlg15_state
  bne sw_dlg20_pending_tick_wait
  jsr sw_dlg20_save_check        ; jsr, not jmp: this routine must itself
                                ; return (with a nonzero A) to its own
                                ; caller, so the completion chain's own rts
                                ; (wherever script_resume's continuation
                                ; ends) lands right back here first
  lda #1                         ; nonzero: completed this frame
  rts
sw_dlg20_pending_tick_wait:
  lda #0                         ; zero: still closing/draining
  rts
  .endif
sw_dlg20_save_dispatch_end:

  .endif
sw_dlg_mapper_end:

; ==========================================================================
; B1 (phase 2 slice 9 fix round 1b, ROADMAP item 15): kernel-lo -> kernel-hi
; relocation. Every routine below used to live in a kernel-lo file (named in
; its own header) and is reached from there by a `jmp` or `jsr` that already
; cost the same whether the target was near or far -- so moving the BODY out
; costs nothing extra at the call site beyond what is noted per routine.
; ==========================================================================

; spawn_streamed -- relocated from engine/entities.asm (was directly after
; spawn_clear_dispatch's own `jmp spawn_streamed`, which is unchanged: a jmp
; costs the same 3 bytes at any distance). Phase 2 slice 2b. mtptr already
; points at the entered streamed screen's own STREAM_RECORD (sw_resolve_
; screen's own contract), so there is no esptr indirection to set up: the
; record is read in place. STREAM_ENTITY_FIELDS (shared/streamlayout.js) is
; deliberately the ordinary entity record's own field order, unchanged, so
; this loop's body is the identical actor/x/y/target/toX/toY/event/trigger/
; hideSwitch sequence spawn_any's own loop (entities.asm) reads -- only the
; cursor differs: a streamed record is STREAM_RECORD_BYTES (338) long, past
; any single Y, so sw_adv_offset (not a bare iny) crosses into mtptr_hi+1
; once the entity block's own offsets (STREAM_OFF_ENTITIES=241 onward) pass
; 255.
spawn_streamed:
  ldy #STREAM_OFF_ENTITY_COUNT
  lda [mtptr_lo],y
  bne spawn_streamed_any
  jmp spawn_streamed_done
spawn_streamed_any:
  sta <ent_tmp
  ldx #0
  lda #0
  sta <ent_spawn_rec
  ldy #STREAM_OFF_ENTITIES
spawn_streamed_loop:
  lda [mtptr_lo],y          ; actor id
  sta ent_actor,x
  jsr sw_adv_offset
  lda [mtptr_lo],y          ; x
  sta ent_x,x
  jsr sw_adv_offset
  lda [mtptr_lo],y          ; y
  sta ent_y,x
  jsr sw_adv_offset
  lda [mtptr_lo],y          ; door target -- a GLOBAL screen id already
  sta ent_to_scr,x
  jsr sw_adv_offset
  lda [mtptr_lo],y          ; door target x
  sta ent_to_x,x
  jsr sw_adv_offset
  lda [mtptr_lo],y          ; door target y
  sta ent_to_y,x
  jsr sw_adv_offset
  lda [mtptr_lo],y          ; the event it runs
  sta ent_event,x
  jsr sw_adv_offset
  lda [mtptr_lo],y          ; and what makes it run
  sta ent_trigger,x
  jsr sw_adv_offset
  lda [mtptr_lo],y          ; the switch that hides it once it is on
  jsr sw_adv_offset
  cmp #NO_SWITCH
  beq spawn_streamed_place
  jsr switch_test           ; preserves both X and Y
  bne spawn_streamed_next

spawn_streamed_place:
  lda #ENT_PRESENT
  sta ent_active,x
  lda <ent_spawn_rec
  sta ent_record,x
  sty <ent_tmp2
  ldy ent_actor,x
  lda actor_hp,y
  sta ent_hp,x
  ldy <ent_tmp2
  lda #DIR_DOWN
  sta ent_dir,x
  lda #0
  sta ent_frame,x
  sta ent_timer,x
  sta ent_hurt,x
  lda ent_trigger,x
  cmp #TRIG_ENTER
  bne spawn_streamed_armed
  jsr arm_event
spawn_streamed_armed:
  inx
  cpx #MAX_ENTITIES
  beq spawn_streamed_done
spawn_streamed_next:
  inc <ent_spawn_rec
  dec <ent_tmp
  beq spawn_streamed_done
  jmp spawn_streamed_loop
spawn_streamed_done:
  jsr sw_locate_current      ; sw_adv_offset may have left mtptr_hi past the
                              ; entered screen's own page 0 -- restore before
                              ; returning, the same rule sw_peek_byte/
                              ; sw_render_window's own tail already holds to
  rts
spawn_streamed_end:

; build_oam_draw_sw -- relocated from engine/oam.asm (was directly after
; build_oam_draw_dispatch's own `bne build_oam_draw_sw`, now a beq-then-jmp
; trampoline since a plain branch can no longer reach this far -- oam.asm's
; own comment). Phase 2 slice 4a (docs/design-streamed-worlds.md §7). The
; streamed-world counterpart of the ordinary player draw: the identical 4
; tiles (top-left/top-right/bottom-left/bottom-right), but each tile's own
; OAM position is independently projected against the camera's world-space
; origin (ruling 4: visibility is per 8x8 tile, not per metasprite origin --
; a streamed-screen player can reach player_x=255/player_y=239, per slice 3,
; so the right/bottom tiles of a 16x16 player near that edge sit past the
; window and must park, not wrap). X needs no multiply at all (a screen is
; exactly 256px wide, so local X IS world X's low byte and sw_col IS its
; high byte); Y needs sw_oam_project_y's own row*240 multiply.
;
; X = the tile-table index ((dir*2+frame)*4) computed by the caller
; (oam.asm's build_oam_draw), stashed across the corner loop (which clobbers
; X as sw_oam_rowbase's own loop counter) in sw_tmp5 -- the one byte
; sw_project_axis's clobber list leaves free, safe here because sw_goto
; (oam.asm's other user of sw_tmp5) never runs concurrently with an OAM
; build (both mainline-only).
build_oam_draw_sw:
  stx sw_tmp5
  ldy #0
build_oam_draw_sw_loop:
  lda <player_x
  clc
  adc sw_oam_corner_xoff,y
  jsr sw_oam_project_x
  sta <tmp
  lda #0
  rol a
  sta <tmp2                  ; X-hidden flag (0/1)

  lda <player_y
  clc
  adc sw_oam_corner_yoff,y
  jsr sw_oam_project_y
  sta sw_tmp6                ; Y byte, stashed -- free again once
                              ; sw_oam_project_y has returned
  lda #0
  rol a
  ora <tmp2
  bne build_oam_draw_sw_park

  ldx sw_oam_corner_oam,y
  lda sw_tmp6
  sta OAM,x
  tya
  clc
  adc sw_tmp5
  tax
  lda player_tiles,x
  ldx sw_oam_corner_oam,y
  sta OAM+1,x
  lda player_pal
  sta OAM+2,x
  lda <tmp
  sta OAM+3,x
  jmp build_oam_draw_sw_next

build_oam_draw_sw_park:
  ldx sw_oam_corner_oam,y
  lda #$FF
  sta OAM,x
build_oam_draw_sw_next:
  iny
  cpy #4
  bne build_oam_draw_sw_loop

  lda #16
  sta <oam_idx
  rts

sw_oam_corner_xoff: .db 0, 8, 0, 8   ; TL, TR, BL, BR
sw_oam_corner_yoff: .db 0, 0, 8, 8
sw_oam_corner_oam:  .db 0, 4, 8, 12
build_oam_draw_sw_end:

; draw_one_entity_show_sw -- relocated from engine/entities.asm (was
; directly after draw_one_entity_show's own dispatch, reached the same way
; build_oam_draw_sw was: a bne that fix round 1b converted to a beq-then-jmp
; trampoline since a plain branch can no longer reach this far). docs/
; design-streamed-worlds.md §7 (phase 2 slice 4a, ruling 3/4): project each
; of the metasprite's own TILES independently, the same per-corner mechanism
; build_oam_draw_sw uses for the player, rather than projecting only the
; origin and handing off to the shared draw_metasprite -- that routine's own
; +de_ex/+de_ey adds wrap into 8-bit OAM coordinates instead of parking, and
; ui.asm's inventory row/dialogue portrait and battleui.asm still call
; draw_metasprite directly and must stay untouched (unlike the player's
; fixed 16x16, an entity's placement (shared/project.js normalizeEntity) is
; not bounded by the MAX_X/MAX_Y movement wall, and a metasprite's own
; per-tile offsets are legal across the full signed -128..127 range, so
; origin-only projection is not enough -- phase 2 slice 4a round 1 review,
; finding 2).
;
; This duplicates draw_one_entity_animate's own NO_ANIM/metasprite-id lookup
; (rather than jumping into it) because that lookup needs X to still be the
; entity slot, and only after it completes is X safe to spend on the
; projection calls below (finding 1 of the same review: an earlier version
; read ent_x,x AFTER a call that leaves X=0, silently drawing every
; non-slot-0 entity at slot 0's own X).
  .if STREAM_PROJ_ENABLED

; Phase 3a slice S1 (docs/reference-engine.md, "The streamed entity projection"): the same
; routine, replaced when the project places an actor on a streamed screen
; (STREAM_PROJ_ENABLED) by one that classifies the ACTOR once instead of testing every tile.
; Every class leaves all 256 bytes of OAM and oam_idx exactly as the per-tile routine below
; does (test/unit/streamproj.test.js, whole-shadow oracle):
;   cull     -- the base's high byte is neither $00 nor $FF, so no tile of any admitted
;               metasprite can land on screen: every tile's Y is parked ($FF), oam_idx advances.
;   inside   -- SW_UXMIN..SW_UYMAX (generated from the real art of every actor placed on a
;               streamed map, offset + 128) prove every tile lands 0..255 / 0..239: no
;               per-tile range test.
;   straddle -- the unbiased 16-bit test per tile, decided on the unbiased Y and only then
;               decremented for OAM (the shipped order: at Y = 0 the tile is drawn with a Y
;               byte of $FF).
; sw_ent_setup, called once per draw_entities, folds the screen's origin and the -128 that
; turns a signed tile offset into an unsigned one into sw_cx0/sw_cy0; the per-actor base is
; then two 16-bit adds.
sw_ent_setup:
  lda <map_is_streamed
  beq sw_ent_setup_done
  lda #$80
  sec
  sbc sw_cam_origin_x_lo
  sta <sw_cx0_lo
  lda sw_col
  sbc sw_cam_origin_x_hi
  sta <sw_cx0_hi
  dec <sw_cx0_hi
  lda sw_row
  jsr sw_oam_rowbase
  lda sw_tmp
  sec
  sbc sw_cam_origin_y_lo
  sta <sw_cy0_lo
  lda sw_tmp2
  sbc sw_cam_origin_y_hi
  sta <sw_cy0_hi
  lda <sw_cy0_lo
  sec
  sbc #$80
  sta <sw_cy0_lo
  lda <sw_cy0_hi
  sbc #0
  sta <sw_cy0_hi
sw_ent_setup_done:
  rts

draw_one_entity_show_sw:
  jsr entity_animation
  cmp #NO_ANIM
  bne dsw_have_anim
  jmp draw_one_entity_none
dsw_have_anim:
  tay
  lda anim_ptr_lo,y
  sta <ptr_lo
  lda anim_ptr_hi,y
  sta <ptr_hi
  lda ent_frame,x
  asl a
  tay
  lda [ptr_lo],y
  tay
  lda ms_count,y
  bne dsw_have_count
  jmp draw_one_entity_none
dsw_have_count:
  sta <de_left
  lda ms_ptr_lo,y
  sta <msptr_lo
  lda ms_ptr_hi,y
  sta <msptr_hi
  lda <sw_cx0_lo
  clc
  adc ent_x,x
  sta <sw_dxb_lo
  lda <sw_cx0_hi
  adc #0
  sta <sw_dxb_hi
  lda <sw_cy0_lo
  clc
  adc ent_y,x
  sta <sw_dyb_lo
  lda <sw_cy0_hi
  adc #0
  sta sw_tmp2
  txa
  pha
  ; --- cull: a base hi byte outside {$00,$FF} puts every tile off screen
  lda <sw_dxb_hi
  clc
  adc #1
  cmp #2
  bcs dsw_cull
  lda sw_tmp2
  clc
  adc #1
  cmp #2
  bcs dsw_cull
  ; --- inside: every tile of every pose lands 0..255 / 0..239
  lda <sw_dxb_lo
  clc
  adc #SW_UXMIN
  lda <sw_dxb_hi
  adc #0
  bmi dsw_straddle
  lda <sw_dxb_lo
  clc
  adc #SW_UXMAX
  lda <sw_dxb_hi
  adc #0
  bne dsw_straddle
  lda <sw_dyb_lo
  clc
  adc #SW_UYMIN
  lda sw_tmp2
  adc #0
  bmi dsw_straddle
  lda <sw_dyb_lo
  clc
  adc #SW_UYMAX
  sta sw_tmp
  lda sw_tmp2
  adc #0
  bne dsw_straddle
  lda sw_tmp
  cmp #240
  bcs dsw_straddle
  ; ----- inside class: no range test per tile
  dec <sw_dyb_lo
  ldx <oam_idx
  ldy #0
dsw_in_tile:
  lda [msptr_lo],y
  eor #$80
  clc
  adc <sw_dyb_lo
  sta OAM,x
  iny
  lda [msptr_lo],y
  sta OAM+1,x
  iny
  lda [msptr_lo],y
  sta OAM+2,x
  iny
  lda [msptr_lo],y
  eor #$80
  clc
  adc <sw_dxb_lo
  sta OAM+3,x
  iny
  inx
  inx
  inx
  inx
  beq dsw_done
  dec <de_left
  bne dsw_in_tile
dsw_done:
  stx <oam_idx
  pla
  tax
  rts
  ; ----- cull class: park every tile
dsw_cull:
  ldx <oam_idx
  lda #$FF
dsw_cull_tile:
  sta OAM,x
  inx
  inx
  inx
  inx
  beq dsw_done
  dec <de_left
  bne dsw_cull_tile
  jmp dsw_done
  ; ----- straddle class: unbiased range test per tile, then -1
dsw_straddle:
  ldx <oam_idx
  ldy #0
dsw_st_tile:
  lda [msptr_lo],y
  eor #$80
  clc
  adc <sw_dyb_lo
  sta sw_tmp
  lda sw_tmp2
  adc #0
  sta sw_tmp3
  iny
  lda [msptr_lo],y
  sta sw_tmp4
  iny
  lda [msptr_lo],y
  sta sw_tmp5
  iny
  lda [msptr_lo],y
  iny
  eor #$80
  clc
  adc <sw_dxb_lo
  sta sw_tmp6
  lda <sw_dxb_hi
  adc #0
  ora sw_tmp3
  bne dsw_st_park
  lda sw_tmp
  cmp #240
  bcs dsw_st_park
  adc #$FF
  sta OAM,x
  lda sw_tmp4
  sta OAM+1,x
  lda sw_tmp5
  sta OAM+2,x
  lda sw_tmp6
  sta OAM+3,x
  jmp dsw_st_next
dsw_st_park:
  lda #$FF
  sta OAM,x
dsw_st_next:
  inx
  inx
  inx
  inx
  beq dsw_done
  dec <de_left
  bne dsw_st_tile
  jmp dsw_done

  .else
draw_one_entity_show_sw:
  lda ent_x,x
  sta <de_ex                 ; entity's own BASE LOCAL x/y for the whole
  lda ent_y,x                ; tile loop below -- not a projected OAM byte,
  sta <de_ey                 ; unlike the non-streamed de_ex/de_ey above
  jsr entity_animation
  cmp #NO_ANIM
  bne draw_one_entity_sw_have_anim  ; X still the entity slot here -- safe
  jmp draw_one_entity_none          ; early out (jmp: bne's own +-128 range
                                     ; can't reach draw_one_entity_none from
                                     ; inside the streamed tile loop below)
draw_one_entity_sw_have_anim:
  tay
  lda anim_ptr_lo,y
  sta <ptr_lo
  lda anim_ptr_hi,y
  sta <ptr_hi
  lda ent_frame,x
  asl a
  tay
  lda [ptr_lo],y              ; metasprite id for this frame
  tay
  lda ms_count,y
  bne draw_one_entity_sw_have_count ; X still the entity slot here too
  jmp draw_one_entity_none
draw_one_entity_sw_have_count:
  sta <de_left
  lda ms_ptr_lo,y
  sta <msptr_lo
  lda ms_ptr_hi,y
  sta <msptr_hi

  txa
  pha                          ; entity slot -- everything below (the row
                                ; multiply, both per-tile projections)
                                ; clobbers X freely; restored once at the
                                ; very end for draw_entities_loop's own inx

  lda sw_row
  jsr sw_oam_rowbase            ; rowBase16 = sw_row*240, multiplied ONCE
                                 ; for the whole tile loop -- sw_oam_project_
                                 ; tile_y's own header explains why a per-
                                 ; tile re-multiply of a wrapped row would
                                 ; silently be wrong (docs/reference-engine.md)
  lda sw_tmp
  sta <tmp
  lda sw_tmp2
  sta <tmp2

  ldy #0
draw_one_entity_sw_tile:
  lda [msptr_lo],y             ; y offset
  jsr sw_oam_project_tile_y
  sta sw_tmp5                   ; OAM Y byte, stashed across the X
                                 ; projection below the same way
                                 ; build_oam_draw_sw stashes its own tile
                                 ; index (oam.asm) -- sw_project_axis's own
                                 ; clobber list leaves this one byte free
  lda #0
  rol a
  sta <ent_tmp                  ; Y-hidden flag (0/1)
  iny
  lda [msptr_lo],y              ; tile
  pha
  iny
  lda [msptr_lo],y              ; attributes
  pha
  iny
  lda [msptr_lo],y              ; x offset
  iny
  jsr sw_oam_project_tile_x
  sta <ent_tmp2                  ; OAM X byte
  lda #0
  rol a
  ora <ent_tmp
  bne draw_one_entity_sw_tile_park

  ldx <oam_idx
  lda sw_tmp5
  sta OAM,x
  pla
  sta OAM+2,x                    ; attributes (pushed last, popped first)
  pla
  sta OAM+1,x                    ; tile (pushed first, popped second)
  lda <ent_tmp2
  sta OAM+3,x
  jmp draw_one_entity_sw_tile_next

draw_one_entity_sw_tile_park:
  pla
  pla
  ldx <oam_idx
  lda #$FF
  sta OAM,x

draw_one_entity_sw_tile_next:
  txa
  clc
  adc #4
  sta <oam_idx
  beq draw_one_entity_sw_done    ; wrapped past the 64th sprite
  dec <de_left
  bne draw_one_entity_sw_tile

draw_one_entity_sw_done:
  pla
  tax
  rts
  .endif
draw_one_entity_show_sw_end:

; sw_redraw_screen_landing -- relocated from engine/screens.asm's
; redraw_screen (was directly after redraw_screen_dispatch's own
; `beq redraw_screen_ordinary`); engine/boot.asm's own byte-identical
; cold-boot copy of the same dispatch now calls this same routine instead
; of carrying a second copy. B1 (phase 2 slice 9 fix round 1b). Both call
; sites `jsr` here and then take their own tail (screens.asm: `rts`;
; boot.asm: `jmp boot_draw_done`) -- this routine itself always `rts`s.
;
; F3 (phase 2 slice 2b fix round 1): a streamed landing must not inherit the
; previous OWNER screen's active bound-tile cache -- rebuild_bound_cache
; itself already takes the empty-cache branch whenever map_is_streamed is
; set, so simply calling it here reuses that single definition rather than
; duplicating the guard. enable_rendering's own $2005 write is hardcoded
; (0,0) -- not used here, the same reason design-camera.md's
; redraw_screen_slide/camera_slide_complete_b write their own $2000/$2005
; sequence instead of calling it, for a landing whose own scroll is not
; (0,0).
sw_redraw_screen_landing:
  jsr sw_render_window
  .if BOUND_TILE_ENABLED
  jsr rebuild_bound_cache
  .endif
  jsr spawn_entities
  jsr build_oam
  jsr draw_entities
  jsr wait_vblank_poll
  lda <cam_nt
  ora #PPUCTRL_ON
  sta $2000
  lda <cam_x_lo
  sta $2005
  lda <cam_y_lo
  sta $2005
  lda #PPUMASK_ON
  sta $2001
  rts
sw_redraw_screen_landing_end:
