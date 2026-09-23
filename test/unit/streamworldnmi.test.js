// Large streamed worlds (ROADMAP item 15), phase 2 slice 4a: the NMI arbitration splice
// (engine/boot.asm's nmi_vram_dispatch..nmi_scroll span) and the strip drawer it now shares a
// vblank with (engine/streamworld.asm's sw_nmi_stream/sw_nmi_stream_reduced/sw_ns_draw_block).
//
// Same convention as the sibling streamworldprojection.test.js: every routine here has zero
// production callers yet (nothing arms a strip until phase 2 slice 4b's movement driver exists),
// so every test drives the real splice/routines directly -- through a real armed strip
// (sw_stream_start_col/_row) and/or a real vram_buf packet (vram_open/vram_push/vram_end), never
// synthetic samples -- and asserts against an independently reimplemented oracle of the
// documented contract (this file's simulateColumnStrip/simulateRowStrip/torusPosition), not a
// copy of the assembly.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { generateAssets, planStreamedRegions } from '../../main/build/generate.js';
import { resolveMapper } from '../../shared/cartridge.js';
import { streamRegionsPerRow } from '../../shared/streamlayout.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { callRoutine } from '../lib/callroutine.js';
import NES from '../../renderer/emulator/core/nes.js';

// engine/constants.asm -- hardcoded per CLAUDE.md's own rule (a test that reads the file it is
// checking proves nothing). The same $05A0-$05FE mainline chain streamworldresident.test.js's own
// RAM map already pins.
const RAM = {
  sw_col: 0x05a0, sw_row: 0x05a1, sw_col_region: 0x05a3,
  sw_col_byte_lo: 0x05a4, sw_col_byte_hi: 0x05a5, sw_row_bank_base: 0x05a6,
  sw_base_bank: 0x05a7, sw_regions_per_row: 0x05a8, sw_grid_w: 0x05a9, sw_grid_h: 0x05aa,
  sw_tmp2: 0x05ac, sw_tmp4: 0x05ae, sw_tmp5: 0x05af, sw_tmp6: 0x05b0,
  win_col_screen: 0x05b1, win_col_local: 0x05b2, win_row_screen: 0x05b3, win_row_local: 0x05b4,
  st_active: 0x05b5, st_cur: 0x05b6, st_len: 0x05b7, st_ftile: 0x05b8, st_fnt: 0x05b9,
  st_vary: 0x05ba,
  sbuf: 0x05bc, // @size=32
  sw_fill_metatile_id: 0x05fd
};
const MAPPER_SHADOW = 0x35;
const VRAM_LEN = 0x3c;
const VRAM_READY = 0x3f;

/** The project's own deterministic terrain formula (test/lib/streamedproject.js), restated
 * independently -- identical to streamworldresident.test.js's own oracle of the same name. */
function expectedMetatileId(screenCol, screenRow, localCol, localRow) {
  const i = localRow * 16 + localCol;
  if (i >= 80) return 0;
  return 1 + ((screenCol + screenRow + i) % 3);
}

/** markMetatiles: gives each of the 4 metatiles the SAME distinct per-quadrant tile ids
 * streamworldresident.test.js's own markMetatiles does -- metatile id*4 + quadrant (0=TL, 1=TR,
 * 2=BL, 3=BR), so a block's own four drawn tile ids alone identify which metatile id it drew. */
function markMetatiles(project) {
  for (let id = 0; id < 4; id++) {
    project.metatiles[id].tiles = [id * 4, id * 4 + 1, id * 4 + 2, id * 4 + 3];
    project.metatiles[id].palette = id;
  }
}

/**
 * torusPosition: sw_ns_draw_block's own documented split (engine/streamworld.asm, "physical row
 * 15 / column 16 boundary"), reimplemented from its header comment and its two arms
 * (sw_ndb_col_top/row_left vs. the st_vary>=15/16 arms), not copied from the opcodes: a column
 * strip (st_active==1) holds col fixed at st_ftile and derives row/nt from st_vary; a row strip
 * (st_active==2) holds row fixed and derives col/nt from st_vary.
 */
function torusPosition(stActive, stFtile, stFnt, stVary) {
  if (stActive === 1) {
    const col = stFtile;
    if (stVary < 15) return { row: stVary * 2, col, nt: stFnt };
    return { row: (stVary - 15) * 2, col, nt: stFnt + 8 };
  }
  const row = stFtile;
  if (stVary < 16) return { row, col: stVary * 2, nt: stFnt };
  return { row, col: (stVary - 16) * 2, nt: stFnt + 4 };
}

/** Reads the four tiles one metatile block actually landed, via the SAME
 * `nes.ppu.nameTable[nes.ppu.ntable1[nt]]` technique streamworldresident.test.js's own
 * sw_render_window test already establishes and validates (nt/4 selects which of the 4 physical
 * nametables; row/col are tile-granular indices within it). */
function readTorusTiles(nes, stActive, stFtile, stFnt, stVary) {
  const { row, col, nt } = torusPosition(stActive, stFtile, stFnt, stVary);
  const table = nes.ppu.nameTable[nes.ppu.ntable1[nt >> 2]];
  return {
    tl: table.tile[row * 32 + col],
    tr: table.tile[row * 32 + col + 1],
    bl: table.tile[(row + 1) * 32 + col],
    br: table.tile[(row + 1) * 32 + col + 1]
  };
}

/**
 * simulateColumnStrip: sw_stream_start_col's own documented contract, reimplemented from its
 * header comment and its store-then-advance loop order (engine/streamworld.asm) -- st_ftile/
 * st_fnt/the starting st_vary from the design's own parity rule, and sbuf[i] from the window's
 * current row range, falling to fillMetatileId past either grid edge (the SAME unsigned
 * fill-aware bounds check sw_terrain_or_fill uses).
 */
function simulateColumnStrip({ screenCol, localCol, winRowScreen, winRowLocal, gridW, gridH, fillMetatileId }) {
  const stFtile = localCol * 2;
  const stFnt = (screenCol & 1) * 4;
  const stVaryStart = winRowLocal + (winRowScreen & 1 ? 15 : 0);
  const sbuf = [];
  let probeRowScreen = winRowScreen;
  let probeRowLocal = winRowLocal;
  for (let i = 0; i < 30; i++) {
    const id = screenCol >= gridW || probeRowScreen >= gridH
      ? fillMetatileId
      : expectedMetatileId(screenCol, probeRowScreen, localCol, probeRowLocal);
    sbuf.push(id);
    probeRowLocal++;
    if (probeRowLocal === 15) {
      probeRowLocal = 0;
      probeRowScreen++;
    }
  }
  return { stFtile, stFnt, stVaryStart, sbuf };
}

/** simulateRowStrip: sw_stream_start_row's own mirror of the column arm's shape exactly (mod 32,
 * st_ftile=localRow*2, st_fnt=(screenRow&1)*8, +16 offset, probeColLocal wraps at 16). */
function simulateRowStrip({ screenRow, localRow, winColScreen, winColLocal, gridW, gridH, fillMetatileId }) {
  const stFtile = localRow * 2;
  const stFnt = (screenRow & 1) * 8;
  const stVaryStart = winColLocal + (winColScreen & 1 ? 16 : 0);
  const sbuf = [];
  let probeColScreen = winColScreen;
  let probeColLocal = winColLocal;
  for (let i = 0; i < 32; i++) {
    const id = screenRow >= gridH || probeColScreen >= gridW
      ? fillMetatileId
      : expectedMetatileId(probeColScreen, screenRow, probeColLocal, localRow);
    sbuf.push(id);
    probeColLocal++;
    if (probeColLocal === 16) {
      probeColLocal = 0;
      probeColScreen++;
    }
  }
  return { stFtile, stFnt, stVaryStart, sbuf };
}

/** A strip's own st_vary value at block i, wrapped at 30 (column) or 32 (row) -- sw_nmi_stream's
 * own wrap branch, exercised for real only when the starting st_vary is non-zero. */
function varyAt(stVaryStart, i, modulus) {
  return (stVaryStart + i) % modulus;
}

async function buildHarness(t, opts = {}) {
  const project = createStreamedProject(opts);
  markMetatiles(project);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworldnmi-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const symbols = fs.readFileSync(built.symbolPath, 'utf8');
  const addrOf = (label) => {
    const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
    assert.ok(m, `${label} should be a named symbol in game.fns`);
    return parseInt(m[1], 16);
  };
  const mapper = resolveMapper(project.cartridge.mapper);
  const plan = planStreamedRegions(project, mapper);
  const streamedMap = project.maps.find((m) => m.streamed === true);
  const bytes = new Uint8Array(fs.readFileSync(built.romPath));
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(bytes);
  const mem = nes.cpu.mem;

  // Power-on RAM is $FF, not zero (streamworldresident.test.js's own buildStreaming makes the
  // same point) -- mapper_shadow needs a sane starting value before any bank switch.
  mem[MAPPER_SHADOW] = 0;
  mem[RAM.sw_base_bank] = plan.baseBanks[0];
  mem[RAM.sw_regions_per_row] = streamRegionsPerRow(streamedMap.gridW);
  mem[RAM.sw_grid_w] = streamedMap.gridW;
  mem[RAM.sw_grid_h] = streamedMap.gridH;
  mem[RAM.sw_fill_metatile_id] = streamedMap.fillMetatileId ?? 0;

  // sw_locate_current (called at the end of both sw_stream_start_col/_row, to restore the current
  // player screen) reads back sw_col_region/sw_row_bank_base/sw_col_byte_lo/hi as persistent
  // fields slice 2b's own navigation code would normally keep current. Stand in for that with the
  // SAME sw_goto(0,0) + copy technique streamworldresident.test.js's own sw_peek_byte test
  // establishes, so this harness never leaves those fields at their power-on $FF garbage.
  const swGoto = addrOf('sw_goto');
  nes.cpu.REG_ACC = 0;
  nes.cpu.REG_X = 0;
  callRoutine(nes, swGoto);
  mem[RAM.sw_col_region] = mem[RAM.sw_tmp2];
  mem[RAM.sw_row_bank_base] = mem[RAM.sw_tmp4];
  mem[RAM.sw_col_byte_lo] = mem[RAM.sw_tmp5];
  mem[RAM.sw_col_byte_hi] = mem[RAM.sw_tmp6];
  mem[RAM.sw_col] = 0;
  mem[RAM.sw_row] = 0;

  return { project, addrOf, nes, mem, streamedMap };
}

/** Steps the CPU instruction-by-instruction from startAddr to stopAddr, the identical direct-
 * injection technique streamworldprojection.test.js's own "publication coherence" test (case 6)
 * establishes for isolating exactly one interrupt segment with no mainline code running at all:
 * NMI generation disabled, PC parked one byte before startAddr, looped until it reaches stopAddr.
 * Forces blank ($2001=0) first -- required before any mid-frame $2006/$2007 write, the same trap
 * streamworldresident.test.js's own callRoutineLong documents. */
function runNmiSegment(nes, startAddr, stopAddr, maxSteps = 200000) {
  nes.mmap.write(0x2000, 0);
  nes.mmap.write(0x2001, 0);
  nes.cpu.irqRequested = false;
  nes.cpu.F_INTERRUPT = 1;
  nes.cpu.REG_PC = startAddr - 1;
  let steps = 0;
  while (nes.cpu.REG_PC + 1 !== stopAddr) {
    nes.cpu.emulate();
    assert.ok(++steps < maxSteps, 'nmi segment never reached its stop label');
  }
}

function queuePacket(nes, mem, addrOf, { addr, payload }) {
  const vramOpen = addrOf('vram_open');
  const vramPush = addrOf('vram_push');
  const vramEnd = addrOf('vram_end');
  nes.cpu.REG_ACC = (addr >> 8) & 0xff;
  nes.cpu.REG_Y = addr & 0xff;
  callRoutine(nes, vramOpen);
  for (const b of payload) {
    nes.cpu.REG_ACC = b;
    callRoutine(nes, vramPush);
  }
  callRoutine(nes, vramEnd);
}

function ppuAddrFor(physicalNt, offset) {
  return 0x2000 + physicalNt * 0x400 + offset;
}

test('nmi 7: idle (st_active=0) -- N interrupt segments touch no nametable byte, st_cur/st_vary/st_active all stay exactly as primed -- catches draining without checking the flag', async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  const nmiVramDispatch = addrOf('nmi_vram_dispatch');
  const nmiScrollDone = addrOf('nmi_scroll_done');

  mem[RAM.st_active] = 0;
  mem[RAM.st_cur] = 7;
  mem[RAM.st_vary] = 11;
  mem[RAM.st_ftile] = 4;
  mem[RAM.st_fnt] = 8;
  mem[VRAM_READY] = 0;

  // A sentinel block, at a torus position this idle strip would draw if the flag were ignored --
  // primed directly into VRAM via the routine under test's own sibling (a real drawn block), then
  // never touched again if st_active is truly honoured.
  const before = readTorusTiles(nes, 1, mem[RAM.st_ftile], mem[RAM.st_fnt], mem[RAM.st_vary]);

  for (let frame = 0; frame < 5; frame++) {
    runNmiSegment(nes, nmiVramDispatch, nmiScrollDone);
  }

  assert.equal(mem[RAM.st_active], 0, 'st_active must stay clear');
  assert.equal(mem[RAM.st_cur], 7, 'st_cur must be untouched while idle');
  assert.equal(mem[RAM.st_vary], 11, 'st_vary must be untouched while idle');
  const after = readTorusTiles(nes, 1, mem[RAM.st_ftile], mem[RAM.st_fnt], mem[RAM.st_vary]);
  assert.deepEqual(after, before, 'no nametable byte at the strip`s own next torus position may change while idle');
});

test('nmi 8a: strip-only (column) -- a real sw_stream_start_col arms a genuinely populated sbuf; each interrupt segment draws exactly SW_STREAM_CHUNK (3) blocks at their independently computed torus addresses, st_vary wraps at 30, st_active clears exactly when st_cur==st_len -- catches chunk 4, no wrap, no completion', async (t) => {
  const { addrOf, nes, mem, streamedMap } = await buildHarness(t);
  const swStreamStartCol = addrOf('sw_stream_start_col');
  const nmiVramDispatch = addrOf('nmi_vram_dispatch');
  const nmiScrollDone = addrOf('nmi_scroll_done');

  const screenCol = 2;
  const localCol = 0;
  // A non-zero starting local row -- win_row_local=10 -- so the strip's own st_vary genuinely
  // wraps mid-strip (at block 20, st_vary 29->0) rather than degenerately tracking st_cur 1:1 the
  // way a zero start would.
  const winRowScreen = 0;
  const winRowLocal = 10;
  mem[RAM.win_row_screen] = winRowScreen;
  mem[RAM.win_row_local] = winRowLocal;

  const sim = simulateColumnStrip({
    screenCol, localCol, winRowScreen, winRowLocal,
    gridW: streamedMap.gridW, gridH: streamedMap.gridH, fillMetatileId: streamedMap.fillMetatileId ?? 0
  });

  nes.cpu.REG_ACC = screenCol;
  nes.cpu.REG_X = localCol;
  callRoutine(nes, swStreamStartCol);

  assert.equal(mem[RAM.st_active], 1);
  assert.equal(mem[RAM.st_len], 30);
  assert.equal(mem[RAM.st_cur], 0);
  assert.equal(mem[RAM.st_ftile], sim.stFtile);
  assert.equal(mem[RAM.st_fnt], sim.stFnt);
  assert.equal(mem[RAM.st_vary], sim.stVaryStart);
  for (let i = 0; i < 30; i++) assert.equal(mem[RAM.sbuf + i], sim.sbuf[i], `sbuf[${i}] must be this screen's own real terrain (or the fill id past the grid edge)`);

  mem[VRAM_READY] = 0;
  let cur = 0;
  let frames = 0;
  while (mem[RAM.st_active] !== 0) {
    runNmiSegment(nes, nmiVramDispatch, nmiScrollDone);
    frames++;
    const blocksThisFrame = Math.min(3, 30 - cur);
    for (let k = 0; k < blocksThisFrame; k++) {
      const i = cur + k;
      const vary = varyAt(sim.stVaryStart, i, 30);
      const got = readTorusTiles(nes, 1, sim.stFtile, sim.stFnt, vary);
      const id = sim.sbuf[i];
      assert.equal(got.tl, id * 4 + 0, `block ${i} (vary ${vary}) top-left tile`);
      assert.equal(got.tr, id * 4 + 1, `block ${i} (vary ${vary}) top-right tile`);
      assert.equal(got.bl, id * 4 + 2, `block ${i} (vary ${vary}) bottom-left tile`);
      assert.equal(got.br, id * 4 + 3, `block ${i} (vary ${vary}) bottom-right tile`);
    }
    cur += blocksThisFrame;
    assert.equal(mem[RAM.st_cur], cur, `st_cur after frame ${frames} (ending at block ${cur})`);
    if (cur < 30) {
      const expectedVary = varyAt(sim.stVaryStart, cur, 30);
      assert.equal(mem[RAM.st_vary], expectedVary, `st_vary must be the wrapped value at block ${cur}, not a raw unwrapped count`);
    }
    assert.ok(frames < 20, 'the strip never completed');
  }
  assert.equal(cur, 30, 'every block must have been drawn exactly once');
  assert.equal(frames, 10, 'SW_STREAM_CHUNK=3 over 30 blocks must take exactly 10 frames');
  assert.equal(mem[RAM.st_active], 0, 'st_active must clear exactly when st_cur reaches st_len');
});

test('nmi 8b: strip-only (row) -- the mirror of 8a on the row axis (sw_stream_start_row, mod 32, SW_STREAM_CHUNK over 32 blocks)', async (t) => {
  const { addrOf, nes, mem, streamedMap } = await buildHarness(t);
  const swStreamStartRow = addrOf('sw_stream_start_row');
  const nmiVramDispatch = addrOf('nmi_vram_dispatch');
  const nmiScrollDone = addrOf('nmi_scroll_done');

  const screenRow = 1;
  const localRow = 0;
  const winColScreen = 0;
  // A non-zero starting local col, past the mod-32 wrap point (>=16 forces the +16 nt offset
  // branch AND a genuine wrap partway through), the row-axis analogue of 8a's win_row_local=10.
  const winColLocal = 20;
  mem[RAM.win_col_screen] = winColScreen;
  mem[RAM.win_col_local] = winColLocal;

  const sim = simulateRowStrip({
    screenRow, localRow, winColScreen, winColLocal,
    gridW: streamedMap.gridW, gridH: streamedMap.gridH, fillMetatileId: streamedMap.fillMetatileId ?? 0
  });

  nes.cpu.REG_ACC = screenRow;
  nes.cpu.REG_X = localRow;
  callRoutine(nes, swStreamStartRow);

  assert.equal(mem[RAM.st_active], 2);
  assert.equal(mem[RAM.st_len], 32);
  assert.equal(mem[RAM.st_cur], 0);
  assert.equal(mem[RAM.st_ftile], sim.stFtile);
  assert.equal(mem[RAM.st_fnt], sim.stFnt);
  assert.equal(mem[RAM.st_vary], sim.stVaryStart);
  for (let i = 0; i < 32; i++) assert.equal(mem[RAM.sbuf + i], sim.sbuf[i], `sbuf[${i}]`);

  mem[VRAM_READY] = 0;
  let cur = 0;
  let frames = 0;
  while (mem[RAM.st_active] !== 0) {
    runNmiSegment(nes, nmiVramDispatch, nmiScrollDone);
    frames++;
    const blocksThisFrame = Math.min(3, 32 - cur);
    for (let k = 0; k < blocksThisFrame; k++) {
      const i = cur + k;
      const vary = varyAt(sim.stVaryStart, i, 32);
      const got = readTorusTiles(nes, 2, sim.stFtile, sim.stFnt, vary);
      const id = sim.sbuf[i];
      assert.equal(got.tl, id * 4 + 0, `block ${i} (vary ${vary}) top-left tile`);
      assert.equal(got.tr, id * 4 + 1, `block ${i} (vary ${vary}) top-right tile`);
      assert.equal(got.bl, id * 4 + 2, `block ${i} (vary ${vary}) bottom-left tile`);
      assert.equal(got.br, id * 4 + 3, `block ${i} (vary ${vary}) bottom-right tile`);
    }
    cur += blocksThisFrame;
    assert.equal(mem[RAM.st_cur], cur, `st_cur after frame ${frames}`);
    if (cur < 32) {
      const expectedVary = varyAt(sim.stVaryStart, cur, 32);
      assert.equal(mem[RAM.st_vary], expectedVary, `st_vary must wrap at 32 on the row axis`);
    }
    assert.ok(frames < 20, 'the strip never completed');
  }
  assert.equal(cur, 32);
  assert.equal(mem[RAM.st_active], 0);
});

test('nmi 9: mixed at/below threshold -- a real vram_buf packet at exactly vram_len 35 (and separately a minimal one, vram_len 4) drains AND advances the strip by exactly SW_STREAM_MIXED_CHUNK (2) blocks in the same interrupt segment -- catches exclusive-only, or mixed advancing chunk 3', async (t) => {
  for (const { label, payloadLen, physicalNt, offset } of [
    { label: 'at max threshold', payloadLen: 32, physicalNt: 1, offset: 100 }, // 3 (header) + 32 = 35
    { label: 'minimal packet', payloadLen: 1, physicalNt: 3, offset: 50 } // 3 (header) + 1 = 4
  ]) {
    {
      const { addrOf, nes, mem, streamedMap } = await buildHarness(t);
      const swStreamStartCol = addrOf('sw_stream_start_col');
      const nmiVramDispatch = addrOf('nmi_vram_dispatch');
      const nmiScrollDone = addrOf('nmi_scroll_done');

      const screenCol = 2;
      const localCol = 0;
      mem[RAM.win_row_screen] = 0;
      mem[RAM.win_row_local] = 0;
      const sim = simulateColumnStrip({
        screenCol, localCol, winRowScreen: 0, winRowLocal: 0,
        gridW: streamedMap.gridW, gridH: streamedMap.gridH, fillMetatileId: streamedMap.fillMetatileId ?? 0
      });
      nes.cpu.REG_ACC = screenCol;
      nes.cpu.REG_X = localCol;
      callRoutine(nes, swStreamStartCol);
      assert.equal(mem[RAM.st_active], 1);

      mem[VRAM_LEN] = 0;
      const target = ppuAddrFor(physicalNt, offset);
      const payload = Array.from({ length: payloadLen }, (_, i) => 0x10 + i);
      queuePacket(nes, mem, addrOf, { addr: target, payload });
      assert.equal(mem[VRAM_LEN], 3 + payloadLen, `sanity: the real vram_len this packet produces`);
      mem[VRAM_READY] = 1;

      runNmiSegment(nes, nmiVramDispatch, nmiScrollDone);

      assert.equal(mem[VRAM_READY], 0, `${label}: a drained packet must clear vram_ready`);
      assert.equal(mem[VRAM_LEN], 0, `${label}: a drained packet must clear vram_len`);
      const table = nes.ppu.nameTable[nes.ppu.ntable1[physicalNt]];
      for (let i = 0; i < payloadLen; i++) {
        assert.equal(table.tile[offset + i], payload[i], `${label}: payload byte ${i} must have landed at the queued address`);
      }

      assert.equal(mem[RAM.st_cur], 2, `${label}: a mixed vblank must advance exactly SW_STREAM_MIXED_CHUNK (2) blocks, not the compiled SW_STREAM_CHUNK (3)`);
      for (let i = 0; i < 2; i++) {
        const got = readTorusTiles(nes, 1, sim.stFtile, sim.stFnt, varyAt(sim.stVaryStart, i, 30));
        const id = sim.sbuf[i];
        assert.equal(got.tl, id * 4 + 0, `${label}: mixed block ${i} top-left tile`);
      }
    }
  }
});

test('nmi 10: above threshold -- a 36-byte vram_buf queue drains, but the strip advances zero blocks that frame; the following strip-only frame advances 3 again -- catches a bcc/bcs off-by-one on 35 vs 36', async (t) => {
  const { addrOf, nes, mem, streamedMap } = await buildHarness(t);
  const swStreamStartCol = addrOf('sw_stream_start_col');
  const nmiVramDispatch = addrOf('nmi_vram_dispatch');
  const nmiScrollDone = addrOf('nmi_scroll_done');

  const screenCol = 2;
  const localCol = 0;
  mem[RAM.win_row_screen] = 0;
  mem[RAM.win_row_local] = 0;
  const sim = simulateColumnStrip({
    screenCol, localCol, winRowScreen: 0, winRowLocal: 0,
    gridW: streamedMap.gridW, gridH: streamedMap.gridH, fillMetatileId: streamedMap.fillMetatileId ?? 0
  });
  nes.cpu.REG_ACC = screenCol;
  nes.cpu.REG_X = localCol;
  callRoutine(nes, swStreamStartCol);
  assert.equal(mem[RAM.st_active], 1);

  const before0 = readTorusTiles(nes, 1, sim.stFtile, sim.stFnt, varyAt(sim.stVaryStart, 0, 30));

  mem[VRAM_LEN] = 0;
  const physicalNt = 1;
  const offset = 300;
  const target = ppuAddrFor(physicalNt, offset);
  const payload = Array.from({ length: 33 }, (_, i) => 0x40 + i); // 3 (header) + 33 = 36
  queuePacket(nes, mem, addrOf, { addr: target, payload });
  assert.equal(mem[VRAM_LEN], 36, 'sanity: this queue must sit exactly one byte above MIXED_VBLANK_MAX_BYTES (35)');
  mem[VRAM_READY] = 1;

  runNmiSegment(nes, nmiVramDispatch, nmiScrollDone);

  assert.equal(mem[VRAM_READY], 0, 'the big queue must still drain');
  assert.equal(mem[VRAM_LEN], 0);
  const table = nes.ppu.nameTable[nes.ppu.ntable1[physicalNt]];
  for (let i = 0; i < payload.length; i++) assert.equal(table.tile[offset + i], payload[i], `payload byte ${i}`);

  assert.equal(mem[RAM.st_cur], 0, 'an above-threshold (exclusive) vblank must advance ZERO strip blocks');
  const after0 = readTorusTiles(nes, 1, sim.stFtile, sim.stFnt, varyAt(sim.stVaryStart, 0, 30));
  assert.deepEqual(after0, before0, 'block 0`s own torus tiles must be untouched by an exclusive-drain vblank');

  // The following frame: no new packet, vram_ready is naturally 0 -- the strip must advance a
  // full SW_STREAM_CHUNK (3) again, proving the exclusive frame only skipped the strip for its
  // own one vblank, not permanently.
  mem[VRAM_READY] = 0;
  runNmiSegment(nes, nmiVramDispatch, nmiScrollDone);
  assert.equal(mem[RAM.st_cur], 3, 'the next strip-only frame must advance SW_STREAM_CHUNK (3) again');
});

test('nmi 11: vram_drain runs exactly on ready frames -- a frame where vram_ready is already clear never re-drains vram_buf, even though the buffer still holds a replayable packet -- catches the nmi_no_drain arm calling vram_drain unconditionally', async (t) => {
  const { addrOf, nes, mem } = await buildHarness(t);
  const nmiVramDispatch = addrOf('nmi_vram_dispatch');
  const nmiScrollDone = addrOf('nmi_scroll_done');

  mem[RAM.st_active] = 0; // isolate the vram producer from the strip producer entirely
  mem[VRAM_LEN] = 0;

  const physicalNt = 1;
  const offset = 400;
  const target = ppuAddrFor(physicalNt, offset);
  const realPayload = [0x11, 0x22];
  queuePacket(nes, mem, addrOf, { addr: target, payload: realPayload });
  mem[VRAM_READY] = 1;

  runNmiSegment(nes, nmiVramDispatch, nmiScrollDone);
  assert.equal(mem[VRAM_READY], 0, 'the ready frame must drain (never zero on a ready frame)');
  const table = nes.ppu.nameTable[nes.ppu.ntable1[physicalNt]];
  assert.deepEqual([table.tile[offset], table.tile[offset + 1]], realPayload, 'the first drain must write the real payload');

  // vram_drain scans from vram_buf[0] until a $00 address-high terminator, never consulting
  // vram_len -- so a correct SECOND call would silently replay the SAME bytes (idempotent,
  // invisible). Mutate the payload bytes directly (leaving the header -- address and count --
  // exactly as vram_end wrote it, so the packet still LOOKS drainable) so a re-drain is
  // observable: it would overwrite the target with these new marker bytes.
  const packetPayloadOffset = 3; // this was the first (and only) packet queued into a freshly
                                   // zeroed buffer: header occupies vram_buf[0..2]
  mem[0x0400 + packetPayloadOffset] = 0xaa;
  mem[0x0400 + packetPayloadOffset + 1] = 0xbb;

  runNmiSegment(nes, nmiVramDispatch, nmiScrollDone);
  assert.equal(mem[VRAM_READY], 0, 'vram_ready stays clear (it was never raised again)');
  assert.deepEqual(
    [table.tile[offset], table.tile[offset + 1]],
    realPayload,
    'a not-ready frame must never drain again -- the target must still hold the FIRST drain`s real payload, not the marker bytes a second drain would have written'
  );
});

test('nmi 12: an ordinary (non-streamed) project reaches no sw_* symbol at all and assembles with STREAMING_ENABLED=0, so the whole mixed-threshold arm (including any MIXED_VBLANK_MAX_BYTES reference) is never assembled -- fixture hashes (handoff-next/fixture-hashes.mjs) are the proof that nmi:`s own bytes then stay byte-identical to before this slice', async (t) => {
  const { createProject } = await import('../../shared/project.js');
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworldnmi-ordinary-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = createProject('Ordinary', 'action');
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const symbols = fs.readFileSync(built.symbolPath, 'utf8');
  assert.doesNotMatch(symbols, /^sw_[a-z]/m, 'an ordinary project must reach no sw_* label at all -- the whole streamworld.asm `.if STREAMING_ENABLED` body assembled out');

  const configText = fs.readFileSync(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8');
  assert.match(configText, /^STREAMING_ENABLED = 0$/m, 'an ordinary project must assemble with STREAMING_ENABLED=0');
});
