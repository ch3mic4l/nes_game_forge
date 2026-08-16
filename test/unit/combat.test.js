// Action combat, driven through the built ROM: taking damage, the invincible
// window, hitting something that survives the first hit, the HUD, and dying.
//
// The sample deliberately cannot hurt the player on the routes its other tests
// walk, so every scenario here builds its own project. `COMBAT_ENABLED` is off
// unless something can actually do damage, which is itself worth asserting —
// a game with no hazards should not pay two sprite tiles for a HUD.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { generateAssets } from '../../main/build/generate.js';
import { createProject, RPG_LIMITS } from '../../shared/project.js';
import { HEART_EMPTY_TILE, HEART_FULL_TILE } from '../../shared/font.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const hasRom = fs.existsSync(path.join(SAMPLE, 'build/game.nes'));

// Engine RAM, from engine/constants.asm.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const GAME_STATE = 0x25;
const DEFEATED = 0x27;
const BOX_STATE = 0x40;
const PLAYER_HP = 0x4e;
const PLAYER_IFRAMES = 0x4f;
const ENT_ACTIVE = 0x300;
const ENT_HP = 0x338;
const ENT_HURT = 0x388;
const SWITCHES = 0x390;
const VARIABLES = 0x500;
// The base addresses are this file's to know; how long each array is belongs to
// RPG_LIMITS, so a test that marked only the first 16 of 32 variables and called
// them all cleared cannot happen.
const SWITCH_BYTES = RPG_LIMITS.switches / 8;
const NUM_VARIABLES = RPG_LIMITS.variables;
const OAM = 0x200;

const ST_GAMEPLAY = 0;
const ST_TITLE = 3;
const ST_GAMEOVER = 4;
const BOX_ENDWAIT = 6;

const A = 0;
const B = 1;
const START = 3;

const START_X = 112;
const START_Y = 112;
const MAX_HEARTS = 3; // the schema default

function boot(romPath, frames = 30) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  // A cartridge with a title screen boots into it; every scenario here is about
  // the game behind it, so press through. `game_state` is ST_TITLE only when the
  // project actually has one, so this is a no-op for the ROMs that do not.
  if (nes.cpu.mem[0x25] === 3) {
    nes.buttonDown(1, 3);
    nes.frame();
    nes.buttonUp(1, 3);
    for (let i = 0; i < 12; i++) nes.frame();
  }
  return nes;
}

const tap = (nes, button, frames = 2) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
};

const run = (nes, frames) => {
  for (let i = 0; i < frames; i++) nes.frame();
};

/** Hold a direction until something happens, or give up. */
const walkUntil = (nes, button, predicate, budget = 120) => {
  nes.buttonDown(1, button);
  for (let i = 0; i < budget; i++) {
    nes.frame();
    if (predicate(nes)) break;
  }
  nes.buttonUp(1, button);
  return predicate(nes);
};

const RIGHT = 7;

/** Every heart tile in the sprite shadow, in slot order. */
const hudTiles = (nes) => {
  const out = [];
  for (let i = 0; i < 64; i++) {
    const tile = nes.cpu.mem[OAM + i * 4 + 1];
    if (nes.cpu.mem[OAM + i * 4] !== 0xff && (tile === HEART_FULL_TILE || tile === HEART_EMPTY_TILE)) {
      out.push(tile);
    }
  }
  return out;
};

async function buildWith(t, mutate) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-combat-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.maps[0].screens[0].entities = [];
  mutate(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return { project, nes: boot(built.romPath) };
}

/**
 * A static actor that hurts on contact. Placed clear of the player by default:
 * an actor already touching them at boot would have landed its hit before the
 * emulator finished warming up, and a test cannot assert on a starting state it
 * never observed.
 */
function spiker(project, damage, { x = START_X + 40, y = START_Y } = {}) {
  const id = project.sprites.actors.length;
  project.sprites.actors.push({
    ...structuredClone(project.sprites.actors[0]),
    id,
    name: 'Spiker',
    behavior: 'npc',
    hp: 1,
    damage
  });
  project.maps[0].screens[0].entities.push({ actorId: id, x, y, props: {} });
  return id;
}

// --- the conditional cost ---------------------------------------------------

test('a game with nothing dangerous in it pays for no hearts', async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-nocombat-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await generateAssets({ dir, project: createProject('Peaceful') });
  const config = await fs.promises.readFile(path.join(dir, 'build/assets/config.inc'), 'utf8');
  assert.match(config, /COMBAT_ENABLED = 0/);

  const chr = await fs.promises.readFile(path.join(dir, 'build/assets/tiles0.chr'));
  // The sprite table's own second half starts at 4096; the hearts live at its
  // last two tiles, which must still be blank.
  const heartsAt = 4096 + HEART_FULL_TILE * 16;
  assert.ok([...chr.slice(heartsAt, heartsAt + 32)].every((byte) => byte === 0), 'hearts were stamped anyway');
});

// --- taking damage ----------------------------------------------------------

test('touching something harmful costs one heart per invincible window', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // A chaser, because the window is only testable against something that keeps
  // touching you: knockback throws the player clear of a static hazard, so
  // standing still afterwards would prove nothing about invincibility.
  const { nes } = await buildWith(t, (project) => {
    // Far enough away that it is still crossing the screen when the emulator has
    // finished warming up, so the starting state is one the test can observe.
    const id = spiker(project, 1, { x: 224, y: START_Y });
    project.sprites.actors[id].behavior = 'chaser';
    project.sprites.actors[id].speed = 2;
  });

  assert.equal(nes.cpu.mem[PLAYER_HP], MAX_HEARTS, 'the session should start on full hearts');
  assert.deepEqual(hudTiles(nes), Array(MAX_HEARTS).fill(HEART_FULL_TILE), 'the HUD is not showing');

  /** Frames until the hearts next drop. */
  const untilHit = (budget = 200) => {
    const from = nes.cpu.mem[PLAYER_HP];
    for (let i = 0; i < budget; i++) {
      nes.frame();
      if (nes.cpu.mem[PLAYER_HP] < from) return i;
    }
    return -1;
  };

  assert.ok(untilHit() >= 0, 'the chaser never landed a hit');
  assert.equal(nes.cpu.mem[PLAYER_HP], MAX_HEARTS - 1, 'contact should cost exactly one heart');
  assert.ok(nes.cpu.mem[PLAYER_IFRAMES] > 0, 'contact did not grant invincibility');
  assert.deepEqual(
    hudTiles(nes),
    [HEART_FULL_TILE, HEART_FULL_TILE, HEART_EMPTY_TILE],
    'the HUD did not follow the hearts down'
  );

  // IFRAME_TIME is 60. The chaser is on top of the player throughout, so the
  // only thing that can be holding it off is the window.
  const gap = untilHit();
  assert.ok(gap >= 55, `a second heart went after only ${gap} frames; the window is 60`);
});

test('a Damage metatile hurts the player standing on it', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, (project) => {
    // Metatile 5 is unused by the sample's art; paint the player's own cell with it.
    project.metatiles[5] = { ...project.metatiles[5], name: 'Spikes', collision: 'damage', tiles: [7, 7, 7, 7] };
    const screen = project.maps[0].screens[0];
    const col = Math.floor((START_X + 8) / 16);
    const row = Math.floor((START_Y + 12) / 16);
    screen.metatiles[row * 16 + col] = 5;
  });

  run(nes, 4);
  assert.equal(nes.cpu.mem[PLAYER_HP], MAX_HEARTS - 1, 'standing on a Damage tile did not hurt');
  assert.ok(nes.cpu.mem[PLAYER_IFRAMES] > 0);
});

test('knockback throws the player clear of what hit them', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Reached from the left, so the throw has to be back to the left.
  const { nes } = await buildWith(t, (project) => spiker(project, 1));
  assert.ok(walkUntil(nes, RIGHT, (n) => n.cpu.mem[PLAYER_HP] < MAX_HEARTS));
  const onImpact = nes.cpu.mem[PLAYER_X];
  run(nes, 12); // the knockback lasts KNOCKBACK_TIME frames
  assert.ok(
    nes.cpu.mem[PLAYER_X] < onImpact,
    `hit from the right should throw the player left (${onImpact} -> ${nes.cpu.mem[PLAYER_X]})`
  );
});

// --- dealing damage ---------------------------------------------------------

test('an actor with three hit points takes three hits', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, (project) => {
    const id = spiker(project, 0, { x: START_X + 10, y: START_Y });
    project.sprites.actors[id].hp = 3;
  });

  assert.equal(nes.cpu.mem[ENT_HP], 3, 'the actor did not spawn with its hit points');

  // A hit while it is still flashing is refused, so each blow needs the flash to
  // lapse first — which is also what stops one button press killing anything.
  for (const expected of [2, 1, 0]) {
    while (nes.cpu.mem[ENT_HURT]) nes.frame();
    tap(nes, A);
    assert.equal(nes.cpu.mem[ENT_HP], expected, `hit should have left ${expected} hit points`);
  }
  assert.equal(nes.cpu.mem[ENT_ACTIVE], 0, 'the last hit should have beaten it');
  assert.equal(nes.cpu.mem[DEFEATED], 1);
});

test('a one-hit-point actor still dies to a single press', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, (project) => spiker(project, 0, { x: START_X + 10, y: START_Y }));
  tap(nes, A);
  assert.equal(nes.cpu.mem[ENT_ACTIVE], 0, 'the behaviour of an unhealthed actor must not have changed');
  assert.equal(nes.cpu.mem[DEFEATED], 1);
});

// --- dying ------------------------------------------------------------------

test('running out of hearts reaches game over, and Start goes back to the title', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, (project) => spiker(project, MAX_HEARTS));

  assert.ok(walkUntil(nes, RIGHT, (n) => n.cpu.mem[GAME_STATE] === ST_GAMEOVER), 'never died');
  assert.equal(nes.cpu.mem[PLAYER_HP], 0);

  // The world is frozen: the spiker cannot keep hitting a corpse.
  const frozenX = nes.cpu.mem[PLAYER_X];
  nes.buttonDown(1, RIGHT);
  run(nes, 30);
  nes.buttonUp(1, RIGHT);
  assert.equal(nes.cpu.mem[PLAYER_X], frozenX, 'the player moved on the game-over screen');

  // Wait for the message, then Start.
  for (let i = 0; i < 600 && nes.cpu.mem[BOX_STATE] !== BOX_ENDWAIT; i++) nes.frame();
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_ENDWAIT, 'the game-over message never finished');

  // A cartridge with a title goes back to it, which is what makes a title worth
  // having; one without goes straight into a new game, because there would be
  // nothing else to look at.
  tap(nes, START, 10);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_TITLE, 'Start on the game-over screen should reach the title');
  assert.equal(nes.cpu.mem[BOX_STATE], 0);

  tap(nes, START, 10);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'Start on the title did not begin a new game');
  assert.equal(nes.cpu.mem[PLAYER_HP], MAX_HEARTS, 'a new game should refill the hearts');
  assert.equal(nes.cpu.mem[PLAYER_X], START_X, 'a new game should start at the start position');
  assert.equal(nes.cpu.mem[PLAYER_Y], START_Y);
});

test('a restart clears the switches and the variables, so a one-time chest refills', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, (project) => {
    spiker(project, MAX_HEARTS);
  });

  // Both arrays are marked before dying, and marked from outside rather than
  // through an event: what is under test is `init_session`, not the route to it,
  // and a test that only checks they are zero afterwards would pass just as well
  // with the clearing loops deleted — they start at zero.
  nes.cpu.mem.fill(0xff, SWITCHES, SWITCHES + SWITCH_BYTES);
  nes.cpu.mem.fill(0x07, VARIABLES, VARIABLES + NUM_VARIABLES);

  assert.ok(walkUntil(nes, RIGHT, (n) => n.cpu.mem[GAME_STATE] === ST_GAMEOVER), 'never died');
  for (let i = 0; i < 600 && nes.cpu.mem[BOX_STATE] !== BOX_ENDWAIT; i++) nes.frame();
  tap(nes, START, 10); // to the title
  tap(nes, START, 10); // and into a new game
  assert.equal(nes.cpu.mem[PLAYER_HP], MAX_HEARTS, 'a new game should refill the hearts');
  assert.deepEqual(
    [...nes.cpu.mem.slice(SWITCHES, SWITCHES + SWITCH_BYTES)],
    Array(SWITCH_BYTES).fill(0),
    'the switches survived a restart'
  );
  assert.deepEqual(
    [...nes.cpu.mem.slice(VARIABLES, VARIABLES + NUM_VARIABLES)],
    Array(NUM_VARIABLES).fill(0),
    'the variables survived a restart'
  );
});

// --- scripted heal and damage ------------------------------------------------
//
// engine/combat.asm's gain_hearts/lose_hearts, reached from the field through
// OP_HEAL/OP_DAMAGE -- an npc's own event, not a hazard, so nothing here goes
// through hurt_player: no invincible window, no knockback.

/** A static npc, cloned off the sample's own actor 0 so it has real art. */
function teller(project, pages) {
  const id = project.sprites.actors.length;
  project.sprites.actors.push({
    ...structuredClone(project.sprites.actors[0]),
    id,
    name: 'Teller',
    behavior: 'npc',
    damage: 0
  });
  return { actorId: id, x: START_X, y: START_Y - 16, props: { event: { pages } } };
}

/** Talk (B), then press through every page until the conversation ends. */
function talkThrough(nes, budget = 20) {
  tap(nes, B);
  for (let press = 0; press < budget; press++) {
    if (nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) return true;
    for (let frame = 0; frame < 300; frame++) {
      if (nes.cpu.mem[BOX_STATE] === BOX_ENDWAIT || nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) break;
      nes.frame();
    }
    if (nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) return true;
    tap(nes, A);
    run(nes, 20);
  }
  return nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY;
}

test('scripted Heal and Damage change player_hp, saturating at the max', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const TOUCHED = 0;
  const { nes } = await buildWith(t, (project) => {
    project.maps[0].screens[0].entities.push(
      teller(project, [
        {
          cond: { type: 'switchOff', arg: TOUCHED },
          commands: [{ op: 'say', text: 'Ow.' }, { op: 'damage', value: 1 }, { op: 'setSwitch', switch: TOUCHED }]
        },
        { cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'There.' }, { op: 'heal', value: 255 }] }
      ])
    );
  });

  assert.equal(nes.cpu.mem[PLAYER_HP], MAX_HEARTS);
  assert.ok(talkThrough(nes), 'the first conversation never ended');
  assert.equal(nes.cpu.mem[PLAYER_HP], MAX_HEARTS - 1, 'Damage 1 should take exactly one heart');
  assert.equal(nes.cpu.mem[PLAYER_IFRAMES], 0, 'a scripted Damage should not grant an invincible window');

  assert.ok(talkThrough(nes), 'the second conversation never ended');
  assert.equal(nes.cpu.mem[PLAYER_HP], MAX_HEARTS, 'Heal 255 should be a full heal, saturating at the max');
});

test('a killing Damage reaches game over, and the rest of the page does not run', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const TOUCHED = 0;
  const { nes } = await buildWith(t, (project) => {
    project.maps[0].screens[0].entities.push(
      teller(project, [
        {
          cond: { type: 'none', arg: 0 },
          commands: [{ op: 'say', text: 'Ow.' }, { op: 'damage', value: MAX_HEARTS }, { op: 'setSwitch', switch: TOUCHED }]
        }
      ])
    );
  });

  tap(nes, B); // talk
  for (let i = 0; i < 300 && nes.cpu.mem[BOX_STATE] !== BOX_ENDWAIT; i++) nes.frame();
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_ENDWAIT, 'the line never finished');
  tap(nes, A); // dismiss -- resumes the script, and the killing Damage runs
  for (let i = 0; i < 300 && nes.cpu.mem[BOX_STATE] !== BOX_ENDWAIT; i++) nes.frame();

  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEOVER, 'a killing scripted Damage should reach game over');
  assert.equal(nes.cpu.mem[PLAYER_HP], 0);
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_ENDWAIT, 'the game-over message never finished');
  assert.equal(
    nes.cpu.mem[SWITCHES] & (1 << TOUCHED),
    0,
    'the command after the killing Damage ran on a dead session'
  );
});
