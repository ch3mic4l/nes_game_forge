// The MMC3 scanline split: on a board with a scanline IRQ, the message font
// lives in its own CHR page and the interrupt switches it in where the text
// windows start — so a project that shows text keeps all 256 background tiles.
//
// Nothing about this is visible in engine RAM: the whole feature is *which CHR
// bank the PPU was reading when a scanline rendered*. So the ROM tests here
// assert on the framebuffer, pixel by pixel, using a probe tile that is solid
// user art in the tileset and the glyph 'A' in the font page — where it lands
// tells us which bank was live for that row.

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
import { createProject, validateProject } from '../../shared/project.js';
import { resolveMapper } from '../../shared/cartridge.js';
import { encodeTiles } from '../../shared/chr.js';
import {
  FONT_BASE,
  FONT_TILES,
  SPRITE_ARROW_TILE,
  charToTile,
  fontBankSplit
} from '../../shared/font.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');

// Engine RAM, from engine/constants.asm.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const GAME_STATE = 0x25;
const BOX_STATE = 0x40;
const BT_PHASE = 0x53;
const BT_TGT_VIS = 0x78;
const ENT_X = 0x310;
const ENT_Y = 0x318;
const OAM = 0x200;

const ST_GAMEPLAY = 0;
const ST_TITLE = 3;
const ST_BATTLE = 5;
const BOX_PAGEWAIT = 3;
const BP_MENU = 1;
const BP_TARGET = 2;

const A = 0;
const B = 1;
const START = 3;
const UP = 4;
const DOWN = 5;
const LEFT = 6;
const RIGHT = 7;

const SOLID_TILE = '3'.repeat(64);
const PROBE_TILE = 0xc1; // solid art in the variants below; the glyph 'A' in the font page

/** Build a mutated copy of a checked-in sample project, in a dir the test owns. */
async function buildVariant(t, name, source, mutate) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `forge-${name}-`));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(source);
  mutate(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return built.romPath;
}

/** Boot a ROM with the framebuffer captured every frame. */
function boot(romPath, frames = 30) {
  const state = { frame: null };
  const nes = new NES({ onFrame: (buffer) => (state.frame = buffer), emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  nes.lastFrame = () => state.frame;
  return nes;
}

const tap = (nes, button, frames = 2) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
};

function runUntil(nes, predicate, budget = 600) {
  for (let i = 0; i < budget; i++) {
    if (predicate(nes)) return true;
    nes.frame();
  }
  return predicate(nes);
}

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

/**
 * Put the probe tile in a nametable cell. mirroredWrite keeps jsnes's internal
 * name-table cache in step with vramMem, which a bare array poke does not.
 */
const probe = (nes, row, col) => nes.ppu.mirroredWrite(0x2000 + row * 32 + col, PROBE_TILE);

/**
 * What the probe cell rendered as. The art version is one solid colour; the
 * glyph 'A' has both set and clear pixels, so the colour count answers which
 * CHR bank was live when that row rendered.
 */
function probeKind(nes, row, col) {
  nes.frame();
  nes.frame();
  const frame = nes.lastFrame();
  const colors = new Set();
  for (let y = row * 8; y < row * 8 + 8; y++) {
    for (let x = col * 8; x < col * 8 + 8; x++) colors.add(frame[y * 256 + x]);
  }
  return colors.size === 1 ? 'art' : 'font';
}

// --- the predicate and the generator ----------------------------------------

test('the split is exactly MMC3-with-text, decided in one place', () => {
  const talky = createProject('Talky');
  talky.maps[0].screens[0].entities.push({ actorId: 0, x: 96, y: 96, props: { dialogue: 'Hi.' } });
  assert.equal(fontBankSplit(talky, resolveMapper(4)), true, 'MMC3 with text splits');
  assert.equal(fontBankSplit(talky, resolveMapper(0)), false, 'NROM has no scanline IRQ');
  assert.equal(fontBankSplit(talky, resolveMapper(1)), false, 'neither does MMC1');
  assert.equal(fontBankSplit(createProject('Quiet'), resolveMapper(4)), false, 'no text, no split');
});

test('on MMC3 the tilesets stay untouched and the font gets its own CHR page', async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-split-gen-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const project = createProject('Talky');
  project.cartridge.mapper = 4;
  project.maps[0].screens[0].entities.push({ actorId: 0, x: 96, y: 96, props: { dialogue: 'Hi.' } });
  // Art inside the old reservation — the whole point is that this is now legal.
  project.tilesets[0].background.tiles[PROBE_TILE] = SOLID_TILE;
  await generateAssets({ dir, project });

  const tileset = await fs.promises.readFile(path.join(dir, 'build/assets/tiles0.chr'));
  const solid = encodeTiles([SOLID_TILE]);
  assert.deepEqual(
    [...tileset.slice(PROBE_TILE * 16, PROBE_TILE * 16 + 16)],
    [...solid],
    'the user’s art at $C1 must survive into the tileset unstamped'
  );

  const fontPage = await fs.promises.readFile(path.join(dir, 'build/assets/tiles1.chr'));
  const glyphs = encodeTiles(FONT_TILES);
  assert.deepEqual(
    [...fontPage.slice(FONT_BASE * 16, FONT_BASE * 16 + glyphs.length)],
    [...glyphs],
    'the font page must carry the glyphs at the same $A0-$FF indices'
  );

  const config = await fs.promises.readFile(path.join(dir, 'build/assets/config.inc'), 'utf8');
  assert.match(config, /SPLIT_ENABLED = 1/);
  assert.match(config, /FONT_R1 {7}= 10/, 'one tileset puts the font page’s $0800 half at 1 KB bank 10');
  const cartridge = await fs.promises.readFile(path.join(dir, 'build/assets/cartridge.inc'), 'utf8');
  assert.match(cartridge, /\.ineschr 2/, 'the font page costs one CHR bank in the header');
});

test('the same project on NROM still stamps the font into the tileset', async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-split-nrom-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const project = createProject('Talky');
  project.maps[0].screens[0].entities.push({ actorId: 0, x: 96, y: 96, props: { dialogue: 'Hi.' } });
  await generateAssets({ dir, project });

  const chr = await fs.promises.readFile(path.join(dir, 'build/assets/tiles0.chr'));
  const capitalA = charToTile('A') * 16;
  assert.ok([...chr.slice(capitalA, capitalA + 16)].some((byte) => byte !== 0), 'NROM must keep stamping');
  const config = await fs.promises.readFile(path.join(dir, 'build/assets/config.inc'), 'utf8');
  assert.match(config, /SPLIT_ENABLED = 0/);
});

test('validateProject frees $A0-$FF on MMC3 and reserves the cursor sprite instead', () => {
  const project = createProject('Talky');
  project.maps[0].screens[0].entities.push({ actorId: 0, x: 96, y: 96, props: { dialogue: 'Hi.' } });
  project.tilesets[0].background.tiles[PROBE_TILE] = SOLID_TILE;

  const fontError = (p) => validateProject(p).find((problem) => /message font/.test(problem.message));
  assert.ok(fontError(project), 'NROM must still refuse art inside the reservation');
  project.cartridge.mapper = 4;
  assert.equal(fontError(project), undefined, 'MMC3 must not: the font is not in the tileset');

  // The battle targeting cursor becomes a sprite on a split board, so an RPG
  // there reserves sprite tile $FD the way combat reserves the hearts.
  const rpg = createProject('Quest', 'rpg');
  rpg.cartridge.mapper = 4;
  rpg.tilesets[0].sprites.tiles[SPRITE_ARROW_TILE] = SOLID_TILE;
  const cursorError = validateProject(rpg).find((problem) => /targeting cursor/.test(problem.message));
  assert.ok(cursorError, 'sprite $FD is the cursor’s on this cartridge');
  rpg.cartridge.mapper = 1;
  assert.equal(
    validateProject(rpg).find((problem) => /targeting cursor/.test(problem.message)),
    undefined,
    'on MMC1 the cursor is a background tile and $FD stays free'
  );
});

// --- the split in the ROM ---------------------------------------------------

test('the title bands and the message box draw glyphs while the map above keeps its art', async (t) => {
  const rom = await buildVariant(t, 'split-rom', SAMPLE, (project) => {
    project.cartridge.mapper = 4;
    project.tilesets[0].background.tiles[PROBE_TILE] = SOLID_TILE;
  });
  const nes = boot(rom);

  // The title: real engine-drawn text under the split. Row 10 carries the
  // game's name out of the font bank; a probe two rows below must come out of
  // the map's own bank, where $C1 is the user's solid tile.
  assert.equal(nes.cpu.mem[GAME_STATE], ST_TITLE, 'the sample boots into its title');
  probe(nes, 10, 2);
  probe(nes, 12, 2);
  assert.equal(probeKind(nes, 10, 2), 'font', 'the name row must render from the font page');
  assert.equal(probeKind(nes, 12, 2), 'art', 'two rows below the band it is the map’s art again');

  tap(nes, START, 12);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY);

  // The box: talk to the slime for real, then read the pixels. Probes sit at
  // column 26 — clear of the HUD hearts, the portrait and the frozen actors.
  assert.ok(walkToEntity(nes, 0), 'could not reach the slime');
  tap(nes, B);
  assert.ok(runUntil(nes, (n) => n.cpu.mem[BOX_STATE] === BOX_PAGEWAIT), 'the first page never filled');
  probe(nes, 2, 26);
  probe(nes, 25, 26);
  assert.equal(probeKind(nes, 25, 26), 'font', 'inside the box the font page is live');
  assert.equal(probeKind(nes, 2, 26), 'art', 'above the box the map keeps its art');

  // And the first real glyph of the real message renders as pixels: the 'A' of
  // "A slime" at row 25, column 2 is not a uniform block.
  assert.equal(probeKind(nes, 25, 2), 'font', 'the typed text itself renders out of the font page');

  // Close the conversation; the split comes down with the box.
  for (let press = 0; press < 10 && nes.cpu.mem[GAME_STATE] !== ST_GAMEPLAY; press++) tap(nes, A, 20);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'the conversation never ended');
  probe(nes, 25, 26);
  assert.equal(probeKind(nes, 25, 26), 'art', 'with the box closed the whole screen is art again');
});

test('an MMC3 battle splits at the box and points at monsters with a sprite', async (t) => {
  const rom = await buildVariant(t, 'split-battle', SAMPLE_RPG, (project) => {
    project.cartridge.mapper = 4;
  });
  const nes = boot(rom);
  if (nes.cpu.mem[GAME_STATE] === ST_TITLE) tap(nes, START, 12);

  // March until a wandering monster turns up.
  for (let step = 0; step < 900 && nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY; step++) {
    const buttons = [];
    if (nes.cpu.mem[PLAYER_X] < 168) buttons.push(RIGHT);
    if (nes.cpu.mem[PLAYER_Y] < 168) buttons.push(DOWN);
    if (!buttons.length) buttons.push(step & 16 ? RIGHT : DOWN);
    for (const button of buttons) nes.buttonDown(1, button);
    nes.frame();
    for (const button of buttons) nes.buttonUp(1, button);
  }
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'no encounter after nine hundred steps');
  assert.ok(runUntil(nes, (n) => n.cpu.mem[BT_PHASE] === BP_MENU, 900), 'the menu never came round');

  // The battle box border is drawn from the font bank; the ground band above
  // is the battle tileset's own art.
  probe(nes, 8, 1);
  probe(nes, 25, 1);
  assert.equal(probeKind(nes, 25, 1), 'font', 'the battle box renders from the font page');
  assert.equal(probeKind(nes, 8, 1), 'art', 'the ground band renders from the battle tileset');

  // FIGHT: the targeting cursor must be a sprite here — the arrow glyph's bank
  // is only switched in below the box, and the monsters live above it.
  tap(nes, A, 3);
  assert.equal(nes.cpu.mem[BT_PHASE], BP_TARGET, 'FIGHT should ask who to hit');
  assert.equal(nes.cpu.mem[BT_TGT_VIS], 1);
  let cursor = null;
  for (let i = 0; i < 256; i += 4) {
    if (nes.cpu.mem[OAM + i + 1] === SPRITE_ARROW_TILE) {
      cursor = { y: nes.cpu.mem[OAM + i], x: nes.cpu.mem[OAM + i + 3] };
    }
  }
  assert.ok(cursor, 'no cursor sprite in the shadow');
  assert.equal(cursor.x, 16, 'the cursor sits in the command column');
  assert.equal(cursor.y, 39, 'beside the first monster’s row band');
});
