// The battle input fix (docs/design-equipment.md section 4, "The E9 fix"): dispatch_input
// (engine/input.asm) reads no button action while game_state is ST_BATTLE, on an RPG only.
//
// The authored `battle` row is A = confirm, B = cancel, and the dispatcher used to run it in
// every state, so a B press at the battle command menu ran do_action_cancel -> close_ui, set
// game_state to ST_GAMEPLAY and abandoned the fight and its screen before the battle code read
// the pad (handoff-next/equip/d2/probe-bcontrol.out: state 5 -> 0). The battle phases read
// pad_new themselves, so nothing a fight needs went with the row.
//
// Every observation below is made on a ROM built from a temp copy of sample-rpg, and each
// result is paired with a control: the same sequence on the engine with the fix taken out
// (the Code Forge's `overrides` carry the edited input.asm text, the way
// kernelbytes.test.js's builtWithOverride does), or with the skip applied in every state.
// A test whose control also passed would prove nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NES from '../../renderer/emulator/core/nes.js';
import { loadProject, saveProject } from '../../main/project-io.js';
import { buildProject } from '../../main/build/pipeline.js';
import { SUPPORTED_MAPPERS } from '../../shared/cartridge.js';
import { finishNamingIfOpen, waitForNamingReady } from '../lib/naming.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE_RPG = path.join(ROOT, 'sample-rpg');
const SAMPLE = path.join(ROOT, 'sample');

// engine/constants.asm
const PLAYER_X = 0x10;
const PLAYER_Y = 0x11;
const GAME_STATE = 0x25; // from engine/constants.asm
const PAUSED = 0x26; // from engine/constants.asm
const BOX_STATE = 0x40; // from engine/constants.asm
const BT_PHASE = 0x53; // from engine/constants.asm
const NM_LEN = 0x059a; // from engine/constants.asm
const ST_GAMEPLAY = 0;
const ST_MENU = 1;
const ST_DIALOG = 2;
const ST_BATTLE = 5;
const BP_INTRO = 0;
const BP_MENU = 1;
const BOX_PAGEWAIT = 3; // from engine/constants.asm
const BOX_ENDWAIT = 6; // from engine/constants.asm

const A = 0;
const B = 1;
const START = 3;
const SELECT = 2;
const DOWN = 5;
const LEFT = 6;
const RIGHT = 7;
const UP = 4;

// The fix in engine/input.asm, found by shape rather than by its exact text (the gate and its comments may be re-worded): the
// state test and the branch, with the `.if BATTLE_ENABLED` / `.endif` pair around them when there is one. The controls cut or
// widen exactly this span, and each asserts it is in the stock file once, so a control cannot go vacuous if the fix moves.
const SKIP = / {2}\.if BATTLE_ENABLED\n {2}lda <game_state\n {2}cmp #ST_BATTLE[^\n]*\n {2}beq dispatch_done[^\n]*\n {2}\.endif[^\n]*\n/;
const SKIP_ANY_GATE = / {2}(?:\.if BATTLE_ENABLED\n {2})?lda <game_state\n {2}cmp #ST_BATTLE[^\n]*\n {2}beq dispatch_done[^\n]*\n(?: {2}\.endif[^\n]*\n)?/g;

const STOCK_INPUT = fs.readFileSync(path.join(ROOT, 'engine', 'input.asm'), 'utf8');

/** The stock input.asm with the skip span replaced by `repl` (a function of the span, or a string). */
function inputVariant(repl) {
  const spans = STOCK_INPUT.match(SKIP_ANY_GATE) ?? [];
  assert.equal(spans.length, 1, 'the ST_BATTLE skip is in engine/input.asm exactly once');
  return STOCK_INPUT.replace(SKIP_ANY_GATE, (span) => (typeof repl === 'function' ? repl(span) : repl));
}
const WITHOUT_SKIP = () => inputVariant('');
// The same skip with no state test: every state leaves dispatch_input without reading a button.
const SKIP_EVERY_STATE = () => inputVariant('  .if BATTLE_ENABLED\n  jmp dispatch_done\n  .endif\n');
// The skip without its `.if`: what an action ROM would gain if the gate were dropped.
const SKIP_UNGATED = () => inputVariant((span) => span.replace(/ {2}\.if BATTLE_ENABLED\n/, '').replace(/ {2}\.endif[^\n]*\n/, ''));

/**
 * A build of `fixture` in a temp dir the test owns. `mutate` edits the project first;
 * `inputText` (optional) replaces engine/input.asm through the Code Forge. The temp copy is
 * what is built, never the checked-in fixture.
 */
async function build(t, name, { fixture = SAMPLE_RPG, mutate = () => {}, inputText = null, mapper = null } = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `forge-battleinput-${name}-`));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await loadProject(fixture);
  if (mapper !== null) project.cartridge.mapper = mapper;
  mutate(project);
  if (inputText !== null) {
    project.code = project.code ?? { overrides: [], files: [] };
    project.code.overrides = [{ name: 'input.asm', text: inputText }];
  }
  await saveProject(dir, project);
  const lines = [];
  const built = await buildProject({ dir, project, log: (line) => lines.push(line) });
  return { ...built, lines, symbols: await fs.promises.readFile(built.symbolPath, 'utf8') };
}

const rom = (built) => new Uint8Array(fs.readFileSync(built.romPath));
const sha = (built) => crypto.createHash('sha256').update(fs.readFileSync(built.romPath)).digest('hex');
const symbol = (built, label) => {
  const m = built.symbols.match(new RegExp(`^${label}\\s*=\\s*\\$([0-9A-Fa-f]+)`, 'm'));
  assert.ok(m, `${label} not in game.fns`);
  return parseInt(m[1], 16);
};

function boot(built, frames = 40) {
  const nes = new NES({ onFrame: () => {}, emulateSound: false });
  nes.loadROM(rom(built));
  for (let i = 0; i < frames; i++) nes.frame();
  return nes;
}

const tap = (nes, button, frames = 14) => {
  nes.buttonDown(1, button);
  nes.frame();
  nes.buttonUp(1, button);
  for (let i = 0; i < frames; i++) nes.frame();
};

function walkTo(nes, targetX, targetY, budget = 600) {
  for (let i = 0; i < budget; i++) {
    if (nes.cpu.mem[GAME_STATE] !== ST_GAMEPLAY) return;
    const dx = targetX - nes.cpu.mem[PLAYER_X];
    const dy = targetY - nes.cpu.mem[PLAYER_Y];
    let button = null;
    if (dx > 1) button = RIGHT;
    else if (dx < -1) button = LEFT;
    else if (dy > 1) button = DOWN;
    else if (dy < -1) button = UP;
    if (button === null) return;
    nes.buttonDown(1, button);
    nes.frame();
    nes.buttonUp(1, button);
  }
}

const nametable = (nes) => Array.from(nes.ppu.vramMem.slice(0x2000, 0x2000 + 30 * 32));

/** Press B once and report every distinct game_state and bt_phase seen on each frame boundary for the next `frames` frames. */
function watchAfterB(nes, frames) {
  const states = new Set();
  const phases = new Set();
  nes.buttonDown(1, B);
  nes.frame();
  nes.buttonUp(1, B);
  for (let i = 0; i < frames; i++) {
    states.add(nes.cpu.mem[GAME_STATE]);
    phases.add(nes.cpu.mem[BT_PHASE]);
    nes.frame();
  }
  return { states: [...states], phases: [...phases] };
}

/** sample-rpg's fixed slime at (176,176), with the wandering encounters switched off. */
const fixedFight = (project) => {
  project.maps[0].encounters = { rate: 0, actorIds: [] };
};

/** Boot past hero naming and walk into the slime; returns once the command menu is up. */
function intoCommandMenu(built) {
  const nes = finishNamingIfOpen(boot(built));
  walkTo(nes, 160, 176);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE, 'the walk never began a fight');
  for (let i = 0; i < 900 && nes.cpu.mem[BT_PHASE] !== BP_MENU; i++) nes.frame();
  assert.equal(nes.cpu.mem[BT_PHASE], BP_MENU, 'the command menu never came round');
  return nes;
}

// --- (1) a real fight: one B at the command menu -------------------------------------------

test('a B press at the battle command menu leaves the fight alone, and the fight ends normally with the field redrawn', async (t) => {
  const built = await build(t, 'fight', { mutate: fixedFight });
  const nes = finishNamingIfOpen(boot(built));
  walkTo(nes, 160, 176);
  const fieldBefore = nametable(nes);
  walkTo(nes, 176, 176, 200);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  for (let i = 0; i < 900 && nes.cpu.mem[BT_PHASE] !== BP_MENU; i++) nes.frame();
  assert.equal(nes.cpu.mem[BT_PHASE], BP_MENU);
  assert.notDeepEqual(nametable(nes), fieldBefore, 'the battle screen should differ from the field it covers');

  // Every frame after the press, not just the last: a torn-down fight that the still-overlapping slime starts again within the same
  // frame reads ST_BATTLE at the frame's end, and only bt_phase falling back to BP_INTRO gives it away.
  const afterB = watchAfterB(nes, 40);
  assert.deepEqual(afterB.states, [ST_BATTLE], 'B at the command menu must not leave ST_BATTLE, on any frame');
  assert.deepEqual(afterB.phases, [BP_MENU], 'B at the command menu must not move bt_phase, on any frame');

  // The fight then carries on: A chooses Fight, then the target, and presses through to the end.
  for (let i = 0; i < 80 && nes.cpu.mem[GAME_STATE] === ST_BATTLE; i++) tap(nes, A, 12);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_GAMEPLAY, 'the fight never reached a normal end (4 would be game over)');
  for (let i = 0; i < 20; i++) nes.frame();
  assert.equal(nes.cpu.mem[BOX_STATE], 0, 'no box left open');
  // battle_end redraws the field: the nametable is the field again, not the battle screen.
  assert.deepEqual(nametable(nes), fieldBefore, 'the field was not redrawn after the fight');
});

test('control: with the fix taken out, the same B closes the UI (game_state 5 -> 0, probe-bcontrol.out) and abandons the fight', async (t) => {
  const built = await build(t, 'fight-ctl', { mutate: fixedFight, inputText: WITHOUT_SKIP() });
  const nes = intoCommandMenu(built);
  assert.equal(nes.cpu.mem[GAME_STATE], ST_BATTLE);
  const afterB = watchAfterB(nes, 40);
  // B ran do_action_cancel -> close_ui: game_state went to ST_GAMEPLAY (probe-bcontrol.out: 5 -> 0) and the fight was abandoned. The
  // slime is still under the player, so the same frame's entity pass begins a new fight; what remains visible at the frame's end is
  // the phase falling back to BP_INTRO, the tell of a restarted fight.
  assert.ok(afterB.phases.includes(BP_INTRO), `without the fix B abandons the fight (phases seen ${afterB.phases})`);
});

test('the control builds are real: taking the fix out changes an RPG ROM', async (t) => {
  const stock = await build(t, 'stock', { mutate: fixedFight });
  const without = await build(t, 'without', { mutate: fixedFight, inputText: WITHOUT_SKIP() });
  assert.notEqual(sha(stock), sha(without), 'removing the fix must change an RPG ROM');
});

// --- (2) field B still cancels -------------------------------------------------------------

/**
 * Four observations of a B (or a bound button) outside a fight. Each is a boolean: did the action the row binds still happen?
 * The naming grid is observed on `naming` (hero naming on, as sample-rpg ships); the other three on `plain` (naming off, so a
 * dispatcher that reads nothing can still be booted past the start). Dialogue is given a B = cancel row in both, since the
 * shipped dialog row binds B to confirm.
 */
function fieldObservations({ plain, naming }) {
  const out = {};

  // the bag: Select opens it (item), B (cancel) closes it
  {
    const nes = boot(plain);
    tap(nes, SELECT, 6);
    const opened = nes.cpu.mem[GAME_STATE] === ST_MENU;
    tap(nes, B, 6);
    out.bagOpens = opened;
    out.bagCloses = opened && nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY;
  }

  // a dialogue: B (interact) at Iris begins it, B (cancel on the temp row) walks it to its end
  {
    const nes = boot(plain);
    walkTo(nes, 208, 48);
    tap(nes, B, 6);
    const opened = nes.cpu.mem[GAME_STATE] === ST_DIALOG;
    for (let i = 0; i < 40 && nes.cpu.mem[GAME_STATE] === ST_DIALOG; i++) {
      for (let f = 0; f < 80 && nes.cpu.mem[BOX_STATE] !== BOX_PAGEWAIT && nes.cpu.mem[BOX_STATE] !== BOX_ENDWAIT; f++) nes.frame();
      tap(nes, B, 12);
    }
    out.dialogOpens = opened;
    out.dialogCancels = opened && nes.cpu.mem[GAME_STATE] === ST_GAMEPLAY;
  }

  // the naming grid: B (cancel) deletes the last letter of the seeded name
  {
    const nes = boot(naming);
    waitForNamingReady(nes);
    const before = nes.cpu.mem[NM_LEN];
    tap(nes, B, 8);
    out.nameLen = before;
    out.namingCancels = before > 0 && nes.cpu.mem[NM_LEN] === before - 1;
  }

  // a bound action in ST_GAMEPLAY: Start is pause
  {
    const nes = boot(plain);
    tap(nes, START, 6);
    out.pauseDispatches = nes.cpu.mem[PAUSED] === 1;
  }
  return out;
}

const dialogCancelRow = (project) => {
  project.input.states.dialog.B = 'cancel';
  fixedFight(project);
};
// Naming off everywhere: the game boots straight to ST_GAMEPLAY, and Iris joins without a grid.
const dialogCancelRowNoNaming = (project) => {
  dialogCancelRow(project);
  for (const member of project.party) member.renamable = false;
};

async function buildFieldPair(t, name, inputText = null) {
  return {
    plain: await build(t, `${name}-plain`, { mutate: dialogCancelRowNoNaming, inputText }),
    naming: await build(t, `${name}-naming`, { mutate: dialogCancelRow, inputText })
  };
}

test('field B still cancels: the bag closes, a dialogue cancels, the naming grid cancels, and a bound action dispatches', async (t) => {
  const seen = fieldObservations(await buildFieldPair(t, 'field'));
  assert.equal(seen.bagOpens, true, 'Select opens the bag');
  assert.equal(seen.bagCloses, true, 'B closes the bag');
  assert.equal(seen.dialogOpens, true, 'B talks to Iris');
  assert.equal(seen.dialogCancels, true, 'B (cancel) ends the dialogue');
  assert.ok(seen.nameLen > 0, 'the grid opens with a seeded name');
  assert.equal(seen.namingCancels, true, 'B deletes a letter on the naming grid');
  assert.equal(seen.pauseDispatches, true, 'Start still pauses in ST_GAMEPLAY');
});

test('control: a dispatcher that skips every state fails each of those', async (t) => {
  const seen = fieldObservations(await buildFieldPair(t, 'field-ctl', SKIP_EVERY_STATE()));
  assert.equal(seen.bagOpens, false, 'Select opens nothing when no state reads a button');
  assert.equal(seen.bagCloses, false);
  assert.equal(seen.dialogOpens, false, 'a dispatcher that reads no button cannot even start the conversation');
  assert.equal(seen.dialogCancels, false);
  assert.equal(seen.namingCancels, false);
  assert.equal(seen.pauseDispatches, false);
});

// --- the gate: an action ROM does not gain the skip ---------------------------------------

test('an action ROM is byte for byte the same with or without the skip text: the `.if BATTLE_ENABLED` gate holds', async (t) => {
  const stock = await build(t, 'action-stock', { fixture: SAMPLE });
  const without = await build(t, 'action-without', { fixture: SAMPLE, inputText: WITHOUT_SKIP() });
  assert.equal(sha(stock), sha(without), 'an action ROM must assemble the same bytes whether or not the skip is in input.asm');
  // control: the same text without its gate does change an action ROM
  const ungated = await build(t, 'action-ungated', { fixture: SAMPLE, inputText: SKIP_UNGATED() });
  assert.notEqual(sha(stock), sha(ungated), 'an ungated skip would add bytes to an action ROM');
  assert.equal(symbol(ungated, 'do_action') - symbol(stock, 'do_action'), 6, 'and exactly the six the skip costs');
});

// --- the kernel cost, per RPG board --------------------------------------------------------

test('the skip costs exactly 6 bytes of kernel-lo on MMC1, MMC3 and UNROM 512', async (t) => {
  for (const id of [1, 4, 30]) {
    const mapper = SUPPORTED_MAPPERS.find((m) => m.id === id);
    const stock = await build(t, `kernel-${id}`, { mapper: id });
    const without = await build(t, `kernel-${id}-without`, { mapper: id, inputText: WITHOUT_SKIP() });
    assert.equal(
      symbol(stock, 'do_action') - symbol(without, 'do_action'),
      6,
      `${mapper.name}: the skip is lda zp + cmp # + beq = 6 bytes`
    );
  }
});
