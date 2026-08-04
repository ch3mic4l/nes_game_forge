// Syntax highlighting for the nesasm dialect the engine is written in.
//
// Pure and DOM-free so it can be unit-tested directly. nesasm has no multi-line
// construct — no block comments, no continuations — so a line can be tokenized
// on its own with no state carried in from the line above. That is what lets the
// editor re-render only the lines that changed.
//
// The one invariant every rule must preserve: joining the token texts back
// together reproduces the line exactly. Highlighting may never alter the source.

/** The 56 official 6502 mnemonics. Undocumented opcodes are not assembled here. */
const MNEMONICS = new Set(
  (
    'adc and asl bcc bcs beq bit bmi bne bpl brk bvc bvs clc cld cli clv cmp cpx cpy dec dex dey ' +
    'eor inc inx iny jmp jsr lda ldx ldy lsr nop ora pha php pla plp rol ror rti rts sbc sec sed ' +
    'sei sta stx sty tax tay tsx txa txs tya'
  ).split(' ')
);

/**
 * nesasm directives. `.db`/`.dw`/`.if`/`.else`/`.endif`/`.include`/`.org` are
 * what the engine actually uses; the rest are listed so a user writing their own
 * code sees them coloured too.
 */
const DIRECTIVES = new Set(
  (
    'db dw byte word org bank include incbin incchr if else elseif endif ifdef ifndef macro endm ' +
    'rsset rs ds equ list nolist fail zp bss code data page proc endp func procgroup opt ' +
    'inesprg ineschr inesmap inesmir defchr zp bss'
  ).split(' ')
);

const IDENT_START = /[A-Za-z_@]/;
const IDENT_CHAR = /[A-Za-z0-9_@]/;
const DIGIT = /[0-9]/;

const isIdentStart = (ch) => ch !== undefined && IDENT_START.test(ch);
const isIdentChar = (ch) => ch !== undefined && IDENT_CHAR.test(ch);

/**
 * Split one line into `{ type, text }` tokens.
 *
 * Types: comment, directive, mnemonic, label, number, string, punct, ident.
 * `punct` carries whitespace and operators — everything with no colour of its own.
 */
export function tokenizeLine(line) {
  const tokens = [];
  const push = (type, text) => {
    if (!text) return;
    // Runs of the same type merge, which keeps the span count down on
    // punctuation-heavy lines without changing what is rendered.
    const last = tokens[tokens.length - 1];
    if (last && last.type === type) last.text += text;
    else tokens.push({ type, text });
  };

  let i = 0;
  // A label may only start in column 0; everything indented is code. `seenWord`
  // tracks whether the line's opcode slot is already filled, so an operand that
  // happens to spell a mnemonic (a label named `and_mask`, say) is not coloured
  // as one.
  let seenWord = false;

  while (i < line.length) {
    const ch = line[i];

    // Whitespace.
    if (ch === ' ' || ch === '\t') {
      const start = i;
      while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i += 1;
      push('punct', line.slice(start, i));
      continue;
    }

    // Comment to end of line.
    if (ch === ';') {
      push('comment', line.slice(i));
      break;
    }

    // String or character literal. An unterminated quote colours to end of line
    // rather than swallowing the next line, since tokenizing is per-line.
    if (ch === '"' || ch === "'") {
      const start = i;
      i += 1;
      while (i < line.length && line[i] !== ch) i += 1;
      if (i < line.length) i += 1; // closing quote
      push('string', line.slice(start, i));
      continue;
    }

    // Numbers, with their sigil: $C0 hex, %1010 binary, 42 decimal, and the
    // immediate marker # when it introduces one.
    if (ch === '$' || ch === '%' || DIGIT.test(ch) || (ch === '#' && '$%'.includes(line[i + 1] ?? ''))) {
      const start = i;
      if (ch === '#') i += 1;
      if (line[i] === '$' || line[i] === '%') i += 1;
      while (i < line.length && IDENT_CHAR.test(line[i])) i += 1;
      // A bare `$` or `%` is an operator (program counter / modulo), not a number.
      if (i === start + 1 && !DIGIT.test(ch)) push('punct', line.slice(start, i));
      else push('number', line.slice(start, i));
      continue;
    }

    // A dotted word: a directive if it names one, otherwise a local label.
    if (ch === '.' && isIdentStart(line[i + 1])) {
      const start = i;
      i += 1;
      while (i < line.length && isIdentChar(line[i])) i += 1;
      const word = line.slice(start + 1, i).toLowerCase();
      if (DIRECTIVES.has(word)) {
        push('directive', line.slice(start, i));
        seenWord = true;
      } else {
        // nesasm's local labels look like `.loop`. In column 0 or followed by a
        // colon it is a definition; elsewhere it is a branch target, which reads
        // better in the label colour either way.
        if (line[i] === ':') i += 1;
        push('label', line.slice(start, i));
      }
      continue;
    }

    // A bare word: a label definition in column 0, an opcode in the first slot
    // after the indent, an identifier anywhere else.
    if (isIdentStart(ch)) {
      const start = i;
      while (i < line.length && isIdentChar(line[i])) i += 1;
      const word = line.slice(start, i);
      const atColumnZero = start === 0;

      if (atColumnZero) {
        // `name:` is a label; so is `name` alone on the left of an `=`, which is
        // how constants.asm defines every zero-page address.
        if (line[i] === ':') {
          i += 1;
          push('label', line.slice(start, i));
        } else {
          push('label', word);
        }
        continue;
      }
      if (!seenWord && MNEMONICS.has(word.toLowerCase())) {
        seenWord = true;
        push('mnemonic', word);
        continue;
      }
      seenWord = true;
      push('ident', word);
      continue;
    }

    // Everything else — commas, brackets, operators.
    push('punct', ch);
    i += 1;
  }

  return tokens;
}

/** Escape for use as HTML text. */
const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * One line as HTML. Returned as a string rather than nodes because the editor
 * sets whole lines at a time and this is measurably cheaper than building spans
 * one element at a time for a 2500-line file.
 */
export function highlightLine(line) {
  if (!line) return '';
  return tokenizeLine(line)
    .map((token) =>
      token.type === 'punct'
        ? escapeHtml(token.text)
        : `<span class="tok-${token.type}">${escapeHtml(token.text)}</span>`
    )
    .join('');
}
