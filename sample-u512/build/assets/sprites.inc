; Generated -- player frames, metasprites, animations and actors.
player_tiles:
  .db $00,$01,$02,$03
  .db $04,$05,$06,$07
  .db $08,$09,$0A,$0B
  .db $0C,$0D,$0E,$0F
  .db $10,$11,$12,$13
  .db $14,$15,$16,$17
  .db $18,$19,$1A,$1B
  .db $1C,$1D,$1E,$1F
player_pal:
  .db $00
ms_count:
  .db $04,$04
ms_ptr_lo:
  .db LOW(ms_data_0),LOW(ms_data_1)
ms_ptr_hi:
  .db HIGH(ms_data_0),HIGH(ms_data_1)
ms_data_0:
  .db $00,$20,$01,$00
  .db $00,$21,$01,$08
  .db $08,$22,$01,$00
  .db $08,$23,$01,$08
ms_data_1:
  .db $00,$24,$02,$00
  .db $00,$25,$02,$08
  .db $08,$26,$02,$00
  .db $08,$27,$02,$08
anim_count:
  .db $01,$01
anim_ptr_lo:
  .db LOW(anim_data_0),LOW(anim_data_1)
anim_ptr_hi:
  .db HIGH(anim_data_0),HIGH(anim_data_1)
anim_data_0:
  .db $00,$1E
anim_data_1:
  .db $01,$1E
actor_behavior:
  .db $03,$05
actor_speed:
  .db $01,$01
actor_hp:
  .db $01,$01
actor_damage:
  .db $00,$00
actor_anim_dir:
  .db $00,$00,$00,$00
  .db $01,$01,$01,$01
