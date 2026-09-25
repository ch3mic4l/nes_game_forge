// Large streamed worlds (ROADMAP item 15), phase 2 slice 6, fix round 2 (finding A4): focused
// isolated-routine coverage for engine/streamworld.asm's sw_pjg_lag_trip -- the position-jump
// guard's own per-axis lag/threshold arithmetic (sw_pjg_check calls it once per axis). Round 2's
// own review already exercised this routine against 69,264 real combinations and found it correct;
// this file is the COMMITTED, focused regression for the specific branch/encoding edges the fix2
// brief names by name, kept small and readable rather than an exhaustive sweep.
//
// sw_pjg_lag_trip's own contract (its header comment, engine/streamworld.asm): in sw_tmp/sw_tmp2 =
// one axis's current (screen, local), sw_tmp3/sw_tmp4 = desired (screen, local), sw_tmp5 = that
// axis's own units-per-screen (16 X, 15 Y). Out: A=1 (Z clear) iff |current-desired|, in local
// units, is >= 6; A=0 (Z set) otherwise. No production caller ever passes a real (current, desired)
// pair whose SCREEN values approach 127/128 -- real grids are far smaller -- but the routine's own
// arithmetic is a plain 8-bit subtraction with no range guard, so this file also probes that
// boundary directly: a future caller (or a future real grid this large) must not silently break.
//
// callRoutine (test/lib/callroutine.js) invokes the routine in isolation via a JSR/RTS stub -- no
// game loop, no boot -- so this file loads the ROM once and never calls nes.frame() at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { callRoutine } from '../lib/callroutine.js';
import NES from '../../renderer/emulator/core/nes.js';

// engine/constants.asm -- hardcoded per CLAUDE.md's own rule (a test that reads the file it is
// checking proves nothing).
const SW_TMP = 0x05ab;  // engine/constants.asm:988 -- current screen
const SW_TMP2 = 0x05ac; // engine/constants.asm:989 -- current local
const SW_TMP3 = 0x05ad; // engine/constants.asm:990 -- desired screen
const SW_TMP4 = 0x05ae; // engine/constants.asm:991 -- desired local
const SW_TMP5 = 0x05af; // engine/constants.asm:992 -- units per screen (16 X, 15 Y)

const UNITS_X = 16;
const UNITS_Y = 15;

/** Independent reimplementation of sw_pjg_lag_trip's own 8-bit arithmetic, in plain integer math
 * rather than a transcription of the assembly's own branch shape -- every value is masked back
 * into 0-255 after each step, the same way the real 6502 ALU wraps. */
function u8(x) {
  return ((x % 256) + 256) % 256;
}
function pjgLagTripJS(curScreen, curLocal, desScreen, desLocal, unitsPerScreen) {
  const screenDelta = u8(curScreen - desScreen);
  let raw;
  if (screenDelta === 0) {
    raw = u8(curLocal - desLocal);
  } else if (screenDelta === 1) {
    raw = u8(unitsPerScreen + curLocal - desLocal);
  } else if (screenDelta === 0xff) {
    raw = u8(curLocal - desLocal - unitsPerScreen);
  } else {
    return 1; // |screenDelta| >= 2: over threshold regardless of either local
  }
  const abs = raw < 0x80 ? raw : u8(u8(raw ^ 0xff) + 1); // bpl / eor #$ff, adc #1
  return abs >= 6 ? 1 : 0; // cmp #6 / bcc
}

async function buildHarness(t) {
  const project = createStreamedProject({});
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworldpjglagtrip-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const symbols = fs.readFileSync(built.symbolPath, 'utf8');
  const addrOf = (label) => {
    const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
    assert.ok(m, `${label} should be a named symbol in game.fns`);
    return parseInt(m[1], 16);
  };
  const bytes = new Uint8Array(fs.readFileSync(built.romPath));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(bytes);
  return { addrOf, nes, mem: nes.cpu.mem };
}

/** Calls the real routine with one (current, desired, unitsPerScreen) case and returns its A. */
function callLagTrip(nes, mem, addr, { curScreen, curLocal, desScreen, desLocal, unitsPerScreen }) {
  mem[SW_TMP] = curScreen;
  mem[SW_TMP2] = curLocal;
  mem[SW_TMP3] = desScreen;
  mem[SW_TMP4] = desLocal;
  mem[SW_TMP5] = unitsPerScreen;
  callRoutine(nes, addr);
  return nes.cpu.REG_ACC;
}

/** Runs one case against both the real routine and the independent JS oracle, asserting they
 * agree, and separately asserting the oracle matches the case's own `expect` -- so a wrong
 * oracle and a wrong routine can't silently cancel out. */
function checkCase(nes, mem, addr, label, kase) {
  const oracle = pjgLagTripJS(kase.curScreen, kase.curLocal, kase.desScreen, kase.desLocal, kase.unitsPerScreen);
  assert.equal(oracle, kase.expect, `${label}: independent oracle disagrees with this case's own stated expectation`);
  const real = callLagTrip(nes, mem, addr, kase);
  assert.equal(real, kase.expect, `${label}: sw_pjg_lag_trip returned A=${real}, expected ${kase.expect}`);
}

test('sw_pjg_lag_trip: equal (current == desired) never fires, both axes', async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  const addr = addrOf('sw_pjg_lag_trip');
  for (const unitsPerScreen of [UNITS_X, UNITS_Y]) {
    checkCase(nes, mem, addr, `equal, units=${unitsPerScreen}`, {
      curScreen: 3, curLocal: 7, desScreen: 3, desLocal: 7, unitsPerScreen, expect: 0
    });
  }
});

test('sw_pjg_lag_trip: adjacent screen (+1/-1), both axes, at and around the threshold', async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  const addr = addrOf('sw_pjg_lag_trip');
  for (const unitsPerScreen of [UNITS_X, UNITS_Y]) {
    // current screen = desired + 1: raw = unitsPerScreen + curLocal - desLocal (sw_pjg_lt_pos1).
    // desLocal at the far edge (unitsPerScreen-1), curLocal at 0: raw = units + 0 - (units-1) = 1 -> no.
    checkCase(nes, mem, addr, `+1 screen, minimal lag, units=${unitsPerScreen}`, {
      curScreen: 5, curLocal: 0, desScreen: 4, desLocal: unitsPerScreen - 1, unitsPerScreen, expect: 0
    });
    // desLocal near the far edge such that the wrap-around distance is exactly 5 (no) then 6 (yes).
    checkCase(nes, mem, addr, `+1 screen, lag 5 (endpoint, no), units=${unitsPerScreen}`, {
      curScreen: 5, curLocal: 0, desScreen: 4, desLocal: unitsPerScreen - 5, unitsPerScreen, expect: 0
    });
    checkCase(nes, mem, addr, `+1 screen, lag 6 (endpoint, yes), units=${unitsPerScreen}`, {
      curScreen: 5, curLocal: 0, desScreen: 4, desLocal: unitsPerScreen - 6, unitsPerScreen, expect: 1
    });
    // current screen = desired - 1: raw = curLocal - desLocal - unitsPerScreen (sw_pjg_lt_neg1).
    checkCase(nes, mem, addr, `-1 screen, minimal lag, units=${unitsPerScreen}`, {
      curScreen: 4, curLocal: unitsPerScreen - 1, desScreen: 5, desLocal: 0, unitsPerScreen, expect: 0
    });
    checkCase(nes, mem, addr, `-1 screen, lag 5 (endpoint, no), units=${unitsPerScreen}`, {
      curScreen: 4, curLocal: unitsPerScreen - 5, desScreen: 5, desLocal: 0, unitsPerScreen, expect: 0
    });
    checkCase(nes, mem, addr, `-1 screen, lag 6 (endpoint, yes), units=${unitsPerScreen}`, {
      curScreen: 4, curLocal: unitsPerScreen - 6, desScreen: 5, desLocal: 0, unitsPerScreen, expect: 1
    });
  }
});

test('sw_pjg_lag_trip: distant screens (|delta| >= 2) always fire regardless of either local', async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  const addr = addrOf('sw_pjg_lag_trip');
  for (const unitsPerScreen of [UNITS_X, UNITS_Y]) {
    // Locals set EQUAL to each other -- if the routine wrongly fell through to the same-screen
    // branch on a screen delta of 2, this would wrongly read "no" instead of "yes".
    checkCase(nes, mem, addr, `+2 screens, equal locals, units=${unitsPerScreen}`, {
      curScreen: 6, curLocal: 3, desScreen: 4, desLocal: 3, unitsPerScreen, expect: 1
    });
    checkCase(nes, mem, addr, `-2 screens, equal locals, units=${unitsPerScreen}`, {
      curScreen: 4, curLocal: 3, desScreen: 6, desLocal: 3, unitsPerScreen, expect: 1
    });
    checkCase(nes, mem, addr, `+40 screens (large), units=${unitsPerScreen}`, {
      curScreen: 90, curLocal: 0, desScreen: 50, desLocal: 0, unitsPerScreen, expect: 1
    });
  }
});

test('sw_pjg_lag_trip: carry/borrow through the local subtraction (same screen)', async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  const addr = addrOf('sw_pjg_lag_trip');
  for (const unitsPerScreen of [UNITS_X, UNITS_Y]) {
    // curLocal - desLocal borrows (curLocal < desLocal): |0 - (unitsPerScreen-1)| = unitsPerScreen-1,
    // always >= 6 for both real axes (15/16) -- exercises the eor/adc two's-complement negate path.
    checkCase(nes, mem, addr, `same screen, borrow, large negative, units=${unitsPerScreen}`, {
      curScreen: 2, curLocal: 0, desScreen: 2, desLocal: unitsPerScreen - 1, unitsPerScreen,
      expect: 1
    });
    // A borrow that still lands under the threshold: curLocal=2, desLocal=6 -> raw=-4, abs=4 -> no.
    checkCase(nes, mem, addr, `same screen, borrow, small negative (no), units=${unitsPerScreen}`, {
      curScreen: 2, curLocal: 2, desScreen: 2, desLocal: 6, unitsPerScreen, expect: 0
    });
    // Both endpoints through a borrow: abs 5 (no) and abs 6 (yes).
    checkCase(nes, mem, addr, `same screen, borrow, abs 5 (endpoint, no), units=${unitsPerScreen}`, {
      curScreen: 2, curLocal: 1, desScreen: 2, desLocal: 6, unitsPerScreen, expect: 0
    });
    checkCase(nes, mem, addr, `same screen, borrow, abs 6 (endpoint, yes), units=${unitsPerScreen}`, {
      curScreen: 2, curLocal: 1, desScreen: 2, desLocal: 7, unitsPerScreen, expect: 1
    });
    // No borrow (curLocal >= desLocal), same screen, at both endpoints.
    checkCase(nes, mem, addr, `same screen, no borrow, abs 5 (endpoint, no), units=${unitsPerScreen}`, {
      curScreen: 2, curLocal: 7, desScreen: 2, desLocal: 2, unitsPerScreen, expect: 0
    });
    checkCase(nes, mem, addr, `same screen, no borrow, abs 6 (endpoint, yes), units=${unitsPerScreen}`, {
      curScreen: 2, curLocal: 8, desScreen: 2, desLocal: 2, unitsPerScreen, expect: 1
    });
  }
});

test('sw_pjg_lag_trip: screen values around the 127/128 signed-byte boundary', async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  const addr = addrOf('sw_pjg_lag_trip');
  for (const unitsPerScreen of [UNITS_X, UNITS_Y]) {
    // Equal screens, both sides of the boundary -- must still read "equal" (screenDelta = 0 in
    // 8-bit unsigned arithmetic regardless of whether 127/128 would be negative as a signed byte).
    checkCase(nes, mem, addr, `screen 127, equal, units=${unitsPerScreen}`, {
      curScreen: 127, curLocal: 2, desScreen: 127, desLocal: 2, unitsPerScreen, expect: 0
    });
    checkCase(nes, mem, addr, `screen 128, equal, units=${unitsPerScreen}`, {
      curScreen: 128, curLocal: 2, desScreen: 128, desLocal: 2, unitsPerScreen, expect: 0
    });
    // current=128, desired=127 -- screenDelta = u8(128-127) = 1 -> the pos1 branch, straddling the
    // boundary from the unsigned-arithmetic side (128-127 is NOT a signed-byte-adjacent pair, but
    // the routine's own u8 subtraction treats it identically to any other +1 case).
    checkCase(nes, mem, addr, `128 vs 127 (+1, minimal lag), units=${unitsPerScreen}`, {
      curScreen: 128, curLocal: 0, desScreen: 127, desLocal: unitsPerScreen - 1, unitsPerScreen,
      expect: 0
    });
    checkCase(nes, mem, addr, `128 vs 127 (+1, lag 6, yes), units=${unitsPerScreen}`, {
      curScreen: 128, curLocal: 0, desScreen: 127, desLocal: unitsPerScreen - 6, unitsPerScreen,
      expect: 1
    });
    // current=127, desired=128 -- screenDelta = u8(127-128) = 0xff -> the neg1 branch.
    checkCase(nes, mem, addr, `127 vs 128 (-1, minimal lag), units=${unitsPerScreen}`, {
      curScreen: 127, curLocal: unitsPerScreen - 1, desScreen: 128, desLocal: 0, unitsPerScreen,
      expect: 0
    });
    checkCase(nes, mem, addr, `127 vs 128 (-1, lag 6, yes), units=${unitsPerScreen}`, {
      curScreen: 127, curLocal: unitsPerScreen - 6, desScreen: 128, desLocal: 0, unitsPerScreen,
      expect: 1
    });
    // Distant across the boundary (|delta| >= 2) -- always fires.
    checkCase(nes, mem, addr, `126 vs 129 (distant across 127/128), units=${unitsPerScreen}`, {
      curScreen: 126, curLocal: 4, desScreen: 129, desLocal: 4, unitsPerScreen, expect: 1
    });
    // Wraparound pair (0 and 255) -- screenDelta = u8(0-255) = 1 -> pos1 branch, the routine's own
    // documented "exact for small screen indices" claim does NOT hold here (255 is not a real grid
    // column), but this pins the actual 8-bit-wraparound behaviour rather than leaving it unpinned.
    checkCase(nes, mem, addr, `screen 0 vs 255 (8-bit wraparound, minimal lag), units=${unitsPerScreen}`, {
      curScreen: 0, curLocal: 0, desScreen: 255, desLocal: unitsPerScreen - 1, unitsPerScreen,
      expect: 0
    });
  }
});
