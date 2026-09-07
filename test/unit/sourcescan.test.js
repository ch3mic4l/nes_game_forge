// test/lib/sourcescan.js's own regression suite -- the guard tests in
// starters.test.js call the identical exported functions this file does, so
// nothing here can drift from what actually guards shared/starters/. These
// are also the contract acorn's tokenizer replaced a hand-rolled heuristic
// against (fix brief 7): every case below still holds, now for the honest
// reason that acorn tokenizes real JavaScript rather than approximating it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSource, nodeDomViolations, fixtureReferences, literalOccurrences } from '../lib/sourcescan.js';

test('nodeDomViolations: a "//" inside a string does not hide an identifier that follows, and a fixture name inside a string is still caught', () => {
  const text = `const url = 'https://example.com'; document.title = 'X'; const source = 'sample-rpg';`;
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "document"' }]);
  assert.deepEqual(fixtureReferences(text), ['sample-rpg']);
});

test('nodeDomViolations: a "/*" and "*/" that are each inside their own string are ordinary string content, not comment delimiters', () => {
  const text = `const a = '/*'; document.x = 1; const b = '*/';`;
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "document"' }]);
});

test('nodeDomViolations: a real line comment and a real block comment produce no tokens at all, so an identifier inside one is invisible', () => {
  assert.deepEqual(nodeDomViolations('// document.x = 1'), []);
  assert.deepEqual(nodeDomViolations('/* window.y = 2 */'), []);
});

test('nodeDomViolations: dialogue containing "window" does not fire the identifier guard', () => {
  const text = `const dialogue = 'Look through the window.';`;
  assert.deepEqual(nodeDomViolations(text), []);
});

test('fixtureReferences: dialogue containing the word "sample" does not fire the path-component rule', () => {
  const text = `const dialogue = 'Take a sample of this potion.';`;
  assert.deepEqual(fixtureReferences(text), []);
});

test('nodeDomViolations: dynamic import, side-effect import and a bare-specifier import of a Node builtin are all caught', () => {
  assert.deepEqual(nodeDomViolations(`import('node:fs')`), [{ kind: 'import', detail: 'imports "node:fs", a Node builtin' }]);
  assert.deepEqual(nodeDomViolations(`import { readFile } from 'fs/promises';`), [
    { kind: 'import', detail: 'imports "fs/promises", a Node builtin' }
  ]);
  assert.deepEqual(nodeDomViolations(`import 'node:path';`), [{ kind: 'import', detail: 'imports "node:path", a Node builtin' }]);
});

test('nodeDomViolations: a relative import is never mistaken for a Node builtin, and import.meta is never mistaken for an import specifier', () => {
  assert.deepEqual(nodeDomViolations(`import { x } from '../project.js';`), []);
  assert.deepEqual(nodeDomViolations(`const u = import.meta.url;`), []);
});

test('nodeDomViolations: a substitution-free template literal used as a dynamic import specifier is caught, since its value is fully known statically', () => {
  assert.deepEqual(nodeDomViolations('import(`node:fs`)'), [{ kind: 'import', detail: 'imports "node:fs", a Node builtin' }]);
});

test('nodeDomViolations: a dynamic import specifier behind redundant parentheses is still caught, however many', () => {
  assert.deepEqual(nodeDomViolations(`import(("node:fs"))`), [{ kind: 'import', detail: 'imports "node:fs", a Node builtin' }]);
  assert.deepEqual(nodeDomViolations(`import((("fs/promises")))`), [{ kind: 'import', detail: 'imports "fs/promises", a Node builtin' }]);
});

test('nodeDomViolations: a dynamic import\'s template specifier containing a substitution is NOT caught -- a documented limitation, not a bug, since its value cannot be known statically', () => {
  assert.deepEqual(nodeDomViolations('import(`node:${name}`)'), []);
});

test('nodeDomViolations: a substitution-free template dynamic import specifier that is not a Node builtin produces no violation', () => {
  assert.deepEqual(nodeDomViolations('import(`../project.js`)'), []);
});

test('nodeDomViolations: require( followed immediately by "(" is caught, but the bare word "require" alone is not', () => {
  assert.deepEqual(nodeDomViolations(`const x = require('fs');`), [{ kind: 'identifier', detail: 'references "require("' }]);
  assert.deepEqual(nodeDomViolations(`const require = 1;`), []);
});

test('nodeDomViolations: fs. and path. are each caught only when the name is immediately followed by ".", not merely present in the file', () => {
  assert.deepEqual(nodeDomViolations(`fs.readFileSync('x');`), [{ kind: 'identifier', detail: 'references "fs."' }]);
  assert.deepEqual(nodeDomViolations(`path.join('a', 'b');`), [{ kind: 'identifier', detail: 'references "path."' }]);
  assert.deepEqual(nodeDomViolations(`const offsets = [0, 8]; const pathway = 3;`), []);
});

test('nodeDomViolations: an escaped-slash regex literal does not swallow the identifier that follows it', () => {
  const text = `const re = /\\/\\//; document.x = 1;`;
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "document"' }]);
});

test('nodeDomViolations: a "//" genuinely inside a template literal\'s ${...} body is a real comment there (acorn tokenizes the interpolation as ordinary code), unlike the identical text sitting in the template\'s own literal text', () => {
  // fix brief 8's audit: the previous version of this test put the "//"
  // in the template's own trailing text run (after the interpolation
  // closes), not inside ${...} at all -- title/input mismatch, corrected.
  const text = 'const x = `a ${a // comment\n} b`; document.y = 1;';
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "document"' }]);
});

test('nodeDomViolations: an identifier inside a template literal\'s ${...} is scanned as real code, not hidden as string content', () => {
  const text = 'const hint = `Created for ${process.platform}`;';
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "process"' }]);
});

test('fixtureReferences: a fixture name inside a nested string literal inside ${...} is still caught', () => {
  const text = 'const source = `${root}/${"sample-rpg"}/project.json`;';
  assert.deepEqual(fixtureReferences(text), ['sample-rpg']);
});

test('nodeDomViolations: a template nested inside another template\'s ${...} is scanned recursively', () => {
  const text = "const s = `a ${b ? `inner ${document.x}` : ''} c`;";
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "document"' }]);
});

test('scanSource: a balanced object literal inside ${...} does not end the interpolation early, and the text after it lands in strings as its own exact entry', () => {
  const text = 'const s = `obj ${ {a: 1}.a } end`;';
  assert.deepEqual(nodeDomViolations(text), []);
  // Exact, not `.some((s) => s.includes(' end'))`: acorn's tokenizer tracks
  // its own template/brace context correctly, but this is still a proof
  // about OUR OWN scanSource wrapper -- a bug in how it turns template
  // tokens into `strings` (say, missing a chunk) could still slip past a
  // substring check.
  assert.deepEqual(scanSource(text).strings, ['obj ', ' end']);
});

test('scanSource: a forbidden identifier placed AFTER a balanced object literal but still inside ${...} proves the interpolation resumed as code, not template text', () => {
  const text = 'const s = `obj ${ {a: 1}.a + document.x } end`;';
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "document"' }]);
  assert.deepEqual(scanSource(text).strings, ['obj ', ' end']);
});

test('nodeDomViolations: a block comment between two identifiers does not glue them into one (acorn tokenizes "return" and "document" separately regardless of what sits between them)', () => {
  const text = 'return/* current title */document.title;';
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "document"' }]);
});

test('scanSource: "//" inside a template literal\'s own text (no interpolation) is still just text, not a comment', () => {
  const text = 'const t = `line // not a comment`;';
  assert.deepEqual(nodeDomViolations(text), []);
  assert.deepEqual(scanSource(text).strings, ['line // not a comment']);
});

test('scanSource: a multi-line template literal (an ASCII-art legend) is captured whole, with no violation', () => {
  const text = 'const legend = `\n  WWWWWWWW\n  W......W\n`;';
  assert.deepEqual(nodeDomViolations(text), []);
  assert.deepEqual(scanSource(text).strings, ['\n  WWWWWWWW\n  W......W\n']);
});

test('nodeDomViolations: an apostrophe inside a double-quoted string does not end it early', () => {
  const text = `"Don't go."; document.x = 1;`;
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "document"' }]);
});

test('fixtureReferences: every real fixture-path shape is caught, and near-miss words are not', () => {
  const caught = [
    ["'../sample-mmc3/build'", '../sample-mmc3/build'],
    ["'sample'", 'sample'],
    ["'sample-rpg-mmc1'", 'sample-rpg-mmc1'],
    ["'ROOT/sample-rpg'", 'ROOT/sample-rpg']
  ];
  for (const [literal, expected] of caught) {
    assert.deepEqual(fixtureReferences(`const x = ${literal};`), [expected], `${literal} must be caught as ${JSON.stringify(expected)}`);
  }
  const clear = [`'sample-common'`, `'tools/make-sample.js'`, `'resampled'`];
  for (const literal of clear) {
    assert.deepEqual(fixtureReferences(`const x = ${literal};`), [], `${literal} must not be caught`);
  }
});

// --- regex literals: quotes inside one are never string delimiters, and --
// --- a regex is never mistaken for division or vice versa ---------------

test('nodeDomViolations: a quoted character class inside a regex literal does not open a string that swallows the code after it', () => {
  const text = `const quote = /["']/g; const title = document.title;`;
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "document"' }]);
});

test('nodeDomViolations: division after a bare identifier is not misread as a regex literal', () => {
  const text = 'const x = a / document.x / 2;';
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "document"' }]);
});

test('nodeDomViolations: a "/" inside a regex character class does not close the literal early', () => {
  const text = 'const ok = /[/]/.test(y); document.z = 1;';
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "document"' }]);
});

test('scanSource: a regex literal inside ${...} containing a literal "}" is one token, so the "}" does not end the interpolation early', () => {
  const text = 'const s = `${/}/.test(x)} tail`;';
  assert.doesNotThrow(() => scanSource(text));
  const { strings } = scanSource(text);
  assert.equal(strings[strings.length - 1], ' tail', `expected the last string entry to be " tail", got ${JSON.stringify(strings)}`);
});

test('fixtureReferences: a regex literal following a string does not disturb string tracking', () => {
  const text = `const p = 'sample-rpg'.replace(/-/g, '/');`;
  assert.deepEqual(fixtureReferences(text), ['sample-rpg']);
});

test('nodeDomViolations: a regex literal preceded by a keyword ("return") is still recognised as a regex, not division', () => {
  const text = 'return /"/.test(s) ? document.a : 0;';
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "document"' }]);
});

// --- reviewer round-6 adversarial cases: every one a hand-rolled -----------
// --- regex-vs-division heuristic could not resolve in general -------------

test('nodeDomViolations: division after a postfix "++" is not misread as a regex literal start', () => {
  const text = 'x = y++ / 2; const t = document.a / 2;';
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "document"' }]);
});

test('nodeDomViolations: "in" as a property name (not the operator keyword), divided straight through to a bare identifier, does not misread the identifier as a regex\'s own contents', () => {
  // The reviewer's original counterexample, not a weakened one-slash
  // version: TWO divisions in a row is exactly the shape that would make a
  // heuristic without real expression-context tracking swallow
  // "document.a" as a bogus regex body between the two "/"s.
  const text = 'const q = limits.in / document.a / 2;';
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "document"' }]);
});

test('nodeDomViolations: an identifier merely prefixed with a keyword\'s spelling ("$return"), divided straight through to a bare identifier, is not mistaken for the keyword itself', () => {
  const text = 'const z = $return / document.a / 2;';
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "document"' }]);
});

test('nodeDomViolations: division directly after an empty object literal, straight through to a bare identifier, reads as division, not a regex', () => {
  const text = 'const z = {} / document.a / 2;';
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "document"' }]);
});

test('nodeDomViolations: a regex literal starting an "if" statement\'s single (unbraced) body is recognised as a regex, not division, and its quotes are not string delimiters', () => {
  const text = `if (enabled) /["']/.test(s); const title = document.title;`;
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "document"' }]);
});

test('nodeDomViolations: a regex literal starting a new statement right after a function declaration\'s closing "}" is recognised as a regex, not division', () => {
  const text = 'function f() {}\n/re/.test(s); document.b;';
  assert.deepEqual(nodeDomViolations(text), [{ kind: 'identifier', detail: 'references "document"' }]);
});

test('fixtureReferences: a fixture name is still reported when the statement before it holds a quoted regex literal', () => {
  const text = `const r = /["']/g; const t = 'sample-rpg';`;
  assert.deepEqual(fixtureReferences(text), ['sample-rpg']);
});

// --- literalOccurrences: sees every quote kind, never a comment -----------

test('literalOccurrences: finds a needle in single-, double-, and template-quoted literals, but never inside a comment', () => {
  assert.deepEqual(literalOccurrences(`const a = 'Blank action';`, 'Blank action'), ['Blank action']);
  assert.deepEqual(literalOccurrences(`const a = "Blank action";`, 'Blank action'), ['Blank action']);
  assert.deepEqual(literalOccurrences('const a = `Blank action`;', 'Blank action'), ['Blank action']);
  assert.deepEqual(literalOccurrences('// Blank action is the default', 'Blank action'), []);
});

test('literalOccurrences negative control: a duplicate label list injected into the real renderer/app.js text is flagged, whatever quote style it uses, but a comment merely mentioning a label is not', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { STARTERS } = await import('../../shared/starters/index.js');
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const realText = await fs.readFile(path.join(ROOT, 'renderer/app.js'), 'utf8');
  const label = STARTERS[0].label;
  const other = STARTERS[1].label;

  const templateInjected = realText + `\nconst labels = [\`${label}\`, \`${other}\`];\n`;
  assert.ok(literalOccurrences(templateInjected, label).length > 0, 'a backtick-literal duplicate list must be flagged');

  const singleInjected = realText + `\nconst labels = ['${label}', '${other}'];\n`;
  assert.ok(literalOccurrences(singleInjected, label).length > 0, 'a single-quoted duplicate list must be flagged');

  const doubleInjected = realText + `\nconst labels = ["${label}", "${other}"];\n`;
  assert.ok(literalOccurrences(doubleInjected, label).length > 0, 'a double-quoted duplicate list must be flagged');

  const commentInjected = realText + `\n// ${label} is the default\n`;
  assert.deepEqual(literalOccurrences(commentInjected, label), [], 'a comment merely mentioning a label must not be flagged');
});
