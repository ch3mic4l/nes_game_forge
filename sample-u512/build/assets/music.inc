; Generated -- note periods, instruments and song streams.
period_lo:
  .db $FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$FF,$F1,$7F,$13,$AD,$4D,$F3,$9D
  .db $4C,$00,$B8,$74,$34,$F8,$BF,$89,$56,$26,$F9,$CE,$A6,$80,$5C,$3A
  .db $1A,$FB,$DF,$C4,$AB,$93,$7C,$67,$52,$3F,$2D,$1C,$0C,$FD,$EF,$E1
  .db $D5,$C9,$BD,$B3,$A9,$9F,$96,$8E,$86,$7E,$77,$70,$6A,$64,$5E,$59
  .db $54,$4F,$4B,$46,$42,$3F,$3B,$38,$34,$31,$2F,$2C,$29,$27,$25,$23
  .db $21,$1F,$1D,$1B,$1A,$18,$17,$15,$14,$13,$12,$11,$10,$0F,$0E,$0D
period_hi:
  .db $07,$07,$07,$07,$07,$07,$07,$07,$07,$07,$07,$07,$06,$06,$05,$05
  .db $05,$05,$04,$04,$04,$03,$03,$03,$03,$03,$02,$02,$02,$02,$02,$02
  .db $02,$01,$01,$01,$01,$01,$01,$01,$01,$01,$01,$01,$01,$00,$00,$00
  .db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
  .db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
  .db $00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00,$00
inst_duty:
  .db $02
inst_env_len:
  .db $01
inst_sustain:
  .db $00
inst_env_lo:
  .db LOW(inst_env_0)
inst_env_hi:
  .db HIGH(inst_env_0)
inst_env_0:
  .db $00
song_ptr_lo:
  .db LOW(song0_pulse1),LOW(song0_pulse2),LOW(song0_triangle),LOW(song0_noise)
song_ptr_hi:
  .db HIGH(song0_pulse1),HIGH(song0_pulse2),HIGH(song0_triangle),HIGH(song0_noise)
song0_pulse1:
song0_pulse1_loop:
  .db $FE,$FF
  .db $FF
  .dw song0_pulse1_loop
song0_pulse2:
song0_pulse2_loop:
  .db $FE,$FF
  .db $FF
  .dw song0_pulse2_loop
song0_triangle:
song0_triangle_loop:
  .db $FE,$FF
  .db $FF
  .dw song0_triangle_loop
song0_noise:
song0_noise_loop:
  .db $FE,$FF
  .db $FF
  .dw song0_noise_loop
