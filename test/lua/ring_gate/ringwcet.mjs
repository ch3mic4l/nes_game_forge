// The static worst-case cost of the streamed NMI path, read from the ASSEMBLED ROM (round 3, finding 3). Phase 3b S1c row 5 measures the NMI deadline on Mesen for the cases the harness
// plans; this module is the finite bound around them. It decodes the real bytes of the fixed bank (`nmi` ... `nmi_rti`), follows every branch, jump and subroutine call, and returns the
// longest path in CPU cycles under explicit, source-cited loop bounds -- so the bound is a property of the assembled build (its actual branch pages, its actual table addresses, its
// enabled cleanup) and not of the cases the harness happened to run. The judge (ringnmi.mjs) cross-checks it against every observed interrupt (an observed NMI longer than the bound
// falsifies the bound) and derives the certified margin from it.
//
// What is bounded and how:
//   * instruction cycles: the documented NMOS 6502 table (OPCODES below, unit-tested against hand-assembled bytes); a conditional branch costs its worst outcome (taken, +1 when the
//     target is on another page than the next instruction); an indexed read adds a page-crossing cycle whenever the base address plus the largest index that access can see can cross.
//     An (indirect),Y read is charged the cycle always (its pointer is not known statically).
//   * every cycle in the control-flow graph must be bounded by a BUDGET: a resource the loop spends (queue bytes, strip blocks, shift iterations). Passing a charging instruction
//     spends its charge; a path that would exceed the limit is infeasible. A loop that no budget bounds throws -- the analysis fails closed instead of guessing an iteration count.
//   * `sta $4014` (OAM DMA) costs its 4 cycles plus 514: the CPU is halted 513 cycles, one more when the write falls on an odd cycle, and the parity is not tracked.
//   * a mode (strip only / strip beside a queue) forces the arbitration branches of nmi_vram_dispatch; every other branch is adversarial (the worst outcome), so the bound covers the
//     handler's longest prologue and tail whatever the scene happens to exercise.
import { Buffer } from 'node:buffer';

// ---- the instruction table -----------------------------------------------------------------------------------------------------------------------------
// [opcode, mnemonic, mode, base cycles]. Modes: imp acc imm zp zpx zpy abs abx aby izx izy rel ind.
const T = [
  [0x00, 'BRK', 'imp', 7], [0x01, 'ORA', 'izx', 6], [0x05, 'ORA', 'zp', 3], [0x06, 'ASL', 'zp', 5], [0x08, 'PHP', 'imp', 3], [0x09, 'ORA', 'imm', 2], [0x0a, 'ASL', 'acc', 2], [0x0d, 'ORA', 'abs', 4], [0x0e, 'ASL', 'abs', 6],
  [0x10, 'BPL', 'rel', 2], [0x11, 'ORA', 'izy', 5], [0x15, 'ORA', 'zpx', 4], [0x16, 'ASL', 'zpx', 6], [0x18, 'CLC', 'imp', 2], [0x19, 'ORA', 'aby', 4], [0x1d, 'ORA', 'abx', 4], [0x1e, 'ASL', 'abx', 7],
  [0x20, 'JSR', 'abs', 6], [0x21, 'AND', 'izx', 6], [0x24, 'BIT', 'zp', 3], [0x25, 'AND', 'zp', 3], [0x26, 'ROL', 'zp', 5], [0x28, 'PLP', 'imp', 4], [0x29, 'AND', 'imm', 2], [0x2a, 'ROL', 'acc', 2], [0x2c, 'BIT', 'abs', 4], [0x2d, 'AND', 'abs', 4], [0x2e, 'ROL', 'abs', 6],
  [0x30, 'BMI', 'rel', 2], [0x31, 'AND', 'izy', 5], [0x35, 'AND', 'zpx', 4], [0x36, 'ROL', 'zpx', 6], [0x38, 'SEC', 'imp', 2], [0x39, 'AND', 'aby', 4], [0x3d, 'AND', 'abx', 4], [0x3e, 'ROL', 'abx', 7],
  [0x40, 'RTI', 'imp', 6], [0x41, 'EOR', 'izx', 6], [0x45, 'EOR', 'zp', 3], [0x46, 'LSR', 'zp', 5], [0x48, 'PHA', 'imp', 3], [0x49, 'EOR', 'imm', 2], [0x4a, 'LSR', 'acc', 2], [0x4c, 'JMP', 'abs', 3], [0x4d, 'EOR', 'abs', 4], [0x4e, 'LSR', 'abs', 6],
  [0x50, 'BVC', 'rel', 2], [0x51, 'EOR', 'izy', 5], [0x55, 'EOR', 'zpx', 4], [0x56, 'LSR', 'zpx', 6], [0x58, 'CLI', 'imp', 2], [0x59, 'EOR', 'aby', 4], [0x5d, 'EOR', 'abx', 4], [0x5e, 'LSR', 'abx', 7],
  [0x60, 'RTS', 'imp', 6], [0x61, 'ADC', 'izx', 6], [0x65, 'ADC', 'zp', 3], [0x66, 'ROR', 'zp', 5], [0x68, 'PLA', 'imp', 4], [0x69, 'ADC', 'imm', 2], [0x6a, 'ROR', 'acc', 2], [0x6c, 'JMP', 'ind', 5], [0x6d, 'ADC', 'abs', 4], [0x6e, 'ROR', 'abs', 6],
  [0x70, 'BVS', 'rel', 2], [0x71, 'ADC', 'izy', 5], [0x75, 'ADC', 'zpx', 4], [0x76, 'ROR', 'zpx', 6], [0x78, 'SEI', 'imp', 2], [0x79, 'ADC', 'aby', 4], [0x7d, 'ADC', 'abx', 4], [0x7e, 'ROR', 'abx', 7],
  [0x81, 'STA', 'izx', 6], [0x84, 'STY', 'zp', 3], [0x85, 'STA', 'zp', 3], [0x86, 'STX', 'zp', 3], [0x88, 'DEY', 'imp', 2], [0x8a, 'TXA', 'imp', 2], [0x8c, 'STY', 'abs', 4], [0x8d, 'STA', 'abs', 4], [0x8e, 'STX', 'abs', 4],
  [0x90, 'BCC', 'rel', 2], [0x91, 'STA', 'izy', 6], [0x94, 'STY', 'zpx', 4], [0x95, 'STA', 'zpx', 4], [0x96, 'STX', 'zpy', 4], [0x98, 'TYA', 'imp', 2], [0x99, 'STA', 'aby', 5], [0x9a, 'TXS', 'imp', 2], [0x9d, 'STA', 'abx', 5],
  [0xa0, 'LDY', 'imm', 2], [0xa1, 'LDA', 'izx', 6], [0xa2, 'LDX', 'imm', 2], [0xa4, 'LDY', 'zp', 3], [0xa5, 'LDA', 'zp', 3], [0xa6, 'LDX', 'zp', 3], [0xa8, 'TAY', 'imp', 2], [0xa9, 'LDA', 'imm', 2], [0xaa, 'TAX', 'imp', 2], [0xac, 'LDY', 'abs', 4], [0xad, 'LDA', 'abs', 4], [0xae, 'LDX', 'abs', 4],
  [0xb0, 'BCS', 'rel', 2], [0xb1, 'LDA', 'izy', 5], [0xb4, 'LDY', 'zpx', 4], [0xb5, 'LDA', 'zpx', 4], [0xb6, 'LDX', 'zpy', 4], [0xb8, 'CLV', 'imp', 2], [0xb9, 'LDA', 'aby', 4], [0xba, 'TSX', 'imp', 2], [0xbc, 'LDY', 'abx', 4], [0xbd, 'LDA', 'abx', 4], [0xbe, 'LDX', 'aby', 4],
  [0xc0, 'CPY', 'imm', 2], [0xc1, 'CMP', 'izx', 6], [0xc4, 'CPY', 'zp', 3], [0xc5, 'CMP', 'zp', 3], [0xc6, 'DEC', 'zp', 5], [0xc8, 'INY', 'imp', 2], [0xc9, 'CMP', 'imm', 2], [0xca, 'DEX', 'imp', 2], [0xcc, 'CPY', 'abs', 4], [0xcd, 'CMP', 'abs', 4], [0xce, 'DEC', 'abs', 6],
  [0xd0, 'BNE', 'rel', 2], [0xd1, 'CMP', 'izy', 5], [0xd5, 'CMP', 'zpx', 4], [0xd6, 'DEC', 'zpx', 6], [0xd8, 'CLD', 'imp', 2], [0xd9, 'CMP', 'aby', 4], [0xdd, 'CMP', 'abx', 4], [0xde, 'DEC', 'abx', 7],
  [0xe0, 'CPX', 'imm', 2], [0xe1, 'SBC', 'izx', 6], [0xe4, 'CPX', 'zp', 3], [0xe5, 'SBC', 'zp', 3], [0xe6, 'INC', 'zp', 5], [0xe8, 'INX', 'imp', 2], [0xe9, 'SBC', 'imm', 2], [0xea, 'NOP', 'imp', 2], [0xec, 'CPX', 'abs', 4], [0xed, 'SBC', 'abs', 4], [0xee, 'INC', 'abs', 6],
  [0xf0, 'BEQ', 'rel', 2], [0xf1, 'SBC', 'izy', 5], [0xf5, 'SBC', 'zpx', 4], [0xf6, 'INC', 'zpx', 6], [0xf8, 'SED', 'imp', 2], [0xf9, 'SBC', 'aby', 4], [0xfd, 'SBC', 'abx', 4], [0xfe, 'INC', 'abx', 7]
];
export const OPCODES = new Map(T.map(([op, m, mode, cyc]) => [op, { op, m, mode, cyc }]));
const LEN = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, izx: 2, izy: 2, rel: 2, abs: 3, abx: 3, aby: 3, ind: 3 };
/** Mnemonics whose indexed read takes a page-crossing cycle (stores and read-modify-write forms are fixed length). */
const PENALTY_READS = new Set(['ADC', 'AND', 'CMP', 'EOR', 'LDA', 'ORA', 'SBC', 'LDX', 'LDY']);
const BRANCHES = new Set(['BPL', 'BMI', 'BVC', 'BVS', 'BCC', 'BCS', 'BNE', 'BEQ']);
export const OAM_DMA_CYCLES = 514; // 513 cycles halted, +1 on an odd cycle (parity not tracked: charged)

/** The ROM bytes of the fixed bank ($C000-$FFFF), indexed by CPU address. The last 16 KB of PRG holds it on every cartridge this slice builds (the same offset formula buildNmiRing uses to patch operands). */
export function fixedBank(rom) {
  const b = Buffer.from(rom);
  const base = 16 + (b[4] - 1) * 16384;
  return (cpu) => {
    if (cpu < 0xc000 || cpu > 0xffff) throw new Error(`address $${cpu.toString(16)} is outside the fixed bank ($C000-$FFFF): interrupt-time code never runs from a switchable window`);
    return b[base + (cpu - 0xc000)];
  };
}

/** Decodes the instruction at `pc`: { pc, len, m, mode, cyc, operand, target (branch/jump/call), next }. */
export function decode(read, pc) {
  const info = OPCODES.get(read(pc));
  if (!info) throw new Error(`unassembled or illegal opcode $${read(pc).toString(16)} at $${pc.toString(16)}`);
  const len = LEN[info.mode];
  const lo = len > 1 ? read(pc + 1) : 0, hi = len > 2 ? read(pc + 2) : 0;
  const operand = len === 3 ? lo | (hi << 8) : lo;
  const d = { pc, len, m: info.m, mode: info.mode, cyc: info.cyc, operand, next: pc + len, target: null };
  if (info.mode === 'rel') d.target = d.next + (lo < 128 ? lo : lo - 256);
  else if (info.m === 'JMP' || info.m === 'JSR') d.target = info.mode === 'abs' ? operand : null;
  return d;
}

/** Instructions in [from, to) in address order (linear sweep; the ranges passed are contiguous code). */
export function sweep(read, from, to) {
  const out = [];
  for (let pc = from; pc < to;) { const d = decode(read, pc); out.push(d); pc = d.next; }
  return out;
}

// ---- the longest path -----------------------------------------------------------------------------------------------------------------------------------
/**
 * Longest path from `entry` to the arrival at an address of `stopAt` (cost 0 there), in cycles. The whole handler is ONE walk: a `jsr` pushes its return address onto an explicit stack
 * in the walk's state and the callee's instructions run under the SAME budgets, so a bound that spans several calls (blocks per interrupt, wraps per interrupt, attribute-shift iterations
 * per interrupt, queue bytes) is expressed once.
 *   opts.read       the fixed-bank reader (fixedBank)
 *   opts.indexMax   (operandAddress) => the largest index register value an abs,X / abs,Y access at that address can see (default 255)
 *   opts.force      Map(branchAddress -> true|false): the branch is taken | not taken, nothing else
 *   opts.budgets    [{ name, limit, charges: Map(instructionAddress -> n) }]: executing a charging instruction spends n; a path that would exceed `limit` is infeasible
 *   opts.stopAt     Set of addresses where the walk stops
 *   opts.trace      return the instruction addresses of the longest path
 * Throws when a cycle in the control-flow graph spends nothing (a loop no budget bounds), an indirect jump / brk / an unexpected rti is met, or a call leaves the fixed bank.
 */
export function longestPath(entry, opts) {
  const { read, indexMax = () => 255, force = new Map(), budgets = [], stopAt = new Set() } = opts;
  const dp = new Map();
  const inProgress = new Set();
  const spend = (used, pc) => {
    let next = used;
    for (let b = 0; b < budgets.length; b++) {
      const n = budgets[b].charges.get(pc);
      if (n) { if (next === used) next = used.slice(); next[b] += n; if (next[b] > budgets[b].limit) return null; }
    }
    return next;
  };
  const walk = (pc, used, stack) => {
    if (stopAt.has(pc)) return { cycles: 0, path: [] };
    const k = `${pc}|${used.join(',')}|${stack.join(',')}`;
    if (dp.has(k)) return dp.get(k);
    if (inProgress.has(k)) throw new Error(`a loop through $${pc.toString(16)} is not bounded by a budget`);
    inProgress.add(k);
    const d = decode(read, pc);
    const after = spend(used, pc);
    let result = null;
    const via = (r, extra, at = pc) => (r ? { cycles: extra + r.cycles, path: [at, ...r.path] } : null);
    if (after !== null) {
      if (d.m === 'RTS') result = stack.length === 0 ? { cycles: d.cyc, path: [pc] } : via(walk(stack[stack.length - 1], after, stack.slice(0, -1)), d.cyc);
      else if (d.m === 'RTI' || d.m === 'BRK') throw new Error(`${d.m} at $${pc.toString(16)} is reachable from the handler before its stop address`);
      else if (d.m === 'JMP') {
        if (d.target === null) throw new Error(`indirect jump at $${pc.toString(16)}`);
        result = via(walk(d.target, after, stack), d.cyc);
      } else if (d.m === 'JSR') {
        if (d.target === null || d.target < 0xc000) throw new Error(`call from $${pc.toString(16)} leaves the fixed bank (target ${d.target})`);
        result = via(walk(d.target, after, [...stack, d.next]), d.cyc);
      } else if (BRANCHES.has(d.m)) {
        const forced = force.get(pc);
        const alts = [];
        if (forced !== true) alts.push(via(walk(d.next, after, stack), d.cyc));
        if (forced !== false) alts.push(via(walk(d.target, after, stack), d.cyc + 1 + ((d.next >> 8) !== (d.target >> 8) ? 1 : 0)));
        result = alts.filter(Boolean).sort((x, y) => y.cycles - x.cycles)[0] ?? null;
      } else {
        let cyc = d.cyc;
        if ((d.mode === 'abx' || d.mode === 'aby') && PENALTY_READS.has(d.m) && (d.operand & 0xff) + indexMax(d.operand, d) > 255) cyc += 1;
        if (d.mode === 'izy' && PENALTY_READS.has(d.m)) cyc += 1;
        if (d.m === 'STA' && d.mode === 'abs' && d.operand === 0x4014) cyc += OAM_DMA_CYCLES;
        result = via(walk(d.next, after, stack), cyc);
      }
    }
    inProgress.delete(k);
    dp.set(k, result);
    return result;
  };
  const r = walk(entry, budgets.map(() => 0), []);
  if (!r) throw new Error(`entry $${entry.toString(16)}: no feasible path under the budgets`);
  return { cycles: r.cycles, path: opts.trace ? r.path : undefined };
}

// ---- the NMI path of a build -----------------------------------------------------------------------------------------------------------------------------
const NEED = ['nmi', 'nmi_rti', 'nmi_vram_dispatch', 'nmi_no_drain', 'nmi_drain_big', 'vram_drain', 'vram_drain_packet', 'vram_drain_byte', 'vram_drain_done', 'sw_nmi_stream', 'sw_ns_go', 'sw_ns_loop',
  'sw_ns_wrapdone', 'sw_nmi_stream_reduced', 'sw_nsr_go', 'sw_ns_draw_block', 'sw_ns_draw_attr', 'sw_nda_pshift', 'sw_nda_pdone', 'sw_nda_cshift', 'sw_nda_cdone'];
export const MIXED_VBLANK_MAX = 35; // MIXED_VBLANK_MAX_BYTES (engine/constants.asm): the largest queue that shares a vblank with a strip chunk

/** The largest index each indexed table the NMI path reads can be addressed with, keyed by the table's base address (exact match): the five metatile tables by the largest metatile id (1..63), sbuf by the strip buffer's last entry. */
function indexBounds(fns, symbols, maxMetatileId) {
  const b = new Map();
  for (const n of ['mt_tl', 'mt_tr', 'mt_bl', 'mt_br', 'mt_pal']) if (Number.isFinite(fns[n])) b.set(fns[n], maxMetatileId);
  const sbuf = Number(symbols?.get?.('sbuf'));
  if (Number.isFinite(sbuf)) b.set(sbuf, 31); // sw_ns_draw_block reads sbuf,y with y = st_cur < st_len <= 32
  return b;
}
const findOne = (read, from, to, pred, what) => {
  const hits = sweep(read, from, to).filter(pred);
  if (hits.length !== 1) throw new Error(`expected exactly one ${what} in $${from.toString(16)}-$${to.toString(16)}, found ${hits.length}`);
  return hits[0];
};

/**
 * The attribute quadrant index q (0..3) of a block, as sw_nda_* computes it: the low bit of the loop's shift count is ((coordinate bit 1) of the tile column), the high bit that of the tile row.
 * Along a strip the coordinate is 2 * st_vary (a block is two tiles), so its bit 1 is st_vary & 1; the other coordinate is the strip's fixed tile st_ftile (bit 1 = the "class" `cq`).
 *   axis 1 (column strip): the column is the fixed one  -> q = cq | (vary & 1) << 1
 *   axis 2 (row strip):    the row is the fixed one     -> q = (vary & 1) | cq << 1
 * Returns the largest sum of q over `chunk` consecutive blocks (st_vary wrapping at P), over every start offset and both classes.
 */
export function maxQSum(axis, P, chunk) {
  let best = 0;
  for (let cq = 0; cq <= 1; cq++) for (let start = 0; start < P; start++) {
    let sum = 0;
    for (let i = 0; i < chunk; i++) { const along = (start + i) % P & 1; sum += axis === 1 ? cq | (along << 1) : along | (cq << 1); }
    best = Math.max(best, sum);
  }
  return best;
}

/**
 * The static NMI bound of a build: cycles from the first `nmi` instruction to the arrival at `nmi_rti` (rti's own 6 cycles and the entry delay are charged by `certifiedMargin`).
 *   rom, fns, symbols   the build's ROM, game.fns labels and constants/RAM symbols
 *   geom                { axis, P } of the ring this build serves (1 column strip P=15 | 2 row strip P=16), or null for the UNREFINED bound (no ring facts: only the loop budgets)
 *   chunk, mixedChunk   when given, must equal the immediates the ROM itself loads (a patched ROM, e.g. nmi-chunk4, is refused)
 * Refinements with `geom` (each is a fact about the fixed ring builds, argued in docs/phase3b-s1c-coverage-r3.md):
 *   - the axis selectors (`lda st_active / cmp #1 / bne`) are forced to the ring's own axis, the other axis's code is dead;
 *   - st_vary < P, so the "second half" branch of sw_ns_draw_block (`cmp #P' / bcc`) is always taken (checked: its immediate must be >= P);
 *   - at most ONE st_vary wrap per interrupt (P > chunk), and the attribute shift loops run at most 2 * maxQSum(axis, P, chunk) iterations in all.
 * Returns { strip, mixed, base, drain, chunks, ... } (cycles) for the strip-only interrupt and the mixed one (a queue of at most 35 bytes beside a strip).
 */
export function nmiBound({ rom, fns, symbols, geom = null, maxMetatileId = 63, chunk = null, mixedChunk = null, trace = false }) {
  for (const n of NEED) if (!Number.isFinite(fns[n])) throw new Error(`${n} is not a symbol of this build: the NMI path cannot be bounded`);
  const read = fixedBank(rom);
  const imms = {
    chunk: findOne(read, fns.sw_ns_go, fns.sw_ns_loop, (d) => d.m === 'LDA' && d.mode === 'imm', 'lda # at sw_ns_go').operand,
    mixed: findOne(read, fns.sw_nsr_go, fns.sw_nsr_go + 8, (d) => d.m === 'LDA' && d.mode === 'imm', 'lda # at sw_nsr_go').operand
  };
  // a ROM whose chunk differs from the contract (a patched ROM, the nmi-chunk4 / nmi-mixed3 controls) is not the build this bound certifies: that mode gets no bound, only the reason
  const mismatch = {
    strip: chunk !== null && imms.chunk !== chunk ? `the ROM's SW_STREAM_CHUNK is ${imms.chunk}, the contract says ${chunk}` : null,
    mixed: mixedChunk !== null && imms.mixed !== mixedChunk ? `the ROM's SW_STREAM_MIXED_CHUNK is ${imms.mixed}, the contract says ${mixedChunk}` : null
  };
  const idx = indexBounds(fns, symbols, maxMetatileId);
  const indexMax = (operand) => idx.get(operand) ?? 255;
  const sym = (n) => { const v = Number(symbols?.get?.(n)); if (!Number.isFinite(v)) throw new Error(`${n} is not a symbol of this build`); return v; };
  // ---- the queue budget: every opened packet costs 3 queue bytes (header) and every data byte 1; a queue sharing a vblank with a strip is at most 35 bytes (3k + d <= 35)
  const header = findOne(read, fns.vram_drain_packet, fns.vram_drain_byte, (d) => d.m === 'LDY' && d.mode === 'abx', 'ldy count,x (packet header)');
  const dataByte = findOne(read, fns.vram_drain_byte, fns.vram_drain_done, (d) => d.m === 'DEY', 'dey (data byte)');
  const drawCall = findOne(read, fns.sw_ns_loop, fns.sw_ns_wrapdone, (d) => d.m === 'JSR' && d.target === fns.sw_ns_draw_block, 'jsr sw_ns_draw_block');
  const pDey = findOne(read, fns.sw_nda_pshift, fns.sw_nda_pdone, (d) => d.m === 'DEY', 'dey in the palette shift loop');
  const cDey = findOne(read, fns.sw_nda_cshift, fns.sw_nda_cdone, (d) => d.m === 'DEY', 'dey in the mask shift loop');
  // ---- the arbitration branches of nmi_vram_dispatch (boot.asm): beq nmi_no_drain on vram_ready, bcs nmi_drain_big on vram_len > 35
  const disp = sweep(read, fns.nmi_vram_dispatch, fns.nmi_vram_dispatch + 12);
  const readyBranch = disp.find((d) => d.m === 'BEQ'), bigBranch = disp.find((d) => d.m === 'BCS');
  if (!readyBranch || readyBranch.target !== fns.nmi_no_drain || !bigBranch || bigBranch.target !== fns.nmi_drain_big) throw new Error('nmi_vram_dispatch no longer has the beq nmi_no_drain / bcs nmi_drain_big shape the bound assumes');
  const cmp = disp.find((d) => d.m === 'CMP' && d.mode === 'imm');
  if (!cmp || cmp.operand !== MIXED_VBLANK_MAX + 1) throw new Error(`the arbitration threshold is cmp #${cmp?.operand}, the bound assumes #${MIXED_VBLANK_MAX + 1}`);
  // ---- the ring refinements
  const force = new Map();
  const wrapCharges = new Map();
  const refinements = [];
  if (geom) {
    const stActive = sym('st_active'), stVary = sym('st_vary');
    const loopCode = sweep(read, fns.sw_ns_loop, fns.sw_ns_wrapdone);
    const blockCode = sweep(read, fns.sw_ns_draw_block, fns.sw_ns_draw_attr);
    // the two axis selectors: `lda st_active ; cmp #1 ; bne` (the row arm is the branch target)
    const selectors = [];
    for (const code of [loopCode, blockCode]) {
      code.forEach((d, i) => { if (d.m === 'BNE' && i >= 2 && code[i - 1].m === 'CMP' && code[i - 1].mode === 'imm' && code[i - 1].operand === 1 && code[i - 2].m === 'LDA' && code[i - 2].mode === 'abs' && code[i - 2].operand === stActive) selectors.push(d); });
    }
    if (selectors.length !== 2) throw new Error(`expected two axis selectors (lda st_active / cmp #1 / bne), found ${selectors.length}`);
    for (const sel of selectors) { force.set(sel.pc, geom.axis === 2); refinements.push(`axis selector $${sel.pc.toString(16)} ${geom.axis === 2 ? 'taken' : 'not taken'}`); }
    // the "second half" selectors of sw_ns_draw_block: `lda st_vary ; cmp #X ; bcc`, X the ring wrap of that axis's own code; the live arm is the one on the ring's axis path
    const blockSel = selectors.find((d) => d.pc >= fns.sw_ns_draw_block && d.pc < fns.sw_ns_draw_attr);
    const colArm = (pc) => pc > blockSel.pc && pc < blockSel.target;
    blockCode.forEach((d, i) => {
      if (d.m === 'BCC' && i >= 2 && blockCode[i - 1].m === 'CMP' && blockCode[i - 1].mode === 'imm' && blockCode[i - 2].m === 'LDA' && blockCode[i - 2].mode === 'abs' && blockCode[i - 2].operand === stVary && (colArm(d.pc) === (geom.axis === 1))) {
        if (blockCode[i - 1].operand < geom.P) throw new Error(`the half selector at $${d.pc.toString(16)} compares st_vary with #${blockCode[i - 1].operand}, below the ring's P = ${geom.P}: the bound cannot assume it is always taken`);
        force.set(d.pc, true); refinements.push(`half selector $${d.pc.toString(16)} (cmp #${blockCode[i - 1].operand}) taken: st_vary < ${geom.P}`);
      }
    });
    if (![...force.keys()].some((pc) => pc >= fns.sw_ns_draw_block && pc < fns.sw_ns_draw_attr && blockSel.pc !== pc)) throw new Error('no half selector was found in sw_ns_draw_block for this ring axis');
    // the wrap body: `lda #0 ; sta st_vary` (one per axis arm)
    loopCode.forEach((d, i) => { if (d.m === 'LDA' && d.mode === 'imm' && d.operand === 0 && loopCode[i + 1]?.m === 'STA' && loopCode[i + 1].mode === 'abs' && loopCode[i + 1].operand === stVary) wrapCharges.set(d.pc, 1); });
    if (wrapCharges.size !== 2) throw new Error(`expected two wrap bodies (lda #0 / sta st_vary), found ${wrapCharges.size}`);
  }
  const budgetsFor = (blocks, drainLimit) => {
    const bs = [
      { name: 'queue bytes', limit: drainLimit, charges: new Map([[header.pc, 3], [dataByte.pc, 1]]) },
      { name: 'blocks', limit: blocks, charges: new Map([[drawCall.pc, 1]]) }
    ];
    if (geom) {
      if (geom.P <= blocks) throw new Error(`P = ${geom.P} does not exceed the chunk ${blocks}: more than one wrap per interrupt is possible`);
      bs.push({ name: 'wraps', limit: 1, charges: wrapCharges });
      bs.push({ name: 'attribute shift iterations', limit: 2 * maxQSum(geom.axis, geom.P, blocks), charges: new Map([[pDey.pc, 1], [cDey.pc, 1]]) });
    } else bs.push({ name: 'attribute shift iterations', limit: 2 * 3 * blocks, charges: new Map([[pDey.pc, 1], [cDey.pc, 1]]) });
    return bs;
  };
  const run = (forceMap, blocks, tr = false) => longestPath(fns.nmi, { read, indexMax, force: forceMap, budgets: budgetsFor(blocks, MIXED_VBLANK_MAX), stopAt: new Set([fns.nmi_rti]), trace: tr });
  const stripForce = new Map([...force, [readyBranch.pc, true]]);
  const mixedForce = new Map([...force, [readyBranch.pc, false], [bigBranch.pc, false]]);
  const strip = mismatch.strip ? null : run(stripForce, imms.chunk, trace);
  const mixed = mismatch.mixed ? null : run(mixedForce, imms.mixed, trace);
  const base = run(stripForce, 0).cycles; // an interrupt with no strip work: prologue, OAM DMA, scroll restore, split tail
  const drain = longestPath(fns.vram_drain, { read, indexMax, budgets: [budgetsFor(0, MIXED_VBLANK_MAX)[0]] }).cycles;
  return {
    strip: strip?.cycles ?? null, mixed: mixed?.cycles ?? null, mismatch, base, drain, chunk: imms.chunk, mixedChunk: imms.mixed, refined: Boolean(geom), refinements,
    shiftLimit: { strip: budgetsFor(imms.chunk, 0)[geom ? 3 : 2].limit, mixed: budgetsFor(imms.mixed, 0)[geom ? 3 : 2].limit },
    stripPath: strip?.path, mixedPath: mixed?.path, drainTable: drainTable({ read, fns, indexMax })
  };
}

/** The entry delay, in CPU cycles, from the NMI edge (scanline 241 dot 1) to the first handler instruction, charged on top of the handler: the instruction in flight (<= 7), the one more the branch-polling quirk can add (<= 7), the 7-cycle interrupt sequence, and one cycle of CPU/PPU phase. */
export const ENTRY_DELAY_CYCLES = 7 + 7 + 7 + 1;
export const RTI_CYCLES = 6;
/** Cycles from the NMI edge (241, dot 1) to the last legal dot (260, dot 340), the same endpoint vblankMargin measures against. */
export const VBLANK_CYCLES = ((260 - 241) * 341 + (340 - 1)) / 3;
/** The certified margin of a static bound: the vblank cycles left after the entry delay, the longest handler path and rti. Positive = every interrupt of that mode provably ends inside vblank. */
export const certifiedMargin = (cycles) => VBLANK_CYCLES - (ENTRY_DELAY_CYCLES + cycles + RTI_CYCLES);

/**
 * The cost of vram_drain for EVERY admitted queue shape: k packets (>= 1 data byte each) and d data bytes in all, 3k + d <= 35. Each entry is the longest path with exactly that many
 * headers and bytes; returns { cost: Map("k,d" -> cycles), max, argmax, linear: { base, perPacket, perByte } | null }. The source argument ("one full packet dominates") is this table, not a claim.
 */
export function drainTable({ read, fns, indexMax }) {
  const header = sweep(read, fns.vram_drain_packet, fns.vram_drain_byte).find((d) => d.m === 'LDY' && d.mode === 'abx');
  const dataByte = sweep(read, fns.vram_drain_byte, fns.vram_drain_done).find((d) => d.m === 'DEY');
  const cost = new Map();
  let max = -1, argmax = null;
  for (let k = 1; k * 3 + k <= MIXED_VBLANK_MAX; k++) {
    for (let d = k; 3 * k + d <= MIXED_VBLANK_MAX; d++) {
      // exact shape: two budgets (packets, bytes) that must both be spent exactly -- limit k / d with the end requiring equality is expressed by running the DP for "at most" and keeping
      // the shapes whose longest path spends exactly (k, d); the per-shape longest path is the maximum over the paths of that shape
      const c = shapeCost({ read, fns, indexMax, header, dataByte, k, d });
      cost.set(`${k},${d}`, c);
      if (c > max) { max = c; argmax = [k, d]; }
    }
  }
  // is the cost linear in (k, d)?  fit on three points and check every entry
  const c11 = cost.get('1,1'), c21 = cost.get('2,2'), c12 = cost.get('1,2');
  const perByte = c12 - c11, perPacket = c21 - c11 - perByte, base = c11 - perPacket - perByte;
  const linear = [...cost].every(([key, v]) => { const [k, d] = key.split(',').map(Number); return base + perPacket * k + perByte * d === v; }) ? { base, perPacket, perByte } : null;
  return { cost, max, argmax, linear };
}

function shapeCost({ read, fns, indexMax, header, dataByte, k, d }) {
  // the drain's own loop structure, evaluated for a fixed shape: the two budgets are exact (k headers, d data bytes) and a path that ends before spending them is not that shape
  const budgets = new Map([[fns.vram_drain, [{ name: 'headers', limit: k, charges: new Map([[header.pc, 1]]), exact: true }, { name: 'bytes', limit: d, charges: new Map([[dataByte.pc, 1]]), exact: true }]]]);
  return longestPathExact(fns.vram_drain, { read, indexMax, budgets });
}

/** longestPath with exact budgets: only a path that spends every `exact` budget to its limit counts. */
function longestPathExact(entry, opts) {
  const { read, indexMax = () => 255, budgets } = opts;
  const bs = budgets.get(entry);
  const dp = new Map();
  const walk = (pc, used) => {
    const k = `${pc}|${used.join(',')}`;
    if (dp.has(k)) return dp.get(k);
    dp.set(k, null);
    const d = decode(read, pc);
    let next = used;
    for (let b = 0; b < bs.length; b++) {
      const n = bs[b].charges.get(pc);
      if (n) { if (next === used) next = used.slice(); next[b] += n; if (next[b] > bs[b].limit) { dp.set(k, null); return null; } }
    }
    let res = null;
    if (d.m === 'RTS') res = bs.every((b, i) => next[i] === b.limit) ? d.cyc : null;
    else if (d.m === 'JMP') { const r = walk(d.target, next); res = r === null ? null : d.cyc + r; }
    else if (BRANCHES.has(d.m)) {
      const alts = [];
      const rN = walk(d.next, next); if (rN !== null) alts.push(d.cyc + rN);
      const rT = walk(d.target, next); if (rT !== null) alts.push(d.cyc + 1 + ((d.next >> 8) !== (d.target >> 8) ? 1 : 0) + rT);
      res = alts.length ? Math.max(...alts) : null;
    } else {
      let cyc = d.cyc;
      if ((d.mode === 'abx' || d.mode === 'aby') && PENALTY_READS.has(d.m) && (d.operand & 0xff) + indexMax(d.operand, d) > 255) cyc += 1;
      const r = walk(d.next, next);
      res = r === null ? null : cyc + r;
    }
    dp.set(k, res);
    return res;
  };
  const r = walk(entry, bs.map(() => 0));
  if (r === null) throw new Error('no path of that shape');
  return r;
}
