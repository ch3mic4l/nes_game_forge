// Shared builders for test/unit/streamproj.test.js: the whole-shadow oracle for phase 3a slice S1's
// streamed entity projection (engine/streamworld.asm, sw_ent_setup .. draw_one_entity_show_sw under
// `.if STREAM_PROJ_ENABLED`).
//
// The oracle is NOT a JavaScript model of the projection. It is the SAME project assembled a second
// time with a Code Forge override of engine/streamworld.asm in which the line
// `  .if STREAM_PROJ_ENABLED` is replaced by `sw_ent_setup:\n  rts\n  .if 0`, so the SHIPPED per-tile
// routine (the `.else` branch of the same block, the routine S1 replaces) assembles instead. Two ROMs
// from one tree, one game-type, one art set, differing only in that routine; both are then booted,
// given IDENTICAL RAM (shadow prefill, oam_idx, screen, camera origin, eight entity records) and
// `draw_entities` is run in each. Every one of the 256 shadow bytes and oam_idx must agree.
//
// Mutants (MUTANTS) are the same S1 text with one deliberate defect; the test file asserts each is
// caught, so the oracle's discriminating power is itself under test.
//
// RAM addresses are transcribed from engine/constants.asm by hand (a test that parsed the file it is
// checking would prove nothing); code labels come from the built game.fns.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { createStreamedProject } from './streamedproject.js';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { parseSymbolFile } from '../../main/build/symbols.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

// from engine/constants.asm
export const R = {
  OAM: 0x200,
  OAM_IDX: 0x20,
  MAP_IS_STREAMED: 0xfe,
  SW_COL: 0x5a0,
  SW_ROW: 0x5a1,
  CAM_X_LO: 0x35c,
  CAM_X_HI: 0x35d,
  CAM_Y_LO: 0x35e,
  CAM_Y_HI: 0x35f,
  ENT_ACTIVE: 0x300,
  ENT_ACTOR: 0x308,
  ENT_X: 0x310,
  ENT_Y: 0x318,
  ENT_DIR: 0x320,
  ENT_FRAME: 0x328,
  ENT_TIMER: 0x330,
  ENT_HURT: 0x388
};

// ---------------------------------------------------------------------------------------------
// seeded PRNG (xorshift32), one instance per use so test order never changes a corpus
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  const rnd = (n) => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s % n;
  };
  return { rnd, pick: (a) => a[rnd(a.length)] };
}

// ---------------------------------------------------------------------------------------------
// art fixtures. Each set is a whole project's bounds (SW_U* are project-global), so each is chosen
// to make different classes reachable.
export function msFromOffsets(id, offs) {
  return { id, name: 'm' + id, tiles: offs.map(([x, y], i) => ({ x, y, tile: 0x30 + (i & 15), palette: i & 3, hflip: (i & 1) === 1, vflip: (i & 2) === 2 })) };
}
const grid = (n, sx, sy, ox = 0, oy = 0) => Array.from({ length: n }, (_, i) => [ox + (i % 4) * sx, oy + ((i / 4) | 0) * sy]);
const ANIM = (id, ...ms) => ({ id, name: 'a' + id, loop: true, frames: ms.map((m) => ({ metaspriteId: m, duration: 3 })) });

export const ART = {
  // tiny art, bounds within [-8,24]: the inside class is common
  small: {
    ms: [msFromOffsets(0, [[0, 0]]), msFromOffsets(1, grid(4, 8, 8)), msFromOffsets(2, grid(8, 8, 8, -8, -8)), msFromOffsets(3, grid(16, 4, 4)), msFromOffsets(4, [])],
    an: [ANIM(0, 0, 1), ANIM(1, 2), ANIM(2, 3, 1, 2), ANIM(3, 4), { id: 4, name: 'zero', loop: true, frames: [] }],
    actors: [{ anims: { walkDown: 0 } }, { anims: { walkDown: 1, walkUp: 2, walkSide: 0 } }, { anims: { walkDown: 2 } }, { anims: {} }, { anims: { walkDown: 3 } }, { anims: { walkDown: 4, idle: 1 } }]
  },
  // extremes -128/127 on both axes: everything is straddle or cull
  wide: {
    ms: [msFromOffsets(0, [[-128, -128], [127, 127], [-1, 0], [0, -1]]), msFromOffsets(1, grid(16, 8, 8, -64, -64)), msFromOffsets(2, [[-128, 127], [127, -128], [0, 0], [-1, -1], [127, 0], [0, 127], [-128, 0], [0, -128]])],
    an: [ANIM(0, 0), ANIM(1, 1, 2), ANIM(2, 2, 0)],
    actors: [{ anims: { walkDown: 0 } }, { anims: { walkDown: 1, walkUp: 2 } }, { anims: { walkDown: 2, walkSide: 1 } }]
  },
  // one wide-ish pose among small ones
  mid: {
    ms: [msFromOffsets(0, grid(16, 8, 8, -16, -16)), msFromOffsets(1, [[-40, -40], [30, 30]])],
    an: [ANIM(0, 0), ANIM(1, 1)],
    actors: [{ anims: { walkDown: 0, walkUp: 1 } }]
  },
  // single-tile poses, one axis at an extreme each: -128, -1, 0, 127
  edge: {
    ms: [msFromOffsets(0, [[0, 0]]), msFromOffsets(1, [[-128, 0]]), msFromOffsets(2, [[127, 0]]), msFromOffsets(3, [[0, -128]]), msFromOffsets(4, [[0, 127]]), msFromOffsets(5, [[-1, -1]])],
    an: [ANIM(0, 0), ANIM(1, 1), ANIM(2, 2), ANIM(3, 3), ANIM(4, 4), ANIM(5, 5)],
    actors: [0, 1, 2, 3, 4, 5].map((i) => ({ anims: { walkDown: i } }))
  },
  // a two-frame animation whose SECOND frame is by far the widest: bounds computed from frame 0 alone
  // (a defect the generator half of sabotage 3 injects) would call every position "inside"
  late: {
    ms: [msFromOffsets(0, [[0, 0]]), msFromOffsets(1, [[-100, -100], [100, 100], [0, 0]])],
    an: [ANIM(0, 0, 1)],
    actors: [{ anims: { walkDown: 0, walkUp: 0, walkSide: 0 } }]
  },
  // one single tile at (0,0), nothing else: bounds are exactly 0, so the INSIDE class reaches the
  // screen's own edges (X 0/255, Y 0/239), which no wider art can
  unit: {
    ms: [msFromOffsets(0, [[0, 0]])],
    an: [ANIM(0, 0)],
    actors: [{ anims: { walkDown: 0 } }]
  }
};
export const ART_NAMES = Object.keys(ART);

/** A streamed project (3x2, UNROM 512) with the art set's actors, one entity each on the streamed map. */
export function makeProject(artName, gameType = 'action') {
  const art = ART[artName];
  const project = createStreamedProject({ gameType });
  const actors = art.actors.map((a, i) => ({ name: 'A' + i, behavior: 'patroller', speed: 1, hp: 1, damage: 0, ...a }));
  project.sprites.metasprites = structuredClone(art.ms);
  project.sprites.animations = structuredClone(art.an);
  project.sprites.actors = actors;
  const screens = project.maps[0].screens;
  actors.forEach((_, i) => { (screens[i % screens.length].entities ??= []).push({ actorId: i, x: 16 + i * 8, y: 16 + i * 8, props: {} }); });
  return project;
}

// ---------------------------------------------------------------------------------------------
// builds
export const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

/** Build `project` (optionally with Code Forge overrides), return { rom, code (game.fns labels), warnings }. */
export async function buildRom(project, overrides = null) {
  const p = structuredClone(project);
  if (overrides) p.code = { overrides, files: [] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamproj-'));
  try {
    await saveProject(dir, p);
    const built = await buildProject({ dir, project: p, log: () => {} });
    return {
      rom: new Uint8Array(fs.readFileSync(built.romPath)),
      code: parseSymbolFile(fs.readFileSync(built.symbolPath, 'utf8')),
      warnings: built.warnings ?? []
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function streamworldSource() {
  return fs.readFileSync(path.join(ROOT, 'engine', 'streamworld.asm'), 'utf8');
}
const PROJ_IF = '  .if STREAM_PROJ_ENABLED\n';
function replaceOnce(src, from, to, what) {
  const parts = src.split(from);
  if (parts.length !== 2) throw new Error(`override anchor "${what}" matched ${parts.length - 1} times, expected exactly 1`);
  return parts.join(to);
}
/** engine/streamworld.asm with the S1 projection disabled: the shipped per-tile routine assembles. */
export function oracleText(src = streamworldSource()) {
  return replaceOnce(src, PROJ_IF, 'sw_ent_setup:\n  rts\n  .if 0\n', 'the S1 .if STREAM_PROJ_ENABLED line');
}

// One deliberate defect each. [name]: [anchor, replacement]. Anchors must match exactly once.
export const MUTANTS = {
  // sabotage 1
  'cull skips the oam_idx advance': [
    'dsw_cull:\n  ldx <oam_idx\n  lda #$FF\ndsw_cull_tile:\n  sta OAM,x\n  inx\n  inx\n  inx\n  inx\n  beq dsw_done\n  dec <de_left\n  bne dsw_cull_tile\n  jmp dsw_done',
    'dsw_cull:\n  jmp dsw_done'
  ],
  // sabotage 2: a base X in [-256,-225] (biased) is culled although a +127 tile lands visible
  'cull threshold off by 32 (visible tile discarded)': [
    '  lda <sw_dxb_hi\n  clc\n  adc #1\n  cmp #2\n  bcs dsw_cull\n  lda sw_tmp2\n  clc\n  adc #1\n  cmp #2\n  bcs dsw_cull\n',
    '  lda <sw_dxb_hi\n  clc\n  adc #1\n  cmp #2\n  bcc mut_x1\n  jmp dsw_cull\nmut_x1:\n  lda <sw_dxb_hi\n  bpl mut_x2\n  lda <sw_dxb_lo\n  cmp #$20\n  bcs mut_x2\n  jmp dsw_cull\nmut_x2:\n  lda sw_tmp2\n  clc\n  adc #1\n  cmp #2\n  bcc mut_y1\n  jmp dsw_cull\nmut_y1:\n'
  ],
  // sabotage 4b: SW_UYMAX one too high
  'inside Y bound written <= 240': [
    '  lda sw_tmp\n  cmp #240\n  bcs dsw_straddle',
    '  lda sw_tmp\n  cmp #241\n  bcs dsw_straddle'
  ],
  // sabotage 4c
  'OAM -1 applied before the range test': [
    '  lda sw_tmp\n  cmp #240\n  bcs dsw_st_park\n  adc #$FF\n',
    '  lda sw_tmp\n  sec\n  sbc #1\n  cmp #240\n  bcs dsw_st_park\n  clc\n'
  ],
  // sabotage 5
  'hi-byte carry omitted in the per-tile X add': [
    '  lda <sw_dxb_hi\n  adc #0\n  ora sw_tmp3',
    '  lda <sw_dxb_hi\n  ora sw_tmp3'
  ]
};
export function mutantText(name, src = streamworldSource()) {
  const [from, to] = MUTANTS[name];
  return replaceOnce(src, from, to, name);
}

// ---------------------------------------------------------------------------------------------
// a booted pair
function boot(rom) {
  const nes = new NES({ onFrame() {}, emulateSound: false });
  nes.loadROM(rom);
  return nes;
}

/**
 * The oracle ROM and the S1 ROM for one art set / game type. `mutant` names an entry of MUTANTS
 * and builds the S1 side from the mutated text (still through an override, never the file on disk).
 */
export async function loadPair(artName, gameType = 'action', { mutant = null } = {}) {
  const project = makeProject(artName, gameType);
  const oracle = await buildRom(project, [{ name: 'streamworld.asm', text: oracleText() }]);
  const s1 = await buildRom(project, mutant ? [{ name: 'streamworld.asm', text: mutantText(mutant) }] : null);
  const cfg = { artName, gameType, mutant };
  return {
    ...cfg,
    project,
    actors: project.sprites.actors,
    oracle: { nes: boot(oracle.rom), code: oracle.code, rom: oracle.rom },
    s1: { nes: boot(s1.rom), code: s1.code, rom: s1.rom }
  };
}

// ---------------------------------------------------------------------------------------------
// state
/** The animation a given facing uses for an actor (NO_ANIM -> null): walkDown, walkUp, walkSide, walkSide. */
export function facingAnim(actor, dir) {
  const slot = ['walkDown', 'walkUp', 'walkSide', 'walkSide'][dir];
  let v = actor.anims?.[slot];
  if (v === undefined || v === null) v = actor.anims?.idle;
  return v === undefined || v === null ? null : v;
}
export const signed = (v) => ((v & 255) << 24) >> 24;

/**
 * st = { prefill[256], oamIdx, col, row, ox, oy, ents: [ {actor, dir, frame, x, y, hurt} | null ] x8 }
 * Writes every byte draw_entities reads. Everything else is at its boot value in BOTH ROMs.
 */
export function setState(nes, st) {
  const mem = nes.cpu.mem;
  for (let i = 0; i < 256; i++) mem[R.OAM + i] = st.prefill[i];
  mem[R.OAM_IDX] = st.oamIdx;
  mem[R.MAP_IS_STREAMED] = 1;
  mem[R.SW_COL] = st.col;
  mem[R.SW_ROW] = st.row;
  mem[R.CAM_X_LO] = st.ox & 255; mem[R.CAM_X_HI] = (st.ox >> 8) & 255;
  mem[R.CAM_Y_LO] = st.oy & 255; mem[R.CAM_Y_HI] = (st.oy >> 8) & 255;
  for (let i = 0; i < 8; i++) {
    const e = st.ents[i];
    mem[R.ENT_ACTIVE + i] = e ? 1 : 0;
    mem[R.ENT_ACTOR + i] = e ? e.actor : 0;
    mem[R.ENT_X + i] = e ? e.x : 0;
    mem[R.ENT_Y + i] = e ? e.y : 0;
    mem[R.ENT_DIR + i] = e ? e.dir : 0;
    mem[R.ENT_FRAME + i] = e ? e.frame : 0;
    mem[R.ENT_TIMER + i] = 0;
    mem[R.ENT_HURT + i] = e ? e.hurt : 0;
  }
}

const EDGE_XY = [0, 1, 127, 128, 239, 240, 254, 255];
/** Random state for the corpus. `rng` from makeRng; opts pin oamIdx / n / actor. */
export function randomState(pair, rng, opts = {}) {
  const { rnd, pick } = rng;
  const { actors } = pair;
  const P = pair.project.sprites;
  const st = { prefill: Array.from({ length: 256 }, () => rnd(256)), ents: [] };
  st.oamIdx = opts.oamIdx ?? pick([0, 16, 20, 64, 100, 200, 224, 240, 252, 16, 16]);
  st.col = rnd(3); st.row = rnd(2);
  const n = opts.n ?? 1 + rnd(8);
  for (let i = 0; i < 8; i++) {
    if (i >= n) { st.ents.push(null); continue; }
    const actor = opts.actor !== undefined ? opts.actor : rnd(actors.length);
    const dir = rnd(4);
    const an = facingAnim(actors[actor], dir);
    const frames = an === null ? 1 : Math.max(1, P.animations[an].frames.length);
    st.ents.push({
      actor, dir, frame: rnd(frames),
      x: rnd(3) ? rnd(256) : pick(EDGE_XY),
      y: rnd(3) ? rnd(240) : pick(EDGE_XY),
      hurt: rnd(8) === 0 ? pick([1, 2, 3]) : 0
    });
  }
  // The origin: anchor slot 0's projected position near an edge (60%), on an exact boundary (30%),
  // or fully random 16-bit (10%: origins 0/255/256/-128 and everything wrapping).
  const e0 = st.ents[0];
  const mode = rnd(10);
  const near = () => rnd(430) - 150;
  const sx = mode < 6 ? near() : pick([-1, 0, 1, 255, 256, -128, 127, 128]);
  const sy = mode < 6 ? rnd(410) - 150 : pick([-1, 0, 1, 239, 240, -128, 127, 120]);
  if (mode === 9) { st.ox = rnd(65536); st.oy = rnd(65536); } else {
    st.ox = (st.col * 256 + e0.x - sx) & 0xffff;
    st.oy = (st.row * 240 + e0.y - sy) & 0xffff;
  }
  return st;
}

// PC hooks: draw_entities is called through a JSR stub at $0700 (test/lib/callroutine.js's shape),
// stepping the CPU by hand so a set of labels can be counted as they are reached.
function callWatch(nes, address, watch, hits) {
  nes.mmap.write(0x2000, 0);
  nes.cpu.irqRequested = false;
  nes.cpu.F_INTERRUPT = 1;
  nes.cpu.mem.set([0x20, address & 255, address >> 8, 0xea], 0x700);
  nes.cpu.REG_PC = 0x6ff;
  let cycles = 0;
  const rev = watch ? new Map(Object.entries(watch).map(([k, v]) => [v, k])) : null;
  while ((nes.cpu.REG_PC + 1) !== 0x703) {
    if (rev) {
      const name = rev.get(nes.cpu.REG_PC + 1);
      if (name !== undefined) hits[name] = (hits[name] ?? 0) + 1;
    }
    cycles += nes.cpu.emulate();
    if (cycles > 400000) throw new Error('draw_entities never returned, pc=' + nes.cpu.REG_PC.toString(16));
  }
  return cycles;
}

/**
 * Run draw_entities on the same state in both ROMs. `hits` (optional object) accumulates entries of
 * dsw_cull / dsw_straddle / dsw_in_tile reached in the S1 ROM. Returns { ok, oa, ob, ia, ib, cyclesOracle, cyclesS1 }.
 */
export function runCase(pair, st, hits = null) {
  const A = pair.oracle;
  const B = pair.s1;
  setState(A.nes, st);
  setState(B.nes, st);
  const cyclesOracle = callWatch(A.nes, A.code.draw_entities, null, null);
  const watch = hits ? { dsw_cull: B.code.dsw_cull, dsw_straddle: B.code.dsw_straddle, dsw_in_tile: B.code.dsw_in_tile } : null;
  let cyclesS1, runaway = false;
  try {
    cyclesS1 = callWatch(B.nes, B.code.draw_entities, watch, hits);
  } catch (e) {
    if (!/never returned/.test(e.message)) throw e;
    runaway = true; // a defective S1 routine that never returns is a mismatch, not a crash of the suite
  }
  const oa = Array.from(A.nes.cpu.mem.slice(R.OAM, R.OAM + 256));
  const ob = Array.from(B.nes.cpu.mem.slice(R.OAM, R.OAM + 256));
  const ia = A.nes.cpu.mem[R.OAM_IDX];
  const ib = B.nes.cpu.mem[R.OAM_IDX];
  let ok = ia === ib && !runaway;
  for (let i = 0; i < 256; i++) if (oa[i] !== ob[i]) ok = false;
  return { ok, oa, ob, ia, ib, cyclesOracle, cyclesS1, runaway };
}

/** One-line description of a failing case, enough to reproduce it. */
export function describeMismatch(pair, st, r) {
  const first = r.oa.findIndex((v, i) => v !== r.ob[i]);
  return `${pair.artName}/${pair.gameType}${pair.mutant ? '/' + pair.mutant : ''}${r.runaway ? ' (S1 never returned)' : ''}: oam_idx oracle=${r.ia} s1=${r.ib}, first differing OAM byte ${first}` +
    (first >= 0 ? ` (oracle ${r.oa[first]}, s1 ${r.ob[first]})` : '') +
    `, state ${JSON.stringify({ ox: st.ox, oy: st.oy, col: st.col, row: st.row, oamIdx: st.oamIdx, ents: st.ents.filter(Boolean) })}`;
}

// ---------------------------------------------------------------------------------------------
// boundary pins
const PIN_TYS = [-2, -1, 0, 1, 2, 100, 238, 239, 240, 241, 248];
const PIN_TXS = [-2, -1, 0, 1, 20, 100, 254, 255, 256, 257, 264];
const PIN_PLACEMENTS = [[1, 1, 100, 100], [0, 0, 5, 7], [2, 1, 250, 230]]; // col, row, ent x, ent y

/** The distinct pin prefill pattern: every byte non-zero, non-$FF, and unlike any byte a real write produces at that slot. */
export const PIN_PREFILL = Array.from({ length: 256 }, (_, i) => 0x11 + ((i * 7) & 0x6f));

/**
 * Every boundary case for a pair: for each actor x facing x frame, the extreme tiles of the pose
 * (leftmost, rightmost, topmost, bottommost, first), placed so that tile lands at screen (tx, ty)
 * for each tx/ty above, from `placements` distinct entity positions. Returns generator of
 * { st, tile, tx, ty, ... }.
 */
export function* pinCases(pair, { tys = PIN_TYS, txs = PIN_TXS, placements = PIN_PLACEMENTS, dirs = [0, 1, 2] } = {}) {
  for (let actor = 0; actor < pair.actors.length; actor++) {
    for (const dir of dirs) {
      const an = facingAnim(pair.actors[actor], dir);
      if (an === null) continue;
      const frames = pair.project.sprites.animations[an].frames;
      for (let frame = 0; frame < Math.max(1, frames.length); frame++) {
        const msid = frames[frame]?.metaspriteId ?? 0;
        const tiles = pair.project.sprites.metasprites[msid].tiles;
        if (!tiles.length) continue;
        const idx = new Set([0]);
        const a = [0, 0, 0, 0];
        tiles.forEach((t, i) => {
          if (signed(t.x) < signed(tiles[a[0]].x)) a[0] = i;
          if (signed(t.x) > signed(tiles[a[1]].x)) a[1] = i;
          if (signed(t.y) < signed(tiles[a[2]].y)) a[2] = i;
          if (signed(t.y) > signed(tiles[a[3]].y)) a[3] = i;
        });
        a.forEach((i) => idx.add(i));
        for (const ti of idx) {
          const t = tiles[ti];
          for (const ty of tys) for (const tx of txs) for (const [col, row, ex, ey] of placements) {
            const st = {
              prefill: PIN_PREFILL.slice(),
              ents: [{ actor, dir, frame, x: ex, y: ey, hurt: 0 }, ...Array(7).fill(null)],
              oamIdx: 16, col, row,
              ox: (col * 256 + ex + signed(t.x) - tx) & 0xffff,
              oy: (row * 240 + ey + signed(t.y) - ty) & 0xffff
            };
            yield { st, actor, dir, frame, ti, tx, ty, ntiles: tiles.length };
          }
        }
      }
    }
  }
}

/** Which class the S1 routine took for a single-actor case, from the label hits of that one case. */
export function classOf(hits) {
  if (hits.dsw_cull) return 'cull';
  if (hits.dsw_straddle) return 'straddle';
  if (hits.dsw_in_tile) return 'inside';
  return 'none';
}

/**
 * Hand-computed expectation for a single-tile pose's slot 0 (OAM bytes 16..19) at screen (tx, ty),
 * from the shipped rules alone: on screen iff 0<=tx<=255 and 0<=ty<=239; then Y byte = ty-1 (mod 256,
 * so ty=0 -> $FF), tile/attribute as the project's own metasprite bytes, X byte = tx; otherwise ONLY
 * the Y byte is written, to $FF, and tile/attribute/X keep whatever the shadow held.
 * `tile`: the metasprite tile record (for tile index and attribute).
 */
export function expectedSlot(prefill, base, tx, ty, written) {
  const on = tx >= 0 && tx <= 255 && ty >= 0 && ty <= 239;
  if (on) return [(ty - 1) & 255, written[0], written[1], tx];
  return [0xff, prefill[base + 1], prefill[base + 2], prefill[base + 3]];
}
