#!/usr/bin/env node
// Phase 2 slice 2b, Part I -- real window-render parity. sw_quadrant_check.lua.template (Part G)
// is boot-sanity only: it proves the resident set doesn't corrupt the CPU vectors, never that
// sw_render_window drew the right art.
//
// Phase 2 slice "landing" note: this file used to build a landing at (col=1,row=1) and assert the
// window is pinned to that entered screen's own top-left corner (win_col/row_local always 0,
// win_col/row_screen always the entered screen) -- the OLD landing behaviour the "landing" slice's
// own defect fix (engine/streamworld.asm's sw_resolve_divdone/sw_camera_window_install) removed: a
// landing now installs the SAME clamped, player-centred window sw_camera_window_recompute's
// per-frame tracking would otherwise only reach a few frames later, which in general is NOT the
// entered screen's own top-left corner.
//
// Fix round 1, finding 3: repurposed a second time. The grid is now 3x3 (not 3x2) and the fixed
// landing (owner screen (1,1), local (128,128)) is chosen so the real window lands on a GENUINELY
// nonzero local offset on BOTH axes (win_col_local=8, win_row_local=9) and an ODD screen row
// (win_row_screen's own parity feeds cam_nt's bit1, the "vertical nametable bit" round-1 review
// found no landing case ever exercised) -- test/unit/streamworldmove.test.js's own new "interior
// odd row" LANDING_CASES entry uses the identical owner/local pair, independently.
//
// A nonzero local offset means a single physical nametable no longer maps onto exactly one whole
// authored screen -- up to two authored screens per axis can appear in one nametable's own 16x15
// block grid (four, at a corner). The oracle below (resolveBlock) is a full, independent
// transcription of sw_render_window's own per-BLOCK mapping (wbase_col/row, sw_rw_col_delta/
// sw_rw_row_delta, sw_col_at_offset/sw_row_at_offset -- engine/streamworld.asm), not merely the
// old per-NAMETABLE "which whole screen" shortcut (resolveNtScreen) the aligned-only landing above
// got away with. Content authoring is correspondingly simplified to compensate: every one of the
// grid's 9 screens is filled with ONE uniform, screen-unique metatile (not just a single corner
// marker), so resolveBlock's own per-block screen assignment is independently checkable against a
// trivial, unambiguous expected value at every position, rather than requiring hand-placed markers
// to land inside whatever sub-region of each screen this landing's own local offsets expose.
// (Verified by hand -- and by a scratch Node repro during review -- that with this landing every
// one of the 9 screens is genuinely visible somewhere in the 4-nametable window, and nt 3 alone is
// an exact, unshifted identity view of the landing screen itself: win_col_screen/win_row_screen are
// both odd, so nt 3's own (ntx=16,nty=15) physical base lands exactly on this window's own
// (wbase_col,wbase_row), the one nt of the four with no wraparound split on either axis.)
//
//   - --break=old-top-left-landing (fix round 1, finding 2) no longer changes the ORACLE at all --
//     doing that proved only that two expected images differ, never that the old landing
//     implementation was actually exercised. It now reverts the ENGINE instead, through
//     project.code.overrides restoring the exact pre-"landing"-slice sw_resolve_divdone tail (the
//     window pinned to the entered screen's own top-left corner, local always 0,0), while the
//     oracle keeps using the real, current, correct window (desCol=0,desColLocal=8,desRow=0,
//     desRowLocal=9) throughout. The reverted engine's own window (screenCol=1,local=0;
//     screenRow=1,local=0) maps every physical block to a completely different wbase than the
//     oracle expects, so the two disagree -- a real failure against the genuinely-reverted
//     implementation, not the oracle's own self-inconsistency. In practice the reverted engine's
//     wrong cam_x_lo/cam_y_lo/cam_nt is caught first (EXIT_WRONG_STREAMED, real run: exit 4),
//     before the check ever reaches nametable content -- the scroll check is real evidence too
//     (fix round 1, finding 1's own "physical scroll" requirement).
//   - --break=blank-landing-tile is unchanged in spirit: it never authors the distinct per-screen
//     metatiles at all, independent of which window formula is in play, so a correct check must
//     still fail against it too.
//
// Coverage still spans EVERY metatile block (16x15) and EVERY attribute byte (8x8) of all four
// nametables, and reproduces the one genuine "attribute boundary" limitation of this design: an
// attribute row's bottom-half quadrants (BL/BR) are unconditionally zero for the last attribute row
// of every nametable (engine/streamworld.asm's sw_rw_attr_bl/br, `cmp #7 / beq sw_rw_attr_zero`),
// since a nametable's own 15 metatile-block rows don't pair evenly into 2-row attribute groups (7
// full pairs + 1 leftover row), and attribute bytes never span nametables.
//
//   node test/lua/build_sw_render_roms.mjs [outDir] [--break=blank-landing-tile|old-top-left-landing]
//   Mesen --testRunner <outDir>/sw_render_check.lua <outDir>/sw_render.nes
//
// (test/lua/run_sw_render_check.sh does both steps and every --break mode.)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createProject, createMap, createScreen } from '../../shared/project.js';
import { scanEquates, resolveEquates } from '../lib/equates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE_PATH = path.join(ROOT, 'test/lua/sw_render_check.lua.template');

const args = process.argv.slice(2);
const breakArg = args.find((a) => a.startsWith('--break='));
const breakMode = breakArg ? breakArg.slice('--break='.length) : null;
const outDir = args.find((a) => !a.startsWith('--')) ?? '/tmp/nesforge-sw-render';

const KNOWN_BREAKS = ['blank-landing-tile', 'old-top-left-landing'];
if (breakMode && !KNOWN_BREAKS.includes(breakMode)) {
  throw new Error(`unknown --break mode: ${breakMode}`);
}
const blankCorners = breakMode === 'blank-landing-tile';
const oldTopLeftEngine = breakMode === 'old-top-left-landing';

const GRID_W = 3;
const GRID_H = 3;
// Owner (1,1), local (128,128) -- test/unit/streamworldmove.test.js's own new "interior odd row"
// LANDING_CASES entry uses the identical pair, independently. worldX=1*256+128=384, worldY=
// 1*240+128=368; camPx=clamp(384-120,0,512)=264, camPy=clamp(368-112,0,480)=256 -- real window
// desCol=0,desColLocal=8 (nonzero), desRow=0,desRowLocal=9 (nonzero), cam_nt=3 (both bits set: an
// ODD screen row on the Y axis, the "vertical nametable bit" finding 3 found no case exercised).
const LANDING_SW_COL = 1;
const LANDING_SW_ROW = 1;
const LANDING_PLAYER_X = 128;
const LANDING_PLAYER_Y = 128;
const LANDING_SCREEN_INDEX = LANDING_SW_ROW * GRID_W + LANDING_SW_COL;

// clamp/centre/window formula -- re-derived independently here from engine/streamworld.asm's own
// sw_camera_window_recompute (worldX=swCol*256+playerX, worldY=swRow*240+playerY; camPx=clamp(
// worldX-120,0,(gridW-1)*256), camPy=clamp(worldY-112,0,(gridH-1)*240); desired window col/row by
// divmod 16/15 of (camBlock-8)/(camBlock-7), each clamped by sw_clamp_col/row's own "max legal
// screen is gridSize-2" rule) -- the identical formula test/unit/streamworldmove.test.js's own
// predictDesiredWindow uses, kept as a second, independent transcription rather than imported.
function clampWindowAxis(desiredScreen, desiredLocal, gridSize) {
  const maxScreen = gridSize - 2;
  if (desiredScreen > maxScreen || (desiredScreen === maxScreen && desiredLocal !== 0)) {
    return { screen: maxScreen, local: 0 };
  }
  return { screen: desiredScreen, local: desiredLocal };
}
function computeWindow({ swCol, swRow, playerX, playerY, gridW, gridH }) {
  const worldX = swCol * 256 + playerX;
  const worldY = swRow * 240 + playerY;
  const camPx = Math.min(Math.max(worldX - 120, 0), (gridW - 1) * 256);
  const camPy = Math.min(Math.max(worldY - 112, 0), (gridH - 1) * 240);
  const camScreenRow = Math.floor(camPy / 240);
  const camLocalPxY = camPy % 240;
  const desiredBlockX = Math.max(Math.floor(camPx / 16) - 8, 0);
  const col = clampWindowAxis(Math.floor(desiredBlockX / 16), desiredBlockX % 16, gridW);
  const camBlockY = camScreenRow * 15 + Math.floor(camLocalPxY / 16);
  const desiredBlockY = Math.max(camBlockY - 7, 0);
  const row = clampWindowAxis(Math.floor(desiredBlockY / 15), desiredBlockY % 15, gridH);
  const camNt = (Math.floor(camPx / 256) & 1) | ((camScreenRow & 1) << 1);
  return { camPx, camPy, col, row, camNt };
}

const real = computeWindow({ swCol: LANDING_SW_COL, swRow: LANDING_SW_ROW, playerX: LANDING_PLAYER_X, playerY: LANDING_PLAYER_Y, gridW: GRID_W, gridH: GRID_H });
const win = { colScreen: real.col.screen, colLocal: real.col.local, rowScreen: real.row.screen, rowLocal: real.row.local };

// resolveBlock -- the real per-BLOCK mapping sw_render_window itself uses, independently
// transcribed from engine/streamworld.asm (see this file's own header): wbase_col/row is the
// window's own physical ring origin; sw_rw_col_delta/sw_rw_row_delta convert a physical (nt-
// relative) position into a wbase-relative delta; sw_col_at_offset/sw_row_at_offset convert that
// delta back into a world (screen,local) position. Generalizes resolveNtScreen (the old per-
// nametable "which whole screen" shortcut, valid only when win_col/row_local are both 0) to a
// nonzero local offset on either or both axes.
const NT_PHYS_COL = [0, 16, 0, 16]; // sw_rw_ntx
const NT_PHYS_ROW = [0, 0, 15, 15]; // sw_rw_nty
function wbaseAxis(screen, local, screenSize) {
  return (screen & 1) * screenSize + local;
}
function colAtOffset(delta, winColScreen, winColLocal) {
  const t = delta + winColLocal;
  return { screen: winColScreen + (t >> 4), local: t & 15 };
}
function rowAtOffset(delta, winRowScreen, winRowLocal) {
  let t = delta + winRowLocal;
  let count = 0;
  while (t >= 15) {
    t -= 15;
    count += 1;
  }
  return { screen: winRowScreen + count, local: t };
}
function resolveBlock(nt, bc, br, window) {
  const wbaseCol = wbaseAxis(window.colScreen, window.colLocal, 16);
  const wbaseRow = wbaseAxis(window.rowScreen, window.rowLocal, 15);
  const physCol = NT_PHYS_COL[nt] + bc;
  const physRow = NT_PHYS_ROW[nt] + br;
  const colDelta = ((physCol - wbaseCol) % 32 + 32) % 32;
  const rowDelta = ((physRow - wbaseRow) % 30 + 30) % 30;
  const colAt = colAtOffset(colDelta, window.colScreen, window.colLocal);
  const rowAt = rowAtOffset(rowDelta, window.rowScreen, window.rowLocal);
  const inBounds = colAt.screen >= 0 && colAt.screen < GRID_W && rowAt.screen >= 0 && rowAt.screen < GRID_H;
  return { screenCol: colAt.screen, screenRow: rowAt.screen, inBounds };
}

// Every one of the grid's 9 screens is filled with ONE uniform, screen-unique metatile -- see this
// file's own header for why a single-corner marker (the aligned-only landing's old scheme) can't
// be relied on to land inside whatever sub-region of a screen this landing's own nonzero local
// offsets expose.
const SCREEN_METATILE_BASE = 1; // ids 1..9, one per screen index 0..8
const FILL_METATILE_ID = 0;
const FILL_TILES = [50, 60, 70, 80];
const FILL_PALETTE = 0;
function screenMetatileId(screenIndex) {
  return SCREEN_METATILE_BASE + screenIndex;
}
function screenTiles(screenIndex) {
  const t = screenMetatileId(screenIndex) * 4;
  return [t, t + 1, t + 2, t + 3];
}
function screenPalette(screenIndex) {
  return 1 + (screenIndex % 3); // never 0 (FILL_PALETTE), spread across the 3 non-background slots
}

function buildStreamedMap(id, name) {
  const map = createMap(id, name);
  map.gridW = GRID_W;
  map.gridH = GRID_H;
  map.streamed = true;
  map.fillMetatileId = blankCorners ? 0 : FILL_METATILE_ID;
  map.tilesetId = 0;
  map.screens = Array.from({ length: GRID_W * GRID_H }, () => createScreen());
  return map;
}

const project = createProject('Streamed Render Check', 'action');
project.cartridge.mapper = 30; // UNROM 512 -- streamCapableFourScreen, the only streamed-capable board
project.cartridge.mirroring = 'fourscreen';
project.cartridge.camera = true;

const map = buildStreamedMap(0, 'Streamed');
if (!blankCorners) {
  for (let i = 0; i < GRID_W * GRID_H; i++) {
    map.screens[i].metatiles.fill(screenMetatileId(i));
  }
}
project.maps = [map];
project.project.startMap = 0;
project.project.startScreen = LANDING_SCREEN_INDEX;
project.project.startX = LANDING_PLAYER_X;
project.project.startY = LANDING_PLAYER_Y;

if (!blankCorners) {
  project.metatiles[FILL_METATILE_ID] = { id: FILL_METATILE_ID, name: 'RenderCheckFill', tiles: FILL_TILES, palette: FILL_PALETTE, collision: 'open' };
  for (let i = 0; i < GRID_W * GRID_H; i++) {
    const id = screenMetatileId(i);
    project.metatiles[id] = { id, name: `RenderCheckScreen${i}`, tiles: screenTiles(i), palette: screenPalette(i), collision: 'open' };
  }
}

// Fix round 1, finding 2: revert the ENGINE for --break=old-top-left-landing, never the oracle
// (below, `metatileAt`/`resolveBlock` always use the real, current, correct `win`). Ported from
// the round-1 reviewer's own independent scratch mutation (handoff-next/review-landing-round1-
// evidence/old-tail.txt) -- the exact pre-"landing"-slice sw_resolve_divdone tail, restoring the
// window pinned to the entered screen's own top-left corner (local always 0,0).
const OLD_SW_RESOLVE_DIVDONE_TAIL = `sw_resolve_divdone:
  ; sw_tmp5 = screenCol, sw_tmp3 = screenRow
  lda sw_tmp5
  sta win_col_screen
  lda #0
  sta win_col_local
  lda sw_tmp3
  sta win_row_screen
  lda #0
  sta win_row_local
  ; Landing scroll: the window is aligned to the entered screen's own
  ; top-left corner (no local offset), so the physical origin
  ; sw_render_window computes always lands on a whole nametable multiple --
  ; cam_x_lo/cam_y_lo are always 0, only the nametable-select bits vary,
  ; one per axis, matching sw_rw_nt_hi's own bit0=horizontal/bit1=vertical
  ; convention.
  lda sw_tmp5
  and #1
  sta sw_tmp6
  lda sw_tmp3
  and #1
  asl a
  ora sw_tmp6
  sta <cam_nt
  lda #0
  sta <cam_x_lo
  sta <cam_y_lo
  ; Streamed camera world-space origin (ruling 1, phase 2 slice 4a): the
  ; still-fixed entry-screen origin sw_project_axis's real callers (oam.asm,
  ; entities.asm) project sprite positions against. world_x = screenCol*256
  ; + localX, and 256 divides a byte exactly, so the origin's own low byte
  ; is always 0 and its high byte is the screen column itself -- no
  ; arithmetic. world_y = screenRow*240 + localY needs a real multiply (240
  ; is not a power of two): screenRow*240 = screenRow*256 - screenRow*16, a
  ; shift-and-subtract, cold path only (this runs once per landing, never
  ; per frame -- slice 4b's movement driver is this value's CONTINUOUS
  ; writer, plan line 842's own obligation).
  lda #0
  sta sw_cam_origin_x_lo
  lda sw_tmp5
  sta sw_cam_origin_x_hi
  lda sw_tmp3
  sta sw_tmp                   ; row*16 lo, pre-shift
  lda #0
  sta sw_tmp2                  ; row*16 hi, pre-shift
  ldx #4
sw_resolve_originy_shift:
  asl sw_tmp
  rol sw_tmp2
  dex
  bne sw_resolve_originy_shift
  lda #0
  sec
  sbc sw_tmp
  sta sw_cam_origin_y_lo
  lda sw_tmp3
  sbc sw_tmp2
  sta sw_cam_origin_y_hi
  lda sw_tmp5                    ; A = screenCol
  ldx sw_tmp3                    ; X = screenRow
  jmp sw_enter_screen             ; tail call -- its own rts answers for ours
`;
if (oldTopLeftEngine) {
  const engineText = await fs.promises.readFile(path.join(ROOT, 'engine/streamworld.asm'), 'utf8');
  const start = engineText.indexOf('sw_resolve_divdone:');
  const end = engineText.indexOf('; ==========================================================================', start);
  if (start === -1 || end === -1) {
    throw new Error('sw_resolve_divdone: block not found in engine/streamworld.asm -- has it moved/been renamed?');
  }
  const reverted = engineText.slice(0, start) + OLD_SW_RESOLVE_DIVDONE_TAIL + engineText.slice(end);
  project.code = { overrides: [{ name: 'streamworld.asm', text: reverted }], files: [] };
}

// The oracle's own expected content is ALWAYS the real, current, correct window (`win`) -- a
// negative control means "run the real check against a deliberately wrong ENGINE (or a
// deliberately blank build), and it must fail," never "loosen the check to match a wrong
// assumption."
function metatileAt(screenIndex) {
  return { tiles: screenTiles(screenIndex), palette: screenPalette(screenIndex) };
}
function contentAt(nt, bc, br) {
  const { screenCol, screenRow, inBounds } = resolveBlock(nt, bc, br, win);
  if (!inBounds) return { tiles: FILL_TILES, palette: FILL_PALETTE };
  return metatileAt(screenRow * GRID_W + screenCol);
}

const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nesforge-sw-render-build-'));
try {
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const romOut = new Uint8Array(await fs.promises.readFile(built.romPath));

  const constantsText = await fs.promises.readFile(path.join(dir, 'build', 'constants.asm'), 'utf8');
  const configText = await fs.promises.readFile(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8');
  const pending = new Map();
  scanEquates(constantsText, pending);
  scanEquates(configText, pending);
  const symbols = new Map();
  resolveEquates(pending, symbols);
  for (const name of ['frame_cnt', 'game_state', 'ST_GAMEPLAY', 'map_is_streamed', 'cam_nt', 'cam_x_lo', 'cam_y_lo']) {
    if (!symbols.has(name)) throw new Error(`${name} did not resolve out of this build's own constants.asm/config.inc`);
  }

  await fs.promises.mkdir(outDir, { recursive: true });
  const romPath = path.join(outDir, 'sw_render.nes');
  await fs.promises.writeFile(romPath, romOut);
  if (built.symbolPath) {
    await fs.promises.copyFile(built.symbolPath, path.join(outDir, 'sw_render.fns'));
  }

  const blockChecks = [];
  const attrChecks = [];
  for (const nt of [0, 1, 2, 3]) {
    const ntBase = 0x2000 + nt * 0x400;
    const label = `nt ${nt}`;

    for (let br = 0; br < 15; br++) {
      for (let bc = 0; bc < 16; bc++) {
        const { tiles } = contentAt(nt, bc, br);
        const tlAddr = ntBase + 64 * br + 2 * bc;
        blockChecks.push({
          tlAddr,
          trAddr: tlAddr + 1,
          blAddr: tlAddr + 32,
          brAddr: tlAddr + 33,
          tl: tiles[0],
          tr: tiles[1],
          bl: tiles[2],
          br: tiles[3],
          label: `${label} block(${bc},${br})`
        });
      }
    }

    for (let arow = 0; arow < 8; arow++) {
      for (let acol = 0; acol < 8; acol++) {
        const tlPal = contentAt(nt, 2 * acol, 2 * arow).palette;
        const trPal = contentAt(nt, 2 * acol + 1, 2 * arow).palette;
        const blPal = arow === 7 ? 0 : contentAt(nt, 2 * acol, 2 * arow + 1).palette;
        const brPal = arow === 7 ? 0 : contentAt(nt, 2 * acol + 1, 2 * arow + 1).palette;
        const attrAddr = ntBase + 0x3c0 + arow * 8 + acol;
        const expected = (tlPal & 3) | ((trPal & 3) << 2) | ((blPal & 3) << 4) | ((brPal & 3) << 6);
        attrChecks.push({ addr: attrAddr, expected, label: `${label} attr(${acol},${arow})` });
      }
    }
  }

  const blockChecksLua =
    '{\n' +
    blockChecks
      .map(
        (c) =>
          `    { tlAddr = 0x${c.tlAddr.toString(16)}, trAddr = 0x${c.trAddr.toString(16)}, blAddr = 0x${c.blAddr.toString(16)}, brAddr = 0x${c.brAddr.toString(16)}, tl = ${c.tl}, tr = ${c.tr}, bl = ${c.bl}, br = ${c.br}, label = "${c.label}" }`
      )
      .join(',\n') +
    '\n  }';
  const attrChecksLua =
    '{\n' +
    attrChecks.map((c) => `    { addr = 0x${c.addr.toString(16)}, expected = ${c.expected}, label = "${c.label}" }`).join(',\n') +
    '\n  }';

  const template = await fs.promises.readFile(TEMPLATE_PATH, 'utf8');
  const substitutions = {
    __FRAME_CNT__: `0x${symbols.get('frame_cnt').toString(16)}`,
    __GAME_STATE__: `0x${symbols.get('game_state').toString(16)}`,
    __ST_GAMEPLAY__: `${symbols.get('ST_GAMEPLAY')}`,
    __MAP_IS_STREAMED__: `0x${symbols.get('map_is_streamed').toString(16)}`,
    __CAM_NT__: `0x${symbols.get('cam_nt').toString(16)}`,
    __CAM_X_LO__: `0x${symbols.get('cam_x_lo').toString(16)}`,
    __CAM_Y_LO__: `0x${symbols.get('cam_y_lo').toString(16)}`,
    __EXPECTED_CAM_NT__: `${real.camNt}`,
    __EXPECTED_CAM_X_LO__: `${real.camPx & 0xff}`,
    __EXPECTED_CAM_Y_LO__: `${real.camPy % 240}`,
    __BLOCK_CHECKS__: blockChecksLua,
    __ATTR_CHECKS__: attrChecksLua
  };
  let generated = template;
  for (const [token, value] of Object.entries(substitutions)) {
    const occurrences = generated.split(token).length - 1;
    if (occurrences !== 1) {
      throw new Error(`expected exactly one occurrence of ${token} in the template, found ${occurrences}`);
    }
    generated = generated.split(token).join(value);
  }
  const luaPath = path.join(outDir, 'sw_render_check.lua');
  await fs.promises.writeFile(luaPath, generated, 'utf8');

  console.log(`built -> ${romPath} (${romOut.length} bytes)${breakMode ? ` BROKEN(${breakMode})` : ''}, lua -> ${luaPath}`);
  console.log(`landing: player at screen(${LANDING_SW_COL},${LANDING_SW_ROW}) index ${LANDING_SCREEN_INDEX}, real window (col ${win.colScreen}/${win.colLocal}, row ${win.rowScreen}/${win.rowLocal}), cam_nt=${real.camNt}, cam_x_lo=${real.camPx & 0xff}, cam_y_lo=${real.camPy % 240}`);
  console.log(`block checks: ${blockChecks.length}, attr checks: ${attrChecks.length}`);
} finally {
  await fs.promises.rm(dir, { recursive: true, force: true });
}
