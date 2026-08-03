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
  lda #HIGH(TITLE_PROMPT_ADDR)
  ldx #LOW(TITLE_PROMPT_ADDR)
  jsr title_blit_prompt
title_draw_done:
  .endif
  rts

  .if TITLE_ENABLED

; A/X = nametable address. The two strings differ only in which label they read,
; which is not worth a pointer indirection for two callers.
title_blit_name:
  jsr title_seek
  ldy #0
title_blit_name_loop:
  lda sys_title,y
  beq title_blit_done
  sta $2007
  iny
  jmp title_blit_name_loop

title_blit_prompt:
  jsr title_seek
  ldy #0
title_blit_prompt_loop:
  lda sys_press_start,y
  beq title_blit_done
  sta $2007
  iny
  jmp title_blit_prompt_loop

title_blit_done:
  rts

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
  jsr title_prompt_write
  jmp title_tick_input
title_tick_hide:
  lda #1
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

; A = 0 to write the prompt, non-zero to blank it.
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
