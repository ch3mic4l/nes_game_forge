; oam.asm -- build the sprite shadow the NMI DMAs each frame.
;
; The player is one 16x16 metasprite: four 8x8 tiles taken from player_tiles,
; indexed by direction and walk frame.

build_oam:
  ; Two reasons not to draw the player: there is no player on a title screen, and
  ; a player who has just been hit flickers to show they are invincible. Parking
  ; the four slots rather than skipping them keeps oam_idx where entities expect.
  lda game_state
  cmp #ST_TITLE
  beq build_oam_park
  lda player_iframes
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
  sta oam_idx
  rts

build_oam_draw:
  lda player_dir
  asl a
  clc
  adc anim_frame            ; (dir * 2) + frame
  asl a
  asl a                     ; * 4 tiles per frame
  tax

  lda player_y              ; OAM Y is one scanline above the sprite
  sec
  sbc #1
  sta tmp                   ; top row Y
  clc
  adc #8
  sta tmp2                  ; bottom row Y

  lda tmp                   ; top-left
  sta OAM+0
  lda player_tiles,x
  sta OAM+1
  lda player_pal
  sta OAM+2
  lda player_x
  sta OAM+3

  lda tmp                   ; top-right
  sta OAM+4
  lda player_tiles+1,x
  sta OAM+5
  lda player_pal
  sta OAM+6
  lda player_x
  clc
  adc #8
  sta OAM+7

  lda tmp2                  ; bottom-left
  sta OAM+8
  lda player_tiles+2,x
  sta OAM+9
  lda player_pal
  sta OAM+10
  lda player_x
  sta OAM+11

  lda tmp2                  ; bottom-right
  sta OAM+12
  lda player_tiles+3,x
  sta OAM+13
  lda player_pal
  sta OAM+14
  lda player_x
  clc
  adc #8
  sta OAM+15

  lda #16                   ; entities are appended after the player
  sta oam_idx
  rts
