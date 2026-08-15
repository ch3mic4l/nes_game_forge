; entities.asm -- spawning, behaviour and drawing for the actors placed in the
; Map Forge. Eight slots, refilled from the screen's actor list every time a
; screen is drawn, so leaving and re-entering a screen resets it.

spawn_entities:
  lda #0
  ldx #MAX_ENTITIES-1
spawn_clear:
  sta ent_active,x
  sta ent_touched,x         ; a screen arrives with nothing stood on
  dex
  bpl spawn_clear
  lda #NO_ENTITY            ; ...and owing nothing, until a record says otherwise
  sta pending_ent
  lda #1                    ; the rest of this frame is not the new screen's
  sta screen_fresh

  ldy flat_screen
  lda screen_ent_lo,y
  sta esptr_lo
  lda screen_ent_hi,y
  sta esptr_hi

  ldy #0
  lda [esptr_lo],y          ; how many actors this screen places
  bne spawn_any             ; inverted into a jump: the record loop between here
  jmp spawn_done            ; and spawn_done is past a branch's 128-byte reach
spawn_any:
  sta ent_tmp
  ldx #0
  iny                       ; step past the count byte
; A record is read into the slot before it is known whether it belongs there: the
; slot is only marked active once the hide switch has had its say, so a hidden
; actor leaves the slot free for the next record rather than consuming one.
spawn_loop:
  lda [esptr_lo],y          ; actor id
  sta ent_actor,x
  iny
  lda [esptr_lo],y          ; x
  sta ent_x,x
  iny
  lda [esptr_lo],y          ; y
  sta ent_y,x
  iny
  lda [esptr_lo],y          ; door target screen
  sta ent_to_scr,x
  iny
  lda [esptr_lo],y          ; door target x
  sta ent_to_x,x
  iny
  lda [esptr_lo],y          ; door target y
  sta ent_to_y,x
  iny
  lda [esptr_lo],y          ; the event it runs
  sta ent_event,x
  iny
  lda [esptr_lo],y          ; and what makes it run
  sta ent_trigger,x
  iny
  lda [esptr_lo],y          ; the switch that hides it once it is on
  iny
  cmp #NO_SWITCH
  beq spawn_place
  jsr switch_test           ; preserves both X and Y, which is the whole reason
  bne spawn_next            ; switch_split exists

spawn_place:
  lda #1
  sta ent_active,x
  sty ent_tmp2              ; the record cursor, which the actor lookup needs Y for
  ldy ent_actor,x
  lda actor_hp,y
  sta ent_hp,x
  ldy ent_tmp2
  lda #DIR_DOWN
  sta ent_dir,x
  lda #0
  sta ent_frame,x
  sta ent_timer,x
  sta ent_hurt,x
  ; An actor that runs its event on arrival: remembered for the main loop, and
  ; only the first one on the screen. Two events both claiming the moment the
  ; screen appears is a question with no good answer, so the answer is the one
  ; the Map Forge lists first -- and the editor says so rather than leaving it
  ; to be discovered.
  ; Y is the record cursor here and stays that way: arm_event needs no index
  ; register, so it has none to give back.
  lda ent_trigger,x
  cmp #TRIG_ENTER
  bne spawn_armed
  jsr arm_event
spawn_armed:
  inx
  cpx #MAX_ENTITIES
  beq spawn_done            ; every slot is full; the rest of the list is over
spawn_next:
  dec ent_tmp
  beq spawn_done
  jmp spawn_loop            ; the top of the record is out of a branch's reach
spawn_done:
  rts

; ------------------------------------------------------------- behaviour

update_entities:
  ldx #0
update_entities_loop:
  lda ent_active,x
  beq update_entities_next
  lda ent_hurt,x
  beq update_entities_behave
  dec ent_hurt,x            ; the flash after being struck
update_entities_behave:
  ldy ent_actor,x
  lda actor_behavior,y
  cmp #BEH_PATROL
  bne update_entities_chase
  jsr entity_patrol
  jmp update_entities_anim
update_entities_chase:
  cmp #BEH_CHASE
  bne update_entities_pickup
  jsr entity_chase
  jmp update_entities_anim
update_entities_pickup:
  cmp #BEH_PICKUP
  bne update_entities_door
  jsr entity_pickup
  lda ent_active,x          ; a collected pickup stops animating
  beq update_entities_next
  jmp update_entities_anim
update_entities_door:
  cmp #BEH_DOOR
  bne update_entities_anim
  jsr entity_door
update_entities_anim:
  jsr entity_animate
  ; After the actor has moved, so an actor that walked into the player counts as
  ; much as a player who walked into it. The same goes for a touch trigger.
  jsr entity_contact
  jsr entity_trigger_touch
update_entities_next:
  inx
  cpx #MAX_ENTITIES
  bne update_entities_loop
  rts

; Walk in a straight line, reversing at a wall or the screen edge.
; The entity slot stays in X throughout; probe_solid preserves it.
entity_patrol:
  ldy ent_actor,x
  lda actor_speed,y
  sta ent_tmp

  lda ent_dir,x
  cmp #DIR_LEFT
  bcs entity_patrol_horizontal

  cmp #DIR_UP
  beq entity_patrol_up
  lda ent_y,x               ; down
  clc
  adc ent_tmp
  cmp #MAX_Y+1
  bcs entity_turn
  sta ent_tmp2
  clc
  adc #BODY_B
  sta probe_y
  jmp entity_patrol_probe_v
entity_patrol_up:
  lda ent_y,x
  sec
  sbc ent_tmp
  bcc entity_turn
  sta ent_tmp2
  clc
  adc #BODY_T
  sta probe_y
entity_patrol_probe_v:
  lda ent_x,x
  clc
  adc #BODY_L
  sta probe_x
  jsr probe_solid
  bne entity_turn
  lda ent_tmp2
  sta ent_y,x
  rts

entity_patrol_horizontal:
  cmp #DIR_LEFT
  beq entity_patrol_left
  lda ent_x,x               ; right
  clc
  adc ent_tmp
  cmp #MAX_X+1
  bcs entity_turn
  sta ent_tmp2
  clc
  adc #BODY_R
  sta probe_x
  jmp entity_patrol_probe_h
entity_patrol_left:
  lda ent_x,x
  sec
  sbc ent_tmp
  bcc entity_turn
  sta ent_tmp2
  clc
  adc #BODY_L
  sta probe_x
entity_patrol_probe_h:
  lda ent_y,x
  clc
  adc #BODY_B
  sta probe_y
  jsr probe_solid
  bne entity_turn
  lda ent_tmp2
  sta ent_x,x
  rts

entity_turn:
  lda ent_dir,x             ; down<->up and left<->right differ in bit 0
  eor #1
  sta ent_dir,x
  rts

; Step towards the player on each axis independently, so walls deflect rather
; than stop the chase.
entity_chase:
  ldy ent_actor,x
  lda actor_speed,y
  sta ent_tmp

  ; Face the axis the player is furthest away on. Deciding this once, before
  ; moving, is what makes the Sprite Forge's sideways animation reachable:
  ; setting the facing inside each movement branch let the second branch
  ; overwrite the first, so a chaser only ever faced up or down.
  lda player_x
  sec
  sbc ent_x,x
  bcs entity_chase_dx
  eor #$FF
  clc
  adc #1
entity_chase_dx:
  sta chase_dx
  lda player_y
  sec
  sbc ent_y,x
  bcs entity_chase_dy
  eor #$FF
  clc
  adc #1
entity_chase_dy:
  sta chase_dy
  cmp chase_dx              ; A still holds the vertical distance
  bcc entity_chase_face_side

  lda player_y
  cmp ent_y,x
  bcc entity_chase_face_up
  lda #DIR_DOWN
  sta ent_dir,x
  jmp entity_chase_horizontal
entity_chase_face_up:
  lda #DIR_UP
  sta ent_dir,x
  jmp entity_chase_horizontal

entity_chase_face_side:
  lda player_x
  cmp ent_x,x
  bcc entity_chase_face_left
  lda #DIR_RIGHT
  sta ent_dir,x
  jmp entity_chase_horizontal
entity_chase_face_left:
  lda #DIR_LEFT
  sta ent_dir,x

entity_chase_horizontal:
  lda player_x
  cmp ent_x,x
  beq entity_chase_vertical
  bcs entity_chase_right
  lda ent_x,x               ; player is to the left
  sec
  sbc ent_tmp
  bcc entity_chase_vertical
  sta ent_tmp2
  clc
  adc #BODY_L
  sta probe_x
  jmp entity_chase_probe_h
entity_chase_right:
  lda ent_x,x
  clc
  adc ent_tmp
  cmp #MAX_X+1
  bcs entity_chase_vertical
  sta ent_tmp2
  clc
  adc #BODY_R
  sta probe_x
entity_chase_probe_h:
  lda ent_y,x
  clc
  adc #BODY_B
  sta probe_y
  jsr probe_solid
  bne entity_chase_vertical
  lda ent_tmp2
  sta ent_x,x

entity_chase_vertical:
  lda player_y
  cmp ent_y,x
  beq entity_chase_done
  bcs entity_chase_down
  lda ent_y,x               ; player is above
  sec
  sbc ent_tmp
  bcc entity_chase_done
  sta ent_tmp2
  clc
  adc #BODY_T
  sta probe_y
  jmp entity_chase_probe_v
entity_chase_down:
  lda ent_y,x
  clc
  adc ent_tmp
  cmp #MAX_Y+1
  bcs entity_chase_done
  sta ent_tmp2
  clc
  adc #BODY_B
  sta probe_y
entity_chase_probe_v:
  lda ent_x,x
  clc
  adc #BODY_L
  sta probe_x
  jsr probe_solid
  bne entity_chase_done
  lda ent_tmp2
  sta ent_y,x
entity_chase_done:
  rts

; Vanish when the player walks into it, and go into the bag the menu shows.
entity_pickup:
  jsr entity_touching_player
  bne entity_pickup_done
  lda #0
  sta ent_active,x
  inc pickups
  lda ent_actor,x
  jsr add_item
entity_pickup_done:
  rts

; Walking into a door queues a move. The transition itself is deferred to the
; main loop: redrawing here would call spawn_entities and clear the very array
; update_entities is walking.
entity_door:
  jsr entity_touching_player
  bne entity_door_done
  lda #1
  sta warp_ready
  lda ent_to_scr,x
  sta warp_scr
  lda ent_to_x,x
  sta warp_x
  lda ent_to_y,x
  sta warp_y
entity_door_done:
  rts

; X = slot. The frame owes this actor's event, unless it already owes one.
;
; First claim wins, and it has to: crossing a screen edge redraws from inside
; update_player, so a screen's entry event is armed and then the same frame walks
; the entity loop on that new screen -- where a touch would otherwise take the
; moment the screen had already claimed. An actor with nothing to say never
; claims it at all.
arm_event:
  lda ent_event,x
  cmp #NO_EVENT
  beq arm_event_done
  lda pending_ent
  cmp #NO_ENTITY
  bne arm_event_done        ; something already owns this frame
  stx pending_ent
arm_event_done:
  rts

; An actor whose event runs when the player walks into it rather than when they
; ask. X = slot, and entity_touching_player preserves it.
;
; It arms rather than starts, because this runs inside a loop that is still
; walking the other seven slots: starting here would leave the pickups, doors and
; contact damage below it to act on a world that had just been frozen, and a door
; on the same square would redraw the screen out from under the conversation. So
; the loop finishes, the frame's warp is settled, and main_loop starts it.
;
; The actor has to be *walked off* before it can fire again. The conversation ends
; with the player standing exactly where they were when it started, so without
; ent_touched the next frame starts it over, and keeps starting it over for as
; long as the player stands there.
entity_trigger_touch:
  lda ent_trigger,x
  cmp #TRIG_TOUCH
  bne entity_trigger_done
  jsr entity_touching_player
  beq entity_trigger_on
  lda #0                    ; walked off it: armed again
  sta ent_touched,x
  rts
entity_trigger_on:
  lda ent_touched,x
  bne entity_trigger_done   ; still standing where it last fired
  lda #1
  sta ent_touched,x
  jmp arm_event
entity_trigger_done:
  rts

; X = slot. A = 0 (Z set) when the player overlaps this actor.
entity_touching_player:
  lda ent_x,x
  sec
  sbc player_x
  bcs entity_touching_dx
  eor #$FF
  clc
  adc #1
entity_touching_dx:
  cmp #TOUCH_RANGE
  bcs entity_touching_far
  lda ent_y,x
  sec
  sbc player_y
  bcs entity_touching_dy
  eor #$FF
  clc
  adc #1
entity_touching_dy:
  cmp #TOUCH_RANGE
  bcs entity_touching_far
  lda #0
  rts
entity_touching_far:
  lda #1
  rts

; The animation an actor uses right now, chosen by which way it faces.
; Returns A = animation id, or NO_ANIM. Preserves X.
entity_animation:
  lda ent_actor,x
  asl a
  asl a                     ; four animations per actor
  sta ent_tmp
  lda ent_dir,x
  clc
  adc ent_tmp
  tay
  lda actor_anim_dir,y
  rts

; Advance the actor's animation. Frame records are (metasprite, duration).
entity_animate:
  jsr entity_animation
  cmp #NO_ANIM
  beq entity_animate_done
  tay
  lda anim_count,y
  sta ent_tmp2
  lda anim_ptr_lo,y
  sta ptr_lo
  lda anim_ptr_hi,y
  sta ptr_hi

  ; Turning can swap in a shorter animation, so bring the frame back in range
  ; before anything indexes it.
  lda ent_frame,x
  cmp ent_tmp2
  bcc entity_animate_in_range
  lda #0
  sta ent_frame,x
  sta ent_timer,x
entity_animate_in_range:
  lda ent_tmp2
  cmp #2
  bcc entity_animate_done   ; a single frame never advances

  inc ent_timer,x
  lda ent_frame,x
  asl a
  tay
  iny                       ; duration byte of the current frame
  lda [ptr_lo],y
  cmp ent_timer,x
  bcs entity_animate_done   ; not time to advance yet
  lda #0
  sta ent_timer,x
  inc ent_frame,x
  lda ent_frame,x
  cmp ent_tmp2
  bcc entity_animate_done
  lda #0
  sta ent_frame,x
entity_animate_done:
  rts

; ---------------------------------------------------------------- drawing

; Appends to the sprite shadow after build_oam has placed the player, then
; parks every sprite slot that is left over.
draw_entities:
  ldx #0
draw_entities_loop:
  lda ent_active,x
  beq draw_entities_next
  jsr draw_one_entity
draw_entities_next:
  inx
  cpx #MAX_ENTITIES
  bne draw_entities_loop

  ldy oam_idx
  beq draw_entities_done    ; the shadow is completely full
draw_entities_park:
  lda #$FF                  ; reloaded every pass: the four INYs below do not
  sta OAM,y                 ; touch A, but keeping it here is what makes that
  iny                       ; safe to rely on
  iny
  iny
  iny
  bne draw_entities_park
draw_entities_done:
  rts

draw_one_entity:
  lda ent_hurt,x            ; a struck actor flashes, which is the only feedback
  beq draw_one_entity_show  ; there is that a hit landed on something with more
  and #$02                  ; than one hit point in it
  bne draw_one_entity_none
draw_one_entity_show:
  lda ent_y,x               ; OAM Y sits one scanline above the sprite
  sec
  sbc #1
  sta de_ey
  lda ent_x,x
  sta de_ex

  jsr entity_animation
  cmp #NO_ANIM
  beq draw_one_entity_none
  tay
  lda anim_ptr_lo,y
  sta ptr_lo
  lda anim_ptr_hi,y
  sta ptr_hi
  lda ent_frame,x
  asl a
  tay
  lda [ptr_lo],y            ; metasprite for this frame
  jmp draw_metasprite
draw_one_entity_none:
  rts

; A = metasprite id, drawn at de_ex/de_ey. Split out of draw_one_entity because
; the inventory row and the dialogue portrait in ui.asm draw the same art without
; an entity slot behind it. Preserves X.
draw_metasprite:
  tay
  lda ms_count,y
  beq draw_metasprite_done
  sta de_left
  lda ms_ptr_lo,y
  sta msptr_lo
  lda ms_ptr_hi,y
  sta msptr_hi

  txa
  pha                       ; free X up for the sprite shadow index
  ldy #0
draw_metasprite_tile:
  ldx oam_idx
  lda [msptr_lo],y          ; y offset
  clc
  adc de_ey
  sta OAM,x
  iny
  lda [msptr_lo],y          ; tile
  sta OAM+1,x
  iny
  lda [msptr_lo],y          ; attributes
  sta OAM+2,x
  iny
  lda [msptr_lo],y          ; x offset
  clc
  adc de_ex
  sta OAM+3,x
  iny
  txa
  clc
  adc #4
  sta oam_idx
  beq draw_metasprite_full  ; wrapped past the 64th sprite
  dec de_left
  bne draw_metasprite_tile
draw_metasprite_full:
  pla
  tax
draw_metasprite_done:
  rts
