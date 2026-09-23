#!/usr/bin/env node
// Builds ONE streamed-project ROM + generates sw_nmi_deadline.lua (§9 test 8's own Mesen
// "measured deadline" half, plan test 5): does sw_nmi_stream's own strip-only chunk
// (SW_STREAM_CHUNK=3) and sw_nmi_stream_reduced's own mixed chunk (SW_STREAM_MIXED_CHUNK=2,
// alongside a real 35-byte vram_buf drain) both finish inside vblank on Mesen's cycle-accurate
// core -- see sw_nmi_deadline.lua.template's own header for the full reasoning and the
// RAM-poke-instead-of-CPU-injection deviation this script and its generated script both take.
//
//   node test/lua/build_sw_nmi_roms.mjs [outDir] [--parity=even|odd] [--break=chunk4|mixed3]
//   Mesen --testRunner <outDir>/sw_nmi_deadline.lua <outDir>/sw_nmi.nes
//
// --parity=even (default) lands on screen (0,0) of the streamed map's own 3x2 grid; --parity=odd
// lands on (1,1) -- both odd, exactly test/lua/build_sw_render_roms.mjs's own two landing
// choices. Cycle timing does not obviously depend on which physical nametable a block's own
// torus position resolves to, EXCEPT that sw_ns_draw_block computes its own target address via a
// table lookup plus an add that CAN cross a page boundary for one parity and not the other (6502:
// an indexed absolute write across a page boundary costs +1 cycle) -- this is exactly the kind of
// difference only a cycle-accurate core would ever show, so both parities are built and measured
// separately rather than assumed identical.
//
// --break=chunk4 patches the *built ROM's own byte* (never the project source or the Lua oracle)
// at sw_ns_go's own `lda #SW_STREAM_CHUNK` operand, 3 -> 4 -- a real negative control against the
// exact byte the fixed kernel bank ships. --break=mixed3 patches sw_nsr_go's own
// `lda #SW_STREAM_MIXED_CHUNK` operand, 2 -> 3, the same way. The fixed kernel bank ($C000-$FFFF,
// one physical 16KB bank per CLAUDE.md's own documented PRG layout) is the LAST 16KB PRG bank in
// the .nes file -- confirmed empirically against a real UNROM 512 build (sample-u512, read-only):
// the CPU's own $C000..$C03F bytes, read via the jsnes-based Emulator (renderer/emulator/
// runcontrol.js, the same technique build_flash_nmi_roms.mjs already uses to resolve a computed
// constant), appear in the ROM FILE at exactly `16 (header) + (prg16kUnits-1)*16384`, so
// `fileOffset(cpuAddr) = 16 + (prg16kUnits-1)*16384 + (cpuAddr - 0xC000)` for any address the
// fixed kernel bank holds. This script asserts the byte it is about to patch reads the EXPECTED
// unbroken value first, so a stale offset (a PRG layout change since this formula was derived)
// fails loudly at build time rather than silently patching the wrong byte.
//
// (test/lua/run_sw_nmi_check.sh runs both parities and all four case/break combinations.)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createProject, createMap, createScreen } from '../../shared/project.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { scanEquates, resolveEquates } from '../lib/equates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE_PATH = path.join(ROOT, 'test/lua/sw_nmi_deadline.lua.template');

const args = process.argv.slice(2);
const parityArg = args.find((a) => a.startsWith('--parity='));
const parity = parityArg ? parityArg.slice('--parity='.length) : 'even';
if (!['even', 'odd'].includes(parity)) {
  throw new Error(`unknown --parity: ${parity} (expected even or odd)`);
}
const breakArg = args.find((a) => a.startsWith('--break='));
const breakMode = breakArg ? breakArg.slice('--break='.length) : null;
if (breakMode && !['chunk4', 'mixed3'].includes(breakMode)) {
  throw new Error(`unknown --break mode: ${breakMode}`);
}
const outDir = args.find((a) => !a.startsWith('--')) ?? '/tmp/nesforge-sw-nmi';

const GRID_W = 3;
const GRID_H = 2;
const LANDING_COL = parity === 'even' ? 0 : 1;
const LANDING_ROW = parity === 'even' ? 0 : 1;
const LANDING_SCREEN_INDEX = LANDING_ROW * GRID_W + LANDING_COL;

const project = createProject('Streamed NMI Deadline Check', 'action');
project.cartridge.mapper = 30; // UNROM 512 -- the only streamed-capable board
project.cartridge.mirroring = 'fourscreen';
project.cartridge.camera = true;

const map = createMap(0, 'Streamed');
map.gridW = GRID_W;
map.gridH = GRID_H;
map.streamed = true;
map.tilesetId = 0;
map.screens = Array.from({ length: GRID_W * GRID_H }, () => createScreen());
project.maps = [map];
project.project.startMap = 0;
project.project.startScreen = LANDING_SCREEN_INDEX;

async function main() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sw-nmi-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const romBytes = Buffer.from(await fs.promises.readFile(built.romPath));

    const symbolsText = await fs.promises.readFile(built.symbolPath, 'utf8');
    const codeSymbols = parseSymbolFile(symbolsText);
    for (const name of ['main_loop_ready', 'nmi_rti', 'sw_ns_go', 'sw_nsr_go']) {
      if (!Number.isFinite(codeSymbols[name])) throw new Error(`${name} was not a named symbol in game.fns`);
    }

    const constantsText = await fs.promises.readFile(path.join(dir, 'build', 'constants.asm'), 'utf8');
    const configText = await fs.promises.readFile(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8');
    const pending = new Map();
    scanEquates(constantsText, pending);
    scanEquates(configText, pending);
    const ramSymbols = new Map();
    resolveEquates(pending, ramSymbols);
    const RAM_NAMES = [
      'game_state', 'ST_GAMEPLAY', 'map_is_streamed',
      'st_active', 'st_cur', 'st_len', 'st_ftile', 'st_fnt', 'st_vary', 'sbuf',
      'vram_len', 'vram_buf', 'vram_ready'
    ];
    for (const name of RAM_NAMES) {
      if (!ramSymbols.has(name)) throw new Error(`${name} did not resolve out of this build's own constants.asm/config.inc`);
    }

    // Fixed kernel bank -- the LAST 16KB PRG bank in the .nes file (see header comment above).
    const prg16kUnits = romBytes[4];
    const fixedBankFileBase = 16 + (prg16kUnits - 1) * 16384;
    const fileOffset = (cpuAddr) => fixedBankFileBase + (cpuAddr - 0xC000);

    if (breakMode === 'chunk4') {
      const operandAddr = codeSymbols.sw_ns_go + 1;
      const off = fileOffset(operandAddr);
      if (romBytes[off] !== 3) {
        throw new Error(`expected byte 3 (SW_STREAM_CHUNK) at sw_ns_go+1 (cpu 0x${operandAddr.toString(16)}, file offset ${off}), found ${romBytes[off]} -- the fixed-bank offset formula may be stale`);
      }
      romBytes[off] = 4;
    } else if (breakMode === 'mixed3') {
      const operandAddr = codeSymbols.sw_nsr_go + 1;
      const off = fileOffset(operandAddr);
      if (romBytes[off] !== 2) {
        throw new Error(`expected byte 2 (SW_STREAM_MIXED_CHUNK) at sw_nsr_go+1 (cpu 0x${operandAddr.toString(16)}, file offset ${off}), found ${romBytes[off]} -- the fixed-bank offset formula may be stale`);
      }
      romBytes[off] = 3;
    }

    await fs.promises.mkdir(outDir, { recursive: true });
    const romPath = path.join(outDir, 'sw_nmi.nes');
    await fs.promises.writeFile(romPath, romBytes);

    const template = await fs.promises.readFile(TEMPLATE_PATH, 'utf8');
    const substitutions = {
      __MAIN_LOOP_READY__: `0x${codeSymbols.main_loop_ready.toString(16)}`,
      __NMI_RTI__: `0x${codeSymbols.nmi_rti.toString(16)}`,
      __GAME_STATE__: `0x${ramSymbols.get('game_state').toString(16)}`,
      __ST_GAMEPLAY__: `${ramSymbols.get('ST_GAMEPLAY')}`,
      __MAP_IS_STREAMED__: `0x${ramSymbols.get('map_is_streamed').toString(16)}`,
      __ST_ACTIVE__: `0x${ramSymbols.get('st_active').toString(16)}`,
      __ST_CUR__: `0x${ramSymbols.get('st_cur').toString(16)}`,
      __ST_LEN__: `0x${ramSymbols.get('st_len').toString(16)}`,
      __ST_FTILE__: `0x${ramSymbols.get('st_ftile').toString(16)}`,
      __ST_FNT__: `0x${ramSymbols.get('st_fnt').toString(16)}`,
      __ST_VARY__: `0x${ramSymbols.get('st_vary').toString(16)}`,
      __SBUF__: `0x${ramSymbols.get('sbuf').toString(16)}`,
      __VRAM_LEN__: `0x${ramSymbols.get('vram_len').toString(16)}`,
      __VRAM_BUF__: `0x${ramSymbols.get('vram_buf').toString(16)}`,
      __VRAM_READY__: `0x${ramSymbols.get('vram_ready').toString(16)}`,
      __BREAK_MODE__: breakMode ? `"${breakMode}"` : 'nil'
    };
    let generated = template;
    for (const [token, value] of Object.entries(substitutions)) {
      const occurrences = generated.split(token).length - 1;
      if (occurrences !== 1) {
        throw new Error(`expected exactly one occurrence of ${token} in the template, found ${occurrences}`);
      }
      generated = generated.split(token).join(value);
    }
    const luaPath = path.join(outDir, 'sw_nmi_deadline.lua');
    await fs.promises.writeFile(luaPath, generated, 'utf8');

    console.log(`built -> ${romPath} (${romBytes.length} bytes)${breakMode ? ` BROKEN(${breakMode})` : ''}, lua -> ${luaPath}`);
    console.log(`landing: screen(${LANDING_COL},${LANDING_ROW}) index ${LANDING_SCREEN_INDEX}, parity=${parity}`);
    console.log(`main_loop_ready=0x${codeSymbols.main_loop_ready.toString(16)} nmi_rti=0x${codeSymbols.nmi_rti.toString(16)} sw_ns_go=0x${codeSymbols.sw_ns_go.toString(16)} sw_nsr_go=0x${codeSymbols.sw_nsr_go.toString(16)}`);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

main();
