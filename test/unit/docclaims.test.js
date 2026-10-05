// Phase 3a slice S4: the current-state docs are checked against the code they describe.
//
//   T2  every backticked path and identifier in docs/reference-*.md, README.md and CLAUDE.md exists
//   T3  nothing claims a scripted Move cannot cross a seam (the S3b-deleted warning and its wording)
//   T4  every streamed-map warning and refusal still fires, and the docs that describe one still name it
//   README  the figures in the README's streamed-worlds row equal the ones the code carries
//
// docs/design-*.md are dated design records that name deleted symbols on purpose; they are out of scope.
//
// T2 POLICY (the code is classify(), pathExists(), namedAsGone() and buildCorpus() in test/lib/docclaims.js):
//   * a token is the text of one backtick span outside a fenced block, whitespace collapsed;
//   * a trailing "()" and a trailing ":N" / ":N-M" are dropped; a token still holding whitespace or one of
//     $ * < > { } ( ) [ ] = + , ; | ~ " ' ! ? \ is prose, a pattern or an expression and is left alone;
//   * a token starting with "." (".asm") is a bare extension and is left alone;
//   * a token holding "/" or ending in a known extension is a PATH. It resolves only if git TRACKS it (`git ls-files`
//     lists it, or lists something under it; a doc says `banks.asm` for engine/banks.asm, so a tracked path's tail
//     counts) -- a file that merely exists on this machine is never evidence, so the answer is the same in a fresh
//     clone. Paths under build/, assets/ or code/ are build output or live inside a user's project, and are skipped;
//     so is a bare "name.inc". A path that git does not track and a doc still cites on purpose is listed in
//     UNTRACKED_CITATIONS, once, with its reason; the list is checked both ways and never consults the local disk;
//   * a token of the shape a_b/c/d (lowercase snake_case, then /segments) is an ALTERNATION (`sw_cross_left/right`
//     means sw_cross_left and sw_cross_right) and each expansion is checked as an identifier;
//   * an ALL_CAPS name of three or more characters (an underscore or not), a snake_case name with an underscore, or a
//     camelCase name is an IDENTIFIER and must be spelled in code of a tracked file under engine/, main/, shared/ or
//     renderer/ (comments do not count) -- or be declared (function, const, let, var, class, export {}; again not in
//     a comment or a string) in a tracked test/ file, or be a field name in a tracked JSON fixture. A name that a test
//     merely MENTIONS (a string, a comment, an absence assertion) is not enough: rammap.test.js names sw_step_nocross
//     in order to pin it gone, and that must not vouch for a doc that still calls it current. The one ALL_CAPS word
//     that is prose is a 6502 mnemonic;
//   * a missing identifier is allowed when the doc says that NAMED symbol is gone ("S3b deleted `x`", "`x` (deleted in
//     S3b)", "`x` was replaced"): a deletion word about a neighbour in the same sentence vouches for nothing;
//   * any other missing identifier is listed in PRE_EXISTING with its file, token, exact occurrence count and a
//     reason, checked both ways, so fixing a doc forces its entry out and a second use of a listed name still fails;
//   * everything else -- plain words, Capitalised Words, numbers, hex, registers -- is prose.
// T3 POLICY: a sentence claiming a scripted Move cannot cross is exempt only if it says that claim (the warning, the
// stop, the restriction) was deleted, or is placed before S3b; every renderer/ and shared/ string literal is scanned,
// the vendored emulator core included.
// This file is excluded from the symbol corpus, because it names the sabotage symbols itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, extractTokens, classify, buildCorpus, pathExists, trackedFiles, namedAsGone, testDeclarations } from '../lib/docclaims.js';
import { scanSource } from '../lib/sourcescan.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import {
  createProject,
  createMap,
  createScreen,
  validateProject,
  streamedBoardProblems,
  streamedGridProblems,
  growOrShrinkMap,
  normalizeProject,
  LIMITS
} from '../../shared/project.js';
import { STREAM_TILE_BOUND, STREAM_TILE_BOUND_WITH_BOUND_TILES } from '../../shared/streambound.js';
import { moverSpeedNote } from '../../shared/streamlayout.js';
import { checkStreamedMapperSwitch } from '../../main/build/generate.js';

const SELF = 'test/unit/docclaims.test.js';
const tracked = trackedFiles();
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SCOPE = tracked.filter((f) => /^docs\/reference-[\w-]+\.md$/.test(f) || f === 'README.md' || f === 'CLAUDE.md');

// ------------------------------------------------------------------------------------------------------------- T2

// A cited PATH that git does not track. A path counts as resolved only if `git ls-files` lists it (or lists
// something under it, for a directory): a file that merely exists on this machine is not evidence, because the answer
// must be the same in a fresh clone. These are cited on purpose -- session evidence under the gitignored
// handoff-next/, a path in the Mesen2 source tree, a file a user installs -- and each is listed here once, with the
// reason it is allowed. Both directions are checked, independently of whether the file exists locally: a cited
// untracked path that is not listed fails, a listed path no doc cites fails, and a listed path that git now tracks
// fails (delete the entry).
const UNTRACKED_CITATIONS = [
  ['Core/NES/Mappers/Homebrew/FlashSST39SF040.h', 'a path inside the Mesen2 source tree, an external repository, not this one'],
  ['node_modules/electron/dist/chrome-sandbox', 'a file of the installed electron package (node_modules/ is gitignored); CLAUDE.md names it in the sandbox instructions'],
  ['handoff-next/s3b/impl/D/L5.json', 'session evidence (gitignored): the Mesen L5 talker + Battle runner\'s 24-case result, 2026-10-04'],
  ['handoff-next/streamed-worlds-phase3a-s1-report.md', 'session evidence (gitignored): phase 3a slice S1\'s report, the measured effect and traces of the Move-gate guard'],
  ['handoff-next/s1-q1c/', 'session evidence (gitignored): the Q1c prototype measurements that chose the (a1) parity gate'],
  ['handoff-next/s9-fix1-evidence/measure-blackout.mjs', 'session evidence (gitignored): the script that measured the dialogue blackout\'s 34 extra frames'],
  ['handoff-next/review-phase2-s10-round1-evidence/probe.mjs', 'session evidence (gitignored): the phase 2 slice 10 round-1 reviewer\'s independent ceiling probe'],
  ['handoff-next/review-phase2-s10-round1-findings.md', 'session evidence (gitignored): the phase 2 slice 10 round-1 review, finding 2 (the -101 constant)'],
  ['handoff-next/progress-phase2-s10-fix1.md', 'session evidence (gitignored): the written 24-line/2-song/8-sfx/3-monster RPG inventory'],
  ['handoff-next/s10-fix3-scratch/details.log', 'session evidence (gitignored): the phase 2 slice 10 fix round 3 measurement log'],
  ['handoff-next/review-phase2-s10-round3-evidence/details.log', 'session evidence (gitignored): the round-3 reviewer\'s own copy of that measurement log'],
  ['handoff-next/s9-fix3-scratch/accepted-boundary-remeasure.mjs', 'session evidence (gitignored): the accepted-boundary re-measure script'],
  ['handoff-next/s1-a1/fix6/accepted-boundary.log', 'session evidence (gitignored): the accepted-boundary figures on the final (a1) tree'],
  ['handoff-next/s1-defer3/accepted-boundary-s1.log', 'session evidence (gitignored): the accepted-boundary figures on the S1-only tree'],
  ['handoff-next/s3b/impl/D/aggregate.json', 'session evidence (gitignored): the L5 Mesen aggregate over the six launch files, 2026-10-04']
];

// Identifier hits that were already in the docs before phase 3a, or are history the old wording does not label.
// Not fixed by slice S4 (the brief said to report them, not to fix them or hide them). Matched by file + token and the
// number of occurrences, in both directions: a hit not listed, or more occurrences than listed, fails the test, and an
// entry that no longer hits (or hits less often) fails it too, so fixing a doc forces the entry out. A sentence that
// says the NAMED symbol is gone (namedAsGone) needs no entry.
// [file, token, occurrences, reason]
const PRE_EXISTING = [
  ['CLAUDE.md', 'PATH', 1, 'the shell environment variable the sentence says nesasm must be on, not a symbol of this tree'],
  ['README.md', 'PATH', 1, 'the shell environment variable nesasm must be on, not a symbol of this tree'],
  ['docs/reference-battle-system.md', 'PENDING', 1, 'a state name written in capitals in prose (the strip the overlay waits on); no symbol of that name'],
  ['docs/reference-battle-system.md', 'arm_attack', 1, 'shorthand inside the list `battle_fx_arm_at`/`arm_attack`/`tick`/`draw`; the labels are battle_fx_arm_attack and its siblings'],
  ['docs/reference-engine.md', 'dispatch_save_arm_gate', 1, 'the span is named by the base of its dispatch_save_arm_gate_start/_end label pair in engine/input.asm; no label has the bare name'],
  ['docs/reference-engine.md', 'main_loop_save_gate', 2, 'named by the base of its main_loop_save_gate_start/_end label pair in engine/boot.asm; no label has the bare name'],
  ['docs/reference-event-system.md', 'script_ptr', 2, 'a conceptual name for the script pointer pair (script_ptr_lo/script_ptr_hi); there is no symbol of the bare name'],
  ['docs/reference-kernel-budget.md', '_tile_y', 1, 'suffix shorthand in `sw_oam_project_tile_x`/`_tile_y`; the label sw_oam_project_tile_y exists'],
  ['docs/reference-kernel-budget.md', 'STREAMWORLD_CROSS_KERNEL_ALLOWANCE', 1, 'line 221 says "see `STREAMWORLD_CROSS_KERNEL_ALLOWANCE`\'s own retirement note below" (487 is that note, and says it is retired); the sentence itself holds no deletion verb'],
  ['docs/reference-kernel-budget.md', '_row_down', 1, 'suffix shorthand in `sw_win_entering_col_right`/`_row_down`; the label sw_win_entering_row_down exists in engine/streamworld.asm'],
  ['docs/reference-kernel-budget.md', 'requestedText', 1, 'a quoted test-input name from a kernelbytes scenario description, not a code symbol'],
  ['docs/reference-kernel-budget.md', '_dispatch_done', 1, 'suffix shorthand in `build_oam_draw_dispatch`/`_dispatch_done`; the label is build_oam_draw_dispatch_done'],
  ['docs/reference-kernel-budget.md', 'script_op_save_dispatch', 1, 'named by the base of its _start/_end label pair in engine/save.asm; no label has the bare name'],
  ['docs/reference-kernel-budget.md', 'dispatch_save_arm_gate', 1, 'named by the base of its _start/_end label pair in engine/input.asm; no label has the bare name'],
  ['docs/reference-kernel-budget.md', 'sw_dlg17cr_save_check', 1, 'named by the base of its _start/_end label pair in engine/streamdialog.asm; no label has the bare name'],
  ['docs/reference-kernel-budget.md', 'main_loop_save_gate', 1, 'named by the base of its main_loop_save_gate_start/_end label pair in engine/boot.asm; no label has the bare name'],
  ['docs/reference-kernel-budget.md', 'sw_step_nocross', 3, 'measured history of S3a/S3b (lines 120, 130, 729): each says the slice deleted the guard, or that the flag no longer exists, but not in the words next to this name'],
  ['docs/reference-kernel-budget.md', 'move_tick_probe_v_streamed', 1, 'phase 3a S1 (a1) history: "Before S3a it paid for a private probe stage"; the probe stage was deleted in S3a'],
  ['docs/reference-kernel-budget.md', 'move_tick_probe_h_streamed', 1, 'phase 3a S1 (a1) history: "Before S3a it paid for a private probe stage"; the probe stage was deleted in S3a'],
  ['docs/reference-kernel-budget.md', 'STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE', 3, 'measured history (lines 390, 693, 729): the constant was deleted in S3b; lines 390 and 729 say so in the same sentence or row, but not next to this name'],
  ['docs/reference-kernel-budget.md', 'draw_one_entity_ordinary_join', 1, 'measured history: the sentence says the join `jmp` "no longer exists"; the label itself was never reintroduced']
];

// Every unresolved name in a doc: [{ file, line, token, name, kind, why }]. `read` is a parameter so a probe can hand
// it a synthetic doc.
export function findDocHits(files, corpus, tracked, readFile = read) {
  const hits = [];
  for (const file of files) {
    const { tokens } = extractTokens(readFile(file));
    for (const { token, line, sentence, at, len } of tokens) {
      const c = classify(token);
      if (!c || c.kind === 'generated') continue;
      if (c.kind === 'path') {
        if (!pathExists(c.name, tracked)) hits.push({ file, line, token, name: c.name, kind: 'path', why: 'no tracked file' });
        continue;
      }
      for (const name of c.kind === 'alternation' ? c.names : [c.name]) {
        if (corpus.product.has(name) || corpus.testDefined.has(name) || corpus.jsonKeys.has(name)) continue;
        if (namedAsGone(sentence, at, len)) continue; // the sentence says THIS symbol is deleted, retired or replaced
        hits.push({ file, line, token: c.kind === 'alternation' ? name : token, name, kind: 'identifier', why: corpus.tests.has(name) ? 'only a test mentions it' : 'no such symbol' });
      }
    }
  }
  return hits;
}

const corpus = buildCorpus([SELF]);
const docHits = (files, reader) => findDocHits(files, corpus, tracked, reader);
const probeDoc = (text) => docHits(['probe.md'], () => text).map((h) => h.token);

test('T2 classify: the rule, case by case', () => {
  const kind = (s) => classify(s)?.kind ?? null;
  assert.equal(kind('engine/banks.asm'), 'path');
  assert.equal(kind('banks.asm'), 'path');
  assert.equal(kind('docclaims.test.js:12-30'), 'path', 'a line suffix is dropped');
  assert.equal(kind('sw_pstep_left'), 'identifier');
  assert.equal(kind('sw_pstep_left()'), 'identifier');
  assert.equal(kind('STREAM_TILE_BOUND'), 'identifier');
  assert.equal(kind('LEGACYBANK'), 'identifier', 'ALL_CAPS without an underscore is a constant too');
  assert.equal(kind('streamTileBoundFor'), 'identifier');
  assert.deepEqual(classify('sw_cross_left/right').names, ['sw_cross_left', 'sw_cross_right']);
  for (const prose of ['Move', 'route', 'a b', '$FF', '0x1F', 'x += 1', '.asm', 'A', 'FF', 'LDA', 'BNE', 'sw_a|sw_b', 'engine/*.asm', 'foo(bar)', '15', "can't"]) {
    assert.equal(kind(prose), null, prose);
  }
  for (const generated of ['build/game.nes', 'assets/config.inc', 'code/engine/', 'config.inc']) assert.equal(kind(generated), 'generated', generated);
});

test('T2 extractTokens: fenced blocks are skipped, a span may wrap a line, an odd paragraph is reported not guessed', () => {
  const text = ['Alpha `one_two` beta `three`', '', '```', '`fenced_name`', '```', '', 'wrapped `four_', 'five` end', '', 'odd ` tick `six_seven` here'].join('\n');
  const { tokens, unbalanced } = extractTokens(text);
  assert.deepEqual(tokens.map((t) => t.token), ['one_two', 'three', 'four_ five']);
  assert.deepEqual(unbalanced, [10]);
  const { sentence, at, len } = tokens[1];
  assert.equal(sentence.slice(at, at + len), '`three`', 'a span knows where it sits in its sentence');
});

test('T2 every backticked path and identifier in the current-state docs resolves (or is a listed exception)', () => {
  assert.ok(SCOPE.length >= 12, `the scope found ${SCOPE.length} files`);
  for (const f of SCOPE) assert.equal(extractTokens(read(f)).unbalanced.length, 0, `${f}: a paragraph with an odd number of backticks cannot be checked`);
  const hits = docHits(SCOPE);
  for (const [, reason] of UNTRACKED_CITATIONS) assert.ok(reason.length > 20, 'each inventory entry carries a reason');
  for (const [, , , reason] of PRE_EXISTING) assert.ok(reason.length > 20, 'each entry carries a reason');

  // untracked paths: the inventory, both directions, with no look at the local disk
  const pathHits = hits.filter((h) => h.kind === 'path');
  const inventory = new Set(UNTRACKED_CITATIONS.map(([p]) => p));
  assert.equal(inventory.size, UNTRACKED_CITATIONS.length, 'one inventory entry per path');
  assert.deepEqual(pathHits.filter((h) => !inventory.has(h.name)).map((h) => `${h.file}:${h.line} \`${h.token}\` (${h.why})`), [], 'a doc cites a path git does not track and the inventory does not list');
  const cited = new Set(pathHits.map((h) => h.name));
  assert.deepEqual([...inventory].filter((p) => !cited.has(p)), [], 'an inventory path no doc cites any more: delete the entry');
  assert.deepEqual([...inventory].filter((p) => pathExists(p, tracked)), [], 'an inventory path git now tracks: delete the entry');

  // identifiers: file + token + count
  const idHits = hits.filter((h) => h.kind === 'identifier');
  const count = new Map();
  for (const h of idHits) count.set(`${h.file}|${h.token}`, (count.get(`${h.file}|${h.token}`) ?? 0) + 1);
  const listed = new Map(PRE_EXISTING.map(([f, t, n]) => [`${f}|${t}`, n]));
  assert.equal(listed.size, PRE_EXISTING.length, 'one entry per file and token');
  const over = new Set([...count].filter(([k, n]) => n > (listed.get(k) ?? 0)).map(([k]) => k));
  const fresh = idHits.filter((h) => over.has(`${h.file}|${h.token}`));
  assert.deepEqual(fresh.map((h) => `${h.file}:${h.line} \`${h.token}\` (${h.why})`), [], 'a doc names something the tree does not have (or names a listed exception more often than listed)');
  const stale = PRE_EXISTING.filter(([f, t, n]) => (count.get(`${f}|${t}`) ?? 0) !== n).map(([f, t, n]) => `${f} \`${t}\` x${n} (now ${count.get(`${f}|${t}`) ?? 0})`);
  assert.deepEqual(stale, [], 'a PRE_EXISTING entry no longer hits that often: fix its count or delete it');
});

test('T2 a name only a test mentions does not vouch for a doc; one a test declares does', () => {
  // sw_step_nocross and sw_move_probe were deleted; test files still spell them to pin the absence.
  for (const gone of ['sw_step_nocross', 'sw_move_probe', 'eventMovesPlayer']) {
    assert.equal(corpus.product.has(gone), false, `${gone} is not a product symbol`);
    assert.equal(corpus.testDefined.has(gone), false, `${gone} is not declared by a test`);
  }
  assert.ok(corpus.testDefined.has('createStreamedProject'), 'a test helper counts');
  assert.ok(corpus.product.has('sw_pstep_left'), 'an engine label counts');
  const hits = docHits(['probe.md'], () => 'Current: `sw_step_nocross` and `test/unit/nope-not-here.test.js` and `sw_pstep_left`.\n');
  assert.deepEqual(hits.map((h) => h.token), ['sw_step_nocross', 'test/unit/nope-not-here.test.js']);
  assert.equal(hits[0].why, 'only a test mentions it');
  assert.equal(hits[1].why, 'no tracked file');
});

test('T2 negative cases: three ways a doc could vouch for a name it should not', () => {
  // (1) ALL_CAPS without an underscore is an identifier, not prose.
  assert.deepEqual(probeDoc('The current bank is `LEGACYBANK`.\n'), ['LEGACYBANK']);
  // (2) a deletion word vouches only for the symbol it is said of, not for a neighbour in the same sentence.
  assert.deepEqual(probeDoc('The current guard is `sw_move_probe`, while `sw_step_nocross` was deleted.\n'), ['sw_move_probe']);
  assert.deepEqual(probeDoc('S3b deleted `sw_step_nocross`, `sw_move_probe` and `sw_step_gone`; the guard is `sw_move_probe_current`.\n'), ['sw_move_probe_current']);
  for (const fine of [
    'S3b deleted `sw_step_nocross`.',
    '`sw_step_nocross` was deleted in S3b.',
    '`sw_step_nocross` (deleted in S3b) used to guard the seam.',
    '`sw_step_nocross`, since replaced by the shared driver, guarded it.',
    'S3b removed `sw_step_nocross` and `sw_move_probe`.',
    'The guards `sw_step_nocross` and `sw_move_probe` were deleted.',
    '`sw_step_nocross` (the flag no longer exists) was a guard.'
  ]) assert.deepEqual(probeDoc(`${fine}\n`), [], fine);
  // (3) a name that only a test COMMENT mentions is not a declaration; a real declaration is.
  const commented = '// const sw_review_stale_guard = old value, removed from the engine.\n/* function sw_review_block() {} */\nconst note = "const sw_review_string = 1";\n';
  assert.deepEqual([...testDeclarations('test/unit/x.test.js', commented)], ['note']);
  assert.deepEqual([...testDeclarations('test/unit/x.test.js', 'function real_one() {}\nconst real_two = 1;\nclass RealThree {}\nexport { real_four, real_five as real_six };\nasync function* real_seven() {}\n')].sort(), ['RealThree', 'real_four', 'real_one', 'real_seven', 'real_six', 'real_two']);
  assert.deepEqual([...testDeclarations('test/lua/x.lua', '-- function gone_one()\nfunction kept_one() end\n')], ['kept_one']);
});

// ------------------------------------------------------------------------------------------------------------- T3

// The deleted warning, from `git show 071b5eb -- shared/project.js`: "the event on X moves the player, and a long
// enough Move can walk them to the edge of the screen. The engine now bounds and stops this at the edge, but it
// cannot cross to a new screen -- keep player Moves within the screen, or use a Warp to change screen."
const DELETED_WORDING = /moves the player, and a long enough Move|long enough Move can walk|cannot cross to a new screen|keep player Moves within the screen|walk them to the edge of the screen|engine now bounds and stops/gi;
const NEG = String.raw`(?:cannot|can't|can not|never|does not|doesn't|do not|don't|is unable to|are unable to)\s+cross(?:es)?\b`;
// "a Move ... cannot cross" or "cannot cross ... a Move", within one sentence and 80 characters.
const MOVE_CANNOT_CROSS = new RegExp(String.raw`\bMoves?\b[^.]{0,80}?\b${NEG}|\b${NEG}[^.]{0,80}?\bMoves?\b`, 'gi');

// A claim is historical only when the sentence says THE CLAIM ITSELF (the warning, the stop, the restriction) was
// deleted -- "The old warning that a scripted Move cannot cross a seam was deleted", or the claim quoted and then
// called a deleted warning -- or puts it in the time before S3b. A deletion word about something else in the same
// sentence ("... after the talker was removed") exempts nothing.
const NOUN = String.raw`(?:warning|claim|statement|restriction|refusal|message|wording|stop|wall)`;
const DONE = String.raw`(?:(?:is|was|were|has been|have been|got)\s+(?:now\s+|also\s+|since\s+)*(?:deleted|removed|retired|lifted|gone)|no longer exists?)\b`;
const INTRODUCED = new RegExp(String.raw`\b${NOUN}\s+(?:(?:that|saying|which says|claiming|reading|about|of)\s+)?["“'(]*\s*(?:\w+\s+){0,3}$`, 'i');
const FOLLOWED = new RegExp(String.raw`^[^.]{0,30}?\b${DONE}`, 'i');
const QUOTED_THEN_NAMED = new RegExp(String.raw`^["”']\s*(?:\))?\s*${NOUN}\s+${DONE}`, 'i');
const TEMPORAL = /\b(?:until S3b|before S3b|through S3a)\b/i;

export function sentences(text) {
  return text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z`"'(*[])/);
}
export function claimsMoveCannotCross(sentence) {
  const spans = [...sentence.matchAll(MOVE_CANNOT_CROSS), ...sentence.matchAll(DELETED_WORDING)].map((m) => [m.index, m.index + m[0].length]);
  return spans.some(([s, e]) => {
    const before = sentence.slice(0, s);
    const after = sentence.slice(e);
    const historical = TEMPORAL.test(before) || (INTRODUCED.test(before) && FOLLOWED.test(after)) || QUOTED_THEN_NAMED.test(after);
    return !historical;
  });
}
const offenders = (text) => sentences(text).filter(claimsMoveCannotCross);

test('T3 matcher: claims are caught, the deleted-warning sentences and unrelated crossings pass', () => {
  const CLAIMS = [
    'A scripted Move cannot cross a seam.',
    "The player's Move can't cross to the next screen.",
    'A Move never crosses the edge of its screen.',
    'The player cannot cross a seam during a scripted Move.',
    'A long enough Move can walk them to the edge of the screen.',
    'Keep player Moves within the screen, or use a Warp to change screen.',
    'The engine bounds and stops this at the edge, but it cannot cross to a new screen.',
    // a deletion word about something else does not exempt the claim
    'A scripted Move cannot cross a seam after the talker was removed.',
    'A scripted Move cannot cross a seam, and the old warning was deleted.',
    'The warning that a scripted Move cannot cross a seam is current, and a talker was removed.'
  ];
  for (const c of CLAIMS) assert.equal(claimsMoveCannotCross(c), true, `must flag: ${c}`);
  const FINE = [
    'The Map Forge\'s "a Move moves the player to the edge and cannot cross" warning is deleted with the stop.',
    'The old warning that a scripted Move cannot cross a seam was deleted.',
    'Through S3a the true player position never crossed: sw_step_nocross made the driver refuse any crossing.',
    'The old "keep player Moves within the screen" warning was removed in S3b.',
    'Before S3b a scripted Move could not cross, and a Warp was the only way to change screen.',
    'Until S3b a scripted Move cannot cross a seam.',
    'A scripted Move crosses a seam exactly as a walking step does.',
    'A dialogue box cannot cross a seam.',
    'The camera never crosses a screen boundary on its own.'
  ];
  for (const f of FINE) assert.equal(claimsMoveCannotCross(f), false, `must pass: ${f}`);
  // a wrapped paragraph is one sentence stream
  assert.equal(offenders('First line.\nA scripted Move\ncannot cross a seam. Next.').length, 1);
});

// Every sentence of every string literal of a source file that claims a scripted Move cannot cross.
export function stringClaims(file, text) {
  return offenders(scanSource(text).strings.join(' ')).map((s) => `${file}: ${s.slice(0, 120)}`);
}

test('T3 no current-state doc, and no string literal under renderer/ or shared/, says a scripted Move cannot cross', () => {
  const found = [];
  for (const f of SCOPE) for (const s of offenders(read(f))) found.push(`${f}: ${s.slice(0, 120)}`);
  const sources = tracked.filter((f) => /^(renderer|shared)\/.*\.js$/.test(f));
  assert.ok(sources.length > 20, 'the source scan found its files');
  assert.ok(sources.some((f) => f.startsWith('renderer/emulator/core/')), 'the vendored emulator core is scanned too');
  for (const f of sources) found.push(...stringClaims(f, read(f)));
  assert.deepEqual(found, []);
});

test('T3 negative cases: a revived claim in a scoped source file is found, wherever the file is', () => {
  const revived = 'const warn = "A scripted Move cannot cross a seam.";\n';
  for (const f of ['renderer/emulator/core/tile.js', 'renderer/forges/map/map.js', 'shared/project.js']) {
    assert.equal(stringClaims(f, read(f) + '\n' + revived).length, 1, f);
  }
  assert.equal(stringClaims('shared/x.js', 'const s = "The old warning that a scripted Move cannot cross a seam was deleted.";').length, 0);
  assert.equal(stringClaims('shared/x.js', '// A scripted Move cannot cross a seam.\nconst s = 1;').length, 0, 'a comment is not a string literal');
});

// ------------------------------------------------------------------------------------------------------------- T4

function streamedTileProject(tilesDrawn) {
  const p = createProject('Bound');
  p.maps = [];
  const map = createMap(0, 'M');
  map.gridW = 1;
  map.gridH = 1;
  map.screens = [createScreen()];
  map.streamed = true;
  p.maps.push(map);
  const tiles = Array.from({ length: tilesDrawn }, (_, i) => ({ x: (i % 2) * 8, y: (i >> 1) * 8, tile: 1, attr: 0, flipH: false, flipV: false }));
  p.sprites.metasprites = [{ id: 0, name: 'm0', tiles }];
  p.sprites.animations = [{ id: 0, name: 'a0', frames: [{ metaspriteId: 0, duration: 4 }], loop: true }];
  p.sprites.actors = [{ id: 0, name: 'actor0', anims: { idle: 0 } }];
  map.screens[0].entities = [{ actorId: 0, x: 2, y: 2, props: {} }];
  return p;
}
const streamedMap = (p) => p.maps.find((m) => m.streamed);
const msgs = (p, severity) => validateProject(p).filter((x) => !severity || x.severity === severity).map((x) => x.message);

// id, how to make it fire on a minimal project, and the docs that describe it: [file, pattern]. Every one has a current-state doc
// sentence; the design records that describe them (docs/design-streamed-worlds*.md) are not current-state docs. Existing tests that also pin each one are named.
const STREAMED_WARNINGS = [
  { id: 'board cannot stream (kind capability, error)', pinned: 'streamed.test.js "gating", streamedcapacity.test.js',
    fires: () => streamedBoardProblems(createStreamedProject({ mapper: 0, mirroring: 'horizontal' })).some((p) => p.kind === 'capability' && /cannot stream a world/.test(p.message)),
    docs: [['README.md', /UNROM 512 with four-screen mirroring/]] },
  { id: 'board only reaches the two-nametable ring (kind capability, error)', pinned: 'streamed.test.js "Part D item 1"',
    fires: () => validateProject(createStreamedProject({ mapper: 1, mirroring: 'horizontal' })).some((p) => p.severity === 'error' && /two-nametable ring -- not implemented yet/.test(p.message)),
    docs: [['README.md', /MMC1, MMC3 and UNROM 512 with horizontal or vertical mirroring are refused/]] },
  { id: 'dead axis (kind deadAxis, error)', pinned: 'streamed.test.js "two-nametable: the dead axis"',
    fires: () => streamedBoardProblems(createStreamedProject({ mapper: 1, mirroring: 'horizontal', gridW: 6, gridH: 1 })).some((p) => p.kind === 'deadAxis'),
    docs: [['docs/reference-engine.md', /\*Dead axis\* \(`'deadAxis'`/]] },
  { id: 'grid outside 1..255 per side or more than 255 screens (kind grid, error)', pinned: 'streamed.test.js "grid ceiling"',
    fires: () => { const p = createStreamedProject({}); Object.assign(streamedMap(p), { gridW: 16, gridH: 16 }); return streamedGridProblems(p).length > 0; },
    docs: [['README.md', /up to 255 screens in the whole project and 255 along a side/], ['docs/reference-engine.md', /`LIMITS.streamedGrid` \(255\)/]] },
  { id: 'authored screens exceed gridW * gridH (kind grid, error)', pinned: 'streamed.test.js "an illegal streamed grid is refused, never trimmed"',
    fires: () => { const p = createStreamedProject({}); const m = streamedMap(p); m.screens = [...m.screens, structuredClone(m.screens[0])]; return streamedGridProblems(p).some((x) => new RegExp(`holds ${m.screens.length} screens but is only ${m.gridW} x ${m.gridH}`).test(x.message)); },
    docs: [['docs/reference-engine.md', /holds N screens but is only W x H/]] },
  { id: 'project screen total over LIMITS.projectScreens (error)', pinned: 'streamedwarning.test.js T11 case 2',
    fires: () => {
      const p = createStreamedProject({ mixed: true });
      p.maps[0].screens = Array.from({ length: LIMITS.projectScreens + 1 }, () => structuredClone(p.maps[0].screens[0]));
      return msgs(p, 'error').some((m) => /^The project holds \d+ screens; with a streamed map the limit is/.test(m));
    },
    docs: [['README.md', /up to 255 screens in the whole project/]] },
  { id: 'switch-bound tiles on a streamed screen (error)', pinned: 'streamedwarning.test.js T11 case 3',
    fires: () => { const p = createStreamedProject({}); streamedMap(p).screens[0].boundTiles = [{ switchId: 0, row: 0, col: 0, metatileId: 1 }]; return msgs(p, 'error').some((m) => /switch-bound tiles, which a streamed screen cannot use yet/.test(m)); },
    docs: [['README.md', /switch-bound tiles on a streamed screen are refused/]] },
  { id: 'camera off (error)', pinned: 'streamedwarning.test.js T11 case 4',
    fires: () => msgs(createStreamedProject({ camera: false }), 'error').some((m) => /camera off, and a streamed map needs it on/.test(m)),
    docs: [['README.md', /and the camera on/]] },
  { id: 'sprite-tile bound exceeded (warning)', pinned: 'streamtilewarning.test.js "bound: exactly B tiles is silent, B+1 warns"',
    fires: () => msgs(streamedTileProject(STREAM_TILE_BOUND + 1), 'warning').some((m) => /streamed screens are supported up to 15\./.test(m)) && !msgs(streamedTileProject(STREAM_TILE_BOUND), 'warning').some((m) => /streamed screens are supported/.test(m)),
    docs: [['README.md', /at most 15 sprite tiles at once/], ['docs/reference-engine.md', /`STREAM_TILE_BOUND` = 15/], ['docs/reference-engine.md', /`STREAM_TILE_BOUND_WITH_BOUND_TILES` = 14/]] },
  { id: 'half-speed note beside a mover\'s Speed field', pinned: 'streamtilewarning.test.js "moverSpeedNote"',
    fires: () => moverSpeedNote(streamedTileProject(1), { behavior: 'patroller' }) === 'Movers run at half speed in projects with a streamed map',
    docs: [['docs/reference-engine.md', /`moverSpeedNote`/], ['README.md', /patrollers and chasers step at half their authored rate/]] },
  { id: 'Map Forge resize refused for a streamed map (refusal, returns null)', pinned: 'streamed.test.js "growOrShrinkMap refuses"',
    fires: () => { const n = normalizeProject(createStreamedProject({})); const before = structuredClone(n); const index = n.maps.findIndex((m) => m.streamed); return growOrShrinkMap(n, index, 256, 1) === null && JSON.stringify(n) === JSON.stringify(before); },
    docs: [['docs/reference-electron-layout.md', /`growOrShrinkMap` refuses a streamed map's resize/]] },
  { id: 'Build panel mapper switch preflight (refusals)', pinned: 'streamedcapacity.test.js checkStreamedMapperSwitch cases',
    fires: () => checkStreamedMapperSwitch(createStreamedProject({}), 0, 'horizontal').length > 0,
    docs: [['docs/reference-engine.md', /\*Mapper-switch preflight\* \(Build panel\): `checkStreamedMapperSwitch`/]] }
];

test('T4 every streamed-map warning and refusal still fires on a minimal project', () => {
  assert.equal(STREAMED_WARNINGS.length, 12);
  for (const w of STREAMED_WARNINGS) assert.equal(w.fires(), true, `${w.id} no longer fires`);
  // and the one deleted by S3b does not: a Move on a streamed map raises nothing (streamedwarning.test.js is the full pin)
  const move = createStreamedProject({ moveCommands: [{ op: 'move', who: 'player', dir: 'right', dist: 100 }] });
  assert.deepEqual(msgs(move).filter((m) => /moves the player|cannot cross to a new screen/.test(m)), []);
});

test('T4 every warning and refusal is still named by a current-state doc', () => {
  const missing = [];
  for (const w of STREAMED_WARNINGS) assert.ok(w.docs.length > 0, `${w.id} has no documentation assertion`);
  for (const w of STREAMED_WARNINGS) for (const [file, pattern] of w.docs) if (!pattern.test(read(file).replace(/\s+/g, ' '))) missing.push(`${w.id}: ${file} ${pattern}`);
  assert.deepEqual(missing, []);
});

// ---------------------------------------------------------------------------------------------- README streamed row

test('README streamed-worlds row: its figures are the ones the code carries', () => {
  const row = read('README.md').split('\n').find((l) => l.startsWith('| **Streamed worlds**'));
  assert.ok(row, 'the README has a streamed-worlds row');
  const flat = row.replace(/\s+/g, ' ');
  const asm = read('engine/streamworld.asm');
  const sub = (name) => Number(asm.match(new RegExp(`^${name}\\s*=\\s*(\\d+)`, 'm'))[1]);
  const pxPerFrame = (n) => 1 + n / 256; // WHOLE_STEP 1 plus the sub-pixel overflow, n/256 on average
  assert.equal(pxPerFrame(sub('SW_SPEED_SUB_X')), 1.5);
  assert.equal(pxPerFrame(sub('SW_SPEED_SUB_Y')).toFixed(2), '1.44');
  assert.match(flat, /about 1\.5 px\/frame sideways and 1\.44 up and down/);
  assert.match(flat, new RegExp(`at most ${STREAM_TILE_BOUND} sprite tiles at once \\(${STREAM_TILE_BOUND_WITH_BOUND_TILES} when the project uses switch-bound tiles\\)`));
  assert.match(flat, new RegExp(`up to ${LIMITS.projectScreens} screens in the whole project and ${LIMITS.streamedGrid} along a side`));
  assert.match(flat, /dash is ignored/);
  assert.match(flat, /vanish at the seam/);
});

test('docs.test.js and this file agree on the doc set: CLAUDE.md pointers are tracked', () => {
  // the gate itself lives in docs.test.js; this only pins that git sees the files this test scans
  const out = execFileSync('git', ['ls-files', 'README.md', 'CLAUDE.md'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(out.sort(), ['CLAUDE.md', 'README.md']);
});

// T-close (the Say/Move overrun fix): the vram_buf worst case is a derived number, the close exemption is gone from every current-state doc.
test('T-close: the current-state docs give the worst-case vram_buf frame as 88 (10+35+4+38+1), never the old 81, and no current-state doc keeps the before.* exemption', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const claude = read('CLAUDE.md');
  const engine = read('docs/reference-engine.md');
  assert.match(claude, /worst case 88 of 256 bytes/);
  assert.doesNotMatch(claude, /worst case 81 of 256/);
  assert.match(engine, /now 88 of `vram_buf`'s 256 bytes/);
  assert.match(engine, /10 \+ 35 \+ 4 \+ 38 \+ 1 = 88/);
  assert.doesNotMatch(engine, /now 81 of `vram_buf`/);
  // current-state docs (reference-*, CLAUDE.md, README) never describe a before.* carve-out; the design records may, with their dated supersession
  for (const f of ['CLAUDE.md', 'README.md', ...fs.readdirSync(path.join(ROOT, 'docs')).filter((n) => n.startsWith('reference-')).map((n) => `docs/${n}`)]) {
    assert.doesNotMatch(read(f), /`before\.\*`/, `${f} still names the before.* close exemption`);
  }
  // the design record keeps its history, but the exemption is dated as superseded where it is stated
  const design = read('docs/design-streamed-worlds-phase3a.md');
  assert.doesNotMatch(design, /are the only exempt ones/);
  assert.doesNotMatch(design, /are diagnostic\. A new-engine refusal/);
  assert.doesNotMatch(design, /unchanged and exempt:\*\* the/);
  assert.match(design, /Superseded 2026-10-04 by the Say\/Move overrun fix/);
});
