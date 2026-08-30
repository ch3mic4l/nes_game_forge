#!/usr/bin/env node
// Builds the ROM and the generated bound_tile_nmi_timing.lua (design-tile.md
// §12 test 14) runs against: a fresh project, built into a temp directory
// (never touching sample/ or sample-rpg/), with one bound tile and one actor
// whose event sets its switch then opens a Say -- the same box-raise/Flash
// overlap test/lua/build_flash_nmi_roms.mjs already proves, now with a third
// producer sharing the frame: flip_tick (engine/entities.asm), which ticks
// unconditionally from main_loop exactly the way flash_tick already does
// (CLAUDE.md's own vram_buf producer-budget passage: Flash made the bound
// two, not one; a live bound tile makes it three, not two).
//
//   node test/lua/build_bound_tile_nmi_roms.mjs [outDir]
//
// Writes <outDir>/bound_tile_nmi.nes and <outDir>/bound_tile_nmi_timing.lua
// (the latter is bound_tile_nmi_timing.lua.template with its __PLACEHOLDER__
// tokens substituted for addresses resolved out of *this exact build*):
// nmi_rti, main_loop_ready, flash_tick and flip_tick come straight out of
// game.fns via main/build/symbols.js; flash_left is a computed expression in
// engine/constants.asm (`flash_left = fade_reload+1`) that
// shared/enginesyms.js's parseEquates cannot resolve, measured the same way
// build_flash_nmi_roms.mjs's own header comment documents: inject `.db
// flash_left` into a Code Forge user file and read the emitted byte back out
// of the booted ROM. flip_pending_idx/flip_pending_count/flip_budget are
// plain `NAME = $hex` equates in engine/constants.asm (see that file), so
// they need no such probe -- their addresses are stable literals, hardcoded
// into the template the same way GAME_STATE/BOX_STATE and every other plain
// RAM address already are in every other Lua check in this directory.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { Emulator } from '../../renderer/emulator/runcontrol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const TEMPLATE_PATH = path.join(ROOT, 'test/lua/bound_tile_nmi_timing.lua.template');

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--')) ?? '/tmp/nesforge-bound-tile-nmi-roms';

async function main() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-boundtile-nmi-'));
  try {
    const project = await loadProject(SAMPLE);
    const slime = project.sprites.actors[0];
    const npcId = project.sprites.actors.length;
    project.sprites.actors.push({ ...structuredClone(slime), id: npcId, name: 'Sayer', behavior: 'npc' });
    project.metatiles[1].tiles = [5, 6, 7, 8];
    project.metatiles[1].palette = project.metatiles[0].palette;
    project.maps[0].screens[0].metatiles = new Array(240).fill(0);
    // Row 0, col 0 -- well outside the message box's own rows (12-14), so
    // this flip is never blocked by flip_cell_blocked and can complete on
    // the very frame the Lua script re-queues it for.
    project.maps[0].screens[0].boundTiles = [{ switchId: 5, row: 0, col: 0, metatileId: 1 }];
    project.maps[0].screens[0].entities = [
      {
        actorId: npcId,
        x: 112,
        y: 96,
        props: {
          event: {
            // The Flash command itself is never naturally reached during the
            // timing-critical window (the Lua script arms it directly via a
            // flash_left poke, the identical technique
            // flash_nmi_timing.lua.template already uses) -- it is here so
            // FLASH_ENABLED is genuinely on and flash_tick actually
            // assembles into this ROM at all.
            pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'setSwitch', switch: 5 }, { op: 'say', text: 'Thunder crashes in the distance!' }, { op: 'flash' }] }]
          }
        }
      }
    ];
    project.code = { overrides: [], files: [{ name: 'flash_left_probe.asm', text: 'flash_left_probe:\n  .db flash_left\n' }] };
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });

    const symbolsText = await fs.promises.readFile(built.symbolPath, 'utf8');
    const symbols = parseSymbolFile(symbolsText);
    const nmiRtiAddr = symbols.nmi_rti;
    const mainLoopReadyAddr = symbols.main_loop_ready;
    const flashTickAddr = symbols.flash_tick;
    const flipTickAddr = symbols.flip_tick;
    const flashLeftProbeAddr = symbols.flash_left_probe;
    if (!Number.isFinite(nmiRtiAddr)) throw new Error('nmi_rti was not a named symbol in game.fns');
    if (!Number.isFinite(mainLoopReadyAddr)) throw new Error('main_loop_ready was not a named symbol in game.fns');
    if (!Number.isFinite(flashTickAddr)) throw new Error('flash_tick was not a named symbol in game.fns');
    if (!Number.isFinite(flipTickAddr)) throw new Error('flip_tick was not a named symbol in game.fns -- was BOUND_TILE_ENABLED actually on for this build?');
    if (!Number.isFinite(flashLeftProbeAddr)) throw new Error('flash_left_probe was not a named symbol in game.fns');

    const romBytes = new Uint8Array(await fs.promises.readFile(built.romPath));
    const emulator = new Emulator({ onFrame: () => {} });
    emulator.loadROM(romBytes);
    const flashLeftAddr = emulator.peek(flashLeftProbeAddr);
    if (!Number.isFinite(flashLeftAddr) || flashLeftAddr === 0) {
      throw new Error(`flash_left_probe's own byte read back as ${flashLeftAddr} -- expected a real zero-page address`);
    }

    await fs.promises.mkdir(outDir, { recursive: true });
    const romPath = path.join(outDir, 'bound_tile_nmi.nes');
    await fs.promises.copyFile(built.romPath, romPath);

    const template = await fs.promises.readFile(TEMPLATE_PATH, 'utf8');
    const substitutions = {
      __NMI_RTI__: `0x${nmiRtiAddr.toString(16)}`,
      __MAIN_LOOP_READY__: `0x${mainLoopReadyAddr.toString(16)}`,
      __FLASH_TICK__: `0x${flashTickAddr.toString(16)}`,
      __FLIP_TICK__: `0x${flipTickAddr.toString(16)}`,
      __FLASH_LEFT__: `0x${flashLeftAddr.toString(16)}`
    };
    let generated = template;
    for (const [token, value] of Object.entries(substitutions)) {
      const occurrences = generated.split(token).length - 1;
      if (occurrences !== 1) {
        throw new Error(`expected exactly one occurrence of ${token} in the template, found ${occurrences}`);
      }
      generated = generated.split(token).join(value);
    }
    const luaPath = path.join(outDir, 'bound_tile_nmi_timing.lua');
    await fs.promises.writeFile(luaPath, generated, 'utf8');

    console.log(`rom: ${romPath}`);
    console.log(`lua: ${luaPath}`);
    console.log(`nmi_rti: 0x${nmiRtiAddr.toString(16)}`);
    console.log(`main_loop_ready: 0x${mainLoopReadyAddr.toString(16)}`);
    console.log(`flash_tick: 0x${flashTickAddr.toString(16)}`);
    console.log(`flip_tick: 0x${flipTickAddr.toString(16)}`);
    console.log(`flash_left: 0x${flashLeftAddr.toString(16)}`);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

main();
