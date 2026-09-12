// The zero-page addressing diet's own permanent guard (docs/design-kernel-diet.md
// v5 §3). nesasm v3.1 assembles a bare zero-page-valued operand as 3-byte
// absolute unless it carries a `<` prefix; the one-off sweep that landed this
// change is not itself shipped (the appendix in the design doc is the
// record) -- this file is what keeps the diet from regressing one
// instruction at a time in a later, ordinary engine edit, which is a
// different failure shape than the sweep itself: nothing about adding a new
// bare zero-page access without `<` is a build error, so it would assemble
// one byte and one cycle larger, forever, with nothing to say so.
//
// Reads engine/constants.asm directly, never a project's build/ copy --
// this guard audits the stock engine's own source against itself, the same
// distinction shared/enginesyms.js's own comment draws for why a *shipping*
// consumer reads the build-matched copy instead (Code Forge overrides): a
// stock-source guard needs the stock source, not a project's own copy of it.
//
// Three directions, matching the design's own three-part rule:
//   (a) every operand the scope rule admits carries `<`
//   (b) every `<`-prefixed operand names a symbol resolving below $100
//   (c) every `<`-prefixed operand's mnemonic+index pair is a legal
//       6502 zero-page addressing mode
// plus scanner-behavior controls covering what must be ignored and what
// must be recognized regardless of case or a same-line label.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanEquates, resolveEquates, ZP_MODE_TABLE, scanZeroPageInstruction } from '../lib/equates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_DIR = path.join(ROOT, 'engine');
const CONST_PATH = path.join(ENGINE_DIR, 'constants.asm');

/** Every constants.asm name resolved to its numeric value, via the shared resolver. */
function resolveConstants() {
  const text = fs.readFileSync(CONST_PATH, 'utf8');
  const pending = new Map();
  scanEquates(text, pending);
  const symbols = new Map();
  resolveEquates(pending, symbols);
  return symbols;
}

function engineFiles() {
  return fs.readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.asm')).sort();
}

test('every operand the scope rule admits carries < (direction a)', () => {
  const symbols = resolveConstants();
  const zpNames = new Set([...symbols].filter(([, v]) => v < 0x100).map(([n]) => n));
  const missing = [];
  for (const file of engineFiles()) {
    const text = fs.readFileSync(path.join(ENGINE_DIR, file), 'utf8');
    text.split('\n').forEach((line, index) => {
      const scanned = scanZeroPageInstruction(line);
      if (!scanned || scanned.prefixed) return;
      if (!zpNames.has(scanned.name)) return;
      if (scanned.indexLetter && !ZP_MODE_TABLE[scanned.mnemonic]?.has(scanned.indexLetter)) return;
      missing.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(
    missing,
    [],
    `every admitted bare zero-page operand must carry < -- found ${missing.length} without one:\n${missing.join('\n')}`
  );
});

test('every <-prefixed operand names a symbol resolving below $100 (direction b)', () => {
  const symbols = resolveConstants();
  const bad = [];
  for (const file of engineFiles()) {
    const text = fs.readFileSync(path.join(ENGINE_DIR, file), 'utf8');
    text.split('\n').forEach((line, index) => {
      const scanned = scanZeroPageInstruction(line);
      if (!scanned || !scanned.prefixed) return;
      const value = symbols.get(scanned.name);
      if (value === undefined || value >= 0x100) {
        bad.push(`${file}:${index + 1}: <${scanned.name} resolves to ${value === undefined ? 'nothing' : `$${value.toString(16)}`}`);
      }
    });
  }
  assert.deepEqual(bad, [], `every <-prefixed operand must resolve below $100:\n${bad.join('\n')}`);
});

test("every <-prefixed operand's mnemonic+index pair is a legal zero-page addressing mode (direction c)", () => {
  const bad = [];
  for (const file of engineFiles()) {
    const text = fs.readFileSync(path.join(ENGINE_DIR, file), 'utf8');
    text.split('\n').forEach((line, index) => {
      const scanned = scanZeroPageInstruction(line);
      if (!scanned || !scanned.prefixed) return;
      if (scanned.indexLetter && !ZP_MODE_TABLE[scanned.mnemonic]?.has(scanned.indexLetter)) {
        bad.push(`${file}:${index + 1}: ${scanned.mnemonic} <${scanned.name},${scanned.indexLetter} is not a real 6502 addressing mode`);
      }
    });
  }
  assert.deepEqual(bad, [], `every <-prefixed indexed operand must be a legal mode:\n${bad.join('\n')}`);
});

test('the scanner ignores immediates, indirect operands, and an out-of-range indexed name', () => {
  assert.equal(scanZeroPageInstruction('  lda #ACT_UP'), null, 'an immediate must not be scanned as a bare operand');
  assert.equal(scanZeroPageInstruction('  lda [ptr_lo],y'), null, 'an indirect operand must not be scanned as a bare operand');
  assert.equal(scanZeroPageInstruction('; lda bt_tmp2'), null, 'a comment-only line must not be scanned');
  // save_flash_buf = $0700 (engine/constants.asm) -- a real name, real bare
  // operand shape, but >= $100. The scanner itself does not know that (only
  // the caller checks the resolved value against zpNames), so this control
  // is really about confirming the line still SCANS (so direction (b)'s own
  // logic has something to check), not about the scanner rejecting it.
  const scanned = scanZeroPageInstruction('  lda save_flash_buf,x');
  assert.ok(scanned, 'a real bare-operand line must still be scanned even though its name resolves >= $100');
  assert.equal(scanned.name, 'save_flash_buf');
  assert.equal(scanned.prefixed, false);
});

test('the scanner recognizes an uppercase mnemonic and an optional same-line label, formatting preserved', () => {
  const upper = scanZeroPageInstruction('  LDA bt_tmp2');
  assert.ok(upper, 'an uppercase mnemonic must still be recognized');
  assert.equal(upper.mnemonic, 'lda');
  assert.equal(upper.name, 'bt_tmp2');
  assert.equal(upper.rebuild(), '  LDA <bt_tmp2', 'case and spacing must be preserved, only < inserted');

  const labeled = scanZeroPageInstruction('label: lda bt_tmp2');
  assert.ok(labeled, 'a same-line label prefix must still be recognized');
  assert.equal(labeled.name, 'bt_tmp2');
  assert.equal(labeled.rebuild(), 'label: lda <bt_tmp2', 'the label must be preserved verbatim');

  const tabbed = scanZeroPageInstruction('\tlda\tbt_tmp2\t; sta zp');
  assert.ok(tabbed, 'tab-separated formatting must still be recognized');
  assert.equal(tabbed.rebuild(), '\tlda\t<bt_tmp2\t; sta zp', 'tabs and the trailing comment must be preserved verbatim');
});

test('a legal stx <zp,y is a real addressing mode; an illegal lda <zp,y is not', () => {
  const legal = scanZeroPageInstruction('  stx bt_tmp2,y');
  assert.ok(legal);
  assert.ok(ZP_MODE_TABLE[legal.mnemonic].has(legal.indexLetter), 'stx has a real zero-page,y form');

  const illegal = scanZeroPageInstruction('  lda bt_tmp2,y');
  assert.ok(illegal);
  assert.ok(!ZP_MODE_TABLE[illegal.mnemonic].has(illegal.indexLetter), 'lda has no zero-page,y form');
});
