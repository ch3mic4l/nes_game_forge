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
import { Emulator, BUTTON } from '../../renderer/emulator/runcontrol.js';
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
const FLAT_SCREEN = 0x16;
const GAME_STATE = 0x25;
const INV_COUNT = 0x37;
const INV_SEL = 0x38;
const ITEMS_USED = 0x39;
const BOX_STATE = 0x40;
const BT_PHASE = 0x53;
const BT_SEL = 0x55;
const BT_TARGET = 0x56;
const BT_COUNT = 0x5b;
const GOLD_LO = 0x63;
const PARTY_SIZE = 0x65;
const BT_LEN = 0x6b;
const INV_ITEMS = 0x378;
const BT_LIST = 0x3e4;
const SWITCHES = 0x390;
const PC_HP = 0x398;
const PC_HP_MAX = 0x39c;
const PC_MP = 0x3a0;
const PC_LEVEL = 0x3a8;
const PC_XP_LO = 0x3ac;
const PC_IN_PARTY = 0x3b4;
const PC_SPELLS = 0x3b8;
const ENT_X = 0x310;
const ENT_Y = 0x318;
const ENT_DIR = 0x320;
const MON_SLOT_ACTOR = 0x3bc;
const MON_HP = 0x3c0;
const MON_SLOT_MAX = 0x3c4;
const MON_ALIVE = 0x3c8;
const RNG = 0x62;
const TURN_ORDER = 0x3cc;
const MON_SLOT_MP = 0x3ec;
const PC_STATUS = 0x3f0;
const MON_STATUS = 0x3f4;

const ST_GAMEPLAY = 0;
const ST_MENU = 1;
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
const NUM_COMMANDS = 4;

const A = 0;
const B = 1;
const SELECT = 2;
const START = 3;
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

// engine/constants.asm
const ENT_ACTIVE = 0x300;
const ENT_ACTOR = 0x308;

/** Which entity slot the given actor id currently occupies, or -1. */
function findBossSlot(nes, actorId) {
  for (let slot = 0; slot < 8; slot++) {
    if (nes.cpu.mem[ENT_ACTIVE + slot] === 1 && nes.cpu.mem[ENT_ACTOR + slot] === actorId) return slot;
  }
  return -1;
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

test('a status a lost battle leaves behind does not survive the restart that follows it', {
  skip: needsSample
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-lostbattle-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  // The same guaranteed loss "a wipe ends the game" above sets up.
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
  // Poisoned mid-fight, the same way a monster's own Venom would leave it --
  // battle_finish (engine/battleturn.asm) jumps straight to player_died on
  // defeat, so battle_end never runs and never gets a chance to clear this.
  nes.cpu.mem[PC_STATUS] = 1;
  chooseCommand(nes, BC_FIGHT);
  for (let i = 0; i < 60 && nes.cpu.mem[GAME_STATE] === ST_BATTLE; i++) tap(nes, A, 12);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEOVER, 'the party should have been wiped out');
  assert.equal(
    nes.cpu.mem[PC_STATUS],
    1,
    'a defeat should not clear this on its own -- init_session is what is under test here, on restart'
  );

  for (let i = 0; i < 300 && nes.cpu.mem[BOX_STATE] !== BOX_ENDWAIT; i++) nes.frame();
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_ENDWAIT, 'the game-over message never finished');
  tap(nes, START, 10); // sample-rpg has no title, so this starts a new game directly
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'restarting should have started a new game');
  assert.equal(nes.cpu.mem[PC_STATUS], 0, 'init_session should clear a status a lost battle left behind');
});

// --- scripted heal and damage -----------------------------------------------
//
// engine/rpg.asm's party_heal/party_damage, reached from the field through
// OP_HEAL/OP_DAMAGE -- the RPG side of what combat.asm's gain_hearts/
// lose_hearts already are for an action project. Placed on actor 2 (Iris),
// the sample's own harmless npc -- the same actor id the "coming back from a
// battle" test above places a second time elsewhere on this screen, so a
// second placement carrying its own event is already proven not to collide
// with her own Join event at (208,32).

/** Iris, standing just above the player's own start position. */
function teller(pages, { x = 112, y = 96 } = {}) {
  return { actorId: 2, x, y, props: { event: { pages } } };
}

test('scripted Heal and Damage change every recruited member\'s HP, saturating at the max', {
  skip: needsSample
}, async (t) => {
  const TOUCHED = 20;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-healdamage-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.maps[0].screens[0].entities.push(
    teller([
      {
        cond: { type: 'switchOff', arg: TOUCHED },
        commands: [{ op: 'say', text: 'Ow.' }, { op: 'damage', value: 3 }, { op: 'setSwitch', switch: TOUCHED }]
      },
      { cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'There.' }, { op: 'heal', value: 255 }] }
    ])
  );
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = boot(built.romPath);
  const max = nes.cpu.mem[PC_HP_MAX];
  assert.equal(nes.cpu.mem[PC_HP], max, 'the session should start on full HP');

  assert.ok(talkThrough(nes), 'the first conversation never ended');
  assert.equal(nes.cpu.mem[PC_HP], max - 3, 'Damage 3 should take exactly three HP');

  assert.ok(talkThrough(nes), 'the second conversation never ended');
  assert.equal(nes.cpu.mem[PC_HP], max, 'Heal 255 should be a full heal, saturating at the max');
});

test('Heal revives a party member who has fallen to zero, the same as an inn would', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'revive', (project) => {
    project.maps[0].screens[0].entities.push(
      teller([{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Rest.' }, { op: 'heal', value: 255 }] }])
    );
  });
  const nes = boot(rom);
  const max = nes.cpu.mem[PC_HP_MAX];
  nes.cpu.mem[PC_HP] = 0; // fallen, but still recruited -- pc_in_party is untouched

  assert.ok(talkThrough(nes), 'the conversation never ended');
  assert.equal(nes.cpu.mem[PC_HP], max, 'a fallen member should have been revived to the max');
});

test('a killing Damage wipes the whole recruited party and reaches game over ' +
  'without running the rest of the page', {
  skip: needsSample
}, async (t) => {
  const TOUCHED = 21;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-partywipe-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.maps[0].encounters = { rate: 0, actorIds: [] }; // a wandering monster must not race this
  project.maps[0].screens[0].entities.push(
    teller([
      {
        cond: { type: 'none', arg: 0 },
        commands: [{ op: 'say', text: 'Ow.' }, { op: 'damage', value: 255 }, { op: 'setSwitch', switch: TOUCHED }]
      }
    ])
  );
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = boot(built.romPath);
  // Recruit Iris first, so this is genuinely "everyone recruited," not a
  // one-member party's coincidence -- the same route the Join test above
  // proves is walkable both ways.
  walkTo(nes, 208, 48);
  assert.ok(talkThrough(nes), 'recruiting Iris never finished');
  assert.equal(nes.cpu.mem[PARTY_SIZE], 2, 'Iris never joined');
  walkTo(nes, 112, 112);

  tap(nes, B);
  for (let i = 0; i < 300 && nes.cpu.mem[BOX_STATE] !== BOX_ENDWAIT; i++) nes.frame();
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_ENDWAIT, 'the line never finished');
  tap(nes, A); // dismiss -- resumes the script, and the killing Damage runs
  for (let i = 0; i < 300 && nes.cpu.mem[BOX_STATE] !== BOX_ENDWAIT; i++) nes.frame();

  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEOVER, 'wiping every recruited member should reach game over');
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_ENDWAIT, 'the game-over message never finished');
  assert.equal(nes.cpu.mem[PC_HP], 0);
  assert.equal(nes.cpu.mem[PC_HP + 1], 0, "Iris's HP should have been wiped too");
  assert.equal(
    nes.cpu.mem[SWITCHES] & (1 << TOUCHED),
    0,
    'the command after the killing Damage ran on a dead session'
  );
});

// --- the Damage metatile ------------------------------------------------
//
// engine/combat.asm's player_hazard now agrees with the scripted Damage
// command above about which health model an RPG means: the whole recruited
// party's HP through rpg.asm's party_damage, not player_hp. Getting there
// took two traps beyond the routing itself, both in player_hazard and
// update_player -- see combat.asm's own header comment.

test('standing on a Damage metatile drains the party on a cooldown, not every frame', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'hazard-cooldown', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] }; // isolate the hazard from a wandering fight
    const damageId = 1;
    project.metatiles[damageId].collision = 'damage';
    project.maps[0].screens[0].metatiles = project.maps[0].screens[0].metatiles.map(() => damageId);
  });
  // The player starts standing on the tile, so boot()'s own frames already
  // ran through one hit before this test gets control -- worth keeping, not
  // working around, since it is exactly the "standing still costs a hit,
  // then nothing until the cooldown is up" behaviour under test, one hit
  // earlier than the rest of it.
  const nes = boot(rom);
  const max = nes.cpu.mem[PC_HP_MAX];
  const afterBoot = nes.cpu.mem[PC_HP];
  assert.ok(afterBoot < max, 'standing on the tile through boot should already have cost something');
  assert.ok(afterBoot > max - 3, `boot alone cost ${max - afterBoot} HP, not roughly one hit`);

  // Well inside IFRAME_TIME's 60-frame cooldown (engine/constants.asm): a
  // naive routing with no cooldown, reusing player_hazard's action-mode body
  // verbatim, would already be draining the party every frame here.
  for (let i = 0; i < 15; i++) nes.frame();
  assert.equal(nes.cpu.mem[PC_HP], afterBoot, 'HP dropped again well inside the cooldown window');

  // Past a full cooldown window: exactly one more hit, not the continuous
  // per-frame drain that would already have wiped the party by now.
  for (let i = 0; i < 60; i++) nes.frame();
  const afterSecondWindow = nes.cpu.mem[PC_HP];
  assert.ok(afterSecondWindow > 0, 'the party was drained to zero standing still');
  assert.ok(afterSecondWindow < afterBoot, 'a second cooldown window should have cost something too');
  assert.ok(
    afterSecondWindow > afterBoot - 3,
    `the second window cost ${afterBoot - afterSecondWindow} HP, not roughly one hit`
  );
});

test('a lethal Damage metatile hit does not lose the race to a wandering encounter on the same step', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'hazard-vs-encounter', (project) => {
    const damageId = 1;
    project.metatiles[damageId].collision = 'damage';
    // The whole screen open, one tile of Damage one column right of the start
    // position, and the start position placed one pixel short of that column
    // boundary -- so the very first frame the player moves is also the frame
    // player_hazard's probe (taken after moving) lands on the Damage tile.
    project.maps[0].screens[0].metatiles = project.maps[0].screens[0].metatiles.map(() => 0);
    project.maps[0].screens[0].metatiles[114] = damageId;
    project.project.startX = 23; // probe_x = startX+8 = 31, one pixel short of column 2
    project.project.startY = 112;
    // rate 1: the very first moving step already reaches the threshold, and
    // every one of the four formation slots names the same monster so the
    // roll always lands on a real encounter rather than sometimes finding an
    // empty one -- otherwise this test would only exercise the race by luck.
    project.maps[0].encounters = { rate: 1, actorIds: [0, 0, 0, 0] };
  });
  const nes = boot(rom);
  nes.cpu.mem[PC_HP] = 1; // one hit from the tile is lethal

  // One frame: the step that both crosses onto the Damage tile and makes
  // enc_step reach the map's rate (moving becomes true on the very same
  // frame) -- the exact race player_hazard's own game_state guard in
  // update_player exists for.
  nes.buttonDown(1, RIGHT);
  nes.frame();
  nes.buttonUp(1, RIGHT);
  for (let i = 0; i < 30; i++) nes.frame();

  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEOVER, 'the lethal hit should have ended the game');
  assert.notEqual(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'an encounter due the same step must not overwrite game over');
});

// player_iframes (engine/combat.asm) is the action side's own invincible
// window, and player_hazard reuses it purely as the RPG's floor-damage
// cooldown -- see this file's own header comment. entity_contact used to
// read that same byte before deciding whether to start a contact battle,
// which meant a Damage metatile silently suppressed every monster encounter
// for the ~60 frames after it hit: a player who stepped on a hazard could
// then walk straight through a monster with no fight at all.
test('touching a damaging actor still starts a fight inside a Damage metatile\'s cooldown', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'hazard-then-touch', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] }; // isolate from a wandering fight
    const damageId = 1;
    project.metatiles[damageId].collision = 'damage';
    project.maps[0].screens[0].metatiles = project.maps[0].screens[0].metatiles.map(() => damageId);
    // The slime (actorId 0, damage 1) one metatile right of the start
    // position -- close enough to touch a handful of frames after boot,
    // well inside IFRAME_TIME's 60-frame cooldown the floor hit standing at
    // start already armed.
    const slime = project.maps[0].screens[0].entities.find((e) => e.actorId === 0);
    slime.x = project.project.startX + 16;
    slime.y = project.project.startY;
  });
  const nes = boot(rom);
  // boot()'s own 40 frames already took the floor hit standing at start (see
  // the cooldown test above), so player_iframes is still well inside
  // IFRAME_TIME here -- exactly the window entity_contact's bug left a
  // contact battle unable to start in.
  assert.ok(nes.cpu.mem[PC_HP] < nes.cpu.mem[PC_HP_MAX], 'the floor hit before this test began should have landed');

  nes.buttonDown(1, RIGHT);
  for (let i = 0; i < 20 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  nes.buttonUp(1, RIGHT);

  assert.equal(
    nes.cpu.mem[GAME_STATE],
    ST_BATTLE,
    "touching the slime inside the floor hazard's cooldown should still have started a fight"
  );
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

  // touch_encounter records the slot that started the fight in bt_from_ent
  // (engine/rpg.asm), and battle_end deactivates exactly that entity after
  // the redraw, so the next update_entities pass skips it -- the same slot
  // cannot re-engage the instant control returns to the field. Another
  // gameplay frame, standing right where the fight happened, is the direct
  // check for that rather than an inference from the entity being gone.
  nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'the field re-engaged the same slot on the very next frame');
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
  // A potion in the bag, as if it had been picked up on the field. Item id 0
  // (sample-rpg's own "Potion") -- the bag holds item ids under
  // ITEMS_ENABLED (phase 4b), not the actor id (1) that used to back it.
  nes.cpu.mem[INV_ITEMS] = 0;
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

// --- saturation at the top of a byte ----------------------------------------
//
// The battle-side heals and multipliers each add in eight bits and then compare
// against a maximum -- and an add that carries past 255 hands the comparison a
// wrapped low byte smaller than either operand, so the clamp accepts a wrong,
// low answer. gain_hearts (engine/combat.asm) and party_heal (engine/rpg.asm)
// both guard this with a `bcs` to the clamp before the `cmp`; these four tests
// pin the same guard onto the battle side. Every fixture is chosen so the
// correct answer and the wrapped answer are far apart (253 vs 14, 0 vs 211...),
// and the maxima sit *below* 255 so an implementation that saturated to 255
// instead of the member's own max would fail too.

test('a potion used near the top of a byte clamps to the max instead of wrapping', {
  skip: needsSample
}, () => {
  const nes = boot();
  nes.cpu.mem[INV_ITEMS] = 0; // the potion, by item id
  nes.cpu.mem[INV_COUNT] = 1;
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  // 250 + 20 carries past 255; the wrapped byte would be 14, and 14 < 253
  // sails straight through the one-comparison clamp.
  nes.cpu.mem[PC_HP] = 250;
  nes.cpu.mem[PC_HP_MAX] = 253;

  chooseCommand(nes, BC_ITEM);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_ITEMS, 'ITEM should open the bag');
  tap(nes, A, 10);

  assert.equal(nes.cpu.mem[PC_HP], 253, 'a potion at high HP should clamp to the max, not wrap below it');
  assert.equal(nes.cpu.mem[INV_COUNT], 0, 'the potion should still be spent');
});

test('a heal spell cast near the top of a byte clamps to the max instead of wrapping', {
  skip: needsSample
}, () => {
  const nes = boot();
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  nes.cpu.mem[PC_SPELLS] |= 2; // Mend, granted the way its level would
  nes.cpu.mem[PC_MP] = 20;
  // 250 + 18 carries; the wrapped byte would be 12.
  nes.cpu.mem[PC_HP] = 250;
  nes.cpu.mem[PC_HP_MAX] = 253;

  chooseCommand(nes, BC_MAGIC);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_SPELLS);
  tap(nes, DOWN, 4); // past Ember to Mend
  tap(nes, A, 6);
  tap(nes, A, 10);

  assert.equal(nes.cpu.mem[PC_HP], 253, 'Mend at high HP should clamp to the max, not wrap below it');
  assert.equal(nes.cpu.mem[PC_MP], 16, 'the clamped cast still costs its four MP');
});

test('a monster healing itself near the top of a byte clamps to its own max', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'monheal', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    // The snake casts Mend instead of Venom, and cannot brute-force the fight
    // ending before it does; the party can sit through sixty rounds of it.
    project.sprites.actors[3].battle = { ...project.sprites.actors[3].battle, atk: 0, spellId: 1 };
    project.party[0].baseHp = 200;
  });
  const nes = boot(rom);
  // The snake waits in the bottom-left corner, and a walked-into fight refuses
  // RUN -- which is what makes stalling rounds possible at all.
  walkTo(nes, 32, 112);
  walkTo(nes, 32, 208, 300);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'walking into the snake did not start a fight');
  for (let i = 0; i < 12; i++) nes.frame();

  // 250 + 18 carries; the wrapped byte would be 12. Only the snake's own Mend
  // ever touches its HP from here: the party only stalls with refused RUNs.
  nes.cpu.mem[MON_HP] = 250;
  nes.cpu.mem[MON_SLOT_MAX] = 253;

  let healed = false;
  for (let round = 0; round < 60 && !healed; round++) {
    if (nes.cpu.mem[GAME_STATE] !== ST_BATTLE) break;
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_RUN);
    else tap(nes, A, 12);
    healed = nes.cpu.mem[MON_HP] !== 250;
  }
  assert.ok(healed, 'sixty rounds and the snake never cast Mend on itself');
  assert.equal(nes.cpu.mem[MON_HP], 253, 'a monster healing at high HP should clamp to its own max, not wrap');
});

test('a weakness hit at 171 or more saturates instead of dealing less than the plain hit', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'weakover', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    // Ember into the slime's fire weakness: 200 * 1.5 = 300, which wraps to 44
    // in eight bits -- *less* than the unmodified 200 -- and saturates to 255.
    project.spells[0].amount = 200;
  });
  const nes = boot(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  waitForMenu(nes);
  nes.cpu.mem[MON_HP] = 255; // saturated damage is exactly its whole HP

  chooseCommand(nes, BC_MAGIC);
  tap(nes, A, 6);  // Ember is the first row
  tap(nes, A, 10); // aim it at the slime

  assert.equal(nes.cpu.mem[MON_HP], 0, 'a saturated weakness hit should take all 255, not a wrapped 44');
  assert.equal(nes.cpu.mem[MON_ALIVE], 0, 'and 255 damage into 255 HP is a kill');
});

test('a physical attack of 253 or more survives its own noise roll instead of wrapping', {
  skip: needsSample
}, async (t) => {
  const rom = await buildVariant(t, 'atkover', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    // Attack 255 against defence 0 leaves bt_tmp at 255 before the 0-3 noise
    // roll is added; any nonzero roll used to wrap the hardest possible hit
    // down to a scratch of 0-2.
    project.party[0].baseAtk = 255;
    project.party[0].atkPerLevel = 0;
    project.sprites.actors[0].battle = { ...project.sprites.actors[0].battle, def: 0 };
  });
  const nes = boot(rom);
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  waitForMenu(nes);

  chooseCommand(nes, BC_FIGHT);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_TARGET);
  // Nothing advances the LFSR in battle but the rolls themselves, so seeding it
  // here makes the attack deterministic: $B8 -> $01 (roll_hit: 1 < acc-eva, a
  // hit) -> $02 (noise 2, the roll that used to wrap 255 + 2 down to 1).
  nes.cpu.mem[MON_HP] = 255;
  nes.cpu.mem[RNG] = 0xb8;
  tap(nes, A, 20);

  assert.equal(nes.cpu.mem[MON_HP], 0, 'a 255-attack hit should saturate at 255 damage, not wrap to 1');
  assert.equal(nes.cpu.mem[MON_ALIVE], 0, 'and 255 damage into 255 HP is a kill');
});

// ROADMAP item 5 phase 4c round 3, design deliverable 5 (phase4-design.md
// §8): build_item_list (engine/battleui.asm) now filters the battle ITEM
// menu to kind == heal and amount > 0 -- what item_chosen can actually spend
// consistently. A damage-kind item or a zero-amount heal item is a real,
// valid item everywhere else; it must simply never be a selectable row in
// that one menu.
test(
  'the battle ITEM menu lists only what it can spend consistently, while a damage-kind and a zero-amount item stay usable everywhere else',
  { skip: needsSample },
  async (t) => {
    // Round 3b review, K2: the original fixture put the sole qualifying
    // Potion first, so a filter whose scan stops at the first *rejected*
    // item (rather than skipping it and continuing) had nothing to expose
    // it -- and no positive-amount `none`-kind item existed to tell "requires
    // heal" apart from "merely rejects damage" (a `none` item with a
    // nonzero amount is a legal record, since Amount is only *disabled* in
    // the UI for kind `none`, not zeroed underneath). This bag interleaves
    // two qualifying heals between three different kinds of reject, with a
    // reject first, so both gaps have somewhere to show up.
    const rom = await buildVariant(t, 'twomenu', (project) => {
      project.items.push({ id: 1, name: 'Bomb', actorId: null, metaspriteId: null, effect: { kind: 'damage', amount: 5 } });
      project.items.push({ id: 2, name: 'Dud', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 0 } });
      project.items.push({ id: 3, name: 'Charm', actorId: null, metaspriteId: null, effect: { kind: 'none', amount: 7 } });
      project.items.push({ id: 4, name: 'Ether', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 8 } });
    });

    // Bag order: Bomb (reject: wrong kind), Potion (accept), Dud (reject:
    // right kind, wrong amount), Charm (reject: wrong kind, a legal
    // positive-amount `none`), Ether (accept) -- a reject leads, both
    // rejection branches (kind and amount) sit before a later accept they
    // must not swallow, and no two accepts are adjacent. A scan that stops
    // at any reject, on either branch, or a predicate that merely excludes
    // `damage` instead of requiring `heal`, each has a concrete,
    // distinguishing outcome to be wrong about.
    const battleNes = boot(rom);
    battleNes.cpu.mem[INV_ITEMS] = 1; // Bomb
    battleNes.cpu.mem[INV_ITEMS + 1] = 0; // Potion
    battleNes.cpu.mem[INV_ITEMS + 2] = 2; // Dud
    battleNes.cpu.mem[INV_ITEMS + 3] = 3; // Charm
    battleNes.cpu.mem[INV_ITEMS + 4] = 4; // Ether
    battleNes.cpu.mem[INV_COUNT] = 5;
    assert.ok(walkIntoEncounter(battleNes));
    waitForMenu(battleNes);
    chooseCommand(battleNes, BC_ITEM);
    assert.equal(battleNes.cpu.mem[BT_PHASE], BP_ITEMS, 'ITEM should open the bag -- real items are still in it');
    assert.equal(
      battleNes.cpu.mem[BT_LEN],
      2,
      'exactly the Potion and the Ether should be listed -- a scan that stops at the leading Bomb would see 0, ' +
        'and a scan that stops at the Dud or the Charm (both sitting between the two accepts) would see 1'
    );
    assert.equal(battleNes.cpu.mem[BT_LIST], 0, 'the first listed row should be the Potion (id 0), in bag order');
    assert.equal(
      battleNes.cpu.mem[BT_LIST + 1],
      4,
      'the second listed row should be the Ether (id 4) -- a predicate that merely excludes `damage`, rather ' +
        'than requiring `heal`, would have also listed the Charm (id 3, kind `none`, amount 7) here instead'
    );
    assert.equal(battleNes.cpu.mem[INV_COUNT], 5, 'merely opening the list must not spend or drop anything from the bag');

    // The field: the Bomb, the Dud and the Charm all remain real, spendable
    // items there, via the same use_item (engine/ui.asm) round 2 already
    // covers -- this menu's own filter has nothing to do with what the
    // field applies.
    const fieldNes = boot(rom);
    fieldNes.cpu.mem[INV_ITEMS] = 1; // the Bomb
    fieldNes.cpu.mem[INV_COUNT] = 1;
    fieldNes.cpu.mem[INV_SEL] = 0;
    for (let i = 0; i < 4; i++) fieldNes.cpu.mem[PC_HP + i] = 10;
    tap(fieldNes, SELECT);
    assert.equal(fieldNes.cpu.mem[GAME_STATE], ST_MENU);
    tap(fieldNes, A);
    assert.equal(fieldNes.cpu.mem[INV_COUNT], 0, 'the Bomb should be spent from the field even though the battle menu never lists it');
    assert.ok(fieldNes.cpu.mem[PC_HP] < 10, 'the Bomb’s own damage should have applied to the recruited member');

    fieldNes.cpu.mem[INV_ITEMS] = 2; // the Dud
    fieldNes.cpu.mem[INV_COUNT] = 1;
    fieldNes.cpu.mem[INV_SEL] = 0;
    tap(fieldNes, SELECT);
    tap(fieldNes, A);
    assert.equal(fieldNes.cpu.mem[INV_COUNT], 0, 'the Dud should be spent from the field too -- kind alone decides, not the amount');
    assert.equal(fieldNes.cpu.mem[ITEMS_USED], 2, 'both field uses so far should have counted as spent');

    fieldNes.cpu.mem[INV_ITEMS] = 3; // the Charm
    fieldNes.cpu.mem[INV_COUNT] = 1;
    fieldNes.cpu.mem[INV_SEL] = 0;
    tap(fieldNes, SELECT);
    tap(fieldNes, A);
    assert.equal(fieldNes.cpu.mem[INV_COUNT], 1, 'a none-kind item is a key item, kept rather than spent, on the field too');
    assert.equal(fieldNes.cpu.mem[ITEMS_USED], 2, 'a kept key item must not count as spent');
  }
);

// Finding 5 (phase4-design.md §9): the filter can leave bt_len at 0 while
// inv_count is still positive -- a bag holding only field-only-kind items.
// battle_menu_item now decides whether to open BP_ITEMS from the *filtered*
// bt_len, not raw inv_count (engine/battleui.asm), so this bag must not
// reach the broken state the design describes: BT_PHASE staying at
// BP_MENU (Items simply does not open) rather than opening onto an empty
// list whose row-select code would index a stale bt_list[0] and whose Up
// press would underflow bt_sel to $FF (battle_list_up's own `lda bt_len /
// sbc #1`, which computes 0 - 1 = $FF when bt_len is genuinely zero).
test(
  'a bag of only field-only-kind items does not open the battle ITEM menu into a stale or underflowing list -- finding 5',
  { skip: needsSample },
  async (t) => {
    const rom = await buildVariant(t, 'itemsonlyfield', (project) => {
      project.items.push({ id: 1, name: 'Bomb', actorId: null, metaspriteId: null, effect: { kind: 'damage', amount: 5 } });
      project.items.push({ id: 2, name: 'Dud', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 0 } });
    });
    const nes = boot(rom);
    nes.cpu.mem[INV_ITEMS] = 1; // the Bomb
    nes.cpu.mem[INV_ITEMS + 1] = 2; // the Dud
    nes.cpu.mem[INV_COUNT] = 2; // no Potion in the bag at all -- nothing qualifies

    assert.ok(walkIntoEncounter(nes));
    waitForMenu(nes);

    // Poke a stale value into bt_list, standing in for whatever an earlier
    // list build (a previous battle's spell or item list) left behind --
    // the exact leftover finding 5 warns a fresh, empty build could still be
    // read through.
    nes.cpu.mem[BT_LIST] = 77;

    chooseCommand(nes, BC_ITEM);
    assert.equal(nes.cpu.mem[BT_PHASE], BP_MENU, 'Items should not open at all -- nothing in the bag qualifies for this menu');
    assert.equal(nes.cpu.mem[BT_LEN], 0, 'the filtered length should read the real, freshly computed zero, not a stale nonzero leftover');
    assert.equal(nes.cpu.mem[BT_SEL], BC_ITEM, 'the highlight should still be sitting on ITEM in the main battle menu, not moved into a list');

    // Up must still behave like the ordinary battle menu's own wraparound,
    // never like the list's -- no $FF, ever.
    tap(nes, UP, 4);
    assert.notEqual(nes.cpu.mem[BT_SEL], 0xff, 'the highlight must never underflow to $FF');
    assert.ok(nes.cpu.mem[BT_SEL] < NUM_COMMANDS, 'the highlight should stay a real battle-menu command');
    assert.equal(nes.cpu.mem[BT_PHASE], BP_MENU, 'still the main battle menu -- Items never opened');
  }
);

// Round 5, B1: the gap ROADMAP.md itself named as outstanding after round 4c.
// item_chosen (engine/battleturn.asm) reads `bt_list,x` to find which item a
// selected row names, then reads item_heal,y (y = that item's own id) for its
// amount -- three separate places a wrong implementation could substitute a
// different item, a different order, or a different amount and still look
// right. Round 6 review found the amount read was not actually covered:
// sample-rpg's own Potion is item id 0, and this test used to select it, so
// an unindexed `lda item_heal` (always reading item_heal[0], Potion's own
// slot) coincidentally produced the same answer as the correct `lda
// item_heal,y`. Potion is excluded from this bag entirely now -- both
// accepted items are freshly authored with nonzero ids, so item_heal[0]
// is never the right answer for either of them, and an unindexed read is
// forced to disagree.
//
// The bag: Bomb(1, reject: kind), Tonic(4, accept, heal 12), Dud(2, reject:
// amount), Ether(3, accept, heal 8). Filtered list, in bag-scan order: [4,
// 3] -- Tonic (the higher id) comes first, already non-ascending without
// forcing it, which is what an id-sorting implementation would get wrong.
// Selecting row 1 (Ether, id 3) means inv_items[1] is Tonic (4), not Ether
// -- a `bt_list,x` -> `inv_items,x` substitution would read the wrong slot
// entirely, and even the two accepted items' own amounts (12 vs 8) differ,
// so a substitution that happened to land on the other accepted item would
// still show up as the wrong heal.
test(
  'item_chosen maps a selected, filtered battle row back to the correct item and amount -- not by index into inv_items, not by sorted id order, not by item 0\'s own amount',
  { skip: needsSample },
  async (t) => {
    const rom = await buildVariant(t, 'rowmapping', (project) => {
      project.items.push({ id: 1, name: 'Bomb', actorId: null, metaspriteId: null, effect: { kind: 'damage', amount: 5 } });
      project.items.push({ id: 2, name: 'Dud', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 0 } });
      project.items.push({ id: 3, name: 'Ether', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 8 } });
      project.items.push({ id: 4, name: 'Tonic', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 12 } });
    });
    const nes = boot(rom);
    nes.cpu.mem[INV_ITEMS] = 1; // Bomb
    nes.cpu.mem[INV_ITEMS + 1] = 4; // Tonic
    nes.cpu.mem[INV_ITEMS + 2] = 2; // Dud
    nes.cpu.mem[INV_ITEMS + 3] = 3; // Ether
    nes.cpu.mem[INV_COUNT] = 4;
    assert.ok(walkIntoEncounter(nes));
    waitForMenu(nes);
    nes.cpu.mem[PC_HP] = 5;

    chooseCommand(nes, BC_ITEM);
    assert.equal(nes.cpu.mem[BT_PHASE], BP_ITEMS, 'ITEM should open the bag');
    assert.equal(nes.cpu.mem[BT_LEN], 2, 'only the Tonic and the Ether should be listed');
    assert.equal(nes.cpu.mem[BT_LIST], 4, 'row 0 should be the Tonic (id 4) -- it comes first in bag order');
    assert.equal(nes.cpu.mem[BT_LIST + 1], 3, 'row 1 should be the Ether (id 3) -- bt_list must not be sorted by id');

    // Select row 1 (the Ether), not row 0 -- open_menu/battle_menu_item
    // already reset bt_sel to 0, so this is a real D-pad move, not a poke.
    tap(nes, DOWN, 4);
    assert.equal(nes.cpu.mem[BT_SEL], 1, 'DOWN should move the highlight onto row 1');
    tap(nes, A, 10);

    const expected = Math.min(5 + 8, nes.cpu.mem[PC_HP_MAX]);
    assert.equal(
      nes.cpu.mem[PC_HP],
      expected,
      'the Ether’s own heal (8) should have applied -- reading inv_items,x at x=1 would have found Tonic ' +
        'instead (applying 12), a sorted bt_list would have applied Tonic’s own 12 too, and an unindexed ' +
        'item_heal read would have applied item 0’s own amount (Potion, 20) regardless of which item was chosen'
    );
    assert.equal(nes.cpu.mem[INV_COUNT], 3, 'exactly one item (the Ether) should have been removed');
    assert.deepEqual(
      [...nes.cpu.mem.slice(INV_ITEMS, INV_ITEMS + 3)],
      [1, 4, 2],
      'the bag should close up over the Ether’s own slot (index 3), leaving Bomb, Tonic, Dud in their original order'
    );
  }
);

// ROADMAP item 5 phase 4c round 2, design deliverable 6: the field menu's
// own use_item (engine/ui.asm), not item_chosen -- this is a different call
// site with its own register-clobber hazard. party_heal (engine/rpg.asm)
// returns with X = MAX_PARTY, not inv_sel, so use_item's own reload of
// inv_sel after jsr use_item_apply is load-bearing: without it, the shift
// loop that closes the bag over the spent slot starts from the wrong X. A
// "does healing happen" test cannot see this -- the heal amount is read
// from inv_items,x using the *original* X, before use_item_apply ever runs,
// so it applies correctly either way. Only the bag's own post-state (which
// item survived, in which slot) tells the two apart, which is why this
// asserts that and not just the HP delta.
test(
  'use_item (field menu) removes the correct slot, not X = MAX_PARTY -- the register-clobber bug a "does healing happen" test would miss',
  { skip: needsSample },
  async (t) => {
    const rom = await buildVariant(t, 'itemslot', (project) => {
      project.items.push({ id: 1, name: 'Ether', actorId: null, metaspriteId: null, effect: { kind: 'heal', amount: 5 } });
    });
    const nes = boot(rom);
    // Potion (id 0) at slot 0, Ether (id 1) at slot 1 -- inv_sel points at
    // slot 0, the non-last slot. If the register clobber reappeared, X
    // would be MAX_PARTY (4) at the top of the shift loop instead of 0;
    // cpx inv_count (2) is already true there, so the loop would exit on
    // its first check, nothing would actually shift, and the wrong item
    // (Potion) would still be sitting in slot 0 where Ether belongs.
    nes.cpu.mem[INV_ITEMS] = 0;
    nes.cpu.mem[INV_ITEMS + 1] = 1;
    nes.cpu.mem[INV_COUNT] = 2;
    nes.cpu.mem[INV_SEL] = 0;
    nes.cpu.mem[PC_HP] = 5;

    tap(nes, SELECT);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_MENU, 'SELECT should open the field menu');
    tap(nes, A);

    assert.equal(nes.cpu.mem[INV_COUNT], 1, 'exactly one item should remain');
    assert.equal(
      nes.cpu.mem[INV_ITEMS],
      1,
      'the Ether (id 1) should have shifted down into slot 0 -- if this is still 0 (the Potion), the shift never ' +
        'ran, the exact symptom of use_item_apply’s own X clobber leaking into it'
    );
    const expected = Math.min(5 + 20, nes.cpu.mem[PC_HP_MAX]);
    assert.equal(nes.cpu.mem[PC_HP], expected, 'the selected Potion’s own heal (20) should still have applied');
  }
);

// Round 2b review, H2: only the lethal Damage path (finding 4, below) had a
// test on the RPG side -- party_damage's *alive* return (the `bne
// use_item_apply_alive` branch) had no coverage of its own. A caller that
// treated every non-zero party_damage result as lethal, or that never
// actually applied the damage at all, would still have passed everything
// else in this file.
test(
  'a non-lethal field-used Damage item lowers party HP without ending the game -- party_damage’s alive return',
  { skip: needsSample },
  async (t) => {
    // Round 2b review round 2 (J2): amount 2, not 1 -- item_effect_kind and
    // item_effect_amount (engine/ui.asm's use_item_apply) are read by the
    // identical instruction regardless of game type, so a stand-in that
    // hardcodes every damage item to exactly one point would have applied 1
    // here too and passed this test unnoticed if it had used amount 1.
    const rom = await buildVariant(t, 'nonlethaldamage', (project) => {
      project.items.push({ id: 1, name: 'Rock', actorId: null, metaspriteId: null, effect: { kind: 'damage', amount: 2 } });
    });
    const nes = boot(rom);
    nes.cpu.mem[INV_ITEMS] = 1; // the Rock
    nes.cpu.mem[INV_COUNT] = 1;
    nes.cpu.mem[INV_SEL] = 0;
    nes.cpu.mem[PC_HP] = 5;

    tap(nes, SELECT);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_MENU, 'SELECT should open the field menu');
    tap(nes, A);

    assert.equal(nes.cpu.mem[PC_HP], 3, 'the Rock’s own 2 points of damage should have applied to the recruited member, not 1');
    assert.equal(nes.cpu.mem[INV_COUNT], 0, 'the Rock should be spent');
    assert.equal(nes.cpu.mem[ITEMS_USED], 1);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_MENU, 'a non-lethal Damage item must not end the game');
  }
);

// Round 2c review, ride-along P2: amount 2 (above) is below every plausible
// hardcoded-small-constant mutation, including a clamp-to-3 -- 2 is already
// under 3, so clamping to 3 would leave it unchanged and this test alone
// could not tell a real 2 from a clamped one. Amount 4, deliberately above
// 3, closes that: a clamp-to-3 mutation would apply 3 instead of 4 and land
// at 2 HP, not the real 1.
test(
  'a non-lethal field-used Damage item above 3 applies its own real amount, not a clamp to 3',
  { skip: needsSample },
  async (t) => {
    const rom = await buildVariant(t, 'nonlethaldamage4', (project) => {
      project.items.push({ id: 1, name: 'Boulder', actorId: null, metaspriteId: null, effect: { kind: 'damage', amount: 4 } });
    });
    const nes = boot(rom);
    nes.cpu.mem[INV_ITEMS] = 1; // the Boulder
    nes.cpu.mem[INV_COUNT] = 1;
    nes.cpu.mem[INV_SEL] = 0;
    nes.cpu.mem[PC_HP] = 5;

    tap(nes, SELECT);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_MENU, 'SELECT should open the field menu');
    tap(nes, A);

    assert.equal(nes.cpu.mem[PC_HP], 1, 'the Boulder’s own 4 points of damage should have applied in full, not clamped to 3 (which would leave 2)');
    assert.equal(nes.cpu.mem[GAME_STATE], ST_MENU, 'still non-lethal -- 5 - 4 = 1, not dead');
  }
);

// Finding 4 (phase 4 design §9): use_item_apply must never jump to
// player_died itself -- it is reached by jsr, so a jmp there would strand
// its own return address (back into use_item's shift logic) for some
// unrelated rts to mis-pop later. "It didn't crash" proves nothing here --
// the corruption is silent until something else happens to pop that stray
// address. The direct proof is the stack itself: the instant PC reaches
// player_died, its return address must not point back inside use_item at
// all, which it would if use_item_apply had jumped there mid-call.
//
// Round 2b review, H3: the address-range check alone is weaker than it
// looks. A caller-side path that jumps to player_died while use_item_apply's
// own one-byte `pha` result is still sitting unpopped on the stack pushes
// the return-address read one byte further down than it should be -- that
// misread also lands outside [useItemStart, useItemEnd], for the wrong
// reason, and would still pass. Two more checks close that: the stack
// POINTER itself must match a second, independently measured occurrence of
// the identical call depth (dispatch_input, entered by `jsr` from main_loop
// exactly once, the same depth player_died sits at through use_item's own
// jmp chain) -- a leftover pha leaves SP one lower than that, which a
// one-sided range check on the address it produces cannot catch. And the
// bag itself must already show the spend (inv_count decremented, items_used
// incremented) by the moment PC reaches player_died, since a jump that
// happens before use_item's own shift/pla runs would land here too early to
// have done either.
//
// Round 2b review round 2 (J3): even those additions admit one more wrong
// implementation -- one that pla's, detects death, and jumps to player_died
// AFTER dec inv_count/inc items_used but BEFORE the highlight-repair block
// (`lda inv_sel / cmp inv_count / ...`) that pulls inv_sel back when the
// spent slot was the last one. A single-item bag hides this completely:
// spending the only item leaves inv_sel at 0 whether or not the repair ran,
// because inv_sel started at 0 and the repair's own result for a now-empty
// bag is also 0. A two-item bag with the lethal item in the *last* slot
// makes the repair's own effect (pulling inv_sel from 1 back to 0) visible,
// and the surviving item's slot proves the shift/dec ran at all.
test(
  'a lethal field-used Damage item ends up back in the real return chain, not stranded inside use_item -- finding 4',
  { skip: needsSample },
  async (t) => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-lethaluse-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
    const project = await loadProject(SAMPLE);
    project.items.push({ id: 1, name: 'Bomb', actorId: null, metaspriteId: null, effect: { kind: 'damage', amount: 255 } });
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });

    const symbols = fs.readFileSync(built.symbolPath, 'utf8');
    const addrOf = (label) => {
      const match = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
      assert.ok(match, `${label} should be a named symbol in game.fns`);
      return parseInt(match[1], 16);
    };
    const useItemStart = addrOf('use_item');
    const useItemEnd = addrOf('use_item_done');
    const playerDiedAddr = addrOf('player_died');
    const dispatchInputAddr = addrOf('dispatch_input');
    assert.ok(useItemEnd > useItemStart, 'use_item_done should sit after use_item in the assembled ROM');

    const emulator = new Emulator({ onFrame: () => {} });
    emulator.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
    const nes = emulator.nes;
    const frame = () => nes.frame();
    for (let i = 0; i < 40; i++) frame();

    // sample-rpg's own item 0 (the Potion) sits harmlessly in slot 0; the
    // Bomb sits in slot 1, the *last* slot -- the one arrangement that makes
    // a skipped highlight repair observable.
    nes.cpu.mem[INV_ITEMS] = 0; // the Potion, unused, proves the shift/order
    nes.cpu.mem[INV_ITEMS + 1] = 1; // the Bomb
    nes.cpu.mem[INV_COUNT] = 2;
    for (let i = 0; i < 4; i++) nes.cpu.mem[PC_HP + i] = 1; // one hit wipes whoever is recruited

    emulator.setButton(BUTTON.SELECT, true);
    frame();
    emulator.setButton(BUTTON.SELECT, false);
    for (let i = 0; i < 12; i++) frame();
    assert.equal(nes.cpu.mem[GAME_STATE], ST_MENU, 'SELECT should open the field menu');

    // open_menu (engine/ui.asm) resets inv_sel to 0 unconditionally on
    // open, so pointing at the last slot needs one RIGHT press after
    // opening, not a direct poke beforehand -- poking inv_sel before SELECT
    // is exactly what the original, single-item version of this test did,
    // and is exactly why it never noticed the highlight repair could be
    // skipped: slot 0 was already where open_menu was going to put it.
    emulator.setButton(BUTTON.RIGHT, true);
    frame();
    emulator.setButton(BUTTON.RIGHT, false);
    for (let i = 0; i < 4; i++) frame();
    assert.equal(nes.cpu.mem[INV_SEL], 1, 'RIGHT should move the highlight onto the Bomb, the last slot');

    // Baseline: SP the instant dispatch_input is entered on an ordinary
    // frame, before the lethal item is even used. dispatch_input is one jsr
    // deep from main_loop (`jsr dispatch_input`, 2 bytes); player_died below
    // is reached from inside that same, still-unreturned call, through
    // dispatch_input's own `txa`/`pha` (engine/input.asm's dispatch_loop,
    // "the handlers use X to walk the entity slots", 1 byte) and its `jsr
    // do_action` (2 bytes) -- do_action_confirm, use_item and use_item_apply
    // add nothing further of their own once use_item_apply's jsr/rts and
    // use_item's pha/pla have each balanced, so a correct implementation
    // reaches player_died exactly 3 bytes deeper than dispatch_input's own
    // entry point. That +3 is this file's own structure, not a guess -- a
    // second, independently measured occurrence of dispatch_input's own
    // depth is what it is measured against, rather than a literal SP value
    // that would say nothing about why it should be that number.
    assert.ok(
      emulator.runToAddress(dispatchInputAddr, { frames: 10 }),
      'dispatch_input should run every ordinary frame while sitting in the menu'
    );
    const expectedSp = (nes.cpu.REG_SP - 3) & 0xff;
    for (let i = 0; i < 4; i++) frame(); // let this frame finish cleanly before the real button press

    emulator.breakpoints.add(playerDiedAddr);
    emulator.setButton(BUTTON.A, true);
    const reached = emulator.runToAddress(playerDiedAddr, { frames: 10 });
    emulator.setButton(BUTTON.A, false);
    assert.ok(reached, 'player_died should be reached within a few frames of confirming the lethal item');
    assert.equal(emulator.pc, playerDiedAddr);

    // By the time PC reaches player_died, use_item's own shift loop, dec/inc
    // and the highlight fixup have already run (they all sit between the
    // pha and the jmp), so the spend must already be fully visible -- a jump
    // reached before the fixup completed would land here having done the
    // dec/inc but skipped exactly the highlight repair, which is what the
    // inv_sel assertion below exists to catch.
    assert.equal(nes.cpu.mem[INV_COUNT], 1, 'the lethal Bomb should already be removed from the bag by the time player_died runs');
    assert.equal(nes.cpu.mem[ITEMS_USED], 1, 'items_used should already be bumped by the time player_died runs');
    assert.equal(
      nes.cpu.mem[INV_SEL],
      0,
      'spending the last slot (1) should have pulled inv_sel back to 0 by the time player_died runs -- a jump ' +
        'reached after the dec/inc but before the highlight repair would leave inv_sel stranded at 1, past the ' +
        'end of the one remaining item'
    );
    assert.equal(nes.cpu.mem[INV_ITEMS], 0, 'the surviving Potion should still be sitting in slot 0, untouched');

    // The instant PC lands on player_died, read the return address sitting
    // on top of the stack -- exactly what an rts right here would jump to.
    const sp = nes.cpu.REG_SP & 0xff;
    const lo = nes.cpu.mem[0x100 | ((sp + 1) & 0xff)];
    const hi = nes.cpu.mem[0x100 | ((sp + 2) & 0xff)];
    const returnAddr = (((hi << 8) | lo) + 1) & 0xffff;
    assert.ok(
      returnAddr < useItemStart || returnAddr > useItemEnd,
      `the stack's own return address (0x${returnAddr.toString(16)}) falls inside use_item ` +
        `(0x${useItemStart.toString(16)}-0x${useItemEnd.toString(16)}) -- a stray jsr use_item_apply return address ` +
        'is still sitting on the stack, exactly finding 4'
    );
    assert.equal(
      sp,
      expectedSp,
      `the stack pointer at player_died (0x${sp.toString(16)}) does not match dispatch_input's own baseline depth ` +
        `(0x${expectedSp.toString(16)}) -- a leftover pha byte would leave it exactly one lower than this`
    );

    for (let i = 0; i < 20; i++) frame();
    assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEOVER, 'the lethal hit should still reach game over normally');
  }
);

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
  // Item id 0, not actor id 1 -- the bag holds item ids under ITEMS_ENABLED.
  assert.equal(nes.cpu.mem[INV_ITEMS], 0, 'the drop should be the potion the slime carries');
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

test('winning a battle clears a status that fight leaves behind, not just one it never had', {
  skip: needsSample
}, async (t) => {
  // A one-hit-point slime dies to the first attack that lands, so the fight
  // stays short and deterministic regardless of how many extra poison-tick
  // messages the status under test adds to every party turn.
  const rom = await buildVariant(t, 'won-poisoned', (project) => {
    project.sprites.actors[0].hp = 1;
  });
  const nes = boot(rom);
  assert.ok(walkIntoEncounter(nes));
  waitForMenu(nes);
  // Poisoned mid-fight, the same way a monster's own Venom would leave it --
  // battle_end is what is under test here, not how the status was acquired.
  nes.cpu.mem[PC_STATUS] = 1;

  let state = ST_BATTLE;
  for (let round = 0; round < 30 && state === ST_BATTLE; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_FIGHT);
    else tap(nes, A, 12);
    state = nes.cpu.mem[GAME_STATE];
  }
  assert.equal(state, ST_GAMEPLAY, 'the fight never ended');
  assert.equal(nes.cpu.mem[PC_STATUS], 0, 'battle_end should clear a status a won fight leaves behind');
});

// --- an event starting a battle ----------------------------------------------

test('a Start a battle command suspends the script, and winning resumes it', {
  skip: needsSample
}, async (t) => {
  const VARIABLES = 0x500; // engine/constants.asm
  const rom = await buildVariant(t, 'scripted-battle', (project) => {
    // Only the scripted fight may start -- a random encounter on the way
    // would be indistinguishable from the answer.
    project.maps[0].encounters = { rate: 0, actorIds: [] };

    // An entry event on this screen, so battle_end re-arming it would show up.
    project.maps[0].screens[0].entities.push({
      actorId: 2, // Iris, who has nothing to do with the fight
      x: 96,
      y: 32,
      props: {
        trigger: 'enter',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'addVar', variable: 0, value: 1 }] }] }
      }
    });

    // A boss: touching it starts a scripted fight against the Slime (actor
    // 0), and the command after it -- turning on a switch -- is the win
    // case, authored with no new vocabulary. Losing is not authored at all:
    // it is already a game over, from player_died.
    const bossId = project.sprites.actors.length;
    project.sprites.actors.push({
      ...structuredClone(project.sprites.actors[2]),
      id: bossId,
      name: 'Boss Door',
      damage: 0
    });
    project.maps[0].screens[0].entities.push({
      actorId: bossId,
      x: 176,
      y: 32,
      props: {
        trigger: 'touch',
        event: {
          pages: [
            {
              cond: { type: 'none', arg: 0 },
              commands: [
                { op: 'battle', monsters: [0] },
                { op: 'setSwitch', switch: 5 }
              ]
            }
          ]
        }
      }
    });
  });

  const nes = boot(rom);
  const startScreen = nes.cpu.mem[FLAT_SCREEN];
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the entry event did not run when the game started');
  assert.equal(nes.cpu.mem[SWITCHES] & (1 << 5), 0, 'the boss switch should not already be on');

  walkTo(nes, 176, 32);
  for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'touching the boss did not start the scripted fight');
  for (let i = 0; i < 12; i++) nes.frame(); // let battle_intro's own first tick settle in
  assert.equal(nes.cpu.mem[BT_COUNT], 1, 'the formation should hold exactly the one monster named');
  assert.equal(nes.cpu.mem[MON_SLOT_ACTOR], 0, "the formation should be the Slime, not the map's own encounter table");

  // Win it — the same way "FIGHT wears the monster down" does, since it is
  // the same lone Slime.
  const startHp = nes.cpu.mem[MON_HP];
  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  for (let round = 0; round < 12 && nes.cpu.mem[MON_HP] === startHp; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_FIGHT);
    tap(nes, A, 20);
  }
  assert.ok(nes.cpu.mem[MON_HP] < startHp, 'twelve attacks all missed, which is not a roll');
  const state = pressThrough(nes);
  assert.equal(state, ST_GAMEPLAY, 'the battle never ended');
  assert.equal(nes.cpu.mem[MON_ALIVE], 0);

  // The event resumed at the command after the battle: the win case, with no
  // lose branch anywhere to author.
  assert.ok(nes.cpu.mem[SWITCHES] & (1 << 5), 'the script did not resume after winning');

  // The field is intact: the redraw that put the player back did not replay
  // this screen's entry event...
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'the screen ran its entry event again when the battle ended');
  // ...it is still the screen the player was standing on...
  assert.equal(nes.cpu.mem[FLAT_SCREEN], startScreen, 'the battle left the player on a different screen');
  // ...and the trampoline restored the screen bank: the player can still
  // walk, which means mtptr is reading the map again, not the battle system.
  const before = nes.cpu.mem[PLAYER_X];
  walkTo(nes, before - 16, nes.cpu.mem[PLAYER_Y], 30);
  assert.ok(nes.cpu.mem[PLAYER_X] < before, 'the player cannot move after the scripted battle');
});

// battle_begin (this file) captures talk_ent into bt_owner_ent/bt_owner_rec
// and then unconditionally clears talk_ent to NO_ENTITY on the way into a
// fight -- correct for a random or contact-damage encounter, neither of
// which ever set it. battle_end's own owner loop restores ent_touched,x for
// the resolved slot but, before this fix, never put talk_ent back -- so a
// resumed script's own MOVE_SELF/talk_ent defense-in-depth check
// (script_op_move, script_op_turn -- see their own comments) read NO_ENTITY,
// mistook it for the real "nobody to be" case, and silently jmp
// script_finish'd: neither the Move/Turn nor anything after it on the page
// ran. Pre-existing on master for Move; Turn inherited it unmodified because
// it shares the identical defense-in-depth shape. Both are tested here
// because Move is the one that had been shipping silently broken -- an
// assertion that only checked the facing (or the position) would pass on a
// build that still drops every command after it, which is the actual
// symptom, so both the movement/facing effect AND the switch after it are
// asserted.
test('a Move self right after winning a scripted battle still runs, and so does the command after it', {
  skip: needsSample
}, async (t) => {
  let bossId;
  const rom = await buildVariant(t, 'battle-move-self', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    bossId = project.sprites.actors.length;
    project.sprites.actors.push({
      ...structuredClone(project.sprites.actors[2]),
      id: bossId,
      name: 'Boss Door',
      damage: 0
    });
    project.maps[0].screens[0].entities.push({
      actorId: bossId,
      x: 176,
      y: 32,
      props: {
        trigger: 'touch',
        event: {
          pages: [
            {
              cond: { type: 'none', arg: 0 },
              commands: [
                { op: 'battle', monsters: [0] },
                { op: 'move', who: 'self', dir: 'up', dist: 16 },
                { op: 'setSwitch', switch: 5 }
              ]
            }
          ]
        }
      }
    });
  });

  const nes = boot(rom);
  walkTo(nes, 176, 32);
  for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'touching the boss did not start the scripted fight');
  for (let i = 0; i < 12; i++) nes.frame();

  const startHp = nes.cpu.mem[MON_HP];
  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  for (let round = 0; round < 12 && nes.cpu.mem[MON_HP] === startHp; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_FIGHT);
    tap(nes, A, 20);
  }
  // pressThrough only presses while game_state is ST_BATTLE, so it stops the
  // instant battle_end hands off -- which, correctly, is ST_DIALOG here (the
  // Move now suspends), not ST_GAMEPLAY yet. Settling further is what tells
  // "the script correctly resumed and is walking" apart from "the script
  // silently terminated" -- the bug this test exists for makes battle_end
  // land on ST_GAMEPLAY immediately, skipping the Move (and the suspend)
  // entirely, so asserting ST_GAMEPLAY right after pressThrough would have
  // passed on the *broken* build and failed on the fixed one.
  pressThrough(nes);
  for (let i = 0; i < 60 && nes.cpu.mem[GAME_STATE] !== ST_GAMEPLAY; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'the conversation never finished settling');

  const bossSlot = findBossSlot(nes, bossId);
  assert.notEqual(bossSlot, -1, 'the boss should still be on the field after winning');
  // Y, not merely "X unchanged": an implementation that skips the Move
  // entirely and falls straight through to SetSwitch would also leave X at
  // 176 (nothing moved it sideways either way), so an X-only check cannot
  // tell "the Move ran and only touched Y, as authored" apart from "the Move
  // never ran at all." Y actually reaching 16 is the one value only a real,
  // executed Move up produces.
  assert.equal(
    nes.cpu.mem[ENT_Y + bossSlot],
    16,
    'the boss must have actually walked up 16px -- Move up changes Y from 32 to 16'
  );
  assert.equal(
    nes.cpu.mem[ENT_X + bossSlot],
    176,
    'the boss must not have silently moved sideways -- Move up only touches Y'
  );
  assert.ok(
    nes.cpu.mem[SWITCHES] & (1 << 5),
    'the command after the Move must still have run -- a silently terminated page would leave this off ' +
      'even though the boss itself is still standing right there'
  );
});

test('a Turn self right after winning a scripted battle still runs, and so does the command after it', {
  skip: needsSample
}, async (t) => {
  let bossId;
  const rom = await buildVariant(t, 'battle-turn-self', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    bossId = project.sprites.actors.length;
    project.sprites.actors.push({
      ...structuredClone(project.sprites.actors[2]),
      id: bossId,
      name: 'Boss Door',
      damage: 0
    });
    project.maps[0].screens[0].entities.push({
      actorId: bossId,
      x: 176,
      y: 32,
      props: {
        trigger: 'touch',
        event: {
          pages: [
            {
              cond: { type: 'none', arg: 0 },
              commands: [
                { op: 'battle', monsters: [0] },
                { op: 'turn', who: 'self', dir: 'up' },
                { op: 'setSwitch', switch: 5 }
              ]
            }
          ]
        }
      }
    });
  });

  const nes = boot(rom);
  walkTo(nes, 176, 32);
  for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'touching the boss did not start the scripted fight');
  for (let i = 0; i < 12; i++) nes.frame();

  const startHp = nes.cpu.mem[MON_HP];
  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  for (let round = 0; round < 12 && nes.cpu.mem[MON_HP] === startHp; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_FIGHT);
    tap(nes, A, 20);
  }
  // Turn does not suspend, so unlike Move above, battle_end handing off
  // straight to ST_GAMEPLAY here is the correct outcome either way -- the
  // bug and the fix both leave state ST_GAMEPLAY, since script_finish is
  // where both the broken and the working path end up, just by different
  // routes. What actually distinguishes them is whether the facing and the
  // switch got set on the way, which the assertions below check.
  const state = pressThrough(nes);
  assert.equal(state, ST_GAMEPLAY, 'the battle never ended');

  const bossSlot = findBossSlot(nes, bossId);
  assert.notEqual(bossSlot, -1, 'the boss should still be on the field after winning');
  assert.equal(
    nes.cpu.mem[ENT_DIR + bossSlot],
    1 /* DIR_UP, engine/constants.asm */,
    'the Turn right after the battle must have set the boss’s facing'
  );
  assert.ok(
    nes.cpu.mem[SWITCHES] & (1 << 5),
    'the command after the Turn must still have run -- a silently terminated page would leave this off'
  );
});

test('winning does not re-arm the boss even when its own event reshuffles entity slots', {
  skip: needsSample
}, async (t) => {
  // The boss's own event hides an earlier actor before it battles, so the
  // redraw that follows victory spawns the boss into a *different* slot than
  // it held during the fight (the hidden actor no longer takes one ahead of
  // it). Restoring ent_touched by a slot index remembered before the fight
  // would put it back on whatever now sits in that slot instead of the boss
  // — and the boss's own slot, left clear, would read as a fresh touch and
  // arm the same event again. If battle_end is asking the field who the
  // player is standing on right now rather than trusting a stale index, the
  // reshuffle makes no difference and this passes; if it regresses to a
  // remembered index, the battle restarts forever.
  const HIDE_SWITCH = 7;
  let bossId;
  const rom = await buildVariant(t, 'scripted-battle-reshuffle', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };

    // An actor placed *before* the boss in the entity list, so hiding it
    // shifts every later actor — the boss included — down one slot.
    const earlyId = project.sprites.actors.length;
    project.sprites.actors.push({
      ...structuredClone(project.sprites.actors[2]),
      id: earlyId,
      name: 'Early Bird',
      damage: 0
    });
    project.maps[0].screens[0].entities.push({
      actorId: earlyId,
      x: 64,
      y: 32,
      props: { hideSwitch: HIDE_SWITCH }
    });

    // The boss: hides Early Bird, then fights. Both happen inside the one
    // conversation, so the shift is already decided by the time battle_begin
    // runs — it just is not applied until battle_end's own redraw.
    bossId = project.sprites.actors.length;
    project.sprites.actors.push({
      ...structuredClone(project.sprites.actors[2]),
      id: bossId,
      name: 'Boss Door',
      damage: 0
    });
    project.maps[0].screens[0].entities.push({
      actorId: bossId,
      x: 176,
      y: 32,
      props: {
        trigger: 'touch',
        event: {
          pages: [
            {
              cond: { type: 'none', arg: 0 },
              commands: [
                { op: 'setSwitch', switch: HIDE_SWITCH },
                { op: 'battle', monsters: [0] },
                { op: 'turn', who: 'self', dir: 'up' }
              ]
            }
          ]
        }
      }
    });
  });

  const nes = boot(rom);

  walkTo(nes, 176, 32);
  for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'touching the boss did not start the scripted fight');
  for (let i = 0; i < 12; i++) nes.frame(); // let battle_intro's own first tick settle in

  const startHp = nes.cpu.mem[MON_HP];
  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  for (let round = 0; round < 12 && nes.cpu.mem[MON_HP] === startHp; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_FIGHT);
    tap(nes, A, 20);
  }
  assert.ok(nes.cpu.mem[MON_HP] < startHp, 'twelve attacks all missed, which is not a roll');
  const state = pressThrough(nes);
  assert.equal(state, ST_GAMEPLAY, 'the battle never ended');

  // The boss should still be standing there, just no longer next to Early
  // Bird — which is what actually moves it into a different slot than it
  // fought in, since spawn_entities assigns slots by walking the entity
  // list in order and Early Bird no longer takes one ahead of it.
  const ENT_ACTIVE = 0x300;
  const ENT_ACTOR = 0x308;
  let bossSlot = -1;
  for (let slot = 0; slot < 8; slot++) {
    if (nes.cpu.mem[ENT_ACTIVE + slot] === 1 && nes.cpu.mem[ENT_ACTOR + slot] === bossId) bossSlot = slot;
  }
  assert.notEqual(bossSlot, -1, 'the boss should still be on the field after winning');

  // Give the field several frames to settle. A regression re-arms the boss's
  // event on the very next update_entities pass and never leaves ST_BATTLE
  // again; the fix leaves the world running.
  for (let i = 0; i < 60; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'the boss re-armed itself and the battle restarted');

  // The Turn after Battle is what actually exercises battle_end's own
  // resolve-by-record comment, not merely ent_touched -- restoring talk_ent
  // from the *pre-battle* bt_owner_ent (the boss's old slot, one higher than
  // its resolved slot now that Early Bird no longer takes one ahead of it)
  // would apply this Turn to whatever now sits in that stale slot instead of
  // the boss, and the boss's own facing would stay the boot default. Neither
  // the Move/Turn tests above nor the reshuffle itself, without this
  // follow-up command, can see that: both apply "self" to a slot that never
  // moved, and this is the one scenario where "self" and "the pre-battle
  // slot" name two different things.
  assert.equal(
    nes.cpu.mem[ENT_DIR + bossSlot],
    1 /* DIR_UP, engine/constants.asm */,
    'the Turn right after the battle must have set the boss’s own facing at its post-reshuffle slot, not ' +
      'whatever now sits in its stale pre-battle one'
  );
});

test('a random encounter that lands on a touch event does not suppress it', {
  skip: needsSample
}, async (t) => {
  const TOUCH_SWITCH = 6;
  const rom = await buildVariant(t, 'random-encounter-touch', (project) => {
    // Rate 3 rather than the usual "walk until it rolls": the player moves 2
    // pixels a frame and TOUCH_RANGE is 12, so the entity 16 pixels away
    // first reads as touched on the third moving frame -- the same frame
    // enc_step reaches a rate of 3. That is the exact interleaving the bug
    // depends on: check_encounter (inside update_player) freezes the world
    // before update_entities, later the same frame, ever gets to arm the
    // touch through settle_owed.
    project.maps[0].encounters = { rate: 3, actorIds: [0] };

    // A touch-triggered event with no damage of its own, so the only way
    // into it is entity_trigger_touch -- never entity_contact/touch_encounter.
    project.maps[0].screens[0].entities.push({
      actorId: 2, // Iris, who has nothing to do with the fight
      x: 128,
      y: 112,
      props: {
        trigger: 'touch',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setSwitch', switch: TOUCH_SWITCH }] }] }
      }
    });
  });

  const nes = boot(rom);
  assert.equal(nes.cpu.mem[PLAYER_X], 112);
  assert.equal(nes.cpu.mem[PLAYER_Y], 112);

  walkTo(nes, 128, 112, 20);
  for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'the random encounter never started');
  for (let i = 0; i < 12; i++) nes.frame(); // let battle_intro's own first tick settle in
  assert.equal(nes.cpu.mem[BT_COUNT], 1, 'the formation should hold exactly the one monster named');
  assert.equal(
    nes.cpu.mem[SWITCHES] & (1 << TOUCH_SWITCH),
    0,
    'the touch event ran before the encounter could steal the frame -- the scenario never happened'
  );

  const startHp = nes.cpu.mem[MON_HP];
  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  for (let round = 0; round < 12 && nes.cpu.mem[MON_HP] === startHp; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_FIGHT);
    tap(nes, A, 20);
  }
  assert.ok(nes.cpu.mem[MON_HP] < startHp, 'twelve attacks all missed, which is not a roll');
  const state = pressThrough(nes);
  assert.equal(state, ST_GAMEPLAY, 'the battle never ended');

  // The touch was only ever armed, never run -- it must come back able to
  // fire, not latched shut the way a genuinely-run event should be. Give the
  // field a few frames to notice the player is still standing there.
  for (let i = 0; i < 30 && !(nes.cpu.mem[SWITCHES] & (1 << TOUCH_SWITCH)); i++) nes.frame();
  assert.ok(
    nes.cpu.mem[SWITCHES] & (1 << TOUCH_SWITCH),
    'the touch event never ran after the random encounter stole its frame'
  );
});

test("an entry event's own battle does not suppress an unrelated touch entity underfoot", {
  skip: needsSample
}, async (t) => {
  const ENTRY_SWITCH = 5;
  const BYSTANDER_SWITCH = 6;
  const rom = await buildVariant(t, 'entry-battle-bystander', (project) => {
    project.maps[0].encounters = { rate: 0, actorIds: [] };
    const { startX, startY } = project.project;

    // The screen's own opening event: touching nothing, just arriving is
    // enough. Its battle freezes the world before update_entities has run
    // even once this screen, which is the exact interleaving this guards --
    // settle_owed dispatches an armed entry event before update_player/
    // update_entities ever run on the frame the screen is drawn.
    project.maps[0].screens[0].entities.push({
      actorId: 2, // Iris, who has nothing to do with either event
      x: 16,
      y: 16,
      props: {
        trigger: 'enter',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [
          { op: 'battle', monsters: [0] },
          { op: 'setSwitch', switch: ENTRY_SWITCH }
        ] }] }
      }
    });

    // A bystander the player already stands on at boot: a touch event wholly
    // unrelated to the entry event's own battle, and never scanned before
    // that battle steals the frame. Iris again -- no damage, so this is the
    // event/trigger path only, never entity_contact/touch_encounter's.
    project.maps[0].screens[0].entities.push({
      actorId: 2,
      x: startX,
      y: startY,
      props: {
        trigger: 'touch',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setSwitch', switch: BYSTANDER_SWITCH }] }] }
      }
    });
  });

  const nes = boot(rom);
  for (let i = 0; i < 30 && nes.cpu.mem[GAME_STATE] !== ST_BATTLE; i++) nes.frame();
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, "the entry event's battle never started");
  for (let i = 0; i < 12; i++) nes.frame(); // let battle_intro's own first tick settle in
  assert.equal(
    nes.cpu.mem[SWITCHES] & (1 << BYSTANDER_SWITCH),
    0,
    'the bystander was never standing there to have run already -- the scenario never happened'
  );

  const startHp = nes.cpu.mem[MON_HP];
  chooseCommand(nes, BC_FIGHT);
  tap(nes, A, 20);
  for (let round = 0; round < 12 && nes.cpu.mem[MON_HP] === startHp; round++) {
    if (nes.cpu.mem[BT_PHASE] === BP_MENU) chooseCommand(nes, BC_FIGHT);
    tap(nes, A, 20);
  }
  assert.ok(nes.cpu.mem[MON_HP] < startHp, 'twelve attacks all missed, which is not a roll');
  const state = pressThrough(nes);
  assert.equal(state, ST_GAMEPLAY, 'the battle never ended');
  assert.ok(nes.cpu.mem[SWITCHES] & (1 << ENTRY_SWITCH), "the entry event's own script did not resume after winning");

  // The bystander's touch was never armed, let alone run -- it must not come
  // back latched shut by a restore meant for the entry event's own actor.
  for (let i = 0; i < 30 && !(nes.cpu.mem[SWITCHES] & (1 << BYSTANDER_SWITCH)); i++) nes.frame();
  assert.ok(
    nes.cpu.mem[SWITCHES] & (1 << BYSTANDER_SWITCH),
    "the bystander's touch event never ran once the world resumed"
  );
});
