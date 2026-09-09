// A tiny framebuffer probe, shared between test/unit/split.test.js and
// test/unit/nameentry.test.js's P1-B glyph tests (docs/design-name-entry.md
// phase 3 fix round 3). Nothing here is naming-specific -- it answers "which
// CHR bank was live when this nametable cell rendered," which is exactly the
// question the MMC3 scanline split exists to answer, on any screen.
//
// PROBE_TILE ($C1) is deliberately charToTile('A'): solid user art in a
// tileset that has been stamped with SOLID_TILE at that index, and the real
// glyph 'A' in the font page. Writing it into a nametable cell and reading
// the rendered pixel colours back tells you which CHR bank the PPU was
// reading for that scanline -- the glyph has both set and clear pixels, the
// stamped art tile is one solid colour throughout.

export const SOLID_TILE = '3'.repeat(64);
export const PROBE_TILE = 0xc1; // charToTile('A')

/**
 * Put the probe tile in a nametable cell. mirroredWrite keeps jsnes's internal
 * name-table cache in step with vramMem, which a bare array poke does not.
 */
export const probe = (nes, row, col) => nes.ppu.mirroredWrite(0x2000 + row * 32 + col, PROBE_TILE);

/**
 * What the probe cell rendered as. The art version is one solid colour; the
 * glyph 'A' has both set and clear pixels, so the colour count answers which
 * CHR bank was live when that row rendered. Requires a `nes` booted with an
 * `onFrame` capture and a `lastFrame()` accessor (see split.test.js's own
 * `boot`).
 */
export function probeKind(nes, row, col) {
  nes.frame();
  nes.frame();
  const frame = nes.lastFrame();
  const colors = new Set();
  for (let y = row * 8; y < row * 8 + 8; y++) {
    for (let x = col * 8; x < col * 8 + 8; x++) colors.add(frame[y * 256 + x]);
  }
  return colors.size === 1 ? 'art' : 'font';
}
