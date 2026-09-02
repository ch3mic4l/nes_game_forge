; battle.asm -- the turn-based battle system, in its own switchable PRG bank.
;
; Everything in this file is assembled at $8000 in the region shared/cartridge.js
; reserves with `codeRegions()`, which is *not* mapped most of the time: the
; switchable window normally holds screen data, and `player.asm` dereferences
; `mtptr` out of it every single frame. So there is exactly one way in and one
; way out, both in engine/banks.asm:
;
;   call_battle   switches this bank in, jsr's battle_entry, and restores the
;                 screen bank with `jsr set_screen_ptr` before returning.
;
; Nothing else in the engine may `jsr` into $8000-$BFFF. Calling *out* is free:
; the kernel at $C000-$FFFF is permanently mapped, so the tables and helpers in
; text.asm, ui.asm and entities.asm are all reachable from here.
;
; Combatants live in one index space -- 0-3 are party members, 4-7 monsters --
; which is what lets the cursor, the targeting and the turn order be one code
; path rather than two that have to agree.

battle_entry:
  lda bt_call
  bne battle_entry_tick
  jmp party_init
battle_entry_tick:
  cmp #BE_TICK
  bne battle_entry_join
  jmp battle_tick
battle_entry_join:
  ldx bt_arg                ; the Join command, run from the field mid-script
  jmp party_join

; ------------------------------------------------------------- a new game

; Build the party from the generated tables. Members who do not start in the
; party are left out until a Join command recruits them.
party_init:
  lda #0
  sta party_size
  sta gold_lo
  sta gold_hi
  ldx #0
party_init_slot:
  lda #0
  sta pc_in_party,x
  sta pc_xp_lo,x
  sta pc_xp_hi,x
  lda #1
  sta pc_level,x
  cpx #PARTY_SIZE
  bcs party_init_next
  lda pc_starts,x
  beq party_init_next
  jsr party_join
party_init_next:
  inx
  cpx #MAX_PARTY
  bne party_init_slot
  rts

; X = member index. Recruit them at their current level and fill them up.
party_join:
  lda pc_in_party,x
  bne party_join_done
  lda #1
  sta pc_in_party,x
  inc party_size
  jsr party_apply_level
  lda pc_hp_max,x
  sta pc_hp,x
  lda pc_mp_max,x
  sta pc_mp,x
party_join_done:
  rts

; X = member index. Read this member's stats for their current level out of the
; per-level tables. The tables are pre-computed by the generator because the
; 6502 has no multiply and fifteen bytes a member is cheaper than the code.
party_apply_level:
  txa
  jsr level_row             ; Y = member * MAX_LEVEL + level - 1
  lda pc_hp_at,y
  sta pc_hp_max,x
  lda pc_mp_at,y
  sta pc_mp_max,x
  lda pc_spells_at,y
  sta pc_spells,x
  rts

; A = member index; returns Y = that member's row for their current level.
level_row:
  sta bt_tmp
  lda #0
  ldy bt_tmp
  beq level_row_add         ; member 0 needs no stride
level_row_stride:
  clc
  adc #MAX_LEVEL
  dey
  bne level_row_stride
level_row_add:
  clc
  adc pc_level,x
  sec
  sbc #1
  tay
  rts

; ------------------------------------------------------------------ tick

; One frame of battle: advance the state machine, then rebuild the sprite
; shadow. The party and any metasprite monsters are the only sprites on screen,
; so this owns the whole shadow rather than appending to it.
battle_tick:
  jsr battle_dispatch
  jmp battle_draw_sprites

battle_dispatch:
  lda bt_phase
  cmp #BP_INTRO
  bne battle_tick_menu
  jmp battle_intro
battle_tick_menu:
  cmp #BP_MENU
  bne battle_tick_target
  jmp battle_menu
battle_tick_target:
  cmp #BP_TARGET
  bne battle_tick_spells
  jmp battle_target
battle_tick_spells:
  cmp #BP_SPELLS
  bne battle_tick_items
  jmp battle_list
battle_tick_items:
  cmp #BP_ITEMS
  bne battle_tick_act
  jmp battle_list
battle_tick_act:
  cmp #BP_ACT
  bne battle_tick_message
  jmp battle_act
battle_tick_message:
  cmp #BP_MESSAGE
  bne battle_tick_next
  jmp battle_message_wait
battle_tick_next:
  cmp #BP_NEXT
  bne battle_tick_over
  jmp battle_next
battle_tick_over:
  cmp #BP_DONE
  bne battle_tick_end
  jmp battle_finish
battle_tick_end:
  jmp battle_outcome        ; victory, defeat and running away all wait here

; ------------------------------------------------------------ the screen

battle_intro:
  jsr setup_monsters
  jsr draw_battle_screen
  jsr battle_round
  lda #BP_MENU
  sta bt_phase
  lda #0
  sta bt_actor
  jmp battle_first_turn

; Fill in each monster slot's hit points from its actor's row.
setup_monsters:
  lda #0
  sta bt_count
  ldx #0
setup_monsters_slot:
  lda #0
  sta mon_slot_alive,x
  sta mon_slot_status,x
  lda mon_slot_actor,x
  cmp #$FF
  beq setup_monsters_next
  tay
  lda mon_hp,y
  sta mon_slot_hp,x
  sta mon_slot_max,x
  lda mon_mp,y
  sta mon_slot_mp,x
  lda #1
  sta mon_slot_alive,x
  inc bt_count
setup_monsters_next:
  inx
  cpx #MAX_MONSTERS
  bne setup_monsters_slot
  rts

; Drawn once, with rendering off. Everything after this goes through the NMI
; queue, so there is never a second force-blank in the middle of a battle.
draw_battle_screen:
  lda #$00
  sta $2000
  sta $2001
  .if SPLIT_ENABLED
  sta $E000                 ; scanline counter off while the mainline owns the
                            ; mapper registers -- same rule as redraw_screen
  .endif
  jsr vram_reset
  ; The monsters are drawn out of their own CHR bank, which is the other half of
  ; why an RPG needs a cartridge that can switch banks. redraw_screen puts the
  ; field's tileset back on the way out.
  lda #BATTLE_TILESET
  jsr switch_chr_bank

  ldy flat_screen
  lda screen_map,y
  sta bt_tmp2               ; this map's backdrop tiles

  bit $2002
  lda #$20
  sta $2006
  lda #$00
  sta $2006

  lda #0
  sta bt_tmp                ; row
draw_bs_row:
  lda bt_tmp
  cmp #BT_SKY_ROWS
  bcc draw_bs_sky
  cmp #BT_BOX_ROW
  bcs draw_bs_box
  ldy bt_tmp2
  lda map_battle_ground,y
  jmp draw_bs_fill
draw_bs_sky:
  ldy bt_tmp2
  lda map_battle_sky,y
  jmp draw_bs_fill
draw_bs_box:
  lda #TILE_SPACE
draw_bs_fill:
  ldy #32
draw_bs_cell:
  sta $2007
  dey
  bne draw_bs_cell
  inc bt_tmp
  lda bt_tmp
  cmp #30
  bne draw_bs_row

  jsr draw_box_frame
  jsr draw_monsters
  jsr draw_battle_attr
  jsr draw_commands
  jsr draw_panel

  jsr wait_vblank_poll
  jmp enable_rendering

; The frame around the bottom box, drawn straight to $2007 while the picture is
; off. Same furniture as the message box, so the two read as one interface.
draw_box_frame:
  lda #BT_BOX_ROW
  sta bt_row
draw_box_row:
  lda #0
  sta bt_col
  jsr seek_at
  lda bt_row
  cmp #BT_BOX_ROW
  beq draw_box_edge
  cmp #29
  beq draw_box_edge
  lda #BORDER_V
  sta $2007
  ldy #30
  lda #TILE_SPACE
draw_box_mid:
  sta $2007
  dey
  bne draw_box_mid
  lda #BORDER_V
  sta $2007
  jmp draw_box_next
draw_box_edge:
  lda #BORDER_CORNER
  sta $2007
  ldy #30
  lda #BORDER_H
draw_box_bar:
  sta $2007
  dey
  bne draw_box_bar
  lda #BORDER_CORNER
  sta $2007
draw_box_next:
  inc bt_row
  lda bt_row
  cmp #30
  bne draw_box_row
  rts

; bt_row / bt_col -> the PPU's write address. A row is 32 tiles and a nametable
; is $400 bytes, so the high byte is $20 + (row >> 3) and the low byte cannot
; carry: (row & 7) * 32 + col tops out at 255.
seek_at:
  lda bt_row
  lsr a
  lsr a
  lsr a
  clc
  adc #$20
  bit $2002
  sta $2006
  lda bt_row
  and #7
  asl a
  asl a
  asl a
  asl a
  asl a
  clc
  adc bt_col
  sta $2006
  rts

; Each monster is a block of background tiles on the battle tileset, laid out on
; a 16-wide sheet. An actor with no block art is drawn as sprites instead, so
; every actor in the project can fight without having to be redrawn for it.
draw_monsters:
  ldx #0
draw_mon_slot:
  lda mon_slot_alive,x
  beq draw_mon_next
  ldy mon_slot_actor,x
  lda mon_tile,y
  cmp #$FF
  beq draw_mon_next         ; metasprite fallback, drawn with the sprites
  jsr draw_mon_block
draw_mon_next:
  inx
  cpx #MAX_MONSTERS
  bne draw_mon_slot
  rts

; X = monster slot, Y = its actor id.
draw_mon_block:
  lda mon_tile,y
  sta bt_tmp                ; the row's first tile
  lda mon_h,y
  sta bt_tmp2               ; rows left
  txa
  asl a
  asl a                     ; slot * BT_MON_STEP
  clc
  adc #BT_MON_ROW
  sta bt_row
draw_mon_block_row:
  lda #BT_MON_COL
  sta bt_col
  jsr seek_at
  ldy mon_slot_actor,x
  lda mon_w,y
  sta bt_digits             ; columns left
  lda bt_tmp
  sta bt_digits+1           ; the tile being written
draw_mon_block_cell:
  lda bt_digits+1
  sta $2007
  inc bt_digits+1
  dec bt_digits
  bne draw_mon_block_cell
  lda bt_tmp
  clc
  adc #16                   ; the art is a 16-wide region of the tileset
  sta bt_tmp
  inc bt_row
  dec bt_tmp2
  bne draw_mon_block_row
  rts

; Sky on background palette 0, ground on 1, the box back on 0, and one byte per
; monster for its own tint. A monster's art is anchored to a four-row, four-column
; grid precisely so that one attribute byte covers all of it.
draw_battle_attr:
  bit $2002
  lda #$23
  sta $2006
  lda #$C0
  sta $2006
  ldy #0
draw_attr_byte:
  tya
  lsr a
  lsr a
  lsr a                     ; attribute row
  beq draw_attr_zero        ; row 0: the sky
  cmp #5
  bcs draw_attr_zero        ; rows 5-7: the box
  lda #$55                  ; rows 1-4: the ground
  jmp draw_attr_write
draw_attr_zero:
  lda #$00
draw_attr_write:
  sta $2007
  iny
  cpy #64
  bne draw_attr_byte

  ; Then one byte per live monster, over the top.
  ldx #0
draw_attr_mon:
  lda mon_slot_alive,x
  beq draw_attr_mon_next
  ldy mon_slot_actor,x
  lda mon_tile,y
  cmp #$FF
  beq draw_attr_mon_next
  txa
  clc
  adc #1                    ; attribute row 1 + slot
  asl a
  asl a
  asl a
  clc
  adc #1                    ; attribute column 1 holds tile columns 4-7
  sta bt_tmp
  bit $2002
  lda #$23
  sta $2006
  lda #$C0
  clc
  adc bt_tmp
  sta $2006
  ldy mon_slot_actor,x
  lda mon_attr,y
  sta $2007
draw_attr_mon_next:
  inx
  cpx #MAX_MONSTERS
  bne draw_attr_mon
  rts

; FIGHT / MAGIC / ITEM / RUN down the left of the box.
draw_commands:
  lda #0
  sta bt_tmp
draw_cmd_row:
  lda bt_tmp
  asl a
  clc
  adc #BT_CMD_ROW
  sta bt_row
  lda #BT_CMD_COL
  sta bt_col
  jsr seek_at
  lda bt_tmp
  jsr name_offset_cmd
draw_cmd_char:
  lda cmd_names,y
  sta $2007
  iny
  dec bt_tmp2
  bne draw_cmd_char
  inc bt_tmp
  lda bt_tmp
  cmp #NUM_COMMANDS
  bne draw_cmd_row
  rts

; A = command index; returns Y = its first glyph and bt_tmp2 = the length.
name_offset_cmd:
  asl a
  asl a
  asl a                     ; CMD_NAME_LEN is 8
  tay
  lda #8
  sta bt_tmp2
  rts

; Names and hit points down the right of the box, one member per two rows.
draw_panel:
  ldx #0
draw_panel_slot:
  lda pc_in_party,x
  beq draw_panel_next
  txa
  asl a
  clc
  adc #BT_PANEL_ROW
  sta bt_row
  lda #BT_PANEL_COL
  sta bt_col
  jsr seek_at
  lda #LOW(pc_name)
  sta ptr_lo
  lda #HIGH(pc_name)
  sta ptr_hi
  txa
  jsr name_offset_pc
draw_panel_char:
  lda [ptr_lo],y
  sta $2007
  iny
  dec bt_tmp2
  bne draw_panel_char
draw_panel_next:
  inx
  cpx #MAX_PARTY
  bne draw_panel_slot
  rts

; A = an entry's index into whichever name table the caller has already based
; at ptr_lo/ptr_hi (the generic 16-bit pointer, engine/constants.asm). Adds
; index * NAME_LEN into that pointer -- as a 16-bit address, not the 8-bit
; offset this used to hand back, which silently wrapped at index 26 (NAME_LEN
; is 10; 26*10 = 260, and the discarded carry left every reader pointing four
; glyphs into the next entry). Returns Y = 0 and bt_tmp2 = NAME_LEN as before,
; so every consumer's loop is unchanged in shape: lda [ptr_lo],y / iny /
; dec bt_tmp2 / bne.
;
; Adds NAME_LEN into the pointer `index` times rather than a shift-add, so the
; loop stays parameterized by NAME_LEN (config.inc's single writer for it,
; via assets/battle.inc) instead of a decomposition baked in for whatever
; NAME_LEN happens to be today. Preserves X, which draw_panel's own caller
; relies on across the call.
;
; Cost is bounded by the largest legal index, LIMITS.actors/items = 254: at
; most 254 sixteen-bit adds, each ~18 cycles (~22 on the roughly one-in-26
; that carry) -- worst case is under 4,700 cycles, and draw_list calls this at
; most four times in one tick (under 18,800 cycles), push_combatant_name once
; per message. Both stay comfortably inside a frame's ~29,780-cycle NTSC
; budget, with the rest of that frame's own work still to run.
name_offset_pc:
  tay
  beq name_offset_pc_len
name_offset_pc_stride:
  clc
  lda ptr_lo
  adc #NAME_LEN
  sta ptr_lo
  bcc name_offset_pc_nocarry
  inc ptr_hi
name_offset_pc_nocarry:
  dey
  bne name_offset_pc_stride
name_offset_pc_len:
  ldy #0
  lda #NAME_LEN
  sta bt_tmp2
  rts

  .include "battleui.asm"
  .include "battleturn.asm"
