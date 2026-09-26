#!/usr/bin/env node
// Builds ONE streamed-project ROM + generates sw_dlg_drain_timing.lua (ROADMAP item 15 phase 2
// slice 7b, plan test 9): proves the dialogue overlay's own worst single-transaction vram_buf
// queue (a 32-tile row split at an X seam -- two 3-byte headers + 32 payload = 38 bytes) drains
// inside vblank on Mesen's cycle-accurate core while the real streamed dialogue lifecycle is
// genuinely DRAINING -- see sw_dlg_drain_timing.lua.template's own header for the full reasoning.
//
//   node test/lua/build_sw_dlg_drain_roms.mjs [outDir] [--break=oversize]
//   Mesen --testRunner <outDir>/sw_dlg_drain_timing.lua <outDir>/sw_dlg_drain_timing.nes
//
// --break=oversize queues a deliberately larger transaction (7 packets of 32 payload bytes each,
// 245 bytes total -- still inside vram_buf's own 256-byte array, terminator included) that a real
// dialogue close never produces, proving the deadline check itself can fail rather than passing
// vacuously.
//
// (test/lua/run_sw_dlg_drain_check.sh runs both the real shape and the negative control.)
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
const TEMPLATE_PATH = path.join(ROOT, 'test/lua/sw_dlg_drain_timing.lua.template');

const args = process.argv.slice(2);
const breakArg = args.find((a) => a.startsWith('--break='));
const breakMode = breakArg ? breakArg.slice('--break='.length) : null;
if (breakMode && breakMode !== 'oversize') {
  throw new Error(`unknown --break mode: ${breakMode} (expected oversize)`);
}
const outDir = args.find((a) => !a.startsWith('--')) ?? '/tmp/nesforge-sw-dlg-drain';

// The real worst single-transaction shape (docs/design-streamed-worlds.md's own corrected packet
// arithmetic): a 32-tile row split at an X seam, two headers + 32 payload = 38 bytes.
const REAL_PAYLOADS = [16, 16];
// The negative control: a transaction no real dialogue close ever produces, well inside vram_buf's
// own 256-byte array (7*(3+32) = 245, plus a 1-byte terminator = 246).
const OVERSIZE_PAYLOADS = [32, 32, 32, 32, 32, 32, 32];
const payloads = breakMode === 'oversize' ? OVERSIZE_PAYLOADS : REAL_PAYLOADS;

// A live Say gets projectUsesText true, which is what allocates box_state/sw_dlg15_state and
// turns on the message-box drawing code this check is measuring -- the harness never actually
// drives a real conversation (mirroring sw_nmi_deadline.lua.template's own poke-not-drive
// convention), it only needs the real production code assembled and its RAM cells named. Same
// entity shape test/unit/streamworlddialogue.test.js's own interactEntity() builds.
const project = createStreamedProject({});
const streamedMap = project.maps.find((m) => m.streamed === true);
const actorId = project.sprites.actors.length;
project.sprites.actors.push({ name: 'NPC', behavior: 'npc', hp: 1, damage: 0 });
const screen = streamedMap.screens[0];
screen.entities = screen.entities ?? [];
screen.entities.push({
  actorId, x: 32, y: 32,
  props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'X' }] }] } }
});

async function main() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sw-dlg-drain-'));
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
      'box_state', 'BOX_CLOSED', 'sw_dlg15_state', 'SW_DLG15_DRAINING', 'cam_dirty',
      'vram_len', 'vram_buf', 'vram_ready'
    ];
    for (const name of RAM_NAMES) {
      if (!ramSymbols.has(name)) throw new Error(`${name} did not resolve out of this build's own constants.asm/config.inc`);
    }

    await fs.promises.mkdir(outDir, { recursive: true });
    const romPath = path.join(outDir, 'sw_dlg_drain_timing.nes');
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
      __SW_DLG15_STATE__: `0x${ramSymbols.get('sw_dlg15_state').toString(16)}`,
      __SW_DLG15_DRAINING__: `${ramSymbols.get('SW_DLG15_DRAINING')}`,
      __CAM_DIRTY__: `0x${ramSymbols.get('cam_dirty').toString(16)}`,
      __VRAM_LEN__: `0x${ramSymbols.get('vram_len').toString(16)}`,
      __VRAM_BUF__: `0x${ramSymbols.get('vram_buf').toString(16)}`,
      __VRAM_READY__: `0x${ramSymbols.get('vram_ready').toString(16)}`,
      __PACKET_PAYLOADS__: payloads.join(', '),
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
    const luaPath = path.join(outDir, 'sw_dlg_drain_timing.lua');
    await fs.promises.writeFile(luaPath, generated, 'utf8');

    console.log(`built -> ${romPath} (${romBytes.length} bytes)${breakMode ? ` BROKEN(${breakMode})` : ''}, lua -> ${luaPath}`);
    console.log(`payloads=[${payloads.join(',')}] queueBytes=${payloads.reduce((s, p) => s + 3 + p, 0)}`);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

main();
