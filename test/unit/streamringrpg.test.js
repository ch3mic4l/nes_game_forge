// Phase 3b S5, C1: the RPG-on-a-ring lifecycle, tested on PRODUCTION engine and generator. Ring RPG builds are made through the bypass copy
// (test/lib/ringbypass.js: only the refusal is neutralized), which C1 needed because the admission was C2's. Since C2 admits a streamed RPG, (g) -- the one test whose claim is about
// what a USER can build -- builds through the REAL tree (`bypass: false`, no neutralized refusal at all); the rest keep the copy for its sabotage hook and for the helpers they share.
//
// What the ring gate and the S1..S4 unit tests did not pin on a ring RPG (the C1 audit, handoff-next/s5-c1-r1-report.md):
//   (a) call_battle cancels a strip in flight at battle ENTRY; the battle round trip ends on a window the oracle accepts;
//   (b) the in-game naming grid, aligned and straddling the nametable seam;
//   (g) ruling 3 on an RPG: a save made under one mirroring Continues under the other and the ring is reconstructed;
//   (d) a session start leaves no strip armed: init_session clears it through its tail call_battle(BE_INIT), the resolver clears it again, and the restart picture is the net effect (three tests);
//   (e) settle_owed / screen_fresh on a ring landing: after a battle, after a warp, after Continue.
//
// Wrong implementations these catch (each is a sabotage in handoff-next/s5-c1/sabotage.mjs):
//   call_battle keeping st_active .................. 'call_battle cancels an in-flight strip'
//   battle_end not re-rendering the window ......... 'a battle round trip' (the oracle check) and the screen_fresh check
//   sw_resolve_screen not clearing st_active ....... '(d2)'; call_battle not clearing it ... '(d1)'; both gone ... '(d3)'
//   main_loop skipping settle_owed ................. 'a warp landing' (the destination's entry event never runs)
//   the naming grid written at unwrapped NT coords . 'the naming grid draws the same picture at the seam'
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { makeBypassTree, loadBypassTree } from '../lib/ringbypass.js';
import { cellById, installPpuTrace, aliasRangeOf } from '../lib/ringrun.js';
import fs from 'node:fs';
import { dumpVram, runSteps, bootRom, readState } from '../lua/ring_gate/ringrun_jsnes.mjs';
import { judge } from '../lua/ring_gate/ringjudge.mjs';
import { ringProject } from '../lua/ring_gate/ringworld.mjs';
import { buildThrough } from '../lib/ringbypass.js';
import { buildSymbols } from '../lib/ringrun.js';
import { reconcileCartridge, createMap, growOrShrinkMap } from '../../shared/project.js';
import { saveIdentity } from '../../shared/save.js';
import { callRoutine } from '../lib/callroutine.js';
import { waitForNamingReady, finishNamingIfOpen } from '../lib/naming.js';
import { displayedLiveIndex } from '../lib/ringoracle.js';
import { SIX_CELLS, BTN, tap, fwdButton, buildRing, bootToField, watchDisplayEnable, fightSlime, displayedTile } from '../lib/ringrpg.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm && 'nesasm not found on PATH';
let tree;
let loaded;
let realTree;
let realLoaded;
before(async () => {
  if (skip) return;
  tree = makeBypassTree();
  loaded = await loadBypassTree(tree);
  realTree = makeBypassTree({ bypass: false });
  realLoaded = await loadBypassTree(realTree);
});
after(() => { tree?.dispose(); realTree?.dispose(); });

const START = { x: 120, y: 120 };
/** a one-command enter event */
const enterEvent = (commands) => ({ trigger: 'enter', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } });
const addVar = (variable) => ({ op: 'addVar', variable, value: 1 });
const verdictText = (v) => `${v.label}: ${v.fails.join('; ')}`;

// ---- (a) strip cancel at battle entry ----
for (const id of SIX_CELLS) {
  for (const placement of ['resident', 'banked']) {
    test(`(a) call_battle cancels an in-flight strip on a ring: ${id} rpg ${placement}`, { skip }, async () => {
      const cell = cellById(id);
      const r = await buildRing({ loaded, cell, placement });
      try {
        const nes = r.boot();
        bootToField(nes, r.at);
        const m = nes.cpu.mem;
        nes.buttonDown(1, fwdButton(cell));
        let f = 0;
        while (m[r.at('st_active')] === 0 && f++ < 300) nes.frame();
        nes.buttonUp(1, fwdButton(cell));
        assert.notEqual(m[r.at('st_active')], 0, 'precondition: walking toward the seam must arm a strip');
        nes.cpu.REG_ACC = r.at('BE_RESTORE'); // a non-fight entry: the cancel is call_battle's own, ahead of the cross-bank switch
        callRoutine(nes, r.fns.call_battle);
        assert.equal(m[r.at('st_active')], 0, 'call_battle must cancel the strip before the cross-bank switch, not leave it armed');
      } finally { r.dispose(); }
    });
  }
}

// ---- (a)+(e) a real battle round trip ----
for (const id of SIX_CELLS) {
  for (const placement of ['resident', 'banked']) {
    test(`(a)(e) a battle round trip on a ring: ${id} rpg ${placement}`, { skip }, async () => {
      const cell = cellById(id);
      const r = await buildRing({
        loaded, cell, placement, start: START,
        mutate: (p) => {
          p.sprites.actors[0] = { name: 'Slime', damage: 1, hp: 1, battle: { acc: 0 } };
          p.sprites.actors[1] = { name: 'Marker', behavior: 'npc', hp: 1, damage: 0 };
          p.maps[0].screens[0].entities = [
            { actorId: 1, x: START.x, y: START.y, props: enterEvent([addVar(0)]) },
            { actorId: 0, x: START.x, y: START.y + 32, props: {} }
          ];
        }
      });
      try {
        const nes = r.boot();
        const shots = watchDisplayEnable(nes, r.at);
        bootToField(nes, r.at);
        const m = nes.cpu.mem;
        const V0 = r.at('variables');
        assert.equal(m[V0], 1, 'the entry event ran once when gameplay began');
        const before = shots.length;
        const during = fightSlime(nes, r.at);
        assert.equal(during.st_active, 0, 'a battle runs with no strip armed');
        for (let i = 0; i < 20; i++) nes.frame();
        const back = shots.slice(before).find((s) => s.game_state === 0);
        assert.ok(back, 'the battle return must reach a display-enable in the field state');
        assert.equal(back.screen_fresh, 1, 'screen_fresh is set at the exact frame the return picture appears (spawn_entities, the common landing renderer)');
        assert.equal(back.st_active, 0, 'no strip is armed at the return picture');
        for (let i = 0; i < 60; i++) nes.frame();
        assert.equal(m[r.at('pending_ent')], r.at('NO_ENTITY'), 'the entry event is not left owed after a battle return (battle_end clears pending_ent right after the redraw)');
        assert.equal(m[V0], 1, 'the screen must not run its entry event again when the battle ends');
        const v = r.judgeNow(nes, 'battle-return');
        assert.ok(v.ok, `the live nametables after the round trip disagree with the oracle -- ${verdictText(v)}`);
      } finally { r.dispose(); }
    });
  }
}

// ---- (a) call_battle's immediate return: the switchable window and mtptr are the FIELD's again ----
// call_battle ends `jmp set_screen_ptr` (engine/banks.asm): the restore IS the return, so the PRG bank it leaves mapped and the mtptr player.asm dereferences next frame must be
// the current screen's the instant it returns -- not "eventually, after a later reader reselects its own bank". The scene starts deep in the world (FIELD_FAR), where the screen's region lives in a PRG bank pair
// other than the battle's (asserted below, from the bytes themselves: the window's 16 KB at $8000 read straight after a switch to the battle bank differs from the field's), and
// mtptr is poisoned to $1234 before the call so a restore that never ran cannot pass by coincidence. The window is compared as BYTES (jsnes keeps the mapped PRG in CPU memory),
// so one assertion serves MMC1, MMC3 and UNROM 512 whatever their bank registers look like.
// Wrong implementations caught: set_screen_ptr no longer re-locating the field after call_battle (battle bank left in the window, mtptr left poisoned) -- sabotage no-bank-restore.
const windowBytes = (m) => Buffer.from(m.slice(0x8000, 0xc000));
const MTPTR = (m, at) => m[at('mtptr_lo')] + 256 * m[at('mtptr_hi')];
// a horizontal ring's screen 2 already lives past the battle's bank pair; a vertical ring's screen records are small (about 340 bytes: its first ~24 screens share the battle code's 16 KB window), so it needs a longer world and a start deep in it
const FIELD_FAR = { n: { 1: 60, 2: 4 }, screen: { 1: 55, 2: 2 } };
async function returnContractScene({ cell, placement, entry, label }) {
  const r = await buildRing({ loaded, cell, placement, n: FIELD_FAR.n[cell.ring], start: { screen: FIELD_FAR.screen[cell.ring], x: 120, y: 120 } });
  try {
    const nes = r.boot();
    bootToField(nes, r.at);
    const m = nes.cpu.mem;
    const field = windowBytes(m);
    const fieldPtr = MTPTR(m, r.at);
    assert.ok(fieldPtr >= 0x8000 && fieldPtr < 0xc000, `${label}: mtptr $${fieldPtr.toString(16)} points into the switchable window in the field`);
    // the battle bank's window, read the same way: it must differ from the field's, or the comparison below proves nothing
    nes.cpu.REG_ACC = r.at('BATTLE_BANK');
    callRoutine(nes, r.fns.switch_prg_bank);
    const battle = windowBytes(m);
    assert.ok(!battle.equals(field), `${label}: precondition -- the field's PRG bank differs from the battle bank, so a restore is observable`);
    callRoutine(nes, r.fns.set_screen_ptr);
    assert.ok(windowBytes(m).equals(field), `${label}: set_screen_ptr alone puts the field window back`);
    assert.equal(MTPTR(m, r.at), fieldPtr, `${label}: ...and mtptr`);
    m[r.at('mtptr_lo')] = 0x34;
    m[r.at('mtptr_hi')] = 0x12;
    m[r.at('bt_arg')] = 0x9e;
    nes.cpu.REG_ACC = r.at(entry);
    callRoutine(nes, r.fns.call_battle);
    assert.ok(windowBytes(m).equals(field), `${label}: call_battle(${entry}) returned with the switchable window not on the field's bank (the battle bank's bytes: ${windowBytes(m).equals(battle)})`);
    assert.equal(MTPTR(m, r.at), fieldPtr, `${label}: call_battle(${entry}) returned with mtptr $${MTPTR(m, r.at).toString(16)}, the field screen's is $${fieldPtr.toString(16)}`);
  } finally { r.dispose(); }
}
for (const id of SIX_CELLS) {
  test(`(a)(f) call_battle(BE_RESTORE) returns with the field's PRG window and mtptr: ${id} rpg resident`, { skip }, () =>
    returnContractScene({ cell: cellById(id), placement: 'resident', entry: 'BE_RESTORE', label: id }));
  test(`(a)(f) a banked dialogue overlay entry (BE_DLG_ARROW) returns with the field's PRG window and mtptr: ${id} rpg banked`, { skip }, () =>
    returnContractScene({ cell: cellById(id), placement: 'banked', entry: 'BE_DLG_ARROW', label: id }));
}

// ---- (a) the FIRST picture of a battle return: both live nametable indices, both axes, a nonzero local scroll ----
// The later frames (and judgeNow's settling) can repair a wrong first publication: NMI rewrites $2000 and the strip/window code keeps drawing. So the snapshot is taken
// INSIDE the display-enable write ($2001), where the landing has just written $2000 (the nametable select) and the $2005 pair, and the live nametables and attributes are what
// VRAM holds at that instant; it is judged by the independent camera/terrain oracle before another frame runs.
// Wrong implementations caught: the landing publishing nametable 0 (or a stale cam_nt) at $2000 whatever the camera says (the orchestrator's `lda <cam_nt` -> `lda #0` mutation);
// the landing publishing a zero scroll; a landing whose window is half drawn when the picture first appears.
/** the player starts on `screen` standing off the nametable boundary on the scrolling axis; a slime waits 32 px along the walk (V ring: down, H ring: up) */
const slimeWorld = (cell, screen) => {
  const at = cell.ring === 1 ? { start: { screen, x: 200, y: 120 }, slime: { x: 200, y: 152 }, button: BTN.DOWN } : { start: { screen, x: 120, y: 200 }, slime: { x: 120, y: 168 }, button: BTN.UP };
  return {
    ...at,
    mutate: (p) => {
      p.sprites.actors[0] = { name: 'Slime', damage: 1, hp: 1, battle: { acc: 0 } };
      p.maps[0].screens[screen].entities = [{ actorId: 0, x: at.slime.x, y: at.slime.y, props: {} }];
    }
  };
};
for (const id of SIX_CELLS) {
  for (const placement of ['resident', 'banked']) {
    for (const live of [0, 1]) {
      test(`(a) the first picture after a battle return matches the oracle: ${id} rpg ${placement}, live nametable ${live}`, { skip }, async () => {
        const cell = cellById(id);
        const w = slimeWorld(cell, live); // screen 0 puts the camera on live nametable 0, screen 1 on live nametable 1
        const r = await buildRing({ loaded, cell, placement, start: w.start, mutate: w.mutate });
        try {
          const nes = r.boot();
          const shots = watchDisplayEnable(nes, r.at, [], { capture: true });
          bootToField(nes, r.at);
          const before = shots.length;
          fightSlime(nes, r.at, w.button);
          for (let i = 0; i < 30; i++) nes.frame();
          const inBattle = shots.findIndex((s, i) => i >= before && s.game_state === r.at('ST_BATTLE'));
          assert.ok(inBattle >= 0, 'the battle showed its own picture first');
          const back = shots.slice(inBattle + 1).find((s) => s.game_state === 0);
          assert.ok(back, 'the battle return must reach a display-enable in the field state');
          const s = back.rec.state;
          assert.equal(displayedLiveIndex(cell.ring, s.cam_nt), live, `the camera is on live nametable ${live} at the return (cam_nt ${s.cam_nt})`);
          assert.notEqual(cell.ring === 1 ? s.cam_x_lo : s.cam_y_lo, 0, 'the camera is off the nametable boundary on the scrolling axis (a nonzero local scroll)');
          assert.equal(displayedLiveIndex(cell.ring, back.ppuctrlNt), live, `$2000 selected nametable ${back.ppuctrlNt} at the first display-enable`);
          assert.equal(back.scrollX, s.cam_x_lo, '$2005 x at the first display-enable is the camera');
          assert.equal(back.scrollY, s.cam_y_lo, '$2005 y at the first display-enable is the camera');
          const v = r.judgeShot(back, 'battle-return-first-picture');
          assert.ok(v.ok, `the first picture after the battle return disagrees with the oracle -- ${verdictText(v)}`);
        } finally { r.dispose(); }
      });
    }
  }
}

// ---- (e) a warp landing: settle_owed runs the destination's entry event once, on a fresh screen ----
for (const id of SIX_CELLS) {
  test(`(e) a warp landing on a ring settles its entry event once: ${id} rpg`, { skip }, async () => {
    const cell = cellById(id);
    const r = await buildRing({
      loaded, cell, start: START,
      mutate: (p) => {
        p.sprites.actors.push({ name: 'Door', behavior: 'npc', hp: 1, damage: 0 });
        const door = p.sprites.actors.length - 1;
        p.sprites.actors.push({ name: 'Marker', behavior: 'npc', hp: 1, damage: 0 });
        const marker = p.sprites.actors.length - 1;
        p.maps[0].screens[0].entities = [{ actorId: door, x: START.x, y: START.y, props: enterEvent([{ op: 'warp', screen: 2, x: 60, y: 60 }]) }];
        p.maps[0].screens[2].entities = [{ actorId: marker, x: 60, y: 60, props: enterEvent([addVar(1)]) }];
      }
    });
    try {
      const nes = r.boot();
      const shots = watchDisplayEnable(nes, r.at);
      bootToField(nes, r.at);
      const m = nes.cpu.mem;
      const axis = cell.ring === 1 ? 'sw_col' : 'sw_row';
      const landing = shots.find((s) => s[axis] === 2);
      assert.ok(landing, `the warp must land on screen 2 (display-enables seen: ${JSON.stringify(shots.map((s) => [s.sw_col, s.sw_row]))})`);
      assert.equal(landing.screen_fresh, 1, 'the warp landing is a fresh screen at its first frame');
      assert.equal(landing.st_active, 0, 'no strip survives the warp');
      assert.notEqual(landing.pending_ent, r.at('NO_ENTITY'), 'the landing arms the destination\'s enter actor');
      assert.equal(m[r.at('variables') + 1], 1, 'settle_owed ran the destination\'s entry event exactly once');
      assert.equal(m[r.at('pending_ent')], r.at('NO_ENTITY'), 'and consumed it');
      const v = r.judgeNow(nes, 'warp-landing');
      assert.ok(v.ok, `the live nametables after the warp disagree with the oracle -- ${verdictText(v)}`);
    } finally { r.dispose(); }
  });
}

// ---- (e) Continue: the landing re-arms the screen's entry event, settle_owed runs it once ----
for (const id of SIX_CELLS) {
  test(`(e) a Continue landing on a ring settles its entry event once: ${id} rpg`, { skip }, async () => {
    const cell = cellById(id);
    const battery = cell.mapper !== 30; // SRAM on MMC1/MMC3, the flash sector on UNROM 512
    const r = await buildRing({
      loaded, cell, start: START, title: true,
      mutate: (p) => {
        p.sprites.actors.push({ name: 'Saver', behavior: 'npc', hp: 1, damage: 0 });
        const saver = p.sprites.actors.length - 1;
        p.maps[0].screens[0].entities = [{ actorId: saver, x: cell.ring === 1 ? 40 : 200, y: 40, props: enterEvent([addVar(0), { op: 'save' }]) }];
      }
    });
    try {
      const nes = r.boot();
      const shots = watchDisplayEnable(nes, r.at);
      const axis = cell.ring === 1 ? 'x' : 'y';
      const recs = runSteps(nes, [{ op: 'title' }, { op: 'boot' }, { op: 'check', label: 'sw:land' }, { op: 'cycle', axis, target: 'c', battery }]);
      const cycle = recs.find((x) => x.kind === 'hold' && x.label.startsWith('hold:cycle'));
      assert.ok(cycle?.hold.reached, `Continue never reached the field (${cycle?.hold.why})`);
      const m = nes.cpu.mem;
      const V0 = r.at('variables');
      const afterCycle = shots.filter((s) => s.frame > 0 && s.game_state === 0 && s.map_is_streamed === 1);
      const continued = afterCycle[afterCycle.length - 1];
      assert.equal(continued.screen_fresh, 1, 'the Continue landing is a fresh screen at its first frame');
      assert.equal(continued.st_active, 0, 'no strip is armed at the Continue landing');
      for (let i = 0; i < 120; i++) nes.frame();
      assert.equal(m[V0], 2, 'the saved counter was 1; the Continue landing re-arms the screen\'s enter actor and settle_owed runs it once (2), not zero times (1) or twice (3)');
      const v = r.judgeNow(nes, 'continue-landing');
      assert.ok(v.ok, `the live nametables after Continue disagree with the oracle -- ${verdictText(v)}`);
    } finally { r.dispose(); }
  });
}

// ---- (d) a session start leaves no strip armed: THREE separate contracts ----
// A strip armed in the session that just ended must not survive into the new one. Two independent engine mechanisms clear it, and a session start passes through both:
//   (d1) init_session ends `lda #BE_INIT / jmp call_battle` (engine/combat.asm), and call_battle's strip cancel (engine/banks.asm) clears st_active before the cross-bank
//        switch -- init_session has no `sta st_active` of its own; the clear is transitive, through the RPG's party build;
//   (d2) sw_resolve_screen clears st_active on every real (non-parked) landing, and every session start (restart_game, new game, Continue) reaches that resolver through
//        redraw_screen_dispatch (boot reaches it through boot_streamed_landing);
//   (d3) the net effect: the restart landing's first picture carries st_active 0. Either mechanism alone satisfies it, so it fails only if BOTH clears are gone.
// Each of (d1) and (d2) is isolated by calling its own routine directly (callRoutine runs with interrupts off, so NMI cannot drain the strip first).
// Wrong implementations caught: (d1) call_battle keeping st_active (sabotage no-strip-cancel); (d2) sw_resolve_screen not clearing it (landing-keeps-st-active); (d3) both (session-clears-neither).
const START_WORLD_TRAP = (p) => {
  p.sprites.actors.push({ name: 'Trap', behavior: 'npc', hp: 1, damage: 0 });
  const trap = p.sprites.actors.length - 1;
  p.maps[0].screens[0].entities = [{ actorId: trap, x: START.x, y: START.y, props: enterEvent([{ op: 'damage', value: 99 }]) }];
};
/** a stale column/row strip left from the session that just ended: armed, nothing drawn yet, 30 blocks to go -- one frame's NMI cannot finish it (SW_STREAM_CHUNK per vblank) */
const armStale = (m, at, kind) => { m[at('st_active')] = kind; m[at('st_cur')] = 0; m[at('st_len')] = 30; };
for (const id of SIX_CELLS) {
  test(`(d1) init_session cancels a stale strip through call_battle(BE_INIT): ${id} rpg`, { skip }, async () => {
    const cell = cellById(id);
    const r = await buildRing({ loaded, cell, start: START });
    try {
      const nes = r.boot();
      bootToField(nes, r.at);
      const m = nes.cpu.mem;
      for (const kind of [1, 2]) {
        armStale(m, r.at, kind);
        assert.equal(m[r.at('st_active')], kind, 'precondition: a strip is armed');
        callRoutine(nes, r.fns.init_session);
        assert.equal(m[r.at('st_active')], 0, `init_session left a stale mode-${kind} strip armed (its own tail call, call_battle(BE_INIT), is what cancels it)`);
      }
    } finally { r.dispose(); }
  });

  test(`(d2) sw_resolve_screen clears a stale strip on a real landing: ${id} rpg`, { skip }, async () => {
    const cell = cellById(id);
    const r = await buildRing({ loaded, cell, start: START });
    try {
      const nes = r.boot();
      bootToField(nes, r.at);
      const m = nes.cpu.mem;
      for (const kind of [1, 2]) {
        armStale(m, r.at, kind);
        nes.cpu.REG_ACC = m[r.at('flat_screen')];
        callRoutine(nes, r.fns.sw_resolve_screen);
        assert.equal(m[r.at('st_active')], 0, `sw_resolve_screen left a stale mode-${kind} strip armed on a real landing`);
      }
    } finally { r.dispose(); }
  });

  test(`(d3) a restart landing carries no strip in its first picture (net effect of d1 and d2): ${id} rpg`, { skip }, async () => {
    const cell = cellById(id);
    const r = await buildRing({ loaded, cell, start: START, mutate: START_WORLD_TRAP });
    try {
      const nes = r.boot();
      const m = nes.cpu.mem;
      let f = 0;
      while (m[r.at('game_state')] !== r.at('ST_GAMEOVER') && f++ < 600) nes.frame();
      assert.equal(m[r.at('game_state')], r.at('ST_GAMEOVER'), 'the killing entry event must reach the game-over screen');
      for (let i = 0; i < 60; i++) nes.frame();
      armStale(m, r.at, 1);
      const shots = watchDisplayEnable(nes, r.at);
      tap(nes, BTN.START, 20); // restart_game -> init_session -> the landing
      for (let i = 0; i < 300 && !shots.length; i++) nes.frame();
      assert.ok(shots.length, 'the restart landing never reached a display-enable');
      assert.equal(shots[0].game_state, 0, 'the restart landing is real gameplay');
      assert.equal(shots[0].map_is_streamed, 1, 'and on the streamed map');
      assert.equal(shots[0].st_active, 0, 'a session start must not carry a stale strip into the new session');
    } finally { r.dispose(); }
  });
}

// ---- (b) the naming grid on a streamed ring RPG ----
const GRID_ROWS = [24, 25, 26, 27, 28, 29];
for (const id of SIX_CELLS) {
  test(`(b) the naming grid draws the same picture at the nametable seam as aligned: ${id} rpg`, { skip }, async () => {
    const cell = cellById(id);
    const picture = {};
    for (const variant of ['aligned', 'seam']) {
      // the seam variant starts mid-world so the camera is off the nametable boundary on the scrolling axis
      const start = variant === 'aligned' ? START : cell.ring === 1 ? { screen: 1, x: 200, y: 120 } : { screen: 1, x: 120, y: 200 };
      const r = await buildRing({ loaded, cell, start, mutate: (p) => { p.party[0].renamable = true; } });
      try {
        const nes = r.boot();
        const trace = installPpuTrace(nes, { aliasRange: aliasRangeOf(cell.ring) });
        const m = nes.cpu.mem;
        let f = 0;
        while (m[r.at('game_state')] !== r.at('ST_NAMEENTRY') && f++ < 600) nes.frame();
        assert.equal(m[r.at('game_state')], r.at('ST_NAMEENTRY'), `${variant}: hero naming must open at a new game`);
        waitForNamingReady(nes);
        for (let i = 0; i < 6; i++) nes.frame();
        const vram = dumpVram(nes);
        const p = nes.ppu;
        const offset = cell.ring === 1 ? (p.regH * 256 + p.regHT * 8 + p.regFH) % 256 : (p.regV * 240 + p.regVT * 8 + p.regFV) % 240;
        picture[variant] = { offset, rows: GRID_ROWS.map((row) => Array.from({ length: 32 }, (_, col) => displayedTile(nes, vram, row, col))) };
        const letters = new Set(picture[variant].rows[2].slice(2, 30));
        assert.ok(letters.size >= 20, `${variant}: the A-Z row carries distinct glyphs (${letters.size})`);
        finishNamingIfOpen(nes);
        for (let i = 0; i < 60; i++) nes.frame();
        assert.deepEqual(trace.alias, [], `${variant}: no write may land on a mirror alias of a live nametable while the grid opens and closes`);
        const v = r.judgeNow(nes, `naming-closed-${variant}`);
        assert.ok(v.ok, `${variant}: the nametables after the grid closes disagree with the oracle -- ${verdictText(v)}`);
      } finally { r.dispose(); }
    }
    assert.equal(picture.aligned.offset, 0, 'the aligned variant has the camera on the nametable boundary');
    assert.notEqual(picture.seam.offset, 0, 'the seam variant has the grid straddling the nametable seam');
    // the box interior is the grid's own: rows 25-28 (preview, A-Z, a-z, controls), columns 2-29, identical wherever the camera is
    for (let r = 1; r <= 4; r++) {
      assert.deepEqual(picture.seam.rows[r].slice(2, 30), picture.aligned.rows[r].slice(2, 30), `grid row ${GRID_ROWS[r]} differs between the seam and the aligned camera`);
    }
  });
}

// ---- (g) ruling 3 on an RPG: a mirroring-only edit keeps the save; Continue reconstructs the ring ----
const FLASH_BANK = 30; // flashSaveSectorBank(UNROM 512), shared/cartridge.js (streamadmit.test.js hardcodes it the same way); the sector is the top 4 KB of that 16 KB bank
const FLASH_SECTOR = 0x3000;
for (const cellId of ['MMC3-V', 'MMC1-V', 'U512-V']) {
  test(`(g) ${cellId} rpg: a save made on vertical mirroring Continues on horizontal after a mirroring-only edit (REAL tree, no bypass); the party and the ring survive; a resize refuses the save`, { skip }, async () => {
    // Catches: a save that did not survive the edit (token or identity redrawn), a Continue that restored the party wrongly (the RPG save carries the party and BE_RESTORE
    // recomputes from it), a ring not rebuilt for the new mirroring (live nametables vs the independent oracle), on UNROM 512 a flash sector that moved, and a resize that does not
    // invalidate the save (the old save would load into a world of another shape).
    const battery = cellId !== 'U512-V';
    const cellV = cellById(cellId);
    const { project: projA } = ringProject({
      cell: cellV, gameType: 'rpg', n: 1, talkers: 'none',
      mutate: (p) => {
        p.sprites.actors.push({ name: 'Saver', behavior: 'npc', hp: 1, damage: 0 });
        const actorId = p.sprites.actors.length - 1;
        p.maps.push(createMap(p.maps.length, 'Title'));
        p.project.titleMap = p.maps.length - 1;
        p.project.titleScreen = 0;
        p.maps[0].screens[0].entities.push({ actorId, x: 200, y: 120, props: { trigger: 'touch', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [addVar(0), addVar(0), { op: 'save' }] }] } } });
      }
    });
    const projB = structuredClone(projA);
    const token = projA.project.saveCompatToken ?? 0;
    const identity = saveIdentity(projA);
    projB.cartridge.mirroring = 'horizontal';
    reconcileCartridge(projB);
    assert.equal(projB.project.saveCompatToken ?? 0, token, 'saveCompatToken unchanged by a mirroring-only edit');
    assert.equal(saveIdentity(projB), identity, 'the save identity is unchanged');
    // the REAL tree: the shipped validateProject admits these projects (no refusal neutralized), so a refusal that came back would throw here
    const a = await buildThrough(realLoaded, projA);
    const b = await buildThrough(realLoaded, projB);
    try {
      const symA = buildSymbols(a.dir);
      const nesA = bootRom(a.romPath);
      const saved = runSteps(nesA, [{ op: 'title' }, { op: 'boot' }, { op: 'save', btn: 'right', axis: 'x', max: 3000, target: 's', battery }]);
      assert.equal(saved.find((r) => r.label === 'hold:save:s').hold.reached, true, 'the save was written');
      const placeA = readState(nesA);
      assert.ok(placeA.player_x > 120, `the player stood away from the start when saving (x ${placeA.player_x})`);
      const partyA = Array.from(nesA.cpu.mem.slice(symA.get('pc_hp'), symA.get('pc_hp') + 4));
      const varA = nesA.cpu.mem[symA.get('variables')];
      assert.equal(varA, 2, 'the Saver\'s two addVar commands ran before the save');
      assert.ok(partyA[0] > 0, 'the hero has hit points to compare');
      const sram = battery ? nesA.cpu.mem.slice(0x6000, 0x8000) : Uint8Array.from(nesA.rom.rom[FLASH_BANK].subarray(FLASH_SECTOR, FLASH_SECTOR + 0x1000));
      let romB = b.romPath;
      if (!battery) {
        const bytes = fs.readFileSync(b.romPath);
        bytes.set(sram, 16 + FLASH_BANK * 0x4000 + FLASH_SECTOR);
        romB = `${b.romPath}.carried.nes`;
        fs.writeFileSync(romB, bytes);
      }
      const nesB = bootRom(romB);
      const symB = buildSymbols(b.dir);
      const atB = (n) => symB.get(n);
      const landings = watchDisplayEnable(nesB, atB);
      if (battery) nesB.cpu.mem.set(sram, 0x6000);
      const records = runSteps(nesB, [{ op: 'cycle', axis: 'x', target: 's', battery }, { op: 'check', label: 'continued' }]);
      const cycle = records.find((r) => r.label === 'hold:cycle:s');
      assert.equal(cycle.hold.reached, true, `Continue landed on the streamed map from the other mirroring's save (${cycle.hold.why})`);
      const rec = records.find((r) => r.label === 'continued');
      assert.equal(rec.state.player_x, placeA.player_x, 'the landing is the saved x');
      assert.equal(rec.state.player_y, placeA.player_y, 'the landing is the saved y');
      const verdict = judge(rec, { project: projB, ring: 2, gridW: 1, gridH: 1 });
      assert.deepEqual(verdict.fails, [], 'both live nametables ($2000/$2800) match the oracle, attributes included');
      assert.deepEqual(Array.from(nesB.cpu.mem.slice(symB.get('pc_hp'), symB.get('pc_hp') + 4)), partyA, 'the party\'s hit points survived the mirroring edit and BE_RESTORE');
      // read at the Continue landing's first picture: the player stands in contact with the Saver, whose touch event re-fires after the landing (the counter then moves on)
      const landing = landings.find((x) => x.game_state === 0 && x.map_is_streamed === 1);
      assert.ok(landing, 'the Continue landing reached a display-enable');
      assert.equal(landing.variables[0], varA, 'the saved variable counter was restored');
      const fresh = bootRom(b.romPath);
      const none = runSteps(fresh, [{ op: 'cycle', axis: 'x', target: 's', battery }]);
      assert.equal(none.find((r) => r.label === 'hold:cycle:s').hold.reached, false, 'control: without the save the same ROM has no Continue');
      // a RESIZE still invalidates (ruling 3's other half): the same project one screen wider draws a new saveCompatToken, and its ROM refuses the old save
      const projC = structuredClone(projA);
      assert.notEqual(growOrShrinkMap(projC, 0, 2, 1), null, 'the 1 x 1 streamed map grows to 2 x 1');
      assert.notEqual(projC.project.saveCompatToken ?? 0, token, 'a resize redraws saveCompatToken');
      assert.notEqual(saveIdentity(projC), identity, 'and changes the save identity');
      const c = await buildThrough(realLoaded, projC);
      try {
        const nesC = bootRom(c.romPath);
        if (battery) nesC.cpu.mem.set(sram, 0x6000);
        else {
          const bytes = fs.readFileSync(c.romPath);
          bytes.set(sram, 16 + FLASH_BANK * 0x4000 + FLASH_SECTOR);
          fs.writeFileSync(`${c.romPath}.carried.nes`, bytes);
        }
        const nesC2 = battery ? nesC : bootRom(`${c.romPath}.carried.nes`);
        const refused = runSteps(nesC2, [{ op: 'cycle', axis: 'x', target: 's', battery }]);
        assert.equal(refused.find((r) => r.label === 'hold:cycle:s').hold.reached, false, 'a resized world refuses the old save: there is no Continue into a room that no longer is');
      } finally { fs.rmSync(c.dir, { recursive: true, force: true }); }
    } finally {
      fs.rmSync(a.dir, { recursive: true, force: true });
      fs.rmSync(b.dir, { recursive: true, force: true });
    }
  });
}
