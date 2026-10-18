// The shared harness for the equipment engine tests (ROADMAP item 5, build commit C3): equipment variants of sample-rpg,
// built in their own mkdtemp directories (a fixture is never written to), booted headlessly in the vendored jsnes core,
// plus the battle, save and power-cycle drivers the engine, save and persistence tests share. Addresses are
// engine/constants.asm's, written out by hand with a `; from` comment: a test that read the file it is checking proves nothing.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { callRoutine } from './callroutine.js';
import { createPartyMember } from '../../shared/project.js';
import { codeRegions, resolveMapper } from '../../shared/cartridge.js';
import { createStreamedProject } from './streamedproject.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');

// Engine RAM -- engine/constants.asm.
export const RAM = {
  PLAYER_X: 0x10,
  PLAYER_Y: 0x11,
  GAME_STATE: 0x25,
  BOX_STATE: 0x40,
  INV_COUNT: 0x37,
  INV_SEL: 0x38,
  BT_STR: 0x5a,
  BT_LEN: 0x6b,
  BT_ARG: 0x6d,
  BT_LIST: 0x3e4,
  BT_PHASE: 0x53,
  BT_ACTOR: 0x54,
  BT_SEL: 0x55,
  BT_TARGET: 0x56,
  RNG: 0x62,
  PARTY_SIZE: 0x65,
  INV_ITEMS: 0x378,
  PC_HP: 0x398,
  PC_HP_MAX: 0x39c,
  PC_LEVEL: 0x3a8,
  PC_XP_LO: 0x3ac,
  PC_XP_HI: 0x3b0,
  PC_IN_PARTY: 0x3b4,
  MON_HP: 0x3c0,
  MON_ALIVE: 0x3c8,
  MON_SLOT_MP: 0x3ec,
  PC_STATUS: 0x3f0,
  PC_EQUIP: 0x07d4, // slot-major: slot * MAX_PARTY + member
  PC_EQ_ATK: 0x07e0,
  PC_EQ_DEF: 0x07e4,
  PC_EQ_MAG: 0x07e8,
  PC_EQ_MDEF: 0x07ec
};
export const NO_ITEM = 0xff; // engine/constants.asm
export const MAX_PARTY = 4; // engine/constants.asm
export const MAX_ITEMS = 8; // engine/constants.asm
export const EQUIP_BYTES = 12; // RPG_LIMITS.equipSlots * MAX_PARTY
export const ST_GAMEPLAY = 0;
export const ST_TITLE = 3;
export const ST_GAMEOVER = 4;
export const ST_MENU = 1;
export const ST_BATTLE = 5;
export const BP_MENU = 1;
export const BC_FIGHT = 0;
export const BC_MAGIC = 1;
export const BC_RUN = 3;
export const SRAM_BASE = 0x6000;
export const SRAM_SIZE = 0x2000;
export const A = 0;
export const B = 1;
export const SELECT = 2;
export const START = 3;
export const UP = 4;
export const DOWN = 5;
export const LEFT = 6;
export const RIGHT = 7;
export const EVERYONE = 0b1111;

export const WEAPON = 0;
export const ARMOR = 1;
export const ACCESSORY = 2;

/** An equipment piece: slot is the index into EQUIP_SLOTS, effect `none` (a validate rule). */
export const piece = (id, name, slot, stats = {}) => ({
  id,
  name,
  actorId: null,
  metaspriteId: null,
  effect: { kind: 'none', amount: 0 },
  equip: { slot, atk: 0, def: 0, mag: 0, mdef: 0, usableBy: EVERYONE, ...stats }
});

/** An ordinary item (a heal by default). */
export const plain = (id, name, effect = { kind: 'heal', amount: 20 }) => ({
  id,
  name,
  actorId: null,
  metaspriteId: null,
  effect,
  equip: null
});

/**
 * sample-rpg (its Potion is item 0) on one board, naming off (the in-game grid is unrelated to what these tests drive), the
 * wandering-encounter rate zeroed (a fight happens when a test walks into Slime), and `items` appended as ids 1.. in order.
 * `start` maps a member index to its startEquip triple. `save` adds a title screen and a touch-triggered Save NPC at (64,96)
 * -- the shape save.test.js builds.
 */
export async function equipProject({ mapper = 1, items = [], start = {}, save = false, mutate } = {}) {
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = mapper;
  // Four members, so every pc_equip column has an owner (sample-rpg ships two); the extra two never join unless a test says.
  while (project.party.length < 4) project.party.push(createPartyMember(project.party.length));
  for (const member of project.party) member.renamable = false;
  project.maps[0].encounters = { rate: 0, actorIds: [] };
  for (const item of items) project.items.push({ ...item, id: project.items.length });
  for (const [member, triple] of Object.entries(start)) project.party[Number(member)].startEquip = triple;
  if (save) {
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    const saverId = project.sprites.actors.length;
    project.sprites.actors.push({ name: 'Saver', behavior: 'npc', hp: 1, damage: 0 });
    project.maps[0].screens[0].entities.push({
      actorId: saverId,
      x: 64,
      y: 96,
      props: { trigger: 'touch', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } }
    });
  }
  if (mutate) mutate(project);
  return project;
}

/**
 * A streamed-world RPG with equipment (review R3/R4): test/lib/streamedproject.js's project, four party members like
 * equipProject's, the given pieces appended to its items. UNROM 512 uses the four-screen torus; MMC1 and MMC3 the vertical
 * two-nametable ring (4 x 1 screens), the two shapes the repo's streamed RPG tests build. `save` adds a touch Saver at (64, 96) that runs
 * a Save command (the project needs no title map: Save forces its own title cost).
 */
export function equipStreamedProject({ mapper = 30, items = [], start = {}, save = false, move = false, mutate } = {}) {
  const project = createStreamedProject({
    gameType: 'rpg',
    mapper,
    mixed: save, // Save needs a title: the ordinary "Before" map (index 0) is the title map, the streamed map (1) the game
    ...(mapper === 30 ? {} : { mirroring: 'vertical', gridW: 4, gridH: 1 }),
    ...(move ? { moveCommands: [{ op: 'move', who: 'self', dir: 'up', dist: 16 }] } : {})
  });
  if (save) {
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    project.project.startMap = 1;
    // The same touch-triggered Save NPC equipProject places, on the streamed map's first screen.
    const saverId = project.sprites.actors.length;
    project.sprites.actors.push({ name: 'Saver', behavior: 'npc', hp: 1, damage: 0 });
    project.maps[1].screens[0].entities = [
      ...(project.maps[1].screens[0].entities ?? []),
      { actorId: saverId, x: 64, y: 96, props: { toX: 0, toY: 0, trigger: 'touch', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } } }
    ];
  }
  while (project.party.length < 4) project.party.push(createPartyMember(project.party.length));
  for (const member of project.party) member.renamable = false;
  for (const item of items) project.items.push({ ...item, id: project.items.length });
  for (const [member, triple] of Object.entries(start)) project.party[Number(member)].startEquip = triple;
  if (mutate) mutate(project);
  return project;
}

/** Build a project in a fresh mkdtemp directory (removed by t.after) -> { romPath, symbolPath, symbols, dir, project, lines }. */
export async function buildEquip(t, project) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-equip-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const lines = [];
  const built = await buildProject({ dir, project, log: (line) => lines.push(line) });
  const symbols = parseSymbolFile(fs.readFileSync(built.symbolPath, 'utf8'));
  return { ...built, symbols, dir, project, lines };
}

export function boot(romPath, frames = 40) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  return nes;
}

export const tap = (nes, button, frames = 14) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
};

export function walkTo(nes, targetX, targetY, budget = 600) {
  for (let i = 0; i < budget; i++) {
    if (nes.cpu.mem[RAM.GAME_STATE] !== ST_GAMEPLAY) return;
    const dx = targetX - nes.cpu.mem[RAM.PLAYER_X];
    const dy = targetY - nes.cpu.mem[RAM.PLAYER_Y];
    let button = null;
    if (dx > 1) button = RIGHT;
    else if (dx < -1) button = LEFT;
    else if (dy > 1) button = DOWN;
    else if (dy < -1) button = UP;
    if (button === null) return;
    nes.buttonDown(1, button);
    nes.frame();
    nes.buttonUp(1, button);
  }
}

/** Run frames until it is a party member's turn to choose. */
export function waitForMenu(nes, budget = 900) {
  for (let i = 0; i < budget && nes.cpu.mem[RAM.BT_PHASE] !== BP_MENU; i++) nes.frame();
  assert.equal(nes.cpu.mem[RAM.BT_PHASE], BP_MENU, 'the menu never came round');
}

/** Walk into Slime (176,176), the placed monster, and wait for the first menu. */
export function startFight(nes) {
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  waitForMenu(nes);
  assert.equal(nes.cpu.mem[RAM.GAME_STATE], ST_BATTLE, 'walking into Slime should start a fight');
}

export function chooseCommand(nes, command) {
  for (let i = 0; i < 8 && nes.cpu.mem[RAM.BT_SEL] !== command; i++) tap(nes, DOWN, 4);
  assert.equal(nes.cpu.mem[RAM.BT_SEL], command, 'the battle menu never reached that command');
  tap(nes, A, 6);
}

/** Select the battle bank so a battle-code routine can be called in isolation (call_battle holds it only for one call). */
export function selectBattleBank(nes, built) {
  const configText = fs.readFileSync(path.join(built.dir, 'build', 'assets', 'config.inc'), 'utf8');
  const bank = parseInt(configText.match(/^BATTLE_BANK\s*=\s*(\d+)/m)[1], 10);
  nes.cpu.REG_ACC = bank;
  callRoutine(nes, built.symbols.switch_prg_bank);
}

/**
 * Call one battle-bank routine with the given registers; returns { a, x, y, carry, zero } after it. The caller must have
 * selectBattleBank()ed first, and must be on a board where $0700 is free (callRoutine's stub): not an UNROM 512 Save build.
 */
export function call(nes, built, label, { a = 0, x = 0, y = 0 } = {}) {
  const address = built.symbols[label];
  assert.ok(address !== undefined, `${label} is not a symbol of this build`);
  nes.cpu.REG_ACC = a;
  nes.cpu.REG_X = x;
  nes.cpu.REG_Y = y;
  callRoutine(nes, address);
  return { a: nes.cpu.REG_ACC, x: nes.cpu.REG_X, y: nes.cpu.REG_Y, carry: nes.cpu.F_CARRY, zero: nes.cpu.F_ZERO === 0 };
}

export const pcEquip = (nes) => Array.from(nes.cpu.mem.slice(RAM.PC_EQUIP, RAM.PC_EQUIP + EQUIP_BYTES));
export const pcBonus = (nes) => ({
  atk: Array.from(nes.cpu.mem.slice(RAM.PC_EQ_ATK, RAM.PC_EQ_ATK + MAX_PARTY)),
  def: Array.from(nes.cpu.mem.slice(RAM.PC_EQ_DEF, RAM.PC_EQ_DEF + MAX_PARTY)),
  mag: Array.from(nes.cpu.mem.slice(RAM.PC_EQ_MAG, RAM.PC_EQ_MAG + MAX_PARTY)),
  mdef: Array.from(nes.cpu.mem.slice(RAM.PC_EQ_MDEF, RAM.PC_EQ_MDEF + MAX_PARTY))
});
export const bag = (nes) => Array.from(nes.cpu.mem.slice(RAM.INV_ITEMS, RAM.INV_ITEMS + nes.cpu.mem[RAM.INV_COUNT]));

/** pc_equip index of (member, slot). */
export const eqIndex = (member, slot) => slot * MAX_PARTY + member;

/** A real power cycle with the battery intact (save.test.js's own): everything but $6000-$7FFF loses state. */
export function powerCycleBattery(nes, frames = 60) {
  const battery = nes.cpu.mem.slice(SRAM_BASE, SRAM_BASE + SRAM_SIZE);
  nes.reloadROM();
  nes.cpu.mem.set(battery, SRAM_BASE);
  for (let i = 0; i < frames; i++) nes.frame();
  return nes;
}

/** UNROM 512's flash record lives inside the ROM image itself, which reloadROM() keeps (flashsave.test.js). */
export function powerCycleFlash(nes, frames = 60) {
  nes.reloadROM();
  for (let i = 0; i < frames; i++) nes.frame();
  return nes;
}

/** Walk onto the Save NPC (64,96) until `until()` holds (the save is complete), then settle. */
export function touchSaver(nes, until) {
  for (let i = 0; i < 900 && !until(); i++) {
    const dx = 64 - nes.cpu.mem[RAM.PLAYER_X];
    const dy = 96 - nes.cpu.mem[RAM.PLAYER_Y];
    let button = null;
    if (dx > 1) button = RIGHT;
    else if (dx < -1) button = LEFT;
    else if (dy > 1) button = DOWN;
    else if (dy < -1) button = UP;
    if (button !== null) {
      nes.buttonDown(1, button);
      nes.frame();
      nes.buttonUp(1, button);
    } else nes.frame();
  }
  assert.ok(until(), 'the save never completed');
  for (let i = 0; i < 30; i++) nes.frame();
}

/** The checksum save_checksum (engine/save.asm) computes over the record body. */
export function computeChecksum(bytes) {
  let sum1 = 0;
  let sum2 = 0;
  for (const b of bytes) {
    sum1 = (sum1 + b) & 0xff;
    sum2 = (sum2 + sum1) & 0xff;
  }
  return [sum1, sum2];
}

/** A generated equate (NAME = value) out of this build's own assets/*.inc or constants.asm. */
export function equate(built, name) {
  const dirs = [path.join(built.dir, 'build', 'assets'), path.join(built.dir, 'build')];
  for (const dir of dirs) {
    for (const file of fs.readdirSync(dir)) {
      if (!/\.(inc|asm)$/.test(file)) continue;
      const m = fs.readFileSync(path.join(dir, file), 'utf8').match(new RegExp(`^${name}\\s*=\\s*(\\$[0-9A-Fa-f]+|\\d+)`, 'm'));
      if (m) return m[1].startsWith('$') ? parseInt(m[1].slice(1), 16) : parseInt(m[1], 10);
    }
  }
  throw new Error(`${name} is not defined in this build`);
}

/** Replace the bag with exactly `ids` (the engine's own two bytes of state). */
export function setBag(nes, ids) {
  ids.forEach((id, i) => (nes.cpu.mem[RAM.INV_ITEMS + i] = id));
  nes.cpu.mem[RAM.INV_COUNT] = ids.length;
}

/**
 * A copy of the built ROM with the byte just past each eq_* column overwritten, so a lookup that is not bounded by
 * NUM_ITEMS (a column cut at the highest piece id, or a missing bound) reads a value that would change the answer.
 * `poison` maps a column label to the byte to plant. The columns are NUM_ITEMS long, so a correct build never reads
 * the planted byte; the patch is verified by reading the column's own last entries back out of the file at the
 * computed offset, so a wrong offset fails loudly instead of poisoning nothing. Returns the new ROM's path.
 */
export function poisonPastColumns(built, poison) {
  const mapper = resolveMapper(built.project.cartridge.mapper);
  const slot = codeRegions(mapper, built.project.tilesets.length, 1)[0];
  const bytes = fs.readFileSync(built.romPath);
  const numItems = built.project.items.length;
  const offsetOf = (address) => 16 + slot.nesasmBank * 0x2000 + (address - slot.org);
  for (const [label, value] of Object.entries(poison)) {
    const address = built.symbols[label];
    if (address === undefined) continue; // eq_mag / eq_mdef exist only when some piece adds that stat
    assert.ok(address >= slot.org, `${label} is not in the battle region`);
    const last = offsetOf(address) + numItems - 1;
    const expected = columnValues(built.project, label);
    assert.equal(bytes[last], expected[numItems - 1], `${label}: the computed file offset does not land on the column (poison would miss)`);
    bytes[last + 1] = value;
  }
  const poisoned = built.romPath.replace(/\.nes$/, '.poisoned.nes');
  fs.writeFileSync(poisoned, bytes);
  return poisoned;
}

/** What the generator should have emitted for one eq_* column, from the project's own item data. */
function columnValues(project, label) {
  const stat = label.replace('eq_', '');
  return project.items.map((item) => {
    if (label === 'eq_slot') return item.equip ? item.equip.slot : 0xff;
    if (label === 'eq_who') return item.equip ? item.equip.usableBy : 0;
    return item.equip?.[stat] ?? 0;
  });
}

/**
 * Review R5's omitted-serialization control. Returns the project's `code` with an override of engine/save.asm whose body writer stores
 * $00 instead of the live bytes for the LAST field (pc_equip, the only field an equipment project appends): the record keeps its full
 * length, identity and a checksum computed over what was actually written, so Continue accepts it and runs the restore -- but the worn
 * set never reached the record. A Code Forge override, so the checked-in engine file is never written; the oracle is the persistence
 * judge's exact non-default ids and bonuses (save_sram.lua / save_flash_equip.lua.template, exit 10), not a layout or marker timeout.
 */
export async function omitEquipPayloadCode(existing = { overrides: [], files: [] }) {
  const source = await fs.promises.readFile(path.join(ROOT, 'engine/save.asm'), 'utf8');
  const needle = 'save_write_byte:\n  lda [save_ptr_lo],y\n  sta [save_cursor_lo],y\n';
  assert.equal(source.split(needle).length - 1, 1, 'engine/save.asm no longer has the body-copy loop this control patches');
  const omitted = source.replace(
    needle,
    'save_write_byte:\n  lda [save_ptr_lo],y\n  ldx <sv_idx                 ; equip-omit control: the last field (pc_equip) is not serialized\n' +
      '  cpx #SAVE_FIELD_COUNT-1\n  bne save_write_keep\n  lda #0\nsave_write_keep:\n  sta [save_cursor_lo],y\n'
  );
  return { ...existing, overrides: [...existing.overrides, { name: 'save.asm', text: omitted }] };
}
