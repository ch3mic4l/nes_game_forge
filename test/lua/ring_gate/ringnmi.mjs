// Phase 3b S1c row 5 (plan 2.5/2.6): the NMI deadline on a RING build. The builder renders sw_nmi_ring.lua.template (a recorder) for one cell and the judge in
// this file decides, from the recorded NMI lines, against an independent model of the ring's strip: the geometry (axis, length, wrap, live nametables), the
// block advancement per interrupt, the exact $2006/$2007 write sequence including the attribute read-modify-write, and the vblank deadline.
//
// The model restates the ENGINE'S CONTRACT (plan 1.x), not its source: a column strip on the vertical ring (st_active=1) has P=15 blocks, a row strip on the
// horizontal ring (st_active=2) has P=16; the live nametables are {0,1} (st_fnt 0|4) and {0,2} (st_fnt 0|8); the per-NMI chunks are 3 (strip only) and 2 (with a
// queue of at most 35 bytes). Nothing here reads the patched tree's constants: a build whose arm routine wrote the wrong length disagrees with them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { makeTree, sha256 } from './ringtree.mjs';
import { ringProject, buildCell } from './ringworld.mjs';
import { MESEN, mesenUnavailable } from './ringrun_mesen.mjs';
import { nmiBound, certifiedMargin, ENTRY_DELAY_CYCLES, RTI_CYCLES, VBLANK_CYCLES } from './ringwcet.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const NMI_TEMPLATE = path.join(HERE, '../sw_nmi_ring.lua.template');

// ---- the independent contract -------------------------------------------------------------------------------------------------------------------------
/** Per ring (1 = vertical mirroring / X ring, 2 = horizontal mirroring / Y ring): the real strip axis, its length and wrap, the live nametables, the dead one. */
export const GEOM = {
  1: { axis: 1, P: 15, len: 15, fnt: [0, 4], ftileMax: 30, wrap: { 1: 15, 2: 32 }, live: [[0x2000, 0x2800]], name: 'column strip, 15 blocks, NT {0,1}' },
  2: { axis: 2, P: 16, len: 16, fnt: [0, 8], ftileMax: 28, wrap: { 1: 30, 2: 16 }, live: [[0x2000, 0x2400], [0x2800, 0x2c00]], name: 'row strip, 16 blocks, NT {0,2}' }
};
export const CHUNK = 3; // strip-only blocks per NMI (SW_STREAM_CHUNK)
export const MIXED_CHUNK = 2; // blocks per NMI beside a queue (SW_STREAM_MIXED_CHUNK)
export const MIXED_MAX_BYTES = 35; // MIXED_VBLANK_MAX_BYTES: a queue above it is an exclusive drain
export const PACKET = { hi: 0x3f, lo: 0x00, count: 32, first: 0x20 };

// NTSC vblank = scanlines 241-260 (341 dots each); rti's remaining 6 CPU cycles = 18 dots after the sampled position (the legacy template's own arithmetic)
const VBLANK_FIRST = 241, VBLANK_LAST = 260, DOTS = 341, RTI_DOTS = 18;
/** The finish position of an interrupt that reached nmi_rti at (scanline, cycle) and its margin in CPU cycles to the last legal dot; ok=false outside vblank. */
export function vblankMargin(scanline, cycle) {
  if (scanline < VBLANK_FIRST || scanline > VBLANK_LAST) return { ok: false, why: `nmi_rti at scanline ${scanline}, outside vblank (${VBLANK_FIRST}-${VBLANK_LAST})` };
  let dot = cycle + RTI_DOTS, line = scanline;
  while (dot >= DOTS) { dot -= DOTS; line++; }
  if (line > VBLANK_LAST) return { ok: false, why: `rti's remaining ${RTI_DOTS} dots from scanline ${scanline} cycle ${cycle} end on scanline ${line}, past vblank` };
  return { ok: true, margin: ((VBLANK_LAST - line) * DOTS + (DOTS - 1 - dot)) / 3 };
}

/** Dots from the first dot of scanline 0 to (scanline, cycle). */
const dotsAt = (scanline, cycle) => scanline * DOTS + cycle;
/** The tolerance, in CPU cycles, between a Lua exec-callback PPU position and the instruction boundary the static bound counts to (one cycle of sampling phase). */
export const SAMPLE_TOLERANCE_CYCLES = 1;

/**
 * The static bound of a ring build (ringwcet.mjs nmiBound with the ring's own axis and P), as the judge consumes it: { strip, mixed (cycles | null), mismatch: {strip, mixed}, E, refinements } or { error }.
 * `chunk`/`mixedChunk` are the CONTRACT values (3, 2): a ROM whose immediates differ (the chunk4/mixed3 controls) gets no bound for that mode.
 */
export function wcetFor({ rom, fns, symbols, ring }) {
  try {
    const g = GEOM[ring];
    const b = nmiBound({ rom, fns, symbols, geom: { axis: g.axis, P: g.P }, chunk: CHUNK, mixedChunk: MIXED_CHUNK });
    return { strip: b.strip, mixed: b.mixed, mismatch: b.mismatch, base: b.base, drain: b.drain, shiftLimit: b.shiftLimit, refinements: b.refinements, drainMax: b.drainTable.max, drainArgmax: b.drainTable.argmax, drainLinear: b.drainTable.linear };
  } catch (e) { return { error: String(e.message).split('\n')[0] }; }
}

const h2 = (n) => (n & 255).toString(16).padStart(2, '0');
const unhex = (s) => (s && s !== '-' ? Uint8Array.from(s.match(/../g).map((x) => parseInt(x, 16))) : new Uint8Array(0));

/** The nametable ranges a ring's live nametables cover: a write outside them lands in a nametable the ring never shows. */
export const inLive = (ring, addr) => GEOM[ring].live.some(([a, b]) => addr >= a && addr < b);

/**
 * The model: the writes and post-state one NMI had to produce from its pre-state.
 * `pre` = { active, cur, len, vary, fnt, ftile, ready, vlen, sbuf: Uint8Array(32), shadow: Uint8Array(256)|empty, vbuf: Uint8Array(64) }; `tiles[id] = { tl, tr, bl, br, pal }`.
 */
export function modelNmi(pre, { ring, tiles, palFx = false }) {
  const w = [];
  let ready = pre.ready, vlen = pre.vlen;
  let drained = false;
  const drain = () => {
    let i = 0;
    while (i < pre.vbuf.length && pre.vbuf[i] !== 0) {
      const count = pre.vbuf[i + 2];
      w.push(`A${h2(pre.vbuf[i])}`, `A${h2(pre.vbuf[i + 1])}`);
      for (let k = 0; k < count; k++) w.push(`D${h2(pre.vbuf[i + 3 + k])}`);
      i += 3 + count;
    }
    if (palFx) w.push('A00', 'A00');
    ready = 0; vlen = 0; drained = true;
  };
  let chunk = CHUNK, strip = true;
  if (pre.ready) {
    if (pre.vlen <= MIXED_MAX_BYTES) { drain(); chunk = MIXED_CHUNK; } else { drain(); strip = false; }
  }
  let { active, cur, vary } = pre;
  const shadow = Uint8Array.from(pre.shadow.length ? pre.shadow : new Uint8Array(256));
  const blocks = [];
  if (strip && active !== 0) {
    let n = chunk;
    for (;;) {
      if (cur >= pre.len) { active = 0; break; }
      // draw sbuf[cur] at the torus position of vary (the engine's whole addressing, including the non-ring second half of the other axis)
      const id = pre.sbuf[cur];
      const t = tiles[id];
      if (!t) throw new Error(`no tile entry for metatile id ${id}`);
      let col, row, nt;
      if (active === 1) { col = pre.ftile; if (vary < 15) { row = 2 * vary; nt = pre.fnt; } else { row = 2 * (vary - 15); nt = pre.fnt + 8; } }
      else { row = pre.ftile; if (vary < 16) { col = 2 * vary; nt = pre.fnt; } else { col = 2 * (vary - 16); nt = pre.fnt + 4; } }
      const hi = 0x20 + (row >> 3) + nt, lo = ((row & 7) << 5) | col;
      const lo2 = lo + 32;
      const hi2 = hi + (lo2 > 255 ? 1 : 0);
      w.push(`A${h2(hi)}`, `A${h2(lo)}`, `D${h2(t.tl)}`, `D${h2(t.tr)}`, `A${h2(hi2)}`, `A${h2(lo2)}`, `D${h2(t.bl)}`, `D${h2(t.br)}`);
      const q = ((col >> 1) & 1) | (((row >> 1) & 1) << 1);
      const ai = ((row >> 2) << 3) | (col >> 2);
      const at = nt * 16 + ai; // attr_shadow is 64 bytes per nametable, nt in $100 steps: nt*16
      shadow[at] = (shadow[at] & ~(3 << (2 * q))) | ((t.pal & 3) << (2 * q));
      w.push(`A${h2(nt + 0x23)}`, `A${h2(ai | 0xc0)}`, `D${h2(shadow[at])}`);
      blocks.push({ id, col, row, nt, vary, at });
      cur++;
      if (cur >= pre.len) { active = 0; break; }
      vary++;
      if (vary === GEOM[ring].wrap[active]) vary = 0;
      n--;
      if (n === 0) break;
    }
  }
  return { writes: w, post: { active, cur, vary, vlen, ready }, shadow, blocks, chunk, strip, drained };
}

// ---- recorder output --------------------------------------------------------------------------------------------------------------------------------
export function parseNmiOutput(stdout) {
  const err = /^ERROR (.*)$/m.exec(stdout);
  const cases = [];
  const nmis = [];
  for (const line of stdout.split('\n')) {
    let m;
    if ((m = /^CASE (\d+) (\S+) (\S+)$/.exec(line))) cases.push({ idx: +m[1], name: m[2], mode: m[3] });
    else if (line.startsWith('NMI ')) {
      const kv = Object.fromEntries(line.trim().split(' ').slice(1).map((t) => { const i = t.indexOf('='); return [t.slice(0, i), t.slice(i + 1)]; }));
      const pre = kv.pre.split(',').map(Number), post = kv.post.split(',').map(Number);
      nmis.push({
        caseIdx: +kv.case, name: kv.name, frame: +kv.f,
        pre: { active: pre[0], cur: pre[1], len: pre[2], vary: pre[3], fnt: pre[4], ftile: pre[5], ready: pre[6], vlen: pre[7], sm: pre.length > 8 ? pre[8] : null, lock: pre.length > 9 ? pre[9] : null, sbuf: unhex(kv.sbuf), shadow: unhex(kv.shadow), vbuf: unhex(kv.vbuf) },
        entry: { scanline: +kv.sl0, cycle: +kv.cy0 },
        post: { active: post[0], cur: post[1], vary: post[2], vlen: post[3], ready: post[4], shadow: unhex(kv.postshadow) },
        rti: { scanline: +kv.sl, cycle: +kv.cy },
        // the mapper-window writes the NMI made, in order ([{ addr, val }]); null = the trace carries no such record (an older recorder)
        mw: kv.mw === undefined ? null : kv.mw === '-' ? [] : kv.mw.split(',').map((x) => { const [a, v] = x.split(':'); return { addr: parseInt(a, 16), val: parseInt(v, 16) }; }),
        writes: kv.w === '-' ? [] : kv.w.split(',')
      });
    }
  }
  return { cases, nmis, done: /^DONE /m.test(stdout), shortCase: /^SHORT /m.test(stdout), error: err ? err[1] : null };
}

// ---- the timing domain (round 2, finding 2) -------------------------------------------------------------------------------------------------------------
// What one block's cost depends on (engine/streamworld.asm sw_ns_draw_block): the attribute quadrant q = ((col>>1)&1) | (((row>>1)&1)<<1) (two shift loops, 9 cycles an iteration),
// the wrap / chunk-end / strip-end branches, the page crossings of the five metatile tables (mt_tl/tr/bl/br/pal,x) and of sbuf,y, and -- beside a queue -- the drain. A strip of len == P visits
// every ring offset exactly once, so the START OFFSET only changes which blocks share a chunk and where the wrap falls; the strip coordinate's bit 1 fixes one half of q's bits and the
// offset parity the other. The plan therefore covers EVERY legal start on BOTH live nametables, for strip-only and mixed work, in both coordinate classes (cq), plus a worst-case family.
export const COORD_CLASSES = [0, 1];
export const SHAPE_A = 'A'; // one 32-byte packet (vram_len 35): the largest admitted queue by bytes
export const SHAPE_B = 'B'; // eight packets, seven of one data byte and one of four (vram_len 35): the largest admitted queue by packet headers
/** The packets of a queue shape: [{hi, lo, vals}]. A is PACKET; B is eight palette-entry packets. */
export function packetsFor(shape) {
  if (shape === SHAPE_B) return [...Array.from({ length: 7 }, (_, i) => ({ hi: 0x3f, lo: i, vals: [0x20 + i] })), { hi: 0x3f, lo: 8, vals: [0x28, 0x29, 0x2a, 0x2b] }];
  return [{ hi: PACKET.hi, lo: PACKET.lo, vals: Array.from({ length: PACKET.count }, (_, i) => (PACKET.first + i) % 256) }];
}
/** The queue shape a recorded vram_buf holds: `${packets}p/${vlen}` (vlen = headers + data, the engine's own vram_len). */
export function queueShape(vbuf) {
  let i = 0, n = 0, len = 0;
  while (i < vbuf.length && vbuf[i] !== 0) { const c = vbuf[i + 2]; n++; len += 3 + c; i += 3 + c; }
  return `${n}p/${len}`;
}
const SHAPE_KEY = { [SHAPE_A]: '1p/35', [SHAPE_B]: '8p/35' };
/**
 * The metatile ids that cost the most to read: those whose table lookups cross a page in the most of the five tables of THIS build (`tableLo`: the low byte of each table's address).
 * At most 8, lowest id first among ties. Returns { ids, crossings, perId }.
 */
export function worstMetatiles(tableLo, existing) {
  const perId = existing.map((id) => ({ id, c: tableLo.filter((lo) => lo + id > 255).length })).sort((a, b) => b.c - a.c || a.id - b.id);
  const top = perId[0]?.c ?? 0;
  return { ids: perId.filter((x) => x.c === top).slice(0, 8).map((x) => x.id), crossings: top, perId };
}
/** Every tuple the timing domain requires of a ring: any strip of each (mode, st_fnt, start, coordinate class), and the worst family (class 1) of each (mode, st_fnt, start) -- for mixed work under BOTH queue shapes. */
export function requiredCover(ring) {
  const g = GEOM[ring];
  const any = [], worst = [];
  for (const mode of ['strip', 'mixed']) for (const fnt of g.fnt) for (let v = 0; v < g.P; v++) {
    for (const cq of COORD_CLASSES) any.push(`${mode}|nt${fnt}|s${v}|c${cq}`);
    if (mode === 'strip') worst.push(`${mode}|nt${fnt}|s${v}|c1`);
    else for (const shape of [SHAPE_A, SHAPE_B]) worst.push(`${mode}|nt${fnt}|s${v}|c1|${shape}`);
  }
  return { any, worst };
}
/** The block classes the model produces over every required strip: `${mode}|q${q}|${kind}` (kind: normal | chunkEnd | wrap | stripEnd), so the quadrant classes are required, not assumed. */
export function requiredClasses(ring, tilesById) {
  const g = GEOM[ring], out = new Set();
  const id = Number(Object.keys(tilesById)[0]);
  for (const mode of ['strip', 'mixed']) for (const fnt of g.fnt) for (let v = 0; v < g.P; v++) for (const cq of COORD_CLASSES) {
    let pre = { active: g.axis, cur: 0, len: g.len, vary: v, fnt, ftile: 4 + 2 * cq, ready: mode === 'mixed' ? 1 : 0, vlen: mode === 'mixed' ? 35 : 0, sbuf: new Uint8Array(32).fill(id), shadow: new Uint8Array(256), vbuf: new Uint8Array(64) };
    for (let guard = 0; guard < 40 && pre.active !== 0; guard++) {
      if (mode === 'mixed') { pre.vbuf = Uint8Array.from([0x3f, 0, 32, ...new Array(32).fill(1), 0]); pre.vlen = 35; pre.ready = 1; }
      const e = modelNmi(pre, { ring, tiles: tilesById });
      for (const c of blockClasses(e.blocks, pre, g, e.post, mode)) out.add(c);
      pre = { ...pre, active: e.post.active, cur: e.post.cur, vary: e.post.vary, shadow: e.shadow };
    }
  }
  return out;
}
/** Class keys of the blocks one NMI drew (`blocks` from modelNmi). */
function blockClasses(blocks, pre, g, post, mode) {
  return blocks.map((b, j) => {
    const q = ((b.col >> 1) & 1) | (((b.row >> 1) & 1) << 1);
    const last = pre.cur + j + 1 >= pre.len;
    const kind = last ? 'stripEnd' : b.vary === g.wrap[pre.active] - 1 ? 'wrap' : j === blocks.length - 1 ? 'chunkEnd' : 'normal';
    return `${mode}|q${q}|${kind}`;
  });
}

/**
 * Did this interrupt's tail take split_arm's ARMED path (engine/split.asm split_arm -> split_arm_go)? Evidence is what the NMI EXECUTED, not the poke: the lock byte was down at entry
 * (split_lock != 0 returns before any mapper write), split_mode held the box mode, and the mapper window saw exactly select-R1 ($8000=1), the R1 value, then the latch, reload and enable
 * ($C000, $C001, $E001 with one non-zero count). The disarmed branch ($E000) and the locked early return (no write) do not qualify. Returns { ok, why }.
 */
export function splitArmed(pre, mw, splBox) {
  if (pre.lock === null || pre.lock === undefined || !Array.isArray(mw)) return { ok: false, why: 'the trace records no split_lock / mapper-write evidence for this interrupt' };
  if (pre.lock !== 0) return { ok: false, why: `split_lock was ${pre.lock} at NMI entry (split_arm returns early)` };
  if (pre.sm !== splBox) return { ok: false, why: `split_mode was ${pre.sm}, not ${splBox}` };
  const want = [0x8000, 0x8001, 0xc000, 0xc001, 0xe001];
  if (mw.length !== want.length || !want.every((a, i) => mw[i].addr === a)) return { ok: false, why: `mapper writes [${mw.map((w) => w.addr.toString(16)).join(',')}] are not split_arm's armed sequence [8000,8001,c000,c001,e001]` };
  if (mw[0].val !== 1) return { ok: false, why: `the register select was ${mw[0].val}, not R1` };
  if (mw[2].val === 0 || mw[2].val !== mw[3].val || mw[2].val !== mw[4].val) return { ok: false, why: `the latch/reload/enable values ${mw[2].val}/${mw[3].val}/${mw[4].val} are not one non-zero count` };
  return { ok: true, why: '' };
}

/**
 * Does THIS interrupt belong to the worst family? Each contributing NMI is judged on its own observed state (never inherited from the first interrupt of its strip):
 *   ids    every metatile id this chunk actually consumed (the model's blocks, read from the observed sbuf and st_cur) is one of the build's worst ids
 *   class  the strip coordinate is in class 1
 *   queue  a strip-only NMI has no queue; a mixed NMI has a queued packet list of one of the two admitted worst shapes whose size equals vram_len, and takes the mixed arm
 *   tail   MMC3 only: the armed split_arm path executed (splitArmed)
 */
function nmiWorst(n, exp, cov, shape, mode) {
  if (!cov) return { ok: false, why: 'no coverage context' };
  const worstSet = new Set(cov.worstIds);
  if (!exp.blocks.length) return { ok: false, why: 'the interrupt drew no block' };
  const bad = exp.blocks.map((b) => b.id).filter((id) => !worstSet.has(id));
  if (bad.length) return { ok: false, why: `consumed id(s) ${[...new Set(bad)].join(',')} are not worst ids` };
  if (((n.pre.ftile >> 1) & 1) !== 1) return { ok: false, why: `strip coordinate ${n.pre.ftile} is not class 1` };
  if (mode === 'strip') { if (n.pre.ready || n.pre.vlen || shape) return { ok: false, why: 'a strip-only interrupt has a queued packet' }; }
  else {
    if (!n.pre.ready || !exp.drained || exp.chunk !== MIXED_CHUNK) return { ok: false, why: 'a mixed interrupt did not take the mixed arm with a queue' };
    if (!Object.values(SHAPE_KEY).includes(shape) || !shape.endsWith(`/${n.pre.vlen}`)) return { ok: false, why: `queue shape ${shape} (vram_len ${n.pre.vlen}) is not an admitted worst shape` };
  }
  if (cov.mmc3) { const a = splitArmed(n.pre, n.mw, cov.splBox); if (!a.ok) return { ok: false, why: a.why }; }
  return { ok: true, why: '' };
}

// ---- the judge ------------------------------------------------------------------------------------------------------------------------------------
const item = (id, status, detail, extra = {}) => ({ id, status, detail, ...extra });
const MODES = ['strip', 'mixed', 'real'];

/** Observed blocks of a write list after `skip` writes: groups of eleven (A A D D A A D D A A D). Returns { blocks, rest } -- `rest` writes that are not a whole group. */
export function observedBlocks(writes, skip) {
  const blocks = [];
  let i = skip;
  while (i + 11 <= writes.length && writes.slice(i, i + 11).every((x, k) => x[0] === 'AADDAADDAAD'[k])) {
    const v = (j) => parseInt(writes[i + j].slice(1), 16);
    blocks.push({ tl: (v(0) << 8) | v(1), bl: (v(4) << 8) | v(5), attr: (v(8) << 8) | v(9), tlTile: v(2), trTile: v(3), blTile: v(6), brTile: v(7), attrByte: v(10) });
    i += 11;
  }
  return { blocks, rest: writes.length - i };
}

/**
 * Judges the recorded NMIs of one cell's run. `ctx` = { ring, tiles, palFx, cases (the planned list: { name, mode, ... }), expectedLen? }.
 * Items (each its own predicate, never pooled):
 *   run:complete     the recorder ran every planned case to its end
 *   arm:geometry     every strip's first NMI (cur == 0) shows the ring's axis, length P, a live st_fnt, a start offset below the wrap and an even strip coordinate in range
 *   ppu:writes       the exact $2006/$2007 sequence (drain, block addresses, tiles, attribute bytes) equals the model's, for every NMI
 *   ppu:live-nt      every observed nametable and attribute address lies in a live nametable of the ring
 *   block:advance    st_cur / st_vary / st_active / vram_len / vram_ready / attr_shadow after the NMI equal the model's, and each NMI draws min(chunk, remaining) blocks
 *   strip:blocks     every strip that ran to its end drew exactly P blocks (counted from the observed writes, not from the arm)
 *   wrap:covered     the wrap (vary reaching P -> 0) occurred inside a drained strip, in both live nametables, and across a chunk boundary and inside a chunk
 *   chunk:size       strip-only NMIs drew 3 blocks and mixed NMIs 2 (until the strip's end), counted from the writes
 *   tail:scroll      every NMI ends with the $2000, $2005, $2005 scroll restore and no PPU data/address write after it
 *   deadline:strip / deadline:mixed   every nmi_rti inside vblank with rti's tail; the minimum margin is reported
 */
export function judgeNmi(parsed, ctx) {
  const items = [];
  const { ring, tiles, palFx } = ctx;
  const g = GEOM[ring];
  const planned = ctx.cases;
  const seenCases = new Set(parsed.cases.map((c) => c.idx));
  const lacking = planned.map((c, i) => [i + 1, c]).filter(([i]) => !seenCases.has(i)).map(([, c]) => c.name);
  items.push(lacking.length === 0 && parsed.done && !parsed.error && !parsed.shortCase
    ? item('run:complete', 'PASS', `${planned.length} cases, ${parsed.nmis.length} strip/queue interrupts recorded`)
    : item('run:complete', 'FAIL', `${parsed.error ? `recorder error: ${parsed.error}; ` : ''}${parsed.shortCase ? 'a case produced no completed strip; ' : ''}${lacking.length ? `cases never started: ${lacking.join(', ')}; ` : ''}${parsed.done ? '' : 'no DONE line'}`));

  const arm = [], writes = [], live = [], adv = [], blocksBad = [], chunkBad = [], tail = [], dl = { strip: [], mixed: [] };
  const margin = { strip: Infinity, mixed: Infinity };
  const stripBlocks = new Map(); // caseIdx -> blocks since the last end
  const stripEnds = [];
  const wrapSeen = { inChunk: new Set(), atBoundary: new Set(), nts: new Set() };
  let wrapStrips = 0;
  const strips = []; // every completed strip: { name, caseIdx, mode, fnt, start, cq, worst, tail, shape, nmis, min }
  const open = new Map();
  const classesSeen = new Map();
  const perMode = { strip: { min: Infinity, at: null }, mixed: { min: Infinity, at: null } };
  const obs = { strip: { dur: -Infinity, durAt: null, ent: -Infinity, entAt: null }, mixed: { dur: -Infinity, durAt: null, ent: -Infinity, entAt: null } };
  for (const [ni, n] of parsed.nmis.entries()) {
    const at = `${n.name}@f${n.frame}`;
    // --- arm geometry: the first NMI of a strip is where its arm is visible
    if (n.pre.cur === 0 && n.pre.active !== 0) {
      const bad = [];
      if (n.pre.active !== g.axis) bad.push(`axis st_active=${n.pre.active}, the ${ring === 1 ? 'vertical' : 'horizontal'} ring's strip is ${g.axis}`);
      if (n.pre.len !== g.len) bad.push(`length ${n.pre.len}, the ring's strip is ${g.len} blocks`);
      if (!g.fnt.includes(n.pre.fnt)) bad.push(`st_fnt ${n.pre.fnt}, the live nametables are st_fnt ${g.fnt.join(' or ')}`);
      if (n.pre.vary >= g.P) bad.push(`start offset ${n.pre.vary} is not below the wrap ${g.P}`);
      if (n.pre.ftile % 2 !== 0 || n.pre.ftile > g.ftileMax) bad.push(`strip coordinate ${n.pre.ftile} is not an even tile index 0..${g.ftileMax}`);
      if (bad.length) arm.push(`${at}: ${bad.join('; ')}`);
    }
    // --- the model
    let exp;
    try { exp = modelNmi(n.pre, { ring, tiles, palFx }); } catch (e) { writes.push(`${at}: ${e.message}`); continue; }
    const got = n.writes.filter((x) => x[0] === 'A' || x[0] === 'D');
    const tailW = n.writes.filter((x) => x[0] === 'C' || x[0] === 'S');
    const firstDiff = (() => { const k = Math.max(got.length, exp.writes.length); for (let i = 0; i < k; i++) if (got[i] !== exp.writes[i]) return i; return -1; })();
    if (firstDiff >= 0) writes.push(`${at}: write ${firstDiff} is ${got[firstDiff] ?? 'absent'}, the model wants ${exp.writes[firstDiff] ?? 'none'} (${got.length} writes seen, ${exp.writes.length} expected)`);
    // --- live nametables, from the OBSERVED addresses alone
    const drainWrites = exp.drained ? (() => { let i = 0, c = 0; while (i < n.pre.vbuf.length && n.pre.vbuf[i] !== 0) { c += 2 + n.pre.vbuf[i + 2] + (0); i += 3 + n.pre.vbuf[i + 2]; } return c + (palFx ? 2 : 0); })() : 0;
    const ob = observedBlocks(got, drainWrites);
    if (ob.rest !== 0) live.push(`${at}: ${ob.rest} PPU writes after the drain are not a whole block`);
    for (const b of ob.blocks) {
      for (const [k, a] of [['top', b.tl], ['bottom', b.bl]]) if (!inLive(ring, a)) live.push(`${at}: ${k} tile row written at $${a.toString(16)}, outside the live nametables`);
      if (!inLive(ring, (b.attr & 0x0c00) | 0x2000)) live.push(`${at}: attribute write at $${b.attr.toString(16)} belongs to a dead nametable`);
    }
    // --- advancement
    const e = exp.post, p = n.post;
    const diffs = [];
    for (const k of ['active', 'cur', 'vary', 'vlen', 'ready']) if (p[k] !== e[k]) diffs.push(`${k} ${p[k]} (model ${e[k]})`);
    if (n.pre.shadow.length && p.shadow.length === 256) { for (let i = 0; i < 256; i++) if (p.shadow[i] !== exp.shadow[i]) { diffs.push(`attr_shadow[${i}] ${p.shadow[i]} (model ${exp.shadow[i]})`); break; } }
    if (ob.blocks.length !== exp.blocks.length) diffs.push(`${ob.blocks.length} blocks drawn (model ${exp.blocks.length})`);
    if (diffs.length) adv.push(`${at}: ${diffs.join('; ')}`);
    // --- chunk size, counted from the writes: a strip that is not about to end must draw its whole chunk
    const remaining = n.pre.len - n.pre.cur;
    const wantBlocks = exp.strip && n.pre.active !== 0 ? Math.min(exp.chunk, remaining) : 0;
    if (ob.blocks.length !== wantBlocks) chunkBad.push(`${at}: ${ob.blocks.length} blocks drawn, ${wantBlocks} expected (${n.pre.ready ? 'mixed, chunk 2' : 'strip-only, chunk 3'}, ${remaining} left)`);
    // --- strip accounting
    if (n.pre.active !== 0) {
      stripBlocks.set(n.caseIdx, (stripBlocks.get(n.caseIdx) ?? 0) + ob.blocks.length);
      if (n.post.active === 0) { stripEnds.push({ at, caseIdx: n.caseIdx, blocks: stripBlocks.get(n.caseIdx), len: n.pre.len, mode: planned[n.caseIdx - 1]?.mode }); stripBlocks.set(n.caseIdx, 0); }
      // wrap coverage, from the model's own sequence of offsets
      let v = n.pre.vary, c = n.pre.cur;
      for (let i = 0; i < exp.blocks.length; i++) {
        v = exp.blocks[i].vary;
        if (v === g.P - 1 && i + 1 < exp.blocks.length && exp.blocks[i + 1].vary === 0) { wrapSeen.inChunk.add(n.pre.fnt); wrapSeen.nts.add(n.pre.fnt); wrapStrips++; }
        if (v === g.P - 1 && i + 1 === exp.blocks.length && exp.post.vary === 0 && exp.post.active) { wrapSeen.atBoundary.add(n.pre.fnt); wrapSeen.nts.add(n.pre.fnt); wrapStrips++; }
      }
      void c;
    }
    // --- scroll tail
    const lastAD = n.writes.map((x, i) => (x[0] === 'A' || x[0] === 'D' ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    const tailOk = tailW.length >= 3 && n.writes.slice(-3).map((x) => x[0]).join('') === 'CSS' && lastAD < n.writes.length - 3;
    if (!tailOk) tail.push(`${at}: the NMI does not end with $2000,$2005,$2005 after its last PPU address/data write (${n.writes.slice(-4).join(',')})`);
    // --- deadline
    const mode = n.pre.ready ? 'mixed' : 'strip';
    const v = vblankMargin(n.rti.scanline, n.rti.cycle);
    {
      // the observed duration (first handler instruction to nmi_rti) and entry delay (the NMI edge at scanline 241 dot 1 to the first handler instruction), both in CPU cycles
      const dur = (dotsAt(n.rti.scanline, n.rti.cycle) - dotsAt(n.entry.scanline, n.entry.cycle)) / 3, ent = (dotsAt(n.entry.scanline, n.entry.cycle) - dotsAt(VBLANK_FIRST, 1)) / 3;
      if (dur > obs[mode].dur) { obs[mode].dur = dur; obs[mode].durAt = at; }
      if (ent > obs[mode].ent) { obs[mode].ent = ent; obs[mode].entAt = at; }
    }
    if (!v.ok) dl[mode].push(`${at}: ${v.why}`); else { margin[mode] = Math.min(margin[mode], v.margin); if (v.margin < perMode[mode].min) perMode[mode] = { min: v.margin, at }; }
    // --- the timing domain this strip occupies, from the OBSERVED pre-state (never from the plan)
    if (n.pre.active !== 0) {
      const cq = (n.pre.ftile >> 1) & 1;
      const shape = n.pre.ready ? queueShape(n.pre.vbuf) : null;
      if (n.pre.cur === 0) open.set(n.caseIdx, { name: n.name, caseIdx: n.caseIdx, mode, fnt: n.pre.fnt, start: n.pre.vary, cq, shape, nmis: 0, worstNmis: 0, consistent: true, why: null, worstWhy: null, min: Infinity });
      const o = open.get(n.caseIdx);
      if (o) {
        o.nmis++;
        if (v.ok) o.min = Math.min(o.min, v.margin);
        // one strip is one kind of work from its first interrupt to its last: the same mode, nametable, coordinate class and (mixed) queue shape on EVERY interrupt
        if (mode !== o.mode || n.pre.fnt !== o.fnt || cq !== o.cq || shape !== o.shape) { o.consistent = false; o.why ??= `interrupt ${o.nmis} is ${mode}/nt${n.pre.fnt}/class ${cq}/${shape ?? 'no queue'}, the strip began ${o.mode}/nt${o.fnt}/class ${o.cq}/${o.shape ?? 'no queue'}`; }
        const w = nmiWorst(n, exp, ctx.cover, shape, mode);
        if (o.nmis === 1) o.firstWorst = w.ok;
        if (w.ok) o.worstNmis++; else o.worstWhy ??= `interrupt ${o.nmis}: ${w.why}`;
      }
      for (const c of blockClasses(exp.blocks, n.pre, g, exp.post, mode)) classesSeen.set(c, (classesSeen.get(c) ?? 0) + 1);
      if (o && n.post.active === 0) { strips.push(o); open.delete(n.caseIdx); }
    }
    void ni;
  }
  const res = (id, bad, okDetail) => items.push(bad.length ? item(id, 'FAIL', `${bad.length} NMIs: ${bad.slice(0, 3).join(' | ')}`) : item(id, 'PASS', okDetail));
  res('arm:geometry', arm, `every strip's arm is the ${g.name} (axis ${g.axis}, length ${g.len}, st_fnt ${g.fnt.join('/')}, start offset < ${g.P})`);
  res('ppu:writes', writes, `${parsed.nmis.length} interrupts: every $2006/$2007 write (drain, block addresses, tiles, attribute bytes) equals the model`);
  res('ppu:live-nt', live, `every nametable/attribute address observed is in a live nametable of the ${ring === 1 ? 'vertical' : 'horizontal'} ring`);
  res('block:advance', adv, `post-NMI st_cur/st_vary/st_active/vram_len/vram_ready/attr_shadow equal the model, block counts match`);
  res('chunk:size', chunkBad, `strip-only NMIs drew ${CHUNK} blocks and mixed NMIs ${MIXED_CHUNK} (counted from the writes)`);
  const wrongLen = stripEnds.filter((s) => s.blocks !== g.len);
  items.push(stripEnds.length === 0 ? item('strip:blocks', 'UNMEASURED', 'no strip ran to its end')
    : wrongLen.length ? item('strip:blocks', 'FAIL', `${wrongLen.length} of ${stripEnds.length} strips drew ${[...new Set(wrongLen.map((s) => s.blocks))].join('/')} blocks, the ring's strip is ${g.len} (first: ${wrongLen[0].at})`)
      : item('strip:blocks', 'PASS', `${stripEnds.length} strips each drew exactly ${g.len} blocks`));
  const need = g.fnt;
  const missing = [];
  for (const f of need) { if (!wrapSeen.inChunk.has(f)) missing.push(`wrap inside a chunk at st_fnt ${f}`); if (!wrapSeen.atBoundary.has(f)) missing.push(`wrap at a chunk boundary at st_fnt ${f}`); }
  items.push(missing.length ? item('wrap:covered', 'UNMEASURED', `not exercised: ${missing.join('; ')}`) : item('wrap:covered', 'PASS', `the wrap ${g.P - 1} -> 0 occurred inside a chunk and at a chunk boundary, in both live nametables (st_fnt ${need.join(' and ')})`));
  res('tail:scroll', tail, `every interrupt ends with the scroll restore, after its last PPU write`);
  items.push(coverItem({ strips, classesSeen, ring, g, ctx, tiles }));
  for (const mode of ['strip', 'mixed']) {
    const seen = parsed.nmis.some((n) => (n.pre.ready ? 'mixed' : 'strip') === mode);
    const w = ctx.wcet;
    const bound = w && !w.error ? w[mode] : null;
    const cert = bound === null || bound === undefined ? null : certifiedMargin(bound);
    const falsified = [];
    if (bound !== null && bound !== undefined) {
      if (obs[mode].dur > bound + SAMPLE_TOLERANCE_CYCLES) falsified.push(`an observed interrupt ran ${obs[mode].dur.toFixed(2)} cycles (${obs[mode].durAt}), longer than the static bound ${bound}`);
      if (obs[mode].ent > ENTRY_DELAY_CYCLES + SAMPLE_TOLERANCE_CYCLES) falsified.push(`an observed interrupt entered ${obs[mode].ent.toFixed(2)} cycles after the NMI edge (${obs[mode].entAt}), later than the charged entry delay ${ENTRY_DELAY_CYCLES}`);
    }
    const unbounded = !w ? 'no static bound was supplied for this build'
      : w.error ? `the static bound could not be computed: ${w.error}`
        : w.mismatch?.[mode] ? `no static bound for this ROM: ${w.mismatch[mode]}`
          : bound === null || bound === undefined ? 'the static bound for this mode is missing' : null;
    const certText = cert === null ? '' : `; CERTIFIED: handler <= ${bound} cycles (static longest path of the assembled nmi, ringwcet.mjs) + entry delay ${ENTRY_DELAY_CYCLES} + rti ${RTI_CYCLES} = ${ENTRY_DELAY_CYCLES + bound + RTI_CYCLES} of ${VBLANK_CYCLES.toFixed(2)} vblank cycles, certified margin ${cert.toFixed(2)}`;
    items.push(!seen ? item(`deadline:${mode}`, 'UNMEASURED', `no ${mode} interrupt recorded`)
      : dl[mode].length ? item(`deadline:${mode}`, 'FAIL', `${dl[mode].length} interrupts miss vblank: ${dl[mode].slice(0, 2).join(' | ')}`)
        : unbounded ? item(`deadline:${mode}`, 'FAIL', `${unbounded}: the observed minimum margin ${margin[mode].toFixed(1)} cycles is not a certificate`)
          : falsified.length ? item(`deadline:${mode}`, 'FAIL', `the static bound is falsified by the observations: ${falsified.join('; ')}`)
            : cert <= 0 ? item(`deadline:${mode}`, 'FAIL', `the certified allowance leaves no positive margin: ${cert.toFixed(2)} cycles${certText}`)
              : item(`deadline:${mode}`, 'PASS', `every ${mode} interrupt finishes inside vblank (${VBLANK_FIRST}-${VBLANK_LAST}); observed minimum margin ${margin[mode].toFixed(1)} cycles (${perMode[mode].at}); observed longest handler ${obs[mode].dur.toFixed(1)} cycles, latest entry ${obs[mode].ent.toFixed(1)} cycles after the edge${certText}`,
                { margin: margin[mode], marginAt: perMode[mode].at, certified: cert, bound, entryDelay: ENTRY_DELAY_CYCLES, observedMaxDuration: obs[mode].dur, observedMaxEntry: obs[mode].ent }));
  }
  // the real-arm case: the engine's own arm, observed at least twice
  const real = planned.map((c, i) => [i + 1, c]).filter(([, c]) => c.mode === 'real');
  for (const [i, c] of real) {
    const armed = parsed.nmis.filter((n) => n.caseIdx === i && n.pre.cur === 0 && n.pre.active !== 0).length;
    items.push(armed >= c.strips ? item('real:armed', 'PASS', `the engine armed ${armed} strips itself under the held ${c.btn} button (no poke)`) : item('real:armed', 'UNMEASURED', `the engine armed ${armed} strips, ${c.strips} required`));
  }
  return items;
}

/**
 * cover:domain -- the per-cell coverage predicate. FAILs (never UNMEASURED) when any required tuple, any required block class or the worst family is missing, naming what is missing.
 *   any   every (mode, st_fnt, start offset, coordinate class) completed at least once, from the observed pre-state of the first NMI of each strip
 *   worst every (mode, st_fnt, start offset) completed in coordinate class 1 with EVERY interrupt of the strip qualifying (nmiWorst: the worst metatile ids that chunk consumed, the
 *         queue -- mixed work under each of the two largest admitted queues, one 32-byte packet or eight small packets, vram_len 35 both -- and, on MMC3, the armed split_arm path
 *         actually executed with split_lock down). A strip that began worst but lost any of it on a later interrupt is not credited.
 *   classes every (mode, q, kind) block class the model produces over the required strips was observed
 * The per-strip timing evidence (smallest margin of the strip's interrupts) is carried in `cases`.
 */
function coverItem({ strips, classesSeen, ring, g, ctx, tiles }) {
  const cov = ctx.cover;
  if (!cov) return item('cover:domain', 'UNMEASURED', 'the judge was given no coverage context (worst ids, tail): the timing domain was not checked');
  const need = requiredCover(ring);
  const haveAny = new Set(), haveWorst = new Set();
  const lost = []; // strips that began as worst-family work but lost it on a later interrupt, or were not one kind of work throughout
  for (const s of strips) {
    if (!s.consistent) { lost.push(`${s.name}: ${s.why}`); continue; }
    const key = `${s.mode}|nt${s.fnt}|s${s.start}|c${s.cq}`;
    haveAny.add(key);
    const shape = s.mode === 'strip' ? null : Object.entries(SHAPE_KEY).find(([, k]) => k === s.shape)?.[0] ?? '?';
    // the worst family is credited only when EVERY interrupt of the strip qualified (ids consumed in that chunk, queue, class and -- MMC3 -- the executed armed tail)
    if (s.nmis > 0 && s.worstNmis === s.nmis && s.cq === 1 && (s.mode === 'strip' ? s.shape === null : shape !== '?')) haveWorst.add(shape ? `${key}|${shape}` : key);
    else if (s.worstNmis > 0 && s.worstNmis < s.nmis && s.worstWhy && s.firstWorst) lost.push(`${s.name}: ${s.worstNmis} of ${s.nmis} interrupts qualified, ${s.worstWhy}`);
  }
  const missAny = need.any.filter((k) => !haveAny.has(k));
  const missWorst = need.worst.filter((k) => !haveWorst.has(k));
  const reqClasses = requiredClasses(ring, tiles);
  const missClass = [...reqClasses].filter((c) => !classesSeen.has(c));
  const bad = [];
  if (missAny.length) bad.push(`${missAny.length} of ${need.any.length} required (mode, st_fnt, start, class) strips never completed as one kind of work throughout, e.g. ${missAny.slice(0, 4).join(', ')}${lost.length ? `; ${lost.length} strip(s) changed kind part-way, e.g. ${lost[0]}` : ''}`);
  if (missWorst.length) bad.push(`${missWorst.length} of ${need.worst.length} worst-family strips never completed with EVERY interrupt qualifying (worst ids ${cov.worstIds.join(',')}${cov.mmc3 ? ', executed armed split tail, split_lock down' : ''}; mixed work under both the 1-packet and the 8-packet queue), e.g. ${missWorst.slice(0, 4).join(', ')}${lost.length ? `; ${lost.length} strip(s) lost it part-way, e.g. ${lost[0]}` : ''}`);
  if (missClass.length) bad.push(`${missClass.length} of ${reqClasses.size} block classes never observed, e.g. ${missClass.slice(0, 4).join(', ')}`);
  const q = [0, 1, 2, 3].map((k) => [...classesSeen].filter(([c]) => c.includes(`|q${k}|`)).reduce((a, [, n]) => a + n, 0));
  const cases = strips.map((s) => ({ name: s.name, mode: s.mode, fnt: s.fnt, start: s.start, cq: s.cq, nmis: s.nmis, worstNmis: s.worstNmis, minMargin: s.min === Infinity ? null : Number(s.min.toFixed(2)) }));
  const detail = bad.length ? bad.join('; ')
    : `all ${need.any.length} (mode, st_fnt, start 0-${g.P - 1}, class) strips and all ${need.worst.length} worst-family strips completed; ${reqClasses.size} block classes observed (blocks per quadrant q0-q3: ${q.join('/')}); worst metatile ids ${cov.worstIds.join(',')} cross a page in ${cov.crossings} of 5 tables${cov.mmc3 ? '; on every worst-family interrupt split_lock was down and split_arm\'s armed sequence ($8000,$8001,$C000,$C001,$E001) executed' : ''}`;
  return item('cover:domain', bad.length ? 'FAIL' : 'PASS', detail, { cases });
}

// ---- cases --------------------------------------------------------------------------------------------------------------------------------------------
/** Metatile ids for sbuf: 1..24 varying with position so a shifted or aliased block shows. */
const idsFor = (k, len) => Array.from({ length: Math.max(len, 32) }, (_, i) => 1 + ((i * 5 + k * 3 + 1) % 24));
export const MUTATIONS = {
  // a harness mutation changes what the poked arm writes; the judge must reject each one under its OWN item (declared in controls.mjs)
  'arm-len30': 'poked strips are armed 30 blocks long',
  'arm-wrong-axis': 'poked strips are armed on the other axis (a row strip on the vertical ring, a column strip on the horizontal one)',
  'arm-start-past-wrap': 'poked strips start at an offset equal to the wrap (P), past the last block of the ring',
  // the coverage-removal controls: the PLAN loses part of the required timing domain; cover:domain (computed from geometry alone, never from the plan) must say so
  'cover-drop-start': 'the plan omits every poked case that starts at the middle offset of the ring',
  'cover-drop-class': 'the plan omits the second strip-coordinate class (st_ftile bit 1 set) from every mixed case',
  'cover-drop-worst': 'the plan omits the worst-id / worst-queue / armed-tail family'
};

/** Strip coordinates by class cq = (st_ftile >> 1) & 1: all even, ending at the ring's own maximum so the extreme coordinate is exercised too. */
const FTILES = (g) => [[4, 0, 8, 12, 16, 20, 24, 28].filter((t) => t <= g.ftileMax), [2, 6, 10, 14, 18, 22, 26, 30].filter((t) => t <= g.ftileMax)];

/**
 * The planned cases for a ring: poked strips at EVERY legal start offset (0..P-1) on both live nametables, strip-only and mixed, in both coordinate classes; then the worst family
 * (worst metatile ids, class 1, the worst admitted queue for mixed work, the armed split tail on MMC3) at every start; then the engine's own arms.
 * `cover` = { worstIds, mmc3 }.
 */
export function planCases(ring, { mutation = null, cover = { worstIds: [1], mmc3: false } } = {}) {
  const g = GEOM[ring];
  const cases = [];
  const ft = FTILES(g);
  let k = 0;
  const base = (mode, fam, fnt, v, cq, shape) => {
    k++;
    let active = g.axis, len = g.len, start = v;
    let ftile = ft[cq][(k >> 1) % ft[cq].length];
    if (mutation === 'arm-len30') len = 30;
    if (mutation === 'arm-wrong-axis') { active = 3 - g.axis; len = active === 1 ? (ring === 1 ? 15 : 30) : (ring === 2 ? 16 : 32); start = 0; }
    if (mutation === 'arm-start-past-wrap') start = g.P;
    if (active !== g.axis) ftile = Math.min(ftile, active === 1 ? 30 : 28);
    const ids = fam === 'worst' ? Array.from({ length: 32 }, (_, i) => cover.worstIds[(i + k) % cover.worstIds.length]) : idsFor(k, len);
    const c = { name: `${mode}${shape ?? ''}-${fam}-s${v}-nt${fnt}-c${cq}`, mode, active, len, fnt, vary: start, ftile, ids, maxFrames: 80 };
    if (mode === 'mixed') c.packets = packetsFor(shape);
    if (fam === 'worst' && cover.mmc3) c.tail = 'armed';
    return c;
  };
  const drop = (fam, v, cq, mode) => (mutation === 'cover-drop-start' && v === Math.floor(g.P / 2))
    || (mutation === 'cover-drop-class' && mode === 'mixed' && cq === 1)
    || (mutation === 'cover-drop-worst' && fam === 'worst');
  // base: strip-only and mixed (queue shape A) in both coordinate classes; worst: strip-only, mixed under shape A and mixed under shape B, class 1
  const plan = [['base', 'strip', null, COORD_CLASSES], ['base', 'mixed', SHAPE_A, COORD_CLASSES], ['worst', 'strip', null, [1]], ['worst', 'mixed', SHAPE_A, [1]], ['worst', 'mixed', SHAPE_B, [1]]];
  for (const [fam, mode, shape, classes] of plan) for (const fnt of g.fnt) for (let v = 0; v < g.P; v++) for (const cq of classes) {
    if (drop(fam, v, cq, mode)) continue;
    cases.push(base(mode, fam, fnt, v, cq, fam === 'worst' ? shape : null));
  }
  cases.push({ name: 'real-walk', mode: 'real', btn: ring === 1 ? 'right' : 'down', strips: 4, maxFrames: 900 });
  return cases;
}

const lua = (v) => {
  if (Array.isArray(v)) return `{${v.map(lua).join(',')}}`;
  if (v && typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${k}=${lua(x)}`).join(',')}}`;
  return typeof v === 'string' ? JSON.stringify(v) : String(v);
};

/** The tile table the judge compares against: the project's own metatiles (id -> four tiles, palette). */
export const tilesOf = (project) => Object.fromEntries(Object.entries(project.metatiles).map(([id, m]) => [Number(id), { tl: m.tiles[0], tr: m.tiles[1], bl: m.tiles[2], br: m.tiles[3], pal: m.palette ?? 0 }]));

const RAM_NAMES = ['game_state', 'map_is_streamed', 'st_active', 'st_cur', 'st_len', 'st_ftile', 'st_fnt', 'st_vary', 'sbuf', 'vram_len', 'vram_buf', 'vram_ready', 'attr_shadow', 'split_mode', 'split_lock'];
const TABLE_NAMES = ['mt_tl', 'mt_tr', 'mt_bl', 'mt_br', 'mt_pal'];

/**
 * Builds one cell's NMI-ring ROM and Lua (no Mesen). `breakMode` ('chunk4' | 'mixed3') patches the BUILT ROM's own operand, as build_sw_nmi_roms.mjs always has.
 * Returns { tree, built, dir, romPath, luaPath, cases, ring, tiles, palFx, dispose }.
 */
export async function buildNmiRing({ cell, gt = 'action', placement = 'resident', sabotage = null, mutation = null, breakMode = null, outDir = null, provDir = null, label = null, links = {}, tree = null, bulkText = null }) {
  if (mutation && !(mutation in MUTATIONS)) throw new Error(`unknown --mutation ${mutation}: ${Object.keys(MUTATIONS).join(', ')}`);
  if (breakMode && !['chunk4', 'mixed3'].includes(breakMode)) throw new Error(`unknown --break mode: ${breakMode}`);
  const own = !tree;
  const t = tree ?? makeTree({ ring: true, extra: sabotage ? [sabotage] : [] });
  const banked = placement === 'banked';
  const { project } = ringProject({ cell, gameType: gt, n: 4, talkers: 'none', start: { screen: 0, x: 120, y: 120 }, bulkText: bulkText ?? (banked ? 3000 : 100) });
  const stamp = label ?? `s1c-nmi-${sabotage ? `sab-${sabotage}-` : ''}${mutation ? `mut-${mutation}-` : ''}${breakMode ? `brk-${breakMode}-` : ''}${cell.id}-${gt}-${placement}`;
  const built = await buildCell({ tree: t, project, cell, gameType: gt, label: stamp, provDir, links, requestedPlacement: placement, sabotage });
  try {
    const sym = built.symbols;
    for (const n of RAM_NAMES) if (!sym.has(n)) throw new Error(`${n} did not resolve out of this build's own constants.asm/config.inc`);
    for (const n of ['main_loop_ready', 'nmi', 'nmi_rti', 'sw_ns_go', 'sw_nsr_go']) if (!Number.isFinite(built.fns[n])) throw new Error(`${n} is not a symbol of this build`);
    const rom = Buffer.from(built.rom);
    const fileOffset = (cpu) => 16 + (rom[4] - 1) * 16384 + (cpu - 0xc000);
    const patchOperand = (label2, want, to) => {
      const off = fileOffset(built.fns[label2] + 1);
      if (rom[off] !== want) throw new Error(`expected byte ${want} at ${label2}+1 (file offset ${off}), found ${rom[off]} -- the fixed-bank offset formula may be stale`);
      rom[off] = to;
    };
    if (breakMode === 'chunk4') patchOperand('sw_ns_go', CHUNK, 4); else if (breakMode === 'mixed3') patchOperand('sw_nsr_go', MIXED_CHUNK, 3);
    const wcet = wcetFor({ rom, fns: built.fns, symbols: sym, ring: cell.ring });
    const outd = outDir ?? built.dir;
    fs.mkdirSync(outd, { recursive: true });
    const romPath = path.join(outd, 'sw_nmi.nes');
    fs.writeFileSync(romPath, rom);
    // the worst metatile ids of THIS build: those whose lookups cross a page in the most of the five metatile tables (symbol addresses out of the build's own game.fns)
    for (const n of TABLE_NAMES) if (!Number.isFinite(built.fns[n])) throw new Error(`${n} is not a symbol of this build`);
    const existing = Object.keys(built.project.metatiles).map(Number).filter((id) => id >= 1 && id <= 63);
    const worst = worstMetatiles(TABLE_NAMES.map((n) => built.fns[n] & 255), existing);
    const mmc3 = cell.id.startsWith('MMC3');
    const cover = { worstIds: worst.ids, crossings: worst.crossings, mmc3, splBox: Number(sym.get('SPL_BOX')) };
    const cases = planCases(cell.ring, { mutation, cover });
    const addr = Object.fromEntries(RAM_NAMES.map((n) => [n, sym.get(n)]));
    let text = fs.readFileSync(NMI_TEMPLATE, 'utf8');
    const subs = [['__ADDR__', lua(addr)], ['__MAIN_LOOP_READY__', String(built.fns.main_loop_ready)], ['__NMI_ENTRY__', String(built.fns.nmi)], ['__NMI_RTI__', String(built.fns.nmi_rti)],
      ['__ST_GAMEPLAY__', String(sym.get('ST_GAMEPLAY'))], ['__CASES__', lua(cases)], ['__PACKET__', lua(PACKET)], ['__SPL_BOX__', String(cover.splBox)]];
    for (const [tok, v] of subs) { if (text.split(tok).length !== 2) throw new Error(`expected one ${tok}`); text = text.split(tok).join(v); }
    const luaPath = path.join(outd, 'sw_nmi_ring.lua');
    fs.writeFileSync(luaPath, text);
    return { tree: t, built, dir: built.dir, outDir: outd, romPath, luaPath, cases, cover, wcet, tableLo: TABLE_NAMES.map((n) => ({ table: n, addr: built.fns[n] })), ring: cell.ring, tiles: tilesOf(built.project), palFx: Boolean(sym.get('PALETTE_FX_ENABLED')), romSha256: sha256(rom), luaSha256: sha256(text), dispose: () => { fs.rmSync(built.dir, { recursive: true, force: true }); if (own) fs.rmSync(t.root, { recursive: true, force: true }); } };
  } catch (e) { fs.rmSync(built.dir, { recursive: true, force: true }); if (own) fs.rmSync(t.root, { recursive: true, force: true }); throw e; }
}

/** One Mesen process, in the caller's private HOME (mesenCtx = openIsolatedHome().ctx), returning its stdout and exit status. */
export function spawnMesen(luaPath, romPath, mesenCtx, { timeoutMs = 240000, purpose = 'nmi' } = {}) {
  if (mesenUnavailable()) throw new Error(mesenUnavailable());
  const home = mesenCtx?.mesenEnv?.HOME;
  if (!home || path.resolve(home) === path.resolve(os.homedir())) throw new Error('a ring Mesen run needs a private HOME (ringhome.openIsolatedHome): refusing to spawn under the parent HOME');
  return new Promise((resolve, reject) => {
    const child = spawn(MESEN, ['--testRunner', '--doNotSaveSettings', '--enableStdout', luaPath, romPath], { stdio: ['ignore', 'pipe', 'pipe'], env: mesenCtx.mesenEnv });
    mesenCtx.onMesenChild?.(child, { spec: purpose, purpose });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr: stderr.slice(0, 400) }); });
  });
}
