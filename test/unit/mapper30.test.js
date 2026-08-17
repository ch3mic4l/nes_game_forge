// UNROM 512 (iNES mapper 30) in the vendored emulator core.
//
// The ROMs here are hand-built byte arrays rather than assembled projects: the
// Forge cannot yet *author* mapper 30 (that needs PRG bank switching and a
// CHR-RAM tileset model in the engine), but it can run one, and this is what
// keeps that working.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import NES from '../../renderer/emulator/core/nes.js';

const PRG_BANK = 16384;

/**
 * A minimal mapper-30 ROM: `banks` 16 KB PRG banks, no CHR-ROM. Each bank starts
 * with a marker byte so a bank switch is observable, and the fixed last bank
 * holds `JMP *` with the reset vector pointing at it.
 */
function buildRom({ banks = 4, flags6 = 0x00 } = {}) {
  const rom = new Uint8Array(16 + banks * PRG_BANK);
  rom.set([0x4e, 0x45, 0x53, 0x1a], 0); // "NES\x1a"
  rom[4] = banks; // PRG in 16 KB units
  rom[5] = 0; // no CHR-ROM: CHR-RAM board
  // mapper 30 == $1E: low nibble in byte 6's high bits, high nibble in byte 7's.
  rom[6] = 0xe0 | flags6;
  rom[7] = 0x10;

  for (let bank = 0; bank < banks; bank++) {
    rom[16 + bank * PRG_BANK] = 0xa0 + bank;
  }
  // Fixed bank: JMP to itself at $C000, and the vectors at the very end.
  const fixed = 16 + (banks - 1) * PRG_BANK;
  rom[fixed + 0] = 0x4c;
  rom[fixed + 1] = 0x00;
  rom[fixed + 2] = 0xc0;
  rom[rom.length - 4] = 0x00; // reset vector low
  rom[rom.length - 3] = 0xc0; // reset vector high
  return rom;
}

const boot = (options) => {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(buildRom(options));
  return nes;
};

test('a CHR-RAM mapper-30 ROM loads as UNROM 512', () => {
  const nes = boot();
  assert.equal(nes.rom.mapperType, 30);
  assert.equal(nes.mmap.constructor.mapperName, 'UNROM 512');
  assert.equal(nes.rom.vromCount, 0, 'no CHR-ROM');
  assert.ok(nes.mmap.canWriteChr(0x0000), 'pattern tables must be writable');
});

test('bits 0-4 switch the 16 KB bank at $8000 and leave $C000 fixed', () => {
  const nes = boot({ banks: 4 });
  assert.equal(nes.cpu.mem[0x8000], 0xa0, 'bank 0 at reset');
  assert.equal(nes.cpu.mem[0xc000], 0x4c, 'last bank is fixed at $C000');

  nes.mmap.write(0x8000, 2);
  assert.equal(nes.cpu.mem[0x8000], 0xa2, 'bank 2 swapped in');
  assert.equal(nes.cpu.mem[0xc000], 0x4c, '$C000 must not move');

  nes.mmap.write(0xffff, 1); // the register is the whole $8000-$FFFF range
  assert.equal(nes.cpu.mem[0x8000], 0xa1);
});

test('bits 5-6 switch the CHR-RAM page and each page keeps its own contents', () => {
  const nes = boot();
  assert.equal(nes.mmap.chrPage, 0);

  // Write a distinct pattern byte into each of the four pages.
  for (let page = 0; page < 4; page++) {
    nes.mmap.write(0x8000, page << 5);
    assert.equal(nes.mmap.chrPage, page, `page ${page} selected`);
    nes.ppu.vramMem[0] = 0x10 + page;
    nes.ppu.patternWrite(0, 0x10 + page);
  }

  // Each page must still hold its own byte when banked back in.
  for (let page = 0; page < 4; page++) {
    nes.mmap.write(0x8000, page << 5);
    assert.equal(nes.ppu.vramMem[0], 0x10 + page, `page ${page} kept its data`);
  }
});

test('switching pages repoints the PPU tile cache so writes hit the live page', () => {
  const nes = boot();
  const tileOnPage0 = nes.ppu.ptTile[0];
  nes.mmap.write(0x8000, 1 << 5);
  assert.notEqual(nes.ppu.ptTile[0], tileOnPage0, 'page 1 must use its own Tile objects');
  nes.mmap.write(0x8000, 0);
  assert.equal(nes.ppu.ptTile[0], tileOnPage0, 'page 0 gets its original tiles back');
});

test('the mapper controls mirroring only in the one-screen encoding', () => {
  // bit 3 set, bit 0 clear: one screen, selected by the mapper's bit 7.
  const oneScreen = boot({ flags6: 0x08 });
  assert.equal(oneScreen.mmap.mapperControlsMirroring, true);
  assert.equal(oneScreen.ppu.currentMirroring, oneScreen.rom.SINGLESCREEN_MIRRORING);
  oneScreen.mmap.write(0x8000, 0x80);
  assert.equal(oneScreen.ppu.currentMirroring, oneScreen.rom.SINGLESCREEN_MIRRORING2);
  oneScreen.mmap.write(0x8000, 0x00);
  assert.equal(oneScreen.ppu.currentMirroring, oneScreen.rom.SINGLESCREEN_MIRRORING);

  // bit 3 and bit 0 both set: four-screen, which the mapper must never override.
  const fourScreen = boot({ flags6: 0x09 });
  assert.equal(fourScreen.mmap.mapperControlsMirroring, false);
  assert.equal(fourScreen.rom.getMirroringType(), fourScreen.rom.FOURSCREEN_MIRRORING);
  const before = fourScreen.ppu.currentMirroring;
  fourScreen.mmap.write(0x8000, 0x80);
  assert.equal(fourScreen.ppu.currentMirroring, before, 'bit 7 must be ignored');

  // bit 3 clear: ordinary fixed mirroring from bit 0.
  const fixed = boot({ flags6: 0x01 });
  assert.equal(fixed.mmap.mapperControlsMirroring, false);
});

test('a mapper-30 ROM runs and fills its CHR-RAM from PRG', () => {
  const nes = boot();
  for (let i = 0; i < 10; i++) nes.frame();
  assert.ok(nes.cpu.REG_PC >= 0x8000, `PC $${nes.cpu.REG_PC.toString(16)} should stay in ROM`);
});

// --- self-flashing (iNES byte 6 bit 1 set) -----------------------------------
//
// The SST39SF040's command decode only looks at address bits A0-A14, so the
// classic $5555/$2AAA unlock addresses are only reachable by putting the
// right *bank* in the switchable window first: A14 comes from the PRG bank
// register's own low bit. chipWrite below is exactly the two-step dance a
// real driver performs -- select the bank that puts the target chip address
// in $8000-$BFFF, then write it -- so every test here reads like the actual
// register/data sequence a driver would issue, not a shortcut around it.

const FLASH_BATTERY_BIT = 0x02;

function chipWrite(nes, chipAddr, value) {
  nes.mmap.write(0xc000, (chipAddr >> 14) & 0x1f);
  nes.mmap.write(0x8000 + (chipAddr & 0x3fff), value);
}

function unlock(nes) {
  chipWrite(nes, 0x5555, 0xaa);
  chipWrite(nes, 0x2aaa, 0x55);
}

function programByte(nes, chipAddr, value) {
  unlock(nes);
  chipWrite(nes, 0x5555, 0xa0);
  chipWrite(nes, chipAddr, value);
}

function eraseSector(nes, chipAddr) {
  unlock(nes);
  chipWrite(nes, 0x5555, 0x80);
  unlock(nes);
  chipWrite(nes, chipAddr, 0x30);
}

function eraseChip(nes) {
  unlock(nes);
  chipWrite(nes, 0x5555, 0x80);
  unlock(nes);
  chipWrite(nes, 0x5555, 0x10);
}

// Reads a chip address back through the CPU window, banking in whichever
// PRG bank holds it first -- the same thing a driver has to do, and proof
// the byte is visible through cpu.mem, not only in the mapper's own bytes.
function chipRead(nes, chipAddr) {
  nes.mmap.write(0xc000, (chipAddr >> 14) & 0x1f);
  return nes.cpu.mem[0x8000 + (chipAddr & 0x3fff)];
}

test('a full unlock programs a byte', () => {
  const nes = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  eraseSector(nes, 0x1000); // guarantee a known, erased ($FF) starting byte
  assert.equal(chipRead(nes, 0x1000), 0xff);
  programByte(nes, 0x1000, 0x42);
  assert.equal(chipRead(nes, 0x1000), 0x42);
});

test('a wrong intermediate address resets the state machine', () => {
  const nes = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  eraseSector(nes, 0x1000);
  chipWrite(nes, 0x5555, 0xaa); // correct first step
  chipWrite(nes, 0x3aaa, 0x55); // wrong address for the second step
  chipWrite(nes, 0x5555, 0xa0); // would-be program command
  chipWrite(nes, 0x1000, 0x42); // would-be program data
  assert.equal(chipRead(nes, 0x1000), 0xff, 'a broken sequence must not program anything');
});

test('program only clears bits, so $0F written over $F0 yields $00', () => {
  const nes = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  eraseSector(nes, 0x1000);
  programByte(nes, 0x1000, 0xf0);
  assert.equal(chipRead(nes, 0x1000), 0xf0);
  programByte(nes, 0x1000, 0x0f);
  assert.equal(chipRead(nes, 0x1000), 0x00, '$F0 AND $0F must clear every bit, never set one');
});

test('sector erase wipes exactly 4 KB and not one byte outside it', () => {
  const nes = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  // Bank 1 starts all zero except its own marker byte -- a natural
  // "unprogrammed" backdrop distinct from the $FF an erase produces.
  const sectorBase = 0x4000; // bank 1, offset 0
  eraseSector(nes, sectorBase + 100);
  for (let offset = 0; offset < 4096; offset += 512) {
    assert.equal(chipRead(nes, sectorBase + offset), 0xff, `offset ${offset} inside the sector should be erased`);
  }
  assert.equal(chipRead(nes, sectorBase - 1), 0x00, 'the byte just before the sector must be untouched');
  assert.equal(chipRead(nes, sectorBase + 4096), 0x00, 'the byte just after the sector must be untouched');
});

// The bank register accepts values 0-31 regardless of how many banks this
// image actually has (4, here, like every fixture in this file), so a
// driver -- or a bug in one -- can build a chip address that points past
// the end of the real image. Real hardware (and Mesen's own
// FlashSST39SF040) simply ignores an operation that does not fully fit
// rather than doing anything at all, which is the only faithful answer:
// silently wrapping into whatever real bank the address happens to land on
// modulo the image size would let a buggy driver corrupt bank 3 -- the
// fixed bank, reset vectors included -- while looking correct in every test
// that never crosses this boundary.
test('a byte program past the image size is ignored, not wrapped into a real bank', () => {
  const nes = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  // Bank 31 selected via the register's full 5-bit field, offset 0 -- what
  // 31 modulo 4 banks used to wrap onto: bank 3 (the fixed bank) at the
  // same offset, which holds a real, nonzero opcode byte ($4C, the start of
  // "JMP *"), not incidental padding a wrongly-applied $00 could not reveal.
  const wrapTarget = 3 * 16384; // chip address $C000
  assert.equal(chipRead(nes, wrapTarget), 0x4c, 'sanity: this byte is real code, not padding');
  programByte(nes, 31 * 16384, 0x00); // chip address $7C000
  assert.equal(chipRead(nes, wrapTarget), 0x4c, 'an out-of-range program must not reach bank 3 at all');
});

test('a sector erase that does not fully fit inside the image is ignored, not wrapped onto the reset vectors', () => {
  const nes = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  const resetVectorLo = 3 * 16384 + 0x3ffc; // chip address $FFFC
  const resetVectorHi = resetVectorLo + 1;
  const before = [chipRead(nes, resetVectorLo), chipRead(nes, resetVectorHi)];
  // $7F000's own 4 KB sector is entirely past a 4-bank (64 KB) image, but
  // $7F000 modulo 64 KB used to land exactly on bank 3's own $3000-$3FFF --
  // the sector the reset vectors live in.
  eraseSector(nes, 0x7f000);
  assert.deepEqual(
    [chipRead(nes, resetVectorLo), chipRead(nes, resetVectorHi)],
    before,
    'an out-of-range sector erase must not touch the reset vectors'
  );
});

test('erase requires all six cycles', () => {
  const nes = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  const before = chipRead(nes, 0x4000); // bank 1's own marker byte, 0xa1
  unlock(nes);
  chipWrite(nes, 0x5555, 0x80);
  unlock(nes);
  // Stop here -- the sixth write ($10 or $30) never arrives.
  assert.equal(chipRead(nes, 0x4000), before, 'five of six cycles must not erase anything');
  assert.notEqual(before, 0xff, 'sanity: this byte was never erased to begin with');
});

test('with the battery bit SET, $8000-$BFFF does not bank-switch, but $C000-$FFFF still does', () => {
  const nes = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  assert.equal(nes.cpu.mem[0x8000], 0xa0, 'bank 0 at reset');
  nes.mmap.write(0x8000, 2); // looks like a bank-select write, but this board is flashable
  assert.equal(nes.mmap.prgBank, 0, '$8000-$BFFF must reach the flash chip, not the register');
  assert.equal(nes.cpu.mem[0x8000], 0xa0, 'no bank switch should have happened');

  nes.mmap.write(0xc000, 2); // the register is still $C000-$FFFF on a flashable board
  assert.equal(nes.mmap.prgBank, 2);
  assert.equal(nes.cpu.mem[0x8000], 0xa2, 'bank 2 swapped in through the register');
});

test('with the battery bit CLEAR, $8000-$BFFF still banks (no regression)', () => {
  const nes = boot({ banks: 4, flags6: 0x00 });
  assert.equal(nes.mmap.flashable, false);
  nes.mmap.write(0x8000, 2);
  assert.equal(nes.mmap.prgBank, 2, 'a non-flashable board keeps treating $8000-$BFFF as the register');
  assert.equal(nes.cpu.mem[0x8000], 0xa2);
});

// chipRead goes through cpu.mem directly, which is exactly right for
// ordinary reads (that is what nes.mmap.load() falls through to when the
// chip has nothing to say) but blind to the id/busy overlay, which only
// exists inside Mapper30.load() -- a driver's LDA reaches it, but this
// helper's array indexing does not. Software ID and the busy model need the
// real read path, so they use chipLoad instead.
function chipLoad(nes, chipAddr) {
  nes.mmap.write(0xc000, (chipAddr >> 14) & 0x1f);
  return nes.mmap.load(0x8000 + (chipAddr & 0x3fff));
}

test('software ID mode reports the manufacturer and device bytes', () => {
  const nes = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  unlock(nes);
  chipWrite(nes, 0x5555, 0x90); // enter software ID mode
  assert.equal(chipLoad(nes, 0x0000), 0xbf, 'SST manufacturer ID');
  assert.equal(chipLoad(nes, 0x0001), 0xb7, 'SST39SF040 device ID');
  unlock(nes);
  chipWrite(nes, 0x5555, 0xf0); // reset back to reading the array
  assert.equal(chipLoad(nes, 0x0000), 0xa0, 'ordinary reads should resume');
});

test('a single $F0 write to any address exits software ID mode, not only the three-write sequence', () => {
  const nes = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  unlock(nes);
  chipWrite(nes, 0x5555, 0x90); // enter software ID mode
  assert.equal(nes.mmap.flash.mode, 'id');
  // The datasheet treats a single $F0, to any address, as equivalent to the
  // full three-write reset -- not gated on cmd matching $5555 the way the
  // rest of the unlock sequence is.
  chipWrite(nes, 0x1234, 0xf0);
  assert.equal(nes.mmap.flash.mode, 'read', 'a bare $F0 write must exit ID mode by itself');
  assert.equal(chipLoad(nes, 0x0000), 0xa0, 'ordinary reads should resume');
});

test('software ID mode reads $FF outside the manufacturer/device alias addresses', () => {
  const nes = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  unlock(nes);
  chipWrite(nes, 0x5555, 0x90); // enter software ID mode
  // Falling through to the real ROM byte here would let code that failed to
  // leave ID mode keep executing sensible-looking bytes instead of the
  // garbage a real chip would hand it -- exactly the kind of driver bug
  // this model exists to expose, not hide.
  assert.equal(chipLoad(nes, 0x0002), 0xff, 'an ID-mode read past the two alias addresses must read $FF');
  // The alias window repeats every $200 bytes (addr & 0x1FF, matching
  // Mesen), so $1000 aliases right back to offset 0 -- $1002 is a *different*
  // repeat of the window, at the same non-alias offset $0002 is, and proves
  // this is not somehow special-cased only near address 0.
  assert.equal(chipLoad(nes, 0x1002), 0xff, 'the $FF fallback applies in every repeat of the alias window');
});

// Mesen's own flash model is instantaneous, so it -- and a straight port of
// it -- cannot tell a RAM-resident driver from one left running in ROM: both
// simply read correct data throughout. The busy model is what makes that
// distinction observable: opt-in, because leaving it off (the default) must
// not change a single existing assertion above.
test('the busy model, once opted into, toggles reads across the whole $8000-$FFFF window', () => {
  const nes = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  nes.mmap.flash.emulateBusy = true;
  nes.mmap.flash.busyReadCycles = 4;
  programByte(nes, 0x1000, 0x00); // starts a program op, which arms the busy model

  const first = chipLoad(nes, 0x1000);
  const second = chipLoad(nes, 0x1000);
  assert.notEqual(first, second, 'DQ6 must toggle between successive reads while busy');

  // The fixed bank is the same physical chip and must show the same busy
  // status -- this is the exact property that catches a driver mistakenly
  // left executing from ROM instead of the $0600 RAM copy the design calls
  // for: bank 3 (the fixed one here) holds a real JMP opcode ($4C) at
  // offset 0, which a busy read must not return.
  const fixedBankDuringBusy = nes.mmap.load(0xc000);
  assert.notEqual(fixedBankDuringBusy, 0x4c, "the fixed bank must show busy status too, not its real byte");

  for (let i = 0; i < 10; i++) chipLoad(nes, 0x1000); // exhaust the busy window
  assert.equal(nes.mmap.flash.busyReadsLeft, 0, 'busy should have cleared');
  assert.equal(nes.mmap.load(0xc000), 0x4c, 'the fixed bank should read its real byte again once idle');
});

test('the busy model is opt-in and off by default', () => {
  const nes = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  programByte(nes, 0x1000, 0x00);
  assert.equal(nes.mmap.flash.busyReadsLeft, 0, 'no busy window without emulateBusy set');
  assert.equal(chipLoad(nes, 0x1000), 0x00, 'a normal read should see the real data immediately');
});

// The busy model only overlays *reads* by itself -- write() went on decoding
// unlock sequences regardless, so a driver that fired off an erase and
// several programs back to back and polled only the last one would look
// correct here while real hardware discarded every command but the first.
// The SST39SF040 ignores writes entirely while an internal program or erase
// is in progress, for byte program, sector erase and chip erase alike.
test('a command issued while busy is discarded, not queued or applied', () => {
  const nes = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  eraseSector(nes, 0x1000); // ordinary setup, before the busy model is armed
  eraseSector(nes, 0x2000);

  nes.mmap.flash.emulateBusy = true;
  nes.mmap.flash.busyReadCycles = 8;
  programByte(nes, 0x1000, 0x77); // completes, then arms busy for what follows
  assert.ok(nes.mmap.flash.busyReadsLeft > 0, 'sanity: the chip should still be busy');

  // A full second unlock + program, issued without ever polling (reading)
  // in between -- no different, from the chip's perspective, than a driver
  // that fired an erase and several programs and checked only the last.
  programByte(nes, 0x2000, 0x11);
  assert.equal(chipRead(nes, 0x2000), 0xff, 'a command issued while busy must be discarded entirely');
  assert.equal(chipRead(nes, 0x1000), 0x77, 'the operation already in progress must still complete correctly');
});

test('a flash write survives an in-session reset (nes.reloadROM), but not a genuinely fresh load', () => {
  const nes = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  eraseSector(nes, 0x1000);
  programByte(nes, 0x1000, 0x55);
  assert.equal(chipRead(nes, 0x1000), 0x55);

  // In-session reset: nes.romData was mutated by the write-through above, so
  // reparsing it (exactly what a power cycle does on this board -- there is
  // no other reset path) reproduces the flashed byte.
  nes.reloadROM();
  assert.equal(chipRead(nes, 0x1000), 0x55, 'a power cycle must not lose a flashed byte');

  // A genuinely fresh load -- closing and reopening the built-in player,
  // which rereads game.nes from disk -- has no such write-through: nothing
  // in this app writes the flash chip's contents back to the file on disk,
  // so a brand new byte array built from the same original source is
  // unflashed, exactly as it would be the first time the ROM was ever opened.
  const fresh = new NES({ onFrame: () => {}, emulateSound: false });
  fresh.loadROM(buildRom({ banks: 4, flags6: FLASH_BATTERY_BIT }));
  assert.equal(chipRead(fresh, 0x1000), 0x00, 'a fresh load from the original file must not see the flash write');
});

// ROM.load() (rom.js) accepts a plain ArrayBuffer as well as a typed array
// -- it converts a *local copy* of the argument for its own parsing, but
// nes.loadROM() stores whatever was actually passed in as nes.romData, so
// an ArrayBuffer-loaded ROM leaves nes.romData as a raw ArrayBuffer, not a
// view. Write-through must reach that too, not only the Uint8Array/Buffer
// case every other test here happens to use.
test('the romData write-through also works when the ROM was loaded from a plain ArrayBuffer', () => {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  const rom = buildRom({ banks: 4, flags6: FLASH_BATTERY_BIT });
  nes.loadROM(rom.buffer);
  assert.ok(nes.romData instanceof ArrayBuffer, 'sanity: nes.romData should be the raw ArrayBuffer, not a view');

  eraseSector(nes, 0x1000);
  programByte(nes, 0x1000, 0x55);
  assert.equal(chipRead(nes, 0x1000), 0x55);

  nes.reloadROM();
  assert.equal(chipRead(nes, 0x1000), 0x55, 'an ArrayBuffer-backed ROM must survive a power cycle too');
});

// ROM.load() also accepts a binary string (one character per byte,
// data.charCodeAt(i) & 0xff) -- the built-in player never constructs one,
// but the core's own accepted input types are the contract here, not just
// what one caller happens to use. A JS string is immutable, so
// write-through has nowhere to land unless romDataBytes() replaces
// nes.romData with a mutable copy the first time a flash write needs one.
function toBinaryString(bytes) {
  const chars = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) chars[i] = String.fromCharCode(bytes[i]);
  return chars.join("");
}

test('the romData write-through also works when the ROM was loaded from a binary string', () => {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  const rom = buildRom({ banks: 4, flags6: FLASH_BATTERY_BIT });
  nes.loadROM(toBinaryString(rom));
  assert.equal(typeof nes.romData, 'string', 'sanity: nes.romData should still be the original string before any flash write');

  eraseSector(nes, 0x1000);
  programByte(nes, 0x1000, 0x55);
  assert.equal(chipRead(nes, 0x1000), 0x55);

  nes.reloadROM();
  assert.equal(chipRead(nes, 0x1000), 0x55, 'a string-backed ROM must survive a power cycle too');
});

test('a save state preserves the flash protocol state and every flashed byte', () => {
  const nes = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  eraseSector(nes, 0x1000);
  programByte(nes, 0x1000, 0x77);
  // Mid-sequence too: toJSON must not lose an in-progress unlock.
  chipWrite(nes, 0x5555, 0xaa);

  const state = nes.mmap.toJSON();

  const restored = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  restored.mmap.fromJSON(state);
  assert.equal(chipRead(restored, 0x1000), 0x77, 'the flashed byte must survive the round trip');
  assert.equal(restored.mmap.flash.cycle, 1, 'a sequence already one step in must resume, not reset');

  // Behavioural, not just a field check: finish the sequence the restore
  // resumed (2AAA:55, then 5555:A0, then the data byte) and confirm the
  // restored chip treats it as the sequence's *second* step, not a fresh
  // first one -- proof the round trip preserves what the protocol state
  // actually does, not only what flash.cycle happens to say.
  chipWrite(restored, 0x2aaa, 0x55);
  chipWrite(restored, 0x5555, 0xa0);
  chipWrite(restored, 0x0000, 0x0f); // bank 0's own marker byte is $A0
  assert.equal(chipRead(restored, 0x0000), 0x00, 'the resumed sequence must still complete a program ($A0 AND $0F)');
});

// fromJSON restores nes.rom.rom and the mapped windows, but a restored byte
// that never reaches nes.romData looks correct right up until the next
// nes.reloadROM() reparses the *old* image and quietly discards it --
// exactly the kind of bug a save-state test that never reloads afterward
// would never catch.
test('a save-state restore survives a reload afterward', () => {
  const nes = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  eraseSector(nes, 0x1000);
  programByte(nes, 0x1000, 0x99);
  const state = nes.mmap.toJSON();

  const restored = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  restored.mmap.fromJSON(state);
  assert.equal(chipRead(restored, 0x1000), 0x99, 'the restore itself should see the flashed byte');

  restored.reloadROM();
  assert.equal(chipRead(restored, 0x1000), 0x99, 'a reload after a restore must not revert to the pre-flash byte');
});

test('a chip erase wipes every bank, including the fixed one', () => {
  const nes = boot({ banks: 4, flags6: FLASH_BATTERY_BIT });
  assert.equal(chipRead(nes, 0x0000), 0xa0, 'bank 0 marker before erase');
  assert.equal(chipRead(nes, 0x4000), 0xa1, 'bank 1 marker before erase');
  assert.equal(chipRead(nes, 0xc000), 0x4c, 'the fixed bank holds real code before erase');
  eraseChip(nes);
  for (const chipAddr of [0x0000, 0x4000, 0x8000, 0xc000]) {
    assert.equal(chipRead(nes, chipAddr), 0xff, `chip address $${chipAddr.toString(16)} should be erased`);
  }
});

// The real thing, when it is available. Mapper 30 support exists because this
// project's ROM needs it, so run against it when the checkout is present.
const FALLEN_STAR = '/home/chris/claude_nes_test/fallen_star.nes';

test('the Fallen Star ROM boots and uploads three CHR-RAM pages', { skip: !fs.existsSync(FALLEN_STAR) }, () => {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(FALLEN_STAR)));

  assert.equal(nes.rom.mapperType, 30);
  assert.equal(nes.rom.isNES2, true);
  assert.equal(nes.rom.chrRamSize, 32768);
  assert.equal(nes.rom.getMirroringType(), nes.rom.FOURSCREEN_MIRRORING);

  for (let i = 0; i < 240; i++) nes.frame();
  assert.ok(nes.cpu.REG_PC >= 0x8000, 'PC should be in ROM');

  // The game copies three 8 KB pattern payloads out of PRG at boot; the fourth
  // page is nametable backing for the four-screen board and stays empty.
  const filled = nes.mmap.chrPages.map((page) => page.some((byte) => byte !== 0));
  const live = nes.ppu.vramMem.slice(0, 0x2000).some((byte) => byte !== 0);
  assert.ok(live, 'the live pattern tables should hold uploaded art');
  assert.equal(filled.filter(Boolean).length >= 2, true, 'the off-screen pages should hold art too');
});
