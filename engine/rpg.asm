; rpg.asm -- the kernel's half of the battle system.
;
; Only the parts that have to be permanently mapped live here: the random number
; generator (the encounter roll happens during gameplay), the step counter that
; fires a wandering monster, and the routine that assembles a formation and hands
; over to the bank. Everything else is in engine/battle.asm, on the other side of
; call_battle.

  .if BATTLE_ENABLED

; An 8-bit Galois LFSR. Advanced once per frame *and* once per roll, so the
; result depends on when the player walked as well as how far -- which is what
; makes a random encounter feel random rather than metronomic.
rng_next:
  lda rng
  bne rng_shift
  lda #$A5                  ; a zero state would be a fixed point
rng_shift:
  asl a
  bcc rng_store
  eor #$71
rng_store:
  sta rng
  rts

; Called from update_player once the player has actually moved. The counter is
; per step rather than per frame, so walking speed does not change the encounter
; rate -- dashing covers ground faster, it does not fight more often.
check_encounter:
  lda moving
  beq check_encounter_done
  jsr rng_next
  ldy flat_screen
  lda screen_map,y
  tay
  lda map_enc_rate,y
  beq check_encounter_done  ; this map has no wandering monsters
  sta bt_tmp
  inc enc_step
  lda enc_step
  cmp bt_tmp
  bcc check_encounter_done
  lda #0
  sta enc_step
  ; A formation from this map's encounter list, one to four of them.
  jsr rng_next
  and #3
  sta bt_tmp2
  lda #1
  sta bt_esc                ; a wandering monster can be run from
  jmp start_encounter
check_encounter_done:
  rts

; X = the entity slot walked into. An authored monster on the map is a fight you
; cannot walk away from, which is what makes placing one mean something.
touch_encounter:
  stx bt_from_ent
  lda #0
  sta bt_esc
  lda ent_actor,x
  sta mon_slot_actor
  lda #$FF
  sta mon_slot_actor+1
  sta mon_slot_actor+2
  sta mon_slot_actor+3
  jmp battle_begin

; bt_tmp2 = how many of this map's encounter slots to take, minus one.
start_encounter:
  lda #NO_ENTITY
  sta bt_from_ent
  ldy flat_screen
  lda screen_map,y
  asl a
  asl a                     ; four formation slots per map
  sta bt_tmp
  ldx #0
start_encounter_slot:
  lda #$FF
  sta mon_slot_actor,x
  cpx bt_tmp2
  bcs start_encounter_next  ; past the number this roll chose
  txa
  clc
  adc bt_tmp
  tay
  lda map_enc_actors,y
  sta mon_slot_actor,x
start_encounter_next:
  inx
  cpx #MAX_MONSTERS
  bne start_encounter_slot
  lda mon_slot_actor
  cmp #$FF
  beq start_encounter_none  ; the map lists a rate but no monsters
  jmp battle_begin
start_encounter_none:
  rts

; Freeze the world and hand over. The bank draws its own screen on the first
; tick, under forced blank, exactly as redraw_screen does for the field.
battle_begin:
  lda #ST_BATTLE
  sta game_state
  lda #BP_INTRO
  sta bt_phase
  lda #0
  sta bt_flee
  sta bt_round
  sta bt_sel
  sta bt_scroll
  sta box_state
  sta bt_ptick
  sta bt_tgt_vis            ; no targeting cursor until a target phase shows one
  ; A status only means anything inside a battle, so every battle starts clean;
  ; the monsters' side is reset in setup_monsters when the slots are filled.
  ldx #0
battle_begin_status:
  sta pc_status,x
  inx
  cpx #MAX_PARTY
  bne battle_begin_status
  lda #NO_ENTITY
  sta talk_ent
  rts

; Back to the field. The screen was never changed, so this is the ordinary
; redraw -- and the actor that started a touch encounter is cleared afterwards,
; because spawn_entities has just put it back.
battle_end:
  lda #ST_GAMEPLAY
  sta game_state
  lda #0
  sta enc_step
  jsr redraw_screen
  ldx bt_from_ent
  cpx #MAX_ENTITIES
  bcs battle_end_done
  lda bt_flee
  bne battle_end_done       ; running away leaves it standing there
  lda #0
  sta ent_active,x
battle_end_done:
  lda #NO_ENTITY
  sta bt_from_ent
  rts

  .endif
