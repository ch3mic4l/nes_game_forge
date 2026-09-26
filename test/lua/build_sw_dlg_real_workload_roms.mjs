#!/usr/bin/env node
// Builds ONE streamed-project ROM + generates sw_dlg_real_workload_timing.lua (ROADMAP item 15
// phase 2 slice 7b, fix round 1 finding A6's own remaining requirement: "test the reachable worst
// case with the real lifecycle, real OAM publication, and a negative control"). Unlike
// test/lua/build_sw_dlg_drain_roms.mjs (test 9 -- a SYNTHETIC RAM-poked packet shape, DMA
// deliberately skipped), this drives the REAL production path start to finish: real controller
// input walks the player to a real interact NPC, a real B press fires a real event running real
// `flash` then `say "AB"` commands (the exact scenario
// handoff-next/review-phase2-s7b-round1-evidence/barrier-accounting/accounting-odd-column-probe.mjs
// already used to find the real worst-case queue depth), the real camera/OAM barrier and real
// vram_drain do the actual work, and the box is genuinely opened AND closed (both sides of the A6
// pacing fix in engine/streamworld.asm's sw_dlg_hi_open_attr/sw_dlg_hi_close_attr).
//
// The scenario's own real worst-case queue: Flash's own vram_buf packet (35 bytes) shares the
// interact frame with the dialogue box's own first row/attribute draw (38 bytes) -- 73 payload
// bytes, +1 terminator = 74 total (docs/design-streamed-worlds.md's own "38 dialogue + 35 Flash + 1
// terminator = 74 bytes" figure; CLAUDE.md's own "flip_tick, flash_tick and one frozen-world tick
// are the three producers that can share a frame" rule is the general case this is a real instance
// of). Independently re-confirmed this fix round by re-running accounting-odd-column-probe.mjs
// against the A6-fixed engine: real max vram_len == 73.
//
//   node test/lua/build_sw_dlg_real_workload_roms.mjs [outDir] [--break=inject-oversize]
//   Mesen --testRunner <outDir>/sw_dlg_real_workload_timing.lua <outDir>/sw_dlg_real_workload_timing.nes
//
// --break=inject-oversize is a RUNTIME flag threaded into the generated .lua, not a different ROM:
// the same real walk/interact/event sequence runs, but the template additionally appends one extra
// oversized fake packet onto the tail of the REAL first transaction (at main_loop_ready, before
// that frame's own NMI drains it -- the same well-precedented poke-before-drain point
// sw_dlg_drain_timing.lua.template's own armQueue uses), proving the deadline check can genuinely
// fail rather than pass vacuously. Real dialogue text can never organically grow this large (every
// row/attribute draw is already paced to one unit of work per frame by design), so there is no
// "real" way to build a bigger negative control than injecting on top of the real one.
//
// (test/lua/run_sw_dlg_real_workload_check.sh runs both the real run and the negative control.)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { scanEquates, resolveEquates } from '../lib/equates.js';
import { createStreamedProject } from '../lib/streamedproject.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE_PATH = path.join(ROOT, 'test/lua/sw_dlg_real_workload_timing.lua.template');

const args = process.argv.slice(2);
const breakArg = args.find((a) => a.startsWith('--break='));
const breakMode = breakArg ? breakArg.slice('--break='.length) : null;
if (breakMode && breakMode !== 'inject-oversize') {
  throw new Error(`unknown --break mode: ${breakMode} (expected inject-oversize)`);
}
const outDir = args.find((a) => !a.startsWith('--')) ?? '/tmp/nesforge-sw-dlg-real-workload';

// Identical entity/event shape to accounting-odd-column-probe.mjs's own scenario -- same actorId
// (0, the project's first sprite) and same slot (0, the streamed map's screen 0's first entity),
// so ENT_X/ENT_Y index 0 (no `+slot` offset needed) names this NPC's own position.
const project = createStreamedProject({});
const streamedMap = project.maps.find((m) => m.streamed === true);
const actorId = project.sprites.actors.length;
project.sprites.actors.push({ name: 'NPC', behavior: 'npc', hp: 1, damage: 0 });
const screen = streamedMap.screens[0];
screen.entities = screen.entities ?? [];
screen.entities.push({
  actorId, x: 216, y: 112,
  props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'flash' }, { op: 'say', text: 'AB' }] }] } }
});

async function main() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sw-dlg-real-workload-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const romBytes = Buffer.from(await fs.promises.readFile(built.romPath));

    const symbolsText = await fs.promises.readFile(built.symbolPath, 'utf8');
    const codeSymbols = parseSymbolFile(symbolsText);
    for (const name of ['main_loop_ready', 'nmi_rti']) {
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
      'game_state', 'ST_GAMEPLAY', 'ST_DIALOG', 'map_is_streamed', 'st_active',
      'box_state', 'BOX_CLOSED', 'BOX_ENDWAIT', 'cam_dirty',
      'vram_len', 'vram_buf', 'vram_ready',
      'player_x', 'player_y', 'ent_x', 'ent_y'
    ];
    for (const name of RAM_NAMES) {
      if (!ramSymbols.has(name)) throw new Error(`${name} did not resolve out of this build's own constants.asm/config.inc`);
    }

    await fs.promises.mkdir(outDir, { recursive: true });
    const romPath = path.join(outDir, 'sw_dlg_real_workload_timing.nes');
    await fs.promises.writeFile(romPath, romBytes);

    const template = await fs.promises.readFile(TEMPLATE_PATH, 'utf8');
    const substitutions = {
      __MAIN_LOOP_READY__: `0x${codeSymbols.main_loop_ready.toString(16)}`,
      __NMI_RTI__: `0x${codeSymbols.nmi_rti.toString(16)}`,
      __GAME_STATE__: `0x${ramSymbols.get('game_state').toString(16)}`,
      __ST_GAMEPLAY__: `${ramSymbols.get('ST_GAMEPLAY')}`,
      __ST_DIALOG__: `${ramSymbols.get('ST_DIALOG')}`,
      __MAP_IS_STREAMED__: `0x${ramSymbols.get('map_is_streamed').toString(16)}`,
      __ST_ACTIVE__: `0x${ramSymbols.get('st_active').toString(16)}`,
      __BOX_STATE__: `0x${ramSymbols.get('box_state').toString(16)}`,
      __BOX_CLOSED__: `${ramSymbols.get('BOX_CLOSED')}`,
      __BOX_ENDWAIT__: `${ramSymbols.get('BOX_ENDWAIT')}`,
      __CAM_DIRTY__: `0x${ramSymbols.get('cam_dirty').toString(16)}`,
      __VRAM_LEN__: `0x${ramSymbols.get('vram_len').toString(16)}`,
      __VRAM_BUF__: `0x${ramSymbols.get('vram_buf').toString(16)}`,
      __VRAM_READY__: `0x${ramSymbols.get('vram_ready').toString(16)}`,
      __PLAYER_X__: `0x${ramSymbols.get('player_x').toString(16)}`,
      __PLAYER_Y__: `0x${ramSymbols.get('player_y').toString(16)}`,
      __ENT_X__: `0x${ramSymbols.get('ent_x').toString(16)}`,
      __ENT_Y__: `0x${ramSymbols.get('ent_y').toString(16)}`,
      __EXPECTED_REAL_VRAM_LEN__: '73',
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
    const luaPath = path.join(outDir, 'sw_dlg_real_workload_timing.lua');
    await fs.promises.writeFile(luaPath, generated, 'utf8');

    console.log(`built -> ${romPath} (${romBytes.length} bytes)${breakMode ? ` BROKEN(${breakMode})` : ''}, lua -> ${luaPath}`);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

main();
