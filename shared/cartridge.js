// Cartridge and mapper facts.
//
// This is the single writer for everything the engine, the generator and the UI
// must agree on about a mapper. Adding a discrete CHR-switching mapper is a data
// entry here and nothing else — see `chrRegisterShift` below.
//
// A switchable CHR bank is 8 KB, which is exactly two 256-tile pattern tables:
// one background, one sprite. The hardware switches all 8 KB at once, so those
// two halves travel together and a user-facing "tileset" is the pair.

export const CHR_BANK_BYTES = 8192;
export const PRG_UNIT_BYTES = 16384; // the unit the iNES header counts
export const NESASM_BANK_BYTES = 8192; // the unit `.bank` counts

// Every supported cartridge uses the same PRG layout, which is what lets one
// engine template serve all of them:
//
//   $C000-$FFFF  the fixed kernel  -- engine code, lookup tables, music, vectors
//   $8000-$BFFF  a switchable window -- screen data, one 16 KB bank at a time
//
// NROM is the degenerate case: it has exactly one switchable bank, so nothing
// ever needs switching. `prgSwitch` names how a mapper selects that window.
export const PRG_SWITCH = {
  none: 'none', // only one bank exists
  simple: 'simple', // write the bank number anywhere in $8000-$FFFF (UxROM)
  unrom512: 'unrom512', // like simple, but shares its register with CHR paging
  mmc1: 'mmc1', // 5 serial writes into $E000
  mmc3: 'mmc3' // select register at $8000, bank at $8001
};

/**
 * Nametable mirroring. `value` is what `.inesmir` wants; four-screen additionally
 * needs header byte 6 bit 3, which nesasm cannot express, so it is applied by
 * headerPatch().
 *
 * Four-screen is only offered by boards that carry the extra nametable RAM, and it
 * is not free — see `costsChrPage`.
 */
export const MIRRORING = [
  { id: 'horizontal', value: 0, label: 'Horizontal', hint: 'Rooms scroll side to side.' },
  { id: 'vertical', value: 1, label: 'Vertical', hint: 'Rooms scroll up and down.' },
  {
    id: 'fourscreen',
    value: 1,
    label: 'Four-screen',
    fourScreen: true,
    // On UNROM 512 the extra nametables are backed by the last CHR-RAM page, so
    // choosing this spends a tileset.
    costsChrPage: true,
    hint: 'Four independent nametables instead of two mirrored pairs. The engine only ever draws nametable 0, so this currently costs a tileset and gains nothing — pick it for cartridge-board compatibility, not for the engine.'
  }
];

export function mirroringById(id) {
  return MIRRORING.find((entry) => entry.id === id) ?? MIRRORING[1];
}

/** The mirroring modes a given board can actually provide. */
export function mirroringOptions(mapper) {
  return MIRRORING.filter((entry) => !entry.fourScreen || mapper.supportsFourScreen);
}

/**
 * How many tilesets this cartridge can hold *as configured*. Four-screen on a
 * CHR-RAM board reserves the last pattern page for nametables, so the ceiling is
 * one lower than the mapper's raw maxChrBanks. `reservedChrPages` is any CHR
 * pages the build spends on things that are not tilesets — today that is the
 * font page a scanline-IRQ board carries when the project shows text
 * (`fontChrPages` in shared/font.js is the writer of that count).
 */
export function tilesetLimit(mapper, cartridge, reservedChrPages = 0) {
  const mirroring = mirroringById(cartridge?.mirroring);
  if (mapper.chrRam && mirroring.costsChrPage) return Math.max(1, mapper.maxChrBanks - 1);
  return Math.max(1, mapper.maxChrBanks - reservedChrPages);
}

// Field notes:
//
// `prgUnits`   16 KB units in the iNES header. `dataBanks` is how many 8 KB
//              nesasm banks the template gives to generated data.
// `maxChrBanks` is the ceiling on tilesets. `chrBankValues` lists legal CHR sizes
//              for the header — a cartridge cannot ship three banks just because
//              a project authored three tilesets, so the generator rounds up.
// `chrRegisterShift` is what makes new mappers free. Every discrete mapper here
//              selects CHR by writing one byte anywhere in $8000-$FFFF; they
//              differ only in which bits hold the bank number. The generator
//              emits `bank << shift` into a lookup table and the engine writes a
//              table entry back over itself, which is both the bank select and
//              the standard bus-conflict avoidance. null means "not that kind of
//              mapper" (MMC1's serial port, MMC3's register pair) and requires
//              real engine work instead.
export const MAPPERS = [
  {
    id: 0,
    prgSwitch: PRG_SWITCH.none,
    name: 'NROM-256',
    label: 'NROM-256 — no bank switching',
    prgUnits: 2,
    dataBanks: 2,
    maxChrBanks: 1,
    chrBankValues: [1],
    chrRegisterShift: null,
    switchableChr: false,
    supported: true,
    summary: '32 KB of program and 8 KB of graphics, all mapped at once. One tileset.',
    hint: 'The simplest cartridge, and what every project starts as. Pick this unless you need more graphics.'
  },
  {
    id: 3,
    prgSwitch: PRG_SWITCH.none,
    name: 'CNROM',
    label: 'CNROM — 4 tilesets',
    prgUnits: 2,
    dataBanks: 2,
    maxChrBanks: 4,
    chrBankValues: [1, 2, 4],
    chrRegisterShift: 0,
    switchableChr: true,
    supported: true,
    summary: '32 KB of program and up to 32 KB of graphics in four switchable 8 KB banks.',
    hint: 'Same program space as NROM, but a map can select which tileset it draws with.'
  },
  {
    id: 66,
    prgSwitch: PRG_SWITCH.none,
    name: 'GxROM',
    label: 'GxROM — 4 tilesets',
    prgUnits: 2,
    dataBanks: 2,
    maxChrBanks: 4,
    chrBankValues: [1, 2, 4],
    chrRegisterShift: 0,
    switchableChr: true,
    supported: true,
    summary: '32 KB of program and up to 32 KB of graphics in four switchable 8 KB banks.',
    hint: 'A licensed Nintendo board (GNROM/MHROM) with the same graphics capacity as CNROM. Prefer it if you intend to have real cartridges made.'
  },
  {
    id: 11,
    prgSwitch: PRG_SWITCH.none,
    name: 'Color Dreams',
    label: 'Color Dreams — 16 tilesets',
    prgUnits: 2,
    dataBanks: 2,
    maxChrBanks: 16,
    chrBankValues: [1, 2, 4, 8, 16],
    chrRegisterShift: 4,
    switchableChr: true,
    supported: true,
    summary: '32 KB of program and up to 128 KB of graphics in sixteen switchable 8 KB banks.',
    hint: 'The most tilesets available without engine changes. An unlicensed board, so emulators handle it universally but real reproduction cartridges are rarer.'
  },
  {
    id: 2,
    prgSwitch: PRG_SWITCH.simple,
    name: 'UxROM',
    label: 'UxROM — 7x the screens',
    prgUnits: 8,
    dataBanks: 2,
    maxChrBanks: 1,
    chrBankValues: [1],
    chrRegisterShift: null,
    switchableChr: false,
    supported: true,
    summary: 'Up to 128 KB of program and a single fixed 8 KB of graphics. One tileset, but far more screens.',
    hint: 'Pick this when you run out of screens rather than out of tiles: seven switchable screen banks instead of one.'
  },
  {
    id: 30,
    prgSwitch: PRG_SWITCH.unrom512,
    name: 'UNROM 512',
    label: 'UNROM 512 — 4 tilesets and 31x the screens',
    prgUnits: 32,
    dataBanks: 2,
    maxChrBanks: 4,
    chrBankValues: [0],
    chrRegisterShift: null,
    switchableChr: true,
    // There is no CHR-ROM: the four 8 KB pattern pages are RAM, filled from PRG at
    // boot. Tilesets therefore cost program space instead of graphics space, which
    // is why the generator reserves an 8 KB region per tileset.
    chrRam: true,
    // The four-screen wiring backs its extra nametables with the last CHR-RAM page,
    // so selecting it costs a tileset. See tilesetLimit().
    supportsFourScreen: true,
    // iNES cannot describe CHR-RAM or its size, so the header is rewritten to
    // NES 2.0 after nesasm has run. See headerPatch().
    nes2: { chrRamSize: 32768 },
    supported: true,
    summary: '512 KB of program and 32 KB of CHR-RAM in four pages. Up to 4 tilesets and 31 screen banks.',
    hint: 'A modern homebrew board, and the largest cartridge here. Its graphics are RAM filled from program space, so tilesets cost screens.'
  },
  {
    id: 1,
    prgSwitch: PRG_SWITCH.mmc1,
    name: 'MMC1',
    label: 'MMC1 — 16 tilesets and 7x the screens',
    prgUnits: 8,
    dataBanks: 2,
    maxChrBanks: 16,
    chrBankValues: [1, 2, 4, 8, 16],
    chrRegisterShift: null,
    switchableChr: true,
    supported: true,
    summary: 'Up to 128 KB of program and 128 KB of graphics: 16 tilesets and 7 screen banks.',
    hint: 'The mapper more NES games used than any other. Switches both graphics and screens, so pick it when you need both.'
  },
  {
    id: 4,
    prgSwitch: PRG_SWITCH.mmc3,
    name: 'MMC3',
    label: 'MMC3 — 32 tilesets and 15x the screens',
    prgUnits: 16,
    dataBanks: 2,
    maxChrBanks: 32,
    chrBankValues: [1, 2, 4, 8, 16, 32],
    chrRegisterShift: null,
    switchableChr: true,
    // MMC3's scanline counter. The engine uses it to give the message font its
    // own CHR bank, switched in mid-frame where the text windows start — so on
    // this board a project that shows text keeps all 256 background tiles.
    scanlineIrq: true,
    supported: true,
    summary: 'Up to 512 KB of program and 256 KB of graphics: 32 tilesets and 15 screen banks.',
    hint: 'The largest cartridge on offer. Its scanline interrupt gives the message font its own graphics bank, so showing text costs no background tiles on this board.'
  }
];

export const DEFAULT_MAPPER = 0;

export function mapperById(id) {
  return MAPPERS.find((mapper) => mapper.id === id) ?? null;
}

/** The mapper a project should be treated as using, falling back to NROM. */
export function resolveMapper(id) {
  const mapper = mapperById(id);
  return mapper && mapper.supported ? mapper : mapperById(DEFAULT_MAPPER);
}

export const SUPPORTED_MAPPERS = MAPPERS.filter((mapper) => mapper.supported);

/** The default RPG board: MMC1, which is what Final Fantasy itself shipped on. */
export const RPG_DEFAULT_MAPPER = 1;

/**
 * Can this board switch the $8000 window? False for the 32 KB boards, whose
 * single data bank leaves nowhere to put code that is not the fixed kernel.
 */
export function hasSwitchablePrg(mapper) {
  return prgLayout(mapper).dataBankCount > 1;
}

/**
 * Can this board hold a turn-based RPG? Two independent requirements, and this
 * is the single writer for both: the battle system lives in a switchable code
 * bank (so the board must switch PRG) and the battle screen draws its monsters
 * from a dedicated battle tileset (so it must switch CHR).
 */
export function rpgCapable(mapper) {
  return hasSwitchablePrg(mapper) && Boolean(mapper.switchableChr);
}

/** Why a board cannot hold an RPG, phrased for the Build panel's option title. */
export function rpgUnsupportedReason(mapper) {
  if (!hasSwitchablePrg(mapper)) {
    return `${mapper.name} has one program bank, so there is nowhere to put the battle system outside the engine kernel.`;
  }
  if (!mapper.switchableChr) {
    return `${mapper.name} cannot switch CHR banks, so it has no second tileset to draw battle monsters from.`;
  }
  return null;
}

export const RPG_MAPPERS = SUPPORTED_MAPPERS.filter(rpgCapable);

/** The board a newly created project of this kind should start on. */
export function defaultMapperFor(gameType) {
  return gameType === 'rpg' ? RPG_DEFAULT_MAPPER : DEFAULT_MAPPER;
}

/**
 * The smallest legal CHR-ROM size, in 8 KB banks, that holds `count` tilesets.
 * Zero for a CHR-RAM board: it ships no CHR-ROM at all.
 */
export function chrBanksFor(mapper, count) {
  if (mapper.chrRam) return 0;
  const wanted = Math.max(1, count);
  return mapper.chrBankValues.find((value) => value >= wanted) ?? mapper.maxChrBanks;
}

/**
 * Byte overrides for the 16-byte iNES header, applied after assembly.
 *
 * nesasm only understands iNES 1.0, which has no way to declare CHR-RAM or its
 * size, so a CHR-RAM board needs its header upgraded to NES 2.0 afterwards. This
 * returns an empty object for every mapper nesasm can already describe, which is
 * how the pipeline keeps "no post-processing" true for all of them.
 */
export function headerPatch(mapper, cartridge) {
  const mirroring = mirroringById(cartridge?.mirroring);
  const fourScreen = Boolean(mirroring.fourScreen && mapper.supportsFourScreen);

  // Four-screen is header byte 6 bit 3, which nesasm has no directive for. On
  // UNROM 512 the mirroring bits are redefined: bit 3 alone means one-screen, and
  // four-screen needs bit 3 *and* bit 0 -- .inesmir already supplies bit 0.
  const fourScreenPatch = fourScreen ? { 6: { or: 0x08 } } : {};

  if (!mapper.nes2) return fourScreenPatch;
  const patch = {
    ...fourScreenPatch,
    // Byte 7 bits 3..2 == 0b10 is the NES 2.0 identifier. The mapper's high nibble
    // is already in bits 4..7 courtesy of .inesmap.
    7: { or: 0x08 },
    8: { set: 0x00 }, // submapper 0, mapper bits 8-11
    9: { set: 0x00 }, // PRG/CHR-ROM size high bits
    10: { set: 0x00 }, // no PRG-RAM and no PRG-NVRAM
    12: { set: 0x00 }, // NTSC timing
    13: { set: 0x00 },
    14: { set: 0x00 },
    15: { set: 0x00 }
  };
  // Byte 11 low nibble is volatile CHR-RAM: size == 64 << value.
  const shift = Math.log2(mapper.nes2.chrRamSize / 64);
  if (!Number.isInteger(shift) || shift < 1 || shift > 15) {
    throw new Error(`${mapper.name}: CHR-RAM size ${mapper.nes2.chrRamSize} is not encodable in NES 2.0`);
  }
  patch[11] = { set: shift };
  return patch;
}

/** Apply headerPatch() to an assembled ROM in place, and return it. */
export function applyHeaderPatch(bytes, mapper, cartridge) {
  for (const [offset, rule] of Object.entries(headerPatch(mapper, cartridge))) {
    const index = Number(offset);
    if (rule.set !== undefined) bytes[index] = rule.set;
    if (rule.or !== undefined) bytes[index] |= rule.or;
  }
  return bytes;
}

/**
 * The byte to write at $8000-$FFFF to select each CHR bank, for mappers that
 * select with one write. Empty for mappers that do not work that way.
 */
export function chrRegisterTable(mapper) {
  if (mapper.chrRegisterShift === null) return [];
  return Array.from({ length: mapper.maxChrBanks }, (_, bank) => (bank << mapper.chrRegisterShift) & 0xff);
}

/**
 * Where everything sits in PRG, in nesasm's 8 KB `.bank` units.
 *
 * The last 16 KB is the fixed kernel; everything below it is switchable screen
 * data, two 8 KB regions per 16 KB bank. For NROM this yields banks 0/1 for data
 * and 2/3 for the kernel — the layout the engine already had — so the same
 * template serves a banked cartridge and an unbanked one.
 */
export function prgLayout(mapper) {
  const nesasmBanks = mapper.prgUnits * 2;
  const regions = [];
  for (let prgBank = 0; prgBank < mapper.prgUnits - 1; prgBank++) {
    regions.push({ prgBank, nesasmBank: prgBank * 2, org: 0x8000 });
    regions.push({ prgBank, nesasmBank: prgBank * 2 + 1, org: 0xa000 });
  }
  return {
    nesasmBanks,
    kernelLoBank: nesasmBanks - 2, // $C000: tables and engine code
    kernelHiBank: nesasmBanks - 1, // $E000: music, then the vectors
    dataBankCount: mapper.prgUnits - 1,
    regions
  };
}

// Screens are packed into the switchable window's 8 KB regions and may not
// straddle a region boundary, so a little slack is left for alignment.
export const SCREEN_REGION_BYTES = NESASM_BANK_BYTES - 16;

/**
 * How many screens of `bytesPerScreen` this cartridge holds. Used by the Build
 * panel's meter and by the generator's capacity check, so the ceiling the UI shows
 * is the ceiling the build enforces.
 */
export function screenCapacity(mapper, bytesPerScreen, tilesetCount = 1, bankedCode = 0) {
  const perRegion = Math.floor(SCREEN_REGION_BYTES / bytesPerScreen);
  return screenRegions(mapper, tilesetCount, bankedCode).length * perRegion;
}

/**
 * The regions available for screen data — what is left of the switchable window
 * once the two things that also live there have taken theirs. A CHR-RAM board
 * keeps its tile data in program space, one 8 KB region per tileset; an RPG
 * keeps its battle system there too. Both come off the front, in that order, so
 * a region's identity does not move when the other one changes size.
 */
export function screenRegions(mapper, tilesetCount = 1, bankedCode = 0) {
  const { regions } = prgLayout(mapper);
  const taken =
    chrPayloadRegions(mapper, tilesetCount).length + codeRegions(mapper, tilesetCount, bankedCode).length;
  return regions.slice(taken);
}

/**
 * Regions holding engine code rather than data. The battle system is far too big
 * for the fixed kernel to hold alongside everything else, so it goes here and the
 * kernel keeps only a trampoline — which is why an RPG needs a mapper that can
 * switch PRG at all. See `rpgCapable`.
 */
export function codeRegions(mapper, tilesetCount = 1, bankedCode = 0) {
  if (!bankedCode) return [];
  const { regions } = prgLayout(mapper);
  const from = chrPayloadRegions(mapper, tilesetCount).length;
  return regions.slice(from, from + bankedCode);
}

/** The regions holding CHR-RAM payloads: one per tileset, or none for CHR-ROM. */
export function chrPayloadRegions(mapper, tilesetCount = 1) {
  if (!mapper.chrRam) return [];
  return prgLayout(mapper).regions.slice(0, Math.max(1, tilesetCount));
}

export function mirroringValue(id) {
  return (MIRRORING.find((entry) => entry.id === id) ?? MIRRORING[1]).value;
}
