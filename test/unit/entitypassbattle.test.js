// A battle that begins inside the entity pass (engine/entities.asm, update_entities).
//
// update_entities owns X as the entity slot. An RPG's contact is `jmp touch_encounter` ->
// `jmp battle_begin`, which returns into the loop with X = MAX_PARTY (its pc_status clear) or the
// script owner's slot (its `tax`). Before the fix a contact monster in slot 5 re-triggered the
// same encounter for ever (the mainline never reached the battle's next tick: BP_INTRO, CPU X=5),
// slots 0-4 escaped by luck, and a battle from slot 0-3 still rescanned slots 5-7 so a second
// touching monster restarted the fight.
//
// The contract these tests pin (docs/reference-engine.md, "The entity pass and a battle"): the
// first fight wins. A frame that already holds ST_BATTLE when update_entities is entered, or in
// which entity_contact starts one, runs no further slot -- no second encounter, no touch trigger.
//
// Every ROM is built from a mkdtemp project (test/lib/streamedproject.js); none of the six
// checked-in fixtures is touched. Three shapes, because the three place the entity array and the
// kernel differently: a pure ordinary RPG (STREAMING_ENABLED = 0), the ordinary map of a mixed
// project, and a U512 four-screen streamed map.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import NES from '../../renderer/emulator/core/nes.js';
import { callRoutine } from '../lib/callroutine.js';
import { symbolAddr } from '../lib/streamedpinching.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';
const skip = !hasNesasm && 'nesasm not found on PATH';

// Engine RAM, from engine/constants.asm.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const FRAME_CNT = 0x1b;
const GAME_STATE = 0x25;
const BT_PHASE = 0x53;
const BT_SEL = 0x55;
const BT_FLEE = 0x60;
const ENC_STEP = 0x61;
const BT_ESC = 0x66;
const BT_FROM_ENT = 0x68;
const ENT_ACTIVE = 0x300;
const ENT_ACTOR = 0x308;
const MON_SLOT_ACTOR = 0x3bc;
const ST_GAMEPLAY = 0; // engine/constants.asm -- the value update_entities' `lda game_state / bne` first-contact-wins test leans on, pinned below
const ST_BATTLE = 5;
const BP_MENU = 1;
const BC_RUN = 3;
const NO_ENTITY = 0xff;
const TOUCH_RANGE = 12;
const MAX_ENTITIES = 8;
const PC_STATUS = 0x3f0; // engine/constants.asm: pc_status, MAX_PARTY bytes
const MAX_PARTY = 4; // engine/constants.asm
const A = 0;
const DOWN = 5;

// Actor ids in every project below.
const SLIME = 0;
const FILLER = 1;
const BAT = 2;

const START_X = 120;
const START_Y = 16;
const MONSTER_X = 120;
const MONSTER_Y = 60;

const SHAPES = ['pure', 'mixed', 'streamed'];

/** One RPG project with a given entity list on the screen the player starts on. */
function rpgProject(shape, entities, { encounters } = {}) {
  const project =
    shape === 'streamed'
      ? createStreamedProject({ gameType: 'rpg', gridW: 5, gridH: 5 })
      : createStreamedProject({ gameType: 'rpg', gridW: 2, gridH: 2, mixed: true });
  if (shape === 'pure') project.maps = [project.maps[0]];
  const map = shape === 'streamed' ? project.maps.find((m) => m.streamed === true) : project.maps[0];
  const screen = shape === 'streamed' ? 12 : 0;
  project.project.startScreen = screen;
  project.project.startX = START_X;
  project.project.startY = START_Y;
  // acc 0: the monsters never hit, so a win is the only way a fight can end.
  project.sprites.actors[SLIME] = { name: 'Slime', damage: 1, hp: 1, battle: { acc: 0 } };
  project.sprites.actors[FILLER] = { name: 'Filler', behavior: 'npc', hp: 1, damage: 0 };
  project.sprites.actors[BAT] = { name: 'Bat', damage: 1, hp: 1, battle: { acc: 0 } };
  map.screens[screen].entities = entities;
  if (encounters) map.encounters = encounters;
  return project;
}

/** Eight placements, one contact monster `kind` at slot `slot`, the rest inert fillers far off the
 *  player's path (x = 200) so only the monster is ever touched. */
function monsterAt(slot, kind = SLIME) {
  return Array.from({ length: MAX_ENTITIES }, (_, i) =>
    i === slot
      ? { actorId: kind, x: MONSTER_X, y: MONSTER_Y, props: {} }
      : { actorId: FILLER, x: 200, y: 24 + 24 * i, props: {} }
  );
}

/** Build `project` in a directory the test owns and boot it to the first gameplay frames. */
async function bootProject(t, project) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-entpass-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return { ...bootRom(built.romPath), symbols: fs.readFileSync(built.symbolPath, 'utf8') };
}

function bootRom(romPath) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  const mem = nes.cpu.mem;
  for (let i = 0; i < 200 && mem[GAME_STATE] !== ST_GAMEPLAY; i++) nes.frame();
  for (let i = 0; i < 100; i++) nes.frame();
  return { nes, mem, romPath };
}

const frames = (nes, n) => {
  for (let i = 0; i < n; i++) nes.frame();
};

/** Hold DOWN until the world is no longer ST_GAMEPLAY (or the budget runs out). */
function walkDownUntilBattle(nes, mem, budget = 400) {
  nes.buttonDown(1, DOWN);
  for (let i = 0; i < budget && mem[GAME_STATE] === ST_GAMEPLAY; i++) nes.frame();
  nes.buttonUp(1, DOWN);
  return mem[GAME_STATE] === ST_GAMEPLAY ? -1 : mem[GAME_STATE];
}

/** Run until the battle's command menu is up. A hung BP_INTRO never gets there. */
function untilMenu(nes, mem, budget = 300) {
  for (let i = 0; i < budget && !(mem[GAME_STATE] === ST_BATTLE && mem[BT_PHASE] === BP_MENU); i++) nes.frame();
  return mem[GAME_STATE] === ST_BATTLE && mem[BT_PHASE] === BP_MENU;
}

/** Press A on a 13-frame cadence until the battle is over, polling the state after every frame so a
 *  fight that starts again the very next frame (the player is still standing on a monster) is not
 *  stepped over. Returns the frames it took, or -1 if the fight never ended. */
function winFight(nes, mem, budget = 2400) {
  for (let f = 0; f < budget; f++) {
    if (mem[GAME_STATE] !== ST_BATTLE) return f;
    if (f % 13 === 0) nes.buttonDown(1, A);
    nes.frame();
    if (f % 13 === 0) nes.buttonUp(1, A);
  }
  return -1;
}

/** After a fight: run until the field has fully come back (ST_GAMEPLAY *and* bt_from_ent released --
 *  a streamed return clears the slot a few frames after the state flips) or another fight starts.
 *  Returns 'field', 'battle' or 'stuck'. Stops on the first frame it holds, so the caller reads RAM
 *  as of that frame. */
function settle(nes, mem, budget = 600) {
  for (let f = 0; f < budget; f++) {
    if (mem[GAME_STATE] === ST_GAMEPLAY && mem[BT_FROM_ENT] === NO_ENTITY) return 'field';
    if (mem[GAME_STATE] === ST_BATTLE && f > 0) return 'battle';
    nes.frame();
  }
  return 'stuck';
}

/** Make the fight fleeable and run: bt_esc is 0 for a contact fight ("a fight you cannot walk away
 *  from"), so the flee path of battle_end is only reachable by forcing it. Polls every frame. */
function fleeFight(nes, mem, attempts = 40) {
  for (let n = 0; n < attempts; n++) {
    if (!untilMenu(nes, mem)) return mem[GAME_STATE] !== ST_BATTLE;
    mem[BT_ESC] = 1;
    for (let i = 0; i < 8 && mem[BT_SEL] !== BC_RUN; i++) {
      nes.buttonDown(1, DOWN);
      nes.frame();
      nes.buttonUp(1, DOWN);
      frames(nes, 4);
    }
    nes.buttonDown(1, A);
    nes.frame();
    nes.buttonUp(1, A);
    frames(nes, 6);
    // Let the result message play out; a failed roll comes back round to the menu.
    for (let f = 0; f < 600 && mem[GAME_STATE] === ST_BATTLE && mem[BT_PHASE] !== BP_MENU; f++) {
      if (f % 13 === 0) nes.buttonDown(1, A);
      nes.frame();
      if (f % 13 === 0) nes.buttonUp(1, A);
    }
    if (mem[GAME_STATE] !== ST_BATTLE) return true;
  }
  return mem[GAME_STATE] !== ST_BATTLE;
}

const activeSlots = (mem) => Array.from({ length: MAX_ENTITIES }, (_, i) => mem[ENT_ACTIVE + i]);

/** The game keeps running: the frame counter advances and the player can still walk. */
function assertRunning(nes, mem, label) {
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, `${label}: the field is not ST_GAMEPLAY`);
  const f = mem[FRAME_CNT];
  const y = mem[PLAYER_Y];
  nes.buttonDown(1, DOWN);
  frames(nes, 30);
  nes.buttonUp(1, DOWN);
  assert.notEqual(mem[FRAME_CNT], f, `${label}: frame_cnt did not advance`);
  assert.ok(mem[PLAYER_Y] > y, `${label}: the player could not walk (y ${y} -> ${mem[PLAYER_Y]})`);
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, `${label}: a stray fight began`);
}

// --------------------------------------------------------------------------------------------
// A single contact monster in each of slots 0, 4, 5, 7 -- win it, flee it.
//
// Wrong implementations caught:
//  * the X-clobbering loop (the shipped defect): slot 5 never reaches BP_MENU (untilMenu false), and
//    slot 7 likewise -- the `inx` after battle_begin's X = 4 lands on 5, and slots 5-7 rescan;
//  * restoring X only in touch_encounter (battle_begin's `tax` path still broken): the loop rescans
//    correctly here, so THESE tests alone do not see it -- the two-toucher and script tests below do;
//  * clearing ent_active from the wrong slot on a win (battle_end's `ldx <bt_from_ent`): the
//    activeSlots comparison names the one slot that must be 0 and the seven that must be 1;
//  * a flee that clears the slot anyway: the flee test asserts the monster is still standing.

for (const shape of SHAPES) {
  for (const slot of [0, 4, 5, 7]) {
    test(`${shape} RPG: a contact monster in entity slot ${slot} starts a battle that can be won`, { skip }, async (t) => {
      const { nes, mem } = await bootProject(t, rpgProject(shape, monsterAt(slot)));
      assert.equal(mem[ENT_ACTOR + slot], SLIME, 'precondition: the Slime sits in the slot under test');
      assert.deepEqual(activeSlots(mem), [1, 1, 1, 1, 1, 1, 1, 1]);

      assert.equal(walkDownUntilBattle(nes, mem), ST_BATTLE, 'walking into the monster never started a battle');
      assert.equal(mem[BT_FROM_ENT], slot, 'bt_from_ent must name the slot that was touched');
      assert.equal(mem[MON_SLOT_ACTOR], SLIME);
      assert.equal(mem[BT_ESC], 0, 'a contact fight cannot be run from');
      assert.ok(untilMenu(nes, mem), `the battle never reached its menu (phase ${mem[BT_PHASE]}, X ${nes.cpu.REG_X})`);

      assert.ok(winFight(nes, mem) >= 0, 'the fight never ended');
      assert.equal(settle(nes, mem), 'field', 'the field never came back');
      assert.deepEqual(
        activeSlots(mem),
        [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i === slot ? 0 : 1)),
        'a win clears the slot that was touched and no other'
      );
      assert.equal(mem[BT_FROM_ENT], NO_ENTITY);
      assertRunning(nes, mem, 'after the win');
    });

    test(`${shape} RPG: fleeing a contact monster in entity slot ${slot} leaves it standing and the game running`, { skip }, async (t) => {
      const { nes, mem } = await bootProject(t, rpgProject(shape, monsterAt(slot)));
      assert.equal(walkDownUntilBattle(nes, mem), ST_BATTLE);
      assert.equal(mem[BT_FROM_ENT], slot);
      assert.ok(untilMenu(nes, mem), `the battle never reached its menu (phase ${mem[BT_PHASE]})`);

      // The player is still overlapping the monster, so a fight starts again soon after; settle()
      // returns on the first frame the field is whole, before that can happen on an ordinary map.
      assert.ok(fleeFight(nes, mem), 'never got away');
      assert.equal(mem[BT_FLEE], 1);
      assert.equal(settle(nes, mem), 'field', 'the field never came back');
      assert.equal(mem[ENT_ACTIVE + slot], 1, 'running away leaves the monster standing');
      assert.deepEqual(activeSlots(mem), [1, 1, 1, 1, 1, 1, 1, 1]);

      // ...and standing there means it touches again: the next fight must also reach its menu.
      for (let i = 0; i < 90 && mem[GAME_STATE] === ST_GAMEPLAY; i++) nes.frame();
      assert.equal(mem[GAME_STATE], ST_BATTLE, 'the monster the player ran from did not fight again');
      assert.ok(untilMenu(nes, mem), 'the second fight never reached its menu');
      assert.ok(winFight(nes, mem) >= 0);
      assert.equal(settle(nes, mem), 'field');
      assert.equal(mem[ENT_ACTIVE + slot], 0);
      assertRunning(nes, mem, 'after the second fight');
    });
  }
}

// --------------------------------------------------------------------------------------------
// Two monsters touching in the same pass: the first contact wins.
//
// Slime in slot 3, Bat in slot 5, same tile. Wrong implementations caught:
//  * X preserved but no exit (the X-only fix): slot 5 runs after slot 3 and overwrites bt_from_ent
//    with 5 and the formation with the Bat, so the Slime's fight is replaced mid-intro;
//  * the shipped loop: slot 3 jumps X to 4, slot 5 re-triggers for ever and never reaches a menu;
//  * a fix that exits the pass but still lets slot 3's own entity_trigger_touch run (on the
//    clobbered X) is covered by the script test's touch trigger below.

for (const shape of SHAPES) {
  test(`${shape} RPG: two monsters touching in one pass -- the first contact wins and the second fights afterwards`, { skip }, async (t) => {
    const entities = monsterAt(3, SLIME);
    entities[5] = { actorId: BAT, x: MONSTER_X, y: MONSTER_Y, props: {} };
    const { nes, mem } = await bootProject(t, rpgProject(shape, entities));

    assert.equal(walkDownUntilBattle(nes, mem), ST_BATTLE);
    assert.equal(mem[BT_FROM_ENT], 3, 'the lower slot touched first and owns the fight');
    assert.deepEqual([0, 1, 2, 3].map((i) => mem[MON_SLOT_ACTOR + i]), [SLIME, 0xff, 0xff, 0xff], 'the Bat must not have replaced the Slime');
    assert.ok(untilMenu(nes, mem), 'the first fight never reached its menu');
    assert.equal(mem[BT_FROM_ENT], 3, 'still the Slime\'s fight at the menu');
    assert.equal(mem[MON_SLOT_ACTOR], SLIME);

    assert.ok(winFight(nes, mem) >= 0);
    // The Bat is on the player's tile, so it fights once the Slime is gone -- it was not lost. Read
    // the first whole frame of the field: the Slime's slot is gone and the Bat's is untouched.
    if (settle(nes, mem) === 'field') {
      assert.equal(activeSlots(mem)[3], 0);
      assert.equal(activeSlots(mem)[5], 1, 'the Bat was despawned by the Slime\'s fight');
    }
    for (let i = 0; i < 90 && mem[GAME_STATE] === ST_GAMEPLAY; i++) nes.frame();
    assert.equal(mem[GAME_STATE], ST_BATTLE, 'the second toucher never got its own fight');
    assert.equal(mem[BT_FROM_ENT], 5);
    assert.equal(mem[MON_SLOT_ACTOR], BAT);
    assert.ok(untilMenu(nes, mem), 'the Bat\'s fight never reached its menu');
    assert.ok(winFight(nes, mem) >= 0);
    // Only the slot just fought is cleared: the redraw behind each fight puts the Slime back (a
    // defeated monster is not remembered), and it is still on the player's tile -- so it fights
    // again -- the two keep putting each other back, so the chain never ends, but every link must.
    assert.equal(settle(nes, mem), 'field');
    assert.equal(activeSlots(mem)[5], 0, 'the Bat\'s own slot is the one cleared');
    for (let i = 0; i < 90 && mem[GAME_STATE] === ST_GAMEPLAY; i++) nes.frame();
    assert.equal(mem[BT_FROM_ENT], 3, 'the Slime, put back by the redraw, fights again');
    assert.ok(untilMenu(nes, mem), 'the Slime\'s second fight never reached its menu');
  });
}

// --------------------------------------------------------------------------------------------
// A random encounter that starts on the same frame the player walks into a monster.
//
// update_player runs before update_entities and has already set ST_BATTLE, so the pass must be
// skipped at its entry. The monster is in slot 0 because that is the one slot the post-contact
// check cannot save: an earlier active slot's own check would already have ended the pass. Wrong
// implementation caught: a loop that only tests game_state after entity_contact -- slot 0's
// contact then runs touch_encounter over the random fight, setting bt_from_ent to 0, bt_esc to 0
// and the formation to the Slime.

for (const shape of SHAPES) {
  test(`${shape} RPG: a random encounter and a contact in the same frame -- the random fight is not overwritten`, { skip }, async (t) => {
    const rate = 5;
    const { nes, mem } = await bootProject(
      t,
      rpgProject(shape, monsterAt(0, SLIME), { encounters: { rate, actorIds: [BAT] } })
    );
    // One step from the edge of touching: exactly TOUCH_RANGE away is "far", one pixel closer is not.
    mem[PLAYER_X] = MONSTER_X;
    mem[PLAYER_Y] = MONSTER_Y - TOUCH_RANGE;
    mem[ENC_STEP] = rate - 1;
    nes.buttonDown(1, DOWN);
    for (let i = 0; i < 3 && mem[GAME_STATE] === ST_GAMEPLAY; i++) nes.frame();
    nes.buttonUp(1, DOWN);

    assert.equal(mem[GAME_STATE], ST_BATTLE);
    assert.equal(mem[BT_FROM_ENT], NO_ENTITY, 'the random fight has no entity to despawn');
    assert.equal(mem[BT_ESC], 1, 'a wandering monster can be run from');
    assert.equal(mem[MON_SLOT_ACTOR], BAT, 'the formation is the encounter list\'s, not the Slime\'s');
    assert.ok(untilMenu(nes, mem));
    assert.ok(winFight(nes, mem) >= 0);
    // The first whole frame of the field: the Slime was never fought, so it still stands (it fights
    // next, because the player is on it, but that is a separate fight).
    assert.equal(settle(nes, mem), 'field');
    assert.equal(mem[ENT_ACTIVE], 1, 'the Slime was never fought, so it still stands');
  });
}

// --------------------------------------------------------------------------------------------
// The random encounter and the scripted Battle paths still begin and return.
//
// Wrong implementations caught: a fix that moved the register contract into battle_begin and broke
// its other two callers (start_encounter's jmp from check_encounter, script_op_battle's jmp), or one
// that left the entity pass's exit unconditional so a script-owned battle leaves the loop in a state
// the touch trigger that began it never expected.

for (const shape of SHAPES) {
  test(`${shape} RPG: a random encounter begins, is fled, and the field comes back`, { skip }, async (t) => {
    const { nes, mem } = await bootProject(
      t,
      rpgProject(shape, monsterAt(-1), { encounters: { rate: 3, actorIds: [BAT] } })
    );
    nes.buttonDown(1, DOWN);
    for (let i = 0; i < 400 && mem[GAME_STATE] === ST_GAMEPLAY; i++) nes.frame();
    nes.buttonUp(1, DOWN);
    assert.equal(mem[GAME_STATE], ST_BATTLE, 'walking never rolled an encounter');
    assert.equal(mem[BT_FROM_ENT], NO_ENTITY);
    assert.equal(mem[BT_ESC], 1);
    assert.ok(untilMenu(nes, mem));
    assert.ok(fleeFight(nes, mem), 'could not run from a wandering monster');
    assert.equal(settle(nes, mem), 'field');
    assert.deepEqual(activeSlots(mem), [1, 1, 1, 1, 1, 1, 1, 1], 'a random fight despawns nothing');
  });

  test(`${shape} RPG: a scripted Battle from a touch-triggered actor begins and returns, leaving the actor`, { skip }, async (t) => {
    const entities = monsterAt(-1);
    // Slot 6 owns the event; a slot above 4 is the case battle_begin's X clobber used to matter for.
    entities[6] = {
      actorId: FILLER,
      x: MONSTER_X,
      y: MONSTER_Y,
      props: {
        trigger: 'touch',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'battle', monsters: [SLIME] }] }] }
      }
    };
    const { nes, mem } = await bootProject(t, rpgProject(shape, entities));
    assert.equal(walkDownUntilBattle(nes, mem), ST_BATTLE, 'the touch event never started its Battle');
    assert.equal(mem[BT_FROM_ENT], NO_ENTITY, 'a scripted fight has nothing to despawn');
    assert.equal(mem[BT_ESC], 0, 'a scripted fight cannot be run from');
    assert.equal(mem[MON_SLOT_ACTOR], SLIME);
    assert.ok(untilMenu(nes, mem));
    assert.ok(winFight(nes, mem) >= 0);
    assert.equal(settle(nes, mem), 'field');
    frames(nes, 60);
    assert.equal(mem[GAME_STATE], ST_GAMEPLAY);
    assert.equal(mem[ENT_ACTIVE + 6], 1, 'the actor that carried the event survives the fight');
    assertRunning(nes, mem, 'after the scripted fight');
  });
}

// --------------------------------------------------------------------------------------------
// The register contract itself, called in isolation.
//
// The behavioural tests above cannot see X being clobbered once the pass ends right after a fight
// (nothing reads X again), so the contract is pinned where it is made: touch_encounter and
// battle_begin return with X exactly as the entity loop left it, on every slot, including
// battle_begin's script-owner path (talk_ent names a slot, which used to be `tax`ed into X).
// Wrong implementations caught: battle_begin clearing pc_status with X (X comes back 4); its owner
// lookup `tax`ing into X (X comes back as the owner slot); touch_encounter preserving X by a
// compensating `ldx` that reads the wrong byte; battle_begin's status loop (now Y) not clearing every one of
// MAX_PARTY entries -- its dirty statuses are planted before each call, so a status loop that is a no-op (the
// reviewer's `sta pc_status,y` -> three NOPs sabotage), stops short or clears the wrong bytes fails here.

const TALK_ENT = 0x3a; // engine/constants.asm

for (const shape of ['pure', 'streamed']) {
  test(`${shape} RPG: touch_encounter and battle_begin hand back X (the entity loop's slot) on every slot`, { skip }, async (t) => {
    const { nes, mem, symbols } = await bootProject(t, rpgProject(shape, monsterAt(0)));
    const touchEncounter = symbolAddr(symbols, 'touch_encounter');
    const battleBegin = symbolAddr(symbols, 'battle_begin');
    const dirtyStatuses = () => {
      for (let i = 0; i < MAX_PARTY; i++) mem[PC_STATUS + i] = 0xa0 + i;
    };
    const assertStatusesClear = (who) => {
      for (let i = 0; i < MAX_PARTY; i++) assert.equal(mem[PC_STATUS + i], 0, `${who}: pc_status[${i}] was left dirty -- battle_begin clears all ${MAX_PARTY}`);
    };
    for (let slot = 0; slot < MAX_ENTITIES; slot++) {
      mem[GAME_STATE] = ST_GAMEPLAY;
      dirtyStatuses();
      nes.cpu.REG_X = slot;
      callRoutine(nes, touchEncounter);
      assertStatusesClear(`touch_encounter, slot ${slot}`);
      assert.equal(nes.cpu.REG_X, slot, `touch_encounter returned with X = ${nes.cpu.REG_X}, not the slot ${slot} it was called for`);
      assert.equal(mem[GAME_STATE], ST_BATTLE);
      assert.equal(mem[BT_FROM_ENT], slot);

      // battle_begin on its own, with a script owner: talk_ent = another slot.
      const owner = (slot + 3) % MAX_ENTITIES;
      mem[GAME_STATE] = ST_GAMEPLAY;
      mem[TALK_ENT] = owner;
      dirtyStatuses();
      nes.cpu.REG_X = slot;
      callRoutine(nes, battleBegin);
      assertStatusesClear(`battle_begin (owner ${owner}), slot ${slot}`);
      assert.equal(nes.cpu.REG_X, slot, `battle_begin (owner ${owner}) returned with X = ${nes.cpu.REG_X}, not ${slot}`);
      assert.equal(mem[TALK_ENT], NO_ENTITY, 'battle_begin still releases talk_ent');
    }
  });
}

// The contract the entity pass shares with the states: update_entities_loop ends the pass with a bare
// `lda game_state / bne update_entities_done` (engine/entities.asm), "the first contact wins", which is only
// the same thing as "game_state has left ST_GAMEPLAY" while ST_GAMEPLAY is 0. A renumbering of INPUT_STATES
// must stop here rather than as a second encounter starting over the first. The hardcode above is
// cross-checked against the engine's own equate.
// Wrong implementation caught: ST_GAMEPLAY moved off 0 with the entity pass's `bne` test left as it is.
test('ST_GAMEPLAY is 0: the entity pass and the status clear depend on it', () => {
  const constants = fs.readFileSync(new URL('../../engine/constants.asm', import.meta.url), 'utf8');
  const match = constants.match(/^ST_GAMEPLAY\s*=\s*(\d+)/m);
  assert.ok(match, 'engine/constants.asm defines ST_GAMEPLAY');
  assert.equal(Number(match[1]), ST_GAMEPLAY);
  assert.equal(ST_GAMEPLAY, 0);
});
