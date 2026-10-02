// Phase 3a slice S3a (handoff-next/streamed-worlds-phase3a-plan.md §7 S3a, §4.1): a scripted
// player `Move` on a streamed map tracks the camera (F6) and takes its step through the shared
// `sw_pstep_*` driver.
//
// Before S3a nothing advanced the camera window while the world was frozen for a `Move`: the 200-px
// Move of the review's scratch run left sw_cam_origin_x at 0 and the PPU scroll at 0 for the whole
// walk (no strip ever armed). T1/T1v are the test that would have caught it. They read, every frame,
// the independent expectation of the camera origin (the design's one formula per axis, written out
// here -- not read from the engine), the scroll the PPU actually holds, the strip/window state and
// the terrain under the viewport.
//
// B5 (review 3): a 200-pixel command from x = 100 covers 154 px of ONE screen (the ownership stop
// ends it at x = 255); what T1 exercises is scroll and completed strips within a screen. T1v spans the
// screen's full vertical extent within one 240-px camera window. Multi-window travel is S3b's.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  A, DIR, SW_SPEED_SUB_X, SW_SPEED_SUB_Y, terrainProject, buildBoot, awaitMoveStart, snapshot, torusOf,
  viewportMismatches, simulateAcc, doubleFirstResidue
} from '../lib/streamedmovecam.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const boots = { skip: !hasNesasm && 'nesasm not found on PATH' };

const sameTorus = (a, b) => a.x === b.x && a.y === b.y;

/**
 * Runs the Move frame by frame, recording one snapshot per frame until mv_left is back to 0 and
 * then `settle` further frames. Asserts, per frame: origin == the independent expectation (this is
 * the F6 assertion), the PPU scroll is this frame's torus scroll or the previous frame's (the NMI
 * publishes what the previous main-loop pass computed), and the terrain under the viewport (at the
 * published scroll's own origin) is contained. Returns the trace.
 */
function walk(nes, project, { gridW, gridH, settle = 8, maxFrames = 400, label }) {
  const trace = [];
  let prev = snapshot(nes, gridW, gridH);
  trace.push(prev);
  let idle = 0;
  for (let f = 0; f < maxFrames; f++) {
    nes.frame();
    const s = snapshot(nes, gridW, gridH);
    trace.push(s);
    const where = `${label} frame ${f + 1} (player ${s.col}:${s.px},${s.row}:${s.py}, left ${s.left})`;
    assert.deepEqual({ x: s.originX, y: s.originY }, s.expected, `${where}: sw_cam_origin must follow the player within the clamp`);
    const mine = torusOf(s.expected);
    const was = torusOf({ x: prev.originX, y: prev.originY });
    assert.ok(sameTorus(s.scroll, mine) || sameTorus(s.scroll, was), `${where}: the PPU scroll ${JSON.stringify(s.scroll)} must be this frame's ${JSON.stringify(mine)} or the previous frame's ${JSON.stringify(was)}`);
    const bad = viewportMismatches(nes, project, gridW, gridH, sameTorus(s.scroll, mine) ? s.expected : { x: prev.originX, y: prev.originY });
    assert.deepEqual(bad.slice(0, 3), [], `${where}: terrain under the viewport must be contained (${bad.length} block(s) wrong)`);
    prev = s;
    if (s.left === 0 && idle++ >= settle) break;
  }
  return trace;
}

/**
 * The window origin (in blocks) the camera asks for, from docs/design-streamed-worlds.md: the camera's
 * own block minus 8 columns / 7 rows, floored at 0 and clamped so the 32x30 window stays inside the map
 * (a screen is 16 blocks wide and 15 tall).
 */
function desiredWindow(originX, originY, gridW, gridH) {
  const camRow = Math.floor(originY / 240) * 15 + Math.floor((originY % 240) / 16);
  return {
    col: Math.min(Math.max(0, (originX >> 4) - 8), gridW * 16 - 32),
    row: Math.min(Math.max(0, camRow - 7), gridH * 15 - 30)
  };
}

/** Window advance (in blocks) over a trace, monotone-checked on one axis. */
function windowAdvance(trace, axis) {
  const key = axis === 'x' ? 'winCol' : 'winRow';
  let moved = 0;
  for (let i = 1; i < trace.length; i++) {
    const d = trace[i][key] - trace[i - 1][key];
    assert.ok(Math.abs(d) <= 1, `the window origin steps at most one block a frame (${key} ${trace[i - 1][key]} -> ${trace[i][key]})`);
    moved += Math.abs(d);
  }
  return moved;
}

// Screen 0: the camera is still near the world's left edge, so the walk scrolls the view 134 px but the window
// (camera block 8, minus 8) never leaves column 0 -- scroll and terrain only. Screen 1: the window starts mid-map and has to stream ten.
for (const gameType of ['action', 'rpg']) {
  for (const screen of [0, 1]) {
    for (const phase of ['acc0', 'acc-double']) {
      test(`T1 (${gameType}, screen ${screen}, ${phase}): a legal 200-px Move right from x = 100 -- the camera, the scroll, the strips and the terrain follow every frame`, boots, async () => {
        const project = terrainProject({ gameType, commands: [{ op: 'move', who: 'player', dir: 'right', dist: 200 }], startX: 100, startY: 112, moveScreen: screen });
        const { nes, mem } = await buildBoot(project);
        assert.ok(awaitMoveStart(nes) >= 0, 'the Move must start');
        assert.equal(mem[A.SW_WALK_ACC_X], 0, 'known start residue');
        if (phase === 'acc-double') mem[A.SW_WALK_ACC_X] = doubleFirstResidue(SW_SPEED_SUB_X);
        const x0 = mem[A.PLAYER_X];
        const trace = walk(nes, project, { gridW: 3, gridH: 2, label: `T1 ${gameType} screen ${screen} ${phase}` });
        const end = trace.at(-1);
        // B5: what it covers is ~154 px of ONE screen (the ownership stop), not 200 px and not a second window
        assert.equal(end.col, screen, 'the walk stays on its own screen (the ownership stop)');
        assert.ok(end.px >= 254 && end.px - x0 >= 150, `the Move covers ~154 px: ended at ${end.px}`);
        // screen 0 starts clamped at the world's left edge (origin 0 until the player passes x = 120), so the camera
        // moves only as far as the unclamped formula says: 134 px there, the player's own 154 px mid-map
        assert.equal(end.originX - trace[0].originX, end.expected.x - trace[0].expected.x, 'the camera moved exactly as far as the formula says');
        assert.equal(end.originX, Math.max(0, screen * 256 + end.px - 120), 'and ended where the player is, clamped at the left edge');
        assert.ok(end.originX - trace[0].originX >= 130, 'a substantial scroll (>= 130 px)');
        assert.equal(end.scroll.x, torusOf(end.expected).x, 'the published scroll ended on the camera');
        // strip progress: the window advanced a block at a time to its desired origin, strips completed, then went idle
        assert.ok(windowAdvance(trace, 'x') >= (screen === 0 ? 0 : 8), `column blocks were streamed in (${windowAdvance(trace, 'x')})`);
        assert.equal(end.stActive, 0, 'every strip completed (st_active back to 0)');
        assert.equal(end.winCol, desiredWindow(end.originX, end.originY, 3, 2).col, 'the window caught up to the camera');
      });
    }
  }
}

for (const gameType of ['action', 'rpg']) {
  for (const phase of ['acc0', 'acc-double']) {
    test(`T1v (${gameType}, ${phase}): a legal Move down and then up across a screen's full height (one 240-px window) -- sustained vertical tracking`, boots, async () => {
      const gridW = 3;
      const gridH = 4; // a tall grid: the camera is not clamped at the top or the bottom
      const commands = [{ op: 'move', who: 'player', dir: 'down', dist: 220 }, { op: 'move', who: 'player', dir: 'up', dist: 220 }];
      const project = terrainProject({ gameType, gridW, gridH, commands, startX: 120, startY: 10, moveScreen: gridW });
      const { nes, mem } = await buildBoot(project);
      assert.ok(awaitMoveStart(nes) >= 0, 'the Move must start');
      assert.equal(mem[A.SW_WALK_ACC_Y], 0, 'known start residue');
      if (phase === 'acc-double') mem[A.SW_WALK_ACC_Y] = doubleFirstResidue(SW_SPEED_SUB_Y);
      const y0 = mem[A.PLAYER_Y];
      const all = walk(nes, project, { gridW, gridH, settle: 8, maxFrames: 600, label: `T1v ${gameType} ${phase}` });
      assert.equal(all.at(-1).left, 0, 'both Moves ended');
      const turn = all.reduce((best, s, i) => (s.py > all[best].py ? i : best), 0); // the lowest point: down ends, up begins
      const down = all.slice(0, turn + 1);
      const up = all.slice(turn);
      const bottom = all[turn];
      const top = all.at(-1);
      assert.ok(bottom.py - y0 >= 200 && bottom.py <= 239, `down covered the screen's height: ${y0} -> ${bottom.py}`);
      assert.equal(bottom.row, 1, 'still on the same screen row (the ownership stop)');
      assert.ok(bottom.originY - down[0].originY >= 100, `a substantial vertical scroll: ${down[0].originY} -> ${bottom.originY}`);
      assert.ok(windowAdvance(down, 'y') >= 6, 'at least six row blocks were streamed in on the way down');
      assert.ok(bottom.py - top.py >= 200, `up covered the screen's height: ${bottom.py} -> ${top.py}`);
      assert.ok(bottom.originY - top.originY >= 100, `a substantial vertical scroll back: ${bottom.originY} -> ${top.originY}`);
      assert.ok(windowAdvance(up, 'y') >= 6, 'at least six row blocks were streamed in on the way up');
      assert.equal(top.stActive, 0, 'every strip completed (st_active back to 0)');
      assert.equal(top.winRow, desiredWindow(top.originX, top.originY, gridW, gridH).row, 'the window caught up to the camera');
    });
  }
}
