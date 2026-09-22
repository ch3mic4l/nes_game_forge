; screens.asm -- expanding a screen's metatiles into the nametable.
;
; A screen is 16x15 metatiles. Each metatile is four 8x8 tiles, so a screen is
; 32x30 tiles -- exactly one nametable. The two tile rows of a metatile row are
; contiguous in the nametable, so the whole 960 bytes go out in one sequential
; run of $2007 writes.

set_screen_ptr:
  ; call_battle (engine/banks.asm) always ends `jmp set_screen_ptr` -- the
  ; restore IS the return, for BE_INIT/BE_RESTORE too, so this runs even for
  ; a non-fight session-lifecycle entry (init_session's own BE_INIT
  ; tail-call, continue_game's BE_RESTORE). A streamed CURRENT screen has no
  ; row in any *_bank/*_mt_lo/*_at_lo table at all -- sw_locate_current is
  ; this routine's own streamed equivalent, restoring the same "mtptr/bank
  ; point at the current field screen" contract from the persistently-
  ; maintained sw_col_byte_lo/hi/sw_col_region/sw_row_bank_base.
  .if STREAMING_ENABLED
  lda <map_is_streamed
  beq set_screen_ptr_ordinary
  jsr sw_locate_current
  rts
set_screen_ptr_ordinary:
  .endif
  ; Screen data lives in the switchable window, so select its bank before any of
  ; the pointers below are dereferenced. A no-op on an unbanked cartridge.
  .if STREAMING_ENABLED
  ldy <ord_screen
  .else
  ldy <flat_screen
  .endif
  lda screen_bank,y
  jsr switch_prg_bank

  .if STREAMING_ENABLED
  ldy <ord_screen
  .else
  ldy <flat_screen
  .endif
  lda screen_mt_lo,y
  sta <mtptr_lo
  lda screen_mt_hi,y
  sta <mtptr_hi
  lda screen_at_lo,y
  sta <atptr_lo
  lda screen_at_hi,y
  sta <atptr_hi
  rts

; Must run with rendering disabled.
  .if !CAMERA_SLIDE_ENABLED
draw_screen:
  bit $2002
  lda #$20
  sta $2006
  lda #$00
  sta $2006

  lda #0
  sta <ds_row
draw_screen_row:
  lda <ds_row
  asl a
  asl a
  asl a
  asl a                     ; row * 16 = offset of this row's first metatile
  sta <ds_base

  ldx #0                    ; upper half: top-left and top-right of each
draw_screen_top:
  txa
  clc
  adc <ds_base
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
  adc <ds_base
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

  inc <ds_row
  lda <ds_row
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
  .endif

  .if CAMERA_SLIDE_ENABLED
; design-camera.md §8: candidate (b) draws one screen per forced blank, into
; either nametable -- the arming draw goes into the far nametable the slide
; is about to reveal, the completion draw moves the identical content into
; nametable 0. The nametable/attribute base addresses are therefore a
; parameter (A = nametable index 0-3) rather than the off-path's own
; hardcoded $20/$23; draw_screen itself becomes a two-instruction wrapper
; (`lda #0 / jmp draw_screen_at`) that keeps calling it with nametable 0, so
; every existing call site (redraw_screen included) is unchanged.
; draw_screen_at parks the index in <tmp, which survives both loops below
; untouched -- bound_tile_lookup (this file) is the only routine either loop
; calls, and it never touches <tmp itself (switch_test/switch_split,
; engine/script.asm, belong to rebuild_bound_cache's own cache rebuild, not
; to either draw loop).
draw_screen_at:
  sta <tmp                  ; nt index -- survives the loops below untouched
  asl a
  asl a                      ; nt * 4 = nametable's own hi-byte offset from $20
  clc
  adc #$20
  bit $2002
  sta $2006
  lda #$00
  sta $2006

  lda #0
  sta <ds_row
draw_screen_at_row:
  lda <ds_row
  asl a
  asl a
  asl a
  asl a
  sta <ds_base

  ldx #0
draw_screen_at_top:
  txa
  clc
  adc <ds_base
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
  bne draw_screen_at_top

  ldx #0
draw_screen_at_bottom:
  txa
  clc
  adc <ds_base
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
  bne draw_screen_at_bottom

  inc <ds_row
  lda <ds_row
  cmp #15
  bne draw_screen_at_row

  lda <tmp
  asl a
  asl a
  clc
  adc #$23
  bit $2002
  sta $2006
  lda #$C0
  sta $2006
  ldy #0
draw_screen_at_attr:
  lda [atptr_lo],y
  sta $2007
  iny
  cpy #64
  bne draw_screen_at_attr
  rts

draw_screen:
  lda #0
  jmp draw_screen_at
  .endif

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
  lda <fade_reload
  beq redraw_screen_no_fade_reload
  lda #0
  sta <fade_reload
  jsr load_palette
redraw_screen_no_fade_reload:
  .endif
  ; Phase 2 slice 2b: flat_screen is the GLOBAL screen id (unchanged --
  ; saves/warp targets/cross_* deltas all still use it); sw_resolve_screen
  ; is the single place that turns it into either ord_screen (an ordinary
  ; table row) or a streamed landing. A streamed landing draws itself
  ; entirely differently from the ordinary body below (sw_render_window,
  ; not draw_screen/rebuild_bound_cache/title_draw) and returns on its own.
  ;
  ; redraw_screen_dispatch brackets exactly this dispatch (to
  ; redraw_screen_ordinary, below) -- unconditional, unlike
  ; redraw_screen_no_fade_reload above (only assembled when FADE_ENABLED) --
  ; so Part F's STREAMWORLD_REDRAW_KERNEL_ALLOWANCE can measure this span
  ; directly off nesasm's own symbol table (kernelbytes.test.js) regardless
  ; of whether the project this ROM happens to also use Fade.
redraw_screen_dispatch:
  .if STREAMING_ENABLED
  lda <flat_screen
  jsr sw_resolve_screen
  lda <map_is_streamed
  beq redraw_screen_ordinary
  jsr sw_render_window
  ; F3 (phase 2 slice 2b fix round 1): a streamed landing must not inherit
  ; the previous OWNER screen's active bound-tile cache -- rebuild_bound_cache
  ; itself already takes the empty-cache branch whenever map_is_streamed is
  ; set (just above, this same file), so simply calling it here reuses that
  ; single definition rather than duplicating the guard.
  .if BOUND_TILE_ENABLED
  jsr rebuild_bound_cache
  .endif
  jsr spawn_entities
  jsr build_oam
  jsr draw_entities
  jsr wait_vblank_poll
  ; enable_rendering's own $2005 write is hardcoded (0,0) -- not used here,
  ; the same reason design-camera.md's redraw_screen_slide/
  ; camera_slide_complete_b write their own $2000/$2005 sequence instead of
  ; calling it, for a landing whose own scroll is not (0,0).
  lda <cam_nt
  ora #PPUCTRL_ON
  sta $2000
  lda <cam_x_lo
  sta $2005
  lda <cam_y_lo
  sta $2005
  lda #PPUMASK_ON
  sta $2001
  rts
redraw_screen_ordinary:
  ldy <ord_screen
  .else
  ldy <flat_screen
  .endif
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
  ; F2 (phase 2 slice 2b fix round 1): an ordinary landing reached AFTER a
  ; streamed one (a Warp back off the streamed map) must not inherit the
  ; streamed screen's own nonzero cam_nt/cam_x_lo/cam_y_lo -- streaming
  ; requires the camera on (Part D item 8), so nmi_scroll's own
  ; CAMERA_ENABLED snapshot path is always the one reading these bytes
  ; whenever this reset matters. Still under forced blank (enable_rendering,
  ; next, is the first PPUMASK write), so no cam_dirty lock is needed -- the
  ; identical reasoning redraw_screen_slide's own (0,0) arm already relies on.
redraw_screen_cam_reset:
  .if STREAMING_ENABLED
  lda #0
  sta <cam_x_lo
  sta <cam_y_lo
  sta <cam_nt
  .endif
redraw_screen_cam_reset_done:
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
  ; A streamed map is refused a bound tile of its own (Part D, phase 2 slice
  ; 2b), but tile_switch_changed (engine/script.asm) can still reach this
  ; reactively from an ordinary map's own Set/Clear while the player is
  ; standing on a streamed screen -- ord_screen is meaningless there, so
  ; this returns an empty cache rather than reading whatever stale row it
  ; last held.
  ;
  ; rebuild_bound_cache_dispatch brackets exactly this guard (to
  ; rebuild_bound_cache_ordinary, below) -- Part F's STREAMWORLD_BOUND_CACHE_
  ; KERNEL_ALLOWANCE measures this span directly off nesasm's own symbol
  ; table (kernelbytes.test.js), not by hand.
rebuild_bound_cache_dispatch:
  .if STREAMING_ENABLED
  lda <map_is_streamed
  beq rebuild_bound_cache_ordinary
  stx bind_count             ; X is still 0
  rts
rebuild_bound_cache_ordinary:
  ldy <ord_screen
  .else
  ldy <flat_screen
  .endif
  lda screen_bound_lo,y
  sta <bdptr_lo
  lda screen_bound_hi,y
  sta <bdptr_hi
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
