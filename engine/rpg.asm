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
  ; Captured before the reset below clears it: NO_ENTITY here for a random or
  ; contact-damage fight, neither of which ever set talk_ent to begin with,
  ; or the entity slot whose event is mid-script and about to suspend on this
  ; battle. bt_owner_rec -- the record that slot was spawned from, not the
  ; slot itself -- is only meaningful when bt_owner_ent names a real one; it
  ; is what battle_end asks the field for again once the fight is over,
  ; because the slot is exactly what the redraw at the other end is free to
  ; reassign.
  lda talk_ent
  sta bt_owner_ent
  cmp #MAX_ENTITIES
  bcs battle_begin_no_owner
  tax
  lda ent_record,x
  sta bt_owner_rec
battle_begin_no_owner:
  lda #NO_ENTITY
  sta talk_ent
  rts

; Back to the field. The screen was never changed, so this is the ordinary
; redraw -- and the actor that started a touch encounter is cleared afterwards,
; because spawn_entities has just put it back.
;
; Coming back to a screen is not entering it, so the entry event spawn_entities
; just armed is put down again. Without this every battle replays whatever the
; screen says when the player walks in, which on a screen with a wandering
; monster is every few steps.
battle_end:
  lda #ST_GAMEPLAY
  sta game_state
  lda #0
  sta enc_step
  ; A status only means anything inside a battle, and battle_begin already
  ; clears every slot on the way in -- but leaving a won fight's poison
  ; sitting in pc_status until then is a byte that is stale rather than
  ; meaningful, the exact shape of trap CLAUDE.md's battle-statuses section
  ; warns about: harmless only for as long as nothing reads it between here
  ; and there, which stops being true the day a save record starts
  ; serializing this array. This routine is in the kernel, unlike most of the
  ; battle system (see the file header), so the four extra instructions are
  ; charged against KERNEL_CODE_BYTES rather than the 8 KB the battle bank
  ; rations -- worth it for making "never leaves a battle" true by
  ; construction instead of an invariant every future reader has to remember
  ; not to trust.
  ldx #0
battle_end_status:
  sta pc_status,x
  inx
  cpx #MAX_PARTY
  bne battle_end_status
  jsr redraw_screen
  lda #NO_ENTITY
  sta pending_ent
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
  ; redraw_screen's own spawn_entities has just cleared ent_touched for every
  ; slot on the screen, on the grounds that a screen arrives with nothing yet
  ; stood on. That is true even here, for most of the ways a battle can
  ; start: a random step (check_encounter) or an authored monster's contact
  ; damage (touch_encounter) both fire from inside update_player/
  ; update_entities on the very frame the touch happens, *before*
  ; settle_owed ever gets a chance to actually run that entity's own event --
  ; so if the entity the player is standing on also happens to carry a touch
  ; event of its own, arm_event only ever queued it; nothing has run yet, and
  ; latching ent_touched shut here would suppress it forever, not just for
  ; this frame.
  ;
  ; A scripted fight is different: OP_BATTLE is a command a page reaches only
  ; by already running, which means whatever touch armed this event has
  ; already been consumed by start_dialog -- but *only that one entity's*.
  ; The player can be standing on more than one touch-triggered actor at
  ; once (an entry event's own battle can start before an unrelated entity
  ; underfoot has had its first update_entities pass at all), so "a script
  ; is running" is not enough to say which of them may come back latched;
  ; only bt_owner_rec, the record battle_begin found in talk_ent, names the
  ; one whose event is actually suspended. Nothing else the player happens to
  ; be standing on gets touched here -- each of those never ran, and reads
  ; the same as any other screen that has just arrived.
  ;
  ; Restoring by the slot bt_owner_ent named before the fight cannot work
  ; either: the same respawn that cleared ent_touched can also hand that
  ; actor a different slot, or drop an earlier one and shift the rest down
  ; (see rpg.test.js's reshuffle test) -- which is exactly why bt_owner_rec
  ; is a record, not a slot, and this asks the field which slot that record
  ; landed in now rather than trusting the one it held before.
  ldx bt_owner_ent
  cpx #MAX_ENTITIES
  bcs battle_end_no_restore
  ldx #0
battle_end_owner_loop:
  lda ent_active,x
  beq battle_end_owner_next
  lda ent_record,x
  cmp bt_owner_rec
  bne battle_end_owner_next
  lda #1
  sta ent_touched,x
  ; The same slot X just resolved is who the resumed script's own MOVE_SELF/
  ; talk_ent checks (script_op_move, script_op_turn) need to see -- battle_begin
  ; sets talk_ent to NO_ENTITY unconditionally on the way in, and nothing
  ; between there and here ever put it back. Without this a Move or Turn
  ; targeting "self" right after a battle reads talk_ent as NO_ENTITY, takes
  ; its own defense-in-depth guard for a real one, and jmp script_finish's the
  ; whole rest of the page -- silently, the same actor still standing right
  ; here in X. stx, not restoring bt_owner_ent's own pre-battle value: this is
  ; exactly the "ask the field which slot the record landed in now" bt_owner_rec
  ; itself exists for, so talk_ent gets the *current* slot, not the one that
  ; may already have been reshuffled out from under it.
  stx talk_ent
  jmp battle_end_no_restore   ; records are unique per screen; nothing more to find
battle_end_owner_next:
  inx
  cpx #MAX_ENTITIES
  bne battle_end_owner_loop
battle_end_no_restore:
  lda #NO_ENTITY
  sta bt_owner_ent
  ; This has to run after every line above it, not before: pending_ent and
  ; ent_active are the redraw's own bookkeeping, settled before anything
  ; about the *script* is decided, so a resumed script is never confused
  ; with the entry event redraw_screen just armed and this already put down
  ; -- and never undoes it either, since script_resume cannot re-arm what
  ; pending_ent has already forgotten.
  lda script_active
  beq battle_end_gameplay
  ; The world has to stay frozen for whatever the script does next -- ST_DIALOG
  ; is the same state start_dialog itself sets, so if the next command is
  ; another Say, it draws over a field the player cannot walk around on rather
  ; than one still moving under it. script_resume's own ending, however many
  ; commands away that is, is what eventually sets ST_GAMEPLAY back -- the
  ; same close_ui every other conversation ends through.
  lda #ST_DIALOG
  sta game_state
  jmp script_resume
battle_end_gameplay:
  rts

; ---------------------------------------------------- the party's health

; pc_hp/pc_hp_max/pc_in_party are plain kernel RAM -- the battle bank writes
; them, but nothing about reading or saturating them needs the bank switched
; in, so the Heal/Damage commands touch them directly here rather than
; growing call_battle a fourth entry point. Both are the RPG side of
; combat.asm's gain_hearts/lose_hearts: the same saturating arithmetic, over
; every recruited slot instead of the one action-mode meter.

; A = HP to restore to every recruited party member, saturating at each
; member's own max -- and past zero, since Heal is the field's inn and an inn
; revives a fallen member the same way it tops off a standing one; there is
; no separate command for the difference. pc_status is left alone: nothing on
; the field can carry a status into this to begin with -- battle_begin and
; battle_end both clear it, so a status never survives outside a battle to be
; healed away here. See CLAUDE.md's battle statuses.
party_heal:
  sta bt_tmp
  ldx #0
party_heal_slot:
  lda pc_in_party,x
  beq party_heal_next
  lda pc_hp,x
  clc
  adc bt_tmp
  bcs party_heal_max         ; wrapped past 255: certainly over this member's max
  cmp pc_hp_max,x
  bcc party_heal_store
party_heal_max:
  lda pc_hp_max,x
party_heal_store:
  sta pc_hp,x
party_heal_next:
  inx
  cpx #MAX_PARTY
  bne party_heal_slot
  rts

; A = damage to deal to every recruited party member, saturating at 0.
; Returns with Z set when every recruited member is now at zero -- a field
; party wipe, which nothing checked for before this command existed;
; battle_finish is the only other place that asks the same question, over
; the same bytes, and the two must not disagree about what "everyone down"
; means. party_size guards an empty party (nobody joined yet) from reading as
; a wipe of nobody.
party_damage:
  sta bt_tmp
  lda party_size
  beq party_damage_none
  lda #0
  sta bt_tmp2                ; any recruited member still standing?
  ldx #0
party_damage_slot:
  lda pc_in_party,x
  beq party_damage_next
  lda pc_hp,x
  sec
  sbc bt_tmp
  bcs party_damage_store
  lda #0                     ; more damage than this member's hp left
party_damage_store:
  sta pc_hp,x
  beq party_damage_next
  lda #1
  sta bt_tmp2
party_damage_next:
  inx
  cpx #MAX_PARTY
  bne party_damage_slot
  lda bt_tmp2
  rts                        ; Z set: nobody recruited is left standing
party_damage_none:
  lda #1                     ; nothing to wipe -- not the Z-set answer
  rts

  .endif
