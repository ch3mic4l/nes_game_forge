; title.asm -- the screen the cartridge boots into.
;
; A title is one of the project's own map screens with two lines of text written
; over it: the game's name and the prompt. Both are background tiles rather than
; sprites, so a long name costs nothing and cannot run into the eight-sprites-
; per-scanline limit.
;
; The text is written straight to $2007 during the same rendering-off window that
; draws the screen, which is why it lives beside draw_screen rather than going
; through the NMI queue: at that moment there is no queue to go through. Only the
; blink afterwards uses the queue.

; Called from boot and from redraw_screen, after the nametable has been filled
; and while rendering is still off. Draws nothing unless the game is on its title.
title_draw:
  .if TITLE_ENABLED
  lda game_state
  cmp #ST_TITLE
  bne title_draw_done
  ; The two bands the text lands in are forced to background palette 0 first.
  ; Without that the glyphs take whatever palette the art underneath happens to
  ; carry, so whether the title is readable would be down to where the author
  ; put their pond.
  lda #LOW(TITLE_NAME_ATTR)
  jsr title_clear_attr
  lda #LOW(TITLE_PROMPT_ATTR)
  jsr title_clear_attr
  lda #HIGH(TITLE_NAME_ADDR)
  ldx #LOW(TITLE_NAME_ADDR)
  jsr title_blit_name
  ; A save/load build does not know which of the title's two prompt strings
  ; this is until runtime (title_pick_prompt asks save_check_valid); a build
  ; with no Save command at all has exactly one prompt, so it keeps the
  ; original direct-label form rather than paying for the indirection SAVE_
  ; ENABLED needs. This is the one place in the file that costs a build
  ; without Save command a single byte more than before this feature existed
  ; if it were shared -- kept split instead, so it does not.
  .if SAVE_ENABLED
  jsr title_pick_prompt      ; A/X = its address; title_prompt_lo/hi = its text
  .endif
  .if !SAVE_ENABLED
  lda #HIGH(TITLE_PROMPT_ADDR)
  ldx #LOW(TITLE_PROMPT_ADDR)
  .endif
  jsr title_blit_prompt
title_draw_done:
  .endif
  rts

  .if TITLE_ENABLED

; A/X = nametable address.
title_blit_name:
  jsr title_seek
  ldy #0
title_blit_name_loop:
  lda sys_title,y
  beq title_blit_done
  sta $2007
  iny
  jmp title_blit_name_loop

  .if SAVE_ENABLED
; A/X = nametable address, from title_pick_prompt. Reads through
; title_prompt_lo/hi rather than a label directly: which of the title's two
; prompt strings this is depends on whether a valid save exists, which is
; runtime state no label can carry.
title_blit_prompt:
  jsr title_seek
  ldy #0
title_blit_prompt_loop:
  lda [title_prompt_lo],y
  beq title_blit_done
  sta $2007
  iny
  jmp title_blit_prompt_loop
  .endif
  .if !SAVE_ENABLED
; A/X = nametable address. One prompt, so no pointer indirection to reach it.
title_blit_prompt:
  jsr title_seek
  ldy #0
title_blit_prompt_loop:
  lda sys_press_start,y
  beq title_blit_done
  sta $2007
  iny
  jmp title_blit_prompt_loop
  .endif

title_blit_done:
  rts

  .if SAVE_ENABLED
; Decides which of the title's two prompt strings is showing right now, and
; leaves title_prompt_lo/hi pointing at its text -- title_blit_prompt and
; title_tick's blink both read through that pointer rather than each deciding
; on their own, which is exactly the kind of two-places-drift a save/load
; feature keeps finding elsewhere in this engine. Returns A/X = the nametable
; address to write it at (HIGH/LOW), the same shape title_blit_name's own
; caller already hands it.
title_pick_prompt:
  jsr save_check_valid
  beq title_pick_prompt_continue
  lda #LOW(sys_press_start)
  sta title_prompt_lo
  lda #HIGH(sys_press_start)
  sta title_prompt_hi
  lda #HIGH(TITLE_PROMPT_ADDR)
  ldx #LOW(TITLE_PROMPT_ADDR)
  rts
title_pick_prompt_continue:
  lda #LOW(sys_press_start_continue)
  sta title_prompt_lo
  lda #HIGH(sys_press_start_continue)
  sta title_prompt_hi
  lda #HIGH(TITLE_PROMPT_CONTINUE_ADDR)
  ldx #LOW(TITLE_PROMPT_CONTINUE_ADDR)
  rts
  .endif

title_seek:
  bit $2002
  sta $2006
  stx $2006
  rts

; A = the low byte of an attribute row inside $23C0-$23FF.
title_clear_attr:
  tax
  lda #$23
  jsr title_seek
  lda #0
  ldy #8
title_clear_attr_loop:
  sta $2007
  dey
  bne title_clear_attr_loop
  rts

; The prompt blinks, which is the whole of the title screen's animation. It goes
; through the NMI queue like everything else drawn while the picture is on.
title_tick:
  lda frame_cnt
  and #$1F
  bne title_tick_input      ; only on the frame the phase changes
  lda frame_cnt
  and #$20
  beq title_tick_hide
  lda #0
  .if SAVE_ENABLED
  sta ui_slot                ; title_prompt_write needs A free for its own
  .endif                     ; jsr to title_pick_prompt -- see below
  jsr title_prompt_write
  jmp title_tick_input
title_tick_hide:
  lda #1
  .if SAVE_ENABLED
  sta ui_slot
  .endif
  jsr title_prompt_write

title_tick_input:
  ; Start is hardwired, for the same reason the D-pad is: a title you could not
  ; get past because of a rebinding would be a trap. Every other button goes
  ; through the Controller Forge's title row -- dispatch_input runs in every
  ; state, and do_action knows what a bound `confirm` means here.
  lda pad_new
  and #BTN_START
  beq title_tick_done
  jmp start_game
title_tick_done:
  rts

  .if SAVE_ENABLED
; ui_slot = 0 to write the prompt, non-zero to blank it -- set by the caller
; before this runs, since title_pick_prompt below needs A free for its own
; jsr to save_check_valid. vram_open wants the address in A/Y where every
; other title routine here uses A/X, so that is the one register this bridges
; between title_pick_prompt's return and vram_open's own calling convention.
title_prompt_write:
  jsr title_pick_prompt
  pha
  txa
  tay
  pla
  jsr vram_open
  ldy #0
title_prompt_loop:
  lda [title_prompt_lo],y
  beq title_prompt_done
  ldx ui_slot
  beq title_prompt_push
  lda #TILE_SPACE
title_prompt_push:
  jsr vram_push             ; preserves X and Y
  iny
  jmp title_prompt_loop
title_prompt_done:
  jmp vram_end
  .endif

  .if !SAVE_ENABLED
; A = 0 to write the prompt, non-zero to blank it. One prompt, so no pointer
; indirection and no register-juggling to reach vram_open's own A/Y -- the
; caller hands the flag straight through in A.
title_prompt_write:
  sta ui_slot
  lda #HIGH(TITLE_PROMPT_ADDR)
  ldy #LOW(TITLE_PROMPT_ADDR)
  jsr vram_open
  ldy #0
title_prompt_loop:
  lda sys_press_start,y
  beq title_prompt_done
  ldx ui_slot
  beq title_prompt_push
  lda #TILE_SPACE
title_prompt_push:
  jsr vram_push             ; preserves X and Y
  iny
  jmp title_prompt_loop
title_prompt_done:
  jmp vram_end
  .endif

  .endif

; ------------------------------------------------------------ transitions

; Begin play, from the title or from a game over on a cartridge that has no
; title. One definition, so "new game" means the same thing however it is reached.
start_game:
  jsr init_session
  lda #NO_ENTITY
  sta talk_ent
  lda #START_SCREEN
  sta flat_screen
  lda #START_X
  sta player_x
  lda #START_Y
  sta player_y
  lda #DIR_DOWN
  sta player_dir
  lda #0
  sta box_state
  lda #ST_GAMEPLAY
  sta game_state
  jmp redraw_screen

; Where a game over goes. Back to the title when there is one -- which is what
; makes a title screen worth having -- and straight into a new game when there
; is not, because there would be nothing else to look at.
restart_game:
  .if TITLE_ENABLED
  jsr init_session
  lda #NO_ENTITY
  sta talk_ent
  lda #TITLE_FLAT_SCREEN
  sta flat_screen
  lda #0
  sta box_state
  lda #ST_TITLE
  sta game_state
  jmp redraw_screen
  .endif
  .if !TITLE_ENABLED
  jmp start_game
  .endif
