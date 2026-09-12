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
const SPLIT_LOCK = 0x99; // split_lock = mv_tmp+1 = mv_step+2 = mv_left+3, resolved via test/lib/equates.js against engine/constants.asm

const ST_GAMEPLAY = 0;
const ST_DIALOG = 2;
const ST_TITLE = 3;
const ST_BATTLE = 5;
const BOX_CLOSED = 0;
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


// --------------------------------------------------------- cycle-timing gate
//
// docs/design-kernel-diet.md §7: a permanent, baseline-free invariant on
// engine/split.asm's own arm-before-deadline discipline, independent of
// whether the zero-page diet ever ships -- a real correctness property of
// the split machinery itself. This is deliberately test-side instrumentation
// only (wrapping the vendored core's own `nes.mmap.write`/`clockIrqCounter`
// from here), never a change to the vendored core -- nothing here belongs in
// FORGE-PATCHES.md.
//
// Round 1 review finding 1: the first cut of this checker only extracted
// OBSERVED $C000/$C001/$E001 triples and thresholded their count -- it never
// read the active split program, so a missing entry (a dropped rearm) or an
// entry-0 arm delayed past its own intended clock (by moving the query bound
// used to find that clock) both passed. The checker below instead reads
// `game_state`/`box_state` every frame (mirroring `split_select`'s own
// decision, engine/split.asm:73-96, for a project with TITLE_ENABLED and no
// BATTLE_ENABLED -- the one this file's scratch project builds), constructs
// the EXPECTED arm count for each program (`split_progs`, :51-63: box and
// battle each have one real entry, title has four, off has none, the zero
// terminator never counted), and requires the REAL observed chain to match
// that count exactly before checking any deadline at all -- a dropped entry
// is caught as a count mismatch, not silently absorbed into a passing
// threshold.
//
// The hazard the design calls out: "the next counter clock after the
// rearm's own write" is circular -- a late rearm would just find whatever
// clock came after it and call that on time. Worse, `clockIrqCounter`'s own
// comment (mapper4.js) says the counter runs whether or not the IRQ is
// enabled, so a clock that lands while an entry is mid-arm silently
// consumes a count with no trace. Two independent anchors close this:
//
// - **Entry 0** (armed from NMI, `split_arm`) anchors to the frame's own
//   FIRST counter clock of any kind -- not the next clock after the arm's
//   own observed `$C000` (round 1's mistake: delaying the arm past its
//   intended clock moves that query bound and the check passes by
//   construction). Every recorded event carries the harness's OWN loop
//   counter as its `frame` tag, assigned *before* `nes.frame()` runs --  a
//   fact fixed independently of how long any code inside that call takes.
//   jsnes's own `frameEnded` fires at the top of vblank (ppu/index.js:312),
//   so one `nes.frame()` call runs from one vblank-start to the next,
//   servicing the pending NMI (hence `split_arm`) at its own top and running
//   that same frame's real rendering (hence every counter clock the just-
//   armed program produces) before returning -- confirmed directly: a
//   delay inserted before entry 0's own `$C000` write does not change which
//   frame its own resulting clocks are tagged with unless the delay is long
//   enough to blow through the rest of vblank, in which case the expected-
//   count check above catches it as a missing entry instead. Anchoring to
//   "first clock tagged with this same frame" is therefore independent of
//   the arm's own delayed position, closing the exact hole finding 1 named.
// - **Each follow-up** (armed from inside `irq:`) anchors to the next clock
//   after the clock that asserted the PRECEDING entry's own IRQ -- kept
//   unchanged from before per the reviewer's own instruction ("keep the
//   correctly chosen follow-up asserting-clock anchor"): that clock already
//   happened, in the past, before the follow-up's own handler invocation
//   even begins, so nothing the follow-up's own arm does can move it.
//
// Two shapes of arm exist, structurally distinguished by what precedes
// their own $C000 write (no RAM peek needed): an NMI-issued entry 0 is
// preceded by split_arm's own $8000/$8001 restore with nothing before that
// in the same short window; a follow-up (armed from inside `irq:`) is
// preceded by $8000/$8001 (applying the firing entry) and, before that, the
// handler's own $E000 acknowledge.

/** Wraps nes.mmap.write/clockIrqCounter to record every split-relevant
 * register write and every counter clock, in real execution order -- a
 * single-threaded, cycle-accurate trace, so array position IS chronological
 * order -- tagged with the harness's own frame counter (set by the caller
 * before each nes.frame() call, never derived from the trace itself).
 * Test-side only; the vendored mapper is otherwise untouched. */
function attachSplitTrace(nes, frameRef) {
  const events = [];
  const mmap = nes.mmap;
  const originalWrite = mmap.write.bind(mmap);
  mmap.write = (address, value) => {
    if (address === 0x8000 || address === 0x8001 || address === 0xc000 || address === 0xc001 || address === 0xe000 || address === 0xe001) {
      events.push({ kind: 'write', address, value, frame: frameRef.frame });
    }
    return originalWrite(address, value);
  };
  const originalClock = mmap.clockIrqCounter.bind(mmap);
  mmap.clockIrqCounter = () => {
    const enabledBefore = mmap.irqEnable;
    originalClock();
    events.push({ kind: 'clock', fired: enabledBefore === 1 && mmap.irqCounter === 0, frame: frameRef.frame });
  };
  return events;
}

/**
 * Finds the next write of `address` at or after `from` -- but bails (-1)
 * if a *different* `boundary`-address write is found first (default
 * $C000, the start of the next arm). Round 1 finding 1: the original
 * search had no such bound and could borrow a later arm's own $C001/$E001
 * to complete an earlier, actually-incomplete triple.
 */
function nextWrite(events, from, address, boundary = 0xc000) {
  for (let i = from + 1; i < events.length; i++) {
    const e = events[i];
    if (e.kind !== 'write') continue;
    if (e.address === address) return i;
    if (e.address === boundary && address !== boundary) return -1;
  }
  return -1;
}

function prevWrite(events, from) {
  for (let i = from - 1; i >= 0; i--) {
    if (events[i].kind === 'write') return i;
  }
  return -1;
}

/** Every real, COMPLETE $C000/$C001/$E001 arm triple in the trace, each
 * tagged with whether it is a follow-up (armed from inside the IRQ handler)
 * or an NMI-issued entry 0 -- decided from the exact three writes
 * immediately before its own $C000, never from a RAM peek. An incomplete
 * triple (bounded out by nextWrite above) is skipped, not silently
 * stitched from a later arm's writes. */
function extractArms(events) {
  const arms = [];
  let from = -1;
  for (;;) {
    const c000 = nextWrite(events, from, 0xc000);
    if (c000 === -1) break;
    const c001 = nextWrite(events, c000, 0xc001);
    if (c001 === -1) {
      from = c000; // incomplete -- try again from the next real $C000
      continue;
    }
    const e001 = nextWrite(events, c001, 0xe001);
    if (e001 === -1) {
      from = c000;
      continue;
    }
    const w1 = prevWrite(events, c000); // expected $8001 (both shapes)
    const w2 = w1 === -1 ? -1 : prevWrite(events, w1); // expected $8000 (both shapes)
    const w3 = w2 === -1 ? -1 : prevWrite(events, w2); // $e000 only for a follow-up
    const isFollowUp = w3 !== -1 && events[w3].address === 0xe000 && events[w1]?.address === 0x8001 && events[w2]?.address === 0x8000;
    arms.push({ start: c000, end: e001, isFollowUp });
    from = e001;
  }
  return arms;
}

/** Groups arms by the frame their own $C000 write was tagged with -- the
 * whole chain (entry 0 plus every follow-up) for one active program lands
 * in exactly one frame's own trace bucket (see the header comment above for
 * why: NMI services at the top of a jsnes frame() call, and that same
 * call's own rendering produces every clock the just-armed program needs,
 * all before the call returns). */
function groupArmsByFrame(events, arms) {
  const byFrame = new Map();
  for (const arm of arms) {
    const frame = events[arm.start].frame;
    if (!byFrame.has(frame)) byFrame.set(frame, []);
    byFrame.get(frame).push(arm);
  }
  return byFrame;
}

/** Mirrors split_select's own decision (engine/split.asm:73-96) for a
 * project with TITLE_ENABLED and no BATTLE_ENABLED -- this file's own
 * scratch project below -- and split_arm's own lock check (:112-115).
 * Returns the number of real (count,target) entries the active program
 * holds before its own zero terminator (:51-63): 4 for the title's own
 * four-entry program, 1 for the box's one-entry program, 0 for SPL_OFF or
 * a locked frame (split_arm's own early `rts` skips the whole arm, matching
 * "split_lock frame = no arm expected"). */
function expectedEntryCount(gameState, boxState, locked) {
  if (locked) return 0;
  if (gameState === ST_TITLE) return 4;
  if (boxState !== BOX_CLOSED) return 1;
  return 0;
}

/**
 * Checks the arm-before-deadline invariant over an already-recorded trace,
 * cross-checked against the program `split_select` actually decided each
 * frame (`perCallState`, one entry per traced `nes.frame()` call: the
 * engine RAM read immediately after that call, i.e. as of the end of that
 * call's own mainline -- exactly what that call's own trailing NMI read to
 * decide the NEXT frame's arm). Bucket 0 is never checked (no prior state
 * exists to derive an expectation from). Returns every violation found
 * (empty when the split machinery is both complete and on time) as
 * structured records -- `{ frame, entry, kind, message }`, `entry` null for
 * a whole-frame violation (missing/unexpected) -- never bare strings, so a
 * caller can classify a failure (which entry, which kind) without parsing
 * prose back out of a message meant for humans.
 */
function checkSplitProgram(events, perCallState) {
  const arms = extractArms(events);
  const chainsByFrame = groupArmsByFrame(events, arms);
  const allClocks = [];
  const firedClocks = [];
  events.forEach((e, i) => {
    if (e.kind !== 'clock') return;
    allClocks.push(i);
    if (e.fired) firedClocks.push(i);
  });

  const failures = [];
  for (let frame = 1; frame < perCallState.length; frame++) {
    const prior = perCallState[frame - 1];
    const expected = expectedEntryCount(prior.gameState, prior.boxState, prior.locked);
    const chain = chainsByFrame.get(frame) ?? [];

    if (expected === 0) {
      if (chain.length > 0) {
        failures.push({
          frame,
          entry: null,
          kind: 'unexpected',
          message:
            `frame ${frame}: expected no split arm (game_state=${prior.gameState}, box_state=${prior.boxState}, ` +
            `locked=${prior.locked}), but observed ${chain.length}`
        });
      }
      continue;
    }
    if (chain.length !== expected) {
      failures.push({
        frame,
        entry: null,
        kind: 'missing',
        message: `frame ${frame}: expected ${expected} arm(s) from the active program, observed ${chain.length} -- a missing (or extra) expected entry`
      });
      continue;
    }
    if (chain[0].isFollowUp) {
      failures.push({ frame, entry: 0, kind: 'order', message: `frame ${frame}: entry 0 must be NMI-issued, not a follow-up` });
      continue;
    }
    for (let k = 1; k < chain.length; k++) {
      if (!chain[k].isFollowUp) {
        failures.push({ frame, entry: k, kind: 'order', message: `frame ${frame}: entry ${k} should be a follow-up (armed from inside the IRQ handler)` });
      }
    }

    // Entry 0's own deadline: the frame's first counter clock of any kind --
    // fixed by this frame's own tag, never by this arm's own observed start.
    const entry0Deadline = allClocks.find((idx) => events[idx].frame === frame);
    if (entry0Deadline === undefined || !(chain[0].end < entry0Deadline)) {
      failures.push({
        frame,
        entry: 0,
        kind: 'deadline',
        message:
          `frame ${frame} entry 0: arm completing at trace index ${chain[0].end} missed the frame's own first ` +
          `counter-clock deadline (index ${entry0Deadline ?? '(none)'})`
      });
    }

    // Each follow-up's deadline: the next clock after the one that fired
    // the entry immediately before it -- already in the past by the time
    // this follow-up's own handler starts, so its own timing cannot move it.
    let previousEnd = chain[0].end;
    for (let k = 1; k < chain.length; k++) {
      const firedClock = firedClocks.find((idx) => idx > previousEnd);
      const deadline = firedClock === undefined ? undefined : allClocks.find((idx) => idx > firedClock);
      if (deadline === undefined || !(chain[k].end < deadline)) {
        failures.push({
          frame,
          entry: k,
          kind: 'deadline',
          message:
            `frame ${frame} entry ${k}: arm completing at trace index ${chain[k].end} missed its independently-anchored ` +
            `deadline clock (index ${deadline ?? '(none)'}, anchored to the clock that fired entry ${k - 1})`
        });
      }
      previousEnd = chain[k].end;
    }
  }
  return { arms, failures };
}

/** Builds an MMC3 project with a title screen (the one program with real
 * follow-up entries, docs/design-kernel-diet.md §7) and, optionally, a Code
 * Forge override of split.asm -- used by the negative controls below to
 * exercise the real instruction stream the invariant polices, never an
 * emulator-side artificial delay. */
async function buildSplitTraceProject(t, overrideText) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-split-trace-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = createProject('SplitTrace');
  project.cartridge.mapper = 4; // MMC3
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  if (overrideText) project.code = { overrides: [{ name: 'split.asm', text: overrideText }], files: [] };
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return built.romPath;
}

/** Boots `romPath`, then traces `frames` further frames, returning the raw
 * event trace and, per traced frame, the engine RAM state as of the end of
 * that frame's own mainline (what that frame's own trailing NMI read to
 * decide the arm for the NEXT frame). */
function traceSplitFrames(romPath, { warmup = 15, frames = 60 } = {}) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < warmup; i++) nes.frame();

  const frameRef = { frame: 0 };
  const events = attachSplitTrace(nes, frameRef);
  const perCallState = [];
  for (let i = 0; i < frames; i++) {
    frameRef.frame = i;
    nes.frame();
    perCallState.push({
      gameState: nes.cpu.mem[GAME_STATE],
      boxState: nes.cpu.mem[BOX_STATE],
      locked: nes.cpu.mem[SPLIT_LOCK] !== 0
    });
  }
  return { events, perCallState };
}

test('the split-arm sequence completes before its own independently-anchored counter-clock deadline, every expected entry present', async (t) => {
  const romPath = await buildSplitTraceProject(t);
  const { events, perCallState } = traceSplitFrames(romPath);

  const { arms, failures } = checkSplitProgram(events, perCallState);
  const followUps = arms.filter((a) => a.isFollowUp).length;
  assert.ok(arms.length > 100, `expected substantial real coverage from 60 title frames, only saw ${arms.length} arms`);
  assert.ok(followUps > 100, `expected the title program's own follow-up entries to dominate, only saw ${followUps} of ${arms.length}`);
  assert.deepEqual(failures, [], 'every expected entry must be present, complete, and on time');
});

test('the split-arm invariant is not vacuous -- a dropped expected entry fails it', async (t) => {
  const stockSplit = fs.readFileSync(path.join(ROOT, 'engine', 'split.asm'), 'utf8');
  // Drops split_prog_title's own final (7,0) entry, turning the real
  // four-entry title program into a three-entry one -- a real, source-level
  // missing rearm, not a synthetic trace with no engine behind it.
  const marker =
    "split_prog_title:\n  .db TITLE_NAME_ROW*8-1, 1       ; font in for the game's name...\n" +
    "  .db 7, 0                        ; ...one row later, the map's art returns\n" +
    '  .db (TITLE_PROMPT_ROW-TITLE_NAME_ROW-1)*8-1, 1\n' +
    "  .db 7, 0                        ; and the same band around the prompt\n" +
    '  .db 0\n';
  const truncated = stockSplit.replace(
    marker,
    "split_prog_title:\n  .db TITLE_NAME_ROW*8-1, 1       ; font in for the game's name...\n" +
      "  .db 7, 0                        ; ...one row later, the map's art returns\n" +
      '  .db (TITLE_PROMPT_ROW-TITLE_NAME_ROW-1)*8-1, 1\n' +
      '  .db 0                            ; SABOTAGE-CONTROL: dropped the final (7,0) entry\n'
  );
  assert.notEqual(truncated, stockSplit, 'the split_prog_title marker must match engine/split.asm verbatim, or this control is not exercising real source');

  const romPath = await buildSplitTraceProject(t, truncated);
  const { events, perCallState } = traceSplitFrames(romPath);

  const { failures } = checkSplitProgram(events, perCallState);
  const missing = failures.filter((f) => f.kind === 'missing');
  assert.ok(missing.length > 0, 'a dropped expected entry must be reported as a missing-entry violation');
  assert.equal(missing.length, failures.length, 'every failure here should be the same missing-entry shape, on every checked frame');
});

test('the split-arm invariant is not vacuous -- a late initial (NMI-armed) entry fails it', async (t) => {
  const stockSplit = fs.readFileSync(path.join(ROOT, 'engine', 'split.asm'), 'utf8');
  // A register-preserving delay between split_arm_go's own count load and
  // its $C000 latch write. X and Y are both dead here (the header comment
  // says "Called from NMI with A, X and Y already saved" -- the OUTER NMI
  // wrapper in boot.asm restores all three from its own stack-saved copies
  // regardless of what split_arm does internally, so nothing needs an
  // explicit push/pull to be safe against the CALLER -- but A itself is
  // still needed a few instructions later for the $C000/$C001/$E001 writes,
  // so it is pushed and popped around the delay rather than merely trusted
  // to survive). Calibrated empirically against a real build: split_arm
  // normally finishes its own arm several scanlines before the counter's
  // first real clock even fires (a wide, genuine vblank margin) -- a short
  // delay (as used for the follow-up control below) lands nowhere near it,
  // so this control needs enough cycles to actually cross that margin.
  const marker =
    'split_arm_go:\n  tax\n  lda split_prog_start-1,x    ; modes are 1-based\n  sta <split_idx\n  tax\n  lda split_progs,x\n  sta $C000                   ; the latch...\n';
  const delayed = stockSplit.replace(
    marker,
    'split_arm_go:\n  tax\n  lda split_prog_start-1,x    ; modes are 1-based\n  sta <split_idx\n  tax\n  lda split_progs,x\n  pha\n  ldx #2\nsplit_arm_delay_outer:\n  ldy #200\nsplit_arm_delay_inner:\n  dey\n  bne split_arm_delay_inner\n  dex\n  bne split_arm_delay_outer\n  pla\n  sta $C000                   ; the latch...\n'
  );
  assert.notEqual(delayed, stockSplit, 'the split_arm_go marker must match engine/split.asm verbatim, or this control is not exercising real source');

  const romPath = await buildSplitTraceProject(t, delayed);
  const { events, perCallState } = traceSplitFrames(romPath);

  const { arms, failures } = checkSplitProgram(events, perCallState);
  const entry0Failures = failures.filter((f) => f.entry === 0);
  const missing = failures.filter((f) => f.kind === 'missing');
  assert.equal(missing.length, 0, 'the delayed build should still execute every expected entry -- only its timing should be wrong');
  assert.ok(entry0Failures.length > 0, 'a late initial arm must be reported as an entry-0 deadline violation');
  assert.equal(entry0Failures.length, failures.length, 'every failure here should be an entry-0 violation, never a follow-up one');
  assert.ok(arms.length > 100, 'the delayed build should still reach the same real coverage as the stock one');
});

test('the split-arm invariant is not vacuous -- a source-level delayed follow-up rearm fails it, with every register preserved', async (t) => {
  const stockSplit = fs.readFileSync(path.join(ROOT, 'engine', 'split.asm'), 'utf8');
  // Round 1 review finding 2: the original delay clobbered Y with no
  // save/restore. `irq:`'s own prologue (:139-143) only saves A and X --
  // Y belongs to the asynchronously interrupted mainline code and is never
  // touched by the stock handler at all, so a delay here must save and
  // restore it itself. A does not need saving across this specific point:
  // it holds the just-applied target value, but the code immediately after
  // the delay (`inx`/`inx`/`stx <split_idx`/`lda split_progs,x`) reloads A
  // fresh before ever reading it again.
  const marker = 'irq_switch:\n  sta <irq_tmp\n  lda #1\n  sta $8000\n  lda <irq_tmp\n  sta $8001\n  inx\n';
  const delayed = stockSplit.replace(
    marker,
    'irq_switch:\n  sta <irq_tmp\n  lda #1\n  sta $8000\n  lda <irq_tmp\n  sta $8001\n  tya\n  pha\n  ldy #40\nirq_delay_loop:\n  dey\n  bne irq_delay_loop\n  pla\n  tay\n  inx\n'
  );
  assert.notEqual(delayed, stockSplit, 'the irq_switch marker must match engine/split.asm verbatim, or this control is not exercising real source');

  const romPath = await buildSplitTraceProject(t, delayed);
  const { events, perCallState } = traceSplitFrames(romPath);

  const { arms, failures } = checkSplitProgram(events, perCallState);
  const missing = failures.filter((f) => f.kind === 'missing');
  const followUpFailures = failures.filter((f) => f.entry !== 0);
  // Bucket 0 (the very first traced frame) is never checked -- see
  // checkSplitProgram's own header comment -- so its own follow-ups can
  // never register a failure; excluded here rather than asserted against
  // the raw total, which would overcount by exactly that one frame's worth.
  const checkableFollowUps = arms.filter((a) => a.isFollowUp && events[a.start].frame > 0).length;
  assert.equal(missing.length, 0, 'the delayed build should still execute every expected entry -- only its timing should be wrong');
  assert.equal(failures.length, followUpFailures.length, 'every reported failure must belong to a follow-up entry, never entry 0');
  assert.equal(
    failures.length,
    checkableFollowUps,
    `every checkable follow-up rearm should now miss its deadline (the delay sits on the one path every follow-up ` +
      `takes), but only ${failures.length} of ${checkableFollowUps} did`
  );
});
