; battleui.asm -- the battle box: cursor, menus, lists and messages.
;
; Part of the banked battle system; see engine/battle.asm for the bank rules.
;
; The cursor is a *background* tile, not a sprite. That costs nothing from the
; sixty-four sprites the party and any metasprite monsters are already competing
; for, and it means moving it is one queued byte rather than an OAM rewrite.
;
; Everything drawn here goes through the NMI queue, one packet a frame, because
; the picture is on: see the rules at the top of engine/text.asm.

; --------------------------------------------------------------- the cursor

; A = the tile to write. Column BT_CMD_COL-1 of the row bt_row.
cursor_write:
  pha
  lda #BT_CMD_COL-1
  sta bt_col
  jsr queue_at
  pla
  jsr vram_push
  jmp vram_end

; bt_row / bt_col -> an open one-byte packet in the NMI queue.
queue_at:
  lda bt_row
  lsr a
  lsr a
  lsr a
  clc
  adc #$20
  pha
  lda bt_row
  and #7
  asl a
  asl a
  asl a
  asl a
  asl a
  clc
  adc bt_col
  tay
  pla
  jmp vram_open

; The command cursor, at whichever of the four rows bt_sel names.
cursor_row_for_sel:
  lda bt_sel
  asl a
  clc
  adc #BT_CMD_ROW
  sta bt_row
  rts

show_cursor:
  jsr cursor_row_for_sel
  lda #ARROW_TILE
  jmp cursor_write

hide_cursor:
  jsr cursor_row_for_sel
  lda #TILE_SPACE
  jmp cursor_write

; The targeting cursor sits beside the monster it names, at the left of that
; monster's row band -- the same column the command cursor uses, so the two
; never need two code paths.
;
; On a split-font build the arrow glyph is a *background* tile in the font's
; own CHR bank, which is only switched in below the battle box -- and this
; cursor points above it. So those builds show a sprite instead: these two
; routines just flip the flag, and battle_draw_sprites appends the arrow while
; it owns the shadow. Call sites are identical either way.
  .if SPLIT_ENABLED
show_target:
  lda #1
  sta bt_tgt_vis
  rts
hide_target:
  lda #0
  sta bt_tgt_vis
  rts
  .endif
  .if !SPLIT_ENABLED
show_target:
  jsr target_row
  lda #ARROW_TILE
  jmp cursor_write
hide_target:
  jsr target_row
  lda #TILE_SPACE
  jmp cursor_write
  .endif
target_row:
  lda bt_target
  sec
  sbc #MAX_PARTY
  asl a
  asl a
  clc
  adc #BT_MON_ROW+1
  sta bt_row
  rts

; ------------------------------------------------------------ the menu

; Whose turn it is chooses; the D-pad moves the highlight and A confirms, both
; hardwired because a battle menu has exactly one shape.
battle_menu:
  lda pad_new
  and #BTN_DOWN
  beq battle_menu_up
  jsr hide_cursor
  inc bt_sel
  lda bt_sel
  cmp #NUM_COMMANDS
  bcc battle_menu_moved
  lda #0
  sta bt_sel
  jmp battle_menu_moved
battle_menu_up:
  lda pad_new
  and #BTN_UP
  beq battle_menu_press
  jsr hide_cursor
  dec bt_sel
  bpl battle_menu_moved
  lda #NUM_COMMANDS-1
  sta bt_sel
battle_menu_moved:
  jmp show_cursor

battle_menu_press:
  lda pad_new
  and #BTN_A
  beq battle_menu_done
  lda bt_sel
  cmp #BC_FIGHT
  beq battle_menu_fight
  cmp #BC_MAGIC
  beq battle_menu_magic
  cmp #BC_ITEM
  beq battle_menu_item
  jmp battle_menu_run
battle_menu_done:
  rts

battle_menu_fight:
  lda #BC_FIGHT
  sta bt_cmd
  jsr hide_cursor
  jsr first_live_monster
  lda #BP_TARGET
  sta bt_phase
  jmp show_target

battle_menu_magic:
  ldx bt_actor
  lda pc_spells,x           ; nothing to cast is nothing to open a window for
  beq battle_menu_done
  jsr hide_cursor
  lda #0
  sta bt_sel
  sta bt_scroll
  lda #BP_SPELLS
  sta bt_phase
  jmp draw_list

; Phase 4c round 3, finding 5 (phase4-design.md §9): whether Items opens must
; be decided from the *filtered* list, not raw inv_count, because
; build_item_list (below) can now leave bt_len at 0 while inv_count is still
; positive -- a bag holding only damage-kind or zero-amount items. Deciding
; from inv_count alone would open BP_ITEMS onto an empty list: the row-select
; code would index a stale bt_list[0] left over from whatever list was built
; last, and Up would underflow bt_sel to $FF. The ITEMS_ENABLED-false path
; keeps the old inv_count check exactly, below, because build_item_list never
; filters there -- bt_len always equals inv_count exactly, so the two checks
; can never disagree and the byte-identity promise for that path holds.
; build_spell_list never needed this ordering fix -- pc_spells IS the
; membership test build_spell_list applies, so gating on it before building
; can never disagree with what building produces; items introduce a second,
; independent filter inv_count knows nothing about, which is what makes this
; a new requirement rather than a precedent build_spell_list already had to
; solve.
battle_menu_item:
  .if ITEMS_ENABLED
  jsr build_item_list       ; build first, so the gate below sees the real count
  lda bt_len
  beq battle_menu_done
  .endif
  .if !ITEMS_ENABLED
  lda inv_count
  beq battle_menu_done
  .endif
  jsr hide_cursor
  lda #0
  sta bt_sel
  sta bt_scroll
  lda #BP_ITEMS
  sta bt_phase
  jmp draw_list

battle_menu_run:
  lda bt_esc
  bne battle_menu_flee
  lda #BS_NORUN
  jmp battle_say_actor
battle_menu_flee:
  jsr rng_next
  cmp #100                  ; a bit better than even odds
  bcs battle_menu_failed
  lda #1
  sta bt_flee
  lda #BS_FLED
  jmp battle_say_actor
battle_menu_failed:
  lda #BS_NORUN
  jmp battle_say_actor

; --------------------------------------------------------------- targeting

battle_target:
  lda pad_new
  and #BTN_DOWN
  bne battle_target_move
  lda pad_new
  and #BTN_UP
  bne battle_target_move
  lda pad_new
  and #BTN_B
  bne battle_target_back
  lda pad_new
  and #BTN_A
  beq battle_target_done
  jsr hide_target
  lda #BP_ACT
  sta bt_phase
battle_target_done:
  rts

battle_target_move:
  jsr hide_target
  jsr next_live_monster
  jmp show_target

battle_target_back:
  jsr hide_target
  lda #BP_MENU
  sta bt_phase
  jmp show_cursor

; bt_target = the first monster still standing.
first_live_monster:
  lda #MAX_PARTY-1
  sta bt_target
  ; fall through

; Step bt_target on to the next live monster, wrapping.
next_live_monster:
  ldy #MAX_MONSTERS
next_live_step:
  inc bt_target
  lda bt_target
  cmp #NUM_COMBATANTS
  bcc next_live_check
  lda #MAX_PARTY
  sta bt_target
next_live_check:
  lda bt_target
  sec
  sbc #MAX_PARTY
  tax
  lda mon_slot_alive,x
  bne next_live_done
  dey
  bne next_live_step
next_live_done:
  rts

; ------------------------------------------------------ spell and item lists

; Four rows of the box, scrolled with the D-pad. Spells and items share the
; code: which table a row names is the only difference, and that is one branch.
battle_list:
  lda pad_new
  and #BTN_DOWN
  beq battle_list_up
  inc bt_sel
  lda bt_sel
  cmp bt_len
  bcc battle_list_scroll
  lda #0
  sta bt_sel
  jmp battle_list_scroll
battle_list_up:
  lda pad_new
  and #BTN_UP
  beq battle_list_press
  dec bt_sel
  bpl battle_list_scroll
  lda bt_len
  sec
  sbc #1
  sta bt_sel
battle_list_scroll:
  jsr list_follow
  jmp draw_list

battle_list_press:
  lda pad_new
  and #BTN_B
  bne battle_list_back
  lda pad_new
  and #BTN_A
  beq battle_list_done
  lda bt_phase
  cmp #BP_SPELLS
  bne battle_list_use_item
  jmp spell_chosen
battle_list_use_item:
  jmp item_chosen
battle_list_done:
  rts

battle_list_back:
  jsr clear_message
  lda #BP_MENU
  sta bt_phase
  jsr draw_commands_queued
  jmp show_cursor

; Keep the highlight inside the four visible rows.
list_follow:
  lda bt_sel
  cmp bt_scroll
  bcc list_follow_up
  sec
  sbc bt_scroll
  cmp #4
  bcc list_follow_done
  lda bt_sel
  sec
  sbc #3
  sta bt_scroll
  rts
list_follow_up:
  lda bt_sel
  sta bt_scroll
list_follow_done:
  rts

; ------------------------------------------------------------ list contents

; Fill bt_list with what the acting member can cast, and bt_len with how many.
; A member knows a spell when their level's bitmask has its slot set, which is
; the generator's doing: `pc_spells_at` is precomputed per level.
build_spell_list:
  lda #0
  sta bt_len
  ldx bt_actor
  lda pc_spells,x
  sta bt_tmp
  ldy #0
build_spell_slot:
  cpy #NUM_SPELLS
  bcs build_spell_done
  lda bit_mask,y
  and bt_tmp
  beq build_spell_next
  ldx bt_len
  tya
  sta bt_list,x
  inc bt_len
build_spell_next:
  iny
  cpy #8                    ; one bitmask byte, so eight spells a member
  bne build_spell_slot
build_spell_done:
  rts

; The bag, which in an RPG is where potions live.
;
; Phase 4c round 3: under ITEMS_ENABLED, filtered to kind == heal and
; amount > 0 -- what item_chosen (engine/battleturn.asm) can actually spend
; consistently. A damage-kind or zero-amount item is a real, valid item on
; the field and for Give/Take/Carrying/drops; it is just never a selectable
; row here, so no row in this menu is ever a silent no-op (CLAUDE.md's "looks
; functional, does something else" rule; phase 4 design's "two menus, made
; consistent" section). The ITEMS_ENABLED-false path is untouched -- exactly
; today's unfiltered straight copy, mon_heal == 0 items included -- because
; that path's own pre-phase-4 inconsistency is explicitly out of this
; phase's scope, and fixing it would break the disabled-path byte-identity
; promise for content this phase promises not to touch.
build_item_list:
  lda #0
  sta bt_len
  ldy #0
build_item_slot:
  cpy inv_count
  bcs build_item_done
  lda inv_items,y
  .if ITEMS_ENABLED
  tax
  lda item_effect_kind,x
  cmp #EFFECT_HEAL
  bne build_item_next
  lda item_effect_amount,x
  beq build_item_next
  txa
  .endif
  ldx bt_len
  sta bt_list,x
  inc bt_len
build_item_next:
  iny
  cpy #MAX_ITEMS
  bne build_item_slot
build_item_done:
  rts

; ------------------------------------------------------------- list drawing

; Four rows of names in the message area, with the cursor beside the highlight.
; One packet per row, which is under the queue's per-vblank budget.
draw_list:
  lda bt_phase
  cmp #BP_SPELLS
  bne draw_list_items
  jsr build_spell_list
  jmp draw_list_rows
draw_list_items:
  jsr build_item_list
draw_list_rows:
  ; The row counter is bt_vrow, never bt_tmp2: drawing a name goes through
  ; name_offset_pc, which hands its length back in bt_tmp2 and counts it down
  ; to zero. Sharing the byte re-zeroed the counter on every named row, which
  ; hung the tick in this loop the first time a list held two entries.
  lda #0
  sta bt_vrow
draw_list_row:
  lda bt_vrow
  clc
  adc #MSG_ROW
  sta bt_row
  lda #MSG_COL-1
  sta bt_col
  jsr queue_at
  ; The cursor, then the name.
  lda bt_vrow
  clc
  adc bt_scroll
  cmp bt_sel
  bne draw_list_nocursor
  lda #ARROW_TILE
  jmp draw_list_cursor
draw_list_nocursor:
  lda #TILE_SPACE
draw_list_cursor:
  jsr vram_push
  lda bt_vrow
  clc
  adc bt_scroll
  cmp bt_len
  bcs draw_list_blank
  jsr draw_list_name
  jmp draw_list_end
draw_list_blank:
  ldy #NAME_LEN
draw_list_pad:
  lda #TILE_SPACE
  jsr vram_push
  dey
  bne draw_list_pad
draw_list_end:
  jsr vram_end
  inc bt_vrow
  lda bt_vrow
  cmp #LIST_ROWS
  bne draw_list_row
  rts

; A = the list index whose name goes into the open packet. The table base has
; to be chosen before name_offset_pc runs (it now advances a 16-bit pointer
; rather than handing back an 8-bit offset the caller applies afterward), so
; the bt_phase branch that used to run after the call now runs before it.
; bt_list holds item ids under ITEMS_ENABLED, legacy actor ids otherwise --
; item_name and mon_name are keyed to match, item_chosen's own reasoning.
draw_list_name:
  tax
  lda bt_list,x
  sta bt_tmp                ; the entry's own id, while ptr_lo/hi is chosen
  lda bt_phase
  cmp #BP_SPELLS
  bne draw_list_name_item
  lda #LOW(spell_name)
  sta ptr_lo
  lda #HIGH(spell_name)
  sta ptr_hi
  jmp draw_list_name_go
draw_list_name_item:
  .if ITEMS_ENABLED
  lda #LOW(item_name)
  sta ptr_lo
  lda #HIGH(item_name)
  sta ptr_hi
  .endif
  .if !ITEMS_ENABLED
  lda #LOW(mon_name)
  sta ptr_lo
  lda #HIGH(mon_name)
  sta ptr_hi
  .endif
draw_list_name_go:
  lda bt_tmp
  jsr name_offset_pc         ; the same stride for every name table
draw_list_name_char:
  lda [ptr_lo],y
  jsr vram_push
  iny
  dec bt_tmp2
  bne draw_list_name_char
  rts

; ------------------------------------------------------------- the message

; Blank the message area: two rows of the box, which is where the lists and the
; battle text both live.
clear_message:
  lda #0
  sta bt_tmp2
clear_message_row:
  lda bt_tmp2
  clc
  adc #MSG_ROW
  sta bt_row
  lda #MSG_COL-1
  sta bt_col
  jsr queue_at
  ldy #MSG_COLS+1
clear_message_cell:
  lda #TILE_SPACE
  jsr vram_push
  dey
  bne clear_message_cell
  jsr vram_end
  inc bt_tmp2
  lda bt_tmp2
  cmp #LIST_ROWS
  bne clear_message_row
  rts

; Put FIGHT / MAGIC / ITEM / RUN back after a list or a message covered them.
draw_commands_queued:
  lda #0
  sta bt_tmp
draw_cq_row:
  lda bt_tmp
  asl a
  clc
  adc #BT_CMD_ROW
  sta bt_row
  lda #BT_CMD_COL
  sta bt_col
  jsr queue_at
  lda bt_tmp
  jsr name_offset_cmd
draw_cq_char:
  lda cmd_names,y
  jsr vram_push
  iny
  dec bt_tmp2
  bne draw_cq_char
  jsr vram_end
  inc bt_tmp
  lda bt_tmp
  cmp #NUM_COMMANDS
  bne draw_cq_row
  rts

; A = a battle string. Says it about whoever is acting: their name on the first
; row, the line on the second. Numbers are staged into bt_digits on the main
; thread beforehand -- never formatted inside NMI, which is a rule this engine
; inherited from the game it is modelled on.
battle_say_actor:
  sta bt_str
  lda bt_actor
  jmp battle_say

; A = the combatant whose name heads the message; bt_str is the line.
battle_say:
  sta bt_tmp
  lda #MSG_ROW
  sta bt_row
  lda #MSG_COL
  sta bt_col
  jsr queue_at
  lda bt_tmp
  jsr push_combatant_name
  jsr vram_end

  lda #MSG_ROW+1
  sta bt_row
  lda #MSG_COL
  sta bt_col
  jsr queue_at
  lda bt_str
  jsr push_battle_string
  jsr vram_end

  lda #MSG_HOLD
  sta bt_timer
  lda #BP_MESSAGE
  sta bt_phase
  rts

; A = combatant index. Party members read out of pc_name, monsters out of
; mon_name via the actor in their slot -- one index space, two tables.
push_combatant_name:
  cmp #MAX_PARTY
  bcs push_combatant_monster
  sta bt_tmp                 ; the party slot, while ptr_lo/hi is loaded
  lda #LOW(pc_name)
  sta ptr_lo
  lda #HIGH(pc_name)
  sta ptr_hi
  lda bt_tmp
  jsr name_offset_pc
push_pc_char:
  lda [ptr_lo],y
  jsr vram_push
  iny
  dec bt_tmp2
  bne push_pc_char
  rts
push_combatant_monster:
  sec
  sbc #MAX_PARTY
  tax
  lda mon_slot_actor,x
  sta bt_tmp                 ; the actor id, while ptr_lo/hi is loaded
  lda #LOW(mon_name)
  sta ptr_lo
  lda #HIGH(mon_name)
  sta ptr_hi
  lda bt_tmp
  jsr name_offset_pc          ; same stride, different table
push_mon_char:
  lda [ptr_lo],y
  jsr vram_push
  iny
  dec bt_tmp2
  bne push_mon_char
  rts

; A = string index. The last three columns are overwritten by bt_digits when the
; line has a number in it, which is how "hits" becomes "hits    12".
push_battle_string:
  sta bt_tmp
  lda #0
  ldy bt_tmp
  beq push_bs_len
push_bs_stride:
  clc
  adc #MSG_COLS
  dey
  bne push_bs_stride
push_bs_len:
  tay
  lda #0
  sta bt_tmp
push_bs_char:
  lda bt_tmp
  cmp #MSG_COLS-3
  bcc push_bs_plain
  lda bt_dmg_hi             ; a number of $FFxx means "no number here"
  cmp #$FF
  beq push_bs_plain
  lda bt_tmp
  sec
  sbc #MSG_COLS-3
  tax
  lda bt_digits,x
  jmp push_bs_write
push_bs_plain:
  lda bs_text,y
push_bs_write:
  jsr vram_push
  iny
  inc bt_tmp
  lda bt_tmp
  cmp #MSG_COLS
  bne push_bs_char
  rts

; Hold the line for a moment, or until the player presses on.
battle_message_wait:
  lda pad_new
  and #BTN_A
  bne battle_message_done
  dec bt_timer
  bne battle_message_hold
battle_message_done:
  jsr clear_message
  ; After the acting combatant's own line, its poison gets a word in: one tick
  ; of damage and one more line, with bt_ptick raised so *this* branch advances
  ; the turn when that line is dismissed instead of poisoning twice.
  lda bt_ptick
  bne battle_message_advance
  lda bt_actor
  jsr combatant_status
  beq battle_message_advance
  jmp poison_tick
battle_message_advance:
  lda #0
  sta bt_ptick
  lda #BP_NEXT
  sta bt_phase
battle_message_hold:
  rts

; bt_dmg_lo/hi -> three glyphs in bt_digits, leading zeros blanked. Repeated
; subtraction, on the main thread: division inside NMI is what overran vblank in
; the game this is modelled on.
print_num:
  lda #0
  sta bt_digits
  sta bt_digits+1
  lda bt_dmg_lo
  sta bt_tmp
print_num_hundreds:
  cmp #100
  bcc print_num_tens
  sec
  sbc #100
  inc bt_digits
  jmp print_num_hundreds
print_num_tens:
  sta bt_tmp
print_num_tens_loop:
  cmp #10
  bcc print_num_ones
  sec
  sbc #10
  inc bt_digits+1
  jmp print_num_tens_loop
print_num_ones:
  clc
  adc #TILE_ZERO
  sta bt_digits+2
  ; Leading zeros read as padding, not as digits.
  lda bt_digits
  bne print_num_hundreds_glyph
  lda bt_digits+1
  bne print_num_blank_hundreds
  lda #TILE_SPACE
  sta bt_digits
  sta bt_digits+1
  rts
print_num_blank_hundreds:
  clc
  adc #TILE_ZERO
  sta bt_digits+1
  lda #TILE_SPACE
  sta bt_digits
  rts
print_num_hundreds_glyph:
  clc
  adc #TILE_ZERO
  sta bt_digits
  lda bt_digits+1
  clc
  adc #TILE_ZERO
  sta bt_digits+1
  rts

; ------------------------------------------------------------- the sprites

; The party stands on the right. Monsters with no block art are drawn here too,
; so an actor that was never given battle artwork can still fight.
battle_draw_sprites:
  ; Park the whole shadow before drawing rather than after. Parking afterwards
  ; would have to distinguish "nothing was drawn" from "the shadow filled up",
  ; and both leave oam_idx at zero.
  lda #$FF
  ldx #0
battle_sprite_clear:
  sta OAM,x
  inx
  inx
  inx
  inx
  bne battle_sprite_clear
  lda #0
  sta oam_idx
  ldx #0
battle_sprite_pc:
  lda pc_in_party,x
  beq battle_sprite_pc_next
  lda pc_hp,x
  beq battle_sprite_pc_next ; a fallen member is not drawn
  lda pc_metasprite,x
  cmp #$FF
  beq battle_sprite_pc_next
  sta bt_tmp
  lda #BT_PARTY_X
  sta de_ex
  txa
  asl a
  asl a
  asl a
  asl a
  asl a                     ; slot * BT_PARTY_STEP
  clc
  adc #BT_PARTY_Y
  sta de_ey
  lda bt_tmp
  jsr draw_metasprite
battle_sprite_pc_next:
  inx
  cpx #MAX_PARTY
  bne battle_sprite_pc

  ldx #0
battle_sprite_mon:
  lda mon_slot_alive,x
  beq battle_sprite_mon_next
  ldy mon_slot_actor,x
  lda mon_tile,y
  cmp #$FF
  bne battle_sprite_mon_next ; it has block art, already on the background
  lda #BT_MON_COL*8
  sta de_ex
  txa
  asl a
  asl a
  asl a
  asl a
  asl a                     ; slot * 32 pixels
  clc
  adc #BT_MON_ROW*8
  sta de_ey
  tya
  jsr draw_actor_icon
battle_sprite_mon_next:
  inx
  cpx #MAX_MONSTERS
  bne battle_sprite_mon

  .if SPLIT_ENABLED
  ; The targeting cursor, when it is up: one sprite at the left of the chosen
  ; monster's row band. Appended last, so a full shadow costs the cursor its
  ; slot rather than a combatant theirs -- and the shadow is 64 sprites against
  ; a four-member party, so in practice it always fits.
  lda bt_tgt_vis
  beq battle_sprite_cursor_done
  ldy oam_idx
  lda bt_target
  sec
  sbc #MAX_PARTY
  asl a
  asl a
  asl a
  asl a
  asl a                     ; monster slot * 32 pixels between row bands
  clc
  adc #(BT_MON_ROW+1)*8-1   ; sprites render one line low
  sta OAM,y
  iny
  lda #SPRITE_ARROW_TILE
  sta OAM,y
  iny
  lda #0                    ; sprite palette 0, no flip -- the hearts' palette
  sta OAM,y
  iny
  lda #(BT_CMD_COL-1)*8
  sta OAM,y
  iny
  sty oam_idx
battle_sprite_cursor_done:
  .endif

  rts

bit_mask:
  .db $01,$02,$04,$08,$10,$20,$40,$80
