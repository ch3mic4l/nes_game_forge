#!/usr/bin/env node
// Builds the ROM(s) test/lua/sw_quadrant_check.lua.template runs against, and instantiates that
// template once per shape (fix round 2, MINOR 3) with this build's own resolved
// frame_cnt/game_state/ST_GAMEPLAY addresses baked in -- see the template's own header for why.
//
//   node test/lua/build_sw_roms.mjs [outDir] [--break=corrupt-reset-vector]
//
// Phase 2 slice 2b wired the resolver into every real landing site and deleted the phase-1
// blanket "no engine yet" refusal along with the `bypassStreamedRefusal` seam that existed only
// to get past it (test/unit/streamworldresident.test.js's own "no longer exists in any shipping
// file" test) -- so every ROM here now goes through `buildProject` exactly as a real caller would,
// the same public path `cli.js` itself uses. This file exists only because a Mesen runner still
// needs a ROM built from a project no checked-in fixture carries (streamedproject.js's own
// deterministic shape).
//
// Three project shapes, one generator (test/lib/streamedproject.js), on UNROM 512 -- this file's
// own choice of board, not a claim that it is the only streamed-capable one (kernelbytes.test.js
// measures MMC1 and MMC3 too; see createStreamedProject's own mapper/mirroring parameters):
//   sw_action.nes        createStreamedProject({ gameType: 'action' })
//   sw_rpg.nes           createStreamedProject({ gameType: 'rpg' })
//   sw_action_mixed.nes  createStreamedProject({ gameType: 'action', mixed: true })
//
// --break=corrupt-reset-vector is a generic, self-verifying negative control matching
// save_sram.lua's own "did the mechanism run" philosophy: after a normal, otherwise-correct
// build, patch the assembled sw_action.nes file's own reset vector ($FFFA, iNES 1.0 header always
// 16 bytes, and the fixed kernel-hi bank -- whichever mapper's last nesasm bank, prgLayout's own
// kernelHiBank -- always lands last in the PRG data, so the vector trio sits in the file's final 6
// bytes) to garbage, proving the runner's own positive-path check is not vacuously true. It
// predates slice 2b's real call site and does not exercise streamworld.asm's own logic -- the
// positive run above it is what cross-checks the resolver's real behaviour (window render,
// landing scroll) against a second, independent emulator; see sw_quadrant_check.lua's own header.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { scanEquates, resolveEquates } from '../lib/equates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE_PATH = path.join(ROOT, 'test/lua/sw_quadrant_check.lua.template');

const args = process.argv.slice(2);
const breakArg = args.find((a) => a.startsWith('--break='));
const breakMode = breakArg ? breakArg.slice('--break='.length) : null;
const outDir = args.find((a) => !a.startsWith('--')) ?? '/tmp/nesforge-sw-roms';

if (breakMode && breakMode !== 'corrupt-reset-vector') {
  throw new Error(`unknown --break mode: ${breakMode}`);
}

const SHAPES = [
  { key: 'action', opts: { gameType: 'action' } },
  { key: 'rpg', opts: { gameType: 'rpg' } },
  { key: 'action_mixed', opts: { gameType: 'action', mixed: true } }
];

async function buildShape({ key, opts }) {
  const project = createStreamedProject(opts);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nesforge-sw-build-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const rom = await fs.promises.readFile(built.romPath);
    const romOut = new Uint8Array(rom);
    if (breakMode === 'corrupt-reset-vector' && key === 'action') {
      // iNES 1.0: 16-byte header, then PRG data; the fixed kernel-hi bank
      // (whichever nesasm bank prgLayout calls kernelHiBank) is always the
      // LAST bank nesasm assembled, so it lands last in the file -- the
      // vector trio (nmi, reset, irq -- 2 bytes each, $FFFA-$FFFF) is
      // always the file's own final 6 bytes, regardless of mapper.
      const vectorOffset = romOut.length - 6;
      romOut[vectorOffset + 2] = 0xff; // reset lo
      romOut[vectorOffset + 3] = 0xff; // reset hi -- $FFFF, never valid PRG code
    }
    // frame_cnt/game_state/ST_GAMEPLAY: plain RAM equates, not named labels, so nesasm's own
    // game.fns symbol dump omits them entirely (confirmed empirically the same way
    // build_camera_roms.mjs's own header already documents for cam_x_lo/flash_left) -- resolved
    // instead out of THIS build's own build/constants.asm + build/assets/config.inc, before the
    // mkdtemp build directory is removed below. resolveEquates throws loudly if any name never
    // resolves, so there is no literal fallback anywhere in this pipeline.
    const constantsText = await fs.promises.readFile(path.join(dir, 'build', 'constants.asm'), 'utf8');
    const configText = await fs.promises.readFile(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8');
    const pending = new Map();
    scanEquates(constantsText, pending);
    scanEquates(configText, pending);
    const symbols = new Map();
    resolveEquates(pending, symbols);
    for (const name of ['frame_cnt', 'game_state', 'ST_GAMEPLAY']) {
      if (!symbols.has(name)) throw new Error(`${name} did not resolve out of this build's own constants.asm/config.inc`);
    }

    const named = path.join(outDir, `sw_${key}.nes`);
    await fs.promises.mkdir(outDir, { recursive: true });
    await fs.promises.writeFile(named, romOut);
    // Fix round 1, F10: the symbol file is only ever written into the mkdtemp build directory
    // this function deletes on the way out -- copy it beside the named ROM first, or a debugging
    // session against sw_<key>.nes has no game.fns to resolve addresses from at all.
    if (built.symbolPath) {
      await fs.promises.copyFile(built.symbolPath, path.join(outDir, `sw_${key}.fns`));
    }

    // Fix round 2, MINOR 3: sw_quadrant_check.lua.template instantiated with THIS build's own
    // resolved addresses baked in, beside the ROM it checks -- see the template's own header for
    // why this is generated at JS build time rather than read from a second file at Mesen runtime.
    const template = await fs.promises.readFile(TEMPLATE_PATH, 'utf8');
    const substitutions = {
      __FRAME_CNT__: `0x${symbols.get('frame_cnt').toString(16)}`,
      __GAME_STATE__: `0x${symbols.get('game_state').toString(16)}`,
      __ST_GAMEPLAY__: `${symbols.get('ST_GAMEPLAY')}`
    };
    let generated = template;
    for (const [token, value] of Object.entries(substitutions)) {
      const occurrences = generated.split(token).length - 1;
      if (occurrences !== 1) {
        throw new Error(`expected exactly one occurrence of ${token} in the template, found ${occurrences}`);
      }
      generated = generated.split(token).join(value);
    }
    const luaPath = path.join(outDir, `sw_${key}_check.lua`);
    await fs.promises.writeFile(luaPath, generated, 'utf8');

    console.log(`${key}: built -> ${named} (${romOut.length} bytes)${breakMode && key === 'action' ? ` BROKEN(${breakMode})` : ''}, lua -> ${luaPath}`);
    return named;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

for (const shape of SHAPES) {
  await buildShape(shape);
}
