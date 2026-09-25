// Large streamed worlds (ROADMAP item 15), phase 2 slice 6: transitions and lifecycle.
//
// Covers what handoff-next/streamed-worlds-phase2-plan.md's own "Slice 6" section (and
// docs/design-streamed-worlds.md's own section 8 transition matrix) assigns to this slice:
// call_battle's own strip cancellation before the cross-bank switch (engine/banks.asm), battle
// return's full resync/screen_fresh re-settle/entry-event suppression (composed almost entirely
// from mechanisms that predate this slice -- battle_end's own unconditional jsr redraw_screen,
// engine/rpg.asm, and redraw_screen_dispatch's streamed branch, engine/screens.asm, both proven
// here rather than merely cited), game-over reset through init_session on a mixed streamed/
// ordinary project (engine/combat.asm's own defensive map_is_streamed/ord_screen clear, also
// pre-existing), and the position-jump guard (engine/streamworld.asm's sw_position_jump_guard/
// sw_pjg_check/sw_pjg_lag_trip, genuinely new this slice).
//
// Warp/door/Continue/(Test into a streamed destination is NOT re-tested here: the existing
// landing-slice test ("streamed landing installs the tracking window directly (phase 2 slice
// landing)", test/unit/streamworldmove.test.js) already drives exactly that path via
// landOnStreamedViaDoor (an ordinary source screen's own 'enter'-triggered warp command into a
// streamed destination), through the SAME single dispatch point (redraw_screen_dispatch's own
// `lda <flat_screen / jsr sw_resolve_screen`, engine/screens.asm:287-290) Continue and (Test also
// funnel through -- see this file's own sabotage run against that existing test for slice 6's
// required sabotage case 3. Continue itself is additionally unreachable for any project carrying a
// streamed map at all: D.7 (test/unit/streamworld.test.js) refuses a live Save command anywhere in
// such a project, so there is never a save to Continue from -- the design doc's own "Continue" row
// documents a contract, not a path any shipped project can currently reach.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import NES from '../../renderer/emulator/core/nes.js';
import { Emulator } from '../../renderer/emulator/runcontrol.js';
import { callRoutine } from '../lib/callroutine.js';
import { parseEquates } from '../../shared/enginesyms.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { applyStartOverride, MAIN_LOOP, MAIN_LOOP_WARP } from '../../renderer/emulator/testplay.js';
import { watchPositionJumpGuard } from '../lib/pjgguard.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ---- from engine/constants.asm ----
const GAME_STATE = 0x25;
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const FLAT_SCREEN = 0x16;
const MAP_IS_STREAMED = 0xfe;
const SCREEN_FRESH = 0x7d;
const VARIABLES = 0x500;
const ENT_ACTIVE = 0x300;
const ENT_ACTOR = 0x308;
const ENT_X = 0x310; // engine/constants.asm:708
const ENT_Y = 0x318; // engine/constants.asm:709
const ENT_TOUCHED = 0x518; // engine/constants.asm:826 -- cleared unconditionally by spawn_entities ("a screen arrives with nothing stood on")
const ENT_RECORD = 0x520; // engine/constants.asm:827 -- which authored screen record this slot came from
const MAX_ENTITIES = 8;
const SW_COL = 0x5a0;
const SW_ROW = 0x5a1;
const WIN_COL_SCREEN = 0x5b1;
const WIN_COL_LOCAL = 0x5b2;
const WIN_ROW_SCREEN = 0x5b3;
const WIN_ROW_LOCAL = 0x5b4;
const ST_ACTIVE = 0x5b5;
const SW_FC_DESC = 0x0788;
const SW_FC_DESL = 0x0789;
const SW_FC_DESR = 0x078a;
const SW_FC_DESRL = 0x078b;
const SW_CAM_ORIGIN_X_LO = 0x035c;
const SW_CAM_ORIGIN_X_HI = 0x035d;
const SW_CAM_ORIGIN_Y_LO = 0x035e;
const SW_CAM_ORIGIN_Y_HI = 0x035f;
const BE_RESTORE = 3; // a non-fight call_battle entry (engine/constants.asm), same one
                       // streamworld.test.js's own "decision 7" test already drives directly
const BT_SEL = 0x55;
const BT_PHASE = 0x53;
const BP_MENU = 1;
const BP_DONE = 11;
const MON_HP = 0x3c0;
const MON_ALIVE = 0x3c8;
const PC_HP = 0x398;
const BC_FIGHT = 0;
const BC_RUN = 3;
const FRAME_CNT = 0x1b; // incremented only by NMI

// engine/constants.asm's camera chain (docs/design-camera.md §2's twelve bytes,
// chained unconditionally off bt_walk_step). Hardcoded with this comment rather
// than resolved via addrOfSymbol/game.fns, per CLAUDE.md's own rule -- a test
// that reads the file it is checking proves nothing -- and because these are
// zero-page `=` equates, which nesasm never exports into game.fns at all (only
// colon-defined labels are). Same values as test/unit/camera.test.js's own
// CAM_X_LO et al.
const CAM_X_LO = 0xaf;
const CAM_DIRTY = 0xb5;
const NMI_CAM_X_LO = 0xb6;
const NMI_CAM_Y_LO = 0xb7;
const NMI_CAM_NT = 0xb8;

const ST_GAMEPLAY = 0;
const ST_GAMEOVER = 4;
const ST_BATTLE = 5;

const A_BTN = 0, B_BTN = 1, SELECT_BTN = 2, START_BTN = 3, UP = 4, DOWN = 5, LEFT = 6, RIGHT = 7;

const tap = (nes, button, frames = 14) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
};

/** Move the battle menu highlight to a command and confirm it (identical shape to
 *  test/unit/rpg.test.js's own chooseCommand). */
function chooseCommand(nes, command) {
  for (let i = 0; i < 8 && nes.cpu.mem[BT_SEL] !== command; i++) tap(nes, DOWN, 4);
  assert.equal(nes.cpu.mem[BT_SEL], command, 'the battle menu never reached that command');
  tap(nes, A_BTN, 6);
}

async function buildAndBoot(project, { requireStreamed = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworldlifecycle-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const bytes = new Uint8Array(fs.readFileSync(built.romPath));
    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(bytes);
    const mem = nes.cpu.mem;
    let frames = 0;
    while ((mem[GAME_STATE] !== ST_GAMEPLAY || (requireStreamed && mem[MAP_IS_STREAMED] !== 1)) && frames < 200) {
      nes.frame();
      frames++;
    }
    assert.ok(frames < 200, 'cold boot must reach ST_GAMEPLAY well within 200 frames');
    for (let i = 0; i < 100; i++) nes.frame();
    const symbols = fs.readFileSync(built.symbolPath, 'utf8');
    return { nes, mem, symbols };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function addrOfSymbol(symbols, label) {
  const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
  assert.ok(m, `${label} should be a named symbol in game.fns`);
  return parseInt(m[1], 16);
}

function approachUntilAxis(nes, mem, button, targetAxis, maxFrames = 200) {
  nes.buttonDown(1, button);
  let f = 0;
  while (mem[ST_ACTIVE] !== targetAxis && f++ < maxFrames) nes.frame();
  nes.buttonUp(1, button);
  return f;
}

/** Same shape as buildAndBoot, but returns an Emulator (fine-grained
 *  instruction stepping/runToAddress) instead of a bare NES -- needed by
 *  Part D below, which has to land a forced NMI at an exact instruction. */
async function buildAndBootEmulator(project, { requireStreamed = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworldlifecycle-emu-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const bytes = new Uint8Array(fs.readFileSync(built.romPath));
    const emulator = new Emulator({ onFrame: () => {} });
    emulator.loadROM(bytes);
    const nes = emulator.nes;
    const mem = nes.cpu.mem;
    let frames = 0;
    while ((mem[GAME_STATE] !== ST_GAMEPLAY || (requireStreamed && mem[MAP_IS_STREAMED] !== 1)) && frames < 200) {
      nes.frame();
      frames++;
    }
    assert.ok(frames < 200, 'cold boot must reach ST_GAMEPLAY well within 200 frames');
    for (let i = 0; i < 100; i++) nes.frame();
    const symbols = fs.readFileSync(built.symbolPath, 'utf8');
    return { emulator, nes, mem, symbols };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ==========================================================================
// Part A: call_battle cancels an in-flight strip before the cross-bank switch
// (engine/banks.asm's new `lda #0 / sta st_active`, gated STREAMING_ENABLED).
// Driven directly through call_battle (test/lib/callroutine.js), the same
// technique streamworld.test.js's own "decision 7" test uses -- isolates the
// exact mechanism this slice added from the rest of a real battle's own
// machinery, which Part B below exercises end-to-end separately.
// ==========================================================================
test(
  "call_battle cancels an in-flight strip before the cross-bank switch (engine/banks.asm)",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({ gameType: 'rpg', gridW: 5, gridH: 5 });
    project.project.startScreen = 12;
    const { nes, mem, symbols } = await buildAndBoot(project);
    const callBattle = addrOfSymbol(symbols, 'call_battle');

    const armFrames = approachUntilAxis(nes, mem, RIGHT, 1);
    assert.ok(armFrames < 200, 'the approach must actually arm the column strip within 200 frames');
    assert.equal(mem[ST_ACTIVE], 1, 'precondition: a real strip must be in flight before call_battle runs');

    nes.cpu.REG_ACC = BE_RESTORE; // a non-fight entry point -- see decision 7's own reasoning for why this is safe to drive directly
    callRoutine(nes, callBattle);

    assert.equal(mem[ST_ACTIVE], 0, 'call_battle must cancel the in-flight strip before the cross-bank switch, not leave it armed');
  }
);

// ==========================================================================
// Part B: battle entry and return, end-to-end, on a streamed RPG screen --
// D.6's own accepted-input lift (shared/project.js) proven at the runtime
// level. screen_fresh re-settle and entry-event suppression on return are
// BOTH already correct before this slice (spawn_entities' own unconditional
// `sta <screen_fresh`, engine/entities.asm:16, and battle_end's own
// unconditional `lda #NO_ENTITY / sta <pending_ent` right after its
// `jsr redraw_screen`, engine/rpg.asm:208-210, both pre-dating streaming) --
// this test proves the composition holds for a STREAMED screen specifically,
// where redraw_screen's streamed branch is what battle_end now reaches.
// ==========================================================================
test(
  'battle entry and return on a streamed RPG screen: screen_fresh re-settles, the entry event is suppressed, the window fully resyncs',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({ gameType: 'rpg', gridW: 5, gridH: 5 });
    project.project.startScreen = 12;
    // actors[0]: a monster whose contact starts a fight (isMonsterActor, shared/project.js) --
    // acc:0 so it can never land a hit, hp:1 so one physical Attack ends it, matching
    // test/unit/rpg.test.js's own "enough experience raises a level" precedent.
    project.sprites.actors[0] = { name: 'Slime', damage: 1, hp: 1, battle: { acc: 0 } };
    // actors[1]: a benign NPC carrying the entry-event marker, entirely separate from the
    // monster's own contact mechanism (rpg.test.js's own "coming back from a battle" precedent).
    project.sprites.actors[1] = { name: 'Marker', behavior: 'npc', hp: 1, damage: 0 };
    const streamedMap = project.maps.find((m) => m.streamed === true);
    const screen = streamedMap.screens[12];
    screen.entities = [
      {
        actorId: 1,
        x: project.project.startX,
        y: project.project.startY,
        props: {
          trigger: 'enter',
          event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 0, value: 1 }] }] }
        }
      },
      { actorId: 0, x: project.project.startX, y: project.project.startY + 32, props: {} }
    ];

    const { nes, mem } = await buildAndBoot(project);
    assert.equal(mem[VARIABLES], 1, 'the entry event must have run once when gameplay began');

    // Walk down into the slime.
    for (let step = 0; step < 200 && mem[GAME_STATE] === ST_GAMEPLAY; step++) {
      nes.buttonDown(1, DOWN);
      nes.frame();
      nes.buttonUp(1, DOWN);
    }
    for (let i = 0; i < 30 && mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
    assert.equal(mem[GAME_STATE], ST_BATTLE, 'walking into the slime did not start a fight');
    assert.equal(mem[VARIABLES], 1, 'the entry event must not have re-run on the way to the fight');
    // battle_begin (engine/rpg.asm) only sets game_state -- the first cross-bank call_battle
    // dispatch (main_loop's own battle branch, BE_INIT then BE_TICK every frame) happens on a
    // LATER frame, so a few settle frames are given before checking the strip was cancelled.
    for (let i = 0; i < 5; i++) nes.frame();
    assert.equal(mem[ST_ACTIVE], 0, 'call_battle must have cancelled any strip on the way into battle (Part A, exercised here end-to-end)');

    // Fix round 1, finding 6: entity restoration evidence (the slime's own ent_active slot must
    // clear on a WIN -- battle_end_status, engine/rpg.asm:230-233 -- while the marker NPC's own
    // slot survives), and the containment/screen_fresh checks below must be pinned to the FIRST
    // real resumed display, not merely "somewhere in a 50+60-frame window" (the review's own
    // complaint). A $2001 write hook, gated on game_state already reading ST_GAMEPLAY (battle_end
    // flips it as its very first act, well before jsr redraw_screen ever runs -- so the gate can
    // never fire mid-battle), catches the exact write that turns rendering back on after
    // sw_render_window's own forced-blank redraw finishes -- the same blank-then-on transition
    // technique test/unit/streamworldmove.test.js's own buildAndBootLanding uses for a fresh
    // landing, reused here for a battle RETURN instead.
    const entActiveCountBefore = (() => {
      let n = 0;
      for (let i = 0; i < MAX_ENTITIES; i++) if (mem[ENT_ACTIVE + i] !== 0) n++;
      return n;
    })();
    // Fix round 2 (review round 3, finding A6/C1): identity, not merely count -- the marker's own
    // actorId (1) survives the fight, the slime's own actorId (0) does not appear in any active
    // slot afterward. A count-only check would equally pass a mutant that removed the WRONG
    // entity (say, the marker) as long as exactly one slot cleared.
    const activeActorIdsBefore = (() => {
      const ids = [];
      for (let i = 0; i < MAX_ENTITIES; i++) if (mem[ENT_ACTIVE + i] !== 0) ids.push(mem[ENT_ACTOR + i]);
      return ids.sort();
    })();
    let firstResumedMem = null;
    const originalWrite = nes.mmap.write.bind(nes.mmap);
    let previousMask = 0;
    nes.mmap.write = (address, value) => {
      if (address === 0x2001) {
        if ((value & 0x18) && !(previousMask & 0x18) && mem[GAME_STATE] === ST_GAMEPLAY && !firstResumedMem) {
          firstResumedMem = mem.slice();
        }
        previousMask = value;
      }
      return originalWrite(address, value);
    };

    chooseCommand(nes, BC_FIGHT);
    tap(nes, A_BTN, 20);
    for (let round = 0; round < 80 && mem[GAME_STATE] === ST_BATTLE; round++) tap(nes, A_BTN, 12);
    assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the battle never ended');

    for (let i = 0; i < 50 && !firstResumedMem; i++) nes.frame();
    assert.ok(firstResumedMem, 'battle return must reach its own real $2001 display-enable write within 50 frames of the fight ending');
    nes.mmap.write = originalWrite;
    const rmem = firstResumedMem;

    assert.equal(rmem[SCREEN_FRESH], 1, 'screen_fresh must already be set at the exact frame battle-return rendering resumes, not merely sometime after');

    // battle_end's own ent_active clear (rpg.asm:225-233) runs strictly AFTER `jsr redraw_screen`
    // returns -- textually and temporally after the display-enable write the hook above just
    // caught, which happens INSIDE that call (sw_render_window's own final step). So the clear
    // itself is checked one frame later (the live mem array, not the frozen rmem snapshot), not
    // at the exact display-enable instant containment/screen_fresh are pinned to above.
    nes.frame();
    let entActiveCountAfter = 0;
    for (let i = 0; i < MAX_ENTITIES; i++) if (mem[ENT_ACTIVE + i] !== 0) entActiveCountAfter++;
    assert.equal(entActiveCountAfter, entActiveCountBefore - 1, 'the defeated slime must be gone from ent_active (battle_end_status\'s own WIN clear) shortly after the first resumed display, and only the slime -- the marker NPC must still be standing');
    const activeActorIdsAfter = (() => {
      const ids = [];
      for (let i = 0; i < MAX_ENTITIES; i++) if (mem[ENT_ACTIVE + i] !== 0) ids.push(mem[ENT_ACTOR + i]);
      return ids.sort();
    })();
    assert.ok(!activeActorIdsAfter.includes(0), 'win restoration: the slime (actorId 0) must specifically be the one gone, not merely some slot');
    assert.ok(activeActorIdsAfter.includes(1), 'win restoration: the marker NPC (actorId 1) must specifically be the one still standing, not merely some slot');
    assert.deepEqual(activeActorIdsAfter, activeActorIdsBefore.filter((id) => id !== 0), 'win restoration: the surviving entities\' own identities must be unchanged apart from the slime\'s removal');

    // Fix round 3, finding 3: identity/count alone would equally pass a mutation that corrupts a
    // survivor's own RESTORED state (position, touch/record bookkeeping) while leaving its
    // ent_active/ent_actor bytes untouched. spawn_entities' own redraw/respawn contract (engine/
    // entities.asm) re-derives every surviving entity fresh from the screen's own authored record
    // on any redraw, battle-return included -- ent_x/ent_y must read the AUTHORED spawn
    // coordinate (not merely "some value"), ent_touched must be the unconditional "a screen
    // arrives with nothing stood on" reset, and ent_record must still be the marker's own
    // authored record index (0, the first entity placed on this screen). This is the intended
    // contract, not "every transient byte must survive a fight" -- ent_hp/ent_dir/ent_frame/etc.
    // are equally reset by the same routine and are deliberately not asserted here.
    let markerSlotAfter = -1;
    for (let i = 0; i < MAX_ENTITIES; i++) if (mem[ENT_ACTIVE + i] && mem[ENT_ACTOR + i] === 1) markerSlotAfter = i;
    assert.notEqual(markerSlotAfter, -1, 'win restoration: the marker NPC must be findable in an active slot after the fight');
    assert.equal(mem[ENT_X + markerSlotAfter], project.project.startX, 'win restoration: the marker NPC\'s restored position must be its own authored x, not a corrupted or stale value');
    assert.equal(mem[ENT_Y + markerSlotAfter], project.project.startY, 'win restoration: the marker NPC\'s restored position must be its own authored y');
    assert.equal(mem[ENT_TOUCHED + markerSlotAfter], 0, 'win restoration: a freshly redrawn screen must clear ent_touched for every slot, including a survivor\'s');
    assert.equal(mem[ENT_RECORD + markerSlotAfter], 0, 'win restoration: the marker NPC must still be tied to its own authored record (0, the first entity placed on this screen)');

    // Full resync, at the exact same first-resumed-display snapshot: makeContainmentChecker's own
    // invariant (test/unit/streamworldmove.test.js), reimplemented minimally here.
    const camPx = (rmem[SW_CAM_ORIGIN_X_HI] << 8) | rmem[SW_CAM_ORIGIN_X_LO];
    const camPy = (rmem[SW_CAM_ORIGIN_Y_HI] << 8) | rmem[SW_CAM_ORIGIN_Y_LO];
    const visLoX = Math.floor(camPx / 16), visHiX = Math.floor((camPx + 255) / 16);
    const visLoY = Math.floor(camPy / 16), visHiY = Math.floor((camPy + 239) / 16);
    const colBlock = rmem[WIN_COL_SCREEN] * 16 + rmem[WIN_COL_LOCAL];
    const rowBlock = rmem[WIN_ROW_SCREEN] * 15 + rmem[WIN_ROW_LOCAL];
    assert.ok(visLoX >= colBlock && visHiX <= colBlock + 31, 'battle return: visible X range must be inside the resynced window (full sw_render_window, not stale), at the first resumed display');
    assert.ok(visLoY >= rowBlock && visHiY <= rowBlock + 29, 'battle return: visible Y range must be inside the resynced window (full sw_render_window, not stale), at the first resumed display');
    assert.equal(rmem[ST_ACTIVE], 0, 'battle return must not leave a strip armed from before the fight, at the first resumed display');

    // Entry event suppressed: battle_end's own pending_ent clear (engine/rpg.asm:209-210), which
    // runs immediately after spawn_entities may have just re-armed the marker's own 'enter' trigger.
    for (let i = 0; i < 60; i++) nes.frame();
    assert.equal(mem[VARIABLES], 1, 'the screen must not have run its entry event again when the battle ended');
  }
);

// ==========================================================================
// Part B2: fix round 1, finding 1 -- streamed random encounters (rpg.asm's
// check_encounter/start_encounter, now resolving through cur_map instead of
// screen_map[ord_screen]) actually fire and return correctly, driven by real
// movement rather than a build-only proof. rate:1 makes the very first
// completed step guaranteed to roll a fight (enc_step starts at 0, becomes 1
// on that step, 1 is not < rate 1 -- see engine/rpg.asm's check_encounter_live),
// so this needs no RNG control to be deterministic.
// ==========================================================================
test(
  'streamed random encounters fire from real movement and return correctly (fix round 1, finding 1)',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({ gameType: 'rpg', gridW: 5, gridH: 5 });
    project.project.startScreen = 12;
    project.sprites.actors[0] = { name: 'Slime', damage: 1, hp: 1, battle: { acc: 0 } };
    const streamedMap = project.maps.find((m) => m.streamed === true);
    streamedMap.encounters = { rate: 1, actorIds: [0] };
    // No entity on the screen at all -- if a fight starts here, it can only be
    // a wandering encounter (check_encounter), never touch_encounter (which
    // needs an entity slot to walk into) or a scripted Fight command.
    streamedMap.screens[12].entities = [];

    const { nes, mem } = await buildAndBoot(project);
    assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'precondition: must still be in ordinary gameplay before the first step');

    let step = 0;
    for (; step < 60 && mem[GAME_STATE] === ST_GAMEPLAY; step++) {
      nes.buttonDown(1, DOWN);
      nes.frame();
      nes.buttonUp(1, DOWN);
    }
    for (let i = 0; i < 30 && mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
    assert.equal(mem[GAME_STATE], ST_BATTLE, 'a rate:1 wandering encounter on a streamed map never fired from real movement -- the map_is_streamed skip must be gone and the map identity must resolve for real');
    for (let i = 0; i < 5; i++) nes.frame();
    assert.equal(mem[ST_ACTIVE], 0, 'call_battle must have cancelled any strip on the way into the wandering fight');

    chooseCommand(nes, BC_FIGHT);
    tap(nes, A_BTN, 20);
    for (let round = 0; round < 80 && mem[GAME_STATE] === ST_BATTLE; round++) tap(nes, A_BTN, 12);
    assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the wandering-encounter battle never ended');

    let screenFreshSeen = false;
    for (let i = 0; i < 50; i++) {
      nes.frame();
      if (mem[SCREEN_FRESH] === 1) screenFreshSeen = true;
    }
    assert.ok(screenFreshSeen, 'screen_fresh must be re-settled by the wandering-encounter battle-return redraw');

    const camPx = (mem[SW_CAM_ORIGIN_X_HI] << 8) | mem[SW_CAM_ORIGIN_X_LO];
    const camPy = (mem[SW_CAM_ORIGIN_Y_HI] << 8) | mem[SW_CAM_ORIGIN_Y_LO];
    const visLoX = Math.floor(camPx / 16), visHiX = Math.floor((camPx + 255) / 16);
    const visLoY = Math.floor(camPy / 16), visHiY = Math.floor((camPy + 239) / 16);
    const colBlock = mem[WIN_COL_SCREEN] * 16 + mem[WIN_COL_LOCAL];
    const rowBlock = mem[WIN_ROW_SCREEN] * 15 + mem[WIN_ROW_LOCAL];
    assert.ok(visLoX >= colBlock && visHiX <= colBlock + 31, 'wandering-encounter return: visible X range must be inside the resynced window');
    assert.ok(visLoY >= rowBlock && visHiY <= rowBlock + 29, 'wandering-encounter return: visible Y range must be inside the resynced window');
    assert.equal(mem[ST_ACTIVE], 0, 'wandering-encounter return must not leave a strip armed');
  }
);

// ==========================================================================
// Part B2b: fix round 2 (review round 3, finding A6/C1) -- flee restoration. Authored contact
// battles (touch_encounter, engine/rpg.asm:83-93) deliberately force bt_esc to 0 ("not fleeable");
// asking one to flee naturally is impossible by design, not an oracle gap. A wandering encounter
// (check_encounter, same file:60-77) sets bt_esc to 1 ("a wandering monster can be run from") and
// leaves bt_from_ent at NO_ENTITY (start_encounter's own clear), so battle_end's own entity-touch
// branch never runs for it either way -- there is no monster placement to restore. What a flee
// DOES have to prove is that ordinary field entities untouched by the fight -- a marker NPC
// standing elsewhere on the same screen -- survive the run, exactly as claimed for a win.
// ==========================================================================
test(
  'fleeing a streamed wandering encounter restores the field entities untouched (fix round 2, finding A6/C1)',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({ gameType: 'rpg', gridW: 5, gridH: 5 });
    project.project.startScreen = 12;
    project.sprites.actors[0] = { name: 'Slime', damage: 1, hp: 1, battle: { acc: 0 } };
    project.sprites.actors[1] = { name: 'Marker', behavior: 'npc', hp: 1, damage: 0 };
    const streamedMap = project.maps.find((m) => m.streamed === true);
    streamedMap.encounters = { rate: 1, actorIds: [0] };
    // A marker NPC well clear of the player's own walking path (Part B2's own DOWN-only approach),
    // so it is never touched by the walk itself -- only by whatever the battle-return redraw does.
    streamedMap.screens[12].entities = [
      { actorId: 1, x: project.project.startX + 64, y: project.project.startY, props: {} }
    ];

    const { nes, mem } = await buildAndBoot(project);
    let markerSlot = -1;
    for (let i = 0; i < MAX_ENTITIES; i++) if (mem[ENT_ACTIVE + i] && mem[ENT_ACTOR + i] === 1) markerSlot = i;
    assert.notEqual(markerSlot, -1, 'precondition: the marker NPC must be spawned and active before the fight starts');

    let step = 0;
    for (; step < 60 && mem[GAME_STATE] === ST_GAMEPLAY; step++) {
      nes.buttonDown(1, DOWN);
      nes.frame();
      nes.buttonUp(1, DOWN);
    }
    for (let i = 0; i < 30 && mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
    assert.equal(mem[GAME_STATE], ST_BATTLE, 'a rate:1 wandering encounter on a streamed map never fired from real movement');

    // Flee is a roll, not a guarantee -- test/unit/rpg.test.js's own established retry idiom
    // (up to 30 attempts, each one waiting for the menu to come back up if the attempt failed).
    let escaped = false;
    for (let attempt = 0; attempt < 30 && !escaped; attempt++) {
      if (mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
      tap(nes, A_BTN, 12);
      escaped = mem[GAME_STATE] === ST_GAMEPLAY;
    }
    assert.ok(escaped, 'thirty attempts to run from the wandering encounter all failed, which is not a roll');

    let screenFreshSeen = false;
    for (let i = 0; i < 50; i++) {
      nes.frame();
      if (mem[SCREEN_FRESH] === 1) screenFreshSeen = true;
    }
    assert.ok(screenFreshSeen, 'screen_fresh must be re-settled by the flee-return redraw');

    const camPx = (mem[SW_CAM_ORIGIN_X_HI] << 8) | mem[SW_CAM_ORIGIN_X_LO];
    const camPy = (mem[SW_CAM_ORIGIN_Y_HI] << 8) | mem[SW_CAM_ORIGIN_Y_LO];
    const visLoX = Math.floor(camPx / 16), visHiX = Math.floor((camPx + 255) / 16);
    const visLoY = Math.floor(camPy / 16), visHiY = Math.floor((camPy + 239) / 16);
    const colBlock = mem[WIN_COL_SCREEN] * 16 + mem[WIN_COL_LOCAL];
    const rowBlock = mem[WIN_ROW_SCREEN] * 15 + mem[WIN_ROW_LOCAL];
    assert.ok(visLoX >= colBlock && visHiX <= colBlock + 31, 'flee return: visible X range must be inside the resynced window');
    assert.ok(visLoY >= rowBlock && visHiY <= rowBlock + 29, 'flee return: visible Y range must be inside the resynced window');
    assert.equal(mem[ST_ACTIVE], 0, 'flee return must not leave a strip armed');

    // The restoration oracle itself: identity, not merely count -- the marker NPC, never touched
    // by this fight at all, must still be exactly where and what it was.
    assert.equal(mem[ENT_ACTIVE + markerSlot], 1, 'flee restoration: the untouched marker NPC must still be active after the escape');
    assert.equal(mem[ENT_ACTOR + markerSlot], 1, "flee restoration: the surviving slot's own identity must still be the marker's");
    // Fix round 3, finding 3: "exactly where and what it was" was previously only checked as
    // active/actorId -- state it as position plus the record/touch bookkeeping spawn_entities'
    // own redraw contract governs (see the win test's own comment for why these specific bytes,
    // not others, are the contract).
    assert.equal(mem[ENT_X + markerSlot], project.project.startX + 64, 'flee restoration: the marker NPC\'s restored position must be its own authored x');
    assert.equal(mem[ENT_Y + markerSlot], project.project.startY, 'flee restoration: the marker NPC\'s restored position must be its own authored y');
    assert.equal(mem[ENT_TOUCHED + markerSlot], 0, 'flee restoration: a freshly redrawn screen must clear ent_touched for the surviving slot');
    assert.equal(mem[ENT_RECORD + markerSlot], 0, 'flee restoration: the marker NPC must still be tied to its own authored record (0, the only entity on this screen)');
  }
);

// ==========================================================================
// Part B3: fix round 1, finding 1 -- a scripted Fight command's own runtime
// return/restoration on a streamed screen. D.6(c) (test/unit/streamworld.test.js)
// only proves this builds clean; this drives it for real.
// ==========================================================================
test(
  'a scripted Fight command on a streamed RPG screen returns and restores correctly at runtime (fix round 1, finding 1)',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({ gameType: 'rpg', gridW: 5, gridH: 5 });
    project.project.startScreen = 12;
    project.sprites.actors[0] = { name: 'Slime', damage: 1, hp: 1, battle: { acc: 0 } };
    project.sprites.actors[1] = { name: 'Trigger', behavior: 'npc', hp: 1, damage: 0 };
    const fightActorId = 1;
    const streamedMap = project.maps.find((m) => m.streamed === true);
    streamedMap.screens[12].entities = [
      {
        actorId: fightActorId,
        x: project.project.startX,
        y: project.project.startY + 32,
        props: {
          trigger: 'touch',
          event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'battle', monsters: [0] }] }] }
        }
      }
    ];

    const { nes, mem } = await buildAndBoot(project);

    // Fix round 2 (review round 3, finding A6/C1): a scripted Fight's own restoration oracle,
    // distinct from an authored monster's own touch_encounter -- script_op_battle (engine/
    // script.asm:459-470) sets bt_from_ent to NO_ENTITY ("not a touch or a step -- nothing to
    // despawn"), so the Trigger NPC that armed this event must SURVIVE a win, unlike Part B's own
    // Slime (a real monster placement, despawned on win). Identity, not merely presence: the
    // surviving slot's own actorId must still be the Trigger's.
    let triggerSlot = -1;
    for (let i = 0; i < MAX_ENTITIES; i++) if (mem[ENT_ACTIVE + i] && mem[ENT_ACTOR + i] === fightActorId) triggerSlot = i;
    assert.notEqual(triggerSlot, -1, 'precondition: the Trigger NPC must be spawned and active before the fight starts');

    for (let step = 0; step < 200 && mem[GAME_STATE] === ST_GAMEPLAY; step++) {
      nes.buttonDown(1, DOWN);
      nes.frame();
      nes.buttonUp(1, DOWN);
    }
    for (let i = 0; i < 30 && mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
    assert.equal(mem[GAME_STATE], ST_BATTLE, 'the scripted Fight command never started a battle on the streamed screen');

    chooseCommand(nes, BC_FIGHT);
    tap(nes, A_BTN, 20);
    for (let round = 0; round < 80 && mem[GAME_STATE] === ST_BATTLE; round++) tap(nes, A_BTN, 12);
    assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the scripted Fight battle never ended');

    let screenFreshSeen = false;
    for (let i = 0; i < 50; i++) {
      nes.frame();
      if (mem[SCREEN_FRESH] === 1) screenFreshSeen = true;
    }
    assert.ok(screenFreshSeen, 'screen_fresh must be re-settled by the scripted-Fight battle-return redraw');

    const camPx = (mem[SW_CAM_ORIGIN_X_HI] << 8) | mem[SW_CAM_ORIGIN_X_LO];
    const camPy = (mem[SW_CAM_ORIGIN_Y_HI] << 8) | mem[SW_CAM_ORIGIN_Y_LO];
    const visLoX = Math.floor(camPx / 16), visHiX = Math.floor((camPx + 255) / 16);
    const visLoY = Math.floor(camPy / 16), visHiY = Math.floor((camPy + 239) / 16);
    const colBlock = mem[WIN_COL_SCREEN] * 16 + mem[WIN_COL_LOCAL];
    const rowBlock = mem[WIN_ROW_SCREEN] * 15 + mem[WIN_ROW_LOCAL];
    assert.ok(visLoX >= colBlock && visHiX <= colBlock + 31, 'scripted-Fight return: visible X range must be inside the resynced window');
    assert.ok(visLoY >= rowBlock && visHiY <= rowBlock + 29, 'scripted-Fight return: visible Y range must be inside the resynced window');
    assert.equal(mem[ST_ACTIVE], 0, 'scripted-Fight return must not leave a strip armed');
    assert.equal(mem[ENT_ACTIVE + triggerSlot], 1, 'scripted-Fight restoration: the Trigger NPC that armed the event must survive a win (script_op_battle sets bt_from_ent to NO_ENTITY, nothing to despawn)');
    assert.equal(mem[ENT_ACTOR + triggerSlot], fightActorId, "scripted-Fight restoration: the surviving slot's own identity must still be the Trigger's");
    // Fix round 3, finding 3: position plus the record/touch bookkeeping the redraw contract
    // governs, not only identity/active (see the win test's own comment for why these specific
    // bytes are the contract, not every transient byte).
    assert.equal(mem[ENT_X + triggerSlot], project.project.startX, "scripted-Fight restoration: the Trigger NPC's restored position must be its own authored x");
    assert.equal(mem[ENT_Y + triggerSlot], project.project.startY + 32, "scripted-Fight restoration: the Trigger NPC's restored position must be its own authored y");
    // Unlike the win/flee markers (never touched by the player), this Trigger's own event fires
    // on TOUCH -- the player is still standing on it when the battle starts and never moves during
    // it, so by the time this settle window has run, real per-frame touch detection has already
    // re-armed ent_touched back to 1. Asserting 0 here would be wrong, not stricter: it would
    // demand the redraw's own transient "nothing stood on yet" reset survive frames of continued
    // real contact, which the intended contract never promises.
    assert.equal(mem[ENT_TOUCHED + triggerSlot], 1, 'scripted-Fight restoration: the player is still standing on the Trigger, so real per-frame touch detection must have re-armed ent_touched after the redraw reset it');
    assert.equal(mem[ENT_RECORD + triggerSlot], 0, 'scripted-Fight restoration: the Trigger NPC must still be tied to its own authored record (0, the only entity on this screen)');
  }
);

// ==========================================================================
// Part C: game-over reset on a mixed project (ordinary start map, streamed
// map reached via warp) does not carry a stale map_is_streamed into the new
// session. init_session's own defensive clear (engine/combat.asm:107-108,
// `sta <map_is_streamed` / `sta <ord_screen`, inside
// init_session_streamed_dispatch) predates this slice; this test proves it
// for real rather than citing it.
// ==========================================================================
test(
  'game-over reset on a mixed project: restarting back onto the ordinary start map does not carry a stale map_is_streamed from the streamed screen the player died on',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({ gameType: 'action', mixed: true, gridW: 3, gridH: 2 });
    const [before] = project.maps;
    const streamedBase = 4; // mixed:true's own 2x2 "Before" map occupies global screens 0-3
    project.sprites.actors.push({ name: 'Door', behavior: 'npc', hp: 1, damage: 0 });
    const doorActorId = project.sprites.actors.length - 1;
    before.screens[0].entities = [
      {
        actorId: doorActorId,
        x: project.project.startX,
        y: project.project.startY,
        props: {
          trigger: 'enter',
          event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'warp', screen: streamedBase, x: project.project.startX, y: project.project.startY }] }] }
        }
      }
    ];
    const streamedMap = project.maps.find((m) => m.streamed === true);
    project.sprites.actors.push({ name: 'Trap', behavior: 'npc', hp: 1, damage: 0 });
    const trapActorId = project.sprites.actors.length - 1;
    streamedMap.screens[0].entities = [
      {
        actorId: trapActorId,
        x: project.project.startX,
        y: project.project.startY,
        props: {
          trigger: 'enter',
          event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'damage', value: 99 }] }] }
        }
      }
    ];

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworldlifecycle-gameover-'));
    try {
      await saveProject(dir, project);
      const built = await buildProject({ dir, project, log: () => {} });
      const bytes = new Uint8Array(fs.readFileSync(built.romPath));
      const nes = new NES({ onFrame: () => {}, emulateSound: false });
      nes.loadROM(bytes);
      const mem = nes.cpu.mem;

      // Cold boot on the ORDINARY Before map lands, its own 'enter' warp fires, and the streamed
      // screen's own killing Damage command reaches ST_GAMEOVER -- all within a generous budget,
      // the same "the entry event's own killing Damage command can reach ST_GAMEOVER within a
      // handful of frames" shape test/unit/nameentry.test.js's own precedent documents.
      let frames = 0;
      while (mem[GAME_STATE] !== ST_GAMEOVER && frames < 400) { nes.frame(); frames++; }
      assert.ok(frames < 400, 'the warp-then-Damage chain never reached ST_GAMEOVER');
      // Precondition: the player really did die while map_is_streamed was 1 -- not this test's own
      // assumption, a directly observed fact about the exact death this run produced.
      assert.equal(mem[MAP_IS_STREAMED], 1, 'precondition: the player must have died on the streamed screen, map_is_streamed genuinely 1 at death');

      for (let i = 0; i < 60; i++) nes.frame(); // let the game-over screen settle before Start

      // Arm the write hook BEFORE pressing Start, so it can only catch the display-enable that
      // belongs to THIS restart's own landing -- not the earlier warp's, and not (if the identical
      // warp-then-Damage loop repeats) a later one.
      let restartLandingMem = null;
      const originalWrite = nes.mmap.write.bind(nes.mmap);
      let previousMask = 0;
      nes.mmap.write = (address, value) => {
        if (address === 0x2001) {
          if ((value & 0x18) && !(previousMask & 0x18) && !restartLandingMem) restartLandingMem = mem.slice();
          previousMask = value;
        }
        return originalWrite(address, value);
      };

      tap(nes, START_BTN, 20); // restart_game's own hardwired Start

      let settleFrames = 0;
      while (!restartLandingMem && settleFrames < 300) { nes.frame(); settleFrames++; }
      assert.ok(restartLandingMem, "restart_game's own landing never reached its real $2001 display-enable within 300 frames");
      assert.equal(restartLandingMem[GAME_STATE], ST_GAMEPLAY, 'the restart landing must be real gameplay, not still game-over');
      assert.equal(
        restartLandingMem[MAP_IS_STREAMED],
        0,
        'map_is_streamed must read 0 at the restart landing (the ordinary Before map), not the stale 1 the player died with'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

// ==========================================================================
// Part C2: fix round 1, finding 6 (streamed-start game-over reset) and the
// C-section case 4 ruling (init_session's own defensive map_is_streamed/
// ord_screen clear, engine/combat.asm's init_session_streamed_dispatch, is
// "acceptable redundancy... [t]est meaningful stale destination identity
// (including a streamed start), rather than asserting that deleting this
// particular redundant store must fail" -- review §B). Part C above starts
// on the ORDINARY map and dies on the STREAMED one; this is the mirror
// image -- starts on the STREAMED map, dies on the ORDINARY "After" map
// reached via warp -- so restart must publish map_is_streamed=1 fresh, not
// carry over the stale 0 the player died with. Both directions of the stale
// flag are now proven, not merely the one Part C already covered.
// ==========================================================================
test(
  'game-over reset on a mixed project, streamed start: restarting back onto the streamed start map does not carry a stale map_is_streamed from the ordinary screen the player died on',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({ gameType: 'action', mixed: true, gridW: 3, gridH: 2 });
    const streamedMap = project.maps.find((m) => m.streamed === true);
    const afterMap = project.maps[project.maps.length - 1];
    const afterBase = 10; // mixed:true's own layout: Before 0-3, Streamed 4-9 (3x2), After 10-13
    project.project.startMap = streamedMap.id;
    project.project.startScreen = 0; // local index 0 within the streamed map == global screen 4

    project.sprites.actors.push({ name: 'Door', behavior: 'npc', hp: 1, damage: 0 });
    const doorActorId = project.sprites.actors.length - 1;
    streamedMap.screens[0].entities = [
      {
        actorId: doorActorId,
        x: project.project.startX,
        y: project.project.startY,
        props: {
          trigger: 'enter',
          event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'warp', screen: afterBase, x: project.project.startX, y: project.project.startY }] }] }
        }
      }
    ];
    project.sprites.actors.push({ name: 'Trap', behavior: 'npc', hp: 1, damage: 0 });
    const trapActorId = project.sprites.actors.length - 1;
    afterMap.screens[0].entities = [
      {
        actorId: trapActorId,
        x: project.project.startX,
        y: project.project.startY,
        props: {
          trigger: 'enter',
          event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'damage', value: 99 }] }] }
        }
      }
    ];

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworldlifecycle-gameover-streamedstart-'));
    try {
      await saveProject(dir, project);
      const built = await buildProject({ dir, project, log: () => {} });
      const bytes = new Uint8Array(fs.readFileSync(built.romPath));
      const nes = new NES({ onFrame: () => {}, emulateSound: false });
      nes.loadROM(bytes);
      const mem = nes.cpu.mem;

      let frames = 0;
      while (mem[GAME_STATE] !== ST_GAMEOVER && frames < 400) { nes.frame(); frames++; }
      assert.ok(frames < 400, 'the warp-then-Damage chain never reached ST_GAMEOVER');
      assert.equal(mem[MAP_IS_STREAMED], 0, 'precondition: the player must have died on the ordinary After screen, map_is_streamed genuinely 0 at death');

      for (let i = 0; i < 60; i++) nes.frame(); // let the game-over screen settle before Start

      let restartLandingMem = null;
      const originalWrite = nes.mmap.write.bind(nes.mmap);
      let previousMask = 0;
      nes.mmap.write = (address, value) => {
        if (address === 0x2001) {
          if ((value & 0x18) && !(previousMask & 0x18) && !restartLandingMem) restartLandingMem = mem.slice();
          previousMask = value;
        }
        return originalWrite(address, value);
      };

      tap(nes, START_BTN, 20); // restart_game's own hardwired Start

      let settleFrames = 0;
      while (!restartLandingMem && settleFrames < 300) { nes.frame(); settleFrames++; }
      assert.ok(restartLandingMem, "restart_game's own landing never reached its real $2001 display-enable within 300 frames");
      assert.equal(restartLandingMem[GAME_STATE], ST_GAMEPLAY, 'the restart landing must be real gameplay, not still game-over');
      assert.equal(
        restartLandingMem[MAP_IS_STREAMED],
        1,
        'map_is_streamed must read 1 at the restart landing (the streamed start map), not the stale 0 the player died with'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

// ==========================================================================
// Part D: fix round 1, finding 2 -- the camera publication guard. An outer
// cam_dirty hold (engine/streamworld.asm's sw_frame_camera_window) now
// brackets sw_camera_window_recompute AND sw_pjg_check together, so
// nmi_scroll's own "refresh nmi_cam_x_lo/y_lo/nt only while cam_dirty is
// clear" rule (engine/boot.asm) keeps blocking a mid-transaction NMI from
// adopting this frame's freshly published, not-yet-decided camera all the
// way to the guard's own decision -- not merely up to sw_camera_window_
// recompute's own internal release, the old order. Driven with a REAL
// forced NMI (nes.cpu.nmiPending, the same flag the PPU's own vblank edge
// sets, serviced by the same doNonMaskableInterrupt the hardware path runs)
// landing exactly at sw_pjg_check's first instruction -- "the old
// release/check gap" the finding names -- not a construction argument about
// the source.
// ==========================================================================
test(
  'the camera publication guard blocks a mid-transaction NMI at the old release/check gap (fix round 1, finding 2)',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({ gameType: 'action', gridW: 5, gridH: 5 });
    project.project.startScreen = 12;
    const { emulator, nes, mem, symbols } = await buildAndBootEmulator(project);
    const swPjgCheck = addrOfSymbol(symbols, 'sw_pjg_check');
    const camXLo = CAM_X_LO;
    const camDirty = CAM_DIRTY;
    const nmiCamXLo = NMI_CAM_X_LO;
    const nmiCamYLo = NMI_CAM_Y_LO;
    const nmiCamNt = NMI_CAM_NT;

    // Move the player a real distance first, so the camera has settled well
    // away from (0,0) and there is room to move further right next frame.
    nes.buttonDown(1, RIGHT);
    for (let i = 0; i < 40; i++) nes.frame();
    nes.buttonUp(1, RIGHT);
    for (let i = 0; i < 10; i++) nes.frame();

    const beforeCamX = mem[nmiCamXLo];
    const beforeCamY = mem[nmiCamYLo];
    const beforeCamNt = mem[nmiCamNt];

    // Keep moving into the NEXT frame, so this frame's freshly recomputed
    // cam_x_lo genuinely differs from the last settled NMI snapshot -- a
    // discriminating probe, not a vacuous one.
    nes.buttonDown(1, RIGHT);
    const reached = emulator.runToAddress(swPjgCheck, { frames: 3 });
    assert.ok(reached, 'sw_pjg_check was never reached within budget');

    const midCamX = mem[camXLo];
    const midDirty = mem[camDirty];
    assert.notEqual(
      midCamX,
      beforeCamX,
      'precondition: this frame\'s freshly published cam_x_lo must genuinely differ from the last settled NMI snapshot, or a forced NMI here would not be observable'
    );
    assert.notEqual(midDirty, 0, 'cam_dirty must still be held at the old release/check gap -- the outer hold must not have released yet');

    // Force a REAL NMI right here, through the actual interrupt dispatch
    // (doNonMaskableInterrupt) -- the same one the PPU's own vblank edge
    // uses, just triggered manually at this exact instruction instead of at
    // a real vblank boundary.
    nes.cpu.nmiPending = true;
    for (let i = 0; i < 300; i++) emulator.stepInstruction();
    nes.buttonUp(1, RIGHT);

    assert.equal(
      mem[nmiCamXLo],
      beforeCamX,
      'a forced NMI at the old release/check gap must NOT adopt this frame\'s not-yet-decided cam_x_lo -- the outer cam_dirty hold must still be blocking it'
    );
    assert.equal(mem[nmiCamYLo], beforeCamY, 'a forced NMI at the old release/check gap must NOT adopt this frame\'s not-yet-decided cam_y_lo');
    assert.equal(mem[nmiCamNt], beforeCamNt, 'a forced NMI at the old release/check gap must NOT adopt this frame\'s not-yet-decided cam_nt');
  }
);

// ==========================================================================
// Part D2: fix round 1, finding 3 -- the position-jump guard now DMAs the
// rebuilt shadow OAM into hardware OAM ($4014, engine/streamworld.asm's
// sw_position_jump_guard) before resuming, under blank, so the very first
// display-enable scans OAM that actually matches the just-completed redraw
// instead of whatever a much earlier NMI last DMAed. Also checks the real
// PPU nametable content (nes.ppu.nameTable[i].tile), not merely window
// bookkeeping -- a relabelled-but-unpainted window (sw_render_window
// skipped while win_col/row_screen/local still updated) would leave this
// byte-identical to the pre-jump snapshot and must fail here.
// ==========================================================================
test(
  'the position-jump guard DMAs hardware OAM and actually repaints the nametable before resuming, with a discriminating projection change (fix round 1, finding 3; fix round 2, finding A3)',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    // gridW 4 (wider than createStreamedProject's own 3-screen default): the streamed window is
    // 32 blocks wide, exactly 2 screens -- with only 3 columns, the initial landing's own full
    // redraw at col 0 already covers BOTH visible columns (0 and 1), so a "jump to the far column"
    // technique that only reaches column 1 (the desired ORIGIN at the far clamp, window width 2,
    // is one screen short of the grid's own far edge -- confirmed empirically) samples a block
    // that was already correctly painted at landing, making a redraw-skip mutation unobservable
    // there even though the window position genuinely changed. A 4th column guarantees the far
    // clamp's own desired origin (column 2) sits entirely outside the landing's own painted
    // footprint (columns 0-1), so the probed origin block is a screen this test can know for
    // certain was never painted before the jump.
    const project = createStreamedProject({ gameType: 'action', gridW: 4 });
    const GRID_W = 4, GRID_H = 2;
    // Round 2 finding A3: every screen carries ONE distinct, uniform, nonzero metatile (id, tiles,
    // palette) -- the same "uniform per screen" technique streamworldmove.test.js's own
    // authorLandingTerrain uses for its own landing-group content oracle -- so any block sampled
    // from a given destination screen has a single known expected tile/palette, not the old
    // varied-but-mostly-fill pattern createStreamedProject ships by default (which the round-2
    // review found could pass a >50-changed-tiles count without proving any SPECIFIC block right).
    const streamedMap = project.maps.find((m) => m.streamed === true);
    function screenTilesD2(screenIndex) {
      const t = (screenIndex + 1) * 4;
      return [t, t + 1, t + 2, t + 3];
    }
    function screenPaletteD2(screenIndex) {
      return 1 + (screenIndex % 3); // never 0 -- distinguishable from an unpainted/miscleared block
    }
    for (let i = 0; i < GRID_W * GRID_H; i++) {
      const id = i + 1;
      streamedMap.screens[i].metatiles.fill(id);
      project.metatiles[id] = { id, name: `D2Screen${i}`, tiles: screenTilesD2(i), palette: screenPaletteD2(i), collision: 'open' };
    }
    const { nes, mem } = await buildAndBoot(project);

    // Precondition: a stationary player's own settled window already matches its own desired
    // origin exactly (same precondition Part E's own col-axis test below asserts).
    const natCol = mem[WIN_COL_SCREEN] * 16 + mem[WIN_COL_LOCAL];
    const desCol = mem[SW_FC_DESC] * 16 + mem[SW_FC_DESL];
    assert.equal(natCol, desCol, 'precondition: the settled window must already match its own desired origin');
    const rowScreenNatural = mem[WIN_ROW_SCREEN];
    const rowLocalNatural = mem[WIN_ROW_LOCAL];
    const origColScreen = mem[WIN_COL_SCREEN];
    const origColLocal = mem[WIN_COL_LOCAL];

    // Round 2 finding A3's own root cause: hardware OAM captured BEFORE the jump, independent of
    // whatever the jump later produces -- the discriminating assertion below proves the rebuilt
    // shadow genuinely differs from this, so a missing-DMA mutant cannot pass by leaving hardware
    // coincidentally already correct.
    const preJumpHardware = nes.ppu.spriteMem.slice();

    const origWrite = nes.mmap.write.bind(nes.mmap);
    // Round 2 finding A3: the content check needs the TARGET the guard snaps to (not merely
    // "current", the invisible pre-fire bookkeeping) to genuinely differ from whatever is already
    // painted -- Part E's own poke-"current"-away-from-an-unmoved-"desired" technique snaps back
    // to content byte-identical to what a fully correct engine already painted before this test
    // ever touched anything, so a redraw-skip mutation is unobservable there (confirmed: an earlier
    // draft of this test used exactly that poke, and separately a draft that only advanced sw_col
    // by one screen while holding player_x at a fixed offset, and the relabel-without-redraw
    // mutant below did not fail against either).
    //
    // sw_camera_window_recompute's own desired origin is NOT the player's own screen index -- it
    // is the clamped, player-centred CAMERA pixel position (clamp(worldX-120, 0,
    // (grid_w-1)*256)), offset by half the window's own width (-8 blocks). A one-screen sw_col
    // jump only moves that desired origin by however far camPx itself moved, which can be far
    // short of the 6-block trip threshold once the window is already near the middle of its own
    // travel (confirmed empirically: a +1-screen jump from this fixture's own default landing,
    // col 0 / player_x 120 -- itself already pinned at the LOW camera clamp, since worldX-120=0
    // there -- to col 1 / player_x 32 only moves the desired column by 2 blocks, not 6+, and the
    // guard never fires). Landing on the opposite clamp extreme instead guarantees the largest
    // possible real camPx delta this grid can produce: jump sw_col to the FAR end of the grid from
    // wherever it currently sits (never the same screen, since GRID_W > 1) -- a full
    // (GRID_W-1)*256-120 pixel swing, always >> 96px (6 blocks) for any grid this project can
    // build. The guard's own target is then verified dynamically below (colScreenAfter/
    // colLocalAfter, read back from memory after the guard settles), never hand-predicted here.
    //
    // Both this fixture's default landing (col 0, player_x 120) and the far end of a 3-wide grid
    // (col 2, worldX = 2*256+120 = 632) clamp camPx to an EXTREME (0 and 512 respectively) -- but
    // the player's own OAM projection (worldX - clamped origin) then reduces to the same 120 at
    // both extremes by simple symmetry of this fixture's own numbers, which would make the OAM
    // half of this test vacuous again even though the window itself genuinely moved (confirmed
    // empirically: with player_x left at 120, enableSnapshot.shadow above came back byte-identical
    // to preJumpHardware). player_x is also reassigned to a value distinct from the landing's own
    // 120 so the projected OAM position is a real, independently-different number at the new
    // extreme, not merely a coincidentally-restated one.
    const farCol = origColScreen < GRID_W - 1 ? GRID_W - 1 : 0;
    mem[SW_COL] = farCol;
    mem[PLAYER_X] = 200;
    mem[ST_ACTIVE] = 1;

    let sawDisable = false;
    let enableSnapshot = null;
    nes.mmap.write = (address, value) => {
      if (address === 0x2001) {
        if (!sawDisable && (value & 0x18) === 0) sawDisable = true;
        else if (sawDisable && !enableSnapshot && (value & 0x18) !== 0) {
          // Captured BEFORE handing off to the real write -- the DMA the
          // guard just issued (a synchronous $4014 store, already fully
          // applied to nes.ppu.spriteMem by the time control reaches this
          // hook) must already be visible here, at the very first enable,
          // before any later NMI could supply its own coincidental DMA.
          enableSnapshot = {
            shadow: mem.slice(0x200, 0x300),
            hardware: nes.ppu.spriteMem.slice(),
            nt: nes.ppu.nameTable.map((t) => ({ tile: t.tile.slice(), attrib: t.attrib.slice() }))
          };
        }
      }
      return origWrite(address, value);
    };
    for (let i = 0; i < 60 && !enableSnapshot; i++) nes.frame();
    nes.mmap.write = origWrite;

    assert.ok(enableSnapshot, 'the guard never reached its first display-enable within budget');

    assert.notDeepEqual(
      Array.from(enableSnapshot.shadow.slice(0, 16)),
      Array.from(preJumpHardware.slice(0, 16)),
      'precondition: the jump must produce a real OAM projection change -- the rebuilt shadow must differ from the hardware OAM that existed before the jump, or a missing DMA could pass by coincidence'
    );
    assert.deepEqual(
      Array.from(enableSnapshot.hardware),
      Array.from(enableSnapshot.shadow),
      'hardware OAM must exactly match the just-rebuilt shadow OAM at the first display-enable -- a missing $4014 DMA leaves it describing the pre-guard frame instead'
    );

    // Nametable AND attribute content at first enable, against an independent oracle (the
    // uniform per-screen metatile authored above), not merely "some tiles changed". The window's
    // own flat origin block (delta 0,0 from win_col_screen/local after the snap, and the
    // untouched row axis) is guaranteed to lie inside the destination screen (colLocal/rowLocal
    // are always < 16/15), so its physical nametable position is a direct, well-defined check --
    // the same wbase_col/row physical-ring mapping sw_render_window itself uses (also
    // independently re-derived in streamworldmove.test.js's own wbaseAxis).
    const colScreenAfter = mem[WIN_COL_SCREEN], colLocalAfter = mem[WIN_COL_LOCAL];
    const desColAfter = mem[SW_FC_DESC] * 16 + mem[SW_FC_DESL];
    assert.equal(colScreenAfter * 16 + colLocalAfter, desColAfter, 'the guard must snap "current" exactly onto this frame\'s own desired origin');
    assert.ok(
      colScreenAfter !== origColScreen || colLocalAfter !== origColLocal,
      'precondition: the jump must land the window on a genuinely different block position than the one already painted'
    );
    const wbaseCol = (colScreenAfter & 1) * 16 + colLocalAfter;
    const wbaseRow = (rowScreenNatural & 1) * 15 + rowLocalNatural;
    const nt = (wbaseCol >= 16 ? 1 : 0) | (wbaseRow >= 15 ? 2 : 0);
    const bc = wbaseCol % 16, br = wbaseRow % 15;
    const targetScreenIndex = rowScreenNatural * GRID_W + colScreenAfter;
    const expectedTiles = screenTilesD2(targetScreenIndex);
    const expectedPalette = screenPaletteD2(targetScreenIndex);
    const ntable = enableSnapshot.nt[nt];
    const base = 2 * br * 32 + 2 * bc;
    const positions = [base, base + 1, base + 32, base + 33];
    const corners = ['tl', 'tr', 'bl', 'br'];
    for (let k = 0; k < 4; k++) {
      assert.equal(ntable.tile[positions[k]], expectedTiles[k], `window origin block (nt ${nt}, ${bc},${br}) ${corners[k]} tile id at first display-enable`);
      assert.equal(ntable.attrib[positions[k]], expectedPalette * 4, `window origin block (nt ${nt}, ${bc},${br}) ${corners[k]} attribute/palette at first display-enable`);
    }
  }
);

// ==========================================================================
// Part E: the position-jump guard (engine/streamworld.asm's
// sw_position_jump_guard/sw_pjg_check/sw_pjg_lag_trip, genuinely new this
// slice) discharges every obligation the plan names for it. Driven by a
// deterministic RAM poke rather than an organic desync: with the player held
// perfectly stationary, sw_camera_window_recompute (called every frame,
// before sw_pjg_check, from sw_frame_camera_window) recomputes the SAME
// desired window origin (sw_fc_desc/desl/desr/desrl) regardless of whatever
// win_col_screen/win_col_local/win_row_screen/win_row_local ("current") this
// test pokes directly -- confirmed by reading sw_camera_window_recompute's
// own body, which derives camPx/camPy purely from sw_col/sw_row/player_x/
// player_y and never reads the window's own current position. So poking
// "current" to be exactly N blocks away from the real, freshly-recomputed
// "desired" produces an exact, reproducible lag of N with no dependence on
// engine movement/collision timing.
//
// The $2001 (PPUMASK) write hook below is the SAME technique Part C's own
// game-over-restart detection already uses, extended here to COUNT real
// nes.frame() boundary crossings between the disabling write and the
// re-enabling write. This is deliberately NOT sw_render_window's own
// internal notion of how long it took -- there is no such counter; the
// count is a real, measured, emergent side effect of the routine's own
// elapsed CPU cycles crossing that many independent PPU frame boundaries
// while jsnes's own nes.frame() keeps returning at each one, regardless of
// what 6502 code is executing at that instant (docs/reference-emulator.md).
// A scratch probe (not committed) confirmed this count is exactly 33 on a
// freshly-settled boot's own FIRST guard-driven forced blank, both axes,
// and confirmed it drifts by +/-1 on a SECOND trigger chained immediately
// after a first one in the same boot (ordinary cycle-phase jitter, the same
// class of effect this file's own needs-ruling NMI-race note already
// discloses elsewhere) -- so each sub-test below uses its own fresh boot,
// each guard fire being the first since that boot's own settle, to keep the
// pinned count reproducible rather than exposed to that jitter.
// ==========================================================================
test(
  'position-jump guard (col axis): lag 5 does not fire, lag 6 snaps straight to the target origin and discharges every obligation',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({ gameType: 'action' });
    // Fix round 1, finding 6: the guard must not perform any of a fresh arrival's own actions
    // (re-run an entry event, respawn an entity, or set screen_fresh) -- an 'enter'-triggered
    // marker sitting exactly at spawn, the same recipe Part B's own Marker actor uses, gives a
    // real oracle for the first of those; ent_active/screen_fresh are checked directly against
    // their own pre-trigger values below, needing no additional authored entity.
    project.sprites.actors[0] = { name: 'Marker', behavior: 'npc', hp: 1, damage: 0 };
    const streamedMap0 = project.maps.find((m) => m.streamed === true);
    streamedMap0.screens[0].entities = [
      {
        actorId: 0,
        x: project.project.startX,
        y: project.project.startY,
        props: {
          trigger: 'enter',
          event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 0, value: 1 }] }] }
        }
      }
    ];
    const { nes, mem } = await buildAndBoot(project);
    assert.equal(mem[VARIABLES], 1, 'precondition: the entry event must have run exactly once at cold boot');

    // Precondition: a stationary player's own settled window already matches
    // its own desired origin exactly -- no natural lag to confound the poke.
    const natCol = mem[WIN_COL_SCREEN] * 16 + mem[WIN_COL_LOCAL];
    const desCol = mem[SW_FC_DESC] * 16 + mem[SW_FC_DESL];
    assert.equal(natCol, desCol, 'precondition: the settled window must already match its own desired origin');

    const origWrite = nes.mmap.write.bind(nes.mmap);
    const pokeCol = (blocks) => {
      mem[WIN_COL_SCREEN] = Math.floor(blocks / 16);
      mem[WIN_COL_LOCAL] = blocks % 16;
    };

    // ---- boundary: lag 5 must NOT fire the guard -- sw_pjg_lag_trip's own
    // documented threshold is >= 6, not > 5; this is the negative half of
    // that exact boundary, not merely "some smaller lag". ----
    const delta5 = desCol + 6 <= 47 ? 5 : -5;
    pokeCol(desCol + delta5);
    let saw2001AtLag5 = false;
    nes.mmap.write = (address, value) => {
      if (address === 0x2001) saw2001AtLag5 = true;
      return origWrite(address, value);
    };
    nes.frame();
    nes.mmap.write = origWrite;
    assert.equal(saw2001AtLag5, false, 'lag 5 must not force a blank -- ordinary steady streamed gameplay never writes $2001 at all (verified by inspection: only cold boot, the guard itself, and a battle-return redraw touch it)');

    // ---- trigger: lag 6 must fire, and discharge every obligation. ----
    const desColAtTrigger = mem[SW_FC_DESC] * 16 + mem[SW_FC_DESL];
    const delta6 = desColAtTrigger + 6 <= 47 ? 6 : -6;
    pokeCol(desColAtTrigger + delta6);
    mem[ST_ACTIVE] = 1; // arm a fake in-flight strip: obligation "cancel a strip on entry"
    const playerBefore = [mem[PLAYER_X], mem[PLAYER_Y]];
    const screenFreshBefore = mem[SCREEN_FRESH];
    const entActiveCountBefore = (() => {
      let n = 0;
      for (let i = 0; i < MAX_ENTITIES; i++) if (mem[ENT_ACTIVE + i] !== 0) n++;
      return n;
    })();

    let sawDisable = false;
    let sawEnable = false;
    let blankFrames = 0; // independent count: real nes.frame() calls strictly between the two writes
    const positionsDuring = [];
    nes.mmap.write = (address, value) => {
      if (address === 0x2001) {
        if (!sawDisable && (value & 0x18) === 0) sawDisable = true;
        else if (sawDisable && !sawEnable && (value & 0x18) !== 0) sawEnable = true;
      }
      return origWrite(address, value);
    };
    let iterations = 0;
    for (; iterations < 60 && !sawEnable; iterations++) {
      nes.frame();
      positionsDuring.push([mem[PLAYER_X], mem[PLAYER_Y]]);
      if (sawDisable && !sawEnable) blankFrames++;
    }
    nes.mmap.write = origWrite;

    assert.ok(sawDisable, 'the guard must force blank ($2001 disabled) when lag reaches 6');
    assert.ok(sawEnable, 'the guard must re-enable rendering again once its own redraw completes');
    // Pinned from a real, measured run (not sw_render_window's own internal count):
    // catches sabotage case 6, an extra or missing wait_vblank_poll inside the guard.
    assert.equal(blankFrames, 33, "the guard's own forced-blank span must be exactly 33 real frame boundaries -- a one-frame-short/long mutation of its own wait_vblank_poll calls must change this count");

    const colAfter = mem[WIN_COL_SCREEN] * 16 + mem[WIN_COL_LOCAL];
    assert.equal(colAfter, desColAtTrigger, "the guard must SNAP straight to the target origin (obligation: target-origin install), not merely narrow the gap the way the ordinary incremental approach does");
    assert.equal(mem[ST_ACTIVE], 0, 'the guard must cancel any strip that was in flight before it fired (obligation: strip cancellation on entry)');
    assert.ok(
      positionsDuring.every(([x, y]) => x === playerBefore[0] && y === playerBefore[1]),
      "the player's own position must be frozen for every frame the guard's forced blank spans (obligation: movement frozen throughout)"
    );

    // Containment on first resumed publication (obligation): the same invariant
    // makeContainmentChecker (test/unit/streamworldmove.test.js) and Part B above
    // both check, reimplemented minimally here.
    const camPx = (mem[SW_CAM_ORIGIN_X_HI] << 8) | mem[SW_CAM_ORIGIN_X_LO];
    const camPy = (mem[SW_CAM_ORIGIN_Y_HI] << 8) | mem[SW_CAM_ORIGIN_Y_LO];
    const visLoX = Math.floor(camPx / 16), visHiX = Math.floor((camPx + 255) / 16);
    const visLoY = Math.floor(camPy / 16), visHiY = Math.floor((camPy + 239) / 16);
    const colBlock = mem[WIN_COL_SCREEN] * 16 + mem[WIN_COL_LOCAL];
    const rowBlock = mem[WIN_ROW_SCREEN] * 15 + mem[WIN_ROW_LOCAL];
    assert.ok(visLoX >= colBlock && visHiX <= colBlock + 31, 'position-jump guard: visible X range must be inside the resynced window on the first resumed frame');
    assert.ok(visLoY >= rowBlock && visHiY <= rowBlock + 29, 'position-jump guard: visible Y range must be inside the resynced window on the first resumed frame');

    // Fix round 1, finding 6: the guard is a resync, not a fresh arrival -- it must do NONE of a
    // landing's own spawn/restoration actions. sw_position_jump_guard's own body (engine/
    // streamworld.asm) calls only sw_render_window/build_oam/draw_entities/wait_vblank_poll/DMA --
    // never spawn_entities -- so none of these may move from their pre-trigger values.
    assert.equal(mem[VARIABLES], 1, 'the guard must not re-run the entry event (obligation: no fresh-arrival actions)');
    const entActiveCountAfter = (() => {
      let n = 0;
      for (let i = 0; i < MAX_ENTITIES; i++) if (mem[ENT_ACTIVE + i] !== 0) n++;
      return n;
    })();
    assert.equal(entActiveCountAfter, entActiveCountBefore, 'the guard must not respawn/despawn any entity (obligation: no fresh-arrival actions)');
    assert.equal(mem[SCREEN_FRESH], screenFreshBefore, 'the guard must not set screen_fresh the way a real landing does (obligation: no fresh-arrival actions)');
  }
);

// ==========================================================================
// Part E continued: the row axis fires through the exact same shared
// sw_pjg_lag_trip check sw_pjg_check calls for both axes (source: engine/
// streamworld.asm, both call sites identical apart from which scratch bytes
// they pass) -- a fresh boot, so its own first-ever guard fire stays free of
// the phase jitter documented above, giving the same reproducible count.
// ==========================================================================
test(
  'position-jump guard (row axis): the shared lag check fires symmetrically and snaps the row origin',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({ gameType: 'action' });
    // Fix round 1, finding 6: same no-fresh-arrival oracle as the col-axis test above.
    project.sprites.actors[0] = { name: 'Marker', behavior: 'npc', hp: 1, damage: 0 };
    const streamedMap0 = project.maps.find((m) => m.streamed === true);
    streamedMap0.screens[0].entities = [
      {
        actorId: 0,
        x: project.project.startX,
        y: project.project.startY,
        props: {
          trigger: 'enter',
          event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 0, value: 1 }] }] }
        }
      }
    ];
    const { nes, mem } = await buildAndBoot(project);
    assert.equal(mem[VARIABLES], 1, 'precondition: the entry event must have run exactly once at cold boot');

    const desRow = mem[SW_FC_DESR] * 15 + mem[SW_FC_DESRL];
    const delta6 = desRow + 6 <= 29 ? 6 : -6;
    mem[WIN_ROW_SCREEN] = Math.floor((desRow + delta6) / 15);
    mem[WIN_ROW_LOCAL] = (desRow + delta6) % 15;
    mem[ST_ACTIVE] = 2; // a row strip this time, not a column one
    const screenFreshBefore = mem[SCREEN_FRESH];
    const entActiveCountBefore = (() => {
      let n = 0;
      for (let i = 0; i < MAX_ENTITIES; i++) if (mem[ENT_ACTIVE + i] !== 0) n++;
      return n;
    })();

    const origWrite = nes.mmap.write.bind(nes.mmap);
    let sawDisable = false;
    let sawEnable = false;
    let blankFrames = 0;
    nes.mmap.write = (address, value) => {
      if (address === 0x2001) {
        if (!sawDisable && (value & 0x18) === 0) sawDisable = true;
        else if (sawDisable && !sawEnable && (value & 0x18) !== 0) sawEnable = true;
      }
      return origWrite(address, value);
    };
    for (let i = 0; i < 60 && !sawEnable; i++) {
      nes.frame();
      if (sawDisable && !sawEnable) blankFrames++;
    }
    nes.mmap.write = origWrite;

    assert.ok(sawDisable && sawEnable, 'a row-axis lag of 6 must fire the guard through the identical shared check');
    assert.equal(blankFrames, 33, 'the row-axis fire must cost the identical, exactly-pinned blank span as the col-axis fire (same shared routine)');
    assert.equal(mem[WIN_ROW_SCREEN] * 15 + mem[WIN_ROW_LOCAL], desRow, 'the row axis must also snap straight to its own target origin');
    assert.equal(mem[ST_ACTIVE], 0, 'the guard must cancel a row strip exactly as it does a column strip');

    // Fix round 1, finding 6: same no-fresh-arrival obligations as the col-axis test above.
    assert.equal(mem[VARIABLES], 1, 'the guard must not re-run the entry event (obligation: no fresh-arrival actions)');
    const entActiveCountAfter = (() => {
      let n = 0;
      for (let i = 0; i < MAX_ENTITIES; i++) if (mem[ENT_ACTIVE + i] !== 0) n++;
      return n;
    })();
    assert.equal(entActiveCountAfter, entActiveCountBefore, 'the guard must not respawn/despawn any entity (obligation: no fresh-arrival actions)');
    assert.equal(mem[SCREEN_FRESH], screenFreshBefore, 'the guard must not set screen_fresh the way a real landing does (obligation: no fresh-arrival actions)');
  }
);

// ==========================================================================
// Case 1 (fix round 2, review round 2's own "read-back cheat"): the review demanded real mutant
// evidence, not a construction argument, that the col/row-axis tests' own blankFrames measurement
// above is a genuine INDEPENDENT count of real nes.frame() boundaries, not a read-back of some
// engine-side or derived notion of "how long the guard's blank lasted." FRAME_CNT (engine/
// constants.asm's frame_cnt, incremented only inside the real NMI handler, `inc <frame_cnt`,
// engine/boot.asm:692) is exactly the kind of engine-side value a read-back cheat would reach
// for -- and sw_position_jump_guard disables NMI (`lda #0 / sta $2000`, its very first store) for
// its ENTIRE forced-blank span, so frame_cnt cannot advance at all while the guard is blanked,
// regardless of how many real frame boundaries actually elapse. A "cheat" harness measuring
// duration via frame_cnt's own before/after delta is therefore blind by construction: it reads
// exactly 0 whether the guard's real span is 33 frames (the unbroken engine) or 32 (sabotage 6a,
// one-frame-short -- the guard's own `jsr wait_vblank_poll` deleted via a project.code.overrides
// patched COPY of engine/streamworld.asm, the real file on disk never touched) -- so it cannot
// tell the two engines apart, and "accepts" the short engine as identical to the real one. The
// SAME two built-and-booted engines, measured simultaneously by this file's own independent
// real-frame blankFrames count, correctly read 33 vs 32 and so correctly reject the short engine.
// Both outcomes are asserted below on real mutant evidence, not by inspection alone.
// ==========================================================================
test(
  "Case 1 (read-back cheat): a frame_cnt-derived duration reader cannot distinguish the guard's real 33-frame blank from a one-frame-short mutant, unlike the independent real-frame counter",
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    function triggerRecipe(project) {
      project.sprites.actors[0] = { name: 'Marker', behavior: 'npc', hp: 1, damage: 0 };
      const streamedMap0 = project.maps.find((m) => m.streamed === true);
      streamedMap0.screens[0].entities = [
        {
          actorId: 0,
          x: project.project.startX,
          y: project.project.startY,
          props: {
            trigger: 'enter',
            event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 0, value: 1 }] }] }
          }
        }
      ];
      return project;
    }

    async function runOnce(applyShortMutant) {
      const project = triggerRecipe(createStreamedProject({ gameType: 'action' }));
      if (applyShortMutant) {
        const stockText = fs.readFileSync(path.join(ROOT, 'engine/streamworld.asm'), 'utf8');
        const needle = '  jsr draw_entities\n  jsr wait_vblank_poll\n';
        assert.ok(
          stockText.includes(needle),
          "sw_position_jump_guard's own draw_entities/wait_vblank_poll shape did not match -- engine/streamworld.asm changed since this needle was written; update it"
        );
        const patched = stockText.replace(needle, '  jsr draw_entities\n');
        project.code = { overrides: [{ name: 'streamworld.asm', text: patched }], files: [] };
      }
      const { nes, mem } = await buildAndBoot(project);
      assert.equal(mem[VARIABLES], 1, 'precondition: the entry event must have run exactly once at cold boot');

      const desCol = mem[SW_FC_DESC] * 16 + mem[SW_FC_DESL];
      const delta6 = desCol + 6 <= 47 ? 6 : -6;
      mem[WIN_COL_SCREEN] = Math.floor((desCol + delta6) / 16);
      mem[WIN_COL_LOCAL] = (desCol + delta6) % 16;

      const origWrite = nes.mmap.write.bind(nes.mmap);
      let sawDisable = false;
      let sawEnable = false;
      let blankFrames = 0; // independent: real nes.frame() boundaries, same technique as Part E above
      let frameCntAtDisable = null;
      let frameCntAtEnable = null;
      nes.mmap.write = (address, value) => {
        if (address === 0x2001) {
          if (!sawDisable && (value & 0x18) === 0) {
            sawDisable = true;
            frameCntAtDisable = mem[FRAME_CNT];
          } else if (sawDisable && !sawEnable && (value & 0x18) !== 0) {
            sawEnable = true;
            frameCntAtEnable = mem[FRAME_CNT];
          }
        }
        return origWrite(address, value);
      };
      for (let i = 0; i < 60 && !sawEnable; i++) {
        nes.frame();
        if (sawDisable && !sawEnable) blankFrames++;
      }
      nes.mmap.write = origWrite;
      assert.ok(sawDisable && sawEnable, 'the guard must fire and resume exactly as the col-axis test above establishes');

      const frameCntDelta = (frameCntAtEnable - frameCntAtDisable) & 0xff;
      return { blankFrames, frameCntDelta };
    }

    const real = await runOnce(false);
    const short = await runOnce(true);

    // The independent real-frame counter: genuinely discriminates.
    assert.equal(real.blankFrames, 33, "precondition: the real engine's own guard span is the same pinned 33 frames Part E measures");
    assert.equal(short.blankFrames, 32, 'the one-frame-short mutant (sabotage 6a) must measure exactly one real frame boundary less -- the independent counter correctly REJECTS the short engine');
    assert.notEqual(real.blankFrames, short.blankFrames, 'the independent real-frame counter must be able to tell the two engines apart');

    // The read-back cheat: frame_cnt cannot advance while the guard holds NMI off for its whole
    // blank span, so a duration reader built on it is blind to this exact mutation -- both
    // engines read the same (zero) delta, and the cheat therefore ACCEPTS the short engine as
    // indistinguishable from the real one.
    assert.equal(real.frameCntDelta, 0, "frame_cnt cannot advance during the real engine's own guard span either -- NMI is off for the whole transaction");
    assert.equal(short.frameCntDelta, 0, 'frame_cnt still reads a zero delta on the one-frame-short mutant -- the read-back cheat cannot see the missing frame');
    assert.equal(
      real.frameCntDelta,
      short.frameCntDelta,
      'Case 1: a frame_cnt-derived duration reader gives the SAME (zero) answer for the real engine and the one-frame-short mutant -- it accepts the short engine the independent real-frame counter correctly rejects'
    );
  }
);

// ==========================================================================
// Part E2: fix round 1, finding 6 -- the matrix's actual fresh-arrival oracles for boot and
// door. streamworldmove.test.js's own landing test ("streamed landing installs the tracking
// window directly") proves resolved camera/window/terrain/OAM at a landing, but authors no
// entities and asserts nothing about entry events, entity spawn or screen_fresh -- exactly the
// gap the review names. This test authors a real entry-triggered marker (identical recipe to
// Part B/E's own) directly on the destination screen for both a cold-boot landing and a
// door-warp landing, and checks all three fresh-arrival effects at the SAME real $2001
// display-enable instant the guard's own no-fresh-arrival tests above are pinned to -- so a
// side-by-side reading of Part E's "must NOT" assertions against this test's "MUST" assertions
// is a genuine positive/negative pair for the same three effects.
// ==========================================================================
test('§8 matrix: boot and door are fresh contexts -- entry event fires, the entity spawns, screen_fresh is set', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  async function bootAndCaptureFirstEnable(project, label) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworldlifecycle-fresh-'));
    try {
      await saveProject(dir, project);
      const built = await buildProject({ dir, project, log: () => {} });
      const bytes = new Uint8Array(fs.readFileSync(built.romPath));
      const nes = new NES({ onFrame: () => {}, emulateSound: false });
      nes.loadROM(bytes);
      const mem = nes.cpu.mem;
      // Fix round 4, item 1: watch the whole arrival/settle span, boot through the entry event.
      const guard = watchPositionJumpGuard(nes, fs.readFileSync(built.symbolPath, 'utf8'));
      let firstEnableMem = null;
      const originalWrite = nes.mmap.write.bind(nes.mmap);
      let previousMask = 0;
      nes.mmap.write = (address, value) => {
        if (address === 0x2001) {
          if ((value & 0x18) && !(previousMask & 0x18) && mem[MAP_IS_STREAMED] === 1 && !firstEnableMem) {
            firstEnableMem = mem.slice();
          }
          previousMask = value;
        }
        return originalWrite(address, value);
      };
      let frames = 0;
      while (!firstEnableMem && frames < 400) { nes.frame(); frames++; }
      assert.ok(firstEnableMem, 'the landing must reach its own real $2001 display-enable write within 400 frames');
      // Touch/enter events only arm pending_ent at the exact display-enable instant
      // (docs/reference-event-system.md: "a frame that draws a screen or decides a warp belongs to
      // that transition, not to the player"); main_loop turns that into a real command/VARIABLES
      // effect on a LATER frame, so entry-event completion is checked on live mem a few settle
      // frames afterward, not on the frozen firstEnableMem snapshot itself (unlike ent_active/
      // screen_fresh, which the engine already guarantees are current AT that exact instant --
      // Part B/E's own precedent for screen_fresh, spawn_entities' own unconditional
      // `sta <screen_fresh` for ent_active, both engine/entities.asm).
      for (let i = 0; i < 20; i++) nes.frame();
      guard.assertNone(`${label}, through settle`);
      guard.unwatch();
      return { firstEnableMem, mem };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  await t.test('boot', async () => {
    const project = createStreamedProject({ gameType: 'action' });
    project.sprites.actors[0] = { name: 'Marker', behavior: 'npc', hp: 1, damage: 0 };
    const streamedMap = project.maps.find((m) => m.streamed === true);
    streamedMap.screens[0].entities = [
      {
        actorId: 0,
        x: project.project.startX,
        y: project.project.startY,
        props: {
          trigger: 'enter',
          event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 0, value: 1 }] }] }
        }
      }
    ];
    const { firstEnableMem, mem } = await bootAndCaptureFirstEnable(project, 'boot');
    assert.equal(firstEnableMem[ENT_ACTIVE], 1, "boot: the marker's own ent_active slot must be spawned at the first real display-enable");
    assert.equal(firstEnableMem[SCREEN_FRESH], 1, 'boot: screen_fresh must be set at the first real display-enable');
    assert.equal(mem[VARIABLES], 1, 'boot: the entry event must have run once, shortly after the landing');
  });

  await t.test('door', async () => {
    const project = createStreamedProject({ gameType: 'action', mixed: true });
    const [before] = project.maps;
    const streamedMap = project.maps.find((m) => m.streamed === true);
    const streamedBase = 4; // mixed:true's own 2x2 "Before" map occupies global screens 0-3
    project.sprites.actors.push({ name: 'Door', behavior: 'npc', hp: 1, damage: 0 });
    const doorActorId = project.sprites.actors.length - 1;
    before.screens[0].entities = [
      {
        actorId: doorActorId,
        x: project.project.startX,
        y: project.project.startY,
        props: {
          trigger: 'enter',
          event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'warp', screen: streamedBase, x: project.project.startX, y: project.project.startY }] }] }
        }
      }
    ];
    project.sprites.actors.push({ name: 'Marker', behavior: 'npc', hp: 1, damage: 0 });
    const markerActorId = project.sprites.actors.length - 1;
    streamedMap.screens[0].entities = [
      {
        actorId: markerActorId,
        x: project.project.startX,
        y: project.project.startY,
        props: {
          trigger: 'enter',
          event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 0, value: 1 }] }] }
        }
      }
    ];
    const { firstEnableMem, mem } = await bootAndCaptureFirstEnable(project, 'door');
    assert.equal(firstEnableMem[ENT_ACTIVE], 1, "door: the destination marker's own ent_active slot must be spawned at the first real display-enable");
    assert.equal(firstEnableMem[SCREEN_FRESH], 1, 'door: screen_fresh must be set at the first real display-enable');
    assert.equal(mem[VARIABLES], 1, "door: the destination's own entry event must have run once, shortly after landing");
  });

  // Fix round 2 (review round 3, finding A6/C1): the 'door' subtest above authors an ordinary
  // NPC's enter-triggered `op:'warp'` event -- it proves that route, and only that route. A real
  // `behavior: 'door'` actor takes a mechanically distinct engine path: entity_door
  // (engine/entities.asm:495-507) sets warp_ready/warp_scr/warp_x/warp_y directly from the
  // entity's own baked ent_to_scr/ent_to_x/ent_to_y fields on physical touch alone -- no event, no
  // start_dialog/pending_ent, no dialogue box -- and take_door is called the SAME frame from
  // main_loop_warp (engine/boot.asm:271-276), not deferred a frame to settle_owed_warp the way an
  // event's own warp command is (engine/boot.asm:284-318). This subtest drives that caller by
  // itself, with no event on the door actor at all.
  await t.test('doorActor', async () => {
    const project = createStreamedProject({ gameType: 'action', mixed: true });
    const [before] = project.maps;
    const streamedMap = project.maps.find((m) => m.streamed === true);
    const streamedBase = 4; // mixed:true's own 2x2 "Before" map occupies global screens 0-3
    project.sprites.actors.push({ name: 'Door', behavior: 'door' });
    const doorActorId = project.sprites.actors.length - 1;
    before.screens[0].entities = [
      {
        actorId: doorActorId,
        x: project.project.startX,
        y: project.project.startY,
        props: { toScreen: streamedBase, toX: project.project.startX, toY: project.project.startY }
      }
    ];
    project.sprites.actors.push({ name: 'Marker', behavior: 'npc', hp: 1, damage: 0 });
    const markerActorId = project.sprites.actors.length - 1;
    streamedMap.screens[0].entities = [
      {
        actorId: markerActorId,
        x: project.project.startX,
        y: project.project.startY,
        props: {
          trigger: 'enter',
          event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 0, value: 1 }] }] }
        }
      }
    ];
    const { firstEnableMem, mem } = await bootAndCaptureFirstEnable(project, 'doorActor');
    assert.equal(firstEnableMem[ENT_ACTIVE], 1, "doorActor: the destination marker's own ent_active slot must be spawned at the first real display-enable, reached via entity_door/take_door rather than an authored warp command");
    assert.equal(firstEnableMem[SCREEN_FRESH], 1, 'doorActor: screen_fresh must be set at the first real display-enable');
    assert.equal(mem[VARIABLES], 1, "doorActor: the destination's own entry event must have run once, shortly after landing");
  });

  // Fix round 2 (review round 3, finding A6/C1): every case above crosses a map boundary
  // (ordinary source map -> the streamed map). A same-map streamed-to-streamed warp is a distinct
  // case: both the source and destination screen already have map_is_streamed=1 and share the same
  // cur_map, so this proves the fresh-arrival reset (screen_fresh, entry event, entity spawn) does
  // not silently depend on the map-boundary crossing every other case in this matrix happens to
  // cross. Cold boot lands on the streamed map's own screen 0 (itself already a fresh context, per
  // the 'boot' subtest above); a door actor placed at the landing spot fires immediately on
  // physical touch and warps to global screen 1, still on the same streamed map.
  await t.test('sameMapWarp', async () => {
    const project = createStreamedProject({ gameType: 'action' });
    const streamedMap = project.maps.find((m) => m.streamed === true);
    project.sprites.actors.push({ name: 'Door', behavior: 'door' });
    const doorActorId = project.sprites.actors.length - 1;
    streamedMap.screens[0].entities = [
      {
        actorId: doorActorId,
        x: project.project.startX,
        y: project.project.startY,
        props: { toScreen: 1, toX: project.project.startX, toY: project.project.startY }
      }
    ];
    project.sprites.actors.push({ name: 'Marker', behavior: 'npc', hp: 1, damage: 0 });
    const markerActorId = project.sprites.actors.length - 1;
    streamedMap.screens[1].entities = [
      {
        actorId: markerActorId,
        x: project.project.startX,
        y: project.project.startY,
        props: {
          trigger: 'enter',
          event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 1, value: 1 }] }] }
        }
      }
    ];

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworldlifecycle-samemap-'));
    let nes, mem, capturedAtScreen1;
    try {
      await saveProject(dir, project);
      const built = await buildProject({ dir, project, log: () => {} });
      const bytes = new Uint8Array(fs.readFileSync(built.romPath));
      nes = new NES({ onFrame: () => {}, emulateSound: false });
      nes.loadROM(bytes);
      mem = nes.cpu.mem;
      // Fix round 4, item 1: watch the whole cold-boot-through-same-map-warp span.
      const guard = watchPositionJumpGuard(nes, fs.readFileSync(built.symbolPath, 'utf8'));

      capturedAtScreen1 = null;
      const originalWrite = nes.mmap.write.bind(nes.mmap);
      let previousMask = 0;
      nes.mmap.write = (address, value) => {
        if (address === 0x2001) {
          if ((value & 0x18) && !(previousMask & 0x18) && mem[FLAT_SCREEN] === 1 && !capturedAtScreen1) {
            capturedAtScreen1 = mem.slice();
          }
          previousMask = value;
        }
        return originalWrite(address, value);
      };
      let frames = 0;
      while (!capturedAtScreen1 && frames < 400) { nes.frame(); frames++; }
      nes.mmap.write = originalWrite;
      assert.ok(capturedAtScreen1, "sameMapWarp: the same-map door warp must reach global screen 1's own display-enable within 400 frames");

      for (let i = 0; i < 20; i++) nes.frame();
      guard.assertNone('sameMapWarp, through settle');
      guard.unwatch();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    assert.equal(capturedAtScreen1[MAP_IS_STREAMED], 1, 'sameMapWarp: the destination screen must still be inside the streamed map');
    assert.equal(capturedAtScreen1[SCREEN_FRESH], 1, 'sameMapWarp: screen_fresh must be set again for the second streamed screen, not left over from the first landing');
    assert.equal(capturedAtScreen1[ENT_ACTIVE], 1, "sameMapWarp: screen 1's own marker must be spawned at its own first real display-enable");
    assert.equal(mem[VARIABLES + 1], 1, "sameMapWarp: screen 1's own entry event must have run once, shortly after the same-map warp landed");
  });
});

// ==========================================================================
// Fix round 2 (review round 3, finding A6/C1): the Map Forge's own ▶Test button is a THIRD real
// caller into a streamed destination, distinct from both an ordinary boot and an authored door --
// renderer/emulator/testplay.js's applyStartOverride pokes warp_scr/warp_x/warp_y/warp_ready
// directly at main_loop_warp (the exact instant main_loop itself is about to read them, engine/
// boot.asm:271-276) and steps the emulator by address rather than by frame count. No existing test
// (test/unit/testplay.test.js, test/unit/battletest.test.js) drives it into a streamed project at
// all. This test does, and checks every effect the finding named: spawn, event, screen_fresh,
// origin and strip cancellation.
// ==========================================================================
test('▶Test (testplay.js) reaches a streamed destination through the real applyStartOverride handshake', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({ gameType: 'action' });
  const streamedMap = project.maps.find((m) => m.streamed === true);
  const TARGET_SCREEN = 1; // a different screen than the authored ⚑ Start, still on the streamed map
  const TARGET_X = project.project.startX;
  const TARGET_Y = project.project.startY;
  // Fix round 3, finding 2: one distinct, uniform, nonzero metatile on the target screen (the
  // same "uniform per screen" technique Part D2 above uses), so the content check below has a
  // single independently-known expected tile/palette to compare the real painted nametable
  // against -- not merely "some tiles changed". Id 9 and tiles 40-43 are outside
  // createStreamedProject's own default range (ids 1-3), so this cannot collide with the terrain
  // the landing screen (0) still carries.
  const TARGET_METATILE_ID = 9;
  const TARGET_TILES = [40, 41, 42, 43];
  const TARGET_PALETTE = 2;
  streamedMap.screens[TARGET_SCREEN].metatiles.fill(TARGET_METATILE_ID);
  project.metatiles[TARGET_METATILE_ID] = {
    id: TARGET_METATILE_ID,
    name: 'TestplayTarget',
    tiles: TARGET_TILES,
    palette: TARGET_PALETTE,
    collision: 'open'
  };
  // Fix round 3, finding 2 (second half): the LANDING screen (0, the authored ⚑ Start) gets its
  // own distinct uniform metatile too. sw_render_window's own buffered window covers TWO screens
  // at once (this fixture's own empirical measurement below: the window's own flat origin,
  // delta 0 from win_col/row_screen/local, resolves onto screen 0 -- NOT the target -- since
  // sw_camera_window_recompute deliberately buffers the window up to 8 blocks behind the
  // camera). A mutation that forces redraw_screen_dispatch onto the ordinary (single-screen, no
  // buffering) path was empirically found to bleed the TARGET screen's own tiles into BOTH
  // physical nametable halves (a scratchpad probe against this exact fixture: nt0 correctly all-
  // zero when unmutated, but shows TARGET_TILES too once mutated) -- so checking the target
  // probe alone cannot catch it, but checking the ORIGIN probe against screen 0's OWN distinct
  // content can, and does (verified below).
  const LANDING_METATILE_ID = 8;
  const LANDING_TILES = [20, 21, 22, 23];
  const LANDING_PALETTE = 1;
  streamedMap.screens[0].metatiles.fill(LANDING_METATILE_ID);
  project.metatiles[LANDING_METATILE_ID] = {
    id: LANDING_METATILE_ID,
    name: 'TestplayLanding',
    tiles: LANDING_TILES,
    palette: LANDING_PALETTE,
    collision: 'open'
  };
  project.sprites.actors.push({ name: 'Marker', behavior: 'npc', hp: 1, damage: 0 });
  const markerActorId = project.sprites.actors.length - 1;
  streamedMap.screens[TARGET_SCREEN].entities = [
    {
      actorId: markerActorId,
      x: TARGET_X,
      y: TARGET_Y,
      props: {
        trigger: 'enter',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 2, value: 1 }] }] }
      }
    }
  ];

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworldlifecycle-testplay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const ram = parseEquates(fs.readFileSync(path.join(dir, 'build/constants.asm'), 'utf8'));
  const symbols = parseSymbolFile(fs.readFileSync(built.symbolPath, 'utf8'));

  const emulator = new Emulator({ onFrame: () => {} });
  emulator.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
  // Fix round 4, item 1: watch the whole cold-boot-through-override-through-settle span. Emulator's
  // own stepInstruction calls nes.cpu.emulate() directly (renderer/emulator/runcontrol.js), so
  // wrapping nes.cpu.emulate here observes it exactly as it does for a raw NES instance -- this is
  // independent of (and does not interact with) Emulator's own separate PC-intercept/breakpoint table.
  const guard = watchPositionJumpGuard(emulator.nes, fs.readFileSync(built.symbolPath, 'utf8'));

  // Precondition, captured at the cold-boot landing (screen 0) applyStartOverride's own first
  // internal step stops at -- calling runToAddress again from there is a no-op (testplay.test.js's
  // own established idiom), so this only observes state the override is about to act on. Needed as
  // an independent BEFORE for the origin check below: a sabotage that leaves the window/camera
  // simply un-recomputed on the override's own landing would otherwise read as internally
  // self-consistent (both window and camera frozen together) and pass a containment check alone.
  assert.ok(emulator.runToAddress(symbols[MAIN_LOOP]), 'the ROM did not reach its main loop');
  const colBlockBefore = emulator.peek(ram.win_col_screen) * 16 + emulator.peek(ram.win_col_local);
  const rowBlockBefore = emulator.peek(ram.win_row_screen) * 15 + emulator.peek(ram.win_row_local);

  // Fix round 3, finding 2: capture the real painted nametable/attribute content at the actual
  // first display-enable the override's own redraw produces -- the same forced-blank
  // disable-then-enable $2001 pair Part D2 above hooks, installed here (immediately before the
  // only redraw this test drives) so there is no earlier disable/enable pair to mistake it for.
  let sawDisable = false;
  let enableSnapshot = null;
  const origWrite = emulator.nes.mmap.write.bind(emulator.nes.mmap);
  emulator.nes.mmap.write = (address, value) => {
    if (address === 0x2001) {
      if (!sawDisable && (value & 0x18) === 0) sawDisable = true;
      else if (sawDisable && !enableSnapshot && (value & 0x18) !== 0) {
        enableSnapshot = { nt: emulator.nes.ppu.nameTable.map((t) => ({ tile: t.tile.slice(), attrib: t.attrib.slice() })) };
      }
    }
    return origWrite(address, value);
  };
  applyStartOverride(emulator, { screen: TARGET_SCREEN, x: TARGET_X, y: TARGET_Y }, { ram, symbols });
  emulator.nes.mmap.write = origWrite;
  assert.ok(enableSnapshot, 'the override\'s own redraw never reached a real display-enable within its own runToAddress budget');

  // Arrival itself: applyStartOverride's own oracle already asserts flat_screen/player_x/
  // player_y/warp_ready internally and throws if any fails, so reaching here already proves it --
  // re-asserted explicitly for a self-contained failure message.
  assert.equal(emulator.peek(ram.flat_screen), TARGET_SCREEN, 'the override must land on the streamed target screen');
  assert.equal(emulator.peek(ram.map_is_streamed), 1, 'the target screen must actually be inside the streamed map');

  // Spawn: the destination's own marker, respawned by the redraw take_door performs.
  assert.equal(emulator.peek(ram.ent_active), 1, "spawn: the destination marker's own ent_active slot must be set right after the override returns");

  // screen_fresh: set synchronously by the same redraw, before applyStartOverride even returns.
  assert.equal(emulator.peek(ram.screen_fresh), 1, 'screen_fresh: must be set on arrival, exactly as a boot or an authored door landing sets it');

  // Strip cancellation: a fresh landing must never leave a strip mid-flight.
  assert.equal(emulator.peek(ram.st_active), 0, 'strip cancellation: no column/row strip may be left in flight after the override lands');

  // Origin: the tracking window must have actually been recomputed for the target screen, not
  // left stale from wherever runToAddress's own tick of the world at the authored start moved it
  // -- same containment oracle as Part E's own position-jump-guard tests (visible range must sit
  // inside the resynced window block).
  const camPx = (emulator.peek(ram.sw_cam_origin_x_lo) | (emulator.peek(ram.sw_cam_origin_x_hi) << 8));
  const camPy = (emulator.peek(ram.sw_cam_origin_y_lo) | (emulator.peek(ram.sw_cam_origin_y_hi) << 8));
  const visLoX = Math.floor(camPx / 16), visHiX = Math.floor((camPx + 255) / 16);
  const visLoY = Math.floor(camPy / 16), visHiY = Math.floor((camPy + 239) / 16);
  const colBlock = emulator.peek(ram.win_col_screen) * 16 + emulator.peek(ram.win_col_local);
  const rowBlock = emulator.peek(ram.win_row_screen) * 15 + emulator.peek(ram.win_row_local);
  assert.ok(visLoX >= colBlock && visHiX <= colBlock + 31, 'origin: the visible X range must sit inside the window the override actually installed for the target screen');
  assert.ok(visLoY >= rowBlock && visHiY <= rowBlock + 29, 'origin: the visible Y range must sit inside the window the override actually installed for the target screen');
  // The containment check alone is vacuous against a sabotage that leaves the window/camera
  // simply un-recomputed for the target (both stay frozen at screen 0's own boot-landing origin,
  // which is still self-consistent): also require the block to have actually moved from what it
  // was before the override, since TARGET_SCREEN is a different screen-grid column.
  assert.ok(
    colBlock !== colBlockBefore || rowBlock !== rowBlockBefore,
    'origin: the window must actually be recomputed for the target screen, not left at the boot landing\'s own stale origin'
  );

  const colScreenAfterContent = emulator.peek(ram.win_col_screen);
  const colLocalAfterContent = emulator.peek(ram.win_col_local);
  const rowScreenAfterContent = emulator.peek(ram.win_row_screen);
  const rowLocalAfterContent = emulator.peek(ram.win_row_local);

  // Content: fix round 3, finding 2 -- the destination's actual painted nametable/attribute
  // content at the real first display-enable, against the independent oracle authored above
  // (TARGET_TILES/TARGET_PALETTE), not merely the window/camera bookkeeping just checked. The
  // reviewer's disclosed mutant (redraw_screen_dispatch's streamed branch forced onto the
  // ordinary redraw path, engine/screens.asm) never touches map_is_streamed, flat_screen,
  // ent_active, screen_fresh, st_active or the origin math above -- every one of those still
  // passes -- but it paints the ordinary map's ROM content instead of the streamed target
  // screen's, which only this check can catch.
  //
  // The window's own flat ORIGIN (delta 0 from win_col/row_screen/local) is deliberately NOT used
  // as the probe position: sw_camera_window_recompute buffers the window up to 8 blocks (X) / 7
  // blocks (Y) BEHIND the camera's own viewport (test/unit/streamworldmove.test.js's own
  // assertVisibleContent documents this exact property), so at TARGET_SCREEN's own landing the
  // origin block can still legitimately belong to the PREVIOUS screen -- confirmed empirically
  // (a scratchpad probe against this exact fixture found delta 0 resolves to screen 0, the
  // landing, not TARGET_SCREEN). The probe below instead uses the CAMERA's own published origin
  // (camPx/camPy, already read above), the same delta assertVisibleContent's own colDeltaStart/
  // rowDeltaStart use, and then independently verifies (via colAtOffset) that this delta actually
  // resolves onto TARGET_SCREEN before trusting it -- so a wrong probe position fails loudly
  // instead of silently checking the wrong screen.
  //
  // wbaseAxis/colAtOffset/physicalFromDelta: ported from test/unit/streamworldmove.test.js's own
  // independently-derived oracle (sw_render_window's wbase_col/row and sw_col_at_offset/
  // sw_row_at_offset, engine/streamworld.asm), not imported -- this file's own "read the file it
  // is checking proves nothing" discipline.
  function wbaseAxis(screen, local, screenSize) {
    return (screen & 1) * screenSize + local;
  }
  function colAtOffset(delta, winColScreen, winColLocal) {
    const t = delta + winColLocal;
    return { screen: winColScreen + (t >> 4), local: t & 15 };
  }
  const windowFlatX = colScreenAfterContent * 16 + colLocalAfterContent;
  const windowFlatY = rowScreenAfterContent * 15 + rowLocalAfterContent;
  const colDelta = Math.floor(camPx / 16) - windowFlatX;
  const rowDelta = Math.floor(camPy / 16) - windowFlatY;
  const probe = colAtOffset(colDelta, colScreenAfterContent, colLocalAfterContent);
  assert.equal(probe.screen, TARGET_SCREEN, 'content check precondition: the camera-derived probe position must itself resolve onto the target screen');
  const wbaseCol = wbaseAxis(colScreenAfterContent, colLocalAfterContent, 16);
  const wbaseRow = wbaseAxis(rowScreenAfterContent, rowLocalAfterContent, 15);
  const physCol = (((wbaseCol + colDelta) % 32) + 32) % 32;
  const physRow = (((wbaseRow + rowDelta) % 30) + 30) % 30;
  const contentNt = (physCol >= 16 ? 1 : 0) | (physRow >= 15 ? 2 : 0);
  const bc = physCol % 16, br = physRow % 15;
  const ntable = enableSnapshot.nt[contentNt];
  const base = 2 * br * 32 + 2 * bc;
  const positions = [base, base + 1, base + 32, base + 33];
  const corners = ['tl', 'tr', 'bl', 'br'];
  for (let k = 0; k < 4; k++) {
    assert.equal(ntable.tile[positions[k]], TARGET_TILES[k], `window origin block (nt ${contentNt}, ${bc},${br}) ${corners[k]} tile id at the real first display-enable`);
    assert.equal(ntable.attrib[positions[k]], TARGET_PALETTE * 4, `window origin block (nt ${contentNt}, ${bc},${br}) ${corners[k]} attribute/palette at the real first display-enable`);
  }

  // Second content probe, at the window's own flat ORIGIN (delta 0) -- the buffered-but-not-
  // currently-visible neighbour screen (0, the landing) the comment above documents. A mutation
  // that forces redraw_screen_dispatch onto the single-screen ordinary path (engine/screens.asm)
  // was empirically found to leave the TARGET screen's own tiles bleeding into THIS position too
  // (verified below), even though the camera-facing probe above still happens to read correctly
  // either way -- this second, independently-authored screen is what actually discriminates it.
  const originPhysCol = wbaseCol, originPhysRow = wbaseRow; // colDelta = rowDelta = 0
  const originAt = colAtOffset(0, colScreenAfterContent, colLocalAfterContent);
  assert.notEqual(originAt.screen, TARGET_SCREEN, 'content check precondition: the window origin probe must land on a DIFFERENT screen than the target, or it cannot discriminate a single-screen-only redraw');
  const originNt = (originPhysCol >= 16 ? 1 : 0) | (originPhysRow >= 15 ? 2 : 0);
  const originBc = originPhysCol % 16, originBr = originPhysRow % 15;
  const originTable = enableSnapshot.nt[originNt];
  const originBase = 2 * originBr * 32 + 2 * originBc;
  const originPositions = [originBase, originBase + 1, originBase + 32, originBase + 33];
  for (let k = 0; k < 4; k++) {
    assert.equal(originTable.tile[originPositions[k]], LANDING_TILES[k], `window origin block (nt ${originNt}, ${originBc},${originBr}) ${corners[k]} tile id must still be the LANDING screen's own content, not the target's`);
    assert.equal(originTable.attrib[originPositions[k]], LANDING_PALETTE * 4, `window origin block (nt ${originNt}, ${originBc},${originBr}) ${corners[k]} attribute/palette must still be the LANDING screen's own`);
  }

  // Event: touch/enter events only arm pending_ent at the redraw instant; main_loop turns that
  // into a real VARIABLES effect a few frames later (same settle-frame pattern as
  // bootAndCaptureFirstEnable above).
  for (let i = 0; i < 20; i++) emulator.runFrame();
  assert.equal(emulator.peek(ram.variables + 2), 1, "event: the destination's own entry event must have run once, shortly after the override landed");
  guard.assertNone('▶Test (testplay.js) into a streamed destination, through settle');
  guard.unwatch();
});

// ==========================================================================
// Part F: docs/design-streamed-worlds.md §8's own transition matrix, one row
// per test this slice already wrote, plus one genuinely NEW check no earlier
// part makes: that "Battle entry"'s own "Camera publication: Frozen" cell
// holds for the WHOLE battle, not merely at the instant of entry. Part A only
// checks strip-cancellation at entry; Part B moves straight from entry into
// battle commands without ever confirming the window/camera stay untouched
// while the fight is still being fought.
//
// Row -> proof, so this table is auditable against the design doc directly:
//   Same-map warp/door   -> pre-existing (streamworldmove.test.js's own
//                           "streamed landing installs the tracking window
//                           directly", cited in this file's own header) for
//                           camera/window/terrain, PLUS Part E2 above for the
//                           fresh-arrival oracles (entry event, entity spawn,
//                           screen_fresh) that test never checked --
//                           Continue/(Test resolve through the identical
//                           warp handshake, take_door, engine/boot.asm)
//   Continue              -> unreachable for any streamed project (D.7,
//                           test/unit/streamworld.test.js) -- this file's
//                           own header documents why
//   (Test                 -> the identical take_door handshake as warp/door
//   Battle entry          -> Part A (strip cancelled before call_battle) +
//                           THIS test (camera/window frozen for the fight's
//                           whole duration, not merely its first frame)
//   Battle return          -> Part B (screen_fresh re-settles, entry event
//                           suppressed, full resync)
//   Game over              -> Part C (map_is_streamed not carried over)
//   Teleport resync (lag guard) -> Part E (fires at lag 6, not 5; snaps to
//                           the target origin; cancels a strip; freezes
//                           movement; contains on the first resumed frame)
// ==========================================================================
test(
  '§8 matrix: "Battle entry" -- the window and camera stay frozen for the whole fight, not merely its first frame',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = createStreamedProject({ gameType: 'rpg', gridW: 5, gridH: 5 });
    project.project.startScreen = 12;
    project.sprites.actors[0] = { name: 'Slime', damage: 1, hp: 1, battle: { acc: 0 } };
    const streamedMap = project.maps.find((m) => m.streamed === true);
    streamedMap.screens[12].entities = [
      { actorId: 0, x: project.project.startX, y: project.project.startY + 32, props: {} }
    ];

    const { nes, mem } = await buildAndBoot(project);

    for (let step = 0; step < 200 && mem[GAME_STATE] === ST_GAMEPLAY; step++) {
      nes.buttonDown(1, DOWN);
      nes.frame();
      nes.buttonUp(1, DOWN);
    }
    for (let i = 0; i < 30 && mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
    assert.equal(mem[GAME_STATE], ST_BATTLE, 'walking into the slime did not start a fight');
    for (let i = 0; i < 5; i++) nes.frame(); // let call_battle's own strip-cancel (Part A) settle

    const frozen = {
      col: mem[WIN_COL_SCREEN] * 16 + mem[WIN_COL_LOCAL],
      row: mem[WIN_ROW_SCREEN] * 15 + mem[WIN_ROW_LOCAL],
      camX: (mem[SW_CAM_ORIGIN_X_HI] << 8) | mem[SW_CAM_ORIGIN_X_LO],
      camY: (mem[SW_CAM_ORIGIN_Y_HI] << 8) | mem[SW_CAM_ORIGIN_Y_LO]
    };
    // No button pressed at all here -- the battle menu just sits waiting, the same
    // shape as an idle player standing at a menu; nothing should perturb the field
    // state that will be resumed when the fight ends.
    for (let i = 0; i < 60 && mem[GAME_STATE] === ST_BATTLE; i++) {
      nes.frame();
      assert.equal(mem[WIN_COL_SCREEN] * 16 + mem[WIN_COL_LOCAL], frozen.col, `window col must stay frozen through battle (frame ${i})`);
      assert.equal(mem[WIN_ROW_SCREEN] * 15 + mem[WIN_ROW_LOCAL], frozen.row, `window row must stay frozen through battle (frame ${i})`);
      assert.equal(((mem[SW_CAM_ORIGIN_X_HI] << 8) | mem[SW_CAM_ORIGIN_X_LO]), frozen.camX, `camera X must stay frozen through battle (frame ${i})`);
      assert.equal(((mem[SW_CAM_ORIGIN_Y_HI] << 8) | mem[SW_CAM_ORIGIN_Y_LO]), frozen.camY, `camera Y must stay frozen through battle (frame ${i})`);
      assert.equal(mem[ST_ACTIVE], 0, `no strip may arm while the field is frozen for battle (frame ${i})`);
    }
    assert.equal(mem[GAME_STATE], ST_BATTLE, 'the battle must still be running at the end of this frozen-field observation window');
  }
);

// ==========================================================================
// Part G: fix round 1, finding 7 -- battle_finish_live's own `pla / pla`
// (engine/battleturn.asm) discards the return address battle_tick's `jsr
// battle_dispatch` left on the stack, which every OTHER bt_phase branch
// consumes normally via its own eventual `rts`. The corrected comments
// (this file's own engine/battleturn.asm:1615-1630, main/build/
// battletables.js:647) explain why this is NOT merely a streamed-screen
// concern: the orphaned address is numerically inside battle_dispatch,
// banked code, and by the time anything could pop it again set_screen_ptr
// has already restored the FIELD bank at $8000 -- on an ORDINARY project
// too, once field and battle code genuinely land in different banks rather
// than sharing one by fixture-placement accident. This project (8x8, RPG,
// explicitly NOT streamed) is that discriminator: large enough that
// field/battle share no bank, modeled directly on the reviewer's own
// review-s6-ordinary-large.test.mjs (handoff-next/), which measured the
// orphaned return address at $821c and a real crash at $8261 with the two
// PLAs removed, on this exact shape.
//
// Stack pointer balance, not merely "did it crash", is the discriminating
// assertion: nes.cpu.REG_SP settles back to the SAME value gameplay held
// before the fight, for each of the three ways a battle can end --
// win (FIGHT kills the monster), flee (RUN succeeds) and loss (a wipe,
// through the SEPARATE player_died path battle_finish_check's own `jmp
// player_died` takes instead of battle_finish_live -- included as a
// regression check on that path's own, already-correct stack discipline,
// not because this fix touches it). Removing the two PLAs must fail the
// win and flee sub-tests (SP left 2 short of the pre-battle baseline) --
// confirmed by sabotage, not merely argued; see the fix-round-1 report's
// own sabotage table.
// ==========================================================================
function buildOrdinaryLarge(monsterBattle, monsterHp) {
  const project = createStreamedProject({ gameType: 'rpg', gridW: 8, gridH: 8 });
  for (const m of project.maps) m.streamed = false;
  project.project.startScreen = 60;
  project.sprites.actors[0] = { name: 'Foe', damage: 1, hp: monsterHp, battle: monsterBattle };
  const map = project.maps[0];
  map.screens[60].entities = [
    { actorId: 0, x: project.project.startX, y: project.project.startY + 32, props: {} }
  ];
  return project;
}

async function buildAndBootOrdinary(project) {
  return buildAndBoot(project, { requireStreamed: false });
}

async function walkIntoContact(nes, mem) {
  for (let step = 0; step < 200 && mem[GAME_STATE] === ST_GAMEPLAY; step++) {
    nes.buttonDown(1, DOWN);
    nes.frame();
    nes.buttonUp(1, DOWN);
  }
  for (let i = 0; i < 30 && mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  assert.equal(mem[GAME_STATE], ST_BATTLE, 'walking into the foe did not start a fight');
}

test(
  'stack pointer balance across a battle WIN, on an ordinary large RPG where field and battle code do not share a bank (fix round 1, finding 7)',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    const project = buildOrdinaryLarge({ acc: 0 }, 1); // cannot hit the party; one physical Attack ends it
    const { nes, mem } = await buildAndBootOrdinary(project);

    const spBefore = nes.cpu.REG_SP;
    await walkIntoContact(nes, mem);
    for (let i = 0; i < 5; i++) nes.frame();

    chooseCommand(nes, BC_FIGHT);
    tap(nes, A_BTN, 20);
    for (let round = 0; round < 80 && mem[GAME_STATE] === ST_BATTLE; round++) tap(nes, A_BTN, 12);
    assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the battle never ended in a win');
    assert.equal(mem[MON_ALIVE], 0, 'precondition: the foe must actually be dead for this to be a WIN');
    for (let i = 0; i < 10; i++) nes.frame(); // settle past battle_end's own redraw

    assert.equal(
      nes.cpu.REG_SP,
      spBefore,
      "the stack pointer must return to the exact pre-battle baseline after a WIN -- battle_finish_live's own pla/pla must have consumed battle_dispatch's orphaned return"
    );
  }
);

test(
  'stack pointer balance across a battle FLEE, on an ordinary large RPG where field and battle code do not share a bank (fix round 1, finding 7)',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    // A WANDERING encounter, not a touched/placed monster: engine/rpg.asm's
    // own touch_encounter clears bt_esc ("an authored monster on the map is
    // a fight you cannot walk away from") while check_encounter's own
    // wandering path sets it ("a wandering monster can be run from") --
    // test/unit/rpg.test.js's own "a fight you were dragged into can be run
    // from; one you walked into cannot" pins exactly this. rate:1 so the
    // very first qualifying step triggers it (enc_step starts at 0, one
    // increment already reaches the threshold).
    const project = createStreamedProject({ gameType: 'rpg', gridW: 8, gridH: 8 });
    for (const m of project.maps) m.streamed = false;
    project.project.startScreen = 60;
    project.sprites.actors[0] = { name: 'Foe', damage: 1, hp: 1, battle: { acc: 0 } };
    project.maps[0].encounters = { rate: 1, actorIds: [0] };
    const { nes, mem } = await buildAndBootOrdinary(project);

    const spBefore = nes.cpu.REG_SP;
    // test/unit/rpg.test.js's own walkIntoEncounter shape: back-and-forth
    // movement (a wandering roll needs an actual completed step, not merely
    // a button held) until ST_BATTLE.
    for (let step = 0; step < 900 && mem[GAME_STATE] !== ST_BATTLE; step++) {
      const button = step % 60 < 30 ? RIGHT : LEFT;
      nes.buttonDown(1, button);
      nes.frame();
      nes.buttonUp(1, button);
    }
    for (let i = 0; i < 12; i++) nes.frame();
    assert.equal(mem[GAME_STATE], ST_BATTLE, 'walking never rolled the wandering encounter');
    for (let i = 0; i < 5; i++) nes.frame();

    // RUN is a roll -- retry until it actually succeeds, the same technique
    // test/unit/rpg.test.js's own "can be run from" test uses.
    let escaped = false;
    for (let attempt = 0; attempt < 30 && !escaped; attempt++) {
      if (mem[GAME_STATE] !== ST_BATTLE) break;
      if (mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
      else if (mem[BT_PHASE] === BP_DONE) tap(nes, A_BTN, 10);
      for (let i = 0; i < 90; i++) nes.frame();
      escaped = mem[GAME_STATE] === ST_GAMEPLAY;
    }
    assert.ok(escaped, 'thirty attempts to run all failed, which is not a roll');
    assert.equal(mem[MON_ALIVE], 1, 'precondition: fleeing must not have killed the foe, or this is not a FLEE');
    for (let i = 0; i < 10; i++) nes.frame();

    assert.equal(
      nes.cpu.REG_SP,
      spBefore,
      "the stack pointer must return to the exact pre-battle baseline after a FLEE -- battle_finish_live's own pla/pla must have consumed battle_dispatch's orphaned return"
    );
  }
);

test(
  'stack pointer balance across a battle LOSS (party wipe, the separate player_died path), on an ordinary large RPG where field and battle code do not share a bank (fix round 1, finding 7)',
  { skip: !hasNesasm && 'nesasm not found on PATH' },
  async () => {
    // Overwhelming: test/unit/rpg.test.js's own "a wipe ends the game" recipe.
    const project = buildOrdinaryLarge({ atk: 250, acc: 255, speed: 200, def: 200 }, 200);
    const { nes, mem } = await buildAndBootOrdinary(project);

    const spBefore = nes.cpu.REG_SP;
    await walkIntoContact(nes, mem);
    for (let i = 0; i < 5; i++) nes.frame();

    chooseCommand(nes, BC_FIGHT);
    for (let i = 0; i < 60 && mem[GAME_STATE] === ST_BATTLE; i++) tap(nes, A_BTN, 12);
    assert.equal(mem[PC_HP], 0, 'precondition: the party must actually be wiped for this to be a LOSS');
    assert.equal(mem[GAME_STATE], ST_GAMEOVER, 'a wipe should reach the game-over screen');
    for (let i = 0; i < 10; i++) nes.frame();

    assert.equal(
      nes.cpu.REG_SP,
      spBefore,
      'the stack pointer must return to the exact pre-battle baseline after a LOSS too -- player_died\'s own, separate path (not battle_finish_live/pla-pla) must already balance it on its own'
    );
  }
);
