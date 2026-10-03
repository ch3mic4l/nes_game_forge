// Large streamed worlds (ROADMAP item 15), phase 3a slice S3a.5: sw_camera_window_recompute is O(1).
//
// The routine used to derive camScreenRow/camLocalPxY and the desired window row with two
// repeated-subtract loops, one iteration per world row, every frame. It now derives them from
// player_y directly. This file is the permanent guard for that: the expected values come from the
// camera rule written out in test/lib/streamcamera.js (never from the routine, never from a second copy
// of it), the routine is driven in isolation through callRoutine, and one assertion pins its cost
// flat in the row -- the only thing that would notice the loops coming back, since they compute the
// same values.
//
// The grid here is a reduced one (about 79k Y cases and 8.4k X cases); the exhaustive grid (every height
// 1..255, every row, every player_y: 8,355,840 cases, about three minutes) is a one-off run through the
// same rig (handoff-next/s3a5/exhaustive.mjs), not part of `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ADDR, bootCameraRig, expectedCamera, firstMismatch, runCamera } from '../lib/streamcamera.js';

let rigPromise;
const rig = () => (rigPromise ??= bootCameraRig());

const unique = (list, lo, hi) => [...new Set(list)].filter((v) => v >= lo && v <= hi).sort((a, b) => a - b);

// Heights chosen to hit every boundary of the clamp: one screen (no window clamp at all), two (ceiling 0),
// three, small heights up to 8, around the 16/32 shift boundaries and a spread to the 255 maximum.
const HEIGHTS = [...Array.from({ length: 24 }, (_, i) => i + 1), 30, 31, 32, 33, 60, 61, 62, 63, 100, 127, 128, 129, 150, 200, 240, 253, 254, 255];
const rowsFor = (h) => unique([0, 1, 2, h >> 1, (h >> 1) + 1, h - 3, h - 2, h - 1], 0, h - 1);

test('the camera outputs match the independent camera rule at every player_y, over a spread of grid heights and rows', async () => {
  const r = await rig();
  let cases = 0;
  for (const gridH of HEIGHTS) {
    for (const row of rowsFor(gridH)) {
      for (let py = 0; py < 256; py++) {
        // X fixed at a mid-grid, mid-screen position so the X outputs are checked on every Y case too.
        const input = { gridW: 3, gridH, col: 1, row, px: 100, py };
        const bad = firstMismatch(r, input);
        assert.equal(bad, null, bad ?? '');
        cases++;
      }
    }
  }
  assert.ok(cases > 70000, `the reduced Y grid should be about 79k cases, ran ${cases}`);
});

test('the player_y 111/112 split and every camLocalPxY>>4 = 6/7 boundary are hit on a deep row', async () => {
  // At row 58 of 61, camPy = 58*240 + py - 112: py = 111 is the last pixel on the row above (local 239),
  // py = 112 the first on this row (local 0). Within this row local = py - 112, so camLocalPxY>>4 crosses 6 -> 7 at
  // local 112, i.e. py = 223 -> 224 (both are in the list below; 207/208 are only local block 5/6's neighbours) --
  // all asserted against the rule, not by hand.
  const r = await rig();
  for (const py of [0, 1, 110, 111, 112, 113, 207, 208, 209, 223, 224, 239, 240, 255]) {
    const input = { gridW: 3, gridH: 61, col: 1, row: 58, px: 100, py };
    assert.equal(firstMismatch(r, input), null);
    const want = expectedCamera(input);
    assert.equal(want.sw_fc_scr, py >= 112 ? 58 : 57, `row split at py=${py}`);
  }
});

test('the X outputs follow the X rule over grid widths, columns and every player_x', async () => {
  const r = await rig();
  let cases = 0;
  for (const gridW of [1, 2, 3, 4, 5, 16, 17, 255]) {
    for (const col of unique([0, 1, 2, gridW >> 1, gridW - 2, gridW - 1], 0, gridW - 1)) {
      for (let px = 0; px < 256; px++) {
        // Y fixed mid-world on a row whose camera row is not 0 or the last, so a Y regression cannot hide here.
        const input = { gridW, gridH: 61, col, row: 30, px, py: 100 };
        const bad = firstMismatch(r, input);
        assert.equal(bad, null, bad ?? '');
        cases++;
      }
    }
  }
  assert.ok(cases > 8000, `the X grid should be about 8.4k cases, ran ${cases}`);
});

test('the routine\'s cost is flat in the world row: no repeated-subtract loop', async () => {
  // The old loops cost, measured at HEAD (worst player_y, 255-high grid, through callRoutine): 1008 cycles at row 1,
  // 5452 at row 58, 20346 at row 254. Every value they compute is also computed by the O(1) code, so the value
  // assertions above cannot see them return -- this one can. The bound is a spread over nine sampled rows (0, 1, 2, 30,
  // 58, 127, 200, 253, 254) of a 255-high grid, each at every player_y, so it does not depend on which player_y is worst.
  const r = await rig();
  const worstAtRow = (row) => {
    let worst = 0;
    for (let py = 0; py < 256; py++) {
      worst = Math.max(worst, runCamera(r, { gridW: 3, gridH: 255, col: 1, row, px: 100, py }).cycles);
    }
    return worst;
  };
  const rows = [0, 1, 2, 30, 58, 127, 200, 253, 254];
  const costs = rows.map(worstAtRow);
  const spread = Math.max(...costs) - Math.min(...costs);
  assert.ok(spread <= COST_SPREAD_BOUND, `worst-case cost must not grow with the row: ${rows.map((x, i) => `row ${x}: ${costs[i]}`).join(', ')} (spread ${spread} > ${COST_SPREAD_BOUND})`);
  assert.ok(Math.max(...costs) <= COST_ABSOLUTE_BOUND, `worst-case cost ${Math.max(...costs)} exceeds ${COST_ABSOLUTE_BOUND}`);
});

test('the hardcoded RAM addresses are what the built constants.asm resolves', async () => {
  const r = await rig();
  for (const [name, addr] of Object.entries(ADDR)) {
    const resolved = r.resolved.get(name);
    assert.ok(resolved !== undefined, `${name} should resolve in the built constants.asm/config.inc`);
    assert.equal(resolved, addr, `${name}: hardcoded $${addr.toString(16)}, built $${resolved.toString(16)}`);
  }
});

// Bounds, set from the measurement in handoff-next/streamed-worlds-phase3a-s3a5-report.md.
const COST_SPREAD_BOUND = 100;
const COST_ABSOLUTE_BOUND = 1000;
