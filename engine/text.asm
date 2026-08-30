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
;
; **A packet that is opened must be pushed to at least once.** vram_drain_byte
; tests its counter after decrementing it, so a count of zero is 256 -- a whole
; page of whatever the queue happened to hold, written into the nametable and
; running long past the end of vblank. A producer therefore has to *know* it has
; a byte before it calls vram_open: either because it always does (the
; fixed-width rows, the one-tile writes, the engine's own strings, which are
; never empty) or because it looked first. Listing a question's options is the
; one that has to look, because an answer whose label has not been written yet
; is an ordinary thing for a project to be holding. The drain is not defended
; against it: it runs in NMI, and a second answer to the question of what a
; packet is would cost every frame.

; --------------------------------------------------------------- the queue

; Drop everything queued. Called after a redraw, which rewrites the whole
; nametable and so makes any pending write meaningless.
;
; vram_reset now requires forced blank for its entire call -- it clobbers A,
; X and Y, and, when FLASH_ENABLED, may leave the PPU's internal address
; register pointed inside palette space; a caller must establish its own
; non-palette PPUADDR (or otherwise write more VRAM) before re-enabling
; rendering. Shipped 8beba40 code only ever loaded/stored A here; the Flash
; addition below is what first widens the contract, because
; fade_apply_palette and vram_drain both use X (vram_drain uses Y too) as
; loop counters with no save/restore of their own. Both real callers
; (redraw_screen, engine/screens.asm; draw_battle_screen, engine/battle.asm)
; are safe regardless: each already reloads every working register it needs,
; and each reaches its own further $2006/$2007 setup before writing another
; VRAM byte or calling enable_rendering, so neither the widened clobber nor a
; stale palette-space PPUADDR is ever observed. Whoever adds a third caller
; must keep both of those true.
vram_reset:
  lda #0
  sta vram_len
  sta vram_ready
  sta vram_buf              ; the terminator
  ; A shake does not suspend the script (script_op_shake, engine/script.asm),
  ; so nothing stops a warp or a screen edge crossing from landing mid-shake
  ; the way mv_left/wt_left are protected by the world being frozen for their
  ; whole duration. Both real callers of this routine -- redraw_screen
  ; (engine/screens.asm) and draw_battle_screen (engine/battle.asm) -- reach
  ; here well before their own later enable_rendering call re-enables NMI, so
  ; the very next NMI sees this clear rather than one more stale shaken
  ; frame. Deliberately not enable_rendering itself: save.asm's own call to
  ; it is the flash-commit path re-enabling rendering with no screen change,
  ; and clearing there would cancel a shake on UNROM 512's flash save while
  ; leaving one running through MMC1/MMC3's battery save -- a mapper-
  ; dependent difference in what Shake does.
  .if SHAKE_ENABLED
  sta shake_left
  .endif
  ; A Flash burst does not suspend either (script_op_flash, engine/script.asm)
  ; and so has no "world is frozen" protection from a redraw landing mid-count
  ; -- the same exposure Shake has above. Unlike a scroll offset, though, a
  ; palette write is not self-healing: nothing else in redraw_screen/
  ; draw_battle_screen touches $3F00-$3F1F, so clearing flash_left alone
  ; would leave the PPU's own palette RAM sitting at FLASH_COLOR forever.
  ; flash_left != 0 covers every outstanding case at once -- mid-hold
  ; (1..FLASH_ARM_VALUE) and FLASH_PENDING (the restore queued by the very
  ; last flash_tick call, not yet drained) alike -- because whatever was
  ; previously queued was just discarded by this routine's own clear above
  ; regardless of which case it was; there is nothing to distinguish. The fix
  ; queues a FRESH restore packet (reading the CURRENT fade_step, so a Flash
  ; on a Fade-darkened screen restores to darkened, not to bright) and drains
  ; it NOW, synchronously, in place -- not left for the next NMI, which would
  ; show the redrawn screen with the old white palette for one whole extra
  ; frame. vram_drain's own vram_drain_done already re-zeroes vram_len/
  ; vram_ready when it finishes, so main_loop's own end-of-frame handshake
  ; has nothing left to re-arm.
  .if FLASH_ENABLED
  lda flash_left
  beq vram_reset_no_flash      ; genuinely idle -- nothing outstanding
  lda #0
  sta flash_left
  jsr fade_apply_palette       ; queue a fresh restore packet -- the shared,
                                ; PALETTE_FX_ENABLED-gated routine
                                ; (engine/entities.asm)
  jsr vram_drain                ; drain it now, synchronously, under this
                                ; routine's own guaranteed forced blank
vram_reset_no_flash:
  .endif
  .if BOUND_TILE_ENABLED
  ; design-tile.md §7 -- A is already 0 here on every path above (untouched
  ; from this routine's own opening lda #0 with FLASH_ENABLED off; loaded from
  ; flash_left and found zero on the vram_reset_no_flash branch; or left at 0
  ; by vram_drain's own last instruction before rts otherwise). A pending
  ; backlog queued for the screen just departed must not survive into
  ; whatever nametable redraw_screen or draw_battle_screen is about to write
  ; -- this is the one shared choke point both go through first.
  sta flip_pending_count
  .endif
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

; Put the box up -- or reuse the one that is up -- and hand it to the phase in A
; once there is a clear frame to work in: BOX_TYPING to say something, or
; BOX_CHOICE to ask something. Raising the frame and wiping a page are the same
; two jobs whichever it turns out to be, so what happens afterwards is decided
; here, once, rather than asked at the end of both of them.
box_begin:
  sta box_after
  lda #0
  sta msg_col
  sta msg_line
  sta box_row
  lda box_state
  bne box_begin_clear       ; already up: keep the frame, wipe what it holds
  lda #BOX_OPENING
  sta box_state
  rts
box_begin_clear:
  lda #BOX_CLEARING
  sta box_state
  rts

; Start typing the string whose pointer is already in msg_ptr.
box_say:
  lda #BOX_TYPING
  jmp box_begin

; Ask the question at script_ptr. The options are read back out of the command
; as they are drawn, which is why nothing may advance script_ptr until one of
; them is picked.
box_choose:
  lda #BOX_CHOICE
  jmp box_begin

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
  bne text_tick_choice
  jmp text_close_step
text_tick_choice:
  cmp #BOX_CHOICE
  bne text_tick_choicewait
  jmp text_choice_step
text_tick_choicewait:
  cmp #BOX_CHOICEWAIT
  bne text_tick_wait
  jmp text_choice_move      ; a wait that still has a cursor to steer
text_tick_wait:
  rts                       ; the WAIT states are waiting for the player

; The confirm/cancel action, while a box is up. Only the waits react: a press
; during the typewriter, or while the options are still being listed, is ignored
; rather than queued.
;
; Cancel arrives here too, and answers a question with whatever the cursor is
; on. Both buttons have always meant "go on" to this box; a question is the box
; asking which way, not a second thing to back out of.
text_advance:
  lda box_state
  cmp #BOX_PAGEWAIT
  beq text_advance_page
  cmp #BOX_ENDWAIT
  beq text_advance_end
  cmp #BOX_CHOICEWAIT
  beq text_advance_pick
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
text_advance_pick:
  jsr choice_hide           ; the cursor is the one thing the next phase would
  jmp script_choose         ; not wipe: it sits outside the text area

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
  jmp box_handover

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

; Wipe the four text rows, one per frame, then get on with whatever the box was
; cleared for. The cursor column is outside this width and is not wiped here:
; a question takes its own cursor down when it is answered, which is the only
; time one is up.
text_clear_step:
  lda box_row
  cmp #BOX_TEXT_ROWS
  bcs text_clear_done
  jsr box_text_row_addr
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
  ; fall through

; A shared phase is finished: hand the box to whatever it was raised or cleared
; for, with the counters it walks the box with back at the start.
;
; box_row is one of them. Typing does not use it -- it counts in msg_line -- so
; for as long as the box only ever typed, every phase could leave it wherever it
; had finished and nothing noticed. Listing a question's options counts rows in
; box_row like the phases before it do, and reads whatever the last one left.
box_handover:
  lda #0
  sta msg_col
  sta msg_line
  sta box_row
  lda box_after
  sta box_state
  rts

; Open a packet at the start of the box_row'th row of text. Preserves nothing
; but the queue, which is all three callers want from it.
box_text_row_addr:
  lda box_row
  asl a
  asl a
  asl a
  asl a
  asl a                     ; row * 32
  clc
  adc #BOX_TEXT_LO
  tay
  lda #BOX_ADDR_HI
  jmp vram_open

; ------------------------------------------------------------- the question
;
; A question is the box with one option on each of its text rows and the cursor
; in the padding column beside them -- column 1, which is inside the frame and
; outside the 28 columns of text, so moving the cursor can never disturb a label
; and wiping the labels can never rub the cursor out.
;
; The command being asked is still under script_ptr: nothing advances past a
; question until it is answered. So the labels are read straight out of it --
; the string id for row n is the n'th byte after the count -- and the only thing
; this has to remember is which row the cursor is on. See script_choose for the
; other half, which is the walk from that number to the commands it chose.

; One option per frame, keeping the one-row-per-frame budget every phase here
; keeps to.
text_choice_step:
  ldy #1
  lda [script_ptr_lo],y     ; how many options there are
  cmp box_row
  beq text_choice_ready
  bcc text_choice_ready     ; can only happen to data this engine did not write
  lda box_row
  clc
  adc #2                    ; past the opcode and the count, to this row's id
  tay
  lda [script_ptr_lo],y
  tay
  lda str_ptr_lo,y
  sta msg_ptr_lo
  lda str_ptr_hi,y
  sta msg_ptr_hi
  ; An answer with no label yet is an ordinary thing to be holding while you
  ; write one, and its string is nothing but TXT_END. That row is left blank --
  ; but the packet must not be opened for it, because a packet with a count of
  ; zero is one the drain reads as 256. See the queue rules at the top.
  ldy #0
  lda [msg_ptr_lo],y
  beq text_choice_blank
  jsr box_text_row_addr
  ; A label is compiled to fit one row and ends with TXT_END, so the count is a
  ; backstop rather than the thing that stops the loop: it is what keeps a string
  ; this engine did not compile from running the whole queue off the end of its
  ; page.
  lda #BOX_COLS
  sta box_col
  ldy #0
text_choice_glyph:
  lda [msg_ptr_lo],y
  beq text_choice_drawn
  jsr vram_push             ; preserves Y, which is walking the label
  iny
  dec box_col
  bne text_choice_glyph
text_choice_drawn:
  jsr vram_end
text_choice_blank:
  inc box_row
  rts
text_choice_ready:
  lda #0
  sta choice_sel
  lda #BOX_CHOICEWAIT
  sta box_state
  jmp choice_show

; Up and down, while the question is up. The d-pad is read here directly for the
; reason the inventory reads it directly: it is not in the Controller Forge's
; table, because during play it always walks and in a menu it always moves the
; cursor. The list wraps at both ends, exactly as the item row does.
text_choice_move:
  lda pad_new
  and #BTN_UP
  bne text_choice_up
  lda pad_new
  and #BTN_DOWN
  bne text_choice_down
  rts
text_choice_up:
  jsr choice_hide
  lda choice_sel
  bne text_choice_up_step
  ldy #1
  lda [script_ptr_lo],y     ; off the top: round to the last option
text_choice_up_step:
  sec
  sbc #1
  sta choice_sel
  jmp choice_show
text_choice_down:
  jsr choice_hide
  lda choice_sel
  clc
  adc #1
  ldy #1
  cmp [script_ptr_lo],y     ; past the last: round back to the first
  bcc text_choice_down_store
  lda #0
text_choice_down_store:
  sta choice_sel
  jmp choice_show

; A = the tile to write beside the option the cursor is on.
choice_cursor:
  pha
  lda choice_sel
  asl a
  asl a
  asl a
  asl a
  asl a                     ; row * 32
  clc
  adc #BOX_TEXT_LO-1        ; the padding column, left of the text
  tay
  lda #BOX_ADDR_HI
  jsr vram_open
  pla
  jsr vram_push
  jmp vram_end

choice_show:
  lda #ARROW_TILE
  jmp choice_cursor
choice_hide:
  lda #TILE_SPACE
  jmp choice_cursor

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
  .if BOUND_TILE_ENABLED
  jsr bound_tile_lookup     ; design-tile.md §6 -- a bound tile in rows 12-14
                            ; must show its own current substitute here too,
                            ; not the raw ROM metatile the box is closing over
  .else
  lda [mtptr_lo],y
  .endif
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
