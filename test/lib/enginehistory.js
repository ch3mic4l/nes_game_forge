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
  // the marker comment's own "====" divider sits one line above it. Phase 3a S3b appended its own block after B1's final
  // label; it is bounded by its own marker and its own pinned label list (S3B_MARKER, EXPECTED_S3B_LABELS, validateS3bBlock),
  // and is cut off here so it is never folded into "B1": the ancestor-plus-B1 reconstruction must not carry S3b's routines.
  const s3bLine = lines.findIndex((line) => line.includes(S3B_MARKER));
  return lines.slice(markerLine - 1, s3bLine < 0 ? lines.length : s3bLine - 1).join('\n');
}

// Phase 3a slice S3b's talker block: everything from its own marker comment (and the "====" divider above it) to the end of
// the file, wrapped in one `.if TALKER_ENABLED`. Pinned the way B1's block is: an exact label list in order, and nothing
// after the last instruction but the closing `.endif`. A later slice appending more has to say so here.
const S3B_MARKER = "; Phase 3a S3b: the event's talker across a seam.";
export const EXPECTED_S3B_LABELS = [
  'sw_talker_capture', 'sw_talker_rebind', 'sw_tr_loop', 'sw_tr_next', 'sw_tr_gone', 'sw_tr_found',
  'sw_talker_cross', 'sw_tx_store', 'sw_tx_done',
  'sw_battle_resume', 'sw_br_rearm', 'sw_or_loop', 'sw_or_next', 'sw_or_found', 'sw_or_clear', 'sw_br_done',
  'sw_rr_move', 'sw_rr_turn', 'sw_rr_visible', 'sw_rr_fin',
  'sw_talker_reset', 'sw_talker_end'
];

export function restoreS3bBlock(currentText) {
  const lines = currentText.split('\n');
  const at = lines.findIndex((line) => line.includes(S3B_MARKER));
  if (at < 0) throw new Error(`S3b marker not found in current engine/streamworld.asm: "${S3B_MARKER}"`);
  return lines.slice(at - 1).join('\n');
}

export function validateS3bBlock(block) {
  const labels = [...block.matchAll(/^([A-Za-z_][A-Za-z0-9_]*):/gm)].map((m) => m[1]);
  if (labels.join(',') !== EXPECTED_S3B_LABELS.join(',')) {
    throw new Error(
      `S3b block's own top-level labels no longer match the fixed expected list -- a later slice may have appended code after it.\n` +
      `  expected: ${EXPECTED_S3B_LABELS.join(', ')}\n  found:    ${labels.join(', ')}`
    );
  }
  const code = block.split('\n').map((l) => l.replace(/;.*/, '').trimEnd()).filter((l) => l.trim() !== '');
  if (code[0].trim() !== '.if TALKER_ENABLED' || code[code.length - 1].trim() !== '.endif') {
    throw new Error("S3b's block must open with `.if TALKER_ENABLED` and close with its `.endif`, with nothing after it");
  }
  if (code.filter((l) => /^\s*\.if\b/.test(l)).length !== code.filter((l) => /^\s*\.endif\b/.test(l)).length) {
    throw new Error("S3b's block has unbalanced .if/.endif");
  }
}

// S3b changed streamworld.asm outside B1 in two ways this pin must see past, in the S1 manner: it APPENDED the talker block
// (above) and one `.if TALKER_ENABLED / jsr sw_talker_cross / .endif` at the end of each sw_pstep_<dir>. Cutting both from the
// current text gives the file as it stood before S3b (and S3a's guards, which S3b deleted, are asserted gone by
// stripS3aFromStreamworld). Each shape must occur exactly as S3b wrote it, or the helper throws rather than cut other lines.
export function stripS3bFromStreamworld(text) {
  validateS3bBlock(restoreS3bBlock(text));
  const lines = text.split('\n');
  const at = lines.findIndex((line) => line.includes(S3B_MARKER));
  const head = lines.slice(0, at - 1).join('\n').replace(/\n+$/, '') + '\n';
  const call = /^  \.if TALKER_ENABLED\n  jsr sw_talker_cross\n  \.endif\n/gm;
  const calls = head.match(call) ?? [];
  if (calls.length !== 4) throw new Error(`S3b's four sw_talker_cross calls not found (${calls.length})`);
  return head.replace(call, '');
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
  const merged = `${historicalText.replace(/\n+$/, '')}\n\n${b1Block}`;
  const currentDialog = fs.readFileSync(path.join(root, 'engine', 'streamdialog.asm'), 'utf8');
  return carryOverrunLever(carryS3a5Lever(merged, currentText), currentText, currentDialog);
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

// Phase 3a S3a changed streamworld.asm in two ways this pin must see past, in the S1 manner. It ADDED the
// four sw_step_nocross guards (one per sw_pstep_<dir>, each wrapped in `.if MOVE_ENABLED`) and DELETED the scripted
// Move's probe pair (sw_move_probe_solid .. sw_move_probe_same), which dropS3aRetiredFromOld removes from an older text.
// Phase 3a S3b deleted the guards again (a Move crosses like a walking step), so the current text carries none:
// stripS3aFromStreamworld now asserts exactly that -- no guard, no `_refuse` label, no sw_step_nocross -- and throws if one
// has come back, so a resurrected ownership stop cannot hide behind a pin that used to expect it.
export function stripS3aFromStreamworld(text) {
  const left = text.match(/sw_step_nocross|^sw_p[lrdu]_refuse:/gm) ?? [];
  if (left.length !== 0) throw new Error(`S3a's sw_step_nocross guards were retired by S3b but ${left.length} reference(s) are back: ${left.join(', ')}`);
  return text;
}

export function dropS3aRetiredFromOld(text) {
  const a = text.indexOf('; sw_move_probe_solid -- a scripted Move');
  const endMark = 'sw_move_probe_same:\n  jmp probe_solid\n  .endif\n';
  const b = text.indexOf(endMark);
  if (a < 0 || b < a) throw new Error('the retired sw_move_probe pair was not found in the older text');
  const start = text.lastIndexOf('\n; ====', a) + 1;
  return text.slice(0, start) + text.slice(b + endMark.length);
}

// Phase 3a S3a.5 rewrote the Y half of sw_camera_window_recompute: two repeated-subtract loops (camPy/240 and
// the desired row's divmod 15) became closed forms off player_y. A pin of "this file equals commit X in every
// code line" must see past exactly those two regions and nothing else -- the behaviour of the new code is owned
// by test/unit/streamworldcamera.test.js (an independent statement of the camera rule over a reduced grid, and
// an exhaustive one-off). stripS3a5FromStreamworld cuts the closed forms out of the current text and
// dropS3a5RetiredFromOld cuts the loops out of an older one; each region is anchored on a start line and an
// end line that must each occur exactly once, so a changed shape throws rather than cutting the wrong lines.
// The one other difference is the trailing comment on the `sta sw_tmp` bit-0 stash, reworded because its
// "Y divmod" no longer exists; that single comment is normalized away on both sides (the instruction is not).
const S3A5_STASH = /^(  sta sw_tmp)[ \t]+; stash bit0 across the Y [^\n]*$/gm;

function cutRegion(text, start, end, what) {
  const a = text.indexOf(start);
  if (a < 0 || text.indexOf(start, a + 1) >= 0) throw new Error(`S3a.5: the start of ${what} was not found exactly once`);
  const b = text.indexOf(end, a);
  if (b < 0 || text.indexOf(end, b + 1) >= 0) throw new Error(`S3a.5: the end of ${what} was not found exactly once`);
  return text.slice(0, a) + text.slice(b + end.length);
}

function normalizeS3a5Stash(text) {
  const hits = text.match(S3A5_STASH) ?? [];
  if (hits.length !== 1) throw new Error(`S3a.5: the bit-0 stash line was not found exactly once (${hits.length})`);
  return text.replace(S3A5_STASH, '$1');
}

export function stripS3a5FromStreamworld(text) {
  let out = cutRegion(
    text,
    '  lda <player_y\n  cmp #112\n  bcs sw_fcw_yo_ge\n',
    'sw_fcw_yo_done:\n  lda sw_fc_lpy\n  sta <cam_y_lo\n',
    'the closed-form camScreenRow/camLocalPxY'
  );
  out = cutRegion(
    out,
    '  lda sw_fc_lpy\n  lsr a\n  lsr a\n  lsr a\n  lsr a\n  sec\n  sbc #7\n',
    'sw_fcw_blky_clamp:\n',
    'the closed-form desired window row'
  );
  return normalizeS3a5Stash(out);
}

export function dropS3a5RetiredFromOld(text) {
  let out = cutRegion(
    text,
    '  lda #0\n  sta sw_fc_scr\nsw_fcw_ydiv_loop:\n',
    'sw_fcw_ydiv_done:\n  lda sw_fc_py_lo\n  sta sw_fc_lpy\n  sta <cam_y_lo\n',
    'the camPy/240 repeated-subtract loop'
  );
  out = cutRegion(
    out,
    '  lda sw_fc_scr\n  sta sw_tmp\n  lda #0\n  sta sw_tmp2\n  ldx #4\nsw_fcw_blky_shift:\n',
    '  lda sw_tmp5                   ; A = screenRow\n  ldx sw_tmp3                   ; X = localRow\n',
    'the divmod-15 repeated-subtract loop'
  );
  return normalizeS3a5Stash(out);
}

// Every ROM-identity pin built on mergeReconstructEngineFile compares "the current build" with "an older engine
// plus B1". Phase 3a S3a.5 replaced two repeated-subtract loops in sw_camera_window_recompute with closed forms, in
// every streamed build, so an older text still carrying the loops can no longer assemble to the same bytes -- and
// that is not what those pins are about. carryS3a5Lever puts the CURRENT closed forms into the older text in the
// loops' own place (each region lifted from the current file, never retyped), so the comparison stays "identical in
// every byte except what the pin names"; the camera rule itself is held by test/unit/streamworldcamera.test.js.
// An older text that has no such loops throws rather than passing through unchanged.
function spliceRegion(oldText, oldStart, oldEnd, curText, curStart, curEnd, what) {
  const a = oldText.indexOf(oldStart);
  if (a < 0 || oldText.indexOf(oldStart, a + 1) >= 0) throw new Error(`S3a.5: the start of the retired ${what} was not found exactly once`);
  const b = oldText.indexOf(oldEnd, a);
  if (b < 0 || oldText.indexOf(oldEnd, b + 1) >= 0) throw new Error(`S3a.5: the end of the retired ${what} was not found exactly once`);
  const c = curText.indexOf(curStart);
  if (c < 0 || curText.indexOf(curStart, c + 1) >= 0) throw new Error(`S3a.5: the start of the current ${what} was not found exactly once`);
  const d = curText.indexOf(curEnd, c);
  if (d < 0 || curText.indexOf(curEnd, d + 1) >= 0) throw new Error(`S3a.5: the end of the current ${what} was not found exactly once`);
  return oldText.slice(0, a) + curText.slice(c, d + curEnd.length) + oldText.slice(b + oldEnd.length);
}

export function carryS3a5Lever(oldText, currentText) {
  let out = spliceRegion(
    oldText,
    '  lda #0\n  sta sw_fc_scr\nsw_fcw_ydiv_loop:\n',
    'sw_fcw_ydiv_done:\n  lda sw_fc_py_lo\n  sta sw_fc_lpy\n  sta <cam_y_lo\n',
    currentText,
    '  lda <player_y\n  cmp #112\n  bcs sw_fcw_yo_ge\n',
    'sw_fcw_yo_done:\n  lda sw_fc_lpy\n  sta <cam_y_lo\n',
    'camPy/240 loop and its closed form'
  );
  out = spliceRegion(
    out,
    '  lda sw_fc_scr\n  sta sw_tmp\n  lda #0\n  sta sw_tmp2\n  ldx #4\nsw_fcw_blky_shift:\n',
    '  lda sw_tmp5                   ; A = screenRow\n  ldx sw_tmp3                   ; X = localRow\n',
    currentText,
    '  lda sw_fc_lpy\n  lsr a\n  lsr a\n  lsr a\n  lsr a\n  sec\n  sbc #7\n',
    'sw_fcw_blky_clamp:\n',
    'divmod-15 loop and its closed form'
  );
  return out;
}

// The Say/Move overrun fix (handoff-next/streamed-worlds-say-move-overrun-impl-report.md) changed three places in
// engine/streamworld.asm, in every build with streamed text:
//   1. the chunk read `sw_dlg_read_chunk..sw_dlg_read_chunk_end`, a new resident block just before `sw_dlg_mapper_start:`;
//   2. the banked shim's `sw_dlg_terrain_read`, which now calls the chunk read instead of `sw_terrain_or_fill` (and no
//      longer pushes/pulls the result);
//   3. in the resident placement, the equate `sw_dlg_terrain_read = sw_dlg_read_chunk` just before the include.
// A historical text comparison that reverts streamworld.asm to an older commit while engine/streamdialog.asm stays
// CURRENT (it now calls sw_dlg_terrain_read) must carry (carryOverrunLever) or remove (stripOverrunFromStreamworld) those
// three places; each region is anchored and count-checked and a changed shape throws instead of cutting something else.
const OVERRUN_CHUNK_RE = /  \.if TEXT_ENABLED\n; The text-box close's bounded terrain read[^]*?sw_dlg_read_chunk_end:\n  \.endif\n/g;
const OVERRUN_SHIM_NEW = 'sw_dlg_terrain_read:\n  jsr sw_dlg_read_chunk\n  lda #BATTLE_BANK\n  jsr switch_prg_bank\n  rts\n';
const OVERRUN_SHIM_OLD = 'sw_dlg_terrain_read:\n  jsr sw_terrain_or_fill\n  pha\n  lda #BATTLE_BANK\n  jsr switch_prg_bank\n  pla\n  rts\n';
const OVERRUN_EQUATE = 'sw_dlg_terrain_read = sw_dlg_read_chunk\n';
const MAPPER_START = 'sw_dlg_mapper_start:\n';
const INCLUDE_DIALOG = '  .include "streamdialog.asm"\n';

function exactlyOnce(text, needle, what) {
  const a = text.indexOf(needle);
  if (a < 0 || text.indexOf(needle, a + 1) >= 0) throw new Error(`overrun fix: ${what} was not found exactly once`);
  return a;
}

function overrunChunkBlock(text) {
  const hits = text.match(OVERRUN_CHUNK_RE) ?? [];
  if (hits.length !== 1) throw new Error(`overrun fix: the chunk-read block was not found exactly once (${hits.length})`);
  return hits[0];
}

/**
 * The current text with the overrun fix's regions in streamworld.asm removed: what the file said before it. Works on the
 * source text (the include line follows the equate; the banked shim is present) and on readEngineSource's resident
 * flattening (the dialogue file's text follows the equate; no shim). The close routines themselves live in
 * streamdialog.asm and are cut by stripOverrunCloseFromFlat / dropOverrunRetiredFromOld.
 */
export function stripOverrunFromStreamworld(text) {
  let out = text.replace(overrunChunkBlock(text), '');
  exactlyOnce(out, OVERRUN_EQUATE, 'the resident terrain-read equate');
  out = out.replace(OVERRUN_EQUATE, '');
  if (out.includes('sw_dlg_terrain_read:\n')) {
    exactlyOnce(out, OVERRUN_SHIM_NEW, 'the banked shim\'s chunk-read terrain gateway');
    out = out.replace(OVERRUN_SHIM_NEW, OVERRUN_SHIM_OLD);
  }
  return out;
}

// The two routines the fix replaced in streamdialog.asm: the close-path terrain accessor sw_dlg_metatile (deleted) and
// sw_dlg_close_row's body (rewritten around one bounded read per screen run). A comparison against a pre-fix text cuts
// BOTH sides' version of them, anchored and count-checked, so everything else in the file stays compared; the new close
// routine is held by test/unit/streamdialogclose.test.js's independent packet oracle instead.
const OVERRUN_NEW_CLOSE_START = 'sw_dlg_close_row:\n';
const OVERRUN_NEW_CLOSE_END = 'sw_dlgcr_end:\n  jmp vram_end\n';
const OVERRUN_OLD_METATILE_START = 'sw_dlg_metatile:\n';
const OVERRUN_OLD_METATILE_END = '  jmp sw_terrain_or_fill\n';
const OVERRUN_OLD_CLOSE_END = '  cmp #16\n  bne sw_dlgcr_loop\n  jmp vram_end\n';

function cutOverrun(text, start, end, what) {
  const a = exactlyOnce(text, start, `the start of ${what}`);
  const b = text.indexOf(end, a);
  if (b < 0 || text.indexOf(end, b + 1) >= 0) throw new Error(`overrun fix: the end of ${what} was not found exactly once`);
  return text.slice(0, a) + text.slice(b + end.length);
}

export function stripOverrunCloseFromFlat(text) {
  return cutOverrun(text, OVERRUN_NEW_CLOSE_START, OVERRUN_NEW_CLOSE_END, 'the bounded-read sw_dlg_close_row');
}

export function dropOverrunRetiredFromOld(text) {
  const noMetatile = cutOverrun(text, OVERRUN_OLD_METATILE_START, OVERRUN_OLD_METATILE_END, 'sw_dlg_metatile');
  return cutOverrun(noMetatile, OVERRUN_NEW_CLOSE_START, OVERRUN_OLD_CLOSE_END, 'the per-cell sw_dlg_close_row');
}

/** An older text brought up to the overrun fix, each region lifted from the CURRENT files, never retyped.
 *   - a text from before any streamed dialogue code (no close row, no include) has nothing for the fix to change and comes
 *     back untouched;
 *   - a text with the dialogue overlay INLINE (pre-relocation: sw_dlg_metatile and the per-cell sw_dlg_close_row inside
 *     streamworld.asm) gets the accessor cut, its close row replaced by the current one (from `currentDialogText`), and the
 *     chunk read plus its equate in front of the mapper block;
 *   - a text that INCLUDES streamdialog.asm (and so keeps the current close row) gets the chunk read, the shim body and the
 *     equate. */
export function carryOverrunLever(oldText, currentText, currentDialogText = null) {
  const hasInclude = oldText.includes(INCLUDE_DIALOG);
  const hasInline = oldText.includes('\nsw_dlg_close_row:\n');
  if (!hasInclude && !hasInline) return oldText;
  if (!oldText.includes(MAPPER_START)) throw new Error('overrun fix: the older text has the dialogue overlay without the mapper block');
  const block = overrunChunkBlock(currentText);
  if (hasInline) {
    if (!currentDialogText) throw new Error('overrun fix: an inline older text needs the current streamdialog.asm');
    let out = cutOverrun(oldText, OVERRUN_OLD_METATILE_START, OVERRUN_OLD_METATILE_END, 'sw_dlg_metatile');
    const newClose = currentDialogText.slice(
      exactlyOnce(currentDialogText, OVERRUN_NEW_CLOSE_START, 'the current sw_dlg_close_row'),
      currentDialogText.indexOf(OVERRUN_NEW_CLOSE_END) + OVERRUN_NEW_CLOSE_END.length
    );
    const from = exactlyOnce(out, OVERRUN_NEW_CLOSE_START, 'the older per-cell sw_dlg_close_row');
    const to = out.indexOf(OVERRUN_OLD_CLOSE_END, from);
    if (to < 0 || out.indexOf(OVERRUN_OLD_CLOSE_END, to + 1) >= 0) throw new Error('overrun fix: the end of the older per-cell sw_dlg_close_row was not found exactly once');
    out = out.slice(0, from) + newClose + out.slice(to + OVERRUN_OLD_CLOSE_END.length);
    const at = exactlyOnce(out, MAPPER_START, 'sw_dlg_mapper_start: in the older text');
    return out.slice(0, at) + block + '  .if TEXT_ENABLED\n' + OVERRUN_EQUATE + '  .endif\n' + out.slice(at);
  }
  const at = exactlyOnce(oldText, MAPPER_START, 'sw_dlg_mapper_start: in the older text');
  let out = oldText.slice(0, at) + block + oldText.slice(at);
  if (out.includes('sw_dlg_terrain_read:\n')) {
    exactlyOnce(out, OVERRUN_SHIM_OLD, 'the older banked shim\'s terrain gateway');
    out = out.replace(OVERRUN_SHIM_OLD, OVERRUN_SHIM_NEW);
  }
  const inc = exactlyOnce(out, INCLUDE_DIALOG, 'the dialogue include in the older text');
  return out.slice(0, inc) + OVERRUN_EQUATE + out.slice(inc);
}

// engine/constants.asm: the three close-row alias equates and the comment block that states their row-scoped lifetime.
const OVERRUN_ALIASES_START = "; The text-box close row's three working bytes";
const OVERRUN_ALIASES_END = 'sw_dlgcr_row     = sw_dlgw_tmp\n';
const OVERRUN_ALIASES_AFTER = /^sw_dlgw_mtrow    = \$EA[^\n]*\n/m;

function overrunAliasBlock(constantsText) {
  const a = exactlyOnce(constantsText, OVERRUN_ALIASES_START, 'the close-row alias block');
  const b = constantsText.indexOf(OVERRUN_ALIASES_END, a);
  if (b < 0) throw new Error('overrun fix: the end of the close-row alias block was not found');
  return constantsText.slice(a, b + OVERRUN_ALIASES_END.length);
}

/** An older constants.asm with the close-row aliases carried in (lifted from the current file) right after sw_dlgw_mtrow. */
export function carryOverrunConstants(oldText, currentText) {
  const block = overrunAliasBlock(currentText);
  const hits = oldText.match(new RegExp(OVERRUN_ALIASES_AFTER.source, 'gm')) ?? [];
  if (hits.length !== 1) throw new Error(`overrun fix: sw_dlgw_mtrow was not found exactly once in the older constants (${hits.length})`);
  if (oldText.includes('sw_dlgcr_lc')) throw new Error('overrun fix: the older constants already carry the aliases');
  return oldText.replace(OVERRUN_ALIASES_AFTER, (m) => m + block);
}

export function stripOverrunConstants(text) {
  return text.replace(overrunAliasBlock(text), '');
}

// ---- the entity pass's battle contract (the slot-5 hang fix) ----------------------------------------------------------------------
// engine/entities.asm's update_entities_loop gained a first-contact-wins test (.if BATTLE_ENABLED: game_state != 0 ends the pass at
// the loop top, with an RPG-only exit label) and engine/rpg.asm's battle_begin moved its pc_status loop and owner lookup from X to Y.
// Both are lifted from the CURRENT files into an older text by region, count-checked, so the older text keeps everything else of its own.
const ENTITY_PASS_TOP = /^update_entities_loop:\n  lda ent_active,x\n  beq update_entities_next\n([\s\S]*?)  lda ent_hurt,x\n/m;
const ENTITY_PASS_TAIL = /^  bne update_entities_loop\n([\s\S]*?)  rts\n/m;
const BATTLE_BEGIN_REGION = /^battle_begin:\n[\s\S]*?^battle_begin_no_owner:\n/m;

/** An older entities.asm / rpg.asm pair with the entity-pass battle contract carried in from the current files. */
export function carryEntityPassLever(oldEntities, currentEntities, oldRpg, currentRpg) {
  const top = currentEntities.match(ENTITY_PASS_TOP)?.[1];
  const tail = currentEntities.match(ENTITY_PASS_TAIL)?.[1];
  if (!top || !top.includes('update_entities_done') || !tail || !tail.includes('update_entities_done:')) throw new Error('entity pass: the current entities.asm does not carry the first-contact-wins test');
  const oldTop = 'update_entities_loop:\n  lda ent_active,x\n  beq update_entities_next\n  lda ent_hurt,x\n';
  const oldTail = '  bne update_entities_loop\n  rts\n';
  if (oldEntities.split(oldTop).length !== 2 || oldEntities.split(oldTail).length !== 2) throw new Error('entity pass: the older update_entities_loop top/tail was not found exactly once');
  const region = currentRpg.match(BATTLE_BEGIN_REGION)?.[0];
  if (!region || (oldRpg.match(new RegExp(BATTLE_BEGIN_REGION.source, 'gm')) ?? []).length !== 1) throw new Error('entity pass: battle_begin..battle_begin_no_owner was not found exactly once in both rpg.asm files');
  return {
    entities: oldEntities
      .replace(oldTop, () => `update_entities_loop:\n  lda ent_active,x\n  beq update_entities_next\n${top}  lda ent_hurt,x\n`)
      .replace(oldTail, () => `  bne update_entities_loop\n${tail}  rts\n`),
    rpg: oldRpg.replace(BATTLE_BEGIN_REGION, () => region)
  };
}

// ---- the streamed save-range fix (Continue at local y 225-239) ---------------------------------------------------------------------
// engine/save.asm's save_check_valid y gate became mode-dependent on a streamed build (`.if STREAMING_ENABLED`), asking
// sw_save_streamed_screen, a block engine/streamworld.asm gained right after sw_save_commit_tail_end. Both are lifted from the CURRENT files
// into an older text by region (count-checked), or cut from a current text, so a comparison against an older commit still means what it did.
const SAVE_RANGE_OLD_GATE = '  lda SAVE_PLAYER_Y\n  cmp #MAX_Y+1\n  bcs save_check_invalid\n';
const SAVE_RANGE_GATE = /^  lda SAVE_PLAYER_Y\n  cmp #MAX_Y\+1\n[\s\S]*?^  \.if !STREAMING_ENABLED\n  bcs save_check_invalid\n  \.endif\n/m;
const SAVE_RANGE_BLOCK = /^sw_save_streamed_screen_start:\n[\s\S]*?^sw_save_streamed_screen_end:\n/m;

/** An older save.asm / streamworld.asm pair with the streamed save-range gate and its helper carried in from the current files. */
export function carrySaveRangeLever(oldSave, currentSave, oldStream, currentStream) {
  const gate = currentSave.match(SAVE_RANGE_GATE)?.[0];
  const block = currentStream.match(SAVE_RANGE_BLOCK)?.[0];
  if (!gate || !gate.includes('sw_save_streamed_screen') || !block) throw new Error('save range: the current files do not carry the streamed save-range gate and helper');
  if (oldSave.split(SAVE_RANGE_OLD_GATE).length !== 2) throw new Error('save range: the older save.asm y gate was not found exactly once');
  const anchor = 'sw_save_commit_tail_end:\n';
  if (oldStream.split(anchor).length !== 2) throw new Error('save range: the older streamworld.asm has no single sw_save_commit_tail_end');
  return {
    save: oldSave.replace(SAVE_RANGE_OLD_GATE, () => gate),
    streamworld: oldStream.replace(anchor, () => anchor + block)
  };
}

/** A current streamworld.asm text without the save-range helper's labelled block (its prose header is comment-only and ignored by code-line scans). */
export function stripSaveRangeFromStreamworld(text) {
  if ((text.match(new RegExp(SAVE_RANGE_BLOCK.source, 'gm')) ?? []).length !== 1) throw new Error('save range: streamworld.asm must carry the helper block exactly once');
  return text.replace(SAVE_RANGE_BLOCK, '');
}
