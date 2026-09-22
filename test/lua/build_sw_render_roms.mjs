#!/usr/bin/env node
// Phase 2 slice 2b, Part I -- real window-render parity. sw_quadrant_check.lua.template (Part G)
// is boot-sanity only: it proves the resident set doesn't corrupt the CPU vectors, never that
// sw_render_window drew the right art. This script builds ONE streamed project through the real
// public path (buildProject, no bypass -- see build_sw_roms.mjs's own header for why that bypass
// is gone), with its own `startMap`/`startScreen` set directly to a NON-TRIVIAL-parity streamed
// screen (col=1, row=1 of the default 3x2 grid -- both odd, so screenCol&1/screenRow&1 are both
// live, unlike (0,0) where every parity bit is trivially 0) so Mesen boots straight onto a real
// landing with no scripted warp needed.
//
// Fix round 2, R4: the oracle no longer reproduces sw_rw_col_delta/sw_rw_row_delta/
// sw_col_at_offset/sw_row_at_offset's own instruction-level arithmetic. Instead it uses the
// design invariant this file's own engine-side comment states directly (engine/streamworld.asm's
// own header, lines 12-20): a landing always sets win_col_local/win_row_local to 0, so each of the
// four physical nametables maps onto exactly ONE authored screen (or fill) for its ENTIRE 16x15
// metatile-block grid -- never a mix of several screens' content within one nametable. This was
// verified independently (not assumed): for every nametable, the raw per-nametable block index
// (0-15 col, 0-14 row) equals that screen's own LOCAL metatile position with no permutation, since
// adding a multiple of the wrap period (16 for columns, 15 for rows) never changes the position
// modulo that same period. resolveNtScreen below is kept (it already reasons from parity/wrap,
// not from copying engine opcodes) purely to answer WHICH single screen (or fill, if off the
// authored grid) each nametable holds; once that answer is known, generating this screen's own
// full 240-metatile content and 64 attribute bytes needs no further wrap arithmetic at all.
//
// Coverage now spans EVERY metatile block (not only block(0,0)) and EVERY attribute byte
// (not only cell(0,0)) of all four nametables, including the one non-corner block (MID, placed at
// an interior position of the landing screen) that lets the second --break mode corrupt a single
// non-corner attribute quadrant without touching engine or renderer code. It also reproduces the
// one genuine "attribute boundary" limitation of this design: an attribute row's bottom-half
// quadrants (BL/BR) are unconditionally zero for the last attribute row of every nametable
// (engine/streamworld.asm's sw_rw_attr_bl/br, `cmp #7 / beq sw_rw_attr_zero`), because a
// nametable's own 15 metatile-block rows don't pair evenly into 2-row attribute groups (7 full
// pairs + 1 leftover row with no partner) -- there is no adjoining nametable's own row to borrow
// from, since attribute bytes never span nametables.
//
//   node test/lua/build_sw_render_roms.mjs [outDir] [--break=blank-landing-tile|mid-block-attr]
//   Mesen --testRunner <outDir>/sw_render_check.lua <outDir>/sw_render.nes
//
// --break=blank-landing-tile is a reproducible, project-level (not ROM-binary-patch, not
// engine-source) negative control: it simply never authors the distinct landing/other/fill/mid
// metatiles below, leaving every screen at createMetatile's own default (tiles [0,0,0,0], palette
// 0) -- the exact same content the check's own oracle would otherwise wrongly agree with by
// coincidence if the check itself were vacuous. A correct check must fail loudly against this ROM.
//
// --break=mid-block-attr leaves the corner (landing/other/fill) art intact but omits ONLY the
// interior MID placement, so the real ROM's own MID block reverts to the default metatile (id 0)
// while the oracle -- unconditionally, regardless of breakMode -- still expects MID's own distinct
// tiles and palette there. This isolates a single non-corner attribute quadrant (MID sits at an
// odd column/row, i.e. the BR quadrant, bits 6-7, of a non-corner, non-last-row attribute byte)
// as the one thing that must trip, without touching any corner check blank-landing-tile already
// exercises.
//
// (test/lua/run_sw_render_check.sh does both steps and both --break modes.)
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

const KNOWN_BREAKS = ['blank-landing-tile', 'mid-block-attr'];
if (breakMode && !KNOWN_BREAKS.includes(breakMode)) {
  throw new Error(`unknown --break mode: ${breakMode}`);
}
const blankCorners = breakMode === 'blank-landing-tile';
const omitMid = breakMode === 'blank-landing-tile' || breakMode === 'mid-block-attr';

const GRID_W = 3;
const GRID_H = 2;
const LANDING_COL = 1;
const LANDING_ROW = 1;
const LANDING_SCREEN_INDEX = LANDING_ROW * GRID_W + LANDING_COL; // 4
const OTHER_COL = 2;
const OTHER_ROW = 1;
const OTHER_SCREEN_INDEX = OTHER_ROW * GRID_W + OTHER_COL; // 5

const LANDING_METATILE_ID = 7;
const LANDING_TILES = [10, 20, 30, 40]; // [tl, tr, bl, br] -- mt_tl/tr/bl/br, main/build/generate.js
const LANDING_PALETTE = 2;
const OTHER_METATILE_ID = 8;
const OTHER_TILES = [11, 21, 31, 41];
const OTHER_PALETTE = 1;
const FILL_METATILE_ID = 9;
const FILL_TILES = [50, 60, 70, 80];
const FILL_PALETTE = 3;
// MID -- an interior, NON-corner block of the landing screen (block col=9,row=9 of 0-15/0-14):
// both odd, so it sits at the BR quadrant (bits 6-7) of its own attribute byte (arow=4,acol=4),
// nowhere near a corner or the last attribute row's forced-zero edge case -- exactly what the
// second --break mode needs to corrupt in isolation.
const MID_BLOCK_COL = 9;
const MID_BLOCK_ROW = 9;
const MID_RASTER_INDEX = MID_BLOCK_ROW * 16 + MID_BLOCK_COL; // 153
const MID_METATILE_ID = 12;
const MID_TILES = [12, 22, 32, 42];
const MID_PALETTE = 1;
const DEFAULT_TILES = [0, 0, 0, 0];
const DEFAULT_PALETTE = 0;

// sw_rw_ntx/sw_rw_nty (engine/streamworld.asm) -- the fixed per-physical-nametable probe base
// sw_render_window uses; sw_rw_nt_hi is that same 0/1/2/3 index's own $2006 high byte, i.e. this
// nt's own PPU address is 0x2000 + nt*0x400.
const SW_RW_NTX = [0, 16, 0, 16];
const SW_RW_NTY = [0, 0, 15, 15];

// resolveNtScreen -- WHICH single screen (or off-grid) physical nametable `nt` holds, in its
// entirety, at this fixed-aligned landing (winCol,winRow, always local(0,0) per
// sw_resolve_divdone). Reasons from the wrap/parity relationship the design's own header comment
// states (engine/streamworld.asm:12-20), not from copying sw_rw_col_delta/sw_col_at_offset's own
// instructions. Verified independently (see this file's own header) that the per-nametable block
// index maps 1:1 onto that screen's own local metatile position, so once this single
// (screenCol,screenRow) answer is known, no further wrap arithmetic is needed for content.
function resolveNtScreen(nt, winCol, winRow, gridW, gridH) {
  const wbaseCol = (winCol & 1) * 16;
  const wbaseRow = (winRow & 1) * 15;
  const deltaCol = (((SW_RW_NTX[nt] - wbaseCol) % 32) + 32) % 32;
  const screenCol = (deltaCol >> 4) + winCol;
  let deltaRow = SW_RW_NTY[nt] + 30 - wbaseRow;
  if (deltaRow >= 30) deltaRow -= 30;
  let rowOffset = 0;
  let remaining = deltaRow;
  while (remaining >= 15) {
    remaining -= 15;
    rowOffset += 1;
  }
  const screenRow = rowOffset + winRow;
  const inBounds = screenCol >= 0 && screenCol < gridW && screenRow >= 0 && screenRow < gridH;
  return { screenCol, screenRow, inBounds };
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
  map.screens[LANDING_SCREEN_INDEX].metatiles[0] = LANDING_METATILE_ID; // local(0,0) -- see header
  map.screens[OTHER_SCREEN_INDEX].metatiles[0] = OTHER_METATILE_ID;
  if (!omitMid) {
    map.screens[LANDING_SCREEN_INDEX].metatiles[MID_RASTER_INDEX] = MID_METATILE_ID;
  }
}
project.maps = [map];
project.project.startMap = 0;
project.project.startScreen = LANDING_SCREEN_INDEX;

if (!blankCorners) {
  // Distinct, deliberately non-default art per screen so the check cannot pass by reading the
  // same [0,0,0,0]/palette-0 default every other metatile (including id 0, the fill) also
  // carries, and cannot pass by confusing one nametable's own expected content for another's.
  project.metatiles[LANDING_METATILE_ID] = { id: LANDING_METATILE_ID, name: 'RenderCheckLanding', tiles: LANDING_TILES, palette: LANDING_PALETTE, collision: 'open' };
  project.metatiles[OTHER_METATILE_ID] = { id: OTHER_METATILE_ID, name: 'RenderCheckOther', tiles: OTHER_TILES, palette: OTHER_PALETTE, collision: 'open' };
  project.metatiles[FILL_METATILE_ID] = { id: FILL_METATILE_ID, name: 'RenderCheckFill', tiles: FILL_TILES, palette: FILL_PALETTE, collision: 'open' };
  project.metatiles[MID_METATILE_ID] = { id: MID_METATILE_ID, name: 'RenderCheckMid', tiles: MID_TILES, palette: MID_PALETTE, collision: 'open' };
}

const CAM_NT = (LANDING_COL & 1) | ((LANDING_ROW & 1) << 1); // sw_resolve_divdone's own formula, computed independently

// The oracle's own expected content is ALWAYS the real, fully-authored shape (LANDING/OTHER/MID
// placed, regardless of breakMode) -- a negative control means "run the real check against a
// deliberately broken build, and it must fail," not "loosen the check to match the broken build."
function metatileAt(screenIndex, raster) {
  if (screenIndex === LANDING_SCREEN_INDEX && raster === 0) return { tiles: LANDING_TILES, palette: LANDING_PALETTE };
  if (screenIndex === OTHER_SCREEN_INDEX && raster === 0) return { tiles: OTHER_TILES, palette: OTHER_PALETTE };
  if (screenIndex === LANDING_SCREEN_INDEX && raster === MID_RASTER_INDEX) return { tiles: MID_TILES, palette: MID_PALETTE };
  return { tiles: DEFAULT_TILES, palette: DEFAULT_PALETTE };
}

const blockChecks = [];
const attrChecks = [];
for (const nt of [0, 1, 2, 3]) {
  const { screenCol, screenRow, inBounds } = resolveNtScreen(nt, LANDING_COL, LANDING_ROW, GRID_W, GRID_H);
  const screenIndex = screenRow * GRID_W + screenCol;
  const ntBase = 0x2000 + nt * 0x400;
  const label = inBounds
    ? screenCol === LANDING_COL && screenRow === LANDING_ROW
      ? `nt ${nt} (the landing screen itself)`
      : screenCol === OTHER_COL && screenRow === OTHER_ROW
        ? `nt ${nt} (a different real screen (${OTHER_COL},${OTHER_ROW}))`
        : `nt ${nt} (real screen (${screenCol},${screenRow}))`
    : `nt ${nt} (off-grid (screen ${screenCol},${screenRow} is past the authored ${GRID_W}x${GRID_H} grid))`;

  // paletteAt/tilesAt -- this nametable's own single screen's content at block(bc,br), or the
  // fill metatile everywhere if this nametable is entirely off the authored grid.
  const contentAt = (bc, br) => {
    if (!inBounds) return { tiles: FILL_TILES, palette: FILL_PALETTE };
    return metatileAt(screenIndex, br * 16 + bc);
  };

  for (let br = 0; br < 15; br++) {
    for (let bc = 0; bc < 16; bc++) {
      const { tiles } = contentAt(bc, br);
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
      const tlPal = contentAt(2 * acol, 2 * arow).palette;
      const trPal = contentAt(2 * acol + 1, 2 * arow).palette;
      // sw_rw_attr_bl/br: the last attribute row (arow 7) has no valid bottom block-row (15
      // metatile-block-rows, 0-14, don't pair evenly into 2-row attribute groups: 7 full pairs
      // plus one leftover top-only row) -- forced to 0 unconditionally, even when this nametable
      // is entirely fill, because attribute bytes never borrow a neighbouring nametable's row.
      const blPal = arow === 7 ? 0 : contentAt(2 * acol, 2 * arow + 1).palette;
      const brPal = arow === 7 ? 0 : contentAt(2 * acol + 1, 2 * arow + 1).palette;
      const attrAddr = ntBase + 0x3c0 + arow * 8 + acol;
      const expected = (tlPal & 3) | ((trPal & 3) << 2) | ((blPal & 3) << 4) | ((brPal & 3) << 6);
      attrChecks.push({ addr: attrAddr, expected, label: `${label} attr(${acol},${arow})` });
    }
  }
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
  for (const name of ['frame_cnt', 'game_state', 'ST_GAMEPLAY', 'map_is_streamed', 'cam_nt']) {
    if (!symbols.has(name)) throw new Error(`${name} did not resolve out of this build's own constants.asm/config.inc`);
  }

  await fs.promises.mkdir(outDir, { recursive: true });
  const romPath = path.join(outDir, 'sw_render.nes');
  await fs.promises.writeFile(romPath, romOut);
  if (built.symbolPath) {
    await fs.promises.copyFile(built.symbolPath, path.join(outDir, 'sw_render.fns'));
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
    __EXPECTED_CAM_NT__: `${CAM_NT}`,
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
  console.log(`landing: screen(${LANDING_COL},${LANDING_ROW}) index ${LANDING_SCREEN_INDEX}, cam_nt=${CAM_NT}`);
  console.log(`block checks: ${blockChecks.length}, attr checks: ${attrChecks.length}`);
} finally {
  await fs.promises.rm(dir, { recursive: true, force: true });
}
