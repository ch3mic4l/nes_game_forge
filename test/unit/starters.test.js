// ROADMAP item 8 (starter projects), phase 1: the catalog, the IPC rename and
// unknown-id handling, and the picker's own structural proof
// (docs/design-starter-projects.md §3, §4, §6, §11 tests 1, 2, 3, 4, 13).
// Tests 5 and 16a live in main/smoke.js, not here (§11's own split).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STARTERS } from '../../shared/starters/index.js';
import { createProject, validateProject, GAME_TYPES } from '../../shared/project.js';
import { createProjectAt, loadProject } from '../../main/project-io.js';
import { screenFromArt as screenFromArtViaTools } from '../../tools/sample-common.js';
import { screenFromArt as screenFromArtViaStarters } from '../../shared/starters/authoring.js';
import { nodeDomViolations, fixtureReferences, literalOccurrences } from '../lib/sourcescan.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// --- 1: the catalog itself -------------------------------------------------

test('1: the two blank starters are byte-for-byte deep-equal to createProject, with every literal expectation pinned rather than read off the entry under test', () => {
  const blankAction = STARTERS.find((s) => s.id === 'blank-action');
  const blankRpg = STARTERS.find((s) => s.id === 'blank-rpg');
  assert.ok(blankAction, 'STARTERS must contain a "blank-action" entry');
  assert.ok(blankRpg, 'STARTERS must contain a "blank-rpg" entry');

  // Literal on both sides -- a build() that sets or omits a field createProject
  // itself does not (a stray titleMap, a palette tweak) fails here even if the
  // catalog's own gameType field agrees with the bug.
  assert.deepStrictEqual(blankAction.build('X'), createProject('X', 'action'));
  assert.deepStrictEqual(blankRpg.build('X'), createProject('X', 'rpg'));

  // The catalog's own gameType metadata, checked independently of what
  // build() actually produces -- a catalog entry whose gameType field
  // disagrees with its own build output is a real, separate bug the
  // deep-equal checks above cannot see (design §11 test 1's own round-3
  // correction: nothing in this codebase reads starter.gameType today, but
  // it is metadata the picker's own hint text depends on being right).
  assert.equal(blankAction.gameType, 'action');
  assert.equal(blankRpg.gameType, 'rpg');

  const ids = STARTERS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'every STARTERS id must be unique');
  for (const starter of STARTERS) {
    assert.equal(typeof starter.id, 'string');
    assert.equal(typeof starter.label, 'string');
    assert.equal(typeof starter.hint, 'string');
    assert.ok(GAME_TYPES.some((g) => g.id === starter.gameType), `gameType "${starter.gameType}" must be a real GAME_TYPES id`);
    assert.equal(typeof starter.build, 'function');
  }
});

// --- 2: the picker is a real consumer of the catalog, not a second list ----

test('2: renderer/app.js imports STARTERS, chooseStarter references it, no starter label lives in a second string/template literal anywhere in the file, and chooseGameType is gone', () => {
  const text = fsSync.readFileSync(path.join(ROOT, 'renderer/app.js'), 'utf8');

  // (a) the import itself.
  assert.match(
    text,
    /import\s*\{\s*STARTERS\s*\}\s*from\s*'\.\.\/shared\/starters\/index\.js';/,
    'renderer/app.js must import STARTERS from ../shared/starters/index.js'
  );

  // (b) no literal label anywhere in the file, in ANY of the three quote
  // kinds -- via the scanner's own literalOccurrences, not a raw
  // text.includes(), which only ever checked the single- and double-quoted
  // spellings and so missed a template-literal duplicate list entirely
  // (`const labels = [\`Blank action\`, \`Blank RPG\`]; ... labels[index]`
  // passed every prior version of this test). Not scoped to chooseStarter's
  // own body, so a second, wired-correctly label list declared elsewhere
  // (and merely rendered from inside chooseStarter) still fails this
  // (design §11 test 2's own round-3 widening).
  for (const starter of STARTERS) {
    const occurrences = literalOccurrences(text, starter.label);
    assert.deepEqual(
      occurrences,
      [],
      `the literal label ${JSON.stringify(starter.label)} must not appear in any string/template literal in renderer/app.js (found ${JSON.stringify(occurrences)})`
    );
  }

  // (c) chooseStarter's own body actually consumes the import (proves (a)
  // is not an unused import) -- extracted structurally, the same
  // "read the source, don't trust a hand-written summary" idiom
  // test/unit/playerparts.test.js:380-394 already uses for a different
  // delegation.
  // The lazy `[\s\S]*?` stops at the first column-0 `}` -- chooseStarter's
  // own closing brace, since every inner brace in its body is indented --
  // with no assumption about what is declared next, so a harmless
  // reordering of renderer/app.js cannot fail this for a reason unrelated
  // to what it checks.
  const fnMatch = text.match(/function chooseStarter\(\) \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected to find a top-level chooseStarter() function in renderer/app.js');
  assert.match(fnMatch[0], /\bSTARTERS\b/, "chooseStarter's own body must reference STARTERS");

  // (d) the old function is really gone, not just unused.
  assert.doesNotMatch(text, /\bchooseGameType\b/);
});

// --- 3: every starter builds and validates clean ---------------------------

test('3: every STARTERS entry\'s build("X") returns without throwing and validates with zero errors', () => {
  for (const starter of STARTERS) {
    let project;
    assert.doesNotThrow(() => {
      project = starter.build('X');
    }, `starter "${starter.id}" threw while building`);
    const errors = validateProject(project).filter((p) => p.severity === 'error');
    assert.deepEqual(errors, [], `starter "${starter.id}" must validate with zero errors`);
  }
});

// --- 4: createProjectAt's own starterId resolution and unknown-id refusal --

test('4: createProjectAt resolves starterId before touching the filesystem, refuses an unknown id, and keeps its default', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-starters-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));

  // An unknown id must leave the directory untouched entirely -- not even
  // created -- rather than a fallback to blank-action.
  const missing = path.join(base, 'missing');
  await assert.rejects(createProjectAt(missing, 'X', 'no-such-starter'), /Unknown starter "no-such-starter"/);
  const missingExists = await fs.access(missing).then(
    () => true,
    () => false
  );
  assert.equal(missingExists, false, 'an unknown starterId must not create the target directory');

  // A real, non-default id.
  const rpgDir = path.join(base, 'rpg');
  await createProjectAt(rpgDir, 'X', 'blank-rpg');
  const rpgProject = await loadProject(rpgDir);
  assert.equal(rpgProject.project.gameType, 'rpg');

  // The omitted-argument default keeps the two untouched main/smoke.js call
  // sites working (neither passes a third argument today).
  const defaultDir = path.join(base, 'default');
  await createProjectAt(defaultDir, 'X');
  const defaultProject = await loadProject(defaultDir);
  assert.equal(defaultProject.project.gameType, 'action');
});

// --- 13: no starter or starter test reaches for a fixture -------------------

// A fixture reference is a path, so this only ever looks inside string
// literals (never a comment, never an identifier) for one of the six real
// checked-in fixture directory names, and only when the name fills a whole
// path component -- see test/lib/sourcescan.js's own fixtureReferences.

test('13: no file under shared/starters/, nor this test file itself, references one of the six checked-in fixture directories', async () => {
  const dir = path.join(ROOT, 'shared/starters');
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.js'));
  assert.ok(files.length > 0, 'expected at least one file under shared/starters/');
  const targets = [...files.map((name) => path.join(dir, name)), path.join(ROOT, 'test/unit/starters.test.js')];
  for (const file of targets) {
    const text = await fs.readFile(file, 'utf8');
    const offenders = fixtureReferences(text);
    assert.deepEqual(
      offenders,
      [],
      `${path.relative(ROOT, file)} must not reference one of the six checked-in fixture directories (found ${JSON.stringify(offenders)})`
    );
  }
});

// --- screenFromArt: a real re-export, not a copy ----------------------------

test('tools/sample-common.js\'s screenFromArt is identically shared/starters/authoring.js\'s screenFromArt (re-export, not a duplicate)', () => {
  assert.equal(screenFromArtViaTools, screenFromArtViaStarters);
});

// --- CLAUDE.md's "shared/ modules must stay free of DOM and Node APIs" ----

// See test/lib/sourcescan.js's own nodeDomViolations: identifier-level
// references are checked only in real code (never inside a string literal,
// so dialogue like "Look through the window." cannot trip it), and an
// import specifier is judged a Node builtin by node:module's own
// isBuiltin, covering every prefixed/bare/subpath spelling with no
// hand-written list -- static, side-effect, and dynamic imports alike.

test('every .js file under shared/starters/ stays free of Node and DOM APIs, per CLAUDE.md\'s own shared/ rule', async () => {
  const dir = path.join(ROOT, 'shared/starters');
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.js'));
  assert.ok(files.length > 0, 'expected at least one file under shared/starters/');
  for (const name of files) {
    const label = `shared/starters/${name}`;
    const text = await fs.readFile(path.join(dir, name), 'utf8');
    const violations = nodeDomViolations(text);
    assert.deepEqual(
      violations,
      [],
      `${label} ${violations.map((v) => v.detail).join('; ')}`
    );
  }
});
