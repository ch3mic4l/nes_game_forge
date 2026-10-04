// Phase 3a slice S3a: the shared test and measurement infrastructure for a streamed player `Move`
// (handoff-next/streamed-worlds-phase3a-plan.md §4.1, §7 S3a): a terrain whose every block is
// distinguishable, a boot helper that keeps the symbol table, a per-frame reader of the camera,
// the published scroll, the strip state and the walk accumulators, a torus terrain check, and a PC
// trace. Every address is transcribed by hand from engine/constants.asm (a test reading the file it
// checks proves nothing); each carries its source.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import NES from '../../renderer/emulator/core/nes.js';
import { createStreamedProject } from './streamedproject.js';

// from engine/constants.asm
export const A = {
  PLAYER_X: 0x10, PLAYER_Y: 0x11, GAME_STATE: 0x25, MAP_IS_STREAMED: 0xfe, CUR_SPEED: 0x29,
  MV_WHO: 0x94, MV_DIR: 0x95, MV_LEFT: 0x96, MV_STEP: 0x97, // mv_who = sv_len+1, then +1 each (mv_left = $96 is pinned by streamedmove.test.js)
  MOVING: 0x15, SCREEN_FRESH: 0x7d, FLAT_SCREEN: 0x16,
  SW_COL: 0x5a0, SW_ROW: 0x5a1, SW_GRID_W: 0x5a9, SW_GRID_H: 0x5aa,
  SW_CAM_X_LO: 0x35c, SW_CAM_X_HI: 0x35d, SW_CAM_Y_LO: 0x35e, SW_CAM_Y_HI: 0x35f,
  SW_WALK_ACC_X: 0x3d8, SW_WALK_ACC_Y: 0x3d9,
  WIN_COL_SCREEN: 0x5b1, WIN_COL_LOCAL: 0x5b2, WIN_ROW_SCREEN: 0x5b3, WIN_ROW_LOCAL: 0x5b4,
  ST_ACTIVE: 0x5b5, ST_CUR: 0x5b6, ST_LEN: 0x5b7
};
export const SW_SPEED_SUB_X = 128; // engine/streamworld.asm
export const SW_SPEED_SUB_Y = 112;
export const DIR = { down: 0, up: 1, left: 2, right: 3 }; // engine/constants.asm DIR_*
export const GRID_W = 3;
export const GRID_H = 2;
const SOLID_ID = 24;

/** One frame of sw_walk_step_x/y, reimplemented from its documented shape. */
export const walkStep = (acc, sub) => ({ step: acc + sub >= 256 ? 2 : 1, acc: (acc + sub) & 0xff });

/** `n` ticks of the accumulator from a given residue. */
export function simulateAcc(sub, acc0, n) {
  const out = [];
  let acc = acc0;
  for (let i = 0; i < n; i++) {
    const r = walkStep(acc, sub);
    out.push(r);
    acc = r.acc;
  }
  return out;
}

/** The accumulator residue that makes the FIRST tick a two-pixel step. */
export const doubleFirstResidue = (sub) => 256 - sub;

/**
 * A streamed project whose every metatile block is distinguishable (id 1..23 from the block's own
 * position; tiles id*4+q), so a strip that landed the wrong block, the wrong row or the wrong
 * screen reads as a different tile. Metatile 24 is solid. One NPC on `moveScreen` runs `commands`
 * on enter. `solids` is a list of {screen, offset} painted with the solid metatile.
 */
export function terrainProject({ gridW = GRID_W, gridH = GRID_H, commands, startX, startY, moveScreen = 0, solids = [], gameType = 'action' }) {
  const project = createStreamedProject({ gameType, gridW, gridH, moveCommands: commands, moveScreen });
  for (let id = 1; id <= SOLID_ID; id++) {
    project.metatiles[id] = project.metatiles[id] ?? { id, name: `Metatile ${id}`, tiles: [0, 0, 0, 0], palette: 0, collision: 'open' };
    project.metatiles[id].tiles = [id * 4, id * 4 + 1, id * 4 + 2, id * 4 + 3];
    project.metatiles[id].palette = id & 3;
    project.metatiles[id].collision = id === SOLID_ID ? 'solid' : 'open';
  }
  const map = project.maps[0];
  map.screens.forEach((screen, s) => {
    const col = s % gridW;
    const row = Math.floor(s / gridW);
    for (let i = 0; i < screen.metatiles.length; i++) screen.metatiles[i] = 1 + ((col * 5 + row * 11 + i * 7 + (i >> 4) * 3) % 23);
  });
  for (const { screen, offset } of solids) map.screens[screen].metatiles[offset] = SOLID_ID;
  project.project.startScreen = moveScreen;
  if (Number.isFinite(startX)) project.project.startX = startX;
  if (Number.isFinite(startY)) project.project.startY = startY;
  const entity = map.screens[moveScreen].entities.find((e) => e.props?.event);
  entity.props.trigger = 'enter';
  return project;
}

/** Offsets of a whole metatile row / column of one screen. */
export const rowOffsets = (row) => Array.from({ length: 16 }, (_, c) => row * 16 + c);
export const colOffsets = (col) => Array.from({ length: 15 }, (_, r) => r * 16 + col);

/** Builds the project, boots the ROM past the landing, and returns { nes, mem, syms, project }. */
export async function buildBoot(project, { root } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamedmovecam-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const syms = {};
    for (const m of fs.readFileSync(path.join(dir, 'build/game.fns'), 'utf8').matchAll(/^(\w+)\s*=\s*\$([0-9A-Fa-f]+)/gm)) syms[m[1]] = parseInt(m[2], 16);
    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
    const mem = nes.cpu.mem;
    let frames = 0;
    while ((mem[A.GAME_STATE] !== 0 || mem[A.MAP_IS_STREAMED] !== 1) && frames < 200) {
      nes.frame();
      frames++;
    }
    assert.ok(frames < 200, 'cold boot must reach ST_GAMEPLAY on the streamed map');
    return { nes, mem, syms, project };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs frames until mv_left first reads nonzero (no tick has run yet). Returns the frames taken, or -1. */
export function awaitMoveStart(nes, frames = 80) {
  const mem = nes.cpu.mem;
  let i = 0;
  for (; i < frames && mem[A.MV_LEFT] === 0; i++) nes.frame();
  return mem[A.MV_LEFT] !== 0 ? i : -1;
}

// ------------------------------------------------------------------ per-frame state

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Independent expectation of the camera origin: docs/design-streamed-worlds.md's one formula per axis. */
export function expectedOrigin(mem, gridW, gridH) {
  const worldX = mem[A.SW_COL] * 256 + mem[A.PLAYER_X];
  const worldY = mem[A.SW_ROW] * 240 + mem[A.PLAYER_Y];
  return { x: clamp(worldX - 120, 0, (gridW - 1) * 256), y: clamp(worldY - 112, 0, (gridH - 1) * 240) };
}

/** The scroll the PPU holds, as a torus position (x 0-511, y 0-479). */
export const ppuScroll = (nes) => ({
  x: nes.ppu.regH * 256 + nes.ppu.regHT * 8 + nes.ppu.regFH,
  y: nes.ppu.regV * 240 + nes.ppu.regVT * 8 + nes.ppu.regFV
});

/** The torus scroll a world-pixel camera origin publishes (parity rule: ring position is a function of screen parity + local pixel). */
export const torusOf = (origin) => ({
  x: ((origin.x >> 8) & 1) * 256 + (origin.x & 255),
  y: (Math.floor(origin.y / 240) & 1) * 240 + (origin.y % 240)
});

/** What the runtime holds this frame, read straight from RAM. */
export function snapshot(nes, gridW, gridH) {
  const mem = nes.cpu.mem;
  return {
    px: mem[A.PLAYER_X], py: mem[A.PLAYER_Y], col: mem[A.SW_COL], row: mem[A.SW_ROW], flat: mem[A.FLAT_SCREEN],
    left: mem[A.MV_LEFT], step: mem[A.MV_STEP], moving: mem[A.MOVING],
    accX: mem[A.SW_WALK_ACC_X], accY: mem[A.SW_WALK_ACC_Y],
    originX: mem[A.SW_CAM_X_LO] | (mem[A.SW_CAM_X_HI] << 8), originY: mem[A.SW_CAM_Y_LO] | (mem[A.SW_CAM_Y_HI] << 8),
    expected: expectedOrigin(mem, gridW, gridH),
    scroll: ppuScroll(nes),
    stActive: mem[A.ST_ACTIVE], stCur: mem[A.ST_CUR],
    winCol: mem[A.WIN_COL_SCREEN] * 16 + mem[A.WIN_COL_LOCAL],
    winRow: mem[A.WIN_ROW_SCREEN] * 15 + mem[A.WIN_ROW_LOCAL]
  };
}

/** The four tile ids the project says block (bx, by) (world 16-px blocks) must show. */
export function expectedTiles(project, gridW, gridH, bx, by) {
  const sc = bx >> 4;
  const sr = Math.floor(by / 15);
  let id = project.maps[0].fillMetatileId ?? 0;
  if (bx >= 0 && by >= 0 && sc < gridW && sr < gridH) id = project.maps[0].screens[sr * gridW + sc].metatiles[(by % 15) * 16 + (bx & 15)];
  const t = project.metatiles[id].tiles;
  return [t[0], t[1], t[2], t[3]];
}

/** The four tile ids the PPU's nametables hold for block (bx, by), by the parity rule's torus position. */
export function nametableTiles(nes, bx, by) {
  const tc = (((bx >> 4) & 1) * 16 + (bx & 15)) * 2;
  const tr = ((Math.floor(by / 15) & 1) * 15 + (by % 15)) * 2;
  const read = (r, c) => nes.ppu.nameTable[nes.ppu.ntable1[(r >= 30 ? 2 : 0) + (c >= 32 ? 1 : 0)]].tile[(r % 30) * 32 + (c % 32)];
  return [read(tr, tc), read(tr, tc + 1), read(tr + 1, tc), read(tr + 1, tc + 1)];
}

/**
 * Terrain-contained check: every block the 256x240 viewport at world `origin` overlaps shows the
 * terrain the project says is there. Returns the list of mismatching blocks (empty = contained).
 */
export function viewportMismatches(nes, project, gridW, gridH, origin) {
  const bad = [];
  for (let by = Math.floor(origin.y / 16); by <= Math.floor((origin.y + 239) / 16); by++) {
    for (let bx = origin.x >> 4; bx <= (origin.x + 255) >> 4; bx++) {
      const want = expectedTiles(project, gridW, gridH, bx, by);
      const got = nametableTiles(nes, bx, by);
      if (want.some((t, i) => t !== got[i])) bad.push({ bx, by, want, got });
    }
  }
  return bad;
}

// ------------------------------------------------------------------ PC trace

/**
 * Wraps cpu.emulate and calls onPc(pc) before every instruction (REG_PC is one less than the
 * instruction address until the opcode fetch -- test/lib/pjgguard.js's convention). Returns unwatch().
 */
export function tracePc(nes, onPc) {
  const original = nes.cpu.emulate.bind(nes.cpu);
  nes.cpu.emulate = function traced() {
    onPc((nes.cpu.REG_PC + 1) & 0xffff);
    return original();
  };
  return () => { nes.cpu.emulate = original; };
}

/** The half-open address ranges of the named routine labels: [start, next label's address). */
export function spanOf(syms, name, endName) {
  assert.ok(syms[name] !== undefined, `no symbol ${name}`);
  const end = endName ? syms[endName] : Math.min(...Object.values(syms).filter((a) => a > syms[name]));
  assert.ok(end > syms[name], `${name}..${endName} is empty`);
  return [syms[name], end];
}

// ------------------------------------------------------------------ probe ownership (S3a fix round 1, T6)

/**
 * Who asked for the terrain read, during every tick of a scripted Move (review 1, required change 3).
 *
 * Every neighbour-tile read ends in `lda mt_collision,y` (probe_type, sw_terrain_or_fill_solid_type). Naming a retired routine
 * cannot find a differently named duplicate that calls those helpers, so this follows the CALLER instead. A shadow call stack
 * (one frame per executed JSR, keyed by the hardware stack pointer so an interrupt or a stack-juggling dispatch cannot unbalance
 * it) gives each probe-helper entry and each collision-table read its ORIGIN: the innermost live frame whose call site is outside
 * the probe-helper family. A tick is the window from `move_tick`'s entry until the stack pointer rises above its entry value.
 *
 * `unwatch()` stops the trace; `report()` returns
 *   ticks               move_tick entries seen
 *   entries[tick]       [{ entry, origin }] one per call INTO the helper family from outside it (the jmp/jsr chain inside is not counted)
 *   reads               [{ tick, reader, origin }] one per collision-table read, `reader` = the executing instruction's PC
 * and `ownershipViolations(report)` lists everything the shared-driver contract forbids: a probe whose origin is not inside the
 * shared driver (sw_pr_calc .. sw_pstep_end), a collision read executed by code outside the helper family and the driver, and a
 * tick that probes other than twice (the walking rule: both leading corners, every granted step on open terrain).
 */
export function probeOwnership(nes, syms) {
  const need = (n) => { assert.ok(syms[n] !== undefined, `no symbol ${n}`); return syms[n]; };
  const FAMILY = [
    ['sw_hazard_probe_type', 'sw_hazard_probe_type_end'], ['sw_hazard_probe_solid', 'sw_hazard_probe_solid_done'],
    ['sw_terrain_or_fill', 'sw_tof_fill'], ['sw_terrain_or_fill_solid_type', 'sw_tofst_solid'], ['sw_peek_byte', 'sw_terrain_or_fill'],
    ['probe_type', 'probe_solid_done']
  ].map(([a, b]) => [need(a), need(b)]);
  const ENTRIES = new Set(['sw_hazard_probe_solid', 'sw_hazard_probe_solid_cross', 'sw_hazard_probe_type', 'sw_hazard_probe_cross', 'sw_terrain_or_fill', 'sw_terrain_or_fill_solid_type', 'sw_peek_byte', 'probe_solid', 'probe_type'].map(need));
  const [drvLo, drvHi] = [need('sw_pr_calc'), need('sw_pstep_end')];
  assert.ok(drvLo < drvHi, 'the shared driver span');
  const [mtLo, mtHi] = spanOf(syms, 'mt_collision');
  const inFamily = (pc) => FAMILY.some(([a, b]) => pc >= a && pc < b);
  const inDriver = (pc) => pc >= drvLo && pc < drvHi;
  const cpu = nes.cpu;
  const realLoad = nes.mmap.load.bind(nes.mmap);
  const peek = (a) => (a < 0x2000 ? cpu.mem[a & 0x7ff] : realLoad(a));
  const frames = [];
  let winSp = null;
  let tick = 0;
  let lastPc = 0;
  const entries = [];
  const reads = [];
  const originOf = () => {
    for (let i = frames.length - 1; i >= 0; i--) if (!inFamily(frames[i].site)) return frames[i].site;
    return lastPc; // no live frame outside the family: the executing code itself asked
  };
  const unwatchPc = tracePc(nes, (pc) => {
    lastPc = pc;
    const sp = cpu.REG_SP;
    while (frames.length && frames[frames.length - 1].sp <= sp) frames.pop();
    if (winSp !== null && sp > winSp) winSp = null;
    if (pc === syms.move_tick) { tick++; winSp = sp; }
    if (winSp !== null && ENTRIES.has(pc)) {
      const top = frames[frames.length - 1];
      if (!top || !inFamily(top.site)) (entries[tick] ??= []).push({ entry: pc, origin: top ? top.site : pc });
    }
    if (peek(pc) === 0x20) frames.push({ sp, site: pc });
  });
  nes.mmap.load = (addr) => {
    if (winSp !== null && addr >= mtLo && addr < mtHi) reads.push({ tick, reader: lastPc, origin: originOf() });
    return realLoad(addr);
  };
  return {
    unwatch() { unwatchPc(); nes.mmap.load = realLoad; },
    report() { return { ticks: tick, entries, reads, drv: [drvLo, drvHi], inFamily, inDriver }; }
  };
}

/** What the shared-driver contract forbids in a probeOwnership report; [] when clean. */
export function ownershipViolations(rep, { probesPerTick = 2 } = {}) {
  const hex = (n) => '$' + n.toString(16);
  const out = [];
  if (rep.ticks === 0) out.push('no Move tick was traced');
  for (let t = 1; t <= rep.ticks; t++) {
    const es = rep.entries[t] ?? [];
    if (es.length !== probesPerTick) out.push(`tick ${t}: ${es.length} probes entered the helper family, the walking rule makes ${probesPerTick}`);
    for (const e of es) if (!rep.inDriver(e.origin)) out.push(`tick ${t}: a probe was asked for from ${hex(e.origin)}, outside the shared driver ${hex(rep.drv[0])}..${hex(rep.drv[1])}`);
  }
  for (const r of rep.reads) {
    if (!rep.inDriver(r.origin)) out.push(`tick ${r.tick}: a collision-table read at ${hex(r.reader)} originates at ${hex(r.origin)}, outside the shared driver`);
    else if (!rep.inFamily(r.reader) && !rep.inDriver(r.reader)) out.push(`tick ${r.tick}: a collision-table read executed at ${hex(r.reader)}, outside the probe helpers`);
  }
  return out;
}
