; player.asm -- movement, metatile collision, and edge transitions.

update_player:
  lda #0
  sta moving

  lda player_iframes
  beq update_player_knock
  dec player_iframes
update_player_knock:
  lda kb_timer
  beq update_player_input
  jsr knockback_step        ; thrown clear of whatever hit you: no pad this frame
  jmp update_player_anim

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
  sta probe_x
  lda player_y
  clc
  adc #BODY_T
  sta probe_y
  jsr probe_solid
  bne move_left_done
  lda player_y
  clc
  adc #BODY_B
  sta probe_y
  jsr probe_solid
  bne move_left_done
  lda new_pos
  sta player_x
  inc moving
move_left_done:
  rts

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
  sta probe_x
  lda player_y
  clc
  adc #BODY_T
  sta probe_y
  jsr probe_solid
  bne move_right_done
  lda player_y
  clc
  adc #BODY_B
  sta probe_y
  jsr probe_solid
  bne move_right_done
  lda new_pos
  sta player_x
  inc moving
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
  sta probe_y
  lda player_x
  clc
  adc #BODY_L
  sta probe_x
  jsr probe_solid
  bne move_up_done
  lda player_x
  clc
  adc #BODY_R
  sta probe_x
  jsr probe_solid
  bne move_up_done
  lda new_pos
  sta player_y
  inc moving
move_up_done:
  rts

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
  sta probe_y
  lda player_x
  clc
  adc #BODY_L
  sta probe_x
  jsr probe_solid
  bne move_down_done
  lda player_x
  clc
  adc #BODY_R
  sta probe_x
  jsr probe_solid
  bne move_down_done
  lda new_pos
  sta player_y
  inc moving
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
