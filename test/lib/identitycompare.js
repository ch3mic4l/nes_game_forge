// Helpers shared by test/unit/identitymatrix.test.js and test/lib/build_identity_baseline.mjs:
// hashing a built ROM, reading its symbol table, and comparing a routine across two builds
// without a literal byte comparison.
//
// "Identical outside the changed span" is never a valid byte comparison (review R2.6-6): a span
// that grows relocates every following label, so an operand that names a relocated label
// legitimately changes. normalizeSpan decodes the routine's instructions and replaces every
// operand naming a label (an address in the ROM's $8000+ half) with that label's NAME, so two
// builds of an unchanged routine compare equal exactly when their instructions and relocations
// agree, whatever address the labels moved to. Slice S1's S1-I2 and S1-I3 assert on it.
//
// S0 (9f0136e -> 99d4156) used a padded-parent construction for move_face's +24 bytes; that
// slice's baseline and its S0-I tests are retired with S1 (plan §6.4: slice N+1 replaces the
// file), and only the clamp's machine code (expectedClamp) is still checked, in place.

import crypto from 'node:crypto';

export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export function parseFns(text) {
  const out = {};
  for (const m of text.matchAll(/^(\w+)\s*=\s*\$([0-9A-Fa-f]+)/gm)) out[m[1]] = parseInt(m[2], 16);
  return out;
}

/** Hash of the sorted `name=addr` lines, ignoring the names in `except`. */
export function symbolsHash(syms, except = []) {
  const lines = Object.entries(syms).filter(([name]) => !except.includes(name)).map(([name, addr]) => `${name}=${addr.toString(16)}`).sort();
  return sha256(lines.join('\n'));
}

/** File offset of a CPU address in the fixed last 16 KB of PRG ($C000-$FFFF, the kernel), every cartridge. */
export function kernelFileOffset(rom, addr) {
  if (addr < 0xc000) throw new Error(`$${addr.toString(16)} is not in the fixed kernel`);
  return 16 + rom[4] * 0x4000 - 0x4000 + (addr - 0xc000);
}

export const CLAMP_BYTES = 24;

/** The ROM with `length` bytes at `offset` zeroed, hashed. */
export function blankedHash(rom, offset, length = CLAMP_BYTES) {
  const copy = Uint8Array.from(rom);
  copy.fill(0, offset, offset + length);
  return sha256(copy);
}

// from engine/constants.asm
const ENT_FRAME = 0x0328;
const ENT_TIMER = 0x0330;
const NO_ANIM = 0xff;

/** The 24 bytes move_face's clamp must assemble to, hand-assembled from the symbol table. */
export function expectedClamp(syms) {
  const lo = (a) => a & 0xff;
  const hi = (a) => a >> 8;
  const a = syms.entity_animation;
  const t = syms.anim_count;
  return Uint8Array.from([
    0x20, lo(a), hi(a),               // jsr entity_animation
    0xc9, NO_ANIM,                    // cmp #NO_ANIM
    0xf0, 24 - 7,                     // beq move_face_done
    0xa8,                             // tay
    0xbd, lo(ENT_FRAME), hi(ENT_FRAME), // lda ent_frame,x
    0xd9, lo(t), hi(t),               // cmp anim_count,y
    0x90, 24 - 16,                    // bcc move_face_done
    0xa9, 0x00,                       // lda #0
    0x9d, lo(ENT_FRAME), hi(ENT_FRAME), // sta ent_frame,x
    0x9d, lo(ENT_TIMER), hi(ENT_TIMER)  // sta ent_timer,x
  ]);
}


/** Hash of the sorted symbol NAMES (not addresses), ignoring the names in `except`. */
export function namesHash(syms, except = []) {
  const names = Object.keys(syms).filter((name) => !except.includes(name)).sort();
  return sha256(names.join('\n'));
}

// 6502 official opcodes by operand length; anything else is refused rather than guessed at.
const LEN = new Map();
const setLen = (n, list) => list.split(' ').forEach((op) => LEN.set(parseInt(op, 16), n));
setLen(1, '00 08 0A 18 28 2A 38 40 48 4A 58 60 68 6A 78 88 8A 98 9A A8 AA B8 BA C8 CA D8 E8 EA F8');
setLen(2, '09 29 49 69 A0 A2 A9 C0 C9 E0 E9 05 06 24 25 26 45 46 65 66 84 85 86 A4 A5 A6 C4 C5 C6 E4 E5 E6 ' +
  '15 16 35 36 55 56 75 76 94 95 B4 B5 D5 D6 F5 F6 96 B6 01 21 41 61 81 A1 C1 E1 11 31 51 71 91 B1 D1 F1 ' +
  '10 30 50 70 90 B0 D0 F0');
setLen(3, '0D 0E 20 2C 2D 2E 4C 4D 4E 6C 6D 6E 8C 8D 8E AC AD AE CC CD CE EC ED EE ' +
  '1D 1E 3D 3E 5D 5E 7D 7E 9D BC BD DD DE FD FE 19 39 59 79 99 B9 BE D9 F9');

/**
 * The instructions of the routine `start`..`end` (labels), one string per instruction, with
 * every 16-bit operand that lies in the ROM's $8000+ half replaced by the name(s) of the
 * label(s) at that address. `ignoreNames` are labels this comparison's own slice adds: they are
 * dropped from the name lookup so an alias added at an existing address does not change a name.
 */
export function normalizeSpan(rom, syms, start, end, ignoreNames = []) {
  const byAddr = new Map();
  for (const [name, addr] of Object.entries(syms)) {
    if (ignoreNames.includes(name) || addr < 0x8000) continue;
    if (!byAddr.has(addr)) byAddr.set(addr, []);
    byAddr.get(addr).push(name);
  }
  const lines = [];
  let pc = syms[start];
  const stop = syms[end];
  if (pc === undefined || stop === undefined) throw new Error(`no ${start}/${end} label`);
  while (pc < stop) {
    const at = kernelFileOffset(rom, pc);
    const op = rom[at];
    const len = LEN.get(op);
    if (!len) throw new Error(`${start}: unhandled opcode $${op.toString(16)} at $${pc.toString(16)}`);
    let text = op.toString(16).padStart(2, '0');
    if (len === 2) text += ` ${rom[at + 1].toString(16).padStart(2, '0')}`;
    if (len === 3) {
      const operand = rom[at + 1] | (rom[at + 2] << 8);
      const names = byAddr.get(operand);
      text += operand >= 0x8000 ? ` @${names ? names.sort().join('|') : `?${operand.toString(16)}`}` : ` ${operand.toString(16)}`;
    }
    lines.push(text);
    pc += len;
  }
  if (pc !== stop) throw new Error(`${start}..${end}: decoding overran the span`);
  return lines;
}
