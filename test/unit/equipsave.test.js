// Equipment (ROADMAP item 5), build commit C3: the save record and Continue (docs/design-equipment.md sections 5 and 10).
//
// What this file proves, and the wrong implementation each test catches:
//   * the record is 120 bytes without equipment and 132 with it (pc_equip last), identities differ, and none of the six
//     fixtures' identity moved                          -> a field added for everyone / an identity that ignores equipment
//   * stale saves (checksum-valid): a worn byte naming an ordinary item is emptied by Continue; $FF is accepted; NUM_ITEMS and
//     254 are refused and Continue is not offered; NUM_ITEMS-1 is accepted  -> a restore that trusts the byte, a bound that is
//     off by one, a column cut at the highest piece id (the harness plants a nonzero byte just past each column)
//   * non-default equipment on several members and slots survives save -> power cycle -> Continue, with exact ids and exact
//     bonuses, on MMC1, MMC3 and the UNROM 512 flash path; the bonus cache is recomputed, never restored
//     -> omitted serialization, omitted recalc, a cache that is serialized, a flash record that grows into the scratch block
//   * late Join after Continue, startEquip at New Game, the event-replay counter
// The three targeted controls re-judge a deliberately wrong state with the SAME judge the persistence tests use, so the judge is
// shown able to fail; the real wrong implementations are exercised as sabotage runs (handoff-next/equip/c3/report.md).
//
// Every project is a loadProject() read of sample-rpg, edited in memory and built in its own mkdtemp directory.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { spawnSync } from 'node:child_process';
import NES from '../../renderer/emulator/core/nes.js';
import { scanEquates, resolveEquates } from '../lib/equates.js';
import { saveBodySize, saveFields, saveIdentity } from '../../shared/save.js';
import { loadProject } from '../../main/project-io.js';
import {
  ACCESSORY,
  ARMOR,
  NO_ITEM,
  RAM,
  ROOT,
  SELECT,
  START,
  ST_GAMEPLAY,
  ST_TITLE,
  WEAPON,
  A,
  B,
  bag,
  boot,
  buildEquip,
  computeChecksum,
  eqIndex,
  equipProject,
  pcBonus,
  pcEquip,
  piece,
  plain,
  poisonPastColumns,
  powerCycleBattery,
  powerCycleFlash,
  tap,
  touchSaver,
  walkTo
} from '../lib/equipharness.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const opts = { skip: !hasNesasm && 'nesasm not found on PATH' };

// The record's layout, written out by hand (a test that read these from the build under test would prove nothing).
// shared/save.js SAVE_FIELDS is 120 bytes; equipment appends pc_equip (12). Then checksum (2), identity (4), marker (1).
const BODY_BASE = 120;
const BODY_EQUIP = 132;
const PC_EQUIP_OFFSET = 120; // pc_equip is the LAST body field
const CHECKSUM_OFFSET = BODY_EQUIP; // 132, 133
const IDENTITY_OFFSET = BODY_EQUIP + 2; // 134..137
const MARKER_OFFSET = BODY_EQUIP + 6; // 138
const MARKER_VALID = 0xa5;
const SRAM_BASE = 0x6000; // engine/constants.asm SAVE_BASE for a battery board
const FLASH_BANK = 30; // shared/cartridge.js flashSaveSectorBank(UNROM 512)
const FLASH_OFFSET = 0x3000; // within that 16 KB bank

const BOARDS = [
  { name: 'MMC1', mapper: 1, flash: false },
  { name: 'MMC3', mapper: 4, flash: false },
  { name: 'UNROM 512', mapper: 30, flash: true }
];

// --- the record layout and identity -----------------------------------------------------------------------------------------

test('the record is 120 bytes without equipment and 132 with it, pc_equip last and 12 bytes', () => {
  assert.equal(saveBodySize(), BODY_BASE, 'no argument: the equipment-free layout');
  const bare = { items: [], gameType: 'rpg' };
  assert.equal(saveBodySize(bare), BODY_BASE, 'a project with no pieces keeps the 120-byte record');
});

test('saveFields / saveIdentity: an equipment project grows by pc_equip and changes identity; an equipment-free one is untouched', opts, async () => {
  const bare = await equipProject({ mapper: 1, save: true });
  const worn = await equipProject({ mapper: 1, save: true, items: [piece(1, 'Sword', WEAPON, { atk: 7 })] });
  assert.equal(saveBodySize(bare), BODY_BASE);
  assert.equal(saveBodySize(worn), BODY_EQUIP);
  const fields = saveFields(worn);
  assert.deepEqual(fields[fields.length - 1], { ram: 'pc_equip', size: 12 }, 'pc_equip is appended last');
  assert.deepEqual(saveFields(bare), saveFields(), 'an equipment-free project uses the shared field list as-is');
  assert.notEqual(saveIdentity(worn), saveIdentity(bare), 'a record with a different layout must not validate against the other');
  // A plain (non-piece) item added to the same project does not flip the layout: the identity change is the equipment, not the item.
  const plainItem = await equipProject({ mapper: 1, save: true, items: [plain(1, 'Tonic')] });
  assert.equal(saveBodySize(plainItem), BODY_BASE);
  assert.notEqual(saveIdentity(worn), saveIdentity(plainItem), 'and a piece, unlike an ordinary item, changes the identity');
});

test('none of the six checked-in fixtures changes its save layout or identity', async () => {
  // Compared against the same function run over the fixture with every equipment field absent: the checked-in fixtures carry no
  // piece, so layout 120 and an identity equal to the pre-equipment fold. The absolute identity values are pinned by the existing
  // save tests' own round trips (a changed identity would make their stale-identity cases fail).
  for (const name of ['sample', 'sample-rpg', 'sample-mmc1', 'sample-mmc3', 'sample-u512', 'sample-rpg-mmc1']) {
    const project = await loadProject(path.join(ROOT, name));
    assert.equal(saveBodySize(project), BODY_BASE, `${name}: record size`);
    const stripped = structuredClone(project);
    for (const item of stripped.items ?? []) delete item.equip;
    assert.equal(saveIdentity(project), saveIdentity(stripped), `${name}: identity`);
  }
});

// --- a tiny driver for a save-capable equipment build -------------------------------------------------------------------------

// Five items: Potion (sample-rpg's own, id 0), Sword 1 (weapon), Mail 2 (armor), Charm 3 (accessory, MAG/MDEF), Ring 4 (accessory, ATK/DEF).
const PIECES = [
  piece(1, 'Sword', WEAPON, { atk: 7 }),
  piece(2, 'Mail', ARMOR, { def: 5 }),
  piece(3, 'Charm', ACCESSORY, { mag: 3, mdef: 2 }),
  piece(4, 'Ring', ACCESSORY, { atk: 4, def: 1 })
];
const SWORD = 1;
const MAIL = 2;
const CHARM = 3;
const RING = 4;

// Non-default equipment (nothing is worn at New Game): member 0 weapon; member 2 armor + accessory; member 3 a piece in all three.
const WORN = (() => {
  const ids = Array(12).fill(NO_ITEM);
  ids[eqIndex(0, WEAPON)] = SWORD;
  ids[eqIndex(2, ARMOR)] = MAIL;
  ids[eqIndex(2, ACCESSORY)] = CHARM;
  ids[eqIndex(3, WEAPON)] = SWORD;
  ids[eqIndex(3, ARMOR)] = MAIL;
  ids[eqIndex(3, ACCESSORY)] = RING;
  return ids;
})();
// Exact expected bonuses, by hand: member 0 = Sword; member 2 = Mail + Charm; member 3 = Sword + Mail + Ring.
const BONUS = {
  atk: [7, 0, 0, 7 + 4],
  def: [0, 0, 5, 5 + 1],
  mag: [0, 0, 3, 0],
  mdef: [0, 0, 2, 0]
};

/** Build a save-capable equipment project on a board; returns { built, rom }. `poison` plants bytes past the eq_* columns. */
async function buildSaveable(t, board, { items = PIECES, poison = false, mutate } = {}) {
  const project = await equipProject({ mapper: board.mapper, save: true, items, mutate });
  const built = await buildEquip(t, project);
  const rom = poison
    ? poisonPastColumns(built, { eq_slot: 0x00, eq_who: 0xff, eq_atk: 0x7f, eq_def: 0x7f, eq_mag: 0x7f, eq_mdef: 0xff })
    : built.romPath;
  return { built, rom, board };
}

const startNewGame = (nes) => {
  tap(nes, START, 30);
  assert.equal(nes.cpu.mem[RAM.GAME_STATE], ST_GAMEPLAY, 'START at the title never reached gameplay (naming should be off)');
};

const recordByte = (nes, board, index) => (board.flash ? nes.rom.rom[FLASH_BANK][FLASH_OFFSET + index] : nes.cpu.mem[SRAM_BASE + index]);
const writeRecordByte = (nes, board, index, value) => {
  if (board.flash) {
    // Straight into the canonical bank and the image reloadROM() reparses -- the two places programFlashByte itself writes.
    nes.rom.rom[FLASH_BANK][FLASH_OFFSET + index] = value;
    nes.mmap.writeThroughRomData(FLASH_BANK, FLASH_OFFSET + index, value);
  } else nes.cpu.mem[SRAM_BASE + index] = value;
};
const saved = (nes, board) => recordByte(nes, board, MARKER_OFFSET) === MARKER_VALID;
const powerCycle = (nes, board) => (board.flash ? powerCycleFlash(nes) : powerCycleBattery(nes));

/** Replace the first `bytes.length` bytes of the record's pc_equip and recompute a matching checksum, as a hand-edited save would. */
function tamperEquip(nes, board, bytes) {
  bytes.forEach((value, i) => writeRecordByte(nes, board, PC_EQUIP_OFFSET + i, value));
  const body = Array.from({ length: BODY_EQUIP }, (_, i) => recordByte(nes, board, i));
  const [lo, hi] = computeChecksum(body);
  writeRecordByte(nes, board, CHECKSUM_OFFSET, lo);
  writeRecordByte(nes, board, CHECKSUM_OFFSET + 1, hi);
}

/** One real save of a fresh game on this ROM (so the record is whatever the engine writes), returning the booted machine. */
function freshSavedGame(rom, board, { before } = {}) {
  const nes = boot(rom, 60);
  startNewGame(nes);
  if (before) before(nes);
  touchSaver(nes, () => saved(nes, board));
  return nes;
}

/** Continue from the title; returns the machine. */
function continueGame(nes, board) {
  powerCycle(nes, board);
  assert.equal(nes.cpu.mem[RAM.GAME_STATE], ST_TITLE, 'a power cycle should boot back to the title');
  tap(nes, SELECT, 30);
  return nes;
}

// --- stale saves -----------------------------------------------------------------------------------------------------------

for (const board of BOARDS) {
  test(`${board.name}: stale-save cases (a)-(d) -- a worn byte is validated against NUM_ITEMS on load and against its slot after`, opts, async (t) => {
    // Two pieces and an ordinary item above them: NUM_ITEMS = 4 (Potion 0, Sword 1, Mail 2, Tonic 3).
    const items = [piece(1, 'Sword', WEAPON, { atk: 7 }), piece(2, 'Mail', ARMOR, { def: 5 }), plain(3, 'Tonic')];
    const { built, rom } = await buildSaveable(t, board, { items, poison: true });
    const numItems = built.project.items.length;
    assert.equal(numItems, 4);
    const clean = Array(12).fill(NO_ITEM);

    const run = (worn) => {
      const nes = freshSavedGame(rom, board);
      tamperEquip(nes, board, worn);
      continueGame(nes, board);
      return nes;
    };

    // (a) an ordinary item above the last piece, in the weapon slot: NUM_ITEMS-1 passes save_check_valid and is emptied by the
    // recalc. The columns are NUM_ITEMS long, so item 3's row exists; with a column cut at the last piece (id 2) the planted
    // bytes past it (slot 0 = "weapon", atk 0x7F) would make the Tonic look like a weapon worth 127.
    let worn = clean.slice();
    worn[eqIndex(0, WEAPON)] = numItems - 1;
    let nes = run(worn);
    assert.equal(nes.cpu.mem[RAM.GAME_STATE], ST_GAMEPLAY, '(a)/(d) NUM_ITEMS-1 is a valid id and Continue must be offered');
    assert.equal(pcEquip(nes)[eqIndex(0, WEAPON)], NO_ITEM, '(a) an ordinary item cannot be worn: the byte is emptied');
    assert.deepEqual(pcBonus(nes), { atk: [0, 0, 0, 0], def: [0, 0, 0, 0], mag: [0, 0, 0, 0], mdef: [0, 0, 0, 0] }, '(a) and contributes no bonus');

    // The same for the Potion (id 0, the first row) and for a real piece in the wrong slot (Mail, an armor, in the weapon slot).
    for (const wrong of [0, 2]) {
      worn = clean.slice();
      worn[eqIndex(1, WEAPON)] = wrong;
      nes = run(worn);
      assert.equal(pcEquip(nes)[eqIndex(1, WEAPON)], NO_ITEM, `id ${wrong} in a weapon slot is emptied`);
      assert.equal(pcBonus(nes).def[1], 0, `id ${wrong}: no DEF leaks from a piece in the wrong slot`);
    }

    // A legitimately worn piece beside the bad one is kept (the sanitizer empties the bad byte, not everything).
    worn = clean.slice();
    worn[eqIndex(0, WEAPON)] = SWORD;
    worn[eqIndex(1, WEAPON)] = numItems - 1;
    nes = run(worn);
    assert.equal(pcEquip(nes)[eqIndex(0, WEAPON)], SWORD);
    assert.equal(pcEquip(nes)[eqIndex(1, WEAPON)], NO_ITEM);
    assert.deepEqual(pcBonus(nes).atk, [7, 0, 0, 0]);

    // (b) $FF is accepted (an empty slot), and accepted alongside a real piece.
    worn = clean.slice();
    worn[eqIndex(2, ARMOR)] = 2;
    nes = run(worn);
    assert.equal(nes.cpu.mem[RAM.GAME_STATE], ST_GAMEPLAY, '(b) $FF bytes are valid');
    assert.deepEqual(pcEquip(nes), worn, '(b) the real piece survives, the empty slots stay empty');
    assert.deepEqual(pcBonus(nes).def, [0, 0, 5, 0]);

    // (c) NUM_ITEMS and 254 are refused: Continue is not offered and the game stays on the title.
    for (const bad of [numItems, 254]) {
      worn = clean.slice();
      worn[eqIndex(0, ARMOR)] = bad;
      nes = run(worn);
      assert.equal(nes.cpu.mem[RAM.GAME_STATE], ST_TITLE, `(c) id ${bad} is out of range: Continue must be refused`);
    }
  });
}

test('MMC1: Continue is not offered for an out-of-range worn byte -- save_check_valid itself answers invalid', opts, async (t) => {
  const board = BOARDS[0];
  const items = [piece(1, 'Sword', WEAPON, { atk: 7 }), plain(2, 'Tonic')];
  const { built, rom } = await buildSaveable(t, board, { items });
  const nes = freshSavedGame(rom, board);
  const { callRoutine } = await import('../lib/callroutine.js');
  // jsnes F_ZERO is 0 when the result WAS zero: validity is "BEQ taken" = F_ZERO === 0.
  const isValid = () => {
    callRoutine(nes, built.symbols.save_check_valid);
    return nes.cpu.F_ZERO === 0;
  };
  assert.equal(isValid(), true, 'control: the untouched record is valid');
  tamperEquip(nes, board, [built.project.items.length]);
  assert.equal(isValid(), false, 'NUM_ITEMS is refused');
  tamperEquip(nes, board, [built.project.items.length - 1]);
  assert.equal(isValid(), true, 'NUM_ITEMS-1 is accepted');
  tamperEquip(nes, board, [NO_ITEM]);
  assert.equal(isValid(), true, '$FF is accepted');
});

// --- persistence -------------------------------------------------------------------------------------------------------------

const EXPECT = { ids: WORN, bonus: BONUS };
const judge = (nes) => ({
  ids: isDeepStrictEqual(pcEquip(nes), EXPECT.ids),
  bonus: isDeepStrictEqual(pcBonus(nes), EXPECT.bonus)
});

/** Wear WORN with its correct bonus cache (the state the equip menu will leave), optionally with a deliberately wrong cache. */
function wearNonDefault(nes, { wrongCache = false } = {}) {
  WORN.forEach((id, i) => (nes.cpu.mem[RAM.PC_EQUIP + i] = id));
  const bonus = wrongCache ? { atk: [99, 98, 97, 96], def: [95, 94, 93, 92], mag: [91, 90, 89, 88], mdef: [87, 86, 85, 84] } : BONUS;
  for (let m = 0; m < 4; m++) {
    nes.cpu.mem[RAM.PC_EQ_ATK + m] = bonus.atk[m];
    nes.cpu.mem[RAM.PC_EQ_DEF + m] = bonus.def[m];
    nes.cpu.mem[RAM.PC_EQ_MAG + m] = bonus.mag[m];
    nes.cpu.mem[RAM.PC_EQ_MDEF + m] = bonus.mdef[m];
  }
}

for (const board of BOARDS) {
  test(`${board.name}: non-default equipment on several members and slots survives save, power cycle and Continue -- exact ids, exact bonuses`, opts, async (t) => {
    const { rom } = await buildSaveable(t, board, { poison: true });
    // Pass 1: the cache is correct when saved.
    let nes = freshSavedGame(rom, board, { before: (n) => wearNonDefault(n) });
    assert.equal(recordByte(nes, board, MARKER_OFFSET), MARKER_VALID);
    // The record carries the ids, in order, in its last body field.
    assert.deepEqual(Array.from({ length: 12 }, (_, i) => recordByte(nes, board, PC_EQUIP_OFFSET + i)), WORN, 'pc_equip is serialized at body offset 120');
    continueGame(nes, board);
    assert.equal(nes.cpu.mem[RAM.GAME_STATE], ST_GAMEPLAY, 'Continue should have resumed play');
    assert.deepEqual(judge(nes), { ids: true, bonus: true });
    assert.deepEqual(pcEquip(nes), WORN);
    assert.deepEqual(pcBonus(nes), BONUS);

    // Pass 2: the live cache was WRONG when saved. A restore that trusted a cached value (saved, or left in RAM) would differ.
    nes = freshSavedGame(rom, board, { before: (n) => wearNonDefault(n, { wrongCache: true }) });
    continueGame(nes, board);
    assert.deepEqual(judge(nes), { ids: true, bonus: true }, 'the bonuses are recomputed from the ids, not carried over');
  });
}

test('controls: the persistence judge fails on omitted serialization, on omitted recalc, and on a restored (stale) cache', opts, async (t) => {
  const board = BOARDS[0];
  const { rom } = await buildSaveable(t, board);
  // (1) Omitted serialization: the record holds no worn pieces (what a build that never saved pc_equip would restore).
  let nes = freshSavedGame(rom, board, { before: (n) => wearNonDefault(n) });
  tamperEquip(nes, board, Array(12).fill(NO_ITEM));
  continueGame(nes, board);
  assert.deepEqual(judge(nes), { ids: false, bonus: false }, 'omitted serialization is caught by the exact ids');
  assert.deepEqual(pcEquip(nes), Array(12).fill(NO_ITEM), 'and the party is bare after Continue');

  // (2) Omitted recalc: ids right, bonuses zero (what party_restore without equip_recalc leaves). Reproduced on the real ROM by
  // clearing the cache after Continue, since the cache is not saved: the judge must then say ids good, bonus bad.
  nes = freshSavedGame(rom, board, { before: (n) => wearNonDefault(n) });
  continueGame(nes, board);
  assert.deepEqual(judge(nes), { ids: true, bonus: true });
  nes.cpu.mem.fill(0, RAM.PC_EQ_ATK, RAM.PC_EQ_ATK + 16);
  assert.deepEqual(judge(nes), { ids: true, bonus: false }, 'omitted recalc: right ids, zero bonuses -- judged by exact values, not "nonzero"');

  // (3) A stale cache: right ids, but the bonuses of the saved game's wrong cache.
  nes = freshSavedGame(rom, board, { before: (n) => wearNonDefault(n, { wrongCache: true }) });
  continueGame(nes, board);
  wearNonDefault(nes, { wrongCache: true });
  assert.deepEqual(judge(nes), { ids: true, bonus: false }, 'a restore that trusted the cache would be caught');
});

test('a Code Forge override that drops party_restore\'s equip_recalc is caught: ids restored, every bonus zero', opts, async (t) => {
  const board = BOARDS[0];
  const source = fs.readFileSync(path.join(ROOT, 'engine', 'battle.asm'), 'utf8');
  const marker = /(party_restore:[\s\S]*?)\n  jmp equip_recalc/;
  assert.match(source, marker, 'party_restore no longer ends in jmp equip_recalc -- update this control');
  const { rom } = await buildSaveable(t, board, {
    mutate: (p) => {
      p.code = { overrides: [{ name: 'battle.asm', text: source.replace(marker, '$1\n  rts') }], files: [] };
    }
  });
  const nes = freshSavedGame(rom, board, { before: (n) => wearNonDefault(n) });
  continueGame(nes, board);
  assert.equal(nes.cpu.mem[RAM.GAME_STATE], ST_GAMEPLAY);
  assert.deepEqual(pcEquip(nes), WORN, 'the ids still restore (they are saved)');
  assert.deepEqual(pcBonus(nes), { atk: [0, 0, 0, 0], def: [0, 0, 0, 0], mag: [0, 0, 0, 0], mdef: [0, 0, 0, 0] }, 'with no recalc the bonuses are never rebuilt');
  assert.deepEqual(judge(nes), { ids: true, bonus: false });
});

// --- flash: the record grows into the streamed-world scratch block ----------------------------------------------------------

/** Every sw_fc_* / sw_kb_* single-byte address in this build's own RAM map. */
function scratchBlockAddresses(built) {
  const pending = new Map();
  scanEquates(fs.readFileSync(path.join(built.dir, 'build', 'constants.asm'), 'utf8'), pending);
  scanEquates(fs.readFileSync(path.join(built.dir, 'build', 'assets', 'config.inc'), 'utf8'), pending);
  scanEquates(fs.readFileSync(path.join(built.dir, 'build', 'assets', 'cartridge.inc'), 'utf8'), pending);
  const symbols = new Map();
  resolveEquates(pending, symbols);
  const addresses = [...symbols].filter(([name]) => /^sw_(fc|kb)_/.test(name)).map(([, address]) => address);
  return [...new Set(addresses)].filter((address) => address >= 0x0780 && address < 0x07a0).sort((x, y) => x - y);
}

/** Seed the block with known values, run a real flash save, and read the block back at the checkpoint "save complete + 30 frames". */
function seedSaveObserve(rom, built, board) {
  const addresses = scratchBlockAddresses(built);
  assert.ok(addresses.length >= 8, `only ${addresses.length} scratch-block bytes found -- the RAM map parse failed`);
  const nes = boot(rom, 60);
  startNewGame(nes);
  const seeds = new Map(addresses.map((address, i) => [address, 0xa0 + i]));
  for (const [address, value] of seeds) nes.cpu.mem[address] = value;
  touchSaver(nes, () => saved(nes, board));
  const observed = new Map(addresses.map((address) => [address, nes.cpu.mem[address]]));
  return { seeds, observed, addresses };
}

test('UNROM 512 + equipment + Save: a real flash save leaves the shifted streamed-world scratch block untouched; with the shift removed it is overwritten', opts, async (t) => {
  const board = BOARDS[2];
  const real = await buildSaveable(t, board);
  const stock = seedSaveObserve(real.rom, real.built, board);
  assert.ok(Math.min(...stock.addresses) >= 0x078b, 'the shifted block starts above the 139-byte record ($0700-$078A)');
  assert.deepEqual([...stock.observed], [...stock.seeds], 'the shifted block survives a save byte for byte');

  // The control: the identical project with ONLY EQUIP_SAVE_SHIFT forced to 0 (the block back at $0780), via a constants.asm override.
  const constants = fs.readFileSync(path.join(ROOT, 'engine', 'constants.asm'), 'utf8');
  const unshifted = constants.replace(/^sw_fc_wy_lo(\s*)= SW_BLK_BASE\+EQUIP_SAVE_SHIFT/m, 'sw_fc_wy_lo$1= SW_BLK_BASE');
  assert.notEqual(unshifted, constants, 'the sw_fc_wy_lo line was not found -- did constants.asm change shape?');
  const control = await buildSaveable(t, board, {
    mutate: (p) => {
      p.code = { overrides: [{ name: 'constants.asm', text: unshifted }], files: [] };
    }
  });
  const broken = seedSaveObserve(control.rom, control.built, board);
  assert.equal(Math.min(...broken.addresses), 0x0780, 'the control block really is at $0780');
  assert.notDeepEqual([...broken.observed], [...broken.seeds], 'unshifted, the staged record overwrites the scratch block');
  const clobbered = broken.addresses.filter((address) => broken.observed.get(address) !== broken.seeds.get(address));
  assert.ok(clobbered.length > 0 && clobbered.every((address) => address <= 0x078a), 'and only inside the record\'s $0780-$078A span');
});

// --- late Join, New Game, event replay ---------------------------------------------------------------------------------------

/** Talk (B) then press A through every page until play resumes. */
function talkThrough(nes) {
  tap(nes, B, 12);
  for (let press = 0; press < 30 && nes.cpu.mem[RAM.GAME_STATE] !== ST_GAMEPLAY; press++) {
    for (let i = 0; i < 90; i++) nes.frame();
    tap(nes, A, 12);
  }
  return nes.cpu.mem[RAM.GAME_STATE] === ST_GAMEPLAY;
}

test('a late Join after Continue: the never-recruited member\'s gear is intact and live the moment she joins, and Join does not reset it', opts, async (t) => {
  const board = BOARDS[0];
  // Member 1 (Iris) starts wearing a Sword; the player changes her to a Ring before saving -- non-default, so a Join that re-ran
  // equip_init (restoring the starting set) would be caught.
  const { rom } = await buildSaveable(t, board, { mutate: (p) => (p.party[1].startEquip = [SWORD, null, null]) });
  const nes = boot(rom, 60);
  startNewGame(nes);
  assert.equal(nes.cpu.mem[RAM.PC_IN_PARTY + 1], 0, 'Iris has not joined');
  assert.equal(pcEquip(nes)[eqIndex(1, WEAPON)], SWORD, 'dormant members still hold their starting gear (equip_init covers all four)');
  nes.cpu.mem[RAM.PC_EQUIP + eqIndex(1, WEAPON)] = NO_ITEM;
  nes.cpu.mem[RAM.PC_EQUIP + eqIndex(1, ACCESSORY)] = RING;
  nes.cpu.mem[RAM.PC_EQ_ATK + 1] = 4;
  nes.cpu.mem[RAM.PC_EQ_DEF + 1] = 1;
  touchSaver(nes, () => saved(nes, board));
  continueGame(nes, board);
  assert.equal(nes.cpu.mem[RAM.GAME_STATE], ST_GAMEPLAY);
  assert.equal(nes.cpu.mem[RAM.PC_IN_PARTY + 1], 0, 'still not recruited after Continue');
  assert.equal(pcEquip(nes)[eqIndex(1, ACCESSORY)], RING, 'her saved gear came back while she was away');
  assert.deepEqual([pcBonus(nes).atk[1], pcBonus(nes).def[1]], [4, 1], 'and its bonus was rebuilt for a member who is not in the party');

  walkTo(nes, 208, 48);
  assert.ok(talkThrough(nes), 'the Join conversation never ended');
  assert.equal(nes.cpu.mem[RAM.PC_IN_PARTY + 1], 1, 'Iris joined');
  assert.equal(pcEquip(nes)[eqIndex(1, WEAPON)], NO_ITEM, 'joining did not re-apply her starting Sword');
  assert.equal(pcEquip(nes)[eqIndex(1, ACCESSORY)], RING, 'her chosen gear is still on');
  assert.deepEqual([pcBonus(nes).atk[1], pcBonus(nes).def[1]], [4, 1], 'and her bonus is live');
});

test('startEquip at New Game covers all four members, and a started game is byte-for-byte the same ids as the data says', opts, async (t) => {
  const { rom } = await buildSaveable(t, BOARDS[0], {
    mutate: (p) => {
      p.party[0].startEquip = [SWORD, null, null];
      p.party[2].startEquip = [null, MAIL, CHARM];
      p.party[3].startEquip = [SWORD, MAIL, RING];
    }
  });
  const nes = boot(rom, 60);
  startNewGame(nes);
  assert.deepEqual(pcEquip(nes), WORN);
  assert.deepEqual(pcBonus(nes), BONUS);
  assert.deepEqual(bag(nes), [], 'starting gear is worn, never in the bag');
});

test('a visible event-replay counter: wearing gear changes how many times an enter event runs by exactly nothing, at New Game and after Continue', opts, async (t) => {
  // An enter-trigger event counts its own runs in variable 0 (engine/constants.asm variables at $0500). Equipment's party_init /
  // party_restore wiring must not re-arm, re-fire or swallow it: the counter is compared against a build with no gear.
  const counter = (mutate) => async () => {
    const { rom } = await buildSaveable(t, BOARDS[0], {
      mutate: (p) => {
        const screen = p.maps[p.project.startMap].screens[p.project.startScreen];
        screen.entities.push({
          actorId: p.sprites.actors.length - 1,
          x: 48,
          y: 160,
          props: { trigger: 'enter', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 0, value: 1 }] }] } }
        });
        mutate(p);
      }
    });
    const nes = boot(rom, 60);
    startNewGame(nes);
    for (let i = 0; i < 60; i++) nes.frame();
    const atNewGame = nes.cpu.mem[0x500];
    touchSaver(nes, () => saved(nes, BOARDS[0]));
    continueGame(nes, BOARDS[0]);
    for (let i = 0; i < 60; i++) nes.frame();
    return { atNewGame, afterContinue: nes.cpu.mem[0x500] };
  };
  const bare = await counter(() => {})();
  const worn = await counter((p) => (p.party[0].startEquip = [SWORD, null, null]))();
  assert.deepEqual(worn, bare, 'identical counters with and without worn gear');
  // Exact: the event runs once at New Game; the saved counter (1) is restored, and the restored game's entry replays it once more (2).
  assert.deepEqual(bare, { atNewGame: 1, afterContinue: 2 });
});

// ---- the resolver's fallback for a caller that never read cartridge.inc (review R2) ---------------------------------------------------
// test/lib/equates.js may take EQUIP_SAVE_SHIFT as 0 for the frozen harness scene builder (sw_manifest_scene.mjs reads constants.asm +
// config.inc only) -- but ONLY when a resolved flag proves it. The wrong implementation: a fallback that silently picks 0 for any build,
// which resolves an equipment + flash + Save build's RAM map ($0780 block) with the wrong addresses and no error.
test('resolveEquates: the missing-cartridge fallback is proven by a resolved flag, never guessed', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const resolveWith = (built, files) => {
    const pending = new Map();
    for (const file of files) scanEquates(fs.readFileSync(path.join(built.dir, 'build', file), 'utf8'), pending);
    const symbols = new Map();
    resolveEquates(pending, symbols);
    return symbols;
  };
  const constantsAndConfig = ['constants.asm', 'assets/config.inc'];
  const allThree = [...constantsAndConfig, 'assets/cartridge.inc'];
  const sword = [piece(1, 'Sword', WEAPON, { atk: 7 })];

  // 1. Proven zero: no equipment at all (EQUIP_ENABLED = 0), and equipment without a flash Save (SAVE_FLASH = 0) -- both resolve to $0780.
  const plainBuild = await buildEquip(t, await equipProject({ mapper: 30, save: true }));
  assert.equal(resolveWith(plainBuild, constantsAndConfig).get('sw_fc_wy_lo'), 0x0780, 'EQUIP_ENABLED = 0 proves the shift is 0');
  const noSave = await buildEquip(t, await equipProject({ mapper: 30, items: sword }));
  assert.equal(resolveWith(noSave, constantsAndConfig).get('sw_fc_wy_lo'), 0x0780, 'SAVE_FLASH = 0 proves the shift is 0');

  // 2. The real equipment + flash + Save build: without cartridge.inc the resolver must refuse, not pick a wrong map.
  const real = await buildEquip(t, await equipProject({ mapper: 30, save: true, items: sword }));
  assert.throws(() => resolveWith(real, constantsAndConfig), /could not resolve: .*sw_fc_wy_lo/, 'an equipment + flash + Save build without cartridge.inc throws');

  // 3. The same build with cartridge.inc is the shifted map.
  const symbols = resolveWith(real, allThree);
  assert.equal(symbols.get('EQUIP_SAVE_SHIFT'), 12);
  assert.equal(symbols.get('sw_fc_wy_lo'), 0x078c, 'with cartridge.inc the block is at $078C');
  assert.equal(symbols.get('sw_kb_acc'), 0x0799);

  // 4. An unknown flag is never zero: constants.asm alone (no config.inc, so EQUIP_ENABLED and SAVE_FLASH are unknown) throws.
  assert.throws(() => resolveWith(plainBuild, ['constants.asm']), /could not resolve/, 'unknown flags do not prove a zero shift');
});
