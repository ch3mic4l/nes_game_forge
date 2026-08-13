// Play from here — starting the player somewhere other than the project's own
// ⚑ Start, for testing a screen without walking to it.
//
// Four claims are worth pinning down. The addresses come from
// engine/constants.asm rather than a copy of it in JavaScript, so renaming or
// moving one of those bytes has to fail here rather than in the app. The
// override goes through the engine's own door, so it lands on the screen it
// asked for even on a cartridge that boots into a title screen. Getting there
// costs one tick of the world at the authored start, and that tick has to leave
// no trace — a pickup sitting on the start square is the cheapest thing that
// would prove otherwise. And it is only ever RAM: the ROM the emulator runs is
// the file on disk, byte for byte, which is what keeps a test-play shortcut out
// of anything the user could ship.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEquates, missingEquates } from '../../shared/enginesyms.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { Emulator, BUTTON } from '../../renderer/emulator/runcontrol.js';
import {
  applyStartOverride,
  startOverrideProblem,
  MAIN_LOOP,
  MAIN_LOOP_WARP,
  REQUIRED_RAM
} from '../../renderer/emulator/testplay.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { LIMITS } from '../../shared/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const ROM = path.join(SAMPLE, 'build/game.nes');
const hasRom = fs.existsSync(ROM);

const engineConstants = () => parseEquates(fs.readFileSync(path.join(ROOT, 'engine/constants.asm'), 'utf8'));

// Greenwood is a 2x2 map and the title is the map after it, so flat screen 3 is
// the far corner of the world: not where the cartridge starts, and not the
// screen it boots into either.
const TARGET_SCREEN = 3;
const TARGET_X = 48;
const TARGET_Y = 64;

/** The sample ROM in a fresh emulator, with the constants and labels it was built with. */
function loaded() {
  const rom = new Uint8Array(fs.readFileSync(ROM));
  const emulator = new Emulator({ onFrame: () => {} });
  emulator.loadROM(rom);
  return {
    emulator,
    rom,
    build: {
      ram: parseEquates(fs.readFileSync(path.join(SAMPLE, 'build/constants.asm'), 'utf8')),
      symbols: parseSymbolFile(fs.readFileSync(path.join(SAMPLE, 'build/game.fns'), 'utf8'))
    }
  };
}

const GEM = 1; // the sample's pickup actor
// The metatile the player is standing on at the authored start: player_hazard
// probes 8 right and 12 down of the player's corner, which at 112,112 is
// column 7, row 7.
const START_CELL = 7 * LIMITS.screenCols + 7;

/**
 * The sample, tweaked and built into a temp directory. Reaching the point where
 * a door is decided means running one tick of the world at the player's start,
 * so every variant here is a way of making that tick leave a mark if it can.
 *
 * No title screen in any of them: boot then spawns the *start* screen's actors,
 * which is what puts anything underfoot at all. On a title cartridge the actors
 * present at that moment are the title's — that is to say none — and these
 * tests would pass without proving anything.
 */
async function builtVariant(t, tweak) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-testplay-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  project.project.titleMap = null;
  tweak(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const emulator = new Emulator({ onFrame: () => {} });
  emulator.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
  return {
    emulator,
    project,
    build: {
      ram: parseEquates(fs.readFileSync(path.join(dir, 'build/constants.asm'), 'utf8')),
      symbols: parseSymbolFile(fs.readFileSync(built.symbolPath, 'utf8'))
    }
  };
}

test('the engine still defines every name the override pokes', () => {
  const ram = engineConstants();
  assert.deepEqual(missingEquates(ram, REQUIRED_RAM), []);
  // Two spot values, so a parser that returned an empty object could not pass
  // the check above by accident.
  assert.equal(ram.player_x, 0x10);
  assert.equal(ram.warp_ready, 0x2e);
});

test('a missing address is reported rather than poked', () => {
  const ram = engineConstants();
  const symbols = { [MAIN_LOOP]: 0xc31d, [MAIN_LOOP_WARP]: 0xc339 };
  assert.equal(startOverrideProblem({ ram, symbols }), null);
  assert.match(startOverrideProblem({ ram: null, symbols }), /could not be read/);
  assert.match(startOverrideProblem({ ram, symbols: {} }), new RegExp(MAIN_LOOP));
  assert.match(
    startOverrideProblem({ ram, symbols: { [MAIN_LOOP]: 0xc31d } }),
    new RegExp(MAIN_LOOP_WARP)
  );

  const { warp_scr, ...withoutWarp } = ram;
  assert.match(startOverrideProblem({ ram: withoutWarp, symbols }), /warp_scr/);
});

test('play from here lands on the screen it asked for', { skip: !hasRom && 'sample ROM not built' }, () => {
  const { emulator, build } = loaded();
  applyStartOverride(emulator, { screen: TARGET_SCREEN, x: TARGET_X, y: TARGET_Y }, build);

  const { ram } = build;
  assert.equal(emulator.peek(ram.flat_screen), TARGET_SCREEN);
  assert.equal(emulator.peek(ram.player_x), TARGET_X);
  assert.equal(emulator.peek(ram.player_y), TARGET_Y);
  // The engine consumed the door rather than the override merely parking the
  // request: take_door clears the flag as its first act, and it is what
  // redraws the screen and respawns its actors.
  assert.equal(emulator.peek(ram.warp_ready), 0);

  // And the world really is that screen, which the counter alone would not
  // show: these are the actors Greenwood's far corner is holding, where the
  // screen the cartridge starts on has one.
  const spawned = [];
  for (let slot = 0; slot < ram.MAX_ENTITIES; slot++) {
    if (emulator.peek(ram.ent_active + slot)) spawned.push(emulator.peek(ram.ent_actor + slot));
  }
  assert.deepEqual(spawned, [1, 5, 3]);
});

test('nothing on the start square is picked up on the way past', { skip: !hasRom && 'sample ROM not built' }, async (t) => {
  const { emulator, build } = await builtVariant(t, (project) => {
    project.maps[0].screens[0].entities = [
      { actorId: GEM, x: project.project.startX, y: project.project.startY, props: {} }
    ];
  });
  const { ram } = build;

  applyStartOverride(emulator, { screen: TARGET_SCREEN, x: TARGET_X, y: TARGET_Y }, build);
  assert.equal(emulator.peek(ram.flat_screen), TARGET_SCREEN);
  assert.equal(emulator.peek(ram.pickups), 0, 'the gem on the start square was collected on the way past');
  assert.equal(emulator.peek(ram.inv_count), 0, 'the bag picked something up on the way past');

  // ...and the gem really is collectable, so the assertions above are about the
  // override rather than about a project where nothing could have happened.
  emulator.reset();
  for (let frame = 0; frame < 20; frame++) emulator.runFrame();
  assert.equal(emulator.peek(ram.pickups), 1, 'booting normally should have collected the gem');
});

test('a hazard on the start square costs no health on the way past', { skip: !hasRom && 'sample ROM not built' }, async (t) => {
  const { emulator, build, project } = await builtVariant(t, (draft) => {
    // The floor the player stands on at the start, turned to spikes. A metatile
    // is global, so this is one edit rather than one per screen.
    const underfoot = draft.maps[0].screens[0].metatiles[START_CELL];
    draft.metatiles[underfoot].collision = 'damage';
  });
  const { ram } = build;
  // What a new game starts with — read from the project, not from RAM, which is
  // still all zeroes until the cartridge has booted.
  const hearts = project.project.maxHearts;

  applyStartOverride(emulator, { screen: TARGET_SCREEN, x: TARGET_X, y: TARGET_Y }, build);
  assert.equal(emulator.peek(ram.flat_screen), TARGET_SCREEN);
  assert.equal(emulator.peek(ram.player_hp), hearts, 'the spikes at the start took a heart on the way past');
  // The invincible frames the override borrowed to arrange that are handed back,
  // or the test play would begin with a free run through everything hostile.
  assert.equal(emulator.peek(ram.player_iframes), 0);

  // And the spikes are real: booting normally onto them costs a heart.
  emulator.reset();
  for (let frame = 0; frame < 20; frame++) emulator.runFrame();
  assert.ok(
    emulator.peek(ram.player_hp) < hearts,
    `booting normally onto the spikes should have hurt, but health is still ${emulator.peek(ram.player_hp)}`
  );
});

test('it plays past a title screen', { skip: !hasRom && 'sample ROM not built' }, () => {
  const { emulator, build } = loaded();
  // The sample boots into its title, and every state but gameplay freezes the
  // world -- so a start override that did not skip it would sit unconsumed.
  applyStartOverride(emulator, { screen: TARGET_SCREEN, x: TARGET_X, y: TARGET_Y }, build);
  assert.equal(emulator.peek(build.ram.game_state), build.ram.ST_GAMEPLAY);
});

test('it leaves the screen drawn and the machine presentable', { skip: !hasRom && 'sample ROM not built' }, () => {
  const { emulator, build } = loaded();
  applyStartOverride(emulator, { screen: TARGET_SCREEN, x: TARGET_X, y: TARGET_Y }, build);

  // The redraw drives the PPU under forced blank, so returning part-way through
  // it would hand the player a black screen and a disabled NMI. Coming back at
  // the top of the loop is what rules that out: PPUCTRL_ON and PPUMASK_ON, from
  // engine/constants.asm, are back in the registers by then.
  assert.equal(emulator.nes.cpu.mem[0x2000], 0x88);
  assert.equal(emulator.nes.cpu.mem[0x2001], 0x1e);
});

test('the same ROM still boots where the project says', { skip: !hasRom && 'sample ROM not built' }, () => {
  const { emulator, rom, build } = loaded();
  const before = fs.readFileSync(ROM);
  applyStartOverride(emulator, { screen: TARGET_SCREEN, x: TARGET_X, y: TARGET_Y }, build);

  // Nothing was patched: neither the image handed to the emulator nor the file
  // it came from.
  assert.deepEqual(Buffer.from(rom), before);
  assert.deepEqual(fs.readFileSync(ROM), before);

  // And the cartridge proves it for itself. Reset is all it takes to get the
  // game the user would ship: its own title screen, and the player back at the
  // start the Map Forge authored.
  emulator.reset();
  for (let frame = 0; frame < 30; frame++) emulator.runFrame();
  const { ram } = build;
  assert.equal(emulator.peek(ram.game_state), 3); // ST_TITLE: the sample has one
  assert.equal(emulator.peek(ram.player_x), 112); // sample/project.json's startX
  assert.equal(emulator.peek(ram.player_y), 112);
});
