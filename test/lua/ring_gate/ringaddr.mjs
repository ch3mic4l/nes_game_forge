// RAM addresses the ring recorders read, transcribed by hand from engine/constants.asm (never parsed from the build under test).
// `checkAddresses(constantsText)` compares them with a build's constants.asm so a moved byte fails loudly.
export const RING_ADDR = {
  player_x: 0x10, player_y: 0x11, // constants.asm:23-24
  flat_screen: 0x16, // :29 (index into the global screen tables: the player's place, with cur_map)
  game_state: 0x25, // :51
  vram_len: 0x3c, // :97
  box_state: 0x40, // :104
  msg_col: 0x45, msg_line: 0x46, // :109-110
  cam_x_lo: 0xaf, cam_y_lo: 0xb0, cam_nt: 0xb1, // :513-521 (cam_nt = cam_y_lo+1)
  bt_from_ent: 0x68, // :161 (the entity slot that made contact, a battle's origin)
  cur_map: 0x8a, // :267 (= bt_owner_rec+1: a CHAINED equate; the build's symbols come from scanEquates/resolveEquates, so checkAddresses resolves the chain)
  shake_left: 0x9b, // :359 (wt_left+1; a scripted Shake's remaining frames)
  map_is_streamed: 0xfe,
  sw_col: 0x05a0, sw_row: 0x05a1, // :1130s
  st_active: 0x05b5, // :1139
  win_col_screen: 0x05b1, win_col_local: 0x05b2, win_row_screen: 0x05b3, win_row_local: 0x05b4 // :1118-1121 (the live window origin; the guard scene's lag injection)
};
export function checkAddresses(symbols) {
  const bad = [];
  for (const [name, addr] of Object.entries(RING_ADDR)) {
    const got = symbols.get(name);
    if (got !== addr) bad.push(`${name}: transcribed $${addr.toString(16)}, build has ${got === undefined ? 'none' : '$' + got.toString(16)}`);
  }
  return bad;
}
