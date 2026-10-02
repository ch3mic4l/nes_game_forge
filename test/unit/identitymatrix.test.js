// The identity matrix (handoff-next/streamed-worlds-phase3a-plan.md §6.4): generated project shapes
// (test/lib/identityshapes.js), each built to a real ROM in mkdtemp and compared with the ROM the
// PARENT commit builds for the same shape (test/fixtures/identity/<slice>.json, made by
// test/lib/build_identity_baseline.mjs from a `git worktree` of that commit).
//
// This file asserts slice S3a's identity (parent 3313b62; S2 is shelved, so there is no handover
// axis). S1's own file (S1-I1..I3, against 99d4156) is retired with it -- §6.4: slice N+1's commit
// replaces the baseline, and what S1-I proved is the parent's own behaviour now.
//   S3a-I  M false, or M and not U (no streamed map): ROM == the parent's, byte for byte. This
//          includes every streamed project with no Move at all (it assembles no move_tick and no
//          guard) and every ordinary-only project that uses Move (the ordinary arms are unchanged).
//   S3a-D  U and M (a streamed map AND a Move anywhere in the project, NPC/self-only or player):
//          the delegation. Structural, never "identical outside the changed spans" (R2.6-6): the
//          symbol diff is exactly the added/removed label set below, nothing named sw_move_probe*
//          survives, kernel-lo and kernel-hi each moved by (new allowance - the parent's), the
//          delegation span is the measured one, and its bytes -- one jsr per direction of the
//          shared driver, one jsr sw_frame_camera_window, the nocross inc/dec pair, and the four
//          nocross guards inside sw_pstep_<dir> branching to their own refuse label -- are
//          hand-assembled here.
//
// The expected outcome of every shape is the hand-written TRUTH table below. It is deliberately not
// computed from projectUsesStreaming/projectUsesMove or any generator predicate (a predicate bug
// must not agree with its own oracle): a shape the table calls identical that the generator makes
// delegate fails the ROM comparison, and one the table calls a delegation that the generator does
// not make fails the label assertions.
//
// Which S1 assertions went where: KEPT -- move_face keeps S0's clamp (checked in place on every
// shape), the truth-table/shape coverage and baseline-key checks, ordinary-only byte identity (now
// every non-delegating shape). REPLACED -- the OAM-busy / projection / gate / probe-body deltas
// (S1-I2, S1-I3) became byte identity, because the parent now contains them. RETIRED -- the S1
// label sets, MOVE_PROBE_SAVING and the 21-byte probe bodies (the bodies no longer exist), and the
// cross-check against the parent's showSw (the baseline no longer needs it).

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { STREAMWORLD_MOVE_KERNEL_ALLOWANCE } from '../../main/build/generate.js';
import { STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE } from '../../main/build/streamplacement.js';
import { SHAPES, buildShapeProject } from '../lib/identityshapes.js';
import { sha256, parseFns, namesHash, kernelFileOffset, expectedClamp, CLAMP_BYTES } from '../lib/identitycompare.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/identity/S3a.json'), 'utf8'));
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

// Hand-written label sets of the slice's own edit (engine/entities.asm, engine/streamworld.asm): every
// label a delegating build gains or loses, and no other.
const ADDED = [
  'move_tick_streamed', 'move_tick_s_up', 'move_tick_s_horizontal', 'move_tick_s_left', 'move_tick_s_done', 'move_tick_ordinary',
  'sw_pr_refuse', 'sw_pl_refuse', 'sw_pd_refuse', 'sw_pu_refuse'
];
const REMOVED = [
  'move_tick_bound_done', 'move_tick_vertical', 'move_tick_down_streamed', 'move_tick_down_bounded',
  'move_tick_right_streamed', 'move_tick_right_bounded', 'move_tick_probe_v_streamed', 'move_tick_probe_h_streamed',
  'move_tick_probe_h_streamed_end', 'sw_move_probe', 'sw_move_probe_cross', 'sw_move_probe_have_dy',
  'sw_move_probe_no_dy', 'sw_move_probe_same', 'sw_move_probe_solid', 'sw_move_probe_solid_done'
];
// The PARENT's (3313b62) own ledger terms for the Move, hand-written: kernel-lo 117 and kernel-hi 76. The new ones are
// imported, so a re-measured allowance moves the expected growth with it -- and kernelbytes.test.js holds each to nesasm.
const PARENT_MOVE_KL = 117;
const PARENT_MOVE_KH = 76;
// engine/entities.asm move_tick_streamed..move_tick_ordinary, measured in place (kernelbytes.test.js asserts it too)
const DELEGATION_SPAN = 67;

// 6502 opcodes the delegation is written in; engine/constants.asm: sw_step_nocross = $077F.
const JSR = 0x20;
const INC_ABS = 0xee;
const DEC_ABS = 0xce;
const LDA_ABS = 0xad;
const BNE = 0xd0;
const NOCROSS = [0x7f, 0x07];

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
  console.log(`identity matrix S3a: ${built} shapes built and compared in ${((Date.now() - started) / 1000).toFixed(1)} s (${SHAPES.length} shapes, 2 game types)`);
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
  assert.equal(baseline.parentRev, '3313b6257dfdc1332916436c030a5e803aa2cc8c');
  assert.equal(ids.filter((id) => truthFor(id) === 'delegate').length, 12, 'six delegating rows per game type');
});

test('the label sets the slice adds are pairwise disjoint from what it removes', () => {
  const all = [...ADDED, ...REMOVED];
  assert.equal(new Set(all).size, all.length);
});

for (const shape of SHAPES) {
  const truth = truthFor(shape.id);
  const title = truth === 'identical' ? 'M false or no streamed map: byte-identical to the parent' : 'streamed map and a Move: the delegation spans';
  test(`S3a-I ${shape.id}: ${title}`, boots, async () => {
    const old = baseline.shapes[shape.id];
    const { rom, syms } = await build(shape);
    // S0's clamp is still there wherever move_face is (its bytes are the parent's, unchanged)
    if (syms.move_face_done !== undefined) {
      const at = kernelFileOffset(rom, syms.move_face_done - CLAMP_BYTES);
      assert.deepEqual([...rom.slice(at, at + CLAMP_BYTES)], [...expectedClamp(syms)], 'move_face keeps S0\'s clamp');
    }
    const retired = Object.keys(syms).filter((n) => /^sw_move_probe/.test(n) || REMOVED.includes(n));
    const added = ADDED.filter((n) => syms[n] !== undefined);

    if (truth === 'identical') {
      assert.equal(rom.length, old.size);
      assert.equal(sha256(rom), old.romSha, 'S3a-I: the ROM must be byte-identical to the parent build');
      assert.equal(namesHash(syms), old.namesSha, 'and so is its symbol table');
      assert.deepEqual(added, [], 'no S3a label may exist');
      for (const name of ['move_tick_streamed', 'move_tick_ordinary']) assert.equal(syms[name], undefined, `${name}: no delegation`);
      return;
    }

    // ---- S3a-D: U and M
    assert.equal(rom.length, old.size, 'the cartridge stays the same size');
    assert.deepEqual(retired, [], 'nothing of the retired Move probe may be assembled');
    assert.deepEqual(added.sort(), [...ADDED].sort(), 'every label the slice adds is assembled');
    // the symbol diff is exactly the expected added/removed set: undo it and the parent's names come back
    const restored = Object.fromEntries(Object.keys(syms).filter((n) => !ADDED.includes(n)).map((n) => [n, 0]));
    for (const name of REMOVED) restored[name] = 0;
    assert.equal(namesHash(restored), old.namesSha, 'the symbol names must be the parent\'s plus/minus exactly the slice\'s own labels');
    // each region moved by (new allowance - the parent's): kernel-lo by -34, kernel-hi by -56 at the time of writing
    assert.equal(syms.music_tick_loop - old.klAnchor, STREAMWORLD_MOVE_KERNEL_ALLOWANCE - PARENT_MOVE_KL, 'kernel-lo growth');
    assert.equal(syms.sw_redraw_screen_landing_end - old.khAnchor, STREAMWORLD_MOVE_KERNEL_HI_ALLOWANCE - PARENT_MOVE_KH, 'kernel-hi growth');

    // the delegation span: its size, and its bytes counted from the ROM
    assert.equal(syms.move_tick_ordinary - syms.move_tick_streamed, DELEGATION_SPAN, 'the delegation span');
    const lo = (a) => a & 0xff;
    const hi = (a) => a >> 8;
    const from = kernelFileOffset(rom, syms.move_tick_streamed);
    const span = [...rom.slice(from, from + DELEGATION_SPAN)];
    const count = (...bytes) => {
      let n = 0;
      for (let i = 0; i + bytes.length <= span.length; i++) if (bytes.every((b, k) => span[i + k] === b)) n++;
      return n;
    };
    for (const dir of ['down', 'up', 'left', 'right']) {
      assert.equal(count(JSR, lo(syms[`sw_pstep_${dir}`]), hi(syms[`sw_pstep_${dir}`])), 1, `exactly one jsr sw_pstep_${dir}`);
    }
    assert.equal(count(JSR, lo(syms.sw_frame_camera_window), hi(syms.sw_frame_camera_window)), 1, 'exactly one jsr sw_frame_camera_window');
    assert.equal(count(INC_ABS, ...NOCROSS), 1, 'sw_step_nocross is raised once');
    assert.equal(count(DEC_ABS, ...NOCROSS), 1, 'and lowered once');
    // the four guards: inside each sw_pstep_<dir>, one `lda sw_step_nocross / bne <its own refuse label>`
    const refuse = { right: 'sw_pr_refuse', left: 'sw_pl_refuse', down: 'sw_pd_refuse', up: 'sw_pu_refuse' };
    for (const [dir, label] of Object.entries(refuse)) {
      const start = kernelFileOffset(rom, syms[`sw_pstep_${dir}`]);
      const end = kernelFileOffset(rom, syms[label]) + 1;
      assert.ok(end > start, `${label} lies after sw_pstep_${dir}`);
      const hits = [];
      for (let i = start; i + 4 < end; i++) {
        if (rom[i] === LDA_ABS && rom[i + 1] === NOCROSS[0] && rom[i + 2] === NOCROSS[1]) hits.push(i);
      }
      assert.equal(hits.length, 1, `exactly one guard in sw_pstep_${dir}`);
      const at = hits[0];
      assert.equal(rom[at + 3], BNE, `${dir}: the guard is a bne`);
      const target = syms[`sw_pstep_${dir}`] + (at - start) + 5 + ((rom[at + 4] << 24) >> 24);
      assert.equal(target, syms[label], `${dir}: the guard branches to ${label}`);
      assert.equal(rom[kernelFileOffset(rom, syms[label])], 0x60, `${label} is an rts`);
    }
  });
}
