#!/usr/bin/env node
// Builds ONE streamed-project ROM + generates sw_spawn_adapter.lua (design-streamed-worlds.md's
// obligation 2, "Spawn adapter bound... The 44-cycle charge covers one metadata byte, but the
// streamed metadata is 73 bytes read by spawn_entities. Discharged by: bounding the complete
// adapter (pointer rebasing or actual accessor count, page crossings) and recomputing the
// crossing case.") -- a LANDING scenario (cold boot), not a movement scenario: obligation 1's own
// investigation this slice confirmed spawn_entities/spawn_streamed have no caller from a live
// streamed crossing (grep-confirmed against engine/streamworld.asm and engine/player.asm), so the
// two obligations are genuinely separate scenarios, per the brief's own ruling 4.
//
//   node test/lua/build_sw_spawn_adapter_roms.mjs [outDir] --actors=1|8
//   Mesen --testRunner <outDir>/sw_spawn_adapter.lua <outDir>/sw_spawn_adapter.nes
//
// --actors=8: the landing (start) screen carries MAX_ENTITIES=8 placed actors, one with
// trigger=enter (arm_event's own cost included, matching the design's own crossing-case
// methodology at ~1384). STREAM_OFF_ENTITIES=241 (shared/streamlayout.js) + 9 fields x 8 actors
// (STREAM_ENTITY_RECORD=9) spans offsets 241-312 -- Y (an 8-bit register) wraps past 255 partway
// through actor index 1, so an 8-actor record ALWAYS naturally exercises sw_adv_offset's page-
// crossing branch (`inc mtptr_hi`) without any special engineering. The real, worst-legal case.
// --actors=1: the same landing screen with exactly one actor (no trigger=enter) -- the entity
// block never reaches offset 256, so sw_adv_offset's carry branch never taken. The missing-
// workload negative control (ruling 4): this build's own measured cost must be markedly cheaper.
//
// Fix round 2 (finding D/ruling M): also resolves sw_adv_offset_carry (engine/streamworld.asm's
// own new label, added this round -- a bare exec breakpoint on the branch's target cannot tell
// "reached because the branch fell through" from "reached because it was taken" without also
// comparing PCs by hand) and ent_active (MAX_ENTITIES bytes, shared/streamlayout.js), passing
// __EXPECT_CARRY__ (true only for --actors=8) and __ACTOR_COUNT__ to the template so it can assert
// carry-branch execution evidence (the page-crossing arithmetic actually ran, not just that the
// byte math implies it should have) and spawn-contents evidence (ent_active's own sum after the
// span equals the real actor count baked into this build, not merely "sw_col changed").
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { scanEquates, resolveEquates } from '../lib/equates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE_PATH = path.join(ROOT, 'test/lua/sw_spawn_adapter.lua.template');

const args = process.argv.slice(2);
const actorsArg = args.find((a) => a.startsWith('--actors='));
const actorCount = actorsArg ? Number(actorsArg.slice('--actors='.length)) : 8;
if (actorCount !== 1 && actorCount !== 8) {
  throw new Error(`--actors must be 1 or 8, got ${actorCount}`);
}
const outDir = args.find((a) => !a.startsWith('--')) ?? '/tmp/nesforge-sw-spawn-adapter';

// gridW=3/gridH=2 -- smaller than the driver-timing fixture (no long walk needed here, only a
// cold-boot landing), landing at screen(1,0), away from any edge per the design's own worst-path
// framing (~1503).
const project = createStreamedProject({ gridW: 3, gridH: 2 });
const streamedMap = project.maps[project.maps.length - 1];
const landingScreenIndex = 1; // screen(1,0) of a 3-wide row -- interior column
project.project.startMap = project.maps.indexOf(streamedMap);
project.project.startScreen = landingScreenIndex;

const screen = streamedMap.screens[landingScreenIndex];
screen.entities = screen.entities ?? [];
for (let i = 0; i < actorCount; i++) {
  const actorId = project.sprites.actors.length;
  project.sprites.actors.push({ name: `Adapter${i}`, behavior: 'npc', hp: 1, damage: 0 });
  screen.entities.push({
    actorId,
    x: 20 + i * 20,
    y: 20 + i * 8,
    props: {
      // One TRIG_ENTER actor so arm_event's own cost is included (design ~1385) -- the LAST
      // actor placed, so the count/hide-switch/loop machinery around it is exercised same as
      // every other slot, not a special-cased first record.
      trigger: i === actorCount - 1 ? 'enter' : 'interact',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'wait', frames: 10 }] }] }
    }
  });
}

async function main() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sw-spawn-adapter-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const romBytes = Buffer.from(await fs.promises.readFile(built.romPath));

    const symbolsText = await fs.promises.readFile(built.symbolPath, 'utf8');
    const codeSymbols = parseSymbolFile(symbolsText);
    for (const name of ['spawn_entities', 'build_oam', 'main_loop_ready', 'sw_adv_offset_carry']) {
      if (!Number.isFinite(codeSymbols[name])) throw new Error(`${name} was not a named symbol in game.fns`);
    }

    const constantsText = await fs.promises.readFile(path.join(dir, 'build', 'constants.asm'), 'utf8');
    const configText = await fs.promises.readFile(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8');
    const pending = new Map();
    scanEquates(constantsText, pending);
    scanEquates(configText, pending);
    const ramSymbols = new Map();
    resolveEquates(pending, ramSymbols);
    if (!ramSymbols.has('ent_active')) throw new Error('ent_active did not resolve out of this build\'s own constants.asm/config.inc');

    await fs.promises.mkdir(outDir, { recursive: true });
    const romPath = path.join(outDir, 'sw_spawn_adapter.nes');
    await fs.promises.writeFile(romPath, romBytes);

    const template = await fs.promises.readFile(TEMPLATE_PATH, 'utf8');
    const substitutions = {
      __SPAWN_ENTITIES__: `0x${codeSymbols.spawn_entities.toString(16)}`,
      __BUILD_OAM__: `0x${codeSymbols.build_oam.toString(16)}`,
      __MAIN_LOOP_READY__: `0x${codeSymbols.main_loop_ready.toString(16)}`,
      __SW_ADV_OFFSET_CARRY__: `0x${codeSymbols.sw_adv_offset_carry.toString(16)}`,
      __ENT_ACTIVE__: `0x${ramSymbols.get('ent_active').toString(16)}`,
      __ACTOR_COUNT__: `${actorCount}`,
      __EXPECT_CARRY__: actorCount === 8 ? 'true' : 'false'
    };
    let generated = template;
    for (const [token, value] of Object.entries(substitutions)) {
      const occurrences = generated.split(token).length - 1;
      if (occurrences !== 1) {
        throw new Error(`expected exactly one occurrence of ${token} in the template, found ${occurrences}`);
      }
      generated = generated.split(token).join(value);
    }
    const luaPath = path.join(outDir, 'sw_spawn_adapter.lua');
    await fs.promises.writeFile(luaPath, generated, 'utf8');

    console.log(`built -> ${romPath} (${romBytes.length} bytes) actors=${actorCount}, lua -> ${luaPath}`);
    console.log(`landing: screen(${landingScreenIndex},0), grid 3x2`);
    console.log(`spawn_entities=0x${codeSymbols.spawn_entities.toString(16)} build_oam=0x${codeSymbols.build_oam.toString(16)} sw_adv_offset_carry=0x${codeSymbols.sw_adv_offset_carry.toString(16)} ent_active=0x${ramSymbols.get('ent_active').toString(16)} expect_carry=${actorCount === 8}`);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

main();
