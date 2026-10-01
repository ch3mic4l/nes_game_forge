// Scenes and an instruction-level recorder for test/unit/oambusy.test.js (phase 3a slice S1, the OAM-busy
// flag, plan section 3.5).
//
// What is here
//   - buildRom(project, { shippedDraw })  builds a project to ROM bytes + symbols. `shippedDraw` assembles the
//     SAME project with a Code Forge override of engine/streamworld.asm in which the cheap streamed projection
//     is switched off (the line `.if STREAM_PROJ_ENABLED` becomes `sw_ent_setup: rts` + `.if 0`), so the
//     shipped per-tile draw routine assembles instead. That routine is the slow one: eight 16-tile actors on a
//     streamed screen overrun the frame on it (F11b), which is the natural way to get an overrun frame.
//   - buildManifestRom(opts)  the streamed manifest scene (test/lua/sw_manifest_scene.mjs) as ROM bytes.
//   - installRecorder(nes, code)  wraps nes.ppu.sramDMA and nes.cpu.emulate and records, per frame, every OAM
//     DMA (256 bytes, whether it ran inside the NMI handler or was a manual one, oam_busy and cam_dirty at that
//     moment), every NMI entry, and the "complete shadow" snapshots the DMAs are judged against.
//
// The oracle a recorded DMA is judged against ("is this a complete frame?") is the set of shadows the engine
// itself declares complete, taken at the instruction where it does so:
//   - every arrival at main_loop_ready (the single point every frame reaches once its shadow is finished),
//   - the end of boot's own draw (boot_draw_done),
//   - the return of any draw_entities call made while oam_busy == 0 and cam_dirty == 0 (a landing / redraw
//     rebuilds the shadow under forced blank, outside the main-loop bracket, on purpose),
//   - the end of the streamed dialogue's open / close rebuilds (sw_dlg_lifecycle_open_end / _close_b_end,
//     bracketed by cam_dirty rather than oam_busy, on purpose),
//   - the content of every manual (non-NMI) OAM DMA (the position-jump guard and the Flash-Save resync DMA
//     under forced blank).
// A torn shadow (the player's tiles from this frame, the actors' from the last) is none of these.
//
// RAM addresses are transcribed by hand from engine/constants.asm; a test that read the file it is checking
// would prove nothing. Labels come from the built game.fns.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { buildScene } from '../lua/sw_manifest_scene.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// from engine/constants.asm
export const M = {
  PLAYER_X: 0x10,
  PLAYER_Y: 0x11,
  FRAME_CNT: 0x1b,
  OAM_IDX: 0x20,
  GAME_STATE: 0x25,
  VRAM_LEN: 0x3c,
  VRAM_READY: 0x3f,
  BOX_STATE: 0x40,
  PLAYER_HP: 0x4e,
  BT_PHASE: 0x53,
  CAM_DIRTY: 0xb5, // cam_far+1
  OAM_BUSY: 0xf8,
  MAP_IS_STREAMED: 0xfe,
  ENT_ACTIVE: 0x300,
  NM_LEN: 0x59a,
  SW_COL: 0x5a0,
  SW_ROW: 0x5a1,
  ST_ACTIVE: 0x5b5,
  OAM: 0x200
};
export const ST = { GAMEPLAY: 0, MENU: 1, DIALOG: 2, TITLE: 3, GAMEOVER: 4, BATTLE: 5, NAMEENTRY: 6 };
export const BTN = { A: 0, B: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7 };

const SHIPPED_ANCHOR = '  .if STREAM_PROJ_ENABLED\n\n; Phase 3a slice S1';

/** engine/streamworld.asm with the streamed projection off: the shipped per-tile routine assembles instead. */
export function shippedDrawOverride() {
  const src = fs.readFileSync(path.join(ROOT, 'engine/streamworld.asm'), 'utf8');
  if (src.split(SHIPPED_ANCHOR).length !== 2) throw new Error('oambusyscene: the STREAM_PROJ_ENABLED anchor in engine/streamworld.asm moved');
  return [{ name: 'streamworld.asm', text: src.replace(SHIPPED_ANCHOR, 'sw_ent_setup:\n  rts\n  .if 0\n\n; Phase 3a slice S1') }];
}

/** Build a project to { rom, code (label -> address), symbolText }. */
export async function buildRom(project, { shippedDraw = false } = {}) {
  if (shippedDraw) project.code = { overrides: shippedDrawOverride(), files: [] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-oambusy-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const symbolText = fs.readFileSync(built.symbolPath, 'utf8');
    return { rom: new Uint8Array(fs.readFileSync(built.romPath)), code: parseSymbolFile(symbolText), symbolText };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The manifest scene (see sw_manifest_scene.mjs for the options) as { rom, code }. */
export async function buildManifestRom({ shippedDraw = false, ...opts } = {}) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-oambusy-scene-'));
  try {
    const scene = await buildScene({ ...opts, outDir });
    if (!shippedDraw) return { rom: new Uint8Array(fs.readFileSync(scene.romPath)), code: scene.symbols.code };
    return await buildRom(scene.project, { shippedDraw: true });
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

export function bootNes(rom) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(rom);
  return nes;
}

const key = (mem, base = M.OAM) => Buffer.from(mem.subarray(base, base + 256)).toString('latin1');
const diffCount = (a, b) => { let n = 0; for (let i = 0; i < 256; i++) if (a.charCodeAt(i) !== b.charCodeAt(i)) n++; return n; };

/**
 * Wrap nes.cpu.emulate / nes.ppu.sramDMA. Everything is recorded on the returned object:
 *   dmas[]   { frame, key, inNmi, busy, camDirty, nmi }   nmi = index into nmis[] when inside the NMI handler
 *   nmis[]   { frame, busy, camDirty, forced, dmaBefore, dmaAfter, done }
 *   snaps    Map key -> Set of the labels that declared that shadow complete
 * `rec.run(n, each)` is the frame loop (it bumps rec.frame). `rec.on(label|addr, fn)` registers a PC hook
 * (called before the instruction at that address executes). `rec.force = { entry, index, once, cond }` (cond: only walks entered while cond() is true) arms a forced
 * NMI: at the `index`-th instruction (0 = the first; 'last' = the routine's own closing rts) executed inside the routine that starts at `entry`, an NMI
 * is taken instead of that instruction (the vendored core's own 0-delay `nmiImmediate`, the same mechanism
 * test/unit/camera.test.js uses). `rec.spanLen` is the instruction count of the last completed, unforced walk of
 * the armed routine, so a sweep can size itself. `trackSpan` turns on the protected-span sampler (T9c).
 */
export function installRecorder(nes, code, { trackSpan = false } = {}) {
  const cpu = nes.cpu;
  let mem = cpu.mem; // reloadROM() (a power cycle) allocates a fresh backing array: re-read it on every entry
  const original = cpu.emulate.bind(cpu);
  const addr = (k) => (typeof k === 'number' ? k : code[k]);
  const rec = {
    frame: 0, dmas: [], nmis: [], snaps: new Map(), armed: false, inNmi: false, trackSpan, span: false,
    spanViolations: [], spanViolationCount: 0, force: null, forcedLog: [], spanLen: 0, spanSamples: 0, hooks: new Map(), counts: { ready: 0, bodyStart: 0, drawRebuilds: 0 }
  };
  const need = (k) => { const a = addr(k); if (!Number.isFinite(a)) throw new Error(`oambusyscene: no symbol ${k}`); return a; };
  rec.on = (k, fn) => { const a = need(k); (rec.hooks.get(a) ?? rec.hooks.set(a, []).get(a)).push(fn); };
  rec.snap = (label) => { const k = key(mem); let s = rec.snaps.get(k); if (!s) rec.snaps.set(k, (s = new Set())); s.add(label); };

  const A = {
    nmi: need('nmi'), ready: need('main_loop_ready'), bodyStart: need('main_loop_body_start'), bootDone: need('boot_draw_done'),
    draw: need('draw_entities'), setUiEnd: need('oam_busy_set_ui_end'), setDrawEnd: need('oam_busy_set_draw_end'), clearEnd: need('oam_busy_clear_end')
  };
  const dlgHooks = ['sw_dlg_lifecycle_open_end', 'sw_dlg_lifecycle_close_b_end'].filter((k) => Number.isFinite(code[k])).map((k) => code[k]);

  // --- DMA capture
  const dma0 = nes.ppu.sramDMA.bind(nes.ppu);
  nes.ppu.sramDMA = (v) => {
    mem = cpu.mem;
    const k = key(mem, v * 0x100);
    rec.dmas.push({ labels: [...(rec.snaps.get(k) ?? [])], frame: rec.frame, key: k, inNmi: rec.inNmi, busy: mem[M.OAM_BUSY], camDirty: mem[M.CAM_DIRTY], nmi: rec.inNmi ? rec.nmis.length - 1 : -1 });
    if (!rec.inNmi && rec.armed) { let s = rec.snaps.get(k); if (!s) rec.snaps.set(k, (s = new Set())); s.add('manual DMA'); }
    return dma0(v);
  };

  const violate = (msg) => { rec.spanViolationCount++; if (rec.spanViolations.length < 20) rec.spanViolations.push(msg); };
  let walk = null; // { sp, count } while inside the armed routine
  let drawRetSp = -1;
  let after = null;
  let rti = false;
  let nextForced = false;
  cpu.emulate = function hooked() {
    mem = cpu.mem;
    const pc = (cpu.REG_PC + 1) & 0xffff;
    let forceNow = false;
    if (!rec.inNmi) {
      if (pc === A.bootDone) { rec.armed = true; rec.snap('boot_draw_done'); }
      if (pc === A.ready) { rec.counts.ready++; rec.snap('main_loop_ready'); }
      if (pc === A.bodyStart) {
        rec.counts.bodyStart++;
        if (trackSpan && rec.armed && mem[M.OAM_BUSY] !== 0) violate(`frame ${rec.frame}: oam_busy=${mem[M.OAM_BUSY]} at the top of a main-loop iteration`);
        rec.span = false;
      }
      if (trackSpan && rec.armed) {
        if (pc === A.setUiEnd || pc === A.setDrawEnd) rec.span = true;
        if (pc === A.clearEnd) rec.span = false;
        rec.spanSamples++;
        if (!rec.span && mem[M.OAM_BUSY] !== 0) violate(`frame ${rec.frame} pc=$${pc.toString(16)}: oam_busy=${mem[M.OAM_BUSY]} outside the draw span`);
      }
      if (pc === A.draw) drawRetSp = cpu.REG_SP;
      if (drawRetSp >= 0 && cpu.REG_SP === drawRetSp && pc !== A.draw && nes.mmap.load(pc) === 0x60) {
        // draw_entities is returning: a rebuild made outside both brackets is a declared-complete shadow
        drawRetSp = -1;
        if (mem[M.OAM_BUSY] === 0 && mem[M.CAM_DIRTY] === 0) { rec.counts.drawRebuilds++; after = () => rec.snap('draw_entities outside the brackets'); }
      }
      if (rec.armed && dlgHooks.includes(pc)) rec.snap('streamed dialogue rebuild');
      const fns = rec.hooks.get(pc);
      if (fns) for (const fn of fns) fn(pc);
      const f = rec.force;
      if (f) {
        if (!walk && pc === need(f.entry) && (!f.cond || f.cond())) walk = { sp: cpu.REG_SP, count: 0 };
        if (walk) {
          const atRts = nes.mmap.load(pc) === 0x60 && cpu.REG_SP === walk.sp;
          if (walk.count === f.index || (f.index === 'last' && atRts)) {
            forceNow = true;
            rec.forcedLog.push({ frame: rec.frame, pc, busy: mem[M.OAM_BUSY], camDirty: mem[M.CAM_DIRTY], gameState: mem[M.GAME_STATE], flat: mem[0x16], px: mem[M.PLAYER_X], py: mem[M.PLAYER_Y] });
            if (f.once !== false) rec.force = null;
            walk = null;
          } else if (nes.mmap.load(pc) === 0x60 && cpu.REG_SP === walk.sp) {
            rec.spanLen = walk.count + 1;
            walk = null;
          } else walk.count++;
        }
      }
    } else if (nes.mmap.load(pc) === 0x40) {
      rti = true;
    }
    if (!rec.inNmi && pc === A.nmi) {
      rec.inNmi = true;
      rec.nmis.push({ key: key(mem), frame: rec.frame, busy: mem[M.OAM_BUSY], camDirty: mem[M.CAM_DIRTY], forced: nextForced, dmaBefore: rec.dmas.length, dmaAfter: -1, done: false });
      nextForced = false;
    }
    if (forceNow) { cpu.nmiImmediate = true; nextForced = true; }
    const c = original();
    if (after) { const a = after; after = null; a(); }
    if (rec.inNmi && rti) {
      rti = false;
      rec.inNmi = false;
      const n = rec.nmis[rec.nmis.length - 1];
      n.dmaAfter = rec.dmas.length;
      n.done = true;
    }
    return c;
  };

  rec.restore = () => { cpu.emulate = original; nes.ppu.sramDMA = dma0; };
  /** Run `n` frames, calling `each(i)` before each (buttons are the caller's business). */
  rec.run = (n, each = null) => { for (let i = 0; i < n; i++) { if (each) each(i); nes.frame(); rec.frame++; } };
  /** NMI-handler DMAs that are not one of the declared-complete shadows. */
  rec.tornDmas = () => rec.dmas.filter((d) => d.inNmi && !rec.snaps.has(d.key));
  /** NMIs that took an OAM DMA while oam_busy was set at their entry. */
  rec.busyDmas = () => rec.nmis.filter((n) => n.busy !== 0 && n.dmaAfter > n.dmaBefore);
  /** Overrun frames whose shadow, at the NMI, was NOT a complete frame: the DMA the flag actually prevented. */
  rec.wouldTear = () => rec.skipped().filter((n) => !rec.snaps.has(n.key));
  /** NMI DMAs whose content had been declared complete by `label` at the moment of the DMA (and, when `only`, by nothing else). */
  rec.dmasVia = (label, only = false) => rec.dmas.filter((d) => d.inNmi && d.labels.includes(label) && (!only || d.labels.length === 1));
  /** NMIs that found oam_busy set and skipped their DMA: the overrun frames. */
  rec.skipped = () => rec.nmis.filter((n) => n.done && n.busy !== 0 && n.dmaAfter === n.dmaBefore);
  rec.nearest = (d) => { let best = 256; for (const k of rec.snaps.keys()) best = Math.min(best, diffCount(k, d.key)); return best; };
  return rec;
}

/** Hold exactly `buttons` on pad 1. */
export function press(nes, buttons) {
  for (const b of Object.values(BTN)) nes.buttonUp(1, b);
  for (const b of buttons) nes.buttonDown(1, b);
}
