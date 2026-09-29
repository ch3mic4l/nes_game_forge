// The identity matrix (handoff-next/streamed-worlds-phase3a-plan.md §6.4): generated project shapes
// (test/lib/identityshapes.js), each built to a real ROM in mkdtemp and compared with the ROM the
// PARENT commit builds for the same shape (test/fixtures/identity/<slice>.json, made by
// test/lib/build_identity_baseline.mjs from a `git worktree` of that commit).
//
// This file asserts slice S0's identity, S0-I:
//   * a shape with neither Turn nor Move assembles byte-identical to the parent's ROM, and has no
//     move_face symbol at all;
//   * a shape with Turn or Move (Move-only included) differs by move_face's +24 bytes and nothing
//     else -- structurally: the 24 new bytes are the clamp's machine code, the ROM with them
//     blanked equals the parent built with 24 padding bytes at the same place (so every relocated
//     operand is nesasm's own), the symbol table equals that padded build's, and move_face's span
//     grew by exactly FACE_KERNEL_ALLOWANCE's delta.
//
// The expected outcome of every shape is the hand-written TRUTH table below. It is deliberately not
// computed from projectUsesFace/projectUsesTurn or any generator predicate (a predicate bug must
// not agree with its own oracle); the last test cross-checks it against the parent's own assembled
// symbol table instead. S2 adds the handover-flag axis to identityshapes.js and its rows here.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { FACE_KERNEL_ALLOWANCE } from '../../main/build/generate.js';
import { SHAPES, buildShapeProject } from '../lib/identityshapes.js';
import { sha256, parseFns, symbolsHash, kernelFileOffset, blankedHash, expectedClamp, CLAMP_BYTES } from '../lib/identitycompare.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/identity/S0.json'), 'utf8'));

// Hand-written: does the shape use Turn or Move (so assemble move_face)? Same rows for both game types.
const TRUTH = {
  'base': 'identical',
  'U-noA': 'identical',
  'U-A': 'identical',
  'move-npc': 'face',
  'move-player-ord': 'face',
  'move-player-str': 'face',
  'text': 'identical',
  'save': 'identical',
  'turn': 'face',
  'visible': 'identical',
  'turn+move-npc': 'face',
  'U-noA+turn': 'face',
  'U-A+turn': 'face',
  'U-A+move-npc+text': 'face',
  'U-noA+move-npc': 'face',
  'all-toggles+move-npc': 'face',
  'U-A+text+visible': 'identical',
  'U-noA+text+save+visible': 'identical',
  'move-player-ord+turn+text': 'face',
  'move-player-str+turn+text+visible': 'face'
};
const truthFor = (id) => TRUTH[id.slice(id.indexOf(':') + 1)];

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
    ids.sort(),
    games.flatMap((g) => Object.keys(TRUTH).map((k) => `${g}:${k}`)).sort(),
    'the truth table has a row no shape builds'
  );
  assert.deepEqual(Object.keys(baseline.shapes).sort(), ids.sort());
  assert.equal(baseline.baselineFaceAllowance, 13);
  assert.equal(SHAPES.filter((s) => truthFor(s.id) === 'face').length >= 20, true);
});

test('the hand-written truth table agrees with what the parent commit itself assembled', () => {
  // independent of every generator predicate: a shape assembles move_face in the parent iff the
  // baseline recorded move_face's address for it
  for (const shape of SHAPES) {
    const recorded = baseline.shapes[shape.id].oldMoveFace !== undefined;
    assert.equal(recorded, truthFor(shape.id) === 'face', `${shape.id}: the parent ${recorded ? 'assembled' : 'did not assemble'} move_face`);
  }
});

for (const shape of SHAPES) {
  test(`S0-I ${shape.id}: ${truthFor(shape.id) === 'face' ? 'differs by the move_face clamp alone' : 'byte-identical to the parent'}`, boots, async () => {
    const old = baseline.shapes[shape.id];
    const { rom, syms } = await build(shape);
    if (truthFor(shape.id) === 'identical') {
      assert.equal(syms.move_face, undefined, 'no move_face may be assembled without Turn or Move');
      assert.equal(rom.length, old.size);
      assert.equal(sha256(rom), old.romSha, 'the ROM must be byte-identical to the parent build');
      return;
    }
    assert.equal(rom.length, old.paddedSize);
    assert.equal(rom.length, old.size);
    // the clamp is exactly the hand-assembled machine code, at move_face_done - 24
    assert.ok(syms.move_face_done !== undefined, 'move_face_done must exist');
    const at = kernelFileOffset(rom, syms.move_face_done - CLAMP_BYTES);
    assert.deepEqual([...rom.slice(at, at + CLAMP_BYTES)], [...expectedClamp(syms)], 'the 24 inserted bytes must be the clamp');
    // and everything else is the parent's, relocated by nesasm itself
    assert.equal(blankedHash(rom, at), old.blankedSha, 'the ROM with the clamp blanked must equal the parent built with 24 padding bytes there');
    assert.equal(symbolsHash(syms), old.symbolsSha, 'the symbol table must be the parent\'s shifted by the insertion, plus move_face_done');
    // move_face itself: same start, span grown by exactly the allowance delta
    assert.equal(syms.move_face, old.oldMoveFace);
    const grown = (syms.move_face_player - syms.move_face) - (old.oldMoveFacePlayer - old.oldMoveFace);
    assert.equal(grown, CLAMP_BYTES);
    assert.equal(grown, FACE_KERNEL_ALLOWANCE - baseline.baselineFaceAllowance, 'the span growth must equal the FACE_KERNEL_ALLOWANCE delta');
  });
}
