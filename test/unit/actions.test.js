import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const ROM_PATH = path.join(SAMPLE, 'build/game.nes');
const hasRom = fs.existsSync(ROM_PATH);

// Engine RAM, from engine/constants.asm.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const PICKUPS = 0x24;
const PAUSED = 0x26;
const DEFEATED = 0x27;
const ENT_ACTIVE = 0x300;
const ENT_ACTOR = 0x308;
const ENT_X = 0x310;
const ENT_Y = 0x318;

// jsnes button numbers.
const A = 0;
const B = 1;
const SELECT = 2;
const START = 3;
const UP = 4;
const DOWN = 5;
const LEFT = 6;
const RIGHT = 7;

function boot(romPath = ROM_PATH, frames = 30) {
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

/** Steer the player onto a target position; returns true if it got there. */
function walkTo(nes, targetX, targetY, budget = 400) {
  for (let step = 0; step < budget; step++) {
    const x = nes.cpu.mem[PLAYER_X];
    const y = nes.cpu.mem[PLAYER_Y];
    const buttons = [];
    if (x < targetX - 2) buttons.push(RIGHT);
    else if (x > targetX + 2) buttons.push(LEFT);
    if (y < targetY - 2) buttons.push(DOWN);
    else if (y > targetY + 2) buttons.push(UP);
    if (!buttons.length) return true;
    for (const button of buttons) nes.buttonDown(1, button);
    nes.frame();
    for (const button of buttons) nes.buttonUp(1, button);
  }
  return false;
}

/** Chase an actor's live position — a patroller keeps moving while we approach. */
function walkToEntity(nes, slot, budget = 400) {
  for (let step = 0; step < budget; step++) {
    const targetX = nes.cpu.mem[ENT_X + slot];
    const targetY = nes.cpu.mem[ENT_Y + slot];
    const x = nes.cpu.mem[PLAYER_X];
    const y = nes.cpu.mem[PLAYER_Y];
    const buttons = [];
    if (x < targetX - 2) buttons.push(RIGHT);
    else if (x > targetX + 2) buttons.push(LEFT);
    if (y < targetY - 2) buttons.push(DOWN);
    else if (y > targetY + 2) buttons.push(UP);
    if (!buttons.length) return true;
    for (const button of buttons) nes.buttonDown(1, button);
    nes.frame();
    for (const button of buttons) nes.buttonUp(1, button);
  }
  return false;
}

test('attack beats a nearby actor', { skip: !hasRom && 'run `npm run sample` first' }, () => {
  const nes = boot();
  assert.equal(nes.cpu.mem[ENT_ACTIVE], 1, 'the slime should be on this screen');
  assert.ok(walkToEntity(nes, 0), 'could not reach the slime');

  tap(nes, A); // A is bound to attack by default
  assert.equal(nes.cpu.mem[ENT_ACTIVE], 0, 'the slime survived the attack');
  assert.equal(nes.cpu.mem[DEFEATED], 1);
});

test('attack ignores pickups, which interact collects at a distance', {
  skip: !hasRom && 'run `npm run sample` first'
}, () => {
  const nes = boot();
  nes.buttonDown(1, DOWN);
  for (let i = 0; i < 220; i++) nes.frame();
  nes.buttonUp(1, DOWN);

  let gem = -1;
  for (let i = 0; i < 8; i++) {
    if (nes.cpu.mem[ENT_ACTIVE + i] === 1 && nes.cpu.mem[ENT_ACTOR + i] === 1) gem = i;
  }
  assert.ok(gem >= 0, 'the gem did not spawn');

  // Stop short of touching it, so only the action's reach can collect it.
  assert.ok(walkTo(nes, nes.cpu.mem[ENT_X + gem], nes.cpu.mem[ENT_Y + gem] + 16), 'could not approach the gem');
  assert.equal(nes.cpu.mem[PICKUPS], 0, 'walking near should not collect it on its own');

  tap(nes, A); // attack must leave pickups alone
  assert.equal(nes.cpu.mem[ENT_ACTIVE + gem], 1, 'attack should not destroy a pickup');
  assert.equal(nes.cpu.mem[PICKUPS], 0);

  tap(nes, B); // B is bound to interact
  assert.equal(nes.cpu.mem[PICKUPS], 1, 'interact did not collect the gem');
  assert.equal(nes.cpu.mem[ENT_ACTIVE + gem], 0);
});

test('pause freezes the player and resumes', { skip: !hasRom && 'run `npm run sample` first' }, () => {
  const nes = boot();
  tap(nes, START); // START is bound to pause
  assert.equal(nes.cpu.mem[PAUSED], 1);

  const frozenY = nes.cpu.mem[PLAYER_Y];
  nes.buttonDown(1, DOWN);
  for (let i = 0; i < 40; i++) nes.frame();
  nes.buttonUp(1, DOWN);
  assert.equal(nes.cpu.mem[PLAYER_Y], frozenY, 'the player moved while paused');

  tap(nes, START);
  assert.equal(nes.cpu.mem[PAUSED], 0);
  nes.buttonDown(1, DOWN);
  for (let i = 0; i < 20; i++) nes.frame();
  nes.buttonUp(1, DOWN);
  assert.ok(nes.cpu.mem[PLAYER_Y] > frozenY, 'the player did not resume moving');
});

// Rebuilding with a different mapping is the real proof that the button table
// is data the Controller Forge owns, rather than something baked into the engine.
test('rebinding a button changes what it does in the ROM', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-input-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const project = await loadProject(SAMPLE);
  project.input.states.gameplay.A = 'dash';
  project.input.states.gameplay.B = 'pause';
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = boot(built.romPath);

  // A is now dash: holding it should cover more ground than walking.
  const startX = nes.cpu.mem[PLAYER_X];
  nes.buttonDown(1, RIGHT);
  for (let i = 0; i < 10; i++) nes.frame();
  nes.buttonUp(1, RIGHT);
  const walked = nes.cpu.mem[PLAYER_X] - startX;

  const dashStart = nes.cpu.mem[PLAYER_X];
  nes.buttonDown(1, RIGHT);
  nes.buttonDown(1, A);
  for (let i = 0; i < 10; i++) nes.frame();
  nes.buttonUp(1, RIGHT);
  nes.buttonUp(1, A);
  const dashed = nes.cpu.mem[PLAYER_X] - dashStart;

  assert.ok(walked > 0, 'the player did not walk at all');
  assert.ok(dashed > walked, `dashing (${dashed}px) should outrun walking (${walked}px)`);
  assert.equal(nes.cpu.mem[DEFEATED], 0, 'A should no longer attack once rebound to dash');

  // B is now pause.
  tap(nes, B);
  assert.equal(nes.cpu.mem[PAUSED], 1, 'B should pause after rebinding');
});
