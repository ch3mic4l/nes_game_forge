// Scene builders and a cycle counter for test/unit/streamgate.test.js: the unit-level hard
// assertions of the phase 3a frame gate (plan section 5.4), rows M0-M2 of the workload manifest
// (section 5.3), measured by calling engine/entities.asm `draw_entities` in isolation.
//
// Nothing here is a model of the engine. The scenes are real streamed UNROM 512 projects built
// through the real pipeline (test/lib/streamprojoracle.js buildRom, test/lib/streamedproject.js
// createStreamedProject, test/lua/sw_manifest_scene.mjs eightSplit); the state is the same RAM
// the engine reads (streamprojoracle setState); the count is the emulator core's own per-instruction
// cycle figure (nes.cpu.emulate(), which includes branch-taken and page-cross penalties), summed
// over one JSR-stub call exactly as test/lib/callroutine.js does, with PC hooks on labels from the
// built game.fns so a test can prove which code path each tile took.
//
// The PARENT ROM (M0) is built from commit 99d4156's own tree, unpacked by `git archive` into a
// scratch directory (no vendored copy of old sources), through that tree's own pipeline, from the
// project this tree generated -- the construction test/lib/build_identity_baseline.mjs uses.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { createStreamedProject } from './streamedproject.js';
import { R, msFromOffsets, setState, buildRom, hasNesasm } from './streamprojoracle.js';
import { eightSplit } from '../lua/sw_manifest_scene.mjs';
import { createMap, createScreen } from '../../shared/project.js';
import { saveProject } from '../../main/project-io.js';
import { parseSymbolFile } from '../../main/build/symbols.js';

export { hasNesasm, R };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
export const PARENT_REV = '99d4156';

// ---------------------------------------------------------------------------------------------
// The scene. Eight actors whose art totals `sizes` tiles (eightSplit(B): 3,3,2,2,2,2,2,2 at B=18).
// Actor i's animation has TWO frames, so the art is really animated: frame 0 is the costliest pose
// (all of its `sizes[i]` tiles, laid out two per row), frame 1 a smaller pose. streamTiles counts
// the maximum over authored frames, i.e. frame 0, and every entity is put on frame 0.
//   tight  every offset within 0..16: the inside class is reachable (M1) and, by placement at an
//          edge, the straddle class with parked tiles (M2e);
//   wide   actor 0's frame 1 (NOT the frame drawn) also carries offsets -128/+127. Bounds are
//          project-global and cover every authored frame (streamProjBounds), so every actor on every
//          streamed screen loses the inside fast path while its drawn tiles all stay on screen: the
//          costliest straddle population (M2).
const layout = (n) => Array.from({ length: n }, (_, j) => [(j % 2) * 8, ((j / 2) | 0) * 8]);

export function gateProject({ gameType, wide = false, sizes }) {
  const project = createStreamedProject({ gameType });
  const ms = []; const an = []; const actors = [];
  sizes.forEach((k, i) => {
    ms.push(msFromOffsets(2 * i, layout(k)));
    let alt = layout(Math.max(1, k - 1));
    // never more tiles than frame 0 (streamTiles counts the largest pose): two offsets at the extremes suffice for the bounds
    if (wide && i === 0) alt = [[-128, -128], [127, 127], [0, 0]].slice(0, Math.max(2, k));
    ms.push(msFromOffsets(2 * i + 1, alt));
    an.push({ id: i, name: 'g' + i, loop: true, frames: [{ metaspriteId: 2 * i, duration: 6 }, { metaspriteId: 2 * i + 1, duration: 6 }] });
    actors.push({ name: 'G' + i, behavior: 'npc', hp: 1, damage: 0, anims: { walkDown: i, walkUp: i, walkSide: i } });
  });
  project.sprites.metasprites = ms;
  project.sprites.animations = an;
  project.sprites.actors = actors;
  // all eight on the streamed map's screen SCREEN_INDEX (col 1, row 0), so streamTiles(screen) is the whole population
  const place = (screen) => actors.forEach((_, i) => { (screen.entities ??= []).push({ actorId: i, x: inside(i).x, y: inside(i).y, props: {} }); });
  place(project.maps[0].screens[SCREEN_INDEX]);
  // an ordinary second map carrying the same eight actors, started on: the project STREAMS but its
  // current map is ordinary (M0)
  const om = createMap(1, 'Ordinary');
  om.tilesetId = 0; om.gridW = 1; om.gridH = 1; om.screens = [createScreen()];
  place(om.screens[0]);
  project.maps.push(om);
  project.project.startMap = 1; project.project.startScreen = 0;
  return project;
}

export const SCREEN_INDEX = 1; // col 1, row 0 of the 3x2 grid
export const SCREEN_COL = 1;
export const SCREEN_ROW = 0;
export const sizesFor = (bound) => eightSplit(bound);

/** Well inside the screen: the biggest pose spans 0..8 px on both axes. */
export const inside = (i) => ({ x: 60 + (i % 4) * 40, y: 40 + (i >> 2) * 60 });
/** Each actor's pose crosses a screen edge (right edge for most, bottom edge for three). */
export const crossing = (i) => ((i === 1 || i === 3 || i === 5) ? { x: 100, y: 234 } : { x: 252, y: 30 + i * 20 });

/** The 8 entity records for draw_entities, every one on frame 0, facing down. */
export function entityState(place) {
  return Array.from({ length: 8 }, (_, i) => ({ actor: i, dir: 0, frame: 0, x: place(i).x, y: place(i).y, hurt: 0 }));
}

/** A whole draw_entities scenario: screen (col,row) shown from its own origin, oam_idx 16 (the player's four sprites). */
export function sceneState({ place, prefill = null, oamIdx = 16, col = SCREEN_COL, row = SCREEN_ROW }) {
  return {
    prefill: prefill ?? Array.from({ length: 256 }, (_, i) => 0x11 + ((i * 7) & 0x6f)),
    oamIdx, col, row, ox: col * 256, oy: row * 240,
    ents: entityState(place)
  };
}

// ---------------------------------------------------------------------------------------------
export function boot(rom) {
  const nes = new NES({ onFrame() {}, emulateSound: false });
  nes.loadROM(rom);
  return nes;
}

/** Build the S1 ROM (this tree) for a project: { rom, code (game.fns labels), nes booted, warnings }. */
export async function buildBooted(project, overrides = null) {
  const b = await buildRom(project, overrides);
  return { ...b, nes: boot(b.rom) };
}

/**
 * One call of `address` through the callRoutine stub, hooking `watch` = { name: address }: returns
 * { cycles, hits: { name: count } }. cycles includes the stub's own JSR (6), the same in every row.
 */
export function callCounted(nes, address, watch = {}) {
  nes.mmap.write(0x2000, 0);
  nes.cpu.irqRequested = false;
  nes.cpu.F_INTERRUPT = 1;
  nes.cpu.mem.set([0x20, address & 255, address >> 8, 0xea], 0x700);
  nes.cpu.REG_PC = 0x6ff;
  const rev = new Map(Object.entries(watch).map(([k, v]) => [v, k]));
  const hits = Object.fromEntries(Object.keys(watch).map((k) => [k, 0]));
  let cycles = 0;
  while ((nes.cpu.REG_PC + 1) !== 0x703) {
    const name = rev.get(nes.cpu.REG_PC + 1);
    if (name !== undefined) hits[name]++;
    cycles += nes.cpu.emulate();
    if (cycles > 400000) throw new Error('routine never returned, pc=' + nes.cpu.REG_PC.toString(16));
  }
  return { cycles, hits };
}

/** The class labels of the S1 projection (engine/streamworld.asm) plus the setup routine, from game.fns. */
export function classWatch(code) {
  return { inside: code.dsw_in_tile, straddle: code.dsw_st_tile, cull: code.dsw_cull_tile, setup: code.sw_ent_setup };
}

/** Run one streamed draw_entities on a freshly booted core; returns { cycles, hits, oam[256], oamIdx }. */
export function runStreamedDraw(built, st) {
  const { code } = built;
  const nes = boot(built.rom); // a fresh core per run: no RAM residue from any earlier row
  setState(nes, st);
  const r = callCounted(nes, code.draw_entities, classWatch(code));
  return { ...r, oam: Array.from(nes.cpu.mem.slice(R.OAM, R.OAM + 256)), oamIdx: nes.cpu.mem[R.OAM_IDX] };
}

// ---------------------------------------------------------------------------------------------
// The parent ROM (commit 99d4156), built through that commit's own pipeline.
let parentDir = null;
export function parentTree() {
  if (parentDir) return parentDir;
  const gitDir = process.env.STREAMGATE_GIT_DIR ?? path.join(ROOT, '.git'); // a sabotage copy has no .git of its own
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamgate-parent-'));
  const tar = execFileSync('git', ['--git-dir', gitDir, 'archive', PARENT_REV, 'engine', 'main', 'shared', 'renderer', 'package.json'], { maxBuffer: 1 << 28 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  parentDir = dir;
  return dir;
}
export function dropParentTree() {
  if (parentDir) fs.rmSync(parentDir, { recursive: true, force: true });
  parentDir = null;
}

export async function buildParent(project) {
  const tree = parentTree();
  const { buildProject } = await import(pathToFileURL(path.join(tree, 'main/build/pipeline.js')));
  const p = structuredClone(project);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamgate-p-'));
  try {
    await saveProject(dir, p);
    const built = await buildProject({ dir, project: p, log: () => {} });
    const rom = new Uint8Array(fs.readFileSync(built.romPath));
    return { rom, code: parseSymbolFile(fs.readFileSync(built.symbolPath, 'utf8')), nes: boot(rom) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Itemising the S1 hooks from the ROM's own bytes (M0's fixed overhead).
// All hook code sits in the fixed kernel ($C000-$FFFF), the last 16 KB of PRG.
export const kernelOffset = (rom, addr) => 16 + rom[4] * 0x4000 - 0x4000 + (addr - 0xc000);
const OPS = {
  0xa9: { mn: 'LDA #', len: 2, cyc: 2 },
  0xa5: { mn: 'LDA zp', len: 2, cyc: 3 },
  0x85: { mn: 'STA zp', len: 2, cyc: 3 },
  0xd0: { mn: 'BNE', len: 2, cyc: 2, branch: true },
  0xf0: { mn: 'BEQ', len: 2, cyc: 2, branch: true },
  0x20: { mn: 'JSR', len: 3, cyc: 6 },
  0x60: { mn: 'RTS', len: 1, cyc: 6 }
};
/**
 * Decode [from, to) of the kernel. Branch cost is given by `taken`: false = not taken (base cycles),
 * true = taken (+1, +1 more if the target is on another page than the next instruction).
 */
export function decodeSpan(rom, from, to, { taken = false } = {}) {
  const out = [];
  let addr = from;
  while (addr < to) {
    const o = kernelOffset(rom, addr);
    const op = OPS[rom[o]];
    if (!op) throw new Error(`unexpected opcode $${rom[o].toString(16)} at $${addr.toString(16)} while decoding a hook span`);
    const bytes = Array.from(rom.slice(o, o + op.len));
    let cyc = op.cyc;
    if (op.branch && taken) {
      const rel = bytes[1] > 127 ? bytes[1] - 256 : bytes[1];
      const next = addr + 2;
      cyc += 1 + (((next + rel) >> 8) !== (next >> 8) ? 1 : 0);
    }
    out.push({ addr, mn: op.mn, bytes, cyc });
    addr += op.len;
  }
  if (addr !== to) throw new Error(`hook span decoded past its end label ($${addr.toString(16)} vs $${to.toString(16)})`);
  return out;
}
export const sumCycles = (items) => items.reduce((s, x) => s + x.cyc, 0);
