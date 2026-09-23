; oam.asm -- build the sprite shadow the NMI DMAs each frame.
;
; The player is one 16x16 metasprite: four 8x8 tiles taken from player_tiles,
; indexed by direction and walk frame.

build_oam:
  ; Two reasons not to draw the player: there is no player on a title screen, and
  ; a player who has just been hit flickers to show they are invincible. Parking
  ; the four slots rather than skipping them keeps oam_idx where entities expect.
  lda <game_state
  cmp #ST_TITLE
  beq build_oam_park
  lda <player_iframes
  beq build_oam_draw
  and #$02
  beq build_oam_draw
build_oam_park:
  lda #$FF
  sta OAM+0
  sta OAM+4
  sta OAM+8
  sta OAM+12
  lda #16
  sta <oam_idx
  rts

build_oam_draw:
  lda <player_dir
  asl a
  clc
  adc <anim_frame            ; (dir * 2) + frame
  asl a
  asl a                     ; * 4 tiles per frame
  tax

  ; build_oam_draw_dispatch/build_oam_draw_dispatch_done bracket just this
  ; branch (purely additive, unlike boot.asm's NMI splice -- the ordinary
  ; body right below stays unconditional either way) so
  ; test/unit/kernelbytes.test.js can measure it on its own, the same
  ; single-build span technique STREAMWORLD_RESOLVER_KERNEL_ALLOWANCE's own
  ; comment (main/build/generate.js) describes.
build_oam_draw_dispatch:
  .if STREAMING_ENABLED
  lda <map_is_streamed
  bne build_oam_draw_sw
  .endif
build_oam_draw_dispatch_done:

  lda <player_y              ; OAM Y is one scanline above the sprite
  sec
  sbc #1
  sta <tmp                   ; top row Y
  clc
  adc #8
  sta <tmp2                  ; bottom row Y

  lda <tmp                   ; top-left
  sta OAM+0
  lda player_tiles,x
  sta OAM+1
  lda player_pal
  sta OAM+2
  lda <player_x
  sta OAM+3

  lda <tmp                   ; top-right
  sta OAM+4
  lda player_tiles+1,x
  sta OAM+5
  lda player_pal
  sta OAM+6
  lda <player_x
  clc
  adc #8
  sta OAM+7

  lda <tmp2                  ; bottom-left
  sta OAM+8
  lda player_tiles+2,x
  sta OAM+9
  lda player_pal
  sta OAM+10
  lda <player_x
  sta OAM+11

  lda <tmp2                  ; bottom-right
  sta OAM+12
  lda player_tiles+3,x
  sta OAM+13
  lda player_pal
  sta OAM+14
  lda <player_x
  clc
  adc #8
  sta OAM+15

  lda #16                   ; entities are appended after the player
  sta <oam_idx
  rts

  .if STREAMING_ENABLED
; ==========================================================================
; build_oam_draw_sw -- phase 2 slice 4a (docs/design-streamed-worlds.md
; §7). The streamed-world counterpart of the ordinary player draw above:
; the identical 4 tiles (top-left/top-right/bottom-left/bottom-right), but
; each tile's own OAM position is independently projected against the
; camera's world-space origin (ruling 4: visibility is per 8x8 tile, not
; per metasprite origin -- a streamed-screen player can reach player_x=255/
; player_y=239, per slice 3, so the right/bottom tiles of a 16x16 player
; near that edge sit past the window and must park, not wrap). X needs no
; multiply at all (a screen is exactly 256px wide, so local X IS world X's
; low byte and sw_col IS its high byte); Y needs sw_oam_project_y's own
; row*240 multiply (engine/streamworld.asm).
;
; X = the tile-table index ((dir*2+frame)*4) computed by the caller above,
; stashed across the corner loop (which clobbers X as sw_oam_rowbase's own
; loop counter) in sw_tmp5 -- the one byte sw_project_axis's clobber list
; leaves free, safe here because sw_goto (this file's other user of
; sw_tmp5) never runs concurrently with an OAM build (both mainline-only).
; ==========================================================================
build_oam_draw_sw:
  stx sw_tmp5
  ldy #0
build_oam_draw_sw_loop:
  lda <player_x
  clc
  adc sw_oam_corner_xoff,y
  jsr sw_oam_project_x
  sta <tmp
  lda #0
  rol a
  sta <tmp2                  ; X-hidden flag (0/1)

  lda <player_y
  clc
  adc sw_oam_corner_yoff,y
  jsr sw_oam_project_y
  sta sw_tmp6                ; Y byte, stashed -- free again once
                              ; sw_oam_project_y has returned
  lda #0
  rol a
  ora <tmp2
  bne build_oam_draw_sw_park

  ldx sw_oam_corner_oam,y
  lda sw_tmp6
  sta OAM,x
  tya
  clc
  adc sw_tmp5
  tax
  lda player_tiles,x
  ldx sw_oam_corner_oam,y
  sta OAM+1,x
  lda player_pal
  sta OAM+2,x
  lda <tmp
  sta OAM+3,x
  jmp build_oam_draw_sw_next

build_oam_draw_sw_park:
  ldx sw_oam_corner_oam,y
  lda #$FF
  sta OAM,x
build_oam_draw_sw_next:
  iny
  cpy #4
  bne build_oam_draw_sw_loop

  lda #16
  sta <oam_idx
  rts

sw_oam_corner_xoff: .db 0, 8, 0, 8   ; TL, TR, BL, BR
sw_oam_corner_yoff: .db 0, 0, 8, 8
sw_oam_corner_oam:  .db 0, 4, 8, 12
build_oam_draw_sw_end:
  .endif
