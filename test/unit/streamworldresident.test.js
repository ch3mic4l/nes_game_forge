// Large streamed worlds (ROADMAP item 15), phase 2 slice 2a: the resident set migrated into
// engine/streamworld.asm has no real call site yet (that is slice 2b onward), so every test here
// drives one routine in isolation with test/lib/callroutine.js's stub -- the identical technique
// camera.test.js's own phase 1 already established ("nothing here drives those commands through
// real gameplay except where a test says so -- every other assertion pokes the RAM the resulting
// code reads instead, since nothing in phase 1 has a consumer that could trigger it for real").
//
// Everything here builds its own project via test/lib/streamedproject.js rather than touching a
// checked-in fixture, and passes bypassStreamedRefusal so buildProject will assemble a streamed
// project at all -- the one seam main/build/pipeline.js threads for exactly this purpose.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saveProject, loadProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { generateAssets, planStreamedRegions } from '../../main/build/generate.js';
import { emitStreamedLayout } from '../../main/build/streamed.js';
import { resolveMapper, prgLayout } from '../../shared/cartridge.js';
import { streamRegionsPerRow } from '../../shared/streamlayout.js';
import NES from '../../renderer/emulator/core/nes.js';
import { callRoutine } from '../lib/callroutine.js';
import { createStreamedProject, canonicalJSON } from '../lib/streamedproject.js';
import { decodeStreamedLayout } from '../lib/streamdecoder.js';
import { scanEquates, resolveEquates } from '../lib/equates.js';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// engine/constants.asm -- every byte this slice (phase 2 slice 2a) allocated fresh. Hardcoded
// per CLAUDE.md's own rule: a test that reads the file it is checking proves nothing.
const RAM = {
  // map_is_streamed -- from engine/constants.asm:585. Allocated, not written -- 2b's resolver is
  // the first writer.
  map_is_streamed: 0xfe,
  // sw_nmi_stream's own NMI-private scratch, twelve bytes.
  sw_ns_row: 0xbb, sw_ns_col: 0xbc, sw_ns_nt: 0xbd, sw_ns_q: 0xbe, sw_ns_pb: 0xbf,
  sw_ns_cm: 0xc0, sw_ns_ai: 0xc1, sw_ns_row_lo: 0xc2, sw_ns_row_hi: 0xc3,
  sw_rw_shadow_lo: 0xc4, sw_rw_shadow_hi: 0xc5, sw_ns_chunk: 0xc6,
  // sw_project_axis's own camera-origin state -- from engine/constants.asm:659-662.
  sw_cam_origin_x_lo: 0x035c, sw_cam_origin_x_hi: 0x035d,
  sw_cam_origin_y_lo: 0x035e, sw_cam_origin_y_hi: 0x035f,
  // sw_walk_step_x/y's own per-axis accumulators -- from engine/constants.asm:738-739.
  sw_walk_acc_x: 0x03d8, sw_walk_acc_y: 0x03d9,
  // The $05A0-$05FE mainline chain.
  sw_col: 0x05a0, sw_row: 0x05a1, sw_col_rem: 0x05a2, sw_col_region: 0x05a3,
  sw_col_byte_lo: 0x05a4, sw_col_byte_hi: 0x05a5, sw_row_bank_base: 0x05a6,
  sw_base_bank: 0x05a7, sw_regions_per_row: 0x05a8, sw_grid_w: 0x05a9, sw_grid_h: 0x05aa,
  sw_tmp: 0x05ab, sw_tmp2: 0x05ac, sw_tmp3: 0x05ad, sw_tmp4: 0x05ae, sw_tmp5: 0x05af, sw_tmp6: 0x05b0,
  win_col_screen: 0x05b1, win_col_local: 0x05b2, win_row_screen: 0x05b3, win_row_local: 0x05b4,
  // Streaming state + entering-edge buffer -- from engine/constants.asm:983-991.
  st_active: 0x05b5, st_cur: 0x05b6, st_len: 0x05b7, st_ftile: 0x05b8, st_fnt: 0x05b9,
  st_vary: 0x05ba, ss_i: 0x05bb,
  sbuf: 0x05bc, // @size=32
  sw_ss_sc: 0x05dc, sw_ss_lc: 0x05dd, sw_ss_sr: 0x05de, sw_ss_lr: 0x05df,
  sw_probe_col_screen: 0x05e0, sw_probe_col_local: 0x05e1, sw_probe_row_screen: 0x05e2, sw_probe_row_local: 0x05e3,
  sw_last_screen_col: 0x05e4, sw_last_screen_row: 0x05e5,
  sw_rw_nt: 0x05e6, sw_rw_row: 0x05e7, sw_rw_col: 0x05e8, sw_rw_base_col: 0x05e9, sw_rw_base_row: 0x05ea,
  sw_rw_offset: 0x05eb, sw_rw_arow: 0x05ec, sw_rw_acol: 0x05ed, sw_rw_tmp: 0x05ee, sw_rw_tmp2: 0x05ef,
  sw_rw_wbase_col: 0x05f0, sw_rw_wbase_row: 0x05f1,
  sw_caller_bank: 0x05f2, sw_run_off: 0x05f3, sw_run_len: 0x05f4,
  sw_run_buf: 0x05f5, // @size=8
  sw_fill_metatile_id: 0x05fd, sw_rw_oob: 0x05fe,
  attr_shadow: 0x0600 // @size=256, overlaps flash_driver's own 160 bytes on purpose
};
const MAPPER_SHADOW = 0x35; // engine/constants.asm, pre-existing (phase < 2a)

// A local (not rammap.test.js's global) non-overlap check, scoped to exactly what this slice
// allocated fresh -- rammap.test.js's own sweep already covers the whole map, including the one
// documented exception (attr_shadow/flash_driver); this one has nothing to carve out because
// flash_driver is not one of its entries at all.
function sizeOf(name) {
  if (name === 'sbuf') return 32;
  if (name === 'sw_run_buf') return 8;
  if (name === 'attr_shadow') return 256;
  return 1;
}

const isRamName = (name) => /^[a-z]/.test(name) || name === 'OAM';

/**
 * Builds a plain (non-streamed) RPG project -- these RAM addresses are plain equates in
 * engine/constants.asm, never gated behind `.if STREAMING_ENABLED` (only the resident CODE in
 * engine/streamworld.asm is), so an ordinary build already assembles every one of them.
 */
async function buildForRamCheck(t) {
  const { createProject } = await import('../../shared/project.js');
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworld-rammap-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = createProject('RAM Check', 'rpg');
  await saveProject(dir, project);
  await buildProject({ dir, project, log: () => {} });
  const constantsText = fs.readFileSync(path.join(dir, 'build', 'constants.asm'), 'utf8');
  const configText = fs.readFileSync(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8');
  const pending = new Map();
  scanEquates(constantsText, pending);
  scanEquates(configText, pending);
  const symbols = new Map();
  resolveEquates(pending, symbols);
  const sizeAnnotations = new Map();
  for (const line of constantsText.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=.*@size=([A-Za-z0-9_]+)/);
    if (m) sizeAnnotations.set(m[1], m[2]);
  }
  const resolveSize = (name) => {
    const token = sizeAnnotations.get(name);
    if (token === undefined) return 1;
    return /^\d+$/.test(token) ? parseInt(token, 10) : symbols.get(token);
  };
  return { symbols, resolveSize };
}

test('phase 2 slice 2a resident RAM: every allocation is at the address and size the BUILT engine/constants.asm actually says, and collides with nothing else in the engine', async (t) => {
  const { symbols, resolveSize } = await buildForRamCheck(t);

  // Every entry in RAM (hardcoded above, per CLAUDE.md's own "a test that reads the file it is
  // checking proves nothing") must be exactly what the real build resolves it to -- address AND
  // size, not the address alone this test used to trust from its own literal.
  for (const [name, expectedAddr] of Object.entries(RAM)) {
    const real = symbols.get(name);
    assert.equal(
      real,
      expectedAddr,
      `${name} (from engine/constants.asm) resolved to ${real === undefined ? 'nothing' : `$${real.toString(16)}`}, this file expects $${expectedAddr.toString(16)}`
    );
    assert.equal(
      resolveSize(name),
      sizeOf(name),
      `${name}'s own @size annotation in engine/constants.asm no longer matches this file's sizeOf(${name}) = ${sizeOf(name)}`
    );
  }

  // Compared against ALL RAM allocations in the engine, not just this slice's own fresh set:
  // rammap.test.js already sweeps the whole map globally, but this test is scoped to exactly what
  // phase 2 slice 2a allocated, so it re-derives the full interval list independently rather than
  // trusting that sweep ran first.
  const all = [];
  for (const [name, addr] of symbols) {
    if (!isRamName(name)) continue;
    all.push({ name, start: addr, end: addr + resolveSize(name) - 1 });
  }
  const own = new Set(Object.keys(RAM));
  for (const name of own) {
    const start = RAM[name];
    const end = start + sizeOf(name) - 1;
    for (const other of all) {
      if (own.has(other.name)) continue; // this slice's own internal overlaps, checked below
      if (name === 'attr_shadow' && other.name === 'flash_driver') continue; // documented partial overlap -- its own dedicated test, next
      assert.ok(
        end < other.start || start > other.end,
        `${name} ($${start.toString(16)}-$${end.toString(16)}) overlaps ${other.name} ` +
          `($${other.start.toString(16)}-$${other.end.toString(16)}), an allocation outside this slice's own fresh set`
      );
    }
  }

  // Internal overlap among this slice's own fresh allocations.
  const entries = Object.entries(RAM).map(([name, start]) => ({ name, start, end: start + sizeOf(name) - 1 }));
  entries.sort((a, b) => a.start - b.start);
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const cur = entries[i];
    assert.ok(
      prev.end < cur.start,
      `${prev.name} ($${prev.start.toString(16)}-$${prev.end.toString(16)}) overlaps ${cur.name} ($${cur.start.toString(16)}-$${cur.end.toString(16)})`
    );
  }
  // The two documented byte counts from constants.asm's own comments.
  assert.equal(RAM.sw_ns_chunk - RAM.sw_ns_row + 1, 12, 'the NMI scratch block is twelve bytes');
  assert.equal(RAM.sw_rw_oob - RAM.sw_col + 1, 95, 'the $05A0-$05FE mainline chain is 95 bytes');
});

test('attr_shadow (256 bytes) and flash_driver (160 bytes) intersect on exactly flash_driver\'s own 160 bytes, and nothing else overlaps either', async (t) => {
  const { symbols, resolveSize } = await buildForRamCheck(t);
  const attrShadow = { start: symbols.get('attr_shadow'), size: resolveSize('attr_shadow') };
  const flashDriver = { start: symbols.get('flash_driver'), size: resolveSize('flash_driver') };
  assert.equal(attrShadow.start, 0x0600, 'attr_shadow (from engine/constants.asm)');
  assert.equal(attrShadow.size, 256, "attr_shadow's own @size (from engine/constants.asm)");
  assert.equal(flashDriver.start, 0x0600, 'flash_driver (from engine/constants.asm)');
  assert.equal(flashDriver.size, 160, "flash_driver's own @size=FLASH_DRIVER_MAX (from engine/constants.asm)");

  // Same start address, and flash_driver's whole 160 bytes fall inside attr_shadow's 256 -- the
  // exact intersection the documented partial overlap describes, not a coincidental byte range.
  const intersectionStart = Math.max(attrShadow.start, flashDriver.start);
  const intersectionEnd = Math.min(attrShadow.start + attrShadow.size - 1, flashDriver.start + flashDriver.size - 1);
  assert.equal(intersectionEnd - intersectionStart + 1, 160, 'attr_shadow and flash_driver must intersect on exactly 160 bytes');

  const all = [];
  for (const [name, addr] of symbols) {
    if (!isRamName(name)) continue;
    if (name === 'attr_shadow' || name === 'flash_driver') continue;
    all.push({ name, start: addr, end: addr + resolveSize(name) - 1 });
  }
  for (const { start, size, label } of [
    { start: attrShadow.start, size: attrShadow.size, label: 'attr_shadow' },
    { start: flashDriver.start, size: flashDriver.size, label: 'flash_driver' }
  ]) {
    const end = start + size - 1;
    for (const other of all) {
      assert.ok(
        end < other.start || start > other.end,
        `${label} ($${start.toString(16)}-$${end.toString(16)}) overlaps ${other.name} ($${other.start.toString(16)}-$${other.end.toString(16)})`
      );
    }
  }
});

/**
 * Every streamed metatile id this project's terrain ever places (0-3) gets distinguishable
 * tiles/palette data instead of createMetatile's uniform default ({tiles:[0,0,0,0], palette:0}
 * for every id) -- otherwise sw_render_window's output is the same $00/palette-0 bytes
 * regardless of which world position produced them, and a render test could not tell a correct
 * implementation from one that always reads metatile 0. tiles=[id*4+0, id*4+1, id*4+2, id*4+3]
 * (mt_tl/mt_tr/mt_bl/mt_br order, generate.js) gives each of a metatile's four quadrants its own
 * distinct id (fix round 1, finding 5: markMetatiles used to hand all four quadrants the SAME
 * tile, so a render bug that swapped tl/tr or bl/br could never show up in the nametable's own
 * tile bytes) -- see expectedTileId, above, for the matching oracle. palette=id (0-3, already
 * 2-bit-clean) does the same for the attribute table.
 */
function markMetatiles(project) {
  for (let id = 0; id < 4; id++) {
    project.metatiles[id].tiles = [id * 4, id * 4 + 1, id * 4 + 2, id * 4 + 3];
    project.metatiles[id].palette = id;
  }
}

async function buildStreaming(t, opts = {}) {
  const project = createStreamedProject(opts);
  markMetatiles(project);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworld-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {}, bypassStreamedRefusal: true });
  const symbols = fs.readFileSync(built.symbolPath, 'utf8');
  const addrOf = (label) => {
    const m = symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
    assert.ok(m, `${label} should be a named symbol in game.fns`);
    return parseInt(m[1], 16);
  };

  // No engine code loads the per-map locator (sw_base_bank/regions_per_row/grid_w/grid_h/
  // fill_metatile_id) into RAM yet -- that is the map-entry loader, phase 2 slice 2b's own scope,
  // not this slice's. Ask the real allocator instead: planStreamedRegions is the exact function
  // generate.js itself calls to get these numbers for the real build, so calling it here with the
  // same project and mapper is asking the single source of truth, not maintaining a second,
  // driftable copy of its arithmetic.
  const mapper = resolveMapper(project.cartridge.mapper);
  const plan = planStreamedRegions(project, mapper);
  assert.ok(plan.baseBanks, 'this project`s streamed map must fit on UNROM 512');
  const streamedMap = project.maps.find((m) => m.streamed === true);

  // engine/main.asm now really `.include`s assets/streamed_regions.inc (fix round 1, finding 1),
  // gated on STREAMING_ENABLED the same as streamworld.asm beside it -- so this project's terrain
  // is genuinely in the assembled ROM at the address prgLayout(mapper) says its nesasm bank
  // organizes to. Read it back from there (never write it) and decode it with
  // test/lib/streamdecoder.js, an independent reimplementation of the wire format, to prove the
  // assembler placed real, correct data -- not only that the generator's own JS-level bytes
  // (already pinned against the same decoder by test/unit/streamedlayout.test.js) look right.
  const layout = emitStreamedLayout(project, { baseBanks: plan.baseBanks });
  const layoutInfo = prgLayout(mapper);
  const bytes = new Uint8Array(fs.readFileSync(built.romPath));
  const regionOrg = (region) => {
    const r = layoutInfo.regions.find((x) => x.nesasmBank === region.region);
    assert.ok(r, `no switchable-window region for nesasm bank ${region.region}`);
    return r.org;
  };
  const assembledLayout = {
    ...layout,
    maps: layout.maps.map((map) => {
      if (!map.streamed) return map;
      return {
        ...map,
        regions: map.regions.map((region) => {
          const org = regionOrg(region);
          const fileOffset = 16 + layoutInfo.regions.find((x) => x.nesasmBank === region.region).prgBank * 16384 + (org - 0x8000);
          return { ...region, bytes: Array.from(bytes.slice(fileOffset, fileOffset + region.bytes.length)) };
        })
      };
    })
  };
  const decoded = decodeStreamedLayout(assembledLayout);
  const streamedMapIndex = project.maps.findIndex((m) => m.streamed === true);
  assert.ok(streamedMapIndex >= 0);
  for (let row = 0; row < streamedMap.gridH; row++) {
    for (let col = 0; col < streamedMap.gridW; col++) {
      const { terrain } = decoded.screen(streamedMapIndex, col, row);
      for (let i = 0; i < terrain.length; i++) {
        assert.equal(
          terrain[i],
          expectedMetatileId(col, row, i % 16, Math.floor(i / 16)),
          `assembled stream_region_* data: screen (${col},${row}) terrain[${i}]`
        );
      }
    }
  }
  for (const map of layout.maps) {
    if (!map.streamed) continue;
    for (const region of map.regions) {
      assert.equal(
        addrOf(`stream_region_${region.region}`),
        regionOrg(region),
        `stream_region_${region.region}'s own label must sit at generate.js's own computed origin`
      );
    }
  }

  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(bytes);
  const mem = nes.cpu.mem;

  // This core fills RAM with $FF at power-on (real NES RAM is likewise undefined, not zero) and
  // loadROM() never runs any boot code -- callRoutine's stub starts execution mid-air, so nothing
  // has ever given mapper_shadow its first real value. switch_prg_bank preserves mapper_shadow's
  // own upper three bits (CHR page + mirroring) across a PRG-only switch by design, so an
  // uninitialized $FF there leaks bit 7 into the very first register write a test makes, and
  // write_mapper_reg's own self-modifying trick only has 128 valid entries (banks.asm: "The
  // identity table is 128 bytes") -- a value with bit 7 set indexes off the end of it and writes
  // an unrelated byte to the hardware register instead. A real game's own boot code always sets
  // mapper_shadow to a sane starting value before any screen data is ever fetched; this line
  // stands in for that boot-time initialization, not a special allowance for the routines
  // themselves.
  mem[MAPPER_SHADOW] = 0;

  mem[RAM.sw_base_bank] = plan.baseBanks[0];
  mem[RAM.sw_regions_per_row] = streamRegionsPerRow(streamedMap.gridW);
  mem[RAM.sw_grid_w] = streamedMap.gridW;
  mem[RAM.sw_grid_h] = streamedMap.gridH;
  mem[RAM.sw_fill_metatile_id] = streamedMap.fillMetatileId ?? 0;

  return { project, dir, built, addrOf, nes };
}

/**
 * sw_render_window redraws four full 32x30 nametables plus their attribute tables in one call --
 * legitimately tens of thousands of 6502 steps, well past test/lib/callroutine.js's fixed 20000
 * budget (sized for a single short routine). Same stub technique, a step budget sized for this
 * one routine instead. sw_render_window's own header documents its precondition as the caller's,
 * not its own: it writes $2006/$2007 directly with no `sta $2001` of its own anywhere in the
 * routine (engine/streamworld.asm), so the caller must already have forced blank. Fix round 1,
 * finding 5: force it here explicitly rather than relying on whatever this core happens to
 * default $2001 to.
 */
function callRoutineLong(nes, address, maxSteps = 400000) {
  nes.mmap.write(0x2000, 0);
  nes.mmap.write(0x2001, 0); // forced blank -- required before any mid-frame $2006/$2007 write
  nes.cpu.irqRequested = false;
  nes.cpu.F_INTERRUPT = 1;
  nes.cpu.mem.set([0x20, address & 255, address >> 8, 0xea], 0x700);
  nes.cpu.REG_PC = 0x6ff;
  let steps = 0;
  while ((nes.cpu.REG_PC + 1) !== 0x703) {
    nes.cpu.emulate();
    assert.ok(++steps < maxSteps, 'routine never returned to the stub');
  }
}

/** The project's own deterministic terrain formula (test/lib/streamedproject.js), restated
 * independently (not imported) so this oracle cannot silently agree with a broken generator. Each
 * of a screen's first 80 bytes cycles through 1,2,3 offset by (screenCol+screenRow) -- fix round
 * 1, finding 5: byte-to-byte distinguishable, so a wrong run offset/length/screen shows up as a
 * wrong value instead of silently matching a flat repeated one. */
function expectedMetatileId(screenCol, screenRow, localCol, localRow) {
  const i = localRow * 16 + localCol;
  if (i >= 80) return 0; // screen.metatiles.length/3 = 240/3 = 80
  return 1 + ((screenCol + screenRow + i) % 3);
}

/** Quadrant order within one metatile's own `tiles` array (mt_tl/mt_tr/mt_bl/mt_br,
 * main/build/generate.js): 0=top-left, 1=top-right, 2=bottom-left, 3=bottom-right. */
function expectedTileId(metatileId, tileCol, tileRow) {
  const quadrant = (tileRow % 2) * 2 + (tileCol % 2);
  return metatileId * 4 + quadrant;
}

test('sw_read_run copies exactly its own run into sw_run_buf, leaves every other byte untouched (canaries both sides, sbuf, beyond-length), and restores the caller bank (CHR page included)', async (t) => {
  const { addrOf, nes } = await buildStreaming(t);
  const swReadRun = addrOf('sw_read_run');
  const writeMapperReg = addrOf('write_mapper_reg');
  const mem = nes.cpu.mem;

  // Screen (1, 0)'s own terrain, starting at offset 4 (inside the varied third: 4 < 80).
  const screenCol = 1;
  const screenRow = 0;
  const startOffset = 4;
  // A known "dirty" mapper register, the same rig the sw_read_transaction test below uses: CHR
  // page 2 (bits 6-5 = 10), mirroring bit (7) left at 0 so this project's own four-screen
  // mirroring is undisturbed, caller's own PRG bank = 5.
  const callerBank = 5;
  const dirty = 0x40 | callerBank;

  // fix round 1, finding 5: length 4 (the original case) AND 8 (sw_run_buf's own full capacity --
  // an off-by-one that only overruns at the buffer's own end would pass at length 4).
  for (const runLen of [4, 8]) {
    nes.cpu.REG_ACC = dirty;
    callRoutine(nes, writeMapperReg);
    assert.equal(mem[MAPPER_SHADOW], dirty, `run length ${runLen}: the real register write must land in mapper_shadow`);
    assert.equal(nes.mmap.chrPage, 2, `run length ${runLen}: the real register write must land in the mapper model too`);

    // sbuf (the incremental strip's own buffer): a wrong implementation reusing sbuf instead of
    // sw_run_buf would stomp this sentinel.
    for (let i = 0; i < 32; i++) mem[RAM.sbuf + i] = 0xaa;
    // sw_run_buf primed with a sentinel outside every real terrain byte's own 0-3 range, so any
    // survivor after the call proves the routine never reached that slot.
    for (let i = 0; i < 8; i++) mem[RAM.sw_run_buf + i] = 0xee;
    // The two real bytes immediately bracketing sw_run_buf double as canaries: sw_run_len ($05F4,
    // right before) is a real required input, so it is its own "must stay exactly runLen" canary;
    // sw_fill_metatile_id ($05FD, right after) gets an explicit sentinel sw_read_run has no
    // business touching.
    mem[RAM.sw_run_len] = runLen;
    mem[RAM.sw_fill_metatile_id] = 0x77;
    mem[RAM.sw_caller_bank] = callerBank;

    nes.cpu.REG_ACC = screenCol;
    nes.cpu.REG_X = screenRow;
    nes.cpu.REG_Y = startOffset;
    callRoutine(nes, swReadRun);

    for (let i = 0; i < runLen; i++) {
      const expected = expectedMetatileId(screenCol, screenRow, (startOffset + i) % 16, Math.floor((startOffset + i) / 16));
      assert.equal(mem[RAM.sw_run_buf + i], expected, `run length ${runLen}: sw_run_buf[${i}] should hold screen (1,0)'s own terrain byte`);
    }
    for (let i = runLen; i < 8; i++) {
      assert.equal(mem[RAM.sw_run_buf + i], 0xee, `run length ${runLen}: sw_run_buf[${i}] is beyond the requested length and must stay untouched`);
    }
    assert.equal(mem[RAM.sw_run_len], runLen, `run length ${runLen}: the byte immediately before sw_run_buf must stay untouched`);
    assert.equal(mem[RAM.sw_fill_metatile_id], 0x77, `run length ${runLen}: the byte immediately after sw_run_buf must stay untouched`);
    for (let i = 0; i < 32; i++) assert.equal(mem[RAM.sbuf + i], 0xaa, `run length ${runLen}: sbuf byte ${i} must be untouched by sw_read_run`);

    assert.equal(mem[MAPPER_SHADOW], dirty, `run length ${runLen}: mapper_shadow must be restored to the exact byte the caller had, CHR bits included`);
    assert.equal(nes.mmap.prgBank, callerBank, `run length ${runLen}: the real mapper model's own PRG bank must be back to the caller's`);
    assert.equal(nes.mmap.chrPage, 2, `run length ${runLen}: the real mapper model's own CHR page must be untouched by the round trip`);
  }
});

test('sw_peek_byte and sw_terrain_or_fill read a real screen and route an out-of-bounds probe to the fill metatile with no bank switch, restoring the current field screen exactly', async (t) => {
  const { addrOf, nes } = await buildStreaming(t);
  const swGoto = addrOf('sw_goto');
  const swTerrainOrFill = addrOf('sw_terrain_or_fill');
  const mem = nes.cpu.mem;

  // fix round 1, finding 5: establish a REAL current-field-screen locator/pointer state first.
  // The persistent sw_row_bank_base/sw_col_region/sw_col_byte_lo/sw_col_byte_hi fields
  // sw_locate_current reads back are normally kept current by the not-yet-written slice 2b
  // navigation code whenever the player's current screen changes; stand in for that here with the
  // SAME sw_goto the routines under test themselves call, at screen (0, 0), then copy ITS OWN
  // scratch results (sw_tmp2/sw_tmp4/sw_tmp5/sw_tmp6 -- col_region/row_bank_base/col_byte_lo/hi)
  // into those persistent fields, rather than a second, hand-derived copy of sw_goto's own region
  // arithmetic.
  const currentCol = 0;
  const currentRow = 0;
  nes.cpu.REG_ACC = currentCol;
  nes.cpu.REG_X = currentRow;
  callRoutine(nes, swGoto);
  mem[RAM.sw_col_region] = mem[RAM.sw_tmp2];
  mem[RAM.sw_row_bank_base] = mem[RAM.sw_tmp4];
  mem[RAM.sw_col_byte_lo] = mem[RAM.sw_tmp5];
  mem[RAM.sw_col_byte_hi] = mem[RAM.sw_tmp6];
  mem[RAM.sw_col] = currentCol;
  mem[RAM.sw_row] = currentRow;

  const MTPTR_LO = 0x02;
  const MTPTR_HI = 0x03;
  const currentMtptr = () => (mem[MTPTR_HI] << 8) | mem[MTPTR_LO];
  const snapshotWindow = () => {
    const base = currentMtptr();
    return Array.from({ length: 8 }, (_, i) => mem[base + i]);
  };
  const mtptrBefore = currentMtptr();
  const bankBefore = nes.mmap.prgBank;
  const windowBefore = snapshotWindow();
  // The real current screen's own terrain, read back via the pointer sw_goto just set up --
  // confirms the snapshot above is of screen (0,0)'s actual data, not stale RAM.
  for (let i = 0; i < 8; i++) {
    assert.equal(windowBefore[i], expectedMetatileId(currentCol, currentRow, i, 0), `current screen (0,0) window byte ${i} before any peek`);
  }

  // In-bounds: screen (1, 1), offset 0 -- inside the varied third, a different screen (and so a
  // real bank switch away and back) from the current screen (0, 0) above, AND with a DIFFERENT
  // expected terrain byte than the current screen's own offset-0 byte (fix round 2, MINOR 2: the
  // prior target, screen (2, 1), shared offset 0's value with screen (0, 0) --
  // 1+((2+1)%3) == 1+((0+0)%3) == 1 -- so a routine that never switched screens and just re-read
  // the CURRENT pointer would have passed this assertion too, which the review's own mutation
  // probe demonstrated by replacing sw_peek_byte's body with a bare current-pointer read).
  const targetCol = 1;
  const targetRow = 1;
  const expectedCurrentByte = expectedMetatileId(currentCol, currentRow, 0, 0);
  const expectedTargetByte = expectedMetatileId(targetCol, targetRow, 0, 0);
  assert.notStrictEqual(
    expectedTargetByte,
    expectedCurrentByte,
    'the target screen`s own offset-0 terrain byte must differ from the current screen`s, or this test cannot tell a real switch from a stale read'
  );
  mem[RAM.sw_fill_metatile_id] = 0;
  nes.cpu.REG_ACC = targetCol;
  nes.cpu.REG_X = targetRow;
  nes.cpu.REG_Y = 0;
  callRoutine(nes, swTerrainOrFill);
  assert.equal(nes.cpu.REG_ACC, expectedTargetByte);
  assert.equal(currentMtptr(), mtptrBefore, 'sw_peek_byte must restore mtptr_lo/hi to the current field screen');
  assert.equal(nes.mmap.prgBank, bankBefore, 'sw_peek_byte must restore the PRG bank to the current field screen');
  assert.deepEqual(snapshotWindow(), windowBefore, "the current field screen's own switchable-window bytes must read back unchanged");

  // Out of bounds: screenCol 3 is >= this project's own gridW (3) -- must fall to the fill
  // metatile without ever attempting sw_goto's own bank switch (mapper_shadow untouched).
  const before = mem[MAPPER_SHADOW];
  nes.cpu.REG_ACC = 3;
  nes.cpu.REG_X = 0;
  nes.cpu.REG_Y = 0;
  callRoutine(nes, swTerrainOrFill);
  assert.equal(nes.cpu.REG_ACC, 0, 'an out-of-bounds probe returns the fill metatile id');
  assert.equal(mem[MAPPER_SHADOW], before, 'an out-of-bounds probe must not touch the mapper register');
  assert.equal(currentMtptr(), mtptrBefore, 'an out-of-bounds probe must not disturb mtptr_lo/hi either');
});

test('sw_read_transaction restores the CALLING bank exactly, including the CHR page and mirroring bits switch_prg_bank must preserve', async (t) => {
  const { addrOf, nes } = await buildStreaming(t);
  const swReadTransaction = addrOf('sw_read_transaction');
  const writeMapperReg = addrOf('write_mapper_reg');
  const mem = nes.cpu.mem;

  // A known "dirty" mapper register: CHR page 2 (bits 6-5 = 10), mirroring bit (7) left at 0 so
  // this project's own four-screen mirroring is not disturbed, caller's own PRG bank = 5. Driven
  // through the real write_mapper_reg routine (A = the full byte), not a JS-level nes.mmap.write:
  // the latter is the emulator's own hardware model taking a write as if the bus already saw it,
  // it never runs `sta mapper_shadow`, so mapper_shadow would stay stale and this round-trip
  // would silently test nothing.
  const callerBank = 5;
  const dirty = 0x40 | callerBank; // 0100_0101
  nes.cpu.REG_ACC = dirty;
  callRoutine(nes, writeMapperReg);
  assert.equal(mem[MAPPER_SHADOW], dirty, 'the real register write must land in mapper_shadow');
  assert.equal(nes.mmap.chrPage, 2, 'the real register write must land in the mapper model too');

  mem[RAM.sw_caller_bank] = callerBank;
  // Target a screen that forces a real bank switch away from callerBank: screen (0, 1) sits in
  // this project's second grid row, a different region from screen (0, 0)'s own first region.
  nes.cpu.REG_ACC = 0;
  nes.cpu.REG_X = 1;
  nes.cpu.REG_Y = 0;
  callRoutine(nes, swReadTransaction);

  assert.equal(nes.cpu.REG_ACC, expectedMetatileId(0, 1, 0, 0), 'the read itself must still be correct');
  assert.equal(mem[MAPPER_SHADOW], dirty, 'mapper_shadow must be restored to the exact byte the caller had, CHR bits included');
  assert.equal(nes.mmap.prgBank, callerBank, "the real mapper model's own PRG bank must be back to the caller's");
  assert.equal(nes.mmap.chrPage, 2, "the real mapper model's own CHR page must be untouched by the round trip");
});

test('sw_render_window redraws all four physical nametables and attr_shadow from the world, at the zero window origin', async (t) => {
  const { addrOf, nes } = await buildStreaming(t);
  const swRenderWindow = addrOf('sw_render_window');
  const attrShadow = RAM.attr_shadow; // a RAM equate, not a code label -- not in game.fns
  const mem = nes.cpu.mem;

  mem[RAM.win_col_screen] = 0;
  mem[RAM.win_col_local] = 0;
  mem[RAM.win_row_screen] = 0;
  mem[RAM.win_row_local] = 0;
  mem[RAM.sw_last_screen_col] = 0xff;
  mem[RAM.sw_last_screen_row] = 0xff;
  callRoutineLong(nes, swRenderWindow);

  // At the zero window origin, this window's own math (sw_rw_wbase_col/row = 0, the four
  // nt_hi/ntx/nty entries) places nametable N at exactly screen (ntx[N]/16, nty[N]/15) with
  // physical (row, col) == (localRow, localCol) directly -- both screens of this project's own
  // 3x2 grid that fit inside a 2x2-screen window, never the third column (screenCol 2).
  const NT_SCREEN = [
    { col: 0, row: 0 }, // nt 0: ntx=0,  nty=0
    { col: 1, row: 0 }, // nt 1: ntx=16, nty=0
    { col: 0, row: 1 }, // nt 2: ntx=0,  nty=15
    { col: 1, row: 1 } // nt 3: ntx=16, nty=15
  ];
  for (let nt = 0; nt < 4; nt++) {
    const { col: screenCol, row: screenRow } = NT_SCREEN[nt];
    const table = nes.ppu.nameTable[nes.ppu.ntable1[nt]];
    for (let row = 0; row < 30; row++) {
      for (let col = 0; col < 32; col++) {
        const localCol = col >> 1;
        const localRow = row >> 1;
        const metatileId = expectedMetatileId(screenCol, screenRow, localCol, localRow);
        // fix round 1, finding 5: distinct tile ids per quadrant (expectedTileId, above) --
        // markMetatiles used to hand a metatile's own tl/tr/bl/br the SAME tile, so a real bug
        // swapping which quadrant's tile lands where could never show up in the nametable bytes.
        const expected = expectedTileId(metatileId, col, row);
        const actual = table.tile[row * 32 + col];
        assert.equal(
          actual,
          expected,
          `nt ${nt} (row ${row}, col ${col}) should be metatile ${metatileId}'s own quadrant tile ${expected} (screen ${screenCol},${screenRow} local ${localCol},${localRow}), got ${actual}`
        );
      }
    }
    // The attribute table: 8x8 cells, tl/tr/bl/br packed 2 bits each; arow==7's bl/br quadrants
    // are forced to 0 (no valid content -- sw_rw_attr_bl/br's own documented skip).
    for (let arow = 0; arow < 8; arow++) {
      for (let acol = 0; acol < 8; acol++) {
        const tl = expectedMetatileId(screenCol, screenRow, acol * 2, arow * 2);
        const tr = expectedMetatileId(screenCol, screenRow, acol * 2 + 1, arow * 2);
        const bl = arow === 7 ? 0 : expectedMetatileId(screenCol, screenRow, acol * 2, arow * 2 + 1);
        const br = arow === 7 ? 0 : expectedMetatileId(screenCol, screenRow, acol * 2 + 1, arow * 2 + 1);
        const expectedByte = tl | (tr << 2) | (bl << 4) | (br << 6);
        const actualByte = mem[attrShadow + nt * 64 + arow * 8 + acol];
        assert.equal(
          actualByte,
          expectedByte,
          `attr_shadow nt ${nt} cell (${arow},${acol}) should pack tl=${tl} tr=${tr} bl=${bl} br=${br}, got $${actualByte.toString(16)}`
        );
        // fix round 1, finding 5: attr_shadow alone cannot prove the routine ever issued the real
        // $2007 attribute-table write -- read the emulator's own VRAM back too, via the
        // "attributes as tiles" quirk (renderer/emulator/core/ppu/index.js's attribTableWrite: the
        // raw attribute byte also lands at nameTable[i].tile[0x3c0 + address]). Removing the
        // attribute store while keeping the shadow store must fail THIS assertion even though the
        // shadow-only one above still passes.
        const vramByte = table.tile[0x3c0 + arow * 8 + acol];
        assert.equal(
          vramByte,
          expectedByte,
          `real PPU attribute VRAM nt ${nt} cell (${arow},${acol}) should pack tl=${tl} tr=${tr} bl=${bl} br=${br}, got $${vramByte.toString(16)}`
        );
      }
    }
  }
});

test('a project with no streamed map assembles with no STREAMING_ENABLED gate and no sw_* engine symbols at all', async () => {
  const { createProject } = await import('../../shared/project.js');
  const project = createProject('Ordinary', 'action');
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworld-off-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const symbols = fs.readFileSync(built.symbolPath, 'utf8');
    assert.doesNotMatch(symbols, /^sw_render_window\s*=/m, 'an unstreamed project must never assemble the resident set at all');
    assert.doesNotMatch(symbols, /^sw_grid_w\s*=/m);
    const configInc = fs.readFileSync(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8');
    assert.doesNotMatch(configInc, /STREAMING_ENABLED\s*=\s*1/, 'STREAMING_ENABLED must not be turned on for an unstreamed project');
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test('the streamed-world kernel-hi cost stays flat across game type and a mixed streamed/ordinary project, on UNROM 512', async () => {
  const { STREAMWORLD_KERNEL_HI_ALLOWANCE, STREAMWORLD_MT_PAL_KERNEL_HI_BYTES } = await import('../../main/build/generate.js');
  const total = STREAMWORLD_KERNEL_HI_ALLOWANCE + STREAMWORLD_MT_PAL_KERNEL_HI_BYTES;
  for (const opts of [{ gameType: 'action' }, { gameType: 'rpg' }, { gameType: 'action', mixed: true }]) {
    const project = createStreamedProject(opts);
    markMetatiles(project);
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworld-occ-'));
    try {
      await saveProject(dir, project);
      // A successful build (bypassStreamedRefusal, no "bank overflow" from nesasm) is itself the
      // assertion that this project's real kernel-hi usage fits inside the allowance measured for
      // it -- the exact equality against nesasm's own report is kernelbytes.test.js's job
      // (Part D), not this file's; this is a cross-check that the allowance holds for every game
      // type and shape this slice's own generator produces, not a re-measurement.
      const built = await buildProject({ dir, project, log: () => {}, bypassStreamedRefusal: true });
      assert.ok(built.size > 0, `${JSON.stringify(opts)} must build successfully under the ${total}-byte allowance`);
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }
});

test('a streamed project still refuses to build without the test-only bypass, on every public path', async (t) => {
  const project = createStreamedProject({});
  markMetatiles(project);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworld-refuse-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  await saveProject(dir, project);
  await assert.rejects(() => buildProject({ dir, project, log: () => {} }), /stream/i);
  await assert.rejects(() => generateAssets({ dir, project, log: () => {} }), /stream/i);

  // No shipping caller ever passes bypassStreamedRefusal: cli.js, ipc.js and the renderer's own
  // build call all reach buildProject without it, so this seam only exists for a test that names
  // it explicitly -- grep the whole non-test tree rather than trusting that description.
  const grep = spawnSync('grep', ['-rl', 'bypassStreamedRefusal', 'main', 'renderer', 'shared'], { cwd: ROOT, encoding: 'utf8' });
  const hits = (grep.stdout || '').split('\n').filter(Boolean);
  assert.deepEqual(hits.sort(), ['main/build/generate.js', 'main/build/pipeline.js'].sort(), 'bypassStreamedRefusal must only be threaded through the two build-internal files, never a real caller');
});

test("test/lib/streamedproject.js's own CLI writes the real on-disk project format, and loadProject reads a streamed map back", async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworld-diskformat-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  // Spawned, not called in-process: this is the ONLY test in the suite that actually runs the
  // generator's own `isMain` block (test/lib/streamedproject.js), so a regression back to a
  // hand-rolled `fs.writeFileSync(project.json, ...)` there -- saveProject imported but never
  // called -- fails HERE, not silently, the way calling saveProject directly in this test would.
  const gen = spawnSync(process.execPath, [path.join(ROOT, 'test', 'lib', 'streamedproject.js'), dir], { encoding: 'utf8' });
  assert.equal(gen.status, 0, `the generator's own CLI must exit 0: ${gen.stderr}`);

  // The real on-disk layout (main/project-io.js), not one hand-rolled project.json: a head file
  // plus one maps/N.json per map -- what loadProject (and so main/build/cli.js) actually reads.
  assert.ok(fs.existsSync(path.join(dir, 'project.json')));
  assert.ok(fs.existsSync(path.join(dir, 'maps', '0.json')), 'the streamed map must be its own maps/N.json file');

  const loaded = await loadProject(dir);
  const streamedMap = loaded.maps.find((m) => m.streamed === true);
  assert.ok(streamedMap, 'loadProject must read the streamed map back with streamed: true');
  const expectedMap = createStreamedProject({}).maps.find((m) => m.streamed === true);
  assert.equal(streamedMap.gridW, expectedMap.gridW);
  assert.equal(streamedMap.gridH, expectedMap.gridH);
  // fillMetatileId is deliberately NOT asserted here: normalizeMap (shared/project.js) never
  // copies it into the object it returns, a real, pre-existing schema gap this slice does not fix
  // (the reviewer's own ruling, streamed-worlds-phase2-s2a-review1.md -- fix and round-trip-test in
  // phase 2 slice 2b). Asserting equality here would either fail honestly or, worse, pass by
  // accident if a future edit narrows the gap without anyone noticing this test never exercised it.
});

test('the real public CLI (main/build/cli.js) refuses the generator CLI\'s own directory, non-zero exit, streamed-no-engine text', async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-streamworld-cli-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  // Same spawned generator as the test above, not saveProject called in-process: this directory
  // is exactly what a real user's `node test/lib/streamedproject.js <dir>` would leave behind.
  const gen = spawnSync(process.execPath, [path.join(ROOT, 'test', 'lib', 'streamedproject.js'), dir], { encoding: 'utf8' });
  assert.equal(gen.status, 0, `the generator's own CLI must exit 0: ${gen.stderr}`);

  const result = spawnSync(process.execPath, [path.join(ROOT, 'main', 'build', 'cli.js'), dir], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'the CLI must exit non-zero for a streamed project with no bypass');
  assert.match(result.stdout + result.stderr, /streamed maps have no engine yet/i, 'the CLI must print the real streamed-no-engine refusal, not a generic failure');
});

// Part E's own requirement: a test pins the SHA-256 of the canonical JSON of
// each generator shape, so a silent edit to test/lib/streamedproject.js --
// the fixture every occupancy/render/refusal test above trusts -- is loud
// rather than only showing up as an unexplained downstream byte-count
// drift. Three shapes, matching the ones Part D's kernel-hi equality test
// and the occupancy test above already build: action, rpg, and action+mixed.
const CANONICAL_HASHES = {
  // fix round 1, finding 5: re-pinned deliberately -- the terrain formula changed (see
  // streamedScreen's own comment in test/lib/streamedproject.js) to make consecutive bytes within
  // a screen's own varied region distinguishable from each other.
  action: '48f331376387c5d61cef6043e7d9e631f5e925d749232d542396bd5d7eb3898d',
  rpg: 'dd40523519dde03eac9aa9c5cfadb55a5a876c6ff2aa5f3b20278847f37ccc9b',
  'action-mixed': '4b8a4665fba3aeade83ce3e818c1c533faa92442e276ce18e0d4ff9213a4625c'
};

test('test/lib/streamedproject.js: the canonical JSON of each generator shape hashes to a pinned SHA-256', () => {
  const shapes = {
    action: { gameType: 'action' },
    rpg: { gameType: 'rpg' },
    'action-mixed': { gameType: 'action', mixed: true }
  };
  for (const [label, opts] of Object.entries(shapes)) {
    const project = createStreamedProject(opts);
    const hash = crypto.createHash('sha256').update(canonicalJSON(project)).digest('hex');
    assert.equal(hash, CANONICAL_HASHES[label], `createStreamedProject(${JSON.stringify(opts)}) drifted from its pinned canonical JSON`);
  }
});
