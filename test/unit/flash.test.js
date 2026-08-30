// The Flash command: flashes the screen to a fixed white (FLASH_COLOR, $30)
// and back, a short engine-timed burst with no operand at all. See
// handoff-flash/design-flash.md for the full design (three-state
// flash_left, the FLASH_ARM_VALUE/FLASH_PENDING sentinel arithmetic, the
// shared PALETTE_FX_ENABLED gate, vram_reset's synchronous cancellation) --
// this file follows its §9 testing plan (tests 1-7, 9-11, 14; test 8 is the
// Mesen Lua check under test/lua/, and tests 12-13/15 are in
// test/unit/kernelbytes.test.js; tests 16-17 are in main/smoke.js).
//
// Unlike Fade, Flash does not suspend the script -- flash_tick ticks
// unconditionally from main_loop, before settle_owed/dispatch_input/
// ui_tick, so it keeps counting down whether the world is frozen or
// running. Everything builds its own project rather than touching
// `sample`/`sample-rpg`, which are checked-in fixtures.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { Emulator, BUTTON } from '../../renderer/emulator/runcontrol.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { compileText, opIndex } from '../../main/build/textcompile.js';
import { parseSymbolFile } from '../../main/build/symbols.js';
import { parseEquates } from '../../shared/enginesyms.js';
import { applyBattleTest } from '../../renderer/emulator/battletest.js';
import { createProject, normalizeProject, projectUsesFlash } from '../../shared/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
const hasRom = fs.existsSync(path.join(SAMPLE, 'build/game.nes'));

// Engine RAM, from engine/constants.asm.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const FLAT_SCREEN = 0x16;
const GAME_STATE = 0x25;
const WARP_READY = 0x2e;
const WARP_SCR = 0x2f;
const WARP_X = 0x30;
const WARP_Y = 0x31;
const VRAM_LEN = 0x3c;
const VRAM_BUF = 0x0400;
const SWITCHES = 0x390;
const VARIABLES = 0x500;

// flash_left is a computed expression in engine/constants.asm
// (`flash_left = fade_reload+1`), so nesasm's own .fns file resolves it (a
// real code label does), but shared/enginesyms.js's parseEquates (which
// only understands literal `name = $HH` equates) cannot -- the identical
// situation fade.test.js already documents for fade_step/fade_reload.
// Confirmed against a real build by injecting `.db flash_left, fade_step,
// fade_reload, shake_left` into a Code Forge user file and reading the
// emitted bytes back out of the booted ROM: flash_left = $A0 (fade_step =
// $9C and fade_reload = $9F matched fade.test.js's own hardcoded values
// exactly, confirming the technique).
const FLASH_LEFT = 0xa0;

// engine/constants.asm's own Flash constants.
const FLASH_COLOR = 0x30;
const FLASH_TOTAL_FRAMES = 6;
const FLASH_ARM_VALUE = FLASH_TOTAL_FRAMES + 1; // 7
const FLASH_PENDING = 0xff;

const ST_GAMEPLAY = 0;
const ST_DIALOG = 2;
const ST_TITLE = 3;
const A_BTN = 0;
const B = 1;
const START = 3;

const switchOn = (nes, n) => Boolean(nes.cpu.mem[SWITCHES + (n >> 3)] & (1 << (n & 7)));

function boot(romPath, frames = 30) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  for (let i = 0; i < frames; i++) nes.frame();
  if (nes.cpu.mem[GAME_STATE] === ST_TITLE) {
    nes.buttonDown(1, START);
    nes.frame();
    nes.buttonUp(1, START);
    for (let i = 0; i < 12; i++) nes.frame();
  }
  return nes;
}

const tap = (nes, button, frames = 2) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
};

const run = (nes, frames) => {
  for (let i = 0; i < frames; i++) nes.frame();
};

/** The 32 live palette bytes, in $3F00-$3F1F order, straight off the PPU. */
const readPalette = (nes) => Array.from({ length: 32 }, (_, i) => nes.ppu.vramMem[0x3f00 + i]);

/** project.palettes.bg then .sprite, flattened -- the same order palette_data is emitted in. */
const paletteBytes = (project) => [...project.palettes.bg.flat(), ...project.palettes.sprite.flat()];

/**
 * Counts real writes into palette RAM ($3F00-$3FFF) that occur while `fn`
 * runs, by temporarily wrapping the PPU core's own `writeMem` -- the single
 * place both an ordinary $2007 write and `mirroredWrite`'s own second,
 * mirrored write actually land in `vramMem` (confirmed against
 * renderer/emulator/core/ppu/index.js: `mirroredWrite` calls `writeMem`
 * directly for each side of a mirrored pair, and every $2007 handler routes
 * through `mirroredWrite` for an address in this range). Finding 6: pixel
 * equality alone cannot distinguish "nothing ran" from "something ran and
 * synchronously rewrote the identical bytes" -- an unconditional-restore
 * implementation (no `beq vram_reset_no_flash` at all) produces the exact
 * same final palette on an idle redraw, so only counting the underlying
 * writes tells the two apart.
 */
function countPaletteWrites(nes, fn) {
  const ppu = nes.ppu;
  const original = ppu.writeMem.bind(ppu);
  let count = 0;
  ppu.writeMem = (address, value) => {
    if (address >= 0x3f00 && address <= 0x3fff) count++;
    return original(address, value);
  };
  try {
    fn();
  } finally {
    ppu.writeMem = original;
  }
  return count;
}

/**
 * A one-screen project with one talkable actor carrying `commands`, on a
 * screen wiped to metatile 0 -- the identical shape fade.test.js's own
 * buildWith uses.
 */
async function buildWith(t, commands, tweak = () => {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-flash-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  const slime = project.sprites.actors[0];
  const npcId = project.sprites.actors.length;
  project.sprites.actors.push({ ...structuredClone(slime), id: npcId, name: 'Flasher', behavior: 'npc' });
  project.maps[0].screens[0].metatiles = new Array(240).fill(0);
  project.maps[0].screens[0].entities = [
    {
      actorId: npcId,
      x: 112,
      y: 96,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands }] } }
    }
  ];
  tweak(project);
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  return { project, dir, romPath: built.romPath, built, nes: boot(built.romPath) };
}

// --------------------------------------------------------------- the wire

test('a Flash compiles to its opcode alone, no operand', () => {
  const project = normalizeProject({
    ...createProject('Flash wire'),
    commonEvents: [
      {
        id: 0,
        name: 'Burst',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'flash' }, { op: 'setSwitch', switch: 3 }] }] }
      }
    ]
  });
  const { events } = compileText(project);
  const bytes = events.flat();
  const at = bytes.indexOf(opIndex('flash'));
  assert.ok(at >= 0, 'the compiled events should contain an OP_FLASH');
  // Exactly one byte: the very next byte is the following command's own
  // opcode, not an operand belonging to Flash.
  assert.equal(bytes[at + 1], opIndex('setSwitch'), 'OP_FLASH should be followed immediately by the next command, with no operand byte in between');
});

test('normalizeEventCommand carries no foreign fields for a Flash command', () => {
  const [command] = normalizeProject({
    ...createProject('Flash normalize'),
    commonEvents: [{ id: 0, name: 'E', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'flash', dir: 'out', frames: 30, state: 'shown' }] }] } }]
  }).commonEvents[0].event.pages[0].commands;
  assert.deepEqual(command, { op: 'flash' }, 'a Flash command must normalize to exactly { op: "flash" } -- no dir/frames/state leaked in from another verb\'s shape');
});

// ------------------------------------------------------------- the engine

// Test 1: the flash-on write. Step to the frame the following NMI applies
// FLASH_COLOR -- discovered empirically (the first frame vramMem changes),
// not assumed from a fixed schedule, the same "discover, don't assume"
// method fade.test.js's own test 2 established.
test('a Flash paints every one of the 32 live palette bytes to FLASH_COLOR', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes, project } = await buildWith(t, [{ op: 'flash' }, { op: 'setSwitch', switch: 5 }]);
  const original = paletteBytes(project);
  assert.deepEqual(readPalette(nes), original, 'the palette should start exactly as authored');

  // Zero extra frames after the tap: flash's own whole burst is short
  // enough (six frames) that tap()'s ordinary default of two extra frames
  // would already carry past the on-drain this loop means to catch.
  tap(nes, B, 0); // talk: the page runs, arms flash_left and falls straight through

  let onDrainFrame = -1;
  let prev = readPalette(nes);
  for (let f = 0; f < FLASH_ARM_VALUE + 5 && onDrainFrame < 0; f++) {
    nes.frame();
    const now = readPalette(nes);
    if (JSON.stringify(now) !== JSON.stringify(prev)) onDrainFrame = f;
    prev = now;
  }
  assert.ok(onDrainFrame >= 0, 'the flash-on packet never drained within the expected window');
  const painted = readPalette(nes);
  for (let i = 0; i < 32; i++) {
    assert.equal(painted[i], FLASH_COLOR, `byte ${i} should be FLASH_COLOR ($30), saw $${painted[i].toString(16)}`);
  }
  // The last byte pushed, not only the first -- catches a stray register
  // clobber between loading FLASH_COLOR once (outside the loop) and the
  // 32-iteration push loop.
  assert.equal(painted[31], FLASH_COLOR, 'the last of the 32 bytes must also be FLASH_COLOR');
});

// Test 3: non-suspension. Flash followed immediately by SetSwitch in the
// same page -- the switch must be on after the single frame that dispatches
// the interaction, not one frame later. Zero extra frames after the tap
// (the same anchor test 1's own note describes, and for the identical
// reason): tap(nes, B, 1)'s own extra frame gave a wrong script_op_flash
// that suspends for one tick and resumes on the next (arm, rts through the
// suspend path, resume next frame) room to catch up and still pass --
// checking immediately after the one frame that runs the interaction is
// what actually pins "the same dispatch," not "eventually."
test('Flash does not suspend the script -- the next command runs the same frame', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [{ op: 'flash' }, { op: 'setSwitch', switch: 5 }]);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY);
  tap(nes, B, 0); // exactly one frame() call -- see above
  assert.equal(switchOn(nes, 5), true, 'SetSwitch after Flash should have run on the same dispatch, not after the flash burst completes');
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'a non-suspending event must not leave the world frozen');
});

// Test 2: restore timing, anchored to the PPU's own drains -- on-drain and
// restore-drain exactly FLASH_TOTAL_FRAMES (six) NMIs apart, not five (the
// exact off-by-one finding 1 found) -- and the confirm tick (one NMI after
// restore-drain) is checked structurally (vram_len == 0 at main_loop_ready),
// not by a third vramMem observation, which cannot distinguish "genuinely
// idle" from "redundantly re-queued the same, already-correct bytes"
// (finding 1's own point).
test('Flash restores after exactly six NMIs, and the confirm tick queues nothing more', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes, project, built } = await buildWith(t, [{ op: 'flash' }]);
  const original = paletteBytes(project);
  tap(nes, B, 0); // zero extra frames -- see test 1's own note on why

  const changeFrames = [];
  let prev = readPalette(nes);
  for (let f = 0; f < 2 * FLASH_ARM_VALUE + 20 && changeFrames.length < 2; f++) {
    nes.frame();
    const now = readPalette(nes);
    if (JSON.stringify(now) !== JSON.stringify(prev)) changeFrames.push(f);
    prev = now;
  }
  assert.equal(changeFrames.length, 2, `expected exactly two PPU palette changes (on-drain, restore-drain), saw ${changeFrames.length}`);
  const [onDrain, restoreDrain] = changeFrames;
  assert.equal(restoreDrain - onDrain, FLASH_TOTAL_FRAMES, 'on-drain and restore-drain must be exactly FLASH_TOTAL_FRAMES (six) NMIs apart');
  assert.deepEqual(readPalette(nes), original, 'after restore-drain, the palette must read exactly the authored bytes');

  // One more frame is the confirm tick -- single-step it and stop right at
  // main_loop_ready, then assert vram_len == 0. A redundant re-push on this
  // tick would leave vram_len at 35 (a fresh packet's own 3-byte header plus
  // 32-byte body), not 0, which a palette-only assertion could never catch
  // because the re-pushed bytes are identical to what is already showing.
  const symbolsText = await fs.promises.readFile(built.symbolPath, 'utf8');
  const symbols = parseSymbolFile(symbolsText);
  const mainLoopReadyAddr = symbols.main_loop_ready;
  assert.ok(Number.isFinite(mainLoopReadyAddr), 'main_loop_ready should be a named symbol in game.fns');

  const emulator = new Emulator({ onFrame: () => {} });
  emulator.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
  // Fast-forward the fresh emulator instance to the identical point in time
  // the plain-NES instance above already reached (boot + tap + changeFrames
  // worth of frames), since Emulator's own instruction-stepping needs to
  // start from the same session `nes` did to land on the confirm tick.
  for (let i = 0; i < 30; i++) emulator.nes.frame();
  if (emulator.nes.cpu.mem[GAME_STATE] === ST_TITLE) {
    emulator.setButton(BUTTON.START, true);
    emulator.nes.frame();
    emulator.setButton(BUTTON.START, false);
    for (let i = 0; i < 12; i++) emulator.nes.frame();
  }
  emulator.setButton(BUTTON.B, true);
  emulator.nes.frame();
  emulator.setButton(BUTTON.B, false); // matching tap(nes, B, 0) exactly -- no extra frames
  // Exactly restoreDrain calls, not restoreDrain+1: the changeFrames loop
  // above recorded the restore-drain observation *after* loop call index
  // restoreDrain (7) itself had already run -- that is the call whose own
  // frame is the confirm tick's own trigger, the eighth nes.frame() call
  // overall. Replaying exactly `restoreDrain` calls here reproduces calls
  // 0 through restoreDrain-1 (indices 0-6, seven calls total) and stops --
  // one call short, deliberately -- right before that same call index
  // begins, so the single-stepping below walks *into* the confirm tick's
  // own frame rather than past it. (Sabotage-verified: an earlier
  // off-by-one here replayed one call too many, landed one frame after the
  // confirm tick, and could not detect a redundant re-push there at all --
  // see the implementation report.)
  for (let f = 0; f < restoreDrain; f++) emulator.nes.frame();

  let hitReady = false;
  for (let iter = 0; iter < 4_000_000 && !hitReady; iter++) {
    const frameEnded = emulator.stepInstruction();
    if (emulator.pc === mainLoopReadyAddr) {
      hitReady = true;
      break;
    }
    if (frameEnded) break;
  }
  assert.ok(hitReady, 'never reached main_loop_ready on the confirm tick while single-stepping');
  assert.equal(emulator.nes.cpu.mem[VRAM_LEN], 0, 'the confirm tick must queue nothing -- vram_len should read 0 at main_loop_ready, not 35 (a redundant re-push)');
});

// Test 4: the terminal-tick redraw race (finding 2). Poke flash_left to 1
// directly -- the countdown value one tick away from the hold-terminal step
// that sets FLASH_PENDING and queues the restore -- then force an owed warp
// on that identical frame, before the next NMI could ever drain the queued
// packet. The palette must be restored on this exact frame's own redraw,
// not stranded at FLASH_COLOR. A wrong implementation that clears
// flash_left straight to 0 (instead of FLASH_PENDING) the instant the
// restore is queued would make vram_reset's own check see nothing
// outstanding and leave the palette white forever -- this is the one test
// in this plan that catches exactly that.
test('a redraw racing the terminal tick still restores the palette (FLASH_PENDING closes the race)', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes, project } = await buildWith(t, [{ op: 'flash' }], (proj) => {
    proj.maps[0].screens[1].metatiles = new Array(240).fill(1);
  });
  const original = paletteBytes(project);
  tap(nes, B);

  // Run until the flash-on packet has actually drained (empirically, not
  // assumed), so the palette is genuinely showing FLASH_COLOR before the
  // race is staged.
  let painted = false;
  for (let f = 0; f < FLASH_ARM_VALUE + 5 && !painted; f++) {
    nes.frame();
    if (readPalette(nes)[0] === FLASH_COLOR) painted = true;
  }
  assert.ok(painted, 'the flash-on packet never drained');

  // Poke flash_left to 1 -- one tick away from the hold-terminal step --
  // and, on the very same upcoming frame, arm an owed warp. flash_tick runs
  // before settle_owed/dispatch_input in main_loop, so this frame's own
  // tick sees flash_left==1, sets FLASH_PENDING, queues the restore -- and
  // then, later in the identical frame, the warp fires and redraw_screen's
  // own vram_reset must apply the fix before this frame's NMI could ever
  // drain the just-queued (and about-to-be-discarded) restore packet.
  nes.cpu.mem[FLASH_LEFT] = 1;
  nes.cpu.mem[WARP_READY] = 1;
  nes.cpu.mem[WARP_SCR] = 1;
  nes.cpu.mem[WARP_X] = 40;
  nes.cpu.mem[WARP_Y] = 40;
  nes.frame();

  assert.equal(nes.cpu.mem[FLAT_SCREEN], 1, 'the warp should have actually landed on screen 1');
  assert.equal(nes.cpu.mem[PLAYER_X], 40, "the warp should have set the player's x");
  assert.equal(nes.cpu.mem[PLAYER_Y], 40, "the warp should have set the player's y");
  assert.deepEqual(
    readPalette(nes),
    original,
    'the palette must be restored on this same frame\'s redraw -- not stranded at FLASH_COLOR by a race between queuing the restore and the redraw discarding it'
  );
});

// Test 5: field-redraw cancellation, swept across every phase of the hold
// -- mid-hold, the terminal (pending) tick, and a genuinely-idle negative
// control -- each forced independently via a direct flash_left poke rather
// than waited for naturally, so the exact phase under test is never in
// doubt.
test('a redraw mid-flash restores the palette on the same frame, at every phase of the hold', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  async function warpDuringFlash(flashLeftValue) {
    const { nes, project } = await buildWith(t, [{ op: 'flash' }], (proj) => {
      proj.maps[0].screens[1].metatiles = new Array(240).fill(1);
    });
    const original = paletteBytes(project);
    tap(nes, B);
    let painted = false;
    for (let f = 0; f < FLASH_ARM_VALUE + 5 && !painted; f++) {
      nes.frame();
      if (readPalette(nes)[0] === FLASH_COLOR) painted = true;
    }
    assert.ok(painted, 'the flash-on packet never drained');
    if (flashLeftValue !== null) nes.cpu.mem[FLASH_LEFT] = flashLeftValue;
    nes.cpu.mem[WARP_READY] = 1;
    nes.cpu.mem[WARP_SCR] = 1;
    nes.cpu.mem[WARP_X] = 40;
    nes.cpu.mem[WARP_Y] = 40;
    nes.frame();
    assert.equal(nes.cpu.mem[FLAT_SCREEN], 1, 'the warp should have actually landed on screen 1');
    return { nes, original };
  }

  // Mid-hold: several hold frames still remain.
  {
    const { nes, original } = await warpDuringFlash(4);
    assert.deepEqual(readPalette(nes), original, 'mid-hold: the palette must be restored on the same frame as the redraw');
  }
  // The terminal (pending) tick, re-asserted here as part of the sweep.
  {
    const { nes, original } = await warpDuringFlash(1);
    assert.deepEqual(readPalette(nes), original, 'terminal tick: the palette must be restored on the same frame as the redraw');
  }
  // Negative control: genuinely idle (flash_left left at whatever the
  // confirm tick already settled it to -- 0). No poke at all: run the whole
  // burst to natural completion first. Finding 6: pixel equality alone
  // cannot prove this -- an unconditional-restore implementation (the
  // rejected alternative §3/§10 open question 6 costs and rejects) would
  // rebuild and synchronously rewrite the identical, already-current
  // palette on *every* redraw regardless of flash_left, and the final
  // `deepEqual` below would still pass. countPaletteWrites wraps the
  // redraw's own frame and asserts zero writes actually reached palette
  // RAM, which the rejected implementation would fail (32 writes, or 64
  // counting the mirrored pairs' own second write).
  {
    const { nes, project } = await buildWith(t, [{ op: 'flash' }], (proj) => {
      proj.maps[0].screens[1].metatiles = new Array(240).fill(1);
    });
    const original = paletteBytes(project);
    tap(nes, B);
    run(nes, 2 * FLASH_ARM_VALUE + 20); // out past both drains and the confirm tick
    assert.deepEqual(readPalette(nes), original, 'the burst should have completed and restored on its own before the warp');
    nes.cpu.mem[WARP_READY] = 1;
    nes.cpu.mem[WARP_SCR] = 1;
    nes.cpu.mem[WARP_X] = 40;
    nes.cpu.mem[WARP_Y] = 40;
    const paletteWrites = countPaletteWrites(nes, () => nes.frame());
    assert.equal(nes.cpu.mem[FLAT_SCREEN], 1, 'the warp should have actually landed on screen 1');
    assert.deepEqual(readPalette(nes), original, 'idle: an ordinary redraw with nothing outstanding must not touch the palette at all');
    assert.equal(paletteWrites, 0, 'an idle redraw (flash_left already 0) must not write palette RAM at all -- vram_reset_no_flash must actually be taken, not merely produce the same final bytes by coincidence');
  }
});

// Test 6: battle-entry cancellation -- the second real caller of
// vram_reset, forced independently and swept across the same phases test 5
// sweeps. Finding 1 (round 1): the original version scripted Flash
// immediately followed by a live Battle command on the same page and waited
// 20 frames before inspecting the palette. Since Flash does not suspend,
// Battle ran on the very next dispatch, well before the on-packet could
// even drain -- with the whole Flash block removed from vram_reset entirely
// (or moved to redraw_screen only), flash_left stays armed straight through
// battle entry, main_loop's own unconditional flash_tick keeps ticking
// regardless of game_state, and the burst completes and restores *on its
// own*, six frames later, long before the 20-frame wait was up -- passing a
// test that claims to prove draw_battle_screen's own cancellation, with
// none present. Fixed by using applyBattleTest
// (renderer/emulator/battletest.js -- this codebase's own "fire a chosen
// encounter without walking into it" tool) to force battle entry
// deterministically, at a moment chosen after FLASH_COLOR has actually been
// observed on the PPU, and to assert restoration on the exact frame
// battle_begin/draw_battle_screen ran -- not "eventually," which is exactly
// the gap a natural restore could hide behind.
//
// Finding 1 (round 2): the terminal (FLASH_PENDING) subcase still poked
// flash_left=1 *before* calling applyBattleTest, the same as the mid-hold
// subcase. applyBattleTest's own runToAddress(check_encounter) run-up lets
// several real frames pass first, each with its own real flash_tick and a
// real intervening NMI -- so the poked terminal value is consumed and
// drained by an ordinary flash_tick/vram_reset(redraw) cycle well before
// battle_begin ever runs, and the tested caller (draw_battle_screen) sees
// flash_left already 0. A caller-specific implementation that cancels on
// 1..FLASH_ARM_VALUE but treats $FF (FLASH_PENDING) as idle therefore still
// passed this subcase. Fixed per the review's own staging: establish
// ST_BATTLE first with flash_left left alone, then poke 1 immediately
// before the battle-intro frame's own flash_tick runs -- applyBattleTest's
// own rendezvous (runToAddress(MAIN_LOOP)) leaves the CPU sitting exactly
// at main_loop's own first instruction, one call before that frame's own
// flash_tick, which is exactly where the poke has to land for
// draw_battle_screen's own vram_reset to be the thing that actually
// observes FLASH_PENDING.
test('entering a scripted battle mid-flash restores the palette via draw_battle_screen too', {
  skip: !hasRom && 'run `npm run sample && npm run sample:rpg` first'
}, async (t) => {
  // The one flash_left value ($1) that stages differently: flash_tick's own
  // hold branch converts a poked 1 into FLASH_PENDING the very tick it
  // runs, so it has to be poked immediately before the specific flash_tick
  // call that must see it, not merely "at some point before battle_begin."
  const TERMINAL_STAGED_AFTER_BATTLE = 1;

  async function battleDuringFlash(flashLeftValue) {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-flash-battle-'));
    t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
    const project = await loadProject(SAMPLE_RPG);
    project.maps[0].encounters = { rate: 0, actorIds: [] }; // no wandering encounters to confuse timing
    project.maps[0].screens[0].metatiles = new Array(240).fill(0); // guarantee the approach is open
    const npcId = project.sprites.actors.length;
    project.sprites.actors.push({ ...structuredClone(project.sprites.actors[0]), id: npcId, name: 'Flasher', behavior: 'npc', damage: 0 });
    // Player starts at (112, 112) on this map's own screen 0 -- one metatile
    // north, facing down toward it on arrival, the identical adjacency
    // fade.test.js's own buildWith already relies on for `sample`. No
    // scripted Battle command anywhere -- battle entry is forced directly,
    // below, so its timing is never at the mercy of how fast a script
    // dispatch chain happens to run.
    project.maps[0].screens[0].entities = [
      { actorId: npcId, x: 112, y: 96, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'flash' }] }] } } }
    ];
    await saveProject(dir, project);
    const built = await buildProject({ dir, project, log: () => {} });
    const build = {
      ram: parseEquates(await fs.promises.readFile(path.join(dir, 'build/constants.asm'), 'utf8')),
      symbols: parseSymbolFile(await fs.promises.readFile(built.symbolPath, 'utf8'))
    };
    const original = paletteBytes(project);

    const emulator = new Emulator({ onFrame: () => {} });
    emulator.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
    for (let i = 0; i < 30; i++) emulator.nes.frame();
    if (emulator.nes.cpu.mem[GAME_STATE] === ST_TITLE) {
      emulator.setButton(BUTTON.START, true);
      emulator.nes.frame();
      emulator.setButton(BUTTON.START, false);
      for (let i = 0; i < 12; i++) emulator.nes.frame();
    }
    emulator.setButton(BUTTON.B, true);
    emulator.nes.frame();
    emulator.setButton(BUTTON.B, false);

    // Observe FLASH_COLOR on the PPU before ever forcing battle -- the
    // review's own instruction, and the reason this cannot pass on a
    // fixture where the flash never actually became visible at all.
    let painted = false;
    for (let f = 0; f < FLASH_ARM_VALUE + 5 && !painted; f++) {
      emulator.nes.frame();
      if (readPalette(emulator.nes)[0] === FLASH_COLOR) painted = true;
    }
    assert.ok(painted, 'the flash-on packet never drained');

    // Mid-hold pokes before applyBattleTest -- comfortable margin (4 hold
    // frames) means it is still counting down, nonzero, by the time
    // draw_battle_screen runs, whatever real frames applyBattleTest's own
    // run-up consumes. Idle lets the burst finish naturally, also before
    // applyBattleTest. Only the terminal case (round-2 finding 1) needs to
    // poke *after* establishing ST_BATTLE -- see below.
    if (flashLeftValue !== null && flashLeftValue !== TERMINAL_STAGED_AFTER_BATTLE) {
      emulator.poke(FLASH_LEFT, flashLeftValue);
    } else if (flashLeftValue === null) {
      // Idle case: let the whole burst finish naturally (restore-drain plus
      // the confirm tick) before forcing battle, so flash_left is
      // genuinely 0 -- observing on-drain alone (above) only proves the
      // flash started, not that it has already finished.
      for (let f = 0; f < 2 * FLASH_ARM_VALUE + 20 && emulator.peek(FLASH_LEFT) !== 0; f++) emulator.nes.frame();
      assert.equal(emulator.peek(FLASH_LEFT), 0, 'the burst should have completed naturally before forcing an idle battle entry');
    }

    // Snake (actor id 3 in sample-rpg) is a real monster not otherwise
    // touchable on this screen -- applyBattleTest's own formation, not the
    // map's (empty) encounter table. battle_begin itself (engine/rpg.asm)
    // only sets game_state/bt_* fields and returns -- draw_battle_screen is
    // not called until the *following* frame's own ui_tick dispatch
    // (game_state == ST_BATTLE routes into call_battle -> battle_tick ->
    // battle_intro -> draw_battle_screen), confirmed by single-stepping a
    // real build: the palette still reads FLASH_COLOR immediately after
    // applyBattleTest returns. So the actual assertion point has to be
    // anchored past draw_battle_screen's own return, not past
    // applyBattleTest's -- single-stepping there and back is what makes
    // "the exact battle-entry action" a real claim rather than "eventually,
    // within whatever window the test happened to leave."
    const drawBattleScreenAddr = build.symbols.draw_battle_screen;
    assert.ok(Number.isFinite(drawBattleScreenAddr), 'draw_battle_screen should be a named symbol in game.fns');
    const runToDrawBattleScreenAndBack = () => {
      let hit = false;
      for (let i = 0; i < 4_000_000 && !hit; i++) {
        emulator.stepInstruction();
        if (emulator.pc === drawBattleScreenAddr) hit = true;
      }
      assert.ok(hit, 'never reached draw_battle_screen after forcing battle entry');
      assert.ok(emulator.stepOut(), 'draw_battle_screen did not run to completion');
    };

    // The terminal subcase's own staging (round-2 finding 1): establish
    // ST_BATTLE with flash_left still counting down on its own, then poke
    // FLASH_PENDING's own trigger value immediately before the
    // battle-intro frame's own flash_tick -- applyBattleTest's own
    // rendezvous (runToAddress(MAIN_LOOP), see battletest.js's own header)
    // stops with the CPU sitting exactly at main_loop's first instruction,
    // one wait_vblank/flash_tick call before that frame's own flash_tick
    // runs, so the poke lands where flash_tick will consume it into
    // FLASH_PENDING before ui_tick's call_battle -> battle_tick ->
    // battle_intro -> draw_battle_screen runs later in that same frame.
    const stageTerminalAfterBattleBegin = () => {
      applyBattleTest(emulator, [3, 0xff, 0xff, 0xff], build);
      emulator.poke(FLASH_LEFT, TERMINAL_STAGED_AFTER_BATTLE);
      runToDrawBattleScreenAndBack();
    };

    let paletteWrites = 0;
    if (flashLeftValue === null) {
      // Idle negative control: assert not merely that the pixels end up
      // right, but that draw_battle_screen's own vram_reset genuinely took
      // the "nothing outstanding" path -- the same distinction finding 6
      // already drew for redraw_screen's own idle case.
      paletteWrites = countPaletteWrites(emulator.nes, () => {
        applyBattleTest(emulator, [3, 0xff, 0xff, 0xff], build);
        runToDrawBattleScreenAndBack();
      });
    } else if (flashLeftValue === TERMINAL_STAGED_AFTER_BATTLE) {
      stageTerminalAfterBattleBegin();
    } else {
      applyBattleTest(emulator, [3, 0xff, 0xff, 0xff], build);
      runToDrawBattleScreenAndBack();
    }

    return { emulator, original, build, paletteWrites };
  }

  // Mid-hold: several hold frames still remain. applyBattleTest's own
  // runToAddress(check_encounter) consumes part of a frame before the
  // redirect, so flash_left may have ticked down some by the time
  // battle_begin actually runs -- 4 leaves comfortable margin, matching
  // test 5's own mid-hold value.
  {
    const { emulator, original, build } = await battleDuringFlash(4);
    assert.equal(emulator.peek(build.ram.game_state), build.ram.ST_BATTLE, 'the forced battle should have actually started');
    assert.deepEqual(
      readPalette(emulator.nes),
      original,
      'mid-hold: the battle screen must show the restored palette on the exact frame battle_begin/draw_battle_screen ran, not merely by the time the test gets around to checking'
    );
  }
  // The terminal (pending) tick, re-asserted here as part of the sweep,
  // matching test 5's own coverage of the FLASH_PENDING window.
  {
    const { emulator, original, build } = await battleDuringFlash(1);
    assert.equal(emulator.peek(build.ram.game_state), build.ram.ST_BATTLE, 'the forced battle should have actually started');
    assert.deepEqual(
      readPalette(emulator.nes),
      original,
      'terminal tick: the battle screen must show the restored palette on the exact frame battle_begin/draw_battle_screen ran'
    );
  }
  // Idle negative control: no poke at all, flash_left already 0 by the time
  // battle is forced (the on-packet's own natural drain, observed above, is
  // all that ran) -- draw_battle_screen's own vram_reset call must take the
  // "nothing outstanding" path and write no palette bytes at all.
  {
    const { emulator, build, paletteWrites } = await battleDuringFlash(null);
    assert.equal(emulator.peek(build.ram.game_state), build.ram.ST_BATTLE, 'the forced battle should have actually started');
    assert.equal(paletteWrites, 0, 'idle: entering battle with nothing outstanding must not write palette RAM at all');
  }
});

// Test 7: two real producers sharing a frame -- a Say's own text_tick row
// append and Flash's own on-tick edge, forced onto the identical frame via
// a direct flash_left poke while the box is actively mid-open (not `Wait`,
// which writes no packet at all and would let a single-producer
// implementation pass unnoticed). Breaks at main_loop_ready, after both
// producers have queued but before the drain, and asserts the exact,
// anchored queue state (finding 6): vram_len == 70 (two full 35-byte
// packets, indices 0-69) and vram_buf[70] == 0 (vram_end's own terminator).
test('a Say and a Flash edge sharing one frame both apply correctly, and the queue holds exactly two packets', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Flash never actually runs as part of this script (Say suspends first),
  // but it has to be live somewhere in the project -- not off, not absent
  // -- for FLASH_ENABLED to be true and flash_tick to assemble at all,
  // since this test drives it entirely by poking flash_left directly.
  const { nes, built } = await buildWith(t, [{ op: 'say', text: 'Thunder crashes in the distance!' }, { op: 'flash' }]);
  tap(nes, B); // opens the box; text_tick begins its own multi-frame open/type sequence
  assert.equal(nes.cpu.mem[GAME_STATE], ST_DIALOG, 'the box should be open and the world frozen');

  const symbolsText = await fs.promises.readFile(built.symbolPath, 'utf8');
  const symbols = parseSymbolFile(symbolsText);
  const mainLoopReadyAddr = symbols.main_loop_ready;
  assert.ok(Number.isFinite(mainLoopReadyAddr), 'main_loop_ready should be a named symbol in game.fns');

  const emulator = new Emulator({ onFrame: () => {} });
  emulator.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
  for (let i = 0; i < 30; i++) emulator.nes.frame();
  if (emulator.nes.cpu.mem[GAME_STATE] === ST_TITLE) {
    emulator.setButton(BUTTON.START, true);
    emulator.nes.frame();
    emulator.setButton(BUTTON.START, false);
    for (let i = 0; i < 12; i++) emulator.nes.frame();
  }
  emulator.setButton(BUTTON.B, true);
  emulator.nes.frame();
  emulator.setButton(BUTTON.B, false);
  emulator.nes.frame();
  // Land during the box's own multi-frame *raise* (each tick of which
  // queues a genuine 32-byte row -- CLAUDE.md's own "one 32-byte row per
  // frame" rule), not the later character-by-character typing phase, which
  // queues only a handful of bytes per tick and would not exercise the
  // two-full-packet bound this test means to check.
  assert.equal(emulator.nes.cpu.mem[GAME_STATE], ST_DIALOG, 'the box should still be open at this point');

  // Arm Flash's own on-edge for the identical upcoming frame.
  emulator.nes.cpu.mem[FLASH_LEFT] = FLASH_ARM_VALUE;

  let hitReady = false;
  for (let iter = 0; iter < 4_000_000 && !hitReady; iter++) {
    const frameEnded = emulator.stepInstruction();
    if (emulator.pc === mainLoopReadyAddr) {
      hitReady = true;
      break;
    }
    if (frameEnded) break;
  }
  assert.ok(hitReady, 'never reached main_loop_ready while single-stepping the shared frame');
  const vramLen = emulator.nes.cpu.mem[VRAM_LEN];
  assert.equal(vramLen, 70, `expected exactly two full 35-byte packets queued (vram_len == 70), saw ${vramLen}`);
  assert.equal(emulator.nes.cpu.mem[VRAM_BUF + 70], 0, 'vram_buf[70] should be vram_end\'s own terminator');

  // Let that frame's own NMI drain both packets, then confirm both effects
  // landed: the flash colour, and the box's own tile row (any non-blank
  // tile in the box's own text area, row 26 of the nametable -- $2000 +
  // 26*32). Single-step to nmi_rti specifically (the same zero-byte anchor
  // §9 test 8's Mesen check uses), not the *next* main_loop_ready -- the
  // box's own raise sequence spans several frames, each queuing another
  // full 32-byte row on its own, so vram_len is legitimately nonzero again
  // by the following main_loop_ready even though this shared frame's own
  // two packets drained completely; nmi_rti is the one point that isolates
  // "did this specific drain finish" from "what the next frame went on to
  // queue for itself." Not nes.frame() either -- see the earlier note on
  // why calling it mid-frame misbehaves.
  const nmiRtiAddr = symbols.nmi_rti;
  assert.ok(Number.isFinite(nmiRtiAddr), 'nmi_rti should be a named symbol in game.fns');
  let hitRti = false;
  for (let iter = 0; iter < 4_000_000 && !hitRti; iter++) {
    emulator.stepInstruction();
    if (emulator.pc === nmiRtiAddr) hitRti = true;
  }
  assert.ok(hitRti, 'never reached nmi_rti after the shared frame');
  assert.equal(emulator.nes.cpu.mem[VRAM_LEN], 0, 'both packets should be fully drained by nmi_rti');
  const painted = readPalette(emulator.nes);
  for (let i = 0; i < 32; i++) assert.equal(painted[i], FLASH_COLOR, `byte ${i} should be FLASH_COLOR after the shared frame's drain`);
  const boxRowStart = 0x2000 + 26 * 32;
  const boxRow = Array.from({ length: 32 }, (_, i) => emulator.nes.ppu.vramMem[boxRowStart + i]);
  assert.ok(boxRow.some((tile) => tile !== 0), 'the message box\'s own text row should have received real tile data on the shared frame too');
});

// Test 9: the PPUADDR fix, now reachable in a genuinely Flash-only fixture
// (finding 5) -- the identical byte-level assertions the shipped Fade test
// already makes (anchored to nmi_fade_ppuaddr via game.fns, proving the
// preceding instruction is jsr vram_drain, proving nmi_fade_ppuaddr_done ==
// nmi_scroll), plus the behavioural half (vramAddress sampled at that exact
// boundary), against a project with a live Flash and no Fade at all.
test('the NMI leaves PPUADDR outside palette space right after a Flash packet drains, on a Flash-only build', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-flash-ppuaddr-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  const slime = project.sprites.actors[0];
  const npcId = project.sprites.actors.length;
  project.sprites.actors.push({ ...structuredClone(slime), id: npcId, name: 'Flasher', behavior: 'npc' });
  project.maps[0].screens[0].metatiles = new Array(240).fill(0);
  project.maps[0].screens[0].entities = [
    { actorId: npcId, x: 112, y: 96, props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'flash' }] }] } } }
  ];
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const symbolsText = await fs.promises.readFile(built.symbolPath, 'utf8');
  const symbols = parseSymbolFile(symbolsText);
  const siteAddr = symbols.nmi_fade_ppuaddr;
  const doneAddr = symbols.nmi_fade_ppuaddr_done;
  const scrollAddr = symbols.nmi_scroll;
  const vramDrainAddr = symbols.vram_drain;
  assert.ok(Number.isFinite(siteAddr), 'nmi_fade_ppuaddr should be a named symbol in game.fns for a Flash-only build too');
  assert.ok(Number.isFinite(doneAddr), 'nmi_fade_ppuaddr_done should be a named symbol in game.fns');
  assert.ok(Number.isFinite(scrollAddr), 'nmi_scroll should be a named symbol in game.fns');
  assert.ok(Number.isFinite(vramDrainAddr), 'vram_drain should be a named symbol in game.fns');

  const rom = fs.readFileSync(built.romPath);
  const header = 16;
  const romCount = rom[4];
  const fixedBankFileBase = header + (romCount - 1) * 16384;
  const addrToOffset = (addr) => fixedBankFileBase + (addr - 0xc000);

  const siteOffset = addrToOffset(siteAddr);
  const needle = Buffer.from([0xa9, 0x00, 0x8d, 0x06, 0x20, 0x8d, 0x06, 0x20]);
  assert.ok(
    rom.subarray(siteOffset, siteOffset + needle.length).equals(needle),
    `the two-$2006-write PPUADDR fix should sit exactly at nmi_fade_ppuaddr's own address on a Flash-only build too`
  );
  const expectedJsr = Buffer.from([0x20, vramDrainAddr & 0xff, (vramDrainAddr >> 8) & 0xff]);
  assert.ok(
    rom.subarray(siteOffset - 3, siteOffset).equals(expectedJsr),
    'the three bytes immediately before nmi_fade_ppuaddr should be jsr vram_drain on a Flash-only build too'
  );
  assert.equal(doneAddr, scrollAddr, 'nmi_fade_ppuaddr_done should equal nmi_scroll on a Flash-only build too');

  const emulator = new Emulator({ onFrame: () => {} });
  emulator.loadROM(new Uint8Array(rom));
  const nes = emulator.nes;
  for (let i = 0; i < 30; i++) nes.frame();
  if (nes.cpu.mem[GAME_STATE] === ST_TITLE) {
    emulator.setButton(BUTTON.START, true);
    nes.frame();
    emulator.setButton(BUTTON.START, false);
    for (let i = 0; i < 12; i++) nes.frame();
  }
  emulator.setButton(BUTTON.B, true);
  nes.frame();
  emulator.setButton(BUTTON.B, false);
  for (let i = 0; i < 2; i++) nes.frame();

  let sawPaint = false;
  for (let f = 0; f < FLASH_ARM_VALUE + 5 && !sawPaint; f++) {
    nes.frame();
    if (nes.ppu.vramMem[0x3f00] === FLASH_COLOR) sawPaint = true;
  }
  assert.ok(sawPaint, 'the flash-on packet should have drained within the expected window');

  let hitDone = false;
  let vramAddressAtFix = null;
  for (let iter = 0; iter < 2_000_000 && !hitDone; iter++) {
    const frameEnded = emulator.stepInstruction();
    if (emulator.pc === doneAddr) {
      hitDone = true;
      vramAddressAtFix = nes.ppu.vramAddress;
    }
    if (frameEnded) break;
  }
  assert.ok(hitDone, 'never reached nmi_fade_ppuaddr_done while single-stepping the frame after a Flash step applied');
  assert.ok(
    vramAddressAtFix < 0x3f00 || vramAddressAtFix > 0x3fff,
    `PPUADDR (v) should be outside palette space right after the fix runs, but read $${vramAddressAtFix.toString(16)}`
  );
});

// The "both live, exactly once" half of test 9 -- a project with a live
// Fade AND a live Flash must contain exactly one copy of the PPUADDR fix,
// not a duplicate. Checked by scanning for the needle's own address (via
// nmi_fade_ppuaddr, which is one single label regardless of how many
// features are live) and confirming the eight-byte sequence occurs exactly
// once in the neighbourhood of that label -- a regression that duplicated
// the block would either fail to assemble (label redefined) or, if
// duplicated under a different label, leave a second needle match nearby.
test('the PPUADDR fix appears exactly once when both Fade and Flash are live', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { built, romPath } = await buildWith(t, [{ op: 'flash' }, { op: 'fade', dir: 'out' }]);
  const symbolsText = await fs.promises.readFile(built.symbolPath, 'utf8');
  const symbols = parseSymbolFile(symbolsText);
  const doneAddr = symbols.nmi_fade_ppuaddr_done;
  const scrollAddr = symbols.nmi_scroll;
  assert.equal(doneAddr, scrollAddr, 'nmi_fade_ppuaddr_done should equal nmi_scroll even with both features live -- one physical copy, not two back-to-back');

  const rom = fs.readFileSync(romPath);
  const header = 16;
  const romCount = rom[4];
  const fixedBankFileBase = header + (romCount - 1) * 16384;
  const siteAddr = symbols.nmi_fade_ppuaddr;
  const siteOffset = fixedBankFileBase + (siteAddr - 0xc000);
  const needle = Buffer.from([0xa9, 0x00, 0x8d, 0x06, 0x20, 0x8d, 0x06, 0x20]);
  // Scan a generous neighbourhood around the labelled site for a second,
  // unlabelled occurrence of the identical needle -- a duplicate block
  // would show up here even if it assembled under a different (or no)
  // label.
  const windowStart = Math.max(0, siteOffset - 64);
  const windowEnd = Math.min(rom.length, siteOffset + 64);
  let matches = 0;
  for (let i = windowStart; i <= windowEnd - needle.length; i++) {
    if (rom.subarray(i, i + needle.length).equals(needle)) matches++;
  }
  assert.equal(matches, 1, `expected exactly one occurrence of the PPUADDR fix's own byte sequence near nmi_fade_ppuaddr, found ${matches}`);
});

// Test 10: overlap-priority determinism (open question 1's resolution).
// Force a Flash edge and a Fade step onto the identical frame, and assert
// both the queue order (Flash's own packet at index 0, Fade's own packet
// starting at index 35 -- the same main_loop_ready observation point test 7
// uses) and the resulting palette (Fade's write lands last in that NMI's
// drain, so Fade's value is what the screen shows).
test('a coincident Flash and Fade edge: Flash queues first, Fade wins the pixel', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // Flash never actually runs as part of this script (Fade suspends
  // first), but it has to be live somewhere in the project for
  // FLASH_ENABLED to be true and flash_tick to assemble, since this test
  // drives both by poking fade_left/flash_left directly.
  const { built, project } = await buildWith(t, [{ op: 'fade', dir: 'out' }, { op: 'flash' }]);
  const original = paletteBytes(project);
  const nes = boot(built.romPath);
  tap(nes, B); // Fade out suspends the script, ramping toward black

  const symbolsText = await fs.promises.readFile(built.symbolPath, 'utf8');
  const symbols = parseSymbolFile(symbolsText);
  const mainLoopReadyAddr = symbols.main_loop_ready;

  const emulator = new Emulator({ onFrame: () => {} });
  emulator.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
  for (let i = 0; i < 30; i++) emulator.nes.frame();
  if (emulator.nes.cpu.mem[GAME_STATE] === ST_TITLE) {
    emulator.setButton(BUTTON.START, true);
    emulator.nes.frame();
    emulator.setButton(BUTTON.START, false);
    for (let i = 0; i < 12; i++) emulator.nes.frame();
  }
  emulator.setButton(BUTTON.B, true);
  emulator.nes.frame();
  emulator.setButton(BUTTON.B, false);
  emulator.nes.frame();

  // Land on a frame where fade_tick is genuinely about to apply a step:
  // fade_left counts down each frame it runs, applying a step when it hits
  // zero -- poke it to 1 so the very next frame is guaranteed to apply one,
  // and arm Flash's own on-edge for the identical frame.
  const FADE_LEFT = 0x9e; // from engine/constants.asm, per fade.test.js's own hardcoded value
  emulator.nes.cpu.mem[FADE_LEFT] = 1;
  emulator.nes.cpu.mem[FLASH_LEFT] = FLASH_ARM_VALUE;

  let hitReady = false;
  for (let iter = 0; iter < 4_000_000 && !hitReady; iter++) {
    const frameEnded = emulator.stepInstruction();
    if (emulator.pc === mainLoopReadyAddr) {
      hitReady = true;
      break;
    }
    if (frameEnded) break;
  }
  assert.ok(hitReady, 'never reached main_loop_ready on the coincident frame');
  // Finding 7: both packets target $3F00, so the two headers alone
  // (vram_buf[0] and vram_buf[35], both $3F) stay true even if the two
  // packets traded places -- that would only fail the *final pixel*
  // assertion below, and only for the simplest call-site reversal. Assert
  // packet *identity* via each packet's own first data byte instead: Flash
  // writes a flat, fixed FLASH_COLOR with no source-data dependence at all,
  // so its own first data byte (index 3, right after its 3-byte header) is
  // always exactly $30 regardless of which packet it is; Fade's own first
  // data byte (index 38, after its header at 35-37) is
  // darkened_byte(original[0], 1) -- computed independently here, not read
  // back from the engine -- which only Fade's own packet could produce.
  assert.equal(emulator.nes.cpu.mem[VRAM_BUF + 0], 0x3f, "Flash's own packet should be queued first, at vram_buf index 0");
  assert.equal(emulator.nes.cpu.mem[VRAM_BUF + 3], FLASH_COLOR, 'the packet at index 0 must actually be FLASH_COLOR data, not merely headed $3F');
  assert.equal(emulator.nes.cpu.mem[VRAM_BUF + 35], 0x3f, "Fade's own packet should be queued second, starting at vram_buf index 35");
  {
    const firstDarkened = (() => {
      const value = original[0] - 0x10;
      if (value < 0) return 0x0f;
      if (value === 0x0d) return 0x0f;
      return value;
    })();
    assert.equal(
      emulator.nes.cpu.mem[VRAM_BUF + 38],
      firstDarkened,
      'the packet at index 35 must actually be Fade\'s own darkened data, not merely headed $3F'
    );
  }

  // Continue single-stepping to the next main_loop_ready rather than
  // calling nes.frame() from this mid-frame point -- see test 7's own note
  // on why frame() misbehaves when invoked mid-frame.
  let hitReadyAgain = false;
  for (let iter = 0; iter < 4_000_000 && !hitReadyAgain; iter++) {
    emulator.stepInstruction();
    if (emulator.pc === mainLoopReadyAddr) hitReadyAgain = true;
  }
  assert.ok(hitReadyAgain, 'never reached the next main_loop_ready after the coincident frame');
  const painted = readPalette(emulator.nes);
  const fadeStep1 = original.map((byte) => {
    const value = byte - 0x10;
    if (value < 0) return 0x0f;
    if (value === 0x0d) return 0x0f;
    return value;
  });
  assert.deepEqual(painted, fadeStep1, "Fade's write must land last -- the screen should show Fade's own step-1 darkened palette, not FLASH_COLOR");
});

// Test 11 (permanent half -- the one-time 8beba40 whole-ROM acceptance
// comparison is a report-only step, not a repository test; see
// handoff-flash/flash-implementation-report.md): the re-gated blocks' own
// byte/symbol placement, and current-tree off-vs-omitted identity for the
// genuinely new Flash code.
//
// The reference byte arrays below were captured once, from a real 8beba40
// build (`git worktree add /tmp/... 8beba40`, then the identical Fade-only
// fixture this test itself builds -- sample plus one placed actor with a
// live `{op: 'fade', dir: 'out'}` and no Flash), read back out of the built
// ROM via the same jsnes-based Emulator the other tests in this file use
// (peek() reads through the real mapper, so no frame needs to run first --
// this is ROM content, not RAM state). This is what design-flash.md's own
// test 11 asks for in place of a whole-ROM golden hash: scoped to exactly
// the two blocks this slice re-gated (FADE_ENABLED -> PALETTE_FX_ENABLED),
// so an unrelated future engine change elsewhere in the ROM cannot
// spuriously fail it, while a same-sized mutation of either block still
// will. *Catches:* finding 2's own named wrong implementation -- a
// same-sized mutation of fade_apply_palette or the PPUADDR fix that a byte
// *count* check (the measured kernel-lo allowance deltas) cannot
// distinguish from an unchanged routine.
const REFERENCE_FADE_APPLY_PALETTE_BYTES_FROM_8BEBA40 = [
  173, 156, 0, 10, 10, 10, 10, 141, 7, 0, 169, 63, 160, 0, 32, 223, 208, 162,
  0, 189, 0, 192, 56, 237, 7, 0, 176, 2, 169, 15, 201, 13, 208, 2, 169, 15,
  32, 254, 208, 232, 224, 32, 208, 231, 76, 20, 209
];
// jsr vram_drain (the block's own predecessor, always 3 bytes -- 6502's JSR
// has only one addressing mode) through nmi_fade_ppuaddr_done.
const REFERENCE_NMI_PPUADDR_BLOCK_BYTES_FROM_8BEBA40 = [32, 35, 209, 169, 0, 141, 6, 32, 141, 6, 32];

// Finding 3 (round 2): both reference arrays embed absolute operands that
// point at *other* kernel-lo labels -- decoded by hand from the bytes
// above: `JSR $D0DF` (vram_open), `LDA $C000,X` (palette_data), `JSR $D0FE`
// (vram_push) and `JMP $D114` (vram_end) inside the fade array; `JSR $D123`
// (vram_drain) inside the NMI array. Comparing those operand bytes
// literally against the 8beba40 reference means any future kernel-lo growth
// ahead of text.asm -- which shifts every one of those five symbols --
// spuriously fails a test whose entire point is immunity to exactly that.
// Each offset below is a byte position *within* its own reference array
// (0-indexed), decoded once from the reference bytes themselves; the test
// asserts the *current* build's own bytes at those offsets decode to the
// *current* symbol table, then masks them out of both sides before the
// remaining, genuinely fixed bytes are compared against history.
const FADE_APPLY_PALETTE_RELOCATIONS = [
  { offset: 15, symbol: 'vram_open' }, // JSR vram_open
  { offset: 20, symbol: 'palette_data' }, // LDA palette_data,X
  { offset: 37, symbol: 'vram_push' }, // JSR vram_push
  { offset: 45, symbol: 'vram_end' } // JMP vram_end
];
const NMI_PPUADDR_BLOCK_RELOCATIONS = [
  { offset: 1, symbol: 'vram_drain' } // JSR vram_drain, the block's own predecessor
];

/** Returns a copy of `bytes` with every relocation's own two-byte operand zeroed. */
function zeroRelocatedOffsets(bytes, relocations) {
  const masked = [...bytes];
  for (const { offset } of relocations) {
    masked[offset] = 0;
    masked[offset + 1] = 0;
  }
  return masked;
}

/**
 * Asserts each relocation's own little-endian operand in `bytes` decodes to
 * the current build's own symbol address, then returns `bytes` with those
 * operands masked out -- what's left is safe to compare against a
 * historical reference regardless of where the symbols themselves now sit.
 */
function assertRelocationsAndMask(bytes, relocations, symbols, label) {
  for (const { offset, symbol } of relocations) {
    const addr = bytes[offset] | (bytes[offset + 1] << 8);
    assert.equal(
      addr,
      symbols[symbol],
      `${label}: the operand at offset ${offset} must decode to the current ${symbol} (0x${symbols[symbol]?.toString(16)}), saw 0x${addr.toString(16)}`
    );
  }
  return zeroRelocatedOffsets(bytes, relocations);
}

test('fade_apply_palette and the NMI PPUADDR fix are byte-identical to their 8beba40 shipped form, at whatever address they assemble to now', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { dir, romPath } = await buildWith(t, [{ op: 'fade', dir: 'out' }]);
  const symbolsText = await fs.promises.readFile(path.join(dir, 'build', 'game.fns'), 'utf8');
  const symbols = parseSymbolFile(symbolsText);

  // The body boundary is the checked-in reference's own length, not an
  // open-ended scan for the next label -- finding 3's second false-positive
  // path: a future zero-byte internal label nobody added to an exclusion
  // set would be mistaken for the routine's end and silently truncate the
  // comparison. The reference length is fixed at capture time and needs no
  // such list.
  const fadeStart = symbols.fade_apply_palette;
  assert.ok(Number.isFinite(fadeStart), 'fade_apply_palette must be a named symbol in game.fns');
  const fadeEnd = fadeStart + REFERENCE_FADE_APPLY_PALETTE_BYTES_FROM_8BEBA40.length;

  assert.equal(
    symbols.nmi_fade_ppuaddr_done,
    symbols.nmi_scroll,
    'nmi_fade_ppuaddr_done must still be immediately adjacent to nmi_scroll -- nothing may assemble between the PPUADDR fix and the scroll code that follows it'
  );
  const ppuaddrStart = symbols.nmi_fade_ppuaddr - 3;
  const ppuaddrEnd = ppuaddrStart + REFERENCE_NMI_PPUADDR_BLOCK_BYTES_FROM_8BEBA40.length;

  const emulator = new Emulator({ onFrame: () => {} });
  emulator.loadROM(new Uint8Array(fs.readFileSync(romPath)));
  const readRange = (start, end) => {
    const bytes = [];
    for (let addr = start; addr < end; addr++) bytes.push(emulator.peek(addr));
    return bytes;
  };

  const fadeActualMasked = assertRelocationsAndMask(
    readRange(fadeStart, fadeEnd),
    FADE_APPLY_PALETTE_RELOCATIONS,
    symbols,
    'fade_apply_palette'
  );
  assert.deepEqual(
    fadeActualMasked,
    zeroRelocatedOffsets(REFERENCE_FADE_APPLY_PALETTE_BYTES_FROM_8BEBA40, FADE_APPLY_PALETTE_RELOCATIONS),
    'fade_apply_palette\'s own body bytes (past its four relocatable operands, already checked above) must be unchanged from its 8beba40 shipped form -- only its gating condition (FADE_ENABLED -> PALETTE_FX_ENABLED) may ever differ'
  );

  const ppuaddrActualMasked = assertRelocationsAndMask(
    readRange(ppuaddrStart, ppuaddrEnd),
    NMI_PPUADDR_BLOCK_RELOCATIONS,
    symbols,
    'NMI PPUADDR block'
  );
  assert.deepEqual(
    ppuaddrActualMasked,
    zeroRelocatedOffsets(REFERENCE_NMI_PPUADDR_BLOCK_BYTES_FROM_8BEBA40, NMI_PPUADDR_BLOCK_RELOCATIONS),
    'the NMI PPUADDR fix (plus its jsr vram_drain predecessor, already checked above) must be unchanged from its 8beba40 shipped form -- only its gating condition may ever differ'
  );
});

test('a switched-off Flash costs a project nothing -- not one byte of ROM', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const withOff = await buildWith(t, [
    { op: 'flash', off: true },
    { op: 'setSwitch', switch: 5 }
  ]);
  const without = await buildWith(t, [{ op: 'setSwitch', switch: 5 }]);
  assert.deepEqual(
    [...fs.readFileSync(withOff.romPath)],
    [...fs.readFileSync(without.romPath)],
    'a disabled Flash must leave the ROM identical to one with no Flash at all'
  );
  const symbols = await fs.promises.readFile(path.join(withOff.dir, 'build', 'game.fns'), 'utf8');
  assert.ok(!/^flash_tick\s*=/m.test(symbols), 'flash_tick must not have assembled at all for a project with no live Flash');
  assert.ok(!/^flash_apply_on\s*=/m.test(symbols), 'flash_apply_on must not have assembled at all for a project with no live Flash');
});

test('with neither Fade nor Flash live, the shared palette-fx routine and PPUADDR fix do not assemble either', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const without = await buildWith(t, [{ op: 'setSwitch', switch: 5 }]);
  const symbols = await fs.promises.readFile(path.join(without.dir, 'build', 'game.fns'), 'utf8');
  assert.ok(!/^fade_apply_palette\s*=/m.test(symbols), 'fade_apply_palette must not assemble when neither Fade nor Flash is live');
  assert.ok(!/^nmi_fade_ppuaddr\s*=/m.test(symbols), 'the shared PPUADDR fix must not assemble when neither Fade nor Flash is live');
});

// ------------------------------------------------------- what a project pays for it

test('projectUsesFlash ignores a command the compiler would drop, and finds it nested anywhere', () => {
  const project = createProject('Predicate');
  const pages = (commands) => ({ pages: [{ cond: { type: 'none', arg: 0 }, commands }] });

  project.commonEvents = [{ id: 0, name: 'E', event: pages([{ op: 'flash' }]) }];
  assert.equal(projectUsesFlash(project), true, 'a live Flash counts');

  project.commonEvents = [{ id: 0, name: 'E', event: pages([{ op: 'flash', off: true }]) }];
  assert.equal(projectUsesFlash(project), false, 'a switched-off one does not');

  project.commonEvents = [
    {
      id: 0,
      name: 'E',
      event: pages([{ op: 'branch', cond: { type: 'none', arg: 0 }, then: [{ op: 'flash' }], else: [] }])
    }
  ];
  assert.equal(projectUsesFlash(project), true, 'a Flash nested inside a branch still counts');

  project.commonEvents = [
    {
      id: 0,
      name: 'E',
      event: pages([{ op: 'choice', options: [{ text: 'Go', commands: [{ op: 'flash' }] }, { text: 'No', commands: [] }] }])
    }
  ];
  assert.equal(projectUsesFlash(project), true, 'a Flash inside a Choice option still counts');

  project.commonEvents = [{ id: 0, name: 'Unused', event: pages([{ op: 'flash' }]) }];
  project.maps[0].screens[0].entities = [];
  assert.equal(projectUsesFlash(project), true, 'a Flash in an unreferenced common event still counts');
});
