// Reconstructing an ancestor commit's engine/streamworld.asm text is not enough once a later,
// still-uncommitted change (fix round 1b's B1: relocating several routines from kernel-lo files
// into this one, in kernel-hi) sits on top of HEAD -- a flat `git show <rev>:engine/streamworld.asm`
// reconstructs a file that predates B1 entirely, and the *other* engine files (left at their
// current, post-B1 content by every test that uses this helper, since none of them touch anything
// B1 also touched -- confirmed by diffing entities.asm/oam.asm/screens.asm/boot.asm between every
// anchor commit this file's callers use and HEAD, all zero) then reference symbols (spawn_streamed,
// build_oam_draw_sw, draw_one_entity_show_sw, sw_redraw_screen_landing) that do not exist in that
// reverted file, which nesasm reports as "Undefined symbol in operand field."
//
// B1's own routines are a single, self-contained, unconditional block appended to the END of
// current streamworld.asm, textually after every prior slice's own content (the block starts at
// the marker comment below and runs to EOF; nothing inside it is referenced from, or itself
// references, anything else in the file) -- so restoreB1Routines reconstructs "ancestor commit +
// B1" simply by taking the ancestor's own text and appending current's B1 block onto it, rather
// than attempting a 3-way merge: a merge conflates cleanly for a nearby ancestor (0ea504b, 8b4d5a9)
// but produces one giant unresolvable conflict spanning almost the whole file for a distant one
// (506a8ea, three slices back) since so much unrelated content was added in between with no stable
// anchor for diff3 to split on. A plain textual append has no such failure mode at any distance.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { streamProjBounds } from '../../shared/streamlayout.js';

const B1_MARKER = '; B1 (phase 2 slice 9 fix round 1b, ROADMAP item 15): kernel-lo -> kernel-hi';

export function restoreB1Routines(currentText) {
  const markerLine = currentText.split('\n').findIndex((line) => line.includes(B1_MARKER));
  if (markerLine < 0) throw new Error(`B1 marker not found in current engine/streamworld.asm: "${B1_MARKER}"`);
  const lines = currentText.split('\n');
  // the marker comment's own "====" divider sits one line above it.
  return lines.slice(markerLine - 1).join('\n');
}

// fix round 1c, item 2 (and round 2, finding A4): restoreB1Routines identifies the block purely as
// "marker to EOF" -- correct today (B1 really is the last thing in the file), but silently WRONG
// the moment any later slice appends more content after it without updating this helper: the
// extra content would be folded into "B1" and every test built on mergeReconstructEngineFile
// (every A4 streamed-shape identity test, the placement-only check) would silently start
// comparing against a polluted baseline instead of failing. The block's own header comment (above)
// already asserts it is self-contained -- this validates that claim mechanically rather than
// trusting the comment to stay true.
//
// Three checks:
// 1. The block's own top-level (column-0) labels must be EXACTLY this fixed list, in this order --
//    any label added, removed or reordered means the marker-to-EOF slice no longer bounds only B1's
//    own four routines and their trailing data tables, and mergeReconstructEngineFile's whole
//    reconstruction is no longer trustworthy.
// 2. Nothing (labelled or not) follows the block's own final label
//    (sw_redraw_screen_landing_end) except blank lines and comments -- round 2's own finding A4:
//    an appended, unlabelled `.db $ea` left the label list untouched and so slipped past check 1
//    alone. A trailing comment costs no assembled bytes and is not itself an identity change, so
//    it is the only thing besides whitespace this allows past the final label.
// 3. Every non-local symbol the block's own instructions reference (jsr/jmp targets, absolute-mode
//    operands, and the same names reached through a `<` zero-page prefix, a `#` immediate prefix or
//    a `[ptr],y`/`[ptr,x]` indirect bracket -- round 2's own finding A4: the prior version's operand
//    regex required the operand to start with a letter, so `sta <does_not_exist` slipped past with
//    no check at all -- and every branch operand too, no longer exempted by mnemonic: a branch
//    retargeted to an undefined name is exactly as real a corruption as a jsr/jmp retargeted to
//    one) must be defined SOMEWHERE across every engine/*.asm file AS OF THE GIVEN rev (round 2's
//    own finding A4: checking against the CURRENT tree instead of the ancestor's own tree let a
//    reference to a symbol that exists now but did not exist at the ancestor -- sw_dlg20_pending_
//    tick, absent at 2563ef4 -- validate cleanly, which is exactly the false "ancestor + B1 predates
//    this symbol too" claim mergeReconstructEngineFile exists to prevent). When rev is omitted the
//    current filesystem is scanned instead, preserving every direct caller that validates the real
//    block against today's tree (undefined-anywhere checks do not depend on which commit is asked,
//    since a name absent from both the ancestor and today is absent from either lookup). nesasm
//    v3.1 reports "Undefined symbol in operand field" for a genuinely dangling reference but still
//    exits 0 -- CLAUDE.md's own warning about that dialect -- so a build succeeding is not proof
//    this never happens. A name already defined inside the B1 block itself (a local label, or one
//    of its own three data tables) needs no cross-file lookup.
const EXPECTED_B1_LABELS = [
  'spawn_streamed', 'spawn_streamed_any', 'spawn_streamed_loop', 'spawn_streamed_place',
  'spawn_streamed_armed', 'spawn_streamed_next', 'spawn_streamed_done', 'spawn_streamed_end',
  'build_oam_draw_sw', 'build_oam_draw_sw_loop', 'build_oam_draw_sw_park', 'build_oam_draw_sw_next',
  'sw_oam_corner_xoff', 'sw_oam_corner_yoff', 'sw_oam_corner_oam', 'build_oam_draw_sw_end',
  // Phase 3a slice S1 (`.if STREAM_PROJ_ENABLED`): sw_ent_setup and the per-actor projection sit
  // inside this block, ahead of B1's own per-tile routine (the `.else` branch, whose labels follow).
  // Both definitions of draw_one_entity_show_sw are real -- exactly one assembles in a given build.
  'sw_ent_setup', 'sw_ent_setup_done',
  'draw_one_entity_show_sw', 'dsw_have_anim', 'dsw_have_count', 'dsw_in_tile', 'dsw_done',
  'dsw_cull', 'dsw_cull_tile', 'dsw_straddle', 'dsw_st_tile', 'dsw_st_park', 'dsw_st_next',
  'draw_one_entity_show_sw', 'draw_one_entity_sw_have_anim', 'draw_one_entity_sw_have_count',
  'draw_one_entity_sw_tile', 'draw_one_entity_sw_tile_park', 'draw_one_entity_sw_tile_next',
  'draw_one_entity_sw_done', 'draw_one_entity_show_sw_end',
  'sw_redraw_screen_landing', 'sw_redraw_screen_landing_end',
];

// Single-letter register names (`asl a`, `ldx <ptr,y`, `sta [zp],x`) are never symbols worth
// checking -- filtered by length rather than by an explicit `a`/`x`/`y` set, since every real
// symbol in this codebase is multiple characters. A `$FF`/`$2006`-style hex literal's digits
// would otherwise match this same identifier shape (`FF`, or `2006` if it started with a letter
// -- it never does, but `$ABCD` would) -- the leading lookbehind excludes any match whose
// immediately preceding character is `$`, so the literal's own `$` is left for the surrounding
// asm-syntax context (not an identifier at all) and its digits are never mistaken for a name.
const IDENTIFIER_RE = /(?<!\$)[A-Za-z_][A-Za-z0-9_]*/g;

function definedSymbolsInText(text, names) {
  for (const m of text.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\s*[:=]/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\s+\.equ\b/gm)) names.add(m[1]);
}

// player_tiles/player_pal/actor_hp/ms_count/ms_ptr_lo/ms_ptr_hi/anim_ptr_lo/anim_ptr_hi and
// similar per-project data tables (and .inc-emitted constants such as STREAM_OFF_ENTITY_COUNT,
// generate.js's own single-writer struct offsets) are never in engine/*.asm at all -- generate.js
// emits them as `NAME = value` or `NAME: value` lines straight into build/assets/*.inc from the
// project's own JSON or its own struct-offset tables, fresh for every build regardless of which
// ancestor's engine sources are assembled against them, so they can never be "ancestor-undefined"
// in the sense this check cares about. Scanning generate.js's own template-literal strings for
// this label shape catches these without needing a real build.
function generatedTableNamesInText(text, names) {
  for (const m of text.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)\s*[:=]/g)) names.add(m[1]);
  // Phase 3a slice S1: SW_UXMIN..SW_UYMAX are emitted from a computed template
  // (`SW_U${k.slice(1)} = ...`, one per streamProjBounds key), which the literal-name scan above
  // cannot see. Derived from the same function generate.js maps over, never a second list.
  for (const k of Object.keys(streamProjBounds({ maps: [], sprites: { actors: [], metasprites: [] } }))) names.add(`SW_U${k.slice(1)}`);
}

function definedSymbolsAcrossEngine(root) {
  const engineDir = path.join(root, 'engine');
  const names = new Set();
  for (const file of fs.readdirSync(engineDir)) {
    if (!file.endsWith('.asm')) continue;
    definedSymbolsInText(fs.readFileSync(path.join(engineDir, file), 'utf8'), names);
  }
  generatedTableNamesInText(fs.readFileSync(path.join(root, 'main', 'build', 'generate.js'), 'utf8'), names);
  return names;
}

// The ancestor-tree twin of definedSymbolsAcrossEngine above: every engine/*.asm file AS IT STOOD
// at `rev` (via `git ls-tree`, not today's directory listing -- a file could have been added or
// renamed since), plus generate.js's own template-emitted names, also read at `rev` when it
// existed there (falling back to the current copy only for a rev old enough to predate
// generate.js's own generated-table convention entirely, which none of this file's real callers
// are).
function definedSymbolsAcrossEngineAtRev(root, rev) {
  const names = new Set();
  const listing = execFileSync('git', ['ls-tree', '-r', '--name-only', rev, '--', 'engine'], {
    cwd: root,
    encoding: 'utf8'
  });
  const files = listing.split('\n').filter((f) => f.endsWith('.asm'));
  for (const file of files) {
    const text = execFileSync('git', ['show', `${rev}:${file}`], { cwd: root, encoding: 'utf8' });
    definedSymbolsInText(text, names);
  }
  let generateJsText;
  try {
    generateJsText = execFileSync('git', ['show', `${rev}:main/build/generate.js`], { cwd: root, encoding: 'utf8' });
  } catch {
    generateJsText = fs.readFileSync(path.join(root, 'main', 'build', 'generate.js'), 'utf8');
  }
  generatedTableNamesInText(generateJsText, names);
  return names;
}

// Every symbol reference the block's own indented instruction lines make -- NOT label-definition
// lines (column 0, no leading whitespace, the nesasm convention CLAUDE.md documents for `.if`
// applies identically to labels vs instructions here) and NOT `.db`/`.dw` data directives (their
// first non-whitespace character is `.`, never a letter, so they never match the mnemonic prefix
// below; the block's own three trailing OAM tables are exactly this case and correctly contribute
// no operand references at all -- they are raw byte values, not instructions). A trailing comment
// is stripped before scanning, so a name only mentioned in a comment is never flagged.
function referencedSymbols(b1Block) {
  const referenced = new Set();
  for (const rawLine of b1Block.split('\n')) {
    const line = rawLine.split(';')[0];
    const m = /^[ \t]+[A-Za-z]{2,5}\b(.*)$/.exec(line);
    if (!m) continue;
    // Strip whole hex literals ($EA, #$FF, ...) BEFORE scanning for identifiers -- IDENTIFIER_RE's
    // own `(?<!\$)` guard only excludes a match starting immediately after the `$`, so a literal
    // whose second hex digit is itself a letter (`$FF`'s second `F`, preceded by the first `F`, not
    // by `$`) still starts a fresh one-character match there. Round 3's own finding A-deferrable 2
    // caught this the hard way: restricting the old length-1 exemption to real register names alone
    // (below) turned every such spurious digit-match into a false "undefined symbol", including in
    // the real, current B1 block itself (`#$FF`-style immediates it genuinely contains).
    const rest = m[1].replace(/\$[0-9A-Fa-f]+/g, '');
    for (const idMatch of rest.matchAll(IDENTIFIER_RE)) {
      // Exempt only the three real register names (case-insensitive), in operand position --
      // never every one-letter identifier: round 3's own finding A-deferrable 2 (E3/audit.log's
      // "one-letter undefined: ACCEPTED") showed the prior length-1 exemption let `sta <q` slip
      // past with q genuinely undefined.
      if (/^[axy]$/i.test(idMatch[0])) continue;
      referenced.add(idMatch[0]);
    }
  }
  return referenced;
}

// Phase 3a slice S1's projection branch (inside the B1 block, see EXPECTED_B1_LABELS) reads the
// zero-page scratch bytes S1 added to engine/constants.asm. The A4 identity tests leave
// constants.asm at its CURRENT text on both sides (only streamworld.asm is reconstructed), so
// those names exist in every build being compared even though they did not exist at the ancestor.
// This is the one exemption to the "defined at the ancestor" rule, and it is scoped: a name is
// exempt only if it is in this fixed list AND is defined in today's constants.asm (a name that has
// left constants.asm stops being exempt and fails again).
const S1_ZERO_PAGE_NAMES = ['sw_cx0_lo', 'sw_cx0_hi', 'sw_cy0_lo', 'sw_cy0_hi', 'sw_dxb_lo', 'sw_dxb_hi', 'sw_dyb_lo'];
export function s1ZeroPageNames(root) {
  const constants = fs.readFileSync(path.join(root, 'engine', 'constants.asm'), 'utf8');
  const names = new Set();
  definedSymbolsInText(constants, names);
  return new Set(S1_ZERO_PAGE_NAMES.filter((n) => names.has(n)));
}

export function validateB1Block(b1Block, root, rev) {
  const labels = [...b1Block.matchAll(/^([A-Za-z_][A-Za-z0-9_]*):/gm)].map((m) => m[1]);
  if (labels.join(',') !== EXPECTED_B1_LABELS.join(',')) {
    throw new Error(
      `B1 block's own top-level labels no longer match the fixed expected list -- restoreB1Routines` +
      ` no longer bounds only B1's own content (a later slice may have appended code after it).\n` +
      `  expected: ${EXPECTED_B1_LABELS.join(', ')}\n` +
      `  found:    ${labels.join(', ')}`
    );
  }

  // Check 2: nothing after the block's own final label except blank lines and comments. The
  // match stops at the label's own colon, not the rest of the line (`.*$` would have swallowed
  // same-line trailing content such as `sw_redraw_screen_landing_end: .db $ea` as part of the
  // match itself, leaving `tail` starting on the NEXT line and never seeing it -- round 3's own
  // finding A-deferrable 2, E3/audit.log's "same-line trailing byte: ACCEPTED").
  const finalLabel = EXPECTED_B1_LABELS[EXPECTED_B1_LABELS.length - 1];
  const finalLabelRe = new RegExp(`^${finalLabel}:`, 'm');
  const finalMatch = finalLabelRe.exec(b1Block);
  if (!finalMatch) {
    throw new Error(`B1 block's own final label (${finalLabel}) not found even though the label list matched -- internal inconsistency`);
  }
  const tail = b1Block.slice(finalMatch.index + finalMatch[0].length);
  for (const rawLine of tail.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith(';')) continue;
    throw new Error(
      `content found after the B1 block's own final label (${finalLabel}): "${line}" -- restoreB1Routines` +
      ` no longer bounds only B1's own content (a byte was appended, labelled or not).`
    );
  }

  const localNames = new Set(labels);
  const engineNames = rev ? definedSymbolsAcrossEngineAtRev(root, rev) : definedSymbolsAcrossEngine(root);
  const referenced = referencedSymbols(b1Block);
  const s1Names = rev ? s1ZeroPageNames(root) : new Set();
  const undefined_ = [...referenced].filter((name) => !localNames.has(name) && !engineNames.has(name) && !s1Names.has(name));
  if (undefined_.length > 0) {
    throw new Error(
      `B1 block references symbol(s) not defined anywhere in engine/*.asm${rev ? ` at ${rev}` : ''} or within the block` +
      ` itself -- these would be nesasm "Undefined symbol in operand field" errors (which nesasm v3.1` +
      ` reports but still exits 0, so a build alone would not catch this): ${undefined_.join(', ')}`
    );
  }
}

export function mergeReconstructEngineFile(root, rev, name, { headRev = 'HEAD' } = {}) {
  if (name !== 'streamworld.asm') {
    throw new Error('mergeReconstructEngineFile only knows how to restore B1 into streamworld.asm');
  }
  void headRev;
  const currentText = fs.readFileSync(path.join(root, 'engine', name), 'utf8');
  const historicalText = execFileSync('git', ['show', `${rev}:engine/${name}`], { cwd: root, encoding: 'utf8' });
  const b1Block = restoreB1Routines(currentText);
  validateB1Block(b1Block, root, rev);
  return `${historicalText.replace(/\n+$/, '')}\n\n${b1Block}`;
}

// Phase 3a slice S1 added a contiguous block of equates to engine/constants.asm (the projection's
// zero-page scratch and `oam_busy`), and engine/boot.asm / entities.asm now read them
// unconditionally under generated `.if` flags. A historical-baseline test that reverts
// constants.asm to an older commit (while leaving boot.asm and the rest at CURRENT) must carry
// those equates too, or the baseline fails to assemble on a symbol that has nothing to do with
// what it is checking. The block is lifted verbatim from today's constants.asm, from its
// "Phase 3a slice S1" comment through the `oam_busy` equate, so it can never drift from the real
// definitions; if either anchor moves the helper throws instead of guessing.
export function appendS1Constants(root, historicalText) {
  const lines = fs.readFileSync(path.join(root, 'engine', 'constants.asm'), 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith('; Phase 3a slice S1: the streamed entity projection'));
  const end = lines.findIndex((l) => /^oam_busy\s*=/.test(l));
  if (start < 0 || end < start) throw new Error("S1's constants block anchors not found in engine/constants.asm");
  return `${historicalText.replace(/\n*$/, '\n')}${lines.slice(start, end + 1).join('\n')}\n`;
}

// Phase 3a slice S1's additions to engine/streamworld.asm, as three anchored regions: the Flash
// publication guard in sw_win_arm_row (`sw_win_arm_flash_guard:` .. `sw_win_arm_flash_guard_end:`,
// both inclusive) and the per-actor projection wrapper (`.if STREAM_PROJ_ENABLED` .. its `.else`, and
// the `.endif` closing the pair just before `draw_one_entity_show_sw_end:`). Removing them gives
// the file as it stood before S1, so a test that asserts "this file equals commit X" can keep
// asserting it about everything S1 did not touch. Each anchor must be found; a changed shape throws
// rather than stripping the wrong lines.
export function stripS1FromStreamworld(text) {
  const lines = text.split('\n');
  const find = (re, from = 0) => { for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i; return -1; };
  const gStart = find(/^sw_win_arm_flash_guard:/);
  const gEnd = find(/^sw_win_arm_flash_guard_end:/, Math.max(gStart, 0));
  const ifAt = find(/^\s*\.if STREAM_PROJ_ENABLED\s*$/);
  const elseAt = find(/^\s*\.else\s*$/, Math.max(ifAt, 0));
  const endLabel = find(/^draw_one_entity_show_sw_end:/);
  if (gStart < 0 || gEnd < gStart || ifAt < 0 || elseAt < ifAt || endLabel < elseAt) throw new Error("S1's streamworld.asm anchors not found");
  let endifAt = endLabel - 1;
  while (endifAt > elseAt && !/^\s*\.endif\s*$/.test(lines[endifAt])) endifAt--;
  if (endifAt <= elseAt) throw new Error("S1's projection wrapper has no closing .endif");
  return lines.filter((_, i) => !((i >= gStart && i <= gEnd) || (i >= ifAt && i <= elseAt) || i === endifAt)).join('\n');
}
