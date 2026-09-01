// CLAUDE.md makes two promises nothing ever checked. First, it points agents at handoff-*/
// design docs for mechanism depth it deliberately keeps out of the file itself -- but until
// 39dac4d, CLAUDE.md named nine such documents and not one of them was tracked by git. They
// were never gitignored, merely never `git add`ed, so a fresh clone or a `git clean -fdx`
// silently took every destination the file cited; existence-on-disk alone would have passed the
// whole time this was true. Second, it stays under Claude Code's 150,000-character tool limit --
// but it crossed that limit once already, one ordinary docs pass at a time, with nothing to
// notice the slide until agents started silently losing part of their own instructions.
//
// Both are the same "two things that must agree" shape this suite already holds elsewhere --
// kernelbytes.test.js holds a byte figure to the assembler, music.test.js holds three
// implementations of one format to each other -- applied here to the docs instead of the code.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLAUDE_MD_PATH = path.join(ROOT, 'CLAUDE.md');

// Characters, not bytes -- this is the trap. Claude Code's limit is on characters, and CLAUDE.md
// is full of en-dashes, arrows and typographic quotes that are one character each but more than
// one UTF-8 byte, so Buffer.byteLength (or .length on a Buffer) reports a count several hundred
// higher than what actually gets truncated against. fs.readFileSync(path, 'utf8').length decodes
// the file to a JS string first and matches what `wc -m` reports, to within the file's one
// astral-plane character (a camera emoji under "The emulator"): `wc -m` counts it as the single
// character it displays as, String.length counts its two UTF-16 code units, so .length reads one
// *higher* than `wc -m` here -- which only ever makes the budget check below trip earlier, never
// later, so it is left as-is rather than special-cased.
const CLAUDE_MD_TEXT = fs.readFileSync(CLAUDE_MD_PATH, 'utf8');

const HANDOFF_POINTERS = [...new Set(CLAUDE_MD_TEXT.match(/handoff-[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.md/g) ?? [])];

test('the handoff-pointer extraction regex actually matches something in CLAUDE.md', () => {
  // A regex that silently stops matching (CLAUDE.md's own pointer style drifts, or this file's
  // pattern is edited wrong) makes every check below vacuously pass -- a docs test that passes
  // because it checked nothing is worse than no test, since it reads as coverage. This is the
  // one assertion standing between that failure mode and a green run.
  assert.ok(
    HANDOFF_POINTERS.length > 0,
    'found zero handoff-*/*.md pointers in CLAUDE.md -- either every mechanism-depth pointer was ' +
      'removed from the file (unlikely) or the extraction regex in this test no longer matches ' +
      "CLAUDE.md's own pointer style (likely). Fix the regex before trusting this suite again."
  );
});

// The guard above only catches *total* extraction failure. It says nothing if the strict pattern
// is merely too narrow -- a pointer written in a form it does not match (a nested path, an
// uppercase HANDOFF, some other shape) would sit right next to five others that do match, the
// guard above would stay green, and that one pointer would be silently skipped by every check
// below. That is the same false-pass failure mode the guard above exists to prevent, just
// narrower, and it is a live style in this repo: HANDOFF-item5-phase4c.md sits at the repo root
// in a shape the strict pattern below would not match if something like it were ever referenced
// from CLAUDE.md. So a second, deliberately loose scan -- case-insensitive, no fixed slash
// structure -- catches anything handoff-*.md-shaped, and the strict set must cover all of it.
const BROAD_HANDOFF_MATCHES = [...new Set(CLAUDE_MD_TEXT.match(/handoff-[\w./-]*\.md/gi) ?? [])];

test('the strict pointer pattern is not silently narrower than a loose scan for anything handoff-like', () => {
  const strictSet = new Set(HANDOFF_POINTERS);
  const missed = BROAD_HANDOFF_MATCHES.filter((match) => !strictSet.has(match));
  assert.deepEqual(
    missed,
    [],
    `the loose handoff-*.md scan found reference(s) the strict pointer pattern above did not match: ` +
      `${missed.join(', ')}. Each one is being silently skipped by every check in this file -- either ` +
      'it is written in a style the strict pattern needs to be widened to cover, or it is not really a ' +
      "pointer this test should track and the loose scan needs narrowing. Either way, don't leave it " +
      'unchecked.'
  );
});

const TRACKED_FILES = new Set(
  execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
);

for (const pointer of HANDOFF_POINTERS) {
  test(`CLAUDE.md's pointer to ${pointer} resolves and is tracked by git`, () => {
    assert.ok(
      fs.existsSync(path.join(ROOT, pointer)),
      `CLAUDE.md points at "${pointer}", which does not exist on disk. Either the doc was ` +
        'renamed or deleted and the CLAUDE.md reference is now stale, or the pointer was ' +
        'mistyped -- fix whichever it is.'
    );
    assert.ok(
      TRACKED_FILES.has(pointer),
      `CLAUDE.md points at "${pointer}", which exists on disk but is not tracked by git. Either ` +
        `track it (\`git add ${pointer}\`) if it is the intended destination, or the pointer itself ` +
        'is wrong and should be corrected to name a doc that is already tracked. An untracked ' +
        'destination silently vanishes on a fresh clone or `git clean -fdx`, taking with it the ' +
        'mechanism depth CLAUDE.md defers to it instead of carrying inline.'
    );
  });
}

const CLAUDE_MD_CHAR_BUDGET = 135000;

test(`CLAUDE.md stays under its ${CLAUDE_MD_CHAR_BUDGET}-character budget`, () => {
  assert.ok(
    CLAUDE_MD_TEXT.length <= CLAUDE_MD_CHAR_BUDGET,
    `CLAUDE.md is ${CLAUDE_MD_TEXT.length} characters, over its ${CLAUDE_MD_CHAR_BUDGET}-character ` +
      "budget. That budget is kept below Claude Code's hard 150,000-character tool limit " +
      'specifically so this test fails before an agent working in this repo starts silently ' +
      'losing part of its own instructions, not after. The fix is to move whichever docs pass ' +
      "pushed this over into the relevant handoff-*/design-*.md doc's mechanism depth -- not to " +
      'delete rules to make room.'
  );
});
