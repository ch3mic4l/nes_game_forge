; input.asm -- standard controller 1 read.
;
; Shifting each read's bit 0 into the carry and rolling it left leaves
; A B Select Start Up Down Left Right in bits 7..0.

read_pad:
  lda pad
  sta pad_last

  lda #$01
  sta $4016
  lda #$00
  sta $4016

  ldx #8
read_pad_loop:
  lda $4016
  lsr a
  rol pad
  dex
  bne read_pad_loop

  lda pad                   ; buttons that went down this frame
  eor pad_last
  and pad
  sta pad_new
  rts

button_mask:
  .db BTN_A, BTN_B, BTN_SELECT, BTN_START

; --------------------------------------------------------------- actions
;
; Every button is looked up in the generated input_actions table, which the
; Controller Forge writes: NUM_BUTTONS entries per game state. Dash reads as
; held, everything else fires on the press.
;
; The state is a row of that table, so which actions a button can perform is
; decided by the row the dispatcher reads; whether the action means anything
; there is decided in do_action. An action with nothing to do in the current
; state is ignored rather than reinterpreted -- confirm during play does nothing,
; it does not attack.

dispatch_input:
  lda #0
  sta dash_on

  ldx #0
dispatch_loop:
  lda game_state
  asl a
  asl a                     ; state * NUM_BUTTONS
  stx tmp
  clc
  adc tmp
  tay
  lda input_actions,y
  sta tmp2

  cmp #ACT_DASH
  bne dispatch_pressed
  lda pad                   ; dash applies for as long as it is held
  and button_mask,x
  beq dispatch_next
  inc dash_on
  jmp dispatch_next

dispatch_pressed:
  lda pad_new
  and button_mask,x
  beq dispatch_next
  txa
  pha                       ; the handlers use X to walk the entity slots
  lda tmp2
  jsr do_action
  pla
  tax
  ; An action that drew a screen or decided a warp has taken the frame, and the
  ; buttons after it would be read against whatever it left behind: game_state is
  ; looked up again for every button, so Start on the title and interact pressed
  ; together would begin the game and then immediately talk to whatever the first
  ; screen spawned -- on a screen the player has not seen a frame of, and before
  ; the event that screen owes has been spoken.
  lda screen_fresh
  ora warp_ready
  bne dispatch_done

dispatch_next:
  inx
  cpx #NUM_BUTTONS
  bne dispatch_loop

dispatch_done:
  lda #PLAYER_SPEED
  ldy dash_on
  beq dispatch_speed
  asl a                     ; dashing doubles the walking speed
dispatch_speed:
  sta cur_speed
  rts

; A = the action bound to the button that was just pressed. Free to clobber X
; and Y: dispatch_loop saved its slot before calling.
;
; The chain is compares rather than a jump table because it runs at most four
; times a frame, and because a table would have to be kept in step with the
; ACTION order in shared/project.js in a second place.
do_action:
  cmp #ACT_ATTACK
  beq do_action_attack
  cmp #ACT_INTERACT
  beq do_action_interact
  cmp #ACT_ITEM
  beq do_action_item
  cmp #ACT_CONFIRM
  beq do_action_confirm
  cmp #ACT_CANCEL
  beq do_action_cancel
  cmp #ACT_PAUSE
  beq do_action_pause
do_action_none:
  rts

do_action_attack:
  lda game_state            ; the world is frozen behind a menu or a conversation
  bne do_action_none
  jmp do_attack

do_action_interact:
  lda game_state
  bne do_action_none
  jmp do_interact

do_action_item:
  lda game_state
  cmp #ST_MENU
  beq do_action_close       ; a second press puts the bag away
  cmp #ST_GAMEPLAY
  bne do_action_none        ; a conversation owns the buttons until it ends
  jmp open_menu

do_action_confirm:
  lda game_state
  cmp #ST_MENU
  beq do_action_use
  cmp #ST_DIALOG
  beq do_action_dialog
  .if TITLE_ENABLED
  cmp #ST_TITLE             ; the title row is bindable; Start stays hardwired
  bne do_action_confirm_done ; in title_tick as the backstop no binding removes
  jmp start_game
do_action_confirm_done:
  .endif
  rts
do_action_use:
  jmp use_item              ; the menu stays open, so a second item can be spent

do_action_cancel:
  lda game_state
  beq do_action_none        ; during play there is nothing to back out of
  cmp #ST_DIALOG
  beq do_action_dialog
do_action_close:
  jmp close_ui

; A press while a conversation is on screen. With a message box up the box
; decides what it means -- turn the page, or resume the event -- and a press
; mid-typewriter is ignored rather than skipping what is still being said.
; Without one there is nothing to advance, so the conversation just ends.
do_action_dialog:
  lda box_state
  beq do_action_close
  jmp text_advance

do_action_pause:
  lda paused                ; pause freezes the world in every state
  eor #1
  sta paused
  rts

; Take a hit off the nearest actor that is not a pickup, and beat it when that
; was its last one. An actor with one hit point behaves exactly as it did before
; there was any health at all, which is what keeps a project that never set an
; hp value playing the same way.
do_attack:
  ldx #0
do_attack_loop:
  lda ent_active,x
  beq do_attack_next
  ldy ent_actor,x
  lda actor_behavior,y
  cmp #BEH_PICKUP
  beq do_attack_next        ; pickups are collected, not defeated
  jsr entity_in_reach
  bne do_attack_next
  lda ent_hurt,x
  bne do_attack_done        ; still flashing from the last hit
  dec ent_hp,x              ; DEC sets the flags from the result, so this is
  beq do_attack_beaten      ; both the hit and the test for the last one
  lda #HURT_TIME
  sta ent_hurt,x
  rts
do_attack_beaten:
  lda #0
  sta ent_active,x
  inc defeated
do_attack_done:
  rts
do_attack_next:
  inx
  cpx #MAX_ENTITIES
  bne do_attack_loop
  rts

; Collect a nearby pickup without having to walk onto it, or -- if there is
; nothing to collect -- talk to whoever is in reach.
;
; Pickups are swept first rather than in one pass over the slots, so a slime
; standing between you and a gem cannot start a conversation instead of letting
; you collect: collecting keeps the priority it always had.
do_interact:
  ldx #0
do_interact_loop:
  lda ent_active,x
  beq do_interact_next
  ldy ent_actor,x
  lda actor_behavior,y
  cmp #BEH_PICKUP
  bne do_interact_next
  jsr entity_in_reach
  bne do_interact_next
  lda #0
  sta ent_active,x
  inc pickups
  lda ent_actor,x
  jmp add_item
do_interact_next:
  inx
  cpx #MAX_ENTITIES
  bne do_interact_loop

; Nothing to collect: the first actor in reach that is neither scenery nor a
; doorway starts a conversation, which is what puts the engine into ST_DIALOG.
do_talk:
  ldx #0
do_talk_loop:
  lda ent_active,x
  beq do_talk_next
  ldy ent_actor,x
  lda actor_behavior,y
  cmp #BEH_PICKUP
  beq do_talk_next
  cmp #BEH_DOOR
  beq do_talk_next          ; a door is walked through, not spoken to
  cmp #BEH_PLAYER
  beq do_talk_next
  ; What makes an event run is a choice, not a set: an actor whose event runs on
  ; touch or on arrival does not also answer the button. Without this an entry
  ; event -- a scene meant to happen once as the screen appears -- could be
  ; played again by walking up to whatever carried it and pressing interact.
  lda ent_trigger,x
  bne do_talk_next          ; TRIG_INTERACT is zero
  jsr entity_in_reach
  bne do_talk_next
  jmp start_dialog          ; X = the slot being spoken to
do_talk_next:
  inx
  cpx #MAX_ENTITIES
  bne do_talk_loop
  rts

; X = entity slot. Returns A = 0 (Z set) when the player is within reach.
; X is preserved so the callers can keep looping.
entity_in_reach:
  lda ent_x,x
  sec
  sbc player_x
  bcs entity_in_reach_dx
  eor #$FF                  ; absolute value
  clc
  adc #1
entity_in_reach_dx:
  cmp #REACH_RANGE
  bcs entity_in_reach_far
  lda ent_y,x
  sec
  sbc player_y
  bcs entity_in_reach_dy
  eor #$FF
  clc
  adc #1
entity_in_reach_dy:
  cmp #REACH_RANGE
  bcs entity_in_reach_far
  lda #0
  rts
entity_in_reach_far:
  lda #1
  rts
