; player.asm -- movement, metatile collision, and edge transitions.

update_player:
  lda #0
  sta moving

  ; player_iframes counts down here regardless of which health model this
  ; build has: an action game's own invincible window, and an RPG's cooldown
  ; on its Damage-metatile hazard (player_hazard, engine/combat.asm) -- see
  ; that routine's own header for why reusing this byte is what keeps a
  ; standing player from being drained once a frame.
  lda player_iframes
  beq update_player_knock
  dec player_iframes
update_player_knock:
  .if !BATTLE_ENABLED
  lda kb_timer
  beq update_player_input
  jsr knockback_step        ; thrown clear of whatever hit you: no pad this frame
  jmp update_player_anim
  .endif

update_player_input:
  lda pad
  and #BTN_LEFT
  beq update_player_right
  jsr move_left
  jmp update_player_vertical
update_player_right:
  lda pad
  and #BTN_RIGHT
  beq update_player_vertical
  jsr move_right

; Crossing an edge does not unwind this routine: move_left and its three
; siblings reach cross_* with a jmp, and cross_* ends in redraw_screen, whose
; rts lands back here with a different screen underneath the player. Everything
; after that point would be spent on a screen that has only just spawned its
; actors and has not yet had the turn it is owed -- a second axis of movement
; against its collision, a heart to its spikes, a step towards its wandering
; monsters. So the frame stops here instead. main_loop clears screen_fresh
; before calling this, and stops as well.
update_player_vertical:
  lda screen_fresh
  bne update_player_crossed
  lda pad
  and #BTN_UP
  beq update_player_down
  jsr move_up
  jmp update_player_anim
update_player_down:
  lda pad
  and #BTN_DOWN
  beq update_player_anim
  jsr move_down

update_player_anim:
  lda screen_fresh
  bne update_player_crossed
  jsr player_hazard         ; after moving, so stepping onto a spike costs a heart
  .if BATTLE_ENABLED
  ; A lethal hit already ended the game (player_hazard's own jmp player_died,
  ; engine/combat.asm) -- an encounter reaching its threshold on the very same
  ; step must not then overwrite ST_GAMEOVER with ST_BATTLE, so this stops the
  ; frame exactly as a screen edge or a fresh screen already does above.
  lda game_state
  bne update_player_crossed
  jsr check_encounter       ; ...and wandering monsters count the steps
  .endif
  lda moving
  beq update_player_stand
  inc anim_timer
  lda anim_timer
  cmp #ANIM_RATE
  bcc update_player_done
  lda #0
  sta anim_timer
  lda anim_frame
  eor #1
  sta anim_frame
  rts
update_player_stand:
  lda #0
  sta anim_frame
  sta anim_timer
update_player_done:
update_player_crossed:
  rts

; ------------------------------------------------------------- directions

; The two axes probe the player's body at both corners leading the move and
; commit new_pos into the moved coordinate -- identical in shape between
; left/right and between up/down, differing only in which corner offset and
; which coordinate is written. move_horizontal_probe / move_vertical_probe
; are that shared tail; each _inside label sets up new_pos and the first
; probe coordinate, then falls into its axis's tail with a jmp (not jsr) so
; the tail's own rts returns to whichever caller originally jsr'd move_left
; et al. -- the stack is exactly as it would be if each routine still ended
; with its own rts. probe_solid returns with Z describing A-COL_DAMAGE, not
; A itself (see its own header), so the bne here after jsr probe_solid must
; keep meaning "blocked" without any register touched in between.
;
; move_right_inside and move_down_inside jmp to a tail label on the very
; next line -- a plain fallthrough would reclaim those 3 bytes each (6
; total). Left as jmp, deliberately: the bank has 74 free bytes, so 6 more is
; not the difference between fitting and not, and a fallthrough would make
; physical adjacency load-bearing and invisible -- inserting anything between
; move_down_inside and move_vertical_probe would silently break move_down
; with no assembler error, where all four entry routines ending the same
; explicit way cannot be silently broken by that kind of edit.

move_left:
  lda #DIR_LEFT
  sta player_dir
  lda player_x
  cmp cur_speed
  bcs move_left_inside
  jmp cross_left            ; already against the edge: change screen
move_left_inside:
  sec
  sbc cur_speed
  sta new_pos
  clc
  adc #BODY_L
  jmp move_horizontal_probe

move_right:
  lda #DIR_RIGHT
  sta player_dir
  lda player_x
  clc
  adc cur_speed
  sta new_pos
  cmp #MAX_X+1
  bcc move_right_inside
  jmp cross_right
move_right_inside:
  lda new_pos
  clc
  adc #BODY_R
  jmp move_horizontal_probe

; A = the probe point's x (already offset by BODY_L or BODY_R). new_pos is
; the candidate player_x a caller has already stored.
move_horizontal_probe:
  sta probe_x
  lda player_y
  clc
  adc #BODY_T
  sta probe_y
  jsr probe_solid
  bne move_horizontal_done
  lda player_y
  clc
  adc #BODY_B
  sta probe_y
  jsr probe_solid
  bne move_horizontal_done
  lda new_pos
  sta player_x
  inc moving
; move_left_done / move_right_done: kept as aliases on this same address (no
; bytes emitted) rather than deleted -- a Code Forge user file is free to
; reference a stock engine label, and these two existed before the dedup.
; Still semantically honest: this is the same rts reached in the same
; circumstances the old move_left_inside/move_right_inside ended in.
move_horizontal_done:
move_left_done:
move_right_done:
  rts

move_up:
  lda #DIR_UP
  sta player_dir
  lda player_y
  cmp cur_speed
  bcs move_up_inside
  jmp cross_up
move_up_inside:
  sec
  sbc cur_speed
  sta new_pos
  clc
  adc #BODY_T
  jmp move_vertical_probe

move_down:
  lda #DIR_DOWN
  sta player_dir
  lda player_y
  clc
  adc cur_speed
  sta new_pos
  cmp #MAX_Y+1
  bcc move_down_inside
  jmp cross_down
move_down_inside:
  lda new_pos
  clc
  adc #BODY_B
  jmp move_vertical_probe

; A = the probe point's y (already offset by BODY_T or BODY_B). new_pos is
; the candidate player_y a caller has already stored.
move_vertical_probe:
  sta probe_y
  lda player_x
  clc
  adc #BODY_L
  sta probe_x
  jsr probe_solid
  bne move_vertical_done
  lda player_x
  clc
  adc #BODY_R
  sta probe_x
  jsr probe_solid
  bne move_vertical_done
  lda new_pos
  sta player_y
  inc moving
; move_up_done / move_down_done: the same aliasing move_horizontal_done makes
; above, for the same reason.
move_vertical_done:
move_up_done:
move_down_done:
  rts

; ------------------------------------------------------------- collision

; probe_x / probe_y -> A = the metatile's collision type.
; The metatile index is (y & $F0) + (x >> 4) because a screen is 16 metatiles
; wide, so the row stride and the metatile size are the same 16.
probe_type:
  lda probe_y
  and #$F0
  sta tmp
  lda probe_x
  lsr a
  lsr a
  lsr a
  lsr a
  clc
  adc tmp
  tay
  lda [mtptr_lo],y
  tay
  lda mt_collision,y
  rts

; probe_x / probe_y -> A = 0 when passable, nonzero when blocked.
probe_solid:
  jsr probe_type
  cmp #COL_DAMAGE           ; open, solid and water block; damage and warp are
  bcc probe_solid_done      ; walked through, and dealt with elsewhere
  lda #0
probe_solid_done:
  cmp #0                    ; callers branch on Z, which the range test above
  rts                       ; left describing A-COL_DAMAGE rather than A itself

; ------------------------------------------------------- screen transitions

cross_left:
  ldy flat_screen
  lda screen_left,y
  cmp #NO_SCREEN
  beq cross_none
  sta flat_screen
  lda #MAX_X
  sta player_x
  jmp redraw_screen

cross_right:
  ldy flat_screen
  lda screen_right,y
  cmp #NO_SCREEN
  beq cross_none
  sta flat_screen
  lda #0
  sta player_x
  jmp redraw_screen

cross_up:
  ldy flat_screen
  lda screen_up,y
  cmp #NO_SCREEN
  beq cross_none
  sta flat_screen
  lda #MAX_Y
  sta player_y
  jmp redraw_screen

cross_down:
  ldy flat_screen
  lda screen_down,y
  cmp #NO_SCREEN
  beq cross_none
  sta flat_screen
  lda #0
  sta player_y
  jmp redraw_screen

cross_none:
  rts
