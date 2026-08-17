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
cache rebuild.

**Self-flashing, when the header's battery bit is set.** Added, not upstream —
Mesen2 is the reference every other emulator agrees with (`FlashSST39SF040`,
instantiated by `UnRom512.h`). On a board with iNES byte 6 bit 1 set, the
$8000-$BFFF write range stops being a mirror of the bank register and reaches
an emulated SST39SF040 flash chip instead (512 KB, 4 KB sectors, the standard
JEDEC unlock sequence); $C000-$FFFF keeps banking exactly as before, since the
two ranges never overlap on this board. `FlashSST39SF040` in `mapper30.js`
owns only the unlock-sequence/mode state machine — never any bytes itself,
since *where* a byte physically lives (which PRG bank, and whether that bank
happens to be mapped in right now) is `Mapper30`'s own business. A write that
actually programs or erases something is applied to the canonical bank in
`nes.rom.rom`, mirrored into `nes.cpu.mem` when that bank is currently
visible, and — the explicit divergence from upstream below — into
`nes.romData` too.

Faithfulness to the real chip is the point here, not leniency: the bank
register accepts values 0-31 regardless of how many banks an image actually
has, so an operation can name a chip address past the image's real size (a
byte program) or one whose 4 KB sector only partly fits (a sector erase).
Real hardware — and `FlashSST39SF040.h` — silently ignores both rather than
doing anything to the bytes that do exist; this matches that exactly, never
wrapping such an address into a real bank via modulo, which would let a
buggy driver corrupt a bank it never named (bank 3's own reset vectors, on a
small image, are one wrap away from every out-of-range sector erase). The
same reasoning applies to the busy model below and to software ID mode: a
driver bug that would silently misbehave on a cartridge must misbehave here
too, or this model would pass exactly the drivers it exists to catch.

**`nes.romData` write-through, added alongside the flash chip.** Upstream
never mutates `romData` after the initial `loadROM()`; nothing needed to.
Self-flashing does: `nes.reloadROM()` (an in-session "power cycle", and the
*only* reset path this board has) works by reparsing `romData` from scratch,
so a flashed byte that only reached `nes.rom.rom` and `cpu.mem` would vanish
on the very next reset. Writing through to `romData` is what makes a power
cycle actually see it. This still is not persistence to disk — closing and
reopening the built-in player rereads `game.nes` from the filesystem, and
nothing in this app writes flash contents back there, so a flashed byte
survives exactly as long as the loaded `Uint8Array` does and no longer.
`test/unit/mapper30.test.js` exercises both: `nes.reloadROM()` on the same
`NES` instance sees the flash, a fresh `NES` loading a fresh copy of the
original bytes does not.

An optional busy model (`flash.emulateBusy`, off by default) makes reads of
$8000-$FFFF — the fixed bank included, since it is the same physical chip —
return a toggling status byte for a few reads after a program or erase,
approximating the real chip's DQ6 toggle-bit polling. While busy, the model
also discards every write outright (`FlashSST39SF040.write()` returns early)
rather than continuing to decode unlock sequences, matching the datasheet: a
real SST39SF040 ignores commands entirely during an internal program or
erase. Without that, a driver that fired off several commands back to back
and polled only the last one would look correct here while hardware silently
dropped everything but the first — exactly the bug the busy model exists to
catch, and only catches if writes are gated the same way reads are. Mesen's
own flash is instantaneous, so neither it nor a plain port of it can
distinguish a driver that runs from console RAM (as real hardware requires)
from one mistakenly left executing out of ROM during the operation; this is
what turns that distinction into something a test can actually fail on. Only cartridge
authoring tools and this board's own save feature ever write to the chip; an
ordinary ROM never sets the battery bit and never notices any of this.

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
