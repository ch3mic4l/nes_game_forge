// The Code Forge's syntax highlighter.
//
// The load-bearing property is the last test in this file: tokenizing must never
// alter the source. Everything else is about which colour a thing gets, and a
// wrong colour is cosmetic; a lost character would corrupt what the user sees
// their own code as.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenizeLine, highlightLine } from '../../renderer/forges/code/highlight.js';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../engine');

/** The token types covering a line, in order, with their text. */
const typed = (line) => tokenizeLine(line).map((token) => [token.type, token.text]);
/** Just the types of the non-whitespace tokens, for terser assertions. */
const kinds = (line) =>
  tokenizeLine(line)
    .filter((token) => token.text.trim())
    .map((token) => token.type);

test('a comment runs to the end of the line', () => {
  assert.deepEqual(typed('; hello, world'), [['comment', '; hello, world']]);
  assert.deepEqual(kinds('  lda #$80 ; load it'), ['mnemonic', 'number', 'comment']);
});

test('a column-0 word is a label, an indented one is an opcode', () => {
  assert.deepEqual(typed('update_player:'), [['label', 'update_player:']]);
  // Without the colon too — that is how constants.asm defines zero page.
  assert.deepEqual(kinds('ptr_lo      = $00'), ['label', 'punct', 'number']);
  assert.deepEqual(kinds('  rts'), ['mnemonic']);
});

test('an operand that spells a mnemonic is not coloured as one', () => {
  // `and_mask` starts with "and"; `sta` has already filled the opcode slot.
  assert.deepEqual(kinds('  sta and_mask'), ['mnemonic', 'ident']);
  assert.deepEqual(kinds('  jsr rts_helper'), ['mnemonic', 'ident']);
});

test('numbers keep their sigils', () => {
  assert.deepEqual(kinds('  .db $C0, %10101010, 42'), [
    'directive',
    'number',
    'punct',
    'number',
    'punct',
    'number'
  ]);
  assert.deepEqual(typed('  lda #$80').slice(-1), [['number', '#$80']]);
  // A bare # before a name is punctuation; the name stays an identifier.
  assert.deepEqual(kinds('  lda #FONT_BASE'), ['mnemonic', 'punct', 'ident']);
});

test('directives and strings', () => {
  assert.deepEqual(kinds('  .include "assets/usercode.inc"'), ['directive', 'string']);
  assert.deepEqual(kinds('  .if SPLIT_ENABLED'), ['directive', 'ident']);
  assert.deepEqual(kinds('  .org $C000'), ['directive', 'number']);
});

test('a dotted word that is not a directive is a local label', () => {
  assert.deepEqual(typed('.loop:'), [['label', '.loop:']]);
  assert.deepEqual(kinds('  bne .loop'), ['mnemonic', 'label']);
});

test('indexed and indirect operands survive', () => {
  assert.deepEqual(kinds('  lda ($00),y'), ['mnemonic', 'punct', 'number', 'punct', 'ident']);
  assert.deepEqual(kinds('  sta $0300,x'), ['mnemonic', 'number', 'punct', 'ident']);
});

test('highlightLine escapes HTML', () => {
  const html = highlightLine('  .db "<&>"');
  assert.match(html, /&lt;&amp;&gt;/);
  assert.doesNotMatch(html, /<&/);
});

test('tokenizing never alters the source', () => {
  const files = fs.readdirSync(ENGINE_DIR).filter((file) => file.endsWith('.asm'));
  assert.ok(files.length > 10, 'expected the engine sources to be present');

  let lines = 0;
  for (const file of files) {
    const text = fs.readFileSync(path.join(ENGINE_DIR, file), 'utf8');
    for (const [index, line] of text.split('\n').entries()) {
      const joined = tokenizeLine(line)
        .map((token) => token.text)
        .join('');
      assert.equal(joined, line, `${file}:${index + 1} round-trip`);
      lines += 1;
    }
  }
  // Also over the awkward cases the engine happens not to contain.
  for (const line of ['', '   ', '"unterminated', "'", '$', '%', '#', '.', '..', 'a:;c', '\t\tnop']) {
    assert.equal(
      tokenizeLine(line)
        .map((token) => token.text)
        .join(''),
      line
    );
  }
  assert.ok(lines > 1000, `expected to cover the engine, saw ${lines} lines`);
});
