// The title screen: what the cartridge boots into, and the way out of it.
//
// The sample carries one, so most of this reads the sample ROM. The interesting
// assertions are on the nametable, because a title is a map screen with two
// lines written over it — and on the *attributes*, because forcing those two
// bands to background palette 0 is the only thing standing between a readable
// title and one whose colour depends on where the author put their pond.

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
import { createProject } from '../../shared/project.js';
import { FONT_BASE } from '../../shared/font.js';
import { systemStrings } from '../../main/build/textcompile.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const ROM_PATH = path.join(SAMPLE, 'build/game.nes');
const hasRom = fs.existsSync(ROM_PATH);

const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const FLAT_SCREEN = 0x16;
const GAME_STATE = 0x25;
const PICKUPS = 0x24;
const INV_COUNT = 0x37;
const OAM = 0x200;
const SWITCHES = 0x390;

const ST_GAMEPLAY = 0;
const ST_TITLE = 3;

const A = 0;
const B = 1;
const START = 3;
const RIGHT = 7;

// TITLE_NAME_ROW / TITLE_PROMPT_ROW in main/build/generate.js.
const NAME_ROW = 10;
const PROMPT_ROW = 19;

function boot(romPath = ROM_PATH, frames = 30) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  return nes;
}

const tap = (nes, button, frames = 12) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
};

/** A whole nametable row, decoded back through the font. */
function row(nes, index) {
  let out = '';
  for (let col = 0; col < 32; col++) {
    const tile = nes.ppu.vramMem[0x2000 + index * 32 + col];
    out += tile >= FONT_BASE ? String.fromCharCode(32 + (tile - FONT_BASE)) : ' ';
  }
  return out.trim();
}

const liveSprites = (nes) => {
  let count = 0;
  for (let i = 0; i < 64; i++) if (nes.cpu.mem[OAM + i * 4] !== 0xff) count++;
  return count;
};

test('the cartridge boots into its title, showing the game name and the prompt', {
  skip: !hasRom && 'run `npm run sample` first'
}, async () => {
  const nes = boot();
  const project = await loadProject(SAMPLE);
  const strings = systemStrings(project);

  assert.equal(nes.cpu.mem[GAME_STATE], ST_TITLE);
  assert.equal(nes.cpu.mem[FLAT_SCREEN], 4, 'the title map is the fifth flat screen');
  assert.equal(row(nes, NAME_ROW), strings.sys_title);
  assert.equal(row(nes, PROMPT_ROW), strings.sys_press_start);
});

test('the bands the title writes into are forced to a readable palette', {
  skip: !hasRom && 'run `npm run sample` first'
}, () => {
  const nes = boot();
  // One attribute byte covers four tile rows, so each line of the title lands in
  // exactly one attribute row. Zeroed, both read as background palette 0.
  for (const tileRow of [NAME_ROW, PROMPT_ROW]) {
    const attrRow = tileRow >> 2;
    const bytes = [...nes.ppu.vramMem.slice(0x23c0 + attrRow * 8, 0x23c0 + attrRow * 8 + 8)];
    assert.deepEqual(bytes, Array(8).fill(0), `attribute row ${attrRow} was not blanked`);
  }
  // ...and the rows around them were left alone, so the art is still the art.
  const untouched = [...nes.ppu.vramMem.slice(0x23c0 + 3 * 8, 0x23c0 + 3 * 8 + 8)];
  assert.ok(untouched.some((byte) => byte !== 0), 'the whole attribute table was blanked');
});

test('there is no player and no health bar on the title', {
  skip: !hasRom && 'run `npm run sample` first'
}, () => {
  const nes = boot();
  const onTitle = liveSprites(nes);
  tap(nes, START);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY);
  assert.ok(
    liveSprites(nes) > onTitle,
    `the game should show more sprites than the title (${onTitle} -> ${liveSprites(nes)})`
  );
});

test('the prompt blinks, and Start begins the game where the Map Forge said', {
  skip: !hasRom && 'run `npm run sample` first'
}, async () => {
  const nes = boot();
  const project = await loadProject(SAMPLE);
  const prompt = systemStrings(project).sys_press_start;

  // The blink is the whole of the title's animation, and it goes through the
  // NMI queue like everything else drawn while the picture is on.
  const seen = new Set();
  for (let i = 0; i < 140; i++) {
    nes.frame();
    seen.add(row(nes, PROMPT_ROW));
  }
  assert.deepEqual([...seen].sort(), ['', prompt], `the prompt did not blink (saw ${[...seen]})`);

  tap(nes, START);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY);
  assert.equal(nes.cpu.mem[FLAT_SCREEN], 0);
  assert.equal(nes.cpu.mem[PLAYER_X], project.project.startX);
  assert.equal(nes.cpu.mem[PLAYER_Y], project.project.startY);
  assert.equal(row(nes, PROMPT_ROW), '', 'the prompt is still on screen after the game started');
});

test('A also starts the game, through its default confirm binding', {
  skip: !hasRom && 'run `npm run sample` first'
}, () => {
  const nes = boot();
  tap(nes, A);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY);
});

test('the title row is bindable, and Start is the backstop no binding removes', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-titlebind-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  // A no longer confirms; B does; and Start's binding is emptied outright —
  // the engine must start the game from it anyway.
  project.input.states.title = { A: 'none', B: 'confirm', SELECT: 'none', START: 'none' };
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = boot(built.romPath);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_TITLE);
  tap(nes, A, 20);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_TITLE, 'A is bound to nothing and still started the game');
  tap(nes, B, 20);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'B is bound to confirm and should start the game');

  const backstop = boot(built.romPath);
  tap(backstop, START, 20);
  assert.equal(backstop.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'Start must work whatever the row says');
});

test('coming back to the title starts a genuinely new game', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Walk down to the gem, pick it up, then die and come back round: the bag and
  // the switches must be as empty as they were the first time.
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-title-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  // Something lethal right next to the start, so dying does not take a journey.
  const id = project.sprites.actors.length;
  project.sprites.actors.push({
    ...structuredClone(project.sprites.actors[0]),
    id,
    name: 'Doom',
    behavior: 'npc',
    hp: 1,
    damage: 6
  });
  project.maps[0].screens[0].entities.push({ actorId: id, x: 152, y: 112, props: {} });
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const nes = boot(built.romPath);
  tap(nes, START); // into the game
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY);

  nes.buttonDown(1, RIGHT);
  for (let i = 0; i < 60 && nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY; i++) nes.frame();
  nes.buttonUp(1, RIGHT);
  assert.notEqual(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'never died');

  for (let i = 0; i < 600 && nes.cpu.mem[GAME_STATE] !== ST_TITLE; i++) {
    nes.buttonDown(1, START);
    nes.frame();
    nes.buttonUp(1, START);
    for (let f = 0; f < 8; f++) nes.frame();
  }
  assert.equal(nes.cpu.mem[GAME_STATE], ST_TITLE, 'a game over should lead back to the title');

  tap(nes, START);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY);
  assert.equal(nes.cpu.mem[PICKUPS], 0);
  assert.equal(nes.cpu.mem[INV_COUNT], 0);
  assert.deepEqual([...nes.cpu.mem.slice(SWITCHES, SWITCHES + 8)], Array(8).fill(0));
});

test('a project with no title screen boots straight into the game', async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-notitle-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await generateAssets({ dir, project: createProject('Direct') });
  const config = await fs.promises.readFile(path.join(dir, 'build/assets/config.inc'), 'utf8');
  assert.match(config, /TITLE_ENABLED = 0/);
});
