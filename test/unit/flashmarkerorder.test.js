// The invariant that makes the *programming* half of UNROM 512's un-atomic
// flash commit safe (phase 2.4's own closing note, CLAUDE.md): SAVE_MARKER
// is the record's last byte, and engine/flash.asm's program loop writes it
// last of all, so a commit torn once the sector's erase has already
// finished leaves the marker still $FF and the next boot reads "no save"
// rather than "corrupt save". This does not cover a tear during the erase
// itself -- by duration the larger part of that commit (engine/flash.asm's
// own header has the numbers), not a brief prelude to it -- which is a
// different risk (the old marker can survive over a partially-erased body;
// save_check_valid's identity/checksum/range gates are the defence there,
// and engine/save.asm's own header already says plainly that defence is
// not a proof) -- so what this file actually
// pins is narrower than "torn commit, never corrupt": it is that marker-last
// works, specifically for the programming phase, because two independent
// facts happen to agree: main/build/generate.js's record layout puts the
// marker at the end, and engine/flash.asm's loop counts up. Neither is
// enforced anywhere else, so this file is what actually pins it -- one test
// per fact, plus this file's own header record of the negative controls run
// by hand while writing it (see the two blocks below; neither reversal is
// checked in, since a real reversal is exactly what these tests must fail
// against).
//
// Negative control 1 (JS-side, run by hand): changed
// main/build/generate.js's `SAVE_MARKER = $...` line from
// `SAVE_BASE + saveBodyLen + 6` to `SAVE_BASE + 0`, rebuilt the throwaway
// project this file already builds, and reran the first test below. It
// failed on the assertion itself -- "SAVE_MARKER must be the record's last
// byte (base=1792 marker=1792 recordLen=87)" -- not a crash, not a
// different test, exactly the offset comparison this test exists to make.
// Reverted before rerunning the suite.
//
// Negative control 2 (asm-side, run by hand): changed
// engine/flash.asm's fd_program_loop from `ldx #0` / `inx` / `cpx
// #SAVE_RECORD_LEN` / `bne` (ascending) to `ldx #(SAVE_RECORD_LEN-1)` /
// `dex` / `bpl` (descending), rebuilt sample-rpg on UNROM 512 with a live
// Save, and reran the second test below. It failed on the ordering
// assertion -- the recorded chip-address sequence started at the marker's
// own offset (86) and ended at offset 0, the exact opposite of what was
// asserted -- not a crash, not a timeout. Reverted before rerunning the
// suite.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const START = 3;
const RIGHT = 7;

// See flashsave.test.js's own comment on why this is hand-sourced from a
// real build rather than read back out of the build under test for THIS
// value specifically -- SAVE_RECORD_LEN is used below only to size the
// expected ascending sequence for the second test, which already reads its
// other operand (the actual programmed offsets) from real execution; the
// first test below reads SAVE_RECORD_LEN itself out of the generated file,
// which is the one place retyping it would defeat the point.
const SAVE_BANK = 30;
const SECTOR_OFFSET = 0x3000;
const SAVE_RECORD_LEN = 87;

/** Build a throwaway UNROM 512 project (mapper swap only, sample-rpg's own project.json untouched) and return its build directory. */
async function buildU512(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-flashmarkerorder-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = 30; // UNROM 512
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return { dir, romPath: built.romPath };
}

/**
 * sample-rpg on UNROM 512 with a touch-triggered saver a few steps from the
 * start, same shape as flashsave.test.js's own buildFlashSaveable -- not
 * imported from there because that file does not export it, and this is the
 * kind of small, single-purpose duplication tools/sample-common.js's own
 * header already argues for over a shared module two call sites would only
 * lightly disagree about later.
 */
async function buildFlashSaveable(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-flashmarkerorder-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE_RPG);
  project.cartridge.mapper = 30;
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.maps[0].encounters = { rate: 0, actorIds: [] };
  const saverId = project.sprites.actors.length;
  project.sprites.actors.push({ name: 'Saver', behavior: 'npc', hp: 1, damage: 0 });
  project.maps[0].screens[0].entities.push({
    actorId: saverId,
    x: 64,
    y: 96,
    props: {
      trigger: 'touch',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] }
    }
  });
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return built.romPath;
}

function boot(romPath, frames = 60) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  return nes;
}

const tap = (nes, button, frames = 10) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
};

function touchFlashSaver(nes) {
  for (let i = 0; i < 400; i++) {
    const dx = 64 - nes.cpu.mem[PLAYER_X];
    const dy = 96 - nes.cpu.mem[PLAYER_Y];
    let button = null;
    if (dx > 1) button = RIGHT;
    else if (dx < -1) button = 6;
    else if (dy > 1) button = 5;
    else if (dy < -1) button = 4;
    if (button === null) break;
    nes.buttonDown(1, button);
    nes.frame();
    nes.buttonUp(1, button);
  }
  for (let i = 0; i < 10; i++) nes.frame(); // let the step that touched it settle to a stop
}

test(
  "SAVE_MARKER is the flash save record's final byte",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const { dir } = await buildU512(t);
    // assets/save.inc is emitted unconditionally (main/build/generate.js's
    // own comment on why: "the labels cost nothing unreferenced"), so this
    // needs no live Save command at all -- just a flash-capable build.
    // SAVE_RECORD_LEN is a config.inc equate (emitted alongside SAVE_BANK),
    // not a save.inc one -- SAVE_BASE and SAVE_MARKER are save.inc's own.
    const inc = await fs.promises.readFile(path.join(dir, 'build/assets/save.inc'), 'utf8');
    const config = await fs.promises.readFile(path.join(dir, 'build/assets/config.inc'), 'utf8');
    const base = parseInt(inc.match(/^SAVE_BASE = \$([0-9A-F]+)$/m)?.[1] ?? '', 16);
    const marker = parseInt(inc.match(/^SAVE_MARKER = \$([0-9A-F]+)$/m)?.[1] ?? '', 16);
    const recordLen = parseInt(config.match(/^SAVE_RECORD_LEN = (\d+)$/m)?.[1] ?? '', 10);
    assert.ok(Number.isFinite(base) && Number.isFinite(marker) && Number.isFinite(recordLen), 'failed to parse assets/save.inc');
    assert.equal(
      marker - base,
      recordLen - 1,
      `SAVE_MARKER must be the record's last byte (base=${base} marker=${marker} recordLen=${recordLen})`
    );
  }
);

test(
  'the flash program loop writes the record in strictly ascending offset order, marker last',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async (t) => {
    const romPath = await buildFlashSaveable(t);
    const nes = boot(romPath);
    tap(nes, START);

    // Spy on the one place every flash byte program actually lands
    // (mapper30.js's own programFlashByte) rather than on anything in
    // engine/flash.asm's source text -- this is what makes the assertion
    // below an *execution-order* property instead of a shape-of-the-source
    // one: a legitimate refactor of the loop (a different register, an
    // unrolled step) still has to write the chip in the same real order to
    // pass, and a genuine reversal fails regardless of how it is written.
    const calls = [];
    const original = nes.mmap.programFlashByte.bind(nes.mmap);
    nes.mmap.programFlashByte = (chipAddr, value, erase) => {
      calls.push({ chipAddr, erase });
      return original(chipAddr, value, erase);
    };

    touchFlashSaver(nes);

    const chipBase = SAVE_BANK * 16384 + SECTOR_OFFSET;
    const recordProgramOffsets = calls
      .filter((c) => !c.erase && c.chipAddr >= chipBase && c.chipAddr < chipBase + SAVE_RECORD_LEN)
      .map((c) => c.chipAddr - chipBase);

    const expected = Array.from({ length: SAVE_RECORD_LEN }, (_, i) => i);
    assert.deepEqual(
      recordProgramOffsets,
      expected,
      'the record\'s SAVE_RECORD_LEN bytes must be programmed to the chip in strictly ascending offset order, ending on the marker'
    );
  }
);
