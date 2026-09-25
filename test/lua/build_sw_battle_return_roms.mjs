#!/usr/bin/env node
// Builds the ROM and the generated sw_battle_return_check.lua for the Mesen battle-return/guard
// lifecycle check (fix round 2, review round 3 of 3, finding A6/C1's own required "Mesen battle-
// return/guard check and failing negative control" -- brief-streamed-worlds-phase2-s6-fix2.md).
//
// The unit suite (test/unit/streamworldlifecycle.test.js, Part B) already proves battle-return
// restoration exhaustively against the vendored jsnes core. This is the SAME scenario -- a
// streamed RPG screen, a one-hit-kill monster, a bystander marker NPC -- driven instead through
// Mesen's real, independent core (CLAUDE.md's own "a second, independent emulator, so it and the
// built-in core cross-check each other"), through REAL scripted pad input (the battle menu is
// navigated by real Down/A presses against the real bt_sel byte, not by poking a chosen command
// in directly), with the position-jump guard watched for the whole run.
//
//   node test/lua/build_sw_battle_return_roms.mjs <outDir> [--break=wrong-restore-slot]
//
// Writes <outDir>/battle_return.nes and <outDir>/sw_battle_return_check.lua.
//
// --break=wrong-restore-slot: project.code.overrides carries a COPY of engine/rpg.asm with
// battle_end_status's own `ldx <bt_from_ent` (the real fought entity's own slot) replaced by
// `ldx #0` (always slot 0) -- never touching the real engine file. This is the exact mutation
// test/unit/streamworldlifecycle.test.js's own win-restoration test was sabotage-verified against
// this same fix round: a win now clears whichever entity happens to occupy slot 0, not the one
// that actually fought. The marker NPC is placed so it, not the monster, ends up in slot 0 (spawn
// order follows screen entity order, generate.js's own emitScreens), so this negative control
// removes the SURVIVOR instead of the defeated monster -- the check's own identity assertion must
// catch that.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { parseEquates } from '../../shared/enginesyms.js';
import { createStreamedProject } from '../lib/streamedproject.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE_PATH = path.join(ROOT, 'test/lua/sw_battle_return_check.lua.template');

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--')) ?? '/tmp/nesforge-sw-battle-return-roms';
const breakArg = args.find((a) => a.startsWith('--break='));
const breakMode = breakArg ? breakArg.slice('--break='.length) : null;
const KNOWN_BREAKS = ['wrong-restore-slot'];
if (breakMode && !KNOWN_BREAKS.includes(breakMode)) {
  throw new Error(`unknown --break mode: ${breakMode} (known: ${KNOWN_BREAKS.join(', ')})`);
}

function need(obj, name) {
  const v = obj[name];
  if (v === undefined) throw new Error(`missing symbol/address: ${name}`);
  return v;
}

const MONSTER_ACTOR_ID = 0;
const MARKER_ACTOR_ID = 1;
const LANDING_SCREEN = 0;

async function main() {
  const project = createStreamedProject({ gameType: 'rpg' });
  const streamedMap = project.maps.find((m) => m.streamed === true);

  // Slot spawn order follows screen entity array order (generate.js's own emitScreens) -- the
  // marker is listed FIRST, so it occupies ent_active slot 0 and the monster occupies slot 1. The
  // wrong-restore-slot break (always clears slot 0) therefore removes the marker, not the
  // monster, under this fixture -- a real, checkable divergence rather than a coincidence that
  // could go either way.
  project.sprites.actors[MONSTER_ACTOR_ID] = { name: 'Slime', damage: 1, hp: 1, battle: { acc: 0 } };
  project.sprites.actors[MARKER_ACTOR_ID] = { name: 'Marker', behavior: 'npc', hp: 1, damage: 0 };
  streamedMap.screens[LANDING_SCREEN].entities = [
    { actorId: MARKER_ACTOR_ID, x: project.project.startX + 64, y: project.project.startY, props: {} },
    { actorId: MONSTER_ACTOR_ID, x: project.project.startX, y: project.project.startY + 16, props: {} }
  ];

  if (breakMode === 'wrong-restore-slot') {
    const stockText = await fs.promises.readFile(path.join(ROOT, 'engine/rpg.asm'), 'utf8');
    const needle = '  ldx <bt_from_ent\n  cpx #MAX_ENTITIES';
    if (!stockText.includes(needle)) {
      throw new Error('battle_end\'s own bt_from_ent read did not match the expected shape -- engine/rpg.asm has changed since this override was written; update the needle');
    }
    const patched = stockText.replace(needle, '  ldx #0\n  cpx #MAX_ENTITIES');
    project.code = { overrides: [{ name: 'rpg.asm', text: patched }], files: [] };
  }

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sw-battle-return-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });

    await fs.promises.mkdir(outDir, { recursive: true });
    const romPath = path.join(outDir, 'battle_return.nes');
    await fs.promises.copyFile(built.romPath, romPath);

    const symbolsText = await fs.promises.readFile(built.symbolPath, 'utf8');
    const syms = parseSymbolFile(symbolsText);
    const constantsText = await fs.promises.readFile(path.join(dir, 'build/constants.asm'), 'utf8');
    const ram = parseEquates(constantsText);

    const subs = {
      __GAME_STATE__: need(ram, 'game_state'),
      __FLAT_SCREEN__: need(ram, 'flat_screen'),
      __MAP_IS_STREAMED__: need(ram, 'map_is_streamed'),
      __SCREEN_FRESH__: need(ram, 'screen_fresh'),
      __PLAYER_X__: need(ram, 'player_x'),
      __PLAYER_Y__: need(ram, 'player_y'),
      __ENT_ACTIVE__: need(ram, 'ent_active'),
      __ENT_ACTOR__: need(ram, 'ent_actor'),
      __ENT_X__: need(ram, 'ent_x'),
      __ENT_Y__: need(ram, 'ent_y'),
      __MAX_ENTITIES__: need(ram, 'MAX_ENTITIES'),
      __ST_ACTIVE__: need(ram, 'st_active'),
      __WIN_COL_SCREEN__: need(ram, 'win_col_screen'),
      __WIN_COL_LOCAL__: need(ram, 'win_col_local'),
      __WIN_ROW_SCREEN__: need(ram, 'win_row_screen'),
      __WIN_ROW_LOCAL__: need(ram, 'win_row_local'),
      __SW_CAM_ORIGIN_X_LO__: need(ram, 'sw_cam_origin_x_lo'),
      __SW_CAM_ORIGIN_X_HI__: need(ram, 'sw_cam_origin_x_hi'),
      __SW_CAM_ORIGIN_Y_LO__: need(ram, 'sw_cam_origin_y_lo'),
      __SW_CAM_ORIGIN_Y_HI__: need(ram, 'sw_cam_origin_y_hi'),
      __BT_PHASE__: need(ram, 'bt_phase'),
      __BT_SEL__: need(ram, 'bt_sel'),
      __BP_MENU__: need(ram, 'BP_MENU'),
      __BC_FIGHT__: need(ram, 'BC_FIGHT'),
      __ST_BATTLE__: 5, // ST_BATTLE -- engine/constants.asm's game-state order (shared/project.js's own INPUT_STATES, wire order, not re-derived from a chain equate)
      __ST_GAMEPLAY__: 0, // ST_GAMEPLAY, same source
      __SW_POSITION_JUMP_GUARD__: need(syms, 'sw_position_jump_guard'),
      __MONSTER_ACTOR_ID__: MONSTER_ACTOR_ID,
      __MARKER_ACTOR_ID__: MARKER_ACTOR_ID,
      __MONSTER_X__: project.project.startX,
      __MONSTER_Y__: project.project.startY + 16,
      // Fix round 3, finding 3: the marker's own authored spawn position (screen.entities[0]
      // above), so checkRestoration can assert the survivor's RESTORED position too, not only
      // its identity -- the same test/unit/streamworldlifecycle.test.js contract, cross-checked
      // through Mesen's real core.
      __MARKER_X__: project.project.startX + 64,
      __MARKER_Y__: project.project.startY,
      __BREAK_MODE__: breakMode ? `"${breakMode}"` : 'nil'
    };

    let lua = await fs.promises.readFile(TEMPLATE_PATH, 'utf8');
    for (const [k, v] of Object.entries(subs)) {
      lua = lua.split(k).join(String(v));
    }
    const remaining = lua.match(/__[A-Z0-9_]+__/g);
    if (remaining) throw new Error(`unsubstituted placeholders: ${[...new Set(remaining)].join(', ')}`);
    await fs.promises.writeFile(path.join(outDir, 'sw_battle_return_check.lua'), lua, 'utf8');

    console.log(`[build_sw_battle_return_roms] wrote ${romPath} and sw_battle_return_check.lua (break=${breakMode ?? 'none'})`);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
