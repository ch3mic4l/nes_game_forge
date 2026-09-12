// A source scanner for the guard tests in test/unit/starters.test.js and
// test/unit/monstergrowth.test.js, built on acorn's own tokenizer -- the
// project's first non-Electron dependency,
// a devDependency used only here (nothing under main/, renderer/, shared/
// or tools/ may import it). It replaced three successive rounds of a
// hand-rolled regex/division and comment/string heuristic: each round's
// reviewer found a new adversarial shape (a quoted regex character class
// read as a string delimiter, `y++ / 2` misread relative to a keyword or a
// property access, a statement-starting regex after `if (...)` or a
// function body's closing `}`) that a heuristic without real expression-
// context tracking could not resolve in general -- acorn's tokenizer
// already solves exactly this class of problem (regex-vs-division,
// template `${}` bodies, comments, quotes inside a regex class) because it
// tracks the same context stack the real parser does, so nothing here is
// a heuristic any more.
//
// A file that fails to tokenize is a real failure, not something to skip:
// every function below lets acorn's own SyntaxError propagate uncaught.

import { tokenizer } from 'acorn';
import { isBuiltin } from 'node:module';

const TOKENIZER_OPTIONS = { ecmaVersion: 'latest', sourceType: 'module' };

/**
 * @param {string} text
 * @returns {{
 *   strings: string[],
 *   identifiers: {name: string, start: number, next: string|null}[],
 *   imports: string[]
 * }}
 *   `strings` is every string token's value plus every template literal
 *   text chunk (a `${}` body's own tokens are ordinary code tokens and
 *   never appear here). `identifiers` is every `name` token, each carrying
 *   its source position and the very next token's type label (`null` at
 *   end of file) so a caller can ask "is this identifier immediately
 *   followed by `.` or `(`" without re-tokenizing. `imports` is every
 *   import specifier -- a string token, or a substitution-free template
 *   literal's own text (`` `node:fs` `` is known statically; `` `node:${x}` ``
 *   is not, and is never counted) -- directly following the `import`
 *   keyword (side-effect); directly following a `from` name token
 *   (static); or, for a dynamic `import(...)` call, behind any number of
 *   redundant parentheses (`import(('node:fs'))`) between it and the
 *   `import` keyword. `import.meta` is followed by `.`, never a specifier
 *   position, so it is never counted.
 */
export function scanSource(text) {
  const tokens = [...tokenizer(text, TOKENIZER_OPTIONS)];

  const strings = [];
  const identifiers = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1];

    if (token.type.label === 'string' || token.type.label === 'template') {
      strings.push(token.value);
    }

    if (token.type.label === 'name') {
      identifiers.push({ name: token.value, start: token.start, next: next ? next.type.label : null });
    }
  }

  return { strings, identifiers, imports: importSpecifiers(tokens) };
}

// A specifier is a `string` token, or acorn's three-token shape for a
// substitution-free template literal (backtick, one `template` chunk,
// backtick). A template containing `${` has a `${` token in between --
// its value is not statically known, so it is deliberately NOT treated as
// a specifier: `import(\`node:${name}\`)` is never caught, a documented
// limitation rather than a bug.
function specifierCandidates(tokens) {
  const candidates = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type.label === 'string') {
      candidates.push({ value: token.value, before: i - 1 });
    } else if (
      token.type.label === '`' &&
      tokens[i + 1] &&
      tokens[i + 1].type.label === 'template' &&
      tokens[i + 2] &&
      tokens[i + 2].type.label === '`'
    ) {
      candidates.push({ value: tokens[i + 1].value, before: i - 1 });
    }
  }
  return candidates;
}

// A dynamic import's specifier can sit behind any number of redundant
// parentheses -- `import(('node:fs'))`, `import(((...)))` -- so this walks
// backward past every `(` before checking for the `import` keyword right
// behind them. `before` is the index of the token immediately preceding
// the candidate specifier.
function isDynamicImportSpecifier(tokens, before) {
  let i = before;
  let sawParen = false;
  while (i >= 0 && tokens[i].type.label === '(') {
    sawParen = true;
    i--;
  }
  return sawParen && i >= 0 && tokens[i].type.label === 'import';
}

// The side-effect (`import 'x';`) and static (`... from 'x';`) positions
// need no such paren-skipping -- a template or a parenthesised expression
// in either spot is a syntax error, so a single-token look-back is exact.
function importSpecifiers(tokens) {
  const specifiers = [];
  for (const { value, before } of specifierCandidates(tokens)) {
    const prev = before >= 0 ? tokens[before] : null;
    const sideEffect = prev && prev.type.label === 'import';
    const staticImport = prev && prev.type.label === 'name' && prev.value === 'from';
    if (sideEffect || staticImport || isDynamicImportSpecifier(tokens, before)) {
      specifiers.push(value);
    }
  }
  return specifiers;
}

const IDENTIFIER_NAMES = ['document', 'window', 'globalThis', 'process'];

/**
 * @param {string} text
 * @returns {{kind: string, detail: string}[]} every Node/DOM reference found
 *   in `text` -- a `name` token whose value is `document`, `window`,
 *   `globalThis`, or `process`; `require` immediately followed by `(`;
 *   `fs` or `path` immediately followed by `.`; or an import specifier
 *   (static, side-effect, or dynamic) for which `node:module`'s own
 *   `isBuiltin` is true, so every builtin and subpath spelling is caught
 *   with no hand-written list.
 */
export function nodeDomViolations(text) {
  const { identifiers, imports } = scanSource(text);
  const violations = [];

  for (const id of identifiers) {
    if (IDENTIFIER_NAMES.includes(id.name)) {
      violations.push({ kind: 'identifier', detail: `references "${id.name}"` });
    } else if (id.name === 'require' && id.next === '(') {
      violations.push({ kind: 'identifier', detail: 'references "require("' });
    } else if (id.name === 'fs' && id.next === '.') {
      violations.push({ kind: 'identifier', detail: 'references "fs."' });
    } else if (id.name === 'path' && id.next === '.') {
      violations.push({ kind: 'identifier', detail: 'references "path."' });
    }
  }

  for (const specifier of imports) {
    if (isBuiltin(specifier)) violations.push({ kind: 'import', detail: `imports "${specifier}", a Node builtin` });
  }

  return violations;
}

const FIXTURE_NAMES = ['sample', 'sample-rpg', 'sample-mmc1', 'sample-mmc3', 'sample-u512', 'sample-rpg-mmc1'];

// A fixture reference is a path, so a name only counts when it names a
// whole path component: the entire string, a component in the middle
// (`/name/`), the last component (`.../name`), or the first (`name/...`) --
// never merely a substring, which is what keeps `sample-common`,
// `tools/make-sample.js`, and `resampled` clear of the six real names.
function isPathComponent(value, name) {
  return value === name || value.includes(`/${name}/`) || value.endsWith(`/${name}`) || value.startsWith(`${name}/`);
}

/**
 * @param {string} text
 * @returns {string[]} every string literal in `text` that names one of the
 *   six checked-in fixture directories as a whole path component.
 */
export function fixtureReferences(text) {
  const { strings } = scanSource(text);
  const offenders = [];
  for (const value of strings) {
    if (FIXTURE_NAMES.some((name) => isPathComponent(value, name))) offenders.push(value);
  }
  return offenders;
}

/**
 * @param {string} text
 * @param {string} needle
 * @returns {string[]} every `strings` entry in `text` -- single- or
 *   double-quoted, or a template literal's own text chunk -- that contains
 *   `needle`. Comments never reach `strings` at all (the tokenizer drops
 *   them), so a comment merely mentioning `needle` is never returned: this
 *   is a check for a second writer of the same literal content, not a
 *   check for the word appearing anywhere in the file.
 */
export function literalOccurrences(text, needle) {
  const { strings } = scanSource(text);
  return strings.filter((value) => value.includes(needle));
}

// Two more primitives, in the identical acorn-token style as the specifier
// scanning above -- added for test/unit/monstergrowth.test.js's own
// structural proof that main/build/battletables.js's `statAt` binding is
// really an import, not a local re-implementation
// (docs/design-monster-level-scaling.md §3.4). `scanSource`'s own
// `identifiers`/`imports` were not enough: `identifiers` records every name
// token with the *next* token's label, not the *previous* one, so it cannot
// tell "a name following `function`" (a declaration) from "a name preceding
// `(`" (a call); and `imports` records every specifier string reachable at
// all, with no link back to which imported *name* came from which one.
//
// Round-2 review finding 1: the first version of `namedImportSource` below
// collected every name token inside an import clause's `{ }`, imported and
// aliased-local alike, so `{ statAt as unusedSharedStatAt }` still matched a
// search for `statAt` even though no local binding named `statAt` exists in
// that case at all -- a real local reimplementation could hide behind that
// exact shape and pass unnoticed. Fixed by actually parsing each clause
// entry as `imported [as local]` and matching only on `local`.

/**
 * @param {string} text
 * @returns {Set<string>} every name this module declares as a *local*
 *   binding via `function`, `class`, `const`, `let`, or `var` -- not merely
 *   `function`, per round-2 review finding 1 ("a `const statAt = (...) =>
 *   ...` arrow reimplementation must be caught too, not only a `function
 *   statAt` one"). `function foo(...)`, `export function foo(...)`,
 *   `export default function foo(...)` and the `class` equivalents all
 *   count, since none of them changes what immediately follows the
 *   `function`/`class` keyword itself. `let` has no keyword token of its
 *   own in acorn -- it tokenizes as an ordinary `name` token whose value
 *   happens to be `"let"` -- so it is matched by value, not by
 *   `type.label`; that is safe only because `sourceType: 'module'` is
 *   always strict mode, where `let` can never legally be used as an
 *   ordinary identifier instead of the keyword. Only the *first* declared
 *   name after the keyword is captured -- `const a = 1, b = 2;` misses
 *   `b` -- since nothing in this codebase's own style, nor anything this
 *   function exists to catch, ever declares more than one binding per
 *   statement; a destructuring pattern (`const { a } = x;`) is equally out
 *   of scope, for the same reason.
 */
export function declaredLocalNames(text) {
  const tokens = [...tokenizer(text, TOKENIZER_OPTIONS)];
  const names = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const isDeclarationKeyword =
      token.type.label === 'function' ||
      token.type.label === 'class' ||
      token.type.label === 'const' ||
      token.type.label === 'var' ||
      (token.type.label === 'name' && token.value === 'let');
    if (isDeclarationKeyword && tokens[i + 1]?.type.label === 'name') {
      names.add(tokens[i + 1].value);
    }
  }
  return names;
}

/**
 * @param {string} text
 * @param {string} name
 * @returns {string|null} the module specifier of the first
 *   `import { ... } from 'specifier'` statement whose named clause binds
 *   the *local* name `name` -- `null` if there is none. Each clause entry
 *   is parsed as `imported [as local]`, matching only on `local` (an entry
 *   with no `as` has `local === imported`): searching for `statAt` against
 *   `{ statAt as unusedSharedStatAt }` correctly returns `null` (no local
 *   `statAt` exists), and searching for `unusedSharedStatAt` against the
 *   same clause returns the specifier -- the fix for round-2 review finding
 *   1. Only a named `{ }` clause is examined; this codebase never mixes it
 *   with a default import on the same statement for anything this needs to
 *   check, so that combined form is out of scope, not silently mishandled.
 *   A bare `export { name } from 'specifier'` re-export is deliberately
 *   **not** a match: it forwards a binding without creating one in this
 *   module's own scope, the reverse of the question this function
 *   answers -- the token immediately before the `{` must be `import`,
 *   never `export`.
 */
export function namedImportSource(text, name) {
  const tokens = [...tokenizer(text, TOKENIZER_OPTIONS)];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type.label !== 'import' || tokens[i + 1]?.type.label !== '{') continue;
    let j = i + 2;
    let matchesLocalName = false;
    while (j < tokens.length && tokens[j].type.label !== '}') {
      if (tokens[j].type.label !== 'name') {
        j++;
        continue;
      }
      const imported = tokens[j].value;
      let local = imported;
      j++;
      if (tokens[j]?.type.label === 'name' && tokens[j].value === 'as' && tokens[j + 1]?.type.label === 'name') {
        local = tokens[j + 1].value;
        j += 2;
      }
      if (local === name) matchesLocalName = true;
      // j now sits on a `,` (skipped by the loop's own scan) or the `}`.
    }
    const fromToken = tokens[j + 1];
    const specifierToken = tokens[j + 2];
    if (
      matchesLocalName &&
      fromToken?.type.label === 'name' &&
      fromToken.value === 'from' &&
      specifierToken?.type.label === 'string'
    ) {
      return specifierToken.value;
    }
  }
  return null;
}
