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
  lda <bt_call
  bne battle_entry_tick
  jmp party_init
battle_entry_tick:
  cmp #BE_TICK
  bne battle_entry_join
  jmp battle_tick
battle_entry_join:
  cmp #BE_JOIN
  bne battle_entry_restore
  ldx <bt_arg                ; the Join command, run from the field mid-script
  ; A stale or hand-edited member (NO_MEMBER, or a numeric one the deleting
  ; party member's own party.length no longer covers) must not reach
  ; party_apply_level -> level_row, whose per-level tables are sized to
  ; PARTY_SIZE * MAX_LEVEL, not MAX_PARTY * MAX_LEVEL -- the same access
  ; party_init_slot already guards a few lines below (cpx #PARTY_SIZE /
  ; bcs party_init_next) before its own call to party_join. This is that
  ; guard's twin for the *other* caller: party_init already protects itself,
  ; and this is the asymmetry that was the defect.
  cpx #PARTY_SIZE
  bcs battle_entry_join_skip
  jmp party_join
battle_entry_join_skip:
  rts                        ; back to call_battle's own jmp set_screen_ptr --
                              ; battle_entry is reached by jsr, never jmp, so
                              ; this rts is the correct, and only, return.
battle_entry_restore:
  .if NAME_ENTRY_ENABLED
  cmp #BE_RESTORE
  bne be_name_begin_chk
  .endif
  jmp party_restore
  .if NAME_ENTRY_ENABLED
; The naming grid's own five entry points (engine/nameentry.asm), reached
; only through the kernel-lo shims' own NAME_ENTRY_BANKED arm -- never
; directly, and never on an action project, where nameentry.asm assembles
; into kernel-lo instead and this whole dispatch chain does not exist.
be_name_begin_chk:
  cmp #BE_NAME_BEGIN
  bne be_name_tick_chk
  lda <bt_arg
  jmp nameentry_begin
be_name_tick_chk:
  cmp #BE_NAME_TICK
  bne be_name_draw_chk
  jmp nameentry_tick
be_name_draw_chk:
  cmp #BE_NAME_DRAW
  bne be_name_select_chk
  jmp draw_nameentry_cursor
be_name_select_chk:
  cmp #BE_NAME_SELECT
  bne be_name_cancel_chk
  jmp nameentry_select
be_name_cancel_chk:
  cmp #BE_NAME_CANCEL
  bne be_entry_done
  jmp nameentry_cancel
be_entry_done:
  rts
  .endif

; ------------------------------------------------------------- a new game

; Build the party from the generated tables. Members who do not start in the
; party are left out until a Join command recruits them.
party_init:
  lda #0
  sta <party_size
  sta <gold_lo
  sta <gold_hi
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
  inc <party_size
  ; Seeds pc_name_ram from the banked pc_name table -- widened from
  ; NAME_ENTRY_ENABLED to the wider NAME_SEED_ENABLED union
  ; (docs/design-name-entry.md §8, P1-2): party_init already calls this
  ; routine for every starting member, member 0 (the hero) included, so this
  ; is the RPG's own working seed path -- nameentry_begin's own preview-row
  ; scan (engine/nameentry.asm) needs a real name already sitting here the
  ; instant a naming session opens.
  .if NAME_SEED_ENABLED
  lda #LOW(pc_name)
  sta <ptr_lo
  lda #HIGH(pc_name)
  sta <ptr_hi
  txa
  jsr name_offset_pc
  stx <bt_tmp
  lda #0
name_copy_dst_loop:
  cpx #0
  beq name_copy_dst_ready
  clc
  adc #NAME_LEN
  dex
  jmp name_copy_dst_loop
name_copy_dst_ready:
  tax
  ldy #0
name_copy_loop:
  lda [ptr_lo],y
  sta pc_name_ram,x
  iny
  inx
  cpy #NAME_LEN
  bne name_copy_loop
  ldx <bt_tmp
  .endif
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

; BE_RESTORE: continue_game (engine/save.asm) calls this once, right after
; load_apply_body has overwritten RAM with the save record, to recompute
; every member's pc_spells (and, as an accepted side effect, pc_hp_max/
; pc_mp_max) from their restored pc_level against the *current* build's own
; tables. The save's raw pc_spells byte is a bitmask of catalog *positions*,
; not spell ids, and nothing renumbers it when a spell is deleted -- a save
; written before the delete would otherwise restore a party that knows the
; wrong spell, or one that no longer exists.
;
; Unconditional over every PARTY_SIZE slot, live or not -- no pc_in_party
; check. An unjoined slot's pc_spells/pc_hp_max/pc_mp_max are dead data by
; the engine's own convention (nothing reads them until pc_in_party goes
; live), and the only other writer that ever sets pc_in_party, party_join,
; unconditionally calls party_apply_level again the moment it does -- so
; whatever this loop computes for an unjoined slot is guaranteed to be
; overwritten with the then-current level's own figures regardless.
;
; Bounded PARTY_SIZE, not MAX_PARTY: pc_hp_at/pc_mp_at/pc_spells_at are each
; sized to the authored party count, not the fixed RAM capacity -- a
; MAX_PARTY-bounded loop would read past the end of those tables the moment
; a project's own party is smaller than four, which sample-rpg's already is.
; party_apply_level preserves X (it only ever reads X via txa; level_row
; never touches X), so the loop needs no save/restore of its own index
; across the call.
party_restore:
  ldx #0
party_restore_slot:
  jsr party_apply_level
  inx
  cpx #PARTY_SIZE
  bne party_restore_slot
  rts

; A = member index; returns Y = that member's row for their current level.
level_row:
  sta <bt_tmp
  lda #0
  ldy <bt_tmp
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

; One frame of battle: pay down any wipe still owed from a dead monster, then
; advance the state machine, then rebuild the sprite shadow. The party and any
; metasprite monsters are the only sprites on screen, so this owns the whole
; shadow rather than appending to it.
battle_tick:
  jsr wipe_tick
  jsr battle_dispatch
  jmp battle_draw_sprites

; A dying monster's own block wipe is budgeted at one row a frame (see
; bt_wipe_mask/bt_wipe_row/bt_wipe_slot, engine/constants.asm): four dead
; monsters in the same tick used to queue wipe_monster's whole four-row sweep
; four times over -- up to 176 bytes of PPUDATA in one frame, past the
; ~2273-cycle vblank window -- so apply_damage_mon (engine/battleturn.asm)
; only sets a bit now, and this is what actually queues a row, called first
; thing in battle_tick so it never competes with whatever the state machine
; below queues the same frame.
;
; The active slot is sticky: a fresh pick (lowest set bit) only happens when
; bt_wipe_row is back at zero, i.e. nothing is mid-wipe. Re-picking the
; lowest bit every frame regardless -- the review's own finding -- let a
; newly-dead lower slot steal a higher slot's in-progress bt_wipe_row, so the
; lower slot inherited whatever row the interrupted one had reached and its
; own earlier rows were never queued at all.
wipe_tick:
  lda <bt_wipe_mask
  bne wipe_tick_go
  rts
wipe_tick_go:
  lda <bt_wipe_row
  bne wipe_tick_slot        ; mid-wipe: bt_wipe_slot already names who
  ldx #0
wipe_tick_bit:
  lda bit_mask,x
  and <bt_wipe_mask
  bne wipe_tick_pick
  inx
  cpx #MAX_MONSTERS
  bne wipe_tick_bit
  rts                       ; unreachable: bt_wipe_mask was non-zero above
wipe_tick_pick:
  stx <bt_wipe_slot
wipe_tick_slot:
  ldx <bt_wipe_slot
  jsr wipe_monster
  inc <bt_wipe_row
  lda <bt_wipe_row
  cmp #4
  bcc wipe_tick_done
  lda #0
  sta <bt_wipe_row
  ldx <bt_wipe_slot
  lda bit_mask,x
  eor #$FF
  and <bt_wipe_mask
  sta <bt_wipe_mask
wipe_tick_done:
  rts

battle_dispatch:
  lda <bt_phase
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
  sta <bt_phase
  lda #0
  sta <bt_actor
  jmp battle_first_turn

; Fill in each monster slot's hit points from its actor's row.
setup_monsters:
  lda #0
  sta <bt_count
  sta <bt_wipe_mask
  sta <bt_wipe_row
  sta <bt_wipe_slot
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
  inc <bt_count
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

  ldy <flat_screen
  lda screen_map,y
  sta <bt_tmp2               ; this map's backdrop tiles

  bit $2002
  lda #$20
  sta $2006
  lda #$00
  sta $2006

  lda #0
  sta <bt_tmp                ; row
draw_bs_row:
  lda <bt_tmp
  cmp #BT_SKY_ROWS
  bcc draw_bs_sky
  cmp #BT_BOX_ROW
  bcs draw_bs_box
  ldy <bt_tmp2
  lda map_battle_ground,y
  jmp draw_bs_fill
draw_bs_sky:
  ldy <bt_tmp2
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
  inc <bt_tmp
  lda <bt_tmp
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
  sta <bt_row
draw_box_row:
  lda #0
  sta <bt_col
  jsr seek_at
  lda <bt_row
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
  inc <bt_row
  lda <bt_row
  cmp #30
  bne draw_box_row
  rts

; bt_row / bt_col -> the PPU's write address. A row is 32 tiles and a nametable
; is $400 bytes, so the high byte is $20 + (row >> 3) and the low byte cannot
; carry: (row & 7) * 32 + col tops out at 255.
seek_at:
  lda <bt_row
  lsr a
  lsr a
  lsr a
  clc
  adc #$20
  bit $2002
  sta $2006
  lda <bt_row
  and #7
  asl a
  asl a
  asl a
  asl a
  asl a
  clc
  adc <bt_col
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
  sta <bt_tmp                ; the row's first tile
  lda mon_h,y
  sta <bt_tmp2               ; rows left
  txa
  asl a
  asl a                     ; slot * BT_MON_STEP
  clc
  adc #BT_MON_ROW
  sta <bt_row
draw_mon_block_row:
  lda #BT_MON_COL
  sta <bt_col
  jsr seek_at
  ldy mon_slot_actor,x
  lda mon_w,y
  sta bt_digits             ; columns left
  lda <bt_tmp
  sta bt_digits+1           ; the tile being written
draw_mon_block_cell:
  lda bt_digits+1
  sta $2007
  inc bt_digits+1
  dec bt_digits
  bne draw_mon_block_cell
  lda <bt_tmp
  clc
  adc #16                   ; the art is a 16-wide region of the tileset
  sta <bt_tmp
  inc <bt_row
  dec <bt_tmp2
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
  sta <bt_tmp
  bit $2002
  lda #$23
  sta $2006
  lda #$C0
  clc
  adc <bt_tmp
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
  sta <bt_tmp
draw_cmd_row:
  lda <bt_tmp
  asl a
  clc
  adc #BT_CMD_ROW
  sta <bt_row
  lda #BT_CMD_COL
  sta <bt_col
  jsr seek_at
  lda <bt_tmp
  jsr name_offset_cmd
draw_cmd_char:
  lda cmd_names,y
  sta $2007
  iny
  dec <bt_tmp2
  bne draw_cmd_char
  inc <bt_tmp
  lda <bt_tmp
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
  sta <bt_tmp2
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
  sta <bt_row
  lda #BT_PANEL_COL
  sta <bt_col
  jsr seek_at
  ; A party slot's own name reads pc_name_ram once naming is on -- the
  ; player's actual, possibly-typed name, not the compiled default
  ; (docs/design-name-entry.md §3).
  .if NAME_ENTRY_ENABLED
  lda #LOW(pc_name_ram)
  sta <ptr_lo
  lda #HIGH(pc_name_ram)
  sta <ptr_hi
  .endif
  .if !NAME_ENTRY_ENABLED
  lda #LOW(pc_name)
  sta <ptr_lo
  lda #HIGH(pc_name)
  sta <ptr_hi
  .endif
  txa
  jsr name_offset_pc
draw_panel_char:
  lda [ptr_lo],y
  sta $2007
  iny
  dec <bt_tmp2
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
  lda <ptr_lo
  adc #NAME_LEN
  sta <ptr_lo
  bcc name_offset_pc_nocarry
  inc <ptr_hi
name_offset_pc_nocarry:
  dey
  bne name_offset_pc_stride
name_offset_pc_len:
  ldy #0
  lda #NAME_LEN
  sta <bt_tmp2
  rts

  .include "battleui.asm"
  .include "battleturn.asm"
  .if NAME_ENTRY_ENABLED
  .include "nameentry.asm"
  .endif
