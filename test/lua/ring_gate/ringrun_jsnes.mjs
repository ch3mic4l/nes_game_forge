// The jsnes recorder/interpreter for ringscene.mjs steps: boots a built ring ROM headlessly, runs the steps, and returns the records the judge
// decides. Addresses are transcribed by hand from engine/constants.asm (a test that read the file it checks proves nothing); a build whose
// constants.asm disagrees fails `checkAddresses`.
import fs from 'node:fs';
import NES from '../../../renderer/emulator/core/nes.js';
import { RING_ADDR } from './ringaddr.mjs';

const BTN = { A: 0, B: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, up: 4, down: 5, left: 6, right: 7, a: 0 };

export function bootRom(romPath) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  return nes;
}

/** Reads the live NTs and mirror aliases THROUGH the mirror table (jsnes keeps one physical slot per aliased NT). */
export function dumpVram(nes) {
  const ppu = nes.ppu;
  const out = {};
  for (const base of [0x2000, 0x2400, 0x2800, 0x2c00]) {
    const bytes = new Uint8Array(0x400);
    for (let i = 0; i < 0x400; i++) bytes[i] = ppu.vramMem[ppu.vramMirrorTable[base + i]];
    out[base] = bytes;
  }
  return out;
}

export function readState(nes) {
  const m = nes.cpu.mem;
  const A = RING_ADDR;
  return {
    game_state: m[A.game_state], sw_col: m[A.sw_col], sw_row: m[A.sw_row], player_x: m[A.player_x], player_y: m[A.player_y],
    cam_nt: m[A.cam_nt], cam_x_lo: m[A.cam_x_lo], cam_y_lo: m[A.cam_y_lo], st_active: m[A.st_active], vram_len: m[A.vram_len],
    box_state: m[A.box_state], msg_col: m[A.msg_col], msg_line: m[A.msg_line], map_is_streamed: m[A.map_is_streamed], ppuctrl_nt: nes.ppu.f_nTblAddress
  };
}
// the identity of the player's place, for the save/Continue comparison: both world coordinates and the owning map (cur_map and flat_screen live in
// RING_ADDR, which checkAddresses compares with the build's own equates, the chained cur_map one included)
const placeSnap = (nes) => { const m = nes.cpu.mem; const s = readState(nes); return { worldX: s.sw_col * 256 + s.player_x, worldY: s.sw_row * 240 + s.player_y, curMap: m[RING_ADDR.cur_map], flatScreen: m[RING_ADDR.flat_screen] }; };
const worldPos = (s, axis) => (axis === 'x' ? s.sw_col * 256 + s.player_x : s.sw_row * 240 + s.player_y);

/** Runs `steps`; returns [{label, kind, state, vram, frames}]. `onFrame(nes)` (optional) sees every frame (counters). */
export function runSteps(nes, steps, { onFrame } = {}) {
  let m = nes.cpu.mem; // a power cycle (reloadROM) replaces the CPU's memory array: `cycle` re-fetches it
  const A = RING_ADDR;
  const records = [];
  let frames = 0;
  // forced-blank accounting (the redraw entry scenes): a redraw disables rendering ($2001 & $18 == 0) and enables it again when it is done
  let blanks = 0, maskOn = false;
  const installHook = () => {
    const origWrite = nes.mmap.write.bind(nes.mmap);
    nes.mmap.write = (address, value) => {
      if (address === 0x2001) { const on = (value & 0x18) !== 0; if (maskOn && !on) blanks++; maskOn = on; }
      return origWrite(address, value);
    };
  };
  installHook();
  const frame = () => { nes.frame(); frames++; onFrame?.(nes); };
  const run = (n) => { for (let i = 0; i < n; i++) frame(); };
  const settle = (min = 30) => {
    let quiet = 0;
    for (let i = 0; i < 900 && quiet < min; i++) {
      frame();
      quiet = m[A.st_active] === 0 && m[A.vram_len] === 0 ? quiet + 1 : 0;
    }
  };
  const record = (label, kind) => records.push({ label, kind, state: readState(nes), vram: dumpVram(nes), frames });
  const tapA = () => { nes.buttonDown(1, BTN.A); frame(); nes.buttonUp(1, BTN.A); run(4); };
  // A dialogue: wait for the box to be typing, record a mid-typing stage once >= 3 glyphs are down, record the typed (page-wait/end-wait)
  // state, close it with A, settle, record the closed terrain. A stage never reached is simply absent: coverage fails on the count.
  const dialog = (label) => {
    let typing = false;
    for (let i = 0; i < 600 && ![3, 6].includes(m[A.box_state]); i++) {
      if (!typing && m[A.box_state] === 2 && m[A.msg_col] >= 3) { record(`${label}:typing`, 'dlg-typing'); typing = true; }
      frame();
    }
    for (let i = 0; i < 30 && m[A.vram_len] !== 0; i++) frame(); // the typed state is recorded once its last packet (the page arrow) has drained
    record(`${label}:open`, 'dlg-open');
    for (let i = 0; i < 60 && m[A.game_state] !== 0; i++) { tapA(); run(20); }
    if (m[A.game_state] !== 0) throw new Error(`dialogue ${label} never closed`);
    settle();
    record(`${label}:closed`, 'settled');
  };
  for (const step of steps) {
    if (step.op === 'boot') {
      for (let i = 0; i < 400 && !(m[A.map_is_streamed] === 1 && frames > 30); i++) frame();
      if (m[A.map_is_streamed] !== 1) throw new Error('never reached a streamed map');
      if (m[A.game_state] === 2) dialog('boot'); else settle();
    } else if (step.op === 'check') {
      // a dialogue that nobody expected is handled like any other (so the run goes on) and judged: it is one dialogue too many for coverage
      if (m[A.game_state] === 2) dialog(`${step.label}~unexpected`);
      settle();
      record(step.label, 'settled');
    } else if (step.op === 'hold') {
      const b = BTN[step.btn];
      let still = 0, last = worldPos(readState(nes), step.axis), why = 'max';
      nes.buttonDown(1, b);
      for (let i = 0; i < step.max; i++) {
        frame();
        if (m[A.game_state] === 2) { nes.buttonUp(1, b); dialog(`${step.axis}~${worldPos(readState(nes), step.axis)}`); nes.buttonDown(1, b); }
        const p = worldPos(readState(nes), step.axis);
        if (step.gte !== undefined && p >= step.gte) { why = 'target'; break; }
        if (step.lte !== undefined && p <= step.lte) { why = 'target'; break; }
        still = p === last ? still + 1 : 0; last = p;
        if (still > 40) { why = 'blocked'; break; }
      }
      nes.buttonUp(1, b);
      records.push({ label: `hold:${step.btn}:${step.gte ?? step.lte}`, kind: 'hold', hold: { btn: step.btn, axis: step.axis, gte: step.gte, lte: step.lte, reached: why === 'target', why, pos: worldPos(readState(nes), step.axis) } });
    } else if (step.op === 'to') {
      // fine positioning: single-frame taps toward an EXACT world position (the walking speed is fractional, so a held button can step over a pixel)
      const bf = BTN[step.fwd], bb = BTN[step.back];
      let ok = false;
      for (let i = 0; i < step.max; i++) {
        const p = worldPos(readState(nes), step.axis);
        if (p === step.target) { ok = true; break; }
        const b = p < step.target ? bf : bb;
        nes.buttonDown(1, b); frame(); nes.buttonUp(1, b); run(3);
      }
      records.push({ label: `hold:${step.btn}:${step.target}`, kind: 'hold', hold: { btn: step.btn, axis: step.axis, reached: ok, why: ok ? 'target' : 'max', pos: worldPos(readState(nes), step.axis) } });
    } else if (step.op === 'lag') {
      // the position-jump guard: the player stays put, the live window origin is moved `dc` blocks away from where the camera wants it (the guard
      // fires at a lag >= 6 -- an organic desync of that size cannot happen in ordinary play); everything after the injection is the guard's own run
      const sc = step.axis === 'x' ? A.win_col_screen : A.win_row_screen, lo = step.axis === 'x' ? A.win_col_local : A.win_row_local, u = step.axis === 'x' ? 16 : 15;
      const cur = m[sc] * u + m[lo];
      // only a window already off its plan (a faulted run) can need the other sign: the lag keeps its size, the other way
      const nb = cur + step.dc >= 0 ? cur + step.dc : cur - step.dc;
      if (nb < 0) throw new Error(`lag ${step.dc} drives the window origin below 0`);
      m[sc] = Math.floor(nb / u); m[lo] = nb % u;
      const b0 = blanks;
      for (let i = 0; i < 200 && !(blanks > b0 && maskOn); i++) frame();
      records.push({ label: `hold:lag:${step.target}`, kind: 'hold', hold: { btn: 'lag', entry: 'guard', minBlanks: 1, blanks: blanks - b0, reached: blanks > b0 && maskOn, why: blanks > b0 ? 'target' : 'no-blank', pos: worldPos(readState(nes), step.axis) } });
    } else if (step.op === 'jumpwait') {
      // a real door: walk until the position jumps (the warp's landing), then wait for the redraw to finish
      const b = BTN[step.btn];
      const b0 = blanks;
      let prev = worldPos(readState(nes), step.axis), why = 'max';
      nes.buttonDown(1, b);
      for (let i = 0; i < step.max; i++) {
        frame();
        if (m[A.game_state] === 2) { nes.buttonUp(1, b); dialog(`${step.axis}~warp`); nes.buttonDown(1, b); }
        const p = worldPos(readState(nes), step.axis);
        if (Math.abs(p - prev) >= 40) { why = 'target'; break; }
        prev = p;
      }
      nes.buttonUp(1, b);
      for (let i = 0; i < 300 && !(blanks > b0 && maskOn); i++) frame();
      records.push({ label: `hold:jump:${step.target}`, kind: 'hold', hold: { btn: 'jump', entry: 'warp', minBlanks: 1, blanks: blanks - b0, reached: why === 'target' && blanks > b0, why, pos: worldPos(readState(nes), step.axis) } });
    } else if (step.op === 'battle') {
      // a real encounter: walk into the monster, then fight with A until the world is back
      const b = BTN[step.btn];
      const b0 = blanks;
      let why = 'max';
      nes.buttonDown(1, b);
      for (let i = 0; i < step.max && m[A.game_state] !== 5; i++) frame();
      nes.buttonUp(1, b);
      let slot = -1; // bt_from_ent on the very frame the battle began: the entity slot that made contact
      if (m[A.game_state] === 5) {
        slot = m[A.bt_from_ent];
        why = 'fought';
        for (let i = 0; i < 400 && m[A.game_state] === 5; i++) { nes.buttonDown(1, BTN.A); frame(); nes.buttonUp(1, BTN.A); run(10); }
        if (m[A.game_state] === 5) why = 'never-ended';
      }
      for (let i = 0; i < 300 && !maskOn; i++) frame();
      records.push({ label: `hold:battle:${step.target}`, kind: 'hold', hold: { btn: 'battle', entry: 'battle', minBlanks: 2, blanks: blanks - b0, reached: why === 'fought' && blanks - b0 >= 2, why, pos: worldPos(readState(nes), step.axis), slot, ...(step.slot !== undefined ? { expectSlot: step.slot } : {}) } });
    } else if (step.op === 'shake') {
      // a real horizontal Shake: walk into a touch NPC whose event is `Shake n`, release when the shake is running, record every QUIET frame of it
      // (strip idle, queue drained: the live NTs are then final, so they are judged against the oracle), until it has ended
      const b = BTN[step.btn];
      let why = 'max';
      nes.buttonDown(1, b);
      for (let i = 0; i < step.max; i++) {
        frame();
        if (m[A.game_state] === 2) { nes.buttonUp(1, b); dialog(`${step.axis}~shake`); nes.buttonDown(1, b); }
        if (m[A.shake_left] > 0) { why = 'target'; break; }
      }
      nes.buttonUp(1, b);
      let quiet = 0, ended = false;
      for (let i = 0; i < 200; i++) {
        if (m[A.shake_left] === 0) { ended = true; break; }
        if (m[A.st_active] === 0 && m[A.vram_len] === 0 && quiet < 12) { record(`shake:${step.label}:f${quiet}`, 'shake-frame'); quiet++; }
        frame();
      }
      records.push({ label: `hold:shake:${step.label}`, kind: 'hold', hold: { btn: 'shake', axis: step.axis, entry: 'shake', minBlanks: 8, blanks: quiet, reached: why === 'target' && ended && quiet >= 8, why: why === 'target' && !ended ? 'never-ended' : why, pos: worldPos(readState(nes), step.axis) } });
    } else if (step.op === 'title') {
      // the title screen: START begins the game on the streamed start map
      for (let i = 0; i < 90; i++) frame();
      if (m[A.game_state] !== 3) throw new Error(`no title screen (game_state ${m[A.game_state]})`);
      for (let r = 0; r < 40 && !(m[A.map_is_streamed] === 1 && m[A.game_state] === 0); r++) { nes.buttonDown(1, BTN.START); frame(); nes.buttonUp(1, BTN.START); run(15); }
    } else if (step.op === 'save') {
      // walk into a Save NPC; the save is witnessed by its own medium: a forced blank (the flash commit) or a change in the battery RAM
      const b = BTN[step.btn];
      const ram0 = step.battery ? Array.from(m.slice(0x6000, 0x8000)) : null;
      const b0 = blanks;
      const changed = () => (step.battery ? m.slice(0x6000, 0x8000).some((v, i) => v !== ram0[i]) : blanks > b0);
      let saved = false;
      nes.buttonDown(1, b);
      for (let i = 0; i < step.max && !saved; i++) { frame(); saved = changed(); }
      nes.buttonUp(1, b);
      settle();
      records.push({ label: `hold:save:${step.target}`, kind: 'hold', hold: { btn: 'save', axis: step.axis, entry: 'save', minBlanks: 1, blanks: saved ? 1 : 0, reached: saved, why: saved ? 'target' : 'no-save', pos: worldPos(readState(nes), step.axis), place: placeSnap(nes) } });
    } else if (step.op === 'cycle') {
      // a power cycle (battery RAM kept on the battery boards; the flash sector is the ROM image itself) and Continue from the title
      const ram = step.battery ? m.slice(0x6000, 0x8000) : null;
      const placeBefore = placeSnap(nes);
      nes.reloadROM();
      m = nes.cpu.mem;
      if (ram) m.set(ram, 0x6000);
      installHook();
      blanks = 0; maskOn = false;
      for (let i = 0; i < 90; i++) frame();
      let ok = false, why = m[A.game_state] === 3 ? 'no-continue' : 'no-title';
      const b0 = blanks;
      for (let r = 0; r < 20 && m[A.game_state] === 3 && !ok; r++) {
        nes.buttonDown(1, BTN.SELECT); frame(); nes.buttonUp(1, BTN.SELECT);
        for (let i = 0; i < 90 && !ok; i++) { frame(); ok = m[A.game_state] === 0 && m[A.map_is_streamed] === 1 && blanks > b0 && maskOn; }
      }
      if (ok) why = 'target';
      records.push({ label: `hold:cycle:${step.target}`, kind: 'hold', hold: { btn: 'cycle', axis: step.axis, entry: 'continue', minBlanks: 1, blanks: blanks - b0, reached: ok, why, pos: worldPos(readState(nes), step.axis), place: placeSnap(nes), placeBefore } });
    } else if (step.op === 'dialog') {
      if (m[A.game_state] === 2) dialog(step.label);
    } else throw new Error(`unknown step ${JSON.stringify(step)}`);
  }
  return records;
}
