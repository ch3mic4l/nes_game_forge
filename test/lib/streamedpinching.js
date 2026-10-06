// Slice 10b: the streamed RPG projects whose content outgrows the resident kernel-hi ceiling, so
// the dialogue overlay is relocated into the battle bank (generate.js streamworldDialogueBanked),
// plus the twin each is compared against -- the SAME project with every dialogue line except the
// observed NPC's shortened until it fits resident. Built on test/lib/streamedinventory.js's
// committed inventory, so "pinching" means Chris's real committed content, not synthetic filler.
//
// variant: 'nosave' | 'save' | 'move'. Each adds one placed "Observer" NPC on screen 0 whose event
// exercises every overlay consumer the variant can reach:
//   nosave  say, say, choice(Yes/No)           text open/type/clear/arrow, choice rows + cursor, close
//   save    the inventory's first NPC: say, save   the deferred-Save close (sw_dlg20_save_pending)
//   move    say, Move(player up), say          the deferred close-for-Move path
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import NES from '../../renderer/emulator/core/nes.js';
import { finishNamingIfOpen } from './naming.js';
import { buildCommittedInventory } from './streamedinventory.js';

export const GAME_STATE = 0x25; // engine/constants.asm
export const MAP_IS_STREAMED = 0xfe;
export const ST_GAMEPLAY = 0;
export const ST_TITLE = 3;
export const PLAYER_X = 0x10;
export const PLAYER_Y = 0x11;
export const BOX_STATE = 0x40;
export const ENT_X = 0x0310;
export const ENT_Y = 0x0318;
export const BOX_ENDWAIT = 6;
export const BOX_CHOICEWAIT = 8;
export const MAPPER_SHADOW = 0x35;
export const BTN = { A: 0, B: 1, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7 };

export const OBSERVER_X = 200;
// The game starts, and the Observer stands, on screen 3: the first screen of map ROW 1. Each map
// row is one 8 KB region and row 1's data sits in a different program bank from the battle code
// (row 0 shares the battle code's own 16 KB bank, in its other half). With the player on a row-1
// screen, sw_peek_byte -- which the close path's terrain read ends in -- restores the window to
// THAT screen's bank, not the overlay's, so the resident terrain routine's own re-select is the
// only thing that puts the battle bank back before the next overlay instruction. On a row-0 screen
// the restore lands on the battle bank by coincidence and a missing re-select would go unseen.
export const OBSERVER_SCREEN = 3;
export const OBSERVER_Y = 112;

const say = (text) => ({ op: 'say', text });

function observerCommands(variant) {
  if (variant === 'move') return [say('Hello there, traveler.'), { op: 'move', who: 'player', dir: 'up', dist: 16 }, say('Now go.')];
  return [say('Hello there, traveler.'), say('Second page of it.'), { op: 'choice', options: [{ text: 'Yes', commands: [] }, { text: 'No', commands: [] }] }];
}

// Phase 3a slice S1 raised kernel-lo by 21 bytes on every streamed Save project (OAM_BUSY 18 +
// the projection's setup call 3), and this board's kernel-lo lookup tables were 6 bytes under
// their ceiling with the committed inventory's 24 placed actors plus Save (8 bytes per actor). With
// S1 the same inventory needs 304 lookup bytes against 289 free -- the build is refused. Dropping the
// two highest-numbered placed actors (16 bytes) brings it to 288, the largest inventory that still
// builds: 22 placed actors with Save, where it was 24 before S1. A real capacity change, measured
// in handoff-next/s1-defer3/trimsave.mjs (k=1 -> 296 needed, still refused; k=2 -> builds).
//
// (a1), the mover parity gate (+7 kernel-lo on every streamed project, MOVER_PARITY_GATE_KERNEL_ALLOWANCE),
// took the free lookup bytes from 289 to 282 against the same 288 needed: one more placed actor (8 bytes)
// has to go. 21 placed actors with Save now, 24 before S1. The Move-probe fold of the kernel-lo round
// (engine/entities.asm, -42) frees nothing here: this inventory places no Move command, so the folded
// arms are not assembled into it. Chris ruled on 2026-09-30: the trim is accepted (the brief's stop-and-report
// for a test project that stops fitting was answered), and S1_SAVE_ACTORS_DROPPED stays 3.
//
// The entity-pass fix (update_entities' first-contact-wins game_state test, +4 kernel-lo on every RPG,
// BATTLE_KERNEL_ALLOWANCE_BY_MAPPER 229 -> 233 on UNROM 512) took the free lookup bytes from 282 to 278
// against the same 280 needed: one more placed actor (8 bytes) has to go. 20 placed actors with Save now.
// FLAGGED to the orchestrator in handoff-next/fix-battle-slot5-report.md -- the Chris ruling above was
// for a different slice, and this is another real capacity cost of the same kind.
//
// The streamed-save y gate (continue-y fix: save_check_valid's `cmp #240 / bcs / lda / jsr / beq`,
// STREAMWORLD_SAVE_RANGE_KERNEL_ALLOWANCE, +12 kernel-lo on every streamed Save build) took the free lookup
// bytes from 278 to 266 against the 272 the four-dropped inventory needs: one more placed actor (8 bytes)
// has to go. 19 placed actors with Save now. FLAGGED in handoff-next/fix-continue-y-report.md.
export const S1_SAVE_ACTORS_DROPPED = 5;

function dropActorsForS1KernelLo(p, count) {
  const placed = [];
  p.maps[0].screens.forEach((s, si) => (s.entities ?? []).forEach((e) => placed.push({ si, aid: e.actorId })));
  placed.sort((a, b) => b.aid - a.aid);
  for (const { si, aid } of placed.slice(0, count)) {
    const ents = p.maps[0].screens[si].entities;
    ents.splice(ents.findIndex((e) => e.actorId === aid), 1);
  }
  const dropped = new Set(placed.slice(0, count).map((d) => d.aid));
  // the highest actor ids are the last actors, so popping keeps every remaining id valid
  for (let i = p.sprites.actors.length - 1; dropped.has(i); i--) p.sprites.actors.pop();
}

/** The committed inventory + the Observer. `twin` shortens every OTHER say to "Hi.".
 * nosave/move add one placed Observer NPC. save reuses the inventory's own first NPC on the
 * Observer's screen (slot 0) and appends the Save command to its page: a 25th placed actor tips this board's
 * kernel-lo lookup tables over with Save live, a separate ceiling from the kernel-hi one this
 * slice moves, and the observed line is then one of the committed lines itself. */
export function buildPinching(variant = 'nosave', { twin = false } = {}) {
  const { project: p, sayCommands } = buildCommittedInventory('rpg');
  p.project.startScreen = OBSERVER_SCREEN;
  const screen = p.maps[0].screens[OBSERVER_SCREEN];
  let slot;
  if (variant === 'save') {
    p.project.titleMap = 0;
    p.project.titleScreen = 0;
    slot = 0;
    screen.entities[slot].x = OBSERVER_X;
    screen.entities[slot].y = OBSERVER_Y;
    screen.entities[slot].props.event.pages[0].commands.push({ op: 'save' });
  }
  if (variant === 'save') dropActorsForS1KernelLo(p, S1_SAVE_ACTORS_DROPPED);
  const observed = variant === 'save' ? screen.entities[0].props.event.pages[0].commands[0] : null;
  if (twin) for (const c of sayCommands) if (c !== observed) c.text = 'Hi.';
  if (variant !== 'save') {
    const actorId = p.sprites.actors.length;
    p.sprites.actors.push({ name: 'Observer', behavior: 'npc', hp: 1, damage: 0 });
    screen.entities = screen.entities ?? [];
    slot = screen.entities.length;
    screen.entities.push({
      actorId,
      x: OBSERVER_X,
      y: OBSERVER_Y,
      props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: observerCommands(variant) }] } }
    });
  }
  return { project: p, slot };
}

export function symbolAddr(symbols, label) {
  const m = symbols.match(new RegExp(`^${label}\\s+=\\s+\\$([0-9A-Fa-f]+)`, 'm'));
  assert.ok(m, `${label} should be a named symbol in game.fns`);
  return parseInt(m[1], 16);
}

export function hasSymbol(symbols, label) {
  return new RegExp(`^${label}\\s+=\\s+\\$`, 'm').test(symbols);
}

/** Builds `project` into a temp dir and boots it headlessly to ST_GAMEPLAY on the streamed map.
 * `mutate(project)` may install a project.code override (scratch mutant) before the build.
 * `romPatch(rom, { battleBank })`, when given, edits the assembled ROM bytes in place before they
 * are loaded (the benign-bank control: an unused bank made a copy of the battle bank). */
export async function buildAndBoot(project, { boot = true, romPatch = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-s10b-'));
  const lines = [];
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: (l) => lines.push(l) });
    const symbols = fs.readFileSync(built.symbolPath, 'utf8');
    const configInc = fs.readFileSync(path.join(dir, 'build/assets/config.inc'), 'utf8');
    const constantsAsm = fs.readFileSync(path.join(dir, 'build/constants.asm'), 'utf8');
    const rom = new Uint8Array(fs.readFileSync(built.romPath));
    if (romPatch) romPatch(rom, { battleBank: configValue(configInc, 'BATTLE_BANK') });
    const out = { lines, symbols, configInc, constantsAsm, rom, romPath: built.romPath };
    if (!boot) return out;
    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(rom);
    const mem = nes.cpu.mem;
    for (let i = 0; i < 10; i++) nes.frame();
    finishNamingIfOpen(nes);
    for (let i = 0; i < 60; i++) nes.frame();
    if (mem[GAME_STATE] === ST_TITLE) {
      nes.buttonDown(1, BTN.START);
      for (let i = 0; i < 3; i++) nes.frame();
      nes.buttonUp(1, BTN.START);
      for (let i = 0; i < 12; i++) nes.frame();
    }
    let frames = 0;
    while ((mem[GAME_STATE] !== ST_GAMEPLAY || mem[MAP_IS_STREAMED] !== 1) && frames < 200) {
      nes.frame();
      frames++;
    }
    assert.ok(frames < 200, 'cold boot must reach ST_GAMEPLAY on the streamed map within 200 frames');
    for (let i = 0; i < 100; i++) nes.frame();
    return { ...out, nes, mem, addrOf: (label) => symbolAddr(symbols, label) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function configValue(configInc, name) {
  const m = configInc.match(new RegExp(`^${name}\\s*=\\s*(\\$?[0-9A-Fa-f]+)`, 'm'));
  assert.ok(m, `${name} should be defined in config.inc`);
  return m[1].startsWith('$') ? parseInt(m[1].slice(1), 16) : parseInt(m[1], 10);
}

export function driveUntil(nes, mem, predicate, maxFrames = 400) {
  let frames = 0;
  while (!predicate(mem) && frames < maxFrames) {
    nes.frame();
    frames++;
  }
  return frames;
}

export function walkToEntity(nes, mem, slot, budget = 400) {
  for (let step = 0; step < budget; step++) {
    const targetX = mem[ENT_X + slot];
    const targetY = mem[ENT_Y + slot];
    const x = mem[PLAYER_X];
    const y = mem[PLAYER_Y];
    const buttons = [];
    if (x < targetX - 2) buttons.push(BTN.RIGHT);
    else if (x > targetX + 2) buttons.push(BTN.LEFT);
    if (y < targetY - 2) buttons.push(BTN.DOWN);
    else if (y > targetY + 2) buttons.push(BTN.UP);
    if (!buttons.length) return true;
    for (const button of buttons) nes.buttonDown(1, button);
    nes.frame();
    for (const button of buttons) nes.buttonUp(1, button);
  }
  return false;
}

export function press(nes, button, settle = 0) {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < settle; i++) nes.frame();
}

/** Real copies (.slice()) of the rendered nametable and attribute bytes -- a later in-place
 * mutation of the live typed arrays cannot make a stale snapshot equal a corrupted one. */
export function snapshotNametable(nes) {
  return nes.ppu.nameTable.map((t) => ({ tile: Array.from(t.tile.slice()), attrib: Array.from(t.attrib.slice()) }));
}

/** Walks to the Observer, then drives its conversation by state, snapshotting the rendered
 * nametable at every stable checkpoint. Deterministic in game state, not in frame counts, so the
 * banked ROM and its resident twin (whose overlay takes different cycle counts) can be compared
 * checkpoint by checkpoint. */
export function runConversation(nes, mem, slot, variant) {
  const checkpoints = [];
  assert.ok(walkToEntity(nes, mem, slot), 'the player must reach the Observer');
  press(nes, BTN.B, 1);
  let ends = 0;
  for (let guard = 0; guard < 900; guard++) {
    nes.frame();
    const st = mem[BOX_STATE];
    if (st === BOX_ENDWAIT) {
      for (let i = 0; i < 3; i++) nes.frame();
      checkpoints.push({ label: `endwait${ends++}`, nt: snapshotNametable(nes) });
      press(nes, BTN.B, 0);
    } else if (st === BOX_CHOICEWAIT) {
      for (let i = 0; i < 3; i++) nes.frame();
      checkpoints.push({ label: 'choice', nt: snapshotNametable(nes) });
      press(nes, BTN.A, 0);
    } else if (mem[GAME_STATE] === ST_GAMEPLAY && checkpoints.length > 0) {
      break;
    }
  }
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, `the ${variant} conversation never returned to gameplay`);
  for (let i = 0; i < 30; i++) nes.frame();
  checkpoints.push({ label: 'after', nt: snapshotNametable(nes) });
  return checkpoints;
}

// engine/constants.asm -- transcribed by hand (a test that parsed the file it checks proves nothing)
export const RAM = {
  mtptr_lo: 0x02,
  mtptr_hi: 0x03,
  sw_col_region: 0x05a3,
  sw_col_byte_lo: 0x05a4,
  sw_col_byte_hi: 0x05a5,
  sw_row_bank_base: 0x05a6,
  sw_base_bank: 0x05a7,
  st_active: 0x05b5,
  st_cur: 0x05b6,
  st_len: 0x05b7,
  win_col_screen: 0x05b1,
  win_col_local: 0x05b2,
  cam_nt: 0xb1,
  sw_dlg15_state: 0xf3
};

/** What the field's PRG window and metatile pointer ought to be, derived from the streamed-world
 * locator RAM alone (never read back from the live bank/mtptr being checked). */
export function expectedFieldWindow(mem) {
  const region = mem[RAM.sw_row_bank_base] + mem[RAM.sw_col_region] + mem[RAM.sw_base_bank];
  return {
    bank: region >> 1,
    ptr: ((region & 1 ? 0xa000 : 0x8000) + (mem[RAM.sw_col_byte_hi] << 8) + mem[RAM.sw_col_byte_lo]) & 0xffff
  };
}

/** Thrown from inside the CPU hook, before the offending instruction executes, when the first
 * instruction fetched after the resident terrain routine's rts is not banked overlay code with the
 * battle bank selected. Carrying the address and the selected bank is what lets a sabotage test
 * name the failure it expects instead of accepting any exception -- and because it fires at the
 * fetch, it cannot lose a race to the emulator crashing on whatever bytes the wrong bank holds. */
export class BankedReturnError extends Error {
  constructor({ pc, inBanked, bank, shadowBank }, battleBank) {
    super(
      `banked-return: the first instruction after sw_dlg_terrain_read's rts, at $${pc.toString(16)}, ` +
        `${inBanked ? 'is' : 'is not'} inside the banked overlay range and would run with PRG bank ${bank} selected ` +
        `(mapper_shadow bank ${shadowBank}); the battle bank ${battleBank} must be selected`
    );
    this.name = 'BankedReturnError';
    this.tag = 'banked-return';
    this.pc = pc;
    this.inBanked = inBanked;
    this.bank = bank;
    this.shadowBank = shadowBank;
    this.battleBank = battleBank;
  }
}

/** A CPU execution hook (the technique streamedceiling.test.js case 12 uses on set_screen_ptr):
 * wraps nes.cpu.emulate so every executed instruction's PC is visible BEFORE it runs.
 *
 * Records, for a relocated build:
 *  - bankedInstr / badFetch: instructions fetched from [bankedStart, bankedEnd) and every one that
 *    was NOT fetched from the $8000-$BFFF window with the battle bank selected (both the emulated
 *    mapper's own bank and mapper_shadow's bank bits);
 *  - dispatchHits: fetches of be_dlg_dispatch (the BE_DLG_* entry decode);
 *  - terrain: for each entry to the resident sw_dlg_terrain_read, whether the window really left
 *    the battle bank while it ran, and -- at the very next instruction after its rts, i.e. the
 *    first instruction fetched from the return address with the stack unwound -- whether that
 *    fetch is banked overlay code with the battle bank selected. That check THROWS a
 *    BankedReturnError from the hook itself (see above); returnPcs lists every such first fetch. */
export function installOverlayHook(nes, { bankedStart, bankedEnd, dispatch, terrainRead, battleBank }) {
  const stats = {
    bankedInstr: 0,
    badFetch: [],
    dispatchHits: 0,
    terrainReads: 0,
    terrainMoved: 0,
    terrainReturns: 0,
    returnPcs: [],
    badReturns: []
  };
  const original = nes.cpu.emulate.bind(nes.cpu);
  let armed = null;
  nes.cpu.emulate = () => {
    const cpu = nes.cpu;
    const mem = cpu.mem;
    const pc = (cpu.REG_PC + 1) & 0xffff;
    const bank = nes.mmap.prgBank;
    if (pc >= bankedStart && pc < bankedEnd) {
      stats.bankedInstr++;
      if (pc < 0x8000 || pc >= 0xc000 || bank !== battleBank || (mem[MAPPER_SHADOW] & 0x1f) !== battleBank) {
        stats.badFetch.push({ pc, bank, shadowBank: mem[MAPPER_SHADOW] & 0x1f });
      }
    }
    if (pc === dispatch) stats.dispatchHits++;
    if (armed) {
      if (bank !== battleBank) armed.moved = true;
      if (pc === armed.ret && cpu.REG_SP === armed.sp + 2) {
        stats.terrainReturns++;
        stats.returnPcs.push(pc);
        if (armed.moved) stats.terrainMoved++;
        const inBanked = pc >= bankedStart && pc < bankedEnd;
        armed = null;
        if (!inBanked || bank !== battleBank || (mem[MAPPER_SHADOW] & 0x1f) !== battleBank) {
          const bad = { pc, inBanked, bank, shadowBank: mem[MAPPER_SHADOW] & 0x1f };
          stats.badReturns.push(bad);
          throw new BankedReturnError(bad, battleBank);
        }
      }
    } else if (pc === terrainRead) {
      stats.terrainReads++;
      const ret = (mem[0x100 | ((cpu.REG_SP + 1) & 0xff)] + (mem[0x100 | ((cpu.REG_SP + 2) & 0xff)] << 8) + 1) & 0xffff;
      armed = { ret, sp: cpu.REG_SP, moved: false };
    }
    return original();
  };
  return stats;
}

/** Boots `project`, installs the overlay hook, runs the Observer's conversation and returns
 * everything a relocation check needs. */
export async function runHooked(variant, { twin = false, mutate = null, romPatch = null } = {}) {
  const { project, slot } = buildPinching(variant, { twin });
  if (mutate) mutate(project);
  const b = await buildAndBoot(project, { romPatch });
  const { nes, mem, symbols, configInc } = b;
  const banked = hasSymbol(symbols, 'sw_dlg_banked_start');
  const battleBank = configValue(configInc, 'BATTLE_BANK');
  const stats = banked
    ? installOverlayHook(nes, {
        bankedStart: symbolAddr(symbols, 'sw_dlg_banked_start'),
        bankedEnd: symbolAddr(symbols, 'sw_dlg_banked_end'),
        dispatch: symbolAddr(symbols, 'be_dlg_dispatch'),
        terrainRead: symbolAddr(symbols, 'sw_dlg_terrain_read'),
        battleBank
      })
    : null;
  const before = {
    bank: nes.mmap.prgBank,
    shadow: mem[MAPPER_SHADOW],
    ptr: mem[RAM.mtptr_lo] + (mem[RAM.mtptr_hi] << 8)
  };
  const checkpoints = runConversation(nes, mem, slot, variant);
  const after = {
    bank: nes.mmap.prgBank,
    shadow: mem[MAPPER_SHADOW],
    ptr: mem[RAM.mtptr_lo] + (mem[RAM.mtptr_hi] << 8),
    expected: expectedFieldWindow(mem)
  };
  return { banked, battleBank, stats, before, after, checkpoints, symbols, lines: b.lines, project, slot, nes, mem };
}
