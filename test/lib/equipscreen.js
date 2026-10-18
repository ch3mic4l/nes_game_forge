// The Equip screen's test driver (ROADMAP item 5, build commit C4; docs/design-equipment.md sections 4 and 10, rows 13 and 15).
//
// An equipment project (gearProject) built into its own mkdtemp directory, booted in the vendored jsnes core under Emulator.stepInstruction()
// so a test can look BETWEEN instructions: the stack pointer where ui_tick is entered, every instruction fetched from the switchable window
// while the field is on screen, and the peak of vram_len inside each frame. Addresses are engine/constants.asm's, written out by hand with
// a `; from` comment -- a test that read the file it is checking proves nothing.
//
// Sabotage controls are built the way a user would build them: a Code Forge override of one engine file (project.code.overrides), the
// stock text with exactly one asserted-unique edit, so a control never touches the repository and the engine it breaks is the engine
// that ships.

import fs from 'node:fs';
import path from 'node:path';
import { Emulator, BUTTON } from '../../renderer/emulator/runcontrol.js';
import { charToTile, ARROW_TILE } from '../../shared/font.js';
import { buildEquip, equipProject, equipStreamedProject, piece, plain, ROOT, WEAPON, ARMOR, ACCESSORY, EVERYONE, RAM } from './equipharness.js';

export { BUTTON, ROOT, WEAPON, ARMOR, ACCESSORY, EVERYONE, piece, plain, RAM };

// Engine RAM -- engine/constants.asm.
export const R = {
  PLAYER_X: 0x10, // player_x
  PAD_NEW: 0x18, // pad_new
  GAME_STATE: 0x25, // game_state
  PAUSED: 0x26, // paused
  INV_COUNT: 0x37, // inv_count
  INV_SEL: 0x38, // inv_sel
  VRAM_LEN: 0x3c, // vram_len
  BOX_STATE: 0x40, // box_state
  SCRIPT_ACTIVE: 0x49, // script_active
  BT_PHASE: 0x53, // bt_phase
  BT_ACTOR: 0x54, // bt_actor
  BT_SEL: 0x55, // bt_sel
  BT_SCROLL: 0x57, // bt_scroll
  BT_STR: 0x5a, // bt_str
  ENC_STEP: 0x61, // enc_step
  BT_FLEE: 0x60, // bt_flee
  BT_ESC: 0x66, // bt_esc
  BT_FROM_ENT: 0x68, // bt_from_ent
  BT_LEN: 0x6b, // bt_len
  CHR_R1: 0x74, // chr_r1
  SPLIT_MODE: 0x75, // split_mode
  PENDING_ENT: 0x7c, // pending_ent
  SPLIT_LOCK: 0x99, // split_lock
  BT_HURT_LEFT: 0xab, // bt_hurt_left
  BT_MISS_LEFT: 0xad, // bt_miss_left
  ENT_ACTIVE: 0x0300, // ent_active, @size=MAX_ENTITIES
  INV_ITEMS: 0x0378, // inv_items
  PC_IN_PARTY: 0x03b4, // pc_in_party
  MON_SLOT_ACTOR: 0x03bc, // mon_slot_actor
  MON_SLOT_ALIVE: 0x03c8, // mon_slot_alive
  BT_LIST: 0x03e4, // bt_list
  VRAM_BUF: 0x0400, // vram_buf
  EQ_DIRTY: 0x07d2, // eq_dirty
  EQ_CUR_SLOT: 0x07d3, // eq_cur_slot
  PC_EQUIP: 0x07d4, // pc_equip
  PC_EQ_ATK: 0x07e0 // pc_eq_atk
};
export const ST = { GAMEPLAY: 0, MENU: 1, DIALOG: 2, BATTLE: 5 }; // INPUT_STATES order
export const BP = { INTRO: 0, MENU: 1, WALK: 12, EQ_INTRO: 13, EQ_SLOTS: 14, EQ_LIST: 15 }; // engine/constants.asm BP_*
export const NO_ITEM = 0xff;
export const NO_ENTITY = 0xff;
export const MSG_ROW = 21; // engine/constants.asm
export const BATTLE_ROW_COUNT = 7; // the content rows: header, three slots, two stats, hint

/**
 * Tile index -> ASCII, for reading a nametable row back as text; the frame glyphs read as '#'. ARROW_TILE (the cursor, a down-pointing
 * triangle) reads as '>' only where a cursor lives (the slot and list rows, CURSOR_ROWS); anywhere else, a stat cell included, it reads as
 * 'v', so a stat separator that is the cursor glyph can never decode to the '>' the comparison glyph (EQ_CMP_TILE, the font's real '>') does.
 */
const TILE_TEXT = new Map();
for (let code = 0x20; code < 0x7f; code++) TILE_TEXT.set(charToTile(String.fromCharCode(code)), String.fromCharCode(code));
const CURSOR_ROWS = [1, 2, 3]; // the three slot rows (a pick list scrolls through the same three)

/**
 * sample-rpg (4 members, no wandering encounters) with: item 0 the Potion; ids 1-8 eight weapons (ATK 1..8, everyone); id 9 Mail
 * (armor, DEF 5, MDEF 2 so the MDEF stat is on); id 10 Ring (accessory, MAG 3); id 11 a Wand only member 1 may wear. `equip` is bound
 * to Select in gameplay and in the bag, B opens the bag, Start pauses (sample-rpg's own). Hit feedback and miss are on so the F1 stale
 * state exists.
 */
export async function gearProject({ mapper = 1, mutate } = {}) {
  const weapons = Array.from({ length: 8 }, (_, i) => piece(0, `Sword${i + 1}`, WEAPON, { atk: i + 1 }));
  return equipProject({
    mapper,
    items: [...weapons, piece(0, 'Mail', ARMOR, { def: 5, mdef: 2 }), piece(0, 'Ring', ACCESSORY, { mag: 3 }), piece(0, 'Wand', WEAPON, { atk: 2, usableBy: 0b0010 })],
    mutate: (p) => {
      p.input.states.gameplay.SELECT = 'equip';
      p.input.states.gameplay.B = 'item';
      p.input.states.menu.SELECT = 'equip';
      p.rpg.hitFeedback = true;
      p.rpg.miss = true;
      mutate?.(p);
    }
  });
}

/** A streamed RPG with the same gear (no hit feedback: the streamed fixture is tight), `equip` bound the same way. */
export function gearStreamedProject({ mapper = 30, mutate } = {}) {
  const weapons = Array.from({ length: 3 }, (_, i) => piece(0, `Sword${i + 1}`, WEAPON, { atk: i + 1 }));
  return equipStreamedProject({
    mapper,
    items: [{ id: 0, name: 'Tonic', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 20 } }, ...weapons],
    mutate: (p) => {
      p.input.states.gameplay.SELECT = 'equip';
      p.input.states.menu.SELECT = 'equip';
      mutate?.(p);
    }
  });
}

/**
 * Replace `project.code.overrides` with an edited copy of one engine file: the stock text with each [from, to] pair applied, `from`
 * required to occur exactly once. This is how a sabotage control is built without touching the repository.
 */
export function withEngineEdit(project, file, edits) {
  let text = fs.readFileSync(path.join(ROOT, 'engine', file), 'utf8');
  for (const [from, to] of edits) {
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`${file}: expected exactly one occurrence of ${JSON.stringify(from)}, found ${count}`);
    text = text.replace(from, to);
  }
  project.code = { ...(project.code ?? { files: [] }), overrides: [...(project.code?.overrides ?? []), { name: file, text }] };
  return project;
}

export class Screen {
  constructor(built) {
    this.built = built;
    this.emu = new Emulator({ onFrame: () => {} });
    this.emu.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
    this.mem = this.emu.nes.cpu.mem;
    this.sym = built.symbols;
    for (const name of ['ui_tick', 'battle_draw_sprites', 'main_loop_ready']) if (this.sym[name] === undefined) throw new Error(`${name} is not a symbol of this build`);
    this.windowFetches = 0; // instructions fetched from $8000-$BFFF while game_state is ST_GAMEPLAY
    this.battleFetches = 0; // instructions fetched from $8000-$BFFF while game_state is ST_BATTLE (the battle bank is mapped for the tick only)
    this.drawHits = 0; // executions of battle_draw_sprites (the part of battle_tick the exit's two pla skip)
    this.uiSp = null; // the stack pointer at the first ui_tick entry of the last frame that reached it (inside Equip: call_battle's depth)
    this.readySp = null; // the stack pointer where main_loop reaches main_loop_ready, once a frame: the main loop's own depth
    this.peaks = []; // per frame: { state, phase, max } -- the highest vram_len any instruction left behind
    this.trace = false;
  }

  /** Forget what boot executed (the reset code runs from the window before the first screen is drawn). */
  resetCounters() {
    this.windowFetches = 0;
    this.battleFetches = 0;
    this.drawHits = 0;
    this.peaks.length = 0;
    return this;
  }

  get state() {
    return this.mem[R.GAME_STATE];
  }
  get phase() {
    return this.mem[R.BT_PHASE];
  }

  /** One frame, instruction by instruction. */
  frame() {
    const { cpu } = this.emu.nes;
    let max = 0;
    let seenUi = false;
    for (;;) {
      const pc = cpu.REG_PC + 1;
      if (pc === this.sym.ui_tick && !seenUi) {
        seenUi = true;
        this.uiSp = cpu.REG_SP;
      }
      if (pc === this.sym.main_loop_ready) this.readySp = cpu.REG_SP;
      if (pc === this.sym.battle_draw_sprites) this.drawHits++;
      if (pc >= 0x8000 && pc < 0xc000) {
        if (this.mem[R.GAME_STATE] === ST.GAMEPLAY) this.windowFetches++;
        else if (this.mem[R.GAME_STATE] === ST.BATTLE) this.battleFetches++;
      }
      const done = this.emu.stepInstruction();
      if (this.mem[R.VRAM_LEN] > max) max = this.mem[R.VRAM_LEN];
      if (done) break;
    }
    this.peaks.push({ state: this.state, phase: this.phase, max });
    return max;
  }

  frames(n) {
    for (let i = 0; i < n; i++) this.frame();
  }

  /** Press for one frame, release, then `wait` more frames. */
  tap(button, wait = 3) {
    this.emu.setButton(button, true);
    this.frame();
    this.emu.setButton(button, false);
    this.frames(wait);
    this.drain();
  }

  /** Inside Equip a change repaints one row per frame; wait until every dirty bit has drained, so a text assertion sees the finished screen. */
  drain(budget = 20) {
    if (this.state !== ST.BATTLE || this.phase < BP.EQ_INTRO) return;
    for (let i = 0; i < budget && this.mem[R.EQ_DIRTY] !== 0; i++) this.frame();
    this.frames(1);
  }

  /** Boot to the field. */
  boot(frames = 60) {
    this.frames(frames);
    return this.resetCounters();
  }

  /** Run until `until()` holds or the budget runs out; returns whether it held. */
  runUntil(until, budget = 60) {
    for (let i = 0; i < budget && !until(); i++) this.frame();
    return until();
  }

  bag() {
    return Array.from(this.mem.slice(R.INV_ITEMS, R.INV_ITEMS + this.mem[R.INV_COUNT]));
  }
  setBag(ids) {
    ids.forEach((id, i) => (this.mem[R.INV_ITEMS + i] = id));
    this.mem[R.INV_COUNT] = ids.length;
  }
  worn() {
    return Array.from(this.mem.slice(R.PC_EQUIP, R.PC_EQUIP + 12));
  }
  setWorn(index, id) {
    this.mem[R.PC_EQUIP + index] = id;
  }
  window() {
    return Array.from(this.mem.slice(0x8000, 0xc000));
  }
  /** Recruit exactly these members. */
  recruit(...members) {
    for (let i = 0; i < 4; i++) this.mem[R.PC_IN_PARTY + i] = members.includes(i) ? 1 : 0;
  }

  /** One nametable row (content rows are MSG_ROW + n), columns 0-31, as text. */
  row(n) {
    const base = 0x2000 + (MSG_ROW + n) * 32;
    let out = '';
    for (let c = 0; c < 32; c++) {
      const tile = this.emu.nes.ppu.vramMem[base + c];
      out += tile === ARROW_TILE ? (CURSOR_ROWS.includes(n) ? '>' : 'v') : TILE_TEXT.get(tile) ?? '#';
    }
    return out;
  }
  /** One nametable row as raw tile indices (no decoding, so a glyph that merely looks the same cannot hide). */
  rawRow(n) {
    const base = 0x2000 + (MSG_ROW + n) * 32;
    return Array.from(this.emu.nes.ppu.vramMem.slice(base, base + 32));
  }
  rows() {
    return Array.from({ length: BATTLE_ROW_COUNT }, (_, n) => this.row(n));
  }

  /** Open Equip with the gameplay binding and settle until the slot rows are up and every row has drained. */
  openFromGameplay() {
    // The first frame after a screen is drawn belongs to the transition and drops the pad (settle_owed), so a press may need repeating.
    for (let i = 0; i < 4 && this.state !== ST.BATTLE; i++) this.tap(BUTTON.SELECT, 0);
    this.runUntil(() => this.phase === BP.EQ_SLOTS && this.mem[R.EQ_DIRTY] === 0, 40);
    this.frames(2);
    return this;
  }
  /** B opens the bag, Select there opens Equip. */
  openFromBag() {
    this.tap(BUTTON.B, 4);
    if (this.state !== ST.MENU) throw new Error(`B did not open the bag (state ${this.state})`);
    this.tap(BUTTON.SELECT, 0);
    this.runUntil(() => this.phase === BP.EQ_SLOTS && this.mem[R.EQ_DIRTY] === 0, 40);
    this.frames(2);
    return this;
  }
}

/** Build a project and wrap it. */
export async function screenFor(t, project) {
  return new Screen(await buildEquip(t, project));
}

export { buildEquip };
