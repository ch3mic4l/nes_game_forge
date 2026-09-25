// Fix round 1, finding 5: a shared test-side PC hook at sw_position_jump_guard
// (engine/streamworld.asm), for suites that drive a raw NES instance directly via nes.frame()
// (not the higher-level Emulator wrapper, whose own PC-intercept table this bypasses on purpose --
// see test/unit/testoverrides.test.js's own header for why that file's ROM-driving tests use
// Emulator instead). Wraps nes.cpu.emulate() (jsnes's own single-instruction step, which
// nes.frame() calls repeatedly under the hood) to notice every instant PC reads the guard's own
// entry address -- REG_PC is one less than the real instruction address until the opcode fetch
// (renderer/emulator/core/cpu.js's own `this.REG_PC + 1` convention, matched here and by
// test/unit/camera.test.js's own runToLabel) -- without altering control flow at all, so it is
// safe to leave watching across an arbitrarily long, ordinary sequence of nes.frame() calls.
//
// The guard exists to rescue a window that has already fallen behind by 6+ blocks; a test proving
// ORDINARY movement/strip/knockback/landing stays within budget should see zero entries, and must
// say so explicitly (assertNone) rather than merely not crashing. A test that deliberately drives
// a scenario the guard is meant to catch (phase 2 slice 6's own former rate-8/rate-9 negative
// controls in test/unit/streamworldmove.test.js) opts in instead, by reading count() itself.

import assert from 'node:assert/strict';

/**
 * @param {import('../../renderer/emulator/core/nes.js').default} nes
 * @param {string} symbols raw game.fns text, as buildAndBoot's own callers already read it
 * @returns {{ count: () => number, assertNone: (label: string) => void, unwatch: () => void }}
 */
export function watchPositionJumpGuard(nes, symbols) {
  const m = symbols.match(/^sw_position_jump_guard\s*=\s*\$([0-9A-Fa-f]+)/m);
  if (!m) throw new Error('sw_position_jump_guard should be a named symbol in game.fns');
  const guardAddr = parseInt(m[1], 16);
  const original = nes.cpu.emulate.bind(nes.cpu);
  let hits = 0;
  nes.cpu.emulate = function watchedEmulate() {
    if (nes.cpu.REG_PC + 1 === guardAddr) hits++;
    return original();
  };
  let unwatched = false;
  return {
    count() {
      return hits;
    },
    assertNone(label) {
      assert.equal(hits, 0, `${label}: sw_position_jump_guard fired ${hits} time(s) during ordinary movement -- the window fell behind its budget without the deliberate scenario this guard is meant to catch`);
    },
    unwatch() {
      if (!unwatched) {
        nes.cpu.emulate = original;
        unwatched = true;
      }
    }
  };
}
