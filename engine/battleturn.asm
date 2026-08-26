; battleturn.asm -- turn order, actions, and how a battle ends.
;
; Part of the banked battle system; see engine/battle.asm for the bank rules.
;
; Combatants are one index space -- 0-3 party, 4-7 monsters -- so `turn_order`
; is one list, targeting is one routine, and "is this one still standing" is one
; question rather than two.

; Rebuild the order for a fresh round: everyone still standing, fastest first.
; An insertion sort over at most eight entries, which is cheaper in code than
; anything cleverer and runs once a round.
battle_round:
  ldx #0
  lda #$FF
battle_round_clear:
  sta turn_order,x
  inx
  cpx #NUM_COMBATANTS
  bne battle_round_clear

  lda #0
  sta bt_tmp2               ; how many are in the list so far
  sta bt_cmd                ; the combatant being considered
battle_round_add:
  lda bt_cmd
  jsr combatant_alive
  beq battle_round_next
  lda bt_cmd
  jsr order_insert
battle_round_next:
  inc bt_cmd
  lda bt_cmd
  cmp #NUM_COMBATANTS
  bne battle_round_add
  rts

; A = combatant. Append it, then bubble it forward past anything slower. An
; eight-entry list once a round does not deserve anything cleverer, and a bubble
; is the version that is obviously right.
order_insert:
  ldy bt_tmp2
  sta turn_order,y
  inc bt_tmp2
order_insert_bubble:
  cpy #0
  beq order_insert_done
  sty bt_y
  lda turn_order,y
  jsr combatant_speed
  sta bt_arg
  ldy bt_y
  dey
  sty bt_y
  lda turn_order,y
  jsr combatant_speed
  ldy bt_y
  cmp bt_arg
  bcs order_insert_done     ; the one in front is at least as fast: settled
  lda turn_order,y
  sta bt_tmp
  lda turn_order+1,y
  sta turn_order,y
  lda bt_tmp
  sta turn_order+1,y
  jmp order_insert_bubble
order_insert_done:
  rts

; A = combatant. Returns A = its speed, from whichever table it belongs to.
combatant_speed:
  stx bt_x
  sty bt_y
  cmp #MAX_PARTY
  bcs combatant_speed_mon
  tax
  lda pc_speed,x
  jmp combatant_speed_ret
combatant_speed_mon:
  sec
  sbc #MAX_PARTY
  tax
  ldy mon_slot_actor,x
  lda mon_speed,y
combatant_speed_ret:
  sta bt_ret
  ldx bt_x
  ldy bt_y
  lda bt_ret
  rts

; A = combatant. Returns A = 0 (Z set) when it is out of the fight.
combatant_alive:
  stx bt_x
  sty bt_y
  cmp #MAX_PARTY
  bcs combatant_alive_mon
  tax
  lda pc_in_party,x
  beq combatant_alive_no
  lda pc_hp,x
  jmp combatant_alive_ret
combatant_alive_no:
  lda #0
  jmp combatant_alive_ret
combatant_alive_mon:
  sec
  sbc #MAX_PARTY
  tax
  lda mon_slot_alive,x
combatant_alive_ret:
  sta bt_ret
  ldx bt_x
  ldy bt_y
  lda bt_ret
  rts

; ------------------------------------------------------------------ turns

battle_first_turn:
  lda #0
  sta bt_round
  jmp battle_take_turn

battle_next:
  inc bt_round
  lda bt_round
  cmp #NUM_COMBATANTS
  bcc battle_take_turn
  jsr battle_round          ; a fresh round, re-sorted for anything that died
  lda #0
  sta bt_round
  ; fall through

battle_take_turn:
  jsr check_over
  lda bt_phase
  cmp #BP_MENU
  beq battle_take_turn_go
  cmp #BP_NEXT
  beq battle_take_turn_go
  rts                       ; check_over has ended the fight
battle_take_turn_go:
  ldy bt_round
  lda turn_order,y
  cmp #$FF
  beq battle_take_turn_skip
  sta bt_actor
  jsr combatant_alive       ; it may have died earlier this round
  beq battle_take_turn_skip
  lda bt_actor
  cmp #MAX_PARTY
  bcs battle_take_turn_monster
  ; A party member: hand the box over.
  lda #0
  sta bt_sel
  lda #BP_MENU
  sta bt_phase
  jsr draw_commands_queued
  jmp show_cursor
battle_take_turn_monster:
  jmp monster_turn
battle_take_turn_skip:
  inc bt_round
  lda bt_round
  cmp #NUM_COMBATANTS
  bcc battle_take_turn
  jsr battle_round
  lda #0
  sta bt_round
  jmp battle_take_turn

; ---------------------------------------------------------------- actions

; The player has chosen a target for a plain attack.
battle_act:
  lda bt_cmd
  cmp #BC_MAGIC
  beq battle_act_spell
  jmp attack_target
battle_act_spell:
  jmp cast_spell

; A spell was picked from the list: charge for it, then aim.
spell_chosen:
  ldx bt_sel
  lda bt_list,x
  sta bt_arg
  tax
  lda spell_cost,x
  sta bt_tmp
  ldx bt_actor
  lda pc_mp,x
  cmp bt_tmp
  bcs spell_affordable
  lda #BS_NOMP
  jmp battle_say_actor
spell_affordable:
  sec
  sbc bt_tmp
  sta pc_mp,x
  jsr clear_message
  lda #BC_MAGIC
  sta bt_cmd
  ; A spell that reaches everything needs no target.
  ldx bt_arg
  lda spell_scope,x
  bne spell_chosen_all
  jsr first_live_monster
  lda #BP_TARGET
  sta bt_phase
  jmp show_target
spell_chosen_all:
  lda #BP_ACT
  sta bt_phase
  rts

; An item was picked: spend it and heal whoever is acting. bt_list holds item
; ids under ITEMS_ENABLED, legacy actor ids otherwise -- item_heal and
; mon_heal are keyed to match, so this is the one place that needs to know
; which economy is live; the arithmetic below is identical either way.
item_chosen:
  ldx bt_sel
  lda bt_list,x
  sta bt_arg
  tay
  .if ITEMS_ENABLED
  lda item_heal,y
  .endif
  .if !ITEMS_ENABLED
  lda mon_heal,y
  .endif
  beq item_chosen_none      ; not a potion, so nothing to do with it here
  sta bt_tmp
  lda bt_arg
  jsr remove_item
  ldx bt_actor              ; items come off the menu, so this is a party member
  lda #0
  sta pc_status,x           ; a potion flushes the poison out with it
  lda pc_hp,x
  clc
  adc bt_tmp
  cmp pc_hp_max,x
  bcc item_chosen_store
  lda pc_hp_max,x
item_chosen_store:
  sta pc_hp,x
  lda bt_tmp
  sta bt_dmg_lo
  lda #0
  sta bt_dmg_hi
  jsr print_num
  jsr clear_message
  lda #BS_HEALS
  jmp battle_say_actor
item_chosen_none:
  jsr clear_message
  lda #BS_NOTHING
  jmp battle_say_actor

; A plain attack from whoever is acting on to bt_target.
attack_target:
  jsr roll_hit
  bne attack_missed
  jsr physical_damage
  jsr apply_damage
  jsr print_num
  lda #BS_HITS
  jmp battle_say_actor
attack_missed:
  lda #$FF
  sta bt_dmg_hi             ; no number on this line
  lda #BS_MISSES
  jmp battle_say_actor

; The spell in bt_arg: damage on bt_target or the whole other side, a heal on
; whoever is casting, or a poison. The kind numbers index SPELL_KINDS in
; shared/project.js -- that order is the wire format.
cast_spell:
  ldx bt_arg
  lda spell_kind,x
  cmp #SK_POISON
  bne cast_spell_heal_chk
  jmp cast_poison
cast_spell_heal_chk:
  cmp #SK_HEAL
  bne cast_spell_dmg
  jmp cast_heal
cast_spell_dmg:
  lda spell_scope,x
  bne cast_all
  jsr spell_damage
  jsr apply_damage
  jsr print_num
  lda #BS_HITS
  jmp battle_say_actor

; A group spell reaches the caster's whole *other* side -- the monsters when a
; party member casts it, the party when a monster does.
cast_all:
  jsr other_side
  sta bt_target
  clc
  adc #MAX_PARTY            ; both sides are the same four slots wide
  sta bt_tmp2
cast_all_loop:
  ldx bt_target
  jsr combatant_alive_x
  beq cast_all_next
  jsr spell_damage
  jsr apply_damage
cast_all_next:
  inc bt_target
  lda bt_target
  cmp bt_tmp2
  bcc cast_all_loop
  jsr print_num
  lda #BS_HITS
  jmp battle_say_actor

; A heal restores whoever is casting -- either side -- and cures their poison
; with it, which is what makes poison worth curing.
cast_heal:
  ldx bt_arg
  lda spell_amount,x
  sta bt_tmp
  lda bt_actor
  cmp #MAX_PARTY
  bcs cast_heal_mon
  tax
  lda #0
  sta pc_status,x
  lda pc_hp,x
  clc
  adc bt_tmp
  cmp pc_hp_max,x
  bcc cast_heal_store
  lda pc_hp_max,x
cast_heal_store:
  sta pc_hp,x
  jmp cast_heal_say
cast_heal_mon:
  sec
  sbc #MAX_PARTY
  tax
  lda #0
  sta mon_slot_status,x
  lda mon_slot_hp,x
  clc
  adc bt_tmp
  cmp mon_slot_max,x
  bcc cast_heal_mon_store
  lda mon_slot_max,x
cast_heal_mon_store:
  sta mon_slot_hp,x
cast_heal_say:
  lda bt_tmp
  sta bt_dmg_lo
  lda #0
  sta bt_dmg_hi
  jsr print_num
  lda #BS_HEALS
  jmp battle_say_actor

; Poison sets a status bit rather than dealing damage now: the victim loses
; POISON_DMG after each of its turns, applied where the message flow advances.
cast_poison:
  ldx bt_arg
  lda spell_scope,x
  bne cast_poison_all
  jsr poison_target
  jmp cast_poison_say
cast_poison_all:
  jsr other_side
  sta bt_target
  clc
  adc #MAX_PARTY
  sta bt_tmp2
cast_poison_loop:
  ldx bt_target
  jsr combatant_alive_x
  beq cast_poison_next
  jsr poison_target
cast_poison_next:
  inc bt_target
  lda bt_target
  cmp bt_tmp2
  bcc cast_poison_loop
cast_poison_say:
  lda #$FF
  sta bt_dmg_hi             ; no number on this line
  lda #BS_POISONS
  jmp battle_say_actor

; Mark bt_target poisoned, whichever side it is on.
poison_target:
  lda bt_target
  cmp #MAX_PARTY
  bcs poison_target_mon
  tax
  lda #1
  sta pc_status,x
  rts
poison_target_mon:
  sec
  sbc #MAX_PARTY
  tax
  lda #1
  sta mon_slot_status,x
  rts

; A = the first combatant on the acting side's opposite side.
other_side:
  lda bt_actor
  cmp #MAX_PARTY
  bcs other_side_party
  lda #MAX_PARTY
  rts
other_side_party:
  lda #0
  rts

; A = combatant. Returns A = its status bits (Z set when clean). Clobbers X,
; unlike the combatant_* lookups above it: its callers are the message flow and
; the poison tick, neither of which is holding a register.
combatant_status:
  cmp #MAX_PARTY
  bcs combatant_status_mon
  tax
  lda pc_status,x
  rts
combatant_status_mon:
  sec
  sbc #MAX_PARTY
  tax
  lda mon_slot_status,x
  rts

; The acting combatant suffers its poison: a fixed bite, a line saying so, and
; bt_ptick raised so the message that follows hands the turn on rather than
; poisoning again. Called from battle_message_done, after the action's own
; message has been dismissed.
poison_tick:
  lda #1
  sta bt_ptick
  lda bt_actor
  sta bt_target
  lda #POISON_DMG
  sta bt_dmg_lo
  lda #0
  sta bt_dmg_hi
  jsr apply_damage
  jsr print_num
  lda #BS_SUFFERS
  jmp battle_say_actor

; X = combatant; Z set when it is out. A wrapper so the loops above read.
combatant_alive_x:
  txa
  jmp combatant_alive

; --------------------------------------------------------------- the maths

; Does the attack land? rng < (accuracy - evasion); an underflow is a miss, so
; a target more evasive than the attacker is accurate can never be hit.
; Returns A = 0 (Z set) on a hit.
roll_hit:
  lda bt_actor
  jsr combatant_acc
  sta bt_tmp
  lda bt_target
  jsr combatant_eva
  sta bt_tmp2
  lda bt_tmp
  sec
  sbc bt_tmp2
  bcc roll_hit_miss
  sta bt_tmp
  jsr rng_next
  cmp bt_tmp
  bcs roll_hit_miss
  lda #0
  rts
roll_hit_miss:
  lda #1
  rts

combatant_acc:
  stx bt_x
  sty bt_y
  cmp #MAX_PARTY
  bcs combatant_acc_mon
  tax
  lda pc_acc,x
  jmp combatant_acc_ret
combatant_acc_mon:
  sec
  sbc #MAX_PARTY
  tax
  ldy mon_slot_actor,x
  lda mon_acc,y
combatant_acc_ret:
  sta bt_ret
  ldx bt_x
  ldy bt_y
  lda bt_ret
  rts

combatant_eva:
  stx bt_x
  sty bt_y
  cmp #MAX_PARTY
  bcs combatant_eva_mon
  tax
  lda pc_eva,x
  jmp combatant_eva_ret
combatant_eva_mon:
  sec
  sbc #MAX_PARTY
  tax
  ldy mon_slot_actor,x
  lda mon_eva,y
combatant_eva_ret:
  sta bt_ret
  ldx bt_x
  ldy bt_y
  lda bt_ret
  rts

; max(1, attack - defence) plus a little noise, into bt_dmg_lo.
physical_damage:
  lda bt_actor
  jsr combatant_atk
  sta bt_tmp
  lda bt_target
  jsr combatant_def
  sta bt_tmp2
  lda bt_tmp
  sec
  sbc bt_tmp2
  bcs physical_damage_floor
  lda #0
physical_damage_floor:
  bne physical_damage_noise
  lda #1                    ; even a hopeless attack scratches
physical_damage_noise:
  sta bt_tmp
  jsr rng_next
  and #3
  clc
  adc bt_tmp
  sta bt_dmg_lo
  lda #0
  sta bt_dmg_hi
  rts

combatant_atk:
  stx bt_x
  sty bt_y
  cmp #MAX_PARTY
  bcs combatant_atk_mon
  tax
  txa
  jsr level_row
  lda pc_atk_at,y
  jmp combatant_atk_ret
combatant_atk_mon:
  sec
  sbc #MAX_PARTY
  tax
  ldy mon_slot_actor,x
  lda mon_atk,y
combatant_atk_ret:
  sta bt_ret
  ldx bt_x
  ldy bt_y
  lda bt_ret
  rts

combatant_def:
  stx bt_x
  sty bt_y
  cmp #MAX_PARTY
  bcs combatant_def_mon
  tax
  txa
  jsr level_row
  lda pc_def_at,y
  jmp combatant_def_ret
combatant_def_mon:
  sec
  sbc #MAX_PARTY
  tax
  ldy mon_slot_actor,x
  lda mon_def,y
combatant_def_ret:
  sta bt_ret
  ldx bt_x
  ldy bt_y
  lda bt_ret
  rts

; The spell's own number, then the element: half again against a weakness, half
; against a resistance, and never less than one.
spell_damage:
  ldx bt_arg
  lda spell_amount,x
  sta bt_dmg_lo
  lda #0
  sta bt_dmg_hi
  lda bt_target
  cmp #MAX_PARTY
  bcc spell_damage_done     ; elements only describe monsters
  sec
  sbc #MAX_PARTY
  tax
  ldy mon_slot_actor,x
  ldx bt_arg
  lda spell_element,x
  beq spell_damage_done     ; an elementless spell has nothing to match
  cmp mon_weak,y
  beq spell_damage_weak
  cmp mon_strong,y
  beq spell_damage_strong
  rts
spell_damage_weak:
  lda bt_dmg_lo             ; one and a half times
  lsr a
  clc
  adc bt_dmg_lo
  sta bt_dmg_lo
  rts
spell_damage_strong:
  lda bt_dmg_lo
  lsr a
  bne spell_damage_store
  lda #1
spell_damage_store:
  sta bt_dmg_lo
spell_damage_done:
  rts

; Take bt_dmg_lo off bt_target, and note if that finished it.
apply_damage:
  lda bt_target
  cmp #MAX_PARTY
  bcs apply_damage_mon
  tax
  lda pc_hp,x
  sec
  sbc bt_dmg_lo
  bcs apply_damage_pc_store
  lda #0
apply_damage_pc_store:
  sta pc_hp,x
  rts
apply_damage_mon:
  sec
  sbc #MAX_PARTY
  tax
  lda mon_slot_hp,x
  sec
  sbc bt_dmg_lo
  bcs apply_damage_mon_store
  lda #0
apply_damage_mon_store:
  sta mon_slot_hp,x
  bne apply_damage_done
  lda #0
  sta mon_slot_alive,x
  dec bt_count
  jsr wipe_monster
apply_damage_done:
  rts

; X = monster slot. Blank the block it was standing on, four rows at a time so
; the queue never carries more than one vblank's worth.
wipe_monster:
  txa
  asl a
  asl a
  clc
  adc #BT_MON_ROW
  sta bt_row
  ldy flat_screen
  lda screen_map,y
  tay
  lda map_battle_ground,y   ; hoisted: the fill never changes mid-wipe, and a
  sta bt_fill               ; spell may be halfway through using bt_arg
  lda #4
  sta bt_tmp
wipe_monster_row:
  lda #BT_MON_COL
  sta bt_col
  jsr queue_at
  ldy #8
wipe_monster_cell:
  lda bt_fill
  jsr vram_push
  dey
  bne wipe_monster_cell
  jsr vram_end
  inc bt_row
  dec bt_tmp
  bne wipe_monster_row
  rts

; ---------------------------------------------------------- monsters' turn

; A monster with a spell it can still afford casts it about half the time, and
; swings the rest -- a coin rather than a plan, because a monster with a plan
; would need an opinion. Its MP is per slot, seeded from the actor's mp stat.
monster_turn:
  lda bt_actor
  sec
  sbc #MAX_PARTY
  tax
  ldy mon_slot_actor,x
  lda mon_spell,y
  cmp #$FF
  beq monster_turn_attack
  sta bt_arg
  tay
  lda spell_cost,y
  sta bt_tmp
  lda mon_slot_mp,x
  cmp bt_tmp
  bcc monster_turn_attack
  jsr rng_next
  and #1
  bne monster_turn_attack
  lda mon_slot_mp,x
  sec
  sbc bt_tmp
  sta mon_slot_mp,x
  jsr pick_party_target
  jmp cast_spell
monster_turn_attack:
  jsr pick_party_target
  jsr roll_hit
  bne monster_missed
  jsr physical_damage
  jsr apply_damage
  jsr print_num
  lda #BS_HITS
  jmp battle_say_actor
monster_missed:
  lda #$FF
  sta bt_dmg_hi
  lda #BS_MISSES
  jmp battle_say_actor

; The first member still standing. A monster with a choice would need an
; opinion, and a random one reads as arbitrary rather than clever.
pick_party_target:
  ldx #0
pick_party_step:
  txa
  jsr combatant_alive
  bne pick_party_found
  inx
  cpx #MAX_PARTY
  bne pick_party_step
  ldx #0
pick_party_found:
  stx bt_target
  rts

; ----------------------------------------------------------- how it ends

; Called before every turn. Sets the phase when one side has run out.
check_over:
  lda bt_flee
  beq check_over_monsters
  lda #BP_FLEE
  sta bt_phase
  rts
check_over_monsters:
  lda bt_count
  bne check_over_party
  lda #BP_VICTORY
  sta bt_phase
  jmp award_spoils
check_over_party:
  ldx #0
check_over_party_step:
  txa
  jsr combatant_alive
  bne check_over_alive
  inx
  cpx #MAX_PARTY
  bne check_over_party_step
  lda #BP_DEFEAT
  sta bt_phase
  rts
check_over_alive:
  rts

; Experience and gold from the whole formation, then a level for anyone who has
; earned one. Monsters that were beaten are still in their slots, so the sum is
; over every slot that held something.
award_spoils:
  lda #0
  sta bt_dmg_lo
  sta bt_dmg_hi
  ldx #0
award_loop:
  lda mon_slot_actor,x
  cmp #$FF
  beq award_next
  tay
  lda bt_dmg_lo
  clc
  adc mon_xp_lo,y
  sta bt_dmg_lo
  lda bt_dmg_hi
  adc mon_xp_hi,y
  sta bt_dmg_hi
  lda gold_lo
  clc
  adc mon_gold,y
  sta gold_lo
  bcc award_gold_done
  inc gold_hi
award_gold_done:
  jsr roll_drop
award_next:
  inx
  cpx #MAX_MONSTERS
  bne award_loop

  ; Split between whoever is still standing.
  ldx #0
award_xp_loop:
  txa
  jsr combatant_alive
  beq award_xp_next
  lda pc_xp_lo,x
  clc
  adc bt_dmg_lo
  sta pc_xp_lo,x
  lda pc_xp_hi,x
  adc bt_dmg_hi
  sta pc_xp_hi,x
  jsr try_level_up
award_xp_next:
  inx
  cpx #MAX_PARTY
  bne award_xp_loop
  jsr print_num
  rts

; X = monster slot. One roll against its drop chance, and into the bag it goes.
roll_drop:
  ldy mon_slot_actor,x
  lda mon_drop,y
  cmp #NO_ITEM
  beq roll_drop_done
  sta bt_tmp
  lda mon_drop_pct,y
  beq roll_drop_done
  sta bt_tmp2
  txa
  pha
  jsr rng_next
  ; rng is 0-255 and the chance is a percentage, so scale it: a byte under
  ; pct * 256 / 100 is the same thing without a divide.
  lsr a
  lsr a                     ; 0-63
  cmp bt_tmp2
  bcs roll_drop_missed
  lda bt_tmp
  jsr add_item
roll_drop_missed:
  pla
  tax
roll_drop_done:
  rts

; X = member. Raise a level for as long as the experience allows.
try_level_up:
  lda pc_level,x
  cmp #MAX_LEVEL
  bcs try_level_done
  ldy pc_level,x
  dey                       ; the threshold for the *next* level
  lda pc_xp_lo,x
  cmp xp_next_lo,y
  lda pc_xp_hi,x
  sbc xp_next_hi,y
  bcc try_level_done
  inc pc_level,x
  jsr party_apply_level
  lda pc_hp_max,x           ; a level restores you, which is the reward
  sta pc_hp,x
  lda pc_mp_max,x
  sta pc_mp,x
  jmp try_level_up
try_level_done:
  rts

; Victory, defeat and running away all wait for a press and then leave.
battle_outcome:
  lda bt_phase
  cmp #BP_VICTORY
  beq battle_outcome_win
  cmp #BP_DEFEAT
  beq battle_outcome_lose
  lda #BS_FLED
  jmp battle_outcome_say
battle_outcome_win:
  lda #BS_VICTORY
  jmp battle_outcome_say
battle_outcome_lose:
  lda #BS_DEFEAT
battle_outcome_say:
  sta bt_str
  jsr clear_message
  lda #MSG_ROW+1
  sta bt_row
  lda #MSG_COL
  sta bt_col
  jsr queue_at
  lda bt_str
  jsr push_battle_string
  jsr vram_end
  lda #BP_DONE
  sta bt_phase
  rts

; The press that leaves. Defeat goes to the game-over screen the action engine
; already has, so there is one way for a game to end however it was played.
battle_finish:
  lda pad_new
  and #BTN_A
  bne battle_finish_go
  lda pad_new
  and #BTN_START
  beq battle_finish_wait
battle_finish_go:
  ldx #0
battle_finish_check:
  txa
  jsr combatant_alive
  bne battle_finish_live
  inx
  cpx #MAX_PARTY
  bne battle_finish_check
  jmp player_died
battle_finish_live:
  jmp battle_end
battle_finish_wait:
  rts
