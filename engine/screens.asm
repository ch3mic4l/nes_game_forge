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
  .if BOUND_TILE_ENABLED
  jsr bound_tile_lookup
  .else
  lda [mtptr_lo],y
  .endif
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
  .if BOUND_TILE_ENABLED
  jsr bound_tile_lookup
  .else
  lda [mtptr_lo],y
  .endif
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
  .if FADE_ENABLED
  ; init_session (engine/combat.asm) is fade_reload's only writer -- a
  ; one-shot "the next redraw_screen must reload the palette" flag, because
  ; init_session itself cannot safely call load_palette directly: two of its
  ; three non-boot callers (restart_game, continue_game) can reach it with
  ; rendering genuinely on, and load_palette writes raw $2006/$2007 with no
  ; forced-blank guarantee of its own. This routine is always under forced
  ; blank for its whole body ($2000/$2001 cleared above, enable_rendering not
  ; called until the last line), so it is the one safe place to consume the
  ; flag -- right here, after vram_reset so an intervening redraw cannot drop
  ; it first, and before draw_screen's own nametable/attribute writes (which
  ; is also what leaves the PPU's VRAM address safely out of palette space by
  ; the time rendering resumes -- no separate cleanup needed here the way the
  ; NMI path needed one).
  ;
  ; A plain redraw (a warp, a screen edge, a battle returning) never sets this
  ; flag, so it stays 0 here and this branch is skipped -- which is exactly
  ; "a plain redraw with a fade at level N must not restore brightness," the
  ; sticky property a completed fade depends on.
  lda fade_reload
  beq redraw_screen_no_fade_reload
  lda #0
  sta fade_reload
  jsr load_palette
redraw_screen_no_fade_reload:
  .endif
  ldy flat_screen
  lda screen_tileset,y
  jsr switch_chr_bank
  jsr set_screen_ptr
  .if BOUND_TILE_ENABLED
  jsr rebuild_bound_cache   ; design-tile.md §6 -- the screen bank is mapped by
                            ; set_screen_ptr above, so the ROM bound-tile table
                            ; is safe to read; must run before draw_screen, whose
                            ; own consult depends on this cache already being
                            ; correct for the switches currently set
  .endif
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

  .if BOUND_TILE_ENABLED
; ----------------------------------------------------- switch-bound tiles
; design-tile.md §6. Y = cell index (0-239) in, A = resolved metatile id out
; (ROM, or the active-cache override). Preserves X. Clobbers Y. The one
; routine draw_screen's two loops, probe_type (player.asm) and
; text_close_step (text.asm) all call -- their own index arithmetic all
; computes this identical row-major cell index.
bound_tile_lookup:
  sty btl_idx
  ldy #0
btl_scan:
  cpy bind_count
  beq btl_miss
  lda bind_idx,y
  cmp btl_idx
  beq btl_hit
  iny
  bne btl_scan            ; safe: Y never reaches 0 again within BOUND_CAP iterations
btl_miss:
  ldy btl_idx
  lda [mtptr_lo],y
  rts
btl_hit:
  lda bind_mt,y
  rts

; Rebuilds the active-tile cache for flat_screen from its ROM bound-tile
; table. Called from redraw_screen (a full rebuild on every screen entry)
; and from tile_switch_changed (engine/script.asm, also a full rebuild --
; see design-tile.md §3 for why re-walking <=8 ROM entries per flip is cheap
; enough not to need an incremental diff). Takes no parameters; the
; switch-matching pass is tile_switch_changed's own, separate walk.
rebuild_bound_cache:
  ldx #0                    ; active-cache write cursor
  ldy flat_screen
  lda screen_bound_lo,y
  sta bdptr_lo
  lda screen_bound_hi,y
  sta bdptr_hi
  ldy #0
  lda [bdptr_lo],y          ; this screen's own authored-binding count (0-8)
  beq rbc_done
  sta bnd_scan_left
  iny
rbc_loop:
  lda [bdptr_lo],y          ; this entry's switch
  iny
  jsr switch_test           ; preserves X and Y; Z set when the switch is off
  beq rbc_skip
  lda [bdptr_lo],y          ; cell index
  sta bind_idx,x
  iny
  lda [bdptr_lo],y          ; substitute metatile
  sta bind_mt,x
  iny
  inx
  jmp rbc_next
rbc_skip:
  iny
  iny
rbc_next:
  dec bnd_scan_left
  bne rbc_loop
rbc_done:
  stx bind_count
  rts
  .endif
