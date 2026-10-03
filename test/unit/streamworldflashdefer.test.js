// Large streamed worlds (ROADMAP item 15), phase 3a slice S1: a row-strip arm is skipped on a main-loop body
// whose flash_left reads either Flash publication value at the guard (docs/reference-engine.md, "The row-arm guard
// keeps a row strip off a Flash publication body"). The one exception is a script Flash re-armed AFTER flash_tick in
// a Flash-on body (SYNTHETIC here, allowReArm); exclusion for authored schedules is observed, not proven.
//
// engine/streamworld.asm's sw_win_arm_flash_guard returns through sw_win_arm_done when flash_left is
//   FLASH_PENDING      -- the body flash_tick queued the 35-byte restore packet (the restore publication), or
//   FLASH_ARM_VALUE-1  -- the body flash_tick ran flash_apply_on (35 bytes) and decremented 7 to 6 (Flash-on)
// and nothing has advanced by then (the window origin is stepped only by sw_win_row_inc/dec, below the guard),
// so a later body recomputes the same desired row and arms it. A column arm is decided above the guard and is
// not covered. A script's Flash command re-arms flash_left AFTER flash_tick and BEFORE the guard (flash_tick
// boot.asm:218, settle_owed :249, dispatch_input :287, update_player :302), so a re-arm makes the guard read
// FLASH_ARM_VALUE and never 6/FF: a deferral is always a publication body, and never two bodies in a row.
//
// Three layers, each written so the wrong implementation named beside it cannot pass:
//   (U) the guard as a unit through callRoutine(sw_win_arm), on both game types, in both row directions
//       (local and screen wrap), both publication states, an idle and an in-flight strip. Fails for: guard removed,
//       wrong value, one publication missing, coordinates advanced before the guard returns, an upward bypass.
//   (I) real ROM walks under PC hooks (test/lib/flashdeferwalk.js): authored Flash touches in both directions and
//       both states; a column/row competition; repeated authored schedules; script re-arm and a frozen world.
//       `checkLaws` states the laws once, so every schedule is judged by the same ones.
//   (B) the bytes of the guard, and its absence without Flash.
// The synthetic RAM-poke schedules (a poke is not authored content) are labelled SYNTHETIC in their names.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { callRoutine } from '../lib/callroutine.js';
import { eightSplit } from '../lua/sw_manifest_scene.mjs';
import {
  A, BTN, bootScene, traceRun, checkLaws, WALK_DOWN, WALK_UP, rowAbs, colAbs, isPublication
} from '../lib/flashdeferwalk.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm && 'nesasm not found on PATH';

const { FLASH_LEFT, FLASH_PENDING, FLASH_ARM_VALUE, ST_ACTIVE, ST_CUR, ST_LEN, SBUF, SBUF_LEN } = A;
const FLASH_ON_BODY = FLASH_ARM_VALUE - 1; // flash_left at the guard on the Flash-on publication body
const PUBLICATIONS = [['restore', FLASH_PENDING], ['Flash-on', FLASH_ON_BODY]];
// legitimate non-publication values of the state machine (0 idle, 1..5 counting down, 7 just armed by a script) and $FE
const NON_PUBLICATION = [0, 1, 2, 3, 4, 5, FLASH_ARM_VALUE, 0xfe];

// ---- (U) the guard as a unit -----------------------------------------------------------------------------------

const snap = (mem) => ({
  row: rowAbs(mem), col: colAbs(mem), act: mem[ST_ACTIVE], cur: mem[ST_CUR], len: mem[ST_LEN],
  sbuf: Array.from(mem.slice(SBUF, SBUF + SBUF_LEN)).join(',')
});
const setRow = (mem, abs) => { mem[A.WIN_ROW_SCREEN] = Math.floor(abs / 15); mem[A.WIN_ROW_LOCAL] = abs % 15; };
const setDesiredRow = (mem, abs) => { mem[A.SW_FC_DESR] = Math.floor(abs / 15); mem[A.SW_FC_DESRL] = abs % 15; };
const setDesiredCol = (mem, abs) => { mem[A.SW_FC_DESC] = Math.floor(abs / 16); mem[A.SW_FC_DESL] = abs % 16; };
// a leftover marker in the stream buffer: a wrongly-prepared buffer (or a stale one) then shows as a change
const idle = (mem) => { mem[ST_ACTIVE] = 0; mem[ST_CUR] = 0; mem[ST_LEN] = 0; for (let i = 0; i < SBUF_LEN; i++) mem[SBUF + i] = 0xc0 + i; };
const inFlight = (mem, kind) => { mem[ST_ACTIVE] = kind; mem[ST_CUR] = 5; mem[ST_LEN] = 20; for (let i = 0; i < SBUF_LEN; i++) mem[SBUF + i] = 0xa0 + i; };

/**
 * A window whose row origin is at `local` of a screen well inside the map, wanting exactly one row `dir`
 * ('down' = +1, 'up' = -1) and no column. `local` 14 going down and 0 going up cross a screen boundary.
 */
function wantRow(mem, base, dir, local) {
  const from = base * 15 + local;
  setRow(mem, from);
  setDesiredRow(mem, from + (dir === 'down' ? 1 : -1));
  setDesiredCol(mem, colAbs(mem));
  idle(mem);
  return from;
}
const ROW_CASES = [['down', 3], ['down', 14], ['up', 7], ['up', 0]]; // [direction, local]: mid, screen wrap down, mid, screen wrap up

for (const gt of ['action', 'rpg']) {
  let env;
  const boot = async () => {
    if (!env) {
      env = await bootScene({ gt, flashAt: [242, 225] });
      for (let i = 0; i < 30; i++) env.nes.frame(); // let the window install itself: the tests stand it on chosen rows
    }
    return env;
  };

  test(`sw_win_arm's Flash guard (${gt}): both publications defer in both row directions, changing nothing; the row then arms exactly one step`, { skip }, async () => {
    const { nes, mem, code } = await boot();
    const base = mem[A.WIN_ROW_SCREEN] - 4;
    for (const [dir, local] of ROW_CASES) {
      for (const [name, fl] of PUBLICATIONS) {
        const tag = `${gt} ${dir} local ${local} ${name}`;
        const from = wantRow(mem, base, dir, local);
        const before = snap(mem);
        mem[FLASH_LEFT] = fl;
        callRoutine(nes, code.sw_win_arm);
        assert.deepEqual(snap(mem), before, `${tag}: a publication body must leave the window, the strip state and the stream buffer exactly as they were`);
        // one body later: nothing pending, the very same wanted row arms and steps the origin by exactly one
        mem[FLASH_LEFT] = 0;
        callRoutine(nes, code.sw_win_arm);
        const to = from + (dir === 'down' ? 1 : -1);
        assert.equal(rowAbs(mem), to, `${tag}: the deferred row arms and steps the window exactly one row ${dir}`);
        assert.equal(mem[ST_ACTIVE], 2, `${tag}: and it is a row strip`);
        assert.notEqual(snap(mem).sbuf, before.sbuf, `${tag}: and the stream buffer was prepared`);
        assert.ok(mem[ST_LEN] > 0, `${tag}: with a non-empty strip`);
      }
    }
  });

  test(`sw_win_arm's Flash guard (${gt}): a strip already in flight is untouched by a publication body, whichever kind`, { skip }, async () => {
    const { nes, mem, code } = await boot();
    const base = mem[A.WIN_ROW_SCREEN] - 4;
    for (const kind of [1, 2]) {
      for (const [dir, local] of ROW_CASES) {
        for (const fl of [FLASH_PENDING, FLASH_ON_BODY, 0]) {
          wantRow(mem, base, dir, local);
          inFlight(mem, kind);
          const before = snap(mem);
          mem[FLASH_LEFT] = fl;
          callRoutine(nes, code.sw_win_arm);
          assert.deepEqual(snap(mem), before, `${gt} strip ${kind} ${dir} local ${local} flash_left=${fl}: an in-flight strip and the window are left alone`);
        }
      }
    }
  });

  test(`sw_win_arm's Flash guard (${gt}): control -- every non-publication flash_left (0-5, 7, $FE) arms the row, both directions, both wraps`, { skip }, async () => {
    const { nes, mem, code } = await boot();
    const base = mem[A.WIN_ROW_SCREEN] - 4;
    for (const [dir, local] of ROW_CASES) {
      for (const fl of NON_PUBLICATION) {
        const from = wantRow(mem, base, dir, local);
        mem[FLASH_LEFT] = fl;
        callRoutine(nes, code.sw_win_arm);
        assert.equal(mem[ST_ACTIVE], 2, `${gt} ${dir} local ${local}: flash_left=${fl} must not defer the row`);
        assert.equal(rowAbs(mem), from + (dir === 'down' ? 1 : -1), `${gt} ${dir} local ${local}: flash_left=${fl}: window stepped one row`);
      }
    }
  });

  test(`sw_win_arm's Flash guard (${gt}): column/row competition -- the column arms on a publication body and advances once, the row is unchanged and arms after the column drains`, { skip }, async () => {
    const { nes, mem, code } = await boot();
    const base = mem[A.WIN_ROW_SCREEN] - 4;
    for (const [name, dc, dr] of [['increasing', 1, 1], ['decreasing', -1, -1], ['col+ row-', 1, -1], ['col- row+', -1, 1]]) {
      for (const fl of [FLASH_PENDING, FLASH_ON_BODY, 0]) {
        const tag = `${gt} ${name} flash_left=${fl}`;
        const from = wantRow(mem, base, dr > 0 ? 'down' : 'up', dr > 0 ? 6 : 8);
        const c0 = colAbs(mem);
        setDesiredCol(mem, c0 + dc);
        mem[FLASH_LEFT] = fl;
        callRoutine(nes, code.sw_win_arm);
        assert.equal(colAbs(mem), c0 + dc, `${tag}: the column origin advances exactly one block`);
        assert.equal(rowAbs(mem), from, `${tag}: the row origin does not move on the column's body`);
        assert.equal(mem[ST_ACTIVE], 1, `${tag}: a column strip is now in flight`);
        // a second body while that strip drains: the column is at its desired place, the row must wait for st_active
        const mid = snap(mem);
        callRoutine(nes, code.sw_win_arm);
        assert.deepEqual(snap(mem), mid, `${tag}: the column does not advance twice and the row does not arm over the strip`);
        // the strip has drained; the pending publication is over
        mem[ST_ACTIVE] = 0;
        mem[FLASH_LEFT] = 0;
        callRoutine(nes, code.sw_win_arm);
        assert.equal(rowAbs(mem), from + dr, `${tag}: the row then arms, one step`);
        assert.equal(colAbs(mem), c0 + dc, `${tag}: and the column stays where it went`);
        assert.equal(mem[ST_ACTIVE], 2, `${tag}: as a row strip`);
      }
    }
  });
}

// ---- (B) the bytes ---------------------------------------------------------------------------------------------

for (const gt of ['action', 'rpg']) {
  test(`sw_win_arm's Flash guard (${gt}): is lda <flash_left / cmp #FLASH_PENDING / beq / cmp #FLASH_ARM_VALUE-1 / beq, ten bytes`, { skip }, async () => {
    const { nes, code } = await bootScene({ gt, flashAt: [242, 225] });
    const g = code.sw_win_arm_flash_guard;
    assert.equal(code.sw_win_arm_flash_guard_end - g, 10, 'the guard is ten bytes when Flash is in the build');
    const done = code.sw_win_arm_done;
    const rel = (at) => (done - (at + 2)) & 0xff;
    // machine code: the two values are byte-level facts, checked apart from the behaviour so each fails alone
    assert.deepEqual(Array.from(nes.cpu.mem.slice(g, g + 10)), [
      0xa5, FLASH_LEFT, 0xc9, FLASH_PENDING, 0xf0, rel(g + 4), 0xc9, FLASH_ON_BODY, 0xf0, rel(g + 8)
    ]);
  });
}

test('a project with no Flash carries no guard bytes', { skip }, async () => {
  // shake only: no Flash command anywhere, so FLASH_ENABLED is 0 and the guard's span is empty
  const { code } = await bootScene({ gt: 'action', flashAt: [242, 225], flashCmds: [{ op: 'shake', frames: 10 }] });
  assert.equal(code.sw_win_arm_flash_guard_end - code.sw_win_arm_flash_guard, 0);
});

// ---- (I) real walks --------------------------------------------------------------------------------------------

const memo = new Map();
const traced = (key, make) => { if (!memo.has(key)) memo.set(key, make()); return memo.get(key); };
const run = (opts, steps, tr) => bootScene(opts).then((env) => traceRun(env, steps, tr));

/** The first body after `b` that reaches the guard with an idle strip: the next eligible arm. */
const nextEligible = (trace, b) => trace.bodies.find((x) => x.n > b.n && x.guard && x.guard.stActive === 0 && x.guard.wantsRow);
const explain = (laws) => `${laws.violations.length} law violation(s), first: ${laws.violations[0]}`;
const kind = (b) => (b.guard.fl === FLASH_PENDING ? 'restore' : 'Flash-on');

// The authored touch Shake/Flash/Sfx npc on the walk's corridor, x=242. y picks the phase of its publications against
// the row arms; these four (found by sweeping y over the whole screen) each produce an actual deferral of a WANTED row:
// [y, direction, publication]. Down is the walk into the eight-actor target, up the trip back.
// Phase 3a S3a.5 made the camera routine constant-cost, which moves every body's phase against the touch, so the two
// UP rows were re-found by the same sweep (even y over 0..239, node only; each of 46 and 22 is the sole deferral kind
// there, and checkLaws reports zero violations at both); the two DOWN rows still defer where they did.
const AUTHORED = [[225, 'down', 'restore'], [234, 'down', 'Flash-on'], [46, 'up', 'restore'], [22, 'up', 'Flash-on']];

for (const [y, dir, state] of AUTHORED) {
  test(`authored Flash touch at (242,${y}), 16 tiles in view: a row wanted ${dir} on the ${state} publication is deferred, and armed on the next eligible body`, { skip }, async () => {
    const trace = await traced(`auth-${y}`, () => run({ gt: 'action', sizes: eightSplit(16), flashAt: [242, y] }, [...WALK_DOWN, ...WALK_UP]));
    const laws = checkLaws(trace);
    assert.deepEqual(laws.violations, [], explain(laws));
    const hit = trace.deferrals.filter((b) => b.guard.dir === dir && kind(b) === state);
    assert.ok(hit.length >= 1, `expected an actual ${state} deferral of a ${dir} row; saw ${trace.deferrals.map((b) => b.guard.dir + ':' + kind(b)).join(' ') || 'none'}`);
    for (const b of hit) {
      // the hooks, not body-start flash_left, say which publication this body carried
      assert.ok(state === 'Flash-on' ? b.applyOn : b.restorePub, `body ${b.n}: hooks should show the ${state} publication in the deferred body`);
      assert.ok(!b.startRow, `body ${b.n}: no sw_stream_start_row in the publication body`);
      const next = nextEligible(trace, b);
      assert.ok(next, `body ${b.n}: a later body must arm the row`);
      assert.ok(next.startRow, `body ${next.n}: the next eligible body arms the deferred row`);
      assert.ok(next.n - b.n <= 16, `body ${b.n}: armed ${next.n - b.n} bodies later (a column strip may intervene, no more than one strip's length)`);
    }
  });
}

test('authored (242,234) with UNEVEN art (3,2,2,2,1,1,1,1 tiles): the Flash-on publication that overran at 31,891 cycles defers; no publication body arms', { skip }, async () => {
  const trace = await traced('uneven13', () => run({ gt: 'action', sizes: [3, 2, 2, 2, 1, 1, 1, 1], flashAt: [242, 234] }, WALK_DOWN));
  const laws = checkLaws(trace);
  assert.deepEqual(laws.violations, [], explain(laws));
  const hit = trace.deferrals.filter((b) => b.applyOn && b.guard.fl === FLASH_ON_BODY);
  assert.ok(hit.length >= 1, 'the coincidence scene must reach a Flash-on publication with a wanted row');
  for (const b of hit) assert.ok(b.applyOn && !b.startRow && !b.restorePub, `body ${b.n}: flash_apply_on and sw_stream_start_row never share a body`);
  // and the restore publication of the same Flash, six bodies later, also carries no arm
  for (const b of trace.publications) assert.ok(!b.startRow, `body ${b.n}: no publication body (either kind) arms a row`);
  assert.ok(trace.publications.some((b) => b.restorePub), 'the same Flash reaches its restore publication');
});

test('a Flash-free build and a Flash-built scene whose Flash never fires arm the same rows on the same bodies (the guard is inert with no publication)', { skip }, async () => {
  const steps = [...WALK_DOWN, ...WALK_UP];
  const armed = (t) => t.bodies.filter((b) => b.startRow).map((b) => b.n).join(',');
  const free = await traced('free', () => run({ gt: 'action', sizes: eightSplit(16), flashAt: [12, 15], flashCmds: [{ op: 'shake', frames: 10 }] }, steps));
  // Flash present, npc parked in a far corner (as in the Flash-free build): the guard exists and is never asked to defer
  const off = await traced('off', () => run({ gt: 'action', sizes: eightSplit(16), flashAt: [12, 15] }, steps));
  assert.equal(free.flashGuardExists, false);
  assert.equal(off.flashGuardExists, true);
  assert.equal(off.publications.length, 0, 'no Flash fires in the parked scene');
  assert.equal(off.deferrals.length, 0);
  assert.ok(off.bodies.filter((b) => b.startRow).length >= 40, 'both directions arm plenty of rows');
  assert.equal(armed(off), armed(free), 'the arm bodies are identical, body for body');
});

// ---- column / row competition on a real walk (SYNTHETIC publications: the RAM poke forces the coincidence) ------

test('SYNTHETIC column/row competition on a diagonal walk: a column arms on a publication body, moves once, the row stays, and the row later completes before it is visible (increasing and decreasing)', { skip }, async () => {
  let forced = 0;
  const poke = (rec, mem) => {
    // a Flash again the moment the last one has finished, alternately Flash-on (7) and restore (1: ticks to FLASH_PENDING):
    // a publication every ~8 bodies drifts across the ~11-body column and row arm periods, so it lands on arms of both kinds
    if (rec.n > 100 && mem[FLASH_LEFT] === 0) mem[FLASH_LEFT] = forced++ % 2 ? 1 : FLASH_ARM_VALUE;
  };
  const trace = await traced('compete', () => run({ gt: 'action', sizes: eightSplit(16) }, [...WALK_DOWN, ...WALK_UP], { poke }));
  const laws = checkLaws(trace);
  assert.deepEqual(laws.violations, [], explain(laws));
  const both = trace.bodies.filter((b) => isPublication(b) && b.startCol);
  const dirOf = (b) => Math.sign(b.done.col - b.col0);
  for (const want of [1, -1]) {
    const hit = both.filter((b) => dirOf(b) === want);
    assert.ok(hit.length >= 1, `expected a column arming ${want > 0 ? 'increasing' : 'decreasing'} on a publication body; saw ${both.length} such bodies`);
    for (const b of hit) {
      assert.equal(Math.abs(b.done.col - b.col0), 1, `body ${b.n}: the column origin advances exactly once`);
      assert.equal(b.done.row, b.row0, `body ${b.n}: the row origin does not move on the column's body`);
      assert.ok(!b.startRow, `body ${b.n}: and no row strip arms`);
    }
  }
  assert.ok(trace.rows.length >= 30, 'and the rows of the walk complete');
  for (const r of trace.rows) assert.ok(r.margin >= 5, `row armed at body ${r.arm} (${r.dir}) finished with ${r.margin} visible blocks in hand`);
});

// ---- repeated schedules, actual deferrals at both states -------------------------------------------------------

const backlog = (t) => Math.max(...t.bodies.filter((b) => b.guard).map((b) => b.guard.backlogRow));

test('repeated authored Flash schedules (dense touch-Flash npcs, both directions, static and moving, narrow and wide art): the laws hold, the deadline keeps its margin and the backlog stays within one row of the Flash-free control', { skip }, async () => {
  const steps = [...WALK_DOWN, ...WALK_UP];
  const cases = [
    { name: 'gauntlet dy 2 y0 40', opts: { gauntlet: [242, 40, 2] } },
    { name: 'gauntlet dy 8 y0 50', opts: { gauntlet: [242, 50, 8] } },
    { name: 'gauntlet dy 12 y0 30', opts: { gauntlet: [242, 30, 12] } },
    { name: 'gauntlet dy 16 y0 50', opts: { gauntlet: [242, 50, 16] } },
    { name: 'gauntlet dy 12 y0 30, wide art', opts: { gauntlet: [242, 30, 12], wide: true } },
    { name: 'moving chaser that re-touches with a Flash', opts: { flashAt: [200, 100], flashBeh: 'chaser', flashCmds: [{ op: 'flash' }] } }
  ];
  const seen = new Set();
  let deferrals = 0;
  for (const c of cases) {
    const trace = await traced(c.name, () => run({ gt: 'action', sizes: eightSplit(16), ...c.opts }, steps));
    const laws = checkLaws(trace, { maxFrames: 14 });
    assert.deepEqual(laws.violations, [], `${c.name}: ${explain(laws)}`);
    assert.ok(trace.rows.length >= 40, `${c.name}: a long populated route (${trace.rows.length} rows)`);
    for (const b of trace.deferrals) seen.add(`${b.guard.dir}:${kind(b)}`);
    deferrals += trace.deferrals.length;
    // the Flash-free control of the same scene: same walk, the npcs' events shake instead
    const control = await traced(c.name + ' (control)', () => run({ gt: 'action', sizes: eightSplit(16), ...c.opts, flashCmds: [{ op: 'shake', frames: 10 }] }, steps));
    assert.equal(control.deferrals.length, 0, `${c.name}: the Flash-free control never defers`);
    assert.ok(backlog(trace) <= backlog(control) + 1, `${c.name}: backlog ${backlog(trace)} rows against the control's ${backlog(control)}`);
  }
  for (const s of ['down:restore', 'down:Flash-on', 'up:restore', 'up:Flash-on']) assert.ok(seen.has(s), `the schedules must reach an actual ${s} deferral; reached ${[...seen].join(' ')}`);
  assert.ok(deferrals >= 15, `enough deferrals to mean something (${deferrals})`);
});

test('a longer populated route (two round trips of the dense touch-Flash gauntlet) keeps every row within its deadline', { skip }, async () => {
  const trace = await traced('long', () => run({ gt: 'action', sizes: eightSplit(16), gauntlet: [242, 30, 12] }, [...WALK_DOWN, ...WALK_UP, ...WALK_DOWN, ...WALK_UP]));
  const laws = checkLaws(trace, { maxFrames: 14 });
  assert.deepEqual(laws.violations, [], explain(laws));
  assert.ok(trace.rows.length >= 120, `two round trips arm ${trace.rows.length} rows`);
  assert.ok(trace.deferrals.length >= 6, `and several are deferred (${trace.deferrals.length})`);
});

test('a sustained populated stretch (six consecutive populated screens, both ways, moving actors and touch Flashes) keeps every row within its deadline and the backlog within one row of the Flash-free control', { skip }, async () => {
  // scene `stretch: 6`: six consecutive screens of the walk column, each with two chasers, four static touch-Flash
  // npcs 14 px apart on the corridor and two chasers whose touch event is Flash; the route is the reference walk
  // continued down through all six and back up through them
  const route = [{ frames: 95, held: [BTN.DOWN] }, { frames: 260, held: [BTN.RIGHT, BTN.DOWN] }, { frames: 1200, held: [BTN.DOWN] }, { frames: 1400, held: [BTN.UP] }];
  // (a1) halved the chasers' steps, which moves their touch Flashes against the row arms; the four static touch npcs
  // are authored one pixel higher ([39,53,67,81], not [40,54,68,82]) so the same route meets >= 6 deferrals
  const scene = { gt: 'action', sizes: eightSplit(16), stretch: 6, stretchTouchYs: [39, 53, 67, 81] };
  const trace = await traced('stretch', () => run(scene, route));
  const laws = checkLaws(trace, { maxFrames: 14 });
  assert.deepEqual(laws.violations, [], explain(laws));
  const screenOf = (b) => Math.floor(b.row0 / 15);
  const pubScreens = [...new Set(trace.publications.map(screenOf))].sort((a, b) => a - b);
  assert.ok(pubScreens.length >= 6 && pubScreens[pubScreens.length - 1] - pubScreens[0] === pubScreens.length - 1, `publications fall on six CONSECUTIVE screens (${pubScreens})`);
  const deferScreens = new Set(trace.deferrals.map(screenOf));
  assert.ok(deferScreens.size >= 4, `deferrals recur across the stretch, not in one spot (screens ${[...deferScreens]})`);
  assert.ok(trace.deferrals.length >= 6, `and are numerous (${trace.deferrals.length})`);
  assert.ok(trace.rows.length >= 150, `a long route arms ${trace.rows.length} rows`);
  // the dense intervals: every row whose strip lived through a publication body
  const dense = trace.rows.filter((r) => trace.publications.some((b) => b.n >= r.arm - 1 && b.n <= r.done));
  assert.ok(dense.length >= 30, `enough rows lived through a publication (${dense.length})`);
  for (const r of dense) {
    assert.ok(r.frames <= 14, `a dense row armed at body ${r.arm} took ${r.frames} bodies`);
    assert.ok(r.margin >= 5, `a dense row armed at body ${r.arm} finished with ${r.margin} visible blocks in hand`);
  }
  const control = await traced('stretch (control)', () => run({ ...scene, flashCmds: [{ op: 'shake', frames: 10 }] }, route));
  assert.equal(control.deferrals.length, 0, 'the Flash-free control of the same stretch never defers');
  assert.ok(backlog(trace) <= backlog(control) + 1, `backlog ${backlog(trace)} rows against the control's ${backlog(control)}`);
});

test('authored two-Flash events (Flash, Wait w, Flash; w = 1, 2, 3, 6) on the populated stretch: no Flash-on body arms a row -- observed here, NOT proven for every authorable schedule', { skip }, async () => {
  const route = [{ frames: 95, held: [BTN.DOWN] }, { frames: 260, held: [BTN.RIGHT, BTN.DOWN] }, { frames: 1200, held: [BTN.DOWN] }, { frames: 1400, held: [BTN.UP] }];
  for (const w of [1, 2, 3, 6]) {
    const trace = await traced(`twoflash${w}`, () => run({ gt: 'action', sizes: eightSplit(16), stretch: 6, flashCmds: [{ op: 'flash' }, { op: 'wait', frames: w }, { op: 'flash' }] }, route));
    // allowReArm is set so that a coincidence would be COUNTED rather than fail the law; the assertion below is on the count
    const laws = checkLaws(trace, { maxFrames: 20, minMargin: 1, allowReArm: true });
    assert.deepEqual(laws.violations, [], `w=${w}: ${explain(laws)}`);
    assert.equal(laws.stats.reArmCoincidence, 0, `w=${w}: a script's second Flash landed in a Flash-on body and that body armed a row`);
    assert.ok(trace.publications.length >= 100 && trace.deferrals.length >= 3, `w=${w}: a dense route (${trace.publications.length} publications, ${trace.deferrals.length} deferrals)`);
  }
});

// ---- script re-arm and a frozen world --------------------------------------------------------------------------

test('SYNTHETIC script re-arm every second body: deferrals alternate with arms, never two in a row, and no row starves', { skip }, async () => {
  let k = 0;
  // pokeScript = after flash_tick, before the guard: where a script Flash command lands
  const pokeScript = (rec, mem) => { if (k++ % 2 === 0 && rec.n > 100) mem[FLASH_LEFT] = FLASH_ARM_VALUE; };
  const trace = await traced('rearm2', () => run({ gt: 'action', sizes: eightSplit(16), flashAt: [12, 15] }, [...WALK_DOWN, ...WALK_UP], { pokeScript }));
  // SYNTHETIC: a 35-byte publication every second body takes the vblank the strip itself drains in, with or without the
  // guard (the guard removed measures 3 blocks, kept 3-4): the requirement here is only that a row is complete BEFORE it shows
  const laws = checkLaws(trace, { maxFrames: 16, minMargin: 1, allowReArm: true });
  assert.deepEqual(laws.violations, [], explain(laws));
  assert.ok(trace.deferrals.length >= 10, `re-arming defers repeatedly (${trace.deferrals.length}) yet never consecutively`);
  assert.ok(trace.rows.length >= 40, 'and rows keep arming');
  for (const b of trace.deferrals) {
    const nxt = trace.bodies[b.n + 1];
    assert.ok(!nxt || !nxt.guard || nxt.guardPassed, `body ${b.n}: the body after a deferral is never itself a deferral`);
  }
});

test('SYNTHETIC script re-arm on EVERY body: the guard reads FLASH_ARM_VALUE, never defers, and the rows arm (a residual the guard cannot see, pinned so it is not forgotten)', { skip }, async () => {
  const pokeScript = (rec, mem) => { if (rec.n > 100) mem[FLASH_LEFT] = FLASH_ARM_VALUE; };
  const trace = await traced('rearm1', () => run({ gt: 'action', sizes: eightSplit(16), flashAt: [12, 15] }, WALK_DOWN, { pokeScript }));
  assert.equal(trace.deferrals.length, 0, 'a Flash re-armed between flash_tick and the guard on every body is never deferred');
  const laws = checkLaws(trace, { maxFrames: 18, minMargin: 1, allowReArm: true }); // same: publication bandwidth, margin 2 with or without the guard
  assert.deepEqual(laws.violations, [], explain(laws));
  assert.ok(laws.stats.reArmCoincidence >= 1, 'and the Flash-on publication body then does arm a row: the documented residual');
  assert.ok(trace.rows.length >= 10, `rows keep arming (${trace.rows.length})`);
});

test('a frozen world consumes the publication with no deferral, and the first wanted row after the box closes arms at once', { skip }, async () => {
  // the touch npc on the Down target runs Flash + Say: the dialogue box freezes the world while flash_tick keeps counting
  const held = (i, mem) => (mem[A.GAME_STATE] === 2 && i % 12 === 0 ? [BTN.B, BTN.DOWN] : [BTN.DOWN]); // tap B to advance/close the box, keep walking
  const trace = await traced('frozen', async () => {
    const env = await bootScene({ gt: 'action', sizes: eightSplit(16), sayOnFlash: true });
    return traceRun(env, [
      { frames: 95, held: [BTN.DOWN] }, { frames: 260, held: [BTN.RIGHT, BTN.DOWN] }, { frames: 400, held }
    ]);
  });
  const laws = checkLaws(trace, { maxFrames: 16 });
  assert.deepEqual(laws.violations, [], explain(laws));
  const frozenPubs = trace.bodies.filter((b) => isPublication(b) && !b.guard);
  assert.ok(frozenPubs.length >= 1, `a publication must fall on a frozen body (saw ${trace.publications.length} publications, ${trace.bodies.filter((b) => b.state0 !== 0).length} frozen bodies)`);
  for (const b of frozenPubs) assert.ok(!b.startRow && !b.startCol, `body ${b.n}: a frozen body arms nothing`);
  assert.ok(trace.rows.length >= 8);
});
