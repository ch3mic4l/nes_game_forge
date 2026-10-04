// Phase 3a slice S3b (handoff-next/streamed-worlds-phase3a-s3b-plan.md section 1, T1-T4, T10): a scripted
// player `Move` on a streamed map CROSSES the screen seam, committing exactly as a walking step does.
//
//   T1   crossing, all four directions, both raw-step phases: the final screen and local position follow the
//        independent step model (accumulator sequence), the distance walked is the authored one, the camera
//        origin follows the player every frame, A->B->C takes two consecutive Moves, and a Move that stops short
//        of the seam does not cross (a regression that re-adds the stop is a missing crossing).
//   T2   no retention (handover off): A->B->A and A->B->C respawn the actors from the screen table, hideSwitch honoured.
//   T3   a final step clipped exactly at, one past and a few pixels past the seam, all four directions, both phases,
//        asserting the accumulator after every tick (a clipped step's position cannot show a double advance).
//   T4   a solid tile or the grid edge refuses the crossing step exactly as a walk does -- first probe corner only,
//        second only, both -- the walk being the oracle (the same driver, so the claim under test is that the
//        crossing Move takes the commit through it and ends like a walk).
//   T10  single-writer by executed path: spawn_entities and sw_talker_cross each run exactly once per crossing,
//        and every writer of flat_screen/sw_col/sw_row/player_x/player_y is inside the commit's own routines.
//
// Expected values come from the step model (acc += sub, raw step 2 on carry, clipped to what is left) and the
// probe insets (BODY_L=2, BODY_R=13, BODY_T=8, BODY_B=15), written out here -- never from the engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  A, SW_SPEED_SUB_X, SW_SPEED_SUB_Y, buildBoot, awaitMoveStart, snapshot, torusOf, viewportMismatches, simulateAcc, doubleFirstResidue, tracePc
} from '../lib/streamedmovecam.js';
import { crossProject, page, move, addVar, R, BTN, runFrames, runUntil } from '../lib/streamedcross.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const boots = { skip: !hasNesasm && 'nesasm not found on PATH' };

const GRID_W = 3;
const GRID_H = 2;
const AX = {
  right: { axis: 'x', sign: 1, sub: SW_SPEED_SUB_X, acc: A.SW_WALK_ACC_X, seam: 256 },
  left: { axis: 'x', sign: -1, sub: SW_SPEED_SUB_X, acc: A.SW_WALK_ACC_X, seam: 256 },
  down: { axis: 'y', sign: 1, sub: SW_SPEED_SUB_Y, acc: A.SW_WALK_ACC_Y, seam: 240 },
  up: { axis: 'y', sign: -1, sub: SW_SPEED_SUB_Y, acc: A.SW_WALK_ACC_Y, seam: 240 }
};
const BODY = { L: 2, R: 13, T: 8, B: 15 }; // engine/constants.asm

/** World coordinate on one axis: screen index * screen size + local position. */
const worldOf = (mem, axis) => (axis === 'x' ? mem[A.SW_COL] * 256 + mem[A.PLAYER_X] : mem[A.SW_ROW] * 240 + mem[A.PLAYER_Y]);
const flatOf = (wx, wy) => Math.floor(wy / 240) * GRID_W + Math.floor(wx / 256);

/** Where the Move starts, per direction: a few steps short of the seam, with room to cross it. */
const START = {
  right: { screen: 0, x: 200, y: 112 },
  left: { screen: 1, x: 56, y: 112 },
  down: { screen: 0, x: 120, y: 200 },
  up: { screen: 3, x: 120, y: 40 }
};

function startWorld(dir) {
  const s = START[dir];
  const col = s.screen % GRID_W;
  const row = Math.floor(s.screen / GRID_W);
  return { wx: col * 256 + s.x, wy: row * 240 + s.y };
}

/** One frame at a time until the Move is over, then `settle` more; the camera must follow the player every frame (the F6 assertion S3a pinned). */
function walkFrames(nes, project, { label, settle = 8, max = 500, onFrame = () => {} }) {
  const trace = [];
  let prev = snapshot(nes, GRID_W, GRID_H);
  trace.push(prev);
  let idle = 0;
  for (let f = 0; f < max; f++) {
    nes.frame();
    const s = snapshot(nes, GRID_W, GRID_H);
    trace.push(s);
    const where = `${label} frame ${f + 1} (player ${s.col}:${s.px},${s.row}:${s.py}, left ${s.left})`;
    assert.deepEqual({ x: s.originX, y: s.originY }, s.expected, `${where}: sw_cam_origin must follow the player within the clamp`);
    const mine = torusOf(s.expected);
    const was = torusOf({ x: prev.originX, y: prev.originY });
    const same = (a, b) => a.x === b.x && a.y === b.y;
    assert.ok(same(s.scroll, mine) || same(s.scroll, was), `${where}: the PPU scroll must be this frame's or the previous frame's`);
    const bad = viewportMismatches(nes, project, GRID_W, GRID_H, same(s.scroll, mine) ? s.expected : { x: prev.originX, y: prev.originY });
    assert.deepEqual(bad.slice(0, 3), [], `${where}: terrain under the viewport must be contained`);
    onFrame(f, s);
    prev = s;
    if (s.left === 0 && idle++ >= settle) break;
  }
  return trace;
}

// ------------------------------------------------------------------ T1

for (const gameType of ['action', 'rpg']) {
  for (const dir of ['right', 'left', 'down', 'up']) {
    for (const phase of ['acc0', 'acc-double']) {
      test(`T1 (${gameType}, ${dir}, ${phase}): a legal 100-px Move across the seam ends where the step model says, with the camera on the player every frame`, boots, async () => {
        const ax = AX[dir];
        const d = 100;
        const { project } = crossProject({ gameType, start: START[dir], pages: [page([move(dir, d)])] });
        const { nes, mem } = await buildBoot(project);
        assert.ok(awaitMoveStart(nes) >= 0, 'the Move must start');
        assert.equal(mem[ax.acc], 0, 'known start residue');
        const acc0 = phase === 'acc0' ? 0 : doubleFirstResidue(ax.sub);
        mem[ax.acc] = acc0;
        const w0 = startWorld(dir);
        assert.equal(worldOf(mem, ax.axis), ax.axis === 'x' ? w0.wx : w0.wy, 'the player starts where the scene says');
        const startFlat = mem[A.FLAT_SCREEN];
        const steps = simulateAcc(ax.sub, acc0, 200);
        let left = d;
        let cum = 0;
        let tick = 0;
        let crossings = 0;
        let lastFlat = startFlat;
        const trace = walkFrames(nes, project, {
          label: `T1 ${gameType} ${dir} ${phase}`,
          onFrame: (f, s) => {
            if (left > 0) {
              const granted = Math.min(steps[tick].step, left);
              tick++;
              left -= granted;
              cum += granted;
            }
            const want = (ax.axis === 'x' ? w0.wx : w0.wy) + ax.sign * cum;
            assert.equal(worldOf(mem, ax.axis), want, `frame ${f + 1}: the world coordinate follows the step model`);
            const wx = ax.axis === 'x' ? want : w0.wx;
            const wy = ax.axis === 'y' ? want : w0.wy;
            assert.equal(mem[A.FLAT_SCREEN], flatOf(wx, wy), `frame ${f + 1}: flat_screen is the screen the world coordinate is on`);
            if (s.px !== undefined && mem[A.FLAT_SCREEN] !== lastFlat) { crossings++; lastFlat = mem[A.FLAT_SCREEN]; }
          }
        });
        assert.equal(trace.at(-1).left, 0, 'the Move ended');
        assert.equal(cum, d, 'the distance actually walked is the authored one');
        assert.equal(crossings, 1, 'exactly one crossing');
        assert.notEqual(mem[A.FLAT_SCREEN], startFlat, 'the player is on the next screen');
      });
    }
  }
}

test('T1 control: a Move that stops short of the seam does not cross (a re-added stop and a missing crossing are different failures)', boots, async () => {
  const { project } = crossProject({ start: START.right, pages: [page([move('right', 40)])] });
  const { nes, mem } = await buildBoot(project);
  assert.ok(awaitMoveStart(nes) >= 0);
  for (let i = 0; i < 80 && mem[A.MV_LEFT] !== 0; i++) nes.frame();
  assert.equal(mem[A.SW_COL], 0);
  assert.equal(mem[A.PLAYER_X], 240);
});

for (const gameType of ['action', 'rpg']) {
  test(`T1 (${gameType}): A -> B -> C takes two consecutive Moves, each a legal byte distance`, boots, async () => {
    const { project } = crossProject({ gameType, start: START.right, pages: [page([move('right', 200), move('right', 155)])] });
    const { nes, mem } = await buildBoot(project);
    assert.ok(awaitMoveStart(nes) >= 0);
    const seen = new Set([mem[A.FLAT_SCREEN]]);
    for (let i = 0; i < 400; i++) {
      nes.frame();
      seen.add(mem[A.FLAT_SCREEN]);
      if (mem[A.FLAT_SCREEN] === 2 && mem[A.MV_LEFT] === 0) break;
    }
    assert.deepEqual([...seen].sort(), [0, 1, 2], 'the player passed through B on the way to C');
    assert.equal(worldOf(mem, 'x'), 200 + 355, 'both Moves walked in full');
    assert.equal(mem[A.PLAYER_X], 200 + 355 - 512);
  });
}

// ------------------------------------------------------------------ T2: no retention

test('T2: A -> B -> A respawns the actors from the screen table; hideSwitch is honoured; nothing is held (handover off)', boots, async () => {
  const { project, talkerRecord } = crossProject({
    start: START.right, decoy: true,
    pages: [page([{ op: 'setSwitch', switch: 2 }, move('right', 100), move('left', 100), addVar(0)])]
  });
  const { nes, mem } = await buildBoot(project);
  assert.ok(awaitMoveStart(nes) >= 0);
  // dirty the talker's live slot: if anything of A survived the round trip, this value would
  const slot = [0, 1, 2, 3, 4, 5, 6, 7].find((i) => mem[R.ENT_ACTIVE + i] && mem[R.ENT_RECORD + i] === talkerRecord);
  assert.ok(slot >= 0, 'the talker is live on A');
  mem[R.ENT_X + slot] = 77;
  mem[R.ENT_Y + slot] = 99;
  runUntil(nes, () => mem[A.FLAT_SCREEN] === 1, 300, 'the crossing to B');
  runUntil(nes, () => mem[A.FLAT_SCREEN] === 0 && mem[A.MV_LEFT] === 0, 400, 'the return to A');
  runFrames(nes, 4);
  const back = [0, 1, 2, 3, 4, 5, 6, 7].find((i) => mem[R.ENT_ACTIVE + i] && mem[R.ENT_RECORD + i] === talkerRecord);
  assert.ok(back >= 0, 'the talker is live again on A');
  assert.equal(mem[R.ENT_X + back], 32, 'respawned at its authored x, not the value left on the slot before the crossing');
  assert.equal(mem[R.ENT_Y + back], 32, 'respawned at its authored y');
  const live = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => mem[R.ENT_ACTIVE + i]);
  assert.equal(live.length, 1, 'the decoy (hidden once switch 2 is on) is not respawned: exactly the talker is live');
});

// ------------------------------------------------------------------ T3: clipping across a seam

/** The first tick index k (>= 8) whose raw step is 2: the distance cum(k)+1 clips that tick to one pixel. */
function clippedDistance(sub, acc0) {
  const trace = simulateAcc(sub, acc0, 40);
  let cum = 0;
  for (let k = 0; k < trace.length; k++) {
    // from tick 9 on, so the Move is longer than the largest overshoot probed below and every case really starts before the seam
    if (k >= 8 && trace[k].step === 2) return { dist: cum + 1, ticks: k + 1, trace };
    cum += trace[k].step;
  }
  throw new Error('no two-pixel step in 40 ticks');
}

// the Move ends `k` px past the seam going right/down, or `k` px short of it (past, on the other side) going left/up
for (const dir of ['right', 'left', 'down', 'up']) {
  for (const phase of ['acc0', 'acc-double']) {
    for (const k of [0, 1, 7]) {
      test(`T3 ${dir}, ${phase}, ends ${k} px beyond the seam: the clipped final step lands exactly and the accumulator advances once per tick`, boots, async () => {
        const ax = AX[dir];
        const acc0 = phase === 'acc0' ? 0 : doubleFirstResidue(ax.sub);
        const { dist, ticks, trace } = clippedDistance(ax.sub, acc0);
        // end world coordinate: first pixel past the seam is `seam` going down/right, `seam - 1` going up/left
        const end = ax.sign > 0 ? ax.seam + k : ax.seam - 1 - k;
        const startW = end - ax.sign * dist;
        const horizontal = ax.axis === 'x';
        const screenIdx = (w, size) => Math.floor(w / size);
        const col = horizontal ? screenIdx(startW, 256) : 0;
        const row = horizontal ? 0 : screenIdx(startW, 240);
        const start = { screen: row * GRID_W + col, x: horizontal ? startW - col * 256 : 120, y: horizontal ? 112 : startW - row * 240 };
        const { project } = crossProject({ start, pages: [page([move(dir, dist)])] });
        const { nes, mem } = await buildBoot(project);
        assert.ok(awaitMoveStart(nes) >= 0, 'the Move must start');
        mem[ax.acc] = acc0;
        assert.equal(worldOf(mem, ax.axis), startW, 'the player starts where the scene says');
        const other = ax.acc === A.SW_WALK_ACC_X ? A.SW_WALK_ACC_Y : A.SW_WALK_ACC_X;
        let w = startW;
        let left = dist;
        for (let t = 0; t < ticks; t++) {
          nes.frame();
          const granted = Math.min(trace[t].step, left);
          w += ax.sign * granted;
          left -= granted;
          assert.equal(mem[ax.acc], trace[t].acc, `tick ${t + 1}: the accumulator advanced exactly once (raw ${trace[t].step})`);
          assert.equal(mem[other], 0, `tick ${t + 1}: the other axis's accumulator is untouched`);
          assert.equal(worldOf(mem, ax.axis), w, `tick ${t + 1}: moved min(raw, left) = ${granted}`);
          assert.equal(mem[A.MV_LEFT], left, `tick ${t + 1}: mv_left is subtracted by the clipped step and never underflows`);
        }
        assert.equal(trace[ticks - 1].step, 2, 'the last tick really is a two-pixel raw step');
        assert.equal(w, end, 'the full authored distance landed exactly');
        const endFlat = horizontal ? flatOf(end, 112) : flatOf(120, end);
        assert.equal(mem[A.FLAT_SCREEN], endFlat, `the final screen is the one the end coordinate is on (${endFlat})`);
        nes.frame();
        assert.equal(mem[ax.acc], trace[ticks - 1].acc, 'no tick after the Move ended');
        assert.equal(worldOf(mem, ax.axis), end);
      });
    }
  }
}

// ------------------------------------------------------------------ T4: walls and the grid edge

/** The walk oracle: the same scene with no Move, a held direction instead; returns where the player's first refused step leaves it. */
async function walkOracle(dir, start, solids) {
  const { project } = crossProject({ start, solids, pages: [page([addVar(7)])] });
  const { nes, mem } = await buildBoot(project);
  runFrames(nes, 30);
  assert.equal(mem[R.SCRIPT_ACTIVE], 0, 'the oracle scene has no running event');
  const ax = AX[dir];
  assert.equal(mem[ax.acc], 0, 'known start residue');
  const button = { right: BTN.RIGHT, left: BTN.LEFT, down: BTN.DOWN, up: BTN.UP }[dir];
  nes.buttonDown(1, button);
  // a Move ends at its first refused step, where a held walk retries on the next frame (with another raw step): the oracle is the
  // walk's position at the first frame after it started moving on which it did NOT move
  let last = worldOf(mem, ax.axis);
  let started = false;
  for (let i = 0; i < 400; i++) {
    nes.frame();
    const w = worldOf(mem, ax.axis);
    if (w !== last) started = true;
    else if (started) break;
    last = w;
  }
  nes.buttonUp(1, button);
  return { col: mem[A.SW_COL], row: mem[A.SW_ROW], x: mem[A.PLAYER_X], y: mem[A.PLAYER_Y] };
}

const o = (row, col) => row * 16 + col;
// a wall on the destination screen's first row/column of tiles, placed so the two probe corners fall on different tiles:
// horizontal moves probe y+BODY_T and y+BODY_B (y = 103: rows 6 and 7); vertical moves probe x+BODY_L and x+BODY_R (x = 125: columns 7 and 8)
const WALLS = {
  right: { start: { screen: 0, x: 200, y: 103 }, dest: 1, first: [o(6, 0)], second: [o(7, 0)] },
  left: { start: { screen: 1, x: 56, y: 103 }, dest: 0, first: [o(6, 15)], second: [o(7, 15)] },
  down: { start: { screen: 0, x: 125, y: 200 }, dest: 3, first: [o(0, 7)], second: [o(0, 8)] },
  up: { start: { screen: 3, x: 125, y: 40 }, dest: 0, first: [o(14, 7)], second: [o(14, 8)] }
};

for (const dir of ['right', 'left', 'down', 'up']) {
  const w = WALLS[dir];
  for (const [label, tiles] of [['first corner only', w.first], ['second corner only', w.second], ['both corners', [...w.first, ...w.second]]]) {
    test(`T4 ${dir}, solid at the ${label}: the crossing step is refused, the Move ends and the page continues -- exactly where a walk stops`, boots, async () => {
      const solids = tiles.map((offset) => ({ screen: w.dest, offset }));
      const expected = await walkOracle(dir, w.start, solids);
      const unobstructed = await walkOracle(dir, w.start, []);
      assert.notDeepEqual(expected, unobstructed, 'the wall changes where the walk ends (a wall the walk ignored would make the comparison below vacuous)');
      const { project } = crossProject({ start: w.start, solids, pages: [page([move(dir, 100), addVar(0)])] });
      const { nes, mem } = await buildBoot(project);
      assert.ok(awaitMoveStart(nes) >= 0);
      for (let i = 0; i < 200 && mem[R.SCRIPT_ACTIVE] !== 0; i++) nes.frame();
      assert.equal(mem[R.SCRIPT_ACTIVE], 0, 'the page ran to its end: the refused Move did not hang the event');
      assert.equal(mem[R.VARIABLES], 1, 'the command after the refused Move ran');
      assert.deepEqual({ col: mem[A.SW_COL], row: mem[A.SW_ROW], x: mem[A.PLAYER_X], y: mem[A.PLAYER_Y] }, expected, 'the Move stops exactly where the walk stops');
    });
  }
  test(`T4 ${dir} control: with no wall the same Move crosses (the refusals above are the wall's, not a re-added stop)`, boots, async () => {
    const { project } = crossProject({ start: w.start, pages: [page([move(dir, 100), addVar(0)])] });
    const { nes, mem } = await buildBoot(project);
    assert.ok(awaitMoveStart(nes) >= 0);
    for (let i = 0; i < 200 && mem[R.SCRIPT_ACTIVE] !== 0; i++) nes.frame();
    assert.equal(mem[A.FLAT_SCREEN], w.dest, 'crossed onto the destination screen');
  });
}

// the grid edge: a Move off the last screen is refused like a missing neighbour, in every direction
const EDGE = {
  right: { screen: 2, x: 200, y: 112 },
  left: { screen: 0, x: 56, y: 112 },
  down: { screen: 3, x: 120, y: 200 },
  up: { screen: 0, x: 120, y: 40 }
};
for (const dir of ['right', 'left', 'down', 'up']) {
  test(`T4 grid edge ${dir}: the step is refused at the world's edge and the Move ends like a walk`, boots, async () => {
    const expected = await walkOracle(dir, EDGE[dir], []);
    const { project } = crossProject({ start: EDGE[dir], pages: [page([move(dir, 255), addVar(0)])] });
    const { nes, mem } = await buildBoot(project);
    assert.ok(awaitMoveStart(nes) >= 0);
    for (let i = 0; i < 400 && mem[R.SCRIPT_ACTIVE] !== 0; i++) nes.frame();
    assert.equal(mem[R.VARIABLES], 1, 'the page continued past the refused Move');
    assert.deepEqual({ col: mem[A.SW_COL], row: mem[A.SW_ROW], x: mem[A.PLAYER_X], y: mem[A.PLAYER_Y] }, expected);
  });
}

// ------------------------------------------------------------------ T10: single-writer by executed path

/** The address of the next label after `name` in the symbol table (the end of a routine whose successor is not known by name). */
const nextLabel = (syms, name) => Math.min(...Object.values(syms).filter((a) => a > syms[name]));

for (const dir of ['right', 'down']) {
  test(`T10 ${dir}: a crossing Move runs spawn_entities and sw_talker_cross exactly once, and every writer of the ownership bytes is inside the commit`, boots, async () => {
    const { project } = crossProject({ start: START[dir], pages: [page([move(dir, 100)])] });
    const { nes, mem, syms } = await buildBoot(project);
    assert.ok(syms.sw_talker_cross !== undefined, 'sw_talker_cross is assembled (a streamed project with a Move)');
    assert.equal(syms.sw_step_nocross, undefined, 'sw_step_nocross is gone from the symbol table');
    assert.ok(awaitMoveStart(nes) >= 0);
    const spawn = { entries: 0 };
    const cross = { entries: 0 };
    const writers = new Map(); // pc of the instruction after which a watched byte changed -> times
    const watched = [A.PLAYER_X, A.PLAYER_Y, A.FLAT_SCREEN, A.SW_COL, A.SW_ROW];
    let prevPc = 0;
    let prev = watched.map((a) => mem[a]);
    const unwatch = tracePc(nes, (pc) => {
      // called before every instruction: a change since the last call was made by the previous instruction
      const now = watched.map((a) => mem[a]);
      if (now.some((v, i) => v !== prev[i])) writers.set(prevPc, (writers.get(prevPc) ?? 0) + 1);
      prev = now;
      prevPc = pc;
      if (pc === syms.spawn_entities) spawn.entries++;
      if (pc === syms.sw_talker_cross) cross.entries++;
    });
    try {
      for (let i = 0; i < 200 && mem[A.MV_LEFT] !== 0; i++) nes.frame();
    } finally {
      unwatch();
    }
    assert.equal(mem[A.MV_LEFT], 0, 'the Move ended');
    assert.equal(spawn.entries, 1, 'spawn_entities ran exactly once for the one crossing');
    assert.equal(cross.entries, 1, 'sw_talker_cross ran exactly once for the one crossing');
    const spans = [
      ['the step driver', syms.sw_pr_calc, syms.sw_pstep_end],
      ['sw_cross_*', syms.sw_cross_right, syms.sw_stream_start_col],
      ['sw_locate_current', syms.sw_locate_current, syms.sw_enter_screen],
      ['sw_enter_screen', syms.sw_enter_screen, nextLabel(syms, 'sw_enter_screen')]
    ];
    const outside = [...writers.keys()].filter((pc) => !spans.some(([, lo, hi]) => pc >= lo && pc < hi));
    assert.deepEqual(outside.map((p) => p.toString(16)), [], 'every writer of flat_screen / sw_col / sw_row / player_x / player_y lies inside the one commit and the step driver');
    assert.ok([...writers.keys()].some((pc) => pc >= syms.sw_cross_right && pc < syms.sw_stream_start_col), 'the commit itself wrote the ownership bytes (the writer set is not empty by accident)');
  });
}
