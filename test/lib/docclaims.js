// Shared by test/unit/docclaims.test.js: pull every backticked token out of a markdown file, classify it, and decide
// whether the code base still has the thing it names. See the classification rule in docclaims.test.js.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tokenizer } from 'acorn';
import { scanSource } from './sourcescan.js';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export const SYMBOL_DIRS = ['engine', 'main', 'shared', 'renderer', 'test'];
const EXTENSIONS = /\.(js|mjs|cjs|asm|md|json|lua|inc|sh|css|html|template|cfg|txt)$/;

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

const MNEMONICS = new Set(
  'ADC AND ASL BCC BCS BEQ BIT BMI BNE BPL BRK BVC BVS CLC CLD CLI CLV CMP CPX CPY DEC DEX DEY EOR INC INX INY JMP JSR LDA LDX LDY LSR NOP ORA PHA PHP PLA PLP ROL ROR RTI RTS SBC SEC SED SEI STA STX STY TAX TAY TSX TXA TXS TYA'.split(' ')
);

export function trackedFiles() {
  return git('ls-files', '-z').split('\0').filter(Boolean);
}

// Every backticked span outside a fenced block, with the 1-based line it opens on. A paragraph (text between blank
// lines) with an odd number of backticks cannot be paired reliably; it is reported in `unbalanced` and skipped, never
// guessed at.
export function extractTokens(text) {
  const lines = text.split('\n');
  const tokens = [];
  const unbalanced = [];
  let fenced = false;
  let start = 0;
  let para = [];
  const flush = (endLine) => {
    if (!para.length) return;
    const body = para.join('\n');
    const ticks = (body.match(/`/g) ?? []).length;
    if (ticks % 2) unbalanced.push(start + 1);
    else {
      let line = start;
      let last = 0;
      const bounds = [0, ...[...body.matchAll(/(?<=[.!?])\s+(?=[A-Z`"'(*[])/g)].map((b) => b.index + b[0].length), body.length];
      for (const m of body.matchAll(/`([^`]+)`/g)) {
        line += (body.slice(last, m.index).match(/\n/g) ?? []).length;
        last = m.index;
        const k = bounds.findLastIndex((b) => b <= m.index);
        const collapse = (t) => t.replace(/\s+/g, ' ');
        const at = collapse(body.slice(bounds[k], m.index)).length; // where this span opens inside `sentence`
        tokens.push({ token: m[1].replace(/\s+/g, ' ').trim(), line: line + 1, sentence: collapse(body.slice(bounds[k], bounds[k + 1])), at, len: collapse(m[0]).length });
      }
    }
    para = [];
  };
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      flush(i);
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    if (!line.trim()) return flush(i);
    if (!para.length) start = i;
    para.push(line);
  });
  flush(lines.length);
  return { tokens, unbalanced };
}

// 'path' | 'identifier' | null (prose, left alone). The rule, in order:
//   1. Strip a trailing "()" and a trailing ":N" / ":N-M" line suffix. Anything still holding whitespace or one of
//      $ * < > { } ( ) [ ] = + , ; | ~ " ' is prose, a pattern or an expression: null.
//   2. Holds "/" or ends in a known file extension -> 'path'.
//   3. [A-Za-z_][A-Za-z0-9_]* that is ALL_CAPS (three or more characters, an underscore or not: a constant),
//      snake_case with an underscore (a label or helper), or camelCase (lower first, an upper later) -> 'identifier'.
//      A 6502 mnemonic (LDA, BNE, ...) is the one ALL_CAPS word that is prose.
//   4. Everything else (plain words, Capitalised Words, numbers, hex, registers, mnemonics) -> null.
export function classify(raw) {
  let t = raw.replace(/\(\)$/, '').replace(/:\d+(-\d+)?$/, '');
  if (!t || /[\s$*<>{}()[\]=+,;|~"'!?\\]/.test(t)) return null;
  if (/^\./.test(t)) return null; // a bare extension (".asm") or a local label
  if (t.includes('/') && !EXTENSIONS.test(t) && /^[a-z][a-z0-9]*(_[a-z0-9]+)+(\/[a-z0-9]+)+$/.test(t)) {
    // sw_cross_left/right: an alternation, each part replacing the last _segment of the first
    const [first, ...rest] = t.split('/');
    const stem = first.slice(0, first.lastIndexOf('_') + 1);
    return { kind: 'alternation', names: [first, ...rest.map((r) => stem + r)] };
  }
  if (t.includes('/') || EXTENSIONS.test(t)) {
    if (!/^[\w.\-@/]+$/.test(t)) return null;
    // Output of a build or a path inside a user's project, not a file of this repository.
    if (/^(build|assets|code|sample[\w-]*\/build)\//.test(t) || /^[a-z]+\.inc$/.test(t) && !t.includes('/')) return { kind: 'generated', name: t };
    return { kind: 'path', name: t };
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) return null;
  if (MNEMONICS.has(t)) return null;
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(t) || /^[A-Z][A-Z0-9]{2,}$/.test(t) || /^_?[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(t) || /^[a-z][a-z0-9]*([A-Z][a-z0-9]*)+$/.test(t)) {
    return { kind: 'identifier', name: t };
  }
  return null;
}

// The words of a product file that are CODE: comments are dropped, because the engine and the generator spell the
// names of deleted symbols in comments to say why they are gone, and a comment must not vouch for a doc that still
// calls one current. JavaScript goes through acorn's tokenizer (identifiers and string literals); assembly loses
// everything from `;` to the end of the line; any other file type is taken whole.
function productWords(file, text) {
  const words = (t) => t.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  if (/\.(js|mjs|cjs)$/.test(file)) {
    try {
      const { identifiers, strings } = scanSource(text);
      return [...identifiers.map((i) => i.name), ...strings.flatMap(words)];
    } catch {
      return words(text); // a file acorn cannot read (a script, not a module) is taken whole
    }
  }
  if (/\.(asm|inc)$/.test(file)) return words(text.split('\n').map((l) => l.replace(/;.*$/, '')).join('\n'));
  return words(text);
}

// The names a test file DECLARES (function, const, let, var, class, export {}). A comment never declares anything:
// JavaScript is read through acorn's tokenizer, so `// const old_name = 1` and a string holding "const x" are not
// declarations; Lua and shell lose their line comments first. A JavaScript file acorn cannot read is a failure here
// too, as it is in sourcescan.js, not something to skip.
export function testDeclarations(file, text) {
  const names = new Set();
  if (/\.(js|mjs|cjs)$/.test(file)) {
    const tokens = [...tokenizer(text, { ecmaVersion: 'latest', sourceType: 'module' })];
    const word = (t) => t?.type.label === 'name';
    tokens.forEach((t, i) => {
      const label = t.type.label;
      const next = tokens[i + 1];
      if (label === 'function' || label === 'class') {
        const n = label === 'function' && next?.type.label === '*' ? tokens[i + 2] : next;
        if (word(n)) names.add(n.value);
      } else if (label === 'const' || label === 'var' || (label === 'name' && t.value === 'let')) {
        if (word(next)) names.add(next.value);
      } else if (label === 'export' && next?.type.label === '{') {
        // export { a, b as c } -- each specifier's last name is the exported one
        for (let j = i + 2; j < tokens.length && tokens[j].type.label !== '}'; j++) {
          if (word(tokens[j]) && (tokens[j + 1]?.type.label === ',' || tokens[j + 1]?.type.label === '}')) names.add(tokens[j].value);
        }
      }
    });
    return names;
  }
  const stripped = /\.(lua|template)$/.test(file) ? text.replace(/--.*$/gm, '') : /\.sh$/.test(file) ? text.replace(/#.*$/gm, '') : text;
  for (const m of stripped.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1]);
  return names;
}

// The symbols of the code base: every identifier in a tracked file under SYMBOL_DIRS, split in two so a name that
// only a test mentions can be told from one the product still defines. `exclude` keeps the checking test's own text
// (which names the sabotage symbols) from vouching for them.
export function buildCorpus(exclude = []) {
  const product = new Set();
  const testOnly = new Map(); // name -> true if some test file DEFINES it (function/const/let/class/export)
  const tests = new Set();
  const jsonKeys = new Set();
  const files = trackedFiles().filter((f) => SYMBOL_DIRS.includes(f.split('/')[0]) && !exclude.includes(f));
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue;
    if (f.startsWith('test/')) {
      for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) tests.add(m[0]);
      for (const n of testDeclarations(f, text)) testOnly.set(n, true);
      if (f.endsWith('.json')) for (const m of text.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g)) jsonKeys.add(m[1]);
    } else for (const name of productWords(f, text)) product.add(name);
  }
  return { product, tests, testDefined: testOnly, jsonKeys };
}

// A cited path resolves only if git tracks it (or tracks something under it, for a directory). A file that merely
// exists on this machine -- a gitignored scratch directory, a build output -- does not count: the answer must be the
// same in a fresh clone.
export function pathExists(name, tracked) {
  const dir = name.replace(/\/$/, '');
  if (tracked.includes(dir) || tracked.some((f) => f.startsWith(`${dir}/`))) return true;
  if (!name.includes('/')) return tracked.some((f) => f.endsWith(`/${name}`)); // a bare file name
  return tracked.some((f) => f.endsWith(`/${name}`)); // a path relative to a subdirectory
}

// Does the sentence say THIS span's own symbol is gone? A name missing from the tree is allowed only when the doc
// says so of that name: "S3b deleted `sw_step_nocross`", "`sw_step_nocross` (deleted in S3b)", "`a` and `b` were
// replaced". A deletion word elsewhere in the sentence is not enough -- "the guard is `sw_move_probe`, while
// `sw_step_nocross` was deleted" says nothing of sw_move_probe. `at`/`len` locate the span in `sentence`; a list of
// spans joined only by ",", "/", "and", "or" shares one verdict.
const GONE = String.raw`(?:deleted|retired|removed|replaced|gone|no longer exists?)`;
const GONE_AFTER = new RegExp(String.raw`^(?:'s)?\s*(?:\([^()]*\b${GONE}\b[^()]*\)|[,;]?\s*(?:(?:was|were|is|are|has been|have been|had been|got|since|now|also)\s+)*\**${GONE}\b)`, 'i');
const GONE_BEFORE = new RegExp(String.raw`\b${GONE}\s+(?:(?:the|its|their|of|both|old|former)\s+)*$`, 'i');
const JOIN = String.raw`(?:,|\/|,?\s*(?:and|or))`;
export function namedAsGone(sentence, at, len) {
  const after = sentence.slice(at + len).replace(new RegExp(String.raw`^(?:\s*${JOIN}\s*\`[^\`]*\`)+`), '');
  if (GONE_AFTER.test(after)) return true;
  const before = sentence.slice(0, at).replace(new RegExp(String.raw`(?:\`[^\`]*\`\s*${JOIN}\s*)+$`), '');
  return GONE_BEFORE.test(before);
}
