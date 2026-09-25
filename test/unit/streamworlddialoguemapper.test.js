// Large streamed worlds (ROADMAP item 15), phase 2 slice 7a: the dialogue overlay's address
// mapper, split-at-seam packet writer, and masked-attribute code (engine/streamworld.asm's
// sw_dlg_mapper_start..end block) -- restricted scope per the slice's own brief: no lifecycle
// state machine exists yet (that is slice 7b's), so every routine here is driven directly
// (test/lib/callroutine.js's callRoutine), never through a production call site, and the
// slice-2b refusal on any dialogue-bearing event reachable on a streamed screen stays in force
// (this slice adds no way to actually open a box on a streamed map).
//
// Every expected VRAM/attribute byte below comes from an INDEPENDENT re-derivation of
// docs/design-streamed-worlds.md section 7's own prose formulas, in plain modular arithmetic --
// not copied from, or read back out of, the 6502 under test. The routines' own contract:
//
//   sw_dlg_tile_addr   -- A=box-relative tile row (0-5), X=box-local column (0-31); returns
//                          A=$2006 hi, Y=$2006 lo, for the physical position the box's own fixed
//                          bottom-6-row footprint maps to under the current camera.
//   sw_dlg_write_row   -- A=box-relative tile row; sw_dlgw_srclo/hi (zero page $CB/$CC) point at
//                          32 source bytes. Queues 1-2 vram_buf packets, split at the physical
//                          nametable seam when the row straddles one -- never opens a packet it
//                          will not push to.
//   sw_dlg_attr_precompute -- no args; computes each of the box's 3 metatile-row bands' own
//                          attribute row/row-wrap-nt-bit/row-half-mask (promoted to $FF for both
//                          bands of whichever pair shares one physical attribute byte), plus the
//                          column-seam info (edgeAc/cxodd/wrapEnd).
//   sw_dlg_attr_open_band  -- A=band (0-2); writes MASKED attribute bytes (overlay = shadow AND
//                          NOT mask) derived from attr_shadow -- never writes attr_shadow itself.
//   sw_dlg_attr_close_band -- A=band (0-2); restores the SAME bytes verbatim from attr_shadow,
//                          no masking -- also never writes attr_shadow.
//
// Both mappers assume the camera is already floored to a 16px (metatile) boundary on both axes
// (cam_x_lo/cam_y_lo's low nibble is 0) -- every test below picks camera values respecting that.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { validateProject } from '../../shared/project.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { callRoutine } from '../lib/callroutine.js';
import NES from '../../renderer/emulator/core/nes.js';

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// engine/constants.asm -- hardcoded per CLAUDE.md's own rule (a test that reads the file it is
// checking proves nothing). cam_x_lo/y_lo/nt are chained zero-page equates nesasm never lists in
// game.fns; these three literals are test/unit/streamworld.test.js's own already-resolved values
// (its own comment there explains the equate-chain walk). sw_dlgw_srclo/srchi are this slice's
// own fresh named equates, engine/constants.asm's dialogue scratch block ($C8-$F2).
const CAM_X_LO = 0xaf;
const CAM_Y_LO = 0xb0;
const CAM_NT = 0xb1;
const SW_DLGW_SRCLO = 0xcb;
const SW_DLGW_SRCHI = 0xcc;
const ATTR_SHADOW = 0x0600; // engine/constants.asm:1177
const VRAM_LEN = 0x3c;
const VRAM_READY = 0x3f;
const VRAM_BUF = 0x0400; // engine/constants.asm:1150
// Free RAM: nothing in engine/constants.asm names anything in $0704-$077F (the callRoutine stub
// itself only ever occupies $0700-$0703; the next named allocation is the frozen-world block at
// $0780) -- confirmed by grep, not assumed. 32 bytes for sw_dlg_write_row's own source row.
const SRC_BUF = 0x0710;

const SW_RW_NT_HI = [0x20, 0x24, 0x28, 0x2c]; // engine/streamworld.asm's own sw_rw_nt_hi table, reused verbatim by every routine here rather than a second copy

// ---------------------------------------------------------------------------------------------
// Independent oracle: docs/design-streamed-worlds.md section 7's own formulas, reimplemented in
// plain modular arithmetic from the prose contract, not from the assembly.
// ---------------------------------------------------------------------------------------------

/** The physical (row, col, nametable) a box-relative (row 0-5, col 0-31) tile position maps to. */
function dlgPhysPos(camXLo, camYLo, camNt, row, col) {
  const physRowRaw = (camYLo >> 3) + 24 + row;
  const rowWrap = physRowRaw >= 30 ? 1 : 0;
  const physRow = rowWrap ? physRowRaw - 30 : physRowRaw;
  const physColRaw = (camXLo >> 3) + col;
  const colWrap = physColRaw >= 32 ? 1 : 0;
  const physCol = colWrap ? physColRaw - 32 : physColRaw;
  const nt = (camNt ^ ((rowWrap << 1) | colWrap)) & 3;
  return { physRow, physCol, nt };
}

/** sw_dlg_tile_addr's own $2006 hi/lo pair, derived independently of dlgPhysPos's flat offset. */
function dlgTileAddr(camXLo, camYLo, camNt, row, col) {
  const { physRow, physCol, nt } = dlgPhysPos(camXLo, camYLo, camNt, row, col);
  const addrLo = ((physRow & 7) << 5) | physCol;
  const addrHi = SW_RW_NT_HI[nt] + (physRow >> 3);
  return { hi: addrHi, lo: addrLo, nt };
}

/** Every (nt, flat tile offset, source byte) cell sw_dlg_write_row must produce for one row. */
function expectedWriteRowCells(camXLo, camYLo, camNt, row, source32) {
  const r = camXLo >> 3;
  const cells = [];
  if (r === 0) {
    const { physRow, physCol, nt } = dlgPhysPos(camXLo, camYLo, camNt, row, 0);
    for (let i = 0; i < 32; i++) cells.push({ nt, offset: physRow * 32 + physCol + i, byte: source32[i] });
    return cells;
  }
  const count1 = 32 - r;
  const seg1 = dlgPhysPos(camXLo, camYLo, camNt, row, 0);
  for (let i = 0; i < count1; i++) cells.push({ nt: seg1.nt, offset: seg1.physRow * 32 + seg1.physCol + i, byte: source32[i] });
  const seg2 = dlgPhysPos(camXLo, camYLo, camNt, row, count1);
  for (let i = 0; i < r; i++) cells.push({ nt: seg2.nt, offset: seg2.physRow * 32 + seg2.physCol + i, byte: source32[count1 + i] });
  return cells;
}

/** The box's own physical attribute-quadrant footprint, computed geometrically from the world
 * position each of its 3 metatile-row bands x 16 metatile-columns actually lands on -- NOT by
 * replaying precompute's row/nt-bit/mask bookkeeping (review round 1, finding A1: that rolling
 * computation itself was the bug under test, so an oracle built from the same steps proves
 * nothing). For each physical attribute byte address (real PPU $23C0+ space) touched anywhere in
 * the box, `masks` unions the 2-bit-per-quadrant mask of every quadrant that address's own
 * metatile cell(s) fall inside; `byBand[b]` is the set of addresses band b's own 16 columns touch
 * (a byte straddling two bands appears in both bands' sets, once each, since each band's own
 * open/close call really does touch it independently). Requires camXLo/camYLo aligned to 16 (a
 * whole metatile), the same precondition every routine under test assumes. */
function boxFootprint(camXLo, camYLo, camNt) {
  const masks = new Map();
  const byBand = [new Set(), new Set(), new Set()];
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
      byBand[b].add(addr);
    }
  }
  return { masks, byBand };
}

/** A real PPU attribute-table address ($23C0-$23FF/$27C0-.../$2BC0-.../$2FC0-...) decomposed into
 * the nametable index (0-3) and the 64-byte attribute-table local offset -- both attr_shadow's own
 * flat-256-byte indexing (nt*64+localOffset) and readAttr's own (nt, localOffset) pair use this. */
function attrAddrParts(addr) {
  return { nt: Math.floor((addr - 0x2000) / 0x400), localOffset: addr & 0x3f };
}

/** The column-seam-only half of precompute's contract (edgeAc/cxodd/wrapEnd): plain algebra on
 * cam_x_lo alone, uninvolved in finding A1's row-wrap defect, so it stays a direct formula rather
 * than routed through boxFootprint's per-cell geometry. */
function dlgColumnSeam(camXLo) {
  const cxodd = (camXLo >> 4) & 1;
  const edgeAc = camXLo >> 5;
  const wrapEnd = edgeAc + cxodd - 1;
  return { edgeAc, cxodd, wrapEnd };
}

/** overlay = shadow AND NOT mask -- the box's fixed background palette 0 makes "mask in the box
 * palette" a plain clear, no OR needed (text.asm's identical choice). */
function overlay(shadowByte, mask) {
  return shadowByte & (~mask & 0xff);
}

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

async function buildHarness(t, opts = {}) {
  const project = createStreamedProject({ gameType: 'rpg', ...opts });
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlgmapper-'));
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

function setCam(mem, x, y, nt) {
  mem[CAM_X_LO] = x;
  mem[CAM_Y_LO] = y;
  mem[CAM_NT] = nt;
}

/** vram_drain, called directly outside NMI -- forced blank first (memory's own documented trap:
 * a manual drain with rendering on lets the PPU address wander between $2006 pairs mid-drain). */
function drainVram(nes, addrOf) {
  nes.mmap.write(0x2001, 0);
  callRoutine(nes, addrOf('vram_drain'));
}

/** Counts CPU writes landing in attr_shadow's own $0600-$06FF page while `fn` runs -- plan case 7
 * (streamed-worlds-phase2-plan.md:1210) requires zero writes there through a whole restore, a
 * stronger claim than "the final snapshot is unchanged" (a same-value store passes the latter).
 * cpu.write() is the one place every non-PPU-register CPU store in this address range funnels
 * through (renderer/emulator/core/cpu.js); attr_shadow sits below $2000, so no mapper indirection
 * applies. */
function countShadowWrites(nes, fn) {
  const original = nes.cpu.write;
  let count = 0;
  nes.cpu.write = function (addr, val) {
    if (addr >= ATTR_SHADOW && addr <= ATTR_SHADOW + 0xff) count++;
    return original.call(this, addr, val);
  };
  try {
    fn();
  } finally {
    nes.cpu.write = original;
  }
  return count;
}

/** Parses the raw vram_buf queue (engine/text.asm's own [addr-hi, addr-lo, count, byte...]
 * packet header, vram_open/vram_push's own layout) directly out of CPU memory into a flat list
 * of {addr, byte} cells in emission order, bounded by vram_len (a caller resets VRAM_LEN to 0
 * before the routine under test runs, so it is exactly the byte count that one call queued) --
 * never a $00-terminator scan, since vram_end writes that terminator without advancing vram_len.
 * Must be read before drainVram, which zeroes vram_len as its own last act. */
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

/** Exact set-equality between a routine's actually emitted packet cells and an independently
 * derived {addr -> byte} expectation -- review round 2 finding C.1's own gap: checking values
 * only at addresses an oracle already expected cannot see an address the routine ALSO (wrongly)
 * touched, such as the wrapEnd-off-by-one mutant's extra cleared column. Duplicate writes to the
 * same address within one call, a missing expected address, an extra actual address, and a wrong
 * value at a correctly-touched address are each their own failure. */
function assertExactCells(actualCells, expected, label) {
  const actual = new Map();
  for (const { addr, byte } of actualCells) {
    assert.equal(actual.has(addr), false, `${label}: duplicate write to $${addr.toString(16)}`);
    actual.set(addr, byte);
  }
  const fmt = (m) => [...m.keys()].map((a) => `$${a.toString(16)}`).join(',');
  assert.equal(actual.size, expected.size, `${label}: emitted cells {${fmt(actual)}}, expected {${fmt(expected)}}`);
  for (const [addr, byte] of expected) {
    assert.equal(actual.get(addr), byte, `${label}: $${addr.toString(16)}`);
  }
}

function readTile(nes, nt, offset) {
  return nes.ppu.nameTable[nes.ppu.ntable1[nt]].tile[offset];
}

function readAttr(nes, nt, localOffset) {
  return nes.ppu.nameTable[nes.ppu.ntable1[nt]].tile[0x3c0 + localOffset];
}

function writeAttrShadowByte(mem, nt, arow, ac, value) {
  mem[ATTR_SHADOW + nt * 64 + arow * 8 + ac] = value;
}

function readAttrShadowByte(mem, nt, arow, ac) {
  return mem[ATTR_SHADOW + nt * 64 + arow * 8 + ac];
}

function callWriteRow(nes, mem, addrOf, row, source32) {
  for (let i = 0; i < 32; i++) mem[SRC_BUF + i] = source32[i];
  mem[SW_DLGW_SRCLO] = SRC_BUF & 0xff;
  mem[SW_DLGW_SRCHI] = SRC_BUF >> 8;
  mem[VRAM_LEN] = 0;
  nes.cpu.REG_ACC = row;
  callRoutine(nes, addrOf('sw_dlg_write_row'));
}

function callPrecompute(nes, addrOf) {
  callRoutine(nes, addrOf('sw_dlg_attr_precompute'));
}

function callOpenBand(nes, mem, addrOf, band) {
  mem[VRAM_LEN] = 0;
  nes.cpu.REG_ACC = band;
  callRoutine(nes, addrOf('sw_dlg_attr_open_band'));
}

function callCloseBand(nes, mem, addrOf, band) {
  mem[VRAM_LEN] = 0;
  nes.cpu.REG_ACC = band;
  callRoutine(nes, addrOf('sw_dlg_attr_close_band'));
}

// ---------------------------------------------------------------------------------------------
// Case 1: the split-at-seam address mapper, straddling two physical nametable halves.
// ---------------------------------------------------------------------------------------------

test('case 1: split-at-seam packet writer -- a row straddling the horizontal seam lands as two packets at their own independently-computed physical destinations', async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  setCam(mem, 128, 0, 0); // camXLo=128 -> r=16, an even 16/16 split of the 32-byte row
  const row = 2;
  const source = Array.from({ length: 32 }, (_, i) => 0x50 + i);
  const expected = expectedWriteRowCells(128, 0, 0, row, source);
  assert.equal(expected.length, 32);
  // Sanity: this camera genuinely produces a split (two distinct nt values), or the case is not
  // exercised at all.
  const nts = new Set(expected.map((c) => c.nt));
  assert.equal(nts.size, 2, `precondition: camXLo=128 must straddle two nametables, got nt set ${JSON.stringify([...nts])}`);

  callWriteRow(nes, mem, addrOf, row, source);
  drainVram(nes, addrOf);

  for (const cell of expected) {
    assert.equal(readTile(nes, cell.nt, cell.offset), cell.byte, `nt ${cell.nt} offset ${cell.offset} (source byte ${cell.byte})`);
  }
});

// ---------------------------------------------------------------------------------------------
// Case 2: a masked attribute write must not clobber the outside-band half of a shared byte.
// ---------------------------------------------------------------------------------------------

test('case 2: a masked attribute write preserves the outside-band half of the byte it touches', async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  // camYLo=32: band0 covers metatile row 14 alone (arow 7, top half), band1 covers row 15 --
  // wrapped into nt bit 2, arow 0 (also top half of ITS byte, physically unrelated to band0's).
  // Geometrically these do not share a physical attribute byte, so band0's own half-mask write is
  // exercised in isolation here, uncomplicated by the shared-byte promotion (that is case 6's job).
  setCam(mem, 0, 32, 0);
  const { masks, byBand } = boxFootprint(0, 32, 0);
  assert.equal([...byBand[0]].filter((a) => byBand[1].has(a)).length, 0, 'precondition: band0/band1 must NOT share a physical attribute byte for this isolated single-band case');
  const addr = [...byBand[0]][3]; // an ordinary mid-row column, away from the cxodd edge case
  const mask = masks.get(addr);
  assert.equal(mask, 0x0f, 'precondition: this byte must be the top half (mask clears the LOW nibble)');

  const { nt, localOffset } = attrAddrParts(addr);
  const shadowByte = 0xa6; // top nibble $A (outside band, must survive), bottom nibble $6 (inside band, box content -- discarded)
  writeAttrShadowByte(mem, nt, localOffset >> 3, localOffset & 7, shadowByte);

  callPrecompute(nes, addrOf);
  callOpenBand(nes, mem, addrOf, 0);
  drainVram(nes, addrOf);

  const expectedByte = overlay(shadowByte, mask);
  const actual = readAttr(nes, nt, localOffset);
  assert.equal(actual, expectedByte, `expected overlay ${expectedByte.toString(16)}, got ${actual.toString(16)}`);
  assert.equal(actual & 0xf0, shadowByte & 0xf0, 'the outside-band (top) nibble must survive the masked write untouched');
});

// ---------------------------------------------------------------------------------------------
// Case 3: attr_shadow must be left pristine after a masked packet write (open never writes it).
// ---------------------------------------------------------------------------------------------

test('case 3: attr_shadow is left pristine after sw_dlg_attr_open_band -- only masked PPU bytes are written, never attr_shadow itself', async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  setCam(mem, 0, 0, 0);
  // Distinct, position-dependent fill across the whole shadow page so a stray write anywhere is
  // detectable, not just at the cells this band touches.
  const before = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    before[i] = (i * 37 + 11) & 0xff;
    mem[ATTR_SHADOW + i] = before[i];
  }

  callPrecompute(nes, addrOf);
  for (let band = 0; band < 3; band++) callOpenBand(nes, mem, addrOf, band);
  drainVram(nes, addrOf);

  for (let i = 0; i < 256; i++) {
    assert.equal(mem[ATTR_SHADOW + i], before[i], `attr_shadow byte ${i} must be untouched by sw_dlg_attr_open_band`);
  }
});

// ---------------------------------------------------------------------------------------------
// Case 4: the packet writer must never open a zero-count wrapped-segment packet.
// ---------------------------------------------------------------------------------------------

test('case 4: the wrapped-segment attribute packet is never opened when it would be empty (camXLo=0 -- no column seam at all)', async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  setCam(mem, 0, 0, 0); // camXLo=0 -> edgeAc=0, cxodd=0 -- the column seam sits exactly at nt boundary, the wrap segment is empty
  const seam = dlgColumnSeam(0);
  assert.equal(seam.edgeAc, 0);
  assert.equal(seam.cxodd, 0);

  callPrecompute(nes, addrOf);
  callOpenBand(nes, mem, addrOf, 0);

  // No wrap packet: exactly one packet (3-byte header + 8 attribute bytes = 11), never a second,
  // empty-count one opened and immediately closed.
  assert.equal(mem[VRAM_LEN], 11, `sw_dlg_attr_open_band must queue exactly 11 bytes (one 8-byte packet) when the wrap segment is empty, got ${mem[VRAM_LEN]}`);
});

// ---------------------------------------------------------------------------------------------
// Case 5: the mapper's destination for a positive box offset wrapping BOTH torus seams at once
// (Chris, 2026-09-25: this case means positive box-relative offsets wrapping row and column
// together, not a negative/offscreen input -- the dialogue mapper's own documented domain is box-
// relative row 0-5, column 0-31, and signed/offscreen projection is owned by sw_project_axis's own
// tests instead).
// ---------------------------------------------------------------------------------------------

test('case 5: sw_dlg_tile_addr computes the correct destination when a positive box offset wraps BOTH the row and column torus seams at once', async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  // camXLo=240 (r=30), camYLo=48 (>>3=6, +24=30 -- row 0 alone already sits exactly at the wrap
  // boundary): row=5, col=31 pushes both axes past their own physical page.
  setCam(mem, 240, 48, 0);
  const cases = [
    { row: 0, col: 0 }, // row wraps (30 -> 0, nt bit 1 set), col does not
    { row: 5, col: 31 }, // both wrap
    { row: 5, col: 1 } // row wraps, col does not (col 30+1=31 < 32)
  ];
  for (const { row, col } of cases) {
    const expected = dlgTileAddr(240, 48, 0, row, col);
    nes.cpu.REG_ACC = row;
    nes.cpu.REG_X = col;
    callRoutine(nes, addrOf('sw_dlg_tile_addr'));
    assert.equal(nes.cpu.REG_ACC, expected.hi, `row ${row} col ${col}: hi byte`);
    assert.equal(nes.cpu.REG_Y, expected.lo, `row ${row} col ${col}: lo byte`);
  }
});

// ---------------------------------------------------------------------------------------------
// Case 6: the shared-attribute-byte double-write -- two bands sharing one physical byte.
// ---------------------------------------------------------------------------------------------

test('case 6: two bands sharing one physical attribute byte both write the FULL mask -- the second write does not undo the first half', async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  // camYLo=0: band0 covers metatile row 12 (arow 6, top half), band1 covers row 13 (arow 6, bottom
  // half) -- band0/band1 genuinely share the SAME physical attribute byte here.
  setCam(mem, 0, 0, 0);
  const { byBand } = boxFootprint(0, 0, 0);
  const shared = [...byBand[0]].filter((a) => byBand[1].has(a));
  assert.equal(shared.length, 8, 'precondition: band0/band1 must share a full physical attribute row (8 bytes)');
  const addr = shared[3]; // ac=3, an ordinary mid-row column

  const { nt, localOffset } = attrAddrParts(addr);
  const shadowByte = 0xab; // both nibbles inside the box (band0's row AND band1's row are both box rows here) -- correct final byte is a full clear, 0x00
  writeAttrShadowByte(mem, nt, localOffset >> 3, localOffset & 7, shadowByte);

  callPrecompute(nes, addrOf);
  callOpenBand(nes, mem, addrOf, 0);
  drainVram(nes, addrOf);
  callOpenBand(nes, mem, addrOf, 1);
  drainVram(nes, addrOf);

  const actual = readAttr(nes, nt, localOffset);
  assert.equal(actual, 0x00, `both bands share this byte and both cover box content -- final byte must be fully cleared (0x00), got ${actual.toString(16)} (a naive independent-half-mask second write would leave 0x0b, band0's own half undone)`);
});

// ---------------------------------------------------------------------------------------------
// Case 6b: the same shared-byte double-write, but for a pair on the FAR side of the vertical
// seam -- this is exactly review round 1's own reported defect (finding A1): the buggy rolling
// computation reset to ntb=0 for the second of the two wrapped bands, so this pair never even
// reached the shared-byte code path under the old engine. Reviewer's own concrete input.
// ---------------------------------------------------------------------------------------------

test('case 6b: two bands sharing one physical attribute byte on the far side of the vertical seam both write the FULL mask (cam_x_lo=0, cam_y_lo=$20, cam_nt=0 -- reviewer round 1\'s own concrete input, required row-wrap bits [0,2,2])', async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  setCam(mem, 0, 0x20, 0);
  const { byBand } = boxFootprint(0, 0x20, 0);
  // Required row-wrap bits [0,2,2]: band0 must land in nt XOR 0 (home), bands1/2 in nt XOR 2.
  const ntOf = (addr) => attrAddrParts(addr).nt;
  assert.ok([...byBand[0]].every((a) => ntOf(a) === 0), 'precondition: band0 must NOT cross the vertical seam');
  assert.ok([...byBand[1]].every((a) => ntOf(a) === 2), 'precondition: band1 must be on the far side of the vertical seam');
  assert.ok([...byBand[2]].every((a) => ntOf(a) === 2), 'precondition: band2 must also be on the far side of the vertical seam (the bug this fix repairs: the old engine reset this back to nt bit 0)');
  const shared = [...byBand[1]].filter((a) => byBand[2].has(a));
  assert.equal(shared.length, 8, 'precondition: band1/band2 must share a full physical attribute row (8 bytes) on the wrapped nametable');
  const addr = shared[3];

  const { nt, localOffset } = attrAddrParts(addr);
  const shadowByte = 0xab;
  writeAttrShadowByte(mem, nt, localOffset >> 3, localOffset & 7, shadowByte);

  callPrecompute(nes, addrOf);
  callOpenBand(nes, mem, addrOf, 1);
  drainVram(nes, addrOf);
  callOpenBand(nes, mem, addrOf, 2);
  drainVram(nes, addrOf);
  let actual = readAttr(nes, nt, localOffset);
  assert.equal(actual, 0x00, `both bands share this wrapped byte and both cover box content -- final byte must be fully cleared (0x00), got ${actual.toString(16)}`);

  callCloseBand(nes, mem, addrOf, 1);
  drainVram(nes, addrOf);
  callCloseBand(nes, mem, addrOf, 2);
  drainVram(nes, addrOf);
  actual = readAttr(nes, nt, localOffset);
  assert.equal(actual, shadowByte, `close must restore the wrapped shared byte exactly, got ${actual.toString(16)}`);
  assert.equal(readAttrShadowByte(mem, nt, localOffset >> 3, localOffset & 7), shadowByte, 'attr_shadow itself must be untouched by the whole open+close transaction');
});

// ---------------------------------------------------------------------------------------------
// Case 7: the direct-routine close-restoration -- both quadrants, zero writes to attr_shadow.
// ---------------------------------------------------------------------------------------------

/** One full open+close transaction's worth of case 7's own checks, parameterized on camera so it
 * can be run a second time at a camXLo that actually enters the wrapped close loop -- camXLo=0
 * (edgeAc=0, cxodd=0) never does (review round 2 finding C.2): sw_dlg_acb_wrap_loop
 * (engine/streamworld.asm:4139) is only reached when the wrapped segment is non-empty. */
function checkCase7Transaction(nes, mem, addrOf, shadowBefore, camX, camY, camNt) {
  setCam(mem, camX, camY, camNt);
  callPrecompute(nes, addrOf);
  // A2 (plan case 7, streamed-worlds-phase2-plan.md:1210): zero writes to attr_shadow ($0600-
  // $06FF) through the WHOLE call sequence, not merely an unchanged final snapshot -- a same-
  // value store (writing back the exact byte just read) would pass a snapshot-only check.
  const openWrites = countShadowWrites(nes, () => {
    for (let band = 0; band < 3; band++) {
      callOpenBand(nes, mem, addrOf, band);
      drainVram(nes, addrOf);
    }
  });
  assert.equal(openWrites, 0, `camXLo=${camX}: sw_dlg_attr_open_band must perform zero writes to attr_shadow ($0600-$06FF), not merely leave its final contents unchanged`);
  const closeWrites = countShadowWrites(nes, () => {
    for (let band = 0; band < 3; band++) {
      callCloseBand(nes, mem, addrOf, band);
      drainVram(nes, addrOf);
    }
  });
  assert.equal(closeWrites, 0, `camXLo=${camX}: sw_dlg_attr_close_band must perform zero writes to attr_shadow ($0600-$06FF), not merely leave its final contents unchanged`);

  const { byBand } = boxFootprint(camX, camY, camNt);
  for (let band = 0; band < 3; band++) {
    for (const addr of byBand[band]) {
      const { nt, localOffset } = attrAddrParts(addr);
      const expected = shadowBefore[nt * 64 + localOffset];
      const actual = readAttr(nes, nt, localOffset);
      assert.equal(actual, expected, `camXLo=${camX} band ${band} addr $${addr.toString(16)}: close must restore attr_shadow's own byte exactly`);
    }
  }
  for (let i = 0; i < 256; i++) {
    assert.equal(mem[ATTR_SHADOW + i], shadowBefore[i], `camXLo=${camX}: attr_shadow byte ${i} must be untouched by the whole open+close transaction`);
  }
}

test('case 7: sw_dlg_attr_close_band restores every touched byte verbatim from attr_shadow, and never writes attr_shadow itself', async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  // Pre-populate attr_shadow with real, distinctive (non-fresh) attribute bytes across the whole
  // page, as if prior scrolling had already run.
  const shadowBefore = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    shadowBefore[i] = (i * 53 + 7) & 0xff;
    mem[ATTR_SHADOW + i] = shadowBefore[i];
  }

  checkCase7Transaction(nes, mem, addrOf, shadowBefore, 0, 0, 0);
  // camXLo=16: edgeAc=0, cxodd=1, so wrapEnd=edgeAc+cxodd-1=0 -- the wrapped segment is non-empty
  // and its own close loop (engine/streamworld.asm:4139) actually runs, one iteration, for every
  // band, unlike the camXLo=0 transaction above.
  checkCase7Transaction(nes, mem, addrOf, shadowBefore, 16, 0, 0);
});

// ---------------------------------------------------------------------------------------------
// Sweep: exhaustive attribute open/close correctness across every aligned camera position --
// review round 1's own coverage shape (16 aligned X x 15 aligned Y x 4 cam_nt), narrowed to the
// open/close attribute check the reported defect actually lives in (row-packets and tile-address
// checks were already 0/0 mismatches in the reviewer's own wider sweep).
// ---------------------------------------------------------------------------------------------

test('sweep: every aligned camera position (16 X x 15 Y x 4 cam_nt) opens and closes every attribute band to the geometrically-correct byte', async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  const terrain = (i) => (i * 37 + 0xa7) & 0xff;
  for (let i = 0; i < 256; i++) mem[ATTR_SHADOW + i] = terrain(i);

  let checks = 0;
  for (let cy = 0; cy < 240; cy += 16) {
    for (let cx = 0; cx < 256; cx += 16) {
      for (let nt = 0; nt < 4; nt++) {
        setCam(mem, cx, cy, nt);
        const { masks, byBand } = boxFootprint(cx, cy, nt);
        callPrecompute(nes, addrOf);
        for (let band = 0; band < 3; band++) {
          const openExpected = new Map();
          for (const addr of byBand[band]) {
            const { nt: pnt, localOffset } = attrAddrParts(addr);
            openExpected.set(addr, overlay(terrain(pnt * 64 + localOffset), masks.get(addr)));
          }
          callOpenBand(nes, mem, addrOf, band);
          // Read before draining (drainVram zeroes vram_len): the COMPLETE emitted packet cell
          // list, address and value together, open and close -- not only the values an oracle
          // already expected at addresses it already expected (review round 2 finding C.1: a
          // wrapEnd-off-by-one mutant emits one genuine extra cleared column outside this
          // footprint, which reading back only the expected addresses can never see).
          assertExactCells(readVramCells(mem), openExpected, `cx=${cx} cy=${cy} cam_nt=${nt} band=${band} open`);
          drainVram(nes, addrOf);
          for (const [addr, expected] of openExpected) {
            const { nt: pnt, localOffset } = attrAddrParts(addr);
            assert.equal(readAttr(nes, pnt, localOffset), expected, `cx=${cx} cy=${cy} cam_nt=${nt} band=${band} open addr=$${addr.toString(16)}`);
            checks++;
          }

          const closeExpected = new Map();
          for (const addr of byBand[band]) {
            const { nt: pnt, localOffset } = attrAddrParts(addr);
            closeExpected.set(addr, terrain(pnt * 64 + localOffset));
          }
          callCloseBand(nes, mem, addrOf, band);
          assertExactCells(readVramCells(mem), closeExpected, `cx=${cx} cy=${cy} cam_nt=${nt} band=${band} close`);
          drainVram(nes, addrOf);
          for (const [addr, expected] of closeExpected) {
            const { nt: pnt, localOffset } = attrAddrParts(addr);
            assert.equal(readAttr(nes, pnt, localOffset), expected, `cx=${cx} cy=${cy} cam_nt=${nt} band=${band} close addr=$${addr.toString(16)}`);
            checks++;
          }
        }
      }
    }
  }
  assert.equal(checks, 48960, 'sanity: the sweep must actually visit every position -- 16 x 15 x 4 cam values x (up to) 8 addresses x 3 bands x 2 phases');
});

// ---------------------------------------------------------------------------------------------
// Refusal-still-fires: slice 2b's dialogue-on-streamed-map refusal is unmodified by this slice.
// ---------------------------------------------------------------------------------------------

test('refusal still fires: a Say reachable on a streamed screen is still refused -- this slice adds no way to open a box on a streamed map', () => {
  const project = createStreamedProject({});
  const streamedMap = project.maps.find((m) => m.streamed === true);
  const screen = streamedMap.screens[0];
  screen.entities = screen.entities ?? [];
  screen.entities.push({
    actorId: 0,
    x: 32,
    y: 32,
    props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Hello.' }] }] } }
  });
  const errors = validateProject(project).filter((x) => x.severity === 'error');
  assert.ok(errors.some((e) => /shows text/.test(e.message)), `the D.4 refusal must still fire: ${JSON.stringify(errors)}`);
});

// ---------------------------------------------------------------------------------------------
// Byte-identity: a non-streamed project, and a streamed project without text, are unchanged.
// ---------------------------------------------------------------------------------------------

// Full-ROM byte-identity baseline: engine/constants.asm and engine/streamworld.asm exactly as
// they stood at 506a8ea (the last commit before this slice's whole dialogue-mapper block existed
// -- git status shows both files as uncommitted modifications on top of it), loaded through
// project.code.overrides so the CURRENT generate.js/pipeline.js still drive the build. The two
// tests below gate the new code off (no text; not streamed), so the current generator's own only
// change -- the new gated STREAMWORLD_DIALOGUE_MAPPER_KERNEL_HI_ALLOWANCE term -- evaluates to 0
// either way and contributes no difference; what remains under test is that the new engine source
// itself compiles down to zero emitted bytes when its own gate is closed.
function dialogueMapperBaselineOverrides() {
  return ['constants.asm', 'streamworld.asm'].map((name) => ({
    name,
    text: execFileSync('git', ['show', `506a8ea:engine/${name}`], { encoding: 'utf8' })
  }));
}

test('byte-identity: a streamed project with no text assembles a byte-identical ROM to a build without the dialogue-mapper code (zero dialogue-mapper bytes emitted)', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = null; // the default project's own title screen is itself a text source
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlgmapper-noText-'));
  const baselineDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlgmapper-noText-baseline-'));
  t.after(() => Promise.all([dir, baselineDir].map((d) => fs.promises.rm(d, { recursive: true, force: true }))));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const symbols = fs.readFileSync(built.symbolPath, 'utf8');
  const addr = (label) => {
    const m = symbols.match(new RegExp(`^${label}\\s+=\\s+\\$([0-9A-Fa-f]+)`, 'm'));
    assert.ok(m, `${label} should be a named symbol in game.fns`);
    return parseInt(m[1], 16);
  };
  assert.equal(addr('sw_dlg_mapper_end') - addr('sw_dlg_mapper_start'), 0);

  const baselineProject = structuredClone(project);
  baselineProject.code = { overrides: dialogueMapperBaselineOverrides(), files: [] };
  await saveProject(baselineDir, baselineProject);
  const baselineBuilt = await buildProject({ dir: baselineDir, project: baselineProject, log: () => {} });
  assert.deepEqual(
    fs.readFileSync(built.romPath),
    fs.readFileSync(baselineBuilt.romPath),
    'the full ROM must be byte-identical to a build using the pre-slice-7a (506a8ea) engine sources'
  );
});

test('byte-identity: a non-streamed project assembles a byte-identical ROM to a build without the dialogue-mapper code (streamworld.asm not assembled at all)', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({});
  for (const map of project.maps) map.streamed = false;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlgmapper-noStream-'));
  const baselineDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworlddlgmapper-noStream-baseline-'));
  t.after(() => Promise.all([dir, baselineDir].map((d) => fs.promises.rm(d, { recursive: true, force: true }))));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const symbols = fs.readFileSync(built.symbolPath, 'utf8');
  assert.ok(!/^sw_dlg_mapper_start\s*=/m.test(symbols), 'a non-streamed project must not assemble engine/streamworld.asm at all');

  const baselineProject = structuredClone(project);
  baselineProject.code = { overrides: dialogueMapperBaselineOverrides(), files: [] };
  await saveProject(baselineDir, baselineProject);
  const baselineBuilt = await buildProject({ dir: baselineDir, project: baselineProject, log: () => {} });
  assert.deepEqual(
    fs.readFileSync(built.romPath),
    fs.readFileSync(baselineBuilt.romPath),
    'the full ROM must be byte-identical to a build using the pre-slice-7a (506a8ea) engine sources'
  );
});
