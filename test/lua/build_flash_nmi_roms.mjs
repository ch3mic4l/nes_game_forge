#!/usr/bin/env node
// Builds the ROM and the generated flash_nmi_timing.lua (§9 test 8) runs
// against: a fresh project, built into a temp directory (never touching
// sample/ or sample-rpg/), with one actor whose event carries a live Say
// immediately followed by a live Flash -- the identical two-producer fixture
// test/unit/flash.test.js's own "a Say and a Flash edge sharing one frame"
// test builds, so the Mesen check and the jsnes-based unit test are proving
// the same scenario on two independent emulator cores.
//
//   node test/lua/build_flash_nmi_roms.mjs [outDir]
//
// Writes <outDir>/flash_nmi.nes and <outDir>/flash_nmi_timing.lua (the
// latter is flash_nmi_timing.lua.template with its four __PLACEHOLDER__
// tokens substituted for addresses resolved out of *this exact build*):
// nmi_rti, main_loop_ready and flash_tick come straight out of game.fns via
// main/build/symbols.js; flash_left is a computed expression in
// engine/constants.asm (`flash_left = fade_reload+1`) that
// shared/enginesyms.js's parseEquates cannot resolve (it only understands
// literal `name = $HH` equates), so this script measures it the same way
// test/unit/flash.test.js's own header comment documents doing by hand
// once: inject `.db flash_left` into a Code Forge user file, then read the
// emitted byte back out of the booted ROM via the same jsnes-based Emulator
// the unit tests use (peek() reads straight through the real mapper, so no
// frame needs to run first -- the probe byte is ROM content, not RAM
// state). Mesen's own Lua sandbox has no working io.* (confirmed
// empirically by an earlier, abandoned attempt at a cross-process file
// handshake in save_sram.lua, which crashed the host process), so there is
// no way for the generated .lua to re-derive any of this at runtime itself
// -- these four values must be baked in fresh, by this script, every time
// it runs, rather than hand-copied into the template and left to go stale.

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
const TEMPLATE_PATH = path.join(ROOT, 'test/lua/flash_nmi_timing.lua.template');

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--')) ?? '/tmp/nesforge-flash-nmi-roms';

async function main() {
  // Finding 4: the private mkdtemp build directory used to be removed only
  // on the success path -- a build, substitution or write error above left
  // the whole generated project (source, build/, the ROM) leaked in the OS
  // temp directory forever. try/finally guarantees the cleanup runs however
  // the body below exits.
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-flash-nmi-'));
  try {
    const project = await loadProject(SAMPLE);
    const slime = project.sprites.actors[0];
    const npcId = project.sprites.actors.length;
    project.sprites.actors.push({ ...structuredClone(slime), id: npcId, name: 'Sayer', behavior: 'npc' });
    project.maps[0].screens[0].metatiles = new Array(240).fill(0);
    project.maps[0].screens[0].entities = [
      {
        actorId: npcId,
        x: 112,
        y: 96,
        props: {
          event: {
            pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'say', text: 'Thunder crashes in the distance!' }, { op: 'flash' }] }]
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
    const flashLeftProbeAddr = symbols.flash_left_probe;
    if (!Number.isFinite(nmiRtiAddr)) throw new Error('nmi_rti was not a named symbol in game.fns');
    if (!Number.isFinite(mainLoopReadyAddr)) throw new Error('main_loop_ready was not a named symbol in game.fns');
    if (!Number.isFinite(flashTickAddr)) throw new Error('flash_tick was not a named symbol in game.fns');
    if (!Number.isFinite(flashLeftProbeAddr)) throw new Error('flash_left_probe was not a named symbol in game.fns');

    const romBytes = new Uint8Array(await fs.promises.readFile(built.romPath));
    const emulator = new Emulator({ onFrame: () => {} });
    emulator.loadROM(romBytes);
    const flashLeftAddr = emulator.peek(flashLeftProbeAddr);
    if (!Number.isFinite(flashLeftAddr) || flashLeftAddr === 0) {
      throw new Error(`flash_left_probe's own byte read back as ${flashLeftAddr} -- expected a real zero-page address`);
    }

    await fs.promises.mkdir(outDir, { recursive: true });
    const romPath = path.join(outDir, 'flash_nmi.nes');
    await fs.promises.copyFile(built.romPath, romPath);

    const template = await fs.promises.readFile(TEMPLATE_PATH, 'utf8');
    const substitutions = {
      __NMI_RTI__: `0x${nmiRtiAddr.toString(16)}`,
      __MAIN_LOOP_READY__: `0x${mainLoopReadyAddr.toString(16)}`,
      __FLASH_TICK__: `0x${flashTickAddr.toString(16)}`,
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
    const luaPath = path.join(outDir, 'flash_nmi_timing.lua');
    await fs.promises.writeFile(luaPath, generated, 'utf8');

    console.log(`rom: ${romPath}`);
    console.log(`lua: ${luaPath}`);
    console.log(`nmi_rti: 0x${nmiRtiAddr.toString(16)}`);
    console.log(`main_loop_ready: 0x${mainLoopReadyAddr.toString(16)}`);
    console.log(`flash_tick: 0x${flashTickAddr.toString(16)}`);
    console.log(`flash_left: 0x${flashLeftAddr.toString(16)}`);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

main();
