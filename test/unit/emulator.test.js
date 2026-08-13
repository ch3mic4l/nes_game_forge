import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PaletteTable from '../../renderer/emulator/core/ppu/palette-table.js';
import NES from '../../renderer/emulator/core/nes.js';
import { Emulator } from '../../renderer/emulator/runcontrol.js';
import { NES_PALETTE } from '../../shared/nespalette.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROM_PATH = path.join(ROOT, 'sample/build/game.nes');

test('the emulator renders with the same 64 colours the editors draw with', () => {
  // Upstream jsnes ships a hue-reversed table where $01 is red; the Forge patch
  // replaces it. See renderer/emulator/core/FORGE-PATCHES.md.
  const table = new PaletteTable();
  table.loadForgePalette();
  for (let index = 0; index < 64; index++) {
    const [r, g, b] = NES_PALETTE[index];
    assert.equal(
      table.getEntry(index) & 0xffffff,
      (r << 16) | (g << 8) | b,
      `NES colour $${index.toString(16).padStart(2, '0')} does not match the editor palette`
    );
  }
  // The specific entry that was wrong upstream: $01 is dark blue, not red.
  assert.equal(table.getEntry(0x01) & 0xffffff, 0x0000fc);
});

const hasRom = fs.existsSync(ROM_PATH);

test('the sample ROM boots and renders', { skip: !hasRom && 'run `npm run sample` first' }, () => {
  const rom = new Uint8Array(fs.readFileSync(ROM_PATH));
  let lastFrame = null;
  const nes = new NES({ onFrame: (buffer) => (lastFrame = buffer.slice()), emulateSound: false });
  nes.loadROM(rom);
  for (let i = 0; i < 20; i++) nes.frame();
  // A cartridge with a title screen boots into it; press through, because what
  // this asserts on is the game behind it.
  if (nes.cpu.mem[0x25] === 3) {
    nes.buttonDown(1, 3);
    nes.frame();
    nes.buttonUp(1, 3);
    for (let i = 0; i < 12; i++) nes.frame();
  }
  for (let i = 0; i < 4; i++) nes.frame();

  assert.ok(lastFrame, 'the PPU never emitted a frame');
  const distinct = new Set(lastFrame).size;
  assert.ok(distinct >= 3, `screen shows only ${distinct} colours, so it is probably blank`);

  // The engine drew a screen, so nametable 0 and the pattern tables hold data.
  assert.ok(nes.ppu.vramMem.subarray(0x2000, 0x2400).some((byte) => byte !== 0), 'nametable 0 is empty');
  assert.ok(nes.ppu.vramMem.subarray(0, 0x2000).some((byte) => byte !== 0), 'pattern tables are empty');

  // The sample's pond uses background palette 2, whose colour 1 is NES $01.
  const pondPixel = lastFrame[48 * 256 + 48] & 0xffffff;
  assert.equal(pondPixel, 0x0000fc, 'the sample pond should render as NES $01 dark blue');
});

test('the ⟳ Reset button leaves the ROM able to draw again', { skip: !hasRom && 'run `npm run sample` first' }, () => {
  const emulator = new Emulator({ onFrame: () => {} });
  emulator.loadROM(new Uint8Array(fs.readFileSync(ROM_PATH)));
  for (let i = 0; i < 20; i++) emulator.runFrame();

  // `nes.reset()` builds a new PPU, so everything `nes.loadROM` does *after*
  // its own reset has to be done again. Miss the mirroring and the nametables
  // are never allocated: the engine's first background write after a reset
  // throws from inside the PPU, which run control has to redo for itself
  // because it resets without going back through loadROM.
  emulator.reset();
  for (let i = 0; i < 30; i++) emulator.runFrame();
  assert.ok(
    emulator.nes.ppu.vramMem.subarray(0x2000, 0x2400).some((byte) => byte !== 0),
    'nothing was drawn after a reset'
  );
});

// Engine RAM layout, from engine/constants.asm.
const ENT_ACTIVE = 0x300;
const ENT_ACTOR = 0x308;
const ENT_X = 0x310;
const ENT_Y = 0x318;
const PICKUPS = 0x24;
const FLAT_SCREEN = 0x16;

function bootSample(frames = 30) {
  const rom = new Uint8Array(fs.readFileSync(ROM_PATH));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(rom);
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

const visibleSprites = (nes) => {
  let count = 0;
  for (let i = 0; i < 64; i++) if (nes.ppu.spriteMem[i * 4] < 0xef) count++;
  return count;
};

test('actors spawn and only their sprites are shown', { skip: !hasRom && 'run `npm run sample` first' }, () => {
  const nes = bootSample();
  assert.equal(nes.cpu.mem[ENT_ACTIVE], 1, 'the sample places one actor on the first screen');
  assert.equal(nes.cpu.mem[ENT_ACTIVE + 1], 0, 'no second actor should be active here');
  // Four sprites for the player, four for one 16x16 actor, and one per heart of
  // the HUD — the sample has something that can hurt you, so the health bar is
  // on. Everything else must be parked off-screen, which is what the
  // sprite-parking loop is for.
  const MAX_HEARTS = 3;
  assert.equal(visibleSprites(nes), 4 + 4 + MAX_HEARTS);
});

test('a patrolling actor moves and turns around', { skip: !hasRom && 'run `npm run sample` first' }, () => {
  const nes = bootSample();
  const startY = nes.cpu.mem[ENT_Y];
  const seen = new Set();
  let minimum = 255;
  let maximum = 0;
  for (let i = 0; i < 600; i++) {
    nes.frame();
    const y = nes.cpu.mem[ENT_Y];
    seen.add(y);
    minimum = Math.min(minimum, y);
    maximum = Math.max(maximum, y);
  }
  assert.ok(seen.size > 20, `the patroller barely moved (${seen.size} distinct positions)`);
  assert.ok(maximum > startY || minimum < startY, 'the patroller never left its start position');
  // It patrols within the screen rather than walking off it.
  assert.ok(minimum >= 0 && maximum <= 224, `patroller left the screen (${minimum}..${maximum})`);
});

test('walking into a pickup collects it', { skip: !hasRom && 'run `npm run sample` first' }, () => {
  const nes = bootSample();
  assert.equal(nes.cpu.mem[PICKUPS], 0);

  // Screen 2 (south-west) holds a gem. Walk down to reach it.
  nes.buttonDown(1, 5); // DOWN
  for (let i = 0; i < 220; i++) nes.frame();
  nes.buttonUp(1, 5);
  assert.equal(nes.cpu.mem[FLAT_SCREEN], 2, 'expected to be on the southern screen');

  // Find the gem slot, then steer the player onto it.
  let slot = -1;
  for (let i = 0; i < 8; i++) {
    if (nes.cpu.mem[ENT_ACTIVE + i] === 1 && nes.cpu.mem[ENT_ACTOR + i] === 1) slot = i;
  }
  assert.ok(slot >= 0, 'the gem actor did not spawn on this screen');

  for (let step = 0; step < 400 && nes.cpu.mem[PICKUPS] === 0; step++) {
    const gemX = nes.cpu.mem[ENT_X + slot];
    const gemY = nes.cpu.mem[ENT_Y + slot];
    const playerX = nes.cpu.mem[0x10];
    const playerY = nes.cpu.mem[0x11];
    const buttons = [];
    if (playerX < gemX - 1) buttons.push(7);
    else if (playerX > gemX + 1) buttons.push(6);
    if (playerY < gemY - 1) buttons.push(5);
    else if (playerY > gemY + 1) buttons.push(4);
    for (const button of buttons) nes.buttonDown(1, button);
    nes.frame();
    for (const button of buttons) nes.buttonUp(1, button);
  }

  assert.equal(nes.cpu.mem[PICKUPS], 1, 'the gem was never collected');
  assert.equal(nes.cpu.mem[ENT_ACTIVE + slot], 0, 'a collected pickup should deactivate');
});

test('controller input reaches the running game', { skip: !hasRom && 'run `npm run sample` first' }, () => {
  const rom = new Uint8Array(fs.readFileSync(ROM_PATH));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(rom);
  for (let i = 0; i < 20; i++) nes.frame();
  // A cartridge with a title screen boots into it; press through, because what
  // this asserts on is the game behind it.
  if (nes.cpu.mem[0x25] === 3) {
    nes.buttonDown(1, 3);
    nes.frame();
    nes.buttonUp(1, 3);
    for (let i = 0; i < 12; i++) nes.frame();
  }

  const PLAYER_X = 0x10; // engine/constants.asm
  const before = nes.cpu.mem[PLAYER_X];
  nes.buttonDown(1, 7); // BUTTON_RIGHT
  for (let i = 0; i < 30; i++) nes.frame();
  nes.buttonUp(1, 7);
  assert.ok(nes.cpu.mem[PLAYER_X] > before, `player x did not increase (${before} -> ${nes.cpu.mem[PLAYER_X]})`);
});
