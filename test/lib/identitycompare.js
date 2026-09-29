// Helpers shared by test/unit/identitymatrix.test.js and test/lib/build_identity_baseline.mjs:
// hashing a built ROM, reading its symbol table, and the S0 relocation-aware comparison.
//
// "Relocation-aware" is done by construction, not by disassembling: S0 inserts exactly 24 bytes into
// move_face. The baseline script builds the parent engine a second time with 24 padding bytes
// inserted at that same place, so every address after it moves exactly as S0 moves it and every
// operand that refers to a moved label is re-assembled by nesasm itself. S0's ROM must then equal
// that padded parent ROM everywhere except the 24 inserted bytes, which are separately compared with
// the machine code the clamp is meant to be. A literal "identical outside the span" comparison of S0
// against the unpadded parent would be wrong (R2.6-6): it would flag every relocated operand.

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
