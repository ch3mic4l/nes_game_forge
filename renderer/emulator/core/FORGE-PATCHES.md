# Vendored emulator core

This directory is a vendored copy of [jsnes](https://github.com/bfirsh/jsnes)
(MIT). It is vendored rather than installed so the debugger can reach into CPU,
PPU and APU internals, and so the palette can be shared with the editors.

Keep this list current — it is what makes a future upgrade tractable.

## Changes from upstream

**`ppu/palette-table.js` and `ppu/index.js` — canonical NES palette.**
Upstream's `loadNTSCPalette()` lists hues in the opposite order to the standard
`$xx` colour numbering: `$01` renders red where real hardware (and Mesen, and
every NES palette reference) shows dark blue. A ROM built from a project would
therefore look wrong in the built-in player while looking right in the Tile
Forge, which defeats the point of previewing in-app.

`loadForgePalette()` fills the table from `shared/nespalette.js` — the same 64
colours the Tile Forge, Map Forge and Sprite Forge draw with — and `ppu/index.js`
calls it instead of `loadNTSCPalette()`. Upstream's tables are left in place and
unused so the diff stays small.

**`mappers/mapper30.js` and `mappers/index.js` — UNROM 512 (iNES mapper 30).**
Added, not upstream. A homebrew board with 16 KB switchable PRG, a fixed last
bank, and up to 32 KB of CHR-RAM in four switchable 8 KB pages — there is no
CHR-ROM, so the game uploads its patterns from PRG at boot. Needed because it is
what `../../../../claude_nes_test` (Fallen Star) ships as, and without it the
Forge's own player and debugger cannot open such a ROM at all.

CHR-RAM paging follows the `mapper119.js` precedent: each page owns its bytes
*and* its decoded `Tile` objects, and a page switch repoints `ppu.ptTile` at that
page's tiles. That keeps `ppu.patternWrite()` landing on the live page with no
cache rebuild. Self-flashing through the same register is not implemented; only
cartridge-authoring tools use it.

**`rom.js` — `getMirroringType()` knows mapper 30 redefines the mirroring bits.**
On UNROM 512, byte 6 bit 3 set with bit 0 *clear* means one-screen with the mapper
picking which nametable, and only *both* bits set means four-screen. Upstream
reads bit 3 alone as four-screen, which would hand a one-screen board four
nametables. This has to live in `rom.js` because `nes.loadROM()` applies
`getMirroringType()` immediately after `mmap.loadROM()`, so a mapper cannot
correct it from its own constructor.

**`mappers/mapper4.js` — nesdev-correct MMC3 scanline IRQ.**
Upstream has the register pair backwards: it treats `$C000` as the live counter
and `$C001` as the latch, and only counts while the IRQ is enabled. Real MMC3
(and Mesen) take the latch at `$C000`, reload on any `$C001` write, count on
every filtered A12 rise regardless of `$E000`, and assert on the clock that
leaves the counter at zero. The Forge engine's split-screen support (the font's
own CHR bank on MMC3) arms the counter from NMI with the hardware sequence, so
the vendored core must count the same way or the split lands on the wrong
scanline in the built-in player while looking right in Mesen. Mappers 118/119
inherit the fix.

## Deliberately not changed

Run control (stepping, breakpoints, watchpoints) is layered on top in
`../runcontrol.js` rather than patched in, so the core stays close to upstream.
`Emulator.stepInstruction()` mirrors the body of `nes.frame()`; if that loop
changes upstream, update the mirror to match.
