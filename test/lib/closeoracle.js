// An independent oracle for the streamed text-box close row (engine/streamdialog.asm sw_dlg_close_row).
//
// Everything expected here is computed in plain JS from the PROJECT (its screens' metatile ids, its metatiles' four
// tiles, its grid and fill id) and from the documented geometry of the box (a tile row r of the six-row box is metatile
// row BOX_MT_ROW + (r >> 1) of the camera origin's screen-row/col, top half when r is even; tile row 24 + r + cam_y_lo>>3
// physical, wrapping at 30 into the nametable below; tile column cam_x_lo>>3 + c wrapping at 32 into the nametable beside)
// -- never by reading the routine's own arithmetic back. The packets it expects are the ones the drain will publish: one
// per nametable the row touches, address / count / tile bytes, in order, then the terminator.
//
// The terrain is decorated so the oracle can tell every mistake apart: every in-grid screen holds a position-dependent
// pattern over ids 0-3, the off-grid fill is a fifth id (4) no screen holds, and the five ids have distinct tiles. So a
// fill read as terrain, a terrain read as fill, a wrong screen, a wrong offset, a wrong half and a wrong count all
// change a byte the oracle checks.

import assert from 'node:assert/strict';
import { callRoutine } from './callroutine.js';

export const FILL_ID = 4;
export const BOX_MT_ROW = 12; // engine/constants.asm
const TILE_BASE = 0x10;
export const tileOf = (id, j) => TILE_BASE + 4 * id + j;
const NT_HI = [0x20, 0x24, 0x28, 0x2c];

// engine/constants.asm, hand-transcribed (a test that parsed the file it checks proves nothing)
export const A = {
  cam_x_lo: 0xaf,
  cam_y_lo: 0xb0,
  cam_nt: 0xb1,
  vram_len: 0x3c,
  vram_buf: 0x0400,
  sw_dlg_ocol: 0x03dc,
  sw_dlg_ocol_l: 0x03dd,
  sw_dlg_orow: 0x03de,
  sw_dlg_orow_l: 0x03df,
  sw_grid_w: 0x05a9,
  sw_grid_h: 0x05aa,
  sw_run_len: 0x05f4,
  mapper_shadow: 0x35
};

/** The terrain id the decorated project holds at (screenCol, screenRow, offset), pattern only. */
export const terrainPattern = (scol, srow, offset) => (scol * 5 + srow * 3 + offset * 7 + (offset >> 4)) % 4;

/** Rewrites the streamed map's screens and the metatile tiles in place; returns the project. */
export function decorateTerrain(project) {
  const map = project.maps.find((m) => m.streamed === true);
  assert.ok(map, 'the project must carry a streamed map');
  map.fillMetatileId = FILL_ID;
  map.screens.forEach((screen, i) => {
    const scol = i % map.gridW;
    const srow = Math.floor(i / map.gridW);
    for (let o = 0; o < screen.metatiles.length; o++) screen.metatiles[o] = terrainPattern(scol, srow, o);
  });
  for (let id = 0; id <= FILL_ID; id++) project.metatiles[id].tiles = [0, 1, 2, 3].map((j) => tileOf(id, j));
  return project;
}

/** What the project says the terrain is at a world cell (fill off the grid). */
export function terrainAt(project, scol, srow, offset) {
  const map = project.maps.find((m) => m.streamed === true);
  if (scol >= map.gridW || srow >= map.gridH) return map.fillMetatileId;
  return map.screens[srow * map.gridW + scol].metatiles[offset];
}

/** The 16 metatile cells of one box metatile row, each as {scol, srow, lcol, lrow}. */
function rowCells({ ocol, ocolL, orow, orowL }, boxRow) {
  const cells = [];
  for (let m = 0; m < 16; m++) {
    let lcol = ocolL + m;
    let scol = ocol;
    if (lcol >= 16) {
      lcol -= 16;
      scol += 1;
    }
    let lrow = orowL + BOX_MT_ROW + (boxRow >> 1);
    let srow = orow;
    if (lrow >= 15) {
      lrow -= 15;
      srow += 1;
    }
    cells.push({ scol, srow, lcol, lrow });
  }
  return cells;
}

/** The chunk reads the close must make for a row, in order: runs that stay on one screen and end at a multiple of 8
 * local columns, in-grid only ({scol, srow, offset, len}); off-grid chunks are fill and read nothing. */
export function expectedReads(project, origin, boxRow) {
  const map = project.maps.find((m) => m.streamed === true);
  const cells = rowCells(origin, boxRow);
  const reads = [];
  let i = 0;
  while (i < 16) {
    const c = cells[i];
    const len = Math.min(8 - (c.lcol & 7), 16 - i);
    for (let k = 1; k < len; k++) {
      assert.equal(cells[i + k].scol, c.scol, 'oracle: a chunk never crosses a screen');
    }
    if (c.scol < map.gridW && c.srow < map.gridH) reads.push({ scol: c.scol, srow: c.srow, offset: c.lrow * 16 + c.lcol, len });
    i += len;
  }
  return reads;
}

/** The packets one close row must publish. */
export function expectedPackets(project, { camXLo, camYLo, camNt }, origin, boxRow) {
  const half = boxRow & 1;
  const bytes = [];
  for (const c of rowCells(origin, boxRow)) {
    const id = terrainAt(project, c.scol, c.srow, c.lrow * 16 + c.lcol);
    bytes.push(tileOf(id, half * 2), tileOf(id, half * 2 + 1));
  }
  let row = 2 * BOX_MT_ROW + boxRow + (camYLo >> 3);
  let rel = 0;
  if (row >= 30) {
    row -= 30;
    rel = 2;
  }
  const colOff = camXLo >> 3;
  const seam = 32 - colOff; // 32: nametable-aligned, never splits
  const addr = (nt, col) => (NT_HI[(camNt ^ nt) & 3] + (row >> 3)) * 256 + (((row & 7) << 5) | col);
  if (seam >= 32) return [{ addr: addr(rel, colOff), bytes }];
  return [
    { addr: addr(rel, colOff), bytes: bytes.slice(0, seam) },
    { addr: addr(rel | 1, 0), bytes: bytes.slice(seam) }
  ];
}

/** The packets sitting in vram_buf, parsed from the bytes alone. */
export function parsePackets(mem) {
  const len = mem[A.vram_len];
  const out = [];
  let i = 0;
  while (mem[A.vram_buf + i] !== 0) {
    const hi = mem[A.vram_buf + i];
    const lo = mem[A.vram_buf + i + 1];
    const n = mem[A.vram_buf + i + 2];
    const bytes = [];
    for (let k = 0; k < n; k++) bytes.push(mem[A.vram_buf + i + 3 + k]);
    out.push({ addr: hi * 256 + lo, bytes });
    i += 3 + n;
    assert.ok(i <= len, 'a packet runs past vram_len');
  }
  assert.equal(i, len, 'the terminator must sit exactly at vram_len');
  return out;
}

/** Counts the entries to `label` (a terrain read): records A (screen col), X (screen row), Y (offset) and sw_run_len. */
export function installReadRecorder(nes, readAddr) {
  const reads = [];
  const original = nes.cpu.emulate.bind(nes.cpu);
  nes.cpu.emulate = () => {
    const cpu = nes.cpu;
    if (((cpu.REG_PC + 1) & 0xffff) === readAddr) {
      reads.push({ scol: cpu.REG_ACC, srow: cpu.REG_X, offset: cpu.REG_Y, len: cpu.mem[A.sw_run_len] });
    }
    return original();
  };
  return reads;
}

/**
 * Runs sw_dlg_close_row for one box tile row and returns what it published and read.
 * `bank`, when given (a banked placement), is the overlay's bank: it is selected before the call and the previous
 * window restored after, the way call_battle brackets the real entry.
 */
export function runCloseRow(nes, { closeAddr, reads, bank = null }, { camXLo, camYLo, camNt, origin, boxRow }) {
  const mem = nes.cpu.mem;
  mem[A.cam_x_lo] = camXLo;
  mem[A.cam_y_lo] = camYLo;
  mem[A.cam_nt] = camNt;
  mem[A.sw_dlg_ocol] = origin.ocol;
  mem[A.sw_dlg_ocol_l] = origin.ocolL;
  mem[A.sw_dlg_orow] = origin.orow;
  mem[A.sw_dlg_orow_l] = origin.orowL;
  mem[A.vram_len] = 0;
  mem[A.vram_buf] = 0;
  const before = { bank: nes.mmap.prgBank, shadow: mem[A.mapper_shadow] };
  if (bank !== null) {
    assert.notEqual(before.bank, bank, 'precondition: the field window is on a different bank from the overlay');
    nes.mmap.write(0x8000, bank);
    mem[A.mapper_shadow] = (before.shadow & ~0x1f) | bank;
  }
  const mark = reads.length;
  nes.cpu.REG_ACC = boxRow;
  callRoutine(nes, closeAddr);
  const after = { bank: nes.mmap.prgBank, shadow: mem[A.mapper_shadow] };
  if (bank !== null) {
    assert.equal(after.bank, bank, 'the close must hand the overlay bank back selected');
    assert.equal(after.shadow & 0x1f, bank, 'mapper_shadow must name the overlay bank on return');
    nes.mmap.write(0x8000, before.bank);
    mem[A.mapper_shadow] = before.shadow;
  } else {
    assert.equal(after.bank, before.bank, 'a resident close leaves the window where it found it');
    assert.equal(after.shadow, before.shadow, 'a resident close leaves mapper_shadow alone');
  }
  return { packets: parsePackets(mem), reads: reads.slice(mark), vramLen: mem[A.vram_len] };
}

/** One row's whole comparison; returns a mismatch description or null. */
export function compareRow(project, ctx, c) {
  const got = runCloseRow(ctx.nes, ctx, c);
  const want = expectedPackets(project, c, c.origin, c.boxRow);
  const wantReads = expectedReads(project, c.origin, c.boxRow);
  const tag = `box row ${c.boxRow} cam(${c.camXLo},${c.camYLo},nt${c.camNt}) origin ${JSON.stringify(c.origin)}`;
  if (JSON.stringify(got.packets) !== JSON.stringify(want)) return `${tag}: packets ${JSON.stringify(got.packets)} != ${JSON.stringify(want)}`;
  if (JSON.stringify(got.reads) !== JSON.stringify(wantReads)) return `${tag}: reads ${JSON.stringify(got.reads)} != ${JSON.stringify(wantReads)}`;
  return null;
}

/** The deterministic case matrix: hand-picked boundaries first, then a seeded sweep. `grid` is {gridW, gridH}. */
export function closeCases({ gridW, gridH }) {
  const cases = [];
  const origins = [];
  const oc = [0, 1, 22, 23, 24, gridW - 2, gridW - 1, gridW].filter((v) => v >= 0 && v <= gridW);
  const ocl = [0, 1, 2, 3, 5, 7, 8, 12, 15];
  const or = [0, gridH - 1, gridH];
  const orl = [0, 2, 3, 10, 13, 14];
  for (const ocol of [...new Set(oc)]) for (const ocolL of ocl) origins.push({ ocol, ocolL, orow: or[(ocol + ocolL) % 3], orowL: orl[(ocol * 3 + ocolL) % 6] });
  for (const orow of [...new Set(or)]) for (const orowL of orl) origins.push({ ocol: 1 + (orow % 2), ocolL: (orowL * 5) % 16, orow, orowL });
  const cams = [
    { camXLo: 0, camYLo: 0, camNt: 0 },
    { camXLo: 8, camYLo: 0x38, camNt: 1 },
    { camXLo: 0x80, camYLo: 0x60, camNt: 2 },
    { camXLo: 0xf8, camYLo: 0xe8, camNt: 3 },
    { camXLo: 0x7c, camYLo: 0x5a, camNt: 0 },
    { camXLo: 0x10, camYLo: 0xb0, camNt: 3 }
  ];
  origins.forEach((origin, i) => {
    for (let r = 0; r < 6; r++) cases.push({ ...cams[(i + r) % cams.length], origin, boxRow: r });
  });
  // a seeded sweep over everything
  let s = 12345;
  const rnd = (n) => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s % n);
  for (let i = 0; i < 240; i++) {
    cases.push({
      camXLo: rnd(256),
      camYLo: rnd(240),
      camNt: rnd(4),
      origin: { ocol: rnd(gridW + 1), ocolL: rnd(16), orow: rnd(gridH + 1), orowL: rnd(15) },
      boxRow: rnd(6)
    });
  }
  return cases;
}
