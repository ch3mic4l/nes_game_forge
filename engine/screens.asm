; screens.asm -- expanding a screen's metatiles into the nametable.
;
; A screen is 16x15 metatiles. Each metatile is four 8x8 tiles, so a screen is
; 32x30 tiles -- exactly one nametable. The two tile rows of a metatile row are
; contiguous in the nametable, so the whole 960 bytes go out in one sequential
; run of $2007 writes.

set_screen_ptr:
  ; Screen data lives in the switchable window, so select its bank before any of
  ; the pointers below are dereferenced. A no-op on an unbanked cartridge.
  ldy flat_screen
  lda screen_bank,y
  jsr switch_prg_bank

  ldy flat_screen
  lda screen_mt_lo,y
  sta mtptr_lo
  lda screen_mt_hi,y
  sta mtptr_hi
  lda screen_at_lo,y
  sta atptr_lo
  lda screen_at_hi,y
  sta atptr_hi
  rts

; Must run with rendering disabled.
draw_screen:
  bit $2002
  lda #$20
  sta $2006
  lda #$00
  sta $2006

  lda #0
  sta ds_row
draw_screen_row:
  lda ds_row
  asl a
  asl a
  asl a
  asl a                     ; row * 16 = offset of this row's first metatile
  sta ds_base

  ldx #0                    ; upper half: top-left and top-right of each
draw_screen_top:
  txa
  clc
  adc ds_base
  tay
  lda [mtptr_lo],y
  tay
  lda mt_tl,y
  sta $2007
  lda mt_tr,y
  sta $2007
  inx
  cpx #16
  bne draw_screen_top

  ldx #0                    ; lower half: bottom-left and bottom-right
draw_screen_bottom:
  txa
  clc
  adc ds_base
  tay
  lda [mtptr_lo],y
  tay
  lda mt_bl,y
  sta $2007
  lda mt_br,y
  sta $2007
  inx
  cpx #16
  bne draw_screen_bottom

  inc ds_row
  lda ds_row
  cmp #15
  bne draw_screen_row

  ; Attribute table: 64 bytes precomputed by the generator, since a 16x16
  ; metatile lines up exactly with one attribute square.
  bit $2002
  lda #$23
  sta $2006
  lda #$C0
  sta $2006
  ldy #0
draw_screen_attr:
  lda [atptr_lo],y
  sta $2007
  iny
  cpy #64
  bne draw_screen_attr
  rts

; Swap to the screen already stored in flat_screen.
redraw_screen:
  lda #$00
  sta $2000                 ; NMI off while the PPU address is being driven
  sta $2001                 ; rendering off
  .if SPLIT_ENABLED
  sta $E000                 ; and the scanline counter disabled: the mainline is
                            ; about to write $8000/$8001 pairs of its own
  .endif
  ; The tileset travels with the map, so entering a screen selects its CHR bank
  ; before anything is drawn. A no-op on cartridges with only one bank.
  jsr vram_reset            ; the whole nametable is about to be rewritten, so
                            ; anything still queued for it is stale
  ldy flat_screen
  lda screen_tileset,y
  jsr switch_chr_bank
  jsr set_screen_ptr
  jsr apply_map_music       ; the map decides, but only when it has changed --
                            ; see engine/music.asm
  jsr spawn_entities        ; each screen refills its actors on entry
  jsr draw_screen
  jsr title_draw            ; over the top, while rendering is still off
  jsr build_oam
  jsr draw_entities
  jsr wait_vblank_poll
  jsr enable_rendering
  rts
