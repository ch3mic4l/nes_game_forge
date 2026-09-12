// The engine's own equate grammar and zero-page instruction shape, in one
// place, for three consumers: test/unit/rammap.test.js (the RAM-map audit,
// scanEquates/resolveEquates only -- its own isRamName and two-input scan
// are untouched), the zero-page sweep script (docs/design-kernel-diet.md
// §11 appendix -- not shipped; a one-off, applied once and reverted, kept
// only as a record there), and test/unit/zeropage.test.js (the permanent
// guard). scanEquates/resolveEquates are lifted verbatim from
// test/unit/rammap.test.js's own functions -- identical mutation semantics
// (both take a Map and mutate it in place), identical first-definition-wins
// behaviour, identical fail-loud handling of an equate shape this grammar
// does not recognise.

export function scanEquates(text, pending) {
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+)/);
    if (!m) continue;
    const [, name, rawExpr] = m;
    if (pending.has(name)) continue;
    const expr = rawExpr.trim();
    const hex = expr.match(/^\$([0-9A-Fa-f]+)$/);
    const dec = expr.match(/^(\d+)$/);
    const sum = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\+\s*([A-Za-z_][A-Za-z0-9_]*|\d+)$/);
    const product = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\*\s*([A-Za-z_][A-Za-z0-9_]*|\d+)$/);
    const bare = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)$/);
    if (hex) pending.set(name, { kind: 'literal', value: parseInt(hex[1], 16) });
    else if (dec) pending.set(name, { kind: 'literal', value: parseInt(dec[1], 10) });
    else if (sum) pending.set(name, { kind: 'sum', base: sum[1], add: sum[2] });
    else if (product) pending.set(name, { kind: 'product', base: product[1], mul: product[2] });
    else if (bare) pending.set(name, { kind: 'bare', ref: bare[1] });
    else {
      throw new Error(
        `${name} = ${expr} does not fit the restricted equate grammar this guard parses (literal $hex/decimal, ` +
          `a bare name, name+token, or name*token). Widen scanEquates deliberately, or fix the line.`
      );
    }
  }
}

export function resolveEquates(pending, symbols) {
  let progress = true;
  while (progress) {
    progress = false;
    for (const [name, spec] of pending) {
      let value;
      if (spec.kind === 'literal') {
        value = spec.value;
      } else if (spec.kind === 'sum') {
        const base = symbols.get(spec.base);
        const add = /^\d+$/.test(spec.add) ? parseInt(spec.add, 10) : symbols.get(spec.add);
        if (base === undefined || add === undefined) continue;
        value = base + add;
      } else if (spec.kind === 'product') {
        const base = symbols.get(spec.base);
        const mul = /^\d+$/.test(spec.mul) ? parseInt(spec.mul, 10) : symbols.get(spec.mul);
        if (base === undefined || mul === undefined) continue;
        value = base * mul;
      } else {
        const v = symbols.get(spec.ref);
        if (v === undefined) continue;
        value = v;
      }
      symbols.set(name, value);
      pending.delete(name);
      progress = true;
    }
  }
  if (pending.size) {
    throw new Error(`could not resolve: ${[...pending.keys()].join(', ')} -- each names something never defined`);
  }
}

/** Per-mnemonic zero-page addressing-mode legality, NMOS 6502 -- verified
 * against renderer/emulator/core/cpu.js's own opcode table (:384 LDX ZPY,
 * :478 STX ZPY). */
export const ZP_MODE_TABLE = {
  bit: new Set(), cpx: new Set(), cpy: new Set(),
  lda: new Set(['x']), sta: new Set(['x']), adc: new Set(['x']), sbc: new Set(['x']),
  and: new Set(['x']), ora: new Set(['x']), eor: new Set(['x']), cmp: new Set(['x']),
  asl: new Set(['x']), lsr: new Set(['x']), rol: new Set(['x']), ror: new Set(['x']),
  inc: new Set(['x']), dec: new Set(['x']), ldy: new Set(['x']), sty: new Set(['x']),
  ldx: new Set(['y']), stx: new Set(['y'])
};

const ZP_OPS = Object.keys(ZP_MODE_TABLE);
// Case-insensitive throughout: an optional same-line `label:` prefix,
// any-case mnemonic, an optional `<`, a bare identifier, an optional
// `,x`/`,y` index, and an optional trailing comment -- nothing else. Every
// piece of original formatting is captured so a rewrite can reproduce the
// line exactly except for the inserted `<`.
const LINE_RE = new RegExp(
  '^(\\s*(?:[A-Za-z_][A-Za-z0-9_]*\\s*:\\s*)?)' + // 1: leading ws + optional "label:"
    '((?:' + ZP_OPS.join('|') + ')\\s+)' + // 2: mnemonic + its own trailing whitespace, original case
    '(<?)' + // 3: already prefixed?
    '([A-Za-z_][A-Za-z0-9_]*)' + // 4: operand name (case-sensitive comparison against the symbol map happens downstream)
    '(\\s*(?:,\\s*([xXyY]))?)' + // 5: index text, 6: index letter
    '(\\s*(?:;.*)?)$', // 7: trailing whitespace/comment
  'i'
);

/**
 * Scans one source line for an admissible bare zero-page instruction.
 * Returns null if the line does not match the shape at all (an immediate,
 * an indirect operand, a comment-only line, a directive, or simply no
 * instruction). Otherwise returns the parsed pieces plus a `rebuild()`
 * closure that reproduces the line with `<` inserted, byte-for-byte
 * identical to the input everywhere else -- callers decide admission
 * (does `name` resolve below $100, is `indexLetter` legal for `mnemonic`)
 * before calling `rebuild()`.
 */
export function scanZeroPageInstruction(line) {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const [, leading, mnemonicPart, prefix, name, indexFull, indexLetter, tail] = m;
  const mnemonicText = mnemonicPart.match(/^(\S+)/)[1];
  return {
    mnemonic: mnemonicText.toLowerCase(),
    prefixed: prefix === '<',
    name,
    indexLetter: indexLetter ? indexLetter.toLowerCase() : null,
    rebuild: () => `${leading}${mnemonicPart}<${name}${indexFull}${tail}`
  };
}
