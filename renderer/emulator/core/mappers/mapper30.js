import Mapper0 from "./mapper0.js";
import Tile from "../tile.js";
import { copyArrayElements } from "../utils.js";

// UNROM 512 (homebrew board, iNES mapper 30)
// 16 KB switchable PRG-ROM at $8000, last 16 KB fixed at $C000, up to 512 KB.
// There is no CHR-ROM: up to 32 KB of CHR-RAM in four switchable 8 KB pages,
// which the program fills from PRG at boot.
//
// One register, written anywhere in $8000-$FFFF:
//
//   7  bit  0
//   ---- ----
//   MCCP PPPP
//   |||| ||||
//   |||+-++++- 16 KB PRG-ROM bank at $8000
//   |++------- 8 KB CHR-RAM page
//   +--------- one-screen mirroring select, only when the header asked for
//              mapper-controlled mirroring
//
// Self-flashing (writing the PRG flash chip through the same register) is not
// implemented: it is only used by cartridge-authoring tools, never by a game.
//
// See https://www.nesdev.org/wiki/UNROM_512
class Mapper30 extends Mapper0 {
  static mapperName = "UNROM 512";

  constructor(nes) {
    super(nes);

    this.CHR_PAGES = 4;
    this.CHR_PAGE_BYTES = 8192;
    this.TILES_PER_PAGE = 512; // an 8 KB page is both pattern tables

    // Each page keeps its own bytes and its own decoded Tile objects. Swapping a
    // page repoints ppu.ptTile at that page's tiles, so the PPU's tile cache
    // never has to be rebuilt and patternWrite() lands on the right page.
    this.chrPages = [];
    this.chrPageTiles = [];
    for (let page = 0; page < this.CHR_PAGES; page++) {
      this.chrPages.push(new Uint8Array(this.CHR_PAGE_BYTES));
      const tiles = new Array(this.TILES_PER_PAGE);
      for (let i = 0; i < this.TILES_PER_PAGE; i++) tiles[i] = new Tile();
      this.chrPageTiles.push(tiles);
    }
    this.chrPage = 0;

    // UNROM 512 redefines the header's mirroring bits, so the generic
    // getMirroringType() cannot be trusted here:
    //
    //   bit 3  bit 0
    //     0      0     vertical arrangement (horizontal mirroring)
    //     0      1     horizontal arrangement (vertical mirroring)
    //     1      0     one-screen, and the mapper's bit 7 picks which
    //     1      1     four-screen
    //
    // ROM.getMirroringType() resolves which of the two bit-3 cases applies; this
    // flag is what decides whether register bit 7 may move it afterwards.
    this.mapperControlsMirroring = nes.rom.fourScreen && nes.rom.mirroring === 0;
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }
    this.loadRomBank(value & 0x1f, 0x8000);
    this.setChrPage((value >> 5) & 0x03);

    // Bit 7 picks which single-screen nametable is shown, and only when the
    // header handed mirroring to the mapper. A four-screen or fixed-mirroring
    // ROM must not have its mirroring changed out from under it.
    if (this.mapperControlsMirroring) {
      this.nes.ppu.triggerRendering();
      this.nes.ppu.setMirroring(
        value & 0x80
          ? this.nes.rom.SINGLESCREEN_MIRRORING2
          : this.nes.rom.SINGLESCREEN_MIRRORING,
      );
    }
  }

  // Move the live pattern tables to a different CHR-RAM page: flush what the
  // program has written into the outgoing page, then bring the new one in.
  setChrPage(page) {
    if (page === this.chrPage) return;
    this.nes.ppu.triggerRendering();

    copyArrayElements(
      this.nes.ppu.vramMem,
      0,
      this.chrPages[this.chrPage],
      0,
      this.CHR_PAGE_BYTES,
    );
    copyArrayElements(
      this.chrPages[page],
      0,
      this.nes.ppu.vramMem,
      0,
      this.CHR_PAGE_BYTES,
    );
    for (let i = 0; i < this.TILES_PER_PAGE; i++) {
      this.nes.ppu.ptTile[i] = this.chrPageTiles[page][i];
    }
    this.chrPage = page;
  }

  // Pure CHR-RAM: every pattern-table address is writable.
  // eslint-disable-next-line no-unused-vars
  canWriteChr(address) {
    return true;
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("UNROM 512: Invalid ROM! Unable to load.");
    }

    this.loadRomBank(0, 0x8000);
    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);

    // ROM.getMirroringType() already resolves the one-screen encoding, and
    // nes.loadROM() applies it right after this returns.

    // No loadCHRROM(): the pattern tables start as blank RAM and the game fills
    // them. Point the cache at page 0's tiles so writes have somewhere to go.
    for (let i = 0; i < this.TILES_PER_PAGE; i++) {
      this.nes.ppu.ptTile[i] = this.chrPageTiles[0][i];
    }

    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  toJSON() {
    const state = super.toJSON();
    // Flush the live page first, or the page the game is currently drawing from
    // would be saved as whatever it held before it was banked in.
    copyArrayElements(
      this.nes.ppu.vramMem,
      0,
      this.chrPages[this.chrPage],
      0,
      this.CHR_PAGE_BYTES,
    );
    state.chrPage = this.chrPage;
    state.chrPages = this.chrPages.map((page) => Array.from(page));
    return state;
  }

  fromJSON(state) {
    super.fromJSON(state);
    this.chrPage = state.chrPage ?? 0;
    if (state.chrPages) {
      for (let page = 0; page < this.CHR_PAGES; page++) {
        this.chrPages[page] = new Uint8Array(state.chrPages[page]);
      }
    }
    // Rebuild the decoded tiles for every page: setScanline() output is derived
    // from the bytes, so it is not worth serialising.
    for (let page = 0; page < this.CHR_PAGES; page++) {
      this.rebuildPageTiles(page);
    }
    copyArrayElements(
      this.chrPages[this.chrPage],
      0,
      this.nes.ppu.vramMem,
      0,
      this.CHR_PAGE_BYTES,
    );
    for (let i = 0; i < this.TILES_PER_PAGE; i++) {
      this.nes.ppu.ptTile[i] = this.chrPageTiles[this.chrPage][i];
    }
  }

  rebuildPageTiles(page) {
    const bytes = this.chrPages[page];
    for (let tileIndex = 0; tileIndex < this.TILES_PER_PAGE; tileIndex++) {
      const base = tileIndex << 4;
      for (let i = 0; i < 8; i++) {
        this.chrPageTiles[page][tileIndex].setScanline(
          i,
          bytes[base + i],
          bytes[base + i + 8],
        );
      }
    }
  }
}

export default Mapper30;
