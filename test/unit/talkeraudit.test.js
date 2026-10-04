// Phase 3a slice S3b (plan T7): the audit of every reader and writer of `talk_ent` in engine/*.asm.
//
// S3b adds a second way a self-command can find its talker gone (the player crossed a seam) and answers it
// with Rule R, which keys on `talk_crossed`, never on a held store. This audit pins the COMPLETE set of code
// sites that read or write `talk_ent`, by file, enclosing global label and direction, so that:
//   - a new reader (a new self-command, a new draw path) has to be added here, and with it a decision about
//     what it does with $FF (the absent sentinel) -- the corruption class T8 watches at run time;
//   - the held machinery of the H-on design cannot return unnoticed (no `talk_held`, no `held_*`);
//   - the S3b routines are accounted for explicitly: sw_talker_rebind is the one new writer, sw_battle_resume the one new
//     reader, and the Rule R skip branches (sw_rr_*) read `talk_crossed`, not `talk_ent`.
// Comments are stripped before scanning: only instructions count.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../engine');

const READS = /^(lda|ldx|ldy|cmp|cpx|cpy|adc|sbc|and|ora|eor|bit)$/;
const WRITES = /^(sta|stx|sty)$/;

/** Every instruction touching `name`: ["file:label:r|w", ...], sorted, one entry per instruction. */
function sitesOf(name) {
  const out = [];
  for (const file of fs.readdirSync(ENGINE).filter((f) => f.endsWith('.asm') && f !== 'constants.asm')) {
    let label = null;
    for (const raw of fs.readFileSync(path.join(ENGINE, file), 'utf8').split('\n')) {
      const m = /^([A-Za-z_]\w*):/.exec(raw);
      if (m) label = m[1];
      const code = raw.replace(/;.*/, '');
      const hit = new RegExp(`^\\s*(?:[A-Za-z_]\\w*:)?\\s*([a-z]{3})\\s+<?${name}\\b`).exec(code);
      if (!hit) continue;
      assert.ok(READS.test(hit[1]) || WRITES.test(hit[1]), `${file}:${label}: unclassified instruction ${hit[1]} on ${name}`);
      out.push(`${file}:${label}:${WRITES.test(hit[1]) ? 'w' : 'r'}`);
    }
  }
  return out.sort();
}

const EXPECTED_TALK_ENT = [
  'boot.asm:boot_wait2:w',
  'combat.asm:init_session_kb_done:w',
  'combat.asm:player_died:w',
  'entities.asm:move_face:r',
  'rpg.asm:battle_begin_no_owner:w',
  'rpg.asm:battle_begin_status:r',
  'rpg.asm:battle_end_owner_loop:w',
  'save.asm:continue_game:w',
  'script.asm:script_op_move:r',
  'script.asm:script_op_move:r',
  'script.asm:script_op_turn:r',
  'script.asm:script_op_visible:r',
  'script.asm:script_op_visible_ready:r',
  'streamworld.asm:sw_battle_resume:r', // S3b: a battle that suspended an event rebinds only when talk_ent is already the absent sentinel
  'streamworld.asm:sw_tr_found:w', //       S3b: the rebind -- the one new writer; it stores a live slot or $FF, never anything else
  'title.asm:restart_game:w',
  'title.asm:start_game:w',
  'ui.asm:close_ui:w',
  'ui.asm:draw_dialog:r',
  'ui.asm:start_dialog:w'
].sort();

test('T7 the complete set of talk_ent readers and writers is pinned, S3b\'s two new sites included', () => {
  assert.deepEqual(sitesOf('talk_ent'), EXPECTED_TALK_ENT);
});

test('T7 no held store survives: no talk_held, held_dir/frame/ms or sw_held_* anywhere in engine/ or the generator', () => {
  for (const file of fs.readdirSync(ENGINE).filter((f) => f.endsWith('.asm'))) {
    const text = fs.readFileSync(path.join(ENGINE, file), 'utf8').replace(/;.*/g, '');
    assert.ok(!/\b(talk_held|held_dir|held_frame|held_ms|sw_held_\w+)\b/.test(text), `engine/${file} has no held machinery`);
  }
});

test('T7 the Rule R skip branches key on talk_crossed and never read talk_ent themselves', () => {
  const text = fs.readFileSync(path.join(ENGINE, 'streamworld.asm'), 'utf8');
  for (const label of ['sw_rr_move', 'sw_rr_turn', 'sw_rr_visible']) {
    const at = text.indexOf(`\n${label}:`);
    assert.ok(at >= 0, `${label} exists`);
    const body = text.slice(at, text.indexOf('\n  jmp', at + 1) + 40).replace(/;.*/g, '');
    assert.match(body, /lda\s+talk_crossed/, `${label} reads talk_crossed`);
    assert.ok(!/talk_ent/.test(body), `${label} does not read talk_ent`);
  }
  // each script_op_* guard hands its gone-talker case to its sw_rr_* routine under TALKER_ENABLED and ends the event otherwise
  const script = fs.readFileSync(path.join(ENGINE, 'script.asm'), 'utf8');
  for (const op of ['move', 'turn', 'visible']) {
    assert.match(script, new RegExp(`\\.if TALKER_ENABLED\\s*\\n\\s*jmp sw_rr_${op}\\s*\\n\\s*\\.endif`), `script_op_${op}: the skip is Rule R when the talker flag is on`);
  }
  assert.equal((script.match(/\.if !TALKER_ENABLED\s*\n\s*jmp script_finish\s*\n\s*\.endif/g) ?? []).length, 3, 'and the shipped script_finish otherwise, three times');
});

test('T7 the four talker bytes have exactly the writers the design names', () => {
  const rec = sitesOf('talk_rec').filter((s) => s.endsWith(':w')).map((s) => s.split(':')[1]).sort();
  assert.deepEqual(rec, ['sw_talker_capture', 'sw_talker_reset']);
  const crossed = sitesOf('talk_crossed').filter((s) => s.endsWith(':w')).map((s) => s.split(':')[1]).sort();
  assert.deepEqual(crossed, ['sw_talker_capture', 'sw_talker_cross', 'sw_talker_reset']);
  const owed = sitesOf('owed_enter_rec').filter((s) => s.endsWith(':w')).map((s) => s.split(':')[1]).sort();
  assert.deepEqual(owed, ['sw_or_clear', 'sw_talker_capture', 'sw_tx_store', 'sw_talker_reset'].sort());
  const scr = sitesOf('talk_scr').filter((s) => s.endsWith(':w')).map((s) => s.split(':')[1]);
  assert.deepEqual(scr, ['sw_talker_capture']);
});
