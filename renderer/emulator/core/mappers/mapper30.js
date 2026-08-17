import Mapper0 from "./mapper0.js";
import Tile from "../tile.js";
import { copyArrayElements } from "../utils.js";

// UNROM 512 (homebrew board, iNES mapper 30)
// 16 KB switchable PRG-ROM at $8000, last 16 KB fixed at $C000, up to 512 KB.
// There is no CHR-ROM: up to 32 KB of CHR-RAM in four switchable 8 KB pages,
// which the program fills from PRG at boot.
//
// One register, written anywhere in $8000-$FFFF on a non-flashable board:
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
// On a *flashable* board (iNES header byte 6 bit 1 set -- the same bit that
// means "battery" everywhere else, repurposed here as "self-flashing PRG
// chip"), the ranges no longer overlap: $C000-$FFFF is still the register
// above, but $8000-$BFFF reaches an SST39SF040 flash chip instead of ever
// touching it. See FlashSST39SF040 below.
//
// See https://www.nesdev.org/wiki/UNROM_512

// SST39SF040: 512 KB, 4 KB sectors, byte-program only clears bits (an erase
// is what sets them back to 1), JEDEC software command set. This models the
// chip's own command interpreter -- it owns no bytes itself, only the
// unlock-sequence/mode state, because *where* a byte physically lives (which
// PRG bank, and whether that bank happens to be the one currently mapped in)
// is Mapper30's own business, not the chip's. write() returns a plain
// descriptor of what the caller should actually do to the backing store, or
// null when the write was only another step of an unlock sequence.
//
// `cmd` is always the address masked to 15 bits (`addr & 0x7fff`): the real
// chip only decodes A0-A14 for command recognition, so the unlock addresses
// $5555/$2AAA are the same regardless of which 16 KB PRG bank is currently
// selected -- only the bank's own low bit (A14) matters, which is exactly
// why the real driver has to alternate the bank register between an odd and
// an even value to walk the sequence. The byte actually programmed or the
// sector actually erased always uses the *full*, unmasked address.
const FLASH_MANUFACTURER_ID = 0xbf; // SST
const FLASH_DEVICE_ID = 0xb7; // SST39SF040
const FLASH_SECTOR_BYTES = 4096;

class FlashSST39SF040 {
  constructor() {
    this.cycle = 0;
    this.awaitingProgramData = false;
    this.mode = "read"; // "read" | "id"

    // Busy model: opt-in (see emulateBusy), because Mesen's own flash is
    // instantaneous and nothing about the state machine above needs it --
    // this exists purely so a test can prove a driver never reads $8000-
    // $FFFF while a program/erase is in flight, the one property no amount
    // of behavioural testing against an instant model could ever catch.
    this.emulateBusy = false;
    this.busyReadCycles = 8;
    this.busyReadsLeft = 0;
    this.busyToggle = 0;
  }

  reset() {
    this.cycle = 0;
    this.awaitingProgramData = false;
  }

  startBusy() {
    if (!this.emulateBusy) return;
    this.busyReadsLeft = this.busyReadCycles;
    this.busyToggle = 0;
  }

  // Returns { type: 'byte', addr, value } | { type: 'sector', base } |
  // { type: 'chip' } | null.
  write(addr, value) {
    // The real chip ignores every write -- a fresh unlock sequence included
    // -- while an internal program or erase is in progress; only polling is
    // valid. Without this, a driver could fire off several commands back to
    // back and poll only the last one, and this model would apply every one
    // of them instead of discarding all but the first, which is exactly the
    // gap the busy model exists to catch. busyReadsLeft is only ever
    // nonzero when emulateBusy is on (startBusy() no-ops otherwise), so this
    // has no effect unless a caller opted in.
    if (this.busyReadsLeft > 0) return null;

    if (this.awaitingProgramData) {
      this.awaitingProgramData = false;
      this.reset();
      this.startBusy();
      return { type: "byte", addr, value };
    }

    const cmd = addr & 0x7fff;
    switch (this.cycle) {
      case 0:
        if (cmd === 0x5555 && value === 0xaa) {
          this.cycle = 1;
        } else if (value === 0xf0) {
          // The datasheet treats a single $F0 write to *any* address, from
          // an otherwise idle chip, as equivalent to the three-write reset
          // -- not just $F0 as the third step of a real unlock sequence
          // (the other branch below already handles that case).
          this.mode = "read";
        }
        return null;
      case 1:
        this.cycle = cmd === 0x2aaa && value === 0x55 ? 2 : 0;
        return null;
      case 2:
        if (cmd !== 0x5555) {
          this.cycle = 0;
          return null;
        }
        if (value === 0xa0) {
          this.awaitingProgramData = true;
          this.cycle = 0;
        } else if (value === 0x80) {
          this.cycle = 3; // erase setup: a second full unlock sequence follows
        } else if (value === 0x90) {
          this.mode = "id";
          this.cycle = 0;
        } else if (value === 0xf0) {
          this.mode = "read";
          this.cycle = 0;
        } else {
          this.cycle = 0;
        }
        return null;
      case 3:
        this.cycle = cmd === 0x5555 && value === 0xaa ? 4 : 0;
        return null;
      case 4:
        this.cycle = cmd === 0x2aaa && value === 0x55 ? 5 : 0;
        return null;
      case 5:
        this.cycle = 0;
        if (value === 0x30) {
          this.startBusy();
          return { type: "sector", base: addr & 0x7f000 };
        }
        if (cmd === 0x5555 && value === 0x10) {
          this.startBusy();
          return { type: "chip" };
        }
        return null;
      default:
        this.cycle = 0;
        return null;
    }
  }

  // `actual` is the byte the backing store genuinely holds at this address --
  // returned unchanged outside id/busy overlays, so a caller never needs a
  // second code path for "the chip has nothing to say about this read."
  read(addr, actual) {
    if (this.busyReadsLeft > 0) {
      this.busyReadsLeft--;
      this.busyToggle ^= 0x40; // DQ6 toggles every read until the op completes
      return this.busyToggle;
    }
    if (this.mode === "id") {
      // Mesen's own mask (addr & 0x1FF): only the manufacturer/device alias
      // addresses read as real data. Every other address in ID mode reads
      // $FF, never the underlying ROM byte -- falling through to `actual`
      // would let code that failed to leave ID mode keep executing sensible
      // bytes out of ROM instead of the garbage a real chip would hand it,
      // which is exactly the kind of driver bug this model exists to expose.
      const offset = addr & 0x1ff;
      if (offset === 0) return FLASH_MANUFACTURER_ID;
      if (offset === 1) return FLASH_DEVICE_ID;
      return 0xff;
    }
    return actual;
  }

  toJSON() {
    return {
      cycle: this.cycle,
      awaitingProgramData: this.awaitingProgramData,
      mode: this.mode,
      emulateBusy: this.emulateBusy,
      busyReadCycles: this.busyReadCycles,
      busyReadsLeft: this.busyReadsLeft,
      busyToggle: this.busyToggle
    };
  }

  fromJSON(state) {
    this.cycle = state.cycle ?? 0;
    this.awaitingProgramData = Boolean(state.awaitingProgramData);
    this.mode = state.mode ?? "read";
    this.emulateBusy = Boolean(state.emulateBusy);
    this.busyReadCycles = state.busyReadCycles ?? 8;
    this.busyReadsLeft = state.busyReadsLeft ?? 0;
    this.busyToggle = state.busyToggle ?? 0;
  }
}

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

    // iNES header byte 6 bit 1 (rom.js already parses it as `batteryRam`)
    // selects the flashable configuration on this board: $8000-$BFFF stops
    // being a mirror of the bank register and becomes the SST39SF040 flash
    // chip instead. Only cartridge-authoring tools and this board's own
    // save feature write to it; an ordinary ROM never sets the bit.
    this.flashable = Boolean(nes.rom.batteryRam);
    this.flash = this.flashable ? new FlashSST39SF040() : null;
    this.prgBank = 0; // tracked explicitly -- the flash chip address needs it
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }

    if (!this.flashable || address >= 0xc000) {
      this.prgBank = value & 0x1f;
      this.loadRomBank(this.prgBank, 0x8000);
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
      return;
    }

    // Flashable board, $8000-$BFFF: the flash chip, never the register.
    const action = this.flash.write((address & 0x3fff) | (this.prgBank << 14), value);
    if (action) this.applyFlashAction(action);
  }

  // While the flash chip is in software-ID mode or (with the busy model on)
  // mid program/erase, it drives status on *every* read of its own address
  // space -- the fixed $C000 bank included, since both halves are the same
  // physical chip. Everything else falls straight through to the inherited
  // read path, so this costs nothing when a board is not flashable or the
  // chip is simply idle.
  load(address) {
    if (this.flashable && address >= 0x8000) {
      const busyOrId = this.flash.busyReadsLeft > 0 || this.flash.mode === "id";
      if (busyOrId) {
        return this.flash.read(this.chipAddressFor(address), this.nes.cpu.mem[address]);
      }
    }
    return super.load(address);
  }

  // The flash chip address a CPU address currently corresponds to: the
  // switchable window follows prgBank the same way the register does, and
  // the fixed window is always the last bank, whether or not that bank
  // happens to also be the one selected into the switchable window.
  chipAddressFor(address) {
    if (address < 0xc000) return (address & 0x3fff) | (this.prgBank << 14);
    return (address & 0x3fff) | ((this.nes.rom.romCount - 1) << 14);
  }

  // The register still accepts bank values 0-31 regardless of how many banks
  // this image actually has, so a chip address built from it can point past
  // the end of nes.rom.rom -- reachable on anything smaller than a full 512
  // KB / 32-bank image, which today is every test fixture. Real hardware
  // (and Mesen: FlashSST39SF040.h) simply ignores an operation that does not
  // fully fit rather than doing anything to the bytes that do exist, so a
  // byte program past the end, or a sector erase any part of which falls
  // outside it, is a no-op -- never a wrap that reprograms or erases
  // whatever real bank happens to land at that address modulo the image
  // size (bank 3's reset vectors, for one). Chip erase has no such case: it
  // always covers exactly the image's own size, the same way Mesen's own
  // memset(_data, 0xFF, _size) does.
  applyFlashAction(action) {
    const total = this.nes.rom.romCount * 16384;
    if (action.type === "byte") {
      if (action.addr < total) this.programFlashByte(action.addr, action.value, false);
    } else if (action.type === "sector") {
      if (action.base + FLASH_SECTOR_BYTES <= total) {
        for (let i = 0; i < FLASH_SECTOR_BYTES; i++) {
          this.programFlashByte(action.base + i, 0xff, true);
        }
      }
    } else if (action.type === "chip") {
      for (let i = 0; i < total; i++) this.programFlashByte(i, 0xff, true);
    }
  }

  // `erase` sets the byte outright (erase always drives every bit to 1);
  // otherwise the chip can only ever clear bits (data[addr] &= value), which
  // is what makes an erase necessary before a byte can be reprogrammed.
  //
  // Every write-through the plan calls for happens here in one place: the
  // canonical bank in nes.rom.rom (so a later read of a bank-switch target
  // sees it), nes.romData at the same file offset (so nes.reloadROM() -- an
  // in-session power cycle -- reparses it back in), and nes.cpu.mem when the
  // byte's bank happens to be mapped in right now (so it is visible without
  // waiting for the next bank switch to re-copy it). Callers must already
  // have checked chipAddr against the image's real size -- see
  // applyFlashAction -- so this indexes nes.rom.rom directly, no wraparound.
  programFlashByte(chipAddr, value, erase) {
    const bank = Math.floor(chipAddr / 16384);
    const offset = chipAddr % 16384;
    const bankBytes = this.nes.rom.rom[bank];
    const result = erase ? 0xff : bankBytes[offset] & value;
    bankBytes[offset] = result;
    this.writeThroughRomData(bank, offset, result);

    if (bank === this.prgBank) this.nes.cpu.mem[0x8000 + offset] = result;
    if (bank === this.nes.rom.romCount - 1) this.nes.cpu.mem[0xc000 + offset] = result;
  }

  // nes.romData is whatever nes.loadROM() was originally called with, which
  // ROM.load() accepts as either a typed array/Buffer *or* a plain
  // ArrayBuffer (rom.js's own `data instanceof ArrayBuffer` conversion runs
  // on a local copy of the argument, never on nes.romData itself). A raw
  // ArrayBuffer has no index operator, so wrapping it in a Uint8Array view
  // -- not a copy -- is what makes it writable here; the view shares the
  // same backing memory, so a write through it still mutates nes.romData's
  // own bytes, and nes.reloadROM() sees it next time it reparses them.
  romDataBytes() {
    const data = this.nes.romData;
    if (ArrayBuffer.isView(data)) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof data === "string") {
      // ROM.load() (rom.js) also accepts a binary string, decoding each
      // character the same way this does -- `charCodeAt(i) & 0xff` is its
      // own header/PRG/CHR loop's own conversion, copied here rather than
      // shared because a string is immutable and this is the one place
      // that needs a mutable copy of it at all. Replacing nes.romData with
      // that copy, the first time a flash write actually needs one, is what
      // gives every later write-through and nes.reloadROM() (which reparses
      // this same object) somewhere to land -- converting on every call
      // instead would silently discard each write into a fresh, disconnected
      // Uint8Array nothing else ever sees again.
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;
      this.nes.romData = bytes;
      return bytes;
    }
    return null;
  }

  writeThroughRomData(bank, offset, value) {
    const bytes = this.romDataBytes();
    if (!bytes) return;
    const headerBytes = 16 + (this.nes.rom.trainer ? 512 : 0);
    const fileOffset = headerBytes + bank * 16384 + offset;
    if (fileOffset < bytes.length) bytes[fileOffset] = value;
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

    this.prgBank = 0;
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
    state.prgBank = this.prgBank;
    if (this.flashable) {
      state.flash = this.flash.toJSON();
      // A flash mutation can land in a bank that is not currently mapped in
      // anywhere, so only nes.rom.rom itself is guaranteed to hold every
      // programmed/erased byte -- serialise all of it, the same reasoning
      // chrPages above is already built on, rather than trying to track
      // which banks actually changed.
      state.prgRom = this.nes.rom.rom.map((bank) => Array.from(bank));
    }
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
    this.prgBank = state.prgBank ?? 0;
    if (this.flashable && state.flash) this.flash.fromJSON(state.flash);
    if (this.flashable && state.prgRom) {
      for (let bank = 0; bank < state.prgRom.length && bank < this.nes.rom.rom.length; bank++) {
        this.nes.rom.rom[bank] = new Uint8Array(state.prgRom[bank]);
        // Without this, the restored bank reads correctly until the next
        // nes.reloadROM() reparses the *old* nes.romData and silently
        // discards everything this restore just put back.
        for (let offset = 0; offset < 16384; offset++) {
          this.writeThroughRomData(bank, offset, this.nes.rom.rom[bank][offset]);
        }
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
    // The restored PRG banks must reach cpu.mem too, or a save state loaded
    // back in shows stale bytes in the switchable/fixed windows until the
    // next bank switch happens to re-copy them.
    if (this.flashable) {
      this.loadRomBank(this.prgBank, 0x8000);
      this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);
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
export { FlashSST39SF040 };
