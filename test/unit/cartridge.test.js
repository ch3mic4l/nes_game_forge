// Mapper selection and multi-tileset projects.
//
// The interesting cases are the ones where the project data and the cartridge
// disagree: a project authored on a bigger mapper and moved down to a smaller
// one, or an old project that predates tilesets being a list at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { buildProject } from '../../main/build/pipeline.js';
import { loadProject, saveProject, PROJECT_MARKER } from '../../main/project-io.js';
import {
  createProject,
  createTileset,
  normalizeProject,
  reconcileCartridge,
  tilesetAt
} from '../../shared/project.js';
import {
  chrBanksFor,
  chrRegisterTable,
  mapperById,
  resolveMapper,
  MAPPERS,
  SUPPORTED_MAPPERS,
  chrPayloadRegions,
  headerPatch,
  mirroringOptions,
  screenCapacity,
  tilesetLimit
} from '../../shared/cartridge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');

const scratch = () => fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-cart-'));

// --- the registry ----------------------------------------------------------

test('every mapper entry declares the fields the generator reads', () => {
  for (const mapper of MAPPERS) {
    assert.equal(typeof mapper.id, 'number', `${mapper.name} id`);
    assert.ok(mapper.prgUnits >= 1, `${mapper.name} prgUnits`);
    assert.ok(mapper.chrBankValues.length, `${mapper.name} chrBankValues`);
    if (mapper.chrRam) {
      // A CHR-RAM board ships no CHR-ROM, so its header CHR size is always zero
      // while it still addresses maxChrBanks pages of RAM.
      assert.deepEqual(mapper.chrBankValues, [0], `${mapper.name} is CHR-RAM`);
      assert.equal(chrBanksFor(mapper, 4), 0, `${mapper.name} declares no CHR-ROM`);
      assert.ok(mapper.nes2?.chrRamSize >= mapper.maxChrBanks * 8192, `${mapper.name} nes2.chrRamSize`);
    } else {
      assert.equal(
        mapper.chrBankValues.at(-1),
        mapper.maxChrBanks,
        `${mapper.name}: the largest legal CHR size must equal maxChrBanks`
      );
    }
    // An unsupported mapper has to say why, because the UI shows that text.
    if (!mapper.supported) assert.ok(mapper.unsupportedReason, `${mapper.name} unsupportedReason`);
  }
});

test('an unsupported or unknown mapper resolves to NROM', () => {
  // Every mapper in the registry is supported, so the fallback only fires for a
  // number the registry does not list at all — a hand-edited or future project.
  assert.equal(resolveMapper(7).id, 0, 'a mapper the registry does not list');
  assert.equal(resolveMapper(999).id, 0, 'an unknown mapper number');
  for (const id of [0, 1, 2, 3, 4, 11, 30, 66]) {
    assert.equal(resolveMapper(id).id, id, `mapper ${id} is supported`);
  }
});

test('the CHR register table puts the bank number in the right bits', () => {
  // CNROM and GxROM carry the bank in bits 0-1; Color Dreams in bits 4-7.
  assert.deepEqual(chrRegisterTable(mapperById(3)), [0, 1, 2, 3]);
  assert.deepEqual(chrRegisterTable(mapperById(66)), [0, 1, 2, 3]);
  assert.deepEqual(
    chrRegisterTable(mapperById(11)),
    [0x00, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90, 0xa0, 0xb0, 0xc0, 0xd0, 0xe0, 0xf0]
  );
  // Every value must be a byte, or dbBlock would emit something nesasm rejects.
  for (const mapper of MAPPERS) {
    for (const value of chrRegisterTable(mapper)) {
      assert.ok(value >= 0 && value <= 0xff, `${mapper.name} value ${value} is not a byte`);
    }
  }
  assert.deepEqual(chrRegisterTable(mapperById(0)), [], 'NROM has no CHR register');
  assert.deepEqual(chrRegisterTable(mapperById(4)), [], 'MMC3 does not select with one write');
});

test('a mapper with a CHR register can address every bank it claims', () => {
  for (const mapper of MAPPERS.filter((m) => m.chrRegisterShift !== null)) {
    const table = chrRegisterTable(mapper);
    assert.equal(table.length, mapper.maxChrBanks, `${mapper.name} table length`);
    assert.equal(new Set(table).size, table.length, `${mapper.name} bank values must be distinct`);
  }
});

test('CHR size rounds up to a legal value for the mapper', () => {
  const cnrom = mapperById(3);
  assert.equal(chrBanksFor(cnrom, 1), 1);
  assert.equal(chrBanksFor(cnrom, 2), 2);
  assert.equal(chrBanksFor(cnrom, 3), 4, 'three tilesets need a four-bank cartridge');
  assert.equal(chrBanksFor(cnrom, 4), 4);
  assert.equal(chrBanksFor(mapperById(0), 1), 1);
});

// --- schema ---------------------------------------------------------------

test('a new project has one tileset on NROM', () => {
  const project = createProject('Demo');
  assert.equal(project.cartridge.mapper, 0);
  assert.equal(project.tilesets.length, 1);
  assert.equal(project.maps[0].tilesetId, 0);
});

test('the pre-mapper tilesets object migrates to a one-entry list', () => {
  const project = normalizeProject({
    tilesets: { background: { tiles: ['3'.repeat(64)] }, sprites: { tiles: ['1'.repeat(64)] } }
  });
  assert.equal(project.tilesets.length, 1);
  assert.equal(project.tilesets[0].name, 'Main');
  assert.equal(project.tilesets[0].background.tiles[0], '3'.repeat(64));
  assert.equal(project.tilesets[0].sprites.tiles[0], '1'.repeat(64));
});

test('tilesets beyond the mapper limit are dropped, and maps stop pointing at them', () => {
  // Authored as CNROM with four tilesets, then moved back to NROM.
  const project = normalizeProject({
    cartridge: { mapper: 0 },
    tilesets: [createTileset(0, 'A'), createTileset(1, 'B'), createTileset(2, 'C')],
    maps: [{ gridW: 1, gridH: 1, screens: [{ metatiles: [] }], tilesetId: 2 }]
  });
  assert.equal(project.tilesets.length, 1, 'NROM addresses one CHR bank');
  assert.equal(project.maps[0].tilesetId, 0, 'the map must not reference a dropped tileset');
});

test('CNROM keeps up to four tilesets and honours a map reference', () => {
  const project = normalizeProject({
    cartridge: { mapper: 3 },
    tilesets: [createTileset(0, 'A'), createTileset(1, 'B'), createTileset(2, 'C')],
    maps: [{ gridW: 1, gridH: 1, screens: [{ metatiles: [] }], tilesetId: 2 }]
  });
  assert.equal(project.tilesets.length, 3);
  assert.equal(project.maps[0].tilesetId, 2);
  assert.equal(tilesetAt(project, 2).name, 'C');
  assert.equal(tilesetAt(project, 9).name, 'A', 'an out-of-range id falls back to the first');
});

test('normalizeProject is idempotent with several tilesets', () => {
  const project = normalizeProject({
    cartridge: { mapper: 3 },
    tilesets: [createTileset(0, 'A'), createTileset(1, 'B')]
  });
  assert.deepEqual(normalizeProject(structuredClone(project)), project);
});

// --- on disk --------------------------------------------------------------

test('a multi-tileset CNROM project round-trips through disk', async () => {
  const dir = path.join(await scratch(), 'Round.forge');
  const project = createProject('Round Trip');
  project.cartridge.mapper = 3;
  project.tilesets.push(createTileset(1, 'Dungeon'), createTileset(2, 'Interior'));
  project.tilesets[1].background.tiles[5] = '2'.repeat(64);
  project.maps[0].tilesetId = 1;

  await saveProject(dir, project);
  const reloaded = await loadProject(dir);

  assert.equal(reloaded.cartridge.mapper, 3);
  assert.deepEqual(
    reloaded.tilesets.map((t) => t.name),
    ['Main', 'Dungeon', 'Interior']
  );
  assert.equal(reloaded.tilesets[1].background.tiles[5], '2'.repeat(64));
  assert.equal(reloaded.maps[0].tilesetId, 1);
  assert.deepEqual(reloaded, normalizeProject(reloaded), 'a saved project reloads already-normalised');
});

test('a project folder in the pre-mapper layout still opens', async () => {
  const dir = path.join(await scratch(), 'Legacy.forge');
  await fs.promises.mkdir(path.join(dir, 'tiles'), { recursive: true });
  await fs.promises.mkdir(path.join(dir, 'maps'), { recursive: true });
  await fs.promises.mkdir(path.join(dir, 'songs'), { recursive: true });
  // The flat layout: one background.json and one sprites.json, no tilesets.json.
  await fs.promises.writeFile(
    path.join(dir, PROJECT_MARKER),
    JSON.stringify({ format: 1, project: { name: 'Legacy' } })
  );
  await fs.promises.writeFile(path.join(dir, 'tiles', 'background.json'), JSON.stringify(['7'.repeat(64)]));
  await fs.promises.writeFile(path.join(dir, 'tiles', 'sprites.json'), JSON.stringify(['5'.repeat(64)]));

  const project = await loadProject(dir);
  assert.equal(project.tilesets.length, 1);
  assert.equal(project.tilesets[0].background.tiles[0], '7'.repeat(64));
  assert.equal(project.tilesets[0].sprites.tiles[0], '5'.repeat(64));
  assert.equal(project.cartridge.mapper, 0, 'a project with no cartridge block is NROM');
});

// --- built ROMs -----------------------------------------------------------

const buildFrom = async (mutate) => {
  const dir = path.join(await scratch(), 'Sample.forge');
  await fs.promises.cp(SAMPLE, dir, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}build`)
  });
  const project = await loadProject(dir);
  // These are cartridge tests: they read the PPU straight after boot, and a
  // title screen would put the *title* map's tileset in front of the one whose
  // banking is under test. Dropping it keeps each scenario about one thing.
  project.project.titleMap = null;
  mutate(project);
  await saveProject(dir, project);
  const reloaded = await loadProject(dir);
  await buildProject({ dir, project: reloaded });
  return fs.promises.readFile(path.join(dir, 'build', 'game.nes'));
};

test('the sample builds as NROM with one CHR bank', async () => {
  const rom = await buildFrom(() => {});
  assert.equal((rom[6] >> 4) | (rom[7] & 0xf0), 0, 'mapper');
  assert.equal(rom[4], 2, '32 KB PRG');
  assert.equal(rom[5], 1, '8 KB CHR');
  assert.equal(rom.length, 16 + 2 * 16384 + 8192);
});

test('choosing CNROM grows the header and the CHR, and each tileset lands in its own bank', async () => {
  const marker = '3'.repeat(64);
  const rom = await buildFrom((project) => {
    project.cartridge.mapper = 3;
    project.tilesets.push(createTileset(1, 'Dungeon'), createTileset(2, 'Interior'));
    project.tilesets[1].background.tiles[0] = marker;
    project.maps[0].tilesetId = 1;
  });

  assert.equal((rom[6] >> 4) | (rom[7] & 0xf0), 3, 'mapper');
  assert.equal(rom[4], 2, 'PRG is unchanged: CNROM switches graphics only');
  assert.equal(rom[5], 4, 'three tilesets round up to a legal four-bank CHR');
  assert.equal(rom.length, 16 + 2 * 16384 + 4 * 8192);

  // Tileset 1's marker tile is colour 3 in every pixel, so both bitplanes of the
  // first tile of CHR bank 1 are solid $FF.
  const bank1 = 16 + rom[4] * 16384 + 8192;
  for (let i = 0; i < 16; i++) {
    assert.equal(rom[bank1 + i], 0xff, `tileset 1 byte ${i} should be in CHR bank 1`);
  }
});

// Each switchable mapper gets the same end-to-end proof: put a recognisable tile
// in a non-zero tileset, point the starting map at it, and read the PPU's pattern
// table after boot. Only a working switch_chr_bank can make that tile visible.
for (const { id, name, bank } of [
  { id: 3, name: 'CNROM', bank: 1 },
  { id: 66, name: 'GxROM', bank: 2 },
  { id: 11, name: 'Color Dreams', bank: 5 }
]) {
  test(`a ${name} ROM boots and banks in the tileset its map selected`, async () => {
    const rom = await buildFrom((project) => {
      project.cartridge.mapper = id;
      for (let i = 1; i <= bank; i++) project.tilesets.push(createTileset(i, `Set ${i}`));
      project.tilesets[bank].background.tiles[1] = '3'.repeat(64);
      project.maps[0].tilesetId = bank;
    });

    assert.equal((rom[6] >> 4) | (rom[7] & 0xf0), id, 'mapper in the header');

    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(new Uint8Array(rom));
    for (let i = 0; i < 30; i++) nes.frame();

    assert.ok(nes.cpu.REG_PC >= 0x8000, `PC $${nes.cpu.REG_PC.toString(16)} should be in ROM`);
    // Tile 1 of the active pattern table must be the solid tile from that bank.
    const tile1 = Array.from({ length: 16 }, (_, i) => nes.ppu.vramMem[16 + i]);
    assert.deepEqual(tile1, new Array(16).fill(0xff), `CHR bank ${bank} should be banked in after boot`);
  });
}

test('Color Dreams reaches all sixteen banks', async () => {
  const rom = await buildFrom((project) => {
    project.cartridge.mapper = 11;
    for (let i = 1; i < 16; i++) project.tilesets.push(createTileset(i, `Set ${i}`));
    project.tilesets[15].background.tiles[1] = '3'.repeat(64);
    project.maps[0].tilesetId = 15;
  });
  assert.equal(rom[5], 16, '128 KB of CHR');

  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(rom));
  for (let i = 0; i < 30; i++) nes.frame();
  const tile1 = Array.from({ length: 16 }, (_, i) => nes.ppu.vramMem[16 + i]);
  assert.deepEqual(tile1, new Array(16).fill(0xff), 'the sixteenth bank should be reachable');
});

// --- PRG bank switching ---------------------------------------------------

test('UxROM builds with seven switchable screen banks', async () => {
  const rom = await buildFrom((project) => {
    project.cartridge.mapper = 2;
  });
  assert.equal((rom[6] >> 4) | (rom[7] & 0xf0), 2, 'mapper');
  assert.equal(rom[4], 8, '128 KB PRG');
  assert.equal(rom[5], 1, '8 KB CHR');
  assert.equal(rom.length, 16 + 8 * 16384 + 8192);
});

test('UxROM holds far more screens than NROM, and they land in different banks', async () => {
  const nrom = await import('../../main/build/generate.js');
  const base = createProject('Big');
  const wide = (project, maps) => {
    project.maps = [];
    for (let m = 0; m < maps; m++) {
      project.maps.push({
        id: m,
        name: `Map ${m}`,
        gridW: 4,
        gridH: 4,
        screens: Array.from({ length: 16 }, () => ({ metatiles: new Array(240).fill(0), entities: [] })),
        songId: null,
        tilesetId: 0
      });
    }
  };

  // 4 maps x 16 screens = 64 screens: past NROM's ~52, inside UxROM's reach.
  const onNrom = normalizeProject({ ...structuredClone(base), cartridge: { mapper: 0 } });
  wide(onNrom, 4);
  const nromCheck = nrom.checkCapacity(normalizeProject(onNrom));
  assert.ok(
    nromCheck.problems.some((p) => p.severity === 'error' && /holds/.test(p.message)),
    'NROM should refuse 64 screens with a plain-language error'
  );

  const onUxrom = normalizeProject({ ...structuredClone(base), cartridge: { mapper: 2 } });
  wide(onUxrom, 4);
  const uxromCheck = nrom.checkCapacity(normalizeProject(onUxrom));
  assert.deepEqual(
    uxromCheck.problems.filter((p) => p.severity === 'error'),
    [],
    'UxROM should accept 64 screens'
  );
  assert.ok(uxromCheck.capacity > 300, `UxROM capacity ${uxromCheck.capacity} should be in the hundreds`);
  assert.equal(uxromCheck.dataBankCount, 7);
});

test('a UxROM ROM boots into a screen that lives in a switched-in bank', async () => {
  // 64 screens across four maps. About 26 screens fit per 8 KB region and two
  // regions share a 16 KB bank, so bank 0 holds roughly the first 53. The start
  // screen is the very last one, which therefore lives in bank 1 — boot only
  // draws it correctly if switch_prg_bank works. The assertion on screen_bank
  // below keeps this test from quietly becoming vacuous if packing changes.
  const dir = path.join(await scratch(), 'Uxrom.forge');
  const project = createProject('Banked');
  project.cartridge.mapper = 2;
  project.maps = [];
  for (let m = 0; m < 4; m++) {
    project.maps.push({
      id: m,
      name: `Map ${m}`,
      gridW: 4,
      gridH: 4,
      screens: Array.from({ length: 16 }, () => ({ metatiles: new Array(240).fill(0), entities: [] })),
      songId: null,
      tilesetId: 0
    });
  }
  // Paint the start screen entirely with metatile 1, whose four tiles are tile 1.
  project.metatiles[1].tiles = [1, 1, 1, 1];
  project.metatiles[1].palette = 0;
  project.maps[3].screens[15].metatiles = new Array(240).fill(1);
  project.project.startMap = 3;
  project.project.startScreen = 15;
  project.tilesets[0].background.tiles[1] = '1'.repeat(64);

  await saveProject(dir, project);
  const reloaded = await loadProject(dir);
  await buildProject({ dir, project: reloaded });
  const rom = await fs.promises.readFile(path.join(dir, 'build', 'game.nes'));
  assert.equal((rom[6] >> 4) | (rom[7] & 0xf0), 2, 'mapper 2');

  // The start screen must really be outside bank 0, or this proves nothing.
  const mapsInc = await fs.promises.readFile(path.join(dir, 'build', 'assets', 'maps.inc'), 'utf8');
  const bankTable = mapsInc
    .split('screen_bank:')[1]
    .split(/^[a-z_]+:/m)[0]
    .match(/\$[0-9A-F]{2}/g)
    .map((byte) => parseInt(byte.slice(1), 16));
  assert.equal(bankTable.length, 64, 'one bank byte per screen');
  assert.ok(bankTable[63] > 0, `the start screen should be in a switched bank, got bank ${bankTable[63]}`);

  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(rom));
  for (let i = 0; i < 40; i++) nes.frame();

  assert.ok(nes.cpu.REG_PC >= 0x8000, `PC $${nes.cpu.REG_PC.toString(16)} should be in ROM`);
  // Screen 48 is the start; it must have been reachable, so nametable 0 is filled
  // with tile 1 rather than the zeroes a failed bank switch would leave.
  const nametable = Array.from({ length: 960 }, (_, i) => nes.ppu.vramMem[0x2000 + i]);
  const ones = nametable.filter((byte) => byte === 1).length;
  assert.ok(ones > 900, `expected a screen of tile 1, saw ${ones}/960 — the bank switch likely failed`);
});

// --- every supported mapper, end to end -----------------------------------
//
// One parameterised case per supported cartridge, so a newly-supported mapper
// cannot be advertised in the UI without a ROM that builds, boots, and banks.

for (const mapper of SUPPORTED_MAPPERS) {
  test(`${mapper.name} builds a ROM that boots and banks its tilesets`, async () => {
    const wanted = Math.min(2, mapper.maxChrBanks);
    const rom = await buildFrom((project) => {
      project.cartridge.mapper = mapper.id;
      for (let i = 1; i < wanted; i++) project.tilesets.push(createTileset(i, `Set ${i}`));
      if (wanted > 1) {
        project.tilesets[1].background.tiles[1] = '3'.repeat(64);
        project.maps[0].tilesetId = 1;
      }
    });

    assert.equal((rom[6] >> 4) | (rom[7] & 0xf0), mapper.id, 'mapper in the header');
    assert.equal(rom[4], mapper.prgUnits, 'PRG size');
    assert.equal(rom.length, 16 + rom[4] * 16384 + rom[5] * 8192, 'size matches the header');

    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(new Uint8Array(rom));
    for (let i = 0; i < 60; i++) nes.frame();

    assert.ok(nes.cpu.REG_PC >= 0x8000, `PC $${nes.cpu.REG_PC.toString(16)} should be in ROM`);
    // The screen was drawn: a crash or a failed bank select leaves it uniform.
    const nametable = Array.from({ length: 960 }, (_, i) => nes.ppu.vramMem[0x2000 + i]);
    assert.ok(new Set(nametable).size > 1, 'the nametable should hold a drawn screen');

    if (wanted > 1) {
      // The map points at tileset 1, whose tile 1 is solid colour 3.
      const tile1 = Array.from({ length: 16 }, (_, i) => nes.ppu.vramMem[16 + i]);
      assert.deepEqual(tile1, new Array(16).fill(0xff), `${mapper.name} did not bank in tileset 1`);
    }
  });
}

// --- UNROM 512: CHR-RAM authoring -----------------------------------------
//
// The only board here with no CHR-ROM. Its tile data lives in program space and
// the engine streams it into the four 8 KB CHR-RAM pages at boot, so the things
// worth pinning are the NES 2.0 header nesasm cannot write, and that every page
// really is filled from PRG.

test('headerPatch upgrades a CHR-RAM board to NES 2.0 and leaves the rest alone', () => {
  const patch = headerPatch(mapperById(30));
  assert.equal(patch[7].or, 0x08, 'the NES 2.0 identifier');
  assert.equal(patch[11].set, 9, '64 << 9 == 32 KB of CHR-RAM');
  for (const id of [0, 1, 2, 3, 4, 11, 66]) {
    assert.deepEqual(headerPatch(mapperById(id)), {}, `mapper ${id} needs no header rewrite`);
  }
});

test('UNROM 512 reserves one program region per tileset', () => {
  const mapper = mapperById(30);
  assert.equal(chrPayloadRegions(mapper, 1).length, 1);
  assert.equal(chrPayloadRegions(mapper, 4).length, 4);
  assert.deepEqual(chrPayloadRegions(mapperById(0), 4), [], 'a CHR-ROM board reserves nothing');

  // Those regions come off the screen budget, so more tilesets means fewer screens.
  const withOne = screenCapacity(mapper, 305, 1);
  const withFour = screenCapacity(mapper, 305, 4);
  assert.ok(withFour < withOne, `four tilesets (${withFour}) should cost screens versus one (${withOne})`);
});

test('a UNROM 512 ROM streams all four tilesets into CHR-RAM and renders the selected one', async () => {
  // Each tileset gets a different solid colour at tile 1, so which page is live
  // and whether the others were filled are both observable.
  const rom = await buildFrom((project) => {
    project.cartridge.mapper = 30;
    project.tilesets.push(createTileset(1, 'B'), createTileset(2, 'C'), createTileset(3, 'D'));
    for (let i = 1; i < 4; i++) project.tilesets[i].background.tiles[1] = String(i).repeat(64);
    project.maps[0].tilesetId = 2;
  });

  assert.equal((rom[6] >> 4) | (rom[7] & 0xf0), 30, 'mapper');
  assert.equal(rom[5], 0, 'a CHR-RAM board declares no CHR-ROM');
  assert.equal((rom[7] & 0x0c) === 0x08, true, 'NES 2.0 header');
  assert.equal(rom[11] & 0x0f, 9, '32 KB of CHR-RAM declared');
  assert.equal(rom.length, 16 + rom[4] * 16384, 'size is header plus PRG only');

  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(rom));
  assert.equal(nes.rom.chrRamSize, 32768, 'the core reads the CHR-RAM size back');
  for (let i = 0; i < 60; i++) nes.frame();

  assert.ok(nes.cpu.REG_PC >= 0x8000, `PC $${nes.cpu.REG_PC.toString(16)} should be in ROM`);
  assert.equal(nes.mmap.chrPage, 2, 'the map asked for tileset 2');

  // Every page must hold data: an upload loop that stopped early would leave the
  // later pages blank even though the live one looked right.
  const pages = nes.mmap.chrPages.map((page, i) =>
    i === nes.mmap.chrPage ? nes.ppu.vramMem.slice(0, 0x2000) : page
  );
  pages.forEach((page, i) => {
    assert.ok(page.some((byte) => byte !== 0), `CHR-RAM page ${i} was never filled from PRG`);
  });

  // Tile 1 of each authored page: colour n sets plane 0 for odd n, plane 1 for n>=2.
  for (const [index, colour] of [[1, 1], [2, 2], [3, 3]]) {
    const plane0 = Array.from({ length: 8 }, (_, i) => pages[index][16 + i]);
    const plane1 = Array.from({ length: 8 }, (_, i) => pages[index][24 + i]);
    assert.deepEqual(plane0, new Array(8).fill(colour & 1 ? 0xff : 0x00), `page ${index} plane 0`);
    assert.deepEqual(plane1, new Array(8).fill(colour & 2 ? 0xff : 0x00), `page ${index} plane 1`);
  }

  const nametable = Array.from({ length: 960 }, (_, i) => nes.ppu.vramMem[0x2000 + i]);
  assert.ok(new Set(nametable).size > 1, 'the screen should have been drawn');
});

// --- UNROM 512 four-screen variant ----------------------------------------
//
// The board wires its extra nametables to the last CHR-RAM page, so four-screen
// costs a tileset. Header byte 6 needs bit 3 *and* bit 0, which nesasm cannot
// express, so headerPatch supplies bit 3.

test('four-screen is only offered by boards that carry the nametable RAM', () => {
  assert.deepEqual(
    mirroringOptions(mapperById(30)).map((m) => m.id),
    ['horizontal', 'vertical', 'fourscreen']
  );
  for (const id of [0, 1, 2, 3, 4, 11, 66]) {
    assert.deepEqual(
      mirroringOptions(mapperById(id)).map((m) => m.id),
      ['horizontal', 'vertical'],
      `mapper ${id} cannot do four-screen`
    );
  }
});

test('four-screen costs a tileset on a CHR-RAM board and is rejected elsewhere', () => {
  assert.equal(tilesetLimit(mapperById(30), { mirroring: 'vertical' }), 4);
  assert.equal(tilesetLimit(mapperById(30), { mirroring: 'fourscreen' }), 3);
  // Asking for it on a board without the RAM falls back rather than emitting a
  // header that describes hardware the cartridge does not have.
  const nrom = normalizeProject({ cartridge: { mapper: 0, mirroring: 'fourscreen' } });
  assert.equal(nrom.cartridge.mirroring, 'vertical');

  // And a fourth tileset authored before the switch is dropped, not orphaned.
  const project = normalizeProject({
    cartridge: { mapper: 30, mirroring: 'fourscreen' },
    tilesets: [0, 1, 2, 3].map((i) => createTileset(i, `T${i}`)),
    maps: [{ gridW: 1, gridH: 1, screens: [{ metatiles: [] }], tilesetId: 3 }]
  });
  assert.equal(project.tilesets.length, 3);
  assert.equal(project.maps[0].tilesetId, 0, 'the map must not point at a dropped tileset');
});

test('a four-screen UNROM 512 ROM sets both mirroring bits and boots with four nametables', async () => {
  const rom = await buildFrom((project) => {
    project.cartridge.mapper = 30;
    project.cartridge.mirroring = 'fourscreen';
    project.tilesets.push(createTileset(1, 'B'), createTileset(2, 'C'));
    // Every tileset needs some art, or a blank payload would be indistinguishable
    // from a page the upload loop never reached.
    for (let i = 1; i < 3; i++) project.tilesets[i].background.tiles[1] = String(i).repeat(64);
    project.maps[0].tilesetId = 2;
  });

  assert.equal((rom[6] >> 4) | (rom[7] & 0xf0), 30, 'mapper');
  // On UNROM 512 four-screen is bit 3 AND bit 0; bit 3 alone would mean one-screen.
  assert.equal(rom[6] & 0x08, 0x08, 'header bit 3 (four-screen)');
  assert.equal(rom[6] & 0x01, 0x01, 'header bit 0, which distinguishes it from one-screen');
  assert.equal((rom[7] & 0x0c) === 0x08, true, 'still NES 2.0');
  assert.equal(rom[11] & 0x0f, 9, 'still 32 KB of CHR-RAM');

  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(rom));
  assert.equal(nes.rom.getMirroringType(), nes.rom.FOURSCREEN_MIRRORING, 'the core reads four-screen');
  assert.equal(nes.mmap.mapperControlsMirroring, false, 'four-screen is not mapper-controlled');

  for (let i = 0; i < 60; i++) nes.frame();
  assert.ok(nes.cpu.REG_PC >= 0x8000, `PC $${nes.cpu.REG_PC.toString(16)} should be in ROM`);
  assert.equal(nes.mmap.chrPage, 2, 'the map asked for tileset 2');

  // Four distinct nametables, so nothing in $2000-$2FFF is mirrored onto another.
  assert.deepEqual([...nes.ppu.ntable1], [0, 1, 2, 3], 'all four nametables should be distinct');

  // Only three pages are pattern data now; the fourth is nametable backing and the
  // engine must never have streamed a tileset into it.
  const pages = nes.mmap.chrPages.map((page, i) =>
    i === nes.mmap.chrPage ? nes.ppu.vramMem.slice(0, 0x2000) : page
  );
  for (let i = 0; i < 3; i++) {
    assert.ok(pages[i].some((byte) => byte !== 0), `CHR-RAM page ${i} should hold a tileset`);
  }
  assert.ok(
    pages[3].every((byte) => byte === 0),
    'page 3 backs the nametables, so no tileset may be written into it'
  );

  const nametable = Array.from({ length: 960 }, (_, i) => nes.ppu.vramMem[0x2000 + i]);
  assert.ok(new Set(nametable).size > 1, 'the screen should have been drawn');
});

test('reconcileCartridge keeps an in-memory project valid after a mapper change', () => {
  // store.commit() mutates directly and never runs normalizeProject, so switching
  // mapper in the UI has to reconcile in the same commit or the project holds a
  // combination the UI has already stopped offering.
  const project = normalizeProject({
    cartridge: { mapper: 30, mirroring: 'fourscreen' },
    tilesets: [0, 1, 2].map((i) => createTileset(i, `T${i}`)),
    maps: [{ gridW: 1, gridH: 1, screens: [{ metatiles: [] }], tilesetId: 2 }]
  });
  assert.equal(project.cartridge.mirroring, 'fourscreen');

  project.cartridge.mapper = 3; // CNROM: four CHR banks, but no nametable RAM
  reconcileCartridge(project);
  assert.equal(project.cartridge.mirroring, 'vertical', 'four-screen must not survive');
  assert.equal(project.tilesets.length, 3, 'CNROM still holds three tilesets');
  assert.equal(project.maps[0].tilesetId, 2);

  project.cartridge.mapper = 0; // NROM: one tileset
  reconcileCartridge(project);
  assert.equal(project.tilesets.length, 1);
  assert.equal(project.maps[0].tilesetId, 0, 'the map must follow the tileset it lost');
  assert.deepEqual(
    project.tilesets.map((t) => t.id),
    [0],
    'ids stay dense after trimming'
  );

  // The result must match what a save/load round trip would produce.
  assert.deepEqual(normalizeProject(structuredClone(project)), project);
});
