import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { generateAssets } from '../../main/build/generate.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createProject, ACTIONS, BUTTONS, INPUT_STATES, PLAYER_TILES } from '../../shared/project.js';
import { finishNamingIfOpen } from '../lib/naming.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const ROM_PATH = path.join(SAMPLE, 'build/game.nes');
const hasRom = fs.existsSync(ROM_PATH);

const FLAT_SCREEN = 0x16;
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const ENT_ACTIVE = 0x300;
const ENT_ACTOR = 0x308;
const ENT_X = 0x310; // from engine/constants.asm
const ENT_Y = 0x318; // from engine/constants.asm
const ENT_DIR = 0x320;
// DIR_DOWN/DIR_UP/DIR_LEFT/DIR_RIGHT, from engine/constants.asm
const DIR_DOWN = 0;
const DIR_UP = 1;
const DIR_LEFT = 2;
const DIR_RIGHT = 3;

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
  // sample now has hero naming on (docs/design-name-entry.md v16.4 §17 item
  // 5); Start lands in the grid, and finishNamingIfOpen is a no-op when
  // naming is off, so this is safe unconditionally.
  finishNamingIfOpen(nes);
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
    // playerParts/playerTiles preserved as createProject's own defaults --
    // this test replaces the rest of sprites wholesale, but generateAssets'
    // per-slot player stamp (design-modular-parts.md §4.3) now reads
    // project.sprites.playerTiles unconditionally on every build, so it must
    // stay a real, normalized 32-entry array here too.
    playerParts: [],
    playerTiles: Array(PLAYER_TILES).fill(null),
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

// entity_animation (engine/entities.asm) and draw_actor_icon (engine/ui.asm)
// both used to compute actor*4 in one 8-bit accumulator (asl a; asl a), which
// silently wraps at actor id 64 (64*4 = 256 mod 256 = 0) and aliases actor 0's
// own animation row -- LIMITS.actors is 255, so a 65-actor project is legal
// and this is genuinely reachable, not merely theoretical. Two placements,
// each with its own distinct tile, so a wrap shows up as the WRONG tile
// (actor 0's own, or none at all) rather than merely "nothing changed".
test('an actor at id 64 draws its own animation row, not actor 0 wrapped around', async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-actor64-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const project = createProject('ActorBoundary');
  const metasprite = (id, tile) => ({
    id,
    name: `m${id}`,
    tiles: [{ x: 0, y: 0, tile, palette: 0, hflip: false, vflip: false }]
  });
  const anim = (id, metaspriteId) => ({ id, name: `a${id}`, loop: true, frames: [{ metaspriteId, duration: 8 }] });

  // Three distinct tiles: actor 0's own (a live control -- proves the fixture
  // itself draws entities at all), and the two boundary actors either side of
  // the wrap.
  project.sprites.metasprites = [metasprite(0, 200), metasprite(1, 63), metasprite(2, 64)];
  project.sprites.animations = [anim(0, 0), anim(1, 1), anim(2, 2)];

  const actors = [{ id: 0, name: 'Zero', behavior: 'npc', speed: 1, hp: 1, anims: { walkDown: 0 } }];
  for (let id = 1; id < 63; id++) {
    actors.push({ id, name: `Filler${id}`, behavior: 'npc', speed: 1, hp: 1, anims: {} });
  }
  actors.push({ id: 63, name: 'Boundary63', behavior: 'npc', speed: 1, hp: 1, anims: { walkDown: 1 } });
  actors.push({ id: 64, name: 'Boundary64', behavior: 'npc', speed: 1, hp: 1, anims: { walkDown: 2 } });
  project.sprites.actors = actors;

  const screen = project.maps[0].screens[0];
  screen.entities.push({ actorId: 0, x: 40, y: 100, props: {} });
  screen.entities.push({ actorId: 63, x: 80, y: 100, props: {} });
  screen.entities.push({ actorId: 64, x: 120, y: 100, props: {} });

  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
  for (let i = 0; i < 20; i++) nes.frame();

  const drawnTiles = new Set();
  for (let i = 0; i < 64; i++) {
    const y = nes.ppu.spriteMem[i * 4];
    if (y >= 0xef) continue; // parked slot
    drawnTiles.add(nes.ppu.spriteMem[i * 4 + 1]);
  }

  assert.ok(drawnTiles.has(200), 'actor 0 should draw its own tile -- the fixture itself must be live');
  assert.ok(drawnTiles.has(63), 'actor 63 (the last one before the wrap) should draw its own tile');
  assert.ok(
    drawnTiles.has(64),
    'actor 64 should draw its own animation row (tile 64) -- an 8-bit actor*4 wraps at 64 ' +
      '(64*4=256, mod 256=0) and aliases actor 0, which would draw tile 200 here instead'
  );
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

  // The nameentry row exists only when the project actually opts into naming
  // (docs/design-name-entry.md §4, Y1) -- a naming-off project (this one)
  // still gets only INPUT_STATES.length - 1 rows, so every naming-off
  // project ever built keeps its input table byte-identical.
  assert.equal(rows.length, INPUT_STATES.length - 1);
  for (const row of rows) assert.equal(row.length, BUTTONS.length);
  const actionIndex = (id) => ACTIONS.findIndex((entry) => entry.id === id);
  assert.equal(rows[INPUT_STATES.indexOf('gameplay')][0], actionIndex('dash'));
  assert.equal(rows[INPUT_STATES.indexOf('title')][BUTTONS.indexOf('START')], actionIndex('confirm'));
});

test('the button table gains a nameentry row, in order, once the project opts into naming', async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-input-naming-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const project = createProject('Input naming');
  project.party[0].renamable = true;
  await generateAssets({ dir, project });

  const text = await fs.promises.readFile(path.join(dir, 'build/assets/input.inc'), 'utf8');
  const rows = /input_actions:\n((?:\s*\.db .*\n?)+)/
    .exec(text)[1]
    .trim()
    .split('\n')
    .map((line) => line.replace(/\s*\.db\s*/, '').split(',').map((value) => parseInt(value.replace('$', ''), 16)));

  assert.equal(rows.length, INPUT_STATES.length, 'a naming-on project should get the full row count, nameentry included');
  assert.equal(INPUT_STATES[INPUT_STATES.length - 1], 'nameentry', 'nameentry must be the last, appended row');
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

  let slot = -1;

  nes.buttonDown(1, 5); // walk south into the screen holding the chaser
  for (let i = 0; i < 400 && slot < 0; i++) {
    nes.frame();
    if (M(FLAT_SCREEN) !== 2) continue;
    for (let k = 0; k < 8; k++) if (M(ENT_ACTIVE + k) === 1 && M(ENT_ACTOR + k) === 2) slot = k;
  }
  nes.buttonUp(1, 5);
  nes.frame(); // let the button release settle before the controlled poking below
  assert.ok(slot >= 0, 'the chaser never spawned');

  // Controlled geometry, not the loose "collect every facing seen over a
  // real chase" this replaces: that only ever proved every direction is
  // reachable, never which axis actually won a given decision, so inverting
  // entity_chase's own `bcc entity_chase_face_side` (so it faces the NEARER
  // axis instead of the further one -- engine/entities.asm's own header
  // comment states the intended rule) still passed. This poses one exact
  // frame at a time: pokes player_x/y and the chaser's own ent_x/y directly
  // (PLAYER_X/PLAYER_Y and ENT_X/ENT_Y,x, both engine/constants.asm),
  // releases every button first so nothing but entity_chase's own decision
  // can move either of them, runs exactly one frame (update_entities calls
  // entity_chase unconditionally, once per active BEH_CHASE entity, every
  // frame -- no timer or randomness gates it), and reads ent_dir back.
  const ENT_BASE_X = 100;
  const ENT_BASE_Y = 100;
  const MARGIN = 80; // the large axis
  const SHORT = 10; // the short axis, comfortably nonzero so a tie is never accidental

  // Two frames, not one: draw_entities builds this frame's sprite OAM from
  // LAST frame's ent_dir (drawing runs before update_entities within
  // main_loop), so the mirrored-sprite checks below would see the previous
  // decision, not this one, off a single frame. The pose is re-pinned
  // before the second frame too, so the one-pixel step entity_chase's own
  // movement half takes between the two frames cannot shift the geometry
  // enough to change which axis wins.
  function poseAndStep(playerX, playerY) {
    nes.cpu.mem[ENT_X + slot] = ENT_BASE_X;
    nes.cpu.mem[ENT_Y + slot] = ENT_BASE_Y;
    nes.cpu.mem[PLAYER_X] = playerX;
    nes.cpu.mem[PLAYER_Y] = playerY;
    nes.frame();
    nes.cpu.mem[ENT_X + slot] = ENT_BASE_X;
    nes.cpu.mem[ENT_Y + slot] = ENT_BASE_Y;
    nes.cpu.mem[PLAYER_X] = playerX;
    nes.cpu.mem[PLAYER_Y] = playerY;
    nes.frame();
    return nes.cpu.mem[ENT_DIR + slot];
  }

  // |dx| > |dy|: faces horizontal, sign of dx -- and the sideways
  // (mirrored, per the original claim this rewrite otherwise drops) sprite
  // animation actually gets drawn for it.
  assert.equal(
    poseAndStep(ENT_BASE_X + MARGIN, ENT_BASE_Y + SHORT),
    DIR_RIGHT,
    'player clearly to the right (and only slightly below) should face the chaser right'
  );
  assert.ok(mirroredSprites() > 0, 'the mirrored sideways animation was never drawn while facing right');
  assert.equal(
    poseAndStep(ENT_BASE_X - MARGIN, ENT_BASE_Y + SHORT),
    DIR_LEFT,
    'player clearly to the left (and only slightly below) should face the chaser left'
  );
  assert.ok(mirroredSprites() > 0, 'the mirrored sideways animation was never drawn while facing left');

  // |dy| > |dx|: faces vertical, sign of dy.
  assert.equal(
    poseAndStep(ENT_BASE_X + SHORT, ENT_BASE_Y + MARGIN),
    DIR_DOWN,
    'player clearly below (and only slightly right) should face the chaser down'
  );
  assert.equal(
    poseAndStep(ENT_BASE_X + SHORT, ENT_BASE_Y - MARGIN),
    DIR_UP,
    'player clearly above (and only slightly right) should face the chaser up'
  );

  // The tie: entity_chase's own `cmp chase_dx` after storing chase_dy leaves
  // the carry set (not clear) when the two distances are equal, so `bcc
  // entity_chase_face_side` is NOT taken -- a tie falls through to the
  // vertical branch, not the horizontal one. Asserted explicitly here, not
  // left implicit: player equally offset on both axes, below and to the
  // right, should face down.
  assert.equal(
    poseAndStep(ENT_BASE_X + MARGIN, ENT_BASE_Y + MARGIN),
    DIR_DOWN,
    'a tied distance on both axes should face the chaser vertically (down here), per entity_chase\'s own policy'
  );
});
