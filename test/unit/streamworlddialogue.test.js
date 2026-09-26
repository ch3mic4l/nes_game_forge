// Large streamed worlds (ROADMAP item 15), phase 2 slice 7b -- SCOPE NOTE, read this first.
//
// handoff-next/brief-streamed-worlds-phase2-s7b.md asks for the whole dialogue lifecycle state
// machine, the camera/OAM publication barrier, sw_dlg_metatile, every text.asm consumer site
// (border, glyphs, {name}, arrow, choice text, choice cursor, naming-grid cells in both
// placements), the Say-reaches-Move refusal, kernel-lo accounting per site, and a Mesen timing
// harness.
//
// UPDATE (phase 2 slice 7b continuation): the whole lifecycle is now wired for real --
// sw_dlg15_state/sw_dlg17_camhold (engine/streamworld.asm, engine/boot.asm), the camera/OAM
// publication barrier reusing cam_dirty, and every text.asm/nameentry.asm consumer site
// (box_begin/text_open_step/text_put_char/text_arrow_write/text_choice_step/choice_cursor/
// text_close_step/nameentry_*) dispatching through the mapper when map_is_streamed is set. The
// section above (sw_dlg_metatile/sw_dlg_origin_capture, direct-call tested against an independent
// oracle) is unchanged by this continuation and stays exactly as first shipped. Everything below
// this point is the continuation's own addition: the plan's 13 named cases
// (handoff-next/streamed-worlds-phase2-plan.md, "Slice 7b"), covering the state table, the
// barrier, and every consumer site by name. See handoff-next/streamed-worlds-phase2-s7b-report.md
// for the full accounting of what shipped and why.
//
// Every expected value below is computed independently in plain JS arithmetic from
// docs/design-streamed-worlds.md's own prose contract and engine/constants.asm's own published
// RAM meanings (sw_cam_origin_x/y_lo/hi = "the world position already sitting at screen column/
// row 0") -- never read back from the routine under test, and never a restatement of the 6502's
// own add/wrap steps.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { validateProject, createPartyMember } from '../../shared/project.js';
import { planStreamedRegions } from '../../main/build/generate.js';
import { resolveMapper } from '../../shared/cartridge.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { callRoutine } from '../lib/callroutine.js';
import NES from '../../renderer/emulator/core/nes.js';
import { finishNamingIfOpen, waitForNamingReady, gotoCell, clearName, typeNameAndFinish, nameBytes, tap as namingTap } from '../lib/naming.js';
import { BUTTON } from '../../renderer/emulator/runcontrol.js';
import { nameTiles } from '../../main/build/battletables.js';
import { charToTile } from '../../shared/font.js';

// engine/constants.asm -- hardcoded per CLAUDE.md's own rule (a test that reads the file it is
// checking proves nothing). These are ORDINARY RAM addresses (page 3), not zero page -- nesasm
// refuses a `<` prefix on any of them (confirmed directly: a first attempt at this commit's own
// engine code used `<` here and nesasm's build errored "Incorrect zero page address!" at every
// site, immediately caught and fixed before this file existed).
const SW_CAM_ORIGIN_X_LO = 0x035c;
const SW_CAM_ORIGIN_X_HI = 0x035d;
const SW_CAM_ORIGIN_Y_LO = 0x035e;
const SW_CAM_ORIGIN_Y_HI = 0x035f;
const SW_DLG_OCOL = 0x03dc;
const SW_DLG_OCOL_L = 0x03dd;
const SW_DLG_OROW = 0x03de;
const SW_DLG_OROW_L = 0x03df;
const BOX_MT_ROW = 12; // engine/constants.asm

// test/unit/streamworldresident.test.js's own RAM map (that file's own header explains why: this
// core fills RAM with $FF at power-on and loadROM() never runs any boot code, so every one of
// these is normally-live state a real map-entry loader would set, which nothing here ever runs).
const MAPPER_SHADOW = 0x35;
const RAM = {
  sw_col: 0x05a0, sw_row: 0x05a1, sw_col_region: 0x05a3,
  sw_col_byte_lo: 0x05a4, sw_col_byte_hi: 0x05a5, sw_row_bank_base: 0x05a6,
  sw_base_bank: 0x05a7, sw_regions_per_row: 0x05a8, sw_grid_w: 0x05a9, sw_grid_h: 0x05aa,
  sw_tmp2: 0x05ac, sw_tmp4: 0x05ae, sw_tmp5: 0x05af, sw_tmp6: 0x05b0,
  sw_fill_metatile_id: 0x05fd,
};

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// ---------------------------------------------------------------------------------------------
// Phase 2 slice 7b continuation: the lifecycle/barrier/consumer-integration constants and harness.
// Addresses below are transcribed by hand from engine/constants.asm (CLAUDE.md's own rule).
// ---------------------------------------------------------------------------------------------

const GAME_STATE = 0x25;
const ST_GAMEPLAY = 0;
const ST_DIALOG = 2;
const MAP_IS_STREAMED = 0xfe;
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const PLAYER_DIR = 0x12;
const BOX_STATE = 0x40;
const BOX_ROW = 0x41;
const VRAM_LEN = 0x3c;
const VRAM_READY = 0x3f;
const VRAM_BUF = 0x0400; // engine/constants.asm -- test/unit/streamworlddialoguemapper.test.js's own address, same layout
const ST_ACTIVE = 0x5b5;
const ENT_X = 0x0310;
const ENT_Y = 0x0318;
// cam_x_lo/y_lo/nt/cam_dirty are a chained zero-page equate run off bt_walk_step (resolved by
// hand-walking engine/constants.asm's own chain, the same technique test/unit/
// streamworlddialoguemapper.test.js's own header describes for cam_x_lo/y_lo/nt); cam_dirty is
// one further link in that same chain (cam_far+1).
const CAM_X_LO = 0xaf;
const CAM_Y_LO = 0xb0;
const CAM_NT = 0xb1;
const CAM_SLIDE_LEFT = 0xb2;
const CAM_SLIDE_DIR = 0xb3;
const CAM_DIRTY = 0xb5;
const CAM_SLIDE_B_PENDING = 0xba; // nmi_tmp+1 (engine/constants.asm) -- test/unit/camera.test.js's own chain
const SW_DLG15_STATE = 0xf3;
const SW_DLG15_ORIGIN_X_LO = 0xf4;
const SW_DLG15_ORIGIN_X_HI = 0xf5;
const SW_DLG15_ORIGIN_Y_LO = 0xf6;
const SW_DLG15_ORIGIN_Y_HI = 0xf7;
const SW_DLG_CAM_X_LO = 0x03da;
const SW_DLG_CAM_Y_LO = 0x03db;
const SW_DLG17_CAMHOLD = 0x07f0;

const SW_DLG15_IDLE = 0;
const SW_DLG15_PENDING = 1;
const SW_DLG15_DRAINING = 2;

const BOX_CLOSED = 0;
const BOX_OPENING = 1;
const BOX_TYPING = 2;
const BOX_PAGEWAIT = 3;
const BOX_CLEARING = 4;
const BOX_CLOSING = 5;
const BOX_ENDWAIT = 6;
const BOX_CHOICE = 7;
const BOX_CHOICEWAIT = 8;

// renderer/emulator/core/controller.js -- default gameplay bindings map B to 'interact', A to
// 'attack' (shared/project.js's defaultInput()); the same convention test/unit/
// streamworldmove.test.js's own header comment documents.
const A_BTN = 0;
const B = 1;
const UP = 4;
const DOWN = 5;
const LEFT = 6;
const RIGHT = 7;
const DIR_RIGHT = 3;

const SW_RW_NT_HI = [0x20, 0x24, 0x28, 0x2c]; // engine/streamworld.asm's own sw_rw_nt_hi table

// ---------------------------------------------------------------------------------------------
// The dialogue mapper's own contract, computed via an explicit world-tile-to-nametable-block
// mapping (floor-division + modulo + XOR-by-block-parity), NOT engine/streamworld.asm's own
// sw_dlg_tile_addr transcribed step for step (fix round 1, tests-audit.md: the old version here
// matched that routine's own bcs-then-subtract-and-flag shape exactly, "the same steps"). This is
// the same style test/unit/streamworlddialoguemapper.test.js's own case-12-blessed boxFootprint
// oracle already uses for attribute quadrants (tests-audit.md: "Case12's cell/quadrant footprint
// uses a genuinely different level of geometry and is not the same defect"), generalized here from
// 16px metatile/quadrant blocks to 8px tile blocks. Four-screen mirroring's checkerboard wrap is a
// fact about the NES hardware, not an engine design choice either implementation is free to differ
// on -- there is exactly one correct (nt, physRow, physCol) for a given world tile position, so a
// correct alternative derivation necessarily agrees numerically; what changes is the CODE SHAPE
// (a general floor(worldRow/30) rather than a single bcs-range compare-and-subtract, so a
// mutation of the routine's own specific subtract/flag logic cannot also be baked into this
// oracle by sharing its structure) and the fact that no code here is copied from or mirrors
// sw_dlg_tile_addr's own instruction sequence. Confirmed numerically identical to the prior
// formula across every camera fixture this file already exercises (row/col ranges here never
// wrap more than once per axis, so the two are provably equivalent for every value in use, and
// this version is additionally correct for a double wrap the prior single-subtraction version was
// not, though nothing here currently reaches that range).
// ---------------------------------------------------------------------------------------------

function dlgPhysPos(camXLo, camYLo, camNt, row, col) {
  const worldCol = (camXLo >> 3) + col;
  const worldRow = (camYLo >> 3) + 24 + row;
  const ntXBit = Math.floor(worldCol / 32) & 1;
  const ntYBit = Math.floor(worldRow / 30) & 1;
  const nt = (camNt ^ ntXBit ^ (ntYBit << 1)) & 3;
  const physCol = worldCol % 32;
  const physRow = worldRow % 30;
  return { physRow, physCol, nt };
}

function dlgTileAddr(camXLo, camYLo, camNt, row, col) {
  const { physRow, physCol, nt } = dlgPhysPos(camXLo, camYLo, camNt, row, col);
  const addrLo = ((physRow & 7) << 5) | physCol;
  const addrHi = SW_RW_NT_HI[nt] + (physRow >> 3);
  return { hi: addrHi, lo: addrLo, nt };
}

function readTile(nes, nt, offset) {
  return nes.ppu.nameTable[nes.ppu.ntable1[nt]].tile[offset];
}

/** The real physical destination (nt, flat tile offset) for a box-relative (row 0-5, col 0-31)
 * cell under the given (already-floored) camera -- dlgTileAddr's own (hi, lo) recombined into the
 * same (nt, offset) shape readTile expects. */
function dlgCellTile(nes, camXLo, camYLo, camNt, row, col) {
  const { physRow, physCol, nt } = dlgPhysPos(camXLo, camYLo, camNt, row, col);
  return readTile(nes, nt, physRow * 32 + physCol);
}

/** Parses the raw vram_buf queue directly out of CPU memory into a flat list of {addr, byte}
 * cells in emission order (test/unit/streamworlddialoguemapper.test.js's own helper, copied
 * locally per this codebase's own per-suite-duplication convention) -- used by case 7's direct
 * callRoutine test, which never steps a real frame/NMI, so real PPU content is never populated;
 * the queued packet destination address is the only thing to check. */
function readVramCells(mem) {
  const len = mem[VRAM_LEN];
  const cells = [];
  let i = 0;
  while (i < len) {
    const addr = (mem[VRAM_BUF + i] << 8) | mem[VRAM_BUF + i + 1];
    const count = mem[VRAM_BUF + i + 2];
    for (let k = 0; k < count; k++) cells.push({ addr: addr + k, byte: mem[VRAM_BUF + i + 3 + k] });
    i += 3 + count;
  }
  return cells;
}

// ---------------------------------------------------------------------------------------------
// Full-boot harness -- test/unit/streamworldmove.test.js's own buildAndBoot, copied locally per
// this codebase's own established convention (each ROM-booting suite keeps its own boot helper).
// ---------------------------------------------------------------------------------------------

async function buildAndBoot(project, { requireStreamed = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-streamworlddlg-boot-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const bytes = new Uint8Array(fs.readFileSync(built.romPath));
    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(bytes);
    const mem = nes.cpu.mem;
    const symbols = fs.readFileSync(built.symbolPath, 'utf8');
    const addrOf = (label) => {
      const m = symbols.match(new RegExp(`^${label}\\s+=\\s+\\$([0-9A-Fa-f]+)`, 'm'));
      assert.ok(m, `${label} should be a named symbol in game.fns`);
      return parseInt(m[1], 16);
    };
    let frames = 0;
    while ((mem[GAME_STATE] !== ST_GAMEPLAY || (requireStreamed && mem[MAP_IS_STREAMED] !== 1)) && frames < 200) {
      nes.frame();
      frames++;
    }
    assert.ok(frames < 200, 'cold boot must reach ST_GAMEPLAY within 200 frames');
    for (let i = 0; i < 100; i++) nes.frame();
    return { nes, mem, symbols, addrOf };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Advance until `predicate(mem)` holds, so a test never hardcodes a frame count. */
function driveUntil(nes, mem, predicate, maxFrames = 400) {
  let frames = 0;
  while (!predicate(mem) && frames < maxFrames) {
    nes.frame();
    frames++;
  }
  return frames;
}

const tap = (nes, button, settleFrames = 2) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < settleFrames; i++) nes.frame();
};

/** Chase a stationary or moving entity (test/unit/text.test.js's own walkToEntity), used here to
 * both scroll the camera by a real, non-trivial amount AND land the player adjacent to the
 * interact NPC in one walk -- a mapper-bypass bug at camera (0,0) is invisible (the mapped and the
 * ordinary fixed $23xx address coincide there), so every consumer-site test below needs the
 * player to have actually walked first. */
function walkToEntity(nes, mem, slot, budget = 400) {
  for (let step = 0; step < budget; step++) {
    const targetX = mem[ENT_X + slot];
    const targetY = mem[ENT_Y + slot];
    const x = mem[PLAYER_X];
    const y = mem[PLAYER_Y];
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

function interactEntity(project, { x, y, commands, actorName = 'NPC' }) {
  const actorId = project.sprites.actors.length;
  project.sprites.actors.push({ name: actorName, behavior: 'npc', hp: 1, damage: 0 });
  const streamedMap = project.maps.find((m) => m.streamed === true);
  const screen = streamedMap.screens[0];
  screen.entities = screen.entities ?? [];
  const slot = screen.entities.length;
  screen.entities.push({ actorId, x, y, props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } });
  return slot;
}

// ---------------------------------------------------------------------------------------------
// Independent oracle
// ---------------------------------------------------------------------------------------------

/** sw_dlg_origin_capture's own contract, reimplemented independently: screenCol is free (a
 * screen is exactly 256px), screenRow needs a real /240 divmod. */
function originOracle(camOriginXHi, camOriginXLo, camOriginYHi, camOriginYLo) {
  const ocol = camOriginXHi;
  const ocolL = camOriginXLo >> 4;
  let y = camOriginYHi * 256 + camOriginYLo;
  let orow = 0;
  while (y >= 240) {
    y -= 240;
    orow++;
  }
  const orowL = y >> 4;
  return { ocol, ocolL, orow, orowL };
}

/** sw_dlg_metatile's own contract: box-relative (row 0-2, col 0-15) -> world (screenCol,
 * screenRow, offset 0-239), a single conditional 16/15-wrap per axis (box is 16 cols wide, 3 rows
 * tall, origin locals are already 0-15/0-14, so no axis can wrap more than once). */
function metatileWorldPos(origin, boxRow, boxCol) {
  let lcol = origin.ocolL + boxCol;
  let scol = origin.ocol;
  if (lcol >= 16) {
    lcol -= 16;
    scol = (scol + 1) & 0xff;
  }
  let lrow = origin.orowL + BOX_MT_ROW + boxRow;
  let srow = origin.orow;
  if (lrow >= 15) {
    lrow -= 15;
    srow = (srow + 1) & 0xff;
  }
  const offset = lrow * 16 + lcol;
  return { scol, srow, offset };
}

/** streamedScreen's own generator (test/lib/streamedproject.js), reimplemented independently
 * rather than imported, so a bug in that shared helper cannot silently cancel out here too. */
function expectedMetatileId(gridW, gridH, screenCol, screenRow, offset, screenSize) {
  if (screenCol >= gridW || screenRow >= gridH) return 0; // fill
  const variedCount = Math.floor(screenSize / 3);
  return offset < variedCount ? 1 + ((screenCol + screenRow + offset) % 3) : 0;
}

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

async function buildHarness(t, opts = {}) {
  const project = createStreamedProject({ gameType: 'rpg', ...opts });
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const symbols = fs.readFileSync(built.symbolPath, 'utf8');
  const addrOf = (label) => {
    const m = symbols.match(new RegExp(`^${label}\\s+=\\s+\\$([0-9A-Fa-f]+)`, 'm'));
    assert.ok(m, `${label} should be a named symbol in game.fns`);
    return parseInt(m[1], 16);
  };
  const bytes = new Uint8Array(fs.readFileSync(built.romPath));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(bytes);
  const mem = nes.cpu.mem;
  return { project, addrOf, nes, mem };
}

// This core fills RAM with $FF at power-on and loadROM() never runs any boot code
// (test/unit/streamworldresident.test.js's own header) -- sw_terrain_or_fill's own bank-switch
// path (sw_goto/sw_peek_byte, reached through sw_dlg_metatile) needs the same "current field
// screen" locator state a real map-entry loader would already have set. Priming it with sw_goto
// itself (rather than hand-deriving the region/bank-base/byte-lo/hi split a second time) is the
// exact technique streamworldresident.test.js's own "sw_peek_byte and sw_terrain_or_fill read a
// real screen" test established -- asking the single source of truth for that arithmetic, not
// maintaining a second, driftable copy of it. A first run of this test without this priming (and
// without MAPPER_SHADOW=0) returned metatile id 105 for a real in-grid cell -- not one of this
// project's own 0-3 terrain values at all, proof the bank switch itself was landing on garbage,
// not merely computing the wrong screenCol/screenRow/offset.
async function primeTerrainState(project, nes, addrOf) {
  const mapper = resolveMapper(project.cartridge.mapper);
  const plan = planStreamedRegions(project, mapper);
  assert.ok(plan.baseBanks, 'this project`s streamed map must fit on UNROM 512');
  const streamedMap = project.maps.find((m) => m.streamed === true);
  const mem = nes.cpu.mem;

  mem[MAPPER_SHADOW] = 0;
  mem[RAM.sw_base_bank] = plan.baseBanks[0];
  const { streamRegionsPerRow } = await import('../../shared/streamlayout.js');
  mem[RAM.sw_regions_per_row] = streamRegionsPerRow(streamedMap.gridW);
  mem[RAM.sw_grid_w] = streamedMap.gridW;
  mem[RAM.sw_grid_h] = streamedMap.gridH;
  mem[RAM.sw_fill_metatile_id] = streamedMap.fillMetatileId ?? 0;

  // Establish a real current-field-screen locator/pointer at screen (0,0), the same sw_goto every
  // routine under test itself calls, then copy ITS OWN scratch results into the persistent fields
  // sw_locate_current reads back on every sw_peek_byte restore.
  nes.cpu.REG_ACC = 0;
  nes.cpu.REG_X = 0;
  callRoutine(nes, addrOf('sw_goto'));
  mem[RAM.sw_col_region] = mem[RAM.sw_tmp2];
  mem[RAM.sw_row_bank_base] = mem[RAM.sw_tmp4];
  mem[RAM.sw_col_byte_lo] = mem[RAM.sw_tmp5];
  mem[RAM.sw_col_byte_hi] = mem[RAM.sw_tmp6];
  mem[RAM.sw_col] = 0;
  mem[RAM.sw_row] = 0;

  return { gridW: streamedMap.gridW, gridH: streamedMap.gridH, fillMetatileId: streamedMap.fillMetatileId ?? 0, screen: streamedMap.screens[0] };
}

function setCamOrigin(mem, xHi, xLo, yHi, yLo) {
  mem[SW_CAM_ORIGIN_X_HI] = xHi;
  mem[SW_CAM_ORIGIN_X_LO] = xLo;
  mem[SW_CAM_ORIGIN_Y_HI] = yHi;
  mem[SW_CAM_ORIGIN_Y_LO] = yLo;
}

function readOrigin(mem) {
  return {
    ocol: mem[SW_DLG_OCOL],
    ocolL: mem[SW_DLG_OCOL_L],
    orow: mem[SW_DLG_OROW],
    orowL: mem[SW_DLG_OROW_L],
  };
}

// A representative sweep of camera-origin cases: (screenCol, localPxX%256 floored-to-16,
// worldPixelY split across a few screenRow boundaries). worldPixelY values are chosen to exercise
// zero, one and several /240 divmod iterations.
const ORIGIN_CASES = [
  { xHi: 0, xLo: 0, y: 0, label: 'world origin' },
  { xHi: 2, xLo: 0x30, y: 0, label: 'screenCol 2, local col 3' },
  { xHi: 0, xLo: 0xf0, y: 0, label: 'local col 15 (max)' },
  { xHi: 1, xLo: 0, y: 239, label: 'worldY 239 -- screenRow 0, localRow 14 (max, floored)' },
  { xHi: 0, xLo: 0, y: 240, label: 'worldY 240 -- exactly one screenRow crossing' },
  { xHi: 0, xLo: 0, y: 479, label: 'worldY 479 -- one crossing, localRow floored to 14' },
  { xHi: 0, xLo: 0, y: 480, label: 'worldY 480 -- exactly two screenRow crossings' },
  { xHi: 3, xLo: 0x50, y: 730, label: 'combined: screenCol 3, local col 5, two Y crossings + remainder' },
];

test('sw_dlg_origin_capture matches an independent oracle across screenCol/local-col/screenRow crossings', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  const captureAddr = addrOf('sw_dlg_origin_capture');
  for (const c of ORIGIN_CASES) {
    const yHi = c.y >> 8;
    const yLo = c.y & 0xff;
    setCamOrigin(mem, c.xHi, c.xLo & 0xf0, yHi, yLo); // floored to 16px, the routine's own precondition
    callRoutine(nes, captureAddr);
    const expected = originOracle(c.xHi, c.xLo & 0xf0, yHi, yLo);
    const got = readOrigin(mem);
    assert.deepEqual(got, expected, c.label);
  }
});

// ---------------------------------------------------------------------------------------------
// sw_dlg_metatile
// ---------------------------------------------------------------------------------------------

// Box-relative (row, col) cases: corners, an interior cell, and cells specifically chosen so the
// col/row wrap branch inside sw_dlg_metatile is exercised (a local coordinate that is NOT already
// within 0-15/0-14 before the box offset is added).
const CELL_CASES = [
  { row: 0, col: 0, label: 'top-left cell' },
  { row: 2, col: 15, label: 'bottom-right cell' },
  { row: 1, col: 8, label: 'interior cell' },
  { row: 0, col: 15, label: 'top-right cell' },
  { row: 2, col: 0, label: 'bottom-left cell' },
];

test('sw_dlg_metatile matches an independent oracle for every box cell, including a col+row wrap and a fill (off-grid) case', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const { project, addrOf, nes, mem } = await buildHarness(t);
  const captureAddr = addrOf('sw_dlg_origin_capture');
  const metatileAddr = addrOf('sw_dlg_metatile');
  const { gridW, gridH, screen } = await primeTerrainState(project, nes, addrOf);
  const screenSize = screen.metatiles.length;

  // Case A: origin exactly at (screenCol 0, local 0/0) -- no wrap on any axis.
  setCamOrigin(mem, 0, 0, 0, 0);
  callRoutine(nes, captureAddr);
  for (const c of CELL_CASES) {
    const origin = originOracle(0, 0, 0, 0);
    const expectedPos = metatileWorldPos(origin, c.row, c.col);
    const expectedId = expectedMetatileId(gridW, gridH, expectedPos.scol, expectedPos.srow, expectedPos.offset, screenSize);
    nes.cpu.REG_ACC = c.row;
    nes.cpu.REG_X = c.col;
    callRoutine(nes, metatileAddr);
    assert.equal(nes.cpu.REG_ACC, expectedId, `no-wrap origin, ${c.label}`);
  }

  // Case B: origin local col 12 forces the col wrap branch for boxCol >= 4; origin local row 10
  // (screenRow 0) forces the row wrap branch (10+12+row >= 15 for every box row).
  setCamOrigin(mem, 1, 0xc0, 0, 0xa0);
  callRoutine(nes, captureAddr);
  const wrapOrigin = originOracle(1, 0xc0, 0, 0xa0);
  assert.equal(wrapOrigin.ocolL, 12);
  assert.equal(wrapOrigin.orowL, 10);
  for (const c of CELL_CASES) {
    const expectedPos = metatileWorldPos(wrapOrigin, c.row, c.col);
    const expectedId = expectedMetatileId(gridW, gridH, expectedPos.scol, expectedPos.srow, expectedPos.offset, screenSize);
    nes.cpu.REG_ACC = c.row;
    nes.cpu.REG_X = c.col;
    callRoutine(nes, metatileAddr);
    assert.equal(nes.cpu.REG_ACC, expectedId, `col+row-wrap origin, ${c.label}`);
  }

  // Case C: origin screenCol/screenRow already past the grid -- every cell must fall off-grid on
  // the wrapped (screenCol+1) side too, returning sw_fill_metatile_id from sw_terrain_or_fill's
  // own fill path (never a bank switch).
  const fillId = mem[RAM.sw_fill_metatile_id];
  setCamOrigin(mem, gridW, 0, 0, 0);
  callRoutine(nes, captureAddr);
  nes.cpu.REG_ACC = 0;
  nes.cpu.REG_X = 0;
  callRoutine(nes, metatileAddr);
  assert.equal(nes.cpu.REG_ACC, fillId, 'off-grid origin returns the fill metatile id, not a stray read');
});

// ---------------------------------------------------------------------------------------------
// Sabotage: each mutation is applied via project.code.overrides (a scratch copy of
// engine/streamworld.asm with one line changed), never by editing the repository file.
// ---------------------------------------------------------------------------------------------

function readEngineSource(name) {
  return fs.readFileSync(new URL(`../../engine/${name}`, import.meta.url), 'utf8');
}

function mutateOnce(source, oldLine, newLine, label) {
  const count = source.split(oldLine).length - 1;
  assert.equal(count, 1, `sabotage setup: "${oldLine}" must appear exactly once (${label})`);
  return source.replace(oldLine, newLine);
}

async function buildWithStreamworldMutant(t, mutantText, opts = {}) {
  const project = createStreamedProject({ gameType: 'rpg', ...opts });
  project.code = { overrides: [{ name: 'streamworld.asm', text: mutantText }], files: [] };
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-mutant-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const symbols = fs.readFileSync(built.symbolPath, 'utf8');
  const addrOf = (label) => {
    const m = symbols.match(new RegExp(`^${label}\\s+=\\s+\\$([0-9A-Fa-f]+)`, 'm'));
    assert.ok(m, `${label} should be a named symbol in game.fns`);
    return parseInt(m[1], 16);
  };
  const bytes = new Uint8Array(fs.readFileSync(built.romPath));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(bytes);
  return { project, addrOf, nes, mem: nes.cpu.mem };
}

test('sabotage: an off-by-one column wrap threshold (cmp #16 -> cmp #17) is caught by the col-wrap oracle sweep', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('streamworld.asm');
  const mutant = mutateOnce(
    source,
    'sw_dlg_metatile:\n  sta sw_dlg_scr1          ; stash box-relative row; A is about to be reused\n  txa\n  clc\n  adc sw_dlg_ocol_l\n  cmp #16\n',
    'sw_dlg_metatile:\n  sta sw_dlg_scr1          ; stash box-relative row; A is about to be reused\n  txa\n  clc\n  adc sw_dlg_ocol_l\n  cmp #17\n',
    'col wrap threshold off-by-one'
  );
  const { project, addrOf, nes, mem } = await buildWithStreamworldMutant(t, mutant);
  const captureAddr = addrOf('sw_dlg_origin_capture');
  const metatileAddr = addrOf('sw_dlg_metatile');
  const { gridW, gridH, screen } = await primeTerrainState(project, nes, addrOf);
  // ocol = gridW-1 (the last valid screenCol), ocolL = 12 (boxCol 4+ crosses the col-16
  // boundary this mutant misreads), orowL = 3 (raw row 15 for box row 0 -- exactly the row-wrap
  // boundary, landing lrow at 0). A first version of this test picked one cell (box row 0, col 4)
  // and hand-verified it discriminates -- wrong: the streamedScreen generator's own terrain id is
  // `1 + ((screenCol+screenRow+offset) % 3)`, and THIS mutation always shifts (screenCol, offset)
  // together by (-1, +16) when it fires -- a delta of 15, itself a multiple of 3 -- so the mod-3
  // sum the generator keys on is invariant under this exact mutation, on every cell, not merely an
  // unlucky one (confirmed directly: a full 3x16 sweep at the first origin choice produced zero
  // disagreements). Placing the origin one column short of the grid edge sidesteps the mod-3
  // arithmetic entirely: the CORRECT read goes off-grid (screenCol == gridW) and returns the fill
  // sentinel, while the mutant's own unwrapped screenCol stays in-grid and returns a real,
  // guaranteed-nonzero varied-region byte -- a qualitative difference, not a numeric coincidence.
  setCamOrigin(mem, gridW - 1, 0xc0, 0, 0x30);
  callRoutine(nes, captureAddr);
  const origin = originOracle(gridW - 1, 0xc0, 0, 0x30);
  let mismatches = 0;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 16; col++) {
      const expectedPos = metatileWorldPos(origin, row, col);
      const expectedId = expectedMetatileId(gridW, gridH, expectedPos.scol, expectedPos.srow, expectedPos.offset, screen.metatiles.length);
      nes.cpu.REG_ACC = row;
      nes.cpu.REG_X = col;
      callRoutine(nes, metatileAddr);
      if (nes.cpu.REG_ACC !== expectedId) mismatches++;
    }
  }
  assert.ok(mismatches > 0, 'the mutant must disagree with the correct oracle value on at least one of the 48 swept cells');
});

test('sabotage: BOX_MT_ROW omitted from the row computation is caught (every case at a nonzero box row)', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('streamworld.asm');
  const mutant = mutateOnce(
    source,
    'sw_dlgmt_row:\n  lda sw_dlg_scr1          ; the stashed box-relative row\n  clc\n  adc #BOX_MT_ROW\n  clc\n  adc sw_dlg_orow_l\n',
    'sw_dlgmt_row:\n  lda sw_dlg_scr1          ; the stashed box-relative row\n  clc\n  adc sw_dlg_orow_l\n',
    'BOX_MT_ROW dropped from the row add'
  );
  const { project, addrOf, nes, mem } = await buildWithStreamworldMutant(t, mutant);
  const captureAddr = addrOf('sw_dlg_origin_capture');
  const metatileAddr = addrOf('sw_dlg_metatile');
  const { gridW, gridH, screen } = await primeTerrainState(project, nes, addrOf);
  setCamOrigin(mem, 0, 0, 0, 0);
  callRoutine(nes, captureAddr);
  const origin = originOracle(0, 0, 0, 0);
  const expectedPos = metatileWorldPos(origin, 1, 0); // box row 1 -- BOX_MT_ROW's own +12 matters here
  const expectedId = expectedMetatileId(gridW, gridH, expectedPos.scol, expectedPos.srow, expectedPos.offset, screen.metatiles.length);
  nes.cpu.REG_ACC = 1;
  nes.cpu.REG_X = 0;
  callRoutine(nes, metatileAddr);
  assert.notEqual(nes.cpu.REG_ACC, expectedId, 'the mutant must disagree with the correct oracle value once BOX_MT_ROW is missing');
});

test('sabotage: sw_dlg_origin_capture skipping the /240 divmod (screenRow always 0) is caught by a worldY >= 240 case', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('streamworld.asm');
  const mutant = mutateOnce(
    source,
    'sw_dlgoc_ydiv_done:\n  stx sw_dlg_orow\n',
    'sw_dlgoc_ydiv_done:\n  lda #0\n  sta sw_dlg_orow\n',
    'divmod screenRow forced to 0'
  );
  const { addrOf, nes, mem } = await buildWithStreamworldMutant(t, mutant);
  const captureAddr = addrOf('sw_dlg_origin_capture');
  setCamOrigin(mem, 0, 0, 0x01, 0xe0); // worldY = 480 -- two /240 crossings, screenRow must be 2
  callRoutine(nes, captureAddr);
  const expected = originOracle(0, 0, 0x01, 0xe0);
  assert.equal(expected.orow, 2, 'oracle sanity: this worldY really does cross two screens');
  assert.notEqual(mem[SW_DLG_OROW], expected.orow, 'the mutant must disagree with the correct screenRow once the divmod is skipped');
});

// ---------------------------------------------------------------------------------------------
// Kernel budget: STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE now covers 7a's mapper plus
// this commit's origin-capture/metatile addition -- re-asserted here (kernelbytes.test.js already
// covers the general equality; this is a same-file sanity check that the delta this commit
// introduced is real and positive, not an artifact of a stale constant).
// ---------------------------------------------------------------------------------------------

test('sw_dlg_mapper span grew by exactly this commit\'s own addition over the slice-7a baseline (613)', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const { addrOf } = await buildHarness(t);
  const span = addrOf('sw_dlg_mapper_end') - addrOf('sw_dlg_mapper_start');
  assert.ok(span > 613, `span (${span}) must exceed slice 7a's own 613-byte baseline`);
});

// ---------------------------------------------------------------------------------------------
// Case 1 (plan case 1): DLG_PENDING/DLG_DRAINING state-table legality. Every transition the real
// implementation has (sw_dlg15_state is IDLE/PENDING/DRAINING -- the design doc's own longer
// DLG_OPEN_ROW/DLG_OPEN_ATTR/... chain collapsed into reusing the ordinary box_state machine
// itself for the row/attr stepping, so there is no separate state for that here; PENDING and
// DRAINING are the only phases box_state cannot already tell apart from "no box at all" -- see
// engine/constants.asm's own comment on sw_dlg15_state) is exercised directly via callRoutine on
// the real dispatcher (text_tick) and the real per-frame release poll (sw_dlg17_camrelease),
// never re-implemented as a parallel model -- this IS the state table.
// ---------------------------------------------------------------------------------------------

function snapshotLifecycle(mem) {
  return {
    dlgState: mem[SW_DLG15_STATE],
    boxState: mem[BOX_STATE],
    camDirty: mem[CAM_DIRTY],
    camHold: mem[SW_DLG17_CAMHOLD],
    gameState: mem[GAME_STATE],
  };
}

test('case 1: text_tick ignores sw_dlg15_state entirely on a non-streamed map', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  mem[MAP_IS_STREAMED] = 0;
  mem[SW_DLG15_STATE] = SW_DLG15_PENDING; // garbage the ordinary path must never consult
  mem[BOX_STATE] = BOX_CLOSED;
  const before = snapshotLifecycle(mem);
  callRoutine(nes, addrOf('text_tick'));
  assert.deepEqual(snapshotLifecycle(mem), before, 'not streamed: text_tick must be a plain no-op here (box_state was already 0), never touching sw_dlg15_state');
});

test('case 1: text_tick, streamed, IDLE with no box open is a no-op', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  mem[MAP_IS_STREAMED] = 1;
  mem[SW_DLG15_STATE] = SW_DLG15_IDLE;
  mem[BOX_STATE] = BOX_CLOSED;
  const before = snapshotLifecycle(mem);
  callRoutine(nes, addrOf('text_tick'));
  assert.deepEqual(snapshotLifecycle(mem), before, 'IDLE + no box: text_tick must do nothing');
});

test('case 1: text_tick, streamed, PENDING while the strip is active holds (self-loop, no transition)', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  mem[MAP_IS_STREAMED] = 1;
  mem[SW_DLG15_STATE] = SW_DLG15_PENDING;
  mem[BOX_STATE] = BOX_CLOSED;
  mem[ST_ACTIVE] = 1; // a strip is (simulated) in flight
  mem[CAM_DIRTY] = 0;
  mem[SW_DLG17_CAMHOLD] = 0;
  callRoutine(nes, addrOf('text_tick'));
  assert.equal(mem[SW_DLG15_STATE], SW_DLG15_PENDING, 'must still be waiting -- st_active was nonzero');
  assert.equal(mem[BOX_STATE], BOX_CLOSED, 'must not open the box while the strip is still active');
  assert.equal(mem[CAM_DIRTY], 0, 'must not touch the camera hold while waiting');
  assert.equal(mem[SW_DLG17_CAMHOLD], 0);
});

test('case 1 sabotage: removing sw_dlg15_pending_step\'s own st_active guard opens the box while the strip is still in flight', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('streamworld.asm');
  const needle = 'sw_dlg15_pending_step:\n  lda st_active\n  bne sw_dlg15p_wait\n';
  const mutant = mutateOnce(source, needle, needle.replace('  bne sw_dlg15p_wait\n', ''), 'sw_dlg15_pending_step st_active guard removal (case 1 sabotage)');

  const project = createStreamedProject({ gameType: 'rpg' });
  project.code = { overrides: [{ name: 'streamworld.asm', text: mutant }], files: [] };
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-c1sab-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const symbols = fs.readFileSync(built.symbolPath, 'utf8');
  const addrOf = (label) => {
    const m = symbols.match(new RegExp(`^${label}\\s+=\\s+\\$([0-9A-Fa-f]+)`, 'm'));
    assert.ok(m, `${label} should be a named symbol in game.fns`);
    return parseInt(m[1], 16);
  };
  const bytes = new Uint8Array(fs.readFileSync(built.romPath));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(bytes);
  const mem = nes.cpu.mem;

  mem[MAP_IS_STREAMED] = 1;
  mem[SW_DLG15_STATE] = SW_DLG15_PENDING;
  mem[BOX_STATE] = BOX_CLOSED;
  mem[ST_ACTIVE] = 1; // a strip is (simulated) in flight -- the removed guard must have gated on this
  mem[CAM_DIRTY] = 0;
  mem[SW_DLG17_CAMHOLD] = 0;
  callRoutine(nes, addrOf('text_tick'));
  assert.notEqual(mem[SW_DLG15_STATE], SW_DLG15_PENDING, 'without the guard, PENDING must wrongly advance even though st_active is still nonzero -- a correct-looking test that could not tell this apart from the positive case above (which stays PENDING) would be worthless');
});

test('case 1: text_tick, streamed, PENDING with an idle strip transitions to IDLE and opens the box, floors the camera, raises the hold', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  mem[MAP_IS_STREAMED] = 1;
  mem[SW_DLG15_STATE] = SW_DLG15_PENDING;
  mem[BOX_STATE] = BOX_CLOSED;
  mem[ST_ACTIVE] = 0;
  mem[CAM_DIRTY] = 0;
  mem[SW_DLG17_CAMHOLD] = 0;
  mem[CAM_X_LO] = 0x37;
  mem[CAM_Y_LO] = 0x59;
  mem[SW_CAM_ORIGIN_X_LO] = 0x37;
  mem[SW_CAM_ORIGIN_X_HI] = 2;
  mem[SW_CAM_ORIGIN_Y_LO] = 0x59;
  mem[SW_CAM_ORIGIN_Y_HI] = 1;

  callRoutine(nes, addrOf('text_tick'));

  assert.equal(mem[SW_DLG15_STATE], SW_DLG15_IDLE, 'must transition PENDING -> IDLE once the strip is idle');
  assert.equal(mem[BOX_STATE], BOX_OPENING, 'must complete box_begin\'s own deferred transition (BOX_OPENING)');
  // Fix round 1, finding A1: sw_dlg_lifecycle_open_start/_end (engine/streamworld.asm) now
  // acquires cam_dirty, floors the camera, rebuilds OAM against the floored value, THEN releases
  // -- all within this one call -- rather than leaving cam_dirty raised for the whole PENDING ->
  // DRAINING span the way the pre-fix routine did. By the time this routine returns, cam_dirty
  // must already be back to 0: the publication lock now only brackets the rebuild, never the
  // conversation itself (see the case 2 tests below for the observable consequence of this).
  assert.equal(mem[CAM_DIRTY], 0, 'must NOT leave the camera/OAM publication lock raised past this call -- it only brackets the rebuild, not the whole hold');
  assert.equal(mem[SW_DLG17_CAMHOLD], 1, 'must set sw_dlg17_camhold -- the persistent "a hold is logically open" flag, distinct from cam_dirty');
  assert.equal(mem[CAM_X_LO], 0x37 & 0xf0, 'cam_x_lo must be floored to a 16px boundary');
  assert.equal(mem[CAM_Y_LO], 0x59 & 0xf0, 'cam_y_lo must be floored to a 16px boundary');
  assert.equal(mem[SW_CAM_ORIGIN_X_LO], 0x37 & 0xf0, 'sw_cam_origin_x_lo must be floored too');
  assert.equal(mem[SW_CAM_ORIGIN_Y_LO], 0x59 & 0xf0, 'sw_cam_origin_y_lo must be floored too');
  assert.equal(mem[SW_CAM_ORIGIN_X_HI], 2, 'the hi byte is never touched by a floor');
  assert.equal(mem[SW_CAM_ORIGIN_Y_HI], 1, 'the hi byte is never touched by a floor');
  // The un-nudge must be able to restore the EXACT pre-floor values, never re-derive them.
  assert.equal(mem[SW_DLG_CAM_X_LO], 0x37, 'the pre-floor cam_x_lo snapshot must be exact');
  assert.equal(mem[SW_DLG_CAM_Y_LO], 0x59, 'the pre-floor cam_y_lo snapshot must be exact');
  assert.equal(mem[SW_DLG15_ORIGIN_X_LO], 0x37, 'the pre-floor origin x_lo snapshot must be exact');
  assert.equal(mem[SW_DLG15_ORIGIN_X_HI], 2);
  assert.equal(mem[SW_DLG15_ORIGIN_Y_LO], 0x59, 'the pre-floor origin y_lo snapshot must be exact');
  assert.equal(mem[SW_DLG15_ORIGIN_Y_HI], 1);
});

test('case 1: text_tick, streamed, DRAINING is untouched by text_tick (only main_loop_idle\'s camrelease ends it)', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  mem[MAP_IS_STREAMED] = 1;
  mem[SW_DLG15_STATE] = SW_DLG15_DRAINING;
  mem[BOX_STATE] = BOX_CLOSED; // real invariant: box_state is always 0 throughout DRAINING
  const before = snapshotLifecycle(mem);
  callRoutine(nes, addrOf('text_tick'));
  assert.deepEqual(snapshotLifecycle(mem), before, 'DRAINING must never transition via text_tick -- sw_dlg17_camrelease is the only path out');
});

test('case 1: sw_dlg17_camrelease no-ops unless camhold is set, state is DRAINING, AND vram_ready reads 0 -- each guard tested independently', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  const setup = () => {
    mem[SW_DLG15_STATE] = SW_DLG15_DRAINING;
    mem[SW_DLG17_CAMHOLD] = 1;
    mem[VRAM_READY] = 0;
    // Fix round 1, finding A1: cam_dirty is never left raised across a frame boundary any more --
    // it is acquired and released within sw_dlg15_pending_step's own single call at open, so by
    // the time DRAINING is reached (let alone held there across many real frames), it always
    // reads 0. sw_dlg17_camhold is the persistent "a hold is logically open" flag this routine
    // actually gates on.
    mem[CAM_DIRTY] = 0;
    mem[GAME_STATE] = ST_DIALOG;
    mem[SW_DLG_CAM_X_LO] = 0x99;
    mem[SW_DLG_CAM_Y_LO] = 0x77;
    mem[CAM_X_LO] = 0x11;
    mem[CAM_Y_LO] = 0x22;
    mem[SW_DLG15_ORIGIN_X_LO] = 0x60;
    mem[SW_DLG15_ORIGIN_X_HI] = 3;
    mem[SW_DLG15_ORIGIN_Y_LO] = 0x40;
    mem[SW_DLG15_ORIGIN_Y_HI] = 1;
    mem[SW_CAM_ORIGIN_X_LO] = 0x00;
    mem[SW_CAM_ORIGIN_X_HI] = 0;
    mem[SW_CAM_ORIGIN_Y_LO] = 0x00;
    mem[SW_CAM_ORIGIN_Y_HI] = 0;
  };

  // Guard 1: camhold == 0 -- must no-op regardless of state.
  setup();
  mem[SW_DLG17_CAMHOLD] = 0;
  let before = snapshotLifecycle(mem);
  callRoutine(nes, addrOf('sw_dlg17_camrelease'));
  assert.deepEqual(snapshotLifecycle(mem), before, 'camhold==0 must no-op');

  // Guard 2: state != DRAINING (e.g. IDLE) -- must no-op even with camhold set.
  setup();
  mem[SW_DLG15_STATE] = SW_DLG15_IDLE;
  before = snapshotLifecycle(mem);
  callRoutine(nes, addrOf('sw_dlg17_camrelease'));
  assert.deepEqual(snapshotLifecycle(mem), before, 'state != DRAINING must no-op even with camhold set');

  // Guard 3: vram_ready != 0 -- the drain has not actually finished yet.
  setup();
  mem[VRAM_READY] = 7;
  before = snapshotLifecycle(mem);
  callRoutine(nes, addrOf('sw_dlg17_camrelease'));
  assert.deepEqual(snapshotLifecycle(mem), before, 'vram_ready != 0 must no-op -- the drain has not finished');

  // All three satisfied: must fire -- restore verbatim, release the hold, DRAINING -> IDLE, close_ui.
  setup();
  callRoutine(nes, addrOf('sw_dlg17_camrelease'));
  assert.equal(mem[SW_DLG15_STATE], SW_DLG15_IDLE, 'must transition DRAINING -> IDLE');
  assert.equal(mem[SW_DLG17_CAMHOLD], 0, 'must clear the hold');
  assert.equal(mem[CAM_DIRTY], 0, 'must release the camera/OAM publication lock (cam_dirty dec)');
  assert.equal(mem[CAM_X_LO], 0x99, 'must restore cam_x_lo verbatim from the pre-floor snapshot, never re-derive it');
  assert.equal(mem[CAM_Y_LO], 0x77, 'must restore cam_y_lo verbatim from the pre-floor snapshot');
  assert.equal(mem[SW_CAM_ORIGIN_X_LO], 0x60, 'must restore sw_cam_origin_x_lo verbatim from the pre-floor snapshot');
  assert.equal(mem[SW_CAM_ORIGIN_X_HI], 3, 'must restore sw_cam_origin_x_hi verbatim');
  assert.equal(mem[SW_CAM_ORIGIN_Y_LO], 0x40, 'must restore sw_cam_origin_y_lo verbatim');
  assert.equal(mem[SW_CAM_ORIGIN_Y_HI], 1, 'must restore sw_cam_origin_y_hi verbatim');
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'must reach close_ui, which resets game_state to ST_GAMEPLAY');
});

// Round 2, finding A7 case 1: the tests above cover the lifecycle's own snippets in isolation
// (a single guard, a single transition). This enumerates the COMBINED box/lifecycle machine as
// one ordered table of legal transitions, and drives one real two-page conversation end to end --
// through the opening row phase, typing, the closing row/attribute phase, AND a same-box reuse for
// a second page -- asserting the real, observed sequence of (sw_dlg15_state, box_state) pairs is
// exactly this table, in this order, with nothing extra and nothing skipped. box_begin's own
// `bne box_begin_clear` check (engine/text.asm) runs BEFORE the streamed dispatch, so a same-box
// reuse (box_state already nonzero, e.g. the second page of a two-page Say) is the one REJECTED
// transition this table also has to prove: it must be routed straight to box_begin_clear and must
// never touch sw_dlg15_state, sw_dlg17_camhold, or cam_dirty a second time.
const LIFECYCLE_TABLE = [
  [SW_DLG15_IDLE, BOX_CLOSED, 'before the interact: nothing open'],
  [SW_DLG15_IDLE, BOX_OPENING, 'PENDING resolved (no strip in flight, so it is not separately observable here -- case 1\'s own dedicated test above holds it visible with a strip active) and the box is raising, row by row'],
  [SW_DLG15_IDLE, BOX_TYPING, 'page 1 typing'],
  [SW_DLG15_IDLE, BOX_ENDWAIT, 'page 1 finished, waiting for the player to advance'],
  [SW_DLG15_IDLE, BOX_CLEARING, 'REJECTED transition proven here: box_begin was called again for page 2 while box_state was still ENDWAIT (nonzero) -- box_begin\'s own bne routes this straight to box_begin_clear, never reaching sw_dlg_hi_box_begin, so sw_dlg15_state never revisits PENDING for a same-box reuse'],
  [SW_DLG15_IDLE, BOX_TYPING, 'page 2 typing -- text_clear_step drives CLEARING straight to TYPING on its own; the frame/rows are already up from page 1, so there is no second OPENING row-raise for a same-box reuse'],
  [SW_DLG15_IDLE, BOX_ENDWAIT, 'page 2 finished'],
  [SW_DLG15_IDLE, BOX_CLOSING, 'closing row/attribute phase'],
  [SW_DLG15_DRAINING, BOX_CLOSED, 'case 3: box_state already reads BOX_CLOSED the instant DRAINING begins'],
  [SW_DLG15_IDLE, BOX_CLOSED, 'sw_dlg17_camrelease fired once vram_ready read 0: DRAINING -> IDLE, game_state -> ST_GAMEPLAY'],
];

// Round 3b, gap 4 (handoff-next/brief-streamed-worlds-phase2-s7b-fix3b.md item 4): LIFECYCLE_TABLE
// above is the exact real trace THIS ONE two-page Say conversation drives -- it does not, by
// itself, enumerate every guarded transition/self-loop/rejection the combined (sw_dlg15_state,
// box_state) machine actually has, several of which this one project/conversation shape cannot
// reach on its own. TRANSITION_TABLE is that complete enumeration: every row names its own kind
// (legal / self-loop / rejected), its own guard condition, whether THIS test's own real frames
// separately observe it, and -- for a row this test cannot reach -- the file:line where it is
// asserted instead, so nothing is silently dropped from the accounting.
const TRANSITION_TABLE = [
  {
    label: '(IDLE, CLOSED) -- before any interact: nothing streamed-specific is open or pending',
    kind: 'legal', guard: 'none (the rest state)', reachedHere: true, pair: [SW_DLG15_IDLE, BOX_CLOSED],
  },
  {
    label: '(PENDING, CLOSED) self-loop -- box_begin has deferred to sw_dlg15_pending_step, waiting for a strip already in flight to finish',
    kind: 'self-loop', guard: 'st_active != 0', reachedHere: false, pair: [SW_DLG15_PENDING, BOX_CLOSED],
    reason: 'this conversation\'s own walk never arms a strip mid-interact, so st_active already reads 0 the instant box_begin runs, and PENDING resolves to IDLE within the SAME real frame box_begin itself runs (the isolated test at test/unit/streamworlddialogue.test.js:733-773 proves this exact immediate resolution) -- so PENDING is never separately sampled in this conversation\'s own per-frame trace at all (LIFECYCLE_TABLE\'s own row 1 comment already records this). The self-loop itself -- st_active nonzero actually holding PENDING across more than one real frame -- is asserted directly by the isolated unit test at test/unit/streamworlddialogue.test.js:686-699 (hand-set st_active) and, as a genuine real production mechanism (a real armed strip, real per-frame NMI drain, real per-frame sampling, no hand-poked flag on either side), by the "case 8: a genuinely armed real strip..." positive test at test/unit/streamworlddialogue.test.js:2295-2379.',
  },
  {
    label: '(PENDING, CLOSED) -> (IDLE, OPENING) -- the strip (if any) has finished: box_begin\'s own deferred open completes, box_row starts its row/attribute self-loop, cam_dirty is acquired/floored/released within this one call, sw_dlg17_camhold is raised',
    kind: 'legal', guard: 'st_active == 0',
    reachedHere: true, pair: [SW_DLG15_IDLE, BOX_OPENING], // only the POST-transition (IDLE, OPENING) state is separately sampled here -- see the PENDING self-loop row above for why PENDING itself never is
  },
  {
    label: '(IDLE, OPENING) row/attribute self-loop -- box_row advances 0..8 (six row-draw/lower frames, contract §7, then three masked attribute-band frames, fix round 1 A6) one frame at a time; cam_dirty stays released and sw_dlg17_camhold stays raised throughout',
    kind: 'self-loop', guard: 'box_row phase (0-8); cam_dirty == 0; sw_dlg17_camhold == 1',
    reachedHere: true, pair: [SW_DLG15_IDLE, BOX_OPENING], // rowRuns[0], asserted below (EXPECTED_OPEN_ROWS, camDirty, camHold); same pair as the row above -- this is the HOLD, not a distinct visited state
  },
  {
    label: '(IDLE, TYPING) page 1 -- text_tick advances the message glyph by glyph',
    kind: 'legal', guard: 'box_handover\'s own dispatch off the third attribute band', reachedHere: true, pair: [SW_DLG15_IDLE, BOX_TYPING],
  },
  {
    label: '(IDLE, ENDWAIT) page 1 self-loop -- message finished, waiting for the player to press B to advance',
    kind: 'self-loop', guard: 'player input (B not yet pressed)', reachedHere: true, pair: [SW_DLG15_IDLE, BOX_ENDWAIT],
  },
  {
    label: '(IDLE, CLEARING) REJECTED -- box_begin is called again for page 2 while box_state is still ENDWAIT (nonzero): box_begin\'s own bne routes this straight to box_begin_clear, never reaching sw_dlg_hi_box_begin, so sw_dlg15_state never revisits PENDING for a same-box reuse',
    kind: 'rejected', guard: 'box_state != BOX_CLOSED at the instant box_begin is called (engine/text.asm\'s own bne box_begin_clear)',
    reachedHere: true, pair: [SW_DLG15_IDLE, BOX_CLEARING], // LIFECYCLE_TABLE's own row 4; camHoldRisingEdges asserted == 1 below proves the reject (no second arm)
  },
  {
    label: '(IDLE, TYPING) page 2 -- text_clear_step drives CLEARING straight to TYPING on its own; no second OPENING row-raise for a same-box reuse',
    kind: 'legal', guard: 'text_clear_step\'s own dispatch', reachedHere: true, pair: [SW_DLG15_IDLE, BOX_TYPING],
  },
  {
    label: '(IDLE, ENDWAIT) page 2 self-loop -- finished, waiting for the player to close',
    kind: 'self-loop', guard: 'player input (B not yet pressed)', reachedHere: true, pair: [SW_DLG15_IDLE, BOX_ENDWAIT],
  },
  {
    label: '(IDLE, CLOSING) row/attribute self-loop -- box_row advances 1..8 (row 0 fuses into the same frame as the close request, box_close\'s own comment); cam_dirty released except the one-frame close_a/close_b rebuild bracket (case 2\'s own A1 finding); sw_dlg17_camhold still raised',
    kind: 'self-loop', guard: 'box_row phase (1-8); cam_dirty == 0 (except the one-frame rebuild bracket); sw_dlg17_camhold == 1',
    reachedHere: true, pair: [SW_DLG15_IDLE, BOX_CLOSING], // rowRuns[1], asserted below (EXPECTED_CLOSE_ROWS, camDirty, camHold)
  },
  {
    label: '(DRAINING, CLOSED) self-loop -- the close-attribute packet\'s own third band is still queued: game_state stays ST_DIALOG, sw_dlg17_camhold stays raised, box_state already reads CLOSED (case 3\'s own real gap-frame finding)',
    kind: 'self-loop', guard: 'vram_ready != 0',
    reachedHere: 'partial', pair: [SW_DLG15_DRAINING, BOX_CLOSED],
    reason: 'this conversation\'s own tiny 2-char close-attribute packet may drain within a single sampled real frame, so this self-loop may not show as a MULTI-frame hold in this run\'s own st_active/vram_ready sampling below (asserted directly either way: st_active stays 0 and, once observed, vram_ready falls to 0 before IDLE is reached). A multi-real-frame HOLD of this identical real packet (long enough to sample vram_ready != 0 on several distinct real frames) is asserted directly by the "round 3, finding A7 case 8" positive test at test/unit/streamworlddialogue.test.js:2520-2589 (its own held-frame loop, :2558-2571 -- a controlled delay of the real consumer\'s own VRAM acknowledgement holds it outstanding for 5 real frames, while frame signalling and the main loop both keep running); the three guards\' own independence (camhold/state/vram_ready) is asserted individually by the isolated test at test/unit/streamworlddialogue.test.js:785-846.',
  },
  {
    label: '(DRAINING, CLOSED) -> (IDLE, CLOSED) -- sw_dlg17_camrelease fires once vram_ready reads 0: restores cam_x_lo/y_lo and sw_cam_origin_*_lo/hi verbatim, clears sw_dlg17_camhold, releases cam_dirty, game_state -> ST_GAMEPLAY',
    kind: 'legal', guard: 'sw_dlg17_camhold == 1 AND sw_dlg15_state == DRAINING AND vram_ready == 0 (all three independently, per test/unit/streamworlddialogue.test.js:785-846)',
    reachedHere: true, pair: [SW_DLG15_IDLE, BOX_CLOSED],
  },
];

test('case 1: the complete real two-page streamed conversation visits exactly the enumerated legal (dlg_state, box_state) transitions in order, including the opening/closing row phases -- and a same-box reuse for page 2 is routed around the streamed dispatch entirely, never re-raising the hold', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({});
  const slot = interactEntity(project, {
    x: 200, y: 112,
    commands: [{ op: 'say', text: 'AB' }, { op: 'say', text: 'CD' }],
  });
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll)');

  const observed = [[mem[SW_DLG15_STATE], mem[BOX_STATE]]];
  let camHoldRisingEdges = 0;
  let lastCamHold = mem[SW_DLG17_CAMHOLD];
  // Round 3, finding A7 case 1: the (dlg_state, box_state) pair alone collapses every individual
  // row-raise/row-lower and attribute-band frame into one BOX_OPENING/BOX_CLOSING entry -- box_row
  // is what actually moves frame by frame during those spans. For a streamed map (this project),
  // sw_dlg_hi_open_attr/sw_dlg_hi_close_attr (engine/streamworld.asm, fix round 1 A6) split the
  // attribute step itself into three masked bands -- one per frame, box_row BOX_ROWS_HIGH(6),
  // BOX_ROWS_HIGH+1(7), BOX_ROWS_HIGH+2(8) -- per contract §7's "six row frames PLUS THREE
  // attribute frames" requirement, before the third band's own call chains into box_handover (open)
  // or text_close_attr_tail (close). So the real, full box_row sequence for one open or close is
  // nine frames: 0-5 (row draw/lower, text_open_step/text_close_step) then 6-8 (attribute bands).
  // Recorded here as separate runs (one per contiguous span of the same (dlg,box) pair) so each
  // run's own box_row sequence -- and each run's own guard condition (dlg_state/cam_dirty/camhold
  // held fixed while box_row alone advances: the row/attribute phase's own self-loop) -- can be
  // asserted independently, split below into the row-draw sub-sequence and the attribute-band
  // sub-sequence.
  const rowRuns = [];
  // Round 3b, gap 4: TRANSITION_TABLE's own two guards this real trace can actually sample --
  // st_active (the PENDING self-loop's guard) and vram_ready (the DRAINING self-loop's guard) --
  // recorded on every frame, not merely at the transitions, so the table's own claims about them
  // can be checked against this real run rather than merely reasoned about.
  const stActiveSamples = [];
  const vramReadySamplesByPair = [];
  const sample = () => {
    const last = observed[observed.length - 1];
    if (mem[SW_DLG15_STATE] !== last[0] || mem[BOX_STATE] !== last[1]) observed.push([mem[SW_DLG15_STATE], mem[BOX_STATE]]);
    if (mem[SW_DLG17_CAMHOLD] === 1 && lastCamHold === 0) camHoldRisingEdges++;
    lastCamHold = mem[SW_DLG17_CAMHOLD];
    stActiveSamples.push(mem[ST_ACTIVE]);
    if (mem[SW_DLG15_STATE] === SW_DLG15_DRAINING) vramReadySamplesByPair.push(mem[VRAM_READY]);
    if (mem[BOX_STATE] === BOX_OPENING || mem[BOX_STATE] === BOX_CLOSING) {
      const run = rowRuns[rowRuns.length - 1];
      if (run && run.boxState === mem[BOX_STATE] && run.dlgState === mem[SW_DLG15_STATE] && run.rows[run.rows.length - 1] !== mem[BOX_ROW]) {
        run.rows.push(mem[BOX_ROW]);
        run.camDirty.push(mem[CAM_DIRTY]);
        run.camHold.push(mem[SW_DLG17_CAMHOLD]);
      } else if (!run || run.boxState !== mem[BOX_STATE] || run.rows[0] !== mem[BOX_ROW]) {
        rowRuns.push({ boxState: mem[BOX_STATE], dlgState: mem[SW_DLG15_STATE], rows: [mem[BOX_ROW]], camDirty: [mem[CAM_DIRTY]], camHold: [mem[SW_DLG17_CAMHOLD]] });
      }
    }
  };

  let frames = 0;
  nes.buttonDown(1, B);
  nes.frame(); sample();
  frames++;
  nes.buttonUp(1, B);
  while (mem[GAME_STATE] !== ST_GAMEPLAY && frames < 400) {
    if (mem[BOX_STATE] === BOX_ENDWAIT) {
      nes.buttonDown(1, B);
      nes.frame(); sample();
      nes.buttonUp(1, B);
    } else {
      nes.frame(); sample();
    }
    frames++;
  }
  assert.ok(frames < 400, 'the whole two-page conversation must finish within budget');
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'must end back in ordinary gameplay');

  assert.deepEqual(
    observed,
    LIFECYCLE_TABLE.map(([dlg, box]) => [dlg, box]),
    `the real, observed transition sequence must match the enumerated legal table exactly (with reasons):\n${LIFECYCLE_TABLE.map(([dlg, box, why], i) => `  ${i}. dlg=${dlg} box=${box} -- ${why}`).join('\n')}`
  );
  assert.equal(camHoldRisingEdges, 1, 'the hold must be raised exactly once for the whole two-page conversation -- the page-2 same-box reuse must not re-arm it a second time');

  // Exactly two row-phase runs must have been observed: page 1's own opening raise, and the whole
  // conversation's single closing lower -- page 2's own same-box reuse (box_begin_clear) must never
  // produce a second BOX_OPENING run, the REJECTED transition LIFECYCLE_TABLE's own row 4 names.
  assert.equal(rowRuns.length, 2, `exactly one opening run and one closing run must occur -- page 2's own same-box reuse must never re-enter BOX_OPENING:\n${JSON.stringify(rowRuns)}`);
  const EXPECTED_OPEN_ROWS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  // box_close (engine/text.asm) -- reached from do_action's own B-press dispatch through
  // script_finish, ahead of ui_tick in main_loop's own per-frame order -- sets box_row=0/
  // box_state=BOX_CLOSING and returns; ui_tick's text_tick then runs LATER THE SAME FRAME, sees
  // BOX_CLOSING and dispatches straight into text_close_step, which draws row 0 and increments
  // box_row to 1 before that frame ends. box_begin's own PENDING dispatch has no such same-frame
  // successor call (sw_dlg_hi_text_tick's own comment: "its own rts answers for ours"), so
  // opening's box_row=0 frame is separately observable but closing's never is -- box_row=0 is
  // drawn and left behind within the very frame the close was requested, for any real player, not
  // only this test's own button-press-then-frame driving order.
  const EXPECTED_CLOSE_ROWS = [1, 2, 3, 4, 5, 6, 7, 8];
  const HELD = new Array(9).fill(1);
  const RELEASED = new Array(9).fill(0);
  const [openingRun, closingRun] = rowRuns;
  assert.equal(openingRun.boxState, BOX_OPENING, 'the first row-phase run must be page 1\'s own opening raise');
  assert.deepEqual(openingRun.rows, EXPECTED_OPEN_ROWS, 'the opening raise must step box_row exactly once per frame through the 6 row-draw frames then the 3 masked attribute-band frames (contract §7), in order, with nothing skipped or repeated');
  assert.deepEqual(openingRun.camDirty, RELEASED, 'the publication lock must already be released for the entirety of the row-draw and attribute-band self-loop (case 2\'s own finding: it only brackets the earlier PENDING->IDLE rebuild, never the row/attr phases)');
  assert.deepEqual(openingRun.camHold, HELD, 'the logical hold must stay raised (self-loop guard condition) for the whole opening row and attribute-band phase');
  assert.equal(closingRun.boxState, BOX_CLOSING, 'the second row-phase run must be the whole conversation\'s own closing lower (page 1 and page 2 share one box, so there is only one close)');
  assert.deepEqual(closingRun.rows, EXPECTED_CLOSE_ROWS, 'the closing lower must step box_row exactly once per frame through the remaining 7 row-lower/attribute-band frames (row 0 fuses into the same frame as the close request, above), in order, with nothing skipped or repeated');
  assert.deepEqual(closingRun.camDirty, RELEASED.slice(1), 'the publication lock must stay released for the entirety of the closing row and attribute-band phase too -- it is only re-acquired at the close_a/close_b rebuild, one frame after box_row=8 hands off (case 2\'s own A1 finding)');
  assert.deepEqual(closingRun.camHold, HELD.slice(1), 'the logical hold must still read raised (self-loop guard condition) throughout the closing row and attribute-band phase -- it is not cleared until sw_dlg17_camrelease fires, after DRAINING');

  // The third attribute band's own handoff: the frame immediately after box_row last read 8 in each
  // run must show the handed-off state with box_row reset -- sw_dlg_hi_open_attr's third band ->
  // box_handover for the open (box_state -> BOX_TYPING, box_row -> 0, dispatched by page 1's own
  // real Say), and sw_dlg_hi_close_attr's third band -> text_close_attr_tail for the close
  // (box_state -> BOX_CLOSED, dlg_state -> SW_DLG15_DRAINING, in the very same call, proven already
  // by case 3's own dedicated test above).
  const openIndex = observed.findIndex(([dlg, box]) => dlg === SW_DLG15_IDLE && box === BOX_TYPING);
  assert.ok(openIndex > 0, 'the enumerated table must contain the post-attribute TYPING entry the opening run hands off into');
  const closeIndex = observed.findIndex(([dlg, box]) => dlg === SW_DLG15_DRAINING && box === BOX_CLOSED);
  assert.ok(closeIndex > 0, 'the enumerated table must contain the post-attribute DRAINING/CLOSED entry the closing run hands off into');

  // Round 3b, gap 4: TRANSITION_TABLE's own guard-value claims, checked against this real trace.
  assert.ok(stActiveSamples.length > 0, 'sanity: at least one real frame must have been sampled');
  assert.ok(stActiveSamples.every((v) => v === 0), `st_active must read 0 at every sampled real frame of this whole conversation -- the PENDING self-loop's own guard is never true here (no strip is armed by this project/walk), and (case 8's own invariant) nothing in a real conversation can arm one once the box is open: ${JSON.stringify(stActiveSamples)}`);
  // Every sampled frame with dlg_state still DRAINING must show vram_ready still 1 (not yet
  // drained) -- confirmed directly (a temporary probe on this exact run recorded exactly one
  // such frame, value 1). sw_dlg17_camrelease (engine/streamworld.asm:4565) only advances out of
  // DRAINING once vram_ready reads 0, but per this file's own :2312 finding NMI runs before
  // mainline within one nes.frame() call, so the SAME frame NMI's vram_drain clears vram_ready to
  // 0 is the SAME frame sw_dlg17_camrelease (mainline, later that frame) sees it and releases --
  // the state has already moved on to whatever DRAINING resolves to by the time JS-side sample()
  // reads memory after that frame, so a vram_ready===0 sample gated on dlg_state===DRAINING is
  // never observable this way; only the still-queued (1) frame(s) preceding it are.
  assert.ok(vramReadySamplesByPair.length > 0, 'at least one real frame must be sampled while dlg_state reads DRAINING');
  assert.ok(vramReadySamplesByPair.every((v) => v === 1), `every sampled DRAINING frame in this real conversation must show vram_ready still 1 (still queued, not yet drained) -- the drain-and-release happen together in the one frame that follows, which this per-state-gated sampling cannot itself observe: ${JSON.stringify(vramReadySamplesByPair)}`);

  // TRANSITION_TABLE's own bookkeeping: every row this real conversation does not itself reach
  // must cite a file:line where it is asserted instead -- never silently dropped from the
  // accounting (the smallest acceptable repair gap 4 asks for).
  for (const row of TRANSITION_TABLE) {
    if (row.reachedHere !== true) {
      assert.equal(typeof row.reason, 'string', `an unreached transition must carry a reason: ${row.label}`);
      assert.match(row.reason, /streamworlddialogue\.test\.js:\d+/, `an unreached transition's reason must cite a file:line where it is asserted instead: ${row.label}`);
    }
  }
  // Every row TRANSITION_TABLE marks as reached here (true or 'partial') names a (dlg_state,
  // box_state) pair; a self-loop row and the legal row that first enters the same state
  // deliberately name the SAME pair (arrival versus holding are different table entries, but the
  // same real observed state), and page 1 versus page 2 revisit the same (IDLE, TYPING) /
  // (IDLE, ENDWAIT) pair values at two different points in the real sequence -- so the right
  // check is set equality of DISTINCT pairs, not a row count: the set of pairs every reached
  // TRANSITION_TABLE row names must equal the set of distinct pairs LIFECYCLE_TABLE's own real
  // trace actually visited.
  const pairKey = (d, b) => `${d},${b}`;
  const observedPairSet = new Set(LIFECYCLE_TABLE.map(([d, b]) => pairKey(d, b)));
  const reachedRows = TRANSITION_TABLE.filter((r) => r.reachedHere === true || r.reachedHere === 'partial');
  const reachedPairSet = new Set(reachedRows.map((r) => pairKey(r.pair[0], r.pair[1])));
  for (const row of reachedRows) {
    const key = pairKey(row.pair[0], row.pair[1]);
    assert.ok(observedPairSet.has(key), `TRANSITION_TABLE marks this row reached, but its pair (${key}) was never actually observed in LIFECYCLE_TABLE's real trace: ${row.label}`);
  }
  for (const key of observedPairSet) {
    assert.ok(reachedPairSet.has(key), `LIFECYCLE_TABLE's real trace visited pair (${key}), but no TRANSITION_TABLE row marked reached names it -- the enumeration is incomplete`);
  }
  assert.equal(reachedPairSet.size, observedPairSet.size, 'TRANSITION_TABLE\'s reached pairs and LIFECYCLE_TABLE\'s observed pairs must be the exact same set, neither a superset nor a subset of the other');
  const reachedSelfLoops = TRANSITION_TABLE.filter((r) => r.kind === 'self-loop' && r.reachedHere === true).length;
  assert.equal(reachedSelfLoops, 4, 'exactly four self-loop rows are marked fully reached by this real conversation -- the opening and closing row/attribute phases (rowRuns[0]/rowRuns[1]) and the page 1/page 2 ENDWAIT player-input holds (this test\'s own frame loop waits in BOX_ENDWAIT before pressing B, both times) -- the PENDING self-loop is reachedHere:false and the DRAINING self-loop is \'partial\' (not true), and every self-loop not marked true must cite its own file:line elsewhere instead');
});

// ---------------------------------------------------------------------------------------------
// Case 2 (plan case 2): the camera/OAM publication barrier. Fix round 1, finding A1 rewrote this
// from a whole-conversation freeze into a one-frame bracket: cam_dirty is now acquired, the
// camera is floored/restored, OAM is rebuilt (build_oam/draw_entities) against the NEW value,
// and ONLY THEN is cam_dirty released -- all inside the same routine call, on the same mainline
// frame (sw_dlg_lifecycle_open_start/_end and sw_dlg_lifecycle_close_a/_b, engine/streamworld.asm).
// The world itself stays motionless for the whole PENDING->DRAINING span through a completely
// different, pre-existing mechanism (game_state != ST_GAMEPLAY keeps update_player from running),
// so cam_dirty no longer needs to (and, after this fix, never does) stay raised for that whole
// span -- by the time any frame's own mainline code returns control past this routine, cam_dirty
// already reads 0 again. The OLD "real PPU OAM freezes for the whole hold" test asserted exactly
// the incorrect whole-conversation-freeze premise the review named
// (review-phase2-s7b-round1-findings.md, finding A1: "Current case 2 explicitly asserts the
// incorrect whole-conversation OAM freeze ... and must change").
//
// What IS still true, and is what these tests now assert: the rebuild-before-release ordering
// means the hardware OAM ($4014 DMA target, nes.ppu.spriteMem) that a given frame's own NMI
// publishes must already match that SAME frame's shadow OAM ($0200, mem[0x0200+n] -- what
// build_oam/draw_entities just wrote) at both the open (nudge) and close (un-nudge) transitions.
// The bug this fix closed was a real, deterministic one-frame lag, not a race: the review's own
// walk/interact/open/close probe recorded the close-side restore running in main_loop_idle AFTER
// main_loop_draw had already generated that frame's OAM from the (still-floored) pre-restore
// camera, producing a real, visible one-frame, 14-pixel sprite pop. Driven through the real
// lifecycle (walk, interact, type, close), never a direct callRoutine -- this is exactly the
// frame-by-frame path a real player takes.
// ---------------------------------------------------------------------------------------------

function hardwareOam(nes) {
  return Array.from(nes.ppu.spriteMem.slice(0, 64));
}
function shadowOam(mem) {
  return Array.from(mem.slice(0x0200, 0x0200 + 64));
}

/** Locate a `jsr <calleeAddr>` instruction's own address by its actual compiled bytes (opcode
 * $20 plus the callee's address, little-endian), scanning forward from searchStart -- robust
 * against a mutant that inserts or removes bytes earlier in the same block, unlike a fixed
 * instruction-count offset from a block's own start label. */
function findJsrTarget(nes, searchStart, calleeAddr, maxBytes = 24) {
  const mem = nes.cpu.mem;
  const lo = calleeAddr & 0xff;
  const hi = (calleeAddr >> 8) & 0xff;
  for (let i = 0; i < maxBytes; i++) {
    const addr = searchStart + i;
    if (mem[addr] === 0x20 && mem[addr + 1] === lo && mem[addr + 2] === hi) return addr;
  }
  return -1;
}

// test/unit/camera.test.js's own triggerRealNmi, copied locally per this codebase's own
// established convention (each suite keeps its own boot/step helpers) -- the vendored core's own
// 0-delay `nmiImmediate` path (renderer/emulator/core/cpu.js's `emulate()`): setting it and
// calling `emulate()` once services a full `doNonMaskableInterrupt` (pushes P and the real PC,
// jumps to the vector) with no instruction executed first, then steps until control genuinely
// returns to `pausedPC` via the ROM's own `rti`.
function triggerRealNmi(nes, pausedPC, budget = 20000) {
  nes.cpu.nmiImmediate = true;
  nes.cpu.emulate();
  let steps = 0;
  while (nes.cpu.REG_PC !== pausedPC) {
    nes.cpu.emulate();
    assert.ok(++steps < budget, 'the real NMI never returned to the interrupted instruction');
  }
}

test('case 2: hardware OAM already matches its own freshly rebuilt shadow OAM on the same frame the camera is floored or restored -- no one-frame publication lag at open or close', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'AB' }] });
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll)');

  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  assert.equal(mem[CAM_DIRTY], 0, 'the publication lock must already be released by the time this frame finishes -- it only brackets the rebuild, never the whole hold');
  assert.equal(mem[SW_DLG17_CAMHOLD], 1, 'the logical hold flag must still be set -- the box is genuinely open');
  const shadowAtOpen = shadowOam(mem);
  nes.frame();
  assert.deepEqual(hardwareOam(nes), shadowAtOpen, 'one settle frame after the nudge, hardware OAM must already have caught up to the nudge frame\'s own shadow OAM -- the engine\'s normal single-frame build-then-DMA relay is the only lag, never a multi-frame stall');
  for (let i = 0; i < 10; i++) {
    nes.frame();
    assert.deepEqual(hardwareOam(nes), shadowOam(mem), `mid-dialogue settle frame ${i}: hardware OAM must stay caught up to shadow OAM -- the world is frozen, so once caught up it can never drift again`);
  }

  const openFrames = driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.ok(openFrames < 60, 'the message must finish typing within budget');

  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  const closeFrames = driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 30);
  assert.ok(closeFrames < 30, 'the hold must actually release within budget -- this is not a permanent stall');
  const shadowAtClose = shadowOam(mem);
  nes.frame();
  assert.deepEqual(hardwareOam(nes), shadowAtClose, 'one settle frame after the release, hardware OAM must already have caught up to the release frame\'s own restored shadow OAM -- again, only the engine\'s normal single-frame relay, never a multi-frame stall (review round 2, finding A1\'s own correction: the ONLY harmless lag is mainline sampling hardware OAM one frame behind the previous NMI\'s own publish -- the SAME frame\'s shadow OAM always matches the SAME frame\'s eventual hardware OAM once DMA runs. The pre-fix bug was not this ordinary lag; it was cam_dirty staying raised for the WHOLE ~20-frame conversation, so the published scroll and the player\'s own drawn position went out of coherence with each other for that whole span, not merely one settle frame)');
});

// Round 3, finding A1: the two tests above check hardware OAM against ITS OWN shadow, and only at
// hand-picked settle frames. Neither observes the NMI-published scroll (nmi_cam_x_lo/nmi_cam_y_lo,
// $b6/$b7 -- what nmi_scroll actually writes to $2005 for the frame just rendered) alongside the
// hardware OAM DMA that same NMI just performed, and neither runs with the combat HUD enabled (a
// second, independent OAM consumer -- draw_hud -- sharing the same shadow-OAM-then-DMA pipeline).
// The reviewer's own probe (handoff-next/review-phase2-s7b-round3-evidence/publication-hud-probe.mjs)
// intercepts cpu.emulate() immediately before nmi_rti's own rti to snapshot every completed NMI,
// exactly once per real vblank, with both halves of the publication (published scroll, hardware OAM)
// read together -- reused here. The player is frozen for the whole ST_DIALOG span (update_player
// never runs) and issued no further movement input after the walk below, so its own world position
// is constant from that walk's end through the two post-release settle frames.
//
// Round 4, finding A1: comparing publishedCamX+playerOamX against ITS OWN first sample (this test's
// prior shape) is a self-consistency check, not a correctness one -- a published Y corrupted the
// SAME way at every sample (the `publishy` mutant, below) survives it. sw_dlg15_pending_step's own
// comment (engine/streamworld.asm) documents the real, independent ground truth instead: opening
// FLOORS cam_x_lo/cam_y_lo to a 16px boundary (`AND #$F0`) while leaving player_x/player_y (the
// screen-relative sprite position build_oam projects from) completely untouched -- an accepted,
// documented visual nudge, not a bug -- and closing RESTORES both axes verbatim from the
// pre-floor snapshot (sw_dlg_cam_x_lo/y_lo) before ever releasing. So the camera this whole
// transaction publishes takes exactly one of two independently known values at any moment --
// floor(originalCam, 16) while game_state still reads ST_DIALOG (the floor has not yet been undone),
// or the untouched originalCam once game_state reads ST_GAMEPLAY again (the restore already ran,
// atomically, in the same mainline call that also flipped game_state -- case 3's own gap-frame
// finding: NMI runs before mainline within one nes.frame() call, so the very NMI sampled on the
// release frame itself still shows the PRE-release state; only the first POST-release frame's NMI
// shows the restored one). player_x/player_y (the RAM position, "screen-relative" only in the sense
// that update_player never moves it during the hold) is genuinely constant throughout -- but on a
// streamed map, build_oam_draw_sw (engine/oam.asm) projects the hardware sprite position as world
// position MINUS the camera, so playerOamX/Y (adjusted for the NES sprite-Y convention on the Y
// axis: OAM Y is the scanline one before the sprite's own top row, i.e. hardware Y + 1 == projected
// Y) must equal the ORIGINAL, un-floored player position minus THIS SAME SAMPLE's own
// independently-known camera (floored or restored, exactly as above) -- not a raw, camera-blind
// equality -- at every single sample. Neither half of this check is read back from
// nmi_scroll/build_oam's own output -- both are captured directly from RAM before any dialogue code
// runs at all, and the per-sample camera used for the projection check is the same independently
// derived expectedCamX/Y the scroll-publication check above already uses, not the sample's own
// publishedCamX/Y.
test('round 3, finding A1: published scroll, hardware player projection and all three hardware hearts stay mutually coherent at every completed real NMI through open, close and the first two post-release DMAs', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({});
  project.sprites.actors.push({ name: 'Combat enabled', behavior: 'npc', hp: 1, damage: 1 });
  const slot = interactEntity(project, { x: 213, y: 177, commands: [{ op: 'say', text: 'AB' }] });
  const { nes, mem, addrOf } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll on both axes)');

  // Independently captured ground truth -- read directly from RAM before any dialogue code runs,
  // never re-derived from nmi_scroll/build_oam's own output.
  const originalCamX = mem[CAM_X_LO];
  const originalCamY = mem[CAM_Y_LO];
  const originalPlayerX = mem[PLAYER_X];
  const originalPlayerY = mem[PLAYER_Y];
  assert.notEqual(originalCamX, 0, 'sanity: the walk must have actually scrolled the camera on X, not left it at 0');
  assert.notEqual(originalCamX & 0x0f, 0, 'sanity: the walk must have actually left the camera unaligned to a 16px boundary on X -- an already-aligned camera cannot discriminate the floor below from a no-op');
  assert.notEqual(originalCamY, 0, 'sanity: the walk must have actually scrolled the camera on Y too, not just X');
  assert.notEqual(originalCamY & 0x0f, 0, 'sanity: the walk must have actually left the camera unaligned to a 16px boundary on Y -- an already-aligned camera cannot discriminate the floor below from a no-op');
  const flooredCamX = originalCamX & 0xf0;
  const flooredCamY = originalCamY & 0xf0;

  const nmiRtiAddr = addrOf('nmi_rti');
  const hearts = () => Array.from({ length: 64 }, (_, i) => nes.ppu.spriteMem[i * 4]).filter((y) => y === 16).length;
  assert.equal(hearts(), 3, 'sanity: the combat HUD must actually be up (three hearts) before the walk/interact even starts');

  const snapshots = [];
  let phase = 'open';
  const origEmulate = nes.cpu.emulate.bind(nes.cpu);
  nes.cpu.emulate = () => {
    if (nes.cpu.REG_PC + 1 === nmiRtiAddr) {
      snapshots.push({
        phase,
        gameState: mem[GAME_STATE],
        publishedCamX: mem[0xb6],
        publishedCamY: mem[0xb7],
        playerOamX: nes.ppu.spriteMem[3],
        playerOamY: nes.ppu.spriteMem[0],
        hearts: hearts(),
      });
    }
    return origEmulate();
  };
  try {
    nes.buttonDown(1, B);
    nes.frame();
    nes.buttonUp(1, B);
    const openFrames = driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
    assert.ok(openFrames < 60, 'the message must finish typing within budget');
    phase = 'close';
    nes.buttonDown(1, B);
    nes.frame();
    nes.buttonUp(1, B);
    const closeFrames = driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 30);
    assert.ok(closeFrames < 30, 'the hold must actually release within budget -- this is not a permanent stall');
    nes.frame(); // first post-release DMA
    nes.frame(); // second post-release DMA
  } finally {
    nes.cpu.emulate = origEmulate;
  }

  assert.ok(snapshots.length > 10, `must have observed a real spread of completed NMIs across open and close, not a near-empty sample: ${snapshots.length}`);
  assert.ok(snapshots.some((s) => s.phase === 'open'), 'must have sampled at least one NMI during the open span');
  assert.ok(snapshots.some((s) => s.phase === 'close'), 'must have sampled at least one NMI during the close/release span');
  assert.ok(snapshots.some((s) => s.gameState === ST_GAMEPLAY), 'must have sampled at least one NMI after the hold actually released (the two post-release DMAs)');
  for (const s of snapshots) {
    assert.equal(s.hearts, 3, `every completed NMI must keep all three combat-HUD hearts on screen (${s.phase}): ${JSON.stringify(s)}`);
  }
  for (const s of snapshots) {
    const held = s.gameState !== ST_GAMEPLAY; // the release itself and the restore are atomic (case 3's own gap-frame finding): a still-ST_DIALOG sample has not seen the restore yet, even on the release frame
    const expectedCamX = held ? flooredCamX : originalCamX;
    const expectedCamY = held ? flooredCamY : originalCamY;
    assert.equal(s.publishedCamX, expectedCamX, `published X scroll must equal the independently floored (held) or restored (released) camera, never a stale or corrupted value: ${JSON.stringify(s)}`);
    assert.equal(s.publishedCamY, expectedCamY, `published Y scroll must equal the independently floored (held) or restored (released) camera -- a mismatch here is exactly what the publishy mutant (published Y xor 1) introduces: ${JSON.stringify(s)}`);
    // The player is frozen for the whole ST_DIALOG span (player_x/player_y in RAM never change),
    // but on a streamed map the hardware OAM projection is world position MINUS the camera
    // (build_oam_draw_sw, engine/oam.asm), so the sprite's own screen position legitimately shifts
    // by exactly the floor/restore delta -- an already-independent quantity (expectedCamX/Y above,
    // never read back from the projection itself), not a second read of the same corruption.
    assert.equal(s.playerOamX, originalPlayerX - expectedCamX, `the hardware player projection's own X must equal the frozen world X minus the independently floored/restored camera: ${JSON.stringify(s)}`);
    assert.equal(s.playerOamY + 1, originalPlayerY - expectedCamY, `the hardware player projection's own Y, corrected for the NES sprite-Y convention (OAM Y is the scanline one before the sprite's own top row), must equal the frozen world Y minus the independently floored/restored camera: ${JSON.stringify(s)}`);
  }
});

test('case 2 sabotage: restoring the pre-fix "never decrement at open" shape re-freezes hardware OAM for the whole conversation, not just one settle frame', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('streamworld.asm');
  // The exact pre-fix shape (sw_dlg_lifecycle_open_start/_end's own comment): "the pre-fix routine
  // never decremented here at all, relying on sw_dlg17_camrelease's own dec to match an inc
  // <cam_dirty> this routine left standing across the whole conversation." Dropping just this one
  // dec reproduces that: cam_dirty now stays raised for the ENTIRE PENDING->DRAINING span (many
  // frames), not one.
  const needle = '  jsr build_oam\n  jsr draw_entities\n  ; the release itself is also new -- the pre-fix routine never decremented\n  ; here at all, relying on sw_dlg17_camrelease\'s own dec to match an\n  ; inc <cam_dirty this routine left standing across the whole conversation.\n  dec <cam_dirty\nsw_dlg_lifecycle_open_end:\n';
  const mutant = mutateOnce(source, needle, needle.replace('  dec <cam_dirty\n', ''), 'sw_dlg_lifecycle_open_end early release (case 2 sabotage)');
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'AB' }] });
  project.code = { overrides: [{ name: 'streamworld.asm', text: mutant }], files: [] };
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll)');

  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  assert.equal(mem[CAM_DIRTY], 1, 'sabotage setup: without its own dec, the open-side inc must now stay standing past this frame');
  const preOpenHw = hardwareOam(nes);

  nes.frame();
  assert.deepEqual(hardwareOam(nes), preOpenHw, 'with the hold left standing, DMA must stay skipped one settle frame after open -- unlike the fixed code, which had already caught up by here');

  for (let i = 0; i < 8; i++) nes.frame();
  assert.equal(mem[CAM_DIRTY], 1, 'sabotage sanity: the hold must still be standing many frames into the conversation');
  assert.deepEqual(hardwareOam(nes), preOpenHw, 'hardware OAM must still be stuck at its pre-open value many frames into the conversation -- a correct-looking test that could not tell this apart from case 2\'s own positive (which catches up within one settle frame and never drifts again) would be worthless');
});

// ---------------------------------------------------------------------------------------------
// Round 2, finding A1: an unrelated cam_dirty writer. camera_slide_tick (engine/camera.asm) is a
// completely independent, pre-existing writer of the same shared cam_dirty lock -- a door-warp
// slide's own per-frame wrap-transition bracket (inc/dec around its own coordinate+nametable store
// pair). In real play the two writers never run inside one another (camera_slide_tick requires
// ST_GAMEPLAY; the dialogue lifecycle's own hold requires ST_DIALOG -- see this file's own case 1
// comment, and engine/boot.asm's main_loop only ticks camera_slide_tick before the game_state gate
// that would otherwise block it), but the shared lock is reference-counted, not a boolean, exactly
// so that IF a second writer's own inc/dec ever ran while another hold was already open, its own
// release could never clobber the first writer's hold shut early. Tested directly at the routine
// level (callRoutine), independent of whether real gameplay reaches this exact nesting -- the same
// "test the discipline itself" approach this file's other direct-call tests already use for
// sw_dlg_metatile/sw_dlg_origin_capture.
// ---------------------------------------------------------------------------------------------

test('round 2, finding A1: camera_slide_tick (an unrelated, pre-existing cam_dirty writer) nests safely inside an already-open hold -- its own inc/dec must not clobber the outer hold', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  const tick = addrOf('camera_slide_tick');

  mem[CAM_DIRTY] = 1; // simulates an outer hold (the dialogue lifecycle's own) already open
  mem[CAM_SLIDE_LEFT] = 1;
  mem[CAM_SLIDE_DIR] = DIR_RIGHT;
  mem[CAM_SLIDE_B_PENDING] = 0;
  mem[CAM_X_LO] = 250; // 250 + CAM_STEP_X(16) = 266 -> carries, crossing the wrap this tick exists for
  mem[CAM_NT] = 0;

  callRoutine(nes, tick);

  assert.equal(mem[CAM_X_LO], 10, 'sanity: the tick must actually have wrapped (250 + 16 - 256)');
  assert.equal(mem[CAM_NT] & 1, 1, 'sanity: the tick must actually have toggled the nametable bit this wrap owns');
  assert.equal(mem[CAM_DIRTY], 1, 'camera_slide_tick\'s own inc/dec must return cam_dirty to exactly where the outer hold left it (1), never to 0 -- releasing a lock this routine did not open');
});

test('round 2, finding A1 sabotage: camera_slide_tick rewritten to SET/CLEAR cam_dirty as a boolean (not inc/dec) clobbers an outer hold shut', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('camera.asm');
  // The exact wrong implementation the reference-counting discipline this shared lock depends on
  // exists to rule out: a naive "set on entry, clear on exit" boolean instead of inc/dec. Only the
  // X-increment wrap branch's own pair is mutated -- the same branch the positive test above
  // exercises -- so this is a true minimal-diff sabotage, not a broader rewrite.
  const needle = '  bcc camera_slide_tick_x_store\n  inc <cam_dirty\n  sta <cam_x_lo\n  lda <cam_nt\n  eor #1\n  sta <cam_nt\n  dec <cam_dirty\n  jmp camera_slide_tick_check\ncamera_slide_tick_x_store:';
  // `inc <cam_dirty` is immediately followed by `sta <cam_x_lo`, which stores the wrapped sum
  // still sitting in A from the `adc` above -- a naive `lda #1 / sta <cam_dirty` in its place would
  // clobber that value before it is ever stored, breaking the wrap itself (not merely cam_dirty),
  // which a real sabotage must not do. `pha`/`pla` around the entry set keeps A intact for the
  // following store; the exit clear needs no such guard, since A is dead after `sta <cam_nt`.
  const mutant = mutateOnce(
    source,
    needle,
    needle
      .replace('  inc <cam_dirty\n', '  pha\n  lda #1\n  sta <cam_dirty\n  pla\n')
      .replace('  dec <cam_dirty\n', '  lda #0\n  sta <cam_dirty\n'),
    'camera_slide_tick X-wrap cam_dirty set/clear (round 2, A1 sabotage)'
  );
  const project = createStreamedProject({ gameType: 'rpg' });
  project.code = { overrides: [{ name: 'camera.asm', text: mutant }], files: [] };
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-camslide-mutant-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const symbols = fs.readFileSync(built.symbolPath, 'utf8');
  const addrOf = (label) => {
    const m = symbols.match(new RegExp(`^${label}\\s+=\\s+\\$([0-9A-Fa-f]+)`, 'm'));
    assert.ok(m, `${label} should be a named symbol in game.fns`);
    return parseInt(m[1], 16);
  };
  const bytes = new Uint8Array(fs.readFileSync(built.romPath));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(bytes);
  const mem = nes.cpu.mem;
  const tick = addrOf('camera_slide_tick');

  mem[CAM_DIRTY] = 1;
  mem[CAM_SLIDE_LEFT] = 1;
  mem[CAM_SLIDE_DIR] = DIR_RIGHT;
  mem[CAM_SLIDE_B_PENDING] = 0;
  mem[CAM_X_LO] = 250;
  mem[CAM_NT] = 0;

  callRoutine(nes, tick);

  assert.equal(mem[CAM_X_LO], 10, 'sabotage sanity: the wrap itself still happens identically');
  assert.notEqual(mem[CAM_DIRTY], 1, 'the mutant\'s own boolean clear must clobber the outer hold shut to 0 -- a correct-looking test that could not tell this apart from the positive test above (which always returns to 1) would be worthless');
});

// ---------------------------------------------------------------------------------------------
// Round 2, finding A1: genuine overrun/in-draw interruption. The close path's own rebuild-before-
// release bracket (sw_dlg_lifecycle_close_a/_b, engine/streamworld.asm) is not merely tested at its
// own frame boundaries (case 2 above) -- a real hardware interrupt can land INSIDE it, mid-rebuild,
// after build_oam has already run but before draw_entities/draw_hud have. This is exactly what
// STREAMWORLD_OAM_GUARD_KERNEL_ALLOWANCE (engine/boot.asm's nmi_oam_guard) exists to make safe: it
// must suppress that interrupting NMI's own $4014 DMA entirely while cam_dirty is held, so hardware
// OAM never shows a torn, half-composed mix -- and once the rebuild finishes and the hold releases,
// the very next real NMI must publish the complete, coherent result, never a permanent stall. Uses
// the vendored core's own real interrupt-injection technique (test/unit/camera.test.js's own
// triggerRealNmi, copied above), instruction-stepped to a precise midpoint, never a direct call to
// the guard in isolation -- a real interrupt at a real PC is what the guard actually has to survive.
//
// Entry is forced directly at the close bracket's own real label (`REG_PC = target - 1`, this
// core's own established convention -- test/unit/camera.test.js's own assertWrapTickPublicationLock
// and runToLabel: REG_PC always reads one less than the opcode about to execute), rather than
// continuing raw single-instruction stepping from wherever driveUntil's own frame()-paced driving
// left off. Real mainline only reaches this same bracket after its own wait-for-vblank spin, and
// this vendored core's frame() drives PPU dot/DMA-halt timing OUTSIDE cpu.emulate() itself (see
// FORGE-PATCHES.md) -- raw stepping across that boundary never resolves the wait, it does not
// merely take longer. Forcing entry lands on the SAME real production instructions with the SAME
// real preconditions (box already closed, cam_dirty about to be raised) mainline itself would reach
// one frame later, without depending on this core's own frame-boundary bookkeeping.
//
// build_oam only ever writes the player's own fixed 16-byte footprint (bytes 0-15); everything from
// there to the end of the 64-byte/16-sprite window this file's own hardwareOam/shadowOam helpers
// compare is draw_entities'/draw_hud's to fill or park -- in this project's own minimal scene, that
// leftover parks back to an idempotent $FF regardless, which would make a plain before/after
// comparison degenerate (torn == final by coincidence, not because the guard did anything). A
// deterministic sentinel poisoned into exactly that not-yet-rebuilt span, a byte no real render
// ever produces, makes "torn" and "rebuilt" provable regardless of what this scene's own entities
// or HUD happen to recompute.
//
// Round 4, finding A1: a SECOND injection point, after `jsr draw_entities` has already run for real
// but before `jsr draw_hud` (close_b's own late, separate HUD rebuild -- round 2's own finding A1
// comment above explains why close_b needs its own draw_hud call at all: it is the LAST rebuild this
// frame, unlike open_start's identical-looking redundant call, which main_loop_draw's own later,
// unconditional draw_hud still overwrites correctly the same frame). The combat HUD is enabled here
// (an enemy actor, exactly as case 2's own round 3 fix does) so this second midpoint's own poison is
// no longer a coincidental match with the final composition either: the finished rebuild genuinely
// carries three hearts a torn snapshot does not.
// ---------------------------------------------------------------------------------------------

test('round 2, finding A1: a genuine NMI landing mid-close-rebuild is suppressed by the OAM guard -- hardware OAM never publishes a torn composition, and catches up correctly once the rebuild finishes, including a second interruption after entities have rebuilt but before the combat HUD has', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({});
  project.sprites.actors.push({ name: 'Combat enabled', behavior: 'npc', hp: 1, damage: 1 });
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'AB' }] });
  // Round 4, finding A1: a scratch harness (handoff-next/review-phase2-s7b-fix5-evidence/) runs
  // this SAME scenario with close_b's own `dec <cam_dirty` moved ahead of the HUD conditional --
  // the mutation the round 4 review found the real-frame publication test's own ordinary
  // frame-paced timing could never reach (the gap it opens is too short to land a real NMI in
  // under normal play). This test's own SECOND injection point below is instruction-stepped
  // precisely into that gap, so it (not the other, real-timing test) is what has to catch it.
  const { nes, mem, addrOf } = await buildAndBoot(project);
  const hearts = () => Array.from({ length: 64 }, (_, i) => nes.ppu.spriteMem[i * 4]).filter((y) => y === 16).length;
  assert.equal(hearts(), 3, 'sanity: the combat HUD must actually be up before this test\'s own injected interrupts');

  driveDialogueToClose(nes, mem, slot);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CLOSED, 30);
  assert.equal(mem[BOX_STATE], BOX_CLOSED, 'setup: the box must actually close before this test\'s own injected interrupts');

  const closeAStart = addrOf('sw_dlg_lifecycle_close_a_start');
  const closeBStart = addrOf('sw_dlg_lifecycle_close_b_start');
  // Past `jsr build_oam` (3 bytes), before `jsr draw_entities`/`jsr draw_hud` -- world OAM has just
  // been rebuilt, entities/HUD have not, so shadow OAM at this exact instant is genuinely torn. This
  // fixed offset is unaffected by the `early` mutant above (which only inserts bytes AFTER
  // draw_entities), unlike midPoint2 below.
  const midPoint1 = closeBStart + 3;
  // Past `jsr draw_entities` too, before `jsr draw_hud` -- entities are for real rebuilt now, but
  // the combat HUD's own later rebuild has not run yet (round 4, finding A1). Located by the actual
  // compiled `jsr draw_hud` bytes rather than a fixed instruction count from closeBStart: the
  // `early` mutant above inserts its own `dec <cam_dirty` (2 bytes) between draw_entities and this
  // call, which a fixed offset would land inside instead of on the real call site -- and, critically,
  // stepping to a byte-exact `jsr draw_hud` call site means the interrupt lands AFTER that inserted
  // early dec has already executed under the mutant (cam_dirty already released) while still
  // landing at the identical semantic point (immediately before the HUD rebuild) under the real,
  // unmutated engine.
  const midPoint2 = findJsrTarget(nes, midPoint1 + 3, addrOf('draw_hud'));
  assert.notEqual(midPoint2, -1, 'must find the real jsr draw_hud call site inside close_b\'s own rebuild');
  const hwBeforeInjection = hardwareOam(nes);

  nes.cpu.REG_PC = closeAStart - 1;
  let steps = 0;
  while ((nes.cpu.REG_PC + 1) !== midPoint1) {
    nes.cpu.emulate();
    assert.ok(++steps < 5000, 'the close-path rebuild\'s own first midpoint was never reached');
  }
  assert.equal(mem[CAM_DIRTY], 1, 'setup: cam_dirty must be held at this exact midpoint -- this is inside the close_a/close_b bracket');
  for (let i = 16; i < 64; i++) mem[0x0200 + i] = 0xab;
  const tornShadow1 = shadowOam(mem);
  assert.notDeepEqual(tornShadow1, hwBeforeInjection, 'sanity: the poisoned mid-rebuild shadow OAM really is different from the pre-injection hardware OAM -- otherwise a mutant letting the DMA through could not be told apart from the guard correctly skipping it');

  // Round 3, finding A1: nmi_scroll gates its own nmi_cam_x_lo/y_lo snapshot on the SAME cam_dirty
  // check the OAM guard uses (engine/boot.asm:706, "bne nmi_scroll_cam_stale") -- so the published
  // scroll this interrupting NMI would otherwise publish must be held back in lockstep with the OAM
  // DMA it is paired with, not just the sprite bytes.
  let publishedBeforeInjection = [mem[0xb6], mem[0xb7]];

  let pausedPC = nes.cpu.REG_PC;
  let pausedA = nes.cpu.REG_ACC;
  let pausedX = nes.cpu.REG_X;
  let pausedY = nes.cpu.REG_Y;
  let pausedP = nes.cpu.getStatus();
  triggerRealNmi(nes, pausedPC);
  assert.equal(nes.cpu.REG_ACC, pausedA, 'A must be restored exactly by the real rti');
  assert.equal(nes.cpu.REG_X, pausedX, 'X must be restored exactly');
  assert.equal(nes.cpu.REG_Y, pausedY, 'Y must be restored exactly');
  assert.equal(nes.cpu.getStatus(), pausedP, 'P must be restored exactly');

  assert.deepEqual(hardwareOam(nes), hwBeforeInjection, 'first interruption (after build_oam, before draw_entities): the OAM guard must skip this NMI\'s own $4014 DMA entirely while cam_dirty is held -- hardware OAM must be completely untouched, never showing the poisoned torn composition');
  assert.deepEqual([mem[0xb6], mem[0xb7]], publishedBeforeInjection, 'the published scroll must stay exactly at its pre-injection value while cam_dirty is held -- the interrupting NMI must not publish a scroll snapshot paired with (or without) the skipped, still-torn OAM DMA');

  // Resume to the SECOND interruption point: entities have now rebuilt for real, but the combat
  // HUD's own later, separate rebuild (draw_hud) has not run yet.
  steps = 0;
  while ((nes.cpu.REG_PC + 1) !== midPoint2) {
    nes.cpu.emulate();
    assert.ok(++steps < 5000, 'the close-path rebuild\'s own second midpoint (after entities, before the combat HUD) was never reached');
  }
  assert.equal(mem[CAM_DIRTY], 1, 'setup: cam_dirty must still be held at the second midpoint -- entities have rebuilt but the combat HUD has not');
  for (let i = 16; i < 64; i++) mem[0x0200 + i] = 0xcd; // a second, distinct poison -- draw_entities has already run for real by now, so this destroys its own real output too, not merely reintroducing the first poison
  const tornShadow2 = shadowOam(mem);
  assert.notDeepEqual(tornShadow2, hwBeforeInjection, 'sanity: the second poison really is different from the still-unpublished hardware OAM');

  publishedBeforeInjection = [mem[0xb6], mem[0xb7]];
  pausedPC = nes.cpu.REG_PC;
  pausedA = nes.cpu.REG_ACC;
  pausedX = nes.cpu.REG_X;
  pausedY = nes.cpu.REG_Y;
  pausedP = nes.cpu.getStatus();
  triggerRealNmi(nes, pausedPC);
  assert.equal(nes.cpu.REG_ACC, pausedA, 'A must be restored exactly by the real rti');
  assert.equal(nes.cpu.REG_X, pausedX, 'X must be restored exactly');
  assert.equal(nes.cpu.REG_Y, pausedY, 'Y must be restored exactly');
  assert.equal(nes.cpu.getStatus(), pausedP, 'P must be restored exactly');

  assert.deepEqual(hardwareOam(nes), hwBeforeInjection, 'second interruption (after draw_entities, before draw_hud): the OAM guard must ALSO skip this NMI\'s own DMA entirely -- an interrupting NMI must never publish the combat HUD\'s own still-missing-hearts composition either');
  assert.deepEqual([mem[0xb6], mem[0xb7]], publishedBeforeInjection, 'the published scroll must stay exactly at its pre-injection value at the second interruption too');

  // Resume mainline from the second injection point and let the close-path rebuild finish normally,
  // combat HUD included.
  let resumeSteps = 0;
  while (mem[CAM_DIRTY] !== 0) {
    nes.cpu.emulate();
    assert.ok(++resumeSteps < 5000, 'cam_dirty was never released after the interruption');
  }
  const finalShadow = shadowOam(mem);
  assert.notDeepEqual(finalShadow, tornShadow2, 'sanity: the finished rebuild (entities + combat HUD) really does overwrite the second poison too');
  const restoredCamX = mem[CAM_X_LO];
  const restoredCamY = mem[CAM_Y_LO];

  const releasedPC = nes.cpu.REG_PC;
  triggerRealNmi(nes, releasedPC);
  assert.deepEqual(hardwareOam(nes), finalShadow, 'once released, the very next real NMI must publish the complete, coherent final composition -- both interruptions caused a skip, never a permanent stall or a lasting corruption');
  assert.deepEqual([mem[0xb6], mem[0xb7]], [restoredCamX, restoredCamY], 'once released, the very next real NMI must publish a scroll snapshot that actually matches the restored camera it also just DMA\'d OAM for -- published scroll and hardware OAM must advance together, not one ahead of the other');
  assert.equal(hearts(), 3, 'once released, the combat HUD\'s own three hearts must be present again in the published composition -- the whole publication tuple (scroll, player projection, HUD) stays coherent through both interruption points and after release');
});

test('round 2, finding A1 sabotage: removing the nmi_oam_guard check lets an interrupting NMI DMA a torn mid-rebuild OAM straight to hardware', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('boot.asm');
  const needle = 'nmi_oam_guard_start:\n  .if STREAMING_ENABLED\n  .if TEXT_ENABLED\n  lda <cam_dirty\n  bne nmi_oam_skip\n  .endif\n  .endif\nnmi_oam_guard_end:\n';
  const mutant = mutateOnce(source, needle, 'nmi_oam_guard_start:\nnmi_oam_guard_end:\n', 'nmi_oam_guard check removed (round 2, A1 sabotage)');

  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'AB' }] });
  project.code = { overrides: [{ name: 'boot.asm', text: mutant }], files: [] };
  const { nes, mem, addrOf } = await buildAndBoot(project);
  driveDialogueToClose(nes, mem, slot);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CLOSED, 30);
  assert.equal(mem[BOX_STATE], BOX_CLOSED, 'sabotage setup: the box must actually close before this test\'s own injected interrupt');

  const closeAStart = addrOf('sw_dlg_lifecycle_close_a_start');
  const midPoint = addrOf('sw_dlg_lifecycle_close_b_start') + 3;
  const hwBeforeInjection = hardwareOam(nes);

  nes.cpu.REG_PC = closeAStart - 1;
  let steps = 0;
  while ((nes.cpu.REG_PC + 1) !== midPoint) {
    nes.cpu.emulate();
    assert.ok(++steps < 5000, 'sabotage setup: the close-path rebuild\'s own midpoint was never reached');
  }
  assert.equal(mem[CAM_DIRTY], 1, 'sabotage setup: cam_dirty must still be held at this exact midpoint -- only the guard, not the hold itself, is mutated');
  for (let i = 16; i < 64; i++) mem[0x0200 + i] = 0xab;
  const tornShadow = shadowOam(mem);

  const pausedPC = nes.cpu.REG_PC;
  triggerRealNmi(nes, pausedPC);

  assert.deepEqual(hardwareOam(nes), tornShadow, 'without the guard, the interrupting NMI\'s own unconditional DMA must publish the poisoned torn mid-rebuild composition straight to hardware -- a correct-looking test that could not tell this apart from the real guard\'s own positive (which leaves hardware OAM completely untouched by the interruption) would be worthless');
  assert.notDeepEqual(hardwareOam(nes), hwBeforeInjection, 'the mutant\'s own published OAM must actually have changed from the pre-injection hardware OAM -- proving the leak is real, not a coincidental match');
});

// ---------------------------------------------------------------------------------------------
// Case 3 (plan case 3): the box_close/game_state gap. text_close_attr's streamed tail sets
// box_state to BOX_CLOSED FIRST, then defers to sw_dlg15_state=DRAINING and returns WITHOUT
// calling close_ui -- so game_state deliberately stays ST_DIALOG for one or more real frames after
// the box has visually closed, until sw_dlg17_camrelease's own vram_ready==0 guard lets it finish.
// Empirically confirmed via a real driven boot/walk/interact/close/drain cycle (frame 15:
// box_state==BOX_CLOSED but game_state is still ST_DIALOG and sw_dlg15_state is still DRAINING;
// frame 16: game_state finally reaches ST_GAMEPLAY) before this test was written.
// ---------------------------------------------------------------------------------------------

function driveDialogueToClose(nes, mem, slot) {
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC');
  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the message must finish typing and reach ENDWAIT before this test presses B again');
  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
}

test('case 3: a real gap frame exists where box_state has closed but game_state has not, and it resolves within one frame', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'AB' }] });
  const { nes, mem } = await buildAndBoot(project);
  driveDialogueToClose(nes, mem, slot);

  const gapFrames = driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CLOSED, 30);
  assert.ok(gapFrames < 30, 'the box must actually close within budget');
  assert.equal(mem[BOX_STATE], BOX_CLOSED, 'box_state must read BOX_CLOSED the moment it does');
  assert.equal(mem[SW_DLG15_STATE], SW_DLG15_DRAINING, 'the lifecycle must be DRAINING, not IDLE, at the instant the box visually closes');
  assert.equal(mem[GAME_STATE], ST_DIALOG, 'game_state must NOT yet be ST_GAMEPLAY at the instant box_state reads BOX_CLOSED -- this is the gap');

  nes.frame();
  assert.equal(mem[SW_DLG15_STATE], SW_DLG15_IDLE, 'the very next frame must resolve DRAINING -> IDLE');
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the very next frame must resolve the gap -- it must never last more than one frame');
  assert.equal(mem[CAM_DIRTY], 0, 'the camera hold must also be released by then');
});

test('case 3 sabotage: closing straight to close_ui (no deferred drain) makes the gap vanish -- proving the assertion above actually discriminates', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('streamworld.asm');
  // The real streamed tail -- relocated to kernel-hi by fix round 2 (A4); text_close_attr itself
  // is now only a 7-byte dispatch stub -- is `lda #SW_DLG15_DRAINING / sta <sw_dlg15_state / rts`
  // inside sw_dlg_hi_close_attr_tail (never reaching close_ui). Replacing it with an immediate
  // `jmp close_ui` is exactly the wrong implementation the plan names: closing the box and
  // resetting game_state in the same frame, no gap at all.
  const needle = '  lda #SW_DLG15_DRAINING\n  sta <sw_dlg15_state\n  rts\nsw_dlg_hi_close_attr_tail_done:';
  const mutant = mutateOnce(source, needle, '  jmp close_ui\nsw_dlg_hi_close_attr_tail_done:', 'sw_dlg_hi_close_attr_tail deferred-drain removal (case 3 sabotage)');

  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'AB' }] });
  project.code = { overrides: [{ name: 'streamworld.asm', text: mutant }], files: [] };
  const { nes, mem } = await buildAndBoot(project);
  driveDialogueToClose(nes, mem, slot);

  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CLOSED, 30);
  assert.equal(mem[BOX_STATE], BOX_CLOSED, 'the box must still actually close');
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'a sabotaged immediate close_ui must show NO gap -- game_state already ST_GAMEPLAY the same frame box_state closes, unlike the real implementation');
});

test('case 3 sabotage: never actually reaching close_ui leaves the player permanently stuck in dialogue -- the plan\'s own named wrong implementation ("failure to leave dialogue")', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('streamworld.asm');
  // sw_dlg17_camrelease's own fire path: state/camhold/cam_dirty all resolve correctly, but the
  // final `jmp close_ui` -- the one call that actually resets game_state back to ST_GAMEPLAY -- is
  // dropped in favour of a plain `rts`. This is the plan's own named case-3 wrong implementation:
  // the internal state machine believes the conversation is over (sw_dlg15_state reaches IDLE,
  // the hold releases) while game_state itself never leaves ST_DIALOG -- the player is stuck.
  const needle = '  lda #SW_DLG15_IDLE\n  sta <sw_dlg15_state\n  jmp close_ui\nsw_dlg17cr_done:\n';
  const mutant = mutateOnce(source, needle, '  lda #SW_DLG15_IDLE\n  sta <sw_dlg15_state\n  rts\nsw_dlg17cr_done:\n', 'sw_dlg17_camrelease close_ui omission (case 3 stuck-dialogue sabotage)');

  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'AB' }] });
  project.code = { overrides: [{ name: 'streamworld.asm', text: mutant }], files: [] };
  const { nes, mem } = await buildAndBoot(project);
  driveDialogueToClose(nes, mem, slot);

  const gapFrames = driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CLOSED, 30);
  assert.ok(gapFrames < 30, 'sabotage setup: the box must still visually close (box_state alone is untouched by this mutant)');
  driveUntil(nes, mem, () => false, 30); // run out a further budget with no predicate -- there is nothing left to wait for
  assert.equal(mem[SW_DLG15_STATE], SW_DLG15_IDLE, 'sabotage sanity: the internal lifecycle state does resolve to IDLE -- only close_ui itself is skipped');
  assert.equal(mem[CAM_DIRTY], 0, 'sabotage sanity: the camera/OAM hold does release');
  assert.notEqual(mem[GAME_STATE], ST_GAMEPLAY, 'without reaching close_ui, game_state must stay stuck in ST_DIALOG forever, even though every other part of the lifecycle believes the conversation is over -- a correct-looking test that could not tell this apart from case 3\'s own positive would be worthless');
});

// ---------------------------------------------------------------------------------------------
// A2 integration (fix round 1, finding A2): sw_dlg15_pending_step now calls sw_dlg_origin_capture
// -- previously uncalled in production, so text_close_step's own sw_dlg_close_row -> sw_dlg_metatile
// terrain restore was reading a stale/never-set origin. The unit tests above (around line 436)
// already check sw_dlg_origin_capture/sw_dlg_metatile's own arithmetic directly against an
// independent oracle; what they do NOT cover is that the real production call site actually fires
// with the real captured values, through a real open/close cycle, at a genuinely nonzero camera
// position -- this test needs no oracle of its own at all: the box's own footprint must be
// restored to EXACTLY the real terrain that was already on screen before the box ever opened
// (createStreamedProject's own default screens are non-uniform -- distinct nonzero metatile ids --
// so a wrong/stale origin would read a different, wrong screen offset and this test would catch
// the mismatch directly as a byte difference, not merely a byte-for-byte diagnosis).
// ---------------------------------------------------------------------------------------------

function snapshotNameTables(nes) {
  return nes.ppu.nameTable.map((nt) => Array.from(nt.tile));
}

// createStreamedProject's own default non-uniform terrain (streamedproject.js's own comment)
// confines its varied metatile ids to a screen's TOP third (indices 0-79 of 240); the box's own
// footprint is always metatile rows 12-14 (CLAUDE.md: "the box covers metatile rows 12-14
// exactly"), i.e. indices 192-239 -- always inside the default project's FILL region, id 0
// everywhere. That default shape would make this test pass vacuously (every origin, right or
// stale, reads the same fill tile), so this directly overwrites the interact screen's own bottom
// three metatile rows with a distinguishable, non-uniform pattern, and gives metatile ids 1-3
// distinct tile graphics too (createMetatile's own default `tiles: [0,0,0,0]` is identical across
// every id, which would make even distinct metatile ids render as the same background tile byte).
function paintBoxFootprintTerrain(project) {
  for (let id = 1; id <= 3; id++) {
    project.metatiles[id].tiles = [id, id, id, id];
  }
  const streamedMap = project.maps.find((m) => m.streamed === true);
  const screen = streamedMap.screens[0];
  for (let row = 12; row <= 14; row++) {
    for (let col = 0; col < 16; col++) {
      screen.metatiles[row * 16 + col] = 1 + ((row + col) % 3);
    }
  }
}

test('A2 integration: a real open/close cycle at a genuinely nonzero camera position restores the whole background exactly, byte for byte, using the real captured origin', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({});
  paintBoxFootprintTerrain(project);
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'AB' }] });
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll onto non-uniform terrain)');
  assert.notEqual(mem[CAM_X_LO] & 0xf0, 0, 'sanity: the walk must have actually moved the camera off a 16px boundary, or the origin capture is trivially zero and this test proves nothing');

  const before = snapshotNameTables(nes);
  driveDialogueToClose(nes, mem, slot);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CLOSED && m[GAME_STATE] === ST_GAMEPLAY, 30);
  assert.equal(mem[BOX_STATE], BOX_CLOSED, 'the box must actually finish closing before this test compares the screen');
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'gameplay must actually resume before this test compares the screen');

  const after = snapshotNameTables(nes);
  assert.deepEqual(after, before, 'the entire background (all four physical nametables -- fourscreen mirroring, no aliasing) must be restored exactly to what was on screen before the box opened; the world is frozen for the whole conversation, so nothing but the box\'s own open/close should ever have touched it');
});

test('A2 integration sabotage: skipping sw_dlg_origin_capture at its real production call site leaves the close-path terrain restore reading a stale origin', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('streamworld.asm');
  const needle = 'sw_dlg_lifecycle_open_start:\n  jsr sw_dlg_origin_capture\n';
  const mutant = mutateOnce(source, needle, needle.replace('  jsr sw_dlg_origin_capture\n', ''), 'sw_dlg_origin_capture omission at its real call site (A2 integration sabotage)');

  const project = createStreamedProject({});
  paintBoxFootprintTerrain(project);
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'AB' }] });
  project.code = { overrides: [{ name: 'streamworld.asm', text: mutant }], files: [] };
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll onto non-uniform terrain)');
  assert.notEqual(mem[CAM_X_LO] & 0xf0, 0, 'sanity: the walk must have actually moved the camera off a 16px boundary');

  const before = snapshotNameTables(nes);
  driveDialogueToClose(nes, mem, slot);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CLOSED && m[GAME_STATE] === ST_GAMEPLAY, 30);
  assert.equal(mem[BOX_STATE], BOX_CLOSED, 'sabotage setup: the box must still finish closing -- only the origin used to restore terrain is stale, nothing else in the lifecycle is touched');

  const after = snapshotNameTables(nes);
  assert.notDeepEqual(after, before, 'without a fresh origin capture, the close-path terrain restore must read stale (zero/never-set) origin data and corrupt the background -- a correct-looking test that could not tell this apart from the positive case above (which restores it exactly) would be worthless');
});

// ---------------------------------------------------------------------------------------------
// Cases 4-6 (plan cases 4, 5, 6): every VRAM destination inside the box (border, glyphs, {name},
// arrow, choice text) must resolve through the real dialogue-mapper address, not the ordinary
// fixed $23xx one -- driven through the real lifecycle after a real walk (never at camera (0,0),
// where mapped and fixed addressing coincide and could not tell a bypass apart from a correct
// mapper call). Expected tile ids come from shared/font.js's own charToTile, never read back from
// the routine under test.
// ---------------------------------------------------------------------------------------------

test('case 4: the border draws through the mapper with exact expected tiles, and glyphs land at the mapper-computed cell, not the ordinary fixed address', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'AB' }] });
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll)');
  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the 2-char message must finish typing');

  const camXLo = mem[CAM_X_LO];
  const camYLo = mem[CAM_Y_LO];
  const camNt = mem[CAM_NT];
  assert.notEqual(camXLo & 0xf0, 0, 'sanity: the walk must have actually moved the camera off (0,0), or this test cannot discriminate mapped from fixed addressing');

  // Top edge (row 0): corner, 30 x horizontal rule, corner.
  assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 0, 0), charToTile('}'), 'top-left corner');
  assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 0, 15), charToTile('{'), 'top rule (interior column)');
  assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 0, 31), charToTile('}'), 'top-right corner');
  // Bottom edge (row 5): same pattern.
  assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 5, 0), charToTile('}'), 'bottom-left corner');
  assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 5, 31), charToTile('}'), 'bottom-right corner');
  // Interior row (row 1): vertical rule at both edges.
  assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 1, 0), charToTile('|'), 'interior row left rule');
  assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 1, 31), charToTile('|'), 'interior row right rule');

  // Glyphs: msg_line 0 -> box-relative row 1; msg_col 0/1 -> box-relative col 2/3.
  assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 1, 2), charToTile('A'), 'first glyph must land at the mapper-computed cell (row 1, col 2), not $23xx');
  assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 1, 3), charToTile('B'), 'second glyph must land at the mapper-computed cell (row 1, col 3)');
});

test('case 4 sabotage: forcing text_open_row_dispatch to the ordinary ($23xx) path even while streamed makes the border land off the mapper-computed cell', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('text.asm');
  const needle = 'text_open_row_dispatch:\ntext_open_row_guard_start:\n  .if STREAMING_ENABLED\n  .if TEXT_ENABLED\n  ; Fix round 1 (A4): the body itself now lives in kernel-hi\n  ; (sw_dlg_hi_open_row, engine/streamworld.asm) -- this site keeps only the\n  ; dispatch, per Chris\'s 2026-09-25 ruling to relocate the streamed\n  ; dialogue branches out of kernel-lo.\n  lda <map_is_streamed\n  beq text_open_row_ordinary\n';
  const mutant = mutateOnce(source, needle, needle.replace('  beq text_open_row_ordinary\n', '  jmp text_open_row_ordinary\n'), 'text_open_row_dispatch bypass (case 4 sabotage)');
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'AB' }] });
  project.code = { overrides: [{ name: 'text.asm', text: mutant }], files: [] };
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll)');
  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);

  const camXLo = mem[CAM_X_LO];
  const camYLo = mem[CAM_Y_LO];
  const camNt = mem[CAM_NT];
  assert.notEqual(camXLo & 0xf0, 0, 'sanity: the walk must have actually moved the camera off (0,0)');
  assert.notEqual(dlgCellTile(nes, camXLo, camYLo, camNt, 0, 0), charToTile('}'), 'forcing the ordinary $23xx path must make the mapper-computed cell NOT show the border corner -- a correct-looking test that could not tell this apart from case 4\'s own positive would be worthless');
});

test('case 4 sabotage: forcing text_put_char to the ordinary ($23xx) path even while streamed makes glyphs land off the mapper-computed cell, while the border (a different dispatch site) still draws correctly', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('text.asm');
  const needle = 'text_put_char_guard_start:\n  .if STREAMING_ENABLED\n  .if TEXT_ENABLED\n  ; Fix round 1 (A4): relocated to sw_dlg_hi_put_char, engine/streamworld.asm\n  ; -- see text_open_row_guard_start\'s own comment above.\n  lda <map_is_streamed\n  beq text_put_char_ordinary\n';
  const mutant = mutateOnce(source, needle, needle.replace('  beq text_put_char_ordinary\n', '  jmp text_put_char_ordinary\n'), 'text_put_char bypass (case 4 glyph sabotage)');
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'AB' }] });
  project.code = { overrides: [{ name: 'text.asm', text: mutant }], files: [] };
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll)');
  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);

  const camXLo = mem[CAM_X_LO];
  const camYLo = mem[CAM_Y_LO];
  const camNt = mem[CAM_NT];
  assert.notEqual(camXLo & 0xf0, 0, 'sanity: the walk must have actually moved the camera off (0,0)');
  assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 0, 0), charToTile('}'), 'text_open_row_dispatch is a different guard from text_put_char -- the border must still land correctly, proving this mutation is selective to glyphs, not a broader bypass');
  assert.notEqual(dlgCellTile(nes, camXLo, camYLo, camNt, 1, 2), charToTile('A'), 'forcing the ordinary $23xx path must make the mapper-computed cell NOT show the first glyph -- a correct-looking test that could not tell this apart from case 4\'s own positive would be worthless');
});

test('case 5: {name} substitution and the arrow prompt route through the mapper', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({});
  assert.equal(project.party[0].name, 'Hero', 'this test\'s own expected glyphs assume the default hero name');
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: '{name}' }] });
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll)');
  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the {name} token must finish typing');
  // The arrow write is queued the same frame box_state flips to ENDWAIT; vram_buf drains on the
  // NEXT frame's NMI, one frame after the CPU-side state transition (confirmed empirically: reading
  // real PPU content in the very same frame the predicate first holds shows the write not yet
  // drained, one further nes.frame() shows it landed exactly at the mapper-computed cell).
  nes.frame();

  const camXLo = mem[CAM_X_LO];
  const camYLo = mem[CAM_Y_LO];
  const camNt = mem[CAM_NT];
  assert.notEqual(camXLo & 0xf0, 0, 'sanity: the walk must have actually moved the camera off (0,0)');

  const name = 'Hero';
  for (let i = 0; i < name.length; i++) {
    assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 1, 2 + i), charToTile(name[i]), `{name} glyph ${i} ('${name[i]}') must land at the mapper-computed cell`);
  }
  // The ENDWAIT arrow: fixed box-relative row 4, col 30 (streamed and ordinary agree on this
  // box-relative position; only the physical destination differs).
  assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 4, 30), charToTile('\x7f'), 'the arrow prompt must land at the mapper-computed cell, not $23xx');
});

test('case 5 sabotage: forcing text_arrow_write to the ordinary ($23xx) path even while streamed makes the arrow land off the mapper-computed cell', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('text.asm');
  const needle = 'text_arrow_write_guard_start:\n  .if STREAMING_ENABLED\n  .if TEXT_ENABLED\n  lda <map_is_streamed\n  beq text_arrow_write_ordinary\n';
  const mutant = mutateOnce(source, needle, needle.replace('  beq text_arrow_write_ordinary\n', '  jmp text_arrow_write_ordinary\n'), 'text_arrow_write bypass (case 5 sabotage)');
  const project = createStreamedProject({});
  assert.equal(project.party[0].name, 'Hero', 'this test\'s own expected glyph assumes the default hero name');
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: '{name}' }] });
  project.code = { overrides: [{ name: 'text.asm', text: mutant }], files: [] };
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll)');
  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  nes.frame();

  const camXLo = mem[CAM_X_LO];
  const camYLo = mem[CAM_Y_LO];
  const camNt = mem[CAM_NT];
  assert.notEqual(camXLo & 0xf0, 0, 'sanity: the walk must have actually moved the camera off (0,0)');
  assert.notEqual(dlgCellTile(nes, camXLo, camYLo, camNt, 4, 30), charToTile('\x7f'), 'forcing the ordinary $23xx path must make the mapper-computed cell NOT show the arrow -- a correct-looking test that could not tell this apart from case 5\'s own positive would be worthless');
});

test('case 5 sabotage: forcing text_put_char to the ordinary ($23xx) path even while streamed makes the {name} substitution land off the mapper-computed cell -- a bypass distinct from the arrow-only mutant above (text_type_name_draw shares text_put_char with ordinary glyphs; text_arrow_write is a separate call site entirely)', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('text.asm');
  const needle = 'text_put_char_guard_start:\n  .if STREAMING_ENABLED\n  .if TEXT_ENABLED\n  ; Fix round 1 (A4): relocated to sw_dlg_hi_put_char, engine/streamworld.asm\n  ; -- see text_open_row_guard_start\'s own comment above.\n  lda <map_is_streamed\n  beq text_put_char_ordinary\n';
  const mutant = mutateOnce(source, needle, needle.replace('  beq text_put_char_ordinary\n', '  jmp text_put_char_ordinary\n'), 'text_put_char bypass (case 5 {name} substitution sabotage)');
  const project = createStreamedProject({});
  assert.equal(project.party[0].name, 'Hero', 'this test\'s own expected glyph assumes the default hero name');
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: '{name}' }] });
  project.code = { overrides: [{ name: 'text.asm', text: mutant }], files: [] };
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll)');
  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  nes.frame();

  const camXLo = mem[CAM_X_LO];
  const camYLo = mem[CAM_Y_LO];
  const camNt = mem[CAM_NT];
  assert.notEqual(camXLo & 0xf0, 0, 'sanity: the walk must have actually moved the camera off (0,0)');
  assert.notEqual(dlgCellTile(nes, camXLo, camYLo, camNt, 1, 2), charToTile('H'), 'forcing the ordinary $23xx path must make the mapper-computed cell NOT show the {name} substitution\'s own first glyph -- a correct-looking test that could not tell this apart from case 5\'s own positive would be worthless');
});

test('case 6: a choice question\'s two option rows both route through the mapper (the second option is where a row-offset bug would show)', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({});
  const slot = interactEntity(project, {
    x: 200, y: 112,
    commands: [{ op: 'choice', options: [{ text: 'Yes', commands: [] }, { text: 'No', commands: [] }] }],
  });
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll)');
  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CHOICEWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_CHOICEWAIT, 'both option rows must finish listing');
  // The initial cursor write (choice_show) is queued the same frame box_state flips to
  // CHOICEWAIT; see case 5's own comment on the identical one-frame vram_buf drain lag.
  nes.frame();

  const camXLo = mem[CAM_X_LO];
  const camYLo = mem[CAM_Y_LO];
  const camNt = mem[CAM_NT];
  assert.notEqual(camXLo & 0xf0, 0, 'sanity: the walk must have actually moved the camera off (0,0)');

  // Option 0 (box_row 0 at write time) -> box-relative row 1; option 1 -> box-relative row 2.
  const yes = 'Yes';
  for (let i = 0; i < yes.length; i++) {
    assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 1, 2 + i), charToTile(yes[i]), `option 0 glyph ${i} must land on row 1`);
  }
  const no = 'No';
  for (let i = 0; i < no.length; i++) {
    assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 2, 2 + i), charToTile(no[i]), `option 1 glyph ${i} must land on row 2 -- a row-offset bug in the mapper would show here, not on option 0`);
  }
  // The cursor starts on option 0: box-relative row 1, col 1 (the padding column).
  assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 1, 1), charToTile('\x7f'), 'the initial choice cursor must land at the mapper-computed cell');
});

test('case 6 sabotage: forcing text_choice_step to the ordinary ($23xx) path even while streamed makes both option rows land off the mapper-computed cells', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('text.asm');
  const needle = 'text_choice_step_guard_start:\n  .if STREAMING_ENABLED\n  .if TEXT_ENABLED\n  ; Fix round 1 (A4): relocated to sw_dlg_hi_choice_step,\n  ; engine/streamworld.asm -- see text_open_row_guard_start\'s own comment\n  ; above.\n  lda <map_is_streamed\n  beq text_choice_step_ordinary\n';
  const mutant = mutateOnce(source, needle, needle.replace('  beq text_choice_step_ordinary\n', '  jmp text_choice_step_ordinary\n'), 'text_choice_step bypass (case 6 sabotage)');
  const project = createStreamedProject({});
  const slot = interactEntity(project, {
    x: 200, y: 112,
    commands: [{ op: 'choice', options: [{ text: 'Yes', commands: [] }, { text: 'No', commands: [] }] }],
  });
  project.code = { overrides: [{ name: 'text.asm', text: mutant }], files: [] };
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll)');
  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CHOICEWAIT, 60);
  nes.frame();

  const camXLo = mem[CAM_X_LO];
  const camYLo = mem[CAM_Y_LO];
  const camNt = mem[CAM_NT];
  assert.notEqual(camXLo & 0xf0, 0, 'sanity: the walk must have actually moved the camera off (0,0)');
  assert.notEqual(dlgCellTile(nes, camXLo, camYLo, camNt, 1, 2), charToTile('Y'), 'forcing the ordinary $23xx path must make the mapper-computed cell NOT show option 0\'s own label -- a correct-looking test that could not tell this apart from case 6\'s own positive would be worthless');
});

test('case 6 sabotage: corrupting only the second option\'s own row offset (box_row==1) leaves option 0 correct and breaks only option 1 -- a row-offset bug in the mapper, not an ordinary-address bypass', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('streamworld.asm');
  // sw_dlg_hi_choice_step computes the box-relative row as box_row+1 for EVERY option -- option 0
  // (box_row==0) lands on row 1, option 1 (box_row==1) lands on row 2. A row-offset bug would only
  // ever show on one option at a time; corrupting the shared `adc #1` for every option (as the
  // sabotage above does, by bypassing the whole routine) cannot distinguish "wrong offset" from
  // "wrong routine entirely". This mutant instead branches on box_row itself, adding 2 (not 1) only
  // when box_row==1, leaving option 0's own computation untouched.
  const needle = 'sw_dlg_hi_choice_step:\n  lda <box_row\n  clc\n  adc #1\n  ldx #2\n';
  const replacement = 'sw_dlg_hi_choice_step:\n  lda <box_row\n  cmp #1\n  bne sw_dlg_hi_cs_opt0\n  clc\n  adc #2\n  jmp sw_dlg_hi_cs_offdone\nsw_dlg_hi_cs_opt0:\n  clc\n  adc #1\nsw_dlg_hi_cs_offdone:\n  ldx #2\n';
  const mutant = mutateOnce(source, needle, replacement, 'sw_dlg_hi_choice_step second-option-only row offset corruption (case 6 sabotage)');
  const project = createStreamedProject({});
  const slot = interactEntity(project, {
    x: 200, y: 112,
    commands: [{ op: 'choice', options: [{ text: 'Yes', commands: [] }, { text: 'No', commands: [] }] }],
  });
  project.code = { overrides: [{ name: 'streamworld.asm', text: mutant }], files: [] };
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll)');
  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CHOICEWAIT, 60);
  nes.frame();

  const camXLo = mem[CAM_X_LO];
  const camYLo = mem[CAM_Y_LO];
  const camNt = mem[CAM_NT];
  assert.notEqual(camXLo & 0xf0, 0, 'sanity: the walk must have actually moved the camera off (0,0)');
  assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 1, 2), charToTile('Y'), 'option 0 must still land correctly on row 1 -- this mutant touches only box_row==1\'s own offset, proving the corruption is selective');
  assert.notEqual(dlgCellTile(nes, camXLo, camYLo, camNt, 2, 2), charToTile('N'), 'option 1\'s own label must NOT land on row 2 -- it was pushed to row 3 by the corrupted offset -- a correct-looking test that could not tell this apart from case 6\'s own positive (which finds both options correctly placed) would be worthless');
});

// ---------------------------------------------------------------------------------------------
// Case 7 (plan case 7): a naming-grid cell must route through the mapper too. Round 3, finding A8
// correction (round 3b): naming does NOT only happen at boot with the camera pinned to (0,0), and
// nothing about an RPG's hero-naming session pins it there either -- the action-game case
// immediately below (case 7/10) opens naming at a real, nonzero, unaligned start (201,177) reached
// with no hand override at all, A3's own titleless RPG test further below (:2503) reaches this
// SAME hero-naming boot path with startX/startY=(201,177) instead of the default and lands a
// nonzero camera with no hand override either, and A3's own "mid-game Join" test opens naming
// after a real walk, mid-game, at whatever nonzero camera that walk already produced. What IS
// true, and is THIS test's own actual reason for a hand override, is narrower still: this test's
// own project carries createStreamedProject's default, unmodified start position
// (project.project.startX=120, project.project.startY=112 -- shared/project.js:4369-4370's own
// defaults, never overridden here), and the camera window's own clamp floors exactly that default
// to (0,0) on both axes -- camPx=clamp(worldX-120, 0, ...), camPy=clamp(worldY-112, 0, ...)
// (engine/streamworld.asm:2857,2887): 120-120=0, 112-112=0 -- for ANY game type at that same
// default start, not something an RPG boot or hero naming categorically pins to (0,0). And at
// (0,0) the mapped and the ordinary fixed $23xx address are IDENTICAL
// (streamworlddialoguemapper.test.js's own finding), so THIS test's own particular (default-start)
// scenario could never discriminate a mapper bypass by itself without a hand override -- a
// property of this one test's own project, not of RPG naming in general. Naming is also banked on
// an RPG (engine/banks.asm/call_battle) -- a direct callRoutine straight into the banked region
// crashes (confirmed directly: an earlier version of this test tried exactly that and hit "Game
// crashed, invalid opcode", since nothing had switched the PRG bank the routine's own code lives
// in). So this test drives the REAL boot path (so bank switching happens exactly as production
// code does it), catches the exact frame the naming grid first reaches BOX_NAMEENTRY (box_row is
// guaranteed 0 right at that transition, before any row has been drawn under the boot's own (0,0)
// camera), hand-overrides the camera to a non-trivial value at that precise instant, then lets the
// grid's own real per-frame redraw run forward from there -- the same hand-set-a-precondition-
// before-a-real-call discipline case 1 already uses, applied to a boot-time state this test's own
// default-start project could never itself reach naturally (an RPG's hero naming cannot happen
// after a walk that would otherwise move the camera off this project's own default start -- but a
// DIFFERENT start position, as A3's own titleless RPG test and case 7/10's own action test both
// show, reaches a nonzero camera at this identical boot-time moment with no override needed at
// all).
//
// An action project carrying both naming and a streamed map was, at slice 7b's own first cut,
// permanently infeasible on kernel-lo (buildProject's own capacity refusal) -- NOT merely
// unmeasured. Fix round 1's own A4 work (relocating the dialogue lifecycle's kernel-lo call sites
// into kernel-hi dispatch stubs) freed enough kernel-lo budget to lift that refusal (confirmed
// directly: `createStreamedProject({ gameType: 'action', naming: true })` now builds clean, and
// `shared/project.js` no longer contains any action+naming+streaming refusal at all). The
// action-game positive/sabotage pair below (round 2, finding A7) exercises exactly that placement,
// at a real nonzero unaligned start so the camera is already off (0,0) without any hand override at
// all -- unlike the RPG case immediately below, which boots to (0,0) and needs one.
// ---------------------------------------------------------------------------------------------

test('case 7: a naming-grid letter row routes every cell through the mapper at a non-trivial camera', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({ gameType: 'rpg', naming: true });
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-naming-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const bytes = new Uint8Array(fs.readFileSync(built.romPath));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(bytes);
  const mem = nes.cpu.mem;

  const BOX_NAMEENTRY = 9;
  let frames = 0;
  while (mem[BOX_STATE] !== BOX_NAMEENTRY && frames < 200) { nes.frame(); frames++; }
  assert.ok(frames < 200, 'boot must reach the naming grid within budget');
  assert.equal(mem[BOX_ROW], 0, 'box_row must be exactly 0 at the instant BOX_NAMEENTRY is first reached -- nothing has been drawn under the boot camera yet');
  assert.equal(mem[MAP_IS_STREAMED], 1, 'the starting map must actually be streamed, or this test proves nothing about the mapper');

  mem[CAM_X_LO] = 0x53;
  mem[CAM_Y_LO] = 0x27;
  mem[CAM_NT] = 2;

  driveUntil(nes, mem, (m) => m[BOX_ROW] === 2, 10); // dispatches box_row 0 (preview), then 1 (upper) under the injected camera
  assert.equal(mem[BOX_ROW], 2, 'the upper-case letter row must have been dispatched (box_row advanced past it)');
  nes.frame(); // the write queued the same frame box_row advances drains on the NEXT frame's NMI (cases 5/6's own finding)

  const camXLo = mem[CAM_X_LO];
  const camYLo = mem[CAM_Y_LO];
  const camNt = mem[CAM_NT];
  const expectedBytes = [charToTile(' '), ...Array.from({ length: 26 }, (_, i) => charToTile('A') + i), charToTile(' ')];
  for (let i = 0; i < expectedBytes.length; i++) {
    assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 2, 2 + i), expectedBytes[i], `letter-grid cell ${i} must land at the mapper-computed cell (row 2, col ${2 + i}), not $23xx`);
  }
});

test('case 7 sabotage: forcing nameentry_push to the ordinary ($23xx) path even while streamed makes the letter grid land off the mapper-computed cells', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('nameentry.asm');
  const needle = 'nameentry_push:\n  pha\n  lda <map_is_streamed\n  beq nameentry_push_ordinary\n';
  const mutant = mutateOnce(source, needle, needle.replace('  beq nameentry_push_ordinary\n', '  jmp nameentry_push_ordinary\n'), 'nameentry_push bypass (case 7 sabotage)');

  const project = createStreamedProject({ gameType: 'rpg', naming: true });
  project.code = { overrides: [{ name: 'nameentry.asm', text: mutant }], files: [] };
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-naming7sab-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const bytes = new Uint8Array(fs.readFileSync(built.romPath));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(bytes);
  const mem = nes.cpu.mem;

  const BOX_NAMEENTRY = 9;
  let frames = 0;
  while (mem[BOX_STATE] !== BOX_NAMEENTRY && frames < 200) { nes.frame(); frames++; }
  assert.ok(frames < 200, 'boot must reach the naming grid within budget');
  assert.equal(mem[MAP_IS_STREAMED], 1, 'the starting map must actually be streamed, or this test proves nothing about the mapper');

  mem[CAM_X_LO] = 0x53;
  mem[CAM_Y_LO] = 0x27;
  mem[CAM_NT] = 2;

  driveUntil(nes, mem, (m) => m[BOX_ROW] === 2, 10);
  assert.equal(mem[BOX_ROW], 2, 'sabotage sanity: the upper-case letter row must still have been dispatched');
  nes.frame();

  const camXLo = mem[CAM_X_LO];
  const camYLo = mem[CAM_Y_LO];
  const camNt = mem[CAM_NT];
  assert.notEqual(dlgCellTile(nes, camXLo, camYLo, camNt, 2, 3), charToTile('A'), 'forcing the ordinary $23xx path must make the mapper-computed cell NOT show the first letter -- a correct-looking test that could not tell this apart from case 7\'s own positive would be worthless');
});

test('case 7/10 (action): a real action-game naming session at a nonzero unaligned streamed start routes the mapped letter grid through the mapper, moves the hardware cursor, and persists the completed name', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({ gameType: 'action', naming: true });
  project.project.startX = 201;
  project.project.startY = 177;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-action-naming-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const bytes = new Uint8Array(fs.readFileSync(built.romPath));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(bytes);
  const mem = nes.cpu.mem;

  const BOX_NAMEENTRY = 9;
  let frames = 0;
  while (mem[BOX_STATE] !== BOX_NAMEENTRY && frames < 200) { nes.frame(); frames++; }
  assert.ok(frames < 200, 'boot must reach the naming grid within budget');
  assert.equal(mem[MAP_IS_STREAMED], 1, 'the starting map must actually be streamed, or this test proves nothing about the mapper');
  assert.notEqual(mem[CAM_X_LO], 0, 'sanity: an unaligned nonzero start must actually move the camera off column 0, with no hand override needed on an action project');
  assert.equal(mem[CAM_X_LO] & 0x0f, 0, 'cam_x_lo must already be floored to a 16px boundary by the time naming opens, exactly as A3 already found for RPG');
  assert.equal(mem[CAM_Y_LO] & 0x0f, 0, 'cam_y_lo must already be floored to a 16px boundary by the time naming opens');
  assert.equal(mem[SW_DLG17_CAMHOLD], 1, 'the camera/OAM hold must be raised for naming exactly as an ordinary in-game interact raises it, on an action project too');

  waitForNamingReady(nes);
  const camXLo = mem[CAM_X_LO];
  const camYLo = mem[CAM_Y_LO];
  const camNt = mem[CAM_NT];
  const expectedBytes = [charToTile(' '), ...Array.from({ length: 26 }, (_, i) => charToTile('A') + i), charToTile(' ')];
  for (let i = 0; i < expectedBytes.length; i++) {
    assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 2, 2 + i), expectedBytes[i], `letter-grid cell ${i} must land at the mapper-computed cell (row 2, col ${2 + i}) at a real, non-injected nonzero camera on an action project`);
  }

  const cursorBefore = hardwareOam(nes);
  gotoCell(nes, 0, 5);
  assert.notDeepEqual(hardwareOam(nes), cursorBefore, 'the naming grid\'s own hardware cursor sprite must actually move when the selection moves, not stay stuck -- draw_nameentry_cursor writes real OAM bytes every frame it is open');

  // Round 3, finding A7 case 7/10: nameentry_queue_cell (engine/nameentry.asm) redraws exactly one
  // preview cell per committed letter -- box-relative row 1, column nameIndex+3 -- independent of
  // the full-preview redraw nameentry_draw_preview does at open. Confirmed here before the name is
  // ever finished (typeNameAndFinish below both clears and finishes in one call, so it alone could
  // never show this): each letter's own preview cell must land at the mapper-computed physical
  // destination this real, nonzero, unaligned camera implies, and the next (not-yet-typed) cell must
  // still read blank.
  clearName(nes);
  const partial = 'RE';
  for (let i = 0; i < partial.length; i++) {
    const ch = partial[i];
    gotoCell(nes, 0, ch.charCodeAt(0) - 65); // row 0 -- uppercase
    namingTap(nes, A_BTN);
    for (let j = 0; j <= i; j++) {
      assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 1, 3 + j), charToTile(partial[j]), `preview cell ${j} must show the already-committed letter '${partial[j]}' at the mapper-computed cell (row 1, col ${3 + j}) before the name is finished`);
    }
    assert.equal(dlgCellTile(nes, camXLo, camYLo, camNt, 1, 3 + i + 1), charToTile(' '), `preview cell ${i + 1} (not yet typed) must still read blank at the mapper-computed cell (row 1, col ${3 + i + 1})`);
  }

  typeNameAndFinish(nes, 'Rex');
  let settleFrames = 0;
  while (mem[GAME_STATE] !== ST_GAMEPLAY && settleFrames < 60) { nes.frame(); settleFrames++; }
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'naming must complete into ordinary gameplay on an action project too');
  assert.deepEqual(nameBytes(nes, 0), nameTiles('Rex'), 'the finished name must persist correctly on an action project');
});

test('case 7/10 (action) sabotage: forcing nameentry_push to the ordinary ($23xx) path even while streamed makes the action-game letter grid land off the mapper-computed cell', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('nameentry.asm');
  const needle = 'nameentry_push:\n  pha\n  lda <map_is_streamed\n  beq nameentry_push_ordinary\n';
  const mutant = mutateOnce(source, needle, needle.replace('  beq nameentry_push_ordinary\n', '  jmp nameentry_push_ordinary\n'), 'nameentry_push bypass (case 7/10 action sabotage)');

  const project = createStreamedProject({ gameType: 'action', naming: true });
  project.project.startX = 201;
  project.project.startY = 177;
  project.code = { overrides: [{ name: 'nameentry.asm', text: mutant }], files: [] };
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-action-naming7sab-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const bytes = new Uint8Array(fs.readFileSync(built.romPath));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(bytes);
  const mem = nes.cpu.mem;

  const BOX_NAMEENTRY = 9;
  let frames = 0;
  while (mem[BOX_STATE] !== BOX_NAMEENTRY && frames < 200) { nes.frame(); frames++; }
  assert.ok(frames < 200, 'sabotage setup: boot must reach the naming grid within budget');
  assert.equal(mem[MAP_IS_STREAMED], 1, 'sabotage setup: the starting map must actually be streamed');
  assert.notEqual(mem[CAM_X_LO], 0, 'sabotage sanity: the unaligned start must still move the camera off column 0');

  waitForNamingReady(nes);
  const camXLo = mem[CAM_X_LO];
  const camYLo = mem[CAM_Y_LO];
  const camNt = mem[CAM_NT];
  assert.notEqual(dlgCellTile(nes, camXLo, camYLo, camNt, 2, 3), charToTile('A'), 'forcing the ordinary $23xx path must make the mapper-computed cell NOT show the first letter on an action project -- a correct-looking test that could not tell this apart from the positive above would be worthless');
});

// ---------------------------------------------------------------------------------------------
// Case 8 (plan case 8): the frozen-world strip drain, including a real close-side overrun
// (outstanding work still queued when the box needs to close), must not proceed before
// acknowledging it.
//
// Round 2, finding A7 case 8 correction: an earlier version of this section's own comment claimed
// a strip shares vram_buf/vram_ready with every other producer. That is false, confirmed directly
// by reading the routines rather than restating the old comment: sw_nmi_stream (engine/
// streamworld.asm) draws strip blocks straight to the PPU during NMI, gated solely by st_active,
// and clears it via sw_ns_finish once st_cur reaches st_len -- it never touches vram_buf/
// vram_len/vram_ready at all. sw_dlg17_camrelease (the DRAINING release guard) in turn checks
// ONLY vram_ready, never st_active.
//
// That is not a gap in the guard: it is safe by construction, and the construction is verified
// below rather than merely asserted. update_player -- the only caller of sw_frame_camera_window/
// sw_win_arm, the only code that ever arms a NEW strip -- is reached exclusively through
// main_loop's own `lda game_state / bne main_loop_ui` gate (engine/boot.asm), so once a dialogue
// has set game_state to ST_DIALOG (start_dialog's own doing, before box_begin ever runs) no new
// strip can be armed for the rest of the conversation. And sw_dlg15_pending_step's own st_active
// guard (case 1) already refuses to leave PENDING for OPEN while a strip armed just before the
// freeze is still in flight. Combined, st_active is provably 0 for the entire OPEN-through-
// DRAINING span of every real conversation -- a strip can never be the thing DRAINING's real
// close-side overrun is waiting on. The close-side overrun that IS reachable is exactly what the
// existing vram_ready test below already exercises, through the real vram_open/vram_push/
// vram_end producer -- its own comment is corrected in place rather than duplicated here.
//
// What real strip coverage requires instead -- and was missing -- is arming a genuine strip
// through its own real production entry point (sw_stream_start_col, not a hand-set st_active
// flag) immediately before an interact, and proving PENDING's self-loop actually holds across
// several real per-frame NMIs while the strip drains for real (st_cur genuinely advancing via
// sw_nmi_stream, game_state already ST_DIALOG the entire time -- the world genuinely frozen, not
// merely a flag saying so), only opening once the real drain completes on its own. That is the
// new test immediately below; it also drives the conversation on through to a real close and
// asserts the st_active-is-always-0-by-then invariant argued above, rather than leaving it as an
// unverified claim in this comment.
// ---------------------------------------------------------------------------------------------

const WIN_COL_SCREEN = 0x05b1;
const WIN_COL_LOCAL = 0x05b2;
const ST_LEN = 0x05b7;
const ST_CUR = 0x05b6;

test('case 8: a genuinely armed real strip (sw_stream_start_col, not a hand-set flag) holds PENDING\'s self-loop and drains for real across several frames while the world is already frozen, then opens on its own once the drain completes -- and st_active never becomes active again through a real close', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'AB' }] });
  const { nes, mem, addrOf } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll)');

  // The TRUE resume point -- captured before any callRoutine call, which hijacks PC via its own
  // JSR/NOP stub and does not restore the caller's context on return (camera.test.js's own
  // established convention for interleaving callRoutine with real per-frame stepping).
  const pausedPC = nes.cpu.REG_PC;
  const pausedA = nes.cpu.REG_ACC;
  const pausedX = nes.cpu.REG_X;
  const pausedY = nes.cpu.REG_Y;
  const pausedP = nes.cpu.getStatus();

  // Arm a real strip through its own real production entry point -- test/unit/streamworldnmi.
  // test.js's own established convention for calling sw_stream_start_col directly (A=screenCol,
  // X=localCol of an edge already tracked by the window this exact real walk just produced).
  nes.cpu.REG_ACC = mem[WIN_COL_SCREEN];
  nes.cpu.REG_X = mem[WIN_COL_LOCAL];
  callRoutine(nes, addrOf('sw_stream_start_col'));
  assert.equal(mem[ST_ACTIVE], 1, 'setup: the strip must actually be armed');
  assert.equal(mem[ST_LEN], 30, 'setup: a column strip is always 30 blocks');
  assert.equal(mem[ST_CUR], 0, 'setup: freshly armed, nothing drawn yet');

  // Restore the true resume point and every register callRoutine's own stub-call sequence
  // clobbered, then $2000 to the same real value nmi_scroll's own camera write last left it at
  // (PPUCTRL_ON with cam_nt in bits 0-1) -- or the frames below would never take a real NMI at
  // all, since callRoutine disabled NMI generation as a side effect of its own stub call.
  nes.cpu.REG_PC = pausedPC;
  nes.cpu.REG_ACC = pausedA;
  nes.cpu.REG_X = pausedX;
  nes.cpu.REG_Y = pausedY;
  nes.cpu.setStatus(pausedP);
  nes.mmap.write(0x2000, 0x88 | (mem[CAM_NT] & 3));

  tap(nes, B, 0);
  assert.equal(mem[GAME_STATE], ST_DIALOG, 'the world must already be frozen -- start_dialog sets game_state before box_begin ever runs');
  assert.equal(mem[BOX_STATE], BOX_CLOSED, 'the box itself must not have opened yet -- box_begin only arms PENDING while streamed');
  assert.equal(mem[SW_DLG15_STATE], SW_DLG15_PENDING, 'PENDING must hold on the very same frame -- the strip armed above is still in flight');

  // Loop on sw_dlg15_state itself, not st_active: NMI (which drains the strip) runs before
  // mainline (which checks st_active and may resolve PENDING) within the SAME nes.frame() call,
  // so the frame the drain finishes on is also the frame PENDING can resolve on -- there is no
  // guaranteed extra frame between "st_active reads 0" and "the box is open."
  let frames = 0;
  let lastCur = mem[ST_CUR];
  let sawProgress = false;
  while (mem[SW_DLG15_STATE] === SW_DLG15_PENDING && frames < 20) {
    nes.frame();
    frames++;
    assert.equal(mem[GAME_STATE], ST_DIALOG, `frame ${frames}: the world must stay frozen until PENDING resolves`);
    if (mem[ST_CUR] !== lastCur) sawProgress = true;
    assert.ok(mem[ST_CUR] >= lastCur, `frame ${frames}: st_cur must never move backwards`);
    lastCur = mem[ST_CUR];
  }
  assert.ok(frames < 20, 'the real strip must actually finish draining within budget, not hang PENDING forever');
  assert.ok(sawProgress, 'st_cur must genuinely have advanced across these frames -- proving the strip really drained, not merely that time passed');
  assert.equal(mem[ST_CUR], 30, 'the real drain must have completed all 30 blocks');
  assert.equal(mem[ST_ACTIVE], 0, 'once PENDING resolves, the real drain must genuinely be finished, never merely timed out');
  assert.equal(mem[SW_DLG15_STATE], SW_DLG15_IDLE, 'PENDING must have resolved to IDLE on its own once the real drain completed');
  assert.notEqual(mem[BOX_STATE], BOX_CLOSED, 'the box must actually open once the real strip finished draining');
  assert.equal(mem[SW_DLG17_CAMHOLD], 1, 'the camera/OAM hold must be raised exactly as an ordinary open already raises it');

  // Drive the conversation all the way through a real close, verifying the invariant this case's
  // own comment above argues rather than merely asserting it: a strip can never be active again
  // once OPEN is reached, because nothing left in the conversation can arm one.
  let settle = 0;
  while (mem[BOX_STATE] !== BOX_ENDWAIT && settle < 60) {
    assert.equal(mem[ST_ACTIVE], 0, `settle frame ${settle}: st_active must stay 0 for the rest of the conversation -- nothing can re-arm a strip while the world stays frozen`);
    nes.frame();
    settle++;
  }
  assert.ok(settle < 60, 'the message must finish typing within budget');

  tap(nes, B, 0);
  let closeFrames = 0;
  while (mem[GAME_STATE] !== ST_GAMEPLAY && closeFrames < 30) {
    assert.equal(mem[ST_ACTIVE], 0, `close frame ${closeFrames}: st_active must still be 0 through the real DRAINING span -- confirming a strip can never be what a real close-side overrun waits on`);
    nes.frame();
    closeFrames++;
  }
  assert.ok(closeFrames < 30, 'the hold must actually release within budget');
  assert.equal(mem[ST_ACTIVE], 0, 'final: st_active must still be 0 once gameplay resumes');
});

// Direct callRoutine, not a real per-frame boot: main_loop's own end-of-frame handshake
// unconditionally re-sets vram_ready every single frame regardless of any external poke
// (engine/text.asm's own comment: "vram_drain's own vram_drain_done already re-zeroes vram_len/
// vram_ready when it finishes, so main_loop's own end-of-frame handshake has nothing left to
// re-arm" -- implying the ordinary case DOES re-arm it), so a synthetic per-frame override raced
// against that real housekeeping and could not be trusted (confirmed directly: an earlier version
// of this test tried exactly that and failed on the very first held frame). This version queues a
// REAL, unflushed packet through the real vram_open/vram_push/vram_end producers (test/unit/
// camera.test.js's own established convention for exactly this), sets vram_ready the same way
// main_loop's real handshake would, and acknowledges it only through the real vram_drain consumer
// -- never a hand-poked flag value on either side.
function queueOutstandingPacket(nes, addrOf) {
  nes.cpu.REG_ACC = 0x23; // an arbitrary real nametable destination, unrelated to the box itself
  nes.cpu.REG_Y = 0x00;
  callRoutine(nes, addrOf('vram_open'));
  nes.cpu.REG_ACC = 0xab;
  callRoutine(nes, addrOf('vram_push'));
  callRoutine(nes, addrOf('vram_end'));
}

function setupDraining(mem) {
  mem[SW_DLG15_STATE] = SW_DLG15_DRAINING;
  mem[SW_DLG17_CAMHOLD] = 1;
  // Fix round 1, finding A1: cam_dirty is acquired/released within sw_dlg17_camrelease's own
  // single call, only once every guard actually passes -- while genuinely still DRAINING (the
  // guards fail and the routine returns before ever touching cam_dirty), it stays at its real
  // reachable value, 0. sw_dlg17_camhold is the persistent "a hold is logically open" flag.
  mem[CAM_DIRTY] = 0;
  mem[GAME_STATE] = ST_DIALOG;
  mem[SW_DLG_CAM_X_LO] = 0x99;
  mem[SW_DLG_CAM_Y_LO] = 0x77;
  mem[CAM_X_LO] = 0x11;
  mem[CAM_Y_LO] = 0x22;
  mem[SW_DLG15_ORIGIN_X_LO] = 0x60;
  mem[SW_DLG15_ORIGIN_X_HI] = 3;
  mem[SW_DLG15_ORIGIN_Y_LO] = 0x40;
  mem[SW_DLG15_ORIGIN_Y_HI] = 1;
  mem[SW_CAM_ORIGIN_X_LO] = 0;
  mem[SW_CAM_ORIGIN_X_HI] = 0;
  mem[SW_CAM_ORIGIN_Y_LO] = 0;
  mem[SW_CAM_ORIGIN_Y_HI] = 0;
}

test('case 8: an outstanding drain (overrun) blocks the release across every check it is held, and resolves immediately once the real drain consumer acknowledges it', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);

  for (let round = 0; round < 2; round++) {
    setupDraining(mem);
    queueOutstandingPacket(nes, addrOf);
    mem[VRAM_READY] = 1; // main_loop's own real end-of-frame handshake: "the buffer is complete"

    // Held across several checks, not a single snapshot -- the plan's own "not merely that the box
    // eventually closes" warning.
    for (let i = 0; i < 3; i++) {
      callRoutine(nes, addrOf('sw_dlg17_camrelease'));
      assert.equal(mem[SW_DLG15_STATE], SW_DLG15_DRAINING, `round ${round} check ${i}: must still be DRAINING while real outstanding work has not been acknowledged`);
      assert.equal(mem[GAME_STATE], ST_DIALOG, `round ${round} check ${i}: game_state must not resolve`);
      assert.equal(mem[SW_DLG17_CAMHOLD], 1, `round ${round} check ${i}: the logical hold must stay set while still draining`);
      assert.equal(mem[CAM_DIRTY], 0, `round ${round} check ${i}: the camera/OAM publication lock must NOT be raised here -- a failed guard returns before ever touching it`);
      assert.equal(mem[VRAM_READY], 1, `round ${round} check ${i}: sanity -- camrelease itself must never touch vram_ready`);
    }

    // Acknowledge it through the real consumer -- never a hand-poke.
    nes.mmap.write(0x2001, 0); // vram_drain requires forced blank
    callRoutine(nes, addrOf('vram_drain'));
    assert.equal(mem[VRAM_READY], 0, 'vram_drain must have cleared vram_ready as its own real side effect');
    assert.equal(mem[VRAM_LEN], 0, 'vram_drain must have consumed the queued packet');

    callRoutine(nes, addrOf('sw_dlg17_camrelease'));
    assert.equal(mem[SW_DLG15_STATE], SW_DLG15_IDLE, `round ${round}: once genuinely acknowledged, release must fire immediately`);
    assert.equal(mem[GAME_STATE], ST_GAMEPLAY, `round ${round}: game_state must resolve immediately`);
    assert.equal(mem[CAM_DIRTY], 0, `round ${round}: the camera hold must release immediately`);
    assert.equal(mem[CAM_X_LO], 0x99, `round ${round}: cam_x_lo must be restored verbatim`);
    assert.equal(mem[CAM_Y_LO], 0x77, `round ${round}: cam_y_lo must be restored verbatim`);
  }
});

// Round 3, finding A7 case 8: the positive test above proves the guard's own discipline
// (sw_dlg17_camrelease holds while vram_ready reads 1, releases the instant it reads 0) entirely
// through callRoutine and hand-set RAM. It never shows a REAL conversation reaching REAL DRAINING
// with a REAL outstanding packet -- the close-attribute packet text_close_attr_ordinary/
// sw_dlg_hi_close_attr's own third band just queued -- actually held across a genuine multi-frame
// span. Under ordinary real-frame stepping this window is a single frame at most (case 3's own
// finding: NMI runs before mainline within one nes.frame() call, so the very next frame's NMI
// already drains whatever this frame just queued before that frame's own mainline ever calls
// camrelease). To make the hold last across SEVERAL genuine frames -- long enough to actually
// observe "held," not just infer it from a single before/after pair -- this test delays only the
// real NMI consumer's own VRAM acknowledgement (vram_drain's body itself), never the whole NMI or
// any PPUCTRL bit; the round 4 comment on the positive test below has the exact mechanism. No
// close-side strip is needed here (case 8's own OTHER test above already covers a strip held during
// PENDING; this one covers the close-side DRAINING overrun the plan calls out separately).
async function reachRealDraining(t, { mutateVramReadyGuard = false } = {}) {
  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'AB' }] });
  if (mutateVramReadyGuard) {
    const source = readEngineSource('streamworld.asm');
    const needle = '  lda <vram_ready\n  bne sw_dlg17cr_done\n';
    project.code = { overrides: [{ name: 'streamworld.asm', text: mutateOnce(source, needle, '  lda <vram_ready\n  nop\n', 'sw_dlg17_camrelease vram_ready guard (round 4, A7 case 8 review mutant)') }], files: [] };
  }
  const { nes, mem, addrOf } = await buildAndBoot(project);
  // Round 5, finding A7 case 8: independently captured ground truth for the eventual restore --
  // read directly from RAM once the real walk lands but before any dialogue code runs (never
  // re-derived from the lifecycle's own pre-floor snapshot, sw_dlg_cam_x_lo/y_lo). walkToEntity is
  // idempotent once already at the target, so driveDialogueToClose's own walkToEntity call below is
  // a no-op and does not disturb this snapshot.
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll) before the dialogue that will hold it opens');
  const preDialogueCamX = mem[CAM_X_LO];
  const preDialogueCamY = mem[CAM_Y_LO];
  driveDialogueToClose(nes, mem, slot);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CLOSED, 30);
  assert.equal(mem[BOX_STATE], BOX_CLOSED, 'setup: the box must actually have closed');
  assert.equal(mem[SW_DLG15_STATE], SW_DLG15_DRAINING, 'setup: closing must have entered real DRAINING');
  assert.equal(mem[GAME_STATE], ST_DIALOG, 'setup: game_state must still read frozen the instant DRAINING is entered');
  assert.equal(mem[SW_DLG17_CAMHOLD], 1, 'setup: the logical hold must still read raised');
  return { nes, mem, addrOf, preDialogueCamX, preDialogueCamY };
}

// Round 4, finding A7 case 8: round 3's own version masked $2000 bit 7 (NMI generation itself) for
// the whole held span -- engine/boot.asm's wait_vblank then blocks the main loop dead, so
// sw_dlg17_camrelease's own poll never actually runs during any of the "held" frames (confirmed
// directly: an entry counter on sw_dlg17_camrelease recorded zero calls across all five masked
// frames). That proved a stopped main loop preserves state, never that outstanding work survives
// further real release attempts while gameplay is selectively frozen -- the actual thing case 8
// asks for.
//
// This version delays only the real consumer's own VRAM ACKNOWLEDGEMENT (vram_drain's body itself),
// never the whole NMI: frame signalling (nmi_scroll, the OAM DMA, sw_dlg17_camrelease's own once-
// per-frame poll from main_loop_idle) all keep running exactly as they would on real, unthrottled
// hardware. Intercepting cpu.emulate() the instant control is about to enter vram_drain (this
// file's own established REG_PC-plus-one-equals-target convention, case 2's own mid-rebuild
// interrupt tests above) and answering with the exact RTS this vendored core's own opcode 42 case
// performs (pull two bytes off the stack, low then high, straight into REG_PC --
// renderer/emulator/core/cpu.js's own RTS case) returns control to nmi_vram_dispatch's own caller
// without ever running vram_drain's body -- vram_ready/vram_len stay completely untouched, so the
// real queued packet stays genuinely outstanding for exactly as many real NMIs as this delay lasts,
// with no hand-poked flag on either side and no PPUCTRL bit ever masked. A counter on
// sw_dlg17_camrelease's own entry point, armed only while the delay is still outstanding, proves the
// release guard really is polled (and really does keep refusing) against the still-outstanding
// packet, not merely inferred from a frozen main loop.
test('round 3, finding A7 case 8: a real conversation reaching genuine DRAINING with a real outstanding packet keeps gameplay frozen and the hold up while the real NMI consumer\'s own acknowledgement is delayed, counts real release-guard polls made against the still-outstanding packet, and resolves the instant the real consumer actually runs', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const { nes, mem, addrOf, preDialogueCamX, preDialogueCamY } = await reachRealDraining(t);
  assert.equal(mem[VRAM_READY], 1, 'setup: the close-attribute packet this same frame just queued must genuinely still be outstanding -- nothing has drained it yet (NMI runs before mainline, so this frame\'s own queue is untouched until NEXT frame\'s NMI)');
  assert.ok(mem[VRAM_LEN] > 0, 'setup: a real, nonempty packet must actually be sitting in vram_buf, not merely the ready flag');

  const vramDrainAddr = addrOf('vram_drain');
  const camReleaseAddr = addrOf('sw_dlg17_camrelease');
  const heldVramLen = mem[VRAM_LEN];
  // Round 5, finding A7 case 8: the camera must actually stay frozen for the whole delayed span, not
  // merely the logical hold flag -- captured immediately before the delayed span begins (cam_x_lo/
  // cam_y_lo, the lifecycle's own already-floored screen scroll, plus sw_cam_origin_x/y_lo/hi, the
  // streamed-world camera-origin tuple the dialogue mapper itself reads) and compared on every held
  // frame below.
  const cameraBeforeDelay = {
    camX: mem[CAM_X_LO],
    camY: mem[CAM_Y_LO],
    originXLo: mem[SW_CAM_ORIGIN_X_LO],
    originXHi: mem[SW_CAM_ORIGIN_X_HI],
    originYLo: mem[SW_CAM_ORIGIN_Y_LO],
    originYHi: mem[SW_CAM_ORIGIN_Y_HI],
  };
  const DELAY_CALLS = 5;
  let delayCallsRemaining = DELAY_CALLS;
  let delaying = true;
  let releaseAttemptsWhileOutstanding = 0;
  const origEmulate = nes.cpu.emulate.bind(nes.cpu);
  nes.cpu.emulate = () => {
    if (delaying && delayCallsRemaining > 0 && (nes.cpu.REG_PC + 1) === vramDrainAddr) {
      delayCallsRemaining--;
      if (delayCallsRemaining === 0) delaying = false;
      nes.cpu.REG_PC = nes.cpu.pull();
      nes.cpu.REG_PC += nes.cpu.pull() << 8;
      return;
    }
    if (delaying && (nes.cpu.REG_PC + 1) === camReleaseAddr) releaseAttemptsWhileOutstanding++;
    return origEmulate();
  };
  try {
    for (let i = 0; i < DELAY_CALLS; i++) {
      nes.frame();
      assert.equal(mem[VRAM_READY], 1, `held frame ${i}: with the real consumer's own acknowledgement delayed, the real packet must still read outstanding`);
      assert.equal(mem[VRAM_LEN], heldVramLen, `held frame ${i}: vram_buf's own queued length must be completely untouched -- nothing but the real consumer ever drains it`);
      assert.equal(mem[SW_DLG15_STATE], SW_DLG15_DRAINING, `held frame ${i}: DRAINING must hold for as long as the real outstanding work is never acknowledged`);
      assert.equal(mem[GAME_STATE], ST_DIALOG, `held frame ${i}: gameplay must stay frozen -- game_state must not resolve while genuinely held`);
      assert.equal(mem[SW_DLG17_CAMHOLD], 1, `held frame ${i}: the logical hold must stay up while genuinely held`);
      assert.equal(mem[CAM_X_LO], cameraBeforeDelay.camX, `held frame ${i}: cam_x_lo must stay frozen while genuinely held, not merely the hold flag`);
      assert.equal(mem[CAM_Y_LO], cameraBeforeDelay.camY, `held frame ${i}: cam_y_lo must stay frozen while genuinely held`);
      assert.equal(mem[SW_CAM_ORIGIN_X_LO], cameraBeforeDelay.originXLo, `held frame ${i}: sw_cam_origin_x_lo must stay frozen while genuinely held`);
      assert.equal(mem[SW_CAM_ORIGIN_X_HI], cameraBeforeDelay.originXHi, `held frame ${i}: sw_cam_origin_x_hi must stay frozen while genuinely held`);
      assert.equal(mem[SW_CAM_ORIGIN_Y_LO], cameraBeforeDelay.originYLo, `held frame ${i}: sw_cam_origin_y_lo must stay frozen while genuinely held`);
      assert.equal(mem[SW_CAM_ORIGIN_Y_HI], cameraBeforeDelay.originYHi, `held frame ${i}: sw_cam_origin_y_hi must stay frozen while genuinely held`);
    }
    assert.ok(releaseAttemptsWhileOutstanding > 0, `at least one real release-guard poll must actually have run against the still-outstanding packet while the delay was in effect: ${releaseAttemptsWhileOutstanding}`);
    t.diagnostic(`releaseAttemptsWhileOutstanding = ${releaseAttemptsWhileOutstanding}`);

    const releaseFrames = driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 10);
    assert.ok(releaseFrames < 10, 'once the real consumer is allowed to run again, the real drain and release must resolve promptly, not stall');
  } finally {
    nes.cpu.emulate = origEmulate;
  }
  assert.equal(mem[VRAM_READY], 0, 'the real NMI consumer must actually have drained the packet as its own side effect');
  assert.equal(mem[SW_DLG15_STATE], SW_DLG15_IDLE, 'DRAINING must have resolved to IDLE once the real consumer actually ran');
  assert.equal(mem[SW_DLG17_CAMHOLD], 0, 'the logical hold must actually have released');
  // Round 5, finding A7 case 8: once the real consumer resumes and release actually fires, the
  // restored camera must equal the independently captured pre-dialogue values -- never a stale or
  // corrupted one -- not merely the frozen snapshot above (which is itself the lifecycle's own
  // already-floored value, not the ground truth).
  assert.equal(mem[CAM_X_LO], preDialogueCamX, 'once released, cam_x_lo must be restored to the independently captured pre-dialogue camera');
  assert.equal(mem[CAM_Y_LO], preDialogueCamY, 'once released, cam_y_lo must be restored to the independently captured pre-dialogue camera');
});

// Round 4, finding A7 case 8: this is the SAME guard-removal mutant (reachRealDraining's own
// mutateVramReadyGuard option) run against this exact real-lifecycle DRAINING scenario, that
// Chris's round 4 ruling asks for -- exercised in-suite by the scratch harness at
// handoff-next/review-phase2-s7b-fix5-evidence/ (guard8), not by an env var in this file. Without
// the vram_ready guard, sw_dlg17_camrelease releases the instant camhold/state are both satisfied,
// which happens later in the SAME mainline pass that just entered DRAINING -- so reachRealDraining's
// own setup assertion (`SW_DLG15_STATE` must read DRAINING) already fails here, before the delay
// hook the positive test installs is ever reached. An early state/hold assertion failure is accepted
// evidence of discrimination (the round 4 ruling's own words): it demonstrates the exact premature
// release with genuinely outstanding work this guard exists to prevent, without needing a later
// assertion first. Confirmed directly (handoff-next/review-phase2-s7b-fix4-evidence/guard8.log,
// re-confirmed this round by the fix5 harness's own guard8.log): the guard8 scenario fails exactly
// there, never reaching the delay hook.
test('round 3, finding A7 case 8 sabotage: dropping the vram_ready check against the SAME real-lifecycle DRAINING-with-a-real-held-packet scenario above releases instantly, on the very same frame, while the packet is still genuinely outstanding', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('streamworld.asm');
  const needle = '  lda <vram_ready\n  bne sw_dlg17cr_done\n';
  const mutant = mutateOnce(source, needle, '  lda <vram_ready\n  nop\n', 'sw_dlg17_camrelease vram_ready guard (round 3, A7 case 8 sabotage)');

  const project = createStreamedProject({});
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'AB' }] });
  project.code = { overrides: [{ name: 'streamworld.asm', text: mutant }], files: [] };
  const { nes, mem, addrOf } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll)');
  driveDialogueToClose(nes, mem, slot);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CLOSED, 30);
  // Confirmed empirically (not merely reasoned): the sabotaged guard's own camrelease call runs
  // later in the SAME mainline pass that just set BOX_CLOSED/DRAINING this frame (main_loop_idle,
  // after text_tick), so it fires and reaches close_ui before this line ever runs -- there is no
  // separate held frame to observe here at all, unlike the positive test's own controlled-delay
  // span. That immediate, same-frame release IS the discriminating symptom.
  assert.equal(mem[BOX_STATE], BOX_CLOSED, 'setup: the box must actually have closed');
  assert.equal(mem[VRAM_READY], 1, 'the close-attribute packet must genuinely still be outstanding here -- the real consumer (a real NMI) has not run since this packet was queued');
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the sabotaged guard must have released instantly, on the very same frame DRAINING was entered, even though the real packet is still genuinely outstanding -- the real implementation would still read ST_DIALOG here, exactly as the positive test\'s own setup finds, and would keep reading it for as long as the real consumer is controlled-delayed');
  assert.equal(mem[SW_DLG15_STATE], SW_DLG15_IDLE, 'the sabotaged guard must have advanced DRAINING straight to IDLE on the very same frame, with the real packet never actually acknowledged');
});

test('case 8 sabotage: dropping the vram_ready check releases early, mid-overrun -- proving the assertion above actually discriminates', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('streamworld.asm');
  const needle = '  lda <vram_ready\n  bne sw_dlg17cr_done\n';
  const mutant = mutateOnce(source, needle, '  lda <vram_ready\n  nop\n', 'sw_dlg17_camrelease vram_ready guard (case 8 sabotage)');

  const project = createStreamedProject({ gameType: 'rpg' });
  project.code = { overrides: [{ name: 'streamworld.asm', text: mutant }], files: [] };
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-c8sab-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const symbols = fs.readFileSync(built.symbolPath, 'utf8');
  const addrOf = (label) => {
    const m = symbols.match(new RegExp(`^${label}\\s+=\\s+\\$([0-9A-Fa-f]+)`, 'm'));
    assert.ok(m, `${label} should be a named symbol in game.fns`);
    return parseInt(m[1], 16);
  };
  const bytes = new Uint8Array(fs.readFileSync(built.romPath));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(bytes);
  const mem = nes.cpu.mem;

  setupDraining(mem);
  queueOutstandingPacket(nes, addrOf);
  mem[VRAM_READY] = 1; // still genuinely outstanding -- never drained

  callRoutine(nes, addrOf('sw_dlg17_camrelease'));
  assert.equal(mem[SW_DLG15_STATE], SW_DLG15_IDLE, 'a sabotaged release ignoring vram_ready must fire immediately even with real, undrained work still outstanding -- the real implementation would still be DRAINING here (see the positive case above)');
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY);
});

test('case 10: in-game naming reaches a streamed start map and completes correctly -- the positive counterpart to slice 2b\'s negative reachability test', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({ gameType: 'rpg', naming: true });
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-naming10-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const bytes = new Uint8Array(fs.readFileSync(built.romPath));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(bytes);
  const mem = nes.cpu.mem;

  const BOX_NAMEENTRY = 9;
  let frames = 0;
  while (mem[BOX_STATE] !== BOX_NAMEENTRY && frames < 200) { nes.frame(); frames++; }
  assert.ok(frames < 200, 'boot must reach the naming grid within budget');
  assert.equal(mem[MAP_IS_STREAMED], 1, 'the starting map must actually be streamed, or this test proves nothing about reachability');

  typeNameAndFinish(nes, 'Zed');

  let settleFrames = 0;
  while (mem[GAME_STATE] !== ST_GAMEPLAY && settleFrames < 60) { nes.frame(); settleFrames++; }
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'boot must proceed past naming into ordinary gameplay');
  assert.equal(mem[BOX_STATE], BOX_CLOSED, 'the box must be closed once gameplay begins');
  assert.equal(mem[MAP_IS_STREAMED], 1, 'the streamed map must still be the one gameplay landed on');

  assert.deepEqual(
    nameBytes(nes, 0),
    nameTiles('Zed'),
    'the finished name must persist into save-shaped RAM (pc_name_ram slot 0), blank-padded, exactly as nameentry.test.js\'s own non-streamed oracle expects'
  );
});

test('case 10 sabotage: misresolving the start map as ordinary at the shared sw_resolve_screen landing point breaks streamed reachability at boot', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('streamworld.asm');
  const needle = 'sw_resolve_owner_streamed:\n  lda #1\n  sta <map_is_streamed\n';
  const mutant = mutateOnce(source, needle, needle.replace('  lda #1\n', '  lda #0\n'), 'sw_resolve_owner_streamed misresolve (case 10 sabotage)');

  const project = createStreamedProject({ gameType: 'rpg', naming: true });
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-naming10sab-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  project.code = { overrides: [{ name: 'streamworld.asm', text: mutant }], files: [] };
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const bytes = new Uint8Array(fs.readFileSync(built.romPath));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(bytes);
  const mem = nes.cpu.mem;

  const BOX_NAMEENTRY = 9;
  let frames = 0;
  while (mem[BOX_STATE] !== BOX_NAMEENTRY && frames < 200) { nes.frame(); frames++; }
  assert.ok(frames < 200, 'sabotage setup: naming must still open -- only the landing\'s own map_is_streamed bit is wrong, not naming itself');
  assert.notEqual(mem[MAP_IS_STREAMED], 1, 'misresolving the shared landing point must land on the start map believing it is ordinary -- a correct-looking test that could not tell this apart from case 10\'s own positive (map_is_streamed === 1) would be worthless');
});

// ---------------------------------------------------------------------------------------------
// A3 coverage (fix round 1, finding A3): the review's own exact reproduction -- a titleless
// streamed RPG start at (201,177) reached BOX_NAMEENTRY with cam_x_lo=81, cam_y_lo=65 (both
// unaligned), camhold=0, cam_dirty=0, because boot.asm's naming request used to fire before
// boot_streamed_landing had resolved map_is_streamed for real. Case 10 above already proves
// reachability, but at the project's own default (near-origin) start position, which the finding
// says "hides" the bug. The three tests below cover exactly what the finding asks for: "nonzero,
// unaligned titleless starts plus title-start and Join entry paths."
// ---------------------------------------------------------------------------------------------

test('A3: a nonzero, unaligned titleless streamed start (the review\'s own (201,177) reproduction) reaches naming already floored, with the hold correctly raised', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({ gameType: 'rpg', naming: true });
  project.project.startX = 201;
  project.project.startY = 177;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-a3unaligned-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const bytes = new Uint8Array(fs.readFileSync(built.romPath));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(bytes);
  const mem = nes.cpu.mem;

  const BOX_NAMEENTRY = 9;
  let frames = 0;
  while (mem[BOX_STATE] !== BOX_NAMEENTRY && frames < 200) { nes.frame(); frames++; }
  assert.ok(frames < 200, 'boot must reach the naming grid within budget');
  assert.equal(mem[MAP_IS_STREAMED], 1, 'the starting map must actually be streamed, or this reproduces nothing');
  assert.notEqual(mem[CAM_X_LO], 0, 'sanity: (201,177) must actually land the camera off column 0, unlike the default near-origin start the finding says hides this bug');

  assert.equal(mem[CAM_X_LO] & 0x0f, 0, 'cam_x_lo must already be floored to a 16px boundary by the time naming opens -- the exact alignment the review\'s own repro found violated (cam_x_lo=81 there)');
  assert.equal(mem[CAM_Y_LO] & 0x0f, 0, 'cam_y_lo must already be floored to a 16px boundary by the time naming opens (cam_y_lo=65 in the review\'s own repro)');
  assert.equal(mem[SW_DLG17_CAMHOLD], 1, 'the camera/OAM hold must be raised for naming exactly as an ordinary in-game interact raises it -- the review\'s own repro found camhold=0');
  assert.equal(mem[CAM_DIRTY], 0, 'the publication lock must already be released by the time naming opens (it only brackets the rebuild, see A1)');

  typeNameAndFinish(nes, 'Zed');
  let settleFrames = 0;
  while (mem[GAME_STATE] !== ST_GAMEPLAY && settleFrames < 60) { nes.frame(); settleFrames++; }
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'naming must still complete into ordinary gameplay from an unaligned start');
  assert.deepEqual(nameBytes(nes, 0), nameTiles('Zed'), 'the finished name must still persist correctly from an unaligned start');
});

test('A3: naming opens correctly aligned when reached from a title screen "start" on a streamed map', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const ST_TITLE = 3;
  const project = createStreamedProject({ gameType: 'rpg', naming: true, mixed: true });
  project.project.startMap = 1; // mixed mode: 0 = "Before" (ordinary), 1 = "Streamed", 2 = "After"
  project.project.startX = 201;
  project.project.startY = 177;
  project.project.titleMap = 0; // the ordinary "Before" map -- a real, separate title screen
  project.project.titleScreen = 0;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-a3title-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const bytes = new Uint8Array(fs.readFileSync(built.romPath));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(bytes);
  const mem = nes.cpu.mem;

  // A fixed, unconditional settle (nameentry.test.js's own bootRom convention) rather than an
  // early-exit loop: title_tick_input only samples pad_new on frames where its own blink phase
  // has settled (frame_cnt & $1F == 0 -- the "only on the frame the phase changes" comment), so
  // pressing the very first frame game_state reads ST_TITLE can land on a frame that ignores input.
  for (let i = 0; i < 60; i++) nes.frame();
  assert.equal(mem[GAME_STATE], ST_TITLE, 'boot must reach the title screen (and settle there) within budget -- titleMap must actually be wired');
  namingTap(nes, BUTTON.START, 20);

  const BOX_NAMEENTRY = 9;
  let frames = 0;
  while (mem[BOX_STATE] !== BOX_NAMEENTRY && frames < 200) { nes.frame(); frames++; }
  assert.ok(frames < 200, '"start" from the title must reach naming within budget');
  assert.equal(mem[MAP_IS_STREAMED], 1, 'the streamed map named by startMap must be the one "start" actually lands on');
  assert.equal(mem[CAM_X_LO] & 0x0f, 0, 'cam_x_lo must be floored to a 16px boundary -- title.asm\'s start_game calls redraw_screen (which resolves map_is_streamed for real) before naming, so this path was never the A3 bug, but the finding still asks it be covered');
  assert.equal(mem[CAM_Y_LO] & 0x0f, 0, 'cam_y_lo must be floored to a 16px boundary');
  assert.equal(mem[SW_DLG17_CAMHOLD], 1, 'the camera/OAM hold must be raised for naming reached from the title, exactly as for a titleless cold boot');

  typeNameAndFinish(nes, 'Zed');
  let settleFrames = 0;
  while (mem[GAME_STATE] !== ST_GAMEPLAY && settleFrames < 60) { nes.frame(); settleFrames++; }
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'naming reached from the title must still complete into ordinary gameplay');
});

test('A3: a mid-game Join naming session opens correctly aligned on an already-streamed map', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({ gameType: 'rpg' });
  project.project.startX = 201;
  project.project.startY = 177;
  // A second, unrecruited, renamable party member -- script_op_join's own "named Join" path
  // (engine/script.asm) needs a real pc_in_party[x]==0 slot (startsInParty: false, createPartyMember's
  // own default for a nonzero id) and the operand's bit-7 naming-candidate flag, which textcompile.js
  // only sets when the target member is both renamable and not already starting in the party
  // (font.test.js's own "inert join" case: renamable + startsInParty together never candidates).
  project.party.push({ ...createPartyMember(1), renamable: true });
  const slot = interactEntity(project, { x: 216, y: 112, commands: [{ op: 'join', member: 1 }] });
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll, unaligned start)');

  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  const BOX_NAMEENTRY = 9;
  const frames = driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_NAMEENTRY, 60);
  assert.ok(frames < 60, 'a named Join must reach the naming grid within budget');
  assert.equal(mem[GAME_STATE], ST_DIALOG, 'a named Join\'s own naming session runs inside ST_DIALOG, never ST_NAMEENTRY (engine/script.asm\'s own comment)');
  assert.equal(mem[CAM_X_LO] & 0x0f, 0, 'cam_x_lo must still read floored -- Join naming reuses the same already-resolved streamed map, never a fresh boot-time resolution race');
  assert.equal(mem[CAM_Y_LO] & 0x0f, 0, 'cam_y_lo must still read floored');
  assert.equal(mem[SW_DLG17_CAMHOLD], 1, 'the camera/OAM hold must be raised for Join naming exactly as for an ordinary interact');

  typeNameAndFinish(nes, 'Ivy');
  const closeFrames = driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 60);
  assert.ok(closeFrames < 60, 'Join naming must complete back into ordinary gameplay');
  assert.deepEqual(nameBytes(nes, 1), nameTiles('Ivy'), 'the finished Join name must persist into party slot 1\'s own name bytes');
});

// ---------------------------------------------------------------------------------------------
// Case 11 (plan case 11, rewritten by finding 7's third round): contract §7 freezes the world
// (camera/strip advance) before a box opens, so a strip can never advance mid-choice -- the
// round-2 plan's own "advance while a choice is open" case was unreachable and is not attempted.
// Rewritten: settle the camera at three consecutive metatile (16px) steps that bracket the
// vertical nametable-row wrap (sw_dlg_tile_addr's own physRowRaw >= 30 contract, dlgPhysPos
// above) exactly at the choice cursor's own box-relative row (row 1, established by case 6) --
// one step short of the wrap (row 1 unwrapped), the step where the wrap first reaches row 1
// (freshly wrapped), and one step past it (still wrapped, proving the mapper does not un-wrap or
// double-wrap on the next step) -- then open the choice with the world frozen at each position and
// assert the cursor glyph lands at the mapper's own computed cell.
//
// The three camYLo values are hand-set immediately before triggering the interact, rather than
// reached by an actual walk, because: (1) camYLo is always floored to a 16px multiple before a
// box opens (the PENDING test above), so cam_y_lo>>3 is always even, while box-relative row 1 is
// odd -- their sum is always odd and can never equal the wrap threshold (30, even) exactly; the
// wrap is crossed in one atomic 16px step, never straddled, so no walk could stop "on" it. (2)
// camera_slide_tick (engine/camera.asm) -- the only per-frame routine that writes cam_y_lo outside
// the dialogue lifecycle itself -- is gated on cam_slide_left, which is zero here (no door-warp
// slide is in progress), so it is a no-op; and no movement button is held between the poke and the
// interact press, so nothing else touches cam_y_lo before box_begin reads and freezes it. This is
// the same hand-set-a-precondition-before-a-real-call discipline case 1 and case 7 already use.
// ---------------------------------------------------------------------------------------------

test('case 11: the choice cursor lands on the mapper-computed cell at three camera positions bracketing the row-wrap seam', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({});
  const slot = interactEntity(project, {
    x: 200, y: 112,
    commands: [{ op: 'choice', options: [{ text: 'Yes', commands: [] }, { text: 'No', commands: [] }] }],
  });
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll)');
  assert.notEqual(mem[CAM_X_LO] & 0xf0, 0, 'sanity: the walk must have actually moved the camera off column 0 -- at column 0 the mapped and the ordinary fixed address coincide, and this test would prove nothing');

  // cam_y_lo>>3 = 4, 6, 8 -> box-relative row 1's physRowRaw (dlgPhysPos) = 29 (unwrapped), 31
  // (wrapped), 33 (still wrapped) -- independently derived, never read back from the routine.
  const cases = [
    { camYLo: 0x20, label: 'one metatile step before the wrap (row 1 unwrapped)' },
    { camYLo: 0x30, label: 'exactly the step the wrap first applies to row 1 (freshly wrapped)' },
    { camYLo: 0x40, label: 'one metatile step past the wrap (still wrapped, not double-wrapped)' },
  ];

  for (const { camYLo, label } of cases) {
    // The world is frozen before a box opens (contract §7); this is the pre-open settle the plan
    // asks for, not a mid-choice advance -- see the file comment above.
    mem[CAM_Y_LO] = camYLo;

    nes.buttonDown(1, B);
    nes.frame();
    nes.buttonUp(1, B);
    driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CHOICEWAIT, 60);
    assert.equal(mem[BOX_STATE], BOX_CHOICEWAIT, `${label}: both option rows must finish listing`);
    // The initial cursor write (choice_show) is queued the same frame box_state flips to
    // CHOICEWAIT; see case 6's own comment on the identical one-frame vram_buf drain lag.
    nes.frame();

    const camXLo = mem[CAM_X_LO];
    const camYLoActual = mem[CAM_Y_LO];
    const camNt = mem[CAM_NT];
    assert.equal(camYLoActual, camYLo, `${label}: the frozen camera must hold the exact value set before the box opened (already floored, so nudge is a no-op)`);

    assert.equal(
      dlgCellTile(nes, camXLo, camYLoActual, camNt, 1, 1),
      charToTile('\x7f'),
      `${label}: the choice cursor must land at the mapper-computed cell, not the naive unwrapped one`
    );

    // Close this trial's box (confirm option 0, an empty command list) before the next one, so the
    // same interact entity can be retriggered cleanly.
    nes.buttonDown(1, A_BTN);
    nes.frame();
    nes.buttonUp(1, A_BTN);
    driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CLOSED && m[GAME_STATE] === ST_GAMEPLAY, 60);
    assert.equal(mem[BOX_STATE], BOX_CLOSED, `${label}: the box must close cleanly before the next trial`);
  }
});

test('case 11 sabotage: forcing choice_cursor to the ordinary ($23xx) path even while streamed puts the cursor off the mapper-computed cell', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('text.asm');
  const needle = 'choice_cursor:\n  pha\nchoice_cursor_guard_start:\n  .if STREAMING_ENABLED\n  .if TEXT_ENABLED\n  lda <map_is_streamed\n  beq choice_cursor_ordinary\n';
  const mutant = mutateOnce(source, needle, needle.replace('  beq choice_cursor_ordinary\n', '  jmp choice_cursor_ordinary\n'), 'choice_cursor bypass (case 11 sabotage)');

  const project = createStreamedProject({});
  const slot = interactEntity(project, {
    x: 200, y: 112,
    commands: [{ op: 'choice', options: [{ text: 'Yes', commands: [] }, { text: 'No', commands: [] }] }],
  });
  project.code = { overrides: [{ name: 'text.asm', text: mutant }], files: [] };
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll)');
  assert.notEqual(mem[CAM_X_LO] & 0xf0, 0, 'sanity: the walk must have actually moved the camera off column 0');

  // Exactly case 11's own middle trial: the step the wrap first applies to row 1.
  mem[CAM_Y_LO] = 0x30;
  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CHOICEWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_CHOICEWAIT, 'sabotage setup: both option rows must still finish listing -- only the cursor tile itself is mispositioned');
  nes.frame();

  const camXLo = mem[CAM_X_LO];
  const camYLo = mem[CAM_Y_LO];
  const camNt = mem[CAM_NT];
  assert.notEqual(
    dlgCellTile(nes, camXLo, camYLo, camNt, 1, 1),
    charToTile('\x7f'),
    'forcing the ordinary $23xx path must make the mapper-computed cell NOT show the cursor -- a correct-looking test that could not tell this apart from case 11\'s own positive would be worthless'
  );
});

test('case 11 seam/wrap sabotage: corrupting only sw_dlg_tile_addr\'s own wrap subtraction (never the wrap decision, never the whole guard) breaks exactly the wrapped seam positions, leaving the unwrapped one untouched', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  // Round 2, finding A7 case 11: "the new ordinary-address cursor bypass is not that mutation" --
  // the sabotage above disables the WHOLE mapper guard (choice_cursor_guard_start), which is case
  // 11's own already-covered bypass case, not a mutation of the seam/wrap arithmetic itself. This
  // targets sw_dlg_tile_addr's row-wrap subtraction alone (engine/streamworld.asm: `cmp #30 / bcc
  // sw_dlgta_row_ok / sbc #30`): the wrap DECISION (cmp #30/bcc) is untouched, so it still wraps
  // at exactly the same physRowRaw values -- only the wrapped row's own computed value is now off
  // by one (physRowRaw-29 instead of physRowRaw-30). A row that never reaches the wrap (case 11's
  // own "one step before" trial, physRowRaw=29) never executes the mutated sbc at all and must
  // still show the cursor correctly; both wrapped trials must now land on the wrong cell.
  const source = readEngineSource('streamworld.asm');
  const needle = '  cmp #30\n  bcc sw_dlgta_row_ok\n  sbc #30\n  sta <sw_dlgw_ta_row\n';
  const mutant = mutateOnce(source, needle, needle.replace('  sbc #30\n', '  sbc #29\n'), 'sw_dlg_tile_addr row-wrap subtraction off-by-one (case 11 seam/wrap sabotage)');

  const project = createStreamedProject({});
  const slot = interactEntity(project, {
    x: 200, y: 112,
    commands: [{ op: 'choice', options: [{ text: 'Yes', commands: [] }, { text: 'No', commands: [] }] }],
  });
  project.code = { overrides: [{ name: 'streamworld.asm', text: mutant }], files: [] };
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll)');
  assert.notEqual(mem[CAM_X_LO] & 0xf0, 0, 'sanity: the walk must have actually moved the camera off column 0');

  const openChoiceAt = async (camYLo) => {
    mem[CAM_Y_LO] = camYLo;
    nes.buttonDown(1, B);
    nes.frame();
    nes.buttonUp(1, B);
    driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CHOICEWAIT, 60);
    assert.equal(mem[BOX_STATE], BOX_CHOICEWAIT, 'sabotage setup: both option rows must still finish listing');
    nes.frame();
    const tile = dlgCellTile(nes, mem[CAM_X_LO], mem[CAM_Y_LO], mem[CAM_NT], 1, 1);
    nes.buttonDown(1, A_BTN);
    nes.frame();
    nes.buttonUp(1, A_BTN);
    driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CLOSED && m[GAME_STATE] === ST_GAMEPLAY, 60);
    assert.equal(mem[BOX_STATE], BOX_CLOSED, 'sabotage setup: the box must close cleanly before the next trial');
    return tile;
  };

  const unwrapped = await openChoiceAt(0x20);
  assert.equal(unwrapped, charToTile('\x7f'), 'the wrap decision itself is untouched -- a row that never reaches the wrap must still show the cursor correctly, or this mutant is not selective');

  const freshlyWrapped = await openChoiceAt(0x30);
  assert.notEqual(freshlyWrapped, charToTile('\x7f'), 'the row-wrap subtraction off-by-one must land the freshly-wrapped seam trial off the mapper-computed cell -- a correct-looking test that could not tell this apart from case 11\'s own positive would be worthless');

  const stillWrapped = await openChoiceAt(0x40);
  assert.notEqual(stillWrapped, charToTile('\x7f'), 'one metatile step past the wrap must also land off the mapper-computed cell -- the mutation is a subtraction constant, not a one-shot triggered only at the seam itself');
});

// ---------------------------------------------------------------------------------------------
// Round 3, finding A7 case 11: the three trials above reach the row-wrap seam by hand-setting
// cam_y_lo directly. That is real, useful direct-mapper-edge coverage (kept above, unchanged), but
// it never shows the seam reached through the camera's own real, continuous per-pixel vertical
// advancement (sw_frame_camera_window/sw_camera_window_recompute, engine/streamworld.asm:
// camPy = clamp(worldY-112, 0, (gridH-1)*240), no deadzone) and floored to a 16px boundary only at
// the dialogue nudge itself, the way an actual walking player would reach it. Three NPCs, placed at
// y=150/165/180 (each comfortably mid-bucket -- at least 6px from every 16px floor boundary, well
// outside walkToEntity's own +-2px arrival tolerance), put the post-walk floored cam_y_lo at exactly
// the same three buckets (0x20/0x30/0x40) the hand-poked trials use, entirely through real vertical
// walking -- gridH=2 keeps y=180 inside screen row 0 (world Y 0-239), so no cross-screen transition
// is needed. Exact raw row 30 is not required (Chris's ruling): landing anywhere in the correct
// 16px-floored bucket is sufficient, since only the bucket -- not the specific pixel -- decides
// whether sw_dlg_tile_addr's own row-wrap branch fires.
// ---------------------------------------------------------------------------------------------

const CASE11_REALWALK_TRIALS = [
  { y: 150, expectedFloor: 0x20, label: 'one metatile step before the wrap (row 1 unwrapped), reached by a real walk' },
  { y: 165, expectedFloor: 0x30, label: 'exactly the step the wrap first applies to row 1 (freshly wrapped), reached by a real walk' },
  { y: 180, expectedFloor: 0x40, label: 'one metatile step past the wrap (still wrapped, not double-wrapped), reached by a real walk' },
];

function buildCase11RealWalkProject() {
  const project = createStreamedProject({});
  const slots = CASE11_REALWALK_TRIALS.map(({ y }) => interactEntity(project, {
    x: 200, y,
    commands: [{ op: 'choice', options: [{ text: 'Yes', commands: [] }, { text: 'No', commands: [] }] }],
    actorName: `NPC${y}`,
  }));
  return { project, slots };
}

test('round 3, finding A7 case 11: the choice cursor lands on the mapper-computed cell at the same three row-wrap-seam buckets, reached by real vertical walking rather than a hand-set camera', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const { project, slots } = buildCase11RealWalkProject();
  const { nes, mem } = await buildAndBoot(project);

  for (let i = 0; i < CASE11_REALWALK_TRIALS.length; i++) {
    const { expectedFloor, label } = CASE11_REALWALK_TRIALS[i];
    assert.ok(walkToEntity(nes, mem, slots[i]), `${label}: the player must actually reach this NPC by real walking`);
    assert.notEqual(mem[CAM_X_LO] & 0xf0, 0, `${label}: sanity -- the walk must have actually moved the camera off column 0`);

    nes.buttonDown(1, B);
    nes.frame();
    nes.buttonUp(1, B);
    driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CHOICEWAIT, 60);
    assert.equal(mem[BOX_STATE], BOX_CHOICEWAIT, `${label}: both option rows must finish listing`);
    nes.frame(); // the cursor's own initial write is queued the same frame CHOICEWAIT is entered

    assert.equal(mem[CAM_Y_LO], expectedFloor, `${label}: the real walk plus the dialogue's own 16px floor must land cam_y_lo at exactly this bucket`);
    const camXLo = mem[CAM_X_LO];
    const camYLo = mem[CAM_Y_LO];
    const camNt = mem[CAM_NT];
    assert.equal(
      dlgCellTile(nes, camXLo, camYLo, camNt, 1, 1),
      charToTile('\x7f'),
      `${label}: the choice cursor must land at the mapper-computed cell, not the naive unwrapped one`
    );

    nes.buttonDown(1, A_BTN);
    nes.frame();
    nes.buttonUp(1, A_BTN);
    driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CLOSED && m[GAME_STATE] === ST_GAMEPLAY, 60);
    assert.equal(mem[BOX_STATE], BOX_CLOSED, `${label}: the box must close cleanly before the next trial`);
  }
});

test('round 3, finding A7 case 11 seam/wrap sabotage: the SAME row-wrap subtraction off-by-one, run against the three real-walked buckets above instead of a hand-set camera', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('streamworld.asm');
  const needle = '  cmp #30\n  bcc sw_dlgta_row_ok\n  sbc #30\n  sta <sw_dlgw_ta_row\n';
  const mutant = mutateOnce(source, needle, needle.replace('  sbc #30\n', '  sbc #29\n'), 'sw_dlg_tile_addr row-wrap subtraction off-by-one (round 3, A7 case 11 real-walk sabotage)');

  const { project, slots } = buildCase11RealWalkProject();
  project.code = { overrides: [{ name: 'streamworld.asm', text: mutant }], files: [] };
  const { nes, mem } = await buildAndBoot(project);

  const results = [];
  for (let i = 0; i < CASE11_REALWALK_TRIALS.length; i++) {
    const { expectedFloor, label } = CASE11_REALWALK_TRIALS[i];
    assert.ok(walkToEntity(nes, mem, slots[i]), `${label}: the player must actually reach this NPC by real walking`);
    nes.buttonDown(1, B);
    nes.frame();
    nes.buttonUp(1, B);
    driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CHOICEWAIT, 60);
    assert.equal(mem[BOX_STATE], BOX_CHOICEWAIT, `${label}: both option rows must still finish listing -- only the cursor tile itself is mispositioned`);
    nes.frame();
    assert.equal(mem[CAM_Y_LO], expectedFloor, `${label}: sanity -- the real walk must still land at the same bucket under the mutant engine`);
    results.push(dlgCellTile(nes, mem[CAM_X_LO], mem[CAM_Y_LO], mem[CAM_NT], 1, 1));
    nes.buttonDown(1, A_BTN);
    nes.frame();
    nes.buttonUp(1, A_BTN);
    driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CLOSED && m[GAME_STATE] === ST_GAMEPLAY, 60);
  }

  assert.equal(results[0], charToTile('\x7f'), 'the wrap decision itself is untouched -- the real-walked unwrapped bucket must still show the cursor correctly, or this mutant is not selective');
  assert.notEqual(results[1], charToTile('\x7f'), 'the row-wrap subtraction off-by-one must land the real-walked freshly-wrapped bucket off the mapper-computed cell');
  assert.notEqual(results[2], charToTile('\x7f'), 'one metatile step past the wrap must also land off the mapper-computed cell for the real-walked bucket -- the mutation is a subtraction constant, not a one-shot triggered only at the seam itself');
});

// ---------------------------------------------------------------------------------------------
// Case 12 (plan case 12, finding 3d): the full open/scroll/close attr_shadow integration case,
// through the REAL lifecycle state machine (not slice 7a's own direct-routine harness). attr_shadow
// (engine/constants.asm) is sw_render_window/sw_nmi_stream's own byte-for-byte shadow of every
// attribute byte currently on screen -- walking the player (as every other case here does) already
// populates it with real, non-fresh terrain attributes; no separate "scroll to populate" step is
// needed beyond that walk. Contract §7 freezes the world while a box is open (case 2's own
// OAM-freeze test), so "scroll further while it is open" is not attempted -- position is held
// instead, the branch the plan itself allows.
//
// boxFootprint/attrAddrParts/overlay/readAttr are copied from test/unit/
// streamworlddialoguemapper.test.js (this codebase's own per-suite-duplication convention,
// CLAUDE.md's "In-game naming" section): a geometric oracle built from each metatile cell's own
// quadrant position, not from precompute's own row/nt-bit/mask bookkeeping (that file's own
// review-round-1 finding: an oracle built from the same steps as the routine under test proves
// nothing).
//
// camYLo is hand-set to 0x10 immediately before opening (the same hand-set-a-precondition
// discipline case 11 uses, for the same reason: cam_y_lo>>4 odd leaves the box's own band 0 only
// half-masked, so its attribute byte's OTHER tile-row half is never touched by any band at all --
// the only camera parity that produces a genuine "outside-band quadrant, never written" case to
// check; an even parity promotes bands 0+1 to a full $FF mask instead, per
// sw_dlg_attr_precompute's own shared-byte-promotion comment, leaving nothing partial to prove
// preservation of).
// ---------------------------------------------------------------------------------------------

function boxFootprint(camXLo, camYLo, camNt) {
  const masks = new Map();
  for (let b = 0; b < 3; b++) {
    for (let c = 0; c < 16; c++) {
      const worldX = camXLo / 16 + c;
      const worldY = camYLo / 16 + 12 + b;
      const physicalNt = camNt ^ (Math.floor(worldX / 16) & 1) ^ ((Math.floor(worldY / 15) & 1) << 1);
      const x = worldX % 16;
      const y = worldY % 15;
      const addr = 0x23c0 + physicalNt * 0x400 + Math.floor(y / 2) * 8 + Math.floor(x / 2);
      const bits = 3 << ((y % 2) * 4 + (x % 2) * 2);
      masks.set(addr, (masks.get(addr) ?? 0) | bits);
    }
  }
  return masks;
}

function attrAddrParts(addr) {
  return { nt: Math.floor((addr - 0x2000) / 0x400), localOffset: addr & 0x3f };
}

function overlayByte(shadowByte, mask) {
  return shadowByte & (~mask & 0xff);
}

function readAttr(nes, nt, localOffset) {
  return nes.ppu.nameTable[nes.ppu.ntable1[nt]].tile[0x3c0 + localOffset];
}

const ATTR_SHADOW = 0x0600; // engine/constants.asm

test('case 12: a full open/scroll/close cycle restores every attribute byte exactly from attr_shadow, through the real lifecycle, without attr_shadow itself ever being written', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({});
  // streamedScreen()'s own varied region uses metatile ids 1-3, but createProject's own metatiles
  // all default to palette 0 (shared/project.js's createMetatile) -- every attribute byte would
  // read 0 regardless of whether open/close ever ran correctly, and this test would discriminate
  // nothing. Distinct nonzero palettes make attr_shadow's content genuinely worth restoring.
  project.metatiles[1].palette = 1;
  project.metatiles[2].palette = 2;
  project.metatiles[3].palette = 3;
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'AB' }] });
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll -- this is what populates attr_shadow with real terrain attributes)');

  // The world is frozen before a box opens (contract §7); this is the pre-open settle case 11's
  // own comment already justifies, applied here to get a partially-masked band instead of a
  // seam-parity row. camXLo is floored to the same 16px boundary box_begin's own nudge would floor
  // it to (a real walk very rarely lands exactly metatile-aligned -- confirmed directly, camXLo
  // read 0x4e here before this floor was added, and every mapper routine's own precondition, plus
  // this file's own boxFootprint oracle, assumes an already-floored camera on both axes).
  mem[CAM_X_LO] = mem[CAM_X_LO] & 0xf0;
  mem[CAM_Y_LO] = 0x10;
  const camXLo = mem[CAM_X_LO];
  const camYLo = mem[CAM_Y_LO];
  const camNt = mem[CAM_NT];
  assert.notEqual(camXLo & 0xf0, 0, 'sanity: the walk must have actually moved the camera off column 0');

  const footprint = boxFootprint(camXLo, camYLo, camNt);
  assert.ok(footprint.size > 0, 'sanity: the box must actually touch at least one attribute byte');
  const partial = [...footprint.values()].some((mask) => mask !== 0xff);
  assert.ok(partial, 'sanity: this camera parity must leave at least one attribute byte only partially covered, or there is no outside-band quadrant to check');

  const preOpenShadow = [];
  for (let i = 0; i < 256; i++) preOpenShadow.push(mem[ATTR_SHADOW + i]);
  const shadowNow = () => [...Array(256)].map((_, i) => mem[ATTR_SHADOW + i]);

  const nonzeroCovered = [...footprint.keys()].some((addr) => {
    const { nt, localOffset } = attrAddrParts(addr);
    return preOpenShadow[nt * 64 + localOffset] !== 0;
  });
  assert.ok(nonzeroCovered, 'sanity: at least one covered attribute byte must carry real non-zero terrain data (the metatile.palette overrides above), or restoring it proves nothing');

  // Cross-check attr_shadow against the real PPU content it claims to mirror, before anything
  // opens -- proving it holds genuine terrain data, not a fresh/zeroed buffer this test would then
  // trivially "restore" without discriminating anything.
  for (const [addr] of footprint) {
    const { nt, localOffset } = attrAddrParts(addr);
    assert.equal(readAttr(nes, nt, localOffset), preOpenShadow[nt * 64 + localOffset], `attr_shadow must already mirror the real terrain attribute at $${addr.toString(16)} before any box opens`);
  }

  // review-phase2-s7b-round1-evidence/tests-audit.md, case 12: snapshot comparison alone cannot
  // see a write that restores the SAME value before the next snapshot is taken (the reviewer's own
  // scratch mutant proved this: 18 real writes to attr_shadow, yet every snapshot-based assertion
  // below still passed). A CPU-write observer -- a Proxy trap on nes.cpu.mem counting every `set`
  // in the attr_shadow range, regardless of the value stored -- catches this where a snapshot can't.
  let shadowWriteCount = 0;
  nes.cpu.mem = new Proxy(nes.cpu.mem, {
    set(target, key, value) {
      const address = Number(key);
      if (address >= ATTR_SHADOW && address < ATTR_SHADOW + 256) shadowWriteCount++;
      target[key] = value;
      return true;
    }
  });

  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the message must finish typing');
  // The masked attribute packets are queued the same frame box_begin runs; one further frame lets
  // vram_buf drain via NMI (the same one-frame lag case 4/5/6 already document).
  nes.frame();

  for (const [addr, mask] of footprint) {
    const { nt, localOffset } = attrAddrParts(addr);
    const shadowByte = preOpenShadow[nt * 64 + localOffset];
    assert.equal(readAttr(nes, nt, localOffset), overlayByte(shadowByte, mask), `while open, $${addr.toString(16)} must read shadow-masked-by-the-box's-own-footprint, not some other value`);
  }
  assert.deepEqual(shadowNow(), preOpenShadow, 'attr_shadow must be byte-identical to its pre-open snapshot while the box is open -- open reads it, never writes it');

  // Hold position (contract §7 freezes the world while a box is open -- case 2's own OAM-freeze
  // test already proves nothing could scroll here even if this held movement buttons down).
  for (let i = 0; i < 10; i++) nes.frame();
  assert.deepEqual(shadowNow(), preOpenShadow, 'attr_shadow must still be untouched after holding position with the box open');

  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CLOSED && m[GAME_STATE] === ST_GAMEPLAY, 30);
  assert.equal(mem[BOX_STATE], BOX_CLOSED, 'the box must actually close');
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'gameplay must resume');

  for (const [addr] of footprint) {
    const { nt, localOffset } = attrAddrParts(addr);
    const shadowByte = preOpenShadow[nt * 64 + localOffset];
    assert.equal(readAttr(nes, nt, localOffset), shadowByte, `after close, $${addr.toString(16)} must be restored exactly from attr_shadow -- both the box's own quadrants and (for the partially-covered byte) the quadrant the box never touched at all`);
  }
  assert.deepEqual(shadowNow(), preOpenShadow, 'attr_shadow must still be byte-identical to its pre-open snapshot after close -- the whole open/scroll/close cycle never wrote it once');
  assert.equal(shadowWriteCount, 0, 'attr_shadow must receive ZERO real CPU writes across the whole open/scroll/close cycle -- not merely end up byte-identical, which a same-value write-then-restore would also satisfy');
});

test('case 12 sabotage: a same-value write to attr_shadow inside the mapper is invisible to every snapshot assertion above, but not to the write observer', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const source = readEngineSource('streamworld.asm');
  const needle = 'sw_dlg_acb_home_loop:\n  ldy #0\n  lda [sw_dlgw_shadowlo],y\n';
  const mutant = mutateOnce(source, needle, needle + '  sta [sw_dlgw_shadowlo],y\n', 'same-value shadow store (case 12 sabotage)');
  const project = createStreamedProject({});
  project.metatiles[1].palette = 1;
  project.metatiles[2].palette = 2;
  project.metatiles[3].palette = 3;
  const slot = interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'AB' }] });
  project.code = { overrides: [{ name: 'streamworld.asm', text: mutant }], files: [] };
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToEntity(nes, mem, slot), 'the player must actually reach the NPC (real camera scroll)');

  mem[CAM_X_LO] = mem[CAM_X_LO] & 0xf0;
  mem[CAM_Y_LO] = 0x10;
  const footprint = boxFootprint(mem[CAM_X_LO], mem[CAM_Y_LO], mem[CAM_NT]);
  const preOpenShadow = [];
  for (let i = 0; i < 256; i++) preOpenShadow.push(mem[ATTR_SHADOW + i]);
  const shadowNow = () => [...Array(256)].map((_, i) => mem[ATTR_SHADOW + i]);

  let shadowWriteCount = 0;
  nes.cpu.mem = new Proxy(nes.cpu.mem, {
    set(target, key, value) {
      const address = Number(key);
      if (address >= ATTR_SHADOW && address < ATTR_SHADOW + 256) shadowWriteCount++;
      target[key] = value;
      return true;
    }
  });

  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  nes.frame();
  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CLOSED && m[GAME_STATE] === ST_GAMEPLAY, 30);

  assert.deepEqual(shadowNow(), preOpenShadow, 'sabotage sanity: the value-level snapshot comparison must still pass -- a same-value write is invisible to it, which is exactly the gap this observer closes');
  for (const [addr] of footprint) {
    const { nt, localOffset } = attrAddrParts(addr);
    assert.equal(readAttr(nes, nt, localOffset), preOpenShadow[nt * 64 + localOffset], 'sabotage sanity: the value-level restore assertion must still pass too');
  }
  assert.ok(shadowWriteCount > 0, 'the write observer must catch the mutant\'s own same-value store to attr_shadow even though every value-based assertion above stayed green -- a correct-looking test that could not tell this apart from case 12\'s own positive (shadowWriteCount === 0) would be worthless');
});

// ---------------------------------------------------------------------------------------------
// Case 13 (plan case 13, "wrong row 7b"): a negative COMPILED-PROJECT test -- unlike
// streamworld.test.js's own D.4 negative tests (a direct top-level Move on the entity's own
// page), this authors a Say event that reaches a player Move only through a nested OP_CALL chain
// (entity event -> common 0 -> common 1 -> Move), and asserts the real buildProject pipeline
// itself refuses it -- not merely that validateProject's own in-memory predicate returns true
// (streamworld.test.js's own file header: "built through the real public path... a refusal that
// only fired in validateProject but not generateAssets/buildProject would ship a broken ROM").
// eventMovesPlayer/eventHasOp (shared/project.js) already recurse into a `call` target at any
// depth with no special-casing of how many hops away the Move sits, so this is a confirmation/
// regression test of that existing walk through the real pipeline, not new production code.
// ---------------------------------------------------------------------------------------------

test('case 13 negative: a Say that reaches a player Move only through a nested OP_CALL chain is refused by the real build, not merely validateProject', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({});
  interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'Hi' }, { op: 'call', event: 0 }] });
  project.commonEvents = [
    { id: 0, name: 'Hop', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'call', event: 1 }] }] } },
    { id: 1, name: 'Walk', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'move', who: 'player', dir: 'up', dist: 16 }] }] } }
  ];
  project.commonEventSeq = 2;

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-nestedmove-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  await assert.rejects(
    buildProject({ dir, project, log: () => {} }),
    /shows text.*moves the player/,
    'a Move reached only through two levels of OP_CALL must still be refused by the real build, not merely flagged in memory'
  );
});

test('case 13 positive control: the identical common-event chain with the nested Move removed builds clean', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({});
  interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'Hi' }, { op: 'call', event: 0 }] });
  project.commonEvents = [
    { id: 0, name: 'Hop', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'call', event: 1 }] }] } },
    { id: 1, name: 'Walk', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setVar', variable: 0, value: 1 }] }] } }
  ];
  project.commonEventSeq = 2;

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-nestedmove-ctrl-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  assert.ok(fs.existsSync(built.romPath), 'the positive control (identical chain, no Move at the end) must actually produce a ROM');
});

test('case 13 validator sabotage: disabling eventMovesPlayer\'s own recursion into a call target lets the identical nested-Move chain wrongly validate clean', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  // A scratch COPY of the whole shared/ directory (never the repository file itself), so the
  // mutated project.js's own relative imports ('./chr.js', './eventrules.js', etc.) still resolve,
  // and it can be dynamically imported as an independent module instance with its own
  // eventMovesPlayer/validateProject -- side by side with, never replacing, the real
  // shared/project.js this file already imports at its own top for every other test.
  const shadowSharedDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-c13validator-'));
  t.after(() => fs.promises.rm(shadowSharedDir, { recursive: true, force: true }));
  await fs.promises.cp(path.resolve('shared'), shadowSharedDir, { recursive: true });

  const projectJsPath = path.join(shadowSharedDir, 'project.js');
  const source = await fs.promises.readFile(projectJsPath, 'utf8');
  const needle = "      if (command.op === 'move' && command.dist > 0 && (command.who === 'player' || playerLegs.has(command))) return true;\n"
    + "      if (command.op === 'call') {\n"
    + "        const target = commonById.get(commonEventId(command.event));\n"
    + "        if (target && !seen.has(target)) {\n"
    + "          seen.add(target);\n"
    + "          if (eventMovesPlayer(target, commonById, seen)) return true;\n"
    + "        }\n"
    + "      }\n";
  const mutant = mutateOnce(
    source,
    needle,
    needle.replace('          if (eventMovesPlayer(target, commonById, seen)) return true;\n', ''),
    'eventMovesPlayer call-recursion removal (case 13 validator sabotage)'
  );
  await fs.promises.writeFile(projectJsPath, mutant, 'utf8');

  const { validateProject: sabotagedValidateProject } = await import(pathToFileURL(projectJsPath).href);

  // Identical project shape to case 13's own negative test: a Say that reaches a player Move only
  // through two levels of OP_CALL (entity event -> common 0 -> common 1 -> Move).
  const project = createStreamedProject({});
  interactEntity(project, { x: 200, y: 112, commands: [{ op: 'say', text: 'Hi' }, { op: 'call', event: 0 }] });
  project.commonEvents = [
    { id: 0, name: 'Hop', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'call', event: 1 }] }] } },
    { id: 1, name: 'Walk', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'move', who: 'player', dir: 'up', dist: 16 }] }] } }
  ];
  project.commonEventSeq = 2;

  const realErrors = validateProject(project);
  assert.ok(
    realErrors.some((e) => /shows text.*moves the player/.test(e.message)),
    'sanity: the real, unmutated validateProject must still flag this exact project (case 13 negative already proves this through the real build; this re-confirms it directly against validateProject)'
  );

  const sabotagedErrors = sabotagedValidateProject(project);
  assert.ok(
    !sabotagedErrors.some((e) => /shows text.*moves the player/.test(e.message)),
    'with eventMovesPlayer\'s own recursion into a call target disabled, the identical nested-Move chain must wrongly validate clean -- a correct-looking test that could not tell this apart from the real validator\'s own refusal (above) would be worthless'
  );
});

// ---------------------------------------------------------------------------------------------
// Refusal-still-fires and byte-identity: unchanged by this commit -- restated here (not merely
// left to streamworlddialoguemapper.test.js) because this file is the one a reader chasing
// "phase2-s7b" by name will open first.
// ---------------------------------------------------------------------------------------------

// A later slice-7b commit ships the dialogue lifecycle for real and narrows item 4's own refusal
// to "shows text AND moves the player" (Say/Choice alone now builds clean -- streamworld.test.js's
// own D.4 tests cover both halves). This file's own commit never touches that arbitration.
test('refusal still fires: an event that both shows text (Say) and moves the player is still refused -- this commit adds no arbitration between the two', () => {
  const project = createStreamedProject({});
  const streamedMap = project.maps.find((m) => m.streamed === true);
  const screen = streamedMap.screens[0];
  screen.entities = screen.entities ?? [];
  screen.entities.push({
    actorId: 0,
    x: 32,
    y: 32,
    props: {
      trigger: 'interact',
      event: {
        pages: [
          {
            cond: { type: 'none', arg: 0 },
            commands: [{ op: 'say', text: 'Hello.' }, { op: 'move', who: 'player', dir: 'up', dist: 16 }]
          }
        ]
      }
    },
  });
  const errors = validateProject(project).filter((x) => x.severity === 'error');
  assert.ok(errors.some((e) => /shows text.*moves the player/.test(e.message)), `the D.4 refusal must still fire: ${JSON.stringify(errors)}`);
});

// Full-ROM byte-identity against a REAL pre-7b baseline (commit 8b4d5a9, "phase 2 slice 7a:
// dialogue mapper, split packets, masked attributes" -- the last commit before this fix round's
// own dialogue LIFECYCLE work, which is what this whole file otherwise tests, existed at all).
// streamworlddialoguemapper.test.js's own identity helper only overrides constants.asm and
// streamworld.asm from this same commit, but leaves the CURRENT (post-lifecycle) boot.asm and
// text.asm on both sides of its comparison -- so it cannot see any cost 7b's own OAM guard or its
// A4 kernel-lo -> kernel-hi dispatch relocation added to those two files. This helper instead
// overrides every engine file `git status` shows modified by this fix round's own lifecycle work
// (boot.asm, constants.asm, nameentry.asm, streamworld.asm, text.asm) with their matched 8b4d5a9
// versions together, so the comparison is against a real, self-consistent pre-lifecycle engine,
// never a mix of old and new files that could reference labels the other side doesn't define.
function fixRound1PreLifecycleBaselineOverrides() {
  return ['boot.asm', 'constants.asm', 'nameentry.asm', 'streamworld.asm', 'text.asm'].map((name) => ({
    name,
    text: execFileSync('git', ['show', `8b4d5a9:engine/${name}`], { encoding: 'utf8' })
  }));
}

test('byte-identity: a non-streamed project assembles a byte-identical ROM to a build using the pre-lifecycle (8b4d5a9) engine sources -- this fix round costs nothing when not streamed', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({ gameType: 'rpg', naming: true });
  for (const map of project.maps) map.streamed = false;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-identity-noStream-'));
  const baselineDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-identity-noStream-baseline-'));
  t.after(() => Promise.all([dir, baselineDir].map((d) => fs.promises.rm(d, { recursive: true, force: true }))));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const baselineProject = structuredClone(project);
  baselineProject.code = { overrides: fixRound1PreLifecycleBaselineOverrides(), files: [] };
  await saveProject(baselineDir, baselineProject);
  const baselineBuilt = await buildProject({ dir: baselineDir, project: baselineProject, log: () => {} });
  assert.deepEqual(
    fs.readFileSync(built.romPath),
    fs.readFileSync(baselineBuilt.romPath),
    'the full ROM must be byte-identical to a build using the pre-lifecycle (8b4d5a9) engine sources -- a non-streamed project must never pay for this fix round\'s own dialogue lifecycle work'
  );
});

test('byte-identity: a streamed project with no text assembles a byte-identical ROM to a build using the pre-lifecycle (8b4d5a9) engine sources -- this fix round costs nothing when streamed but unused', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = null; // the default project's own title screen is itself a text source
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-identity-noText-'));
  const baselineDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlg-identity-noText-baseline-'));
  t.after(() => Promise.all([dir, baselineDir].map((d) => fs.promises.rm(d, { recursive: true, force: true }))));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const baselineProject = structuredClone(project);
  baselineProject.code = { overrides: fixRound1PreLifecycleBaselineOverrides(), files: [] };
  await saveProject(baselineDir, baselineProject);
  const baselineBuilt = await buildProject({ dir: baselineDir, project: baselineProject, log: () => {} });
  assert.deepEqual(
    fs.readFileSync(built.romPath),
    fs.readFileSync(baselineBuilt.romPath),
    'the full ROM must be byte-identical to a build using the pre-lifecycle (8b4d5a9) engine sources -- a streamed project that never actually opens a box must never pay for this fix round\'s own dialogue lifecycle work'
  );
});
