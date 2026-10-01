// The identity matrix (handoff-next/streamed-worlds-phase3a-plan.md §6.4): generated project shapes
// (test/lib/identityshapes.js), each built to a real ROM in mkdtemp and compared with the ROM the
// PARENT commit builds for the same shape (test/fixtures/identity/<slice>.json, made by
// test/lib/build_identity_baseline.mjs from a `git worktree` of that commit).
//
// This file asserts slice S1's identity (parent 99d4156). S0's own file and tests (S0-I, against
// 9f0136e) are retired with it -- §6.4: slice N+1's commit replaces the baseline; what S0-I proved
// is the parent's own behaviour now, and S1-I1 holds every ordinary-only ROM byte-identical to it.
//   S1-I1  ordinary-only (both game types, every Text/Save/Turn/Visible toggle): ROM == parent,
//          and no S1 symbol.
//   S1-I2  streaming with no placed actor (U, not A): the OAM-busy flag's spans are the ONLY
//          delta, structurally -- the symbol names differ by exactly the flag's labels,
//          draw_one_entity_show_sw's normalised instructions/relocations and span are unchanged,
//          the kernel-lo region grew by OAM_BUSY_KERNEL_LO_ALLOWANCE and kernel-hi did not move.
//   S1-I3  streaming with an actor (A): measured span changes plus structure -- the old per-tile
//          body's labels are gone, the projection's are present, kernel-lo grew by the two
//          allowances and kernel-hi by exactly the projection's growth over the 164 bytes it
//          replaced. Never "identical outside the changed spans" (R2.6-6).
//
// The expected outcome of every shape is the hand-written TRUTH table below. It is deliberately not
// computed from projectUsesStreaming/projectUsesStreamedActors or any generator predicate (a
// predicate bug must not agree with its own oracle); the last test cross-checks it against the
// parent's own assembled symbol table instead. S2 adds the handover-flag axis and its rows.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import {
  MOVER_PARITY_GATE_KERNEL_ALLOWANCE,
  OAM_BUSY_KERNEL_LO_ALLOWANCE,
  PROJ_SETUP_KERNEL_LO_ALLOWANCE
} from '../../main/build/generate.js';
import {
  STREAMWORLD_ENTITY_PROJ_KERNEL_HI_ALLOWANCE,
  STREAMWORLD_ENTITY_SHOW_SW_KERNEL_HI_ALLOWANCE
} from '../../main/build/streamplacement.js';
import { SHAPES, buildShapeProject } from '../lib/identityshapes.js';
import { sha256, parseFns, namesHash, normalizeSpan, kernelFileOffset, expectedClamp, CLAMP_BYTES } from '../lib/identitycompare.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/identity/S1.json'), 'utf8'));

// Hand-written. 'identical' = ordinary-only (no streamed map); 'busy' = a streamed map, no actor
// placed on it (U, not A); 'proj' = a streamed map with a placed actor (U and A). Same rows for
// both game types.
const TRUTH = {
  'base': 'identical',
  'U-noA': 'busy',
  'U-A': 'proj',
  'move-npc': 'identical',
  'move-player-ord': 'proj',
  'move-player-str': 'proj',
  'text': 'identical',
  'save': 'identical',
  'turn': 'identical',
  'visible': 'identical',
  'turn+move-npc': 'identical',
  'U-noA+turn': 'busy',
  'U-A+turn': 'proj',
  'U-A+move-npc+text': 'proj',
  'U-noA+move-npc': 'busy',
  'all-toggles+move-npc': 'identical',
  'U-A+text+visible': 'proj',
  'U-noA+text+save+visible': 'busy',
  'move-player-ord+turn+text': 'proj',
  'move-player-str+turn+text+visible': 'proj'
};
const truthFor = (id) => TRUTH[id.slice(id.indexOf(':') + 1)];
const moveStreamed = (id) => MOVE_STREAMED.has(id.slice(id.indexOf(':') + 1));

// Hand-written label sets of the slice's own edit (engine/boot.asm, combat.asm, entities.asm,
// streamworld.asm). Every label the slice adds or removes, and no other.
const BUSY_LABELS = [
  'oam_busy_set_ui', 'oam_busy_set_ui_end', 'oam_busy_set_draw', 'oam_busy_set_draw_end',
  'oam_busy_clear', 'oam_busy_clear_end', 'oam_busy_nmi', 'oam_busy_nmi_end', 'oam_busy_init', 'oam_busy_init_end'
];
// entities.asm's call-site span labels sit outside their `.if`, so they exist (zero-size) in every build.
// (a1): the mover parity gate's pair is one of them -- update_entities_behave's first instructions on a streamed build.
const CALL_LABELS = ['proj_setup_call', 'proj_setup_call_end', 'mover_parity_gate', 'mover_parity_gate_end'];
// (a1) kernel-lo round: a project that streams AND uses Move assembles the shared streamed probe bodies instead of four
// per-direction copies (engine/entities.asm move_tick). Hand-written, like TRUTH: rows that stream and use Move.
const MOVE_STREAMED = new Set(['move-player-ord', 'move-player-str', 'U-A+move-npc+text', 'U-noA+move-npc', 'move-player-ord+turn+text', 'move-player-str+turn+text+visible']);
const MOVE_ADDED = ['move_tick_probe_v_streamed', 'move_tick_probe_h_streamed', 'move_tick_probe_h_streamed_end'];
const MOVE_REMOVED = ['move_tick_down_probe_same', 'move_tick_up_probe_same', 'move_tick_right_probe_same', 'move_tick_left_probe_same'];
// 4 copies of 25 bytes (100) became 4 x 4 (ldy/bne) + 2 x 21 = 58: hand-written, not read from any allowance
const MOVE_PROBE_SAVING = 42;
// engine/streamworld.asm's Flash-deferral labels (sw_win_arm_flash_guard..._end) sit outside their `.if`, so a
// streaming build carries them zero-size when it uses no Flash; an ordinary-only build never assembles that file
const GUARD_LABELS = ['sw_win_arm_flash_guard', 'sw_win_arm_flash_guard_end'];
const PROJ_ADDED = [
  'sw_ent_setup', 'sw_ent_setup_done', 'dsw_have_anim', 'dsw_have_count',
  'dsw_in_tile', 'dsw_done', 'dsw_cull', 'dsw_cull_tile', 'dsw_straddle', 'dsw_st_tile', 'dsw_st_park', 'dsw_st_next'
];
const PROJ_REMOVED = [
  'draw_one_entity_sw_have_anim', 'draw_one_entity_sw_have_count', 'draw_one_entity_sw_tile',
  'draw_one_entity_sw_tile_park', 'draw_one_entity_sw_tile_next', 'draw_one_entity_sw_done'
];

const boots = { skip: !hasNesasm && 'nesasm not found on PATH' };

async function build(shape) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-identity-'));
  try {
    const project = buildShapeProject(shape.desc);
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    return {
      rom: new Uint8Array(fs.readFileSync(built.romPath)),
      syms: parseFns(fs.readFileSync(path.join(dir, 'build/game.fns'), 'utf8'))
    };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

test('the truth table and the generated shapes cover exactly the same rows, and the baseline has every one', () => {
  const ids = SHAPES.map((s) => s.id);
  assert.deepEqual(ids.filter((id) => truthFor(id) === undefined), [], 'a shape has no hand-written expectation');
  const games = ['action', 'rpg'];
  assert.deepEqual(
    [...ids].sort(),
    games.flatMap((g) => Object.keys(TRUTH).map((k) => `${g}:${k}`)).sort(),
    'the truth table has a row no shape builds'
  );
  assert.deepEqual(Object.keys(baseline.shapes).sort(), [...ids].sort());
  assert.equal(baseline.parentRev, '99d4156c884efb4d60cb283a6580fbff23eebaf5');
});

test('the hand-written truth table agrees with what the parent commit itself assembled', () => {
  // independent of every generator predicate: only a streaming project assembled the streamed
  // routine (draw_one_entity_show_sw) in the parent, and the parent had no oam_busy label at all
  for (const shape of SHAPES) {
    const streaming = baseline.shapes[shape.id].showSw !== undefined;
    assert.equal(streaming, truthFor(shape.id) !== 'identical', `${shape.id}: the parent ${streaming ? 'assembled' : 'did not assemble'} the streamed routine`);
    if (streaming) {
      assert.equal(baseline.shapes[shape.id].showSw.size, STREAMWORLD_ENTITY_SHOW_SW_KERNEL_HI_ALLOWANCE, `${shape.id}: the parent's per-tile routine is the 164 bytes the ledger replaced`);
    }
  }
});

test('the two label sets the slice adds are pairwise disjoint from what it removes', () => {
  const all = [...BUSY_LABELS, ...CALL_LABELS, ...PROJ_ADDED, ...PROJ_REMOVED, ...MOVE_ADDED, ...MOVE_REMOVED];
  assert.equal(new Set(all).size, all.length);
});

for (const shape of SHAPES) {
  const truth = truthFor(shape.id);
  const title = { identical: 'ordinary-only: byte-identical to the parent', busy: 'streaming, no actor: the OAM-busy spans alone', proj: 'streaming + actor: the projection replaces the per-tile routine' }[truth];
  test(`S1-I ${shape.id}: ${title}`, boots, async () => {
    const old = baseline.shapes[shape.id];
    const { rom, syms } = await build(shape);
    // S0's clamp is still there wherever move_face is (its bytes are the parent's, unchanged)
    if (syms.move_face_done !== undefined) {
      const at = kernelFileOffset(rom, syms.move_face_done - CLAMP_BYTES);
      assert.deepEqual([...rom.slice(at, at + CLAMP_BYTES)], [...expectedClamp(syms)], 'move_face keeps S0\'s clamp');
    }
    const spans = [['oam_busy_set_ui', 'oam_busy_set_ui_end'], ['oam_busy_set_draw', 'oam_busy_set_draw_end'], ['oam_busy_clear', 'oam_busy_clear_end'], ['oam_busy_nmi', 'oam_busy_nmi_end'], ['oam_busy_init', 'oam_busy_init_end']];
    const busyBytes = spans.reduce((n, [a, b]) => n + syms[b] - syms[a], 0);
    if (truth === 'identical') {
      assert.equal(rom.length, old.size);
      assert.equal(sha256(rom), old.romSha, 'S1-I1: an ordinary-only ROM must be byte-identical to the parent build');
      assert.equal(busyBytes, 0, 'the OAM-busy spans are empty without a streamed map');
      const restoredOrd = Object.fromEntries(Object.keys(syms).filter((n) => ![...BUSY_LABELS, ...CALL_LABELS].includes(n)).map((n) => [n, 0]));
      assert.equal(namesHash(restoredOrd), old.namesSha, 'the only new symbols are the zero-size span labels');
      assert.equal(syms.proj_setup_call_end - syms.proj_setup_call, 0);
      assert.equal(syms.mover_parity_gate_end - syms.mover_parity_gate, 0, 'no mover parity gate without a streamed map');
      for (const name of MOVE_ADDED) assert.equal(syms[name], undefined, `${name} may not exist without a streamed map`);
      for (const name of [...PROJ_ADDED, 'draw_one_entity_show_sw']) assert.equal(syms[name], undefined, `${name} may not exist without a streamed map`);
      return;
    }
    assert.equal(rom.length, old.size, 'the cartridge stays the same size');
    const names = new Set(Object.keys(syms));
    // the symbol diff is exactly the expected added/removed set: undo it and the parent's names come back
    const mv = moveStreamed(shape.id);
    const added = [...BUSY_LABELS, ...CALL_LABELS, ...GUARD_LABELS, ...(truth === 'busy' ? [] : PROJ_ADDED), ...(mv ? MOVE_ADDED : [])];
    const removed = [...(truth === 'busy' ? [] : PROJ_REMOVED), ...(mv ? MOVE_REMOVED : [])];
    for (const name of added) assert.ok(names.has(name), `${name} must be assembled`);
    for (const name of removed) assert.ok(!names.has(name), `${name} must be gone`);
    const restored = Object.fromEntries(Object.keys(syms).filter((n) => !added.includes(n)).map((n) => [n, 0]));
    for (const name of removed) restored[name] = 0;
    assert.equal(namesHash(restored), old.namesSha, 'the symbol names must be the parent\'s plus/minus exactly the slice\'s own labels');
    // kernel-lo grew by the flag (and, with an actor, the setup call); kernel-hi by the projection alone
    const klGrowth = syms.music_tick_loop - old.klAnchor;
    assert.equal(klGrowth, OAM_BUSY_KERNEL_LO_ALLOWANCE + (truth === 'proj' ? PROJ_SETUP_KERNEL_LO_ALLOWANCE : 0) + MOVER_PARITY_GATE_KERNEL_ALLOWANCE - (mv ? MOVE_PROBE_SAVING : 0), 'kernel-lo growth');
    // (a1): the gate is exactly txa / eor <frame_cnt / and #1 / bne update_entities_anim, at the top of update_entities_behave
    assert.equal(syms.mover_parity_gate_end - syms.mover_parity_gate, MOVER_PARITY_GATE_KERNEL_ALLOWANCE, 'the gate span is its allowance');
    const gateAt = kernelFileOffset(rom, syms.mover_parity_gate);
    const rel = (syms.update_entities_anim - syms.mover_parity_gate_end) & 0xff;
    assert.deepEqual([...rom.slice(gateAt, gateAt + 7)], [0x8a, 0x45, 0x1b /* frame_cnt, engine/constants.asm */, 0x29, 0x01, 0xd0, rel], 'the gate bytes');
    assert.equal(syms.move_tick_probe_h_streamed_end !== undefined, mv, 'the shared streamed probe bodies exist exactly on a streamed Move project');
    if (mv) {
      // (a1) kernel-lo round: the two shared probe bodies, byte for byte, written out by hand (sta / jsr / clc / adc / ...,
      // BODY_L = 2, BODY_B = 15, probe_x = $08, probe_y = $09, tmp = $06 from engine/constants.asm), and exactly two
      // `ldy <tmp / bne` entries into each -- one per direction of that axis -- inside move_tick.
      const lo = (a) => a & 0xff;
      const hi = (a) => a >> 8;
      const bodyV = [0x85, 0x09, 0x20, lo(syms.move_get_x), hi(syms.move_get_x), 0x18, 0x69, 2, 0x85, 0x08, 0xa9, 0, 0x69, 0, 0xa8, 0x20, lo(syms.sw_move_probe), hi(syms.sw_move_probe), 0x4c, lo(syms.move_tick_v_done), hi(syms.move_tick_v_done)];
      const bodyH = [0x85, 0x08, 0xa9, 0, 0x69, 0, 0xa8, 0x20, lo(syms.move_get_y), hi(syms.move_get_y), 0x18, 0x69, 15, 0x85, 0x09, 0x20, lo(syms.sw_move_probe), hi(syms.sw_move_probe), 0x4c, lo(syms.move_tick_h_done), hi(syms.move_tick_h_done)];
      const at = (label) => kernelFileOffset(rom, syms[label]);
      assert.deepEqual([...rom.slice(at('move_tick_probe_v_streamed'), at('move_tick_probe_v_streamed') + 21)], bodyV, 'the vertical streamed probe body');
      assert.deepEqual([...rom.slice(at('move_tick_probe_h_streamed'), at('move_tick_probe_h_streamed') + 21)], bodyH, 'the horizontal streamed probe body');
      const from = at('move_tick');
      const region = [...rom.slice(from, at('move_advance'))];
      const entries = (target) => {
        let n = 0;
        for (let i = 0; i + 3 < region.length; i++) {
          if (region[i] !== 0xa4 || region[i + 1] !== 0x06 || region[i + 2] !== 0xd0) continue;
          const dest = syms.move_tick + i + 4 + ((region[i + 3] << 24) >> 24);
          if (dest === target) n++;
        }
        return n;
      };
      assert.equal(entries(syms.move_tick_probe_v_streamed), 2, 'down and up enter the vertical body');
      assert.equal(entries(syms.move_tick_probe_h_streamed), 2, 'right and left enter the horizontal body');
    }
    const khGrowth = syms.sw_redraw_screen_landing_end - old.khAnchor;
    // the routine's own span: unchanged without an actor; setup + three classes with one
    const span = syms.draw_one_entity_show_sw_end - syms.draw_one_entity_show_sw;
    const ignore = [...added, ...removed];
    const norm = sha256(normalizeSpan(rom, syms, 'draw_one_entity_show_sw', 'draw_one_entity_show_sw_end', ignore).join('\n'));
    if (truth === 'busy') {
      assert.equal(khGrowth, 0, 'kernel-hi must not move without an actor');
      assert.equal(span, old.showSw.size, 'the per-tile routine\'s span is unchanged');
      assert.equal(norm, old.showSw.normSha, 'S1-I2: draw_one_entity_show_sw\'s normalised instructions and relocations are unchanged');
      assert.equal(syms.sw_ent_setup, undefined);
      assert.equal(syms.proj_setup_call_end - syms.proj_setup_call, 0, 'no setup call without an actor');
    } else {
      assert.equal(khGrowth, STREAMWORLD_ENTITY_PROJ_KERNEL_HI_ALLOWANCE - STREAMWORLD_ENTITY_SHOW_SW_KERNEL_HI_ALLOWANCE, 'kernel-hi growth equals the allowance delta');
      assert.equal(syms.draw_one_entity_show_sw_end - syms.sw_ent_setup, STREAMWORLD_ENTITY_PROJ_KERNEL_HI_ALLOWANCE, 'the projection span is its allowance');
      assert.equal(syms.proj_setup_call_end - syms.proj_setup_call, PROJ_SETUP_KERNEL_LO_ALLOWANCE);
      assert.notEqual(norm, old.showSw.normSha, 'the routine really is a different one');
    }
    assert.equal(busyBytes, OAM_BUSY_KERNEL_LO_ALLOWANCE, 'the five OAM-busy spans sum to their allowance');
  });
}
