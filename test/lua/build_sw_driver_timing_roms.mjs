#!/usr/bin/env node
// Builds ONE streamed-project ROM + generates sw_driver_timing.lua (design-streamed-worlds.md's
// obligation 1, "Driver specification and timing... discharged by: the production driver measured
// in the real engine on UNROM 512 and the frame bound recomputed from it") -- see
// sw_driver_timing.lua.template's own header for the full measurement design.
//
//   node test/lua/build_sw_driver_timing_roms.mjs [outDir] [--break=unconditional-arm|no-spawn] [--idle-only] [--no-actors]
//   Mesen --testRunner <outDir>/sw_driver_timing.lua <outDir>/sw_driver_timing.nes
//
// No flags: the real, unbroken engine, run through the two-leg (Right then Down) busy phase, then
// idle -- the main obligation-1 result (missing-workload self-check, workload evidence, the
// expensive-path max the frame bound is recomputed from, the full-mainline-body max the frame
// inequality is recomputed from).
// --idle-only (no --break): the SAME unbroken engine, but through the idle-only harness shape (no
// busy phase, input never held) -- a true apples-to-apples baseline for the extra-cost control
// below, since the ordinary run's own "cheap" frames come from a busy phase that also walks real
// screen crossings, not a scenario that ever stands genuinely idle from boot.
// --break=unconditional-arm: project.code.overrides carries a COPY of engine/streamworld.asm (the
// real repo file is never touched) with sw_win_arm's own comparison chain replaced by an
// unconditional `jmp sw_win_arm_col_inc` -- every single frame pays the real column-arm work
// regardless of st_active or any desired/current match. Always run idle-only (implied) -- the extra-
// cost negative control ruling 4 requires alongside the missing-workload one already in the
// template, compared in the shell script against the plain --idle-only unbroken baseline (both runs
// share the same idle-only harness shape; only the engine code differs).
// --break=no-spawn: project.code.overrides carries a COPY of engine/streamworld.asm with the
// RIGHT-crossing handler's own `jsr spawn_entities` (the real per-crossing respawn call,
// sw_pr_c2/sw_cross_right's own tail) replaced by three NOPs -- fix round 2's own ownership/respawn
// evidence check (ent_active read before/after the Right crossing) must FAIL against this build even
// though sw_col still changes, closing the gap review round 2's own review-s4b-round2-no-spawn.mjs
// investigation found (a crossing that moves sw_col but never actually spawns the new screen's
// entities). Always idle-only is NOT implied here -- the busy phase is exactly what exercises the
// crossing this mode breaks, so this mode forces the ordinary two-leg busy phase regardless of
// --idle-only.
// --no-actors: the SAME grid/landing, but with 0 actors on every screen (instead of the real 8/4
// busy-actor placement below) -- the missing-workload negative control for the NEW full-mainline-
// body metric (fix round 2/ruling M): this build's own mainline max must be markedly cheaper than
// the real 8-actor build's, proving the reported mainline figure is sensitive to real actor AI cost,
// not a phantom number.
//
// (test/lua/run_sw_driver_timing_check.sh runs the unbroken pass and the broken comparisons.)
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
const TEMPLATE_PATH = path.join(ROOT, 'test/lua/sw_driver_timing.lua.template');

const args = process.argv.slice(2);
const breakArg = args.find((a) => a.startsWith('--break='));
const breakMode = breakArg ? breakArg.slice('--break='.length) : null;
if (breakMode && breakMode !== 'unconditional-arm' && breakMode !== 'no-spawn') {
  throw new Error(`unknown --break mode: ${breakMode}`);
}
const idleOnly = args.includes('--idle-only') || breakMode === 'unconditional-arm';
const noActors = args.includes('--no-actors');
const reportArg = args.find((a) => a.startsWith('--report='));
const reportMetric = reportArg ? reportArg.slice('--report='.length) : 'expensive';
if (reportMetric !== 'cheap' && reportMetric !== 'expensive' && reportMetric !== 'mainline') {
  throw new Error(`unknown --report metric: ${reportMetric}`);
}
const outDir = args.find((a) => !a.startsWith('--')) ?? '/tmp/nesforge-sw-driver-timing';

// Fix round 2 (finding D/ruling M): the review round 2 finding was specific and demonstrated --
// review-s4b-round2-high.mjs proved the OLD 12x2 grid (landing (5,0)) undermeasured the real worst
// case because a small grid never lets 8-bit signed world coordinates and the region-packed PRG
// layout (61 8 KB regions on UNROM 512, ~1 region per grid ROW regardless of width -- see this
// slice's own empirical finding while writing the ruling-N tests) exercise their own high-byte
// paths. 3 wide x 61 tall (the packing ceiling itself) landing at (1,58) -- an interior column, two
// rows from the tall edge -- is the legal worst-case shape this obligation's own text calls for
// ("a legal 3x61-region map landing at (1,58)"), folded into the real builder rather than kept as a
// separate prototype script.
const GRID_W = 3;
const GRID_H = 61;
const LANDING_COL = 1;
const LANDING_ROW = 58;
const screenIndex = (col, row) => row * GRID_W + col;
const LANDING_SCREEN_INDEX = screenIndex(LANDING_COL, LANDING_ROW);
// The Right-leg's landing screen -- MAX_ENTITIES=8 real chasers with contact damage, the same
// canonical "busiest legal" shape design-streamed-worlds.md's own §5.2413 entry and
// proto-tools/diag_f18_busy_frame.mjs already established for the ordinary (non-streamed) engine's
// own worst mainline body -- reused here rather than inventing a second worst-case definition. The
// LANDING screen itself carries 0 actors (see below) so ent_active reads a clean 0-before/N-after
// transition on the crossing that first reaches this screen -- real ownership/respawn evidence, not
// merely sw_col changing.
const RIGHT_TARGET_COL = LANDING_COL + 1;
const RIGHT_TARGET_ROW = LANDING_ROW;
const RIGHT_TARGET_INDEX = screenIndex(RIGHT_TARGET_COL, RIGHT_TARGET_ROW);
const RIGHT_TARGET_ACTORS = 8;
// The Down-leg's landing screen (reached from the Right-target screen) -- a DIFFERENT actor count
// (4, not 8) so its own ent_active transition (8 -> 4) is unambiguous evidence of a real respawn on
// the SECOND (row-orientation) crossing too, distinct from merely "the count happens to match again
// by coincidence". Still real, busy chasers -- covers "unaligned strip fetches in both orientations"
// (ruling M) with genuine per-frame AI workload on both legs of the walk, not a synthetic probe.
const DOWN_TARGET_COL = RIGHT_TARGET_COL;
const DOWN_TARGET_ROW = LANDING_ROW + 1;
const DOWN_TARGET_INDEX = screenIndex(DOWN_TARGET_COL, DOWN_TARGET_ROW);
const DOWN_TARGET_ACTORS = 4;

const project = createProject('Streamed Driver Timing Check', 'action');
project.cartridge.mapper = 30; // UNROM 512 -- the only streamed-capable board, and the board
project.cartridge.mirroring = 'fourscreen'; // obligation 1 itself names ("measured... on UNROM 512")
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

function placeChasers(screenIdx, count) {
  if (noActors || count <= 0) return;
  const screen = map.screens[screenIdx];
  screen.entities = screen.entities ?? [];
  for (let i = 0; i < count; i++) {
    const actorId = project.sprites.actors.length;
    // damage: 0 -- a real 'chaser' still runs its own per-frame pursuit AI every frame it is
    // active (the actual busy cost this fixture needs), but MAX_HEARTS is clamped [1,6]
    // (shared/project.js) and this harness holds input for hundreds of frames right next to a
    // pack of MAX_ENTITIES=8 chasers -- real contact damage killed the player and sent
    // update_player down player_died's own reset/respawn cascade well before the measurement
    // window finished (confirmed empirically, first attempt), a large one-off cost spike
    // unrelated to what this fixture is trying to measure. Suppressing damage keeps the AI real
    // and busy without that confound; disclosed as a deviation from design-streamed-worlds.md's
    // own canonical "8 chasers WITH contact damage" ordinary-engine shape.
    project.sprites.actors.push({ name: `Chaser${screenIdx}_${i}`, behavior: 'chaser', hp: 1, damage: 0 });
    screen.entities.push({ actorId, x: 20 + (i % 4) * 40, y: 20 + Math.floor(i / 4) * 40, props: { trigger: 'interact' } });
  }
}
placeChasers(RIGHT_TARGET_INDEX, RIGHT_TARGET_ACTORS);
placeChasers(DOWN_TARGET_INDEX, DOWN_TARGET_ACTORS);

if (breakMode === 'unconditional-arm' || breakMode === 'no-spawn') {
  const stockPath = path.join(ROOT, 'engine', 'streamworld.asm');
  const stockText = fs.readFileSync(stockPath, 'utf8');
  let patched;
  if (breakMode === 'unconditional-arm') {
    const needle =
      'sw_win_arm:\n' +
      '  lda win_col_screen\n' +
      '  cmp sw_fc_desc\n' +
      '  bne sw_win_arm_col_try\n' +
      '  lda win_col_local\n' +
      '  cmp sw_fc_desl\n' +
      '  beq sw_win_arm_row\n' +
      'sw_win_arm_col_try:\n' +
      '  lda st_active\n' +
      '  bne sw_win_arm_row\n';
    if (!stockText.includes(needle)) {
      throw new Error('sw_win_arm\'s own comparison chain text did not match the expected shape -- engine/streamworld.asm has changed since this override was written; update the needle');
    }
    patched = stockText.replace(needle, 'sw_win_arm:\n  jmp sw_win_arm_col_inc\nsw_win_arm_col_try:\n');
  } else {
    // no-spawn: the Right-crossing handler's own tail (sw_pr_c2, near sw_cross_right) --
    // review-s4b-round2-no-spawn.mjs's own reproducer, folded into the real builder.
    const needle = '  jsr sw_cross_right\n  jsr sw_locate_current\n  jsr spawn_entities\n';
    if (!stockText.includes(needle)) {
      throw new Error('the Right-crossing handler\'s own call sequence did not match the expected shape -- engine/streamworld.asm has changed since this override was written; update the needle');
    }
    patched = stockText.replace(needle, '  jsr sw_cross_right\n  jsr sw_locate_current\n  nop\n  nop\n  nop\n');
  }
  project.code = { overrides: [{ name: 'streamworld.asm', text: patched }], files: [] };
}

async function main() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-sw-driver-timing-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const romBytes = Buffer.from(await fs.promises.readFile(built.romPath));

    const symbolsText = await fs.promises.readFile(built.symbolPath, 'utf8');
    const codeSymbols = parseSymbolFile(symbolsText);
    for (const name of ['update_player', 'update_entities', 'main_loop_after_player', 'main_loop_body_start', 'main_loop_ready']) {
      if (!Number.isFinite(codeSymbols[name])) throw new Error(`${name} was not a named symbol in game.fns`);
    }

    const constantsText = await fs.promises.readFile(path.join(dir, 'build', 'constants.asm'), 'utf8');
    const configText = await fs.promises.readFile(path.join(dir, 'build', 'assets', 'config.inc'), 'utf8');
    const pending = new Map();
    scanEquates(constantsText, pending);
    scanEquates(configText, pending);
    const ramSymbols = new Map();
    resolveEquates(pending, ramSymbols);
    const RAM_NAMES = ['game_state', 'ST_GAMEPLAY', 'map_is_streamed', 'sw_col', 'sw_row', 'st_active', 'ent_active'];
    for (const name of RAM_NAMES) {
      if (!ramSymbols.has(name)) throw new Error(`${name} did not resolve out of this build's own constants.asm/config.inc`);
    }

    await fs.promises.mkdir(outDir, { recursive: true });
    const romPath = path.join(outDir, 'sw_driver_timing.nes');
    await fs.promises.writeFile(romPath, romBytes);

    const template = await fs.promises.readFile(TEMPLATE_PATH, 'utf8');
    const substitutions = {
      __UPDATE_PLAYER__: `0x${codeSymbols.update_player.toString(16)}`,
      __MAIN_LOOP_AFTER_PLAYER__: `0x${codeSymbols.main_loop_after_player.toString(16)}`,
      __MAIN_LOOP_BODY_START__: `0x${codeSymbols.main_loop_body_start.toString(16)}`,
      __MAIN_LOOP_READY__: `0x${codeSymbols.main_loop_ready.toString(16)}`,
      __GAME_STATE__: `0x${ramSymbols.get('game_state').toString(16)}`,
      __ST_GAMEPLAY__: `${ramSymbols.get('ST_GAMEPLAY')}`,
      __MAP_IS_STREAMED__: `0x${ramSymbols.get('map_is_streamed').toString(16)}`,
      __SW_COL__: `0x${ramSymbols.get('sw_col').toString(16)}`,
      __SW_ROW__: `0x${ramSymbols.get('sw_row').toString(16)}`,
      __ST_ACTIVE__: `0x${ramSymbols.get('st_active').toString(16)}`,
      __ENT_ACTIVE__: `0x${ramSymbols.get('ent_active').toString(16)}`,
      __IDLE_ONLY__: idleOnly ? 'true' : 'false',
      __EXPECT_RESPAWN_EVIDENCE__: noActors ? 'false' : 'true',
      __REPORT_METRIC__: reportMetric
    };
    let generated = template;
    for (const [token, value] of Object.entries(substitutions)) {
      const occurrences = generated.split(token).length - 1;
      if (occurrences !== 1) {
        throw new Error(`expected exactly one occurrence of ${token} in the template, found ${occurrences}`);
      }
      generated = generated.split(token).join(value);
    }
    const luaPath = path.join(outDir, 'sw_driver_timing.lua');
    await fs.promises.writeFile(luaPath, generated, 'utf8');

    console.log(`built -> ${romPath} (${romBytes.length} bytes)${breakMode ? ` BROKEN(${breakMode})` : ''}${idleOnly ? ' idle-only' : ''}${noActors ? ' no-actors' : ''}, lua -> ${luaPath}`);
    console.log(`landing: screen(${LANDING_COL},${LANDING_ROW}) index ${LANDING_SCREEN_INDEX}, grid ${GRID_W}x${GRID_H}`);
    console.log(`right target: screen(${RIGHT_TARGET_COL},${RIGHT_TARGET_ROW}) index ${RIGHT_TARGET_INDEX} actors=${noActors ? 0 : RIGHT_TARGET_ACTORS}`);
    console.log(`down target: screen(${DOWN_TARGET_COL},${DOWN_TARGET_ROW}) index ${DOWN_TARGET_INDEX} actors=${noActors ? 0 : DOWN_TARGET_ACTORS}`);
    console.log(`update_player=0x${codeSymbols.update_player.toString(16)} main_loop_body_start=0x${codeSymbols.main_loop_body_start.toString(16)} main_loop_after_player=0x${codeSymbols.main_loop_after_player.toString(16)} update_entities=0x${codeSymbols.update_entities.toString(16)}`);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

main();
