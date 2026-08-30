// The Fade command: ramps every one of the 32 live palette bytes toward
// black over a handful of frames, or back. See
// /tmp/.../scratchpad/design-fade.md for the full design (RAM layout, opcode
// dispatch, ramp algorithm, suspend/resume shape, fade_reload mechanism) --
// this file follows its §14 testing plan, as amended by round 2's items 1-5.
//
// Fade suspends the script like Wait/Move, not like Shake -- there is
// something to wait for (the ramp reaching its target) and nothing to walk.
// It needs no RAM shadow of "the current palette": palette_data (the
// project's own ROM table) never changes on its own, so every step
// recomputes from it directly, which is also what makes a completed fade
// sticky (survives a warp, a battle, anything) until an explicit Fade the
// other way, or a new session (a fresh game or Continue) which always
// restores full brightness regardless.
//
// Everything builds its own project rather than touching `sample/`, which is
// a checked-in fixture.

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
import { FADE_DIRECTIONS, createProject, normalizeProject, projectUsesFade } from '../../shared/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = path.join(ROOT, 'sample');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
const hasRom = fs.existsSync(path.join(SAMPLE, 'build/game.nes'));

// Engine RAM, from engine/constants.asm.
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const FLAT_SCREEN = 0x16;
const GAME_STATE = 0x25;
const BOX_STATE = 0x40;
const ENT_X = 0x310;
const ENT_Y = 0x318;
const SWITCHES = 0x390;
const VARIABLES = 0x500;

// mv_left/wt_left/shake_left/fade_step/fade_target/fade_left/fade_reload are
// computed expressions in engine/constants.asm (`fade_step = shake_left+1`,
// and so on), not plain `name = $HH` literals, so shared/enginesyms.js's
// parseEquates (which deliberately only understands literal equates) cannot
// read them back -- the same situation turnwait.test.js already documents
// for mv_left/wt_left. Confirmed against a real build by injecting
// `.db mv_left, wt_left, shake_left, fade_step, fade_target, fade_left,
// fade_reload` into a Code Forge user file and reading the emitted bytes
// back out of the booted ROM.
const FADE_STEP = 0x9c;
const FADE_TARGET = 0x9d;
const FADE_LEFT = 0x9e;
const FADE_RELOAD = 0x9f;

const ST_GAMEPLAY = 0;
const ST_DIALOG = 2;
const ST_TITLE = 3;
const BOX_ENDWAIT = 6; // engine/text.asm's BOX_ENDWAIT
const A = 0;
const B = 1;
const SELECT = 2;
const START = 3;
const UP = 4;
const DOWN = 5;
const LEFT = 6;
const RIGHT = 7;

// engine/constants.asm's FADE_STEPS/FADE_STEP_FRAMES.
const FADE_STEPS = 4;
const FADE_STEP_FRAMES = 6;

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

/** Run until the conversation is over, or give up and say so. */
function settle(nes, frames = 400) {
  for (let i = 0; i < frames; i++) {
    if (nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY) return true;
    nes.frame();
  }
  return false;
}

/** The 32 live palette bytes, in $3F00-$3F1F order, straight off the PPU. */
const readPalette = (nes) => Array.from({ length: 32 }, (_, i) => nes.ppu.vramMem[0x3f00 + i]);

/**
 * darkened_byte(i, step) computed independently from the design doc's own
 * algorithm (§4), not read back from the engine: subtract step*$10, clamp a
 * borrow to $0F, and separately force an exact (non-borrowing) $0D to $0F
 * too -- $1D/$2D/$3D minus $10 all land there cleanly.
 */
function darkenedByte(byte, step) {
  const value = byte - step * 0x10;
  if (value < 0) return 0x0f;
  if (value === 0x0d) return 0x0f;
  return value;
}

/**
 * A one-screen project with one talkable actor carrying `commands`, on a
 * screen wiped to metatile 0 (open by construction) -- the identical shape
 * move.test.js's own buildWith uses, for the identical reason: a Fade test
 * that ran into scenery on the way to a warp target would be testing the
 * scenery.
 */
async function buildWith(t, commands, tweak = () => {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-fade-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  const slime = project.sprites.actors[0];
  const npcId = project.sprites.actors.length;
  project.sprites.actors.push({ ...structuredClone(slime), id: npcId, name: 'Fader', behavior: 'npc' });
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
  return { project, dir, romPath: built.romPath, nes: boot(built.romPath) };
}

/** project.palettes.bg then .sprite, flattened -- the same order palette_data is emitted in. */
const paletteBytes = (project) => [...project.palettes.bg.flat(), ...project.palettes.sprite.flat()];

// --------------------------------------------------------------- the wire

test('a Fade compiles to its opcode and a direction, as a list position', () => {
  const project = normalizeProject({
    ...createProject('Fade wire'),
    commonEvents: [
      {
        id: 0,
        name: 'Darken',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'fade', dir: 'out' }] }] }
      }
    ]
  });
  const { events } = compileText(project);
  const bytes = events.flat();
  const at = bytes.indexOf(opIndex('fade'));
  assert.ok(at >= 0, 'the compiled events should contain an OP_FADE');
  assert.deepEqual(
    bytes.slice(at, at + 2),
    [opIndex('fade'), FADE_DIRECTIONS.findIndex((entry) => entry.id === 'out')],
    'direction compiles to its position in FADE_DIRECTIONS, not to a raw string'
  );
});

test('an unknown direction falls back to none (does nothing) rather than being dropped', () => {
  const [command] = normalizeProject({
    ...createProject('Fallback'),
    commonEvents: [
      {
        id: 0,
        name: 'E',
        event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'fade', dir: 'sideways' }] }] }
      }
    ]
  }).commonEvents[0].event.pages[0].commands;

  assert.equal(command.op, 'fade', 'the command survives -- a Fade that lost its direction is still a Fade');
  assert.equal(command.dir, FADE_DIRECTIONS[0].id);
  assert.equal(command.dir, 'none');
});

// ------------------------------------------------------------- the engine

// Test 2 (design doc §14): every step of the out ramp AND the in ramp,
// anchored to the frames the PPU's own palette bytes actually change on
// (round 2, item 4a) -- not a fixed schedule counted from the frame the
// script dispatched the command, since the packet is drained by NMI, not
// applied the instant the mainline issues it.
test('a Fade out then in ramps one step at a time, snapshotted at every step', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes, project } = await buildWith(t, [
    { op: 'fade', dir: 'out' },
    { op: 'setSwitch', switch: 5 },
    { op: 'fade', dir: 'in' },
    { op: 'setSwitch', switch: 6 }
  ]);
  const original = paletteBytes(project);
  assert.deepEqual(readPalette(nes), original, 'the palette should start exactly as authored');

  tap(nes, B); // talk: the page runs, hits Fade out and suspends

  // Stops the instant `wanted` changes have been recorded, not after a fixed
  // frame count -- the compiled event has no pause between the out ramp
  // completing and the in ramp starting (script_resume runs setSwitch and
  // reaches the next Fade synchronously, in the same frame the last out step
  // applied), so a fixed-length window long enough for one ramp reaches
  // partway into the other's own steps too.
  const recordChanges = (wanted, maxFrames) => {
    const changes = [];
    let prev = readPalette(nes);
    for (let f = 0; f < maxFrames && changes.length < wanted; f++) {
      nes.frame();
      const now = readPalette(nes);
      if (JSON.stringify(now) !== JSON.stringify(prev)) {
        changes.push({ frame: f, palette: now });
        prev = now;
      }
    }
    return changes;
  };

  const outChanges = recordChanges(FADE_STEPS, FADE_STEPS * FADE_STEP_FRAMES + 20);
  assert.equal(outChanges.length, FADE_STEPS, 'the out ramp should apply exactly FADE_STEPS steps');
  for (let n = 1; n <= FADE_STEPS; n++) {
    const expected = original.map((byte) => darkenedByte(byte, n));
    assert.deepEqual(outChanges[n - 1].palette, expected, `step ${n} of the out ramp did not match darkened_byte(i, ${n})`);
  }
  // Every gap after the first is exactly FADE_STEP_FRAMES -- only the first
  // step's own distance from dispatch depends on NMI/mainline phase.
  for (let n = 1; n < outChanges.length; n++) {
    assert.equal(
      outChanges[n].frame - outChanges[n - 1].frame,
      FADE_STEP_FRAMES,
      `the gap between out-ramp steps ${n} and ${n + 1} should be FADE_STEP_FRAMES`
    );
  }
  assert.equal(switchOn(nes, 5), true, 'the command after the completed Fade out should have run');
  assert.deepEqual(readPalette(nes), original.map((byte) => darkenedByte(byte, FADE_STEPS)), 'fully faded out');

  const inChanges = recordChanges(FADE_STEPS, FADE_STEPS * FADE_STEP_FRAMES + 20);
  assert.equal(inChanges.length, FADE_STEPS, 'the in ramp should apply exactly FADE_STEPS steps');
  for (let n = 1; n <= FADE_STEPS; n++) {
    const expected = original.map((byte) => darkenedByte(byte, FADE_STEPS - n));
    assert.deepEqual(inChanges[n - 1].palette, expected, `step ${n} of the in ramp did not match darkened_byte(i, ${FADE_STEPS - n})`);
  }
  // Round 1, finding 2: the in ramp's own step spacing, not only the out
  // ramp's -- a wrong lightening path that reloads at the wrong pace would
  // still hit every expected palette in order within the generous window.
  for (let n = 1; n < inChanges.length; n++) {
    assert.equal(
      inChanges[n].frame - inChanges[n - 1].frame,
      FADE_STEP_FRAMES,
      `the gap between in-ramp steps ${n} and ${n + 1} should be FADE_STEP_FRAMES`
    );
  }
  assert.equal(switchOn(nes, 6), true, 'the command after the completed Fade in should have run');
  assert.deepEqual(readPalette(nes), original, 'fully faded back in, byte-for-byte');
});

// Test 5: run the whole out/in cycle twice, byte-for-byte both times --
// catches a mutable RAM shadow that drifts from the ROM original, and a
// subtler variant where the first cycle lands back on the original bytes by
// coincidence but a second would not.
test('a Fade out/in round trip returns exactly to the authored palette, twice', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes, project } = await buildWith(t, [
    { op: 'fade', dir: 'out' },
    { op: 'fade', dir: 'in' },
    { op: 'setSwitch', switch: 5 },
    { op: 'fade', dir: 'out' },
    { op: 'fade', dir: 'in' },
    { op: 'setSwitch', switch: 6 }
  ]);
  const original = paletteBytes(project);

  // Waits for the switch rather than a fixed frame count: the out and in
  // ramps run back-to-back with no pause between them (script_resume
  // reaches the next Fade synchronously, the same frame the previous one's
  // last step applied), so the exact number of frames a full cycle takes is
  // not worth hard-coding twice over when the switch already says when it's
  // done. One extra frame after the switch reads on: SetSwitch is a plain
  // RAM write, visible the instant the mainline runs it, but the terminal
  // step's own palette packet is only *queued* that same tick and drained by
  // the NMI that follows -- which nes.frame()'s own call boundary places one
  // call later than the one where the switch first reads true.
  const waitForSwitch = (n, budget = 2 * FADE_STEPS * FADE_STEP_FRAMES + 40) => {
    for (let i = 0; i < budget && !switchOn(nes, n); i++) nes.frame();
    assert.ok(switchOn(nes, n), `switch ${n} never turned on within the budget`);
    nes.frame();
  };

  tap(nes, B);
  waitForSwitch(5);
  assert.deepEqual(readPalette(nes), original, 'the first cycle should return exactly to the authored palette');

  waitForSwitch(6);
  assert.deepEqual(readPalette(nes), original, 'the second cycle should also return exactly to the authored palette');
});

// Test 6: FADE_NONE and an already-satisfied direction are genuine no-ops --
// palette bytes checked, not only timing (round 1, finding 8), and sampled as
// early as the engine's own event timing allows (round 1, finding 3): a
// non-suspending command runs to completion in the same frame `do_talk`
// starts the page, exactly like Shake's own no-op case
// (shake.test.js:166, `tap(nes, B, 0)` then no further frames) -- so a
// tap(nes, B) (three frames: press plus two release) plus run(nes, 1) gave a
// wrongly-suspending implementation up to four frames to resolve within
// before this checked anything.
test('Fade (does nothing) and an already-faded-out Fade out are both true no-ops', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes, project } = await buildWith(t, [
    { op: 'fade', dir: 'none' },
    { op: 'setSwitch', switch: 5 },
    { op: 'fade', dir: 'out' },
    { op: 'setSwitch', switch: 6 },
    { op: 'fade', dir: 'out' }, // already fully faded out -- must also be a no-op
    { op: 'setSwitch', switch: 7 }
  ]);
  const original = paletteBytes(project);

  tap(nes, B, 0); // talk: Fade none then setSwitch 5 both run this same frame, no suspend
  assert.equal(switchOn(nes, 5), true, 'Fade (does nothing) must not suspend the event at all');
  assert.deepEqual(readPalette(nes), original, 'Fade (does nothing) must not touch the palette');

  // Round 2: advance frame-by-frame and stop the instant switch 6 first
  // reads true -- the real resume boundary -- rather than a blanket
  // run(nes, FADE_STEPS * FADE_STEP_FRAMES + 20) (~44 frames against a ~24
  // frame ramp). The blanket run left ~20 frames of slack after that
  // boundary before switch 7 was ever checked, which the reviewer confirmed
  // with a real sabotage: an already-at-target Fade out that arms a short
  // (e.g. three-frame) suspension, touches no palette bytes, then resumes,
  // passed the old version of this test unchanged.
  const budget = FADE_STEPS * FADE_STEP_FRAMES + 20;
  let framesToSwitch6 = 0;
  while (!switchOn(nes, 6) && framesToSwitch6 < budget) {
    nes.frame();
    framesToSwitch6++;
  }
  assert.equal(switchOn(nes, 6), true, 'the real Fade out should have completed');

  // Switch 7 is asserted immediately at this exact boundary, no further
  // frame advanced first: the already-at-target Fade out and setSwitch 7 are
  // commands 5 and 6 of the same page, and script_resume falls through a
  // non-suspending command synchronously, so switch 7 must already be on the
  // instant switch 6 first reads true.
  assert.equal(switchOn(nes, 7), true, 'a second Fade out, already at target, must not suspend either');

  // The terminal step's own palette packet is only queued this same tick and
  // drained by the NMI that follows -- one nes.frame() call boundary later
  // than the one where the switches first read true (the identical lag the
  // out/in round-trip test's own waitForSwitch documents) -- so the palette
  // checks below, kept exactly as they were, need this one settling frame
  // before they can be asserted.
  nes.frame();
  const faded = original.map((byte) => darkenedByte(byte, FADE_STEPS));
  assert.deepEqual(readPalette(nes), faded, 'fully faded out');
  assert.deepEqual(readPalette(nes), faded, 'an already-there Fade out must not touch the palette at all');
});

// Test 3: liveness past completion (round 1, finding 1), with a
// non-idempotent observable (round 2, item 4b) -- SetSwitch cannot tell one
// resume from two once the switch is already on, so this uses a suspended
// Say (a second resume would reopen the box) and an addVar (a second resume
// would increment past 1).
test('the command after a completed Fade runs exactly once, not once per tick thereafter', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes } = await buildWith(t, [
    { op: 'fade', dir: 'out' },
    { op: 'say', text: 'Dark.' },
    { op: 'addVar', variable: 0, value: 1 }
  ]);

  tap(nes, B);
  run(nes, FADE_STEPS * FADE_STEP_FRAMES + 10);
  assert.equal(nes.cpu.mem[FADE_LEFT], 0, 'the ramp should have finished');
  assert.equal(nes.cpu.mem[BOX_STATE], BOX_ENDWAIT, 'the Say after the Fade should be up, waiting to be dismissed');
  assert.equal(nes.cpu.mem[VARIABLES], 0, 'addVar must not have run before the Say is dismissed');

  tap(nes, A); // dismiss the Say -- addVar runs once
  assert.equal(nes.cpu.mem[VARIABLES], 1, 'addVar should have run exactly once');
  assert.ok(settle(nes), 'the conversation should end once the Say is dismissed and addVar runs');

  // Several more FADE_STEP_FRAMES-sized periods, with no further input: a
  // fade_tick that never clears fade_left would keep dispatching, oscillate
  // fade_step past fade_target, and fire script_resume again every time the
  // oscillation happened to land back on target.
  for (let period = 0; period < 3; period++) {
    run(nes, FADE_STEP_FRAMES);
    assert.equal(nes.cpu.mem[VARIABLES], 1, `addVar must still read 1 after period ${period + 1}`);
    assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, `no phantom Say should have reopened after period ${period + 1}`);
  }
});

// Test 4: the ramp cannot synthesize $0D from a safe source (round 1, finding
// 4). $1D/$2D/$3D are not reachable through the Tile Forge's picker --
// isUnsafeColor (shared/nespalette.js) rejects all four $xD values by
// `index % 16 === 0x0d`, not $0D alone (round 2, item 2) -- so this plants
// them by hand-editing the project object directly, bypassing the picker and
// normalizeProject's own generic 0-63 clamp (which has no isUnsafeColor
// check of its own).
test('the ramp never visits $0D, even from a hand-edited $1D/$2D/$3D source', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes, project } = await buildWith(t, [{ op: 'fade', dir: 'out' }], (proj) => {
    // Slot 0 of every palette is forced to a shared backdrop by
    // normalizeProject, so these hand-edits land on slots 1-3 instead.
    proj.palettes.bg[0][1] = 0x1d;
    proj.palettes.bg[1][2] = 0x2d;
    proj.palettes.sprite[0][3] = 0x3d;
  });
  const original = paletteBytes(project);
  assert.ok(original.includes(0x1d) && original.includes(0x2d) && original.includes(0x3d), 'the hand-edit should have survived saveProject/normalizeProject');

  tap(nes, B);
  for (let step = 0; step < FADE_STEPS; step++) {
    run(nes, FADE_STEP_FRAMES);
    const palette = readPalette(nes);
    assert.ok(!palette.includes(0x0d), `no palette byte may read $0D at intermediate step ${step + 1} (saw ${palette.map((b) => b.toString(16))})`);
  }
});

// Test 7: a completed fade-out is sticky across an ordinary warp, and the
// destination actually loaded (round 1, finding 8 -- a palette-only
// assertion cannot see a warp that silently failed).
test('a completed Fade out survives an ordinary warp -- sticky, not restored', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const { nes, project } = await buildWith(
    t,
    [
      { op: 'fade', dir: 'out' },
      { op: 'warp', screen: 1, x: 40, y: 40 }
    ],
    (proj) => {
      // Screen 1 already exists in `sample`'s own map grid -- a map's screen
      // count is gridW*gridH, fixed by normalizeMap, so pushing a new one
      // onto the array is silently truncated back away. Giving the existing
      // screen 1 distinct tile data is what makes "did the destination
      // really load" checkable rather than assumed.
      proj.maps[0].screens[1].metatiles = new Array(240).fill(1);
    }
  );
  const original = paletteBytes(project);

  tap(nes, B);
  run(nes, FADE_STEPS * FADE_STEP_FRAMES + 20); // fade out completes, then the Warp runs
  assert.equal(nes.cpu.mem[FLAT_SCREEN], 1, 'the warp should have actually landed on screen 1');
  assert.equal(nes.cpu.mem[PLAYER_X], 40, "the warp should have set the player's x");
  assert.equal(nes.cpu.mem[PLAYER_Y], 40, "the warp should have set the player's y");
  assert.deepEqual(
    readPalette(nes),
    original.map((byte) => darkenedByte(byte, FADE_STEPS)),
    'the palette must still be fully dark after an ordinary warp -- redraw_screen must not reload it'
  );
});

// Test 8 (round 2, item 4c): PPUADDR (v) is left outside palette space
// immediately after the drain-plus-cleanup, sampled at that exact point via
// single-stepping rather than at some later point in the frame, where
// ordinary rendering would have moved v out of palette space on its own
// regardless of whether this fix ran at all.
test('the NMI leaves PPUADDR outside palette space right after a Fade packet drains', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-fade-ppuaddr-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  const slime = project.sprites.actors[0];
  const npcId = project.sprites.actors.length;
  project.sprites.actors.push({ ...structuredClone(slime), id: npcId, name: 'Fader', behavior: 'npc' });
  project.maps[0].screens[0].metatiles = new Array(240).fill(0);
  project.maps[0].screens[0].entities = [
    {
      actorId: npcId,
      x: 112,
      y: 96,
      props: { event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'fade', dir: 'out' }] }] } }
    }
  ];
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });

  const symbolsText = await fs.promises.readFile(built.symbolPath, 'utf8');
  const symbols = parseSymbolFile(symbolsText);
  const siteAddr = symbols.nmi_fade_ppuaddr;
  const doneAddr = symbols.nmi_fade_ppuaddr_done;
  const scrollAddr = symbols.nmi_scroll;
  const vramDrainAddr = symbols.vram_drain;
  assert.ok(Number.isFinite(siteAddr), 'nmi_fade_ppuaddr should be a named symbol in game.fns');
  assert.ok(Number.isFinite(doneAddr), 'nmi_fade_ppuaddr_done should be a named symbol in game.fns');
  assert.ok(Number.isFinite(scrollAddr), 'nmi_scroll should be a named symbol in game.fns');
  assert.ok(Number.isFinite(vramDrainAddr), 'vram_drain should be a named symbol in game.fns');

  // Round 1, finding 1: pin the *placement*, not just the byte sequence's
  // presence somewhere in the PRG. The original version scanned the whole
  // ROM for the eight-byte needle with no tie to nmi_fade_ppuaddr's own
  // address, and its behavioural half stopped at nmi_fade_ppuaddr_done -- a
  // label that moves with the block it closes. Moving the labelled two-write
  // block from after `jsr vram_drain` to immediately before it left the
  // shipped test passing (sabotage-verified; see fixes-round1-report.md for
  // what failed). Mapping nmi_fade_ppuaddr's own address to its ROM file
  // offset -- the same fixedBankFileBase arithmetic flashdriver.test.js
  // already uses for save_media_commit -- ties the byte check to the label
  // it claims to be checking, rather than to wherever the bytes happen to
  // land.
  const rom = fs.readFileSync(built.romPath);
  const header = 16;
  const romCount = rom[4];
  const fixedBankFileBase = header + (romCount - 1) * 16384;
  const addrToOffset = (addr) => fixedBankFileBase + (addr - 0xc000);

  const siteOffset = addrToOffset(siteAddr);
  const needle = Buffer.from([0xa9, 0x00, 0x8d, 0x06, 0x20, 0x8d, 0x06, 0x20]);
  assert.ok(
    rom.subarray(siteOffset, siteOffset + needle.length).equals(needle),
    `the two-$2006-write PPUADDR fix should sit exactly at nmi_fade_ppuaddr's own address ` +
      `($${siteAddr.toString(16)}, file offset ${siteOffset}), saw ` +
      `${rom.subarray(siteOffset, siteOffset + needle.length).toString('hex')}`
  );

  // The three bytes immediately before that site must be `jsr vram_drain`
  // ($20, then vram_drain's own game.fns address little-endian) -- proving
  // the cleanup provably follows the drain, not merely that both exist
  // somewhere in the same NMI.
  const expectedJsr = Buffer.from([0x20, vramDrainAddr & 0xff, (vramDrainAddr >> 8) & 0xff]);
  assert.ok(
    rom.subarray(siteOffset - 3, siteOffset).equals(expectedJsr),
    `the three bytes immediately before nmi_fade_ppuaddr should be jsr vram_drain ($${vramDrainAddr.toString(16)}), ` +
      `saw ${rom.subarray(siteOffset - 3, siteOffset).toString('hex')}`
  );

  // nmi_fade_ppuaddr_done must equal nmi_scroll exactly -- they are adjacent
  // by design (only a .endif, which emits no bytes, sits between them), so
  // nothing may be inserted between the cleanup and the scroll rewrite
  // without this failing.
  assert.equal(
    doneAddr,
    scrollAddr,
    `nmi_fade_ppuaddr_done ($${doneAddr.toString(16)}) should equal nmi_scroll ($${scrollAddr.toString(16)}) -- ` +
      'nothing should sit between the cleanup and the scroll rewrite'
  );

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

  // Watch for the mainline actually applying a step (fade_step changing) --
  // that frame's own end-of-frame NMI is the one guaranteed to drain a real
  // Fade packet, which is what makes the *next* time PC reaches
  // nmi_fade_ppuaddr_done unambiguous: the skip path (no packet queued)
  // converges on the identical address with zero bytes between it and
  // nmi_scroll, so catching this specific frame's NMI is what rules that
  // ambiguity out rather than merely hoping the first occurrence is real.
  let prevStep = nes.cpu.mem[FADE_STEP];
  let sawStep = false;
  for (let f = 0; f < 60 && !sawStep; f++) {
    nes.frame();
    if (nes.cpu.mem[FADE_STEP] !== prevStep) sawStep = true;
  }
  assert.ok(sawStep, 'a Fade step should have applied within sixty frames');

  let hitDone = false;
  let vramAddressAtFix = null;
  for (let iter = 0; iter < 2_000_000 && !hitDone; iter++) {
    const frameEnded = emulator.stepInstruction();
    if (emulator.pc === doneAddr) {
      hitDone = true;
      vramAddressAtFix = nes.ppu.vramAddress;
    }
    if (frameEnded) break; // this frame's own NMI has already run by the time frame() would return
  }
  assert.ok(hitDone, 'never reached nmi_fade_ppuaddr_done while single-stepping the frame after a Fade step applied');
  assert.ok(
    vramAddressAtFix < 0x3f00 || vramAddressAtFix > 0x3fff,
    `PPUADDR (v) should be outside palette space right after the fix runs, but read $${vramAddressAtFix.toString(16)}`
  );
});

// Test 9 (round 2, item 4d): game over restores full brightness, and
// Continue is isolated from the game-over/restart_game path entirely -- a
// fix living only in restart_game must not be able to pass a test that
// claims to cover continue_game.
test('game over restores the palette, and Continue restores it in isolation from restart_game', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  // --- half 1: game over -----------------------------------------------
  const { nes: gameOverNes, project } = await buildWith(t, [
    { op: 'fade', dir: 'out' },
    { op: 'damage', value: 255 }
  ]);
  const original = paletteBytes(project);
  tap(gameOverNes, B);
  run(gameOverNes, FADE_STEPS * FADE_STEP_FRAMES + 20);
  assert.deepEqual(
    readPalette(gameOverNes),
    original.map((byte) => darkenedByte(byte, FADE_STEPS)),
    'the killing Damage should land on an already-fully-faded screen'
  );
  // Past the game-over box, onto a restarted game -- Start only restarts
  // once the game-over message has finished typing (ui_tick_dead requires
  // box_state == BOX_ENDWAIT before it reads pad_new for Start at all).
  for (let i = 0; i < 200 && gameOverNes.cpu.mem[GAME_STATE] !== 4; i++) gameOverNes.frame();
  assert.equal(gameOverNes.cpu.mem[GAME_STATE], 4, 'should have reached the game-over state');
  for (let i = 0; i < 200 && gameOverNes.cpu.mem[BOX_STATE] !== BOX_ENDWAIT; i++) gameOverNes.frame();
  assert.equal(gameOverNes.cpu.mem[BOX_STATE], BOX_ENDWAIT, 'the game-over message should have finished typing');
  tap(gameOverNes, START, 20);
  assert.deepEqual(readPalette(gameOverNes), original, 'restart_game should have restored the full-brightness palette');

  // --- half 2: Continue, isolated ---------------------------------------
  // A titled, saveable project with the identical Fade-out-then-Damage
  // event, but this half never triggers it: instead it reaches a fresh,
  // undarkened title with a valid save the ordinary way (play briefly,
  // save, power-cycle -- reset's own init_session/load_palette, not
  // restart_game), then darkens the screen by a direct PPU/RAM poke while
  // already sitting at that title -- so the *only* engine code that runs
  // between "screen is dark" and the assertion is whatever Continue itself
  // triggers.
  const dir2 = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-fade-continue-'));
  t.after(() => fs.promises.rm(dir2, { recursive: true, force: true }));
  const contProject = await loadProject(SAMPLE_RPG);
  contProject.cartridge.mapper = 1; // MMC1: save-capable
  contProject.project.titleMap = 0;
  contProject.project.titleScreen = 0;
  contProject.maps[0].encounters = { rate: 0, actorIds: [] };
  // A live Fade command has to exist somewhere for FADE_ENABLED to
  // assemble, but it must never run in this half -- an unreferenced common
  // event satisfies projectUsesFade without the scenario ever executing it.
  contProject.commonEvents = [
    {
      id: 0,
      name: 'Unused',
      event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'fade', dir: 'out' }] }] }
    }
  ];
  const saverId = contProject.sprites.actors.length;
  contProject.sprites.actors.push({ name: 'Saver', behavior: 'npc', hp: 1, damage: 0 });
  contProject.maps[0].screens[0].entities.push({
    actorId: saverId,
    x: 64,
    y: 96,
    props: { trigger: 'touch', event: { pages: [{ cond: { type: 'none', arg: 0 }, commands: [{ op: 'save' }] }] } }
  });
  await saveProject(dir2, contProject);
  const built2 = await buildProject({ dir: dir2, project: contProject, log: () => {} });
  const contOriginal = paletteBytes(contProject);

  const nes2 = new NES({ onFrame: () => {}, emulateSound: false });
  nes2.loadROM(new Uint8Array(fs.readFileSync(built2.romPath)));
  for (let i = 0; i < 60; i++) nes2.frame();
  tap(nes2, START, 12); // into the game, past the title
  assert.equal(nes2.cpu.mem[GAME_STATE], ST_GAMEPLAY);
  // Walk onto the saver at (64,96), the same shape save.test.js's own
  // walkTo/touchSaver use -- all four directions, since the saver sits both
  // left of and above the player's own start position.
  for (let i = 0; i < 400; i++) {
    const dx = 64 - nes2.cpu.mem[PLAYER_X];
    const dy = 96 - nes2.cpu.mem[PLAYER_Y];
    let button = null;
    if (dx > 1) button = RIGHT;
    else if (dx < -1) button = LEFT;
    else if (dy > 1) button = DOWN;
    else if (dy < -1) button = UP;
    if (button === null) break;
    nes2.buttonDown(1, button);
    nes2.frame();
    nes2.buttonUp(1, button);
  }
  for (let i = 0; i < 20; i++) nes2.frame();
  // Power cycle -- a real reset, the same one save.test.js's own powerCycle
  // performs, landing back on the title with the save intact and the
  // palette already reloaded bright by reset's own load_palette + the
  // fade_reload clear this revision adds.
  const battery = nes2.cpu.mem.slice(0x6000, 0x8000);
  nes2.reloadROM();
  nes2.cpu.mem.set(battery, 0x6000);
  for (let i = 0; i < 60; i++) nes2.frame();
  assert.equal(nes2.cpu.mem[GAME_STATE], ST_TITLE, 'a power cycle should boot back to the title');
  assert.deepEqual(readPalette(nes2), contOriginal, 'the fresh title should be at full brightness before the poke');

  // The isolating poke: darken the screen directly, with the title already
  // up and no Fade command, game over or restart_game anywhere in this run.
  for (let i = 0; i < 32; i++) {
    nes2.ppu.mirroredWrite(0x3f00 + i, darkenedByte(contOriginal[i], FADE_STEPS));
  }
  assert.deepEqual(
    readPalette(nes2),
    contOriginal.map((byte) => darkenedByte(byte, FADE_STEPS)),
    'the poke should have darkened the title'
  );

  tap(nes2, SELECT, 20); // Continue -- bound to SELECT by default at the title
  assert.equal(nes2.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'Continue should have loaded the save and resumed play');
  assert.deepEqual(
    readPalette(nes2),
    contOriginal,
    "Continue must restore full brightness through continue_game's own init_session call, in isolation from restart_game"
  );

  // --- negative control: an ordinary redraw must not restore it ---------
  const { nes: negNes, project: negProject } = await buildWith(t, [
    { op: 'fade', dir: 'out' },
    { op: 'warp', screen: 1, x: 40, y: 40 } // screen 1 already exists in sample's grid
  ]);
  const negOriginal = paletteBytes(negProject);
  tap(negNes, B);
  run(negNes, FADE_STEPS * FADE_STEP_FRAMES + 20);
  assert.deepEqual(
    readPalette(negNes),
    negOriginal.map((byte) => darkenedByte(byte, FADE_STEPS)),
    "fade_reload's own gating, not 'redraw_screen always reloads', is what distinguishes an ordinary warp from a new session"
  );
});

// Test 17 (round 2, item 1): cold boot must not leave fade_reload armed into
// the session's first ordinary redraw_screen call -- reset's own
// init_session arms it, and reset draws the very first screen manually
// (never through redraw_screen), so nothing before this fix ever consumed
// it.
test('boot straight into a Fade out, then a Warp, stays dark -- cold boot must not leave fade_reload armed', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'forge-fade-coldboot-'));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(SAMPLE);
  // Titleless, deliberately: if a title screen were present, pressing Start
  // to leave it would run start_game -> init_session -> redraw_screen (the
  // "fixes cold boot too, redundantly but harmlessly" path the design doc
  // itself notes) before gameplay ever begins -- which would consume and
  // re-clear fade_reload independently of reset's own fix, and the bug this
  // test exists to catch (reset's manual draw never consuming the flag
  // init_session armed at boot) would be invisible behind that second,
  // unrelated consumption. Titleless, `reset` goes straight to ST_GAMEPLAY
  // with nothing else touching fade_reload before this test's own Fade runs.
  project.project.titleMap = null;
  project.maps[0].screens[0].metatiles = new Array(240).fill(0);
  const slime = project.sprites.actors[0];
  const npcId = project.sprites.actors.length;
  project.sprites.actors.push({ ...structuredClone(slime), id: npcId, name: 'Fader', behavior: 'npc' });
  project.maps[0].screens[0].entities = [
    {
      actorId: npcId,
      x: 112,
      y: 96,
      props: {
        trigger: 'interact',
        event: {
          pages: [
            {
              cond: { type: 'none', arg: 0 },
              commands: [
                { op: 'fade', dir: 'out' },
                { op: 'warp', screen: 1, x: 40, y: 40 }
              ]
            }
          ]
        }
      }
    }
  ];
  await saveProject(dir, project);
  const built = await buildProject({ dir, project, log: () => {} });
  const original = paletteBytes(project);

  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(built.romPath)));
  for (let i = 0; i < 30; i++) nes.frame(); // this is boot's own first, manual draw
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'a titleless project should boot straight into gameplay');
  assert.deepEqual(readPalette(nes), original, 'the very first frame should be at full brightness');

  tap(nes, B); // this session's first (and only) Fade, then a Warp
  run(nes, FADE_STEPS * FADE_STEP_FRAMES + 20);
  assert.equal(nes.cpu.mem[FLAT_SCREEN], 1, 'the warp should have landed on screen 1');
  assert.deepEqual(
    readPalette(nes),
    original.map((byte) => darkenedByte(byte, FADE_STEPS)),
    'the session-first Warp must stay dark -- a stale fade_reload from cold boot would wrongly reload the bright palette here'
  );
});

// Test 10 (round 2, item 5): byte-identity for a project with no live Fade,
// compared against a build with the command genuinely never added -- not a
// live build vs an off one, which the original draft of this test asked for
// and no correct implementation could pass (a live Fade's own compiled
// bytecode and kernel both legitimately differ from an off one's). Plus the
// game.fns symbol-absence check (round 1, finding 9): byte-identity alone
// cannot tell "Fade correctly compiled out" from "Fade is always compiled
// in," since a hard-coded-true FADE_ENABLED would make both compared builds
// contain the machinery and still hash identically to each other.
test('a switched-off Fade costs a project nothing -- not one byte of ROM', {
  skip: !hasRom && 'run `npm run sample` first'
}, async (t) => {
  const withOff = await buildWith(t, [
    { op: 'fade', dir: 'out', off: true },
    { op: 'setSwitch', switch: 5 }
  ]);
  const without = await buildWith(t, [{ op: 'setSwitch', switch: 5 }]);

  assert.deepEqual(
    [...fs.readFileSync(withOff.romPath)],
    [...fs.readFileSync(without.romPath)],
    'a disabled Fade must leave the ROM identical to one with no Fade at all'
  );

  const symbols = await fs.promises.readFile(
    path.join(withOff.dir, 'build', 'game.fns'),
    'utf8'
  );
  assert.ok(!/^fade_tick\s*=/m.test(symbols), 'fade_tick must not have assembled at all for a project with no live Fade');
  assert.ok(!/^fade_apply_palette\s*=/m.test(symbols), 'fade_apply_palette must not have assembled at all for a project with no live Fade');
});

// ------------------------------------------------------- what a project pays for it

test('projectUsesFade ignores a command the compiler would drop, and finds it nested anywhere', () => {
  const project = createProject('Predicate');
  const pages = (commands) => ({ pages: [{ cond: { type: 'none', arg: 0 }, commands }] });

  project.commonEvents = [{ id: 0, name: 'E', event: pages([{ op: 'fade', dir: 'out' }]) }];
  assert.equal(projectUsesFade(project), true, 'a live Fade counts');

  project.commonEvents = [{ id: 0, name: 'E', event: pages([{ op: 'fade', dir: 'out', off: true }]) }];
  assert.equal(projectUsesFade(project), false, 'a switched-off one does not');

  // Inside a branch, the same place usedSwitches once failed to look.
  project.commonEvents = [
    {
      id: 0,
      name: 'E',
      event: pages([
        {
          op: 'branch',
          cond: { type: 'none', arg: 0 },
          then: [{ op: 'fade', dir: 'out' }],
          else: []
        }
      ])
    }
  ];
  assert.equal(projectUsesFade(project), true, 'a Fade nested inside a branch still counts');

  // And inside a Choice option -- the one place a hand-rolled walk that only
  // knew about then/else would still miss it.
  project.commonEvents = [
    {
      id: 0,
      name: 'E',
      event: pages([
        { op: 'choice', options: [{ text: 'Go', commands: [{ op: 'fade', dir: 'out' }] }, { text: 'No', commands: [] }] }
      ])
    }
  ];
  assert.equal(projectUsesFade(project), true, 'a Fade inside a Choice option still counts');

  // And reachable only through a common event a placement never calls --
  // projectEvents yields every common event as well as every placement's
  // own event, regardless of whether any `call` names it.
  project.commonEvents = [{ id: 0, name: 'Unused', event: pages([{ op: 'fade', dir: 'out' }]) }];
  project.maps[0].screens[0].entities = [];
  assert.equal(projectUsesFade(project), true, 'a Fade in an unreferenced common event still counts');
});

// -------------------------------------------------- test 16: PPU-core mirroring

// Test 1's own mirrored-pair assertion is real but structurally vacuous as a
// check on the PPU core's own pairwise mirroring (round 2, item 3):
// normalizeProject forces every project's mirrored bytes equal before Fade
// ever runs, so that assertion can only prove "the two sides are still
// equal," never "the core mirrors last-write-wins correctly." This bypasses
// project data and Fade entirely, exercising the vendored core's own write
// path directly.
test('the PPU core mirrors palette writes pairwise, last-write-wins, and the four BG entries stay independent', {
  skip: !hasRom && 'run `npm run sample` first'
}, () => {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(new Uint8Array(fs.readFileSync(path.join(SAMPLE, 'build/game.nes'))));

  const pairs = [
    [0x3f00, 0x3f10],
    [0x3f04, 0x3f14],
    [0x3f08, 0x3f18],
    [0x3f0c, 0x3f1c]
  ];
  for (const [bg, spr] of pairs) {
    nes.ppu.mirroredWrite(bg, 0x01);
    nes.ppu.mirroredWrite(spr, 0x02);
    assert.equal(nes.ppu.vramMem[bg], 0x02, `writing $${spr.toString(16)} should update $${bg.toString(16)} too (last write wins)`);
    assert.equal(nes.ppu.vramMem[spr], 0x02, `$${spr.toString(16)} should read back what was just written`);

    nes.ppu.mirroredWrite(spr, 0x03);
    nes.ppu.mirroredWrite(bg, 0x04);
    assert.equal(nes.ppu.vramMem[spr], 0x04, `writing $${bg.toString(16)} should update $${spr.toString(16)} too (last write wins)`);
    assert.equal(nes.ppu.vramMem[bg], 0x04, `$${bg.toString(16)} should read back what was just written`);
  }

  // The four BG entry-0 bytes stay independent of each other at the
  // hardware level -- only this codebase's own normalizeProject convention
  // keeps a real project's copies equal, not the PPU's own mirroring.
  nes.ppu.mirroredWrite(0x3f00, 0x11);
  nes.ppu.mirroredWrite(0x3f04, 0x22);
  nes.ppu.mirroredWrite(0x3f08, 0x33);
  nes.ppu.mirroredWrite(0x3f0c, 0x44);
  assert.equal(nes.ppu.vramMem[0x3f00], 0x11);
  assert.equal(nes.ppu.vramMem[0x3f04], 0x22);
  assert.equal(nes.ppu.vramMem[0x3f08], 0x33);
  assert.equal(nes.ppu.vramMem[0x3f0c], 0x44);
});
