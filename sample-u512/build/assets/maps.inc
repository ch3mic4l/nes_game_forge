; Generated -- screen lookup and edge-neighbour tables ($FF = map edge).
map_base:
  .db $00,$02
map_enc_rate:
  .db $00,$00
map_enc_actors:
  .db $FF,$FF,$FF,$FF
  .db $FF,$FF,$FF,$FF
map_battle_sky:
  .db $00,$00
map_battle_ground:
  .db $00,$00
map_song:
  .db $FF,$FF
screen_map:
  .db $00,$00,$01
screen_tileset:
  .db $00,$00,$00
screen_bank:
  .db $00,$00,$00
screen_left:
  .db $FF,$00,$FF
screen_right:
  .db $01,$FF,$FF
screen_up:
  .db $FF,$FF,$FF
screen_down:
  .db $FF,$FF,$FF
screen_mt_lo:
  .db LOW(screen_0),LOW(screen_1),LOW(screen_2)
screen_mt_hi:
  .db HIGH(screen_0),HIGH(screen_1),HIGH(screen_2)
screen_at_lo:
  .db LOW(screen_0_attr),LOW(screen_1_attr),LOW(screen_2_attr)
screen_at_hi:
  .db HIGH(screen_0_attr),HIGH(screen_1_attr),HIGH(screen_2_attr)
screen_ent_lo:
  .db LOW(screen_0_ent),LOW(screen_1_ent),LOW(screen_2_ent)
screen_ent_hi:
  .db HIGH(screen_0_ent),HIGH(screen_1_ent),HIGH(screen_2_ent)
