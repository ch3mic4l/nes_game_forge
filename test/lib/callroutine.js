// A stub JSR/NOP pair at $0700 (plain RAM, mirrored from $0000-$07FF, so it is
// executable regardless of which PRG bank is currently mapped), landing PC
// one byte before it so the very first emulate() step fetches the JSR. Used
// to unit-test a single routine's own contract without driving the whole
// game loop up to the exact frame that would reach it.
//
// Lifted out of test/unit/rpg.test.js (its original home) once a second file
// (test/unit/camera.test.js) needed the identical stub -- CLAUDE.md's own
// single-writer discipline applied to a test helper: two independent copies
// of "how to call one engine routine in isolation" could silently drift
// (a fixed NMI-disable step here, an extra one there) with nothing to catch
// the divergence.

import assert from 'node:assert/strict';

export function callRoutine(nes, address) {
  nes.mmap.write(0x2000, 0); // NMI generation off -- a stray NMI mid-stub would
                              // both divert PC and inflate the returned cycle count
  nes.cpu.irqRequested = false;
  nes.cpu.F_INTERRUPT = 1; // and IRQ must not land mid-stub either
  nes.cpu.mem.set([0x20, address & 255, address >> 8, 0xea], 0x700);
  nes.cpu.REG_PC = 0x6ff;
  let cycles = 0;
  let steps = 0;
  while ((nes.cpu.REG_PC + 1) !== 0x703) {
    cycles += nes.cpu.emulate();
    assert.ok(++steps < 20000, 'routine never returned to the stub');
  }
  return cycles;
}
