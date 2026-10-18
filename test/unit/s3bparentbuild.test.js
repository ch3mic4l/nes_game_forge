// The S3b identity baseline's parent build, end to end, in one RPG shape (equipment C6a, review N1).
//
// test/fixtures/identity/S3b.json is "the parent 15c11b7 plus the levers": test/lib/build_identity_baseline.mjs archives the parent's
// tree, lifts the CURRENT battle/input/save/stream engine files into it, and builds every shape with the parent's own pipeline. The
// lift of battle.asm / battleturn.asm carries `.if EQUIP_ENABLED` blocks whose flags only the CURRENT generator writes, so since
// equipment C2/C3 the parent's constants.asm needs carryEquipOffConstants or the lifted tree stops assembling. That broke SILENTLY
// at C2/C3: nothing built the parent tree again, and the committed S3b.json kept passing. This test builds ONE rpg shape from a
// `git archive` of the parent with exactly the S3b levers (the generator's order) and compares it to the committed entry, and proves
// the negative: the same tree without carryEquipOffConstants fails to assemble.
//
// It never regenerates S3b.json and builds one shape, not forty. It does not skip when the parent commit is unreachable (a shallow
// clone): it fails with a message, because a skipped baseline check is a baseline nobody checked.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { SHAPES, buildShapeProject } from '../lib/identityshapes.js';
import { carryOverrunLever, carryOverrunConstants, carryEntityPassLever, carrySaveRangeLever, carryBattleInputLever, carryEquipOffConstants } from '../lib/enginehistory.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PARENT = '15c11b7';
const BASELINE = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/identity/S3b.json'), 'utf8'));
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const SHAPE = SHAPES.find((s) => s.desc.game === 'rpg');

/** A `git archive` of the parent with the S3b levers applied, in the order build_identity_baseline.mjs applies them. */
function parentTree({ equipOffConstants }) {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 's3b-parent-'));
  const tarball = path.join(tree, 'parent.tar');
  execFileSync('git', ['archive', '--format=tar', '-o', tarball, PARENT, 'engine', 'main', 'shared', 'package.json'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync('tar', ['-xf', tarball, '-C', tree]);
  fs.rmSync(tarball);
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tree, 'node_modules'), 'dir');
  const at = (name) => path.join(tree, 'engine', name);
  const cur = (name) => fs.readFileSync(path.join(ROOT, 'engine', name), 'utf8');
  const own = (name) => fs.readFileSync(at(name), 'utf8');
  // --carry-overrun
  fs.writeFileSync(at('streamworld.asm'), carryOverrunLever(own('streamworld.asm'), cur('streamworld.asm')));
  fs.writeFileSync(at('streamdialog.asm'), cur('streamdialog.asm'));
  fs.writeFileSync(at('constants.asm'), carryOverrunConstants(own('constants.asm'), cur('constants.asm')));
  // --carry-entitypass
  const entity = carryEntityPassLever(own('entities.asm'), cur('entities.asm'), own('rpg.asm'), cur('rpg.asm'));
  fs.writeFileSync(at('entities.asm'), entity.entities);
  fs.writeFileSync(at('rpg.asm'), entity.rpg);
  // --carry-saverange
  const range = carrySaveRangeLever(own('save.asm'), cur('save.asm'), own('streamworld.asm'), cur('streamworld.asm'));
  fs.writeFileSync(at('save.asm'), range.save);
  fs.writeFileSync(at('streamworld.asm'), range.streamworld);
  // --carry-battleinput
  fs.writeFileSync(at('input.asm'), carryBattleInputLever(own('input.asm'), cur('input.asm')));
  // --carry-backdrop
  for (const name of ['battle.asm', 'battleturn.asm']) fs.writeFileSync(at(name), cur(name));
  // --carry-equipoff
  if (equipOffConstants) fs.writeFileSync(at('constants.asm'), carryEquipOffConstants(own('constants.asm')));
  return tree;
}

async function buildShape(tree) {
  const { buildProject } = await import(pathToFileURL(path.join(tree, 'main/build/pipeline.js')));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's3b-shape-'));
  try {
    const project = buildShapeProject(SHAPE.desc);
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    return new Uint8Array(fs.readFileSync(built.romPath));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const skip = !hasNesasm && 'nesasm not found on PATH';

test('the S3b parent commit is reachable (a shallow clone fails here, loudly, instead of skipping the parent build)', () => {
  const probe = spawnSync('git', ['cat-file', '-e', `${PARENT}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
  assert.equal(probe.status, 0, `git history lacks ${PARENT}, the S3b parent: fetch full history, the baseline build cannot be checked without it`);
  assert.equal(BASELINE.parentRev.slice(0, PARENT.length), PARENT, 'the committed baseline names this parent');
  assert.match(BASELINE.carries, /\+equipoff\b/, 'the committed baseline carries the equipment-off constants');
});

test('the parent tree with the S3b levers builds the first rpg shape to the committed S3b entry', { skip }, async () => {
  const tree = parentTree({ equipOffConstants: true });
  try {
    const rom = await buildShape(tree);
    const entry = BASELINE.shapes[SHAPE.id];
    assert.ok(entry, `S3b.json has an entry for ${SHAPE.id}`);
    assert.equal(Buffer.from(rom.subarray(0, 4)).toString('latin1'), 'NES\x1a', 'an iNES ROM came out');
    assert.equal(rom.length, entry.size, 'the ROM is the size the baseline recorded');
    assert.equal(crypto.createHash('sha256').update(rom).digest('hex'), entry.romSha, 'and it is the baseline\'s ROM');
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
  }
});

test('without carryEquipOffConstants the lifted parent tree does not assemble (the C2/C3 silent break)', { skip }, async () => {
  const tree = parentTree({ equipOffConstants: false });
  try {
    await assert.rejects(() => buildShape(tree), /battle(turn)?\.asm:\d+: Undefined symbol/, 'the lifted battle files name EQUIP_ENABLED, which the parent constants.asm never defines');
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
  }
});
