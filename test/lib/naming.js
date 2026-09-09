// In-game party-member naming (docs/design-name-entry.md §14) -- the grid
// helpers, shared between test/unit/nameentry.test.js (the action, kernel-lo
// placement) and test/unit/rpg.test.js (the RPG, banked placement). P2
// hygiene, phase 3 fix round 2: rpg.test.js used to carry its own copy;
// both files now import from here.
//
// Every helper here operates on an already-booted `nes` instance; building
// the ROM and calling `nes.frame()` to get past boot is each caller's own
// business, since the two call sites build genuinely different projects
// (an RPG fixture on disk vs. a fresh mkdtemp action variant). rpg.test.js's
// own bootPastNaming(romPath, frames) is a thin wrapper around this file's
// finishNamingIfOpen(nes) -- this file's shape (operate on an already-booted
// instance) is the one both call sites settled on, since it stays agnostic
// to how each file builds its own ROM.

import assert from 'node:assert/strict';
import { BUTTON } from '../../renderer/emulator/runcontrol.js';

// engine/constants.asm
export const GAME_STATE = 0x25;
export const BOX_STATE = 0x40;
export const BOX_ROW = 0x41; // box_row
export const BOX_TEXT_ROWS = 4;
export const NM_LEN = 0x059a;
export const NM_ROW = 0x059b;
export const NM_COL = 0x059c;
export const PC_NAME_RAM = 0x0571;
export const NAME_LEN = 10; // RPG_LIMITS.nameLength
export const ST_NAMEENTRY = 6;
export const BOX_NAMEENTRY = 9;
export const BOX_NAMEDONE = 10;

export const tap = (nes, button, frames = 14) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
};

/** True once the grid has finished raising and nm_row/nm_col are live -- true
 *  for a hero session (game_state === ST_NAMEENTRY) and a Join session
 *  (game_state stays ST_DIALOG) alike, since box_state is the one signal
 *  both paths actually set. */
export function namingReady(nes) {
  return nes.cpu.mem[BOX_STATE] === BOX_NAMEENTRY && nes.cpu.mem[BOX_ROW] >= BOX_TEXT_ROWS;
}

export function waitForNamingReady(nes, budget = 40) {
  for (let i = 0; i < budget && !namingReady(nes); i++) nes.frame();
  assert.ok(namingReady(nes), 'the naming grid never finished raising');
}

/** Move the grid cursor to (row, col). DOWN's own ring visits every row in
 *  the same forward order regardless of where it starts (row 0 -> 1 -> 2 -> 0),
 *  so it -- never UP, whose own ring takes a different path -- is what a
 *  shared row-seeking helper can rely on without special-casing the start
 *  row. Both loops are bounded and assert on exhaustion. */
export function gotoCell(nes, row, col) {
  for (let i = 0; i < 3 && nes.cpu.mem[NM_ROW] !== row; i++) tap(nes, BUTTON.DOWN);
  assert.equal(nes.cpu.mem[NM_ROW], row, 'the naming grid cursor never reached that row');
  for (let i = 0; i < 26 && nes.cpu.mem[NM_COL] !== col; i++) tap(nes, BUTTON.RIGHT);
  assert.equal(nes.cpu.mem[NM_COL], col, 'the naming grid cursor never reached that column');
}

/** Delete every already-committed letter via the DEL grid cell, from
 *  wherever the cursor sits. */
export function clearName(nes) {
  gotoCell(nes, 2, 0); // DEL
  for (let i = 0; i < NAME_LEN && nes.cpu.mem[NM_LEN] > 0; i++) tap(nes, BUTTON.A);
  assert.equal(nes.cpu.mem[NM_LEN], 0, 'DEL never emptied the name');
}

/** Delete every already-committed letter via the Cancel action instead of
 *  the DEL grid cell -- routes through nameentry_cancel rather than
 *  nameentry_select, so a caller proving the two paths agree needs both. */
export function clearNameViaCancel(nes) {
  for (let i = 0; i < NAME_LEN && nes.cpu.mem[NM_LEN] > 0; i++) tap(nes, BUTTON.B);
  assert.equal(nes.cpu.mem[NM_LEN], 0, 'Cancel never emptied the name');
}

/** Clear the seeded default, type `text` (A-Z/a-z only), then select END. */
export function typeNameAndFinish(nes, text) {
  waitForNamingReady(nes);
  clearName(nes);
  for (const ch of text) {
    const upper = ch !== ch.toLowerCase();
    const row = upper ? 0 : 1;
    const col = ch.toUpperCase().charCodeAt(0) - 65; // 'A'-'Z' -> 0-25
    gotoCell(nes, row, col);
    tap(nes, BUTTON.A); // Confirm -> nameentry_select -> commits this letter
  }
  gotoCell(nes, 2, 1); // END
  tap(nes, BUTTON.A);
  for (let i = 0; i < 20 && nes.cpu.mem[BOX_STATE] === BOX_NAMEDONE; i++) nes.frame();
  assert.notEqual(nes.cpu.mem[BOX_STATE], BOX_NAMEDONE, 'the naming session never handed off after END');
}

/** If a naming session is currently open (game_state === ST_NAMEENTRY),
 *  select END with whatever name is already there (the seeded default, if
 *  untouched) and wait for the session to end. A no-op otherwise, so a
 *  caller can run this unconditionally right after booting a project that
 *  may or may not have hero naming on. */
export function finishNamingIfOpen(nes, budget = 20) {
  if (nes.cpu.mem[GAME_STATE] === ST_NAMEENTRY) {
    waitForNamingReady(nes);
    gotoCell(nes, 2, 1); // END, leaving the seeded default name exactly as compiled
    tap(nes, BUTTON.A);
    for (let i = 0; i < budget && nes.cpu.mem[GAME_STATE] === ST_NAMEENTRY; i++) nes.frame();
    assert.notEqual(nes.cpu.mem[GAME_STATE], ST_NAMEENTRY, 'the hero naming session never ended');
  }
  return nes;
}

export function nameBytes(nes, slot) {
  const bytes = [];
  for (let i = 0; i < NAME_LEN; i++) bytes.push(nes.cpu.mem[PC_NAME_RAM + slot * NAME_LEN + i]);
  return bytes;
}

// The grid reuses the message box's own footprint: tile rows 24-29 (border,
// four text rows, border). Confirmed directly against a real build, not
// assumed: row 26 is A-Z (nm_row 0), row 27 is a-z (nm_row 1), row 28 is the
// controls row (DEL at columns 4-6, END at columns 24-26), row 25 is the
// name preview.
export const BOX_ROW_PREVIEW = 25;
export const BOX_ROW_UPPER = 26;
export const BOX_ROW_LOWER = 27;
export const BOX_ROW_CONTROLS = 28;

/** `count` raw nametable tile ids starting at (row, col) -- what the grid
 *  actually drew, read directly out of PPU VRAM rather than engine RAM,
 *  which cannot see a wrong base-tile arithmetic or a font page that never
 *  got switched in (docs/design-name-entry.md §15's own "the drawn grid's
 *  own nametable content" test). */
export function nametableRow(nes, row, col, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(nes.ppu.vramMem[0x2000 + row * 32 + col + i]);
  return out;
}
