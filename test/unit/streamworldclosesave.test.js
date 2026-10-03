// Large streamed worlds (ROADMAP item 15), phase 2 slice 9 -- Close-for-Save (+ the Continue
// runtime row carried in from slice 6).
//
// handoff-next/brief-streamed-worlds-phase2-s9.md / handoff-next/streamed-worlds-phase2-plan.md
// (line 1403, "Slice 9 -- Close-for-Save"): a flash-save committed while a dialogue box is open on
// a streamed map used to be refused outright (shared/project.js's own "Item 7"). This slice lifts
// that refusal (positive build test: test/unit/streamworld.test.js's own "D.7 positive" case) by
// making the box draw down correctly first, the direct architectural sibling of phase 2 slice 8's
// close-for-Move:
//
// - engine/save.asm's script_op_save composes the record (invalidate, identity, body, checksum,
//   marker) UNCONDITIONALLY, before the streamed dispatch check even runs -- so the record is
//   always fully formed by the time script_op_save_dispatch reads map_is_streamed, and no field a
//   save records (shared/save.js's SAVE_FIELDS: flat_screen, player_x/y/dir/hp, switches,
//   variables, inventory, party) can change during the deferred window that follows, because
//   nothing on that window's own path ever reaches update_player/update_entities (this file's own
//   "no movement/event dispatch on the completion frame" tests prove that structurally, not just
//   for the frames already known to hold the box's own draw-down).
// - On an ordinary map (or a mixed project's ordinary map), script_op_save_dispatch's one compare
//   (map_is_streamed) falls straight through to the unmodified, unconditional immediate commit --
//   present and executing for every Save in a mixed-project build, but taking no streamed-state
//   reads, close, or resync after that branch (finding 10's corrected framing).
// - On a streamed map with no box open (box_state == BOX_CLOSED), sw_dlg20_save_dispatch commits
//   immediately too, but through sw_save_resync's own 3-step tail (full sw_render_window redraw,
//   every OAM pass plus manual DMA, real scroll republish) instead of the ordinary path's
//   enable_rendering(0,0), since enable_rendering would zero a nonzero camera origin the world
//   never actually moved from.
// - On a streamed map with a box open, sw_dlg20_save_dispatch advances script_ptr past Save's own
//   one-byte opcode exactly once (script_skip(1), script_next1's own skip amount), sets
//   sw_dlg20_save_pending, and requests the box's own ordinary close (box_close) -- reusing slice
//   8's own close path, no second close mechanism. script_active/script_ptr/talk_ent/game_state
//   all survive untouched; nothing on this path calls close_ui. The real completion hook is
//   engine/streamworld.asm's sw_dlg20_pending_tick, called from engine/boot.asm's own
//   main_loop_save_gate every single main_loop pass while sw_dlg20_save_pending is set, AHEAD of
//   dispatch_input -- fix round 1's own correction (round 1 review finding A1): a real controller
//   press reaching do_action_dialog/do_action_pause while a Save is pending must never happen, so
//   dispatch_input does not run at all in this window (see the "A1 regression" tests below), not
//   just the completion poll's own priority within it. Checked once sw_dlg15_state has drained
//   back to SW_DLG15_IDLE (engine/streamworld.asm's sw_dlg17_camrelease sets IDLE and, unlike an
//   ordinary release, returns immediately instead of falling into close_ui/sw_dlg_closeformove_
//   check when sw_dlg20_save_pending is set -- the same "acknowledge here, resolve on a later
//   poll" split close-for-Move's own camrelease/ui_tick pair already uses).
//
// Every expected value below is either read directly off a real, driven sequence (never a
// hardcoded frame count -- driveUntil), or computed independently in plain JS from shared/save.js's
// own SAVE_FIELDS table, shared/cartridge.js's own flashSaveSectorBank, or shared/project.js's own
// flatScreens (never a JS restatement of the engine's own algorithm, and never read back from the
// routine under test).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { validateProject, flatScreens, createProject, createMap, createScreen } from '../../shared/project.js';
import { saveBodySize, SAVE_FIELDS } from '../../shared/save.js';
import { createStreamedProject } from '../lib/streamedproject.js';
import { engineFileNames, checkCapacity, kernelCodeBytes, kernelTableBytes, planStreamedRegions } from '../../main/build/generate.js';
import { resolveMapper, prgLayout } from '../../shared/cartridge.js';
import { mergeReconstructEngineFile } from '../lib/enginehistory.js';
import { emitStreamedLayout } from '../../main/build/streamed.js';
import { decodeStreamedLayout } from '../lib/streamdecoder.js';
import NES from '../../renderer/emulator/core/nes.js';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const hasNesasm = spawnSync('nesasm', [], { stdio: 'ignore' }).error?.code !== 'ENOENT';

// engine/constants.asm -- hardcoded per CLAUDE.md's own rule (a test that reads the file it is
// checking proves nothing). Same build, same addresses test/unit/streamworldclosemove.test.js
// already hardcodes for the shared ones.
const GAME_STATE = 0x25;
const ST_GAMEPLAY = 0;
const ST_DIALOG = 2;
const ST_TITLE = 3;
const MAP_IS_STREAMED = 0xfe;
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const PLAYER_DIR = 0x12; // engine/constants.asm:25 -- 0 down, 1 up, 2 left, 3 right
const ANIM_FRAME = 0x13; // engine/constants.asm:26 -- 0 or 1
const FLAT_SCREEN = 0x16;
const BOX_STATE = 0x40;
const BOX_CLOSED = 0;
const BOX_CLOSING = 5;
const BOX_ENDWAIT = 6;
const ST_ACTIVE = 0x5b5; // engine/constants.asm:1115 -- 0 idle, 1 column strip, 2 row strip
const VRAM_READY = 0x3f;
const VRAM_LEN = 0x3c; // test/unit/streamworldclosemove.test.js's own hardcoded figure
const SW_DLG15_STATE = 0xf3;
const SW_DLG15_IDLE = 0;
const SW_DLG15_DRAINING = 2;
const SCRIPT_PTR_LO = 0x47;
const SCRIPT_PTR_HI = 0x48;
const SCRIPT_ACTIVE = 0x49;
const TALK_ENT = 0x3a;
const CAM_X_LO = 0xaf; // test/unit/streamworldclosemove.test.js's own hardcoded figure
const CAM_Y_LO = 0xb0;
const CAM_NT = 0xb1;
// Phase 2 slice 9's own new byte -- engine/constants.asm:1291.
const SW_DLG20_SAVE_PENDING = 0x07f8;
const PENDING_ENT = 0x7c; // engine/constants.asm:86
const SCREEN_FRESH = 0x7d; // engine/constants.asm:91
const NO_ENTITY = 0xff; // engine/constants.asm:1334
const BOX_CHOICEWAIT = 8; // engine/constants.asm:1575
const MV_LEFT = 0x96; // test/unit/streamworldclosemove.test.js's own hardcoded figure

const B = 1;
const SELECT = 2;
const START = 3;
const UP = 4;
const DOWN = 5;
const LEFT = 6;
const RIGHT = 7;

// Flash sector geometry -- identical constants test/unit/flashsave.test.js and
// test/unit/flashdriver.test.js already hardcode (shared/cartridge.js's flashSaveSectorBank(30) ==
// bank 30, offset $3000, fixed regardless of project). SAVE_RECORD_LEN is computed from
// shared/save.js's own saveBodySize() (never a hand-copied figure): body + 2-byte checksum +
// 4-byte identity + 1-byte marker, and SAVE_FIELDS is unconditional -- the same for an action or
// RPG project -- so this is 127 for either game type, confirmed by the computation itself rather
// than assumed from flashsave.test.js's own RPG-only figure.
const SAVE_BANK = 30;
const SECTOR_OFFSET = 0x3000;
const SAVE_RECORD_LEN = saveBodySize() + 2 + 4 + 1;
// Round 3, A-blocking 1: the record's own RAM staging buffer -- generate.js's own
// `SAVE_BASE = flashSaveCapable(mapper) ? 0x0700 : 0x6000` (main/build/generate.js:4879); every
// project this file builds uses mapper 30 (flash-capable), so this is always save_flash_buf
// (engine/constants.asm:1253) -- SAVE_RECORD_LEN bytes: body, checksum, identity and marker, in
// that order (engine/save.asm's own header comment), the exact bytes save_media_commit programs
// verbatim into the flash sector.
const SAVE_BASE = 0x0700;
const SAVE_MARKER_OFFSET = SAVE_RECORD_LEN - 1;
const SAVE_MARKER_VALID = 0xa5;
// The record's body is written field-by-field, in shared/save.js's own SAVE_FIELDS order, as the
// FIRST bytes of the record (main/build/generate.js: SAVE_CHECKSUM_LO/HI, then identity, then
// SAVE_MARKER, all land AFTER the body in RAM at SAVE_BASE, and the flash sector is a verbatim
// byte-for-byte copy of that same layout -- engine/flash.asm's own header comment). flat_screen is
// SAVE_FIELDS[0], player_x is SAVE_FIELDS[1], player_y is SAVE_FIELDS[2] -- each 1 byte.
const RECORD_FLAT_SCREEN_OFFSET = 0;
const RECORD_PLAYER_X_OFFSET = 1;
const RECORD_PLAYER_Y_OFFSET = 2;

function sectorMarker(nes) {
  return nes.rom.rom[SAVE_BANK][SECTOR_OFFSET + SAVE_MARKER_OFFSET];
}
function sectorByte(nes, offset) {
  return nes.rom.rom[SAVE_BANK][SECTOR_OFFSET + offset];
}
/** camera.test.js's own real-PPU-register scroll reader -- the literal target of the $2005
 * writes, never an engine-side RAM copy of them. */
function scrollX(nes) {
  return nes.ppu.regH * 256 + nes.ppu.regHT * 8 + nes.ppu.regFH;
}
function scrollY(nes) {
  return nes.ppu.regV * 240 + nes.ppu.regVT * 8 + nes.ppu.regFV;
}
// ---------------------------------------------------------------------------------------------
// Boot/drive harness -- test/unit/streamworldclosemove.test.js's own conventions, copied locally
// per this codebase's established per-suite-duplication rule.
// ---------------------------------------------------------------------------------------------

async function buildAndBoot(project, { requireStreamed = true, overrides = null } = {}) {
  if (overrides) project.code = { overrides, files: [] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-closesave-boot-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const romPath = built.romPath;
    const bytes = new Uint8Array(fs.readFileSync(romPath));
    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(bytes);
    const mem = nes.cpu.mem;
    const symbols = fs.readFileSync(built.symbolPath, 'utf8');
    const addrOf = (label) => {
      const m = symbols.match(new RegExp(`^${label}\\s+=\\s+\\$([0-9A-Fa-f]+)`, 'm'));
      assert.ok(m, `${label} should be a named symbol in game.fns`);
      return parseInt(m[1], 16);
    };
    // Every project in this file carries a live Save command, which forces TITLE_ENABLED on
    // regardless of titleMap (main/build/generate.js: `usesTitle = projectUsesEffectiveTitle(project)
    // || projectUsesSave(project)`) -- so cold boot lands on ST_TITLE, not ST_GAMEPLAY, and Start is
    // the hardwired button that begins a new game from there (engine/title.asm's title_tick_input:
    // `and #BTN_START / jmp start_game`, unconditionally, no naming/binding involved).
    // reset's own boot_clear zeroes the whole $0000-$07FF page (including game_state) before
    // TITLE_ENABLED's own `lda #ST_TITLE / sta game_state` runs a few frames later -- so
    // mem[GAME_STATE] transiently reads 0 (coincidentally == ST_GAMEPLAY) for the first couple of
    // real frames. Every project in this file carries a live Save command, which forces
    // TITLE_ENABLED on unconditionally (main/build/generate.js's own `usesTitle =
    // projectUsesEffectiveTitle(project) || projectUsesSave(project)`), so this always waits for
    // the REAL ST_TITLE specifically -- accepting that transient 0 as "done" here would skip the
    // Start press entirely and strand every later frame at the title with no way out.
    let frames = 0;
    do {
      nes.frame();
      frames++;
    } while (mem[GAME_STATE] !== ST_TITLE && frames < 200);
    assert.ok(frames < 200, 'cold boot must reach ST_TITLE within 200 frames');
    // game_state is stored to ST_TITLE (engine/boot.asm:76-77) long before reset finishes its own
    // work -- init_session, the whole title screen's draw_screen/spawn_entities/build_oam pass, and
    // enable_rendering all still have to run, and NMI (hence read_pad and main_loop) stays off
    // (engine/boot.asm:11, re-armed only by enable_rendering) until that finishes. jsnes's own
    // nes.frame() just burns one NTSC frame's worth of CPU cycles rather than stopping at engine
    // frame boundaries, so a handful of extra frame() calls are still mid-reset with input dead.
    // Binary search (handoff-next/s9-boot-diag3.mjs/-diag4.mjs) found 30 idle frames after ST_TITLE
    // is first observed still stuck, 34 works; this settles for 40 for margin.
    for (let i = 0; i < 40; i++) nes.frame();
    nes.buttonDown(1, START);
    nes.frame();
    nes.buttonUp(1, START);
    frames = 0;
    while ((mem[GAME_STATE] !== ST_GAMEPLAY || (requireStreamed && mem[MAP_IS_STREAMED] !== 1)) && frames < 200) {
      nes.frame();
      frames++;
    }
    assert.ok(frames < 200, 'cold boot must reach ST_GAMEPLAY within 200 frames');
    for (let i = 0; i < 100; i++) nes.frame();
    return { nes, mem, romPath, addrOf };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * PC-hook-based commit-boundary observation (fix round 1b, gap 2). Wraps nes.cpu.emulate the same
 * way test/unit/streamworldclosemove.test.js's own sabotage tests already do (matching `nes.cpu.
 * REG_PC + 1` -- jsnes's own emulate() is entered with REG_PC one byte behind the real fetch
 * address -- against an address read out of the SAME build's game.fns, never a hardcoded number),
 * but as a passive counter rather than a PC-triggered mutation: every real instruction-level entry
 * into `label`'s address increments a counter, so "how many times did save_media_commit actually
 * run" and "how many real main_loop passes happened" are counted at instruction granularity,
 * never approximated by nes.frame() counts (main_loop can run zero or more than once inside a
 * single nes.frame() call whenever NMI timing shifts a pass across the call boundary, so a frame
 * count is not the same claim as a pass count).
 */
function countPcEntries(nes, addr) {
  const origEmulate = nes.cpu.emulate.bind(nes.cpu);
  const state = { count: 0, stopped: false };
  nes.cpu.emulate = () => {
    if ((nes.cpu.REG_PC + 1) === addr) state.count++;
    return origEmulate();
  };
  state.stop = () => {
    if (!state.stopped) {
      nes.cpu.emulate = origEmulate;
      state.stopped = true;
    }
  };
  return state;
}

/** sw_save_resync's own full sw_render_window redraw (a whole-viewport rebuild, unlike the
 * incremental one-column/-row redraw an ordinary camera scroll does) is genuinely CPU-cycle-heavy,
 * not a bug: an empirical trace (handoff-next/s9-diag-pc2.mjs, handoff-next/s9-diag-committiming.mjs)
 * shows the flash marker itself lands within a handful of frames of the triggering press (the
 * commit proper), but game_state does not return to ST_GAMEPLAY until roughly 35 nes.frame() calls
 * later -- the whole redraw+OAM+scroll-republish tail runs as one continuous, non-interruptible
 * call, the same cost boot's own cold-start sw_render_window call already pays for a streamed start
 * map. "Commits immediately, no deferral" (the design's own words) means the commit is not gated on
 * a box closing first, not that the wall-clock cost of composing the whole window is zero. Any
 * assertion that needs the commit to have FULLY resolved (game_state back at ST_GAMEPLAY, the real
 * PPU scroll registers republished) must wait it out with this, not assume the very next frame.
 * Budget matches test/unit/streamworldclosemove.test.js's own accepted convention for an analogous
 * camera-release wait (60), widened to 80 for this comfortable margin over the ~35 observed. */
function waitForResync(nes, mem, budget = 80) {
  const frames = driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, budget);
  assert.ok(frames < budget, 'the deferred/immediate commit\'s own resync must actually finish within budget');
}

function driveUntil(nes, mem, predicate, maxFrames = 400) {
  let frames = 0;
  while (!predicate(mem) && frames < maxFrames) {
    nes.frame();
    frames++;
  }
  return frames;
}

function walkToward(nes, mem, targetX, targetY, budget = 400) {
  for (let step = 0; step < budget; step++) {
    const x = mem[PLAYER_X];
    const y = mem[PLAYER_Y];
    const buttons = [];
    if (x < targetX - 2) buttons.push(RIGHT);
    else if (x > targetX + 2) buttons.push(LEFT);
    if (y < targetY - 2) buttons.push(DOWN);
    else if (y > targetY + 2) buttons.push(UP);
    if (!buttons.length) return true;
    for (const button of buttons) nes.buttonDown(1, button);
    nes.frame();
    for (const button of buttons) nes.buttonUp(1, button);
  }
  return false;
}

function walkToEntity(nes, mem, screenBase, slot, budget = 400) {
  return walkToward(nes, mem, mem[screenBase.entX + slot], mem[screenBase.entY + slot], budget);
}

const ENT_X = 0x0310;
const ENT_Y = 0x0318;

/**
 * A minimal mixed project (one streamed map, one ordinary map) -- deliberately NOT
 * createStreamedProject({mixed:true}), whose own hardcoded 2x2-Before/2x2-After shape (8 ordinary
 * screens) was confirmed, by a scratch build check (handoff-next/s9-mixed-budget-check.mjs), to
 * already overflow kernel-lo the instant a live Save command is added -- by a FIXED amount
 * independent of the streamed map's own grid size, and already present (via `git stash`
 * isolation) at 2563ef4 before any of this slice's own bytes existed, so a project needed only a
 * capacity-blind refusal (Item 7) to never actually reach that wall until now. This shape (one
 * ordinary map, two screens, so a real cross_left still has somewhere to go; one streamed map, TWO
 * screens wide -- a 1x1 streamed map's camera window equals the whole world and can never actually
 * slide, so "nonzero camera origin" is unreachable on it; confirmed both 1x1 and 2x1 fit the same
 * kernel-lo budget, handoff-next/s9-mixed-budget-check6.mjs) was confirmed to fit
 * (handoff-next/s9-mixed-budget-check5.mjs, -check6.mjs) with a live Save command present.
 * Reproduces the same natural flat/ord collision the larger shape has: the ordinary map's own
 * screen 0 gets ord_screen 0 (Streamed claims flat ids first, contributing no ord rows at all),
 * which numerically collides with the Streamed map's own screen 0's flat id (also 0) --
 * independent of exact map sizes, per flatScreens' own global-then-per-type-compaction order.
 */
// Round 3, finding A-blocking 2: mirrors test/lib/streamedproject.js's own streamedScreen
// (per-suite duplication convention, not imported) -- a deterministic, position-dependent pattern
// so this project's own two streamed screens are NOT identical to each other. The old fixture used
// createScreen() directly (every metatile id 0, uniform), so even after nonzeroTerrainFixture gave
// each metatile id its own tile/palette, only id 0 was EVER placed and both screens rendered
// identically -- a content scan could never distinguish a correct copy from a wrong-screen or
// wrong-offset one on the mixed shape specifically.
function mixedStreamedScreen(col, row) {
  const screen = createScreen();
  const variedCount = Math.floor(screen.metatiles.length / 3);
  for (let i = 0; i < screen.metatiles.length; i++) {
    screen.metatiles[i] = i < variedCount ? 1 + ((col + row + i) % 3) : 0;
  }
  return screen;
}

function createMinimalMixedProject({ gameType = 'action' } = {}) {
  const project = createProject('Mixed Test', gameType);
  project.cartridge.mapper = 30;
  project.cartridge.mirroring = 'fourscreen';
  project.cartridge.camera = true;
  const streamedMap = createMap(0, 'Streamed');
  streamedMap.gridW = 2;
  streamedMap.gridH = 1;
  streamedMap.streamed = true;
  streamedMap.fillMetatileId = 0;
  streamedMap.screens = [mixedStreamedScreen(0, 0), mixedStreamedScreen(1, 0)];
  const ordinaryMap = createMap(1, 'Ordinary');
  ordinaryMap.gridW = 2;
  ordinaryMap.gridH = 1;
  ordinaryMap.screens = [createScreen(), createScreen()];
  project.maps = [streamedMap, ordinaryMap];
  return { project, streamedMap, ordinaryMap };
}

function interactOn(screen, project, { x, y, commands, actorName = 'NPC' }) {
  const actorId = project.sprites.actors.length;
  project.sprites.actors.push({ name: actorName, behavior: 'npc', hp: 1, damage: 0 });
  screen.entities = screen.entities ?? [];
  const slot = screen.entities.length;
  screen.entities.push({ actorId, x, y, props: { trigger: 'interact', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } });
  return slot;
}

function pressOnce(nes, button) {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
}

function say(text) {
  return { op: 'say', text };
}
function moveUp(dist) {
  return { op: 'move', who: 'player', dir: 'up', dist };
}
function saveCmd() {
  return { op: 'save' };
}

/** Walks the player away from spawn until the real camera scroll registers actually go nonzero --
 * a real, driven walk, never a poked register -- so "at a nonzero camera origin" (obligation 4's
 * own required condition, finding 10) is genuine engine state, not an assumption. */
function walkToNonzeroCamera(nes, mem, budget = 300) {
  for (let i = 0; i < budget && (scrollX(nes) === 0 || mem[CAM_X_LO] === 0); i++) {
    nes.buttonDown(1, RIGHT);
    nes.frame();
    nes.buttonUp(1, RIGHT);
  }
  assert.notEqual(mem[CAM_X_LO], 0, 'sanity: walking right must actually produce a nonzero camera origin within budget');
  assert.notEqual(scrollX(nes), 0, 'sanity: the real PPU scroll register must also read nonzero');
}

// =================================================================================================
// Positive: build (Item 7 lifted) -- also covered, in more detail, by test/unit/streamworld.test.js's
// own "D.7 positive (lifted, slice 9)" test; kept here too since this file's own brief requires it.
// =================================================================================================

test('positive build: a live Save reachable behind an open dialogue box on a streamed map builds clean (Item 7 lifted)', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  interactOn(project.maps[project.maps.length - 1].screens[0], project, { x: 200, y: 112, commands: [say('Hi.'), saveCmd(), say('Bye.')] });
  const errors = validateProject(project).filter((e) => e.severity === 'error');
  assert.deepEqual(errors, [], `close-for-Save must lift the old refusal: ${JSON.stringify(errors)}`);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-closesave-buildclean-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    assert.ok(fs.existsSync(built.romPath));
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

// =================================================================================================
// Obligation 4 discharge: no-box streamed Save, nonzero camera origin -- immediate commit, full
// 3-step resync.
// =================================================================================================

test('discharge (no box, all-streamed, nonzero camera origin): a Save with no dialogue open commits immediately, through the full 3-step resync, exactly once', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const screen = project.maps[project.maps.length - 1].screens[0];
  const slot = interactOn(screen, project, { x: 200, y: 40, commands: [saveCmd()] });
  const { nes, mem, addrOf } = await buildAndBoot(project);

  walkToNonzeroCamera(nes, mem);
  assert.equal(sectorMarker(nes), 0xff, 'sanity: the flash sector must ship blank');
  assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'the player must actually reach the saver');
  // Captured here, immediately before the interact -- walking on from the minimal nonzero-camera
  // check to the saver's own position moves the camera further still.
  const camXAtSave = mem[CAM_X_LO];
  const camYAtSave = mem[CAM_Y_LO];
  const camNtAtSave = mem[CAM_NT];
  const flatAtSave = mem[FLAT_SCREEN];
  const xAtSave = mem[PLAYER_X];
  const yAtSave = mem[PLAYER_Y];
  const yBeforeInteract = mem[PLAYER_Y];
  // Round 3, finding A-blocking 2: installed BEFORE the triggering press and held open through the
  // 30-frame hold below, so "exactly once" is a real instruction-granularity entry count spanning
  // the whole transaction, not a marker-value snapshot that merely happens to still read valid.
  const commitEntries = countPcEntries(nes, addrOf('save_media_commit'));
  try {
    pressOnce(nes, B); // interact -- the page has no dialogue at all, so this dispatches sw_dlg20_save_immediate right there
    assert.equal(mem[BOX_STATE], BOX_CLOSED, 'a Save-only page opens no box at all');
    // "No box, no deferral" means the commit is not gated on a box closing first -- it is dispatched
    // synchronously from this same press, never routed through sw_dlg20_save_pending/sw_dlg20_pending_tick
    // at all. It does NOT mean the whole call (commit + sw_save_resync's own full window redraw) finishes
    // within this one nes.frame() call -- see waitForResync's own header. Once game_state genuinely
    // returns to ST_GAMEPLAY below, script_end/script_finish have already run, which -- since Save's
    // own script_next1 tail is the only way script_run ever advances past it, and a stuck pointer would
    // have looped script_op_save forever rather than ever closing the event -- already proves the
    // opcode was consumed exactly once; script_ptr itself is no longer meaningful to compare once the
    // event has closed (script_finish/close_ui are free to leave it wherever they like).
    waitForResync(nes, mem);
    assert.equal(commitEntries.count, 1, 'save_media_commit must be entered exactly once by the time the resync resolves');
    assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the commit must have run, dispatched directly from the interact press with no deferral');
    assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'a Save-only page with nothing after it must finish the event once the commit resolves');
    assert.equal(mem[PLAYER_Y], yBeforeInteract, 'the immediate (non-deferred) commit must not have displaced the player at all');

    // The 3-step resync, not the ordinary enable_rendering(0,0) tail: camera must still read the
    // real nonzero origin, both in RAM and in the actual PPU scroll registers.
    assert.equal(mem[CAM_X_LO], camXAtSave, 'cam_x_lo must survive the commit unchanged');
    assert.equal(mem[CAM_Y_LO], camYAtSave, 'cam_y_lo must survive the commit unchanged');
    assert.equal(mem[CAM_NT], camNtAtSave, 'cam_nt must survive the commit unchanged');
    assert.equal(scrollX(nes), camXAtSave, 'the real PPU X scroll register must republish the true nonzero origin, not 0');
    assert.equal(scrollY(nes) % 240, camYAtSave, 'the real PPU Y scroll register must republish the true nonzero origin, not 0');

    // The record on flash matches RAM exactly as of the Save frame.
    assert.equal(sectorByte(nes, RECORD_FLAT_SCREEN_OFFSET), flatAtSave, 'the flash record\'s flat_screen must match RAM at Save time');
    assert.equal(sectorByte(nes, RECORD_PLAYER_X_OFFSET), xAtSave, 'the flash record\'s player_x must match RAM at Save time');
    assert.equal(sectorByte(nes, RECORD_PLAYER_Y_OFFSET), yAtSave, 'the flash record\'s player_y must match RAM at Save time');

    // Exactly once: hold many more frames and confirm the PC-hook count never advances past 1, and
    // the marker never toggles again.
    for (let i = 0; i < 30; i++) nes.frame();
    assert.equal(commitEntries.count, 1, 'save_media_commit must still read exactly one entry after a further 30-frame hold -- no spurious second commit');
    assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the marker must stay valid -- no spurious second commit');
  } finally {
    commitEntries.stop();
  }
});

// =================================================================================================
// Obligation 4 discharge: open-box streamed Save, nonzero camera origin -- deferred commit, full
// sequence traced frame by frame, both all-streamed and mixed projects.
// =================================================================================================

function assertDeferredSaveSequence(t, { nes, mem, addrOf, slot }) {
  walkToNonzeroCamera(nes, mem);
  assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'the player must actually reach the NPC');
  // Captured here, immediately before the interact -- walking from the minimal nonzero-camera check
  // above to the NPC's own position moves the camera further still, so capturing any earlier would
  // record a stale origin the walk itself already left behind, not the one actually open at interact.
  const camXAtOpen = mem[CAM_X_LO];
  const camYAtOpen = mem[CAM_Y_LO];
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the Say must reach ENDWAIT before dismissing');

  const scriptPtrBeforeDismiss = mem[SCRIPT_PTR_LO] | (mem[SCRIPT_PTR_HI] << 8);
  const yAtArm = mem[PLAYER_Y];
  // Round 3, finding A-blocking 2: installed before the dismiss press that arms the deferred Save,
  // held open through the post-resync hold below -- "exactly once" is a real instruction-
  // granularity entry count spanning the whole transaction (arm through the resumed command),
  // never a marker-value snapshot that merely happens to still read valid.
  const commitEntries = countPcEntries(nes, addrOf('save_media_commit'));
  try {
    pressOnce(nes, B); // dismiss -- script_resume runs script_op_save on this same frame

    // Arm frame: deferred, not committed. script_ptr already advanced past Save's own opcode.
    assert.equal(sectorMarker(nes), 0xff, 'the arm frame must not have committed yet -- the box was still open');
    assert.equal(mem[SW_DLG20_SAVE_PENDING], 1, 'the arm frame must set sw_dlg20_save_pending');
    assert.equal(mem[GAME_STATE], ST_DIALOG, 'game_state must still read ST_DIALOG on the arm frame');
    assert.equal(mem[SCRIPT_ACTIVE], 1, 'script_active must survive the arm frame');
    const scriptPtrAtArm = mem[SCRIPT_PTR_LO] | (mem[SCRIPT_PTR_HI] << 8);
    assert.equal(scriptPtrAtArm, scriptPtrBeforeDismiss + 1, 'script_ptr must have advanced by exactly Save\'s own one-byte opcode, exactly once, on the arm frame');
    assert.equal(commitEntries.count, 0, 'sanity: the arm frame itself must not have entered save_media_commit yet');

    // Held frames: the box draws down; the player must not move at all; nothing commits yet.
    let heldFrames = 0;
    let sawClosing = false;
    while (mem[SW_DLG20_SAVE_PENDING] === 1 && heldFrames < 60) {
      if (mem[BOX_STATE] === BOX_CLOSING) sawClosing = true;
      assert.equal(mem[PLAYER_Y], yAtArm, `held frame ${heldFrames}: the player must not move while the box draws down`);
      assert.equal(sectorMarker(nes), 0xff, `held frame ${heldFrames}: must not have committed before the drain is acknowledged`);
      assert.equal(mem[SCRIPT_ACTIVE], 1, `held frame ${heldFrames}: script_active must survive`);
      assert.equal(mem[GAME_STATE], ST_DIALOG, `held frame ${heldFrames}: game_state must still read ST_DIALOG`);
      nes.frame();
      heldFrames++;
    }
    assert.ok(heldFrames < 60, 'the draw-down must actually finish within budget');
    assert.ok(sawClosing, `the held span must actually visit BOX_CLOSING`);
    assert.equal(mem[SW_DLG20_SAVE_PENDING], 0, 'this frame must clear sw_dlg20_save_pending');

    // sw_dlg20_save_pending clears as sw_dlg20_save_check's own FIRST store, before save_media_commit
    // (and its own sw_save_resync tail) has actually run -- see waitForResync's own header. The commit
    // and the resync both still have to finish before game_state returns and the marker/scroll settle.
    waitForResync(nes, mem);
    assert.equal(commitEntries.count, 1, 'save_media_commit must be entered exactly once by the time the resync resolves');
    assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the commit must have fired once the drain was acknowledged');
    assert.equal(mem[CAM_X_LO], camXAtOpen, 'cam_x_lo must still read the real nonzero origin after the resync');
    assert.equal(mem[CAM_Y_LO], camYAtOpen, 'cam_y_lo must still read the real nonzero origin after the resync');
    assert.equal(scrollX(nes), camXAtOpen, 'the real PPU X scroll register must republish the true nonzero origin');

    for (let i = 0; i < 20; i++) nes.frame();
    assert.equal(commitEntries.count, 1, 'save_media_commit must still read exactly one entry after a further 20-frame hold -- no spurious second commit');
    assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the marker must stay valid -- no spurious second commit');
  } finally {
    commitEntries.stop();
  }
}

test('discharge (open box, all-streamed, nonzero camera origin): a Save behind a Say defers, holds with zero displacement, and commits exactly once through the full resync', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const screen = project.maps[project.maps.length - 1].screens[0];
  const slot = interactOn(screen, project, { x: 200, y: 40, commands: [say('Hi.'), saveCmd()] });
  const { nes, mem, addrOf } = await buildAndBoot(project);
  assertDeferredSaveSequence(t, { nes, mem, addrOf, slot });
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the whole event (Say -> Save, nothing after) must finish once the commit resolves');
});

test('discharge (open box, MIXED project, nonzero camera origin): the identical deferred sequence holds on the streamed map of a mixed project', { skip: !hasNesasm && 'nesasm not found on PATH' }, async (t) => {
  const { project, streamedMap } = createMinimalMixedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const slot = interactOn(streamedMap.screens[0], project, { x: 200, y: 40, commands: [say('Hi.'), saveCmd()] });
  const { nes, mem, addrOf } = await buildAndBoot(project);
  assertDeferredSaveSequence(t, { nes, mem, addrOf, slot });
});

// =================================================================================================
// Fix round 1b, gap 2: PC-hook-based commit-boundary observation, and a $2001-write snapshot for the
// discharge sequence's own exact resync moment -- both deliberately instruction-level rather than
// nes.frame()-count-level, since a frame count is not the same claim as a real-engine-pass count
// (main_loop can run any number of times inside one nes.frame() call as NMI timing shifts a pass
// across the call boundary).
// =================================================================================================

test('PC-hook (fix round 1b, gap 2): the deferred commit fires on the exact main_loop pass immediately after DRAINING resolves to IDLE, and save_media_commit is entered exactly once', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const screen = project.maps[project.maps.length - 1].screens[0];
  const slot = interactOn(screen, project, { x: 200, y: 40, commands: [say('Hi.'), saveCmd()] });
  const { nes, mem, addrOf } = await buildAndBoot(project);
  assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'reach the NPC');
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  pressOnce(nes, B); // dismiss -- arms the deferred Save
  assert.equal(mem[SW_DLG20_SAVE_PENDING], 1, 'sanity: the arm frame must set sw_dlg20_save_pending');

  // engine/boot.asm's own main_loop_save_gate reads sw_dlg15_state BEFORE sw_dlg17_camrelease
  // (engine/streamworld.asm) runs later in the SAME pass -- camrelease is main_loop's own last call
  // before `jmp main_loop` loops back to the top (engine/boot.asm:412-424), so whichever pass
  // actually flips DRAINING to IDLE always reads the save-gate's own check with the STALE
  // (pre-flip) value, and the commit fires on the very next pass instead. This test asserts that
  // exact one-pass relationship directly, at instruction granularity, rather than assuming it.
  const mainLoopAddr = addrOf('main_loop');
  const commitAddr = addrOf('save_media_commit');
  const passes = [];
  let passCount = 0;
  let commitCount = 0;
  let commitPass = -1;
  const origEmulate = nes.cpu.emulate.bind(nes.cpu);
  nes.cpu.emulate = () => {
    const pc = nes.cpu.REG_PC + 1;
    if (pc === mainLoopAddr) {
      passCount++;
      passes.push({ pass: passCount, state: mem[SW_DLG15_STATE], pending: mem[SW_DLG20_SAVE_PENDING] });
    } else if (pc === commitAddr) {
      commitCount++;
      if (commitPass < 0) commitPass = passCount;
    }
    return origEmulate();
  };
  try {
    const frames = driveUntil(nes, mem, (m) => m[SW_DLG20_SAVE_PENDING] === 0, 60);
    assert.ok(frames < 60, 'sanity: the deferred Save must actually resolve within budget');
    // Round 3, finding A-blocking 2: sw_dlg20_save_pending clears as sw_dlg20_save_check's own
    // FIRST store, before save_media_commit (and its own sw_save_resync tail) has actually run --
    // driveUntil's own stopping condition above is reached before that whole transaction, and the
    // event's own resumed command (script_resume's continuation once the commit's own tail
    // finally returns) runs later still. The hook must stay live through all of that, not just
    // until the pending flag itself clears, or a spurious second commit (or a resumed-command
    // re-dispatch of the SAME opcode) triggered after this point would be invisible.
    for (let i = 0; i < 30; i++) nes.frame();
  } finally {
    nes.cpu.emulate = origEmulate;
  }

  assert.equal(commitCount, 1, 'save_media_commit must be entered exactly once for one deferred Save, counted through the resumed command and a further 30-frame hold');
  assert.ok(commitPass > 0, 'sanity: the commit must have happened during a tracked main_loop pass');
  const commitPassRecord = passes.find((p) => p.pass === commitPass);
  assert.equal(commitPassRecord.state, SW_DLG15_IDLE, 'the pass whose own save-gate check goes on to fire the commit must already read sw_dlg15_state == IDLE at ITS OWN top -- the DRAINING -> IDLE flip itself must have already happened, on the PRECEDING pass');
  assert.equal(commitPassRecord.pending, 1, 'sanity: sw_dlg20_save_pending must still read 1 at the top of the commit pass -- sw_dlg20_save_check only clears it once its own dispatch has already been reached');
  const priorPassRecord = passes.find((p) => p.pass === commitPass - 1);
  assert.ok(priorPassRecord, 'sanity: there must be a tracked pass immediately before the commit pass');
  assert.equal(priorPassRecord.state, SW_DLG15_DRAINING, 'the immediately preceding pass must have read DRAINING at ITS OWN top -- confirming the flip to IDLE happens once, late in that same preceding pass (sw_dlg17_camrelease, called after the save-gate\'s own stale read), with no extra idle pass spent waiting for it to be observed');
});

test('$2001-write snapshot (fix round 1b, gap 2): the deferred commit\'s own real display-enable write republishes the true nonzero camera origin at that exact instruction boundary', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const screen = project.maps[project.maps.length - 1].screens[0];
  const slot = interactOn(screen, project, { x: 200, y: 40, commands: [say('Hi.'), saveCmd()] });
  const { nes, mem } = await buildAndBoot(project);

  walkToNonzeroCamera(nes, mem);
  assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'reach the NPC');
  const camXAtOpen = mem[CAM_X_LO];
  const camYAtOpen = mem[CAM_Y_LO];
  const camNtAtOpen = mem[CAM_NT];
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  pressOnce(nes, B); // dismiss -- arms the deferred Save

  // save_media_commit (engine/save.asm) writes $2001=0 (rendering off) as its own very first act,
  // then sw_save_resync's own tail (engine/streamworld.asm) writes the real $2005 pair and finally
  // $2001=PPUMASK_ON -- the SAME technique test/unit/streamworldlifecycle.test.js's own battle-
  // return snapshot already uses for an analogous off-then-on transition. Snapshotting at that
  // exact write -- not "eventually, after driving up to N more frames" -- proves the republished
  // scroll is correct at the instant rendering resumes, not merely correct a few frames later once
  // any of several further NMIs might also have run.
  let sawOff = false;
  let snapshot = null;
  const originalWrite = nes.mmap.write.bind(nes.mmap);
  nes.mmap.write = (address, value) => {
    if (address === 0x2001) {
      if (value === 0) sawOff = true;
      else if (sawOff && !snapshot) {
        snapshot = { mem: mem.slice(), scrollX: scrollX(nes), scrollY: scrollY(nes), value };
      }
    }
    return originalWrite(address, value);
  };
  try {
    for (let i = 0; i < 60 && !snapshot; i++) nes.frame();
  } finally {
    nes.mmap.write = originalWrite;
  }

  assert.ok(sawOff, 'sanity: the commit must actually have forced rendering off first');
  assert.ok(snapshot, 'sanity: the resync must actually reach its own real re-enable write within budget');
  assert.equal(snapshot.value, 0x1e, 'the re-enable write must be the real PPUMASK_ON value (background+sprites, both clipped columns shown)');
  assert.equal(snapshot.mem[CAM_X_LO], camXAtOpen, 'at the exact re-enable instant, cam_x_lo must already read the true nonzero origin');
  assert.equal(snapshot.mem[CAM_Y_LO], camYAtOpen, 'at the exact re-enable instant, cam_y_lo must already read the true nonzero origin');
  assert.equal(snapshot.mem[CAM_NT], camNtAtOpen, 'at the exact re-enable instant, cam_nt must already read the true origin nametable');
  assert.equal(snapshot.scrollX, camXAtOpen, 'the real PPU X scroll register must already hold the true nonzero origin at that exact instant -- the $2005 pair is written before $2001 in sw_save_resync\'s own tail');
  assert.equal(snapshot.scrollY % 240, camYAtOpen, 'the real PPU Y scroll register must already hold the true origin at that exact instant');
});

// =================================================================================================
// Round 2 finding A2: "four discharge shapes at the actual $2001 enable write -- terrain,
// attributes/shadow, every OAM pass, DMA, scroll/control" plus "exactly-once commit and
// continuation counts throughout each discharge." The three tests above already cover scroll/
// control at that exact instant for two of the four shapes (no-box/streamed, box/streamed) plus a
// box/mixed variant with no content check at all; none of them look at nametable terrain, the
// attribute table, attr_shadow, or OAM/DMA, and none carries a commit counter spanning the WHOLE
// transaction (arm through the post-resync hold). This section adds the genuinely missing shape
// (no-box, mixed) and gives all four the full content + exactly-once treatment, using a fixture
// where every metatile is forced to the same uniform sub-tile assignment and palette
// (tiles=[1,2,3,4], palette=1) so the expected nametable/attribute byte at any position is a pure
// function of that position's own (row,col) parity -- independently derivable from this codebase's
// own fixed screen geometry, never read back from the routine under test:
//   - tile portion (i < 960; the nametable's own first 960 bytes, 32 cols x 30 rows): row =
//     floor(i/32), col = i%32. Metatile order (createMetatile's own [TL,TR,BL,BR]) means an even
//     row holds TL/TR (1/2), an odd row holds BL/BR (3/4), and an odd column adds 1 within that
//     pair: (row%2 ? 3 : 1) + (col%2).
//   - attribute portion (960 <= i < 1024; the last 64 bytes, one byte per 4x4-tile cell, 8 cells
//     wide x 8 cells tall): a byte whose all four 2-bit quadrants read palette 1 is 0x55 (85). The
//     screen is only 30 tiles tall, so the 8th and final attribute row (i >= 1016) covers tile rows
//     28-31, of which only 28-29 are real, on-screen rows -- draw_screen/build_oam_draw_sw never
//     write anything to rows 30-31, so that row's own bottom two quadrant bits stay at the PPU's
//     post-clear 0, leaving only the top two (written) quadrants set: 0x05, not 0x55.
// attr_shadow (engine/constants.asm:1246, $0600, 256 bytes = 4 real nametables x 64 bytes) must
// read the identical byte RAM-side at every attribute position.
// =================================================================================================

// Round 3, finding A-blocking 2: each of the metatile ids streamedScreen (test/lib/
// streamedproject.js) actually places -- 0 (fill) and 1/2/3 (its own position-dependent varied
// region, `1 + ((col + row + i) % 3)`) -- gets its OWN distinct tile pattern and palette, mirroring
// test/unit/streamworld.test.js's own markMetatiles (independently re-authored here, per-suite
// duplication convention, not imported or shared). The OLD fixture forced EVERY metatile to the
// SAME [1,2,3,4]/palette-1 pattern: despite the underlying metatile id genuinely varying by screen
// position, the RENDERED tile/attribute content was uniform everywhere regardless, so a content
// scan built against it could never distinguish a correct copy (the right screen, the right
// offset, the right length) from a wrong one -- exactly the gap this fixture now closes.
function nonzeroTerrainFixture(project) {
  for (let id = 0; id < 4 && id < project.metatiles.length; id++) {
    project.metatiles[id].tiles = [id * 4, id * 4 + 1, id * 4 + 2, id * 4 + 3];
    project.metatiles[id].palette = id;
  }
  return project;
}

// Independent terrain oracle (round 3, finding A-blocking 2): copied from test/unit/
// streamworld.test.js's own ntScreen/expectedTileId (per-suite duplication convention -- this file
// must not trust that file's helpers describe ITS OWN project instances correctly). Round 4,
// A-blocking 2: win_col_screen/win_row_screen (engine/constants.asm) are no longer read from live
// RAM to choose the scan's own screen -- every caller in this file places the saver/entry event on
// `screens[0]` (grid column 0, row 0, by this file's own streamedScreen/mixedStreamedScreen
// row-major construction -- test/lib/streamedproject.js's own header comment) and never drives the
// player anywhere that could cross a screen boundary (walkToNonzeroCamera nudges right only far
// enough to produce a nonzero scroll register, walkToward's own targets are always the same
// on-screen saver/entry actor), so the window's own left/top-anchor screen is authored as (0, 0)
// directly from that fixture geometry, not read back from the window's own tracking bytes. Each
// call site asserts the live bytes still equal that authored pair first, as a sanity check that
// this assumption has not silently gone stale, never as the value the scan itself chooses from.
const WIN_COL_SCREEN = 0x5b1, WIN_ROW_SCREEN = 0x5b3; // engine/constants.asm:997-1000
const EXPECTED_WIN_COL_SCREEN = 0;
const EXPECTED_WIN_ROW_SCREEN = 0;
// Copied from test/unit/streamworld.test.js's own ntScreen (per-suite duplication convention).
// The window's own "+1" half can run one screen past the real grid on a narrow map (gridH==1 for
// this file's mixed fixture: empirically confirmed via a debug probe of the real hardware
// nametable content that the engine renders the fill metatile there, NOT a wrapped copy of row 0
// -- a genuinely dead axis has no real "next row" to show, so scanTerrainContent's own caller must
// treat an out-of-grid half as fill, never call decoded.screen with an out-of-range index).
function ntScreen(nt, winColScreen, winRowScreen) {
  const col = ((winColScreen & 1) === (nt & 1)) ? winColScreen : winColScreen + 1;
  const row = ((winRowScreen & 1) === ((nt >> 1) & 1)) ? winRowScreen : winRowScreen + 1;
  return { col, row };
}
function expectedTileId(metatileId, tileCol, tileRow) {
  const quadrant = (tileRow % 2) * 2 + (tileCol % 2);
  return metatileId * 4 + quadrant;
}

const ATTR_SHADOW = 0x0600; // engine/constants.asm:1246

// SAVE_FIELDS' own `ram` names -> RAM address, hardcoded from engine/constants.asm the same way
// GAME_STATE/CAM_X_LO/etc. above already are: nesasm's own .fns dump records only real code/data
// LABELS, never a `name = $addr` RAM equate (confirmed empirically -- `grep flat_screen
// sample/build/game.fns` finds nothing, even though save_media_commit and every other routine name
// this file already resolves via addrOf is right there), so addrOf cannot resolve these.
const SAVE_FIELD_ADDR = {
  flat_screen: 0x16, player_x: 0x10, player_y: 0x11, player_dir: 0x12, player_hp: 0x4e, // constants.asm:23-29,126
  switches: 0x0390, variables: 0x0500, inv_items: 0x0378, inv_count: 0x37, pickups: 0x24, // constants.asm:70,892,902,1203,50
  defeated: 0x27, items_used: 0x39, party_size: 0x65, gold_lo: 0x63, gold_hi: 0x64, // constants.asm:53,72,156-158
  pc_hp: 0x0398, pc_hp_max: 0x039c, pc_mp: 0x03a0, pc_mp_max: 0x03a4, pc_level: 0x03a8, // constants.asm:801-805
  pc_xp_lo: 0x03ac, pc_xp_hi: 0x03b0, pc_in_party: 0x03b4, pc_spells: 0x03b8, pc_name_ram: 0x0571 // constants.asm:806-809,1051
};

/**
 * Round 3, A-blocking 1: the complete "saved-field freeze" snapshot -- every SAVE_FIELDS byte
 * (live RAM, SAVE_FIELD_ADDR) AND the complete pending RAM record at SAVE_BASE (header, checksum
 * and marker included, not only the body), both as raw captured bytes. Used both for the
 * arm-boundary capture (captureArmSnapshot below) and for every later "still equals the arm
 * capture" comparison (assertSnapshotFrozen/assertRecordMatchesArm below) -- always read the same
 * way, so a freeze check and the arm capture it is judged against can never disagree about what a
 * "field" or "the record" means.
 */
function readFrozenSnapshot(mem) {
  const fields = SAVE_FIELDS.flatMap((f) => {
    const addr = SAVE_FIELD_ADDR[f.ram];
    assert.ok(addr !== undefined, `SAVE_FIELD_ADDR is missing an entry for '${f.ram}' -- shared/save.js's SAVE_FIELDS gained a field this file does not know about yet`);
    return Array.from(mem.slice(addr, addr + f.size));
  });
  const record = Array.from(mem.slice(SAVE_BASE, SAVE_BASE + SAVE_RECORD_LEN));
  return { fields, record };
}

/**
 * Round 3, A-blocking 1: captures readFrozenSnapshot() at instruction granularity, the instant
 * sw_dlg20_save_pending itself goes 0 -> 1. There is no label at that exact `sta
 * sw_dlg20_save_pending` inside sw_dlg20_save_dispatch (engine/streamworld.asm) for a PC hook (the
 * countPcEntries convention this file uses everywhere else) to target -- nesasm's own .fns dump
 * records only routine entries, never a mid-routine instruction -- so this instead watches the
 * flag's own live value on every real CPU instruction (the identical nes.cpu.emulate wrapping
 * countPcEntries already uses), which observes the transition at the same instruction granularity
 * a PC hook on the store itself would, without hardcoding an address nesasm never names.
 */
function captureArmSnapshot(nes, mem) {
  const origEmulate = nes.cpu.emulate.bind(nes.cpu);
  let wasPending = mem[SW_DLG20_SAVE_PENDING] === 1;
  const state = { snapshot: null, stopped: false };
  nes.cpu.emulate = () => {
    const result = origEmulate();
    if (!state.snapshot) {
      const isPending = mem[SW_DLG20_SAVE_PENDING] === 1;
      if (isPending && !wasPending) state.snapshot = readFrozenSnapshot(mem);
      wasPending = isPending;
    }
    return result;
  };
  state.stop = () => {
    if (!state.stopped) {
      nes.cpu.emulate = origEmulate;
      state.stopped = true;
    }
  };
  return state;
}

/** Round 3, A-blocking 1: both halves of the freeze claim -- every SAVE_FIELDS byte AND the
 * complete pending RAM record must still equal their arm-time values. Kills E3/field-drift.asm
 * (which drifts a live SAVE_FIELDS byte, `variables+15`, on every pending-tick pass without
 * touching the record) as soon as it runs even once after arm. */
function assertSnapshotFrozen(mem, armSnapshot, label) {
  const current = readFrozenSnapshot(mem);
  assert.deepEqual(current.fields, armSnapshot.fields, `${label}: every SAVE_FIELDS byte must still equal its arm-time value -- nothing may touch a saved field while a deferred Save is pending`);
  assert.deepEqual(current.record, armSnapshot.record, `${label}: the complete pending RAM record at SAVE_BASE (header, checksum and marker included, not only the body) must still equal its arm-time value`);
}

/** Round 3, A-blocking 1: the flash sector, once the commit has genuinely finished, must equal the
 * ARM-captured record byte-for-byte -- never merely "equals whatever live RAM reads right now"
 * (which a mutant that recomposes-then-commits from drifted RAM could otherwise satisfy, both
 * sides having drifted together). Kills E3/recompose-drift.asm: it re-runs save_write_body/
 * save_checksum from live RAM (already incremented by its own `inc variables+15`) on every
 * pending-tick pass, including the one that leads straight into the real commit, so the record
 * actually programmed into flash reflects that drift, not the arm-time snapshot. */
function assertRecordMatchesArm(nes, armSnapshot, label) {
  const flashBody = Array.from(nes.rom.rom[SAVE_BANK].slice(SECTOR_OFFSET, SECTOR_OFFSET + armSnapshot.record.length));
  assert.deepEqual(flashBody, armSnapshot.record, `${label}: at commit, the complete flash record (not only the body) must equal the arm-captured pending RAM record byte-for-byte`);
}

/**
 * Round 4, A-blocking 1 closure: a PC hook, installed right after `armSnapshot` is captured (before
 * any further frame runs) and left running through `save_media_commit`'s own entry, that compares
 * the live saved-field snapshot against `armSnapshot` at every real `main_loop` entry while
 * `sw_dlg20_save_pending` still reads 1 at that entry's own top, AND (unconditionally) at
 * `save_media_commit`'s own entry -- `sw_dlg20_save_check` clears the pending flag as its own FIRST
 * store, before `jsr save_media_commit` runs (engine/streamworld.asm:5066-5069), so the commit-entry
 * check must not depend on pending still reading 1, or it would silently exclude the exact boundary
 * it exists to cover (the gap the old between-frames/onFrame sampling left -- a drift landing in the
 * few instructions between that store and the jsr was invisible to a frame-granularity check).
 * Counts both kinds of entry so a vacuous zero-observation pass can never be mistaken for a real
 * check (a hook that never fired would otherwise pass by never asserting anything at all).
 */
function installFreezeWatch(nes, mem, mainLoopAddr, commitAddr, armSnapshot, label) {
  const origEmulate = nes.cpu.emulate.bind(nes.cpu);
  const state = { mainLoopChecks: 0, commitChecks: 0, stopped: false };
  nes.cpu.emulate = () => {
    const pc = nes.cpu.REG_PC + 1;
    if (pc === mainLoopAddr && mem[SW_DLG20_SAVE_PENDING] === 1) {
      state.mainLoopChecks++;
      assertSnapshotFrozen(mem, armSnapshot, `${label}: main_loop entry #${state.mainLoopChecks}`);
    } else if (pc === commitAddr) {
      state.commitChecks++;
      assertSnapshotFrozen(mem, armSnapshot, `${label}: save_media_commit entry #${state.commitChecks}`);
    }
    return origEmulate();
  };
  state.stop = () => {
    if (!state.stopped) {
      nes.cpu.emulate = origEmulate;
      state.stopped = true;
    }
  };
  return state;
}

/**
 * The same $2001-write snapshot technique the test above already uses (nes.mmap.write hooked on
 * address 0x2001, off-then-on), extended to also capture and check real nametable terrain, the
 * attribute table, attr_shadow, OAM/DMA, and the flash record's WHOLE body (every SAVE_FIELDS
 * entry, not just the three fields the earlier no-box test spot-checks) -- all at that identical
 * instruction boundary, never approximated by driving further frames first.
 */
/**
 * Shared $2001-write snapshot plumbing (off, then on) -- every "at the exact re-enable instant"
 * test in this file (the plain scroll-only ones above, captureReEnableContent below, and the
 * Continue landing-frame matrix further down) drives the same off-then-on sequence; only what gets
 * read out of nes/mem at that instant differs, so `buildSnapshot(value)` supplies that part.
 */
function driveToReEnable(nes, mem, buildSnapshot, budget = 60, kick = null, onWrite = null, onFrame = null, onPc = null) {
  let sawOff = false;
  let snapshot = null;
  const originalWrite = nes.mmap.write.bind(nes.mmap);
  nes.mmap.write = (address, value) => {
    if (address === 0x2001) {
      if (value === 0) sawOff = true;
      else if (sawOff && !snapshot) snapshot = buildSnapshot(value);
    } else if (sawOff && !snapshot && onWrite) {
      // Strictly inside the forced-blank window (after $2001=0, before the real re-enable write) --
      // round 3, finding A-blocking 2's own "DMA occurrence+order" observation point.
      onWrite(address, value);
    }
    return originalWrite(address, value);
  };
  // Round 4, A-blocking 2: an optional instruction-granularity PC hook, live over the identical
  // "strictly inside the forced-blank window" span onWrite above already uses (sawOff && !snapshot)
  // -- lets a caller observe routine-entry ORDER (which of sw_render_window/build_oam/draw_entities/
  // draw_hud/draw_ui ran, and in what sequence, relative to the DMA/enable writes onWrite already
  // sees) without a second, separately-scoped hook that could disagree about the window's own
  // boundaries.
  const originalEmulate = onPc ? nes.cpu.emulate.bind(nes.cpu) : null;
  if (onPc) {
    nes.cpu.emulate = () => {
      if (sawOff && !snapshot) onPc(nes.cpu.REG_PC + 1);
      return originalEmulate();
    };
  }
  try {
    // The hook must be live BEFORE the triggering press, not after: on some paths (Continue,
    // dispatched synchronously from dispatch_input) the forced-blank write can land within the very
    // same nes.frame() call the press itself drives, so installing the hook only afterward would
    // silently miss `sawOff` and this would then wait out its own budget for an "on" write whose
    // matching "off" write it never saw.
    if (kick) kick();
    for (let i = 0; i < budget && !snapshot; i++) {
      nes.frame();
      if (onFrame) onFrame(i);
    }
  } finally {
    nes.mmap.write = originalWrite;
    if (onPc) nes.cpu.emulate = originalEmulate;
  }
  assert.ok(sawOff, 'sanity: the commit/landing must actually force rendering off first');
  assert.ok(snapshot, 'sanity: the resync/landing must actually reach its own real re-enable write within budget');
  return snapshot;
}

/** Real nametable terrain (all 4 nametables), the attribute table, its attr_shadow RAM mirror, and
 * OAM/DMA content -- checked against `decoded` (test/lib/streamdecoder.js's own decode of the exact
 * emitStreamedLayout bytes generate.js itself emits for THIS project), never a flat formula, so a
 * wrong screen, wrong offset or wrong length each produce a genuinely different expected byte at a
 * genuinely different position (round 3, finding A-blocking 2) rather than being invisible to a
 * uniform-terrain fixture. Round 4: winColScreen/winRowScreen are the caller's own AUTHORED values
 * (this file's fixtures never leave screen (0,0) -- see the header comment above), never read back
 * from win_col_screen/win_row_screen here. */
function scanTerrainContent(nes, mem, decoded, winColScreen, winRowScreen) {
  let terrainWrong = 0;
  let attributeWrong = 0;
  let shadowWrong = 0;
  const grid = decoded.streamed(0);
  for (let nt = 0; nt < 4; nt++) {
    const { col: screenCol, row: screenRow } = ntScreen(nt, winColScreen, winRowScreen);
    // A narrow map (this file's mixed fixture: gridH==1) has no real screen at all one row past
    // its own edge -- the window's own "+1" half still needs SOME content there, and the engine
    // renders the fill metatile uniformly rather than wrapping to a real screen (see ntScreen's
    // own comment above).
    const offGrid = screenCol >= grid.gridW || screenRow >= grid.gridH;
    const terrain = offGrid ? new Array(240).fill(grid.fill) : decoded.screen(0, screenCol, screenRow).terrain;
    const terrainAt = (localCol, localRow) => terrain[localRow * 16 + localCol];
    for (let row = 0; row < 30; row++) {
      for (let col = 0; col < 32; col++) {
        const metatileId = terrainAt(col >> 1, row >> 1);
        const expected = expectedTileId(metatileId, col, row);
        const got = nes.ppu.vramMem[0x2000 + nt * 1024 + row * 32 + col];
        if (got !== expected) terrainWrong++;
      }
    }
    for (let arow = 0; arow < 8; arow++) {
      for (let acol = 0; acol < 8; acol++) {
        const tl = terrainAt(acol * 2, arow * 2);
        const tr = terrainAt(acol * 2 + 1, arow * 2);
        const bl = arow === 7 ? 0 : terrainAt(acol * 2, arow * 2 + 1);
        const br = arow === 7 ? 0 : terrainAt(acol * 2 + 1, arow * 2 + 1);
        const expectedByte = tl | (tr << 2) | (bl << 4) | (br << 6);
        const gotAttr = nes.ppu.vramMem[0x2000 + nt * 1024 + 960 + arow * 8 + acol];
        if (gotAttr !== expectedByte) attributeWrong++;
        if (mem[ATTR_SHADOW + nt * 64 + arow * 8 + acol] !== expectedByte) shadowWrong++;
      }
    }
  }
  const dmaMatches = nes.ppu.spriteMem.every((v, i) => v === mem[0x200 + i]);
  return { terrainWrong, attributeWrong, shadowWrong, dmaMatches };
}

/**
 * DMA occurrence+order (round 3, finding A-blocking 2): every $4014 write seen strictly inside the
 * forced-blank window is recorded (source page = the byte written, e.g. 0x02 for the $0200 OAM
 * shadow page). sw_save_resync's own manual DMA (engine/streamworld.asm) is the only thing that can
 * write $4014 in this window at all -- ordinary per-vblank NMI is off for the whole commit (NMI
 * itself is disabled along with rendering), so a genuine engine that never issues this write here
 * (E3/nodma.asm's own mutation: the `sta $4014` after `sw_save_resync`'s draw_ui/lda #$02` is
 * deleted) leaves this array empty rather than producing some OTHER write in its place.
 */
/**
 * Round 3, A-blocking 1: the flash-record check here is now anchored at ARM time, not at the
 * re-enable instant it happens to be read at -- pass `armSnapshot` (captureArmSnapshot's own
 * captured snapshot, above) for any caller with a genuine pending/draining window (a deferred,
 * box-open Save), and the flash body is compared against THAT snapshot's own frozen record, never
 * recomputed from whatever live RAM happens to read at re-enable time. (A mutant that recomposes
 * the record from drifted live RAM immediately before committing could otherwise make both sides
 * drift together and still "match" -- exactly E3/recompose-drift.asm.) An immediate (no-box)
 * commit has no pending window at all -- call with no armSnapshot and this falls back to comparing
 * against live RAM at the re-enable instant, which is exactly correct there since nothing
 * intervenes between composing the record and committing it on that path.
 */
// A tolerant addrOf: draw_hud (engine/combat.asm) is wrapped in `.if !BATTLE_ENABLED`, so its own
// symbol does not exist at all in an RPG build where BATTLE_ENABLED is 1 (confirmed empirically:
// game.fns carries no draw_hud line there) -- sw_save_resync's own `jsr draw_hud` is wrapped in the
// identical `.if !BATTLE_ENABLED`, so the call-order check below must be able to omit that tag
// rather than asserting a symbol into existence.
function tryAddrOf(addrOf, label) {
  try {
    return addrOf(label);
  } catch {
    return null;
  }
}

/**
 * Round 4, A-blocking 2: extends the re-enable capture with the call-order/scroll/OAM-shadow
 * observations the round-4 review required, all still gathered from the SAME single off-then-on
 * pass driveToReEnable already drives (never a second, separately-timed capture):
 * - `orderTags`: a PC/write hook, live for the identical "strictly inside the forced-blank window"
 *   span the DMA-occurrence hook already uses, recording each of sw_render_window/build_oam/
 *   draw_entities/draw_hud (when assembled)/draw_ui's own entry, and each real $4014 write, in the
 *   exact order they actually happened -- read off engine/streamworld.asm:3262-3285 (sw_save_resync
 *   itself): render -> build_oam -> draw_entities -> draw_hud (only ever assembled `.if
 *   !BATTLE_ENABLED`) -> draw_ui -> dma -> (then $2000/$2005/$2001, captured below).
 * - `ctrl2000`/`scroll2005`: the literal bytes written to $2000 and the two $2005 writes inside
 *   that same window -- the same sw_save_resync body writes `<cam_nt | PPUCTRL_ON` to $2000 and
 *   `<cam_x_lo`, `<cam_y_lo` to $2005 twice, straight from the camera origin, so a caller with that
 *   origin already in hand (this file's own `camXAtSave`/`camYAtSave`/`camNtAtSave` convention) can
 *   author the expected bytes without re-deriving sw_save_resync's own code.
 * - `oamShadow`: the complete 256-byte OAM shadow page (RAM, $0200-$02FF) at the exact re-enable
 *   instant, for a caller to compare against independently authored player/entity/HUD/UI geometry
 *   (never re-derived from the shadow itself, which would prove nothing).
 */
function captureReEnableContent(nes, mem, decoded, addrOf, armSnapshot = null, { onFrame = null } = {}) {
  const dmaWrites = [];
  const scroll2005 = [];
  let ctrl2000 = null;
  const orderTags = [];
  const renderAddr = addrOf('sw_render_window');
  const oamAddr = addrOf('build_oam');
  const entitiesAddr = addrOf('draw_entities');
  const hudAddr = tryAddrOf(addrOf, 'draw_hud');
  const uiAddr = addrOf('draw_ui');
  return driveToReEnable(nes, mem, (value) => {
    const content = scanTerrainContent(nes, mem, decoded, EXPECTED_WIN_COL_SCREEN, EXPECTED_WIN_ROW_SCREEN);
    const expectedRecord = armSnapshot ? armSnapshot.record : SAVE_FIELDS.flatMap((f) => {
      const addr = SAVE_FIELD_ADDR[f.ram];
      assert.ok(addr !== undefined, `SAVE_FIELD_ADDR is missing an entry for '${f.ram}' -- shared/save.js's SAVE_FIELDS gained a field this map does not know about yet`);
      return Array.from(mem.slice(addr, addr + f.size));
    });
    const flashBody = Array.from(nes.rom.rom[SAVE_BANK].slice(SECTOR_OFFSET, SECTOR_OFFSET + expectedRecord.length));
    return {
      value,
      ...content,
      recordMatches: flashBody.length === expectedRecord.length && flashBody.every((v, idx) => v === expectedRecord[idx]),
      dmaWrites: dmaWrites.slice(),
      oamShadow: Array.from(mem.slice(0x0200, 0x0200 + 256)),
      ctrl2000,
      scroll2005: scroll2005.slice(),
      orderTags: orderTags.slice()
    };
  }, 60, null, (address, value) => {
    if (address === 0x4014) { dmaWrites.push(value); orderTags.push('dma'); }
    else if (address === 0x2000) ctrl2000 = value;
    else if (address === 0x2005) scroll2005.push(value);
  }, onFrame, (pc) => {
    if (pc === renderAddr) orderTags.push('render');
    else if (pc === oamAddr) orderTags.push('oam');
    else if (pc === entitiesAddr) orderTags.push('entities');
    else if (hudAddr !== null && pc === hudAddr) orderTags.push('hud');
    else if (pc === uiAddr) orderTags.push('ui');
  });
}

// Round 3, finding A-blocking 2: the Continue landing-frame matrix's own TL-corner OAM projection,
// copied locally (per-suite duplication convention -- test/unit/streamworldclosemove.test.js's own
// projectOamX/projectOamY, itself copied from test/unit/streamworldmove.test.js) rather than
// imported, so this file's own sprite-geometry check is independently authored, never sharing code
// with the engine's own sw_oam_project_y. delta = (world - origin) mod 65536; X reports the low
// byte directly, Y reports (delta-1)&0xff (sw_oam_project_y's own one-scanline-early -1).
function projectOamX(worldX, originX) {
  return (worldX - originX) & 0xff;
}
function projectOamY(worldY, originY) {
  return (((worldY - originY) & 0xffff) - 1) & 0xff;
}

/**
 * Round 4, A-blocking 2: the player's own complete 16x16 OAM shadow geometry (all four 8x8 tiles,
 * TL/TR/BL/BR -- OAM+0/+4/+8/+12, build_oam_draw's own storage order, engine/oam.asm), authored
 * from the fixture's own saved position/direction/frame and the camera, never read back from the
 * shadow. Two independent facts, neither restating the engine's own draw code:
 * - Tile ids: main/build/generate.js's own `playerTiles = Array.from({length: PLAYER_TILES}, (_,
 *   index) => index)` (spriteTables) emits `player_tiles` as the bare IDENTITY sequence 0..31, so
 *   `player_tiles,x` / `+1` / `+2` / `+3` (engine/oam.asm) reduce to `x`/`x+1`/`x+2`/`x+3` outright,
 *   x = (player_dir*2 + anim_frame) * 4 (PLAYER_FRAMES = 4 directions x 2 frames, shared/
 *   project.js) -- no sprite-sheet layout to duplicate.
 * - Positions: player_x/player_y projected against the camera origin via projectOamX/projectOamY
 *   above (the same formula already used for the Continue landing's own TL corner), plus a plain
 *   +8 for the right column / bottom row -- valid under mod-256 arithmetic regardless of what
 *   modulus the engine's own sw_oam_project_tile_x/y used internally to reach the same byte (a
 *   sum's low byte depends only on its operands' own low bytes, not on any wider modulus applied to
 *   them first).
 * - Attribute byte: `player_pal` (main/build/generate.js's own `spriteTables`) is a fixed build-time
 *   constant, always 0 -- not a RAM value the project or a mutant could plausibly vary here.
 * Empirically confirmed (a one-off debug probe of the real OAM shadow: tiles 24-27, attr 0, exactly
 * this fixture's own dir/frame at rest) that no other sprite (entity, HUD, UI) is ever present in
 * this file's own fixtures: the placed NPC actor carries no assigned animation (raw `{behavior:
 * 'npc', hp: 1, damage: 0}`, never run through normalizeProject), so entity_animation resolves
 * NO_ANIM and draw_one_entity_show_sw draws nothing; COMBAT_ENABLED is 0 (no damaging metatile,
 * actor or item anywhere in these fixtures -- shared/font.js's own projectUsesCombat), so draw_hud
 * (when even assembled) draws nothing; and the open Say is always a plain message box, never an
 * actor-driven conversation, so draw_dialog's own `bne draw_dialog_done` (box_state != 0) draws
 * nothing either. assertDischargeShape's own OAM-shadow check below asserts BOTH halves: bytes
 * 0-15 equal this authored geometry, and bytes 16-255 all stay the $FF park byte.
 */
function expectedPlayerOamQuads(playerX, playerY, dir, frame, camX, camY) {
  const tileBase = (dir * 2 + frame) * 4;
  const leftX = projectOamX(playerX, camX);
  const rightX = (leftX + 8) & 0xff;
  const topY = projectOamY(playerY, camY);
  const bottomY = (topY + 8) & 0xff;
  return [topY, tileBase, 0, leftX, topY, tileBase + 1, 0, rightX, bottomY, tileBase + 2, 0, leftX, bottomY, tileBase + 3, 0, rightX];
}

/**
 * Drives one full discharge (no-box immediate, or box-open deferred) to its own real $2001
 * re-enable instant, asserting full terrain/attribute/shadow/OAM/DMA/record content there, plus an
 * exactly-once commit count spanning the WHOLE transaction: from before the triggering press,
 * through the content capture, through a further 30-frame hold -- not merely up to the moment
 * sw_dlg20_save_pending clears or the marker first reads valid.
 */
function assertDischargeShape(nes, mem, addrOf, slot, { box, decoded }) {
  walkToNonzeroCamera(nes, mem);
  assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'the player must actually reach the saver');
  // Authored INPUTS for the OAM/scroll geometry checks below, captured now (before the interact
  // press) -- standing still to interact changes none of these, and every discharge case walks the
  // identical path to the identical saver, so this is the same position/facing/camera in all eight
  // cases (round 4, A-blocking 2).
  const playerXAtInteract = mem[PLAYER_X];
  const playerYAtInteract = mem[PLAYER_Y];
  const playerDirAtInteract = mem[PLAYER_DIR];
  const animFrameAtInteract = mem[ANIM_FRAME];
  const camXAtInteract = mem[CAM_X_LO];
  const camYAtInteract = mem[CAM_Y_LO];
  const camNtAtInteract = mem[CAM_NT];
  const commitEntries = countPcEntries(nes, addrOf('save_media_commit'));
  let armSnapshot = null;
  let freezeWatch = null;
  try {
    if (box) {
      pressOnce(nes, B);
      driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
      assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'sanity: the Say must reach ENDWAIT before dismissing');
      const armCapture = captureArmSnapshot(nes, mem);
      pressOnce(nes, B); // dismiss -- arms the deferred Save
      armCapture.stop();
      assert.equal(mem[SW_DLG20_SAVE_PENDING], 1, 'sanity: the arm frame must set sw_dlg20_save_pending');
      assert.ok(armCapture.snapshot, 'sanity: the arm-boundary snapshot must actually have been captured on the dismiss press (A-blocking 1)');
      armSnapshot = armCapture.snapshot;
      // Round 4, A-blocking 1: installed immediately, before any further frame runs -- checks every
      // SAVE_FIELDS byte and the complete pending record at every real main_loop entry while armed
      // AND at save_media_commit's own entry (installFreezeWatch's own header explains why the
      // commit-entry check cannot be conditioned on pending still reading 1).
      freezeWatch = installFreezeWatch(nes, mem, addrOf('main_loop'), addrOf('save_media_commit'), armSnapshot, 'discharge content: pending/draining window');
    } else {
      pressOnce(nes, B); // interact -- Save-only page, dispatches sw_dlg20_save_immediate right there
    }
    const snapshot = captureReEnableContent(nes, mem, decoded, addrOf, armSnapshot);
    assert.equal(commitEntries.count, 1, 'save_media_commit must be entered exactly once by the time the re-enable write is reached');
    assert.equal(snapshot.value, 0x1e, 'the re-enable write must be the real PPUMASK_ON value');
    assert.equal(mem[WIN_COL_SCREEN], EXPECTED_WIN_COL_SCREEN, 'sanity: this fixture must never leave screen (0,0) -- the terrain oracle\'s own authored screen assumption depends on it');
    assert.equal(mem[WIN_ROW_SCREEN], EXPECTED_WIN_ROW_SCREEN, 'sanity: this fixture must never leave screen (0,0) -- the terrain oracle\'s own authored screen assumption depends on it');
    assert.equal(snapshot.terrainWrong, 0, 'every tile byte in every one of the four real nametables must match the position-dependent terrain the generator actually emitted for this project (decodeStreamedLayout), at the exact re-enable instant');
    assert.equal(snapshot.attributeWrong, 0, 'every attribute byte in every one of the four real nametables (including the partially-off-screen final row) must match the same position-dependent terrain at the exact re-enable instant');
    assert.equal(snapshot.shadowWrong, 0, 'attr_shadow RAM must mirror the real attribute table exactly at the exact re-enable instant');
    assert.ok(snapshot.dmaMatches, 'every byte of real sprite memory must match the $0200 OAM shadow page at the exact re-enable instant -- the manual DMA must have already run');
    assert.equal(snapshot.dmaWrites.length, 1, 'exactly one $4014 write must occur inside the forced-blank window (between the commit\'s own render-off and its real re-enable write) -- kills a mutant that silently drops sw_save_resync\'s own manual OAM DMA (E3/nodma.asm)');
    assert.equal(snapshot.dmaWrites[0], 0x02, 'the manual DMA\'s own source page must be $02 -- the $0200 OAM shadow page');
    assert.ok(snapshot.recordMatches, armSnapshot
      ? 'the flash record\'s whole body (every SAVE_FIELDS entry) must match the ARM-CAPTURED pending record exactly, at the exact re-enable instant (A-blocking 1)'
      : 'the flash record\'s whole body (every SAVE_FIELDS entry) must match live RAM exactly at the exact re-enable instant (immediate commit: no pending window exists to drift within)');

    // Round 4, A-blocking 2: independently authored OAM shadow geometry (player's own four sprites;
    // every other slot must stay the $FF park byte -- expectedPlayerOamQuads's own header explains
    // why nothing else is ever drawn in this file's fixtures) -- never read back from the shadow.
    const expectedQuads = expectedPlayerOamQuads(playerXAtInteract, playerYAtInteract, playerDirAtInteract, animFrameAtInteract, camXAtInteract, camYAtInteract);
    assert.deepEqual(snapshot.oamShadow.slice(0, 16), expectedQuads, 'the OAM shadow\'s own first 16 bytes (the player\'s complete 16x16 metasprite) must equal the independently authored geometry, at the exact re-enable instant');
    const restParked = snapshot.oamShadow.slice(16).every((v) => v === 0xff);
    assert.ok(restParked, 'every OAM shadow byte past the player\'s own four sprites must still read $FF (park) -- this fixture\'s NPC has no assigned animation, COMBAT_ENABLED is 0, and the open Say is a plain message box, so entity/HUD/UI draw nothing at all');

    // Round 4, A-blocking 2: same-instant scroll/control, authored from the camera origin
    // (sw_save_resync's own `lda <cam_nt / ora #PPUCTRL_ON / sta $2000` and `<cam_x_lo`/`<cam_y_lo`
    // to $2005 twice -- engine/streamworld.asm:3276-3282), not re-derived from the engine's own code
    // beyond that direct byte-for-byte read of what it writes.
    const PPUCTRL_ON = 0x88; // engine/constants.asm:1799
    assert.equal(snapshot.ctrl2000, camNtAtInteract | PPUCTRL_ON, '$2000 at the exact re-enable instant must be the saved camera nametable ORed with PPUCTRL_ON');
    assert.deepEqual(snapshot.scroll2005, [camXAtInteract, camYAtInteract], 'the two $2005 writes inside the forced-blank window must be the saved camera origin\'s own x then y, in that order');

    // Round 4, A-blocking 2: call order -- render -> OAM/entity/HUD/UI -> DMA -> enable, read
    // straight off sw_save_resync's own body (engine/streamworld.asm:3262-3285) and asserted by
    // name+position rather than merely "some order occurred".
    const expectedOrder = ['render', 'oam', 'entities'];
    if (tryAddrOf(addrOf, 'draw_hud') !== null) expectedOrder.push('hud');
    expectedOrder.push('ui', 'dma');
    assert.deepEqual(snapshot.orderTags, expectedOrder, 'sw_save_resync\'s own resync steps must run exactly once each, in the exact order the routine itself is written in (engine/streamworld.asm:3262-3285): render, then OAM/entity/HUD/UI, then the manual DMA, then (this snapshot\'s own boundary) the $2001 enable write');

    for (let i = 0; i < 30; i++) nes.frame();
    assert.equal(commitEntries.count, 1, 'save_media_commit must still read exactly one entry after a further 30-frame hold -- no spurious second commit anywhere in the transaction');
    if (freezeWatch) {
      assert.ok(freezeWatch.mainLoopChecks > 0, 'A-blocking 1: at least one main_loop entry must have been observed and checked while armed -- a vacuous hook is not a real check');
      assert.equal(freezeWatch.commitChecks, 1, 'A-blocking 1: save_media_commit entry must be checked exactly once, at the boundary where pending has already cleared');
    }
  } finally {
    commitEntries.stop();
    if (freezeWatch) freezeWatch.stop();
  }
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the marker must stay valid throughout');
}

// This file only ever reads `decoded.screen(...).terrain` (never `.entities`), so the entity
// fields themselves are never inspected -- any byte-valid placeholder satisfies
// emitStreamedScreenRecord's own required-callback check (main/build/streamed.js) without
// duplicating generate.js's real streamedEntityFields (resolveEntityByte/text.eventFor/
// triggerIndex), which is not exported and has nothing to do with terrain content.
function decodeProjectLayout(project) {
  const mapper = resolveMapper(project.cartridge.mapper);
  const plan = planStreamedRegions(project, mapper);
  const layout = emitStreamedLayout(project, {
    baseBanks: plan.baseBanks,
    entityFields: () => ({ target: 0xff, event: 0xff, trigger: 0 })
  });
  return decodeStreamedLayout(layout);
}

for (const gameType of ['action', 'rpg']) {
  for (const mixed of [false, true]) {
    for (const box of [false, true]) {
      test(`discharge content (${gameType}, ${mixed ? 'mixed' : 'streamed'} project, ${box ? 'box open' : 'no box'}, nonzero camera origin): full terrain/attribute/shadow/OAM/DMA/record content is correct at the exact re-enable instant, commit fires exactly once`, { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
        let project;
        let slot;
        if (mixed) {
          const built = createMinimalMixedProject({ gameType });
          project = nonzeroTerrainFixture(built.project);
          project.project.titleMap = 0;
          project.project.titleScreen = 0;
          const commands = box ? [say('Hi.'), saveCmd()] : [saveCmd()];
          slot = interactOn(built.streamedMap.screens[0], project, { x: 200, y: 40, commands });
        } else {
          project = nonzeroTerrainFixture(createStreamedProject({ gameType }));
          project.project.titleMap = 0;
          project.project.titleScreen = 0;
          const screen = project.maps[project.maps.length - 1].screens[0];
          const commands = box ? [say('Hi.'), saveCmd()] : [saveCmd()];
          slot = interactOn(screen, project, { x: 200, y: 40, commands });
        }
        const decoded = decodeProjectLayout(project);
        const { nes, mem, addrOf } = await buildAndBoot(project);
        assertDischargeShape(nes, mem, addrOf, slot, { box, decoded });
      });
    }
  }
}

// =================================================================================================
// Fix round 1b, gap 3: a deferred Save's completion must resume back into the SAME scripting
// context it was armed from -- a common event reached by OP_CALL, and a chosen Choice option --
// exactly once, proven by an independently observable effect (a switch, read directly off RAM)
// that only the command AFTER Save in that same context can set. script_ptr is a single global
// cursor into event data regardless of call depth or which option was chosen, so sw_dlg20_pending_
// tick's own resume (script_resume, unconditionally wherever script_ptr already points) has no
// reason to care how it got there -- but that is exactly the claim these two tests each drive for
// real rather than assume.
// =================================================================================================

const VARIABLES = 0x0500; // engine/constants.asm:902
function addVarCmd(variable, value) {
  return { op: 'addVar', variable, value };
}

// Round 2 finding A2: setSwitchCmd is IDEMPOTENT (turning an already-on switch on again is a
// no-op) and does not count executions, so neither continuation test below could actually tell
// "ran once" from "ran twice" -- only "ran at least once." addVar is not idempotent (each
// execution adds to the variable), so a spurious re-entry that setSwitch would hide is directly
// visible as the wrong number. Both tests also now carry a commit-entry PC counter spanning the
// whole test, and the OP_CALL test's caller carries a DISTINCT command after the call returns (a
// second variable, incremented only by the CALLER's own continuation) -- the common-event caller
// used to have an empty continuation, which cannot distinguish "the callee's own tail ran" from
// "the return to the caller itself is broken but happens to still finish the event."
test('continuation (fix round 1b/2, gap 3): a deferred Save reached through an OP_CALL common event resumes into the callee\'s own remaining command exactly once, then the call returns into a distinct caller command exactly once', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.commonEvents = [
    { id: 0, name: 'DoSave', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [saveCmd(), addVarCmd(0, 1)] }] } },
  ];
  const screen = project.maps[project.maps.length - 1].screens[0];
  const slot = interactOn(screen, project, { x: 200, y: 40, commands: [say('Hi.'), { op: 'call', event: 0 }, addVarCmd(1, 1)] });
  const { nes, mem, addrOf } = await buildAndBoot(project);
  const commitEntries = countPcEntries(nes, addrOf('save_media_commit'));

  walkToNonzeroCamera(nes, mem);
  assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'the player must actually reach the NPC');
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the Say must reach ENDWAIT before dismissing');
  assert.equal(mem[VARIABLES + 0], 0, 'sanity: the callee\'s own variable must not be touched before the callee has even been entered');
  pressOnce(nes, B); // dismiss -- script_resume enters the common event, whose own script_op_save arms the deferred Save
  assert.equal(mem[SW_DLG20_SAVE_PENDING], 1, 'the arm must fire from inside the callee exactly as it does from an ordinary page');
  assert.equal(sectorMarker(nes), 0xff, 'must not have committed yet -- the box was still open, drawing down');
  assert.equal(mem[VARIABLES + 0], 0, 'the callee\'s own command AFTER Save must not have run yet -- the commit has not resolved');
  waitForResync(nes, mem);
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the commit must have fired once the drain was acknowledged');
  assert.equal(mem[VARIABLES + 0], 1, 'the callee must resume into its own remaining command exactly once, after (not before) the commit resolves');
  assert.equal(mem[VARIABLES + 1], 1, 'the call must return to the CALLER\'s own distinct continuation, which must itself run exactly once');
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the call must return and the whole event must finish');
  for (let i = 0; i < 20; i++) nes.frame();
  assert.equal(mem[VARIABLES + 0], 1, 'no spurious re-entry into the callee\'s own continuation');
  assert.equal(mem[VARIABLES + 1], 1, 'no spurious re-entry into the caller\'s own continuation');
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'no spurious second commit');
  commitEntries.stop();
  assert.equal(commitEntries.count, 1, 'save_media_commit must be entered exactly once, at instruction granularity, for the whole OP_CALL sequence');
});

test('continuation (fix round 1b/2, gap 3): a deferred Save reached through a chosen Choice option resumes into that option\'s own remaining command exactly once', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const screen = project.maps[project.maps.length - 1].screens[0];
  const slot = interactOn(screen, project, {
    x: 200, y: 40,
    commands: [{ op: 'choice', options: [
      { text: 'Yes', commands: [saveCmd(), addVarCmd(0, 1)] },
      { text: 'No', commands: [] },
    ] }],
  });
  const { nes, mem, addrOf } = await buildAndBoot(project);
  const commitEntries = countPcEntries(nes, addrOf('save_media_commit'));

  walkToNonzeroCamera(nes, mem);
  assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'the player must actually reach the NPC');
  pressOnce(nes, B); // open -- box_choose lists both option rows and lands on CHOICEWAIT with option 0 ("Yes") selected by default
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_CHOICEWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_CHOICEWAIT, 'sanity: must reach the option-picking wait');
  assert.equal(mem[VARIABLES + 0], 0, 'sanity: the option\'s own variable must not be touched before the option is even confirmed');
  pressOnce(nes, B); // confirm option 0 ("Yes") -- script_choose enters its own commands, whose script_op_save arms the deferred Save
  assert.equal(mem[SW_DLG20_SAVE_PENDING], 1, 'the arm must fire from inside the chosen option\'s own commands');
  assert.equal(sectorMarker(nes), 0xff, 'must not have committed yet -- the box was still open, drawing down');
  assert.equal(mem[VARIABLES + 0], 0, 'the option\'s own command AFTER Save must not have run yet -- the commit has not resolved');
  waitForResync(nes, mem);
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the commit must have fired once the drain was acknowledged');
  assert.equal(mem[VARIABLES + 0], 1, 'the chosen option must resume into its own remaining command exactly once, after (not before) the commit resolves');
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the whole event must finish once the option\'s own commands run out');
  for (let i = 0; i < 20; i++) nes.frame();
  assert.equal(mem[VARIABLES + 0], 1, 'no spurious re-entry: the variable must not increment again');
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'no spurious second commit');
  commitEntries.stop();
  assert.equal(commitEntries.count, 1, 'save_media_commit must be entered exactly once, at instruction granularity, for the whole Choice sequence');
});

// =================================================================================================
// Mixed project: an ordinary-map Save takes no streamed-state reads/close/resync after the ordinary
// branch (finding 10's corrected framing -- the one-compare dispatch itself always runs).
// =================================================================================================

test('positive control: a mixed project\'s ordinary-map Save commits on the exact same frame as the triggering press, using the ordinary enable_rendering(0,0) tail, unaffected by close-for-Save', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const { project, ordinaryMap } = createMinimalMixedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const slot = interactOn(ordinaryMap.screens[0], project, { x: 96, y: 96, commands: [saveCmd()] });
  project.project.startMap = project.maps.indexOf(ordinaryMap);
  project.project.startScreen = 0;
  const { nes, mem } = await buildAndBoot(project, { requireStreamed: false });
  assert.equal(mem[MAP_IS_STREAMED], 0, 'sanity: must actually have booted onto the ordinary map');
  assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'the player must actually reach the NPC');
  pressOnce(nes, B);
  // save_media_commit's own FIRST jsr wait_vblank_poll (engine/save.asm) is unconditional on every
  // SAVE_FLASH build, streamed or not -- it predates this ROADMAP item entirely -- and waits for
  // the next real vblank onset from wherever in the current frame the triggering press happened to
  // land, an ordinary 0-to-~1-frame wait by construction, not anything close-for-Save added. A
  // fixed number of walkToward steps (hence a fixed CPU-cycle count reaching this press) makes
  // which side of that wait the press lands on a matter of overall ROM cycle-count parity, which
  // shifts with unrelated code elsewhere in the engine -- so a bounded poll, not a single frame, is
  // what's actually guaranteed. The real, intended invariant this test protects (the ordinary
  // branch is never slowed by anything close-for-Save added, unlike sw_save_resync's own ~35-44
  // frame redraw+OAM+scroll tail, cases 8's and waitForResync's own header above) is the small
  // bound itself: 5 frames, generously over the observed 1-frame need (handoff-next/
  // s9-diag-test5.mjs), and nowhere near the streamed path's own order of magnitude.
  let commitFrames = 0;
  while (sectorMarker(nes) !== SAVE_MARKER_VALID && commitFrames < 5) {
    nes.frame();
    commitFrames++;
  }
  assert.ok(commitFrames < 5, 'the ordinary-map commit must land within a handful of frames of the triggering press -- an ordinary vblank wait, not the streamed path\'s own multi-frame redraw');
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the ordinary-map commit must actually have happened');
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the Save-only page must finish by the same frame the commit lands');
  // The ordinary tail hardcodes the scroll latch to 0,0 (enable_rendering) -- the direct, concrete
  // proof that the ORDINARY branch ran, not sw_save_resync (which would have preserved whatever
  // nonzero origin, if any, the ordinary map's own camera happened to hold).
  assert.equal(mem[CAM_X_LO], 0, 'the ordinary tail must reset cam_x_lo to 0 -- proof the streamed resync never ran');
  assert.equal(mem[CAM_Y_LO], 0, 'the ordinary tail must reset cam_y_lo to 0 -- proof the streamed resync never ran');
});

// fix round 1c, item 1 (case 2 kill): the "positive control" test above uses a Save-only page (no
// Say), so box_state is 0 throughout and sw_dlg20_save_dispatch's own no-box branch
// (sw_dlg20_save_immediate: jsr save_media_commit; jmp script_next1) is functionally identical to
// the ordinary fallthrough's own jsr save_media_commit -- save_media_commit's OWN internal
// map_is_streamed check (sw_save_commit_tail) is genuinely still correct either way (this map is
// not streamed), so that test's own assertions (5-frame commit bound, cam reset to 0,0) hold
// whether or not script_op_save_dispatch's own map_is_streamed check ran at all. That is exactly
// why the case 2 mutant (main/build/generate.js's own sabotage-harness.mjs: script_op_save_
// dispatch's `lda <map_is_streamed / beq script_op_save_ordinary` check dropped, so an ordinary map
// always dispatches through sw_dlg20_save_dispatch too) produces zero failures in the committed
// suite. A box actually being open is what exposes the real difference: sw_dlg20_save_dispatch's
// OTHER branch (box_state != 0) unconditionally defers -- script_skip, sw_dlg20_save_pending = 1,
// box_close, suspend -- which an ordinary map's Save must never do at all (its own design comment,
// above: "commits on the exact same frame as the triggering press... unaffected by close-for-
// Save"). This test drives Say -> Save (a real open box) on the ordinary map of a mixed ROM and
// proves, by PC-hook entry count, that the map dispatch never reaches any streamed-only save
// routine.
test('case 2 kill: Say -> Save on the ordinary map of a mixed ROM commits synchronously on dismissal, with zero entries into any streamed close/state/resync routine', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const { project, ordinaryMap } = createMinimalMixedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const slot = interactOn(ordinaryMap.screens[0], project, { x: 96, y: 96, commands: [say('Hi.'), saveCmd()] });
  project.project.startMap = project.maps.indexOf(ordinaryMap);
  project.project.startScreen = 0;
  const { nes, mem, addrOf } = await buildAndBoot(project, { requireStreamed: false });
  assert.equal(mem[MAP_IS_STREAMED], 0, 'sanity: must actually have booted onto the ordinary map');
  assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'the player must actually reach the NPC');
  pressOnce(nes, B);
  const openFrames = driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.ok(openFrames < 60, 'sanity: the box must actually open and finish typing within budget');

  const dispatchAddr = addrOf('sw_dlg20_save_dispatch');
  const pendingTickAddr = addrOf('sw_dlg20_pending_tick');
  const resyncAddr = addrOf('sw_save_resync');
  const commitAddr = addrOf('save_media_commit');

  let dispatchCount = 0;
  let pendingTickCount = 0;
  let resyncCount = 0;
  let commitCount = 0;
  const origEmulate = nes.cpu.emulate.bind(nes.cpu);
  nes.cpu.emulate = () => {
    const pc = nes.cpu.REG_PC + 1;
    if (pc === dispatchAddr) dispatchCount++;
    else if (pc === pendingTickAddr) pendingTickCount++;
    else if (pc === resyncAddr) resyncCount++;
    else if (pc === commitAddr) commitCount++;
    return origEmulate();
  };
  try {
    pressOnce(nes, B); // dismiss -- on this map, this must commit right here, not arm a deferral
  } finally {
    nes.cpu.emulate = origEmulate;
  }

  assert.equal(dispatchCount, 0, 'sw_dlg20_save_dispatch (the streamed map dispatch) must never be entered for an ordinary map\'s Save');
  assert.equal(pendingTickCount, 0, 'sw_dlg20_pending_tick (the deferred-completion hook) must never be entered after an ordinary map\'s Save dispatch');
  assert.equal(resyncCount, 0, 'sw_save_resync (the streamed 3-step resync) must never be entered for an ordinary map\'s Save');
  assert.equal(commitCount, 1, 'save_media_commit must be entered exactly once, synchronously on the dismiss press, not deferred');

  const closeFrames = driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 30);
  assert.ok(closeFrames < 30, 'sanity: the ordinary box-close draw-down must still finish within budget');
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the commit already counted above must actually have written a valid record');
  assert.equal(mem[CAM_X_LO], 0, 'the ordinary tail must reset cam_x_lo to 0 -- confirms the ordinary (non-resync) tail ran');
  assert.equal(mem[CAM_Y_LO], 0, 'the ordinary tail must reset cam_y_lo to 0 -- confirms the ordinary (non-resync) tail ran');
});

// =================================================================================================
// Mixed-project save/load identity ("wrong row 2/2b, third round"): walking within the ordinary
// map with a real cross_left, Save for real, reload, and the restored screen must be the correct
// GLOBAL flat_screen id -- not a compacted ord_screen value that collides with a different global
// screen. createMinimalMixedProject's own layout makes this collision concrete and natural, not
// synthetic, and independent of exact map sizes: flatScreens (shared/project.js) assigns ids by
// map order, so the Streamed map (first, one screen) claims flat id 0 and no ord_screen row at
// all; the Ordinary map (second, two screens) claims flat ids 1-2 and ord_screen rows 0-1 -- so
// the Ordinary map's own screen 0 (flat 1, ord 0) numerically collides, on its ORD id, with the
// Streamed map's own screen 0 (flat 0). A load that wrongly restored/interpreted ord_screen as if
// it were flat_screen would land on the Streamed map's screen 0 instead (map_is_streamed would
// read 1, not 0) -- the exact, real defect this test would catch.
// =================================================================================================

test('mixed-project save/load identity: Save on the ordinary map after a real cross_left restores the correct global flat_screen, not a colliding compacted ord_screen', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const { project, streamedMap, ordinaryMap } = createMinimalMixedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const flat = flatScreens(project);
  const expectedFlatOrdinary0 = flat.findIndex((e) => e.screen === ordinaryMap.screens[0]);
  assert.equal(expectedFlatOrdinary0, 2, 'sanity: this fixture\'s own layout must put the Ordinary map\'s screen 0 at global flat id 2 (Streamed claims flat ids 0-1)');
  assert.equal(flat.findIndex((e) => e.screen === streamedMap.screens[0]), 0, 'sanity: the Streamed map\'s own screen 0 must sit at the colliding global flat id 0 (its own ord_screen 0 is what the Ordinary map\'s screen 0 collides with)');

  const slot = interactOn(ordinaryMap.screens[0], project, { x: 32, y: 96, commands: [saveCmd()] });
  project.project.startMap = project.maps.indexOf(ordinaryMap);
  project.project.startScreen = 1; // one screen right of screen 0
  const { nes } = await buildAndBoot(project, { requireStreamed: false });
  let mem = nes.cpu.mem;
  assert.equal(mem[MAP_IS_STREAMED], 0, 'sanity: must have booted onto the ordinary map');
  const flatBeforeCross = mem[FLAT_SCREEN];

  // A real cross_left: walk to the screen's own left edge until the engine's own crossing code
  // fires and flat_screen changes.
  driveUntil(nes, mem, () => (nes.buttonDown(1, LEFT), nes.frame(), nes.buttonUp(1, LEFT), mem[FLAT_SCREEN] !== flatBeforeCross), 400);
  assert.equal(mem[FLAT_SCREEN], expectedFlatOrdinary0, 'the real cross_left must land on the Ordinary map screen 0\'s own global flat id');
  assert.equal(mem[MAP_IS_STREAMED], 0, 'sanity: still on the ordinary map after crossing');

  assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'the player must actually reach the saver on the Ordinary map\'s screen 0');
  pressOnce(nes, B);
  // See the positive control test above (obligation 4, mixed-project section) for why this needs a
  // small bounded poll rather than a single frame: save_media_commit's own unconditional (any
  // SAVE_FLASH build, streamed or not) jsr wait_vblank_poll is an ordinary 0-to-~1-frame wait for
  // the next real vblank from wherever the press happened to land, not anything close-for-Save added.
  let commitFrames = 0;
  while (sectorMarker(nes) !== SAVE_MARKER_VALID && commitFrames < 5) {
    nes.frame();
    commitFrames++;
  }
  assert.ok(commitFrames < 5, 'the ordinary-map commit must land within a handful of frames of the triggering press');
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the Save must actually commit');
  assert.equal(sectorByte(nes, RECORD_FLAT_SCREEN_OFFSET), expectedFlatOrdinary0, 'the flash record must store the correct global flat_screen id');

  // nes.reloadROM() -> loadROM() -> cpu.reset() allocates a BRAND NEW `Uint8Array(0x10000)`
  // (renderer/emulator/core/cpu.js:640) rather than clearing the existing one in place, so `mem`
  // captured before this point is now a stale reference to the abandoned pre-reload array -- it
  // would read back all zeroes forever, no matter how many frames elapse, exactly the "0 !== 3"
  // failure this test used to show. test/unit/flashsave.test.js's own in-session-reset test avoids
  // this by reading `nes.cpu.mem[...]` fresh at every call site instead of caching it; re-fetching
  // the reference once here is equivalent and keeps every assertion below unchanged.
  nes.reloadROM();
  mem = nes.cpu.mem;
  for (let i = 0; i < 60; i++) nes.frame();
  assert.equal(mem[GAME_STATE], ST_TITLE, 'a power cycle must boot back to the title');
  pressOnce(nes, SELECT); // Continue
  for (let i = 0; i < 30; i++) nes.frame();
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'Continue must have loaded the save and resumed play');
  assert.equal(mem[FLAT_SCREEN], expectedFlatOrdinary0, 'Continue must restore the correct global flat_screen id, not the colliding ord_screen value (0) that would land on the Streamed map instead');
  assert.equal(mem[MAP_IS_STREAMED], 0, 'a wrong-row bug would land on the Streamed map\'s own colliding screen 0 instead -- this must read 0, not 1');
});

// =================================================================================================
// The Continue runtime row (carried in from slice 6): a real Save on a streamed screen at a
// nonzero camera origin, a power cycle (flash persisting), then Continue from the title, landing
// coherently (camera, OAM, terrain in one frame).
// =================================================================================================

test('Continue runtime row: a real flash Save on a streamed screen at a nonzero camera origin survives a power cycle and Continue lands coherently', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const screen = project.maps[project.maps.length - 1].screens[0];
  const slot = interactOn(screen, project, { x: 200, y: 40, commands: [saveCmd()] });
  const { nes } = await buildAndBoot(project);
  let mem = nes.cpu.mem;

  walkToNonzeroCamera(nes, mem);
  assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'the player must actually reach the saver');
  // Captured here, immediately before the interact -- walking on from the minimal nonzero-camera
  // check to the saver's own position moves the camera further still. cam_x_lo/cam_y_lo themselves
  // are not re-checked by this test any more (round 3, finding A-blocking 2 -- see the settle-loop
  // removal below); flat_screen/x/y still are.
  const flatAtSave = mem[FLAT_SCREEN];
  const xAtSave = mem[PLAYER_X];
  const yAtSave = mem[PLAYER_Y];

  pressOnce(nes, B);
  waitForResync(nes, mem);
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the Save must actually commit');

  // Walk away so the in-progress position visibly differs from the saved spot.
  walkToward(nes, mem, xAtSave + 80, yAtSave);
  assert.notEqual(mem[PLAYER_X], xAtSave, 'walking away must actually have moved the player');

  // Power cycle: reloadROM reparses the write-through-updated ROM bytes (the flash sector
  // survives), the same mechanism test/unit/flashsave.test.js's own in-session-reset test uses.
  // reloadROM() -> loadROM() -> cpu.reset() allocates a brand new backing array
  // (renderer/emulator/core/cpu.js:640) rather than clearing this one in place, so `mem` must be
  // re-fetched here or every assertion below reads a stale, permanently-zeroed pre-reload array.
  nes.reloadROM();
  mem = nes.cpu.mem;
  for (let i = 0; i < 60; i++) nes.frame();
  assert.equal(mem[GAME_STATE], ST_TITLE, 'a power cycle must boot back to the title');

  pressOnce(nes, SELECT); // Continue
  // continue_game (engine/save.asm) stores game_state=ST_GAMEPLAY BEFORE its own `jmp
  // redraw_screen` -- so this predicate is satisfied while redraw_screen's streamed branch
  // (engine/screens.asm: sw_resolve_screen -> sw_render_window -> ... -> wait_vblank_poll ->
  // $2000/$2005x2/$2001) may still be mid-flight. This mirrors the save-commit path's own
  // sw_save_resync latency (waitForResync's header, above): the redraw is CPU-cycle-heavy enough
  // to span multiple nes.frame() call boundaries, so game_state alone cannot localise "landed."
  const frames = driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 120);
  assert.ok(frames < 120, 'Continue must actually resume play within budget');
  assert.equal(mem[MAP_IS_STREAMED], 1, 'Continue must land back on the streamed map');
  assert.equal(mem[FLAT_SCREEN], flatAtSave, 'Continue must restore the saved global screen id');
  assert.equal(mem[PLAYER_X], xAtSave, 'Continue must restore the saved player x');
  assert.equal(mem[PLAYER_Y], yAtSave, 'Continue must restore the saved player y');

  // Round 3, finding A-blocking 2 (Chris's ruling: no settle slack of any kind): this test used to
  // poll scrollX/scrollY here for up to 60 frames -- exactly the check the comment on the very next
  // test block (below) documents as unable to catch a real mutant (B1-landing-scroll-zero): a
  // wrong-at-the-landing-instant scroll republish is invisible to a settle loop, because main_loop's
  // own per-frame NMI republishes cam_x_lo/cam_y_lo to $2005 again on the next ordinary frame
  // regardless of what the landing itself wrote. "B1-landing kill (Continue)" (the next test but
  // one) already asserts the real, exact-instant claim this loop only approximated -- snapshotted
  // at the landing's own $2001 re-enable write, before any correcting NMI can run -- so this test
  // keeps only its own distinct claim: the landing is stable once it settles, not bounced back to
  // another state.
  for (let i = 0; i < 60 && mem[GAME_STATE] !== ST_GAMEPLAY; i++) nes.frame();
  for (let i = 0; i < 10; i++) nes.frame();
  assert.equal(mem[GAME_STATE], ST_GAMEPLAY, 'the landing must be stable, not bounce back to another state');
});

// =================================================================================================
// Fix round 1c, item 1 (B1-landing kill): sw_redraw_screen_landing (engine/streamworld.asm) is one
// shared routine with two callers -- engine/boot.asm's boot_streamed_landing (cold start only) and
// engine/screens.asm's redraw_screen_dispatch (every other redraw, Continue included). A mutant
// hardcoding its own $2005 republish to #$00 ("B1-landing-scroll-zero") produced zero failures
// across the WHOLE committed suite at the time this was written, including the "Continue runtime
// row" test above, which only polls scrollX/scrollY until they settle within a 60-frame budget --
// this mutant still passes that check, because main_loop's own per-frame NMI republishes cam_x_lo/
// cam_y_lo to $2005 again on the very next frame regardless of what the landing itself just wrote.
// Snapshotting the real PPU scroll registers at the exact re-enable ($2001 != 0) write -- before
// that first correcting NMI has any chance to run -- is the only way to see the landing's own
// republish specifically. Both tests below use the same technique as the "$2001-write snapshot"
// test above, applied to each of the two callers in turn.
// =================================================================================================

test('B1-landing kill (cold boot): the cold-start streamed landing republishes a nonzero camera origin at the exact display-enable write', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  // buildAndBoot's own shared boot sequence never exercises boot_streamed_landing at a nonzero
  // origin: this fixture's default start position (startScreen/startX/startY unset) lands at
  // camera (0,0), indistinguishable from the mutant. main/build/generate.js emits START_SCREEN/
  // START_X/START_Y directly from project.project.startScreen/startX/startY with no derivation
  // (main/build/generate.js:4512-4514), so setting them explicitly is enough to force a nonzero
  // cold-boot origin without touching anything else about the fixture -- confirmed empirically
  // (handoff-next/s9-fix1c-evidence/b1landing-newtest-proto.mjs) that this exact combination on the
  // default 3x2-grid streamed fixture yields camX=8, camY=88, camNt=1 at cold-boot gameplay.
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.project.startMap = 0;
  project.project.startScreen = 1;
  project.project.startX = 128;
  project.project.startY = 200;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-closesave-b1boot-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const bytes = new Uint8Array(fs.readFileSync(built.romPath));
    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(bytes);
    const mem = nes.cpu.mem;

    // Same cold-boot-to-title wait buildAndBoot's own header comment explains: reset's boot_clear
    // transiently zeroes game_state before TITLE_ENABLED's own store lands a few frames later, and
    // NMI/main_loop stay off until enable_rendering, so a plain frame count alone is not a reliable
    // "ready" signal.
    let frames = 0;
    do {
      nes.frame();
      frames++;
    } while (mem[GAME_STATE] !== ST_TITLE && frames < 200);
    assert.ok(frames < 200, 'cold boot must reach ST_TITLE within 200 frames');
    for (let i = 0; i < 40; i++) nes.frame();

    // Install the snapshot hook BEFORE pressing Start -- this landing happens once, immediately
    // after Start, inside boot_streamed_landing itself.
    let sawOff = false;
    let snapshot = null;
    const originalWrite = nes.mmap.write.bind(nes.mmap);
    nes.mmap.write = (address, value) => {
      if (address === 0x2001) {
        if (value === 0) sawOff = true;
        else if (sawOff && !snapshot) {
          snapshot = { mem: mem.slice(), scrollX: scrollX(nes), scrollY: scrollY(nes), value };
        }
      }
      return originalWrite(address, value);
    };
    try {
      nes.buttonDown(1, START);
      nes.frame();
      nes.buttonUp(1, START);
      for (let i = 0; i < 60 && !snapshot; i++) nes.frame();
    } finally {
      nes.mmap.write = originalWrite;
    }

    assert.ok(sawOff, 'sanity: the cold-start landing must force rendering off first');
    assert.ok(snapshot, 'sanity: the cold-start landing must reach its own real re-enable write within budget');
    assert.equal(mem[MAP_IS_STREAMED], 1, 'sanity: the fixture must actually cold-boot onto the streamed map');
    assert.equal(snapshot.value, 0x1e, 'the re-enable write must be the real PPUMASK_ON value');
    assert.equal(snapshot.mem[CAM_X_LO], 8, 'at the exact re-enable instant, cam_x_lo must already read the true nonzero cold-boot origin');
    assert.equal(snapshot.mem[CAM_Y_LO], 88, 'at the exact re-enable instant, cam_y_lo must already read the true nonzero cold-boot origin');
    assert.equal(snapshot.mem[CAM_NT], 1, 'at the exact re-enable instant, cam_nt must already read the true cold-boot origin nametable');
    // scrollX() folds the horizontal nametable-select bit in as +256 (nes.ppu.regH * 256), and
    // this fixture's own cam_nt is 1 here (asserted above) -- confirmed empirically to be the
    // horizontal-only bit (regV stays 0, so scrollY's own %240 already strips its analogous +240
    // term regardless).
    assert.equal(snapshot.scrollX, 256 + 8, 'the real PPU X scroll register (folding in the horizontal nametable-select bit) must already hold the true nonzero origin at that exact instant -- this is exactly what B1-landing-scroll-zero (sw_redraw_screen_landing\'s own $2005 pair hardcoded to #$00) would zero out');
    assert.equal(snapshot.scrollY % 240, 88, 'the real PPU Y scroll register must already hold the true origin at that exact instant');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('B1-landing kill (Continue): Continue\'s own streamed landing (redraw_screen_dispatch) republishes the saved nonzero camera origin at the exact display-enable write', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const screen = project.maps[project.maps.length - 1].screens[0];
  const slot = interactOn(screen, project, { x: 200, y: 40, commands: [saveCmd()] });
  const { nes } = await buildAndBoot(project);
  let mem = nes.cpu.mem;

  walkToNonzeroCamera(nes, mem);
  assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'the player must actually reach the saver');
  const camXAtSave = mem[CAM_X_LO];
  const camYAtSave = mem[CAM_Y_LO];
  const camNtAtSave = mem[CAM_NT];
  const flatAtSave = mem[FLAT_SCREEN];
  const xAtSave = mem[PLAYER_X];
  const yAtSave = mem[PLAYER_Y];

  pressOnce(nes, B);
  waitForResync(nes, mem);
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the Save must actually commit');

  nes.reloadROM();
  mem = nes.cpu.mem;
  for (let i = 0; i < 60; i++) nes.frame();
  assert.equal(mem[GAME_STATE], ST_TITLE, 'a power cycle must boot back to the title');

  let sawOff = false;
  let snapshot = null;
  const originalWrite = nes.mmap.write.bind(nes.mmap);
  nes.mmap.write = (address, value) => {
    if (address === 0x2001) {
      if (value === 0) sawOff = true;
      else if (sawOff && !snapshot) {
        snapshot = { mem: mem.slice(), scrollX: scrollX(nes), scrollY: scrollY(nes), value };
      }
    }
    return originalWrite(address, value);
  };
  try {
    pressOnce(nes, SELECT); // Continue
    for (let i = 0; i < 120 && !snapshot; i++) nes.frame();
  } finally {
    nes.mmap.write = originalWrite;
  }

  assert.ok(sawOff, 'sanity: Continue\'s own landing must force rendering off first');
  assert.ok(snapshot, 'sanity: Continue\'s own landing must reach its own real re-enable write within budget');
  assert.equal(mem[MAP_IS_STREAMED], 1, 'sanity: Continue must land back on the streamed map');
  assert.equal(mem[FLAT_SCREEN], flatAtSave, 'sanity: Continue must restore the saved global screen id');
  assert.equal(mem[PLAYER_X], xAtSave, 'sanity: Continue must restore the saved player x');
  assert.equal(mem[PLAYER_Y], yAtSave, 'sanity: Continue must restore the saved player y');
  assert.equal(snapshot.value, 0x1e, 'the re-enable write must be the real PPUMASK_ON value');
  assert.equal(snapshot.mem[CAM_X_LO], camXAtSave, 'at the exact re-enable instant, cam_x_lo must already read the true saved nonzero origin');
  assert.equal(snapshot.mem[CAM_Y_LO], camYAtSave, 'at the exact re-enable instant, cam_y_lo must already read the true saved origin');
  assert.equal(snapshot.mem[CAM_NT], camNtAtSave, 'at the exact re-enable instant, cam_nt must already read the true saved origin nametable');
  assert.equal(snapshot.scrollX, camXAtSave, 'the real PPU X scroll register must already hold the true saved origin at that exact instant');
  assert.equal(snapshot.scrollY % 240, camYAtSave, 'the real PPU Y scroll register must already hold the true saved origin at that exact instant');
});

// =================================================================================================
// Round 2 finding A2: "Continue landing-frame matrix" -- the design contract's own transition table
// (docs/design-streamed-worlds.md section 8) Continue row: "Cancelled | Set | Armed | None | Reset
// via the same one-initialiser resolution as a warp." The "Continue runtime row" test above already
// proves camera restoration, but polls up to a 60-frame settle budget rather than checking at the
// exact landing instant, and checks none of screen_fresh, the entry event's own arm/consume, or
// real terrain/OAM content (its own header comment explains why: the DEFAULT fixture's tileset maps
// every metatile to the same blank CHR pattern, so a content scan can never distinguish a correct
// landing from an incorrect one there). This test removes the settle allowance for every restored
// field (checking all of them at the exact $2001 re-enable write, the same instant "B1-landing kill
// (Continue)" above already snapshots scroll at) and adds screen_fresh, the entry event's arm (at
// that instant) and its consumption (on the very next real main_loop pass once rendering resumes --
// settle_owed, engine/boot.asm, only ever sees pending_ent on the first pass after the landing's own
// re-enable write, since continue_game's whole landing runs as one continuous call chain with no
// intervening main_loop pass), and this file's own A2 nonzeroTerrainFixture for the full terrain/
// attribute/shadow/OAM/DMA content check.
// =================================================================================================

function enterEventOn(screen, project, { x, y, commands, actorName = 'Watcher' }) {
  const actorId = project.sprites.actors.length;
  project.sprites.actors.push({ name: actorName, behavior: 'npc', hp: 1, damage: 0 });
  screen.entities = screen.entities ?? [];
  const slot = screen.entities.length;
  screen.entities.push({ actorId, x, y, props: { trigger: 'enter', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } } });
  return slot;
}

test('Continue landing-frame matrix: spawn/restoration, screen_fresh, entry-event arming and consumption, and full terrain/OAM content all agree at the exact landing instant', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = nonzeroTerrainFixture(createStreamedProject({ gameType: 'action' }));
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const screen = project.maps[project.maps.length - 1].screens[0];
  const saveSlot = interactOn(screen, project, { x: 200, y: 40, commands: [saveCmd()] });
  const ENTRY_VAR = 0;
  const ENTRY_VALUE = 9;
  // addVar is not idempotent -- placed on the same screen the player starts on, so this screen's
  // own entry event already fires once during cold boot (arm_event/spawn_streamed run on every
  // screen entry, cold boot included). Rather than assume 0, `bootValue` below captures whatever
  // that cold-boot run already left, and Continue's own landing is proven to have run the SAME
  // event EXACTLY once more by checking for bootValue + ENTRY_VALUE specifically -- a spurious
  // extra dispatch (twice more) or a missing one (zero more) would each produce a different, wrong
  // total instead.
  const entrySlot = enterEventOn(screen, project, { x: 40, y: 200, commands: [addVarCmd(ENTRY_VAR, ENTRY_VALUE)] });
  const decoded = decodeProjectLayout(project);
  const { nes, addrOf } = await buildAndBoot(project);
  let mem = nes.cpu.mem;

  const settleFrames = driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 60);
  assert.ok(settleFrames < 60, 'sanity: any cold-boot entry dispatch on the start screen must fully resolve before this test\'s own baseline is captured');
  const bootValue = mem[VARIABLES + ENTRY_VAR];

  walkToNonzeroCamera(nes, mem);
  assert.ok(walkToward(nes, mem, mem[ENT_X + saveSlot], mem[ENT_Y + saveSlot]), 'the player must actually reach the saver');
  const camXAtSave = mem[CAM_X_LO];
  const camYAtSave = mem[CAM_Y_LO];
  const camNtAtSave = mem[CAM_NT];
  const flatAtSave = mem[FLAT_SCREEN];
  const xAtSave = mem[PLAYER_X];
  const yAtSave = mem[PLAYER_Y];
  const dirAtSave = mem[PLAYER_DIR]; // part of SAVE_FIELDS -- restored by Continue
  assert.equal(mem[VARIABLES + ENTRY_VAR], bootValue, 'sanity: the entry event must not fire again merely from walking around on the same, still-owned screen');

  pressOnce(nes, B);
  waitForResync(nes, mem);
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the Save must actually commit');

  nes.reloadROM();
  mem = nes.cpu.mem;
  for (let i = 0; i < 60; i++) nes.frame();
  assert.equal(mem[GAME_STATE], ST_TITLE, 'a power cycle must boot back to the title');

  // Round 4, A-blocking 2: ONE continuous observation, installed BEFORE the Continue press, spanning
  // the whole landing -- the off/on $2001 boundary (as before) AND onward through the very next real
  // main_loop pass and the very next real NMI, all through the SAME hook. Never a second hook
  // installed only after the fact: round 4's own finding was that a post-hoc hook, installed only
  // after `nes.frame()` had already returned once, could not distinguish "the very first main_loop
  // pass" from a later one inside the same frame, and could not see the DMA AT its own write instant
  // (only "some time after the frame returned"). `nmi` (engine/boot.asm:498) is the ONLY routine
  // that can perform this landing's own OAM DMA (`sta $4014` at boot.asm:535, inside its own
  // nmi_oam_guard bracket) -- sw_redraw_screen_landing (unlike sw_save_resync) never issues its own
  // manual DMA (this test's own comment below explains why), so the first $4014 write observed after
  // the enable write is, by construction, that same ordinary per-vblank NMI's own DMA.
  let sawOff = false;
  let enableSeen = false;
  let contentSnapshot = null;
  let mainLoopEntries = 0;
  let nmiEntriesAfterEnable = 0;
  let startDialogEntries = 0;
  let startDialogXAtEntry = null;
  let startDialogAtMainLoopEntry = null;
  let commitEntriesAfterEnable = 0;
  let dmaAfterEnable = null;
  const mainLoopAddr = addrOf('main_loop');
  const nmiAddr = addrOf('nmi');
  const startDialogAddr = addrOf('start_dialog');
  const commitAddr = addrOf('save_media_commit');
  const originalWrite = nes.mmap.write.bind(nes.mmap);
  nes.mmap.write = (address, value) => {
    const result = originalWrite(address, value);
    if (address === 0x2001) {
      if (value === 0) sawOff = true;
      else if (sawOff && !enableSeen) {
        enableSeen = true;
        contentSnapshot = { value, mem: mem.slice(), ...scanTerrainContent(nes, mem, decoded, EXPECTED_WIN_COL_SCREEN, EXPECTED_WIN_ROW_SCREEN) };
      }
    } else if (enableSeen && address === 0x4014 && !dmaAfterEnable) {
      // Read AFTER calling the real write (above) -- the DMA copy itself is what this write just
      // performed, so nes.ppu.spriteMem only reflects it once the real handler has run.
      dmaAfterEnable = { sourcePage: value, hardwareOam: Array.from(nes.ppu.spriteMem) };
    }
    return result;
  };
  const originalEmulate = nes.cpu.emulate.bind(nes.cpu);
  nes.cpu.emulate = () => {
    if (enableSeen) {
      const pc = nes.cpu.REG_PC + 1;
      if (pc === mainLoopAddr) mainLoopEntries++;
      else if (pc === nmiAddr) nmiEntriesAfterEnable++;
      else if (pc === startDialogAddr) {
        startDialogEntries++;
        if (startDialogXAtEntry === null) {
          startDialogXAtEntry = nes.cpu.REG_X;
          startDialogAtMainLoopEntry = mainLoopEntries;
        }
      } else if (pc === commitAddr) commitEntriesAfterEnable++;
    }
    return originalEmulate();
  };
  try {
    nes.buttonDown(1, SELECT); // Continue
    nes.frame();
    nes.buttonUp(1, SELECT);
    for (let i = 0; i < 119 && !contentSnapshot; i++) nes.frame();
    assert.ok(contentSnapshot, 'sanity: Continue\'s own landing must reach its own real re-enable write within budget');
    nes.frame(); // the very next real frame -- no settle slack (Chris's ruling)
  } finally {
    nes.mmap.write = originalWrite;
    nes.cpu.emulate = originalEmulate;
  }
  const snapshot = contentSnapshot;

  assert.ok(sawOff, 'sanity: Continue\'s own landing must force rendering off first');
  assert.equal(snapshot.value, 0x1e, 'the re-enable write must be the real PPUMASK_ON value');
  assert.equal(mem[WIN_COL_SCREEN], EXPECTED_WIN_COL_SCREEN, 'sanity: this fixture must never leave screen (0,0) -- the terrain oracle\'s own authored screen assumption depends on it');
  assert.equal(mem[WIN_ROW_SCREEN], EXPECTED_WIN_ROW_SCREEN, 'sanity: this fixture must never leave screen (0,0) -- the terrain oracle\'s own authored screen assumption depends on it');
  assert.equal(snapshot.mem[MAP_IS_STREAMED], 1, 'Continue must land back on the streamed map, already at the exact landing instant');
  assert.equal(snapshot.mem[FLAT_SCREEN], flatAtSave, 'Continue must restore the saved global screen id, already at the exact landing instant');
  assert.equal(snapshot.mem[PLAYER_X], xAtSave, 'Continue must restore the saved player x, already at the exact landing instant');
  assert.equal(snapshot.mem[PLAYER_Y], yAtSave, 'Continue must restore the saved player y, already at the exact landing instant');
  assert.equal(snapshot.mem[CAM_X_LO], camXAtSave, 'at the exact landing instant, cam_x_lo must already read the true saved origin');
  assert.equal(snapshot.mem[CAM_Y_LO], camYAtSave, 'at the exact landing instant, cam_y_lo must already read the true saved origin');
  assert.equal(snapshot.mem[CAM_NT], camNtAtSave, 'at the exact landing instant, cam_nt must already read the true saved origin nametable');

  assert.equal(snapshot.mem[SCREEN_FRESH], 1, 'the design contract\'s own Continue row (docs/design-streamed-worlds.md §8): screen_fresh must read Set at the exact landing instant');
  assert.notEqual(snapshot.mem[PENDING_ENT], NO_ENTITY, 'the design contract\'s own Continue row: the entry event must already be Armed at the exact landing instant -- spawn_streamed\'s own arm_event call runs well before the redraw\'s final re-enable write');
  assert.equal(snapshot.mem[ST_ACTIVE], 0, 'the design contract\'s own Continue row: the active strip must already read Cancelled (idle) at the exact landing instant -- Continue is a full sw_render_window redraw, never an in-flight incremental strip');
  assert.equal(snapshot.mem[BOX_STATE], BOX_CLOSED, 'the design contract\'s own Continue row: the overlay must already read None (box closed) at the exact landing instant');

  assert.equal(snapshot.terrainWrong, 0, 'every tile byte in every real nametable must match the position-dependent terrain the generator actually emitted for this project (decodeStreamedLayout), at the exact landing instant');
  assert.equal(snapshot.attributeWrong, 0, 'every attribute byte (including the partially-off-screen final row) must match the same position-dependent terrain at the exact landing instant');
  assert.equal(snapshot.shadowWrong, 0, 'attr_shadow RAM must mirror the real attribute table exactly at the exact landing instant');
  // Unlike sw_save_resync (this file's own A2 discharge section above), sw_redraw_screen_landing
  // (engine/streamworld.asm) does its own build_oam/draw_entities but never its own manual `sta
  // $4014` -- it ends with wait_vblank_poll (a plain $2002 busy-poll, no DMA) then writes
  // $2000/$2005x2/$2001 back to back, so PPUCTRL's own NMI-enable bit and PPUMASK's own render-
  // enable bit land together, right at the very end of the vblank wait_vblank_poll caught -- too
  // late in that same vblank for this call's own real DMA to land before this exact re-enable
  // instant. Asserted directly here (round 3, finding A-blocking 2), not merely stated in prose:
  // the real hardware sprite DMA for this landing is the ORDINARY per-vblank NMI DMA, which cannot
  // have run yet at this exact re-enable instant (NMI service is exactly what the whole forced-
  // blank transaction was blocking) -- a real, deliberate difference in contract from the
  // Save-resync path (which must DMA manually because it alone disables NMI service for the whole
  // transaction), not a bug this test should paper over.
  assert.equal(snapshot.dmaMatches, false, 'at the exact re-enable instant, hardware sprite memory must NOT yet match the OAM shadow page -- this landing never issues its own manual $4014 DMA, only the next ordinary per-vblank NMI can publish it');

  // Independently authored, COMPLETE OAM-shadow geometry (round 3/4, finding A-blocking 2): the
  // player's own four sprites in the OAM SHADOW page (RAM, already correct at this instant --
  // build_oam/draw_entities already ran inside the landing's own call chain) must match
  // expectedPlayerOamQuads (above), from the SAME saved position/direction/origin captured at Save
  // time -- animFrame is authored as 0, not read live: it carries no SAVE_FIELDS entry at all (only
  // player_dir does), boot_clear zeroes the whole page including it on the power cycle this test
  // drives just above, and nothing between that cold boot and this landing's own redraw ever
  // advances it (the player never walks before this exact instant is captured).
  const expectedContinueQuads = expectedPlayerOamQuads(xAtSave, yAtSave, dirAtSave, 0, camXAtSave, camYAtSave);
  assert.deepEqual(Array.from(snapshot.mem.slice(0x0200, 0x0210)), expectedContinueQuads, 'OAM shadow (RAM): the player\'s own complete 16x16 metasprite must equal the independently authored geometry for the saved position/direction/origin, already at the exact landing instant');

  // Consumption: PC-hooked, exact-entity, exact-frame -- no settle slack of any kind (Chris's
  // ruling). settle_owed only ever sees pending_ent on the first real main_loop pass after the
  // landing's own re-enable write (continue_game's whole landing runs as one continuous call chain
  // with no intervening main_loop pass, this test's own header comment above), and settle_owed's
  // own dispatch is `jsr start_dialog` with X already holding the exact entity slot
  // (engine/ui.asm's `stx <talk_ent`, the very first instruction in start_dialog) -- captured here
  // straight off the CPU register, before the engine's own store, so this check shares no code
  // with what it is checking. Round 4: `mainLoopEntries` is now a genuine PC-hooked count, numbered
  // from the enable write itself, so "the very next real main_loop pass" means literally entry #1,
  // not merely "sometime within one nes.frame() call" (main_loop can run 0+ times per frame).
  assert.equal(startDialogEntries, 1, 'the armed entry event must be consumed (start_dialog entered) exactly once, on the very next real main_loop pass after landing -- no earlier, no later, no repeat');
  assert.equal(startDialogAtMainLoopEntry, 1, 'the armed entry event must dispatch on main_loop entry #1 counted from the landing\'s own enable write, and nowhere else');
  assert.equal(startDialogXAtEntry, entrySlot, 'start_dialog must be entered with X == the exact entity slot the entry event was armed on (captured off the CPU register, before start_dialog\'s own stx <talk_ent), not merely SOME event');
  assert.equal(mem[PENDING_ENT], NO_ENTITY, 'pending_ent must be disarmed once the event dispatches (settle_owed\'s own disarm-before-running order)');
  assert.equal(commitEntriesAfterEnable, 0, 'sanity: the entry event\'s own dispatch, on this same frame, must never re-enter save_media_commit');

  // Round 4: hardware sprite-memory publication is now checked AT the observed NMI $4014 write
  // itself (boot.asm:535, the only DMA this landing can ever see, this test's own header comment
  // above), against the SAME independently authored geometry, not merely "equals the shadow" (which
  // would pass even if both sides shared an identical wrong value) and not merely "after the frame
  // returned" (which cannot distinguish the real write instant from any later moment).
  assert.ok(nmiEntriesAfterEnable >= 1, 'sanity: the real per-vblank NMI must actually run again once rendering resumes -- a vacuous hook is not a real check');
  assert.ok(dmaAfterEnable, 'the ordinary per-vblank NMI must issue its own OAM DMA on the very next real NMI once rendering resumes');
  assert.equal(dmaAfterEnable.sourcePage, 0x02, 'the per-vblank NMI\'s own DMA source page must be $02 -- the $0200 OAM shadow page');
  assert.deepEqual(dmaAfterEnable.hardwareOam.slice(0, 16), expectedContinueQuads, 'hardware sprite memory, AT the observed NMI $4014 write itself, must already equal the independently authored landing geometry');

  assert.equal(mem[VARIABLES + ENTRY_VAR], bootValue + ENTRY_VALUE, 'the entry event\'s own addVar command must already have run to completion on this same exact frame -- a single-command, no-text page resolves within the one main_loop pass that dispatches it');
});

// =================================================================================================
// Sabotage. Chris's ruling (round 7b, reaffirmed for this round as fix-round A2): a test that
// builds a mutant and asserts its symptom must never live in a committed test file. Cases 1-4, 6,
// 7 and 8 (each a mutation via a scratch copy of a real engine file with one exact string
// replaced, run against a scratch project.code.overrides build) now live in
// handoff-next/s9-fix1-evidence/sabotage-harness.mjs instead, not run by `npm test`. Only case 5
// (below, a real capacity-overflow rejection, not a mutant) and the positive (non-mutant) halves
// of cases 7 and 8 remain committed here.
// =================================================================================================

// case 5 -------------------------------------------------------------------------------------
// The plan's own case 5 (finding 13's slice-8/9 integration): a box-open Save immediately
// followed by a box-open Move in the same session must resolve both mechanisms independently.
// This USED to be unbuildable under the kernel-lo budget: a live Move command anywhere in a
// project, together with SAVE_FLASH, streaming and camera, overflowed kernel-lo by a fixed,
// content-independent amount, pre-existing at 2563ef4 before this slice added a single byte.
//
// CLOSED by B1 (phase 2 slice 9 fix round 1b, Chris's relocation ruling; see
// test/unit/kernelbytes.test.js's own "B1 ... REQUIRED target" test for the RPG+Save side of the
// same ruling): relocating spawn_streamed, build_oam_draw_sw, draw_one_entity_show_sw and the
// deduplicated sw_redraw_screen_landing to kernel-hi freed enough kernel-lo room that action +
// streamed + camera + live Move + live Save now fits -- this was the brief's OTHER required B1
// target ("action Move+Save must fit at margin >= 0 after KERNEL_SLACK"). checkCapacity is called
// directly (a pure function -- no nesasm build needed to get the exact margin) rather than only
// checking that buildProject no longer rejects, so a future regression that eats the new margin is
// caught before it silently reopens this shortfall.
//
// The mechanism itself: sw_dlg20_save_pending ($07F8, engine/constants.asm) and sw_dlg17_move_close
// ($07F1) are different addresses; sw_dlg17_camrelease's own tail (engine/streamworld.asm) checks
// the SAVE_FLASH branch (sw_dlg17cr_save_check_start/_end) strictly BEFORE the MOVE_ENABLED branch,
// with an early `rts` whenever a Save is pending -- so a Save's own resolution and a Move's own
// resolution never contend for the same frame's release. Fix round 1b, gap 5 (brief: "Case 5 is
// still a refusal test. It becomes the real integration test once B1 lands.") upgrades this from a
// capacity-only check to the actual driven sequence: Say -> Save (deferred behind the still-open
// box) -> Say (the script resumes into it once the Save commits) -> a real player Move (close-for-
// Move, the direct architectural sibling), each phase's own independent effect observed for real
// rather than assumed from the two mechanisms merely coexisting in the byte budget.
test('case 5 (fix round 1b, gap 5) REQUIRED target: the real Say -> Save -> Say -> player Move sequence now builds and runs end-to-end on a streamed map, action', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const screen = project.maps[project.maps.length - 1].screens[0];
  const slot = interactOn(screen, project, { x: 200, y: 40, commands: [say('Hi.'), saveCmd(), say('Bye.'), moveUp(16)] });

  // The capacity claim itself, kept as a direct, build-free sanity check (checkCapacity is pure --
  // no nesasm build needed to get the exact margin) alongside the real driven sequence below, so a
  // future regression that eats the new margin is caught by name, not only by buildAndBoot failing
  // somewhere inside a much longer test.
  const mapper = resolveMapper(project.cartridge.mapper);
  const { fixedBytes, tableBytes } = kernelTableBytes(project, mapper);
  const kernelBudget = kernelCodeBytes(project, mapper);
  const BANK_SIZE = 8192;
  const kernelFree = BANK_SIZE - kernelBudget - fixedBytes - tableBytes;
  const { problems } = checkCapacity(project);
  const tableProblem = problems.find((p) => /lookup tables need/.test(p.message));
  assert.equal(
    tableProblem,
    undefined,
    `action + streamed + camera + live Move + live Save should now fit -- checkCapacity still refuses it: ${tableProblem?.message}`
  );
  assert.ok(
    kernelFree >= 0,
    `action + streamed + camera + live Move + live Save: kernelFree ${kernelFree} is negative -- the REQUIRED B1 target is not met`
  );

  const { nes, mem, addrOf } = await buildAndBoot(project);
  // Round 2 finding A2: no commit PC counter or independent Move-completion counter existed here,
  // so a spurious second commit or a Move that silently never released could only have been
  // inferred from the final marker/player-Y reads, never proven directly. Both counters span the
  // WHOLE rest of this test (arm, hold, commit, second Say, Move, close), not merely until the
  // first expected event. Round 3, finding A-blocking 2: the Move-completion counter targets
  // move_finish (engine/entities.asm:1004) -- the actual per-Move completion routine, entered
  // exactly once each time move_tick's own countdown reaches zero or the mover is blocked (either
  // way `jmp move_finish`, which itself tail-calls script_resume) -- not
  // sw_dlg_closeformove_check (engine/streamworld.asm), which is close-for-Move's own UI-tick poll
  // of sw_dlg17_move_close and is reachable on ordinary dialogue ui_tick passes unrelated to any
  // Move actually finishing, a weaker signal for "the Move completed exactly once" than counting
  // the completion routine itself.
  const commitEntries = countPcEntries(nes, addrOf('save_media_commit'));
  const moveCompleteEntries = countPcEntries(nes, addrOf('move_finish'));
  walkToNonzeroCamera(nes, mem);
  assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'the player must actually reach the NPC');
  const camXAtOpen = mem[CAM_X_LO];
  const camYAtOpen = mem[CAM_Y_LO];

  // Phase 1: Say -> Save. The identical deferred-arm/hold/commit sequence assertDeferredSaveSequence
  // already proves in isolation, driven here explicitly since this test's own continuation (a SECOND
  // Say, then a Move) does not exist in that helper's own project shapes.
  pressOnce(nes, B); // open, first Say
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the first Say must reach ENDWAIT before dismissing');
  const yBeforeSave = mem[PLAYER_Y];
  pressOnce(nes, B); // dismiss -- script_resume runs script_op_save this same frame
  assert.equal(mem[SW_DLG20_SAVE_PENDING], 1, 'the arm frame must set sw_dlg20_save_pending');
  assert.equal(sectorMarker(nes), 0xff, 'must not have committed yet -- the box was still open, drawing down');
  // Unlike assertDeferredSaveSequence's own shape (nothing follows Save, so the whole event finishes
  // and game_state returns to ST_GAMEPLAY once the resync completes), this event continues into a
  // SECOND Say -- game_state stays ST_DIALOG the whole way through, so the commit's own completion
  // signal here is the flash marker itself, not waitForResync's ST_GAMEPLAY predicate.
  const resyncFrames = driveUntil(nes, mem, (m) => sectorMarker(nes) === SAVE_MARKER_VALID, 80);
  assert.ok(resyncFrames < 80, 'the deferred commit\'s own resync must actually finish within budget');
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the commit must have fired once the drain was acknowledged');
  assert.equal(mem[PLAYER_Y], yBeforeSave, 'the commit itself must not have displaced the player at all');
  assert.equal(mem[CAM_X_LO], camXAtOpen, 'cam_x_lo must still read the real nonzero origin after the Save\'s own resync');

  // Phase 2: the script must have resumed into the SECOND Say -- game_state stays ST_DIALOG for the
  // whole scripted event (Say -> Save -> Say -> Move), so the box reopening (leaving BOX_CLOSED) is
  // the only available signal, the same convention test/unit/streamworldclosemove.test.js's own
  // "positive runtime: Say -> Move -> Say" test already uses for its own post-Move continuation.
  const secondOpenFrames = driveUntil(nes, mem, (m) => m[BOX_STATE] !== BOX_CLOSED, 60);
  assert.ok(secondOpenFrames < 60, 'the second Say must actually open -- script_resume must have continued the event after the Save, not dropped it');
  // The exact instant the box leaves CLOSED (this same driveUntil's own exit frame, before any
  // further frame runs) is the one point in the whole tail a direct real-register comparison is
  // safe: the box's own opening animation (BOX_OPENING's row/attribute self-loop, sampled a few
  // frames later) transiently repurposes $2005 for its own draw offsets before restoring it, and
  // sw_save_resync's own full-window redraw does the same while it is still in flight (a real,
  // driven trace -- handoff-next/s9-fix1-evidence -- shows scrollX visiting several unrelated
  // values, some off by exactly 256 in the low byte's own carry, before finally settling) -- so
  // this is checked here, not immediately after the marker validates (the marker and the real
  // $2005/$2001 republish are separate steps of the same tail, the $2001-write snapshot test above
  // traces the exact instant) and not after any later frame either.
  assert.equal(scrollX(nes), camXAtOpen, 'the real PPU X scroll register must have already republished the true nonzero origin by the instant the second Say reopens the box');
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the second Say must reach ENDWAIT normally');
  assert.equal(mem[GAME_STATE], ST_DIALOG, 'game_state must still read ST_DIALOG going into the Move');

  // Phase 3: dismissing the second Say runs script_op_move -- close-for-Move arms exactly as it
  // does with no Save anywhere in the event (test/unit/streamworldclosemove.test.js's own case),
  // the player genuinely displaces once released, and the whole event finishes.
  pressOnce(nes, B); // dismiss the second Say -- script_resume runs script_op_move this same frame
  const yAtMoveArm = mem[PLAYER_Y];
  const moveFrames = driveUntil(nes, mem, (m) => m[MV_LEFT] === 0, 120);
  assert.ok(moveFrames < 120, 'the Move must actually complete within budget');
  assert.ok(mem[PLAYER_Y] < yAtMoveArm, 'the player must have actually moved (up decreases Y) once the Move released and ran');
  const finalCloseFrames = driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 60);
  assert.ok(finalCloseFrames < 60, 'the whole event (Say -> Save -> Say -> Move, nothing after) must finish and return to ST_GAMEPLAY');
  assert.equal(mem[SCRIPT_ACTIVE], 0, 'script_active must be clear once the whole event has genuinely finished');

  // Exactly one commit for the whole sequence -- the Move phase must never itself touch the flash
  // record, and no spurious re-entry anywhere in the tail.
  for (let i = 0; i < 20; i++) nes.frame();
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'exactly one commit for the whole sequence -- no spurious second commit from the later Move phase');
  commitEntries.stop();
  moveCompleteEntries.stop();
  assert.equal(commitEntries.count, 1, 'save_media_commit must be entered exactly once, at instruction granularity, for the whole Say -> Save -> Say -> Move sequence');
  assert.equal(moveCompleteEntries.count, 1, 'move_finish must be entered exactly once, at instruction granularity, independent of the commit counter -- the Move itself must complete exactly once');
});

// Fix round 1c, item 5: B1's own point was that RPG Save fits (unlike RPG Move+Save, refused just
// below). This drives it for real -- a streamed map at a nonzero camera origin, Say -> Save -> Say,
// asserting the commit is entered exactly once (PC hook, this file's own countPcEntries), the
// resync's $2001 snapshot is correct (RPG's own shorter sw_save_resync tail -- BATTLE_ENABLED's
// `.if !BATTLE_ENABLED / jsr draw_hud / .endif` in engine/streamworld.asm means RPG skips that one
// jsr, 45 bytes against action's 48 -- proven here to still republish the true origin correctly,
// not merely to be shorter), and the second Say's continuation runs exactly once.
test('RPG driven (fix round 1c, item 5): a streamed map at a nonzero camera origin, Say -> Save -> Say commits exactly once, the resync\'s $2001 snapshot is correct, and the continuation runs exactly once', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({ gameType: 'rpg' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const screen = project.maps[project.maps.length - 1].screens[0];
  const slot = interactOn(screen, project, { x: 200, y: 40, commands: [say('Hi.'), saveCmd(), say('Bye.')] });
  const { nes, mem, addrOf } = await buildAndBoot(project);

  walkToNonzeroCamera(nes, mem);
  assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'the player must actually reach the NPC');
  const camXAtOpen = mem[CAM_X_LO];
  const camYAtOpen = mem[CAM_Y_LO];
  const camNtAtOpen = mem[CAM_NT];

  pressOnce(nes, B); // open, first Say
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the first Say must reach ENDWAIT before dismissing');

  // The PC-hook commit counter spans the whole rest of this driven sequence -- arm, hold, commit,
  // and the second Say's own continuation -- so a spurious SECOND commit anywhere in that tail
  // (not only immediately after the first) would still be caught, not only an absence of a first.
  const commitCounter = countPcEntries(nes, addrOf('save_media_commit'));

  // The $2001-write snapshot technique (gap 2's own test, above): snapshotting at the exact
  // re-enable write proves the republished scroll is correct at the instant rendering resumes,
  // never merely correct a few frames later once other NMIs might also have run -- the same claim
  // that test already proves for action, driven here against RPG's own shorter resync tail.
  let sawOff = false;
  let snapshot = null;
  const originalWrite = nes.mmap.write.bind(nes.mmap);
  nes.mmap.write = (address, value) => {
    if (address === 0x2001) {
      if (value === 0) sawOff = true;
      else if (sawOff && !snapshot) {
        snapshot = { mem: mem.slice(), scrollX: scrollX(nes), scrollY: scrollY(nes), value };
      }
    }
    return originalWrite(address, value);
  };
  pressOnce(nes, B); // dismiss the first Say -- script_resume runs script_op_save this same frame
  assert.equal(mem[SW_DLG20_SAVE_PENDING], 1, 'the arm frame must set sw_dlg20_save_pending');
  assert.equal(sectorMarker(nes), 0xff, 'must not have committed yet -- the box was still open, drawing down');
  try {
    for (let i = 0; i < 80 && !snapshot; i++) nes.frame();
  } finally {
    nes.mmap.write = originalWrite;
  }
  assert.ok(sawOff, 'sanity: the commit must actually have forced rendering off first');
  assert.ok(snapshot, 'sanity: the resync must actually reach its own real re-enable write within budget');
  assert.equal(snapshot.value, 0x1e, 'the re-enable write must be the real PPUMASK_ON value (background+sprites, both clipped columns shown)');
  assert.equal(snapshot.mem[CAM_X_LO], camXAtOpen, 'at the exact re-enable instant, cam_x_lo must already read the true nonzero origin');
  assert.equal(snapshot.mem[CAM_Y_LO], camYAtOpen, 'at the exact re-enable instant, cam_y_lo must already read the true nonzero origin');
  assert.equal(snapshot.mem[CAM_NT], camNtAtOpen, 'at the exact re-enable instant, cam_nt must already read the true origin nametable');
  assert.equal(snapshot.scrollX, camXAtOpen, 'the real PPU X scroll register must already hold the true nonzero origin at that exact instant -- the $2005 pair is written before $2001 in sw_save_resync\'s own tail');
  assert.equal(snapshot.scrollY % 240, camYAtOpen, 'the real PPU Y scroll register must already hold the true origin at that exact instant');
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the commit must have fired once the drain was acknowledged');

  // The continuation: game_state stays ST_DIALOG through the whole scripted event (Say -> Save ->
  // Say, nothing after), so the box reopening (leaving BOX_CLOSED) is the only available signal
  // that script_resume actually continued into the second Say rather than dropping it -- the same
  // convention case 5's own phase 2 (above) uses.
  const secondOpenFrames = driveUntil(nes, mem, (m) => m[BOX_STATE] !== BOX_CLOSED, 60);
  assert.ok(secondOpenFrames < 60, 'the second Say must actually open -- script_resume must have continued the event after the Save, not dropped it');
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(mem[BOX_STATE], BOX_ENDWAIT, 'the second Say must reach ENDWAIT normally');
  assert.equal(mem[GAME_STATE], ST_DIALOG, 'game_state must still read ST_DIALOG going into the close');

  pressOnce(nes, B); // dismiss the second Say -- nothing follows it, so the whole event finishes
  const finalCloseFrames = driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 60);
  assert.ok(finalCloseFrames < 60, 'the whole event (Say -> Save -> Say, nothing after) must finish and return to ST_GAMEPLAY');
  assert.equal(mem[SCRIPT_ACTIVE], 0, 'script_active must be clear once the whole event has genuinely finished');

  commitCounter.stop();
  assert.equal(commitCounter.count, 1, 'save_media_commit must be entered exactly once for the whole Say -> Save -> Say sequence, RPG');

  // Exactly once: hold many more frames and confirm the marker never toggles again.
  for (let i = 0; i < 30; i++) nes.frame();
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the marker must stay valid -- no spurious second commit');
});

// RPG Move+Save does not meet the B1 target (still-negative kernelFree even after every B1 move --
// see the report's own B1 inventory) -- Chris's ruling only REQUIRES action Move+Save and RPG Save
// (kept fitting comfortably; see the RPG shapes in A4_SHAPES below) to fit at margin >= 0; RPG
// Move+Save itself stays "ideal", not required. This keeps a refusal test for that ONE remaining
// shape, named honestly rather than silently dropped, so a future change that also closes this gap
// has a test ready to flip rather than a silent, undocumented capability.
test('RPG Move+Save (fix round 1b): still refused by kernel-lo capacity after B1 -- not a REQUIRED target, kept honest rather than silently dropped', () => {
  const project = createStreamedProject({ gameType: 'rpg' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const screen = project.maps[project.maps.length - 1].screens[0];
  interactOn(screen, project, { x: 200, y: 40, commands: [say('Hi.'), saveCmd(), moveUp(16), say('Bye.')] });
  const { problems } = checkCapacity(project);
  const tableProblem = problems.find((p) => /lookup tables need/.test(p.message));
  assert.ok(
    tableProblem,
    'RPG + streamed + camera + live Move + live Save is not a REQUIRED B1 target and is expected to still be refused -- if this now passes, the refusal has been lifted and this test (and its honest-refusal framing) should be replaced with a real driven test, the same upgrade case 5 itself just received'
  );
});

// case 6 -- moved to handoff-next/s9-fix1-evidence/sabotage-harness.mjs (a mutant test; A2).

// case 7 -------------------------------------------------------------------------------------
// The plan's own case 7 (finding 7 -- no commit before acknowledgement): the overlay's own final
// close-attribute packet stays genuinely pending (undrained) for exactly one real frame, the
// identical natural, unforced delay test/unit/streamworldclosemove.test.js's own case 6 uses
// (main_loop_ready sets vram_ready=1 as the last store of the pass that queues the final packet;
// only the FOLLOWING nes.frame() call's own leading NMI drains it) -- no poke, no artificial
// delay. Assert save_media_commit has not run, and the flash record is still blank, on that exact
// frame. Then the plan's own named wrong implementation: a commit fired as soon as box_close/the
// deferred request is set, ignoring drain acknowledgement (dropping sw_dlg20_pending_tick's own
// sw_dlg15_state gate) -- proven to fail this same assertion by a real mutant run, moved out to
// handoff-next/s9-fix1-evidence/sabotage-harness.mjs per Chris's ruling (fix round 1, A2).
test('positive (case 7): the final close-attribute packet stays genuinely undrained for one real frame, and the commit has not run while it is', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const screen = project.maps[project.maps.length - 1].screens[0];
  const slot = interactOn(screen, project, { x: 200, y: 40, commands: [say('Hi.'), saveCmd()] });
  const { nes, mem } = await buildAndBoot(project);
  assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'reach the NPC');
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  pressOnce(nes, B); // dismiss -- arms the deferred Save

  const framesToDraining = driveUntil(nes, mem, (m) => m[SW_DLG15_STATE] === SW_DLG15_DRAINING, 60);
  assert.ok(framesToDraining < 60, 'sanity: must actually reach the draining wait');
  assert.notEqual(mem[VRAM_READY], 0, 'the final close-attribute packet must still be genuinely pending (undrained) on the exact frame the draining wait begins');
  assert.equal(mem[SW_DLG20_SAVE_PENDING], 1, 'the deferred Save must still be pending while draining');
  assert.equal(sectorMarker(nes), 0xff, 'the commit must NOT have run yet -- the drain has not been acknowledged');

  driveUntil(nes, mem, (m) => sectorMarker(nes) === SAVE_MARKER_VALID, 60);
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the commit must eventually fire once the drain is genuinely acknowledged');
});

// sabotage case 7 -- moved to handoff-next/s9-fix1-evidence/sabotage-harness.mjs (a mutant test;
// A2). Fix 1 retired ui_tick_save_check outright (the old two-poll design); the equivalent mutant
// there now drops sw_dlg20_pending_tick's own sw_dlg15_state gate in engine/streamworld.asm.

// case 7 (extended delay) -----------------------------------------------------------------------
// Round 2 finding A2: the positive case 7 test above only observes the instant DRAINING begins,
// then waits for the marker -- it never actually holds the drain across multiple real frames, never
// checks that a PREVIOUS valid record survives byte-for-byte while a SECOND Save's own drain is
// held, and never independently counts save_media_commit's own entries against the held span
// ("acknowledgement at commit entry specifically"). Extends case 7 with
// test/unit/streamworldclosemove.test.js's own "extended delay" technique (round 2, finding A1) --
// a PC-hook on vram_drain's own entry point, answered with the exact RTS this vendored core's own
// opcode 42 (pop the return address off the stack) performs, skipping its body entirely so
// vram_ready/vram_len stay completely untouched -- for several real frames, no poked flag anywhere,
// before letting the real consumer run again.
test('case 7 (extended delay): a PREVIOUS valid flash record persists byte-for-byte across a real, multi-frame delayed drain of a SECOND Save, and save_media_commit is entered exactly once, only on release', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const screen = project.maps[project.maps.length - 1].screens[0];
  const firstSlot = interactOn(screen, project, { x: 200, y: 40, commands: [saveCmd()], actorName: 'Saver1' });
  const secondSlot = interactOn(screen, project, { x: 40, y: 160, commands: [say('Hi.'), saveCmd()], actorName: 'Saver2' });
  const { nes, mem, addrOf } = await buildAndBoot(project);

  // Establish the PREVIOUS valid record: an ordinary, immediate, no-box Save.
  assert.ok(walkToward(nes, mem, mem[ENT_X + firstSlot], mem[ENT_Y + firstSlot]), 'reach the first saver');
  pressOnce(nes, B);
  waitForResync(nes, mem);
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the first Save must actually commit');
  const previousRecord = Array.from(nes.rom.rom[SAVE_BANK].slice(SECTOR_OFFSET, SECTOR_OFFSET + SAVE_RECORD_LEN));

  // Arm the SECOND, deferred Save (a different screen position -- a genuinely different record).
  assert.ok(walkToward(nes, mem, mem[ENT_X + secondSlot], mem[ENT_Y + secondSlot]), 'reach the second saver');
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  pressOnce(nes, B); // dismiss -- arms the deferred Save
  assert.equal(mem[SW_DLG20_SAVE_PENDING], 1, 'sanity: the arm frame must set sw_dlg20_save_pending');

  const framesToDraining = driveUntil(nes, mem, (m) => m[SW_DLG15_STATE] === SW_DLG15_DRAINING, 60);
  assert.ok(framesToDraining < 60, 'sanity: must actually reach the draining wait');
  assert.notEqual(mem[VRAM_READY], 0, 'sanity: the final close-attribute packet must genuinely still be outstanding the instant draining begins');

  const commitAddr = addrOf('save_media_commit');
  const commitEntries = countPcEntries(nes, commitAddr); // wraps nes.cpu.emulate once
  const vramDrainAddr = addrOf('vram_drain');
  const DELAY_CALLS = 5;
  let delayCallsRemaining = DELAY_CALLS;
  const wrappedEmulate = nes.cpu.emulate.bind(nes.cpu); // commitEntries' own wrapper, composed on top of
  nes.cpu.emulate = () => {
    if (delayCallsRemaining > 0 && (nes.cpu.REG_PC + 1) === vramDrainAddr) {
      delayCallsRemaining--;
      nes.cpu.REG_PC = nes.cpu.pull();
      nes.cpu.REG_PC += nes.cpu.pull() << 8;
      return;
    }
    return wrappedEmulate();
  };
  try {
    for (let i = 0; i < DELAY_CALLS; i++) {
      nes.frame();
      assert.notEqual(mem[VRAM_READY], 0, `held frame ${i}: with the real consumer's own acknowledgement delayed, the final packet must still read outstanding`);
      assert.notEqual(mem[VRAM_LEN], 0, `held frame ${i}: the final packet's own queued length must still read nonzero`);
      assert.equal(mem[SW_DLG15_STATE], SW_DLG15_DRAINING, `held frame ${i}: DRAINING must hold for as long as the real outstanding work is never acknowledged`);
      assert.equal(mem[SW_DLG20_SAVE_PENDING], 1, `held frame ${i}: the deferred Save must still be pending while draining`);
      assert.equal(commitEntries.count, 0, `held frame ${i}: save_media_commit must not have been entered at all -- acknowledgement (and so the commit) has not happened yet`);
      const currentRecord = Array.from(nes.rom.rom[SAVE_BANK].slice(SECTOR_OFFSET, SECTOR_OFFSET + SAVE_RECORD_LEN));
      assert.deepEqual(currentRecord, previousRecord, `held frame ${i}: the PREVIOUS valid flash record must persist byte-for-byte while the second Save's own drain is genuinely held`);
    }
  } finally {
    nes.cpu.emulate = wrappedEmulate; // restore to commitEntries' own wrapper -- countPcEntries.stop() below fully restores the true original
  }

  // Once the real consumer is let run again, capture the SECOND Save's own commit at the exact
  // $2001 re-enable instant -- the same proven technique captureReEnableContent already uses for
  // the discharge shapes above, rather than a secondary predicate-based poll that could race the
  // commit's own multi-step tail (compose -> invalidate -> body -> checksum -> marker).
  const snapshot = driveToReEnable(nes, mem, (value) => {
    const expectedRecord = SAVE_FIELDS.flatMap((f) => Array.from(mem.slice(SAVE_FIELD_ADDR[f.ram], SAVE_FIELD_ADDR[f.ram] + f.size)));
    const flashBody = Array.from(nes.rom.rom[SAVE_BANK].slice(SECTOR_OFFSET, SECTOR_OFFSET + expectedRecord.length));
    return { value, recordMatches: flashBody.length === expectedRecord.length && flashBody.every((v, idx) => v === expectedRecord[idx]) };
  }, 60);
  commitEntries.stop();
  assert.equal(commitEntries.count, 1, 'save_media_commit must be entered EXACTLY once, precisely once the drain is genuinely acknowledged -- not before, not more than once');
  assert.equal(snapshot.value, 0x1e, 'the re-enable write must be the real PPUMASK_ON value');
  // The SECOND Save's own record, independently computed from live RAM the same way
  // captureReEnableContent does (never read back from the routine under test), must now be what is
  // actually on flash at the exact re-enable instant -- proof the release genuinely committed the
  // real, current state, not merely that SOME commit happened.
  assert.ok(snapshot.recordMatches, 'the SECOND Save\'s own record on flash must match live RAM exactly, already at the exact re-enable instant');
});

// case 8 -------------------------------------------------------------------------------------
// The plan's own case 8 (finding 7 -- no movement/event dispatch on the completion frame): hold a
// direction already pressed through the exact frame the deferred commit resolves, and assert
// zero player displacement and no new event dispatch on that frame. The plan's own named wrong
// implementation: "script_resume's own continuation immediately processes input in the same
// frame" -- simulated directly by making the completion hook itself also run update_player before
// tail-calling script_resume, the same frame the commit fires.
test('positive (case 8): holding a direction through the exact completion pass produces zero displacement and no new event dispatch during that pass', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  // fix round 1c: this test used to hold RIGHT and assert PLAYER_X unchanged frame-by-frame only
  // through the nes.frame() call where sw_dlg20_save_pending flips 1 -> 0, then stopped (the loop's
  // own `completionFrame < 0` condition exits the instant that flip is observed). That flip is
  // sw_dlg20_save_check's own FIRST store, before save_media_commit/script_resume ever run -- and
  // save_media_commit's own flash write plus sw_save_resync's full-window redraw is one continuous,
  // non-interruptible run of CPU cycles that spans roughly 35 more nes.frame() calls before it
  // finally returns (see waitForResync's own header) -- all still the SAME main_loop pass, since
  // main_loop does not loop back to its own top until that whole chain unwinds. So the old loop
  // stopped checking exactly where it needed to keep checking, and never observed the frames where a
  // sabotaged completion hook's own extra work would actually run. Confirmed directly (handoff-next/
  // s9-fix1c-evidence/case8-diag.mjs, case8-newtest-proto.mjs): under the case 8 mutant (a completion
  // hook that also runs update_player before tail-calling script_resume), sw_dlg20_save_pending
  // clears on pass N's own first instructions, but update_player/script_resume do not actually
  // execute until ~34 nes.frame() calls later, still within that same pass -- long after the old
  // loop had already exited.
  //
  // This version hooks main_loop's own entry (the same technique the PC-hook test above uses) to
  // find the true pass boundary regardless of how many nes.frame() calls the completion pass spans,
  // and asserts against `dispatch_input`/`update_player` entry counts directly rather than inferring
  // "no movement happened" from a value that a gate elsewhere (event freeze, axis arbitration) could
  // coincidentally leave unchanged for an unrelated reason.
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const screen = project.maps[project.maps.length - 1].screens[0];
  const slot = interactOn(screen, project, { x: 200, y: 40, commands: [say('Hi.'), saveCmd()] });
  const { nes, mem, addrOf } = await buildAndBoot(project);
  assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'reach the NPC');
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  pressOnce(nes, B); // dismiss -- arms the deferred Save
  assert.equal(mem[SW_DLG20_SAVE_PENDING], 1, 'sanity: the arm frame must set sw_dlg20_save_pending');

  const mainLoopAddr = addrOf('main_loop');
  const dispatchInputAddr = addrOf('dispatch_input');
  const updatePlayerAddr = addrOf('update_player');

  // Hold RIGHT continuously from the arm frame through and past the completion pass.
  nes.buttonDown(1, RIGHT);
  const xAtArm = mem[PLAYER_X];

  const passes = [];
  let passCount = 0;
  let cur = null;
  const origEmulate = nes.cpu.emulate.bind(nes.cpu);
  nes.cpu.emulate = () => {
    const pc = nes.cpu.REG_PC + 1;
    if (pc === mainLoopAddr) {
      passCount++;
      cur = { pass: passCount, xAtTop: mem[PLAYER_X], pendingAtTop: mem[SW_DLG20_SAVE_PENDING], dispatchCount: 0, updateCount: 0 };
      passes.push(cur);
    } else if (pc === dispatchInputAddr && cur) {
      cur.dispatchCount++;
    } else if (pc === updatePlayerAddr && cur) {
      cur.updateCount++;
    }
    return origEmulate();
  };
  let frames;
  try {
    frames = driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 90);
  } finally {
    nes.cpu.emulate = origEmulate;
  }
  nes.buttonUp(1, RIGHT);
  assert.ok(frames < 90, 'sanity: the event must actually finish (game_state back at ST_GAMEPLAY) within budget');

  // The completion pass is the LAST main_loop pass whose own top still read sw_dlg20_save_pending
  // == 1 -- the pass that carries sw_dlg20_pending_tick's own nonzero return, hence the whole
  // save_media_commit/script_resume/close_ui chain, through to completion, however many nes.frame()
  // calls that takes before main_loop next reaches its own top.
  const pendingPasses = passes.filter((p) => p.pendingAtTop === 1);
  assert.ok(pendingPasses.length > 0, 'sanity: at least one tracked pass must observe sw_dlg20_save_pending == 1 at its own top');
  const completionPass = pendingPasses[pendingPasses.length - 1];
  const nextPass = passes.find((p) => p.pass === completionPass.pass + 1);
  assert.ok(nextPass, 'sanity: there must be a tracked main_loop pass immediately after the completion pass');

  assert.equal(completionPass.dispatchCount, 0, 'dispatch_input must not be entered even once during the completion pass, however long it runs');
  assert.equal(completionPass.updateCount, 0, 'update_player must not be entered even once during the completion pass, however long it runs');
  assert.equal(nextPass.xAtTop, xAtArm, 'player_x at the top of the pass immediately after the completion pass must still equal its arm-time value -- zero displacement occurred during the whole completion pass despite RIGHT being held throughout');

  // Only once the event has genuinely ended (game_state back at ST_GAMEPLAY, already true here)
  // does input resume: release-then-repress RIGHT and confirm the player now actually moves.
  nes.buttonDown(1, RIGHT);
  nes.frame();
  nes.buttonUp(1, RIGHT);
  assert.notEqual(mem[PLAYER_X], xAtArm, 'ordinary input handling must actually resume once the event is over');
});

// sabotage case 8 -- moved to handoff-next/s9-fix1-evidence/sabotage-harness.mjs (a mutant test;
// A2).

// =================================================================================================
// A1 regression (fix round 1): the pending/draining window (from the arm frame through the
// completion frame) must own every main_loop pass ahead of dispatch_input -- dispatch_input must
// not run AT ALL in that window, so a real Confirm (B) or Pause (Start) press held or spammed
// throughout it can neither reach do_action_dialog (which would otherwise advance/close a box that
// is not actually open to the player, or open a stray new one) nor do_action_pause (which would
// otherwise set `paused`, freezing a world the deferred commit still needs main_loop to keep
// driving). The discharge sequence itself (assertDeferredSaveSequence, above) already proves the
// happy path commits correctly with no input at all; these tests are the two real buttons the
// bug (a real controller press reaching do_action_dialog/do_action_pause while a Save is pending)
// was named for, spammed every single frame of the window rather than pressed once.
// =================================================================================================

const PAUSED = 0x26; // engine/constants.asm:52

test('A1 regression: spamming Confirm (B) throughout the pending/draining window does not disturb or duplicate the deferred Save, resumes into a following command exactly once -- and every SAVE_FIELDS byte plus the complete pending RAM record stay frozen at every main_loop entry through commit entry (A-blocking 1)', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const screen = project.maps[project.maps.length - 1].screens[0];
  const slot = interactOn(screen, project, { x: 200, y: 40, commands: [say('Hi.'), saveCmd(), say('After.')] });
  const { nes, mem, addrOf } = await buildAndBoot(project);
  const commitEntries = countPcEntries(nes, addrOf('save_media_commit'));

  walkToNonzeroCamera(nes, mem);
  assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'the player must actually reach the NPC');
  const camXAtOpen = mem[CAM_X_LO];
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  const yAtArm = mem[PLAYER_Y];
  const armCapture = captureArmSnapshot(nes, mem);
  pressOnce(nes, B); // dismiss -- arms the deferred Save
  armCapture.stop();
  assert.equal(mem[SW_DLG20_SAVE_PENDING], 1, 'sanity: the arm frame must set sw_dlg20_save_pending');
  assert.ok(armCapture.snapshot, 'sanity: the arm-boundary snapshot must actually have been captured on the dismiss press');
  const armSnapshot = armCapture.snapshot;
  // Round 4, A-blocking 1: replaces the old between-frames sampling this loop used to do with a PC
  // hook checked at every real main_loop entry through save_media_commit's own entry.
  const freezeWatch = installFreezeWatch(nes, mem, addrOf('main_loop'), addrOf('save_media_commit'), armSnapshot, 'B spam');
  // Only the resumed "After." page's own Say may enter script_op_say from here on -- the opening
  // "Hi." page already did, before this counter existed.
  const sayEntries = countPcEntries(nes, addrOf('script_op_say'));

  // Spam B on every single frame of the window instead of letting it drain untouched -- if
  // dispatch_input ran even once in this window, a stray B press would reach do_action_dialog,
  // which (with no live box actually open to advance/close) would be free to do whatever an
  // unexpected confirm does in this state.
  let heldFrames = 0;
  while (mem[SW_DLG20_SAVE_PENDING] === 1 && heldFrames < 60) {
    assert.equal(mem[PLAYER_Y], yAtArm, `held frame ${heldFrames}: the player must not move while B is spammed through the window`);
    assert.equal(sectorMarker(nes), 0xff, `held frame ${heldFrames}: must not have committed early under B spam`);
    pressOnce(nes, B);
    heldFrames++;
  }
  assert.ok(heldFrames < 60, 'the draw-down must actually finish within budget even under B spam');

  const commitFrames = driveUntil(nes, mem, () => sectorMarker(nes) === SAVE_MARKER_VALID, 80);
  assert.ok(commitFrames < 80, 'the commit must actually resolve within budget');
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the commit must still fire normally despite the B spam throughout the window');
  assert.equal(mem[CAM_X_LO], camXAtOpen, 'the camera origin must be unaffected by the B spam');
  assertRecordMatchesArm(nes, armSnapshot, 'B spam: at commit');
  assert.equal(commitEntries.count, 1, 'save_media_commit must be entered exactly once, at instruction granularity, over the whole transaction despite the B spam');
  assert.ok(freezeWatch.mainLoopChecks > 0, 'A-blocking 1: at least one main_loop entry must have been observed and checked while armed');
  assert.equal(freezeWatch.commitChecks, 1, 'A-blocking 1: save_media_commit entry must be checked exactly once, at the boundary where pending has already cleared');

  // The following "After." page must still run once the box reopens for it, counted by PC hook --
  // "the box reopened" alone is not a count (round 3's own explicit requirement).
  const reopenFrames = driveUntil(nes, mem, (m) => m[BOX_STATE] !== BOX_CLOSED, 60);
  assert.ok(reopenFrames < 60, 'the page after Save must still open -- script_resume must have continued the event after the Save, despite the B spam');
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(sayEntries.count, 1, 'script_op_say must be entered exactly once for the resumed "After." page (B spam)');
  pressOnce(nes, B); // dismiss the continuation -- nothing follows it
  const finalCloseFrames = driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 60);
  assert.ok(finalCloseFrames < 60, 'the whole event must finish and return to ST_GAMEPLAY');

  commitEntries.stop();
  freezeWatch.stop();
  sayEntries.stop();
  assert.equal(commitEntries.count, 1, 'no spurious second commit anywhere in the continuation');

  for (let i = 0; i < 20; i++) nes.frame();
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'no spurious second commit from any B press queued past completion');
});

// Round 2 finding A1: the default Controller Forge binding for dialog's own Start is 'none'
// (shared/project.js's defaultInput()), so a test using the DEFAULT binding cannot exercise
// do_action_pause at all -- 'none' no-ops in do_action regardless of whether dispatch_input ever
// runs. Every A1 test below therefore explicitly rebinds dialog.START to 'pause' first (an
// ordinary Controller Forge choice, not an engine assumption) so "Start must never fire" is a real
// claim about the gate, not a tautology about an inert binding.
const A = 0; // Controller.BUTTON_A -- needed here (unlike the rest of this file) to prove the
             // fix holds regardless of which dialog button (A or B, both 'confirm' by default)
             // is the one that arms the deferred Save.

test('A1 regression: holding Pause (Start), genuinely bound to pause in dialog, throughout the pending/draining window neither sets `paused` nor disturbs the deferred Save, and resumes into a following command exactly once -- and every SAVE_FIELDS byte plus the complete pending RAM record stay frozen at every main_loop entry through commit entry (A-blocking 1)', { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
  const project = createStreamedProject({ gameType: 'action' });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.input.states.dialog.START = 'pause';
  const screen = project.maps[project.maps.length - 1].screens[0];
  const slot = interactOn(screen, project, { x: 200, y: 40, commands: [say('Hi.'), saveCmd(), say('After.')] });
  const { nes, mem, addrOf } = await buildAndBoot(project);
  // Instruction-granularity proof, not merely "paused reads 0" -- countPcEntries (fix round 1b's
  // own helper) counts real entries into do_action_pause over the WHOLE transaction, so a leak
  // that happened to toggle `paused` back off before this test ever reads it would still be caught.
  const pauseEntries = countPcEntries(nes, addrOf('do_action_pause'));
  const commitEntries = countPcEntries(nes, addrOf('save_media_commit'));

  walkToNonzeroCamera(nes, mem);
  assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'the player must actually reach the NPC');
  const camXAtOpen = mem[CAM_X_LO];
  pressOnce(nes, B);
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  const yAtArm = mem[PLAYER_Y];
  const armCapture = captureArmSnapshot(nes, mem);
  pressOnce(nes, B); // dismiss -- arms the deferred Save
  armCapture.stop();
  assert.equal(mem[SW_DLG20_SAVE_PENDING], 1, 'sanity: the arm frame must set sw_dlg20_save_pending');
  assert.equal(mem[PAUSED], 0, 'sanity: must not already be paused going into the window');
  assert.equal(pauseEntries.count, 0, 'sanity: do_action_pause must not have run even once yet');
  assert.ok(armCapture.snapshot, 'sanity: the arm-boundary snapshot must actually have been captured on the dismiss press');
  const armSnapshot = armCapture.snapshot;
  // Round 4, A-blocking 1: replaces the old between-frames sampling this loop used to do with a PC
  // hook checked at every real main_loop entry through save_media_commit's own entry.
  const freezeWatch = installFreezeWatch(nes, mem, addrOf('main_loop'), addrOf('save_media_commit'), armSnapshot, 'Start held');
  // Only the resumed "After." page's own Say may enter script_op_say from here on.
  const sayEntries = countPcEntries(nes, addrOf('script_op_say'));

  // Hold Start continuously through the whole window -- if dispatch_input ran even once, this
  // would reach do_action_pause and set `paused`, freezing the very world main_loop still needs to
  // keep driving to finish the commit.
  nes.buttonDown(1, START);
  let heldFrames = 0;
  while (mem[SW_DLG20_SAVE_PENDING] === 1 && heldFrames < 60) {
    assert.equal(mem[PAUSED], 0, `held frame ${heldFrames}: paused must stay 0 while Start is held through the window`);
    assert.equal(mem[PLAYER_Y], yAtArm, `held frame ${heldFrames}: the player must not move while Start is held through the window`);
    assert.equal(sectorMarker(nes), 0xff, `held frame ${heldFrames}: must not have committed early under held Start`);
    nes.frame();
    heldFrames++;
  }
  assert.ok(heldFrames < 60, 'the draw-down must actually finish within budget even with Start held');

  const commitFrames = driveUntil(nes, mem, () => sectorMarker(nes) === SAVE_MARKER_VALID, 80);
  assert.ok(commitFrames < 80, 'the commit must actually resolve within budget');
  nes.buttonUp(1, START);
  assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the commit must still fire normally despite Start being held throughout the window');
  assert.equal(mem[CAM_X_LO], camXAtOpen, 'the camera origin must be unaffected by the held Start');
  assert.equal(mem[PAUSED], 0, 'paused must still read 0 -- Start, now genuinely bound to pause, never reached do_action_pause');
  assertRecordMatchesArm(nes, armSnapshot, 'Start held: at commit');
  assert.equal(pauseEntries.count, 0, 'do_action_pause must never have been entered once, at instruction granularity, over the transaction so far');
  assert.equal(commitEntries.count, 1, 'save_media_commit must be entered exactly once, at instruction granularity, over the whole transaction despite Start being held');
  assert.ok(freezeWatch.mainLoopChecks > 0, 'A-blocking 1: at least one main_loop entry must have been observed and checked while armed');
  assert.equal(freezeWatch.commitChecks, 1, 'A-blocking 1: save_media_commit entry must be checked exactly once, at the boundary where pending has already cleared');

  // The following "After." page must still run once the box reopens for it, counted by PC hook.
  const reopenFrames = driveUntil(nes, mem, (m) => m[BOX_STATE] !== BOX_CLOSED, 60);
  assert.ok(reopenFrames < 60, 'the page after Save must still open -- script_resume must have continued the event after the Save, despite Start being held');
  driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
  assert.equal(sayEntries.count, 1, 'script_op_say must be entered exactly once for the resumed "After." page (Start held)');
  pressOnce(nes, B); // dismiss the continuation -- nothing follows it
  const finalCloseFrames = driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 60);
  assert.ok(finalCloseFrames < 60, 'the whole event must finish and return to ST_GAMEPLAY');

  pauseEntries.stop();
  commitEntries.stop();
  freezeWatch.stop();
  sayEntries.stop();
  assert.equal(pauseEntries.count, 0, 'do_action_pause must never have been entered once over the whole transaction (Start held)');
  assert.equal(commitEntries.count, 1, 'no spurious second commit anywhere in the continuation');
});

// The residual gap round 2 actually found: not the held-through-the-window case above (already
// covered by round 1's own main_loop_save_gate), but Start pressed on the EXACT SAME frame as the
// arming press itself -- dispatch_loop's own fixed per-frame button order (A, B, Select, Start:
// engine/input.asm's button_mask) means whichever of A/B dismisses the box and arms the deferred
// Save is always read before Start on that identical pass, so if this fix round's own
// dispatch_save_arm_gate were missing, Start's own turn in the SAME dispatch_loop pass would still
// see the box as not-yet-closed and walk on into do_action_pause. Both A+Start and B+Start
// exercise the identical mechanism (A and B are dispatch_loop indices 0/1, Start is index 3, both
// before it) -- tested as two cases for robustness against the arming button itself mattering.
for (const [label, armButton] of [['B', B], ['A', A]]) {
  test(`A1 regression: ${label}+Start pressed on the SAME frame as the arming press never lets Start reach do_action_pause -- and every SAVE_FIELDS byte plus the complete pending RAM record stay frozen at every main_loop entry through commit entry (A-blocking 1)`, { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
    const project = createStreamedProject({ gameType: 'action' });
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    project.input.states.dialog.START = 'pause';
    const screen = project.maps[project.maps.length - 1].screens[0];
    const slot = interactOn(screen, project, { x: 200, y: 40, commands: [say('Hi.'), saveCmd(), say('After.')] });
    const { nes, mem, addrOf } = await buildAndBoot(project);
    const pauseEntries = countPcEntries(nes, addrOf('do_action_pause'));
    const commitEntries = countPcEntries(nes, addrOf('save_media_commit'));

    walkToNonzeroCamera(nes, mem);
    assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'the player must actually reach the NPC');
    pressOnce(nes, B); // open
    driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
    assert.equal(mem[SW_DLG20_SAVE_PENDING], 0, 'sanity: not armed yet');

    const armCapture = captureArmSnapshot(nes, mem);
    nes.buttonDown(1, armButton);
    nes.buttonDown(1, START);
    nes.frame();
    nes.buttonUp(1, armButton);
    nes.buttonUp(1, START);
    armCapture.stop();

    assert.equal(mem[SW_DLG20_SAVE_PENDING], 1, 'sanity: the same frame must have both dismissed the box and armed the deferred Save');
    assert.equal(mem[PAUSED], 0, `${label}+Start on the arming frame must not leave paused set`);
    assert.equal(pauseEntries.count, 0, `${label}+Start on the arming frame must never let dispatch reach do_action_pause at all`);
    assert.ok(armCapture.snapshot, 'sanity: the arm-boundary snapshot must actually have been captured on the same, dual-button-press frame');
    const armSnapshot = armCapture.snapshot;
    // Round 4, A-blocking 1: replaces the old between-frames sampling this loop used to do with a PC
    // hook checked at every real main_loop entry through save_media_commit's own entry.
    const freezeWatch = installFreezeWatch(nes, mem, addrOf('main_loop'), addrOf('save_media_commit'), armSnapshot, `${label}+Start`);
    // From here on, only the resumed "After." page's own Say may enter script_op_say -- the
    // opening "Hi." page already did, before this counter existed.
    const sayEntries = countPcEntries(nes, addrOf('script_op_say'));

    let heldFrames = 0;
    while (mem[SW_DLG20_SAVE_PENDING] === 1 && heldFrames < 60) {
      assert.equal(mem[PAUSED], 0, `held frame ${heldFrames}: paused must stay 0`);
      nes.frame();
      heldFrames++;
    }
    assert.ok(heldFrames < 60, 'the draw-down must finish within budget');
    // Not waitForResync (which waits for ST_GAMEPLAY): this project has a page after Save, so
    // game_state stays ST_DIALOG through the commit and into the continuation -- the marker itself
    // is the only signal the commit has actually fired here (the same reason the RPG driven test,
    // above, does not use waitForResync either).
    const commitFrames = driveUntil(nes, mem, () => sectorMarker(nes) === SAVE_MARKER_VALID, 80);
    assert.ok(commitFrames < 80, 'the commit must actually resolve within budget');
    assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, `the commit must still fire despite ${label}+Start on the arming frame`);
    assert.equal(mem[PAUSED], 0, 'paused must still read 0 once the transaction has fully resolved');
    assert.equal(pauseEntries.count, 0, 'do_action_pause must never have been entered once, at instruction granularity, over the whole transaction through the commit');
    assert.equal(commitEntries.count, 1, 'save_media_commit must have been entered exactly once, at instruction granularity');
    assertRecordMatchesArm(nes, armSnapshot, `${label}+Start: at commit`);
    assert.ok(freezeWatch.mainLoopChecks > 0, 'A-blocking 1: at least one main_loop entry must have been observed and checked while armed');
    assert.equal(freezeWatch.commitChecks, 1, 'A-blocking 1: save_media_commit entry must be checked exactly once, at the boundary where pending has already cleared');

    // Continuation: the page after Save must still run once the box reopens for it, counted by PC
    // hook -- "the next Say opened" alone is not a count (round 3's own explicit requirement) -- and
    // the commit must not fire a second time from anywhere in that continuation either.
    const reopenFrames = driveUntil(nes, mem, (m) => m[BOX_STATE] !== BOX_CLOSED, 60);
    assert.ok(reopenFrames < 60, 'the page after Save must still open -- script_resume must have continued the event after the Save');
    driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
    assert.equal(mem[GAME_STATE], ST_DIALOG, 'the continuation must still read ST_DIALOG going into its own close');
    assert.equal(sayEntries.count, 1, `script_op_say must be entered exactly once for the resumed "After." page (${label}+Start)`);
    pressOnce(nes, B); // dismiss the continuation -- nothing follows it
    const finalCloseFrames = driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 60);
    assert.ok(finalCloseFrames < 60, 'the whole event must finish and return to ST_GAMEPLAY');

    pauseEntries.stop();
    commitEntries.stop();
    freezeWatch.stop();
    sayEntries.stop();
    assert.equal(pauseEntries.count, 0, `do_action_pause must never have been entered once over the whole transaction through the continuation (${label}+Start)`);
    assert.equal(commitEntries.count, 1, 'no second commit anywhere in the continuation');
  });
}

// Round 1's own main_loop_save_gate already runs ahead of dispatch_input on every pass AFTER the
// arming one -- this pins that down for each of A, B and Start (round 3's own explicit A-blocking
// 1 staging requirement, folded into this one test rather than duplicated per button), pressed on
// the single frame sw_dlg15_state first reads DRAINING and again on the single frame it first
// reads IDLE (immediately before the completion tick's own commit), rather than held for the whole
// window -- closing the residual doubt a single held-through test leaves about a one-frame press
// landing on exactly the wrong pass. A and B are watched against do_action_dialog (a stray press
// could otherwise advance/close a box that is not actually open to the player); Start is watched
// against do_action_pause (freezing the very world main_loop still needs to keep driving); both
// checks run for all three buttons, so a wrong gate on either handler is caught regardless of
// which button happens to be staged. Each stage also asserts the saved-field freeze (every
// SAVE_FIELDS byte and the complete pending RAM record still equal their arm-time values).
for (const [label, pressButton] of [['B', B], ['A', A], ['Start', START]]) {
  test(`A1 regression: ${label} pressed on the single DRAINING frame and the single IDLE-before-completion frame never reaches do_action_pause or do_action_dialog -- and every SAVE_FIELDS byte plus the complete pending RAM record stay frozen at every main_loop entry through commit entry (A-blocking 1)`, { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
    const project = createStreamedProject({ gameType: 'action' });
    project.project.titleMap = 0;
    project.project.titleScreen = 0;
    project.input.states.dialog.START = 'pause';
    const screen = project.maps[project.maps.length - 1].screens[0];
    const slot = interactOn(screen, project, { x: 200, y: 40, commands: [say('Hi.'), saveCmd(), say('After.')] });
    const { nes, mem, addrOf } = await buildAndBoot(project);
    const pauseEntries = countPcEntries(nes, addrOf('do_action_pause'));
    const commitEntries = countPcEntries(nes, addrOf('save_media_commit'));

    walkToNonzeroCamera(nes, mem);
    assert.ok(walkToward(nes, mem, mem[ENT_X + slot], mem[ENT_Y + slot]), 'the player must actually reach the NPC');
    pressOnce(nes, B);
    driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
    const armCapture = captureArmSnapshot(nes, mem);
    pressOnce(nes, B); // dismiss -- arms the deferred Save
    armCapture.stop();
    assert.equal(mem[SW_DLG20_SAVE_PENDING], 1, 'sanity: the arm frame must set sw_dlg20_save_pending');
    assert.ok(armCapture.snapshot, 'sanity: the arm-boundary snapshot must actually have been captured on the dismiss press');
    const armSnapshot = armCapture.snapshot;
    // Round 4, A-blocking 1: replaces the old immediately-before/-after checkpoint sampling with a
    // PC hook checked at every real main_loop entry through save_media_commit's own entry.
    const freezeWatch = installFreezeWatch(nes, mem, addrOf('main_loop'), addrOf('save_media_commit'), armSnapshot, label);
    // From here on: only the resumed "After." page's own Say may enter script_op_say (the opening
    // "Hi." page already did, before this counter existed), and do_action_dialog must not be
    // entered again until the continuation's own legitimate dismiss press, below.
    const sayEntries = countPcEntries(nes, addrOf('script_op_say'));
    const dialogEntries = countPcEntries(nes, addrOf('do_action_dialog'));

    const draining = driveUntil(nes, mem, (m) => m[SW_DLG15_STATE] === SW_DLG15_DRAINING, 60);
    assert.ok(draining < 60, 'sanity: the window must actually visit DRAINING within budget');
    pressOnce(nes, pressButton); // exactly one frame, exactly on the DRAINING pass
    assert.equal(pauseEntries.count, 0, `a ${label} press landing on the DRAINING frame must not reach do_action_pause`);
    assert.equal(dialogEntries.count, 0, `a ${label} press landing on the DRAINING frame must not reach do_action_dialog`);

    const idle = driveUntil(nes, mem, (m) => m[SW_DLG15_STATE] === SW_DLG15_IDLE, 60);
    assert.ok(idle < 60, 'sanity: DRAINING must resolve to IDLE within budget');
    assert.equal(mem[SW_DLG20_SAVE_PENDING], 1, 'sanity: still pending on the frame IDLE is first observed -- the commit fires on the NEXT pass');
    pressOnce(nes, pressButton); // exactly one frame, exactly on the IDLE-before-completion pass
    assert.equal(pauseEntries.count, 0, `a ${label} press landing on the IDLE-before-completion frame must not reach do_action_pause either`);
    assert.equal(dialogEntries.count, 0, `a ${label} press landing on the IDLE-before-completion frame must not reach do_action_dialog either`);
    dialogEntries.stop(); // from here on, dismissing the continuation legitimately reaches do_action_dialog

    // Not waitForResync (which waits for ST_GAMEPLAY): this project has a page after Save, so
    // game_state stays ST_DIALOG through the commit and into the continuation -- the marker itself
    // is the only signal the commit has actually fired here (the same reason the two tests above
    // that also carry a continuation do not use waitForResync either).
    const commitFrames = driveUntil(nes, mem, () => sectorMarker(nes) === SAVE_MARKER_VALID, 80);
    assert.ok(commitFrames < 80, 'the commit must actually resolve within budget');
    assert.equal(sectorMarker(nes), SAVE_MARKER_VALID, 'the commit must still fire normally');
    assert.equal(mem[PAUSED], 0, 'paused must read 0 -- neither one-frame press ever reached do_action_pause');
    assertRecordMatchesArm(nes, armSnapshot, `${label}: at commit`);
    // Not stopped here: commitEntries was created BEFORE sayEntries, so calling .stop() on it now
    // would restore nes.cpu.emulate to the wrapper chain as it stood at commitEntries' OWN
    // creation time -- silently discarding sayEntries' own (later-installed) wrapper along with
    // it. Every countPcEntries hook here is stopped in the same order it was created, at the very
    // end, so an earlier .stop() can never drop a later hook still in use.
    assert.equal(commitEntries.count, 1, `save_media_commit must be entered exactly once, at instruction granularity, despite the ${label} presses`);
    assert.ok(freezeWatch.mainLoopChecks > 0, 'A-blocking 1: at least one main_loop entry must have been observed and checked while armed');
    assert.equal(freezeWatch.commitChecks, 1, 'A-blocking 1: save_media_commit entry must be checked exactly once, at the boundary where pending has already cleared');

    // The continuation (the Say after Save) must still run once, counted by PC hook -- "the box
    // reopened" alone is not a count (round 3's own explicit requirement).
    const reopenFrames = driveUntil(nes, mem, (m) => m[BOX_STATE] !== BOX_CLOSED, 60);
    assert.ok(reopenFrames < 60, 'the page after Save must still open -- script_resume must have continued the event after the Save');
    driveUntil(nes, mem, (m) => m[BOX_STATE] === BOX_ENDWAIT, 60);
    assert.equal(sayEntries.count, 1, `script_op_say must be entered exactly once for the resumed "After." page (${label})`);
    pressOnce(nes, B); // dismiss the continuation -- nothing follows it
    const finalCloseFrames = driveUntil(nes, mem, (m) => m[GAME_STATE] === ST_GAMEPLAY, 60);
    assert.ok(finalCloseFrames < 60, 'the whole event must finish and return to ST_GAMEPLAY');

    pauseEntries.stop();
    commitEntries.stop();
    freezeWatch.stop();
    sayEntries.stop();
    assert.equal(pauseEntries.count, 0, `do_action_pause must never have been entered once over the whole transaction (${label})`);
    assert.equal(commitEntries.count, 1, 'no second commit anywhere in the continuation');
  });
}

// =================================================================================================
// A4 (fix round 1): full-ROM identity against 2563ef4 -- the last COMMITTED engine state, "phase 2
// slice 8: Close-for-Move," which predates slice 9 (Close-for-Save) entirely: slice 9 and this fix
// round's own A1/B1 edits are both still uncommitted working-tree changes on top of it (`git status
// --short engine/` at report time: boot.asm/constants.asm/save.asm/streamworld.asm/ui.asm, the
// identical five files `git diff --name-status 2563ef4 -- engine/` names, and no engine/*.asm file
// was added or removed either side). So this identity check is deliberately the stronger claim --
// not merely "this fix round's own edits are inert here," but "the whole of slice 9, Close-for-Save
// included, is inert here" -- for four project shapes that deliberately never reach any of it: an
// ordinary (non-streamed) map never
// executes sw_dlg20_save_dispatch/sw_dlg20_pending_tick/sw_save_commit_tail/main_loop_save_gate's
// own gated body at all (script_op_save's own map_is_streamed compare falls straight to the
// unmodified immediate-commit branch), and a streamed map with a live Say but no live Save command
// anywhere never turns SAVE_FLASH-gated code on in the first place. Each shape is built twice from
// the SAME project.json: once against this checkout's own engine/, once against a historical
// baseline built via project.code.overrides -- but the TWO ORDINARY shapes and the TWO STREAMED
// shapes do not use the same kind of baseline, and round 3's own review (finding A-blocking 3) is
// that an earlier version of this comment implied they did. The ordinary shapes override every
// engine/*.asm file with its exact 2563ef4 text (`git show 2563ef4:engine/<name>`, historicalEngine
// Overrides below) -- a genuine flat "this whole ROM equals 2563ef4" comparison. The streamed shapes
// override ONLY engine/streamworld.asm, with B1's own already-landed relocation reconstructed back
// onto 2563ef4's text (preB1StreamworldOnlyOverride below); every other engine file --
// boot.asm/constants.asm/entities.asm/oam.asm/save.asm/screens.asm/ui.asm/input.asm -- is left at
// its CURRENT text on both sides of that comparison, not reverted to 2563ef4. The full reasoning for
// why that narrower baseline is the correct one for a streamed shape, and exactly what it does and
// does not prove, is at "fix round 1c, item 2" just above the A4_SHAPES table below -- proving the
// fix round's own new bytes are truly conditional on the predicate that turns the new mechanism on,
// not merely absent from these particular assertions.
//
// generate.js itself is NOT overridden (only engine/*.asm) -- every generate.js change this fix
// round made is a JS-side `*_KERNEL_ALLOWANCE`/`*_KERNEL_HI_ALLOWANCE` constant consumed only by
// the kernel-lo/kernel-hi capacity ledger's own sum functions (checkCapacity's validation
// arithmetic), never emitted as a byte into config.inc or any other generated .inc -- confirmed by
// reading every call site of each renamed/added constant (main/build/generate.js:2486-2487,
// 3863-3870), not assumed. So the CURRENT generator's own config.inc/flag emission for these four
// shapes is identical to what 2563ef4's generator would have produced regardless of which engine
// sources are assembled against it, and the four PASSing tests below are the empirical proof of
// that claim, not merely an assumption riding on it.
// =================================================================================================

function gitShowEngineFileAt(rev, name) {
  // A stock file that did not exist yet at `rev` (engine/streamdialog.asm, phase 2 slice 10b) is
  // overridden by an empty stub: the ancestor's own streamworld.asm never includes it.
  const known = spawnSync('git', ['cat-file', '-e', `${rev}:engine/${name}`], { cwd: ROOT });
  if (known.status !== 0) return `; ${name} did not exist at ${rev}\n`;
  const result = spawnSync('git', ['show', `${rev}:engine/${name}`], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, `git show ${rev}:engine/${name} must succeed: ${result.stderr}`);
  return result.stdout;
}

function historicalEngineOverrides(rev) {
  return engineFileNames().map((name) => ({ name, text: gitShowEngineFileAt(rev, name) }));
}

// UPDATE (fix round 1b, B1): a flat historicalEngineOverrides('2563ef4') is no longer a valid
// baseline for a STREAMED shape. B1 (still uncommitted, on top of 2563ef4/HEAD) unconditionally
// relocated several routines from kernel-lo files into streamworld.asm's kernel-hi region; a flat
// revert of every engine file removes that relocation too, and a streamed project's ROM permanently
// differs in layout from 2563ef4 as a result -- confirmed via `git diff HEAD --stat -- engine/`:
// every engine file with any uncommitted change at all (boot.asm, constants.asm, entities.asm,
// oam.asm, save.asm, screens.asm, streamworld.asm, ui.asm) either IS part of B1's own relocation or
// (constants.asm/ui.asm's own comment-only diffs, save.asm's unconditional-for-streaming
// sw_save_commit_tail dispatch) is zero-cost or otherwise must survive on both sides of this
// specific comparison for a "streamed, Say without Save" shape (SAVE_FLASH and MOVE_ENABLED are
// both off, so every genuinely NEW slice-8/9 byte in streamworld.asm -- the only file whose text
// this fix round actually needs to strip -- is already zero-cost regardless). So the correct "2563
// ef4 + B1" baseline for a streamed shape overrides ONLY streamworld.asm (mergeReconstructEngineFile
// restores B1's own appended block onto the literal 2563ef4 text) and leaves every other engine
// file at current -- which, being either unchanged since 2563ef4 or B1-adjacent, already equals
// "2563ef4 + B1" for those files directly, with no override needed at all.
function preB1StreamworldOnlyOverride(rev) {
  return [{ name: 'streamworld.asm', text: mergeReconstructEngineFile(ROOT, rev, 'streamworld.asm') }];
}

async function buildRomBytes(project, { overrides = null } = {}) {
  if (overrides) project.code = { overrides, files: [] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-closesave-a4-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    return fs.readFileSync(built.romPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function createOrdinaryCameraProject({ gameType = 'action' } = {}) {
  const project = createProject('A4 Ordinary', gameType);
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  project.cartridge.mapper = 30; // UNROM 512 -- the only board this whole fix round touches
  project.cartridge.mirroring = 'fourscreen';
  project.cartridge.camera = true;
  const map = createMap(0, 'Ordinary');
  map.gridW = 1;
  map.gridH = 1;
  map.screens = [createScreen()];
  project.maps = [map];
  interactOn(map.screens[0], project, { x: 96, y: 96, commands: [say('Hi.'), saveCmd()] });
  return project;
}

function createStreamedNoSaveProject({ gameType = 'action' } = {}) {
  const project = createStreamedProject({ gameType });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  interactOn(project.maps[project.maps.length - 1].screens[0], project, { x: 200, y: 40, commands: [say('Hi.')] });
  return project;
}

// Phase 3a slice S1: createStreamedNoSaveProject places its Say on an actor ON the streamed map, and
// S1 (STREAM_PROJ_ENABLED, projectUsesStreamedActors) replaces draw_one_entity_show_sw with the
// per-actor projection for exactly such a project -- so the B1 placement and byte-total checks below
// (which are claims about B1's per-tile routine and its relocation) cannot be made on that shape.
// This shape is the same streamed no-Save project with the Say on an ordinary map's actor instead:
// text is still in use, B1 still applies (the project streams), and no actor is placed on a
// streamed screen, so the shipped per-tile routine assembles.
function createStreamedNoProjectionProject({ gameType = 'action' } = {}) {
  const project = createStreamedProject({ gameType, mixed: true });
  project.project.titleMap = 0;
  project.project.titleScreen = 0;
  const ordinary = project.maps.find((map) => map.streamed !== true);
  interactOn(ordinary.screens[0], project, { x: 200, y: 40, commands: [say('Hi.')] });
  return project;
}

// fix round 1c, item 2: a flat historicalEngineOverrides('2563ef4') is a true, unreconstructed
// "2563ef4" comparison (a plain `git show` per file, above) -- honest for the two ordinary shapes,
// which never touch B1's own relocated code at all. The two streamed shapes instead use
// preB1StreamworldOnlyOverride, which reconstructs "2563ef4 + B1's own block copied back onto it"
// (mergeReconstructEngineFile, above) -- B1 is unconditional within streaming (every streamed
// project, Save or not, pays for the four relocated routines), so a streamed shape has genuinely
// never been byte-identical to flat 2563ef4 since B1 landed, and claiming otherwise here would be
// circular (comparing against a reconstruction that already contains the very code being proven
// absent). Each shape below states which claim its own comparison actually proves.
// `claim.short` names the comparison for a test name (kept terse); `claim.full` states, in the
// assertion message a failure actually prints, exactly which files were reconstructed to a
// historical baseline and which were left at CURRENT -- round 3 finding A-blocking 3's own
// requirement that this test's own language never let a reader believe the streamed shapes are
// compared against a flat whole-engine 2563ef4 the way the ordinary shapes genuinely are.
const A4_SHAPES = [
  [
    'ordinary UNROM-512, camera+Say+Save, action',
    () => createOrdinaryCameraProject({ gameType: 'action' }),
    historicalEngineOverrides,
    { short: '2563ef4', full: "2563ef4 -- every engine/*.asm file reverted to its exact 2563ef4 text (a genuine flat whole-engine comparison; this shape never touches B1's relocated code)" },
  ],
  [
    'ordinary UNROM-512, camera+Say+Save, rpg',
    () => createOrdinaryCameraProject({ gameType: 'rpg' }),
    historicalEngineOverrides,
    { short: '2563ef4', full: "2563ef4 -- every engine/*.asm file reverted to its exact 2563ef4 text (a genuine flat whole-engine comparison; this shape never touches B1's relocated code)" },
  ],
  [
    'streamed, Say without Save, action',
    () => createStreamedNoSaveProject({ gameType: 'action' }),
    preB1StreamworldOnlyOverride,
    { short: "2563ef4's streamworld.asm + B1 (streamworld.asm reconstructed only)", full: "2563ef4's engine/streamworld.asm reconstructed with B1's own relocation applied (mergeReconstructEngineFile) -- NOT a flat whole-engine 2563ef4 comparison: boot.asm/constants.asm/entities.asm/oam.asm/save.asm/screens.asm/ui.asm/input.asm are all left at their CURRENT text on both sides" },
  ],
  [
    'streamed, Say without Save, rpg',
    () => createStreamedNoSaveProject({ gameType: 'rpg' }),
    preB1StreamworldOnlyOverride,
    { short: "2563ef4's streamworld.asm + B1 (streamworld.asm reconstructed only)", full: "2563ef4's engine/streamworld.asm reconstructed with B1's own relocation applied (mergeReconstructEngineFile) -- NOT a flat whole-engine 2563ef4 comparison: boot.asm/constants.asm/entities.asm/oam.asm/save.asm/screens.asm/ui.asm/input.asm are all left at their CURRENT text on both sides" },
  ],
];

for (const [label, buildProjectShape, overridesFor, claim] of A4_SHAPES) {
  test(`A4 identity: ${label} assembles byte-identical to ${claim.short}`, { skip: !hasNesasm && 'nesasm not found on PATH' }, async () => {
    const currentRom = await buildRomBytes(buildProjectShape());
    const historicalRom = await buildRomBytes(buildProjectShape(), { overrides: overridesFor('2563ef4') });
    assert.equal(currentRom.length, historicalRom.length, `${label}: ROM length must match ${claim.full} exactly`);
    assert.ok(currentRom.equals(historicalRom), `${label}: ROM bytes must be identical to ${claim.full} -- this project shape must never reach any of the fix round's own new/relocated code`);
  });
}

// =================================================================================================
// Placement-only check (fix round 1c, item 2). The fix-1b brief's own words: "for streamed + Say
// without Save (action and RPG): versus a flat 2563ef4 build ... each of the four moved routines'
// bytes in the current ROM equal their 2563ef4 bytes, except for the operands of absolute
// jsr/jmp/data references whose targets moved. Author this from the .fns spans of both builds, not
// by re-assembling the same text twice."
//
// Three of the four B1 routines (spawn_streamed, build_oam_draw_sw, draw_one_entity_show_sw) are
// PURE relocations -- moved verbatim from a kernel-lo file into streamworld.asm with no textual
// change beyond nesasm's own trampoline conversion at each old call site (a `bne`/`beq` that could
// reach the routine directly in kernel-lo can no longer reach it in kernel-hi, so the call site
// itself grew a `jmp`, but the ROUTINE BODY is untouched). The fourth, sw_redraw_screen_landing, is
// NOT a pure relocation -- it is a genuine consolidation of two previously separate, byte-identical
// inline copies (engine/screens.asm's redraw_screen and engine/boot.asm's own cold-boot copy of the
// same sequence) into one shared routine, so there is no single flat-2563ef4 "the routine at this
// address" to diff against; it is excluded from this byte-for-byte claim for that reason (Item 1's
// own writeup, handoff-next/progress-phase2-s9-fix1.md, covers its correctness with a dedicated
// dual-caller behavioral test instead of a placement diff).
//
// A relocated routine's own SIZE does not change, but its ADDRESS does -- so any absolute-mode
// instruction inside it (jsr/jmp to a target whose own address also shifted, or a 3-byte
// absolute/absolute,X/absolute,Y data reference into a table living inside the very same relocated
// block, e.g. build_oam_draw_sw's own sw_oam_corner_xoff/_yoff/_oam tables) legitimately differs in
// its 2-byte operand between the current and flat builds. Verified once by hand
// (handoff-next/s9-fix1c-evidence/placement-check-verify-operands.mjs) against the real
// disassembly: EVERY byte difference for all three routines, both game types, lands exactly on the
// 2-byte operand of a 3-byte absolute-addressing instruction whose OPCODE byte itself still
// matches -- never on an opcode byte, never on an odd/unpaired single byte, never inside a
// non-3-byte instruction. That is the general shape this test asserts mechanically: walk the
// current build's own bytes as a straight-line instruction stream (no self-modifying code, no data
// interleaved with code inside these three routines -- true for all three; build_oam_draw_sw's own
// three tables sit AFTER its own `rts`, in the trailing bytes this test still covers positionally
// but never decodes as instructions), and require every byte difference to fall inside the 2-byte
// operand of a 3-byte absolute-mode opcode.
function instrLenFor(opcode) {
  const IMPLIED_1 = new Set([0x00,0x08,0x0a,0x18,0x28,0x2a,0x38,0x40,0x48,0x4a,0x58,0x60,0x68,0x6a,0x78,0x88,0x8a,0x98,0x9a,0xa8,0xaa,0xb8,0xba,0xc8,0xca,0xd8,0xe8,0xea,0xf8,0x1a,0x3a,0x5a,0x7a,0xda,0xfa]);
  if (IMPLIED_1.has(opcode)) return 1;
  if ([0x10,0x30,0x50,0x70,0x90,0xb0,0xd0,0xf0].includes(opcode)) return 2; // relative branches
  const ABS3 = new Set([0x0c,0x0d,0x0e,0x0f,0x19,0x1b,0x1c,0x1d,0x1e,0x1f,0x20,0x2c,0x2d,0x2e,0x2f,0x39,0x3b,0x3c,0x3d,0x3e,0x3f,0x4c,0x4d,0x4e,0x4f,0x59,0x5b,0x5c,0x5d,0x5e,0x5f,0x6c,0x6d,0x6e,0x6f,0x79,0x7b,0x7c,0x7d,0x7e,0x7f,0x8c,0x8d,0x8e,0x8f,0x99,0x9b,0x9c,0x9d,0x9e,0x9f,0xac,0xad,0xae,0xaf,0xb9,0xbb,0xbc,0xbd,0xbe,0xbf,0xcc,0xcd,0xce,0xcf,0xd9,0xdb,0xdc,0xdd,0xde,0xdf,0xec,0xed,0xee,0xef,0xf9,0xfb,0xfc,0xfd,0xfe,0xff]);
  if (ABS3.has(opcode)) return 3;
  return 2; // immediate, zp, zp,x/y, (zp,x), (zp),y
}

async function buildRomAndSymbols(project, { overrides = null } = {}) {
  if (overrides) project.code = { overrides, files: [] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-closesave-placement-'));
  try {
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const bytes = new Uint8Array(fs.readFileSync(built.romPath));
    const nes = new NES({ onFrame: () => {}, emulateSound: false });
    nes.loadROM(bytes); // .mmap.load reads real PRG-ROM through the fixed kernel banks immediately
                         // after loadROM -- no frames need to run; these routines live in the
                         // FIXED kernel-lo/kernel-hi region, not a switchable window.
    const symbols = fs.readFileSync(built.symbolPath, 'utf8');
    const addrOf = (label) => {
      const m = symbols.match(new RegExp(`^${label}\\s+=\\s+\\$([0-9A-Fa-f]+)`, 'm'));
      return m ? parseInt(m[1], 16) : undefined;
    };
    // round 2 finding A4.1: the placement check must verify a changed absolute operand still
    // targets the SAME symbol (permitting only the address shift relocation itself explains), not
    // merely that the instruction is still a 3-byte absolute-mode opcode. This maps every address
    // nesasm names in this build to the set of names it has (more than one name can share an
    // address, e.g. an "_end" label immediately followed by the next routine's own start) so an
    // operand can be resolved back to "which symbol(s) does this address mean here".
    const namesAtAddress = new Map();
    for (const m of symbols.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\s+=\s+\$([0-9A-Fa-f]+)/gm)) {
      const addr = parseInt(m[2], 16);
      if (!namesAtAddress.has(addr)) namesAtAddress.set(addr, new Set());
      namesAtAddress.get(addr).add(m[1]);
    }
    return { nes, addrOf, namesAtAddress };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const B1_RELOCATED_ROUTINES = ['spawn_streamed', 'build_oam_draw_sw', 'draw_one_entity_show_sw'];

// build_oam_draw_sw is the only one of the three carrying trailing DATA after its own code (three
// one-byte-per-corner tables, sw_oam_corner_xoff/_yoff/_oam, referenced by name from the code
// above them but never executed as instructions themselves) -- round 2 finding A4.1's second half:
// the walk below must stop decoding as instructions at each routine's own code/data boundary and
// require the data region to match byte-for-byte (no relocation can explain a literal data byte
// differing; these tables' own CONTENTS never move even though their ADDRESS does).
const DATA_REGION_START = { build_oam_draw_sw: 'sw_oam_corner_xoff' };

for (const gameType of ['action', 'rpg']) {
  test(
    `B1 placement-only check (fix round 1c/2, item 2): ${gameType} -- each pure-relocation routine's code equals its 2563ef4 code (same symbolic targets, addresses may shift) and its data equals byte-for-byte`,
    { skip: !hasNesasm && 'nesasm not found on PATH' },
    async () => {
      const current = await buildRomAndSymbols(createStreamedNoProjectionProject({ gameType }));
      const flat = await buildRomAndSymbols(
        createStreamedNoProjectionProject({ gameType }),
        { overrides: historicalEngineOverrides('2563ef4') }
      );
      for (const name of B1_RELOCATED_ROUTINES) {
        const curAddr = current.addrOf(name);
        const endAddr = current.addrOf(`${name}_end`);
        assert.ok(curAddr !== undefined && endAddr !== undefined, `${name}/${name}_end must both be named symbols in the current build's game.fns`);
        const size = endAddr - curAddr;
        assert.ok(size > 0, `${name}_end must come after ${name}`);
        const flatAddr = flat.addrOf(name);
        assert.ok(flatAddr !== undefined, `${name} must still be a named symbol in the flat 2563ef4 build's game.fns (pre-relocation, still in its original kernel-lo file)`);

        const curBytes = new Uint8Array(size);
        const flatBytes = new Uint8Array(size);
        for (let i = 0; i < size; i++) {
          curBytes[i] = current.nes.mmap.load(curAddr + i) & 0xff;
          flatBytes[i] = flat.nes.mmap.load(flatAddr + i) & 0xff;
        }

        const dataLabel = DATA_REGION_START[name];
        const codeSize = dataLabel ? current.addrOf(dataLabel) - curAddr : size;
        assert.ok(codeSize > 0 && codeSize <= size, `${name}: ${dataLabel ?? '(no data region)'} must sit inside the routine's own span`);

        const unexplained = [];

        // Code region: decode as a straight-line instruction stream (no self-modifying code, no
        // data interleaved with code in this span -- both routines' own comments/EXPECTED_B1_LABELS
        // confirm this), requiring every changed byte to be the 2-byte address operand of a 3-byte
        // absolute-mode instruction whose opcode is unchanged AND whose operand still names the
        // same symbol in both builds (or, for an unlabelled literal address such as a hardware
        // register, the literal numeric address itself is unchanged).
        let off = 0;
        while (off < codeSize) {
          const opcode = curBytes[off];
          const len = instrLenFor(opcode);
          const curOpcodeMatches = curBytes[off] === flatBytes[off];
          if (len === 3 && curOpcodeMatches) {
            const curOperand = curBytes[off + 1] | (curBytes[off + 2] << 8);
            const flatOperand = flatBytes[off + 1] | (flatBytes[off + 2] << 8);
            const sameLiteral = curOperand === flatOperand;
            const curNames = current.namesAtAddress.get(curOperand);
            const flatNames = flat.namesAtAddress.get(flatOperand);
            const sameSymbol = curNames && flatNames && [...curNames].some((n) => flatNames.has(n));
            if (!sameLiteral && !sameSymbol) {
              unexplained.push({
                off, opcode: opcode.toString(16).padStart(2, '0'),
                reason: 'operand targets a different symbol',
                curOperand: curOperand.toString(16), curNames: curNames ? [...curNames] : [],
                flatOperand: flatOperand.toString(16), flatNames: flatNames ? [...flatNames] : []
              });
            }
          } else {
            const touchesDiff = [...Array(len).keys()].some((k) => curBytes[off + k] !== flatBytes[off + k]);
            if (touchesDiff) {
              unexplained.push({ off, opcode: opcode.toString(16).padStart(2, '0'), len, reason: curOpcodeMatches ? 'a non-3-byte instruction touches a byte difference' : 'opcode byte itself differs' });
            }
          }
          off += len;
        }

        // Data region (if any): raw bytes, never decoded as instructions, never permitted to
        // differ -- a table entry's own value has no address to shift.
        for (let i = codeSize; i < size; i++) {
          if (curBytes[i] !== flatBytes[i]) {
            unexplained.push({ off: i, reason: 'data byte differs (data has no address to shift under relocation)', cur: curBytes[i].toString(16), flat: flatBytes[i].toString(16) });
          }
        }

        assert.equal(
          unexplained.length,
          0,
          `${name} (${gameType}): every byte difference between the current and flat-2563ef4 build must be explained as either the address operand of an unchanged 3-byte absolute-mode instruction that still names the same symbol, or an address-only shift with no data-byte change -- found unexplained difference(s): ${JSON.stringify(unexplained)}`
        );
      }
    }
  );
}

// The fix-1b brief also claimed "the total kernel-lo + kernel-hi code bytes are equal" between the
// current and a flat-2563ef4 build. Real measurement (nesasm's own "BANK n used/free" lines, the
// same technique test/unit/kernelbytes.test.js's measureKernelLoBank/measureKernelHiBank use)
// contradicts that: B1 saves exactly 501 kernel-lo bytes (matching Item 4's own independently
// derived figure) but costs 474 kernel-hi bytes, for a net 27-byte REDUCTION -- not equality --
// reproduced identically on both game types (handoff-next/s9-fix1c-evidence/placement-check-
// banks.mjs). This is documented here as the corrected claim, the same way Item 4 corrected the
// round-1 baseline figure, rather than asserting the brief's literal (and false) "equal" wording.
function bankUsed(lines, bankNumber, label) {
  const bankLine = lines.find((line) => new RegExp(`^BANK\\s+${bankNumber}\\s`).test(line));
  assert.ok(bankLine, `${label}: nesasm's usage table never mentioned bank ${bankNumber}`);
  const used = Number(bankLine.match(/(\d+)\/\s*(\d+)\s*$/)?.[1]);
  assert.ok(Number.isFinite(used) && used > 0, `${label}: could not parse a used-byte count out of "${bankLine}"`);
  return used;
}

async function measureBankTotals(project, { overrides = null } = {}) {
  if (overrides) project.code = { overrides, files: [] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-closesave-banktotals-'));
  try {
    await saveProject(dir, project);
    const lines = [];
    await buildProject({ dir, project, log: (line) => lines.push(line) });
    const mapper = resolveMapper(project.cartridge.mapper);
    const { kernelLoBank, kernelHiBank } = prgLayout(mapper);
    return {
      lo: bankUsed(lines, kernelLoBank, 'kernel-lo'),
      hi: bankUsed(lines, kernelHiBank, 'kernel-hi'),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

for (const gameType of ['action', 'rpg']) {
  test(
    `B1 total kernel-lo+hi bytes (fix round 1c, item 2 correction): ${gameType} -- current vs flat 2563ef4 is a net 80-byte REDUCTION since S3a.5 (2 before), not equal (lo -476, hi +396, was +474; B1 alone is -501 / +474 / -27, S1's OAM_BUSY adds 18 and (a1)'s mover parity gate 7 to kernel-lo)`,
    { skip: !hasNesasm && 'nesasm not found on PATH' },
    async () => {
      const current = await measureBankTotals(createStreamedNoProjectionProject({ gameType }));
      const flat = await measureBankTotals(
        createStreamedNoProjectionProject({ gameType }),
        { overrides: historicalEngineOverrides('2563ef4') }
      );
      const loDelta = current.lo - flat.lo;
      const hiDelta = current.hi - flat.hi;
      const totalDelta = (current.lo + current.hi) - (flat.lo + flat.hi);
      console.log(`${gameType}: current lo=${current.lo} hi=${current.hi} total=${current.lo + current.hi}  flat lo=${flat.lo} hi=${flat.hi} total=${flat.lo + flat.hi}  lo_delta=${loDelta} hi_delta=${hiDelta} total_delta=${totalDelta}`);
      // Phase 3a slice S1: B1 alone saves 501 kernel-lo bytes (Item 4's independently derived
      // figure), and S1's OAM_BUSY flag (engine/boot.asm, gated on the project streaming at all)
      // adds its 18-byte kernel-lo allowance (OAM_BUSY_KERNEL_LO_ALLOWANCE, main/build/generate.js) to every streamed project, and (a1)'s mover parity gate its 7 (MOVER_PARITY_GATE_KERNEL_ALLOWANCE): -501 + 18 + 7 = -476. This shape places no actor on a
      // streamed screen (createStreamedNoProjectionProject), so the projection's own 3-byte
      // kernel-lo setup call is absent and the hi delta is B1's 474 exactly.
      assert.equal(loDelta, -501 + 18 + 7, `${gameType}: kernel-lo delta must be Item 4's -501 plus S1's 18-byte OAM_BUSY cost and (a1)'s 7-byte mover parity gate`);
      // Phase 3a S3a.5: this baseline is the flat 2563ef4 engine, which still has sw_camera_window_recompute's two
      // repeated-subtract loops; the current engine's closed forms are 78 bytes smaller (STREAMWORLD_WINDOW_KERNEL_HI_ALLOWANCE
      // 1102 -> 1024), so the kernel-hi delta is B1's 474 less that 78 = 396 and the total moves with it (-2 - 78 = -80).
      const S3A5_HI_SAVING = 78;
      assert.equal(hiDelta, 474 - S3A5_HI_SAVING, `${gameType}: kernel-hi delta must be the four B1 routines' own combined allowance cost (474) less S3a.5's 78-byte camera-window saving`);
      assert.equal(totalDelta, -27 + 18 + 7 - S3A5_HI_SAVING, `${gameType}: total kernel-lo+hi delta is a net 80-byte reduction (B1's -27 plus S1's 18 plus (a1)'s 7 less S3a.5's 78), NOT zero -- the fix-1b brief's "totals are equal" claim does not hold under real measurement`);
    }
  );
}
