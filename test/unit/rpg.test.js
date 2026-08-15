// The turn-based battle system, driven through the built RPG sample ROM.
//
// Everything here goes through the banked code region, so every assertion is
// also an assertion that the trampoline in engine/banks.asm is behaving: the
// battle runs in a PRG bank the field's map data normally occupies, and the
// engine has to come back out of it sixty times a second.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createProject } from '../../shared/project.js';
import { checkCapacity } from '../../main/build/generate.js';
import { statAt, xpCurve } from '../../main/build/battletables.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample-rpg');
const ROM_PATH = path.join(SAMPLE, 'build/game.nes');
const hasRom = fs.existsSync(ROM_PATH);
const needsSample = !hasRom && 'run `npm run sample:rpg && npm run build:sample:rpg` first';

// Engine RAM, from engine/constants.asm.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const GAME_STATE = 0x25;
const INV_COUNT = 0x37;
const BOX_STATE = 0x40;
const BT_PHASE = 0x53;
const BT_SEL = 0x55;
const BT_TARGET = 0x56;
const BT_COUNT = 0x5b;
const GOLD_LO = 0x63;
const PARTY_SIZE = 0x65;
const INV_ITEMS = 0x378;
const SWITCHES = 0x390;
const PC_HP = 0x398;
const PC_HP_MAX = 0x39c;
const PC_MP = 0x3a0;
const PC_LEVEL = 0x3a8;
const PC_XP_LO = 0x3ac;
const PC_IN_PARTY = 0x3b4;
const PC_SPELLS = 0x3b8;
const MON_SLOT_ACTOR = 0x3bc;
const MON_HP = 0x3c0;
const MON_ALIVE = 0x3c8;
const TURN_ORDER = 0x3cc;
const MON_SLOT_MP = 0x3ec;
const PC_STATUS = 0x3f0;
const MON_STATUS = 0x3f4;

const ST_GAMEPLAY = 0;
const ST_GAMEOVER = 4;
const ST_BATTLE = 5;

const BOX_PAGEWAIT = 3;
const BOX_ENDWAIT = 6;

const BP_INTRO = 0;
const BP_MENU = 1;
const BP_TARGET = 2;
const BP_SPELLS = 3;
const BP_ITEMS = 4;
const BP_DONE = 11;

const BC_FIGHT = 0;
const BC_MAGIC = 1;
const BC_ITEM = 2;
const BC_RUN = 3;

const A = 0;
const B = 1;
const UP = 4;
const DOWN = 5;
const LEFT = 6;
const RIGHT = 7;

function boot(romPath = ROM_PATH, frames = 40) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  return nes;
}

const tap = (nes, button, frames = 14) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
};

/** Walk back and forth until the step counter rolls a wandering monster. */
function walkIntoEncounter(nes, budget = 900) {
  for (let step = 0; step < budget; step++) {
    if (nes.cpu.mem[GAME_STATE] === ST_BATTLE) break;
    const button = step % 60 < 30 ? RIGHT : LEFT;
    nes.buttonDown(1, button);
    nes.frame();
    nes.buttonUp(1, button);
  }
  for (let i = 0; i < 12; i++) nes.frame();
  return nes.cpu.mem[GAME_STATE] === ST_BATTLE;
}

/** Move the battle menu highlight to a command and confirm it. */
function chooseCommand(nes, command) {
  for (let i = 0; i < 8 && nes.cpu.mem[BT_SEL] !== command; i++) tap(nes, DOWN, 4);
  assert.equal(nes.cpu.mem[BT_SEL], command, 'the battle menu never reached that command');
  tap(nes, A, 6);
}

/** Press on until the battle ends or the budget runs out. */
function pressThrough(nes, budget = 60) {
  for (let i = 0; i < budget && nes.cpu.mem[GAME_STATE] === ST_BATTLE; i++) tap(nes, A, 12);
  return nes.cpu.mem[GAME_STATE];
}

/**
 * Walk to a spot, X leg first and then Y, so the route is two straight legs the
 * sample map keeps open. Stops early if the world stops being the world — which
 * is exactly what walking into a monster is supposed to do.
 */
function walkTo(nes, targetX, targetY, budget = 600) {
  for (let i = 0; i < budget; i++) {
    if (nes.cpu.mem[GAME_STATE] !== ST_GAMEPLAY) return;
    const dx = targetX - nes.cpu.mem[PLAYER_X];
    const dy = targetY - nes.cpu.mem[PLAYER_Y];
    let button = null;
    if (dx > 1) button = RIGHT;
    else if (dx < -1) button = LEFT;
    else if (dy > 1) button = DOWN;
    else if (dy < -1) button = UP;
    if (button === null) return;
    nes.buttonDown(1, button);
    nes.frame();
    nes.buttonUp(1, button);
  }
}

/** Talk (B), then press through every page until the conversation ends. */
function talkThrough(nes, budget = 30) {
  tap(nes, B);
  for (let press = 0; press < budget; press++) {
    if (nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) return true;
    for (let frame = 0; frame < 600; frame++) {
      const box = nes.cpu.mem[BOX_STATE];
      if (box === BOX_PAGEWAIT || box === BOX_ENDWAIT || nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) break;
      nes.frame();
    }
    if (nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) return true;
    tap(nes, A);
    for (let i = 0; i < 20; i++) nes.frame();
  }
  return nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY;
}

/** Run frames until it is a party member's turn to choose. */
function waitForMenu(nes, budget = 900) {
  for (let i = 0; i < budget && nes.cpu.mem[BT_PHASE] !== BP_MENU; i++) nes.frame();
  assert.equal(nes.cpu.mem[BT_PHASE], BP_MENU, 'the menu never came round');
}

/** A build of the sample with `mutate` applied, in a temp dir the test owns. */
async function buildVariant(t, name, mutate) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `forge-${name}-`));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  mutate(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return built.romPath;
}

// --- the tables -------------------------------------------------------------

test('the level curve is a running total, so a level is never skipped', () => {
  const curve = xpCurve({ xpBase: 8, xpGrow: 4, maxLevel: 5 });
  assert.deepEqual(curve, [8, 20, 36, 56]);
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i] > curve[i - 1]);
});

test('per-level stats are base plus growth, and never overflow a byte', () => {
  assert.equal(statAt(24, 5, 1), 24);
  assert.equal(statAt(24, 5, 4), 39);
  assert.equal(statAt(200, 40, 15), 255, 'a byte is a byte');
});

test('an RPG on a mapper that cannot switch program banks is refused by name', () => {
  const project = createProject('Quest', 'rpg');
  project.cartridge.mapper = 0; // NROM
  const { problems } = checkCapacity(project);
  const refusal = problems.find(
    (problem) => problem.severity === 'error' && /program bank switching/.test(problem.message)
  );
  assert.ok(refusal, `expected a named refusal, got ${JSON.stringify(problems)}`);
});

// --- the battle -------------------------------------------------------------

test('walking far enough starts a battle, and the party is on the screen', {
  skip: needsSample
}, () => {
  const nes = boot();
  assert.equal(nes.cpu.mem[PARTY_SIZE], 1);
  assert.ok(nes.cpu.mem[PC_HP] > 0, 'the party never got its hit points');

  assert.ok(walkIntoEncounter(nes), 'no wandering monster after nine hundred steps');
  assert.equal(nes.cpu.mem[BT_PHASE], BP_MENU, 'the battle should be waiting for a command');
  assert.equal(nes.cpu.mem[BT_COUNT], 1, 'one monster should be in the formation');
  assert.ok(nes.cpu.mem[MON_HP] > 0, 'the monster has no hit points');
  assert.equal(nes.cpu.mem[MON_ALIVE], 1);

  // The world is frozen behind it, which is what ST_BATTLE is for.
  const x = nes.cpu.mem[PLAYER_X];
  nes.buttonDown(1, RIGHT);
  for (let i = 0; i < 30; i++) nes.frame();
  nes.buttonUp(1, RIGHT);
  assert.equal(nes.cpu.mem[PLAYER_X], x, 'the player walked during a battle');
});

test('FIGHT wears the monster down, and winning pays experience and gold', {
  skip: needsSample
}, () => {
  const nes = boot();
  assert.ok(walkIntoEncounter(nes));
  const startHp = nes.cpu.mem[MON_HP];

  chooseCommand(nes, BC_FIGHT);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_TARGET, 'FIGHT should ask who to hit');
  tap(nes, A, 20); // confirm the target and let the exchange play out

  // An attack can miss — accuracy against evasion is a roll — so this waits for
  // one to land rather than assuming the first does.
  for (let round = 0; round < 12 && nes.cpu.mem[MON_HP] === startHp; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_FIGHT);
    tap(nes, A, 20);
  }
  assert.ok(nes.cpu.mem[MON_HP] < startHp, 'twelve attacks all missed, which is not a roll');

  const state = pressThrough(nes);
  assert.equal(state, ST_GAMEPLAY, 'the battle never ended');
  assert.equal(nes.cpu.mem[MON_ALIVE], 0, 'the monster survived');
  assert.ok(nes.cpu.mem[PC_XP_LO] > 0, 'no experience was awarded');
  assert.ok(nes.cpu.mem[GOLD_LO] > 0, 'no gold was awarded');
});

test('MAGIC spends MP and does more to something the spell is strong against', {
  skip: needsSample
}, () => {
  const nes = boot();
  assert.ok(walkIntoEncounter(nes));
  const startMp = nes.cpu.mem[PC_MP];
  const startHp = nes.cpu.mem[MON_HP];
  assert.ok(startMp > 0, 'the party member has no magic points');

  chooseCommand(nes, BC_MAGIC);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_SPELLS, 'MAGIC should open the spell list');
  tap(nes, A, 6); // the first spell it knows
  assert.ok(nes.cpu.mem[PC_MP] < startMp, 'casting cost nothing');
  tap(nes, A, 20); // confirm the target

  // Ember is a fire spell and the slime is weak to fire, so the ten it does
  // should land as fifteen — comfortably more than a plain attack.
  const dealt = startHp - nes.cpu.mem[MON_HP];
  assert.ok(dealt >= 12, `a spell against a weakness only did ${dealt}`);
});

test('a spell nobody can pay for is refused rather than cast', {
  skip: needsSample
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-nomp-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.party[0].baseMp = 0;
  project.party[0].mpPerLevel = 0;
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = boot(built.romPath);
  assert.equal(nes.cpu.mem[PC_MP], 0);
  assert.ok(walkIntoEncounter(nes));
  const startHp = nes.cpu.mem[MON_HP];

  chooseCommand(nes, BC_MAGIC);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_SPELLS, 'the list should still open — the spell is known');
  tap(nes, A, 20);
  assert.equal(nes.cpu.mem[MON_HP], startHp, 'an unaffordable spell went off anyway');
});

test('a fight you were dragged into can be run from; one you walked into cannot', {
  skip: needsSample
}, () => {
  // Walking into a monster somebody placed is a fight the author meant to
  // happen, so RUN says so rather than rolling for it.
  const touched = boot();
  for (let step = 0; step < 200 && touched.cpu.mem[GAME_STATE] === ST_GAMEPLAY; step++) {
    const buttons = [];
    if (touched.cpu.mem[PLAYER_X] < 168) buttons.push(RIGHT);
    if (touched.cpu.mem[PLAYER_Y] < 168) buttons.push(DOWN);
    if (!buttons.length) break;
    for (const button of buttons) touched.buttonDown(1, button);
    touched.frame();
    for (const button of buttons) touched.buttonUp(1, button);
  }
  for (let i = 0; i < 30 && touched.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) touched.frame();
  assert.equal(touched.cpu.mem[GAME_STATE], ST_BATTLE);
  chooseCommand(touched, BC_RUN);
  for (let i = 0; i < 200; i++) touched.frame();
  assert.equal(touched.cpu.mem[GAME_STATE], ST_BATTLE, 'a placed monster should not let you leave');
  assert.equal(touched.cpu.mem[MON_ALIVE], 1);

  const nes = boot();
  assert.ok(walkIntoEncounter(nes));

  // Running is a roll, so this keeps choosing it until it works — and never
  // presses A outside the menu, because a stray press would confirm FIGHT and
  // the test would end up proving something else entirely.
  let escaped = false;
  for (let attempt = 0; attempt < 30 && !escaped; attempt++) {
    if (nes.cpu.mem[GAME_STATE] !== ST_BATTLE) break;
    // BP_MENU is a choice; BP_DONE is the line saying how it ended, which waits
    // for a press like every other outcome does.
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
    else if (nes.cpu.mem[BT_PHASE] === BP_DONE) tap(nes, A, 10);
    for (let i = 0; i < 90; i++) nes.frame(); // messages time themselves out
    escaped = nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY;
  }
  assert.ok(escaped, 'twenty attempts to run all failed, which is not a roll');
  assert.equal(nes.cpu.mem[MON_ALIVE], 1, 'running away should not beat anything');
  assert.equal(nes.cpu.mem[PC_XP_LO], 0, 'running away should pay nothing');
});

test('a wipe ends the game the same way running out of hearts does', {
  skip: needsSample
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-wipe-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  // A monster that cannot miss and hits harder than the party can survive.
  project.sprites.actors[0].battle = {
    ...project.sprites.actors[0].battle,
    atk: 250,
    acc: 255,
    speed: 200,
    def: 200
  };
  project.sprites.actors[0].hp = 200;
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = boot(built.romPath);
  assert.ok(walkIntoEncounter(nes));
  chooseCommand(nes, BC_FIGHT);
  for (let i = 0; i < 60 && nes.cpu.mem[GAME_STATE] === ST_BATTLE; i++) tap(nes, A, 12);
  assert.equal(nes.cpu.mem[PC_HP], 0, 'the party should have been wiped out');
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEOVER, 'a wipe should reach the game-over screen');
});

test('enough experience raises a level, and a level restores you', {
  skip: needsSample
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-level-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  // One easy monster worth more than a level's worth of experience.
  project.sprites.actors[0].hp = 1;
  project.sprites.actors[0].battle = {
    ...project.sprites.actors[0].battle,
    xp: 60,
    def: 0,
    eva: 0,
    acc: 0, // and it can never land a hit, so the level-up is the only change
    speed: 1
  };
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = boot(built.romPath);
  const hpAtOne = nes.cpu.mem[PC_HP_MAX];
  assert.equal(nes.cpu.mem[PC_LEVEL], 1);

  assert.ok(walkIntoEncounter(nes));
  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  pressThrough(nes);

  assert.ok(nes.cpu.mem[PC_LEVEL] > 1, 'sixty experience should have been worth a level');
  assert.ok(nes.cpu.mem[PC_HP_MAX] > hpAtOne, 'a level should raise the maximum');
  assert.equal(nes.cpu.mem[PC_HP], nes.cpu.mem[PC_HP_MAX], 'a level should heal you to the new maximum');
});

test('walking into a placed monster is a fight, and beating it removes it', {
  skip: needsSample
}, async (t) => {
  // Wandering monsters turned off, so the only fight that can start is the one
  // this test is about — otherwise a random encounter on the way to the corner
  // would be indistinguishable from the answer.
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-touch-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.maps[0].encounters = { rate: 0, actorIds: [] };
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = boot(built.romPath);
  // The sample places a slime in the bottom-right corner.
  for (let step = 0; step < 400 && nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY; step++) {
    const buttons = [];
    if (nes.cpu.mem[PLAYER_X] < 168) buttons.push(RIGHT);
    if (nes.cpu.mem[PLAYER_Y] < 168) buttons.push(DOWN);
    if (!buttons.length) break;
    for (const button of buttons) nes.buttonDown(1, button);
    nes.frame();
    for (const button of buttons) nes.buttonUp(1, button);
  }
  for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'walking into the slime did not start a fight');

  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  for (let i = 0; i < 80 && nes.cpu.mem[GAME_STATE] === ST_BATTLE; i++) tap(nes, A, 12);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY);

  // Back on the field, and the actor that started it is gone rather than
  // standing there ready to start the same fight again.
  const ENT_ACTIVE = 0x300;
  const ENT_ACTOR = 0x308;
  for (let slot = 0; slot < 8; slot++) {
    if (nes.cpu.mem[ENT_ACTIVE + slot] === 1 && nes.cpu.mem[ENT_ACTOR + slot] === 0) {
      assert.fail('the beaten monster is back on the field');
    }
  }
});

test('coming back from a battle is not entering the screen again', {
  skip: needsSample
}, async (t) => {
  // A battle ends by redrawing the field, and a redraw is what arms an entry
  // event — so without a word from battle_end, every fight replays whatever the
  // screen says when the player walks in. On a screen with wandering monsters
  // that is every few steps.
  const VARIABLES = 0x500; // from engine/constants.asm
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-reentry-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.maps[0].encounters = { rate: 0, actorIds: [] };
  project.maps[0].screens[0].entities.push({
    actorId: 2, // Iris, who has nothing to do with the fight
    x: 96,
    y: 32,
    props: {
      trigger: 'enter',
      event: {
        pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 0, value: 1 }] }]
      }
    }
  });
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = boot(built.romPath);
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the entry event did not run when the game started');

  // Into the slime in the bottom-right corner, exactly as the touch-encounter
  // test does it.
  for (let step = 0; step < 400 && nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY; step++) {
    const buttons = [];
    if (nes.cpu.mem[PLAYER_X] < 168) buttons.push(RIGHT);
    if (nes.cpu.mem[PLAYER_Y] < 168) buttons.push(DOWN);
    if (!buttons.length) break;
    for (const button of buttons) nes.buttonDown(1, button);
    nes.frame();
    for (const button of buttons) nes.buttonUp(1, button);
  }
  for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'walking into the slime did not start a fight');
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the entry event ran again on the way to the fight');

  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  for (let i = 0; i < 80 && nes.cpu.mem[GAME_STATE] === ST_BATTLE; i++) tap(nes, A, 12);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'the battle never ended');

  for (let i = 0; i < 60; i++) nes.frame();
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the screen ran its entry event again when the battle ended');
});

// --- joining, and fighting as more than one ---------------------------------

test('a Join event recruits a member mid-script, and they fight from then on', {
  skip: needsSample
}, async (t) => {
  // Wandering monsters off, so the walk to Iris cannot be interrupted.
  const rom = await buildVariant(t, 'join', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
  });
  const nes = boot(rom);
  assert.equal(nes.cpu.mem[PARTY_SIZE], 1);
  assert.equal(nes.cpu.mem[PC_IN_PARTY + 1], 0, 'Iris should not start in the party');

  // Iris stands at (208,32); talking to her says a line, joins her, and sets
  // switch 0 — which is also the switch that hides her from then on.
  walkTo(nes, 208, 48);
  assert.ok(talkThrough(nes), 'the conversation never ended');

  assert.equal(nes.cpu.mem[PARTY_SIZE], 2, 'Join never ran');
  assert.equal(nes.cpu.mem[PC_IN_PARTY + 1], 1);
  assert.ok(nes.cpu.mem[PC_HP + 1] > 0, 'the recruit arrived with no hit points');
  assert.ok(nes.cpu.mem[SWITCHES] & 1, 'the event should have set switch 0');

  // The field survived the cross-bank call: the player can still walk, which
  // means mtptr is still pointing at the map and not at the battle system.
  const before = nes.cpu.mem[PLAYER_X];
  walkTo(nes, before - 16, 48, 30);
  assert.ok(nes.cpu.mem[PLAYER_X] < before, 'the player cannot move after the Join');

  // And the next battle seats both members: the turn order holds member 0,
  // member 1 and the monster, fastest first, with the rest empty.
  walkTo(nes, 112, 112);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'walking into the slime did not start a fight');
  waitForMenu(nes);
  const order = Array.from({ length: 8 }, (_, i) => nes.cpu.mem[TURN_ORDER + i]);
  // Members are speed 4 and the slime speed 3, so the party leads the round.
  assert.deepEqual(order.slice(0, 3), [0, 1, 4], `turn order was ${order.join(',')}`);
  assert.equal(order[3], 0xff, 'a fourth combatant appeared from nowhere');

  const state = pressThrough(nes, 90);
  assert.equal(state, ST_GAMEPLAY, 'two attackers could not finish one slime');
  assert.equal(nes.cpu.mem[MON_ALIVE], 0);
  assert.ok(nes.cpu.mem[PC_XP_LO + 1] > 0, 'the recruit fought and earned nothing');
});

test('a two-monster formation is targeted one at a time, and the cursor wraps', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'twomon', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
  });
  const nes = boot(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);

  // battle_begin runs mid-frame and the intro tick runs on the next one, so
  // there is exactly one frame in which the formation can still be edited —
  // which is what lets this test stage a second slime.
  assert.equal(nes.cpu.mem[BT_PHASE], BP_INTRO, 'the intro already ran');
  nes.cpu.mem[MON_SLOT_ACTOR + 1] = 0;
  for (let i = 0; i < 12; i++) nes.frame();
  assert.equal(nes.cpu.mem[BT_COUNT], 2, 'the second monster was not seated');
  assert.equal(nes.cpu.mem[MON_ALIVE + 1], 1);

  waitForMenu(nes);
  chooseCommand(nes, BC_FIGHT);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_TARGET);
  assert.equal(nes.cpu.mem[BT_TARGET], 4, 'targeting should start on the first monster');
  tap(nes, DOWN, 4);
  assert.equal(nes.cpu.mem[BT_TARGET], 5, 'the cursor never moved to the second monster');
  tap(nes, DOWN, 4);
  assert.equal(nes.cpu.mem[BT_TARGET], 4, 'the cursor should wrap over the two empty slots');

  tap(nes, A, 20);
  const state = pressThrough(nes, 120);
  assert.equal(state, ST_GAMEPLAY, 'the two-slime fight never ended');
  assert.equal(nes.cpu.mem[MON_ALIVE], 0);
  assert.equal(nes.cpu.mem[MON_ALIVE + 1], 0, 'the second monster survived being beaten');
  assert.ok(nes.cpu.mem[PC_XP_LO] >= 12, 'two slimes should pay both their experience');
});

// --- magic, items and drops -------------------------------------------------

test('a heal spell restores HP, cures poison, and costs its MP', {
  skip: needsSample
}, () => {
  const nes = boot();
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);

  // Mend is authored at level 3, so it is granted here the way a level would
  // grant it: pc_spells is the RAM the engine actually consults.
  nes.cpu.mem[PC_SPELLS] |= 2;
  nes.cpu.mem[PC_HP] = 5;
  nes.cpu.mem[PC_MP] = 20;
  nes.cpu.mem[PC_STATUS] = 1; // poisoned, so the cure is observable

  chooseCommand(nes, BC_MAGIC);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_SPELLS);
  tap(nes, DOWN, 4); // Ember is first; Mend is the second row
  tap(nes, A, 6);    // choose it
  tap(nes, A, 10);   // and confirm the target

  const expected = Math.min(5 + 18, nes.cpu.mem[PC_HP_MAX]);
  assert.equal(nes.cpu.mem[PC_HP], expected, 'Mend should heal eighteen, capped at the maximum');
  assert.equal(nes.cpu.mem[PC_MP], 16, 'Mend costs four');
  assert.equal(nes.cpu.mem[PC_STATUS], 0, 'a heal should cure poison');
});

test('ITEM heals from the bag, spends the potion, and cures poison', {
  skip: needsSample
}, () => {
  const nes = boot();
  // A potion in the bag, as if it had been picked up on the field.
  nes.cpu.mem[INV_ITEMS] = 1;
  nes.cpu.mem[INV_COUNT] = 1;
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  nes.cpu.mem[PC_HP] = 5;
  nes.cpu.mem[PC_STATUS] = 1;

  chooseCommand(nes, BC_ITEM);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_ITEMS, 'ITEM should open the bag');
  tap(nes, A, 10);

  const expected = Math.min(5 + 20, nes.cpu.mem[PC_HP_MAX]);
  assert.equal(nes.cpu.mem[PC_HP], expected, 'the potion should heal twenty, capped at the maximum');
  assert.equal(nes.cpu.mem[INV_COUNT], 0, 'the potion should be spent');
  assert.equal(nes.cpu.mem[PC_STATUS], 0, 'a potion should flush the poison out');
});

test('a certain drop lands in the bag on victory', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'drop', (project) => {
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, dropPct: 100 };
  });
  const nes = boot(rom);
  assert.ok(walkIntoEncounter(nes));
  assert.equal(nes.cpu.mem[INV_COUNT], 0);

  waitForMenu(nes);
  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  const state = pressThrough(nes, 120);
  assert.equal(state, ST_GAMEPLAY, 'the fight never ended');
  assert.ok(nes.cpu.mem[INV_COUNT] >= 1, 'a certain drop never dropped');
  assert.equal(nes.cpu.mem[INV_ITEMS], 1, 'the drop should be the potion the slime carries');
});

test('a group spell reaches every monster in the formation at once', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'groupspell', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    project.spells[0].scope = 'all';
    project.sprites.actors[0].hp = 30; // both slimes survive the hit, so it is measurable
  });
  const nes = boot(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_INTRO);
  nes.cpu.mem[MON_SLOT_ACTOR + 1] = 0;
  for (let i = 0; i < 12; i++) nes.frame();
  assert.equal(nes.cpu.mem[BT_COUNT], 2);

  waitForMenu(nes);
  chooseCommand(nes, BC_MAGIC);
  tap(nes, A, 12); // Ember, now scope "all": no target to pick, it just resolves

  // Fire against a fire weakness: ten becomes fifteen, on both of them.
  assert.equal(nes.cpu.mem[MON_HP], 15, 'the first monster took the wrong damage');
  assert.equal(nes.cpu.mem[MON_HP + 1], 15, 'the group spell missed the second monster');
});

// --- poison and the monsters' own magic -------------------------------------

test('a monster with a spell casts it, spending its own MP, and poison ticks', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'monspell', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    // The snake cannot brute-force the fight ending before it ever casts, and
    // the party can sit through sixty rounds of it.
    project.sprites.actors[3].battle = { ...project.sprites.actors[3].battle, atk: 0 };
    project.party[0].baseHp = 200;
  });
  const nes = boot(rom);
  // The snake waits in the bottom-left corner.
  walkTo(nes, 32, 112);
  walkTo(nes, 32, 208, 300);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'walking into the snake did not start a fight');
  for (let i = 0; i < 12; i++) nes.frame();
  // The snake is faster than the member, so it may have acted — and cast —
  // before this first look; seated MP just has to be sane.
  const seatedMp = nes.cpu.mem[MON_SLOT_MP];
  assert.ok(seatedMp > 0 && seatedMp <= 8, `the snake was seated with ${seatedMp} MP`);

  // Stall with RUN (a walked-into fight refuses it) until the snake casts.
  let poisoned = false;
  for (let round = 0; round < 60 && !poisoned; round++) {
    if (nes.cpu.mem[GAME_STATE] !== ST_BATTLE) break;
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
    else tap(nes, A, 12);
    poisoned = nes.cpu.mem[PC_STATUS] !== 0;
  }
  assert.ok(poisoned, 'sixty rounds and the snake never cast Venom');
  assert.ok(nes.cpu.mem[MON_SLOT_MP] < 8, 'casting should have cost the snake MP');

  // Poison bites after the victim's own turns: stall two more rounds and the
  // member is strictly worse off than the snake's zero-attack scratches allow.
  const hpWhenPoisoned = nes.cpu.mem[PC_HP];
  for (let round = 0; round < 6; round++) {
    if (nes.cpu.mem[GAME_STATE] !== ST_BATTLE) break;
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
    else tap(nes, A, 12);
  }
  assert.ok(nes.cpu.mem[PC_HP] < hpWhenPoisoned, 'poison never cost the member anything');
});

test('the party can poison a monster, and the poison alone finishes it', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'poison', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    // Four hit points is two poison ticks, and it can never hit back.
    project.sprites.actors[0].hp = 4;
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, acc: 0 };
  });
  const nes = boot(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  waitForMenu(nes);

  // Venom is authored at level 2; grant it the way the level would.
  nes.cpu.mem[PC_SPELLS] |= 4;
  chooseCommand(nes, BC_MAGIC);
  tap(nes, DOWN, 4); // past Ember to Venom
  tap(nes, A, 6);
  tap(nes, A, 10);   // aim it at the slime
  assert.equal(nes.cpu.mem[MON_STATUS], 1, 'the slime should be poisoned');
  assert.equal(nes.cpu.mem[MON_HP], 4, 'poison should not deal its damage up front');

  // Stall; the slime's misses each end in a poison tick, and two of those are
  // the whole of its four hit points.
  let ended = ST_BATTLE;
  for (let round = 0; round < 30 && ended === ST_BATTLE; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
    else tap(nes, A, 12);
    ended = nes.cpu.mem[GAME_STATE];
  }
  assert.equal(ended, ST_GAMEPLAY, 'the poison never finished the slime');
  assert.equal(nes.cpu.mem[MON_ALIVE], 0);
  assert.ok(nes.cpu.mem[PC_XP_LO] > 0, 'a poison victory should still pay out');
});
