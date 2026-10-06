// Row 1 of the acceptance table: ROM identity. One function, `identityFailures`, answers "is this build really the ring cell it
// claims to be?" from the built ROM, never from config.inc alone:
//   - the iNES header's mapper and mirroring bit equal the cell's;
//   - STREAM_RING equals the cell's ring and the four generated constants equal the geometry's lengths;
//   - the dialogue placement equals the one the cell was built to get;
//   - the forked instructions are PRESENT IN THE ROM with the right operand: each ring-only label of 02-ring-engine.patch is read at
//     its file offset and must be the expected opcode followed by the geometry's own number. A four-screen or unforked fallback has
//     no such label (ring forced 0), or has the wrong operand (a length-30 strip), and fails here.
// The expected numbers come from the geometry (plan 1.1), written down here, not read back from the build.
import { RING_FORK_LABELS } from './ringlabels.mjs';

// STATIC assembly checks, not behaviour: the wrap-modulus forks and the OPPOSITE-axis strip-length forks (the row length on a vertical ring, the
// column length on a horizontal one) are unreachable in every legal production scene. Dead-axis invariant (phase3b-s1a-review1.md finding 7):
//   * a column strip's `st_vary` starts at win_row_local + 15*(win_row_screen&1) (engine/streamworld.asm:1493-1503) and a row strip's at
//     win_col_local + 16*(win_col_screen&1) (:1599-1607); the extent clamp makes the DEAD axis' camera and desired window origin zero
//     (:2773-2787, 2803-2897, 2910-2998), landing/install and guard install those values (:3077-3084, 3325-3334), and the only incremental
//     writers are the inc/dec routines (:2583-2623) reached through sw_win_arm (:3351-3425) -- all four production start calls (:3372, 3377,
//     3420, 3425) -- so a column on the vertical ring starts at 0 and draws 0..14, a row on the horizontal ring starts at 0 and draws 0..15;
//   * the NMI checks completion BEFORE it increments st_vary (:1702-1706), so the wrap comparison is never reached with 15/16, and the reduced
//     entry jumps into the same loop (:1738-1745).
// Hence these forks have no production behavioural necessity; a mismatching operand here proves the prescribed assembly text is absent, not that
// a reachable rendering defect exists. They are kept because the accepted plan prescribes them. A synthetic-offset `armStrip` (S1c) is a
// separate input domain with its own contract; nothing here counts as wrap COVERAGE.
const isStaticLabel = (label, field, ring) => /wrap/.test(label) || (ring === 1 && field === 'row') || (ring === 2 && field === 'col');

/** What each ring mode must assemble: column strip len, row strip len, render-window NT step and end. */
export const RING_GEOMETRY = {
  1: { col: 15, row: 32, step: 1, end: 2 }, // vertical mirroring: 32 x 15 blocks, NTs 0,1; the row strip is dead code, left at its four-screen length
  2: { col: 30, row: 16, step: 2, end: 4 } // horizontal mirroring: 16 x 30 blocks, NTs 0,2; the column strip is dead code, left at its four-screen length
};
export const MIRROR_BIT = { vertical: 1, horizontal: 0 };

export function fileOffsetOfKernelAddr(rom, addr) {
  if (addr < 0xc000) throw new Error(`ring fork label at $${addr.toString(16)} is not in the fixed kernel`);
  return 16 + (rom[4] - 1) * 16384 + (addr - 0xc000);
}

/**
 * built: buildCell() result. cell: CELLS entry (or a synthetic one). Returns an array of failure strings (empty = identity holds).
 */
export function identityFailures(built, cell, { expectBanked, expectRing = cell.ring } = {}) {
  const fails = [];
  const p = built.prov;
  const rom = built.rom;
  if (p.header.mapper !== cell.mapper) fails.push(`header mapper ${p.header.mapper}, cell wants ${cell.mapper}`);
  if (p.header.fourScreen) fails.push('header is four-screen');
  const want = MIRROR_BIT[cell.mirroring];
  if (p.header.mirrorBit !== want) fails.push(`header mirroring bit ${p.header.mirrorBit}, cell (${cell.mirroring}) wants ${want}`);
  if (p.streamRing !== expectRing) fails.push(`STREAM_RING = ${p.streamRing}, cell wants ${expectRing}`);
  const geo = RING_GEOMETRY[expectRing];
  if (!geo) fails.push(`no geometry for ring ${expectRing}`);
  else {
    const c = p.ringConsts;
    if (c.SW_RING_COL_LEN !== geo.col) fails.push(`SW_RING_COL_LEN = ${c.SW_RING_COL_LEN}, want ${geo.col}`);
    if (c.SW_RING_ROW_LEN !== geo.row) fails.push(`SW_RING_ROW_LEN = ${c.SW_RING_ROW_LEN}, want ${geo.row}`);
    if (c.SW_RW_NT_STEP !== geo.step) fails.push(`SW_RW_NT_STEP = ${c.SW_RW_NT_STEP}, want ${geo.step}`);
    if (c.SW_RW_NT_END !== geo.end) fails.push(`SW_RW_NT_END = ${c.SW_RW_NT_END}, want ${geo.end}`);
    for (const [label, { opcode, field }] of Object.entries(RING_FORK_LABELS)) {
      const addr = built.fns[label];
      const tag = isStaticLabel(label, field, expectRing) ? 'static assembly check: ' : '';
      if (!Number.isFinite(addr)) { fails.push(`${tag}ring-only symbol ${label} is not in game.fns -- the ring fork was not assembled`); continue; }
      const off = fileOffsetOfKernelAddr(rom, addr);
      if (rom[off] !== opcode) fails.push(`${tag}${label} @$${addr.toString(16)}: opcode $${rom[off].toString(16)}, want $${opcode.toString(16)}`);
      else if (rom[off + 1] !== geo[field]) fails.push(`${tag}${label} @$${addr.toString(16)}: operand ${rom[off + 1]}, geometry wants ${geo[field]} (${field})`);
    }
  }
  // Placement: requested (the cell), predicted (the JS predicate), the generated flag, and the ROM witness (where the overlay's own
  // `sw_dlg_single` assembled: resident $C000+ / switchable $8000-$BFFF). All four must agree; the prediction alone proves nothing about the ROM.
  if (expectBanked !== undefined) {
    const pl = p.placement;
    const want = expectBanked ? 'switchable' : 'resident';
    if (p.dialogueBanked !== expectBanked) fails.push(`dialogue placement: predicate says banked=${p.dialogueBanked}, cell requested banked=${expectBanked}`);
    if (pl.generatedFlag !== (expectBanked ? 1 : 0)) fails.push(`dialogue placement: generated SW_DLG_BANKED = ${pl.generatedFlag}, cell requested banked=${expectBanked}`);
    if (pl.assembled !== want) fails.push(`dialogue placement: sw_dlg_single assembled ${pl.assembled}${pl.overlayAddr == null ? '' : ' @$' + pl.overlayAddr.toString(16)}, cell requested ${want}`);
  }
  return fails;
}
