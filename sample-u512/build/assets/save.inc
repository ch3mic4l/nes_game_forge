; Generated -- the save record's layout at SAVE_BASE, media-dependent
; (battery RAM or a flash driver's RAM buffer; see engine/save.asm's own
; header). shared/save.js is the single writer; engine/save.asm addresses
; every field by these equates and the descriptor tables below.
SAVE_BASE = $700
SAVE_FLAT_SCREEN = $700
SAVE_PLAYER_X = $701
SAVE_PLAYER_Y = $702
SAVE_PLAYER_DIR = $703
SAVE_PLAYER_HP = $704
SAVE_SWITCHES = $705
SAVE_VARIABLES = $70D
SAVE_INV_ITEMS = $71D
SAVE_INV_COUNT = $725
SAVE_PICKUPS = $726
SAVE_DEFEATED = $727
SAVE_ITEMS_USED = $728
SAVE_PARTY_SIZE = $729
SAVE_GOLD_LO = $72A
SAVE_GOLD_HI = $72B
SAVE_PC_HP = $72C
SAVE_PC_HP_MAX = $730
SAVE_PC_MP = $734
SAVE_PC_MP_MAX = $738
SAVE_PC_LEVEL = $73C
SAVE_PC_XP_LO = $740
SAVE_PC_XP_HI = $744
SAVE_PC_IN_PARTY = $748
SAVE_PC_SPELLS = $74C
SAVE_BODY_LEN = 80
SAVE_CHECKSUM_LO = $750
SAVE_CHECKSUM_HI = $751
SAVE_IDENTITY_0_ADDR = $752
SAVE_IDENTITY_1_ADDR = $753
SAVE_IDENTITY_2_ADDR = $754
SAVE_IDENTITY_3_ADDR = $755
SAVE_MARKER = $756
SAVE_FIELD_COUNT = 24
save_field_lo:
  .db LOW(flat_screen),LOW(player_x),LOW(player_y),LOW(player_dir),LOW(player_hp),LOW(switches),LOW(variables),LOW(inv_items),LOW(inv_count),LOW(pickups),LOW(defeated),LOW(items_used)
  .db LOW(party_size),LOW(gold_lo),LOW(gold_hi),LOW(pc_hp),LOW(pc_hp_max),LOW(pc_mp),LOW(pc_mp_max),LOW(pc_level),LOW(pc_xp_lo),LOW(pc_xp_hi),LOW(pc_in_party),LOW(pc_spells)
save_field_hi:
  .db HIGH(flat_screen),HIGH(player_x),HIGH(player_y),HIGH(player_dir),HIGH(player_hp),HIGH(switches),HIGH(variables),HIGH(inv_items),HIGH(inv_count),HIGH(pickups),HIGH(defeated),HIGH(items_used)
  .db HIGH(party_size),HIGH(gold_lo),HIGH(gold_hi),HIGH(pc_hp),HIGH(pc_hp_max),HIGH(pc_mp),HIGH(pc_mp_max),HIGH(pc_level),HIGH(pc_xp_lo),HIGH(pc_xp_hi),HIGH(pc_in_party),HIGH(pc_spells)
save_field_len:
  .db 1,1,1,1,1,8,16,8,1,1,1,1
  .db 1,1,1,4,4,4,4,4,4,4,4,4
