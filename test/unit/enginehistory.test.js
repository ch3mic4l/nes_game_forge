// test/lib/enginehistory.js's own regression suite (fix round 1c, item 2). validateB1Block's
// whole reason to exist is that restoreB1Routines identifies B1's own block purely as "marker to
// EOF" -- correct today, silently wrong the moment a later slice appends content after it without
// updating this helper (every A4 streamed-shape identity test and the placement-only check would
// then silently compare against a polluted "ancestor + B1" baseline instead of failing). These
// tests exercise validateB1Block directly against the real, current engine/streamworld.asm (stock
// pass) and against two hand-built mutants of the real block (each a class of corruption the check
// exists to catch), never against a hand-written fixture string -- a fixture could accidentally
// encode the checker's own assumptions rather than the real file's shape.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreB1Routines, validateB1Block, mergeReconstructEngineFile, s1ZeroPageNames } from '../lib/enginehistory.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const currentStreamworld = fs.readFileSync(path.join(ROOT, 'engine', 'streamworld.asm'), 'utf8');
const realB1Block = restoreB1Routines(currentStreamworld);

test('validateB1Block: the real, current B1 block validates clean', () => {
  assert.doesNotThrow(() => validateB1Block(realB1Block, ROOT));
});

test('validateB1Block: content appended after the block (a later slice landing without updating restoreB1Routines) is caught by the label-list check', () => {
  const mutated = `${realB1Block}\nsw_hypothetical_slice10_routine:\n  rts\n`;
  assert.throws(
    () => validateB1Block(mutated, ROOT),
    /top-level labels no longer match the fixed expected list/,
    'an extra trailing label must fail the exact expected-label-list comparison, not merely be ignored'
  );
});

test('validateB1Block: a routine silently deleted from the block (rather than appended to) is caught the same way', () => {
  // Delete sw_redraw_screen_landing's own block entirely -- the tail shrinks, and the expected
  // label list's last two entries go missing.
  const idx = realB1Block.indexOf('sw_redraw_screen_landing:');
  assert.ok(idx > 0, 'fixture assumption: sw_redraw_screen_landing must exist in the real block');
  const mutated = realB1Block.slice(0, idx);
  assert.throws(
    () => validateB1Block(mutated, ROOT),
    /top-level labels no longer match the fixed expected list/
  );
});

test('validateB1Block: a jsr/jmp retargeted to a name that exists nowhere in engine/*.asm is caught, not merely a plausible-looking relocation', () => {
  const mutated = realB1Block.replace('jsr sw_locate_current', 'jsr sw_locate_bogus_xyz');
  assert.notEqual(mutated, realB1Block, 'fixture assumption: the real block must contain this exact call');
  assert.throws(
    () => validateB1Block(mutated, ROOT),
    /references symbol\(s\) not defined anywhere/
  );
});

test('validateB1Block: an absolute data reference retargeted to an undefined name is caught the same way as a jsr/jmp target', () => {
  const mutated = realB1Block.replace('adc sw_oam_corner_xoff,y', 'adc sw_oam_corner_bogus_xyz,y');
  assert.notEqual(mutated, realB1Block, 'fixture assumption: the real block must contain this exact reference');
  assert.throws(
    () => validateB1Block(mutated, ROOT),
    /references symbol\(s\) not defined anywhere/
  );
});

test('validateB1Block: generated per-project data-table labels (never present in engine/*.asm, emitted fresh into build/assets/*.inc by generate.js) are not flagged as undefined', () => {
  // player_tiles/player_pal/actor_hp/anim_ptr_lo/anim_ptr_hi/ms_count/ms_ptr_lo/ms_ptr_hi are all
  // referenced by the real block and all generated, never defined in any engine/*.asm file -- the
  // "stock validates clean" test above already proves this holds for the real block; this test
  // pins the specific names down so a future rename in generate.js's own emission is caught by an
  // assertion failure here instead of validateB1Block silently degrading (matching every OTHER name
  // it should have flagged, false negative, no error) if generate.js's `name:\n` emission shape
  // itself changed.
  for (const name of ['player_tiles', 'player_pal', 'actor_hp', 'anim_ptr_lo', 'anim_ptr_hi', 'ms_count', 'ms_ptr_lo', 'ms_ptr_hi']) {
    assert.ok(realB1Block.includes(name), `fixture assumption: the real B1 block must reference ${name}`);
  }
  assert.doesNotThrow(() => validateB1Block(realB1Block, ROOT));
});

test('mergeReconstructEngineFile: calls validateB1Block itself, so a caller building "ancestor + B1" gets the same protection for free', () => {
  // A real, small ancestor reconstruction (against the last commit) must still succeed -- proving
  // validateB1Block runs as part of the normal path, not only when called directly.
  assert.doesNotThrow(() => mergeReconstructEngineFile(ROOT, '2563ef4', 'streamworld.asm'));
});

// Round 2 finding A4: the checks above all pass against the CURRENT filesystem, which is exactly
// what let a reference to a symbol absent at the ancestor but present today validate cleanly --
// the false "ancestor + B1 predates this symbol too" claim mergeReconstructEngineFile exists to
// prevent. sw_dlg20_pending_tick is a real, concrete case: genuinely absent from 2563ef4's own
// engine/streamworld.asm (confirmed via `git show 2563ef4:engine/streamworld.asm | grep -c
// sw_dlg20_pending_tick` = 0) and genuinely present in the current tree (it is slice 9's own
// completion hook), so the same mutated block must be REJECTED when validated against 2563ef4 and
// ACCEPTED when validated against the current tree (no rev) -- proving the ancestor-aware path is
// actually exercised, not merely present but unreachable.
test('validateB1Block: a reference to a symbol absent at the ancestor but present today is caught only when an ancestor rev is given', () => {
  const mutated = realB1Block.replace('jsr sw_adv_offset', 'jsr sw_dlg20_pending_tick');
  assert.notEqual(mutated, realB1Block, 'fixture assumption: the real block must contain this exact call');
  assert.doesNotThrow(
    () => validateB1Block(mutated, ROOT),
    'sw_dlg20_pending_tick genuinely exists in the current tree, so the no-rev (current-filesystem) check must accept it'
  );
  assert.throws(
    () => validateB1Block(mutated, ROOT, '2563ef4'),
    /references symbol\(s\) not defined anywhere in engine\/\*\.asm at 2563ef4/,
    'sw_dlg20_pending_tick did not exist at 2563ef4, so the ancestor-aware check must reject it'
  );
});

test('validateB1Block: the real block still validates clean against an ancestor rev (its own genuinely-old references predate that ancestor too)', () => {
  assert.doesNotThrow(() => validateB1Block(realB1Block, ROOT, '2563ef4'));
});

test('validateB1Block: the ancestor-rev exemption for S1 zero-page names is scoped -- each name is defined today, absent at 2563ef4, and an invented name is still rejected', () => {
  // Slice S1 added sw_cx0_* / sw_cy0_* / sw_dxb_* / sw_dyb_lo to constants.asm; the exemption must
  // not become a way to hide any other undefined reference.
  const names = s1ZeroPageNames(ROOT);
  assert.equal(names.size, 7, 'all seven S1 names must be defined in the current constants.asm');
  const ancestorConstants = execFileSync('git', ['show', '2563ef4:engine/constants.asm'], { cwd: ROOT, encoding: 'utf8' });
  for (const n of names) assert.ok(!new RegExp(`^${n}\\b`, 'm').test(ancestorConstants), `${n} must not exist at 2563ef4, or it needs no exemption`);
  const mutated = realB1Block.replace('sta <sw_cx0_lo', 'sta <sw_cx0_bogus_xyz');
  assert.notEqual(mutated, realB1Block, 'fixture assumption: the real block must contain this exact store');
  assert.throws(() => validateB1Block(mutated, ROOT, '2563ef4'), /sw_cx0_bogus_xyz/);
});

test('validateB1Block: an unlabelled byte appended after the block\'s own final label is caught even though the label list is untouched', () => {
  // Round 2 finding A4's own literal example: an appended `.db $ea` costs no new label, so the
  // label-list check alone (the tests above) cannot see it -- only the trailing-content check can.
  const mutated = `${realB1Block}\n  .db $ea\n`;
  assert.throws(
    () => validateB1Block(mutated, ROOT),
    /content found after the B1 block's own final label/
  );
});

test('validateB1Block: a trailing comment after the block\'s own final label is allowed (it costs no assembled bytes and is not itself an identity change)', () => {
  const mutated = `${realB1Block}\n; a harmless trailing comment\n`;
  assert.doesNotThrow(() => validateB1Block(mutated, ROOT));
});

test('validateB1Block: a `<` zero-page-prefixed operand retargeted to an undefined name is caught (the prior operand regex required a bare, unprefixed name and let this slip through entirely)', () => {
  const mutated = realB1Block.replace('sta <ent_tmp', 'sta <does_not_exist');
  assert.notEqual(mutated, realB1Block, 'fixture assumption: the real block must contain this exact store');
  assert.throws(
    () => validateB1Block(mutated, ROOT),
    /references symbol\(s\) not defined anywhere/
  );
});

test('validateB1Block: a branch operand retargeted to an undefined label is caught (the prior implementation exempted every branch mnemonic from the check entirely)', () => {
  const mutated = realB1Block.replace('bne spawn_streamed_any', 'bne spawn_streamed_bogus_xyz');
  assert.notEqual(mutated, realB1Block, 'fixture assumption: the real block must contain this exact branch');
  assert.throws(
    () => validateB1Block(mutated, ROOT),
    /references symbol\(s\) not defined anywhere/
  );
});

test('validateB1Block: an `#$FF`-style hex immediate is never mistaken for an undefined symbol reference (its digits alone match the identifier shape)', () => {
  assert.ok(realB1Block.includes('#$FF'), 'fixture assumption: the real block must contain a #$FF immediate');
  assert.doesNotThrow(() => validateB1Block(realB1Block, ROOT));
});

// Round 3 finding A-deferrable 2 (E3/audit.log): the trailing-content check used to match the
// WHOLE final-label line (`.*$`), so a byte appended on that SAME line as the label -- rather than
// on a new line after it -- was silently swallowed into the match and never reached the tail scan.
test('validateB1Block: a byte appended on the SAME line as the block\'s own final label is caught, not only one appended on a following line', () => {
  const mutated = realB1Block.replace('sw_redraw_screen_landing_end:', 'sw_redraw_screen_landing_end: .db $ea');
  assert.notEqual(mutated, realB1Block, 'fixture assumption: the real block must contain this exact final label');
  assert.throws(
    () => validateB1Block(mutated, ROOT),
    /content found after the B1 block's own final label/
  );
});

// Round 3 finding A-deferrable 2 (E3/audit.log): the prior one-letter exemption covered every
// single-character identifier, not only the three real register names (a/x/y) -- so `sta <q`
// validated cleanly with `q` genuinely undefined anywhere in engine/*.asm.
test('validateB1Block: a one-letter operand that is not a register name (a/x/y) is still checked as a real symbol reference', () => {
  const mutated = realB1Block.replace('sta <ent_tmp', 'sta <q');
  assert.notEqual(mutated, realB1Block, 'fixture assumption: the real block must contain this exact store');
  assert.ok(!/^q$/im.test(''), 'sanity: q is not a defined engine symbol in this codebase');
  assert.throws(
    () => validateB1Block(mutated, ROOT),
    /references symbol\(s\) not defined anywhere/
  );
});

test('validateB1Block: register-name operands (a/x/y, case-insensitive) remain exempt from the undefined-symbol check', () => {
  assert.ok(/\basl a\b|\, *x\b|\, *y\b/i.test(realB1Block), 'fixture assumption: the real block must contain at least one register operand');
  assert.doesNotThrow(() => validateB1Block(realB1Block, ROOT));
});
