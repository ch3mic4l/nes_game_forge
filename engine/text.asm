; text.asm -- the NMI VRAM queue, and the message window built on top of it.
;
; The engine draws a screen once with rendering off and never touches the
; nametable again, so there was no way to change a tile mid-frame. A message box
; needs exactly that, and vblank is far too short to write six rows of tiles in
; one go. The queue is the answer: the main loop appends packets during the
; frame and NMI streams them out after the OAM DMA, one frame's worth per
; vblank. Every multi-frame job below (opening, clearing a page, closing) is
; therefore a state machine advanced one step per tick.
;
; The producer caps itself at one 32-byte row per frame -- 32 bytes is ~480
; cycles of drain, which fits vblank alongside the 513-cycle OAM DMA with room
; to spare. Nothing here formats numbers or reads tables inside NMI: the drain
; only copies bytes.

; --------------------------------------------------------------- the queue

; Drop everything queued. Called after a redraw, which rewrites the whole
; nametable and so makes any pending write meaningless.
vram_reset:
  lda #0
  sta vram_len
  sta vram_ready
  sta vram_buf              ; the terminator
  rts

; Open a packet: A = address high byte, Y = address low byte. The count starts
; at zero and vram_push raises it. Preserves X.
vram_open:
  stx vram_tmp
  ldx vram_len
  sta vram_buf,x
  inx
  tya
  sta vram_buf,x
  inx
  lda #0
  sta vram_buf,x
  stx vram_cnt
  inx
  stx vram_len
  ldx vram_tmp
  rts

; A = the next byte of the open packet. Preserves X and Y.
vram_push:
  stx vram_tmp
  ldx vram_len
  sta vram_buf,x
  inc vram_len
  ldx vram_cnt
  inc vram_buf,x
  ldx vram_tmp
  rts

; Terminate the queue after the open packet. Writing the terminator without
; consuming it means the next vram_open simply overwrites it. Preserves X.
vram_end:
  stx vram_tmp
  ldx vram_len
  lda #0
  sta vram_buf,x
  ldx vram_tmp
  rts

; Called from NMI with A, X and Y already saved. The queue is one page, so X
; walks all of it; the packet count is small enough for Y.
vram_drain:
  ldx #0
vram_drain_packet:
  lda vram_buf,x            ; address high byte, $00 terminates
  beq vram_drain_done
  bit $2002                 ; reset the address latch before each packet
  sta $2006
  inx
  lda vram_buf,x
  sta $2006
  inx
  ldy vram_buf,x
  inx
vram_drain_byte:
  lda vram_buf,x
  sta $2007
  inx
  dey
  bne vram_drain_byte
  jmp vram_drain_packet
vram_drain_done:
  lda #0
  sta vram_len
  sta vram_ready
  rts

; ---------------------------------------------------------- the message box

; Start typing the string whose pointer is already in msg_ptr, raising the box
; first if it is not already up.
box_say:
  lda #0
  sta msg_col
  sta msg_line
  lda box_state
  bne box_say_open          ; the box is already up: type straight into it
  sta box_row
  lda #BOX_OPENING
  sta box_state
  rts
box_say_open:
  lda #BOX_CLEARING         ; a second message reuses the frame, wiping the text
  sta box_state
  lda #0
  sta box_row
  rts

; Take the box down again and hand back to the script.
box_close:
  lda box_state
  beq box_close_done        ; never opened -- portrait-only dialogue
  lda #0
  sta box_row
  lda #BOX_CLOSING
  sta box_state
  rts
box_close_done:
  jmp close_ui

; One step per frame. Run from ui_tick, so the world is frozen throughout.
text_tick:
  lda box_state
  bne text_tick_go
  rts
text_tick_go:
  cmp #BOX_OPENING
  bne text_tick_typing
  jmp text_open_step
text_tick_typing:
  cmp #BOX_TYPING
  bne text_tick_clearing
  jmp text_type_step
text_tick_clearing:
  cmp #BOX_CLEARING
  bne text_tick_closing
  jmp text_clear_step
text_tick_closing:
  cmp #BOX_CLOSING
  bne text_tick_wait
  jmp text_close_step
text_tick_wait:
  rts                       ; the two WAIT states are waiting for the player

; The confirm/cancel action, while a box is up. Only the two waits react: a
; press during the typewriter is ignored rather than queued.
text_advance:
  lda box_state
  cmp #BOX_PAGEWAIT
  beq text_advance_page
  cmp #BOX_ENDWAIT
  beq text_advance_end
  rts
text_advance_page:
  jsr text_hide_arrow
  lda #0
  sta box_row
  lda #BOX_CLEARING
  sta box_state
  rts
text_advance_end:
  jsr text_hide_arrow
  jmp script_resume

; ------------------------------------------------------------------- steps

; Raise the frame, one tile row per frame, then the attributes.
text_open_step:
  lda box_row
  cmp #BOX_ROWS_HIGH
  bcs text_open_attr
  jsr box_row_addr
  lda box_row
  beq text_open_edge
  cmp #BOX_ROWS_HIGH-1
  beq text_open_edge
  lda #BORDER_V             ; an interior row: frame, blanks, frame
  sta tmp
  lda #TILE_SPACE
  sta tmp2
  jmp text_open_row
text_open_edge:
  lda #BORDER_CORNER        ; top and bottom: corner, rule, corner
  sta tmp
  lda #BORDER_H
  sta tmp2
text_open_row:
  lda tmp
  jsr vram_push
  ldy #30
text_open_row_loop:
  lda tmp2
  jsr vram_push
  dey
  bne text_open_row_loop
  lda tmp
  jsr vram_push
  jsr vram_end
  inc box_row
  rts

text_open_attr:
  lda #BOX_ADDR_HI
  ldy #BOX_ATTR_LO
  jsr vram_open
  ldy #16
text_open_attr_loop:
  lda #0                    ; the whole box takes background palette 0, which is
  jsr vram_push             ; the one validateProject checks for contrast
  dey
  bne text_open_attr_loop
  jsr vram_end
  lda #0
  sta msg_col
  sta msg_line
  lda #BOX_TYPING
  sta box_state
  rts

; One glyph per frame -- the typewriter.
text_type_step:
  ldy #0
  lda [msg_ptr_lo],y
  bne text_type_control
  lda #BOX_ENDWAIT
  sta box_state
  jmp text_show_arrow
text_type_control:
  cmp #TXT_NEWLINE
  bne text_type_page
  jsr msg_advance
  inc msg_line
  lda #0
  sta msg_col
  rts
text_type_page:
  cmp #TXT_PAGE
  bne text_type_glyph
  jsr msg_advance
  lda #BOX_PAGEWAIT
  sta box_state
  jmp text_show_arrow
text_type_glyph:
  jsr text_put_char
  jsr msg_advance
  inc msg_col
  rts

msg_advance:
  inc msg_ptr_lo
  bne msg_advance_done
  inc msg_ptr_hi
msg_advance_done:
  rts

; A = glyph tile, written at msg_line/msg_col.
text_put_char:
  pha
  lda msg_line
  asl a
  asl a
  asl a
  asl a
  asl a                     ; line * 32
  clc
  adc msg_col
  clc
  adc #BOX_TEXT_LO
  tay
  lda #BOX_ADDR_HI
  jsr vram_open
  pla
  jsr vram_push
  jmp vram_end

text_show_arrow:
  lda #ARROW_TILE
  jmp text_arrow_write
text_hide_arrow:
  lda #TILE_SPACE
text_arrow_write:
  pha
  lda #BOX_ADDR_HI
  ldy #ARROW_LO
  jsr vram_open
  pla
  jsr vram_push
  jmp vram_end

; Wipe the four text rows, one per frame, then start typing again.
text_clear_step:
  lda box_row
  cmp #BOX_TEXT_ROWS
  bcs text_clear_done
  lda box_row
  asl a
  asl a
  asl a
  asl a
  asl a
  clc
  adc #BOX_TEXT_LO
  tay
  lda #BOX_ADDR_HI
  jsr vram_open
  ldy #BOX_COLS
text_clear_loop:
  lda #TILE_SPACE
  jsr vram_push
  dey
  bne text_clear_loop
  jsr vram_end
  inc box_row
  rts
text_clear_done:
  lda #0
  sta msg_col
  sta msg_line
  lda #BOX_TYPING
  sta box_state
  rts

; Put the world back. The box covers metatile rows 12-14 exactly, so each of its
; six tile rows is one half of one metatile row and can be rebuilt straight from
; the screen's own data -- no copy of what was underneath has to be kept.
text_close_step:
  lda box_row
  cmp #BOX_ROWS_HIGH
  bcs text_close_attr
  jsr box_row_addr

  lda box_row
  lsr a                     ; two tile rows per metatile row
  clc
  adc #BOX_MT_ROW
  asl a
  asl a
  asl a
  asl a                     ; * 16 metatiles per row
  sta tmp
  lda box_row
  and #1                    ; 0 = the metatiles' top halves, 1 = their bottoms
  sta tmp2
  lda #0
  sta box_col
text_close_cell:
  lda tmp
  clc
  adc box_col
  tay
  lda [mtptr_lo],y
  tay
  lda tmp2
  bne text_close_bottom
  lda mt_tl,y
  jsr vram_push
  lda mt_tr,y
  jsr vram_push
  jmp text_close_next
text_close_bottom:
  lda mt_bl,y
  jsr vram_push
  lda mt_br,y
  jsr vram_push
text_close_next:
  inc box_col
  lda box_col
  cmp #16
  bne text_close_cell
  jsr vram_end
  inc box_row
  rts

text_close_attr:
  lda #BOX_ADDR_HI
  ldy #BOX_ATTR_LO
  jsr vram_open
  lda #48                   ; attribute bytes 48-63 are the box's four rows
  sta box_col
text_close_attr_loop:
  ldy box_col
  lda [atptr_lo],y
  jsr vram_push
  inc box_col
  lda box_col
  cmp #64
  bne text_close_attr_loop
  jsr vram_end
  lda #BOX_CLOSED
  sta box_state
  jmp close_ui

; Open a packet at the box's box_row'th tile row. The whole box lives inside one
; page of the nametable, so only the low byte varies.
box_row_addr:
  lda box_row
  asl a
  asl a
  asl a
  asl a
  asl a                     ; row * 32
  tay
  lda #BOX_ADDR_HI
  jmp vram_open
