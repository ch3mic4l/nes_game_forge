// The identity matrix (handoff-next/streamed-worlds-phase3a-plan.md §6.4, S3b's plan §6): generated project shapes
// (test/lib/identityshapes.js), each built to a real ROM in mkdtemp and compared with the ROM the
// PARENT commit builds for the same shape (test/fixtures/identity/<slice>.json, made by
// test/lib/build_identity_baseline.mjs from a `git worktree` of that commit).
//
// This file asserts slice S3b's identity (parent 15c11b7: S3a.5, which already carries the closed-form camera; the one lever carried is the
// Say/Move overrun fix's close row, lifted into the parent by build_identity_baseline.mjs --carry-overrun). Slice N+1's commit replaces the baseline (§6.4): S3a's own file (S3a-I/S3a-D against 3313b62) is retired with it, and what it
// proved is the parent's own behaviour now.
//   S3b-I  not a streamed Move (X false: no streamed map, or no Move anywhere): ROM == the parent's, byte for byte, and no talker label exists.
//   S3b-D  X = U and M (a streamed map AND a Move anywhere in the project, NPC/self-only included -- Chris's ruling 3): structural, never
//          "identical outside the changed spans": the symbol diff is exactly the added/removed label set below, the kernel-lo and
//          kernel-hi regions each moved by the named allowances, the delegation span lost exactly the nocross inc/dec pair, the four
//          sw_pstep_<dir> each end in one `jsr sw_talker_cross`, and no byte of sw_step_nocross survives anywhere.
//
// The expected outcome of every shape is the hand-written TRUTH table below. It is deliberately not
// computed from projectUsesStreaming/projectUsesMove or any generator predicate (a predicate bug
// must not agree with its own oracle): a shape the table calls identical that the generator makes
// delegate fails the ROM comparison, and one the table calls a delegation that the generator does
// not make fails the label assertions.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import {
  STREAMWORLD_MOVE_KERNEL_ALLOWANCE,
  TALKER_KERNEL_LO_ALLOWANCE_START_DIALOG, TALKER_KERNEL_LO_ALLOWANCE_CLOSE, TALKER_KERNEL_LO_ALLOWANCE_SCRIPT,
  TALKER_KERNEL_LO_ALLOWANCE_SETTLE, TALKER_RESET_KERNEL_LO_ALLOWANCE_INIT_SESSION, TALKER_RESET_KERNEL_LO_ALLOWANCE_TAKE_DOOR,
  TALKER_BATTLE_KERNEL_LO_ALLOWANCE
} from '../../main/build/generate.js';
import { TALKER_KERNEL_HI_ALLOWANCE, TALKER_CROSS_CALLS_KERNEL_HI_ALLOWANCE } from '../../main/build/streamplacement.js';
import { SHAPES, buildShapeProject } from '../lib/identityshapes.js';
import { sha256, parseFns, namesHash, kernelFileOffset, expectedClamp, CLAMP_BYTES } from '../lib/identitycompare.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/identity/S3b.json'), 'utf8'));
const started = Date.now();
let built = 0;

// Hand-written. 'identical' = ROM == the parent's; 'delegate' = a streamed map AND a Move somewhere.
// Same rows for both game types.
const TRUTH = {
  'base': 'identical',
  'U-noA': 'identical',
  'U-A': 'identical',
  'move-npc': 'identical',
  'move-player-ord': 'delegate',
  'move-player-str': 'delegate',
  'text': 'identical',
  'save': 'identical',
  'turn': 'identical',
  'visible': 'identical',
  'turn+move-npc': 'identical',
  'U-noA+turn': 'identical',
  'U-A+turn': 'identical',
  'U-A+move-npc+text': 'delegate',
  'U-noA+move-npc': 'delegate',
  'all-toggles+move-npc': 'identical',
  'U-A+text+visible': 'identical',
  'U-noA+text+save+visible': 'identical',
  'move-player-ord+turn+text': 'delegate',
  'move-player-str+turn+text+visible': 'delegate'
};
const truthFor = (id) => TRUTH[id.slice(id.indexOf(':') + 1)];

// Hand-written label sets of the slice's own edit (engine/streamworld.asm, one label in engine/boot.asm): every label a delegating build gains or loses, and no other.
const ADDED = [
  'sw_talker_capture', 'sw_talker_rebind', 'sw_tr_loop', 'sw_tr_next', 'sw_tr_gone', 'sw_tr_found', 'sw_talker_cross', 'sw_tx_store', 'sw_tx_done',
  'sw_battle_resume', 'sw_br_rearm', 'sw_or_loop', 'sw_or_next', 'sw_or_found', 'sw_or_clear', 'sw_br_done',
  'sw_rr_move', 'sw_rr_turn', 'sw_rr_visible', 'sw_rr_fin', 'sw_talker_reset', 'sw_talker_end',
  'settle_owed_live' // engine/boot.asm: settle_owed's inactive-slot discard
];
const REMOVED = ['sw_pr_refuse', 'sw_pl_refuse', 'sw_pd_refuse', 'sw_pu_refuse'];
// The PARENT's (15c11b7) own kernel-lo Move term, hand-written; the new one and every talker term are imported, so a re-measured allowance
// moves the expected growth with it -- and kernelbytes.test.js holds each to nesasm site by site.
const PARENT_MOVE_KL = 83;
const PARENT_MOVE_KH = 20; // the four sw_step_nocross guards
// engine/entities.asm move_tick_streamed..move_tick_ordinary: 67 at the parent, 61 without the nocross inc/dec pair
const DELEGATION_SPAN = 61;

// 6502 opcodes; engine/constants.asm
const JSR = 0x20;
const INC_ABS = 0xee;
const DEC_ABS = 0xce;
const NOCROSS = [0x7f, 0x07]; // $077F, the byte S3a allocated and S3b deleted

const boots = { skip: !hasNesasm && 'nesasm not found on PATH' };

async function build(shape) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-identity-'));
  try {
    const project = buildShapeProject(shape.desc);
    await saveProject(dir, project);
    const result = await buildProject({ dir, project, log: () => {} });
    built++;
    return {
      rom: new Uint8Array(fs.readFileSync(result.romPath)),
      syms: parseFns(fs.readFileSync(path.join(dir, 'build/game.fns'), 'utf8'))
    };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}


after(() => {
  console.log(`identity matrix S3b: ${built} shapes built and compared in ${((Date.now() - started) / 1000).toFixed(1)} s (${SHAPES.length} shapes, 2 game types)`);
});

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
  assert.equal(baseline.parentRev, '15c11b7bc9fcd3caaf06dbb5e165439e5ce5cb3a');
  assert.equal(baseline.carries, 'overrun-lever', 'the baseline is the parent plus the Say/Move overrun fix\'s close row (15c11b7 already has S3a.5, so that is the only lever)');
  assert.equal(ids.filter((id) => truthFor(id) === 'delegate').length, 12, 'six delegating rows per game type');
});

test('the label sets the slice adds are pairwise disjoint from what it removes', () => {
  const all = [...ADDED, ...REMOVED];
  assert.equal(new Set(all).size, all.length);
});

for (const shape of SHAPES) {
  const truth = truthFor(shape.id);
  const title = truth === 'identical' ? 'not a streamed Move: byte-identical to the parent, and no talker label exists' : 'streamed map and a Move: the talker delta is exactly the named terms';
  test(`S3b-${truth === 'identical' ? 'I' : 'D'} ${shape.id}: ${title}`, boots, async () => {
    const old = baseline.shapes[shape.id];
    const { rom, syms } = await build(shape);
    // S0's clamp is still there wherever move_face is (its bytes are the parent's, unchanged)
    if (syms.move_face_done !== undefined) {
      const at = kernelFileOffset(rom, syms.move_face_done - CLAMP_BYTES);
      assert.deepEqual([...rom.slice(at, at + CLAMP_BYTES)], [...expectedClamp(syms)], 'move_face keeps S0\'s clamp');
    }
    const added = ADDED.filter((n) => syms[n] !== undefined);

    if (truth === 'identical') {
      assert.equal(rom.length, old.size);
      assert.equal(sha256(rom), old.romSha, 'S3b-I: the ROM must be byte-identical to the parent build');
      assert.equal(namesHash(syms), old.namesSha, 'and so is its symbol table');
      assert.deepEqual(added, [], 'no talker label may exist without a streamed Move');
      return;
    }

    // ---- S3b-D: U and M
    assert.equal(rom.length, old.size, 'the cartridge stays the same size');
    assert.deepEqual(added.sort(), [...ADDED].sort(), 'every label the slice adds is assembled');
    assert.deepEqual(REMOVED.filter((n) => syms[n] !== undefined), [], 'the four ownership-stop refuse labels are gone');
    // the symbol diff is exactly the expected added/removed set: undo it and the parent's names come back
    const restored = Object.fromEntries(Object.keys(syms).filter((n) => !ADDED.includes(n)).map((n) => [n, 0]));
    for (const name of REMOVED) restored[name] = 0;
    assert.equal(namesHash(restored), old.namesSha, 'the symbol names must be the parent\'s plus/minus exactly the slice\'s own labels');

    // kernel-lo: the Move term lost the nocross pair (-6) and the talker call sites came in (RPG adds battle_end's)
    const talkerLo =
      TALKER_KERNEL_LO_ALLOWANCE_START_DIALOG + TALKER_KERNEL_LO_ALLOWANCE_CLOSE + TALKER_KERNEL_LO_ALLOWANCE_SCRIPT +
      TALKER_KERNEL_LO_ALLOWANCE_SETTLE + TALKER_RESET_KERNEL_LO_ALLOWANCE_INIT_SESSION + TALKER_RESET_KERNEL_LO_ALLOWANCE_TAKE_DOOR +
      (shape.id.startsWith('rpg:') ? TALKER_BATTLE_KERNEL_LO_ALLOWANCE : 0);
    assert.equal(syms.music_tick_loop - old.klAnchor, STREAMWORLD_MOVE_KERNEL_ALLOWANCE - PARENT_MOVE_KL + talkerLo, 'kernel-lo growth');
    // kernel-hi: up to B1's last label the guards left (-20) and four calls arrived; the talker block follows it
    assert.equal(syms.sw_redraw_screen_landing_end - old.khAnchor, TALKER_CROSS_CALLS_KERNEL_HI_ALLOWANCE - PARENT_MOVE_KH, 'kernel-hi growth before the talker block');
    assert.equal(syms.sw_talker_end - syms.sw_talker_capture, TALKER_KERNEL_HI_ALLOWANCE, 'the talker block is its allowance');

    // the delegation span: its size, and its bytes counted from the ROM
    assert.equal(syms.move_tick_ordinary - syms.move_tick_streamed, DELEGATION_SPAN, 'the delegation span');
    const lo = (a) => a & 0xff;
    const hi = (a) => a >> 8;
    const from = kernelFileOffset(rom, syms.move_tick_streamed);
    const span = [...rom.slice(from, from + DELEGATION_SPAN)];
    const count = (bytes, within = span) => {
      let n = 0;
      for (let i = 0; i + bytes.length <= within.length; i++) if (bytes.every((b, k) => within[i + k] === b)) n++;
      return n;
    };
    for (const dir of ['down', 'up', 'left', 'right']) {
      assert.equal(count([JSR, lo(syms[`sw_pstep_${dir}`]), hi(syms[`sw_pstep_${dir}`])]), 1, `exactly one jsr sw_pstep_${dir}`);
    }
    assert.equal(count([JSR, lo(syms.sw_frame_camera_window), hi(syms.sw_frame_camera_window)]), 1, 'exactly one jsr sw_frame_camera_window');
    assert.equal(count([INC_ABS, ...NOCROSS]) + count([DEC_ABS, ...NOCROSS]), 0, 'the nocross raise and drop are gone from the delegation');
    // each sw_pstep_<dir> ends in exactly one `jsr sw_talker_cross` followed by its rts; the four routines are laid out in this order, so a
    // call is attributed to the routine whose label most recently precedes it
    const callBytes = [JSR, lo(syms.sw_talker_cross), hi(syms.sw_talker_cross)];
    const dirs = ['right', 'left', 'down', 'up'].map((dir) => ({ dir, at: syms[`sw_pstep_${dir}`] })).sort((x, y) => x.at - y.at);
    const regionStart = kernelFileOffset(rom, dirs[0].at);
    const regionEnd = kernelFileOffset(rom, syms.sw_talker_capture);
    const region = [...rom.slice(regionStart, regionEnd)];
    const hits = [];
    for (let i = 0; i + 3 <= region.length; i++) if (callBytes.every((b, k) => region[i + k] === b)) hits.push(i);
    assert.equal(hits.length, 4, 'four jsr sw_talker_cross in the step routines, no more');
    const owners = hits.map((h) => dirs.filter((d) => kernelFileOffset(rom, d.at) - regionStart <= h).at(-1).dir).sort();
    assert.deepEqual(owners, ['down', 'left', 'right', 'up'], 'one in each sw_pstep_<dir>');
    for (const h of hits) assert.equal(region[h + 3], 0x60, 'each is the last instruction before its rts');
    assert.equal(count([0xad, ...NOCROSS], region), 0, 'no sw_step_nocross guard remains in the step routines');
  });
}
