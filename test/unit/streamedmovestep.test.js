// Phase 3a slice S3a (handoff-next/streamed-worlds-phase3a-plan.md §4.1 R5, §7 S3a T3-T6): a streamed
// player `Move` takes its step through the one shared driver, `sw_pstep_*`, and keeps the walk
// accumulator's contract.
//
//   T3  clipping: a remaining distance of 1 on a two-pixel raw step moves exactly 1 pixel, mv_left
//       never underflows -- all four directions, both accumulator phases, on both sides of a seam --
//       asserting the ACCUMULATOR STATE after every tick (a clipped step's position is unchanged by
//       a double advance, so position alone cannot detect one).
//   T4  one raw advance per tick, read from the accumulator state; no refund.
//   T5  blocked vs moved: a genuinely blocked vertical step ends the Move; a successful vertical
//       step advances (a position-only or X-only blocked test cannot tell them apart).
//   T6  retired-symbol audit and an executed-path trace: sw_move_probe* are gone, move_tick calls
//       sw_pstep_*, and no PC of a streamed player Move ever falls in a probe of its own.
//
// Expected values come from the accumulator's documented shape (acc += sub, step 2 on carry) and
// from the leading-edge probe insets (BODY_L=2, BODY_R=13, BODY_T=8, BODY_B=15, engine/constants.asm),
// written out here -- never from the engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  A, DIR, SW_SPEED_SUB_X, SW_SPEED_SUB_Y, terrainProject, buildBoot, awaitMoveStart, simulateAcc, doubleFirstResidue,
  rowOffsets, colOffsets, tracePc, spanOf, probeOwnership, ownershipViolations
} from '../lib/streamedmovecam.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const boots = { skip: !hasNesasm && 'nesasm not found on PATH' };

const BODY = { L: 2, R: 13, T: 8, B: 15 }; // engine/constants.asm

// Seam variants: the screen the Move runs on and where it starts, so that the walk ENDS within a few
// pixels of the seam it approaches ('toward') or STARTS just past a seam it leaves ('away'). The seam
// is the 256-px (X) / 240-px (Y) ownership boundary the Move stop keeps.
const AXIS = {
  right: { axis: 'x', sign: 1, sub: SW_SPEED_SUB_X, acc: A.SW_WALK_ACC_X, reg: A.PLAYER_X },
  left: { axis: 'x', sign: -1, sub: SW_SPEED_SUB_X, acc: A.SW_WALK_ACC_X, reg: A.PLAYER_X },
  down: { axis: 'y', sign: 1, sub: SW_SPEED_SUB_Y, acc: A.SW_WALK_ACC_Y, reg: A.PLAYER_Y },
  up: { axis: 'y', sign: -1, sub: SW_SPEED_SUB_Y, acc: A.SW_WALK_ACC_Y, reg: A.PLAYER_Y }
};
// screen indices on the 3x2 grid: 0 = (col0,row0), 1 = (col1,row0), 3 = (col0,row1)
const SEAMS = (dist) => ({
  'right toward': { dir: 'right', screen: 0, start: 254 - dist },
  'right away': { dir: 'right', screen: 1, start: 1 },
  'left toward': { dir: 'left', screen: 1, start: 1 + dist },
  'left away': { dir: 'left', screen: 0, start: 253 },
  'down toward': { dir: 'down', screen: 0, start: 238 - dist },
  'down away': { dir: 'down', screen: 3, start: 1 },
  'up toward': { dir: 'up', screen: 3, start: 1 + dist },
  'up away': { dir: 'up', screen: 0, start: 238 }
});

/** The first tick index k (>= 3) whose raw step is 2 -- the distance cum(k)+1 clips that tick to 1. */
function clippedDistance(sub, acc0) {
  const trace = simulateAcc(sub, acc0, 40);
  let cum = 0;
  for (let k = 0; k < trace.length; k++) {
    if (k >= 3 && trace[k].step === 2) return { dist: cum + 1, ticks: k + 1, trace };
    cum += trace[k].step;
  }
  throw new Error('no two-pixel step in 40 ticks');
}

function moveProject(dir, screen, start, dist, extra = {}) {
  const horizontal = AXIS[dir].axis === 'x';
  return terrainProject({
    commands: [{ op: 'move', who: 'player', dir, dist }],
    startX: horizontal ? start : 120,
    startY: horizontal ? 112 : start,
    moveScreen: screen,
    ...extra
  });
}

for (const [name, seam] of Object.entries(SEAMS(0))) {
  for (const phase of ['acc0', 'acc-double']) {
    test(`T3/T4 ${name}, ${phase}: a clipped final step moves 1 px, mv_left never underflows, and the accumulator advances once per tick (state read every tick)`, boots, async () => {
      const ax = AXIS[seam.dir];
      const acc0 = phase === 'acc0' ? 0 : doubleFirstResidue(ax.sub);
      const { dist, ticks, trace } = clippedDistance(ax.sub, acc0);
      const { start, screen } = SEAMS(dist)[name];
      const { nes, mem } = await buildBoot(moveProject(seam.dir, screen, start, dist));
      assert.ok(awaitMoveStart(nes) >= 0, 'the Move must start');
      assert.equal(mem[ax.acc], 0, 'known start residue');
      mem[ax.acc] = acc0;
      const other = ax.acc === A.SW_WALK_ACC_X ? A.SW_WALK_ACC_Y : A.SW_WALK_ACC_X;
      let pos = mem[ax.reg];
      assert.equal(pos, start, 'the player starts where the scene says');
      let left = mem[A.MV_LEFT];
      assert.equal(left, dist);
      for (let t = 0; t < ticks; t++) {
        nes.frame();
        const raw = trace[t].step;
        const granted = Math.min(raw, left);
        pos += ax.sign * granted;
        left -= granted;
        assert.equal(mem[ax.acc], trace[t].acc, `tick ${t + 1}: the accumulator advanced exactly once (raw step ${raw}); a second advance or a refund shows here`);
        assert.equal(mem[other], 0, `tick ${t + 1}: the other axis's accumulator is untouched`);
        assert.equal(mem[ax.reg], pos, `tick ${t + 1}: the player moved min(raw ${raw}, left) = ${granted}`);
        assert.ok(mem[A.MV_LEFT] <= dist, `tick ${t + 1}: mv_left ${mem[A.MV_LEFT]} must never underflow past ${dist}`);
        assert.equal(mem[A.MV_LEFT], left, `tick ${t + 1}: mv_left is subtracted by the CLIPPED step`);
      }
      assert.equal(trace[ticks - 1].step, 2, 'the last tick really is a two-pixel raw step');
      assert.equal(mem[A.MV_LEFT], 0, 'the Move ended on schedule');
      assert.equal(mem[ax.reg], start + ax.sign * dist, 'the full authored distance landed exactly');
      // and nothing ticks again: one more frame leaves the accumulator and the position alone
      nes.frame();
      assert.equal(mem[ax.acc], trace[ticks - 1].acc, 'no tick after the Move ended');
      assert.equal(mem[ax.reg], start + ax.sign * dist);
    });
  }
}

for (const dir of ['right', 'left', 'down', 'up']) {
  for (const phase of ['acc0', 'acc-double']) {
    test(`T4 ${dir}, ${phase}: a plain Move advances the accumulator once per tick and walks the raw steps (no 3-pixel tick, no refund)`, boots, async () => {
      const ax = AXIS[dir];
      const acc0 = phase === 'acc0' ? 0 : doubleFirstResidue(ax.sub);
      const screen = { right: 0, left: 1, down: 0, up: 3 }[dir];
      const start = { right: 40, left: 200, down: 40, up: 200 }[dir];
      const { nes, mem } = await buildBoot(moveProject(dir, screen, start, 24));
      assert.ok(awaitMoveStart(nes) >= 0);
      mem[ax.acc] = acc0;
      const trace = simulateAcc(ax.sub, acc0, 30);
      let pos = start;
      let left = 24;
      for (let t = 0; left > 0; t++) {
        nes.frame();
        const granted = Math.min(trace[t].step, left);
        pos += ax.sign * granted;
        left -= granted;
        assert.equal(mem[ax.acc], trace[t].acc, `tick ${t + 1}: exactly one raw advance`);
        assert.equal(mem[ax.reg], pos, `tick ${t + 1}`);
      }
      assert.equal(mem[A.MV_LEFT], 0);
    });
  }
}

// ------------------------------------------------------------------ T5: blocked vs moved

const SOLID_ROW_DOWN = 6; // metatile rows 6 (y 96-111) and 4 (y 64-79), painted on screen 0
const SOLID_ROW_UP = 4;
const SOLID_COL_RIGHT = 12; // x 192-207

/** First tick whose candidate the leading-edge probes reject: the wall the test paints, in pixels. */
function wallTick(dir, start, dist, acc0, blockedAt) {
  const ax = AXIS[dir];
  const trace = simulateAcc(ax.sub, acc0, 80);
  let pos = start;
  let left = dist;
  for (let t = 0; left > 0; t++) {
    const cand = pos + ax.sign * Math.min(trace[t].step, left);
    if (blockedAt(cand)) return { tick: t + 1, pos };
    pos = cand;
    left -= Math.min(trace[t].step, left);
  }
  return { tick: null, pos };
}

const T5 = {
  down: { screen: 0, start: 60, dist: 100, solids: [{ screen: 0, offsets: rowOffsets(SOLID_ROW_DOWN) }], blockedAt: (y) => (y + BODY.B) >> 4 === SOLID_ROW_DOWN },
  up: { screen: 0, start: 150, dist: 100, solids: [{ screen: 0, offsets: rowOffsets(SOLID_ROW_UP) }], blockedAt: (y) => (y + BODY.T) >> 4 === SOLID_ROW_UP },
  right: { screen: 0, start: 150, dist: 100, solids: [{ screen: 0, offsets: colOffsets(SOLID_COL_RIGHT) }], blockedAt: (x) => (x + BODY.R) >> 4 === SOLID_COL_RIGHT }
};

for (const [dir, c] of Object.entries(T5)) {
  for (const phase of ['acc0', 'acc-double']) {
    test(`T5 ${dir}, ${phase}: a blocked step ends the Move and the script resumes; the steps before it moved`, boots, async () => {
      const ax = AXIS[dir];
      const acc0 = phase === 'acc0' ? 0 : doubleFirstResidue(ax.sub);
      const solids = c.solids.flatMap((s) => s.offsets.map((offset) => ({ screen: s.screen, offset })));
      // a second command after the Move proves the script resumed: a one-px Move the other way round
      const horizontal = ax.axis === 'x';
      const project = terrainProject({
        commands: [{ op: 'move', who: 'player', dir, dist: c.dist }, { op: 'move', who: 'player', dir: horizontal ? 'down' : 'right', dist: 4 }],
        startX: horizontal ? c.start : 120,
        startY: horizontal ? 112 : c.start,
        moveScreen: c.screen,
        solids
      });
      const { nes, mem } = await buildBoot(project);
      assert.ok(awaitMoveStart(nes) >= 0);
      mem[ax.acc] = acc0;
      const wall = wallTick(dir, c.start, c.dist, acc0, c.blockedAt);
      assert.ok(wall.tick !== null && wall.tick > 3, `the scene's wall must be reached after several steps (tick ${wall.tick})`);
      const trace = simulateAcc(ax.sub, acc0, 80);
      let pos = c.start;
      for (let t = 1; t < wall.tick; t++) {
        nes.frame();
        pos += ax.sign * trace[t - 1].step;
        assert.equal(mem[ax.reg], pos, `tick ${t}: a successful step advances`);
        assert.equal(mem[A.MV_DIR], DIR[dir], 'still the first Move');
      }
      nes.frame(); // the blocked tick
      assert.equal(mem[ax.reg], wall.pos, `the blocked tick moves nothing (stays at ${wall.pos})`);
      assert.equal(mem[ax.acc], trace[wall.tick - 1].acc, 'the blocked tick still advanced the accumulator once (no refund)');
      // the Move ended (mv_left abandoned) and the script resumed in the same frame: the next command is running
      assert.equal(mem[A.MV_DIR], DIR[horizontal ? 'down' : 'right'], 'the next command started: the blocked Move ended');
      assert.equal(mem[A.MV_LEFT], 4, 'the second Move has its whole distance');
      for (let i = 0; i < 12; i++) nes.frame();
      assert.equal(mem[A.MV_LEFT], 0);
      assert.equal(mem[ax.reg], wall.pos, 'the first axis never moved again');
    });
  }
}

// ------------------------------------------------------------------ T6: retired symbols and the executed path

const RETIRED = ['sw_move_probe', 'sw_move_probe_cross', 'sw_move_probe_same', 'sw_move_probe_no_dy', 'sw_move_probe_have_dy', 'sw_move_probe_solid', 'sw_move_probe_solid_done'];

test('T6 audit: the retired probe routines are absent from the assembled symbol table, and move_tick calls sw_pstep_*', boots, async () => {
  const { syms, nes } = await buildBoot(moveProject('right', 0, 40, 8));
  for (const name of RETIRED) assert.equal(syms[name], undefined, `${name} must not be assembled`);
  assert.deepEqual(Object.keys(syms).filter((n) => /^sw_move_probe/.test(n)), [], 'no renamed duplicate of the probe family');
  // move_tick's bytes (the kernel is fixed in $C000-$FFFF) contain a JSR to every direction of the shared driver
  const [lo, hi] = spanOf(syms, 'move_tick', 'move_get_x');
  const jsrs = new Set();
  for (let a = lo; a < hi - 2; a++) {
    if (nes.mmap.load(a) !== 0x20) continue;
    const target = nes.mmap.load(a + 1) | (nes.mmap.load(a + 2) << 8);
    for (const dir of ['down', 'up', 'left', 'right']) if (target === syms[`sw_pstep_${dir}`]) jsrs.add(dir);
  }
  assert.deepEqual([...jsrs].sort(), ['down', 'left', 'right', 'up'], 'move_tick must contain a jsr sw_pstep_<dir> for each direction');
});

for (const dir of ['right', 'left', 'down', 'up']) {
  test(`T6 trace ${dir}: sw_pstep_${dir} executes on every tick and no PC of the Move ever falls in a probe of its own`, boots, async () => {
    const ax = AXIS[dir];
    const screen = { right: 0, left: 1, down: 0, up: 3 }[dir];
    const start = { right: 40, left: 200, down: 40, up: 200 }[dir];
    const { nes, mem, syms } = await buildBoot(moveProject(dir, screen, start, 24));
    // every routine that reads a neighbour tile for a player step, other than the one the shared driver itself owns:
    // the ordinary current-screen probe and the Move's own ordinary arms (retired probes are audited absent above)
    const forbidden = [
      spanOf(syms, 'probe_solid'),
      spanOf(syms, 'move_tick_ordinary', 'move_advance')
    ];
    const names = { probe_solid: 'probe_solid', ordinary: 'move_tick_ordinary..move_advance' };
    const entries = { down: syms.sw_pstep_down, up: syms.sw_pstep_up, left: syms.sw_pstep_left, right: syms.sw_pstep_right };
    const moveTickAt = syms.move_tick;
    let ticks = 0;
    let stepEntries = 0;
    let inMove = false;
    let wrongEntry = 0;
    const hits = [];
    assert.ok(awaitMoveStart(nes) >= 0);
    const owner = probeOwnership(nes, syms);
    const unwatch = tracePc(nes, (pc) => {
      if (pc === moveTickAt) { ticks++; inMove = true; }
      if (!inMove) return;
      if (pc === entries[dir]) stepEntries++;
      for (const other of Object.keys(entries)) if (other !== dir && pc === entries[other]) wrongEntry++;
      if (forbidden.some(([a, b]) => pc >= a && pc < b)) hits.push(pc);
    });
    try {
      for (let i = 0; i < 40 && mem[A.MV_LEFT] !== 0; i++) nes.frame();
    } finally {
      unwatch();
      owner.unwatch();
    }
    assert.equal(mem[A.MV_LEFT], 0, 'the Move ended');
    assert.equal(owner.report().ticks, ticks, 'the ownership trace saw the same ticks');
    assert.ok(owner.report().reads.length >= 2 * ticks, `the trace saw the collision-table reads themselves (${owner.report().reads.length} reads over ${ticks} ticks)`);
    assert.deepEqual(ownershipViolations(owner.report()), [], 'every terrain read of the Move is asked for by the shared driver, twice per tick (both leading corners)');
    assert.ok(ticks >= 12, `move_tick ran on every Move frame (${ticks})`);
    assert.equal(stepEntries, ticks, `sw_pstep_${dir} executed exactly once per tick (${stepEntries} entries, ${ticks} ticks)`);
    assert.equal(wrongEntry, 0, 'no other direction of the shared driver ran');
    assert.deepEqual(hits.slice(0, 5).map((p) => p.toString(16)), [], `no PC fell in a probe of its own (${names.probe_solid}, ${names.ordinary})`);
  });
}

// ------------------------------------------------------------------ T6 controls: the audit itself must catch a hidden probe
//
// Review 1 (required change 3): a name check cannot find a probe that is merely RENAMED. These controls put a duplicate probe into the
// assembled move_tick path through a Code Forge override of engine/entities.asm -- an extra, EXECUTED collision probe outside the
// shared driver -- and require the very audit T6 runs above to report it: unconditional, direction-conditional (only left Moves run
// it, so a test that audits one direction would miss it), and an inline read of the collision table with no helper call at all.

const ENTITIES = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../engine/entities.asm'), 'utf8');
const DUP_ROUTINE = 'renamed_probe_dup:\n  jsr sw_hazard_probe_solid\n  rts\n';
const AFTER_STEP = 'move_tick_s_done:\n';
const DUPLICATES = {
  unconditional: { text: `${AFTER_STEP}  jsr renamed_probe_dup\n`, routine: DUP_ROUTINE, flagged: ['left', 'right'] },
  'direction-conditional (left only)': {
    text: `${AFTER_STEP}  lda <mv_dir\n  cmp #DIR_LEFT\n  bne move_tick_dupskip\n  jsr renamed_probe_dup\nmove_tick_dupskip:\n`,
    routine: DUP_ROUTINE, flagged: ['left'], clean: ['right']
  },
  'inline collision-table read, no helper': {
    text: `${AFTER_STEP}  tya\n  pha\n  ldy #0\n  lda mt_collision,y\n  pla\n  tay\n`,
    routine: '', flagged: ['left', 'right']
  }
};

/** entities.asm with a duplicate probe added: the routine (if any) before move_tick, the call after the shared driver's step. */
function withDuplicate({ text, routine }) {
  assert.equal(ENTITIES.split(AFTER_STEP).length, 2, 'the step bracket must appear once in entities.asm');
  assert.equal(ENTITIES.split('\nmove_tick:\n').length, 2, 'move_tick must appear once in entities.asm');
  return ENTITIES.replace(AFTER_STEP, text).replace('\nmove_tick:\n', `\n${routine}move_tick:\n`);
}

async function ownershipOf(dir, override) {
  const screen = { right: 0, left: 1, down: 0, up: 3 }[dir];
  const start = { right: 40, left: 200, down: 40, up: 200 }[dir];
  const project = moveProject(dir, screen, start, 24);
  if (override) project.code.overrides.push({ name: 'entities.asm', text: override });
  const { nes, mem, syms } = await buildBoot(project);
  assert.ok(awaitMoveStart(nes) >= 0);
  const owner = probeOwnership(nes, syms);
  try {
    for (let i = 0; i < 40 && mem[A.MV_LEFT] !== 0; i++) nes.frame();
  } finally {
    owner.unwatch();
  }
  assert.equal(mem[A.MV_LEFT], 0, 'the Move ended');
  return ownershipViolations(owner.report());
}

for (const [name, dup] of Object.entries(DUPLICATES)) {
  for (const dir of dup.flagged) {
    test(`T6 control, ${name}, ${dir}: the ownership audit reports the extra executed probe`, boots, async () => {
      const found = await ownershipOf(dir, withDuplicate(dup));
      assert.ok(found.length > 0, `the audit must flag a duplicate probe in a ${dir} Move`);
      assert.match(found[0], /probes entered the helper family|outside the shared driver|outside the probe helpers/);
    });
  }
  for (const dir of dup.clean ?? []) {
    test(`T6 control, ${name}, ${dir}: a direction the duplicate does not run in stays clean (the audit is per direction)`, boots, async () => {
      assert.deepEqual(await ownershipOf(dir, withDuplicate(dup)), []);
    });
  }
}

test('T6 control: the unmodified engine is clean in every direction (the controls above differ from it only by the duplicate)', boots, async () => {
  for (const dir of ['right', 'left', 'down', 'up']) assert.deepEqual(await ownershipOf(dir, null), [], dir);
});

// ------------------------------------------------------------------ T5b: the shared driver's perpendicular insets
//
// streamedmove.test.js's four "probe inset" tests were rewritten (Chris's ruling, option A) to pin the shared driver's rule; their
// scenes are repeated here as a second, independent expression of it -- the shared driver's leading-edge probes sit at
// BODY_L / BODY_R / BODY_T / BODY_B.

// The retired vertical arms probed ONE perpendicular inset (BODY_L); the shared driver probes both leading corners (BODY_L and
// BODY_R), exactly as the held walk always has (Chris's ruling: a streamed Move collides as walking does). So a vertical Move at
// x = 243 -- whose right corner 243 + 13 = 256 is the neighbour's column 0 -- is blocked by that solid column where the earlier
// Move completed. x = 242 (right corner 255) still completes: the pair pins the boundary on both sides. The horizontal y = 225
// cases below are behaviourally UNCHANGED from the retired probe (it already probed BODY_B).
for (const dir of ['down', 'up']) {
  for (const [x, completes] of [[243, false], [242, true]]) {
    test(`T5b ${dir}: a Move at x = ${x} ${completes ? 'completes' : 'is blocked'} (the right corner ${x} + BODY_R = ${x + BODY.R} ${completes ? 'is still inside' : 'reaches'} the neighbour's solid column 0)`, boots, async () => {
      const start = dir === 'down' ? 40 : 60;
      const project = terrainProject({
        commands: [{ op: 'move', who: 'player', dir, dist: 20 }],
        startX: x, startY: start, moveScreen: 0,
        solids: colOffsets(0).map((offset) => ({ screen: 1, offset }))
      });
      const { nes, mem } = await buildBoot(project);
      assert.ok(awaitMoveStart(nes) >= 0);
      for (let i = 0; i < 40 && mem[A.MV_LEFT] !== 0; i++) nes.frame();
      const full = dir === 'down' ? 60 : 40;
      assert.equal(mem[A.PLAYER_Y], completes ? full : start, completes ? 'the full 20 px' : 'blocked on the first tick, nothing moved');
    });
  }
}

for (const dir of ['right', 'left']) {
  test(`T5b ${dir}: a Move at y = 225 is blocked by the bottom neighbour's solid row 0 (BODY_B reaches 240)`, boots, async () => {
    const project = terrainProject({
      commands: [{ op: 'move', who: 'player', dir, dist: 20 }],
      startX: 100, startY: 225, moveScreen: 0,
      solids: rowOffsets(0).map((offset) => ({ screen: 3, offset }))
    });
    const { nes, mem } = await buildBoot(project);
    assert.ok(awaitMoveStart(nes) >= 0);
    for (let i = 0; i < 40 && mem[A.MV_LEFT] !== 0; i++) nes.frame();
    assert.equal(mem[A.PLAYER_X], 100, 'blocked on the first tick by the neighbour row BODY_B reaches (BODY_T would stay on the open screen)');
  });
}
