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
import { SOLID_TILE, PROBE_TILE, probe, probeKind } from '../lib/framebuffer.js';
import { finishNamingIfOpen } from '../lib/naming.js';

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
const ST_DIALOG = 2;
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
  finishNamingIfOpen(nes); // hero naming on (phase 5): Start opens the grid
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
  finishNamingIfOpen(nes); // hero+Join naming on (phase 5): Start/cold boot opens the grid

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
  // Parking only ever clears Y ($FF, battle_draw_sprites' own "park the whole
  // shadow" loop, engine/battleui.asm) -- tile/attr/x survive untouched from
  // whatever last drew there, harmlessly invisible off-screen. With hero
  // naming live (phase 5) the naming grid's own cursor also used
  // SPRITE_ARROW_TILE (spriteReservedRanges' shared reservation) and left a
  // stale, parked entry carrying that same tile byte, so a parked slot ($FF)
  // must be skipped rather than trusted as the real, visible cursor.
  let cursor = null;
  for (let i = 0; i < 256; i += 4) {
    if (nes.cpu.mem[OAM + i] === 0xff) continue;
    if (nes.cpu.mem[OAM + i + 1] === SPRITE_ARROW_TILE) {
      cursor = { y: nes.cpu.mem[OAM + i], x: nes.cpu.mem[OAM + i + 3] };
    }
  }
  assert.ok(cursor, 'no cursor sprite in the shadow');
  assert.equal(cursor.x, 16, 'the cursor sits in the command column');
  assert.equal(cursor.y, 39, 'beside the first monster’s row band');
});

// --- in-game party-member naming (docs/design-name-entry.md §5/§15) --------
//
// split_select's own fallback (engine/split.asm) treats ANY box_state !=
// BOX_CLOSED as needing the font-bank program, with no list of specific box
// states -- BOX_NAMEENTRY and BOX_NAMEDONE are both non-zero, so this
// generic mechanism already covers the naming grid with no code change at
// all, on either placement. These are the framebuffer probes that hold that
// claim to account rather than merely asserting it from source.

const NM_ROW = 0x059b;
const BOX_ROW = 0x41;
const BOX_TEXT_ROWS = 4;
const BOX_NAMEENTRY = 9;
const ST_NAMEENTRY = 6;

function waitForNamingReady(nes, budget = 60) {
  return runUntil(nes, (n) => n.cpu.mem[BOX_STATE] === BOX_NAMEENTRY && n.cpu.mem[BOX_ROW] >= BOX_TEXT_ROWS, budget);
}

// probeRows: the row-23-through-28 tight-boundary probe (P2-3, phase 3 fix
// round 4). The original version of both naming windows below only ever
// sampled row 2 (far above the box) and row 25 (one row inside it) -- far
// enough from the real boundary that a split armed several rows early (row
// 10 instead of 24) or one that switches back to the art bank early
// (before rows 27-28 render) would still pass. Row 23 (the last row above
// the box) must read 'art'; every row the box itself draws, 24 (its own top
// border, drawn from font-page border glyphs the same as its text) through
// 28 (BOX_ROW_CONTROLS, the last content row), must read 'font',
// individually, so no single row's own split-timing bug can hide behind a
// neighbour. Row 29 (the box's nominal bottom border) is deliberately
// excluded rather than asserted either way, but NOT because it is
// genuinely outside the split's font-page range -- P3 (round 4 review): the
// vendored core's own `endFrame()` (renderer/emulator/core/ppu/index.js)
// blanks the top and bottom 8-pixel rows of the framebuffer to zero,
// unconditionally, AFTER the whole frame has already rendered, whenever
// `clipToTvSize` is true (the default) -- simulating a real TV's overscan
// by clipping the picture, not by skipping anything the PPU actually drew.
// Row 29 is tile row 29, pixel rows 232-239, exactly the bottom band that
// clip zeroes. So probeKind's own colour-count read of row 29 is always a
// single colour (0) regardless of which CHR bank the PPU used while
// rendering that scanline -- a wrong bank there is invisible to this probe
// technique specifically because of this post-render clip, not because the
// box's own bottom border is drawn from anywhere other than the font page.
function probeRows(nes, label) {
  probe(nes, 23, 2);
  assert.equal(
    probeKind(nes, 23, 2),
    'art',
    `${label}: row 23, the last row above the box, must still render from the map's own art bank -- a split ` +
      "armed too early (before row 24) would read 'font' here"
  );
  for (let row = 24; row <= 28; row++) {
    probe(nes, row, 2);
    assert.equal(
      probeKind(nes, row, 2),
      'font',
      `${label}: row ${row} of the naming grid's own box must render from the font page -- a split armed too ` +
        `early (e.g. row 10 instead of 24) or one that switches back to the art bank early (before rows 27-28 ` +
        `render) would leave row ${row} reading 'art' instead`
    );
  }
}

test('an MMC3 RPG splits over the naming grid -- hero naming first, then a named Join, both on the real framebuffer', async (t) => {
  const rom = await buildVariant(t, 'split-naming-rpg', SAMPLE_RPG, (project) => {
    project.cartridge.mapper = 4;
    project.party[0].renamable = true;
    if (project.party[1]) project.party[1].renamable = true;
    project.maps[0].encounters = { rate: 0, actorIds: [] };
  });
  const nes = boot(rom);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_NAMEENTRY, 'hero naming should open at the start of a new game');
  assert.ok(waitForNamingReady(nes), 'the hero naming grid never finished raising');

  probeRows(nes, 'hero naming');

  // Select END with the seeded default, and check the split comes back down.
  for (let i = 0; i < 3 && nes.cpu.mem[NM_ROW] !== 2; i++) tap(nes, DOWN, 4);
  const NM_COL = 0x059c;
  if (nes.cpu.mem[NM_COL] !== 1) tap(nes, RIGHT, 4); // land on END, not DEL
  tap(nes, A, 20);
  assert.ok(runUntil(nes, (n) => n.cpu.mem[GAME_STATE] === ST_GAMEPLAY, 60), 'hero naming never handed off to gameplay');
  probe(nes, 25, 2);
  assert.equal(probeKind(nes, 25, 2), 'art', 'with the grid closed the whole screen is art again');

  // Then a named Join: walk to the recruiter, talk, and probe the grid again.
  for (let step = 0; step < 900 && nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY; step++) {
    const dx = 208 - nes.cpu.mem[PLAYER_X];
    const dy = 48 - nes.cpu.mem[PLAYER_Y];
    let button = null;
    if (dx > 1) button = RIGHT;
    else if (dx < -1) button = LEFT;
    else if (dy > 1) button = DOWN;
    else if (dy < -1) button = UP;
    if (button === null) break;
    nes.buttonDown(1, button);
    nes.frame();
    nes.buttonUp(1, button);
  }
  const BOX_PAGEWAIT_LOCAL = 3;
  tap(nes, B, 4);
  for (let press = 0; press < 10 && nes.cpu.mem[BOX_STATE] !== BOX_NAMEENTRY; press++) {
    runUntil(nes, (n) => n.cpu.mem[BOX_STATE] === BOX_PAGEWAIT_LOCAL || n.cpu.mem[BOX_STATE] === BOX_NAMEENTRY, 600);
    if (nes.cpu.mem[BOX_STATE] === BOX_NAMEENTRY) break;
    tap(nes, A, 20);
  }
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_NAMEENTRY, 'the Join should have opened the naming grid');
  assert.equal(nes.cpu.mem[GAME_STATE], ST_DIALOG, 'a named Join\'s own session runs inside ST_DIALOG, never ST_NAMEENTRY');
  assert.ok(waitForNamingReady(nes), 'the Join naming grid never finished raising');

  probeRows(nes, 'Join naming');
});

test('an MMC3 action project splits over the naming grid, kernel-lo placement', async (t) => {
  const rom = await buildVariant(t, 'split-naming-action', SAMPLE, (project) => {
    project.cartridge.mapper = 4;
    project.party[0].renamable = true;
    project.tilesets[0].background.tiles[PROBE_TILE] = SOLID_TILE;
  });
  const nes = boot(rom);
  if (nes.cpu.mem[GAME_STATE] === ST_TITLE) tap(nes, START, 12);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_NAMEENTRY, 'hero naming should open on the action placement too');
  assert.ok(waitForNamingReady(nes), 'the naming grid never finished raising (kernel-lo placement)');

  // Row 2 col 2 is a pre-existing artifact of this fixture's own post-title
  // rendering unrelated to naming or the split (reproduces identically with
  // naming absent, on plain gameplay) -- row 23 avoids it (confirmed
  // empirically, same as the other two naming probes below) while sitting
  // tight against the real boundary, one row above the box's own row 24.
  probeRows(nes, 'action placement');
});
