; nameentry.asm -- the in-game naming grid: A-Z, a-z, DEL, END, reusing the
; message box's own footprint (tile rows 24-29).
;
; One source file, two mutually exclusive placements, decided by
; NAME_ENTRY_BANKED (docs/design-name-entry.md §5): .include'd from
; engine/battle.asm (an RPG, banked, reached through call_battle via
; battle_entry's own BE_NAME_* arms) or from engine/main.asm directly (an
; action project, kernel-lo, reached with a plain jmp/jsr) -- never both for
; the same project. Every routine below references only kernel-lo code and
; kernel RAM, so the identical source text assembles to identical bytes on
; either placement: bt_tmp, ptr_lo/ptr_hi, pc_name_ram, box_row/box_state,
; TILE_SPACE/NAME_GRID_*/NAME_LEN (config.inc), pad_new/BTN_*,
; BOX_TEXT_ROWS/BOX_COLS/BOX_TEXT_LO/BOX_ADDR_HI, vram_open/vram_push/
; vram_end/box_text_row_addr (engine/text.asm), OAM/oam_idx/SPRITE_ARROW_TILE.
;
; Nothing here ever writes $8000/$8001 -- every write is either a plain RAM
; store or a vram_open/vram_push/vram_end call, so the MMC3 scanline split
; needs no protection around any of this file: switch_prg_bank (the only
; routine in this feature that touches those addresses at all) is called
; exclusively from call_battle itself, entirely outside this file.

  .if NAME_ENTRY_ENABLED
name_grid_control_col:
  .db 2, 22
name_grid_control_label:
  .db NAME_GRID_D_TILE, NAME_GRID_E_TILE, NAME_GRID_L_TILE
  .db NAME_GRID_E_TILE, NAME_GRID_N_TILE, NAME_GRID_D_TILE

; A = the party slot (0-3) this session names.
nameentry_begin:
  sta nm_target
  lda #0
  sta nm_row
  sta nm_col
  sta nm_acted
  jsr nameentry_seed_len
  rts

nameentry_seed_len:
  lda #LOW(pc_name_ram)
  sta <ptr_lo
  lda #HIGH(pc_name_ram)
  sta <ptr_hi
  lda nm_target
  jsr nameentry_stride
  ldy #NAME_LEN-1
nameentry_seed_scan:
  lda [ptr_lo],y
  cmp #TILE_SPACE
  bne nameentry_seed_found
  dey
  bpl nameentry_seed_scan
  lda #0
  sta nm_len
  rts
nameentry_seed_found:
  iny
  sty nm_len
  rts

; A DIFFERENT stride walk from name_offset_pc (engine/battle.asm) -- used
; purely internally by this file's own routines. Caller loads ptr_lo/hi with
; a table base, A = index (0-3); adds index*NAME_LEN into that pointer and
; leaves Y at 0.
nameentry_stride:
  tax
  beq nameentry_stride_done
nameentry_stride_loop:
  clc
  lda <ptr_lo
  adc #NAME_LEN
  sta <ptr_lo
  bcc nameentry_stride_next
  inc <ptr_hi
nameentry_stride_next:
  dex
  bne nameentry_stride_loop
nameentry_stride_done:
  ldy #0
  rts

nameentry_tick:
  lda <box_row
  cmp #BOX_TEXT_ROWS
  bcs nameentry_tick_idle
  jmp nameentry_raise_step
nameentry_tick_idle:
  lda <pad_new
  and #BTN_LEFT
  beq nameentry_tick_right
  jsr nameentry_move_left
  jmp nameentry_tick_done
nameentry_tick_right:
  lda <pad_new
  and #BTN_RIGHT
  beq nameentry_tick_up
  jsr nameentry_move_right
  jmp nameentry_tick_done
nameentry_tick_up:
  lda <pad_new
  and #BTN_UP
  beq nameentry_tick_down
  jsr nameentry_move_up
  jmp nameentry_tick_done
nameentry_tick_down:
  lda <pad_new
  and #BTN_DOWN
  beq nameentry_tick_done
  jsr nameentry_move_down
nameentry_tick_done:
  rts

nameentry_raise_step:
  jsr box_text_row_addr
  lda <box_row
  bne nameentry_raise_not0
  jsr nameentry_draw_preview
  jmp nameentry_raise_next
nameentry_raise_not0:
  cmp #1
  bne nameentry_raise_not1
  lda #NAME_GRID_UPPER_BASE
  jsr nameentry_draw_letters
  jmp nameentry_raise_next
nameentry_raise_not1:
  cmp #2
  bne nameentry_raise_ctrl
  lda #NAME_GRID_LOWER_BASE
  jsr nameentry_draw_letters
  jmp nameentry_raise_next
nameentry_raise_ctrl:
  jsr nameentry_draw_ctrl
nameentry_raise_next:
  jsr vram_end
  inc <box_row
  rts

nameentry_draw_letters:
  sta <bt_tmp
  lda #TILE_SPACE
  jsr vram_push
  ldx #0
nameentry_letters_loop:
  txa
  clc
  adc <bt_tmp
  jsr vram_push
  inx
  cpx #26
  bne nameentry_letters_loop
  lda #TILE_SPACE
  jmp vram_push

nameentry_draw_preview:
  lda #TILE_SPACE
  jsr vram_push
  lda #LOW(pc_name_ram)
  sta <ptr_lo
  lda #HIGH(pc_name_ram)
  sta <ptr_hi
  lda nm_target
  jsr nameentry_stride
nameentry_preview_loop:
  lda [ptr_lo],y
  jsr vram_push
  iny
  cpy #NAME_LEN
  bne nameentry_preview_loop
  ldx #BOX_COLS-NAME_LEN-1
nameentry_preview_pad:
  lda #TILE_SPACE
  jsr vram_push
  dex
  bne nameentry_preview_pad
  rts

nameentry_draw_ctrl:
  ldx #0
  ldy #0
ndc_loop:
  cpx name_grid_control_col
  bne ndc_try_end
  jsr ndc_label
  jmp ndc_next
ndc_try_end:
  cpx name_grid_control_col+1
  bne ndc_blank
  jsr ndc_label
  jmp ndc_next
ndc_blank:
  lda #TILE_SPACE
  jsr vram_push
ndc_next:
  inx
  cpx #BOX_COLS
  bne ndc_loop
  rts
ndc_label:
  lda name_grid_control_label,y
  jsr vram_push
  iny
  lda name_grid_control_label,y
  jsr vram_push
  iny
  lda name_grid_control_label,y
  jsr vram_push
  iny
  inx
  inx
  rts

nameentry_queue_cell:
  tya
  clc
  adc #BOX_TEXT_LO+1
  tay
  lda #BOX_ADDR_HI
  jsr vram_open
  lda <bt_tmp
  jsr vram_push
  jmp vram_end

; Reached from battle_entry's own BE_NAME_SELECT arm (banked), or directly
; from name_select's own !NAME_ENTRY_BANKED shim arm (action).
nameentry_select:
  lda nm_acted
  bne nameentry_select_done
  lda #1
  sta nm_acted
  lda nm_row
  cmp #2
  beq nameentry_select_ctrl
  lda nm_len
  cmp #NAME_LEN
  bcs nameentry_select_done
  jsr nameentry_current_tile
  sta <bt_tmp
  jsr nameentry_write_cell
  jmp nameentry_select_done
nameentry_select_ctrl:
  lda nm_col
  bne nameentry_select_end
  jsr nameentry_delete
  jmp nameentry_select_done
nameentry_select_end:
  lda #BOX_NAMEDONE
  sta <box_state
nameentry_select_done:
  rts

nameentry_cancel:
  lda nm_acted
  bne nameentry_cancel_done
  lda #1
  sta nm_acted
  jsr nameentry_delete
nameentry_cancel_done:
  rts

nameentry_current_tile:
  lda nm_row
  bne nameentry_ct_lower
  lda #NAME_GRID_UPPER_BASE
  jmp nameentry_ct_go
nameentry_ct_lower:
  lda #NAME_GRID_LOWER_BASE
nameentry_ct_go:
  clc
  adc nm_col
  rts

nameentry_write_cell:
  lda #LOW(pc_name_ram)
  sta <ptr_lo
  lda #HIGH(pc_name_ram)
  sta <ptr_hi
  lda nm_target
  jsr nameentry_stride
  ldy nm_len
  lda <bt_tmp
  sta [ptr_lo],y
  jsr nameentry_queue_cell
  inc nm_len
  rts

nameentry_delete:
  lda nm_len
  beq nameentry_delete_done
  dec nm_len
  lda #LOW(pc_name_ram)
  sta <ptr_lo
  lda #HIGH(pc_name_ram)
  sta <ptr_hi
  lda nm_target
  jsr nameentry_stride
  ldy nm_len
  lda #TILE_SPACE
  sta [ptr_lo],y
  sta <bt_tmp
  jsr nameentry_queue_cell
nameentry_delete_done:
  rts

nameentry_move_left:
  lda nm_row
  cmp #2
  beq nameentry_ml_ctrl
  lda nm_col
  bne nameentry_ml_dec
  lda #25
  sta nm_col
  rts
nameentry_ml_dec:
  dec nm_col
  rts
nameentry_ml_ctrl:
  lda nm_col
  eor #1
  sta nm_col
  rts

nameentry_move_right:
  lda nm_row
  cmp #2
  beq nameentry_mr_ctrl
  lda nm_col
  cmp #25
  bne nameentry_mr_inc
  lda #0
  sta nm_col
  rts
nameentry_mr_inc:
  inc nm_col
  rts
nameentry_mr_ctrl:
  jmp nameentry_ml_ctrl

; DOWN cycles forward through the grid in one clean ring: row 0 (A-Z) -> row 1
; (a-z), column preserved, both rows share the same 26 columns -> row 2
; (controls), column snapped by half -> row 0, wraps, column reset to 0
; unconditionally. See nameentry_move_up's own header for why UP is NOT
; simply this run backward.
nameentry_move_down:
  lda nm_row
  cmp #2
  beq nameentry_md_wrap
  inc nm_row
  lda nm_row
  cmp #2
  bne nameentry_md_done
  jsr nameentry_snap_ctrl
nameentry_md_done:
  rts
nameentry_md_wrap:
  lda #0
  sta nm_row
  sta nm_col
  rts

; UP is a DIFFERENT ring from DOWN's, deliberately (docs/design-name-entry.md
; §6, §16): from row 1, UP goes to row 0 with the column preserved -- the
; exact mirror of DOWN's row 0->1 step, so DOWN then UP from row 0 returns to
; exactly where it started. But from row 0 directly, UP jumps straight to row
; 2 (skipping row 1), snapped by the same column-half rule DOWN uses. And from
; row 2, UP goes to row 1 using a FIXED representative column keyed to which
; control was selected (DEL -> column 0, END -> column 25), not any
; column-half memory. The result: DOWN always visits row 0->1->2->0 in order,
; but UP's own ring is row 0->2->1->0 -- a different cycle that only agrees
; with DOWN's, and round-trips, on the row 0<->row 1 leg.
nameentry_move_up:
  lda nm_row
  bne nameentry_mu_dec
  lda #2
  sta nm_row
  jsr nameentry_snap_ctrl
  rts
nameentry_mu_dec:
  cmp #2
  bne nameentry_mu_plain
  lda nm_col
  bne nameentry_mu_end
  lda #0
  sta nm_col
  jmp nameentry_mu_row
nameentry_mu_end:
  lda #25
  sta nm_col
nameentry_mu_row:
  dec nm_row
  rts
nameentry_mu_plain:
  dec nm_row
  rts

nameentry_snap_ctrl:
  lda nm_col
  cmp #13
  bcc nameentry_snap_del
  lda #1
  sta nm_col
  rts
nameentry_snap_del:
  lda #0
  sta nm_col
  rts

draw_nameentry_cursor:
  ldy <oam_idx
  beq draw_ne_cursor_done
  lda nm_row
  clc
  adc #26
  asl a
  asl a
  asl a
  sec
  sbc #1
  sta OAM,y
  iny
  lda #SPRITE_ARROW_TILE
  sta OAM,y
  iny
  lda #0
  sta OAM,y
  iny
  jsr nameentry_cursor_x
  sta OAM,y
  iny
  sty <oam_idx
draw_ne_cursor_done:
  rts

nameentry_cursor_x:
  lda nm_row
  cmp #2
  bne nameentry_cx_letter
  ldx nm_col
  lda name_grid_control_col,x
  jmp nameentry_cx_go
nameentry_cx_letter:
  lda nm_col
  clc
  adc #1
nameentry_cx_go:
  asl a
  asl a
  asl a
  clc
  adc #NAME_GRID_TEXT_COL0
  rts
  .endif
