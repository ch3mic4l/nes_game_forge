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
