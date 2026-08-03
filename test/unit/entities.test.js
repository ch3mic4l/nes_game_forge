import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { generateAssets } from '../../main/build/generate.js';
import { loadProject } from '../../main/project-io.js';
import { createProject, ACTIONS, BUTTONS, INPUT_STATES } from '../../shared/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const ROM_PATH = path.join(SAMPLE, 'build/game.nes');
const hasRom = fs.existsSync(ROM_PATH);

const FLAT_SCREEN = 0x16;
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const ENT_ACTIVE = 0x300;
const ENT_ACTOR = 0x308;
const ENT_DIR = 0x320;

function boot(frames = 30) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(ROM_PATH)));
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

const hold = (nes, buttons, frames) => {
  for (const button of buttons) nes.buttonDown(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
  for (const button of buttons) nes.buttonUp(1, button);
};

// --- the directional animation table ---------------------------------------

test('each actor gets one animation per facing, falling back to idle', async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-anim-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const project = createProject('Anim');
  project.sprites = {
    metasprites: [{ id: 0, name: 'A', tiles: [{ x: 0, y: 0, tile: 0, palette: 0, hflip: false, vflip: false }] }],
    animations: [
      { id: 0, name: 'idle', loop: true, frames: [{ metaspriteId: 0, duration: 8 }] },
      { id: 1, name: 'down', loop: true, frames: [{ metaspriteId: 0, duration: 8 }] },
      { id: 2, name: 'side', loop: true, frames: [{ metaspriteId: 0, duration: 8 }] }
    ],
    actors: [
      // walkUp is deliberately unset, so it must fall back to idle (0).
      { id: 0, name: 'Full', behavior: 'patroller', speed: 1, hp: 1, anims: { idle: 0, walkDown: 1, walkSide: 2 } },
      // No animations at all: every facing must read as "draw nothing".
      { id: 1, name: 'Bare', behavior: 'pickup', speed: 1, hp: 1, anims: {} }
    ]
  };

  await generateAssets({ dir, project });
  const text = await fs.promises.readFile(path.join(dir, 'build/assets/sprites.inc'), 'utf8');
  const table = /actor_anim_dir:\n((?:\s*\.db .*\n?)+)/.exec(text)[1];
  const rows = table
    .trim()
    .split('\n')
    .map((line) => line.replace(/\s*\.db\s*/, '').split(',').map((value) => parseInt(value.replace('$', ''), 16)));

  // Order is down, up, left, right.
  assert.deepEqual(rows[0], [1, 0, 2, 2], 'walkUp should fall back to idle; left and right share walkSide');
  assert.deepEqual(rows[1], [0xff, 0xff, 0xff, 0xff], 'an actor with no animations is $FF everywhere');
});

test('the button table has one row per game state, in INPUT_STATES order', async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-input-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  // The row order is the wire format: the engine indexes this table with
  // `game_state * NUM_BUTTONS`, so a row appearing anywhere but the end would
  // silently rebind every state after it.
  const project = createProject('Input');
  project.input.states.gameplay.A = 'dash';
  await generateAssets({ dir, project });

  const text = await fs.promises.readFile(path.join(dir, 'build/assets/input.inc'), 'utf8');
  const rows = /input_actions:\n((?:\s*\.db .*\n?)+)/
    .exec(text)[1]
    .trim()
    .split('\n')
    .map((line) => line.replace(/\s*\.db\s*/, '').split(',').map((value) => parseInt(value.replace('$', ''), 16)));

  assert.equal(rows.length, INPUT_STATES.length);
  for (const row of rows) assert.equal(row.length, BUTTONS.length);
  const actionIndex = (id) => ACTIONS.findIndex((entry) => entry.id === id);
  assert.equal(rows[INPUT_STATES.indexOf('gameplay')][0], actionIndex('dash'));
  assert.equal(rows[INPUT_STATES.indexOf('title')][BUTTONS.indexOf('START')], actionIndex('confirm'));
});

// --- doors ------------------------------------------------------------------

test('a door warps the player to its target', { skip: !hasRom && 'run `npm run sample` first' }, () => {
  const nes = boot();
  const M = (address) => nes.cpu.mem[address];

  // The sample's portal sits at the foot of the corridor on the south-east
  // screen and leads back to the middle of the first screen.
  hold(nes, [4], 16); // up into the east-west corridor
  hold(nes, [7], 120); // right, into the north-east screen
  assert.equal(M(FLAT_SCREEN), 1, 'expected to reach the north-east screen');

  let steps = 0;
  while (M(FLAT_SCREEN) !== 0 && steps < 400) {
    hold(nes, [5], 1);
    steps++;
  }

  assert.equal(M(FLAT_SCREEN), 0, 'the door never fired');
  assert.equal(M(PLAYER_X), 112, 'the door should land the player at its target x');
  assert.equal(M(PLAYER_Y), 112, 'the door should land the player at its target y');
});

test('a door target that no longer exists is ignored', { skip: !hasRom && 'run `npm run sample` first' }, () => {
  // take_door refuses a screen index past the end rather than reading garbage
  // pointers, which is what a deleted screen would leave behind.
  const nes = boot();
  const rom = fs.readFileSync(ROM_PATH);
  assert.ok(rom.length > 0);
  // Drive the engine straight at the guard by poking an impossible target.
  nes.cpu.mem[0x2e] = 1; // warp_ready
  nes.cpu.mem[0x2f] = 0xfe; // warp_scr, far past NUM_SCREENS
  const before = nes.cpu.mem[FLAT_SCREEN];
  for (let i = 0; i < 4; i++) nes.frame();
  assert.equal(nes.cpu.mem[FLAT_SCREEN], before, 'an out-of-range door should leave the screen alone');
});

// --- facing ------------------------------------------------------------------

test('a chaser faces the axis it is furthest away on', { skip: !hasRom && 'run `npm run sample` first' }, () => {
  const nes = boot();
  const M = (address) => nes.cpu.mem[address];

  const mirroredSprites = () => {
    let count = 0;
    for (let i = 4; i < 16; i++) {
      if (nes.ppu.spriteMem[i * 4] < 0xef && nes.ppu.spriteMem[i * 4 + 2] & 0x40) count++;
    }
    return count;
  };

  const facings = new Set();
  let mirroredFrames = 0;
  let slot = -1;

  nes.buttonDown(1, 5); // walk south into the screen holding the chaser
  for (let i = 0; i < 400; i++) {
    nes.frame();
    if (M(FLAT_SCREEN) !== 2) continue;
    if (slot < 0) {
      for (let k = 0; k < 8; k++) if (M(ENT_ACTIVE + k) === 1 && M(ENT_ACTOR + k) === 2) slot = k;
    }
    if (slot < 0) continue;
    facings.add(M(ENT_DIR + slot));
    if (mirroredSprites() > 0) mirroredFrames++;
  }
  nes.buttonUp(1, 5);

  assert.ok(slot >= 0, 'the chaser never spawned');
  // Setting the facing inside each movement branch used to let the vertical
  // pass overwrite the horizontal one, so a chaser only ever faced up or down.
  assert.ok(
    facings.has(2) || facings.has(3),
    `the chaser never faced sideways (saw ${[...facings].join(',')})`
  );
  assert.ok(facings.has(0) || facings.has(1), 'the chaser never faced vertically');
  assert.ok(mirroredFrames > 0, 'the sideways animation was never drawn');
});
